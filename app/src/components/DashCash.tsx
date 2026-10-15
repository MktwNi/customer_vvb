import { useState } from 'react';
import { fmtN } from '../lib/format';
import { cashTotal, fmtMoney, type CashLine, type CashYear, type PayF } from '../lib/sales';
import { shortName } from '../lib/salesUi';
import { PAY_TH, Q_TH, compactBaht, moneyTicks, payIn } from '../lib/cashUi';
import { rangeTh, type Range } from '../lib/dateRange';
import type { FField, FVal } from './FilterBar';

/**
 * The Dashboard's money (dash impl-note §4, phase 1): the การรับเงิน filter, the "รับเงินแล้ว" stat after
 * the three original ones, and the card "เงินเข้ารายไตรมาส" (totals only) under the original grid. All of
 * it from sales.ts cashLines: received on the day it came in, owed on its due date, the deals of every year
 * whose money falls in the year, undated money apart.
 */

const m0 = (n: number) => fmtMoney(Math.round(n)) || '0';

/** การรับเงิน as a pinned field of the filter row: one choice, each with its money and how many
 *  installments in the range; the undated money said apart; the footer the draft's deals and money. */
export function payField(lines: CashLine[], r: Range, rangeWords: string, undated: { amt: number; deals: number }, count: (p: PayF) => number): FField {
  const opt = (p: Exclude<PayF, ''>) => {
    const x = payIn(lines, p, r);
    return { v: p, label: PAY_TH[p].label, desc: PAY_TH[p].desc, meta: <><b className={p === 'late' && x.amt ? 'bad' : undefined}>{m0(x.amt)}</b><small>{fmtN(x.n)} งวด</small></> };
  };
  return {
    key: 'pay', label: 'การรับเงิน', kind: 'single', pinned: true, rest: 'ทั้งหมด', all: 'ทั้งหมด', allDesc: 'ไม่กรองตามการรับเงิน',
    options: [opt('got'), opt('owed'), opt('late')],
    lead: `นับเงินตามวันที่ของแต่ละงวด ในช่วงเวลาที่เลือก (${rangeWords}) รวมงานจากปีอื่นที่มีงวดในปีนี้`,
    note: undated.amt ? `ยังไม่กำหนดวันรับ ${m0(undated.amt)} บาท (${fmtN(undated.deals)} งาน) แยกไว้ ไม่นับในช่วงใด` : undefined,
    sum: (d: FVal | null) => {
      const p = (d?.v[0] || '') as PayF;
      return <>เหลือ <b>{fmtN(count(p))}</b> ราย{p ? <> · <b>{m0(payIn(lines, p, r).amt)}</b> บาท</> : null}</>;
    },
  };
}

/** A banknote, drawn like the app's other line icons (16px, the brand colour). */
const CashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6.5 9.5h.01M17.5 14.5h.01" />
  </svg>
);

/**
 * The 4th stat: money received in the range (the whole year without one), or what การรับเงิน asks for
 * (ค้างรับ / เลยกำหนด, the late figure red). Its line: the other two figures, or with a range "2 งวด จาก
 * 2 ราย · ก.ค. – ก.ย. 2569". The ring card keeps the whole deals' money (the owner's layout is kept).
 */
export function CashStat({ lines, pay, r, ranged, when }: { lines: CashLine[]; pay: PayF; r: Range; ranged: boolean; when: string }) {
  const k: Exclude<PayF, ''> = pay || 'got';
  const got = payIn(lines, 'got', r), owed = payIn(lines, 'owed', r), late = payIn(lines, 'late', r), x = { got, owed, late }[k];
  const label = (k === 'got' ? 'รับเงินแล้ว' : PAY_TH[k].label) + when;
  return (
    <div className={'sd-stat cash' + (k === 'late' && x.amt ? ' bad' : '')} title={ranged ? `นับเฉพาะเงินในช่วง ${rangeTh(r)}` : undefined}>
      <span className="sd-stat-l"><CashIcon />{label}</span>
      <span className="sd-stat-v"><b>{m0(x.amt)}</b> บาท</span>
      <small>
        {ranged ? (
          `${fmtN(x.n)} งวด จาก ${fmtN(x.deals)} ราย · ${rangeTh(r)}`
        ) : k === 'got' ? (
          <>ค้างรับ {m0(owed.amt)}{late.amt > 0 && <> · <em>เลยกำหนด {m0(late.amt)}</em></>}</>
        ) : (
          <>รับแล้ว {m0(got.amt)}{k === 'owed' && late.amt > 0 ? <> · <em>เลยกำหนด {m0(late.amt)}</em></> : k === 'late' ? ` · ค้างรับ ${m0(owed.amt)}` : ''}</>
        )}
      </small>
    </div>
  );
}

const PLOT = 200, ROOM = 44; // the plot's height, and the room over the tallest column for its labels

/**
 * "เงินเข้ารายไตรมาส · ปี 2569" (totals only: the unit split comes with units and commission): the four
 * calendar quarters of the whole year, received as a solid column and what is still owed (late included,
 * "ค้างรับ") as the light outlined part over it; the received total over each, "ค้างรับ x" under it; this
 * quarter named "ตอนนี้", a quarter picked in ช่วงเวลา tinted. A table with every figure (late in red) and
 * the undated money with "ตั้งแผนชำระ".
 */
export function QuarterCard({ Y, year, now, pick, onCashTab, onPlan, canPlan }: { Y: CashYear; year: string; now: number; pick: number; onCashTab: () => void; onPlan: (dealId: string | null) => void; canPlan: boolean }) {
  const [tip, setTip] = useState<number | null>(null);
  const qs = Y.quarters, owedOf = (i: number) => qs[i].late + qs[i].wait;
  const { ticks, top } = moneyTicks(Math.max(0, ...qs.map(cashTotal)));
  const px = (v: number) => Math.round((v / top) * (PLOT - ROOM));
  const und = Y.undated;
  const undAmt = und.reduce((a, l) => a + l.amt, 0), undDeals = [...new Set(und.map((l) => l.deal.id))];
  const z = (n: number) => (n ? m0(n) : <span className="z">—</span>);
  const tot = { got: Y.totals.got, owed: Y.totals.late + Y.totals.wait, late: Y.totals.late };
  return (
    <section className="sd-card sd-cash" aria-labelledby="sd-cash-t">
      <div className="sd-card-h">
        <h3 className="sd-card-t" id="sd-cash-t">เงินเข้ารายไตรมาส · ปี {year}</h3>
        <button type="button" className="lnk sd-h-lnk" onClick={onCashTab}>ดูรายงวดใน Cashflow</button>
      </div>
      <p className="sd-sub">รับแล้วนับตามวันที่รับเงิน · ค้างรับนับตามวันครบกำหนด</p>
      <div className="qk" aria-hidden="true">
        <span><i className="ud got" />รับแล้ว</span>
        <span><i className="ud wait" />ค้างรับ (ตามวันครบกำหนด)</span>
      </div>
      <div className="qc">
        <div className="qc-plot" onMouseLeave={() => setTip(null)}>
          {ticks.map((t) => (
            <span key={t}>
              <i className={'qc-gl' + (t ? '' : ' base')} style={{ bottom: px(t) }} />
              <span className="qc-yl" style={{ bottom: px(t) }} aria-hidden="true">{compactBaht(t)}</span>
            </span>
          ))}
          <div className="qc-cols">
            {qs.map((q, i) => {
              const owed = owedOf(i);
              const words = `ไตรมาส ${i + 1} ${Q_TH[i]} ${year}: รับแล้ว ${m0(q.got)} บาท${owed ? ` · ค้างรับ ${m0(owed)} บาท` : ''}${q.late ? ` · เลยกำหนด ${m0(q.late)} บาท` : ''}`;
              return (
                <div key={i} className={'qc-g' + (pick === i ? ' pick' : '')} tabIndex={0} role="img" aria-label={words} onMouseEnter={() => setTip(i)} onFocus={() => setTip(i)} onBlur={() => setTip(null)}>
                  {pick === i && <span className="qc-pick" aria-hidden="true">ช่วงที่เลือก</span>}
                  {tip === i && (q.got > 0 || owed > 0) && (
                    <div className="qc-tip" role="tooltip" style={{ bottom: px(q.got + owed) + ROOM, ...(i === 0 ? { left: 0, transform: 'none' } : i === 3 ? { left: 'auto', right: 0, transform: 'none' } : {}) }}>
                      <span className="qc-tip-t">ไตรมาส {i + 1} · {Q_TH[i]} {year}</span>
                      <span><i className="ud got" />รับแล้ว<b>{m0(q.got)}</b></span>
                      {owed > 0 && <span><i className="ud wait" />ค้างรับ<b>{m0(owed)}</b></span>}
                      {q.late > 0 && <span className="bad">เลยกำหนด<b>{m0(q.late)}</b></span>}
                    </div>
                  )}
                  <div className="qc-lab" aria-hidden="true">
                    {q.got ? <b>{m0(q.got)}</b> : <b className="z">0</b>}
                    {owed > 0 && <small>ค้างรับ {m0(owed)}</small>}
                  </div>
                  <div className="qc-col" aria-hidden="true">
                    {q.got > 0 && <i className="rcv" style={{ height: Math.max(3, px(q.got) - 2) }} />}
                    {owed > 0 && <i className="wait" style={{ height: Math.max(3, px(owed) - 2) }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="qc-x" aria-hidden="true">
          {qs.map((_, i) => (
            <span key={i} className={i === now ? 'now' : undefined}>ไตรมาส {i + 1}<small>{Q_TH[i]}{i === now ? ' · ตอนนี้' : ''}</small></span>
          ))}
        </div>
      </div>
      <table className="qt qt-wide">
        <thead><tr><th /><th>ไตรมาส 1</th><th>ไตรมาส 2</th><th>ไตรมาส 3</th><th>ไตรมาส 4</th><th>ทั้งปี</th></tr></thead>
        <tbody>
          <tr className="sum"><td>รับแล้ว</td>{qs.map((q, i) => <td key={i}>{z(q.got)}</td>)}<td>{m0(tot.got)}</td></tr>
          <tr className="wait">
            <td>ค้างรับ</td>
            {qs.map((q, i) => <td key={i}>{z(owedOf(i))}{q.late > 0 && <small>เลยกำหนด {m0(q.late)}</small>}</td>)}
            <td>{z(tot.owed)}</td>
          </tr>
        </tbody>
      </table>
      <table className="qt qt-narrow">
        <thead><tr><th>ไตรมาส</th><th>รับแล้ว</th><th>ค้างรับ</th></tr></thead>
        <tbody>
          {qs.map((q, i) => (
            <tr key={i} className={i === now ? 'now' : undefined}>
              <td>ไตรมาส {i + 1}<small className="qn">{Q_TH[i]}</small></td>
              <td>{z(q.got)}</td>
              <td>{z(owedOf(i))}{q.late > 0 && <small>เลยกำหนด {m0(q.late)}</small>}</td>
            </tr>
          ))}
          <tr className="sum"><td>ทั้งปี</td><td>{m0(tot.got)}</td><td>{m0(tot.owed)}</td></tr>
        </tbody>
      </table>
      {undAmt > 0 && (
        <div className="qc-und">
          <span>ยังไม่กำหนดวันรับ</span>
          <b>{m0(undAmt)}</b>
          <span className="qc-und-s">{undDeals.length === 1 ? shortName(und[0].deal.client) : `${fmtN(undDeals.length)} งาน`} · ได้งานแล้ว {und.every((l) => l.src === 'rest') ? 'ยังไม่ตั้งแผนชำระ' : 'ยังไม่กำหนดวันรับ'}</span>
          {canPlan && <button type="button" className="lnk" onClick={() => onPlan(undDeals.length === 1 ? undDeals[0] : null)}>ตั้งแผนชำระ</button>}
        </div>
      )}
    </section>
  );
}
