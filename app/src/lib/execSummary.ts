/**
 * The one-page executive summary (หน้าสรุปผู้บริหาร): what the team contacted in a week, a month or a quarter, how,
 * which companies, the jobs it won and their money, the sales funnel, and what needs a follow-up. Pure: an engine (or
 * any source with the reads of ExecSrc) in, numbers out, nothing written. Every figure is the rule the screen it
 * summarises already uses, so the page agrees with them:
 * - contacts: the company log's call, e-mail, meeting and follow entries (COMPANY_CONTACT) and the Sales Tracker's
 *   contact records (sales.acts) of a deal that exists; a person with no company is a contact, not a company;
 * - companies: companyCount, the Dashboard's count (a free-text row named as a linked company is that company);
 * - jobs won and their money: the ปิดงาน tab's rows with result YES (the same closed-day rule, workTally, moneySum);
 * - follow-ups: the ติดตาม page's rows and counts (followRows, followCounts, followContact).
 * The only rules of its own are the period (execPeriod), the four buckets of the period, and the funnel's map of
 * the app's steps onto four stages.
 */
import { inRange, monthStart, weekStart, type Range } from './dateRange';
import { addDays, daysBetween, localDay } from './format';
import { LOG_TYPES } from './constants';
import { COMPANY_CONTACT, apptLine, apptWhen, followContact, followContactWords, followCounts, followRows, type FollowRow, type FollowSrc } from './follow';
import {
  ACT_TH, actsOf, beYear, customersOf, dateMatch, dealResult, filterDeals, jointAttr, moneySum, newDeal, normSalesFilter, quoteSent, salesStats, stepLabel, withActIndex,
  type ActType, type Deal, type SalesState, type WorkTally,
} from './sales';
import { CONTACT_STEP, FOLLOW_STEP, QUOTE_STAGE, teamSteps } from './steps';
import type { Company, LogEntry } from './types';

export type ExecPeriodKind = 'week' | 'month' | 'quarter';
export const EXEC_PERIODS: ExecPeriodKind[] = ['week', 'month', 'quarter'];

/** A period: its first day to today (inclusive), and the stretch it is compared with. */
export interface ExecPeriod { kind: ExecPeriodKind; from: string; to: string; days: number; prevFrom: string; prevTo: string }

/**
 * The period a page reads, anchored on `today` (YYYY-MM-DD): a week from its Monday, a month from its 1st, a quarter
 * from its first month. The comparison is the same stretch of the period before: a week 7 days back, a month and a
 * quarter the one before it (the same number of days, stopped at that period's end when it is shorter).
 */
export function execPeriod(kind: ExecPeriodKind, today: string): ExecPeriod {
  const m = +today.slice(5, 7);
  const from = kind === 'week' ? weekStart(today) : kind === 'month' ? monthStart(today) : monthStart(today, -((m - 1) % 3));
  const prevFrom = kind === 'week' ? addDays(from, -7) : monthStart(from, kind === 'month' ? -1 : -3);
  const offset = daysBetween(from, today);
  const prevEnd = addDays(from, -1);
  return { kind, from, to: today, days: offset + 1, prevFrom, prevTo: addDays(prevFrom, Math.min(offset, daysBetween(prevFrom, prevEnd))) };
}

/** A channel of contact. `other` is the app's LINE and อื่นๆ together (one row of the page). */
export type ExecChannel = 'call' | 'email' | 'meet' | 'follow' | 'other';
const CHANNELS: { key: ExecChannel; label: string }[] = [
  { key: 'call', label: LOG_TYPES.call[0] },
  { key: 'email', label: LOG_TYPES.email[0] },
  { key: 'meet', label: LOG_TYPES.meet[0] },
  { key: 'follow', label: LOG_TYPES.follow[0] },
  { key: 'other', label: `${ACT_TH.line}/${ACT_TH.other}` },
];
const chOfAct = (t: ActType): ExecChannel => (t === 'call' || t === 'email' || t === 'meet' ? t : 'other');
const RECENT_MAX = 8;
const FOLLOW_MAX = 10;

/** What the summary reads. The engine (GccEngine) has all of it; a test may pass its own. */
export interface ExecSrc extends FollowSrc {
  crm: FollowSrc['crm'] & { log: Record<string, LogEntry[]> };
  /** Contact persons by id (`p-<pid>` log keys read their names here). */
  people?: Record<string, { name: string }>;
  canonical(id: number): number;
  /** The engine's workTally (the company key of a merged company, its registry name as an alias). */
  workTally(deals: Deal[], o?: { attr?: boolean }): WorkTally;
  /** The engine's companyCount. */
  companyCount(deals: Deal[]): number;
}

/** A count against the period before it. `pct` is null when that period had none. */
export interface ExecChange { value: number; prev: number; delta: number; pct: number | null }
export interface ExecChannelRow { key: ExecChannel; label: string; count: number; share: number }
export interface ExecWeek { from: string; to: string; count: number }
export type ExecStageKey = 'contact' | 'quote' | 'follow' | 'won';
export interface ExecStage { key: ExecStageKey; label: string; count: number }
/** One contact. `deal`: the job it was logged on ('' for a company's or a person's own log). */
export interface ExecEntry { day: string; name: string; channel: string; result: string; companyId: number | null; deal: string }
export type ExecGroup = 'overdue' | 'today' | 'upcoming';
export interface ExecFollowUp {
  id: number; name: string; group: ExecGroup; next: string;
  when: { text: string; kind: 'bad' | 'warn' | '' };
  /** The appointment in words ("โทร · 14 ต.ค. 2569"); '' when it has none. */
  line: string;
  /** The contact line under the name (ติดต่อแล้ว · ล่าสุด …, or ยังไม่ได้ติดต่อ). */
  contact: string;
  owner: string;
}
export interface ExecSummary {
  period: ExecPeriod;
  kpis: {
    contacts: ExecChange;
    companies: ExecChange;
    won: { jobs: number; worked: number; fc: number; ac: number; closedJobs: number; lost: number };
    followOverdue: number;
    followDue: number;
  };
  channels: ExecChannelRow[];
  total: number;
  weeks: ExecWeek[];
  funnel: ExecStage[];
  recent: ExecEntry[];
  followUps: ExecFollowUp[];
}

/** One contact. `row`: the deal-like row companyCount reads for its company (null for a person with none). */
interface Entry { day: string; at: string; ch: ExecChannel; name: string; result: string; companyId: number | null; row: Deal | null; deal: string }

/**
 * Every contact from `from` to `today`, each counted once: the company log (a person with no company under
 * `p-<pid>`; an entry of a company no longer in the registry is left out, as its company page leaves it out too) and
 * the contact records of the deals in the tracker. A note, a stage or an owner change is not a contact.
 */
function contactsOf(src: ExecSrc, S: SalesState, from: string, today: string): Entry[] {
  const out: Entry[] = [];
  const stubs = new Map<number, Deal>();
  const span = (day: string) => day >= from && day <= today;
  // a company's row for companyCount, once: its registry id is its key, its registry name the alias of a free-text row
  const stubOf = (co: Company) => {
    let row = stubs.get(co.id);
    if (!row) stubs.set(co.id, (row = newDeal({ id: 'co-' + co.id, client: co.name, gid: co.id }, '', today)));
    return row;
  };
  for (const [key, logs] of Object.entries(src.crm.log)) {
    const person = key.startsWith('p-');
    const co = person ? undefined : src.company(src.canonical(Number(key)));
    if (!person && !co) continue;
    for (const l of logs) {
      if (!COMPANY_CONTACT.includes(l.type) || !l.at) continue;
      const day = localDay(l.at);
      if (!span(day)) continue;
      out.push({
        day, at: l.at, ch: l.type as ExecChannel,
        name: co ? co.name : (src.people?.[key.slice(2)]?.name ?? ''),
        result: l.result || '',
        companyId: co ? co.id : null,
        row: co ? stubOf(co) : null,
        deal: '',
      });
    }
  }
  for (const d of Object.values(S.deals)) {
    const co = d.gid != null ? src.company(src.canonical(d.gid)) : undefined;
    for (const a of actsOf(S, d.id)) {
      if (!span(a.d)) continue;
      out.push({
        day: a.d, at: a.at || a.d, ch: chOfAct(a.type),
        name: co?.name || d.client,
        result: a.stage ? stepLabel(S, d, a.stage, today).code : '',
        companyId: co ? co.id : null,
        row: d,
        deal: d.id,
      });
    }
  }
  return out;
}

const change = (value: number, prev: number): ExecChange => ({ value, prev, delta: value - prev, pct: prev ? (value - prev) / prev : null });
const FOLLOW_ORDER: Record<ExecGroup, number> = { overdue: 0, today: 1, upcoming: 2 };

/**
 * The summary for a period of the team's work, read on `today`. `opts.year`: the Sales Tracker year the jobs and the
 * follow-ups are read in (B.E.; default the year of today). The funnel is a snapshot of that year's jobs (not of the
 * period). Empty data gives zeros and empty lists.
 */
export function execSummary(src: ExecSrc, kind: ExecPeriodKind, today: string, opts: { year?: string } = {}): ExecSummary {
  const S = src.sales;
  return withActIndex(S, () => summarize(src, S, execPeriod(kind, today), today, opts.year || beYear(today)));
}

function summarize(src: ExecSrc, S: SalesState, P: ExecPeriod, today: string, year: string): ExecSummary {
  const cur: Range = { from: P.from, to: P.to }, prev: Range = { from: P.prevFrom, to: P.prevTo };
  const all = contactsOf(src, S, P.prevFrom, today);
  const now = all.filter((e) => inRange(e.day, cur));
  const before = all.filter((e) => inRange(e.day, prev));
  const rowsOf = (xs: Entry[]) => xs.flatMap((e) => (e.row ? [e.row] : []));
  const companies = src.companyCount(rowsOf(now));
  const companiesBefore = src.companyCount(rowsOf(before));

  const counts = CHANNELS.map((c) => ({ ...c, count: now.filter((e) => e.ch === c.key).length }));
  const total = counts.reduce((n, c) => n + c.count, 0);
  const channels: ExecChannelRow[] = counts.map((c) => ({ ...c, share: total ? c.count / total : 0 }));

  // four buckets that cover the period in order, each about a quarter of its days (the first may be empty for a short week)
  const weeks: ExecWeek[] = [0, 1, 2, 3].map((i) => {
    const a = Math.floor((i * P.days) / 4), b = Math.floor(((i + 1) * P.days) / 4) - 1;
    if (b < a) return { from: '', to: '', count: 0 };
    const r = { from: addDays(P.from, a), to: addDays(P.from, b) };
    return { ...r, count: now.filter((e) => inRange(e.day, r)).length };
  });

  // the funnel: the year's customers (no joint header), each step counted once per job that has it
  const pop = customersOf(S, filterDeals(S, { year }, today));
  const stats = salesStats(S, pop, today);
  const stageN = (id: string) => stats.stages.find((g) => g.name === id)?.n ?? 0;
  const th = (id: string) => teamSteps(S.cfg).find((x) => x.id === id)?.th ?? id;
  const funnel: ExecStage[] = [
    { key: 'contact', label: th(CONTACT_STEP), count: stageN(CONTACT_STEP) },
    { key: 'quote', label: th(QUOTE_STAGE), count: pop.filter((d) => quoteSent(S, d, today)).length },
    { key: 'follow', label: th(FOLLOW_STEP), count: stageN(FOLLOW_STEP) },
    { key: 'won', label: 'ได้งาน', count: pop.filter((d) => dealResult(S, d) === 'YES').length },
  ];

  // the jobs closed in the period (the ปิดงาน tab's rows: the job closed, its closed day in the period), and of them the
  // ones won (result YES). The period is read on the closed day here, not through the tab's date filter: normDateF drops
  // a custom range outside the bounds of its year, which would give a whole-year figure under the period's label.
  const closedIn = (result?: 'YES') =>
    filterDeals(S, { year, job: 'closed', result }, today).filter((d) => dateMatch(S, d, cur, 'closed', today) !== null);
  const attr = jointAttr(normSalesFilter({ year }));
  const closed = src.workTally(closedIn(), { attr });
  const wonRows = closedIn('YES');
  const won = src.workTally(wonRows, { attr });
  const money = moneySum(S, wonRows, attr);

  // the follow-ups: the ติดตาม page's companies with an appointment, overdue first, then today, then upcoming
  const fRows = followRows(src, year, today);
  const fc = followCounts(fRows, today);
  const groupOf = (r: FollowRow): ExecGroup => (r.next < today ? 'overdue' : r.next === today ? 'today' : 'upcoming');
  const followUps: ExecFollowUp[] = fRows
    .filter((r) => r.next)
    .map((r) => ({ r, group: groupOf(r) }))
    .sort((a, b) => FOLLOW_ORDER[a.group] - FOLLOW_ORDER[b.group] || a.r.next.localeCompare(b.r.next) || a.r.name.localeCompare(b.r.name, 'th'))
    .slice(0, FOLLOW_MAX)
    .map(({ r, group }) => ({
      id: r.c.id, name: r.name, group, next: r.next,
      when: apptWhen(r.next, today),
      line: r.task ? apptLine(r.task) : '',
      contact: followContactWords(followContact(src.crm.log[r.c.id] || [], src.dealsOf(r.c.id), S, today, src.tasksOf(r.c.id))),
      owner: r.owner,
    }));

  const recent: ExecEntry[] = now
    .slice()
    .sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at))
    .slice(0, RECENT_MAX)
    .map((e) => ({ day: e.day, name: e.name, channel: CHANNELS.find((c) => c.key === e.ch)?.label ?? '', result: e.result, companyId: e.companyId, deal: e.deal }));

  return {
    period: P,
    kpis: {
      contacts: change(now.length, before.length),
      companies: change(companies, companiesBefore),
      won: { jobs: won.jobs, worked: won.worked, fc: money.fc, ac: money.ac, closedJobs: closed.jobs, lost: closed.lost },
      followOverdue: fc.late,
      followDue: fc.today,
    },
    channels, total, weeks, funnel, recent, followUps,
  };
}
