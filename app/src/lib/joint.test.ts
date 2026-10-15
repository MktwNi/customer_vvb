/**
 * Joint quotations (package quotes, item 7): the roles a deal can have, the money counted once (on the
 * header) across the KPIs, the sections, the Dashboard, Cashflow and the closed tab, customers counted per
 * member, the header's money apportioned to the members' people by their parts (an equal split by default,
 * none for a company that withdrew), and the screens' helpers (lib/joint.ts). One demo world: the CFP of
 * มจพ for four companies (mockups 09–15), Mon 12 Oct 2569.
 */
import { describe, expect, it } from 'vitest';
import {
  apportion, cashKpis, cashLines, cashRecon, cashYear, closeReady, customersOf, dealMoney, emptySales, filterDeals, jointHeadOf, jointOf, jointParts, jointRole, jointSplit, jointWeights, moneyOwners,
  newDeal, overdueDays, payDue, payState, receivables, receivedIn, owedIn, salesStats, stageTrack, toJqm, toJqt,
  type Deal, type DealDoc, type JointMember, type PayLine, type SalesState,
} from './sales';
import {
  closeSummary, closedWord, isJointNote, jointNote, jointRows, jointShort, jointSub, jointTitle, memberLine, memberShares, parseShare, payerShort, pickParts, resultsWord, rowDeals, rowFate, rowMoneyDeals, shareOf, sharesCheck, sharesWord,
} from './joint';
import { closingView, liveCount, nextStepView, statusView } from './salesUi';
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

describe('a member follows up on its own row and is paid through the joint quotation', () => {
  it('its PAY stages are not its own; won, it waits for the payer and closes when the payer has paid', () => {
    const s = world({ yes: true, plan: true });
    s.steps['b2/CLOSED DEAL'] = { d: '2026-10-07', n: 'YES' };
    const b2 = s.deals.b2;
    const t = stageTrack(s, b2, T);
    expect([t.states.PAY1, t.states.PAY2, t.next]).toEqual(['off', 'off', '']);
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
  it('a member that withdrew closes alone; the header is not a customer to follow up', () => {
    const s = world();
    s.steps['b4/CLOSED DEAL'] = { d: '2026-08-02', n: 'NO' };
    expect(closeReady(s, s.deals.b4, T)).toBe(true);
    expect(overdueDays(s, s.deals.h, '2026-12-31')).toBeNull();
    expect(overdueDays(s, s.deals.b1, '2026-12-31')).not.toBeNull();
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
  it('the dialog\'s parts: baht or %, an empty one an equal split, the sum against the total', () => {
    expect(parseShare('321,000')).toEqual({ share: 321000, pct: null });
    expect(parseShare(' 25 %')).toEqual({ share: null, pct: 25 });
    expect(parseShare('')).toEqual({ share: null, pct: null });
    expect(parseShare('สามแสน')).toBeUndefined();
    expect(parseShare('120%')).toBeUndefined();
    expect(pickParts([{ share: 500000, pct: null }, { share: null, pct: null }], 1284000)).toEqual([500000, 784000]);
    expect(pickParts([{ share: null, pct: 30 }, { share: null, pct: null }, { share: null, pct: null }], 1000)).toEqual([300, 350, 350]);
    expect(sharesCheck([321000, 321000, 321000, 321000], 1284000)).toEqual({ text: 'รวม 1,284,000 · เท่ากับยอดใบเสนอราคา', warn: false });
    expect(sharesCheck([321000, 321000], 1284000)).toEqual({ text: 'รวม 642,000 · น้อยกว่ายอดใบเสนอราคา 642,000', warn: true });
  });
  it('names: the band, the short title, the payer, a member\'s line; the note it writes and recognises', () => {
    const s = world(), g = jointOf(s, { id: 'h' })!;
    expect(jointShort(g)).toBe('CFP มจพ');
    expect(payerShort(g)).toBe('มจพ');
    expect(jointTitle(s, g)).toBe('ใบเสนอราคาร่วม QT-2569-052 · CFP มจพ');
    expect(jointSub(g)).toBe(`4 บริษัท · ผู้จ่าย ${PAYER} · หมิว`);
    expect(memberLine(s, s.deals.b2, true)).toBe('อยู่ในใบเสนอราคาร่วม QT-2569-052 (มจพ) · ร่วมกับอีก 3 บริษัท · ส่วนแบ่ง 321,000 (25%)');
    expect(memberLine(s, s.deals.b2, false)).toBe('อยู่ในใบเสนอราคาร่วม QT-2569-052 (มจพ) · ร่วมกับอีก 3 บริษัท');
    expect(shareOf(s, s.deals.b2)).toMatchObject({ amt: 321000, pct: 25 });
    expect(shareOf(s, s.deals.p1)).toBeNull();
    expect([isJointNote('ใบเสนอราคาร่วม QT-2569-052'), isJointNote('ใบเสนอราคาร่วม'), isJointNote('ส่งใบเสนอราคาร่วมทางอีเมลแล้ว')]).toEqual([true, true, false]);
    expect(jointShort({ head: s.deals.h, qt: { title: '', at: '', by: '' } })).toBe(PAYER);
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
