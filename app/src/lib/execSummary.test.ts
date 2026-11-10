/**
 * The executive summary's numbers (lib/execSummary.ts) on a synthetic team: Company A, B, C, D and a person, no real
 * names or data. The engine is a real GccEngine with a small registry set on it, so the figures are read the way the
 * screens read them, and the parity checks read the same numbers from the existing functions.
 */
import { describe, expect, it } from 'vitest';
import { GccEngine } from './engine';
import { execPeriod, execSummary } from './execSummary';
import { followCounts, followRows } from './follow';
import { lineText, closedLine, closedTabRows } from './workUi';
import { emptySales, moneySum, newDeal, normSalesFilter, type ActType, type Deal, type DealAct, type SalesState } from './sales';
import type { Built, Company, LogEntry, Task } from './types';

const TODAY = '2026-10-14'; // a Wednesday: the week runs from Mon 12 Oct to today
const YEAR = '2569';
/** A timestamp at noon on a day, local: its local day is that day in any time zone. */
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString();

const co = (id: number, name: string) => ({ id, name, cfoSt: 'none', days: null, giDays: null, fl: {}, code: '', hay: name }) as unknown as Company;
/** The registry: 101 Company A, 102 Company B, 103 Company C. 104 was merged into 102. */
const REG = [co(101, 'Company A'), co(102, 'Company B'), co(103, 'Company C')];
const ALIAS: [number, number][] = [[104, 102]];

/** The tracker: jobs (open and closed, with their results and steps), free-text rows, and contact records (acts). */
function tracker(): SalesState {
  const s = emptySales();
  const deal = (id: string, p: Partial<Deal> & { client: string }, steps: Record<string, [string, string?]> = {}) => {
    s.deals[id] = newDeal({ id, year: YEAR, section: 'Retention', order: Object.keys(s.deals).length, ...p }, 'ทดสอบ', at('2026-09-01'));
    for (const [k, [d, n = '']] of Object.entries(steps)) s.steps[`${id}/${k}`] = { d, n };
  };
  // d1: an open job of Company A, contacted, quoted, followed up
  deal('d1', { client: 'Company A', gid: 101 }, { CONTACT: ['2026-10-01'], QUOTATION: ['2026-10-08'], FOLLOW: ['2026-10-10'] });
  deal('d2', { client: 'Company D' }); // a free-text row, not in the registry
  deal('d3', { client: 'Company A' }); // a free-text row named as Company A (the same company)
  deal('d4', { client: 'Company B', gid: 104, jobStatus: 'closed', closedDate: '2026-10-13', forecast: 250000, actual: 240000 },
    { 'CLOSED DEAL': ['2026-10-13', 'YES'], CONTACT: ['2026-09-20'], QUOTATION: ['2026-09-20', 'ส่งแล้ว'] });
  deal('d5', { client: 'Company C', gid: 103, jobStatus: 'closed', closedDate: '2026-10-13', forecast: 90000 },
    { 'CLOSED DEAL': ['2026-10-13', 'NO'], CONTACT: ['2026-09-25'] });
  deal('d6', { client: 'Company B', gid: 102, forecast: 999 }); // open, no result yet
  deal('d7', { client: 'Company A', gid: 101, jobStatus: 'closed', closedDate: '2026-10-06', forecast: 100000 }, { 'CLOSED DEAL': ['2026-10-06', 'YES'] });
  // contact records of the tracker (sales.acts)
  const acts: Record<string, DealAct> = {};
  const act = (id: string, deal: string, d: string, type: ActType) => (acts[`${deal}/${id}`] = { id, deal, d, type, note: '', stage: '', pid: '', by: 'ทดสอบ', at: at(d) });
  act('a1', 'd1', '2026-10-06', 'call'); // last week
  act('a2', 'd1', '2026-10-13', 'line'); // LINE, this week
  act('a3', 'd1', '2026-10-15', 'call'); // after today: not counted
  act('a4', 'd2', '2026-10-13', 'email'); // Company D, this week
  act('a5', 'd3', '2026-10-14', 'meet'); // Company A (free-text row), this week
  act('a6', 'gone', '2026-10-13', 'call'); // a deal not in the tracker: not counted
  s.acts = acts;
  return s;
}

/** The company log (crm.log). Notes, stage and owner records are not contacts; `p-` is a person with no company. */
function logs(): Record<string, LogEntry[]> {
  const L = (day: string, type: string, result = '') => ({ at: at(day), by: 'ทดสอบ', type, result }) as LogEntry;
  return {
    '101': [L('2026-07-10', 'call'), L('2026-09-10', 'call'), L('2026-10-12', 'call', 'ติดต่อได้'), L('2026-10-13', 'email', 'ขอข้อมูลเพิ่ม'),
      L('2026-10-13', 'note'), L('2026-10-13', 'stage'), L('2026-10-13', 'owner'), L('2026-10-15', 'call')],
    '102': [L('2026-10-06', 'call'), L('2026-10-13', 'meet')],
    '104': [L('2026-10-14', 'follow')], // merged into 102: counted there
    '103': [L('2026-10-01', 'call'), L('2026-10-13', 'note')],
    '999': [L('2026-10-13', 'call')], // not in the registry: left out
    'p-p1': [L('2026-10-13', 'call')], // a person with no company
  };
}

interface Fx { sales?: SalesState; log?: Record<string, LogEntry[]>; tasks?: Task[]; watch?: number[]; companies?: Company[]; people?: Record<string, { name: string }> }
/** A GccEngine with the synthetic registry, tracker, log and follow list set on it; nothing is read from disk. */
function engine(f: Fx = {}) {
  const e = new GccEngine();
  e.B = { byId: new Map((f.companies ?? REG).map((c) => [c.id, c])), alias: new Map(ALIAS) } as unknown as Built;
  e.sales = f.sales ?? emptySales();
  e.crm = { stages: {}, notes: {}, tasks: f.tasks ?? [], watch: f.watch ?? [], owners: {}, team: [], log: f.log ?? {} };
  e.people = (f.people ?? {}) as unknown as GccEngine['people'];
  return e;
}
const PEOPLE = { p1: { name: 'Synthetic Person' } };
const CH = (ks: { key: string; count: number }[]) => ks.map((k) => `${k.key}:${k.count}`).join(' ');

describe('execPeriod: the period and the stretch it is compared with', () => {
  it('a week runs from its Monday to today, compared with the same days of last week', () => {
    expect(execPeriod('week', TODAY)).toEqual({ kind: 'week', from: '2026-10-12', to: TODAY, days: 3, prevFrom: '2026-10-05', prevTo: '2026-10-07' });
  });
  it('a month runs from its 1st to today, compared with the same days of last month', () => {
    expect(execPeriod('month', TODAY)).toEqual({ kind: 'month', from: '2026-10-01', to: TODAY, days: 14, prevFrom: '2026-09-01', prevTo: '2026-09-14' });
  });
  it('a quarter runs from its first month to today, compared with the same days of the quarter before', () => {
    expect(execPeriod('quarter', TODAY)).toEqual({ kind: 'quarter', from: '2026-10-01', to: TODAY, days: 14, prevFrom: '2026-07-01', prevTo: '2026-07-14' });
  });
  it('a month compared with a shorter one stops at the end of that month', () => {
    expect(execPeriod('month', '2026-03-31')).toMatchObject({ from: '2026-03-01', prevFrom: '2026-02-01', prevTo: '2026-02-28' });
  });
  it('a month in January is compared with December of the year before', () => {
    expect(execPeriod('month', '2027-01-05')).toMatchObject({ from: '2027-01-01', prevFrom: '2026-12-01', prevTo: '2026-12-05' });
  });
});

describe('contacts and channels', () => {
  const e = engine({ sales: tracker(), log: logs(), people: PEOPLE });

  it('a week: 8 contacts, 2 before; the log and the tracker, the notes, the future and the unknown left out', () => {
    const s = execSummary(e, 'week', TODAY);
    expect(s.kpis.contacts).toEqual({ value: 8, prev: 2, delta: 6, pct: 3 });
    expect(s.total).toBe(8);
  });

  it('each contact is counted once, in one channel; the channels sum to the total', () => {
    const s = execSummary(e, 'week', TODAY);
    expect(CH(s.channels)).toBe('call:2 email:2 meet:2 follow:1 other:1');
    expect(s.channels.reduce((n, c) => n + c.count, 0)).toBe(s.total);
    expect(s.channels.map((c) => c.label)).toEqual(['โทร', 'อีเมล', 'นัดพบ', 'ติดตามผล', 'LINE/อื่นๆ']);
    expect(s.channels.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1, 10);
  });

  it('a month: 11 contacts, 1 in the month before', () => {
    const s = execSummary(e, 'month', TODAY);
    expect(s.kpis.contacts).toEqual({ value: 11, prev: 1, delta: 10, pct: 10 });
    expect(s.total).toBe(11);
    expect(CH(s.channels)).toBe('call:5 email:2 meet:2 follow:1 other:1');
  });

  it('a quarter: the quarter to date against the same days of the quarter before', () => {
    const s = execSummary(e, 'quarter', TODAY);
    expect(s.kpis.contacts).toEqual({ value: 11, prev: 1, delta: 10, pct: 10 });
  });

  it('the period before with no contacts has a null change, not a made-up one', () => {
    const s = execSummary(engine({}), 'month', TODAY);
    expect(s.kpis.contacts.pct).toBeNull();
  });
});

describe('เสนอบริการ: the companies sent an offer in the period, and those still waiting for a reply now', () => {
  const L = (day: string, type: string, result = '') => ({ at: at(day), by: 'ทดสอบ', type, result }) as LogEntry;
  const OFFER = 'รอติดต่อกลับ';
  // 101: offered in the month and still waiting; 102: offered last month, a later call got through; 103: offered and
  // waiting; 999: not in the registry, left out
  const log: Record<string, LogEntry[]> = {
    '101': [L('2026-10-13', 'email', OFFER)],
    '102': [L('2026-09-10', 'email', OFFER), L('2026-10-06', 'call', 'ติดต่อได้')],
    '103': [L('2026-10-13', 'email', OFFER)],
    '999': [L('2026-10-13', 'email', OFFER)],
  };

  it('a month: two companies sent in it, and two still waiting; the one a later call got through is not waiting', () => {
    expect(execSummary(engine({ sales: tracker(), log, people: PEOPLE }), 'month', TODAY).kpis.offers).toEqual({ sent: 2, waiting: 2 });
  });
  it('a week: the two sent on Tuesday are in it; the one sent last month is not, and the waiting count is the same', () => {
    expect(execSummary(engine({ sales: tracker(), log, people: PEOPLE }), 'week', TODAY).kpis.offers).toEqual({ sent: 2, waiting: 2 });
  });
});

describe('companies', () => {
  const e = engine({ sales: tracker(), log: logs(), people: PEOPLE });

  it('a week: Company A, Company B and Company D, each once; the person with no company is not one', () => {
    const s = execSummary(e, 'week', TODAY);
    expect(s.kpis.companies).toEqual({ value: 3, prev: 2, delta: 1, pct: 0.5 });
  });

  it('a month: A, B, C and D, each once, the merged company counted once with its two ids and a free-text row named as A is A', () => {
    expect(execSummary(e, 'month', TODAY).kpis.companies.value).toBe(4);
    expect(execSummary(e, 'month', TODAY).kpis.companies.prev).toBe(1);
  });
});

describe('deals won and their value', () => {
  const S = tracker();
  const e = engine({ sales: S, log: logs(), people: PEOPLE });

  it('a week: one job won (Company B, 250,000 forecast), one closed as lost', () => {
    const s = execSummary(e, 'week', TODAY);
    expect(s.kpis.won).toEqual({ jobs: 1, worked: 1, fc: 250000, ac: 240000, closedJobs: 2, lost: 1 });
  });

  it('a month: two jobs won (Company A and Company B), counted and valued as the ปิดงาน tab and moneySum give', () => {
    const s = execSummary(e, 'month', TODAY);
    expect(s.kpis.won).toEqual({ jobs: 2, worked: 2, fc: 350000, ac: 240000, closedJobs: 3, lost: 1 });
    // the same rows the ปิดงาน tab reads for this period and result, with the same functions
    const F = normSalesFilter({ year: YEAR, result: 'YES', date: { basis: 'closed', preset: 'custom', from: '2026-10-01', to: TODAY } });
    const rows = closedTabRows(S, F, TODAY);
    const t = e.workTally(rows);
    const m = moneySum(S, rows);
    expect(s.kpis.won).toMatchObject({ jobs: t.jobs, worked: t.worked, fc: m.fc, ac: m.ac });
    expect(lineText(closedLine(t, { fc: m.fc, ac: m.ac }))).toBe('ปิดแล้ว 2 งาน · ทำงานให้ 2 บริษัท · Forecast 350,000 · Actual 240,000');
  });

  it('an open job with no result is not a job won', () => {
    expect(execSummary(e, 'month', TODAY).kpis.won.jobs).toBe(2);
  });
});

describe('lost is a count of companies, as the ปิดงาน tab counts it', () => {
  it('two lost jobs of one company are one company lost; the jobs are counted apart', () => {
    const S = emptySales();
    const job = (id: string, gid: number, result: 'YES' | 'NO') => {
      S.deals[id] = newDeal({ id, year: YEAR, section: 'Retention', order: Object.keys(S.deals).length, client: 'Company C', gid, jobStatus: 'closed', closedDate: '2026-10-13' }, 'ทดสอบ', at('2026-09-01'));
      S.steps[`${id}/CLOSED DEAL`] = { d: '2026-10-13', n: result };
    };
    job('l1', 103, 'NO');
    job('l2', 103, 'NO');
    job('l3', 101, 'NO');
    const s = execSummary(engine({ sales: S }), 'month', TODAY);
    expect(s.kpis.won).toMatchObject({ closedJobs: 3, lost: 2 });
  });
});

describe('the period in a Sales Tracker year outside the bounds of today\'s year', () => {
  // year 2567 (CE 2024): a job of Company B closed in March 2025, a job of Company A closed on 13 Oct 2026
  const S = emptySales();
  const job = (id: string, p: Partial<Deal> & { client: string }, closedDate: string) => {
    S.deals[id] = newDeal({ id, year: '2567', section: 'Retention', order: Object.keys(S.deals).length, jobStatus: 'closed', closedDate, ...p }, 'ทดสอบ', at(closedDate));
    S.steps[`${id}/CLOSED DEAL`] = { d: closedDate, n: 'YES' };
  };
  job('y1', { client: 'Company B', gid: 102, forecast: 200000, actual: 190000 }, '2025-03-02');
  job('y2', { client: 'Company A', gid: 101, forecast: 100000, actual: 90000 }, '2026-10-13');
  const e = engine({ sales: S });

  it('this month: the job closed in March 2025 is not in it, the job closed on 13 Oct is', () => {
    const s = execSummary(e, 'month', TODAY, { year: '2567' });
    expect(s.kpis.won).toEqual({ jobs: 1, worked: 1, fc: 100000, ac: 90000, closedJobs: 1, lost: 0 });
  });

  it('a month of 2025 in the same year: the job closed in March 2025 counts, the one of 2026 does not', () => {
    const s = execSummary(e, 'month', '2025-03-10', { year: '2567' });
    expect(s.kpis.won).toEqual({ jobs: 1, worked: 1, fc: 200000, ac: 190000, closedJobs: 1, lost: 0 });
  });
});

describe('funnel: the year\'s customers, each stage counted from the app\'s own step rules', () => {
  it('contact, quotation, follow-up and won counts', () => {
    const s = execSummary(engine({ sales: tracker(), log: logs(), people: PEOPLE }), 'month', TODAY);
    expect(s.funnel.map((x) => [x.key, x.label, x.count])).toEqual([
      ['contact', 'ติดต่อประสานงาน', 3],
      ['quote', 'ส่งใบเสนอราคา', 2],
      ['follow', 'ติดตามผล', 1],
      ['won', 'ได้งาน', 2],
    ]);
  });
});

describe('follow-ups: the ติดตาม page\'s counts, overdue first, then today (no later appointment)', () => {
  const tasks: Task[] = [
    { id: 't1', gid: 101, title: '', type: 'call', date: '2026-10-10', time: '10:00', note: '', done: false },
    { id: 't2', gid: 104, title: '', type: 'call', date: '2026-10-14', time: '', note: '', done: false },
    { id: 't3', gid: 103, title: '', type: 'meet', date: '2026-10-20', time: '', note: '', done: false },
    { id: 't4', gid: 101, title: '', type: 'call', date: '2026-10-09', time: '', note: '', done: true },
  ];
  const e = engine({ sales: tracker(), log: logs(), people: PEOPLE, tasks, watch: [101, 102, 103] });

  it('the counts are the ติดตาม page\'s counts for the same day', () => {
    const page = followCounts(followRows(e, YEAR, TODAY), TODAY);
    const s = execSummary(e, 'month', TODAY);
    expect(s.kpis.followOverdue).toBe(page.late);
    expect(s.kpis.followDue).toBe(page.today);
    expect([s.kpis.followOverdue, s.kpis.followDue]).toEqual([1, 1]);
  });

  it('the list: overdue, then today, with the appointment in words', () => {
    const s = execSummary(e, 'month', TODAY);
    // Company C's appointment (20 Oct) is after today, so it is not in the list (the KPI counts overdue and today only)
    expect(s.followUps.map((r) => [r.name, r.group])).toEqual([
      ['Company A', 'overdue'],
      ['Company B', 'today'],
    ]);
    expect(s.followUps[0].when.kind).toBe('bad');
    expect(s.followUps[1].line).toContain('14 ต.ค.');
    expect(s.followUps[0].contact.startsWith('ติดต่อแล้ว')).toBe(true);
  });

  it('the list has no appointment after today, and its length is the KPI (overdue plus today)', () => {
    const s = execSummary(e, 'month', TODAY);
    expect(s.followUps.every((r) => r.next <= TODAY)).toBe(true);
    expect(s.followUps).toHaveLength(s.kpis.followOverdue + s.kpis.followDue);
  });

  it('the list shows at most ten companies, the oldest appointments first', () => {
    const names = 'ABCDEFGHIJKL'.split('');
    const companies = names.map((n, i) => co(201 + i, `Company ${n}`));
    const many: Task[] = companies.map((c, i) => ({ id: 'x' + i, gid: c.id, title: '', type: 'call', date: `2026-09-${String(i + 1).padStart(2, '0')}`, time: '', note: '', done: false }));
    const big = engine({ companies, tasks: many, watch: companies.map((c) => c.id) });
    const s = execSummary(big, 'month', TODAY);
    expect(s.kpis.followOverdue).toBe(12);
    expect(s.followUps).toHaveLength(10);
    expect(s.followUps[0].name).toBe('Company A');
    expect(s.followUps[9].name).toBe('Company J');
  });
});

describe('recent contacts and the four buckets of the period', () => {
  const e = engine({ sales: tracker(), log: logs(), people: PEOPLE });

  it('the newest eight of the month, the person included by name', () => {
    const s = execSummary(e, 'month', TODAY);
    expect(s.recent).toHaveLength(8);
    const days = s.recent.map((r) => r.day);
    expect(days).toEqual([...days].sort().reverse());
    expect(days[0]).toBe('2026-10-14');
    expect(s.recent.some((r) => r.name === 'Synthetic Person')).toBe(true);
    expect(s.recent.every((r) => r.day >= '2026-10-12')).toBe(true);
  });

  it('a contact filed at a step shows the step in Thai, the close step without "(YES / NO)", not its code', () => {
    const S = tracker();
    const acts: Record<string, DealAct> = S.acts ?? {};
    acts['d1/a2'].stage = 'FOLLOW'; // LINE on Company A's job, filed at FOLLOW
    acts['d2/a4'].stage = 'CLOSED DEAL'; // an e-mail to Company D, filed at the close step
    acts['d3/a5'].stage = 'QUOTATION'; // a meeting on Company A's free-text row, filed at QUOTATION
    const s = execSummary(engine({ sales: S, log: logs(), people: PEOPLE }), 'week', TODAY);
    expect(Object.fromEntries(s.recent.filter((r) => r.deal).map((r) => [r.deal, r.result]))).toEqual({ d1: 'ติดตามผล', d2: 'ผลการขาย', d3: 'ส่งใบเสนอราคา' });
    expect(s.recent.some((r) => /[A-Z]/.test(r.result))).toBe(false);
  });

  it('a month in four buckets that cover it in order, their counts adding to the contacts', () => {
    const s = execSummary(e, 'month', TODAY);
    expect(s.weeks.map((w) => [w.from, w.to, w.count])).toEqual([
      ['2026-10-01', '2026-10-03', 1],
      ['2026-10-04', '2026-10-07', 2],
      ['2026-10-08', '2026-10-10', 0],
      ['2026-10-11', '2026-10-14', 8],
    ]);
    expect(s.weeks.reduce((n, w) => n + w.count, 0)).toBe(s.total);
  });

  it('a week: the buckets split its three days, the first empty', () => {
    const s = execSummary(e, 'week', TODAY);
    expect(s.weeks.map((w) => w.count)).toEqual([0, 1, 5, 2]);
    expect(s.weeks[0]).toEqual({ from: '', to: '', count: 0 });
  });
});

describe('an empty engine gives zeros and empty lists', () => {
  it('every figure is zero and every list empty', () => {
    const s = execSummary(engine({}), 'month', TODAY);
    expect(s.kpis).toEqual({
      contacts: { value: 0, prev: 0, delta: 0, pct: null },
      companies: { value: 0, prev: 0, delta: 0, pct: null },
      won: { jobs: 0, worked: 0, fc: 0, ac: 0, closedJobs: 0, lost: 0 },
      followOverdue: 0,
      followDue: 0,
      offers: { sent: 0, waiting: 0 },
    });
    expect(s.total).toBe(0);
    expect(s.channels.map((c) => [c.count, c.share])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
    expect(s.weeks.map((w) => w.count)).toEqual([0, 0, 0, 0]);
    expect(s.funnel.map((x) => x.count)).toEqual([0, 0, 0, 0]);
    expect(s.recent).toEqual([]);
    expect(s.followUps).toEqual([]);
  });
});
