import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import PizZip from 'pizzip';
import { runUserCode } from './runner';

const baseCtx = {
  apiBase: 'http://127.0.0.1:8080',
  token: 'test-token',
  databaseId: '',
  dbType: 'sqlite',
  databases: [],
};

describe('gov-runner', () => {
  test('renders showTable output as table marker', async () => {
    const result = await runUserCode(
      `const data = [\n  { id: 1, name: "项目A", status: "进行中" },\n  { id: 2, name: "项目B", status: "已完成" }\n];\ngov.showTable(data);\ngov.log("完成");`,
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output.some((line) => line.startsWith('__TABLE__:'))).toBe(true);
    expect(result.output.includes('完成')).toBe(true);
  });

  test('supports table alias and plain logging', async () => {
    const result = await runUserCode(
      `gov.table([{ a: 1, b: 2 }]);\ngov.log('ok');`,
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output[0]).toContain('__TABLE__');
    expect(result.output.at(-1)).toBe('ok');
  });

  test('returns generated files when user code writes output', async () => {
    const result = await runUserCode(
      `gov.writeJSON('report', { ok: true, items: [1, 2, 3] });\ngov.writeText('note.txt', 'hello');`,
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output_files?.length).toBe(2);
    expect(result.output_files?.[0].name).toBe('report.json');
    expect(result.output_files?.[1].name).toBe('note.txt');
  });

  test('returns a failure when user code throws', async () => {
    const result = await runUserCode(
      `gov.log('before error');\nthrow new Error('boom');`,
      baseCtx
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('before error');
    expect(result.error).toContain('boom');
  });

  test('awaits async user code to completion', async () => {
    const result = await runUserCode(
      `gov.log('开始');
       await new Promise(r => setTimeout(r, 100));
       gov.log('中间');
       await new Promise(r => setTimeout(r, 50));
       gov.log('完成');`,
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('开始');
    expect(result.output).toContain('中间');
    expect(result.output).toContain('完成');
  });

  test('awaits async function main pattern', async () => {
    // 用户常见写法：定义 async main 并调用，runner 必须等待
    const result = await runUserCode(
      `async function main(){
         gov.log('start');
         await new Promise(r => setTimeout(r, 80));
         gov.log('end');
       }
       return main();`, // 返回 Promise 时，runUserCode 内部会 await AsyncFunction 的返回值
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('start');
    expect(result.output).toContain('end');
  });

  test('reads Word tables with widths and reusable style', async () => {
    const tmplPath = new URL('../apps/data-ontology/example_files/2024年4月12日单位B日报.docx', import.meta.url);
    const buf = readFileSync(tmplPath);
    const inputFile = {
      name: '单位B日报.docx',
      size: buf.length,
      async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
      async text() { return buf.toString('utf8'); },
    };
    const result = await runUserCode(
      `const ts = await gov.readWordTables(INPUT_FILES[0]);
       gov.log(JSON.stringify(ts));`,
      baseCtx,
      { inputFiles: [inputFile] }
    );
    expect(result.success).toBe(true);
    const tables = JSON.parse(result.output[0]);
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBeGreaterThan(0);
    expect(Array.isArray(tables[0].rows)).toBe(true);
    expect(tables[0].rows.length).toBeGreaterThan(0);
    expect(Array.isArray(tables[0].rows[0])).toBe(true);
    expect(tables[0].colWidths.length).toBeGreaterThan(0);
  });

  test('builds a Word table from template style and saves docx', async () => {
    const tmplPath = new URL('../apps/data-ontology/example_files/2024年4月12日单位B日报.docx', import.meta.url);
    const buf = readFileSync(tmplPath);
    const inputFile = {
      name: '单位B日报.docx',
      size: buf.length,
      async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
      async text() { return buf.toString('utf8'); },
    };
    const result = await runUserCode(
      `const ts = await gov.readWordTables(INPUT_FILES[0]);
       const b = gov.word();
       b.heading('产品汇总', 1);
       b.paragraph('按区展示', { bold: true, font: { name: '仿宋_GB2312', size: 16 } });
       b.tableFromTemplate(ts[0].style, [['产品','数量'],['苹果','10']]);
       await b.save('汇总');`,
      baseCtx,
      { inputFiles: [inputFile] }
    );
    expect(result.success).toBe(true);
    const out = result.output_files?.find((f) => f.name === '汇总.docx');
    expect(out).toBeTruthy();
    const zip = new PizZip(Buffer.from(out!.content_base64, 'base64'));
    const xml = zip.file('word/document.xml')!.asText();
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('苹果');
  });

  test('writeExcel applies widths/merges/freeze/autofilter/styles', async () => {
    const result = await runUserCode(
      `gov.writeExcel('styled', [['名称','金额'],['A',1.5],['B',2.5]], {
         columnWidths: [20, 12], rowHeights: [24, 18, 18], merges: ['A1:B1'], freeze: 'A2', autofilter: 'A1:B1',
         styles: { 'A1:B1': { fill: { fgColor: '#DDEBF7' }, bold: true, alignment: { horizontal: 'center' } },
                   'A2': { font: { bold: true, color: 'red' }, border: { style: 'thin' } },
                   'B2:B3': { numFmt: '0.00' } }
       });`,
      baseCtx
    );
    expect(result.success).toBe(true);
    const out = result.output_files?.find((f) => f.name === 'styled.xlsx');
    expect(out).toBeTruthy();
    const zip = new PizZip(Buffer.from(out!.content_base64, 'base64'));
    const sheet = zip.file('xl/worksheets/sheet1.xml')!.asText();
    const styles = zip.file('xl/styles.xml')!.asText();
    expect(sheet).toContain('<pane');
    expect(sheet).toContain('<autoFilter');
    expect(sheet).toContain('<cols>');
    expect(sheet).toContain('<mergeCell');
    expect(/<c r="A2" s="\d+"/.test(sheet)).toBe(true);
    expect(styles).toContain('DDEBF7');
    expect(styles).toContain('FF0000');
    expect(styles).toContain('numFmt');
  });

  test('end-to-end preset: one template-styled table per product grouped by 区', async () => {
    const makeFile = (name: string) => {
      const buf = readFileSync(new URL(`../apps/data-ontology/example_files/${name}`, import.meta.url));
      return {
        name,
        size: buf.length,
        async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
        async text() { return buf.toString('utf8'); },
      };
    };
    const script = readFileSync(new URL('../scripts/gov-product-word-tables.js', import.meta.url), 'utf8');
    const result = await runUserCode(script, baseCtx, {
      inputFiles: [makeFile('表格模板.docx'), makeFile('纯文本产品介绍.docx')],
    });

    expect(result.success).toBe(true);
    const out = result.output_files?.find((f) => f.name.includes('产品汇总'));
    expect(out).toBeTruthy();
    const zip = new PizZip(Buffer.from(out!.content_base64, 'base64'));
    const xml = zip.file('word/document.xml')!.asText();

    // 样例共 7 个产品 → 7 张表格（每个产品一张）
    expect((xml.match(/<w:tbl>/g) || []).length).toBe(7);
    // 复用模板样式：表头底纹 + 模板列宽
    expect(xml).toContain('DDEBF7');
    expect(xml).toContain('<w:gridCol w:w="2600"');
    // 区级分组标题与产品名都在
    for (const s of ['城东区', '城西区', '临江区', '临江县', '云台山泉饮用水', '临江土蜂蜜']) {
      expect(xml).toContain(s);
    }
  });
});
