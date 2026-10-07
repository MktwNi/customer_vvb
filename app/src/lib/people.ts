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

export interface Suggestion { id: string; name: string; gid: number | null; company: string; phone: string; email: string; from: string }

/**
 * Contact persons named in the Sales Tracker (a deal's ผู้ติดต่อ) and in customers added by hand that
 * nobody has recorded as a person yet. `canon` maps a company id to the one it is merged into; `hidden`
 * are ids hidden or deleted on this browser.
 */
export function personSuggestions(
  people: Person[],
  deals: Deal[],
  custom: CustomCo[],
  canon: (gid: number) => number | null,
  hidden: Set<string>,
): Suggestion[] {
  const coKey = (gid: number | null, company: string) => (gid != null ? 'g' + gid : 'n' + nameKey(company));
  const known = people.map((p) => {
    const g = p.gid != null ? canon(p.gid) ?? p.gid : null;
    return { co: coKey(g, p.company), name: nameKey(p.name), phones: phoneKeys(p.phone), email: p.email.trim().toLowerCase(), id: p.id };
  });
  const out = new Map<string, Suggestion>();
  const add = (name: string, gid: number | null, company: string, phone: string, email: string, from: string) => {
    name = name.trim();
    const nk = nameKey(name);
    if (!nk || nk.length < 2) return;
    const g = gid != null ? canon(gid) : null;
    const co = coKey(g, company);
    const id = stableId('s', co, nk);
    if (hidden.has(id) || out.has(id)) return;
    const ph = phoneKeys(phone), em = email.trim().toLowerCase();
    if (known.some((k) => k.id === id || (k.co === co && (k.name === nk || (ph.length > 0 && ph.some((x) => k.phones.includes(x))) || (!!em && k.email === em))))) return;
    out.set(id, { id, name, gid: g, company, phone, email, from });
  };
  deals.forEach((d) => d.contactName && add(d.contactName, d.gid, d.client, d.phone, d.email, 'Sales Tracker ปี ' + d.year));
  custom.forEach((c) => c.contact && add(c.contact, c.id, c.name, '', '', 'ลูกค้าที่เพิ่มเอง'));
  return [...out.values()].sort((a, b) => a.company.localeCompare(b.company, 'th') || a.name.localeCompare(b.name, 'th'));
}
