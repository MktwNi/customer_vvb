/** Small pure helpers behind the Sales Tracker screens (no DOM, so they are unit-tested). */
import { addDays, daysBetween, dmTh, dow, localDay, todayISO } from './format';
import { basisDates, customersOf, filterDeals, jobServices, jointAttr, jointHeadOf, jointRole, listValues, NONE, payerDeal, sectionsFor, stepContactDay, withActIndex, workTally, type DateBasis, type ListF, type ListKey, type ResultF, type SalesFilter } from './sales';
import {
  DEAL_STAGE, HOW_TH, KIND_TH, PAY_STATUS_TH, QUOTE_STAGE, beYear, closeReady, stepCode, countedAt, dealMoney, dealResult, dealStatus, dealSteps, docMismatch, docsOf, dupCounted, fmtMoney, lastStage, mismatchText, overdueDays, payState, stepOf,
  type Deal, type DealAct, type DealDoc, type DealSteps, type LineView, type PayLine, type PlanView, type SalesCfg, type SalesState, type SalesStats, type StepView,
} from './sales';
import type { FField, FOpt } from '../components/FilterBar';
import { withSvc } from './jobs';

/**
 * A Buddhist-era year typed by a person ("2569", "พ.ศ. 2569", Thai digits too) → `{ year }`.
 * A Christian-era year ("2026") → `{ year: '2569', ce: '2026' }`, for the caller to confirm.
 * Anything else → null.
 */
export function beYearInput(v: string): { year: string; ce?: string } | null {
  const s = v.trim().replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50)).replace(/\s+/g, '');
  let m = /^(?:พ\.?ศ\.?)?(25\d\d)$/.exec(s);
  if (m) return { year: m[1] };
  m = /^(?:ค\.?ศ\.?)?(20\d\d)$/.exec(s);
  if (m) return { year: String(+m[1] + 543), ce: m[1] };
  return null;
}

/** Years offered by the year picker: this year ±1, the one shown, every year that has deals, and (`money`,
 *  the money views) every year an installment is received or due in (cashYears). */
export function yearOptions(deals: Iterable<Deal>, shown: string, now = beYear(), money: Iterable<string> = []) {
  const ys = new Set([now, String(+now + 1), String(+now - 1), shown, ...money]);
  for (const d of deals) ys.add(d.year);
  return [...ys].sort();
}

// ------------------------------------------------------------------ the filter row (filters spec §6)

/** Filters when the tracker's year changes (filters spec §7.6), from wherever it changes (the year picker,
 *  ส่งเข้า Sales Tracker, an import's "ดูตารางปี", the Dashboard's own row): a date range goes back to the
 *  whole year (a named range of the old year is not one of the new year's), the other filters stay. */
export function withoutDate<F extends { date?: unknown }>(f: F): F {
  if (!f.date) return f;
  const { date: _d, ...rest } = f;
  return rest as F;
}

/** What each date basis is called: in the basis list (`label`, `sub`), the hint under it, the chip's
 *  and caption's word (`short`), the column heading in the rows (`head`) and the popover's sentence. */
export const BASIS_TH: Record<DateBasis, { label: string; sub: string; hint: string; short: string; head: string; sent: string }> = {
  contact: { label: 'มีการติดต่อ', sub: 'ติดต่อแล้ว ไม่นับนัดล่วงหน้า', hint: 'นับวันที่ติดต่อที่พิมพ์ไว้ วันที่ของขั้นตอน และบันทึกการติดต่อ ที่ไม่เกินวันนี้', short: 'ติดต่อ', head: 'ติดต่อล่าสุด', sent: 'งานที่มีการติดต่อ' },
  added: { label: 'เพิ่มเข้าตาราง', sub: 'วันที่ส่งเข้า Sales Tracker', hint: 'นับวันที่ลูกค้าถูกเพิ่มเข้าตารางของปีนี้', short: 'เพิ่มเข้าตาราง', head: 'เพิ่มเข้าตาราง', sent: 'งานที่เพิ่มเข้าตาราง' },
  result: { label: 'ได้ผลการขาย', sub: 'ได้งาน / ไม่ได้งาน', hint: 'นับวันที่ของขั้น CLOSE เมื่อรู้ผลแล้ว ทั้งได้งานและไม่ได้งาน', short: 'ได้ผลการขาย', head: 'วันที่ได้ผล', sent: 'งานที่ได้ผลการขาย' },
  paid: { label: 'รับเงิน', sub: 'งวดที่รับเงินแล้ว', hint: 'นับวันที่รับเงินของแต่ละงวด งานที่ไม่มีแผนนับวันที่ของขั้น PAY ที่ทำแล้ว', short: 'รับเงิน', head: 'รับเงิน', sent: 'งานที่รับเงิน' },
  due: { label: 'ครบกำหนดชำระ', sub: 'งวดตามแผนการชำระ', hint: 'นับวันครบกำหนดของงวดในแผนการชำระ ไม่นับงวดที่ยกเลิก', short: 'ครบกำหนด', head: 'ครบกำหนด', sent: 'งานที่มีงวดครบกำหนด' },
  closed: { label: 'ปิดงาน', sub: 'วันที่กดปิดงาน', hint: 'นับวันที่กดปิดงาน งานที่ปิดแล้วอยู่ในแท็บ “ปิดงาน”', short: 'ปิดงาน', head: 'ปิดงาน', sent: 'งานที่ปิด' },
};

/** ผลการขาย's choices (radios) and what its chip says. */
export const RESULT_OPTS: { v: Exclude<ResultF, ''>; label: string; chip: string }[] = [
  { v: 'YES', label: 'ได้งาน (YES)', chip: 'ได้งาน' },
  { v: 'NO', label: 'ไม่ได้งาน (NO)', chip: 'ไม่ได้งาน' },
  { v: 'WAIT', label: 'รอผล / มีหมายเหตุ', chip: 'รอผล' },
  { v: 'EMPTY', label: 'ยังไม่มีผล', chip: 'ยังไม่มีผล' },
];

/** The rows a view counts from: the table's open jobs (with its quick view), the closed tab's closed jobs
 *  (no quick view), or the Dashboard's every job of the year. */
export type ViewJob = 'open' | 'closed' | '';
const viewOf = (F: SalesFilter, job: ViewJob): SalesFilter => ({ ...F, job, quick: job === 'open' ? F.quick : '' });

/**
 * How many the rows `rows` of a view are, as the view counts them: the ปิดงาน tab counts jobs (a joint quotation
 * one however many of its companies are listed, workTally under the filters `f`, as its line and its counter
 * say); the table and the Dashboard count customers, in ราย (a joint quotation's header is not one, its
 * companies are).
 */
export function viewCount(S: SalesState, rows: Deal[], job: ViewJob, f: SalesFilter): number {
  return job === 'closed' ? workTally(S, rows, { attr: jointAttr(f) }).jobs : customersOf(S, rows).length;
}

/** The view with one filter replaced by a draft (a value popover's "เหลือ N งาน"; `key` 'date' takes a date
 *  draft), counted as the view counts (viewCount). `hay`: what else the search reads for a deal (the table's: the
 *  people linked to it, engine contactHay), so the count says what the rows will. */
export function liveCount(S: SalesState, F: SalesFilter, key: string, draft: ListF | ResultF | SalesFilter['date'] | null, job: ViewJob, today: string, hay?: (d: Deal) => string): number {
  const f = { ...viewOf(F, job), [key]: draft ?? undefined };
  return viewCount(S, filterDeals(S, f, today, hay), job, f);
}

/** How many of the view (date filter off) have a date of `basis` in each month of `ceYear`, counted as the view
 *  counts (viewCount: what the view says once that month is picked). `hay` (as liveCount's): what else the
 *  search reads for a deal, as the table's rows (filterDeals). */
export function monthCounts(S: SalesState, F: SalesFilter, basis: DateBasis, ceYear: number, job: ViewJob, today: string, hay?: (d: Deal) => string): number[] {
  const y = String(ceYear), f = { ...viewOf(F, job), date: null };
  const by: Deal[][] = Array.from({ length: 12 }, () => []);
  withActIndex(S, () =>
    // (the ปิดงาน tab's jobs include a joint quotation's header: the payer's row is that job)
    (job === 'closed' ? filterDeals(S, f, today, hay) : customersOf(S, filterDeals(S, f, today, hay))).forEach((d) => {
      const ms = new Set(basisDates(S, d, basis, today).filter((x) => x.d.startsWith(y)).map((x) => +x.d.slice(5, 7) - 1));
      ms.forEach((m) => by[m].push(d));
    }),
  );
  return by.map((l) => (l.length ? viewCount(S, l, job, f) : 0));
}

const thCmp = (a: string, b: string) => a.localeCompare(b, 'th');
/** What trackerFields reads besides the filters; `units`: the หน่วยงาน field's units (id, name, retired) when the
 *  account sees the revenue split (package dash), else no such field; `hay`: what else the search reads for a deal
 *  (the table's: the people linked to it), so the counts follow the search as the rows do. */
export interface FieldsCtx { yearDeals: Deal[]; job: ViewJob; me: string; today: string; dash?: boolean; units?: { id: string; n: string; off?: boolean }[]; hay?: (d: Deal) => string }
/**
 * The tracker's filter fields with their choices and counts (filters spec §6.3). A count is how many rows
 * of the view pass every other filter and have that value (a deal counts once under each of its SOURCE
 * and Services). Choices come from all of the year's deals, not the rows left (a chosen value never drops
 * out of its own list), and always include the chosen ones. ผู้รับผิดชอบ: you first ("ฉัน"), then the
 * busiest; SOURCE / Services: the configured order; หมวด: the table's order; empty values last.
 * `dash`: the Dashboard's row (no ผลการขาย: it reports results). หน่วยงาน (with `units`): the units in their
 * order, a deal under every unit its money goes to.
 */
export function trackerFields(S: SalesState, F: SalesFilter, ctx: FieldsCtx): FField[] {
  // six passes over the year's deals: the contact records indexed once for all of them
  return withActIndex(S, () => fieldsOf(S, F, ctx));
}
function fieldsOf(S: SalesState, F: SalesFilter, ctx: FieldsCtx): FField[] {
  const { yearDeals, job, me, today, hay } = ctx;
  /** each value's rows, counted as the view counts them (viewCount, under the filters with that value picked) */
  const tally = (rows: Deal[], valuesOf: (d: Deal) => string[], f: (v: string) => SalesFilter) => {
    const by = new Map<string, Deal[]>(), m = new Map<string, number>();
    rows.forEach((d) => valuesOf(d).forEach((v) => (by.get(v) || by.set(v, []).get(v)!).push(d)));
    by.forEach((l, v) => m.set(v, viewCount(S, l, job, f(v))));
    return m;
  };
  const counts = (k: ListKey) => {
    const f = { ...viewOf(F, job), [k]: undefined }, rows = filterDeals(S, f, today, hay);
    // (a joint quotation's member counts in its header's หมวด, where its row is drawn and filtered)
    return tally(job === 'closed' ? rows : customersOf(S, rows), (d) => listValues(k === 'section' ? payerDeal(S, d) : d, k, S), (v) => ({ ...f, [k]: { v: [v] } }));
  };
  const used = (k: ListKey) => new Set(yearDeals.flatMap((d) => listValues(d, k, S)));
  const opt = (v: string, n: Map<string, number>, sub?: string): FOpt => ({ v, label: v === NONE ? 'ไม่ระบุ' : v, n: n.get(v) || 0, sub });
  const chosen = (k: ListKey) => F[k]?.v || [];
  /** configured values first (in their order), then any other value the deals use or the filter holds; empty last */
  const ordered = (k: ListKey, cfg: string[]) => {
    const n = counts(k), seen = used(k), extra = [...seen, ...chosen(k)].filter((v) => !cfg.includes(v) && v !== NONE);
    const vs = [...new Set([...cfg, ...extra.sort(thCmp)])];
    if (seen.has(NONE) || chosen(k).includes(NONE)) vs.push(NONE);
    return vs.map((v) => opt(v, n));
  };
  /** by how many rows have it, then by name; empty last */
  const busiest = (k: ListKey, first?: string) => {
    const n = counts(k), vs = [...new Set([...used(k), ...chosen(k), ...(first ? [first] : [])])];
    const rest = vs.filter((v) => v !== first && v !== NONE).sort((a, b) => (n.get(b) || 0) - (n.get(a) || 0) || thCmp(a, b));
    return [...(first ? [opt(first, n, 'ฉัน')] : []), ...rest.map((v) => opt(v, n)), ...(vs.includes(NONE) ? [opt(NONE, n)] : [])];
  };
  const fields: FField[] = [
    { key: 'resp', label: 'ผู้รับผิดชอบ', kind: 'multi', ops: true, people: true, pinned: true, rest: 'ทุกคน', options: busiest('resp', me || undefined) },
    { key: 'source', label: 'SOURCE', hint: 'ช่องทางที่ได้ลูกค้า', kind: 'multi', ops: true, options: ordered('source', S.cfg.sources) },
    { key: 'service', label: 'บริการ', hint: 'บริการของงาน เช่น CFO CFP T-VER', kind: 'multi', ops: true, options: ordered('service', S.cfg.services) },
    { key: 'referral', label: 'แหล่งที่มา', hint: 'ใครแนะนำ / มาจากไหน', kind: 'multi', ops: true, find: 'ค้นหาชื่อ', options: busiest('referral') },
    {
      key: 'section', label: 'หมวด', hint: 'กลุ่มแถวในตาราง ตามช่องทางที่ได้ลูกค้า', kind: 'multi', ops: true, find: 'ค้นหาหมวด',
      options: (() => {
        const n = counts('section');
        const vs = [...new Set([...sectionsFor(S, yearDeals).map((x) => x || NONE), ...chosen('section')])];
        return [...vs.filter((v) => v !== NONE), ...(vs.includes(NONE) ? [NONE] : [])].map((v) => opt(v, n));
      })(),
    },
  ];
  // หน่วยงาน (package dash): the units in their order, then ยังไม่ระบุหน่วยงาน; a deal counts under every unit
  // its money goes to (its split, else its ผู้รับผิดชอบ's unit)
  if (ctx.units?.some((u) => !u.off)) {
    const n = counts('unit'), seen = used('unit'), names = new Map(ctx.units.map((u) => [u.id, u.n]));
    // a retired unit only while a deal still counts for it (or it is chosen)
    const vs = [...ctx.units.filter((u) => !u.off || seen.has(u.id) || chosen('unit').includes(u.id)).map((u) => u.id), ...chosen('unit').filter((v) => !names.has(v) && v !== NONE)];
    fields.push({
      key: 'unit', label: 'หน่วยงาน', hint: 'หน่วยงานที่ได้ส่วนแบ่งรายได้', kind: 'multi', ops: true,
      options: [...vs.map((v) => ({ v, label: names.get(v) || 'หน่วยงานที่ลบแล้ว', n: n.get(v) || 0 })), ...(seen.has(NONE) || chosen('unit').includes(NONE) ? [{ v: NONE, label: 'ยังไม่ระบุหน่วยงาน', chip: 'ยังไม่ระบุหน่วยงาน', n: n.get(NONE) || 0 }] : [])],
    });
  }
  if (!ctx.dash) {
    const f = { ...viewOf(F, job), result: '' as const }, rows = filterDeals(S, f, today, hay);
    const n = tally(job === 'closed' ? rows : customersOf(S, rows), (d) => [dealResult(S, d) || 'EMPTY'], (v) => ({ ...f, result: v as ResultF }));
    fields.push({ key: 'result', label: 'ผลการขาย', hint: 'ได้งาน / ไม่ได้งาน / รอผล', kind: 'single', all: 'ทั้งหมด', options: RESULT_OPTS.map((o) => ({ ...o, n: n.get(o.v) || 0 })) });
  }
  return fields;
}

/**
 * The Dashboard's การติดต่อสัปดาห์นี้: the steps and contact records of the deals `ids` dated this week (Monday
 * `mon` to today: a later date is a plan, not a contact yet) by day, and how many on the same days of last
 * week. A joint quotation's company given the payer's result when it closed is not a contact (stepContactDay).
 */
export function weekContacts(S: SalesState, ids: Set<string>, today: string) {
  const mon = addDays(today, -((dow(today) + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const perDay: Record<string, number> = {};
  let lastWeek = 0;
  const prevMon = addDays(mon, -7), prevToday = addDays(today, -7);
  const contact = (day: string) => {
    if (day >= mon && day <= today) perDay[day] = (perDay[day] || 0) + 1;
    else if (day >= prevMon && day <= prevToday) lastWeek++;
  };
  Object.keys(S.steps).forEach((k) => {
    const i = k.indexOf('/'), id = k.slice(0, i), day = ids.has(id) ? stepContactDay(S, id, k.slice(i + 1)) : '';
    if (day) contact(day);
  });
  Object.entries(S.acts || {}).forEach(([k, x]) => x.d && ids.has(k.slice(0, k.indexOf('/'))) && contact(x.d));
  return { mon, days, perDay, lastWeek };
}

/** Win rate (%) of each SOURCE that has deals with a known result — a channel at 0% is kept. */
export function winRateBySource(by: SalesStats['bySource']): [string, number][] {
  return Object.entries(by)
    .filter(([, x]) => x.decided > 0)
    .map(([k, x]) => [k, Math.round((x.yes / x.decided) * 100)]);
}

// ------------------------------------------------------------------ the tracker's words (tracker spec §5, payment plan spec §3)

/** The name people say: "บริษัท ไทยรุ่งเรืองอุตสาหกรรม จำกัด (มหาชน)" → "ไทยรุ่งเรืองอุตสาหกรรม" (บริษัท / บจก. / บมจ. /
 *  หจก. / ห้างหุ้นส่วนจำกัด|สามัญ at the start, จำกัด / (มหาชน) at the end). Never empty: "บริษัท จำกัด" stays as it is. */
export function shortName(client: string) {
  const s = client.replace(/^(บริษัท|บจก\.|บมจ\.|หจก\.|ห้างหุ้นส่วน(จำกัด|สามัญ)?)\s*/, '').replace(/\s*(จำกัด\s*\(มหาชน\)|\(มหาชน\)|จำกัด)\s*$/, '').trim();
  return s || client;
}
/** A job's short name with its services, where two jobs of one company must be told apart (toasts, the bell,
 *  aria labels, the joint quotation's picker): "ทองมงคล · CFP"; the name alone without a service. `s` given:
 *  a joint quotation's member is named with its header's services (jobServices). */
export const jobName = (d: Pick<Deal, 'client' | 'service' | 'id'>, s?: SalesState) => withSvc(shortName(d.client), s ? jobServices(s, d as Deal) : d.service);

/** Status colours of the design system: a dot + word, or a tinted chip for what needs action now. */
export type StatusKind = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
/** A deal's status (row, phone card, panel): the word with its colour, one grey line under it, and
 *  whether to offer ปิดงาน (`sub` then reads "พร้อมปิดงาน", which viewers see in place of the button). */
export interface StatusView { tone: 'new' | 'run' | 'wait' | 'yes' | 'no' | 'closed'; kind: StatusKind; word: string; sub: string; ready: boolean }
export function statusView(s: SalesState, d: Deal, today: string, t?: DealSteps): StatusView {
  const r = dealResult(s, d), ready = d.jobStatus === 'open' && closeReady(s, d, today, t);
  const v = (tone: StatusView['tone'], kind: StatusKind, word: string, sub: string): StatusView => ({ tone, kind, word, sub, ready });
  if (d.jobStatus === 'closed') return v('closed', r === 'YES' ? 'ok' : r === 'NO' ? 'bad' : 'neutral', r === 'YES' ? 'ได้งาน' : r === 'NO' ? 'ไม่ได้งาน' : 'ปิดงาน', 'ปิดงานแล้ว' + (d.closedDate ? ' ' + dmTh(d.closedDate) : ''));
  if (r === 'YES') {
    const ps = payState(s, d, today, t);
    // a joint quotation's member is paid through it: the payer's progress, said so
    if (jointRole(s, d) === 'member') return v('yes', 'ok', 'ได้งาน', ready ? 'พร้อมปิดงาน' : ps.plan ? `ผู้จ่ายชำระ ${ps.plan.paidN}/${ps.plan.n} งวด` : 'ชำระผ่านใบเสนอราคาร่วม');
    if (ps.plan && ps.left.length) return v('yes', 'ok', 'ได้งาน', `รับแล้ว ${ps.plan.paidN}/${ps.plan.n} งวด`);
    // (without a plan: the rest of the payment is "รอชำระเงิน" too, never "งวด 2" of a plan the deal has not)
    const rest = ps.left.length === 1 && (t || dealSteps(s, d, today)).steps.some((x) => x.rest && x.id === ps.left[0]);
    if (ps.left.length) return v('yes', 'ok', 'ได้งาน', ps.pays.length === 1 || rest ? 'รอชำระเงิน' : ps.left.length > 1 ? `รอชำระ ${ps.left.length} งวด` : `รอชำระงวด ${ps.pays.indexOf(ps.left[0]) + 1}`);
    // every installment in, but a document counted twice: not "paid in full" until it counts once (closeReady)
    if (!ready && dupCounted(s, d).length) return v('yes', 'ok', 'ได้งาน', DUP_HINT);
    return v('yes', 'ok', 'ได้งาน · รับครบ', 'พร้อมปิดงาน');
  }
  // (a company that withdrew from a joint quotation closes with it)
  if (r === 'NO') return v('no', 'bad', 'ไม่ได้งาน', ready || jointRole(s, d) !== 'member' ? 'พร้อมปิดงาน' : 'ปิดพร้อมใบเสนอราคาร่วม');
  if (r === 'WAIT') return v('wait', 'warn', 'รอผล', stepOf(s, d.id, DEAL_STAGE).n.trim());
  if (dealStatus(s, d).started) {
    const last = lastStage(s, d, today, t);
    return v('run', 'info', 'กำลังติดตาม', last ? 'ล่าสุด ' + last : '');
  }
  return v('new', 'neutral', 'ยังไม่เริ่ม', d.at ? 'เพิ่มเมื่อ ' + dmTh(localDay(d.at)) : '');
}

/** The next-step pill: "ถัดไป <code> <hint>" ("ถัดไป FOLLOW ติดตามผล", "ถัดไป CLOSE นัด 20 ต.ค."). `stage` is the
 *  record its editor writes (the step's id; a step done with a call booked ahead: the record holding that date,
 *  an older stage's too), `code` / `th` what shows, `date` the day it is planned for ('' when it is not). `pay`: a won deal with a plan names its next installment (`tone` late = past due, due = due within
 *  7 days or part paid); `joint`: a won member of a joint quotation, paid through it ("ชำระผ่านใบเสนอราคาร่วม");
 *  `label` is its aria-label. */
export interface NextStepView { kind: 'no' | 'done' | 'planned' | 'overdue' | 'next' | 'pay' | 'joint'; stage: string; code: string; th: string; date: string; hint: string; tone: '' | 'due' | 'late'; line: LineView | null; label: string }
export function nextStepView(s: SalesState, d: Deal, today: string, t = dealSteps(s, d, today)): NextStepView {
  const nx = t.next;
  const none = (kind: NextStepView['kind'], hint: string): NextStepView => ({ kind, stage: '', code: '', th: '', date: '', hint, tone: '', line: null, label: hint });
  if (t.result === 'NO') return none('no', 'ไม่ต้องติดตามต่อ');
  if (t.result === 'YES' && !nx && jointRole(s, d) === 'member' && !closeReady(s, d, today, t)) return none('joint', JOINT_PAID);
  const pl = t.result === 'YES' ? payState(s, d, today, t).plan?.next : null;
  if (pl && (!nx || nx.kind === 'pay')) {
    const hint =
      pl.status === 'late' ? `เลยกำหนด ${pl.lateDays} วัน`
      : pl.status === 'part' ? `ค้าง ${fmtMoney(pl.left)}`
      : pl.due ? (pl.due === today ? 'ครบกำหนดวันนี้' : `ครบกำหนด ${dmTh(pl.due)}`)
      : 'รอรับชำระ';
    const tone = pl.lateDays > 0 ? 'late' : pl.status === 'part' || pl.status === 'due' ? 'due' : '';
    const th = t.steps.find((v) => v.id === pl.stage)?.th || '';
    return { kind: 'pay', stage: pl.stage, code: pl.code, th, date: '', hint, tone, line: pl, label: `ถัดไป ${pl.code} ${fmtMoney(pl.amt)} บาท ${hint} — บันทึกรับเงิน` };
  }
  // won and paid (an installment paid by its document counts even when its note was cleared): ปิดงาน is next
  if (!nx || (t.result === 'YES' && closeReady(s, d, today, t))) return none('done', 'ครบทุกขั้น');
  // planned: the step itself (a date booked ahead), or a call booked ahead on a step already done (CONTACT, FOLLOW)
  const when = nx.state === 'planned' ? nx.date : nx.ahead || '';
  const planned = !!when;
  const hint = planned ? `นัด ${dmTh(when)}` : nx.short != null ? `ค้าง ${fmtMoney(nx.short)}` : nx.th;
  const kind = planned ? 'planned' : overdueDays(s, d, today, t) != null ? 'overdue' : 'next';
  // (a call booked ahead on a step done: its editor opens the record holding that date, CALL2 in place)
  return { kind, stage: nx.ahead ? nx.top.stage : nx.id, code: nx.code, th: nx.th, date: when, hint, tone: '', line: null, label: `ถัดไป ${nx.code} ${hint} — บันทึกวันที่และโน้ต` };
}

/** One line of a CONTACT / FOLLOW step: its own record, a contact record, or an older stage's record it reads
 *  (CALL2, CALL1 …: `stage` is where it is stored). */
export type StepLine = { kind: 'own' | 'act' | 'old'; d: string; at: string; stage: string; note: string; act?: DealAct };
/** What a CONTACT / FOLLOW step holds, newest first (the step's own record first on its day). The newest is the
 *  step's line in the table and the card; "รวม n ครั้ง" opens the rest. */
export function stepLines(v: StepView): StepLine[] {
  const own: StepLine[] = v.own.d || v.own.n.trim() ? [{ kind: 'own', d: v.own.d, at: '', stage: v.id, note: v.own.n }] : [];
  const rest = v.entries.map((x): StepLine => (x.kind === 'act' && x.act ? { kind: 'act', d: x.d, at: x.at, stage: x.stage, note: x.act.note, act: x.act } : { kind: 'old', d: x.d, at: '', stage: x.stage, note: x.step?.n || '' }));
  // (a time sorts the contacts of one day; the step's own record has none and comes first)
  return [...own, ...rest].sort((a, b) => b.d.localeCompare(a.d) || (a.kind === 'own' ? -1 : b.kind === 'own' ? 1 : b.at.localeCompare(a.at)));
}
/**
 * What a step's own button opens (the table row, the phone card, the panel's step heading), so it never edits
 * a record other than the one its line shows. CONTACT / FOLLOW show their newest line: the step's own record
 * ("แก้ไข" as on any step); an older stage's record ("แก้ไข" edits it where it is stored, from its own date and
 * note: `stage` CALL2, `old`); or a contact record, which has no editor: the button then records one more contact
 * at the step ("บันทึกเพิ่ม", `act`). Any other step, and an empty one: its own record.
 */
export function stepEdit(v: StepView): { stage: string; act: boolean; old: boolean; label: 'แก้ไข' | 'บันทึกเพิ่ม' } {
  if (v.kind === 'contact' || v.kind === 'follow') {
    const top = stepLines(v)[0];
    if (top?.kind === 'old') return { stage: top.stage, act: false, old: true, label: 'แก้ไข' };
    if (top?.kind === 'act') return { stage: v.id, act: true, old: false, label: 'บันทึกเพิ่ม' };
  }
  return { stage: v.id, act: false, old: false, label: 'แก้ไข' };
}

/** Under the Actual header: the payments it adds up ("จาก PAY": every installment is a PAY step). */
export function actualSource(_cfg?: SalesCfg) {
  return 'จาก PAY';
}

/** A due date given as days after the win: "เมื่อได้งาน" / "30 วันหลังได้งาน"; '' without one. */
export function relText(l: Pick<PayLine, 'rel'>) {
  return l.rel == null ? '' : l.rel === 0 ? 'เมื่อได้งาน' : l.rel > 0 ? `${l.rel} วันหลังได้งาน` : `${-l.rel} วันก่อนได้งาน`;
}
/** An installment's terms in one line: "50% · โอน · เมื่อส่งรายงาน CFO ฉบับสมบูรณ์". */
export function lineMeta(l: Pick<PayLine, 'pct' | 'how' | 'howT' | 'note'>) {
  const how = l.how ? HOW_TH[l.how] + (l.howT ? ' ' + l.howT : '') : l.howT;
  return [l.pct != null ? l.pct + '%' : '', how, l.note].filter(Boolean).join(' · ');
}
/** What came in beyond an installment's plan (a document's figure used over the plan): 0 when none. */
export const overPlan = (l: Pick<LineView, 'got' | 'amt'>) => (l.amt > 0 && l.got > l.amt ? Math.round((l.got - l.amt) * 100) / 100 : 0);
/** The plan total against the Forecast (shown, never enforced). */
export function diffText(P: Pick<PlanView, 'base' | 'diff'>) {
  if (P.base == null || P.diff == null) return 'ยังไม่มี Forecast';
  return !P.diff ? 'เท่ากับ Forecast' : P.diff < 0 ? `น้อยกว่า Forecast ${fmtMoney(-P.diff)}` : `มากกว่า Forecast ${fmtMoney(P.diff)}`;
}
/** An installment's status: the word (a tinted chip for เลยกำหนด / ถึงกำหนด, else a dot + word) and the
 *  line under it ("รับ 19 ต.ค. · RC-2569-118", "รับเกินแผน 35,500", "78,000 จาก 80,250", "ครบกำหนด 11 ต.ค.", …). */
export function lineStatusView(l: LineView, today: string): { kind: StatusKind | 'muted'; word: string; chip: boolean; sub: string } {
  const by = (kind: StatusKind | 'muted', word: string, sub: string, chip = false) => ({ kind, word, chip, sub });
  switch (l.status) {
    case 'paid':
      return by('ok', PAY_STATUS_TH.paid, [
        l.rcvDate ? 'รับ ' + dmTh(l.rcvDate) : '',
        l.doc ? 'จากเอกสาร ' + (l.doc.docNo || KIND_TH[l.doc.kind]) + (l.hand ? ' และบันทึกเอง' : '') : 'บันทึกเอง',
        l.got < l.amt ? fmtMoney(l.got) + ' (ถือว่าครบ)' : '',
        overPlan(l) ? 'รับเกินแผน ' + fmtMoney(overPlan(l)) : '',
      ].filter(Boolean).join(' · '));
    case 'part':
      return by('warn', PAY_STATUS_TH.part, `${fmtMoney(l.got)} จาก ${fmtMoney(l.amt)}` + (l.lateDays ? ` · เลยกำหนด ${l.lateDays} วัน` : ''));
    case 'late':
      return by('bad', `เลยกำหนด ${l.lateDays} วัน`, 'ครบกำหนด ' + dmTh(l.due), true);
    case 'due':
      return by('warn', l.due === today ? 'ถึงกำหนดวันนี้' : `ถึงกำหนด ${daysBetween(today, l.due)} วัน`, 'ครบกำหนด ' + dmTh(l.due), true);
    case 'wait':
      return by('neutral', PAY_STATUS_TH.wait, l.due ? `อีก ${daysBetween(today, l.due)} วัน` : 'ยังไม่กำหนดวัน');
    case 'draft':
      return by('neutral', PAY_STATUS_TH.draft, l.line.due ? dmTh(l.line.due) : relText(l.line));
    default:
      return by('muted', PAY_STATUS_TH.off, '');
  }
}

/**
 * The word under a money figure (request: documents at every figure): `ok` "จากเอกสาร <docNo>" when a
 * document backs it; `warn` "ไม่ตรงเอกสาร" when a document disagrees and the figure kept is the user's
 * (`title` has the numbers), or "นับซ้ำ" when one document is counted more than once; `typed` "พิมพ์เอง"
 * (offer "แนบเอกสาร"); `hand` "บันทึกเอง" (received without a document); '' when there is no figure.
 * Derived from the records, never stored (so a teammate's copy that arrives with a pull shows at once).
 */
export interface FigView { kind: 'ok' | 'warn' | 'typed' | 'hand' | ''; word: string; docNo: string; title: string; doc: DealDoc | null }
const fig = (kind: FigView['kind'], word: string, title = '', doc: DealDoc | null = null): FigView => ({ kind, word, docNo: doc ? doc.docNo || KIND_TH[doc.kind] : '', title, doc });
/** A document backing a figure: confirmed by it, or kept against it. */
export function docFig(doc: DealDoc, what = 'ยอดที่ใช้'): FigView {
  const mm = docMismatch(doc), name = `${KIND_TH[doc.kind]}${doc.docNo ? ' ' + doc.docNo : ''}`;
  return mm ? fig('warn', 'ไม่ตรงเอกสาร', `${name}: ${mismatchText(mm.doc, mm.kept, what)}`, doc) : fig('ok', 'จากเอกสาร', `${name} · ${fmtMoney(doc.amount)} บาท`, doc);
}
/** The Forecast: the quotation it comes from, a typed figure a newer quotation disagrees with, or typed. */
export function fcFig(s: SalesState, d: Deal): FigView {
  const m = dealMoney(s, d);
  if (m.fcDoc) return docFig(m.fcDoc, 'Forecast ที่ใช้');
  if (m.forecast == null) return fig('', '');
  const q = m.fcOverride ? docsOf(s, d.id).filter((x) => x.target === 'forecast' && x.amount != null).sort((a, b) => (a.cAt || a.at).localeCompare(b.cAt || b.at)).pop() : undefined;
  // typed after the newest quotation: the same figure is still confirmed by it, another one is kept against it
  if (q) return q.amount === m.forecast ? docFig(q) : fig('warn', 'ไม่ตรงเอกสาร', `${KIND_TH[q.kind]}${q.docNo ? ' ' + q.docNo : ''}: ${mismatchText(q.amount!, m.forecast, 'Forecast ที่พิมพ์ไว้')}`, q);
  return fig('typed', 'พิมพ์เอง', 'Forecast พิมพ์เอง แนบใบเสนอราคาเพื่อตรวจยอด');
}
/** One document counted more than once: "INV2026090004 นับยอดซ้ำ 2 ครั้ง (PAY 61,730.77 · PAY ส่วนที่เหลือ 60,000 บาท)";
 *  `step` names a stored stage as the deal's steps do (stepCode: PAY1 of a deal without a plan is "PAY"). */
export function dupText(gr: DealDoc[], step: (stage: string) => string = (p) => p) {
  const x = gr[gr.length - 1], name = x.docNo || x.name;
  return `${name} นับยอดซ้ำ ${gr.length} ครั้ง (${gr.map((y) => `${(y.stage && step(y.stage)) || 'ไม่ระบุขั้น'} ${fmtMoney(y.amount)}`).join(' · ')} บาท)`;
}
/** The Actual: one document counted twice first, then its documents (one that disagrees comes first), what
 *  was received by hand, or typed. */
export function acFig(s: SalesState, d: Deal): FigView {
  const dup = dupCounted(s, d)[0];
  if (dup) return fig('warn', 'นับซ้ำ', dupText(dup, (p) => stepCode(s, d, p, todayISO())) + ' · ตั้งใบที่ซ้ำเป็น "ไม่นับยอด"', dup[dup.length - 1]);
  const m = dealMoney(s, d);
  const docs = docsOf(s, d.id).filter((x) => x.target === 'actual' && x.amount != null);
  const bad = docs.filter((x) => docMismatch(x));
  if (bad.length) return bad.length === 1 ? docFig(bad[0]) : fig('warn', 'ไม่ตรงเอกสาร', bad.map((x) => docFig(x).title).join('\n'), bad[0]);
  if (docs.length) {
    const last = docs[docs.length - 1], v = docFig(last);
    return docs.length > 1 ? { ...v, docNo: `${v.docNo} และอีก ${docs.length - 1} ใบ`, title: docs.map((x) => docFig(x).title).join('\n') } : v;
  }
  if (m.hand) return fig('hand', 'บันทึกเอง', 'รับเงินแล้วโดยไม่มีเอกสาร แนบใบเสร็จเพื่อตรวจยอด');
  return m.actual != null ? fig('typed', 'พิมพ์เอง', 'Actual พิมพ์เอง แนบใบเสร็จเพื่อตรวจยอด') : fig('', '');
}
/** An installment: its document (or the one that disagrees with what is counted), received by hand, or
 *  only planned (typed). */
export function lineFig(l: LineView): FigView {
  const bad = l.docs.find((x) => docMismatch(x));
  if (bad || l.doc) return docFig(bad || l.doc!, 'ยอดที่นับ');
  if (l.hand) return fig('hand', 'บันทึกเอง', 'รับเงินแล้วโดยไม่มีเอกสาร แนบใบเสร็จเพื่อตรวจยอด');
  return fig('typed', 'ตามแผน', 'ยอดตามแผน แนบใบแจ้งหนี้หรือใบเสร็จเพื่อตรวจยอด');
}

/** The figure a money stage's documents give, where the stage sits under Forecast / Actual (table child
 *  row, phone card): at QUOTATION the quotation the Forecast comes from (else the newest confirmed one);
 *  at a PAY stage the documents counted there (their sum, named by the latest). Never a revised,
 *  replaced or uncounted document; null when there is none. */
export function stageFig(s: SalesState, d: Deal, p: string): { doc: DealDoc; sum: number; n: number } | null {
  if (p === QUOTE_STAGE) {
    const m = dealMoney(s, d);
    const q = m.fcDoc?.stage === p ? m.fcDoc : docsOf(s, d.id).filter((x) => x.stage === p && x.target === 'forecast' && x.amount != null).sort((a, b) => (a.cAt || a.at).localeCompare(b.cAt || b.at)).pop();
    return q ? { doc: q, sum: q.amount!, n: 1 } : null;
  }
  const c = countedAt(s, d, p);
  return c.length ? { doc: c[c.length - 1], sum: c.reduce((a, x) => a + (x.amount || 0), 0), n: c.length } : null;
}

/** How a won member of a joint quotation is paid (its PAY stages, next step and closing row say it). */
export const JOINT_PAID = 'ชำระผ่านใบเสนอราคาร่วม';
/** The closing card's title (panel, table closing row, phone card). */
export const CLOSE_TITLE = 'ปิดงาน · ย้ายงานที่จบแล้วไปแท็บ “ปิดงาน”';
/**
 * Where a deal stands toward ปิดงาน: `state` none (no result yet), no, plan (won, installments of the
 * plan left), pays (won, PAY steps left, no plan), done (won and received: every deal has a PAY step); the
 * closing card's `text`; `hint` for the table's closing row ("ปิดได้เมื่อรับ PAY2", "รอผลการขาย"; '' when ready:
 * the button shows); `waitFor` the installments left (their ids); `progress` = "รับแล้ว 50% · เหลือ 53,500" on the
 * plan total, else the Forecast.
 * `ro`: an account that can only read gets where it stands, without the steps it has no buttons for.
 */
export interface ClosingView { ready: boolean; state: 'none' | 'no' | 'plan' | 'pays' | 'done' | 'joint' | 'dup'; text: string; hint: string; waitFor: string[]; progress: { pct: number; got: number; base: number; left: number } | null; /** 'joint', 'dup', and 'pays' while the rest of a payment without a plan is owed: the lead phrase (the table's closing row, the phone card) */ lead?: string }
/** Why a won job with every installment in is not ready to close: a document counted twice (closeReady). */
export const DUP_HINT = 'รอแก้ยอดนับซ้ำ';
export function closingView(s: SalesState, d: Deal, today: string, ro = false, t?: DealSteps): ClosingView {
  const r = dealResult(s, d), ready = closeReady(s, d, today, t);
  // a company of a joint quotation (`joint`): its money is the header's, and it closes with the whole
  // quotation, once the payer has paid in full (or said NO); closing records the payer's result for it when it
  // has none (engine.closeJoint)
  if (jointRole(s, d) === 'member') {
    const h = s.deals[jointHeadOf(s, d.id)], P = h ? payState(s, h, today).plan : null, hr = h ? dealResult(s, h) : '';
    const progress = P && P.total ? { pct: Math.min(100, Math.round((P.got / P.total) * 100)), got: P.got, base: P.total, left: Math.max(0, P.total - P.got) } : null;
    const own = r === 'YES' ? 'ได้งานแล้ว' : r === 'NO' ? 'ไม่ได้งาน (ถอนตัว)' : 'ยังไม่มีผลของบริษัทนี้';
    const lead = ready ? `${own} · ${hr === 'NO' ? 'ผู้จ่ายตอบว่าไม่ได้งาน' : 'ผู้จ่ายชำระครบแล้ว'}` : `${own} · ${JOINT_PAID}${P ? ` · ผู้จ่ายชำระ ${P.paidN} จาก ${P.n} งวด` : ''}`;
    const fill = r !== 'YES' && r !== 'NO' && (ready || hr === 'YES') ? ` บริษัทที่ยังไม่มีผลจะได้ผลตามผู้จ่าย` : '';
    const rest = ro ? '' : ready ? ` ปิดงานพร้อมกันทั้งใบเสนอราคาร่วม${fill}` : ` ปิดงานพร้อมกันทั้งใบเสนอราคาร่วมเมื่อผู้จ่ายชำระครบ${fill}`;
    return { ready, state: 'joint', text: lead + rest, lead, hint: ready ? '' : hr === 'YES' ? 'ปิดได้เมื่อผู้จ่ายชำระครบ' : 'รอผลจากผู้จ่าย', waitFor: [], progress };
  }
  if (r === 'NO') return { ready, state: 'no', text: ro ? 'ผลการขายเป็น NO แล้ว ไม่ต้องติดตามต่อ' : 'ผลการขายเป็น NO แล้ว ไม่ต้องติดตามต่อ กดปิดงานเพื่อย้ายไปแท็บ “ปิดงาน” (เปิดกลับได้ ยอดยังนับในสรุปปี)', hint: '', waitFor: [], progress: null };
  if (r !== 'YES') return { ready, state: 'none', text: ro ? 'ยังไม่มีผลการขาย' : 'ยังไม่มีผลการขาย เมื่อบันทึก CLOSE เป็น NO หรือ YES และรับชำระครบทุกงวด ระบบจะขึ้นปุ่มปิดงาน', hint: 'รอผลการขาย', waitFor: [], progress: null };
  const ps = payState(s, d, today, t), P = ps.plan, m = dealMoney(s, d);
  const base = P ? P.total : m.forecast, got = P ? P.got : m.actual || 0;
  const progress = base ? { pct: Math.min(100, Math.round((got / base) * 100)), got, base, left: Math.max(0, base - got) } : null;
  const left = ps.left, codes = left.map((p) => stepCode(s, d, p, today)).join(', '), hint = left.length ? 'ปิดได้เมื่อรับ ' + codes : '';
  const out = (state: ClosingView['state'], text: string): ClosingView => ({ ready, state, text, hint, waitFor: left, progress });
  if (P && left.length) return out('plan', `ได้งานแล้ว · รับ ${P.paidN} จาก ${P.n} งวดตามแผน${ro ? '' : ' เมื่อรับครบทุกงวด ระบบจะชวนให้ปิดงาน'}`);
  if (left.length && ps.pays.length === 1) return out('pays', `ได้งานแล้ว · ยังไม่ได้รับชำระ${ro ? '' : ` เมื่อแนบใบเสร็จที่ ${codes} ระบบจะชวนให้ปิดงาน`}`);
  // no plan, its PAY step done but not known to be paid in full: the rest of it (dealSteps `rest`)
  const rest = !P && left.length === 1 ? (t || dealSteps(s, d, today)).steps.find((v) => v.rest && v.id === left[0]) : undefined;
  if (rest) {
    // (a session without ดูยอดเงิน cannot tell what came in: the rest is still to record)
    const lead = rest.short == null ? 'ได้งานแล้ว · รอบันทึกรับส่วนที่เหลือ' : `ได้งานแล้ว · ${m.actual == null ? 'ยังไม่มียอดที่รับ (Actual) ' : ''}ค้างรับ ${fmtMoney(rest.short)} บาท`;
    const how = m.actual == null && rest.short != null ? 'แนบใบเสร็จหรือใส่ยอด Actual' : 'แนบใบเสร็จของส่วนที่เหลือ';
    return { ...out('pays', lead + (ro ? '' : ` เมื่อ${how} ระบบจะชวนให้ปิดงาน`)), hint: 'ปิดได้เมื่อรับส่วนที่เหลือ', lead };
  }
  if (left.length) return out('pays', `ได้งานแล้ว · รับชำระ ${ps.paid.length} จาก ${ps.pays.length} งวด${ro ? '' : ` เมื่อแนบเอกสาร ${codes} ระบบจะชวนให้ปิดงาน`}`);
  // every installment in, but a document counted twice (Actual says "นับซ้ำ"): counted once first, no "100%"
  const dup = dupCounted(s, d)[0];
  if (dup) {
    const lead = `ได้งานแล้ว · ${KIND_TH[dup[0].kind].split(' / ')[0]} ${dup[0].docNo || dup[0].name} นับซ้ำ ${dup.length} ครั้ง`;
    return { ready, state: 'dup', text: lead + (ro ? '' : ' ให้นับครั้งเดียวก่อน แล้วระบบจะชวนให้ปิดงาน'), hint: DUP_HINT, waitFor: [], progress: null, lead };
  }
  return out('done', `ได้งานและรับชำระครบทุกงวด${P ? 'ตามแผน' : ''}แล้ว${ro ? ' พร้อมปิดงาน' : ' ปิดงานเพื่อย้ายไปแท็บ “ปิดงาน” ยอด Forecast / Actual ยังนับในสรุปปีเหมือนเดิม'}`);
}
/** The prompt after this user's own action made a deal ready (`via` the result, or a payment / document /
 *  "ถือว่ารับครบ"): "รับชำระครบทุกงวดแล้ว ปิดงาน X เลยไหม?". A teammate's change never prompts. */
export function closePrompt(s: SalesState, d: Deal, name: string, via: 'result' | 'payment') {
  const r = dealResult(s, d);
  const lead = r === 'NO' ? 'ผลการขายเป็น NO' : via === 'payment' ? 'รับชำระครบทุกงวดแล้ว' : 'ได้งานและรับชำระครบแล้ว';
  return `${lead} ปิดงาน ${name} เลยไหม?`;
}
/** Asked before closing a deal that is not ready (from ⋯ or the panel head); '' when it is ready. */
export function closeConfirm(s: SalesState, d: Deal, today: string, name: string) {
  if (closeReady(s, d, today)) return '';
  const won = dealResult(s, d) === 'YES', left = won ? payState(s, d, today).left.map((p) => stepCode(s, d, p, today)) : [];
  const why = left.length ? `ยังรับชำระไม่ครบ (${left.join(', ')})` : won && dupCounted(s, d).length ? 'ยังมียอดนับซ้ำ' : 'ยังไม่มีผลการขาย';
  return `ปิดงาน “${name}” ตอนนี้? ${why} งานจะย้ายไปแท็บปิดงาน เปิดกลับได้`;
}
