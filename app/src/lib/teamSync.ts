/**
 * Team sync — shares CRM data (stars, sales stage, owners, tasks, contact log, contact edits,
 * team list, dedup decisions) between browsers through a Google Apps Script web app backed by
 * a Google Sheet (see team-sync/Code.gs and team-sync/README.md).
 *
 * Every piece of shared state is a record with a string key; a change is an op {k, v} or a
 * tombstone {k, del:true}. The server keeps an append-only log ordered by `seq` — the last op
 * that reaches the server for a key wins. Clients pull rows with seq > cursor and push queued ops.
 */
import type { ContactEdit, Crm, CustomCo, LogEntry, StageKey, Task } from './types';
import type { Deal, DealDoc, DealLog, DealStep, SalesCfg, SalesState } from './sales';

/** `id` identifies this queued change locally (for acknowledging it across tabs), `t` (ms) orders
 *  changes to the same record, and `sent` is the sheet's seq when it was last pushed; the server
 *  ignores all three. */
/** `f` = the fields this op changes in an object record (deal, document, customer); without it the
 *  whole value is this browser's. Kept in the queue only — the sheet gets k, v, del, by. */
export interface SyncOp { id?: string; t?: number; sent?: number; k: string; v?: unknown; del?: boolean; by?: string; f?: string[]; lst?: ListEdit }
/** What a queued list change (scfg/…) does: items added and removed (a rename is both). */
export interface ListEdit { add: string[]; rm: string[] }
export interface SyncRow { seq: number; k: string; v: unknown; del: boolean; by: string; at: string }
/** `seeded` = local records that the sheet didn't have yet were queued for upload (first connect). */
export interface TeamCfg { url: string; key: string; seq: number; seeded?: boolean }
export type TeamStatus = 'off' | 'connecting' | 'syncing' | 'ok' | 'error' | 'offline';
export interface TeamState { status: TeamStatus; msg: string; last: string }

export type Transport = (url: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;

export class TeamSyncError extends Error {
  constructor(msg: string, readonly code = '') {
    super(msg);
  }
}

/** Collision-free id for a queued change (thousands are created within one millisecond). */
let opN = 0;
export const opId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${(++opN).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ERR_TH: Record<string, string> = {
  unauthorized: 'รหัสทีมไม่ถูกต้อง',
  no_team_key: 'สคริปต์ยังไม่มีรหัสทีม (TEAM_KEY อย่างน้อย 8 ตัวอักษร) — ตั้งรหัสแล้วกด Deploy → Manage deployments → Edit → New version',
  busy: 'ชีตกำลังบันทึกข้อมูลของคนอื่นอยู่ จะลองใหม่อัตโนมัติ',
  too_many_ops: 'ส่งข้อมูลครั้งละมากเกินไป',
  // attached documents (teamFiles.ts)
  file_too_large: 'ไฟล์ใหญ่เกิน 10 MB',
  bad_file_type: 'รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)',
  empty_file: 'ไฟล์ว่างเปล่า (0 ไบต์) — เลือกไฟล์อีกครั้ง',
  not_found: 'ไม่พบไฟล์ในโฟลเดอร์เอกสารของทีม',
  unknown_action: 'สคริปต์ของทีมยังเป็นเวอร์ชันเก่า — อัปเดต Code.gs แล้ว Deploy เวอร์ชันใหม่ เพื่อเปิดใช้การแนบเอกสาร',
  drive_permission: 'หัวหน้าทีมยังไม่ได้อนุญาตให้สคริปต์ใช้ Google Drive — เปิด Apps Script กด Run ฟังก์ชัน setup แล้วกด Allow',
};
/**
 * User-facing message. `connect` = a one-shot connect / key change (nothing retries by itself, and
 * a network error usually means a deployment setting); `sync` = background sync of a working setup.
 */
export const errText = (e: unknown, ctx: 'connect' | 'sync' = 'sync') => {
  const name = (e as Error)?.name;
  const transient = name === 'TimeoutError' || name === 'AbortError' || (e instanceof TeamSyncError && e.code === 'busy');
  if (transient) return ctx === 'connect' ? 'ชีตไม่ตอบกลับตอนนี้ ลองกดอีกครั้งในอีกสักครู่' : 'ชีตไม่ตอบกลับ จะลองใหม่อัตโนมัติ';
  if (e instanceof TeamSyncError) return e.message;
  if (e instanceof TypeError) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
      return ctx === 'connect' ? 'ออฟไลน์ — ต่ออินเทอร์เน็ตแล้วกดอีกครั้ง' : 'ออฟไลน์ — จะส่งข้อมูลให้เองเมื่อกลับมาออนไลน์';
    // a cross-origin redirect to Google sign-in (access not "Anyone", or a /dev URL) surfaces as a network error
    return ctx === 'connect'
      ? 'เชื่อมต่อไม่ได้ — ตรวจว่าใช้ลิงก์ Web app ที่ลงท้ายด้วย /exec และตั้ง Who has access เป็น "Anyone (ทุกคน)" แล้ว'
      : 'เชื่อมต่อชีตไม่ได้ชั่วคราว จะลองใหม่อัตโนมัติ';
  }
  return String((e as Error)?.message || e);
};

/** Only Apps Script web-app URLs are accepted (blocks invite links that would send the team code
 *  elsewhere). A localhost dev server is allowed when the app itself runs on localhost. */
export function isTeamUrl(u: string) {
  if (/^https:\/\/script\.google\.com\/(?:a\/macros\/[^/\s]+|macros)\/s\/[\w-]+\/exec$/.test(u)) return true;
  const host = typeof location !== 'undefined' ? location.hostname : '';
  return /^(localhost|127\.0\.0\.1)$/.test(host) && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(u);
}
/** Short deployment id shown to users so they can check an invite with the team lead. */
export const deploymentId = (u: string) => (/\/s\/([\w-]+)\/exec$/.exec(u)?.[1] || u).slice(-10);

/** POST JSON as text/plain (no CORS preflight — required by Apps Script web apps); 45 s timeout. */
export const fetchTransport: Transport = async (url, body) => {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), 45000);
  let t: string;
  try {
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) throw new TeamSyncError(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${r.status})`);
    t = await r.text(); // the timeout also covers a body download that stalls
  } finally {
    clearTimeout(to);
  }
  try {
    return JSON.parse(t);
  } catch {
    // typically Google's sign-in page: the web app is not shared with "Anyone", or not deployed yet
    throw new TeamSyncError('ลิงก์ไม่ถูกต้อง หรือสคริปต์ยังไม่ได้ Deploy ให้ "ทุกคน (Anyone)" เข้าถึงได้');
  }
};

/** Call the server and unwrap {ok:false,error} into a TeamSyncError. */
export async function call<T extends Record<string, unknown>>(t: Transport, url: string, key: string, body: Record<string, unknown>): Promise<T> {
  const r = await t(url, { ...body, key });
  if (!r || r.ok !== true) {
    const code = String((r && r.error) || 'unknown');
    throw new TeamSyncError(ERR_TH[code] || 'ซิงก์ไม่สำเร็จ: ' + code, code);
  }
  return r as T;
}

// ------------------------------------------------------------------ records

/** Companies created from the TGO website sync (900000 ≤ id < CUSTOM_ID_MIN) get per-device ids, so
 *  their records must not be shared — the same id is a different company on another device.
 *  Customers added by hand get random ids ≥ CUSTOM_ID_MIN and are shared like registry companies. */
export const LOCAL_ID_MIN = 900000;
export const CUSTOM_ID_MIN = 1e12;
export const isLocalId = (id: number) => id >= LOCAL_ID_MIN && id < CUSTOM_ID_MIN;
export function isLocalOnly(k: string, v?: unknown) {
  const m = /^(stage|owner|watch|contact|log)\/(\d+)/.exec(k);
  if (m) return isLocalId(+m[2]);
  if (k.startsWith('task/') && v && typeof v === 'object') return isLocalId(Number((v as Task).gid));
  return false;
}

export const keyOf = {
  stage: (id: number | string) => `stage/${id}`,
  owner: (id: number | string) => `owner/${id}`,
  watch: (id: number | string) => `watch/${id}`,
  team: (name: string) => `team/${name}`,
  task: (id: string) => `task/${id}`,
  log: (cid: number | string, lid: string) => `log/${cid}/${lid}`,
  contact: (id: number | string) => `contact/${id}`,
  dedup: (key: string) => `dedup/${key}`,
  deal: (id: string) => `deal/${id}`,
  dstep: (id: string, stage: string) => `dstep/${id}/${stage}`,
  ddoc: (id: string, docId: string) => `ddoc/${id}/${docId}`,
  dlog: (id: string) => `dlog/${id}`,
  scfg: (name: keyof SalesCfg) => `scfg/${name}`,
  cust: (id: number) => `cust/${id}`,
};
const CFG_KEYS = ['sections', 'sources', 'services', 'stages'];

/** Stable id for log entries created before ids existed, so the same entry imported on two
 *  machines maps to the same record. */
export function legacyLogId(e: LogEntry) {
  const s = `${e.at}|${e.type}|${e.text || ''}|${e.result || ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'L' + (h >>> 0).toString(36) + (Date.parse(e.at) || 0).toString(36);
}

/**
 * Make task ids unique (an older uid() could repeat within one millisecond, e.g. bulk plans); every
 * task must be its own record. The last task with an id keeps it (that is the one that was shared);
 * earlier ones get an id derived from their company, so devices holding the same data agree.
 * Returns how many were renamed.
 */
export function uniqueTaskIds(tasks: Task[]) {
  const taken = new Set<string>();
  let renamed = 0;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    let id = t.id;
    for (let n = 1; taken.has(id); n++) id = `${t.id}.${t.gid}${n > 1 ? '.' + n : ''}`;
    if (id !== t.id) {
      t.id = id;
      renamed++;
    }
    taken.add(id);
  }
  return renamed;
}

export interface SharedState { crm: Crm; contacts: Record<string, ContactEdit>; dec: Record<string, string>; sales: SalesState; custom: Record<string, CustomCo> }

/** Every shared record currently held locally, keyed like the server. */
export function localRecords(s: SharedState): Map<string, unknown> {
  const m = new Map<string, unknown>();
  const C = s.crm;
  Object.entries(C.stages || {}).forEach(([id, v]) => v && v !== 'none' && m.set(keyOf.stage(id), v));
  Object.entries(C.owners || {}).forEach(([id, v]) => v && m.set(keyOf.owner(id), v));
  (C.watch || []).forEach((id) => m.set(keyOf.watch(id), 1));
  (C.team || []).forEach((n) => m.set(keyOf.team(n), 1));
  (C.tasks || []).forEach((t) => m.set(keyOf.task(t.id), { ...t }));
  Object.entries(C.log || {}).forEach(([cid, a]) => (a || []).forEach((e) => e.id && m.set(keyOf.log(cid, e.id), { ...e })));
  Object.entries(s.contacts || {}).forEach(([id, v]) => m.set(keyOf.contact(id), { ...v }));
  Object.entries(s.dec || {}).forEach(([k, v]) => m.set(keyOf.dedup(k), v));
  const S = s.sales;
  if (S) {
    Object.values(S.deals || {}).forEach((d) => m.set(keyOf.deal(d.id), { ...d }));
    Object.entries(S.steps || {}).forEach(([k, v]) => (v.d || v.n) && m.set('dstep/' + k, { ...v }));
    Object.entries(S.docs || {}).forEach(([k, v]) => m.set('ddoc/' + k, { ...v }));
    Object.entries(S.log || {}).forEach(([k, v]) => m.set(keyOf.dlog(k), { ...v }));
    // the lists too: customised before connecting, they are uploaded like every other record
    if (S.cfg) (CFG_KEYS as (keyof SalesCfg)[]).forEach((k) => Array.isArray(S.cfg[k]) && m.set(keyOf.scfg(k), S.cfg[k].slice()));
  }
  Object.values(s.custom || {}).forEach((c) => m.set(keyOf.cust(c.id), { ...c }));
  [...m].forEach(([k, v]) => isLocalOnly(k, v) && m.delete(k));
  return m;
}

export interface ApplyEffects { crm: boolean; contacts: Set<number>; contactDel: boolean; dedup: boolean; watch: Set<number>; sales: boolean; custom: boolean }
export const noEffects = (): ApplyEffects => ({ crm: false, contacts: new Set(), contactDel: false, dedup: false, watch: new Set(), sales: false, custom: false });

/** Apply one server row to local state (mutates `s`); records what needs recomputing in `fx`. */
export function applyRow(s: SharedState, row: SyncRow, fx: ApplyEffects) {
  const i = row.k.indexOf('/');
  if (i < 0 || isLocalOnly(row.k, row.v)) return;
  const type = row.k.slice(0, i), rest = row.k.slice(i + 1);
  const C = s.crm, del = row.del || row.v == null;
  switch (type) {
    case 'stage':
      if (del) delete C.stages[rest];
      else C.stages[rest] = row.v as StageKey;
      fx.crm = true;
      break;
    case 'owner':
      if (del) delete C.owners[rest];
      else C.owners[rest] = String(row.v);
      fx.crm = true;
      break;
    case 'watch': {
      const id = +rest;
      if (!isFinite(id)) return;
      const has = C.watch.includes(id);
      if (del && has) C.watch = C.watch.filter((x) => x !== id);
      else if (!del && !has) C.watch.push(id);
      fx.watch.add(id);
      fx.crm = true;
      break;
    }
    case 'team': {
      const has = C.team.includes(rest);
      if (del && has) C.team = C.team.filter((x) => x !== rest);
      else if (!del && !has) C.team.push(rest);
      fx.crm = true;
      break;
    }
    case 'task': {
      const ix = C.tasks.findIndex((t) => t.id === rest);
      if (del) {
        if (ix >= 0) C.tasks.splice(ix, 1);
      } else {
        const t = { ...(row.v as Task), id: rest };
        if (ix >= 0) Object.assign(C.tasks[ix], t);
        else C.tasks.push(t);
      }
      fx.crm = true;
      break;
    }
    case 'log': {
      const j = rest.indexOf('/');
      if (j < 0) return;
      const cid = rest.slice(0, j), lid = rest.slice(j + 1);
      const L = C.log[cid] || (C.log[cid] = []);
      const ix = L.findIndex((e) => e.id === lid);
      if (del) {
        if (ix >= 0) L.splice(ix, 1);
      } else {
        const e = { ...(row.v as LogEntry), id: lid };
        if (ix >= 0) L[ix] = e;
        else L.push(e);
      }
      fx.crm = true;
      break;
    }
    case 'contact':
      if (del) {
        if (rest in s.contacts) {
          delete s.contacts[rest];
          fx.contactDel = true;
        }
      } else {
        s.contacts[rest] = row.v as ContactEdit;
        fx.contacts.add(+rest);
      }
      break;
    case 'dedup':
      if (del) {
        if (rest in s.dec) {
          delete s.dec[rest];
          fx.dedup = true;
        }
      } else if (s.dec[rest] !== row.v) {
        s.dec[rest] = String(row.v);
        fx.dedup = true;
      }
      break;
    case 'deal':
    case 'dstep':
    case 'ddoc':
    case 'dlog': {
      const S = s.sales;
      const bag = (type === 'deal' ? S.deals : type === 'dstep' ? S.steps : type === 'ddoc' ? S.docs : S.log) as Record<string, unknown>;
      if (type !== 'deal' && type !== 'dlog' && rest.indexOf('/') < 0) return;
      if (del && type === 'deal') (S.gone || (S.gone = {}))[rest] = row.at || new Date().toISOString();
      if (del) delete bag[rest];
      else if (row.v && typeof row.v === 'object') {
        const v = row.v as Record<string, unknown>;
        bag[rest] = type === 'deal' ? { ...(v as unknown as Deal), id: rest } : type === 'dlog' ? { ...(v as unknown as DealLog), id: rest } : type === 'ddoc' ? (v as unknown as DealDoc) : (v as unknown as DealStep);
      } else return;
      fx.sales = true;
      break;
    }
    case 'scfg':
      if (!CFG_KEYS.includes(rest) || del || !Array.isArray(row.v)) return;
      s.sales.cfg[rest as keyof SalesCfg] = (row.v as unknown[]).map(String);
      fx.sales = true;
      break;
    case 'cust':
      if (del) {
        if (!(rest in s.custom)) return;
        delete s.custom[rest];
      } else if (row.v && typeof row.v === 'object') s.custom[rest] = { ...(row.v as CustomCo), id: +rest };
      else return;
      fx.custom = true;
      break;
  }
}

/** Records whose value is an object of fields that people edit separately. */
const MERGED = /^(deal|ddoc|cust)\//;
/**
 * A pulled row for a record this browser still has a queued change for. Without this, the queued
 * value (a copy taken before the pull) would be pushed and undo whatever the teammate changed.
 * - the queued change names its fields (`f`): the teammate's record with just those fields of ours
 *   on top — last writer wins per field, not per record;
 * - the teammate deleted the record: the deletion wins over an edit (`drop` the queued change);
 * - a whole-value write (a new record, a deletion here) or another kind of record: ours stands (null).
 */
export function rebaseOp(row: SyncRow, o: SyncOp): { drop: true } | { v: unknown } | null {
  // a list: the teammate's list with this browser's additions and removals applied (a rename keeps
  // the item's place)
  if (o.k.startsWith('scfg/') && o.lst && Array.isArray(row.v)) return { v: applyListEdit(row.v.map(String), o.lst) };
  if (!MERGED.test(o.k) || o.del || !o.f || !o.v || typeof o.v !== 'object') return null;
  if (row.del || row.v == null) return { drop: true };
  if (typeof row.v !== 'object') return null;
  const mine = o.v as Record<string, unknown>;
  const v: Record<string, unknown> = { ...(row.v as Record<string, unknown>) };
  o.f.forEach((f) => (f in mine ? (v[f] = mine[f]) : delete v[f]));
  return { v };
}

/** Fields of a queued change that replaces `prev` (same record, not sent yet): both sets, or the
 *  whole value when either one is a whole-value write. */
export function mergeFields(prev: SyncOp | undefined, f: string[] | undefined): string[] | undefined {
  if (!f) return undefined;
  if (!prev) return f;
  if (prev.del || !prev.f) return undefined;
  return [...new Set([...prev.f, ...f])];
}

export function applyListEdit(list: string[], e: ListEdit): string[] {
  const out = list.slice();
  const add = e.add.filter((x) => !out.includes(x));
  e.rm.forEach((x) => {
    const i = out.indexOf(x);
    if (i < 0) return;
    if (add.length && e.rm.length === e.add.length) out[i] = add.shift()!; // renamed: same place
    else out.splice(i, 1);
  });
  return [...out, ...add.filter((x) => !out.includes(x))];
}

/** Two queued list changes in a row (the second replaces the first in the queue) as one. */
export function mergeListEdits(prev: SyncOp | undefined, e: ListEdit): ListEdit | undefined {
  if (!prev) return e;
  if (!prev.lst) return undefined; // the earlier one replaced the whole list: so does this one
  const add = prev.lst.add.filter((x) => !e.rm.includes(x)).concat(e.add.filter((x) => !prev.lst!.rm.includes(x)));
  const rm = prev.lst.rm.filter((x) => !e.add.includes(x)).concat(e.rm.filter((x) => !prev.lst!.add.includes(x)));
  return { add: [...new Set(add)], rm: [...new Set(rm)] };
}
