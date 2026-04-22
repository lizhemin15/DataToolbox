/**
 * 数据治理任务执行器（后端版）
 * 从浏览器端 script.js 移植，去掉 DOM 依赖
 */

import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';
import mammoth from 'mammoth';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { govApplyCellMapToSheet, govCsvEscapeCell, govDataIsFlatCellMap } from './gov-shared';

export interface GovContext {
  apiBase: string;
  token: string;
  databaseId: string;
  dbType: string;
  databases: Array<{ id: string; name: string; type: string }>;
}

export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface GovOutputFile {
  name: string;
  content_base64: string;
}

export interface GovHelper {
  log(msg: string): void;
  showTable(data: any[]): void;
  getDbType(): string;
  getDatabases(): Array<{ id: string; name: string; type: string }>;
  readExcel(file: FileLike): Promise<XLSX.WorkBook>;
  readCSV(text: string): Promise<any[][]>;
  readWord(file: FileLike): Promise<{ value: string }>;
  querySQL(sql: string, params?: any[]): Promise<any[]>;
  executeSQL(sql: string, params?: any[]): Promise<number>;
  querySQLForDb(databaseId: string, sql: string, params?: any[]): Promise<any[]>;
  executeSQLForDb(databaseId: string, sql: string, params?: any[]): Promise<number>;
  callAI(prompt: string): Promise<string>;
  fillWordTemplate(templateFile: FileLike, data: any, outputFilename: string): Promise<void>;
  writeExcel(filename: string, data: any, options?: { sheetName?: string }): void;
  fillExcelTemplate(templateFile: FileLike, data: any, outputFilename: string): Promise<void>;
  writeCSV(filename: string, data: any[][]): void;
  writeText(filename: string, content: string): void;
  writeJSON(filename: string, data: any): void;
}

/**
 * 创建治理助手（后端版）
 */
export function createGovHelper(
  ctx: GovContext,
  logLines: string[],
  outputFiles: GovOutputFile[]
): GovHelper {
  const { apiBase, token, databaseId, dbType, databases } = ctx;

  async function _runSQL(dbId: string, sql: string, params: any[] = []): Promise<any> {
    const resp = await fetch(`${apiBase}/api/data-ontology/governance/execute-sql`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ database_id: dbId, sql, params })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.message || 'SQL执行失败');
    return data;
  }

  const showTable = (data: any[]) => {
    if (!Array.isArray(data)) {
      logLines.push('__TABLE__:[]');
      return;
    }
    try {
      const jsonStr = JSON.stringify(data);
      logLines.push(`__TABLE__:${jsonStr}`);
    } catch (e: any) {
      logLines.push(`__TABLE__:[] // Error serializing data: ${e.message}`);
    }
  };

  return {
    log(msg: string) {
      logLines.push(String(msg));
    },

    showTable,
    table: showTable,

    getDbType() {
      return dbType;
    },

    getDatabases() {
      return databases || [];
    },

    async readExcel(file: FileLike): Promise<XLSX.WorkBook> {
      if (!file) throw new Error('未提供文件');
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error('Excel解析失败: 未检测到工作表');
      }
      return wb;
    },

    async readCSV(text: string): Promise<any[][]> {
      if (!text) throw new Error('未提供文本');
      return Papa.parse(text, { header: false }).data;
    },

    async readWord(file: FileLike): Promise<{ value: string }> {
      if (!file) throw new Error('未提供文件');
      const arrayBuffer = await file.arrayBuffer();
      return mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) });
    },

    async querySQL(sql: string, params?: any[]): Promise<any[]> {
      if (!databaseId) throw new Error('未关联数据库');
      const result = await _runSQL(databaseId, sql, params || []);
      return result.data || [];
    },

    async executeSQL(sql: string, params?: any[]): Promise<number> {
      if (!databaseId) throw new Error('未关联数据库');
      const result = await _runSQL(databaseId, sql, params || []);
      return result.rows_affected || 0;
    },

    async querySQLForDb(dbId: string, sql: string, params?: any[]): Promise<any[]> {
      const result = await _runSQL(dbId, sql, params || []);
      return result.data || [];
    },

    async executeSQLForDb(dbId: string, sql: string, params?: any[]): Promise<number> {
      const result = await _runSQL(dbId, sql, params || []);
      return result.rows_affected || 0;
    },

    async callAI(prompt: string): Promise<string> {
      const resp = await fetch(`${apiBase}/api/data-ontology/ai/completion`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ prompt })
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.message || 'AI 调用失败');
      return data.content || '';
    },

    async fillWordTemplate(templateFile: FileLike, data: any, outputFilename: string) {
      if (!templateFile) throw new Error('未提供模板文件');
      const buf = Buffer.from(await templateFile.arrayBuffer());
      const zip = new PizZip(buf);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
      doc.setData(data || {});
      doc.render();
      const out = doc.getZip().generate({ type: 'nodebuffer' }) as Buffer;
      const base = outputFilename || 'output.docx';
      const name = /\.docx$/i.test(base) ? base : `${base}.docx`;
      outputFiles.push({ name, content_base64: out.toString('base64') });
      logLines.push(`已生成输出文件: ${name}`);
    },

    writeExcel(filename: string, data: any, options?: { sheetName?: string }) {
      if (!filename) throw new Error('未提供文件名');
      const opts = options || {};
      const sheetName = String(opts.sheetName || 'Sheet1').slice(0, 31);
      let ws: XLSX.WorkSheet;
      if (!data || !data.length) {
        ws = XLSX.utils.aoa_to_sheet([[]]);
      } else if (Array.isArray(data[0])) {
        ws = XLSX.utils.aoa_to_sheet(data);
      } else {
        ws = XLSX.utils.json_to_sheet(data);
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const base = filename;
      const outName = /\.xlsx?$/i.test(base) ? base : `${base}.xlsx`;
      const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      outputFiles.push({ name: outName, content_base64: out.toString('base64') });
      logLines.push(`已生成输出文件: ${outName}`);
    },

    async fillExcelTemplate(templateFile: FileLike, data: any, outputFilename: string) {
      if (!templateFile) throw new Error('未提供模板文件');
      if (!data || typeof data !== 'object') throw new Error('data 须为对象');
      const wb = await (async () => {
        const arrayBuffer = await templateFile.arrayBuffer();
        const u8 = new Uint8Array(arrayBuffer);
        const w = XLSX.read(u8, { type: 'array' });
        if (!w || !w.SheetNames || w.SheetNames.length === 0) {
          throw new Error('Excel解析失败: 未检测到工作表');
        }
        return w;
      })();
      const flat = govDataIsFlatCellMap(XLSX, data as Record<string, unknown>);
      if (flat) {
        const sn = wb.SheetNames[0];
        govApplyCellMapToSheet(XLSX, wb.Sheets[sn], data as Record<string, unknown>);
      } else {
        for (const [sheetName, cells] of Object.entries(data)) {
          if (!cells || typeof cells !== 'object' || Array.isArray(cells)) continue;
          const ws = wb.Sheets[sheetName];
          if (!ws) throw new Error(`模板中不存在工作表「${sheetName}」`);
          govApplyCellMapToSheet(XLSX, ws, cells as Record<string, unknown>);
        }
      }
      const base = outputFilename || 'output.xlsx';
      const outName = /\.xlsx?$/i.test(base) ? base : `${base}.xlsx`;
      const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      outputFiles.push({ name: outName, content_base64: out.toString('base64') });
      logLines.push(`已生成输出文件: ${outName}`);
    },

    writeCSV(filename: string, data: any[][]) {
      if (!filename) throw new Error('未提供文件名');
      if (!Array.isArray(data)) throw new Error('data 须为二维数组');
      const lines = data.map((row) => {
        if (!Array.isArray(row)) throw new Error('CSV 每行须为数组');
        return row.map(govCsvEscapeCell).join(',');
      });
      const csv = lines.join('\r\n');
      const bom = '\uFEFF';
      const buf = Buffer.from(bom + csv, 'utf8');
      const base = filename;
      const outName = /\.csv$/i.test(base) ? base : `${base}.csv`;
      outputFiles.push({ name: outName, content_base64: buf.toString('base64') });
      logLines.push(`已生成输出文件: ${outName}`);
    },

    writeText(filename: string, content: string) {
      if (!filename) throw new Error('未提供文件名');
      const text = content === undefined || content === null ? '' : String(content);
      const base = filename;
      const outName = /\.txt$/i.test(base) ? base : `${base}.txt`;
      const buf = Buffer.from(text, 'utf8');
      outputFiles.push({ name: outName, content_base64: buf.toString('base64') });
      logLines.push(`已生成输出文件: ${outName}`);
    },

    writeJSON(filename: string, data: any) {
      if (!filename) throw new Error('未提供文件名');
      const text = JSON.stringify(data, null, 2);
      const base = filename;
      const outName = /\.json$/i.test(base) ? base : `${base}.json`;
      const buf = Buffer.from(text, 'utf8');
      outputFiles.push({ name: outName, content_base64: buf.toString('base64') });
      logLines.push(`已生成输出文件: ${outName}`);
    },
  };
}

/**
 * 执行用户代码
 */
export async function runUserCode(
  code: string,
  ctx: GovContext,
  options: {
    inputFile?: FileLike | null;
    inputFiles?: FileLike[] | null;
    inputText?: string;
  } = {}
): Promise<{ success: boolean; output: string[]; error?: string; output_files?: GovOutputFile[] }> {
  const logLines: string[] = [];
  const outputFiles: GovOutputFile[] = [];
  const gov = createGovHelper(ctx, logLines, outputFiles);

  const inputFiles =
    options.inputFiles && options.inputFiles.length > 0
      ? options.inputFiles
      : options.inputFile
        ? [options.inputFile]
        : [];
  const inputFile = inputFiles[0] || null;

  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction(
      'gov',
      'INPUT_FILE',
      'INPUT_TEXT',
      'XLSX',
      'Papa',
      'mammoth',
      'PizZip',
      'Docxtemplater',
      'INPUT_FILES',
      code
    );

    await fn(
      gov,
      inputFile,
      options.inputText || '',
      XLSX,
      Papa,
      mammoth,
      PizZip,
      Docxtemplater,
      inputFiles
    );

    return { success: true, output: logLines, output_files: outputFiles.length ? outputFiles : undefined };
  } catch (error: any) {
    return {
      success: false,
      output: logLines,
      error: error.message || String(error),
      output_files: outputFiles.length ? outputFiles : undefined
    };
  }
}
