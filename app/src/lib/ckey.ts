/**
 * Who a customer is (`ckey`), the same key the customer-types work uses: the primary id of a registry
 * company or of one added by hand, or `n:<name key>` for a Sales Tracker client with no company and for a
 * company from the TGO website sync (its id differs on each device). Merged duplicates resolve to their
 * primary, so one customer has one key on every device.
 *
 * A copy of `nameKey`, `validCKey`, `ckeyOfCompany` and `ckeyOfDeal` from the customer-types branch
 * (`lib/ctypes.ts`, not merged yet), with the same semantics: when that branch lands, import them from
 * there and delete this file. Pure functions only.
 */
import { norm } from './core';
import type { Deal } from './sales';

/** Longest name key (after "n:"), as ctypes CT_KEY_MAX. */
export const CKEY_MAX = 200;

/** A company from the TGO website sync: its id differs on each device (the same ranges as teamSync.ts
 *  isLocalId; checked in the tests). */
export const localId = (id: number) => id >= 900000 && id < 1e12;

/** The name key of a client or company name: 'n:' + norm(name), at most CKEY_MAX characters; '' when
 *  shorter than 3 (too likely to stand for two customers). */
export function nameKey(name: unknown): string {
  let k = norm(name).slice(0, CKEY_MAX);
  if (/[\ud800-\udbff]$/.test(k)) k = k.slice(0, -1); // never half a character
  return k.length >= 3 ? 'n:' + k : '';
}
/** A key a shared record may be written under: a shared company id, or a name key. */
export function validCKey(k: string): boolean {
  if (/^\d{1,16}$/.test(k)) return +k > 0 && !localId(+k);
  return k.startsWith('n:') && k.length >= 5 && k.length <= CKEY_MAX + 2 && !/\s/.test(k);
}
/** A company's key: its primary id, or its name key when it comes from the TGO website sync (the id
 *  would mean another company on a teammate's device). */
export const ckeyOfCompany = (c: { id: number; name: string }) => (localId(c.id) ? nameKey(c.name) : String(c.id));
/** A deal's customer's key: its company's (`co`, the company its gid resolves to here), or its client's
 *  name key when it is not linked. */
export function ckeyOfDeal(d: Pick<Deal, 'gid' | 'client'>, co?: { id: number; name: string }): string {
  if (d.gid != null && !localId(d.gid)) return co ? ckeyOfCompany(co) : String(d.gid);
  return nameKey(d.client);
}
