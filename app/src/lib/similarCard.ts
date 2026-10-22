/**
 * The registry-match card of the add-customer dialog (components/AddCustomer.tsx), for a job being added in `year`. The
 * card is about this year's job, so it is left off a company whose jobs are all in other years. It stays for: a company
 * with no job at all (nothing says it is the same work); one with a job in `year`; a company that shares its name with
 * another (the one picked decides); and a company with no juristic id: a new customer typed with its name is merged
 * into a registry company only through that id (core.ts build), so without one the card is the way to reuse it.
 */
export function cardHides(c: { jobYears: readonly string[]; sameName: number; hasJur: boolean }, year: string): boolean {
  return c.sameName === 1 && c.hasJur && c.jobYears.length > 0 && !c.jobYears.includes(year);
}
