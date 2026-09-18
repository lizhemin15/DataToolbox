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
  readWordTables(file: FileLike): Promise<Array<{ rows: string[][]; colWidths?: number[]; style?: any }>>;
  word(): GovWordBuilder;
  buildWordTables(filename: string, opts: any): Promise<string>;
  writeExcel(filename: string, data: any, options?: {
    sheetName?: string;
    columnWidths?: number[] | Record<string, number>;
    rowHeights?: number[] | Record<number, number>;
    merges?: string[];
    freeze?: string;
    autofilter?: string;
    styles?: Record<string, any>;
  }): void;
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

/**
 * ⚠️ DEPRECATED: 此简化版缺少 splitInlineTitleContent、buildTree、sectionsFlat 等功能，
 * 与前端 script-ontology.js / runner.ts 中内联的完整版严重不一致。
 * 请使用 runner.ts 中的 parseWordStructure（内联完整版）或前端 script-ontology.js 的版本。
 * 此函数保留仅为向后兼容，不建议新代码使用。
 */
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

// ==================== 纯函数：docx 表格解析 ====================

function govDecodeXmlEntities(s: string): string {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

function govTagAttr(tag: string, name: string): string {
  const m = String(tag).match(new RegExp(name + '="([^"]*)"'));
  return m ? govDecodeXmlEntities(m[1] as string) : '';
}

function govParseTableCellMeta(tcXml: string): any {
  const meta: any = {};
  const shd = tcXml.match(/<w:shd\b[^>]*w:fill="([^"]+)"/);
  if (shd && shd[1] && shd[1] !== 'auto') meta.fill = shd[1];
  // 加粗：<w:b/> 或 <w:b w:val="1|true"/>
  const b = tcXml.match(/<w:b\b([^>]*)\/?>/);
  if (b) {
    const v = govTagAttr(b[0], 'w:val');
    if (!v || v === '1' || v === 'true') meta.bold = true;
  }
  const rf = tcXml.match(/<w:rFonts\b[^>]*\/?>/);
  if (rf) meta.fontName = govTagAttr(rf[0], 'w:eastAsia') || govTagAttr(rf[0], 'w:ascii') || '';
  const sz = tcXml.match(/<w:sz\b[^>]*w:val="(\d+)"/);
  if (sz) meta.fontSize = parseInt(sz[1] as string, 10) / 2;
  const jc = tcXml.match(/<w:jc\b[^>]*w:val="([^"]+)"/);
  if (jc) meta.align = jc[1];
  const va = tcXml.match(/<w:vAlign\b[^>]*w:val="([^"]+)"/);
  if (va) meta.valign = va[1];
  return meta;
}

function govParseTableBorder(tblXml: string): any {
  const block = tblXml.match(/<w:tblBorders\b[^>]*>([\s\S]*?)<\/w:tblBorders>/);
  const src = block ? block[1] : tblXml;
  const re = /<w:(top|left|bottom|right|insideH|insideV|inside)\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src as string)) !== null) {
    const tag = m[0];
    const val = govTagAttr(tag, 'w:val');
    if (!val || val === 'none' || val === 'nil') continue;
    return {
      style: val,
      size: parseInt(govTagAttr(tag, 'w:sz') || '4', 10),
      color: govTagAttr(tag, 'w:color') || 'auto'
    };
  }
  // 单元格边框兜底
  const tc = tblXml.match(/<w:tcBorders\b[^>]*>([\s\S]*?)<\/w:tcBorders>/);
  if (tc) {
    const m2 = (tc[1] as string).match(/<w:(top|left|bottom|right)\b[^>]*\/?>/);
    if (m2) {
      const val = govTagAttr(m2[0], 'w:val');
      if (val && val !== 'none' && val !== 'nil') {
        return { style: val, size: parseInt(govTagAttr(m2[0], 'w:sz') || '4', 10), color: govTagAttr(m2[0], 'w:color') || 'auto' };
      }
    }
  }
  return undefined;
}

/**
 * 读取 docx 的 word/document.xml，解析其中所有表格：
 * 单元格文本 + 列宽 + 可复用的样式信息（边框/底纹/字体/字号/对齐/表头样式）。
 * 返回 [{ rows: string[][], colWidths?: number[], style?: object }]
 */
export function govParseDocxTables(xml: string): any[] {
  const tables: any[] = [];
  if (!xml || typeof xml !== 'string') return tables;
  const tblRe = /<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tblRe.exec(xml)) !== null) {
    const tblXml = tm[1] as string;
    const colWidths: number[] = [];
    const gcRe = /<w:gridCol\b[^>]*w:w="(\d+)"/g;
    let gm: RegExpExecArray | null;
    while ((gm = gcRe.exec(tblXml)) !== null) colWidths.push(parseInt(gm[1] as string, 10));

    const rows: string[][] = [];
    const rowMeta: any[][] = [];
    const trRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
    let rm: RegExpExecArray | null;
    while ((rm = trRe.exec(tblXml)) !== null) {
      const trXml = rm[1] as string;
      const cells: string[] = [];
      const meta: any[] = [];
      const tcRe = /<w:tc>([\s\S]*?)<\/w:tc>/g;
      let cm: RegExpExecArray | null;
      while ((cm = tcRe.exec(trXml)) !== null) {
        const tcXml = cm[1] as string;
        let text = '';
        const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
        let txt: RegExpExecArray | null;
        while ((txt = tRe.exec(tcXml)) !== null) text += govDecodeXmlEntities(txt[1] as string);
        cells.push(text);
        meta.push(govParseTableCellMeta(tcXml));
      }
      rows.push(cells);
      rowMeta.push(meta);
    }
    if (!rows.length) continue;

    const style: any = {};
    const border = govParseTableBorder(tblXml);
    if (border) style.border = border;
    const head = rowMeta[0] || [];
    const body = (rowMeta[1] || rowMeta[0] || []);
    const headFirst = head[0] || {};
    const bodyFirst = body[0] || {};
    if (headFirst.fill) style.headFill = headFirst.fill;
    if (headFirst.bold) style.headBold = true;
    if (bodyFirst.fill) style.fill = bodyFirst.fill;
    if (bodyFirst.fontName) style.fontName = bodyFirst.fontName;
    if (bodyFirst.fontSize) style.fontSize = bodyFirst.fontSize;
    const alignSrc = bodyFirst.align || headFirst.align;
    if (alignSrc) style.align = alignSrc;
    const valignSrc = bodyFirst.valign || headFirst.valign;
    if (valignSrc) style.valign = valignSrc;
    if (colWidths.length) style.colWidths = colWidths.slice();

    tables.push({
      rows,
      colWidths: colWidths.length ? colWidths.slice() : undefined,
      style: Object.keys(style).length ? style : undefined
    });
  }
  return tables;
}

// ==================== 纯函数：Excel 样式后处理 ====================

export function govNormalizeXlsxColor(c: unknown): string | null {
  if (!c) return null;
  const s = String(c).trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(s)) return 'FF' + s;
  if (/^[0-9A-F]{8}$/.test(s)) return s;
  return null;
}

function govXmlAttr(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 给 xlsx 二进制打补丁：写入单元格样式 + 冻结窗格。
 * SheetJS CE 会忽略 cell.s / !freeze，因此这里直接改写 xl/styles.xml、
 * 给 <c> 注入 s="N"，并往 <sheetView> 注入 <pane>。
 * spec: { sheets: { [sheetName]: { freeze?: 'A2', cells?: { 'A1'|'A1:C1': styleObj } } } }
 */
export function govApplyXlsxStyles(PizZipCtor: any, bytes: any, spec: any): any {
  if (!spec || !spec.sheets) return bytes;
  const zip = new PizZipCtor(bytes);
  const stylesEntry = zip.file('xl/styles.xml');
  if (!stylesEntry) return bytes;
  let stylesXml: string = stylesEntry.asText();

  function extractBlock(tag: string): string {
    const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>');
    const m = stylesXml.match(re);
    return m ? (m[1] as string) : '';
  }
  function splitEntries(inner: string, entryTag: string): string[] {
    const re = new RegExp('<' + entryTag + '(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</' + entryTag + '>)', 'g');
    return inner.match(re) || [];
  }
  function appendToBlock(tag: string, xmls: string[]): void {
    if (!xmls.length) return;
    const openRe = new RegExp('<' + tag + '\\b([^>]*?)(/?)>');
    const m = stylesXml.match(openRe);
    if (!m) {
      stylesXml = stylesXml.replace('</styleSheet>', '<' + tag + ' count="' + xmls.length + '">' + xmls.join('') + '</' + tag + '></styleSheet>');
      return;
    }
    const start = (m.index as number) + m[0].length;
    if (m[2] === '/') {
      let attrs = (m[1] || '').replace(/count="\d+"/, 'count="' + xmls.length + '"');
      if (!/count="/.test(attrs)) attrs += ' count="' + xmls.length + '"';
      const repl = '<' + tag + attrs + '>' + xmls.join('') + '</' + tag + '>';
      stylesXml = stylesXml.slice(0, m.index) + repl + stylesXml.slice(start);
      return;
    }
    const closeIdx = stylesXml.indexOf('</' + tag + '>', start);
    let attrs = m[1] || '';
    attrs = /count="\d+"/.test(attrs)
      ? attrs.replace(/count="(\d+)"/, (_x, n) => 'count="' + (parseInt(n, 10) + xmls.length) + '"')
      : attrs + ' count="' + xmls.length + '"';
    const openNew = '<' + tag + attrs + '>';
    stylesXml = stylesXml.slice(0, m.index) + openNew + stylesXml.slice(start, closeIdx) + xmls.join('') + stylesXml.slice(closeIdx);
  }

  const fontEntries = splitEntries(extractBlock('fonts'), 'font');
  const fillEntries = splitEntries(extractBlock('fills'), 'fill');
  const borderEntries = splitEntries(extractBlock('borders'), 'border');
  const xfEntries = splitEntries(extractBlock('cellXfs'), 'xf');
  const numFmtEntries = splitEntries(extractBlock('numFmts'), 'numFmt');

  const newFonts: string[] = [], newFills: string[] = [], newBorders: string[] = [], newXfs: string[] = [], newNumFmts: string[] = [];
  const seenFont = new Map<string, number>(), seenFill = new Map<string, number>(), seenBorder = new Map<string, number>(), seenXf = new Map<string, number>(), seenFmt = new Map<string, number>();
  let nextFmtId = 164;
  for (const e of numFmtEntries) {
    const idm = e.match(/numFmtId="(\d+)"/);
    if (idm) nextFmtId = Math.max(nextFmtId, parseInt(idm[1] as string, 10) + 1);
  }

  function buildFontXml(font: any, st: any): string {
    const parts: string[] = [];
    if (font && font.bold || st.bold) parts.push('<b/>');
    if (font && font.italic || st.italic) parts.push('<i/>');
    if (font && font.underline || st.underline) parts.push('<u/>');
    const size = Number((font && font.size) || st.fontSize);
    if (size > 0) parts.push('<sz val="' + size + '"/>');
    const color = govNormalizeXlsxColor((font && font.color) || st.color);
    if (color) parts.push('<color rgb="' + color + '"/>');
    const name = (font && font.name) || st.fontName || '';
    if (name) parts.push('<name val="' + govXmlAttr(name) + '"/>');
    return parts.length ? '<font>' + parts.join('') + '</font>' : '';
  }
  function getFontId(st: any): number {
    const xml = buildFontXml(st.font || {}, st);
    if (!xml) return 0;
    if (seenFont.has(xml)) return seenFont.get(xml) as number;
    const id = fontEntries.length + newFonts.length;
    newFonts.push(xml);
    seenFont.set(xml, id);
    return id;
  }
  function buildFillXml(st: any): string {
    let color: string | null = null;
    if (typeof st.fill === 'string') color = govNormalizeXlsxColor(st.fill);
    else if (st.fill) color = govNormalizeXlsxColor(st.fill.fgColor || st.fill.color || st.fill.startColor);
    else color = govNormalizeXlsxColor(st.bgColor);
    if (!color) return '';
    return '<fill><patternFill patternType="solid"><fgColor rgb="' + color + '"/><bgColor indexed="64"/></patternFill></fill>';
  }
  function getFillId(st: any): number {
    const xml = buildFillXml(st);
    if (!xml) return 0;
    if (seenFill.has(xml)) return seenFill.get(xml) as number;
    const id = fillEntries.length + newFills.length;
    newFills.push(xml);
    seenFill.set(xml, id);
    return id;
  }
  function buildBorderXml(st: any): string {
    const b = st.border;
    if (!b) return '';
    const style = b.style || 'thin';
    const color = govNormalizeXlsxColor(b.color) || 'FF000000';
    const side = (tag: string) => '<' + tag + ' style="' + govXmlAttr(style) + '"><color rgb="' + color + '"/></' + tag + '>';
    return '<border>' + side('left') + side('right') + side('top') + side('bottom') + '<diagonal/></border>';
  }
  function getBorderId(st: any): number {
    const xml = buildBorderXml(st);
    if (!xml) return 0;
    if (seenBorder.has(xml)) return seenBorder.get(xml) as number;
    const id = borderEntries.length + newBorders.length;
    newBorders.push(xml);
    seenBorder.set(xml, id);
    return id;
  }
  function getFmtId(st: any): number {
    const code = st.numFmt;
    if (!code) return 0;
    for (const e of numFmtEntries) {
      const cm = e.match(/formatCode="([^"]*)"/);
      if (cm && govDecodeXmlEntities(cm[1] as string) === code) {
        const idm = e.match(/numFmtId="(\d+)"/);
        if (idm) return parseInt(idm[1] as string, 10);
      }
    }
    if (seenFmt.has(code)) return seenFmt.get(code) as number;
    const id = nextFmtId++;
    newNumFmts.push('<numFmt numFmtId="' + id + '" formatCode="' + govXmlAttr(code) + '"/>');
    seenFmt.set(code, id);
    return id;
  }
  function getXfId(st: any): number {
    const fontId = getFontId(st);
    const fillId = getFillId(st);
    const borderId = getBorderId(st);
    const numFmtId = getFmtId(st);
    const al = st.alignment || {};
    const horiz = al.horizontal || st.align;
    const vert = al.vertical || st.valign;
    const wrap = al.wrapText || st.wrap;
    const alignParts: string[] = [];
    if (horiz) alignParts.push('horizontal="' + govXmlAttr(horiz) + '"');
    if (vert) alignParts.push('vertical="' + govXmlAttr(vert) + '"');
    if (wrap) alignParts.push('wrapText="1"');
    const attrs = 'numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0"'
      + (fontId ? ' applyFont="1"' : '')
      + (fillId ? ' applyFill="1"' : '')
      + (borderId ? ' applyBorder="1"' : '')
      + (numFmtId ? ' applyNumberFormat="1"' : '')
      + (alignParts.length ? ' applyAlignment="1"' : '');
    const xml = alignParts.length
      ? '<xf ' + attrs + '><alignment ' + alignParts.join(' ') + '/></xf>'
      : '<xf ' + attrs + '/>';
    if (seenXf.has(xml)) return seenXf.get(xml) as number;
    const id = xfEntries.length + newXfs.length;
    newXfs.push(xml);
    seenXf.set(xml, id);
    return id;
  }

  function parseAddr(a: unknown): { r: number; c: number; ref: string } | null {
    const m = String(a || '').toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m) return null;
    let c = 0;
    for (const ch of m[1] as string) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { r: parseInt(m[2] as string, 10), c: c - 1, ref: (m[1] as string) + m[2] };
  }
  function colName(c: number): string {
    let s = '', n = c + 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function expandRefs(ref: unknown): string[] {
    const m = String(ref || '').toUpperCase().match(/^([A-Z]+\d+)(?::([A-Z]+\d+))?$/);
    if (!m) return [];
    const a = parseAddr(m[1]);
    const b = m[2] ? parseAddr(m[2]) : a;
    if (!a || !b) return [];
    const out: string[] = [];
    for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) out.push(colName(c) + r);
    return out;
  }

  function sheetPathForName(name: string): string | null {
    const wbXml = (zip.file('xl/workbook.xml') || { asText: () => '' }).asText();
    const relsXml = (zip.file('xl/_rels/workbook.xml.rels') || { asText: () => '' }).asText();
    const relMap: Record<string, string> = {};
    const relRe = /<Relationship\b[^>]*\/>/g;
    let rm: RegExpExecArray | null;
    while ((rm = relRe.exec(relsXml)) !== null) {
      const id = govTagAttr(rm[0], 'Id');
      let tgt = govTagAttr(rm[0], 'Target');
      if (id && tgt) {
        tgt = tgt.replace(/^\//, '');
        relMap[id] = tgt.indexOf('xl/') === 0 ? tgt : 'xl/' + tgt;
      }
    }
    const shRe = /<sheet\b[^>]*\/>/g;
    let sm: RegExpExecArray | null;
    while ((sm = shRe.exec(wbXml)) !== null) {
      const nm = govTagAttr(sm[0], 'name');
      const rid = govTagAttr(sm[0], 'r:id');
      if (nm === name && relMap[rid]) return relMap[rid] as string;
    }
    return null;
  }

  function applyCell(sheetXml: string, ref: string, xfId: number): string {
    const info = parseAddr(ref);
    if (!info) return sheetXml;
    const cellRe = new RegExp('<c r="' + info.ref + '"([^>]*?)(/?)>');
    const m = sheetXml.match(cellRe);
    if (m) {
      const attrs = (m[1] as string).replace(/\s+s="[^"]*"/, '');
      return sheetXml.replace(m[0], '<c r="' + info.ref + '" s="' + xfId + '"' + attrs + m[2] + '>');
    }
    const rowRe = new RegExp('<row r="' + info.r + '"([^>]*?)>([\\s\\S]*?)</row>');
    const rw = sheetXml.match(rowRe);
    if (!rw) return sheetXml;
    const inner = rw[2] as string;
    let insertAt = inner.length;
    const cRe = /<c r="([A-Z]+)\d+"/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(inner)) !== null) {
      const ci = parseAddr((cm[1] as string) + '1');
      if (ci && ci.c > info.c) { insertAt = cm.index as number; break; }
    }
    const newCell = '<c r="' + info.ref + '" s="' + xfId + '"/>';
    const newInner = inner.slice(0, insertAt) + newCell + inner.slice(insertAt);
    return sheetXml.replace(rw[0], '<row r="' + info.r + '"' + rw[1] + '>' + newInner + '</row>');
  }

  function applyFreeze(sheetXml: string, ref: string): string {
    const info = parseAddr(ref);
    if (!info) return sheetXml;
    const xSplit = info.c, ySplit = Math.max(0, info.r - 1);
    if (!xSplit && !ySplit) return sheetXml;
    const activePane = ySplit > 0 ? (xSplit > 0 ? 'bottomRight' : 'bottomLeft') : 'topRight';
    const pane = '<pane' + (xSplit ? ' xSplit="' + xSplit + '"' : '') + (ySplit ? ' ySplit="' + ySplit + '"' : '')
      + ' topLeftCell="' + info.ref + '" activePane="' + activePane + '" state="frozen"/>';
    const sel = '<selection pane="' + activePane + '" activeCell="' + info.ref + '" sqref="' + info.ref + '"/>';
    const svRe = /<sheetView\b([^>]*?)(\/?)>/;
    const m = sheetXml.match(svRe);
    if (!m) return sheetXml;
    const start = (m.index as number) + m[0].length;
    if (m[2] === '/') return sheetXml.slice(0, m.index) + '<sheetView' + m[1] + '>' + pane + sel + '</sheetView>' + sheetXml.slice(start);
    return sheetXml.slice(0, start) + pane + sel + sheetXml.slice(start);
  }

  let anyChange = false;
  for (const [sheetName, sheetSpec] of Object.entries<any>(spec.sheets)) {
    if (!sheetSpec) continue;
    const path = sheetPathForName(sheetName);
    if (!path) continue;
    const entry = zip.file(path);
    if (!entry) continue;
    let sheetXml: string = entry.asText();
    if (sheetSpec.cells) {
      const keys = Object.keys(sheetSpec.cells);
      // 区域键（含 ':'）先应用，单元格键后应用可覆盖区域样式
      keys.sort((a, b) => (a.indexOf(':') >= 0 ? 0 : 1) - (b.indexOf(':') >= 0 ? 0 : 1));
      const merged: Record<string, any> = {};
      for (const key of keys) {
        const st = sheetSpec.cells[key];
        if (!st || typeof st !== 'object') continue;
        for (const ref of expandRefs(key)) {
          merged[ref] = Object.assign({}, merged[ref] || {}, st);
        }
      }
      for (const [ref, st] of Object.entries(merged)) {
        sheetXml = applyCell(sheetXml, ref, getXfId(st));
      }
    }
    if (sheetSpec.freeze) sheetXml = applyFreeze(sheetXml, sheetSpec.freeze);
    zip.file(path, sheetXml);
    anyChange = true;
  }
  if (!anyChange) return bytes;

  appendToBlock('numFmts', newNumFmts);
  appendToBlock('fonts', newFonts);
  appendToBlock('fills', newFills);
  appendToBlock('borders', newBorders);
  appendToBlock('cellXfs', newXfs);
  zip.file('xl/styles.xml', stylesXml);
  return zip.generate({ type: 'uint8array' });
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

// ==================== 纯函数：富文本解析（前后端共享） ====================

const GOV_DOCX_NAMED_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '00B050', blue: '0000FF',
  yellow: 'FFFF00', orange: 'FFA500', purple: '800080', gray: '808080', grey: '808080',
  pink: 'FFC0CB', brown: 'A52A2A', cyan: '00FFFF', magenta: 'FF00FF', gold: 'FFD700',
};

/** 颜色值归一化为 docx 可用的 6 位大写十六进制（支持 #RGB/#RRGGBB/命名色） */
export function govNormalizeDocxColor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (GOV_DOCX_NAMED_COLORS[lower]) return GOV_DOCX_NAMED_COLORS[lower];
  s = s.replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) return s.split('').map((c) => c + c).join('').toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  return null;
}

export interface GovRichLine {
  text: string;
  indent: boolean;
  bold: Array<[number, number]>;
  italic: Array<[number, number]>;
  underline: Array<[number, number]>;
  colors: Array<[number, number, string]>;
  fonts: Array<[number, number, string, number]>;
}

/**
 * 解析单行富文本（前后端共享，浏览器/服务端行为一致）
 * 支持：**加粗**、*斜体*、__下划线__、>首行缩进、[f:字体,s:字号]、[c:颜色]
 * 返回的 bold/italic/underline/colors/fonts 均为「去标记后文本」的下标区间。
 */
export function govParseRichLine(line: string, defaultFont?: { name: string; size: number } | null): GovRichLine {
  const df = defaultFont || { name: '仿宋_GB2312', size: 16 };
  const chars: Array<{
    ch: string; bold: boolean; italic: boolean; underline: boolean;
    color: string | null; fontName: string | null; fontSize: number | null;
  }> = [];
  const src = typeof line === 'string' ? line : String(line ?? '');
  let indent = false;
  let start = 0;
  if (src.startsWith('>')) { indent = true; start = 1; }

  type SpanStyle = {
    bold?: boolean; italic?: boolean; underline?: boolean;
    color?: string | null; fontName?: string | null; fontSize?: number | null;
  };

  function parseSpan(text: string, inherited: SpanStyle, out: typeof chars): void {
    let idx = 0;
    let buf = '';
    let color: string | null = inherited.color ?? null;
    let fontName: string | null = inherited.fontName ?? null;
    let fontSize: number | null = inherited.fontSize ?? null;
    const flush = () => {
      if (!buf) return;
      for (const ch of buf) {
        out.push({
          ch,
          bold: !!inherited.bold,
          italic: !!inherited.italic,
          underline: !!inherited.underline,
          color, fontName, fontSize,
        });
      }
      buf = '';
    };
    while (idx < text.length) {
      const rest = text.slice(idx);
      let m: RegExpExecArray | null;
      if ((m = /^\[f:([^,\]]+),s:(\d+)\]/.exec(rest))) {
        flush();
        fontName = m[1].trim();
        fontSize = parseInt(m[2], 10);
        idx += m[0].length;
        continue;
      }
      if ((m = /^\[c:([^\]]+)\]/.exec(rest))) {
        flush();
        color = govNormalizeDocxColor(m[1]);
        idx += m[0].length;
        continue;
      }
      if (text.startsWith('**', idx)) {
        const end = text.indexOf('**', idx + 2);
        if (end !== -1) {
          flush();
          parseSpan(text.slice(idx + 2, end), { bold: true, italic: inherited.italic, underline: inherited.underline, color, fontName, fontSize }, out);
          idx = end + 2;
          continue;
        }
        idx += 2;
        continue;
      }
      if (text.startsWith('__', idx)) {
        const end = text.indexOf('__', idx + 2);
        if (end !== -1) {
          flush();
          parseSpan(text.slice(idx + 2, end), { bold: inherited.bold, italic: inherited.italic, underline: true, color, fontName, fontSize }, out);
          idx = end + 2;
          continue;
        }
        idx += 2;
        continue;
      }
      if (text[idx] === '*') {
        const end = text.indexOf('*', idx + 1);
        if (end !== -1) {
          flush();
          parseSpan(text.slice(idx + 1, end), { bold: inherited.bold, italic: true, underline: inherited.underline, color, fontName, fontSize }, out);
          idx = end + 1;
          continue;
        }
        buf += text[idx];
        idx++;
        continue;
      }
      buf += text[idx];
      idx++;
    }
    flush();
  }

  parseSpan(src.slice(start), { fontName: df.name, fontSize: df.size }, chars);

  const text = chars.map((c) => c.ch).join('');
  function rangesFor(pred: (c: typeof chars[number]) => boolean): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let s = -1;
    for (let k = 0; k < chars.length; k++) {
      if (pred(chars[k])) { if (s < 0) s = k; }
      else if (s >= 0) { out.push([s, k]); s = -1; }
    }
    if (s >= 0) out.push([s, chars.length]);
    return out;
  }

  const colors: Array<[number, number, string]> = [];
  {
    let s = -1;
    let cur: string | null = null;
    for (let k = 0; k < chars.length; k++) {
      const c = chars[k].color || null;
      if (c !== cur) {
        if (s >= 0 && cur) colors.push([s, k, cur]);
        s = k;
        cur = c;
      }
    }
    if (s >= 0 && cur) colors.push([s, chars.length, cur]);
  }

  const fonts: Array<[number, number, string, number]> = [];
  {
    let s = -1;
    let curName: string | null = null;
    let curSize: number | null = null;
    for (let k = 0; k < chars.length; k++) {
      const cn = chars[k].fontName;
      const cs = chars[k].fontSize;
      if (!cn || cn !== curName || cs !== curSize) {
        if (s >= 0 && curName) fonts.push([s, k, curName, curSize as number]);
        if (cn) { s = k; curName = cn; curSize = cs; } else { s = -1; curName = null; curSize = null; }
      }
    }
    if (s >= 0 && curName) fonts.push([s, chars.length, curName, curSize as number]);
  }

  return {
    text,
    indent,
    bold: rangesFor((c) => c.bold),
    italic: rangesFor((c) => c.italic),
    underline: rangesFor((c) => c.underline),
    colors,
    fonts,
  };
}

// ==================== 纯函数：Word 文档构建器（前后端共享） ====================

export interface GovWordBuilder {
  heading(text: string, level?: number): GovWordBuilder;
  paragraph(text: string, opts?: any): GovWordBuilder;
  table(rows: any[][], opts?: any): GovWordBuilder;
  tableFromTemplate(templateStyle: any, rows: any[][]): GovWordBuilder;
  build(): any;
  save(filename: string): Promise<string>;
}

export interface GovWordBuilderHooks {
  pack: (doc: any) => Promise<any> | any;
  sink: (filename: string, bytes: any) => Promise<void> | void;
  log?: (msg: string) => void;
}

/**
 * 创建链式 Word 构建器。两端传入各自环境下的 docx 对象与打包/落盘钩子，
 * 保证方法签名与生成结构完全一致。
 */
export function govCreateWordBuilder(docx: any, hooks: GovWordBuilderHooks): GovWordBuilder {
  if (!docx || !docx.Document) throw new Error('docx 库未就绪，无法创建 Word 构建器');
  const B = docx.BorderStyle || {};
  const A = docx.AlignmentType || {};
  const H = docx.HeadingLevel || {};
  const S = docx.ShadingType || {};
  const VA = docx.VerticalAlign || {};
  const WT = docx.WidthType || {};
  const HR = docx.HeightRule || {};
  const UT = docx.UnderlineType || {};
  const TL = docx.TableLayoutType || {};
  const children: any[] = [];

  function borderStyle(v: any) {
    if (!v) return B.SINGLE;
    const key = String(v).toUpperCase().replace(/[-\s]/g, '_');
    return B[key] || B.SINGLE;
  }
  function alignValue(a: any) {
    switch (String(a || '').toLowerCase()) {
      case 'center': return A.CENTER;
      case 'right': return A.RIGHT;
      case 'both': case 'justify': case 'justified': return A.JUSTIFIED;
      case 'left': return A.LEFT;
      default: return undefined;
    }
  }
  function valignValue(v: any) {
    switch (String(v || '').toLowerCase()) {
      case 'center': case 'middle': return VA.CENTER;
      case 'bottom': return VA.BOTTOM;
      case 'top': return VA.TOP;
      default: return undefined;
    }
  }
  function makeBorders(spec: any) {
    const b = spec || {};
    const style = borderStyle(b.style || 'single');
    const size = typeof b.size === 'number' ? b.size : 4;
    const color = govNormalizeDocxColor(b.color) || '000000';
    const side = { style, size, color };
    return { top: side, bottom: side, left: side, right: side, insideHorizontal: side, insideVertical: side };
  }
  function makeRun(text: any, st: any) {
    const s = st || {};
    const f = s.font || {};
    const runOpts: any = { text: text === null || text === undefined ? '' : String(text) };
    const fontName = f.name || s.fontName;
    if (fontName) runOpts.font = fontName;
    const sizePt = Number(f.size || s.fontSize);
    if (sizePt > 0) runOpts.size = sizePt * 2;
    if (s.bold || f.bold) runOpts.bold = true;
    if (s.italic || f.italic) runOpts.italics = true;
    if (s.underline || f.underline) runOpts.underline = { type: UT.SINGLE || 'single' };
    const color = govNormalizeDocxColor(f.color || s.color);
    if (color) runOpts.color = color;
    return new docx.TextRun(runOpts);
  }
  function parseMerges(merges: any) {
    const info: Record<string, { rowSpan?: number; colSpan?: number; skip?: boolean }> = {};
    if (!Array.isArray(merges)) return info;
    for (const item of merges) {
      const mm = String(item).match(/^(\d+)\s*,\s*(\d+)\s*-\s*(\d+)\s*,\s*(\d+)$/);
      if (!mm) continue;
      const r1 = parseInt(mm[1], 10), c1 = parseInt(mm[2], 10);
      const r2 = parseInt(mm[3], 10), c2 = parseInt(mm[4], 10);
      const rowSpan = r2 - r1 + 1, colSpan = c2 - c1 + 1;
      if (rowSpan < 1 || colSpan < 1) continue;
      info[`${r1},${c1}`] = { rowSpan, colSpan };
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          if (r === r1 && c === c1) continue;
          info[`${r},${c}`] = { skip: true };
        }
      }
    }
    return info;
  }
  function resolveColWidths(colWidths: any): number[] | undefined {
    if (!colWidths) return undefined;
    let arr: any[];
    if (typeof colWidths === 'string') arr = colWidths.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    else if (Array.isArray(colWidths)) arr = colWidths.slice();
    else return undefined;
    if (!arr.length) return undefined;
    return arr.map((v) => {
      const s = String(v).replace('%', '').trim();
      const n = Number(s);
      return isNaN(n) ? 0 : n;
    });
  }
  function makeCell(text: any, opts: any) {
    const o = opts || {};
    const par: any = { children: [makeRun(text, { bold: o.bold, fontName: o.fontName, fontSize: o.fontSize })] };
    if (o.align) par.alignment = o.align;
    const cellOpts: any = { children: [new docx.Paragraph(par)] };
    if (o.colSpan && o.colSpan > 1) cellOpts.columnSpan = o.colSpan;
    if (o.rowSpan && o.rowSpan > 1) cellOpts.rowSpan = o.rowSpan;
    if (o.shading) cellOpts.shading = { type: S.CLEAR || 'clear', fill: o.shading, color: 'auto' };
    if (o.valign) cellOpts.verticalAlign = o.valign;
    return new docx.TableCell(cellOpts);
  }
  function buildTable(rows: any[][], style: any, opts: any) {
    const s = style || {};
    const o = Object.assign({}, s, opts || {});
    const rowsArr = Array.isArray(rows) ? rows : [];
    const colWidths = resolveColWidths(o.colWidths);
    const borderSpec = o.borders || s.border || { style: 'single', size: 4, color: '000000' };
    const align = alignValue(o.align);
    const valign = valignValue(o.valign);
    const merges = parseMerges(o.merges);
    const headFill = govNormalizeDocxColor(o.headFill) || undefined;
    const bodyFill = govNormalizeDocxColor(o.fill) || undefined;
    const headBold = o.headBold !== undefined ? !!o.headBold : !!o.header;
    const rowHeightPt = Number(o.rowHeight);
    const trs = rowsArr.map((row, ri) => {
      const isHead = ri === 0;
      const rowArr = Array.isArray(row) ? row : [row];
      const cells: any[] = [];
      for (let ci = 0; ci < rowArr.length; ci++) {
        const mk = merges[`${ri},${ci}`];
        if (mk && mk.skip) continue;
        cells.push(makeCell(rowArr[ci], {
          shading: isHead ? headFill : bodyFill,
          colSpan: mk && mk.colSpan,
          rowSpan: mk && mk.rowSpan,
          align,
          valign,
          fontName: o.fontName,
          fontSize: o.fontSize,
          bold: isHead ? headBold : false,
        }));
      }
      const rowOpts: any = { children: cells };
      if (isHead) rowOpts.tableHeader = true;
      if (rowHeightPt > 0) rowOpts.height = { value: Math.round(rowHeightPt * 20), rule: HR.ATLEAST || 'atLeast' };
      return new docx.TableRow(rowOpts);
    });
    const tableOpts: any = { rows: trs, width: { size: 100, type: WT.PERCENTAGE || 'pct' } };
    if (colWidths) {
      tableOpts.columnWidths = colWidths;
      if (TL.FIXED) tableOpts.layout = TL.FIXED;
    }
    if (borderSpec !== false) tableOpts.borders = makeBorders(borderSpec);
    return new docx.Table(tableOpts);
  }

  const builder: GovWordBuilder = {
    heading(text: string, level = 1) {
      const lvl = Math.min(Math.max(parseInt(String(level), 10) || 1, 1), 6);
      const key = `HEADING_${lvl}`;
      children.push(new docx.Paragraph({
        heading: H[key] || H.HEADING_1,
        children: [new docx.TextRun({ text: text === null || text === undefined ? '' : String(text) })],
      }));
      return builder;
    },
    paragraph(text: string, opts?: any) {
      const o = opts || {};
      const sizePt = Number(o.font && o.font.size) || 16;
      const parOpts: any = { children: [makeRun(text, o)] };
      const al = alignValue(o.align);
      if (al) parOpts.alignment = al;
      if (o.firstLineIndent) parOpts.indent = { firstLine: Math.round(Number(o.firstLineIndent) * sizePt * 20) };
      const spacing: any = {};
      if (o.lineSpacing) { spacing.line = Math.round(Number(o.lineSpacing) * 240); spacing.lineRule = 'auto'; }
      if (o.spaceBefore) spacing.before = Math.round(Number(o.spaceBefore) * 20);
      if (o.spaceAfter) spacing.after = Math.round(Number(o.spaceAfter) * 20);
      if (Object.keys(spacing).length) parOpts.spacing = spacing;
      children.push(new docx.Paragraph(parOpts));
      return builder;
    },
    table(rows: any[][], opts?: any) {
      const o = opts || {};
      children.push(buildTable(rows, o.template || {}, o));
      return builder;
    },
    tableFromTemplate(templateStyle: any, rows: any[][]) {
      children.push(buildTable(rows, templateStyle || {}, {}));
      return builder;
    },
    build() {
      return new docx.Document({ sections: [{ properties: {}, children: children.slice() }] });
    },
    async save(filename: string) {
      const base = filename || 'output.docx';
      const name = /\.docx$/i.test(base) ? base : `${base}.docx`;
      const bytes = await hooks.pack(builder.build());
      await hooks.sink(name, bytes);
      if (hooks.log) hooks.log(`已生成输出文件: ${name}`);
      return name;
    },
  };
  return builder;
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
    govParseDocxTables,
    govApplyXlsxStyles,
    govNormalizeXlsxColor,
    govParseRichLine,
    govNormalizeDocxColor,
    govCreateWordBuilder,
  };
}
