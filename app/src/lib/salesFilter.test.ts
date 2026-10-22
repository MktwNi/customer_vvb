/**
 * The Sales Tracker's filters (filters spec §7–§8): list filters with คือ / ไม่ใช่, the date filter on each
 * basis, the money inside a range, the counts the filter row shows, and old filter shapes read safely.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actsOf, basisDates, dateMatch, emptySales, filterDeals, listMatch, newDeal, normSalesFilter, owedIn, quoteSent, receivedIn, withActIndex,
  type Deal, type DealAct, type DealDoc, type PayLine, type SalesState,
} from './sales';
import { liveCount, monthCounts, trackerFields, withoutDate } from './salesUi';

const T = '2026-10-12';
const deal = (p: Partial<Deal> = {}): Deal => newDeal({ id: p.id || 'd' + Math.random().toString(36).slice(2), client: 'บริษัท ' + (p.id || 'ก'), year: '2569', ...p }, 'me', p.at || '2026-09-01T03:00:00.000Z');
const state = (deals: Deal[], steps: Record<string, [string, string] | string> = {}, acts: DealAct[] = []): SalesState => ({
  ...emptySales(),
  deals: Object.fromEntries(deals.map((d) => [d.id, d])),
  steps: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, typeof v === 'string' ? { d: v, n: 'ok' } : { d: v[0], n: v[1] }])),
  acts: Object.fromEntries(acts.map((a) => [`${a.deal}/${a.id}`, a])),
});
const act = (deal: string, id: string, d: string, p: Partial<DealAct> = {}): DealAct => ({ id, deal, d, type: 'call', note: '', stage: '', pid: '', by: 'เอ', at: d + 'T03:00:00.000Z', ...p });
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '', ...p });
const doc = (p: Partial<DealDoc>): DealDoc => ({
  id: 'r', deal: 'x', kind: 'receipt', name: 'r.pdf', mime: 'application/pdf', size: 1, fileId: '', docNo: '', docDate: '', amount: 100, target: 'actual', detected: 100, basis: 'total', stage: 'PAY1', at: '2026-10-01T00:00:00.000Z', by: '', ...p,
});
const R = (from: string, to = from) => ({ from, to });
const ids = (ds: Deal[]) => ds.map((d) => d.id);
const WON: Record<string, [string, string]> = { 'CLOSED DEAL': ['2026-09-20', 'YES'] };
const wonSteps = (id: string) => Object.fromEntries(Object.entries(WON).map(([k, v]) => [`${id}/${k}`, v]));

const tz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Asia/Bangkok';
});
afterAll(() => {
  process.env.TZ = tz;
});

describe('old filter shapes are read safely', () => {
  it('a list as one string, empty values, the retired month and day', () => {
    expect(normSalesFilter({ year: '2569', resp: 'สมหญิง' }).resp).toEqual({ v: ['สมหญิง'] });
    expect(normSalesFilter({ year: '2569', resp: '' }).resp).toBeUndefined();
    expect(normSalesFilter({ year: '2569', source: { v: ['TGO', 'TGO'] } }).source).toEqual({ v: ['TGO'] });
    expect(normSalesFilter({ year: '2569', month: '10' }).date).toEqual({ basis: 'contact', preset: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(normSalesFilter({ year: '2569', month: '10', day: '05' }).date).toEqual({ basis: 'contact', preset: 'custom', from: '2026-10-05', to: '2026-10-05' });
    expect(normSalesFilter({ year: '2569', month: '02', day: '30' }).date).toBeUndefined();
    // a day off the calendar is dropped (it used to throw a RangeError inside filterDeals)
    for (const day of ['32', '00', '99']) expect(normSalesFilter({ year: '2569', month: '10', day }).date).toBeUndefined();
    expect(filterDeals(emptySales(), { year: '2569', month: '10', day: '32' }, '2026-10-12')).toEqual([]);
    expect(normSalesFilter({ year: '2569', day: '05' }).date).toBeUndefined();
    const out = normSalesFilter({ year: '2569', month: '10', day: '05' });
    expect('month' in out || 'day' in out).toBe(false);
  });
});

describe('the date filter, basis by basis', () => {
  it('contact: the typed date, a stage date and a contact record count, up to today; both ends included', () => {
    const a = deal({ id: 'a', contactDate: '2026-10-03' });
    const b = deal({ id: 'b' });
    const c = deal({ id: 'c' });
    const p = deal({ id: 'p' });
    const S = state([a, b, c, p], { 'b/CALL1': '2026-10-04', 'p/CALL1': '2026-10-13' }, [act('c', 'x1', '2026-10-05', { type: 'meet', stage: 'QUOTATION' })]);
    expect(ids(filterDeals(S, { year: '2569', date: { basis: 'contact', preset: 'custom', from: '2026-10-01', to: '2026-10-31' } }, T))).toEqual(['a', 'b', 'c']);
    // a call planned for tomorrow is not a contact yet
    expect(dateMatch(S, p, R('2026-10-13'), 'contact', T)).toBeNull();
    expect(dateMatch(S, b, R('2026-10-04'), 'contact', T)).toMatchObject({ d: '2026-10-04', what: 'CONTACT' }); // CALL1 read into CONTACT
    expect(dateMatch(S, c, R('2026-10-01', '2026-10-05'), 'contact', T)).toMatchObject({ d: '2026-10-05', what: 'นัดพบ · QUOTATION' });
    expect(dateMatch(S, a, R('2026-10-03', '2026-10-09'), 'contact', T)?.what).toBe('วันที่ติดต่อ');
    expect(dateMatch(S, a, R('2026-09-01', '2026-10-02'), 'contact', T)).toBeNull();
  });
  it('added: the local day it was added (not the UTC one)', () => {
    const d = deal({ id: 'n', at: '2026-09-30T18:00:00Z' });
    const S = state([d]);
    expect(basisDates(S, d, 'added', T)).toEqual([{ d: '2026-10-01', what: 'เพิ่มเข้าตาราง' }]);
    expect(dateMatch(S, d, R('2026-09-30'), 'added', T)).toBeNull();
  });
  it('result: a decided result only, with its tone', () => {
    const y = deal({ id: 'y' }), n = deal({ id: 'n' }), w = deal({ id: 'w' }), e = deal({ id: 'e' });
    const S = state([y, n, w, e], { 'y/CLOSED DEAL': ['2026-10-02', 'YES'], 'n/CLOSED DEAL': ['2026-10-03', 'NO'], 'w/CLOSED DEAL': ['2026-10-04', 'รอผู้บริหาร'], 'e/CALL1': '2026-10-04' });
    const oct = R('2026-10-01', '2026-10-31');
    expect(dateMatch(S, y, oct, 'result', T)).toMatchObject({ what: 'ได้งาน', tone: 'ok' });
    expect(dateMatch(S, n, oct, 'result', T)).toMatchObject({ what: 'ไม่ได้งาน', tone: 'bad' });
    expect(dateMatch(S, w, oct, 'result', T)).toBeNull();
    expect(dateMatch(S, e, oct, 'result', T)).toBeNull();
  });
  it('paid: when an installment came in; without a plan a PAY stage done up to today', () => {
    const x = deal({ id: 'x' }), y = deal({ id: 'y' }), z = deal({ id: 'z' });
    const S = state([x, y, z], { ...wonSteps('x'), ...wonSteps('y'), ...wonSteps('z'), 'y/PAY1': '2026-10-11', 'z/PAY1': '2026-10-13' });
    S.pays['x/PAY1'] = L({ amt: 50000, due: '2026-10-01', rcv: '2026-10-05', got: 50000 });
    S.pays['x/PAY2'] = L({ amt: 50000, due: '2026-11-01' });
    expect(dateMatch(S, x, R('2026-10-01', '2026-10-31'), 'paid', T)).toMatchObject({ d: '2026-10-05', what: 'PAY1 · 50,000', amt: 50000, tone: 'ok' });
    expect(dateMatch(S, y, R('2026-10-11'), 'paid', T)).toMatchObject({ what: 'PAY' }); // a single installment: PAY
    expect(dateMatch(S, z, R('2026-10-01', '2026-10-31'), 'paid', T)).toBeNull(); // dated tomorrow: planned, not paid
  });
  it('due: the plan\'s due dates (not a lost deal\'s); the earliest one still owed; late is bad, paid is ok', () => {
    const x = deal({ id: 'x' }), lost = deal({ id: 'l' });
    const S = state([x, lost], { ...wonSteps('x'), 'l/CLOSED DEAL': ['2026-09-20', 'NO'] });
    S.pays['x/PAY1'] = L({ amt: 30000, due: '2026-10-02', rcv: '2026-10-02', got: 30000 });
    S.pays['x/PAY2'] = L({ amt: 40000, due: '2026-10-05' });
    S.pays['x/PAY3'] = L({ amt: 50000, due: '2026-10-20' });
    S.pays['l/PAY1'] = L({ amt: 10000, due: '2026-10-10' });
    const oct = R('2026-10-01', '2026-10-31');
    const m = dateMatch(S, x, oct, 'due', T)!;
    expect(m).toMatchObject({ d: '2026-10-05', what: 'PAY2 · 40,000', owed: true, tone: 'bad' });
    expect(basisDates(S, x, 'due', T).find((b) => b.d === '2026-10-02')).toMatchObject({ tone: 'ok', owed: false });
    expect(dateMatch(S, x, R('2026-10-02'), 'due', T)).toMatchObject({ what: 'PAY1 · 30,000', tone: 'ok' });
    expect(dateMatch(S, lost, oct, 'due', T)).toBeNull();
    expect(owedIn(S, [x, lost], oct, T)).toBe(90000);
    expect(owedIn(S, [x], R('2026-10-15', '2026-10-31'), T)).toBe(50000);
  });
  it('closed: the day it was closed', () => {
    const d = deal({ id: 'c', jobStatus: 'closed', closedDate: '2026-10-09' });
    const S = state([d]);
    expect(dateMatch(S, d, R('2026-10-09'), 'closed', T)).toMatchObject({ what: 'ปิดงาน' });
    expect(dateMatch(S, d, R('2026-10-10', '2026-10-31'), 'closed', T)).toBeNull();
  });
});

describe('money inside a range', () => {
  it('a plan, Actual documents, a typed Actual', () => {
    const p = deal({ id: 'p' }), d = deal({ id: 'x' }), t = deal({ id: 't', actual: 7000 }), none = deal({ id: 'n' });
    const S = state([p, d, t, none], { ...wonSteps('p'), ...wonSteps('x'), ...wonSteps('t'), 'x/PAY1': '2026-10-03', 't/PAY1': '2026-10-04', 't/PAY2': '2026-09-01' });
    S.pays['p/PAY1'] = L({ amt: 10000, rcv: '2026-10-06', got: 10000 });
    S.pays['p/PAY2'] = L({ amt: 10000, rcv: '2026-11-06', got: 10000 });
    S.docs['x/r1'] = doc({ id: 'r1', deal: 'x', amount: 2000, stage: 'PAY1' });
    S.docs['x/r2'] = doc({ id: 'r2', deal: 'x', amount: 500, stage: '', docDate: '2026-10-20' });
    S.docs['x/r3'] = doc({ id: 'r3', deal: 'x', amount: 900, stage: '', docDate: '2026-09-20' });
    const oct = R('2026-10-01', '2026-10-31');
    // 10,000 (plan) + 2,000 (PAY1 on its stage date) + 500 (its document date) + 7,000 (typed, latest PAY 4 Oct)
    expect(receivedIn(S, [p, d, t, none], oct, T)).toBe(19500);
    expect(receivedIn(S, [t], R('2026-09-01', '2026-09-30'), T)).toBe(0); // the typed Actual counts once, on its latest PAY
  });
});

describe('list filters', () => {
  const a = deal({ id: 'a', resp: 'เอ', source: ['TGO', 'SET/mai'], section: 'TGO' });
  const b = deal({ id: 'b', resp: 'บี', source: ['Partner'], section: 'Partner' });
  const c = deal({ id: 'c', resp: '', source: [], section: '' });
  it('OR inside a field, AND across fields, ไม่ใช่, empty values as ไม่ระบุ', () => {
    expect(listMatch(a, 'source', { v: ['SET/mai', 'Partner'] })).toBe(true);
    expect(listMatch(c, 'source', { v: ['(ไม่ระบุ)'] })).toBe(true);
    expect(listMatch(c, 'resp', { v: ['(ไม่ระบุ)'] })).toBe(true);
    expect(listMatch(a, 'resp', { v: ['เอ'], not: true })).toBe(false);
    const S = state([a, b, c]);
    expect(ids(filterDeals(S, { year: '2569', source: { v: ['TGO', 'Partner'] } }, T)).sort()).toEqual(['a', 'b']);
    expect(ids(filterDeals(S, { year: '2569', source: { v: ['TGO', 'Partner'] }, resp: { v: ['บี'] } }, T))).toEqual(['b']);
    expect(ids(filterDeals(S, { year: '2569', resp: { v: ['เอ', 'บี'], not: true } }, T))).toEqual(['c']);
    expect(ids(filterDeals(S, { year: '2569', section: { v: ['(ไม่ระบุ)'] } }, T))).toEqual(['c']);
  });
  it('date, lists, a quick view and the search together; the order stays the sections\' order', () => {
    const x = deal({ id: 'x', resp: 'เอ', section: 'TGO', client: 'ไทยพลาสติก', contactDate: '2026-10-02' });
    const y = deal({ id: 'y', resp: 'เอ', section: 'Retention', client: 'ไทยเคมี', contactDate: '2026-10-03' });
    const z = deal({ id: 'z', resp: 'เอ', section: 'Retention', client: 'ไทยเหล็ก', contactDate: '2026-09-03' });
    const S = state([x, y, z], { 'x/CALL1': '2026-10-02', 'y/CALL1': '2026-10-03' });
    const f = { year: '2569', resp: { v: ['เอ'] }, q: 'ไทย', quick: 'active' as const, date: { basis: 'contact' as const, preset: 'month' as const, from: '', to: '' } };
    expect(ids(filterDeals(S, f, T))).toEqual(['y', 'x']); // Retention before TGO
  });
});

describe('counts in the filter row', () => {
  it('an option\'s count ignores its own field and keeps every other filter and the quick view', () => {
    const ds = [
      deal({ id: '1', resp: 'เอ', source: ['TGO'] }),
      deal({ id: '2', resp: 'บี', source: ['TGO'] }),
      deal({ id: '3', resp: 'บี', source: ['Partner'] }),
      deal({ id: '4', resp: 'บี', source: ['TGO'], jobStatus: 'closed', closedDate: '2026-10-01' }),
    ];
    const S = state(ds, { '1/CALL1': '2026-10-01', '2/CALL1': '2026-10-01' });
    const F = normSalesFilter({ year: '2569', resp: 'บี', source: 'TGO', quick: 'active' });
    const fields = trackerFields(S, F, { yearDeals: ds, job: 'open', me: 'บี', today: T });
    const resp = fields.find((f) => f.key === 'resp')!, src = fields.find((f) => f.key === 'source')!;
    expect(resp.options.map((o) => [o.v, o.n, o.sub])).toEqual([['บี', 1, 'ฉัน'], ['เอ', 1, undefined]]);
    expect(src.options.find((o) => o.v === 'TGO')!.n).toBe(1); // deal 2 (deal 3 is Partner, deal 4 closed, deal 1 not บี)
    expect(src.options.find((o) => o.v === 'Partner')!.n).toBe(0); // deal 3 has not started: not in กำลังติดตาม
    expect(liveCount(S, F, 'resp', null, 'open', T)).toBe(2);
    expect(liveCount(S, F, 'resp', { v: ['เอ'] }, 'closed', T)).toBe(0);
    expect(trackerFields(S, F, { yearDeals: ds, job: 'open', me: '', today: T, dash: true }).some((f) => f.key === 'result')).toBe(false);
  });
  it('months of the year with a date of the basis', () => {
    const ds = [deal({ id: '1', contactDate: '2026-02-03' }), deal({ id: '2', contactDate: '2026-10-03' }), deal({ id: '3' })];
    const S = state(ds, { '2/CALL1': '2026-02-10', '3/CALL1': '2026-12-01' });
    const F = normSalesFilter({ year: '2569', date: { basis: 'contact', preset: 'custom', from: '2026-10-01', to: '2026-10-31' } });
    const m = monthCounts(S, F, 'contact', 2026, 'open', T);
    expect(m[1]).toBe(2); // ก.พ.: deals 1 and 2 (the date filter itself is off)
    expect(m[9]).toBe(1);
    expect(m[11]).toBe(0); // December is after today
  });
});

describe('one pass over many deals', () => {
  it('reads contact records from an index made for that call only (the engine edits them in place)', () => {
    const ds = [deal({ id: 'a' }), deal({ id: 'b' })];
    const S = state(ds, {}, [act('a', 'x1', '2026-10-01'), act('a', 'x2', '2026-10-05'), act('b', 'y1', '2026-09-20')]);
    const plain = actsOf(S, 'a').map((x) => x.id);
    expect(plain).toEqual(['x2', 'x1']); // newest first
    expect(withActIndex(S, () => actsOf(S, 'a').map((x) => x.id))).toEqual(plain);
    // a caller may change what it gets: the index keeps its own list
    withActIndex(S, () => {
      actsOf(S, 'a').pop();
      expect(actsOf(S, 'a')).toHaveLength(2);
      expect(withActIndex(S, () => actsOf(S, 'b')).map((x) => x.id)).toEqual(['y1']); // nested: the same index
    });
    // after the call a record added in place is seen at once
    S.acts!['b/y2'] = act('b', 'y2', '2026-10-08');
    expect(actsOf(S, 'b').map((x) => x.id)).toEqual(['y2', 'y1']);
    const F = { year: '2569', date: { basis: 'contact' as const, preset: 'custom' as const, from: '2026-10-06', to: '2026-10-10' } };
    expect(ids(filterDeals(S, F, T))).toEqual(['b']);
    // a throw inside the pass does not leave the index behind
    expect(() => withActIndex(S, () => { throw new Error('x'); })).toThrow('x');
    delete S.acts!['b/y2'];
    expect(ids(filterDeals(S, F, T))).toEqual([]);
  });
});

describe('another year of the tracker', () => {
  it('drops the date range and keeps the other filters', () => {
    const f = { quick: 'active' as const, resp: { v: ['เอ'] }, date: { basis: 'contact' as const, preset: 'month' as const, from: '2026-10-01', to: '2026-10-31' } };
    expect(withoutDate(f)).toEqual({ quick: 'active', resp: { v: ['เอ'] } });
    const none: { quick: string; date?: unknown } = { quick: 'active' };
    expect(withoutDate(none)).toBe(none);
    expect(withoutDate({ date: null, q: 'x' })).toEqual({ date: null, q: 'x' });
  });
});

describe('ใบเสนอราคา: ส่งแล้ว or ยังไม่ส่ง', () => {
  // the rule: the QUOTATION step done (recorded, not planned ahead of today), or a quotation document attached
  it('a QUOTATION step recorded (a date, or a note alone) is sent; a planned one is not; a quotation attached is; an invoice or a receipt is not', () => {
    const ds = [deal({ id: 'a' }), deal({ id: 'b' }), deal({ id: 'c' }), deal({ id: 'e' }), deal({ id: 'f' }), deal({ id: 'g' })];
    const S = state(ds, { 'a/QUOTATION': '2026-10-05', 'b/QUOTATION': '2026-10-20' });
    S.steps['e/QUOTATION'] = { d: '', n: 'ส่งทางอีเมลแล้ว' };
    S.docs = {
      q: doc({ id: 'q', deal: 'c', kind: 'quotation', stage: 'QUOTATION', target: 'forecast' }),
      i: doc({ id: 'i', deal: 'f', kind: 'invoice', stage: 'PAY1', target: 'actual' }),
      r: doc({ id: 'r', deal: 'g', kind: 'receipt', stage: 'PAY1', target: 'actual' }),
    };
    const sent = (id: string) => quoteSent(S, { id }, T);
    expect(['a', 'b', 'c', 'e', 'f', 'g'].map(sent)).toEqual([true, false, true, true, false, false]);
    // the same rule through the filter: each value is its own set, and together they are every deal
    const sentIds = ids(filterDeals(S, normSalesFilter({ year: '2569', quote: 'sent' }), T));
    const unsentIds = ids(filterDeals(S, normSalesFilter({ year: '2569', quote: 'unsent' }), T));
    expect(sentIds.sort()).toEqual(['a', 'c', 'e']);
    expect(unsentIds.sort()).toEqual(['b', 'f', 'g']);
    expect(ids(filterDeals(S, normSalesFilter({ year: '2569' }), T)).length).toBe(6);
  });

  it('the filter keeps a known value and drops any other', () => {
    expect(normSalesFilter({ year: '2569', quote: 'sent' }).quote).toBe('sent');
    expect(normSalesFilter({ year: '2569', quote: 'unsent' }).quote).toBe('unsent');
    expect(normSalesFilter({ year: '2569', quote: 'x' as never }).quote).toBeUndefined();
    expect(normSalesFilter({ year: '2569', quote: '' }).quote).toBeUndefined();
  });

  it('combined with the year, a person and a result: the rows are the ones every filter lets through', () => {
    const ds = [
      deal({ id: 'a', resp: 'หมิว' }), // sent (QUOTATION done), won
      deal({ id: 'c', resp: 'หมิว' }), // sent (a quotation attached), not won yet
      deal({ id: 'b', resp: 'ปลา' }), // sent, won, another person
      deal({ id: 'd', resp: 'หมิว' }), // not sent, won
      deal({ id: 'x', resp: 'หมิว', year: '2570' }), // another year
    ];
    const S = state(ds, { 'a/QUOTATION': '2026-10-05', 'b/QUOTATION': '2026-10-05', 'x/QUOTATION': '2026-10-05', 'a/CLOSED DEAL': ['2026-10-06', 'YES'], 'b/CLOSED DEAL': ['2026-10-06', 'YES'], 'd/CLOSED DEAL': ['2026-10-06', 'YES'] });
    S.docs = { q: doc({ id: 'q', deal: 'c', kind: 'quotation', stage: 'QUOTATION', target: 'forecast' }) };
    const F = normSalesFilter({ year: '2569', quote: 'sent', resp: 'หมิว', result: 'YES' });
    expect(ids(filterDeals(S, F, T))).toEqual(['a']);
    // without the result: the sent ones of หมิว (a, c); the other year never counts
    expect(ids(filterDeals(S, normSalesFilter({ year: '2569', quote: 'sent', resp: 'หมิว' }), T)).sort()).toEqual(['a', 'c']);
    expect(ids(filterDeals(S, normSalesFilter({ year: '2569', quote: 'unsent', resp: 'หมิว' }), T))).toEqual(['d']);
  });

  it('the filter row shows the count of each choice: ทั้งหมด, ส่งแล้ว, ยังไม่ส่ง; the counts ignore the field itself and keep the other filters', () => {
    const ds = [deal({ id: 'a', resp: 'หมิว' }), deal({ id: 'b', resp: 'หมิว' }), deal({ id: 'c', resp: 'ปลา' })];
    const S = state(ds, { 'a/QUOTATION': '2026-10-05' });
    const F = normSalesFilter({ year: '2569', resp: 'หมิว' });
    const field = trackerFields(S, F, { yearDeals: ds, job: 'open', me: 'หมิว', today: T }).find((f) => f.key === 'quote')!;
    expect(field.kind).toBe('single');
    expect(field.all).toBe('ทั้งหมด');
    expect(field.options.map((o) => [o.v, o.label, o.n])).toEqual([['sent', 'ส่งแล้ว', 1], ['unsent', 'ยังไม่ส่ง', 1]]);
    expect(liveCount(S, F, 'quote', 'unsent', 'open', T)).toBe(1);
    // its own field is left out of its count: with ส่งแล้ว picked, the choices still count every deal of the year
    expect(liveCount(S, normSalesFilter({ year: '2569', quote: 'sent' }), 'quote', null, 'open', T)).toBe(3);
  });

  it('the Dashboard\'s row has no ใบเสนอราคา field (it reports the same deals as the table without this filter)', () => {
    const ds = [deal({ id: 'a' })];
    const fields = trackerFields(state(ds), normSalesFilter({ year: '2569' }), { yearDeals: ds, job: '', me: 'me', today: T, dash: true });
    expect(fields.some((f) => f.key === 'quote')).toBe(false);
  });
});
