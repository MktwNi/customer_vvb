import { useState } from 'react';
import { dmTh, fmtN, isoTh } from '../lib/format';
import { fmtMoney, type CashLine } from '../lib/sales';
import { shortName } from '../lib/salesUi';
import { Q_TH } from '../lib/cashUi';
import { commRows, contribIn, howRow, periodRange, rateParts, rateText, unitsOf, type CommPeriod, type CommRow, type ContribItem, type RatePart, type UnitCtx } from '../lib/contrib';
import { Chevron } from './StageTrack';
import { UnitName, unitCls } from './UnitBits';

const m0 = (n: number) => fmtMoney(Math.round(n * 100) / 100) || '0';
const z = (n: number) => (n ? m0(n) : <span className="z">—</span>);


/** One rate of a unit in the period: "4% กับเงิน 80,000 บาท (อัตราตั้งแต่ 1 ต.ค. 2569)", "VVB" when a service's. */
const partWords = (p: RatePart) =>
  p.rate == null
    ? `ไม่คิดค่าคอมมิชชั่น กับเงิน ${m0(p.got)} บาท`
    : `${p.rate}%${p.svc.length ? ` (${p.svc.join(', ')})` : ''} กับเงิน ${m0(p.got)} บาท (อัตรา${p.from.map((f) => (f ? 'ตั้งแต่ ' + isoTh(f) : 'ตั้งแต่เริ่ม')).join(' และ ')})`;
/** The rates behind a row that was paid at several ("2–4%"): what the range is made of, else ''. */
const rateTip = (x: CommRow) => {
  const ps = rateParts(x);
  return ps.length > 1 ? ps.map(partWords).join(' · ') : '';
};

/** One received amount behind a unit's figure: "PAY2 รับ 15 ส.ค. · 60% ของ 120,000" (a single installment: "PAY"). */
// a joint quotation's company: its part of the quotation's payment ("QT ร่วม · PAY1 รับ 10 ส.ค. · 33.3% ของ 963,000"),
// the payment itself counted once in the total
const itemWords = (x: ContribItem) =>
  (x.deal.id !== x.line.deal.id ? 'QT ร่วม · ' : '') + [x.line.code || x.line.stage, x.line.date ? `รับ ${dmTh(x.line.date)}` : ''].filter(Boolean).join(' ') + ` · ${x.p}% ของ ${m0(x.line.amt)}`;

/**
 * "% Contribution และค่าคอมมิชชั่น" (dash impl-note §4, mockups 01, 04, 10): money received in a quarter (or the
 * whole year) split by unit through each deal's split, the share of each unit, its rate and commission; a
 * unit opens to the jobs behind its figure; "วิธีคิด" works one unit through with the period's numbers.
 * The lines come from cashLines (the Dashboard's filters), so the period's total is the quarter card's.
 * Without units: an empty state that says what to set up (and where, for those who may).
 */
export function CommCard({ ctx, lines, year, cq, onCq, onSetup }: { ctx: UnitCtx; lines: CashLine[]; year: string; cq: CommPeriod; onCq: (q: CommPeriod) => void; onSetup?: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const head = (
    <>
      <div className="sd-card-h">
        <h3 className="sd-card-t" id="sd-comm-t">% Contribution และค่าคอมมิชชั่น</h3>
      </div>
      <p className="sd-sub">เงินที่รับแล้ว แบ่งตามสัดส่วนของแต่ละงาน แล้วคูณอัตราค่าคอมมิชชั่นของหน่วยงาน</p>
    </>
  );
  if (!unitsOf(ctx, true).length)
    return (
      <section className="sd-card sd-comm" aria-labelledby="sd-comm-t">
        {head}
        <div className="cm-empty">
          <p>ยังไม่ได้ตั้งหน่วยงาน การ์ดนี้จะแบ่งเงินที่รับแล้วให้แต่ละหน่วยงาน และคิดค่าคอมมิชชั่นให้ เมื่อตั้งหน่วยงาน คนในหน่วยงาน และอัตราค่าคอมมิชชั่นแล้ว</p>
          {onSetup ? <button type="button" className="btn pri sm" onClick={onSetup}>ตั้งค่าหน่วยงาน</button> : <small>ผู้ดูแลระบบตั้งได้ที่ Sales Tracker ปุ่มเพิ่มเติม (สามจุด) แล้วเลือก “หน่วยงานและค่าคอมมิชชั่น”</small>}
        </div>
      </section>
    );
  const r = periodRange(year, cq);
  const c = contribIn(ctx, lines, r);
  const rows = commRows(ctx, c, r.to);
  const how = howRow(rows);
  const howParts = how ? rateParts(how) : [];
  const period = cq === 'year' ? `ทั้งปี ${year}` : `${Q_TH[cq]} ${year}`;
  const withMoney = rows.filter((x) => x.got > 0 && x.unit).length;
  const pctW = (p: number) => `${Math.round(p)}%`;
  const opts: [CommPeriod, string, string][] = [[0, 'ไตรมาส 1', '1'], [1, 'ไตรมาส 2', '2'], [2, 'ไตรมาส 3', '3'], [3, 'ไตรมาส 4', '4'], ['year', 'ทั้งปี', 'ทั้งปี']];
  return (
    <section className="sd-card sd-comm" aria-labelledby="sd-comm-t">
      {head}
      <div className="seg cm-seg" role="group" aria-label="ช่วงที่คำนวณ">
        <span className="cm-seg-l" aria-hidden="true">ไตรมาส</span>
        {opts.map(([k, lg, sm]) => (
          <button key={String(k)} type="button" aria-pressed={cq === k} onClick={() => onCq(k)} aria-label={lg}>
            <span className="lg">{lg}</span>
            <span className="sm">{sm}</span>
          </button>
        ))}
      </div>
      <div className="cm-kpi">
        <div className="cm-k">
          <span className="cm-k-l">รับแล้ว · {period}</span>
          <span className="cm-k-v"><b>{m0(c.got)}</b>บาท</span>
          <small>{c.n ? `${fmtN(c.n)} งวด จาก ${fmtN(c.deals)} งาน` : 'ยังไม่มีเงินรับในช่วงนี้'}</small>
        </div>
        <div className="cm-k">
          <span className="cm-k-l">ค่าคอมมิชชั่นรวม</span>
          <span className="cm-k-v"><b>{m0(c.comm)}</b>บาท</span>
          <small>{withMoney ? `${fmtN(withMoney)} หน่วยงาน` : '—'}</small>
        </div>
      </div>
      {c.got > 0 && (
        <div className="cm-bar" role="img" aria-label={'สัดส่วน ' + rows.filter((x) => x.got > 0).map((x) => `${x.unit?.n || 'ยังไม่ระบุหน่วยงาน'} ${pctW(x.pct)}`).join(' · ')}>
          {rows.filter((x) => x.got > 0).map((x) => <i key={x.u || '-'} className={unitCls(ctx, x.u)} style={{ flex: `${x.got} 1 0` }} title={`${x.unit?.n || 'ยังไม่ระบุหน่วยงาน'} ${pctW(x.pct)}`} />)}
        </div>
      )}
      <table className="qt cm-t">
        <thead>
          <tr>
            <th>หน่วยงาน</th>
            <th>รับแล้ว<span className="lg"> (บาท)</span></th>
            <th>สัดส่วน</th>
            <th className="rt">อัตรา</th>
            <th><span className="lg">ค่าคอมมิชชั่น (บาท)</span><span className="sm">ค่าคอมฯ</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const on = !!open[x.u] && x.items.length > 0;
            const rt = x.none ? 'ไม่คิด' : rateText(x.rates);
            const tip = rateTip(x);
            return [
              <tr key={x.u || '-'} className={'cm-r' + (x.items.length ? ' can' : '') + (on ? ' open' : '') + (x.got ? '' : ' zero')}>
                <td>
                  <button type="button" className="cm-x" aria-expanded={x.items.length ? on : undefined} disabled={!x.items.length} onClick={() => setOpen({ ...open, [x.u]: !open[x.u] })} title={x.items.length ? 'ดูงานที่นับ' : undefined}>
                    <UnitName ctx={ctx} id={x.u} />
                    {x.items.length > 0 && <span className="cm-car" aria-hidden="true"><Chevron size={12} /></span>}
                  </button>
                  <small className="un-s" title={tip || undefined}>{x.unit ? (x.none ? 'ไม่คิดค่าคอมมิชชั่น' : `อัตรา ${rt}`) : 'ไม่มีอัตรา'}</small>
                </td>
                <td>{z(x.got)}</td>
                <td>{x.got ? pctW(x.pct) : <span className="z">0%</span>}</td>
                <td className="rt" title={tip || undefined}>
                  {x.unit ? <span className={tip ? 'cm-rng' : undefined}>{rt}</span> : '—'}
                  {tip && <span className="sr-only"> ({tip})</span>}
                </td>
                <td>{z(x.comm)}</td>
              </tr>,
              ...(on
                ? x.items.map((it, i) => (
                    // the unit row's five cells (the rate column hides by its class when the card is narrow):
                    // a job's own rate shows when the unit was paid at several, under its name on a phone
                    <tr key={`${x.u || '-'}/${i}`} className="cm-sub">
                      <td>
                        <span className="cm-sn" title={it.deal.client}>{shortName(it.deal.client)}</span>
                        <small>{itemWords(it)}</small>
                        {it.rate != null && x.rates.length > 1 && <small className="un-s">อัตรา {it.rate}%</small>}
                      </td>
                      <td>{m0(it.amt)}</td>
                      <td />
                      <td className="rt">{it.rate != null && x.rates.length > 1 ? `${it.rate}%` : null}</td>
                      <td>{it.comm ? m0(Math.round(it.comm * 100) / 100) : <span className="z">—</span>}</td>
                    </tr>
                  ))
                : []),
            ];
          })}
          <tr className="sum">
            <td>รวม</td>
            <td>{m0(c.got)}</td>
            <td>{c.got ? '100%' : <span className="z">0%</span>}</td>
            <td className="rt" />
            <td>{m0(c.comm)}</td>
          </tr>
        </tbody>
      </table>
      <div className="cm-how">
        {how ? (
          <p>
            <span className="cm-how-t">วิธีคิด</span> · {how.unit?.n} ได้ส่วน <b>{m0(how.got)}</b> บาท ({pctW(how.pct)} ของ {m0(c.got)})
            {howParts.length === 1 ? (
              <> คูณอัตรา {rateText(how.rates)}</>
            ) : (
              // paid at several rates in the period: each part with its own, so the line adds up to the figure
              <>: {howParts.map((p, i) => <span key={String(p.rate)}>{i ? ' + ' : ''}{m0(p.got)} บาท {p.rate == null ? 'ไม่คิด' : `คูณ ${p.rate}%`}</span>)}</>
            )}{' '}
            เป็นค่าคอมมิชชั่น <b>{m0(how.comm)}</b> บาท
          </p>
        ) : (
          <p>
            <span className="cm-how-t">วิธีคิด</span> · เงินที่รับแล้วของแต่ละงาน คูณสัดส่วนของหน่วยงานในงานนั้น แล้วคูณอัตราค่าคอมมิชชั่นของหน่วยงาน
          </p>
        )}
        <div className="cm-how-f">
          <span className="cm-how-s">ยอดตามเอกสาร รวม VAT · นับตามวันที่รับเงิน</span>
          {onSetup && <button type="button" className="lnk" onClick={onSetup}>ตั้งค่าหน่วยงาน</button>}
        </div>
      </div>
    </section>
  );
}
