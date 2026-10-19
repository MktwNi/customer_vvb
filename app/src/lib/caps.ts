/**
 * Capabilities (package roles, item 4): what an account may see, change and manage. One catalogue,
 * mirrored verbatim in team-sync/Code.gs as CAPS_ (a parity test compares the two).
 *
 * - `real`: the team script leaves this data out of what it sends (pull redaction) to an account
 *   without the capability; every other "ดูได้" row only hides a page.
 * - `scope`: the capability can be "all" or "own" (own = deals whose ผู้รับผิดชอบ is the account's
 *   name; for del.log, records the account wrote itself).
 * - `needs`: the capability is dropped when the other is missing (resolved until stable, so
 *   pay.check needs view.cash, which needs view.money).
 *
 * The built-in roles reproduce what admin / sales / viewer could do before roles were configurable.
 * A script that sends no `me.caps` (the one deployed before this release) gets the built-in caps of
 * `me.role` (capsOf), so this client works against it unchanged.
 */

export type CapId =
  | 'view.sales' | 'view.plan' | 'view.money' | 'view.cash' | 'view.comm' | 'view.exp' | 'docs.open'
  | 'edit.cust' | 'edit.deal' | 'edit.task' | 'edit.pay' | 'edit.exp' | 'docs.up' | 'edit.ctag' | 'edit.jqt' | 'edit.share' | 'del.rec' | 'del.log'
  | 'qt.check' | 'pay.check' | 'notify.mail' | 'set.lists' | 'set.units' | 'set.dedup' | 'set.data' | 'set.users';
export type Scope = 'all' | 'own';
/** The capabilities an account or role holds, with their scope. */
export type CapSet = Partial<Record<CapId, Scope>>;
export type GroupId = 'v' | 'e' | 'a';
export interface CapDef { id: CapId; g: GroupId; label: string; desc: string; real?: boolean; scope?: boolean; needs?: CapId }

export const CAPS: CapDef[] = [
  { id: 'view.sales', g: 'v', label: 'ดู Sales Tracker และผู้ติดต่อ', desc: 'รายชื่อลูกค้า ดีล ขั้นตอน บันทึกการติดต่อ และ Dashboard' },
  { id: 'view.plan', g: 'v', label: 'ดูแผนติดต่อ', desc: 'ปฏิทินนัดหมายของทีม' },
  { id: 'view.money', g: 'v', label: 'ดูยอดเงิน', desc: 'Forecast, Actual, งวดชำระ และยอดในเอกสาร', real: true },
  { id: 'view.cash', g: 'v', label: 'ดู Cashflow', desc: 'เงินที่รับแล้วและเงินที่จะเข้า แยกตามปีและไตรมาส', needs: 'view.money' },
  { id: 'view.comm', g: 'v', label: 'ดูค่าคอมมิชชั่น / สัดส่วนรายได้', desc: 'ส่วนแบ่งของแต่ละหน่วยงานและค่าคอมมิชชั่น', real: true, needs: 'view.money' },
  { id: 'view.exp', g: 'v', label: 'ดูค่าใช้จ่ายและกำไรของงาน', desc: 'เงินที่จ่ายออกของแต่ละงาน และเงินคงเหลือหลังหักค่าใช้จ่าย', real: true, needs: 'view.money' },
  { id: 'docs.open', g: 'v', label: 'เปิดเอกสารแนบ', desc: 'ใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ', needs: 'view.money' },

  { id: 'edit.cust', g: 'e', label: 'ลูกค้าและผู้ติดต่อ', desc: 'เพิ่มและแก้ลูกค้า ผู้ติดต่อ บันทึกการติดต่อ' },
  { id: 'edit.deal', g: 'e', label: 'ดีลและขั้นตอน', desc: 'ส่งเข้า Sales Tracker บันทึกขั้นตอน ได้งาน/ไม่ได้งาน ปิดงาน', scope: true, needs: 'view.money' },
  { id: 'edit.task', g: 'e', label: 'นัดหมาย', desc: 'เพิ่ม แก้ และติ๊กว่าทำแล้วในแผนติดต่อ' },
  { id: 'edit.pay', g: 'e', label: 'แผนชำระเงินและการรับเงิน', desc: 'ตั้งงวด บันทึกรับเงิน แนบใบเสร็จ', scope: true, needs: 'view.money' },
  { id: 'edit.exp', g: 'e', label: 'บันทึกค่าใช้จ่ายของงาน', desc: 'เพิ่ม แก้ และลบค่าใช้จ่าย พร้อมแนบบิลหรือใบเสร็จ', scope: true, needs: 'view.exp' },
  { id: 'docs.up', g: 'e', label: 'แนบเอกสาร', desc: 'แนบใบเสนอราคา ฉบับแก้ไข และใบแจ้งหนี้', needs: 'view.money' },
  { id: 'edit.ctag', g: 'e', label: 'ติดประเภทลูกค้า', desc: 'CFO, CFP, ที่ปรึกษา, ทวนสอบ และอื่นๆ' },
  { id: 'edit.jqt', g: 'e', label: 'สร้างใบเสนอราคาร่วม', desc: 'ใบเสนอราคาหัวเดียว ทำหลายบริษัท', needs: 'view.money' },
  { id: 'edit.share', g: 'e', label: 'แก้สัดส่วน % ของงาน', desc: 'แบ่งยอดของงานให้แต่ละหน่วยงาน', needs: 'view.comm' },
  { id: 'del.rec', g: 'e', label: 'ลบดีล ลูกค้า และผู้ติดต่อ', desc: 'ลบออกจากข้อมูลของทีม' },
  { id: 'del.log', g: 'e', label: 'ลบบันทึกการติดต่อ', desc: 'บันทึกการติดต่อและนัดที่ผ่านมา', scope: true },

  { id: 'qt.check', g: 'a', label: 'ตรวจ/อนุมัติใบเสนอราคา', desc: 'กด อนุมัติ ว่าข้อมูลถูกต้อง หรือ ส่งกลับแก้ไข', needs: 'view.money' },
  { id: 'pay.check', g: 'a', label: 'ตรวจยืนยันรับเงิน (บัญชี)', desc: 'กด ตรวจแล้ว ที่เงินเข้าแต่ละรายการ หรือ ส่งกลับแก้ไข และปิดเดือน', needs: 'view.cash' },
  { id: 'notify.mail', g: 'a', label: 'รับอีเมลแจ้งเตือน', desc: 'ใบเสนอราคาใหม่ งวดถึงกำหนด และนัดหมาย' },
  { id: 'set.lists', g: 'a', label: 'ตั้งค่ารายการ', desc: 'หมวด SOURCE Services และประเภทลูกค้า' },
  { id: 'set.units', g: 'a', label: 'ตั้งค่าหน่วยงานและอัตราคอมมิชชั่น', desc: 'รายชื่อหน่วยงาน คนในหน่วยงาน และอัตรา %', needs: 'view.comm' },
  { id: 'set.dedup', g: 'a', label: 'ตรวจข้อมูลซ้ำ', desc: 'ตัดสินว่าบริษัทซ้ำกันหรือไม่' },
  { id: 'set.data', g: 'a', label: 'นำเข้าข้อมูลและไฟล์สำรอง', desc: 'นำเข้า Sales Tracker เดิม ไฟล์สำรองทีม (ส่งออก CSV ทำได้ทุกคนที่เห็นหน้านั้น)' },
  { id: 'set.users', g: 'a', label: 'จัดการผู้ใช้และสิทธิ์', desc: 'บัญชี บทบาท และอนุมัติคำขอ · เฉพาะผู้ดูแลระบบ' },
];
export const CAP = Object.fromEntries(CAPS.map((c) => [c.id, c])) as Record<CapId, CapDef>;
export const CAP_IDS = CAPS.map((c) => c.id);
export const isCap = (x: unknown): x is CapId => typeof x === 'string' && x in CAP;

export const GROUPS: { id: GroupId; title: string; note: string }[] = [
  { id: 'v', title: 'ดูได้', note: 'ปิดแล้วจะซ่อนเมนูและหน้านั้น แต่ข้อมูลยังส่งถึงเครื่องผู้ใช้ ยกเว้นข้อที่มีป้าย “ซ่อนข้อมูลจริง” ซึ่งเซิร์ฟเวอร์จะไม่ส่งตัวเลขไปเลย' },
  { id: 'e', title: 'แก้ไขได้', note: 'เซิร์ฟเวอร์ของทีมตรวจทุกครั้งที่บันทึก บัญชีที่ไม่มีสิทธิ์จะบันทึกไม่ได้ แม้จะแก้โค้ดในเครื่องเอง' },
  { id: 'a', title: 'เข้าถึงและจัดการ', note: 'งานตั้งค่าและงานของหัวหน้า เซิร์ฟเวอร์ตรวจทุกครั้งเช่นกัน' },
];
/** The chip on view.money / view.comm, and what it means. */
export const REAL_WORD = 'ซ่อนข้อมูลจริง';
export const REAL_TIP = 'เซิร์ฟเวอร์ไม่ส่งตัวเลขนี้ไปที่เครื่องของบัญชีที่ไม่มีสิทธิ์';
/** The scope control's words (del.log is about records, not deals). */
export const scopeWord = (id: CapId, s: Scope) => (s === 'all' ? 'ทั้งหมด' : id === 'del.log' ? 'เฉพาะของตัวเอง' : 'เฉพาะงานของตัวเอง');

/** Never granted to a role other than admin, as an extra, or by a request: whoever holds it could make
 *  an all-capabilities role for themselves. */
export const LOCKED_CAP: CapId = 'set.users';
/** Capabilities that let an account send changes at all (pushing needs one of them). */
export const WRITE_CAPS: CapId[] = [...CAPS.filter((c) => c.g === 'e').map((c) => c.id), 'pay.check', 'set.lists', 'set.units', 'set.dedup', 'set.data', 'set.users'];

export const MAX_ROLES = 10;
export const ROLE_NAME_MAX = 30;

const all = (ids: CapId[]): CapSet => Object.fromEntries(ids.map((k) => [k, 'all'])) as CapSet;
export const ALL_CAPS: CapSet = all(CAP_IDS);
const SALES: CapSet = { ...all(['view.sales', 'view.plan', 'view.money', 'view.cash', 'view.exp', 'docs.open', 'edit.cust', 'edit.deal', 'edit.task', 'edit.pay', 'docs.up', 'edit.ctag', 'edit.jqt', 'notify.mail']), 'edit.exp': 'own', 'del.log': 'own' };
const VIEWER: CapSet = all(['view.sales', 'view.plan', 'view.money', 'view.cash', 'docs.open']);

export type BuiltinId = 'admin' | 'sales' | 'viewer';
export interface RoleDef { id: string; n: string; d: string; c: CapSet; builtin?: boolean; o?: number; at?: string; by?: string }
/** The three roles every team has (their ids are the ones accounts were made with). */
export const BUILTIN: Record<BuiltinId, RoleDef> = {
  admin: { id: 'admin', n: 'ผู้ดูแลระบบ', d: 'ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้และสิทธิ์', c: ALL_CAPS, builtin: true, o: 0 },
  sales: { id: 'sales', n: 'พนักงานขาย', d: 'เพิ่มและแก้ลูกค้า ดีล นัดหมาย แผนชำระ และแนบเอกสาร บันทึกค่าใช้จ่ายของงานตัวเอง ลบได้เฉพาะบันทึกของตัวเอง', c: SALES, builtin: true, o: 1 },
  viewer: { id: 'viewer', n: 'ดูอย่างเดียว', d: 'ดูได้ทุกหน้า รวมยอดเงินและ Cashflow แก้ไขไม่ได้', c: VIEWER, builtin: true, o: 2 },
};
export const BUILTIN_IDS = Object.keys(BUILTIN) as BuiltinId[];
export const isBuiltin = (id: string): id is BuiltinId => id in BUILTIN;

/** Drop every capability whose `needs` is missing, until nothing changes (pay.check → view.cash →
 *  view.money). set.users is the admin role's alone: callers pass `admin` for it. */
export function closeNeeds(c: CapSet): CapSet {
  const out: CapSet = { ...c };
  for (let changed = true; changed; ) {
    changed = false;
    for (const k of Object.keys(out) as CapId[]) {
      const n = CAP[k]?.needs;
      if (!CAP[k] || (n && !out[n])) {
        delete out[k];
        changed = true;
      }
    }
  }
  return out;
}

/** Capabilities as the team script sends them: a map {cap: 1 | 'all' | 'own'} (ROLES, me.caps), a
 *  list of ids, or a list of {k, s}. Unknown ids are ignored; scope 'own' only where it exists. */
export function parseCaps(x: unknown): CapSet | null {
  if (x == null || typeof x !== 'object') return null;
  const out: CapSet = {};
  const put = (k: unknown, s: unknown) => {
    if (!isCap(k) || s === 0 || s === false || s == null || s === '') return;
    const v: Scope = s === 'own' && CAP[k].scope ? 'own' : 'all';
    if (out[k] !== 'all') out[k] = v;
  };
  if (Array.isArray(x)) x.forEach((i) => (typeof i === 'string' ? put(i, 1) : i && typeof i === 'object' && put((i as { k?: unknown }).k, (i as { s?: unknown }).s ?? 1)));
  else Object.entries(x as Record<string, unknown>).forEach(([k, s]) => put(k, s));
  return out;
}
/** The map the team script stores: {cap: 1 | 'own'}. */
export const capsWire = (c: CapSet) => Object.fromEntries((Object.entries(c) as [CapId, Scope | undefined][]).filter(([k, s]) => s && isCap(k)).map(([k, s]) => [k, s === 'own' ? 'own' : 1]));

/**
 * Capabilities added after the first build with capabilities shipped (job expenses). That build cannot show
 * them, so the team script keeps a role's value for one its role_save does not name (Code.gs LATE_CAPS_):
 * this build names each of them, 0 when off (roleWire). They only ever come from the script: one before
 * capabilities (no me.caps) never stored or hid their records, so its built-in role gives none (capsOf).
 */
export const LATE_CAPS: CapId[] = ['view.exp', 'edit.exp'];
/** A role's capabilities as role_save sends them: capsWire, plus 0 for every LATE_CAPS one that is off. */
export const roleWire = (c: CapSet): Record<string, 1 | 'own' | 0> => ({ ...Object.fromEntries(LATE_CAPS.map((k) => [k, 0 as const])), ...(capsWire(c) as Record<string, 1 | 'own'>) });

/** Both sets together; the wider scope wins. */
export function unionCaps(a: CapSet, b: CapSet): CapSet {
  const out: CapSet = { ...a };
  (Object.entries(b) as [CapId, Scope][]).forEach(([k, s]) => {
    if (out[k] !== 'all') out[k] = s;
  });
  return out;
}

export interface CapGrant { k: string; s?: Scope; until?: string; by?: string; at?: string }
export interface RoleGrant { id: string; until?: string; by?: string; at?: string }
/** Per-account extras and a temporary role (Script Property GRANTS[u]). */
export interface Grants { r?: RoleGrant; c?: CapGrant[] }
/** `until` is the last day it holds (inclusive); none = for good. */
export const live = (until: string | undefined, today: string) => !until || until >= today;

/**
 * What an account may do: the role's capabilities plus its unexpired extras, needs applied. The role
 * is the temporary one while it holds. `roles` maps role ids to their capabilities; an unknown role
 * gives nothing (default deny); admin is always everything.
 */
export function resolveCaps(baseRole: string, roles: Record<string, CapSet>, g: Grants | undefined, today: string): CapSet {
  // a temporary role holds while it lasts and exists; never admin, and never narrows an admin (the script
  // decides the same, capsOf_)
  const rid = baseRole !== 'admin' && g?.r && g.r.id !== 'admin' && live(g.r.until, today) && (g.r.id in roles || isBuiltin(g.r.id)) ? g.r.id : baseRole;
  if (rid === 'admin') return { ...ALL_CAPS };
  let c: CapSet = { ...(roles[rid] || {}) };
  delete c[LOCKED_CAP];
  (g?.c || []).forEach((x) => {
    if (isCap(x.k) && x.k !== LOCKED_CAP && live(x.until, today)) c = unionCaps(c, { [x.k]: x.s === 'own' && CAP[x.k].scope ? 'own' : 'all' });
  });
  return closeNeeds(c);
}

/** A signed-in account as the client knows it. */
export interface CapHolder { role: string; caps?: CapSet | null }
/** The account's capabilities: what the script sent (me.caps), or — from a script that sends none (the
 *  one deployed before this release) — the built-in caps of me.role, less LATE_CAPS (that script neither
 *  hides nor guards job expenses). An unknown role gets nothing.
 *  null = no accounts (team code, or this browser only): everything is allowed, as before accounts. */
export function capsOf(s: CapHolder | null | undefined): CapSet | null {
  if (!s) return null;
  if (s.caps) return closeNeeds(s.caps);
  if (!isBuiltin(s.role)) return {};
  const c: CapSet = { ...BUILTIN[s.role].c };
  LATE_CAPS.forEach((k) => delete c[k]);
  return c;
}

/** Names as people type them in ผู้รับผิดชอบ and as accounts carry them: the same person whatever the
 *  spacing, case or Unicode form. */
export const nameNorm = (s: unknown) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
export const sameName = (a: unknown, b: unknown) => !!nameNorm(a) && nameNorm(a) === nameNorm(b);

/**
 * May this account do `cap`? `own`: whether the record is the account's (its deal, or its own
 * record); left out, a capability held with any scope counts (whether to show the control at all).
 * null caps = no accounts: everything.
 */
export function can(caps: CapSet | null, cap: CapId, own?: boolean): boolean {
  if (caps == null) return true;
  const s = caps[cap];
  if (!s) return false;
  return s === 'all' || own === undefined || own;
}
export const hasWrite = (caps: CapSet | null) => caps == null || WRITE_CAPS.some((k) => !!caps[k]);
/** The role word the script reports to builds that know no capabilities (me.role). */
export const legacyRole = (caps: CapSet): BuiltinId => (caps[LOCKED_CAP] ? 'admin' : hasWrite(caps) ? 'sales' : 'viewer');

// ------------------------------------------------------------------ which record needs which capability

/** How a record's owner is found for an `own` capability: the deal's ผู้รับผิดชอบ, or the record's
 *  stored writer (`by`). */
export type OwnBy = 'resp' | 'by';
export interface KeyRule { caps: CapId[]; own?: OwnBy }
/** No push may write it (only a script action does): qchk/ (the QT check). */
export const SERVER_ONLY = ['qchk/'];

/** The capability (any of `caps`) that writing (or deleting) record `k` needs; null = denied unless the
 *  account manages users (an unknown record type). Mirrors Code.gs KEY_CAP. */
export function keyRule(k: string, del: boolean): KeyRule | null | 'never' {
  if (SERVER_ONLY.some((p) => k.startsWith(p))) return 'never';
  const r = (w: CapId | CapId[], d: CapId | CapId[], wOwn?: OwnBy, dOwn?: OwnBy): KeyRule => {
    const x = del ? d : w;
    const own = del ? dOwn : wOwn;
    return { caps: Array.isArray(x) ? x : [x], ...(own ? { own } : {}) };
  };
  const p = k.slice(0, k.indexOf('/') + 1);
  switch (p) {
    case 'stage/': case 'owner/': case 'watch/': case 'contact/': case 'ccol/':
      return r('edit.cust', 'edit.cust');
    case 'cust/': case 'person/':
      return r('edit.cust', 'del.rec');
    case 'log/':
      return r('edit.cust', 'del.log', undefined, 'by');
    case 'task/':
      return r('edit.task', 'edit.task');
    case 'deal/':
      return r('edit.deal', 'del.rec', 'resp');
    case 'dstep/':
      return r('edit.deal', 'edit.deal', 'resp', 'resp');
    case 'dact/':
      return r('edit.deal', 'del.log', 'resp', 'by');
    case 'dlog/':
      // the history of a deal's expenses has keys of its own (dlog/exp.<id>): the script leaves them out
      // for an account without ดูค่าใช้จ่าย
      if (k.startsWith('dlog/exp.')) return r(['edit.exp', 'pay.check'], 'set.users');
      return r(['edit.deal', 'edit.pay', 'docs.up', 'edit.jqt', 'edit.share', 'pay.check'], 'set.users');
    case 'ddoc/':
      return r('docs.up', 'docs.up');
    case 'dpay/':
      return r('edit.pay', 'edit.pay', 'resp', 'resp');
    case 'dexp/':
      return r('edit.exp', 'edit.exp', 'resp', 'resp');
    case 'ctag/':
      return r('edit.ctag', 'edit.ctag');
    case 'jqt/':
      return r('edit.jqt', 'del.rec');
    case 'jqm/':
      return r('edit.jqt', 'edit.jqt');
    case 'dshare/':
      return r('edit.share', 'edit.share');
    case 'dchk/': case 'mclose/':
      return r('pay.check', 'pay.check');
    case 'dedup/':
      return r('set.dedup', 'set.dedup');
    case 'team/':
      return r('set.users', 'set.users');
    case 'dundo/':
      return r('set.data', 'set.data');
    case 'scfg/': {
      const name = k.slice(5);
      if (/^paychk\./.test(name) || /^notify\./.test(name)) return r('set.users', 'set.users');
      if (/^unitm?\./.test(name)) return r('set.units', 'set.units');
      // a plain list (no dot), ct.* (customer types), cc.* (colours); any other kind is unknown
      if (!name.includes('.') || /^(ct|cc)\./.test(name)) return r('set.lists', 'set.lists');
      return null;
    }
  }
  return null;
}
/** The record prefixes the allow-list knows (for tests and the parity check). */
export const KNOWN_PREFIXES = ['stage/', 'owner/', 'watch/', 'contact/', 'ccol/', 'cust/', 'person/', 'log/', 'task/', 'deal/', 'dstep/', 'dact/', 'dlog/exp.', 'dlog/', 'ddoc/', 'dpay/', 'dexp/', 'ctag/', 'jqt/', 'jqm/', 'dshare/', 'dchk/', 'mclose/', 'dedup/', 'team/', 'dundo/', 'scfg/', 'qchk/'];

/**
 * May this account write (or delete) record `k`? `own`: whether the record is the account's, for a rule
 * that has an owner (left out: not known, counted as not its own when the capability is `own` only).
 * null caps = no accounts: anything. Unknown record types: only an account that manages users.
 */
export function canWriteKey(caps: CapSet | null, k: string, del: boolean, own?: boolean): boolean {
  if (caps == null) return true;
  const rule = keyRule(k, del);
  if (rule === 'never') return false;
  if (rule == null) return !!caps[LOCKED_CAP];
  return rule.caps.some((c) => can(caps, c, rule.own ? !!own : undefined));
}

// ------------------------------------------------------------------ words

/** How a capability reads in "ทำได้เพิ่ม: …" (the editing ones say แก้ไข…). */
const PHRASE: Partial<Record<CapId, string>> = {
  'edit.cust': 'แก้ไขลูกค้าและผู้ติดต่อ', 'edit.deal': 'แก้ไขดีลและขั้นตอน', 'edit.task': 'แก้ไขนัดหมาย', 'edit.pay': 'แก้ไขแผนชำระเงินและการรับเงิน',
};
export const capPhrase = (k: CapId) => PHRASE[k] || CAP[k].label;
/** Short names for the role editor's save bar. */
const SHORT: Partial<Record<CapId, string>> = { 'view.comm': 'ค่าคอมมิชชั่น', 'view.exp': 'ดูค่าใช้จ่าย', 'edit.exp': 'บันทึกค่าใช้จ่าย' };
export const capShort = (k: CapId) => SHORT[k] || CAP[k].label;

/** What `to` adds over `from`, in words (a wider scope counts too). */
export function gained(from: CapSet, to: CapSet): string[] {
  const out: string[] = [];
  CAPS.forEach(({ id }) => {
    const a = from[id], b = to[id];
    if (b && !a) out.push(capPhrase(id) + (b === 'own' ? ' (เฉพาะงานของตัวเอง)' : ''));
    else if (a === 'own' && b === 'all') out.push(capPhrase(id) + 'ของทุกคน');
  });
  return out;
}
/** What `to` no longer has of `from` (a narrower scope counts too: "แก้ไขดีลและขั้นตอนของคนอื่น"). */
export const lost = (from: CapSet, to: CapSet) =>
  CAPS.flatMap((c) => (from[c.id] && !to[c.id] ? [capPhrase(c.id)] : from[c.id] === 'all' && to[c.id] === 'own' ? [capPhrase(c.id) + 'ของคนอื่น'] : []));
/** "a · b · c และอีก n รายการ" */
export const listWords = (xs: string[], max = 3) => xs.slice(0, max).join(' · ') + (xs.length > max ? ` และอีก ${xs.length - max} รายการ` : '');

const EDIT_NOUNS: [CapId, string][] = [['edit.cust', 'ลูกค้า'], ['edit.deal', 'ดีล'], ['edit.task', 'นัดหมาย'], ['edit.pay', 'แผนชำระ']];
/** The role's description when none was typed: what it lets people do, in one line. */
export function summarize(c: CapSet): string {
  if (CAP_IDS.every((k) => c[k])) return BUILTIN.admin.d;
  const parts: string[] = [];
  const nouns = EDIT_NOUNS.filter(([k]) => c[k]).map(([, w]) => w);
  const edits = nouns.length || c['docs.up'];
  if (!edits && !WRITE_CAPS.some((k) => c[k]) && !c['qt.check']) {
    // a role that only looks
    const pages = c['view.sales'] && c['view.plan'] ? 'ดูได้ทุกหน้า' : c['view.sales'] ? 'ดู Sales Tracker และผู้ติดต่อ' : c['view.plan'] ? 'ดูแผนติดต่อ' : 'ดูหน้าทะเบียนบริษัท';
    const money = c['view.money'] ? ' รวมยอดเงิน' + (c['view.cash'] ? 'และ Cashflow' : '') + (c['view.comm'] ? ' และค่าคอมมิชชั่น' : '') + (c['view.exp'] ? ' และค่าใช้จ่ายของงาน' : '') : ' ไม่เห็นยอดเงิน';
    if (!c['view.sales'] && !c['view.plan'] && !c['view.money']) return 'ยังไม่มีสิทธิ์ใดเลย นอกจากหน้าทะเบียนบริษัท';
    return pages + money + ' แก้ไขไม่ได้';
  }
  if (edits) parts.push(nouns.length ? 'เพิ่มและแก้' + nouns.join(' ') + (c['docs.up'] ? ' และแนบเอกสาร' : '') : 'แนบเอกสาร');
  if (c['edit.exp']) parts.push(c['edit.exp'] === 'own' ? 'บันทึกค่าใช้จ่ายของงานตัวเอง' : 'บันทึกค่าใช้จ่ายของงาน');
  if (c['del.rec']) parts.push('ลบดีล ลูกค้า และผู้ติดต่อได้');
  else if (c['del.log'] === 'own') parts.push('ลบได้เฉพาะบันทึกของตัวเอง');
  else if (c['del.log']) parts.push('ลบบันทึกการติดต่อได้');
  if (!c['view.money']) parts.push('ไม่เห็นยอดเงิน');
  else if (c['view.comm']) parts.push(c['edit.share'] ? 'เห็นค่าคอมมิชชั่นและแบ่งสัดส่วนงาน' : 'เห็นค่าคอมมิชชั่น');
  const jobs = ([['qt.check', 'ตรวจใบเสนอราคา'], ['pay.check', 'ตรวจยืนยันรับเงิน'], ['set.lists', 'ตั้งค่ารายการ'], ['set.units', 'ตั้งค่าหน่วยงาน'], ['set.dedup', 'ตรวจข้อมูลซ้ำ'], ['set.data', 'นำเข้าข้อมูลและไฟล์สำรอง']] as [CapId, string][])
    .filter(([k]) => c[k])
    .map(([, w]) => w);
  if (jobs.length) parts.push(jobs.join(' '));
  return parts.join(' ');
}
/** A role's line wherever it is picked: its own description, or the generated one. */
export const roleLine = (r: Pick<RoleDef, 'd' | 'c'>) => (r.d || '').trim() || summarize(r.c);

/** Same capabilities, same scopes. */
export const sameCaps = (a: CapSet, b: CapSet) => CAP_IDS.every((k) => (a[k] || '') === (b[k] || ''));
/** What a capability needs that the set lacks (the request dialog asks for it too). */
export function needsChain(k: CapId, have: CapSet): CapId[] {
  const out: CapId[] = [];
  for (let n = CAP[k].needs; n && !have[n] && !out.includes(n); n = CAP[n].needs) out.push(n);
  return out;
}

// ------------------------------------------------------------------ requests and the admin's directory

/** One capability asked for or granted, with its scope. */
export interface CapAsk { k: CapId; s: Scope }
/** A request waiting for an admin (Script Property REQS[u]): a role, or extra capabilities. */
export interface ReqPending { id: string; k: 'role' | 'caps'; role?: string; caps?: CapAsk[]; note: string; until?: string; at: string }
/** The decision on the account's last request, until it is read (RESULTS[u], cleared by req_ack). */
export interface ReqResult { ok: boolean; by: string; note: string; at: string; role?: string; caps?: CapAsk[]; until?: string }
/** me.req: the account's own pending request (st 'p') or its unread result (st 'r'). */
export type MyReq = ({ st: 'p' } & ReqPending) | ({ st: 'r' } & ReqResult);

const str = (x: unknown) => (typeof x === 'string' ? x : x == null ? '' : String(x));
const asks = (x: unknown): CapAsk[] | undefined => {
  if (!Array.isArray(x)) return undefined;
  const c = parseCaps(x);
  return c ? (Object.entries(c) as [CapId, Scope][]).map(([k, s]) => ({ k, s })) : undefined;
};
export function parseReqPending(x: unknown): ReqPending | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const k = r.k === 'caps' ? 'caps' : r.k === 'role' ? 'role' : r.role ? 'role' : Array.isArray(r.caps) ? 'caps' : null;
  if (!k) return null;
  return { id: str(r.id), k, ...(r.role ? { role: str(r.role) } : {}), ...(asks(r.caps) ? { caps: asks(r.caps) } : {}), note: str(r.note), ...(r.until ? { until: str(r.until).slice(0, 10) } : {}), at: str(r.at) };
}
export function parseReqResult(x: unknown): ReqResult | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  return { ok: r.ok === true || r.ok === 1 || r.ok === '1', by: str(r.by), note: str(r.note), at: str(r.at), ...(r.role ? { role: str(r.role) } : {}), ...(asks(r.caps) ? { caps: asks(r.caps) } : {}), ...(r.until ? { until: str(r.until).slice(0, 10) } : {}) };
}
/** me.req as the script sends it: {st:'p'|'r', …}, or without `st` — a record with `ok` is a result. */
export function parseMyReq(x: unknown): MyReq | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const result = r.st === 'r' || (r.st !== 'p' && 'ok' in r);
  if (result) {
    const v = parseReqResult(r);
    return v && { st: 'r', ...v };
  }
  const v = parseReqPending(r);
  return v && { st: 'p', ...v };
}

/** The roles of the `users` reply (ROLES {v, roles:{id:{n,d,c,o,at,by}}}, or just the map), with the
 *  built-ins always there (admin is always everything). Sorted: built-ins first, then by `o`, name. */
export function parseRoles(x: unknown): RoleDef[] {
  const m = (x && typeof x === 'object' && 'roles' in (x as object) ? (x as { roles: unknown }).roles : x) as Record<string, unknown> | null;
  const out = new Map<string, RoleDef>(BUILTIN_IDS.map((id) => [id, { ...BUILTIN[id], c: { ...BUILTIN[id].c } }]));
  if (m && typeof m === 'object' && !Array.isArray(m))
    Object.entries(m).forEach(([id, v]) => {
      if (!v || typeof v !== 'object' || id === 'admin') return;
      const r = v as Record<string, unknown>;
      const b = isBuiltin(id) ? BUILTIN[id] : null;
      out.set(id, {
        id,
        n: str(r.n) || b?.n || id,
        d: r.d != null ? str(r.d) : b?.d || '',
        c: closeNeeds(parseCaps(r.c) || {}),
        ...(b ? { builtin: true } : {}),
        o: Number.isFinite(Number(r.o)) && r.o != null ? Number(r.o) : b?.o ?? 100,
        ...(r.at ? { at: str(r.at) } : {}),
        ...(r.by ? { by: str(r.by) } : {}),
      });
    });
  const list = [...out.values()];
  list.forEach((r) => r.c && delete r.c[LOCKED_CAP]);
  out.get('admin')!.c = { ...ALL_CAPS };
  return list.sort((a, b) => Number(!a.builtin) - Number(!b.builtin) || (a.o ?? 100) - (b.o ?? 100) || a.n.localeCompare(b.n, 'th'));
}
export function parseGrants(x: unknown): Record<string, Grants> {
  const out: Record<string, Grants> = {};
  if (!x || typeof x !== 'object') return out;
  Object.entries(x as Record<string, unknown>).forEach(([u, v]) => {
    if (!v || typeof v !== 'object') return;
    const g = v as Record<string, unknown>;
    const r = g.r && typeof g.r === 'object' ? (g.r as Record<string, unknown>) : null;
    const c = Array.isArray(g.c) ? (g.c as Record<string, unknown>[]).filter((i) => i && isCap(i.k)) : [];
    out[u] = {
      ...(r && r.id ? { r: { id: str(r.id), ...(r.until ? { until: str(r.until).slice(0, 10) } : {}), by: str(r.by), at: str(r.at) } } : {}),
      ...(c.length ? { c: c.map((i) => ({ k: str(i.k), s: i.s === 'own' ? ('own' as const) : ('all' as const), ...(i.until ? { until: str(i.until).slice(0, 10) } : {}), by: str(i.by), at: str(i.at) })) } : {}),
    };
  });
  return out;
}
export function parseReqs(x: unknown): Record<string, ReqPending> {
  const out: Record<string, ReqPending> = {};
  if (x && typeof x === 'object') Object.entries(x as Record<string, unknown>).forEach(([u, v]) => {
    const r = parseReqPending(v);
    if (r) out[u] = r;
  });
  return out;
}
/** One row of the audit tab: who did what to whose permissions. */
export interface AuditRow { at: string; actor: string; u: string; action: string; detail: Record<string, unknown>; note: string }
export function parseAudit(x: unknown): AuditRow[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((r): AuditRow | null => {
      if (!r || typeof r !== 'object') return null;
      const a = r as Record<string, unknown>;
      let detail: Record<string, unknown> = {};
      if (a.detail && typeof a.detail === 'object') detail = a.detail as Record<string, unknown>;
      else if (typeof a.detail === 'string' && a.detail) {
        try {
          const j = JSON.parse(a.detail);
          if (j && typeof j === 'object') detail = j;
        } catch {
          detail = { text: a.detail };
        }
      }
      return { at: str(a.at), actor: str(a.actor), u: str(a.u), action: str(a.action), detail, note: str(a.note) };
    })
    .filter((r): r is AuditRow => !!r)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
