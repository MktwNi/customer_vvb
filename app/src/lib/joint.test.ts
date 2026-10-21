/**
 * Joint quotations (package quotes, item 7): the roles a deal can have, the money counted once (on the
 * header) across the KPIs, the sections, the Dashboard, Cashflow and the closed tab, customers counted per
 * member, the header's money apportioned to the members' people by their parts (an equal split by default,
 * none for a company that withdrew), and the screens' helpers (lib/joint.ts). One demo world: the CFP of
 * มจพ for four companies (mockups 09–15), Mon 12 Oct 2569.
 */
import { describe, expect, it } from 'vitest';
import {
  apportion, cashKpis, cashLines, cashRecon, cashYear, closeReady, customersOf, dealMoney, emptySales, filterDeals, jointAttr, jointCashLines, jointHeadOf, jointOf, jointParts, jointRole, jointSplit, jointWeights, moneyHolds, moneyOwners,
  moneySum, newDeal, normSalesFilter, overdueDays, payDue, payState, receivables, receivedIn, owedIn, salesStats, stageTrack, toJqm, toJqt,
  type Deal, type DealDoc, type JointMember, type PayLine, type SalesFilterIn, type SalesState,
} from './sales';
import {
  canMergeFrom, closeSummary, closedWord, isJointNote, jointHead, jointLabel, jointLine, jointNote, jointRows, jointShort, memberLine, memberShares, ownJob, parseShare, payerShort, pickParts, resultsWord, rowDeals, rowFate, rowMoneyDeals, shareOf,
  sharesCheck, sharesWord, strayDocs,
} from './joint';
// the second review's fixes
import { bandPart, jointNo, moneyWords, noteNo, pickLine, viewCashLines } from './joint';
import { dealSteps } from './sales';
import { cashRows, jointLineWords, payerName } from './cashUi';
import { closingView, liveCount, monthCounts, nextStepView, statusView, trackerFields } from './salesUi';
import { applyRow, localRecords, noEffects, rebaseOp, type SharedState } from './teamSync';

const T = '2026-10-12';
const PAYER = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '', ...p });
const qt = (deal: string, amount: number, p: Partial<DealDoc> = {}): DealDoc => ({
  id: 'qt-' + deal, deal, kind: 'quotation', name: 'qt.pdf', mime: 'application/pdf', size: 1, fileId: 'F-' + deal, docNo: 'QT-2569-052', docDate: '2026-10-06', amount, target: 'forecast', detected: amount,
  basis: 'total', stage: 'QUOTATION', at: '2026-10-06T03:00:00.000Z', cAt: '2026-10-06T03:00:00.000Z', by: 'หมิว', ...p,
});
const M = (p: Partial<JointMember> = {}, at = '2026-10-06T03:00:00.000Z'): JointMember => ({ share: null, pct: null, at, by: 'หมิว', ...p });

/** The CFP of มจพ: header h (the payer's row, its quotation 1,284,000), members b1–b4 (each with a typed
 *  Forecast of 50,000 from before, which no longer counts), and a plain deal p1. */
function world(o: { yes?: boolean; plan?: boolean; paid1?: boolean; shares?: Partial<JointMember>[] } = {}): SalesState {
  const s = emptySales();
  const add = (id: string, p: Partial<Deal>) => (s.deals[id] = newDeal({ id, year: '2569', section: 'Event Exhibition', ...p, client: p.client || 'บริษัท ' + id }, 'หมิว', '2026-09-01T03:00:00.000Z'));
  add('h', { client: PAYER, resp: 'หมิว', order: 1 });
  [['b1', 'บางกอกสตีล เวิร์คส์', 'หมิว'], ['b2', 'อุดร ไบโอแมส', 'คุณบี'], ['b3', 'สยามฟู้ดส์ แปรรูป', 'มกร'], ['b4', 'โคราช ซีเมนต์', 'คุณเอ']].forEach(([id, client, resp], i) => {
    add(id, { client, resp, forecast: 50000, source: ['Event Exhibition'], order: 10 + i });
    s.steps[`${id}/QUOTATION`] = { d: '2026-10-06', n: jointNote('QT-2569-052') };
  });
  add('p1', { client: 'ไทยพลาสติกรีไซเคิล', resp: 'หมิว', forecast: 100000, order: 20 });
  s.docs['h/qt-h'] = qt('h', 1284000);
  s.steps['h/QUOTATION'] = { d: '2026-10-06', n: 'ใบเสนอราคา QT-2569-052 · 1,284,000 บาท' };
  s.jqt = { h: { title: 'CFP ' + PAYER + ' (มจพ)', at: '2026-10-06T03:00:00.000Z', by: 'หมิว' } };
  s.jqm = {};
  ['b1', 'b2', 'b3', 'b4'].forEach((id, i) => (s.jqm![`h/${id}`] = M(o.shares?.[i] || {}, `2026-10-06T03:00:0${i}.000Z`)));
  if (o.yes) s.steps['h/CLOSED DEAL'] = { d: '2026-10-07', n: 'YES' };
  if (o.plan) {
    s.pays['h/PAY1'] = L({ amt: 642000, due: '2026-10-10', ...(o.paid1 ? { rcv: '2026-10-09' } : {}) });
    s.pays['h/PAY2'] = L({ amt: 642000, due: '2026-12-15' });
  }
  return s;
}
const all = (s: SalesState) => Object.values(s.deals);

describe('roles: header, member, plain', () => {
  it('a header is marked; a member belongs to a header deal that exists; anything else is plain', () => {
    const s = world();
    expect(['h', 'b1', 'b4', 'p1'].map((id) => jointRole(s, s.deals[id]))).toEqual(['header', 'member', 'member', 'plain']);
    const g = jointOf(s, s.deals.b2)!;
    expect(g.head.id).toBe('h');
    expect(g.members.map((x) => x.deal.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(jointOf(s, s.deals.p1)).toBeNull();
    expect(customersOf(s, all(s)).map((d) => d.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'p1']);
  });
  it('an orphan membership (its header deal gone) does not count; a deal in two joint quotations belongs to the newest', () => {
    const s = world();
    s.jqm!['gone/p1'] = M();
    expect(jointRole(s, s.deals.p1)).toBe('plain');
    s.deals.h2 = newDeal({ id: 'h2', client: 'สอท.', year: '2569' }, 'A');
    s.jqt!.h2 = { title: 'CFO สอท.', at: '', by: '' };
    s.jqm!['h2/b1'] = M({}, '2026-10-08T00:00:00.000Z');
    expect(jointHeadOf(s, 'b1')).toBe('h2');
    expect(jointOf(s, { id: 'h' })!.members.map((x) => x.deal.id)).toEqual(['b2', 'b3', 'b4']);
    // a header is never a member of another (made on two devices at once): its own mark wins
    s.jqm!['h2/h'] = M({}, '2026-10-09T00:00:00.000Z');
    expect(jointRole(s, s.deals.h)).toBe('header');
    expect(jointOf(s, { id: 'h2' })!.members.map((x) => x.deal.id)).toEqual(['b1']);
  });
  it('records from the sheet are checked: out-of-range parts are an equal split, junk is skipped', () => {
    expect(toJqt({ title: 'CFP มจพ', at: '2026-10-06T00:00:00.000Z', by: 'หมิว' })).toEqual({ title: 'CFP มจพ', at: '2026-10-06T00:00:00.000Z', by: 'หมิว' });
    expect(toJqt('junk')).toBeNull();
    expect(toJqm({ share: '321000', pct: 120 })).toMatchObject({ share: 321000, pct: null });
    expect(toJqm({ share: -5, pct: 25 })).toMatchObject({ share: null, pct: 25 });
    expect(toJqm([1])).toBeNull();
  });
});

describe('the parts: shares, %, an equal split; apportioning money', () => {
  it('no parts typed: an equal split of the quotation', () => {
    const s = world(), g = jointOf(s, { id: 'h' })!;
    expect(jointWeights(g.members.map((x) => x.m), 1284000)).toEqual([321000, 321000, 321000, 321000]);
    expect(jointSplit(s, g, 1284000)).toEqual([321000, 321000, 321000, 321000]);
    expect(memberShares(s, g).map((x) => [x.amt, x.pct, x.auto])).toEqual([[321000, 25, true], [321000, 25, true], [321000, 25, true], [321000, 25, true]]);
    expect(sharesWord(g)).toBe('แบ่งเท่ากัน');
  });
  it('a share in baht, a %, and the others splitting what is left; the parts always add up', () => {
    const s = world({ shares: [{ share: 500000 }, { pct: 25 }] }), g = jointOf(s, { id: 'h' })!;
    expect(jointWeights(g.members.map((x) => x.m), 1284000)).toEqual([500000, 321000, 231500, 231500]);
    const parts = jointSplit(s, g, 1284000);
    expect(parts).toEqual([500000, 321000, 231500, 231500]);
    expect(jointSplit(s, g, 100001).reduce((a, x) => a + x, 0)).toBe(100001);
    expect(sharesWord(g)).toBe('กำหนดส่วนแบ่งเอง');
    // no quotation total yet: a % is a weight against 100, an empty part the others' mean
    expect(jointWeights([{ share: null, pct: 60 }, { share: null, pct: 20 }, { share: null, pct: null }], null)).toEqual([60, 20, 40]);
    expect(jointWeights([{ share: 0, pct: null }, { share: 0, pct: null }], 0)).toEqual([1, 1]);
  });
  it('a company that withdrew (NO) gets no part; when all withdrew, an equal split', () => {
    const s = world();
    s.steps['b4/CLOSED DEAL'] = { d: '2026-08-02', n: 'NO' };
    const g = jointOf(s, { id: 'h' })!;
    expect(jointParts(s, g)).toEqual([428000, 428000, 428000, 0]);
    expect(jointSplit(s, g, 963000)).toEqual([321000, 321000, 321000, 0]);
    expect(memberShares(s, g)[3]).toMatchObject({ amt: null, out: true });
    ['b1', 'b2', 'b3'].forEach((id) => (s.steps[`${id}/CLOSED DEAL`] = { d: '2026-08-02', n: 'NO' }));
    expect(jointParts(s, g).every((x) => x > 0)).toBe(true);
  });
  it('apportion: whole baht adding up exactly, the rounding on the last with a weight; all zero: equal', () => {
    expect(apportion(100, [1, 1, 1])).toEqual([33, 33, 34]);
    expect(apportion(100, [1, 1, 0])).toEqual([50, 50, 0]);
    expect(apportion(100, [0, 0])).toEqual([50, 50]);
    expect(apportion(7, [])).toEqual([]);
  });
  it('whose money it is: a plain deal\'s own, a header\'s to its members, a member none', () => {
    const s = world();
    expect(moneyOwners(s, s.deals.p1, 100000)).toEqual([{ deal: s.deals.p1, amt: 100000 }]);
    expect(moneyOwners(s, s.deals.b1, 50000)).toEqual([]);
    expect(moneyOwners(s, s.deals.h, 1284000).map((x) => [x.deal.resp, x.amt])).toEqual([['หมิว', 321000], ['คุณบี', 321000], ['มกร', 321000], ['คุณเอ', 321000]]);
    delete s.jqm!['h/b1'], delete s.jqm!['h/b2'], delete s.jqm!['h/b3'], delete s.jqm!['h/b4'];
    expect(moneyOwners(s, s.deals.h, 1284000)).toEqual([{ deal: s.deals.h, amt: 1284000 }]);
  });
});

describe('money counted once, customers per member', () => {
  it('salesStats: the quotation once, the members\' typed figures ignored; 5 customers (not the header); people by their parts', () => {
    const s = world();
    const st = salesStats(s, all(s), T);
    expect(st.forecast).toBe(1284000 + 100000);
    expect(st.fcConfirmed).toBe(1284000);
    expect(st.total).toBe(5);
    expect(st.none).toBe(5);
    expect(st.stages.find((x) => x.name === 'QUOTATION')!.n).toBe(4); // the members, not the header
    expect(st.byResp['หมิว']).toEqual({ n: 2, forecast: 321000 + 100000, actual: 0 });
    expect(st.byResp['คุณบี']).toEqual({ n: 1, forecast: 321000, actual: 0 });
    // the parts add up to the total: no money lost or counted twice in the breakdowns
    expect(Object.values(st.byResp).reduce((a, x) => a + x.forecast, 0)).toBe(st.forecast);
    expect(Object.values(st.byReferral).reduce((a, x) => a + x.forecast, 0)).toBe(st.forecast);
    expect(st.bySource['Event Exhibition']).toMatchObject({ n: 4, forecast: 1284000 });
  });
  it('win rate per company: three won, one withdrew', () => {
    const s = world({ yes: true });
    ['b1', 'b2', 'b3'].forEach((id) => (s.steps[`${id}/CLOSED DEAL`] = { d: '2026-10-07', n: 'YES' }));
    s.steps['b4/CLOSED DEAL'] = { d: '2026-10-07', n: 'NO' };
    const st = salesStats(s, all(s), T);
    expect([st.yes, st.no, st.decided, st.winRate]).toEqual([3, 1, 4, 75]);
    // the header's money goes to the three that stayed
    expect(st.byResp['คุณเอ'].forecast).toBe(0);
    expect(st.byResp['หมิว'].forecast).toBe(428000 + 100000);
  });
  it('the payer\'s plan: once in Cashflow (one payer line per installment, with the member count), in ค้างรับ, in the calendar, never a member\'s', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    // a won member with a typed Forecast and no plan would have shown as "ส่วนที่ยังไม่รับ" before
    s.steps['b1/CLOSED DEAL'] = { d: '2026-10-07', n: 'YES' };
    const lines = cashLines(s, all(s), T);
    expect(lines.map((l) => [l.deal.id, l.stage, l.kind, l.amt])).toEqual([['h', 'PAY1', 'got', 642000], ['h', 'PAY2', 'owed', 642000]]);
    expect(lines.every((l) => l.joint?.members === 4 && l.joint.title.startsWith('CFP'))).toBe(true);
    const open = all(s).filter((d) => d.jobStatus === 'open');
    expect(receivables(s, open, T).receivable).toBe(642000);
    expect(receivedIn(s, all(s), { from: '2026-01-01', to: '2026-12-31' }, T)).toBe(642000);
    expect(owedIn(s, all(s), { from: '2026-01-01', to: '2026-12-31' }, T)).toBe(642000);
    expect(payDue(s, all(s), '', '2026-12-31', T).map((x) => [x.deal.id, x.line.stage])).toEqual([['h', 'PAY2']]);
    // KPI = Cashflow = the Dashboard's money: one figure
    const st = salesStats(s, all(s), T), Y = cashYear(lines, '2569');
    expect(st.actual).toBe(642000);
    expect(Y.totals.got).toBe(st.actual);
    expect(cashKpis(Y, '2569', T).owed).toBe(st.receivable);
    expect(cashRecon(lines, '2569').open).toBe(st.receivable);
    expect(st.byResp['คุณบี'].actual).toBe(160500);
  });
  it('the table\'s sections and the closed tab sum the header once, never the members', () => {
    const s = world();
    s.deals.b3.section = 'Partner'; // its own หมวด differs: drawn under the band all the same
    const { secs, rows } = jointRows(s, filterDeals(s, { year: '2569' }, T));
    expect(secs).toEqual(['Event Exhibition']);
    const ee = rows.get('Event Exhibition')!;
    expect(ee[0]).toMatchObject({ k: 'band', inList: true });
    expect(ee[0].k === 'band' && ee[0].shown.map((d) => d.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(ee.slice(1).map((r) => r.k === 'deal' && r.d.id)).toEqual(['p1']);
    expect(rowDeals(ee).map((d) => d.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'p1']);
    const sum = rowMoneyDeals(ee).reduce((a, d) => a + (dealMoney(s, d).forecast || 0), 0);
    expect(sum).toBe(salesStats(s, all(s), T).forecast);
    // closed: the whole group, the money once
    all(s).forEach((d) => ((d.jobStatus = 'closed'), (d.closedDate = '2026-10-12')));
    const closed = filterDeals(s, { year: '2569', job: 'closed' }, T);
    const cr = jointRows(s, closed);
    expect(cr.rows.get('Event Exhibition')![0].k).toBe('band');
    expect(customersOf(s, closed)).toHaveLength(5);
  });
  it('a member in the list without its header (another person\'s filter) still comes under its band, unsummed', () => {
    const s = world();
    const only = filterDeals(s, { year: '2569', resp: 'คุณบี' }, T);
    expect(only.map((d) => d.id)).toEqual(['b2']);
    const r = jointRows(s, only).rows.get('Event Exhibition')!;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ k: 'band', inList: false });
    expect(rowMoneyDeals(r)).toEqual([]);
    expect(liveCount(s, { year: '2569' }, 'resp', null, 'open', T)).toBe(5);
  });
});

// review finding 2: filtered views agree with the per-person split
describe('under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter the joint money is its members\' parts', () => {
  const view = (s: SalesState, f: Omit<SalesFilterIn, 'year'>) => {
    const F = normSalesFilter({ year: '2569', ...f });
    return { F, list: filterDeals(s, F, T), attr: jointAttr(F) };
  };
  it('a person\'s filtered figures equal that person\'s row of the unfiltered summary (the Dashboard and the KPIs)', () => {
    const s = world({ yes: true, plan: true, paid1: true, shares: [{ share: 500000 }] });
    s.deals.b3.referral = 'งานสัมมนา';
    const st0 = salesStats(s, all(s), T);
    for (const who of ['หมิว', 'คุณบี', 'มกร', 'คุณเอ']) {
      const { list, attr } = view(s, { resp: { v: [who] } });
      expect(attr).toBe(true);
      const st = salesStats(s, list, T, attr);
      expect([st.forecast, st.actual]).toEqual([st0.byResp[who].forecast, st0.byResp[who].actual]);
      // only that person appears in สรุปยอดตามผู้รับผิดชอบ / ผู้ทำยอดสูงสุด
      expect(Object.keys(st.byResp)).toEqual([who]);
      expect(st.byResp[who]).toEqual(st0.byResp[who]);
    }
    // คุณบี's own row b2 brings its part though the header (หมิว's) is filtered out
    const b = view(s, { resp: { v: ['คุณบี'] } });
    expect(b.list.map((d) => d.id)).toEqual(['b2']);
    expect(salesStats(s, b.list, T, true).forecast).toBe(261333);
    // the parts of everyone add up to the whole, once
    const sum = ['หมิว', 'คุณบี', 'มกร', 'คุณเอ'].reduce((a, w) => a + salesStats(s, view(s, { resp: { v: [w] } }).list, T, true).forecast, 0);
    expect(sum).toBe(st0.forecast);
    // a "not" filter keeps the others' parts
    const nb = view(s, { resp: { v: ['คุณบี'], not: true } });
    expect(salesStats(s, nb.list, T, true).forecast).toBe(st0.forecast - 261333);
    // SOURCE and REFERRAL the same way
    const src = view(s, { source: { v: ['Event Exhibition'] } });
    expect(salesStats(s, src.list, T, src.attr).forecast).toBe(st0.bySource['Event Exhibition'].forecast);
    const ref = view(s, { referral: { v: ['งานสัมมนา'] } });
    expect(salesStats(s, ref.list, T, ref.attr).forecast).toBe(st0.byReferral['งานสัมมนา'].forecast);
  });
  it('the other money of the view follows: ค้างรับ, received / owed in a range, the section and closed sums, the Dashboard\'s Cashflow lines', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    const { list } = view(s, { resp: { v: ['คุณบี'] } });
    const yr = { from: '2026-01-01', to: '2026-12-31' };
    expect(receivables(s, list, T, true).receivable).toBe(642000 / 4);
    expect(receivedIn(s, list, yr, T, true)).toBe(642000 / 4);
    expect(owedIn(s, list, yr, T, true)).toBe(642000 / 4);
    expect(moneySum(s, list, true)).toEqual({ fc: 321000, ac: 160500, fcOpen: 321000, fcClosed: 0 });
    const lines = jointCashLines(s, list, T, true);
    expect(lines.map((l) => [l.deal.id, l.stage, l.kind, l.amt])).toEqual([['h', 'PAY1', 'got', 160500], ['h', 'PAY2', 'owed', 160500]]);
    expect(cashYear(lines, '2569').totals.got).toBe(salesStats(s, list, T, true).actual);
    // without a person filter: the whole, once
    expect(jointCashLines(s, all(s), T, false)).toEqual(cashLines(s, all(s), T));
    expect(moneySum(s, all(s)).fc).toBe(salesStats(s, all(s), T).forecast);
    // the header kept but none of its companies under the filter: none of its money
    s.deals.h.resp = 'ปลา';
    expect(moneyHolds(s, view(s, { resp: { v: ['ปลา'] } }).list, true)).toEqual([]);
  });
  it('any other filter reads the joint quotation as one job: the whole when its header is listed', () => {
    const s = world();
    expect(jointAttr({ section: { v: ['Event Exhibition'] } })).toBe(false);
    expect(jointAttr({ resp: { v: ['หมิว'] } })).toBe(true);
    expect(jointAttr(null)).toBe(false);
    const q = view(s, { q: 'บางกอก' });
    expect(q.list.map((d) => d.id)).toEqual(['b1']);
    expect(salesStats(s, q.list, T, q.attr).forecast).toBe(0);
  });
  it('a member is filtered in its header\'s หมวด (where its row is drawn), and with its header\'s money (การรับเงิน, dates of money)', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    s.deals.b3.section = 'Partner';
    expect(view(s, { section: { v: ['Event Exhibition'] } }).list.map((d) => d.id).sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'h', 'p1']);
    expect(view(s, { section: { v: ['Partner'] } }).list).toEqual([]);
    const fields = trackerFields(s, normSalesFilter({ year: '2569' }), { yearDeals: all(s), job: '', me: 'หมิว', today: T });
    expect(fields.find((f) => f.key === 'section')!.options.find((o) => o.v === 'Event Exhibition')!.n).toBe(5);
    // การรับเงิน: the members pass with their payer; the count is of customers
    const got = view(s, { pay: 'got' });
    expect(got.list.map((d) => d.id).sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'h']);
    expect(customersOf(s, got.list)).toHaveLength(4);
    expect(monthCounts(s, normSalesFilter({ year: '2569' }), 'paid', 2026, '', T)[9]).toBe(4);
  });
});

describe('a member follows up on its own row and is paid through the joint quotation', () => {
  it('its PAY stages are not its own; won, it waits for the payer and closes when the payer has paid', () => {
    const s = world({ yes: true, plan: true });
    s.steps['b2/CLOSED DEAL'] = { d: '2026-10-07', n: 'YES' };
    const b2 = s.deals.b2;
    const t = stageTrack(s, b2, T);
    expect([t.states.PAY1, t.states.PAY2, t.next]).toEqual(['off', undefined, '']);
    // one PAY step, paid through the joint quotation: shown, not counted
    expect(dealSteps(s, b2, T).steps.filter((v) => v.kind === 'pay').map((v) => [v.id, v.code, v.outside, v.counted, v.state])).toEqual([['PAY1', 'PAY', 'joint', false, 'off']]);
    expect(payState(s, b2, T).left).toEqual(['PAY1', 'PAY2']);
    expect(closeReady(s, b2, T)).toBe(false);
    expect(nextStepView(s, b2, T)).toMatchObject({ kind: 'joint', hint: 'ชำระผ่านใบเสนอราคาร่วม' });
    expect(statusView(s, b2, T)).toMatchObject({ word: 'ได้งาน', sub: 'ผู้จ่ายชำระ 0/2 งวด', ready: false });
    expect(closingView(s, b2, T)).toMatchObject({ state: 'joint', ready: false });
    expect(overdueDays(s, b2, '2026-12-31')).toBeNull();
    s.pays['h/PAY1'].rcv = '2026-10-09';
    s.pays['h/PAY2'].rcv = '2026-10-11';
    expect(closeReady(s, b2, T)).toBe(true);
    expect(statusView(s, b2, T).sub).toBe('พร้อมปิดงาน');
    expect(nextStepView(s, b2, T).kind).toBe('done');
  });
  it('a member that withdrew waits for the joint quotation (it closes as one) and is not followed up; the header is not a customer to follow up', () => {
    const s = world();
    s.steps['b4/CLOSED DEAL'] = { d: '2026-08-02', n: 'NO' };
    expect(closeReady(s, s.deals.b4, T)).toBe(false);
    expect(overdueDays(s, s.deals.b4, '2026-12-31')).toBeNull();
    expect(statusView(s, s.deals.b4, T)).toMatchObject({ word: 'ไม่ได้งาน', sub: 'ปิดพร้อมใบเสนอราคาร่วม', ready: false });
    expect(closingView(s, s.deals.b4, T)).toMatchObject({ state: 'joint', ready: false, lead: 'ไม่ได้งาน (ถอนตัว) · ชำระผ่านใบเสนอราคาร่วม' });
    expect(overdueDays(s, s.deals.h, '2026-12-31')).toBeNull();
    expect(overdueDays(s, s.deals.b1, '2026-12-31')).not.toBeNull();
    // the payer says NO: the whole quotation (every company, whatever its own result) is ready to close
    s.steps['h/CLOSED DEAL'] = { d: '2026-10-08', n: 'NO' };
    expect(['h', 'b1', 'b4'].map((id) => closeReady(s, s.deals[id], T))).toEqual([true, true, true]);
    expect(closingView(s, s.deals.b1, T)).toMatchObject({ state: 'joint', ready: true, lead: 'ยังไม่มีผลของบริษัทนี้ · ผู้จ่ายตอบว่าไม่ได้งาน' });
  });
});

describe('the search, the picker, the words', () => {
  it('finds the joint quotation and every member by its number and its name', () => {
    const s = world();
    expect(filterDeals(s, { year: '2569', q: 'qt-2569-052' }, T).map((d) => d.id)).toEqual(['h', 'b1', 'b2', 'b3', 'b4']);
    expect(filterDeals(s, { year: '2569', q: 'CFP' }, T).map((d) => d.id)).toEqual(['h', 'b1', 'b2', 'b3', 'b4']);
    expect(filterDeals(s, { year: '2569', q: 'ไทยพลาสติก' }, T).map((d) => d.id)).toEqual(['p1']);
  });
  it('the picker: "ใช้แถวเดิม" without a quotation or money of its own, else "เพิ่มแถวใหม่"; a header or another joint\'s member is refused', () => {
    const s = world();
    expect(rowFate(s, s.deals.p1)).toBe('reuse');
    s.docs['p1/qt-p1'] = qt('p1', 100000, { docNo: 'QT-2569-030' });
    expect(rowFate(s, s.deals.p1)).toBe('new');
    expect(rowFate(s, s.deals.h)).toBe('taken');
    expect(rowFate(s, s.deals.b1)).toBe('taken');
    expect(rowFate(s, s.deals.b1, 'h')).toBe('reuse');
  });
  // review finding 1: a row's own money (not only its documents) keeps it out of a joint quotation
  it('a row with money of its own is never reused: a typed Actual, a hand receipt, a plan, a closed job ("เพิ่มแถวใหม่", its money stays)', () => {
    const fresh = () => world();
    // typed Actual (no document)
    let s = fresh();
    s.deals.p1.actual = 80000;
    expect([ownJob(s, s.deals.p1), rowFate(s, s.deals.p1)]).toEqual(['money', 'new']);
    // an installment received by hand on its plan (no document)
    s = fresh();
    s.steps['p1/CLOSED DEAL'] = { d: '2026-09-01', n: 'YES' };
    s.pays['p1/PAY1'] = L({ amt: 60000, due: '2026-09-30', rcv: '2026-09-28' });
    expect(dealMoney(s, s.deals.p1).actual).toBe(60000);
    expect([ownJob(s, s.deals.p1), rowFate(s, s.deals.p1)]).toEqual(['money', 'new']);
    // a plan, nothing received yet
    s = fresh();
    s.pays['p1/PAY1'] = L({ amt: 60000, due: '2026-11-30' });
    expect([ownJob(s, s.deals.p1), rowFate(s, s.deals.p1)]).toEqual(['plan', 'new']);
    // a closed job (seed-c's พฤกษา: closed with a typed Actual of 180,000 and no documents)
    s = fresh();
    s.deals.p1.jobStatus = 'closed';
    expect([ownJob(s, s.deals.p1), rowFate(s, s.deals.p1)]).toEqual(['closed', 'new']);
    // a Forecast document of another kind counts as its own quotation
    s = fresh();
    s.docs['p1/f'] = { ...qt('p1', 90000), id: 'f', kind: 'other', stage: '' };
    expect(ownJob(s, s.deals.p1)).toBe('qt');
    // a typed Forecast alone is the estimate of this job: reused (ignored while it is a member)
    s = fresh();
    expect([ownJob(s, s.deals.p1), rowFate(s, s.deals.p1)]).toEqual(['', 'reuse']);
  });
  it('the money a reused row would have hidden stays: totals unchanged when such a row "joins" through a new row', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    s.steps['p1/CLOSED DEAL'] = { d: '2026-09-01', n: 'YES' };
    s.pays['p1/PAY1'] = L({ amt: 60000, due: '2026-09-30', rcv: '2026-09-28' });
    const before = salesStats(s, all(s), T), cashBefore = cashYear(cashLines(s, all(s), T), '2569').totals.got;
    expect(rowFate(s, s.deals.p1, 'h')).toBe('new');
    // what the engine does for "new": a new row of the company joins, p1 stays plain with its money
    s.deals.p1b = newDeal({ id: 'p1b', client: s.deals.p1.client, year: '2569', section: 'Event Exhibition', resp: 'หมิว' }, 'หมิว', '2026-10-12T03:00:00.000Z');
    s.jqm!['h/p1b'] = M({}, '2026-10-12T03:00:00.000Z');
    const after = salesStats(s, all(s), T);
    expect([after.forecast, after.actual]).toEqual([before.forecast, before.actual]);
    expect(after.actual).toBe(642000 + 60000);
    expect(cashYear(cashLines(s, all(s), T), '2569').totals.got).toBe(cashBefore);
  });
  it('"รวมเป็นใบเสนอราคาร่วม" only from a plain deal whose quotation is its only money', () => {
    const s = world();
    s.docs['p1/qt-p1'] = qt('p1', 100000, { docNo: 'QT-2569-030' });
    expect(canMergeFrom(s, s.deals.p1)).toBe(true);
    s.deals.p1.actual = 50000;
    expect(canMergeFrom(s, s.deals.p1)).toBe(false);
    s.deals.p1.actual = null;
    s.pays['p1/PAY1'] = L({ amt: 50000, due: '2026-11-30' });
    expect(canMergeFrom(s, s.deals.p1)).toBe(false);
    delete s.pays['p1/PAY1'];
    s.deals.p1.jobStatus = 'closed';
    expect(canMergeFrom(s, s.deals.p1)).toBe(false);
    s.deals.p1.jobStatus = 'open';
    s.docs['p1/rc'] = { ...qt('p1', 20000), id: 'rc', kind: 'receipt', target: 'actual', stage: 'PAY1' };
    expect(canMergeFrom(s, s.deals.p1)).toBe(false);
    delete s.docs['p1/rc'];
    expect(canMergeFrom(s, s.deals.p1)).toBe(true);
    // no quotation, a member, a header: no
    expect(canMergeFrom(s, s.deals.p1 && { ...s.deals.p1, id: 'none' })).toBe(false);
    expect(canMergeFrom(s, s.deals.b1)).toBe(false);
    expect(canMergeFrom(s, s.deals.h)).toBe(false);
  });
  // review finding 3: an account limited to its own deals
  it('a row the account may not edit is "locked" (never reused); one with a job of its own still gets a new row', () => {
    const s = world();
    const mine = (d: Deal) => d.resp === 'คุณบี';
    expect(rowFate(s, s.deals.p1, '', mine)).toBe('locked');
    s.deals.p1.resp = 'คุณบี';
    expect(rowFate(s, s.deals.p1, '', mine)).toBe('reuse');
    s.deals.p1.resp = 'หมิว';
    s.deals.p1.actual = 10;
    expect(rowFate(s, s.deals.p1, '', mine)).toBe('new');
    // already a member of this one: it stays (the dialog keeps it, without "เอาออก")
    expect(rowFate(s, s.deals.b1, 'h', mine)).toBe('reuse');
  });
  it('the dialog\'s parts: baht or %, an empty one an equal split, the sum against the total', () => {
    expect(parseShare('321,000')).toEqual({ share: 321000, pct: null });
    expect(parseShare(' 25 %')).toEqual({ share: null, pct: 25 });
    expect(parseShare('')).toEqual({ share: null, pct: null });
    expect(parseShare('สามแสน')).toBeUndefined();
    expect(parseShare('120%')).toBeUndefined();
    expect(pickParts([{ share: 500000, pct: null }, { share: null, pct: null }], 1284000)).toEqual({ amt: [500000, 784000], pct: [39, 61] });
    expect(pickParts([{ share: null, pct: 30 }, { share: null, pct: null }, { share: null, pct: null }], 1000)).toEqual({ amt: [300, 350, 350], pct: [30, 35, 35] });
    const E = { share: null, pct: null };
    expect(sharesCheck([E, E, E, E], 1284000)).toEqual({ text: 'รวม 1,284,000 · เท่ากับยอดใบเสนอราคา', warn: false });
    expect(sharesCheck([{ share: 321000, pct: null }, { share: 321000, pct: null }], 1284000)).toEqual({ text: 'ส่วนแบ่งที่ใส่รวม 642,000 · น้อยกว่ายอดใบเสนอราคา 642,000 · ระบบปรับตามสัดส่วน', warn: true });
    expect(sharesCheck([{ share: 1000000, pct: null }, { share: 500000, pct: null }], 1284000)).toEqual({ text: 'ส่วนแบ่งที่ใส่รวม 1,500,000 · มากกว่ายอดใบเสนอราคา 216,000 · ระบบปรับตามสัดส่วน', warn: true });
    // empty parts take what is left: never a warning while the typed ones fit
    expect(sharesCheck([{ share: 500000, pct: null }, { share: null, pct: 25 }, E], 1284000).warn).toBe(false);
  });
  // review finding 5: the dialog rounds as the panel does
  it('the dialog\'s parts are the panel\'s: an uneven remainder on the last, no false "off by 1"; no total, no baht', () => {
    const s = world({ shares: [{ share: 500000 }] }), g = jointOf(s, { id: 'h' })!;
    const picks = g.members.map((x) => x.m);
    const pp = pickParts(picks, 1284000);
    expect(pp.amt).toEqual([500000, 261333, 261333, 261334]);
    expect(pp.amt).toEqual(memberShares(s, g).map((x) => x.amt));
    expect(pp.amt).toEqual(jointSplit(s, g, 1284000));
    expect(pp.amt!.reduce((a, x) => a + x, 0)).toBe(1284000);
    expect(sharesCheck(picks, 1284000)).toEqual({ text: 'รวม 1,284,000 · เท่ากับยอดใบเสนอราคา', warn: false });
    // a company that withdrew gets none, as in the panel
    s.steps['b4/CLOSED DEAL'] = { d: '2026-08-02', n: 'NO' };
    const out = g.members.map((x) => x.deal.id === 'b4');
    expect(pickParts(picks, 1284000, out).amt).toEqual(memberShares(s, jointOf(s, { id: 'h' })!).map((x) => x.amt ?? 0));
    // no total yet: no baht, the % only, and no "รวม 2"
    const E = { share: null, pct: null };
    expect(pickParts([E, E], null)).toEqual({ amt: null, pct: [50, 50] });
    expect(sharesCheck([E, E], null)).toEqual({ text: 'ยังไม่มียอดรวม · แบ่งตามสัดส่วน', warn: false });
    expect(sharesCheck([{ share: null, pct: 60 }, { share: null, pct: 60 }], null).warn).toBe(true);
  });
  it('names: the band, the short title, the payer, a member\'s line; the note it writes and recognises', () => {
    const s = world(), g = jointOf(s, { id: 'h' })!;
    expect(jointShort(g)).toBe('CFP มจพ');
    expect(payerShort(g)).toBe('มจพ');
    // the band: the payer on top, the quotation under it (no "ผู้จ่าย": the payer is the line above)
    expect(jointHead(s, g)).toEqual({ name: PAYER, qt: 'ใบเสนอราคาร่วม QT-2569-052', label: 'CFP มจพ', sub: 'ใบเสนอราคาร่วม QT-2569-052 · CFP มจพ · 4 บริษัท · หมิว' });
    expect(jointLine(s, g)).toBe(`${PAYER} · ใบเสนอราคาร่วม QT-2569-052`);
    expect(memberLine(s, s.deals.b2, true)).toBe('อยู่ในใบเสนอราคาร่วม QT-2569-052 (มจพ) · ร่วมกับอีก 3 บริษัท · ส่วนแบ่ง 321,000 (25%)');
    expect(memberLine(s, s.deals.b2, false)).toBe('อยู่ในใบเสนอราคาร่วม QT-2569-052 (มจพ) · ร่วมกับอีก 3 บริษัท');
    expect(shareOf(s, s.deals.b2)).toMatchObject({ amt: 321000, pct: 25 });
    expect(shareOf(s, s.deals.p1)).toBeNull();
    expect([isJointNote('ใบเสนอราคาร่วม QT-2569-052'), isJointNote('ใบเสนอราคาร่วม'), isJointNote('ส่งใบเสนอราคาร่วมทางอีเมลแล้ว')]).toEqual([true, true, false]);
    expect(jointShort({ head: s.deals.h, qt: { title: '', at: '', by: '' } })).toBe(PAYER);
    // a title of the team's own words keeps them; only the payer's long name gives way to the abbreviation
    expect(jointShort({ head: s.deals.h, qt: { title: 'CFP 4 บริษัท (มจพ)', at: '', by: '' } })).toBe('CFP 4 บริษัท มจพ');
    expect(jointShort({ head: s.deals.h, qt: { title: 'CFP รอบ 2 ' + PAYER + ' (มจพ)', at: '', by: '' } })).toBe('CFP รอบ 2 มจพ');
  });
});

// review finding 4: a member holds no money of its own
describe('a member\'s own documents', () => {
  it('a quotation or money document on a member counts nowhere: strayDocs lists it for "ย้ายไปใบเสนอราคาร่วม"', () => {
    const s = world();
    expect(strayDocs(s, s.deals.b2)).toEqual([]);
    s.docs['b2/x'] = { ...qt('b2', 1284000), id: 'x' };
    s.docs['b2/r'] = { ...qt('b2', 50000), id: 'r', kind: 'receipt', target: 'actual', stage: 'PAY1' };
    s.docs['b2/o'] = { ...qt('b2', 0), id: 'o', kind: 'other', target: 'none', amount: null, stage: '' };
    expect(strayDocs(s, s.deals.b2).map((x) => x.id).sort()).toEqual(['r', 'x']);
    // nothing counted: the KPIs as before
    expect(salesStats(s, all(s), T).forecast).toBe(1284000 + 100000);
    expect(salesStats(s, all(s), T).actual).toBe(0);
    // a plain deal's documents are its own
    s.docs['p1/x'] = { ...qt('p1', 5), id: 'x' };
    expect(strayDocs(s, s.deals.p1)).toEqual([]);
  });
});

describe('closing: every company with its result, the money once', () => {
  it('the closing dialog lists all members (a withdrawn one with no part), the total once and the payer\'s payment', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    ['b1', 'b2', 'b3'].forEach((id) => (s.steps[`${id}/CLOSED DEAL`] = { d: '2026-10-07', n: 'YES' }));
    s.steps['b4/CLOSED DEAL'] = { d: '2026-08-02', n: 'NO' };
    const g = jointOf(s, { id: 'h' })!;
    const c = closeSummary(s, g, T);
    expect(c.rows.map((x) => [x.deal.id, x.result, x.share])).toEqual([['b1', 'YES', 428000], ['b2', 'YES', 428000], ['b3', 'YES', 428000], ['b4', 'NO', null]]);
    expect(c.total).toBe(1284000);
    expect(c.pay).toBe('รับจาก มจพ 1 จาก 2 งวด · ค้าง 642,000 บาท');
    expect(c.open).toBe(4);
    expect(resultsWord(s, g)).toBe('ได้ 3 · ไม่ได้ 1');
    s.pays['h/PAY2'].rcv = '2026-10-11';
    expect(closeSummary(s, g, T).pay).toBe('รับจาก มจพ ครบ 2 จาก 2 งวด · 1,284,000 บาท');
  });
  it('a group partly closed says so in both tabs', () => {
    const s = world(), g = jointOf(s, { id: 'h' })!;
    expect(closedWord(g)).toBe('');
    s.deals.b4.jobStatus = 'closed';
    expect(closedWord(jointOf(s, { id: 'h' })!)).toBe('ปิดแล้ว 1 จาก 4');
    all(s).forEach((d) => (d.jobStatus = 'closed'));
    expect(closedWord(jointOf(s, { id: 'h' })!)).toBe('');
  });
});

describe('sync: the two records', () => {
  const shared = (s: SalesState): SharedState => ({ crm: { stages: {}, notes: {}, tasks: [], watch: [], owners: {}, team: [], log: {} }, contacts: {}, dec: {}, sales: s, custom: {}, people: {} });
  it('applyRow reads jqt / jqm (and their deletions); a malformed key or value is skipped', () => {
    const s = emptySales(), st = shared(s), fx = noEffects();
    applyRow(st, { seq: 1, k: 'jqt/h', v: { title: 'CFP มจพ', at: '', by: 'หมิว' }, del: false, by: '', at: '' }, fx);
    applyRow(st, { seq: 2, k: 'jqm/h/b1', v: { share: 321000, pct: null }, del: false, by: '', at: '' }, fx);
    applyRow(st, { seq: 3, k: 'jqm/h', v: { share: 1 }, del: false, by: '', at: '' }, fx);
    applyRow(st, { seq: 4, k: 'jqt/h/x', v: { title: 'x' }, del: false, by: '', at: '' }, fx);
    applyRow(st, { seq: 5, k: 'jqm/h/b2', v: 'junk', del: false, by: '', at: '' }, fx);
    expect(fx.sales).toBe(true);
    expect(s.jqt).toEqual({ h: { title: 'CFP มจพ', at: '', by: 'หมิว' } });
    expect(Object.keys(s.jqm!)).toEqual(['h/b1']);
    expect(localRecords(st).get('jqm/h/b1')).toMatchObject({ share: 321000 });
    expect(localRecords(st).get('jqt/h')).toMatchObject({ title: 'CFP มจพ' });
    applyRow(st, { seq: 6, k: 'jqm/h/b1', v: null, del: true, by: '', at: '' }, fx);
    expect(s.jqm).toEqual({});
  });
  it('a part edited here merges field by field with a teammate\'s change to the same membership', () => {
    const r = rebaseOp({ seq: 9, k: 'jqm/h/b1', v: { share: null, pct: 30, at: 'a', by: 'มินท์' }, del: false, by: 'มินท์', at: '' }, { k: 'jqm/h/b1', v: { share: 321000, pct: null, at: 'a', by: 'หมิว' }, f: ['share', 'by'] });
    expect(r).toEqual({ v: { share: 321000, pct: 30, at: 'a', by: 'หมิว' } });
  });
});

// ------------------------------------------------------------------ the second review's findings

describe('review 2: the Cashflow tab counts a joint quotation as the Dashboard does', () => {
  // the tab's filter (tabs/SalesCash CashView) and the Dashboard's money of the period (tabs/SalesDash)
  const tab = (_s: SalesState, f: Omit<SalesFilterIn, 'year'>) => normSalesFilter({ year: '2569', ...f, money: 'cash' });
  const dash = (s: SalesState, F: SalesFilterIn) => jointCashLines(s, filterDeals(s, { ...F, date: null, pay: undefined, money: 'cash' }, T), T, jointAttr(F));
  const sum = (ls: { amt: number }[]) => ls.reduce((a, l) => a + l.amt, 0);
  it('under a ผู้รับผิดชอบ filter: the tab\'s money equals the Dashboard\'s and that person\'s row of สรุปยอดตามผู้รับผิดชอบ', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    delete s.deals.p1; // (not won: no money in Cashflow, but a Forecast in หมิว's row)
    const st0 = salesStats(s, all(s), T);
    for (const who of ['หมิว', 'คุณบี', 'มกร', 'คุณเอ']) {
      const F = tab(s, { resp: { v: [who] } });
      const Y = cashYear(viewCashLines(s, F, T), '2569'), D = cashYear(dash(s, F), '2569');
      expect(Y.totals).toEqual(D.totals);
      expect(cashKpis(Y, '2569', T)).toEqual(cashKpis(D, '2569', T));
      // received = the person's Actual, every line of the year = the person's Forecast (the plan is the whole quotation)
      expect(Y.totals.got).toBe(st0.byResp[who].actual);
      expect(sum(Y.lines)).toBe(st0.byResp[who].forecast);
    }
    // the reviewer's case: คุณบี (whose company is b2) gets the part of PAY1 received, หมิว (header and b1) one part, not the whole
    const kb = cashYear(viewCashLines(s, tab(s, { resp: { v: ['คุณบี'] } }), T), '2569');
    expect([kb.totals.got, sum(kb.lines)]).toEqual([160500, 321000]);
    const mw = cashYear(viewCashLines(s, tab(s, { resp: { v: ['หมิว'] } }), T), '2569');
    expect(sum(mw.lines)).toBe(321000);
    // ค้างรับของงานปี (the tab's line under the cards) follows the same money
    expect(cashRecon(viewCashLines(s, tab(s, { resp: { v: ['คุณบี'] } }), T), '2569').open).toBe(160500);
    // without such a filter: the whole quotation, once, as before
    expect(viewCashLines(s, tab(s, {}), T)).toEqual(cashLines(s, filterDeals(s, tab(s, {}), T), T));
    expect(viewCashLines(s, tab(s, { section: { v: ['Event Exhibition'] } }), T).filter((l) => l.deal.id === 'h').map((l) => l.amt)).toEqual([642000, 642000]);
  });
  it('a line that is a part says of how many companies (the list and the CSV), so it is not read as the whole payment', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    const one = viewCashLines(s, tab(s, { resp: { v: ['คุณบี'] } }), T);
    // (and which: the units' split of the part goes to that company alone, lib/contrib lineParts)
    expect(one.map((l) => l.joint)).toEqual([{ members: 4, title: s.jqt!.h.title, part: 1, keep: ['b2'] }, { members: 4, title: s.jqt!.h.title, part: 1, keep: ['b2'] }]);
    // (the payer is the line's name, as the band's; the quotation, its companies and the part under it)
    expect(payerName(one[0], (x) => x)).toBe(PAYER);
    expect(jointLineWords(one[0], 'QT-2569-052')).toBe('ใบเสนอราคาร่วม QT-2569-052 · 4 บริษัท · ส่วนของ 1 บริษัท');
    const csv = cashRows(s, '2569', cashYear(one, '2569'), 'lines', true);
    expect(csv.rows[0][2]).toBe(`${PAYER} (ใบเสนอราคาร่วม 4 บริษัท · ส่วนของ 1 บริษัท)`);
    const whole = viewCashLines(s, tab(s, {}), T).find((l) => l.deal.id === 'h')!;
    expect(payerName(whole, (x) => x)).toBe(PAYER);
    expect(jointLineWords(whole)).toBe('ใบเสนอราคาร่วม · 4 บริษัท');
    expect(jointLineWords(cashLines(s, [s.deals.p1], T)[0] || { ...whole, joint: undefined })).toBe('');
  });
});

describe('review 2: the band says what of its money the view counts', () => {
  /** each band of a view, and the section's sum it sits in (tabs/Sales secSum) */
  const bands = (s: SalesState, f: Omit<SalesFilterIn, 'year'>) => {
    const F = normSalesFilter({ year: '2569', ...f }), list = filterDeals(s, F, T), attr = jointAttr(F);
    const { rows } = jointRows(s, list);
    return [...rows.values()].flat().flatMap((r) => {
      if (r.k !== 'band') return [];
      const held = [...(r.inList ? [r.g.head] : []), ...r.shown];
      return [{ r, bp: bandPart(s, r, attr), counted: moneySum(s, held, attr).fc }];
    });
  };
  const fc = 1284000;
  it('the whole with its header listed; the parts of the companies shown under a person filter; none when the view leaves its header out', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    const [a] = bands(s, {});
    expect([a.bp.whole, a.bp.none, a.bp.part(fc), a.counted]).toEqual([true, false, fc, fc]);
    // a search for one of its companies (or a quick view): the band shows, its money is not counted
    const [q] = bands(s, { q: 'บางกอก' });
    expect([q.r.inList, q.bp.whole, q.bp.none, q.bp.part(fc), q.counted]).toEqual([false, false, true, 0, 0]);
    // a person filter: that person's companies' part, what the section sums
    const [k] = bands(s, { resp: { v: ['คุณบี'] } });
    expect([k.bp.whole, k.bp.none, k.bp.part(fc), k.counted]).toEqual([false, false, 321000, 321000]);
    // every company shown (SOURCE of all four): the whole
    const [src] = bands(s, { source: { v: ['Event Exhibition'] } });
    expect([src.bp.whole, src.bp.part(fc), src.counted]).toEqual([true, fc, fc]);
    // its header listed under the filter but none of its companies: none
    s.deals.h.resp = 'ปลา';
    const [p] = bands(s, { resp: { v: ['ปลา'] } });
    expect([p.r.inList, p.r.shown.length, p.bp.none, p.counted]).toEqual([true, 0, true, 0]);
    // only a company that withdrew shown: none (it has no part)
    s.deals.h.resp = 'หมิว';
    s.steps['b4/CLOSED DEAL'] = { d: '2026-08-02', n: 'NO' };
    const [w] = bands(s, { resp: { v: ['คุณเอ'] } });
    expect([w.bp.none, w.counted]).toEqual([true, 0]);
  });
});

describe('the payer on top, the quotation under it (owner, Oct 2569)', () => {
  // "ใบเสนอราคารวม … ควรเขียนชื่อองค์กรที่จ้างไว้ด้านบน แล้วเอาชื่อใบเสนอราคาหรือเลขไว้ข้างล่าง"
  const KMUTNB = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ (สำนักงานใหญ่)';
  /** the owner's screenshot: QT2026060019, made as "CFP <payer>" for 11 companies, หมิว's */
  function eleven(o: { title?: string; no?: string; resp?: string } = {}) {
    const s = emptySales();
    s.deals.h = newDeal({ id: 'h', year: '2569', client: KMUTNB, resp: o.resp ?? 'หมิว' }, 'หมิว', '2026-06-01T03:00:00.000Z');
    s.jqt = { h: { title: o.title ?? 'CFP ' + KMUTNB, at: '2026-06-01T03:00:00.000Z', by: 'หมิว' } };
    s.jqm = {};
    for (let i = 1; i <= 11; i++) {
      s.deals['m' + i] = newDeal({ id: 'm' + i, year: '2569', client: 'บริษัท สมาชิก ' + i + ' จำกัด' }, 'หมิว', '2026-06-01T03:00:00.000Z');
      s.jqm['h/m' + i] = M({}, `2026-06-01T03:00:${String(i).padStart(2, '0')}.000Z`);
    }
    if (o.no !== '') s.docs['h/qt-h'] = qt('h', 1100000, { docNo: o.no ?? 'QT2026060019' });
    return { s, g: jointOf(s, { id: 'h' })! };
  }
  it('the band\'s two lines: the organisation that hires, then the number, its own name, the companies, the owner', () => {
    const { s, g } = eleven();
    const h = jointHead(s, g);
    expect(h.name).toBe(KMUTNB);
    expect(h.sub).toBe('ใบเสนอราคาร่วม QT2026060019 · CFP สำนักงานใหญ่ · 11 บริษัท · หมิว');
    // no "ผู้จ่าย …" under it: the payer is the line above
    expect(h.sub).not.toContain('ผู้จ่าย');
    expect(h.sub).not.toContain('มหาวิทยาลัย');
    // one line (a message, a control's label, the CSV): the payer first
    expect(jointLine(s, g)).toBe(`${KMUTNB} · ใบเสนอราคาร่วม QT2026060019`);
    expect(jointLine(s, g, true)).toBe(`${KMUTNB} · ใบเสนอราคาร่วม QT2026060019`);
  });
  it('the quotation\'s own name only when it says more than the payer; no number yet, no owner: left out', () => {
    // no title: the payer's name is not said twice
    const none = eleven({ title: '' });
    expect(jointHead(none.s, none.g).sub).toBe('ใบเสนอราคาร่วม QT2026060019 · 11 บริษัท · หมิว');
    // a title that is only the payer's name (its short name too)
    const same = eleven({ title: KMUTNB });
    expect(jointLabel(same.g)).toBe('');
    const co = eleven({ title: 'สยามฟู้ดส์ แปรรูป' });
    co.s.deals.h.client = 'บริษัท สยามฟู้ดส์ แปรรูป จำกัด';
    expect(jointLabel(jointOf(co.s, { id: 'h' })!)).toBe('');
    expect(jointLine(co.s, jointOf(co.s, { id: 'h' })!, true)).toBe('สยามฟู้ดส์ แปรรูป · ใบเสนอราคาร่วม QT2026060019');
    // the team's own words stay
    expect(jointLabel(eleven({ title: 'CFP รอบ 2' }).g)).toBe('CFP รอบ 2');
    // made without its file and no number typed: "ใบเสนอราคาร่วม" alone; no owner: none said
    const bare = eleven({ no: '', resp: '' });
    expect(jointHead(bare.s, bare.g)).toMatchObject({ qt: 'ใบเสนอราคาร่วม', sub: 'ใบเสนอราคาร่วม · CFP สำนักงานใหญ่ · 11 บริษัท' });
    expect(jointLine(bare.s, bare.g)).toBe(`${KMUTNB} · ใบเสนอราคาร่วม`);
  });
  it('found as before: by the payer and by the quotation\'s number, the band with all its companies', () => {
    const { s } = eleven();
    const ids = (q: string) => filterDeals(s, normSalesFilter({ year: '2569', q }), T).map((d) => d.id).sort();
    const every = ['h', ...Array.from({ length: 11 }, (_, i) => 'm' + (i + 1))].sort();
    expect(ids('QT2026060019')).toEqual(every);
    expect(ids('พระนครเหนือ')).toContain('h');
    const bands = [...jointRows(s, filterDeals(s, normSalesFilter({ year: '2569', q: 'พระนครเหนือ' }), T)).rows.values()].flat().filter((r) => r.k === 'band');
    expect(bands).toHaveLength(1);
  });
});

describe('review 2: the words', () => {
  it('the number of a joint quotation made without its file is the one typed (its header\'s QUOTATION note)', () => {
    const s = world();
    delete s.docs['h/qt-h'];
    s.steps['h/QUOTATION'] = { d: '2026-10-06', n: jointNote('QT-2569-099') };
    // (a company's QUOTATION may say something else: a note of its own it kept when it joined)
    s.steps['b1/QUOTATION'] = { d: '2026-10-06', n: 'ส่งทางอีเมลถึงคุณสมชาย' };
    const g = jointOf(s, { id: 'h' })!;
    expect(jointNo(s, g)).toBe('QT-2569-099');
    expect(jointHead(s, g).sub).toBe('ใบเสนอราคาร่วม QT-2569-099 · CFP มจพ · 4 บริษัท · หมิว');
    expect(memberLine(s, s.deals.b2, false)).toBe('อยู่ในใบเสนอราคาร่วม QT-2569-099 (มจพ) · ร่วมกับอีก 3 บริษัท');
    expect([noteNo('ใบเสนอราคาร่วม QT-2569-099'), noteNo('ใบเสนอราคาร่วม'), noteNo('ใบเสนอราคา QT-1 · 100 บาท')]).toEqual(['QT-2569-099', '', '']);
    // found by its number: the header and its companies, the money once
    const F = normSalesFilter({ year: '2569', q: 'QT-2569-099' });
    expect(filterDeals(s, F, T).map((d) => d.id).sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'h']);
    // a document's number wins once attached
    s.docs['h/qt-h'] = qt('h', 900000, { docNo: 'QT-2569-100' });
    expect(jointNo(s, jointOf(s, { id: 'h' })!)).toBe('QT-2569-100');
  });
  it('the dialog\'s line of a company: what joining does, then its หมวด and person ("ใช้แถวเดิม · Event Exhibition · คุณบี")', () => {
    const s = world();
    s.deals.x = newDeal({ id: 'x', client: 'ไทยเบฟ รีไซเคิล', year: '2569', section: 'Partner', resp: 'มกร' }, 'หมิว');
    expect(pickLine(s, { deal: 'b2' }, 'อื่นๆ', 'หมิว')).toBe('ใช้แถวเดิม · Event Exhibition · คุณบี');
    // a row with a job of its own: a new row in the joint quotation's หมวด, the person of that row
    expect(pickLine(s, { deal: 'x', like: 'x' }, 'Event Exhibition', 'หมิว')).toBe('เพิ่มแถวใหม่ · Event Exhibition · มกร');
    // a registry company or a name typed: who the new row gets
    expect(pickLine(s, {}, 'Event Exhibition', 'หมิว')).toBe('เพิ่มแถวใหม่ · Event Exhibition · หมิว');
    expect(pickLine(s, {}, '', 'หมิว')).toBe('เพิ่มแถวใหม่ · ไม่ระบุหมวด · หมิว');
  });
  it('a person\'s page: a member\'s part, never its own typed Forecast; a plain deal its figures; nothing without ดูยอดเงิน', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    expect(dealMoney(s, s.deals.b2).forecast).toBe(50000); // its own typed figure, ignored while a member
    expect(moneyWords(s, s.deals.b2, true)).toEqual(['ส่วนแบ่ง 321,000 ใน QT ร่วม']);
    expect(moneyWords(s, s.deals.b2, false)).toEqual([]);
    expect(moneyWords(s, s.deals.p1, true)).toEqual(['Forecast 100,000']);
    s.steps['b4/CLOSED DEAL'] = { d: '2026-08-02', n: 'NO' };
    expect(moneyWords(s, s.deals.b4, true)).toEqual(['ถอนตัวจาก QT ร่วม']);
  });
  it('a member\'s steps do not count the PAY the joint quotation pays ("ทำแล้ว 2 จาก 4"); a plain deal\'s all five; the payer\'s one per installment', () => {
    const s = world({ yes: true, plan: true, paid1: true });
    s.pays['h/PAY2'].rcv = '2026-10-11';
    s.steps['b1/CLOSED DEAL'] = { d: '2026-10-07', n: 'YES' };
    const t = stageTrack(s, s.deals.b1, T);
    expect([t.done, t.total]).toEqual([2, 4]);
    expect(nextStepView(s, s.deals.b1, T).kind).toBe('done');
    expect(stageTrack(s, s.deals.p1, T).total).toBe(5);
    expect(stageTrack(s, s.deals.h, T).total).toBe(6); // a plan of two installments: PAY1, PAY2
    // a PAY record a member wrote itself (an older build) shows, still not counted
    s.steps['b1/PAY1'] = { d: '2026-10-09', n: 'รับแล้ว' };
    expect(stageTrack(s, s.deals.b1, T).total).toBe(4);
    expect(dealSteps(s, s.deals.b1, T).steps.find((v) => v.id === 'PAY1')).toMatchObject({ state: 'done', counted: false, outside: 'joint' });
  });
});
