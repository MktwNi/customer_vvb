/**
 * Capabilities in the engine (package roles): against the team script deployed today (team-sync/Code.gs
 * in the simulator: no me.caps, so every account works by the built-in caps of its role), and against a
 * script with configurable roles, played here by a thin layer over the same simulator that adds what
 * Code.gs v4 sends (me.caps / rid / rn / rq / req, the users reply's roles) and answers the request
 * actions. What the layer adds is the shared contract (plan.md §1, roles impl-note §2).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN, capsWire, type CapSet } from './caps';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/r/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));

const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 120);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What a script with configurable roles adds for each username (absent: today's script). */
interface V4 { caps?: CapSet; rid?: string; rn?: string; rq?: number; req?: unknown; roles?: Record<string, unknown>; grants?: unknown }
let v4: Record<string, V4> | null = null;
/** Bodies every engine sent, and the reply layer's own actions. */
const sent: Record<string, unknown>[] = [];
interface Tab { e: GccEngine; store: ReturnType<typeof memoryStore>; browser: string }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  v4 = null;
  sent.length = 0;
});

/** The account a token belongs to (the simulator's own reply says it). */
const whoOf = (r: Record<string, unknown>) => (r.me as { u?: string } | undefined)?.u || '';
function layer(body: Record<string, unknown>): Record<string, unknown> {
  sent.push(body);
  const own = ['req_send', 'req_cancel', 'req_ack', 'role_save', 'role_del', 'grant_save', 'grant_del', 'req_decide'];
  if (v4 && own.includes(String(body.action))) {
    // who sent it: ask the simulator with a harmless action
    const me = sim.post({ ...body, action: 'me' });
    const u = whoOf(me);
    const x = v4[u] || (v4[u] = {});
    if (body.action === 'req_send') x.req = { st: 'p', id: 'q1', k: body.k, role: body.role, caps: body.caps, note: body.note, until: body.until, at: new Date().toISOString() };
    if (body.action === 'req_cancel' || body.action === 'req_ack') x.req = null;
    return { ok: true, me: { ...(me.me as object), ...x, caps: x.caps && capsWire(x.caps) } };
  }
  const r = sim.post(body) as Record<string, unknown>;
  if (!v4) return r;
  const u = whoOf(r);
  if (u && v4[u]) {
    const x = v4[u];
    r.me = { ...(r.me as object), ...(x.caps ? { caps: capsWire(x.caps) } : {}), ...(x.rid ? { rid: x.rid } : {}), ...(x.rn ? { rn: x.rn } : {}), ...(x.rq != null ? { rq: x.rq } : {}), ...('req' in x ? { req: x.req } : {}), ...('grants' in x ? { grants: x.grants } : {}) };
  }
  if ((body.action === 'users' || body.action === 'me') && u && v4[u]?.roles) r.roles = v4[u].roles;
  return r;
}

function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-15';
  raw.store = memoryStore();
  raw.rebuild();
  raw.loading = false;
  raw.transport = async (_u, body) => layer(body);
  raw.fileTransport = async (_u, body) => layer(body);
  const e = new Proxy(raw, {
    get(t, p) {
      cur = browser;
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? (...a: unknown[]) => ((cur = browser), (v as (...x: unknown[]) => unknown).apply(t, a)) : v;
    },
  });
  const tab = { e, store: raw.store, browser };
  tabs.push(tab);
  return tab;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...ts: Tab[]) {
  for (let i = 0; i < 3; i++)
    for (const t of ts) {
      await t.e.teamSyncNow();
      await tick();
    }
}
async function lead() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const L = mk('L');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
  return L;
}
async function member(L: Tab, u: string, name: string, role: Role) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(u);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  await settle(M);
  return M;
}
const pulls = () => sent.filter((b) => b.action === 'pull').map((b) => Number(b.since));

describe('against the team script deployed today (no me.caps)', () => {
  it('each account works by its role\'s built-in capabilities; cv 4 is accepted; roles and requests are not there yet', async () => {
    const L = await lead();
    expect(L.e.myCaps()).toEqual(BUILTIN.admin.c);
    expect(L.e.rolesLive).toBe(false);
    expect(L.e.roleName()).toBe('ผู้ดูแลระบบ');
    const S = await member(L, 'aek', 'เอก', 'sales');
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    expect(S.e.myCaps()).toEqual(BUILTIN.sales.c);
    expect(S.e.can('view.comm')).toBe(false);
    expect(S.e.can('del.rec')).toBe(false);
    expect(S.e.can('del.log', 'เอก')).toBe(true);
    expect(S.e.can('del.log', 'หมิว')).toBe(false);
    expect(V.e.canWrite()).toBe(false);
    expect(V.e.can('view.money')).toBe(true);
    expect(sent.every((b) => b.cv === 4)).toBe(true);
    // a sales account's edits go through as before
    const d = S.e.addDeal({ client: 'บริษัท ทดสอบสิทธิ์ จำกัด' });
    await settle(S);
    expect(S.e.teamPendingN).toBe(0);
    expect(sim.post({ action: 'pull', since: 0, cv: 4, tok: L.e.session!.tok }).rows!.some((r) => r.k === 'deal/' + d.id)).toBe(true);
    // the admin page: the accounts, with the built-in roles standing in (read-only)
    const dir = await L.e.adminDir();
    expect(dir.v4).toBe(false);
    expect(dir.roles.map((r) => r.id)).toEqual(['admin', 'sales', 'viewer']);
    expect(dir.users.map((u) => u.u).sort()).toEqual(['aek', 'lead', 'pla']);
    // a role action the script doesn't know says which update it needs
    await expect(L.e.roleSave({ n: 'หัวหน้าฝ่ายขาย', d: '', c: {} })).rejects.toThrow(/อัปเดต Code\.gs/);
    // the request dialog's roles: the built-in three
    expect((await S.e.teamRoles()).map((r) => r.id)).toEqual(['admin', 'sales', 'viewer']);
  });

  it('a viewer sends nothing; an admin changing someone to viewer is said to them in the role\'s name', async () => {
    const L = await lead();
    const S = await member(L, 'makorn', 'มกร', 'sales');
    await L.e.adminUpdate('makorn', { role: 'viewer' });
    await settle(S);
    expect(S.e.canWrite()).toBe(false);
    expect(S.e.teamNote).toBe('ผู้ดูแลระบบเปลี่ยนบัญชีของคุณเป็น ดูอย่างเดียว — แก้ไขข้อมูลไม่ได้แล้ว');
  });
});

describe('against a script with configurable roles (me.caps)', () => {
  it('takes the role, its name and capabilities from me; an own-scope account edits only its own deals', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    v4 = { aek: { caps: { ...BUILTIN.sales.c, 'edit.deal': 'own', 'edit.pay': 'own' }, rid: 'sales', rn: 'พนักงานขาย' } };
    await settle(S);
    expect(S.e.rolesLive).toBe(true);
    expect(S.e.myCaps()!['edit.deal']).toBe('own');
    const mine = S.e.addDeal({ client: 'บริษัท ของเอก จำกัด', resp: 'หมิว' });
    expect(mine.resp).toBe('เอก'); // an own-scope account adds deals of its own
    const other = L.e.addDeal({ client: 'บริษัท ของหมิว จำกัด', resp: 'หมิว' });
    await settle(L, S);
    expect(S.e.canDeal('edit.deal', S.e.sales.deals[mine.id])).toBe(true);
    expect(S.e.canDeal('edit.deal', S.e.sales.deals[other.id])).toBe(false);
    // another person's deal: nothing changes here, and it is said why
    S.e.addAct(other.id, { type: 'call', note: 'โทรแทน' });
    expect(S.e.teamNote).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
    expect(S.e.canWriteKey('dstep/' + other.id + '/CALL1', false)).toBe(false);
    expect(S.e.canWriteKey('dstep/' + mine.id + '/CALL1', false)).toBe(true);
  });

  it('a role that may record money but not edit deals: the receipt is saved, the automatic stage note is not', async () => {
    const L = await lead();
    const A = await member(L, 'fon', 'ฝน', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท รับเงิน จำกัด' });
    L.e.setPlan(d.id, [{ stage: 'PAY1', amt: 1000, pct: null, due: '2026-10-20', rel: null, how: 'transfer', howT: '', note: '' }]);
    await settle(L, A);
    v4 = { fon: { caps: { 'view.sales': 'all', 'view.money': 'all', 'view.cash': 'all', 'edit.pay': 'all', 'docs.up': 'all', 'pay.check': 'all' }, rid: 'acct', rn: 'บัญชี/การเงิน' } };
    await settle(A);
    expect(A.e.roleName()).toBe('บัญชี/การเงิน');
    A.e.markPaid(d.id, 'PAY1', { date: '2026-10-15', amount: 1000 });
    expect(A.e.sales.pays[`${d.id}/PAY1`]).toMatchObject({ rcv: '2026-10-15', got: 1000 });
    expect(A.e.sales.steps[`${d.id}/PAY1`]).toBeUndefined();
    await settle(A);
    expect(A.e.teamPendingN).toBe(0);
    // what the role change said, not a refused stage note
    expect(A.e.teamNote).toBe('ผู้ดูแลระบบเปลี่ยนบทบาทของคุณเป็น บัญชี/การเงิน');
  });

  it('gaining or losing a capability the script redacts pulls everything again; losing documents drops their copies here', async () => {
    const L = await lead();
    const S = await member(L, 'makorn', 'มกร', 'sales');
    v4 = { makorn: { caps: { ...BUILTIN.sales.c }, rid: 'sales' } };
    await settle(S);
    const blob = 'docblob:d1';
    await S.store.set(blob, { name: 'a.pdf', mime: 'application/pdf', data: new ArrayBuffer(4) });
    S.e.sales.docs['x/d1'] = { id: 'd1', deal: 'x', kind: 'quotation', name: 'a.pdf', mime: 'application/pdf', size: 4, fileId: 'F1' } as never;
    sent.length = 0;
    await settle(S);
    expect(pulls().some((s) => s === 0)).toBe(false); // nothing changed: from where it was
    // the admin takes ดูยอดเงิน away (everything that needs it goes with it)
    v4.makorn.caps = { 'view.sales': 'all', 'view.plan': 'all', 'edit.cust': 'all', 'edit.task': 'all' };
    sent.length = 0;
    await settle(S);
    expect(pulls()).toContain(0);
    expect(S.e.can('view.money')).toBe(false);
    expect(S.e.teamNote).toBe('สิทธิ์ของคุณเปลี่ยนแล้ว · ดูได้ที่ สิทธิ์ของฉัน ในเมนูบัญชี');
    expect(await S.store.get(blob)).toBeFalsy();
    // given back: everything again too
    v4.makorn.caps = { ...BUILTIN.sales.c };
    sent.length = 0;
    await settle(S);
    expect(pulls()).toContain(0);
  });

  it('a temporary role that runs out is said as such, not as an admin\'s change', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    v4 = { aek: { caps: { ...BUILTIN.sales.c, 'view.comm': 'all' }, rid: 'head', rn: 'หัวหน้าฝ่ายขาย', grants: { r: { id: 'head', until: '2026-10-20', by: 'lead', at: '2026-10-01' } } } };
    await settle(S);
    expect(S.e.session!.g?.r?.until).toBe('2026-10-20');
    vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
    v4.aek = { caps: { ...BUILTIN.sales.c }, rid: 'sales', rn: 'พนักงานขาย', grants: {} };
    await settle(S);
    expect(S.e.teamNote).toBe('บทบาทชั่วคราวหมดอายุแล้ว ตอนนี้คุณเป็น พนักงานขาย');
    vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));
  });

  it('requests: send, the pending state, cancel; the decision until it is read', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    v4 = { aek: { caps: { ...BUILTIN.sales.c }, rid: 'sales', rn: 'พนักงานขาย', roles: { head: { n: 'หัวหน้าฝ่ายขาย', c: { ...capsWire(BUILTIN.sales.c), 'view.comm': 1, 'qt.check': 1 }, o: 3 } } }, lead: { caps: { ...BUILTIN.admin.c }, rq: 0 } };
    await settle(S);
    const roles = await S.e.teamRoles();
    expect(roles.map((r) => r.id)).toEqual(['admin', 'sales', 'viewer', 'head']);
    expect(S.e.roleNameOf('head')).toBe('หัวหน้าฝ่ายขาย');
    await S.e.reqSend({ k: 'role', role: 'head', note: 'ดูแลทีมแทนช่วงลา', until: '2027-01-31' });
    expect(S.e.session!.req).toMatchObject({ st: 'p', k: 'role', role: 'head', until: '2027-01-31' });
    const body = sent.find((b) => b.action === 'req_send')!;
    expect(body).toMatchObject({ action: 'req_send', k: 'role', role: 'head', note: 'ดูแลทีมแทนช่วงลา', until: '2027-01-31', cv: 4 });
    await S.e.reqCancel();
    expect(S.e.session!.req).toBeNull();
    // an admin decided: the result comes with the next reply, and stays until read
    v4.aek.req = { ok: true, by: 'หมิว', note: 'ตามที่ขอ', at: '2026-10-15T04:00:00Z', role: 'head', until: '2027-01-31' };
    v4.aek.rid = 'head';
    v4.aek.rn = 'หัวหน้าฝ่ายขาย';
    v4.aek.caps = { ...BUILTIN.sales.c, 'view.comm': 'all', 'qt.check': 'all' };
    await settle(S);
    expect(S.e.session!.req).toMatchObject({ st: 'r', ok: true, by: 'หมิว', role: 'head' });
    expect(S.e.roleName()).toBe('หัวหน้าฝ่ายขาย');
    expect(S.e.teamNote).toBe(''); // the banner says it, not a team note
    await S.e.reqAck();
    expect(S.e.session!.req).toBeNull();
    // the admin's badge count
    v4.lead.rq = 2;
    await settle(L);
    expect(L.e.session!.rq).toBe(2);
  });
});
