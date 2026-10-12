/** Small pure helpers behind the Sales Tracker screens (no DOM, so they are unit-tested). */
import { daysBetween, dmTh, localDay } from './format';
import { basisDates, filterDeals, listValues, NONE, sectionsFor, type DateBasis, type ListF, type ListKey, type ResultF, type SalesFilter } from './sales';
import {
  DEAL_STAGE, HOW_TH, KIND_TH, PAY_STATUS_TH, QUOTE_STAGE, beYear, closeReady, countedAt, dealMoney, dealResult, dealStatus, docMismatch, docsOf, fmtMoney, lastStage, mismatchText, overdueDays, payStages, payState, stageTh, stageTrack, stepOf,
  type Deal, type DealDoc, type LineView, type PayLine, type PlanView, type SalesCfg, type SalesState, type SalesStats,
} from './sales';
import type { FField, FOpt } from '../components/FilterBar';

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

/** Years offered by the year picker: this year ±1, the one shown, and every year that has deals. */
export function yearOptions(deals: Iterable<Deal>, shown: string, now = beYear()) {
  const ys = new Set([now, String(+now + 1), String(+now - 1), shown]);
  for (const d of deals) ys.add(d.year);
  return [...ys].sort();
}

// ------------------------------------------------------------------ the filter row (filters spec §6)

/** What each date basis is called: in the basis list (`label`, `sub`), the hint under it, the chip's
 *  and caption's word (`short`), the column heading in the rows (`head`) and the popover's sentence. */
export const BASIS_TH: Record<DateBasis, { label: string; sub: string; hint: string; short: string; head: string; sent: string }> = {
  contact: { label: 'มีการติดต่อ', sub: 'ติดต่อแล้ว ไม่นับนัดล่วงหน้า', hint: 'นับวันที่ติดต่อที่พิมพ์ไว้ วันที่ของขั้นตอน และบันทึกการติดต่อ ที่ไม่เกินวันนี้', short: 'ติดต่อ', head: 'ติดต่อล่าสุด', sent: 'งานที่มีการติดต่อ' },
  added: { label: 'เพิ่มเข้าตาราง', sub: 'วันที่ส่งเข้า Sales Tracker', hint: 'นับวันที่ลูกค้าถูกเพิ่มเข้าตารางของปีนี้', short: 'เพิ่มเข้าตาราง', head: 'เพิ่มเข้าตาราง', sent: 'งานที่เพิ่มเข้าตาราง' },
  result: { label: 'ได้ผลการขาย', sub: 'ได้งาน / ไม่ได้งาน', hint: 'นับวันที่ของขั้น CLOSED DEAL เมื่อรู้ผลแล้ว ทั้งได้งานและไม่ได้งาน', short: 'ได้ผลการขาย', head: 'วันที่ได้ผล', sent: 'งานที่ได้ผลการขาย' },
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

/** The rows of the view with one filter replaced by a draft (a value popover's "เหลือ N งาน"; `key` 'date'
 *  takes a date draft). */
export function liveCount(S: SalesState, F: SalesFilter, key: string, draft: ListF | ResultF | SalesFilter['date'] | null, job: ViewJob, today: string): number {
  return filterDeals(S, { ...viewOf(F, job), [key]: draft ?? undefined }, today).length;
}

/** How many rows of the view (date filter off) have a date of `basis` in each month of `ceYear`. */
export function monthCounts(S: SalesState, F: SalesFilter, basis: DateBasis, ceYear: number, job: ViewJob, today: string): number[] {
  const out = Array(12).fill(0) as number[], y = String(ceYear);
  filterDeals(S, { ...viewOf(F, job), date: null }, today).forEach((d) => {
    const ms = new Set(basisDates(S, d, basis, today).filter((x) => x.d.startsWith(y)).map((x) => +x.d.slice(5, 7) - 1));
    ms.forEach((m) => out[m]++);
  });
  return out;
}

const thCmp = (a: string, b: string) => a.localeCompare(b, 'th');
/**
 * The tracker's filter fields with their choices and counts (filters spec §6.3). A count is how many rows
 * of the view pass every other filter and have that value (a deal counts once under each of its SOURCE
 * and Services). Choices come from all of the year's deals, not the rows left (a chosen value never drops
 * out of its own list), and always include the chosen ones. ผู้รับผิดชอบ: you first ("ฉัน"), then the
 * busiest; SOURCE / Services: the configured order; หมวด: the table's order; empty values last.
 * `dash`: the Dashboard's row (no ผลการขาย: it reports results).
 */
export function trackerFields(S: SalesState, F: SalesFilter, ctx: { yearDeals: Deal[]; job: ViewJob; me: string; today: string; dash?: boolean }): FField[] {
  const { yearDeals, job, me, today } = ctx;
  const counts = (k: ListKey) => {
    const m = new Map<string, number>();
    filterDeals(S, { ...viewOf(F, job), [k]: undefined }, today).forEach((d) => listValues(d, k).forEach((v) => m.set(v, (m.get(v) || 0) + 1)));
    return m;
  };
  const used = (k: ListKey) => new Set(yearDeals.flatMap((d) => listValues(d, k)));
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
    { key: 'service', label: 'Services', hint: 'บริการที่เสนอ', kind: 'multi', ops: true, options: ordered('service', S.cfg.services) },
    { key: 'referral', label: 'แหล่งที่มา', hint: 'ใครแนะนำ / มาจากไหน', kind: 'multi', ops: true, find: 'ค้นหาชื่อ', options: busiest('referral') },
    {
      key: 'section', label: 'หมวด', hint: 'กลุ่มแถวในตาราง', kind: 'multi', ops: true, find: 'ค้นหาหมวด',
      options: (() => {
        const n = counts('section');
        const vs = [...new Set([...sectionsFor(S, yearDeals).map((x) => x || NONE), ...chosen('section')])];
        return [...vs.filter((v) => v !== NONE), ...(vs.includes(NONE) ? [NONE] : [])].map((v) => opt(v, n));
      })(),
    },
  ];
  if (!ctx.dash) {
    const n = new Map<string, number>();
    filterDeals(S, { ...viewOf(F, job), result: '' }, today).forEach((d) => {
      const r = dealResult(S, d) || 'EMPTY';
      n.set(r, (n.get(r) || 0) + 1);
    });
    fields.push({ key: 'result', label: 'ผลการขาย', hint: 'ได้งาน / ไม่ได้งาน / รอผล', kind: 'single', all: 'ทั้งหมด', options: RESULT_OPTS.map((o) => ({ ...o, n: n.get(o.v) || 0 })) });
  }
  return fields;
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

/** Status colours of the design system: a dot + word, or a tinted chip for what needs action now. */
export type StatusKind = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
/** A deal's status (row, phone card, panel): the word with its colour, one grey line under it, and
 *  whether to offer ปิดงาน (`sub` then reads "พร้อมปิดงาน", which viewers see in place of the button). */
export interface StatusView { tone: 'new' | 'run' | 'wait' | 'yes' | 'no' | 'closed'; kind: StatusKind; word: string; sub: string; ready: boolean }
export function statusView(s: SalesState, d: Deal, today: string): StatusView {
  const r = dealResult(s, d), ready = d.jobStatus === 'open' && closeReady(s, d, today);
  const v = (tone: StatusView['tone'], kind: StatusKind, word: string, sub: string): StatusView => ({ tone, kind, word, sub, ready });
  if (d.jobStatus === 'closed') return v('closed', r === 'YES' ? 'ok' : r === 'NO' ? 'bad' : 'neutral', r === 'YES' ? 'ได้งาน' : r === 'NO' ? 'ไม่ได้งาน' : 'ปิดงาน', 'ปิดงานแล้ว' + (d.closedDate ? ' ' + dmTh(d.closedDate) : ''));
  if (r === 'YES') {
    const ps = payState(s, d, today);
    if (ps.plan && ps.left.length) return v('yes', 'ok', 'ได้งาน', `รับแล้ว ${ps.plan.paidN}/${ps.plan.n} งวด`);
    if (ps.left.length) return v('yes', 'ok', 'ได้งาน', ps.left.length > 1 ? `รอชำระ ${ps.left.length} งวด` : `รอชำระงวด ${ps.pays.indexOf(ps.left[0]) + 1}`);
    return v('yes', 'ok', ps.pays.length ? 'ได้งาน · รับครบ' : 'ได้งาน', 'พร้อมปิดงาน');
  }
  if (r === 'NO') return v('no', 'bad', 'ไม่ได้งาน', 'พร้อมปิดงาน');
  if (r === 'WAIT') return v('wait', 'warn', 'รอผล', stepOf(s, d.id, DEAL_STAGE).n.trim());
  if (dealStatus(s, d).started) {
    const t = stageTrack(s, d, today), last = s.cfg.stages.filter((p) => t.states[p] === 'done').pop() || lastStage(s, d);
    return v('run', 'info', 'กำลังติดตาม', last ? 'ล่าสุด ' + last : '');
  }
  return v('new', 'neutral', 'ยังไม่เริ่ม', d.at ? 'เพิ่มเมื่อ ' + dmTh(localDay(d.at)) : '');
}

/** The next-step pill: "ถัดไป <stage> <hint>". `pay`: a won deal with a plan names its next installment
 *  (`tone` late = past due, due = due within 7 days or part paid); `label` is its aria-label. */
export interface NextStepView { kind: 'no' | 'done' | 'planned' | 'overdue' | 'next' | 'pay'; stage: string; hint: string; tone: '' | 'due' | 'late'; line: LineView | null; label: string }
export function nextStepView(s: SalesState, d: Deal, today: string): NextStepView {
  const t = stageTrack(s, d, today);
  if (t.result === 'NO') return { kind: 'no', stage: '', hint: 'ไม่ต้องติดตามต่อ', tone: '', line: null, label: 'ไม่ต้องติดตามต่อ' };
  const pl = t.result === 'YES' ? payState(s, d, today).plan?.next : null;
  if (pl && (!t.next || payStages(s.cfg).includes(t.next))) {
    const hint =
      pl.status === 'late' ? `เลยกำหนด ${pl.lateDays} วัน`
      : pl.status === 'part' ? `ค้าง ${fmtMoney(pl.left)}`
      : pl.due ? (pl.due === today ? 'ครบกำหนดวันนี้' : `ครบกำหนด ${dmTh(pl.due)}`)
      : 'รอรับชำระ';
    const tone = pl.lateDays > 0 ? 'late' : pl.status === 'part' || pl.status === 'due' ? 'due' : '';
    return { kind: 'pay', stage: pl.stage, hint, tone, line: pl, label: `ถัดไป ${pl.stage} ${fmtMoney(pl.amt)} บาท ${hint} — บันทึกรับเงิน` };
  }
  // won and paid (a stage paid by its document counts even when its note was cleared): ปิดงาน is next
  if (!t.next || (t.result === 'YES' && closeReady(s, d, today))) return { kind: 'done', stage: '', hint: 'ครบทุกขั้น', tone: '', line: null, label: 'ครบทุกขั้น' };
  const p = t.next, planned = t.states[p] === 'planned';
  const hint = planned ? `นัด ${dmTh(stepOf(s, d.id, p).d)}` : stageTh(p);
  const kind = planned ? 'planned' : overdueDays(s, d, today) != null ? 'overdue' : 'next';
  return { kind, stage: p, hint, tone: '', line: null, label: `ถัดไป ${p} ${hint} — บันทึกวันที่และโน้ต` };
}

/** Under the Actual header: "จาก PAY1 + PAY2"; "จาก PAY ทุกงวด" for 3 or more; "จาก ใบเสร็จ" without PAY stages. */
export function actualSource(cfg: SalesCfg) {
  const p = payStages(cfg);
  return 'จาก ' + (!p.length ? 'ใบเสร็จ' : p.length <= 2 ? p.join(' + ') : 'PAY ทุกงวด');
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
 * (`title` has the numbers); `typed` "พิมพ์เอง" (offer "แนบเอกสาร"); `hand` "บันทึกเอง" (received
 * without a document); '' when there is no figure. Derived from the records, never stored.
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
/** The Actual: its documents (one that disagrees comes first), what was received by hand, or typed. */
export function acFig(s: SalesState, d: Deal): FigView {
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

/** The closing card's title (panel, table closing row, phone card). */
export const CLOSE_TITLE = 'ปิดงาน · ย้ายงานที่จบแล้วไปแท็บ “ปิดงาน”';
/**
 * Where a deal stands toward ปิดงาน: `state` none (no result yet), no, plan (won, installments of the
 * plan left), pays (won, PAY stages left, no plan), nopay (won, the list has no PAY stage), done (won and
 * received); the closing card's `text`; `hint` for the table's closing row ("ปิดได้เมื่อรับ PAY2", "รอผลการขาย";
 * '' when ready: the button shows); `progress` = "รับแล้ว 50% · เหลือ 53,500" on the plan total, else the Forecast.
 * `ro`: an account that can only read gets where it stands, without the steps it has no buttons for.
 */
export interface ClosingView { ready: boolean; state: 'none' | 'no' | 'plan' | 'pays' | 'nopay' | 'done'; text: string; hint: string; waitFor: string[]; progress: { pct: number; got: number; base: number; left: number } | null }
export function closingView(s: SalesState, d: Deal, today: string, ro = false): ClosingView {
  const r = dealResult(s, d), ready = closeReady(s, d, today);
  if (r === 'NO') return { ready, state: 'no', text: ro ? 'ผลการขายเป็น NO แล้ว ไม่ต้องติดตามต่อ' : 'ผลการขายเป็น NO แล้ว ไม่ต้องติดตามต่อ กดปิดงานเพื่อย้ายไปแท็บ “ปิดงาน” (เปิดกลับได้ ยอดยังนับในสรุปปี)', hint: '', waitFor: [], progress: null };
  if (r !== 'YES') return { ready, state: 'none', text: ro ? 'ยังไม่มีผลการขาย' : 'ยังไม่มีผลการขาย เมื่อบันทึก CLOSED DEAL เป็น NO หรือ YES และรับชำระครบทุกงวด ระบบจะขึ้นปุ่มปิดงาน', hint: 'รอผลการขาย', waitFor: [], progress: null };
  const ps = payState(s, d, today), P = ps.plan, m = dealMoney(s, d);
  const base = P ? P.total : m.forecast, got = P ? P.got : m.actual || 0;
  const progress = base ? { pct: Math.min(100, Math.round((got / base) * 100)), got, base, left: Math.max(0, base - got) } : null;
  const left = ps.left, hint = left.length ? 'ปิดได้เมื่อรับ ' + left.join(', ') : '';
  const out = (state: ClosingView['state'], text: string): ClosingView => ({ ready, state, text, hint, waitFor: left, progress });
  if (P && left.length) return out('plan', `ได้งานแล้ว · รับ ${P.paidN} จาก ${P.n} งวดตามแผน${ro ? '' : ' เมื่อรับครบทุกงวด ระบบจะชวนให้ปิดงาน'}`);
  if (left.length) return out('pays', `ได้งานแล้ว · รับชำระ ${ps.paid.length} จาก ${ps.pays.length} งวด${ro ? '' : ` เมื่อแนบเอกสาร ${left.join(', ')} ระบบจะชวนให้ปิดงาน`}`);
  if (!ps.pays.length) return out('nopay', ro ? 'ได้งานแล้ว' : 'ได้งานแล้ว ตารางนี้ไม่มีขั้นชำระเงิน (PAY) กดปิดงานเมื่องานจบ');
  return out('done', `ได้งานและรับชำระครบทุกงวด${P ? 'ตามแผน' : ''}แล้ว${ro ? ' พร้อมปิดงาน' : ' ปิดงานเพื่อย้ายไปแท็บ “ปิดงาน” ยอด Forecast / Actual ยังนับในสรุปปีเหมือนเดิม'}`);
}
/** The prompt after this user's own action made a deal ready (`via` the result, or a payment / document /
 *  "ถือว่ารับครบ"): "รับชำระครบทุกงวดแล้ว ปิดงาน X เลยไหม?". A teammate's change never prompts. */
export function closePrompt(s: SalesState, d: Deal, name: string, via: 'result' | 'payment') {
  const r = dealResult(s, d);
  const lead = r === 'NO' ? 'ผลการขายเป็น NO' : via === 'payment' ? 'รับชำระครบทุกงวดแล้ว' : payStages(s.cfg).length ? 'ได้งานและรับชำระครบแล้ว' : 'ได้งานแล้ว';
  return `${lead} ปิดงาน ${name} เลยไหม?`;
}
/** Asked before closing a deal that is not ready (from ⋯ or the panel head); '' when it is ready. */
export function closeConfirm(s: SalesState, d: Deal, today: string, name: string) {
  if (closeReady(s, d, today)) return '';
  const left = dealResult(s, d) === 'YES' ? payState(s, d, today).left : [];
  return `ปิดงาน “${name}” ตอนนี้? ${left.length ? `ยังรับชำระไม่ครบ (${left.join(', ')})` : 'ยังไม่มีผลการขาย'} งานจะย้ายไปแท็บปิดงาน เปิดกลับได้`;
}
