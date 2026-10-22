/**
 * บริษัทที่ติดตาม (the watch list, crm.watch: shared by the team when it is connected, else kept in this
 * browser) as the ติดตาม page lists it: each followed company with its next appointment, its row in the
 * Sales Tracker of the year and its owner, in the order of what needs attention first.
 * Pure functions only (no DOM, no engine import at run time), so everything here is unit-tested.
 */
import { addDays, daysBetween, isoTh } from './format';
import { TT } from './constants';
import { isLocalId } from './teamSync';
import { jointRole, trackerStatus, type Deal, type SalesState } from './sales';
import type { CfoStatus, Company, Task } from './types';

/** What decides a followed company's place in the list. */
export interface FollowFacts {
  name: string;
  /** The day of its earliest appointment not done yet; '' = none. */
  next: string;
  cfoSt: CfoStatus;
  /** Days left on the latest CFO certificate (negative once expired). */
  cfoDays: number | null;
  /** The GI level in force ends within 90 days (the "GI ใกล้หมดอายุ" feed). */
  giSoon: boolean;
  giDays: number | null;
}

/**
 * Its group in the order: 0 an appointment due today or already past its day, 1 a certificate about to
 * expire (CFO within the soon window, GI within 90 days), 2 no appointment yet, 3 the rest (an appointment
 * ahead, nothing expiring).
 */
export type FollowRank = 0 | 1 | 2 | 3;

/** Days to the nearest expiry among its expiring certificates; null when none is expiring. */
export function expiringIn(f: Pick<FollowFacts, 'cfoSt' | 'cfoDays' | 'giSoon' | 'giDays'>): number | null {
  const d = [f.cfoSt === 'soon' ? f.cfoDays : null, f.giSoon ? f.giDays : null].filter((x): x is number => x != null);
  return d.length ? Math.min(...d) : null;
}

export function followRank(f: FollowFacts, today: string): FollowRank {
  if (f.next && f.next <= today) return 0;
  if (expiringIn(f) != null) return 1;
  if (!f.next) return 2;
  return 3;
}

/** The list's order: by group, then the oldest appointment first (0), the fewest days left (1), by name
 *  (2), the nearest appointment (3); ties by name. */
export function sortFollow<T extends FollowFacts>(list: T[], today: string): T[] {
  const r = new Map(list.map((x) => [x, followRank(x, today)]));
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'th');
  return list.slice().sort((a, b) => {
    const ra = r.get(a)!, rb = r.get(b)!;
    if (ra !== rb) return ra - rb;
    if (ra === 0 || ra === 3) return a.next.localeCompare(b.next) || byName(a, b);
    if (ra === 1) return expiringIn(a)! - expiringIn(b)! || byName(a, b);
    return byName(a, b);
  });
}

/** When an appointment is, in words, and its colour: past its day (red), today (amber), else plain. */
export function apptWhen(date: string, today: string): { text: string; kind: 'bad' | 'warn' | '' } {
  if (date < today) return { text: `เลยกำหนด ${daysBetween(date, today).toLocaleString('en-US')} วัน`, kind: 'bad' };
  if (date === today) return { text: 'วันนี้', kind: 'warn' };
  if (date === addDays(today, 1)) return { text: 'พรุ่งนี้', kind: '' };
  return { text: `อีก ${daysBetween(today, date).toLocaleString('en-US')} วัน`, kind: '' };
}

/** "โทร · 14 ต.ค. 2569 10:00": the appointment's type, day and time. */
export const apptLine = (t: Pick<Task, 'type' | 'date' | 'time'>) =>
  `${(TT.find((x) => x[0] === t.type) || TT[0])[1]} · ${isoTh(t.date)}${t.time ? ' ' + t.time : ''}`;

/** The words of the Sales Tracker column: the row's status in the year, or that it is not there. */
export const NOT_IN_TRACKER = 'ยังไม่อยู่ใน Sales Tracker';

/**
 * The followed ids that are this company: its own and any of a row since merged into it (a follow made
 * before two rows were merged into one company is that company's). Empty = not followed. Unfollowing
 * removes them all. `resolve`: an id to the id of its company now (GccEngine.canonical).
 */
export const followIdsOf = (watch: readonly number[], cid: number, resolve: (id: number) => number) =>
  watch.filter((id) => id === cid || resolve(id) === cid);

/** Said under a followed company that only this device has (from the TGO website sync, on a connected
 *  team): its follow, like its other records, is not shared, so teammates do not see it in their list. */
export const LOCAL_ONLY = 'อยู่ในเครื่องนี้เท่านั้น';

/** The grey line under a followed company's name: province, GCC code and, on a connected team, that it is
 *  on this device only. */
export const followMeta = (c: Pick<Company, 'id' | 'code'>, prov: string, team: boolean) =>
  [prov || 'ไม่ระบุจังหวัด', c.code, team && isLocalId(c.id) ? LOCAL_ONLY : ''].filter(Boolean).join(' · ');

/** One followed company as the list shows it. */
export interface FollowRow extends FollowFacts {
  c: Company;
  /** Its earliest appointment not done yet. */
  task: Task | null;
  /** Its own row in the Sales Tracker of the year (a joint quotation's header is not one). */
  deal: Deal | null;
  /** That row's status words (trackerStatus), '' when it has none. */
  status: string;
  /** How many jobs (rows) the company has in the Sales Tracker of the year: a company may have several, one per
   *  service; `deal` is one of them ("· อีก 1 งาน" beside it). */
  jobs: number;
  /** ผู้รับผิดชอบ: the company's, else its row's in the year, else its newest row's. */
  owner: string;
}

/** What the list reads from the engine (GccEngine has all of it). */
export interface FollowSrc {
  crm: { watch: number[]; owners: Record<string, string> };
  sales: SalesState;
  company(id: number): Company | undefined;
  tasksOf(id: number): Task[];
  dealsOf(id: number): Deal[];
}

/**
 * The followed companies, each once (two followed rows merged into one company count once; a company no
 * longer in the data is left out), in the list's order. `year`: the Sales Tracker year (B.E.).
 */
export function followRows(e: FollowSrc, year: string, today: string): FollowRow[] {
  const seen = new Set<number>();
  const rows: FollowRow[] = [];
  for (const id of e.crm.watch) {
    const c = e.company(id);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    const task = e.tasksOf(c.id).filter((t) => !t.done).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))[0] || null;
    const deals = e.dealsOf(c.id).filter((d) => jointRole(e.sales, d) !== 'header');
    // in the year: an open job before a closed one, then the newest
    const inYear = deals.filter((d) => d.year === year);
    const deal = inYear.sort((a, b) => (a.jobStatus === 'open' ? 0 : 1) - (b.jobStatus === 'open' ? 0 : 1) || b.at.localeCompare(a.at))[0] || null;
    const newest = deals.slice().sort((a, b) => b.year.localeCompare(a.year) || b.at.localeCompare(a.at))[0];
    rows.push({
      c, name: c.name, next: task ? task.date : '', task,
      cfoSt: c.cfoSt, cfoDays: c.days, giSoon: !!c.fl?.giSoon, giDays: c.giDays,
      deal, status: deal ? trackerStatus(e.sales, deal, today) : '', jobs: inYear.length,
      owner: e.crm.owners[c.id] || deal?.resp || newest?.resp || '',
    });
  }
  return sortFollow(rows, today);
}

/** The picked keys of บริษัทที่ติดตาม (components/BulkBar.tsx followSel) are kept under the quick filter they were
 *  picked in: the key is this prefix and the filter's words. The page reads the filter back from the key when it
 *  opens again, so the picks and the filter it shows stay together (no "เปลี่ยนคำค้นหา" for a page coming back). */
export const FOLLOW_SEL_PREFIX = 'follow\u0001';
export const followSelKey = (q: string) => FOLLOW_SEL_PREFIX + q.trim();
export const followQOf = (key: string) => (key.startsWith(FOLLOW_SEL_PREFIX) ? key.slice(FOLLOW_SEL_PREFIX.length) : '');

/** The rows the quick filter keeps (`prov`: a row's province as the list shows it); the list itself when nothing
 *  is typed. Its companies are what "เลือกทั้งหมด" picks: every one of them, not only the page shown. */
export function followFilter(rows: FollowRow[], q: string, prov: (r: FollowRow) => string): FollowRow[] {
  return q.trim() ? rows.filter((r) => followMatch(q, r, prov(r))) : rows;
}

/** How many of them need something: an appointment past its day, one today, a certificate about to
 *  expire, no appointment at all, not in the Sales Tracker of the year. */
export function followCounts(rows: FollowRow[], today: string) {
  return {
    late: rows.filter((r) => r.next && r.next < today).length,
    today: rows.filter((r) => r.next === today).length,
    expiring: rows.filter((r) => expiringIn(r) != null).length,
    noPlan: rows.filter((r) => !r.next).length,
    notIn: rows.filter((r) => !r.deal).length,
  };
}

/** The quick filter: every word typed is somewhere in the name, province, owner, code or contact (any
 *  case, spaces between words ignored). */
export function followMatch(q: string, r: FollowRow, prov: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.c.hay || r.c.name, prov, r.owner].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
