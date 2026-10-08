/** Small pure helpers behind the Sales Tracker screens (no DOM, so they are unit-tested). */
import { daysBetween, dmTh, localDay } from './format';
import {
  DEAL_STAGE, HOW_TH, KIND_TH, PAY_STATUS_TH, beYear, closeReady, dealMoney, dealResult, dealStatus, fmtMoney, lastStage, overdueDays, payStages, payState, stageTh, stageTrack, stepOf,
  type Deal, type LineView, type PayLine, type PlanView, type SalesCfg, type SalesState, type SalesStats,
} from './sales';

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

/** Choices of a ผู้รับผิดชอบ / แหล่งที่มา filter: taken from all of the year's deals (not the rows left
 *  after filtering, or the chosen value would drop out of its own list) and always including it. */
export function facetOptions(deals: Deal[], k: 'resp' | 'referral', chosen = '') {
  const s = new Set(deals.map((d) => d[k] || '(ไม่ระบุ)'));
  if (chosen) s.add(chosen);
  return [...s].sort();
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
/** The plan total against the Forecast (shown, never enforced). */
export function diffText(P: Pick<PlanView, 'base' | 'diff'>) {
  if (P.base == null || P.diff == null) return 'ยังไม่มี Forecast';
  return !P.diff ? 'เท่ากับ Forecast' : P.diff < 0 ? `น้อยกว่า Forecast ${fmtMoney(-P.diff)}` : `มากกว่า Forecast ${fmtMoney(P.diff)}`;
}
/** An installment's status: the word (a tinted chip for เลยกำหนด / ถึงกำหนด, else a dot + word) and the
 *  line under it ("รับ 19 ต.ค. · RC-2569-118", "78,000 จาก 80,250", "ครบกำหนด 11 ต.ค.", "อีก 12 วัน", …). */
export function lineStatusView(l: LineView, today: string): { kind: StatusKind | 'muted'; word: string; chip: boolean; sub: string } {
  const by = (kind: StatusKind | 'muted', word: string, sub: string, chip = false) => ({ kind, word, chip, sub });
  switch (l.status) {
    case 'paid':
      return by('ok', PAY_STATUS_TH.paid, [l.rcvDate ? 'รับ ' + dmTh(l.rcvDate) : '', l.doc ? l.doc.docNo || KIND_TH[l.doc.kind] : 'บันทึกเอง', l.got < l.amt ? fmtMoney(l.got) + ' (ถือว่าครบ)' : ''].filter(Boolean).join(' · '));
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

/** The closing card's title (panel, table closing row, phone card). */
export const CLOSE_TITLE = 'ปิดงาน · ย้ายงานที่จบแล้วไปแท็บ “ปิดงาน”';
/**
 * Where a deal stands toward ปิดงาน: `state` none (no result yet), no, plan (won, installments of the
 * plan left), pays (won, PAY stages left, no plan), nopay (won, the list has no PAY stage), done (won and
 * received); the closing card's `text`; `hint` for the table's closing row ("ปิดได้เมื่อรับ PAY2", "รอผลการขาย";
 * '' when ready: the button shows); `progress` = "รับแล้ว 50% · เหลือ 53,500" on the plan total, else the Forecast.
 */
export interface ClosingView { ready: boolean; state: 'none' | 'no' | 'plan' | 'pays' | 'nopay' | 'done'; text: string; hint: string; waitFor: string[]; progress: { pct: number; got: number; base: number; left: number } | null }
export function closingView(s: SalesState, d: Deal, today: string): ClosingView {
  const r = dealResult(s, d), ready = closeReady(s, d, today);
  if (r === 'NO') return { ready, state: 'no', text: 'ผลการขายเป็น NO แล้ว ไม่ต้องติดตามต่อ กดปิดงานเพื่อย้ายไปแท็บ “ปิดงาน” (เปิดกลับได้ ยอดยังนับในสรุปปี)', hint: '', waitFor: [], progress: null };
  if (r !== 'YES') return { ready, state: 'none', text: 'ยังไม่มีผลการขาย เมื่อบันทึก CLOSED DEAL เป็น NO หรือ YES และรับชำระครบทุกงวด ระบบจะขึ้นปุ่มปิดงาน', hint: 'รอผลการขาย', waitFor: [], progress: null };
  const ps = payState(s, d, today), P = ps.plan, m = dealMoney(s, d);
  const base = P ? P.total : m.forecast, got = P ? P.got : m.actual || 0;
  const progress = base ? { pct: Math.min(100, Math.round((got / base) * 100)), got, base, left: Math.max(0, base - got) } : null;
  const left = ps.left, hint = left.length ? 'ปิดได้เมื่อรับ ' + left.join(', ') : '';
  const out = (state: ClosingView['state'], text: string): ClosingView => ({ ready, state, text, hint, waitFor: left, progress });
  if (P && left.length) return out('plan', `ได้งานแล้ว · รับ ${P.paidN} จาก ${P.n} งวดตามแผน เมื่อรับครบทุกงวด ระบบจะชวนให้ปิดงาน`);
  if (left.length) return out('pays', `ได้งานแล้ว · รับชำระ ${ps.paid.length} จาก ${ps.pays.length} งวด เมื่อแนบเอกสาร ${left.join(', ')} ระบบจะชวนให้ปิดงาน`);
  if (!ps.pays.length) return out('nopay', 'ได้งานแล้ว ตารางนี้ไม่มีขั้นชำระเงิน (PAY) กดปิดงานเมื่องานจบ');
  return out('done', `ได้งานและรับชำระครบทุกงวด${P ? 'ตามแผน' : ''}แล้ว ปิดงานเพื่อย้ายไปแท็บ “ปิดงาน” ยอด Forecast / Actual ยังนับในสรุปปีเหมือนเดิม`);
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
