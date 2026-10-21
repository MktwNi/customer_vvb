/**
 * Phase 3 together (plan.md §5 "one money fixture"): the joint quotation (item 7), units, % contribution and
 * commission (items 8, 9b) and the month check for accounting (item 6 follow-up), built apart, meet on one
 * money core with phase 1 (Cashflow, the Dashboard's การรับเงิน filter, the quotation) and phase 2 (the
 * quotation check, payDue, the capabilities):
 *
 * - one joint quotation of 900,000 paid by its payer (whose own person is in no unit) for three companies
 *   (a share of 450,000 · 30% · an equal rest of 180,000), each followed by its own person; one company's job
 *   split 60/40 between two units;
 * - its payments: 360,000 received in June (Q2), 360,000 in August (Q3), 180,000 owed in November; a plain
 *   job received 100,000 in July and owes 100,000 since 5 October (late);
 * - accounting checked the June payment and closed June.
 *
 * Every screen counts the money once, on the joint quotation, and agrees: the KPI, Cashflow, the Dashboard's
 * quarters, the units' contribution and commission, the month check (also under a person filter, as the
 * parts of the companies listed), and the หน่วยงาน filter finds the joint quotation through its companies.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import {
  cashKpis, cashLines, cashRecon, cashYear, customersOf, dealMoney, filterDeals, jointOf, jointRole, moneySum, normSalesFilter, payDue, salesStats,
  type Deal, type PlanInput, type SalesFilterIn,
} from './sales';
import { bandPart, jointRows, memberShares, viewCashLines } from './joint';
import { apportioned, commRows, contribIn, dealGot, dealUnits, periodRange, unitCtx, unitQuarters } from './contrib';
import { barOf, cashCheckRows, chkRows, closeDrift, pageKeep, sumRows, teamMonth, yearCheck, ymOf } from './payCheck';
import { jointLineWords, payerName } from './cashUi';
import { qtCheckOf, QT_WORD } from './notify';
import { BUILTIN, can as capCan } from './caps';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-12';
const PAYER = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ';

let base: Dataset, R: RoundRaw[];
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 200);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => vi.useRealTimers());

/** One browser on its own (no team: every capability), signed as `who` (changeable). */
function mk(who: { name: string }) {
  const e = new GccEngine();
  e.base = structuredClone(base);
  e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  e.ref = TODAY;
  e.store = memoryStore();
  (e as unknown as { me: () => string }).me = () => who.name;
  e.rebuild();
  e.loading = false;
  return e;
}
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const line = (stage: string, amt: number, due: string): PlanInput => ({ stage, amt, pct: null, due, rel: null, how: 'transfer', howT: '', note: '' });
const YES = (e: GccEngine, id: string, d: string) => e.setStep(id, 'CLOSED DEAL', { d, n: 'YES' });
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms);
const Q2 = periodRange('2569', 1), Q3 = periodRange('2569', 2);

/** The fixture (header comment), made through the engine as the screens make it. */
async function fixture() {
  const who = { name: 'หมิว' };
  const e = mk(who);
  // units: ฝ่ายขาย 5% (หมิว, คุณบี), ฝ่ายที่ปรึกษา 3% (มกร); ต้น (the payer's person) is in none
  const sale = e.saveUnit(null, { n: 'ฝ่ายขาย', r: 5, svc: {}, members: ['หมิว', 'คุณบี'] })!;
  const cons = e.saveUnit(null, { n: 'ฝ่ายที่ปรึกษา', r: 3, svc: {}, members: ['มกร'] })!;
  // three companies of the year without a job of their own (reused as members); m1 had typed a Forecast
  const m1 = e.addDeal({ client: 'บางกอกสตีล เวิร์คส์ ทดสอบ', section: 'Event Exhibition', year: '2569', resp: 'หมิว', forecast: 50000 });
  const m2 = e.addDeal({ client: 'ไทยเบฟ รีไซเคิล ทดสอบ', section: 'Event Exhibition', year: '2569', resp: 'มกร' });
  const m3 = e.addDeal({ client: 'โคราช ซีเมนต์ ทดสอบ', section: 'Event Exhibition', year: '2569', resp: 'คุณบี' });
  later();
  const { hid, attachErr } = await e.createJoint({
    title: 'CFP ' + PAYER + ' (มจพ)', payer: PAYER, payerGid: null, year: '2569', section: 'Event Exhibition', resp: 'ต้น', service: ['CFP'],
    total: 900000, docNo: 'QT-2569-099', docDate: '2026-05-20', basis: 'total', detected: 900000, file: pdf('QT-2569-099.pdf'),
    members: [{ deal: m1.id, share: 450000, pct: null }, { deal: m2.id, share: null, pct: 30 }, { deal: m3.id, share: null, pct: null }],
  });
  expect(attachErr).toBe('');
  // won; its plan on the header (the payer's row), paid by the payer
  [hid, m1.id, m2.id, m3.id].forEach((id) => YES(e, id, '2026-06-01'));
  e.setPlan(hid, [line('PAY1', 360000, '2026-06-30'), line('PAY2', 360000, '2026-08-31'), line('PAY3', 180000, '2026-11-30')]);
  e.markPaid(hid, 'PAY1', { date: '2026-06-25', amount: 360000 });
  e.markPaid(hid, 'PAY2', { date: '2026-08-20', amount: 360000 });
  // m2's job is split between two units
  e.setShare(m2.id, [{ u: cons, p: 60 }, { u: sale, p: 40 }]);
  // a plain job of คุณบี: 100,000 received in July, 100,000 late since 5 Oct
  const p1 = e.addDeal({ client: 'ปทุมธานี ฟาร์มา ทดสอบ', section: 'TGO', year: '2569', resp: 'คุณบี', forecast: 200000 });
  YES(e, p1.id, '2026-07-01');
  e.setPlan(p1.id, [line('PAY1', 100000, '2026-07-15'), line('PAY2', 100000, '2026-10-05')]);
  e.markPaid(p1.id, 'PAY1', { date: '2026-07-15', amount: 100000 });
  later();
  // accounting (ฝน, who recorded none of it) checks June and closes it
  who.name = 'ฝน';
  const all = () => chkRows(e.sales, cashLines(e.sales, Object.values(e.sales.deals), TODAY), e.payChecks(), e.payChkCfg().since);
  const june = all().filter((r) => r.ym === '2026-06' && r.kind === 'got');
  expect(e.checkPays(june)).toEqual([hid + '/PAY1']);
  const close = e.closeMonth('2026-06');
  expect(close).toMatchObject({ by: 'ฝน', n: 1, amt: 360000 });
  who.name = 'หมิว';
  const S = e.sales, D = (id: string) => S.deals[id];
  return { e, S, hid, m: [D(m1.id), D(m2.id), D(m3.id)], p1: D(p1.id), sale, cons, all };
}
type Fx = Awaited<ReturnType<typeof fixture>>;
let fx: Fx;
beforeAll(async () => {
  fx = await fixture();
});
const year = (S: Fx['S'], f: Partial<SalesFilterIn> = {}) => filterDeals(S, { year: '2569', ...f }, TODAY);
const ids = (ds: Deal[]) => ds.map((d) => d.id).sort();

describe('the joint quotation: money once, customers per company (item 7)', () => {
  it('the header is the payer\'s row; its quotation is the 900,000; the members\' own typed Forecast counts nowhere', () => {
    const { S, hid, m } = fx;
    expect(jointRole(S, S.deals[hid])).toBe('header');
    expect(m.map((d) => jointRole(S, d))).toEqual(['member', 'member', 'member']);
    expect(memberShares(S, jointOf(S, { id: hid })!).map((x) => x.amt)).toEqual([450000, 270000, 180000]);
    const st = salesStats(S, year(S), TODAY);
    expect(st.forecast).toBe(900000 + 200000);
    expect(st.actual).toBe(720000 + 100000);
    // customers: the three companies and the plain job, not the payer's row
    expect(customersOf(S, year(S)).length).toBe(4);
    expect(st.total).toBe(4);
    expect(moneySum(S, year(S)).fc).toBe(1100000);
  });
  it('per person: each company\'s person gets its part (the payer\'s person none), and a person filter equals that row', () => {
    const { S } = fx;
    const st = salesStats(S, year(S), TODAY);
    expect(st.byResp['หมิว']).toMatchObject({ forecast: 450000, actual: 360000 });
    expect(st.byResp['มกร']).toMatchObject({ forecast: 270000, actual: 216000 });
    expect(st.byResp['คุณบี']).toMatchObject({ forecast: 180000 + 200000, actual: 144000 + 100000 });
    expect(st.byResp['ต้น']).toBeUndefined();
    for (const p of ['หมิว', 'มกร', 'คุณบี']) {
      const F = normSalesFilter({ year: '2569', resp: p });
      const f = salesStats(S, filterDeals(S, F, TODAY), TODAY, true);
      expect([f.forecast, f.actual], p).toEqual([st.byResp[p].forecast, st.byResp[p].actual]);
      // the Cashflow tab's money through the same filter (lib/joint viewCashLines)
      const got = viewCashLines(S, { ...F, money: 'cash' }, TODAY).filter((l) => l.kind === 'got').reduce((a, l) => a + l.amt, 0);
      expect(got, p).toBe(st.byResp[p].actual);
    }
  });
  it('the quotation waits for its check (phase 2) and payDue lists the payer\'s November installment once', () => {
    const { S, hid, m } = fx;
    const qt = Object.values(S.docs).find((x) => x.deal === hid && x.kind === 'quotation')!;
    expect(qt.amount).toBe(900000);
    expect(qtCheckOf(S.qchk?.[qt.deal + '/' + qt.id], qt).status).toBe('wait');
    expect(QT_WORD.wait).toBe('รอตรวจ');
    const due = payDue(S, Object.values(S.deals), '2026-11-01', '2026-11-30', TODAY);
    expect(due.map((x) => [x.deal.id, x.line.stage, x.line.amt])).toEqual([[hid, 'PAY3', 180000]]);
    expect(payDue(S, m, '2026-01-01', '2026-12-31', TODAY)).toEqual([]);
  });
});

describe('Cashflow and the Dashboard (phase 1) count the joint quotation once', () => {
  it('the year, its quarters, the late line and the reconciliation', () => {
    const { S, hid } = fx;
    const lines = cashLines(S, Object.values(S.deals), TODAY);
    expect(lines.filter((l) => l.joint).every((l) => l.deal.id === hid && l.joint!.members === 3)).toBe(true);
    const Y = cashYear(lines, '2569');
    expect(Y.totals).toMatchObject({ got: 820000, late: 100000, wait: 180000 });
    expect(Y.quarters.map((q) => q.got)).toEqual([0, 360000, 460000, 0]);
    const K = cashKpis(Y, '2569', TODAY);
    expect([K.got, K.owed, K.late]).toEqual([820000, 280000, 100000]);
    expect(cashRecon(lines, '2569')).toMatchObject({ open: 280000, inYear: 280000, undated: 0 });
    // (the payer is the line's name; its quotation goes under it)
    expect(payerName(lines.find((l) => l.deal.id === hid)!)).toBe(PAYER);
    expect(jointLineWords(lines.find((l) => l.deal.id === hid)!)).toBe('ใบเสนอราคาร่วม · 3 บริษัท');
  });
  it('การรับเงิน (Dashboard) in Q3: the joint quotation and the plain job; customers per company', () => {
    const { S, hid, p1 } = fx;
    const q3 = { basis: 'paid' as const, preset: 'q3' as const, from: Q3.from, to: Q3.to };
    const got = year(S, { pay: 'got', date: q3 });
    expect(ids(got)).toEqual(ids([S.deals[hid], ...fx.m, p1]));
    expect(customersOf(S, got).length).toBe(4);
    // owed: the November installment and the late one
    expect(customersOf(S, year(S, { pay: 'late' })).map((d) => d.id)).toEqual([p1.id]);
  });
});

describe('units, % contribution and commission (items 8, 9b) take the joint quotation through its companies', () => {
  it('the header\'s money goes to its companies by their parts, each split its own way; the units add up to the money', () => {
    const { S, hid, sale, cons } = fx;
    const ctx = unitCtx(S), lines = cashLines(S, Object.values(S.deals), TODAY);
    expect(apportioned(ctx, S.deals[hid])).toBe(true);
    // Q2: 360,000 → m1 180,000 (ฝ่ายขาย) · m2 108,000 (60% ที่ปรึกษา, 40% ขาย) · m3 72,000 (ฝ่ายขาย)
    const c2 = contribIn(ctx, lines, Q2);
    expect(c2.got).toBe(360000);
    expect(c2.by[sale].got).toBe(180000 + 43200 + 72000);
    expect(c2.by[cons].got).toBe(64800);
    expect(c2.by['']).toBeUndefined(); // the payer's person (ต้น, in no unit) gets none of it
    expect([c2.by[sale].comm, c2.by[cons].comm, c2.comm]).toEqual([14760, 1944, 16704]);
    // Q3: the same part of PAY2, and the plain job's 100,000 (คุณบี: ฝ่ายขาย)
    const c3 = contribIn(ctx, lines, Q3);
    expect(c3.got).toBe(460000);
    expect(c3.by[sale].got + c3.by[cons].got).toBe(460000);
    expect(c3.deals).toBe(2); // the joint quotation is one job
    // the quarter card's unit split equals Cashflow's quarters
    const uq = unitQuarters(ctx, lines, '2569'), Y = cashYear(lines, '2569');
    uq.q.forEach((q, i) => expect(Object.values(q).reduce((a, v) => a + v, 0), 'Q' + (i + 1)).toBe(Y.quarters[i].got));
    // the commission card's rows: ฝ่ายขาย 5%, ฝ่ายที่ปรึกษา 3%
    const rows = commRows(ctx, c2, Q2.to);
    expect(rows.map((r) => [r.unit?.n, r.got, r.comm])).toEqual([['ฝ่ายขาย', 295200, 14760], ['ฝ่ายที่ปรึกษา', 64800, 1944]]);
  });
  it('a company\'s own สัดส่วนรายได้ card shows its part of what the payer paid', () => {
    const { S, hid, m, cons, sale } = fx;
    const ctx = unitCtx(S), header = cashLines(S, [S.deals[hid]], TODAY);
    const g = dealGot(ctx, header, m[1].id);
    expect(g.got).toBe(216000);
    expect(Object.fromEntries(g.by)).toEqual({ [cons]: 129600, [sale]: 86400 });
    expect(dealGot(ctx, header, hid).got).toBe(0);
  });
  it('under a person filter the Dashboard\'s lines carry only that person\'s companies: their units alone', () => {
    const { S, sale, cons } = fx;
    const F = normSalesFilter({ year: '2569', resp: 'มกร', money: 'cash' });
    const c = contribIn(unitCtx(S), viewCashLines(S, F, TODAY), Q2);
    expect(c.got).toBe(108000);
    expect([c.by[cons].got, c.by[sale].got]).toEqual([64800, 43200]);
  });
  it('the หน่วยงาน filter finds the joint quotation through its companies, not through the payer\'s person', () => {
    const { S, hid, m, p1, cons } = fx;
    const ctx = unitCtx(S);
    expect(dealUnits(ctx, S.deals[hid]).sort()).toEqual([cons, fx.sale].sort());
    expect(ids(year(S, { unit: { v: [cons] } }))).toEqual(ids([S.deals[hid], m[1]]));
    expect(ids(year(S, { unit: { v: [fx.sale] } }))).toEqual(ids([S.deals[hid], ...m, p1]));
    expect(year(S, { unit: { v: ['(ไม่ระบุ)'] } })).toEqual([]);
    // the table: the band with its company of that unit, the quotation's money counted once
    const list = year(S, { unit: { v: [cons] } });
    const band = [...jointRows(S, list).rows.values()].flat().find((r) => r.k === 'band');
    expect(band && band.k === 'band' && band.shown.map((d) => d.id)).toEqual([m[1].id]);
    expect(band && band.k === 'band' && bandPart(S, band, false).whole).toBe(true);
    expect(moneySum(S, list).fc).toBe(900000);
  });
});

describe('the month check (item 6 follow-up) and Cashflow agree on the joint quotation', () => {
  it('the header\'s installments are listed once with the member count; checked June is closed and unchanged', () => {
    const { e, S, hid, all } = fx;
    const rows = all();
    const mine = rows.filter((r) => r.dealId === hid);
    expect(mine.map((r) => [r.key, r.kind, r.amt, r.state])).toEqual([
      [hid + '/PAY1', 'got', 360000, 'ok'],
      [hid + '/PAY2', 'got', 360000, 'wait'],
      [hid + '/PAY3/owed', 'owed', 180000, 'none'],
    ]);
    expect(mine.every((r) => r.line?.joint?.members === 3)).toBe(true);
    expect(rows.some((r) => fx.m.some((d) => d.id === r.dealId))).toBe(false);
    // every month equals its Cashflow bar; the year table equals the cards
    const Y = cashYear(cashLines(S, Object.values(S.deals), TODAY), '2569');
    for (let i = 0; i < 12; i++) expect(barOf(sumRows(rows.filter((r) => r.ym === ymOf(2026, i)))), 'month ' + i).toEqual(Y.months[i]);
    const yc = yearCheck(rows, 2026, e.monthCloses(), TODAY, rows);
    expect(yc.total.got).toBe(820000);
    const jun = yc.months[5];
    expect(jun.state).toBe('closed');
    expect(closeDrift(jun.team, jun.close!)).toMatchObject({ flagged: false, same: true });
    expect(teamMonth(S, e.payChecks(), e.payChkCfg().since, TODAY, '2026-06')).toMatchObject({ n: 1, ok: 1, okAmt: 360000 });
  });
  it('under a person filter the month card shows the parts of that person\'s companies, as the Cashflow chart', () => {
    const { S, hid, all } = fx;
    for (const p of ['หมิว', 'มกร', 'คุณบี', 'ต้น']) {
      const F = normSalesFilter({ year: '2569', resp: p, money: 'cash' });
      const { rows } = cashCheckRows(all(), 2026, pageKeep(S, F, TODAY));
      const Y = cashYear(viewCashLines(S, F, TODAY), '2569');
      for (let i = 0; i < 12; i++) expect(barOf(sumRows(rows.filter((r) => r.ym === ymOf(2026, i)))), `${p} month ${i}`).toEqual(Y.months[i]);
    }
    const F = normSalesFilter({ year: '2569', resp: 'มกร', money: 'cash' });
    const jun = cashCheckRows(all(), 2026, pageKeep(S, F, TODAY)).rows.find((r) => r.key === hid + '/PAY1')!;
    expect([jun.amt, jun.state, jun.fp?.amt]).toEqual([108000, 'ok', 360000]);
    expect(payerName(jun.line!)).toBe(PAYER);
    expect(jointLineWords(jun.line!, 'QT-1')).toBe('ใบเสนอราคาร่วม QT-1 · 3 บริษัท · ส่วนของ 1 บริษัท');
  });
  it('a check never changes a money figure: the KPI, Cashflow and commission are the same without the checks', () => {
    const { S } = fx;
    const bare = { ...S, pchk: {}, mclose: {} };
    const L = (s: typeof S) => cashLines(s, Object.values(s.deals), TODAY);
    expect(salesStats(bare, year(bare), TODAY)).toEqual(salesStats(S, year(S), TODAY));
    expect(cashYear(L(bare), '2569')).toEqual(cashYear(L(S), '2569'));
    expect(contribIn(unitCtx(bare), L(bare), periodRange('2569', 'year'))).toEqual(contribIn(unitCtx(S), L(S), periodRange('2569', 'year')));
  });
});

describe('who sees what (phase 2 capabilities)', () => {
  it('commission and splits only with ดูค่าคอมมิชชั่น; the month check with ตรวจยืนยันรับเงิน (not a sales account by default)', () => {
    expect(capCan(BUILTIN.admin.c, 'view.comm')).toBe(true);
    expect(capCan(BUILTIN.sales.c, 'view.comm')).toBe(false);
    expect(capCan(BUILTIN.viewer.c, 'view.comm')).toBe(false);
    expect(capCan(BUILTIN.sales.c, 'pay.check')).toBe(false);
    expect(capCan(BUILTIN.admin.c, 'pay.check')).toBe(true);
    expect(capCan(BUILTIN.admin.c, 'edit.share')).toBe(true);
    expect(capCan(BUILTIN.sales.c, 'edit.share')).toBe(false);
    expect(capCan(BUILTIN.sales.c, 'edit.jqt')).toBe(true);
  });
  it('the joint quotation\'s data is the same after a backup restore into another browser', async () => {
    const { e, S } = fx;
    // what "ส่งออกไฟล์สำรอง" downloads, caught on its way to the browser
    let blob: Blob | null = null;
    const spy = vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x'));
    vi.stubGlobal('document', { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } });
    try {
      e.exportCrm();
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
    const f = mk({ name: 'หมิว' });
    await f.importCrm(Object.assign(blob!, { name: 'backup.json' }) as unknown as File);
    const T = f.sales;
    expect(salesStats(T, year(T), TODAY).byResp).toEqual(salesStats(S, year(S), TODAY).byResp);
    const L = (s: typeof S) => cashLines(s, Object.values(s.deals), TODAY);
    expect(contribIn(unitCtx(T), L(T), periodRange('2569', 'year')).by).toEqual(contribIn(unitCtx(S), L(S), periodRange('2569', 'year')).by);
    expect(T.pchk).toEqual(S.pchk);
    expect(T.mclose).toEqual(S.mclose);
    expect(dealMoney(T, T.deals[fx.hid]).forecast).toBe(900000);
  });
});
