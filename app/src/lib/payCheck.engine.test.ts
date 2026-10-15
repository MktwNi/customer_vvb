/**
 * The month check for accounting through the engine and the real team script (team-sync/Code.gs in the
 * simulator, the version phase 2 deployed): an account of a role with ตรวจยืนยันรับเงิน checks money another
 * person recorded and the script stores the check in its own name and time; a salesperson can't write a check
 * at all, the recorder can't check their own line; undo; a line sent back reaches its recorder with the
 * note; a change after the check makes it wait again; a receipt cancelled after its check is an orphan until
 * acknowledged; a month closed and opened again; amounts hidden from a role without ดูยอดเงิน.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { cashLines, emptySales, type PlanInput } from './sales';
import { canClose, chkRows, sumRows, type ChkRow } from './payCheck';
import type { CapSet } from './caps';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/r/exec';
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

const T0 = new Date('2026-10-15T03:00:00Z');
const TODAY = '2026-10-15';
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
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
/** What the script holds for key k (the last row, as an admin pulls it). */
const stored = (L: Tab, k: string) => sim.post({ action: 'pull', since: 0, cv: 4, tok: L.e.session!.tok }).rows!.filter((r) => r.k === k).at(-1);
const line = (stage: string, amt: number, o: Partial<PlanInput> = {}): PlanInput => ({ stage, amt, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', ...o });
/** The month card's rows as this browser has them. */
const rowsOf = (t: Tab) => chkRows(t.e.sales, cashLines(t.e.sales, Object.values(t.e.sales.deals), TODAY), t.e.payChecks(), t.e.payChkCfg().since);
const rowOf = (t: Tab, key: string) => rowsOf(t).find((r) => r.key === key) as ChkRow;
const ACCT: CapSet = { 'view.sales': 'all', 'view.plan': 'all', 'view.money': 'all', 'view.cash': 'all', 'docs.open': 'all', 'pay.check': 'all' };

describe('the month check against the team script', () => {
  it('accounting checks money a salesperson recorded: the script signs it; the salesperson can\'t; undo; a month closed and opened again', async () => {
    const L = await lead();
    const { id: acct } = await L.e.roleSave({ n: 'บัญชี/การเงิน', d: '', c: ACCT });
    const F = await member(L, 'fon', 'ฝน', acct);
    const S = await member(L, 'aek', 'เอก', 'sales');
    expect(F.e.can('pay.check')).toBe(true);
    expect(S.e.can('pay.check')).toBe(false);
    // เอก records a won deal, its plan and the first installment received (in September)
    const d = S.e.addDeal({ client: 'บริษัท ตรวจรับเงิน จำกัด', year: '2569' });
    S.e.setStep(d.id, 'CLOSED DEAL', { d: '2026-09-01', n: 'YES' });
    S.e.setPlan(d.id, [line('PAY1', 107000, { due: '2026-09-30' }), line('PAY2', 107000, { due: '2026-11-20' })]);
    S.e.markPaid(d.id, 'PAY1', { date: '2026-09-28', amount: null });
    await settle(S, F, L);
    const key = d.id + '/PAY1';
    const r = rowOf(F, key);
    expect([r.state, r.by, r.amt, r.date]).toEqual(['wait', ['เอก'], 107000, '2026-09-28']);
    // the salesperson: no capability, nothing is written, and the script refuses a check pushed by hand
    expect(S.e.payCheckBlock(rowOf(S, key))).toBe('cap');
    expect(S.e.checkPays([rowOf(S, key)])).toEqual([]);
    expect(S.e.canWriteKey('dchk/' + key, false)).toBe(false);
    const forged = sim.post({ action: 'push', cv: 4, tok: S.e.session!.tok, ops: [{ k: 'dchk/' + key, v: { s: 'ok', by: 'ฝน', at: 'x', amt: 107000, d: '2026-09-28', f: '' } }] });
    expect(forged.denied).toEqual(['dchk/' + key]);
    // accounting checks it: the record is in ฝน's name at the script's time, with a history row
    vi.setSystemTime(new Date('2026-10-15T04:00:00Z'));
    expect(F.e.payCheckBlock(r)).toBe('');
    expect(F.e.checkPays([r])).toEqual([key]);
    expect(F.e.lastPayChecks?.keys).toEqual([key]);
    await settle(F, L, S);
    const row = stored(L, 'dchk/' + key)!;
    expect(row.v).toMatchObject({ s: 'ok', by: 'ฝน', amt: 107000, d: '2026-09-28', f: '' });
    expect(row.by).toBe('ฝน');
    expect(Object.values(L.e.sales.log).some((x) => x.deal === d.id && x.action === 'ตรวจรับเงิน PAY1' && x.by === 'ฝน')).toBe(true);
    expect(rowOf(L, key).state).toBe('ok');
    expect(rowOf(S, key).state).toBe('ok');
    // September has ended and every received line in it is checked: it can be closed, then opened again
    const sep = sumRows(rowsOf(F).filter((x) => x.ym === '2026-09'));
    expect(canClose(sep, '2026-09', TODAY)).toBe(true);
    F.e.closeMonth('2026-09', sep);
    await settle(F, L);
    expect(stored(L, 'mclose/2026-09')!.v).toMatchObject({ by: 'ฝน', n: 1, amt: 107000 });
    expect(L.e.monthCloses()['2026-09']).toMatchObject({ by: 'ฝน', n: 1 });
    F.e.reopenMonth('2026-09');
    await settle(F, L);
    expect(stored(L, 'mclose/2026-09')!.del).toBe(true);
    expect(L.e.monthCloses()['2026-09']).toBeUndefined();
    // undo: one's own check within 10 minutes (the line waits again)
    expect(S.e.undoPayChecks([key])).toBe(0); // not เอก's
    vi.setSystemTime(new Date('2026-10-15T04:05:00Z'));
    expect(F.e.undoPayChecks([key])).toBe(1);
    await settle(F, L);
    expect(stored(L, 'dchk/' + key)!.del).toBe(true);
    expect(rowOf(L, key).state).toBe('wait');
  });

  it('a line sent back reaches its recorder with the note; a change after it waits again; a cancelled receipt is an orphan until acknowledged', async () => {
    const L = await lead();
    const { id: acct } = await L.e.roleSave({ n: 'บัญชี/การเงิน', d: '', c: ACCT });
    const F = await member(L, 'fon', 'ฝน', acct);
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = S.e.addDeal({ client: 'บริษัท ส่งกลับ จำกัด', year: '2569' });
    S.e.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    S.e.setPlan(d.id, [line('PAY1', 180000, { due: '2026-10-05' })]);
    S.e.markPaid(d.id, 'PAY1', { date: '2026-10-05', amount: null });
    await settle(S, F);
    const key = d.id + '/PAY1';
    expect(F.e.returnPay(rowOf(F, key), '')).toBe(false); // a note is required
    expect(F.e.returnPay(rowOf(F, key), 'ยอดเข้าธนาคาร 179,000 บาท ไม่ตรง ขอสลิปโอน')).toBe(true);
    await settle(F, S, L);
    const back = rowOf(S, key);
    expect(back.state).toBe('back');
    expect(back.rec!.note).toBe('ยอดเข้าธนาคาร 179,000 บาท ไม่ตรง ขอสลิปโอน');
    expect(stored(L, 'dchk/' + key)!.v).toMatchObject({ s: 'back', by: 'ฝน' });
    // the recorder corrects the amount: the line waits for accounting again, with what changed
    S.e.markPaid(d.id, 'PAY1', { date: '2026-10-05', amount: 179000 });
    await settle(S, F);
    const ch = rowOf(F, key);
    expect(ch.state).toBe('changed');
    expect(ch.diff).toMatchObject({ amt: [180000, 179000], d: null });
    // ฝน confirms it; then the receipt is cancelled: an orphan in its month until acknowledged
    expect(F.e.checkPays([ch])).toEqual([key]);
    await settle(F, S);
    S.e.unmarkPaid(d.id, 'PAY1');
    await settle(S, F, L);
    const o = rowOf(F, key);
    expect([o.kind, o.ym, o.amt, o.state]).toEqual(['orphan', '2026-10', 179000, 'ok']);
    F.e.ackPayOrphan(o);
    await settle(F, L);
    expect(stored(L, 'dchk/' + key)!.del).toBe(true);
    expect(rowsOf(F).some((x) => x.kind === 'orphan')).toBe(false);
  });

  it('the recorder may not check their own line (also an admin); a role without ดูยอดเงิน gets no amounts', async () => {
    const L = await lead();
    const { id: acct } = await L.e.roleSave({ n: 'บัญชี/การเงิน', d: '', c: ACCT });
    const F = await member(L, 'fon', 'ฝน', acct);
    const { id: blind } = await L.e.roleSave({ n: 'ไม่เห็นเงิน', d: '', c: { 'view.sales': 'all', 'view.plan': 'all' } });
    const N = await member(L, 'nid', 'นิด', blind);
    const d = L.e.addDeal({ client: 'บริษัท หมิวรับเงิน จำกัด', year: '2569' });
    L.e.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    L.e.setPlan(d.id, [line('PAY1', 53500, { due: '2026-10-10' })]);
    L.e.markPaid(d.id, 'PAY1', { date: '2026-10-10', amount: null });
    await settle(L, F, N);
    const key = d.id + '/PAY1';
    const mine = rowOf(L, key);
    expect(mine.by).toEqual(['หมิว']);
    expect(L.e.payCheckBlock(mine)).toBe('self');
    expect(L.e.checkPays([mine])).toEqual([]);
    expect(L.e.payChecks()[key]).toBeUndefined();
    expect(F.e.returnPay(rowOf(F, key), 'ยอด 53,500 บาท ไม่มีสลิป')).toBe(true);
    await settle(F, N, L);
    // นิด: the record arrives without its amount, the note without the figure
    expect(N.e.can('view.cash')).toBe(false);
    expect(N.e.payChecks()[key]).toMatchObject({ s: 'back', amt: null });
    expect(N.e.payChecks()[key].note).not.toContain('53,500');
    expect(L.e.payChecks()[key]).toMatchObject({ amt: 53500, note: 'ยอด 53,500 บาท ไม่มีสลิป' });
  });
});

describe('a backup', () => {
  it('adds checks and month closes this browser does not have, never overwrites one, skips a broken one', async () => {
    const C = mk('C');
    C.e.sales.pchk = { 'zz/PAY1': { s: 'ok', by: 'ฝน', at: '2026-10-01T03:00:00.000Z', amt: 1, d: '2026-09-30', f: '' } };
    const ok = { s: 'ok', by: 'ฝน', at: '2026-10-02T03:00:00.000Z', amt: 999, d: '2026-09-30', f: '' };
    const backup = {
      kind: 'gcc-crm-backup', v: 1, crm: {}, contacts: {}, dedup: {}, custom: {},
      sales: {
        ...emptySales(),
        pchk: { 'zz/PAY1': ok, 'zz/PAY2': { ...ok, s: 'back', note: 'ไม่มีสลิป' }, 'zz/PAY3': { ...ok, s: 'maybe' }, bad: ok },
        mclose: { '2026-09': { by: 'ฝน', at: '2026-10-03T03:00:00.000Z', n: 2, amt: 1000 }, '2026-9': { by: 'ฝน', at: '', n: 1, amt: 1 } },
      },
    };
    await C.e.importCrm(Object.assign(new Blob([JSON.stringify(backup)]), { name: 'b.json' }) as File);
    expect(Object.keys(C.e.payChecks()).sort()).toEqual(['zz/PAY1', 'zz/PAY2']);
    expect(C.e.payChecks()['zz/PAY1'].amt).toBe(1);
    expect(C.e.payChecks()['zz/PAY2']).toMatchObject({ s: 'back', note: 'ไม่มีสลิป' });
    expect(Object.keys(C.e.monthCloses())).toEqual(['2026-09']);
  });
});
