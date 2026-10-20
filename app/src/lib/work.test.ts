/**
 * The work count (owner question "how many companies did we work for"): lib/sales workTally, the one count
 * behind the ปิดงาน line and tab, the closing dialog, the Dashboard card, the CSV columns and the พร้อมปิดงาน
 * view; and what closing a joint quotation records for its companies (lib/joint jointFill, closedJoint,
 * closeSummary). The fixture is the investigation's: 5 ordinary closed jobs (3 YES, 2 NO) and one joint
 * quotation of 10 companies (QT-2569-099, 1,000,000 paid by มจพ), closed.
 */
import { describe, expect, it } from 'vitest';
import {
  closeReady, emptySales, filterDeals, jointAttr, jointOf, moneySum, newDeal, quickMatch, salesStats, workKey, workTally,
  type Deal, type JointMember, type SalesState,
} from './sales';
import { closeSummary, closedJoint, jointCloseOf, jointFill } from './joint';
import { closingView } from './salesUi';

const T = '2026-10-12';
const PAYER = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ';
const M = (at: string): JointMember => ({ share: null, pct: null, at, by: 'หมิว' });
const MEMBERS: [string, string, string, number | null][] = [
  ['m1', 'บริษัท บางกอกสตีล เวิร์คส์ จำกัด', 'หมิว', null],
  ['m2', 'บริษัท อุดร ไบโอแมส จำกัด', 'คุณบี', null],
  ['m3', 'บริษัท ไทยเท็กซ์ไทล์ อินดัสตรี จำกัด', 'ปลา', null],
  ['m4', 'บริษัท สยามฟู้ดส์ แปรรูป จำกัด', 'มกร', null],
  ['m5', 'บริษัท คงธนา เซอร์วิส จำกัด', 'มกร', 11],
  ['m6', 'บริษัท ซันฟีด จำกัด', 'หมิว', 24],
  ['m7', 'บริษัท ทอสเท็มไทย จำกัด', 'หมิว', 45],
  ['m8', 'บริษัท นิธิฟู้ดส์ จำกัด', 'หมิว', 57],
  ['m9', 'บริษัท ดั๊บเบิ้ล เอ (1991) จำกัด', 'หมิว', 38],
  ['m10', 'บริษัท ซีพีแรม จำกัด', 'หมิว', 30],
];
const IDS = MEMBERS.map((x) => x[0]);
/**
 * `members`: each company's result ('' none); `closed`: the joint quotation closed (header and companies);
 * `payer`: the payer's result.
 */
function world(o: { members?: ('YES' | 'NO' | '')[]; closed?: boolean; payer?: 'YES' | 'NO' | '' } = {}): SalesState {
  const s = emptySales();
  const add = (id: string, p: Partial<Deal>) => (s.deals[id] = newDeal({ id, year: '2569', section: 'Event Exhibition', ...p, client: p.client || id }, 'หมิว', '2026-09-01T03:00:00.000Z'));
  const res = (id: string, r: string, d = '2026-10-01') => r && (s.steps[`${id}/CLOSED DEAL`] = { d, n: r });
  // the ordinary jobs closed this year: 3 won, 2 lost
  ([
    ['c1', 'บริษัท อมตะ คอร์ปอเรชัน จำกัด', 'ปลา', 'YES', 240000, '2026-08-20'],
    ['c2', 'บริษัท พฤกษา โฮลดิ้ง จำกัด', 'คุณเอ', 'YES', 180000, '2026-10-06'],
    ['c3', 'บริษัท สหพัฒน์ จำกัด', 'คุณบี', 'NO', 60000, '2026-09-16'],
    ['c4', 'บริษัท ดับบลิวเอชเอ จำกัด', 'หมิว', 'YES', 95000, '2026-04-30'],
    ['c5', 'บริษัท บ้านปู จำกัด', 'คุณเอ', 'NO', 150000, '2026-10-08'],
  ] as const).forEach(([id, client, resp, r, fc, day], i) => {
    add(id, { client, resp, forecast: fc, actual: r === 'YES' ? fc : null, jobStatus: 'closed', closedDate: day, section: 'Retention', order: i });
    res(id, r);
  });
  // คงธนา's own job of the year (open, with its money): the same company as its row in the joint quotation
  add('o1', { client: 'บริษัท คงธนา เซอร์วิส จำกัด', gid: 11, resp: 'มกร', forecast: 250000, section: 'อื่นๆ', order: 9 });
  // the joint quotation: the payer's row (the header) and its 10 companies
  add('h', { client: PAYER, resp: 'หมิว', forecast: 1000000, actual: 1000000, order: 1 });
  s.jqt = { h: { title: 'CFP 10 บริษัท (มจพ)', at: '2026-10-01T03:00:00.000Z', by: 'หมิว' } };
  s.jqm = {};
  MEMBERS.forEach(([id, client, resp, gid], i) => {
    add(id, { client, resp, gid, order: 20 + i });
    s.jqm![`h/${id}`] = M(`2026-10-01T03:00:${String(i).padStart(2, '0')}.000Z`);
    res(id, o.members?.[i] || '', '2026-10-12');
  });
  res('h', o.payer ?? 'YES', '2026-10-05');
  if (o.closed !== false) [...IDS, 'h'].forEach((id) => (s.deals[id] = { ...s.deals[id], jobStatus: 'closed', closedDate: T }));
  return s;
}
const yes10 = () => world({ members: IDS.map(() => 'YES') });
const b82 = () => world({ members: IDS.map((_, i) => (i === 2 || i === 3 ? 'NO' : 'YES')) });
const none = () => world({});
const closed = (s: SalesState, F: Record<string, unknown> = {}) => filterDeals(s, { year: '2569', job: 'closed', ...F }, T);
/** The joint quotation of the fixture. */
const grp = (s: SalesState) => {
  const g = jointOf(s, { id: 'h' });
  if (!g) throw new Error('no joint quotation');
  return g;
};

describe('workTally: jobs and the companies worked for', () => {
  it('10 YES: 6 jobs (5 ordinary + the joint quotation once), 13 companies (3 + 10); the payer is no company', () => {
    const s = yes10(), t = workTally(s, closed(s));
    expect(t).toMatchObject({ jobs: 6, joint: 1, worked: 13, lost: 2, noResult: 0 });
    // the rows that carry the counts (the CSV's two columns): the joint job on the payer's row
    expect([...t.jobRow].sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'h']);
    expect(t.workRow.has('h')).toBe(false);
    expect([...t.workRow].sort()).toEqual(['c1', 'c2', 'c4', ...IDS].sort());
    // the money once, as before: 5 ordinary + 1,000,000
    expect(moneySum(s, closed(s)).fc).toBe(240000 + 180000 + 60000 + 95000 + 150000 + 1000000);
  });
  it('8 YES + 2 NO: 11 companies, the 2 that withdrew are lost; no member results: 3 (the 10 wait for a result)', () => {
    expect(workTally(b82(), closed(b82()))).toMatchObject({ jobs: 6, worked: 11, lost: 4, noResult: 0 });
    expect(workTally(none(), closed(none()))).toMatchObject({ jobs: 6, worked: 3, lost: 2, noResult: 10 });
  });
  it('searching the quotation: 1 job, 10 companies', () => {
    const s = yes10(), list = closed(s, { q: 'CFP 10' });
    expect(list.map((d) => d.id).sort()).toEqual(['h', ...IDS].sort());
    expect(workTally(s, list)).toMatchObject({ jobs: 1, worked: 10 });
  });
  it('a company in two jobs counts once (its registry link), in list order', () => {
    const s = yes10();
    s.deals.o1 = { ...s.deals.o1, jobStatus: 'closed', closedDate: '2026-09-30' };
    s.steps['o1/CLOSED DEAL'] = { d: '2026-09-01', n: 'YES' };
    const list = closed(s), t = workTally(s, list);
    expect(t).toMatchObject({ jobs: 7, worked: 13 });
    // the first of its rows in the list carries it
    const first = list.find((d) => d.id === 'o1' || d.id === 'm5')!.id;
    expect([t.workRow.has('o1'), t.workRow.has('m5')]).toEqual([first === 'o1', first === 'm5']);
    // won once, lost once: worked, not lost
    s.steps['o1/CLOSED DEAL'] = { d: '2026-09-01', n: 'NO' };
    expect(workTally(s, closed(s))).toMatchObject({ jobs: 7, worked: 13, lost: 2 });
  });
  it('rows without a registry link: the same name (normalised) is one company, and one with a link of that name too', () => {
    const s = yes10();
    const add = (id: string, client: string, gid: number | null = null) => {
      s.deals[id] = { ...newDeal({ id, client, year: '2569', section: 'TGO' }, 'หมิว'), gid, jobStatus: 'closed', closedDate: T };
      s.steps[`${id}/CLOSED DEAL`] = { d: T, n: 'YES' };
    };
    add('x1', 'สยามฟู้ดส์ แปรรูป'); // m4 "บริษัท สยามฟู้ดส์ แปรรูป จำกัด", no link
    add('x2', 'บริษัท ซันฟีด จำกัด'); // m6's name, without the link m6 has
    add('x3', 'ห้างหุ้นส่วนจำกัด ซีพีแรม'); // m10's name another way, no link
    expect(workTally(s, closed(s))).toMatchObject({ jobs: 9, worked: 13 });
    // the registry's own name for a linked row (the engine passes it): a row typed with that name joins it
    add('x4', 'ทอสเท็ม ไทย (สำนักงานใหญ่)'); // m7's own name another way: one company
    expect(workTally(s, closed(s)).worked).toBe(13);
    add('x5', 'Tostem Thai Co., Ltd.');
    expect(workTally(s, closed(s)).worked).toBe(14);
    expect(workTally(s, closed(s), { alias: (d) => (d.gid === 45 ? ['n' + 'tostemthaicoltd'] : []) }).worked).toBe(13);
    // a key of the caller's (the engine's: the registry company after a merge) decides
    expect(workTally(s, closed(s), { key: (d) => (d.gid === 24 || d.gid === 30 ? 'g24' : workKey(d)) }).worked).toBe(13);
  });
  it('the payer never counts as a company, even alone in the list or named like a company worked for', () => {
    const s = yes10();
    expect(workTally(s, [s.deals.h])).toMatchObject({ jobs: 1, joint: 1, worked: 0, lost: 0, noResult: 0 });
    s.deals.h = { ...s.deals.h, client: MEMBERS[5][1], gid: 24 };
    expect(workTally(s, closed(s)).worked).toBe(13);
  });
  it('closed only by default: a won job still open is not worked for yet (closedOnly false counts it)', () => {
    const s = yes10();
    s.steps['o1/CLOSED DEAL'] = { d: '2026-09-01', n: 'YES' };
    const year = filterDeals(s, { year: '2569' }, T);
    expect(workTally(s, year)).toMatchObject({ jobs: 7, worked: 13 });
    expect(workTally(s, year, { closedOnly: false })).toMatchObject({ jobs: 7, worked: 13 }); // คงธนา is already one of the 10
    s.deals.o1 = { ...s.deals.o1, gid: 99, client: 'บริษัท ใหม่ จำกัด' };
    expect(workTally(s, filterDeals(s, { year: '2569' }, T), { closedOnly: false }).worked).toBe(14);
    // the quotation open, its companies won: none counts until it is closed
    const open = world({ members: IDS.map(() => 'YES'), closed: false });
    expect(workTally(open, filterDeals(open, { year: '2569' }, T))).toMatchObject({ jobs: 7, worked: 3 });
  });
  it('a group closed partly by an older build: still 1 job; only its closed YES companies count', () => {
    const s = world({ members: IDS.map(() => 'YES'), closed: false });
    ['h', 'm1', 'm2', 'm3', 'm4'].forEach((id) => (s.deals[id] = { ...s.deals[id], jobStatus: 'closed', closedDate: T }));
    expect(workTally(s, closed(s))).toMatchObject({ jobs: 6, joint: 1, worked: 3 + 4 });
    // without its header in the list (a member closed alone): the job is still the quotation's, on its payer's row
    s.deals.h = { ...s.deals.h, jobStatus: 'open', closedDate: '' };
    const t = workTally(s, closed(s));
    expect(t).toMatchObject({ jobs: 6, worked: 7 });
    expect(t.jobRow.has('h')).toBe(true);
  });
});

describe('workTally under ผู้รับผิดชอบ / SOURCE / REFERRAL: a joint quotation is a job of each person with a company in it', () => {
  const by = (s: SalesState, who: string) => {
    const F = { resp: { v: [who] } }, list = closed(s, F);
    return { t: workTally(s, list, { attr: jointAttr(F) }), money: moneySum(s, list, jointAttr(F)) };
  };
  it('หมิว: her job (95,000) and the joint quotation (her 6 companies, 600,000): 2 jobs, 7 companies, 695,000', () => {
    const { t, money } = by(yes10(), 'หมิว');
    expect(t).toMatchObject({ jobs: 2, joint: 1, worked: 7 });
    expect([...t.jobRow].sort()).toEqual(['c4', 'h']);
    expect(money.fc).toBe(695000);
  });
  it('คุณบี: her lost job (60,000) and one company of the quotation (100,000): 2 jobs, 1 company worked for, 1 lost, 160,000; the job on the payer\'s row though it is filtered out', () => {
    const s = yes10(), { t, money } = by(s, 'คุณบี');
    expect(closed(s, { resp: { v: ['คุณบี'] } }).some((d) => d.id === 'h')).toBe(false);
    expect(t).toMatchObject({ jobs: 2, worked: 1, lost: 1 });
    expect(t.jobRow.has('h')).toBe(true);
    expect(money.fc).toBe(160000);
  });
  it('each person\'s jobs add up to more than the whole (the quotation is everyone\'s), the companies to exactly the whole', () => {
    const s = yes10(), all = workTally(s, closed(s));
    const people = ['หมิว', 'คุณบี', 'ปลา', 'มกร', 'คุณเอ'].map((p) => by(s, p));
    expect(people.reduce((a, x) => a + x.t.jobs, 0)).toBeGreaterThan(all.jobs);
    expect(people.reduce((a, x) => a + x.t.worked, 0)).toBe(all.worked);
    expect(people.reduce((a, x) => a + x.money.fc, 0)).toBe(moneySum(s, closed(s)).fc);
  });
  it('the payer\'s row alone under such a filter (no company of the person in it): no job, as no money', () => {
    const s = yes10();
    s.deals.h = { ...s.deals.h, resp: 'สมชาย' };
    const { t, money } = by(s, 'สมชาย');
    expect(t).toMatchObject({ jobs: 0, joint: 0, worked: 0 });
    expect(money.fc).toBe(0);
    // without such a filter (e.g. หมวด), the payer's row is the job
    expect(workTally(s, [s.deals.h])).toMatchObject({ jobs: 1 });
  });
});

describe('closing a joint quotation as one', () => {
  it('jointFill: the payer\'s YES for the companies without a result (a NO stays NO, a YES stays), on the payer\'s day', () => {
    const s = world({ members: ['', 'NO', 'YES', '', '', '', '', '', '', ''], closed: false });
    s.steps['m4/CLOSED DEAL'] = { d: '2026-09-30', n: 'รอผล งบปีหน้า' };
    const f = jointFill(s, grp(s));
    expect(f).toEqual({ r: 'YES', d: '2026-10-05', ids: IDS.filter((id) => id !== 'm2' && id !== 'm3') });
    // the payer says NO: every company without a result is NO too
    s.steps['h/CLOSED DEAL'] = { d: '2026-10-05', n: 'NO' };
    expect(jointFill(s, grp(s)).r).toBe('NO');
    // no result from the payer (or รอผล): nothing is recorded
    s.steps['h/CLOSED DEAL'] = { d: '2026-10-05', n: 'รอผล' };
    expect(jointFill(s, grp(s))).toMatchObject({ r: '', ids: [] });
    delete s.steps['h/CLOSED DEAL'];
    expect(jointFill(s, grp(s))).toMatchObject({ r: '', d: '', ids: [] });
  });
  it('the closing dialog\'s preview: each company\'s result after closing (by the payer\'s), and "ทำงานให้ N บริษัท"', () => {
    const s = world({ closed: false });
    const sum = closeSummary(s, grp(s), T);
    expect(sum.fill).toBe('YES');
    expect(sum.rows.every((r) => r.by && r.after === 'YES' && r.result === '')).toBe(true);
    expect(sum.worked).toBe(10);
    expect(sum.open).toBe(10);
    // 2 withdrew: 8, and their rows say NO of their own
    const w = world({ members: ['', '', 'NO', 'NO', '', '', '', '', '', ''], closed: false });
    const s2 = closeSummary(w, grp(w), T);
    expect([s2.worked, s2.rows.filter((r) => r.by).length, s2.rows[2]]).toMatchObject([8, 8, { result: 'NO', after: 'NO', by: false }]);
    // no result from the payer yet: nothing is recorded, none counts yet
    const u = world({ closed: false, payer: '' });
    const s3 = closeSummary(u, grp(u), T);
    expect([s3.fill, s3.worked, s3.rows.some((r) => r.by)]).toEqual(['', 0, false]);
    // the tracker after closing, as the dialog previews it: 6 jobs, 13 companies
    const A = closedJoint(s, grp(s), T);
    expect(workTally(A, closed(A))).toMatchObject({ jobs: 6, worked: 13 });
    expect(A.deals.m1).toMatchObject({ jobStatus: 'closed', closedDate: T });
    expect(A.steps['m1/CLOSED DEAL']).toEqual({ d: '2026-10-05', n: 'YES' });
    expect(s.steps['m1/CLOSED DEAL']).toBeUndefined();
  });
  it('a company\'s ปิดงาน is the whole quotation\'s; a plain job closes on its own', () => {
    const s = world({ closed: false });
    expect(['h', 'm1', 'm10', 'c1', 'o1'].map((id) => jointCloseOf(s, s.deals[id]))).toEqual(['h', 'h', 'h', '', '']);
  });
  it('พร้อมปิดงาน: the quotation and every company of it when the payer is ready (paid, or NO), counted once', () => {
    const s = world({ closed: false, payer: '' });
    s.pays['h/PAY1'] = { amt: 500000, pct: null, due: '2026-10-10', rel: null, how: 'transfer', howT: '', note: '', rcv: '2026-10-09' } as never;
    s.pays['h/PAY2'] = { amt: 500000, pct: null, due: '2026-12-10', rel: null, how: 'transfer', howT: '', note: '' } as never;
    const open = filterDeals(s, { year: '2569', job: 'open' }, T);
    const ready = () => open.filter((d) => quickMatch(s, d, 'ready', T));
    expect(ready()).toEqual([]);
    s.steps['h/CLOSED DEAL'] = { d: '2026-10-05', n: 'YES' };
    expect(ready()).toEqual([]); // won, a payment left
    s.pays['h/PAY2'] = { ...s.pays['h/PAY2'], rcv: '2026-10-11' };
    expect(ready().map((d) => d.id).sort()).toEqual(['h', ...IDS].sort());
    expect(workTally(s, ready()).jobs).toBe(1);
    // a company's closing card: ready with the quotation, its result from the payer at the closing
    expect(closeReady(s, s.deals.m1, T)).toBe(true);
    expect(closingView(s, s.deals.m1, T)).toMatchObject({ state: 'joint', ready: true, lead: 'ยังไม่มีผลของบริษัทนี้ · ผู้จ่ายชำระครบแล้ว' });
    expect(closingView(s, s.deals.m1, T).text).toContain('ปิดงานพร้อมกันทั้งใบเสนอราคาร่วม');
    // the win rate stays per company (owner question 2): the payer's row is no customer
    expect(salesStats(s, open, T)).toMatchObject({ yes: 0, total: 11 });
  });
});
