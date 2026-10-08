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
import { todayISO } from './format';
import type { CustomCo } from './types';

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
  /** Contact date typed in the table (ISO). The last contact also counts stage dates, see lastContact(). */
  contactDate: string;
  jobStatus: 'open' | 'closed';
  closedDate: string;
  /** Typed-in amounts (THB); see dealMoney() for how they combine with confirmed documents. */
  forecast: number | null;
  actual: number | null;
  /** When the forecast was last typed: a typed forecast newer than the latest confirmed quotation wins. */
  fcAt?: string;
  source: string[];
  service: string[];
  /** Position inside its section. */
  order: number;
  /** The import (from the old tracker) that added it, so that import can be undone. */
  imp?: string;
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
  /** When the amount / what it counts toward was last confirmed (attach or edit); the newest confirmed quotation is the forecast. */
  cAt?: string;
  /** The stage note this document filled in automatically, so it can follow the document's edits and removal. */
  auto?: { stage: string; n: string; d?: string };
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
  /** Deals deleted (here or by a teammate): id → when. Kept so an import never brings them back. */
  gone: Record<string, string>;
  /** Deals removed by undoing an import (shared, dundo/<id>): unlike a deletion, importing them again is fine. */
  undone: Record<string, string>;
  /** List items added in this browser while not connected to a team (this browser only): merged into
   *  the team's lists when it connects — and only these, so items the team removed don't come back. */
  offAdds?: Partial<Record<keyof SalesCfg, string[]>>;
}

export const emptyCfg = (): SalesCfg => ({ sections: DEFAULT_SECTIONS.slice(), sources: DEFAULT_SOURCES.slice(), services: DEFAULT_SERVICES.slice(), stages: DEFAULT_STAGES.slice() });
export const emptySales = (): SalesState => ({ cfg: emptyCfg(), deals: {}, steps: {}, docs: {}, log: {}, gone: {}, undone: {} });

/** Current Buddhist-era year as text. */
export const beYear = (iso = new Date().toISOString()) => String(+iso.slice(0, 4) + 543);

export function newDeal(p: Partial<Deal> & { id: string; client: string }, by: string, at = new Date().toISOString()): Deal {
  return {
    year: beYear(at), section: '', gid: null, contactName: '', phone: '', email: '', resp: '', referral: '', contactDate: '',
    jobStatus: 'open', closedDate: '', forecast: null, actual: null, source: [], service: [], order: Date.parse(at) || 0,
    at, by, ...p,
  };
}

// ---- records from the team sheet or a backup file are checked: one malformed record (a crafted
// row, an edited backup) must not break the screen or turn amounts into text
const str = (v: unknown, max = 3000) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' ? String(v) : '').slice(0, max);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 200)) : []);
const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 40) : '');
/** A deal record as this app can use it, or null. */
export function toDeal(v: unknown, id: string): Deal | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const d: Deal = {
    id, year: str(o.year, 4) || beYear(), section: str(o.section, 200), gid: num(o.gid), client: str(o.client, 200) || 'ลูกค้า',
    contactName: str(o.contactName, 200), phone: str(o.phone, 200), email: str(o.email, 200), resp: str(o.resp, 100), referral: str(o.referral, 200),
    contactDate: iso(o.contactDate).slice(0, 10), jobStatus: o.jobStatus === 'closed' ? 'closed' : 'open', closedDate: iso(o.closedDate).slice(0, 10),
    forecast: num(o.forecast), actual: num(o.actual), source: strs(o.source), service: strs(o.service), order: num(o.order) ?? 0,
    at: iso(o.at), by: str(o.by, 100),
  };
  if (iso(o.fcAt)) d.fcAt = iso(o.fcAt);
  if (typeof o.imp === 'string') d.imp = o.imp.slice(0, 40);
  return d;
}
const KINDS = ['quotation', 'invoice', 'receipt', 'other'];
const TARGETS = ['forecast', 'actual', 'none'];
const BASES = ['total', 'subtotal', 'netPay', 'manual'];
/** A document record as this app can use it, or null. */
export function toDoc(v: unknown, deal: string, id: string): DealDoc | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const amount = num(o.amount);
  const doc: DealDoc = {
    id, deal, kind: (KINDS.includes(o.kind as string) ? o.kind : 'other') as DocKind, name: str(o.name, 120) || 'เอกสาร', mime: str(o.mime, 60), size: num(o.size) ?? 0,
    fileId: /^[\w-]{0,200}$/.test(str(o.fileId, 200)) ? str(o.fileId, 200) : '', docNo: str(o.docNo, 60), docDate: iso(o.docDate).slice(0, 10), amount,
    target: amount == null ? 'none' : ((TARGETS.includes(o.target as string) ? o.target : 'none') as DocTarget), detected: num(o.detected),
    basis: (BASES.includes(o.basis as string) ? o.basis : 'manual') as DealDoc['basis'], stage: str(o.stage, 60), at: iso(o.at), by: str(o.by, 100),
  };
  if (iso(o.cAt)) doc.cAt = iso(o.cAt);
  const a = o.auto as Record<string, unknown> | undefined;
  if (a && typeof a === 'object' && typeof a.stage === 'string' && typeof a.n === 'string') doc.auto = { stage: a.stage, n: a.n, ...(iso(a.d) ? { d: iso(a.d).slice(0, 10) } : {}) };
  return doc;
}
/** A customer added by hand, as this app can use it, or null (no name). */
export function toCust(v: unknown, id: number): CustomCo | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = str(o.name, 200).trim();
  if (!name || !isFinite(id)) return null;
  const t = (k: string, max = 300) => str(o[k], max);
  return {
    id, name, jur: t('jur', 20), prov: t('prov', 100), ind: t('ind', 200), biz: t('biz'), addr: t('addr', 500), phone: t('phone', 200),
    email: t('email', 200), web: t('web', 300), contact: t('contact', 200), note: t('note', 3000), at: iso(o.at), by: t('by', 100),
  };
}
export const toStep = (v: unknown): DealStep | null => (v && typeof v === 'object' ? { d: iso((v as DealStep).d).slice(0, 10), n: str((v as DealStep).n, NOTE_MAX) } : null);
export function toLog(v: unknown, id: string): DealLog | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { id, at: iso(o.at), by: str(o.by, 100), action: str(o.action, 100), client: str(o.client, 200), detail: str(o.detail, 300), deal: str(o.deal, 100) };
}

export const stepOf = (s: SalesState, id: string, stage: string): DealStep => s.steps[`${id}/${stage}`] || { d: '', n: '' };
export const docsOf = (s: SalesState, id: string) =>
  Object.values(s.docs).filter((d) => d.deal === id).sort((a, b) => (a.at || '').localeCompare(b.at || ''));

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

/** An amount typed into a Forecast / Actual box: "120,000", "120,000.-", "1.5 ล้าน", "200k", Thai
 *  digits. null = empty (clears the amount); undefined = not one clear amount (a range, words), so
 *  the box keeps its old value instead of erasing it. */
export function parseAmount(v: string): number | null | undefined {
  const t = v
    .replace(/[\u0E50-\u0E59]/g, (c) => String(c.charCodeAt(0) - 0x0e50))
    // "120,000.-" and "120,000.- บาท" as printed on Thai invoices
    .replace(/(\.|,)-(?=\s*(บาท|thb|฿)?\s*$)/i, '')
    .trim();
  if (!t) return null;
  const r = looseMoney(t);
  return r.value != null && r.exact && r.value >= 0 ? r.value : undefined;
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

const confirmedAt = (x: DealDoc) => x.cAt || x.at || '';
/** Effective Forecast / Actual, derived from the records rather than stored, so teammates' edits to
 *  the deal and to its documents never undo each other. Forecast: the most recently confirmed
 *  quotation (target forecast), unless a forecast was typed after it. Actual: the confirmed invoices
 *  / receipts add up (instalments); without any, the typed-in actual. */
export function dealMoney(s: SalesState, d: Deal) {
  const docs = docsOf(s, d.id);
  const fcs = docs.filter((x) => x.target === 'forecast' && x.amount != null).sort((a, b) => confirmedAt(a).localeCompare(confirmedAt(b)));
  const latest = fcs[fcs.length - 1];
  const typed = d.forecast != null && (!latest || (d.fcAt || '') >= confirmedAt(latest));
  const fcDoc = typed ? undefined : latest;
  const acs = docs.filter((x) => x.target === 'actual' && x.amount != null);
  return {
    forecast: fcDoc ? fcDoc.amount! : d.forecast,
    fcConfirmed: !!fcDoc,
    /** the quotation the forecast comes from */
    fcDoc,
    /** a typed forecast overrides a confirmed quotation */
    fcOverride: typed && !!latest,
    actual: acs.length ? acs.reduce((a, x) => a + (x.amount || 0), 0) : d.actual,
    acConfirmed: acs.length > 0,
    acDocs: acs.length,
  };
}

/** Last contact: the typed contact date or the latest stage date, whichever is later; '' when
 *  there is none. A date in the future (a planned call) does not count. */
export function lastContact(s: SalesState, d: Deal, today: string) {
  let last = d.contactDate && d.contactDate <= today ? d.contactDate : '';
  for (const p of s.cfg.stages) {
    const x = s.steps[`${d.id}/${p}`]?.d;
    if (x && x <= today && x > last) last = x;
  }
  return last;
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

/** Days since the last contact when an open deal has gone more than OVERDUE_DAYS without one; a
 *  deal nobody has contacted yet counts from the day it was added (so it isn't forgotten). */
export function overdueDays(s: SalesState, d: Deal, today: string) {
  if (d.jobStatus === 'closed') return null;
  const lc = lastContact(s, d, today) || (d.at || '').slice(0, 10);
  if (!lc || lc > today) return null;
  const n = Math.floor((Date.parse(today + 'T00:00:00') - Date.parse(lc + 'T00:00:00')) / 864e5);
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

/**
 * How far a deal has come, stage by stage, for the progress track in the table:
 * - done: has a date (today or earlier) or a note; planned: its date is still ahead;
 * - yes / no / wait: the CLOSED DEAL result;
 * - skipped: left empty before a later stage that has something;
 * - next: the one to do now (the first not done after the last one done) — `next` names it, also when
 *   it is already planned or waiting for the result;
 * - future: still to come; off: not needed (stages after a lost deal).
 */
export type StageState = 'done' | 'planned' | 'yes' | 'no' | 'wait' | 'skipped' | 'next' | 'future' | 'off';
export function stageTrack(s: SalesState, d: Deal, today: string) {
  const stages = s.cfg.stages;
  const res = dealResult(s, d);
  const dIx = stages.indexOf(DEAL_STAGE);
  const filled = stages.map((p) => {
    const x = stepOf(s, d.id, p);
    return !!(x.d || x.n.trim());
  });
  const lastFilled = filled.lastIndexOf(true);
  const states: StageState[] = stages.map((p, i) => {
    const x = stepOf(s, d.id, p);
    if (filled[i]) {
      if (p === DEAL_STAGE) {
        if (res) return res === 'YES' ? 'yes' : res === 'NO' ? 'no' : 'wait';
        return x.d > today ? 'planned' : 'next'; // a date but no result yet: still to decide
      }
      return x.d && x.d > today ? 'planned' : 'done';
    }
    if (res === 'NO' && dIx >= 0 && i > dIx) return 'off';
    return i < lastFilled ? 'skipped' : 'future';
  });
  let next = -1;
  if (res === 'WAIT') next = dIx;
  else if (res !== 'NO') {
    let lastDone = -1;
    states.forEach((x, i) => ['done', 'yes', 'wait'].includes(x) && (lastDone = i));
    next = states.findIndex((x, i) => i > lastDone && (x === 'planned' || x === 'future' || x === 'next'));
    // not decided yet: the result is asked for before anything after it (payments, stages added later)
    if (dIx >= 0 && res !== 'YES' && (next < 0 || next > dIx)) next = dIx;
  }
  if (next >= 0 && (states[next] === 'future' || states[next] === 'skipped')) states[next] = 'next';
  // only one stage is "next"
  states.forEach((x, i) => x === 'next' && i !== next && (states[i] = filled[i] ? 'planned' : i < lastFilled ? 'skipped' : 'future'));
  const done = states.filter((x) => x === 'done' || x === 'yes' || x === 'no' || x === 'wait').length;
  return {
    states: Object.fromEntries(stages.map((p, i) => [p, states[i]])) as Record<string, StageState>,
    next: next >= 0 ? stages[next] : '',
    nextStep: next >= 0 ? stepOf(s, d.id, stages[next]) : null,
    done,
    total: stages.length,
    result: res,
  };
}

/** One line for a deal: its status, and the result when the job is closed ("ปิดงาน" alone doesn't say whether it was won), else the stage reached. */
export function trackerStatus(S: SalesState, d: Deal) {
  const st = dealStatus(S, d);
  const res = st.result === 'YES' || st.result === 'NO' ? st.result : '';
  const last = lastStage(S, d);
  const overall = st.overall.length > 40 ? st.overall.slice(0, 40) + '…' : st.overall; // a waiting note can be long
  return [overall, d.jobStatus === 'closed' && res ? 'ผล ' + res : '', !res && last ? 'ขั้นล่าสุด ' + last : ''].filter(Boolean).join(' · ');
}

/** Quick views of the table: what needs doing (combined with the other filters). */
export type QuickView = '' | 'overdue' | 'notstarted' | 'active' | 'payment';
export function quickMatch(s: SalesState, d: Deal, q: QuickView, today: string) {
  if (!q) return true;
  if (q === 'overdue') return overdueDays(s, d, today) != null;
  const st = dealStatus(s, d);
  if (q === 'notstarted') return !st.started;
  if (q === 'active') return st.started && (st.result === '' || st.result === 'WAIT');
  // won, and a payment stage (PAY…, after CLOSED DEAL) is still empty
  const dIx = s.cfg.stages.indexOf(DEAL_STAGE);
  const pays = dIx >= 0 ? s.cfg.stages.slice(dIx + 1).filter((p) => /^PAY/i.test(p) || DEFAULT_STAGES.includes(p)) : [];
  return st.result === 'YES' && pays.some((p) => !stepOf(s, d.id, p).d && !stepOf(s, d.id, p).n.trim());
}

export interface SalesFilter { year: string; q?: string; section?: string; source?: string; service?: string; resp?: string; referral?: string; result?: '' | 'YES' | 'NO' | 'WAIT' | 'EMPTY'; day?: string; month?: string; job?: '' | 'open' | 'closed'; quick?: QuickView }

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
      if (f.quick && !quickMatch(s, d, f.quick, todayISO())) return false;
      if (f.day || f.month) {
        // the last contact (typed date or latest stage date), or the day it was added — as shown in the row
        const cd = lastContact(s, d, todayISO()) || (d.at || '').slice(0, 10);
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
    if (overdueDays(s, d, today) != null) st.overdue++;
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
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s|$)/;
/** yyyy-mm-dd from what a date becomes in a sheet download: ISO text, d/m/yyyy (Thai sheets, also
 *  with a Buddhist-era year), m/d/yyyy when the day can't be a month, or an Excel serial number. */
export function isoDate(v: unknown): string {
  return dateOf(v, false);
}
/** isoDate, reading n/n/yyyy as m/d/yyyy when `monthFirst` (the file's dates were saved that way). */
function dateOf(v: unknown, monthFirst: boolean): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ok = (y: number, m: number, d: number) => {
    if (y > 2400) y -= 543;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return y > 1900 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad2(m)}-${pad2(d)}` : '';
  };
  let m = DMY.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    return b > 12 || (monthFirst && a <= 12) ? ok(y, a, b) : ok(y, b, a);
  }
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\s|$)/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
    // Excel day count from 1899-12-30
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5).toISOString().slice(0, 10);
  }
  return '';
}
/** Whether a file's n/n/yyyy dates are m/d/yyyy. Excel writes all the dates of a CSV in one order (the
 *  computer's), so one that can only be read one way decides for all: "10/13/2026" → m/d, so
 *  "10/7/2026" is 7 October too. Thai d/m when no date decides it; date by date when they disagree.
 *  Stage dates are left out: they sit inside the progress JSON text, which Excel doesn't rewrite. */
function monthFirstOf(rows: Record<string, unknown>[]): boolean {
  let dm = false, md = false;
  rows.forEach((r) =>
    [r?.contactDate, r?.closedDate].forEach((v) => {
      const m = DMY.exec(String(v ?? '').trim());
      if (m && +m[1] > 12) dm = true;
      if (m && +m[2] > 12) md = true;
    }),
  );
  return md && !dm;
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
function clientOf(r: Record<string, unknown>, section: string, monthFirst: boolean): TrackerClient {
  const has = (k: string) => r[k] != null && String(r[k]).trim() !== '';
  // rows from before the old tracker split "contact" into name / phone / e-mail
  const pc = !has('contactName') && !has('phone') && !has('email') && has('contact') ? parseContact(r.contact) : null;
  const fc = looseMoney(r.forecast), ac = looseMoney(r.actual);
  return {
    section, client: String(r.client || '').trim(), contactName: pc ? pc.name : String(r.contactName || '').trim(), phone: fixPhone(pc ? pc.phone : r.phone),
    email: (pc ? pc.email : String(r.email || '')).trim(), resp: String(r.resp || '').trim(), referral: String(r.referral || '').trim(), contactDate: dateOf(r.contactDate, monthFirst),
    jobStatus: r.jobStatus === 'closed' ? 'closed' : 'open', closedDate: dateOf(r.closedDate, monthFirst),
    forecast: fc.value, actual: ac.value, forecastText: fc.exact ? '' : String(r.forecast).trim(), actualText: ac.exact ? '' : String(r.actual).trim(),
    source: list(r.source), service: list(r.service), progress: progressOf(r.progress),
  };
}
const NO_NAME = '(ไม่มีชื่อ)';
/** The row to import, or null for a row with nothing typed in it. A client row of the old tracker
 *  (`clientRow`) without a client or contact name but with anything else (a phone, an amount, a stage
 *  note, a closed job…) is kept under "(ไม่มีชื่อ)" — the old tracker shows and sums it. Contact date
 *  and SOURCE don't count: the old tracker fills them in on every new row. */
function kept(c: TrackerClient, clientRow: boolean): TrackerClient | null {
  if (c.client || c.contactName) return c;
  const typed = c.phone || c.email || c.resp || c.referral || c.forecast != null || c.actual != null || c.forecastText || c.actualText ||
    c.jobStatus === 'closed' || c.closedDate || c.service.length || Object.keys(c.progress).length;
  return clientRow && typed ? { ...c, client: NO_NAME } : null;
}

/** The tracker's "สำรองข้อมูล (JSON)" file: {sources, services, progress, rows:[{type:'section'|'client', …}]}. */
export function parseTrackerJson(obj: unknown, year: string): TrackerData {
  const o = obj as { sources?: unknown; services?: unknown; progress?: unknown; rows?: unknown };
  if (!o || typeof o !== 'object' || !Array.isArray(o.rows)) throw new Error('ไม่ใช่ไฟล์สำรองของ Sales Tracker (ไม่พบรายการ rows)');
  const clients: TrackerClient[] = [];
  const sections: string[] = [];
  const monthFirst = monthFirstOf(o.rows as Record<string, unknown>[]);
  let cur = '';
  (o.rows as Record<string, unknown>[]).forEach((r) => {
    if (r && r.type === 'section') {
      cur = String(r.name || '');
      if (cur && !sections.includes(cur)) sections.push(cur);
    } else if (r && typeof r === 'object') {
      const c = kept(clientOf(r, cur, monthFirst), r.type === 'client');
      if (c) clients.push(c);
    }
  });
  return { year, cfg: { sections, sources: list(o.sources), services: list(o.services), stages: list(o.progress) }, clients };
}

/** Rows of the tracker's Google Sheet (columns year, section, client, …, progress, syncId, config) — read
 *  from a CSV / Excel download of that sheet. Keeps only the newest snapshot (syncId) of each year. */
export function parseTrackerSheet(rows: Record<string, unknown>[]): TrackerData[] {
  const monthFirst = monthFirstOf(rows);
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
      } else {
        // a file with a client column is the tracker's sheet, not some other list with a phone column
        const c = kept(clientOf(r, String(r.section || ''), monthFirst), 'client' in r);
        if (c) clients.push(c);
      }
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

/** Text of a CSV file in whatever encoding Excel saved it: UTF-8 (with or without BOM), UTF-16 with a
 *  BOM, else Thai Windows "ANSI" (windows-874 / TIS-620) — which reading it as UTF-8 would turn into "����". */
export function decodeTrackerText(bytes: ArrayBuffer | Uint8Array): { text: string; encoding: string } {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const enc =
    b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 'utf-8'
    : b[0] === 0xff && b[1] === 0xfe ? 'utf-16le'
    : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be'
    : '';
  if (enc) return { text: new TextDecoder(enc).decode(b), encoding: enc };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-874').decode(b), encoding: 'windows-874' };
  }
}

/** Minimal CSV parser (RFC 4180: quotes, doubled quotes, newlines in quotes; BOM). First row = header.
 *  The separator is the one the header row has most of: ',' or, as Excel saves with some regional
 *  settings, ';' or a tab. */
export function parseCsv(text: string): Record<string, string>[] {
  const t = text.replace(/^﻿/, '');
  const head0 = t.split(/\r?\n|\r/, 1)[0].replace(/"[^"]*"/g, '');
  const sep = [';', '\t'].reduce((a, s) => (head0.split(s).length > head0.split(a).length ? s : a), ',');
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
    else if (ch === sep) {
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

/** One CSV cell. Text that a spreadsheet would run as a formula (= + - @ at the start, also after
 *  spaces) gets a leading ' so Excel / Sheets show it as text; numbers stay numbers. */
export const csvCell = (v: unknown) => {
  let t = v == null ? '' : String(v);
  if (typeof v === 'string' && /^\s*[=+\-@]/.test(t)) t = "'" + t;
  return '"' + t.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
};
/** A phone number cell Excel keeps as written ("0812345678", not 812345678). */
export const csvPhone = (v: unknown) => {
  const t = v == null ? '' : String(v).trim();
  return /^0[\d\s-]*$/.test(t) ? '"=""' + t + '"""' : csvCell(t);
};
