/**
 * The work count (owner: "how many companies we worked for", the joint quotation of 10 companies closed once)
 * as each screen says it: the ปิดงาน tab's line and small line, the ทำงานให้ card on the Dashboard, the export's
 * menu line and the closing dialog's count. The numbers are always one workTally (lib/sales; the engine's
 * wrapper keys a company by its registry entry); these give each screen its list and its words, so the screens
 * and their parity test (workUi.test.ts) read the same thing. Pure, no DOM.
 */
import { fmtN } from './format';
import { filterDeals, fmtMoney, type Deal, type SalesFilter, type SalesState, type WorkTally } from './sales';

/** The ปิดงาน tab's rows for the table's filters `F`: its closed jobs (the quick views are about open work,
 *  not applied there). Its tab counter is the jobs of these for the year alone ({ year }). */
export const closedTabRows = (s: SalesState, F: SalesFilter, today: string): Deal[] => filterDeals(s, { ...F, quick: '', job: 'closed' }, today);

/**
 * The Dashboard's ทำงานให้ card's list for its filters `F`: a date range is read on the day each job closed
 * (owner text: "นับงานที่กดปิดงานในช่วงนั้น"), whatever the range's own basis; การรับเงิน does not apply (it would
 * read the range on the money's dates while the card says "ปิดใน…", critic 5). Its number is the companies
 * worked for of this list (workTally with jointAttr(F)).
 */
export const workCardRows = (s: SalesState, F: SalesFilter, today: string): Deal[] =>
  filterDeals(s, { ...F, quick: '', pay: undefined, date: F.date ? { ...F.date, basis: 'closed' } : null }, today);
/** The card's small line: what it counts, in the period picked (`q` a quarter picked, else `ranged` any range). */
export const workCardSub = (q: number, ranged: boolean) => `ได้งานและ${q ? `ปิดในไตรมาส ${q}` : ranged ? 'ปิดในช่วงนี้' : 'ปิดงานแล้ว'} · ไม่นับซ้ำ`;

/** A line in pieces: [words, the figure (bold), unit], read joined with " · ". */
export type LinePart = [string, string, string];
export const lineText = (parts: LinePart[]) => parts.map((p) => p.join('')).join(' · ');
/**
 * The ปิดงาน tab's line: "ปิดแล้ว 6 งาน · ทำงานให้ 13 บริษัท · Forecast 1,725,000 · Actual 1,515,000" (a joint
 * quotation one job, its companies each a company worked for; `money` the list's moneySum, null without
 * ดูยอดเงิน).
 */
export function closedLine(t: Pick<WorkTally, 'jobs' | 'worked'>, money: { fc: number; ac: number } | null): LinePart[] {
  return [
    ['ปิดแล้ว ', fmtN(t.jobs), ' งาน'],
    ['ทำงานให้ ', fmtN(t.worked), ' บริษัท'],
    ...(money ? ([['Forecast ', fmtMoney(money.fc) || '0', ''], ['Actual ', fmtMoney(money.ac) || '0', '']] as LinePart[]) : []),
  ];
}
/**
 * The small line under it: the filter in force (`filtered`, '' without), how it counts in short (the joint
 * quotation's sentence only when the list has one), the companies lost and the rows still without a result.
 */
export function closedMeta(t: Pick<WorkTally, 'joint' | 'lost' | 'noResult'>, filtered: string): string {
  return [
    filtered,
    t.joint ? 'ใบเสนอราคาร่วม 1 ใบนับเป็น 1 งาน เงินนับครั้งเดียว' : '',
    'นับบริษัทที่ได้งาน บริษัทซ้ำนับครั้งเดียว',
    t.lost ? `ไม่ได้งาน ${fmtN(t.lost)} บริษัท` : '',
    t.noResult ? `ยังไม่มีผล ${fmtN(t.noResult)} บริษัท` : '',
    'เปิดกลับได้',
  ]
    .filter(Boolean)
    .join(' · ');
}
/** The ปิดงาน export's menu line (its two count columns sum to these). */
export const closedExportSub = (t: Pick<WorkTally, 'jobs' | 'worked'>) => `${fmtN(t.jobs)} งาน · ทำงานให้ ${fmtN(t.worked)} บริษัท · ตามตัวกรองของแท็บนี้`;

/**
 * The closing dialog's count, under its companies: "ปิดแล้วนับเป็น 1 งาน · ทำงานให้ N บริษัท" (`worked`: the
 * companies of the quotation once closed, lib/joint closedJoint), then what closing records: the payer's result
 * (`fill`) for the `filled` companies without one, or, while the payer has none, that the `waiting` companies
 * count once it is recorded (the payer's result saved after the closing reaches them, engine.setStep).
 */
export function jointCloseCount(o: { worked: number; fill: 'YES' | 'NO' | ''; filled: number; waiting: number; payer: string }): { count: string; more: string[] } {
  const word = o.fill === 'YES' ? 'ได้งาน' : 'ไม่ได้งาน';
  return {
    count: `ปิดแล้วนับเป็น 1 งาน · ทำงานให้ ${fmtN(o.worked)} บริษัท`,
    more: [
      o.fill && o.filled ? `บริษัทที่ยังไม่มีผลจะบันทึกเป็น “${word}” ตามผลของ ${o.payer}` : '',
      !o.fill && o.waiting ? `บริษัทที่ยังไม่มีผลจะนับเป็นบริษัทที่ทำงานให้เมื่อบันทึกผลของ ${o.payer}` : '',
      'ย้ายไปแท็บปิดงานเป็นกลุ่มเดียว เปิดกลับได้',
    ].filter(Boolean),
  };
}
