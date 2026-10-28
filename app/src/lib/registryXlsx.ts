/**
 * The CFO certificate sheet: the template to fill in, the export of the certificates the app holds, and the
 * reader that turns a sheet back into rows. Columns are read by HEADER NAME in row 1 (aliases below, the old
 * apBE/exBE names of project/cfo-import.js included), never by letter. A workbook with a ทะเบียนบริษัท sheet is
 * the old full upload: core.ts still reads it (sheet TGO_CFO by letter), and this module leaves it alone.
 *
 * A save plans every row against the companies, the held certificates, the TGO review queue and the review list
 * (planCertRows) and reports what each row does (CertLogEntry). No import creates a company: a row whose company
 * cannot be settled goes to the review list (sheetReview.ts) instead.
 */
import type { Cert, CertDicts, Dataset, Dicts, RawCompany } from './types';
import { CCOLS, fixName } from './core';
import { gccCode } from './format';
import type { XCell, XSheet } from './xlsx';
import { normOrg, provName } from './tgoSync';
import { reviewIdOf } from './sheetReview';

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
  { key: 'org', head: 'ชื่อองค์กร', kind: 'text', req: true, format: 'ข้อความ', meaning: 'ชื่อตรงกับบริษัทในระบบจะผูกใบรับรองกับบริษัทนั้น ถ้าไม่พบใบนี้จะไปอยู่ในรายการรอตรวจสอบ ไม่สร้างบริษัทใหม่' },
  { key: 'branch', head: 'สาขา/รหัสสาขา', alias: ['สาขา'], kind: 'text', format: 'ข้อความ', meaning: 'สาขาหรือรหัสสาขา (ถ้าไม่มี ใช้เลขในวงเล็บท้ายชื่อองค์กร)' },
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
/** Columns beyond the template. The GCC code and the e-mail are read (R3a, R8); the e-mail source, its check note are
 *  read-only (R9). The check note's head carries the check date after it, so it is matched by its start (`prefix`). */
export const EXTRA_COLS: { key: string; head: string; prefix?: boolean }[] = [
  { key: 'gcc', head: 'รหัสบริษัท (GCC)' },
  { key: 'email', head: 'อีเมล' },
  { key: 'emailSrc', head: 'แหล่งที่มาของอีเมล' },
  { key: 'emailSt', head: 'สถานะการค้นหาอีเมล' },
  { key: 'emailNote', head: 'หมายเหตุการตรวจสอบอีเมล', prefix: true },
];
/** The two columns the export writes after the template's 27 (R12). */
export const EXPORT_HEADS = ['รหัสบริษัท (GCC)', 'อีเมล'];

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

/** One data row of a sheet, read: its values, and the format errors that stop it (dates, percentages). `gcc`, `email` and
 *  `emailSt` are the cells as written; `vals` is every column's text by its header (the review list keeps them). */
export interface CertLine {
  rowNo: number; f: CertFields; errors: string[];
  gcc?: string; email?: string; emailSt?: string; vals?: Record<string, string>;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const validDate = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
/** The certificate key the registry matches on (cert no. + organisation), as the TGO sync builds it: the queue's organisation
 *  key (normOrg, which keeps the legal form), so a sheet and the queue name one certificate the same way. */
export const certKey = (cert: string, org: string) => cert.replace(/\s+/g, '').toUpperCase() + '|' + normOrg(org);
const numberOf = (c: string) => c.replace(/\s+/g, '').toUpperCase();
/** The same certificate, as a web id names it: when both carry a number, the number decides, so a web id copied onto a
 *  certificate with another number (even of the same organisation) is another certificate and never overwrites it; with
 *  no number on one side, the same organisation. */
export const sameRecord = (a: { cert: string; org: string }, b: { cert: string; org: string }) => {
  const an = numberOf(a.cert), bn = numberOf(b.cert);
  if (an && bn) return an === bn;
  return !!a.org && normOrg(a.org) === normOrg(b.org);
};
/** The import tag a sheet save puts on a queue row's note, after the sheet's own note. */
export const IMPORT_TAG = 'นำเข้าจากไฟล์ ';
/** The sheet's own part of a queue certificate's note: the import tag and a pull's tag are the app's, not the sheet's. */
export const sheetNoteOf = (note: string): string => {
  const t = String(note || '').trim();
  const i = t.lastIndexOf(IMPORT_TAG);
  if (i >= 0) return t.slice(0, i).replace(/ · $/, '').trim();
  return /^ดึงจาก/.test(t) ? '' : t;
};
const txtOf = (s: string) => s.replace(/\s+/g, ' ').trim();
/** The header a column is matched by: no spaces, lower case (the template's own spelling is the reference). */
const headKey = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const KNOWN_HEADS = [...SHEET_COLS.flatMap((c) => [c.head, ...(c.alias || [])]), ...EXTRA_COLS.map((c) => c.head)].map(headKey);
/** A header the import knows: a template column (or its alias), an extra column, or a check note with its date. */
const isKnownHead = (h: string) => {
  const k = headKey(h);
  return KNOWN_HEADS.includes(k) || EXTRA_COLS.some((c) => c.prefix && k.startsWith(headKey(c.head)));
};

/** Why a sheet row is not applied as an ordinary import row (the change report's messages). */
export const TGO_EDIT_REFUSED = 'ใบนี้อยู่ในรายการ TGO แล้ว แก้จากไฟล์นี้ไม่ได้ ไม่บันทึกแถวนี้ · ใบที่ยังรอตรวจให้รับหรือไม่รับในรายการรอตรวจ TGO ก่อน ใบที่รับเข้าทะเบียนแล้วให้แจ้งผู้ดูแลทะเบียนเพื่อแก้ใบนั้น';
/** The template's example row (R11): skipped on a save. */
const EXAMPLE_CERT = 'CFO-EXAMPLE-0001';
/** The status of the e-mail search that makes a row's e-mail count (R8). */
const EMAIL_FOUND = 'พบ';

/* ---------- codes, names, branches ---------- */

/** The company id a GCC code names: the inverse of gccCode (format.ts). GCC-000361 → 361, TGO-n → 900000 + n (a device-local
 *  company), NEW-x → 1e12 + x (a customer added by hand). Digits need not be padded. Anything else → null. */
export function gccIdOf(code: string): number | null {
  const t = String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
  let m = /^GCC-(\d{1,9})$/.exec(t);
  if (m) return +m[1];
  if ((m = /^TGO-(\d{1,9})$/.exec(t))) return 900000 + +m[1];
  if ((m = /^NEW-([0-9A-Z]{1,12})$/.exec(t))) {
    const n = parseInt(m[1], 36);
    return Number.isFinite(n) ? 1e12 + n : null;
  }
  return null;
}
/** The name a sheet's organisation is matched on (R3b): legal forms, spaces, case, head-office markers (สำนักงานใหญ่) and
 *  a bracketed numeric suffix such as (65), (0001), (00000) are ignored. Separate from core's norm, which other callers keep. */
export function importNameKey(s: unknown): string {
  return String(s ?? '')
    .replace(/\(\s*(?:สำนักงานใหญ่|\d+)\s*\)/g, '')
    .replace(/สำนักงานใหญ่/g, '')
    .replace(/บริษัท|บจก\.?|บมจ\.?|จำกัด|มหาชน|ห้างหุ้นส่วน|หจก\.?|สามัญ|นิติบุคคล/g, '')
    .replace(/[().,\s]+/g, '')
    .toLowerCase();
}
/** The branch a bracketed numeric suffix names ("(65)" → "65", "(0001)" → "0001"); '' when there is none, or for the head
 *  office's (00000). */
export function branchOfName(s: unknown): string {
  const m = /\(\s*(\d+)\s*\)\s*$/.exec(String(s ?? ''));
  return m && !/^0+$/.test(m[1]) ? m[1] : '';
}
/** The addresses a text lists: split on ";", ",", "|" or a line break, trimmed, empty parts dropped (R8). */
const addressesOf = (s: string): string[] => String(s ?? '').split(/[;,|\r\n]/).map((x) => x.trim()).filter(Boolean);
/** A sheet's e-mail cell as addresses (R8): addressesOf, duplicates dropped (case does not count), in order. */
export function splitEmails(s: string): string[] {
  const seen = new Map<string, string>();
  addressesOf(s).forEach((a) => {
    if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a);
  });
  return [...seen.values()];
}
/**
 * A company's e-mail after the sheet's addresses (R8, v3). The addresses the company holds come first, as they are: none is
 * removed or replaced. Then come the sheet's addresses it does not hold yet (case does not count), and the result is joined
 * with " | ". `filled` when one such address is new, with `to` the combined value. `kept` when none is new: the company's value
 * stays as it is and nothing is written.
 */
export function mergeCoEmail(have: string, sheet: string[]): { action: 'filled' | 'kept'; to: string } {
  const own = addressesOf(have);
  const seen = new Set(own.map((a) => a.toLowerCase()));
  const fresh = sheet.filter((a) => {
    if (seen.has(a.toLowerCase())) return false;
    seen.add(a.toLowerCase());
    return true;
  });
  return fresh.length ? { action: 'filled', to: [...own, ...fresh].join(' | ') } : { action: 'kept', to: have };
}

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
/** A cell's text as written, its line breaks kept: an e-mail cell may list one address to a line (R8). */
const rawOf = (c: Cell) => (c ? (c.t === 'n' ? String(+c.v) : c.v) : '');
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

/** Rows of the certificate sheet (SHEET or the TGO tab), read by header name, and the headers the import does not know
 *  (R10: listed in the preview, never silent). Blank rows are not rows. */
export async function readCertSheetFull(file: XlsxInput, sheet: string): Promise<{ lines: CertLine[]; unknown: string[] }> {
  const rows = await sheetRows(file, sheet);
  const head = rows.find((r) => r.rowNo === 1);
  if (!head) throw new Error('ไม่พบหัวคอลัมน์ในแถวที่ 1');
  const at: Record<string, number> = {};
  const byName = new Map<string, number>();
  const headTxt: string[] = [];
  head.cells.forEach((c, i) => {
    if (c && c.v.trim()) {
      headTxt[i] = c.v.trim();
      byName.set(headKey(c.v), i);
    }
  });
  for (const col of SHEET_COLS) {
    for (const name of [col.head, ...(col.alias || [])]) {
      const i = byName.get(headKey(name));
      if (i != null) {
        at[col.key] = i;
        break;
      }
    }
  }
  for (const col of EXTRA_COLS) {
    const pre = col.prefix ? [...byName.keys()].find((n) => n.startsWith(headKey(col.head))) : undefined;
    const i = byName.get(headKey(col.head)) ?? (pre != null ? byName.get(pre) : undefined);
    if (i != null) at[col.key] = i;
  }
  const missing = SHEET_COLS.filter((c) => c.req && at[c.key] == null).map((c) => `"${c.head}"`);
  if (missing.length) throw new Error(`ไม่พบคอลัมน์ ${missing.join(', ')} ในแถวที่ 1`);
  const unknown = headTxt.filter((h) => !isKnownHead(h));
  const lines = rows
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
        addr: textOf(C('addr')), zip: textOf(C('zip')), prov: provName(textOf(C('prov'))), ind: textOf(C('ind')), size: textOf(C('size')),
        ap: 'v' in ap ? ap.v : '', ex: 'v' in ex ? ex.v : '', fy: textOf(C('fy')), s1: pcts[0], s2: pcts[1], s3: pcts[2],
        note: textOf(C('note')), webId: idOf(C('webId')),
      };
      const vals: Record<string, string> = {};
      headTxt.forEach((h, i) => {
        const t = textOf(cells[i]);
        if (t) vals[h] = t;
      });
      return { rowNo, f, errors, gcc: textOf(C('gcc')), email: rawOf(C('email')), emailSt: textOf(C('emailSt')), vals };
    });
  return { lines, unknown };
}
/** The rows only (readCertSheetFull without the unknown headers). */
export async function readCertSheet(file: XlsxInput, sheet: string): Promise<CertLine[]> {
  return (await readCertSheetFull(file, sheet)).lines;
}

/* ---------- writing: the template and the export ---------- */

/** A fraction as the percent the sheet shows: 0.6 → "60%", 0.0029 → "0.29%". */
const pctText = (v: number | null): XCell => (v == null ? null : `${Math.round(v * 10000) / 100}%`);
/** An ISO date as the พ.ศ. text the sheet shows ("15/03/2568"); '' when none. */
const beStr = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${+iso.slice(0, 4) + 543}` : '');
const beText = (iso: string): XCell => beStr(iso) || null;
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
  ['บริษัทที่ไม่พบในระบบ', 'ชื่อหรือรหัส GCC ไม่ตรงกับบริษัทในระบบ ใบนี้ไปอยู่ในรายการรอตรวจสอบจากไฟล์ชีต ระบบไม่สร้างบริษัทใหม่'],
  ['รอตรวจ', 'ใบรับรองใหม่ที่บันทึกจากชีตนี้ รอการรับในรายการรอตรวจ TGO ยังไม่เข้าทะเบียนจนกว่าจะรับ'],
];
/** The description sheet: each column, whether it is required, its format and what it means, then the words the app uses. */
function descSheet(): XSheet {
  const rows: XCell[][] = SHEET_COLS.map((c, i) => [String(i + 1), c.head, c.req ? 'ต้องกรอก' : c.kind === 'skip' ? 'ไม่ต้องกรอก' : 'ไม่บังคับ', c.format, c.meaning]);
  rows.push([], ['คำที่ใช้ในแอป', 'ความหมาย']);
  DESC_WORDS.forEach(([w, m]) => rows.push([null, w, null, null, m]));
  rows.push([], ['หมายเหตุ'], [null, 'ใส่ 12.5% หรือ 12.5 สำหรับเปอร์เซ็นต์ ค่า 1 หรือต่ำกว่าที่ไม่มีเครื่องหมาย % ระบบถือเป็นเศษส่วน (0.122 = 12.2%)']);
  rows.push([null, 'แถวตัวอย่างในชีต ใบรับรอง CFO ลบทิ้งก่อนนำเข้า ไม่เช่นนั้นระบบจะนำเข้าเป็นใบรับรองจริง']);
  rows.push([null, 'ค่าที่ระบบคำนวณให้ (ค.ศ. รวม ประเภทที่มีสัดส่วนสูงสุด สถานะ) จะถูกละเว้นเมื่อนำเข้า']);
  rows.push([null, 'ค่าว่างไม่เปลี่ยนค่าที่มีอยู่ในระบบ แต่ช่องที่ต้องกรอก (เลขที่ใบรับรอง ชื่อองค์กร วันที่อนุมัติ วันที่หมดอายุ) ว่างไม่ได้ แถวนั้นจะไม่ถูกนำเข้า']);
  rows.push([null, 'ท้ายไฟล์ส่งออกมีรหัสบริษัท (GCC) และอีเมล ใช้จับคู่บริษัทตอนนำเข้า อีเมลจากชีตจะเพิ่มเฉพาะอีเมลที่บริษัทยังไม่มี ต่อท้ายอีเมลเดิม ไม่ลบและไม่แทนที่อีเมลเดิม']);
  return { name: SHEET_DESC, head: ['ลำดับ', 'คอลัมน์', 'ต้องกรอก', 'รูปแบบ', 'ความหมาย'], rows, widths: [8, 30, 14, 48, 64] };
}
/** A certificate to write, with the company it belongs to: its GCC code and e-mail (the export's last two columns). */
export interface ExportRow { f: CertFields; gcc: string; email: string }
function registrySheet(rows: ExportRow[], today: string, withCo: boolean): XSheet {
  return {
    name: SHEET,
    head: withCo ? [...SHEET_HEADS, ...EXPORT_HEADS] : SHEET_HEADS,
    rows: rows.map((r, i) => [...certRow(r.f, i, today), ...(withCo ? [txt(r.gcc), txt(r.email)] : [])]),
    widths: withCo ? [...WIDTHS, 18, 40] : WIDTHS,
  };
}
const EXAMPLE: CertFields = {
  cert: EXAMPLE_CERT, org: 'บริษัท ตัวอย่าง จำกัด', branch: 'สำนักงานใหญ่', act: 'การผลิตสินค้า',
  addr: '1 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10110', zip: '10110', prov: 'กรุงเทพมหานคร', ind: 'การผลิต',
  size: 'ขนาดเล็ก', ap: '2025-01-01', ex: '2027-12-31', fy: 'FY67', s1: 0.6, s2: 0.3, s3: 0.1,
  note: 'แถวตัวอย่าง ลบทิ้งก่อนนำเข้า', webId: '32040',
};
/** The template: the example row in the registry sheet, then the description sheet. */
export function templateSheets(): XSheet[] {
  return [registrySheet([{ f: EXAMPLE, gcc: '', email: '' }], todayOf(), false), descSheet()];
}
/** The export: the certificates given (with their GCC code and e-mail), in the same headers and description. */
export function exportSheets(rows: ExportRow[], today: string): XSheet[] {
  return [registrySheet(rows, today, true), descSheet()];
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
/** `held`: the certificate's values as the app holds them (a blank cell of the row keeps them, keepHeld). */
export interface PlanChange { rowNo: number; f: CertFields; gid: number; fields: string[]; origin: 'base' | 'tgo'; idx: number; held: CertFields }
/** A sheet row for a certificate the TGO review queue already holds (waiting, accepted or rejected): nothing is added for it. */
export interface PlanWaiting { rowNo: number; f: CertFields; st: 'p' | 'a' | 'r' }
/** What one sheet save did, so the revert takes exactly that back (engine.revertUpload). `log`: the change report of the save (R14). */
export interface CertImportRec {
  at: string;
  fileName: string;
  /** the TGO review-queue records (tgoRecs keys) the save made as waiting rows; a revert removes those still waiting */
  rids: string[];
  /** the company ids the save created (none now: an import creates no company, R15) */
  coIds: number[];
  log?: CertLogEntry[];
}
/** What a row does, as the change report names it (CertLogEntry.action). ACTION_TH is the Thai label of each. */
export type CertAction = 'attached' | 'updated' | 'unchanged' | 'queued' | 'already queued' | 'rejected' | 'refused' | 'error' | 'review' | 'already in review' | 'declined before';
export const ACTION_TH: Record<CertAction, string> = {
  attached: 'ตรงกับใบที่รับจาก TGO แล้ว',
  updated: 'อัปเดตใบรับรอง',
  unchanged: 'ไม่เปลี่ยนแปลง',
  queued: 'เข้ารอตรวจ TGO',
  'already queued': 'อยู่ในรายการ TGO แล้ว',
  rejected: 'ข้ามแถว',
  refused: 'ต้องแก้ที่รายการ TGO',
  error: 'ข้อผิดพลาด',
  review: 'รอตรวจสอบ',
  'already in review': 'อยู่ในรายการรอตรวจสอบแล้ว',
  'declined before': 'ถูกปฏิเสธไว้แล้ว',
};
/** An e-mail decision for a row's company (R8, v3): filled (the sheet brings an address the company does not hold: the company's
 *  e-mail becomes the old one plus the new ones), kept (every sheet address is held already: nothing is written), skipped (the
 *  row's company is not applied), none (no e-mail to take from the row). */
export type EmailAction = 'none' | 'filled' | 'kept' | 'skipped';
/** One row of the change report (R14): the preview shows it, and the import record keeps it. */
export interface CertLogEntry {
  row: number; action: CertAction; co: number | null; gcc: string; company: string; cert: string;
  changes: { field: string; from: string; to: string }[];
  email: { action: EmailAction; from: string; to: string };
  msg: string;
  /** a review row's reason (R1, R3), so the report counts the rows sent to review by reason (R19) */
  reason?: string;
}
/** A row for the review list (R16): its reason, and the row itself. */
export interface PlanReview { rowNo: number; reason: string; line: CertLine }
/** A company's e-mail from the sheet (R8, v3): `filled` writes `to` (the company's own addresses, then the new ones); `kept` writes
 *  nothing, and `to` is the company's value as it is. `from` is the value the company has now. */
export interface PlanEmail { co: number; name: string; from: string; to: string; action: 'filled' | 'kept' }
/** What the app tells the planner: its companies, the held certificates, the queue and the review list. */
export interface PlanCtx {
  held: HeldCert[];
  /** every company the app has (its canonical id); `local`: a device-only company (ids from 900000), which a new certificate
   *  may not attach to, since the team does not share it */
  companies: { id: number; name: string; local: boolean }[];
  /** the canonical id of a company id (a merged company's own id is an alias) */
  canon: (id: number) => number;
  /** the company's e-mail now ('' when none) */
  emailOf: (id: number) => string;
  /** the queue record a row means, with its values as a sheet row reads them */
  queue: (f: CertFields) => { st: 'p' | 'a' | 'r'; f: CertFields } | undefined;
  /** the state of the review record a row would make (sheetReview.reviewIdOf) */
  review: (id: string) => 'p' | 'a' | 'r' | undefined;
  /** accept (R16): the company the row is decided for; the GCC code and the name are not read */
  force?: number;
}
export interface CertPlan {
  read: number;
  /** new certificates, to the TGO queue (state p) */
  news: PlanNew[];
  /** rows that match the registry and need no change (also attached ones) */
  same: number;
  /** held base certificates with changed fields */
  changed: PlanChange[];
  errors: { rowNo: number; reason: string }[];
  /** always empty: an import creates no company (R15). Kept so the preview lists them as before. */
  companies: { id: number; name: string }[];
  /** rows the queue already holds (waiting, accepted, rejected) */
  waiting: PlanWaiting[];
  /** rows kept for the review list (R16), new records only */
  reviews: PlanReview[];
  /** company e-mails the save takes from the sheet (R8) */
  emails: PlanEmail[];
  /** the change report, row by row (R14, R19) */
  log: CertLogEntry[];
  /** unknown headers (R10) */
  warnings: string[];
}

const blankOf = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');
const fieldText = (f: CertFields, k: keyof CertFields) => {
  const v = f[k];
  if (k === 's1' || k === 's2' || k === 's3') return v == null ? '' : String(Math.round((v as number) * 10000));
  return txtOf(String(v ?? ''));
};
/** A value as the change report shows it: a percent, a พ.ศ. date, or the text. */
const showOf = (k: keyof CertFields, v: CertFields[keyof CertFields]): string => {
  if (blankOf(v)) return '';
  if (k === 's1' || k === 's2' || k === 's3') return `${Math.round((v as number) * 10000) / 100}%`;
  if (k === 'ap' || k === 'ex') return beStr(v as string);
  return txtOf(String(v));
};
/** The labels of the compared fields that differ between a row and a certificate, in the sheet's order. A blank row cell is never a
 *  change (R2). The organisation is compared with the identity key's normalisation (normOrg, as certKey does), so a repeated บริษัท
 *  prefix or a leading space is not a change of it; the name shown on screen stays as fixName reads it. */
export const changedFields = (a: CertFields, b: CertFields): string[] =>
  COMPARE.filter(([k]) => !blankOf(a[k]) && (k === 'org' ? normOrg(a.org) !== normOrg(b.org) : fieldText(a, k) !== fieldText(b, k))).map(([, label]) => label);
/** The changes of a row against a certificate, as the change report lists them: field, from (held), to (sheet). */
export const diffFields = (a: CertFields, b: CertFields): { field: string; from: string; to: string }[] =>
  COMPARE.filter(([k]) => !blankOf(a[k]) && (k === 'org' ? normOrg(a.org) !== normOrg(b.org) : fieldText(a, k) !== fieldText(b, k))).map(([k, label]) => ({
    field: label, from: showOf(k, b[k]), to: showOf(k, a[k]),
  }));
/** A row's values with its blank cells taken from the certificate held (a blank never clears a held value, R2). */
export const keepHeld = (f: CertFields, held: CertFields): CertFields => ({
  ...held,
  ...(Object.fromEntries(Object.entries(f).filter(([, v]) => !blankOf(v))) as Partial<CertFields>),
});

/** Cells a certificate must have to be new; a held one may not have them blanked (it keeps its value). */
const REQUIRED: [keyof CertFields, string][] = [['cert', 'เลขที่ใบรับรอง'], ['org', 'ชื่อองค์กร'], ['ap', 'วันที่อนุมัติ (พ.ศ.)'], ['ex', 'วันที่หมดอายุ (พ.ศ.)']];
/** The required cells a row lacks (R2). A blank required cell is an error row, unless the held certificate is blank in that cell
 *  too: there is no value to keep, so the row matches the certificate as it is (an unchanged export reads back, R12, R13). */
const missingOf = (f: CertFields, held?: CertFields) =>
  REQUIRED.filter(([k]) => blankOf(f[k]) && !(held && blankOf(held[k]))).map(([, label]) => `ต้องกรอก ${label}`);
/** The reasons a row goes to the review list (R1, R3). */
const R_NO_CO = 'ไม่พบบริษัทในระบบ';
const R_NO_GCC = 'รหัส GCC ไม่พบในระบบ';
const R_DUP_CO = 'พบบริษัทซ้ำ';
const R_GCC_NAME = 'รหัส GCC กับชื่อไม่ตรงกัน';
const R_GCC_HELD = 'รหัส GCC ไม่ตรงกับบริษัทของใบรับรองนี้';
/** The change report's actions that take the row's e-mail (the company is applied, or the row would be). */
const NO_MAIL: CertAction[] = ['error', 'review', 'already in review', 'rejected'];

/**
 * The sheet's rows against what the app holds, row by row (the company rules R3, the certificate rules R5–R7, the e-mail R8,
 * the review list R16). Saves nothing. A new certificate of an existing company is planned as a queue row (`news`); a row whose
 * company cannot be settled is planned for the review list (`reviews`); the change report (`log`) has one entry per row.
 */
export function planCertRows(lines: CertLine[], ctx: PlanCtx, warnings: string[] = []): CertPlan {
  const canon = ctx.canon;
  const coName = new Map(ctx.companies.map((c) => [c.id, c.name] as const));
  const all = new Set(ctx.companies.map((c) => c.id));
  const shared = new Set(ctx.companies.filter((c) => !c.local).map((c) => c.id));
  // a new certificate attaches to a shared company only: by its GCC code, else by its name (importNameKey)
  const byName = new Map<string, number[]>();
  ctx.companies.filter((c) => !c.local).forEach((c) => {
    const k = importNameKey(c.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), c.id]);
  });
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) || []), v]);
  const byWeb = new Map<string, HeldCert[]>(), byKey = new Map<string, HeldCert[]>(), byNo = new Map<string, HeldCert[]>();
  ctx.held.forEach((h) => {
    if (h.f.webId) push(byWeb, h.f.webId, h);
    if (h.f.cert) {
      push(byKey, certKey(h.f.cert, h.f.org), h);
      push(byNo, numberOf(h.f.cert), h);
    }
  });
  const usedBy = new Map<HeldCert, number>();
  // the held certificate a row means: the web id, else number + organisation, else the only one with its number
  const find = (f: CertFields): HeldCert | undefined => {
    // a web id names a record only with the same number (sameRecord): a typed id on another certificate is not enough
    const w = f.webId ? (byWeb.get(f.webId) || []).find((h) => sameRecord(f, h.f)) : undefined;
    if (w) return w;
    if (!f.cert) return undefined;
    const k = byKey.get(certKey(f.cert, f.org));
    // the first one with this number and organisation that an earlier row has not taken
    if (k) return k.find((h) => !usedBy.has(h)) ?? k[0];
    const n = byNo.get(numberOf(f.cert));
    return n && n.length === 1 ? n[0] : undefined;
  };
  /** A GCC code's company among `pool`, or the reason it names none (R3a). */
  const byCode = (gcc: string, pool: Set<number>): { co: number } | { reason: string } => {
    const id = gccIdOf(gcc);
    const co = id == null ? null : canon(id);
    return co != null && pool.has(co) ? { co } : { reason: R_NO_GCC };
  };
  /** A new certificate's company (R3a–d): by the GCC code (checked against the name), else by the name alone. */
  const newCo = (gcc: string, org: string): { co: number } | { reason: string } => {
    const cands = byName.get(importNameKey(org)) ?? [];
    if (gcc) {
      const r = byCode(gcc, shared);
      if (!('co' in r)) return r;
      return cands.length && !cands.includes(r.co) ? { reason: R_GCC_NAME } : r;
    }
    if (!cands.length) return { reason: R_NO_CO };
    if (cands.length > 1) return { reason: R_DUP_CO };
    return { co: cands[0] };
  };
  /** The company a new certificate goes to: the one an accept names (ctx.force), else as newCo settles it. */
  const coFor = (g: string, org: string): { co: number } | { reason: string } => (ctx.force != null ? { co: ctx.force } : newCo(g, org));

  const log: CertLogEntry[] = [];
  const plan: CertPlan = { read: lines.length, news: [], same: 0, changed: [], errors: [], companies: [], waiting: [], reviews: [], emails: [], log, warnings };
  const newKeys = new Map<string, number>();
  const reviewIds = new Map<string, number>();
  // the e-mail each company gets from the rows that carry one (R8): the rows, and the distinct addresses across them
  const mails = new Map<number, { rows: CertLogEntry[]; addrs: Map<string, string> }>();

  const rowLog = (L: CertLine, action: CertAction, msg: string, co: number | null, changes: CertLogEntry['changes'] = []): CertLogEntry => {
    const gcc = (L.gcc ?? '').trim();
    return {
      row: L.rowNo, action, co, gcc: co != null ? gccCode(co) : gcc, company: co != null ? coName.get(co) ?? L.f.org : L.f.org,
      cert: L.f.cert, changes, email: { action: 'none', from: '', to: '' }, msg,
    };
  };
  /** Records a row's entry, and its e-mail: taken by its company when the company is applied, skipped when it is not. */
  const note = (L: CertLine, entry: CertLogEntry) => {
    log.push(entry);
    const addrs = (L.emailSt ?? '').trim() === EMAIL_FOUND ? splitEmails(L.email ?? '') : [];
    if (!addrs.length) return;
    if (entry.co == null || NO_MAIL.includes(entry.action)) {
      entry.email = { action: 'skipped', from: '', to: addrs.join(' | ') };
      return;
    }
    const m = mails.get(entry.co) ?? { rows: [], addrs: new Map<string, string>() };
    mails.set(entry.co, m);
    addrs.forEach((a) => !m.addrs.has(a.toLowerCase()) && m.addrs.set(a.toLowerCase(), a));
    m.rows.push(entry);
  };
  const review = (L: CertLine, reason: string, co: number | null) => {
    const gcc = (L.gcc ?? '').trim();
    const id = reviewIdOf(L.f.cert, L.f.org, gcc);
    // an accept (ctx.force) decides its own record, which is waiting: that record is not a duplicate of the row
    const known = ctx.force == null ? ctx.review(id) : undefined;
    const dup = reviewIds.has(id) ? 'already in review' : known === 'p' ? 'already in review' : known === 'r' ? 'declined before' : undefined;
    if (dup === 'already in review') return note(L, rowLog(L, dup, 'อยู่ในรายการรอตรวจสอบแล้ว ไม่เพิ่มซ้ำ', co));
    if (dup === 'declined before') return note(L, rowLog(L, dup, 'ถูกปฏิเสธไว้แล้ว ไม่เพิ่มซ้ำ', co));
    reviewIds.set(id, L.rowNo);
    plan.reviews.push({ rowNo: L.rowNo, reason, line: L });
    note(L, { ...rowLog(L, 'review', `${reason} · ส่งไปรายการรอตรวจสอบจากไฟล์ชีต`, co), reason });
  };
  const errorRow = (L: CertLine, reason: string) => {
    plan.errors.push({ rowNo: L.rowNo, reason });
    note(L, rowLog(L, 'error', reason, null));
  };

  for (const L of lines) {
    const f = L.f;
    const gcc = (L.gcc ?? '').trim();
    // the template's example row is skipped (R11)
    if (f.cert.toUpperCase() === EXAMPLE_CERT) {
      note(L, rowLog(L, 'rejected', 'แถวตัวอย่างจากแม่แบบ ข้ามแถวนี้', null));
      continue;
    }
    if (L.errors.length) {
      errorRow(L, L.errors.join(' · '));
      continue;
    }
    // a row missing a required cell is an error row (R2), unless the held certificate is blank in that cell too; the other blank cells keep the held values
    const h = find(f);
    const missing = missingOf(f, h?.f);
    if (missing.length) {
      errorRow(L, missing.join(' · '));
      continue;
    }
    if (h) {
      const first = usedBy.get(h);
      if (first != null) {
        errorRow(L, `ตรงกับใบรับรองเดียวกับแถว ${first}`);
        continue;
      }
      usedBy.set(h, L.rowNo);
      // a held certificate keeps its company: a GCC code that names another company is a review, never a move (R3e)
      const hco = canon(h.gid);
      let reason = '';
      if (ctx.force != null) reason = ctx.force === hco ? '' : R_GCC_HELD;
      else if (gcc) {
        const r = byCode(gcc, all);
        reason = 'reason' in r ? r.reason : r.co === hco ? '' : R_GCC_HELD;
      }
      if (reason) {
        review(L, reason, hco);
        continue;
      }
      const fields = changedFields(f, h.f);
      if (!fields.length) {
        plan.same++;
        note(L, rowLog(L, h.origin === 'tgo' ? 'attached' : 'unchanged', h.origin === 'tgo' ? 'ตรงกับใบที่รับจากรายการ TGO แล้ว ไม่เปลี่ยน' : 'ตรงกับทะเบียนแล้ว ไม่มีการเปลี่ยนแปลง', hco));
        continue;
      }
      const changes = diffFields(f, h.f);
      // a certificate the queue brought in is changed in the queue, not here (R7); the others are updated
      if (h.origin === 'tgo') {
        note(L, rowLog(L, 'refused', TGO_EDIT_REFUSED, hco, changes));
        continue;
      }
      plan.changed.push({ rowNo: L.rowNo, f, gid: h.gid, fields, origin: h.origin, idx: h.idx, held: h.f });
      note(L, rowLog(L, 'updated', 'อัปเดตใบรับรองในทะเบียนแล้ว', hco, changes));
      continue;
    }
    const q = ctx.queue(f);
    if (q) {
      const qco = newCo(gcc, f.org);
      const co = 'co' in qco ? qco.co : null;
      plan.waiting.push({ rowNo: L.rowNo, f, st: q.st });
      if (q.st === 'r') {
        note(L, rowLog(L, 'declined before', 'ถูกปฏิเสธไว้แล้ว ไม่เพิ่มซ้ำ', co));
      } else if (changedFields(f, q.f).length) {
        note(L, rowLog(L, 'refused', TGO_EDIT_REFUSED, co, diffFields(f, q.f)));
      } else {
        note(L, rowLog(L, 'already queued', 'อยู่ในรายการ TGO แล้ว ไม่เพิ่มซ้ำ', co));
      }
      continue;
    }
    // a new certificate: one row per certificate and company in the file (the second is an error)
    const k = certKey(f.cert, f.org);
    if (newKeys.has(k)) {
      errorRow(L, `ซ้ำกับแถว ${newKeys.get(k)}`);
      continue;
    }
    newKeys.set(k, L.rowNo);
    const r = coFor(gcc, f.org);
    if ('reason' in r) {
      review(L, r.reason, null);
      continue;
    }
    // a new certificate with no branch cell takes the branch named in the company's bracketed suffix (R4)
    plan.news.push({ rowNo: L.rowNo, f: { ...f, branch: f.branch || branchOfName(f.org) }, gid: r.co });
    note(L, rowLog(L, 'queued', 'เข้ารอตรวจ TGO (เข้าทะเบียนเมื่อผู้ตรวจรับแล้ว)', r.co));
  }

  // one e-mail decision per company, from all its rows at once (R8, v3): the sheet's new addresses are added to the company's own
  mails.forEach((m, co) => {
    const have = ctx.emailOf(co);
    const { action, to } = mergeCoEmail(have, [...m.addrs.values()]);
    plan.emails.push({ co, name: coName.get(co) ?? '', from: have, to, action });
    m.rows.forEach((r) => (r.email = { action, from: have, to }));
  });
  plan.companies = [];
  return plan;
}

/** The change report's counts (R14): rows per action, the rows sent to review by reason (R19), and the companies whose e-mail
 *  was filled or kept. The preview and the saved result both count the same log list. */
export function countLog(log: CertLogEntry[]) {
  const by: Record<CertAction, number> = {
    attached: 0, updated: 0, unchanged: 0, queued: 0, 'already queued': 0, rejected: 0, refused: 0, error: 0, review: 0, 'already in review': 0, 'declined before': 0,
  };
  const reasons: Record<string, number> = {};
  log.forEach((r) => {
    by[r.action] += 1;
    if (r.action === 'review' && r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  });
  const cos = (a: EmailAction) => new Set(log.filter((r) => r.email.action === a && r.co != null).map((r) => r.co)).size;
  return { ...by, reasons, emailFilled: cos('filled'), emailKept: cos('kept') };
}

/** The held certificates of the registry, with where each is kept (`baseCount`: how many are in the base dataset). */
export function heldFrom(certs: Cert[], baseCount: number, CD: CertDicts): HeldCert[] {
  return certs.map((c) => {
    const origin = c.cid < baseCount ? 'base' : 'tgo';
    const f = certFields(c, CD);
    // a queue certificate's note carries the app's tags: compare the sheet's own part of it
    return { origin, idx: c.cid < baseCount ? c.cid : c.cid - baseCount, gid: c.gid0 ?? c.gid, f: origin === 'tgo' ? { ...f, note: sheetNoteOf(f.note) } : f };
  });
}
/** A stored or built certificate's values as text (the dictionaries resolve the indexes; the text fields are the fallback). */
export function certFields(c: Partial<Cert>, CD: CertDicts): CertFields {
  const at = (a: string[], i: number | undefined) => (i != null && i >= 0 ? a[i] || '' : '');
  return {
    cert: c.cert || '', org: fixName(c.org || ''), branch: c.branch || '', act: c.act || '', addr: c.addr || '', zip: c.zip || '',
    prov: c.provTxt || at(CD.prov, c.prov), ind: at(CD.ind, c.ind) || c.indTxt || '', size: at(CD.size, c.size) || c.sizeTxt || '',
    ap: c.ap || '', ex: c.ex || '', fy: at(CD.fy, c.fy) || c.fyTxt || '', s1: c.s1 ?? null, s2: c.s2 ?? null, s3: c.s3 ?? null,
    note: c.note || '', webId: String(c.webId ?? '').trim(),
  };
}

/**
 * The plan written into the saved lists: changed base certificates in the base dataset (blank cells keep the held value),
 * changed added ones and new certificates in the added list, new companies into addedCos (none now, R15), dictionary texts
 * appended to the base dictionaries. Returns the new lists; nothing is mutated.
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
    const next = keepHeld(ch.f, ch.held);
    if (ch.origin === 'base') {
      const a = certs[ch.idx] as unknown;
      const o: Record<string, unknown> = {};
      if (Array.isArray(a)) CCOLS.forEach((c, j) => (o[c] = a[j]));
      else Object.assign(o, a);
      Object.assign(o, write(next, ch.gid));
      certs[ch.idx] = CCOLS.map((c) => o[c]);
    } else {
      tgo2[ch.idx] = { ...tgo2[ch.idx], ...write(next, ch.gid), indTxt: undefined, provTxt: undefined };
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
