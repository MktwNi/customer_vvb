/**
 * Units, % contribution and commission (package dash, lib/contrib.ts; dash impl-note §5): the staff key, a
 * deal's default and saved split, the 100% rule, effective-dated rates and rates by service, commission on
 * money received (cashLines), the quarter split, the joint-quotation hook, the หน่วยงาน filter, and the sync
 * of the three record kinds (a role without ดูค่าคอมมิชชั่น receives no split and no rates).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyUnitRow, apportioned, commPeriod0, commRows, contribIn, dealGot, dealUnits, equalSplit, freeSlot, hadRate, howRow, membersOf, newUnitId, paysComm, periodRange, rateMode, rateOn, rateParts, rateText, retiredOn, retiredSince,
  setPartsHook, shareOf, shareSum, shareValid, slotTaken, splitSatang, staffKey, toShare, toUnit, toUnitMember, unassigned, unitCtx, unitOfName, unitQuarters, unitRecords, unitsOf, withOff, withRate, type ShareRec, type UnitMember,
  type UnitRec,
} from './contrib';
import { nameKey } from './ckey';
import { cashLines, cashYear, emptySales, filterDeals, jointPartsOf, newDeal, type Deal, type PayLine, type SalesState } from './sales';
import { trackerFields } from './salesUi';
import { applyRow, keyOf, localRecords, noEffects, rebaseOp, type SharedState } from './teamSync';

const T = '2026-10-12';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '', ...p });
const YES = (d: string): Record<string, [string, string]> => ({ 'CLOSED DEAL': [d, 'YES'] });
function world(spec: Record<string, { d?: Partial<Deal>; steps?: Record<string, [string, string]>; pays?: Record<string, Partial<PayLine>> }>): SalesState {
  const s = emptySales();
  for (const [id, x] of Object.entries(spec)) {
    s.deals[id] = newDeal({ id, client: 'บริษัท ' + id, year: '2569', ...x.d }, 'A', '2026-01-05T03:00:00.000Z');
    Object.entries(x.steps || {}).forEach(([p, [d, n]]) => (s.steps[`${id}/${p}`] = { d, n }));
    Object.entries(x.pays || {}).forEach(([p, v]) => (s.pays[`${id}/${p}`] = L(v)));
  }
  return s;
}
const U = (n: string, c: number, rates: UnitRec['rates'], o = 0, off?: boolean): UnitRec => ({ n, c, o, rates, ...(off ? { off: true } : {}), at: '2026-07-01T00:00:00.000Z', by: 'หมิว' });
const M = (unit: string, n: string): UnitMember => ({ unit, n, at: '', by: 'หมิว' });
const SH = (lines: [string, number][]): ShareRec => ({ lines: lines.map(([u, p]) => ({ u, p })), at: '2026-09-04T03:00:00.000Z', by: 'หมิว' });

/** The units of the mockups (07): sales 5%, consulting 3%, verification 3% (VVB 5%), platform 2%, two without commission. */
function withUnits(s: SalesState) {
  s.units = {
    sale: U('ฝ่ายขาย', 1, [{ from: '', r: 5 }], 0),
    cons: U('ฝ่ายที่ปรึกษา', 2, [{ from: '', r: 3 }], 1),
    ver: U('ฝ่ายทวนสอบ', 3, [{ from: '', r: 3, svc: { VVB: 5 } }], 2),
    plat: U('ฝ่ายแพลตฟอร์ม', 4, [{ from: '', r: 2 }], 3),
    exec: U('ผู้บริหาร', 0, [{ from: '', r: null }], 4),
    acct: U('ฝ่ายบัญชี', 0, [{ from: '', r: null }], 5),
  };
  s.unitm = {};
  for (const [unit, names] of Object.entries({ sale: ['หมิว', 'มินท์', 'เอก'], cons: ['มกร'], ver: ['คุณบี'], plat: ['คุณเอ'], exec: ['ต้น'], acct: ['ฝน'] }))
    names.forEach((n) => (s.unitm![staffKey(n)] = M(unit, n)));
  s.shares = {};
  return s;
}
/** The mockups' demo world (Mon 12 Oct 2569), as in cashflow.test.ts, with the units above. */
function demo(): SalesState {
  return withUnits(
    world({
      c1: { d: { client: 'อมตะ คอร์ปอเรชัน', jobStatus: 'closed', closedDate: '2026-08-20', forecast: 240000, resp: 'ปลา', section: 'TGO' }, steps: YES('2026-06-10'), pays: { PAY1: { amt: 120000, due: '2026-06-30', rcv: '2026-06-30' }, PAY2: { amt: 120000, due: '2026-08-15', rcv: '2026-08-15' } } },
      c2: { d: { client: 'พฤกษา โฮลดิ้ง', jobStatus: 'closed', closedDate: '2026-10-06', forecast: 180000, actual: 180000, resp: 'คุณเอ' }, steps: { ...YES('2026-08-28'), PAY1: ['2026-09-25', 'รับงวด 1'], PAY2: ['2026-10-05', 'รับงวด 2'] } },
      c4: { d: { client: 'ดับบลิวเอชเอ', jobStatus: 'closed', closedDate: '2026-04-30', forecast: 95000, actual: 95000, resp: 'หมิว' }, steps: { ...YES('2026-03-12'), PAY1: ['2026-04-20', 'รับครบ'] } },
      w1: { d: { client: 'แสนสิริ กรีน พร็อพเพอร์ตี้', forecast: 214000, resp: 'หมิว', service: ['CFP'] }, steps: YES('2026-09-04'), pays: { PAY1: { amt: 107000, due: '2026-09-20', rcv: '2026-09-19' }, PAY2: { amt: 107000, due: '2026-10-20' } } },
      w2: { d: { client: 'ไทยออยล์ เอนเนอร์ยี่', forecast: 160500, resp: 'คุณเอ' }, steps: YES('2026-10-03'), pays: { PAY1: { amt: 80250, due: '2026-10-08' }, PAY2: { amt: 80250, due: '2026-11-15' } } },
      demo3: { d: { client: 'คงธนา เซอร์วิส', forecast: 250000, actual: 125000, resp: 'มกร' }, steps: { ...YES('2026-09-27'), PAY1: ['2026-10-06', 'รับงวดที่ 1 แล้ว'] } },
    }),
  );
}
const lines = (s: SalesState) => cashLines(s, Object.values(s.deals), T);
const Q3 = periodRange('2569', 2);

// (a test may set its own parts hook: the app's, sales.ts jointPartsOf, comes back after it)
afterEach(() => setPartsHook(jointPartsOf));

describe('staffKey: a staff name, not a company name', () => {
  it('keeps two-letter Thai nicknames (ฝน, บี) that the customer key drops', () => {
    expect(staffKey('ฝน')).toBe('ฝน');
    expect(staffKey('บี')).toBe('บี');
    expect(staffKey('ฝน')).not.toBe(staffKey('บี'));
    expect(nameKey('ฝน')).toBe(''); // why the customer key is not used for staff
  });
  it('trims, collapses spaces, lower-cases; "คุณบี" and "บี" stay two people; "/" or empty gives none', () => {
    expect(staffKey(' หมิว ')).toBe('หมิว');
    expect(staffKey('Ann   Lee')).toBe(staffKey('ann lee'));
    expect(staffKey('คุณบี')).not.toBe(staffKey('บี'));
    expect(staffKey('เอ/บี')).toBe('');
    expect(staffKey('   ')).toBe('');
    expect(staffKey(null)).toBe('');
    expect(staffKey('ก'.repeat(61))).toBe('');
    // NFC: the same name typed with a decomposed accent is one key
    expect(staffKey('René')).toBe(staffKey('René'));
  });
});

describe('who is in which unit', () => {
  const s = demo(), ctx = unitCtx(s);
  it('a name finds its unit by staffKey; no record, or a unit that is gone, is ยังไม่ระบุหน่วยงาน', () => {
    expect(unitOfName(ctx, 'หมิว ')).toBe('sale');
    expect(unitOfName(ctx, 'ฝน')).toBe('acct');
    expect(unitOfName(ctx, 'ปลา')).toBe('');
    expect(unitOfName(ctx, '')).toBe('');
    const gone = unitCtx({ ...s, unitm: { ...s.unitm, [staffKey('ปลา')]: M('nope', 'ปลา') } });
    expect(unitOfName(gone, 'ปลา')).toBe('');
  });
  it('lists units in their order (retired ones only on request), members as written, and the names in no unit', () => {
    expect(unitsOf(ctx).map((u) => u.id)).toEqual(['sale', 'cons', 'ver', 'plat', 'exec', 'acct']);
    expect(membersOf(ctx, 'sale')).toEqual(['มินท์', 'หมิว', 'เอก'].sort((a, b) => a.localeCompare(b, 'th')));
    expect(unassigned(ctx, ['ปลา', 'หมิว', 'ปลา ', 'คุณบี', 'บี'])).toEqual(['ปลา', 'บี']);
    const r = unitCtx({ ...s, units: { ...s.units, old: U('ฝ่ายเดิม', 2, [{ from: '', r: 1 }], 9, true) } });
    expect(unitsOf(r).some((u) => u.id === 'old')).toBe(false);
    expect(unitsOf(r, true).at(-1)!.id).toBe('old');
  });
  it('gives a new unit the first free colour, grey when all four are taken; ids never repeat', () => {
    expect(freeSlot(unitCtx(emptySales()))).toBe(1);
    expect(freeSlot(ctx)).toBe(0);
    const s2 = withUnits(emptySales());
    delete s2.units!.cons;
    expect(freeSlot(unitCtx(s2))).toBe(2);
    const id = newUnitId(['u' + (1000).toString(36)], 1000);
    expect(id).not.toBe('u' + (1000).toString(36));
    expect(id).toMatch(/^[a-z0-9_-]{1,24}$/);
  });
  it('a retired unit keeps its colour: a new unit takes one no unit uses, never a hue a retired unit with money still shows', () => {
    // the review's case: four paying units, ฝ่ายทวนสอบ (violet, slot 3 here) retired this year, then ฝ่ายวิจัย added
    const s2 = withUnits(emptySales());
    s2.units!.ver = { ...s2.units!.ver, off: true, offs: [{ from: '2026-10-12' }] };
    expect(freeSlot(unitCtx(s2), T)).toBe(0); // all four hues still shown this year: grey, not ฝ่ายทวนสอบ's
    // with a hue free, that one (not the retired unit's)
    delete s2.units!.cons;
    expect(freeSlot(unitCtx(s2), T)).toBe(2);
    // a unit retired before last year began shows no money this year or last: its hue may be used again
    s2.units!.cons = U('ฝ่ายที่ปรึกษา', 2, [{ from: '', r: 3 }], 1);
    s2.units!.ver = { ...s2.units!.ver, offs: [{ from: '2024-12-31' }] };
    expect(freeSlot(unitCtx(s2), T)).toBe(3);
    s2.units!.ver = { ...s2.units!.ver, offs: [{ from: '2025-01-01' }] };
    expect(freeSlot(unitCtx(s2), T)).toBe(0);
    // the unit being given a slot is left out of what is taken
    expect(freeSlot(unitCtx(s2), T, 'ver')).toBe(3);
  });
  it('a unit used again while a live unit has its colour needs another (slotTaken)', () => {
    const s2 = withUnits(emptySales());
    s2.units!.old = U('ฝ่ายเดิม', 2, [{ from: '', r: 1 }], 9, true);
    expect(slotTaken(unitCtx(s2), 'old')).toBe(true); // ฝ่ายที่ปรึกษา is slot 2
    expect(slotTaken(unitCtx(s2), 'cons')).toBe(false); // the retired one does not count
    expect(slotTaken(unitCtx(s2), 'exec')).toBe(false); // grey is not a hue
    delete s2.units!.cons;
    expect(slotTaken(unitCtx(s2), 'old')).toBe(false);
  });
});

describe('a deal\'s split', () => {
  it('default: 100% to the ผู้รับผิดชอบ\'s unit, computed, not stored', () => {
    const s = demo(), ctx = unitCtx(s);
    expect(shareOf(ctx, s.deals.w2)).toEqual({ lines: [{ u: 'plat', p: 100 }], dflt: true, bad: false, rec: null, own: 'plat' });
    expect(s.shares).toEqual({});
    // a resp in no unit, or none: ยังไม่ระบุหน่วยงาน
    expect(shareOf(ctx, s.deals.c1).lines).toEqual([{ u: '', p: 100 }]);
    expect(shareOf(ctx, { id: 'x', resp: '' }).lines).toEqual([{ u: '', p: 100 }]);
  });
  it('a saved split that adds up to 100 overrides it; a unit that is gone counts as ยังไม่ระบุหน่วยงาน', () => {
    const s = demo();
    s.shares!.w1 = SH([['sale', 60], ['cons', 20], ['ver', 20]]);
    const ctx = unitCtx(s);
    expect(shareOf(ctx, s.deals.w1)).toMatchObject({ lines: [{ u: 'sale', p: 60 }, { u: 'cons', p: 20 }, { u: 'ver', p: 20 }], dflt: false, bad: false, own: 'sale' });
    s.shares!.w2 = SH([['plat', 50], ['gone', 30], ['gone2', 20]]);
    expect(shareOf(unitCtx(s), s.deals.w2).lines).toEqual([{ u: 'plat', p: 50 }, { u: '', p: 50 }]);
  });
  it('a split that is not 100% (or repeats a unit, or has a bad share) is ignored and flagged', () => {
    const s = demo();
    s.shares!.w1 = SH([['sale', 60], ['cons', 20]]);
    expect(shareOf(unitCtx(s), s.deals.w1)).toMatchObject({ lines: [{ u: 'sale', p: 100 }], dflt: true, bad: true });
    expect(shareValid([{ u: 'a', p: 60 }, { u: 'b', p: 40 }])).toBe(true);
    expect(shareValid([{ u: 'a', p: 33.4 }, { u: 'b', p: 33.3 }, { u: 'c', p: 33.3 }])).toBe(true);
    expect(shareValid([{ u: 'a', p: 80 }])).toBe(false);
    expect(shareValid([{ u: 'a', p: 120 }, { u: 'b', p: -20 }])).toBe(false);
    expect(shareValid([{ u: 'a', p: 50 }, { u: 'a', p: 50 }])).toBe(false);
    expect(shareValid([{ u: 'a', p: 33.33 }, { u: 'b', p: 66.67 }])).toBe(false); // one decimal at most
    expect(shareValid([{ u: '', p: 100 }])).toBe(false);
    expect(shareValid([])).toBe(false);
    expect(shareSum([{ p: 60 }, { p: 20 }])).toBe(80);
  });
  it('"แบ่งเท่ากัน": tenths, the remainder on the first row, always 100', () => {
    expect(equalSplit(3)).toEqual([33.4, 33.3, 33.3]);
    expect(equalSplit(2)).toEqual([50, 50]);
    expect(equalSplit(7).reduce((a, x) => a + x, 0)).toBeCloseTo(100, 9);
    for (let n = 1; n <= 12; n++) expect(shareValid(equalSplit(n).map((p, i) => ({ u: 'u' + i, p })))).toBe(true);
  });
  it('splits an amount to the satang, the parts adding up exactly', () => {
    expect(splitSatang(100, [1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
    expect(splitSatang(963000, [33.4, 33.3, 33.3]).reduce((a, x) => a + x, 0)).toBe(963000);
    expect(splitSatang(80250.5, [60, 20, 20])).toEqual([48150.3, 16050.1, 16050.1]);
    expect(splitSatang(10, [0, 0])).toEqual([10, 0]);
  });
});

describe('effective-dated rates', () => {
  it('the first rate prices all money, past included; a change prices from its day, earlier money keeps the old rate', () => {
    // a unit made today with 3% prices a receipt of 15 ส.ค.
    let rates = withRate([], 3, {}, '2026-10-12');
    expect(rates).toEqual([{ from: '', r: 3, d: '2026-10-12' }]);
    expect(rateOn({ rates }, '2026-08-15')).toBe(3);
    // changed to 5% on 1 ต.ค.: 15 ส.ค. keeps 3%, 1 ต.ค. on is 5%
    rates = withRate([{ from: '', r: 3, d: '2026-07-01' }], 5, {}, '2026-10-01');
    expect(rates).toEqual([{ from: '', r: 3, d: '2026-07-01' }, { from: '2026-10-01', r: 5, d: '2026-10-01' }]);
    expect(rateOn({ rates }, '2026-08-15')).toBe(3);
    expect(rateOn({ rates }, '2026-09-30')).toBe(3);
    expect(rateOn({ rates }, '2026-10-01')).toBe(5);
  });
  it('a change saved again the same day replaces it; nothing changed keeps the list as it is', () => {
    const r0 = [{ from: '', r: 3, d: '2026-07-01' }, { from: '2026-10-01', r: 5, d: '2026-10-01' }];
    expect(withRate(r0, 6, {}, '2026-10-01')).toEqual([r0[0], { from: '2026-10-01', r: 6, d: '2026-10-01' }]);
    expect(withRate(r0, 5, {}, '2026-11-01')).toBe(r0);
    // a typo fixed on the day the unit was made stays the first rate (from the start)
    expect(withRate([{ from: '', r: 50, d: '2026-10-12' }], 5, {}, '2026-10-12')).toEqual([{ from: '', r: 5, d: '2026-10-12' }]);
  });
  it('a service\'s rate replaces the unit\'s while the job has it (VVB 5% over 3%); several match: the highest', () => {
    const u = { rates: [{ from: '', r: 3, svc: { VVB: 5, CFO: 4, LESS: 2 } }] };
    expect(rateOn(u, '2026-08-15', [])).toBe(3);
    expect(rateOn(u, '2026-08-15', ['VVB'])).toBe(5);
    expect(rateOn(u, '2026-08-15', ['CFO', 'VVB'])).toBe(5);
    expect(rateOn(u, '2026-08-15', ['LESS'])).toBe(2);
    expect(rateOn(u, '2026-08-15', ['CFP'])).toBe(3);
    expect(withRate([], 3, { VVB: 5, '': 9, X: 101 }, '2026-10-12')).toEqual([{ from: '', r: 3, svc: { VVB: 5 }, d: '2026-10-12' }]);
  });
  it('a unit saved as ไม่คิด and given a rate on a later day: from that day by default, never retroactive (the review\'s case)', () => {
    // ไม่คิด since 5 ม.ค. 2569 on purpose, 1% from 4 ม.ค. 2570: money of 2569 stays without commission
    const blank = withRate([], null, {}, '2026-01-05');
    expect(blank).toEqual([{ from: '', r: null, d: '2026-01-05' }]);
    expect(rateMode(blank, '2026-01-05')).toBe('first');
    expect(rateMode(blank, '2027-01-04')).toBe('choose');
    const rates = withRate(blank, 1, {}, '2027-01-04');
    expect(rates).toEqual([{ from: '', r: null, d: '2026-01-05' }, { from: '2027-01-04', r: 1, d: '2027-01-04' }]);
    expect(rateOn({ rates }, '2026-06-01')).toBeNull();
    expect(rateOn({ rates }, '2027-01-04')).toBe(1);
    expect(rateMode(rates, '2027-02-01')).toBe('change');
    // a rate by service only is a rate too
    const svc = withRate(blank, null, { VVB: 5 }, '2026-10-05');
    expect(svc).toEqual([blank[0], { from: '2026-10-05', r: null, svc: { VVB: 5 }, d: '2026-10-05' }]);
    expect(rateOn({ rates: svc }, '2026-08-15', ['VVB'])).toBeNull();
    expect(hadRate(svc)).toBe(true);
  });
  it('a unit made before its rate was known: asked to, the first rate prices the money received before too', () => {
    // blank on 1 ต.ค., 5% on 12 ต.ค. with "ใช้กับเงินที่รับมาแล้วทั้งหมดด้วย"
    const blank = withRate([], null, {}, '2026-10-01');
    const rates = withRate(blank, 5, {}, '2026-10-12', true);
    expect(rates).toEqual([{ from: '', r: 5, d: '2026-10-12' }]);
    expect(rateOn({ rates }, '2026-08-15')).toBe(5);
    // chosen "from today" first, then switched the same day: the money before is priced too
    const today = withRate(blank, 5, {}, '2026-10-12');
    expect(rateMode(today, '2026-10-12')).toBe('choose');
    expect(withRate(today, 5, {}, '2026-10-12', true)).toEqual([{ from: '', r: 5, d: '2026-10-12' }]);
    // and back to "from today" the same day while the ไม่คิด entry is still there
    expect(withRate(today, 5, {}, '2026-10-12')).toBe(today);
    // `back` with no rate typed, or once the unit has had a rate, changes nothing about the past
    expect(withRate(blank, null, {}, '2026-10-12', true)).toBe(blank);
    const had = [{ from: '', r: 3, d: '2026-07-01' }];
    expect(withRate(had, 5, {}, '2026-10-12', true)).toEqual([had[0], { from: '2026-10-12', r: 5, d: '2026-10-12' }]);
    // a service rate given back: retroactive too
    expect(withRate(blank, null, { VVB: 5 }, '2026-10-05', true)).toEqual([{ from: '', r: null, svc: { VVB: 5 }, d: '2026-10-05' }]);
  });
  it('once a unit has had a rate, "ไม่คิด" and a rate again are changes from their day', () => {
    const off = withRate([{ from: '', r: 3, d: '2026-07-01' }], null, {}, '2026-09-01');
    expect(off).toEqual([{ from: '', r: 3, d: '2026-07-01' }, { from: '2026-09-01', r: null, d: '2026-09-01' }]);
    const back = withRate(off, 5, {}, '2026-10-12');
    expect(back.map((x) => [x.from, x.r])).toEqual([['', 3], ['2026-09-01', null], ['2026-10-12', 5]]);
    expect([rateOn({ rates: back }, '2026-08-15'), rateOn({ rates: back }, '2026-09-15'), rateOn({ rates: back }, '2026-10-12')]).toEqual([3, null, 5]);
  });
  it('a rate changed and changed back the same day leaves no second entry with the same rate (the review\'s case)', () => {
    const r1 = withRate([], 3, {}, '2026-01-05');
    const r2 = withRate(r1, 5, {}, '2026-10-12');
    expect(r2).toEqual([r1[0], { from: '2026-10-12', r: 5, d: '2026-10-12' }]);
    expect(withRate(r2, 3, {}, '2026-10-12')).toEqual(r1);
    // the same with rates by service: back to what it was, by value (the order of the services does not matter)
    const s1 = withRate([], 3, { VVB: 5, CFO: 4 }, '2026-01-05');
    const s2 = withRate(s1, 3, { VVB: 6, CFO: 4 }, '2026-10-12');
    expect(s2).toHaveLength(2);
    expect(withRate(s2, 3, { CFO: 4, VVB: 5 }, '2026-10-12')).toEqual(s1);
    // a ไม่คิด set and taken back the same day
    expect(withRate(withRate(r1, null, {}, '2026-10-12'), 3, {}, '2026-10-12')).toEqual(r1);
    // the same rate on another day changes nothing
    expect(withRate(r1, 3, {}, '2026-10-13')).toBe(r1);
  });
  it('the mockups\' ไตรมาส 3 with ฝ่ายขาย made blank and given 5% the next day: 0 from that day by default, 5% when asked', () => {
    const s = demo();
    s.shares!.c1 = SH([['sale', 100]]);
    s.units!.sale.rates = withRate(withRate([], null, {}, '2026-10-12'), 5, {}, '2026-10-13');
    let c = contribIn(unitCtx(s), lines(s), Q3);
    // อมตะ PAY2 120,000 + แสนสิริ PAY1 107,000 (หมิว): 227,000, received before the rate
    expect(c.by.sale).toMatchObject({ got: 227000, comm: 0 });
    s.units!.sale.rates = withRate(withRate([], null, {}, '2026-10-12'), 5, {}, '2026-10-13', true);
    c = contribIn(unitCtx(s), lines(s), Q3);
    expect(c.by.sale).toMatchObject({ got: 227000, comm: 11350 });
    expect(rateText(commRows(unitCtx(s), c, Q3.to)[0].rates)).toBe('5%');
  });
  it('no commission: a null rate, no rate at all, or money before the first dated rate', () => {
    expect(rateOn({ rates: [{ from: '', r: null }] }, '2026-08-15')).toBeNull();
    expect(rateOn({ rates: [] }, '2026-08-15')).toBeNull();
    expect(rateOn({ rates: [{ from: '2026-09-01', r: 4 }] }, '2026-08-15')).toBeNull();
    expect(paysComm({ rates: [{ from: '', r: null }] })).toBe(false);
    expect(paysComm({ rates: [{ from: '', r: null, svc: { VVB: 5 } }] })).toBe(true);
    expect(rateText([3])).toBe('3%');
    expect(rateText([3, 5])).toBe('3–5%');
  });
});

describe('commission on money received', () => {
  it('the owner\'s example: 1,000,000 received, split 60/20/20 at 5/3/3 = 30,000 + 6,000 + 6,000', () => {
    const s = withUnits(world({ big: { d: { forecast: 1000000, resp: 'หมิว' }, steps: YES('2026-07-01'), pays: { PAY1: { amt: 1000000, due: '2026-08-01', rcv: '2026-08-01' } } } }));
    s.shares!.big = SH([['sale', 60], ['cons', 20], ['ver', 20]]);
    const c = contribIn(unitCtx(s), lines(s), Q3);
    expect(c.got).toBe(1000000);
    expect([c.by.sale.got, c.by.cons.got, c.by.ver.got]).toEqual([600000, 200000, 200000]);
    expect([c.by.sale.comm, c.by.cons.comm, c.by.ver.comm]).toEqual([30000, 6000, 6000]);
    expect(c.comm).toBe(42000);
  });
  it('ไตรมาส 3 of the mockups: อมตะ PAY2 + แสนสิริ PAY1 at 60/20/20 = 136,200 / 45,400 / 45,400, commission 9,534', () => {
    const s = demo();
    s.shares!.c1 = SH([['sale', 60], ['cons', 20], ['ver', 20]]);
    s.shares!.w1 = SH([['sale', 60], ['cons', 20], ['ver', 20]]);
    const ctx = unitCtx(s), c = contribIn(ctx, lines(s), Q3);
    expect(c).toMatchObject({ got: 227000, n: 2, deals: 2, comm: 9534 });
    expect([c.by.sale.got, c.by.cons.got, c.by.ver.got]).toEqual([136200, 45400, 45400]);
    expect([c.by.sale.comm, c.by.cons.comm, c.by.ver.comm]).toEqual([6810, 1362, 1362]);
    // ฝ่ายขาย opens to the two jobs behind 136,200
    expect(c.by.sale.items.map((x) => [x.deal.id, x.line.stage, x.p, x.amt])).toEqual([['c1', 'PAY2', 60, 72000], ['w1', 'PAY1', 60, 64200]]);
    const rows = commRows(ctx, c, Q3.to);
    // live units that pay commission (platform at 0) or got money; the units without commission and no money are left out
    expect(rows.map((r) => [r.u, r.got, r.pct, rateText(r.rates), r.comm])).toEqual([
      ['sale', 136200, 60, '5%', 6810],
      ['cons', 45400, 20, '3%', 1362],
      ['ver', 45400, 20, '3%', 1362],
      ['plat', 0, 0, '2%', 0],
    ]);
    expect(howRow(rows)!.u).toBe('sale');
  });
  it('rounds per unit at the end, not per amount', () => {
    const s = withUnits(world({ a: { d: { resp: 'หมิว' }, steps: YES('2026-07-01'), pays: { PAY1: { amt: 10, due: '2026-08-01', rcv: '2026-08-01' }, PAY2: { amt: 10, due: '2026-08-02', rcv: '2026-08-02' }, PAY3: { amt: 10, due: '2026-08-03', rcv: '2026-08-03' } } } }));
    s.units!.sale.rates = [{ from: '', r: 3.33 }];
    const c = contribIn(unitCtx(s), lines(s), Q3);
    // 3 × 0.333 = 0.999 → 1.00 (rounding each amount first would give 3 × 0.33 = 0.99)
    expect(c.by.sale.comm).toBe(1);
    c.by.sale.items.forEach((x) => expect(x.comm).toBeCloseTo(0.333, 9));
  });
  it('a rate change on 1 ต.ค. is not retroactive: the year shows both rates', () => {
    const s = demo();
    s.units!.plat.rates = [{ from: '', r: 2 }, { from: '2026-10-01', r: 4 }];
    const ctx = unitCtx(s), all = lines(s);
    // พฤกษา (คุณเอ, platform): typed Actual 180,000 on its PAY2 date, 5 ต.ค. → Q4 at 4%
    const q4 = contribIn(ctx, all, periodRange('2569', 3));
    expect(q4.by.plat).toMatchObject({ got: 180000, comm: 7200 });
    const old = { ...s, units: { ...s.units, plat: { ...s.units!.plat, rates: [{ from: '', r: 2 }] } } };
    expect(contribIn(unitCtx(old), all, periodRange('2569', 3)).by.plat.comm).toBe(3600);
    // a September receipt of the same unit keeps 2%
    s.deals.w2 = { ...s.deals.w2 };
    s.pays['w2/PAY1'] = L({ amt: 80250, due: '2026-10-08', rcv: '2026-09-30' });
    const y = contribIn(unitCtx(s), lines(s), periodRange('2569', 'year'));
    expect(y.by.plat.items.map((x) => [x.line.date, x.rate])).toEqual([['2026-09-30', 2], ['2026-10-05', 4]]);
    expect(rateText(commRows(unitCtx(s), y, '2026-12-31').find((r) => r.u === 'plat')!.rates)).toBe('2–4%');
  });
  it('a service rate follows the deal\'s Services; a unit without commission gets money but no commission', () => {
    const s = demo();
    s.deals.w1 = { ...s.deals.w1, service: ['VVB'] };
    s.shares!.w1 = SH([['ver', 50], ['exec', 50]]);
    const c = contribIn(unitCtx(s), lines(s), Q3);
    expect(c.by.ver).toMatchObject({ got: 53500, comm: 2675 }); // 5% (VVB), not 3%
    expect(c.by.exec).toMatchObject({ got: 53500, comm: 0 });
    const rows = commRows(unitCtx(s), c, Q3.to);
    expect(rows.find((r) => r.u === 'exec')).toMatchObject({ none: true, comm: 0 });
  });
  it('money of people in no unit is ยังไม่ระบุหน่วยงาน (last row, no commission)', () => {
    const s = demo();
    const ctx = unitCtx(s), c = contribIn(ctx, lines(s), Q3);
    // อมตะ (ปลา, no unit) 120,000 · แสนสิริ (หมิว) 107,000
    expect(c.by['']).toMatchObject({ got: 120000, comm: 0 });
    const rows = commRows(ctx, c, Q3.to);
    expect(rows.at(-1)).toMatchObject({ u: '', unit: null, got: 120000, none: true });
    expect(rows.reduce((a, r) => a + r.got, 0)).toBe(c.got);
  });
  it('the quarter split adds up to the Cashflow quarters, and money counts in the year it came in', () => {
    const s = demo();
    s.shares!.c1 = SH([['sale', 60], ['cons', 20], ['ver', 20]]);
    s.shares!.w1 = SH([['sale', 60], ['cons', 20], ['ver', 20]]);
    // a 2569 deal whose last installment comes in ม.ค. 2570
    s.deals.x = newDeal({ id: 'x', client: 'ข้ามปี', year: '2569', resp: 'มกร' }, 'A');
    s.steps['x/CLOSED DEAL'] = { d: '2026-11-01', n: 'YES' };
    s.pays['x/PAY1'] = L({ amt: 50000, due: '2027-01-10', rcv: '2027-01-10' });
    const all = lines(s), ctx = unitCtx(s);
    const uq = unitQuarters(ctx, all, '2569'), Y = cashYear(all, '2569');
    uq.q.forEach((q, i) => expect(Object.values(q).reduce((a, v) => a + v, 0)).toBe(Y.quarters[i].got));
    expect(uq.q[2]).toEqual({ sale: 136200, cons: 45400, ver: 45400 });
    expect(Object.values(uq.year).reduce((a, v) => a + v, 0)).toBe(Y.totals.got);
    expect(unitQuarters(ctx, all, '2570').q[0]).toEqual({ cons: 50000 });
    // ฝ่ายที่ปรึกษา's year, as in mockup 04: อมตะ PAY1 20% (Q2) + Q3 45,400 + คงธนา (มกร) 125,000 (Q4)
    expect(uq.year.cons).toBe(24000 + 45400 + 125000);
  });
  it('the card opens on the latest ended quarter of this year, the whole year of another', () => {
    expect(commPeriod0('2569', '2026-10-12')).toBe(2);
    expect(commPeriod0('2569', '2026-02-01')).toBe(0);
    expect(commPeriod0('2568', '2026-10-12')).toBe('year');
    expect(periodRange('2569', 1)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(periodRange('2569', 'year')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('a retired unit', () => {
  const at = '2026-10-01T03:00:00.000Z';
  /** ฝ่ายแพลตฟอร์ม (คุณเอ, 2%) retired on 1 ต.ค. */
  const retired = () => {
    const s = demo();
    s.units!.plat = { ...s.units!.plat, off: true, offs: [{ from: '2026-10-01' }], at };
    return s;
  };
  it('keeps the money received before the day it was retired; what comes in from that day is ยังไม่ระบุหน่วยงาน\'s, no rate', () => {
    const s = retired();
    // a September receipt of ไทยออยล์ (คุณเอ) and พฤกษา's typed Actual on 5 ต.ค.
    s.pays['w2/PAY1'] = L({ amt: 80250, due: '2026-10-08', rcv: '2026-09-30' });
    const ctx = unitCtx(s);
    const y = contribIn(ctx, lines(s), periodRange('2569', 'year'));
    expect(y.by.plat.items.map((x) => [x.deal.id, x.line.date, x.amt, x.rate])).toEqual([['w2', '2026-09-30', 80250, 2]]);
    expect(y.by.plat).toMatchObject({ got: 80250, comm: 1605 });
    expect(y.by[''].items.filter((x) => x.deal.id === 'c2').map((x) => [x.line.date, x.amt, x.rate, x.comm])).toEqual([['2026-10-05', 180000, null, 0]]);
    const q4 = contribIn(ctx, lines(s), periodRange('2569', 3));
    expect(q4.by.plat).toBeUndefined();
    // the card: the retired unit with its money (Q3), never one that got nothing
    expect(commRows(ctx, contribIn(ctx, lines(s), Q3), Q3.to).some((r) => r.u === 'plat')).toBe(true);
    expect(commRows(ctx, q4, periodRange('2569', 3).to).some((r) => r.u === 'plat')).toBe(false);
    // the units still add up to the money received
    expect(Object.values(y.by).reduce((a, m) => a + m.got, 0)).toBe(y.got);
  });
  it('the review\'s case: retired with 2%, a member\'s job paid 100,000 on 1 ธ.ค. gives it nothing; the member is listed to move', () => {
    const deal = newDeal({ id: 'd1', client: 'X', resp: 'คุณเอ', year: '2569' }, 'A');
    const s = { ...emptySales(), deals: { d1: deal }, units: { plat: U('ฝ่ายแพลตฟอร์ม', 4, [{ from: '', r: 2 }], 0, true) }, unitm: { [staffKey('คุณเอ')]: M('plat', 'คุณเอ') }, shares: {} };
    const line = { id: 'l', deal, kind: 'got', amt: 100000, date: '2026-12-01', stage: 'PAY1' } as unknown as Parameters<typeof contribIn>[1][number];
    // retired without a day (an earlier build's record, as the review held it): from the day it was saved, 1 ก.ค.
    expect(s.units.plat.offs).toBeUndefined();
    expect(retiredSince(s.units.plat)).toBe('2026-07-01');
    expect(toUnit(s.units.plat)!.offs).toEqual([{ from: '2026-07-01' }]);
    for (const ctx of [unitCtx(s, null), unitCtx({ ...s, units: { plat: toUnit(s.units.plat)! } }, null)]) {
      const c = contribIn(ctx, [line], { from: '2026-10-01', to: '2026-12-31' });
      expect(c.by.plat).toBeUndefined();
      expect(c.by['']).toMatchObject({ got: 100000, comm: 0 });
      expect(c.comm).toBe(0);
      expect(unassigned(ctx, ['คุณเอ'])).toEqual(['คุณเอ']);
      expect(unitOfName(ctx, 'คุณเอ')).toBe('plat'); // still in it: the money before counts for it
    }
  });
  it('a saved split that names it: its share from that day is ยังไม่ระบุหน่วยงาน\'s, the other units keep theirs', () => {
    const s = retired();
    s.shares!.c2 = SH([['plat', 50], ['sale', 50]]);
    const q4 = contribIn(unitCtx(s), lines(s), periodRange('2569', 3));
    expect(q4.by.sale.items.filter((x) => x.deal.id === 'c2').map((x) => x.amt)).toEqual([90000]);
    expect(q4.by[''].items.filter((x) => x.deal.id === 'c2').map((x) => [x.amt, x.p])).toEqual([[90000, 50]]);
  });
  it('the หน่วยงาน filter finds its jobs under it (the money before) and under ยังไม่ระบุหน่วยงาน (the money from that day)', () => {
    const s = retired(), ctx = unitCtx(s);
    expect(dealUnits(ctx, s.deals.c2).sort()).toEqual(['', 'plat']);
    expect(dealUnits(unitCtx(demo()), s.deals.c2)).toEqual(['plat']);
  });
  it('used again: the money of the days it was retired stays ยังไม่ระบุหน่วยงาน\'s; from the day it is back, its own', () => {
    let offs = withOff(undefined, true, '2026-10-01');
    expect(offs).toEqual([{ from: '2026-10-01' }]);
    expect(withOff(offs, true, '2026-10-02')).toEqual(offs); // already retired
    offs = withOff(offs, false, '2026-11-01');
    expect(offs).toEqual([{ from: '2026-10-01', to: '2026-11-01' }]);
    expect([retiredOn({ offs }, '2026-09-30'), retiredOn({ offs }, '2026-10-01'), retiredOn({ offs }, '2026-10-31'), retiredOn({ offs }, '2026-11-01')]).toEqual([false, true, true, false]);
    // retired and used again on the same day: nothing to remember
    expect(withOff(withOff(offs, true, '2026-12-01'), false, '2026-12-01')).toEqual(offs);
    const s = demo();
    s.units!.plat = { ...s.units!.plat, offs };
    s.pays['w2/PAY1'] = L({ amt: 80250, due: '2026-11-08', rcv: '2026-11-08' });
    const q4 = contribIn(unitCtx(s), lines(s), periodRange('2569', 3));
    expect(q4.by.plat.items.map((x) => [x.deal.id, x.line.date])).toEqual([['w2', '2026-11-08']]);
    expect(q4.by[''].items.filter((x) => x.deal.id === 'c2').map((x) => x.line.date)).toEqual(['2026-10-05']);
  });
  it('reads the spans as the unit says (checked), and sends them with it', () => {
    expect(toUnit({ n: 'ก', rates: [], off: true, offs: [{ from: '2026-10-01' }], at })!.offs).toEqual([{ from: '2026-10-01' }]);
    // in use: an open span (it does not say when it ended) is dropped, closed ones kept and sorted
    expect(toUnit({ n: 'ก', rates: [], offs: [{ from: '2026-10-01' }, { from: '2026-05-01', to: '2026-06-01' }], at })!.offs).toEqual([{ from: '2026-05-01', to: '2026-06-01' }]);
    // retired: the last open span; one that ends on or before its start, or bad days, are skipped
    expect(toUnit({ n: 'ก', rates: [], off: true, offs: [{ from: '2026-10-01', to: '2026-10-01' }, { from: 'x' }, 'junk'], at: 'bad' })!.offs).toEqual([{ from: '' }]);
    expect(retiredOn({ offs: [{ from: '' }] }, '2020-01-01')).toBe(true);
    expect(retiredSince({ off: true, offs: [{ from: '2026-10-01' }] })).toBe('2026-10-01');
    expect(retiredSince({ offs: [{ from: '2026-10-01', to: '2026-11-01' }] })).toBe(null);
    const s = retired();
    const rec = unitRecords(s).find(([k]) => k === 'scfg/unit.plat')![1] as UnitRec;
    expect(rec.offs).toEqual([{ from: '2026-10-01' }]);
    expect(rec.offs).not.toBe(s.units!.plat.offs);
  });
});

describe('what one job received by unit (the deal panel)', () => {
  it('its own money by its split, a retired unit\'s part from that day as ยังไม่ระบุหน่วยงาน', () => {
    const s = demo();
    s.shares!.c1 = SH([['sale', 60], ['cons', 40]]);
    const g = dealGot(unitCtx(s), cashLines(s, [s.deals.c1], T), 'c1');
    expect(g.got).toBe(240000);
    expect(Object.fromEntries(g.by)).toEqual({ sale: 144000, cons: 96000 });
    s.units!.cons = { ...s.units!.cons, off: true, offs: [{ from: '2026-08-01' }] };
    const g2 = dealGot(unitCtx(s), cashLines(s, [s.deals.c1], T), 'c1');
    // PAY1 (30 มิ.ย.) 60/40; PAY2 (15 ส.ค.) 60 to ฝ่ายขาย, the 40 to ยังไม่ระบุหน่วยงาน
    expect(Object.fromEntries(g2.by)).toEqual({ sale: 144000, cons: 48000, '': 48000 });
    expect(g2.got).toBe(240000);
  });
  it('a joint quotation\'s member company: its part of the header\'s money (it has none of its own)', () => {
    const s = withUnits(world({
      kmu: { d: { client: 'มจพ', resp: 'หมิว' }, steps: YES('2026-07-01'), pays: { PAY1: { amt: 300000, due: '2026-08-01', rcv: '2026-08-01' } } },
      m1: { d: { client: 'สมาชิก 1', resp: 'มกร' } },
      m2: { d: { client: 'สมาชิก 2', resp: 'หมิว' } },
    }));
    s.shares!.m1 = SH([['cons', 50], ['ver', 50]]);
    setPartsHook((st, d) => (d.id === 'kmu' ? [{ deal: st.deals.m1, w: 2 }, { deal: st.deals.m2, w: 1 }] : null));
    const ctx = unitCtx(s), header = cashLines(s, [s.deals.kmu], T);
    expect(dealGot(ctx, cashLines(s, [s.deals.m1], T).filter((l) => l.deal.id === 'm1'), 'm1').got).toBe(0); // nothing of its own
    const m1 = dealGot(ctx, header, 'm1');
    expect(m1.got).toBe(200000);
    expect(Object.fromEntries(m1.by)).toEqual({ cons: 100000, ver: 100000 });
    expect(dealGot(ctx, header, 'm2')).toMatchObject({ got: 100000 });
    expect(dealGot(ctx, header, 'kmu').got).toBe(0); // the header's money all went to its members
  });
});

describe('the card\'s rates: a range and the worked example', () => {
  it('a range lists each rate with its money and the day it applies from; วิธีคิด prefers a unit paid at one rate', () => {
    const s = demo();
    s.units!.plat.rates = [{ from: '', r: 2 }, { from: '2026-10-01', r: 4 }];
    s.pays['w2/PAY1'] = L({ amt: 80250, due: '2026-10-08', rcv: '2026-09-30' });
    const ctx = unitCtx(s), y = contribIn(ctx, lines(s), periodRange('2569', 'year'));
    const rows = commRows(ctx, y, '2026-12-31');
    const plat = rows.find((r) => r.u === 'plat')!;
    expect(rateParts(plat)).toEqual([
      { rate: 2, got: 80250, comm: 1605, from: [''], svc: [] },
      { rate: 4, got: 180000, comm: 7200, from: ['2026-10-01'], svc: [] },
    ]);
    // the parts reproduce the unit's figure
    expect(rateParts(plat).reduce((a, p) => a + (p.got * (p.rate || 0)) / 100, 0)).toBe(plat.comm);
    // ฝ่ายแพลตฟอร์ม has the most money but at two rates: the example is the largest unit paid at one
    expect(plat.got).toBeGreaterThan(rows.find((r) => r.u === 'sale')!.got);
    const how = howRow(rows)!;
    expect(how.u).toBe('sale');
    expect(rateParts(how)).toHaveLength(1);
    // only units with several rates: the largest of them, worded part by part
    expect(howRow(rows.filter((r) => r.u === 'plat'))!.u).toBe('plat');
  });
  it('a service\'s own rate is named, a part without commission is kept', () => {
    const s = demo();
    s.deals.w1 = { ...s.deals.w1, service: ['VVB'] };
    s.shares!.w1 = SH([['ver', 100]]);
    s.deals.c2 = { ...s.deals.c2, resp: 'คุณบี' };
    s.units!.ver.rates = [{ from: '', r: 3, svc: { VVB: 5 } }, { from: '2026-10-01', r: null }];
    const ctx = unitCtx(s), y = contribIn(ctx, lines(s), periodRange('2569', 'year'));
    const ver = commRows(ctx, y, '2026-12-31').find((r) => r.u === 'ver')!;
    expect(rateParts(ver)).toEqual([
      { rate: null, got: 180000, comm: 0, from: ['2026-10-01'], svc: [] },
      { rate: 5, got: 107000, comm: 5350, from: [''], svc: ['VVB'] },
    ]);
  });
});

describe('a joint quotation\'s header (the parts hook)', () => {
  it('apportions each header line to its members, each split its own way; the units add up to the line exactly', () => {
    const s = withUnits(world({
      kmu: { d: { client: 'มจพ', resp: 'หมิว' }, steps: YES('2026-07-01'), pays: { PAY1: { amt: 963000, due: '2026-08-01', rcv: '2026-08-01' } } },
      m1: { d: { client: 'สมาชิก 1', resp: 'หมิว' } },
      m2: { d: { client: 'สมาชิก 2', resp: 'มกร' } },
      m3: { d: { client: 'สมาชิก 3', resp: 'คุณบี' } },
      m4: { d: { client: 'สมาชิก 4', resp: 'ปลา' } },
    }));
    s.shares!.m1 = SH([['sale', 33.3], ['cons', 33.3], ['ver', 33.4]]);
    s.shares!.m3 = SH([['ver', 70], ['plat', 30]]);
    // share 400,000 · pct 30% of the rest · two empty: equally (as the joint-QT build will register it)
    setPartsHook((st, d) => (d.id === 'kmu' ? [{ deal: st.deals.m1, w: 400000 }, { deal: st.deals.m2, w: 168900 }, { deal: st.deals.m3, w: 197050 }, { deal: st.deals.m4, w: 197050 }] : null));
    const ctx = unitCtx(s);
    expect(apportioned(ctx, s.deals.kmu)).toBe(true);
    expect(apportioned(ctx, s.deals.m1)).toBe(false);
    const c = contribIn(ctx, lines(s), Q3);
    const sum = Object.values(c.by).reduce((a, m) => a + Math.round(m.got * 100), 0) / 100;
    expect(sum).toBe(963000);
    expect(c.by.cons.got).toBeCloseTo(400000 * 0.333 + 168900, 2);
    expect(c.by[''].got).toBe(197050); // m4: ปลา is in no unit
    expect(dealUnits(ctx, s.deals.kmu).sort()).toEqual(['', 'cons', 'plat', 'sale', 'ver']);
    // without the hook every deal is plain (phase 1's jointRole): the header's own split
    setPartsHook(null);
    expect(contribIn(unitCtx(s), lines(s), Q3).by.sale.got).toBe(963000);
  });
});

describe('the หน่วยงาน filter', () => {
  it('a deal matches every unit its money goes to; NONE = ยังไม่ระบุหน่วยงาน; the field only with units', () => {
    const s = demo();
    s.shares!.w1 = SH([['sale', 60], ['cons', 40]]);
    const ids = (unit: string[]) => filterDeals(s, { year: '2569', unit: { v: unit } }, T).map((d) => d.id).sort();
    expect(ids(['cons'])).toEqual(['demo3', 'w1']);
    expect(ids(['sale'])).toEqual(['c4', 'w1']);
    expect(ids(['(ไม่ระบุ)'])).toEqual(['c1']);
    expect(filterDeals(s, { year: '2569', unit: { v: ['sale'], not: true } }, T).map((d) => d.id).sort()).toEqual(['c1', 'c2', 'demo3', 'w2']);
    const F = { year: '2569' };
    const none = trackerFields(s, F, { yearDeals: Object.values(s.deals), job: '', me: 'หมิว', today: T, dash: true });
    expect(none.some((f) => f.key === 'unit')).toBe(false);
    const units = unitsOf(unitCtx(s)).map((u) => ({ id: u.id, n: u.n }));
    const f = trackerFields(s, F, { yearDeals: Object.values(s.deals), job: '', me: 'หมิว', today: T, dash: true, units })!.find((x) => x.key === 'unit')!;
    expect(f.options.map((o) => [o.label, o.n])).toEqual([['ฝ่ายขาย', 2], ['ฝ่ายที่ปรึกษา', 2], ['ฝ่ายทวนสอบ', 0], ['ฝ่ายแพลตฟอร์ม', 2], ['ผู้บริหาร', 0], ['ฝ่ายบัญชี', 0], ['ยังไม่ระบุหน่วยงาน', 1]]);
  });
});

describe('sync of units, members and splits', () => {
  const shared = (s: SalesState): SharedState => ({ crm: { stages: {}, owners: {}, watch: [], team: [], tasks: [], log: {} } as unknown as SharedState['crm'], contacts: {}, dec: {}, sales: s, custom: {} });
  it('a browser holds what it pulled and sends what it holds, keyed like the team', () => {
    const s = demo();
    s.shares!.w1 = SH([['sale', 60], ['cons', 40]]);
    const recs = localRecords(shared(s));
    expect(recs.get(keyOf.unit('ver'))).toEqual(s.units!.ver);
    expect(recs.get(keyOf.unitm(staffKey('ฝน')))).toEqual(s.unitm![staffKey('ฝน')]);
    expect(recs.get(keyOf.dshare('w1'))).toEqual(s.shares!.w1);
    const t = emptySales(), fx = noEffects();
    recs.forEach((v, k) => k.startsWith('scfg/unit') || k.startsWith('dshare/') ? applyRow(shared(t), { seq: 1, k, v, del: false, by: '', at: '' }, fx) : null);
    expect(t.units).toEqual(s.units);
    expect(t.unitm).toEqual(s.unitm);
    expect(t.shares).toEqual(s.shares);
    expect(fx.sales).toBe(true);
  });
  it('without ดูค่าคอมมิชชั่น: a split arrives as a deletion and a unit without its rates (commission 0, nothing private)', () => {
    const s = demo();
    s.shares!.w1 = SH([['sale', 60], ['cons', 40]]);
    const sh = shared(s);
    applyRow(sh, { seq: 9, k: 'dshare/w1', v: null, del: true, by: '', at: '' }, noEffects());
    const { rates: _r, ...noRates } = s.units!.sale;
    applyRow(sh, { seq: 10, k: 'scfg/unit.sale', v: noRates, del: false, by: '', at: '' }, noEffects());
    expect(s.shares!.w1).toBeUndefined();
    expect(s.units!.sale.rates).toEqual([]);
    expect(s.units!.sale.n).toBe('ฝ่ายขาย'); // names and members stay: the default split still works
    const c = contribIn(unitCtx(s), lines(s), Q3);
    expect(c.by.sale).toMatchObject({ got: 107000, comm: 0 });
  });
  it('checks what it applies: bad rows are skipped, deletions remove', () => {
    const t = emptySales();
    expect(applyUnitRow(t, 'unit.Bad Id', false, { n: 'x' })).toBe(false);
    expect(applyUnitRow(t, 'unit.ok', false, { n: '   ' })).toBe(false);
    expect(applyUnitRow(t, 'unit.ok', false, { n: 'ฝ่าย', c: 9, rates: [{ from: 'x', r: 1 }, { from: '', r: 200 }, { from: '2026-10-01', r: 4 }, { from: '', r: 3 }] })).toBe(true);
    expect(t.units!.ok).toMatchObject({ n: 'ฝ่าย', c: 0, rates: [{ from: '', r: 3 }, { from: '2026-10-01', r: 4 }] });
    expect(applyUnitRow(t, 'unitm.ฝน', false, { unit: 'BAD' })).toBe(false);
    expect(applyUnitRow(t, 'unitm.Fon', false, { unit: 'ok' })).toBe(false); // not a staffKey (upper case)
    expect(applyUnitRow(t, 'unitm.ฝน', false, { unit: 'ok', n: 'ฝน' })).toBe(true);
    expect(applyUnitRow(t, 'w1', false, { lines: 'x' }, true)).toBe(false);
    expect(applyUnitRow(t, 'w1', false, { lines: [{ u: 'ok', p: 100 }, { u: 1, p: 2 }] }, true)).toBe(true);
    expect(t.shares!.w1.lines).toEqual([{ u: 'ok', p: 100 }]);
    expect(applyUnitRow(t, 'w1', true, null, true)).toBe(true);
    expect(applyUnitRow(t, 'w1', true, null, true)).toBe(false);
    expect(toUnit(null)).toBeNull();
    expect(toUnitMember({ unit: '' })).toMatchObject({ unit: '' });
    expect(toShare({ lines: [] })).toEqual({ lines: [], at: '', by: '' });
  });
  it('a unit edited by two admins merges field by field (rates here, the name there)', () => {
    const theirs = { ...U('ฝ่ายขายใหม่', 1, [{ from: '', r: 5 }]) };
    const mine = { ...U('ฝ่ายขาย', 1, [{ from: '', r: 5 }, { from: '2026-10-12', r: 6 }]) };
    const r = rebaseOp({ seq: 5, k: 'scfg/unit.sale', v: theirs, del: false, by: 'ต้น', at: '' }, { id: 'o', k: 'scfg/unit.sale', v: mine, f: ['rates', 'at', 'by'], by: 'หมิว', at: '' } as never);
    expect(r).toEqual({ v: { ...theirs, rates: mine.rates, at: mine.at, by: mine.by } });
  });
});
