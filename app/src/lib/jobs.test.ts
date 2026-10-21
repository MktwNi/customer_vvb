/**
 * Several jobs of one company in a year (lib/jobs.ts): the two rules read from the services (the table's soft
 * "อาจซ้ำ", a send's "เพิ่มเป็นงานใหม่" / "อาจซ้ำ"), the words that tell two jobs apart, the filter "บริการ" and
 * the counts (rows stay rows, companies once).
 */
import { describe, expect, it } from 'vitest';
import {
  clashing, companyCount, dupRows, dupTitle, jobCoKey, maySame, named, otherJobs, repeats, rowPick, sendState, surelyOther, svcClean, svcCommon, svcShare, svcText, withSvc,
} from './jobs';
import { customersOf, emptySales, filterDeals, jobServices, listValues, newDeal, salesStats, workTally, type Deal, type DealDoc, type SalesState } from './sales';
import { jobName } from './salesUi';
import { liveCount, trackerFields } from './salesUi';

const Y = '2569';
function deal(s: SalesState, id: string, p: Partial<Deal> = {}) {
  s.deals[id] = newDeal({ id, year: Y, section: 'Retention', order: Object.keys(s.deals).length, client: 'บริษัท ทองมงคล จำกัด', gid: 8238, ...p }, 'หมิว', '2026-10-01T03:00:00.000Z');
  return s.deals[id];
}
let n = 0;
function quote(s: SalesState, deal: string, docNo: string) {
  const id = 'q' + ++n;
  const x: DealDoc = {
    id, deal, kind: 'quotation', name: 'qt.pdf', mime: 'application/pdf', size: 100 + n, fileId: '', docNo, docDate: '2026-10-02', amount: 100000, target: 'forecast',
    detected: 100000, basis: 'subtotal', stage: 'QUOTATION', at: `2026-10-02T00:00:0${n % 10}.000Z`, by: 'หมิว', cAt: `2026-10-02T00:00:0${n % 10}.000Z`,
  };
  s.docs[`${deal}/${id}`] = x;
  return x;
}
function joint(s: SalesState, hid: string, members: string[]) {
  s.jqt = { ...(s.jqt || {}), [hid]: { title: 'ใบเสนอราคาร่วม', at: '2026-10-02T00:00:00.000Z', by: 'หมิว' } };
  s.jqm = { ...(s.jqm || {}) };
  members.forEach((m, i) => (s.jqm![`${hid}/${m}`] = { share: null, pct: null, at: `2026-10-02T00:00:0${i}.000Z`, by: 'หมิว' }));
}
const ids = (m: Map<string, Deal[]>) => Object.fromEntries([...m].map(([k, v]) => [k, v.map((d) => d.id).sort()]));

describe('the services of two jobs', () => {
  it('compares services by name, ignoring case and spaces', () => {
    expect(svcShare(['CFO'], [' cfo '])).toBe(true);
    expect(svcShare(['CFO', 'LESS'], ['CFP', 'less'])).toBe(true);
    expect(svcShare(['CFO'], ['CFP'])).toBe(false);
    expect(svcShare([], ['CFP'])).toBe(false);
    expect(svcClean([' CFO', 'cfo', '', 'Program  Development', 'CFP'])).toEqual(['CFO', 'Program Development', 'CFP']);
    expect(svcCommon(['CFO', 'CFP'], ['cfp'])).toEqual(['CFP']);
    expect(named([' '])).toBe(false);
    expect(svcText(['CFO', 'CFP'])).toBe('CFO, CFP');
  });
  it('maySame (the table): CFO/CFO yes, CFO/CFP no, none/none yes, none/CFO no', () => {
    expect(maySame(['CFO'], ['CFO'])).toBe(true);
    expect(maySame(['CFO'], ['CFP'])).toBe(false);
    expect(maySame([], [])).toBe(true);
    expect(maySame([], ['CFO'])).toBe(false);
    expect(maySame(['CFO', 'LESS'], ['LESS'])).toBe(true);
  });
  it('surelyOther (a send, an import): only both named and disjoint', () => {
    expect(surelyOther(['CFP'], ['CFO'])).toBe(true);
    expect(surelyOther(['CFO'], ['CFO'])).toBe(false);
    expect(surelyOther([], ['CFO'])).toBe(false);
    expect(surelyOther(['CFP'], [])).toBe(false);
    expect(surelyOther([], [])).toBe(false);
  });
  it('names a job with its services where two jobs of one company must be told apart', () => {
    expect(withSvc('ทองมงคล', ['CFP'])).toBe('ทองมงคล · CFP');
    expect(withSvc('ทองมงคล', [])).toBe('ทองมงคล');
    const s = emptySales();
    expect(jobName(deal(s, 'a', { service: ['CFO', 'LESS'] }))).toBe('ทองมงคล · CFO, LESS');
    expect(jobName(deal(s, 'b'))).toBe('ทองมงคล');
  });
});

describe('a row of the send dialog', () => {
  it('no job this year: plain (sent as before)', () => {
    expect(sendState(['CFP'], [])).toBe('');
    expect(sendState([], [])).toBe('');
  });
  it('the owner\'s case: CFP picked, the company has a CFO job: a new job, ticked', () => {
    expect(sendState(['CFP'], [['CFO']])).toBe('new');
    expect(rowPick('new')).toEqual({ on: true, force: false });
  });
  it('CFO picked, it has a CFO job: may repeat it, not ticked', () => {
    expect(sendState(['CFO'], [['CFO']])).toBe('dup');
    expect(rowPick('dup')).toEqual({ on: false, force: false });
  });
  it('one of several jobs repeats: may repeat', () => {
    expect(sendState(['CFP'], [['CFO'], ['CFP', 'LESS']])).toBe('dup');
  });
  it('nothing picked (a prospecting send): every company with a job stays unticked', () => {
    expect(sendState([], [['CFO']])).toBe('dup');
  });
  it('a job without a service: nothing tells, not ticked', () => {
    expect(sendState(['CFP'], [[]])).toBe('dup');
  });
  it('the person\'s own tick wins; it is forced only when made while the row read อาจซ้ำ', () => {
    expect(rowPick('dup', { on: true, st: 'dup' })).toEqual({ on: true, force: true });
    expect(rowPick('new', { on: false, st: 'new' })).toEqual({ on: false, force: false });
    // ticked while new, a teammate's send made it a repeat since: kept ticked, not forced (the engine re-checks)
    expect(rowPick('dup', { on: true, st: 'new' })).toEqual({ on: true, force: false });
  });
  it('lists the jobs a send would repeat (a joint member by its header\'s services)', () => {
    const s = emptySales();
    const cfo = deal(s, 'cfo', { service: ['CFO'] });
    const h = deal(s, 'h', { service: ['CFP'], gid: 1 });
    const m = deal(s, 'm', { service: [] });
    joint(s, 'h', ['m']);
    expect(jobServices(s, m)).toEqual(['CFP']);
    expect(clashing(s, ['CFP'], [cfo, m]).map((d) => d.id)).toEqual(['m']);
    expect(clashing(s, [], [cfo, m]).map((d) => d.id)).toEqual(['cfo', 'm']);
    expect(h.id).toBe('h');
  });
});

describe('the table\'s soft "อาจซ้ำ"', () => {
  it('two rows of one company and one service in a year, or both without one; not CFO beside CFP', () => {
    const s = emptySales();
    deal(s, 'a', { service: ['CFO'] });
    deal(s, 'b', { service: ['CFO'] });
    deal(s, 'c', { service: ['CFP'] });
    deal(s, 'x', { gid: 26, client: 'ซากิโนมิยะ' });
    deal(s, 'y', { gid: 26, client: 'ซากิโนมิยะ' });
    // one side without a service: no tag (its "ยังไม่ระบุบริการ" asks for one)
    deal(s, 'p', { gid: 1200, service: ['CFO'] });
    deal(s, 'q', { gid: 1200 });
    expect(ids(dupRows(s, Object.values(s.deals)))).toEqual({ a: ['b'], b: ['a'], x: ['y'], y: ['x'] });
  });
  it('by the canonical company (merged ids), by name for a company without a link; never placeholder names', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 11, service: ['CFO'] });
    deal(s, 'b', { gid: 10, service: ['CFO'] });
    deal(s, 'n1', { gid: null, client: 'ร้าน ก', service: ['CFP'] });
    deal(s, 'n2', { gid: null, client: 'ร้าน  ก', service: ['CFP'] });
    deal(s, 'new1', { gid: null, client: 'ลูกค้าใหม่' });
    deal(s, 'new2', { gid: null, client: 'ลูกค้าใหม่' });
    expect(ids(dupRows(s, Object.values(s.deals), (g) => (g === 11 ? 10 : g)))).toEqual({ a: ['b'], b: ['a'], n1: ['n2'], n2: ['n1'] });
    expect(jobCoKey({ gid: null, client: 'ลูกค้าใหม่' })).toBe('');
  });
  it('other years and joint quotations are rows of their own', () => {
    const s = emptySales();
    deal(s, 'a', { service: ['CFO'] });
    deal(s, 'old', { service: ['CFO'], year: '2568' });
    deal(s, 'h', { service: ['CFO'] });
    deal(s, 'm', { service: ['CFO'] });
    joint(s, 'h', ['m']);
    expect(ids(dupRows(s, Object.values(s.deals)))).toEqual({});
  });
  it('clears once each row has its own quotation and they share no number; a shared number keeps it', () => {
    const s = emptySales();
    deal(s, 'a', { service: ['CFP'] });
    deal(s, 'b', { service: ['CFP'] });
    quote(s, 'a', 'QT-2569-001');
    expect(dupRows(s, Object.values(s.deals)).size).toBe(2);
    quote(s, 'b', 'QT-2569-002');
    expect(dupRows(s, Object.values(s.deals)).size).toBe(0);
    // the same quotation on both: one job entered twice
    quote(s, 'b', 'qt 2569/001');
    expect(dupRows(s, Object.values(s.deals)).size).toBe(2);
  });
  it('a quotation without a number still tells two rows apart (each its own document)', () => {
    const s = emptySales();
    deal(s, 'a', { service: ['T-VER'] });
    deal(s, 'b', { service: ['T-VER'] });
    quote(s, 'a', '');
    quote(s, 'b', '');
    expect(dupRows(s, Object.values(s.deals)).size).toBe(0);
  });
  it('says which service and what to do', () => {
    const s = emptySales();
    const a = deal(s, 'a', { service: ['CFO'] }), b = deal(s, 'b', { service: ['CFO', 'LESS'] });
    expect(dupTitle(a, [b])).toBe('มีงาน CFO ของบริษัทนี้ปี 2569 อีกแถว ถ้าเป็นงานเดียวกันให้ลบแถวที่เกิน ถ้าเป็นคนละงาน ป้ายจะหายเมื่อแต่ละแถวแนบใบเสนอราคาของตัวเอง');
    const c = deal(s, 'c'), d = deal(s, 'd');
    expect(dupTitle(c, [d])).toMatch(/^มีงานของบริษัทนี้ปี 2569 ที่ยังไม่ระบุบริการ อีกแถว/);
  });
});

describe('the company\'s other jobs (the deal panel)', () => {
  it('lists the year\'s other rows, open first, never a joint header; warns when a pick repeats one', () => {
    const s = emptySales();
    const a = deal(s, 'a', { service: ['CFP'] });
    const b = deal(s, 'b', { service: ['CFO'], jobStatus: 'closed' });
    deal(s, 'c', { service: ['LESS'] });
    deal(s, 'old', { service: ['CFO'], year: '2568' });
    deal(s, 'h', { service: ['GCT'] });
    joint(s, 'h', ['c']);
    const all = Object.values(s.deals);
    expect(otherJobs(s, a, all).map((d) => d.id)).toEqual(['c', 'b']);
    expect(repeats(s, ['CFO'], otherJobs(s, a, all)).map((d) => d.id)).toEqual(['b']);
    // a joint member is sold under its header's services
    expect(repeats(s, ['GCT'], otherJobs(s, a, all)).map((d) => d.id)).toEqual(['c']);
    expect(b.id).toBe('b');
  });
});

describe('counting with several jobs of one company', () => {
  const won = (s: SalesState, id: string) => (s.steps[`${id}/CLOSED DEAL`] = { d: '2026-10-05', n: 'YES' });
  const lost = (s: SalesState, id: string) => (s.steps[`${id}/CLOSED DEAL`] = { d: '2026-10-05', n: 'NO' });
  it('rows stay rows (ราย); the companies count once; win rate per job; workTally a company once, its jobs twice', () => {
    const s = emptySales();
    deal(s, 'cfo', { service: ['CFO'], jobStatus: 'closed' });
    deal(s, 'cfp', { service: ['CFP'], jobStatus: 'closed' });
    deal(s, 'less', { service: ['LESS'] });
    deal(s, 'other', { gid: 26, client: 'ซากิโนมิยะ', service: ['CFO'] });
    // a typed name of a linked company is that company
    deal(s, 'typed', { gid: null, client: 'บริษัท ทองมงคล จำกัด', service: ['VVB'] });
    won(s, 'cfo');
    won(s, 'cfp');
    lost(s, 'less');
    const all = Object.values(s.deals);
    expect(customersOf(s, all)).toHaveLength(5);
    expect(companyCount(s, all)).toBe(2);
    const t = workTally(s, all);
    expect(t.worked).toBe(1);
    expect(t.jobs).toBe(5);
    const st = salesStats(s, all, '2026-10-12');
    expect(st.total).toBe(5);
    expect(st.yes).toBe(2);
    expect(st.no).toBe(1);
    expect(st.winRate).toBe(67);
  });
  it('a joint quotation\'s header is not a company of its own', () => {
    const s = emptySales();
    deal(s, 'h', { gid: 1, client: 'ผู้จ่าย' });
    deal(s, 'm1', { gid: 2, client: 'สมาชิก 1' });
    deal(s, 'm2', { gid: 3, client: 'สมาชิก 2' });
    joint(s, 'h', ['m1', 'm2']);
    expect(companyCount(s, Object.values(s.deals))).toBe(2);
  });
});

describe('the filter บริการ', () => {
  it('reads a joint member\'s header services; ไม่ระบุ finds rows without one', () => {
    const s = emptySales();
    deal(s, 'h', { gid: 1, client: 'ผู้จ่าย', service: ['CFP'] });
    deal(s, 'm', { gid: 2, client: 'สมาชิก' });
    deal(s, 'a', { gid: 3, client: 'บริษัท ก', service: ['CFO'] });
    deal(s, 'z', { gid: 4, client: 'บริษัท ข' });
    joint(s, 'h', ['m']);
    expect(listValues(s.deals.m, 'service', s)).toEqual(['CFP']);
    expect(listValues(s.deals.m, 'service')).toEqual(['(ไม่ระบุ)']);
    const hit = (v: string) => filterDeals(s, { year: Y, service: { v: [v] } }, '2026-10-12').map((d) => d.id).sort();
    expect(hit('CFP')).toEqual(['h', 'm']);
    expect(hit('(ไม่ระบุ)')).toEqual(['z']);
    const f = trackerFields(s, { year: Y }, { yearDeals: Object.values(s.deals), job: 'open', me: '', today: '2026-10-12' });
    const svc = f.find((x) => x.key === 'service')!;
    expect(svc.label).toBe('บริการ');
    expect(svc.hint).toBe('บริการของงาน เช่น CFO CFP T-VER');
    // counts: customers (the header is not one), a member under its header's service
    expect(svc.options!.find((o) => o.v === 'CFP')!.n).toBe(1);
    expect(liveCount).toBeTypeOf('function');
  });
});
