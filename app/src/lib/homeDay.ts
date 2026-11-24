/**
 * A day picked on หน้าแรก's calendar (tabs/Home.tsx), listed under it: the TGO round dates that fall on it, then
 * its appointments of แผนติดต่อ by time. Pure, so the list and the calendar's dots agree.
 */
import type { Round, Task } from './types';

/** The dates of a TGO round the team works to (named as on the company drawer's round card). */
export const TGO_DATES = [['doc', 'ส่งเอกสารภายใน'], ['fee', 'ชำระค่าธรรมเนียม'], ['ann', 'ประกาศผล']] as const;

/** One line of a day under the calendar: an appointment of แผนติดต่อ, or a date of a TGO round. */
export interface DayItem { k: string; tm: string; t: string; sub: string; tgo: boolean }

/** A day's TGO round dates, then its appointments by time (no time = ทั้งวัน, last). */
export function dayItems(d: string, tasks: Task[], R: Round[], who: (t: Task) => string, kind: (t: Task) => string): DayItem[] {
  const tgo = R.flatMap((r) => TGO_DATES.filter(([k]) => r[k] === d).map(([k, l]) => ({ k: `tgo-${r.no}-${k}`, tm: 'TGO', t: `TGO รอบ ${r.no}`, sub: l, tgo: true })));
  const apps = tasks.filter((t) => t.date === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  return [...tgo, ...apps.map((t) => ({ k: t.id, tm: t.time || 'ทั้งวัน', t: who(t), sub: kind(t) + (t.done ? ' · ทำแล้ว' : ''), tgo: false }))];
}

/** The days with a TGO round date (the calendar's second dot). */
export const tgoDaySet = (R: Round[]) => new Set(R.flatMap((r) => TGO_DATES.map(([k]) => r[k])));
