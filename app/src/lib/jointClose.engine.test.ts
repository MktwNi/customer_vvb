/**
 * Closing a joint quotation as one (owner: "one quotation for 10 companies, closed once, every company in the
 * ปิดงาน list, the money once, and how many companies we worked for"), in the engine against the real team
 * script (team-sync/Code.gs in the simulator), two browsers:
 * - the companies without a result get the payer's (YES or NO) in the same push as the closing, dated as the
 *   payer's, written only over what this browser saw (a teammate's result saved meanwhile wins);
 * - "เลิกทำ" puts back exactly what each company had (unless changed since) and reopens what it closed;
 * - the payer's result recorded after the closing reaches the companies the same way;
 * - a company's ปิดงาน is the whole quotation's; reopening brings back the whole group;
 * - an account that may not edit one of its rows is refused, told which row and whose (own-work roles);
 * - the counts (lib/sales workTally) on both browsers. No new records or fields: dstep/<member>/CLOSED DEAL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN } from './caps';
import { closeReady, filterDeals, jointOf, quickMatch, stepOf, type Deal, type SalesState } from './sales';
import { jointCloseOf } from './joint';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/jc/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-12';
const PAYER = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ';
const CD = 'CLOSED DEAL';

// each browser its own localStorage (an account's session lives there)
const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 120);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const all: GccEngine[] = [];
afterEach(() => {
  all.splice(0).forEach((e) => e.dispose());
  LS.clear();
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
});

/** What each browser pushed: the record keys of each push. */
const pushes = new Map<GccEngine, string[][]>();
/** A browser; `name` plays the person using it (a team key has no accounts). */
function mk(browser: string, name?: string): GccEngine {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = TODAY;
  raw.store = memoryStore();
  if (name) (raw as unknown as { me: () => string }).me = () => name;
  raw.rebuild();
  raw.loading = false;
  const log: string[][] = [];
  const post = async (_u: string, body: Record<string, unknown>) => {
    if (body.action === 'push') log.push((body.ops as { k: string }[]).map((o) => o.k));
    return sim.post(body) as Record<string, unknown>;
  };
  raw.transport = post;
  raw.fileTransport = post;
  const e = new Proxy(raw, {
    get(t, p) {
      cur = browser;
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? (...a: unknown[]) => ((cur = browser), (v as (...x: unknown[]) => unknown).apply(t, a)) : v;
    },
  });
  pushes.set(e, log);
  all.push(e);
  return e;
}
async function team() {
  sim = createGasSim({ teamKey: KEY });
  const A = mk('A', 'หมิว'), B = mk('B', 'มินท์');
  for (const e of [A, B]) expect(await e.teamConnect(URL, KEY)).toBe(true);
  return [A, B] as const;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...es: GccEngine[]) {
  for (let i = 0; i < 3; i++)
    for (const e of es) {
      await e.teamSyncNow();
      await tick();
    }
}
/** The record as the sheet has it now (null: deleted; undefined: never written). */
function sheet(k: string, tok?: string): unknown {
  const r = sim.post({ action: 'pull', since: 0, ...(tok ? { tok, cv: 4 } : { key: KEY }) }).rows!.filter((x) => x.k === k);
  const l = r[r.length - 1];
  return !l ? undefined : l.del ? null : l.v;
}
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms);
const deal = (e: GccEngine, client: string, p: Partial<Deal> = {}) => e.addDeal({ client, section: 'Event Exhibition', year: '2569', ...p });
const NAMES = ['บางกอกสตีล เวิร์คส์', 'อุดร ไบโอแมส', 'ไทยเท็กซ์ไทล์ อินดัสตรี', 'สยามฟู้ดส์ แปรรูป', 'คงธนา เซอร์วิส'];
const OWNERS = ['หมิว', 'คุณบี', 'ปลา', 'มกร', 'มกร'];
/** A joint quotation of 5 companies, 1,000,000 typed, made by A and seen by B. */
async function made(A: GccEngine, B: GccEngine | null, o: { resp?: string; owners?: string[] } = {}) {
  const ms = NAMES.map((n, i) => deal(A, n, { resp: (o.owners || OWNERS)[i] }));
  later();
  const { hid } = await A.createJoint({
    title: 'CFP 5 บริษัท (มจพ)', payer: PAYER, payerGid: null, year: '2569', section: 'Event Exhibition', resp: o.resp || 'หมิว', service: ['CFP'],
    total: 1000000, docNo: 'QT-2569-099', docDate: '2026-10-01', members: ms.map((d) => ({ deal: d.id, share: null, pct: null })),
  });
  if (B) await settle(A, B);
  return { hid, ids: ms.map((d) => d.id) };
}
const res = (S: SalesState, ids: string[]) => ids.map((id) => stepOf(S, id, CD).n || '');
const status = (S: SalesState, ids: string[]) => ids.map((id) => S.deals[id].jobStatus);
const closedList = (e: GccEngine) => filterDeals(e.sales, { year: '2569', job: 'closed' }, TODAY);

describe('closing a joint quotation records the payer\'s result for its companies', () => {
  it('the companies without a result get the payer\'s YES, dated as the payer\'s, in the same push as the closing; a NO (withdrew) and a YES stay; the counts on both browsers', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    A.setStep(hid, CD, { d: '2026-10-05', n: 'YES' });
    A.setStep(ids[1], CD, { d: '2026-09-20', n: 'NO' }); // withdrew
    A.setStep(ids[2], CD, { d: '2026-10-03', n: 'YES' }); // recorded on its own
    A.setStep(ids[3], CD, { d: '2026-09-30', n: 'รอผล งบปีหน้า' });
    await settle(A, B);
    pushes.get(A)!.length = 0;
    later();
    expect(A.jointCloseBlock(hid)).toBe('');
    expect(A.closeJoint(hid)).toBe(6);
    const S = A.sales;
    expect(status(S, [hid, ...ids])).toEqual(Array(6).fill('closed'));
    expect(res(S, ids)).toEqual(['YES', 'NO', 'YES', 'YES', 'YES']);
    expect([0, 3, 4].map((i) => S.steps[`${ids[i]}/${CD}`])).toEqual(Array(3).fill({ d: '2026-10-05', n: 'YES' }));
    expect(S.steps[`${ids[2]}/${CD}`]).toEqual({ d: '2026-10-03', n: 'YES' });
    // one history entry on the quotation for the results, none per company
    const logs = Object.values(S.log).filter((l) => l.action === 'บันทึกผล');
    expect(logs.map((l) => [l.deal, l.detail])).toEqual([[hid, 'ได้งาน 3 บริษัทตามผู้จ่าย']]);
    await settle(A, B);
    // one push: the closing and the results together
    const sent = pushes.get(A)!.filter((p) => p.some((k) => k.startsWith('deal/') || k.startsWith('dstep/')));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.arrayContaining([`deal/${hid}`, ...ids.map((id) => `deal/${id}`), ...[0, 3, 4].map((i) => `dstep/${ids[i]}/${CD}`)]));
    expect(sent[0]).not.toContain(`dstep/${ids[1]}/${CD}`);
    expect(sheet(`dstep/${ids[0]}/${CD}`)).toEqual({ d: '2026-10-05', n: 'YES' });
    expect(res(B.sales, ids)).toEqual(['YES', 'NO', 'YES', 'YES', 'YES']);
    expect(status(B.sales, [hid, ...ids])).toEqual(Array(6).fill('closed'));
    // 1 job, 4 companies worked for (the payer is none), the one that withdrew lost: the same on both
    for (const e of [A, B]) expect(e.workTally(closedList(e))).toMatchObject({ jobs: 1, worked: 4, lost: 1, noResult: 0 });
  });

  it('the payer\'s NO: every company without a result is NO; no result from the payer: nothing is recorded', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    A.setStep(hid, CD, { d: '2026-10-05', n: 'NO' });
    A.closeJoint(hid);
    expect(res(A.sales, ids)).toEqual(Array(5).fill('NO'));
    expect(A.workTally(closedList(A))).toMatchObject({ jobs: 1, worked: 0, lost: 5 });
    const x = await made(A, B);
    A.setStep(x.hid, CD, { d: '2026-10-05', n: 'รอผล' });
    expect(A.closeJoint(x.hid)).toBe(6);
    expect(res(A.sales, x.ids)).toEqual(Array(5).fill(''));
    expect(Object.keys(A.sales.steps).filter((k) => x.ids.some((id) => k.startsWith(id + '/' + CD)))).toEqual([]);
  });

  it('a teammate\'s NO saved meanwhile is not overwritten by the closing\'s YES (the browser had not seen it)', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    A.setStep(hid, CD, { d: '2026-10-05', n: 'YES' });
    await settle(A, B);
    // B records that a company withdrew; A closes before hearing of it
    B.setStep(ids[0], CD, { d: '2026-10-11', n: 'NO' });
    await settle(B);
    later();
    A.closeJoint(hid);
    expect(res(A.sales, ids)[0]).toBe('YES'); // what this browser knew
    await settle(A, B);
    await settle(A, B);
    expect(sheet(`dstep/${ids[0]}/${CD}`)).toEqual({ d: '2026-10-11', n: 'NO' });
    for (const e of [A, B]) {
      expect(res(e.sales, ids)).toEqual(['NO', 'YES', 'YES', 'YES', 'YES']);
      expect(e.workTally(closedList(e))).toMatchObject({ jobs: 1, worked: 4, lost: 1 });
    }
    // and a teammate's note written meanwhile (รอผล …) keeps too
    const x = await made(A, B);
    A.setStep(x.hid, CD, { d: '2026-10-05', n: 'YES' });
    await settle(A, B);
    B.setStep(x.ids[1], CD, { d: '2026-10-11', n: 'รอเอกสารยืนยัน' });
    await settle(B);
    A.closeJoint(x.hid);
    await settle(A, B);
    await settle(A, B);
    expect(res(A.sales, x.ids)).toEqual(['YES', 'รอเอกสารยืนยัน', 'YES', 'YES', 'YES']);
  });
});

describe('"เลิกทำ" right after closing', () => {
  it('puts back exactly what each company had (none, a note, a NO) and reopens what the closing moved; on the sheet and the teammate\'s browser too', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    A.setStep(hid, CD, { d: '2026-10-05', n: 'YES' });
    A.setStep(ids[1], CD, { d: '2026-09-20', n: 'NO' });
    A.setStep(ids[3], CD, { d: '2026-09-30', n: 'รอผล งบปีหน้า' });
    // a company closed alone earlier (by an older build): the closing did not move it, the undo leaves it
    vi.setSystemTime(new Date('2026-10-02T03:00:00Z'));
    A.updateDeal(ids[4], { jobStatus: 'closed' });
    vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
    await settle(A, B);
    const before = Object.fromEntries(ids.map((id) => [id, A.sales.steps[`${id}/${CD}`]]));
    expect(A.closeJoint(hid)).toBe(5);
    expect(res(A.sales, ids)).toEqual(['YES', 'NO', 'YES', 'YES', 'YES']);
    await settle(A, B);
    expect(A.undoCloseJoint(hid)).toBe(5);
    expect(status(A.sales, [hid, ...ids])).toEqual(['open', 'open', 'open', 'open', 'open', 'closed']);
    expect(Object.fromEntries(ids.map((id) => [id, A.sales.steps[`${id}/${CD}`]]))).toEqual(before);
    expect(before[ids[0]]).toBeUndefined();
    expect(A.sales.steps[`${ids[3]}/${CD}`]).toEqual({ d: '2026-09-30', n: 'รอผล งบปีหน้า' });
    await settle(A, B);
    expect(sheet(`dstep/${ids[0]}/${CD}`)).toBeNull();
    expect(sheet(`dstep/${ids[3]}/${CD}`)).toEqual({ d: '2026-09-30', n: 'รอผล งบปีหน้า' });
    expect(res(B.sales, ids)).toEqual(['', 'NO', '', 'รอผล งบปีหน้า', '']);
    expect(status(B.sales, [hid, ...ids])).toEqual(['open', 'open', 'open', 'open', 'open', 'closed']);
  });

  it('a result changed since the closing (here by a teammate) stays as it is', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    A.setStep(hid, CD, { d: '2026-10-05', n: 'YES' });
    await settle(A, B);
    A.closeJoint(hid);
    await settle(A, B);
    B.setStep(ids[2], CD, { d: '2026-10-12', n: 'NO' });
    await settle(B, A);
    A.undoCloseJoint(hid);
    expect(res(A.sales, ids)).toEqual(['', '', 'NO', '', '']);
    await settle(A, B);
    expect(res(B.sales, ids)).toEqual(['', '', 'NO', '', '']);
    expect(status(B.sales, [hid, ...ids])).toEqual(Array(6).fill('open'));
  });

  it('before it was even sent: one change goes out (nothing for a company that had nothing)', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    A.setStep(hid, CD, { d: '2026-10-05', n: 'YES' });
    await settle(A, B);
    A.closeJoint(hid);
    A.undoCloseJoint(hid);
    await settle(A, B);
    expect(sheet(`dstep/${ids[0]}/${CD}`) ?? null).toBeNull();
    expect(res(B.sales, ids)).toEqual(Array(5).fill(''));
    expect(status(B.sales, [hid, ...ids])).toEqual(Array(6).fill('open'));
  });
});

describe('the payer answers after the closing', () => {
  it('its result recorded on the closed quotation reaches the companies without one (a teammate\'s browser records it here)', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    A.setStep(ids[4], CD, { d: '2026-09-20', n: 'NO' });
    expect(A.closeJoint(hid)).toBe(6);
    expect(res(A.sales, ids)).toEqual(['', '', '', '', 'NO']);
    expect(A.workTally(closedList(A))).toMatchObject({ jobs: 1, worked: 0, noResult: 4 });
    await settle(A, B);
    later();
    expect(B.setStep(hid, CD, { d: '2026-10-14', n: 'YES' })).toBe(4);
    expect(res(B.sales, ids)).toEqual(['YES', 'YES', 'YES', 'YES', 'NO']);
    expect(B.sales.steps[`${ids[0]}/${CD}`]).toEqual({ d: '2026-10-14', n: 'YES' });
    await settle(B, A);
    for (const e of [A, B]) expect(e.workTally(closedList(e))).toMatchObject({ jobs: 1, worked: 4, lost: 1, noResult: 0 });
    // changing the payer's answer later leaves the companies' results (each is changed on its own row)
    expect(B.setStep(hid, CD, { d: '2026-10-14', n: 'NO' })).toBe(0);
    expect(res(B.sales, ids)).toEqual(['YES', 'YES', 'YES', 'YES', 'NO']);
  });
  it('an open quotation: the payer\'s result waits for the closing (nothing is written to the companies yet)', async () => {
    const [A] = await team();
    const { hid, ids } = await made(A, null);
    expect(A.setStep(hid, CD, { d: '2026-10-05', n: 'YES' })).toBe(0);
    expect(res(A.sales, ids)).toEqual(Array(5).fill(''));
  });
});

describe('closed and reopened as one', () => {
  it('a company\'s ปิดงาน is the whole quotation\'s: the same dialog, which closes all of it at once; ready only when the payer is', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    // what a company's ปิดงาน (the table row, its ⋯ menu, its panel, its phone card) opens: the quotation's closing
    expect(ids.map((id) => jointCloseOf(A.sales, A.sales.deals[id]))).toEqual(Array(5).fill(hid));
    expect(jointCloseOf(A.sales, A.sales.deals[hid])).toBe(hid);
    const plain = deal(A, 'บริษัท เดี่ยว จำกัด');
    expect(jointCloseOf(A.sales, plain)).toBe('');
    // a company that withdrew is not ready on its own any more; the quotation is when the payer is
    A.setStep(ids[1], CD, { d: '2026-09-20', n: 'NO' });
    expect(closeReady(A.sales, A.sales.deals[ids[1]], TODAY)).toBe(false);
    A.updatePayLine(hid, 'PAY1', { amt: 1000000, rel: 30 });
    A.setStep(hid, CD, { d: '2026-10-05', n: 'YES' });
    expect(closeReady(A.sales, A.sales.deals[ids[0]], TODAY)).toBe(false);
    A.markPaid(hid, 'PAY1', { date: '2026-10-10', amount: 1000000, how: 'transfer' });
    const ready = filterDeals(A.sales, { year: '2569', job: 'open' }, TODAY).filter((d) => quickMatch(A.sales, d, 'ready', TODAY));
    expect(ready.map((d) => d.id).sort()).toEqual([hid, ...ids].sort());
    expect(A.workTally(ready).jobs).toBe(1);
    // closing from the second company's row
    expect(A.closeJoint(jointCloseOf(A.sales, A.sales.deals[ids[1]]))).toBe(6);
    expect(status(A.sales, [hid, ...ids])).toEqual(Array(6).fill('closed'));
    expect(res(A.sales, ids)).toEqual(['YES', 'NO', 'YES', 'YES', 'YES']);
  });

  it('reopening brings back every company (one closed on another day too) and keeps the results; from a company it is the same', async () => {
    const [A, B] = await team();
    const { hid, ids } = await made(A, B);
    A.setStep(hid, CD, { d: '2026-10-05', n: 'YES' });
    vi.setSystemTime(new Date('2026-10-03T03:00:00Z'));
    A.updateDeal(ids[0], { jobStatus: 'closed' }); // an older build closed it alone
    vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
    A.closeJoint(hid);
    await settle(A, B);
    expect(B.reopenJoint(jointCloseOf(B.sales, B.sales.deals[ids[3]]))).toBe(6);
    expect(status(B.sales, [hid, ...ids])).toEqual(Array(6).fill('open'));
    expect(res(B.sales, ids)).toEqual(Array(5).fill('YES'));
    await settle(B, A);
    expect(status(A.sales, [hid, ...ids])).toEqual(Array(6).fill('open'));
    // closed again once: one group, closed the same day
    A.closeJoint(hid);
    expect(new Set(ids.map((id) => A.sales.deals[id].closedDate))).toEqual(new Set([TODAY]));
  });
});

describe('an account that may not edit one of its rows (own work only)', () => {
  /** A team whose lead (หมิว) claimed the admin account, and เอก with a role that edits his own deals only. */
  async function accounts() {
    sim = createGasSim({ teamKey: '', kdfIter: 1000 });
    sim.setup();
    const L = mk('L');
    expect(await L.teamOpen(URL)).toBe('setup');
    await L.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
    const { id } = await L.roleSave({ n: 'ขายเฉพาะงานตัวเอง', d: '', c: { ...BUILTIN.sales.c, 'edit.deal': 'own', 'edit.pay': 'own' } });
    const { temp } = await L.adminCreate({ u: 'aek', name: 'เอก', role: id as Role });
    const S = mk('S');
    expect(await S.teamOpen(URL)).toBe('accounts');
    await S.teamLogin('aek', temp, true);
    await S.teamChangePassword('', 'aek-pass-123');
    await settle(S);
    expect(S.myCaps()!['edit.deal']).toBe('own');
    return { L, S };
  }

  it('closing is refused, naming the row and whose it is; nothing changes; the lead closes it as one', async () => {
    const { L, S } = await accounts();
    const { hid, ids } = await made(L, null, { resp: 'เอก', owners: ['เอก', 'เอก', 'หมิว', 'เอก', 'เอก'] });
    L.setStep(hid, CD, { d: '2026-10-05', n: 'YES' });
    await settle(L, S);
    expect(S.canDeal('edit.deal', S.sales.deals[hid])).toBe(true);
    const why = S.jointCloseBlock(hid);
    expect(why).toBe(`ปิดงานไม่ได้: ${NAMES[2]} เป็นงานของ หมิว บัญชีของคุณแก้ไขแถวนั้นไม่ได้ ใบเสนอราคาร่วมปิดพร้อมกันทั้งใบ ให้ผู้รับผิดชอบแถวนั้นหรือหัวหน้าปิดงาน`);
    expect(S.closeJoint(hid)).toBe(0);
    expect(S.teamNote).toBe(why);
    expect(status(S.sales, [hid, ...ids])).toEqual(Array(6).fill('open'));
    expect(res(S.sales, ids)).toEqual(Array(5).fill(''));
    expect(S.teamPendingN).toBe(0);
    // the row it would change is the one that matters: closed and with its result already, it no longer stops it
    L.setStep(ids[2], CD, { d: '2026-10-05', n: 'YES' });
    L.updateDeal(ids[2], { jobStatus: 'closed' });
    await settle(L, S);
    expect(S.jointCloseBlock(hid)).toBe('');
    // the lead may edit every row: closed as one, the results recorded
    L.updateDeal(ids[2], { jobStatus: 'open' });
    await settle(L, S);
    expect(L.closeJoint(hid)).toBe(6);
    await settle(L, S);
    expect(status(S.sales, [hid, ...ids])).toEqual(Array(6).fill('closed'));
    expect(res(S.sales, ids)).toEqual(Array(5).fill('YES'));
    // reopening is refused the same way
    expect(S.reopenJoint(hid)).toBe(0);
    expect(S.teamNote).toBe(`เปิดงานอีกครั้งไม่ได้: ${NAMES[2]} เป็นงานของ หมิว บัญชีของคุณแก้ไขแถวนั้นไม่ได้ ใบเสนอราคาร่วมเปิดกลับพร้อมกันทั้งใบ ให้ผู้รับผิดชอบแถวนั้นหรือหัวหน้าเปิดงานอีกครั้ง`);
    expect(status(S.sales, [hid, ...ids])).toEqual(Array(6).fill('closed'));
    expect(jointOf(S.sales, { id: hid })!.members).toHaveLength(5);
  });

  it('a quotation of another person: refused, said whose', async () => {
    const { L, S } = await accounts();
    const { hid } = await made(L, null, { resp: 'หมิว', owners: ['เอก', 'เอก', 'เอก', 'เอก', 'เอก'] });
    await settle(L, S);
    expect(S.jointCloseBlock(hid)).toBe('ปิดงานไม่ได้: ใบเสนอราคาร่วมนี้เป็นงานของ หมิว บัญชีของคุณแก้ไขแถวนั้นไม่ได้');
    expect(S.closeJoint(hid)).toBe(0);
  });
});
