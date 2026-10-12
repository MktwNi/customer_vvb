/**
 * Customer types (ประเภทลูกค้า) in the engine, between browsers through the real team script
 * (team-sync/Code.gs in the simulator) with accounts: tagging and the remembered "no", bulk changes,
 * suggestions from deals, the admin's list, tags following a customer (a deal linked, a client renamed,
 * duplicates merged) while teammates edit, who may do what, counting, CSV, backups, an older build's
 * tab on the same browser, and the full 55k registry.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { ctMatcher } from './ctypes';
import { memoryStore, prefs, PREF } from './storage';
import type { Role } from './teamSync';
import type { Company, Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 60000 });
const URL = 'https://script.google.com/macros/s/ct/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

/** localStorage per browser: each engine reads and writes the one of its browser. */
const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});
type Store = ReturnType<typeof memoryStore>;
/** `pushes`: the ops of every push this browser sent; `offline`: its requests fail as with no network. */
interface Tab { e: GccEngine; raw: GccEngine; store: Store; browser: string; pushes: { k: string; v?: unknown; del?: boolean }[][]; net: { offline: boolean } }

let full: Dataset, base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  full = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' };
  const rows = g.rows.slice(0, 700);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { ...full, rows, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])) };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
/** The app's data files, for a page load (load()). */
vi.stubGlobal('fetch', async (u: string) => {
  const f = String(u).split('/').pop();
  const body = f === 'gcc.json' ? { asOf: base.asOf, dicts: base.dicts, rows: base.rows } : f === 'gcc-certs.json' ? { dicts: base.cdicts, rows: base.certs } : f === 'rounds.json' ? R : [];
  return { json: async () => structuredClone(body) };
});
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
});

/** An engine on `browser` (`data`: the dataset; a second tab of a browser: pass that tab's store). */
function mk(browser: string, store: Store = memoryStore(), data = base): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(data);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-06';
  raw.store = store;
  raw.rebuild();
  raw.loading = false;
  const pushes: Tab['pushes'] = [], net = { offline: false };
  raw.transport = async (_u, body) => {
    if (net.offline) throw new TypeError('Failed to fetch');
    if (body.action === 'push') pushes.push(body.ops as Tab['pushes'][number]);
    return sim.post(body);
  };
  raw.fileTransport = async (_u, body) => sim.post(body);
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
  const tab = { e, raw, store, browser, pushes, net };
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
/** The sheet's last row for a record (null: none). */
function last(k: string) {
  const sh = sim.sheet();
  const r = (sh ? sh.rows.slice(1) : []).filter((x) => x[1] === k).pop();
  return r ? { k: r[1], v: r[2] === '' ? null : JSON.parse(r[2]), del: r[3] === '1', by: r[4] } : null;
}
const later = (s: number) => vi.setSystemTime(Date.now() + s * 1000);
/** Registry companies shared with the team. */
const cos = (t: Tab, n: number, from = 0) => t.e.B.companies.filter((c) => c.id < 900000).slice(from, from + n);

/** A new team script; the lead claims it from browser L (an admin, หัวหน้า). */
async function lead() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const L = mk('L');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หัวหน้า', 'lead-pass-123');
  expect(L.e.role()).toBe('admin');
  return L;
}
/** An account the admin made, signed in on its own browser with its own password. */
async function member(L: Tab, u: string, name: string, role: Role, data = base) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(u, memoryStore(), data);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  expect(M.e.auth).toBe('');
  await settle(M);
  return M;
}
async function team() {
  const L = await lead();
  const S = await member(L, 'somchai', 'สมชาย', 'sales');
  await settle(L, S);
  return { L, S };
}
const ctagRows = <T extends { k: string }>(ops: T[]) => ops.filter((o) => o.k.startsWith('ctag/'));

describe('tagging between browsers', () => {
  it('a type ticked on one browser shows on the other, in the account\'s name; untick = a remembered "no"; no company is recomputed', async () => {
    const { L, S } = await team();
    const [c] = cos(S, 1);
    const recalc = vi.spyOn(S.raw, 'recalc'), rebuild = vi.spyOn(S.raw, 'rebuild');
    expect(S.e.setTypes(c, ['vvb', 'cfo'], [])).toBe(2);
    expect(S.e.typesOf(c)).toEqual(['cfo', 'vvb']); // list order, whatever order they were ticked in
    expect(recalc).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
    await settle(S, L);
    expect(L.e.typesOf(c.id)).toEqual(['cfo', 'vvb']);
    expect(last(`ctag/${c.id}/vvb`)).toMatchObject({ del: false, by: 'สมชาย', v: { s: 'y', by: 'สมชาย', src: 'hand' } });
    later(60);
    expect(L.e.setTypes(c, [], ['cfo', 'tvr'])).toBe(1); // tvr: never had it, so nothing to say
    await settle(L, S);
    expect(S.e.typesOf(c)).toEqual(['vvb']);
    expect(S.e.ctagsOf(c).get('cfo')).toMatchObject({ s: 'n', by: 'หัวหน้า', src: 'hand' });
    expect(S.e.ctagsOf(c).has('tvr')).toBe(false);
    // ticking what it has changes nothing, sends nothing
    const n = S.pushes.length;
    expect(S.e.setTypes(c, ['vvb'], [])).toBe(0);
    await settle(S);
    expect(S.pushes.length).toBe(n);
  });

  it('bulk: what is ticked is added, what is unticked is taken from those that have it, the rest stays; one push; at most 500', async () => {
    const { L, S } = await team();
    const list = cos(S, 40);
    S.e.setType(list[0], 'vvb', 'y');
    S.e.setTypes(list[1], ['tvr', 'cfp'], []);
    S.e.setTypes(list[2], ['tvr'], []);
    await settle(S, L);
    const n0 = S.pushes.length;
    expect(S.e.bulkSetTypes(list, ['cfo'], ['tvr'])).toEqual({ n: 42, cos: 40, capped: false });
    await settle(S, L);
    const sent = S.pushes.slice(n0).map(ctagRows).filter((x) => x.length);
    expect(sent.map((x) => x.length)).toEqual([42]); // every change a small record, in one push
    expect(sent[0].every((o) => (o.v as { src: string }).src === 'bulk')).toBe(true);
    expect(L.e.typesOf(list[0])).toEqual(['cfo', 'vvb']); // a type not in the action stays as it was
    expect(L.e.typesOf(list[1])).toEqual(['cfo', 'cfp']);
    expect(L.e.typesOf(list[2])).toEqual(['cfo']);
    expect(L.e.ctagsOf(list[5]).has('tvr')).toBe(false);
    // a customer listed twice (a company and its deal) counts once; more than 500: the first 500
    const d = S.e.addDeal({ gid: list[3].id, year: '2569' });
    expect(S.e.bulkSetTypes([list[3], d, list[3].id], ['cfp'], [])).toEqual({ n: 1, cos: 1, capped: false });
    const many = cos(S, 520);
    expect(many.length).toBe(520);
    expect(S.e.bulkSetTypes(many, ['plt'], [])).toMatchObject({ n: 500, cos: 500, capped: true });
    expect(many.slice(500).every((c) => !S.e.typesOf(c).includes('plt'))).toBe(true);
    await settle(S, L);
    expect(L.e.ctCounts('2569').by.plt.cos).toBe(500);
  });

  it('the latest answer wins on one record, whichever push reaches the sheet first', async () => {
    const { L, S } = await team();
    const [c] = cos(S, 1);
    // S says "yes" offline; later the lead says "no" and sends it first
    S.net.offline = true;
    S.e.setType(c, 'cfp', 'y');
    later(30);
    L.e.setType(c, 'cfp', 'n');
    await settle(L);
    S.net.offline = false;
    await settle(S, L);
    for (const t of [L, S]) expect(t.e.ctagsOf(c).get('cfp')).toMatchObject({ s: 'n', by: 'หัวหน้า' });
    expect(last(`ctag/${c.id}/cfp`)!.v).toMatchObject({ s: 'n' });
    // the other way round: the older answer, sent last, does not undo the newer one
    later(30);
    L.net.offline = true;
    L.e.setType(c, 'tvr', 'n');
    later(30);
    S.e.setType(c, 'tvr', 'y');
    await settle(S);
    L.net.offline = false;
    await settle(L, S);
    for (const t of [L, S]) expect(t.e.typesOf(c)).toContain('tvr');
  });
});

describe('suggestions from deals', () => {
  it('from the deals\' Services, not from a lost deal; "ไม่ใช่" is remembered on every browser; confirming writes them as from the deals', async () => {
    const { L, S } = await team();
    const [c1, c2] = cos(S, 2);
    const d1 = S.e.addDeal({ gid: c1.id, year: '2569' });
    S.e.updateDeal(d1.id, { service: ['VVB', 'Course Training'] });
    expect(S.e.suggestionsOf(c1)).toEqual([{ t: 'vvb', why: [{ deal: d1.id, year: '2569', svc: 'VVB' }] }]);
    expect(S.e.suggestionsOf(d1)).toEqual(S.e.suggestionsOf(c1));
    expect(S.e.typeForService(d1, 'VVB')).toBe('vvb');
    expect(S.e.typeForService(d1, 'Course Training')).toBeNull();
    // lost (ผลการขาย NO): no suggestion; back to waiting: it suggests again
    const d2 = S.e.addDeal({ gid: c2.id, year: '2569', service: ['CFO'] });
    expect(S.e.suggestionsOf(c2).map((x) => x.t)).toEqual(['cfo']);
    S.e.setStep(d2.id, 'CLOSED DEAL', { d: '', n: 'NO' });
    expect(S.e.suggestionsOf(c2)).toEqual([]);
    S.e.setStep(d2.id, 'CLOSED DEAL', { d: '', n: 'รอผู้บริหาร' });
    expect(S.e.suggestionsOf(c2).map((x) => x.t)).toEqual(['cfo']);
    // a client not in the registry is suggested under its name
    const d3 = S.e.addDeal({ client: 'บริษัท ลูกค้าในแทร็กเกอร์ จำกัด', year: '2569', service: ['CFP'] });
    expect(S.e.suggestionsOf(d3).map((x) => x.t)).toEqual(['cfp']);
    expect(S.e.ctCounts('2569').sug).toBe(3);
    // "ไม่ใช่": never again, here or for the team, also with a new deal next year
    expect(S.e.dismissSuggestion(c1, 'vvb')).toBe(true);
    await settle(S, L);
    expect(L.e.suggestionsOf(c1)).toEqual([]);
    expect(L.e.ctagsOf(c1).get('vvb')).toMatchObject({ s: 'n', src: 'deal', by: 'สมชาย' });
    L.e.addDeal({ gid: c1.id, year: '2570', service: ['VVB'] });
    expect(L.e.suggestionsOf(c1)).toEqual([]);
    expect(L.e.typeForService(d1, 'VVB')).toBeNull();
    // "ยืนยันที่แนะนำ": every one left, from the deals
    await settle(L, S);
    expect(L.e.confirmSuggestions()).toBe(2);
    await settle(L, S);
    expect(S.e.typesOf(c2)).toEqual(['cfo']);
    expect(S.e.typesOf(d3)).toEqual(['cfp']);
    expect(last('ctag/n:ลูกค้าในแทร็กเกอร์/cfp')!.v).toMatchObject({ s: 'y', src: 'deal', by: 'หัวหน้า' });
    expect(S.e.ctCounts('2569').sug).toBe(0);
  });

  it('a customer added with types, and companies sent to the tracker with types: written as "new", only added', async () => {
    const { L, S } = await team();
    const id = S.e.addCustomer({ name: 'บริษัท เพิ่มเองพร้อมประเภท จำกัด', jur: '', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' }, ['cfo', 'tvr']);
    expect(S.e.typesOf(id)).toEqual(['cfo', 'tvr']);
    const [a, b] = cos(S, 2, 10);
    S.e.setType(b, 'vvb', 'y');
    expect(S.e.addDealsFromCompanies([a.id, b.id], { year: '2569', types: ['cfp'] })).toEqual({ added: 2, skipped: 0 });
    await settle(S, L);
    expect(L.e.typesOf(id)).toEqual(['cfo', 'tvr']);
    expect(L.e.typesOf(a)).toEqual(['cfp']);
    expect(L.e.typesOf(b)).toEqual(['cfp', 'vvb']);
    expect(L.e.ctagsOf(a).get('cfp')!.src).toBe('new');
    // the customer and its types went out together
    const p = S.pushes.find((ops) => ops.some((o) => o.k === `cust/${id}`))!;
    expect(ctagRows(p).map((o) => o.k)).toEqual(expect.arrayContaining([`ctag/${id}/cfo`, `ctag/${id}/tvr`]));
  });
});

describe('the list (admin only)', () => {
  it('sales and viewers cannot change it, here or on the sheet; the admin\'s add, rename, colour and order reach everyone; tags survive a rename', async () => {
    const { L, S } = await team();
    const V = await member(L, 'vee', 'วี', 'viewer');
    const [c] = cos(S, 1);
    S.e.setTypes(c, ['vvb', 'cfo'], []);
    await settle(S, L, V);
    for (const t of [S, V]) {
      expect(t.e.addType({ n: 'อบรม' })).toBe('');
      expect(t.e.saveType('vvb', { n: 'x' })).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
      t.e.retireType('plt');
      t.e.reorderTypes(['tvr']);
      expect(t.e.setTypeServices('vvb', ['VVB', 'GCT'])).toEqual([]);
      expect(t.e.typeDefs().map((d) => [d.id, d.n, !!d.off])).toEqual(L.e.typeDefs().map((d) => [d.id, d.n, !!d.off]));
      expect(t.e.teamPendingN).toBe(0);
    }
    const id = L.e.addType({ n: 'อบรม', d: 'งานอบรม', svc: ['Course Training'] });
    expect(id).toMatch(/^t[0-9a-z]{4}$/);
    expect(L.e.addType({ n: ' อบรม ' })).toBe(''); // the name is taken
    expect(L.e.saveType('vvb', { n: 'CFO' })).toBe('มีประเภทลูกค้าชื่อนี้แล้ว');
    expect(L.e.saveType('vvb', { n: 'Verification', c: 1 })).toBe('');
    L.e.reorderTypes(['cfp', 'cfo']);
    await settle(L, S, V);
    for (const t of [S, V]) {
      expect(t.e.typeDefs().map((d) => d.id)).toEqual(['cfp', 'cfo', 'con', 'vvb', 'plt', 'tvr', id]);
      expect(t.e.typeDef('vvb')).toMatchObject({ n: 'Verification', c: 1, d: 'งานทวนสอบ (VVB)', svc: ['VVB'] });
      expect(t.e.typeDef(id)).toMatchObject({ n: 'อบรม', d: 'งานอบรม', svc: ['Course Training'], c: 0 });
      expect(t.e.typesOf(c)).toEqual(['cfo', 'vvb']); // kept by id, shown in list order
    }
    expect(last(`scfg/ct.${id}`)).toMatchObject({ by: 'หัวหน้า', del: false });
    // only the two types that moved were written for the new order
    expect(last('scfg/ct.cfp')!.v).toMatchObject({ o: 0 });
    expect(last('scfg/ct.con')).toBeNull();
    // a deal with Course Training now suggests the new type
    const d = S.e.addDeal({ gid: c.id, year: '2569', service: ['Course Training'] });
    expect(S.e.suggestionsOf(d).map((x) => x.t)).toEqual([id]);
    // the CSV names the current names, in list order; a name an admin typed never runs as a formula
    expect(L.e.saveType(id, { n: '=อบรม+1' })).toBe('');
    const [c2] = cos(L, 1, 1);
    L.e.setTypes(c, [id], []);
    L.e.setTypes(c2, [id], []);
    const csv = L.e.registryCsv('co', [L.e.company(c.id)!, L.e.company(c2.id)!]).split('\r\n');
    expect(csv[0].endsWith(',"รวมจากรหัส","ประเภทลูกค้า"')).toBe(true);
    expect(csv[1].endsWith(',"CFO · Verification · =อบรม+1"')).toBe(true);
    expect(csv[2].endsWith(`,"'=อบรม+1"`)).toBe(true);
  });

  it('retired: out of the pickers and suggestions, still on companies and in the CSV, cannot be added, can be taken off; brought back', async () => {
    const { L, S } = await team();
    const [c, c2] = cos(S, 2);
    S.e.setTypes(c, ['plt'], []);
    const d = S.e.addDeal({ gid: c2.id, year: '2569', service: ['GCT'] });
    await settle(S, L);
    L.e.retireType('plt');
    await settle(L, S);
    expect(S.e.typeDefs(true).map((x) => x.id)).not.toContain('plt');
    expect(S.e.typeDef('plt')!.off).toBe('2026-10-06');
    expect(S.e.typesOf(c)).toEqual(['plt']);
    expect(S.e.suggestionsOf(d)).toEqual([]);
    expect(S.e.setType(c2, 'plt', 'y')).toBe(false);
    expect(S.e.ctCounts('2569').by.plt.cos).toBe(1);
    expect(S.e.registryCsv('co', [S.e.company(c.id)!]).split('\r\n')[1].endsWith(',"แพลตฟอร์ม"')).toBe(true);
    expect(S.e.setTypes(c, [], ['plt'])).toBe(1);
    L.e.retireType('plt', false);
    await settle(L, S);
    expect(S.e.typeDef('plt')!.off).toBeUndefined();
    expect(S.e.suggestionsOf(d).map((x) => x.t)).toEqual(['plt']);
  });

  it('one service, one type: picking a service moves it; two admins editing one type at once both keep their change', async () => {
    const { L, S } = await team();
    const A2 = await member(L, 'boss2', 'หัวหน้าสอง', 'admin');
    await settle(L, S, A2);
    expect(L.e.serviceOwner('VVB')).toBe('vvb');
    expect(L.e.setTypeServices('con', ['LESS', 'Program Development', 'VVB'])).toEqual([{ svc: 'VVB', from: 'vvb' }]);
    await settle(L, S, A2);
    expect(S.e.typeDef('vvb')!.svc).toEqual([]);
    expect(S.e.serviceOwner('VVB')).toBe('con');
    const d = S.e.addDeal({ gid: cos(S, 1)[0].id, year: '2569', service: ['VVB'] });
    expect(S.e.suggestionsOf(d).map((x) => x.t)).toEqual(['con']);
    // the lead renames CFP while the second admin, not having pulled it, changes its description and services
    L.e.saveType('cfp', { n: 'CFP ผลิตภัณฑ์' });
    L.e.setTypeServices('cfp', ['CFP', 'CF-EVENT']);
    A2.e.saveType('cfp', { d: 'คาร์บอนฟุตพริ้นท์ของสินค้า' });
    A2.e.setTypeServices('cfp', ['CFP', 'GCT']); // GCT moves from แพลตฟอร์ม
    await settle(L, A2, S, L, A2);
    for (const t of [L, A2, S]) {
      expect(t.e.typeDef('cfp')).toMatchObject({ n: 'CFP ผลิตภัณฑ์', d: 'คาร์บอนฟุตพริ้นท์ของสินค้า' });
      expect(t.e.typeDef('cfp')!.svc.slice().sort()).toEqual(['CF-EVENT', 'CFP', 'GCT']);
      expect(t.e.typeDef('plt')!.svc).toEqual([]);
    }
  });
});

describe('tags follow the customer', () => {
  it('a free-text deal linked to a company: its tags go there in the same push; the name keeps them while another year\'s deal is not linked', async () => {
    const { L, S } = await team();
    const [c] = cos(S, 1, 20);
    const d68 = S.e.addDeal({ client: 'บริษัท ฟรีเท็กซ์ จำกัด', year: '2568' });
    const d69 = S.e.addDeal({ client: 'ฟรีเท็กซ์', year: '2569' });
    expect(S.e.ckeyOf(d69)).toBe('n:ฟรีเท็กซ์');
    S.e.setTypes(d69, ['cfo', 'vvb'], []);
    expect(S.e.typesOf(d68)).toEqual(['cfo', 'vvb']); // one customer across years
    expect(S.e.ctTrackerOnly().map((x) => x.key)).toEqual(['n:ฟรีเท็กซ์']);
    await settle(S, L);
    const n0 = S.pushes.length;
    S.e.updateDeal(d69.id, { gid: c.id });
    await settle(S, L);
    const p = S.pushes.slice(n0).find((ops) => ops.some((o) => o.k === `deal/${d69.id}`))!;
    expect(ctagRows(p).map((o) => o.k).sort()).toEqual([`ctag/${c.id}/cfo`, `ctag/${c.id}/vvb`]); // nothing removed yet
    for (const t of [L, S]) {
      expect(t.e.typesOf(c)).toEqual(['cfo', 'vvb']);
      expect(t.e.typesOf(t.e.sales.deals[d68.id])).toEqual(['cfo', 'vvb']); // the same customer now: the company
      expect(t.e.ctTrackerOnly()).toEqual([]);
    }
    expect(last('ctag/n:ฟรีเท็กซ์/cfo')!.del).toBe(false);
    // the last deal by that name is linked: the name's records go
    S.e.updateDeal(d68.id, { gid: c.id });
    await settle(S, L);
    expect(last('ctag/n:ฟรีเท็กซ์/cfo')!.del).toBe(true);
    expect(L.e.ctags['n:ฟรีเท็กซ์']).toBeUndefined();
    expect(L.e.typesOf(c)).toEqual(['cfo', 'vvb']);
    // a client renamed: its tags follow the new name
    const d2 = S.e.addDeal({ client: 'ลูกค้าเปลี่ยนชื่อ', year: '2569' });
    S.e.setType(d2, 'tvr', 'y');
    S.e.updateDeal(d2.id, { client: 'ลูกค้าชื่อใหม่' });
    await settle(S, L);
    expect(L.e.typesOf(L.e.sales.deals[d2.id])).toEqual(['tvr']);
    expect(Object.keys(L.e.ctags).filter((k) => k.startsWith('n:ลูกค้า'))).toEqual(['n:ลูกค้าชื่อใหม่']);
  });

  it('linking while a teammate answers on the name: the newer answer stays, in either order', async () => {
    const { L, S } = await team();
    const [c, c2] = cos(S, 2, 30);
    const d = S.e.addDeal({ client: 'ลูกค้าพร้อมกัน', year: '2569' });
    S.e.setType(d, 'cfo', 'y');
    await settle(S, L);
    // the lead links it offline; the teammate says "no" on the name and sends it first
    L.net.offline = true;
    L.e.updateDeal(d.id, { gid: c.id });
    later(30);
    S.e.setType(d, 'cfo', 'n');
    await settle(S);
    L.net.offline = false;
    await settle(L, S, L);
    for (const t of [L, S]) {
      expect(t.e.sales.deals[d.id].gid).toBe(c.id);
      expect(t.e.typesOf(c)).toEqual([]);
      expect(t.e.ctagsOf(c).get('cfo')).toMatchObject({ s: 'n', by: 'สมชาย' });
    }
    expect(last('ctag/n:ลูกค้าพร้อมกัน/cfo')).toMatchObject({ del: false, v: { s: 'n' } }); // the lead's removal yielded
    // the other order: the link is sent first, the teammate (not pulled) answers on the name after
    const e2 = S.e.addDeal({ client: 'ลูกค้าพร้อมกันสอง', year: '2569' });
    S.e.setType(e2, 'cfp', 'y');
    await settle(S, L);
    S.net.offline = true;
    later(30);
    L.e.updateDeal(e2.id, { gid: c2.id });
    await settle(L);
    later(30);
    S.e.setType(e2, 'tvr', 'y');
    S.net.offline = false;
    await settle(S, L, S);
    for (const t of [L, S]) expect(t.e.typesOf(c2)).toEqual(['cfp', 'tvr']); // read through the deal linked under that name
  });

  it('merging duplicates (a customer added by hand into its registry row): tags move to the primary with the decision; the later answer wins; a teammate\'s answer meanwhile stays', async () => {
    const { L, S } = await team();
    const reg = L.e.B.companies.find((c) => c.id < 900000 && c.jur && c.ids.length === 1 && L.e.B.companies.filter((x) => x.name === c.name).length === 1)!;
    const x = S.e.addCustomer({ name: reg.name, jur: '0000000000001', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' });
    expect(S.e.company(x)!.id).toBe(x); // a different juristic id: a group waiting for a decision
    S.e.setTypes(reg, ['vvb'], []);
    later(10);
    S.e.setTypes(x, ['cfo', 'vvb'], []);
    later(10);
    S.e.setTypes(x, [], ['vvb']); // the newer answer for vvb is "no"
    await settle(S, L);
    const g = L.e.B.groups.find((y) => y.ids.includes(x) && y.ids.includes(reg.id))!;
    expect(g.state).toBe('pending');
    const n0 = L.pushes.length;
    L.e.decide(g.key, 'merge');
    expect(L.e.company(x)!.id).toBe(reg.id);
    await settle(L, S);
    const p = L.pushes.slice(n0).find((ops) => ops.some((o) => o.k === `dedup/${g.key}`))!;
    expect(ctagRows(p).map((o) => `${o.k}${o.del ? ' del' : ''}`).sort()).toEqual([`ctag/${reg.id}/cfo`, `ctag/${reg.id}/vvb`, `ctag/${x}/cfo del`, `ctag/${x}/vvb del`].sort());
    for (const t of [L, S]) {
      expect(t.e.typesOf(reg)).toEqual(['cfo']);
      expect(t.e.ctagsOf(reg).get('vvb')!.s).toBe('n');
      expect(t.e.ctags[String(x)]).toBeUndefined();
    }
    // the same decision again moves nothing more
    const n1 = L.pushes.length;
    L.e.decide(g.key, 'merge');
    await settle(L);
    expect(L.pushes.slice(n1).flatMap(ctagRows)).toEqual([]);
    // a teammate who had not pulled the merge answers on the added-by-hand id: still read on the company
    S.net.offline = true;
    later(10);
    S.e.setTypes(x, ['tvr'], []);
    S.net.offline = false;
    await settle(S, L);
    for (const t of [L, S]) expect(t.e.typesOf(reg)).toEqual(['cfo', 'tvr']);
  });
});

describe('who may, counting, files and storage', () => {
  it('an admin made sales with type changes queued: refused by the script, and the team\'s list comes back', async () => {
    const L = await lead();
    const B = await member(L, 'boss', 'บอส', 'admin');
    L.e.saveType('cfp', { d: 'ของทีม' });
    await settle(L, B);
    B.net.offline = true;
    const id = B.e.addType({ n: 'ประเภทใหม่' });
    B.e.saveType('cfp', { n: 'ชื่อที่ไม่ได้ส่ง', d: 'ไม่ได้ส่ง' });
    B.e.saveType('tvr', { n: 'T-VER ใหม่' });
    expect(B.e.typeDef(id)).toBeTruthy();
    await L.e.adminUpdate('boss', { role: 'sales' });
    B.net.offline = false;
    await settle(B, B);
    expect(B.e.role()).toBe('sales');
    expect(B.e.teamPendingN).toBe(0);
    expect(B.e.typeDef(id)).toBeUndefined(); // no team row: gone
    expect(B.e.typeDef('cfp')).toMatchObject({ n: 'CFP', d: 'ของทีม' }); // the team's record back
    expect(B.e.typeDef('tvr')!.n).toBe('T-VER'); // no team row: the default again
    expect(await B.store.get('ctypes')).toEqual({ cfp: expect.objectContaining({ d: 'ของทีม' }) });
    for (const k of [`scfg/ct.${id}`, 'scfg/ct.tvr']) expect(last(k)).toBeNull();
  });

  it('tags made on a browser before it joined the team are uploaded when it signs in (the team\'s own answers win)', async () => {
    const L = await lead();
    const [a, b] = cos(L, 2, 60);
    L.e.setType(b, 'cfo', 'y');
    await settle(L);
    const { temp } = await L.e.adminCreate({ u: 'newbie', name: 'มือใหม่', role: 'sales' });
    const M = mk('newbie');
    later(60);
    M.e.setTypes(a, ['vvb'], []); // no team yet: kept on this browser
    M.e.setType(b, 'cfo', 'n');
    expect(M.e.typesOf(a)).toEqual(['vvb']);
    await M.raw.teamSyncNow();
    expect(await M.store.get('ctags')).toEqual(M.e.ctags);
    expect(await M.e.teamOpen(URL)).toBe('accounts');
    await M.e.teamLogin('newbie', temp, true);
    await M.e.teamChangePassword('', 'newbie-pass-123');
    await settle(M, L);
    expect(L.e.typesOf(a)).toEqual(['vvb']);
    expect(L.e.typesOf(b)).toEqual(['cfo']); // the team had an answer for it: the team's stands
    expect(M.e.typesOf(b)).toEqual(['cfo']);
  });

  it('a viewer: every call does nothing, nothing is queued or sent', async () => {
    const { L, S } = await team();
    const V = await member(L, 'vee', 'วี', 'viewer');
    const [c] = cos(V, 1);
    const d = S.e.addDeal({ gid: c.id, year: '2569', service: ['VVB'] });
    await settle(S, V);
    const n0 = V.pushes.length;
    expect(V.e.setType(c, 'cfo', 'y')).toBe(false);
    expect(V.e.setTypes(c, ['cfo'], [])).toBe(0);
    expect(V.e.bulkSetTypes([c], ['cfo'], [])).toEqual({ n: 0, cos: 0, capped: false });
    expect(V.e.dismissSuggestion(c, 'vvb')).toBe(false);
    expect(V.e.confirmSuggestions()).toBe(0);
    V.e.addDealsFromCompanies([c.id], { types: ['cfo'] });
    expect(V.e.typesOf(c)).toEqual([]);
    expect(V.e.suggestionsOf(d).map((x) => x.t)).toEqual(['vvb']); // a viewer still sees them (the screens hide the buttons)
    expect(V.e.teamNote).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
    expect(V.e.teamPendingN).toBe(0);
    await settle(V);
    expect(V.pushes.length).toBe(n0);
  });

  it('counting: the overview, the search type row and the tracker group agree; the CSVs carry the names', async () => {
    const { L, S } = await team();
    const [a, b, c] = cos(S, 3, 40);
    S.e.setTypes(a, ['cfo', 'vvb'], []);
    S.e.setTypes(b, ['vvb'], []);
    S.e.addDeal({ gid: a.id, year: '2569', forecast: 100000, service: ['VVB'] });
    S.e.addDeal({ gid: c.id, year: '2569', forecast: 5000 });
    const f = S.e.addDeal({ client: 'ลูกค้านอกทะเบียน', year: '2569', forecast: 700, service: ['CFP'] });
    S.e.addDeal({ gid: b.id, year: '2568', forecast: 1 });
    await settle(S, L);
    const n = L.e.ctCounts('2569');
    expect(n).toMatchObject({ pop: 4, none: 2, sug: 1, noneDeals: { deals: 2, forecast: 5700 } });
    expect(n.by.vvb).toEqual({ cos: 2, deals: 1, forecast: 100000 });
    expect(n.by.cfo).toEqual({ cos: 1, deals: 1, forecast: 100000 });
    const ix = L.e.ctIndex();
    const row = (sel: string) => L.e.B.companies.filter((x) => ctMatcher(ix, sel)(x.id)).length + L.e.ctTrackerOnly().filter((x) => ctMatcher(ix, sel)(x.key)).length;
    for (const d of L.e.typeDefs()) expect(row(d.id)).toBe(n.by[d.id].cos);
    expect([row('all'), row('none'), row('sug')]).toEqual([n.pop, n.none, n.sug]);
    // the registry CSV: the column last, Sales Tracker customers not in the registry as rows of their own
    const csv = L.e.registryCsv('co', [L.e.company(a.id)!], L.e.ctTrackerOnly()).split('\r\n');
    expect(csv[1].endsWith(',"CFO · ทวนสอบ"')).toBe(true);
    expect(csv[2]).toBe(['""', '"ลูกค้านอกทะเบียน"', ...Array(21).fill('""'), '""'].join(','));
    // the Sales Tracker CSV: right after the client
    S.e.setType(f, 'cfp', 'y');
    const sc = S.e.salesCsv([S.e.sales.deals[f.id]]).split('\r\n');
    expect(sc[0].startsWith('"NO.","หมวด","POTENTIAL CLIENT","ประเภทลูกค้า","รหัสบริษัท"')).toBe(true);
    expect(sc[1].split(',')[3]).toBe('"CFP"');
  });

  it('a backup carries the answers and the list; restoring fills what is missing or older; signing out with a wipe clears them', async () => {
    const { L, S } = await team();
    const [a, b] = cos(S, 2, 50);
    L.e.setTypes(a, ['cfo'], []);
    L.e.setTypes(b, ['tvr'], []);
    const id = L.e.addType({ n: 'อบรม' });
    L.e.setTypes(b, [id], []);
    const file = JSON.parse(JSON.stringify(L.e.backupData()));
    expect(Object.keys(file)).toEqual(expect.arrayContaining(['ctags', 'ctypes']));
    // a browser of its own (no team): an older "yes" in the file does not undo its newer "no"
    const C = mk('C');
    later(60);
    C.e.setType(b, 'tvr', 'n');
    file.ctags.zz = { cfo: { s: 'y' } }; // a key no one can use
    file.ctags[String(a.id)].Bad = { s: 'y' };
    await C.e.importCrm(Object.assign(new Blob([JSON.stringify(file)]), { name: 'b.json' }) as File);
    expect(C.e.typesOf(a)).toEqual(['cfo']);
    expect(C.e.typesOf(b)).toEqual([id]);
    expect(C.e.ctagsOf(b).get('tvr')!.s).toBe('n');
    expect(C.e.typeDef(id)!.n).toBe('อบรม');
    expect(Object.keys(C.e.ctags).sort()).toEqual([String(a.id), String(b.id)].sort());
    expect(await C.store.get('ctags')).toEqual(C.e.ctags);
    // signing out of a shared computer with a wipe: the team's customer types go with the rest
    await settle(S);
    S.e.setType(a, 'vvb', 'y');
    await settle(S);
    expect(await S.store.get('ctags')).not.toBeNull();
    await S.e.teamLogout({ wipe: true });
    expect(await S.store.get('ctags')).toBeNull();
    expect(await S.store.get('ctypes')).toBeNull();
  });

  it('an older build\'s tab on the same browser, saving its whole Sales Tracker and CRM, never touches the customer types', async () => {
    const { L, S } = await team();
    const [a] = cos(S, 1);
    S.e.setTypes(a, ['cfo'], []);
    L.e.saveType('vvb', { n: 'Verification' });
    await settle(L, S);
    await S.raw.teamSyncNow();
    // what an older tab writes: the stores it knows, whole, from its own copy (no customer types in it)
    await S.store.set('sales', structuredClone(S.e.sales));
    await S.store.set('crm', structuredClone(S.e.crm));
    expect(await S.store.get('ctags')).toEqual({ [String(a.id)]: { cfo: expect.objectContaining({ s: 'y' }) } });
    expect(await S.store.get('ctypes')).toEqual({ vvb: expect.objectContaining({ n: 'Verification' }) });
    // the next page of this build reads them back from its own keys before anything is pulled
    S.net.offline = true;
    const T = mk('somchai', S.store);
    T.net.offline = true;
    at('somchai', () => prefs.set(PREF.sync, { freq: 'off' }));
    const p = T.e.load();
    for (let i = 0; i < 20; i++) await tick();
    await at('somchai', () => vi.advanceTimersByTimeAsync(40));
    await p;
    expect(T.e.ready).toBe(true);
    expect(T.e.typesOf(a)).toEqual(['cfo']);
    expect(T.e.typeDef('vvb')!.n).toBe('Verification');
  });
});

describe('the full registry', () => {
  it('55k companies: tagging never recomputes a company; the index builds from the tags and deals, a search pass is one lookup each', () => {
    const A = mk('A', memoryStore(), full);
    at('A', () => prefs.set(PREF.me, 'เอ'));
    const all = A.e.B.companies;
    expect(all.length).toBeGreaterThan(50000);
    const recalc = vi.spyOn(A.raw, 'recalc');
    const picks = all.filter((_, i) => i % 25 === 0).slice(0, 2000);
    for (let i = 0; i < picks.length; i += 500) A.e.bulkSetTypes(picks.slice(i, i + 500), [i % 1000 ? 'vvb' : 'cfo'], []);
    for (let i = 0; i < 300; i++) A.e.addDeal({ gid: all[i * 7].id, year: '2569', service: ['CFO', 'VVB'] });
    expect(recalc).not.toHaveBeenCalled();
    vi.useRealTimers();
    try {
      const t0 = performance.now();
      const ix = A.e.ctIndex();
      const t1 = performance.now();
      const m = ctMatcher(ix, 'vvb');
      let hits = 0;
      for (const c of all) if (m(c.id)) hits++;
      const n = A.e.ctCounts('2569');
      const t2 = performance.now();
      expect(hits).toBe(n.by.vvb.cos);
      expect(t1 - t0).toBeLessThan(400);
      expect(t2 - t1).toBeLessThan(400);
      // memoised: asking again is free until something changes
      expect(A.e.ctIndex()).toBe(ix);
      A.e.setType(all[3], 'cfp', 'y');
      expect(A.e.ctIndex()).not.toBe(ix);
    } finally {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
    }
  });
});

/** Run with `browser`'s localStorage as the current one. */
function at<T>(browser: string, fn: () => T) {
  cur = browser;
  return fn();
}
export type { Company };
