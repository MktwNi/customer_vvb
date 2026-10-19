import { EMPTY_FILTERS, type Filters } from './search';
import { addDays, fmtN, isoTh, nextWork } from './format';
import type { CapId } from './caps';
import type { Cert, Company } from './types';

/**
 * Many search results at once (the search page's selection and its action bar): which rows are picked,
 * what the account may do with them, and the words said before and after. Pure: the page keeps the
 * picked keys in a Set (lib/bulk.ts createSel), the engine does the writes in one batch (engine.bulk).
 */

/** Acting on more companies than this asks first (and the dialogs warn). */
export const BIG = 200;
/** The most companies one action changes (ติดตาม, Sales Tracker, นัด, ผู้รับผิดชอบ): the whole registry
 *  (55,000) picked by mistake would put that many rows on the team's sheet for every teammate to pull.
 *  More can still be exported. */
export const MAX_BULK = 5000;
/** A result row: a company (view บริษัท) or a CFO certificate (view ใบรับรอง CFO). */
export type Row = Company | Cert;
const isCert = (r: Row): r is Cert => 'cid' in r;
/** What picks a row: the company's id, or the certificate's (a company can have several certificates). */
export const rowKey = (r: Row) => (isCert(r) ? r.cid : r.id);
/** The company a row is about. */
export const rowCo = (r: Row) => (isCert(r) ? (r.co ? r.co.id : r.gid) : r.id);

/** The filters that decide which rows there are, in a fixed order (the order of sorting and the page do
 *  not change them): when this changes, what was picked is let go. `q`: the query the list was made with
 *  (the page defers typing). */
export function selKey(f: Filters, q = f.q) {
  return (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).filter((k) => k !== 'sort').map((k) => (k === 'q' ? q : f[k])).join('\u0001');
}

/** The view a selKey was made in (it comes first). */
export const keyView = (key: string): 'co' | 'cert' => (key.split('\u0001')[0] === 'cert' ? 'cert' : 'co');

/** The picked rows among the results, in the results' order, and the state of "เลือกทั้งหมด". */
export function selView(sel: ReadonlySet<number>, rows: readonly Row[]) {
  const keys: number[] = [];
  if (sel.size) for (const r of rows) if (sel.has(rowKey(r))) keys.push(rowKey(r));
  const n = keys.length;
  return { keys, n, all: n > 0 && n === rows.length, mixed: n > 0 && n < rows.length };
}
/** One row picked or let go. */
export function toggleKey(sel: ReadonlySet<number>, key: number) {
  const s = new Set(sel);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  return s;
}
/** "เลือกทั้งหมด": every result (not only the page shown); when all are picked, none. */
export function toggleAll(sel: ReadonlySet<number>, rows: readonly Row[]) {
  return selView(sel, rows).all ? new Set<number>() : new Set(rows.map(rowKey));
}
/** Only the picked keys still among the results (a company that left them, e.g. after เลิกติดตาม with the
 *  ติดตาม filter on); the same Set when nothing went. */
export function pruneSel(sel: ReadonlySet<number>, rows: readonly Row[]) {
  if (!sel.size) return sel;
  const there = new Set(rows.map(rowKey));
  let gone = false;
  for (const k of sel) if (!there.has(k)) gone = true;
  if (!gone) return sel;
  return new Set([...sel].filter((k) => there.has(k)));
}
/** The picked rows themselves (the CSV), in the results' order. */
export function pickedRows<R extends Row>(sel: ReadonlySet<number>, rows: readonly R[]) {
  return rows.filter((r) => sel.has(rowKey(r)));
}
/** The companies of the picked rows, each once, in the results' order. */
export function pickedCos(sel: ReadonlySet<number>, rows: readonly Row[]) {
  const seen = new Set<number>(), out: number[] = [];
  for (const r of rows)
    if (sel.has(rowKey(r))) {
      const id = rowCo(r);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  return out;
}

/** The actions the bar offers this account (lib/caps.ts): following and ผู้รับผิดชอบ are ลูกค้าและผู้ติดต่อ,
 *  sending is ดีลและขั้นตอน on a Sales Tracker the account sees, planning is นัดหมาย; CSV is everyone's.
 *  `cos`: how many companies are picked (over MAX_BULK: the export only); `followed`: how many of them the
 *  team follows (ติดตาม while some are not, เลิกติดตาม while some are). */
export interface BulkActs { follow: boolean; unfollow: boolean; tracker: boolean; plan: boolean; owner: boolean; csv: true; /** more picked than one change may take (MAX_BULK) */ tooMany: boolean }
export function bulkActs(can: (c: CapId) => boolean, followed: number, cos: number): BulkActs {
  const ok = cos <= MAX_BULK, cust = ok && can('edit.cust');
  return { follow: cust && followed < cos, unfollow: cust && followed > 0, tracker: ok && can('edit.deal') && can('view.sales'), plan: ok && can('edit.task'), owner: cust, csv: true, tooMany: !ok };
}
/** Which of the picked companies the team follows already (`watch`: the team's list). */
export function followSplit(ids: readonly number[], watch: ReadonlySet<number>) {
  let on = 0;
  for (const id of ids) if (watch.has(id)) on++;
  return { on, off: ids.length - on };
}
/** Of the picked companies: who has which ผู้รับผิดชอบ now (none: ''). */
export function ownerSplit(ids: readonly number[], owners: Readonly<Record<string | number, string>>, name: string) {
  let same = 0, other = 0, none = 0;
  for (const id of ids) {
    const o = owners[id] || '';
    if (o === name) same++;
    else if (o) other++;
    else none++;
  }
  return { same, other, none };
}

// ------------------------------------------------------------------ words

const unitOf = (view: 'co' | 'cert') => (view === 'cert' ? 'ใบรับรอง' : 'บริษัท');
/** The bar's count: "เลือก 15 บริษัท", "เลือก 12 ใบรับรอง (10 บริษัท)". */
export const selWord = (view: 'co' | 'cert', n: number, cos: number) =>
  `เลือก ${fmtN(n)} ${unitOf(view)}` + (view === 'cert' && cos !== n ? ` (${fmtN(cos)} บริษัท)` : '');
/** "เลือกทั้งหมด 15 บริษัท" */
export const allWord = (view: 'co' | 'cert', n: number) => `เลือกทั้งหมด ${fmtN(n)} ${unitOf(view)}`;
/** What is said when a change of filters let the picked rows go. */
export const clearedWord = (n: number, view: 'co' | 'cert') => `ล้างที่เลือก ${fmtN(n)} ${unitOf(view)}แล้ว เพราะเปลี่ยนคำค้นหรือตัวกรอง`;

export const followNote = (added: number, already: number) =>
  added ? `ติดตามเพิ่ม ${fmtN(added)} บริษัท${already ? ` (ติดตามอยู่แล้ว ${fmtN(already)})` : ''}` : `ติดตามอยู่แล้วทั้ง ${fmtN(already)} บริษัท`;
export const unfollowNote = (removed: number, notOn: number) =>
  removed ? `เลิกติดตาม ${fmtN(removed)} บริษัท${notOn ? ` (ไม่ได้ติดตามอยู่ ${fmtN(notOn)})` : ''}` : 'บริษัทที่เลือกไม่ได้อยู่ในรายการติดตาม';
export const trackerNote = (added: number, skipped: number, year: string) =>
  added ? `ส่งเข้า Sales Tracker ${fmtN(added)} ราย${skipped ? ` (ข้าม ${fmtN(skipped)} รายที่มีในปี ${year} แล้ว)` : ''}` : `ทุกบริษัทที่เลือกมีในตารางปี ${year} แล้ว`;
export function ownerNote(name: string, r: { changed: number; same: number; kept: number }) {
  const extra = [r.same ? `เป็นอยู่แล้ว ${fmtN(r.same)}` : '', r.kept ? `ไม่เปลี่ยนคนเดิม ${fmtN(r.kept)}` : ''].filter(Boolean).join(' · ');
  const head = !r.changed ? (name ? `${name} เป็นผู้รับผิดชอบอยู่แล้ว` : 'บริษัทที่เลือกยังไม่มีผู้รับผิดชอบอยู่แล้ว') : name ? `ตั้ง ${name} เป็นผู้รับผิดชอบ ${fmtN(r.changed)} บริษัท` : `ล้างผู้รับผิดชอบ ${fmtN(r.changed)} บริษัท`;
  return head + (r.changed && extra ? ` (${extra})` : '');
}
export const planNote = (n: number, first: string, last: string) =>
  `นัดติดต่อ ${fmtN(n)} บริษัท ` + (first === last ? `วันที่ ${isoTh(first)}` : `${isoTh(first)} ถึง ${isoTh(last)}`);

/** Why the bar offers only the export: too many picked for one change. */
export const tooManyWord = (n: number) => `เลือกไว้ ${fmtN(n)} บริษัท ติดตาม ส่ง นัด หรือตั้งผู้รับผิดชอบได้ครั้งละไม่เกิน ${fmtN(MAX_BULK)} บริษัท กรองให้แคบลงก่อน (ส่งออก CSV ได้)`;
/** The question before acting on more than BIG companies at once (follow / stop following). */
export function confirmWords(act: 'follow' | 'unfollow', n: number, skip: number) {
  return act === 'follow'
    ? { title: `ติดตาม ${fmtN(n)} บริษัท?`, body: `บริษัทที่เลือกจะเข้ารายการติดตามของทีม ทุกคนในทีมเห็นรายการนี้${skip ? ` (ติดตามอยู่แล้ว ${fmtN(skip)} บริษัท จะข้ามไป)` : ''}`, ok: `ติดตาม ${fmtN(n)} บริษัท` }
    : { title: `เลิกติดตาม ${fmtN(n)} บริษัท?`, body: 'บริษัทที่เลือกจะออกจากรายการติดตามของทีม ทุกคนในทีมจะไม่เห็นในรายการนี้อีก', ok: `เลิกติดตาม ${fmtN(n)} บริษัท` };
}
/** The Sales Tracker dialog's warning for many rows: "จะเพิ่ม 2,228 แถวในตารางปี 2569". */
export const trackerWarn = (n: number, year: string) => `จะเพิ่ม ${fmtN(n)} แถวในตารางปี ${year} ของทั้งทีม ตรวจหมวดและปีให้ถูกก่อนส่ง`;

/**
 * The day of each appointment when `n` are made from `start`, `perDay` a working day (0 = all on `start`):
 * the engine's addTasks gives them these days, and the dialog says the last one before saving.
 */
export function taskDates(start: string, n: number, perDay: number) {
  const out: string[] = [];
  let d = start, k = 0;
  for (let i = 0; i < n; i++) {
    if (perDay && k >= perDay) {
      d = nextWork(addDays(d, 1));
      k = 0;
    }
    if (perDay && k === 0) d = nextWork(d);
    k++;
    out.push(d);
  }
  return out;
}
/** First and last day of a spread, and on how many days. */
export function spread(start: string, n: number, perDay: number) {
  const ds = taskDates(start, n, perDay);
  return { first: ds[0] || start, last: ds[ds.length - 1] || start, days: new Set(ds).size };
}

// ------------------------------------------------------------------ the picked keys

/** A Set of picked keys that a page reads with useSyncExternalStore: a click re-renders the page that
 *  shows it, never the whole app; kept while the person goes to another page and back. `key`: the
 *  filters the keys were picked under (selKey). */
export interface SelState { key: string; ids: ReadonlySet<number> }
export function createSel() {
  let s: SelState = { key: '', ids: new Set() };
  const ls = new Set<() => void>();
  return {
    get: () => s,
    set(n: SelState) {
      if (n.key === s.key && n.ids === s.ids) return;
      s = n;
      ls.forEach((f) => f());
    },
    sub(f: () => void) {
      ls.add(f);
      return () => void ls.delete(f);
    },
  };
}
export type SelStore = ReturnType<typeof createSel>;
