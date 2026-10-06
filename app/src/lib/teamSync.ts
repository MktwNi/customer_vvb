/**
 * Team sync — shares CRM data (stars, sales stage, owners, tasks, contact log, contact edits,
 * team list, dedup decisions) between browsers through a Google Apps Script web app backed by
 * a Google Sheet (see team-sync/Code.gs and team-sync/README.md).
 *
 * Every piece of shared state is a record with a string key; a change is an op {k, v} or a
 * tombstone {k, del:true}. The server keeps an append-only log ordered by `seq` — the last op
 * that reaches the server for a key wins. Clients pull rows with seq > cursor and push queued ops.
 */
import type { ContactEdit, Crm, LogEntry, StageKey, Task } from './types';

/** `id` identifies this queued change locally (for acknowledging it across tabs), `t` (ms) orders
 *  changes to the same record, and `sent` is the sheet's seq when it was last pushed; the server
 *  ignores all three. */
export interface SyncOp { id?: string; t?: number; sent?: number; k: string; v?: unknown; del?: boolean; by?: string }
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

/** Companies created from the TGO website sync (id ≥ 900000) get per-device ids, so their records
 *  must not be shared — the same id is a different company on another device. */
export const LOCAL_ID_MIN = 900000;
export function isLocalOnly(k: string, v?: unknown) {
  const m = /^(stage|owner|watch|contact|log)\/(\d+)/.exec(k);
  if (m) return +m[2] >= LOCAL_ID_MIN;
  if (k.startsWith('task/') && v && typeof v === 'object') return Number((v as Task).gid) >= LOCAL_ID_MIN;
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
};

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

export interface SharedState { crm: Crm; contacts: Record<string, ContactEdit>; dec: Record<string, string> }

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
  [...m].forEach(([k, v]) => isLocalOnly(k, v) && m.delete(k));
  return m;
}

export interface ApplyEffects { crm: boolean; contacts: Set<number>; contactDel: boolean; dedup: boolean; watch: Set<number> }
export const noEffects = (): ApplyEffects => ({ crm: false, contacts: new Set(), contactDel: false, dedup: false, watch: new Set() });

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
  }
}
