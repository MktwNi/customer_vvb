/**
 * The แผนติดต่อ month calendar's words and lists (tabs/Plan.tsx), as pure functions: what a day cell shows,
 * the legend "ลูกค้าในเดือนนี้" and its one-customer filter. Every entry carries its customer's key
 * (lib/custColor.ts custKey / dealKey), so a filter, a colour and a legend row always agree.
 */
import { shortName } from './salesUi';

const TH = 'ประเทศไทย';
/** The name on a calendar chip: the short name without the country words ("ซากิโนมิยะ ประเทศไทย",
 *  "เอ็มอีพี เฮคซ่า (ประเทศไทย)", "เอ็นเอ็มบี-มินีแบ ไทย" lose them). Only a word of its own or one in
 *  brackets goes: a name that has it inside a word ("ซิงเกอร์ประเทศไทย", "เชฟรอนประเทศไทยสำรวจและผลิต")
 *  or after "แห่ง" ("ธนาคารแห่งประเทศไทย", "การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย") keeps it. Never empty. */
export function chipName(name: string): string {
  const s = shortName(name);
  // "(ประเทศไทย)" as a word of its own, also when glued to the name or typed "(ประเทศไทย )"
  const w = s.replace(/\(\s*ประเทศไทย\s*\)/g, ` (${TH}) `).split(/\s+/).filter(Boolean);
  const keep = w.filter((x, i) => !((x === `(${TH})` || (x === TH && i > 0)) && !(w[i - 1] || '').endsWith('แห่ง')));
  // a trailing "ไทย" of its own ("เอ็นเอ็มบี-มินีแบ ไทย")
  if (keep.length > 1 && keep[keep.length - 1] === 'ไทย' && !keep[keep.length - 2].endsWith('แห่ง')) keep.pop();
  return keep.join(' ') || s;
}

/** A day cell's lines on a computer: every entry when there are 3 or fewer, else the first 2 and
 *  "อีก N" for the rest (3 lines at most). */
export function cellLines<T>(entries: readonly T[], max = 3): { shown: T[]; more: number } {
  if (entries.length <= max) return { shown: entries.slice(), more: 0 };
  return { shown: entries.slice(0, max - 1), more: entries.length - (max - 1) };
}
/** A day cell's dots on a phone: up to 3, then "อีก N" on a line of its own. */
export function cellDots<T>(entries: readonly T[], max = 3): { shown: T[]; more: number } {
  return { shown: entries.slice(0, max), more: Math.max(0, entries.length - max) };
}

/** An installment in a day cell, for its label: the client's short name and whether it is late. */
export interface PayName { name: string; late: boolean }
/** A day cell's name for screen readers: "12 ต.ค. 2569 (วันนี้) · 4 งาน: ซากิโนมิยะ ประเทศไทย, ดีไวน์สตาร์ช ·
 *  รับเงิน 1 งวด: ไทยออยล์ เอนเนอร์ยี่" (each company once). A late installment is said in words, as its
 *  chip's red frame is not seen: "· รับเงิน 1 งวด เลยกำหนด: …" (all of the day's), or "(เลยกำหนด)" after
 *  each late one when only some are. */
export function cellLabel(day: string, today: boolean, names: readonly string[], pays: readonly PayName[]): string {
  const uniq = [...new Set(names)];
  const lateN = pays.filter((p) => p.late).length, allLate = lateN > 0 && lateN === pays.length;
  const payNames = [...new Set(pays.map((p) => p.name + (p.late && !allLate ? ' (เลยกำหนด)' : '')))];
  const pay = pays.length ? ` · รับเงิน ${pays.length} งวด${allLate ? ' เลยกำหนด' : ''}: ${payNames.join(', ')}` : '';
  return `${day}${today ? ' (วันนี้)' : ''} · ${names.length} งาน${uniq.length ? ': ' + uniq.join(', ') : ''}${pay}`;
}

/** One customer of the legend: its key, the name it is listed by and its appointments this month. */
export interface LegendItem { ck: string; name: string; n: number }
/** "ลูกค้าในเดือนนี้": the customers with appointments in `month` ('YYYY-MM'), each once with its count,
 *  sorted by name (Thai order: a leading vowel does not count). */
export function monthCustomers(entries: readonly { date: string; ck: string; name: string }[], month: string): LegendItem[] {
  const by = new Map<string, LegendItem>();
  for (const x of entries) {
    if (x.date.slice(0, 7) !== month) continue;
    const it = by.get(x.ck);
    if (it) it.n++;
    else by.set(x.ck, { ck: x.ck, name: x.name, n: 1 });
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'th') || a.ck.localeCompare(b.ck));
}

/** The customer the page shows alone: the pressed legend key while that customer still has an entry
 *  (an appointment or an instalment, in any month), else '' (everyone). */
export function activeCust(only: string, keys: Iterable<string>): string {
  if (!only) return '';
  for (const k of keys) if (k === only) return only;
  return '';
}
/** The UI keys that open แผนติดต่อ on day `d` ('YYYY-MM-DD') with every customer shown: a link from
 *  another page (the Dashboard's "อีก N นัด", later the bell's rows) never lands on a day filtered to
 *  the one customer pressed in the legend earlier in the session, which would hide what it promised. */
export const planDayLink = (d: string) => ({ tab: 'plan' as const, calM: d.slice(0, 7), calDay: d, plCust: '' });
/** The entries of the customer shown alone (`only`), or all of them. */
export function onlyCust<T extends { ck: string }>(xs: readonly T[], only: string): T[] {
  return only ? xs.filter((x) => x.ck === only) : xs.slice();
}
