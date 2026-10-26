/**
 * The review queue shared by a team, through the real team script in the simulator (team-sync/Code.gs).
 * One sales account pulls the feed: the rows wait in the queue for everyone. A second browser sees them without
 * pulling; a viewer reads them but cannot change them (the engine and the script both refuse). The sales account
 * approves and rejects: the approved companies and certificates appear in every browser, a rejected row stays out
 * and is not pulled again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import type { CertFields } from './registryXlsx';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 60000 });
const URL = 'https://script.google.com/macros/s/a/exec';
const FEED = 'https://script.google.com/macros/s/TEST/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});
const T0 = new Date('2026-10-26T03:00:00Z');
const TODAY = '2026-10-26';
let base: Dataset, R: RoundRaw[], sim: GasSim;
let feedRows: unknown[] = [];
let feedHits = 0;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 60);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
  vi.stubGlobal('fetch', vi.fn(async () => {
    feedHits++;
    return new Response(JSON.stringify({ ok: true, rows: feedRows, webTotal: feedRows.length }));
  }));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
interface Tab { e: GccEngine; browser: string }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  vi.setSystemTime(T0);
});
/** One browser: its own local store, talking to the simulated script. */
function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = TODAY;
  raw.store = memoryStore();
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => sim.post(body) as Record<string, unknown>;
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
async function lead() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const L = mk('L');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
  return L;
}
async function member(L: Tab, u: string, name: string, role: Role) {
  const { temp } = await L.e.adminCreate({ u, name, role: 'viewer' });
  if (role !== 'viewer') await L.e.adminUpdate(u, { role });
  const M = mk(u);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  await settle(M);
  return M;
}
const rids = (rows: { rid: string }[]) => rows.map((r) => r.rid).sort();

const ORG = 'บริษัท คิวทดสอบ จำกัด (สำนักงานใหญ่)';
const feedRow = (o: Record<string, unknown>) => ({
  id: '', cert: '', act: 'ผลิตอาหาร', org: ORG, branch: 'สำนักงานใหญ่', prov: 'กรุงเทพฯ', addr: '5 ซอย 1 บางกะปิ กรุงเทพฯ 10240', changwat: 'กรุงเทพฯ', zip: '10240',
  ind: 'อาหาร', size: 'SME', apBE: '21/10/2569', exBE: '20/10/2570', ap: '', ex: '', fy: 'FY27', s1: '10%', s2: '20%', s3: '70%', note: '', flags: '', ...o,
});
const Q1 = feedRow({ id: '77001', cert: 'TGO CFO FY27-771' });
const Q2 = feedRow({ id: '77,002', cert: 'TGO CFO FY27-772' }); // the same company, an id with a comma
const Q3 = feedRow({ id: '77003', cert: 'TGO CFO FY27-773', org: 'บริษัท คิวอีกแห่ง จำกัด', addr: '9 ถนนพระราม 4 กรุงเทพฯ 10500' });
const Q4 = feedRow({ id: '77004', cert: 'TGO CFO FY27-774', org: 'บริษัท คิวถูกปฏิเสธ จำกัด', addr: '3 ถนนรัชดา กรุงเทพฯ 10310' });

describe('team mode: the review queue is one shared list', () => {
  it('a teammate sees the pulled rows without pulling; a viewer reads but cannot approve; the approver makes the registry rows for everyone', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    const V = await member(L, 'vee', 'วี', 'viewer');
    for (const t of [L, A, V]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [Q1, Q2, Q3, Q4];
    await L.e.runSync(false);
    expect(L.e.sy.status).toBe('ready');
    expect(rids(L.e.tgoRows('p'))).toEqual(['77001', '77002', '77003', '77004']);
    await settle(L, A, V);
    expect(feedHits).toBe(1); // A and V did not fetch the feed
    for (const t of [A, V]) expect(rids(t.e.tgoRows('p'))).toEqual(['77001', '77002', '77003', '77004']);

    // a viewer cannot pull, approve or reject: the engine refuses before anything is sent
    await V.e.runSync(false);
    expect(V.e.sy.status).toBe('error');
    expect(feedHits).toBe(1);
    expect(V.e.approveTgo(['77001'])).toBe(0);
    expect(V.e.rejectTgo(['77004'])).toBe(0);
    expect(rids(V.e.tgoRows('p'))).toHaveLength(4);
    // and the script refuses a viewer's write made by hand (a push from an account with no write capability)
    const denied = sim.post({ action: 'push', cv: 5, tok: V.e.session!.tok, ops: [{ id: 'hand1', t: 1, k: 'tgo/77001', v: { st: 'a' } }] });
    expect(denied).toMatchObject({ ok: false, error: 'forbidden' }); // a viewer has no write capability: the whole push is refused
    expect(rids(L.e.tgoRows('p'))).toHaveLength(4);

    // the sales account accepts two rows of one company and rejects the fourth; the third stays pending
    expect(A.e.approveTgo(['77001', '77002'])).toBe(2);
    expect(A.e.rejectTgo(['77004'])).toBe(1);
    await settle(A, L, V, A);
    for (const t of [L, A, V]) {
      expect(rids(t.e.tgoRows('a'))).toEqual(['77001', '77002']);
      expect(rids(t.e.tgoRows('r'))).toEqual(['77004']);
      expect(rids(t.e.tgoRows('p'))).toEqual(['77003']);
      const cos = t.e.B.companies.filter((c) => c.name === ORG);
      expect(cos).toHaveLength(1);
      const certs = t.e.B.certs.filter((c) => c.cert === Q1.cert || c.cert === Q2.cert);
      expect(certs.map((c) => c.gid)).toEqual([cos[0].id, cos[0].id]);
      expect(t.e.B.companies.some((c) => c.name === 'บริษัท คิวถูกปฏิเสธ จำกัด')).toBe(false);
    }

    // a later pull by anyone does not bring back a rejected row
    await L.e.runSync(false);
    expect(rids(L.e.tgoRows('p'))).toEqual(['77003']);
    expect(rids(L.e.tgoRows('r'))).toEqual(['77004']);
    expect(V.e.rejectTgo(['77003'])).toBe(0);
  });
});

/** The team's sheet rows (the simulated script's sync sheet). */
const teamRows = (): unknown[][] => sim.sheet()?.rows ?? [];
const LONG_ORG = 'บริษัท ทดสอบชื่อองค์กรที่ยาวมากๆ ยาวมากๆ ยาวมากๆ ยาวมากๆ จำกัด (มหาชน)';
describe('team mode: a browser that has not synced cannot undo a teammate\'s decision', () => {
  it('a pull by a browser behind the team keeps a rejection and an acceptance made since', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [Q1, Q4];
    await L.e.runSync(false);
    expect(L.e.approveTgo(['77001'])).toBe(1);
    expect(L.e.rejectTgo(['77004'])).toBe(1);
    await settle(L); // the team holds a and r; A has not synced since before them
    // A pulls the same feed: both certificates look new to it, but they are the team's decided rows
    await A.e.runSync(false);
    await settle(A, L);
    for (const t of [L, A]) {
      expect(rids(t.e.tgoRows('a'))).toEqual(['77001']);
      expect(rids(t.e.tgoRows('r'))).toEqual(['77004']);
      expect(rids(t.e.tgoRows('p'))).toEqual([]);
    }
    const last77004 = teamRows().filter((r: unknown[]) => r[1] === 'tgo/77004').pop();
    expect(String(last77004?.[2])).toContain('"st":"r"');
  });

  it('filling in details on a stale waiting row does not put an accepted certificate back to waiting', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [{ ...Q1, addr: '', ind: '', size: '', zip: '', changwat: '' }];
    await L.e.runSync(false);
    await settle(L, A); // A has the row without its details
    expect(rids(A.e.tgoRows('p'))).toEqual(['77001']);
    expect(L.e.approveTgo(['77001'])).toBe(1);
    await settle(L); // the team accepted it; A still shows it waiting
    feedRows = [Q1]; // the feed now has the details: A fills them in on its stale copy
    await A.e.runSync(false);
    await settle(A, L);
    for (const t of [L, A]) {
      expect(rids(t.e.tgoRows('a'))).toEqual(['77001']);
      expect(rids(t.e.tgoRows('p'))).toEqual([]);
    }
    expect(A.e.tgoRows('a')[0].rec.addr).toBe(Q1.addr);
  });

  it('a stale approval of a certificate the team rejected neither accepts it nor leaves a company', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [Q4];
    await L.e.runSync(false);
    await settle(L, A); // both browsers hold the waiting row
    expect(L.e.rejectTgo(['77004'])).toBe(1);
    await settle(L); // the team rejected it; A has not synced yet
    expect(A.e.approveTgo(['77004'])).toBe(1);
    await settle(A, L);
    for (const t of [L, A]) {
      expect(rids(t.e.tgoRows('r'))).toEqual(['77004']);
      expect(t.e.tgoRows('a')).toEqual([]);
      expect(t.e.B.companies.some((c) => c.name === Q4.org)).toBe(false);
    }
    expect(teamRows().some((r: unknown[]) => String(r[1]).indexOf('cust/') === 0 && String(r[2]).indexOf(Q4.org) >= 0)).toBe(false);
  });

  it('a certificate with no TGO id and a long organisation name reaches the team under a short key', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [feedRow({ id: '', cert: 'TGO CFO FY27-790', org: LONG_ORG, addr: '1 ถนนสีลม กรุงเทพฯ 10500' })];
    expect(encodeURIComponent(LONG_ORG.replace(/\s+/g, '').toUpperCase()).length).toBeGreaterThan(500);
    const hits = feedHits;
    await L.e.runSync(false);
    await settle(L, A);
    expect(rids(A.e.tgoRows('p'))).toHaveLength(1); // A never fetched the feed: the row came from the team
    expect(feedHits - hits).toBe(1);
    const keys = teamRows().map((r: unknown[]) => String(r[1])).filter((k: string) => k.indexOf('tgo/') === 0);
    expect(keys).toHaveLength(1);
    expect((keys[0] ?? '').length).toBeLessThan(40);
    // a key the script cannot store is refused by name, never silently dropped
    const big = 'tgo/' + 'x'.repeat(600);
    const out = sim.post({ action: 'push', cv: 5, tok: L.e.session!.tok, ops: [{ id: 'big1', t: 1, k: big, v: { st: 'p' } }] });
    expect(out).toMatchObject({ ok: true, rejected: [big] });
  });
});

describe('team mode: a removal cannot take away a row the team decided', () => {
  it('the script refuses a deletion of an accepted row from a browser that still sees it as waiting, and returns the row', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [Q1];
    await L.e.runSync(false);
    await settle(L, A); // A holds the row as waiting
    expect(L.e.approveTgo(['77001'])).toBe(1);
    await settle(L); // the team accepted it; A has not synced since
    // A removes its waiting copy (what a revert of its save sends): the script refuses it and reports the row as it stands
    const out = sim.post({ action: 'push', cv: 5, tok: A.e.session!.tok, ops: [{ id: 'del77001', t: 1, k: 'tgo/77001', del: true }] });
    expect(out).toMatchObject({ ok: true, n: 0, rows: [{ k: 'tgo/77001', del: false, v: { st: 'a' } }] });
    const last = teamRows().filter((r: unknown[]) => r[1] === 'tgo/77001').pop();
    expect(last?.[3]).toBe('0');
    expect(String(last?.[2])).toContain('"st":"a"');
    await settle(A, L);
    for (const t of [L, A]) expect(rids(t.e.tgoRows('a'))).toEqual(['77001']);
  });

  it('a revert of a sheet save keeps a row the team accepted since, and the result says so', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    // the lead saves a sheet with a new certificate (typed web id 77101): it waits in the queue for the team
    const f: CertFields = {
      cert: 'TGO CFO FY27-781', org: 'บริษัท ชีตทดสอบ จำกัด', branch: 'สำนักงานใหญ่', act: 'ผลิตอาหาร', addr: '1 ถนนทดสอบ กรุงเทพฯ 10110', zip: '10110',
      prov: 'กรุงเทพมหานคร', ind: 'อาหาร', size: 'SME', ap: '2026-02-01', ex: '2027-01-31', s1: 0.6, s2: 0.3, s3: 0.1, fy: 'FY27', note: '', webId: '77101',
    };
    expect(await L.e.applyCertRows([{ rowNo: 2, f, errors: [] }], 'a.xlsx')).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    await settle(L, A);
    expect(rids(A.e.tgoRows('p'))).toEqual(['77101']);
    expect(A.e.approveTgo(['77101'])).toBe(1);
    await settle(A); // the team accepted it; L has not synced since its save
    // L reverts its save: its copy still says waiting, so the script is asked to remove a row the team has accepted
    const feedStub = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(JSON.stringify(json(String(u).split('/').pop()!)))));
    try {
      await L.e.revertUpload();
    } finally {
      vi.stubGlobal('fetch', feedStub);
    }
    expect(L.e.tgoRows('p')).toEqual([]);
    expect(rids(L.e.tgoRows('a'))).toEqual(['77101']);
    expect(L.e.B.certs.some((c) => c.cert === f.cert)).toBe(true);
    expect(L.e.up.msg).toContain('คงไว้ 1 ใบ');
    expect(L.e.up.msg).toContain('ลบจากทีมไม่ได้');
    expect(L.e.up.msg).not.toContain('ลบใบที่รอตรวจจากการบันทึกชีต 1 ใบ');
    await settle(L, A);
    for (const t of [L, A]) expect(rids(t.e.tgoRows('a'))).toEqual(['77101']);
  });

  it('a waiting row one browser wrote is removed by a revert from the lead\'s other browser, on the server and locally', async () => {
    const L = await lead();
    // the lead's second browser (the same account) logs in before any sheet is saved
    const L2 = mk('L2');
    expect(await L2.e.teamOpen(URL)).toBe('accounts');
    await L2.e.teamLogin('lead', 'lead-pass-123', true);
    for (const t of [L, L2]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    await settle(L, L2);
    const f: CertFields = {
      cert: 'TGO CFO FY27-782', org: 'บริษัท ชีตลบได้ จำกัด', branch: 'สำนักงานใหญ่', act: 'ผลิตอาหาร', addr: '2 ถนนทดสอบ กรุงเทพฯ 10110', zip: '10110',
      prov: 'กรุงเทพมหานคร', ind: 'อาหาร', size: 'SME', ap: '2026-02-01', ex: '2027-01-31', s1: 0.6, s2: 0.3, s3: 0.1, fy: 'FY27', note: '', webId: '77102',
    };
    // browser L saves a sheet with the certificate: its row waits in the queue, and the team holds it
    expect(await L.e.applyCertRows([{ rowNo: 2, f, errors: [] }], 'b.xlsx')).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    await settle(L);
    // browser L2 saves the same sheet before it has synced: the team's row is live, so its create is refused and L2 takes
    // the team's waiting row as its own. L2's save is the one that reverts it
    expect(await L2.e.applyCertRows([{ rowNo: 2, f, errors: [] }], 'b.xlsx')).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    await settle(L2, L);
    expect(rids(L2.e.tgoRows('p'))).toEqual(['77102']);
    expect(rids(L.e.tgoRows('p'))).toEqual(['77102']);
    // L2 reverts its save: the waiting row goes off this browser and the script stores the removal (it is not refused)
    const feedStub = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(JSON.stringify(json(String(u).split('/').pop()!)))));
    try {
      await L2.e.revertUpload();
    } finally {
      vi.stubGlobal('fetch', feedStub);
    }
    expect(L2.e.tgoRows('p')).toEqual([]);
    expect(L2.e.up.msg).toContain('ลบใบที่รอตรวจจากการบันทึกชีต 1 ใบ');
    expect(L2.e.up.msg).not.toContain('ลบจากทีมไม่ได้');
    const last = teamRows().filter((r: unknown[]) => r[1] === 'tgo/77102').pop();
    expect(last?.[3]).toBe('1');
    expect(last?.[2]).toBe('');
    // the team's other browser drops the row too, and nothing is left waiting anywhere
    await settle(L2, L);
    for (const t of [L, L2]) expect(t.e.tgoRows('p')).toEqual([]);
  });

  it('a stale second approval of a row the team accepted is refused, and the first decider\'s by, at and note stay', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [Q1];
    await L.e.runSync(false);
    await settle(L, A); // A holds the row as waiting
    expect(L.e.approveTgo(['77001'])).toBe(1);
    await settle(L); // the team accepted it: the lead's decision is the stored one
    const first = teamRows().filter((r: unknown[]) => r[1] === 'tgo/77001').pop();
    const firstV = JSON.parse(String(first?.[2]));
    expect(firstV).toMatchObject({ st: 'a', by: 'หมิว' });
    // A has not synced since before the decision: it still sees the row waiting and accepts it too (same st, another decider)
    expect(A.e.approveTgo(['77001'])).toBe(1);
    await settle(A, L);
    const last = teamRows().filter((r: unknown[]) => r[1] === 'tgo/77001').pop();
    expect(last?.[2]).toBe(first?.[2]); // the stored decision is the lead's: nothing was written over it
    expect(last?.[3]).toBe(first?.[3]);
    for (const t of [L, A]) {
      expect(rids(t.e.tgoRows('a'))).toEqual(['77001']);
      expect(t.e.tgoRows('a')[0].rec).toMatchObject({ by: 'หมิว' });
    }
  });

  it('a resend of the same decision, unchanged, is still stored (a retry after a lost reply changes nothing)', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [Q1];
    await L.e.runSync(false);
    await settle(L, A);
    expect(L.e.approveTgo(['77001'])).toBe(1);
    await settle(L);
    const stored = JSON.parse(String(teamRows().filter((r: unknown[]) => r[1] === 'tgo/77001').pop()?.[2]));
    const out = sim.post({ action: 'push', cv: 5, tok: L.e.session!.tok, ops: [{ id: 'retry77001', t: 1, k: 'tgo/77001', v: stored }] });
    expect(out).toMatchObject({ ok: true, n: 1 });
    expect(out).not.toHaveProperty('rows');
  });

  it('a deletion that also carries a value is still a deletion: the script refuses it for an accepted row', async () => {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    for (const t of [L, A]) t.e.saveSync({ feed: FEED, freq: 'off', autoApply: false });
    feedRows = [Q1];
    await L.e.runSync(false);
    await settle(L, A);
    expect(L.e.approveTgo(['77001'])).toBe(1);
    await settle(L);
    // a push that marks the accepted row deleted, and still sends its decided value, is refused like a plain deletion
    const out = sim.post({ action: 'push', cv: 5, tok: A.e.session!.tok, ops: [{ id: 'delv77001', t: 1, k: 'tgo/77001', del: true, v: { st: 'a' } }] });
    expect(out).toMatchObject({ ok: true, n: 0, rows: [{ k: 'tgo/77001', del: false, v: { st: 'a' } }] });
    const last = teamRows().filter((r: unknown[]) => r[1] === 'tgo/77001').pop();
    expect(last?.[3]).toBe('0');
    await settle(A, L);
    for (const t of [L, A]) expect(rids(t.e.tgoRows('a'))).toEqual(['77001']);
  });
});
