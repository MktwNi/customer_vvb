/**
 * Team accounts in the engine, run against the real team script (team-sync/Code.gs in the simulator):
 * a team-code team switching to accounts with edits still queued, one browser shared by two people,
 * sessions that end, roles that change, and the older script.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore, prefs, PREF } from './storage';
import type { Role, Session, SyncOp, TeamCfg } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/c/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const V2 = readFileSync(join(ROOT, 'team-sync', 'fixtures', 'Code.v2.gs'), 'utf8');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const pendKey = (url: string) => 'teamPending:' + url;

/** localStorage per browser: each engine reads and writes the one of its browser. */
const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});
const at = <T,>(browser: string, fn: () => T) => ((cur = browser), fn());

/** A browser's network, and the actions it sent. `lost`: the next push reaches the sheet, its reply doesn't. */
interface Net { offline: boolean; fail: null | 'drop' | 'lost'; sent: string[] }
type Store = ReturnType<typeof memoryStore>;
interface Tab { e: GccEngine; net: Net; store: Store; browser: string }

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 200);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
});

/** An engine on `browser` (a second tab of it: pass that tab's store). Every call through it uses
 *  that browser's localStorage. */
function mk(browser: string, store: Store = memoryStore()): Tab {
  const raw = new GccEngine();
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-06';
  raw.store = store;
  raw.rebuild();
  raw.loading = false;
  const net: Net = { offline: false, fail: null, sent: [] };
  raw.transport = async (_u, body) => {
    if (net.offline) throw new TypeError('Failed to fetch');
    net.sent.push(String(body.action));
    if (body.action === 'push' && net.fail) {
      const f = net.fail;
      net.fail = null;
      if (f === 'drop') throw new TypeError('Failed to fetch');
      sim.post(body);
      throw new TypeError('Failed to fetch'); // delivered, reply lost
    }
    return sim.post(body);
  };
  const e = new Proxy(raw, {
    get(t, p) {
      cur = browser;
      const v = Reflect.get(t, p, t);
      return typeof v === 'function'
        ? (...a: unknown[]) => {
            cur = browser;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          }
        : v;
    },
  });
  const tab = { e, net, store, browser };
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
/** The sheet's rows (all, or for one record). */
function rows(k?: string) {
  const sh = sim.sheet();
  return (sh ? sh.rows.slice(1) : [])
    .filter((r) => r[1] && (!k || r[1] === k))
    .map((r) => ({ seq: +r[0], k: r[1], v: r[2] === '' ? null : JSON.parse(r[2]), del: r[3] === '1', by: r[4] }));
}
const stored = (t: Tab) => (t.e as unknown as { pq: Promise<unknown> }).pq;
const queue = async (t: Tab, key: string) => (await t.store.get<SyncOp[]>(key)) || [];
const pref = <T,>(t: Tab, k: string) => at(t.browser, () => prefs.get<T | null>(k, null));
const later = (s: number) => vi.setSystemTime(Date.now() + s * 1000);
/** A company id shared with the team (not one made by the TGO website sync on this device). */
const company = (t: Tab, n = 0) => t.e.B.companies.filter((c) => c.id < 900000 && !c.fl.watch)[n].id;

/** A new team script; the lead claims it from browser L. `key`: a team-code team turning accounts on. */
async function lead(key = '') {
  sim = createGasSim({ teamKey: key, kdfIter: 1000 });
  sim.setup();
  const L = mk('L');
  if (key) {
    expect(await L.e.teamConnect(URL, key)).toBe(true);
    L.e.teamBeginSetup();
  } else expect(await L.e.teamOpen(URL)).toBe('setup');
  expect(L.e.auth).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หัวหน้า', 'lead-pass-123');
  expect(L.e.auth).toBe('');
  expect(L.e.role()).toBe('admin');
  return L;
}
/** An account made by the admin, signed in on `browser` with its own password set. */
async function member(L: Tab, u: string, name: string, role: Role, browser = u, store?: Store) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(browser, store);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  expect(M.e.auth).toBe('change');
  await M.e.teamChangePassword('', u + '-pass-123');
  expect(M.e.auth).toBe('');
  await settle(M);
  return M;
}

describe('the older team script and team-code mode', () => {
  it('an old script (v2): the team code works as before, with the name chosen here', async () => {
    sim = createGasSim({ teamKey: KEY, code: V2 });
    const A = mk('A');
    at('A', () => prefs.set(PREF.me, 'เอ'));
    expect(await A.e.teamOpen(URL)).toBe('legacy');
    expect(await A.e.teamConnect(URL, KEY)).toBe(true);
    expect(A.e.auth).toBe('');
    expect(A.e.me()).toBe('เอ');
    expect(A.e.role()).toBe(null);
    const id = company(A);
    A.e.toggleWatch(id);
    await settle(A);
    expect(rows('watch/' + id)).toEqual([expect.objectContaining({ v: 1, by: 'เอ' })]);
  });

  it('a new script still on the team code: unchanged, and the team card learns it can do accounts', async () => {
    sim = createGasSim({ teamKey: KEY, kdfIter: 1000 });
    const A = mk('A');
    at('A', () => prefs.set(PREF.me, 'เอ'));
    expect(await A.e.teamConnect(URL, KEY)).toBe(true);
    for (let i = 0; i < 5; i++) await tick();
    expect(A.e.caps).toMatchObject({ v: 3, mode: 'legacy' });
    A.e.toggleWatch(company(A));
    await settle(A);
    expect(A.e.teamPendingN).toBe(0);
    A.e.teamBeginSetup();
    expect([A.e.auth, A.e.authUrl]).toEqual(['setup', URL]);
    A.e.teamCancelAuth();
    expect(A.e.auth).toBe('');
    expect(A.e.teamCfg?.url).toBe(URL);
  });
});

describe('switching a team-code team to accounts', () => {
  it('a browser with an edit queued under the team code signs in, and the edit is sent once, in its name', async () => {
    sim = createGasSim({ teamKey: KEY, kdfIter: 1000 });
    sim.setup();
    const A = mk('A');
    at('A', () => prefs.set(PREF.me, 'เอ'));
    expect(await A.e.teamConnect(URL, KEY)).toBe(true);
    await settle(A);
    const id = company(A);
    A.net.offline = true;
    A.e.toggleWatch(id);
    await stored(A);
    expect((await queue(A, pendKey(URL))).map((o) => o.k)).toEqual(['watch/' + id]);

    // the lead claims from another browser
    const L = mk('L');
    expect(await L.e.teamConnect(URL, KEY)).toBe(true);
    L.e.teamBeginSetup();
    await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หัวหน้า', 'lead-pass-123');
    expect(L.e.role()).toBe('admin');

    // A's next round: the team code is refused, so A is asked to sign in; the edit stays queued
    A.net.offline = false;
    await A.e.teamSyncNow();
    expect(A.e.auth).toBe('login');
    expect(pref<TeamCfg>(A, PREF.team)).toMatchObject({ url: URL, mode: 'accounts' });
    expect((await queue(A, pendKey(URL))).length).toBe(1);
    expect(rows('watch/' + id)).toEqual([]);

    const { temp } = await L.e.adminCreate({ u: 'ae', name: 'เอ', role: 'sales' });
    const before = A.net.sent.length;
    await A.e.teamLogin('ae', temp, true);
    expect(A.e.auth).toBe('change'); // nothing is sent before the password is set
    expect(A.net.sent.slice(before).filter((x) => x === 'push' || x === 'pull')).toEqual([]);
    expect((await queue(A, pendKey(URL) + '#ae')).map((o) => [o.k, o.by])).toEqual([['watch/' + id, 'เอ']]);
    expect(await queue(A, pendKey(URL))).toEqual([]);

    A.net.fail = 'lost'; // the first push arrives, its reply doesn't
    await A.e.teamChangePassword('', 'ae-pass-123');
    expect(A.e.auth).toBe('');
    await settle(A);
    expect(rows('watch/' + id)).toEqual([expect.objectContaining({ v: 1, by: 'เอ' })]);
    expect(A.e.teamPendingN).toBe(0);
    expect(A.net.sent.filter((x) => x === 'push').length).toBe(1);
    expect(A.e.me()).toBe('เอ');
  });
});

describe('sessions', () => {
  it('two people on one browser: each one\'s unsent edits wait for them and go out in their name', async () => {
    const L = await lead();
    const store = memoryStore();
    const A = await member(L, 'ae', 'เอ', 'sales', 'X', store);
    const id = company(A);
    A.net.offline = true;
    A.e.toggleWatch(id);
    await stored(A);
    await A.e.teamLogout();
    expect(A.e.auth).toBe('login');

    // B signs in on the same browser (same tab): A's edit is not B's to send
    A.net.offline = false;
    const { temp } = await L.e.adminCreate({ u: 'bee', name: 'บี', role: 'sales' });
    await A.e.teamLogin('bee', temp, false);
    await A.e.teamChangePassword('', 'bee-pass-123');
    await settle(A);
    expect(A.e.me()).toBe('บี');
    expect(rows('watch/' + id)).toEqual([]);
    expect((await queue(A, pendKey(URL) + '#ae')).length).toBe(1);

    await A.e.teamLogout();
    await A.e.teamLogin('ae', 'ae-pass-123', true);
    await settle(A);
    expect(rows('watch/' + id)).toEqual([expect.objectContaining({ v: 1, by: 'เอ' })]);
    expect(await queue(A, pendKey(URL) + '#ae')).toEqual([]);
  });

  it('signed out by an admin: edits keep queuing, and after signing in again they are sent once', async () => {
    const L = await lead();
    const A = await member(L, 'ae', 'เอ', 'sales');
    await L.e.adminKick('ae');
    await A.e.teamSyncNow();
    expect(A.e.auth).toBe('expired');
    expect(pref<Session>(A, PREF.session)?.tok).toBe('');
    const gen = (A.e as unknown as { teamGen: number }).teamGen;
    const id = company(A);
    A.e.toggleWatch(id);
    await stored(A);
    expect(A.e.teamPendingN).toBe(1);
    later(60);
    await A.e.teamSyncNow();
    expect(rows('watch/' + id)).toEqual([]); // nothing is sent while signed out

    await A.e.teamLogin('ae', 'ae-pass-123', true);
    await settle(A);
    expect(A.e.auth).toBe('');
    expect((A.e as unknown as { teamGen: number }).teamGen).toBe(gen);
    expect(rows('watch/' + id)).toHaveLength(1);
  });

  it('a disabled account stops syncing', async () => {
    const L = await lead();
    const A = await member(L, 'ae', 'เอ', 'sales');
    await L.e.adminUpdate('ae', { on: 0 });
    await A.e.teamSyncNow();
    expect(A.e.auth).toBe('disabled');
  });

  it('made ดูอย่างเดียว with edits queued: nothing is sent, and they can be dropped', async () => {
    const L = await lead();
    const A = await member(L, 'ae', 'เอ', 'sales');
    const id = company(A);
    A.net.offline = true;
    A.e.toggleWatch(id);
    await stored(A);
    await L.e.adminUpdate('ae', { role: 'viewer' });
    A.net.offline = false;
    await settle(A);
    expect(A.e.role()).toBe('viewer');
    expect(A.e.can('edit')).toBe(false);
    expect(A.e.teamPendingN).toBe(1);
    expect(A.e.teamNote).toMatch(/ดูอย่างเดียว/);
    expect(rows('watch/' + id)).toEqual([]);
    expect(A.e.crm.watch).toContain(id);

    await A.e.teamDropUnsent();
    await settle(A);
    expect(A.e.teamPendingN).toBe(0);
    expect(A.e.crm.watch).not.toContain(id);
  });

  it('must change the password: no sync until it is set; the temporary password\'s session ends', async () => {
    const L = await lead();
    const { temp } = await L.e.adminCreate({ u: 'ae', name: 'เอ', role: 'sales' });
    const A = mk('A');
    await A.e.teamOpen(URL);
    await A.e.teamLogin('ae', temp, false);
    expect(A.e.auth).toBe('change');
    expect(A.e.knowsTempPassword).toBe(true);
    expect(A.net.sent.filter((x) => x === 'pull' || x === 'push')).toEqual([]);
    const old = A.e.session!.tok;
    await A.e.teamChangePassword('', 'ae-pass-123');
    expect(A.e.auth).toBe('');
    expect(A.net.sent).toContain('pull');
    expect(sim.post({ action: 'pull', since: 0, cv: 3, tok: old })).toMatchObject({ ok: false, error: 'session_expired' });
  });
});

describe('what each role may change', () => {
  it('an admin made sales with list and team edits queued: refused, and the team\'s values come back', async () => {
    const L = await lead();
    const B = await member(L, 'boss', 'บอส', 'admin');
    const was = [...B.e.sales.cfg.sources];
    B.net.offline = true;
    B.e.setSalesList('sources', [...was, 'งานแฟร์']);
    B.e.addTeam('คนนอก');
    await stored(B);
    await L.e.adminUpdate('boss', { role: 'sales' });
    B.net.offline = false;
    await settle(B);
    expect(B.e.role()).toBe('sales');
    expect(B.e.teamPendingN).toBe(0);
    expect(B.e.sales.cfg.sources).toEqual(was);
    expect(B.e.crm.team).not.toContain('คนนอก');
    expect(rows('team/คนนอก')).toEqual([]);
  });

  it('sales: deleting a deal, lists, dedup decisions and the team list are refused here', async () => {
    const L = await lead();
    const d = L.e.addDeal({ client: 'บริษัท ทดสอบ จำกัด' });
    await settle(L);
    const A = await member(L, 'ae', 'เอ', 'sales');
    expect(A.e.sales.deals[d.id]).toBeTruthy();
    const pushes = () => A.net.sent.filter((x) => x === 'push' || x === 'delfile').length;
    const n = pushes();
    A.e.deleteDeal(d.id);
    A.e.setSalesList('sources', ['x']);
    A.e.addTeam('คนนอก');
    A.e.decide('1|2', 'merge');
    expect(A.e.sales.deals[d.id]).toBeTruthy();
    expect(A.e.teamPendingN).toBe(0);
    expect(A.e.teamNote).toMatch(/ไม่มีสิทธิ์/);
    await settle(A);
    expect(pushes()).toBe(n);
    // and editing works
    A.e.updateDeal(d.id, { referral: 'คุณสมชาย' });
    await settle(A);
    expect(rows('deal/' + d.id).at(-1)?.by).toBe('เอ');
  });

  it('a viewer sends nothing; a change made anyway is put back', async () => {
    const L = await lead();
    const V = await member(L, 'vee', 'วี', 'viewer');
    const id = company(V);
    V.e.toggleWatch(id);
    expect(V.e.teamPendingN).toBe(0);
    await settle(V);
    expect(V.e.crm.watch).not.toContain(id);
    expect(V.net.sent).not.toContain('push');
    expect(V.net.sent).not.toContain('upload');
  });
});

describe('two tabs of one browser', () => {
  it('a sign-in, a new token, a sign-out and a different person in the other tab', async () => {
    const L = await lead();
    const { temp } = await L.e.adminCreate({ u: 'ae', name: 'เอ', role: 'sales' });
    const store = memoryStore();
    const T1 = mk('X', store), T2 = mk('X', store);
    const event = (t: Tab, key: string) => (t.e as unknown as { teamPrefsChanged: (e: { key: string }) => void }).teamPrefsChanged({ key });
    await T1.e.teamOpen(URL);
    await T2.e.teamOpen(URL);
    expect(T2.e.auth).toBe('login');
    await T1.e.teamLogin('ae', temp, true);
    await T1.e.teamChangePassword('', 'ae-pass-123');
    event(T2, PREF.session);
    await settle(T2);
    expect(T2.e.auth).toBe('');
    expect(T2.e.me()).toBe('เอ');
    expect(T2.net.sent).toContain('pull');

    // a renewed token: taken in place
    const gen = (T2.e as unknown as { teamGen: number }).teamGen;
    at('X', () => prefs.set(PREF.session, { ...pref<Session>(T1, PREF.session)!, tok: 'g1.renewed.x', exp: Date.now() + 9e8 }));
    event(T2, PREF.session);
    expect((T2.e as unknown as { teamGen: number }).teamGen).toBe(gen);
    expect([T2.e.auth, T2.e.session?.tok]).toEqual(['', 'g1.renewed.x']);

    await T1.e.teamLogout();
    event(T2, PREF.session);
    expect(T2.e.auth).toBe('login');
    expect(T2.e.authMsg).toMatch(/ออกจากระบบ/);

    // T2 signs in again; then someone else signs in in T1: T2 reloads
    await T2.e.teamLogin('ae', 'ae-pass-123', true);
    await settle(T2);
    expect(T2.e.auth).toBe('');
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    try {
      at('X', () => prefs.set(PREF.session, { ...pref<Session>(T2, PREF.session)!, u: 'bee', name: 'บี' }));
      event(T2, PREF.session);
      expect(reload).toHaveBeenCalled();
    } finally {
      vi.stubGlobal('location', undefined);
    }
  });
});

describe('going back and leaving', () => {
  it('the older script pasted back: unsent edits go back to the team-code queue', async () => {
    const L = await lead();
    const A = await member(L, 'ae', 'เอ', 'sales');
    const id = company(A);
    A.net.offline = true;
    A.e.toggleWatch(id);
    await stored(A);
    sim = createGasSim({ teamKey: KEY, code: V2 });
    A.net.offline = false;
    await A.e.teamSyncNow();
    for (let i = 0; i < 5; i++) await tick();
    expect(A.e.teamNeedKey).toBe(true);
    expect(A.e.session).toBe(null);
    expect(pref(A, PREF.session)).toBe(null);
    expect((await queue(A, pendKey(URL))).map((o) => [o.k, o.by])).toEqual([['watch/' + id, 'เอ']]);
    expect(await queue(A, pendKey(URL) + '#ae')).toEqual([]);
    expect(await A.e.teamSetKey(KEY)).toBe(true);
    await settle(A);
    expect(sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((r) => r.k === 'watch/' + id)).toEqual([expect.objectContaining({ by: 'เอ' })]);
  });

  it('signing out on a shared computer clears the team\'s data here; the next sign-in only downloads', async () => {
    const L = await lead();
    L.e.addDeal({ client: 'บริษัท ทดสอบ จำกัด' });
    await settle(L);
    const A = await member(L, 'ae', 'เอ', 'sales');
    expect(Object.keys(A.e.sales.deals).length).toBeGreaterThan(0);
    await A.e.teamLogout({ wipe: true });
    for (const k of ['sales', 'people', 'customCos', 'dedup']) expect(await A.store.get(k)).toBe(undefined);
    expect(pref<TeamCfg>(A, PREF.team)).toMatchObject({ url: URL, seq: 0, seeded: true, mode: 'accounts' });
    expect(pref(A, PREF.wipe)).toBeTruthy();

    // the page reloads after a wipe: a new engine on the same browser
    const A2 = mk('A', A.store);
    await A2.e.teamOpen(URL);
    const n = rows().length;
    await A2.e.teamLogin('ae', 'ae-pass-123', true);
    await settle(A2);
    expect(A2.net.sent).not.toContain('push');
    expect(rows().length).toBe(n);
    expect(Object.keys(A2.e.sales.deals).length).toBeGreaterThan(0);
  });
});
