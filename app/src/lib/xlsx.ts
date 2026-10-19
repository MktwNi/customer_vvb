/**
 * A small .xlsx writer (Office Open XML through jszip, already a dependency, loaded only when a file is
 * made): one sheet per table, the head row in bold and frozen, text as inline strings, amounts as numbers
 * (#,##0.00), dates as real Excel dates (yyyy-mm-dd), column widths. Excel sums and filters it at once.
 */

/** A cell: text, a number, a date ({date: 'YYYY-MM-DD'}), or empty. */
export type XCell = string | number | { date: string } | null | undefined;
export interface XSheet { name: string; head: string[]; rows: XCell[][]; widths?: number[] }

/** The Excel serial of a day (days since 1899-12-30), or null for a malformed one. */
export function excelSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || '');
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return isNaN(t) ? null : Math.round((t - Date.UTC(1899, 11, 30)) / 864e5);
}
/** A1-style column letters: 0 → A, 25 → Z, 26 → AA. */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
// characters XML 1.0 may not hold are dropped; the five special ones escaped
const xml = (s: string) =>
  s
    .replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
/** A sheet name Excel accepts: no []:*?/\, at most 31 characters, not empty. */
export const sheetName = (s: string, i: number) => s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;

// styles: 0 text, 1 the bold head, 2 an amount, 3 a date
const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function cellXml(v: XCell, ref: string, head = false): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return isFinite(v) ? `<c r="${ref}" s="2"><v>${v}</v></c>` : '';
  if (typeof v === 'object') {
    const n = excelSerial(v.date);
    return n == null ? '' : `<c r="${ref}" s="3"><v>${n}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
}
/** One worksheet's XML. */
export function sheetXml(sh: XSheet): string {
  const rows = [sh.head, ...sh.rows];
  const body = rows
    .map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellXml(v, colName(j) + (i + 1), i === 0)).join('')}</row>`)
    .join('');
  const cols = sh.widths?.length ? '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${body}</sheetData>` +
    '</worksheet>'
  );
}

/** The workbook's files (path → XML), in the order a zip holds them. */
export function xlsxFiles(sheets: XSheet[]): Record<string, string> {
  const n = sheets.length;
  const ids = sheets.map((_, i) => i + 1);
  return {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      ids.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheets.map((s, i) => `<sheet name="${xml(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      ids.map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('') +
      `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
    'xl/styles.xml': STYLES,
    ...Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)])),
  };
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function zipOf(sheets: XSheet[]) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  // no folder entries: only the parts the package names
  Object.entries(xlsxFiles(sheets)).forEach(([p, x]) => zip.file(p, x, { createFolders: false }));
  return zip;
}
/** The .xlsx file's bytes. */
export async function xlsxBytes(sheets: XSheet[]): Promise<Uint8Array> {
  return (await zipOf(sheets)).generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
/** The .xlsx file, ready to download. */
export async function xlsxBlob(sheets: XSheet[]): Promise<Blob> {
  return (await zipOf(sheets)).generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: XLSX_MIME });
}
