/**
 * Sales Tracker — the team's deal pipeline (formerly the stand-alone "Sales Tracker 2569" sheet).
 *
 * A deal is one potential client in one year, grouped under a channel section (SOURCE). Each deal
 * moves through the stages CALL1 … PAY2; every stage has its own date and note. Quotation / invoice
 * documents can be attached; their amounts, once confirmed, back the Forecast / Actual figures.
 *
 * Shared records (see teamSync.ts keyOf): `deal/<id>`, `dstep/<id>/<stage>`, `ddoc/<id>/<docId>`,
 * `dlog/<id>`, `scfg/<name>` — so two people editing different stages of one deal never collide.
 * Pure functions only (no DOM) so everything here is unit-tested.
 */
import { norm } from './core';

/** The old tracker's starting lists: a section usually has a SOURCE of a similar name (matchSource). */
export const DEFAULT_SECTIONS = ['Retention', 'EnWaste Expo', 'SET/mai', 'IEAT (กนอ).', 'Event Organizer', 'Partner', 'Event Exhibition', 'Course Training', 'สสว.', 'Depa', 'TGO', 'VB SAVE+', 'Social', 'อื่นๆ'];
export const DEFAULT_SOURCES = ['Retention', 'EnWaste Expo', 'SET/mai', 'กนอ.', 'Event Organizer', 'Partner', 'Event Exhibition', 'Course Training', 'สสว.', 'Depa', 'TGO', 'VB SAVE+', 'Social'];
export const DEFAULT_SERVICES = ['CF', 'CFO', 'CFP', 'LESS', 'T-VER', 'CC', 'Course Training', 'CF-EVENT', 'VVB', 'Program Development', 'GCT'];
export const DEFAULT_STAGES = ['CALL1', 'CALL2', 'QUOTATION', 'FOLLOW1', 'FOLLOW2', 'CLOSED DEAL', 'PAY1', 'PAY2'];
/** Thai hint shown under each stage name. */
export const STAGE_TH: Record<string, string> = {
  CALL1: 'โทรครั้งที่ 1', CALL2: 'โทรครั้งที่ 2', QUOTATION: 'ส่งใบเสนอราคา', FOLLOW1: 'ติดตามครั้งที่ 1', FOLLOW2: 'ติดตามครั้งที่ 2',
  'CLOSED DEAL': 'ผลการขาย (YES / NO)', PAY1: 'ชำระงวดที่ 1', PAY2: 'ชำระงวดที่ 2',
};
export const DEAL_STAGE = 'CLOSED DEAL';
export const OVERDUE_DAYS = 14;
/** Longest stage note kept (a deal's notes all travel in separate records, each within a sheet cell). */
export const NOTE_MAX = 3000;

export interface SalesCfg { sections: string[]; sources: string[]; services: string[]; stages: string[] }
export interface Deal {
  id: string;
  /** Buddhist-era year the deal is tracked in, e.g. '2569'. */
  year: string;
  /** Channel group (SOURCE section) the row sits under. */
  section: string;
  /** Linked company (registry or a customer added by hand); null = free-text client. */
  gid: number | null;
  client: string;
  contactName: string; phone: string; email: string;
  resp: string; referral: string;
  /** Last contact (ISO); open deals not contacted for OVERDUE_DAYS are flagged. */
  contactDate: string;
  jobStatus: 'open' | 'closed';
  closedDate: string;
  /** Typed-in amounts (THB). Confirmed documents take precedence, see dealMoney(). */
  forecast: number | null;
  actual: number | null;
  source: string[];
  service: string[];
  /** Position inside its section. */
  order: number;
  /** Document whose confirmed amount is the forecast. */
  fcDoc?: string;
  at: string; by: string;
}
export interface DealStep { d: string; n: string }
export type DocKind = 'quotation' | 'invoice' | 'receipt' | 'other';
/** What a confirmed document amount stands for. */
export type DocTarget = 'forecast' | 'actual' | 'none';
export interface DealDoc {
  id: string;
  deal: string;
  kind: DocKind;
  name: string; mime: string; size: number;
  /** Google Drive file id (team folder) — empty while the file is only in this browser. */
  fileId: string;
  docNo: string; docDate: string;
  /** Amount the user confirmed (THB) and what it counts toward. */
  amount: number | null;
  target: DocTarget;
  /** What the document reader found, kept for the record. */
  detected: number | null;
  /** Which figure was used: total incl. VAT, before VAT, net after withholding, or typed. */
  basis: 'total' | 'subtotal' | 'netPay' | 'manual';
  stage: string;
  at: string; by: string;
}
export interface DealLog { id: string; at: string; by: string; action: string; client: string; detail: string; deal: string }
export interface SalesState {
  cfg: SalesCfg;
  deals: Record<string, Deal>;
  /** `${dealId}/${stage}` → step */
  steps: Record<string, DealStep>;
  /** `${dealId}/${docId}` → document */
  docs: Record<string, DealDoc>;
  log: Record<string, DealLog>;
}

export const emptyCfg = (): SalesCfg => ({ sections: DEFAULT_SECTIONS.slice(), sources: DEFAULT_SOURCES.slice(), services: DEFAULT_SERVICES.slice(), stages: DEFAULT_STAGES.slice() });
export const emptySales = (): SalesState => ({ cfg: emptyCfg(), deals: {}, steps: {}, docs: {}, log: {} });

/** Current Buddhist-era year as text. */
export const beYear = (iso = new Date().toISOString()) => String(+iso.slice(0, 4) + 543);

export function newDeal(p: Partial<Deal> & { id: string; client: string }, by: string, at = new Date().toISOString()): Deal {
  return {
    year: beYear(at), section: '', gid: null, contactName: '', phone: '', email: '', resp: '', referral: '', contactDate: '',
    jobStatus: 'open', closedDate: '', forecast: null, actual: null, source: [], service: [], order: Date.parse(at) || 0,
    at, by, ...p,
  };
}

export const stepOf = (s: SalesState, id: string, stage: string): DealStep => s.steps[`${id}/${stage}`] || { d: '', n: '' };
export const docsOf = (s: SalesState, id: string) =>
  Object.values(s.docs).filter((d) => d.deal === id).sort((a, b) => a.at.localeCompare(b.at));

/** Plain number from user / imported text ("1,234.50", "฿ 12 000", "") — null when empty or not a number. */
export function money(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s฿]|บาท|THB/gi, '');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

const UNIT: Record<string, number> = { ล้าน: 1e6, แสน: 1e5, หมื่น: 1e4, พัน: 1e3, k: 1e3, m: 1e6, mb: 1e6 };
/** An amount typed freely in the old tracker ("1.5 ล้าน", "3 แสน", "50,000-80,000", "~200k") as a
 *  number, and whether that number says all the text did (`exact`). A range counts as its lower end,
 *  as the old tracker's sums did. `value` is null when the text holds no number at all. */
export function looseMoney(v: unknown): { value: number | null; exact: boolean } {
  const plain = money(v);
  if (plain != null || v == null || String(v).trim() === '') return { value: plain, exact: true };
  const t = String(v).toLowerCase().replace(/,/g, '');
  const m = /(\d+(?:\.\d+)?)\s*(ล้าน|แสน|หมื่น|พัน|mb|k|m(?![a-z]))?/.exec(t);
  if (!m) return { value: null, exact: false };
  const n = parseFloat(m[1]) * (m[2] ? UNIT[m[2]] : 1);
  // "1.5 ล้าน" alone is exact; anything else around the number (a range, a note) is not
  const exact = !!m[2] && t.replace(/[\s฿~≈]|บาท|thb|ประมาณ/g, '') === (m[1] + m[2]).replace(/\s/g, '');
  return { value: Math.round(n * 100) / 100, exact };
}

/** The SOURCE a section most likely stands for: the same name, else one containing the other
 *  ignoring case, spaces and punctuation ("IEAT (กนอ)." → "กนอ."), like the old tracker. */
export function matchSource(sources: string[], section: string): string | null {
  if (!section) return null;
  if (sources.includes(section)) return section;
  const k = (x: string) => x.toLowerCase().replace(/[\s().,/+\-]+/g, '');
  const n = k(section);
  if (!n) return null;
  return sources.find((x) => k(x) && (n.includes(k(x)) || k(x).includes(n))) || null;
}

/** Effective Forecast / Actual: a confirmed quotation sets the forecast; confirmed invoices add up to
 *  the actual. Without confirmed documents the typed-in values count (shown as not confirmed). */
export function dealMoney(s: SalesState, d: Deal) {
  const docs = docsOf(s, d.id);
  const fcd = d.fcDoc ? docs.find((x) => x.id === d.fcDoc && x.target === 'forecast' && x.amount != null) : undefined;
  const acs = docs.filter((x) => x.target === 'actual' && x.amount != null);
  return {
    forecast: fcd ? fcd.amount! : d.forecast,
    fcConfirmed: !!fcd,
    actual: acs.length ? acs.reduce((a, x) => a + (x.amount || 0), 0) : d.actual,
    acConfirmed: acs.length > 0,
  };
}

/** The CLOSED DEAL stage note decides the deal result: YES / NO / anything else = waiting. */
export function dealResult(s: SalesState, d: Deal): 'YES' | 'NO' | 'WAIT' | '' {
  const v = stepOf(s, d.id, DEAL_STAGE).n.trim().toUpperCase();
  return v === 'YES' ? 'YES' : v === 'NO' ? 'NO' : v ? 'WAIT' : '';
}

export function dealStatus(s: SalesState, d: Deal) {
  const r = dealResult(s, d);
  const started = s.cfg.stages.some((p) => {
    const st = stepOf(s, d.id, p);
    return !!(st.d || st.n.trim());
  });
  const overall =
    d.jobStatus === 'closed' ? 'ปิดงาน'
    : r === 'YES' ? 'ปิดการขายแล้ว'
    : r === 'NO' ? 'ไม่สำเร็จ'
    : r === 'WAIT' ? stepOf(s, d.id, DEAL_STAGE).n.trim()
    : started ? 'กำลังดำเนินการ'
    : 'ยังไม่เริ่ม';
  return { result: r, overall, started };
}

/** Days since the last contact when an open deal is overdue for follow-up, else null. */
export function overdueDays(d: Deal, today: string) {
  if (d.jobStatus === 'closed' || !d.contactDate) return null;
  const n = Math.floor((Date.parse(today + 'T00:00:00') - Date.parse(d.contactDate + 'T00:00:00')) / 864e5);
  return isFinite(n) && n > OVERDUE_DAYS ? n : null;
}

/** Latest stage reached (furthest stage with a date or note). */
export function lastStage(s: SalesState, d: Deal) {
  let last = '';
  s.cfg.stages.forEach((p) => {
    const st = stepOf(s, d.id, p);
    if (st.d || st.n.trim()) last = p;
  });
  return last;
}

export interface SalesFilter { year: string; q?: string; section?: string; source?: string; service?: string; resp?: string; referral?: string; result?: '' | 'YES' | 'NO' | 'WAIT' | 'EMPTY'; day?: string; month?: string; job?: '' | 'open' | 'closed' }

/** Deals of a year that pass the filters, in section order then row order. */
export function filterDeals(s: SalesState, f: SalesFilter): Deal[] {
  const q = (f.q || '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const secIx = new Map(s.cfg.sections.map((x, i) => [x, i]));
  return Object.values(s.deals)
    .filter((d) => {
      if (d.year !== f.year) return false;
      if (f.job && d.jobStatus !== f.job) return false;
      if (f.section && d.section !== f.section) return false;
      if (f.source && !d.source.includes(f.source)) return false;
      if (f.service && !d.service.includes(f.service)) return false;
      if (f.resp && (d.resp || '') !== (f.resp === '(ไม่ระบุ)' ? '' : f.resp)) return false;
      if (f.referral && (d.referral || '') !== (f.referral === '(ไม่ระบุ)' ? '' : f.referral)) return false;
      if (f.result) {
        const r = dealResult(s, d);
        if (f.result === 'EMPTY' ? r !== '' : r !== f.result) return false;
      }
      if (f.day || f.month) {
        const cd = d.contactDate || '';
        if (cd.length < 10) return false;
        if (f.month && cd.slice(5, 7) !== f.month) return false;
        if (f.day && cd.slice(8, 10) !== f.day) return false;
      }
      if (terms.length) {
        const notes = s.cfg.stages.map((p) => stepOf(s, d.id, p).n).join(' ');
        const hay = [d.client, d.contactName, d.phone, d.email, d.resp, d.referral, d.section, notes].join(' ').toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    })
    .sort((a, b) => (secIx.get(a.section) ?? 1e9) - (secIx.get(b.section) ?? 1e9) || a.section.localeCompare(b.section) || a.order - b.order || a.at.localeCompare(b.at));
}

/** Sections to show for a year: configured order first, then any extra ones used by deals. */
export function sectionsFor(s: SalesState, deals: Deal[]) {
  const out = s.cfg.sections.slice();
  deals.forEach((d) => d.section && !out.includes(d.section) && out.push(d.section));
  if (deals.some((d) => !d.section)) out.push('');
  return out;
}

export interface SalesStats {
  total: number; yes: number; no: number; wait: number; none: number; decided: number; winRate: number;
  forecast: number; actual: number; achieved: number; fcConfirmed: number; acConfirmed: number;
  open: number; closed: number; overdue: number;
  bySource: Record<string, { n: number; forecast: number; yes: number; decided: number }>;
  byService: Record<string, number>;
  stages: { name: string; n: number }[];
  byResp: Record<string, { n: number; forecast: number; actual: number }>;
  byReferral: Record<string, { n: number; forecast: number; actual: number }>;
}

/** Dashboard numbers (same definitions as the original tracker: win rate = YES / (YES + NO)). */
export function salesStats(s: SalesState, deals: Deal[], today: string): SalesStats {
  const st: SalesStats = {
    total: deals.length, yes: 0, no: 0, wait: 0, none: 0, decided: 0, winRate: 0, forecast: 0, actual: 0, achieved: 0, fcConfirmed: 0, acConfirmed: 0,
    open: 0, closed: 0, overdue: 0, bySource: {}, byService: {}, stages: s.cfg.stages.map((name) => ({ name, n: 0 })), byResp: {}, byReferral: {},
  };
  s.cfg.sources.forEach((x) => (st.bySource[x] = { n: 0, forecast: 0, yes: 0, decided: 0 }));
  s.cfg.services.forEach((x) => (st.byService[x] = 0));
  deals.forEach((d) => {
    const r = dealResult(s, d);
    if (r === 'YES') st.yes++;
    else if (r === 'NO') st.no++;
    else if (r === 'WAIT') st.wait++;
    else st.none++;
    if (d.jobStatus === 'closed') st.closed++;
    else st.open++;
    if (overdueDays(d, today) != null) st.overdue++;
    const m = dealMoney(s, d);
    const fc = m.forecast || 0, ac = m.actual || 0;
    st.forecast += fc;
    st.actual += ac;
    if (m.fcConfirmed) st.fcConfirmed += fc;
    if (m.acConfirmed) st.acConfirmed += ac;
    d.source.forEach((x) => {
      const b = st.bySource[x] || (st.bySource[x] = { n: 0, forecast: 0, yes: 0, decided: 0 });
      b.n++;
      b.forecast += fc;
      if (r === 'YES' || r === 'NO') b.decided++;
      if (r === 'YES') b.yes++;
    });
    d.service.forEach((x) => (st.byService[x] = (st.byService[x] || 0) + 1));
    st.stages.forEach((g) => {
      const x = stepOf(s, d.id, g.name);
      if (x.d || x.n.trim()) g.n++;
    });
    const add = (o: SalesStats['byResp'], k: string) => {
      const b = o[k || '(ไม่ระบุ)'] || (o[k || '(ไม่ระบุ)'] = { n: 0, forecast: 0, actual: 0 });
      b.n++;
      b.forecast += fc;
      b.actual += ac;
    };
    add(st.byResp, d.resp);
    add(st.byReferral, d.referral);
  });
  st.decided = st.yes + st.no;
  st.winRate = st.decided ? Math.round((st.yes / st.decided) * 100) : 0;
  st.achieved = st.forecast > 0 ? Math.round((st.actual / st.forecast) * 100) : 0;
  return st;
}

/** Notes from the old tracker were rich HTML; keep only the text (never render foreign HTML). */
export function htmlToText(s: unknown): string {
  const t = String(s ?? '');
  if (!/[<&]/.test(t)) return t;
  return t
    .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------------ import from the old tracker

export interface TrackerClient {
  section: string; client: string; contactName: string; phone: string; email: string; resp: string; referral: string;
  contactDate: string; jobStatus: 'open' | 'closed'; closedDate: string; forecast: number | null; actual: number | null;
  /** the amount text as typed, when the number above doesn't say all of it ("50,000-80,000") */
  forecastText: string; actualText: string;
  source: string[]; service: string[]; progress: Record<string, DealStep>;
}
export interface TrackerData { year: string; cfg: Partial<SalesCfg>; clients: TrackerClient[] }

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v || '').split(',')).map((x) => x.trim()).filter(Boolean);
const pad2 = (n: number) => String(n).padStart(2, '0');
/** yyyy-mm-dd from what a date becomes in a sheet download: ISO text, d/m/yyyy (Thai sheets, also
 *  with a Buddhist-era year), m/d/yyyy when the day can't be a month, or an Excel serial number. */
export function isoDate(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ok = (y: number, m: number, d: number) => {
    if (y > 2400) y -= 543;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return y > 1900 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad2(m)}-${pad2(d)}` : '';
  };
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s|$)/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    return b > 12 ? ok(y, a, b) : ok(y, b, a);
  }
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\s|$)/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
    // Excel day count from 1899-12-30
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5).toISOString().slice(0, 10);
  }
  return '';
}

/** A phone number a spreadsheet stored as a number lost its leading 0 ("812345678"). */
export function fixPhone(v: unknown): string {
  const s = String(v ?? '').trim();
  return /^[1-9]\d{7,8}$/.test(s) ? '0' + s : s;
}

/** Name / phone / e-mail from the old tracker's single "contact" text (rows from before it had
 *  three fields), the way the old tracker split it. */
export function parseContact(v: unknown): { name: string; phone: string; email: string } {
  const s = String(v ?? '');
  const email = (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(s) || [''])[0];
  let rest = s.replace(email, ' ');
  const phone = (/0\d[\d\s-]{6,}\d/.exec(rest) || [''])[0].trim();
  rest = rest.replace(phone, ' ');
  return { name: rest.replace(/[,\n]+/g, ' ').replace(/\s+/g, ' ').trim(), phone, email };
}
function progressOf(p: unknown): Record<string, DealStep> {
  let o: unknown = p;
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o || '{}');
    } catch {
      o = {};
    }
  }
  const out: Record<string, DealStep> = {};
  Object.entries((o as Record<string, unknown>) || {}).forEach(([k, v]) => {
    if (v == null) return;
    const st = typeof v === 'string' ? { d: '', n: v } : { d: isoDate((v as DealStep).d), n: String((v as DealStep).n ?? '') };
    const n = htmlToText(st.n).slice(0, NOTE_MAX);
    if (n || st.d) out[k.replace(/\//g, '-')] = { d: st.d, n };
  });
  return out;
}
function clientOf(r: Record<string, unknown>, section: string): TrackerClient {
  const has = (k: string) => r[k] != null && String(r[k]).trim() !== '';
  // rows from before the old tracker split "contact" into name / phone / e-mail
  const pc = !has('contactName') && !has('phone') && !has('email') && has('contact') ? parseContact(r.contact) : null;
  const fc = looseMoney(r.forecast), ac = looseMoney(r.actual);
  return {
    section, client: String(r.client || '').trim(), contactName: pc ? pc.name : String(r.contactName || '').trim(), phone: fixPhone(pc ? pc.phone : r.phone),
    email: (pc ? pc.email : String(r.email || '')).trim(), resp: String(r.resp || '').trim(), referral: String(r.referral || '').trim(), contactDate: isoDate(r.contactDate),
    jobStatus: r.jobStatus === 'closed' ? 'closed' : 'open', closedDate: isoDate(r.closedDate),
    forecast: fc.value, actual: ac.value, forecastText: fc.exact ? '' : String(r.forecast).trim(), actualText: ac.exact ? '' : String(r.actual).trim(),
    source: list(r.source), service: list(r.service), progress: progressOf(r.progress),
  };
}

/** The tracker's "สำรองข้อมูล (JSON)" file: {sources, services, progress, rows:[{type:'section'|'client', …}]}. */
export function parseTrackerJson(obj: unknown, year: string): TrackerData {
  const o = obj as { sources?: unknown; services?: unknown; progress?: unknown; rows?: unknown };
  if (!o || typeof o !== 'object' || !Array.isArray(o.rows)) throw new Error('ไม่ใช่ไฟล์สำรองของ Sales Tracker (ไม่พบรายการ rows)');
  const clients: TrackerClient[] = [];
  const sections: string[] = [];
  let cur = '';
  (o.rows as Record<string, unknown>[]).forEach((r) => {
    if (r && r.type === 'section') {
      cur = String(r.name || '');
      if (cur && !sections.includes(cur)) sections.push(cur);
    } else if (r && (r.client || r.contactName)) clients.push(clientOf(r, cur));
  });
  return { year, cfg: { sections, sources: list(o.sources), services: list(o.services), stages: list(o.progress) }, clients };
}

/** Rows of the tracker's Google Sheet (columns year, section, client, …, progress, syncId, config) — read
 *  from a CSV / Excel download of that sheet. Keeps only the newest snapshot (syncId) of each year. */
export function parseTrackerSheet(rows: Record<string, unknown>[]): TrackerData[] {
  const byYear = new Map<string, Record<string, unknown>[]>();
  rows.forEach((r) => {
    const y = String(r.year || '').trim() || beYear();
    (byYear.get(y) || byYear.set(y, []).get(y)!).push(r);
  });
  return [...byYear].map(([year, rs]) => {
    const ids = rs.map((r) => String(r.syncId || '')).filter(Boolean).sort();
    const snap = ids.length ? rs.filter((r) => String(r.syncId || '') === ids[ids.length - 1]) : rs;
    let cfg: Partial<SalesCfg> = {};
    const clients: TrackerClient[] = [];
    snap.forEach((r) => {
      if (String(r.section || '') === '__CONFIG__') {
        try {
          const c = JSON.parse(String(r.config || '{}'));
          cfg = { sections: list(c.sectionsOrder), sources: list(c.sources), services: list(c.services), stages: list(c.progressStages) };
        } catch {
          /* ignore */
        }
      } else if (r.client || r.contactName) clients.push(clientOf(r, String(r.section || '')));
    });
    return { year, cfg, clients };
  });
}

/** The name an imported row is matched by: the client, or the contact person for a row without one. */
export const importKey = (c: TrackerClient) => norm(c.client) || '@' + c.contactName.trim().toLowerCase();
/** Stable id for an imported row (the nth row of that client in that year), so importing the same
 *  file again — or a newer download where a section or contact was edited — finds the rows already
 *  imported instead of duplicating them. */
export function importId(year: string, c: TrackerClient, nth: number) {
  const s = `${year}|${importKey(c)}|${nth}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'imp' + year + (h >>> 0).toString(36);
}

/** Minimal CSV parser (RFC 4180: quotes, doubled quotes, newlines in quotes; BOM). First row = header. */
export function parseCsv(text: string): Record<string, string>[] {
  const t = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  const H = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(H.map((h, i) => [h, r[i] ?? ''])));
}

/** THB amount for display: thousands separators, up to 2 decimals. */
export const fmtMoney = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
export const KIND_TH: Record<DocKind, string> = { quotation: 'ใบเสนอราคา', invoice: 'ใบแจ้งหนี้', receipt: 'ใบเสร็จ / ใบกำกับภาษี', other: 'เอกสารอื่น' };

export const csvCell = (v: unknown) => '"' + (v == null ? '' : String(v)).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
