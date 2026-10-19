/**
 * Job expenses per job (ค่าใช้จ่ายของงาน, the deal panel's card, its dialog, the phone card): what a job
 * received against what went out for it, the categories the team already typed, and what a line typed in
 * the dialog becomes. Pure (no DOM), unit-tested in expenseJob.test.ts; the records are lib/expense.ts.
 *
 * - เงินเข้า = the money the job received, as Cashflow counts it (cashLines' received lines of a won deal, on
 *   the day each came in, amounts as on the documents incl. VAT). A joint quotation's header holds the whole
 *   quotation's money; a member company holds none of its own, so its card counts its part of the header's
 *   (the split every other money view uses, holdPart).
 * - ค่าใช้จ่าย = every expense recorded on the job, paid or not (a bill not paid yet is still a cost of the job),
 *   but คงเหลือ = เงินเข้า − the expenses PAID, as Cashflow and the Dashboard count it (received − paid; a
 *   bill not paid yet, "ค้างจ่าย", is said apart with what would be left once it is paid), so the card's
 *   figures are the money views' for the same job and period.
 * - A joint quotation's panel adds its member companies' expenses to the header's own: each expense belongs
 *   to one deal, so a total over the header and its members counts every one once. A member company counts
 *   its own and its part of the header's (split as the quotation's money is, holdPart), as the money views do
 *   under a ผู้รับผิดชอบ filter: the members' figures add up to the header's.
 * - The commission line (ค่าคอมมิชชั่น (คำนวณ), with ดูค่าคอมมิชชั่น) is computed from units (lib/contrib.ts),
 *   never stored and never part of the expense total.
 */
import { cashLines, dealMoney, fmtMoney, holdPart, jointOf, jointRole, parseAmount, type Deal, type SalesState } from './sales';
import { isoTh } from './format';
import { shareOf as jointShare } from './joint';
import { contribIn, type UnitCtx } from './contrib';
import { EXP_CAT_MAX, EXP_NOTE_MAX, expensesOf, type DealExp, type JobExp } from './expense';

/** The grey examples in an empty category box (no fixed list: any words). */
export const CAT_EXAMPLES = 'เช่น ผู้รับเหมา, ค่าเดินทาง, ค่าธรรมเนียม TGO, ค่าแล็บ';

// ------------------------------------------------------------------ categories

/** A category as typed, tidied (what is stored): inner spaces collapsed, trimmed, at most EXP_CAT_MAX. */
export const tidyCat = (c: string) => c.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, EXP_CAT_MAX);
/** Two spellings of one category ("ค่าเดินทาง" / " ค่าเดินทาง ", "TGO" / "tgo") share this key. */
export const catKey = (c: string) => tidyCat(c).toLowerCase();

/** A category the team used: its most used spelling, how many expenses, the last time one was written. */
export interface CatUse { c: string; n: number; at: string }
/**
 * Every category the team's expenses use, most used first (then the most recently written, then by name):
 * the dialog suggests these. Spellings that differ only in spaces or letter case are one category.
 */
export function expCats(s: Pick<SalesState, 'exp'>): CatUse[] {
  const by = new Map<string, { n: number; at: string; spell: Map<string, number> }>();
  for (const e of Object.values(s.exp || {})) {
    const c = tidyCat(e.c || '');
    if (!c) continue;
    const k = catKey(c);
    const x = by.get(k) || { n: 0, at: '', spell: new Map<string, number>() };
    x.n++;
    if ((e.at || '') > x.at) x.at = e.at || '';
    x.spell.set(c, (x.spell.get(c) || 0) + 1);
    by.set(k, x);
  }
  return [...by.values()]
    .map((x) => ({ c: [...x.spell].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'))[0][0], n: x.n, at: x.at }))
    .sort((a, b) => b.n - a.n || b.at.localeCompare(a.at) || a.c.localeCompare(b.c, 'th'));
}
/** The categories to offer while `typed` is in the box: those containing it (all of them when it is empty),
 *  in expCats' order, not the one typed exactly; at most `max`. */
export function catSuggest(s: Pick<SalesState, 'exp'>, typed: string, max = 8): CatUse[] {
  const k = catKey(typed);
  return expCats(s)
    .filter((x) => {
      const xk = catKey(x.c);
      return !k || (xk !== k && xk.includes(k));
    })
    .slice(0, max);
}

// ------------------------------------------------------------------ the dialog's line

/** What the dialog holds (as typed). */
export interface ExpForm { c: string; n: string; amt: string; d: string; paidOn: boolean; paid: string }
export type ExpField = 'c' | 'amt' | 'd' | 'paid';
/** The fields of a record the dialog writes (by, at and the bill are the engine's). */
export type ExpInput = Pick<JobExp, 'c' | 'n' | 'amt' | 'd' | 'paid'>;
const DAY = /^\d{4}-\d\d-\d\d$/;
/** A real calendar day (30 Feb is not one). */
const isDay = (v: string) => {
  if (!DAY.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

/** The dialog's fields for a new expense (the bill dated today, not paid yet) or an existing one. */
export function expForm(e: JobExp | null, today: string): ExpForm {
  if (!e) return { c: '', n: '', amt: '', d: today, paidOn: false, paid: '' };
  return { c: e.c, n: e.n || '', amt: e.amt.toLocaleString('en-US', { maximumFractionDigits: 2 }), d: e.d || today, paidOn: !!e.paid, paid: e.paid || '' };
}
/**
 * What the dialog's fields make: the record's fields, or what is missing in words per field. A category is
 * needed (free text), an amount more than 0 ("35,000", "1.5 ล้าน", "35000.-" read as on Thai bills), the
 * bill's date, and a paid date once "จ่ายแล้ว" is on.
 */
export function readExpForm(f: ExpForm): { ok: true; v: ExpInput } | { ok: false; err: Partial<Record<ExpField, string>> } {
  const err: Partial<Record<ExpField, string>> = {};
  const c = tidyCat(f.c);
  if (!c) err.c = 'ใส่ประเภทค่าใช้จ่าย';
  const amt = parseAmount(f.amt);
  if (amt === undefined) err.amt = 'อ่านยอดไม่ได้ พิมพ์ตัวเลขเดียว เช่น 35,000';
  else if (amt == null || amt <= 0) err.amt = 'ใส่ยอดตามบิล (มากกว่า 0)';
  if (!isDay(f.d)) err.d = 'เลือกวันที่ในบิล';
  if (f.paidOn && !isDay(f.paid)) err.paid = 'เลือกวันที่จ่าย';
  if (Object.keys(err).length) return { ok: false, err };
  const v: ExpInput = { c, amt: Math.round(amt! * 100) / 100, d: f.d };
  const n = f.n.replace(/\s+/g, ' ').trim().slice(0, EXP_NOTE_MAX);
  if (n) v.n = n;
  if (f.paidOn) v.paid = f.paid;
  return { ok: true, v };
}
/** The record fields an edit changes (by name), for a field-by-field merge with a teammate's edit. */
export function expChanged(a: Partial<JobExp>, b: Partial<JobExp>): (keyof JobExp)[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof JobExp)[]);
  return [...keys].filter((k) => k !== 'by' && k !== 'at' && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

// ------------------------------------------------------------------ a teammate's change while the dialog is open

/** The record fields the dialog writes, one per form field ('paid' is the box and its date together). */
export type ExpKey = keyof ExpInput;
export const EXP_KEYS: ExpKey[] = ['c', 'n', 'amt', 'd', 'paid'];
/** What a form field reads as, to tell whether it was changed (a paid date counts only while ticked). */
const fieldOf = (f: ExpForm, k: ExpKey) => (k === 'paid' ? (f.paidOn ? f.paid : '') : f[k]);
const setField = (f: ExpForm, k: ExpKey, from: ExpForm): ExpForm => (k === 'paid' ? { ...f, paidOn: from.paidOn, paid: from.paid } : { ...f, [k]: from[k] });
/** The fields the person changed in the dialog: `init` = the record as the dialog holds it untouched. */
export const expTouched = (init: ExpForm, f: ExpForm): ExpKey[] => EXP_KEYS.filter((k) => fieldOf(init, k) !== fieldOf(f, k));
/**
 * A teammate changed the record while the dialog is open (`live` = the record now, as a form): every field
 * the person has not changed follows it, so the dialog always shows what saving keeps; a field the person
 * changed keeps what they typed and the value it was changed from (expClash asks about it at saving).
 */
export function expFollow(ed: { init: ExpForm; f: ExpForm }, live: ExpForm): { init: ExpForm; f: ExpForm } {
  const touched = expTouched(ed.init, ed.f);
  let { init, f } = ed;
  for (const k of EXP_KEYS) {
    if (touched.includes(k) || fieldOf(init, k) === fieldOf(live, k)) continue;
    init = setField(init, k, live);
    f = setField(f, k, live);
  }
  return init === ed.init && f === ed.f ? ed : { init, f };
}
/** The fields the person changed that a teammate changed too, to another value, while the dialog was open:
 *  saving over them asks first (as the step editor does). */
export const expClash = (init: ExpForm, f: ExpForm, live: ExpForm): ExpKey[] =>
  expTouched(init, f).filter((k) => fieldOf(live, k) !== fieldOf(init, k) && fieldOf(live, k) !== fieldOf(f, k));
/** A field and its value now, in words, for the question before saving over a teammate's change. */
export function expFieldWords(k: ExpKey | 'file', live: JobExp): string {
  if (k === 'c') return `ประเภท "${live.c}"`;
  if (k === 'n') return live.n ? `รายละเอียด "${live.n}"` : 'รายละเอียด (ว่าง)';
  if (k === 'amt') return `ยอด ${fmtMoney(live.amt) || '0'} บาท`;
  if (k === 'd') return `วันที่ในบิล ${live.d ? isoTh(live.d) : '(ไม่ระบุ)'}`;
  if (k === 'paid') return live.paid ? `จ่ายแล้ว ${isoTh(live.paid)}` : 'ยังไม่จ่าย (ค้างจ่าย)';
  return live.file ? `บิล ${live.file.name}` : 'ไม่มีบิล';
}
/** Two bills are one file (the same upload, or the same file still waiting to go up). */
export const sameBill = (a: JobExp['file'] | null | undefined, b: JobExp['file'] | null | undefined) =>
  !a || !b ? !a && !b : a.id === b.id && a.name === b.name && a.size === b.size;

/**
 * What deleting a deal (or cancelling a joint quotation) takes of its job expenses, in words for its
 * question: "ค่าใช้จ่ายที่บันทึกไว้ 2 รายการ (23,500 บาท) และบิลที่แนบ จะถูกลบด้วย"; '' when there are none.
 */
export function expGoneWords(list: Pick<JobExp, 'amt' | 'file'>[], where = ''): string {
  if (!list.length) return '';
  const t = expTotals(list);
  return `ค่าใช้จ่ายที่บันทึกไว้${where} ${t.n} รายการ (${fmtMoney(t.out) || '0'} บาท)${list.some((x) => x.file) ? ' และบิลที่แนบ' : ''} จะถูกลบด้วย`;
}

// ------------------------------------------------------------------ one job's money

const r2 = (n: number) => Math.round(n * 100) / 100;
/** A list of expenses added up: all of them, paid, not paid yet (ค้างจ่าย), how many and how many unpaid. */
export interface ExpTotals { out: number; paid: number; unpaid: number; n: number; nUnpaid: number }
export function expTotals(list: Pick<JobExp, 'amt' | 'paid'>[]): ExpTotals {
  const t: ExpTotals = { out: 0, paid: 0, unpaid: 0, n: 0, nUnpaid: 0 };
  for (const e of list) {
    t.out += e.amt;
    t.n++;
    if (e.paid) t.paid += e.amt;
    else {
      t.unpaid += e.amt;
      t.nUnpaid++;
    }
  }
  return { ...t, out: r2(t.out), paid: r2(t.paid), unpaid: r2(t.unpaid) };
}

/**
 * What a job received and what it was quoted (Forecast), as the money views count them: a plain deal or a
 * joint quotation's header its own (the header: the whole quotation's); a member company its part of the
 * header's (its share of each amount received, and its part of the quotation). Only a won deal received
 * anything (cashLines).
 */
export function jobIncome(s: SalesState, d: Deal, today: string): { inc: number; fc: number | null } {
  if (jointRole(s, d) === 'member') {
    const g = jointOf(s, d), i = g ? g.members.findIndex((x) => x.deal.id === d.id) : -1;
    if (!g || i < 0) return { inc: 0, fc: null };
    const h = { d: g.head, g, keep: [i] };
    const inc = cashLines(s, [g.head], today).reduce((a, l) => a + (l.kind === 'got' ? holdPart(s, h, l.amt) : 0), 0);
    return { inc: r2(inc), fc: jointShare(s, d)?.amt ?? null };
  }
  const inc = cashLines(s, [d], today).reduce((a, l) => a + (l.kind === 'got' ? l.amt : 0), 0);
  return { inc: r2(inc), fc: dealMoney(s, d).forecast };
}

/** The member companies of a joint quotation that have expenses, with them and their total (in the
 *  quotation's order), for the header's panel. */
export interface MemberExp { deal: Deal; list: DealExp[]; t: ExpTotals }
export function memberExps(s: SalesState, d: Deal): MemberExp[] {
  if (jointRole(s, d) !== 'header') return [];
  const g = jointOf(s, d);
  return (g?.members || []).map((x) => ({ deal: x.deal, list: expensesOf(s, x.deal.id) })).filter((x) => x.list.length).map((x) => ({ ...x, t: expTotals(x.list) }));
}

/** A member company's part of the expenses recorded on its joint quotation's header: each split the way the
 *  quotation's money is (holdPart: its share in baht, else its %, else equal; none for one that withdrew),
 *  as the money views count them under a ผู้รับผิดชอบ filter. `list` holds the header's expenses with a part
 *  (`part`), `t` their parts added up. null for any other deal, or a header with no expenses. */
export interface HeadPart { head: Deal; list: (DealExp & { part: number })[]; t: ExpTotals }
export function headPartExps(s: SalesState, d: Deal): HeadPart | null {
  if (jointRole(s, d) !== 'member') return null;
  const g = jointOf(s, d), i = g ? g.members.findIndex((x) => x.deal.id === d.id) : -1;
  if (!g || i < 0) return null;
  const h = { d: g.head, g, keep: [i] };
  const list = expensesOf(s, g.head.id).map((x) => ({ ...x, part: r2(holdPart(s, h, x.amt)) })).filter((x) => x.part > 0);
  return list.length ? { head: g.head, list, t: expTotals(list.map((x) => ({ amt: x.part, paid: x.paid }))) } : null;
}

/**
 * The card's figures: เงินเข้า (inc); ค่าใช้จ่าย (`t`: this job's own expenses, for a joint quotation's header its
 * members' too, for a member company its part of the header's); คงเหลือ = inc − the paid ones (as Cashflow and
 * the Dashboard: received − paid) and its % of inc (null with nothing received); `after` = what is left once
 * the bills not paid yet are paid too (inc − all of them); and the same against the Forecast "ถ้ารับครบตาม
 * Forecast" (all of them; null without one). `own` / `members` / `head` = the job's own expenses, a header's
 * members', a member's part of its header's.
 */
export interface JobSum {
  inc: number; fc: number | null; t: ExpTotals; own: ExpTotals; members: MemberExp[]; head: HeadPart | null;
  left: number; pct: number | null; after: number; afterPct: number | null; fcLeft: number | null; fcPct: number | null;
}
export function jobSum(s: SalesState, d: Deal, today: string): JobSum {
  const { inc, fc } = jobIncome(s, d, today);
  const ownList = expensesOf(s, d.id), members = memberExps(s, d), head = headPartExps(s, d);
  const own = expTotals(ownList);
  const t = expTotals([...ownList, ...members.flatMap((m) => m.list), ...(head ? head.list.map((x) => ({ amt: x.part, paid: x.paid })) : [])]);
  const left = r2(inc - t.paid), after = r2(inc - t.out);
  const fcLeft = fc != null ? r2(fc - t.out) : null;
  return { inc, fc, t, own, members, head, left, pct: pctOf(left, inc), after, afterPct: pctOf(after, inc), fcLeft, fcPct: fc != null ? pctOf(fcLeft!, fc) : null };
}
/** `part` as a whole % of `whole` (null when there is no whole): 65000 of 100000 = 65; a loss is negative. */
export function pctOf(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 100);
}

/** Every dated day (an amount received without a date has no rate to price it). */
const ALL_DAYS = { from: '0000-01-01', to: '9999-12-31' };
/**
 * The commission a job's received money earns (ค่าคอมมิชชั่น (คำนวณ)): each amount received × the job's split
 * by unit × that unit's rate on the day it came in (contribIn, all dates), for this deal's own parts — a
 * member company its part, a header the whole quotation's. Rounded to the satang.
 */
export function jobComm(ctx: UnitCtx, s: SalesState, d: Deal, today: string): number {
  const jr = jointRole(s, d);
  const g = jr === 'member' ? jointOf(s, d) : null;
  const src = g ? g.head : d;
  if (jr === 'member' && !g) return 0;
  const c = contribIn(ctx, cashLines(s, [src], today), ALL_DAYS);
  let sum = 0;
  for (const m of Object.values(c.by)) for (const x of m.items) if (jr !== 'member' || x.deal.id === d.id) sum += x.comm;
  return r2(sum);
}
