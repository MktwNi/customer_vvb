/**
 * Job expenses in the money views ("เงินออก", the follow-up of lib/expense.ts): the Cashflow tab's money out,
 * the Dashboard's card "ค่าใช้จ่ายและคงเหลือ" and the accounting month check's out side. Pure (no DOM), so it
 * is unit-tested; the screens only draw what this returns.
 *
 * - A paid expense counts in the period of its PAID date; an unpaid one is "ค้างจ่าย", shown by its bill
 *   date but never in a paid total. Amounts as on the bill (VAT included), Buddhist-era years, calendar
 *   quarters, as the money in (plan.md §1).
 * - Remaining money ("คงเหลือ") of a period = money received in it (sales cashLines, on the day it came in)
 *   − expenses paid in it. Each expense is one record, so it is counted once wherever it was recorded.
 * - A joint quotation: an expense may be recorded on its header (the payer's row) or on a member company's
 *   row. A member's is that company's own; a header's is the quotation's, split to its companies the way its
 *   income is (sales jointParts): under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter a list holds the part of the
 *   companies it lists, and by unit each company's part goes through its own สัดส่วนรายได้ (contrib lineParts).
 * - Everything here reads SalesState.exp / xchk / mcloseOut, which only an account with ดูค่าใช้จ่ายและกำไรของงาน
 *   holds (the team script sends none of it to anyone else); the screens also hide every part of it then.
 * - The month check of a paid expense is the income check's record (`dchk/<dealId>/exp.<expId>`, SalesState.xchk
 *   under '<dealId>/<expId>'): its fingerprint is { amt, d = the paid date, f = the bill's file id }; the rows
 *   are lib/payCheck's ChkRow (a paid expense as a received line, an unpaid one as money still owed), so the
 *   check's states, chips, sums, closing and year table are the same code and the same words as the income's.
 */
import {
  LIST_KEYS, beOf, filterDeals, fmtMoney, holdPart, jointAttr, jointHeadOf, jointOf, jointParts, jointRole, moneyOwners, normSalesFilter,
  type CashLine, type CashSum, type CashYear, type Deal, type JointGroup, type SalesFilterIn, type SalesState,
} from './sales';
import type { ExpFile, JobExp } from './expense';
import { lineParts, unitsOf, contribIn, type UnitCtx } from './contrib';
import { inRange, type Range } from './dateRange';
import { TH_M, dmTh, isoTh, localDay } from './format';
import { Q_TH } from './cashUi';
import { sameName } from './caps';
import { svcText } from './jobs';
/** The services a job's line is sold under, for the บริการ column: the caller passes lib/sales.ts jobServices (a
 *  joint quotation's company under its quotation's, as the screens and the Cashflow export say); else its own. */
type SvcOf = (d: Deal) => readonly string[];
const ownSvc: SvcOf = (d) => d.service;
import {
  fpDiff, sameFp, splitKey, sumRows, ymTh,
  type ChkRow, type ChkState, type ChkSum, type FpDiff, type MonthClose, type MonthRow, type PayCheck, type PayFp, type PaySt,
} from './payCheck';
import { QT_WORD, type BellRow } from './notify';
import type { XCell, XSheet } from './xlsx';

const r2 = (n: number) => Math.round(n * 100) / 100;
/** The word for an expense without a category. */
export const NO_CAT = 'ไม่ระบุหมวด';

// ------------------------------------------------------------------ the lines

/** One expense as the money views count it. */
export interface ExpLine {
  /** '<dealId>/<expId>': its key in SalesState.exp, and its month check's in xchk */
  id: string;
  deal: Deal;
  expId: string;
  /** the category as typed ('' none) and the description */
  c: string;
  n: string;
  /** the amount counted: the whole bill, or under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter the part of a joint
   *  quotation header's expense its listed companies hold (expView) */
  amt: number;
  /** the bill's amount as recorded */
  full: number;
  kind: 'paid' | 'unpaid';
  /** the paid date (paid), else the bill's date ('' none: in no month) */
  date: string;
  bill: string;
  paid: string;
  file: ExpFile | null;
  /** who recorded it last and when (the team script sets both) */
  by: string;
  at: string;
  /** the deal's own Buddhist-era year */
  dealYear: string;
  /** recorded on a joint quotation: on its header (the quotation's own expense, split to its companies) or
   *  on a member company's row (that company's); `head` the header's id; `part` / `keep` as CashLine.joint */
  joint?: { role: 'header' | 'member'; members: number; title: string; head: string; part?: number; keep?: string[] };
}

/** An expense record as a line (null when its deal is gone). */
function lineOf(s: SalesState, id: string, e: JobExp, groups: Map<string, JointGroup | null>): ExpLine | null {
  const j = id.indexOf('/');
  const dealId = id.slice(0, j), expId = id.slice(j + 1);
  const deal = s.deals[dealId];
  if (!deal || j <= 0 || !expId) return null;
  const paid = e.paid || '';
  const x: ExpLine = {
    id, deal, expId, c: e.c || '', n: e.n || '', amt: e.amt, full: e.amt, kind: paid ? 'paid' : 'unpaid', date: paid || e.d || '', bill: e.d || '', paid,
    file: e.file || null, by: e.by || '', at: e.at || '', dealYear: deal.year,
  };
  const role = jointRole(s, deal);
  if (role !== 'plain') {
    const hid = role === 'header' ? deal.id : jointHeadOf(s, deal.id);
    if (!groups.has(hid)) groups.set(hid, jointOf(s, { id: hid }));
    const g = groups.get(hid);
    if (g) x.joint = { role, members: g.members.length, title: g.qt.title, head: hid };
  }
  return x;
}
/** Soonest first (paid on the paid date, unpaid on the bill date), undated last, then the client, then the id. */
const order = (a: ExpLine, b: ExpLine) =>
  (!a.date ? 1 : 0) - (!b.date ? 1 : 0) || a.date.localeCompare(b.date) || a.deal.client.localeCompare(b.deal.client, 'th') || a.id.localeCompare(b.id);
/**
 * Every expense of these deals (every deal's when left out), whatever the deal's year or result: money that
 * went out for a job went out, won or not. An expense whose deal is gone is not counted.
 */
export function expLines(s: SalesState, deals?: Iterable<Deal>): ExpLine[] {
  const only = deals ? new Set([...deals].map((d) => d.id)) : null;
  const groups = new Map<string, JointGroup | null>();
  const out: ExpLine[] = [];
  for (const [id, e] of Object.entries(s.exp || {})) {
    if (only && !only.has(id.slice(0, id.indexOf('/')))) continue;
    const x = lineOf(s, id, e, groups);
    if (x) out.push(x);
  }
  return out.sort(order);
}

/** How a filter holds an expense: its whole amount, the part of a joint quotation header's, or not at all. */
type Keep = (deal: Deal | null, amt: number) => { amt: number; part?: number; keep?: string[] } | null;
/**
 * A page's filter (ผู้รับผิดชอบ, SOURCE, บริการ, REFERRAL, หมวด, หน่วยงาน; the year, dates and การรับเงิน are the
 * period's, not the deals') as a keeper, null when none is set. The deals are filtered over every year (an
 * expense paid this year may be a job of last year's). A joint quotation header's expense under a ผู้รับผิดชอบ /
 * SOURCE / REFERRAL filter: the part of the companies the filter lists (sales holdPart), as its income.
 */
function keeper(s: SalesState, F: SalesFilterIn, today: string): Keep | null {
  const f = normSalesFilter(F);
  if (!LIST_KEYS.some((k) => f[k]) && !f.q && !f.job && !f.result && !f.quick) return null;
  const ids = new Set<string>();
  const base = { ...f, date: null, pay: undefined, money: undefined };
  new Set(Object.values(s.deals).map((d) => d.year)).forEach((y) => filterDeals(s, { ...base, year: y }, today).forEach((d) => ids.add(d.id)));
  const attr = jointAttr(f);
  return (deal, amt) => {
    if (!deal) return null;
    const g = attr && s.jqt?.[deal.id] ? jointOf(s, deal) : null;
    if (!g || !g.members.length) return ids.has(deal.id) ? { amt } : null;
    const keep = g.members.map((x, i) => (ids.has(x.deal.id) ? i : -1)).filter((i) => i >= 0);
    if (keep.length === g.members.length) return { amt };
    const w = jointParts(s, g), kept = keep.filter((i) => w[i] > 0);
    const part = kept.length ? holdPart(s, { d: g.head, g, keep }, amt) : 0;
    return part ? { amt: part, part: kept.length, keep: kept.map((i) => g.members[i].deal.id) } : null;
  };
}
/** The lines a page holds through its filter (all of `lines` without one). */
export function expView(s: SalesState, F: SalesFilterIn, today: string, lines = expLines(s)): ExpLine[] {
  const k = keeper(s, F, today);
  if (!k) return lines;
  const out: ExpLine[] = [];
  for (const x of lines) {
    const h = k(x.deal, x.full);
    if (!h) continue;
    out.push(h.keep ? { ...x, amt: h.amt, joint: { ...x.joint!, part: h.part, keep: h.keep } } : x);
  }
  return out;
}

// ------------------------------------------------------------------ by period

/** Money out of a month, quarter or year: paid in it (on the paid date) and still unpaid (on the bill date). */
export interface ExpSum { paid: number; paidN: number; unpaid: number; unpaidN: number }
const xs0 = (): ExpSum => ({ paid: 0, paidN: 0, unpaid: 0, unpaidN: 0 });
const addX = (c: ExpSum, x: ExpLine) => {
  if (x.kind === 'paid') {
    c.paid = r2(c.paid + x.amt);
    c.paidN++;
  } else {
    c.unpaid = r2(c.unpaid + x.amt);
    c.unpaidN++;
  }
};
/**
 * One Buddhist-era year of money out: its dated lines, by month and quarter, its totals, and the unpaid
 * bills of the year's jobs that have no date (in no month, as "ยังไม่กำหนดวันรับ" for money in).
 */
export function expYear(lines: ExpLine[], be: string) {
  const months = Array.from({ length: 12 }, xs0), totals = xs0();
  const dated = lines.filter((x) => x.date && beOf(x.date) === be);
  dated.forEach((x) => {
    addX(months[+x.date.slice(5, 7) - 1], x);
    addX(totals, x);
  });
  const quarters = [0, 1, 2, 3].map((q) => months.slice(q * 3, q * 3 + 3).reduce((a, m) => ({ paid: r2(a.paid + m.paid), paidN: a.paidN + m.paidN, unpaid: r2(a.unpaid + m.unpaid), unpaidN: a.unpaidN + m.unpaidN }), xs0()));
  return { months, quarters, totals, lines: dated, undated: lines.filter((x) => !x.date && x.dealYear === be) };
}
export type ExpYear = ReturnType<typeof expYear>;
/** Money out inside a range: paid on the paid date, unpaid on the bill date; `deals` the jobs paid for. */
export function expIn(lines: ExpLine[], r: Range): ExpSum & { deals: number } {
  const c = xs0(), deals = new Set<string>();
  lines.forEach((x) => {
    if (!inRange(x.date, r)) return;
    addX(c, x);
    if (x.kind === 'paid') deals.add(x.deal.id);
  });
  return { ...c, deals: deals.size };
}

/** What is left of the money received once the paid expenses are taken off, and how much of it that is (%,
 *  whole; null when nothing was received). */
export function netOf(got: number, paid: number): { net: number; pct: number | null } {
  return { net: r2(got - paid), pct: got > 0 ? Math.round(((got - paid) / got) * 100) : null };
}
/** "65%" ('—' when nothing was received). */
export const pctWord = (p: number | null) => (p == null ? '—' : `${p}%`);
/**
 * The bar under คงเหลือสุทธิ: the paid expenses' share of the money received and what is left, from the one
 * rounded figure the card prints (left = netOf's pct, the expenses' share 100 − it), so the two never read
 * 65% beside 64%; `exW` / `leftW` the bar's parts (0–100: spending more than came in fills it with the
 * expenses). null when nothing was received.
 */
export function netSplit(got: number, paid: number): { ex: number; left: number; exW: number; leftW: number } | null {
  const { pct } = netOf(got, paid);
  if (pct == null) return null;
  const w = (n: number) => Math.min(100, Math.max(0, n));
  return { ex: 100 - pct, left: pct, exW: w(100 - pct), leftW: w(pct) };
}

/** A period's money in and out side by side: received, paid out, still unpaid, and what is left. */
export interface NetRow { got: number; paid: number; unpaid: number; net: number; pct: number | null }
const netRow = (got: number, x: ExpSum): NetRow => ({ got: r2(got), paid: x.paid, unpaid: x.unpaid, ...netOf(got, x.paid) });
/** The four calendar quarters and the year: the Cashflow year's received money against the expenses' year. */
export function netQuarters(Y: Pick<CashYear, 'quarters' | 'totals'>, X: Pick<ExpYear, 'quarters' | 'totals'>): { q: NetRow[]; year: NetRow } {
  return { q: Y.quarters.map((c, i) => netRow(c.got, X.quarters[i])), year: netRow(Y.totals.got, X.totals) };
}
/** The same by month (the CSV's summary, the month check's figures). */
export const netMonths = (Y: Pick<CashYear, 'months'>, X: Pick<ExpYear, 'months'>): NetRow[] => Y.months.map((c, i) => netRow(c.got, X.months[i]));

/** The Cashflow cards of a year's money out: paid (how many, the latest day), unpaid, and what is left of
 *  the received money (`got`: the year's received, the card รับแล้ว). */
export interface ExpKpis extends ExpSum { lastPaid: string; net: number; pct: number | null; got: number; deals: number }
export function expKpis(X: ExpYear, got: number): ExpKpis {
  const paid = X.lines.filter((x) => x.kind === 'paid');
  return {
    ...X.totals,
    lastPaid: paid.reduce((a, x) => (x.date > a ? x.date : a), ''),
    got: r2(got),
    deals: new Set(paid.map((x) => x.deal.id)).size,
    ...netOf(got, X.totals.paid),
  };
}

// ------------------------------------------------------------------ by category, deal, person, unit

/** A category's key: the words as typed, whatever the spacing or case ("ค่า TGO" = "ค่า tgo"). */
export const catKey = (c: string) => c.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
/** Paid expenses in a range by category, the largest first: the category as most of its lines spell it,
 *  the amount, how many and its share of the paid total (%, one decimal). An empty one is NO_CAT. */
export interface CatRow { key: string; c: string; amt: number; n: number; pct: number }
export function expByCat(lines: ExpLine[], r?: Range | null): CatRow[] {
  const by = new Map<string, { amt: number; n: number; spell: Map<string, number> }>();
  let tot = 0;
  for (const x of lines) {
    if (x.kind !== 'paid' || (r && !inRange(x.date, r))) continue;
    const k = catKey(x.c);
    const m = by.get(k) || (by.set(k, { amt: 0, n: 0, spell: new Map() }), by.get(k)!);
    m.amt = r2(m.amt + x.amt);
    m.n++;
    m.spell.set(x.c.trim(), (m.spell.get(x.c.trim()) || 0) + 1);
    tot += x.amt;
  }
  return [...by]
    .map(([key, m]) => ({ key, c: [...m.spell].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'))[0][0] || NO_CAT, amt: m.amt, n: m.n, pct: tot ? Math.round((m.amt / tot) * 1000) / 10 : 0 }))
    .sort((a, b) => b.amt - a.amt || a.c.localeCompare(b.c, 'th'));
}
/** The top `n` categories and the rest summed as "อื่นๆ" (so the shares still add up). */
export function topCats(rows: CatRow[], n = 5): CatRow[] {
  if (rows.length <= n) return rows;
  const rest = rows.slice(n - 1);
  const amt = r2(rest.reduce((a, x) => a + x.amt, 0));
  return [...rows.slice(0, n - 1), { key: '\u0000rest', c: `อื่นๆ ${rest.length} หมวด`, amt, n: rest.reduce((a, x) => a + x.n, 0), pct: Math.round(rest.reduce((a, x) => a + x.pct, 0) * 10) / 10 }];
}
/** Paid and unpaid by the deal each expense is recorded on (a joint quotation's header and members apart). */
export function expByDeal(lines: ExpLine[]): Map<string, ExpSum> {
  const m = new Map<string, ExpSum>();
  lines.forEach((x) => addX(m.get(x.deal.id) || (m.set(x.deal.id, xs0()), m.get(x.deal.id)!), x));
  return m;
}
/**
 * Whose an expense is in per-person summaries (ผู้รับผิดชอบ): a plain deal's or a member company's own; a joint
 * quotation header's apportioned to its companies by their parts, as its income (sales moneyOwners; only the
 * companies a filtered line keeps).
 */
export function expOwners(s: SalesState, x: ExpLine): { deal: Deal; amt: number }[] {
  if (x.joint?.role !== 'header') return [{ deal: x.deal, amt: x.amt }];
  const o = moneyOwners(s, x.deal, x.full);
  if (!x.joint.keep) return o;
  // the kept companies' parts (they add up to the line's amount)
  return o.filter((p) => x.joint!.keep!.includes(p.deal.id));
}
/** Paid expenses in a range by ผู้รับผิดชอบ ('' none). */
export function expByPerson(s: SalesState, lines: ExpLine[], r?: Range | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of lines) {
    if (x.kind !== 'paid' || (r && !inRange(x.date, r))) continue;
    expOwners(s, x).forEach((o) => {
      const k = (o.deal.resp || '').trim();
      m.set(k, r2((m.get(k) || 0) + o.amt));
    });
  }
  return m;
}
/** An expense as lib/contrib reads a line of money (lineParts: the deal, the joint companies kept, the day, the amount). */
export function asCashLine(x: ExpLine): CashLine {
  const joint = x.joint?.role === 'header' ? { members: x.joint.members, title: x.joint.title, ...(x.joint.keep ? { part: x.joint.part, keep: x.joint.keep } : {}) } : undefined;
  return {
    id: 'exp:' + x.id, deal: x.deal, ...(joint ? { joint } : {}), stage: '', code: '', n: 0, of: 0, amt: x.amt, kind: 'got', date: x.date, due: '', rcv: x.date,
    status: 'paid', lateDays: 0, dealYear: x.dealYear, src: 'typed', doc: null,
  };
}
/** Paid expenses in a range by unit ('' = ยังไม่ระบุหน่วยงาน): each through its job's สัดส่วนรายได้ on the day it
 *  was paid, the same split as the job's income (a joint quotation header's to its companies first). */
export function expByUnit(ctx: UnitCtx, lines: ExpLine[], r: Range): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of lines) {
    if (x.kind !== 'paid' || !inRange(x.date, r)) continue;
    lineParts(ctx, asCashLine(x)).forEach((p) => (out[p.u] = r2((out[p.u] || 0) + p.amt)));
  }
  return out;
}
/** A unit's money in a range: received (contrib), paid out, and what is left. */
export interface UnitNet extends NetRow { u: string; n: string }
/** The units with money in or out in the range, in their order (retired ones only with money), then
 *  ยังไม่ระบุหน่วยงาน when it has any. Their figures add up to the range's received and paid totals. */
export function unitNets(ctx: UnitCtx, cash: CashLine[], exp: ExpLine[], r: Range): UnitNet[] {
  const got = contribIn(ctx, cash, r).by, paid = expByUnit(ctx, exp, r);
  const row = (u: string, n: string): UnitNet => ({ u, n, ...netRow(got[u]?.got || 0, { paid: paid[u] || 0, paidN: 0, unpaid: 0, unpaidN: 0 }) });
  const out = unitsOf(ctx, true).filter((u) => (got[u.id]?.got || 0) > 0 || (paid[u.id] || 0) > 0).map((u) => row(u.id, u.n));
  if ((got['']?.got || 0) > 0 || (paid[''] || 0) > 0) out.push(row('', 'ยังไม่ระบุหน่วยงาน'));
  return out;
}

// ------------------------------------------------------------------ the month check of money out

/** A row of the month check's out side: lib/payCheck's row (a paid expense is a received line, an unpaid
 *  bill money still owed, a check whose expense is gone or unpaid now an orphan) and its expense (null: an
 *  orphan whose expense was deleted). */
export type XRow = ChkRow & { x: ExpLine | null };
/** What a check of a paid expense is about: the amount, the paid date and the bill's file. */
export const expFp = (x: Pick<ExpLine, 'full' | 'paid' | 'file'>): PayFp => ({ amt: r2(x.full), d: x.paid, f: x.file?.id || '' });
/** Who recorded the expense (whom the self-check stops): its last writer. */
export const expRecorders = (x: Pick<ExpLine, 'by'>) => (x.by.trim() ? [x.by.trim()] : []);
/**
 * Every dated expense as the out side lists it, with the orphans: paid ones with their check (none before
 * the first month checked), unpaid ones on their bill date, and checks no paid expense holds any more
 * ("ยกเลิกหลังตรวจ": the expense deleted or marked unpaid), soonest first. `lines` must be every deal's
 * expenses at their whole amounts (expLines(s)): a check is an orphan only when no expense holds it.
 */
export function expChkRows(s: SalesState, lines: ExpLine[], checks: Record<string, PayCheck>, since: string): XRow[] {
  const out: XRow[] = [];
  const held = new Set<string>();
  const byId = new Map(lines.map((x) => [x.id, x]));
  const base = { docs: [], line: null, to: null };
  for (const x of lines) {
    if (!x.date) continue;
    const ym = x.date.slice(0, 7);
    if (x.kind === 'unpaid') {
      out.push({ ...base, key: 'owed:' + x.id, kind: 'owed', dealId: x.deal.id, deal: x.deal, lineId: 'exp.' + x.expId, amt: x.full, date: x.date, ym, state: 'none', rec: null, fp: null, diff: null, by: expRecorders(x), x });
      continue;
    }
    held.add(x.id);
    const fp = expFp(x), r = checks[x.id] || null;
    let state: ChkState = 'wait', diff: FpDiff | null = null;
    if (x.date < since) state = 'none';
    else if (r && sameFp(r, fp)) state = r.s;
    else if (r) {
      state = 'changed';
      diff = fpDiff(r, fp);
    }
    out.push({ ...base, key: x.id, kind: 'got', dealId: x.deal.id, deal: x.deal, lineId: 'exp.' + x.expId, amt: x.full, date: x.date, ym, state, rec: state === 'none' ? null : r, fp, diff, by: expRecorders(x), x });
  }
  for (const [key, r] of Object.entries(checks)) {
    if (held.has(key) || !r.d || r.d < since) continue;
    const { dealId, lineId } = splitKey(key);
    const x = byId.get(key) || null;
    out.push({ ...base, key, kind: 'orphan', dealId, deal: s.deals[dealId] || null, lineId: 'exp.' + lineId, amt: r.amt ?? 0, date: r.d, ym: r.d.slice(0, 7), state: r.s, rec: r, fp: null, diff: null, by: x ? expRecorders(x) : [], x });
  }
  const name = (r: XRow) => r.deal?.client || '';
  return out.sort((a, b) => a.date.localeCompare(b.date) || name(a).localeCompare(name(b), 'th') || a.key.localeCompare(b.key));
}
/** The out side's rows through the page's filter: a row as the page shows it (a joint quotation header's
 *  expense as the part of the listed companies; its check stays the whole bill's), or null. */
export type XView = (r: XRow) => XRow | null;
export function expPageKeep(s: SalesState, F: SalesFilterIn, today: string): XView | null {
  const k = keeper(s, F, today);
  if (!k) return null;
  return (r) => {
    const h = k(r.deal, r.amt);
    if (!h) return null;
    if (!h.keep) return r;
    const x = r.x && { ...r.x, amt: h.amt, joint: { ...r.x.joint!, part: h.part, keep: h.keep } };
    return { ...r, amt: h.amt, x };
  };
}
/** The three sets of the out side's rows (as payCheck cashCheckRows): `rows` the shown year through the
 *  filter, `wide` the filter over every year, `team` every row (closing a month covers the whole month). */
export function expCheckRows(all: XRow[], ceYear: number, keep: XView | null) {
  const wide = keep ? all.map(keep).filter((r): r is XRow => !!r) : all;
  return { rows: wide.filter((r) => r.ym.startsWith(ceYear + '-')), wide, team: all };
}
/** One month of every deal's paid expenses, as closing its out side counts them (the engine works it out
 *  itself rather than trusting a screen's filtered view). */
export function expTeamMonth(s: SalesState, checks: Record<string, PayCheck>, since: string, ym: string): ChkSum {
  return sumRows(expChkRows(s, expLines(s), checks, since).filter((r) => r.ym === ym));
}

/**
 * Bills of earlier months still unpaid, the years before included (as the income side's carriedLate): the
 * month figure's "ค้างจากเดือนก่อน", with how many fall in each Buddhist-era year (oldest first), so the
 * link opens the shown year and each other year has its own. `rows` must reach back before the shown year
 * (the filter over every year).
 */
export function carriedOwed(rows: XRow[], ym: string): { n: number; amt: number; years: { be: string; n: number; amt: number }[] } {
  const by = new Map<string, { n: number; amt: number }>();
  let n = 0, amt = 0;
  for (const r of rows) {
    if (r.kind !== 'owed' || r.ym >= ym) continue;
    const be = String(+r.ym.slice(0, 4) + 543), y = by.get(be) || (by.set(be, { n: 0, amt: 0 }), by.get(be)!);
    y.n++;
    y.amt = r2(y.amt + r.amt);
    n++;
    amt = r2(amt + r.amt);
  }
  return { n, amt, years: [...by].sort(([a], [b]) => a.localeCompare(b)).map(([be, y]) => ({ be, ...y })) };
}

/** The out side's filter chips: ทั้งหมด · รอตรวจ · ตรวจแล้ว · ส่งกลับแก้ไข · ค้างจ่าย (payCheck chkMatch reads them;
 *  'owed' is an unpaid bill here). */
export type XChkF = 'all' | 'wait' | 'ok' | 'back' | 'owed';
export const X_CHK_F: { id: XChkF; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'wait', label: 'รอตรวจ' },
  { id: 'ok', label: 'ตรวจแล้ว' },
  { id: 'back', label: 'ส่งกลับแก้ไข' },
  { id: 'owed', label: 'ค้างจ่าย' },
];
export const isXChkF = (v: unknown): v is XChkF => X_CHK_F.some((f) => f.id === v);

/** The expense in a few words (history rows, dialogs): its category, else its description, else "ค่าใช้จ่าย". */
export const expWhat = (x: { c?: string; n?: string } | null | undefined) => (x?.c || x?.n || 'ค่าใช้จ่าย').slice(0, 60);
/** The row's expense in a few words; an orphan whose expense was deleted: "รายการที่ลบแล้ว". */
export const rowWhat = (r: Pick<XRow, 'x'>) => (r.x ? expWhat(r.x) : 'รายการที่ลบแล้ว');
/** The bill in words: "บิล ใบเสร็จ.pdf" or "ไม่มีไฟล์". */
export const billWord = (x: Pick<ExpLine, 'file'> | null | undefined) => (x?.file ? 'บิล ' + x.file.name : 'ไม่มีไฟล์');

/** "วันที่จ่ายจาก 3 ต.ค. 2569 เป็น 5 ต.ค. 2569 · ยอดจาก 25,000 เป็น 26,750 บาท · เปลี่ยนไฟล์บิล". */
export function expChangeWords(r: Pick<XRow, 'diff'>): string {
  const d = r.diff;
  if (!d) return '';
  const bill = d.add.length && d.rm.length ? 'เปลี่ยนไฟล์บิล' : d.add.length ? 'แนบบิล' : d.rm.length ? 'เอาบิลออก' : '';
  return [
    d.d ? `วันที่จ่ายจาก ${isoTh(d.d[0])} เป็น ${isoTh(d.d[1])}` : '',
    d.amt ? `ยอดจาก ${fmtMoney(d.amt[0])} เป็น ${fmtMoney(d.amt[1])} บาท` : '',
    bill,
  ].filter(Boolean).join(' · ');
}
const dayOf = (iso: string) => dmTh(localDay(iso || '')) || '—';
/** The note under a row of the out side: what to fix (sent back), what changed after the check, or that it
 *  no longer counts as money out. `to`: whom a returned expense goes to. null: nothing to say. */
export function expNoteOf(r: XRow): { head: string; body: string; to: string } | null {
  const rec = r.rec;
  if (!rec) return null;
  const who = rec.by || 'บัญชี', when = dayOf(rec.at), amt = rec.amt != null ? ` ที่ยอด ${fmtMoney(rec.amt)} บาท` : '';
  const did = `${who} ${rec.s === 'back' ? 'ส่งกลับแก้ไขไว้' : 'ตรวจไว้'}เมื่อ ${when}${amt}`;
  if (r.kind === 'orphan') {
    const why = r.x ? ` · ตอนนี้ยังไม่ได้จ่าย${r.x.by ? ` (${r.x.by} แก้เมื่อ ${dayOf(r.x.at)})` : ''}` : r.deal ? ' · ลบรายการนี้แล้ว' : ' · งานนี้ถูกลบแล้ว';
    return { head: 'ยกเลิกหลังตรวจ' + why, body: `${did} จ่าย ${isoTh(rec.d)} · ตอนนี้ไม่ได้นับเป็นเงินออกแล้ว`, to: '' };
  }
  if (r.state === 'back') {
    const to = r.by[0] || r.deal?.resp || '';
    return { head: `สิ่งที่ต้องแก้ จาก ${who} · ${when}${to ? ' · ส่งถึง ' + to : ''}`, body: rec.note || '', to };
  }
  if (r.state === 'changed') {
    const x = r.x;
    return {
      head: 'เปลี่ยนหลังตรวจ' + (x?.by ? ` · ${x.by} แก้เมื่อ ${dayOf(x.at)}` : ''),
      body: [expChangeWords(r), did + (r.diff && !r.diff.amt ? ' ยอดไม่เปลี่ยน' : '')].filter(Boolean).join(' · '),
      to: '',
    };
  }
  return null;
}
/** A deal's paid expenses with their check (and its checks whose expense is gone): the deal card's chips. */
export function dealExpChecks(s: SalesState, dealId: string, checks: Record<string, PayCheck>, since: string): XRow[] {
  const d = s.deals[dealId];
  const mine = Object.fromEntries(Object.entries(checks).filter(([k]) => k.startsWith(dealId + '/')));
  return expChkRows(s, d ? expLines(s, [d]) : [], mine, since).filter((r) => r.kind === 'got' || r.kind === 'orphan');
}
/**
 * What a change made where the job is worked on (the deal card, the expense dialog) does to the month check
 * of money out, for the question asked before it (as askPay for money in): `before` the expense's row on the
 * out side (dealExpChecks; none: a new expense or one not paid yet), `next` its money once changed (the
 * amount, the paid date '' = not paid, the bill's file id; null = deleted), the out side's closed months and
 * the first day checked. null when there is nothing to say: only a change to the amount, the paid date or the
 * bill of a paid expense accounting checked or sent back, or money that leaves or lands in a closed month,
 * asks. `head` says what the expense is now, `body` what happens to its check.
 */
export function expGuard(before: XRow | null | undefined, next: PayFp | null, closes: Record<string, MonthClose>, since: string, verb = 'แก้'): { head: string; body: string } | null {
  const closed = (ym: string) => {
    const c = closes[ym];
    return c ? `เดือน${ymTh(ym)} ปิดเงินออกแล้ว (${c.by || 'บัญชี'} ${dayOf(c.at)})` : '';
  };
  const paid = before && before.kind === 'got' && before.state !== 'none' && before.fp ? before : null;
  if (!paid) {
    // a new or not yet paid expense paid in a closed month: that month has a line to check again
    if (!next?.d || next.d < since || !closes[next.d.slice(0, 7)]) return null;
    const ym = next.d.slice(0, 7);
    return { head: `${fmtMoney(next.amt) || '0'} บาท · จ่าย ${isoTh(next.d)}`, body: `เงินนี้จะนับเป็นเงินออกเดือน${ymTh(ym)} · ${closed(ym)} บันทึกได้ แต่เดือนนั้นจะมีรายการที่ต้องตรวจใหม่` };
  }
  const gone = !next || !next.d;
  if (!gone && sameFp({ amt: paid.fp!.amt, d: paid.fp!.d, f: paid.fp!.f }, next!)) return null;
  const rec = paid.state === 'ok' || paid.state === 'back' ? paid.rec : null;
  const ym2 = gone ? '' : next!.d.slice(0, 7);
  const c0 = closed(paid.ym), c2 = ym2 && ym2 !== paid.ym ? closed(ym2) : '';
  if (!rec && !c0 && !c2) return null;
  const who = rec?.by || 'บัญชี';
  const head = `${rec ? `ค่าใช้จ่ายนี้${rec.s === 'ok' ? 'บัญชีตรวจแล้ว' : 'บัญชีส่งกลับแก้ไข'} (${who} ${dayOf(rec.at)}) · ` : ''}${fmtMoney(paid.amt) || '0'} บาท · จ่าย ${isoTh(paid.date)}`;
  const orphan = rec ? ` และ ${who} จะเห็นรายการเดิมว่า “ยกเลิกหลังตรวจ” ในหน้า Cashflow เดือน${ymTh(paid.ym)} จนกว่าจะกดรับทราบ` : '';
  const body = gone
    ? `ถ้า${verb} ค่าใช้จ่ายนี้จะไม่นับเป็นเงินออกแล้ว${orphan}${c0 ? ` · ${c0} ยอดของเดือนนั้นจะไม่เท่ากับตอนปิด` : ''}`
    : `ถ้า${verb} ยอด วันที่จ่าย หรือบิล รายการนี้จะกลับเป็น “รอตรวจ”${rec ? ` และ ${who} จะเห็นว่าเปลี่ยนอะไร` : ''}` +
      (c0 ? ` · ${c0} ${ym2 !== paid.ym ? `ยอดของเดือนนั้นจะไม่เท่ากับตอนปิด และรายการนี้จะไปรอตรวจในเดือน${ymTh(ym2)}` : 'เดือนนั้นจะมีรายการที่ต้องตรวจใหม่'}` : '') +
      (c2 ? ` · ${c2} เดือนนั้นจะมีรายการที่ต้องตรวจใหม่` : '');
  return { head, body };
}
/** What deleting a whole job (or cancelling a joint quotation with its expenses) does to accounting's check of
 *  money out, for its question: its paid expenses accounting checked or sent back, or of a closed month, show
 *  as "ยกเลิกหลังตรวจ" until acknowledged. `rows`: the job's (dealExpChecks). '' when none. */
export function expGoneCheckWords(rows: XRow[], closes: Record<string, MonthClose>): string {
  const hit = rows.filter((r) => r.kind === 'got' && (r.state === 'ok' || r.state === 'back' || !!closes[r.ym]));
  if (!hit.length) return '';
  const amt = r2(hit.reduce((a, r) => a + r.amt, 0));
  return `ค่าใช้จ่ายที่บัญชีตรวจแล้วหรืออยู่ในเดือนที่ปิดแล้ว ${hit.length} รายการ (${fmtMoney(amt) || '0'} บาท) จะขึ้นว่า “ยกเลิกหลังตรวจ” ในส่วนเงินออกของ Cashflow จนกว่าบัญชีจะกดรับทราบ`;
}
/** The question's text (window.confirm) for expGuard's answer: the action, the expense, what happens. */
export const expGuardText = (title: string, g: { head: string; body: string }, verb: string) => `${title}\n\n${g.head}\n${g.body}\n\n${verb}ต่อหรือไม่?`;

/** Expenses accounting sent back that are this person's to fix (they recorded it, or the job is theirs). */
export function expReturnedTo(rows: XRow[], me: string): XRow[] {
  if (!me.trim()) return [];
  return rows.filter((r) => r.kind === 'got' && r.state === 'back' && (r.by.some((b) => sameName(b, me)) || sameName(r.deal?.resp, me))).sort((a, b) => (b.rec?.at || '').localeCompare(a.rec?.at || ''));
}

/** The bell's group "ค่าใช้จ่ายที่บัญชีส่งกลับ": this person's expenses accounting sent back (they recorded it, or
 *  the job is theirs), newest first; only the deals with a returned expense are worked out. */
export function expBackBell(s: SalesState, checks: Record<string, PayCheck>, since: string, me: string): BellRow[] {
  if (!me.trim()) return [];
  const ids = new Set(Object.entries(checks).filter(([, c]) => c.s === 'back').map(([k]) => splitKey(k).dealId));
  const deals = [...ids].map((id) => s.deals[id]).filter(Boolean);
  if (!deals.length) return [];
  const mine = Object.fromEntries(Object.entries(checks).filter(([k]) => ids.has(splitKey(k).dealId)));
  return expReturnedTo(expChkRows(s, expLines(s, deals), mine, since), me).map((r) => ({
    key: 'x:' + r.key,
    kind: 'xchk',
    title: r.deal?.client || '',
    sub: [rowWhat(r), fmtMoney(r.amt) + ' บาท', `${r.rec?.by || 'บัญชี'} ส่งกลับให้แก้${r.rec?.note ? ': ' + (r.rec.note.length > 60 ? r.rec.note.slice(0, 59) + '…' : r.rec.note) : ''}`].join(' · '),
    right: { text: QT_WORD.back, chip: '' },
    count: true,
    go: { deal: r.dealId },
  }));
}

// ------------------------------------------------------------------ the Excel sheets of money out

/** The money status of an out row: จ่ายแล้ว · ค้างจ่าย · ยกเลิกหลังตรวจ. */
export const xMoneyWord = (r: Pick<XRow, 'kind'>) => (r.kind === 'got' ? 'จ่ายแล้ว' : r.kind === 'orphan' ? 'ยกเลิกหลังตรวจ' : 'ค้างจ่าย');
/** The check in the file: as on screen; changed says so; an orphan is not counted. */
export function xCheckWord(r: Pick<XRow, 'kind' | 'state'>): string {
  if (r.kind === 'orphan') return `${QT_WORD[r.state as PaySt] || ''} · ยกเลิกหลังตรวจ ไม่นับในยอด`;
  if (r.kind !== 'got') return '';
  if (r.state === 'none') return 'ก่อนเริ่มตรวจ';
  if (r.state === 'changed') return 'รอตรวจ (เปลี่ยนหลังตรวจ)';
  return QT_WORD[r.state as PaySt];
}
const dateCell = (iso: string): XCell => (iso ? { date: iso } : null);
/** The out lines of the file, in its order: paid, then (with `owed`) the unpaid bills, then the orphans. */
export const xSheetLines = (rows: XRow[], owed: boolean) => [...rows.filter((r) => r.kind === 'got' || (owed && r.kind === 'owed')), ...rows.filter((r) => r.kind === 'orphan')];
/**
 * The file's out sheets (added to "ตรวจรับเงิน_….xlsx" for those who see expenses): "เงินออก", one row per
 * expense (paid, unpaid with `owed`, then the checks whose expense no longer counts, marked not counted),
 * and "สรุปเงินออก", the months' paid and unpaid money, the money left after it (`inMonths`: the income
 * side's months of the same file, for เงินเข้าแล้ว and คงเหลือสุทธิ) and the out side's check and close.
 * `qtNo`: a deal's quotation number. Amounts are numbers, dates real dates.
 */
export function expSheets(rows: XRow[], months: MonthRow[], owed: boolean, qtNo: (d: Deal) => string, inMonths?: MonthRow[], filter = '', svcOf: SvcOf = ownSvc): XSheet[] {
  const ls = xSheetLines(rows, owed);
  // (บริการ last: two jobs of one company are told apart; the columns before it stay where they were)
  const head = ['เดือน', 'ลูกค้า', 'เลขใบเสนอราคา', 'หมวดค่าใช้จ่าย', 'รายละเอียด', 'ยอด (บาท)', 'วันที่บิล', 'วันที่จ่าย', 'สถานะเงิน', 'บิล / ใบเสร็จ', 'บันทึกโดย', 'บัญชีตรวจ', 'ผู้ตรวจ', 'วันที่ตรวจ', 'ข้อความส่งกลับแก้ไข', 'บริการ'];
  const line = (r: XRow): XCell[] => {
    const x = r.x, held = r.kind === 'orphan' || r.state === 'ok' || r.state === 'back';
    const client = r.deal ? r.deal.client + (x?.joint ? ` (${x.joint.role === 'header' ? `ใบเสนอราคาร่วม ${x.joint.members} บริษัท${x.joint.part ? ` · ส่วนของ ${x.joint.part} บริษัท` : ''}` : 'บริษัทในใบเสนอราคาร่วม'})` : '') : 'งานที่ถูกลบ';
    return [
      ymTh(r.ym, true), client, r.deal ? qtNo(r.deal) : '', x ? x.c || NO_CAT : '', x?.n || '',
      r.amt, dateCell(x?.bill || ''), r.kind === 'orphan' ? dateCell(r.rec!.d) : dateCell(x?.paid || ''), xMoneyWord(r), r.kind === 'orphan' ? '' : billWord(x), r.by.join(', '),
      xCheckWord(r), held && r.rec ? r.rec.by : '', held && r.rec ? dateCell(localDay(r.rec.at)) : null, r.rec?.s === 'back' ? r.rec.note || '' : '', r.deal ? svcText(svcOf(r.deal)) : '',
    ];
  };
  const inOf = (ym: string) => inMonths?.find((m) => m.ym === ym)?.sum.got;
  const sumHead = ['เดือน', 'จ่ายแล้ว (บาท)', 'ค้างจ่าย (บาท)', ...(inMonths ? ['เงินเข้าแล้ว (บาท)', 'คงเหลือสุทธิ (บาท)'] : []), 'รายการจ่ายแล้ว', 'บัญชีตรวจแล้ว (รายการ)', 'บัญชีตรวจแล้ว (บาท)', 'รอตรวจ (รายการ)', 'ส่งกลับแก้ไข (รายการ)', 'ยกเลิกหลังตรวจ (รายการ)', 'ปิดเดือนเงินออก', 'ปิดโดย', 'วันที่ปิด'];
  const closeWord = (m: MonthRow) => (m.state === 'closed' ? 'ปิดแล้ว' + (m.drift?.flagged ? ' · มีรายการเปลี่ยนหลังปิด' : '') : 'ยังไม่ปิด');
  const sumLine = (label: string, c: ChkSum, got: number | undefined, m: MonthRow | null): XCell[] => [
    label, c.got, c.owed, ...(inMonths ? [got ?? 0, r2((got ?? 0) - c.got)] : []), c.gotN, c.ok, c.okAmt, c.wait + c.changed, c.back, c.orphans,
    m ? closeWord(m) : '', m?.close?.by || '', m?.close ? dateCell(localDay(m.close.at)) : null,
  ];
  const sums = months.map((m) => sumLine(ymTh(m.ym), m.sum, inOf(m.ym), m));
  if (months.length > 1) {
    const all = sumRows(rows.filter((r) => months.some((m) => m.ym === r.ym)));
    const got = inMonths ? r2(months.reduce((a, m) => a + (inOf(m.ym) || 0), 0)) : undefined;
    sums.push(sumLine('รวมปี ' + (+months[0].ym.slice(0, 4) + 543), all, got, null));
  }
  if (filter) sums.push([], ['ตัวกรอง', `เฉพาะ ${filter} · คอลัมน์ปิดเดือนเป็นของทั้งเดือน`]);
  return [
    { name: 'เงินออก', head, rows: ls.map(line), widths: [11, 34, 16, 20, 30, 14, 12, 12, 14, 24, 14, 30, 10, 12, 40, 16] },
    { name: 'สรุปเงินออก', head: sumHead, rows: sums, widths: [16, 14, 14, ...(inMonths ? [16, 16] : []), 14, 18, 18, 14, 16, 18, 22, 10, 12] },
  ];
}
/** The Excel dialog's preview of sheet เงินออก: its first `n` lines in short columns. */
export const X_PREVIEW_HEAD = ['ลูกค้า', 'หมวดค่าใช้จ่าย', 'ยอด (บาท)', 'วันที่จ่าย', 'สถานะเงิน', 'บัญชีตรวจ'];
export function xSheetPreview(rows: XRow[], owed: boolean, n = 4, short: (client: string) => string = (x) => x): string[][] {
  return xSheetLines(rows, owed).slice(0, n).map((r) => [
    r.deal ? short(r.deal.client) : 'งานที่ถูกลบ', r.x ? r.x.c || NO_CAT : '', fmtMoney(r.amt) || '0', r.kind === 'got' || r.kind === 'orphan' ? r.date : '', xMoneyWord(r),
    r.kind === 'orphan' ? 'ยกเลิกหลังตรวจ' : r.kind !== 'got' ? '' : r.state === 'none' ? 'ก่อนเริ่มตรวจ' : QT_WORD[(r.state === 'changed' ? 'wait' : r.state) as PaySt],
  ]);
}

// ------------------------------------------------------------------ the Cashflow CSV with money out

/** Which money the Cashflow file holds: in, out, or both. */
export type CashFlow = 'in' | 'out' | 'both';
/** The money status of an expense line in the CSV. */
export const expStatusWord = (x: Pick<ExpLine, 'kind'>) => (x.kind === 'paid' ? 'จ่ายแล้ว' : 'ค้างจ่าย');
/** The last row of a summary: bills with no date (in no month). */
const X_UNDATED = 'ยังไม่ระบุวันที่บิล';
const undatedOut = (X: Pick<ExpYear, 'undated'>) => {
  const u = xs0();
  X.undated.forEach((x) => addX(u, x));
  return u;
};
/** A joint quotation's expense in the CSV's client cell. */
const expClient = (x: ExpLine) =>
  x.deal.client + (x.joint ? (x.joint.role === 'header' ? ` (ใบเสนอราคาร่วม ${x.joint.members} บริษัท${x.joint.part ? ` · ส่วนของ ${x.joint.part} บริษัท` : ''})` : ' (บริษัทในใบเสนอราคาร่วม)') : '');
/**
 * The money-out rows of the Cashflow file of a year (Excel opens it). `lines`: one row per expense, paid on
 * the paid date, unpaid on the bill date, the bills with no date last (`undated`). `month` / `quarter`: the
 * sums, the bills with no date in one last row (`undated`).
 */
export function expCsvRows(be: string, X: ExpYear, mode: 'lines' | 'month' | 'quarter', undated: boolean, qtNo: (d: Deal) => string, svcOf: SvcOf = ownSvc) {
  if (mode !== 'lines') {
    const head = ['ปี (พ.ศ.)', mode === 'month' ? 'เดือน' : 'ไตรมาส', 'จ่ายแล้ว (บาท)', 'ค้างจ่าย (บาท)', 'จำนวนรายการ'];
    const row = (label: string, c: ExpSum): (string | number)[] => [be, label, c.paid, c.unpaid, c.paidN + c.unpaidN];
    const rows = mode === 'month' ? X.months.map((c, i) => row(`${TH_M[i]} ${be}`, c)) : X.quarters.map((c, i) => row(`ไตรมาส ${i + 1} (${Q_TH[i]})`, c));
    if (undated && X.undated.length) rows.push(row(X_UNDATED, undatedOut(X)));
    return { head, rows };
  }
  const head = ['ปี (พ.ศ.)', 'เดือน', 'ลูกค้า', 'ปีของงาน', 'หมวด', 'ผู้รับผิดชอบ', 'หมวดค่าใช้จ่าย', 'รายละเอียด', 'ยอด (บาท)', 'วันที่บิล', 'วันที่จ่าย', 'สถานะ', 'เลขใบเสนอราคา', 'บันทึกโดย', 'บริการ'];
  const line = (x: ExpLine): (string | number)[] => [
    be, x.date ? `${TH_M[+x.date.slice(5, 7) - 1]} ${beOf(x.date)}` : '', expClient(x), x.dealYear, x.deal.section, x.deal.resp, x.c || NO_CAT, x.n, x.amt, x.bill, x.paid, expStatusWord(x), qtNo(x.deal), x.by, svcText(svcOf(x.deal)),
  ];
  return { head, rows: [...X.lines.map(line), ...(undated ? X.undated.map(line) : [])] };
}
/**
 * Money in and out in one file: `lines` one row per amount, the kind first ("เงินเข้า" / "เงินออก"), soonest
 * first. `month` / `quarter`: each period's money in as the in-only file has it (received, late, still to
 * come) beside its money out (paid, unpaid) and what is left (received − paid), then with `undated` the
 * money with no date: "ยังไม่กำหนดวันรับ" of the income and "ยังไม่ระบุวันที่บิล" of the bills, a row each when
 * there is any. `inRows`: sales cashRows of the same year and mode (its own columns: the in lines are
 * re-laid in the shared columns).
 */
export function bothCsvRows(be: string, inRows: { head: string[]; rows: (string | number)[][] }, Y: Pick<CashYear, 'months' | 'quarters' | 'lines' | 'undated'>, X: ExpYear, mode: 'lines' | 'month' | 'quarter', undated: boolean, qtNo: (d: Deal) => string, svcOf: SvcOf = ownSvc) {
  if (mode !== 'lines') {
    const head = ['ปี (พ.ศ.)', mode === 'month' ? 'เดือน' : 'ไตรมาส', 'รับแล้ว (บาท)', 'เลยกำหนด (บาท)', 'รอรับ (บาท)', 'จ่ายแล้ว (บาท)', 'ค้างจ่าย (บาท)', 'คงเหลือสุทธิ (บาท)', 'จำนวนงวด', 'จำนวนรายการค่าใช้จ่าย'];
    const row = (label: string, c: CashSum, x: ExpSum): (string | number)[] => [be, label, r2(c.got), r2(c.late), r2(c.wait), x.paid, x.unpaid, r2(c.got - x.paid), c.n, x.paidN + x.unpaidN];
    const rows = mode === 'month' ? X.months.map((x, i) => row(`${TH_M[i]} ${be}`, Y.months[i], x)) : X.quarters.map((x, i) => row(`ไตรมาส ${i + 1} (${Q_TH[i]})`, Y.quarters[i], x));
    if (undated && Y.undated.length) {
      // as the in-only file: what came in without a date counts as received, the rest as still to come
      const u: CashSum = { got: 0, late: 0, wait: 0, n: Y.undated.length };
      Y.undated.forEach((l) => (l.kind === 'got' ? (u.got += l.amt) : (u.wait += l.amt)));
      rows.push(row('ยังไม่กำหนดวันรับ', u, xs0()));
    }
    if (undated && X.undated.length) rows.push(row(X_UNDATED, { got: 0, late: 0, wait: 0, n: 0 }, undatedOut(X)));
    return { head, rows };
  }
  const head = ['ปี (พ.ศ.)', 'เดือน', 'เงินเข้า / เงินออก', 'ลูกค้า', 'ปีของงาน', 'หมวด', 'ผู้รับผิดชอบ', 'งวด / หมวดค่าใช้จ่าย', 'รายละเอียด', 'ยอด (บาท)', 'ครบกำหนด / วันที่บิล', 'วันที่รับ / วันที่จ่าย', 'สถานะ', 'เลขใบเสนอราคา', 'บริการ'];
  // the in rows as cashRows laid them: [ปี, เดือน, ลูกค้า, ปีของงาน, หมวด, ผู้รับผิดชอบ, งวด, ยอด, ครบกำหนด, วันที่รับ, สถานะ, เลขใบเสนอราคา, ใบเสนอราคาร่วม, บริการ]
  const ins = inRows.rows.map((r) => ({ d: String(r[9] || r[8] || ''), row: [r[0], r[1], 'เงินเข้า', r[2], r[3], r[4], r[5], r[6], '', r[7], r[8], r[9], r[10], r[11], r[13] ?? ''] as (string | number)[] }));
  const outs = [...X.lines, ...(undated ? X.undated : [])].map((x) => ({
    d: x.date,
    row: [be, x.date ? `${TH_M[+x.date.slice(5, 7) - 1]} ${beOf(x.date)}` : '', 'เงินออก', expClient(x), x.dealYear, x.deal.section, x.deal.resp, x.c || NO_CAT, x.n, x.amt, x.bill, x.paid, expStatusWord(x), qtNo(x.deal), svcText(svcOf(x.deal))] as (string | number)[],
  }));
  // dated first, soonest first (in before out on a day), the undated last in their own order
  const all = [...ins, ...outs].map((r, i) => ({ ...r, i }));
  all.sort((a, b) => (!a.d ? 1 : 0) - (!b.d ? 1 : 0) || a.d.localeCompare(b.d) || a.i - b.i);
  return { head, rows: all.map((r) => r.row) };
}
