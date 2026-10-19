import { useApp } from '../state';
import { beOf, cashLines, fmtMoney, type Deal, type SalesState } from '../lib/sales';
import { yearSplit } from '../lib/cashUi';

/**
 * The payment plan by year (cash impl-note §4, deal panel): when a won deal's money falls in more than one
 * year, "แบ่งตามปีที่ครบกำหนด · ปี 2569 · 2 งวด 371,000 · ปี 2570 · 1 งวด 159,000 · ดูใน Cashflow ปี 2570".
 * Received money counts in the year it came in, the rest in the year it is due (as the Cashflow tab).
 */
export function PlanYears({ S, d, today }: { S: SalesState; d: Deal; today: string }) {
  const { set } = useApp();
  const lines = cashLines(S, [d], today);
  const ys = yearSplit(lines);
  if (ys.length < 2) return null;
  const other = ys.filter((y) => y.year !== d.year).pop() || ys[ys.length - 1];
  return (
    <div className="cf-ysplit">
      <span>{lines.some((l) => l.kind === 'got' && l.date) ? 'แบ่งตามปีที่รับหรือครบกำหนด' : 'แบ่งตามปีที่ครบกำหนด'}</span>
      {ys.map((y) => (
        <span key={y.year}>ปี {y.year} · {y.n} งวด <b>{fmtMoney(y.amt)}</b></span>
      ))}
      <button type="button" className="lnk" onClick={() => set({ tab: 'sales', slView: 'cash', slYear: other.year, slCashShow: '', deal: null })}>ดูใน Cashflow ปี {other.year}</button>
    </div>
  );
}

/** "ข้ามปี · ปี 2570" by an installment whose money falls in another year than the deal's (its due date,
 *  or the day it came in); nothing in the deal's own year or without a date. */
export function YearChip({ d, date }: { d: Deal; date: string }) {
  const y = beOf(date);
  return y && y !== d.year ? <span className="chip">ข้ามปี · ปี {y}</span> : null;
}
