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

export interface SyncOp { k: string; v?: unknown; del?: boolean; by?: string }
export interface SyncRow { seq: number; k: string; v: unknown; del: boolean; by: string; at: string }
export interface TeamCfg { url: string; key: string; seq: number }
export type TeamStatus = 'off' | 'connecting' | 'syncing' | 'ok' | 'error' | 'offline';
export interface TeamState { status: TeamStatus; msg: string; last: string }

export type Transport = (url: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;

export class TeamSyncError extends Error {}

const ERR_TH: Record<string, string> = {
  unauthorized: 'รหัสทีมไม่ถูกต้อง',
  no_team_key: 'ยังไม่ได้ตั้งรหัสทีมในสคริปต์ (TEAM_KEY อย่างน้อย 6 ตัวอักษร)',
  busy: 'ชีตกำลังบันทึกข้อมูลของคนอื่นอยู่ จะลองใหม่อัตโนมัติ',
  too_many_ops: 'ส่งข้อมูลครั้งละมากเกินไป',
};
export const errText = (e: unknown) =>
  e instanceof TeamSyncError ? e.message
  : e instanceof TypeError ? 'เชื่อมต่อไม่ได้ (ออฟไลน์ หรือลิงก์ไม่ถูกต้อง)'
  : String((e as Error)?.message || e);

/** POST JSON as text/plain (no CORS preflight — required by Apps Script web apps). */
export const fetchTransport: Transport = async (url, body) => {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
  if (!r.ok) throw new TeamSyncError(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${r.status})`);
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    // typically Google's sign-in page: the web app is not shared with "Anyone"
    throw new TeamSyncError('ลิงก์ไม่ถูกต้อง หรือสคริปต์ยังไม่ได้ตั้งให้ "ทุกคน (Anyone)" เข้าถึงได้');
  }
};

/** Call the server and unwrap {ok:false,error} into a TeamSyncError. */
export async function call<T extends Record<string, unknown>>(t: Transport, url: string, key: string, body: Record<string, unknown>): Promise<T> {
  const r = await t(url, { ...body, key });
  if (!r || r.ok !== true) {
    const code = String((r && r.error) || 'unknown');
    throw new TeamSyncError(ERR_TH[code] || 'ซิงก์ไม่สำเร็จ: ' + code);
  }
  return r as T;
}

// ------------------------------------------------------------------ records

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
  return m;
}

export interface ApplyEffects { crm: boolean; contacts: Set<number>; contactDel: boolean; dedup: boolean; watch: Set<number> }
export const noEffects = (): ApplyEffects => ({ crm: false, contacts: new Set(), contactDel: false, dedup: false, watch: new Set() });

/** Apply one server row to local state (mutates `s`); records what needs recomputing in `fx`. */
export function applyRow(s: SharedState, row: SyncRow, fx: ApplyEffects) {
  const i = row.k.indexOf('/');
  if (i < 0) return;
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
