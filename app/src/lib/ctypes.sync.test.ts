/**
 * Customer types (ประเภทลูกค้า) on one browser with several tabs, through the real team script
 * (team-sync/Code.gs in the simulator), with the team code: a stale tab moving an answer while another
 * tab's newer answer waits in the shared queue, and an older build's tab (open during an update)
 * sending this build's queued answers late. Answers are kept by time, so the newer one always stands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import type { SyncOp } from './teamSync';
import type { Company, Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/c/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

interface Net { offline: boolean }
type Store = ReturnType<typeof memoryStore>;
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 300);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => vi.useRealTimers());

function mk(name: string, store: Store, net: Net) {
  const e = new GccEngine();
  e.base = structuredClone(base);
  e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  e.ref = '2026-10-06';
  e.store = store;
  (e as unknown as { me: () => string }).me = () => name;
  e.rebuild();
  e.loading = false;
  e.transport = async (_u, body) => {
    if (net.offline) throw new TypeError('Failed to fetch');
    return sim.post(body);
  };
  return e;
}
/** People (separate browsers); `tab: true` = a second tab of the previous person's browser. */
async function team(...spec: { name: string; tab?: boolean }[]) {
  sim = createGasSim({ teamKey: KEY });
  const out: { e: GccEngine; net: Net; store: Store }[] = [];
  let prev: { store: Store; net: Net } | null = null;
  for (const s of spec) {
    const store: Store = s.tab && prev ? prev.store : memoryStore();
    const net: Net = s.tab && prev ? prev.net : { offline: false };
    out.push({ e: mk(s.name, store, net), net, store });
    prev = { store, net };
  }
  for (const x of out) expect(await x.e.teamConnect(URL, KEY)).toBe(true);
  await settle(...out.map((x) => x.e));
  return out;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...es: GccEngine[]) {
  for (let i = 0; i < 3; i++)
    for (const e of es) {
      await e.teamSyncNow();
      await tick();
    }
}
/** The browser's queue written (every tab of it shares one). */
const stored = (e: GccEngine) => (e as unknown as { pq: Promise<unknown> }).pq;
const later = (s: number) => vi.setSystemTime(Date.now() + s * 1000);
/** The sheet's last row for a record. */
function sheet(k: string) {
  const rows = (sim.post({ action: 'pull', key: KEY, since: 0 }) as { rows: { k: string; v: unknown; del: boolean }[] }).rows.filter((x) => x.k === k);
  return rows[rows.length - 1];
}
const firstCo = (e: GccEngine): Company => e.B.companies.find((x) => x.id < 900000 && x.ids.length === 1)!;

describe('two tabs of one browser', () => {
  it('a stale tab links a free-text deal after the other tab said "no" on it: the newer "no" is what everyone gets', async () => {
    const [{ e: T1, net }, { e: T2 }, { e: B }] = await team({ name: 'A' }, { name: 'A', tab: true }, { name: 'B' });
    const c = firstCo(T1);
    const d = T1.addDeal({ client: 'ลูกค้าสองแท็บ', year: '2569' });
    T1.setType(d, 'cfo', 'y');
    await settle(T1, T2, B);
    expect(T2.typesOf(T2.sales.deals[d.id])).toEqual(['cfo']);
    net.offline = true; // the browser (both tabs) offline
    later(30);
    T1.setType(T1.sales.deals[d.id], 'cfo', 'n'); // newer, waiting in the shared queue
    await stored(T1);
    later(30);
    T2.updateDeal(d.id, { gid: c.id }); // T2 has not seen it: moves the older "yes"
    await stored(T2);
    net.offline = false;
    await settle(T1, T2, B, T1, T2, B);
    for (const e of [T1, T2, B]) {
      expect(e.sales.deals[d.id].gid).toBe(c.id);
      expect(e.typesOf(c)).toEqual([]);
      expect(e.ctagsOf(c).get('cfo')).toMatchObject({ s: 'n' });
    }
  });

  it('a stale tab moves an older "yes" onto the company where the other tab just said "no": the "no" stays', async () => {
    const [{ e: T1, net }, { e: T2 }, { e: B }] = await team({ name: 'A' }, { name: 'A', tab: true }, { name: 'B' });
    const c = firstCo(T1);
    const d = T1.addDeal({ client: 'ลูกค้าสองแท็บสอง', year: '2569' });
    T1.setType(d, 'vvb', 'y');
    await settle(T1, T2, B);
    net.offline = true;
    later(30);
    T1.setType(c, 'vvb', 'n');
    await stored(T1);
    later(30);
    T2.updateDeal(d.id, { gid: c.id });
    await stored(T2);
    net.offline = false;
    await settle(T1, T2, B, T1, T2, B);
    expect(sheet(`ctag/${c.id}/vvb`)).toMatchObject({ v: { s: 'n' } });
    for (const e of [T1, T2, B]) expect(e.ctagsOf(c).get('vvb')).toMatchObject({ s: 'n' });
  });
});

describe('an older build\'s tab on the same browser (during an update)', () => {
  /** What an older build's tab does with the shared queue: sends every op as it is (it knows no
   *  customer types, so nothing is merged) and takes them off the queue. */
  async function oldTabSends(e: GccEngine, store: Store) {
    const x = e as unknown as { qk: (c: unknown) => string; teamCfg: unknown };
    const k = x.qk(x.teamCfg);
    const ops = (await store.get<SyncOp[]>(k)) || [];
    expect(ops.some((o) => o.k.startsWith('ctag/'))).toBe(true);
    sim.post({ action: 'push', key: KEY, ops: ops.map(({ k, v, del, by }) => ({ k, v, del, by })) });
    await store.set(k, []);
  }

  it('it sends a queued answer late, over a teammate\'s newer one: every browser keeps the newer, also one that joins later', async () => {
    const [{ e: N, net, store }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const c = firstCo(N);
    net.offline = true;
    N.setType(c, 'cfo', 'y');
    await stored(N);
    later(60);
    B.setType(c, 'cfo', 'n'); // newer, sent first
    await settle(B);
    net.offline = false;
    await oldTabSends(N, store);
    expect(sheet(`ctag/${c.id}/cfo`)).toMatchObject({ v: { s: 'y' } }); // the late, older answer is the sheet's last row
    await settle(N, B, N, B);
    for (const e of [N, B]) expect(e.ctagsOf(c).get('cfo')).toMatchObject({ s: 'n', by: 'B' });
    const C = mk('C', memoryStore(), { offline: false });
    expect(await C.teamConnect(URL, KEY)).toBe(true);
    await settle(C);
    expect(C.ctagsOf(c).get('cfo')).toMatchObject({ s: 'n', by: 'B' });
  });

  it('it sends a move\'s mark late, over a teammate\'s newer answer on the old key: that answer still counts', async () => {
    const [{ e: N, net, store }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const c = firstCo(N);
    const d = N.addDeal({ client: 'ลูกค้าแท็บเก่า', year: '2569' });
    N.setType(d, 'cfo', 'y');
    await settle(N, B);
    net.offline = true;
    N.updateDeal(d.id, { gid: c.id }); // queued: the deal, the answer on c, the mark on the name
    await stored(N);
    later(60);
    B.setType(B.sales.deals[d.id], 'cfo', 'n'); // B has not seen the link: answers on the name
    await settle(B);
    net.offline = false;
    await oldTabSends(N, store);
    expect(sheet('ctag/n:ลูกค้าแท็บเก่า/cfo')).toMatchObject({ v: { mv: String(c.id) } });
    await settle(N, B, N, B);
    for (const e of [N, B]) {
      expect(e.sales.deals[d.id].gid).toBe(c.id);
      expect(e.typesOf(c)).toEqual([]);
      expect(e.ctagsOf(c).get('cfo')).toMatchObject({ s: 'n', by: 'B' });
    }
  });
});
