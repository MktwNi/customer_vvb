/**
 * Date ranges for the filters (Sales Tracker, its Dashboard): local calendar days 'YYYY-MM-DD' compared
 * as strings, both ends included; weeks start on Monday; the ready-made ranges are about today inside the
 * year shown (a Buddhist-era year), clamped to it; and the Thai words of a range ("1–12 ต.ค. 2569").
 * Pure: no DOM, and today is always passed in. Date maths goes through format.ts (UTC arithmetic on
 * date-only strings), never through the getters of a local Date.
 */
import { TH_M, addDays, dow, pad } from './format';

/** Which date of a deal a range is about (sales.ts basisDates). */
export type DateBasis = 'contact' | 'added' | 'result' | 'paid' | 'due' | 'closed';
export const BASES: DateBasis[] = ['contact', 'added', 'result', 'paid', 'due', 'closed'];
export type DatePreset = 'today' | 'week' | 'last7' | 'next7' | 'month' | 'prevMonth' | 'nextMonth' | 'quarter' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | 'custom';
const PRESETS: DatePreset[] = ['today', 'week', 'last7', 'next7', 'month', 'prevMonth', 'nextMonth', 'quarter', 'q1', 'q2', 'q3', 'q4', 'custom'];
/** A date filter. 'year' (ทั้งปี) is never stored: no date filter is `null`. A named preset is worked out
 *  again from today at every use (a session that runs past midnight stays right); `from`/`to` are what
 *  it was when applied, and are the range itself only for 'custom'. */
export interface DateF { basis: DateBasis; preset: Exclude<DatePreset, 'year'>; from: string; to: string }
export interface Range { from: string; to: string }

/** A real calendar day as 'YYYY-MM-DD' ('2026-02-30', '2026-13-01' and '2026-10-00' are not): false for
 *  anything else, never a throw (a month 13 is an Invalid Date that the round-trip cannot print). */
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && addDays(s, 0) === s;
export const inRange = (x: string, r: Range) => !!x && r.from <= x && x <= r.to;
/** Monday of the week of `iso`. */
export const weekStart = (iso: string) => addDays(iso, -((dow(iso) + 6) % 7));
/** The last day of the month of `iso`. */
export function monthEnd(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
/** The 1st of the month `n` months from the month of `iso`. */
export function monthStart(iso: string, n = 0) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}
/** A Buddhist-era year (as the tracker files deals) → its Christian-era number. */
export const ceOf = (be: string) => +be - 543;
/** How far the calendar and a custom range may go: the year before to the year after the one shown. */
export const navBounds = (be: string): Range => ({ from: `${ceOf(be) - 1}-01-01`, to: `${ceOf(be) + 1}-12-31` });

export interface PresetItem { k: DatePreset; label: string; r: Range | null }
/**
 * The ready-made ranges of the year `be`. When today is in that year: วันนี้, สัปดาห์นี้, 7 วันล่าสุด (or
 * 7 วันข้างหน้า when `forward`, for due dates), เดือนนี้, เดือนที่แล้ว (or เดือนหน้า; neither across the year
 * end). Every year: its four calendar quarters (this year they show as one row, ไตรมาสนี้ ringed; a stored
 * 'quarter' still means this one: presetKey). Then ทั้งปี (no filter) and กำหนดเอง. Every range is
 * clamped to the year (7 วันล่าสุด on 3 Jan is 1–3 ม.ค.). A 7-day range the same as one before it is not
 * offered twice (7 วันข้างหน้า on a Monday is สัปดาห์นี้, 7 วันล่าสุด on a Sunday too, and on 31 Dec it is วันนี้).
 */
export function presetList(be: string, today: string, forward = false): PresetItem[] {
  const all = allPresets(be, today, forward);
  return all.filter((p, i) => p.k !== 'quarter' && (!(p.k === 'last7' || p.k === 'next7') || !all.slice(0, i).some((q) => sameRange(q.r, p.r))));
}
/** The quarter (1–4) today is in when it is in the year `be`, else 0. */
export const thisQuarter = (be: string, today: string) => (today.slice(0, 4) === String(ceOf(be)) ? Math.ceil(+today.slice(5, 7) / 3) : 0);
const sameRange = (a: Range | null, b: Range | null) => !!a && !!b && a.from === b.from && a.to === b.to;
/** The offered preset for `k` (presetList): itself, or for a 7-day range not offered today the one with
 *  the same days; undefined when the year has no such range (เดือนนี้ in another year). */
export function presetKey(be: string, today: string, forward: boolean, k: DatePreset): PresetItem | undefined {
  const list = presetList(be, today, forward), own = list.find((p) => p.k === k);
  if (own) return own;
  const r = allPresets(be, today, forward).find((p) => p.k === k)?.r || null;
  return list.find((p) => sameRange(p.r, r));
}
function allPresets(be: string, today: string, forward: boolean): PresetItem[] {
  const Y = ceOf(be), lo = `${Y}-01-01`, hi = `${Y}-12-31`;
  const clamp = (r: Range): Range => ({ from: r.from < lo ? lo : r.from, to: r.to > hi ? hi : r.to });
  const quarter = (n: number): Range => ({ from: `${Y}-${pad(n * 3 - 2)}-01`, to: monthEnd(`${Y}-${pad(n * 3)}-01`) });
  const out: PresetItem[] = [];
  if (today.slice(0, 4) === String(Y)) {
    const t = today, m = +t.slice(5, 7), ws = weekStart(t);
    out.push({ k: 'today', label: 'วันนี้', r: { from: t, to: t } });
    out.push({ k: 'week', label: 'สัปดาห์นี้', r: clamp({ from: ws, to: addDays(ws, 6) }) });
    out.push(forward ? { k: 'next7', label: '7 วันข้างหน้า', r: clamp({ from: t, to: addDays(t, 6) }) } : { k: 'last7', label: '7 วันล่าสุด', r: clamp({ from: addDays(t, -6), to: t }) });
    out.push({ k: 'month', label: 'เดือนนี้', r: { from: monthStart(t), to: monthEnd(t) } });
    if (!forward && m > 1) out.push({ k: 'prevMonth', label: 'เดือนที่แล้ว', r: { from: monthStart(t, -1), to: monthEnd(monthStart(t, -1)) } });
    if (forward && m < 12) out.push({ k: 'nextMonth', label: 'เดือนหน้า', r: { from: monthStart(t, 1), to: monthEnd(monthStart(t, 1)) } });
    // the one stored before the quarters had a row of their own: worked out from today, never listed
    out.push({ k: 'quarter', label: 'ไตรมาสนี้', r: quarter(Math.ceil(m / 3)) });
  }
  for (let n = 1; n <= 4; n++) out.push({ k: ('q' + n) as DatePreset, label: `ไตรมาส ${n}`, r: quarter(n) });
  out.push({ k: 'year', label: `ทั้งปี ${be}`, r: null });
  out.push({ k: 'custom', label: 'กำหนดเอง', r: null });
  return out;
}

/** The same preset when the basis turns to (or from) due dates: 7 วันล่าสุด ↔ 7 วันข้างหน้า, เดือนที่แล้ว ↔
 *  เดือนหน้า; any other stays itself. */
export const twinOf = (k: DatePreset): DatePreset => ({ last7: 'next7', next7: 'last7', prevMonth: 'nextMonth', nextMonth: 'prevMonth' } as Partial<Record<DatePreset, DatePreset>>)[k] ?? k;

/** The range a stored filter means today: a named preset worked out again (when this year still offers
 *  it), else its stored days. */
export function resolveDate(f: DateF, be: string, today: string): Range {
  if (f.preset !== 'custom') {
    // every range of the year, those presetList leaves out as a twin too (their days are the same)
    const p = allPresets(be, today, f.basis === 'due').find((x) => x.k === f.preset);
    if (p?.r) return p.r;
  }
  return { from: f.from, to: f.to };
}

/** A stored date filter made safe (state from an older build, an import, a test): an unknown basis or
 *  preset drops it; days must be real ('2026-02-30' is not), are put in order, and a missing end is the
 *  start; a custom range outside the calendar's bounds for `be` is dropped. */
export function normDateF(v: unknown, be: string): DateF | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Partial<DateF>;
  if (!BASES.includes(x.basis as DateBasis) || !PRESETS.includes(x.preset as DatePreset)) return null;
  let from = x.from, to = isDay(x.to) ? x.to : from;
  if (!isDay(from) || !isDay(to)) return null;
  if (from > to) [from, to] = [to, from];
  const b = navBounds(be);
  if (x.preset === 'custom' && (from < b.from || to > b.to)) return null;
  return { basis: x.basis as DateBasis, preset: x.preset as DateF['preset'], from, to };
}

const parts = (iso: string) => iso.split('-').map(Number);
/**
 * A range in Thai words, Buddhist-era years: "12 ต.ค. 2569" (a day), "ต.ค. 2569" (a whole month),
 * "ต.ค. – ธ.ค. 2569", "ธ.ค. 2569 – ม.ค. 2570" (whole months), "1–12 ต.ค. 2569", "15 ก.ย. – 12 ต.ค. 2569",
 * "15 ธ.ค. 2569 – 15 ม.ค. 2570". `dropYear`: no year when both ends are in that year (the KPI caption).
 */
export function rangeTh(r: Range, o: { dropYear?: string } = {}) {
  const [fy, fm, fd] = parts(r.from), [ty, tm, td] = parts(r.to);
  const fb = fy + 543, tb = ty + 543, M = (m: number) => TH_M[m - 1];
  const yr = fb === tb && String(fb) === o.dropYear ? '' : ' ' + fb;
  if (r.from === r.to) return `${fd} ${M(fm)}${yr}`;
  if (fd === 1 && r.to === monthEnd(r.to)) {
    if (fy === ty && fm === tm) return `${M(fm)}${yr}`;
    if (fy === ty) return `${M(fm)} – ${M(tm)}${yr}`;
    return `${M(fm)} ${fb} – ${M(tm)} ${tb}`;
  }
  if (fy === ty && fm === tm) return `${fd}–${td} ${M(fm)}${yr}`;
  if (fy === ty) return `${fd} ${M(fm)} – ${td} ${M(tm)}${yr}`;
  return `${fd} ${M(fm)} ${fb} – ${td} ${M(tm)} ${tb}`;
}
