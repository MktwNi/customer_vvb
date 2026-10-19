/**
 * Service types on แผนติดต่อ (lib/svcType.ts): which of our services a company being contacted is about, read
 * from the Services of its Sales Tracker jobs, never stored. Mon 12 Oct 2569, tracker year 2569.
 */
import { describe, expect, it } from 'vitest';
import { custKey, dealKey, type CustLookup } from './custColor';
import { openJob, planRows, type PlanCo } from './planList';
import { emptySales, newDeal, type Deal, type SalesState } from './sales';
import {
  NO_TYPES, SVC_TYPES, activeType, byTypeOrder, chipTitle, custTypes, dealTypes, filterTypes, jobServices, mainType, monthTypes, onlyType, svcType,
  typeCounts, typeOfService, typeSel, typesOf, typesOfJobs, typesOfServices, type SvcTypeId,
} from './svcType';

const T = '2026-10-12', Y = '2569';
/** The register: 10 (with 11 merged into it), 20, 30, 40. */
const COS: PlanCo[] = [
  { id: 10, name: 'บริษัท ไทยพลาสติกรีไซเคิล จำกัด', phone: '' },
  { id: 20, name: 'บริษัท บางกอกสตีล เวิร์คส์ จำกัด', phone: '' },
  { id: 30, name: 'บริษัท อุดร ไบโอแมส จำกัด', phone: '' },
  { id: 40, name: 'บริษัท กรีนวัลเลย์ ฟู้ดส์ จำกัด', phone: '' },
];
const ALIAS = new Map([[11, 10]]);
const byId = new Map(COS.map((c) => [c.id, c]));
const company = (id: number) => byId.get(ALIAS.get(id) ?? id);
const E: CustLookup = { company, canonical: (id) => ALIAS.get(id) ?? id };

function deal(s: SalesState, id: string, p: Partial<Deal> = {}) {
  s.deals[id] = newDeal({ id, year: Y, section: 'TGO', order: Object.keys(s.deals).length, client: 'ลูกค้า ' + id, ...p }, 'หมิว', '2026-10-01T03:00:00.000Z');
  return s.deals[id];
}
/** The CLOSED DEAL result of a deal (YES won, NO lost). */
const result = (s: SalesState, id: string, r: 'YES' | 'NO') => (s.steps[`${id}/CLOSED DEAL`] = { d: '2026-10-05', n: r });
/** A joint quotation: header `hid` with these members. */
function joint(s: SalesState, hid: string, members: string[]) {
  s.jqt = { ...(s.jqt || {}), [hid]: { title: 'ใบเสนอราคาร่วม', at: '2026-10-02T00:00:00.000Z', by: 'หมิว' } };
  s.jqm = { ...(s.jqm || {}) };
  members.forEach((m, i) => (s.jqm![`${hid}/${m}`] = { share: null, pct: null, at: `2026-10-02T00:00:0${i}.000Z`, by: 'หมิว' }));
}
const open = (s: SalesState) => (d: Deal) => openJob(s, d, Y, T);
const map = (s: SalesState | null) => custTypes(s, (d) => dealKey(E, d), Y, s ? open(s) : () => false);
const ck = (id: number) => custKey(E, id, '');

describe('the service map (the customer types designed earlier)', () => {
  it('maps each service of the tracker to its type', () => {
    const want: Record<string, SvcTypeId> = { CFO: 'cfo', CF: 'cfo', CFP: 'cfp', LESS: 'con', 'Program Development': 'con', VVB: 'vvb', GCT: 'plt', 'T-VER': 'tvr', CC: 'tvr' };
    for (const [s, t] of Object.entries(want)) expect(typeOfService(s)).toBe(t);
  });
  it('counts a service no type lists as อื่นๆ (Course Training, CF-EVENT, a name an admin added)', () => {
    expect(typeOfService('Course Training')).toBe('oth');
    expect(typeOfService('CF-EVENT')).toBe('oth');
    expect(typeOfService('ESG Report')).toBe('oth');
    expect(svcType('oth').n).toBe('อื่นๆ');
  });
  it('ignores case and extra spaces, and skips an empty name', () => {
    expect(typeOfService(' cfo ')).toBe('cfo');
    expect(typeOfService('program  development')).toBe('con');
    expect(typeOfService('t-ver')).toBe('tvr');
    expect(typeOfService('')).toBeNull();
    expect(typeOfService('   ')).toBeNull();
  });
  it('lists the types of a job once each, in list order (CFO, CFP, ที่ปรึกษา, ทวนสอบ, แพลตฟอร์ม, T-VER, อื่นๆ)', () => {
    expect(typesOfServices(['T-VER', 'Course Training', 'VVB', 'CF', 'CFO', 'CC'])).toEqual(['cfo', 'vvb', 'tvr', 'oth']);
    expect(typesOfServices([])).toEqual([]);
    expect(SVC_TYPES.map((t) => t.n)).toEqual(['CFO', 'CFP', 'ที่ปรึกษา', 'ทวนสอบ', 'แพลตฟอร์ม', 'T-VER', 'อื่นๆ', 'ยังไม่ระบุประเภท']);
    expect((['oth', 'cfo', 'none', 'tvr'] as SvcTypeId[]).sort(byTypeOrder)).toEqual(['cfo', 'tvr', 'oth', 'none']);
  });
});

describe('the type colours', () => {
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const cr = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  it('are the six validated customer-type hues', () => {
    expect(SVC_TYPES.slice(0, 6).map((t) => [t.ink, t.tint, t.mark])).toEqual([
      ['#1E4BAF', '#EAF0FC', '#2F6BD6'], ['#056E64', '#E1F3F0', '#14A08C'], ['#6236A8', '#F1EBFA', '#7E57C9'],
      ['#952866', '#FAE9F2', '#B83686'], ['#00627A', '#DDF3F8', '#119CBC'], ['#2F6E2C', '#E7F3E5', '#3E8E2E'],
    ]);
  });
  it('write the word in ink ≥ 4.5:1 on its tint, and marks are ≥ 3:1 on white and all different', () => {
    for (const t of SVC_TYPES) {
      expect(cr(t.ink, t.tint)).toBeGreaterThanOrEqual(4.5);
      expect(cr(t.mark, '#FFFFFF')).toBeGreaterThanOrEqual(3);
      // the calendar's names are in ink on the tint
      expect(cr('#0E1430', t.tint)).toBeGreaterThanOrEqual(14);
    }
    expect(new Set(SVC_TYPES.map((t) => t.mark)).size).toBe(SVC_TYPES.length);
    // no status colour (late red, due amber, paid green) is a type's mark
    for (const st of ['#C4501A', '#B7791F', '#14833F']) expect(SVC_TYPES.some((t) => t.mark === st)).toBe(false);
  });
});

describe("a company's types, from the Services of its tracker jobs", () => {
  it('a company with jobs of several types has each, in list order (merged ids are one company)', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 10, service: ['VVB'] });
    deal(s, 'b', { gid: 11, service: ['CFO', 'CF'] });
    const m = map(s);
    expect(typesOf(m, ck(10)).types).toEqual(['cfo', 'vvb']);
    expect(typesOf(m, ck(11))).toBe(typesOf(m, ck(10)));
    expect(typesOf(m, ck(10)).why).toEqual({ cfo: ['CFO', 'CF'], vvb: ['VVB'] });
    expect(typesOf(m, ck(10)).from).toBe('open');
  });
  it('a job whose services map to no type is อื่นๆ; with a type too, both', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 20, service: ['Course Training'] });
    deal(s, 'b', { gid: 30, service: ['CF-EVENT', 'CFP'] });
    const m = map(s);
    expect(typesOf(m, ck(20)).types).toEqual(['oth']);
    expect(typesOf(m, ck(30)).types).toEqual(['cfp', 'oth']);
  });
  it('a company with no job (followed only), or whose jobs list no service, is ยังไม่ระบุประเภท', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 20, service: [] });
    const m = map(s);
    expect(typesOf(m, ck(40))).toBe(NO_TYPES);
    expect(typesOf(m, ck(20)).types).toEqual(['none']);
    expect(NO_TYPES.types).toEqual(['none']);
    // an account that does not see the tracker reads no type at all
    expect(map(null).size).toBe(0);
  });
  it('reads the open jobs of the tracker year first (what the company is being contacted about)', () => {
    const s = emptySales();
    deal(s, 'won', { gid: 10, service: ['VVB'], jobStatus: 'closed' });
    deal(s, 'lost', { gid: 10, service: ['GCT'] });
    result(s, 'lost', 'NO');
    deal(s, 'now', { gid: 10, service: ['CFP'] });
    expect(typesOf(map(s), ck(10))).toMatchObject({ types: ['cfp'], from: 'open', year: Y });
  });
  it('else any job of the tracker year, else the newest other year that names a type', () => {
    const s = emptySales();
    deal(s, 'closed', { gid: 10, service: ['VVB'], jobStatus: 'closed' });
    deal(s, 'old', { gid: 10, year: '2567', service: ['CFO'] });
    expect(typesOf(map(s), ck(10))).toMatchObject({ types: ['vvb'], from: 'year', year: Y });
    // no job this year: the newest year with Services; a year whose jobs list none is passed over
    const s2 = emptySales();
    deal(s2, 'y67', { gid: 20, year: '2567', service: ['CFO'] });
    deal(s2, 'y68', { gid: 20, year: '2568', service: ['T-VER'] });
    deal(s2, 'y68b', { gid: 20, year: '2568', service: ['LESS'] });
    deal(s2, 'y70', { gid: 20, year: '2570', service: [] });
    deal(s2, 'now', { gid: 20, service: [] });
    const ct = typesOf(map(s2), ck(20));
    expect(ct).toMatchObject({ types: ['con', 'tvr'], from: 'other', year: '2568' });
    expect(chipTitle('tvr', ct)).toBe('ประเภทบริการ T-VER · จาก Services T-VER ของงานปี 2568');
    expect(chipTitle('cfo', typesOf(map(s), ck(10)))).toBe('ประเภทบริการ CFO · คาร์บอนฟุตพริ้นท์องค์กร');
    expect(chipTitle('none')).toBe('ประเภทบริการ · ยังไม่ระบุประเภท · ยังไม่มีงานใน Sales Tracker หรืองานยังไม่ได้เลือก Services');
  });
  it('a client not linked to the register has the types of its jobs, by its name', () => {
    const s = emptySales();
    deal(s, 'a', { gid: null, client: 'บริษัท นครปฐม เปเปอร์ จำกัด', service: ['VVB'] });
    deal(s, 'b', { gid: null, client: '  บริษัท  นครปฐม เปเปอร์ จำกัด', service: ['GCT'] });
    const m = map(s);
    expect(typesOf(m, dealKey(E, s.deals.a)).types).toEqual(['vvb', 'plt']);
  });
  it("a joint quotation's members take the header's Services; the header is not a customer", () => {
    const s = emptySales();
    deal(s, 'h', { gid: 40, service: ['VVB', 'CFO'] });
    deal(s, 'm1', { gid: 10, service: [] });
    deal(s, 'm2', { gid: 20, service: ['CFP'] });
    deal(s, 'm3', { gid: 30, service: ['GCT'] });
    joint(s, 'h', ['m1', 'm2']);
    // m3 is in a joint quotation whose header lists nothing: its own
    deal(s, 'h2', { gid: 40, service: [] });
    joint(s, 'h2', ['m3']);
    expect(jobServices(s, s.deals.m1)).toEqual(['VVB', 'CFO']);
    const m = map(s);
    expect(typesOf(m, ck(10)).types).toEqual(['cfo', 'vvb']);
    expect(typesOf(m, ck(20)).types).toEqual(['cfo', 'vvb']);
    expect(typesOf(m, ck(30)).types).toEqual(['plt']);
    // the payer's own row is not a customer: its company has no job of its own here
    expect(typesOf(m, ck(40))).toBe(NO_TYPES);
    expect(typesOfJobs(s, [s.deals.h], Y, open(s))).toBe(NO_TYPES);
    // its installments are the quotation's: their type is its own Services
    expect(dealTypes(s, s.deals.h)).toMatchObject({ types: ['cfo', 'vvb'], from: 'deal' });
    expect(dealTypes(s, s.deals.h2)).toBe(NO_TYPES);
  });
  it('a row of the contact list reads the same types as its company in the calendar', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 11, service: ['T-VER'] });
    const rows = planRows({ company, watch: [10, 40], tasks: [], owners: {}, stages: {}, sales: s, year: Y, today: T });
    const m = map(s);
    const types = (r: (typeof rows)[number]) => typesOf(m, r.c ? custKey(E, r.c.id, r.c.name) : dealKey(E, r.jobs[0].deal)).types;
    expect(rows.map((r) => [r.key, types(r)])).toEqual([['c10', ['tvr']], ['c40', ['none']]]);
  });
});

describe('ประเภทบริการในเดือนนี้ (the calendar by type)', () => {
  const X = (date: string, c: string, types: SvcTypeId[]) => ({ date, ck: c, types });
  const E1 = [
    X('2026-10-09', '26', ['cfo', 'cfp']),
    X('2026-10-16', '26', ['cfo', 'cfp']),
    X('2026-10-12', '78', ['cfo']),
    X('2026-10-20', 'n:x', ['oth']),
    X('2026-10-21', '40', ['none']),
    X('2026-11-02', '78', ['vvb']),
  ];
  it('counts each type’s appointments and companies in the month, in list order (two types: under both)', () => {
    expect(monthTypes(E1, '2026-10')).toEqual([
      { id: 'cfo', n: 3, cos: 2 },
      { id: 'cfp', n: 2, cos: 1 },
      { id: 'oth', n: 1, cos: 1 },
      { id: 'none', n: 1, cos: 1 },
    ]);
    expect(monthTypes(E1, '2026-11')).toEqual([{ id: 'vvb', n: 1, cos: 1 }]);
    expect(monthTypes(E1, '2026-12')).toEqual([]);
    // a type listed twice on one entry counts once
    expect(monthTypes([X('2026-10-01', '1', ['cfo', 'cfo'])], '2026-10')).toEqual([{ id: 'cfo', n: 1, cos: 1 }]);
  });
  it('shows one type alone while an entry has it (any month), else everything', () => {
    expect(activeType('cfp', E1)).toBe('cfp');
    expect(onlyType(E1, 'cfp').map((x) => x.date)).toEqual(['2026-10-09', '2026-10-16']);
    expect(onlyType(E1, 'vvb')).toHaveLength(1);
    expect(onlyType(E1, '')).toHaveLength(E1.length);
    expect(activeType('plt', E1)).toBe('');
    expect(activeType('bogus', E1)).toBe('');
    expect(activeType('', E1)).toBe('');
  });
  it('colours an entry with several types by the type shown alone, else by its first', () => {
    expect(mainType(['cfo', 'cfp'])).toBe('cfo');
    expect(mainType(['cfo', 'cfp'], 'cfp')).toBe('cfp');
    expect(mainType(['cfo'], 'vvb')).toBe('cfo');
    expect(mainType([])).toBe('none');
  });
});

describe('the contact list’s ประเภทบริการ filter', () => {
  const R = [
    { k: 'a', t: ['cfo', 'vvb'] as SvcTypeId[] },
    { k: 'b', t: ['cfp'] as SvcTypeId[] },
    { k: 'c', t: ['oth'] as SvcTypeId[] },
    { k: 'd', t: ['none'] as SvcTypeId[] },
  ];
  const ty = (r: (typeof R)[number]) => r.t;
  it('keeps the rows with any type picked; nothing picked keeps every row', () => {
    expect(filterTypes(R, ['vvb'], ty).map((r) => r.k)).toEqual(['a']);
    expect(filterTypes(R, ['cfp', 'none'], ty).map((r) => r.k)).toEqual(['b', 'd']);
    expect(filterTypes(R, [], ty)).toHaveLength(4);
    // an unknown value (an older or crafted UI state) filters nothing
    expect(filterTypes(R, ['bogus'], ty)).toHaveLength(4);
  });
  it('counts the rows of each type (a row with two types under both)', () => {
    expect(typeCounts(R, ty)).toEqual({ cfo: 1, cfp: 1, con: 0, vvb: 1, plt: 0, tvr: 0, oth: 1, none: 1 });
    expect(typeCounts([], ty).cfo).toBe(0);
  });
  it('keeps only known type ids, each once, in list order', () => {
    expect(typeSel(['tvr', 'cfo', 'tvr', 'x', 3])).toEqual(['cfo', 'tvr']);
    expect(typeSel(undefined)).toEqual([]);
    expect(typeSel('cfo')).toEqual([]);
  });
});
