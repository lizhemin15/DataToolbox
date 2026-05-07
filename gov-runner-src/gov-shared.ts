import * as XLSX from 'xlsx';

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
