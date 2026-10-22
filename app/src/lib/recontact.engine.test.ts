/**
 * Keeping a closed job for a follow-up and starting its new cycle, in the engine, end to end with the real team
 * script (team-sync/Code.gs in the simulator): the closing date (kept, listed, cleared, reopened), a new cycle for a
 * later year (what it copies, what the old job keeps, the two history lines), a viewer refused with nothing written,
 * the duplicate check of a company's jobs (the same year counts, another year never does), and the CSV column.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { cycleIdOf, recontactList } from './recontact';
import type { Role } from './teamSync';
import type { Company, Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/rc/exec';
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
function mk(browser: string, store = memoryStore()): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-21';
  raw.store = store;
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
/** The lead of a new team (accounts): signed in on its own browser. */
async function lead() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const L = mk('L');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หัวหน้า', 'lead-pass-123');
  expect(L.e.role()).toBe('admin');
  return L;
}
/** An account the lead made, signed in on its own browser. */
async function member(L: Tab, u: string, name: string, role: Role) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(u);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  await settle(M);
  return M;
}
const rows = (k?: string) => {
  const sh = sim.sheet();
  return (sh ? sh.rows.slice(1) : [])
    .filter((r) => r[1] && (!k || r[1] === k))
    .map((r) => ({ seq: +r[0], k: r[1], v: r[2] === '' ? null : JSON.parse(r[2]), del: r[3] === '1', by: r[4] }));
};
const hist = (t: Tab, dealId: string) => Object.values(t.e.sales.log).filter((l) => l.deal === dealId).sort((a, b) => a.at.localeCompare(b.at));
/** Registry companies with one name each, no job and no person yet (an import links by name). */
function companies(t: Tab): Company[] {
  const n = new Map<string, number>();
  t.e.B.companies.forEach((c) => n.set(c.name.trim(), (n.get(c.name.trim()) || 0) + 1));
  return t.e.B.companies.filter((c) => n.get(c.name.trim()) === 1 && !t.e.dealsOf(c.id).length && !t.e.peopleOf(c.id).length);
}
const keptDeals = (t: Tab) => recontactList(t.e.sales, Object.values(t.e.sales.deals)).map((d) => d.id);

describe('closing a single job and keeping it for a follow-up', () => {
  it('closed with a date: listed on the ปิดงาน tab for both browsers, one history line; cleared or reopened back to plain', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    const B = await member(L, 'bee', 'บี', 'sales');
    const [c1] = companies(L);
    const d = A.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO', service: ['CFO'], resp: 'เอ', contactName: 'คุณสมชาย', phone: '081-111-2222' });
    await settle(L, A, B);
    // closed with a date a year on: kept
    A.e.updateDeal(d.id, { jobStatus: 'closed', recontact: '2027-10-22' });
    expect(keptDeals(A)).toEqual([d.id]);
    expect(hist(A, d.id).at(-1)).toMatchObject({ action: 'ปิดงาน', detail: 'เก็บไว้ติดตาม · ติดต่อใหม่ 22 ต.ค. 2570' });
    await settle(A, B, L);
    for (const t of [B, L]) {
      expect(t.e.sales.deals[d.id]).toMatchObject({ jobStatus: 'closed', recontact: '2027-10-22' });
      expect(keptDeals(t)).toEqual([d.id]);
    }
    expect(rows('deal/' + d.id).at(-1)!.v).toMatchObject({ recontact: '2027-10-22', jobStatus: 'closed' });
    // cleared: a plain ปิดงาน again
    B.e.updateDeal(d.id, { recontact: '' });
    await settle(B, A);
    expect(A.e.sales.deals[d.id].recontact || '').toBe('');
    expect(keptDeals(A)).toEqual([]);
    expect(A.e.sales.deals[d.id].jobStatus).toBe('closed');
    // kept again, then reopened: the date goes with the closing
    A.e.updateDeal(d.id, { recontact: '2027-11-01' });
    await settle(A, L);
    expect(keptDeals(L)).toEqual([d.id]);
    L.e.updateDeal(d.id, { jobStatus: 'open' });
    await settle(L, A, B);
    for (const t of [A, B, L]) {
      expect(t.e.sales.deals[d.id].jobStatus).toBe('open');
      expect(t.e.sales.deals[d.id].recontact || '').toBe('');
      expect(keptDeals(t)).toEqual([]);
    }
  });

  it('a date that is not one, or already past, is not written', async () => {
    const L = await lead();
    const [c1] = companies(L);
    const d = L.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO' });
    L.e.updateDeal(d.id, { jobStatus: 'closed' });
    L.e.updateDeal(d.id, { recontact: '2026-02-30' });
    L.e.updateDeal(d.id, { recontact: '2026-10-01' }); // before today (21 October 2026)
    expect(L.e.sales.deals[d.id].recontact || '').toBe('');
    expect(keptDeals(L)).toEqual([]);
    await settle(L);
    expect(rows('deal/' + d.id).at(-1)!.v).not.toHaveProperty('recontact');
    L.e.updateDeal(d.id, { recontact: '2026-10-21' }); // today is fine
    expect(L.e.sales.deals[d.id].recontact).toBe('2026-10-21');
  });

  it('a joint quotation closes as one, its companies are never kept and never start a new cycle', async () => {
    const L = await lead();
    const [c1] = companies(L);
    const m = L.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO', service: ['CFO'], resp: 'เอ' });
    const { hid } = await L.e.createJoint({
      title: 'ใบเสนอราคาร่วมทดสอบ', payer: 'ผู้จ่ายทดสอบ', payerGid: null, year: '2569', section: 'TGO', resp: 'เอ', service: ['CFO'],
      total: 1000, docNo: 'QT-2569-901', docDate: '2026-10-06', basis: 'total', detected: 1000, members: [{ deal: m.id, share: null, pct: null }],
    });
    expect(L.e.closeJoint(hid)).toBeGreaterThan(0);
    expect(L.e.sales.deals[hid].jobStatus).toBe('closed');
    expect(L.e.sales.deals[m.id].jobStatus).toBe('closed');
    // a company of a joint quotation has no date to keep, and neither row starts a new cycle
    expect(recontactList(L.e.sales, Object.values(L.e.sales.deals))).toEqual([]);
    expect(L.e.newCycle(m.id, '2570')).toBeNull();
    expect(L.e.newCycle(hid, '2570')).toBeNull();
    expect(Object.values(L.e.sales.deals).some((x) => x.from === m.id)).toBe(false);
  });

  it('a date goes only on a closed job; a plain closing after a teammate set a date on the reopened job keeps nothing', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    const B = await member(L, 'bee', 'บี', 'sales');
    const [c1] = companies(L);
    const d = A.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO', service: ['CFO'], resp: 'เอ' });
    await settle(L, A, B);
    // a date on an open job is not written at all
    A.e.updateDeal(d.id, { recontact: '2027-12-01' });
    expect(A.e.sales.deals[d.id].recontact).toBeUndefined();
    // closed and kept; A reopens it while B, still seeing it closed, sets another date: the job is open with that date
    A.e.updateDeal(d.id, { jobStatus: 'closed', recontact: '2027-10-22' });
    await settle(A, B, L);
    A.e.updateDeal(d.id, { jobStatus: 'open' });
    B.e.updateDeal(d.id, { recontact: '2027-12-01' });
    await settle(A, B, L);
    // (the date a teammate set on the reopened job is not read: an open job shows none, lib/sales toDeal)
    expect(A.e.sales.deals[d.id]).toMatchObject({ jobStatus: 'open' });
    expect(A.e.sales.deals[d.id].recontact || '').toBe('');
    // A's plain ปิดงาน (no date) keeps nothing, on every browser: the stale date does not carry over
    A.e.updateDeal(d.id, { jobStatus: 'closed' });
    await settle(A, B, L);
    for (const t of [A, B, L]) expect(keptDeals(t)).toEqual([]);
    expect(hist(A, d.id).at(-1)!.detail).not.toMatch(/เก็บไว้ติดตาม/);
  });
});

describe('เปิดรอบใหม่: a new job for a later year, the old job unchanged', () => {
  it('copies the company, contact, owner, section, sources and services; the old job keeps every field; two history lines', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    const B = await member(L, 'bee', 'บี', 'sales');
    const [c1] = companies(L);
    const old = A.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO', service: ['CFO', 'CFP'], resp: 'เอ', contactName: 'คุณสมชาย', phone: '081-111-2222', email: 'somchai@example.com', referral: 'งานแนะนำ' });
    A.e.updateDeal(old.id, { jobStatus: 'closed', recontact: '2027-10-22', forecast: 300000 });
    await settle(A, B, L);
    const before = structuredClone(A.e.sales.deals[old.id]);
    const sheetBefore = rows('deal/' + old.id).length;
    const n = A.e.newCycle(old.id, '2570');
    expect(n).not.toBeNull();
    expect(n).toMatchObject({
      year: '2570', section: 'TGO', gid: c1.id, client: c1.name, contactName: 'คุณสมชาย', phone: '081-111-2222', email: 'somchai@example.com',
      resp: 'เอ', referral: 'งานแนะนำ', service: ['CFO', 'CFP'], contactDate: '', jobStatus: 'open', closedDate: '', from: old.id,
    });
    expect(n!.forecast).toBeNull();
    expect(n!.recontact).toBeUndefined();
    // the old job: not changed at all, only its history line
    expect(A.e.sales.deals[old.id]).toEqual(before);
    expect(rows('deal/' + old.id)).toHaveLength(sheetBefore);
    expect(hist(A, old.id).at(-1)).toMatchObject({ action: 'เปิดรอบใหม่ปี 2570' });
    expect(hist(A, n!.id)[0]).toMatchObject({ action: 'ต่อจากรอบปี 2569' });
    // nothing of the work is copied: no steps, documents, payments, plan or contacts
    expect(Object.keys(A.e.sales.steps).some((k) => k.startsWith(n!.id + '/'))).toBe(false);
    expect(Object.values(A.e.sales.docs).some((x) => x.deal === n!.id)).toBe(false);
    expect(Object.keys(A.e.sales.pays).some((k) => k.startsWith(n!.id + '/'))).toBe(false);
    // the second browser sees the new job and the old one's history line; the record itself carries `from`
    await settle(A, B);
    expect(B.e.sales.deals[n!.id]).toMatchObject({ year: '2570', from: old.id, jobStatus: 'open' });
    expect(B.e.sales.deals[old.id]).toEqual(before);
    expect(rows('deal/' + n!.id).at(-1)!.v).toMatchObject({ from: old.id, year: '2570', client: c1.name });
    expect(hist(B, old.id).map((l) => l.action)).toContain('เปิดรอบใหม่ปี 2570');
    // the list: the old job still kept until someone changes it (the new cycle does not clear it)
    expect(keptDeals(B)).toEqual([old.id]);
  });

  it('refused, with nothing written: an open job, a year that is not later, a joint quotation\'s row', async () => {
    const L = await lead();
    const [c1, c2] = companies(L);
    const open = L.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO' });
    const closed = L.e.addDeal({ gid: c2.id, year: '2569', section: 'TGO' });
    L.e.updateDeal(closed.id, { jobStatus: 'closed' });
    const n0 = Object.keys(L.e.sales.deals).length;
    expect(L.e.newCycle(open.id, '2570')).toBeNull();
    expect(L.e.newCycle(closed.id, '2569')).toBeNull();
    expect(L.e.newCycle(closed.id, '2568')).toBeNull();
    expect(L.e.newCycle(closed.id, 'x')).toBeNull();
    expect(Object.keys(L.e.sales.deals)).toHaveLength(n0);
    expect(hist(L, closed.id).map((l) => l.action)).not.toContain('เปิดรอบใหม่ปี 2570');
  });

  it('one new job per job and year: a second cycle of the same job in that year is refused; a same-year job sharing a service refuses it, another service does not', async () => {
    const L = await lead();
    const [c1] = companies(L);
    const old = L.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO', service: ['CFO'], resp: 'เอ' });
    L.e.updateDeal(old.id, { jobStatus: 'closed' });
    expect(L.e.newCycle(old.id, '2570')).not.toBeNull();
    expect(L.e.newCycle(old.id, '2570')).toBeNull();
    expect(L.e.teamNote).toMatch(/มีงานปี 2570 แล้ว/);
    expect(Object.values(L.e.sales.deals).filter((x) => x.from === old.id && x.year === '2570')).toHaveLength(1);
    // the company's own 2571 job with another service does not block a 2571 cycle of the old job
    L.e.addDeal({ gid: c1.id, year: '2571', section: 'TGO', service: ['CFP'] });
    expect(L.e.newCycle(old.id, '2571')).not.toBeNull();
    // a same-year job with the old job's service blocks the cycle, however it was entered
    L.e.addDeal({ gid: c1.id, year: '2572', section: 'TGO', service: ['CFO'] });
    expect(L.e.newCycle(old.id, '2572')).toBeNull();
    expect(Object.values(L.e.sales.deals).filter((x) => x.year === '2572')).toHaveLength(1);
  });

  it('a viewer cannot start a new cycle: nothing changes here and nothing is sent', async () => {
    const L = await lead();
    const [c1] = companies(L);
    const d = L.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO' });
    L.e.updateDeal(d.id, { jobStatus: 'closed' });
    await settle(L);
    const V = await member(L, 'vee', 'วี', 'viewer');
    const before = JSON.stringify(V.e.sales);
    const sheet = rows().length;
    expect(V.e.newCycle(d.id, '2570')).toBeNull();
    expect(JSON.stringify(V.e.sales)).toBe(before);
    expect(V.e.teamNote).toMatch(/ไม่มีสิทธิ์/);
    await settle(V);
    expect(rows().length).toBe(sheet);
    expect(V.e.teamPendingN).toBe(0);
  });
});

describe('the duplicate check reads the company\'s jobs of the same year only', () => {
  it('a closed or kept job of another year never prompts or blocks; a closed job of the same year still counts', async () => {
    const L = await lead();
    const [c1] = companies(L);
    const old = L.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO', service: ['CFO'] });
    L.e.updateDeal(old.id, { jobStatus: 'closed', recontact: '2027-10-22' });
    // a later year: the company is sent with the same service, no job of it there yet: added, nothing skipped
    const later1 = L.e.addDealsFromCompanies([c1.id], { year: '2570', service: ['CFO'] });
    expect(later1).toMatchObject({ added: 1, skipped: 0, clash: [] });
    expect(L.e.trackedIn('2571')(c1)).toBe(false);
    // the same year: a closed job still counts, so the same service is not added twice
    const same = L.e.addDealsFromCompanies([c1.id], { year: '2569', service: ['CFO'] });
    expect(same).toMatchObject({ added: 0, skipped: 1, clash: ['CFO'] });
  });
});

describe('the tracker CSV', () => {
  it('has the ติดต่อใหม่ column (the date, or empty) as its last column: the plan column keeps its place before it', async () => {
    const L = await lead();
    const [c1] = companies(L);
    const d = L.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO' });
    L.e.updateDeal(d.id, { jobStatus: 'closed', recontact: '2027-10-22' });
    const unq = (x: string) => x.replace(/^"|"$/g, '');
    /** one row of the CSV read by its header */
    const cell = (csv: string, k: string) => {
      const [head, row] = csv.split('\r\n');
      const h = head.split('","').map(unq), r = row.split('","').map(unq);
      return r[h.indexOf(k)];
    };
    const csv = () => L.e.salesCsv([L.e.sales.deals[d.id]]);
    // no column before the new one moved: every column of the old layout keeps its index, the new one comes after the plan
    const head = csv().split('\r\n')[0].split('","').map(unq);
    expect(head.at(-1)).toBe('ติดต่อใหม่');
    expect(head.at(-2)).toBe('แผนชำระ');
    expect(cell(csv(), 'ติดต่อใหม่')).toBe('2027-10-22');
    L.e.updateDeal(d.id, { recontact: '' });
    expect(cell(csv(), 'ติดต่อใหม่')).toBe('');
  });
});


describe('two browsers start the same new cycle before they sync', () => {
  it('one new job and one history line on the old job; another year from the same job is its own job; a second cycle of a year is refused everywhere', async () => {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    const B = await member(L, 'bee', 'บี', 'sales');
    const [c1] = companies(L);
    const old = A.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO', service: ['CFO'], resp: 'เอ' });
    A.e.updateDeal(old.id, { jobStatus: 'closed' });
    await settle(L, A, B);
    // both start the 2570 cycle at the same moment, neither has synced: the same id on both
    const a = A.e.newCycle(old.id, '2570');
    vi.setSystemTime(new Date('2026-10-21T03:05:00Z')); // B's copy is made a little later
    const b = B.e.newCycle(old.id, '2570');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).toBe(cycleIdOf(old.id, '2570'));
    expect(b!.id).toBe(a!.id);
    // B's cycle for another year from the same old job: a job of its own
    const c = B.e.newCycle(old.id, '2571');
    expect(c).not.toBeNull();
    expect(c!.id).not.toBe(a!.id);
    await settle(A, B, L);
    for (const t of [A, B, L]) {
      const news = Object.values(t.e.sales.deals).filter((x) => x.from === old.id);
      expect(news.map((x) => x.year).sort()).toEqual(['2570', '2571']);
      // create-only: the first browser's job stands, B's copy of it is a no-op on the team
      expect(t.e.sales.deals[a!.id]).toMatchObject({ by: 'เอ', at: T0.toISOString() });
      expect(hist(t, old.id).map((l) => l.action).filter((x) => x.startsWith('เปิดรอบใหม่')).sort()).toEqual(['เปิดรอบใหม่ปี 2570', 'เปิดรอบใหม่ปี 2571']);
      expect(hist(t, a!.id).map((l) => l.action)).toEqual(['ต่อจากรอบปี 2569']);
    }
    // the second cycle of 2570 is refused on every browser now
    expect(A.e.newCycle(old.id, '2570')).toBeNull();
    expect(B.e.newCycle(old.id, '2570')).toBeNull();
    expect(L.e.newCycle(old.id, '2570')).toBeNull();
    for (const t of [A, B, L]) expect(Object.values(t.e.sales.deals).filter((x) => x.from === old.id && x.year === '2570')).toHaveLength(1);
  });
});

describe('a date on a job that a teammate reopens', () => {
  /** A closed job kept with a date, on all three browsers; A reopens it (its date goes) and the reopening is sent. */
  async function reopenedByA() {
    const L = await lead();
    const A = await member(L, 'aem', 'เอ', 'sales');
    const B = await member(L, 'bee', 'บี', 'sales');
    const [c1] = companies(L);
    const d = A.e.addDeal({ gid: c1.id, year: '2569', section: 'TGO', service: ['CFO'], resp: 'เอ' });
    A.e.updateDeal(d.id, { jobStatus: 'closed', recontact: '2027-10-22' });
    await settle(L, A, B);
    A.e.updateDeal(d.id, { jobStatus: 'open' });
    await settle(A);
    return { L, A, B, d };
  }

  it('B, still seeing the job closed, sets a date that lands after the reopening: the open job shows no date on any browser', async () => {
    const { L, A, B, d } = await reopenedByA();
    B.e.updateDeal(d.id, { recontact: '2027-12-01' });
    await settle(B, A, L);
    for (const t of [A, B, L]) {
      expect(t.e.sales.deals[d.id]).toMatchObject({ jobStatus: 'open' });
      expect(t.e.sales.deals[d.id].recontact || '').toBe('');
      expect(keptDeals(t)).toEqual([]);
    }
  });

  it('a plain closing made before this browser has pulled the teammate\'s date clears that date too: closed, no date, on every browser', async () => {
    const { L, A, B, d } = await reopenedByA();
    B.e.updateDeal(d.id, { recontact: '2027-12-01' });
    await settle(B); // the date reaches the team, on the open job
    // A has not pulled it: its plain closing is queued first, then the date comes in and is rebased under the closing
    A.e.updateDeal(d.id, { jobStatus: 'closed' });
    await settle(A, B, L);
    for (const t of [A, B, L]) {
      expect(t.e.sales.deals[d.id]).toMatchObject({ jobStatus: 'closed' });
      expect(t.e.sales.deals[d.id].recontact || '').toBe('');
      expect(keptDeals(t)).toEqual([]);
    }
    expect(String((rows('deal/' + d.id).at(-1)!.v as { recontact?: string }).recontact || '')).toBe('');
    expect(hist(A, d.id).at(-1)!.detail).not.toMatch(/เก็บไว้ติดตาม/);
  });
});
