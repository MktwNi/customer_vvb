/**
 * Units, % contribution and commission (package dash, items 8 and 9b; dash impl-note §1). Pure helpers, no DOM.
 *
 * - A unit (หน่วยงาน / ฝ่าย) is a group of staff an admin sets up: `scfg/unit.<id>` = { n, c, o, rates, off? }.
 *   Its commission rates are effective-dated: the first one (`from: ''`) prices all money, past included;
 *   each later change prices the money received from the day it was saved (never retroactive). A rate may
 *   be set per service (the deal's Services) and then replaces the unit's own while the job has it.
 * - One person is in one unit: `scfg/unitm.<staffKey(name)>` = { unit, n }. Names are free text (a deal's
 *   ผู้รับผิดชอบ), so the key is staffKey(), never the customer-name key (which drops 2-letter names: ฝน).
 * - A deal's money is split over units by % (`dshare/<dealId>` = { lines: [{ u, p }] }, summing to 100).
 *   Without one (or with one that is not 100%), the deal counts 100% for its ผู้รับผิดชอบ's unit: computed
 *   here, never stored.
 * - Commission = money RECEIVED in the period (cashLines' received lines, on the day they came in, amounts
 *   as on the documents incl. VAT) × the deal's split × the unit's rate on that day.
 *
 * Only the types come from sales.ts, so sales.ts may use these helpers (the หน่วยงาน filter) without a
 * cycle. A joint quotation (package quotes) apportions its header's money to its member deals before the
 * unit split: that is the `parts` hook (setPartsHook), which defaults to "the deal itself".
 */
import type { CashLine, Deal, SalesState } from './sales';
import { inRange, type Range } from './dateRange';

// ------------------------------------------------------------------ records

/** Key of a staff display name or a free-text ผู้รับผิดชอบ: NFC, trimmed, inner spaces collapsed, lower-case;
 *  '' when empty, holding '/', or longer than 60. "ฝน" and "บี" keep their own keys; "คุณบี" ≠ "บี". */
export const staffKey = (s: unknown) => {
  const k = String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  return k && !k.includes('/') && k.length <= 60 ? k : '';
};

/** One commission rate of a unit, in force from `from` ('' = from the start). `r` null = no commission;
 *  `svc`: service → rate, used in place of `r` while the job has that service (the highest when several);
 *  `d`: the day it was saved (a change saved again the same day replaces it). */
export interface UnitRate { from: string; r: number | null; svc?: Record<string, number>; d?: string }
/** `scfg/unit.<id>`: `c` the colour slot (0 grey, 1–4 the validated hues), `o` the order, `off` retired. */
export interface UnitRec { n: string; c: number; o: number; rates: UnitRate[]; off?: boolean; at: string; by: string }
export interface Unit extends UnitRec { id: string }
/** `scfg/unitm.<staffKey>`: the person's unit and their name as written. */
export interface UnitMember { unit: string; n: string; at: string; by: string }
export interface ShareLine { u: string; p: number }
/** `dshare/<dealId>`: the deal's split. */
export interface ShareRec { lines: ShareLine[]; at: string; by: string }

export const UNIT_SLOTS = 4;
/** The validated unit hues (dataviz validator, light: worst adjacent CVD ΔE 9.6, normal 16.3, all ≥ 3:1);
 *  slot 0 = grey, for units without commission. A name always stands beside the colour. */
export const UNIT_HEX = ['#AEB5C7', '#1745B8', '#9467D6', '#C23C7E', '#119CBC'];
export const NAME_MAX = 40;
export const NO_UNIT_TH = 'ยังไม่ระบุหน่วยงาน';
export const isUnitId = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9_-]{1,24}$/.test(s);
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
/** A rate: 0–100 with at most two decimals. */
export const rateOk = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 100 && Math.round(r * 100) === r * 100;
/** A share: more than 0, at most 100, an integer or one decimal. */
export const pctOk = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0 && p <= 100 && Math.abs(Math.round(p * 10) - p * 10) < 1e-9;

function toRate(v: unknown): UnitRate | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  const from = x.from === '' || x.from == null ? '' : isDay(x.from) ? x.from : null;
  if (from == null) return null;
  const r = x.r == null ? null : rateOk(x.r) ? x.r : undefined;
  if (r === undefined) return null;
  const out: UnitRate = { from, r };
  if (x.svc && typeof x.svc === 'object' && !Array.isArray(x.svc)) {
    const svc = Object.fromEntries(Object.entries(x.svc as Record<string, unknown>).filter(([k, n]) => k.trim() && rateOk(n)).map(([k, n]) => [k.slice(0, 60), n as number]));
    if (Object.keys(svc).length) out.svc = svc;
  }
  if (isDay(x.d)) out.d = x.d;
  return out;
}
/** A unit as the team holds it (a row of another browser, checked); null = skipped. Its rates sorted by
 *  their day ('' first); an account without ดูค่าคอมมิชชั่น receives it without rates (the script strips them). */
export function toUnit(v: unknown): UnitRec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const n = str(x.n, NAME_MAX).trim();
  if (!n) return null;
  const c = Number.isInteger(x.c) && (x.c as number) >= 0 && (x.c as number) <= UNIT_SLOTS ? (x.c as number) : 0;
  const o = typeof x.o === 'number' && Number.isFinite(x.o) ? x.o : 0;
  const rates = (Array.isArray(x.rates) ? x.rates.map(toRate).filter((r): r is UnitRate => !!r) : []).sort((a, b) => a.from.localeCompare(b.from));
  return { n, c, o, rates, ...(x.off === true ? { off: true } : {}), at: str(x.at, 40), by: str(x.by, 100) };
}
export function toUnitMember(v: unknown): UnitMember | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const unit = x.unit === '' || isUnitId(x.unit) ? (x.unit as string) : null;
  if (unit == null) return null;
  return { unit, n: str(x.n, 60).trim(), at: str(x.at, 40), by: str(x.by, 100) };
}
/** A split as stored (its shape only: whether it adds up to 100 is read by shareOf). */
export function toShare(v: unknown): ShareRec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  if (!Array.isArray(x.lines)) return null;
  const lines = x.lines
    .map((l) => (l && typeof l === 'object' ? { u: (l as ShareLine).u, p: (l as ShareLine).p } : null))
    .filter((l): l is ShareLine => !!l && typeof l.u === 'string' && typeof l.p === 'number' && Number.isFinite(l.p))
    .slice(0, 20);
  return { lines, at: str(x.at, 40), by: str(x.by, 100) };
}

/** Where the unit records live (SalesState.units / unitm / shares). */
export interface UnitBags { units?: Record<string, UnitRec>; unitm?: Record<string, UnitMember>; shares?: Record<string, ShareRec> }
/**
 * Apply a pulled `scfg/unit.*`, `scfg/unitm.*` (`name` without "scfg/") or `dshare/<id>` row (`name` = the id,
 * `share` set). False when it was not one of these or changed nothing worth a redraw.
 */
export function applyUnitRow(S: UnitBags, name: string, del: boolean, v: unknown, share = false): boolean {
  if (share) {
    if (!name || name.includes('/')) return false;
    const D = S.shares || (S.shares = {});
    if (del) return name in D ? (delete D[name], true) : false;
    const x = toShare(v);
    if (!x) return false;
    D[name] = x;
    return true;
  }
  const m = /^(unitm?)\.(.+)$/.exec(name);
  if (!m) return false;
  if (m[1] === 'unit') {
    if (!isUnitId(m[2])) return false;
    const U = S.units || (S.units = {});
    if (del) return m[2] in U ? (delete U[m[2]], true) : false;
    const x = toUnit(v);
    if (!x) return false;
    U[m[2]] = x;
    return true;
  }
  if (!staffKey(m[2]) || staffKey(m[2]) !== m[2]) return false;
  const M = S.unitm || (S.unitm = {});
  if (del) return m[2] in M ? (delete M[m[2]], true) : false;
  const x = toUnitMember(v);
  if (!x) return false;
  M[m[2]] = x;
  return true;
}
/** Every unit record held here, keyed like the team's (teamSync localRecords). */
export function unitRecords(S: UnitBags): [string, unknown][] {
  return [
    ...Object.entries(S.units || {}).map(([id, v]): [string, unknown] => ['scfg/unit.' + id, { ...v, rates: v.rates.map((r) => ({ ...r })) }]),
    ...Object.entries(S.unitm || {}).map(([k, v]): [string, unknown] => ['scfg/unitm.' + k, { ...v }]),
    ...Object.entries(S.shares || {}).map(([id, v]): [string, unknown] => ['dshare/' + id, { ...v, lines: v.lines.map((l) => ({ ...l })) }]),
  ];
}

// ------------------------------------------------------------------ who is in which unit

/** How a deal's money is attributed before its unit split. Default: all of it to the deal itself. A joint
 *  quotation's header (package quotes) gives its money to its member deals by their share (jqm share, else
 *  pct, else equally): the joint-QT build registers that with setPartsHook. Weights need not sum to 1. */
export interface Part { deal: Deal; w: number }
export type PartsHook = (s: SalesState, d: Deal) => Part[] | null | undefined;
let partsHook: PartsHook | null = null;
export function setPartsHook(fn: PartsHook | null) {
  partsHook = fn;
}

/** The unit data of a tracker, read in place (cheap to make: nothing is copied). */
export interface UnitCtx { s: SalesState; units: Record<string, UnitRec>; members: Record<string, UnitMember>; shares: Record<string, ShareRec>; parts: PartsHook | null }
export function unitCtx(s: SalesState, parts?: PartsHook | null): UnitCtx {
  const b = s as SalesState & UnitBags;
  return { s, units: b.units || {}, members: b.unitm || {}, shares: b.shares || {}, parts: parts === undefined ? partsHook : parts };
}
/** The units in their order (then by name); retired ones only with `all`. */
export function unitsOf(ctx: Pick<UnitCtx, 'units'>, all = false): Unit[] {
  return Object.entries(ctx.units)
    .filter(([, u]) => all || !u.off)
    .map(([id, u]) => ({ ...u, id }))
    .sort((a, b) => a.o - b.o || a.n.localeCompare(b.n, 'th'));
}
/** The unit a person is in ('' = ยังไม่ระบุหน่วยงาน: no record, or a unit that is gone). */
export function unitOfName(ctx: Pick<UnitCtx, 'units' | 'members'>, name: unknown): string {
  const k = staffKey(name);
  const id = k ? ctx.members[k]?.unit : '';
  return id && ctx.units[id] ? id : '';
}
export const unitName = (ctx: Pick<UnitCtx, 'units'>, id: string) => (id && ctx.units[id] ? ctx.units[id].n : NO_UNIT_TH);
/** The names in a unit, as written. */
export function membersOf(ctx: Pick<UnitCtx, 'members'>, id: string): string[] {
  return Object.entries(ctx.members)
    .filter(([, m]) => m.unit === id)
    .map(([k, m]) => m.n || k)
    .sort((a, b) => a.localeCompare(b, 'th'));
}
/** Of `names` (the team's, the deals' ผู้รับผิดชอบ), those in no unit, each once by staffKey. */
export function unassigned(ctx: Pick<UnitCtx, 'units' | 'members'>, names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = staffKey(n);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return !unitOfName(ctx, n);
  });
}
/** A colour slot for a new unit: the first of 1–4 no live unit uses, else grey. */
export function freeSlot(ctx: Pick<UnitCtx, 'units'>): number {
  const used = new Set(unitsOf(ctx).map((u) => u.c));
  for (let c = 1; c <= UNIT_SLOTS; c++) if (!used.has(c)) return c;
  return 0;
}
/** A new unit id, not one of `taken`. */
export function newUnitId(taken: Iterable<string>, seed = Date.now()): string {
  const t = new Set(taken);
  for (let i = 0; ; i++) {
    const id = 'u' + (seed + i).toString(36).slice(-6);
    if (!t.has(id)) return id;
  }
}

// ------------------------------------------------------------------ a deal's split

/** One unit's share of a deal ('' = ยังไม่ระบุหน่วยงาน). */
export interface Share { u: string; p: number }
/**
 * A deal's split: the saved one when it adds up to 100 (±0.05) with distinct units and every share valid,
 * else 100% to its ผู้รับผิดชอบ's unit (`dflt`; `bad` = a saved one was not valid, so it was ignored). A unit
 * that is gone counts as ''. `own`: the ผู้รับผิดชอบ's unit.
 */
export interface DealShare { lines: Share[]; dflt: boolean; bad: boolean; rec: ShareRec | null; own: string }
export const shareSum = (lines: Pick<ShareLine, 'p'>[]) => Math.round(lines.reduce((a, l) => a + (Number.isFinite(l.p) ? l.p : 0), 0) * 10) / 10;
export function shareValid(lines: ShareLine[]): boolean {
  if (!lines.length || lines.some((l) => !pctOk(l.p) || !l.u)) return false;
  if (new Set(lines.map((l) => l.u)).size !== lines.length) return false;
  return Math.abs(shareSum(lines) - 100) <= 0.05;
}
export function shareOf(ctx: UnitCtx, d: Pick<Deal, 'id' | 'resp'>): DealShare {
  const own = unitOfName(ctx, d.resp);
  const rec = ctx.shares[d.id] || null;
  if (rec && shareValid(rec.lines)) {
    const by = new Map<string, number>();
    rec.lines.forEach((l) => {
      const u = ctx.units[l.u] ? l.u : '';
      by.set(u, (by.get(u) || 0) + l.p);
    });
    return { lines: [...by].map(([u, p]) => ({ u, p })), dflt: false, bad: false, rec, own };
  }
  return { lines: [{ u: own, p: 100 }], dflt: true, bad: !!rec, rec, own };
}
/** How a deal's money is attributed (the parts hook, else the deal itself); weights as given, zero dropped. */
export function partsOf(ctx: UnitCtx, d: Deal): Part[] {
  const p = ctx.parts?.(ctx.s, d);
  const ok = (p || []).filter((x) => x && x.deal && Number.isFinite(x.w) && x.w > 0);
  return ok.length ? ok : [{ deal: d, w: 1 }];
}
/** The deal's money goes to other deals first (a joint quotation's header): its own split is not used. */
export const apportioned = (ctx: UnitCtx, d: Deal) => {
  const p = partsOf(ctx, d);
  return p.length !== 1 || p[0].deal.id !== d.id;
};
/** Every unit a deal's money goes to ('' = ยังไม่ระบุหน่วยงาน): what the หน่วยงาน filter matches. */
export function dealUnits(ctx: UnitCtx, d: Deal): string[] {
  const out = new Set<string>();
  partsOf(ctx, d).forEach((x) => shareOf(ctx, x.deal).lines.forEach((l) => out.add(l.u)));
  return [...out];
}
/** "แบ่งเท่ากัน": 100 / n in tenths, the remainder on the first row (3 → 33.4, 33.3, 33.3). */
export function equalSplit(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(1000 / n);
  return Array.from({ length: n }, (_, i) => (i ? base : 1000 - base * (n - 1)) / 10);
}
/** An amount over weights, in satang, the remainder to the largest parts, so the parts add up exactly. */
export function splitSatang(amt: number, ws: number[]): number[] {
  const tot = ws.reduce((a, w) => a + Math.max(0, w), 0);
  if (!ws.length) return [];
  if (tot <= 0) return ws.map((_, i) => (i ? 0 : amt));
  const cents = Math.round(amt * 100);
  const raw = ws.map((w) => (cents * Math.max(0, w)) / tot);
  const out = raw.map(Math.floor);
  let left = cents - out.reduce((a, x) => a + x, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r), w: ws[i] })).sort((a, b) => b.f - a.f || b.w - a.w || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out.map((c) => c / 100);
}

// ------------------------------------------------------------------ rates

/** The rate entry in force on `iso` (the last one starting on or before it; '' starts at the beginning). */
export function rateEntry(u: Pick<UnitRec, 'rates'>, iso: string): UnitRate | null {
  let hit: UnitRate | null = null;
  for (const r of u.rates) if (!r.from || (iso && r.from <= iso)) hit = r;
  return hit;
}
/** The rate (%) for money received on `iso` of a job with `services`: a service's own rate replaces the unit's
 *  (the highest when several match); null = no commission. */
export function rateOn(u: Pick<UnitRec, 'rates'>, iso: string, services: string[] = []): number | null {
  const e = rateEntry(u, iso);
  if (!e) return null;
  const svc = services.map((x) => e.svc?.[x]).filter((x): x is number => x != null);
  return svc.length ? Math.max(...svc) : e.r;
}
/** Whether a unit pays commission at all (now): a rate of its own or by service. */
export const paysComm = (u: Pick<UnitRec, 'rates'>) => {
  const e = u.rates[u.rates.length - 1];
  return !!e && (e.r != null || !!e.svc && Object.keys(e.svc).length > 0);
};
/**
 * A unit's rates after an edit on `today`: unchanged → as they were; no rate yet → the first one, from ''
 * (it prices the money received before too); one saved today already → replaced in place; else a new entry
 * from today (earlier money keeps its rate).
 */
export function withRate(rates: UnitRate[], r: number | null, svc: Record<string, number>, today: string): UnitRate[] {
  const last = rates[rates.length - 1];
  const svcN = Object.fromEntries(Object.entries(svc).filter(([k, n]) => k.trim() && rateOk(n)).sort(([a], [b]) => a.localeCompare(b)));
  const same = (e: UnitRate) => e.r === r && JSON.stringify(Object.fromEntries(Object.entries(e.svc || {}).sort(([a], [b]) => a.localeCompare(b)))) === JSON.stringify(svcN);
  if (last && same(last)) return rates;
  const e: UnitRate = { from: '', r, ...(Object.keys(svcN).length ? { svc: svcN } : {}), d: today };
  if (!last) return [e];
  if (last.d === today) return [...rates.slice(0, -1), { ...e, from: last.from }];
  return [...rates, { ...e, from: today }];
}

// ------------------------------------------------------------------ money by unit

/** One received amount's part for a unit: the line, the deal it counts for (a joint member, else the line's
 *  own), its share of the line (%), the amount, the rate on its day and the commission (not rounded). */
export interface ContribItem { line: CashLine; deal: Deal; u: string; p: number; amt: number; rate: number | null; comm: number }
export interface UnitMoney { u: string; got: number; comm: number; items: ContribItem[] }
/** Money received in a range by unit: `n` amounts (งวด) from `deals` jobs; the commission rounded per unit
 *  (to the satang) at the end, never per amount; `comm` = the sum of the units'. */
export interface Contrib { by: Record<string, UnitMoney>; got: number; n: number; deals: number; comm: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Each unit's part of one received line (parts, then each part's split; exact to the satang). */
export function lineParts(ctx: UnitCtx, l: CashLine): Omit<ContribItem, 'rate' | 'comm'>[] {
  const flat: { deal: Deal; u: string; w: number }[] = [];
  const parts = partsOf(ctx, l.deal);
  const tw = parts.reduce((a, x) => a + x.w, 0);
  parts.forEach((x) => shareOf(ctx, x.deal).lines.forEach((s) => flat.push({ deal: x.deal, u: s.u, w: (x.w / tw) * s.p })));
  const amts = splitSatang(l.amt, flat.map((x) => x.w));
  return flat.map((x, i) => ({ line: l, deal: x.deal, u: x.u, p: Math.round(x.w * 10) / 10, amt: amts[i] }));
}
export function contribIn(ctx: UnitCtx, lines: CashLine[], r: Range): Contrib {
  const out: Contrib = { by: {}, got: 0, n: 0, deals: 0, comm: 0 };
  const deals = new Set<string>();
  for (const l of lines) {
    if (l.kind !== 'got' || !inRange(l.date, r)) continue;
    out.got += l.amt;
    out.n++;
    deals.add(l.deal.id);
    for (const x of lineParts(ctx, l)) {
      const unit = ctx.units[x.u];
      const rate = unit ? rateOn(unit, l.date, x.deal.service) : null;
      const m = out.by[x.u] || (out.by[x.u] = { u: x.u, got: 0, comm: 0, items: [] });
      m.got += x.amt;
      m.items.push({ ...x, rate, comm: rate ? (x.amt * rate) / 100 : 0 });
    }
  }
  out.got = r2(out.got);
  Object.values(out.by).forEach((m) => {
    m.got = r2(m.got);
    m.comm = r2(m.items.reduce((a, x) => a + x.comm, 0));
  });
  out.comm = r2(Object.values(out.by).reduce((a, m) => a + m.comm, 0));
  out.deals = deals.size;
  return out;
}
const ceRange = (be: string, q?: number): Range => {
  const y = +be - 543;
  if (q == null) return { from: `${y}-01-01`, to: `${y}-12-31` };
  const m0 = q * 3 + 1, m1 = m0 + 2;
  return { from: `${y}-${String(m0).padStart(2, '0')}-01`, to: `${y}-${String(m1).padStart(2, '0')}-${m1 === 6 || m1 === 9 ? 30 : 31}` };
};
/** A calendar quarter (0–3) of a Buddhist-era year, or the whole year. */
export type CommPeriod = number | 'year';
export const periodRange = (be: string, q: CommPeriod): Range => ceRange(be, q === 'year' ? undefined : q);
/** The period the commission card opens on: the latest quarter that has ended in the shown year (this
 *  year's first one before it ends), the whole year for another year. */
export function commPeriod0(be: string, today: string): CommPeriod {
  if (String(+today.slice(0, 4) + 543) !== be) return 'year';
  return Math.max(0, Math.floor((+today.slice(5, 7) - 1) / 3) - 1);
}
/** Received money of each calendar quarter of a Buddhist-era year by unit, and the year's (the quarter card). */
export function unitQuarters(ctx: UnitCtx, lines: CashLine[], be: string): { q: Record<string, number>[]; year: Record<string, number> } {
  const q = [0, 1, 2, 3].map((i) => Object.fromEntries(Object.values(contribIn(ctx, lines, ceRange(be, i)).by).map((m) => [m.u, m.got])));
  const year: Record<string, number> = {};
  q.forEach((x) => Object.entries(x).forEach(([u, v]) => (year[u] = r2((year[u] || 0) + v))));
  return { q, year };
}

/** A row of the commission card: a unit (null = ยังไม่ระบุหน่วยงาน), its money, share of the period (%),
 *  the rates it was paid at (or the one in force at the period's end when it got nothing) and its commission. */
export interface CommRow { u: string; unit: Unit | null; got: number; pct: number; rates: number[]; none: boolean; comm: number; items: ContribItem[] }
/**
 * The card's rows: the live units that pay commission or got money in the period, retired ones with money,
 * then ยังไม่ระบุหน่วยงาน when it got any; in the units' order. `end`: the period's last day (the rate shown
 * for a unit without money).
 */
export function commRows(ctx: UnitCtx, c: Contrib, end: string): CommRow[] {
  const rows: CommRow[] = [];
  const pct = (v: number) => (c.got ? Math.round((v / c.got) * 1000) / 10 : 0);
  for (const u of unitsOf(ctx, true)) {
    const m = c.by[u.id];
    if (!m?.got && (u.off || !paysComm(u))) continue;
    const used = [...new Set((m?.items || []).map((x) => x.rate).filter((x): x is number => x != null))].sort((a, b) => a - b);
    const now = rateOn(u, end);
    const rates = m?.items.length ? used : now != null ? [now] : [];
    rows.push({ u: u.id, unit: u, got: m?.got || 0, pct: pct(m?.got || 0), rates, none: !rates.length, comm: m?.comm || 0, items: m?.items || [] });
  }
  const no = c.by[''];
  if (no?.got) rows.push({ u: '', unit: null, got: no.got, pct: pct(no.got), rates: [], none: true, comm: 0, items: no.items });
  return rows;
}
/** "5%", "3–5%" (several rates applied in the period), "" for none. */
export const rateText = (rates: number[]) => (!rates.length ? '' : rates.length === 1 ? `${rates[0]}%` : `${rates[0]}–${rates[rates.length - 1]}%`);
/** The card's worked example: the unit with the most money that pays commission. */
export function howRow(rows: CommRow[]): CommRow | null {
  return rows.filter((r) => r.got > 0 && r.comm > 0).sort((a, b) => b.got - a.got)[0] || null;
}
