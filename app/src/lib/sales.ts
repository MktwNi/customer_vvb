/**
 * Sales Tracker — the team's deal pipeline (formerly the stand-alone "Sales Tracker 2569" sheet).
 *
 * A deal is one potential client in one year, grouped under a channel section (SOURCE). Each deal
 * moves through five steps (lib/steps.ts: CONTACT, QUOTATION, FOLLOW, CLOSE, PAY per installment; dealSteps
 * reads the eight stages of older records into them); every step has its own date and note. Quotation /
 * invoice documents can be attached; their amounts, once confirmed, back the Forecast / Actual figures.
 *
 * Shared records (see teamSync.ts keyOf): `deal/<id>`, `dstep/<id>/<stage>`, `ddoc/<id>/<docId>`,
 * `dpay/<id>/<stage>` (one installment of the payment plan), `dact/<id>/<actId>` (one more contact:
 * a call, e-mail or meeting beyond the stage's own), `dlog/<id>`, `scfg/<name>` — so two people
 * editing different stages of one deal never collide.
 * Pure functions only (no DOM) so everything here is unit-tested.
 */
import { norm } from './core';
import { addDays, daysBetween, localDay, pad, todayISO } from './format';
import { ceOf, inRange, isDay, monthEnd, normDateF, resolveDate, type DateBasis, type DateF, type Range } from './dateRange';
import type { NotifyCfg, QtCheck } from './notify';
import type { MonthClose, PayCheck, PayChkCfg } from './payCheck';
import type { JobExp } from './expense';
import type { CustomCo } from './types';
// units and the revenue split (package dash): only plain helpers, which import nothing from here at run time
import { dealUnits, setPartsHook, unitCtx, type Part, type ShareRec, type UnitMember, type UnitRec } from './contrib';
// the steps' definitions: plain, they import nothing from here
import {
  CONTACT_STEP, DEAL_STAGE, OLD_TH, PAY_SLOT, QUOTE_STAGE, isPayKey, isPayName, isStepKey, listPays, payNo, stepIdOf, teamSteps,
  type StepDef, type StepKind,
} from './steps';
export * from './steps';

/** The old tracker's starting lists: a section usually has a SOURCE of a similar name (matchSource). */
export const DEFAULT_SECTIONS = ['Retention', 'EnWaste Expo', 'SET/mai', 'IEAT (กนอ).', 'Event Organizer', 'Partner', 'Event Exhibition', 'Course Training', 'สสว.', 'Depa', 'TGO', 'VB SAVE+', 'Social', 'อื่นๆ'];
export const DEFAULT_SOURCES = ['Retention', 'EnWaste Expo', 'SET/mai', 'กนอ.', 'Event Organizer', 'Partner', 'Event Exhibition', 'Course Training', 'สสว.', 'Depa', 'TGO', 'VB SAVE+', 'Social'];
export const DEFAULT_SERVICES = ['CF', 'CFO', 'CFP', 'LESS', 'T-VER', 'CC', 'Course Training', 'CF-EVENT', 'VVB', 'Program Development', 'GCT'];
/** The team's stage list as it is stored (scfg/stages) when nobody changed it: the eight stages of the old
 *  tracker. It stays the stored default, so every browser of a team stores the same list (an older build reads
 *  it as its stages); this build reads it through lib/steps.ts as the five steps (teamSteps). */
export const DEFAULT_STAGES = ['CALL1', 'CALL2', 'QUOTATION', 'FOLLOW1', 'FOLLOW2', 'CLOSED DEAL', 'PAY1', 'PAY2'];
/** Thai words of a stage or step by its stored name: the five steps (PAY: a single installment), and the eight
 *  stages of older records ("บันทึกเดิม CALL2 · โทรครั้งที่ 2"). A deal's own words: dealSteps / stepLabel. */
export const STAGE_TH: Record<string, string> = {
  ...OLD_TH, CONTACT: 'ติดต่อประสานงาน', QUOTATION: 'ส่งใบเสนอราคา', FOLLOW: 'ติดตามผล', 'CLOSED DEAL': 'ผลการขาย (YES / NO)', PAY: 'ชำระเงิน', PAY1: 'ชำระงวดที่ 1', PAY2: 'ชำระงวดที่ 2',
};
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
  /** The document's own figure: what the reader found (or the user corrected it to) at the chosen basis. */
  detected: number | null;
  /** The user kept their own figure against the document's ("คงยอดเดิม"): `amount` is theirs, `detected`
   *  the document's (docMismatch). Stored as the user's decision: a typed or corrected amount is not one. */
  kept?: true;
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
/** How a contact was made. */
export type ActType = 'call' | 'email' | 'meet' | 'line' | 'other';
export const ACT_TYPES: ActType[] = ['call', 'email', 'meet', 'line', 'other'];
export const ACT_TH: Record<ActType, string> = { call: 'โทร', email: 'อีเมล', meet: 'นัดพบ', line: 'LINE', other: 'อื่นๆ' };
/**
 * One more contact with the customer (record `dact/<deal>/<id>`): the steps are milestones (CONTACT =
 * getting in touch) with one date and note each; every call, e-mail or meeting is one of these, shown
 * inside its step (dealSteps). Append-only, one record each, so two people adding calls at once never
 * collide. `stage`: the step it belongs to (an older record's may be CALL2, FOLLOW1 …: read into its step);
 * `pid`: the person (people.ts) it was with.
 */
export interface DealAct { id: string; deal: string; d: string; type: ActType; note: string; stage: string; pid: string; by: string; at: string }
/** How the customer pays an installment. */
export type PayHow = '' | 'transfer' | 'cheque' | 'cash' | 'other';
export const HOW_TH: Record<PayHow, string> = { '': '—', transfer: 'โอน', cheque: 'เช็ค', cash: 'เงินสด', other: 'อื่นๆ' };
/** Most installments in one deal's plan (more, and the rows stop being readable). */
export const PLAN_MAX = 12;
/**
 * One installment of a deal's payment plan: record `dpay/<deal>/<stage>` (stage = PAY1, PAY2, … or an
 * extra "PAY<n>" that is not in the stage list). Its own record, not fields on `dstep`: builds before
 * the plan write a stage step whole ({d, n}) and would erase anything else in it. Edited field by
 * field (MERGED in teamSync). What was actually received comes from the Actual documents at its stage,
 * or, with none, from `rcv` / `got` typed at "รับเงินแล้ว".
 */
export interface PayLine {
  /** planned amount (THB) as told to the customer; null = not decided yet */
  amt: number | null;
  /** share of the plan base when typed as a %, e.g. 50: kept so the plan can be re-split when the Forecast changes */
  pct: number | null;
  /** due date typed (yyyy-mm-dd); wins over `rel` */
  due: string;
  /** due as days after the deal was won (the CLOSED DEAL date of a YES): 0 = that day; null = none */
  rel: number | null;
  how: PayHow;
  /** free text for the method: bank, cheque number, or what "อื่นๆ" is */
  howT: string;
  /** the condition / note: "มัดจำเมื่อเซ็นสัญญา" */
  note: string;
  /** received by hand (no document): the date; '' = not marked */
  rcv: string;
  /** amount received by hand; null = the planned amount */
  got: number | null;
  /** counted complete although less came in (withholding tax, rounding, an agreed discount) */
  full: boolean;
  /** what had come in when it was counted complete: `full` holds only while that is still what came in
   *  (a receipt deleted or changed since must not leave a later, smaller one settling it); null = always */
  fullAt: number | null;
  /** the hand receipt counts on top of the documents at its stage: part paid by hand, the rest with a
   *  receipt ("นับเพิ่ม"). Otherwise a document replaces the hand receipt. */
  add: boolean;
  at: string; by: string;
}
export interface SalesState {
  cfg: SalesCfg;
  deals: Record<string, Deal>;
  /** `${dealId}/${stage}` → step */
  steps: Record<string, DealStep>;
  /** `${dealId}/${docId}` → document */
  docs: Record<string, DealDoc>;
  /** `${dealId}/${stage}` → installment of the payment plan. An older build saving its copy of the
   *  tracker drops this from the browser's store; every page load re-reads the team log from the
   *  start (engine load()), which brings it back. */
  pays: Record<string, PayLine>;
  /** `${dealId}/${actId}` → a contact beyond the stages. Missing in what an older build stored: read as {}. */
  acts?: Record<string, DealAct>;
  log: Record<string, DealLog>;
  /** Deals deleted (here or by a teammate): id → when. Kept so an import never brings them back. */
  gone: Record<string, string>;
  /** Deals removed by undoing an import (shared, dundo/<id>): unlike a deletion, importing them again is fine. */
  undone: Record<string, string>;
  /** List items added in this browser while not connected to a team (this browser only): merged into
   *  the team's lists when it connects — and only these, so items the team removed don't come back. */
  offAdds?: Partial<Record<keyof SalesCfg, string[]>>;
  /** docId → the check of that quotation (`qchk/<docId>`, written by the team script only; lib/notify.ts). */
  qchk?: Record<string, QtCheck>;
  /** The team's notification rules (`scfg/notify.cfg`; lib/notify.ts). */
  ncfg?: NotifyCfg;
  /** Joint quotations (package quotes, item 7): header deal id → its mark (`jqt/<hid>`), and
   *  `${hid}/${dealId}` → a member company (`jqm/<hid>/<dealId>`). Missing in what an older build stored. */
  jqt?: Record<string, JointQt>;
  jqm?: Record<string, JointMember>;
  /** Units (`scfg/unit.<id>`), who is in which (`scfg/unitm.<staffKey>`) and the deals' revenue splits
   *  (`dshare/<dealId>`): lib/contrib.ts. */
  units?: Record<string, UnitRec>;
  unitm?: Record<string, UnitMember>;
  shares?: Record<string, ShareRec>;
  /** The month check for accounting (lib/payCheck.ts): `<dealId>/<lineId>` → the check of a received line
   *  (`dchk/`), 'YYYY-MM' → a month closed (`mclose/`), and the first day checked (`scfg/paychk.cfg`). */
  pchk?: Record<string, PayCheck>;
  mclose?: Record<string, MonthClose>;
  pcfg?: PayChkCfg;
  /** Job expenses (lib/expense.ts): `${dealId}/${expId}` → an expense (`dexp/`); accounting's check of a paid
   *  one, `${dealId}/${expId}` → `dchk/<dealId>/exp.<expId>`; 'YYYY-MM' → that month's expenses closed
   *  (`mclose/<YYYY-MM>/out`). None of it reaches an account without ดูค่าใช้จ่าย; missing in what an older
   *  build stored. */
  exp?: Record<string, JobExp>;
  xchk?: Record<string, PayCheck>;
  mcloseOut?: Record<string, MonthClose>;
}

export const emptyCfg = (): SalesCfg => ({ sections: DEFAULT_SECTIONS.slice(), sources: DEFAULT_SOURCES.slice(), services: DEFAULT_SERVICES.slice(), stages: DEFAULT_STAGES.slice() });
export const emptySales = (): SalesState => ({ cfg: emptyCfg(), deals: {}, steps: {}, docs: {}, pays: {}, acts: {}, log: {}, gone: {}, undone: {} });

/** Current Buddhist-era year as text. */
export const beYear = (iso = new Date().toISOString()) => String(+iso.slice(0, 4) + 543);
/** The year a job is added in: the year picked in the Sales Tracker, else this year (never the current year
 *  while another is picked: a job added while looking at 2568 is a 2568 job). */
export const jobYearOf = (picked: string, now = beYear()) => (/^\d{4}$/.test(picked) ? picked : now);
/** The history line of a job's year change (the deal panel's ปีของงาน): "เปลี่ยนปีของงานเป็น 2570". */
export const yearChangeWords = (year: string) => `เปลี่ยนปีของงานเป็น ${year}`;

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
  if (o.kept === true) doc.kept = true;
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
const HOWS = ['', 'transfer', 'cheque', 'cash', 'other'];
/** An installment record as this app can use it, or null (not an object). Out-of-range numbers become
 *  null rather than failing the whole row. */
export function toPay(v: unknown): PayLine | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const amt = num(o.amt), got = num(o.got), pct = num(o.pct), rel = num(o.rel), fullAt = num(o.fullAt);
  return {
    amt: amt != null && amt >= 0 ? amt : null,
    pct: pct != null && pct >= 0 && pct <= 100 ? pct : null,
    due: iso(o.due).slice(0, 10),
    rel: rel != null && Number.isInteger(rel) && rel >= -365 && rel <= 730 ? rel : null,
    how: (HOWS.includes(o.how as string) ? o.how : '') as PayHow,
    howT: str(o.howT, 300),
    note: str(o.note, 300),
    rcv: iso(o.rcv).slice(0, 10),
    got: got != null && got >= 0 ? got : null,
    full: o.full === true,
    fullAt: fullAt != null && fullAt >= 0 ? fullAt : null,
    add: o.add === true,
    at: iso(o.at),
    by: str(o.by, 100),
  };
}
export function toLog(v: unknown, id: string): DealLog | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { id, at: iso(o.at), by: str(o.by, 100), action: str(o.action, 100), client: str(o.client, 200), detail: str(o.detail, 300), deal: str(o.deal, 100) };
}
/** A contact record as this app can use it, or null (no date: it would never sort or count). An unknown
 *  type (a later build's) reads as อื่นๆ. */
export function toAct(v: unknown, deal: string, id: string): DealAct | null {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !deal || !id) return null;
  const o = v as Record<string, unknown>;
  const d = iso(o.d).slice(0, 10) || iso(o.at).slice(0, 10);
  if (!d) return null;
  return {
    id, deal, d, type: (ACT_TYPES.includes(o.type as ActType) ? o.type : 'other') as ActType, note: str(o.note, NOTE_MAX), stage: str(o.stage, 60).replace(/\//g, '-'),
    pid: str(o.pid, 100), by: str(o.by, 100), at: iso(o.at),
  };
}

/** A joint quotation's mark as this app can use it, or null (not an object). */
export function toJqt(v: unknown): JointQt | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return { title: str(o.title, 200), at: iso(o.at), by: str(o.by, 100) };
}
/** A joint quotation's member as this app can use it, or null (not an object). Out-of-range parts are
 *  null (an equal split), never a failed row; without ดูยอดเงิน the team script sends both as null. */
export function toJqm(v: unknown): JointMember | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const share = num(o.share), pct = num(o.pct);
  return { share: share != null && share >= 0 ? share : null, pct: pct != null && pct >= 0 && pct <= 100 ? pct : null, at: iso(o.at), by: str(o.by, 100) };
}

/** A stored stage's own record (raw: CALL1 is CALL1's; a step as it shows, its older stages read in: readStep). */
export const stepOf = (s: SalesState, id: string, stage: string): DealStep => s.steps[`${id}/${stage}`] || { d: '', n: '' };
const atOrder = (a: DealDoc, b: DealDoc) => (a.at || '').localeCompare(b.at || '');
/** A deal's documents, oldest attached first. One scan of every document per call, unless a pass over many
 *  deals has indexed them (withActIndex). */
export const docsOf = (s: SalesState, id: string): DealDoc[] =>
  ix && ix.s === s ? [...(ix.docs.get(id) || [])] : Object.values(s.docs).filter((d) => d.deal === id).sort(atOrder);
export const payOf = (s: SalesState, id: string, stage: string): PayLine | undefined => (s.pays || {})[`${id}/${stage}`];
/** Whether a deal has a payment plan (at least one installment). */
export const hasPlan = (s: SalesState, id: string) => Object.keys(s.pays || {}).some((k) => k.startsWith(id + '/'));

/** The PAY names of the team's stored list (PAY1, PAY2 for the default list): steps.ts listPays.
 *  @deprecated every installment is a step of its own now (dealSteps); kept while screens still ask. */
export const payStages = (cfg: SalesCfg): string[] => listPays(cfg);
/** A stage that is an installment: PAY1, PAY2, PAY3 …, or a PAY name of the team's list (steps.ts isPayName). */
export const isPayStage = (cfg: SalesCfg, p: string) => isPayName(cfg, p);
/** An installment at a stage of a deal: an installment's name, or a line of its plan (any name). */
export const isPayAt = (s: SalesState, dealId: string, p: string) => !!p && (isPayName(s.cfg, p) || !!payOf(s, dealId, p));
/** @deprecated "งวดเพิ่ม" is gone: every installment of a plan is a step (dealSteps). Always false. */
export const isExtraPay = (_cfg: SalesCfg, _p: string) => false;
/** Thai words of a stored stage (STAGE_TH); an installment reads "ชำระงวดที่ n". A deal's own words (a single
 *  installment is "PAY ชำระเงิน"): stepLabel. */
export const stageTh = (p: string) => STAGE_TH[p] || (isPayKey(p) ? 'ชำระงวดที่ ' + payNo(p) : '');
/** The document a stage stands for when attaching there. */
export const kindForStage = (cfg: SalesCfg, p: string): DocKind => (p === QUOTE_STAGE ? 'quotation' : isPayName(cfg, p) ? 'invoice' : 'other');
/** What a document attached at a stage counts toward: a quotation is Forecast; an invoice or receipt
 *  at an installment is Actual. Elsewhere as DocAttach always chose. */
export function targetForStage(cfg: SalesCfg, p: string, kind: DocKind): DocTarget {
  if (kind === 'quotation') return 'forecast';
  if ((kind === 'invoice' || kind === 'receipt') && isPayName(cfg, p)) return 'actual';
  return kind === 'invoice' ? 'actual' : 'none';
}
/** What a document of a kind may count toward (a card's "นับเป็น"), its own first: a quotation is an offer
 *  (Forecast, never money received), a receipt or an invoice is money received (Actual, never a Forecast —
 *  as one it would replace the quotation and stop counting at its PAY step); another document any. */
export const docTargets = (kind: DocKind): DocTarget[] =>
  kind === 'quotation' ? ['forecast', 'none'] : kind === 'receipt' || kind === 'invoice' ? ['actual', 'none'] : ['forecast', 'actual', 'none'];
/** A document counted toward what its kind never is (a receipt as the Forecast, a quotation as money received:
 *  an older build's choice), or null. */
export const targetWrong = (x: Pick<DealDoc, 'kind' | 'target' | 'amount'>): DocTarget | null =>
  x.amount != null && x.target !== 'none' && !docTargets(x.kind).includes(x.target) ? x.target : null;
/** What a document card's "นับเป็น" offers for type `kind` (docTargets) — and, for an invoice an older build
 *  counted as the Forecast, the Forecast as well: a job without a quotation may have taken its Forecast from
 *  it, and saving the form (for its number, say) must not move that money unasked. */
export const formTargets = (doc: Pick<DealDoc, 'kind' | 'target'>, kind: DocKind = doc.kind): DocTarget[] =>
  kind === 'invoice' && doc.kind === 'invoice' && doc.target === 'forecast' ? ['forecast', ...docTargets(kind)] : docTargets(kind);
/** A stage a document or a contact may be filed at on this deal: a step's (an older stage read into one too),
 *  an installment, a stage of the team's list, or a line of its plan. */
export const stageOk = (s: SalesState, d: Pick<Deal, 'id'>, p: string) => !!p && (isStepKey(s.cfg, p) || !!payOf(s, d.id, p));
/** Documents by their stored stage, for screens that still walk the team's stored list: a stage of that list or
 *  a line of the plan, else `other` ("เอกสารอื่น", so a document at a stage such a screen does not walk still shows).
 *  @deprecated by step: dealSteps (steps[i].docs, other.docs), which reads older stages into their steps. */
export function stageDocs(s: SalesState, d: Deal): { by: Record<string, DealDoc[]>; other: DealDoc[] } {
  const by: Record<string, DealDoc[]> = {}, other: DealDoc[] = [];
  docsOf(s, d.id).forEach((x) => (x.stage && (s.cfg.stages.includes(x.stage) || payOf(s, d.id, x.stage)) ? (by[x.stage] || (by[x.stage] = [])).push(x) : other.push(x)));
  return { by, other };
}
/** The Actual documents counted at a stage (with an amount), oldest confirmation first: what a new
 *  document there may replace ("ใช้ยอดนี้แทน") instead of adding to. */
export const countedAt = (s: SalesState, d: Deal, stage: string) =>
  docsOf(s, d.id)
    .filter((x) => x.stage === stage && x.target === 'actual' && x.amount != null)
    .sort((a, b) => (a.cAt || a.at || '').localeCompare(b.cAt || b.at || ''));

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
 *  / receipts add up (instalments), plus what was marked received by hand ("รับเงินแล้ว") on plan
 *  installments that have no Actual document (a document wins: nothing counts twice) or whose hand
 *  receipt was kept on top of it ("นับเพิ่ม", PayLine.add); without any, the typed-in actual. */
export function dealMoney(s: SalesState, d: Deal) {
  const docs = docsOf(s, d.id);
  const fcs = docs.filter((x) => x.target === 'forecast' && x.amount != null).sort((a, b) => confirmedAt(a).localeCompare(confirmedAt(b)));
  const latest = fcs[fcs.length - 1];
  const typed = d.forecast != null && (!latest || (d.fcAt || '') >= confirmedAt(latest));
  const fcDoc = typed ? undefined : latest;
  const acs = docs.filter((x) => x.target === 'actual' && x.amount != null);
  const hands = (planLines(s, d) || []).filter((x) => x.line.rcv && (x.line.add || !acs.some((a) => a.stage === x.stage)));
  const hand = hands.reduce((a, x) => a + (x.line.got ?? x.line.amt ?? 0), 0);
  return {
    forecast: fcDoc ? fcDoc.amount! : d.forecast,
    fcConfirmed: !!fcDoc,
    /** the quotation the forecast comes from */
    fcDoc,
    /** a typed forecast overrides a confirmed quotation */
    fcOverride: typed && !!latest,
    // (to the satang: 61,730.77 + 60,000 adds up to 121,730.76999… in floating point)
    actual: acs.length || hands.length ? Math.round((acs.reduce((a, x) => a + (x.amount || 0), 0) + hand) * 100) / 100 : d.actual,
    /** an Actual document exists (a hand receipt alone is not "confirmed by a document") */
    acConfirmed: acs.length > 0,
    acDocs: acs.length,
    /** received by hand ("บันทึกเอง"), included in `actual`: on installments without a document, or kept on top of one */
    hand,
  };
}

const actOrder = (a: DealAct, b: DealAct) => b.d.localeCompare(a.d) || (b.at || '').localeCompare(a.at || '');
/** While a pass over many deals runs (withActIndex): the contact records and documents by deal, and each deal's
 *  steps once worked out (dealSteps, by deal and day); null otherwise. */
let ix: { s: SalesState; acts: Map<string, DealAct[]>; docs: Map<string, DealDoc[]>; steps: Map<string, DealSteps> } | null = null;
/** A deal's contacts beyond the stages, newest first (by date, then when they were written). One scan of
 *  every record per call, unless a pass over many deals has indexed them (withActIndex). */
export const actsOf = (s: SalesState, id: string): DealAct[] =>
  ix && ix.s === s ? [...(ix.acts.get(id) || [])] : Object.values(s.acts || {}).filter((a) => a.deal === id).sort(actOrder);
/**
 * Runs `fn` with the contact records and documents indexed by deal, so a pass over many deals (filterDeals, the
 * filter row's counts, the Dashboard) reads each deal's records without scanning them all again, and works out
 * each deal's steps once. The index lives only for this synchronous call: the engine changes `s.acts` and
 * `s.docs` in place, so nothing is kept between calls.
 */
export function withActIndex<T>(s: SalesState, fn: () => T): T {
  if (ix && ix.s === s) return fn();
  const group = <X extends { deal: string }>(xs: X[], order: (a: X, b: X) => number) => {
    const by = new Map<string, X[]>();
    for (const x of xs) {
      const l = by.get(x.deal);
      if (l) l.push(x);
      else by.set(x.deal, [x]);
    }
    by.forEach((l) => l.sort(order));
    return by;
  };
  const was = ix;
  ix = { s, acts: group(Object.values(s.acts || {}), actOrder), docs: group(Object.values(s.docs), atOrder), steps: new Map() };
  try {
    return fn();
  } finally {
    ix = was;
  }
}
/** withActIndex: the documents are indexed too. */
export const withDealIndex = withActIndex;
/** Contacts by their stored stage, as stageDocs (a stage of the team's stored list or a line of the plan), else `other`.
 *  @deprecated by step: dealSteps (steps[i].entries, other.acts), which reads older stages into their steps. */
export function stageActs(s: SalesState, d: Deal): { by: Record<string, DealAct[]>; other: DealAct[] } {
  const by: Record<string, DealAct[]> = {}, other: DealAct[] = [];
  actsOf(s, d.id).forEach((a) => (a.stage && (s.cfg.stages.includes(a.stage) || payOf(s, d.id, a.stage)) ? (by[a.stage] || (by[a.stage] = [])).push(a) : other.push(a)));
  return { by, other };
}

/**
 * A joint quotation's company whose result is the payer's, on the payer's day: what closing the quotation
 * records for a company without a result (lib/joint jointFill, engine fillJoint), or the same typed by hand.
 * It is the team's word on the quotation, not a contact with that company: its date is not a contact
 * (stepContactDay). It still dates the result (the date filter's ได้ผลการขาย).
 */
export function followsPayer(s: SalesState, id: string): boolean {
  const x = s.steps[`${id}/${DEAL_STAGE}`];
  const r = x?.d ? x.n.trim().toUpperCase() : '';
  if (r !== 'YES' && r !== 'NO') return false;
  const hid = jointHeadOf(s, id), h = hid ? s.steps[`${hid}/${DEAL_STAGE}`] : undefined;
  return !!h && h.d === x!.d && h.n.trim().toUpperCase() === r;
}
/** A stage's date as a contact with the company: '' when it has none, or when it is not a contact
 *  (followsPayer: a joint quotation's company given the payer's result). */
export function stepContactDay(s: SalesState, id: string, p: string): string {
  const x = s.steps[`${id}/${p}`]?.d || '';
  return x && p === DEAL_STAGE && followsPayer(s, id) ? '' : x;
}

/** Installment keys looked for on a deal without a plan (PAY1 … PAY24): far more than a plan holds (PLAN_MAX). */
const PAY_SCAN = 24;
/**
 * Every stored stage a deal's steps read: the steps' own ids and the older stages read into them (CALL1 …), the
 * team's own stages, and the installments (the list's PAY names, PAY1 … with a record, the lines of its plan).
 * What the last contact, the date filter, the search and "started" read.
 */
export function stepKeys(s: SalesState, d: Pick<Deal, 'id'>): string[] {
  const out = new Set<string>(teamSteps(s.cfg).flatMap((x) => x.aliases));
  listPays(s.cfg).forEach((p) => out.add(p));
  for (let i = 1; i <= PAY_SCAN; i++) if (s.steps[`${d.id}/PAY${i}`]) out.add('PAY' + i);
  planStages(s, d).forEach((p) => out.add(p));
  return [...out];
}

/** The last contact and the stored stage or record it comes from (lastContactInfo). */
function lastContactAt(s: SalesState, d: Deal, today: string): { date: string; key: string; act?: DealAct } {
  let date = d.contactDate && d.contactDate <= today ? d.contactDate : '', key = date ? 'typed' : '';
  for (const p of stepKeys(s, d)) {
    const x = stepContactDay(s, d.id, p);
    if (x && x <= today && x > date) {
      date = x;
      key = p;
    }
  }
  const a = actsOf(s, d.id).find((x) => x.d <= today);
  if (a && a.d > date) return { date: a.d, key: 'act', act: a };
  return { date, key };
}
/** Last contact: the typed contact date, the latest date of a step (an older stage read into it too) or the
 *  latest contact record, whichever is later ('' when there is none), and where it came from: 'typed'
 *  (deal.contactDate), the step's code as it shows (CONTACT, FOLLOW, CLOSE, PAY …), or 'act' (then `act` is
 *  that record). A date in the future (a planned call) does not count, nor a joint quotation's company's
 *  result recorded from the payer's (stepContactDay). */
export function lastContactInfo(s: SalesState, d: Deal, today: string): { date: string; from: string; act?: DealAct } {
  const x = lastContactAt(s, d, today);
  if (x.key === 'act') return { date: x.date, from: 'act', act: x.act };
  return { date: x.date, from: x.key && x.key !== 'typed' ? stepLabel(s, d, x.key, today).code : x.key };
}
export const lastContact = (s: SalesState, d: Deal, today: string) => lastContactAt(s, d, today).date;

/** The CLOSED DEAL stage note decides the deal result: YES / NO / anything else = waiting. */
export function dealResult(s: SalesState, d: Deal): 'YES' | 'NO' | 'WAIT' | '' {
  const v = stepOf(s, d.id, DEAL_STAGE).n.trim().toUpperCase();
  return v === 'YES' ? 'YES' : v === 'NO' ? 'NO' : v ? 'WAIT' : '';
}

/** The deal's result and status in words. `started`: something is recorded at one of its steps (an older stage
 *  read into one too), or a contact record (a call, an e-mail, a meeting) was made. */
export function dealStatus(s: SalesState, d: Deal) {
  const r = dealResult(s, d);
  const started = stepKeys(s, d).some((p) => {
    const st = s.steps[`${d.id}/${p}`];
    return !!st && !!(st.d || st.n.trim());
  }) || actsOf(s, d.id).length > 0;
  // the result never uses the word "ปิด": ปิดงาน is what moves a job to the ปิดงาน tab
  const overall =
    d.jobStatus === 'closed' ? 'ปิดงาน'
    : r === 'YES' ? 'ได้งาน'
    : r === 'NO' ? 'ไม่ได้งาน'
    : r === 'WAIT' ? stepOf(s, d.id, DEAL_STAGE).n.trim()
    : started ? 'กำลังดำเนินการ'
    : 'ยังไม่เริ่ม';
  return { result: r, overall, started };
}

/** Days since the last contact when an open deal has gone more than OVERDUE_DAYS without one; a
 *  deal nobody has contacted yet counts from the day it was added (so it isn't forgotten). Not for a
 *  deal ready to close (lost, or won and paid: it needs closing, not a call), nor for a won deal with a
 *  payment plan (followed by its due dates: "เลยกำหนด" on the installment). A joint quotation's header is
 *  not a customer (its members are followed up), and a won member is paid through it. */
export function overdueDays(s: SalesState, d: Deal, today: string, t?: DealSteps) {
  if (d.jobStatus === 'closed') return null;
  const jr = jointRole(s, d);
  if (jr === 'header') return null;
  // (a company that withdrew from a joint quotation waits for it to close: nothing to follow up)
  // (a won job whose money is only counted twice is not one to call: payDone, not closeReady)
  if (dealResult(s, d) === 'NO' || payDone(s, d, today, t) || (dealResult(s, d) === 'YES' && (jr === 'member' || hasPlan(s, d.id)))) return null;
  const lc = lastContact(s, d, today) || (d.at || '').slice(0, 10);
  if (!lc || lc > today) return null;
  const n = Math.floor((Date.parse(today + 'T00:00:00') - Date.parse(lc + 'T00:00:00')) / 864e5);
  return isFinite(n) && n > OVERDUE_DAYS ? n : null;
}

/** The code of the last step done (CONTACT, FOLLOW, CLOSE …), '' when none is. `t`: the deal's steps when the
 *  caller has them (a table row works them out once: dealSteps). */
export function lastStage(s: SalesState, d: Deal, today = todayISO(), t = dealSteps(s, d, today)) {
  return [...t.steps].reverse().find((v) => v.counted && DONE.includes(v.state))?.code || '';
}

// ------------------------------------------------------------------ the steps of one deal (lib/steps.ts)

/**
 * Where a step stands:
 * - done: something recorded at it, dated today or earlier (or a note without a date); at CONTACT and FOLLOW a
 *   contact record up to today too; at an installment: received (the plan), else its note or a payment filed there;
 * - planned: its newest date is still ahead (a call booked, an installment due later);
 * - yes / no / wait: the CLOSE result;
 * - skipped: left empty before a later step that has something (never an installment still owed);
 * - next: the one to do now (the first not done after the last one done) — `next` names it, also when it is
 *   already planned or waiting for the result;
 * - future: still to come; off: not needed (the payments of a lost deal, a joint quotation's company's own).
 */
export type StageState = 'done' | 'planned' | 'yes' | 'no' | 'wait' | 'skipped' | 'next' | 'future' | 'off';
const DONE: StageState[] = ['done', 'yes', 'no', 'wait'];
/** One entry inside a step, newest first: a contact record (`act`), or an older stage's record read into it
 *  (`old`: "บันทึกเดิม CALL2"; `stage` is where it is stored, so it can be edited in place). */
export interface StepEntry { kind: 'act' | 'old'; d: string; at: string; stage: string; act?: DealAct; step?: DealStep }
/** One step of one deal, as every screen shows it. */
export interface StepView extends StepDef {
  /** the record new writes go to: CONTACT, QUOTATION, FOLLOW, CLOSED DEAL, PAY1 …, or the team's own stage */
  id: string;
  /** what shows: CONTACT · QUOTATION · FOLLOW · CLOSE · PAY (a single installment) · PAY1 … PAYn */
  code: string;
  /** ติดต่อประสานงาน · ส่งใบเสนอราคา · ติดตามผล · ผลการขาย (YES / NO) · ชำระเงิน · ชำระงวดที่ n */
  th: string;
  kind: StepKind;
  state: StageState;
  /** in "ทำแล้ว x จาก N", the progress dots and "next" (not: an installment outside the plan, a joint
   *  quotation's company's own payment) */
  counted: boolean;
  /** something is recorded at it: a record (its own or an older stage's), a contact at CONTACT / FOLLOW, an
   *  installment received or noted (the Dashboard's pipeline counts these) */
  filled: boolean;
  /** its date: a planned one ahead; else the newest of its records and contacts up to today; an installment's
   *  received day, else its due date ('' none) */
  date: string;
  /** CONTACT / FOLLOW done and a date booked ahead as well (CALL1 done, CALL2 planned): the next call, "นัด 14 ต.ค.";
   *  the step stays done, and is the next step while nothing after it is done */
  ahead?: string;
  /** the record at `id` (what the step's editor edits) */
  own: DealStep;
  /** the newest of the records read into it (its own or an older stage's): the step's one-line note */
  top: DealStep & { stage: string };
  /** contact records and older stages' records inside it, newest first */
  entries: StepEntry[];
  /** documents filed at it (an older stage's too; an installment no step has: the first PAY step's) */
  docs: DealDoc[];
  /** the plan's installment at this step */
  line: LineView | null;
  /** shown only for what it holds: an installment the plan no longer has ("นอกแผนชำระ"), or a joint
   *  quotation's company's payment (the joint quotation pays: "ชำระผ่านใบเสนอราคาร่วม") */
  outside?: 'plan' | 'joint';
  /** no plan, won, paid in part (by the money the deal shows): what is still owed on this installment, which
   *  stands in for the rest of the payment */
  short?: number;
  /** no plan: the rest of the payment ("PAY ส่วนที่เหลือ"), never a numbered installment. Derived while the money
   *  shows part of the Forecast received (`short`), or nothing to tell it by (no Actual, or a session without
   *  ดูยอดเงิน); kept for what it holds once recorded (PAY2 of the eight-stage list) */
  rest?: boolean;
}
export interface DealSteps {
  /** every step in order, the uncounted ones included */
  steps: StepView[];
  next: StepView | null;
  /** counted steps done (done, yes, no, wait) and how many are counted: "ทำแล้ว 3 จาก 5 ขั้น" */
  done: number;
  total: number;
  result: 'YES' | 'NO' | 'WAIT' | '';
  /** contact records, older stages' records and CONTACT / FOLLOW's own: "ติดต่อ 7 ครั้ง" */
  contacts: number;
  /** what no step reads (a stage no longer anywhere, none): "การติดต่ออื่น", "เอกสารอื่น" */
  other: { acts: DealAct[]; docs: DealDoc[] };
}

const NO_STEP: DealStep = { d: '', n: '' };
const isFilled = (x: DealStep | undefined): x is DealStep => !!x && !!(x.d || x.n.trim());
/** "ชำระงวดที่ 3" for PAY3; any other installment name "ชำระเงิน". */
const payTh = (p: string) => (isPayKey(p) ? 'ชำระงวดที่ ' + payNo(p) : 'ชำระเงิน');
/** The second PAY step of a deal without a plan: the rest of the payment, never "งวดที่ 2" of a plan it has not. */
export const REST_TH = 'ส่วนที่เหลือ';

/**
 * A deal's steps, its next step and how far it is (lib/steps.ts): what the panel, the table, the phone card, the
 * plan list, the Dashboard, the filters and closing all read.
 * - CONTACT, FOLLOW read their older stages (CALL2, CALL1; FOLLOW2, FOLLOW1): the newest date wins, the older
 *   records are entries; a record or a contact record up to today completes them, and a date booked ahead as
 *   well is their `ahead` (the next call: they are the next step while nothing after them is done). QUOTATION,
 *   CLOSE and the team's own stages read their own record; a contact there is an entry and completes nothing.
 * - PAY: with a plan (also before YES, as a draft), one step per installment, PAY1 … PAYn ("ชำระงวดที่ n"; a plan
 *   of one: PAY); without one a single "PAY ชำระเงิน" step (the list's first PAY name, PAY1), and another holding
 *   a record or a payment shows and counts too: the second is "PAY ส่วนที่เหลือ" (`rest`), more than two are
 *   numbered as stored. A won deal without a plan whose single PAY step is done has the rest as one more, owed,
 *   while it cannot be told paid in full: the money shows part of the Forecast received (Actual below it by more
 *   than a withholding tax: `short`), or the Forecast is known and no Actual is (`short` the whole Forecast), or
 *   the session sees no money (no amount). An installment the plan no longer has but which holds something
 *   stays, not counted ("นอกแผนชำระ"); a joint quotation's company pays through it (its payment is not
 *   counted); after NO a single PAY "ไม่ต้องทำ".
 */
export function dealSteps(s: SalesState, d: Deal, today: string): DealSteps {
  const c = ix && ix.s === s ? ix.steps : null, k = d.id + '|' + today;
  const hit = c?.get(k);
  if (hit) return hit;
  const r = buildSteps(s, d, today);
  c?.set(k, r);
  return r;
}
function buildSteps(s: SalesState, d: Deal, today: string): DealSteps {
  const res = dealResult(s, d), jm = jointRole(s, d) === 'member', hide = moneyHidden(s);
  const docs = docsOf(s, d.id), acts = actsOf(s, d.id), P = s.pays || {};
  const plan = res !== 'NO' && !jm ? planOf(s, d, today) : null;
  const defs = teamSteps(s.cfg), lp = listPays(s.cfg), first = lp[0] || 'PAY1';
  const rec = (p: string) => s.steps[`${d.id}/${p}`];
  const isPay = (p: string) => isPayKey(p) || lp.includes(p);
  const byNo = (a: string, b: string) => (payNo(a) || 99) - (payNo(b) || 99) || a.localeCompare(b);

  // ---- the installments
  const money = (p: string) => docs.some((x) => x.stage === p && countsActual(x));
  // done on its own (no plan): its record (not planned ahead), a payment filed there; without ดูยอดเงิน a
  // receipt attached or recorded (what carries no amount)
  const paidOwn = (p: string) =>
    (isFilled(rec(p)) && !(rec(p)!.d > today)) || money(p) || (hide && (docs.some((x) => x.stage === p && x.kind === 'receipt') || !!P[d.id + '/' + p]?.rcv || !!P[d.id + '/' + p]?.full));
  const keys = new Set<string>(lp);
  for (let i = 1; i <= PAY_SCAN; i++) if (rec('PAY' + i)) keys.add('PAY' + i);
  docs.forEach((x) => isPay(x.stage) && keys.add(x.stage));
  acts.forEach((x) => isPay(x.stage) && keys.add(x.stage));
  const holds = (p: string) => isFilled(rec(p)) || docs.some((x) => x.stage === p) || acts.some((x) => x.stage === p);
  type Pay = { id: string; line: LineView | null; outside?: 'plan' | 'joint'; short?: number };
  let pays: Pay[];
  const planned = hide && !jm && res !== 'NO' ? planStages(s, d) : [];
  if (plan || planned.length) {
    const ids = plan ? plan.lines.map((l) => l.stage) : planned;
    pays = [
      ...ids.map((id) => ({ id, line: plan?.lines.find((l) => l.stage === id) || null })),
      ...[...keys].filter((p) => !ids.includes(p) && holds(p)).sort(byNo).map((id) => ({ id, line: null, outside: 'plan' as const })),
    ];
  } else if (jm) {
    pays = [first, ...[...keys].filter((p) => p !== first && (isFilled(rec(p)) || money(p))).sort(byNo)].map((id) => ({ id, line: null, outside: 'joint' as const }));
  } else {
    pays = [first, ...[...keys].filter((p) => p !== first && (isFilled(rec(p)) || money(p))).sort(byNo)].map((id) => ({ id, line: null }));
    // its single PAY step done, but not known to be paid in full: the rest is one more, owed (as PAY2 was in the
    // eight-stage list, which every deal without a plan had). A session without ดูยอดเงิน cannot tell, so it
    // says what the eight-stage list said: the rest is still to record. Both kinds of session agree on a deal
    // paid in part; one paid in full at a single PAY is ready only where the money shows it.
    if (res === 'YES' && pays.length === 1 && paidOwn(first)) {
      const m = hide ? null : dealMoney(s, d);
      const owed = !m ? null : m.forecast == null ? 0 : m.actual == null ? m.forecast : m.actual < m.forecast && whtRate(m.forecast, m.actual) == null ? m.forecast - m.actual : 0;
      if (owed !== 0) pays.push({ id: 'PAY' + (Math.max(1, payNo(first)) + 1), line: null, ...(owed != null ? { short: Math.round(owed * 100) / 100 } : {}) });
    }
  }
  const nPay = pays.filter((p) => !p.outside).length;
  // without a plan: one PAY, then the rest; more than two only from records (an old tracker's PAY3): numbered
  const noPlan = !plan && !planned.length && !jm;

  // ---- where each contact record and document shows
  const stepIds = new Set(defs.filter((x) => x.kind !== 'pay').map((x) => x.id)), payIds = pays.map((p) => p.id);
  const where = (stage: string) => {
    if (!stage) return '';
    const id = stepIdOf(stage);
    if (stepIds.has(id)) return id;
    if (payIds.includes(stage)) return stage;
    // at an installment no step has (a plan made smaller, PAY3 without a plan): the first PAY step's
    return isPay(stage) ? payIds[0] : '';
  };
  const bags = new Map<string, { acts: DealAct[]; docs: DealDoc[] }>();
  const bag = (id: string) => bags.get(id) || bags.set(id, { acts: [], docs: [] }).get(id)!;
  const other = { acts: [] as DealAct[], docs: [] as DealDoc[] };
  acts.forEach((a) => {
    const w = where(a.stage);
    (w ? bag(w).acts : other.acts).push(a);
  });
  docs.forEach((x) => {
    const w = where(x.stage);
    (w ? bag(w).docs : other.docs).push(x);
  });
  const actEntry = (a: DealAct): StepEntry => ({ kind: 'act', d: a.d, at: a.at, stage: a.stage, act: a });

  // ---- each step, before "next"
  const views: StepView[] = [];
  for (const def of defs) {
    if (def.kind === 'pay') {
      for (const p of pays) views.push(payView(p));
      continue;
    }
    const own = rec(def.id) || NO_STEP, b = bag(def.id);
    const recs = def.aliases.map((a) => ({ stage: a, ...(rec(a) || NO_STEP) })).filter(isFilled);
    // the newest date wins (one dated over one not); an equal date: the step's own, then the newer stage
    const top = recs.reduce<(DealStep & { stage: string }) | null>((m, r) => (!m || r.d > m.d ? r : m), null) || { ...NO_STEP, stage: def.id };
    const entries = [...b.acts.map(actEntry), ...recs.filter((r) => r.stage !== def.id).map((r): StepEntry => ({ kind: 'old', d: r.d, at: '', stage: r.stage, step: { d: r.d, n: r.n } }))].sort(
      (x, y) => y.d.localeCompare(x.d) || y.at.localeCompare(x.at),
    );
    let state: StageState = 'future', date = '', filled = isFilled(own), ahead = '';
    if (def.kind === 'close') {
      if (filled) state = res === 'YES' ? 'yes' : res === 'NO' ? 'no' : res === 'WAIT' ? 'wait' : own.d > today ? 'planned' : 'next';
      date = own.d;
    } else if (def.kind === 'contact' || def.kind === 'follow') {
      filled = recs.length > 0 || b.acts.length > 0;
      // done by anything up to today (a record, a note without a date, a contact); a date booked ahead as well
      // is the next call (CALL1 done, CALL2 planned: one step, done, "นัด 14 ต.ค.")
      const past = [...recs.map((r) => (r.d <= today ? r.d : '')), ...b.acts.map((a) => (a.d <= today ? a.d : ''))].filter(Boolean).sort();
      const before = past.length > 0 || recs.some((r) => !r.d);
      if (top.d > today && !before) (state = 'planned'), (date = top.d);
      else if (before) {
        state = 'done';
        date = past[past.length - 1] || '';
        if (top.d > today) ahead = top.d;
      }
    } else if (filled) {
      state = own.d > today ? 'planned' : 'done';
      date = own.d;
    }
    views.push({ ...def, aliases: def.aliases.slice(), state, counted: true, filled, date, ...(ahead ? { ahead } : {}), own, top, entries, docs: b.docs, line: null });
  }
  function payView(p: Pay): StepView {
    const own = rec(p.id) || NO_STEP, b = bag(p.id), l = p.line;
    const single = !p.outside ? nPay === 1 || (noPlan && nPay === 2 && pays[0] === p) : p.outside === 'joint' && p.id === first;
    const rest = !p.outside && noPlan && nPay === 2 && pays[1] === p;
    let state: StageState = 'future', date = own.d;
    if (p.outside || res === 'NO') state = paidOwn(p.id) ? 'done' : own.d > today ? 'planned' : 'off';
    else if (l && l.status === 'paid') (state = 'done'), (date = l.rcvDate || today);
    else if (l && res === 'YES') (date = l.due), (state = l.due && l.due > today ? 'planned' : 'future');
    else if (paidOwn(p.id)) state = 'done';
    else if (own.d > today) state = 'planned';
    else if (l) date = l.due;
    return {
      id: p.id, code: single || rest ? PAY_SLOT.code : p.id, th: single ? PAY_SLOT.th : rest ? REST_TH : payTh(p.id), kind: 'pay', aliases: [p.id],
      state, counted: !p.outside, filled: state === 'done' || isFilled(own), date, own, top: { ...own, stage: p.id },
      entries: b.acts.map(actEntry), docs: b.docs, line: l, ...(p.outside ? { outside: p.outside } : {}), ...(p.short != null ? { short: p.short } : {}), ...(rest ? { rest } : {}),
    };
  }

  // ---- skipped and next, over the counted steps
  const seq = views.filter((v) => v.counted);
  const lastFilled = seq.map((v) => v.state !== 'future' && v.state !== 'off').lastIndexOf(true);
  // (a won deal's installment is still owed, never skipped)
  seq.forEach((v, i) => v.state === 'future' && i < lastFilled && !(v.kind === 'pay' && res === 'YES') && (v.state = 'skipped'));
  const dIx = seq.findIndex((v) => v.kind === 'close');
  let next = -1;
  if (res === 'WAIT') next = dIx;
  else if (res !== 'NO') {
    let lastDone = -1;
    seq.forEach((v, i) => ['done', 'yes', 'wait'].includes(v.state) && (lastDone = i));
    // the furthest step done has a call booked ahead (CONTACT, FOLLOW): that call is what comes next
    next = lastDone >= 0 && seq[lastDone].ahead ? lastDone : seq.findIndex((v, i) => i > lastDone && (v.state === 'planned' || v.state === 'future' || v.state === 'next'));
    // not decided yet: the result is asked for before anything after it (payments, a stage of the team's)
    if (dIx >= 0 && res !== 'YES' && (next < 0 || next > dIx)) next = dIx;
    // won: the first installment not received, also one still owed before a later one that came in
    const pn = res === 'YES' ? seq.findIndex((v) => v.kind === 'pay' && v.state !== 'done') : -1;
    if (pn >= 0 && (next < 0 || next > pn)) next = pn;
  }
  // only one step is "next" (CLOSE with a date and no result is "next" until another one is)
  seq.forEach((v, i) => {
    if (i === next && (v.state === 'future' || v.state === 'skipped')) v.state = 'next';
    else if (i !== next && v.state === 'next') v.state = isFilled(v.own) ? 'planned' : 'future';
  });
  return {
    steps: views,
    next: next >= 0 ? seq[next] : null,
    done: seq.filter((v) => DONE.includes(v.state)).length,
    total: seq.length,
    result: res,
    // (a step's own record at CONTACT or FOLLOW is a contact too, as an older stage's read into it is)
    contacts: views.reduce((a, v) => a + v.entries.length + ((v.kind === 'contact' || v.kind === 'follow') && isFilled(v.own) ? 1 : 0), 0) + other.acts.length,
    other,
  };
}

/** "CONTACT ติดต่อประสานงาน": a step in words. */
export const stepWords = (v: Pick<StepDef, 'code' | 'th'>) => (v.th ? `${v.code} ${v.th}` : v.code);
/** A stored stage in words, for a contact, a document, a history row, a date filter's "what": the step it reads
 *  into ("CALL2" → CONTACT ติดต่อประสานงาน, 'CLOSED DEAL' → CLOSE); an installment as the deal's steps name it
 *  (a single one: PAY ชำระเงิน). */
export function stepLabel(s: SalesState, d: Deal | null, stage: string, today: string): { code: string; th: string } {
  const id = stepIdOf(stage), def = teamSteps(s.cfg).find((x) => x.id === id && x.kind !== 'pay');
  if (def) return { code: def.code, th: def.th };
  if (d && isPayAt(s, d.id, stage)) {
    const v = dealSteps(s, d, today).steps.find((x) => x.kind === 'pay' && x.id === stage);
    if (v) return { code: v.code, th: v.th };
  }
  return { code: stage, th: STAGE_TH[stage] || (isPayKey(stage) ? payTh(stage) : '') };
}
/** An installment in a few words, as the steps name it: PAY, PAY2, and the rest of a payment without a plan
 *  "PAY ส่วนที่เหลือ" (what is left, Cashflow's lines, the closing words). Any other stage: its code (stepLabel). */
export function stepCode(s: SalesState, d: Deal | null, stage: string, today: string) {
  const w = stepLabel(s, d, stage, today);
  return w.th === REST_TH ? `${w.code} ${w.th}` : w.code;
}
/** A step's record as one: the newest of the records read into it (CONTACT, CALL2, CALL1: the newest date wins);
 *  `stage` is where it is stored. A stage no step reads into: its own record. */
export function readStep(s: SalesState, dealId: string, stepId: string): DealStep & { stage: string } {
  const def = teamSteps(s.cfg).find((x) => x.id === stepIdOf(stepId) && x.kind !== 'pay');
  const recs = (def ? def.aliases : [stepId]).map((a) => ({ stage: a, ...(s.steps[`${dealId}/${a}`] || NO_STEP) })).filter(isFilled);
  return recs.reduce<(DealStep & { stage: string }) | null>((m, r) => (!m || r.d > m.d ? r : m), null) || { ...NO_STEP, stage: def ? def.id : stepId };
}

/**
 * The deal's steps by id as the progress track reads them (dealSteps): `states` by step id (an older stage's id
 * reads its step's state), `next` the next step's id, `nextStep` its record.
 * @deprecated read dealSteps; kept while screens still ask for this shape.
 */
export function stageTrack(s: SalesState, d: Deal, today: string) {
  const t = dealSteps(s, d, today), states: Record<string, StageState> = {};
  t.steps.forEach((v) => v.aliases.forEach((a) => !(a in states) && (states[a] = v.state)));
  return { states, next: t.next?.id || '', nextStep: t.next ? t.next.own : null, done: t.done, total: t.total, result: t.result, steps: t };
}

/** The step a new contact record belongs to unless the user picks another: the step the deal is at, i.e. the
 *  last one done (a call after the first one is one more contact at CONTACT), else the next one (nothing done
 *  yet), else the first. */
export function actStage(s: SalesState, d: Deal, today: string) {
  const t = dealSteps(s, d, today), seq = t.steps.filter((v) => v.counted);
  return [...seq].reverse().find((v) => DONE.includes(v.state))?.id || t.next?.id || seq[0]?.id || CONTACT_STEP;
}

/** A document whose counted amount is not the document's own figure because the user kept theirs when
 *  the reader found another ("คงยอดเดิม", DealDoc.kept): `doc` is the document's figure, `kept` the one
 *  counted, `diff` = kept − doc. Only that decision counts: a typed amount (a misread corrected, a figure
 *  before VAT picked, what an older build stored) is the user's reading of the document, not a mismatch. */
export function docMismatch(x: Pick<DealDoc, 'amount' | 'detected' | 'kept'>): { doc: number; kept: number; diff: number } | null {
  if (!x.kept || x.amount == null || x.detected == null) return null;
  const diff = Math.round((x.amount - x.detected) * 100) / 100;
  return diff ? { doc: x.detected, kept: x.amount, diff } : null;
}
/** "ยอดในเอกสาร 160,500 บาท ไม่ตรงกับแผน 160,000 บาท (ต่าง 500)": `what` names the figure ("แผน",
 *  "Forecast ที่พิมพ์ไว้", "ยอดที่รับ"); an English word is set off with a space, as everywhere in the app. */
export const mismatchText = (doc: number, fig: number, what: string) => `ยอดในเอกสาร ${fmtMoney(doc)} บาท ไม่ตรงกับ${/^[A-Za-z]/.test(what) ? ' ' : ''}${what} ${fmtMoney(fig)} บาท (ต่าง ${fmtMoney(Math.abs(Math.round((doc - fig) * 100) / 100))})`;

/** One line for a deal: its status, and the result when the job is closed ("ปิดงาน" alone doesn't say whether it was won), else the stage reached. */
export function trackerStatus(S: SalesState, d: Deal, today = todayISO()) {
  const st = dealStatus(S, d);
  const res = st.result === 'YES' || st.result === 'NO' ? st.result : '';
  const last = lastStage(S, d, today);
  const plan = d.jobStatus === 'open' && res === 'YES' ? planOf(S, d, today) : null;
  const overall = plan ? `ได้งาน · รับแล้ว ${plan.paidN}/${plan.n} งวด` : st.overall.length > 40 ? st.overall.slice(0, 40) + '…' : st.overall; // a waiting note can be long
  return [overall, d.jobStatus === 'closed' && res ? 'ผล ' + res : '', !res && last ? 'ขั้นล่าสุด ' + last : ''].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ payment plan (dpay records)

/** The day the deal was won: the CLOSED DEAL date when the result is YES, else ''. */
export const wonDate = (s: SalesState, d: Deal) => (dealResult(s, d) === 'YES' ? stepOf(s, d.id, DEAL_STAGE).d : '');
/** An installment's due date: the typed date, else the won date + `rel` days, else '' (before YES the UI
 *  says "30 วันหลังได้งาน"). A relative date follows a later change of the CLOSED DEAL date; a typed one doesn't. */
export const dueOf = (l: Pick<PayLine, 'due' | 'rel'>, won: string) => l.due || (l.rel != null && won ? addDays(won, l.rel) : '');
/** The stage of installment n (1-based): the n-th PAY stage of the list, else "PAY<n>" (an extra one). */
export const payStageFor = (cfg: SalesCfg, n: number) => payStages(cfg)[n - 1] || 'PAY' + n;
/** Amounts in these proportions that add up to `total` exactly: whole baht, the rounding goes to the last. */
export function splitAmounts(total: number, shares: number[]): number[] {
  if (!shares.length) return [];
  let w = shares.map((x) => (isFinite(x) && x > 0 ? x : 0));
  if (!w.some((x) => x)) w = w.map(() => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.floor((total * x) / sum));
  out[out.length - 1] += Math.round((total - out.reduce((a, b) => a + b, 0)) * 100) / 100;
  return out;
}

/**
 * What a plan set on a deal without one starts from: the PAY stages already paid, as received
 * installments — by their documents (`amt` = what they add up to), or the old way, by the stage note
 * (`old` = the day; `amt` = the typed Actual the documents don't cover, shared among such stages, which
 * setPlan then marks received by hand). One paid the old way with nothing to say how much (`amt` null)
 * stays out of the plan, done by its note. `used` = every paid stage: new installments take the others.
 * One document counted more than once (dupCounted) counts once, by its newest copy: a plan line never
 * carries a double count on after the copies are set right (61,730.77 + 60,000 of one receipt is not a
 * PAY of 121,730.77). A stage paid only by an older copy gets no amount (and is never received by hand: the
 * copy is that money). Sums to the satang.
 */
export function planStart(s: SalesState, d: Deal, today: string): { lines: { stage: string; amt: number | null; old: string }[]; used: string[] } {
  if (hasPlan(s, d.id)) return { lines: [], used: [] };
  const all = docsOf(s, d.id).filter(countsActual), extra = new Set(dupCounted(s, d).flatMap((gr) => gr.slice(0, -1)));
  const paid = payState(s, d, today).paid, acs = all.filter((x) => !extra.has(x));
  const sum = (xs: DealDoc[]) => Math.round(xs.reduce((a, x) => a + (x.amount || 0), 0) * 100) / 100;
  const byDocs = (p: string) => sum(acs.filter((x) => x.stage === p));
  const held = (p: string) => sum(all.filter((x) => x.stage === p));
  const noted = paid.filter((p) => !held(p));
  const rest = d.actual != null ? Math.max(0, d.actual - sum(all)) : 0;
  const shares = rest > 0 && noted.length ? splitAmounts(rest, noted.map(() => 1)) : [];
  const lines = paid.map((p) => {
    if (byDocs(p)) return { stage: p, amt: byDocs(p), old: '' };
    if (held(p)) return { stage: p, amt: null, old: '' };
    const sd = stepOf(s, d.id, p).d;
    return { stage: p, amt: shares[noted.indexOf(p)] ?? null, old: sd && sd <= today ? sd : today };
  });
  return { lines, used: paid };
}

/** The plan fields of an installment, as the editor types them (what was received is not among them). */
export const PLAN_FIELDS = ['amt', 'pct', 'due', 'rel', 'how', 'howT', 'note'] as const;
export type PlanInput = { stage: string } & Pick<PayLine, (typeof PLAN_FIELDS)[number]>;
/** The stage note "รับเงินแล้ว" fills in (an empty one), so builds without the plan see the stage done too. */
export const paidNote = (l: Pick<PayLine, 'amt' | 'got' | 'how'>) => `รับชำระแล้ว ${fmtMoney(l.got ?? l.amt ?? 0)} บาท${l.how ? ' · ' + HOW_TH[l.how] : ''}`;

/**
 * The tracker of a session that may not see money (no ดูยอดเงิน): the team script sent its amounts as
 * null, so nothing is worked out from them. Its deals have no payment plan here (no amounts, no part
 * paid, late or due from figures it never got); payState still says which installments came in, from
 * what carries no amount: a receipt recorded (its date), the stage done, a receipt attached there. The
 * engine marks its state (setMoneyHidden).
 */
const blind = new WeakSet<object>();
export function setMoneyHidden(s: SalesState, on: boolean) {
  if (on) blind.add(s);
  else blind.delete(s);
}
export const moneyHidden = (s: SalesState) => blind.has(s);

/** One installment in plan order: `n` is its number (1-based); `code` what it shows as (PAY for a plan of one
 *  installment, else its stage: PAY1 … PAYn); `inList` = its stage is a PAY name of the team's stored list (as the
 *  team script reads the plan; no screen shows it any more: every installment is a step). */
export interface PlanEntry { stage: string; n: number; code: string; inList: boolean; line: PayLine }
/** The plan's installments in order — the PAY stages of the list first (list order), then extra ones
 *  (and lines whose stage an admin renamed or removed) by the number in their name — or null without a
 *  plan (and for a session that may not see money: see setMoneyHidden). */
export function planLines(s: SalesState, d: Deal): PlanEntry[] | null {
  if (blind.has(s)) return null;
  const names = planStages(s, d);
  if (!names.length) return null;
  const pays = payStages(s.cfg), P = s.pays || {};
  return names.map((stage, i) => ({ stage, n: i + 1, code: names.length === 1 ? PAY_SLOT.code : stage, inList: pays.includes(stage), line: P[d.id + '/' + stage] }));
}
/** The stages of a deal's plan in plan order (see planLines); [] without one. */
function planStages(s: SalesState, d: Pick<Deal, 'id'>): string[] {
  const pre = d.id + '/', P = s.pays || {};
  const names = Object.keys(P).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length));
  if (!names.length) return [];
  const pays = payStages(s.cfg), no = (p: string) => +p.replace(/\D/g, '') || 99;
  return [...pays.filter((p) => names.includes(p)), ...names.filter((p) => !pays.includes(p)).sort((a, b) => no(a) - no(b) || a.localeCompare(b))];
}

/** paid รับแล้ว · part รับบางส่วน · late เลยกำหนด · due ถึงกำหนด (within 7 days) · wait รอชำระ · draft แผน (typed
 *  before YES) · off ยกเลิก (the result is NO; kept in case the deal is reopened). */
export type PayStatus = 'paid' | 'part' | 'late' | 'due' | 'wait' | 'draft' | 'off';
export const PAY_STATUS_TH: Record<PayStatus, string> = { paid: 'รับแล้ว', part: 'รับบางส่วน', late: 'เลยกำหนด', due: 'ถึงกำหนด', wait: 'รอชำระ', draft: 'แผน', off: 'ยกเลิก' };
/** Days ahead of the due date an installment counts as "ถึงกำหนด". */
export const DUE_SOON = 7;
export interface LineView extends PlanEntry {
  /** planned amount (0 when not decided) */
  amt: number;
  /** effective due date ('' = none yet) */
  due: string;
  /** received: the Actual documents at its stage, else the hand receipt */
  got: number;
  /** still owed on it (0 once received, counted complete, before YES or after NO) */
  left: number;
  status: PayStatus;
  /** days past the due date while something is owed (also on a part-paid one), else 0 */
  lateDays: number;
  /** when it came in: the step date its document set (else the document date), or the hand-receipt date */
  rcvDate: string;
  /** the Actual documents counted at its stage, oldest first; `doc` = the latest */
  docs: DealDoc[];
  doc: DealDoc | null;
  /** received by hand ("รับเงินแล้ว"): with no document, or kept on top of the documents (PayLine.add) */
  hand: boolean;
  /** what of `got` was received by hand (0 without a hand receipt counted) */
  handGot: number;
  /** counted complete while less came in ("ถือว่ารับครบ", still for what came in: PayLine.fullAt) */
  full: boolean;
}
/** One installment, plan against actual. A document replaces a hand receipt unless the user kept both
 *  ("นับเพิ่ม"), so a stage is never counted twice; several documents at one stage add up. */
export function lineView(s: SalesState, d: Deal, x: PlanEntry, today: string): LineView {
  const docs = docsOf(s, d.id).filter((z) => z.stage === x.stage && z.target === 'actual' && z.amount != null);
  const l = x.line, hand = !!l.rcv && (!docs.length || l.add);
  const handGot = hand ? (l.got ?? l.amt ?? 0) : 0;
  const got = Math.round((docs.reduce((a, z) => a + (z.amount || 0), 0) + handGot) * 100) / 100;
  const amt = l.amt ?? 0, res = dealResult(s, d), due = dueOf(l, wonDate(s, d));
  // granted for what had come in then: a receipt deleted or changed since opens the installment again
  const full = l.full && (l.fullAt == null || Math.abs(got - l.fullAt) < 0.005);
  const status: PayStatus =
    res === 'NO' ? 'off'
    : got > 0 && (got >= amt || full) ? 'paid'
    : got > 0 ? 'part'
    : res !== 'YES' ? 'draft'
    : due && due < today ? 'late'
    : due && daysBetween(today, due) <= DUE_SOON ? 'due'
    : 'wait';
  const owed = status === 'part' || status === 'late' || status === 'due' || status === 'wait';
  const doc = docs[docs.length - 1] || null, st = stepOf(s, d.id, x.stage);
  const rcvDate = doc ? (st.d && st.d <= today ? st.d : doc.docDate || localDay(doc.at)) : l.rcv;
  return {
    ...x, amt, due, got, status, rcvDate, docs, doc, hand, handGot, full,
    left: owed ? Math.max(0, amt - got) : 0,
    lateDays: owed && due && due < today ? daysBetween(due, today) : 0,
  };
}
export interface PlanView {
  lines: LineView[];
  /** planned total, received, still owed */
  total: number; got: number; left: number;
  /** the Forecast it is compared with, and total − Forecast (shown, never enforced) */
  base: number | null; diff: number | null;
  n: number; paidN: number;
  /** the first installment not received (also before YES), null when all are */
  next: LineView | null;
  /** installments past their due date with something owed */
  late: LineView[];
}
/** The whole plan, or null without one. */
export function planOf(s: SalesState, d: Deal, today: string): PlanView | null {
  const L = planLines(s, d);
  if (!L) return null;
  const lines = L.map((x) => lineView(s, d, x, today)), sum = (k: 'amt' | 'got' | 'left') => lines.reduce((a, l) => a + l[k], 0);
  const total = sum('amt'), base = dealMoney(s, d).forecast;
  return {
    lines, total, got: sum('got'), left: sum('left'), base, diff: base != null ? total - base : null, n: lines.length,
    paidN: lines.filter((l) => l.status === 'paid').length,
    next: lines.find((l) => l.status !== 'paid' && l.status !== 'off') || null,
    late: lines.filter((l) => l.lateDays > 0),
  };
}
/** The withholding-tax rate (1, 2, 3 or 5 %) that a short payment matches — the shortfall equals that
 *  share of the amount before VAT (amount / 1.07), within a baht — or null. "ถือว่ารับครบ" is offered
 *  pre-ticked then. */
export function whtRate(planned: number, got: number): number | null {
  const short = planned - got;
  if (!(short > 0) || !(planned > 0)) return null;
  return [1, 2, 3, 5].find((r) => Math.abs(Math.round(((planned / 1.07) * r) / 100) - short) <= 1) ?? null;
}
/** Installments still to be received of won deals, due from `from` to `to` (inclusive; `from` '' = also
 *  every late one), soonest first: the calendar's "รับชำระ" entries (derived, never stored). A closed job
 *  with an installment still unpaid is listed too: money owed is followed until it comes in (as Cashflow
 *  counts it); a joint quotation's member pays nothing of its own (the header does). */
export function payDue(s: SalesState, deals: Deal[], from: string, to: string, today: string): { deal: Deal; line: LineView }[] {
  const out: { deal: Deal; line: LineView }[] = [];
  deals.forEach((d) => {
    if (dealResult(s, d) !== 'YES' || jointRole(s, d) === 'member') return;
    planOf(s, d, today)?.lines.forEach((l) => l.status !== 'paid' && l.status !== 'off' && l.due && l.due >= from && l.due <= to && out.push({ deal: d, line: l }));
  });
  return out.sort((a, b) => a.line.due.localeCompare(b.line.due) || a.deal.client.localeCompare(b.deal.client));
}
/** The plan in one CSV cell: "PAY1 53,500 (22/08/2026 โอน) รับแล้ว; PAY2 53,500 (20/10/2026 โอน)" (one installment: "PAY …"). */
export function planCsv(s: SalesState, d: Deal, today: string): string {
  const P = planOf(s, d, today);
  if (!P) return '';
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return P.lines
    .map((l) => {
      const when = l.due ? dmy(l.due) : l.line.rel != null ? (l.line.rel ? `${l.line.rel} วันหลังได้งาน` : 'เมื่อได้งาน') : '';
      const info = [when, l.line.how ? HOW_TH[l.line.how] : ''].filter(Boolean).join(' ');
      const st = l.status === 'paid' || l.status === 'part' || l.status === 'late' ? ' ' + PAY_STATUS_TH[l.status] : '';
      return `${l.code} ${l.line.amt != null ? fmtMoney(l.line.amt) : '-'}${info ? ` (${info})` : ''}${st}`;
    })
    .join('; ');
}

// ------------------------------------------------------------------ payments and closing

/** The deal's installments and which are paid. With a plan: its installments, paid when received in full or
 *  counted complete. Without one: its PAY steps (dealSteps: a single PAY, then the rest while it cannot be told
 *  paid in full, or a step holding a record or a payment), paid when done (dated today or earlier, or a note) or
 *  holding an Actual document — a planned date alone is not paid. A joint quotation's member is paid through its
 *  header: the header's payments are its own (ready to close, รอชำระเงิน). `t`: the deal's steps when the caller
 *  has them (dealSteps; a table row works them out once). */
export function payState(s: SalesState, d: Deal, today: string, t?: DealSteps): { pays: string[]; paid: string[]; left: string[]; plan: PlanView | null } {
  if (jointRole(s, d) === 'member') {
    const h = s.deals[jointHeadOf(s, d.id)];
    if (h) return payState(s, h, today);
  }
  const plan = planOf(s, d, today);
  if (plan) {
    const pays = plan.lines.map((l) => l.stage), paid = plan.lines.filter((l) => l.status === 'paid').map((l) => l.stage);
    return { pays, paid, left: pays.filter((p) => !paid.includes(p)), plan };
  }
  // (without ดูยอดเงิน, no amounts here: the plan's installments when there is one, and what came in by what
  // carries no amount: a receipt recorded, the step done, a receipt attached there; dealSteps)
  const ps = (t || dealSteps(s, d, today)).steps.filter((v) => v.kind === 'pay' && v.counted);
  const pays = ps.map((v) => v.id), paid = ps.filter((v) => v.state === 'done').map((v) => v.id);
  return { pays, paid, left: pays.filter((p) => !paid.includes(p)), plan: null };
}
/** When to offer "ปิดงาน": the result is NO; or it is YES and every installment of the plan is received
 *  (in full or counted complete) — without a plan, every PAY step of the deal is paid (payState) — and no
 *  document is counted twice (dupCounted: the Actual says "นับซ้ำ"; never "paid in full" until it counts once).
 *  Installments outside the plan, and a plan total off the Forecast, don't matter.
 *  A joint quotation closes as one (its header and every company together, engine.closeJoint): a company of
 *  it is ready when its quotation is (the payer said NO, or YES and paid in full), whatever its own result. */
export function closeReady(s: SalesState, d: Deal, today: string, t?: DealSteps): boolean {
  if (jointRole(s, d) === 'member') {
    const h = s.deals[jointHeadOf(s, d.id)];
    if (h) return closeReady(s, h, today);
  }
  // (a document counted twice is not "paid in full": it is counted once first — dupCounted, the panel's box)
  return payDone(s, d, today, t) && (dealResult(s, d) !== 'YES' || !dupCounted(s, d).length);
}
/** closeReady without the double-count check: the result is NO, or YES and every installment is in — a job
 *  that needs closing (or fixing its count), not a call (overdueDays, the plan's contact list). */
export function payDone(s: SalesState, d: Deal, today: string, t?: DealSteps): boolean {
  if (jointRole(s, d) === 'member') {
    const h = s.deals[jointHeadOf(s, d.id)];
    if (h) return payDone(s, h, today);
  }
  const r = dealResult(s, d);
  return r === 'NO' || (r === 'YES' && payState(s, d, today, t).left.length === 0);
}
/**
 * What a won deal without a plan still owes of its Forecast: one rule for the deal panel, the table row, the
 * phone card, ค้างรับ and Cashflow. Forecast − Actual while one of its PAY steps is still to receive (payState),
 * else nothing — and then, when the Actual is still below the Forecast, why: `wht` the shortfall is withholding
 * tax (the single PAY received in full, dealSteps), else `under` (the rest of the payment was done with less: a
 * receipt of part of it, a note such as "ตกลงลดยอด"). null: not won, a plan (its lines say it), no Forecast, or a
 * joint quotation's company (the joint quotation owes).
 */
export function owedNoPlan(s: SalesState, d: Deal, today: string, t?: DealSteps): { owed: number; wht: { short: number; rate: number } | null; under: number } | null {
  if (dealResult(s, d) !== 'YES' || jointRole(s, d) === 'member' || planOf(s, d, today)) return null;
  const m = dealMoney(s, d);
  if (m.forecast == null) return null;
  const A = m.actual || 0;
  if (!(A < m.forecast)) return { owed: 0, wht: null, under: 0 };
  if (payState(s, d, today, t).left.length) return { owed: m.forecast - A, wht: null, under: 0 };
  const short = Math.round((m.forecast - A) * 100) / 100, r = m.actual != null ? whtRate(m.forecast, m.actual) : null;
  return r != null ? { owed: 0, wht: { short, rate: r }, under: 0 } : { owed: 0, wht: null, under: short };
}

/** What a document attaches as: its kind, amount, what it counts toward, date; `stage` = where the user
 *  attached it (omitted: the generic "แนบเอกสาร…", the stage is chosen); `replace` = a counted Actual
 *  document at that stage the new one replaces ("ใช้ยอดนี้แทน"); `addHand` = the installment's hand
 *  receipt keeps counting with it ("นับเพิ่ม": paid partly by hand, the rest with this receipt); `drop` =
 *  other counted copies of the same document that stop counting with it (countAs 'replace'). */
export interface AttachInfo {
  kind: DocKind; amount: number | null; target: DocTarget; docDate: string; stage?: string; replace?: string; drop?: string[]; addHand?: boolean;
  /** what the document is (its number, file name and size), when known: a preview (withDoc) then sees it counted
   *  twice as saving it would (dupCounted, closeReady) */
  docNo?: string; name?: string; size?: number;
}
/** Whether a document counts as money received: Actual with an amount. At a PAY stage only such a
 *  document completes the stage, replaces another or takes over its note. */
export const countsActual = (x: Pick<DealDoc, 'target' | 'amount'>) => x.target === 'actual' && x.amount != null;
/**
 * The stage a document is tied to.
 * - Attached at a stage: that stage when a step reads it (a step's id, an older stage read into one, an
 *   installment, a stage of the team's list) or it is an installment of the deal's plan, else '' (no step
 *   is written for a stage nothing shows).
 * - Otherwise a quotation / Forecast document goes to QUOTATION, and an Actual one to the first installment
 *   not received (of the plan; else the first PAY step not paid), else the last one; anything else to ''.
 */
export function attachStage(s: SalesState, d: Deal, info: Pick<AttachInfo, 'kind' | 'target' | 'stage'>, today: string): string {
  const p = info.stage;
  if (p !== undefined) return stageOk(s, d, p) ? p : '';
  if (info.target === 'forecast' || (info.target === 'none' && info.kind === 'quotation')) return QUOTE_STAGE;
  if (info.target !== 'actual') return '';
  const ps = payState(s, d, today);
  return ps.plan?.next?.stage || ps.left[0] || ps.pays[ps.pays.length - 1] || '';
}
/** The tracker as attachDoc would leave it with this document (DocAttach previews from it): the
 *  document counted, its stage done on the document date, a replaced document no longer counted. */
export function withDoc(s: SalesState, d: Deal, info: AttachInfo, today: string): SalesState {
  const stage = attachStage(s, d, info, today), id = '~pending', at = '9999-12-31T00:00:00.000Z'; // the newest confirmation
  const docs: Record<string, DealDoc> = {
    ...s.docs,
    [`${d.id}/${id}`]: {
      id, deal: d.id, kind: info.kind, name: info.name ?? '', mime: '', size: info.size ?? 0, fileId: '', docNo: info.docNo ?? '', docDate: info.docDate, amount: info.amount,
      target: info.amount == null ? 'none' : info.target, detected: null, basis: 'manual', stage, at, cAt: at, by: '',
    },
  };
  const counts = countsActual(info);
  // the document replaced, and the other copies of it that stop counting with it
  const gone = counts ? [info.replace, ...(info.drop || [])].map((id) => (id ? s.docs[`${d.id}/${id}`] : undefined)).filter((x): x is DealDoc => !!x) : [];
  const steps = { ...s.steps };
  gone.forEach((old) => (docs[`${d.id}/${old.id}`] = { ...old, target: 'none' }));
  for (const old of gone) {
    // replaced at another stage (the same receipt attached again elsewhere): the PAY stage it completed
    // is empty again unless another counted document there takes it over (engine releaseAuto)
    const os = old.auto?.stage;
    if (os && os !== stage && isPayAt(s, d.id, os) && stepOf(s, d.id, os).n === old.auto!.n) {
      const heir = Object.values(docs).some((x) => x.deal === d.id && x.stage === os && countsActual(x));
      const st = stepOf(s, d.id, os);
      if (!heir) steps[`${d.id}/${os}`] = { d: old.auto!.d && st.d !== old.auto!.d ? st.d : '', n: '' };
    }
  }
  const k = `${d.id}/${stage}`, pl = (s.pays || {})[k];
  const pays = info.addHand && counts && pl?.rcv ? { ...s.pays, [k]: { ...pl, add: true } } : s.pays;
  if (stage && (!isPayAt(s, d.id, stage) || counts)) {
    const st = stepOf(s, d.id, stage), ad = info.docDate && info.docDate <= today ? info.docDate : today;
    if (!st.n.trim()) steps[`${d.id}/${stage}`] = { d: ad, n: '·' };
    else if (!st.d || st.d > today) steps[`${d.id}/${stage}`] = { d: ad, n: st.n };
  }
  return { ...s, docs, steps, pays };
}
/**
 * DocAttach's "หลังแนบ" line: where the document goes and what it changes. `line`: the installment at
 * that stage afterwards (with a plan); `short`: what it still lacks against the plan; `wht`: the
 * withholding rate the shortfall matches ("ถือว่ารับครบงวดนี้" pre-ticked); `ready` / `readyIfFull`:
 * attaching makes the deal ready to close (counting the short installment complete, for the second);
 * `unpaid`: installments received before and not after (a copy at another one stops counting).
 */
export function attachPreview(s: SalesState, d: Deal, info: AttachInfo, today: string) {
  const stage = attachStage(s, d, info, today), after = withDoc(s, d, info, today);
  const psAfter = payState(after, d, today);
  const line = (stage && planOf(after, d, today)?.lines.find((l) => l.stage === stage)) || null;
  const m = dealMoney(after, d), was = closeReady(s, d, today);
  const k = `${d.id}/${stage}`, full = line && line.got > 0 && line.got < line.amt ? { ...after, pays: { ...after.pays, [k]: { ...after.pays[k], full: true, fullAt: line.got } } } : after;
  return {
    stage, line,
    short: line ? Math.max(0, line.amt - line.got) : 0,
    wht: line && line.got > 0 && line.got < line.amt ? whtRate(line.amt, line.got) : null,
    actual: m.actual,
    /** Actual reaches the Forecast */
    fcFull: m.forecast != null && m.actual != null && m.actual >= m.forecast,
    ready: !was && closeReady(after, d, today),
    readyIfFull: !was && closeReady(full, d, today),
    // (still owed after it: the rest of a payment without a plan, gone once the money makes up the Forecast, is not)
    unpaid: payState(s, d, today).paid.filter((p) => !psAfter.paid.includes(p) && psAfter.left.includes(p)),
  };
}

/**
 * How a new Actual document counts next to the money already counted (DocAttach asks):
 * - 'replace' "ใช้ยอดนี้แทน": the earlier document stays as evidence, no longer counted — every counted copy
 *   of this same document (a deal that already counts it twice counts it once again), else the other
 *   document counted at this installment (or the installment's hand receipt gives way to it);
 * - 'add' "นับเพิ่ม": both count (an installment paid in several parts);
 * - 'none' "ไม่นับยอดซ้ำ": attached as evidence only;
 * - 'move': it is the receipt of money already counted at another installment — recorded by hand there,
 *   or by an invoice alone — and is attached there in its place;
 * - 'rest': only the part of the job not counted yet counts (a final receipt whose total takes in a
 *   deposit already counted).
 */
export type CountMode = 'replace' | 'add' | 'none' | 'move' | 'rest';
export interface CountGuard {
  /** the stage it goes to */
  stage: string;
  /** the same document already counted as Actual in this deal (its number, or the same file: name and
   *  size): the copy at that stage, else the newest */
  same: DealDoc | null;
  /** every counted copy of it, oldest first; two or more = the deal counts it twice already */
  sames: DealDoc[];
  /** counted twice already on a deal without a plan: its single PAY step, where "ใช้ยอดนี้แทน" counts it once
   *  wherever it is attached again (the second PAY step of such a deal, "PAY ส่วนที่เหลือ", is only what the money
   *  leaves of the Forecast: lib/steps); '' otherwise */
  home: string;
  sameBy: 'no' | 'file' | '';
  /** the newest other document counted at that stage */
  old: DealDoc | null;
  /** that stage's installment, part paid by hand ("รับเงินแล้ว" short) with no document */
  handPart: LineView | null;
  /** another installment received by hand with no document, for an amount this document shows, when the
   *  document looks like its receipt: counted on top it would take Actual past the plan, or it is dated
   *  within a week of that money */
  hand: LineView | null;
  /** an invoice counted as the money of another installment that has no receipt yet, which this receipt
   *  pays: it names the invoice's number, or shows its amount */
  inv: DealDoc | null;
  /** counting it on top takes Actual well past the plan (or Forecast) of a job already paid, or the
   *  document is the whole job's figure while money is already counted: Actual before and after, and what
   *  it is compared with */
  over: { before: number; after: number; cap: number; what: string } | null;
  /** the same for "นับเพิ่ม" (what Actual becomes when the user counts it on top anyway) */
  overAdd: { before: number; after: number; cap: number; what: string } | null;
  /** 'rest': what is left of the plan / Forecast after the money already counted */
  rest: number | null;
  /** the choices to offer, in display order; [] = nothing to ask (it simply counts) */
  modes: CountMode[];
  /** the suggested choice */
  pick: CountMode;
}
/** A job counts as already paid at 90% of its plan / Forecast (withholding tax short of it); Actual
 *  going more than 5% past it on top of that is money counted twice more likely than an extra. */
const PAID_SHARE = 0.9, OVER_SHARE = 1.05, SAME_WEEK = 7;
export const docNoKey = (no: string) => (no || '').replace(/[\s\-/_.#:]/g, '').toUpperCase();
/** One document attached twice: the same number, or the same file (name and size). */
const sameDocument = (a: Pick<DealDoc, 'docNo' | 'name' | 'size'>, b: Pick<DealDoc, 'docNo' | 'name' | 'size'>) => {
  const k = docNoKey(a.docNo);
  return (k.length >= 3 && k === docNoKey(b.docNo)) || (a.size > 0 && a.size === b.size && a.name === b.name);
};
/**
 * The Actual documents of a deal that are one document counted more than once (an old double count, or two
 * teammates attaching the same receipt before either synced): each group oldest first. The deal panel and
 * the tracker row say so ("นับซ้ำ"); attaching it again with "ใช้ยอดนี้แทน", or setting the extra ones to
 * "ไม่นับยอด", counts it once.
 */
export function dupCounted(s: SalesState, d: Deal): DealDoc[][] {
  const groups: DealDoc[][] = [];
  for (const x of docsOf(s, d.id).filter(countsActual)) {
    const hit = groups.filter((gr) => gr.some((y) => sameDocument(x, y)));
    hit.forEach((h) => groups.splice(groups.indexOf(h), 1));
    groups.push([...hit.flat(), x]);
  }
  const at = (x: DealDoc) => x.at || '';
  return groups.filter((gr) => gr.length > 1).map((gr) => gr.sort((a, b) => at(a).localeCompare(at(b))));
}
/** Another copy of `doc` (its number, or its file) counted as money received on the deal, or null: what a
 *  copy that starts to count would double. */
export const countedCopy = (s: SalesState, d: Pick<Deal, 'id'>, doc: DealDoc): DealDoc | null =>
  docsOf(s, d.id).find((x) => x.id !== doc.id && countsActual(x) && sameDocument(x, doc)) || null;
/** The records with `doc` changed as engine.updateDoc saves it: no amount counts toward nothing, and a new
 *  target (or a new amount on a figure not replaced by a newer one) is a new confirmation — as a Forecast it
 *  becomes the newest, the one in use. What a form says before saving is worked out on this. */
export function docEdited(s: SalesState, d: Deal, doc: DealDoc, patch: Partial<Pick<DealDoc, 'amount' | 'target' | 'kind'>>): SalesState {
  const n: DealDoc = { ...doc, ...patch };
  if (n.amount == null) n.target = 'none';
  const superseded = doc.target === 'forecast' && dealMoney(s, d).fcDoc?.id !== doc.id;
  if (n.target !== doc.target || (n.amount !== doc.amount && !superseded)) n.cAt = '9999-12-31T23:59:59.999Z';
  return { ...s, docs: { ...s.docs, [`${d.id}/${doc.id}`]: n } };
}
/** Whether counting `doc` as money received (as type `kind`) would count money twice: another copy of it
 *  counts already, another document counts at its stage (attached, a receipt there takes its invoice's place
 *  — this form changes one document only), or money is in already and it would take Actual more than 5% past
 *  the Forecast. */
export function countsTwice(s: SalesState, d: Deal, doc: DealDoc, kind: DocKind = doc.kind): boolean {
  if (countedCopy(s, d, doc)) return true;
  if (doc.stage && countedAt(s, d, doc.stage).some((x) => x.id !== doc.id)) return true;
  const b = dealMoney(s, d), before = b.acDocs || b.hand ? b.actual ?? 0 : 0;
  if (!(before > 0)) return false;
  const a = dealMoney(docEdited(s, d, doc, { kind, target: 'actual' }), d), after = a.actual ?? 0;
  return a.forecast != null && a.forecast > 0 && after > a.forecast * OVER_SHARE && after > before + 0.005;
}
/** What a document card's "นับเป็น" opens on for type `kind` (formTargets): what it counts toward when that
 *  is offered — never moving money as the form opens. Else (an older build's choice its type never is, or
 *  the type changed in the form):
 * - an invoice that is the Forecast stays so only while it is the job's only Forecast;
 * - a quotation opens on "ไม่นับยอด": as the Forecast it would replace the quotation in use;
 * - a receipt or an invoice on Actual, unless that would count money twice (countsTwice): "ไม่นับยอด".
 */
export function formTarget(s: SalesState, d: Deal, doc: DealDoc, kind: DocKind = doc.kind, t: DocTarget = doc.target): DocTarget {
  const stale = kind === doc.kind && t === doc.target && !!targetWrong(doc);
  if (formTargets(doc, kind).includes(t) && !(stale && dealMoney(docEdited(s, d, doc, { target: 'none' }), d).forecast != null)) return t;
  if (!docTargets(kind).includes('actual')) return 'none';
  return countsTwice(s, d, doc, kind) ? 'none' : 'actual';
}
/** What attaching with `mode` sends (DocAttach → attachDoc): the document replaced and the other copies
 *  that stop counting, the hand receipt kept on top of it, what it counts toward, where it goes, and the
 *  figure counted ('rest'). */
export function countAs(g: CountGuard, mode: CountMode, info: AttachInfo): AttachInfo {
  const plain: AttachInfo = { ...info, replace: undefined, drop: undefined, addHand: false };
  if (mode === 'replace') {
    // the copy at this stage hands its stage note over; every other copy stops counting too (no plan: it is
    // counted once at the single PAY step, `home`)
    const at = g.home || g.stage;
    const main = g.sames.find((x) => x.stage === at) || g.sames[g.sames.length - 1] || g.old;
    const drop = g.sames.filter((x) => x !== main).map((x) => x.id);
    return { ...plain, ...(g.home ? { stage: g.home } : {}), replace: main?.id, ...(drop.length ? { drop } : {}) };
  }
  if (mode === 'none') return { ...plain, target: 'none' };
  if (mode === 'move' && g.inv) return { ...plain, stage: g.inv.stage, replace: g.inv.id };
  if (mode === 'move' && g.hand) return { ...plain, stage: g.hand.stage };
  if (mode === 'rest' && g.rest != null) return { ...plain, amount: g.rest, addHand: !!g.handPart };
  return { ...plain, addHand: !!g.handPart };
}
/**
 * Whether a new Actual document would count money twice, and what to ask (CountMode).
 * - The same document already counted (its number or its file): at this installment "ใช้ยอดนี้แทน" is
 *   suggested, at another one "ไม่นับยอดซ้ำ" (it is counted there; moving it would leave that installment
 *   unpaid); counted twice already, "ใช้ยอดนี้แทน" wherever it is attached, which leaves it counted once.
 * - Another document counted at this installment, or a part paid by hand: "ใช้ยอดนี้แทน" (or "นับเพิ่ม"
 *   from "แนบใบเสร็จเพิ่ม").
 * - A receipt for an invoice counted at another installment (it names the invoice, or shows its amount):
 *   attached there in place of the invoice ('move') — unless the user chose this installment and only the
 *   amount matches, when it is offered.
 * - Whatever the case, a choice that would take Actual well past the plan / Forecast of a job already paid
 *   (or count a whole-job document on top of money already in) is not suggested: the receipt of money
 *   counted at another installment goes there ('move'), else only what is left of the job counts ('rest'),
 *   else it is attached without counting ('none'); "นับเพิ่ม" stays a choice.
 * - Money of an amount the document shows recorded by hand at another installment, with no document there:
 *   always asked. Suggested as that money's receipt ('move') unless the user chose this installment
 *   (`pinned`) or the document is dated more than a week after that money ('add' then, 'move' offered).
 * `info.add`: opened from "แนบใบเสร็จเพิ่ม"; `pinned`: opened at an installment the user chose (not the
 * Actual figure's "แนบเอกสาร", which goes to the first one not received); `figures`: the amounts the
 * document shows (total, net, …); `refs`: other documents' numbers it names (lib/docExtract).
 */
export function countGuard(
  s: SalesState,
  d: Deal,
  info: AttachInfo & { add?: boolean; pinned?: boolean; docNo: string; name: string; size: number; figures?: (number | null | undefined)[]; refs?: string[] },
  today: string,
): CountGuard {
  const stage = attachStage(s, d, info, today);
  const g: CountGuard = { stage, same: null, sames: [], sameBy: '', home: '', old: null, handPart: null, hand: null, inv: null, over: null, overAdd: null, rest: null, modes: [], pick: 'add' };
  if (!countsActual(info)) return g;
  const counted = docsOf(s, d.id).filter(countsActual);
  const no = docNoKey(info.docNo);
  // the same number on a receipt and an invoice is not one document twice: some vendors number both
  // alike (INV2026090004), and the receipt then pays that invoice (it replaces it, below)
  const byNo = no.length >= 3 ? counted.filter((x) => docNoKey(x.docNo) === no && x.kind === info.kind) : [];
  const byFile = info.size > 0 ? counted.filter((x) => x.size === info.size && x.name === info.name) : [];
  g.sames = counted.filter((x) => byNo.includes(x) || byFile.includes(x));
  g.sameBy = byNo.length ? 'no' : byFile.length ? 'file' : '';
  g.same = g.sames.find((x) => x.stage === stage) || g.sames[g.sames.length - 1] || null;
  g.old = (stage ? countedAt(s, d, stage).filter((x) => !g.sames.includes(x)) : []).pop() || null;
  const plan = planOf(s, d, today);
  if (g.sames.length > 1 && !plan) g.home = payState(s, d, today).pays[0] || '';
  const line = stage ? plan?.lines.find((l) => l.stage === stage) : undefined;
  g.handPart = line && line.hand && !line.docs.length && line.status === 'part' ? line : null;
  // the same document at another installment is counted there already: suggested as evidence only, as
  // moving it ("ใช้ยอดนี้แทน") leaves that installment unpaid; at this installment it replaces itself; a
  // deal that counts it twice already replaces every copy, wherever this one goes
  const twice = g.sames.length > 1, elsewhere = !twice && !!g.same && g.same.stage !== stage;
  g.modes = elsewhere ? ['none', 'replace', 'add'] : g.same ? ['replace', 'none', 'add'] : g.old || g.handPart ? ['replace', 'add'] : [];
  let natural: CountMode = elsewhere ? 'none' : g.same || ((g.old || g.handPart) && !info.add) ? 'replace' : 'add';
  const figs = [info.amount, ...(info.figures || [])].filter((x): x is number => x != null && x > 0);
  const eq = (a: number, b: number | null | undefined) => b != null && Math.abs(a - b) < 0.005;
  // a receipt for an invoice that counts as the money of another installment (no receipt there yet)
  if (info.kind === 'receipt' && !g.sames.length) {
    const refs = new Set((info.refs || []).map(docNoKey).filter((k) => k.length >= 3));
    const invs = counted.filter((x) => x.kind === 'invoice' && !!x.stage && x.stage !== stage && counted.every((y) => y.stage !== x.stage || y.kind === 'invoice'));
    const byRef = invs.find((x) => refs.has(docNoKey(x.docNo)) || (no.length >= 3 && docNoKey(x.docNo) === no));
    g.inv = byRef || invs.find((x) => figs.some((f) => eq(f, x.amount))) || null;
    if (g.inv) {
      // named by the receipt, or attached from the Actual figure: its invoice's installment; at an
      // installment the user chose with only the amount alike, offered
      const sure = !!byRef || !info.pinned, rest: CountMode[] = g.modes.length ? g.modes : ['add'];
      g.modes = sure ? ['move', ...rest] : [...rest, 'move'];
      if (sure) natural = 'move';
    }
  }
  // money already counted (a typed Actual is replaced by documents, not added to) against what is expected
  const m = dealMoney(s, d), cap = plan && plan.total > 0 ? plan.total : m.forecast ?? 0;
  const before = m.acDocs || m.hand ? m.actual ?? 0 : 0;
  // a whole-job figure while money is already counted: its total takes in what came before (a final
  // receipt that deducts the deposit, a full receipt after a part payment)
  const whole = before > 0 && (info.amount ?? 0) >= cap * PAID_SHARE;
  const overBy = (mode: CountMode) => {
    if (!(cap > 0) || (before < cap * PAID_SHARE && !whole)) return null;
    const after = dealMoney(withDoc(s, d, countAs(g, mode, info), today), d).actual ?? 0;
    return after > cap * OVER_SHARE && after > before + 0.005 ? { before, after, cap, what: plan && plan.total > 0 ? 'แผน' : 'Forecast' } : null;
  };
  const handFor = (near: (l: LineView) => boolean) =>
    plan?.lines.find((l) => l.stage !== stage && l.hand && !l.docs.length && l.handGot > 0 && figs.some((f) => eq(f, l.handGot)) && near(l)) || null;
  g.over = overBy(natural);
  g.overAdd = natural === 'add' ? g.over : overBy('add');
  if (g.over) {
    if (!g.inv) g.hand = handFor(() => true);
    // what is left of the job, when it is less than this document's figure (a job already paid has none)
    const left = before < cap * PAID_SHARE ? Math.round((cap - before) * 100) / 100 : 0;
    g.rest = left > 0.005 && left < (info.amount ?? 0) - 0.005 ? left : null;
    const has = (x: CountMode) => (x === 'replace' ? g.modes.includes('replace') : x === 'move' ? !!(g.inv || g.hand) : x === 'rest' ? g.rest != null : true);
    g.modes = (['replace', 'move', 'rest', 'none', 'add'] as CountMode[]).filter(has);
    g.pick = g.modes.includes('replace') && !overBy('replace') ? 'replace' : g.inv || g.hand ? 'move' : g.rest != null ? 'rest' : 'none';
    return g;
  }
  // money recorded by hand at another installment with no document yet, of an amount this document shows:
  // this may be its receipt, so it is always asked (never counted on top silently). Attached where the app
  // picked the installment (the Actual figure's "แนบเอกสาร", a file dropped on the panel: the first one not
  // received) it is suggested as that money's receipt ('move') — "รับเงินแล้ว" in one tap records the day of
  // the tap, often after the money and its receipt — unless the document is dated more than a week after
  // that money (then it is the next payment). At an installment the user chose it counts there, "ย้าย" offered.
  if (!g.modes.length) {
    const after = (l: LineView) => !!info.docDate && !!l.line.rcv && daysBetween(l.line.rcv, info.docDate) > SAME_WEEK;
    g.hand = handFor((l) => !after(l)) || handFor(() => true);
    if (g.hand) {
      const own = !!info.pinned || after(g.hand);
      g.modes = own ? ['add', 'move'] : ['move', 'add'];
      natural = own ? 'add' : 'move';
    }
  }
  g.pick = natural;
  return g;
}

/** Quick views of the table: what needs doing (combined with the other filters). `paylate` is reached
 *  from the KPI ค้างรับ ("เลยกำหนด"): won deals with an installment past its due date. */
export type QuickView = '' | 'overdue' | 'notstarted' | 'active' | 'payment' | 'ready' | 'paylate';
export function quickMatch(s: SalesState, d: Deal, q: QuickView, today: string) {
  if (!q) return true;
  if (q === 'overdue') return overdueDays(s, d, today) != null;
  // (a joint quotation is ready as one: its header and its companies when its payer is, closeReady; the
  // view counts it once, workTally jobs)
  if (q === 'ready') return d.jobStatus === 'open' && closeReady(s, d, today);
  const st = dealStatus(s, d);
  if (q === 'notstarted') return !st.started;
  if (q === 'active') return st.started && (st.result === '' || st.result === 'WAIT');
  if (q === 'paylate') return st.result === 'YES' && !!payState(s, d, today).plan?.late.length;
  // won, and an installment (a PAY stage, or a line of the plan) is still to be received
  return st.result === 'YES' && payState(s, d, today).left.length > 0;
}

export type { DateBasis, DateF } from './dateRange';
/** A list filter: any of these values (OR inside the field); `not` = none of them. */
export interface ListF { v: string[]; not?: true }
export type ListKey = 'resp' | 'source' | 'service' | 'referral' | 'section' | 'unit';
export const LIST_KEYS: ListKey[] = ['resp', 'source', 'service', 'referral', 'section', 'unit'];
export type ResultF = '' | 'YES' | 'NO' | 'WAIT' | 'EMPTY';
/** The table's filters (AND across fields). `quick`: a quick view; `job`: open or closed jobs only;
 *  `date`: a date range on one of a deal's dates (null = the whole year). */
/** ใบเสนอราคา (the table's filter): sent, not yet sent, or any ('' ). */
export type QuoteF = '' | 'sent' | 'unsent';
const QUOTES: QuoteF[] = ['', 'sent', 'unsent'];
/**
 * ส่งแล้ว: the QUOTATION step is done (recorded, and not planned ahead of today), or a quotation document is attached
 * to the deal. A note or a date alone counts as recorded; an invoice or a receipt does not. Pure: the filter, its
 * counts and the tests read this one rule.
 */
export function quoteSent(s: SalesState, d: Pick<Deal, 'id'>, today: string): boolean {
  const st = s.steps[`${d.id}/${QUOTE_STAGE}`];
  return (!!st && (!!st.d || !!st.n.trim()) && !(st.d > today)) || docsOf(s, d.id).some((x) => x.kind === 'quotation');
}

export interface SalesFilter {
  year: string; q?: string; quick?: QuickView; job?: '' | 'open' | 'closed';
  resp?: ListF; source?: ListF; service?: ListF; referral?: ListF; section?: ListF;
  /** หน่วยงาน (package dash): the units a deal's money goes to (lib/contrib.ts dealUnits; NONE = ยังไม่ระบุหน่วยงาน) */
  unit?: ListF;
  result?: ResultF; date?: DateF | null;
  /** ใบเสนอราคา: sent (quoteSent) or not yet (the Sales Tracker's filter row; not the Dashboard's) */
  quote?: QuoteF;
  /** 'cash' (the table's lens "เงินเข้าตามปี", the Cashflow tab): a deal of another year counts in this one
   *  when one of its installments is received or due in it. Unset: the deal's own year only (as always). */
  money?: 'cash';
  /** the Dashboard's การรับเงิน: deals with money of that kind (cashLines) inside the date range, else the
   *  year; it reads the range on its own dates (received / due), never basisDates. Implies money 'cash'. */
  pay?: PayF;
}
/** การรับเงิน: received (รับแล้ว), still owed (ค้างรับ, late included) or late (เลยกำหนด). */
export type PayF = '' | 'got' | 'owed' | 'late';
const PAYS: PayF[] = ['', 'got', 'owed', 'late'];
/** The date a pay filter reads a range on: received money on the day it came in, owed money on its due date. */
export const payBasis = (p: PayF): DateBasis => (p === 'got' ? 'paid' : 'due');
/** What callers may pass: a list as one string (older callers and tests), and the retired month / day of
 *  the last contact (read as a contact range). */
export type SalesFilterIn = Omit<SalesFilter, ListKey> & Partial<Record<ListKey, ListF | string>> & { month?: string; day?: string };
/** An empty value of a list field (no ผู้รับผิดชอบ, no SOURCE …), as the filters name it. */
export const NONE = '(ไม่ระบุ)';
const RESULTS: ResultF[] = ['', 'YES', 'NO', 'WAIT', 'EMPTY'];

/** Filters in one shape, whatever came in: a string list value becomes `{v:[x]}` ('' and [] none, no
 *  duplicates); the retired month ('01'–'12', with an optional day) becomes a contact range in the year;
 *  the date is checked (dateRange normDateF). */
export function normSalesFilter(f: SalesFilterIn): SalesFilter {
  const out: SalesFilter = { year: f.year };
  if (f.q) out.q = f.q;
  if (f.quick) out.quick = f.quick;
  if (f.job) out.job = f.job;
  for (const k of LIST_KEYS) {
    const v = f[k];
    const list = typeof v === 'string' ? (v ? [v] : []) : v && Array.isArray(v.v) ? [...new Set(v.v.filter((x) => typeof x === 'string'))] : [];
    if (list.length) out[k] = typeof v === 'object' && v.not ? { v: list, not: true } : { v: list };
  }
  if (f.result && RESULTS.includes(f.result)) out.result = f.result;
  if (f.quote && QUOTES.includes(f.quote)) out.quote = f.quote;
  if (f.money === 'cash') out.money = 'cash';
  if (f.pay && PAYS.includes(f.pay)) out.pay = f.pay;
  let date = normDateF(f.date, f.year);
  if (!f.date && f.month && /^(0[1-9]|1[0-2])$/.test(f.month)) {
    const from = `${ceOf(f.year)}-${f.month}-01`;
    const day = f.day ? `${from.slice(0, 8)}${pad(+f.day)}` : '';
    date = !f.day ? { basis: 'contact', preset: 'custom', from, to: monthEnd(from) } : /^\d{1,2}$/.test(f.day) && isDay(day) ? { basis: 'contact', preset: 'custom', from: day, to: day } : null;
  }
  if (date) out.date = date;
  return out;
}

/** A deal's values of a list field: ผู้รับผิดชอบ / แหล่งที่มา / หมวด one each, SOURCE / บริการ a list;
 *  empty is NONE. หน่วยงาน (`s` needed): the ids of the units its money goes to, NONE for ยังไม่ระบุหน่วยงาน.
 *  บริการ (`s` given): the services the job is sold under (jobServices: a joint quotation's member, its
 *  header's). */
export function listValues(d: Deal, k: ListKey, s?: SalesState): string[] {
  if (k === 'unit') return s ? dealUnits(unitCtx(s), d).map((u) => u || NONE) : [NONE];
  if (k === 'service') {
    const v = s ? jobServices(s, d) : d.service;
    return v.length ? v : [NONE];
  }
  if (k === 'source') return d[k].length ? d[k] : [NONE];
  return [d[k] || NONE];
}
export function listMatch(d: Deal, k: ListKey, f: ListF, s?: SalesState): boolean {
  const vs = listValues(d, k, s), hit = f.v.some((x) => vs.includes(x));
  return f.not ? !hit : hit;
}

/** One date of a deal on a basis: `what` it was ("CONTACT", "PAY1 · 50,000"), the amount, its tone (ok =
 *  won / received, bad = lost / late), and for due dates whether something is still owed on it. */
export interface BasisDate { d: string; what: string; amt?: number; tone?: 'ok' | 'bad' | ''; owed?: boolean }
/**
 * A deal's dates on a basis, newest first:
 * - contact: what the last contact counts (lastContactInfo): the typed contact date, every step's dates (an
 *   older stage read into one too, named by its step: "CONTACT") and every contact record, up to today (a
 *   planned call is not a contact yet; nor a joint quotation's company given the payer's result, stepContactDay);
 * - added: the day it was added to the table (local day);
 * - result: the CLOSED DEAL date once the result is YES or NO;
 * - paid: when each installment came in (with a plan); without a plan, each paid PAY step dated up to today;
 * - due: each installment's due date (not those of a lost deal);
 * - closed: the day it was closed (ปิดงาน).
 */
export function basisDates(s: SalesState, d: Deal, basis: DateBasis, today: string): BasisDate[] {
  // a joint quotation's member is paid through it: its money's dates are its header's
  if (basis === 'paid' || basis === 'due') {
    const h = payerDeal(s, d);
    if (h !== d) return basisDates(s, h, basis, today);
  }
  const out: BasisDate[] = [];
  if (basis === 'contact') {
    if (d.contactDate && d.contactDate <= today) out.push({ d: d.contactDate, what: 'วันที่ติดต่อ' });
    const code = (p: string) => stepLabel(s, d, p, today).code;
    for (const p of stepKeys(s, d)) {
      const x = stepContactDay(s, d.id, p);
      if (x && x <= today) out.push({ d: x, what: code(p) });
    }
    for (const a of actsOf(s, d.id)) if (a.d && a.d <= today) out.push({ d: a.d, what: ACT_TH[a.type] + (a.stage ? ' · ' + code(a.stage) : '') });
  } else if (basis === 'added') {
    if (d.at) out.push({ d: localDay(d.at), what: 'เพิ่มเข้าตาราง' });
  } else if (basis === 'result') {
    const r = dealResult(s, d), x = stepOf(s, d.id, DEAL_STAGE).d;
    if (x && (r === 'YES' || r === 'NO')) out.push({ d: x, what: r === 'YES' ? 'ได้งาน' : 'ไม่ได้งาน', tone: r === 'YES' ? 'ok' : 'bad' });
  } else if (basis === 'paid') {
    const plan = planOf(s, d, today);
    if (plan) plan.lines.forEach((l) => l.got > 0 && l.rcvDate && out.push({ d: l.rcvDate, what: `${l.code} · ${fmtMoney(l.got)}`, amt: l.got, tone: 'ok' }));
    else {
      const acs = docsOf(s, d.id).filter(countsActual);
      payState(s, d, today).paid.forEach((p) => {
        const x = stepOf(s, d.id, p).d;
        if (!x || x > today) return;
        const at = acs.filter((z) => z.stage === p);
        const amt = at.length ? at.reduce((a, z) => a + (z.amount || 0), 0) : undefined, c = stepLabel(s, d, p, today).code;
        out.push({ d: x, what: amt != null ? `${c} · ${fmtMoney(amt)}` : c, amt, tone: 'ok' });
      });
    }
  } else if (basis === 'due') {
    planOf(s, d, today)?.lines.forEach((l) => {
      if (!l.due || l.status === 'off') return;
      out.push({ d: l.due, what: `${l.code} · ${fmtMoney(l.amt)}`, amt: l.left || l.amt, owed: l.left > 0, tone: l.lateDays ? 'bad' : l.status === 'paid' ? 'ok' : '' });
    });
  } else if (basis === 'closed') {
    if (d.closedDate) out.push({ d: d.closedDate, what: 'ปิดงาน' });
  }
  return out.sort((a, b) => b.d.localeCompare(a.d));
}

/** The date a row shows for a range (null = the deal is not in it): the latest one inside it; for due
 *  dates the earliest one still owed, else the latest. */
export function dateMatch(s: SalesState, d: Deal, r: Range, basis: DateBasis, today: string): BasisDate | null {
  const xs = basisDates(s, d, basis, today).filter((x) => inRange(x.d, r));
  if (!xs.length) return null;
  if (basis === 'due') return [...xs].reverse().find((x) => x.owed) || xs[0];
  return xs[0];
}

/** Deals of a year that pass the filters, in section order then row order. `today` is a parameter for
 *  tests (the quick views and the date filter depend on it). `hay`: more words the search reads for a deal
 *  (its contacts, people linked to it: the engine's contactHay). */
export function filterDeals(s: SalesState, fIn: SalesFilterIn, today = todayISO(), hay?: (d: Deal) => string): Deal[] {
  return withActIndex(s, () => filterPass(s, fIn, today, hay));
}
function filterPass(s: SalesState, fIn: SalesFilterIn, today: string, more?: (d: Deal) => string): Deal[] {
  const f = normSalesFilter(fIn);
  const q = (f.q || '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const secIx = new Map(s.cfg.sections.map((x, i) => [x, i]));
  const lists = LIST_KEYS.filter((k) => f[k]);
  // การรับเงิน reads the range on the money's own dates: received ones on paid, owed ones on due
  const range = f.date ? resolveDate(f.pay ? { ...f.date, basis: payBasis(f.pay) } : f.date, f.year, today) : null;
  // the money lens: a deal of another year with an installment in this one; its lines once per pass
  const cash = f.money === 'cash' || !!f.pay, ce = ceOf(f.year) + '-';
  const lines = new Map<string, CashLine[]>();
  // a joint quotation's member is paid through it: its money (the lens, การรับเงิน) is its header's
  const payer = (d: Deal) => payerDeal(s, d);
  const linesOf = (d0: Deal) => {
    const d = payer(d0);
    return lines.get(d.id) || lines.set(d.id, cashLines(s, [d], today)).get(d.id)!;
  };
  const payR = f.pay ? range || { from: ce + '01-01', to: ce + '12-31' } : null;
  // the search reads the documents' numbers ("QT-2569-052") and a joint quotation's name: indexed once per pass
  const nos = terms.length ? docNosByDeal(s) : null;
  return Object.values(s.deals)
    .filter((d) => {
      if (d.year !== f.year && !(cash && linesOf(d).some((l) => l.date.startsWith(ce)))) return false;
      if (f.pay && !linesOf(d).some((l) => payMatch(l, f.pay!) && inRange(l.date, payR!))) return false;
      if (f.job && d.jobStatus !== f.job) return false;
      // (a member is drawn under its joint quotation's band, in the header's หมวด: it is filtered there too;
      // under หน่วยงาน it is its own part of the header's money, by its own split)
      if (!lists.every((k) => listMatch(k === 'section' ? payer(d) : d, k, f[k]!, s))) return false;
      if (f.result) {
        const r = dealResult(s, d);
        if (f.result === 'EMPTY' ? r !== '' : r !== f.result) return false;
      }
      if (f.quote && quoteSent(s, d, today) !== (f.quote === 'sent')) return false;
      if (f.quick && !quickMatch(s, d, f.quick, today)) return false;
      if (range && !f.pay && !dateMatch(s, d, range, f.date!.basis, today)) return false;
      if (terms.length) {
        const plan = (planLines(s, d) || []).map((x) => `${x.line.note} ${x.line.howT}`);
        const notes = [...stepKeys(s, d).map((p) => stepOf(s, d.id, p).n), ...plan, ...actsOf(s, d.id).map((a) => a.note)].join(' ');
        const hay = [d.client, d.contactName, d.phone, d.email, d.resp, d.referral, d.section, notes, jointHay(s, d, nos!), more ? more(d) : ''].join(' ').toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    })
    .sort((a, b) => (secIx.get(a.section) ?? 1e9) - (secIx.get(b.section) ?? 1e9) || a.section.localeCompare(b.section) || a.order - b.order || a.at.localeCompare(b.at));
}

/**
 * The money a deal received and the day each amount came in ('' when nothing dates it), the one rule
 * receivedIn and cashLines share: with a plan, what each installment got, on its received date; without
 * one, the Actual documents (on their step's date, else the document date, else the day attached); a
 * deal with neither but a typed Actual counts it once, on its latest paid PAY step's date.
 */
export interface Received { amt: number; date: string; stage: string; src: 'plan' | 'doc' | 'typed'; doc: DealDoc | null; line: LineView | null }
export function receivedOf(s: SalesState, d: Deal, today: string, plan = planOf(s, d, today)): Received[] {
  if (plan) return plan.lines.filter((l) => l.got > 0).map((l) => ({ amt: l.got, date: l.rcvDate, stage: l.stage, src: 'plan', doc: l.doc, line: l }));
  const acs = docsOf(s, d.id).filter(countsActual);
  if (acs.length)
    return acs.map((x) => {
      const st = x.stage ? stepOf(s, d.id, x.stage).d : '';
      return { amt: x.amount || 0, date: st && st <= today ? st : x.docDate || localDay(x.at), stage: x.stage, src: 'doc', doc: x, line: null };
    });
  const typed = dealMoney(s, d).actual;
  if (!typed || typed <= 0) return [];
  const paid = payState(s, d, today).paid.filter((p) => stepOf(s, d.id, p).d && stepOf(s, d.id, p).d <= today);
  const last = paid.sort((a, b) => stepOf(s, d.id, a).d.localeCompare(stepOf(s, d.id, b).d)).pop() || '';
  return [{ amt: typed, date: last ? stepOf(s, d.id, last).d : '', stage: last, src: 'typed', doc: null, line: null }];
}
/** Money received inside a range (the KPI footer "รับในช่วงนี้"), by receivedOf; a joint quotation's
 *  member has none of its own (its header's counts once). */
export function receivedIn(s: SalesState, deals: Deal[], r: Range, today: string, attr = false): number {
  let sum = 0;
  for (const h of moneyHolds(s, deals, attr)) for (const x of receivedOf(s, h.d, today)) if (inRange(x.date, r)) sum += holdPart(s, h, x.amt);
  return sum;
}
/** Still owed on installments due inside a range (open, won deals): the KPI footer "ค้างในช่วงนี้". */
export function owedIn(s: SalesState, deals: Deal[], r: Range, today: string, attr = false): number {
  let sum = 0;
  for (const h of moneyHolds(s, deals, attr)) {
    const d = h.d;
    if (d.jobStatus !== 'open' || dealResult(s, d) !== 'YES') continue;
    planOf(s, d, today)?.lines.forEach((l) => l.left > 0 && inRange(l.due, r) && (sum += holdPart(s, h, l.left)));
  }
  return sum;
}

// ------------------------------------------------------------------ cashflow by year (derived, never stored)

// ------------------------------------------------------------------ joint quotations (package quotes, item 7)

/**
 * A joint quotation (ใบเสนอราคาร่วม): one quotation for several companies, paid by one payer. Its header
 * is an ordinary deal, the payer's row (its documents and payment plan are the quotation's money, through
 * the usual pipeline), marked by `jqt/<hid>`; each company keeps its own row for follow-up and is a member
 * by `jqm/<hid>/<dealId>`. Money counts once, on the header; customers count per member (the header is
 * not one). No new fields on existing records.
 */
export interface JointQt { title: string; at: string; by: string }
/** A member's part of the quotation: in baht (`share`) or a % of it (`pct`); neither = an equal split of
 *  what the others leave. It only apportions the header's money to people and units; it is never summed. */
export interface JointMember { share: number | null; pct: number | null; at: string; by: string }
/** A deal's part in a joint quotation. Money loops skip 'member' so a joint quotation counts once, on its
 *  header; customer counts skip 'header'. */
export type JointRole = 'plain' | 'header' | 'member';

/** The joint quotation a deal is a member of: its header deal's id, or ''. A membership whose header deal
 *  is gone does not count; a deal listed in two (made on two devices at once) belongs to the newest. */
export function jointHeadOf(s: SalesState, id: string): string {
  let best = '', at = '';
  for (const [k, m] of Object.entries(s.jqm || {})) {
    const i = k.indexOf('/');
    if (k.slice(i + 1) !== id) continue;
    const h = k.slice(0, i);
    if (!s.deals[h] || h === id || (best && (m.at || '') <= at)) continue;
    best = h;
    at = m.at || '';
  }
  return best;
}
/** header with `jqt/<id>`; member with a membership whose header deal exists (as the team script's
 *  jointRole_ reads it); else plain. */
export function jointRole(s: SalesState, d: Pick<Deal, 'id'>): JointRole {
  if (s.jqt?.[d.id]) return 'header';
  return jointHeadOf(s, d.id) ? 'member' : 'plain';
}
/** A joint quotation: the header deal, its mark, and its members (those whose deal exists and whose newest
 *  membership is this one), in the order they joined. */
export interface JointGroup { head: Deal; qt: JointQt; members: { deal: Deal; m: JointMember }[] }
/** The joint quotation of a deal (its header, or a member), or null. */
export function jointOf(s: SalesState, d: Pick<Deal, 'id'>): JointGroup | null {
  const hid = s.jqt?.[d.id] ? d.id : jointHeadOf(s, d.id);
  const head = hid ? s.deals[hid] : undefined;
  if (!head) return null;
  const qt = s.jqt?.[hid] || { title: '', at: '', by: '' };
  const pre = hid + '/';
  const members = Object.entries(s.jqm || {})
    .filter(([k]) => k.startsWith(pre))
    .map(([k, m]) => ({ deal: s.deals[k.slice(pre.length)], m }))
    .filter((x) => !!x.deal && !s.jqt?.[x.deal.id] && jointHeadOf(s, x.deal.id) === hid)
    .sort((a, b) => (a.m.at || '').localeCompare(b.m.at || '') || a.deal.client.localeCompare(b.deal.client, 'th'));
  return { head, qt, members };
}
/**
 * How the quotation's money is apportioned among members (weights, in their order): a share in baht as
 * it is, a % of the quotation total `base`; members with neither split what the others leave equally. With
 * no total (no quotation yet) a % reads as a weight against 100 and an empty part as the others' mean.
 * All empty, or all zero: an equal split.
 */
export function jointWeights(ms: Pick<JointMember, 'share' | 'pct'>[], base: number | null): number[] {
  const b = base != null && base > 0 ? base : 0;
  const fixed = ms.map((m) => (m.share != null ? m.share : m.pct != null ? (b ? (b * m.pct) / 100 : m.pct) : null));
  const set = fixed.filter((x): x is number => x != null), empty = fixed.length - set.length;
  const sum = set.reduce((a, x) => a + x, 0);
  const each = !empty ? 0 : b ? Math.max(0, b - sum) / empty : set.length ? sum / set.length : 1;
  const w = fixed.map((x) => x ?? each);
  return w.some((x) => x > 0) ? w : ms.map(() => 1);
}
/** The quotation total a joint quotation's parts are of: the header's Forecast. */
export const jointBase = (s: SalesState, g: JointGroup) => dealMoney(s, g.head).forecast;
/** The members' weights (jointWeights), in member order: none for a member that withdrew (its result is
 *  NO) while another has not; the money changes only through a revised quotation (question 9 ก). */
export function jointParts(s: SalesState, g: JointGroup): number[] {
  const no = g.members.map((x) => dealResult(s, x.deal) === 'NO');
  const out = no.every(Boolean) ? no.map(() => false) : no;
  const w = jointWeights(g.members.filter((_, i) => !out[i]).map((x) => x.m), jointBase(s, g));
  let j = 0;
  return g.members.map((_, i) => (out[i] ? 0 : w[j++]));
}
/** `total` in these weights, whole baht, adding up exactly (the rounding goes to the last with a weight);
 *  all zero: an equal split. */
export function apportion(total: number, w: number[]): number[] {
  const sum = w.reduce((a, x) => a + (x > 0 ? x : 0), 0);
  if (!w.length || !(sum > 0)) return splitAmounts(total, w.map(() => 1));
  const out = w.map((x) => (x > 0 ? Math.floor((total * x) / sum) : 0));
  out[w.map((x) => x > 0).lastIndexOf(true)] += Math.round((total - out.reduce((a, b) => a + b, 0)) * 100) / 100;
  return out;
}
/** Each member's part of `amount`, in member order. */
export function jointSplit(s: SalesState, g: JointGroup, amount: number): number[] {
  return g.members.length ? apportion(amount, jointParts(s, g)) : [];
}
/**
 * Whose an amount of deal `d` is in per-person and per-unit summaries (ผู้รับผิดชอบ, หน่วยงาน): a plain deal's
 * own; a joint quotation's header's apportioned to its members by their parts (to the header itself while
 * it has none); a member's nothing (its money is the header's, counted once there).
 */
export function moneyOwners(s: SalesState, d: Deal, amount: number): { deal: Deal; amt: number }[] {
  const r = jointRole(s, d);
  if (r === 'member') return [];
  const g = r === 'header' ? jointOf(s, d) : null;
  if (!g || !g.members.length) return [{ deal: d, amt: amount }];
  const parts = jointSplit(s, g, amount);
  return g.members.map((x, i) => ({ deal: x.deal, amt: parts[i] }));
}
/**
 * How a joint quotation's header gives its money to units (lib/contrib's parts hook, package dash): to its
 * member companies by their parts (jointParts: a share in baht, else a %, else equal; none for one that
 * withdrew), each then split by its own สัดส่วนรายได้, so the money counts once and every unit's part of a
 * line adds up to it. null for any other deal (its own split), and for a header without members.
 */
export function jointPartsOf(s: SalesState, d: Pick<Deal, 'id'>): Part[] | null {
  if (!s.jqt?.[d.id]) return null;
  const g = jointOf(s, d);
  if (!g || !g.members.length) return null;
  const w = jointParts(s, g);
  return g.members.map((x, i) => ({ deal: x.deal, w: w[i] }));
}
setPartsHook(jointPartsOf);
/** The deal whose money and หมวด a row follows: a joint quotation's member is paid through its header and
 *  drawn under its band (in the header's หมวด); any other deal is its own. */
export const payerDeal = (s: SalesState, d: Deal): Deal => (jointRole(s, d) === 'member' && s.deals[jointHeadOf(s, d.id)]) || d;
/** The Services a job is sold under: a joint quotation's member through its header's quotation, so the
 *  header's (its own while the header lists none); any other job its own. The filter "บริการ", the plan's
 *  service types (lib/svcType.ts) and the rule for two jobs of one company (lib/jobs.ts) all read it. */
export function jobServices(s: SalesState, d: Deal): string[] {
  const h = payerDeal(s, d);
  return h !== d && h.service.length ? h.service : d.service;
}
/** The deals that count as customers (a joint quotation's header is not one: its members are). */
export const customersOf = (s: SalesState, deals: Deal[]) => deals.filter((d) => jointRole(s, d) !== 'header');

/**
 * The work a list holds (the owner's "how many companies we worked for"): the one count behind the ปิดงาน
 * line and its tab, the closing dialog, the Dashboard's ทำงานให้ card, the CSV's two columns and the
 * พร้อมปิดงาน view, so every screen says the same.
 * - `jobs` (งาน): a plain row is one job; a joint quotation is one job however many companies it has, with its
 *   payer's row or any company of it in the list. Under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter (`attr`,
 *   jointAttr) it is a job of the list only with a company of it there (as its money, moneyHolds), so it is
 *   one job for each person with a company in it. `joint`: how many of the jobs are joint quotations.
 * - `worked` (บริษัทที่ทำงานให้): the companies with a row in the list whose result is YES and whose job is
 *   closed (`closedOnly` false: any job), each once (`key`: the registry company, else the name; a row without
 *   a link merges with a linked row of the same name, `alias` giving a linked row's other names). A joint
 *   quotation's companies count each; its payer never (it pays, the work is for its companies).
 * - `lost`: companies closed with NO (and not worked); `noResult`: companies whose closed rows have no YES or NO
 *   (and are neither worked nor lost: a company with a CFO job lost and a CFP job without a result is lost).
 * - `jobRow` / `workRow`: the rows that carry each count, for the CSV's "นับเป็นงาน" and "นับเป็นบริษัทที่ทำงาน
 *   ให้" (1 on these rows, so a SUM equals the screen): a joint quotation's job on its payer's row (which the
 *   export lists with it, also when filtered out), a company on its first counted row in list order.
 * Money is not here: moneySum (a joint quotation once, or its kept parts).
 */
export interface WorkTally { jobs: number; joint: number; worked: number; lost: number; noResult: number; jobRow: Set<string>; workRow: Set<string> }
export interface WorkOpts { key?: (d: Deal) => string; alias?: (d: Deal) => string[]; closedOnly?: boolean; attr?: boolean }
/** Names a row gets before anyone types one (เพิ่มในหมวดนี้, an import without a name; or none): never one company,
 *  so two such rows are two companies (workTally, lib/jobs.ts). */
const PLACEHOLDER = new Set(['ลูกค้าใหม่', 'ลูกค้า', '(ไม่มีชื่อ)'].map(norm));
export const placeholderName = (client: string) => {
  const k = norm(client);
  return !k || PLACEHOLDER.has(k);
};
/** A company's key for workTally without the registry at hand: its link, else its name. */
export const workKey = (d: Pick<Deal, 'gid' | 'client'>) => (d.gid != null ? 'g' + d.gid : 'n' + norm(d.client));
export function workTally(s: SalesState, deals: Deal[], o: WorkOpts = {}): WorkTally {
  const key = o.key || workKey, closedOnly = o.closedOnly !== false;
  const ids = new Set(deals.map((d) => d.id));
  const role = new Map(deals.map((d) => [d.id, jointRole(s, d)]));
  // a company without a registry link and a linked row of the same name are one company
  const alias = new Map<string, string>();
  for (const d of deals) {
    if (role.get(d.id) === 'header' || d.gid == null) continue;
    const k = key(d);
    ['n' + norm(d.client), ...(o.alias ? o.alias(d) : [])].forEach((a) => a.length > 1 && !alias.has(a) && alias.set(a, k));
  }
  const kOf = (d: Deal) => {
    // (a row without a link and without a name of its own is a company of its own)
    if (d.gid == null && placeholderName(d.client)) return 'd' + d.id;
    const k = key(d);
    return alias.get(k) || k;
  };
  const jobRow = new Set<string>(), workRow = new Set<string>(), seen = new Set<string>(), worked = new Set<string>(), lost = new Set<string>(), noRes = new Set<string>();
  let joint = 0;
  for (const d of deals) {
    const r = role.get(d.id)!;
    if (r === 'plain') jobRow.add(d.id);
    else {
      const hid = r === 'header' ? d.id : jointHeadOf(s, d.id);
      if (!seen.has(hid)) {
        seen.add(hid);
        const g = jointOf(s, { id: hid });
        // (under a filter that apportions its money, only with a company of it in the list, as moneyHolds)
        const counts = !g ? r === 'header' : !o.attr || !g.members.length ? true : g.members.some((x) => ids.has(x.deal.id));
        if (counts) {
          jobRow.add(hid);
          joint++;
        }
      }
      if (r === 'header') continue;
    }
    if (closedOnly && d.jobStatus !== 'closed') continue;
    const res = dealResult(s, d);
    if (res === 'YES') {
      const k = kOf(d);
      if (!worked.has(k)) {
        worked.add(k);
        workRow.add(d.id);
      }
    } else if (res === 'NO') lost.add(kOf(d));
    else noRes.add(kOf(d));
  }
  return {
    jobs: jobRow.size, joint, worked: worked.size, lost: [...lost].filter((k) => !worked.has(k)).length,
    noResult: [...noRes].filter((k) => !worked.has(k) && !lost.has(k)).length, jobRow, workRow,
  };
}

/**
 * The filters a joint quotation's money is apportioned under: ผู้รับผิดชอบ, SOURCE and REFERRAL, the
 * breakdowns its members' parts feed (byResp, bySource, byReferral). With one of them set, a list holds a
 * joint quotation's money as the parts of its members in the list (each with its member, also when the
 * header is filtered out), so a person's filtered figures equal that person's row of the unfiltered
 * summary. Any other filter (year, status, result, dates, money, search, หมวด, services) reads the joint
 * quotation as one job, as its band shows it: its whole money when its header is in the list, else none.
 */
export const JOINT_ATTR_KEYS: ListKey[] = ['resp', 'source', 'referral'];
export const jointAttr = (f: Partial<Record<ListKey, unknown>> | null | undefined) => !!f && JOINT_ATTR_KEYS.some((k) => !!f[k]);
/** A deal whose money a list holds: a plain deal (whole), or a joint quotation's header with the members
 *  whose parts count (`keep`: their indexes in `g.members`; null = the whole). */
export interface MoneyHold { d: Deal; g: JointGroup | null; keep: number[] | null }
/** The money a list of deals holds (lib comment above `jointAttr`), each deal or joint quotation once, in
 *  list order; members never on their own. */
export function moneyHolds(s: SalesState, deals: Deal[], attr = false): MoneyHold[] {
  const ids = new Set(deals.map((d) => d.id)), seen = new Set<string>(), out: MoneyHold[] = [];
  for (const d of deals) {
    const r = jointRole(s, d);
    if (r === 'plain') {
      out.push({ d, g: null, keep: null });
      continue;
    }
    const hid = r === 'header' ? d.id : jointHeadOf(s, d.id);
    if (seen.has(hid)) continue;
    seen.add(hid);
    const g = jointOf(s, { id: hid });
    if (!g) continue;
    if (!attr || !g.members.length) {
      if (ids.has(hid)) out.push({ d: g.head, g, keep: null });
      continue;
    }
    const keep = g.members.map((x, i) => (ids.has(x.deal.id) ? i : -1)).filter((i) => i >= 0);
    if (keep.length) out.push({ d: g.head, g, keep: keep.length === g.members.length ? null : keep });
  }
  return out;
}
/** The part of an amount of `h.d` a hold counts (the whole, or the sum of its kept members' parts). */
export function holdPart(s: SalesState, h: MoneyHold, amount: number): number {
  if (!h.keep || !h.g || !amount) return amount;
  const parts = jointSplit(s, h.g, amount);
  return h.keep.reduce((a, i) => a + parts[i], 0);
}
/** moneyOwners of a hold: only the kept members. */
export function holdOwners(s: SalesState, h: MoneyHold, amount: number): { deal: Deal; amt: number }[] {
  const o = moneyOwners(s, h.d, amount);
  return h.keep ? h.keep.map((i) => o[i]).filter(Boolean) : o;
}
/** The Forecast and Actual a list holds (a section's sums, the KPI footer's open / closed split, the
 *  closed tab), a joint quotation once (or its kept parts). */
export function moneySum(s: SalesState, deals: Deal[], attr = false) {
  const r = { fc: 0, ac: 0, fcOpen: 0, fcClosed: 0 };
  for (const h of moneyHolds(s, deals, attr)) {
    const m = dealMoney(s, h.d), fc = holdPart(s, h, m.forecast || 0);
    r.fc += fc;
    r.ac += holdPart(s, h, m.actual || 0);
    if (h.d.jobStatus === 'closed') r.fcClosed += fc;
    else r.fcOpen += fc;
  }
  return r;
}
/** cashLines over what a list holds: with `attr` a joint quotation's lines carry only its kept members'
 *  parts (lines of no part are left out); without, cashLines as it is. */
export function jointCashLines(s: SalesState, deals: Deal[], today: string, attr = false): CashLine[] {
  if (!attr) return cashLines(s, deals, today);
  const out: CashLine[] = [];
  for (const h of moneyHolds(s, deals, true)) {
    // (a part says of how many of its companies, so a list of lines does not read it as the whole payment)
    // and which (`keep`: the units' split of the line then goes to those companies alone, lib/contrib lineParts)
    const w = h.keep && h.g ? jointParts(s, h.g) : [], kept = h.keep && h.g ? h.keep.filter((i) => w[i] > 0) : [];
    const keep = kept.map((i) => h.g!.members[i].deal.id);
    for (const l of cashLines(s, [h.d], today)) {
      const amt = holdPart(s, h, l.amt);
      if (amt) out.push(h.keep ? { ...l, amt, ...(l.joint ? { joint: { ...l.joint, part: kept.length, keep } } : {}) } : l);
    }
  }
  return out;
}

/** Every deal's document numbers, joined (the search reads them). */
function docNosByDeal(s: SalesState): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of Object.values(s.docs)) if (x.docNo) m.set(x.deal, (m.get(x.deal) || '') + ' ' + x.docNo);
  return m;
}
/** What the search finds a deal by besides its own fields: its documents' numbers, and in a joint quotation
 *  its name and the header's quotation numbers, and the header's QUOTATION note (the number typed when it was
 *  made without its file): a member is found by the joint QT's number. */
function jointHay(s: SalesState, d: Deal, nos: Map<string, string>) {
  const own = nos.get(d.id) || '';
  const hid = s.jqt?.[d.id] ? d.id : jointHeadOf(s, d.id);
  return hid ? `${own} ${s.jqt?.[hid]?.title || ''} ${hid !== d.id ? (nos.get(hid) || '') + ' ' + stepOf(s, hid, QUOTE_STAGE).n : ''}` : own;
}

/**
 * One amount of money in Cashflow: received (`got`, on the day it came in) or still owed (`owed`, on its
 * due date); `date` '' = it has no date yet ("ยังไม่กำหนดวันรับ": never in a month or a year total).
 * `n`/`of`: "งวด n/of" of the plan (0 without a plan). `src`: an installment of the plan; without a plan an
 * Actual document, the typed Actual, or what is left of the Forecast (`rest`). Amounts as on the documents.
 */
export interface CashLine {
  /** unique among the lines (React keys, tests) */
  id: string;
  deal: Deal;
  /** a joint quotation's header: how many member companies, and its title (package quotes) */
  joint?: {
    members: number; title: string;
    /** under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter: the amount is the part of this many of its companies
     *  (jointCashLines), `keep` their deal ids */
    part?: number; keep?: string[];
  };
  stage: string; n: number; of: number;
  /** the installment as the deal's steps name it: PAY (a single one), PAY1 … PAYn, the rest of a payment without a
   *  plan "PAY ส่วนที่เหลือ"; '' for no stage */
  code: string;
  amt: number;
  kind: 'got' | 'owed';
  date: string;
  /** the due date ('' none) and the day it came in (got lines) */
  due: string; rcv: string;
  /** paid · late (past its due date) · due (within DUE_SOON days) · wait */
  status: 'paid' | 'late' | 'due' | 'wait';
  lateDays: number;
  /** the deal's own Buddhist-era year */
  dealYear: string;
  src: 'plan' | 'doc' | 'typed' | 'rest';
  doc: DealDoc | null;
}

/**
 * Every amount of money of won (YES) deals, open and closed, of any year: the plan's installments (a part
 * paid one gives a received line and an owed one for what is left); without a plan what was received
 * (receivedOf) and Forecast − Actual while a PAY stage is left, undated (as the KPI ค้างรับ counts it).
 * Not counted: deals not won, cancelled installments, a joint quotation's members. Soonest first, undated last.
 */
export function cashLines(s: SalesState, deals: Iterable<Deal>, today: string): CashLine[] {
  return withActIndex(s, () => cashPass(s, deals, today));
}
function cashPass(s: SalesState, deals: Iterable<Deal>, today: string): CashLine[] {
  const out: CashLine[] = [];
  for (const d of deals) {
    const jr = jointRole(s, d);
    if (dealResult(s, d) !== 'YES' || jr === 'member') continue;
    const plan = planOf(s, d, today);
    // a joint quotation's header: one payer line per installment, saying how many companies it pays for
    const g = jr === 'header' ? jointOf(s, d) : null;
    const base = { deal: d, dealYear: d.year, of: plan?.n ?? 0, lateDays: 0, ...(g ? { joint: { members: g.members.length, title: g.qt.title } } : {}) };
    if (plan) {
      for (const l of plan.lines) {
        if (l.status === 'off') continue;
        const at = { ...base, stage: l.stage, code: l.code, n: l.n, due: l.due };
        if (l.got > 0) out.push({ ...at, id: `${d.id}/${l.stage}/got`, amt: l.got, kind: 'got', date: l.rcvDate, rcv: l.rcvDate, status: 'paid', src: 'plan', doc: l.doc });
        if (l.left > 0) out.push({ ...at, id: `${d.id}/${l.stage}/owed`, amt: l.left, kind: 'owed', date: l.due, rcv: '', status: owedStatus(l.due, l.lateDays, today), lateDays: l.lateDays, src: 'plan', doc: null });
      }
      continue;
    }
    // (no plan: "PAY", and "PAY ส่วนที่เหลือ" for the rest of it, so "รับที่ …" says which)
    const code = (p: string) => (p ? stepCode(s, d, p, today) : '');
    receivedOf(s, d, today, null).forEach((x, i) =>
      out.push({ ...base, id: `${d.id}/${x.doc?.id || x.src}/${i}`, stage: x.stage, code: code(x.stage), n: 0, amt: x.amt, kind: 'got', date: x.date, due: '', rcv: x.date, status: 'paid', src: x.src as 'doc' | 'typed', doc: x.doc }),
    );
    const o = owedNoPlan(s, d, today), left = payState(s, d, today).left;
    if (o && o.owed > 0)
      out.push({ ...base, id: `${d.id}/rest`, stage: left[0], code: code(left[0]), n: 0, amt: o.owed, kind: 'owed', date: '', due: '', rcv: '', status: 'wait', src: 'rest', doc: null });
  }
  return out.sort((a, b) => (!a.date ? 1 : 0) - (!b.date ? 1 : 0) || a.date.localeCompare(b.date) || a.deal.client.localeCompare(b.deal.client, 'th') || a.n - b.n);
}
/** An owed amount's status by its due date: late once past it, due within DUE_SOON days, else wait. */
const owedStatus = (due: string, lateDays: number, today: string): CashLine['status'] =>
  lateDays > 0 ? 'late' : due && due >= today && daysBetween(today, due) <= DUE_SOON ? 'due' : 'wait';

/** Money of one month, quarter or year: received, late, still to come (รอรับ: owed, not late) and how
 *  many amounts. ค้างรับ = late + wait. */
export interface CashSum { got: number; late: number; wait: number; n: number }
const sum0 = (): CashSum => ({ got: 0, late: 0, wait: 0, n: 0 });
export const cashTotal = (c: CashSum) => c.got + c.late + c.wait;
const addLine = (c: CashSum, l: CashLine) => {
  if (l.kind === 'got') c.got += l.amt;
  else if (l.status === 'late') c.late += l.amt;
  else c.wait += l.amt;
  c.n++;
};
/** The Buddhist-era year a date falls in ('' for no date). */
export const beOf = (iso: string) => (iso ? String(+iso.slice(0, 4) + 543) : '');
/** The calendar quarter (0–3) of a date. */
export const quarterOf = (iso: string) => Math.floor((+iso.slice(5, 7) - 1) / 3);

/**
 * One Buddhist-era year of Cashflow (a calendar year, calendar quarters): its dated lines (soonest first),
 * by month and by quarter, its totals, and the undated money of the deals of that year ("ยังไม่กำหนดวันรับ",
 * never in a month or the totals).
 */
export function cashYear(lines: CashLine[], be: string) {
  const months = Array.from({ length: 12 }, sum0), totals = sum0();
  const dated = lines.filter((l) => l.date && beOf(l.date) === be);
  dated.forEach((l) => {
    addLine(months[+l.date.slice(5, 7) - 1], l);
    addLine(totals, l);
  });
  const quarters = [0, 1, 2, 3].map((q) => months.slice(q * 3, q * 3 + 3).reduce((a, m) => ({ got: a.got + m.got, late: a.late + m.late, wait: a.wait + m.wait, n: a.n + m.n }), sum0()));
  return { months, quarters, totals, lines: dated, undated: lines.filter((l) => !l.date && l.dealYear === be) };
}
export type CashYear = ReturnType<typeof cashYear>;

/** The Cashflow cards of a year: the year's total, received (how many, the latest day), owed in the year
 *  (late, and due from today to the end of this month while today is in it), the undated money of the
 *  year's deals; `from` = the other deal years its money comes from (year → deals). */
export interface CashKpis {
  total: number; n: number;
  got: number; gotN: number; lastGot: string;
  owed: number; owedN: number; late: number; lateN: number; dueMonth: number; dueMonthN: number; firstDue: string;
  undated: number; undatedDeals: number;
  from: Record<string, number>; ownN: number;
}
export function cashKpis(Y: CashYear, be: string, today: string): CashKpis {
  const monthEnd = today.slice(0, 8) + '31', thisYear = beOf(today) === be;
  const k: CashKpis = { total: cashTotal(Y.totals), n: Y.totals.n, got: Y.totals.got, gotN: 0, lastGot: '', owed: Y.totals.late + Y.totals.wait, owedN: 0, late: Y.totals.late, lateN: 0, dueMonth: 0, dueMonthN: 0, firstDue: '', undated: 0, undatedDeals: 0, from: {}, ownN: 0 };
  const from: Record<string, Set<string>> = {};
  Y.lines.forEach((l) => {
    if (l.kind === 'got') {
      k.gotN++;
      if (l.date > k.lastGot) k.lastGot = l.date;
    } else {
      k.owedN++;
      if (!k.firstDue || l.date < k.firstDue) k.firstDue = l.date;
      if (l.status === 'late') k.lateN++;
      else if (thisYear && l.date >= today && l.date <= monthEnd) {
        k.dueMonth += l.amt;
        k.dueMonthN++;
      }
    }
    if (l.dealYear === be) k.ownN++;
    else (from[l.dealYear] || (from[l.dealYear] = new Set())).add(l.deal.id);
  });
  k.from = Object.fromEntries(Object.entries(from).map(([y, s]) => [y, s.size]));
  k.undated = Y.undated.reduce((a, l) => a + l.amt, 0);
  k.undatedDeals = new Set(Y.undated.map((l) => l.deal.id)).size;
  return k;
}

/**
 * The line under the Cashflow cards that ties them to today's KPI ค้างรับ: the money still owed on the
 * open jobs of deal year `be` (= receivables of those jobs) split by where it falls: in this year, in
 * other years (by year), and undated. The card ค้างรับในปีนี้ also holds what closed jobs still owe in the
 * year and the open jobs of other deal years owe in it (`closedIn`, `otherIn`, shown only when not 0), so
 * the line adds up to both figures: open = inYear + Σ byYear + undated, and the card = inYear + closedIn + otherIn.
 */
export interface CashRecon { open: number; inYear: number; byYear: { year: string; amt: number }[]; undated: number; closedIn: number; otherIn: number }
export function cashRecon(lines: CashLine[], be: string): CashRecon {
  const r: CashRecon = { open: 0, inYear: 0, byYear: [], undated: 0, closedIn: 0, otherIn: 0 };
  const by: Record<string, number> = {};
  for (const l of lines) {
    if (l.kind !== 'owed') continue;
    const y = beOf(l.date), open = l.deal.jobStatus === 'open';
    if (y === be && !open) r.closedIn += l.amt;
    else if (y === be && l.dealYear !== be) r.otherIn += l.amt;
    if (!open || l.dealYear !== be) continue;
    r.open += l.amt;
    if (!y) r.undated += l.amt;
    else if (y === be) r.inYear += l.amt;
    else by[y] = (by[y] || 0) + l.amt;
  }
  r.byYear = Object.keys(by).sort().map((year) => ({ year, amt: by[year] }));
  return r;
}

/** Whether an amount is the kind การรับเงิน asks for: received, owed (late included), or late. */
export const payMatch = (l: CashLine, p: PayF) => (p === 'got' ? l.kind === 'got' : p === 'owed' ? l.kind === 'owed' : p === 'late' ? l.kind === 'owed' && l.status === 'late' : true);
/** Every Buddhist-era year a line of money is dated in (the year picker on the money views). */
export const cashYears = (lines: CashLine[]) => [...new Set(lines.filter((l) => l.date).map((l) => beOf(l.date)))].sort();

/** Sections to show for a year: configured order first, then any extra ones used by deals. */
export function sectionsFor(s: SalesState, deals: Deal[]) {
  const out = s.cfg.sections.slice();
  deals.forEach((d) => d.section && !out.includes(d.section) && out.push(d.section));
  if (deals.some((d) => !d.section)) out.push('');
  return out;
}

/** KPI ค้างรับ (open jobs whose result is YES; a plan typed before YES is not money owed yet):
 * - receivable: what is still owed: the plan's installments not received (the rest of a part-paid
 *   one too); without a plan, Forecast − Actual while a PAY step is left;
 * - late / lateN: of that, installments past their due date (amount, and how many installments);
 * - dueMonth / dueMonthN: installments due from today to the end of this month (not the late ones). */
export interface Receivables { receivable: number; late: number; lateN: number; dueMonth: number; dueMonthN: number }
export function receivables(s: SalesState, deals: Deal[], today: string, attr = false): Receivables {
  const r: Receivables = { receivable: 0, late: 0, lateN: 0, dueMonth: 0, dueMonthN: 0 };
  const monthEnd = today.slice(0, 8) + '31';
  // a joint quotation's member owes nothing of its own (its typed figures are ignored): the header does,
  // once (or, under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter, the parts of the members in the list)
  moneyHolds(s, deals, attr).forEach((h) => {
    const d = h.d, part = (x: number) => holdPart(s, h, x);
    if (d.jobStatus !== 'open' || dealResult(s, d) !== 'YES') return;
    const plan = planOf(s, d, today);
    if (plan)
      plan.lines.forEach((l) => {
        const left = part(l.left);
        if (!left) return;
        r.receivable += left;
        if (l.lateDays > 0) {
          r.late += left;
          r.lateN++;
        } else if (l.due && l.due >= today && l.due <= monthEnd) {
          r.dueMonth += left;
          r.dueMonthN++;
        }
      });
    else {
      const o = owedNoPlan(s, d, today);
      if (o && o.owed > 0) r.receivable += part(o.owed);
    }
  });
  return r;
}

export interface SalesStats extends Receivables {
  total: number; yes: number; no: number; wait: number; none: number; decided: number; winRate: number;
  forecast: number; actual: number; achieved: number; fcConfirmed: number; acConfirmed: number;
  open: number; closed: number; overdue: number;
  bySource: Record<string, { n: number; forecast: number; yes: number; decided: number }>;
  byService: Record<string, number>;
  /** the team's steps (teamSteps: name = the step's id, PAY = the payments) and how many deals reached each:
   *  something recorded there (an older stage read into it, a contact at CONTACT / FOLLOW), at PAY an
   *  installment received */
  stages: { name: string; code: string; th: string; n: number }[];
  byResp: Record<string, { n: number; forecast: number; actual: number }>;
  byReferral: Record<string, { n: number; forecast: number; actual: number }>;
}

/** Dashboard numbers (same definitions as the original tracker: win rate = YES / (YES + NO)). A joint
 *  quotation counts once: its header carries the money (apportioned to its members' people, sources and
 *  referrals by their parts) and is not a customer; its members are customers with no money of their own. */
export function salesStats(s: SalesState, deals: Deal[], today: string, attr = false): SalesStats {
  return withActIndex(s, () => statsPass(s, deals, today, attr));
}
function statsPass(s: SalesState, deals: Deal[], today: string, attr: boolean): SalesStats {
  const st: SalesStats = {
    total: 0, yes: 0, no: 0, wait: 0, none: 0, decided: 0, winRate: 0, forecast: 0, actual: 0, achieved: 0, fcConfirmed: 0, acConfirmed: 0,
    open: 0, closed: 0, overdue: 0, bySource: {}, byService: {}, stages: teamSteps(s.cfg).map((x) => ({ name: x.id, code: x.code, th: x.th, n: 0 })), byResp: {}, byReferral: {},
    ...receivables(s, deals, today, attr),
  };
  s.cfg.sources.forEach((x) => (st.bySource[x] = { n: 0, forecast: 0, yes: 0, decided: 0 }));
  s.cfg.services.forEach((x) => (st.byService[x] = 0));
  const src = (x: string) => st.bySource[x] || (st.bySource[x] = { n: 0, forecast: 0, yes: 0, decided: 0 });
  const grp = (o: SalesStats['byResp'], k: string) => o[k || '(ไม่ระบุ)'] || (o[k || '(ไม่ระบุ)'] = { n: 0, forecast: 0, actual: 0 });
  /** money of a deal (its own, or a header's part for a member) under its person, referral and sources */
  const money = (d: Deal, fc: number, ac: number) => {
    d.source.forEach((x) => (src(x).forecast += fc));
    [grp(st.byResp, d.resp), grp(st.byReferral, d.referral)].forEach((b) => ((b.forecast += fc), (b.actual += ac)));
  };
  // the money: each deal once, a joint quotation once on its header (or the parts of its members in the
  // list, under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter), apportioned to its members' people
  moneyHolds(s, deals, attr).forEach((h) => {
    const m = dealMoney(s, h.d);
    const fc = m.forecast || 0, ac = m.actual || 0;
    st.forecast += holdPart(s, h, fc);
    st.actual += holdPart(s, h, ac);
    if (m.fcConfirmed) st.fcConfirmed += holdPart(s, h, fc);
    // only what the documents back: money received by hand on other installments is not confirmed by one
    if (m.acConfirmed) st.acConfirmed += holdPart(s, h, ac - m.hand);
    if (!h.g) money(h.d, fc, ac);
    else {
      const fcs = holdOwners(s, h, fc), acs = holdOwners(s, h, ac);
      fcs.forEach((o, i) => money(o.deal, o.amt, acs[i].amt));
    }
  });
  deals.forEach((d) => {
    if (jointRole(s, d) === 'header') return;
    const r = dealResult(s, d);
    st.total++;
    if (r === 'YES') st.yes++;
    else if (r === 'NO') st.no++;
    else if (r === 'WAIT') st.wait++;
    else st.none++;
    if (d.jobStatus === 'closed') st.closed++;
    else st.open++;
    if (overdueDays(s, d, today) != null) st.overdue++;
    d.source.forEach((x) => {
      const b = src(x);
      b.n++;
      if (r === 'YES' || r === 'NO') b.decided++;
      if (r === 'YES') b.yes++;
    });
    // (the job's services: a joint quotation's company is sold under its quotation's, as the filter บริการ reads it)
    jobServices(s, d).forEach((x) => (st.byService[x] = (st.byService[x] || 0) + 1));
    const t = dealSteps(s, d, today).steps;
    st.stages.forEach((g) => {
      const hit = g.name === PAY_SLOT.id ? t.some((v) => v.kind === 'pay' && v.counted && v.state === 'done') : t.some((v) => v.id === g.name && v.filled);
      if (hit) g.n++;
    });
    grp(st.byResp, d.resp).n++;
    grp(st.byReferral, d.referral).n++;
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
/** A service as it is compared (lib/jobs.ts): case, outer and doubled spaces do not count ("t-ver", " CFO "). */
export const svcKey = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/** A row's services as one key: each once (svcKey), sorted; '' for none. */
export const svcSig = (svc: readonly string[]) => [...new Set(svc.map(svcKey).filter(Boolean))].sort().join(',');
function impHash(year: string, s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'imp' + year + (h >>> 0).toString(36);
}
/** The id an imported row got before a company's rows were told apart by their services (the nth row of that
 *  client in that year): the import still finds the rows imported then by it (engine.importTrackerData). */
export const importId = (year: string, c: TrackerClient, nth: number) => impHash(year, `${year}|${importKey(c)}|${nth}`);
/** Stable id for an imported row: the nth row of that client with those services in that year (a company's rows
 *  of different services are different jobs), so importing the same file again, or a newer download where a
 *  row was added above another, or a section, contact or amount was edited, finds the rows already imported
 *  instead of duplicating them or leaving a new one out. */
export const importJobId = (year: string, c: TrackerClient, nth: number) => impHash(year, `${year}|${importKey(c)}|s:${svcSig(c.service)}|${nth}`);

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
