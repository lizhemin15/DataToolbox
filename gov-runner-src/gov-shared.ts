import * as XLSX from 'xlsx';

/**
 * GovHelper 接口定义 - 前后端共享
 * 用于类型检查和 API 文档生成
 */
export interface GovHelperInterface {
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
  parseFilename(name: string, options?: { datePattern?: RegExp }): { unit: string; date: string };
  parseWordStructure(file: FileLike, options?: { maxTextLength?: number }): Promise<{
    title: string;
    sections: Array<{ level: number; title: string; paragraphs: string[] }>;
    tables: any[];
    rawText: string;
  }>;
}

/**
 * 通用文件接口（浏览器和 Node.js 通用）
 */
export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

import * as XLSX from 'xlsx';
import PizZip from 'pizzip';

// ==================== 纯函数：Excel 处理 ====================

export function govExcelCellForValue(val: unknown): XLSX.CellObject | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' && !isNaN(val)) return { t: 'n', v: val };
  if (val instanceof Date) return { t: 'd', v: val };
  if (typeof val === 'boolean') return { t: 'b', v: val };
  return { t: 's', v: String(val) };
}

export function govExpandSheetRef(XLSX: typeof import('xlsx'), ws: XLSX.WorkSheet) {
  let maxR = 0;
  let maxC = 0;
  let has = false;
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    try {
      const cell = XLSX.utils.decode_cell(k);
      has = true;
      maxR = Math.max(maxR, cell.r);
      maxC = Math.max(maxC, cell.c);
    } catch {
      /* ignore */
    }
  }
  if (has) {
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  }
}

export function govApplyCellMapToSheet(XLSX: typeof import('xlsx'), ws: XLSX.WorkSheet, cellMap: Record<string, unknown>) {
  for (const [addr, val] of Object.entries(cellMap)) {
    if (!addr || addr[0] === '!') continue;
    try {
      XLSX.utils.decode_cell(addr);
    } catch {
      continue;
    }
    const cellObj = govExcelCellForValue(val);
    if (cellObj === null) delete (ws as Record<string, unknown>)[addr];
    else (ws as Record<string, XLSX.CellObject>)[addr] = cellObj;
  }
  govExpandSheetRef(XLSX, ws);
}

export function govDataIsFlatCellMap(XLSX: typeof import('xlsx'), data: Record<string, unknown>): boolean {
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  return keys.every((k) => {
    if (typeof k !== 'string') return false;
    try {
      XLSX.utils.decode_cell(k);
      return true;
    } catch {
      return false;
    }
  });
}

export function govCsvEscapeCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ==================== 纯函数：Word 文档解析 ====================

export function govParseWordStructure(text: string, options: { maxTextLength?: number } = {}): {
  title: string;
  sections: Array<{ level: number; title: string; paragraphs: string[] }>;
  tables: any[];
  rawText: string;
} {
  const maxLen = options.maxTextLength || 50000;
  const truncatedText = text.length > maxLen ? text.slice(0, maxLen) : text;

  // 公文标题正则模式
  const titlePatterns = [
    /^[一二三四五六七八九十]+、[^\n]+/,
    /^（[一二三四五六七八九十]+）[^\n]+/,
    /^\d+[\.、．：][^\n]+/,
    /^（\d+）[^\n]+/,
    /^[（\(][一二三四五六七八九十\d]+[）\)][^\n]+/,
    /^第[一二三四五六七八九十\d]+章[^\n]*/,
    /^第[一二三四五六七八九十\d]+条[^\n]*/,
    /^[•●○◆■★][\s　][^\n]+/,
    /^[\u25A0\u25B2\u25CB\u25CF][\s　][^\n]+/,
    /^[\d]+\.[\s　]+[^\n]+/,
    /^[\\(（]?[a-zA-Z0-9]+[\\)）]?[\.、：\s　]+[^\n]+/
  ];

  const lines = truncatedText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const sections: Array<{ level: number; title: string; paragraphs: string[] }> = [];
  let currentSection: { level: number; title: string; paragraphs: string[] } | null = null;
  let title = '';

  // 识别文档标题
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i];
    if (line && line.length > 2 && line.length < 100) {
      let isChapterTitle = false;
      for (const pattern of titlePatterns) {
        if (pattern.test(line)) {
          isChapterTitle = true;
          break;
        }
      }
      if (!isChapterTitle) {
        title = line;
        break;
      }
    }
  }

  // 解析章节
  for (const line of lines) {
    if (!line) continue;

    // 一级标题：一、二、三、
    const m1 = line.match(/^([一二三四五六七八九十]+)、(.*)$/);
    if (m1) {
      if (currentSection) sections.push(currentSection);
      currentSection = { level: 1, title: `${m1[1]}、${(m1[2] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }

    // 二级标题：（一）（二）
    const m2 = line.match(/^（([一二三四五六七八九十]+)）(.*)$/);
    if (m2) {
      if (currentSection) sections.push(currentSection);
      currentSection = { level: 2, title: `（${m2[1]}）${(m2[2] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }

    // 三级标题：1. 2.
    const m3 = line.match(/^(\d+)([\.、．])(.*)$/);
    if (m3) {
      if (currentSection) sections.push(currentSection);
      currentSection = { level: 3, title: `${m3[1]}${m3[2]}${(m3[3] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }

    // 四级标题：（1）（2）
    const m4 = line.match(/^（(\d+)）(.*)$/);
    if (m4) {
      if (currentSection) sections.push(currentSection);
      currentSection = { level: 4, title: `（${m4[1]}）${(m4[2] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }

    // 第一章、第二章
    const mChapter = line.match(/^第(\d+)章[：:\s]*(.*)$/);
    if (mChapter) {
      if (currentSection) sections.push(currentSection);
      currentSection = { level: 1, title: `第${mChapter[1]}章 ${(mChapter[2] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }

    // 第1条、第2条
    const mArticle = line.match(/^第(\d+)条[：:\s]*(.*)$/);
    if (mArticle) {
      if (currentSection) sections.push(currentSection);
      currentSection = { level: 1, title: `第${mArticle[1]}条 ${(mArticle[2] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }

    if (currentSection) {
      currentSection.paragraphs.push(line);
    }
  }

  if (currentSection) sections.push(currentSection);

  return { title, sections, tables: [], rawText: truncatedText };
}

// ==================== 纯函数：文件名解析 ====================

export function govParseFilename(name: string, options: { datePattern?: RegExp } = {}): { unit: string; date: string } {
  if (!name || typeof name !== 'string') return { unit: '', date: '' };
  
  const base = name.replace(/\.(docx?|DOCX?)$/i, '');
  const datePattern = options.datePattern || /^(\d{4})年(\d{1,2})月(\d{1,2})日/;
  const m = base.match(datePattern);
  
  if (m) {
    return {
      unit: base.replace(datePattern, '').replace(/日报$/, '').trim() || base,
      date: `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
    };
  }
  
  const mdMatch = base.match(/^(\d{1,2})月(\d{1,2})日/);
  if (mdMatch) {
    return {
      unit: base.replace(/^(\d{1,2})月(\d{1,2})日/, '').replace(/日报$/, '').trim() || base,
      date: `${parseInt(mdMatch[1])}月${parseInt(mdMatch[2])}日`
    };
  }
  
  return { unit: base.replace(/日报$/, '').trim() || base, date: '' };
}

// ==================== 导出为浏览器全局对象 ====================

// 检测是否在浏览器环境
if (typeof window !== 'undefined') {
  (window as any).GOV_Shared = {
    govExcelCellForValue,
    govExpandSheetRef,
    govApplyCellMapToSheet,
    govDataIsFlatCellMap,
    govCsvEscapeCell,
    govParseWordStructure,
    govParseFilename,
  };
}
