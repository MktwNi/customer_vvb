/**
 * The search page's bulk actions in the engine, end to end with the real team script in the simulator
 * (team-sync/Code.gs): following / stopping following, ผู้รับผิดชอบ, sending to the Sales Tracker and
 * planning appointments for many companies at once. Each is one batch (one write of the stored sync queue,
 * each local store written once, one emit), goes out 300 records a push however many there are, skips
 * what is already so and says how many, and is refused for an account without the capability. The words
 * and the selection are lib/bulk.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore, type KVStore } from './storage';
import { jointRole } from './sales';
import { UNDO_SEND_MS, taskDates } from './bulk';
import type { Role } from './teamSync';
import type { Company, Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 60000 });
const URL = 'https://script.google.com/macros/s/b/exec';
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

const T0 = new Date('2026-10-12T03:00:00Z');
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  const g = json('gcc.json'), c = json('gcc-certs.json');
  // enough companies for a selection of a thousand
  const rows = g.rows.slice(0, 1400);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sent: Record<string, unknown>[] = [];
/** A store that counts its writes (each key) — the bulk methods write each once. */
function countingStore() {
  const s = memoryStore();
  const n = { set: new Map<string, number>(), update: new Map<string, number>() };
  const st: KVStore = {
    get: s.get,
    del: s.del,
    set: (k, v) => (n.set.set(k, (n.set.get(k) || 0) + 1), s.set(k, v)),
    update: (k, fn) => (n.update.set(k, (n.update.get(k) || 0) + 1), s.update(k, fn)),
  };
  return { st, n, reset: () => (n.set.clear(), n.update.clear()) };
}
interface Tab { e: GccEngine; browser: string; io: ReturnType<typeof countingStore> }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  sent.length = 0;
  vi.setSystemTime(T0);
});

function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-12';
  const io = countingStore();
  raw.store = io.st;
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => {
    sent.push(body);
    return sim.post(body) as Record<string, unknown>;
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
  const tab = { e, browser, io };
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
/** The live (not deleted) records of a prefix the sheet holds, as an admin pulls them. */
function live(L: Tab, pre: string) {
  const m = new Map<string, { k: string; del: boolean; v: unknown }>();
  let since = 0;
  for (;;) {
    const r = sim.post({ action: 'pull', since, cv: 5, tok: L.e.session!.tok }) as { rows: { k: string; del: boolean; v: unknown; seq: number }[]; seq: number; more?: boolean };
    r.rows.forEach((x) => x.k.startsWith(pre) && m.set(x.k, x));
    if (!r.more) break;
    since = r.rows[r.rows.length - 1].seq;
  }
  return [...m.values()].filter((x) => !x.del);
}
const pushes = () => sent.filter((b) => b.action === 'push').map((b) => (b.ops as unknown[]).length);
const pendWrites = (t: Tab) => [...t.io.n.update].filter(([k]) => k.startsWith('teamPending:')).reduce((a, [, n]) => a + n, 0);
/** Companies of the registry this browser built (the search results, in order). */
const cos = (t: Tab, n: number, from = 0) => t.e.B.companies.slice(from, from + n).map((c) => c.id);
/** Companies made the way the TGO website sync makes them (engine.applySync): ids of this browser only. */
function tgoCos(t: Tab, names: string[]) {
  const raw = t.e as unknown as { pendingSync: unknown; applySync: (auto: boolean) => void };
  raw.pendingSync = {
    total: names.length, at: new Date().toISOString(),
    nw: names.map((org, i) => ({ org, prov: '', act: 'ผลิต', cert: 'TGO-' + i, branch: '', ap: '2026-01-05', ex: '2028-01-04', id: 'w' + i, gid: null })),
  };
  raw.applySync(false);
  const ids = t.e.B.companies.filter((c) => names.includes(c.name)).map((c) => c.id);
  expect(ids.every((id) => id >= 900001 && id < 1e12)).toBe(true);
  return ids;
}

describe('bulk actions on a browser of its own (no team)', () => {
  it('following many: one write of the stored data, one emit; those already followed are counted, not doubled', () => {
    const A = mk('A');
    const ids = cos(A, 15);
    A.e.toggleWatch(ids[0]);
    A.e.toggleWatch(ids[1]);
    let emits = 0;
    const off = A.e.subscribe(() => emits++);
    A.io.reset();
    const r = A.e.setWatchMany([...ids, ids[3]], true); // a repeat counts once
    expect(r).toEqual({ changed: 13, same: 2, local: 0 });
    expect(emits).toBe(1);
    expect(A.io.n.set.get('crm')).toBe(1);
    expect(A.e.crm.watch.filter((x) => ids.includes(x))).toHaveLength(15);
    expect(new Set(A.e.crm.watch).size).toBe(A.e.crm.watch.length);
    expect(ids.every((id) => A.e.company(id)!.fl.watch)).toBe(true);
    // stop following some: the same list, changed in place (every page reads it)
    const W = A.e.crm.watch;
    expect(A.e.setWatchMany(ids.slice(0, 5), false)).toEqual({ changed: 5, same: 0, local: 0 });
    expect(A.e.crm.watch).toBe(W);
    expect(W).toEqual(ids.slice(5));
    expect(A.e.company(ids[0])!.fl.watch).toBe(false);
    expect(A.e.setWatchMany(ids.slice(0, 5), false)).toEqual({ changed: 0, same: 5, local: 0 });
    off();
  });

  it('ผู้รับผิดชอบ for many: each changed company gets its history line; "only the empty ones" leaves the others', () => {
    const A = mk('A');
    const ids = cos(A, 10);
    A.e.setOwner(ids[0], 'คุณบี');
    A.e.setOwner(ids[1], 'หมิว');
    A.io.reset();
    expect(A.e.setOwners(ids, 'หมิว', true)).toEqual({ changed: 8, same: 1, kept: 1, local: 0 });
    expect(A.io.n.set.get('crm')).toBe(1);
    expect(A.e.crm.owners[ids[0]]).toBe('คุณบี');
    expect(ids.slice(1).every((id) => A.e.crm.owners[id] === 'หมิว')).toBe(true);
    expect(A.e.crm.log[ids[5]].at(-1)).toMatchObject({ type: 'owner', text: 'กำหนดผู้รับผิดชอบ: หมิว' });
    expect(A.e.setOwners(ids, 'หมิว')).toEqual({ changed: 1, same: 9, kept: 0, local: 0 });
    expect(A.e.crm.owners[ids[0]]).toBe('หมิว');
    // none: every name taken off
    expect(A.e.setOwners(ids.slice(0, 3), '')).toEqual({ changed: 3, same: 0, kept: 0, local: 0 });
    expect(A.e.crm.owners[ids[0]]).toBeUndefined();
  });

  it('sending many to the tracker skips those with a row in the year (by trackedIn, as dealsOf finds them), and writes the table once', () => {
    const A = mk('A');
    const ids = cos(A, 30);
    A.e.addDeal({ gid: ids[2], year: '2569' });
    A.e.addDeal({ gid: ids[4], year: '2568' }); // another year: still sent
    const has = A.e.trackedIn('2569');
    const sameAsDealsOf = (c: Company) => A.e.dealsOf(c.id).some((d) => d.year === '2569' && jointRole(A.e.sales, d) !== 'header');
    expect(A.e.B.companies.slice(0, 30).every((c) => has(c) === sameAsDealsOf(c))).toBe(true);
    A.io.reset();
    let emits = 0;
    const off = A.e.subscribe(() => emits++);
    const r = A.e.addDealsFromCompanies([...ids, ids[0]], { year: '2569' });
    off();
    expect(r).toMatchObject({ added: 29, skipped: 1 });
    expect(r.ids).toHaveLength(29);
    expect(emits).toBe(1);
    expect(A.io.n.set.get('sales')).toBe(1);
    const inYear = Object.values(A.e.sales.deals).filter((d) => d.year === '2569');
    expect(inYear).toHaveLength(30);
    expect(new Set(inYear.map((d) => d.gid)).size).toBe(30);
    // again: everything is there now
    expect(A.e.addDealsFromCompanies(ids, { year: '2569' })).toEqual({ added: 0, skipped: 30, ids: [], k: '' });
  });

  it('เลิกทำ after a send takes back exactly its rows, within 10 minutes, leaving rows someone worked on (review: a mistaken send could not be undone)', () => {
    const A = mk('A');
    const ids = cos(A, 12);
    const before = A.e.addDeal({ gid: ids[11], year: '2569' }); // there already: neither sent nor taken back
    const r = A.e.addDealsFromCompanies(ids, { year: '2569' });
    expect(r).toMatchObject({ added: 11, skipped: 1 });
    expect(r.k).toBeTruthy();
    const [d0, d1, d2] = r.ids.map((id) => A.e.sales.deals[id]);
    A.e.updateDeal(d0.id, { forecast: 120000 }); // someone typed in it
    A.e.setStep(d1.id, A.e.sales.cfg.stages[0], { d: '2026-10-12', n: 'โทรแล้ว' }); // someone worked on it
    expect(A.e.undoSent('another send')).toEqual({ removed: 0, kept: 0, late: true });
    A.io.reset();
    let emits = 0;
    const off = A.e.subscribe(() => emits++);
    expect(A.e.undoSent(r.k)).toEqual({ removed: 9, kept: 2 });
    off();
    expect(emits).toBe(1);
    expect(A.io.n.set.get('sales')).toBe(1);
    expect(A.e.sales.deals[d0.id]).toBeTruthy();
    expect(A.e.sales.deals[d1.id]).toBeTruthy();
    expect(A.e.sales.deals[d2.id]).toBeUndefined();
    expect(A.e.sales.deals[before.id]).toBeTruthy();
    expect(Object.values(A.e.sales.deals).filter((d) => d.year === '2569')).toHaveLength(3);
    // once only; a new send can be taken back for 10 minutes
    expect(A.e.undoSent(r.k)).toMatchObject({ late: true });
    const r2 = A.e.addDealsFromCompanies(ids, { year: '2569' });
    expect(r2.added).toBe(9);
    vi.setSystemTime(T0.getTime() + UNDO_SEND_MS + 1000);
    expect(A.e.undoSent(r2.k)).toEqual({ removed: 0, kept: 0, late: true });
    expect(Object.values(A.e.sales.deals).filter((d) => d.year === '2569')).toHaveLength(12);
  });

  it('planning many spreads them over working days as the dialog says, in one batch', () => {
    const A = mk('A');
    const ids = cos(A, 23);
    A.io.reset();
    const r = A.e.addTasks(ids, { type: 'call', date: '2026-10-09', time: '', note: 'โทรต่ออายุ' }, 5); // a Friday
    expect(r).toEqual({ n: 23, first: '2026-10-09', last: '2026-10-15', local: 0 });
    expect(A.io.n.set.get('crm')).toBe(1);
    const days = A.e.crm.tasks.map((t) => t.date);
    expect(days).toEqual(taskDates('2026-10-09', 23, 5));
    expect(days.filter((d) => d === '2026-10-12')).toHaveLength(5); // Monday after the weekend
  });
});

describe('bulk actions in a team (Code.gs in the simulator)', () => {
  it('a thousand followed at once: one queue write, pushes of at most 300, every one on the sheet, a teammate sees them', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    await settle(L);
    const ids = cos(L, 1000);
    L.e.toggleWatch(ids[0]);
    await settle(L);
    L.io.reset();
    sent.length = 0;
    const r = L.e.setWatchMany(ids, true);
    expect(r).toEqual({ changed: 999, same: 1, local: 0 });
    await tick(); // (the queue is written after the change, in order with other writes)
    expect(pendWrites(L)).toBe(1); // the stored queue written once, not a thousand times
    expect(L.e.teamPendingN).toBe(999);
    await settle(L, S);
    expect(L.e.teamPendingN).toBe(0);
    const p = pushes();
    expect(p.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(999);
    expect(Math.max(...p)).toBeLessThanOrEqual(300);
    expect(p.length).toBeGreaterThanOrEqual(4);
    expect(live(L, 'watch/')).toHaveLength(1000);
    expect(new Set(S.e.crm.watch)).toEqual(new Set(ids));
    expect(ids.slice(0, 50).every((id) => S.e.company(id)!.fl.watch)).toBe(true);
    // and a sales account stops following a few of them
    expect(S.e.setWatchMany(ids.slice(0, 10), false)).toEqual({ changed: 10, same: 0, local: 0 });
    await settle(S, L);
    expect(live(L, 'watch/')).toHaveLength(990);
    expect(L.e.crm.watch.includes(ids[0])).toBe(false);
  });

  it('ผู้รับผิดชอบ and the tracker for many: the script takes them from a sales account; the year\'s rows are not doubled', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    await settle(L, S);
    const ids = cos(S, 400);
    L.e.addDeal({ gid: ids[7], year: '2569', resp: 'หมิว' });
    await settle(L, S);
    expect(S.e.setOwners(ids, 'เอก')).toEqual({ changed: 400, same: 0, kept: 0, local: 0 });
    const r = S.e.addDealsFromCompanies(ids, { year: '2569' });
    expect(r).toMatchObject({ added: 399, skipped: 1 });
    sent.length = 0;
    await settle(S, L);
    expect(S.e.teamPendingN).toBe(0);
    expect(Math.max(...pushes())).toBeLessThanOrEqual(300);
    expect(live(L, 'owner/')).toHaveLength(400);
    const deals = live(L, 'deal/').map((x) => x.v as { gid: number; year: string; resp: string });
    expect(deals.filter((d) => d.year === '2569')).toHaveLength(400);
    expect(new Set(deals.map((d) => d.gid)).size).toBe(400);
    // the deals are the sales account's own (ผู้รับผิดชอบ filled from the company's owner)
    expect(deals.filter((d) => d.resp === 'เอก')).toHaveLength(399);
    expect(Object.keys(L.e.crm.owners).length).toBeGreaterThanOrEqual(400);
    expect(L.e.crm.owners[ids[100]]).toBe('เอก');
    // the admin plans them all, a few a day
    const t = L.e.addTasks(ids.slice(0, 250), { type: 'call', date: '2026-10-13', time: '', note: '' }, 20);
    expect(t).toMatchObject({ n: 250, first: '2026-10-13' });
    await settle(L, S);
    expect(live(L, 'task/')).toHaveLength(250);
    expect(S.e.crm.tasks).toHaveLength(250);
  });

  it('เลิกทำ of a send goes to the whole team for an account that may delete deals; a sales account (no del.rec) is refused before anything is queued', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    await settle(L, S);
    const ids = cos(S, 40);
    const rs = S.e.addDealsFromCompanies(ids.slice(0, 20), { year: '2569' });
    await settle(S, L);
    expect(live(L, 'deal/')).toHaveLength(20);
    expect(S.e.can('del.rec')).toBe(false);
    expect(S.e.undoSent(rs.k)).toEqual({ removed: 0, kept: 0 });
    expect(S.e.teamNote).toMatch(/ไม่มีสิทธิ์/);
    expect(S.e.teamPendingN).toBe(0);
    // the admin: one batch, the sheet loses exactly those rows, the teammate's table follows
    const ra = L.e.addDealsFromCompanies(ids.slice(20), { year: '2569' });
    await settle(L, S);
    expect(live(L, 'deal/')).toHaveLength(40);
    sent.length = 0;
    expect(L.e.undoSent(ra.k)).toEqual({ removed: 20, kept: 0 });
    await settle(L, S);
    expect(L.e.teamPendingN).toBe(0);
    expect(Math.max(...pushes())).toBeLessThanOrEqual(300);
    const left = live(L, 'deal/').map((x) => x.k.slice(5));
    expect(left.sort()).toEqual([...rs.ids].sort());
    expect(Object.values(S.e.sales.deals).filter((d) => d.year === '2569')).toHaveLength(20);
  });

  it('companies from the TGO website sync: ติดตาม, ผู้รับผิดชอบ and นัด stay on this browser and are counted apart (review: the toasts counted them as shared)', async () => {
    const L = await lead();
    await settle(L);
    const local = tgoCos(L, ['บริษัท เว็บหนึ่ง จำกัด', 'บริษัท เว็บสอง จำกัด', 'บริษัท เว็บสาม จำกัด']);
    const ids = [...cos(L, 4), ...local];
    expect(L.e.setWatchMany(ids, true)).toEqual({ changed: 7, same: 0, local: 3 });
    expect(L.e.setOwners(ids, 'หมิว')).toEqual({ changed: 7, same: 0, kept: 0, local: 3 });
    expect(L.e.addTasks(ids, { type: 'call', date: '2026-10-13', time: '', note: '' }, 5)).toMatchObject({ n: 7, local: 3 });
    await settle(L);
    expect(live(L, 'watch/')).toHaveLength(4);
    expect(live(L, 'owner/')).toHaveLength(4);
    expect(live(L, 'task/')).toHaveLength(4);
    // their tracker rows are shared (by name)
    expect(L.e.addDealsFromCompanies(local, { year: '2569' })).toMatchObject({ added: 3 });
    await settle(L);
    expect(live(L, 'deal/')).toHaveLength(3);
    // with no team, nothing is "apart": everything is this browser's
    const A = mk('A');
    const la = tgoCos(A, ['บริษัท เว็บสี่ จำกัด']);
    expect(A.e.setWatchMany(la, true)).toEqual({ changed: 1, same: 0, local: 0 });
  });

  it('a view-only account changes nothing and is told why; nothing is queued', async () => {
    const L = await lead();
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    await settle(L, V);
    const ids = cos(V, 20);
    expect(V.e.setWatchMany(ids, true)).toEqual({ changed: 0, same: 0, local: 0 });
    expect(V.e.teamNote).toMatch(/ไม่มีสิทธิ์/);
    expect(V.e.setOwners(ids, 'ปลา')).toEqual({ changed: 0, same: 0, kept: 0, local: 0 });
    expect(V.e.addDealsFromCompanies(ids)).toEqual({ added: 0, skipped: 0, ids: [], k: '' });
    expect(V.e.addTasks(ids, { type: 'call', date: '2026-10-13', time: '', note: '' }, 5)).toEqual({ n: 0, first: '', last: '', local: 0 });
    expect(V.e.crm.watch).toEqual([]);
    expect(V.e.crm.tasks).toEqual([]);
    expect(Object.keys(V.e.crm.owners)).toEqual([]);
    expect(V.e.teamPendingN).toBe(0);
  });
});
