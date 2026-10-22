/**
 * Keeping a closed job for a later follow-up (เก็บไว้ติดตาม) and starting its next cycle (เปิดรอบใหม่).
 *
 * - A single job closed with "ปิดแต่เก็บไว้ติดตาม" keeps a recontact date (`recontact`, ISO). It is still a closed
 *   job (the ปิดงาน tab, the counts, the Dashboard); the tab lists those jobs at its top, รอติดต่อใหม่, by date.
 *   A job reopened loses its date; clearing the date returns it to a plain ปิดงาน.
 * - เปิดรอบใหม่ starts a NEW job of the same company for a later year (`from`: the job it continues). It takes the
 *   company, the contact details, who looks after it, where it sits and its services; nothing of the work (steps,
 *   documents, quotations, payments, the plan, the result). The old job is not changed beyond its history line.
 * - A joint quotation (its header or a company of it) closes and reopens as one, as before: no recontact, no new cycle.
 * Pure functions only (no engine, no DOM).
 */
import { isoTh, pad } from './format';
import { beYear, jointRole, type Deal, type SalesState } from './sales';

/** The closing choice, and the words around the date (plain Thai, lib/sales ปิดงาน). */
export const KEEP_LABEL = 'ปิดแต่เก็บไว้ติดตาม';
export const KEEP_HINT = 'จะขึ้นในรายการ “รอติดต่อใหม่” ตามวันที่';
export const RECONTACT_LABEL = 'ติดต่อใหม่วันที่';
export const WAIT_TITLE = 'รอติดต่อใหม่';
export const DUE_WORD = 'ถึงกำหนดแล้ว';
export const CYCLE_LABEL = 'เปิดรอบใหม่';

/** A real calendar date written yyyy-mm-dd, or '' (anything else, 2569-02-30 included). */
export function isoDay(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : '';
}

/** The same day one year later; 29 February goes to 28 February. */
export function yearLater(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate(); // the last day of month m in the next year
  return `${y + 1}-${pad(m)}-${pad(Math.min(d, last))}`;
}

/** What is wrong with a recontact date typed for a job closed (or kept) today: '' when it is fine. A date
 *  already past makes no sense for a follow-up that is not yet made. */
export function recontactErr(v: string, today: string): string {
  if (!v) return 'ใส่วันที่ติดต่อใหม่';
  if (!isoDay(v)) return 'วันที่ไม่ถูกต้อง';
  if (v < today) return 'วันที่ติดต่อใหม่ต้องเป็นวันนี้หรือหลังจากนี้';
  return '';
}

/** A job's recontact date: set on a closed single job, a real date; '' otherwise (an open job, a joint quotation's
 *  row, a date that is not one). */
export function recontactOf(s: SalesState, d: Pick<Deal, 'id' | 'jobStatus' | 'recontact'>): string {
  return d.jobStatus === 'closed' && jointRole(s, d) === 'plain' ? isoDay(d.recontact) : '';
}

/** Is a recontact date due: on or before today. */
export const recontactDue = (date: string, today: string) => !!date && date <= today;

/**
 * The ปิดงาน tab's list (รอติดต่อใหม่): the closed single jobs with a recontact date, of every year, by the date
 * (the earliest first), then by company name, then by id so the order never changes between two reads.
 */
export function recontactList(s: SalesState, deals: readonly Deal[]): Deal[] {
  return deals
    .map((d) => ({ d, date: recontactOf(s, d) }))
    .filter((x) => !!x.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.d.client.localeCompare(b.d.client, 'th') || a.d.id.localeCompare(b.d.id))
    .map((x) => x.d);
}

/** A list row's words for its date: "ถึงกำหนดแล้ว" on or before today, else '' (the date itself is shown). */
export const dueWords = (date: string, today: string) => (recontactDue(date, today) ? DUE_WORD : '');

/** The card's line for a kept job: "เก็บไว้ติดตาม · ติดต่อใหม่ 6 ต.ค. 2570". */
export const keptLine = (date: string) => `เก็บไว้ติดตาม · ติดต่อใหม่ ${isoTh(date)}`;

/** The years a new cycle may start in: the tracker's years and the next year, each once, in order, and only those
 *  after the job's own year (a new cycle is a later job, never a second one in the same year). */
export function cycleYears(deals: readonly Pick<Deal, 'year'>[], from: string, next: string): string[] {
  const ys = new Set([...deals.map((d) => d.year), next]);
  return [...ys].filter((y) => /^\d{4}$/.test(y) && +y > +from).sort((a, b) => +a - +b);
}

/** The year a new cycle starts in when the person changes nothing: the next year, when it is offered. */
export const cycleDefault = (years: readonly string[], next: string) => (years.includes(next) ? next : years[0] || '');

/** The next year as the tracker writes years (Buddhist era), counted from `iso` (today). */
export const nextYear = (iso?: string) => String(+beYear(iso) + 1);

/** Why this job may not start a new cycle, said plainly; '' when it may. The account's right is checked by the
 *  engine (edit.deal on its own work), so a viewer reads the same reason here as the engine refuses with. */
export function cycleBlock(s: SalesState, d: Pick<Deal, 'id' | 'jobStatus'>): string {
  if (d.jobStatus !== 'closed') return 'งานนี้ยังเปิดอยู่ ปิดงานก่อนจึงเปิดรอบใหม่ได้';
  if (jointRole(s, d) !== 'plain') return 'ใบเสนอราคาร่วมเปิดรอบใหม่ไม่ได้';
  return '';
}

/** The fields a new cycle takes from the job it continues (`from`): the company and its contact, who looks after
 *  it, where it sits, its services and sources. contactDate is empty, the job is open, nothing else is copied. */
export function cycleFields(d: Deal, year: string): Partial<Deal> {
  return {
    year,
    section: d.section,
    gid: d.gid,
    client: d.client,
    contactName: d.contactName,
    phone: d.phone,
    email: d.email,
    resp: d.resp,
    referral: d.referral,
    source: d.source.slice(),
    service: d.service.slice(),
    contactDate: '',
    jobStatus: 'open',
    closedDate: '',
    from: d.id,
  };
}

/** The history lines of a new cycle: the old job "เปิดรอบใหม่ปี <year>", the new one "ต่อจากรอบปี <old year>". */
export const cycleLogs = (oldYear: string, year: string) => ({ old: `เปิดรอบใหม่ปี ${year}`, next: `ต่อจากรอบปี ${oldYear}` });

/** A stable 53-bit hash of a text, in base 36: the same on every browser (the way customIdOf hashes a company name). */
function hashId(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x5bd1e995;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    h1 = Math.imul(h1 ^ cp, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ cp, 0x2c1b3c6d) >>> 0;
  }
  return (h1 * 0x200000 + (h2 & 0x1fffff)).toString(36);
}
/** The id of the job a new cycle starts: the same on every browser for one old job and year. So two browsers that start
 *  the same cycle before they sync write the same record, create-only (engine newCycle): it is one job, not two. */
export const cycleIdOf = (from: string, year: string) => `cy-${hashId(JSON.stringify([from, year]))}`;
/** The id of one history line of a cycle: 'old' on the old job, 'next' on the new one. The same on every browser. */
export const cycleLogIdOf = (from: string, year: string, side: 'old' | 'next') => `cl-${hashId(JSON.stringify([from, year, side]))}`;
/** A new cycle's job keeps the year it started in: its id is the cycle of its old job for that year (cycleIdOf), so a job
 *  moved to another year would hold the id of the year it left, and a new cycle of that year would be refused for a job
 *  that is no longer there. */
export const isCycleJob = (d: { id: string; year: string; from?: string }) => !!d.from && d.id === cycleIdOf(d.from, d.year);
/** Why a new cycle's job cannot change its year (engine updateDeal and jointYearBlock, DealPanel). */
export const CYCLE_YEAR_BLOCK = 'งานรอบใหม่ย้ายปีไม่ได้ · ถ้าเปิดผิดปี ให้ผู้ดูแลระบบลบงานนี้แล้วเปิดรอบใหม่ในปีที่ถูกต้อง';
