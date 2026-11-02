import type { CellValue } from './normalize.js';

export interface RawSheet {
  name: string;
  hidden: boolean;
  rows: CellValue[][];
  /** 1-based spreadsheet row number of rows[0]. */
  firstRow: number;
  totalRows: number;
  truncated: boolean;
  columnsTruncated: boolean;
}

export interface RawWorkbook {
  sheets: RawSheet[];
  date1904: boolean;
}

export function parseWorkbookSync(input: { data: Uint8Array; ext: string; maxRows: number; maxCols: number }): RawWorkbook;
