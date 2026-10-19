/**
 * Capabilities in the engine (package roles), end to end with the real team script in the simulator:
 * - against the script deployed before configurable roles (team-sync/fixtures/Code.v3.gs: no me.caps), every
 *   account works by the built-in caps of its role and the role actions say which update they need;
 * - against the script of this release (team-sync/Code.gs, protocol v4): roles an admin makes, own-work
 *   scopes the script enforces, redaction of money, requests and their decisions, extras, temporary roles
 *   that run out, and the version gate an older build meets.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN, LATE_CAPS, type CapSet } from './caps';
import { histLine } from './reqText';
import { payState, planOf, quickMatch, trackerStatus } from './sales';
import { nextStepView, statusView } from './salesUi';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/r/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
/** The team script deployed before this release (protocol v3: built-in roles, no capabilities). */
const V3 = readFileSync(join(ROOT, 'team-sync', 'fixtures', 'Code.v3.gs'), 'utf8');
const REFRESH = 'มีเวอร์ชันใหม่ กรุณารีเฟรชหน้าเว็บ (F5)';

const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

const T0 = new Date('2026-10-15T03:00:00Z');
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

/** Bodies every engine sent. */
const sent: Record<string, unknown>[] = [];
/** An admin decides account u's request as the Requests page does: the one its card shows. */
async function decide(L: { e: GccEngine }, u: string, ok: boolean, note: string) {
  await L.e.reqDecide(u, ok, note, (await L.e.adminDir()).reqs[u].id);
}
interface Tab { e: GccEngine; store: ReturnType<typeof memoryStore>; browser: string }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  sent.length = 0;
  vi.setSystemTime(T0);
});

/** A browser; `cv` other than the build's own plays a tab still open on an older build. */
function mk(browser: string, cv?: number): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-15';
  raw.store = memoryStore();
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => {
    const b = cv == null ? body : { ...body, cv };
    sent.push(b);
    return sim.post(b) as Record<string, unknown>;
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
  const tab = { e, store: raw.store, browser };
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
/** A team whose lead (หมิว) claimed the first admin account; `code`: the script (default: this release's). */
async function lead(code?: string) {
  sim = createGasSim({ teamKey: '', kdfIter: 1000, ...(code ? { code } : {}) });
  sim.setup();
  const L = mk('L');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
  return L;
}
async function member(L: Tab, u: string, name: string, role: Role, cv?: number) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(u, cv);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  await settle(M);
  return M;
}
const pulls = () => sent.filter((b) => b.action === 'pull').map((b) => Number(b.since));
/** What the script stored for key k (as an admin pulls it). */
const stored = (L: Tab, k: string) => sim.post({ action: 'pull', since: 0, cv: 4, tok: L.e.session!.tok }).rows!.filter((r) => r.k === k).at(-1);
const SALES = BUILTIN.sales.c;
/** A built-in role as a script before capabilities gives it: without job expenses, which only a script that
 *  hides and guards them gives (lib/caps.ts LATE_CAPS). */
const before = (c: CapSet) => Object.fromEntries(Object.entries(c).filter(([k]) => !(LATE_CAPS as string[]).includes(k))) as CapSet;

describe('against the team script deployed before configurable roles (no me.caps)', () => {
  it('each account works by its role\'s built-in capabilities; cv 4 is accepted; roles and requests are not there yet', async () => {
    const L = await lead(V3);
    expect(L.e.myCaps()).toEqual(before(BUILTIN.admin.c));
    expect(L.e.can('view.exp')).toBe(false); // no job expenses: that script neither hides nor guards them
    expect(L.e.rolesLive).toBe(false);
    expect(L.e.roleName()).toBe('ผู้ดูแลระบบ');
    const S = await member(L, 'aek', 'เอก', 'sales');
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    expect(S.e.myCaps()).toEqual(before(SALES));
    expect([S.e.can('view.exp'), S.e.can('edit.exp'), S.e.canWriteKey('dexp/d1/e1', false)]).toEqual([false, false, false]);
    expect(S.e.can('view.comm')).toBe(false);
    expect(S.e.can('del.rec')).toBe(false);
    expect(S.e.can('del.log', 'เอก')).toBe(true);
    expect(S.e.can('del.log', 'หมิว')).toBe(false);
    expect(V.e.canWrite()).toBe(false);
    expect(V.e.can('view.money')).toBe(true);
    expect(sent.every((b) => b.cv === 4)).toBe(true);
    // a sales account's edits go through as before
    const d = S.e.addDeal({ client: 'บริษัท ทดสอบสิทธิ์ จำกัด' });
    await settle(S);
    expect(S.e.teamPendingN).toBe(0);
    expect(stored(L, 'deal/' + d.id)).toBeTruthy();
    // the admin page: the accounts, with the built-in roles standing in (read-only)
    const dir = await L.e.adminDir();
    expect(dir.v4).toBe(false);
    expect(dir.roles.map((r) => r.id)).toEqual(['admin', 'sales', 'viewer']);
    expect(dir.users.map((u) => u.u).sort()).toEqual(['aek', 'lead', 'pla']);
    // a role action the script doesn't know says which update it needs
    await expect(L.e.roleSave({ n: 'หัวหน้าฝ่ายขาย', d: '', c: {} })).rejects.toThrow(/อัปเดต Code\.gs/);
    await expect(S.e.reqSend({ k: 'caps', caps: [{ k: 'view.comm', s: 'all' }], note: 'x' })).rejects.toThrow(/อัปเดต Code\.gs/);
    // the request dialog's roles: the built-in three
    expect((await S.e.teamRoles()).map((r) => r.id)).toEqual(['admin', 'sales', 'viewer']);
  });

  it('a viewer sends nothing; an admin changing someone to viewer is said to them in the role\'s name', async () => {
    const L = await lead(V3);
    const S = await member(L, 'makorn', 'มกร', 'sales');
    await L.e.adminUpdate('makorn', { role: 'viewer' });
    await settle(S);
    expect(S.e.canWrite()).toBe(false);
    expect(S.e.teamNote).toBe('ผู้ดูแลระบบเปลี่ยนบัญชีของคุณเป็น ดูอย่างเดียว — แก้ไขข้อมูลไม่ได้แล้ว');
  });
});

describe('against the team script with configurable roles (Code.gs v4)', () => {
  it('a role an admin makes: its name and capabilities reach the account; own work only is enforced here and on the script', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    expect(S.e.rolesLive).toBe(true);
    expect(S.e.myCaps()).toEqual(SALES); // the built-in sales role, as the script sends it
    const { id } = await L.e.roleSave({ n: 'ขายเฉพาะงานตัวเอง', d: '', c: { ...SALES, 'edit.deal': 'own', 'edit.pay': 'own' } });
    expect(id).toMatch(/^r[0-9a-f]{6}$/);
    await L.e.adminUpdate('aek', { role: id });
    await settle(S);
    expect(S.e.session!.rid).toBe(id);
    expect(S.e.roleName()).toBe('ขายเฉพาะงานตัวเอง');
    expect(S.e.myCaps()!['edit.deal']).toBe('own');
    expect(S.e.teamNote).toBe('ผู้ดูแลระบบเปลี่ยนบทบาทของคุณเป็น ขายเฉพาะงานตัวเอง');
    const mine = S.e.addDeal({ client: 'บริษัท ของเอก จำกัด', resp: 'หมิว' });
    expect(mine.resp).toBe('เอก'); // an own-scope account adds deals of its own
    const other = L.e.addDeal({ client: 'บริษัท ของหมิว จำกัด', resp: 'หมิว' });
    await settle(L, S);
    expect(stored(L, 'deal/' + mine.id)).toBeTruthy();
    expect(S.e.canDeal('edit.deal', S.e.sales.deals[mine.id])).toBe(true);
    expect(S.e.canDeal('edit.deal', S.e.sales.deals[other.id])).toBe(false);
    // another person's deal: nothing changes here, and it is said why
    S.e.addAct(other.id, { type: 'call', note: 'โทรแทน' });
    expect(S.e.teamNote).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
    expect(S.e.canWriteKey('dstep/' + other.id + '/CALL1', false)).toBe(false);
    expect(S.e.canWriteKey('dstep/' + mine.id + '/CALL1', false)).toBe(true);
    // the script decides the same, whatever a browser sends
    const forced = sim.post({ action: 'push', cv: 4, tok: S.e.session!.tok, ops: [{ k: 'dstep/' + other.id + '/CALL1', v: { d: '2026-10-15', n: 'x' } }, { k: 'dstep/' + mine.id + '/CALL1', v: { d: '2026-10-15', n: 'y' } }] });
    expect(forced.denied).toEqual(['dstep/' + other.id + '/CALL1']);
  });

  it('a role that may record money but not edit deals: the receipt is saved, the automatic stage note is not', async () => {
    const L = await lead();
    const A = await member(L, 'fon', 'ฝน', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท รับเงิน จำกัด' });
    L.e.setPlan(d.id, [{ stage: 'PAY1', amt: 1000, pct: null, due: '2026-10-20', rel: null, how: 'transfer', howT: '', note: '' }]);
    await settle(L, A);
    const acct: CapSet = { 'view.sales': 'all', 'view.plan': 'all', 'view.money': 'all', 'view.cash': 'all', 'docs.open': 'all', 'edit.pay': 'all', 'docs.up': 'all', 'qt.check': 'all', 'pay.check': 'all', 'notify.mail': 'all' };
    const { id } = await L.e.roleSave({ n: 'บัญชี/การเงิน', d: '', c: acct });
    await L.e.adminUpdate('fon', { role: id });
    await settle(A);
    expect(A.e.roleName()).toBe('บัญชี/การเงิน');
    expect(A.e.myCaps()).toEqual(acct);
    A.e.markPaid(d.id, 'PAY1', { date: '2026-10-15', amount: 1000 });
    expect(A.e.sales.pays[`${d.id}/PAY1`]).toMatchObject({ rcv: '2026-10-15', got: 1000 });
    expect(A.e.sales.steps[`${d.id}/PAY1`]).toBeUndefined();
    await settle(A);
    expect(A.e.teamPendingN).toBe(0);
    // stored on the script, with its history line; no refused stage note
    expect(stored(L, `dpay/${d.id}/PAY1`)!.v).toMatchObject({ rcv: '2026-10-15', got: 1000 });
    expect(stored(L, `dstep/${d.id}/PAY1`)).toBeUndefined();
    expect(A.e.teamNote).toBe('ผู้ดูแลระบบเปลี่ยนบทบาทของคุณเป็น บัญชี/การเงิน');
  });

  it('without ดูยอดเงิน nothing is worked out from amounts it never got: received reads received, nothing is late, no plan, no instalments', async () => {
    const L = await lead();
    const { id: blind } = await L.e.roleSave({ n: 'ไม่เห็นเงิน', d: '', c: { 'view.sales': 'all', 'view.plan': 'all', 'edit.cust': 'all', 'edit.task': 'all' } });
    const N = await member(L, 'nid', 'นิด', blind);
    // the review's demo3: won 1 Oct, PAY1 received by hand on 14 Oct, PAY2 due 18 Oct (today is the 15th)
    const d = L.e.addDeal({ client: 'บริษัท คงธนา เซอร์วิส จำกัด', forecast: 107000 });
    L.e.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    L.e.setPlan(d.id, [
      { stage: 'PAY1', amt: 53500, pct: null, due: '2026-10-10', rel: null, how: 'transfer', howT: '', note: '' },
      { stage: 'PAY2', amt: 53500, pct: null, due: '2026-10-18', rel: null, how: 'transfer', howT: '', note: '' },
    ]);
    L.e.markPaid(d.id, 'PAY1', { date: '2026-10-14', amount: 53500 });
    // a second deal: its receipt recorded by someone whose stage note was not written (only the date came)
    const d2 = L.e.addDeal({ client: 'บริษัท รับโดยบัญชี จำกัด', forecast: 1000 });
    L.e.setStep(d2.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    L.e.setPlan(d2.id, [{ stage: 'PAY1', amt: 1000, pct: null, due: '2026-10-05', rel: null, how: 'transfer', howT: '', note: '' }]);
    await settle(L);
    sim.post({ action: 'push', cv: 4, tok: L.e.session!.tok, ops: [{ k: `dpay/${d2.id}/PAY1`, v: { ...stored(L, `dpay/${d2.id}/PAY1`)!.v as object, rcv: '2026-10-12', got: 1000 } }] });
    await settle(N);
    const S = N.e.sales, today = '2026-10-15';
    expect(N.e.can('view.money')).toBe(false);
    // the data came, without its amounts
    expect(S.pays[`${d.id}/PAY1`]).toMatchObject({ amt: null, got: null, rcv: '2026-10-14' });
    expect(S.deals[d.id].forecast).toBeNull();
    // no plan is worked out; what came in still reads so, from what carries no amount
    expect(planOf(S, S.deals[d.id], today)).toBeNull();
    expect(payState(S, S.deals[d.id], today)).toMatchObject({ pays: ['PAY1', 'PAY2'], paid: ['PAY1'], left: ['PAY2'], plan: null });
    expect(payState(S, S.deals[d2.id], today)).toMatchObject({ paid: ['PAY1'], left: [] });
    expect(statusView(S, S.deals[d.id], today)).toMatchObject({ word: 'ได้งาน', sub: 'รอชำระงวด 2' });
    expect(trackerStatus(S, S.deals[d.id], today)).toBe('ได้งาน');
    expect(nextStepView(S, S.deals[d.id], today)).toMatchObject({ tone: '' });
    expect(quickMatch(S, S.deals[d.id], 'paylate', today)).toBe(false);
    expect(quickMatch(S, S.deals[d2.id], 'ready', today)).toBe(true);
    expect(N.e.payDue('', '9999-12-31')).toEqual([]);
    const words = [statusView(S, S.deals[d.id], today).sub, trackerStatus(S, S.deals[d.id], today), nextStepView(S, S.deals[d.id], today).hint].join(' ');
    expect(words).not.toMatch(/เลยกำหนด|รับแล้ว 0|0 บาท/);
    // the admin's own tracker (another state) still works the plan out
    expect(planOf(L.e.sales, L.e.sales.deals[d.id], today)).toMatchObject({ paidN: 1, n: 2, left: 53500 });
    expect(payState(L.e.sales, L.e.sales.deals[d.id], today)).toMatchObject({ paid: ['PAY1'], left: ['PAY2'] });
    // given ดูยอดเงิน back: the plan returns
    await L.e.roleSave({ id: blind, n: 'ไม่เห็นเงิน', d: '', c: { 'view.sales': 'all', 'view.plan': 'all', 'edit.cust': 'all', 'edit.task': 'all', 'view.money': 'all' } });
    await settle(N);
    expect(N.e.can('view.money')).toBe(true);
    expect(planOf(N.e.sales, N.e.sales.deals[d.id], today)).toMatchObject({ paidN: 1, n: 2 });
  });

  it('losing ดูยอดเงิน: everything is pulled again without the amounts and document copies go; given back, the amounts return', async () => {
    const L = await lead();
    const S = await member(L, 'makorn', 'มกร', 'sales');
    const d = L.e.addDeal({ client: 'บริษัท ยอดเงิน จำกัด', forecast: 350000 });
    await settle(L, S);
    expect(S.e.sales.deals[d.id].forecast).toBe(350000);
    const blob = 'docblob:d1';
    await S.store.set(blob, { name: 'a.pdf', mime: 'application/pdf', data: new ArrayBuffer(4) });
    S.e.sales.docs['x/d1'] = { id: 'd1', deal: 'x', kind: 'quotation', name: 'a.pdf', mime: 'application/pdf', size: 4, fileId: 'F1' } as never;
    sent.length = 0;
    await settle(S);
    expect(pulls().some((s) => s === 0)).toBe(false); // nothing changed: from where it was
    // the admin takes ดูยอดเงิน from the built-in sales role (everything that needs it goes with it)
    await L.e.roleSave({ id: 'sales', n: 'พนักงานขาย', d: '', c: { 'view.sales': 'all', 'view.plan': 'all', 'edit.cust': 'all', 'edit.task': 'all' } });
    sent.length = 0;
    await settle(S);
    expect(pulls()).toContain(0);
    expect(S.e.can('view.money')).toBe(false);
    expect(S.e.teamNote).toBe('สิทธิ์ของคุณเปลี่ยนแล้ว · ดูได้ที่ สิทธิ์ของฉัน ในเมนูบัญชี');
    expect(await S.store.get(blob)).toBeFalsy();
    // the script sent the deal without its amount
    expect(S.e.sales.deals[d.id].forecast).toBeNull();
    expect(JSON.stringify(sent.filter((b) => b.action === 'pull'))).not.toContain('350000');
    // given back: everything again, amounts included
    await L.e.roleSave({ id: 'sales', n: 'พนักงานขาย', d: '', c: SALES });
    sent.length = 0;
    await settle(S);
    expect(pulls()).toContain(0);
    expect(S.e.sales.deals[d.id].forecast).toBe(350000);
  });

  it('a temporary role that runs out is said as such, not as an admin\'s change', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const { id } = await L.e.roleSave({ n: 'หัวหน้าฝ่ายขาย', d: '', c: { ...SALES, 'view.comm': 'all', 'qt.check': 'all' } });
    await S.e.reqSend({ k: 'role', role: id, note: 'ดูแลทีมแทนช่วงลา', until: '2026-10-20' });
    await decide(L, 'aek', true, '');
    await settle(S);
    expect(S.e.roleName()).toBe('หัวหน้าฝ่ายขาย');
    expect(S.e.session!.g?.r).toMatchObject({ id, until: '2026-10-20' });
    await S.e.reqAck();
    vi.setSystemTime(new Date('2026-10-20T16:59:00Z')); // 23:59 on the 20th in Bangkok: still holds
    await settle(S);
    expect(S.e.roleName()).toBe('หัวหน้าฝ่ายขาย');
    vi.setSystemTime(new Date('2026-10-20T17:00:00Z')); // midnight in Bangkok
    await settle(S);
    expect(S.e.roleName()).toBe('พนักงานขาย');
    expect(S.e.myCaps()).toEqual(SALES);
    expect(S.e.teamNote).toBe('บทบาทชั่วคราวหมดอายุแล้ว ตอนนี้คุณเป็น พนักงานขาย');
  });

  it('requests: the roles to ask for, send, the pending state, cancel; the admin\'s badge and decision; the result until it is read', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const { id } = await L.e.roleSave({ n: 'หัวหน้าฝ่ายขาย', d: '', c: { ...SALES, 'view.comm': 'all', 'qt.check': 'all' } });
    const roles = await S.e.teamRoles();
    expect(roles.map((r) => r.id)).toEqual(['admin', 'sales', 'viewer', id]);
    expect(S.e.roleNameOf(id)).toBe('หัวหน้าฝ่ายขาย');
    await S.e.reqSend({ k: 'role', role: id, note: 'ดูแลทีมแทนช่วงลา', until: '2027-01-31' });
    expect(S.e.session!.req).toMatchObject({ st: 'p', k: 'role', role: id, until: '2027-01-31', note: 'ดูแลทีมแทนช่วงลา' });
    expect(sent.find((b) => b.action === 'req_send')).toMatchObject({ action: 'req_send', k: 'role', role: id, note: 'ดูแลทีมแทนช่วงลา', until: '2027-01-31', cv: 4 });
    await S.e.reqCancel();
    expect(S.e.session!.req).toBeNull();
    await S.e.reqSend({ k: 'role', role: id, note: 'ดูแลทีมแทนช่วงลา', until: '2027-01-31' });
    // the admin's badge comes with the next reply
    await settle(L);
    expect(L.e.session!.rq).toBe(1);
    const dir = await L.e.adminDir();
    expect(dir.v4).toBe(true);
    expect(dir.reqs.aek).toMatchObject({ k: 'role', role: id, note: 'ดูแลทีมแทนช่วงลา' });
    await decide(L, 'aek', true, 'ตามที่ขอ');
    expect(L.e.session!.rq).toBe(0);
    await settle(S);
    expect(S.e.session!.req).toMatchObject({ st: 'r', ok: true, by: 'หมิว', note: 'ตามที่ขอ', role: id, until: '2027-01-31' });
    expect(S.e.roleName()).toBe('หัวหน้าฝ่ายขาย');
    expect(S.e.can('qt.check')).toBe(true);
    expect(S.e.teamNote).toBe(''); // the banner says it, not a team note
    await S.e.reqAck();
    expect(S.e.session!.req).toBeNull();
    // the history on the admin page, in words
    const after = await L.e.adminDir();
    const lines = after.audit.map((a) => histLine(a, (r) => L.e.roleNameOf(r), (u) => after.users.find((x) => x.u === u)?.name || u)).filter(Boolean);
    expect(lines[0]).toMatchObject({ who: 'เอก', by: 'หมิว', what: 'ขอเปลี่ยนบทบาท จาก พนักงานขาย เป็น หัวหน้าฝ่ายขาย ถึง 31 ม.ค. 2570', result: 'อนุมัติ', sub: '“ตามที่ขอ”' });
  });

  it('the admin decides the request on screen: one the requester replaced since is refused and shown again, never granted unseen', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'viewer');
    await S.e.reqSend({ k: 'caps', caps: [{ k: 'edit.task', s: 'all' }], note: 'ช่วยลงนัดให้ทีม' });
    const shown = (await L.e.adminDir()).reqs.aek;
    await S.e.reqSend({ k: 'caps', caps: [{ k: 'del.rec', s: 'all' }, { k: 'set.data', s: 'all' }, { k: 'set.lists', s: 'all' }], note: 'ช่วยลงนัดให้ทีม' });
    await expect(L.e.reqDecide('aek', true, '', shown.id)).rejects.toMatchObject({ code: 'req_changed', message: 'ผู้ขอเพิ่งแก้คำขอนี้ ระบบโหลดคำขอล่าสุดแล้ว ตรวจอีกครั้งก่อนตัดสิน' });
    expect(sent.find((b) => b.action === 'req_decide')).toMatchObject({ u: 'aek', ok: true, id: shown.id });
    await settle(S);
    expect(['del.rec', 'set.data', 'set.lists', 'edit.task'].map((c) => S.e.can(c as never))).toEqual([false, false, false, false]);
    const now = (await L.e.adminDir()).reqs.aek;
    expect(now.caps!.map((c) => c.k)).toEqual(['del.rec', 'set.lists', 'set.data']);
    await L.e.reqDecide('aek', false, 'ขอทีละเรื่อง', now.id);
    await settle(S);
    expect(S.e.session!.req).toMatchObject({ st: 'r', ok: false, note: 'ขอทีละเรื่อง' });
  });

  it('a capability request and an extra given directly: the account gets them, with their dates; nobody decides their own', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    await S.e.reqSend({ k: 'caps', caps: [{ k: 'edit.share', s: 'all' }], note: 'แบ่งสัดส่วนงานร่วม', until: '2026-11-30' });
    // what it needs is asked for too
    expect(S.e.session!.req).toMatchObject({ st: 'p', k: 'caps', caps: [{ k: 'view.comm', s: 'all' }, { k: 'edit.share', s: 'all' }] });
    await decide(L, 'aek', false, 'ยังไม่จำเป็น');
    await settle(S);
    expect(S.e.session!.req).toMatchObject({ st: 'r', ok: false, note: 'ยังไม่จำเป็น' });
    expect(S.e.can('edit.share')).toBe(false);
    await S.e.reqSend({ k: 'caps', caps: [{ k: 'edit.share', s: 'all' }], note: 'งานร่วมกับฝ่ายที่ปรึกษา', until: '2026-11-30' });
    await decide(L, 'aek', true, '');
    await settle(S);
    expect(S.e.can('edit.share')).toBe(true);
    expect(S.e.session!.g?.c?.map((x) => [x.k, x.until])).toEqual([['view.comm', '2026-11-30'], ['edit.share', '2026-11-30']]);
    await S.e.reqAck(); // the result was read
    await L.e.grantSave('aek', [{ k: 'del.rec', s: 'all' }]);
    await settle(S);
    expect(S.e.can('del.rec')).toBe(true);
    expect(S.e.teamNote).toBe('สิทธิ์ของคุณเปลี่ยนแล้ว · ดูได้ที่ สิทธิ์ของฉัน ในเมนูบัญชี');
    await expect(L.e.grantSave('aek', [{ k: 'edit.deal', s: 'all' }])).rejects.toThrow('บัญชีนี้มีสิทธิ์นี้จากบทบาทอยู่แล้ว');
    await expect(L.e.grantSave('lead', [{ k: 'del.rec', s: 'all' }])).rejects.toMatchObject({ code: 'not_self' });
    await L.e.grantDel('aek', 'del.rec');
    await settle(S);
    expect(S.e.can('del.rec')).toBe(false);
  });

  it('a role\'s name taken, an admin asking: the words say what about', async () => {
    const L = await lead();
    await L.e.roleSave({ n: 'หัวหน้าฝ่ายขาย', d: '', c: SALES });
    await expect(L.e.roleSave({ n: ' หัวหน้าฝ่ายขาย ', d: '', c: SALES })).rejects.toThrow('มีบทบาทชื่อนี้แล้ว');
    await expect(L.e.roleSave({ n: 'ก'.repeat(31), d: '', c: SALES })).rejects.toThrow('ชื่อบทบาทต้องยาว 1–30 ตัวอักษร');
    await expect(L.e.reqSend({ k: 'caps', caps: [{ k: 'view.comm', s: 'all' }], note: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a tab still open on an older build may read but its changes are refused with the refresh message, and kept', async () => {
    const L = await lead();
    const d = L.e.addDeal({ client: 'บริษัท แท็บเก่า จำกัด' });
    await settle(L);
    const O = await member(L, 'old', 'ทดลอง', 'sales', 3);
    expect(O.e.sales.deals[d.id]).toBeTruthy(); // it reads
    O.e.updateDeal(d.id, { referral: 'จากแท็บเก่า' });
    await settle(O);
    expect(O.e.teamPendingN).toBeGreaterThan(0); // kept, sent again after a refresh
    expect(O.e.team.msg).toBe(REFRESH);
    expect(stored(L, 'deal/' + d.id)!.v).not.toMatchObject({ referral: 'จากแท็บเก่า' });
  });
});
