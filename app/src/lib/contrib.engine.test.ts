/**
 * Units, revenue splits and commission in the engine (package dash), end to end with this release's team
 * script (team-sync/Code.gs, protocol v4) in the simulator. No script change is needed: the allow-list,
 * the redaction for accounts without ดูค่าคอมมิชชั่น and the split's removal with its deal shipped in phase 2.
 * - an admin sets up units (rates, people) and a deal's split; they reach another admin as written;
 * - a sales account (no view.comm) receives no split and no rates, sees no card, and may change neither;
 * - a role given ดูค่าคอมมิชชั่น receives them after its next pull; แก้สัดส่วน lets it save a split;
 * - deleting a deal removes its split on the script, also for an account that may not change splits;
 * - with the team code (no identity) the cards stay hidden; this browser alone shows them;
 * - a unit saved as ไม่คิด and given a rate later: from that day, unless the admin asks for the money before too;
 * - a unit used again while a live unit took its colour gets a free one;
 * - a retired unit keeps the money received before the day it was retired, not what comes in after;
 * - a team backup restores the units, their people and the splits (and uploads them when connected).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN } from './caps';
import { contribIn, periodRange, shareOf, staffKey, unassigned, unitCtx, unitOfName } from './contrib';
import { cashLines } from './sales';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/u/exec';
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

const T0 = new Date('2026-10-12T03:00:00Z');
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 60);
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
function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-12';
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
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(u);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  await settle(M);
  return M;
}
/** What the script holds for key k (as an admin pulls it). */
const stored = (L: Tab, k: string) => sim.post({ action: 'pull', since: 0, cv: 4, tok: L.e.session!.tok }).rows!.filter((r) => r.k === k).at(-1);

/** The lead's setup: two units with their people, a won deal of เอก paid 100,000 on 15 ส.ค., split 60/40. */
async function setUp(L: Tab) {
  const sale = L.e.saveUnit(null, { n: 'ฝ่ายขาย', r: 5, svc: {}, members: ['หมิว', 'เอก'] })!;
  const cons = L.e.saveUnit(null, { n: 'ฝ่ายที่ปรึกษา', r: 3, svc: { VVB: 5 }, members: ['มกร'] })!;
  const d = L.e.addDeal({ client: 'บริษัท แบ่งรายได้ จำกัด', resp: 'เอก', year: '2569' });
  L.e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-01', n: 'YES' });
  L.e.setPlan(d.id, [{ stage: 'PAY1', amt: 100000, pct: null, due: '2026-08-15', rel: null, how: 'transfer', howT: '', note: '' }]);
  L.e.markPaid(d.id, 'PAY1', { date: '2026-08-15', amount: 100000, how: 'transfer' });
  L.e.setShare(d.id, [{ u: sale, p: 60 }, { u: cons, p: 40 }]);
  await settle(L);
  return { sale, cons, d };
}

describe('units and splits with this release\'s team script', () => {
  it('an admin\'s units, people and split reach the team as written; commission is worked out from them', async () => {
    const L = await lead();
    const { sale, cons, d } = await setUp(L);
    expect(L.e.teamPendingN).toBe(0);
    expect(L.e.seesComm()).toBe(true);
    expect(stored(L, 'scfg/unit.' + sale)!.v).toMatchObject({ n: 'ฝ่ายขาย', c: 1, rates: [{ from: '', r: 5 }] });
    expect(stored(L, 'scfg/unitm.' + staffKey('เอก'))!.v).toMatchObject({ unit: sale, n: 'เอก' });
    expect(stored(L, 'dshare/' + d.id)!.v).toMatchObject({ lines: [{ u: sale, p: 60 }, { u: cons, p: 40 }], by: 'หมิว' });
    // the history says a split changed, never the split
    const logs = Object.values(L.e.sales.log).filter((x) => x.deal === d.id && x.action === 'แก้สัดส่วนรายได้');
    expect(logs).toHaveLength(1);
    expect(logs[0].detail).toBe('');
    // another admin's browser holds the same and works out the same commission
    const A2 = await member(L, 'ton', 'ต้น', 'admin');
    const ctx = unitCtx(A2.e.sales);
    expect(unitOfName(ctx, 'เอก')).toBe(sale);
    expect(shareOf(ctx, A2.e.sales.deals[d.id]).lines).toEqual([{ u: sale, p: 60 }, { u: cons, p: 40 }]);
    const c = contribIn(ctx, cashLines(A2.e.sales, Object.values(A2.e.sales.deals), '2026-10-12'), periodRange('2569', 2));
    expect([c.by[sale].comm, c.by[cons].comm, c.comm]).toEqual([3000, 1200, 4200]);
  });

  it('a sales account receives no split and no rates, shows no card, and may change neither', async () => {
    const L = await lead();
    const { sale, cons, d } = await setUp(L);
    const S = await member(L, 'aek', 'เอก', 'sales');
    expect(S.e.myCaps()).toEqual(BUILTIN.sales.c);
    expect(S.e.seesComm()).toBe(false);
    // what the script sent: units by name and their people (the default split needs them), no rates, no split
    expect(S.e.sales.units![sale]).toMatchObject({ n: 'ฝ่ายขาย', rates: [] });
    expect(S.e.sales.units![cons].rates).toEqual([]);
    expect(S.e.sales.unitm![staffKey('เอก')].unit).toBe(sale);
    expect(S.e.sales.shares?.[d.id]).toBeUndefined();
    const ctx = unitCtx(S.e.sales);
    expect(contribIn(ctx, cashLines(S.e.sales, Object.values(S.e.sales.deals), '2026-10-12'), periodRange('2569', 'year')).comm).toBe(0);
    // nothing to change here, and the script refuses it whatever a browser sends
    S.e.setShare(d.id, [{ u: sale, p: 100 }]);
    expect(S.e.teamNote).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
    expect(S.e.canWriteKey('dshare/' + d.id, false)).toBe(false);
    expect(S.e.canWriteKey('scfg/unit.' + sale, false)).toBe(false);
    expect(S.e.canWriteKey('scfg/unitm.' + staffKey('เอก'), false)).toBe(false);
    S.e.saveUnit(sale, { n: 'ฝ่ายขายของเอก', r: 50, svc: {} });
    expect(S.e.sales.units![sale].n).toBe('ฝ่ายขาย');
    const forced = sim.post({ action: 'push', cv: 4, tok: S.e.session!.tok, ops: [{ k: 'dshare/' + d.id, v: { lines: [{ u: sale, p: 100 }] } }, { k: 'scfg/unit.' + sale, v: { n: 'x', c: 1, o: 0, rates: [{ from: '', r: 50 }] } }] });
    expect(forced.denied).toEqual(['dshare/' + d.id, 'scfg/unit.' + sale]);
    expect(stored(L, 'dshare/' + d.id)!.v).toMatchObject({ lines: [{ u: sale, p: 60 }, { u: cons, p: 40 }] });
  });

  it('a role given ดูค่าคอมมิชชั่น receives splits and rates on its next pull; with แก้สัดส่วน it saves one', async () => {
    const L = await lead();
    const { sale, cons, d } = await setUp(L);
    const S = await member(L, 'aek', 'เอก', 'sales');
    expect(S.e.sales.shares?.[d.id]).toBeUndefined();
    const { id } = await L.e.roleSave({ n: 'หัวหน้าฝ่ายขาย', d: '', c: { ...BUILTIN.sales.c, 'view.comm': 'all', 'edit.share': 'all' } });
    await L.e.adminUpdate('aek', { role: id });
    await settle(S);
    await settle(S);
    expect(S.e.seesComm()).toBe(true);
    expect(S.e.can('edit.share')).toBe(true);
    expect(S.e.sales.units![sale].rates).toEqual([expect.objectContaining({ from: '', r: 5 })]);
    expect(S.e.sales.shares![d.id].lines).toEqual([{ u: sale, p: 60 }, { u: cons, p: 40 }]);
    S.e.setShare(d.id, [{ u: sale, p: 50 }, { u: cons, p: 50 }]);
    await settle(S);
    expect(S.e.teamPendingN).toBe(0);
    expect(stored(L, 'dshare/' + d.id)!.v).toMatchObject({ lines: [{ u: sale, p: 50 }, { u: cons, p: 50 }], by: 'เอก' });
    // a split that is not 100% is never sent
    S.e.setShare(d.id, [{ u: sale, p: 50 }, { u: cons, p: 30 }]);
    expect(S.e.sales.shares![d.id].lines[1].p).toBe(50);
    // ... and losing the capability takes the splits and rates away again
    await L.e.adminUpdate('aek', { role: 'sales' });
    await settle(S);
    await settle(S);
    expect(S.e.seesComm()).toBe(false);
    expect(S.e.sales.shares?.[d.id]).toBeUndefined();
    expect(S.e.sales.units![sale].rates).toEqual([]);
  });

  it('deleting a deal removes its split on the script, also for an account that may not change splits', async () => {
    const L = await lead();
    const { d } = await setUp(L);
    // ลบดีล without แก้สัดส่วน: its browser never sends the split's deletion, the script removes it
    const { id } = await L.e.roleSave({ n: 'ลบได้', d: '', c: { ...BUILTIN.sales.c, 'del.rec': 'all', 'view.comm': 'all' } });
    const D = await member(L, 'del', 'นิด', id);
    expect(D.e.sales.shares![d.id]).toBeTruthy();
    D.e.deleteDeal(d.id);
    expect(D.e.sales.shares?.[d.id]).toBeUndefined();
    await settle(D);
    expect(D.e.teamNote).toBe('');
    expect(stored(L, 'dshare/' + d.id)!.del).toBe(true);
    await settle(L);
    expect(L.e.sales.shares?.[d.id]).toBeUndefined();
  });

  it('a person moves between units; a retired unit keeps its money; an edit of the rate is effective-dated', async () => {
    const L = await lead();
    const { sale, cons, d } = await setUp(L);
    L.e.setUnitMember('เอก', cons);
    expect(unitOfName(L.e.unitCtx(), 'เอก')).toBe(cons);
    L.e.setUnitMember('เอก', '');
    expect(L.e.sales.unitm![staffKey('เอก')]).toBeUndefined();
    L.e.retireUnit(sale, true);
    expect(L.e.sales.units![sale].off).toBe(true);
    // the money split to it before stays with it
    expect(shareOf(L.e.unitCtx(), L.e.sales.deals[d.id]).lines[0]).toEqual({ u: sale, p: 60 });
    L.e.retireUnit(sale, false);
    expect(L.e.sales.units![sale].off).toBeUndefined();
    // retired and used again the same day: no day was retired
    expect(L.e.sales.units![sale].offs).toBeUndefined();
    vi.setSystemTime(new Date('2026-11-02T03:00:00Z'));
    L.e.saveUnit(cons, { n: 'ฝ่ายที่ปรึกษา', r: 4, svc: { VVB: 5 } });
    await settle(L);
    expect((stored(L, 'scfg/unit.' + cons)!.v as { rates: unknown }).rates).toEqual([expect.objectContaining({ from: '', r: 3 }), expect.objectContaining({ from: '2026-11-02', r: 4 })]);
    expect(stored(L, 'scfg/unitm.' + staffKey('เอก'))!.del).toBe(true);
    expect(L.e.teamPendingN).toBe(0);
  });
});

/** A won deal of `resp` paid `amt` on `day` (one installment). */
function paidDeal(t: Tab, client: string, resp: string, amt: number, day: string) {
  const d = t.e.addDeal({ client, resp, year: '2569' });
  t.e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-01', n: 'YES' });
  t.e.setPlan(d.id, [{ stage: 'PAY1', amt, pct: null, due: day, rel: null, how: 'transfer', howT: '', note: '' }]);
  t.e.markPaid(d.id, 'PAY1', { date: day, amount: amt, how: 'transfer' });
  return d;
}
const contribOf = (t: Tab, r: ReturnType<typeof periodRange>) => contribIn(unitCtx(t.e.sales), cashLines(t.e.sales, Object.values(t.e.sales.deals), '2026-12-31'), r);

describe('rates set later, retired units, backups', () => {
  it('a unit saved as ไม่คิด and given a rate the next day: from that day; asked to, the money before too', async () => {
    const L = await lead();
    const u = L.e.saveUnit(null, { n: 'ฝ่ายขาย', r: null, svc: {}, members: ['เอก'] })!;
    expect(L.e.sales.units![u].c).toBe(0); // grey until it pays commission
    paidDeal(L, 'บริษัท รับก่อน จำกัด', 'เอก', 100000, '2026-08-15');
    expect(contribOf(L, periodRange('2569', 2)).comm).toBe(0);
    // 5% the next day, as by default: the money received while it was ไม่คิด stays without commission
    vi.setSystemTime(new Date('2026-10-13T03:00:00Z'));
    L.e.saveUnit(u, { n: 'ฝ่ายขาย', r: 5, svc: {} });
    await settle(L);
    expect(L.e.teamPendingN).toBe(0);
    expect((stored(L, 'scfg/unit.' + u)!.v as { rates: unknown }).rates).toEqual([{ from: '', r: null, d: '2026-10-12' }, { from: '2026-10-13', r: 5, d: '2026-10-13' }]);
    expect(L.e.sales.units![u].c).toBe(1);
    expect(contribOf(L, periodRange('2569', 2)).by[u]).toMatchObject({ got: 100000, comm: 0 });
    // the same day, "ใช้กับเงินที่รับมาแล้วทั้งหมดด้วย" (made before its rate was known): the quarter is priced at 5%
    L.e.saveUnit(u, { n: 'ฝ่ายขาย', r: 5, svc: {}, back: true });
    await settle(L);
    expect((stored(L, 'scfg/unit.' + u)!.v as { rates: unknown }).rates).toEqual([{ from: '', r: 5, d: '2026-10-13' }]);
    expect(contribOf(L, periodRange('2569', 2)).by[u]).toMatchObject({ got: 100000, comm: 5000 });
    // another admin counts the same
    const A2 = await member(L, 'ton', 'ต้น', 'admin');
    expect(contribOf(A2, periodRange('2569', 2)).by[u]).toMatchObject({ comm: 5000 });
    // a change after that is effective-dated again; `back` no longer applies once it has had a rate
    vi.setSystemTime(new Date('2026-10-20T03:00:00Z'));
    L.e.saveUnit(u, { n: 'ฝ่ายขาย', r: 3, svc: {}, back: true });
    expect(L.e.sales.units![u].rates.map((x) => [x.from, x.r])).toEqual([['', 5], ['2026-10-20', 3]]);
    expect(contribOf(L, periodRange('2569', 2)).by[u].comm).toBe(5000);
    // set back to 5% the same day: no second 5% entry
    L.e.saveUnit(u, { n: 'ฝ่ายขาย', r: 5, svc: {} });
    await settle(L);
    expect((stored(L, 'scfg/unit.' + u)!.v as { rates: unknown }).rates).toEqual([{ from: '', r: 5, d: '2026-10-13' }]);
  });

  it('colours: a new unit never takes a retired unit\'s; one used again while a live unit has its colour takes a free one', async () => {
    const L = await lead();
    const c = (id: string) => L.e.sales.units![id].c;
    const ids = ['ฝ่ายขาย', 'ฝ่ายที่ปรึกษา', 'ฝ่ายทวนสอบ', 'ฝ่ายแพลตฟอร์ม'].map((n, i) => L.e.saveUnit(null, { n, r: i + 2, svc: {} })!);
    expect(ids.map(c)).toEqual([1, 2, 3, 4]);
    // the review's case: ฝ่ายทวนสอบ retired today (its money of this year still shows in its hue), ฝ่ายวิจัย added:
    // grey, not ฝ่ายทวนสอบ's hue
    L.e.retireUnit(ids[2], true);
    const res = L.e.saveUnit(null, { n: 'ฝ่ายวิจัย', r: 4, svc: {} })!;
    expect(c(res)).toBe(0);
    // used again while no live unit has its hue: it keeps it
    L.e.retireUnit(ids[2], false);
    expect(c(ids[2])).toBe(3);
    // a live unit holds a retired unit's hue (as an earlier build gave it): used again, no hue free → grey
    L.e.retireUnit(ids[3], true);
    L.e.sales.units![res] = { ...L.e.sales.units![res], c: 4 };
    L.e.retireUnit(ids[3], false);
    expect(c(ids[3])).toBe(0);
    // ฝ่ายที่ปรึกษา used again while ฝ่ายวิจัย holds its hue: it takes the one no unit uses now (4: ฝ่ายวิจัย left it)
    L.e.retireUnit(ids[1], true);
    L.e.sales.units![res] = { ...L.e.sales.units![res], c: 2 };
    L.e.retireUnit(ids[1], false);
    await settle(L);
    expect(c(ids[1])).toBe(4);
    expect((stored(L, 'scfg/unit.' + ids[1])!.v as { c: number }).c).toBe(4);
    expect((stored(L, 'scfg/unit.' + ids[3])!.v as { c: number }).c).toBe(0);
    expect(L.e.teamPendingN).toBe(0);
  });

  it('a retired unit keeps the money received before; what comes in from that day is ยังไม่ระบุหน่วยงาน; used again later', async () => {
    const L = await lead();
    const { sale, cons, d } = await setUp(L); // เอก's deal: 100,000 on 15 ส.ค., 60/40
    L.e.retireUnit(sale, true); // 12 ต.ค.
    await settle(L);
    expect(stored(L, 'scfg/unit.' + sale)!.v).toMatchObject({ off: true, offs: [{ from: '2026-10-12' }] });
    vi.setSystemTime(new Date('2026-10-20T03:00:00Z'));
    const d2 = paidDeal(L, 'บริษัท รับหลัง จำกัด', 'เอก', 200000, '2026-10-20');
    await settle(L);
    // the quarter before: as it was; the one after: เอก's job (100% to ฝ่ายขาย by default) is ยังไม่ระบุหน่วยงาน's
    expect([contribOf(L, periodRange('2569', 2)).by[sale].got, contribOf(L, periodRange('2569', 2)).by[cons].got]).toEqual([60000, 40000]);
    const q4 = contribOf(L, periodRange('2569', 3));
    expect(q4.by[sale]).toBeUndefined();
    expect(q4.by['']).toMatchObject({ got: 200000, comm: 0 });
    expect(q4.comm).toBe(0);
    // its people are listed to move (they are still in it: the money before counts for it)
    expect(unassigned(L.e.unitCtx(), ['หมิว', 'เอก', 'มกร'])).toEqual(['หมิว', 'เอก']);
    // another admin holds the same and counts the same
    const A2 = await member(L, 'ton', 'ต้น', 'admin');
    expect(A2.e.sales.units![sale].offs).toEqual([{ from: '2026-10-12' }]);
    expect(contribOf(A2, periodRange('2569', 3)).by['']).toMatchObject({ got: 200000 });
    // used again on 2 พ.ย.: the days it was retired stay ยังไม่ระบุหน่วยงาน's, money from then is its own again
    vi.setSystemTime(new Date('2026-11-02T03:00:00Z'));
    L.e.retireUnit(sale, false);
    const d3 = paidDeal(L, 'บริษัท กลับมา จำกัด', 'เอก', 50000, '2026-11-05');
    await settle(L);
    expect(stored(L, 'scfg/unit.' + sale)!.v).toMatchObject({ offs: [{ from: '2026-10-12', to: '2026-11-02' }] });
    expect((stored(L, 'scfg/unit.' + sale)!.v as { off?: boolean }).off).toBeUndefined();
    const q4b = contribOf(L, periodRange('2569', 3));
    expect(q4b.by[sale].items.map((x) => x.deal.id)).toEqual([d3.id]);
    expect(q4b.by[''].items.map((x) => x.deal.id)).toEqual([d2.id]);
    expect(shareOf(L.e.unitCtx(), L.e.sales.deals[d.id]).lines[0]).toEqual({ u: sale, p: 60 });
  });

  it('a team backup restores the units, their people and the splits; connected, it uploads them', async () => {
    // a browser of its own sets them up and saves a backup (the real exportCrm file)
    const A = mk('A');
    const sale = A.e.saveUnit(null, { n: 'ฝ่ายขาย', r: 5, svc: {}, members: ['เอก'] })!;
    const cons = A.e.saveUnit(null, { n: 'ฝ่ายที่ปรึกษา', r: 3, svc: { VVB: 5 }, members: ['มกร'] })!;
    const old = A.e.saveUnit(null, { n: 'ฝ่ายเดิม', r: 1, svc: {} })!;
    A.e.retireUnit(old, true);
    const d = paidDeal(A, 'บริษัท สำรอง จำกัด', 'เอก', 100000, '2026-08-15');
    A.e.setShare(d.id, [{ u: sale, p: 70 }, { u: cons, p: 30 }]);
    const file = await exported(A);
    const held = JSON.parse(await file.text()).sales;
    expect(Object.keys(held.units).sort()).toEqual([sale, cons, old].sort());
    // a browser of its own restores it: the same units, people, split and commission
    const B = mk('B');
    await B.e.importCrm(file);
    expect(B.e.sales.units).toEqual(A.e.sales.units);
    expect(B.e.sales.unitm).toEqual(A.e.sales.unitm);
    expect(B.e.sales.shares).toEqual(A.e.sales.shares);
    expect(contribOf(B, periodRange('2569', 2))).toEqual(contribOf(A, periodRange('2569', 2)));
    // gaps only: what a browser has already stays its own
    B.e.saveUnit(sale, { n: 'ฝ่ายขายใหม่', r: 5, svc: {} });
    await B.e.importCrm(file);
    expect(B.e.sales.units![sale].n).toBe('ฝ่ายขายใหม่');
    // the lead of a new team restores it: the script gets all three through the usual upload
    const L = await lead();
    await L.e.importCrm(file);
    await settle(L);
    expect(L.e.teamPendingN).toBe(0);
    expect(L.e.teamNote).toBe('');
    expect(stored(L, 'scfg/unit.' + cons)!.v).toMatchObject({ n: 'ฝ่ายที่ปรึกษา', rates: [{ from: '', r: 3, svc: { VVB: 5 } }] });
    expect(stored(L, 'scfg/unit.' + old)!.v).toMatchObject({ off: true, offs: [{ from: '2026-10-12' }] });
    expect(stored(L, 'scfg/unitm.' + staffKey('เอก'))!.v).toMatchObject({ unit: sale });
    expect(stored(L, 'dshare/' + d.id)!.v).toMatchObject({ lines: [{ u: sale, p: 70 }, { u: cons, p: 30 }] });
    // an account that may restore a backup but not set units or splits: it takes none of them
    const { id } = await L.e.roleSave({ n: 'สำรองข้อมูล', d: '', c: { ...BUILTIN.sales.c, 'set.data': 'all' } });
    const R = await member(L, 'backup', 'บุ๊ก', id);
    R.e.sales.units = {};
    R.e.sales.unitm = {};
    await R.e.importCrm(file);
    expect(R.e.sales.units).toEqual({});
    expect(R.e.sales.unitm).toEqual({});
    expect(R.e.sales.shares?.[d.id]).toBeUndefined();
  });
});

/** What exportCrm saves (the real file: its download caught here). */
async function exported(t: Tab): Promise<File> {
  let blob: Blob | null = null;
  const U = globalThis.URL;
  const mk1 = vi.spyOn(U, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x'));
  const mk2 = vi.spyOn(U, 'revokeObjectURL').mockImplementation(() => {});
  const g = globalThis as { document?: unknown };
  const had = g.document;
  g.document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
  try {
    t.e.exportCrm();
    vi.advanceTimersByTime(3000);
  } finally {
    g.document = had;
    mk1.mockRestore();
    mk2.mockRestore();
  }
  expect(blob).toBeTruthy();
  return Object.assign(new Blob([await blob!.text()]), { name: 'b.json' }) as File;
}

describe('where the cards show', () => {
  it('with the team code: hidden (no identity, every browser would hold the rates); this browser alone: shown', async () => {
    sim = createGasSim({ teamKey: 'team-key-123', kdfIter: 1000 });
    const A = mk('A');
    expect(await A.e.teamConnect(URL, 'team-key-123')).toBe(true);
    expect(A.e.role()).toBe(null);
    expect(A.e.seesComm()).toBe(false);
    const B = mk('B');
    expect(B.e.seesComm()).toBe(true);
    const id = B.e.saveUnit(null, { n: 'ฝ่ายขาย', r: 5, svc: {} });
    expect(B.e.sales.units![id!]).toMatchObject({ n: 'ฝ่ายขาย', c: 1, rates: [{ from: '', r: 5 }] });
  });
});
