/**
 * Team accounts in the engine, run against the real team script (team-sync/Code.gs in the simulator):
 * a team-code team switching to accounts with edits still queued, one browser shared by two people,
 * sessions that end, roles that change, tabs that miss each other's sign-ins and outs, files not
 * uploaded yet, and the older script (before the switch, and pasted back after it).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore, prefs, PREF } from './storage';
import type { Role, Session, SyncOp, TeamCfg } from './teamSync';
import type { DealDoc, SalesState } from './sales';
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

/** A browser's network, and the actions it sent (file requests as 'file:<action>'). `lost`: the next
 *  push reaches the sheet, its reply doesn't. `hold`: runs before a request is sent (may wait, or throw
 *  as a network error would). `files: 'fail'`: uploads and other file requests fail. */
interface Net { offline: boolean; fail: null | 'drop' | 'lost'; sent: string[]; hold?: (body: Record<string, unknown>) => Promise<void> | void; files?: 'fail' }
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
  slow = null;
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
    if (net.hold) await net.hold(body);
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
  raw.fileTransport = async (_u, body) => {
    if (net.offline || net.files === 'fail') throw new TypeError('Failed to fetch');
    net.sent.push('file:' + String(body.action));
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
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const quote = { kind: 'quotation', amount: 1000, target: 'forecast', basis: 'total', detected: 1000, docNo: 'Q-1', docDate: '' } as const;
/** A promise, and the function that settles it. */
function gate() {
  let open = () => {};
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}
const ticks = async (n = 5) => {
  for (let i = 0; i < n; i++) await tick();
};
/** Timers fire with `t`'s browser as the current one (other tabs' timers stopped beforehand). */
const advance = (t: Tab, ms: number) => at(t.browser, () => vi.advanceTimersByTimeAsync(ms));

/** The app's data files, for a page load (load()); gcc.json arrives only once `slow` settles. */
let slow: Promise<void> | null = null;
vi.stubGlobal('fetch', async (u: string) => {
  const f = String(u).split('/').pop();
  if (f === 'gcc.json' && slow) await slow;
  const body = f === 'gcc.json' ? { asOf: base.asOf, dicts: base.dicts, rows: base.rows } : f === 'gcc-certs.json' ? { dicts: base.cdicts, rows: base.certs } : f === 'rounds.json' ? R : [];
  return { json: async () => structuredClone(body) };
});
/** A page load in tab `t` (no TGO website sync); `wait`: the dataset arrives once it settles. */
function pageLoad(t: Tab, wait?: Promise<void>) {
  at(t.browser, () => prefs.set(PREF.sync, { freq: 'off' }));
  slow = wait || null;
  return t.e.load();
}
/** A page load whose data has arrived: let it finish. */
async function loaded(t: Tab, p: Promise<void>) {
  await ticks(20);
  await advance(t, 40);
  await p;
}
/** The lead pastes the older script (team code only) back; the sheet and its rows stay. */
function rollback() {
  const keep = rows();
  sim = createGasSim({ teamKey: KEY, code: V2 });
  sim.post({ action: 'push', key: KEY, ops: keep.map((r) => ({ k: r.k, v: r.v, del: r.del, by: r.by })) });
}
/** The sheet's rows for a record, read with the team code (the older script). */
const codeRows = (k: string) => sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((r) => r.k === k);
const event = (t: Tab, key: string) => (t.e as unknown as { teamPrefsChanged: (e: { key: string }) => void }).teamPrefsChanged({ key });

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
/** An account made by the admin, signed in on `browser` with its own password set (`rm`: จดจำฉัน). */
async function member(L: Tab, u: string, name: string, role: Role, browser = u, store?: Store, rm = true) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(browser, store);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, rm);
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

    const { temp } = await L.e.adminCreate({ u: 'aem', name: 'เอ', role: 'sales' });
    const before = A.net.sent.length;
    await A.e.teamLogin('aem', temp, true);
    expect(A.e.auth).toBe('change'); // nothing is sent before the password is set
    expect(A.net.sent.slice(before).filter((x) => x === 'push' || x === 'pull')).toEqual([]);
    expect((await queue(A, pendKey(URL) + '#aem')).map((o) => [o.k, o.by])).toEqual([['watch/' + id, 'เอ']]);
    expect(await queue(A, pendKey(URL))).toEqual([]);

    const pushed = A.net.sent.filter((x) => x === 'push').length;
    A.net.fail = 'lost'; // the first push arrives, its reply doesn't
    await A.e.teamChangePassword('', 'aem-pass-123');
    expect(A.e.auth).toBe('');
    await settle(A);
    expect(rows('watch/' + id)).toEqual([expect.objectContaining({ v: 1, by: 'เอ' })]);
    expect(A.e.teamPendingN).toBe(0);
    expect(A.net.sent.filter((x) => x === 'push').length - pushed).toBe(1);
    expect(A.e.me()).toBe('เอ');
  });
});

describe('sessions', () => {
  it('two people on one browser: each one\'s unsent edits wait for them and go out in their name', async () => {
    const L = await lead();
    const store = memoryStore();
    const A = await member(L, 'aem', 'เอ', 'sales', 'X', store);
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
    expect((await queue(A, pendKey(URL) + '#aem')).length).toBe(1);

    await A.e.teamLogout();
    await A.e.teamLogin('aem', 'aem-pass-123', true);
    await settle(A);
    expect(rows('watch/' + id)).toEqual([expect.objectContaining({ v: 1, by: 'เอ' })]);
    expect(await queue(A, pendKey(URL) + '#aem')).toEqual([]);
  });

  it('signed out by an admin: edits keep queuing, and after signing in again they are sent once', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    await L.e.adminKick('aem');
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

    await A.e.teamLogin('aem', 'aem-pass-123', true);
    await settle(A);
    expect(A.e.auth).toBe('');
    expect((A.e as unknown as { teamGen: number }).teamGen).toBe(gen);
    expect(rows('watch/' + id)).toHaveLength(1);
  });

  it('a disabled account stops syncing', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    await L.e.adminUpdate('aem', { on: 0 });
    await A.e.teamSyncNow();
    expect(A.e.auth).toBe('disabled');
  });

  it('made ดูอย่างเดียว with edits queued: nothing is sent, and they can be dropped', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    const id = company(A);
    A.net.offline = true;
    A.e.toggleWatch(id);
    await stored(A);
    await L.e.adminUpdate('aem', { role: 'viewer' });
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
    const { temp } = await L.e.adminCreate({ u: 'aem', name: 'เอ', role: 'sales' });
    const A = mk('A');
    await A.e.teamOpen(URL);
    await A.e.teamLogin('aem', temp, false);
    expect(A.e.auth).toBe('change');
    expect(A.e.knowsTempPassword).toBe(true);
    expect(A.net.sent.filter((x) => x === 'pull' || x === 'push')).toEqual([]);
    const old = A.e.session!.tok;
    await A.e.teamChangePassword('', 'aem-pass-123');
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
    const A = await member(L, 'aem', 'เอ', 'sales');
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
    const { temp } = await L.e.adminCreate({ u: 'aem', name: 'เอ', role: 'sales' });
    const store = memoryStore();
    const T1 = mk('X', store), T2 = mk('X', store);
    await T1.e.teamOpen(URL);
    await T2.e.teamOpen(URL);
    expect(T2.e.auth).toBe('login');
    await T1.e.teamLogin('aem', temp, true);
    await T1.e.teamChangePassword('', 'aem-pass-123');
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
    await T2.e.teamLogin('aem', 'aem-pass-123', true);
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
    const A = await member(L, 'aem', 'เอ', 'sales');
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
    expect(await queue(A, pendKey(URL) + '#aem')).toEqual([]);
    expect(await A.e.teamSetKey(KEY)).toBe(true);
    await settle(A);
    expect(sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((r) => r.k === 'watch/' + id)).toEqual([expect.objectContaining({ by: 'เอ' })]);
  });

  it('signing out on a shared computer clears the team\'s data here; the next sign-in only downloads', async () => {
    const L = await lead();
    L.e.addDeal({ client: 'บริษัท ทดสอบ จำกัด' });
    await settle(L);
    const A = await member(L, 'aem', 'เอ', 'sales');
    expect(Object.keys(A.e.sales.deals).length).toBeGreaterThan(0);
    await A.e.teamLogout({ wipe: true });
    for (const k of ['sales', 'people', 'customCos', 'dedup']) expect(await A.store.get(k)).toBe(null);
    expect(pref<TeamCfg>(A, PREF.team)).toMatchObject({ url: URL, seq: 0, seeded: true, mode: 'accounts' });
    expect(pref(A, PREF.wipe)).toBeTruthy();

    // the page reloads after a wipe: a new engine on the same browser
    const A2 = mk('A', A.store);
    await A2.e.teamOpen(URL);
    const n = rows().length;
    await A2.e.teamLogin('aem', 'aem-pass-123', true);
    await settle(A2);
    expect(A2.net.sent).not.toContain('push');
    expect(rows().length).toBe(n);
    expect(Object.keys(A2.e.sales.deals).length).toBeGreaterThan(0);
  });
});

describe('signing out', () => {
  it('a wipe keeps a document whose file is not uploaded yet (the dialog counts it), and the next sign-in uploads it', async () => {
    const L = await lead();
    const d = L.e.addDeal({ client: 'บริษัท ทดสอบ จำกัด' });
    await settle(L);
    const A = await member(L, 'aem', 'เอ', 'sales', 'X', undefined, false); // a shared computer: not remembered
    A.net.files = 'fail'; // the upload fails (or is still running); the record reaches the team
    const doc = await A.e.attachDoc(d.id, pdf('q.pdf'), quote);
    await settle(A);
    const k = d.id + '/' + doc.id;
    expect(rows('ddoc/' + k)).toHaveLength(1);
    expect(A.e.teamPendingN).toBe(0);
    expect(A.e.docsUnsent).toBe(1);
    await A.e.teamLogout({ wipe: true });
    expect(await A.store.get('sales')).toBe(null);
    expect(await A.store.get('docblob:' + doc.id)).toBeTruthy();

    // the page reloads after the wipe; the same person signs in again, and the upload works now
    const A2 = mk('X', A.store);
    await A2.e.teamOpen(URL);
    await A2.e.teamLogin('aem', 'aem-pass-123', false);
    await settle(A2);
    await A2.e.uploadDocs();
    await settle(A2, L);
    expect(A2.net.sent).toContain('file:upload');
    expect((rows('ddoc/' + k).at(-1)?.v as DealDoc).fileId).toBeTruthy();
    expect((await L.e.docBlob(L.e.sales.docs[k])).size).toBeGreaterThan(0);
  });
});

describe('what a team-code browser queued, sent by an account', () => {
  it('a deal deleted with the team code, taken over by a sales account: neither it nor its notes, documents or file are deleted', async () => {
    sim = createGasSim({ teamKey: KEY, kdfIter: 1000 });
    sim.setup();
    const A = mk('A');
    at('A', () => prefs.set(PREF.me, 'เอ'));
    expect(await A.e.teamConnect(URL, KEY)).toBe(true);
    const d = A.e.addDeal({ client: 'บริษัท ทดสอบ จำกัด' });
    A.e.setStep(d.id, 'PROPOSAL', { d: '2026-10-01', n: 'นัดคุยแล้ว' });
    const doc = await A.e.attachDoc(d.id, pdf('qt.pdf'), quote);
    await settle(A);
    await A.e.uploadDocs();
    await settle(A);
    const k = d.id + '/' + doc.id, fileId = A.e.sales.docs[k].fileId;
    expect(fileId).toBeTruthy();
    // deleted offline with the team code (allowed then): its Drive file waits to be trashed
    A.net.offline = true;
    A.e.deleteDeal(d.id);
    await stored(A);
    await ticks();
    expect(await A.store.get('docDelQueue')).toEqual([fileId]);

    // the lead turns accounts on and makes A a sales account
    const L = mk('L');
    expect(await L.e.teamConnect(URL, KEY)).toBe(true);
    L.e.teamBeginSetup();
    await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หัวหน้า', 'lead-pass-123');
    const { temp } = await L.e.adminCreate({ u: 'aem', name: 'เอ', role: 'sales' });
    A.net.offline = false;
    await A.e.teamSyncNow();
    expect(A.e.auth).toBe('login');
    await A.e.teamLogin('aem', temp, true);
    await A.e.teamChangePassword('', 'aem-pass-123');
    await settle(A);
    await A.e.uploadDocs();
    await settle(A, L);
    for (const x of ['deal/' + d.id, `dstep/${d.id}/PROPOSAL`, 'ddoc/' + k]) expect(rows(x).map((r) => r.del)).not.toContain(true);
    for (const t of [A, L]) {
      expect(t.e.sales.deals[d.id]).toBeTruthy();
      expect(t.e.sales.steps[d.id + '/PROPOSAL']?.n).toBe('นัดคุยแล้ว');
      expect(t.e.sales.docs[k]?.fileId).toBe(fileId);
    }
    expect(Object.values(A.e.sales.log).some((x) => x.deal === d.id && x.action === 'ลบลูกค้า')).toBe(false);
    expect(A.net.sent).not.toContain('file:delfile');
    expect(sim.drive.list().find((f) => f.id === fileId)?.trashed).toBe(false);
    expect(A.e.teamPendingN).toBe(0);
    expect(A.e.teamNote).toMatch(/แก้ไม่ได้/);
  });

  it('a document attached with the team code under another name (or none) is uploaded after signing in', async () => {
    sim = createGasSim({ teamKey: KEY, kdfIter: 1000 });
    sim.setup();
    const A = mk('A'); // "ฉันคือ" never chosen here
    expect(await A.e.teamConnect(URL, KEY)).toBe(true);
    const d = A.e.addDeal({ client: 'บริษัท ทดสอบ จำกัด' });
    await settle(A);
    A.net.offline = true;
    const doc = await A.e.attachDoc(d.id, pdf('qt.pdf'), quote);
    await stored(A);
    expect(doc.by).toBe('');
    const L = mk('L');
    expect(await L.e.teamConnect(URL, KEY)).toBe(true);
    L.e.teamBeginSetup();
    await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หัวหน้า', 'lead-pass-123');
    const { temp } = await L.e.adminCreate({ u: 'aem', name: 'เอ', role: 'sales' });
    A.net.offline = false;
    await A.e.teamSyncNow();
    await A.e.teamLogin('aem', temp, true);
    await A.e.teamChangePassword('', 'aem-pass-123');
    await settle(A);
    await A.e.uploadDocs();
    await settle(A);
    expect(A.net.sent).toContain('file:upload');
    expect((rows(`ddoc/${d.id}/${doc.id}`).at(-1)?.v as DealDoc).fileId).toBeTruthy();
  });

  it('edits an older app tab queues with the team code after the sign-in are sent by the account', async () => {
    const L = await lead();
    const store = memoryStore();
    const A = await member(L, 'aem', 'เอ', 'sales', 'X', store);
    const id = company(A);
    await store.update<SyncOp[]>(pendKey(URL), (cur) => [...(cur || []), { id: 'old-tab-1', t: Date.now(), k: 'watch/' + id, v: 1, by: '' }]);
    await settle(A);
    expect(rows('watch/' + id)).toEqual([expect.objectContaining({ v: 1, by: 'เอ' })]);
    expect(await queue(A, pendKey(URL))).toEqual([]);
    expect(A.e.crm.watch).toContain(id);
  });
});

describe('sessions in more than one tab', () => {
  it('changing the password while a sync is on the wire keeps the new session', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    L.e.dispose();
    const held = gate();
    let n = 0;
    A.net.hold = async (b) => {
      if (b.action === 'pull' && !n++) await held.p;
    };
    const round = A.e.teamSyncNow();
    await ticks();
    expect(n).toBe(1);
    await A.e.teamChangePassword('aem-pass-123', 'aem-new-pass-456');
    held.open(); // the pull reaches the script after the change: session_expired, for the old token
    await round;
    await ticks();
    expect(A.e.auth).toBe('');
    expect(A.e.session?.tok).toBeTruthy();
    expect(pref<Session>(A, PREF.session)?.tok).toBe(A.e.session?.tok);
    await advance(A, 100); // and runs again with the new one
    await ticks();
    expect(A.e.team.status).toBe('ok');
  });

  it('another tab\'s request with the old token does not sign out the tab that changed the password', async () => {
    const L = await lead();
    L.e.dispose();
    const store = memoryStore();
    const T1 = await member(L, 'aem', 'เอ', 'sales', 'X', store);
    const T2 = mk('X', store);
    await T2.e.teamOpen(URL);
    event(T2, PREF.session);
    await settle(T2);
    expect(T2.e.auth).toBe('');
    const held = gate();
    let n = 0;
    T2.net.hold = async (b) => {
      if (b.action === 'pull' && !n++) await held.p;
    };
    const round = T2.e.teamSyncNow();
    await ticks();
    await T1.e.teamChangePassword('aem-pass-123', 'aem-new-pass-456');
    held.open(); // before T2 hears of the new token
    await round;
    await ticks();
    const tok = T1.e.session?.tok;
    expect(pref<Session>(T1, PREF.session)?.tok).toBe(tok);
    event(T1, PREF.session);
    expect([T1.e.auth, T2.e.auth]).toEqual(['', '']);
    await advance(T2, 100);
    await ticks();
    expect([T2.e.session?.tok, T2.e.team.status]).toEqual([tok, 'ok']);
  });

  it('a tab loading while another signs out follows the sign-out instead of syncing as that account', async () => {
    const L = await lead();
    L.e.dispose();
    const store = memoryStore();
    const T1 = await member(L, 'aem', 'เอ', 'sales', 'X', store);
    const data = gate();
    const T2 = mk('X', store);
    const p = pageLoad(T2, data.p); // reads the session, then waits for the dataset
    await ticks();
    await T1.e.teamLogout(); // T2 has no storage listener yet
    data.open();
    await loaded(T2, p);
    expect([T2.e.auth, T2.e.me()]).toEqual(['login', '']);
    const n = T2.net.sent.length;
    await advance(T2, 31000);
    expect(T2.net.sent.slice(n).filter((x) => x === 'pull' || x === 'push')).toEqual([]);
  });

  it('a tab back from the back/forward cache, or that missed the event, follows a sign-out; its token renewal does not sign anyone in', async () => {
    const L = await lead();
    L.e.dispose();
    const store = memoryStore();
    const T1 = await member(L, 'aem', 'เอ', 'sales', 'X', store);
    const follow = async () => {
      const T = mk('X', store);
      await T.e.teamOpen(URL);
      event(T, PREF.session);
      await settle(T);
      expect(T.e.me()).toBe('เอ');
      return T;
    };
    const T2 = await follow();
    await T1.e.teamLogout(); // T2 is in the back/forward cache: no storage event
    (T2.e as unknown as { teamPageShow: (e: { persisted: boolean }) => void }).teamPageShow({ persisted: true });
    expect([T2.e.auth, T2.e.me()]).toEqual(['login', '']);

    // T3 misses the sign-out during a request whose reply renews the token (under 15 days left)
    await T1.e.teamLogin('aem', 'aem-pass-123', true);
    const T3 = await follow();
    later(16 * 86400);
    const held = gate();
    let n = 0;
    T3.net.hold = async (b) => {
      if (b.action === 'pull' && !n++) await held.p;
    };
    const round = T3.e.teamSyncNow();
    await ticks();
    await T1.e.teamLogout();
    held.open();
    await round;
    expect(pref(T1, PREF.session)).toBe(null);
    expect(T3.e.auth).toBe('login');
    event(T1, PREF.session);
    expect(T1.e.auth).toBe('login');
  });

  it('the invite link opened while the page loads, on a browser signed in to the team: no sign-in screen, and it syncs', async () => {
    const L = await lead();
    const store = memoryStore();
    const M = await member(L, 'aem', 'เอ', 'sales', 'X', store);
    M.e.dispose();
    const data = gate();
    const T = mk('X', store);
    const p = pageLoad(T, data.p);
    const opened = T.e.teamOpen(URL); // the app runs load() and the invite link's handler together
    await ticks();
    data.open();
    await loaded(T, p);
    expect(await opened).toBe('accounts');
    expect(T.e.auth).toBe('');
    const id = company(L, 3);
    L.e.toggleWatch(id);
    await settle(L);
    L.e.dispose();
    await advance(T, 31000);
    await ticks();
    expect(T.e.crm.watch).toContain(id);
  });

  it('back to the app from a sign-in screen: syncing runs again, or the expired session asks to sign in', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    const priv = A.e as unknown as { stopTeam: () => void; auth: string; teamTimer: unknown };
    priv.stopTeam(); // a sign-in screen that came up before this page started syncing
    priv.auth = 'login';
    const n = A.net.sent.length;
    A.e.teamCancelAuth();
    await ticks();
    expect(A.e.auth).toBe('');
    expect(priv.teamTimer).not.toBe(null);
    expect(A.net.sent.slice(n)).toContain('pull');

    await L.e.adminKick('aem');
    await A.e.teamSyncNow();
    expect(A.e.auth).toBe('expired');
    expect(await A.e.teamOpen(URL)).toBe('accounts');
    expect(A.e.auth).toBe('login');
    A.e.teamCancelAuth();
    expect(A.e.auth).toBe('expired');
  });
});

describe('the older script pasted back', () => {
  /** A signed in, with an un-star of a company the lead starred still queued. */
  async function unsent() {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    const id = company(L, 4);
    L.e.toggleWatch(id);
    await settle(L);
    await settle(A);
    A.net.offline = true;
    A.e.toggleWatch(id);
    await stored(A);
    return { L, A, id };
  }

  it('a failed check right after: syncing goes on and asks again, then goes back to the team code; polling resumes with it', async () => {
    const { L, A, id } = await unsent();
    L.e.dispose();
    rollback();
    A.net.offline = false;
    let fail = true;
    A.net.hold = (b) => {
      if (b.action === 'hello' && fail) {
        fail = false;
        throw new TypeError('Failed to fetch');
      }
    };
    await A.e.teamSyncNow();
    await ticks();
    expect([A.e.auth, A.e.team.status]).toEqual(['', 'error']);
    await A.e.teamSyncNow();
    await ticks();
    expect(A.e.teamNeedKey).toBe(true);
    expect((await queue(A, pendKey(URL))).map((o) => [o.k, !!o.del, o.by])).toEqual([['watch/' + id, true, 'เอ']]);
    expect(await A.e.teamSetKey(KEY)).toBe(true);
    expect(codeRows('watch/' + id).at(-1)).toMatchObject({ del: true, by: 'เอ' });
    // a teammate's change arrives with the next poll
    sim.post({ action: 'push', key: KEY, ops: [{ k: 'team/คนใหม่', v: 1, by: 'หัวหน้า' }] });
    await advance(A, 31000);
    await ticks();
    expect(A.e.crm.team).toContain('คนใหม่');
  });

  it('signed out meanwhile: signing in goes back to the team code, and the account\'s unsent edits are sent', async () => {
    const { A, id } = await unsent();
    await A.e.teamLogout();
    A.net.offline = false;
    rollback();
    (A.e as unknown as { caps: unknown }).caps = null; // a later page load
    await A.e.teamLogin('aem', 'aem-pass-123', true);
    expect([A.e.auth, A.e.teamNeedKey, A.e.me()]).toEqual(['', true, 'เอ']);
    expect(await queue(A, pendKey(URL) + '#aem')).toEqual([]);
    expect(await A.e.teamSetKey(KEY)).toBe(true);
    expect(codeRows('watch/' + id).at(-1)).toMatchObject({ del: true, by: 'เอ' });
  });

  it('the session ended meanwhile: signing in again goes back to the team code', async () => {
    const { L, A, id } = await unsent();
    A.net.offline = false;
    await L.e.adminKick('aem');
    await A.e.teamSyncNow();
    expect([A.e.auth, A.e.teamPendingN]).toEqual(['expired', 1]);
    rollback();
    await A.e.teamLogin('aem', 'aem-pass-123', true); // the expired dialog (the script's answer from before is cached)
    expect([A.e.auth, A.e.teamNeedKey, A.e.teamPendingN]).toEqual(['', true, 1]);
    expect(await A.e.teamSetKey(KEY)).toBe(true);
    expect(codeRows('watch/' + id).at(-1)).toMatchObject({ del: true, by: 'เอ' });
  });

  it('a page load on the sign-in screen finds out, and goes back to the team code', async () => {
    const { A } = await unsent();
    await A.e.teamLogout();
    A.net.offline = false;
    rollback();
    const A2 = mk(A.browser, A.store);
    await loaded(A2, pageLoad(A2));
    await ticks();
    expect([A2.e.auth, A2.e.teamNeedKey, A2.e.teamPendingN]).toEqual(['', true, 1]);
  });

  it('connecting with the team code again takes over the accounts\' unsent edits', async () => {
    const { A, id } = await unsent();
    await A.e.teamLogout();
    A.net.offline = false;
    rollback();
    A.e.teamForget();
    expect(await A.e.teamOpen(URL)).toBe('legacy');
    expect(await A.e.teamConnect(URL, KEY)).toBe(true);
    await settle(A);
    expect(codeRows('watch/' + id).at(-1)).toMatchObject({ del: true, by: 'เอ' });
    expect(await queue(A, pendKey(URL) + '#aem')).toEqual([]);
    expect(A.e.crm.watch).not.toContain(id);
  });
});

describe('a team-code team', () => {
  it('the team card learns that the lead updated the script, without a reload', async () => {
    sim = createGasSim({ teamKey: KEY, code: V2 });
    const A = mk('A');
    expect(await A.e.teamConnect(URL, KEY)).toBe(true);
    await ticks();
    expect(A.e.caps).toMatchObject({ v: 2 });
    // the lead pastes the new script (keeping TEAM_KEY), runs setup and deploys a new version
    sim = createGasSim({ teamKey: KEY, kdfIter: 1000 });
    sim.setup();
    await advance(A, 31000);
    await ticks();
    expect(A.e.caps).toMatchObject({ v: 2 }); // not asked at every poll
    vi.setSystemTime(Date.now() + 10 * 60000);
    await advance(A, 31000);
    await ticks();
    expect(A.e.caps).toMatchObject({ v: 3, mode: 'legacy' });
  });
});

describe('one browser, two people', () => {
  it('the next person does not see, or send, what the previous one made and has not sent', async () => {
    const L = await lead();
    const store = memoryStore();
    const A = await member(L, 'aem', 'เอ', 'sales', 'X', store);
    A.net.offline = true;
    const d = A.e.addDeal({ client: 'ลูกค้าของเอ (ยังไม่ส่ง)' });
    await stored(A);
    await A.e.teamLogout(); // remembered: the team data stays in this browser
    A.net.offline = false;
    const { temp } = await L.e.adminCreate({ u: 'bee', name: 'บี', role: 'sales' });
    await A.e.teamLogin('bee', temp, true);
    await A.e.teamChangePassword('', 'bee-pass-123');
    await settle(A);
    expect(A.e.me()).toBe('บี');
    expect(A.e.sales.deals[d.id]).toBeUndefined();
    expect((await store.get<SalesState>('sales'))?.deals[d.id]).toBeUndefined();
    expect(rows('deal/' + d.id)).toEqual([]);
    expect((await queue(A, pendKey(URL) + '#aem')).map((o) => o.k)).toContain('deal/' + d.id);

    // it waits for A, and goes out as A made it
    await A.e.teamLogout();
    await A.e.teamLogin('aem', 'aem-pass-123', true);
    await settle(A);
    expect(rows('deal/' + d.id)).toEqual([expect.objectContaining({ by: 'เอ' })]);
    expect(A.e.sales.deals[d.id]?.client).toBe('ลูกค้าของเอ (ยังไม่ส่ง)');
  });
});

describe('viewers and new deals', () => {
  it('a viewer cannot send starred companies to the Sales Tracker, and a deal made here anyway goes away', async () => {
    const L = await lead();
    const id = company(L, 2);
    L.e.toggleWatch(id);
    await settle(L);
    const V = await member(L, 'vee', 'วี', 'viewer');
    expect(V.e.addDealsFromCompanies([id], { year: '2569' })).toEqual({ added: 0, skipped: 0 });
    const d = V.e.addDeal({ gid: id, year: '2569' });
    await settle(V);
    expect(V.e.sales.deals[d.id]).toBeUndefined();
    expect(rows('deal/' + d.id)).toEqual([]);
    expect(V.net.sent).not.toContain('push');
  });

  it('dropping what a sales account made offline before it was made a viewer removes its new deal here', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    A.net.offline = true;
    const d = A.e.addDeal({ client: 'บริษัท ใหม่ จำกัด' });
    await stored(A);
    await L.e.adminUpdate('aem', { role: 'viewer' });
    A.net.offline = false;
    await settle(A);
    expect(A.e.role()).toBe('viewer');
    await A.e.teamDropUnsent();
    await settle(A);
    expect(A.e.sales.deals[d.id]).toBeUndefined();
    expect(rows('deal/' + d.id)).toEqual([]);
  });
});
