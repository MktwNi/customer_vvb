/**
 * The service picker's names in the engine, end to end with the real team script (team-sync/Code.gs in the
 * simulator): a name a salesperson adds on one job is listed for every job with no write to the team's list
 * (scfg/services stays as it was, and a sales account may not set it); a viewer may not change a job's
 * services; two accounts adding different names to one job at once keep both.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { svcChoices, svcClean, svcKey } from './jobs';
import { DEFAULT_SERVICES } from './sales';
import { CV, type Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/svp/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));

// each browser has its own localStorage (the session)
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
/** A browser; `name`: who it is on a team-code team (accounts: the account's name). */
function mk(browser: string, name?: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-21';
  raw.store = memoryStore();
  if (name) (raw as unknown as { me: () => string }).me = () => name;
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
/** The team's stored rows for key k, as an admin pulls them. */
const stored = (L: Tab, k: string) => sim.post({ action: 'pull', since: 0, cv: CV, tok: L.e.session!.tok }).rows!.filter((r) => r.k === k).at(-1);

/** Who may do what: the lead (admin) sets the team up; accounts are made by the lead, as in the roles tests. */
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

describe('the names a job holds are listed for every job; the team list is not written', () => {
  it('a name a salesperson adds on one job is listed for the other jobs too; scfg/services is not written, and a sales account may not set it', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d1 = L.e.addDeal({ client: 'บริษัท ทดสอบบริการหนึ่ง จำกัด', year: '2569', resp: 'เอก' });
    const d2 = L.e.addDeal({ client: 'บริษัท ทดสอบบริการสอง จำกัด', year: '2569', resp: 'เอก' });
    await settle(L, S);
    expect(S.e.sales.cfg.services).toEqual(DEFAULT_SERVICES);
    // the team's list as the script holds it now (written once, when the team was set up)
    const listRow = stored(L, 'scfg/services');
    expect(listRow?.v).toEqual(DEFAULT_SERVICES);

    // the salesperson picks a name no list has, on one job
    S.e.updateDeal(d1.id, { service: ['CFO', 'Net Zero Workshop'] });
    await settle(L, S);
    expect(L.e.sales.deals[d1.id].service).toEqual(['CFO', 'Net Zero Workshop']);

    // another job, another account: the name is offered; the team's list is unchanged
    const offered = [...DEFAULT_SERVICES, 'Net Zero Workshop'];
    expect(svcChoices(L.e.sales)).toEqual(offered);
    expect(svcChoices(S.e.sales)).toEqual(offered);
    expect(L.e.sales.deals[d2.id].service).toEqual([]);
    expect(L.e.sales.cfg.services).toEqual(DEFAULT_SERVICES);
    expect(stored(L, 'scfg/services')).toEqual(listRow);

    // a sales account may not change the team's list (the engine says so; the script refuses the write)
    S.e.setSalesList('services', [...DEFAULT_SERVICES, 'Net Zero Workshop']);
    expect(S.e.teamNote).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
    const refused = sim.post({ action: 'push', tok: S.e.session!.tok, cv: CV, ops: [{ k: 'scfg/services', v: { add: ['Net Zero Workshop'], rm: [] } }] });
    expect(refused.denied).toEqual(['scfg/services']);
    await settle(L, S);
    expect(L.e.sales.cfg.services).toEqual(DEFAULT_SERVICES);
    expect(stored(L, 'scfg/services')).toEqual(listRow);
  });

  it('a viewer may not change a job\'s services: the script refuses it and the value stays', async () => {
    const L = await lead();
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    const d = L.e.addDeal({ client: 'บริษัท ทดสอบผู้ดู จำกัด', year: '2569', resp: 'หมิว' });
    L.e.updateDeal(d.id, { service: ['CFO'] });
    await settle(L, V);
    expect(V.e.sales.deals[d.id].service).toEqual(['CFO']);

    V.e.updateDeal(d.id, { service: ['CFO', 'CFP'] });
    await settle(L, V);
    expect(L.e.sales.deals[d.id].service).toEqual(['CFO']);
    expect(V.e.sales.deals[d.id].service).toEqual(['CFO']);
    expect(stored(L, 'deal/' + d.id)?.v).toMatchObject({ service: ['CFO'] });
    const refused = sim.post({ action: 'push', tok: V.e.session!.tok, cv: CV, ops: [{ k: 'deal/' + d.id, v: { ...V.e.sales.deals[d.id], service: ['CFO', 'CFP'] } }] });
    expect(refused).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it('two accounts add different names to one job at once: both are kept, on both browsers', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const O = await member(L, 'orn', 'อร', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ทดสอบสองคน จำกัด', year: '2569', resp: 'เอก' });
    L.e.updateDeal(d.id, { service: ['CFO'] });
    await settle(L, S, O);

    S.e.updateDeal(d.id, { service: [...S.e.sales.deals[d.id].service, 'Lab Audit'] });
    O.e.updateDeal(d.id, { service: [...O.e.sales.deals[d.id].service, 'Carbon Label Review'] });
    await settle(L, S, O);
    for (const t of [L, S, O]) expect([...t.e.sales.deals[d.id].service].sort()).toEqual(['CFO', 'Carbon Label Review', 'Lab Audit']);
    // the team's list first, then the names the jobs hold (in the order the job stores them)
    const offered = svcChoices(O.e.sales);
    expect(offered.slice(0, DEFAULT_SERVICES.length)).toEqual(DEFAULT_SERVICES);
    expect(offered.slice(DEFAULT_SERVICES.length).sort()).toEqual(['Carbon Label Review', 'Lab Audit']);
  });

  it('two accounts add one name in two spellings to a job before either syncs: the job, the picker and the CSV name it once', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const O = await member(L, 'orn', 'อร', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ทดสอบชื่อซ้ำ จำกัด', year: '2569', resp: 'เอก' });
    L.e.updateDeal(d.id, { service: ['CFO'] });
    await settle(L, S, O);

    S.e.updateDeal(d.id, { service: [...S.e.sales.deals[d.id].service, 'Lab Audit'] });
    O.e.updateDeal(d.id, { service: [...O.e.sales.deals[d.id].service, 'lab audit'] });
    await settle(L, S, O);
    for (const t of [L, S, O]) expect(svcClean(t.e.sales.deals[d.id].service).filter((x) => svcKey(x) === 'lab audit')).toEqual(['Lab Audit']);
    expect(svcChoices(O.e.sales).filter((x) => svcKey(x) === 'lab audit')).toEqual(['Lab Audit']);
    // the CSV's "Services อื่น" cell names the service once, not once per spelling the sync kept
    const row = L.e.salesCsv([L.e.sales.deals[d.id]]).split('\n').find((l) => l.includes('ทดสอบชื่อซ้ำ'));
    expect(row).toBeDefined();
    expect(row!.match(/lab audit/gi)).toEqual(['Lab Audit']);
  });
});
