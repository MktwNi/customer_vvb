/**
 * The words and files of the money views (the Cashflow tab, the table's lens "เงินเข้าตามปี", the deal
 * panel's year line, the Dashboard's การรับเงิน): pure helpers over sales.ts cashLines / cashYear, so they
 * are unit-tested. No DOM.
 */
import { TH_M, dmTh } from './format';
import { inRange, rangeTh, type Range } from './dateRange';
import { KIND_TH, beOf, cashKpis, cashTotal, cashYear, csvCell, dealMoney, jointCashLines, payMatch, type CashKpis, type CashLine, type CashSum, type CashYear, type DateBasis, type Deal, type PayF, type SalesState } from './sales';
import { BASIS_TH } from './salesUi';

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
 * are ("ข้ามปี: งวด 3 อยู่ปี 2570", "ข้ามปี: งวด 1–2 อยู่ปี 2569"); an installment split between years (part
 * received in one, the rest due in the next) is "บางส่วนของงวด 1"; '' when they are all in `be` (or there
 * is no plan to number them). `lines` = the deal's own lines.
 */
export function crossYearTag(lines: CashLine[], be: string) {
  // where each installment's money is ('' = undated)
  const at = new Map<number, Set<string>>();
  lines.forEach((l) => l.n > 0 && at.set(l.n, (at.get(l.n) || new Set()).add(beOf(l.date))));
  const by = new Map<string, { whole: number[]; part: number[] }>();
  at.forEach((ys, n) =>
    ys.forEach((y) => {
      if (!y || y === be) return;
      const b = by.get(y) || by.set(y, { whole: [], part: [] }).get(y)!;
      (ys.size > 1 ? b.part : b.whole).push(n);
    }),
  );
  if (!by.size) return '';
  const words = (b: { whole: number[]; part: number[] }) => [instWords(b.whole), b.part.length ? 'บางส่วนของ' + instWords(b.part) : ''].filter(Boolean).join(' และ');
  return 'ข้ามปี: ' + [...by].sort(([a], [b]) => a.localeCompare(b)).map(([y, b]) => `${words(b)} อยู่ปี ${y}`).join(' · ');
}

/** "งวด 1/3", or "ไม่มีแผน" for money without a plan. */
export const instText = (l: CashLine) => (l.n > 0 ? `งวด ${l.n}/${l.of}` : 'ไม่มีแผน');
/** The grey line under it: the installment's step ("PAY3", "PAY" for a plan of one), or where money without a
 *  plan comes from ("รับที่ PAY · พิมพ์เอง", "ใบเสร็จ RC-1", "ส่วนที่ยังไม่รับ"). */
export function instSub(l: CashLine) {
  if (l.src === 'plan') return l.code || l.stage;
  if (l.src === 'doc') return l.doc ? `${KIND_TH[l.doc.kind]}${l.doc.docNo ? ' ' + l.doc.docNo : ''}` : 'เอกสาร';
  if (l.src === 'typed') return (l.stage ? `รับที่ ${l.code || l.stage} · ` : '') + 'พิมพ์เอง';
  return 'ส่วนที่ยังไม่รับ';
}
/** The status in words (the list, the CSV): รับแล้ว / เลยกำหนด / ถึงกำหนด / รอรับ; undated owed money:
 *  ยังไม่กำหนดวันรับ. */
export function statusWord(l: CashLine) {
  if (l.kind === 'got') return 'รับแล้ว';
  if (!l.date) return 'ยังไม่กำหนดวันรับ';
  return l.status === 'late' ? 'เลยกำหนด' : l.status === 'due' ? 'ถึงกำหนด' : 'รอรับ';
}
/** "ใบเสนอราคาร่วม 4 บริษัท", and under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter "· ส่วนของ 1 บริษัท" (the amount is that part). */
export const jointWords = (j: NonNullable<CashLine['joint']>) => `ใบเสนอราคาร่วม ${j.members} บริษัท${j.part ? ` · ส่วนของ ${j.part} บริษัท` : ''}`;
/** The client as the money views name a line, on its first line: the company; a joint quotation's line its payer,
 *  the organisation that hires and pays, as the table's band names it (owner, Oct 2569: the organisation on top,
 *  the quotation under it: jointLineWords). */
export const payerName = (l: CashLine, short: (s: string) => string = (s) => s) => short(l.deal.client);
/** What a money line knows of its joint quotation: a CashLine's joint, or a money-out line's (expenseMoney,
 *  `role` 'member' for an expense on one company of it). */
type JointBit = { joint?: { members: number; part?: number; role?: 'header' | 'member' } | null };
/** A joint quotation's line under its payer, in parts: ["ใบเสนอราคาร่วม QT-2569-052", "4 บริษัท"], and under a
 *  ผู้รับผิดชอบ / SOURCE / REFERRAL filter "ส่วนของ 1 บริษัท" (the amount is that part); [] for any other line.
 *  A money-out line of one company in it: ["บริษัทในใบเสนอราคาร่วม QT-2569-052"]. `no` the quotation's number
 *  (lib/joint jointNo). On screen the parts wrap between them, each moved down whole (MonthCheck SubLine). */
export const jointLineParts = (l: JointBit, no = ''): string[] => {
  const j = l.joint, qt = `ใบเสนอราคาร่วม${no ? ' ' + no : ''}`;
  if (!j) return [];
  if (j.role === 'member') return ['บริษัทใน' + qt];
  return [qt, `${j.members} บริษัท`, j.part ? `ส่วนของ ${j.part} บริษัท` : ''].filter(Boolean);
};
/** The same on one line: "ใบเสนอราคาร่วม QT-2569-052 · 4 บริษัท · ส่วนของ 1 บริษัท" ('' for any other line). */
export const jointLineWords = (l: JointBit, no = '') => jointLineParts(l, no).join(' · ');

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

/**
 * The table in the lens "เงินเข้าตามปี": each deal's counted money (`inYear`: its lines in the year, and
 * inside the date range when one is set), every line of each deal (the payment rows say where theirs
 * fall), and the cards. The cards count the same lines as the money cells: the year's, or with a range
 * the range's (cashCardWords says which).
 */
export interface CashLens { year: string; range: Range | null; inYear: Map<string, CashLine[]>; byDeal: Map<string, CashLine[]>; K: CashKpis }
export function cashLensOf(S: SalesState, deals: Deal[], year: string, range: Range | null, today: string, attr = false): CashLens {
  // (`attr`: under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter a joint quotation's lines carry the parts of its companies listed)
  const lines = jointCashLines(S, deals, today, attr);
  const counted = range ? lines.filter((l) => !l.date || inRange(l.date, range)) : lines;
  const Y = cashYear(counted, year);
  const inYear = new Map<string, CashLine[]>(), byDeal = new Map<string, CashLine[]>();
  Y.lines.forEach((l) => inYear.set(l.deal.id, [...(inYear.get(l.deal.id) || []), l]));
  lines.forEach((l) => byDeal.set(l.deal.id, [...(byDeal.get(l.deal.id) || []), l]));
  return { year, range, inYear, byDeal, K: cashKpis(Y, year, today) };
}
/**
 * An installment's row in the lens: the money of it that counts (`inYear`: its lines in the year, or in
 * the range) and where it falls, under the amount: "นับในปี 2570" (with a range "นับในช่วงนี้"), with
 * "· อีกส่วนอยู่ปี 2569" when part of it falls elsewhere (part received in one year, the rest due in the
 * next); when none of it counts, the whole installment and where it is ("อยู่ปี 2569", "นอกช่วงที่เลือก",
 * "ยังไม่กำหนดวัน"). text '' for a stage with no money line (not a plan installment, nothing owed nor received).
 */
export function lensWhere(L: CashLens, d: Deal, stage: string): { inYear: boolean; text: string; amt: number } {
  const ls = (L.byDeal.get(d.id) || []).filter((l) => l.stage === stage && l.src === 'plan');
  if (!ls.length) return { inYear: false, text: '', amt: 0 };
  const counted = new Set((L.inYear.get(d.id) || []).filter((l) => l.stage === stage && l.src === 'plan').map((l) => l.id));
  const here = ls.filter((l) => counted.has(l.id)), rest = ls.filter((l) => !counted.has(l.id));
  const sum = (xs: CashLine[]) => xs.reduce((a, l) => a + l.amt, 0);
  // where lines that do not count are: other years, this year outside the range, no date
  const place = (xs: CashLine[]) => {
    const ys = [...new Set(xs.map((l) => beOf(l.date)).filter((y) => y && y !== L.year))].sort();
    if (ys.length) return `อยู่ปี ${ys.join(', ')}`;
    return xs.some((l) => l.date) ? 'อยู่นอกช่วงที่เลือก' : 'ยังไม่กำหนดวัน';
  };
  if (!here.length) return { inYear: false, text: place(rest), amt: sum(ls) };
  const text = L.range ? 'นับในช่วงนี้' : `นับในปี ${L.year}`;
  return { inYear: true, text: rest.length ? `${text} · อีกส่วน${place(rest)}` : text, amt: sum(here) };
}
/**
 * What the Cashflow cards are called: the year's ("เงินเข้าทั้งปี · 2569", "ค้างรับในปีนี้"), or, in the
 * table's lens with a ช่วงเวลา, the range's, named the way the deal lens names its hero ("เงินเข้า · ติดต่อ"
 * + "ต.ค. – ธ.ค.", "ค้างรับในช่วงนี้"). `scope` ends the empty footers ("ยังไม่มีเงินเข้าในปีนี้").
 */
export function cashCardWords(year: string, at?: { basis: DateBasis; r: Range } | null) {
  if (!at) return { hero: `เงินเข้าทั้งปี · ${year}`, heroR: '', heroTitle: 'รับแล้วนับตามวันที่รับเงิน ที่ยังไม่รับนับตามวันครบกำหนด', owed: 'ค้างรับในปีนี้', scope: 'ในปีนี้', undated: 'ไม่อยู่ในยอดปี' };
  const w = BASIS_TH[at.basis];
  return {
    hero: `เงินเข้า · ${w.short}`,
    heroR: rangeTh(at.r, { dropYear: year }),
    heroTitle: `นับเฉพาะงานตามตัวกรอง · ${w.sent} ${rangeTh(at.r)} · นับเฉพาะงวดที่รับเงินหรือครบกำหนดในช่วงนี้`,
    owed: 'ค้างรับในช่วงนี้',
    scope: 'ในช่วงนี้',
    undated: 'ไม่อยู่ในยอดช่วงนี้',
  };
}

/** The 12 months of `ceYear` for the date popover while การรับเงิน is set: in each, how many deals have
 *  money of that kind on its own dates (received on the day it came in, owed on its due date), as the
 *  filter and its footer count them; undated money is in no month. */
export function payMonthCounts(lines: CashLine[], p: Exclude<PayF, ''>, ceYear: number): number[] {
  const by = Array.from({ length: 12 }, () => new Set<string>()), y = String(ceYear) + '-';
  lines.forEach((l) => payMatch(l, p) && l.date.startsWith(y) && by[+l.date.slice(5, 7) - 1].add(l.deal.id));
  return by.map((s) => s.size);
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
    be, l.date ? monthYearTh(l.date) : '', l.joint ? `${l.deal.client} (${jointWords(l.joint)})` : l.deal.client, l.dealYear, l.deal.section, l.deal.resp,
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
