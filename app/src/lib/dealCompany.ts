/**
 * The company a deal typed by its client name gets (engine linkDealCompany): the team's company of the same
 * normalised name (core.ts norm: legal-form words, brackets and spaces left out, so "บริษัท X จำกัด" and "X" are
 * one company), else a new customer of that name, given the id every browser gives that name, so two browsers
 * adding it at once make one company. Pure: the engine does the writing.
 */
import { norm } from './core';
import { CUSTOM_ID_MIN, isLocalId } from './teamSync';
import { placeholderName } from './sales';

/**
 * The team's company of the name `name`: a registry row or one added by hand (a company on this device only, from
 * the TGO website sync, is not the team's). A blank name or a placeholder ("ลูกค้าใหม่") matches none, and a partial
 * name is not the same company ("เอสซีจี" is not "เอสซีจี (ประเทศไทย)"). Registry first when two match, then the
 * lowest id: the list's order differs from browser to browser (rows arrive in the order each one pulled them), and the
 * same company must come out of every browser.
 */
export function findCompanyByName<T extends { id: number; name: string }>(name: string, cos: readonly T[]): T | undefined {
  if (placeholderName(name)) return undefined;
  const k = norm(name);
  const same = cos.filter((c) => !isLocalId(c.id) && norm(c.name) === k).sort((a, b) => a.id - b.id);
  return same.find((c) => c.id < CUSTOM_ID_MIN) ?? same[0];
}

/**
 * The id a company added for `name` gets: the same on every browser for the same normalised name (a 53-bit hash of
 * it, in the custom-company id range the random ids come from), so two browsers adding it at once make one company.
 */
export function customIdOf(name: string): number {
  let h1 = 0x811c9dc5, h2 = 0x5bd1e995;
  for (const ch of norm(name)) {
    const cp = ch.codePointAt(0)!;
    h1 = Math.imul(h1 ^ cp, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ cp, 0x2c1b3c6d) >>> 0;
  }
  return CUSTOM_ID_MIN + ((h1 * 0x200000 + (h2 & 0x1fffff)) % 8e12);
}
