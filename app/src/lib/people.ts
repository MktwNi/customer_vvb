/**
 * People: the contact persons at customer companies (ผู้ติดต่อ), shared with the team as `person/<id>`
 * records that merge field by field like customers added by hand. A person links to a company the whole
 * team has (`gid`, registry or hand-added) or only names it (`company`, e.g. a company from the TGO
 * website sync, which exists on one device only). Calls and notes about a person are contact-log entries
 * with `pid` (in the company's log, so the company page shows them too).
 *
 * One person may deal with several companies (a consultant who brings clients, a group manager): the person
 * record keeps their main company, each other one is a record of its own (`person/<pid>/co/<gid>`, PCo), and two
 * records found to be the same human are merged by an alias (`person/<gone>/into/<keep>`).
 */
import type { CustomCo, Person, PersonRole } from './types';
import { csvCell, csvPhone, type Deal } from './sales';

export const ROLE_TH: Record<PersonRole, string> = {
  '': 'ไม่ระบุ',
  decision: 'ผู้ตัดสินใจ',
  influencer: 'ผู้มีอิทธิพลต่อการตัดสินใจ',
  coordinator: 'ผู้ประสานงาน',
  user: 'ผู้ใช้งาน',
};
export const ROLES = Object.keys(ROLE_TH) as PersonRole[];
/** Person fields a person edits (the rest is bookkeeping). */
export const PERSON_FIELDS = ['name', 'nick', 'pos', 'dept', 'role', 'gid', 'company', 'phone', 'email', 'line', 'owner', 'status', 'note'] as const;
export type PersonForm = Pick<Person, (typeof PERSON_FIELDS)[number]>;
/** A person's main company and their position, department, role and status there: written together (engine
 *  updatePerson), so two changes made at once never leave one company with the other's position or status. */
export const MAIN_F = ['gid', 'company', 'pos', 'dept', 'role', 'status'] as const;
export const NOTE_CAP = 5000;

const str = (v: unknown, max = 300) => (v == null ? '' : String(v)).slice(0, max);

/** A person record from the sheet, checked (a malformed row is skipped rather than breaking every screen). */
export function toPerson(v: unknown, id: string): Person | null {
  if (!v || typeof v !== 'object' || !id) return null;
  const o = v as Record<string, unknown>;
  const name = str(o.name, 200).trim();
  if (!name) return null;
  const gid = o.gid == null || o.gid === '' ? null : Number(o.gid);
  const role = ROLES.includes(o.role as PersonRole) ? (o.role as PersonRole) : '';
  return {
    // fields a later version adds (short values only) are kept, so this version's edits don't erase them
    ...Object.fromEntries(Object.entries(o).filter(([, x]) => x == null || ['string', 'number', 'boolean'].includes(typeof x)).map(([k, x]) => [k, typeof x === 'string' ? x.slice(0, 500) : x])),
    id,
    name,
    nick: str(o.nick, 100),
    pos: str(o.pos, 200),
    dept: str(o.dept, 200),
    role,
    gid: gid != null && isFinite(gid) ? gid : null,
    company: str(o.company, 200),
    phone: str(o.phone, 200),
    email: str(o.email, 200),
    line: str(o.line, 100),
    owner: str(o.owner, 100),
    status: o.status === 'left' ? 'left' : 'active',
    note: str(o.note, NOTE_CAP),
    at: str(o.at, 40),
    by: str(o.by, 100),
    upAt: str(o.upAt, 40),
    upBy: str(o.upBy, 100),
  };
}

const TITLES = /^(คุณ|นาย|นางสาว|นาง|น\.ส\.|ดร\.|ผศ\.|รศ\.|ศ\.|mr\.?|mrs\.?|ms\.?|miss|dr\.?|k\.)\s*/i;
/** Name without titles (คุณ, นาย, ดร., Mr …), spaces or dots, lower case: the same person typed twice. */
export function nameKey(name: string) {
  let s = (name || '').trim().toLowerCase();
  for (let i = 0; i < 3 && TITLES.test(s); i++) s = s.replace(TITLES, '');
  return s.replace(/[\s.]+/g, '');
}
/** Phone numbers in a field (several split by | , /), digits only, +66 as 0. */
export function phoneKeys(phone: string) {
  return (phone || '')
    .split(/[|,/;]/)
    .map((x) => x.replace(/\D/g, '').replace(/^66(?=\d{8,9}$)/, '0'))
    .filter((x) => x.length >= 6);
}
/** The letter shown in a person's avatar: the first one of the name without titles. */
export function personInitial(name: string) {
  const s = (name || '').trim().replace(TITLES, '').replace(TITLES, '');
  const m = /[A-Za-z0-9ก-ฮ]/.exec(s);
  return m ? m[0].toUpperCase() : '?';
}
const SWATCH = ['#1F5BD8', '#0E8A9A', '#7A4EE0', '#C2410C', '#0F766E', '#B42318', '#1D4ED8', '#A16207'];
/** A stable colour per person (from the id), so the same person looks the same everywhere. */
export function personColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SWATCH[h % SWATCH.length];
}

/** The same id on every browser for a person found in the same place (two people importing it at once
 *  make one record, not two). */
function stableId(prefix: string, ...parts: string[]) {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${prefix}${h.toString(36)}`;
}
/** The id every browser gives the contact `name` typed at a company (the team's company id `shared`, else
 *  the company's name): the People page's suggestion and a deal's "บันทึกเป็นผู้ติดต่อ" make the same person. */
export const suggestionId = (shared: number | null, company: string, name: string) => stableId('s', shared != null ? 'g' + shared : 'n' + nameKey(company), nameKey(name));

/** `same`: an existing person (at another company) this contact surely is (findExisting): "เพิ่ม <บริษัท> ให้ <ชื่อ>"
 *  instead of a second record of them ("เพิ่มทั้งหมด" leaves it). */
export interface Suggestion {
  id: string; name: string; gid: number | null; company: string; phone: string; email: string; from: string; same?: Person;
  /** another suggestion above it that is the same human (the same mobile, e-mail or full name typed at several
   *  companies, e.g. a consultant): "เพิ่มทั้งหมด" makes them one person with each company (suggestionHeads) */
  dupOf?: { id: string; name: string; company: string };
}

/**
 * Contact persons named in the Sales Tracker (a deal's ผู้ติดต่อ) and in customers added by hand that
 * nobody has recorded as a person yet. `canon` maps a company id to the one it is merged into (null when
 * this device can't place it), `aliases` gives every id of that company (merged duplicates); `hidden`
 * are ids hidden or deleted on this browser. A company is recognised by any of its ids or its name, so
 * a merge, a split or a deleted customer doesn't bring back a choice already made.
 */
export function personSuggestions(
  people: Person[],
  deals: Deal[],
  custom: CustomCo[],
  canon: (gid: number) => number | null,
  hidden: Set<string>,
  aliases: (gid: number) => number[] = (g) => [g],
  linked: (d: Deal) => boolean = () => false,
  // (one person, several companies: the other companies a person deals with are known too; `live`: the people
  // not merged away, among whom one a contact surely is is said as `same`)
  more: { cos?: (p: Person) => number[]; live?: Person[]; coPhones?: (gid: number | null) => string[] } = {},
): Suggestion[] {
  const coKeys = (gid: number | null, company: string) => {
    const keys = new Set<string>();
    if (gid != null) {
      keys.add('g' + gid);
      const c = canon(gid);
      if (c != null) keys.add('g' + c);
      aliases(gid).forEach((x) => keys.add('g' + x));
    }
    const nk = nameKey(company);
    if (nk) keys.add('n' + nk);
    return keys;
  };
  const known = people.map((p) => {
    const co = coKeys(p.gid, p.company);
    (more.cos?.(p) || []).forEach((g) => coKeys(g, '').forEach((k) => co.add(k)));
    return { co, name: nameKey(p.name), phones: phoneKeys(p.phone), email: p.email.trim().toLowerCase() };
  });
  const ids = new Set(people.map((p) => p.id));
  const find = more.live ? existingFinder(more.live) : null;
  const out = new Map<string, Suggestion>();
  const add = (name: string, gid: number | null, company: string, phone: string, email: string, from: string) => {
    name = name.trim();
    const nk = nameKey(name);
    if (!nk || nk.length < 2) return;
    const shared = gid != null ? canon(gid) : null; // null: a company on this device only, or gone
    // the id every browser makes for this contact (the team's company id, else its name)
    const id = suggestionId(shared, company, name);
    if (out.has(id)) return;
    const keys = coKeys(gid, company);
    // hidden / added under any id this company has had
    if ([...keys].some((k) => { const x = stableId('s', k, nk); return hidden.has(x) || ids.has(x); })) return;
    const ph = phoneKeys(phone), em = email.trim().toLowerCase();
    if (known.some((k) => [...keys].some((x) => k.co.has(x)) && (k.name === nk || (ph.length > 0 && ph.some((x) => k.phones.includes(x))) || (!!em && k.email === em)))) return;
    // someone already recorded at another company (same mobile, e-mail or full name): add this company to them; a
    // company only named (a deal not linked to the registry): the person is used, their numbers kept
    const f = find ? find({ name, phone, email }, () => false, shared != null ? more.coPhones?.(shared) || [] : []) : [];
    out.set(id, { id, name, gid: shared ?? gid, company, phone, email, from, ...(f.length === 1 ? { same: f[0].p } : {}) });
  };
  // (`linked`: the deal's typed name is a person linked to it already, whatever their company; a typed name the
  // deal's linked people are not is still someone to record)
  deals.forEach((d) => d.contactName && !linked(d) && add(d.contactName, d.gid, d.client, d.phone, d.email, 'Sales Tracker ปี ' + d.year));
  custom.forEach((c) => c.contact && add(c.contact, c.id, c.name, '', '', 'ลูกค้าที่เพิ่มเอง'));
  const list = [...out.values()].sort((a, b) => a.company.localeCompare(b.company, 'th') || a.name.localeCompare(b.name, 'th'));
  const heads = suggestionHeads(list);
  const byId = new Map(list.map((s) => [s.id, s]));
  return list.map((s) => {
    const h = heads.get(s.id);
    const x = h && h !== s.id ? byId.get(h) : undefined;
    return x ? { ...s, dupOf: { id: x.id, name: x.name, company: x.company } } : s;
  });
}
/**
 * Suggestions that are one human (not recorded yet: none has `same`): the same mobile number, the same e-mail (never
 * an office's) or the same full name (two words or more) typed at several companies. Each one's head: the first of
 * its group in `list`'s order (who "เพิ่มทั้งหมด" records; the others become their companies).
 */
export function suggestionHeads(list: Pick<Suggestion, 'id' | 'name' | 'phone' | 'email' | 'same'>[]): Map<string, string> {
  const up = new Map<string, string>();
  const root = (x: string): string => {
    const u = up.get(x);
    return !u || u === x ? x : root(u);
  };
  const first = new Map<string, string>();
  const at = new Map(list.map((s, i) => [s.id, i]));
  list.forEach((s) => {
    up.set(s.id, s.id);
    if (s.same) return;
    const keys = [
      ...phoneKeys(s.phone).filter(isMobile).map((k) => 't' + k),
      ...splitList(s.email).map(emailKey).filter((k) => !isRoleMail(k)).map((k) => 'm' + k),
      ...(nameWords(s.name) >= 2 && nameKey(s.name).length > 1 ? ['n' + nameKey(s.name)] : []),
    ];
    keys.forEach((k) => {
      const f = first.get(k);
      if (!f) return void first.set(k, s.id);
      const a = root(f), b = root(s.id);
      // (the one earlier in the list heads the group)
      if (a !== b) (at.get(a)! < at.get(b)! ? up.set(b, a) : up.set(a, b));
    });
  });
  const out = new Map<string, string>();
  list.forEach((s) => out.set(s.id, root(s.id)));
  return out;
}

// ------------------------------------------------------------------ a deal's contact (ผู้ติดต่อของดีล)
/**
 * A deal's contact is a link to a person, never a copy of their details: one shared record per link,
 * `person/<pid>/<dealId>`. Its own record, not a field of the deal: a tab still on an older build (cv 5)
 * writes the whole deal on every edit and would erase a field it does not know; it skips this record
 * (toPerson: no name), and the `person/` rule (ลูกค้าและผู้ติดต่อ) already covers it on the team script.
 * Never deleted (a sales account may not delete records): taken off, it is written with `on: 0`. `o` orders a
 * deal's contacts, the main one first (the smallest); `at` / `by` say when and by whom.
 */
export interface PLink { on: 0 | 1; at: string; by: string; o: number }

/** A link record from the sheet, checked (null: not one). */
export function toPLink(v: unknown): PLink | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const at = str(x.at, 40);
  const o = x.o == null || x.o === '' ? NaN : Number(x.o);
  return { on: x.on === 1 || x.on === true || x.on === '1' ? 1 : 0, at, by: str(x.by, 100), o: isFinite(o) ? o : Date.parse(at) || 0 };
}
/** What the rest of a `person/` key names: a person (`pid`), a deal's contact link (`pid/deal`), one more company
 *  the person deals with (`pid/co/<gid>`, PCo) or the person they were merged into (`pid/into/<pid2>`); null = none. */
export function personKey(rest: string): { pid: string; deal?: string; co?: number; into?: string } | null {
  const p = (rest || '').split('/');
  if (!p[0]) return null;
  if (p.length === 1) return { pid: p[0] };
  if (p.length === 2) return p[1] ? { pid: p[0], deal: p[1] } : null;
  if (p.length === 3 && p[1] === 'co' && /^\d{1,16}$/.test(p[2])) return { pid: p[0], co: Number(p[2]) };
  if (p.length === 3 && p[1] === 'into' && p[2] && p[2] !== p[0]) return { pid: p[0], into: p[2] };
  return null;
}
/** The person a record key is (`person/<id>`); '' for any other key, a deal's contact link included. */
export function personIdOf(k: string) {
  if (!k.startsWith('person/')) return '';
  const x = personKey(k.slice(7));
  return x && !x.deal && x.co == null && !x.into ? x.pid : '';
}

/** The links that are on, by deal (main contact first) and by person. */
export interface LinkIndex { byDeal: Map<string, string[]>; byPerson: Map<string, string[]> }
export function linkIndex(links: Record<string, PLink>): LinkIndex {
  const tmp = new Map<string, { pid: string; o: number }[]>(), byPerson = new Map<string, string[]>();
  Object.entries(links).forEach(([k, l]) => {
    const x = personKey(k);
    if (!x?.deal || !l.on) return;
    (tmp.get(x.deal) || tmp.set(x.deal, []).get(x.deal)!).push({ pid: x.pid, o: l.o });
    (byPerson.get(x.pid) || byPerson.set(x.pid, []).get(x.pid)!).push(x.deal);
  });
  const byDeal = new Map<string, string[]>();
  tmp.forEach((a, deal) => byDeal.set(deal, a.sort((x, y) => x.o - y.o || (x.pid < y.pid ? -1 : x.pid > y.pid ? 1 : 0)).map((x) => x.pid)));
  return { byDeal, byPerson };
}
/** The people linked to a deal, the main contact first; a person deleted since is left out. */
export function linkedPeople(ix: LinkIndex, dealId: string, people: Record<string, Person>): Person[] {
  return (ix.byDeal.get(dealId) || []).map((pid) => people[pid]).filter((p): p is Person => !!p);
}
/** The order key that puts a link first (before every one of `cur`), or last. */
export function linkOrder(cur: PLink[], first: boolean, now: number) {
  const os = cur.filter((l) => l.on).map((l) => l.o);
  if (!os.length) return now;
  return first ? Math.min(...os) - 1 : Math.max(now, Math.max(...os) + 1);
}

/** Several values typed in one field ("a | b", "a, b", "a / b"), as typed. */
export const splitList = (s: string) => (s || '').split(/[|,/;]/).map((x) => x.trim()).filter(Boolean);
const emailKey = (s: string) => s.trim().toLowerCase();

/** What a deal shows as its contact: the main linked person's name, phone and e-mail (`person`); without
 *  one, what was typed in the deal. A linked person without a phone or e-mail shows the deal's typed one
 *  only when it was typed for them (their name, or no name: the company's number copied when it was sent). */
export interface DealContact { name: string; phone: string; email: string; person: Person | null; people: Person[] }
export function dealContact(d: Pick<Deal, 'contactName' | 'phone' | 'email'>, linked: Person[]): DealContact {
  const p = linked[0];
  if (!p) return { name: d.contactName.trim(), phone: d.phone, email: d.email, person: null, people: [] };
  const theirs = !d.contactName.trim() || nameKey(d.contactName) === nameKey(p.name);
  return { name: p.name, phone: p.phone || (theirs ? d.phone : ''), email: p.email || (theirs ? d.email : ''), person: p, people: linked };
}

/** Is a typed contact (name, phone or e-mail) this person? The People page's rule (personSuggestions). */
export function sameContact(t: { name: string; phone: string; email: string }, p: Pick<Person, 'name' | 'phone' | 'email'>) {
  const nk = nameKey(t.name), ph = phoneKeys(t.phone), em = splitList(t.email).map(emailKey);
  const pe = splitList(p.email).map(emailKey);
  return (nk.length > 1 && nameKey(p.name) === nk) || ph.some((x) => phoneKeys(p.phone).includes(x)) || em.some((x) => pe.includes(x));
}
/** The phone numbers and e-mails typed in a deal that the person (if any) and the company don't have yet. */
export function typedExtras(d: Pick<Deal, 'phone' | 'email'>, p: Pick<Person, 'phone' | 'email'> | null, co?: { phone?: string; email?: string }) {
  const hasPh = new Set([...phoneKeys(p?.phone || ''), ...phoneKeys(co?.phone || '')]);
  const hasEm = new Set([...splitList(p?.email || ''), ...splitList(co?.email || '')].map(emailKey));
  const phones = splitList(d.phone).filter((x) => {
    const k = phoneKeys(x);
    return k.length ? !k.some((y) => hasPh.has(y)) : !!x && !hasPh.has(x);
  });
  const emails = splitList(d.email).filter((x) => !hasEm.has(emailKey(x)));
  return { phones: [...new Set(phones)], emails: [...new Set(emails)] };
}
/** What a deal holds for its contact `p` that their record lacks (what "เพิ่มให้ <ชื่อ>" carries over): the
 *  numbers typed in it that neither they nor the company have; while they have no phone (no e-mail) at all,
 *  every one the deal has, the company's too, since that is what the deal shows as theirs (dealContact). */
export function personExtras(d: Pick<Deal, 'phone' | 'email'>, p: Pick<Person, 'phone' | 'email'>, co?: { phone?: string; email?: string }) {
  const own = typedExtras(d, p, co), all = typedExtras(d, p);
  return { phones: p.phone.trim() ? own.phones : all.phones, emails: p.email.trim() ? own.emails : all.emails };
}

/** Who of `pool` a deal's typed contact names, and how: by its name (without titles); with no name typed or
 *  none matching, by a phone number or e-mail typed in it that is not the company's own (`co`: a switchboard
 *  copied in when the deal was sent is everyone's). A match by phone or e-mail while a name is typed is only a
 *  hint: the names differ (someone else at the same number). */
export function typedMatch(d: Pick<Deal, 'contactName' | 'phone' | 'email'>, pool: Person[], co?: { phone?: string; email?: string }): { by: 'name' | 'phone' | 'email' | ''; list: Person[] } {
  const nk = nameKey(d.contactName);
  if (nk.length > 1) {
    const list = pool.filter((p) => nameKey(p.name) === nk);
    if (list.length) return { by: 'name', list };
  }
  const ex = typedExtras(d, null, co);
  const ph = ex.phones.flatMap(phoneKeys), em = ex.emails.map(emailKey);
  const byPh = ph.length ? pool.filter((p) => phoneKeys(p.phone).some((x) => ph.includes(x))) : [];
  if (byPh.length) return { by: 'phone', list: byPh };
  const byEm = em.length ? pool.filter((p) => splitList(p.email).some((x) => em.includes(emailKey(x)))) : [];
  return byEm.length ? { by: 'email', list: byEm } : { by: '', list: [] };
}
/** The one person of `pool` a deal's typed contact surely is, for a link made without asking (an import, a
 *  send): the only one with the typed name; with no name typed, the only one with a phone or e-mail typed in
 *  it (not the company's). null: nobody, several, or a name typed that is nobody's (never a guess by number). */
export function typedPerson(d: Pick<Deal, 'contactName' | 'phone' | 'email'>, pool: Person[], co?: { phone?: string; email?: string }): Person | null {
  const m = typedMatch(d, pool, co);
  if (m.list.length !== 1) return null;
  return m.by === 'name' || !d.contactName.trim() ? m.list[0] : null;
}
/** Has the deal a contact typed in it: a name, or a phone or e-mail that is not the company's own. */
export function typedAny(d: Pick<Deal, 'contactName' | 'phone' | 'email'>, co?: { phone?: string; email?: string }) {
  if (d.contactName.trim()) return true;
  const ex = typedExtras(d, null, co);
  return ex.phones.length + ex.emails.length > 0;
}

const ROLE_RANK: Record<PersonRole, number> = { decision: 0, influencer: 1, coordinator: 2, user: 3, '': 4 };
/** Who a deal is offered as its contact: the people still at the company (not ย้ายงานแล้ว), not `skip`,
 *  the decision maker first, then by name. */
export function contactChoices(pool: Person[], skip: Iterable<string> = []): Person[] {
  const no = new Set(skip);
  return pool.filter((p) => p.status !== 'left' && !no.has(p.id)).sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.name.localeCompare(b.name, 'th'));
}
/** The "กับ" choices of a contact record: the deal's contacts first, then the company's other people still
 *  there; the default is the deal's main contact, the first one not at another company (`elsewhere`: the deal
 *  was linked to another company since, or the person moved). */
export function actPeople(linked: Person[], pool: Person[], elsewhere: (p: Person) => boolean = () => false): { list: Person[]; pid: string } {
  const ids = new Set(linked.map((p) => p.id));
  return { list: [...linked, ...contactChoices(pool, ids)], pid: linked.find((p) => !elsewhere(p))?.id || '' };
}

// ------------------------------------------------------------------ one person, several companies
/**
 * One more company a person deals with (บริษัทที่ติดต่อด้วย), besides the main one on their record (gid / company /
 * pos / dept / role / status): a record of its own, `person/<pid>/co/<gid>` (gid: the team's id of the company when
 * written), with their position, role and status there. Its own record, never a field of the person: a tab still
 * on an older build (cv 5) writes the whole person on every edit and would erase a field it does not know; it skips
 * this key (three parts: no person, no deal link). The value never has a `name` (a build before deal links read
 * every person/ key as a person). Never deleted: taken off (added by mistake) it is written with `on: 0`; a
 * company the person left stays, `st: 'left'`. Kept in the engine's `plinks` beside the deal links (same store,
 * backup and upload), so it carries a PLink's fields (`o` unused).
 */
export interface PCo extends PLink { st: 'active' | 'left'; pos: string; dept: string; role: PersonRole; upAt: string; upBy: string }
/** A company record from the sheet, checked (null: not one). */
export function toPCo(v: unknown): PCo | null {
  const l = toPLink(v);
  if (!l) return null;
  const x = v as Record<string, unknown>;
  return {
    on: l.on, at: l.at, by: l.by, o: 0,
    st: x.st === 'left' ? 'left' : 'active',
    pos: str(x.pos, 200), dept: str(x.dept, 200),
    role: ROLES.includes(x.role as PersonRole) ? (x.role as PersonRole) : '',
    upAt: str(x.upAt, 40) || l.at, upBy: str(x.upBy, 100) || l.by,
  };
}
/** What a company record is written as (no `o`, never a `name`). */
export const pcoValue = (c: PCo) => ({ on: c.on, st: c.st, pos: c.pos, dept: c.dept, role: c.role, at: c.at, by: c.by, upAt: c.upAt, upBy: c.upBy });
/** The keys (after `person/`) of a person's company record and of a merge alias. */
export const coKey = (pid: string, gid: number) => `${pid}/co/${gid}`;
export const intoKey = (gone: string, keep: string) => `${gone}/into/${keep}`;

/** One company a person deals with: the main one (from their record; `gid` null = a name typed, not linked) or
 *  another (`key`: its record). `gid` is the company's id as the team has it now (merged ids collapse). */
export interface PersonCo {
  gid: number | null; company: string; main: boolean;
  pos: string; dept: string; role: PersonRole; st: 'active' | 'left';
  at: string; by: string; upAt: string; key: string;
}
/**
 * A person's companies, the main one first, then the others in the order added. `recs`: their company records (key,
 * value), on or off; `canon`: the company an id is now (merged ids collapse); `ids`: whose records they are (the
 * person and the records merged into them; default the person). Several records of one company (two registry
 * records merged since, a record of a merged-away person): the newest one that is on wins, the newest off one only
 * when none is on (taken off as a duplicate company before the merge, it never hides the one still theirs). A record
 * of the main company is left out (the person record says it), so is one taken off.
 */
export function cosOf(p: Person, recs: [string, PCo][], canon: (gid: number) => number = (g) => g, ids: ReadonlySet<string> = new Set([p.id])): PersonCo[] {
  const mainG = p.gid != null ? canon(p.gid) : null;
  const out: PersonCo[] = [];
  if (p.gid != null || p.company.trim())
    out.push({ gid: mainG, company: p.company, main: true, pos: p.pos, dept: p.dept, role: p.role, st: p.status, at: p.at, by: p.by, upAt: p.upAt, key: '' });
  const by = new Map<number, { k: string; r: PCo }>();
  recs.forEach(([k, r]) => {
    const x = personKey(k);
    if (!x || x.co == null || !ids.has(x.pid)) return;
    const g = canon(x.co);
    const cur = by.get(g);
    if (!cur || newer(r, cur.r)) by.set(g, { k, r });
  });
  const extra: PersonCo[] = [];
  by.forEach(({ k, r }, g) => {
    if (!r.on || g === mainG) return;
    extra.push({ gid: g, company: '', main: false, pos: r.pos, dept: r.dept, role: r.role, st: r.st, at: r.at, by: r.by, upAt: r.upAt, key: k });
  });
  extra.sort((a, b) => a.at.localeCompare(b.at) || a.gid! - b.gid!);
  return out.concat(extra);
}
/** Of two records of one company: the one that is on, else the newer (cosOf). */
const newer = (r: PCo, cur: PCo) => (r.on !== cur.on ? !!r.on : (r.upAt || r.at) > (cur.upAt || cur.at));
/** The record a change of a person's company goes to (any of its ids; the person's or a record merged into them):
 *  the one cosOf shows (the newest that is on, else the newest), null when they have none. */
export function coRecOf(pid: string | ReadonlySet<string>, gid: number, recs: [string, PCo][], canon: (gid: number) => number = (g) => g): [string, PCo] | null {
  const ids = typeof pid === 'string' ? new Set([pid]) : pid;
  const g = canon(gid);
  let best: [string, PCo] | null = null;
  recs.forEach(([k, r]) => {
    const x = personKey(k);
    if (!x || x.co == null || !ids.has(x.pid) || canon(x.co) !== g) return;
    if (!best || newer(r, best[1])) best = [k, r];
  });
  return best;
}
/** Every record of a person's company that is on (any of its ids): "เอาออก" takes each off. */
export function coRecsOn(ids: ReadonlySet<string>, gid: number, recs: [string, PCo][], canon: (gid: number) => number = (g) => g): [string, PCo][] {
  const g = canon(gid);
  return recs.filter(([k, r]) => {
    const x = personKey(k);
    return !!x && x.co != null && ids.has(x.pid) && canon(x.co) === g && !!r.on;
  });
}

/**
 * A merge alias, `person/<gone>/into/<keep>` (a PLink's fields), with the status the merged-away record had before
 * the merge (`st0`): the merge marks that record ไม่อยู่แล้ว (so a tab on an older build stops offering it), and a
 * record that turns out not merged after all (two merges of one pair made at once the other way round, or the kept
 * person deleted meanwhile) is shown with the status it had.
 */
export interface PInto extends PLink { st0?: 'active' | 'left' }
export function toPInto(v: unknown): PInto | null {
  const l = toPLink(v);
  if (!l) return null;
  const s = (v as Record<string, unknown>).st0;
  return s === 'active' || s === 'left' ? { ...l, st0: s } : l;
}
/** What an alias is written as. */
export const intoValue = (l: PInto) => ({ on: l.on, at: l.at, by: l.by, ...(l.st0 ? { st0: l.st0 } : {}) });

/**
 * Who each merged-away person is now (gone → kept), from the alias records `<gone>/into/<keep>` (the newest per
 * person, on or off), following a merge of a merge. Two merges of the same pair made at once the other way
 * round (a loop): the smallest id of the loop stays itself, the others are it.
 */
export function aliasIndex(links: Record<string, PLink>): Map<string, string> {
  const into = new Map<string, { to: string; at: string }>();
  Object.entries(links).forEach(([k, l]) => {
    const x = personKey(k);
    if (!x?.into) return;
    const cur = into.get(x.pid);
    if (!cur || l.at > cur.at) into.set(x.pid, { to: l.on ? x.into : '', at: l.at });
  });
  const out = new Map<string, string>();
  into.forEach((_, pid) => {
    const seen: string[] = [];
    let cur = pid;
    while (into.get(cur)?.to && !seen.includes(cur)) {
      seen.push(cur);
      cur = into.get(cur)!.to;
    }
    if (seen.includes(cur)) cur = seen.slice(seen.indexOf(cur)).sort()[0];
    if (cur !== pid) out.set(pid, cur);
  });
  return out;
}

/** The words of a name without titles: "ดร.พรวิมล ตัวอย่าง" has two, "คุณนก" one. */
export function nameWords(name: string) {
  let s = (name || '').trim();
  for (let i = 0; i < 3 && TITLES.test(s); i++) s = s.replace(TITLES, '');
  return s.split(/\s+/).filter(Boolean).length;
}
/** A mobile number (08x / 09x / 06x and 8 more digits): one person's, not a switchboard. */
export const isMobile = (k: string) => /^0[689]\d{8}$/.test(k);
const emailsOf = (p: Pick<Person, 'email'>) => splitList(p.email).map(emailKey);
/** An office's address (info@, sales@ …): never one person's. */
export const isRoleMail = (k: string) => /^(info|contact|contacts|sales|admin|office|hr|support|service|services|account|accounts|accounting|purchase|purchasing|procurement|marketing|hello|enquiry|enquiries|inquiry|cs|customer|mail|noreply|no-reply)@/i.test(k);

/** An existing person a typed contact surely is, and why (`by`); `here`: they deal with the company already. */
export interface Found { p: Person; by: ('phone' | 'email' | 'name')[]; here: boolean }
/**
 * The people a contact being typed already is (AddPerson, a deal's "บันทึกเป็นผู้ติดต่อ", a suggestion): the same
 * phone number (a mobile, or a number nobody else has; never a company's own number, `coPhones`), the same e-mail
 * nobody else uses (never an office's: info@, sales@ …), or the same full name (two words or more without titles: "คุณนก" alone never counts). `here`
 * says who deals with the company already. Those already there first.
 */
export function findExisting(t: { name: string; phone: string; email: string }, people: Person[], here: (p: Person) => boolean = () => false, coPhones: Iterable<string> = []): Found[] {
  return existingFinder(people)(t, here, coPhones);
}
/** findExisting with the people's numbers, e-mails and names read once (the People page checks every suggestion). */
export function existingFinder(people: Person[]) {
  const keys = people.map((p) => ({ p, ph: phoneKeys(p.phone), em: emailsOf(p), nk: nameKey(p.name) }));
  const phN = new Map<string, number>(), emN = new Map<string, number>();
  keys.forEach((k) => {
    new Set(k.ph).forEach((x) => phN.set(x, (phN.get(x) || 0) + 1));
    new Set(k.em).forEach((x) => emN.set(x, (emN.get(x) || 0) + 1));
  });
  return (t: { name: string; phone: string; email: string }, here: (p: Person) => boolean = () => false, coPhones: Iterable<string> = []): Found[] => {
    const co = new Set(coPhones);
    const nk = nameKey(t.name);
    const full = nk.length > 1 && nameWords(t.name) >= 2;
    const ph = [...new Set(phoneKeys(t.phone))].filter((k) => !co.has(k) && (isMobile(k) || (phN.get(k) || 0) <= 1));
    const em = [...new Set(splitList(t.email).map(emailKey))].filter((k) => !isRoleMail(k) && (emN.get(k) || 0) <= 1);
    if (!ph.length && !em.length && !full) return [];
    const out: Found[] = [];
    keys.forEach(({ p, ph: pk, em: ek, nk: n }) => {
      const by: Found['by'] = [];
      if (ph.length && pk.some((k) => ph.includes(k))) by.push('phone');
      if (em.length && ek.some((k) => em.includes(k))) by.push('email');
      if (full && n === nk) by.push('name');
      if (by.length) out.push({ p, by, here: here(p) });
    });
    return out.sort((a, b) => +b.here - +a.here || b.by.length - a.by.length || a.p.name.localeCompare(b.p.name, 'th'));
  };
}
/** "เบอร์โทรตรงกัน", "อีเมลตรงกัน", "ชื่อตรงกัน" (or two of them). */
export const foundWhy = (by: Found['by']) => by.map((x) => (x === 'phone' ? 'เบอร์โทร' : x === 'email' ? 'อีเมล' : 'ชื่อ')).join('และ') + 'ตรงกัน';

/** Two records that may be the same human (the People list's "พบรายชื่อที่อาจเป็นคนเดียวกัน"). */
export interface DupPair { key: string; a: Person; b: Person; by: Found['by'] }
export const pairKey = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);
/**
 * Pairs of people (alive, not merged away) that may be one human: the same mobile number held by just the two
 * (never a company's own number: `coPhones`, every company's numbers, or per person their companies and each one's
 * numbers ([company, number]) — then a number counts unless it is the own number of a company both deal with: a
 * customer added by hand often has its contact's mobile as its number, and that never hides a second record of them
 * at another company), the same e-mail held by just the two, or the same full name (two words or more).
 * `dismissed`: pairs said "ไม่ใช่คนเดียวกัน" on this browser.
 */
export function dupPairs(people: Person[], coPhones: Iterable<string> | ((p: Person) => Iterable<[number | string, string]>) = [], dismissed: Set<string> = new Set()): DupPair[] {
  const per = typeof coPhones === 'function' ? coPhones : null;
  const co = new Set(per ? [] : (coPhones as Iterable<string>));
  const own = new Map<string, Set<string>>();
  const ownOf = (p: Person) => own.get(p.id) || (own.set(p.id, new Set([...(per ? per(p) : [])].map(([c, k]) => c + '|' + k))), own.get(p.id)!);
  /** Is `k` the own number of a company both deal with. */
  const shared = (a: Person, b: Person, k: string) => [...ownOf(a)].some((x) => x.endsWith('|' + k) && ownOf(b).has(x));
  const groups = new Map<string, Person[]>();
  const put = (k: string, p: Person) => (groups.get(k) || groups.set(k, []).get(k)!).push(p);
  people.forEach((p) => {
    new Set(phoneKeys(p.phone).filter((k) => isMobile(k) && !co.has(k))).forEach((k) => put('t' + k, p));
    new Set(emailsOf(p).filter((k) => !isRoleMail(k))).forEach((k) => put('m' + k, p));
    if (nameWords(p.name) >= 2 && nameKey(p.name).length > 1) put('n' + nameKey(p.name), p);
  });
  const pairs = new Map<string, DupPair>();
  groups.forEach((list, g) => {
    // (a number or address that many share is the office's, not one person's; a full name: up to three records)
    if (list.length < 2 || list.length > (g[0] === 'n' ? 3 : 2)) return;
    const why = g[0] === 't' ? 'phone' : g[0] === 'm' ? 'email' : 'name';
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const k = pairKey(list[i].id, list[j].id);
        if (dismissed.has(k)) continue;
        if (why === 'phone' && per && shared(list[i], list[j], g.slice(1))) continue;
        const cur = pairs.get(k);
        if (cur) !cur.by.includes(why) && cur.by.push(why);
        else pairs.set(k, { key: k, a: list[i], b: list[j], by: [why] });
      }
  });
  return [...pairs.values()].sort((x, y) => x.a.name.localeCompare(y.a.name, 'th'));
}

/** Several values in one field joined back: the kept ones first, then the other's not there yet (by `key`). */
function union(keep: string, add: string, key: (s: string) => string[]) {
  const have = new Set(splitList(keep).flatMap((x) => key(x).length ? key(x) : [x.trim()]));
  const more = splitList(add).filter((x) => {
    const k = key(x).length ? key(x) : [x.trim()];
    if (k.some((y) => have.has(y))) return false;
    k.forEach((y) => have.add(y));
    return true;
  });
  return [keep.trim(), ...more].filter(Boolean).join(' | ');
}
/** The phone numbers and e-mails a person's record gets from a typed contact (the ones it lacks), else null. */
export function reachPatch(p: Pick<Person, 'phone' | 'email'>, t: { phone: string; email: string }): { phone?: string; email?: string } {
  const out: { phone?: string; email?: string } = {};
  const ph = union(p.phone, t.phone, phoneKeys), em = union(p.email, t.email, (x) => [emailKey(x)]);
  if (ph !== p.phone.trim() && ph.length <= 200) out.phone = ph;
  if (em !== p.email.trim() && em.length <= 200) out.email = em;
  return out;
}

/** The phone numbers, e-mails and LINE IDs a person's record gets from another record of them (the ones it lacks;
 *  {} when none): what a teammate saved on a record merged into them after the merge (engine lateReach). */
export function reachAll(p: Pick<Person, 'phone' | 'email' | 'line'>, t: Pick<Person, 'phone' | 'email' | 'line'>): { phone?: string; email?: string; line?: string } {
  const out: { phone?: string; email?: string; line?: string } = reachPatch(p, t);
  const ln = union(p.line, t.line, (x) => [x.trim().toLowerCase()]);
  if (ln !== p.line.trim() && ln.length <= 100) out.line = ln;
  return out;
}

/**
 * What merging person `gone` into `keep` writes (the merge dialog's "หลังรวม", the engine's mergePeople): on the kept
 * record, the phones, e-mails and LINE of both (no repeats), a nickname / ผู้ดูแล only where it has none, both notes;
 * the companies of both — the merged-away person's main company and others become the kept one's (with their
 * position and status there), one both have keeps the kept record's, its empty position filled. A company only
 * named (not linked: a name typed) can't be one more company: the kept person gets it as their main one when they
 * have none, else it is said in the note (`typedCo`).
 */
export interface MergePlan {
  patch: Partial<Pick<Person, 'phone' | 'email' | 'line' | 'nick' | 'owner' | 'note' | 'gid' | 'company' | 'pos' | 'dept' | 'role' | 'status'>>;
  /** companies the kept person gets (`fill`: one they have, its empty position filled) */
  cos: { gid: number; pos: string; dept: string; role: PersonRole; st: 'active' | 'left'; fill?: boolean }[];
  typedCo: string;
}
export function mergePlan(keep: Person, gone: Person, keepCos: PersonCo[], goneCos: PersonCo[]): MergePlan {
  const patch: MergePlan['patch'] = {};
  const set = <K extends keyof MergePlan['patch']>(k: K, v: Person[K]) => {
    if (v !== keep[k]) patch[k] = v as MergePlan['patch'][K];
  };
  const ph = union(keep.phone, gone.phone, phoneKeys);
  if (ph.length <= 200) set('phone', ph);
  const em = union(keep.email, gone.email, (x) => [emailKey(x)]);
  if (em.length <= 200) set('email', em);
  const ln = union(keep.line, gone.line, (x) => [x.trim().toLowerCase()]);
  if (ln.length <= 100) set('line', ln);
  if (!keep.nick.trim() && gone.nick.trim()) set('nick', gone.nick);
  if (!keep.owner.trim() && gone.owner.trim()) set('owner', gone.owner);
  if (gone.note.trim() && !keep.note.includes(gone.note.trim())) set('note', [keep.note.trim(), gone.note.trim()].filter(Boolean).join('\n\n').slice(0, NOTE_CAP));
  const cos: MergePlan['cos'] = [];
  let typedCo = '';
  // the kept person has no company at all: the merged-away one's first becomes their main one
  let needMain = keep.gid == null && !keep.company.trim();
  goneCos.forEach((g) => {
    if (g.gid == null) {
      if (!g.company.trim()) return;
      if (needMain) {
        needMain = false;
        set('company', g.company);
        if (!keep.pos.trim() && g.pos) set('pos', g.pos);
        set('status', g.st);
      } else if (!keepCos.some((k) => k.gid == null && nameKey(k.company) === nameKey(g.company))) typedCo = g.company;
      return;
    }
    const have = keepCos.find((k) => k.gid === g.gid);
    if (have) {
      if (!have.pos.trim() && g.pos.trim()) {
        if (have.main) set('pos', g.pos);
        else cos.push({ gid: g.gid, pos: g.pos, dept: have.dept || g.dept, role: have.role || g.role, st: have.st, fill: true });
      }
      return;
    }
    if (cos.some((c) => c.gid === g.gid)) return;
    if (needMain) {
      needMain = false;
      set('gid', g.gid);
      set('company', g.company);
      set('pos', g.pos);
      set('dept', g.dept);
      set('role', g.role);
      set('status', g.st);
      return;
    }
    cos.push({ gid: g.gid, pos: g.pos, dept: g.dept, role: g.role, st: g.st });
  });
  return { patch, cos, typedCo };
}

/** One row of the people CSV: a person with their companies' names (main first), last contact, next appointment. */
export interface CsvPerson { p: Person; cos: { name: string; pos: string; main: boolean; st: 'active' | 'left' }[]; last: string; next: string; active: boolean }
export const PEOPLE_CSV_HEAD = ['ชื่อ', 'ชื่อเล่น', 'บริษัทหลัก', 'ตำแหน่ง', 'บริษัทอื่นที่ติดต่อด้วย', 'โทรศัพท์', 'อีเมล', 'LINE', 'ผู้ดูแล', 'สถานะ', 'ติดต่อล่าสุด', 'นัดถัดไป'];
/** The people as a CSV, one row per person (a call list without repeats; the count is the page's): their other
 *  companies in one cell, "ชื่อ (ตำแหน่ง)" joined by " | ", "(ไม่อยู่แล้ว)" where they left. */
export function peopleCsv(rows: CsvPerson[]): string {
  const lines = [PEOPLE_CSV_HEAD.map(csvCell).join(',')];
  rows.forEach(({ p, cos, last, next, active }) => {
    const main = cos.find((c) => c.main);
    const other = cos.filter((c) => !c.main).map((c) => c.name + (c.pos ? ` (${c.pos})` : '') + (c.st === 'left' ? ' (ไม่อยู่แล้ว)' : '')).join(' | ');
    const phone = splitList(p.phone);
    lines.push([
      csvCell(p.name), csvCell(p.nick), csvCell(main ? main.name + (main.st === 'left' ? ' (ไม่อยู่แล้ว)' : '') : ''), csvCell(main?.pos || ''), csvCell(other),
      phone.length === 1 ? csvPhone(phone[0]) : csvCell(phone.join(' | ')), csvCell(p.email), csvCell(p.line), csvCell(p.owner),
      csvCell(active ? 'ยังติดต่อได้' : 'ไม่อยู่แล้ว'), csvCell(last), csvCell(next),
    ].join(','));
  });
  return lines.join('\r\n');
}

/** A person as seen at one company (engine personAt / peopleOf): their position, role and status there; `ncos`: how
 *  many companies they deal with still; `extra`: not their main one. A copy, never stored (only its id is written). */
export type PersonAt = Person & { ncos: number; extra: boolean };
