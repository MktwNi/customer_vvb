/**
 * แผนติดต่อ's "รายชื่อที่ต้องติดต่อ" (tabs/Plan.tsx): the team's real work, never a registry list. Its rows are
 * the companies the team follows (crm.watch, "ติดตาม") and the open Sales Tracker jobs of the tracker's year
 * (not closed, not lost, not won-and-paid; a joint quotation's header is not a customer, its member companies
 * are), one row per company: a company followed and in the tracker, or with two jobs, is one row. A job whose
 * client is not linked to a company in the register (deal.gid null, or a company no longer there) is a row of
 * its own, one per client name; an appointment needs a company id, so it is opened in the tracker instead.
 * Pure functions over the engine's state, so they are unit-tested. No DOM.
 */
import { addDays } from './format';
import { norm } from './core';
import { OVERDUE_DAYS, closeReady, dealResult, jointRole, overdueDays, type Deal, type SalesState } from './sales';
import { nextStepView, type NextStepView } from './salesUi';
import type { StageKey, Task } from './types';

/** Where the list comes from: ทั้งหมดที่ต้องติดต่อ (both), ที่ติดตาม, Sales Tracker (งานที่ยังเปิดอยู่). */
export type PlanSrc = 'all' | 'watch' | 'sales';
/** ui.plFeed → the list's source. The list used to be a registry feed ('cfoSoon', 'giSoon', …): such a value,
 *  anything unknown or nothing is the default (both); 'watch' was the followed feed and still is. */
export function planSrc(v: unknown): PlanSrc {
  return v === 'watch' || v === 'sales' ? v : 'all';
}

/** One open tracker job on a row: its next step as the tracker's table words it ("ถัดไป FOLLOW1 ติดตามครั้งที่
 *  1"), the date it is about ('' none: a step not planned yet), and whether that date has passed (the step's
 *  installment is late, or nobody has contacted the client for more than OVERDUE_DAYS: `idle` days). */
export interface PlanJob { deal: Deal; next: NextStepView; when: string; late: boolean; idle: number | null }
/** A row: the company (null = a client not linked to the register), its name and phone (the job's when the
 *  register has none), who is responsible (the company's ผู้รับผิดชอบ, else the job's), its sales status (null
 *  for a client not linked: the status is a company's, so a สถานะการขาย filter never lists it), where it comes
 *  from (followed, its jobs most urgent first), its first open appointment, and the date to act on (the
 *  appointment's or the jobs', the earliest) with whether it has passed. `idle`: days since a job's client
 *  was last contacted when that is too long and no appointment ahead takes care of it (null else). */
export interface PlanRow<C extends PlanCo = PlanCo> {
  key: string;
  c: C | null;
  name: string;
  phone: string;
  owner: string;
  stage: StageKey | null;
  watch: boolean;
  jobs: PlanJob[];
  task: Task | null;
  when: string;
  late: boolean;
  idle: number | null;
}
/** What the list reads of a company. */
export interface PlanCo { id: number; name: string; phone: string }
export interface PlanIn<C extends PlanCo = PlanCo> {
  /** a company by any of its ids (a merged id resolves to the company it is part of) */
  company: (id: number) => C | undefined;
  /** the ids followed (crm.watch) */
  watch: readonly number[];
  /** every appointment (done ones are skipped) */
  tasks: readonly Task[];
  /** crm.owners / crm.stages, by company id */
  owners: Readonly<Record<string, string>>;
  stages: Readonly<Record<string, StageKey>>;
  /** the Sales Tracker; null for an account that does not see it */
  sales: SalesState | null;
  /** the tracker's year (B.E.) */
  year: string;
  today: string;
}

/** A tracker job still to be worked on, of `year`: open, not lost, not won and fully paid (it needs closing,
 *  not a call, as overdueDays says), and not a joint quotation's header (its members are the customers). */
export function openJob(s: SalesState, d: Deal, year: string, today: string): boolean {
  return d.year === year && d.jobStatus !== 'closed' && dealResult(s, d) !== 'NO' && jointRole(s, d) !== 'header' && !closeReady(s, d, today);
}

function jobOf(s: SalesState, d: Deal, today: string): PlanJob {
  const next = nextStepView(s, d, today);
  // a step planned ahead is in hand, however long ago the last contact was (as the tracker's table says it)
  const idle = next.kind === 'overdue' ? overdueDays(s, d, today) : null;
  let when = '';
  if (next.kind === 'planned') when = s.steps[`${d.id}/${next.stage}`]?.d || '';
  else if (next.kind === 'pay' && next.line?.due) when = next.line.due;
  // not contacted for too long: the step was due OVERDUE_DAYS after the last contact
  else if (idle != null) when = addDays(today, OVERDUE_DAYS - idle);
  const late = idle != null || next.tone === 'late' || (!!when && when < today);
  return { deal: d, next, when, late, idle };
}
/** Most urgent first: late, then by date, then the rest in the tracker's row order. */
const byUrgency = (a: PlanJob, b: PlanJob) =>
  +b.late - +a.late || (a.when ? (b.when ? a.when.localeCompare(b.when) : -1) : b.when ? 1 : 0) || a.deal.order - b.deal.order || a.deal.id.localeCompare(b.deal.id);

/** Every row, in the list's order: what needs action first (a late appointment or job, the oldest first), then
 *  what is dated (an appointment, a step planned in the tracker, an installment's due date: the soonest first),
 *  then what has no date at all (jobs before companies only followed, by name). */
export function planRows<C extends PlanCo>(x: PlanIn<C>): PlanRow<C>[] {
  const rows = new Map<string, PlanRow<C>>();
  const row = (key: string, c: C | null, name: string): PlanRow<C> => {
    let r = rows.get(key);
    if (!r) {
      r = { key, c, name, phone: c?.phone || '', owner: c ? x.owners[c.id] || '' : '', stage: c ? x.stages[c.id] || 'none' : null, watch: false, jobs: [], task: null, when: '', late: false, idle: null };
      rows.set(key, r);
    }
    return r;
  };
  for (const id of x.watch) {
    const c = x.company(id);
    if (c) row('c' + c.id, c, c.name).watch = true;
  }
  const S = x.sales;
  if (S)
    for (const d of Object.values(S.deals)) {
      if (!openJob(S, d, x.year, x.today)) continue;
      const c = d.gid != null ? x.company(d.gid) : undefined;
      const k = norm(d.client);
      const r = c ? row('c' + c.id, c, c.name) : row(k ? 'n' + k : 'd' + d.id, null, d.client.trim() || 'ไม่มีชื่อลูกค้า');
      r.jobs.push(jobOf(S, d, x.today));
    }
  // the first open appointment of each company (any of its ids)
  const first = new Map<number, Task>();
  for (const t of x.tasks) {
    if (t.done) continue;
    const c = x.company(t.gid);
    if (!c) continue;
    const f = first.get(c.id);
    if (!f || t.date < f.date || (t.date === f.date && (t.time || '') < (f.time || ''))) first.set(c.id, t);
  }
  const out = [...rows.values()];
  for (const r of out) {
    r.jobs.sort(byUrgency);
    if (!r.phone) r.phone = r.jobs.find((y) => y.deal.phone)?.deal.phone || '';
    if (!r.owner) r.owner = r.jobs.find((y) => y.deal.resp)?.deal.resp || '';
    r.task = r.c ? first.get(r.c.id) || null : null;
    const taskLate = !!r.task && r.task.date < x.today;
    // an appointment ahead is the contact a job not contacted for long is waiting for: in hand, not late (a
    // late installment or a planned step that passed stays late)
    const ahead = !!r.task && !taskLate;
    const lateJobs = r.jobs.filter((y) => y.late && !(ahead && y.idle != null));
    r.late = taskLate || lateJobs.length > 0;
    r.idle = ahead ? null : r.jobs.find((y) => y.idle != null)?.idle ?? null;
    // a late row is dated by what is late (the oldest first); any other by its soonest date
    const dated = r.late ? [taskLate ? r.task!.date : '', ...lateJobs.map((y) => y.when)] : [r.task?.date || '', ...r.jobs.filter((y) => !(ahead && y.idle != null)).map((y) => y.when)];
    r.when = dated.filter(Boolean).sort()[0] || '';
  }
  const group = (r: PlanRow<C>) => (r.late ? 0 : r.when ? 1 : 2);
  return out.sort(
    (a, b) =>
      group(a) - group(b) ||
      (a.when && b.when ? a.when.localeCompare(b.when) : a.when ? -1 : b.when ? 1 : 0) ||
      +!a.jobs.length - +!b.jobs.length ||
      a.name.localeCompare(b.name, 'th') ||
      a.key.localeCompare(b.key),
  );
}

/** The rows of one source. */
export const rowsOf = <R extends Pick<PlanRow, 'watch' | 'jobs'>>(rows: readonly R[], src: PlanSrc): R[] =>
  src === 'watch' ? rows.filter((r) => r.watch) : src === 'sales' ? rows.filter((r) => r.jobs.length > 0) : rows.slice();
/** How many rows each source has (the picker's counts). */
export function srcCounts(rows: readonly Pick<PlanRow, 'watch' | 'jobs'>[]): Record<PlanSrc, number> {
  return { all: rows.length, watch: rows.filter((r) => r.watch).length, sales: rows.filter((r) => r.jobs.length > 0).length };
}

/** The two filters over the rows: สถานะการขาย (a client not linked has none, so it is left out whenever one is
 *  set) and ผู้รับผิดชอบ ('-' = nobody: neither the company nor its jobs name one). '' = any. */
export function filterRows<R extends Pick<PlanRow, 'stage' | 'owner'>>(rows: readonly R[], stage: StageKey | '', owner: string): R[] {
  return rows.filter((r) => (!stage || r.stage === stage) && (!owner || (owner === '-' ? !r.owner : r.owner === owner)));
}
/** The names the ผู้รับผิดชอบ filter offers: the team, then whoever else a row names (a tracker job's
 *  ผู้รับผิดชอบ outside the team), by name, so every owner on a row can be picked (the tracker's owner picker
 *  merges the team with deal.resp the same way). */
export function ownerChoices(team: readonly string[], rows: readonly Pick<PlanRow, 'owner'>[]): string[] {
  const t = new Set(team.filter(Boolean));
  const more = [...new Set(rows.map((r) => r.owner).filter((o) => o && !t.has(o)))].sort((a, b) => a.localeCompare(b, 'th'));
  return [...t, ...more];
}

/** A row with a plan: an open appointment, or a tracker job whose next step is set on a date ahead ("นัด 20
 *  ต.ค." in its tag: the tracker's plan for that contact). An installment's due date or a contact overdue is
 *  not a plan, it is a reason to call. "ยังไม่มีแผน" on the page (the count, and what "นัดรายที่ยังไม่มีแผน"
 *  books) is the rows without one. */
export const hasPlan = (r: Pick<PlanRow, 'task' | 'jobs'>) => !!r.task || r.jobs.some((j) => j.next.kind === 'planned');
/** The companies "นัดรายที่ยังไม่มีแผน" books, in the list's order: rows with a company of the register (an
 *  appointment needs one) and no plan. */
export function unplanned<C extends PlanCo>(rows: readonly PlanRow<C>[]): C[] {
  return rows.flatMap((r) => (r.c && !hasPlan(r) ? [r.c] : []));
}

/** A job's tag: "Sales Tracker · ถัดไป FOLLOW1 ติดตามครั้งที่ 1" (the tracker table's next-step words: "นัด 20
 *  ต.ค." for a planned step, the installment's state at a PAY stage); "Sales Tracker 2 งาน · …" when the
 *  company has more than one (the most urgent one is named). A number stays on the line of the word before
 *  it and of "วัน" after it (no-break spaces), so a narrow tag never ends a line on "ครั้งที่". */
export function jobTag(jobs: readonly Pick<PlanJob, 'next'>[]): string {
  if (!jobs.length) return '';
  const n = jobs[0].next;
  const what = (n.stage ? `ถัดไป ${n.stage}${n.hint ? ' ' + n.hint : ''}` : n.hint).replace(/ (?=\d)/g, NBSP).replace(/(\d) (?=วัน)/g, '$1' + NBSP);
  return `Sales Tracker${jobs.length > 1 ? ` ${jobs.length} งาน` : ''}${what ? ' · ' + what : ''}`;
}
const NBSP = '\u00a0';
