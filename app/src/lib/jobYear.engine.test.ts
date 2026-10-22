/**
 * ปีของงาน (the deal panel's year choice) in the engine, end to end with the real team script (team-sync/Code.gs in
 * the simulator): the change is written with its own history line and nothing else of the job moves (its contact
 * date stays); the same right as any deal edit (a viewer is refused, and the script refuses it too; an account whose
 * edits cover its own work only refuses another person's job); the year picker's counts follow deal.year; a joint
 * quotation's header takes its companies along, a member leaves the quotation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN } from './caps';
import { CV, type Role, type SyncOp } from './teamSync';
import { filterDeals, jointOf, yearChangeWords, jobYearOf } from './sales';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/jy/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const T0 = new Date('2026-10-21T03:00:00Z');
const TODAY = '2026-10-21';

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
  vi.setSystemTime(T0);
});
/** A browser; `name` names its account on a team with accounts. */
function mk(browser: string, name?: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = TODAY;
  raw.store = memoryStore();
  if (name) (raw as unknown as { me: () => string }).me = () => name;
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => sim.post(body) as Record<string, unknown>;
  raw.transport = post;
  raw.fileTransport = post;
  const tab = { e: raw, browser };
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
/** A team whose lead (หมิว) claimed the first admin account. */
async function lead() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const L = mk('L', 'หมิว');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
  return L;
}
async function member(L: Tab, u: string, name: string, role: Role) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(u, name);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  await settle(M);
  return M;
}
const queued = async (t: Tab) => {
  await (t.e as unknown as { pq: Promise<unknown> }).pq;
  return (await t.e.store.get<SyncOp[]>('teamPending:' + URL)) || [];
};
/** The job's history, oldest first. */
const hist = (t: Tab, dealId: string) => Object.values(t.e.sales.log).filter((l) => l.deal === dealId).sort((a, b) => a.at.localeCompare(b.at));
/** What the script stores for a deal (as an admin pulls it): its record, or undefined. */
const stored = (L: Tab, id: string) => sim.post({ action: 'pull', since: 0, cv: CV, tok: L.e.session!.tok }).rows!.filter((r) => r.k === 'deal/' + id).at(-1);
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const spec = (over: Partial<Parameters<GccEngine['createJoint']>[0]> = {}) => ({
  title: 'CFP มจพ (มจพ)', payer: 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ', payerGid: null, year: '2569', section: 'Event Exhibition', resp: 'หมิว', service: ['CFP'],
  total: 1284000, docNo: 'QT-2569-052', docDate: '2026-10-06', basis: 'total' as const, detected: 1284000, members: [], ...over,
});

describe('ปีของงาน: the deal panel\'s year choice', () => {
  it('a change writes the year and its own history line; the contact date and the rest of the job stay; the other browser follows', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ปีของงาน จำกัด', section: 'Retention', year: '2569', resp: 'หมิว', contactDate: '2026-10-10', forecast: 50000 });
    await settle(L, S);
    L.e.setJobYear(d.id, '2570');
    expect(L.e.sales.deals[d.id]).toMatchObject({ year: '2570', contactDate: '2026-10-10', forecast: 50000, resp: 'หมิว', section: 'Retention' });
    // one history line, and no "แก้ไข · ปี" for the year
    const h = hist(L, d.id);
    expect(h.filter((l) => l.action === yearChangeWords('2570'))).toHaveLength(1);
    expect(h.some((l) => l.action === 'แก้ไข' && /ปี/.test(l.detail))).toBe(false);
    expect(h.at(-1)).toMatchObject({ action: 'เปลี่ยนปีของงานเป็น 2570', by: 'หมิว' });
    await settle(L, S);
    expect(stored(L, d.id)!.v).toMatchObject({ year: '2570', contactDate: '2026-10-10' });
    expect(S.e.sales.deals[d.id]).toMatchObject({ year: '2570', contactDate: '2026-10-10' });
    expect(hist(S, d.id).map((l) => l.action)).toContain('เปลี่ยนปีของงานเป็น 2570');
  });

  it('a value that is not a year, or the year the job has, writes nothing', async () => {
    const L = await lead();
    const d = L.e.addDeal({ client: 'งานไม่เปลี่ยน', year: '2569', resp: 'หมิว' });
    await settle(L);
    const before = hist(L, d.id).length;
    L.e.setJobYear(d.id, '2569');
    L.e.setJobYear(d.id, '257');
    L.e.setJobYear(d.id, '2570x');
    expect(L.e.sales.deals[d.id].year).toBe('2569');
    expect(hist(L, d.id).length).toBe(before);
    expect(await queued(L)).toEqual([]);
  });

  it('the same right as any deal edit: a viewer is refused (nothing queued, the script refuses it too); an account whose edits cover its own work refuses another person\'s job', async () => {
    const L = await lead();
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    const { id: own } = await L.e.roleSave({ n: 'ขายเฉพาะงานตัวเอง', d: '', c: { ...BUILTIN.sales.c, 'edit.deal': 'own' } });
    const O = await member(L, 'orn', 'อร', own);
    const theirs = L.e.addDeal({ client: 'งานของหมิว', year: '2569', resp: 'หมิว' });
    const mine = L.e.addDeal({ client: 'งานของอร', year: '2569', resp: 'อร' });
    await settle(L, V, O);

    V.e.setJobYear(theirs.id, '2570');
    expect(V.e.sales.deals[theirs.id].year).toBe('2569');
    expect(V.e.teamNote).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
    expect(await queued(V)).toEqual([]);
    const refused = sim.post({ action: 'push', tok: V.e.session!.tok, cv: CV, ops: [{ k: 'deal/' + theirs.id, v: { ...V.e.sales.deals[theirs.id], year: '2570' } }] });
    expect(refused).toMatchObject({ ok: false, error: 'forbidden' });

    O.e.setJobYear(theirs.id, '2570');
    expect(O.e.sales.deals[theirs.id].year).toBe('2569');
    expect(await queued(O)).toEqual([]);
    O.e.setJobYear(mine.id, '2570');
    expect(O.e.sales.deals[mine.id].year).toBe('2570');
    await settle(L, O);
    expect(L.e.sales.deals[mine.id].year).toBe('2570');
    expect(L.e.sales.deals[theirs.id].year).toBe('2569');
  });

  it('the year picker counts follow deal.year: the job counts in the year it is in now', async () => {
    const L = await lead();
    const d = L.e.addDeal({ client: 'งานนับปี', year: '2569', resp: 'หมิว' });
    L.e.addDeal({ client: 'งานปีเดิม', year: '2569', resp: 'หมิว' });
    const count = (y: string) => filterDeals(L.e.sales, { year: y }, TODAY).length;
    expect([count('2569'), count('2570')]).toEqual([2, 0]);
    L.e.setJobYear(d.id, '2570');
    expect([count('2569'), count('2570')]).toEqual([1, 1]);
  });

  it('a joint quotation: its header moves every company with it; a member leaves the quotation and only its own year moves (its header keeps its year)', async () => {
    const L = await lead();
    const ms = ['บางกอกสตีล', 'อุดร ไบโอแมส', 'สยามฟู้ดส์'].map((n) => L.e.addDeal({ client: n, section: 'Event Exhibition', year: '2569', resp: 'หมิว' }));
    const { hid } = await L.e.createJoint({ ...spec(), file: pdf('qt.pdf'), members: ms.map((x) => ({ deal: x.id, share: null, pct: null })) });
    const S = L.e.sales;
    L.e.setJobYear(ms[0].id, '2570');
    expect(S.deals[ms[0].id].year).toBe('2570');
    expect(S.deals[hid].year).toBe('2569');
    expect(jointOf(S, { id: hid })!.members.map((x) => x.deal.id)).toEqual([ms[1].id, ms[2].id]);
    expect(hist(L, ms[0].id).map((l) => l.action)).toContain('เปลี่ยนปีของงานเป็น 2570');
    L.e.setJobYear(hid, '2571');
    expect([hid, ms[1].id, ms[2].id].map((id) => S.deals[id].year)).toEqual(['2571', '2571', '2571']);
    await settle(L);
    expect(hist(L, ms[2].id).map((l) => l.action)).toContain('เปลี่ยนปีของงานเป็น 2571');
  });

  it('the duplicate check of a send: a company that already has this service in the year does not take the job; said by name, nothing moves or queues', async () => {
    const L = await lead();
    const gid = base.rows[0][0] as number;
    const co = L.e.company(gid)!.name;
    const a = L.e.addDeal({ gid, year: '2569', service: ['CFP'], resp: 'หมิว' });
    L.e.addDeal({ gid, year: '2570', service: ['CFP'], resp: 'หมิว' });
    await settle(L);
    L.e.setJobYear(a.id, '2570');
    expect(L.e.sales.deals[a.id].year).toBe('2569');
    expect(L.e.teamNote).toBe(`ย้ายปีไม่ได้: ${co} มีงาน CFP ในปี 2570 แล้ว`);
    expect(hist(L, a.id).some((l) => l.action === yearChangeWords('2570'))).toBe(false);
    expect(await queued(L)).toEqual([]);
  });

  it('the same company moves where the service differs, or to a year it has no job in', async () => {
    const L = await lead();
    const gid = base.rows[0][0] as number;
    const a = L.e.addDeal({ gid, year: '2569', service: ['CFP'], resp: 'หมิว' });
    const cfo = L.e.addDeal({ gid, year: '2569', service: ['CFO'], resp: 'หมิว' });
    L.e.addDeal({ gid, year: '2570', service: ['CFP'], resp: 'หมิว' });
    await settle(L);
    L.e.setJobYear(cfo.id, '2570');
    expect(L.e.sales.deals[cfo.id].year).toBe('2570');
    L.e.setJobYear(a.id, '2571');
    expect(L.e.sales.deals[a.id].year).toBe('2571');
  });

  it('a job with no service moves only where its company has no job that year (the send rule: nothing picked counts as a job); naming the service lets it move', async () => {
    const L = await lead();
    const gid = base.rows[1][0] as number;
    const u = L.e.addDeal({ gid, year: '2569', service: [], resp: 'หมิว' });
    L.e.addDeal({ gid, year: '2570', service: ['CFP'], resp: 'หมิว' });
    await settle(L);
    L.e.setJobYear(u.id, '2570');
    expect(L.e.sales.deals[u.id].year).toBe('2569');
    expect(L.e.teamNote).toBe(`ย้ายปีไม่ได้: ${L.e.company(gid)!.name} มีงานในปี 2570 แล้ว เลือกบริการให้งานนี้ก่อน`);
    L.e.updateDeal(u.id, { service: ['CFO'] });
    L.e.setJobYear(u.id, '2570');
    expect(L.e.sales.deals[u.id].year).toBe('2570');
  });

  it('a joint quotation whose company already has its service in the year does not move (each member\'s company is checked, as a send is); the same move with no clash does', async () => {
    const L = await lead();
    const gids = [0, 1, 2].map((i) => base.rows[i][0] as number);
    const ms = gids.map((gid) => L.e.addDeal({ gid, section: 'Event Exhibition', year: '2569', resp: 'หมิว' }));
    const { hid } = await L.e.createJoint({ ...spec(), file: pdf('qt.pdf'), members: ms.map((x) => ({ deal: x.id, share: null, pct: null })) });
    L.e.addDeal({ gid: gids[1], year: '2570', service: ['CFP'], resp: 'หมิว' });
    await settle(L);
    const S = L.e.sales;
    L.e.setJobYear(hid, '2570');
    expect([hid, ...ms.map((x) => x.id)].map((id) => S.deals[id].year)).toEqual(['2569', '2569', '2569', '2569']);
    expect(L.e.teamNote).toBe(`ย้ายปีไม่ได้: ${L.e.company(gids[1])!.name} มีงาน CFP ในปี 2570 แล้ว`);
    L.e.setJobYear(ms[1].id, '2570');
    expect(S.deals[ms[1].id].year).toBe('2569');
    L.e.setJobYear(hid, '2571');
    expect([hid, ...ms.map((x) => x.id)].map((id) => S.deals[id].year)).toEqual(['2571', '2571', '2571', '2571']);
  });
});

describe('ปีของงาน: the defaults of a new job and its history words', () => {
  it('a job added while a year is picked is that year; with none picked, this year; the history says the year in words', () => {
    expect(jobYearOf('2568', '2569')).toBe('2568');
    expect(jobYearOf('', '2569')).toBe('2569');
    expect(jobYearOf('2568x', '2569')).toBe('2569');
    expect(yearChangeWords('2570')).toBe('เปลี่ยนปีของงานเป็น 2570');
  });
});
