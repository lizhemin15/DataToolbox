/**
 * 数据治理任务执行器（后端版）
 * 从浏览器端 script.js 移植，去掉 DOM 依赖
 */

import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';
import * as mammoth from 'mammoth';

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

export interface GovHelper {
  log(msg: string): void;
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
}

/**
 * 创建治理助手（后端版）
 */
export function createGovHelper(ctx: GovContext, logLines: string[]): GovHelper {
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

  return {
    log(msg: string) {
      logLines.push(String(msg));
    },

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
      // Node/Bun 版 mammoth 使用 buffer 字段
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
    inputText?: string;
  } = {}
): Promise<{ success: boolean; output: string[]; error?: string }> {
  const logLines: string[] = [];
  const gov = createGovHelper(ctx, logLines);

  try {
    // 使用 AsyncFunction 执行用户代码（与浏览器版一致）
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction(
      'gov', 
      'INPUT_FILE', 
      'INPUT_TEXT', 
      'XLSX', 
      'Papa', 
      'mammoth', 
      code
    );
    
    await fn(
      gov, 
      options.inputFile || null, 
      options.inputText || '', 
      XLSX, 
      Papa, 
      mammoth
    );

    return { success: true, output: logLines };
  } catch (error: any) {
    return { 
      success: false, 
      output: logLines, 
      error: error.message || String(error) 
    };
  }
}
