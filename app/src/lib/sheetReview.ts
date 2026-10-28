/**
 * The review list of certificate-sheet rows (R16): the rows that cannot be applied yet (no company, a GCC code that names
 * none, two companies with one name, a GCC code of another company than the certificate's) are kept here for the whole
 * team instead of being dropped. One record per row, under sheetrev/<id>, shared like the TGO queue. A reviewer chooses
 * an existing company and accepts (the row is then applied as an ordinary import row for that company, engine.ts), or
 * rejects it. A decided record (accepted or rejected) is not changed again (push_ in team-sync/Code.gs).
 */
import type { CertFields, CertLine } from './registryXlsx';
import { shortHash } from './tgoSync';

/** p waiting, a accepted (with the chosen company), r rejected. */
export type ReviewState = 'p' | 'a' | 'r';
/** The reasons a row goes to the review list (R1, R3). */
export const REVIEW_REASONS = [
  'ไม่พบบริษัทในระบบ',
  'รหัส GCC ไม่พบในระบบ',
  'พบบริษัทซ้ำ',
  'รหัส GCC กับชื่อไม่ตรงกัน',
  'รหัส GCC ไม่ตรงกับบริษัทของใบรับรองนี้',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** One row of the review list. `vals` is every column of the row by its header (email, status and note included). */
export interface ReviewRec {
  id: string;
  /** one of REVIEW_REASONS (Thai text) */
  reason: string;
  cert: string;
  org: string;
  /** the GCC code as the sheet wrote it ('' when none) */
  gcc: string;
  /** the row's certificate values, as the import reads them */
  f: CertFields;
  email: string;
  emailSt: string;
  vals: Record<string, string>;
  /** the file the import read and the time of that import; the importer */
  file: string;
  at: string;
  by: string;
  st: ReviewState;
  /** the company the reviewer chose (a), else null */
  co: number | null;
  /** who decided it and when */
  dBy?: string;
  dAt?: string;
}

const tidy = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** The stable id of a row's record: a hash of the certificate number, the organisation and the GCC code as written, so the
 *  same row imported again (any file) is the same record. */
export const reviewIdOf = (cert: string, org: string, gcc: string): string => 'r' + shortHash(['cert', tidy(cert), tidy(org), tidy(gcc)].join('|'));

/** A review record for a row the import could not apply: its values as the sheet row gives them, the reason, the file and time. */
export function makeReview(line: CertLine, reason: string, file: string, at: string, by: string): ReviewRec {
  const gcc = tidy(line.gcc ?? '');
  return {
    id: reviewIdOf(line.f.cert, line.f.org, gcc), reason, cert: line.f.cert, org: line.f.org, gcc, f: line.f,
    email: line.email ?? '', emailSt: line.emailSt ?? '', vals: { ...(line.vals ?? {}) }, file, at, by, st: 'p', co: null,
  };
}

/** What a row finds when its record exists: 'already in review' (waiting) or 'declined before' (rejected), else undefined. */
export const reviewDuplicate = (st: ReviewState | undefined): 'already in review' | 'declined before' | undefined =>
  st === 'p' ? 'already in review' : st === 'r' ? 'declined before' : undefined;

/** The values an accepted row must have to be a certificate (the same required fields a new certificate needs). */
const REQUIRED_LABELS: [keyof CertFields, string][] = [['cert', 'เลขที่ใบรับรอง'], ['org', 'ชื่อองค์กร'], ['ap', 'วันที่อนุมัติ (พ.ศ.)'], ['ex', 'วันที่หมดอายุ (พ.ศ.)']];
/** The required fields a row lacks, as the messages name them ("ต้องกรอก เลขที่ใบรับรอง"); empty when none is missing. */
export const missingFields = (f: CertFields): string[] => REQUIRED_LABELS.filter(([k]) => !f[k]).map(([, label]) => `ต้องกรอก ${label}`);
/** The "รับ" rule (R16): a company is chosen and the required fields are present. */
export const canAcceptReview = (rec: ReviewRec, co: number | null): boolean => co != null && missingFields(rec.f).length === 0;

/**
 * A reviewer's decision on a waiting record. Accept needs a company to choose: one that exists and is shared (`attachable`:
 * not a device-local company), and the required fields of the row. Reject needs nothing. A decided record is refused (msg).
 */
export function decideReview(
  rec: ReviewRec,
  decision: 'accept' | 'reject',
  opt: { co?: number | null; attachable?: (id: number) => boolean; by: string; at: string },
): { rec: ReviewRec } | { msg: string } {
  if (rec.st !== 'p') return { msg: 'รายการนี้ตัดสินไปแล้ว' };
  if (decision === 'reject') return { rec: { ...rec, st: 'r', co: null, dBy: opt.by, dAt: opt.at } };
  const co = opt.co;
  if (co == null) return { msg: 'เลือกบริษัทที่มีในระบบก่อนรับ' };
  if (opt.attachable && !opt.attachable(co)) return { msg: 'บริษัทนี้ไม่มีในระบบ หรือเก็บไว้ในเครื่องนี้เท่านั้น รับเข้าไม่ได้' };
  const missing = missingFields(rec.f);
  if (missing.length) return { msg: missing.join(' · ') };
  return { rec: { ...rec, st: 'a', co, dBy: opt.by, dAt: opt.at } };
}

/** A record as the sheet or this browser stores it, read tolerantly; null when it is not one. */
export function toReviewRec(v: unknown): ReviewRec | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const st = o.st === 'p' || o.st === 'a' || o.st === 'r' ? o.st : null;
  if (!st || typeof o.id !== 'string' || typeof o.cert !== 'string' || typeof o.org !== 'string' || !o.f || typeof o.f !== 'object') return null;
  const s = (x: unknown) => (x == null ? '' : String(x));
  const vals: Record<string, string> = {};
  if (o.vals && typeof o.vals === 'object') Object.entries(o.vals as Record<string, unknown>).forEach(([k, x]) => (vals[k] = s(x)));
  return {
    id: o.id, reason: s(o.reason), cert: o.cert, org: o.org, gcc: s(o.gcc), f: o.f as CertFields, email: s(o.email), emailSt: s(o.emailSt), vals,
    file: s(o.file), at: s(o.at), by: s(o.by), st, co: typeof o.co === 'number' && isFinite(o.co) ? o.co : null,
    dBy: o.dBy == null ? undefined : s(o.dBy), dAt: o.dAt == null ? undefined : s(o.dAt),
  };
}
