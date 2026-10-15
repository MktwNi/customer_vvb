/**
 * Per-customer colours (แผนติดต่อ, the Sales dashboard's week view): every customer has one home colour,
 * derived from who it is (lib/ckey.ts), the same on every page and every device. Nothing is stored or
 * synced, so an old open tab has nothing to wipe and every role sees the same colours.
 *
 * - Ten quiet hues; none is red, orange, amber, yellow or green (those mean late / due / paid).
 * - A colour is always a bar, a stripe or a dot beside the customer's name in ink, never coloured text
 *   (a customer TYPE tag is coloured text) and never the only cue: with ten colours, two customers can
 *   share one, and the written name tells them apart.
 * - The slot order and the hash are frozen: reordering, inserting or a new hash recolours every customer.
 *   Append only, with a CUST_COLOR_V bump (the tests pin both).
 * Pure functions only.
 */
import type { CSSProperties } from 'react';
import { ckeyOfCompany, ckeyOfDeal, localId, nameKey, validCKey } from './ckey';
import type { Deal } from './sales';

/** Bump only if the palette or the hash changes (every customer gets another colour then). */
export const CUST_COLOR_V = 1;

/** One colour: the mark (`c`: bar, stripe, dot, avatar fill), its tint (`bg`: a chip's background), the
 *  monogram text on the mark (`on`: ≥ 4.5:1) and its Thai name. */
export interface CustColor { readonly c: string; readonly bg: string; readonly on: string; readonly name: string }
const WHITE = '#FFFFFF', INK = '#0E1430';
/** The validated palette in slot order (dataviz validator, light mode on white: every mark ≥ 3:1 on
 *  white, ink on every tint ≥ 14:1, adjacent slots apart for colour-blind readers). */
export const CUST_PAL: readonly CustColor[] = Object.freeze([
  { c: '#B04E90', bg: '#F4E6EF', on: WHITE, name: 'บานเย็น' },
  { c: '#17A1C8', bg: '#DFF2F7', on: INK, name: 'ฟ้า' },
  { c: '#4A488D', bg: '#E6E5EF', on: WHITE, name: 'คราม' },
  // teal; named "น้ำทะเล" (the owner reads "no green")
  { c: '#089487', bg: '#DCF0EE', on: INK, name: 'น้ำทะเล' },
  { c: '#805EBD', bg: '#EDE8F6', on: WHITE, name: 'ม่วง' },
  { c: '#D97298', bg: '#FAEBF1', on: INK, name: 'ชมพู' },
  { c: '#3065BE', bg: '#E2E9F6', on: WHITE, name: 'น้ำเงิน' },
  { c: '#7A2C7E', bg: '#ECE1ED', on: WHITE, name: 'ม่วงเข้ม' },
  { c: '#8C87E8', bg: '#EFEEFC', on: INK, name: 'ม่วงอ่อน' },
  { c: '#00769D', bg: '#DBECF1', on: WHITE, name: 'ฟ้าเข้ม' },
].map((x) => Object.freeze(x)));

/** What custKey needs of the engine: the company an id resolves to (merged ids to their primary). */
export interface CustLookup {
  company(id: number): { id: number; name: string } | undefined;
  canonical(id: number): number;
}
/** The fallback when a name is too short to be a name key ('t:' + the title as written): it never hashes
 *  '' (every such customer would share one colour). */
const titleKey = (title: string) => 't:' + String(title || '').replace(/\s+/g, ' ').trim();

/** Who a task's (or any company row's) customer is: the shared company id of `gid` (merged duplicates
 *  resolve to their primary), the name key of a TGO-sync company (its id differs on each device) or of
 *  `title` when there is no company, else 't:' + title. */
export function custKey(e: CustLookup, gid: number | null | undefined, title: string): string {
  const c = gid != null ? e.company(gid) : undefined;
  // a company that is not here (yet): its shared id is still who it is, as for a deal (ckeyOfDeal)
  const k = c ? ckeyOfCompany(c) : gid != null && !localId(gid) ? String(e.canonical(gid)) : nameKey(title);
  return k || titleKey(c ? c.name : title);
}
/** Who a deal's customer is: ckeyOfDeal (the company it is linked to, else its client's name key), else
 *  't:' + client. A deal linked to a company and that company's tasks have the same key. */
export function dealKey(e: CustLookup, d: Pick<Deal, 'gid' | 'client'>): string {
  return ckeyOfDeal(d, d.gid != null ? e.company(d.gid) : undefined) || titleKey(d.client);
}

/** The home slot of a key: FNV-1a (32-bit) over its UTF-16 code units, modulo the palette. */
export function homeSlot(ckey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ckey.length; i++) {
    h ^= ckey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % CUST_PAL.length;
}
/** A customer's slot: a team's chosen colour when one is valid (the optional override, not built: it
 *  would come from shared records, so it is checked like any row read), else its home slot. */
export function slotOf(ckey: string, overrides?: Readonly<Record<string, unknown>>): number {
  const o = overrides && Object.prototype.hasOwnProperty.call(overrides, ckey) ? overrides[ckey] : undefined;
  if (typeof o === 'number' && Number.isInteger(o) && o >= 0 && o < CUST_PAL.length && validCKey(ckey)) return o;
  return homeSlot(ckey);
}
/** A customer's colour. */
export const custColor = (ckey: string) => CUST_PAL[slotOf(ckey)];
/** The CSS custom properties the plan's marks read (`--c` mark, `--cb` tint). */
export const ccVars = (ckey: string): CSSProperties => {
  const p = custColor(ckey);
  return { '--c': p.c, '--cb': p.bg } as CSSProperties;
};
