import { describe, expect, test } from 'bun:test';
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
       main();`, // 注意：这里没有 await，但 runUserCode 内部会 await AsyncFunction 的返回值
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('start');
    expect(result.output).toContain('end');
  });
});
