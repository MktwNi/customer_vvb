/**
 * Job expenses ("ค่าใช้จ่ายของงาน") in the team script (team-sync/Code.gs, protocol v4), run through the
 * simulator. The owner's decisions: the category is free text on each expense; the admin chooses who may SEE
 * expenses (view.exp) and who may RECORD them (edit.exp) when configuring roles; accounting checks money going
 * out as it checks money coming in. This file restates the data contract independently of the script:
 * - dexp/<dealId>/<expId> = { c, n?, amt, d, paid?, file?, by, at }: edit.exp to write and to delete, own work =
 *   the deal's ผู้รับผิดชอบ (as dpay/) both before the push and at the op (a push can't hand itself a deal, write
 *   its expenses and hand it back); by and at are the account's and the server's for every non-admin;
 * - dlog/exp.<id> (their history): edit.exp or pay.check; deleting: set.users;
 * - dchk/<dealId>/exp.<expId> (an expense checked) and mclose/<YYYY-MM>/out (a month's expenses closed):
 *   pay.check, by and at forced as for the income check;
 * - pull: without view.exp (or view.money) all four come as deletions with no author or time; a build that does not say it knows
 *   expenses (no xp) gets an expense's check as a deletion (it would read it as a cancelled income check);
 * - a deal deleted by an account takes its expenses along; their checks stay;
 * - an expense's bill (docId exp_<expId>) may be uploaded and trashed with edit.exp alone; with edit.exp for its own
 *   work only, trashed only when it is the bill of expenses on the account's own deals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';

type Caps = Record<string, 1 | 'own'>;
type Reply = ReturnType<GasSim['post']>;

const T0 = Date.parse('2026-10-19T03:00:00.000Z'); // 10:00 in Bangkok
const MIN = 60000;
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const ones = (l: string[]): Caps => Object.fromEntries(l.map((c) => [c, 1]));

// the roles of this file: who sees expenses, who records them, accounting
const SEES = ones(['view.sales', 'view.money', 'view.exp']);
const RECORDS = ones(['view.sales', 'view.money', 'view.exp', 'edit.exp']);
const ACCT = ones(['view.sales', 'view.money', 'view.cash', 'view.exp', 'docs.open', 'edit.pay', 'docs.up', 'pay.check']);
// accounting as the mockups drew it before expenses (no view.exp): it may check blind, but never reads them
const ACCT_OLD = ones(['view.sales', 'view.money', 'view.cash', 'docs.open', 'edit.pay', 'docs.up', 'pay.check']);
const HEAD_NO_EXP = ones(['view.sales', 'view.money', 'edit.cust', 'edit.deal', 'del.rec']);

const seen: { replies: string[]; s: GasSim }[] = [];
function mk(teamKey = ''): GasSim {
  const s = createGasSim({ kdfIter: 1000, teamKey });
  const rec = { replies: [] as string[], s };
  seen.push(rec);
  const post = s.post;
  s.post = (body) => {
    const r = post(body);
    rec.replies.push(JSON.stringify(r));
    return r;
  };
  return s;
}
const call = (s: GasSim, tok: string, action: string, extra: Record<string, unknown> = {}) => s.post({ action, cv: 4, tok, ...extra });
const login = (s: GasSim, u: string, pw: string) => s.post({ action: 'login', cv: 4, u, pk: s.pk(u, pw), rm: true });
/** A team whose lead (admin "lead", หัวหน้า) is signed in. */
function team() {
  const s = mk();
  const admin = s.bootstrapAdmin({ u: 'lead', name: 'หัวหน้า', pw: 'lead-password-1' });
  return { s, admin };
}
function member(s: GasSim, admin: string, u: string, name: string, role: string) {
  expect(call(s, admin, 'user_save', { create: true, u, name, role, pk: s.pk(u, 'temp-' + u) })).toMatchObject({ ok: true });
  const t = login(s, u, 'temp-' + u);
  const r = call(s, String(t.tok), 'passwd', { old: s.pk(u, 'temp-' + u), pk: s.pk(u, 'own-' + u) });
  expect(r).toMatchObject({ ok: true });
  return String(r.tok);
}
function role(s: GasSim, admin: string, n: string, c: Caps) {
  const r = call(s, admin, 'role_save', { n, c });
  expect(r).toMatchObject({ ok: true });
  return String(r.id);
}
const props = (s: GasSim, k: string) => JSON.parse(s.props[k] || '{}');
const rowsOf = (r: Reply) => r.rows!;
const byKey = (r: Reply) => Object.fromEntries(rowsOf(r).map((x) => [x.k, x]));
const pullAll = (s: GasSim, tok: string, xp = true) => call(s, tok, 'pull', { since: 0, ...(xp ? { xp: 1 } : {}) });
const meCaps = (r: Reply) => (r.me as { caps: Caps }).caps;
const audit = (s: GasSim) => (s.sheetOf('audit')?.rows || []).slice(1).filter((r) => r[0]).map((r) => ({ u: r[2], action: r[3], detail: JSON.parse(r[4]) }));

/** An expense as the web app writes it (by / at are the script's). */
const exp = (o: Record<string, unknown> = {}) => ({ c: 'ค่าเดินทาง', n: 'ไปตรวจโรงงาน', amt: 3500, d: '2026-10-05', ...o });
/** Two deals: d1 is สมชาย's, d2 คุณบี's. */
const DEALS = [
  { k: 'deal/d1', v: { client: 'บริษัท ก จำกัด', resp: 'สมชาย', forecast: 100000, actual: 100000 } },
  { k: 'deal/d2', v: { client: 'บริษัท ข จำกัด', resp: 'คุณบี', forecast: 50000 } },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ 1. who may write what

describe('the key table for job expenses: prefix × capability × own / all × write / delete', () => {
  /** Records the admin made first (to delete), then each account's attempt at every one. */
  const BEFORE = [
    ...DEALS,
    { k: 'dexp/d1/old', v: exp() },
    { k: 'dexp/d2/old', v: exp() },
    { k: 'dlog/exp.h0', v: { action: 'บันทึกค่าใช้จ่าย', deal: 'd1', by: 'หัวหน้า' } },
    { k: 'dchk/d2/exp.old', v: { s: 'ok', amt: 3500, d: '2026-10-05', f: '' } },
    { k: 'mclose/2026-09/out', v: { n: 1, amt: 3500 } },
  ];
  const OPS = [
    { k: 'dexp/d1/a', v: exp() }, // a deal of สมชาย
    { k: 'dexp/d2/a', v: exp() }, // คุณบี's
    { k: 'dexp/d9/a', v: exp() }, // no such deal
    { k: 'dexp/d1/old', del: true },
    { k: 'dexp/d2/old', v: null }, // a value of null deletes too
    { k: 'dlog/exp.h1', v: { action: 'บันทึกค่าใช้จ่าย', deal: 'd1', by: 'x' } },
    { k: 'dlog/exp.h0', del: true },
    { k: 'dchk/d1/exp.a', v: { s: 'ok', amt: 3500, d: '2026-10-05', f: '' } },
    { k: 'dchk/d2/exp.old', del: true },
    { k: 'mclose/2026-10/out', v: { n: 1, amt: 3500 } },
    { k: 'mclose/2026-09/out', del: true },
  ];
  const ALL = OPS.map((o) => o.k);
  const CASES: [string, string | Caps, string[]][] = [
    ['admin', 'admin', ALL],
    // the built-in พนักงานขาย: sees every expense, records those of its own deals; their history too
    ['sales', 'sales', ['dexp/d1/a', 'dexp/d1/old', 'dlog/exp.h1']],
    ['records every deal\'s', RECORDS, ['dexp/d1/a', 'dexp/d2/a', 'dexp/d9/a', 'dexp/d1/old', 'dexp/d2/old', 'dlog/exp.h1']],
    ['records its own deals\'', { ...SEES, 'edit.exp': 'own' }, ['dexp/d1/a', 'dexp/d1/old', 'dlog/exp.h1']],
    // accounting: the checks, the closed months and the history rows they write; no expense itself
    ['accounting', ACCT, ['dlog/exp.h1', 'dchk/d1/exp.a', 'dchk/d2/exp.old', 'mclose/2026-10/out', 'mclose/2026-09/out']],
    // a deal head without the expense capabilities: none of it
    ['a deal head who does not see expenses', HEAD_NO_EXP, []],
  ];

  it.each(CASES)('%s', (_name, r, allowed) => {
    const { s, admin } = team();
    expect(call(s, admin, 'push', { ops: BEFORE }).n).toBe(BEFORE.length);
    const tok = r === 'admin' ? admin : member(s, admin, 'somchai', 'สมชาย', typeof r === 'string' ? r : role(s, admin, 'ทดสอบ', r));
    const out = call(s, tok, 'push', { ops: OPS });
    expect(out).toMatchObject({ ok: true, n: allowed.length, rejected: [] });
    expect(out.denied).toEqual(ALL.filter((k) => !allowed.includes(k)));
    // what was stored is what was allowed, nothing else (no seq used by a refused op)
    const after = rowsOf(call(s, admin, 'pull', { since: BEFORE.length, xp: 1 })).map((x) => x.k);
    expect(after).toEqual(ALL.filter((k) => allowed.includes(k)));
  });

  it('seeing expenses only (no edit.exp, no other write): no push at all; a viewer neither', () => {
    const { s, admin } = team();
    const look = member(s, admin, 'pla', 'ปลา', role(s, admin, 'ดูค่าใช้จ่าย', SEES));
    const v = member(s, admin, 'vee', 'วี', 'viewer');
    for (const tok of [look, v]) expect(call(s, tok, 'push', { ops: OPS })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(Number(s.props.SEQ || 0)).toBe(0);
  });

  it('own work follows the deal\'s ผู้รับผิดชอบ as it is on the sheet, also a deal made or given away in the same push', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: DEALS });
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const r = call(s, tok, 'push', {
      ops: [
        { k: 'deal/d3', v: { client: 'บริษัท ค จำกัด', resp: 'สมชาย' } },
        { k: 'dexp/d3/a', v: exp() }, // the deal this push made
        { k: 'deal/d1', v: { client: 'บริษัท ก จำกัด', resp: 'คุณบี' } }, // given away
        { k: 'dexp/d1/b', v: exp() }, // no longer its own
      ],
    });
    expect(r).toMatchObject({ n: 3, denied: ['dexp/d1/b'] });
  });

  it('a push that hands itself someone\'s deal, writes its expenses and hands it back stores the deal changes only', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: [...DEALS, { k: 'dexp/d2/old', v: exp() }, { k: 'dpay/d2/PAY1', v: { amt: 50000 } }] });
    // the built-in พนักงานขาย: edit.deal for every deal, edit.exp for its own
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const before = Number(s.props.SEQ);
    const swap = [
      { k: 'deal/d2', v: { client: 'บริษัท ข จำกัด', resp: 'สมชาย', forecast: 50000 } },
      { k: 'dexp/d2/new', v: exp() },
      { k: 'dexp/d2/old', del: true },
      { k: 'deal/d2', v: { client: 'บริษัท ข จำกัด', resp: 'คุณบี', forecast: 50000 } },
    ];
    expect(call(s, tok, 'push', { ops: swap })).toMatchObject({ ok: true, n: 2, denied: ['dexp/d2/new', 'dexp/d2/old'] });
    expect(rowsOf(call(s, admin, 'pull', { since: before, xp: 1 })).map((x) => x.k)).toEqual(['deal/d2', 'deal/d2']);
    expect(byKey(pullAll(s, admin))['dexp/d2/old']).toMatchObject({ del: false });
    // the same for a payment plan held for its own deals only by a role that may reassign every deal
    const pay = member(s, admin, 'kai', 'ไก่', role(s, admin, 'แก้ดีลทุกดีล แผนชำระงานตัวเอง', { ...ones(['view.sales', 'view.money', 'edit.deal']), 'edit.pay': 'own' }));
    const r = call(s, pay, 'push', { ops: [{ k: 'deal/d2', v: { resp: 'ไก่' } }, { k: 'dpay/d2/PAY1', v: { amt: 1 } }, { k: 'dpay/d2/PAY1', del: true }, { k: 'deal/d2', v: { resp: 'คุณบี' } }] });
    expect(r).toMatchObject({ n: 2, denied: ['dpay/d2/PAY1', 'dpay/d2/PAY1'] });
    // its own deal: expenses before it hands the deal over in the same push are its own; after, not
    const own = call(s, tok, 'push', { ops: [{ k: 'dexp/d1/c', v: exp() }, { k: 'deal/d1', v: { client: 'บริษัท ก จำกัด', resp: 'คุณบี' } }, { k: 'dexp/d1/d', v: exp() }] });
    expect(own).toMatchObject({ n: 2, denied: ['dexp/d1/d'] });
  });

  it('taken over in one push, the deal is the account\'s own in the next (a change everyone sees); each expense names who recorded it', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: DEALS });
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, tok, 'push', { ops: [{ k: 'deal/d2', v: { client: 'บริษัท ข จำกัด', resp: 'สมชาย' } }] })).toMatchObject({ n: 1, denied: [] });
    expect(call(s, tok, 'push', { ops: [{ k: 'dexp/d2/a', v: exp({ by: 'คุณบี' }) }] })).toMatchObject({ n: 1, denied: [] });
    const g = byKey(pullAll(s, admin));
    expect(g['deal/d2']).toMatchObject({ by: 'สมชาย', v: { resp: 'สมชาย' } });
    expect(g['dexp/d2/a']).toMatchObject({ by: 'สมชาย', v: { by: 'สมชาย' } });
    // a deal deleted before the push and made again by it counts as a new deal
    call(s, admin, 'push', { ops: [{ k: 'deal/d3', v: { resp: 'คุณบี' } }, { k: 'deal/d3', del: true }] });
    expect(call(s, tok, 'push', { ops: [{ k: 'deal/d3', v: { resp: 'สมชาย' } }, { k: 'dexp/d3/a', v: exp() }] })).toMatchObject({ n: 2, denied: [] });
  });
});

// ------------------------------------------------------------------ 2. names and times

describe('who wrote an expense and when: the account and the server, for every account but an admin', () => {
  it('dexp/ takes the account\'s name and the server\'s time (key order kept); a teammate\'s edit takes theirs; an admin\'s push is kept', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: DEALS });
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const head = member(s, admin, 'mint', 'มินท์', role(s, admin, 'หัวหน้าฝ่ายขาย', RECORDS));
    at(5 * MIN);
    const v = exp({ paid: '2026-10-06', file: { id: 'F1', name: 'บิล.pdf', mime: 'application/pdf', size: 1234 }, by: 'ปลอม', at: '2020-01-01T00:00:00.000Z' });
    expect(call(s, tok, 'push', { ops: [{ k: 'dexp/d1/a', v }, { k: 'dexp/d1/b', v: exp() }] })).toMatchObject({ n: 2, denied: [] });
    const t1 = new Date(T0 + 5 * MIN).toISOString();
    const g = byKey(pullAll(s, admin));
    expect(g['dexp/d1/a'].v).toEqual({ ...v, by: 'สมชาย', at: t1 });
    expect(Object.keys(g['dexp/d1/a'].v as object)).toEqual(Object.keys(v));
    expect(g['dexp/d1/b'].v).toEqual({ ...exp(), by: 'สมชาย', at: t1 });
    expect([g['dexp/d1/a'].by, g['dexp/d1/a'].at]).toEqual(['สมชาย', t1]);
    // accounting marks it paid, someone else fixes the amount: each in their own name and time
    at(9 * MIN);
    call(s, head, 'push', { ops: [{ k: 'dexp/d1/a', v: { ...v, amt: 3600, by: 'สมชาย' } }] });
    expect(byKey(pullAll(s, admin))['dexp/d1/a'].v).toEqual({ ...v, amt: 3600, by: 'มินท์', at: new Date(T0 + 9 * MIN).toISOString() });
    // the history row of an expense: the writer's name
    call(s, tok, 'push', { ops: [{ k: 'dlog/exp.h1', v: { action: 'บันทึกค่าใช้จ่าย', detail: 'ค่าเดินทาง 3,500 บาท', deal: 'd1', by: 'มินท์' } }] });
    expect(byKey(pullAll(s, admin))['dlog/exp.h1'].v).toMatchObject({ by: 'สมชาย' });
    // an admin (restoring records) keeps what it sends
    call(s, admin, 'push', { ops: [{ k: 'dexp/d2/z', v }] });
    expect(byKey(pullAll(s, admin))['dexp/d2/z'].v).toEqual(v);
  });
});

// ------------------------------------------------------------------ 3. reading

describe('pull: expenses reach only the accounts that may see them', () => {
  const FIXTURE = [
    ...DEALS,
    { k: 'dexp/d1/a', v: exp({ c: 'ผู้รับเหมา', amt: 35000, n: 'งานติดตั้ง 35,000 บาท' }) },
    { k: 'dexp/d2/b', v: exp({ c: 'ค่าธรรมเนียม TGO', amt: 12840 }) },
    { k: 'dlog/exp.h1', v: { action: 'บันทึกค่าใช้จ่าย', detail: 'ผู้รับเหมา 35,000 บาท', deal: 'd1' } },
    { k: 'dchk/d1/exp.a', v: { s: 'ok', amt: 35000, d: '2026-10-06', f: 'F1' } },
    { k: 'mclose/2026-10/out', v: { n: 1, amt: 35000 } },
    // the income side, which is not about expenses
    { k: 'dchk/d1/PAY1', v: { s: 'ok', amt: 100000, d: '2026-10-05', f: '' } },
    { k: 'mclose/2026-10', v: { n: 1, amt: 100000 } },
    { k: 'dlog/l1', v: { action: 'รับชำระ PAY1', detail: '100,000 บาท', deal: 'd1' } },
  ];
  const EXP_KEYS = ['dexp/d1/a', 'dexp/d2/b', 'dlog/exp.h1', 'dchk/d1/exp.a', 'mclose/2026-10/out'];
  const SECRET = ['35000', '35,000', '12840', 'ผู้รับเหมา', 'ค่าธรรมเนียม TGO', 'งานติดตั้ง'];
  function setup() {
    const { s, admin } = team();
    expect(call(s, admin, 'push', { ops: FIXTURE }).n).toBe(FIXTURE.length);
    return { s, admin };
  }

  it('with view.exp: every expense record as written, the same for the built-in พนักงานขาย and an admin', () => {
    const { s, admin } = setup();
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const look = member(s, admin, 'pla', 'ปลา', role(s, admin, 'ดูค่าใช้จ่าย', SEES));
    const full = byKey(pullAll(s, admin));
    for (const tok of [sales, look]) {
      const g = byKey(pullAll(s, tok));
      for (const k of EXP_KEYS) expect([k, g[k]]).toEqual([k, full[k]]);
    }
    expect(full['dexp/d1/a']).toMatchObject({ del: false, v: { c: 'ผู้รับเหมา', amt: 35000 } });
  });

  it('without view.exp: each expense record comes as a deletion in its place (seq and key), without who wrote it or when; the income side is untouched', () => {
    const { s, admin } = setup();
    const viewer = member(s, admin, 'vee', 'วี', 'viewer');
    const acctOld = member(s, admin, 'fon', 'ฝน', role(s, admin, 'บัญชี (ก่อนมีค่าใช้จ่าย)', ACCT_OLD));
    const full = pullAll(s, admin);
    for (const tok of [viewer, acctOld]) {
      const r = pullAll(s, tok);
      const exp = (k: string) => EXP_KEYS.includes(k);
      expect(rowsOf(r).map((x) => [x.seq, x.k, x.by, x.at])).toEqual(rowsOf(full).map((x) => (exp(x.k) ? [x.seq, x.k, '', ''] : [x.seq, x.k, x.by, x.at])));
      const g = byKey(r), a = byKey(full);
      for (const k of EXP_KEYS) expect([k, g[k]]).toEqual([k, { seq: a[k].seq, k, v: null, del: true, by: '', at: '' }]);
      for (const k of ['dchk/d1/PAY1', 'mclose/2026-10', 'dlog/l1', 'deal/d1']) expect([k, g[k]]).toEqual([k, a[k]]);
      const text = JSON.stringify(r);
      for (const x of SECRET) expect(text.includes(x), x).toBe(false);
    }
  });

  it('without view.money (which view.exp needs): deletions too, and the income side without its amounts', () => {
    const { s, admin } = setup();
    const blind = member(s, admin, 'pla', 'ปลา', role(s, admin, 'ไม่เห็นยอดเงิน', ones(['view.sales', 'view.plan', 'edit.cust'])));
    const r = pullAll(s, blind);
    const g = byKey(r);
    for (const k of EXP_KEYS) expect([k, g[k].v, g[k].del]).toEqual([k, null, true]);
    expect(g['dchk/d1/PAY1'].v).toMatchObject({ amt: null });
    expect(g['mclose/2026-10'].v).toMatchObject({ amt: null });
    for (const x of SECRET) expect(JSON.stringify(r).includes(x), x).toBe(false);
    // an expense capability given without view.money does nothing (needs)
    expect(call(s, admin, 'grant_save', { u: 'pla', c: [{ k: 'edit.exp' }] })).toMatchObject({ ok: true });
    expect(meCaps(pullAll(s, blind))).toMatchObject({ 'view.money': 1, 'view.exp': 1, 'edit.exp': 1 }); // with what it needs
  });

  it('a build that does not say it knows expenses (no xp) gets an expense\'s check as a deletion, nothing else changes', () => {
    const { s, admin } = setup();
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    for (const tok of [admin, sales]) {
      const old = byKey(pullAll(s, tok, false)), now = byKey(pullAll(s, tok));
      expect(old['dchk/d1/exp.a']).toMatchObject({ v: null, del: true });
      expect(now['dchk/d1/exp.a']).toMatchObject({ v: { s: 'ok', amt: 35000 }, del: false });
      for (const k of Object.keys(now).filter((k) => k !== 'dchk/d1/exp.a')) expect([k, old[k]]).toEqual([k, now[k]]);
    }
    // the team code (no accounts) too: whatever build it is
    const legacy = mk('test-key-123');
    legacy.post({ action: 'push', key: 'test-key-123', ops: FIXTURE });
    const lo = byKey(legacy.post({ action: 'pull', key: 'test-key-123', since: 0 }));
    const ln = byKey(legacy.post({ action: 'pull', key: 'test-key-123', since: 0, xp: 1 }));
    expect([lo['dchk/d1/exp.a'].del, ln['dchk/d1/exp.a'].del]).toEqual([true, false]);
    expect(lo['dexp/d1/a'].v).toMatchObject({ amt: 35000 }); // the team code hides nothing else, as before
  });

  it('view.exp given later shows them on the next pull; taken away, they come as deletions again', () => {
    const { s, admin } = setup();
    const v = member(s, admin, 'vee', 'วี', 'viewer');
    expect(byKey(pullAll(s, v))['dexp/d1/a'].del).toBe(true);
    call(s, admin, 'grant_save', { u: 'vee', c: [{ k: 'view.exp' }] });
    const r = pullAll(s, v);
    expect(meCaps(r)).toMatchObject({ 'view.exp': 1 });
    expect(byKey(r)['dexp/d1/a']).toMatchObject({ del: false, v: { amt: 35000 } });
    call(s, admin, 'grant_del', { u: 'vee', k: 'view.exp' });
    expect(byKey(pullAll(s, v))['dexp/d1/a']).toMatchObject({ del: true, v: null });
  });

  it('pages of a long pull are filtered the same way', () => {
    const { s, admin } = setup();
    const v = member(s, admin, 'vee', 'วี', 'viewer');
    const page = call(s, v, 'pull', { since: 2, limit: 2, xp: 1 });
    expect(page).toMatchObject({ more: true });
    expect(rowsOf(page).map((x) => [x.k, x.del, x.by])).toEqual([['dexp/d1/a', true, ''], ['dexp/d2/b', true, '']]);
  });

  it('a role that sees money and commission but not expenses (accounting as the mockups drew it) still gets them as deletions; its revenue splits stay', () => {
    const { s, admin } = setup();
    call(s, admin, 'push', { ops: [{ k: 'dshare/d1', v: { lines: [{ u: 'u1', pct: 100 }] } }] });
    const acct = member(s, admin, 'fon', 'ฝน', role(s, admin, 'บัญชี/การเงิน', ones(['view.sales', 'view.plan', 'view.money', 'view.cash', 'view.comm', 'docs.open', 'edit.pay', 'docs.up', 'pay.check'])));
    const caps = meCaps(call(s, acct, 'me'));
    expect([caps['view.money'], caps['view.comm'], caps['view.exp']]).toEqual([1, 1, undefined]);
    const full = byKey(pullAll(s, admin));
    const r = pullAll(s, acct);
    const g = byKey(r);
    for (const k of EXP_KEYS) expect([k, g[k].v, g[k].del, g[k].by]).toEqual([k, null, true, '']);
    expect(g['dshare/d1']).toEqual(full['dshare/d1']);
    for (const k of ['dchk/d1/PAY1', 'mclose/2026-10', 'deal/d1']) expect([k, g[k]]).toEqual([k, full[k]]);
    for (const x of SECRET) expect(JSON.stringify(r).includes(x), x).toBe(false);
    // and page by page
    const seen: string[] = [];
    for (let since = 0, more = true; more; ) {
      const p = call(s, acct, 'pull', { since, limit: 3, xp: 1 });
      rowsOf(p).forEach((x) => EXP_KEYS.includes(x.k) && seen.push(`${x.k}:${x.del}:${JSON.stringify(x.v)}`));
      more = !!p.more;
      since = rowsOf(p).at(-1)?.seq ?? since;
    }
    expect(seen).toEqual(EXP_KEYS.map((k) => `${k}:true:null`));
  });
});

// ------------------------------------------------------------------ 4. roles, extras and requests

describe('the two capabilities in roles, extras and requests', () => {
  it('role_save: own work for recording, what each needs, and the built-ins\' defaults', () => {
    const { s, admin } = team();
    const r = call(s, admin, 'role_save', { n: 'บันทึกค่าใช้จ่ายงานตัวเอง', c: { 'view.money': 1, 'view.exp': 1, 'edit.exp': 'own' } });
    expect((r.roles as Record<string, { c: Caps }>)[String(r.id)].c).toEqual({ 'view.money': 1, 'view.exp': 1, 'edit.exp': 'own' });
    // edit.exp without view.exp, view.exp without view.money: left out
    const r2 = call(s, admin, 'role_save', { n: 'ไม่ครบ', c: { 'view.money': 1, 'edit.exp': 1 } });
    expect((r2.roles as Record<string, { c: Caps }>)[String(r2.id)].c).toEqual({ 'view.money': 1 });
    const r3 = call(s, admin, 'role_save', { n: 'ไม่ครบอีก', c: { 'view.exp': 1, 'edit.exp': 1, 'view.sales': 1 } });
    expect((r3.roles as Record<string, { c: Caps }>)[String(r3.id)].c).toEqual({ 'view.sales': 1 });
    const roles = call(s, admin, 'users').roles as Record<string, { c: Caps }>;
    expect([roles.admin.c['view.exp'], roles.admin.c['edit.exp']]).toEqual([1, 1]);
    expect([roles.sales.c['view.exp'], roles.sales.c['edit.exp']]).toEqual([1, 'own']);
    expect([roles.viewer.c['view.exp'], roles.viewer.c['edit.exp']]).toEqual([undefined, undefined]);
    // copied from พนักงานขาย: as it has them
    const r4 = call(s, admin, 'role_save', { n: 'ขายพิเศษ', from: 'sales' });
    expect((r4.roles as Record<string, { c: Caps }>)[String(r4.id)].c).toMatchObject({ 'view.exp': 1, 'edit.exp': 'own' });
  });

  it('a build from before expenses saving a role (no view.exp / edit.exp in c) keeps them; this build\'s 0 turns them off', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const OLD_SALES = { ...ones(['view.sales', 'view.plan', 'view.money', 'view.cash', 'docs.open', 'edit.cust', 'edit.deal', 'edit.task', 'edit.pay', 'docs.up', 'edit.ctag', 'edit.jqt', 'notify.mail']), 'del.log': 'own' };
    // the older build turns off del.log for พนักงานขาย (it never shows the expense capabilities)
    const { 'del.log': _gone, ...noDel } = OLD_SALES;
    expect(call(s, admin, 'role_save', { id: 'sales', c: noDel })).toMatchObject({ ok: true });
    expect(meCaps(call(s, tok, 'me'))).toMatchObject({ 'view.exp': 1, 'edit.exp': 'own' });
    expect(meCaps(call(s, tok, 'me'))).not.toHaveProperty('del.log');
    expect(audit(s).filter((a) => a.action === 'role_save').at(-1)!.detail).toMatchObject({ id: 'sales', add: [], del: ['del.log'] });
    // a role it makes from nothing gets none (there was nothing to keep)
    const fresh = call(s, admin, 'role_save', { n: 'ใหม่จากรุ่นเก่า', c: noDel });
    expect((fresh.roles as Record<string, { c: Caps }>)[String(fresh.id)].c).not.toHaveProperty('view.exp');
    // copied from a role (the older build sends what it shows, and `from`): what that role has
    const copy = call(s, admin, 'role_save', { n: 'สำเนาจากรุ่นเก่า', c: noDel, from: 'sales' });
    expect((copy.roles as Record<string, { c: Caps }>)[String(copy.id)].c).toMatchObject({ 'view.exp': 1, 'edit.exp': 'own' });
    const copy0 = call(s, admin, 'role_save', { n: 'สำเนาจากรุ่นนี้', c: { ...noDel, 'view.exp': 0, 'edit.exp': 0 }, from: 'sales' });
    expect((copy0.roles as Record<string, { c: Caps }>)[String(copy0.id)].c).not.toHaveProperty('view.exp');
    // this build names them: 0 turns them off, a scope changes
    call(s, admin, 'role_save', { id: 'sales', c: { ...noDel, 'view.exp': 0, 'edit.exp': 0 } });
    expect(meCaps(call(s, tok, 'me'))).not.toHaveProperty('view.exp');
    expect(audit(s).filter((a) => a.action === 'role_save').at(-1)!.detail).toMatchObject({ del: ['view.exp', 'edit.exp'] });
    call(s, admin, 'role_save', { id: 'sales', c: { ...noDel, 'view.exp': 1, 'edit.exp': 1 } });
    expect(meCaps(call(s, tok, 'me'))).toMatchObject({ 'view.exp': 1, 'edit.exp': 1 });
    // an older build turning off view.money: what needs it goes as well, kept or not
    call(s, admin, 'role_save', { id: 'sales', c: ones(['view.sales', 'edit.cust']) });
    expect(meCaps(call(s, tok, 'me'))).toEqual(ones(['view.sales', 'edit.cust']));
  });

  it('extras: given with what they need, own work or all; one the role already gives is refused', () => {
    const { s, admin } = team();
    const v = member(s, admin, 'vee', 'วี', 'viewer');
    member(s, admin, 'somchai', 'สมชาย', 'sales');
    const r = call(s, admin, 'grant_save', { u: 'vee', c: [{ k: 'edit.exp', s: 'own' }] });
    expect(r).toMatchObject({ ok: true, grants: { vee: { c: [{ k: 'view.exp', s: 'all' }, { k: 'edit.exp', s: 'own' }] } } });
    expect(meCaps(call(s, v, 'me'))).toMatchObject({ 'view.exp': 1, 'edit.exp': 'own' });
    expect(call(s, admin, 'grant_save', { u: 'somchai', c: [{ k: 'edit.exp', s: 'own' }] }).error).toBe('cap_held');
    expect(call(s, admin, 'grant_save', { u: 'somchai', c: [{ k: 'view.exp' }] }).error).toBe('cap_held');
    expect(call(s, admin, 'grant_save', { u: 'somchai', c: [{ k: 'edit.exp', s: 'all' }] })).toMatchObject({ ok: true });
  });

  it('requests: asking to record expenses asks to see them too; approved, the account has both', () => {
    const { s, admin } = team();
    const v = member(s, admin, 'vee', 'วี', 'viewer');
    const r = call(s, v, 'req_send', { k: 'caps', caps: [{ k: 'edit.exp', s: 'own' }], note: 'บันทึกค่าเดินทางของงานตัวเอง' });
    expect(r.me).toMatchObject({ req: { st: 'p', k: 'caps', caps: [{ k: 'view.exp', s: 'all' }, { k: 'edit.exp', s: 'own' }] } });
    const id = props(s, 'REQS').vee.id;
    expect(call(s, admin, 'req_decide', { u: 'vee', ok: true, note: '', id })).toMatchObject({ ok: true });
    expect(meCaps(call(s, v, 'me'))).toMatchObject({ 'view.exp': 1, 'edit.exp': 'own' });
    // and the built-in พนักงานขาย already holds both
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, sales, 'req_send', { k: 'caps', caps: [{ k: 'view.exp' }], note: 'x' }).error).toBe('cap_held');
  });
});

// ------------------------------------------------------------------ 5. accounting's month check of money going out

describe('the month check of expenses (pay.check)', () => {
  it('an expense checked and a month\'s expenses closed: the checker\'s name and the server\'s time; apart from the income records', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: [...DEALS, { k: 'dexp/d1/a', v: exp({ paid: '2026-10-06', file: { id: 'F1', name: 'บิล.pdf', mime: 'application/pdf', size: 10 } }) }] });
    const acct = member(s, admin, 'fon', 'ฝน', role(s, admin, 'บัญชี/การเงิน', ACCT));
    at(3 * MIN);
    const chk = { s: 'back', by: 'ปลอม', at: '2020-01-01T00:00:00.000Z', amt: 3500, d: '2026-10-06', f: 'F1', note: 'บิลไม่ตรง 3,500 บาท' };
    const ops = [
      { k: 'dchk/d1/exp.a', v: chk },
      { k: 'mclose/2026-10/out', v: { n: 1, amt: 3500, by: 'ปลอม' } },
      { k: 'dlog/exp.c1', v: { action: 'ส่งค่าใช้จ่ายกลับแก้ไข', detail: 'บิลไม่ตรง', deal: 'd1', by: 'ปลอม' } },
      { k: 'dchk/d1/PAY1', v: { s: 'ok', amt: 100000, d: '2026-10-05', f: '' } },
      { k: 'mclose/2026-10', v: { n: 1, amt: 100000 } },
    ];
    expect(call(s, acct, 'push', { ops })).toMatchObject({ n: 5, denied: [] });
    const now = new Date(T0 + 3 * MIN).toISOString();
    const g = byKey(pullAll(s, admin));
    expect(g['dchk/d1/exp.a'].v).toEqual({ ...chk, by: 'ฝน', at: now });
    expect(Object.keys(g['dchk/d1/exp.a'].v as object)).toEqual(Object.keys(chk));
    expect(g['mclose/2026-10/out'].v).toEqual({ n: 1, amt: 3500, by: 'ฝน', at: now });
    expect(g['dlog/exp.c1'].v).toMatchObject({ by: 'ฝน' });
    // the income month and the expense month are two records
    expect(g['mclose/2026-10'].v).toEqual({ n: 1, amt: 100000, by: 'ฝน', at: now });
    // undo / reopen: deleting them
    expect(call(s, acct, 'push', { ops: [{ k: 'dchk/d1/exp.a', del: true }, { k: 'mclose/2026-10/out', del: true }] })).toMatchObject({ n: 2, denied: [] });
    // without pay.check: never, the built-in พนักงานขาย included
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, sales, 'push', { ops: [{ k: 'dchk/d1/exp.a', v: chk }, { k: 'mclose/2026-10/out', v: { n: 0 } }] }).denied).toEqual(['dchk/d1/exp.a', 'mclose/2026-10/out']);
  });

  it('who reads them: accounting with view.exp does; accounting without it may check blind but reads only deletions', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: [...DEALS, { k: 'dexp/d1/a', v: exp() }, { k: 'dchk/d1/exp.a', v: { s: 'ok', amt: 3500, d: '2026-10-06', f: '' } }, { k: 'mclose/2026-10/out', v: { n: 1, amt: 3500 } }] });
    const acct = member(s, admin, 'fon', 'ฝน', role(s, admin, 'บัญชี/การเงิน', ACCT));
    const blind = member(s, admin, 'ton', 'ต้น', role(s, admin, 'บัญชีเก่า', ACCT_OLD));
    expect(byKey(pullAll(s, acct))['dchk/d1/exp.a']).toMatchObject({ del: false, v: { amt: 3500 } });
    const b = byKey(pullAll(s, blind));
    for (const k of ['dexp/d1/a', 'dchk/d1/exp.a', 'mclose/2026-10/out']) expect([k, b[k].del]).toEqual([k, true]);
  });
});

// ------------------------------------------------------------------ 6. a deal deleted

describe('a deal deleted by an account takes its expenses along', () => {
  it('every live expense of that deal, once, whoever deletes it (also one who never saw them); their checks stay', () => {
    const { s, admin } = team();
    call(s, admin, 'push', {
      ops: [...DEALS, { k: 'dexp/d1/a', v: exp() }, { k: 'dexp/d1/b', v: exp() }, { k: 'dexp/d1/b', del: true }, { k: 'dexp/d2/c', v: exp() }, { k: 'dexp/d10/x', v: exp() }, { k: 'dchk/d1/exp.a', v: { s: 'ok', amt: 3500, d: '2026-10-06', f: '' } }],
    });
    const head = member(s, admin, 'mint', 'มินท์', role(s, admin, 'หัวหน้า (ไม่เห็นค่าใช้จ่าย)', HEAD_NO_EXP));
    const before = Number(s.props.SEQ);
    const r = call(s, head, 'push', { ops: [{ k: 'deal/d1', del: true }] });
    expect(r).toMatchObject({ ok: true, n: 3, denied: [] });
    const rows = rowsOf(call(s, admin, 'pull', { since: before, xp: 1 }));
    expect(rows.map((x) => [x.k, x.del, x.by])).toEqual([['deal/d1', true, 'มินท์'], ['dshare/d1', true, 'มินท์'], ['dexp/d1/a', true, 'มินท์']]);
    const g = byKey(pullAll(s, admin));
    expect(g['dexp/d2/c'].del).toBe(false);
    expect(g['dexp/d10/x'].del).toBe(false); // another deal whose id starts the same
    expect(g['dchk/d1/exp.a']).toMatchObject({ del: false, v: { s: 'ok' } });
  });

  it('expenses written in the same push go too; one the push deleted itself is not deleted twice; the team code is left to the web app', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: [...DEALS, { k: 'dexp/d1/a', v: exp() }, { k: 'dexp/d1/b', v: exp() }] });
    const before = Number(s.props.SEQ);
    const r = call(s, admin, 'push', { ops: [{ k: 'dexp/d1/n', v: exp() }, { k: 'dexp/d1/b', del: true }, { k: 'deal/d1', del: true }] });
    expect(r.n).toBe(6);
    const ks = rowsOf(call(s, admin, 'pull', { since: before, xp: 1 })).map((x) => [x.k, x.del]);
    expect(ks).toEqual([['dexp/d1/n', false], ['dexp/d1/b', true], ['deal/d1', true], ['dshare/d1', true], ['dexp/d1/a', true], ['dexp/d1/n', true]]);
    const legacy = mk('test-key-123');
    legacy.post({ action: 'push', key: 'test-key-123', ops: [...DEALS, { k: 'dexp/d1/a', v: exp() }] });
    expect(legacy.post({ action: 'push', key: 'test-key-123', ops: [{ k: 'deal/d1', del: true }] })).toMatchObject({ ok: true, n: 1 });
  });

  it('the sheet is read for this only when a push deletes a deal', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: [...DEALS, { k: 'dexp/d1/a', v: exp() }] });
    const sh = s.sheet()! as unknown as { getRange: (...a: number[]) => unknown };
    const spy = vi.spyOn(sh, 'getRange');
    const reads = () => spy.mock.calls.filter(([r, c, , n]) => r === 2 && c === 2 && n === 3).length;
    call(s, admin, 'push', { ops: [{ k: 'dexp/d1/b', v: exp() }, { k: 'deal/d2', v: { resp: 'x' } }] });
    expect(reads()).toBe(0);
    call(s, admin, 'push', { ops: [{ k: 'deal/d2', del: true }] });
    expect(reads()).toBe(1);
  });
});

// ------------------------------------------------------------------ 7. the bills

describe('an expense\'s bill (docId exp_<expId>)', () => {
  const pdf = { name: 'บิล.pdf', mime: 'application/pdf', data: 'JVBERg==' };
  it('recording expenses is enough to upload and trash a bill; not any other document, and opening one still needs docs.open', () => {
    const { s, admin } = team();
    const quote = String(call(s, admin, 'upload', { ...pdf, docId: 'deal-1.q1' }).fileId);
    const rec = member(s, admin, 'pla', 'ปลา', role(s, admin, 'บันทึกค่าใช้จ่าย', RECORDS));
    const up = call(s, rec, 'upload', { ...pdf, docId: 'exp_e1' });
    expect(up).toMatchObject({ ok: true, fileId: expect.any(String) });
    expect(call(s, rec, 'upload', { ...pdf, docId: 'deal-1.q2' }).error).toBe('forbidden');
    expect(call(s, rec, 'delfile', { fileId: quote }).error).toBe('forbidden');
    expect(call(s, rec, 'file', { fileId: String(up.fileId) }).error).toBe('forbidden');
    expect(call(s, rec, 'delfile', { fileId: String(up.fileId) })).toMatchObject({ ok: true });
    expect(call(s, rec, 'delfile', { fileId: 'no-such-file' })).toMatchObject({ ok: false, error: 'not_found' });
    // seeing expenses is not recording them
    const look = member(s, admin, 'vee', 'วี', role(s, admin, 'ดูค่าใช้จ่าย', { ...SEES, 'edit.cust': 1 }));
    expect(call(s, look, 'upload', { ...pdf, docId: 'exp_e2' }).error).toBe('forbidden');
    // whoever attaches documents may attach a bill as before; an admin anything
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, sales, 'upload', { ...pdf, docId: 'exp_e3' })).toMatchObject({ ok: true });
    expect(s.drive.list().filter((x) => x.kind === 'file' && !x.trashed).map((x) => x.name.split('__')[0]).sort()).toEqual(['deal-1.q1', 'exp_e3']);
  });

  it('recording for its own deals only (no docs.up): trashes the bills of its own deals\' expenses, no other', () => {
    const { s, admin } = team();
    const up = (tok: string, id: string) => String(call(s, tok, 'upload', { ...pdf, docId: 'exp_' + id }).fileId);
    const file = (id: string) => ({ id, name: 'บิล.pdf', mime: 'application/pdf', size: 5 });
    const trashed = (id: string) => s.drive.list().find((x) => x.id === id)!.trashed;
    const [F1, F2, F3, F4, F5] = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => up(admin, id));
    call(s, admin, 'push', {
      ops: [
        ...DEALS,
        { k: 'deal/d3', v: { client: 'บริษัท ค จำกัด', resp: 'สมชาย' } },
        { k: 'dexp/d1/e1', v: exp({ file: file(F1) }) }, // สมชาย's deal
        { k: 'dexp/d2/e2', v: exp({ file: file(F2) }) }, // คุณบี's
        { k: 'dexp/d1/e3', v: exp({ file: file(F3) }) },
        { k: 'dexp/d1/e3', del: true }, // deleted since
        { k: 'dexp/d3/e4', v: exp({ file: file(F4) }) },
        { k: 'deal/d3', del: true }, // its deal deleted since (the expense with it)
        { k: 'dexp/d2/e5', v: exp({ file: file(F5) }) },
      ],
    });
    const own = member(s, admin, 'somchai', 'สมชาย', role(s, admin, 'บันทึกค่าใช้จ่ายงานตัวเอง', { ...SEES, 'edit.exp': 'own' }));
    // another deal's bill: refused, also after this account points an expense of its own deal at it, or
    // writes one under the same expense id on its own deal
    expect(call(s, own, 'delfile', { fileId: F2 }).error).toBe('forbidden');
    expect(call(s, own, 'push', { ops: [{ k: 'dexp/d1/x', v: exp({ file: file(F5) }) }, { k: 'dexp/d1/e2', v: exp({ file: file(F2) }) }] })).toMatchObject({ n: 2, denied: [] });
    expect(call(s, own, 'delfile', { fileId: F5 }).error).toBe('forbidden');
    expect(call(s, own, 'delfile', { fileId: F2 }).error).toBe('forbidden');
    // a bill another deal's expense names under another id (uploaded as exp_g): the expense that names it counts
    const G = up(admin, 'g');
    call(s, admin, 'push', { ops: [{ k: 'dexp/d2/v1', v: exp({ file: file(G) }) }] });
    expect(call(s, own, 'push', { ops: [{ k: 'dexp/d1/g', v: exp() }] })).toMatchObject({ n: 1, denied: [] });
    expect(call(s, own, 'delfile', { fileId: G }).error).toBe('forbidden');
    expect([trashed(F2), trashed(F5), trashed(G)]).toEqual([false, false, false]);
    // its own deal's: live, deleted since, or of a deal deleted since that was its own
    for (const f of [F1, F3, F4]) expect([f, call(s, own, 'delfile', { fileId: f })]).toEqual([f, expect.objectContaining({ ok: true })]);
    expect([trashed(F1), trashed(F3), trashed(F4)]).toEqual([true, true, true]);
    // a bill no expense names yet: whoever records for every deal (or attaches documents) trashes it
    const loose = up(own, 'e9');
    expect(call(s, own, 'delfile', { fileId: loose }).error).toBe('forbidden');
    const all = member(s, admin, 'mint', 'มินท์', role(s, admin, 'บันทึกค่าใช้จ่ายทุกงาน', RECORDS));
    expect(call(s, all, 'delfile', { fileId: loose })).toMatchObject({ ok: true });
    expect(call(s, all, 'delfile', { fileId: F2 })).toMatchObject({ ok: true });
    // what is not a bill stays refused, whatever the scope
    const quote = String(call(s, admin, 'upload', { ...pdf, docId: 'deal-1.q1' }).fileId);
    for (const tok of [own, all]) expect(call(s, tok, 'delfile', { fileId: quote }).error).toBe('forbidden');
  });
});

// ------------------------------------------------------------------ 8. builds before job expenses

describe('the web app before job expenses (cv 4, no xp) against this script', () => {
  it('pushes, pulls and checks income as before; never sees an expense\'s check; a tab on an even older build stays refused', () => {
    const { s, admin } = team();
    const acct = member(s, admin, 'fon', 'ฝน', role(s, admin, 'บัญชี/การเงิน', ACCT));
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    call(s, admin, 'push', { ops: [...DEALS, { k: 'dexp/d1/a', v: exp() }, { k: 'dchk/d1/exp.a', v: { s: 'ok', amt: 3500, d: '2026-10-06', f: '' } }, { k: 'mclose/2026-10/out', v: { n: 1, amt: 3500 } }] });
    // what the older build sends: its records, and checks of income; it reads them back
    const ops = [{ k: 'stage/1', v: 'won' }, { k: 'dpay/d1/PAY1', v: { amt: 100000, rcv: '2026-10-05' } }, { k: 'dlog/l1', v: { action: 'รับชำระ PAY1', by: 'x' } }];
    expect(s.post({ action: 'push', cv: 4, tok: sales, ops })).toMatchObject({ ok: true, n: 3, denied: [] });
    expect(s.post({ action: 'push', cv: 4, tok: acct, ops: [{ k: 'dchk/d1/PAY1', v: { s: 'ok', amt: 100000, d: '2026-10-05', f: '' } }, { k: 'mclose/2026-10', v: { n: 1, amt: 100000 } }] })).toMatchObject({ ok: true, n: 2 });
    const g = byKey(s.post({ action: 'pull', cv: 4, tok: acct, since: 0 }));
    expect(g['dchk/d1/exp.a']).toMatchObject({ v: null, del: true });
    expect(g['dchk/d1/PAY1']).toMatchObject({ del: false, v: { s: 'ok', by: 'ฝน' } });
    // these it skips by their keys (no dexp/ case; a month close's key is YYYY-MM only)
    expect(g['dexp/d1/a'].del).toBe(false);
    expect(g['mclose/2026-10/out'].del).toBe(false);
    // its me: the capabilities it does not know are there, and ignored by it
    expect(meCaps(s.post({ action: 'me', cv: 4, tok: sales }))).toMatchObject({ 'view.exp': 1, 'edit.exp': 'own' });
    expect(s.post({ action: 'push', cv: 3, tok: sales, ops })).toMatchObject({ ok: false, error: 'มีเวอร์ชันใหม่ กรุณารีเฟรชหน้าเว็บ (F5)' });
  });
});

describe('secrets', () => {
  it('no reply in this file contained the token secret, a salt or a password hash', () => {
    let n = 0;
    for (const { replies, s } of seen) {
      const text = replies.join('\n');
      n += replies.length;
      const secrets = [s.props.AUTH_SECRET, ...Object.values(JSON.parse(s.props.USERS || '{"users":{}}').users as Record<string, { s: string; h: string }>).flatMap((x) => [x.s, x.h])].filter(Boolean);
      for (const x of secrets) expect(text.includes(x)).toBe(false);
    }
    expect(n).toBeGreaterThan(100);
  });
});
