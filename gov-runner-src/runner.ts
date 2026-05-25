/**
 * 数据治理任务执行器（后端版）
 * 从浏览器端 script.js 移植，去掉 DOM 依赖
 */

import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';
import mammoth from 'mammoth';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { govApplyCellMapToSheet, govCsvEscapeCell, govDataIsFlatCellMap, govParseFilename, govParseWordStructure } from './gov-shared';

/**
 * 检查数据中是否包含格式标记（与前端 _hasFormatMarkers 一致）
 */
function hasFormatMarkers(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  for (const value of Object.values(data)) {
    if (typeof value === 'string') {
      if (value.includes('**') || value.startsWith('>') || value.includes('[f:')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 解析格式化文本语法（与前端 parseFormatText 一致）
 * 支持语法：
 *   **文字** - 加粗
 *   >文字 - 首行缩进 2 字符
 *   [f:字体,s:字号] - 指定字体和字号
 */
function parseFormatText(str: string, defaultFont: { name: string; size: number } | null = null): {
  text: string; bold: Array<[number, number]>; indent: boolean;
  fonts: Array<[number, number, string, number]>;
  defaultFont: { name: string; size: number };
} {
  if (typeof str !== 'string') return { text: String(str ?? ''), bold: [], indent: false, fonts: [], defaultFont: defaultFont || { name: '仿宋_GB2312', size: 16 } };

  let indent = false;
  let text = str;

  // 检测首行缩进语法（行首的 >）
  if (text.startsWith('>')) {
    indent = true;
    text = text.slice(1);
  }

  // 解析字体字号标记 [f:字体,s:字号]
  const fontMarkers: Array<{ markerStart: number; markerLength: number; fontName: string; fontSize: number; contentLength: number }> = [];
  const fontRegex = /\[f:([^,\]]+),s:(\d+)\]/g;
  let fontMatch;
  while ((fontMatch = fontRegex.exec(text)) !== null) {
    const fontName = fontMatch[1].trim();
    const fontSize = parseInt(fontMatch[2], 10);
    const markerStart = fontMatch.index;
    const markerLength = fontMatch[0].length;
    const afterMarker = text.slice(markerStart + markerLength);
    const nextMarker = afterMarker.search(/\[f:|$/);
    const contentLength = nextMarker === -1 ? afterMarker.length : nextMarker;
    fontMarkers.push({ markerStart, markerLength, fontName, fontSize, contentLength });
  }

  // 移除字体标记，计算最终文本
  let textWithoutFontMarkers = text.replace(fontRegex, '');

  // 计算字体标记在移除标记后的文本中的位置
  const fonts: Array<[number, number, string, number]> = [];
  let offsetAdjustment = 0;
  for (const marker of fontMarkers) {
    const adjustedStart = marker.markerStart - offsetAdjustment;
    fonts.push([adjustedStart, adjustedStart + marker.contentLength, marker.fontName, marker.fontSize]);
    offsetAdjustment += marker.markerLength;
  }

  // 解析加粗语法 **文字**
  const bold: Array<[number, number]> = [];
  const result: string[] = [];
  let idx = 0;
  text = textWithoutFontMarkers;
  while (idx < text.length) {
    if (text[idx] === '*' && text[idx + 1] === '*') {
      const end = text.indexOf('**', idx + 2);
      if (end !== -1) {
        const boldText = text.slice(idx + 2, end);
        const startOffset = result.length;
        result.push(boldText);
        bold.push([startOffset, startOffset + boldText.length]);
        idx = end + 2;
      } else {
        result.push(text[idx]);
        idx++;
      }
    } else {
      result.push(text[idx]);
      idx++;
    }
  }

  const finalText = result.join('');

  // 调整字体位置（因为加粗标记也被移除了）
  const adjustedFonts = fonts.map(([start, end, name, size]) => {
    let boldAdjustment = 0;
    for (const [boldStart, boldEnd] of bold) {
      if (boldStart <= start) boldAdjustment += 2;
      if (boldEnd <= end) boldAdjustment += 2;
    }
    return [start - boldAdjustment, end - boldAdjustment, name, size] as [number, number, string, number];
  });

  return { text: finalText, bold, indent, fonts: adjustedFonts, defaultFont: defaultFont || { name: '仿宋_GB2312', size: 16 } };
}

/**
 * 预处理数据中的格式标记（与前端 _processFormatData 一致）
 * 返回处理后的纯文本数据和格式映射
 */
function processFormatData(data: any, defaultFont: { name: string; size: number } | null = null): { data: any; formatMap: Record<string, any> } {
  if (!data || typeof data !== 'object') return { data, formatMap: {} };

  const formatMap: Record<string, any> = {};
  const processedData: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && (value.includes('**') || value.startsWith('>') || value.includes('[f:'))) {
      const parsed = parseFormatText(value, defaultFont);
      processedData[key] = parsed.text;
      formatMap[key] = parsed;
    } else {
      processedData[key] = value;
    }
  }

  return { data: processedData, formatMap };
}

/**
 * 根据格式信息拆分文本（与前端 _splitTextByFormat 一致）
 */
function splitTextByFormat(text: string, format: any): Array<{ text: string; bold: boolean; fontName: string; fontSize: number }> {
  const segments: Array<{ text: string; bold: boolean; fontName: string; fontSize: number }> = [];
  const defaultFont = format.defaultFont || { name: '仿宋_GB2312', size: 16 };

  // 创建文本位置到格式的映射
  const formatPosMap = new Map<number, { fontName: string; fontSize: number }>();
  if (format.fonts && format.fonts.length > 0) {
    for (const [start, end, fontName, fontSize] of format.fonts as Array<[number, number, string, number]>) {
      for (let i = start; i < end; i++) {
        formatPosMap.set(i, { fontName, fontSize });
      }
    }
  }

  // 映射加粗信息
  const boldSet = new Set<number>();
  if (format.bold && format.bold.length > 0) {
    for (const [start, end] of format.bold as Array<[number, number]>) {
      for (let i = start; i < end; i++) {
        boldSet.add(i);
      }
    }
  }

  if (text.length === 0) return segments;

  let currentSegment = {
    text: '',
    bold: boldSet.has(0),
    fontName: formatPosMap.has(0) ? formatPosMap.get(0)!.fontName : defaultFont.name,
    fontSize: formatPosMap.has(0) ? formatPosMap.get(0)!.fontSize : defaultFont.size
  };

  for (let i = 0; i < text.length; i++) {
    const charBold = boldSet.has(i);
    const charFont = formatPosMap.has(i) ? formatPosMap.get(i)! : defaultFont;

    if (charBold !== currentSegment.bold ||
        charFont.fontName !== currentSegment.fontName ||
        charFont.fontSize !== currentSegment.fontSize) {
      if (currentSegment.text.length > 0) {
        segments.push(currentSegment);
      }
      currentSegment = {
        text: text[i],
        bold: charBold,
        fontName: charFont.fontName,
        fontSize: charFont.fontSize
      };
    } else {
      currentSegment.text += text[i];
    }
  }

  if (currentSegment.text.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * 对 docx XML 应用格式化（与前端 _applyDocxFormatting 一致，但用正则代替 DOMParser）
 * 支持：加粗、字体标记、首行缩进、szCs
 */
function applyDocxFormatting(xmlContent: string, formatMap: Record<string, any>): string {
  if (!formatMap || Object.keys(formatMap).length === 0) return xmlContent;

  // 查找所有匹配的格式规则
  const findMatchedFormat = (textContent: string): any | null => {
    for (const [key, format] of Object.entries(formatMap)) {
      if (textContent.includes(format.text)) {
        return format;
      }
    }
    return null;
  };

  // 处理每个 <w:p> 段落
  return xmlContent.replace(/<w:p[^>]*>([\s\S]*?)<\/w:p>/g, (pMatch, pContent) => {
    let modifiedP = pContent;
    let hasModification = false;
    let indentApplied = false;

    // 处理段落中的 <w:r> 元素
    modifiedP = modifiedP.replace(/<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>([^<]*)<\/w:t><\/w:r>/g, (rMatch, rPr, text) => {
      const rawText = unescapeXml(text);
      const matchedFormat = findMatchedFormat(rawText);
      if (!matchedFormat) return rMatch;

      hasModification = true;
      const defaultFont = matchedFormat.defaultFont || { name: '仿宋_GB2312', size: 16 };

      // 处理首行缩进 — 需要在段落级别添加，标记以便外层处理
      if (matchedFormat.indent && !indentApplied) {
        indentApplied = true;
      }

      const hasBold = matchedFormat.bold && matchedFormat.bold.length > 0;
      const hasFonts = matchedFormat.fonts && matchedFormat.fonts.length > 0;

      if (hasBold || hasFonts) {
        // 拆分成多个 <w:r> 节点
        const segments = splitTextByFormat(rawText, matchedFormat);
        const runs = segments.map(seg => {
          let runXml = '<w:r><w:rPr>';
          // 字体
          runXml += `<w:rFonts w:ascii="${seg.fontName}" w:eastAsia="${seg.fontName}" w:hAnsi="${seg.fontName}"/>`;
          // 字号
          runXml += `<w:sz w:val="${seg.fontSize * 2}"/>`;
          runXml += `<w:szCs w:val="${seg.fontSize * 2}"/>`;
          // 加粗
          if (seg.bold) {
            runXml += '<w:b/>';
          }
          runXml += '</w:rPr>';
          // 文本
          runXml += `<w:t${seg.text.startsWith(' ') || seg.text.endsWith(' ') ? ' xml:space="preserve"' : ''}>${escapeXml(seg.text)}</w:t>`;
          runXml += '</w:r>';
          return runXml;
        });
        return runs.join('');
      } else {
        // 只设置默认字体
        let newRPr = '<w:rPr>';
        newRPr += `<w:rFonts w:ascii="${defaultFont.name}" w:eastAsia="${defaultFont.name}" w:hAnsi="${defaultFont.name}"/>`;
        newRPr += `<w:sz w:val="${defaultFont.size * 2}"/>`;
        newRPr += `<w:szCs w:val="${defaultFont.size * 2}"/>`;
        newRPr += '</w:rPr>';
        return `<w:r>${newRPr}<w:t${rawText.startsWith(' ') || rawText.endsWith(' ') ? ' xml:space="preserve"' : ''}>${escapeXml(rawText)}</w:t></w:r>`;
      }
    });

    // 处理首行缩进：在 <w:pPr> 中添加 <w:ind w:firstLine="640"/>
    if (indentApplied) {
      if (modifiedP.includes('<w:pPr>')) {
        // 已有 pPr，检查是否有 ind
        if (modifiedP.includes('<w:ind')) {
          // 已有 ind，添加 firstLine 属性
          modifiedP = modifiedP.replace(/<w:ind([^>]*)\/?>/g, (indMatch: string, attrs: string) => {
            if (attrs.includes('w:firstLine')) return indMatch;
            return `<w:ind${attrs} w:firstLine="640"/>`;
          });
        } else {
          // 没有 ind，在 pPr 中添加
          modifiedP = modifiedP.replace('<w:pPr>', '<w:pPr><w:ind w:firstLine="640"/>');
        }
      } else {
        // 没有 pPr，创建一个
        modifiedP = `<w:pPr><w:ind w:firstLine="640"/></w:pPr>` + modifiedP;
      }
    }

    return `<w:p>${modifiedP}</w:p>`;
  });
}

/**
 * 旧版 processRichTextFormatting 保留作为 fallback（不含首行缩进和 szCs）
 * @deprecated 使用 applyDocxFormatting 替代
 */
function processRichTextFormatting(xml: string): string {
  // 找到所有包含 ** 或 [f: 的 <w:r> 元素，并替换其中的内容
  // 注意：需要匹配整个 <w:r> 元素，而不是只匹配 <w:t>
  return xml.replace(/<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>([^<]*)<\/w:t><\/w:r>/g, (match, rPr, text) => {
    if (!text) return match;
    
    // docxtemplater 已经对文本进行了 XML 转义（如 < 变成 &lt;）
    // 需要先反转义，处理富文本标记后再转义
    const rawText = unescapeXml(text);
    
    // 检查是否包含富文本标记
    const hasBold = rawText.includes('**');
    const hasFont = /\[f:([^,]+),s:(\d+)\]/.test(rawText);
    
    if (!hasBold && !hasFont) {
      return match;
    }
    
    // 解析富文本格式
    const segments = parseRichTextSegments(rawText);
    
    if (segments.length === 1 && !segments[0].bold && !segments[0].font) {
      // 没有需要处理的格式，返回原样
      return match;
    }
    
    // 生成多个 <w:r> 元素
    const runs = segments.map(seg => {
      let runXml = '<w:r>';
      
      // 添加运行属性
      if (seg.bold || seg.font) {
        runXml += '<w:rPr>';
        if (seg.bold) {
          runXml += '<w:b/>';
        }
        if (seg.font) {
          // 字体名称（半点单位）
          const size = seg.size ? seg.size * 2 : 32; // 默认三号（16pt = 32半点）
          runXml += `<w:rFonts w:ascii="${seg.font}" w:eastAsia="${seg.font}" w:hAnsi="${seg.font}"/>`;
          runXml += `<w:sz w:val="${size}"/>`;
        }
        runXml += '</w:rPr>';
      }
      
      runXml += `<w:t${seg.text.includes(' ') ? ' xml:space="preserve"' : ''}>${escapeXml(seg.text)}</w:t>`;
      runXml += '</w:r>';
      
      return runXml;
    });
    
    return runs.join('');
  });
}

/**
 * 解析富文本片段
 */
function parseRichTextSegments(text: string): Array<{text: string; bold?: boolean; font?: string; size?: number}> {
  const segments: Array<{text: string; bold?: boolean; font?: string; size?: number}> = [];
  
  // 先处理字体标记 [f:字体,s:字号]
  let currentFont: string | undefined;
  let currentSize: number | undefined;
  
  // 正则匹配字体标记
  const fontRegex = /\[f:([^,\]]+),s:(\d+)\]/g;
  let lastIndex = 0;
  let match;
  
  // 先提取所有字体标记及其后的文本
  const parts: Array<{text: string; font?: string; size?: number}> = [];
  let pos = 0;
  
  while ((match = fontRegex.exec(text)) !== null) {
    // 字体标记之前的文本
    if (match.index > pos) {
      parts.push({ text: text.substring(pos, match.index) });
    }
    
    // 字体标记本身不输出，只记录设置
    currentFont = match[1];
    currentSize = parseInt(match[2], 10);
    pos = match.index + match[0].length;
    
    // 查找下一个字体标记或文本结束
    const nextMatch = fontRegex.exec(text);
    fontRegex.lastIndex = pos; // 重置以便下次匹配
    
    const endPos = nextMatch ? nextMatch.index : text.length;
    
    if (endPos > pos) {
      parts.push({ 
        text: text.substring(pos, endPos),
        font: currentFont,
        size: currentSize
      });
      pos = endPos;
      fontRegex.lastIndex = pos;
    }
  }
  
  // 剩余文本
  if (pos < text.length) {
    parts.push({ text: text.substring(pos) });
  }
  
  // 如果没有字体标记，使用原文本
  if (parts.length === 0) {
    parts.push({ text });
  }
  
  // 处理每个部分的加粗标记
  for (const part of parts) {
    // 处理 **加粗** 标记
    const boldParts = parseBoldSegments(part.text);
    for (const bp of boldParts) {
      segments.push({
        text: bp.text,
        bold: bp.bold,
        font: part.font,
        size: part.size
      });
    }
  }
  
  return segments;
}

/**
 * 解析加粗标记
 */
function parseBoldSegments(text: string): Array<{text: string; bold?: boolean}> {
  const segments: Array<{text: string; bold?: boolean}> = [];
  
  // 匹配 **加粗** 和普通文本
  const regex = /\*\*([^*]+)\*\*|([^*]+)/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined) {
      // **加粗** 部分
      segments.push({ text: match[1], bold: true });
    } else if (match[2] !== undefined && match[2].length > 0) {
      // 普通文本
      segments.push({ text: match[2] });
    }
  }
  
  return segments.length > 0 ? segments : [{ text }];
}

/**
 * XML 转义
 */
/**
 * XML 反转义（将 &lt; &gt; &amp; 等还原为原始字符）
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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
  content?: string; // 文本内容（用于文本输入模式的虚拟文件）
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
  table: (data: any[]) => void;
  getDefaultFont(): { name: string; size: number };
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
  fillWordTemplate(templateFile: FileLike | string, data: any, outputFilename: string, defaultFont?: { name: string; size: number } | null): Promise<void>;
  writeExcel(filename: string, data: any, options?: { sheetName?: string }): void;
  fillExcelTemplate(templateFile: FileLike | string, data: any, outputFilename: string): Promise<void>;
  writeCSV(filename: string, data: any[][]): void;
  writeText(filename: string, content: string): void;
  writeJSON(filename: string, data: any): void;
  parseFilename(name: string, options?: { datePattern?: RegExp }): { unit: string; date: string };
  parseWordStructure(file: FileLike, options?: { maxTextLength?: number }): Promise<{
    title: string;
    sections: Array<{ level: number; title: string; paragraphs: string[] }>;
    sectionsFlat: Array<{ level: number; title: string; paragraphs: string[] }>;
    tables: any[];
    rawText: string;
  }>;
  treeToJSON(nodes: any[], options?: { baseIndent?: number; paragraphsKey?: string }): any[];
  countTree(nodes: any[]): { total: number; maxDepth: number };
}

/**
 * 创建治理助手（后端版）
 */
export function createGovHelper(
  ctx: GovContext,
  logLines: string[],
  outputFiles: GovOutputFile[],
  inputFiles: FileLike[] = []
): GovHelper {
  const { apiBase, token, databaseId, dbType, databases } = ctx;

  /**
   * 解析模板文件参数（与前端 _resolveGovTemplateFile 一致）
   * 支持传入字符串文件名，从上传文件列表中查找
   */
  function _resolveGovTemplateFile(templateFile: FileLike | string): FileLike {
    if (typeof templateFile !== 'string') return templateFile as FileLike;
    const name = (templateFile as string).trim();
    if (!name) throw new Error('模板文件名不能为空');
    const found = inputFiles.find(f => f && f.name === name)
      || inputFiles.find(f => f && (f.name.endsWith(name) || name.endsWith(f.name)));
    if (found) return found;
    throw new Error(`模板文件 ${name} 在上传列表中未找到，请确保 File 对象可用`);
  }

  /** 带 60s 超时的 fetch（与前端 fetchWithAuth 超时一致，防止后端任务卡死） */
  async function _fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 60000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      // 确保完整读取 body，避免超时 abort 导致半截 JSON → resp.json() 解析失败
      // 与前端 fetchWithAuth 一致：先完整读取文本，再让调用方解析
      const text = await resp.text();
      try {
        const data = JSON.parse(text);
        // 返回模拟 Response 对象，json() 返回已解析的数据，避免二次解析失败
        return {
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
          json: async () => data,
          text: async () => text,
        } as any as Response;
      } catch (parseErr) {
        // JSON 解析失败，返回原始文本让上层处理（与 Go 侧 callAIService 一致）
        return {
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
          json: async () => { throw new SyntaxError(`JSON 解析失败: ${text.substring(0, 200)}`); },
          text: async () => text,
        } as any as Response;
      }
    } catch (e) {
      // 超时 abort → 与前端 fetchWithAuth 一致，返回友好超时 Response（不是抛异常）
      if (e instanceof DOMException && e.name === 'AbortError') {
        return {
          ok: false,
          status: 0,
          statusText: 'Timeout',
          json: async () => ({ success: false, message: `请求超时(${Math.round(timeoutMs/1000)}秒)` }),
          text: async () => `请求超时(${Math.round(timeoutMs/1000)}秒)`,
          headers: new Headers(),
        } as any as Response;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function _runSQL(dbId: string, sql: string, params: any[] = []): Promise<any> {
    const resp = await _fetchWithTimeout(`${apiBase}/api/v1/gov/execute-sql`, {
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
    log(...args: any[]) {
      logLines.push(args.map(a => {
        if (a === null) return 'null';
        if (a === undefined) return 'undefined';
        if (typeof a === 'object') return JSON.stringify(a);
        return String(a);
      }).join(' '));
    },

    showTable,
    table: showTable,

    getDefaultFont() {
      return { name: '仿宋_GB2312', size: 16 };
    },

    getDbType() {
      return dbType;
    },

    getDatabases() {
      return (databases || []).map((d: any) => ({ id: d.id, name: d.name, type: d.type }));
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
      const buf = Buffer.from(arrayBuffer);
      
      // 检测文件格式
      const filename = file.name.toLowerCase();
      const isDocx = filename.endsWith('.docx');
      const isDoc = filename.endsWith('.doc') || filename.endsWith('.wps');
      
      if (isDoc) {
        // .doc 或 .wps 格式，需要转换为 docx
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { execSync } = await import('child_process');
        
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-convert-'));
        const inputFile = path.join(tmpDir, file.name);
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const outputFile = path.join(tmpDir, `${baseName}.docx`);
        
        try {
          fs.writeFileSync(inputFile, buf);
          execSync(`soffice --headless --convert-to docx "${inputFile}" --outdir "${tmpDir}"`, {
            timeout: 30000,
            stdio: 'pipe'
          });
          const docxBuf = fs.readFileSync(outputFile);
          // 用 mammoth 提取文本（与前端一致）
          const result = await mammoth.extractRawText({ buffer: docxBuf });
          return { value: result.value };
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
        }
      } else if (isDocx) {
        // 直接用 mammoth 提取文本（与前端一致）
        const result = await mammoth.extractRawText({ buffer: buf });
        return { value: result.value };
      } else {
        throw new Error(`不支持的文件格式: ${file.name}`);
      }
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
      // AI 生成可能较慢，给180秒超时（比默认60秒长，避免大prompt超时中断）
      const resp = await _fetchWithTimeout(`${apiBase}/api/v1/agent/completion`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ prompt })
      }, 180000);
      const data = await resp.json();
      if (!data.success) throw new Error(data.message || 'AI 调用失败');
      return data.content || '';
    },

    async fillWordTemplate(templateFile: FileLike | string, data: any, outputFilename: string, defaultFont: { name: string; size: number } | null = null) {
      const effectiveDefaultFont = defaultFont || { name: '仿宋_GB2312', size: 16 };
      const fileObj = _resolveGovTemplateFile(templateFile);
      if (!fileObj) throw new Error('未提供模板文件');
      const buf = Buffer.from(await fileObj.arrayBuffer());
      const zip = new PizZip(buf);

      // 检查是否有格式标记（与前端一致：先预处理 data）
      const hasFormatting = hasFormatMarkers(data);
      let processedData = data;
      let fmtMap: Record<string, any> = {};

      if (hasFormatting) {
        const processed = processFormatData(data, effectiveDefaultFont);
        processedData = processed.data;
        fmtMap = processed.formatMap;
      }

      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
      doc.setData(processedData || {});
      doc.render();

      // 获取生成的文档内容
      const generatedZip = doc.getZip();

      // 如果有格式标记，后处理 XML（与前端一致）
      if (hasFormatting && Object.keys(fmtMap).length > 0) {
        const documentXml = generatedZip.file('word/document.xml')?.asText();
        if (documentXml) {
          const formattedXml = applyDocxFormatting(documentXml, fmtMap);
          generatedZip.file('word/document.xml', formattedXml);
        }
      }

      const out = generatedZip.generate({ type: 'nodebuffer' }) as Buffer;
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

    async fillExcelTemplate(templateFile: FileLike | string, data: any, outputFilename: string) {
      const fileObj = _resolveGovTemplateFile(templateFile);
      if (!fileObj) throw new Error('未提供模板文件');
      if (!data || typeof data !== 'object') throw new Error('data 须为对象');
      const wb = await (async () => {
        const arrayBuffer = await fileObj.arrayBuffer();
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
      // 与前端一致：不自动追加 .txt 后缀
      const buf = Buffer.from(text, 'utf8');
      outputFiles.push({ name: filename, content_base64: buf.toString('base64') });
      logLines.push(`已生成输出文件: ${filename}`);
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

    /**
     * 解析文件名，提取单位和日期
     * 支持格式：
     *   2024年4月15日数据中心日报 → {unit: "数据中心", date: "2024年4月15日"}
     *   04月15日运维部日报 → {unit: "运维部", date: "04月15日"}
     */
    parseFilename(name: string, options: { datePattern?: RegExp } = {}): { unit: string; date: string } {
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
      
      // 尝试匹配月日格式：04月15日
      const mdMatch = base.match(/^(\d{1,2})月(\d{1,2})日/);
      if (mdMatch) {
        return {
          unit: base.replace(/^(\d{1,2})月(\d{1,2})日/, '').replace(/日报$/, '').trim() || base,
          date: `${parseInt(mdMatch[1])}月${parseInt(mdMatch[2])}日`
        };
      }
      
      return { unit: base.replace(/日报$/, '').trim() || base, date: '' };
    },

    /**
     * 解析 Word 文档结构，识别公文格式的标题层级、段落、表格等。
     * 与前端 script-ontology.js parseWordStructure 保持一致
     */
    async parseWordStructure(file: FileLike, options: { maxTextLength?: number } = {}) {
      if (!file) throw new Error('缺少文件');
      const arrayBuffer = await file.arrayBuffer();
      let buf = Buffer.from(arrayBuffer);
      
      // 检测文件格式并转换
      const filename = file.name.toLowerCase();
      const isDocx = filename.endsWith('.docx');
      const isDoc = filename.endsWith('.doc') || filename.endsWith('.wps');
      
      if (isDoc) {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { execSync } = await import('child_process');
        
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-convert-'));
        const inputFile = path.join(tmpDir, file.name);
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const outputFile = path.join(tmpDir, `${baseName}.docx`);
        
        try {
          fs.writeFileSync(inputFile, buf);
          execSync(`soffice --headless --convert-to docx "${inputFile}" --outdir "${tmpDir}"`, {
            timeout: 30000,
            stdio: 'pipe'
          });
          buf = fs.readFileSync(outputFile);
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
        }
      } else if (!isDocx) {
        throw new Error(`不支持的文件格式: ${file.name}`);
      }
      
      const zip = new PizZip(buf);
      
      // 提取纯文本
      const docXml = zip.file('word/document.xml');
      if (!docXml) throw new Error('无效的 docx 文件: 缺少 word/document.xml');
      const xml = docXml.asText() || '';
      
      // 按段落提取文本（每个 <w:p> 对应一个段落，用换行分隔）
      // 和 readWord 保持一致，这样章节解析才能正确工作
      const paragraphRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
      const paragraphs: string[] = [];
      let pMatch;
      while ((pMatch = paragraphRegex.exec(xml)) !== null) {
        const pXml = pMatch[1];
        const tMatches = pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
        const text = tMatches.map((m: string) => {
          const m2 = m.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
          return m2 ? m2[1] : '';
        }).join('');
        if (text.trim()) {
          paragraphs.push(text);
        }
      }
      const rawText = paragraphs.join('\n');
      
      const maxLen = options.maxTextLength || 50000;
      const text = rawText.length > maxLen ? rawText.slice(0, maxLen) : rawText;

      // ===== 扩展公文标题正则模式（与前端一致） =====
      const titlePatterns = [
        /^[一二三四五六七八九十]+、[^\n]+/,                    // 一、标题
        /^（[一二三四五六七八九十]+）[^\n]+/,                  // （一）标题
        /^\d+[\.、．：][^\n]+/,                                 // 1. 标题 或 1、标题
        /^（\d+）[^\n]+/,                                      // （1）标题
        /^[（\(][一二三四五六七八九十\d]+[）\)][^\n]+/,        // 混合括号
        /^第[一二三四五六七八九十\d]+章[^\n]*/,                // 第一章、第二章
        /^第[一二三四五六七八九十\d]+条[^\n]*/,                // 第1条、第2条
        /^[•●○◆■★][\s　][^\n]+/,                             // • xxx 无序列表
        /^[\u25A0\u25B2\u25CB\u25CF][\s　][^\n]+/,            // ■ ★ ◆ ● ○ 无序列表变体
        /^[\d]+\.[\s　]+[^\n]+/,                              // 1. xxx 数字点开头
        /^[\(（]?[a-zA-Z0-9]+[\)）]?[\.、：\s　]+[^\n]+/       // a. A. (1) 等字母数字编号
      ];

      // 无序列表符号模式（用于识别内容行）
      const bulletPattern = /^[•●○◆■★\u25A0\u25B2\u25CB\u25CF][\s　]+(.+)$/;

      // 冒号内联标题拆分函数（与前端 splitInlineTitleContent 一致）
      function splitInlineTitleContent(prefix: string, rest: string): { title: string; paragraphs: string[] } {
        const restText = (rest || '').trim();
        if (!restText) {
          return { title: prefix, paragraphs: [] };
        }
        const colonIndex = restText.search(/[：:]/);
        if (colonIndex > 0) {
          const titlePart = restText.slice(0, colonIndex).trim();
          const contentPart = restText.slice(colonIndex + 1).trim();
          return {
            title: `${prefix}${titlePart}`,
            paragraphs: contentPart ? [contentPart] : []
          };
        }
        return {
          title: `${prefix}${restText}`,
          paragraphs: []
        };
      }

      const lines = text.split(/\r?\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      const sections: any[] = [];
      const tables: any[] = [];
      let currentSection: any = null;
      let title = '';

      // 尝试识别文档标题（第一个非空行，通常是大标题）
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

      // 解析章节和段落（与前端逻辑完全一致）
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // 检测一级标题：一、二、三、
        const m1 = line.match(/^([一二三四五六七八九十]+)、(.*)$/);
        if (m1) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 1, title: `${m1[1]}、${(m1[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测二级标题：（一）（二）
        const m2 = line.match(/^（([一二三四五六七八九十]+)）(.*)$/);
        if (m2) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 2, title: `（${m2[1]}）${(m2[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测三级标题：1. 2. 或 1、2、（带冒号内联标题拆分）
        const m3 = line.match(/^(\d+)([\.、．])(.*)$/);
        if (m3) {
          if (currentSection) sections.push(currentSection);
          const inline = splitInlineTitleContent(`${m3[1]}${m3[2]}`, m3[3]);
          currentSection = { level: 3, title: inline.title, paragraphs: inline.paragraphs };
          continue;
        }

        // 检测四级标题：（1）（2）（带冒号内联标题拆分）
        const m4 = line.match(/^（(\d+)）(.*)$/);
        if (m4) {
          if (currentSection) sections.push(currentSection);
          const inline = splitInlineTitleContent(`（${m4[1]}）`, m4[2]);
          currentSection = { level: 4, title: inline.title, paragraphs: inline.paragraphs };
          continue;
        }

        // 检测第一章、第二章...（阿拉伯数字章节）
        const mChapter = line.match(/^第(\d+)章[：:\s]*(.*)$/);
        if (mChapter) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 1, title: `第${mChapter[1]}章 ${(mChapter[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测第一章、第二章...（中文数字章节）
        const mChapterCN = line.match(/^第([一二三四五六七八九十]+)章[：:\s]*(.*)$/);
        if (mChapterCN) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 1, title: `第${mChapterCN[1]}章 ${(mChapterCN[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测第1条、第2条...（阿拉伯数字条目）→ level 2
        const mArticle = line.match(/^第(\d+)条[：:\s]*(.*)$/);
        if (mArticle) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 2, title: `第${mArticle[1]}条 ${(mArticle[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测第一条、第二条...（中文数字条目）
        const mArticleCN = line.match(/^第([一二三四五六七八九十]+)条[：:\s]*(.*)$/);
        if (mArticleCN) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 2, title: `第${mArticleCN[1]}条 ${(mArticleCN[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测无序列表：• xxx（作为内容节点，层级为5）
        const mBullet = line.match(bulletPattern);
        if (mBullet) {
          const bulletContent = mBullet[1] || line;
          if (currentSection) {
            currentSection.paragraphs.push(line);
          } else {
            if (currentSection) sections.push(currentSection);
            currentSection = { level: 5, title: bulletContent.trim().slice(0, 50), paragraphs: [line] };
          }
          continue;
        }

        // 检测半角括号格式：(1) (2)（带冒号内联标题拆分）
        const mParenHalf = line.match(/^\((\d+)\)[\s]*(.*)$/);
        if (mParenHalf) {
          if (currentSection) sections.push(currentSection);
          const inline = splitInlineTitleContent(`(${mParenHalf[1]})`, mParenHalf[2]);
          currentSection = { level: 4, title: inline.title, paragraphs: inline.paragraphs };
          continue;
        }

        // 检测半角括号格式：(一) (二)
        const mParenHalfCN = line.match(/^\(([一二三四五六七八九十]+)\)[\s]*(.*)$/);
        if (mParenHalfCN) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 2, title: `(${mParenHalfCN[1]}) ${(mParenHalfCN[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测字母编号：a. b. c. 或 A. B. C.
        const mLetter = line.match(/^([a-zA-Z])[\.、．：][\s]*(.*)$/);
        if (mLetter) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 4, title: `${mLetter[1]}. ${(mLetter[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 非标题行：添加到当前段落
        if (currentSection) {
          if (line.length > 0) {
            currentSection.paragraphs.push(line);
          }
        } else {
          // 还没有遇到标题，可能是前言
          if (!sections.find((s: any) => s.level === 0)) {
            sections.push({ level: 0, title: '前言', paragraphs: [line] });
            currentSection = sections[sections.length - 1];
          } else if (sections.length > 0) {
            sections[sections.length - 1].paragraphs.push(line);
          }
        }

        // 简单的表格检测：连续包含多个制表符或 | 分隔的行
        if (line.includes('\t') || line.includes('|')) {
          const cells = line.split(/[\t|]+/).filter((c: string) => c.trim());
          if (cells.length >= 2) {
            const lastTable = tables.length > 0 ? tables[tables.length - 1] : null;
            if (lastTable && (lastTable as any)._building) {
              lastTable.rows.push(cells);
            } else {
              tables.push({ headers: cells, rows: [] as string[][], _building: true });
            }
          }
        } else {
          // 结束表格构建
          if (tables.length > 0) {
            const lastTable = tables[tables.length - 1];
            if ((lastTable as any)._building) {
              delete (lastTable as any)._building;
            }
          }
        }
      }

      // 保存最后一个 section
      if (currentSection) {
        sections.push(currentSection);
      }

      // 清理表格对象中的临时属性
      for (const t of tables) {
        delete (t as any)._building;
      }

      // ===== 构建树形结构（与前端 buildTree 逻辑一致，含层级自动降级） =====
      function buildTree(flatSections: any[]): any[] {
        const root: any = { level: -1, title: 'ROOT', children: [], paragraphs: [] };
        const bStack: any[] = [root];

        for (const sec of flatSections) {
          let targetLevel = sec.level;
          const currentParentLevel = bStack[bStack.length - 1].level;

          // 层级自动降级规则：
          // - L1 后直接出现 L3 → 降为 L2
          // - L1 后直接出现 L4 → 降为 L2
          // - L2 后直接出现 L4 → 降为 L3
          if (targetLevel > currentParentLevel + 1) {
            targetLevel = currentParentLevel + 1;
          }

          sec.level = targetLevel;

          // 弹出栈中 level >= 当前的节点
          while (bStack.length > 1 && bStack[bStack.length - 1].level >= targetLevel) {
            bStack.pop();
          }

          const parent = bStack[bStack.length - 1];
          const node = {
            level: sec.level,
            title: sec.title,
            paragraphs: sec.paragraphs || [],
            children: [] as any[]
          };
          parent.children.push(node);
          bStack.push(node);
        }

        return root.children;
      }

      const sectionTree = buildTree(sections);

      return { title, sections: sectionTree, sectionsFlat: sections, tables, rawText };
    },

    treeToJSON(nodes: any[], options: { baseIndent?: number; paragraphsKey?: string } = {}): any[] {
      const baseIndent = options.baseIndent || 0;
      const paragraphsKey = options.paragraphsKey || 'paragraphs';

      const convert = (nodeList: any[], parentLevel: number = 0): any[] => {
        return nodeList.map((node: any) => {
          const indent = '  '.repeat(baseIndent + Math.max(0, node.level - 1));
          const paragraphs = (node[paragraphsKey] || []).map((p: any) => {
            return { paragraph: typeof p === 'string' ? p : (p.paragraph || JSON.stringify(p)) };
          });
          return {
            level: node.level,
            title: node.title,
            indent: indent,
            paragraphs: paragraphs,
            children: node.children && node.children.length > 0
              ? convert(node.children, node.level)
              : []
          };
        });
      };

      return convert(nodes);
    },

    /**
     * 统计树形结构信息
     * @param nodes - 树形节点数组
     * @returns {{total: number, maxDepth: number}}
     */
    countTree(nodes: any[]): { total: number; maxDepth: number } {
      let total = 0;
      let maxDepth = 0;

      function walk(nodeList: any[], depth: number) {
        for (const node of nodeList) {
          total++;
          if (depth > maxDepth) maxDepth = depth;
          if (node.children && node.children.length > 0) {
            walk(node.children, depth + 1);
          }
        }
      }

      walk(nodes, 1);
      return { total, maxDepth };
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
    currentGovTask?: any;
  } = {}
): Promise<{ success: boolean; output: string[]; error?: string; output_files?: GovOutputFile[] }> {
  const logLines: string[] = [];
  const outputFiles: GovOutputFile[] = [];
  const gov = createGovHelper(ctx, logLines, outputFiles,
    options.inputFiles && options.inputFiles.length > 0
      ? options.inputFiles
      : options.inputFile
        ? [options.inputFile]
        : []
  );

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
      'currentGovTask',
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

    const result = fn(
      gov,
      options.currentGovTask || null,
      inputFile,
      options.inputText || '',
      XLSX,
      Papa,
      mammoth,
      PizZip,
      Docxtemplater,
      inputFiles
    );

    // 显式等待用户代码返回的 Promise（包括 async function main() 调用）
    // 即使用户未在顶层写 await，AsyncFunction 执行结果仍是一个 Promise
    // 若用户代码返回的是 Promise（如 async main() 调用），需要等待其 resolve
    if (result && typeof result.then === 'function') {
      await result;
    }

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
