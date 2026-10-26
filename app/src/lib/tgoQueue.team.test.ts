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
