/**
 * The แผนติดต่อ month calendar's words and lists (tabs/Plan.tsx), as pure functions: what a day cell shows,
 * the legend "ลูกค้าในเดือนนี้" and its one-customer filter. Every entry carries its customer's key
 * (lib/custColor.ts custKey / dealKey), so a filter, a colour and a legend row always agree.
 */
import { shortName } from './salesUi';

/** The name on a calendar chip: the short name without the country words ("ซากิโนมิยะ ประเทศไทย",
 *  "เอ็มอีพี เฮคซ่า (ประเทศไทย)", "เอ็นเอ็มบี-มินีแบ ไทย" lose them). Never empty. */
export function chipName(name: string): string {
  const s = shortName(name);
  const t = s.replace(/\s*\(?ประเทศไทย\)?/g, ' ').replace(/\s+ไทย\s*$/, '').replace(/\s+/g, ' ').trim();
  return t || s;
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

/** A day cell's name for screen readers: "12 ต.ค. 2569 (วันนี้) · 4 งาน: ซากิโนมิยะ ประเทศไทย, ดีไวน์สตาร์ช ·
 *  รับเงิน 1 งวด" (each company once). */
export function cellLabel(day: string, today: boolean, names: readonly string[], pays: number): string {
  const uniq = [...new Set(names)];
  return `${day}${today ? ' (วันนี้)' : ''} · ${names.length} งาน${uniq.length ? ': ' + uniq.join(', ') : ''}${pays ? ` · รับเงิน ${pays} งวด` : ''}`;
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
/** The entries of the customer shown alone (`only`), or all of them. */
export function onlyCust<T extends { ck: string }>(xs: readonly T[], only: string): T[] {
  return only ? xs.filter((x) => x.ck === only) : xs.slice();
}
