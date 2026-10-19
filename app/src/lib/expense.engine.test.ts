/**
 * Job expenses in the engine, end to end with the real team script in the simulator (team-sync/Code.gs): the
 * records reach the browsers of the accounts that may see them and are kept in shared state (lib/expense.ts),
 * an expense's month check apart from the income checks; an account that loses ดูค่าใช้จ่าย drops them at once
 * and pulls again; the role editor names the two capabilities (0 when off); deleting a deal takes its expenses.
 * Against the script deployed before capabilities (Code.v3.gs) no account gets them: lib/roles.engine.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN, CAPS, LATE_CAPS, type CapSet } from './caps';
import { expensesOf } from './expense';
import { cashLines } from './sales';
import { chkRows } from './payCheck';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/x/exec';
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

const T0 = new Date('2026-10-19T03:00:00Z');
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 60);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sent: Record<string, unknown>[] = [];
interface Tab { e: GccEngine; browser: string }
const tabs: Tab[] = [];
/** While set, every pull reply reaches the browsers without its job-expense rows (none of their deletions either). */
let dropExpRows = false;
const EXP_ROW = /^(?:dexp\/|dlog\/exp\.|dchk\/[^/]+\/exp\.|mclose\/[^/]+\/)/;
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  sent.length = 0;
  dropExpRows = false;
  vi.setSystemTime(T0);
});

function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-19';
  raw.store = memoryStore();
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => {
    sent.push(body);
    const r = sim.post(body) as Record<string, unknown>;
    if (dropExpRows && body.action === 'pull' && Array.isArray(r.rows)) r.rows = (r.rows as { k: string }[]).filter((x) => !EXP_ROW.test(x.k));
    return r;
  };
  raw.transport = post;
  raw.fileTransport = post;
  const e = new Proxy(raw, {
    get(t, p) {
      cur = browser;
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? (...a: unknown[]) => ((cur = browser), (v as (...x: unknown[]) => unknown).apply(t, a)) : v;
    },
  });
  const tab = { e, browser };
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
async function lead(code?: string) {
  sim = createGasSim({ teamKey: '', kdfIter: 1000, code });
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
/** The admin writes records straight to the script (the expense screens come in the next step). */
const put = (L: Tab, ops: { k: string; v?: unknown; del?: boolean }[]) => {
  const r = sim.post({ action: 'push', cv: 4, tok: L.e.session!.tok, ops });
  expect(r).toMatchObject({ ok: true, denied: [] });
};
const pulls = () => sent.filter((b) => b.action === 'pull');
const exp = (o: Record<string, unknown> = {}) => ({ c: 'ค่าเดินทาง', amt: 3500, d: '2026-10-05', by: 'หมิว', at: '2026-10-19T03:00:00.000Z', ...o });
const SALES = BUILTIN.sales.c;

describe('job expenses in the engine (Code.gs v4 with expenses)', () => {
  it('reach the accounts that see them, in shared state; an expense\'s check never reads as an income check', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    const d = L.e.addDeal({ client: 'บริษัท ค่าใช้จ่าย จำกัด', resp: 'เอก', forecast: 100000 });
    const o = L.e.addDeal({ client: 'บริษัท อื่น จำกัด', resp: 'หมิว' });
    await settle(L);
    put(L, [
      { k: `dexp/${d.id}/e1`, v: exp({ c: 'ผู้รับเหมา', amt: 35000, paid: '2026-10-06' }) },
      { k: `dexp/${d.id}/e2`, v: exp({ d: '2026-10-01', amt: 1200 }) },
      { k: `dexp/${o.id}/e3`, v: exp() },
      { k: 'dlog/exp.h1', v: { action: 'บันทึกค่าใช้จ่าย', detail: 'ผู้รับเหมา', deal: d.id, client: d.client, by: 'หมิว', at: '2026-10-19T03:00:00.000Z' } },
      { k: `dchk/${d.id}/exp.e1`, v: { s: 'ok', amt: 35000, d: '2026-10-06', f: '' } },
      { k: 'mclose/2026-10/out', v: { n: 1, amt: 35000 } },
    ]);
    sent.length = 0;
    await settle(S, V);
    // every pull says this build knows job expenses
    expect(pulls().length).toBeGreaterThan(0);
    expect(pulls().every((b) => b.xp === 1)).toBe(true);
    expect(S.e.can('view.exp')).toBe(true);
    expect(expensesOf(S.e.sales, d.id).map((x) => [x.id, x.amt, x.c])).toEqual([['e2', 1200, 'ค่าเดินทาง'], ['e1', 35000, 'ผู้รับเหมา']]);
    expect(expensesOf(S.e.sales, o.id).map((x) => x.id)).toEqual(['e3']);
    expect(S.e.sales.xchk).toEqual({ [`${d.id}/e1`]: expect.objectContaining({ s: 'ok', amt: 35000 }) });
    expect(S.e.sales.mcloseOut).toEqual({ '2026-10': expect.objectContaining({ n: 1, amt: 35000 }) });
    expect(S.e.sales.log['exp.h1']).toMatchObject({ action: 'บันทึกค่าใช้จ่าย' });
    // the income month check knows nothing of them: no check, and so no cancelled line
    expect(Object.keys(S.e.sales.pchk || {})).toEqual([]);
    expect(Object.keys(S.e.sales.mclose || {})).toEqual([]);
    expect(chkRows(S.e.sales, cashLines(S.e.sales, Object.values(S.e.sales.deals), '2026-10-19'), S.e.sales.pchk || {}, '2026-01-01').filter((r) => r.kind === 'orphan')).toEqual([]);
    // recording: the account's own deals only (as the script decides)
    expect(S.e.canWriteKey(`dexp/${d.id}/e9`, false)).toBe(true);
    expect(S.e.canWriteKey(`dexp/${o.id}/e9`, false)).toBe(false);
    expect(S.e.can('edit.exp', 'เอก')).toBe(true);
    // the viewer: none of it reached the browser
    expect(V.e.can('view.exp')).toBe(false);
    expect([V.e.sales.exp || {}, V.e.sales.xchk || {}, V.e.sales.mcloseOut || {}]).toEqual([{}, {}, {}]);
    expect(V.e.sales.log['exp.h1']).toBeUndefined();
    expect(JSON.stringify(sent.filter((b) => b.action === 'pull'))).not.toContain('ผู้รับเหมา');
  });

  it('losing ดูค่าใช้จ่าย drops them here at once and pulls everything again; given back, they return', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ค่าใช้จ่าย จำกัด', resp: 'เอก' });
    await settle(L);
    put(L, [{ k: `dexp/${d.id}/e1`, v: exp() }, { k: 'dlog/exp.h1', v: { action: 'บันทึกค่าใช้จ่าย', deal: d.id, by: 'หมิว', at: 'a' } }, { k: `dchk/${d.id}/exp.e1`, v: { s: 'ok', amt: 3500, d: '2026-10-06', f: '' } }]);
    await settle(S);
    expect(expensesOf(S.e.sales, d.id)).toHaveLength(1);
    // the role editor names both capabilities: off is 0 (the script keeps them for a save that leaves them out)
    const { 'view.exp': _v, 'edit.exp': _e, ...noExp } = SALES;
    sent.length = 0;
    await L.e.roleSave({ id: 'sales', n: 'พนักงานขาย', d: '', c: noExp as CapSet });
    expect(sent.find((b) => b.action === 'role_save')).toMatchObject({ c: { 'view.exp': 0, 'edit.exp': 0, 'view.money': 1 } });
    sent.length = 0;
    await settle(S);
    expect(S.e.can('view.exp')).toBe(false);
    expect(pulls().map((b) => Number(b.since))).toContain(0);
    expect([S.e.sales.exp || {}, S.e.sales.xchk || {}, S.e.sales.log['exp.h1']]).toEqual([{}, {}, undefined]);
    // given back: everything again
    await L.e.roleSave({ id: 'sales', n: 'พนักงานขาย', d: '', c: SALES });
    await settle(S);
    expect(S.e.can('view.exp')).toBe(true);
    expect(expensesOf(S.e.sales, d.id).map((x) => x.id)).toEqual(['e1']);
    expect(S.e.sales.xchk).toHaveProperty(`${d.id}/e1`);
  });

  it('losing ดูค่าใช้จ่าย empties them here at once, not only through the deletions the next pull brings', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ค่าใช้จ่าย จำกัด', resp: 'เอก' });
    await settle(L);
    put(L, [
      { k: `dexp/${d.id}/e1`, v: exp() },
      { k: 'dlog/exp.h1', v: { action: 'บันทึกค่าใช้จ่าย', deal: d.id, by: 'หมิว', at: 'a' } },
      { k: `dchk/${d.id}/exp.e1`, v: { s: 'ok', amt: 3500, d: '2026-10-06', f: '' } },
      { k: 'mclose/2026-10/out', v: { n: 1, amt: 3500 } },
    ]);
    await settle(S);
    expect([Object.keys(S.e.sales.exp || {}), Object.keys(S.e.sales.xchk || {}), Object.keys(S.e.sales.mcloseOut || {}), !!S.e.sales.log['exp.h1']]).toEqual([[`${d.id}/e1`], [`${d.id}/e1`], ['2026-10'], true]);
    // from here the script's rows about expenses never reach this browser: only the purge can drop them
    dropExpRows = true;
    const { 'view.exp': _v, 'edit.exp': _e, ...noExp } = SALES;
    await L.e.roleSave({ id: 'sales', n: 'พนักงานขาย', d: '', c: noExp as CapSet });
    await settle(S);
    expect(S.e.can('view.exp')).toBe(false);
    expect([S.e.sales.exp, S.e.sales.xchk, S.e.sales.mcloseOut, S.e.sales.log['exp.h1']]).toEqual([undefined, undefined, undefined, undefined]);
    expect(expensesOf(S.e.sales, d.id)).toEqual([]);
  });

  it('deleting a deal: its expenses go here and on the sheet (also for an admin who queued them), their checks stay', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ลบ จำกัด', resp: 'เอก' });
    await settle(L);
    put(L, [{ k: `dexp/${d.id}/e1`, v: exp() }, { k: `dchk/${d.id}/exp.e1`, v: { s: 'ok', amt: 3500, d: '2026-10-06', f: '' } }]);
    await settle(L, S);
    expect(expensesOf(L.e.sales, d.id)).toHaveLength(1);
    L.e.deleteDeal(d.id);
    expect(expensesOf(L.e.sales, d.id)).toEqual([]);
    await settle(L, S);
    expect(expensesOf(S.e.sales, d.id)).toEqual([]);
    const rows = sim.post({ action: 'pull', since: 0, cv: 4, xp: 1, tok: L.e.session!.tok }).rows!;
    expect(rows.filter((r) => r.k === `dexp/${d.id}/e1`).at(-1)).toMatchObject({ del: true });
    // one deletion row for it: the web app's own, the script adds none on top
    expect(rows.filter((r) => r.k === `dexp/${d.id}/e1` && r.del)).toHaveLength(1);
    expect(S.e.sales.xchk).toHaveProperty(`${d.id}/e1`);
  });
});

describe('a team script with configurable roles from before job expenses (v4, no view.exp / edit.exp)', () => {
  const CODE = readFileSync(join(ROOT, 'team-sync', 'Code.gs'), 'utf8');
  const BEFORE = CODE.replace(/^\s*\{ id: '(?:view|edit)\.exp'.*\n/gm, '');

  it('the role editor, extras, requests and สิทธิ์ของฉัน leave the two out (that script refuses them); everything else is offered and saves', async () => {
    expect(BEFORE).not.toBe(CODE);
    const L = await lead(BEFORE);
    const S = await member(L, 'aek', 'เอก', 'sales');
    const ids = (e: GccEngine) => e.capsShown().map((c) => c.id);
    const rest = CAPS.map((c) => c.id).filter((k) => !LATE_CAPS.includes(k));
    // the admin page reads the roles: its ผู้ดูแลระบบ has every capability the script knows
    const dir = await L.e.adminDir();
    expect(ids(L.e)).toEqual(rest);
    // a role saved from what the script sent: the two go as 0, which that script accepts
    const sales = dir.roles.find((r) => r.id === 'sales')!;
    const { 'edit.task': _t, ...noTask } = sales.c;
    sent.length = 0;
    await expect(L.e.roleSave({ id: 'sales', n: sales.n, d: sales.d, c: noTask })).resolves.toMatchObject({ id: 'sales' });
    expect(sent.find((b) => b.action === 'role_save')).toMatchObject({ c: { 'view.exp': 0, 'edit.exp': 0 } });
    // asked for anyway (an older tab): the script's refusal says the script needs updating
    await expect(L.e.roleSave({ id: 'sales', n: sales.n, d: sales.d, c: { ...noTask, 'view.exp': 'all' } })).rejects.toThrow(/อัปเดต Code\.gs/);
    // an account's own screens read the roles through me
    expect(S.e.can('view.exp')).toBe(false);
    await S.e.teamRoles();
    expect(ids(S.e)).toEqual(rest);
  });

  it('this script (with them): all of them', async () => {
    const L = await lead();
    await L.e.adminDir();
    expect(L.e.capsShown().map((c) => c.id)).toEqual(CAPS.map((c) => c.id));
  });
});
