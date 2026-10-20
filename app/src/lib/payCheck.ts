/**
 * The month check for accounting ("ตรวจรับเงินรายเดือน", package cash, the follow-up of item 6): pick a
 * month, see the money that came in and the money customers still owe, and let accounting confirm each
 * received line against the bank and its evidence. Pure (no DOM), so it is unit-tested; the Cashflow tab's
 * month card and year table, the deal panel's plan and the Excel file share it.
 *
 * - One record per received line, `dchk/<dealId>/<lineId>` = {s:'ok'|'back', by, at, amt, d, f, note?}:
 *   `lineId` is the plan's PAY stage, `doc.<docId>` for an Actual document of a deal without a plan, or
 *   `typed` for a typed Actual. `amt`, `d`, `f` are the line as it was checked (received amount, received
 *   date, the sorted ids of its Actual documents): a line that differs now is "รอตรวจ · เปลี่ยนหลังตรวจ",
 *   derived, nothing is written; a record no received line holds any more is an orphan, "ยกเลิกหลังตรวจ",
 *   until accounting acknowledges it (รับทราบ deletes it).
 * - A month close, `mclose/<YYYY-MM>` = {by, at, n, amt}; the first month checked, `scfg/paychk.cfg` {since}.
 * - Months and figures come from cashLines (received on its received date, owed on its due date), so a
 *   month's three figures always equal its Cashflow bar. A check never changes a money figure.
 * - The words and chip classes are the quotation check's (lib/notify.ts QT_WORD / QT_CHIP).
 * - The recorder of a line (who recorded the money) may not check it; the team script forces who and when
 *   on every record, the rest is this client's rule (plan.md §6).
 */
import {
  HOW_TH, PLAN_FIELDS, PLAN_MAX, cashLines, countedAt, countsActual, dealMoney, filterDeals, fmtMoney, hasPlan, holdPart, jointAttr, jointOf, jointParts, kindForStage, planLines, planStart, targetForStage, toPay,
  type CashLine, type CashSum, type Deal, type DealDoc, type DealLog, type DocKind, type PayLine, type PlanInput, type SalesFilter, type SalesState,
} from './sales';
import { sameName } from './caps';
import { TH_M, dmTh, isoTh, localDay } from './format';
import { MONTHS_TH, instSub, instText, jointWords } from './cashUi';
import { QT_CHIP, QT_WORD, checkedLine, type BellRow } from './notify';
import type { XCell, XSheet } from './xlsx';

// ------------------------------------------------------------------ the records

export type PaySt = 'ok' | 'back';
/** `dchk/<dealId>/<lineId>`: a received line as accounting checked it. `amt` is null for an account the
 *  team script hides money from (and so is any figure in `note`). */
export interface PayCheck { s: PaySt; by: string; at: string; amt: number | null; d: string; f: string; note?: string }
/** `mclose/<YYYY-MM>`: a month closed, with the lines and the sum checked at that moment. */
export interface MonthClose { by: string; at: string; n: number; amt: number | null }
/** `scfg/paychk.cfg`: the first day whose received money is checked (lines before it show no status). */
export interface PayChkCfg { since: string }
/** Checking starts from ม.ค. 2569 (owner question 12 ก). */
export const PAYCHK_CFG0: PayChkCfg = { since: '2026-01-01' };
/** A note sent back is at most this long. */
export const PAY_NOTE_MAX = 300;
/** A check can be taken back ("เลิกทำ") this long after it was made, by whoever made it. */
export const PAY_UNDO_MS = 10 * 60000;

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null);
const isDayStr = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v.slice(0, 10)) && !isNaN(Date.parse(v.slice(0, 10)));

/** A pulled `dchk/` value, checked (a malformed one is skipped). `f` may come as a list (sorted, joined). */
export function toPayCheck(v: unknown): PayCheck | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  if (x.s !== 'ok' && x.s !== 'back') return null;
  const f = Array.isArray(x.f) ? x.f.map(String).filter(Boolean).sort().join(',') : str(x.f, 2000);
  const out: PayCheck = { s: x.s, by: str(x.by, 60), at: str(x.at, 40), amt: num(x.amt), d: isDayStr(x.d) ? x.d.slice(0, 10) : '', f };
  if (typeof x.note === 'string' && x.note.trim()) out.note = x.note.slice(0, PAY_NOTE_MAX);
  return out;
}
/** A pulled `mclose/` value. */
export function toMonthClose(v: unknown): MonthClose | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  return { by: str(x.by, 60), at: str(x.at, 40), n: Math.max(0, Math.round(num(x.n) ?? 0)), amt: num(x.amt) };
}
/** `scfg/paychk.cfg`, or the default (ม.ค. 2569). */
export function parsePayChkCfg(v: unknown): PayChkCfg {
  const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { since: isDayStr(x.since) ? x.since.slice(0, 10) : PAYCHK_CFG0.since };
}
/** A record key `<dealId>/<lineId>` in its parts. */
export const splitKey = (k: string) => {
  const j = k.indexOf('/');
  return { dealId: j < 0 ? k : k.slice(0, j), lineId: j < 0 ? '' : k.slice(j + 1) };
};

// ------------------------------------------------------------------ a received line: its id, evidence, fingerprint, recorder

/** The id of a received line in its record's key: the PAY stage of a plan line, `doc.<docId>` for a
 *  document of a deal without a plan, `typed` for a typed Actual; null for money still owed. */
export function lineIdOf(l: CashLine): string | null {
  if (l.kind !== 'got') return null;
  if (l.src === 'plan') return l.stage || null;
  if (l.src === 'doc') return l.doc ? 'doc.' + l.doc.id : null;
  if (l.src === 'typed') return 'typed';
  return null;
}
/** The deal's documents by deal (one pass). */
const docIndex = (s: SalesState) => {
  const m = new Map<string, DealDoc[]>();
  Object.values(s.docs).forEach((x) => m.set(x.deal, [...(m.get(x.deal) || []), x]));
  return m;
};
/** The Actual documents behind a received line, newest first: a plan line's at its stage (as lineView
 *  counts them), a document line's own; none for a typed Actual. */
export function lineDocs(s: SalesState, l: CashLine, ix?: Map<string, DealDoc[]>): DealDoc[] {
  if (l.kind !== 'got') return [];
  if (l.src === 'doc') return l.doc ? [l.doc] : [];
  if (l.src !== 'plan') return [];
  const all = ix ? ix.get(l.deal.id) || [] : Object.values(s.docs).filter((x) => x.deal === l.deal.id);
  return all.filter((x) => x.stage === l.stage && countsActual(x)).sort((a, b) => (b.cAt || b.at || '').localeCompare(a.cAt || a.at || ''));
}
/** What a check is about: the received amount, the received date and the evidence. */
export interface PayFp { amt: number; d: string; f: string }
export const fpOfLine = (l: CashLine, docs: DealDoc[]): PayFp => ({ amt: Math.round(l.amt * 100) / 100, d: l.rcv || l.date, f: docs.map((x) => x.id).sort().join(',') });
/** The line still as checked? An amount the script left out (an account without ดูยอดเงิน) matches. */
export function sameFp(r: Pick<PayCheck, 'amt' | 'd' | 'f'>, fp: PayFp) {
  return (r.amt == null || Math.abs(r.amt - fp.amt) < 0.005) && r.d === fp.d && r.f === fp.f;
}
/** What changed since the check: the amount, the date, documents added or taken away. */
export interface FpDiff { amt: [number | null, number] | null; d: [string, string] | null; add: string[]; rm: string[] }
export function fpDiff(r: Pick<PayCheck, 'amt' | 'd' | 'f'>, fp: PayFp): FpDiff {
  const was = r.f ? r.f.split(',') : [], now = fp.f ? fp.f.split(',') : [];
  return {
    amt: r.amt != null && Math.abs(r.amt - fp.amt) >= 0.005 ? [r.amt, fp.amt] : null,
    d: r.d !== fp.d ? [r.d, fp.d] : null,
    add: now.filter((x) => !was.includes(x)),
    rm: was.filter((x) => !now.includes(x)),
  };
}

/** The deal history by deal, newest first (one pass over S.log). */
export function logsByDeal(s: SalesState): Map<string, DealLog[]> {
  const m = new Map<string, DealLog[]>();
  Object.values(s.log || {}).forEach((x) => x.deal && m.set(x.deal, [...(m.get(x.deal) || []), x]));
  m.forEach((xs) => xs.sort((a, b) => (b.at || '').localeCompare(a.at || '')));
  return m;
}
/** A history row that changed the typed Actual ("แก้ไข" naming the field Actual). */
const typedRow = (x: DealLog) => x.action === 'แก้ไข' && /(^|, )Actual(,|$)/.test(x.detail || '');
/**
 * Who recorded a received line (the "บันทึกโดย" column, and whom the self-check stops), most recent first:
 * an Actual document's attacher (DealDoc.by, which an edit does not overwrite); for money received by hand
 * the author of the newest history row "รับชำระ <stage>" (PayLine.by is the last writer of the whole plan
 * line, so only for old data without that row); for a typed Actual the author of the newest history row
 * that changed it (else, old data, the deal's last writer).
 */
export function recordersOf(s: SalesState, l: CashLine, logs: Map<string, DealLog[]>, docs = lineDocs(s, l)): string[] {
  const out: string[] = [];
  const add = (n: string | undefined) => n && n.trim() && !out.some((x) => sameName(x, n)) && out.push(n.trim());
  const rows = logs.get(l.deal.id) || [];
  if (l.src === 'typed') {
    add(rows.find(typedRow)?.by || l.deal.by);
    return out;
  }
  // the documents and (a plan line) the hand receipt, the newest action first
  const who = docs.map((x) => ({ by: x.by, at: x.at || '' }));
  if (l.src === 'plan') {
    const pl = (s.pays || {})[`${l.deal.id}/${l.stage}`];
    if (pl?.rcv && (!docs.length || pl.add)) {
      // ("รับชำระ PAY1"; a plan of one is named as the screens show it, "รับชำระ PAY", since the steps changed)
      const row = rows.find((x) => x.action === 'รับชำระ ' + l.stage || (!!l.code && x.action === 'รับชำระ ' + l.code));
      who.push(row ? { by: row.by, at: row.at || '' } : { by: pl.by, at: pl.at || '' });
    }
  }
  who.sort((a, b) => b.at.localeCompare(a.at)).forEach((x) => add(x.by));
  return out;
}

// ------------------------------------------------------------------ the rows of the month card

/** `got` a received line · `late` owed and past its due date · `owed` owed, not late yet (รอรับ) ·
 *  `orphan` a check whose line is gone ("ยกเลิกหลังตรวจ"). */
export type RowKind = 'got' | 'late' | 'owed' | 'orphan';
/** A received line's check: `none` before the first month checked (no status, not counted), `wait` not
 *  checked, `changed` checked but different now, `ok` checked, `back` sent back to be fixed. */
export type ChkState = 'none' | 'wait' | 'changed' | 'ok' | 'back';
export interface ChkRow {
  /** the record key `<dealId>/<lineId>` (received lines, orphans), else the money line's id */
  key: string;
  kind: RowKind;
  dealId: string;
  /** null: an orphan whose deal was deleted */
  deal: Deal | null;
  lineId: string;
  /** null for an orphan */
  line: CashLine | null;
  /** the money: received, owed, or (an orphan) what was checked */
  amt: number;
  /** the received date, the due date, or (an orphan) the received date that was checked */
  date: string;
  /** 'YYYY-MM' of `date` */
  ym: string;
  state: ChkState;
  /** the record: holding (ok / back), stale (changed) or the orphan's */
  rec: PayCheck | null;
  fp: PayFp | null;
  diff: FpDiff | null;
  /** who recorded it, most recent first (received lines) */
  by: string[];
  /** its Actual documents, newest first */
  docs: DealDoc[];
  /** an orphan whose money still counts under another line of its deal (its line id changed: a typed
   *  Actual replaced by a document, a plan set on a deal without one): that line (movedTo) */
  to?: ChkRow | null;
}

/** What a line id is: a plan's stage, an Actual document of a deal without a plan, the typed Actual. */
const idKind = (lineId: string) => (lineId === 'typed' ? 'typed' : lineId.startsWith('doc.') ? 'doc' : 'plan');
/** The received line among `cands` that money checked as `was` most likely counts under now: one on the
 *  same date with the same amount, else (`fresh`) a line of another kind no check holds yet, the nearest
 *  amount first. */
function matchMove(lineId: string, was: { amt: number | null; d: string }, cands: ChkRow[], fresh: (r: ChkRow) => boolean): ChkRow | null {
  const same = cands.find((r) => r.date === was.d && (was.amt == null || Math.abs(r.amt - was.amt) < 0.005));
  if (same) return same;
  const off = (r: ChkRow) => (was.amt == null ? 0 : Math.abs(r.amt - was.amt));
  return cands.filter((r) => fresh(r) && idKind(r.lineId) !== idKind(lineId)).sort((a, b) => off(a) - off(b))[0] || null;
}
/**
 * Where the money of a check whose line is gone counts now, when only its line id changed (a typed Actual
 * replaced by a document, a plan set on a deal without one, a deal's last document deleted so its typed
 * Actual counts again): a received line of the same deal (matchMove). null when the money stopped
 * counting: the deal deleted or not won, a plan's installment that is still there but not received, a
 * document still there that no longer counts.
 */
export function movedTo(s: SalesState, key: string, was: { amt: number | null; d: string }, rows: ChkRow[]): ChkRow | null {
  const { dealId, lineId } = splitKey(key);
  if (!s.deals[dealId]) return null;
  // the line's own place is still there: the money was cancelled there, not moved
  if (idKind(lineId) === 'plan' && (s.pays || {})[`${dealId}/${lineId}`]) return null;
  if (idKind(lineId) === 'doc' && s.docs[`${dealId}/${lineId.slice(4)}`] && !hasPlan(s, dealId)) return null;
  return matchMove(lineId, was, rows.filter((r) => r.kind === 'got' && r.dealId === dealId && r.key !== key && r.state !== 'none'), (r) => !r.rec);
}

/**
 * Every dated line of money as the month card lists it, and the orphans: received lines with their check,
 * owed lines (late or not), soonest first. `lines` must be cashLines of every deal (not a filtered view:
 * a record is an orphan only when no line of any deal holds it). Undated money is in no month.
 */
export function chkRows(s: SalesState, lines: CashLine[], checks: Record<string, PayCheck>, since: string): ChkRow[] {
  const logs = logsByDeal(s), ix = docIndex(s);
  const out: ChkRow[] = [];
  const held = new Set<string>();
  for (const l of lines) {
    if (!l.date) continue;
    const ym = l.date.slice(0, 7);
    if (l.kind === 'owed') {
      out.push({ key: l.id, kind: l.status === 'late' ? 'late' : 'owed', dealId: l.deal.id, deal: l.deal, lineId: '', line: l, amt: l.amt, date: l.date, ym, state: 'none', rec: null, fp: null, diff: null, by: [], docs: [] });
      continue;
    }
    const lineId = lineIdOf(l);
    if (!lineId) continue;
    const key = l.deal.id + '/' + lineId;
    held.add(key);
    const docs = lineDocs(s, l, ix), fp = fpOfLine(l, docs);
    const r = checks[key] || null;
    let state: ChkState = 'wait', diff: FpDiff | null = null;
    if (l.date < since) state = 'none';
    else if (r && sameFp(r, fp)) state = r.s;
    else if (r) {
      state = 'changed';
      diff = fpDiff(r, fp);
    }
    out.push({ key, kind: 'got', dealId: l.deal.id, deal: l.deal, lineId, line: l, amt: l.amt, date: l.date, ym, state, rec: state === 'none' ? null : r, fp, diff, by: recordersOf(s, l, logs, docs), docs });
  }
  const got = out.slice();
  for (const [key, r] of Object.entries(checks)) {
    if (held.has(key) || !r.d || r.d < since) continue;
    const { dealId, lineId } = splitKey(key);
    out.push({ key, kind: 'orphan', dealId, deal: s.deals[dealId] || null, lineId, line: null, amt: r.amt ?? 0, date: r.d, ym: r.d.slice(0, 7), state: r.s, rec: r, fp: null, diff: null, by: [], docs: [], to: movedTo(s, key, r, got) });
  }
  const name = (r: ChkRow) => r.deal?.client || '';
  return out.sort((a, b) => a.date.localeCompare(b.date) || name(a).localeCompare(name(b), 'th') || a.key.localeCompare(b.key));
}

/** A month's (or a year's) money and check. The money (got / late / owed) is the Cashflow bar's; the check
 *  counts received lines from the first month checked on (`n`, `amt`), checked ones (`ok`, `okAmt`), those
 *  waiting (`wait` never checked, `changed` since), sent back (`back`) and orphans. */
export interface ChkSum {
  got: number; gotN: number; late: number; lateN: number; owed: number; owedN: number;
  /** the latest received date, the due days of รอรับ, the first late due date */
  lastGot: string; dues: string[]; firstLate: string;
  n: number; amt: number; ok: number; okAmt: number; wait: number; changed: number; back: number; backAmt: number; orphans: number;
}
export function sumRows(rows: ChkRow[]): ChkSum {
  const c: ChkSum = { got: 0, gotN: 0, late: 0, lateN: 0, owed: 0, owedN: 0, lastGot: '', dues: [], firstLate: '', n: 0, amt: 0, ok: 0, okAmt: 0, wait: 0, changed: 0, back: 0, backAmt: 0, orphans: 0 };
  for (const r of rows) {
    if (r.kind === 'orphan') {
      c.orphans++;
      continue;
    }
    if (r.kind === 'late') {
      c.late += r.amt;
      c.lateN++;
      if (!c.firstLate || r.date < c.firstLate) c.firstLate = r.date;
      continue;
    }
    if (r.kind === 'owed') {
      c.owed += r.amt;
      c.owedN++;
      if (!c.dues.includes(r.date)) c.dues.push(r.date);
      continue;
    }
    c.got += r.amt;
    c.gotN++;
    if (r.date > c.lastGot) c.lastGot = r.date;
    if (r.state === 'none') continue;
    c.n++;
    c.amt += r.amt;
    if (r.state === 'ok') {
      c.ok++;
      c.okAmt += r.amt;
    } else if (r.state === 'back') {
      c.back++;
      c.backAmt += r.amt;
    } else if (r.state === 'changed') c.changed++;
    else c.wait++;
  }
  c.dues.sort();
  return c;
}
/** The Cashflow bar of the same rows (cashYear's CashSum): the month card says it equals the bar. */
export const barOf = (c: ChkSum): CashSum => ({ got: c.got, late: c.late, wait: c.owed, n: c.gotN + c.lateN + c.owedN });
export const sumTotal = (c: Pick<ChkSum, 'got' | 'late' | 'owed'>) => c.got + c.late + c.owed;

/** 'YYYY-MM' of a CE year and a month index (0–11). */
export const ymOf = (ceYear: number | string, m: number) => `${ceYear}-${String(m + 1).padStart(2, '0')}`;
/** "ตุลาคม 2569" / "ต.ค. 2569" for 'YYYY-MM'. */
export const ymTh = (ym: string, short = false) => `${(short ? TH_M : MONTHS_TH)[+ym.slice(5, 7) - 1]} ${+ym.slice(0, 4) + 543}`;

/** How many of some rows fall in each Buddhist-era year, oldest first (the links of the month figure). */
const perYear = (ms: { ym: string; n: number }[]) => {
  const m = new Map<string, number>();
  ms.forEach((x) => m.set(String(+x.ym.slice(0, 4) + 543), (m.get(String(+x.ym.slice(0, 4) + 543)) || 0) + x.n));
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([be, n]) => ({ be, n }));
};
/** Late money of earlier months still owed, the year before included (December's in January): the month
 *  figure's "ค้างจากเดือนก่อน", with the years it falls in. `rows` must reach back before the shown year
 *  (CashView passes every year's, through the page's filter). */
export function carriedLate(rows: ChkRow[], ym: string) {
  const ls = rows.filter((r) => r.kind === 'late' && r.ym < ym);
  return { n: ls.length, amt: ls.reduce((a, r) => a + r.amt, 0), years: perYear(ls.map((r) => ({ ym: r.ym, n: 1 }))) };
}
/** Lines waiting for a check in other months, other years' too: how many, by month ("ส.ค. 1 · ก.ย. 1";
 *  a month of another year carries its year, "ธ.ค. 2569 1"), and by year. */
export function waitingElsewhere(rows: ChkRow[], ym: string) {
  const by = new Map<string, number>();
  rows.forEach((r) => isWaiting(r) && r.ym !== ym && by.set(r.ym, (by.get(r.ym) || 0) + 1));
  const months = [...by].sort(([a], [b]) => a.localeCompare(b)).map(([m, n]) => ({ ym: m, n }));
  const word = (m: string) => (m.slice(0, 4) === ym.slice(0, 4) ? ymTh(m, true).split(' ')[0] : ymTh(m, true));
  return { n: months.reduce((a, x) => a + x.n, 0), months, years: perYear(months), words: months.length === 1 ? word(months[0].ym) : months.map((x) => `${word(x.ym)} ${x.n}`).join(' · ') };
}

// ------------------------------------------------------------------ closing a month, the year table

/** A month in the year table: `closed`; `current` (this month); `future`; `none` nothing received to check
 *  (or all of it before the first month checked); `can` every line checked, ready to close; `open` not yet. */
export type CloseState = 'closed' | 'current' | 'future' | 'none' | 'can' | 'open';
export function closeStateOf(c: ChkSum, ym: string, close: MonthClose | null | undefined, today: string): CloseState {
  if (close) return 'closed';
  const now = today.slice(0, 7);
  if (ym === now) return 'current';
  if (ym > now) return 'future';
  if (!c.n) return 'none';
  return c.ok === c.n && !c.orphans ? 'can' : 'open';
}
/** A month may be closed once it has ended and every received line in it is checked (none waiting, none
 *  sent back, no orphan left to acknowledge). */
export const canClose = (c: ChkSum, ym: string, today: string) => closeStateOf(c, ym, null, today) === 'can';
/** Lines of a closed month that are not "ตรวจแล้ว" any more (changed or added after the close). */
export const afterClose = (c: ChkSum) => c.n - c.ok + c.orphans;
/** The close record of a month as it stands now: the lines and the sum checked. */
export const closeRecord = (c: ChkSum, by: string, at: string): MonthClose => ({ by, at, n: c.ok, amt: c.okAmt });
/** Checked lines whose received date moved out of month `ym` after their check (they wait in their new
 *  month, "เปลี่ยนหลังตรวจ"): `rows` every deal's, of every year. */
export const movedOut = (rows: ChkRow[], ym: string) => rows.filter((r) => r.kind === 'got' && r.state === 'changed' && r.ym !== ym && r.rec?.d.slice(0, 7) === ym).length;
/**
 * A closed month (the whole month, every deal's lines) against its close record: `redo` lines in it to
 * check again (changed, or added after the close), `orphans` lines cancelled after their check, `moved`
 * checked lines whose received date moved to another month, `same` whether what is checked in it still
 * equals the close (lines and sum; a sum the script hid from this account is not compared). `flagged`:
 * any of these, so a line that leaves a closed month is never lost without a word.
 */
export interface CloseDrift { redo: number; orphans: number; moved: number; same: boolean; flagged: boolean }
export function closeDrift(c: ChkSum, close: MonthClose, moved = 0): CloseDrift {
  const redo = c.n - c.ok, same = c.ok === close.n && (close.amt == null || Math.abs(c.okAmt - close.amt) < 0.005);
  // a line that had left the month when it was closed (again) is not in its close: moved lines only
  // explain a checked sum that no longer equals the close
  return { redo, orphans: c.orphans, moved: same ? 0 : moved, same, flagged: redo > 0 || c.orphans > 0 || !same };
}
/** The drift in a few words (the year table, the file): "แก้หลังปิด 1 · ย้ายออกหลังปิด 1", or
 *  "ยอดเปลี่ยนจากตอนปิด" when only the sum differs ('' nothing changed). */
export function driftWords(x: CloseDrift | null | undefined): string {
  if (!x?.flagged) return '';
  const w = [x.redo ? `แก้หลังปิด ${x.redo}` : '', x.moved ? `ย้ายออกหลังปิด ${x.moved}` : '', x.orphans ? `ยกเลิกหลังตรวจ ${x.orphans}` : ''].filter(Boolean);
  return w.length ? w.join(' · ') : 'ยอดเปลี่ยนจากตอนปิด';
}
/** A closed month that changed may be closed again with what it holds now once every line in it is
 *  checked again (engine.closeMonth writes the new record over the old one). */
export const canReclose = (c: ChkSum, ym: string, x: CloseDrift | null | undefined, today: string) => !!x?.flagged && canClose(c, ym, today);

/** A month of the year table. `sum` is the lines shown (the page's filter); `team` the whole month's, every
 *  deal's: a close covers the whole month, so `state` (may it be closed), the close record, its `drift`
 *  and the closed month's banner come from `team`, never from a filtered view. */
export interface MonthRow { ym: string; sum: ChkSum; close: MonthClose | null; state: CloseState; team: ChkSum; drift: CloseDrift | null }
/** The year table "สรุปรายเดือน": 12 months of a CE year, and the year's sums of the lines shown (they equal
 *  the Cashflow cards). `team`: every deal's lines (CashView's, without the page's filter, of every year:
 *  a line that moved out of a closed month may now be in another year); left out, the rows are the whole
 *  team's. */
export function yearCheck(rows: ChkRow[], ceYear: number, closes: Record<string, MonthClose>, today: string, team?: ChkRow[]) {
  const y = String(ceYear);
  const mine = rows.filter((r) => r.ym.startsWith(y + '-'));
  const every = team || rows;
  const all = team ? team.filter((r) => r.ym.startsWith(y + '-')) : null;
  const months: MonthRow[] = Array.from({ length: 12 }, (_, i) => {
    const ym = ymOf(ceYear, i), sum = sumRows(mine.filter((r) => r.ym === ym));
    const t = all ? sumRows(all.filter((r) => r.ym === ym)) : sum;
    const close = closes[ym] || null;
    return { ym, sum, close, state: closeStateOf(t, ym, close, today), team: t, drift: close ? closeDrift(t, close, movedOut(every, ym)) : null };
  });
  return { months, total: sumRows(mine), closed: months.filter((m) => m.close).length };
}
/** One month of every deal's received lines, as closing it counts them (engine.closeMonth checks this
 *  itself rather than trusting what a screen passed). */
export function teamMonth(s: SalesState, checks: Record<string, PayCheck>, since: string, today: string, ym: string): ChkSum {
  return sumRows(chkRows(s, cashLines(s, Object.values(s.deals), today), checks, since).filter((r) => r.ym === ym));
}

// ------------------------------------------------------------------ the Cashflow page's rows

/** The month check's rows through the page's filter: a row as the page shows it, or null when it is not in it. */
export type PageView = (r: ChkRow) => ChkRow | null;
/**
 * The Cashflow page's filter (ผู้รับผิดชอบ, แหล่งที่มา, บริการ, referral, หมวด) on the month check's rows, whatever
 * year their deal is of (a line of December carried into January); null when none is set. A check whose
 * deal was deleted passes no filter. A joint quotation's lines (its header's, once) under a ผู้รับผิดชอบ /
 * SOURCE / REFERRAL filter are the parts of its companies the filter lists, as the Cashflow chart and cards
 * count them (sales jointCashLines): the amount is that part, the line says of how many companies, and
 * none of it when no company of it is listed. Its check stays the whole line's (`fp`).
 */
export function pageKeep(s: SalesState, f: SalesFilter, today: string): PageView | null {
  if (!(f.resp || f.source || f.service || f.referral || f.section)) return null;
  const ids = new Set<string>();
  new Set(Object.values(s.deals).map((d) => d.year)).forEach((y) => filterDeals(s, { ...f, year: y, money: undefined }, today).forEach((d) => ids.add(d.id)));
  const attr = jointAttr(f);
  return (r) => {
    if (!r.deal) return null;
    const g = attr && s.jqt?.[r.dealId] ? jointOf(s, r.deal) : null;
    if (!g || !g.members.length) return ids.has(r.dealId) ? r : null;
    const keep = g.members.map((x, i) => (ids.has(x.deal.id) ? i : -1)).filter((i) => i >= 0);
    if (keep.length === g.members.length) return r;
    const w = jointParts(s, g), kept = keep.filter((i) => w[i] > 0);
    const amt = kept.length ? holdPart(s, { d: g.head, g, keep }, r.amt) : 0;
    if (!amt) return null;
    const line = r.line && { ...r.line, amt, ...(r.line.joint ? { joint: { ...r.line.joint, part: kept.length, keep: kept.map((i) => g.members[i].deal.id) } } : {}) };
    return { ...r, amt, line };
  };
}
/**
 * The month check's three sets of rows from every deal's (`all`, chkRows of cashLines of every deal):
 * `rows` the shown year through the page's filter (the month card, the year table's figures, the file),
 * `wide` the filter over every year (late money carried from an earlier year, lines waiting in other
 * months), `team` every line without the filter (closing a month covers the whole month; yearCheck takes
 * the shown year's months from it, and finds a line that moved out of a closed month in any year).
 */
export function cashCheckRows(all: ChkRow[], ceYear: number, keep: PageView | null) {
  const inYear = (r: ChkRow) => r.ym.startsWith(ceYear + '-');
  const wide = keep ? all.map(keep).filter((r): r is ChkRow => !!r) : all;
  return { rows: wide.filter(inYear), wide, team: all };
}

// ------------------------------------------------------------------ who may do what, the filter

/** The recorder of the line (any of them). */
export const isSelf = (r: Pick<ChkRow, 'by'>, me: string) => r.by.some((b) => sameName(b, me));
/** Waiting for a check: never checked, or changed since. */
export const isWaiting = (r: ChkRow) => r.kind === 'got' && (r.state === 'wait' || r.state === 'changed');
/** A tick box: a line waiting for a check that this person did not record (a returned line has none, so
 *  "ตรวจทั้งหมดที่เลือก" never confirms a line accounting flagged). */
export const canTick = (r: ChkRow, me: string) => isWaiting(r) && !!me.trim() && !isSelf(r, me);
/** "ตรวจแล้ว" on one line: waiting, or sent back (the recorder explained it without changing it). */
export const canConfirm = (r: ChkRow, me: string) => (isWaiting(r) || (r.kind === 'got' && r.state === 'back')) && !!me.trim() && !isSelf(r, me);
/** "ส่งกลับแก้ไข": a line waiting for a check, not one's own. */
export const canReturn = (r: ChkRow, me: string) => isWaiting(r) && !!me.trim() && !isSelf(r, me);
/** "เลิกทำ": one's own check, within 10 minutes. */
export const canUndo = (rec: PayCheck | null | undefined, me: string, now: number) => !!rec && sameName(rec.by, me) && now - Date.parse(rec.at) < PAY_UNDO_MS;

/** The filter chips: ทั้งหมด · รอตรวจ · ตรวจแล้ว · ส่งกลับแก้ไข · รอรับ · เลยกำหนด. */
export type ChkF = 'all' | 'wait' | 'ok' | 'back' | 'owed' | 'late';
export const CHK_F: { id: ChkF; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'wait', label: 'รอตรวจ' },
  { id: 'ok', label: 'ตรวจแล้ว' },
  { id: 'back', label: 'ส่งกลับแก้ไข' },
  { id: 'owed', label: 'รอรับ' },
  { id: 'late', label: 'เลยกำหนด' },
];
export const isChkF = (x: unknown): x is ChkF => CHK_F.some((f) => f.id === x);
export function chkMatch(r: ChkRow, f: ChkF): boolean {
  if (f === 'all') return true;
  if (f === 'owed' || f === 'late') return r.kind === f;
  if (r.kind !== 'got') return false;
  return f === 'wait' ? isWaiting(r) : r.state === f;
}
export const chkCounts = (rows: ChkRow[]) => Object.fromEntries(CHK_F.map((f) => [f.id, rows.filter((r) => chkMatch(r, f.id)).length])) as Record<ChkF, number>;

// ------------------------------------------------------------------ words

/** The chip of a received line (or an orphan): the quotation check's words and classes. */
export function chipOf(r: ChkRow): { word: string; cls: string; meta: string } | null {
  if (r.kind === 'orphan') return { word: 'ยกเลิกหลังตรวจ', cls: 'chip', meta: r.rec ? checkedLine(r.rec) : '' };
  if (r.kind !== 'got' || r.state === 'none') return null;
  if (r.state === 'wait') return { word: QT_WORD.wait, cls: QT_CHIP.wait, meta: '' };
  if (r.state === 'changed') return { word: QT_WORD.wait, cls: QT_CHIP.wait, meta: 'เปลี่ยนหลังตรวจ' };
  return { word: QT_WORD[r.state], cls: QT_CHIP[r.state], meta: r.rec ? checkedLine(r.rec) : '' };
}
/** A document's kind in one word ("ใบเสร็จ", "ใบแจ้งหนี้"): an invoice counts as money received at a PAY
 *  stage, so the evidence always says which it is. */
export const KIND_WORD: Record<DocKind, string> = { receipt: 'ใบเสร็จ', invoice: 'ใบแจ้งหนี้', quotation: 'ใบเสนอราคา', other: 'เอกสาร' };
export const docWord = (x: Pick<DealDoc, 'kind' | 'docNo'>) => KIND_WORD[x.kind] + (x.docNo ? ' ' + x.docNo : '');
/** The evidence in words: "ใบเสร็จ RC-2569-047", "+ 1 ไฟล์" for more, "ไม่มีไฟล์". */
export const evidenceWord = (r: Pick<ChkRow, 'docs'>) => (r.docs.length ? docWord(r.docs[0]) + (r.docs.length > 1 ? ` และอีก ${r.docs.length - 1} ไฟล์` : '') : 'ไม่มีไฟล์');
const BASIS_WORD: Record<DealDoc['basis'], string> = { total: 'รวม VAT', subtotal: 'ก่อน VAT', netPay: 'หลังหัก ณ ที่จ่าย', manual: 'พิมพ์เอง' };
/** What the amount is: as on the document (รวม VAT, ก่อน VAT, หลังหัก ณ ที่จ่าย), typed (พิมพ์เอง), recorded by
 *  hand (บันทึกเอง), or as planned (owed money: ตามแผน). */
export function basisWord(r: ChkRow): string {
  if (r.kind === 'late' || r.kind === 'owed') return 'ตามแผน';
  if (!r.line) return '';
  if (r.line.src === 'typed') return 'พิมพ์เอง';
  if (r.docs.length) return BASIS_WORD[r.docs[0].basis] || 'รวม VAT';
  return 'บันทึกเอง';
}
/** The line in a few words for history rows and dialogs: "PAY1", "ใบเสร็จ RC-1", "รับที่ PAY2 · พิมพ์เอง". */
export function lineLabel(r: Pick<ChkRow, 'line' | 'lineId'>, s?: SalesState): string {
  if (r.line) return r.line.src === 'plan' ? r.line.code || r.line.stage : instSub(r.line);
  if (r.lineId.startsWith('doc.')) {
    const id = r.lineId.slice(4), doc = s ? Object.values(s.docs).find((x) => x.id === id) : undefined;
    return doc ? docWord(doc) : 'เอกสาร';
  }
  return r.lineId === 'typed' ? 'Actual พิมพ์เอง' : r.lineId;
}
/** The installment column: "งวด 1/2" or "ไม่มีแผน", and under it the stage or where the money came in. */
export function instOf(r: ChkRow, s?: SalesState): { text: string; sub: string } {
  if (r.line) return { text: instText(r.line), sub: r.line.joint ? 'ผู้จ่าย ' + r.line.deal.client : r.line.src === 'typed' && r.line.stage ? 'รับที่ ' + (r.line.code || r.line.stage) : instSub(r.line) };
  // an orphan: the stage it was, or the document / typed Actual of a deal without a plan
  const stage = r.lineId !== 'typed' && !r.lineId.startsWith('doc.');
  return { text: stage ? r.lineId : 'ไม่มีแผน', sub: stage ? 'งวดที่ยกเลิก' : lineLabel(r, s) };
}

/** History rows that change a received line (not the checks themselves). */
const CHANGE_RE = /^(รับชำระ |ยกเลิกการรับ |ถือว่ารับครบ |แนบ|แก้ไขเอกสาร|ลบเอกสาร|เปลี่ยนไฟล์เอกสาร|แก้แผนชำระ|ตั้งแผนชำระ|ลบแผนชำระ|อัปเดต PAY)/;
/** The newest history row of the deal after the check that changed money: who and when, for the note. */
export function changedBy(s: SalesState, r: ChkRow, logs = logsByDeal(s)): DealLog | null {
  if (!r.rec) return null;
  const at = r.rec.at;
  return (logs.get(r.dealId) || []).find((x) => (x.at || '') > at && (CHANGE_RE.test(x.action) || typedRow(x))) || null;
}
/** "วันที่รับจาก 14 ส.ค. 2569 เป็น 15 ส.ค. 2569 · ยอดจาก 120,000 เป็น 125,000 · แนบใบเสร็จ RC-1". */
export function changeWords(s: SalesState, r: ChkRow): string {
  const d = r.diff;
  if (!d) return '';
  const name = (id: string) => {
    const doc = Object.values(s.docs).find((x) => x.id === id);
    return doc ? docWord(doc) : 'เอกสาร';
  };
  return [
    d.d ? `วันที่รับจาก ${isoTh(d.d[0])} เป็น ${isoTh(d.d[1])}` : '',
    d.amt ? `ยอดจาก ${fmtMoney(d.amt[0])} เป็น ${fmtMoney(d.amt[1])} บาท` : '',
    d.add.length ? 'แนบ' + d.add.map(name).join(', ') : '',
    d.rm.length ? 'เอาหลักฐานออก ' + d.rm.length + ' ไฟล์' : '',
  ].filter(Boolean).join(' · ');
}
/** The note under a line: what to fix (sent back), what changed after the check, or that the money was
 *  cancelled after it. `to`: whom a returned line was sent to. null when there is nothing to say. */
export function noteOf(s: SalesState, r: ChkRow, logs = logsByDeal(s)): { head: string; body: string; to: string } | null {
  const rec = r.rec;
  if (!rec) return null;
  const who = rec.by || 'บัญชี', when = dayOf(rec.at), amt = rec.amt != null ? ` ที่ยอด ${fmtMoney(rec.amt)} บาท` : '';
  if (r.kind === 'orphan') {
    const ch = changedBy(s, r, logs);
    return {
      head: 'ยกเลิกหลังตรวจ' + (ch ? ` · ${ch.by || 'ไม่ระบุ'} ${ch.action} เมื่อ ${dayOf(ch.at)}` : r.deal ? '' : ' · งานนี้ถูกลบแล้ว'),
      body: `${who} ${rec.s === 'back' ? 'ส่งกลับแก้ไขไว้' : 'ตรวจไว้'}เมื่อ ${when}${amt} รับ ${isoTh(rec.d)} · ${r.to ? movedWords(r.to, rec) : 'ตอนนี้ไม่ได้นับเป็นเงินเข้าแล้ว'}`,
      to: '',
    };
  }
  if (r.state === 'back') {
    const to = r.by[0] || r.deal?.resp || '';
    return { head: `สิ่งที่ต้องแก้ จาก ${who} · ${when}${to ? ' · ส่งถึง ' + to : ''}`, body: rec.note || '', to };
  }
  if (r.state === 'changed') {
    const ch = changedBy(s, r, logs);
    return {
      head: 'เปลี่ยนหลังตรวจ' + (ch ? ` · ${ch.by || 'ไม่ระบุ'} แก้เมื่อ ${dayOf(ch.at)} (${ch.action})` : ''),
      body: [changeWords(s, r), `${who} ${rec.s === 'back' ? 'ส่งกลับแก้ไขไว้' : 'ตรวจไว้'}เมื่อ ${when}${amt}${r.diff && !r.diff.amt ? ' ยอดไม่เปลี่ยน' : ''}`].filter(Boolean).join(' · '),
      to: '',
    };
  }
  return null;
}
/** "12 ต.ค." for a timestamp, in local time. */
const dayOf = (iso: string) => dmTh(localDay(iso || '')) || '—';
/** Where a line counts, in a word or two: "PAY1", "ใบเสร็จ RC-1", "Actual ที่พิมพ์ไว้". */
export const whereOf = (r: Pick<ChkRow, 'line' | 'lineId'>) => (r.line?.src === 'typed' ? 'Actual ที่พิมพ์ไว้' : r.line?.src === 'doc' && r.line.doc ? docWord(r.line.doc) : lineLabel(r));
/** The money of a check whose line id changed, where it counts now: "ตอนนี้นับเป็นเงินเข้าที่ PAY1 แทน ·
 *  รอตรวจใหม่" (with its amount or date when they differ from the check's). */
export function movedWords(to: ChkRow, was: Pick<PayCheck, 'amt' | 'd'>): string {
  const amt = was.amt != null && Math.abs(to.amt - was.amt) >= 0.005 ? ` ยอด ${fmtMoney(to.amt)} บาท` : '';
  const d = to.date !== was.d ? ` รับ ${isoTh(to.date)}` : '';
  const st = to.state === 'ok' ? 'ตรวจแล้ว' : to.state === 'back' ? 'ส่งกลับแก้ไข' : to.state === 'none' ? '' : 'รอตรวจใหม่';
  return `ตอนนี้นับเป็นเงินเข้าที่ ${whereOf(to)}${amt}${d} แทน${st ? ' · ' + st : ''}`;
}

// ------------------------------------------------------------------ the deal panel

/** One deal's received lines with their check (and its checks whose line is gone), as the month card has
 *  them: the deal panel's chips and its question before a checked line changes. */
export function dealChecks(s: SalesState, d: Deal, checks: Record<string, PayCheck>, since: string, today: string): ChkRow[] {
  const mine = Object.fromEntries(Object.entries(checks).filter(([k]) => k.startsWith(d.id + '/')));
  return chkRows(s, cashLines(s, [d], today), mine, since).filter((r) => r.kind === 'got' || r.kind === 'orphan');
}
/** " · บัญชีตรวจแล้ว 1 จาก 1 งวดที่รับ" for the plan's summary line ('' while nothing received is checkable). */
export function planCheckWords(rows: ChkRow[]): string {
  const got = rows.filter((r) => r.kind === 'got' && r.state !== 'none');
  return got.length ? ` · บัญชีตรวจแล้ว ${got.filter((r) => r.state === 'ok').length.toLocaleString('en-US')} จาก ${got.length.toLocaleString('en-US')} งวดที่รับ` : '';
}
/** The line a document counts under: its stage on a deal with a plan, else the document's own. */
export const docLineId = (s: SalesState, doc: Pick<DealDoc, 'id' | 'deal' | 'stage'>) => (hasPlan(s, doc.deal) ? doc.stage : 'doc.' + doc.id);

// ------------------------------------------------------------------ the question before a change (PayChk usePayGuard)

/** A received line a change touches, as the question shows it: `ym` the month it is in (or lands in, a
 *  closed one), `close` that month's close, `gone` it stops counting under its line ("ยกเลิกหลังตรวจ" once
 *  checked), `to` where that money counts instead when only its line id changes (a plan set on a deal
 *  without one), `out` the month a line of the closed month `ym` moves to ('' it stays), `added` new money
 *  landing in a closed month. */
export interface GuardHit { r: ChkRow; ym: string; close: MonthClose | null; gone: boolean; added: boolean; out: string; to: ChkRow | null }
/**
 * What to ask about before a change to a deal's money: its received lines the change touches that accounting
 * checked or sent back, or that are in (or land in) a closed month. `before`: the deal's rows now
 * (dealChecks). The change is either `after`, the deal's rows as they will be (compared by fingerprint, so
 * only a real change asks), or `lines`, the line ids it may touch when the result can't be worked out first
 * (a document still to be chosen in the attach dialog).
 */
export function guardHits(before: ChkRow[], closes: Record<string, MonthClose>, by: { lines: string[] } | { after: ChkRow[] }): GuardHit[] {
  const out: GuardHit[] = [];
  const got = before.filter((r) => r.kind === 'got' && r.state !== 'none');
  const after = 'after' in by ? by.after.filter((x) => x.kind === 'got' && x.state !== 'none') : null;
  // lines the change creates (a new line id): where money that leaves its old line id may count now
  const fresh = (after || []).filter((a) => !got.some((r) => r.key === a.key));
  for (const r of got) {
    let ym = r.ym, gone = false, moved = '', to: ChkRow | null = null;
    if (after) {
      const a = after.find((x) => x.key === r.key);
      if (a && sameFp(r.fp!, a.fp!)) continue;
      if (!a) {
        gone = true;
        to = matchMove(r.lineId, { amt: r.amt, d: r.date }, fresh, () => true);
      } else if (a.ym !== ym) {
        if (closes[ym]) moved = a.ym;
        else if (closes[a.ym]) ym = a.ym;
      }
    } else if (!(by as { lines: string[] }).lines.includes(r.lineId)) continue;
    const close = closes[ym] || null;
    if (r.state === 'ok' || r.state === 'back' || close) out.push({ r, ym, close, gone, added: false, out: moved, to });
  }
  // new money landing in a closed month (not money that only moved to a new line id: said with its old line)
  fresh.forEach((a) => closes[a.ym] && !out.some((h) => h.to?.key === a.key) && out.push({ r: a, ym: a.ym, close: closes[a.ym], gone: false, added: true, out: '', to: null }));
  return out;
}
/** An installment received on invoices only: every document counted at the stage is an invoice (an invoice
 *  counts as money in, package cash rule 11). The deal panel then offers "แนบใบเสร็จแทนใบแจ้งหนี้", the
 *  receipt replacing it (the attach dialog's "ใช้ยอดนี้แทน"), as accounting asks when it returns the line. */
export function invoiceOnly(s: SalesState, dealId: string, stage: string) {
  const ds = Object.values(s.docs).filter((x) => x.deal === dealId && x.stage === stage && countsActual(x));
  return ds.length > 0 && ds.every((x) => x.kind === 'invoice');
}
/** The received lines a document attached at a stage may change, asked about before the attach dialog
 *  opens (the document is not chosen yet): none for a quotation or a document that counts toward nothing;
 *  on a deal with a plan the stage's installment; without one a typed Actual (a document takes its place). */
export function attachLines(s: SalesState, dealId: string, stage: string | undefined, kind?: DocKind, target?: DealDoc['target']): string[] {
  const k = kind ?? (stage ? kindForStage(s.cfg, stage) : 'other');
  if ((target ?? targetForStage(s.cfg, stage || '', k)) !== 'actual') return [];
  return hasPlan(s, dealId) ? (stage ? [stage] : []) : ['typed'];
}
/** The sales state with one change made, for the question's before / after (shallow copies: the engine's
 *  state is not touched). */
export const previewOf = {
  deal: (s: SalesState, id: string, p: Partial<Deal>): SalesState => ({ ...s, deals: { ...s.deals, [id]: { ...s.deals[id], ...p } } }),
  /** a deal deleted */
  noDeal: (s: SalesState, id: string): SalesState => {
    const deals = { ...s.deals };
    delete deals[id];
    return { ...s, deals };
  },
  step: (s: SalesState, id: string, stage: string, v: { d: string; n: string }): SalesState => ({ ...s, steps: { ...s.steps, [`${id}/${stage}`]: v } }),
  /** a document changed (null: deleted) */
  doc: (s: SalesState, deal: string, docId: string, p: Partial<DealDoc> | null): SalesState => {
    const k = `${deal}/${docId}`, docs = { ...s.docs };
    if (p && docs[k]) {
      docs[k] = { ...docs[k], ...p };
      if (docs[k].amount == null) docs[k].target = 'none';
    } else delete docs[k];
    return { ...s, docs };
  },
  /** money received by hand at an installment (engine.markPaid) */
  pay: (s: SalesState, id: string, stage: string, p: Partial<PayLine>): SalesState => {
    const k = `${id}/${stage}`;
    return s.pays[k] ? { ...s, pays: { ...s.pays, [k]: { ...s.pays[k], ...p } } } : s;
  },
  /**
   * a plan saved (engine.setPlan, the same rules): each listed stage takes its plan fields; on a deal's
   * first plan a PAY stage paid the old way (planStart) is received by hand on that day; a stage no longer
   * listed goes unless it was received. A deal without a plan has its received money move from its
   * documents or typed Actual to the plan's stages, so the question can say so.
   */
  plan: (s: SalesState, id: string, lines: PlanInput[], today: string): SalesState => {
    const d = s.deals[id];
    if (!d) return s;
    const pays = { ...s.pays }, had = planLines(s, d);
    const old = had ? [] : planStart(s, d, today).lines.filter((x) => x.old && x.amt != null);
    const want = new Map<string, PlanInput>();
    lines.forEach((x) => {
      const stage = String(x.stage || '').trim().replace(/\//g, '-').slice(0, 60);
      if (stage && !want.has(stage) && want.size < PLAN_MAX) want.set(stage, x);
    });
    want.forEach((x, stage) => {
      const k = `${id}/${stage}`;
      const was: PayLine = pays[k] || { amt: null, pct: null, due: '', rel: null, how: '', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '' };
      const n = toPay({ ...was, ...Object.fromEntries(PLAN_FIELDS.filter((f) => x[f] !== undefined).map((f) => [f, x[f]])) });
      if (!n) return;
      const o = old.find((z) => z.stage === stage);
      pays[k] = o && !n.rcv && (n.amt || 0) > 0 ? { ...n, rcv: o.old, got: n.amt } : n;
    });
    (had || []).forEach(({ stage }) => {
      const k = `${id}/${stage}`;
      if (!want.has(stage) && !pays[k]?.rcv && !countedAt(s, d, stage).length) delete pays[k];
    });
    return { ...s, pays };
  },
  /** a one-click plan on a deal without one (engine.quickPlan): the money it received becomes the plan's
   *  received stages (planStart); the stages added after them are not received and change no check. A deal
   *  with a plan keeps its received stages as they are. */
  firstPlan: (s: SalesState, id: string, today: string): SalesState => {
    const d = s.deals[id];
    if (!d || hasPlan(s, id)) return s;
    const keep = planStart(s, d, today).lines.flatMap(({ stage, amt }) => (amt != null ? [{ stage, amt, pct: null, due: '', rel: null, how: '' as const, howT: '', note: '' }] : []));
    return previewOf.plan(s, id, keep, today);
  },
};

// ------------------------------------------------------------------ the bell

/** Received lines accounting sent back that are this person's to fix (they recorded the money, or the deal
 *  is theirs), newest first: the bell's group. A line changed since waits for accounting again and drops
 *  out. Only the deals with a returned line are worked out. */
export function returnedTo(s: SalesState, checks: Record<string, PayCheck>, since: string, me: string, today: string): ChkRow[] {
  if (!me.trim()) return [];
  const ids = new Set(Object.entries(checks).filter(([, c]) => c.s === 'back').map(([k]) => splitKey(k).dealId));
  const deals = [...ids].map((id) => s.deals[id]).filter(Boolean);
  if (!deals.length) return [];
  const mine = Object.fromEntries(Object.entries(checks).filter(([k]) => ids.has(splitKey(k).dealId)));
  return chkRows(s, cashLines(s, deals, today), mine, since)
    .filter((r) => r.kind === 'got' && r.state === 'back' && (isSelf(r, me) || sameName(r.deal?.resp, me)))
    .sort((a, b) => (b.rec?.at || '').localeCompare(a.rec?.at || ''));
}
/** Those lines as the bell lists them: the client, the line, the amount, who sent it back and why. */
export function payBackBell(rows: ChkRow[]): BellRow[] {
  return rows.map((r) => ({
    key: 'b:' + r.key,
    kind: 'pchk',
    title: r.deal?.client || '',
    sub: [lineLabel(r), fmtMoney(r.amt) + ' บาท', `${r.rec?.by || 'บัญชี'} ส่งกลับให้แก้${r.rec?.note ? ': ' + (r.rec.note.length > 60 ? r.rec.note.slice(0, 59) + '…' : r.rec.note) : ''}`].join(' · '),
    right: { text: QT_WORD.back, chip: '' },
    count: true,
    go: { deal: r.dealId },
  }));
}

// ------------------------------------------------------------------ the Excel file

/** The money status of a line in the file: รับแล้ว · เลยกำหนด · รอรับ · ยกเลิกหลังตรวจ. */
export const moneyWord = (r: ChkRow) => (r.kind === 'got' ? 'รับแล้ว' : r.kind === 'late' ? 'เลยกำหนด' : r.kind === 'orphan' ? 'ยกเลิกหลังตรวจ' : 'รอรับ');
/** The check in the file: as on screen; changed says so; a line cancelled after its check is not counted. */
export function checkWord(r: ChkRow): string {
  if (r.kind === 'orphan') return `${QT_WORD[r.state as PaySt] || ''} · ยกเลิกหลังตรวจ ไม่นับในยอด`;
  if (r.kind !== 'got') return '';
  if (r.state === 'none') return 'ก่อนเริ่มตรวจ';
  if (r.state === 'changed') return 'รอตรวจ (เปลี่ยนหลังตรวจ)';
  return QT_WORD[r.state];
}
const dateCell = (iso: string): XCell => (iso ? { date: iso } : null);
/** The lines of the file's sheet รายการ, in its order: the money (received, and with `owed` the money
 *  still to come and late) as on screen, then the lines cancelled after their check (not in any total). */
export const sheetLines = (rows: ChkRow[], owed: boolean) => [
  ...rows.filter((r) => r.kind === 'got' || (owed && (r.kind === 'late' || r.kind === 'owed'))),
  ...rows.filter((r) => r.kind === 'orphan'),
];
/** The closed month in the file's ปิดเดือน column: "ปิดแล้ว", and what changed after it. */
const closeWord = (m: Pick<MonthRow, 'state' | 'drift'>) => (m.state === 'closed' ? 'ปิดแล้ว' + (m.drift?.flagged ? ' · ' + driftWords(m.drift) : '') : 'ยังไม่ปิด');
/**
 * The file "ตรวจรับเงิน_2569-10.xlsx": sheet รายการ, one row per line (sheetLines: received ones, with `owed`
 * the money still to come and late, then the lines cancelled after their check, as checked and marked not
 * counted), with its check; sheet สรุป, the months' figures and checks (the year's total row too when there
 * is more than one month). Amounts are numbers, dates real dates. `filter`: the page's filter in words
 * when one is set; the summary then says so under its rows (a month's file that leaves out other people's
 * money says it does).
 */
export function chkSheets(s: SalesState, rows: ChkRow[], months: MonthRow[], owed: boolean, filter = ''): XSheet[] {
  const ls = sheetLines(rows, owed);
  const head = ['เดือน', 'ลูกค้า', 'เลขใบเสนอราคา', 'งวด', 'ยอด (บาท)', 'ฐานยอด', 'วันที่รับ', 'ครบกำหนด', 'สถานะเงิน', 'วิธีชำระ', 'หลักฐาน', 'บันทึกโดย', 'บัญชีตรวจ', 'ผู้ตรวจ', 'วันที่ตรวจ', 'ข้อความส่งกลับแก้ไข'];
  const orphan = (r: ChkRow): XCell[] => {
    const rec = r.rec!, inst = instOf(r, s);
    return [
      ymTh(r.ym, true), r.deal ? r.deal.client : 'งานที่ถูกลบ', r.deal ? dealMoney(s, r.deal).fcDoc?.docNo || '' : '', `${inst.text} (${inst.sub})`,
      r.amt, 'ยอดตอนตรวจ', dateCell(rec.d), null, moneyWord(r), '', '', '',
      checkWord(r) + (r.to ? ' · ' + movedWords(r.to, rec) : ''), rec.by, dateCell(localDay(rec.at)), rec.s === 'back' ? rec.note || '' : '',
    ];
  };
  const line = (r: ChkRow): XCell[] => {
    if (r.kind === 'orphan') return orphan(r);
    const l = r.line!, d = r.deal!;
    const pl = l.src === 'plan' ? (s.pays || {})[`${d.id}/${l.stage}`] : undefined;
    const held = r.state === 'ok' || r.state === 'back';
    return [
      ymTh(r.ym, true), l.joint ? `${d.client} (${jointWords(l.joint)})` : d.client, dealMoney(s, d).fcDoc?.docNo || '', instText(l) + (l.src === 'plan' ? ` (${l.code || l.stage})` : ''),
      r.amt, basisWord(r), dateCell(l.rcv), dateCell(l.due), moneyWord(r), pl?.how ? HOW_TH[pl.how] : '',
      r.kind === 'got' ? (r.docs.length ? r.docs.map(docWord).join(', ') : 'ไม่มีไฟล์') : '', r.by.join(', '),
      checkWord(r), held ? r.rec!.by : '', held ? dateCell(localDay(r.rec!.at)) : null, r.state === 'back' ? r.rec!.note || '' : '',
    ];
  };
  const sumHead = ['เดือน', 'เข้าแล้ว (บาท)', 'รอรับ (บาท)', 'เลยกำหนด (บาท)', 'รวม (บาท)', 'รายการเข้าแล้ว', 'บัญชีตรวจแล้ว (รายการ)', 'บัญชีตรวจแล้ว (บาท)', 'รอตรวจ (รายการ)', 'ส่งกลับแก้ไข (รายการ)', 'ยกเลิกหลังตรวจ (รายการ)', 'ปิดเดือน', 'ปิดโดย', 'วันที่ปิด'];
  const sumLine = (label: string, c: ChkSum, m: MonthRow | null): XCell[] => [
    label, c.got, c.owed, c.late, sumTotal(c), c.gotN, c.ok, c.okAmt, c.wait + c.changed, c.back, c.orphans,
    m ? closeWord(m) : '', m?.close?.by || '', m?.close ? dateCell(localDay(m.close.at)) : null,
  ];
  const sums = months.map((m) => sumLine(ymTh(m.ym), m.sum, m));
  if (months.length > 1) {
    const all = sumRows(rows.filter((r) => months.some((m) => m.ym === r.ym)));
    sums.push(sumLine('รวมปี ' + (+months[0].ym.slice(0, 4) + 543), all, null));
  }
  // the close columns are the whole month's; the figures are the filter's
  if (filter) sums.push([], ['ตัวกรอง', `เฉพาะ ${filter} · คอลัมน์ปิดเดือนเป็นของทั้งเดือน`]);
  return [
    { name: 'รายการ', head, rows: ls.map(line), widths: [11, 34, 16, 14, 14, 16, 12, 12, 14, 10, 24, 14, 30, 10, 12, 40] },
    { name: 'สรุป', head: sumHead, rows: sums, widths: [16, 14, 14, 14, 14, 12, 18, 18, 14, 16, 18, 26, 10, 12] },
  ];
}
/** The Excel dialog's preview of sheet รายการ (screen 17): its first `n` lines in 8 short columns that fit
 *  the dialog (the client's short name, the installment without its stage, the check in one word, who
 *  checked it and when). */
export const PREVIEW_HEAD = ['ลูกค้า', 'เลขใบเสนอราคา', 'งวด', 'ยอด (บาท)', 'วันที่รับ', 'สถานะเงิน', 'บัญชีตรวจ', 'ผู้ตรวจ'];
export function sheetPreview(s: SalesState, rows: ChkRow[], owed: boolean, n = 4, short: (client: string) => string = (x) => x): string[][] {
  return sheetLines(rows, owed).slice(0, n).map((r) => {
    const rec = r.kind === 'orphan' || r.state === 'ok' || r.state === 'back' ? r.rec : null;
    const chk = r.kind === 'orphan' ? 'ยกเลิกหลังตรวจ' : r.kind !== 'got' ? '' : r.state === 'none' ? 'ก่อนเริ่มตรวจ' : QT_WORD[r.state === 'changed' ? 'wait' : r.state];
    return [
      r.deal ? short(r.deal.client) : 'งานที่ถูกลบ', r.deal ? dealMoney(s, r.deal).fcDoc?.docNo || '' : '', r.line ? instText(r.line) : instOf(r, s).text, fmtMoney(r.amt) || '0',
      r.kind === 'got' || r.kind === 'orphan' ? r.date : '', moneyWord(r), chk, rec ? `${rec.by} ${localDay(rec.at)}`.trim() : '',
    ];
  });
}
/** "ตรวจรับเงิน_2569-10.xlsx" for a month, "ตรวจรับเงิน_2569.xlsx" for a year. */
export const chkFileName = (ym: string | null, ceYear: number) => (ym ? `ตรวจรับเงิน_${+ym.slice(0, 4) + 543}-${ym.slice(5, 7)}.xlsx` : `ตรวจรับเงิน_${ceYear + 543}.xlsx`);
