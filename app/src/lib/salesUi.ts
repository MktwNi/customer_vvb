/** Small pure helpers behind the Sales Tracker screens (no DOM, so they are unit-tested). */
import { beYear, type Deal, type SalesStats } from './sales';

/**
 * A Buddhist-era year typed by a person ("2569", "พ.ศ. 2569", Thai digits too) → `{ year }`.
 * A Christian-era year ("2026") → `{ year: '2569', ce: '2026' }`, for the caller to confirm.
 * Anything else → null.
 */
export function beYearInput(v: string): { year: string; ce?: string } | null {
  const s = v.trim().replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50)).replace(/\s+/g, '');
  let m = /^(?:พ\.?ศ\.?)?(25\d\d)$/.exec(s);
  if (m) return { year: m[1] };
  m = /^(?:ค\.?ศ\.?)?(20\d\d)$/.exec(s);
  if (m) return { year: String(+m[1] + 543), ce: m[1] };
  return null;
}

/** Years offered by the year picker: this year ±1, the one shown, and every year that has deals. */
export function yearOptions(deals: Iterable<Deal>, shown: string, now = beYear()) {
  const ys = new Set([now, String(+now + 1), String(+now - 1), shown]);
  for (const d of deals) ys.add(d.year);
  return [...ys].sort();
}

/** Choices of a ผู้รับผิดชอบ / แหล่งที่มา filter: taken from all of the year's deals (not the rows left
 *  after filtering, or the chosen value would drop out of its own list) and always including it. */
export function facetOptions(deals: Deal[], k: 'resp' | 'referral', chosen = '') {
  const s = new Set(deals.map((d) => d[k] || '(ไม่ระบุ)'));
  if (chosen) s.add(chosen);
  return [...s].sort();
}

/** Win rate (%) of each SOURCE that has deals with a known result — a channel at 0% is kept. */
export function winRateBySource(by: SalesStats['bySource']): [string, number][] {
  return Object.entries(by)
    .filter(([, x]) => x.decided > 0)
    .map(([k, x]) => [k, Math.round((x.yes / x.decided) * 100)]);
}
