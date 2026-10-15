/**
 * The words and files of the money views (the Cashflow tab, the table's lens "เงินเข้าตามปี", the deal
 * panel's year line, the Dashboard's การรับเงิน): pure helpers over sales.ts cashLines / cashYear, so they
 * are unit-tested. No DOM.
 */
import { TH_M, dmTh } from './format';
import { inRange, type Range } from './dateRange';
import { KIND_TH, beOf, cashKpis, cashLines, cashTotal, cashYear, csvCell, dealMoney, payMatch, type CashKpis, type CashLine, type CashSum, type CashYear, type Deal, type PayF, type SalesState } from './sales';

export const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
/** The months of each calendar quarter: "ม.ค.–มี.ค.". */
export const Q_TH = ['ม.ค.–มี.ค.', 'เม.ย.–มิ.ย.', 'ก.ค.–ก.ย.', 'ต.ค.–ธ.ค.'];

/** Installment numbers in words: "งวด 3", "งวด 1–2", "งวด 1, 3". */
export function instWords(ns: number[]) {
  const s = [...new Set(ns)].filter((n) => n > 0).sort((a, b) => a - b);
  if (!s.length) return '';
  const run = s.every((n, i) => !i || n === s[i - 1] + 1);
  return 'งวด ' + (s.length > 1 && run ? `${s[0]}–${s[s.length - 1]}` : s.join(', '));
}

/**
 * The tag of a deal whose installments fall in more than one year, seen from year `be`: where the others
 * are ("ข้ามปี: งวด 3 อยู่ปี 2570", "ข้ามปี: งวด 1–2 อยู่ปี 2569"); '' when they are all in `be` (or there is
 * no plan to number them). `lines` = the deal's own lines.
 */
export function crossYearTag(lines: CashLine[], be: string) {
  const by = new Map<string, number[]>();
  lines.forEach((l) => {
    const y = beOf(l.date);
    if (y && y !== be && l.n > 0) by.set(y, [...(by.get(y) || []), l.n]);
  });
  if (!by.size) return '';
  return 'ข้ามปี: ' + [...by].sort(([a], [b]) => a.localeCompare(b)).map(([y, ns]) => `${instWords(ns)} อยู่ปี ${y}`).join(' · ');
}

/** "งวด 1/3", or "ไม่มีแผน" for money without a plan. */
export const instText = (l: CashLine) => (l.n > 0 ? `งวด ${l.n}/${l.of}` : 'ไม่มีแผน');
/** The grey line under it: the stage ("PAY3 · งวดเพิ่ม"), or where money without a plan comes from
 *  ("รับที่ PAY1 · พิมพ์เอง", "ใบเสร็จ RC-1", "ส่วนที่ยังไม่รับ"). */
export function instSub(l: CashLine) {
  if (l.src === 'plan') return l.stage + (l.extra ? ' · งวดเพิ่ม' : '');
  if (l.src === 'doc') return l.doc ? `${KIND_TH[l.doc.kind]}${l.doc.docNo ? ' ' + l.doc.docNo : ''}` : 'เอกสาร';
  if (l.src === 'typed') return (l.stage ? `รับที่ ${l.stage} · ` : '') + 'พิมพ์เอง';
  return 'ส่วนที่ยังไม่รับ';
}
/** The status in words (the list, the CSV): รับแล้ว / เลยกำหนด / ถึงกำหนด / รอรับ; undated owed money:
 *  ยังไม่กำหนดวันรับ. */
export function statusWord(l: CashLine) {
  if (l.kind === 'got') return 'รับแล้ว';
  if (!l.date) return 'ยังไม่กำหนดวันรับ';
  return l.status === 'late' ? 'เลยกำหนด' : l.status === 'due' ? 'ถึงกำหนด' : 'รอรับ';
}
/** The client as the money views name it: a joint quotation's header says how many companies it pays for. */
export const payerName = (l: CashLine, short: (s: string) => string = (s) => s) => (l.joint ? `${short(l.deal.client)} · ใบเสนอราคาร่วม ${l.joint.members} บริษัท` : short(l.deal.client));

/** The year picker's line on the money views: "เงินเข้า 15 งวด" / "ไม่มีเงินเข้า". */
export const yearMoneyLabel = (Y: Pick<CashYear, 'totals'>) => (Y.totals.n ? `เงินเข้า ${Y.totals.n} งวด` : 'ไม่มีเงินเข้า');

/** A deal's money by the year it falls in (the deal panel's "แบ่งตามปีที่ครบกำหนด"): one entry per year,
 *  in order, with how many installments and how much; undated money is left out. */
export function yearSplit(lines: CashLine[]): { year: string; n: number; amt: number }[] {
  const by = new Map<string, { insts: Set<string>; amt: number }>();
  lines.forEach((l) => {
    const y = beOf(l.date);
    if (!y) return;
    const b = by.get(y) || by.set(y, { insts: new Set(), amt: 0 }).get(y)!;
    b.insts.add(l.stage || l.id);
    b.amt += l.amt;
  });
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([year, b]) => ({ year, n: b.insts.size, amt: b.amt }));
}

/** A deal of the data whose money falls in more than one year (the lens popover's worked example), the one
 *  with the most money; null when there is none. */
export function splitExample(lines: CashLine[]): { deal: Deal; total: number; n: number; last: string; years: { year: string; amt: number }[] } | null {
  const by = new Map<string, CashLine[]>();
  lines.forEach((l) => l.date && by.set(l.deal.id, [...(by.get(l.deal.id) || []), l]));
  let best: ReturnType<typeof splitExample> = null;
  by.forEach((ls) => {
    const ys = yearSplit(ls);
    if (ys.length < 2) return;
    const total = ys.reduce((a, y) => a + y.amt, 0);
    if (best && best.total >= total) return;
    const last = ls.map((l) => l.date).sort().pop()!;
    best = { deal: ls[0].deal, total, n: new Set(ls.map((l) => l.stage || l.id)).size, last, years: ys.map(({ year, amt }) => ({ year, amt })) };
  });
  return best;
}

/** การรับเงิน's choices (the Dashboard's filter) and the grey line under each. */
export const PAY_TH: Record<Exclude<PayF, ''>, { label: string; desc: string }> = {
  got: { label: 'รับแล้ว', desc: 'นับตามวันที่รับเงิน' },
  owed: { label: 'ค้างรับ', desc: 'นับตามวันครบกำหนด' },
  late: { label: 'เลยกำหนด', desc: 'เลยวันครบกำหนดแล้ว ยังไม่ได้รับ' },
};
/** The money of one kind inside a range (undated money is in none): how much, how many amounts, from how
 *  many deals. */
export function payIn(lines: CashLine[], p: Exclude<PayF, ''>, r: Range) {
  const ls = lines.filter((l) => payMatch(l, p) && inRange(l.date, r));
  return { amt: ls.reduce((a, l) => a + l.amt, 0), n: ls.length, deals: new Set(ls.map((l) => l.deal.id)).size };
}

/** The table in the lens "เงินเข้าตามปี": each deal's money in the year (and inside the date range when
 *  one is set: it narrows the counted installments), every line of each deal (the payment rows say where
 *  theirs fall), and the year's cards. */
export interface CashLens { year: string; range: Range | null; inYear: Map<string, CashLine[]>; byDeal: Map<string, CashLine[]>; K: CashKpis }
export function cashLensOf(S: SalesState, deals: Deal[], year: string, range: Range | null, today: string): CashLens {
  const lines = cashLines(S, deals, today);
  const counted = range ? lines.filter((l) => !l.date || inRange(l.date, range)) : lines;
  const Y = cashYear(counted, year);
  const inYear = new Map<string, CashLine[]>(), byDeal = new Map<string, CashLine[]>();
  Y.lines.forEach((l) => inYear.set(l.deal.id, [...(inYear.get(l.deal.id) || []), l]));
  lines.forEach((l) => byDeal.set(l.deal.id, [...(byDeal.get(l.deal.id) || []), l]));
  return { year, range, inYear, byDeal, K: cashKpis(Y, year, today) };
}
/** Where an installment's money falls, under its amount in the lens: "นับในปี 2570" or "อยู่ปี 2569"
 *  ('' for a stage with no money line: not a plan installment, or nothing owed nor received on it). */
export function lensWhere(L: CashLens, d: Deal, stage: string): { inYear: boolean; text: string } {
  const ls = (L.byDeal.get(d.id) || []).filter((l) => l.stage === stage && l.src === 'plan');
  if (!ls.length) return { inYear: false, text: '' };
  if ((L.inYear.get(d.id) || []).some((l) => l.stage === stage)) return { inYear: true, text: `นับในปี ${L.year}` };
  const ys = [...new Set(ls.map((l) => beOf(l.date)).filter(Boolean))].sort();
  return { inYear: false, text: ys.length ? `อยู่ปี ${ys.join(', ')}` : 'ยังไม่กำหนดวัน' };
}
/** A section's sums in the lens: the money falling in the year, and what of it came in. */
export function lensSum(L: CashLens, deals: Deal[]) {
  let fc = 0, ac = 0;
  deals.forEach((d) => (L.inYear.get(d.id) || []).forEach((l) => ((fc += l.amt), l.kind === 'got' && (ac += l.amt))));
  return { fc, ac };
}

/** "ต.ค. 2569" for the month of a date. */
export const monthYearTh = (iso: string) => `${TH_M[+iso.slice(5, 7) - 1]} ${beOf(iso)}`;
/** "15 ก.พ. 2570": a day with its Buddhist-era year (dmTh without it). */
export const dayTh = (iso: string) => (iso ? `${dmTh(iso)} ${beOf(iso)}` : '');

/** What the CSV holds: one row per installment, or the months or quarters summed. */
export type CashCsvMode = 'lines' | 'month' | 'quarter';
/**
 * The Cashflow file of a year (Excel opens it): `lines` one row per amount, soonest first, the undated ones
 * last with an empty month (`undated`); `month` / `quarter` the sums, then the undated money in one row.
 * ISO dates (Excel sorts them), plain numbers, amounts as on the documents; an empty cell stays empty.
 */
export function cashRows(s: SalesState, be: string, Y: CashYear, mode: CashCsvMode, undated: boolean): { head: string[]; rows: (string | number)[][] } {
  if (mode !== 'lines') {
    const head = ['ปี (พ.ศ.)', mode === 'month' ? 'เดือน' : 'ไตรมาส', 'รับแล้ว (บาท)', 'เลยกำหนด (บาท)', 'รอรับ (บาท)', 'รวม (บาท)', 'จำนวนงวด'];
    const row = (label: string, c: CashSum): (string | number)[] => [be, label, c.got, c.late, c.wait, cashTotal(c), c.n];
    const rows = mode === 'month' ? Y.months.map((c, i) => row(`${TH_M[i]} ${be}`, c)) : Y.quarters.map((c, i) => row(`ไตรมาส ${i + 1} (${Q_TH[i]})`, c));
    if (undated && Y.undated.length) {
      const u: CashSum = { got: 0, late: 0, wait: 0, n: Y.undated.length };
      Y.undated.forEach((l) => (l.kind === 'got' ? (u.got += l.amt) : (u.wait += l.amt)));
      rows.push(row('ยังไม่กำหนดวันรับ', u));
    }
    return { head, rows };
  }
  const head = ['ปี (พ.ศ.)', 'เดือน', 'ลูกค้า', 'ปีของงาน', 'หมวด', 'ผู้รับผิดชอบ', 'งวด', 'ยอด (บาท)', 'ครบกำหนด', 'วันที่รับ', 'สถานะ', 'เลขใบเสนอราคา', 'ใบเสนอราคาร่วม (จำนวนบริษัท)'];
  const line = (l: CashLine): (string | number)[] => [
    be, l.date ? monthYearTh(l.date) : '', l.joint ? `${l.deal.client} (ใบเสนอราคาร่วม ${l.joint.members} บริษัท)` : l.deal.client, l.dealYear, l.deal.section, l.deal.resp,
    l.n > 0 ? `${l.n}/${l.of}` : 'ไม่มีแผน', l.amt, l.due, l.rcv, statusWord(l), dealMoney(s, l.deal).fcDoc?.docNo || '', l.joint ? l.joint.members : '',
  ];
  return { head, rows: [...Y.lines.map(line), ...(undated ? Y.undated.map(line) : [])] };
}
/** The rows as CSV text (no BOM: the download adds it). */
export const cashCsv = (r: { head: string[]; rows: (string | number)[][] }) => [r.head.map(csvCell).join(','), ...r.rows.map((x) => x.map(csvCell).join(','))].join('\r\n');

/** One money axis from 0: a round step (1, 2, 2.5 or 5 × 10ⁿ) about a third of the largest value, the
 *  ticks up to it, and the axis top (the largest value, or the last tick when that is higher). */
export function moneyTicks(max: number): { ticks: number[]; top: number } {
  if (!(max > 0)) return { ticks: [0], top: 1 };
  const raw = max / 3.2, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
  const k = Math.max(1, Math.floor(max / step));
  return { ticks: Array.from({ length: k + 1 }, (_, i) => i * step), top: Math.max(max, k * step) };
}
/** A tick label: 0, 50K, 200K, 1M, 1.5M. */
export const compactBaht = (v: number) => (!v ? '0' : v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : `${+(v / 1e3).toFixed(1)}K`);
