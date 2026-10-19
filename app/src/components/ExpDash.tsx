import { useState, type ReactNode } from 'react';
import { fmtN } from '../lib/format';
import { fmtMoney, type CashLine, type CashYear, type SalesFilterIn, type SalesState } from '../lib/sales';
import { Q_TH } from '../lib/cashUi';
import { periodRange, unitsOf, type CommPeriod, type UnitCtx } from '../lib/contrib';
import { expByCat, expIn, expView, expYear, netQuarters, pctWord, topCats, unitNets, type NetRow } from '../lib/expenseMoney';
import { unitCls } from './UnitBits';

/**
 * The Dashboard's card "ค่าใช้จ่ายและคงเหลือ" (job expenses, for those who see them; the owner's layout above it
 * is untouched): each calendar quarter's money received, expenses paid, and what is left (and its share of
 * the money received), the top categories of the period picked, and with ดูค่าคอมมิชชั่น and units set up the
 * same by unit (a job's expenses split like its income, lib/contrib). Received money on the day it came in,
 * expenses on the day they were paid; unpaid bills ("ค้างจ่าย") are said apart and never taken off. The
 * money in is the quarter card's (the same lines, the Dashboard's filter).
 */

const m0 = (n: number) => fmtMoney(Math.round(n)) || '0';
const z = (n: number) => (n ? m0(n) : <span className="z">—</span>);
const OPTS: [CommPeriod, string, string][] = [[0, 'ไตรมาส 1', '1'], [1, 'ไตรมาส 2', '2'], [2, 'ไตรมาส 3', '3'], [3, 'ไตรมาส 4', '4'], ['year', 'ทั้งปี', 'ทั้งปี']];

export function ExpNetCard({ S, lines, Y, F, year, today, now, pick, ctx, units, onCashTab }: {
  S: SalesState;
  /** the Dashboard's money in (its filter): the quarter card's lines */
  lines: CashLine[];
  Y: Pick<CashYear, 'quarters' | 'totals'>;
  /** the Dashboard's filter (the deals the money comes from; its dates are the period's) */
  F: SalesFilterIn;
  year: string; today: string;
  /** this quarter (0–3, -1 another year) and the one picked in ช่วงเวลา (-1 none) */
  now: number; pick: number;
  ctx: UnitCtx;
  /** by unit (ดูค่าคอมมิชชั่น / สัดส่วนรายได้, and units set up) */
  units: boolean;
  onCashTab?: () => void;
}) {
  const xs = expView(S, F, today);
  const X = expYear(xs, year);
  const N = netQuarters(Y, X);
  const key = `${year}|${pick}`;
  const [at, setAt] = useState(key);
  const [p, setP] = useState<CommPeriod>(pick >= 0 ? pick : 'year');
  if (at !== key) {
    setAt(key);
    setP(pick >= 0 ? pick : 'year');
  }
  const r = periodRange(year, p);
  const period = p === 'year' ? `ทั้งปี ${year}` : `ไตรมาส ${p + 1} · ${Q_TH[p]} ${year}`;
  const cats = topCats(expByCat(xs, r), 5);
  const inP = expIn(xs, r);
  const max = Math.max(1, ...cats.map((c) => c.amt));
  const un = units && unitsOf(ctx, true).length ? unitNets(ctx, lines, xs, r) : null;
  const row = (label: string, f: (x: NetRow) => ReactNode, cls = '') => (
    <tr className={cls}>
      <td>{label}</td>
      {N.q.map((x, i) => <td key={i}>{f(x)}</td>)}
      <td>{f(N.year)}</td>
    </tr>
  );
  const netCell = (x: NetRow) => (x.got || x.paid ? <>{m0(x.net)}<small className="xo-pct">{pctWord(x.pct)}</small></> : <span className="z">—</span>);
  const Yr = N.year;
  return (
    <section className="sd-card sd-xo" aria-labelledby="sd-xo-t">
      <div className="sd-card-h">
        <h3 className="sd-card-t" id="sd-xo-t">ค่าใช้จ่ายและคงเหลือ · ปี {year}</h3>
        {onCashTab && <button type="button" className="lnk sd-h-lnk" onClick={onCashTab}>ดูรายการเงินออกใน Cashflow</button>}
      </div>
      <p className="sd-sub">เงินเข้านับตามวันที่รับ · ค่าใช้จ่ายนับตามวันที่จ่าย · คงเหลือ = รับแล้ว − จ่ายแล้ว · ยอดรวม VAT</p>
      <div className="xo-dash">
        <div className="xo-dash-l">
          <div className="cm-kpi">
            <div className="cm-k">
              <span className="cm-k-l">คงเหลือ · ทั้งปี {year}</span>
              <span className="cm-k-v"><b>{m0(Yr.net)}</b>บาท</span>
              <small>{Yr.got ? `เหลือ ${pctWord(Yr.pct)} ของเงินที่รับ ${m0(Yr.got)}` : 'ยังไม่มีเงินรับในปีนี้'}</small>
            </div>
            <div className="cm-k">
              <span className="cm-k-l">ค่าใช้จ่ายที่จ่ายแล้ว</span>
              <span className="cm-k-v"><b>{m0(Yr.paid)}</b>บาท</span>
              <small>{Yr.unpaid ? `ค้างจ่ายอีก ${m0(Yr.unpaid)} ยังไม่หัก` : 'ไม่มีบิลค้างจ่าย'}</small>
            </div>
          </div>
          <table className="qt qt-wide xo-qt">
            <thead><tr><th /><th>ไตรมาส 1</th><th>ไตรมาส 2</th><th>ไตรมาส 3</th><th>ไตรมาส 4</th><th>ทั้งปี</th></tr></thead>
            <tbody>
              {row('รับแล้ว', (x) => z(x.got))}
              {row('ค่าใช้จ่าย', (x) => <>{z(x.paid)}{x.unpaid > 0 && <small className="xo-due">ค้างจ่าย {m0(x.unpaid)}</small>}</>, 'xo-ex')}
              {row('คงเหลือ', netCell, 'sum')}
            </tbody>
          </table>
          <table className="qt qt-narrow xo-qt">
            <thead><tr><th>ไตรมาส</th><th>รับแล้ว</th><th>ค่าใช้จ่าย</th><th>คงเหลือ</th></tr></thead>
            <tbody>
              {N.q.map((x, i) => (
                <tr key={i} className={i === now ? 'now' : undefined}>
                  <td>ไตรมาส {i + 1}<small className="qn">{Q_TH[i]}</small></td>
                  <td>{z(x.got)}</td>
                  <td>{z(x.paid)}{x.unpaid > 0 && <small className="xo-due">ค้างจ่าย {m0(x.unpaid)}</small>}</td>
                  <td>{netCell(x)}</td>
                </tr>
              ))}
              <tr className="sum"><td>ทั้งปี</td><td>{m0(Yr.got)}</td><td>{m0(Yr.paid)}</td><td>{netCell(Yr)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="xo-dash-r">
          <div className="seg cm-seg" role="group" aria-label="ช่วงของหมวดค่าใช้จ่าย">
            <span className="cm-seg-l" aria-hidden="true">ไตรมาส</span>
            {OPTS.map(([k, lg, sm]) => (
              <button key={String(k)} type="button" aria-pressed={p === k} onClick={() => setP(k)} aria-label={lg}>
                <span className="lg">{lg}</span>
                <span className="sm">{sm}</span>
              </button>
            ))}
          </div>
          <div className="xo-h">
            <span>ค่าใช้จ่ายตามหมวด · {period}</span>
            <small>{inP.paidN ? `จ่ายแล้ว ${m0(inP.paid)} บาท · ${fmtN(inP.paidN)} รายการ จาก ${fmtN(inP.deals)} งาน` : 'ยังไม่มีค่าใช้จ่ายที่จ่ายในช่วงนี้'}</small>
          </div>
          {cats.length > 0 && (
            <div role="list" className="sd-bars xo-cats">
              {cats.map((c) => (
                <div key={c.key} role="listitem" className="sd-bar-row" title={`${c.c}: ${m0(c.amt)} บาท · ${fmtN(c.n)} รายการ · ${c.pct}%`}>
                  <span className="sd-bar-k">{c.c}</span>
                  <span className="sd-bar-t"><i style={{ width: `${Math.max(2, (c.amt / max) * 100)}%` }} /></span>
                  <span className="sd-bar-v">{m0(c.amt)}<small>{Math.round(c.pct)}%</small></span>
                </div>
              ))}
            </div>
          )}
          {un && un.length > 0 && (
            <>
              <div className="xo-h"><span>ตามหน่วยงาน · {period}</span><small>แบ่งค่าใช้จ่ายของงานตามสัดส่วนรายได้เดียวกับเงินเข้า</small></div>
              <table className="qt xo-ut">
                <thead><tr><th>หน่วยงาน</th><th>รับแล้ว</th><th>ค่าใช้จ่าย</th><th>คงเหลือ</th></tr></thead>
                <tbody>
                  {un.map((u) => (
                    <tr key={u.u || '-'}>
                      <td><span className="un"><i className={'ud ' + unitCls(ctx, u.u)} aria-hidden="true" /><span className="un-n" title={u.n}>{u.n}</span></span></td>
                      <td>{z(u.got)}</td>
                      <td>{z(u.paid)}</td>
                      <td>{netCell(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
