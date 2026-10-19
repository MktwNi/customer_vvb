/**
 * แผนติดต่อ's contact list (lib/planList.ts): only the team's real work — the companies it follows and the open
 * Sales Tracker jobs of the tracker's year — one row per company, never a registry list. Mon 12 Oct 2569.
 */
import { describe, expect, it } from 'vitest';
import { dmTh } from './format';
import { filterRows, hasPlan, jobTag, openJob, ownerChoices, planRows, planSrc, rowsOf, srcCounts, unplanned, type PlanCo, type PlanIn } from './planList';
import { emptySales, newDeal, type Deal, type PayLine, type SalesState } from './sales';
import type { StageKey, Task } from './types';

const T = '2026-10-12';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '', ...p });

/** The register: 10 (with 11 merged into it), 20, 30, 40, 50 (no phone). */
const COS: PlanCo[] = [
  { id: 10, name: 'บริษัท ไทยพลาสติกรีไซเคิล จำกัด', phone: '02-111-1111' },
  { id: 20, name: 'บริษัท บางกอกสตีล เวิร์คส์ จำกัด', phone: '02-222-2222' },
  { id: 30, name: 'บริษัท อุดร ไบโอแมส จำกัด', phone: '' },
  { id: 40, name: 'บริษัท กรีนวัลเลย์ ฟู้ดส์ จำกัด', phone: '02-444-4444' },
  { id: 50, name: 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ', phone: '' },
];
const ALIAS = new Map([[11, 10]]);
const byId = new Map(COS.map((c) => [c.id, c]));
const company = (id: number) => byId.get(ALIAS.get(id) ?? id);

function input(p: Partial<PlanIn> = {}): PlanIn {
  return { company, watch: [], tasks: [], owners: {}, stages: {}, sales: emptySales(), year: '2569', today: T, ...p };
}
/** A deal added on 1 Sep (so a deal nobody contacted since is overdue on 12 Oct) with these steps. */
function deal(s: SalesState, id: string, p: Partial<Deal> & { client?: string } = {}, steps: Record<string, [string, string?]> = {}) {
  s.deals[id] = newDeal({ id, year: '2569', section: 'Retention', order: Object.keys(s.deals).length, ...p, client: p.client ?? 'ลูกค้า ' + id }, 'หมิว', '2026-09-01T03:00:00.000Z');
  for (const [k, [d, n = '']] of Object.entries(steps)) s.steps[`${id}/${k}`] = { d, n };
  return s.deals[id];
}
const task = (id: string, gid: number, date: string, done = false): Task => ({ id, gid, title: '', type: 'call', date, time: '', note: '', done });
/** Steps done up to QUOTATION a few days ago: the next one is FOLLOW1, not overdue. */
const toQuote = { CALL1: ['2026-10-01'], CALL2: ['2026-10-05'], QUOTATION: ['2026-10-08'] } as Record<string, [string, string?]>;
const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe('ui.plFeed: the list used to be a registry feed', () => {
  it('maps a registry feed, nothing or anything unknown to the default (both sources)', () => {
    for (const v of ['cfoSoon', 'cfoExp', 'giSoon', 'giDown', 'newFac', 'setNew', 'noContact', '', undefined, null, 42, 'ALL', 'all']) expect(planSrc(v)).toBe('all');
  });
  it('keeps the followed feed and the tracker', () => {
    expect(planSrc('watch')).toBe('watch');
    expect(planSrc('sales')).toBe('sales');
  });
});

describe('the rows: followed companies and open tracker jobs, one row per company', () => {
  it('is empty without anything followed or in the tracker (no registry company leaks in)', () => {
    expect(planRows(input())).toEqual([]);
    expect(srcCounts(planRows(input()))).toEqual({ all: 0, watch: 0, sales: 0 });
  });

  it('joins a followed company and its tracker job, by the company (merged ids are one company)', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 11, client: 'ไทยพลาสติกรีไซเคิล' }, toQuote);
    deal(s, 'b', { gid: 20 }, toQuote);
    // followed twice: by its own id and the one merged into it
    const rows = planRows(input({ sales: s, watch: [10, 11, 30, 999] }));
    expect(rows).toHaveLength(3);
    const r10 = rows.find((r) => r.key === 'c10')!;
    expect(r10.c?.id).toBe(10);
    expect(r10.name).toBe(COS[0].name);
    expect(r10.watch).toBe(true);
    expect(r10.jobs.map((j) => j.deal.id)).toEqual(['a']);
    expect(rows.find((r) => r.key === 'c20')).toMatchObject({ watch: false });
    expect(rows.find((r) => r.key === 'c30')).toMatchObject({ watch: true, jobs: [] });
    // an id followed that the register no longer has: no row
    expect(rows.some((r) => r.key === 'c999')).toBe(false);
    expect(srcCounts(rows)).toEqual({ all: 3, watch: 2, sales: 2 });
    expect(keys(rowsOf(rows, 'watch')).sort()).toEqual(['c10', 'c30']);
    expect(keys(rowsOf(rows, 'sales')).sort()).toEqual(['c10', 'c20']);
    expect(rowsOf(rows, 'all')).toHaveLength(3);
  });

  it('puts two open jobs of one company on one row, the most urgent first', () => {
    const s = emptySales();
    deal(s, 'calm', { gid: 20, service: ['CFO'] }, toQuote);
    // nobody has contacted this one since it was added (1 Sep): overdue
    deal(s, 'idle', { gid: 20, service: ['CFP'] });
    const [r] = planRows(input({ sales: s }));
    expect(r.jobs.map((j) => j.deal.id)).toEqual(['idle', 'calm']);
    expect(r.jobs[0]).toMatchObject({ late: true, idle: 41, when: '2026-09-15' });
    expect(r.late).toBe(true);
    expect(jobTag(r.jobs)).toBe('Sales Tracker 2 งาน · ถัดไป CALL1 โทรครั้งที่\u00a01');
  });

  it('lists only open jobs of the year: not closed, not lost, not won and fully paid, not another year', () => {
    const s = emptySales();
    deal(s, 'open', { gid: 10 }, toQuote);
    deal(s, 'closed', { gid: 20, jobStatus: 'closed', closedDate: '2026-10-01' }, toQuote);
    deal(s, 'lost', { gid: 30 }, { ...toQuote, 'CLOSED DEAL': ['2026-10-09', 'NO'] });
    deal(s, 'old', { gid: 40, year: '2568' }, toQuote);
    // won, every installment received: it needs closing, not a call
    deal(s, 'paid', { gid: 50 }, { ...toQuote, 'CLOSED DEAL': ['2026-10-01', 'YES'] });
    s.pays['paid/PAY1'] = L({ amt: 1000, due: '2026-10-05', rcv: '2026-10-05', got: 1000 });
    // won, an installment still owed (and late): followed up
    deal(s, 'owed', { gid: 20, client: 'บางกอกสตีล' }, { ...toQuote, 'CLOSED DEAL': ['2026-10-01', 'YES'] });
    s.pays['owed/PAY1'] = L({ amt: 1000, due: '2026-10-10' });
    s.pays['owed/PAY2'] = L({ amt: 1000, due: '2026-12-10' });
    const rows = planRows(input({ sales: s }));
    expect(keys(rows).sort()).toEqual(['c10', 'c20']);
    expect(rows.find((r) => r.key === 'c20')!.jobs.map((j) => j.deal.id)).toEqual(['owed']);
    expect(['open', 'closed', 'lost', 'old', 'paid', 'owed'].filter((id) => openJob(s, s.deals[id], '2569', T))).toEqual(['open', 'owed']);
    const owed = rows.find((r) => r.key === 'c20')!;
    expect(owed.late).toBe(true);
    expect(owed.when).toBe('2026-10-10');
    expect(jobTag(owed.jobs)).toBe('Sales Tracker · ถัดไป PAY1 เลยกำหนด\u00a02\u00a0วัน');
  });

  it('follows the tracker year given (the year picked in the tracker)', () => {
    const s = emptySales();
    deal(s, 'y68', { gid: 10, year: '2568' }, toQuote);
    deal(s, 'y69', { gid: 20 }, toQuote);
    expect(keys(planRows(input({ sales: s, year: '2568' })))).toEqual(['c10']);
    expect(keys(planRows(input({ sales: s, year: '2569' })))).toEqual(['c20']);
  });

  it('lists a joint quotation by its member companies, not its header (the payer is not a customer)', () => {
    const s = emptySales();
    deal(s, 'h', { gid: 50, client: 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ' }, toQuote);
    deal(s, 'm1', { gid: 10 }, toQuote);
    deal(s, 'm2', { gid: 20 }, toQuote);
    // a member not linked to the register
    deal(s, 'm3', { gid: null, client: 'สยามฟู้ดส์ แปรรูป' }, toQuote);
    s.jqt = { h: { title: 'CFP 3 บริษัท (มจพ)', at: '2026-10-06T03:00:00.000Z', by: 'หมิว' } };
    s.jqm = Object.fromEntries(['m1', 'm2', 'm3'].map((id, i) => [`h/${id}`, { share: null, pct: null, at: `2026-10-06T03:00:0${i}.000Z`, by: 'หมิว' }]));
    const rows = planRows(input({ sales: s }));
    expect(rows.map((r) => r.name).sort()).toEqual([COS[0].name, COS[1].name, 'สยามฟู้ดส์ แปรรูป'].sort());
    expect(rows.some((r) => r.c?.id === 50)).toBe(false);
    // the payer followed: a row of its own, from following only
    const w = planRows(input({ sales: s, watch: [50] }));
    expect(w.find((r) => r.c?.id === 50)).toMatchObject({ watch: true, jobs: [] });
    expect(srcCounts(w)).toEqual({ all: 4, watch: 1, sales: 3 });
  });

  it('gives a client not linked to the register a row of its own: one per name, no appointment, its job’s phone and owner', () => {
    const s = emptySales();
    deal(s, 'u1', { gid: null, client: 'บริษัท สยามฟู้ดส์ แปรรูป จำกัด', phone: '081-000-0000', resp: 'คุณบี' }, toQuote);
    // the same client typed another way: the same row
    deal(s, 'u2', { gid: null, client: 'สยามฟู้ดส์  แปรรูป', service: ['CFP'] }, toQuote);
    // linked to a company the register no longer has: read as not linked
    deal(s, 'gone', { gid: 777, client: 'โคราช ซีเมนต์' }, toQuote);
    const rows = planRows(input({ sales: s, tasks: [task('t', 777, '2026-10-13')] }));
    expect(rows).toHaveLength(2);
    const u = rows.find((r) => r.name.includes('สยามฟู้ดส์'))!;
    // no sales status: it is a company's (lib/planList.ts filterRows)
    expect(u).toMatchObject({ c: null, phone: '081-000-0000', owner: 'คุณบี', stage: null, task: null, watch: false });
    expect(u.jobs.map((j) => j.deal.id).sort()).toEqual(['u1', 'u2']);
    const g = rows.find((r) => r.name === 'โคราช ซีเมนต์')!;
    expect(g.c).toBeNull();
    expect(g.task).toBeNull();
  });

  it('shows nothing from the tracker to an account that does not see it', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 10 }, toQuote);
    deal(s, 'u', { gid: null, client: 'สยามฟู้ดส์' }, toQuote);
    const rows = planRows(input({ sales: null, watch: [20] }));
    expect(keys(rows)).toEqual(['c20']);
    expect(srcCounts(rows)).toEqual({ all: 1, watch: 1, sales: 0 });
  });

  it('takes the company’s phone, owner and sales status, the job’s when the company has none', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 30, phone: '081-333-3333', resp: 'มกร' }, toQuote);
    deal(s, 'b', { gid: 10, phone: '089-999-9999', resp: 'มกร' }, toQuote);
    const stages: Record<string, StageKey> = { 10: 'interested' };
    const rows = planRows(input({ sales: s, owners: { 10: 'หมิว' }, stages }));
    expect(rows.find((r) => r.key === 'c30')).toMatchObject({ phone: '081-333-3333', owner: 'มกร', stage: 'none' });
    expect(rows.find((r) => r.key === 'c10')).toMatchObject({ phone: '02-111-1111', owner: 'หมิว', stage: 'interested' });
  });
});

describe('the order: what needs action first, then the soonest, then what has no plan yet', () => {
  it('orders late appointments and jobs, then dated ones, then jobs and companies without a plan', () => {
    const s = emptySales();
    // c10: an appointment that passed (5 Oct)
    // c20: a job nobody contacted since 1 Sep (due 15 Sep: the oldest)
    deal(s, 'idle', { gid: 20 });
    // c30: FOLLOW1 planned on 20 Oct in the tracker
    deal(s, 'plan', { gid: 30 }, { ...toQuote, FOLLOW1: ['2026-10-20'] });
    // c40: an appointment on 14 Oct
    // c50: a job with its next step not planned, not overdue
    deal(s, 'next', { gid: 50 }, toQuote);
    // an unlinked client, next step not planned
    deal(s, 'u', { gid: null, client: 'สยามฟู้ดส์' }, toQuote);
    const tasks = [task('t10', 10, '2026-10-05'), task('t40', 40, '2026-10-14'), task('t40b', 40, '2026-10-30'), task('done', 50, '2026-10-01', true)];
    // c10 and c40 followed too; 11 (merged into 10) followed: still one row
    const rows = planRows(input({ sales: s, tasks, watch: [10, 11, 40] }));
    expect(rows.map((r) => [r.key, r.late, r.when])).toEqual([
      ['c20', true, '2026-09-15'],
      ['c10', true, '2026-10-05'],
      ['c40', false, '2026-10-14'],
      ['c30', false, '2026-10-20'],
      // no plan yet: tracker jobs (by name), then companies only followed
      ['c50', false, ''],
      ['nสยามฟู้ดส์', false, ''],
    ]);
    // the first open appointment (a done one never counts)
    expect(rows.find((r) => r.key === 'c40')!.task?.id).toBe('t40');
    expect(rows.find((r) => r.key === 'c50')!.task).toBeNull();
    expect(jobTag(rows.find((r) => r.key === 'c30')!.jobs)).toBe(`Sales Tracker · ถัดไป FOLLOW1 นัด\u00a0${dmTh('2026-10-20')}`);
    expect(jobTag(rows.find((r) => r.key === 'c50')!.jobs)).toBe('Sales Tracker · ถัดไป FOLLOW1 ติดตามครั้งที่\u00a01');
  });

  it('puts companies only followed after the tracker’s jobs when neither has a plan', () => {
    const s = emptySales();
    deal(s, 'next', { gid: 40 }, toQuote);
    const rows = planRows(input({ sales: s, watch: [10, 20] }));
    expect(keys(rows)).toEqual(['c40', 'c10', 'c20']);
  });

  it('takes an appointment ahead as the contact a job not contacted for long waits for (a late installment stays late)', () => {
    const s = emptySales();
    deal(s, 'idle', { gid: 10 });
    deal(s, 'idle2', { gid: 20 });
    deal(s, 'owed', { gid: 30 }, { ...toQuote, 'CLOSED DEAL': ['2026-10-01', 'YES'] });
    s.pays['owed/PAY1'] = L({ amt: 1000, due: '2026-10-10' });
    const tasks = [task('t10', 10, '2026-10-13'), task('t30', 30, '2026-10-20')];
    const rows = planRows(input({ sales: s, tasks }));
    expect(rows.map((r) => [r.key, r.late, r.when, r.idle])).toEqual([
      ['c20', true, '2026-09-15', 41],
      ['c30', true, '2026-10-10', null],
      ['c10', false, '2026-10-13', null],
    ]);
    // a passed appointment does not take care of it
    const late = planRows(input({ sales: s, tasks: [task('t10', 10, '2026-10-05')] })).find((r) => r.key === 'c10')!;
    expect(late).toMatchObject({ late: true, when: '2026-09-15', idle: 41 });
  });

  it('does not call a job with a step planned ahead late, however long ago the last contact was', () => {
    const s = emptySales();
    deal(s, 'p', { gid: 10 }, { CALL1: ['2026-08-01'], CALL2: ['2026-10-25'] });
    const [r] = planRows(input({ sales: s }));
    expect(r.jobs[0]).toMatchObject({ late: false, idle: null, when: '2026-10-25' });
    expect(r.late).toBe(false);
  });
});

describe('"ยังไม่มีแผน": what นัดรายที่ยังไม่มีแผน books and the count beside the list', () => {
  it('leaves out a company with an appointment or a tracker step planned ahead, and a client not linked', () => {
    const s = emptySales();
    // c10: its next step (FOLLOW1) set on 20 Oct in the tracker: planned, no appointment needed
    deal(s, 'plan', { gid: 10 }, { ...toQuote, FOLLOW1: ['2026-10-20'] });
    // c20: nobody contacted since 1 Sep: late, no plan (it most needs one)
    deal(s, 'idle', { gid: 20 });
    // c30: an installment late: a reason to call, not a plan
    deal(s, 'owed', { gid: 30 }, { ...toQuote, 'CLOSED DEAL': ['2026-10-01', 'YES'] });
    s.pays['owed/PAY1'] = L({ amt: 1000, due: '2026-10-10' });
    // c40: an appointment (one that passed still is: it is moved, not booked again)
    // c50: next step not planned
    deal(s, 'next', { gid: 50 }, toQuote);
    deal(s, 'u', { gid: null, client: 'สยามฟู้ดส์' }, toQuote);
    const rows = planRows(input({ sales: s, tasks: [task('t40', 40, '2026-10-05')], watch: [40] }));
    const r10 = rows.find((r) => r.key === 'c10')!;
    expect(r10).toMatchObject({ late: false, when: '2026-10-20', task: null });
    expect(hasPlan(r10)).toBe(true);
    expect(hasPlan(rows.find((r) => r.key === 'c40')!)).toBe(true);
    expect(rows.filter((r) => !hasPlan(r)).map((r) => r.key)).toEqual(['c20', 'c30', 'c50', 'nสยามฟู้ดส์']);
    // in the list's order, only companies of the register (an appointment needs one)
    expect(unplanned(rows).map((c) => c.id)).toEqual([20, 30, 50]);
  });

  it('counts a company as planned when any of its jobs has a step planned ahead', () => {
    const s = emptySales();
    deal(s, 'idle', { gid: 10 });
    deal(s, 'plan', { gid: 10, service: ['CFP'] }, { ...toQuote, FOLLOW1: ['2026-10-22'] });
    const rows = planRows(input({ sales: s, watch: [20] }));
    expect(rows.find((r) => r.key === 'c10')!.jobs).toHaveLength(2);
    expect(unplanned(rows).map((c) => c.id)).toEqual([20]);
  });

  it('is the filtered list’s', () => {
    const s = emptySales();
    deal(s, 'a', { gid: 10, resp: 'มกร' }, toQuote);
    deal(s, 'b', { gid: 20, resp: 'ปลา' }, toQuote);
    const rows = planRows(input({ sales: s }));
    expect(unplanned(filterRows(rows, '', 'ปลา')).map((c) => c.id)).toEqual([20]);
  });
});

describe('the filters: สถานะการขาย and ผู้รับผิดชอบ', () => {
  function fixture() {
    const s = emptySales();
    // won, an installment late, its client not linked: no sales status
    deal(s, 'won', { gid: null, client: 'ไทยออยล์', resp: 'มกร' }, { ...toQuote, 'CLOSED DEAL': ['2026-10-01', 'YES'] });
    s.pays['won/PAY1'] = L({ amt: 1000, due: '2026-10-08' });
    deal(s, 'u', { gid: null, client: 'แสนสิริ' }, toQuote);
    deal(s, 'a', { gid: 10, resp: 'มกร' }, toQuote);
    deal(s, 'b', { gid: 20, resp: 'ปลา' }, toQuote);
    return planRows(input({ sales: s, watch: [30, 40], owners: { 20: 'หมิว', 40: 'คุณเอ' }, stages: { 30: 'interested' } }));
  }

  it('never lists a client not linked under a สถานะการขาย (ยังไม่ติดต่อ is a company’s status)', () => {
    const rows = fixture();
    expect(filterRows(rows, 'none', '').map((r) => r.key).sort()).toEqual(['c10', 'c20', 'c40']);
    expect(filterRows(rows, 'interested', '').map((r) => r.key)).toEqual(['c30']);
    expect(filterRows(rows, '', '')).toHaveLength(rows.length);
    expect(filterRows(rows, '', '').filter((r) => !r.c)).toHaveLength(2);
  });

  it('finds every owner a row shows, the tracker job’s too; "-" is a row naming nobody', () => {
    const rows = fixture();
    // c10's owner comes from its job (the company has none); c20's company names one over its job's
    expect(filterRows(rows, '', 'มกร').map((r) => r.name).sort()).toEqual([COS[0].name, 'ไทยออยล์'].sort());
    expect(filterRows(rows, '', 'ปลา')).toEqual([]);
    expect(filterRows(rows, '', 'หมิว').map((r) => r.key)).toEqual(['c20']);
    expect(filterRows(rows, '', '-').map((r) => r.key).sort()).toEqual(['c30', 'nแสนสิริ']);
    expect(filterRows(rows, 'none', 'มกร').map((r) => r.key)).toEqual(['c10']);
  });

  it('offers the team, then the other names on the rows (by name, once each)', () => {
    const rows = fixture();
    expect(ownerChoices(['หมิว', 'คุณเอ', 'คุณบี'], rows)).toEqual(['หมิว', 'คุณเอ', 'คุณบี', 'มกร']);
    expect(ownerChoices([], [{ owner: 'ปลา' }, { owner: '' }, { owner: 'มกร' }, { owner: 'ปลา' }])).toEqual(['ปลา', 'มกร']);
    expect(ownerChoices(['หมิว', '', 'หมิว'], [])).toEqual(['หมิว']);
  });
});

describe('the tag', () => {
  it('says nothing for a company only followed', () => {
    expect(jobTag([])).toBe('');
  });
});
