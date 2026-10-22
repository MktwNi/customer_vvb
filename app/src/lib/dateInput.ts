/**
 * What a change of a date chip's native input means (components/DateChip.tsx). The browser reports a value on
 * every key typed into the year: "0002-10-22", "0020-10-22", "0202-10-22", then "2027-10-22"; a year that is not
 * valid yet reports "" (year 0). Only a complete day is committed (a four-digit year, 1000 on, a real calendar
 * day). Anything else is the field's draft: shown while it is typed, never saved, and dropped when the field
 * loses focus, so the chip shows the saved date again. Pure, so the rule is unit-tested (dateInput.test.ts).
 */
import { isDay } from './dateRange';

export interface DateInputChange {
  /** the complete day to save, or null (nothing to save yet) */
  commit: string | null;
  /** what the field shows while the year is still being typed ('' when the browser has no day) */
  draft: string;
}

export function dateInputChange(raw: string): DateInputChange {
  return /^[1-9]\d{3}-\d\d-\d\d$/.test(raw) && isDay(raw) ? { commit: raw, draft: '' } : { commit: null, draft: raw };
}

/** What a keyed date field (DateChip, DateField keyed) does with a value the browser reports: the draft it shows
 *  (null: the saved date) and the complete day to save (null: none). */
export function keyedDateStep(raw: string): { draft: string | null; commit: string | null } {
  const r = dateInputChange(raw);
  return r.commit ? { draft: null, commit: r.commit } : { draft: r.draft, commit: null };
}

/** A keyed date field (DateField keyed, the deal's contact date) that loses focus: a field the user cleared as a
 *  whole is an empty date and is saved (''). The browser shows "" with no bad input once every part of the day is
 *  gone; a part left reports bad input and is not saved (the saved date shows again). The browser settles that flag
 *  only after the key, so this is read when the field loses focus, not on the key. A browser that reports no flag
 *  clears nothing. */
export function clearedOnLeave(raw: string, badInput: boolean): boolean {
  return raw === '' && badInput === false;
}
