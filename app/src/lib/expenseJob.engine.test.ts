/**
 * Recording job expenses in the engine, end to end with the real team script in the simulator
 * (team-sync/Code.gs): add, change and delete an expense (its record and its history line), the own-work
 * rule of บันทึกค่าใช้จ่ายของงาน (a sales account on its own deals only, an admin on any), an account without
 * ดูค่าใช้จ่าย that never receives a thing, a bill kept here then uploaded under exp_<expId> (also by an account
 * without แนบเอกสาร), opened, replaced and taken off (the team's file to the Drive trash), and a deal deleted
 * with its expenses and their bills. The screens' sums are lib/expenseJob.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN, type CapSet } from './caps';
import { expensesOf, toExpense } from './expense';
import { catSuggest, jobSum } from './expenseJob';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/x/exec';
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
  const rows = g.rows.slice(0, 40);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sent: Record<string, unknown>[] = [];
interface Tab { e: GccEngine; browser: string; store: ReturnType<typeof memoryStore> }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  sent.length = 0;
  vi.setSystemTime(T0);
});

function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-12';
  const store = memoryStore();
  raw.store = store;
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => {
    sent.push(body);
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
  const tab = { e, browser, store };
  tabs.push(tab);
  return tab;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...ts: Tab[]) {
  for (let i = 0; i < 3; i++)
    for (const t of ts) {
      await t.e.teamSyncNow();
      await t.e.uploadDocs();
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
/** The rows the sheet holds for a key, oldest first. */
const rows = (k: string) => sim.post({ action: 'pull', since: 0, cv: 4, xp: 1, tok: tabs[0].e.session!.tok }).rows!.filter((r: { k: string }) => r.k === k);
const pdf = (name: string, body = name) => Object.assign(new Blob(['%PDF-1.4 ' + body], { type: 'application/pdf' }), { name });
const files = () => sim.drive.list().filter((x) => x.kind === 'file');
const LINE = { c: 'ค่าเดินทาง', amt: 3500, d: '2026-10-05' };

describe('recording job expenses (engine, Code.gs in the simulator)', () => {
  it('a sales account records on its own deal: the record, its history line, the server\'s name and time; a teammate sees it', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ค่าใช้จ่าย จำกัด', resp: 'เอก', forecast: 100000 });
    const o = L.e.addDeal({ client: 'บริษัท ของคนอื่น จำกัด', resp: 'หมิว' });
    await settle(L, S);
    expect([S.e.canExp(d), S.e.canExp(o), L.e.canExp(o)]).toEqual([true, false, true]);
    const x = S.e.addExpense(d.id, { ...LINE, n: 'ไปตรวจโรงงาน' })!;
    expect(x).toMatchObject({ c: 'ค่าเดินทาง', n: 'ไปตรวจโรงงาน', amt: 3500, d: '2026-10-05', by: 'เอก', deal: d.id });
    expect(expensesOf(S.e.sales, d.id).map((e) => e.id)).toEqual([x.id]);
    await settle(S, L);
    expect(rows(`dexp/${d.id}/${x.id}`).at(-1)).toMatchObject({ by: 'เอก', del: false, v: { c: 'ค่าเดินทาง', amt: 3500, by: 'เอก' } });
    const hist = Object.values(S.e.sales.log).filter((l) => l.id.startsWith('exp.') && l.deal === d.id);
    expect(hist.map((l) => [l.action, l.detail])).toEqual([['บันทึกค่าใช้จ่าย', 'ค่าเดินทาง · 3,500 บาท · ค้างจ่าย']]);
    expect(rows('dlog/' + hist[0].id)).toHaveLength(1);
    // the admin's browser has it, with its history line
    expect(expensesOf(L.e.sales, d.id).map((e) => [e.id, e.amt])).toEqual([[x.id, 3500]]);
    expect(L.e.sales.log[hist[0].id]).toMatchObject({ action: 'บันทึกค่าใช้จ่าย', deal: d.id });
    // another person's deal: refused here (nothing changes, the reason is said), and the script would refuse it too
    expect(S.e.addExpense(o.id, LINE)).toBeNull();
    expect(S.e.teamNote).toMatch(/ไม่มีสิทธิ์/);
    expect(expensesOf(S.e.sales, o.id)).toEqual([]);
    // the admin records on any deal
    expect(L.e.addExpense(o.id, { c: 'ค่าแล็บ', amt: 12000, d: '2026-10-06', paid: '2026-10-07' })).toBeTruthy();
    await settle(L, S);
    expect(expensesOf(S.e.sales, o.id).map((e) => [e.c, e.paid])).toEqual([['ค่าแล็บ', '2026-10-07']]);
    // what is typed in a box is checked as a pulled record is: no category or no amount is no expense
    expect(S.e.addExpense(d.id, { ...LINE, c: '  ' })).toBeNull();
    expect(S.e.addExpense(d.id, { ...LINE, amt: 0 })).toBeNull();
    expect(expensesOf(S.e.sales, d.id)).toHaveLength(1);
  });

  it('a change sends only its fields (a teammate\'s other change is kept); paid and unpaid; delete; categories suggested', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท แก้ไข จำกัด', resp: 'เอก' });
    await settle(L, S);
    const x = S.e.addExpense(d.id, { ...LINE, n: 'รอบแรก' })!;
    S.e.addExpense(d.id, { c: 'ผู้รับเหมา', amt: 30000, d: '2026-10-02' });
    L.e.addExpense(d.id, { c: 'ผู้รับเหมา', amt: 5000, d: '2026-10-03' });
    await settle(S, L);
    // both change the same expense at once: the admin its amount, the sales account its paid date
    expect(L.e.updateExpense(d.id, x.id, { ...LINE, n: 'รอบแรก', amt: 3800 })).toBe(true);
    expect(S.e.updateExpense(d.id, x.id, { ...LINE, n: 'รอบแรก', paid: '2026-10-08' })).toBe(true);
    await settle(L, S, L);
    for (const t of [L, S]) expect(t.e.sales.exp![`${d.id}/${x.id}`]).toMatchObject({ amt: 3800, paid: '2026-10-08', n: 'รอบแรก' });
    // the paid date taken off and the description cleared: gone for the teammate too
    expect(S.e.updateExpense(d.id, x.id, { c: 'ค่าเดินทาง', amt: 3800, d: '2026-10-05' })).toBe(true);
    await settle(S, L);
    expect(L.e.sales.exp![`${d.id}/${x.id}`]).not.toHaveProperty('paid');
    expect(L.e.sales.exp![`${d.id}/${x.id}`]).not.toHaveProperty('n');
    // nothing changed: nothing sent, no history line
    const n0 = Object.keys(S.e.sales.log).length;
    expect(S.e.updateExpense(d.id, x.id, { c: 'ค่าเดินทาง', amt: 3800, d: '2026-10-05' })).toBe(true);
    expect(Object.keys(S.e.sales.log).length).toBe(n0);
    // the team's categories, most used first
    expect(catSuggest(S.e.sales, '').map((c) => c.c)).toEqual(['ผู้รับเหมา', 'ค่าเดินทาง']);
    expect(jobSum(S.e.sales, d, '2026-10-12').t).toMatchObject({ out: 38800, n: 3, nUnpaid: 3 });
    // delete
    expect(S.e.deleteExpense(d.id, x.id)).toBe(true);
    await settle(S, L);
    expect(expensesOf(L.e.sales, d.id).map((e) => e.c)).toEqual(['ผู้รับเหมา', 'ผู้รับเหมา']);
    expect(rows(`dexp/${d.id}/${x.id}`).at(-1)).toMatchObject({ del: true });
    expect(Object.values(L.e.sales.log).filter((l) => l.deal === d.id && l.id.startsWith('exp.')).map((l) => l.action)).toEqual(expect.arrayContaining(['บันทึกค่าใช้จ่าย', 'แก้ค่าใช้จ่าย', 'ลบค่าใช้จ่าย']));
  });

  it('an account without ดูค่าใช้จ่าย receives none of it and records nothing; one that took over a deal records on it after a sync', async () => {
    const L = await lead();
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ซ่อน จำกัด', resp: 'หมิว' });
    await settle(L);
    L.e.addExpense(d.id, { c: 'ค่าที่ปรึกษาภายนอก', amt: 80000, d: '2026-10-01' });
    sent.length = 0;
    await settle(L, V, S);
    expect([V.e.can('view.exp'), V.e.canExp(d)]).toEqual([false, false]);
    expect(V.e.sales.exp || {}).toEqual({});
    expect(Object.keys(V.e.sales.log).some((k) => k.startsWith('exp.'))).toBe(false);
    expect(V.e.addExpense(d.id, LINE)).toBeNull();
    expect(JSON.stringify(sent.filter((b) => b.action === 'pull' && b.tok === V.e.session!.tok))).not.toContain('ค่าที่ปรึกษาภายนอก');
    // the deal handed to เอก: his to record on once his browser has the change
    expect(S.e.canExp(d)).toBe(false);
    L.e.updateDeal(d.id, { resp: 'เอก' });
    await settle(L, S);
    expect(S.e.canExp(d)).toBe(true);
    expect(S.e.addExpense(d.id, LINE)).toBeTruthy();
    await settle(S, L);
    expect(expensesOf(L.e.sales, d.id)).toHaveLength(2);
  });

  it('a bill: kept here (id ""), uploaded under exp_<expId> after a sync, opened by a teammate, replaced and taken off', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท บิล จำกัด', resp: 'เอก' });
    await settle(L, S);
    const x = S.e.addExpense(d.id, LINE)!;
    // a waiting bill reads back as one (the record says it is not uploaded yet)
    expect(toExpense({ ...LINE, by: '', at: '', file: { id: '', name: 'บิล.pdf', mime: 'application/pdf', size: 3 } })!.file).toEqual({ id: '', name: 'บิล.pdf', mime: 'application/pdf', size: 3 });
    const k = `${d.id}/${x.id}`;
    const a = await S.e.attachExpenseBill(d.id, x.id, pdf('บิลค่าเดินทาง.pdf'));
    expect(a.file).toMatchObject({ id: '', name: 'บิลค่าเดินทาง.pdf', mime: 'application/pdf' });
    await settle(S, L);
    const f1 = S.e.sales.exp![k].file!.id;
    expect(f1).toBeTruthy();
    expect(files().find((f) => f.id === f1)).toMatchObject({ trashed: false });
    expect(files().find((f) => f.id === f1)!.name.startsWith('exp_' + x.id + '__')).toBe(true);
    expect(sent.filter((b) => b.action === 'upload').map((b) => b.docId)).toEqual(['exp_' + x.id]);
    // the teammate's record names the Drive file, and opens it from there (เปิดเอกสารแนบ)
    expect(L.e.sales.exp![k].file).toMatchObject({ id: f1, name: 'บิลค่าเดินทาง.pdf' });
    expect(await (await L.e.expBill({ ...L.e.sales.exp![k], id: x.id })).text()).toBe('%PDF-1.4 บิลค่าเดินทาง.pdf');
    // this browser's own copy opens without a download
    sent.length = 0;
    expect(await (await S.e.expBill({ ...S.e.sales.exp![k], id: x.id })).text()).toBe('%PDF-1.4 บิลค่าเดินทาง.pdf');
    expect(sent.filter((b) => b.action === 'file')).toEqual([]);
    // replaced: the new one goes up, the old one to the trash; the teammate's copy of the old one is not shown for it
    await S.e.attachExpenseBill(d.id, x.id, pdf('บิลใหม่.pdf'));
    await settle(S, L);
    const f2 = S.e.sales.exp![k].file!.id;
    expect(f2).toBeTruthy();
    expect(f2).not.toBe(f1);
    expect(files().find((f) => f.id === f1)!.trashed).toBe(true);
    expect(await (await L.e.expBill({ ...L.e.sales.exp![k], id: x.id })).text()).toBe('%PDF-1.4 บิลใหม่.pdf');
    // taken off: the record has no bill, the file is in the trash (the sales account's own deal: Code.gs billOwn_)
    expect(S.e.removeExpenseBill(d.id, x.id)).toBe(true);
    await settle(S, L);
    expect(L.e.sales.exp![k]).not.toHaveProperty('file');
    expect(files().find((f) => f.id === f2)!.trashed).toBe(true);
    expect(await S.store.get('docDelQueue')).toBeNull();
    expect(Object.values(L.e.sales.log).filter((l) => l.deal === d.id && l.id.startsWith('exp.')).map((l) => l.action)).toEqual(expect.arrayContaining(['แนบบิลของค่าใช้จ่าย', 'เปลี่ยนบิลของค่าใช้จ่าย', 'เอาบิลของค่าใช้จ่ายออก']));
  });

  it('an account that records expenses without แนบเอกสาร uploads and trashes its bills; without เปิดเอกสารแนบ it opens only its own copy', async () => {
    const L = await lead();
    const c: CapSet = { 'view.sales': 'all', 'view.money': 'all', 'view.exp': 'all', 'edit.exp': 'all' };
    const { id } = await L.e.roleSave({ n: 'ผู้บันทึกค่าใช้จ่าย', d: '', c });
    const B = await member(L, 'bee', 'บี', id as Role);
    const d = L.e.addDeal({ client: 'บริษัท บัญชี จำกัด', resp: 'หมิว' });
    await settle(L, B);
    expect([B.e.can('docs.up'), B.e.can('docs.open'), B.e.canExp(d)]).toEqual([false, false, true]);
    const x = B.e.addExpense(d.id, LINE)!;
    await B.e.attachExpenseBill(d.id, x.id, pdf('slip.png.pdf'));
    await settle(B, L);
    const k = `${d.id}/${x.id}`, f1 = L.e.sales.exp![k].file!.id;
    expect(f1).toBeTruthy();
    expect(files().find((f) => f.id === f1)!.trashed).toBe(false);
    // its own copy opens; a bill attached elsewhere needs เปิดเอกสารแนบ
    expect(await (await B.e.expBill({ ...B.e.sales.exp![k], id: x.id })).text()).toBe('%PDF-1.4 slip.png.pdf');
    const y = L.e.addExpense(d.id, { ...LINE, c: 'ค่าแล็บ' })!;
    await L.e.attachExpenseBill(d.id, y.id, pdf('lab.pdf'));
    await settle(L, B);
    await expect(B.e.expBill({ ...B.e.sales.exp![`${d.id}/${y.id}`], id: y.id })).rejects.toThrow(/เปิดเอกสารแนบ/);
    // deleting the expense trashes its bill
    expect(B.e.deleteExpense(d.id, x.id)).toBe(true);
    await settle(B, L);
    expect(files().find((f) => f.id === f1)!.trashed).toBe(true);
    expect(await B.store.get('docDelQueue')).toBeNull();
  });

  it('a deal deleted: its expenses go everywhere, their bills to the trash; accounting\'s checks stay', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ลบทั้งดีล จำกัด', resp: 'เอก' });
    await settle(L, S);
    const x = S.e.addExpense(d.id, { ...LINE, paid: '2026-10-06' })!;
    await S.e.attachExpenseBill(d.id, x.id, pdf('bill.pdf'));
    await settle(S, L);
    const fid = L.e.sales.exp![`${d.id}/${x.id}`].file!.id;
    expect(fid).toBeTruthy();
    // accounting checked it
    expect(sim.post({ action: 'push', cv: 4, tok: L.e.session!.tok, ops: [{ k: `dchk/${d.id}/exp.${x.id}`, v: { s: 'ok', amt: 3500, d: '2026-10-06', f: fid } }] })).toMatchObject({ ok: true });
    await settle(L, S);
    L.e.deleteDeal(d.id);
    await settle(L, S);
    for (const t of [L, S]) expect(expensesOf(t.e.sales, d.id)).toEqual([]);
    expect(rows(`dexp/${d.id}/${x.id}`).at(-1)).toMatchObject({ del: true });
    expect(files().find((f) => f.id === fid)!.trashed).toBe(true);
    expect(S.e.sales.xchk).toHaveProperty(`${d.id}/${x.id}`);
  });

  it('the sign-out count includes a bill not uploaded yet; dropping what is unsent drops it', async () => {
    const L = await lead();
    const d = L.e.addDeal({ client: 'บริษัท รออัปโหลด จำกัด', resp: 'หมิว' });
    await settle(L);
    const x = L.e.addExpense(d.id, LINE)!;
    const before = L.e.docsUnsent;
    await L.e.attachExpenseBill(d.id, x.id, pdf('wait.pdf'));
    expect(L.e.docsUnsent).toBe(before + 1);
    await settle(L);
    expect(L.e.docsUnsent).toBe(before);
  });
});

describe('a role without บันทึกค่าใช้จ่าย', () => {
  it('sees the card read-only (view.exp without edit.exp): canExp is false, nothing it sends is an expense', async () => {
    const L = await lead();
    const { 'edit.exp': _e, ...c } = BUILTIN.sales.c;
    const { id } = await L.e.roleSave({ n: 'ดูอย่างเดียวแต่เห็นค่าใช้จ่าย', d: '', c: c as CapSet });
    const S = await member(L, 'see', 'ซี', id as Role);
    const d = L.e.addDeal({ client: 'บริษัท อ่านอย่างเดียว จำกัด', resp: 'ซี' });
    L.e.addExpense(d.id, LINE);
    await settle(L, S);
    expect([S.e.can('view.exp'), S.e.canExp(d)]).toEqual([true, false]);
    expect(expensesOf(S.e.sales, d.id)).toHaveLength(1);
    const [x] = expensesOf(S.e.sales, d.id);
    expect(S.e.updateExpense(d.id, x.id, { ...LINE, amt: 1 })).toBe(false);
    expect(S.e.deleteExpense(d.id, x.id)).toBe(false);
    await expect(S.e.attachExpenseBill(d.id, x.id, pdf('x.pdf'))).rejects.toThrow(/แนบบิล/);
    expect(expensesOf(S.e.sales, d.id)[0].amt).toBe(3500);
  });
});
