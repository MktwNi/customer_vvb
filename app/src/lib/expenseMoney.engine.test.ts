/**
 * The month check of money out through the engine and the real team script (team-sync/Code.gs in the
 * simulator): an account whose role has ตรวจยืนยันรับเงิน and ดูค่าใช้จ่ายและกำไรของงาน checks an expense a
 * salesperson recorded (the script signs the check, `dchk/<dealId>/exp.<expId>`, and its history row
 * `dlog/exp.<id>` reaches no account without ดูค่าใช้จ่าย); the recorder may not check their own; undo; sent
 * back with a note; a change after the check waits again; an expense deleted or marked unpaid after its check
 * is an orphan until acknowledged; the out side of a month closed (`mclose/<YYYY-MM>/out`) and opened again,
 * refused while another person's expense waits; a pay.check role without ดูค่าใช้จ่าย has no out side at all.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { canClose, sumRows } from './payCheck';
import { expChkRows, expLines, type XRow } from './expenseMoney';
import type { CapSet } from './caps';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/xo/exec';
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

const sent: Record<string, unknown>[] = [];
interface Tab { e: GccEngine; browser: string }
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
  raw.store = memoryStore();
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
/** An account writes expense records straight to the script (the recording screens are the other side's). */
const push = (t: Tab, ops: { k: string; v?: unknown }[]) => sim.post({ action: 'push', cv: 4, tok: t.e.session!.tok, ops }) as { ok: boolean; denied: string[] };
const stored = (L: Tab, k: string) => sim.post({ action: 'pull', since: 0, cv: 4, xp: 1, tok: L.e.session!.tok }).rows!.filter((r) => r.k === k).at(-1);
const rowsOf = (t: Tab) => expChkRows(t.e.sales, expLines(t.e.sales), t.e.expChecks(), t.e.payChkCfg().since);
const rowOf = (t: Tab, key: string) => rowsOf(t).find((r) => r.key === key) as XRow;
const BASE: CapSet = { 'view.sales': 'all', 'view.plan': 'all', 'view.money': 'all', 'view.cash': 'all', 'docs.open': 'all', 'pay.check': 'all' };
const ACCT: CapSet = { ...BASE, 'view.exp': 'all' };
const exp = (o: Record<string, unknown> = {}) => ({ c: 'ผู้รับเหมา', amt: 25000, d: '2026-09-25', paid: '2026-09-28', ...o });

describe('the month check of money out against the team script', () => {
  it('accounting checks an expense a salesperson recorded: the script signs it, the history row stays with those who see expenses; the recorder can\'t; undo; the out side of a month closed and opened again', async () => {
    const L = await lead();
    const { id: acct } = await L.e.roleSave({ n: 'บัญชี/การเงิน', d: '', c: ACCT });
    const F = await member(L, 'fon', 'ฝน', acct);
    const S = await member(L, 'aek', 'เอก', 'sales');
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    expect([F.e.can('pay.check'), F.e.can('view.exp'), S.e.can('pay.check')]).toEqual([true, true, false]);
    const d = S.e.addDeal({ client: 'บริษัท เงินออก จำกัด', year: '2569', resp: 'เอก' });
    await settle(S);
    // เอก records a paid expense with its bill on his own job: the script signs it with his name
    expect(push(S, [{ k: `dexp/${d.id}/e1`, v: exp({ file: { id: 'bill1', name: 'บิล.pdf', mime: 'application/pdf', size: 10 } }) }])).toMatchObject({ ok: true, denied: [] });
    await settle(S, F, L, V);
    const key = d.id + '/e1';
    const r = rowOf(F, key);
    expect([r.kind, r.state, r.by, r.amt, r.date, r.fp]).toEqual(['got', 'wait', ['เอก'], 25000, '2026-09-28', { amt: 25000, d: '2026-09-28', f: 'bill1' }]);
    // the salesperson: no ตรวจยืนยันรับเงิน; nothing is written
    expect(S.e.expCheckBlock(rowOf(S, key))).toBe('cap');
    expect(S.e.checkExps([rowOf(S, key)])).toEqual([]);
    expect(S.e.canWriteKey(`dchk/${d.id}/exp.e1`, false)).toBe(false);
    // accounting checks it: in ฝน's name, with a history row about money out
    vi.setSystemTime(new Date('2026-10-12T04:00:00Z'));
    expect(F.e.expCheckBlock(r)).toBe('');
    expect(F.e.checkExps([r])).toEqual([key]);
    expect(F.e.lastExpChecks?.keys).toEqual([key]);
    await settle(F, L, S, V);
    const row = stored(L, `dchk/${d.id}/exp.e1`)!;
    expect(row.v).toMatchObject({ s: 'ok', by: 'ฝน', amt: 25000, d: '2026-09-28', f: 'bill1' });
    expect(row.by).toBe('ฝน');
    expect(rowOf(L, key).state).toBe('ok');
    expect(rowOf(S, key).state).toBe('ok');
    const hist = Object.entries(L.e.sales.log).find(([, x]) => x.action === 'ตรวจเงินออก ผู้รับเหมา');
    expect(hist && hist[0].startsWith('exp.') && hist[1].by === 'ฝน' && hist[1].deal === d.id).toBe(true);
    // never in the income check, and nothing of it reaches the viewer
    expect(L.e.payChecks()[key]).toBeUndefined();
    expect([V.e.sales.exp || {}, V.e.sales.xchk || {}]).toEqual([{}, {}]);
    expect(Object.values(V.e.sales.log).some((x) => x.action.includes('เงินออก'))).toBe(false);
    // September is over and its expense is checked: its out side closes, in ฝน's name; then opens again
    const sep = sumRows(rowsOf(F).filter((x) => x.ym === '2026-09'));
    expect(canClose(sep, '2026-09', '2026-10-12')).toBe(true);
    expect(F.e.closeMonthOut('2026-09')).toMatchObject({ by: 'ฝน', n: 1, amt: 25000 });
    await settle(F, L);
    expect(stored(L, 'mclose/2026-09/out')!.v).toMatchObject({ by: 'ฝน', n: 1, amt: 25000 });
    expect(L.e.monthClosesOut()['2026-09']).toMatchObject({ by: 'ฝน', n: 1 });
    // the income side of September is a month of its own
    expect(L.e.monthCloses()['2026-09']).toBeUndefined();
    expect(S.e.closeMonthOut('2026-09')).toBeNull();
    F.e.reopenMonthOut('2026-09');
    await settle(F, L);
    expect(stored(L, 'mclose/2026-09/out')!.del).toBe(true);
    expect(L.e.monthClosesOut()['2026-09']).toBeUndefined();
    // undo: one's own check within 10 minutes
    expect(S.e.undoExpChecks([key])).toBe(0);
    vi.setSystemTime(new Date('2026-10-12T04:05:00Z'));
    expect(F.e.undoExpChecks([key])).toBe(1);
    await settle(F, L);
    expect(stored(L, `dchk/${d.id}/exp.e1`)!.del).toBe(true);
    expect(rowOf(L, key).state).toBe('wait');
    // an admin who recorded an expense may not check it either
    const o = L.e.addDeal({ client: 'บริษัท หมิวจ่าย จำกัด', year: '2569', resp: 'หมิว' });
    await settle(L);
    expect(push(L, [{ k: `dexp/${o.id}/m1`, v: exp({ by: 'หมิว', at: '2026-10-12T04:05:00.000Z', amt: 1200, c: 'ค่าเดินทาง' }) }])).toMatchObject({ ok: true });
    await settle(L);
    const mine = rowOf(L, o.id + '/m1');
    expect(L.e.expCheckBlock(mine)).toBe('self');
    expect(L.e.checkExps([mine])).toEqual([]);
  });

  it('closing the out side counts every deal\'s paid expenses: refused while another person\'s waits', async () => {
    const L = await lead();
    const { id: acct } = await L.e.roleSave({ n: 'บัญชี/การเงิน', d: '', c: ACCT });
    const F = await member(L, 'fon', 'ฝน', acct);
    const a = L.e.addDeal({ client: 'บริษัท ก จำกัด', year: '2569', resp: 'หมิว' });
    const b = L.e.addDeal({ client: 'บริษัท ข จำกัด', year: '2569', resp: 'หมิว' });
    await settle(L);
    push(L, [{ k: `dexp/${a.id}/x`, v: exp({ by: 'หมิว', at: 'a' }) }, { k: `dexp/${b.id}/y`, v: exp({ by: 'หมิว', at: 'a', amt: 4000, c: 'ค่าเดินทาง' }) }]);
    await settle(F);
    expect(F.e.checkExps([rowOf(F, a.id + '/x')])).toEqual([a.id + '/x']);
    expect(F.e.closeMonthOut('2026-09')).toBeNull();
    expect(F.e.closeMonthOut('2026-10')).toBeNull();
    expect(F.e.checkExps([rowOf(F, b.id + '/y')])).toEqual([b.id + '/y']);
    expect(F.e.closeMonthOut('2026-09')).toMatchObject({ n: 2, amt: 29000 });
    await settle(F, L);
    expect(stored(L, 'mclose/2026-09/out')!.v).toMatchObject({ by: 'ฝน', n: 2, amt: 29000 });
  });

  it('sent back with a note; changed after it waits again; deleted or marked unpaid after the check: an orphan until acknowledged', async () => {
    const L = await lead();
    const { id: acct } = await L.e.roleSave({ n: 'บัญชี/การเงิน', d: '', c: ACCT });
    const F = await member(L, 'fon', 'ฝน', acct);
    const S = await member(L, 'aek', 'เอก', 'sales');
    const d = S.e.addDeal({ client: 'บริษัท ส่งกลับ จำกัด', year: '2569', resp: 'เอก' });
    await settle(S);
    push(S, [{ k: `dexp/${d.id}/e1`, v: exp({ paid: '2026-10-05', d: '2026-10-05' }) }, { k: `dexp/${d.id}/e2`, v: exp({ paid: '2026-10-06', d: '2026-10-06', amt: 900, c: 'ค่าเดินทาง' }) }]);
    await settle(S, F);
    const key = d.id + '/e1';
    expect(F.e.returnExp(rowOf(F, key), '')).toBe(false);
    expect(F.e.returnExp(rowOf(F, key), 'ยอดในบิล 24,000 บาท ไม่ตรง')).toBe(true);
    await settle(F, S, L);
    const back = rowOf(S, key);
    expect([back.state, back.rec?.note]).toEqual(['back', 'ยอดในบิล 24,000 บาท ไม่ตรง']);
    expect(stored(L, `dchk/${d.id}/exp.e1`)!.v).toMatchObject({ s: 'back', by: 'ฝน', note: 'ยอดในบิล 24,000 บาท ไม่ตรง' });
    // the recorder corrects the amount: it waits for accounting again, with what changed
    push(S, [{ k: `dexp/${d.id}/e1`, v: exp({ paid: '2026-10-05', d: '2026-10-05', amt: 24000 }) }]);
    await settle(S, F);
    const ch = rowOf(F, key);
    expect([ch.state, ch.diff?.amt]).toEqual(['changed', [25000, 24000]]);
    expect(F.e.checkExps([ch, rowOf(F, d.id + '/e2')])).toEqual([key, d.id + '/e2']);
    await settle(F, S);
    // one marked unpaid, the other deleted: both orphans in October until acknowledged
    push(S, [{ k: `dexp/${d.id}/e1`, v: exp({ d: '2026-10-05', amt: 24000, paid: '' }) }, { k: `dexp/${d.id}/e2` }]);
    await settle(S, F, L);
    const o1 = rowOf(F, key), o2 = rowOf(F, d.id + '/e2');
    expect([o1.kind, o1.ym, o1.amt, o1.x?.kind]).toEqual(['orphan', '2026-10', 24000, 'unpaid']);
    expect([o2.kind, o2.x]).toEqual(['orphan', null]);
    F.e.ackExpOrphan(o1);
    F.e.ackExpOrphan(o2);
    await settle(F, L);
    expect(stored(L, `dchk/${d.id}/exp.e1`)!.del).toBe(true);
    expect(stored(L, `dchk/${d.id}/exp.e2`)!.del).toBe(true);
    expect(rowsOf(F).some((x) => x.kind === 'orphan')).toBe(false);
  });

  it('a role with ตรวจยืนยันรับเงิน but without ดูค่าใช้จ่าย: no out side, nothing written', async () => {
    const L = await lead();
    const { id: acct } = await L.e.roleSave({ n: 'บัญชีรับเงิน', d: '', c: BASE });
    const F = await member(L, 'fon', 'ฝน', acct);
    const d = L.e.addDeal({ client: 'บริษัท ซ่อน จำกัด', year: '2569', resp: 'หมิว' });
    await settle(L);
    push(L, [{ k: `dexp/${d.id}/e1`, v: exp({ by: 'เอก', at: 'a' }) }]);
    await settle(F);
    expect([F.e.can('pay.check'), F.e.can('view.exp')]).toEqual([true, false]);
    expect(F.e.sales.exp || {}).toEqual({});
    expect(F.e.expCheckBlock()).toBe('cap');
    // a row handed over anyway (an older screen): refused here, nothing queued
    const r = rowOf(L, d.id + '/e1');
    sent.length = 0;
    expect(F.e.checkExps([r])).toEqual([]);
    expect(F.e.returnExp(r, 'x')).toBe(false);
    expect(F.e.closeMonthOut('2026-09')).toBeNull();
    await settle(F);
    expect(sent.filter((b) => b.action === 'push')).toEqual([]);
    expect(stored(L, `dchk/${d.id}/exp.e1`)).toBeUndefined();
  });

  it('a bill opened from the out side leaves no copy in the browser: the team\'s Drive file with เปิดเอกสารแนบ, or this browser\'s own copy of a bill attached here', async () => {
    const L = await lead();
    const { id: acct } = await L.e.roleSave({ n: 'บัญชี/การเงิน', d: '', c: ACCT });
    const { 'docs.open': _open, ...shut } = ACCT;
    const { id: acct2 } = await L.e.roleSave({ n: 'บัญชีไม่เปิดไฟล์', d: '', c: shut });
    const F = await member(L, 'fon', 'ฝน', acct);
    const S = await member(L, 'aek', 'เอก', 'sales');
    const G = await member(L, 'kate', 'เก๋', acct2);
    const d = S.e.addDeal({ client: 'บริษัท บิล จำกัด', year: '2569', resp: 'เอก' });
    await settle(S);
    // เอก uploads the bill (บันทึกค่าใช้จ่ายของงาน may) and records the paid expense with it
    const bytes = Buffer.from('%PDF-1.4 bill of e1');
    const up = sim.post({ action: 'upload', cv: 4, tok: S.e.session!.tok, docId: 'exp_e1', name: 'บิล.pdf', mime: 'application/pdf', data: bytes.toString('base64') }) as { ok: boolean; fileId: string };
    expect(up.ok).toBe(true);
    const file = { id: up.fileId, name: 'บิล.pdf', mime: 'application/pdf', size: bytes.length };
    expect(push(S, [{ k: `dexp/${d.id}/e1`, v: exp({ file }) }])).toMatchObject({ ok: true, denied: [] });
    await settle(S, F, G);
    const x = expLines(F.e.sales).find((l) => l.id === d.id + '/e1')!;
    expect(x.file).toEqual(file);
    // ฝน opens it: the file, and nothing written to the browser's store (no 'docblob:exp_e1', no 'expblob:e1')
    const writes: string[] = [];
    const st = F.e.store, set0 = st.set.bind(st);
    st.set = (k, v) => (writes.push(k), set0(k, v));
    const b = await F.e.expBill({ id: x.expId, file: x.file });
    expect(Buffer.from(await b.arrayBuffer()).toString()).toBe('%PDF-1.4 bill of e1');
    expect(b.type).toBe('application/pdf');
    expect(writes.filter((k) => /blob:/.test(k))).toEqual([]);
    expect([await st.get('docblob:exp_e1'), await st.get('expblob:e1')]).toEqual([null, null]);
    // signing out with "delete the team's data" has no bill copy to miss
    await F.e.teamLogout({ wipe: true });
    expect([await st.get('docblob:exp_e1'), await st.get('expblob:e1')]).toEqual([null, null]);
    // without เปิดเอกสารแนบ the team's file is not opened (and nothing is asked of the script)
    sent.length = 0;
    await expect(G.e.expBill({ id: x.expId, file: x.file })).rejects.toThrow('เปิดไฟล์แนบไม่ได้');
    expect(sent.filter((r) => r.action === 'file')).toEqual([]);
    // a bill attached in this browser and not uploaded yet (file id ''): its copy here opens, with no request;
    // a copy of another file under the same id (the bill was replaced elsewhere) is not that bill
    const local = new TextEncoder().encode('%PDF-1.4 attached here');
    await S.e.store.set('expblob:e9', { name: 'ใบเสร็จ.pdf', mime: 'application/pdf', data: local.buffer, by: 'เอก' });
    const here = { id: 'e9', file: { id: '', name: 'ใบเสร็จ.pdf', mime: 'application/pdf', size: local.byteLength } };
    sent.length = 0;
    expect(await (await S.e.expBill(here)).text()).toBe('%PDF-1.4 attached here');
    expect(sent).toEqual([]);
    await expect(S.e.expBill({ id: 'e9', file: { ...here.file, name: 'อื่น.pdf' } })).rejects.toThrow('ยังไม่ได้อัปโหลด');
    // one that only lives on the recorder's computer: said so, nothing asked of the script
    await expect(F.e.expBill({ id: 'e8', file: { id: '', name: 'x.pdf', mime: 'application/pdf', size: 3 } })).rejects.toThrow('ยังอยู่ในเครื่องของคนที่บันทึก');
    await expect(F.e.expBill({ id: 'e8', file: null })).rejects.toThrow('ยังไม่มีบิล');
  });
});
