/**
 * The CFO certificate sheet: the template to fill in, the export of the certificates the app holds, and the
 * reader that turns a sheet back into rows. Columns are read by HEADER NAME in row 1 (aliases below, the old
 * apBE/exBE names of project/cfo-import.js included), never by letter. A workbook with a ทะเบียนบริษัท sheet is
 * the old full upload: core.ts still reads it (sheet TGO_CFO by letter), and this module leaves it alone.
 */
import type { Cert, CertDicts, Dataset, Dicts, RawCompany } from './types';
import { CCOLS, fixName, norm } from './core';
import type { XCell, XSheet } from './xlsx';

export const SHEET = 'ใบรับรอง CFO';
/** The TGO sheet tab, read the same way (the 27 headers are its own). */
export const SHEET_TGO = 'ข้อมูล CFO';
export const SHEET_DESC = 'คำอธิบาย';
const FULL_SHEET = 'ทะเบียนบริษัท';

type Kind = 'text' | 'id' | 'be' | 'pct' | 'skip';
/** The 27 columns in order: the template's header row. `skip` columns are written on export and not read. */
export const SHEET_COLS: { key: string; head: string; alias?: string[]; kind: Kind; req?: boolean; format: string; meaning: string }[] = [
  { key: 'n', head: 'ลำดับ', kind: 'skip', format: 'ตัวเลข', meaning: 'ลำดับในไฟล์ ระบบไม่ใช้ค่านี้' },
  { key: 'cert', head: 'เลขที่ใบรับรอง', kind: 'text', req: true, format: 'ข้อความ', meaning: 'เลขที่ใบรับรองจาก อบก. ใช้จับคู่กับใบที่มีในระบบ' },
  { key: 'act', head: 'ชื่อกิจกรรม/ประเภทธุรกิจ', alias: ['ชื่อกิจกรรม'], kind: 'text', format: 'ข้อความ', meaning: 'กิจกรรมหรือประเภทธุรกิจที่ขอการรับรอง' },
  { key: 'org', head: 'ชื่อองค์กร', kind: 'text', req: true, format: 'ข้อความ', meaning: 'ชื่อตรงกับบริษัทในระบบจะผูกใบรับรองกับบริษัทนั้น ถ้าไม่พบจะสร้างบริษัทใหม่' },
  { key: 'branch', head: 'สาขา/รหัสสาขา', alias: ['สาขา'], kind: 'text', format: 'ข้อความ', meaning: 'สาขาหรือรหัสสาขา (ถ้ามี)' },
  { key: 'prov', head: 'จังหวัด', kind: 'text', format: 'ชื่อจังหวัด', meaning: 'จังหวัดของที่ตั้งตามใบรับรอง' },
  { key: 'addr', head: 'ที่อยู่', kind: 'text', format: 'ข้อความ', meaning: 'ที่อยู่เต็มของสถานที่ที่ขอการรับรอง' },
  { key: 'tambon', head: 'ตำบล/แขวง (จากที่อยู่)', alias: ['ตำบล/แขวง'], kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'ระบบไม่เก็บแยก ไม่ใช้ค่านี้' },
  { key: 'amphoe', head: 'อำเภอ/เขต (จากที่อยู่)', alias: ['อำเภอ/เขต'], kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'ระบบไม่เก็บแยก ไม่ใช้ค่านี้' },
  { key: 'provAddr', head: 'จังหวัด (จากที่อยู่)', kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'ระบบไม่เก็บแยก ไม่ใช้ค่านี้' },
  { key: 'zip', head: 'รหัสไปรษณีย์', kind: 'text', format: 'ตัวเลข 5 หลัก', meaning: 'รหัสไปรษณีย์ของที่อยู่' },
  { key: 'ind', head: 'อุตสาหกรรม', kind: 'text', format: 'ข้อความ', meaning: 'กลุ่มอุตสาหกรรมตามใบรับรอง' },
  { key: 'size', head: 'ขนาดอุตสาหกรรม', kind: 'text', format: 'ข้อความ', meaning: 'ขนาดตามใบรับรอง' },
  { key: 'apBE', head: 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)', alias: ['วันที่อนุมัติ (พ.ศ.)', 'apBE'], kind: 'be', req: true, format: 'วว/ดด/ปปปป เป็น พ.ศ. เช่น 15/03/2568 หรือวันที่ของ Excel', meaning: 'วันที่อนุมัติใบรับรอง' },
  { key: 'exBE', head: 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)', alias: ['วันที่หมดอายุ (พ.ศ.)', 'exBE'], kind: 'be', req: true, format: 'วว/ดด/ปปปป เป็น พ.ศ. เช่น 14/03/2570 หรือวันที่ของ Excel', meaning: 'วันที่หมดอายุของใบรับรอง' },
  { key: 'ap', head: 'วันที่อนุมัติ (ค.ศ.)', alias: ['ap'], kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'คำนวณจากวันที่ พ.ศ. ระบบใช้คอลัมน์ พ.ศ. เท่านั้น' },
  { key: 'ex', head: 'วันที่หมดอายุ (ค.ศ.)', alias: ['ex'], kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'คำนวณจากวันที่ พ.ศ. ระบบใช้คอลัมน์ พ.ศ. เท่านั้น' },
  { key: 's1', head: 'ประเภทที่ 1 (%)', kind: 'pct', format: 'เปอร์เซ็นต์ เช่น 12.5% หรือ 12.5 (ถ้าไม่มีให้เว้นว่าง)', meaning: 'สัดส่วนประเภทที่ 1' },
  { key: 's2', head: 'ประเภทที่ 2 (%)', kind: 'pct', format: 'เปอร์เซ็นต์ เช่น 12.5% หรือ 12.5', meaning: 'สัดส่วนประเภทที่ 2' },
  { key: 's3', head: 'ประเภทที่ 3 (%)', kind: 'pct', format: 'เปอร์เซ็นต์ เช่น 12.5% หรือ 12.5', meaning: 'สัดส่วนประเภทที่ 3' },
  { key: 'total', head: 'รวม (%)', kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'ผลรวมของประเภทที่ 1–3 ระบบคำนวณให้' },
  { key: 'top', head: 'ประเภทที่มีสัดส่วนสูงสุด', kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'ประเภทที่มีสัดส่วนมากที่สุด ระบบคำนวณให้' },
  { key: 'status', head: 'สถานะ ณ วันที่ดึงข้อมูล', kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'สถานะตามวันหมดอายุ ณ วันที่ส่งออก (ดูคำในแอปด้านล่าง)' },
  { key: 'fy', head: 'ปีงบประมาณ (FY)', alias: ['ปีงบประมาณ'], kind: 'text', format: 'ข้อความ เช่น FY67', meaning: 'ปีงบประมาณของใบรับรอง' },
  { key: 'note', head: 'ข้อสังเกตข้อมูล', kind: 'text', format: 'ข้อความ', meaning: 'หมายเหตุเกี่ยวกับข้อมูลใบรับรองนี้' },
  { key: 'webId', head: 'รหัสรายการในเว็บ', kind: 'id', format: 'ตัวเลข เช่น 32040 หรือ 32,040', meaning: 'รหัสรายการบนเว็บ TGO ใช้จับคู่ใบรับรองก่อนชื่อและเลขที่' },
  { key: 'extra', head: 'ข้อความเพิ่มเติมในการ์ด', kind: 'skip', format: 'ไม่ต้องกรอก', meaning: 'ระบบยังไม่เก็บค่านี้ ไม่ใช้ค่านี้' },
];
export const SHEET_HEADS = SHEET_COLS.map((c) => c.head);

/** The values of one certificate as a sheet shows them and as the registry compares them (s1–s3 are fractions: 0.25 = 25%). */
export interface CertFields {
  cert: string; org: string; branch: string; act: string; addr: string; zip: string; prov: string; ind: string; size: string;
  ap: string; ex: string; fy: string; s1: number | null; s2: number | null; s3: number | null; note: string; webId: string;
}
/** Compared fields, in the sheet's order, with the label a preview shows. */
const COMPARE: [keyof CertFields, string][] = [
  ['cert', 'เลขที่ใบรับรอง'], ['org', 'ชื่อองค์กร'], ['branch', 'สาขา/รหัสสาขา'], ['act', 'ชื่อกิจกรรม/ประเภทธุรกิจ'],
  ['prov', 'จังหวัด'], ['addr', 'ที่อยู่'], ['zip', 'รหัสไปรษณีย์'], ['ind', 'อุตสาหกรรม'], ['size', 'ขนาดอุตสาหกรรม'],
  ['ap', 'วันที่อนุมัติ (พ.ศ.)'], ['ex', 'วันที่หมดอายุ (พ.ศ.)'], ['s1', 'ประเภทที่ 1 (%)'], ['s2', 'ประเภทที่ 2 (%)'],
  ['s3', 'ประเภทที่ 3 (%)'], ['fy', 'ปีงบประมาณ (FY)'], ['note', 'ข้อสังเกตข้อมูล'], ['webId', 'รหัสรายการในเว็บ'],
];

/** One data row of a sheet, read: its values, and the format errors that stop it (dates, percentages). */
export interface CertLine { rowNo: number; f: CertFields; errors: string[] }

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const validDate = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
/** The certificate key the registry matches on (cert no. + organisation), as the TGO sync builds it. */
export const certKey = (cert: string, org: string) => cert.replace(/\s+/g, '').toUpperCase() + '|' + norm(org);
const txtOf = (s: string) => s.replace(/\s+/g, ' ').trim();

/* ---------- reading ---------- */

type Cell = { t: 'n' | 's'; v: string } | undefined;
const ENT: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unesc = (s: string) =>
  s.replace(/&(#x[\da-fA-F]+|#\d+|[a-z]+);/g, (e, k: string) => {
    if (k[0] !== '#') return ENT[k] ?? e;
    const cp = k[1] === 'x' ? parseInt(k.slice(2), 16) : +k.slice(1);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : e;
  });
const colIdx = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** A .xlsx: the picked file (Blob) or its bytes. */
export type XlsxInput = Blob | ArrayBuffer | Uint8Array;
async function openZip(file: XlsxInput) {
  const { default: JSZip } = await import('jszip');
  try {
    return await JSZip.loadAsync(file);
  } catch {
    throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ .xlsx ที่เปิดได้ ลองบันทึกเป็น .xlsx ใหม่');
  }
}
async function sheetList(zx: Awaited<ReturnType<typeof openZip>>) {
  const wb = (await zx.file('xl/workbook.xml')?.async('string')) ?? '';
  const rels = (await zx.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
  const tgt: Record<string, string> = {};
  [...rels.matchAll(/<Relationship\b[^>]*>/g)].forEach((m) => {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) tgt[id] = t.replace(/^\/?xl\//, '');
  });
  return [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: unesc(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? ''),
    path: 'xl/' + (tgt[/\br:id="([^"]+)"/.exec(m[0])?.[1] ?? ''] ?? ''),
  }));
}

/** Which sheet a file's rows come from: the template or the TGO tab (new path), or the old full workbook. */
export async function workbookKind(file: XlsxInput): Promise<{ kind: 'template' | 'full' | 'none'; sheet: string; names: string[] }> {
  const names = (await sheetList(await openZip(file))).map((s) => s.name);
  if (names.includes(SHEET)) return { kind: 'template', sheet: SHEET, names };
  if (names.includes(FULL_SHEET)) return { kind: 'full', sheet: FULL_SHEET, names };
  if (names.includes(SHEET_TGO)) return { kind: 'template', sheet: SHEET_TGO, names };
  return { kind: 'none', sheet: '', names };
}

/** A sheet's rows with their sheet row numbers; cells by column index. */
async function sheetRows(file: XlsxInput, sheet: string): Promise<{ rowNo: number; cells: Cell[] }[]> {
  const zx = await openZip(file);
  const s = (await sheetList(zx)).find((x) => x.name === sheet);
  const f = s && zx.file(s.path);
  if (!f) throw new Error(`ไม่พบชีต ${sheet} ในไฟล์นี้`);
  const ssXml = (await zx.file('xl/sharedStrings.xml')?.async('string')) ?? '';
  const ss = [...ssXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) =>
    unesc([...(m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const cellOf = (attrs: string, body: string): Cell => {
    const t = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
    if (t === 'inlineStr') {
      const txt = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('');
      return txt ? { t: 's', v: unesc(txt) } : undefined;
    }
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    if (v == null || v.trim() === '') return undefined;
    if (t === 's') return { t: 's', v: ss[+v] ?? '' };
    if (t === 'n') return { t: 'n', v: v.trim() };
    return { t: 's', v: unesc(v) };
  };
  const xml = await f.async('string');
  const out: { rowNo: number; cells: Cell[] }[] = [];
  let seq = 0;
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    seq++;
    const rowNo = +((/\br="(\d+)"/.exec(r[1]) || [])[1] || seq);
    const cells: Cell[] = [];
    let next = 0;
    for (const c of (r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d*"/.exec(c[1]);
      const i = ref ? colIdx(ref[1]) : next;
      next = i + 1;
      cells[i] = cellOf(c[1], c[2] || '');
    }
    if (cells.some((c) => c && c.v.trim())) out.push({ rowNo, cells });
  }
  return out;
}

/** A text cell as text (a number as it is written, no thousands separators added). */
const textOf = (c: Cell) => (c ? txtOf(c.t === 'n' ? String(+c.v) : c.v) : '');
/** A certificate id: digits, optionally with thousands commas ("32,040" is 32040). */
const idOf = (c: Cell) => {
  if (!c) return '';
  if (c.t === 'n') return Number.isInteger(+c.v) ? String(+c.v) : c.v;
  const t = c.v.trim();
  return /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t;
};

/** A date in พ.ศ. (dd/mm/yyyy text) or an Excel date → ISO (ค.ศ.); '' when empty, an error text when not a date. */
export function readDateBE(c: Cell, label: string): { v: string } | { err: string } {
  if (!c) return { v: '' };
  if (c.t === 'n') {
    const n = Math.floor(+c.v);
    if (!(n > 0 && n < 2958466)) return { err: `${label} อ่านไม่ได้: ${c.v}` };
    const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5);
    let y = d.getUTCFullYear();
    if (y > 2400) y -= 543; // a year typed as พ.ศ. into a date cell
    // a bare 2568 is a serial day in 1907: a certificate date is never that old
    if (y < 1950) return { err: `${label} ต้องเป็นวว/ดด/ปปปป เป็น พ.ศ. เช่น 15/03/2568: ${c.v}` };
    return { v: isoOf(y, d.getUTCMonth() + 1, d.getUTCDate()) };
  }
  const t = c.v.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  let y: number, mo: number, dd: number;
  if (m) {
    dd = +m[1];
    mo = +m[2];
    y = +m[3];
  } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
    y = +m[1];
    mo = +m[2];
    dd = +m[3];
  } else return { err: `${label} ต้องเป็นวว/ดด/ปปปป เป็น พ.ศ. เช่น 15/03/2568: ${t}` };
  if (y < 2400) return { err: `${label} ต้องเป็นปี พ.ศ. (เช่น 2568 ไม่ใช่ 2025): ${t}` };
  y -= 543;
  if (!validDate(y, mo, dd)) return { err: `${label} อ่านไม่ได้: ${t}` };
  return { v: isoOf(y, mo, dd) };
}

/**
 * A share read as a fraction, the way the app keeps it (0.6 = 60%): "12.20%" and "12.2" are 0.122, and 0.122 (up to 1
 * without a % sign) is already a fraction. A number above 1 without % is a percent. '' → null.
 */
export function readPct(c: Cell, label: string): { v: number | null } | { err: string } {
  if (!c || !c.v.trim()) return { v: null };
  const t = c.v.trim();
  const isPct = c.t === 's' && /%$/.test(t);
  const body = isPct ? t.replace(/%$/, '').trim() : t;
  const x = c.t === 'n' ? +body : /^-?\d+(\.\d+)?$/.test(body) ? +body : NaN;
  if (!isFinite(x) || x < 0) return { err: `${label} ไม่ใช่ตัวเลข: ${t}` };
  const frac = isPct || x > 1 ? x / 100 : x;
  return { v: Math.round(frac * 10000) / 10000 };
}

/** Rows of the certificate sheet (SHEET or the TGO tab), read by header name. Blank rows are not rows. */
export async function readCertSheet(file: XlsxInput, sheet: string): Promise<CertLine[]> {
  const rows = await sheetRows(file, sheet);
  const head = rows.find((r) => r.rowNo === 1);
  if (!head) throw new Error('ไม่พบหัวคอลัมน์ในแถวที่ 1');
  const at: Record<string, number> = {};
  const hn = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const byName = new Map<string, number>();
  head.cells.forEach((c, i) => c && c.v.trim() && byName.set(hn(c.v), i));
  for (const col of SHEET_COLS) {
    for (const name of [col.head, ...(col.alias || [])]) {
      const i = byName.get(hn(name));
      if (i != null) {
        at[col.key] = i;
        break;
      }
    }
  }
  const missing = SHEET_COLS.filter((c) => c.req && at[c.key] == null).map((c) => `"${c.head}"`);
  if (missing.length) throw new Error(`ไม่พบคอลัมน์ ${missing.join(', ')} ในแถวที่ 1`);
  return rows
    .filter((r) => r.rowNo > 1)
    .map(({ rowNo, cells }) => {
      const C = (k: string): Cell => (at[k] == null ? undefined : cells[at[k]]);
      // format errors only here; a blank required cell is judged when planning (a held certificate may have one)
      const errors: string[] = [];
      const ap = readDateBE(C('apBE'), 'วันที่อนุมัติ (พ.ศ.)');
      const ex = readDateBE(C('exBE'), 'วันที่หมดอายุ (พ.ศ.)');
      if ('err' in ap) errors.push(ap.err);
      if ('err' in ex) errors.push(ex.err);
      const pcts = (['s1', 's2', 's3'] as const).map((k, i) => {
        const p = readPct(C(k), `ประเภทที่ ${i + 1} (%)`);
        if ('err' in p) errors.push(p.err);
        return 'err' in p ? null : p.v;
      });
      const f: CertFields = {
        cert: textOf(C('cert')), org: fixName(textOf(C('org'))), branch: textOf(C('branch')), act: textOf(C('act')),
        addr: textOf(C('addr')), zip: textOf(C('zip')), prov: textOf(C('prov')), ind: textOf(C('ind')), size: textOf(C('size')),
        ap: 'v' in ap ? ap.v : '', ex: 'v' in ex ? ex.v : '', fy: textOf(C('fy')), s1: pcts[0], s2: pcts[1], s3: pcts[2],
        note: textOf(C('note')), webId: idOf(C('webId')),
      };
      return { rowNo, f, errors };
    });
}

/* ---------- writing: the template and the export ---------- */

/** A fraction as the percent the sheet shows: 0.6 → "60%", 0.0029 → "0.29%". */
const pctText = (v: number | null): XCell => (v == null ? null : `${Math.round(v * 10000) / 100}%`);
const beText = (iso: string): XCell => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${+iso.slice(0, 4) + 543}` : null);
const adDate = (iso: string): XCell => (iso ? { date: iso } : null);
const txt = (s: string): XCell => s || null;

/** One certificate as a sheet row (27 cells, in SHEET_COLS order). `today` (ISO) dates the status column. */
export function certRow(f: CertFields, i: number, today: string): XCell[] {
  const pcts = [f.s1, f.s2, f.s3];
  const has = pcts.some((v) => v != null);
  const sum = pcts.reduce<number>((a, v) => a + (v ?? 0), 0);
  const top = has ? `ประเภทที่ ${pcts.indexOf(Math.max(...pcts.map((v) => v ?? -Infinity))) + 1}` : '';
  const status = f.ex ? (f.ex >= today ? 'อยู่ในอายุ' : 'หมดอายุ') : 'ไม่ระบุวันหมดอายุ';
  return [
    String(i + 1), txt(f.cert), txt(f.act), txt(f.org), txt(f.branch), txt(f.prov), txt(f.addr), null, null, null,
    txt(f.zip), txt(f.ind), txt(f.size), beText(f.ap), beText(f.ex), adDate(f.ap), adDate(f.ex),
    pctText(f.s1), pctText(f.s2), pctText(f.s3), has ? pctText(sum) : null, top || null, status,
    txt(f.fy), txt(f.note), txt(f.webId), null,
  ];
}
const WIDTHS = [7, 22, 30, 40, 18, 18, 44, 14, 14, 16, 12, 22, 16, 18, 18, 14, 14, 12, 12, 12, 12, 18, 14, 10, 40, 16, 24];
const DESC_WORDS: [string, string][] = [
  ['ใบรับรอง CFO', 'ใบรับรองการคำนวณคาร์บอนฟุตพริ้นท์ขององค์กร (CFO) ที่ อบก. ออกให้'],
  ['อยู่ในอายุ', 'ใบรับรองยังไม่หมดอายุ'],
  ['หมดอายุ', 'วันหมดอายุของใบรับรองผ่านไปแล้ว'],
  ['ไม่ระบุวันหมดอายุ', 'ไม่มีวันหมดอายุในข้อมูล'],
  ['ยังไม่มี CFO', 'บริษัทที่ยังไม่มีใบรับรองในระบบ'],
  ['ประเภทที่ 1–3', 'สัดส่วนของ CFO แยกตามประเภทที่ อบก. กำหนด'],
  ['ปีงบประมาณ (FY)', 'ปีงบประมาณที่ใบรับรองอ้างถึง เช่น FY67'],
  ['บริษัทใหม่', 'บริษัทที่ไม่พบชื่อในระบบ จะถูกสร้างเมื่อบันทึกการนำเข้า'],
];
/** The description sheet: each column, whether it is required, its format and what it means, then the words the app uses. */
function descSheet(): XSheet {
  const rows: XCell[][] = SHEET_COLS.map((c, i) => [String(i + 1), c.head, c.req ? 'ต้องกรอก' : c.kind === 'skip' ? 'ไม่ต้องกรอก' : 'ไม่บังคับ', c.format, c.meaning]);
  rows.push([], ['คำที่ใช้ในแอป', 'ความหมาย']);
  DESC_WORDS.forEach(([w, m]) => rows.push([null, w, null, null, m]));
  rows.push([], ['หมายเหตุ'], [null, 'ใส่ 12.5% หรือ 12.5 สำหรับเปอร์เซ็นต์ ค่า 1 หรือต่ำกว่าที่ไม่มีเครื่องหมาย % ระบบถือเป็นเศษส่วน (0.122 = 12.2%)']);
  rows.push([null, 'แถวตัวอย่างในชีต ใบรับรอง CFO ลบทิ้งก่อนนำเข้า ไม่เช่นนั้นระบบจะนำเข้าเป็นใบรับรองจริง']);
  rows.push([null, 'ค่าที่ระบบคำนวณให้ (ค.ศ. รวม ประเภทที่มีสัดส่วนสูงสุด สถานะ) จะถูกละเว้นเมื่อนำเข้า']);
  return { name: SHEET_DESC, head: ['ลำดับ', 'คอลัมน์', 'ต้องกรอก', 'รูปแบบ', 'ความหมาย'], rows, widths: [8, 30, 14, 48, 64] };
}
function registrySheet(rows: CertFields[], today: string): XSheet {
  return { name: SHEET, head: SHEET_HEADS, rows: rows.map((f, i) => certRow(f, i, today)), widths: WIDTHS };
}
const EXAMPLE: CertFields = {
  cert: 'CFO-EXAMPLE-0001', org: 'บริษัท ตัวอย่าง จำกัด', branch: 'สำนักงานใหญ่', act: 'การผลิตสินค้า',
  addr: '1 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10110', zip: '10110', prov: 'กรุงเทพมหานคร', ind: 'การผลิต',
  size: 'ขนาดเล็ก', ap: '2025-01-01', ex: '2027-12-31', fy: 'FY67', s1: 0.6, s2: 0.3, s3: 0.1,
  note: 'แถวตัวอย่าง ลบทิ้งก่อนนำเข้า', webId: '32040',
};
/** The template: the example row in the registry sheet, then the description sheet. */
export function templateSheets(): XSheet[] {
  return [registrySheet([EXAMPLE], todayOf()), descSheet()];
}
/** The export: the certificates given (CertFields), in the same headers and description. */
export function exportSheets(certs: CertFields[], today: string): XSheet[] {
  return [registrySheet(certs, today), descSheet()];
}
function todayOf() {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/* ---------- planning and saving ---------- */

/** A certificate the app holds: where it is kept (the base dataset or the added list) and its values. */
/** `gid` is the company id the certificate is stored under (not the id of the company it is merged into). */
export interface HeldCert { origin: 'base' | 'tgo'; idx: number; gid: number; f: CertFields }
export interface PlanNew { rowNo: number; f: CertFields; gid: number }
export interface PlanChange { rowNo: number; f: CertFields; gid: number; fields: string[]; origin: 'base' | 'tgo'; idx: number }
/** What one sheet save added or changed in the saved lists, so the revert takes exactly that back (engine.revertUpload). */
export interface CertImportRec {
  at: string;
  fileName: string;
  /** the TGO-list rows the save appended: from `tgoStart`, `tgoAdded` of them */
  tgoStart: number;
  tgoAdded: number;
  /** the company ids the save created */
  coIds: number[];
  /** the TGO-list rows the save changed, as they were before */
  tgoPrev: { idx: number; cert: Partial<Cert> }[];
}
export interface CertPlan {
  read: number;
  news: PlanNew[];
  same: number;
  changed: PlanChange[];
  errors: { rowNo: number; reason: string }[];
  companies: { id: number; name: string }[];
}

const fieldText = (f: CertFields, k: keyof CertFields) => {
  const v = f[k];
  if (k === 's1' || k === 's2' || k === 's3') return v == null ? '' : String(Math.round((v as number) * 10000));
  return txtOf(String(v ?? ''));
};

/** Cells a certificate must have to be new; a held one may not have them blanked. */
const REQUIRED: [keyof CertFields, string][] = [['cert', 'เลขที่ใบรับรอง'], ['org', 'ชื่อองค์กร'], ['ap', 'วันที่อนุมัติ (พ.ศ.)'], ['ex', 'วันที่หมดอายุ (พ.ศ.)']];
const missingOf = (f: CertFields, held?: CertFields) =>
  REQUIRED.filter(([k]) => !f[k] && (held === undefined || held[k])).map(([, label]) => `ต้องกรอก ${label}`);
const numberOf = (c: string) => c.replace(/\s+/g, '').toUpperCase();

/** The sheet's rows against what the app holds: new, same, changed (which fields), and rows that cannot be saved. */
export function planCertRows(lines: CertLine[], held: HeldCert[], companies: { id: number; name: string }[]): CertPlan {
  const byNorm = new Map<string, number>();
  companies.forEach((c) => {
    const k = norm(c.name);
    if (k && !byNorm.has(k)) byNorm.set(k, c.id);
  });
  let nextId = Math.max(900000, ...companies.filter((c) => c.id < 1e12).map((c) => c.id)) + 1;
  const newCos: { id: number; name: string }[] = [];
  const gidOf = (org: string) => {
    const k = norm(org);
    let g = byNorm.get(k);
    if (g == null) {
      g = nextId++;
      byNorm.set(k, g);
      newCos.push({ id: g, name: org });
    }
    return g;
  };
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) || []), v]);
  const byWeb = new Map<string, HeldCert[]>(), byKey = new Map<string, HeldCert[]>(), byNo = new Map<string, HeldCert[]>();
  held.forEach((h) => {
    if (h.f.webId) push(byWeb, h.f.webId, h);
    if (h.f.cert) {
      push(byKey, certKey(h.f.cert, h.f.org), h);
      push(byNo, numberOf(h.f.cert), h);
    }
  });
  // a web id names a record only with the same number or the same organisation (a typed id is not enough)
  const sameRecord = (f: CertFields, h: HeldCert) => (!!f.cert && numberOf(f.cert) === numberOf(h.f.cert)) || (!!f.org && norm(f.org) === norm(h.f.org));
  // the held certificate a row means: the web id, else number + organisation, else the only one with its number
  const find = (f: CertFields): HeldCert | undefined => {
    const w = f.webId ? (byWeb.get(f.webId) || []).find((h) => sameRecord(f, h)) : undefined;
    if (w) return w;
    if (!f.cert) return undefined;
    const k = byKey.get(certKey(f.cert, f.org));
    // the first one with this number and organisation that an earlier row has not taken
    if (k) return k.find((h) => !usedBy.has(h)) ?? k[0];
    const n = byNo.get(numberOf(f.cert));
    return n && n.length === 1 ? n[0] : undefined;
  };
  const usedBy = new Map<HeldCert, number>();
  const newKeys = new Map<string, number>();
  const plan: CertPlan = { read: lines.length, news: [], same: 0, changed: [], errors: [], companies: newCos };
  for (const L of lines) {
    if (L.errors.length) {
      plan.errors.push({ rowNo: L.rowNo, reason: L.errors.join(' · ') });
      continue;
    }
    const f = L.f;
    const h = find(f);
    if (!h) {
      const missing = missingOf(f);
      if (missing.length) {
        plan.errors.push({ rowNo: L.rowNo, reason: missing.join(' · ') });
        continue;
      }
      const k = certKey(f.cert, f.org);
      if (newKeys.has(k)) {
        plan.errors.push({ rowNo: L.rowNo, reason: `ซ้ำกับแถว ${newKeys.get(k)}` });
        continue;
      }
      newKeys.set(k, L.rowNo);
      plan.news.push({ rowNo: L.rowNo, f, gid: gidOf(f.org) });
      continue;
    }
    const first = usedBy.get(h);
    if (first != null) {
      plan.errors.push({ rowNo: L.rowNo, reason: `ตรงกับใบรับรองเดียวกับแถว ${first}` });
      continue;
    }
    const blanked = missingOf(f, h.f);
    if (blanked.length) {
      plan.errors.push({ rowNo: L.rowNo, reason: blanked.join(' · ') });
      continue;
    }
    usedBy.set(h, L.rowNo);
    const fields = COMPARE.filter(([k]) => fieldText(f, k) !== fieldText(h.f, k)).map(([, label]) => label);
    const gid = norm(f.org) === norm(h.f.org) ? h.gid : gidOf(f.org);
    if (fields.length) plan.changed.push({ rowNo: L.rowNo, f, gid, fields, origin: h.origin, idx: h.idx });
    else plan.same++;
  }
  return plan;
}

/** The held certificates of the registry, with where each is kept (`baseCount`: how many are in the base dataset). */
export function heldFrom(certs: Cert[], baseCount: number, CD: CertDicts): HeldCert[] {
  return certs.map((c) => ({
    origin: c.cid < baseCount ? 'base' : 'tgo',
    idx: c.cid < baseCount ? c.cid : c.cid - baseCount,
    gid: c.gid0 ?? c.gid,
    f: certFields(c, CD),
  }));
}
/** A stored or built certificate's values as text (the dictionaries resolve the indexes; the text fields are the fallback). */
export function certFields(c: Partial<Cert>, CD: CertDicts): CertFields {
  const at = (a: string[], i: number | undefined) => (i != null && i >= 0 ? a[i] || '' : '');
  return {
    cert: c.cert || '', org: fixName(c.org || ''), branch: c.branch || '', act: c.act || '', addr: c.addr || '', zip: c.zip || '',
    prov: c.provTxt || at(CD.prov, c.prov), ind: at(CD.ind, c.ind) || c.indTxt || '', size: at(CD.size, c.size),
    ap: c.ap || '', ex: c.ex || '', fy: at(CD.fy, c.fy), s1: c.s1 ?? null, s2: c.s2 ?? null, s3: c.s3 ?? null,
    note: c.note || '', webId: String(c.webId ?? '').trim(),
  };
}

/**
 * The plan written into the saved lists: changed base certificates in the base dataset, changed added ones and
 * new certificates in the added list (tgoCerts), new companies into addedCos, dictionary texts appended to the
 * base dictionaries. Returns the new lists; nothing is mutated.
 */
export function applyCertPlan(plan: CertPlan, base: Dataset, tgo: Partial<Cert>[], added: Partial<RawCompany>[], fileName: string, at: string) {
  const changes = plan.news.length + plan.changed.length + plan.companies.length;
  if (!changes) return { base, tgo, added, changed: false, baseChanged: false, tgoChanged: false, addedChanged: false };
  const CD: CertDicts = { ind: [...base.cdicts.ind], size: [...base.cdicts.size], prov: [...base.cdicts.prov], fy: [...base.cdicts.fy] };
  const D = Object.fromEntries(Object.entries(base.dicts).map(([k, v]) => [k, [...(v as string[])]])) as unknown as Dicts;
  const ci = (k: keyof CertDicts, v: string) => {
    let i = CD[k].indexOf(v);
    if (i < 0) {
      CD[k].push(v);
      i = CD[k].length - 1;
    }
    return i;
  };
  const di = (k: keyof Dicts, v: string) => {
    let i = D[k].indexOf(v);
    if (i < 0) {
      D[k].push(v);
      i = D[k].length - 1;
    }
    return i;
  };
  const write = (f: CertFields, gid: number) => ({
    gid, cert: f.cert, org: f.org, branch: f.branch, act: f.act, ind: ci('ind', f.ind), size: ci('size', f.size), addr: f.addr,
    prov: ci('prov', f.prov), zip: f.zip, ap: f.ap, ex: f.ex, fy: ci('fy', f.fy), s1: f.s1, s2: f.s2, s3: f.s3, webId: f.webId, note: f.note,
  });
  const certs = base.certs.slice();
  const tgo2 = tgo.slice();
  let tgoChanged = false;
  for (const ch of plan.changed) {
    if (ch.origin === 'base') {
      const a = certs[ch.idx] as unknown;
      const o: Record<string, unknown> = {};
      if (Array.isArray(a)) CCOLS.forEach((c, j) => (o[c] = a[j]));
      else Object.assign(o, a);
      Object.assign(o, write(ch.f, ch.gid));
      certs[ch.idx] = CCOLS.map((c) => o[c]);
    } else {
      tgo2[ch.idx] = { ...tgo2[ch.idx], ...write(ch.f, ch.gid), indTxt: undefined, provTxt: undefined };
      tgoChanged = true;
    }
  }
  for (const n of plan.news) {
    tgo2.push({ ...write(n.f, n.gid), phone: '', email: '' });
    tgoChanged = true;
  }
  const addedNew: Partial<RawCompany>[] = plan.companies.map((c) => ({
    id: c.id, name: c.name, jur: '', type: di('type', 'ไม่ระบุ'), prov: di('prov', ''), addr: '', ind: di('ind', 'ไม่ระบุ'),
    biz: '', src: 1, tgt: 0, cfo: di('cfo', 'อยู่ในอายุ'), cfoN: 0, cfoEx: '', giNow: null, giMax: null, giUntil: '', newYm: '',
    invest: null, fac: null, set: '', mkt: '', phone: '', email: '', web: '', ct: 0, match: 0,
  }));
  // any change touches the base: its dictionaries carry the texts and the companies' indexes
  const next: Dataset = { ...base, dicts: D, cdicts: CD, certs, source: 'upload', fileName, uploadedAt: at };
  return { base: next, tgo: tgo2, added: [...added, ...addedNew], changed: true, baseChanged: true, tgoChanged, addedChanged: addedNew.length > 0 };
}
