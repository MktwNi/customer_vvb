/**
 * Several jobs of one company in a year, told apart by their services (lib/jobs.ts), in the engine, end to end
 * with the real team script (team-sync/Code.gs in the simulator): a send with services (the owner's case: a CFP
 * job beside a CFO job), a send that may repeat a job (skipped unless ticked through, a teammate's send re-checked),
 * เลิกทำ, the services edited item by item by two people, the import keyed by company and service, a backup round
 * trip, and the counts (rows, companies, win rate per job, the work tally). Nothing new is stored: the services are
 * the deal's own list, so the team script is unchanged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { customersOf, jobServices, salesStats, type Deal } from './sales';
import { dupRows, sendState } from './jobs';
import { trackerNote } from './bulk';
import { CV, type SyncOp } from './teamSync';
import type { Company, Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/sv/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const Y = '2569';

const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

const T0 = new Date('2026-10-21T03:00:00Z');
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
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

interface Tab { e: GccEngine; browser: string }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  vi.setSystemTime(T0);
});
function mk(browser: string, name: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-21';
  raw.store = memoryStore();
  (raw as unknown as { me: () => string }).me = () => name;
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
async function team() {
  sim = createGasSim({ teamKey: KEY });
  const A = mk('A', 'เอ'), B = mk('B', 'บี');
  for (const t of [A, B]) expect(await t.e.teamConnect(URL, KEY)).toBe(true);
  return [A, B] as const;
}
const queued = async (t: Tab) => {
  await (t.e as unknown as { pq: Promise<unknown> }).pq;
  return (await t.e.store.get<SyncOp[]>('teamPending:' + URL)) || [];
};
const sheetDeals = () => sim.post({ action: 'pull', key: KEY, since: 0, cv: CV }).rows!.filter((x) => x.k.startsWith('deal/') && !x.del);
/** Registry companies with one name each and no deal yet. */
function companies(t: Tab): Company[] {
  const n = new Map<string, number>();
  t.e.B.companies.forEach((c) => n.set(c.name.trim(), (n.get(c.name.trim()) || 0) + 1));
  return t.e.B.companies.filter((c) => n.get(c.name.trim()) === 1 && !t.e.dealsOf(c.id).length);
}
const jobsOf = (t: Tab, c: Company) => t.e.dealsOf(c.id).filter((d) => d.year === Y).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
const svcs = (t: Tab, c: Company) => jobsOf(t, c).map((d) => jobServices(t.e.sales, d).join('+'));
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms);
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const qt = (docNo: string) => ({ kind: 'quotation' as const, amount: 100000, target: 'forecast' as const, basis: 'total' as const, detected: 100000, docNo, docDate: '2026-10-20', stage: 'QUOTATION' });

describe('a company with a CFO job this year gets a CFP job (the owner\'s case)', () => {
  it('a send with CFP adds a second job beside the CFO one, with its service; both accounts see two rows, no "อาจซ้ำ"', async () => {
    const [A, B] = await team();
    const co = companies(A)[0];
    expect(A.e.addDealsFromCompanies([co.id], { year: Y, section: 'Retention', service: ['CFO'] })).toMatchObject({ added: 1, skipped: 0 });
    await settle(A, B);
    // B's dialog: the company has a CFO job; CFP picked: a new job, ticked
    const jobs = B.e.jobsIn(Y)(co);
    expect(jobs.map((d) => d.service)).toEqual([['CFO']]);
    expect(sendState(['CFP'], jobs.map((d) => jobServices(B.e.sales, d)))).toBe('new');
    later();
    const r = B.e.addDealsFromCompanies([co.id], { year: Y, section: 'Retention', service: ['CFP'] });
    expect(r).toMatchObject({ added: 1, skipped: 0 });
    // the service travels in the deal record itself: no other record, one deal op
    const q = await queued(B);
    const op = q.find((o) => o.k === 'deal/' + r.ids[0])!;
    expect((op.v as Deal).service).toEqual(['CFP']);
    await settle(B, A);
    for (const t of [A, B]) {
      expect(svcs(t, co)).toEqual(['CFO', 'CFP']);
      expect(dupRows(t.e.sales, Object.values(t.e.sales.deals), (g) => t.e.canonical(g)).size).toBe(0);
      // rows stay rows; the company counts once
      const yearDeals = Object.values(t.e.sales.deals).filter((d) => d.year === Y);
      expect(customersOf(t.e.sales, yearDeals)).toHaveLength(2);
      expect(t.e.companyCount(yearDeals)).toBe(1);
    }
    expect(sheetDeals().filter((x) => (x.v as Deal).gid === co.id)).toHaveLength(2);
    expect(Object.values(A.e.sales.log).find((l) => l.deal === r.ids[0])?.action).toBe('เพิ่มลูกค้า');
  });

  it('a send of the same service may repeat the job: skipped (and said) unless ticked through; then both rows read "อาจซ้ำ" until each has its own quotation', async () => {
    const [A, B] = await team();
    const co = companies(A)[1];
    A.e.addDealsFromCompanies([co.id], { year: Y, service: ['CFO'] });
    await settle(A, B);
    // not ticked: the dialog sends nothing; sent anyway (an older caller): skipped, and the note says why
    const r0 = B.e.addDealsFromCompanies([co.id], { year: Y, service: ['CFO'] });
    expect(r0).toMatchObject({ added: 0, skipped: 1 });
    expect(trackerNote(r0.added, r0.skipped, Y, 'CFO')).toBe('ไม่ได้ส่ง ทุกบริษัทที่เลือกมีงาน CFO ปี 2569 อยู่แล้ว');
    // nothing picked (a prospecting send): skipped too, as before
    expect(B.e.addDealsFromCompanies([co.id], { year: Y })).toMatchObject({ added: 0, skipped: 1 });
    // ticked through ("ถ้าเป็นคนละงาน ติ๊กเพื่อเพิ่มอีกงาน"): added
    const r1 = B.e.addDealsFromCompanies([co.id], { year: Y, service: ['CFO'], force: [co.id] });
    expect(r1).toMatchObject({ added: 1, skipped: 0 });
    await settle(B, A);
    const [d1, d2] = jobsOf(A, co);
    expect(dupRows(A.e.sales, Object.values(A.e.sales.deals)).get(d1.id)?.map((d) => d.id)).toEqual([d2.id]);
    // each gets its own quotation: the tag goes (two products, two projects)
    await A.e.attachDoc(d1.id, pdf('qt1.pdf'), qt('QT-2569-101'));
    await B.e.attachDoc(d2.id, pdf('qt2.pdf'), qt('QT-2569-102'));
    await settle(A, B, A);
    for (const t of [A, B]) expect(dupRows(t.e.sales, Object.values(t.e.sales.deals)).size).toBe(0);
  });

  it('a teammate\'s send that arrived after the dialog opened is re-checked: the row is skipped and counted, not added twice', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A).slice(2, 4);
    A.e.addDealsFromCompanies([c1.id], { year: Y, service: ['CFO'] });
    await settle(A, B);
    // B's dialog shows c1 as a new job (CFP beside CFO) and c2 without a job; meanwhile A sends c1 with CFP
    expect(sendState(['CFP'], B.e.jobsIn(Y)(c1).map((d) => d.service))).toBe('new');
    later();
    A.e.addDealsFromCompanies([c1.id], { year: Y, service: ['CFP'] });
    await settle(A, B);
    const r = B.e.addDealsFromCompanies([c1.id, c2.id], { year: Y, service: ['CFP'] });
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    expect(trackerNote(r.added, r.skipped, Y, 'CFP')).toBe('ส่งเข้า Sales Tracker 1 ราย (ข้าม 1 บริษัทที่มีงาน CFP ปี 2569 อยู่แล้ว)');
    await settle(B, A);
    expect(svcs(A, c1)).toEqual(['CFO', 'CFP']);
    expect(svcs(A, c2)).toEqual(['CFP']);
  });

  it('เลิกทำ takes back only the new job; the company\'s other job stays', async () => {
    const [A, B] = await team();
    const co = companies(A)[4];
    A.e.addDealsFromCompanies([co.id], { year: Y, service: ['CFO'] });
    await settle(A, B);
    later();
    const r = A.e.addDealsFromCompanies([co.id], { year: Y, service: ['T-VER'] });
    expect(r.added).toBe(1);
    expect(A.e.undoSent(r.k)).toEqual({ removed: 1, kept: 0 });
    await settle(A, B);
    for (const t of [A, B]) expect(svcs(t, co)).toEqual(['CFO']);
  });
});

describe('the services of a job, edited by two people', () => {
  it('each tick is its own item: A ticks LESS while B ticks CFP on the same job, both stay; the history says บริการ', async () => {
    const [A, B] = await team();
    const co = companies(A)[5];
    const d = A.e.addDeal({ gid: co.id, year: Y, service: ['CFO'] });
    await settle(A, B);
    A.e.updateDeal(d.id, { service: ['CFO', 'LESS'] });
    B.e.updateDeal(d.id, { service: ['CFO', 'CFP'] });
    await settle(A, B, A);
    for (const t of [A, B]) expect([...t.e.sales.deals[d.id].service].sort()).toEqual(['CFO', 'CFP', 'LESS']);
    const h = Object.values(A.e.sales.log).filter((l) => l.deal === d.id && l.action === 'แก้ไข');
    expect(h.at(-1)?.detail).toBe('บริการ');
  });
});

describe('import from the old tracker: a company\'s rows of different services are different jobs', () => {
  const file = (rows: Record<string, unknown>[]) => Object.assign(new Blob([JSON.stringify({ rows: [{ type: 'section', name: 'Retention' }, ...rows] })]), { name: 'old.json' }) as File;
  it('two file rows of one client with different services give 2 deals; a hand-made CFO row lets the file\'s CFP row in and keeps out its CFO row; importing again adds nothing', async () => {
    const [A] = await team();
    const [c1, c2, c3] = companies(A).slice(6, 9);
    // tracked by hand before the import: c2's CFO job, c3's job without a service
    A.e.addDealsFromCompanies([c2.id], { year: '2565', service: ['CFO'] });
    A.e.addDealsFromCompanies([c3.id], { year: '2565' });
    const f = file([
      { type: 'client', client: c1.name, service: ['CFO'] },
      { type: 'client', client: c1.name, service: ['CFP'] },
      { type: 'client', client: c2.name, service: ['CFO'] },
      { type: 'client', client: c2.name, service: ['CFP'] },
      { type: 'client', client: c3.name, service: ['GCT'] },
    ]);
    const r = await A.e.importTracker(f, '2565');
    expect(r.deals).toBe(3);
    const of = (c: Company) => A.e.dealsOf(c.id).filter((d) => d.year === '2565').map((d) => d.service.join('+')).sort();
    expect(of(c1)).toEqual(['CFO', 'CFP']);
    expect(of(c2)).toEqual(['CFO', 'CFP']);
    // a hand-made row without a service may be any job: the file's row stays out, as before
    expect(of(c3)).toEqual(['']);
    expect((await A.e.importTracker(f, '2565')).deals).toBe(0);
    expect(of(c1)).toEqual(['CFO', 'CFP']);
  });
});

describe('a backup keeps both jobs', () => {
  it('restoring a backup brings back the company\'s two jobs with their services', async () => {
    const [A] = await team();
    const co = companies(A)[9];
    A.e.addDealsFromCompanies([co.id], { year: Y, service: ['CFO'] });
    later();
    A.e.addDealsFromCompanies([co.id], { year: Y, service: ['CFP'] });
    // the file exportCrm downloads (its shape)
    const text = JSON.stringify({ kind: 'gcc-crm-backup', v: 1, at: new Date().toISOString(), by: 'เอ', crm: {}, contacts: {}, dedup: {}, sales: A.e.sales, custom: {}, people: {}, plinks: {} });
    const C = mk('C', 'ซี');
    await C.e.importCrm(Object.assign(new Blob([text]), { name: 'backup.json' }) as File);
    expect(svcs(C, co)).toEqual(['CFO', 'CFP']);
  });
});

describe('counting with two jobs of one company', () => {
  it('win rate per job (CFO won, CFP lost); ทำงานให้ counts the company once; rows twice', async () => {
    const [A] = await team();
    const co = companies(A)[10];
    A.e.addDealsFromCompanies([co.id], { year: Y, service: ['CFO'] });
    later();
    A.e.addDealsFromCompanies([co.id], { year: Y, service: ['CFP'] });
    const [cfo, cfp] = jobsOf(A, co);
    A.e.setStep(cfo.id, 'CLOSED DEAL', { d: '2026-10-20', n: 'YES' });
    A.e.setStep(cfp.id, 'CLOSED DEAL', { d: '2026-10-20', n: 'NO' });
    A.e.updateDeal(cfo.id, { jobStatus: 'closed' });
    A.e.updateDeal(cfp.id, { jobStatus: 'closed' });
    const list = [A.e.sales.deals[cfo.id], A.e.sales.deals[cfp.id]];
    const st = salesStats(A.e.sales, list, '2026-10-21');
    expect([st.total, st.yes, st.no, st.winRate]).toEqual([2, 1, 1, 50]);
    const w = A.e.workTally(list);
    expect([w.jobs, w.worked, w.lost]).toEqual([2, 1, 0]);
    expect(A.e.companyCount(list)).toBe(1);
  });
});
