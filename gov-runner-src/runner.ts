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
 * 处理富文本格式：**加粗**、[f:字体,s:字号]文字、>首行缩进
 */
function processRichTextFormatting(xml: string): string {
  // 处理每个 <w:t> 元素中的富文本标记
  return xml.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (match, text) => {
    if (!text) return match;
    
    // 检查是否包含富文本标记
    const hasBold = text.includes('**');
    const hasFont = /\[f:([^,]+),s:(\d+)\]/.test(text);
    
    if (!hasBold && !hasFont) {
      return match;
    }
    
    // 提取原有的 XML 属性
    const attrMatch = match.match(/<w:t([^>]*)>/);
    const attrs = attrMatch ? attrMatch[1] : '';
    
    // 解析富文本格式
    const segments = parseRichTextSegments(text);
    
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
  parseFilename(name: string, options?: { datePattern?: RegExp }): { unit: string; date: string };
  parseWordStructure(file: FileLike, options?: { maxTextLength?: number }): Promise<{
    title: string;
    sections: Array<{ level: number; title: string; paragraphs: string[] }>;
    tables: any[];
    rawText: string;
  }>;
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
      const buf = Buffer.from(arrayBuffer);
      
      // 检测文件格式
      const filename = file.name.toLowerCase();
      const isDocx = filename.endsWith('.docx');
      const isDoc = filename.endsWith('.doc') || filename.endsWith('.wps');
      
      let docxBuffer: Buffer;
      
      if (isDocx) {
        // 直接使用 docx
        docxBuffer = buf;
      } else if (isDoc) {
        // .doc 或 .wps 格式，需要转换为 docx
        // 写入临时文件
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { execSync } = await import('child_process');
        
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-convert-'));
        const inputFile = path.join(tmpDir, file.name);
        // LibreOffice 输出文件名是原文件名加 .docx
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const outputFile = path.join(tmpDir, `${baseName}.docx`);
        
        try {
          fs.writeFileSync(inputFile, buf);
          
          // 用 LibreOffice 转换
          execSync(`soffice --headless --convert-to docx "${inputFile}" --outdir "${tmpDir}"`, {
            timeout: 30000,
            stdio: 'pipe'
          });
          
          docxBuffer = fs.readFileSync(outputFile);
        } finally {
          // 清理临时文件
          try {
            fs.rmSync(tmpDir, { recursive: true });
          } catch {}
        }
      } else {
        throw new Error(`不支持的文件格式: ${file.name}`);
      }
      
      // 解析 docx（zip 包）
      const zip = new PizZip(docxBuffer);
      // docx 是 zip 包，文档内容在 word/document.xml
      const docXml = zip.file('word/document.xml');
      if (!docXml) throw new Error('无效的 docx 文件: 缺少 word/document.xml');
      const xml = docXml.asText() || '';
      
      // 按段落提取文本（每个 <w:p> 对应一个段落，用换行分隔）
      // 这样 parseWordStructure 才能正确解析章节结构
      const paragraphRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
      const paragraphs: string[] = [];
      let match;
      while ((match = paragraphRegex.exec(xml)) !== null) {
        const pXml = match[1];
        // 提取段落内所有 <w:t> 标签的文本
        const tMatches = pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
        const text = tMatches.map(m => {
          const m2 = m.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
          return m2 ? m2[1] : '';
        }).join('');
        if (text.trim()) {
          paragraphs.push(text);
        }
      }
      const value = paragraphs.join('\n');
      return { value };
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
      
      // 获取生成的文档内容
      const generatedZip = doc.getZip();
      let documentXml = generatedZip.file('word/document.xml')?.asText();
      
      if (documentXml) {
        // 处理富文本格式
        documentXml = processRichTextFormatting(documentXml);
        
        // 更新 zip 中的 document.xml
        generatedZip.file('word/document.xml', documentXml);
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
     * 从前端 script.js 移植
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
        // .doc 或 .wps 格式，需要转换为 docx
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { execSync } = await import('child_process');
        
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-convert-'));
        const inputFile = path.join(tmpDir, file.name);
        // LibreOffice 输出文件名是原文件名加 .docx
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const outputFile = path.join(tmpDir, `${baseName}.docx`);
        
        try {
          fs.writeFileSync(inputFile, buf);
          
          // 用 LibreOffice 转换
          execSync(`soffice --headless --convert-to docx "${inputFile}" --outdir "${tmpDir}"`, {
            timeout: 30000,
            stdio: 'pipe'
          });
          
          buf = fs.readFileSync(outputFile);
        } finally {
          // 清理临时文件
          try {
            fs.rmSync(tmpDir, { recursive: true });
          } catch {}
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
        // 提取段落内所有 <w:t> 标签的文本
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

      // ===== 扩展公文标题正则模式 =====
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

      const lines = text.split(/\r?\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      const sections: any[] = [];
      let currentSection: any = null;
      let title = '';

      // 尝试识别文档标题
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

        // 检测三级标题：1. 2.
        const m3 = line.match(/^(\d+)([\.、．])(.*)$/);
        if (m3) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 3, title: `${m3[1]}${m3[2]}${(m3[3] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测四级标题：（1）（2）
        const m4 = line.match(/^（(\d+)）(.*)$/);
        if (m4) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 4, title: `（${m4[1]}）${(m4[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测第一章、第二章
        const mChapter = line.match(/^第(\d+)章[：:\s]*(.*)$/);
        if (mChapter) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 1, title: `第${mChapter[1]}章 ${(mChapter[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 检测第1条、第2条
        const mArticle = line.match(/^第(\d+)条[：:\s]*(.*)$/);
        if (mArticle) {
          if (currentSection) sections.push(currentSection);
          currentSection = { level: 1, title: `第${mArticle[1]}条 ${(mArticle[2] || '').trim()}`.trim(), paragraphs: [] };
          continue;
        }

        // 如果没有匹配任何标题模式，作为段落添加
        if (currentSection) {
          currentSection.paragraphs.push(line);
        }
      }

      if (currentSection) sections.push(currentSection);

      // 将扁平结构转换为树形结构
      // 使用栈算法：维护当前路径上的父节点
      const tree: any[] = [];
      const stack: { level: number; node: any }[] = [];
      
      for (const section of sections) {
        const node = { ...section, children: [] };
        
        // 弹出所有 level >= 当前 level 的节点
        while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
          stack.pop();
        }
        
        if (stack.length === 0) {
          // 没有父节点，添加到根
          tree.push(node);
        } else {
          // 添加到最近的父节点
          stack[stack.length - 1].node.children.push(node);
        }
        
        // 当前节点入栈，作为后续节点的潜在父节点
        stack.push({ level: section.level, node });
      }

      // 尝试提取表格
      const tables: any[] = [];
      const tableXmlMatches = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
      for (const tableXml of tableXmlMatches.slice(0, 20)) {
        const rows: string[][] = [];
        const rowMatches = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
        for (const rowXml of rowMatches) {
          const cells: string[] = [];
          const cellMatches = rowXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
          for (const cell of cellMatches) {
            const m = cell.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
            cells.push(m ? m[1] : '');
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) tables.push(rows);
      }

      return { title, sections: tree, sectionsFlat: sections, tables, rawText };
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
      'currentGovTask',
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
      inputFiles,
      options.currentGovTask || null
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
