/**
 * People: the contact persons at customer companies (ผู้ติดต่อ), shared with the team as `person/<id>`
 * records that merge field by field like customers added by hand. A person links to a company the whole
 * team has (`gid`, registry or hand-added) or only names it (`company`, e.g. a company from the TGO
 * website sync, which exists on one device only). Calls and notes about a person are contact-log entries
 * with `pid` (in the company's log, so the company page shows them too).
 */
import type { CustomCo, Person, PersonRole } from './types';
import type { Deal } from './sales';

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

export interface Suggestion { id: string; name: string; gid: number | null; company: string; phone: string; email: string; from: string }

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
  const known = people.map((p) => ({ co: coKeys(p.gid, p.company), name: nameKey(p.name), phones: phoneKeys(p.phone), email: p.email.trim().toLowerCase() }));
  const ids = new Set(people.map((p) => p.id));
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
    out.set(id, { id, name, gid: shared ?? gid, company, phone, email, from });
  };
  // (`linked`: the deal's typed name is a person linked to it already, whatever their company; a typed name the
  // deal's linked people are not is still someone to record)
  deals.forEach((d) => d.contactName && !linked(d) && add(d.contactName, d.gid, d.client, d.phone, d.email, 'Sales Tracker ปี ' + d.year));
  custom.forEach((c) => c.contact && add(c.contact, c.id, c.name, '', '', 'ลูกค้าที่เพิ่มเอง'));
  return [...out.values()].sort((a, b) => a.company.localeCompare(b.company, 'th') || a.name.localeCompare(b.name, 'th'));
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
/** What the rest of a `person/` key names: a person (`pid`), or a deal's contact link (`pid/deal`); null = neither. */
export function personKey(rest: string): { pid: string; deal?: string } | null {
  const p = (rest || '').split('/');
  if (!p[0]) return null;
  if (p.length === 1) return { pid: p[0] };
  return p.length === 2 && p[1] ? { pid: p[0], deal: p[1] } : null;
}
/** The person a record key is (`person/<id>`); '' for any other key, a deal's contact link included. */
export function personIdOf(k: string) {
  if (!k.startsWith('person/')) return '';
  const x = personKey(k.slice(7));
  return x && !x.deal ? x.pid : '';
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
