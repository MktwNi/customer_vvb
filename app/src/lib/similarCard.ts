import { norm } from './core';

/**
 * Would an exact-name submit merge the new customer into this registry company (core.ts build): the names match once
 * normalised, the company is the only one of its name, it has a juristic id, and the juristic id typed is none or the
 * company's own string (core.ts compares the ids as typed). Only then is the company's card redundant. The rule is the
 * merge's own, narrowed: a juristic id under another name, a partial name, or the id typed with dashes is not merged, so
 * there the card is the way to reuse the company and stays.
 */
export function reusedOnSubmit(typed: { name: string; jur: string }, co: { name: string; jur: string; sameName: number }): boolean {
  return co.sameName === 1 && !!co.jur && norm(co.name).length >= 3 && norm(typed.name) === norm(co.name) && (typed.jur === '' || typed.jur === co.jur);
}

/**
 * The registry-match card of the add-customer dialog (components/AddCustomer.tsx), for a job being added in `year`: left
 * off a company whose jobs are all in other years, when the submit reuses it anyway (reusedOnSubmit). It stays for a
 * company with no job at all (nothing says it is the same work) and for one with a job in `year`.
 */
export function cardHides(c: { jobYears: readonly string[]; reused: boolean }, year: string): boolean {
  return c.reused && c.jobYears.length > 0 && !c.jobYears.includes(year);
}

/**
 * The year the registry-match card is for: the job's year when a job is added in the Sales Tracker (`a.deal`), the year of
 * the deal the dialog was opened from when it links a company to one (`a.link`, linkedYear), else none: every match is
 * offered, as for a customer added from the menu.
 */
export function cardYear(a: { deal: boolean; link?: string }, jobYear: string, linkedYear: string | undefined): string | undefined {
  return a.deal ? jobYear : a.link ? linkedYear : undefined;
}
