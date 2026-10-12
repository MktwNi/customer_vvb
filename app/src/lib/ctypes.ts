/**
 * Customer types (ประเภทลูกค้า): CFO · CFP · ที่ปรึกษา · ทวนสอบ · แพลตฟอร์ม · T-VER, and any type an admin
 * adds. A type belongs to the customer (a company, or a Sales Tracker client that is not in the
 * registry) for every year; a deal's Services only suggest one: the suggestion is computed, shown with
 * its reason and confirmed with one click, never stored or applied by itself. "ประเภท" alone already
 * means the legal-entity type (search, CSV): this attribute is always labelled "ประเภทลูกค้า".
 *
 * Shared records (teamSync.ts keyOf):
 * - `ctag/<ckey>/<typeId>` = CTag, one customer's answer for one type: 'y', or a remembered "no" (a
 *   dismissed suggestion, a type removed by hand). One record per customer per type, so two people (or
 *   a bulk action) ticking different types never overwrite each other. Sales may write and delete it.
 * - `scfg/ct.<typeId>` = the admin's changes to one type, edited field by field. It sits under scfg/,
 *   which only admins may write, on the team script too (Code.gs SALES_DENY): no new deployment, and
 *   older builds skip an scfg name they don't know (applyRow), and never send one. The six defaults
 *   live here in code and a record overrides them field by field, so nobody has to seed anything.
 *
 * A customer key (`ckey`) is the primary id of a registry company or of one added by hand, or
 * `n:<name key>` for a Sales Tracker client with no company, and for a company from the TGO website
 * sync (its id differs on each device). Reading one customer takes every key that stands for it (merged
 * ids, a TGO-sync company's name); per type the answer with the latest `at` wins (cmpTag).
 *
 * An answer given on a deal row remembers the deal (`d`) and belongs to that deal's customer wherever
 * the deal goes: linked, re-linked, unlinked, its client renamed. The engine also moves such answers to
 * the deal's new key (moveTagOps), leaving a mark (`mv`) on the old one instead of deleting it, so every
 * record is kept by time, never by which push reached the sheet last: a teammate's answer made meanwhile
 * on the old key (or pushed late) is still read for the right customer, and a mark never hides it.
 * Merging duplicates moves nothing: a company reads every id it is made of, so a refused or undone
 * merge leaves each company with its own answers.
 * Pure functions only (no engine, no DOM), so everything here is unit-tested.
 */
import { norm } from './core';
import type { Deal } from './sales';
import type { CTag, CTypeDef } from './types';

export const CT_LABEL = 'ประเภทลูกค้า';
/** A type id: what tags store (never shown). */
export const CT_ID_RE = /^[a-z0-9_-]{1,24}$/;
export const CT_NAME_MAX = 40;
export const CT_DESC_MAX = 120;
/** Services one type may list. */
export const CT_SVC_MAX = 60;
/** Longest name key (after "n:"): the record key stays far below the 500 characters the team script keeps. */
export const CT_KEY_MAX = 200;
/** Most customers one bulk action changes (each type is one record per customer). */
export const CT_BULK_MAX = 500;
/** The scfg/ name prefix of a type's record (scfg/ct.<id>); list names (sections…) never have a dot. */
export const CT_CFG = 'ct.';

/** The six validated hues (ink on tint; mark = swatch): slot c of a type. No amber, orange or red, so a
 *  tag never reads as a status. The CSS names each slot after its default type (`.ct.cfo` … `.ct.tvr`). */
export const CT_SLOTS = [
  { cls: 'cfo', ink: '#1E4BAF', tint: '#EAF0FC', mark: '#2F6BD6' },
  { cls: 'cfp', ink: '#056E64', tint: '#E1F3F0', mark: '#14A08C' },
  { cls: 'con', ink: '#6236A8', tint: '#F1EBFA', mark: '#7E57C9' },
  { cls: 'vvb', ink: '#952866', tint: '#FAE9F2', mark: '#B83686' },
  { cls: 'plt', ink: '#00627A', tint: '#DDF3F8', mark: '#119CBC' },
  { cls: 'tvr', ink: '#2F6E2C', tint: '#E7F3E5', mark: '#3E8E2E' },
] as const;
/** The class of a type's colour (`ct <cls>`), or `off` for a retired one (a neutral grey tag). */
export const ctClass = (d: Pick<CTypeDef, 'c' | 'off'>) => (d.off ? 'off' : CT_SLOTS[d.c]?.cls || CT_SLOTS[0].cls);

/** The starting list. The services each one suggests were confirmed by the owner (Course Training and
 *  CF-EVENT suggest none); the admin can change all of it. */
export const DEFAULT_CTYPES: readonly CTypeDef[] = [
  { id: 'cfo', n: 'CFO', d: 'ลูกค้างาน CFO (คาร์บอนฟุตพริ้นท์องค์กร)', c: 0, o: 0, svc: ['CFO', 'CF'], at: '', by: '' },
  { id: 'cfp', n: 'CFP', d: 'คาร์บอนฟุตพริ้นท์ผลิตภัณฑ์', c: 1, o: 1, svc: ['CFP'], at: '', by: '' },
  { id: 'con', n: 'ที่ปรึกษา', d: 'งานที่ปรึกษา', c: 2, o: 2, svc: ['LESS', 'Program Development'], at: '', by: '' },
  { id: 'vvb', n: 'ทวนสอบ', d: 'งานทวนสอบ (VVB)', c: 3, o: 3, svc: ['VVB'], at: '', by: '' },
  { id: 'plt', n: 'แพลตฟอร์ม', d: 'ใช้แพลตฟอร์มของเรา', c: 4, o: 4, svc: ['GCT'], at: '', by: '' },
  { id: 'tvr', n: 'T-VER', d: 'โครงการคาร์บอนเครดิต T-VER', c: 5, o: 5, svc: ['T-VER', 'CC'], at: '', by: '' },
];

/** Where a tag came from, for "ระบุโดย หมิว · 6 ต.ค. 2569" and help text. */
export const CT_SRC_TH: Record<CTag['src'], string> = { hand: 'ระบุเอง', deal: 'ยืนยันจากงานขาย', bulk: 'ตั้งพร้อมกันหลายบริษัท', new: 'ระบุตอนเพิ่มลูกค้า' };

/** A type as stored: only the fields the admin set (the id is in the record key). */
export type CTypeRec = Partial<Omit<CTypeDef, 'id'>>;
/** Who a customer is: a company id (the primary of merged rows), or a name key ('n:…') for a Sales
 *  Tracker client not linked to a company ('d:<deal id>' when its name is too short to be a key: such a
 *  client counts, but cannot be tagged, nor be suggested a type, until it is renamed or linked). */
export type Cust = number | string;
export type CustTags = Record<string, Record<string, CTag>>;

/** A company from the TGO website sync: its id differs on each device (the same ranges as
 *  teamSync.ts isLocalId; checked in the tests). */
export const localId = (id: number) => id >= 900000 && id < 1e12;

// ------------------------------------------------------------------ keys

/** The name key of a client or company name: 'n:' + norm(name), at most CT_KEY_MAX characters; '' when
 *  shorter than 3 (too likely to stand for two customers). */
export function nameKey(name: unknown): string {
  let k = norm(name).slice(0, CT_KEY_MAX);
  if (/[\ud800-\udbff]$/.test(k)) k = k.slice(0, -1); // never half a character
  return k.length >= 3 ? 'n:' + k : '';
}
/** A key a tag may be written under: a shared company id, or a name key. */
export function validCKey(k: string): boolean {
  if (/^\d{1,16}$/.test(k)) return +k > 0 && !localId(+k);
  return k.startsWith('n:') && k.length >= 5 && k.length <= CT_KEY_MAX + 2 && !/\s/.test(k);
}
/** Where a company's tags are written: its primary id, or its name key when it comes from the TGO
 *  website sync (the id would mean another company on a teammate's device). */
export const ckeyOfCompany = (c: { id: number; name: string }) => (localId(c.id) ? nameKey(c.name) : String(c.id));
/** Where a deal's customer's tags are written: its company's (`co`, the company its gid resolves to
 *  here), or its client's name key when it is not linked. */
export function ckeyOfDeal(d: Pick<Deal, 'gid' | 'client'>, co?: { id: number; name: string }): string {
  if (d.gid != null && !localId(d.gid)) return co ? ckeyOfCompany(co) : String(d.gid);
  return nameKey(d.client);
}
/** `<ckey>/<typeId>` of a ctag record split at its LAST "/" (a name key may hold one: "SET/mai"), or
 *  null when either part is not valid. */
export function parseCTagKey(rest: string): { ckey: string; t: string } | null {
  const j = rest.lastIndexOf('/');
  if (j <= 0) return null;
  const ckey = rest.slice(0, j), t = rest.slice(j + 1);
  return CT_ID_RE.test(t) && validCKey(ckey) ? { ckey, t } : null;
}

// ------------------------------------------------------------------ records (checked like toDeal)

const SRCS = ['hand', 'deal', 'bulk', 'new'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 40) : '');
/** A tag as this app can use it, or null: a malformed row is skipped, never breaks the screen. */
export function toCTag(v: unknown): CTag | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.s !== 'y' && o.s !== 'n') return null;
  const t: CTag = { s: o.s, at: iso(o.at), by: str(o.by, 100), src: SRCS.includes(o.src as string) ? (o.src as CTag['src']) : 'hand' };
  if (typeof o.d === 'string' && /^[^/\s]{1,100}$/.test(o.d)) t.d = o.d;
  if (typeof o.m === 'number' && Number.isInteger(o.m) && o.m > 0 && o.m < 1e6) t.m = o.m;
  if (typeof o.mv === 'string' && o.mv) t.mv = o.mv.slice(0, CT_KEY_MAX + 2);
  return t;
}
/** A type record as this app can use it (only the fields that are valid), or null when not an object. */
export function toCTypeDef(v: unknown): CTypeRec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, r: CTypeRec = {};
  if (typeof o.n === 'string' && o.n.trim()) r.n = o.n.trim().slice(0, CT_NAME_MAX);
  if (typeof o.d === 'string') r.d = o.d.trim().slice(0, CT_DESC_MAX);
  if (typeof o.c === 'number' && Number.isInteger(o.c) && o.c >= 0 && o.c < CT_SLOTS.length) r.c = o.c;
  if (typeof o.o === 'number' && isFinite(o.o)) r.o = o.o;
  if (Array.isArray(o.svc)) r.svc = [...new Set(o.svc.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 200)))].slice(0, CT_SVC_MAX);
  if (typeof o.off === 'string') r.off = iso(o.off).slice(0, 10);
  r.at = iso(o.at);
  r.by = str(o.by, 100);
  return r;
}

// ------------------------------------------------------------------ the list

/** The first colour slot no type in use has (else they repeat in order). */
export function freeSlot(defs: CTypeDef[]): number {
  const used = new Set(defs.filter((d) => !d.off).map((d) => d.c));
  for (let i = 0; i < CT_SLOTS.length; i++) if (!used.has(i)) return i;
  return defs.filter((d) => !d.off).length % CT_SLOTS.length;
}
/**
 * The list: the defaults with the team's changes on top, field by field, then the types admins added
 * (a record without a name, or with an id this build cannot use, is left out), in list order. Retired
 * types stay in it (`off`): tags still show them, CSV names them, the Sales Tracker filters by them.
 */
export function mergeDefs(stored: Record<string, CTypeRec> = {}): CTypeDef[] {
  const put = (d: CTypeDef, r?: CTypeRec | null): CTypeDef => {
    const x: CTypeDef = { ...d, ...(r || {}), id: d.id, svc: (r?.svc || d.svc).slice() };
    if (!x.off) delete x.off;
    return x;
  };
  const out = DEFAULT_CTYPES.map((d) => put(d, stored[d.id]));
  const ids = new Set(out.map((d) => d.id));
  Object.keys(stored)
    .sort()
    .forEach((id) => {
      const r = stored[id];
      if (ids.has(id) || !CT_ID_RE.test(id) || !r || !r.n) return;
      out.push(put({ id, n: r.n, c: r.c ?? freeSlot(out), o: r.o ?? out.length, svc: [], at: '', by: '' }, r));
    });
  return out.sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** Types that can still be picked (not retired). */
export const activeDefs = (defs: CTypeDef[]) => defs.filter((d) => !d.off);
/** Which type a deal service suggests: types in use, in list order; the first that lists a service has
 *  it (one service, one type — the admin page moves a service, a concurrent edit may still list it twice). */
export function svcToType(defs: CTypeDef[]): Map<string, string> {
  const m = new Map<string, string>();
  defs.forEach((d) => !d.off && d.svc.forEach((s) => !m.has(s) && m.set(s, d.id)));
  return m;
}
/** Type ids that are in the list, in list order (whatever order they were added in). */
export function orderTypes(ids: Iterable<string>, defs: CTypeDef[]): string[] {
  const want = new Set(ids);
  return defs.filter((d) => want.has(d.id)).map((d) => d.id);
}
/** Current names in list order, joined with " · " (retired ones too): the CSV cell, a tag group's title. */
export function typeNames(ids: Iterable<string>, defs: CTypeDef[]): string {
  const want = new Set(ids);
  return defs.filter((d) => want.has(d.id)).map((d) => d.n).join(' · ');
}
/** An id for a type an admin adds: 't' + 4 base-36 characters, not taken. */
export function newTypeId(taken: Iterable<string>, rnd = Math.random): string {
  const t = new Set(taken);
  for (;;) {
    const id = 't' + Math.floor(rnd() * 36 ** 4).toString(36).padStart(4, '0');
    if (!t.has(id)) return id;
  }
}
/** What is wrong with a type name ('' = fine): empty, too long, or another type (retired ones too) has it. */
export function typeNameError(n: string, defs: CTypeDef[], id = ''): string {
  const v = n.trim();
  if (!v) return 'ใส่ชื่อประเภทลูกค้า';
  if (v.length > CT_NAME_MAX) return `ชื่อยาวได้ไม่เกิน ${CT_NAME_MAX} ตัวอักษร`;
  if (defs.some((d) => d.id !== id && d.n.trim().toLowerCase() === v.toLowerCase())) return 'มีประเภทลูกค้าชื่อนี้แล้ว';
  return '';
}

// ------------------------------------------------------------------ answers

/**
 * Which of two versions of one record is newer (> 0: `a`): the later `at`; at the same `at` the later
 * move (`m`), then a moved answer's mark over a "no" (never suggested again) over a "yes". Every browser
 * keeps the newer one, whatever order the rows reach it in (an older build's tab may push a change late).
 */
export function cmpTag(a: CTag, b: CTag): number {
  if (a.at !== b.at) return a.at > b.at ? 1 : -1;
  const m = (a.m || 0) - (b.m || 0);
  if (m) return m;
  const r = (x: CTag) => (x.mv ? 2 : x.s === 'n' ? 1 : 0);
  return r(a) - r(b);
}
/** Of two answers for one type, the one that counts (cmpTag; the first when equal). */
export function pickTag(a: CTag | undefined, b: CTag | undefined): CTag | undefined {
  if (!a || !b) return a || b;
  return cmpTag(b, a) > 0 ? b : a;
}
/** Each type's answer that counts over several keys' records (merged companies, name keys); a moved
 *  answer's mark is no answer. */
export function unionTags(recs: (Record<string, CTag> | undefined)[]): Map<string, CTag> {
  const m = new Map<string, CTag>();
  recs.forEach((r) => Object.entries(r || {}).forEach(([t, v]) => v && !v.mv && m.set(t, pickTag(m.get(t), v)!)));
  return m;
}

/**
 * Moving a deal's answers to its new key (`to`): the deal linked to a company, re-linked, unlinked, or
 * its client renamed. `from` = the old key's records, `take` = those that go with the deal. Each goes to
 * `to` as the deal's (`d`), one move later (`m`), unless `to` already has that answer, or a newer one;
 * the old key gets a mark at the answer's own time (a teammate's newer answer there stays the answer),
 * or keeps it (`keep`: another deal not linked to a company still uses the name). Applying the result
 * twice changes nothing more.
 */
export function moveTagOps(
  from: Record<string, CTag> | undefined, to: Record<string, CTag> | undefined, toKey: string, deal: string, keep: boolean, take: (v: CTag) => boolean,
): { set: { t: string; v: CTag }[]; mark: { t: string; v: CTag }[] } {
  const set: { t: string; v: CTag }[] = [], mark: { t: string; v: CTag }[] = [];
  Object.entries(from || {}).forEach(([t, v]) => {
    if (!v || v.mv || !take(v)) return;
    const m = (v.m || 0) + 1, cur = to?.[t];
    const nv: CTag = { ...v, d: deal, m };
    if (!cur || (cur.mv ? cmpTag(nv, cur) > 0 : cur.s !== v.s && cmpTag(nv, cur) > 0)) set.push({ t, v: nv });
    if (!keep) mark.push({ t, v: { ...v, m, mv: toKey } });
  });
  return { set, mark };
}

// ------------------------------------------------------------------ customers, suggestions, counting

/** A type the deals suggest, with why: each deal (newest year first) and the service that maps to it. */
export interface CtSuggestion { readonly t: string; readonly why: readonly { readonly deal: string; readonly year: string; readonly svc: string }[] }
export interface CtIndexInput {
  tags: CustTags;
  defs: CTypeDef[];
  /** every deal, any year */
  deals: Deal[];
  /** sales.ts dealResult: a lost deal ('NO') suggests nothing */
  result: (d: Deal) => string;
  /** the company an id stands for here (merged rows: the primary); undefined = not known on this device */
  company: (id: number) => { id: number; name: string } | undefined;
  /** every company from the TGO website sync, as synced (ids of this device only, also one merged into
   *  another company since): its tags are under its name key */
  locals: { id: number; name: string }[];
  /** ids of the customers added by hand */
  custom: number[];
}
/** Everything the screens ask about customer types, built once per change (never per company: the
 *  55k-row search looks a company up with one Map.get). Read-only, shared by every screen: copy a list
 *  before sorting it. */
export interface CtIndex {
  /** customer → type → the answer that counts ('y' or 'n'; types not in the list too) */
  tags: ReadonlyMap<Cust, ReadonlyMap<string, Readonly<CTag>>>;
  /** customer → the types it has, in list order (types in the list only, retired included) */
  yes: ReadonlyMap<Cust, readonly string[]>;
  /** customer → its deals (any year) */
  deals: ReadonlyMap<Cust, readonly Deal[]>;
  /** the customers: a deal (any year), added by hand, or a type; every other registry company is a prospect */
  pop: ReadonlySet<Cust>;
  /** customers with no company row here: Sales Tracker clients by name, and deals linked to a company
   *  this device does not know (e.g. one added by hand, since deleted); listed after the search results */
  outside: ReadonlySet<Cust>;
  /** customer → the types its deals suggest that it has no answer for, in list order (only customers
   *  that can be tagged: never a client whose name is too short to key, 'd:…') */
  sug: ReadonlyMap<Cust, readonly CtSuggestion[]>;
  /** the customer a record key stands for */
  custOf: (ckey: string) => Cust;
  /** the customer of a deal */
  custOfDeal: (d: Deal) => Cust;
}

/**
 * Build the index. A name key stands for the TGO-sync company of that name (the company it is merged
 * into now, also when build() merged it by itself), else for itself: a client not in the registry,
 * every deal not linked to a company with that client name, any year. A client text never stands for a
 * registry company (the placeholder "ลูกค้าใหม่" is on many rows): a deal is that company's when it is
 * linked to it.
 * An answer given on a deal (`d`) counts for that deal's customer now; one left on a name some other
 * deal not linked to a company still uses counts for that name too (it was that customer's answer as
 * well). A moved answer's mark counts for nobody.
 * A customer is: anyone with a deal (any year), anyone added by hand, and any company with a type. Tags
 * left on a name no deal uses any more, or on a company not known here, count for nobody.
 */
export function ctIndex(I: CtIndexInput): CtIndex {
  const order = new Map(I.defs.map((d, i) => [d.id, i]));
  const names = new Map<string, Cust>();
  I.locals.forEach((c) => {
    const k = nameKey(c.name);
    if (k && !names.has(k)) names.set(k, I.company(c.id)?.id ?? c.id);
  });
  const custOf = (ckey: string): Cust => (/^\d+$/.test(ckey) ? (I.company(+ckey)?.id ?? +ckey) : names.get(ckey) ?? ckey);
  const custOfDeal = (d: Deal): Cust => {
    if (d.gid != null && !localId(d.gid)) return I.company(d.gid)?.id ?? d.gid;
    const k = nameKey(d.client);
    return k ? custOf(k) : 'd:' + d.id;
  };
  // name keys someone stands on: a TGO-sync company, a deal not linked to a company
  const live = new Set(names.keys()), byId = new Map<string, Deal>();
  I.deals.forEach((d) => {
    byId.set(d.id, d);
    if (d.gid != null && !localId(d.gid)) return;
    const k = nameKey(d.client);
    if (k) live.add(k);
  });

  const tags = new Map<Cust, Map<string, CTag>>();
  const put = (cu: Cust, t: string, v: CTag) => {
    let m = tags.get(cu);
    if (!m) tags.set(cu, (m = new Map()));
    m.set(t, pickTag(m.get(t), v)!);
  };
  Object.entries(I.tags).forEach(([ck, rec]) => {
    if (!rec) return;
    const home = custOf(ck);
    Object.entries(rec).forEach(([t, v]) => {
      if (!v || v.mv) return;
      const dl = v.d ? byId.get(v.d) : undefined;
      const cu = dl ? custOfDeal(dl) : home;
      put(cu, t, v);
      if (cu !== home && live.has(ck)) put(home, t, v);
    });
  });
  const yes = new Map<Cust, readonly string[]>();
  tags.forEach((m, cu) => {
    const y = [...m].filter(([t, v]) => v.s === 'y' && order.has(t)).map(([t]) => t);
    if (y.length) yes.set(cu, Object.freeze(y.sort((a, b) => order.get(a)! - order.get(b)!)));
  });

  const deals = new Map<Cust, Deal[]>();
  I.deals.forEach((d) => {
    const cu = custOfDeal(d);
    (deals.get(cu) || deals.set(cu, []).get(cu)!).push(d);
  });
  const pop = new Set<Cust>(deals.keys());
  I.custom.forEach((id) => pop.add(I.company(id)?.id ?? id));
  yes.forEach((_, cu) => typeof cu === 'number' && I.company(cu) && pop.add(cu));
  const outside = new Set<Cust>();
  pop.forEach((cu) => (typeof cu === 'string' || !I.company(cu)) && outside.add(cu));

  const svc = svcToType(I.defs);
  const sug = new Map<Cust, readonly CtSuggestion[]>();
  deals.forEach((ds, cu) => {
    // a client name too short to key cannot be answered: nothing to confirm or dismiss there
    if (typeof cu === 'string' && cu.startsWith('d:')) return;
    const have = tags.get(cu), by = new Map<string, { t: string; why: { deal: string; year: string; svc: string }[] }>();
    ds.forEach((d) => {
      if (I.result(d) === 'NO') return;
      d.service.forEach((s) => {
        const t = svc.get(s);
        if (!t || have?.has(t)) return;
        const x = by.get(t) || by.set(t, { t, why: [] }).get(t)!;
        if (!x.why.some((w) => w.deal === d.id && w.svc === s)) x.why.push({ deal: d.id, year: d.year, svc: s });
      });
    });
    if (by.size)
      sug.set(
        cu,
        Object.freeze(
          [...by.values()]
            .sort((a, b) => order.get(a.t)! - order.get(b.t)!)
            .map((x) => Object.freeze({ t: x.t, why: Object.freeze(x.why.sort((a, b) => b.year.localeCompare(a.year)).map((w) => Object.freeze(w))) })),
        ),
      );
  });
  return { tags, yes, deals, pop, outside, sug, custOf, custOfDeal };
}

export interface CtCounts {
  /** customers, each once (บริษัท) */
  pop: number;
  /** customers with no type yet (ยังไม่ระบุประเภท) */
  none: number;
  /** customers with a suggestion waiting (แนะนำจากงานขาย รอยืนยัน) */
  sug: number;
  /** per type (retired too): customers with it, and the year's deals of those customers (ดีล) with
   *  their Forecast. Types overlap: never add these up — `pop` is the only total. */
  by: Record<string, { cos: number; deals: number; forecast: number }>;
  /** the year's deals whose customer has no type yet */
  noneDeals: { deals: number; forecast: number };
}
/** The one count of customers by type (overview, search type row, admin list, tracker menu). */
export function countByType(ix: CtIndex, defs: CTypeDef[], year: string, forecastOf: (d: Deal) => number | null): CtCounts {
  const by: CtCounts['by'] = Object.fromEntries(defs.map((d) => [d.id, { cos: 0, deals: 0, forecast: 0 }]));
  let none = 0, sug = 0;
  ix.pop.forEach((cu) => {
    const y = ix.yes.get(cu);
    if (y) y.forEach((t) => by[t] && by[t].cos++);
    else none++;
    if (ix.sug.has(cu)) sug++;
  });
  const noneDeals = { deals: 0, forecast: 0 };
  ix.deals.forEach((ds, cu) =>
    ds.forEach((d) => {
      if (d.year !== year) return;
      const y = ix.yes.get(cu), fc = forecastOf(d) || 0;
      if (!y) {
        noneDeals.deals++;
        noneDeals.forecast += fc;
      } else
        y.forEach((t) => {
          if (!by[t]) return;
          by[t].deals++;
          by[t].forecast += fc;
        });
    }),
  );
  return { pop: ix.pop.size, none, sug, by, noneDeals };
}

/**
 * The search filter `ct` as a test of one customer: a comma list of type ids (any of them: OR), plus
 * 'none' (a customer with no type yet) and 'sug' (a suggestion waiting); 'all' = every customer; ''
 * = no filter. A prospect (not a customer) never matches a set filter.
 */
export function ctMatcher(ix: CtIndex, sel: string): (cu: Cust) => boolean {
  const parts = sel.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return () => true;
  const all = parts.includes('all'), none = parts.includes('none'), sug = parts.includes('sug');
  const types = new Set(parts.filter((x) => x !== 'all' && x !== 'none' && x !== 'sug'));
  return (cu) => {
    if (!ix.pop.has(cu)) return false;
    if (all) return true;
    const y = ix.yes.get(cu);
    return (none && !y) || (sug && ix.sug.has(cu)) || (!!y && y.some((t) => types.has(t)));
  };
}
/** Customers with no company row here (ix.outside), for the group after the search results ("ลูกค้าใน
 *  Sales Tracker ที่ยังไม่อยู่ในทะเบียน"): the client name of their newest deal, and their deals. With the
 *  registry rows they make up every customer, so the search counts equal the overview's. */
export function trackerOnly(ix: CtIndex): { key: Cust; name: string; deals: Deal[] }[] {
  const out: { key: Cust; name: string; deals: Deal[] }[] = [];
  ix.outside.forEach((cu) => {
    const ds = (ix.deals.get(cu) || []).slice().sort((a, b) => b.year.localeCompare(a.year) || (b.at || '').localeCompare(a.at || ''));
    if (ds.length) out.push({ key: cu, name: ds[0].client, deals: ds });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'th'));
}
/**
 * The Sales Tracker's "ประเภท · บริการ" filter: 't:<type id>' = the deal's customer has the type,
 * 't:none' = it has none yet, 's:<service>' = the deal lists the service; a value saved before this
 * filter existed (a plain service) is read as 's:'. `types` = the customer's types (typesOfDeal).
 */
export function dealTsMatch(v: string, types: string[], d: Pick<Deal, 'service'>): boolean {
  if (!v) return true;
  if (v === 't:none') return !types.length;
  if (v.startsWith('t:')) return types.includes(v.slice(2));
  return d.service.includes(v.startsWith('s:') ? v.slice(2) : v);
}
