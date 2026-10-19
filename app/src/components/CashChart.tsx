import { useState, type CSSProperties } from 'react';
import { netOf } from '../lib/expenseMoney';
import { TH_M } from '../lib/format';
import { cashTotal, fmtMoney, type CashSum } from '../lib/sales';
import { MONTHS_TH, Q_TH, compactBaht, moneyTicks } from '../lib/cashUi';

/** The three parts of a bar, bottom up: received (brand), late (the reserved late colour), still to come
 *  (the light fill with a brand outline, as the Dashboard's money not received yet). */
const PARTS: { k: 'got' | 'late' | 'wait'; label: string }[] = [
  { k: 'got', label: 'รับแล้ว' },
  { k: 'late', label: 'เลยกำหนด' },
  { k: 'wait', label: 'รอรับ' },
];
/** The legend: the colour is never the only cue (each part has its word, every bar its total, the list below).
 *  `out`: the money out under the base line too (job expenses, for those who see them). */
export function CashKey({ out }: { out?: boolean }) {
  return (
    <div className="cf-key" aria-hidden="true">
      {PARTS.map((p) => <span key={p.k}><i className={'cf-sw ' + p.k} />{p.label}</span>)}
      {out && OUT_PARTS.map((p) => <span key={p.k}><i className={'cf-sw ' + p.cls} />{p.label}</span>)}
    </div>
  );
}
/** Money out of a slot (job expenses, lib/expenseMoney.ts): paid in it, and bills dated in it not paid yet. */
export interface OutSum { paid: number; unpaid: number }
/** The two parts of the money out, from the base line down: paid (the calm out colour), not paid yet (its
 *  light fill with an outline, as รอรับ). Never red: red is late money. */
const OUT_PARTS: { k: keyof OutSum; cls: string; label: string }[] = [
  { k: 'paid', cls: 'xpaid', label: 'เงินออก จ่ายแล้ว' },
  { k: 'unpaid', cls: 'xdue', label: 'ค้างจ่าย' },
];
const outTotal = (o: OutSum | undefined) => (o ? o.paid + o.unpaid : 0);

/** What a slot is called: "ตุลาคม 2569" / "ไตรมาส 4 · ต.ค.–ธ.ค. 2569". */
export const slotName = (mode: 'm' | 'q', i: number, year: string) => (mode === 'm' ? `${MONTHS_TH[i]} ${year}` : `ไตรมาส ${i + 1} · ${Q_TH[i]} ${year}`);
const H = 178, BASE = 206; // px of the axis top, and of the base line from the top of the plot

/**
 * Money by month (12 slots) or quarter (4) of one year, one y axis. Desktop: stacked columns 24px wide
 * with the total over each (none on an empty slot), hairlines with compact ticks, this month or quarter on
 * a tint; a column is a button (it picks that slot for the list below) whose hover or focus shows its
 * parts. Phones: one row per slot, a horizontal bar and the total.
 */
export function CashChart({ data, mode, year, now, pick, onPick, phone, out }: { data: CashSum[]; mode: 'm' | 'q'; year: string; now: number; pick: number | null; onPick: (i: number | null) => void; phone: boolean; /** money out per slot (those who see job expenses) */ out?: OutSum[] | null }) {
  const [tip, setTip] = useState<number | null>(null);
  if (out && out.some((o) => outTotal(o) > 0)) return <InOutChart data={data} out={out} mode={mode} year={year} now={now} pick={pick} onPick={onPick} phone={phone} />;
  const max = Math.max(0, ...data.map(cashTotal));
  const words = (c: CashSum) => PARTS.filter((p) => c[p.k]).map((p) => `${p.label} ${fmtMoney(c[p.k])}`).join(' · ');
  const label = (c: CashSum, i: number) => `${slotName(mode, i, year)}: ${cashTotal(c) ? `รวม ${fmtMoney(cashTotal(c))} บาท · ${words(c)}` : 'ไม่มีเงินเข้า'}`;
  const toggle = (i: number) => onPick(pick === i ? null : i);
  if (phone)
    return (
      <div className="cf-hb" role="group" aria-label={(mode === 'm' ? 'เงินเข้ารายเดือน ปี ' : 'เงินเข้ารายไตรมาส ปี ') + year}>
        {data.map((c, i) => {
          const t = cashTotal(c);
          return (
            <button key={i} type="button" className={'cf-hr' + (i === now ? ' now' : '') + (t ? '' : ' zero') + (pick === i ? ' pick' : '')} aria-pressed={pick === i} aria-label={label(c, i)} onClick={() => toggle(i)}>
              <span>{mode === 'm' ? TH_M[i] : `ไตรมาส ${i + 1}`}</span>
              <span className="trk" aria-hidden="true">
                {PARTS.map((p) => (c[p.k] ? <i key={p.k} className={p.k} style={{ width: `${(c[p.k] / max) * 100}%` }} /> : null))}
              </span>
              <span>{t ? fmtMoney(t) : '—'}</span>
            </button>
          );
        })}
      </div>
    );
  const { ticks, top } = moneyTicks(max);
  const y = (v: number) => BASE - Math.round((v / top) * H);
  const n = data.length;
  return (
    <div className="cf-plot" style={{ '--n': n } as CSSProperties} onMouseLeave={() => setTip(null)}>
      {ticks.map((t) => (
        <span key={t}>
          <span className={'cf-grid' + (t ? '' : ' base')} style={{ top: y(t) }} />
          <span className="cf-yl" style={{ top: y(t) }} aria-hidden="true">{compactBaht(t)}</span>
        </span>
      ))}
      <div className="cf-cols" role="group" aria-label={(mode === 'm' ? 'เงินเข้ารายเดือน ปี ' : 'เงินเข้ารายไตรมาส ปี ') + year}>
        {data.map((c, i) => {
          const t = cashTotal(c);
          return (
            <div key={i} className="cf-colw">
              <button
                type="button"
                className={'cf-col' + (i === now ? ' now' : '') + (pick === i ? ' pick' : '')}
                aria-pressed={pick === i}
                aria-label={label(c, i)}
                onClick={() => toggle(i)}
                onMouseEnter={() => setTip(i)}
                onFocus={() => setTip(i)}
                onBlur={() => setTip(null)}
              >
                {t > 0 && (
                  <>
                    <span className="cf-val" aria-hidden="true">{fmtMoney(t)}</span>
                    <span className="cf-stack" aria-hidden="true">
                      {PARTS.map((p) => (c[p.k] ? <i key={p.k} className={p.k} style={{ height: Math.max(3, Math.round((c[p.k] / top) * H) - 2) }} /> : null))}
                    </span>
                  </>
                )}
              </button>
              {tip === i && t > 0 && (
                <div className={'cf-tip ' + (i < n / 2 ? 'r' : 'l')} role="tooltip">
                  <span className="cf-tip-t">{slotName(mode, i, year)}</span>
                  {PARTS.map((p) => c[p.k] ? <span key={p.k} className="cf-tip-r"><i className={'cf-sw ' + p.k} />{p.label}<b>{fmtMoney(c[p.k])}</b></span> : null)}
                  <span className="cf-tip-r sum">รวม<b>{fmtMoney(t)}</b></span>
                  <small>{c.n} รายการ · กดเพื่อดูเฉพาะช่วงนี้</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="cf-xl" aria-hidden="true">
        {data.map((_, i) =>
          mode === 'm' ? (
            <span key={i}>{i === now ? <b>{TH_M[i]}</b> : TH_M[i]}</span>
          ) : (
            <span key={i}>
              {i === now ? <b>ไตรมาส {i + 1}</b> : `ไตรมาส ${i + 1}`}
              <small>{Q_TH[i]}</small>
            </span>
          ),
        )}
      </div>
    </div>
  );
}

const OUT_MAX = 110, OUT_LAB = 24; // px the money out may take under the base line at most, and its label's room

/**
 * The chart with money out (job expenses, for those who see them): one money axis through zero, the money
 * in as before above the base line (received, late, still to come), the money out under it (paid, not paid
 * yet), each column with its total as a direct label (the money in over it, the money out under it). The
 * scale is shared: the money in keeps its height unless the money out needs more room than OUT_MAX. Phones:
 * one row per slot, the money in bar and under it a thinner money out bar, each with its figure.
 */
function InOutChart({ data, out, mode, year, now, pick, onPick, phone }: { data: CashSum[]; out: OutSum[]; mode: 'm' | 'q'; year: string; now: number; pick: number | null; onPick: (i: number | null) => void; phone: boolean }) {
  const [tip, setTip] = useState<number | null>(null);
  const maxIn = Math.max(0, ...data.map(cashTotal)), maxOut = Math.max(0, ...out.map(outTotal));
  const inWords = (c: CashSum) => PARTS.filter((p) => c[p.k]).map((p) => `${p.label} ${fmtMoney(c[p.k])}`).join(' · ');
  const outWords = (o: OutSum) => OUT_PARTS.filter((p) => o[p.k]).map((p) => `${p.label} ${fmtMoney(o[p.k])}`).join(' · ');
  const label = (c: CashSum, o: OutSum, i: number) =>
    `${slotName(mode, i, year)}: ${cashTotal(c) ? `เงินเข้า ${fmtMoney(cashTotal(c))} บาท · ${inWords(c)}` : 'ไม่มีเงินเข้า'} · ${outTotal(o) ? `เงินออก ${fmtMoney(outTotal(o))} บาท · ${outWords(o)}` : 'ไม่มีเงินออก'}`;
  const toggle = (i: number) => onPick(pick === i ? null : i);
  const name = mode === 'm' ? 'เงินเข้าและเงินออกรายเดือน ปี ' : 'เงินเข้าและเงินออกรายไตรมาส ปี ';
  if (phone) {
    const max = Math.max(maxIn, maxOut, 1);
    return (
      <div className="cf-hb" role="group" aria-label={name + year}>
        {data.map((c, i) => {
          const t = cashTotal(c), o = out[i] || { paid: 0, unpaid: 0 }, ot = outTotal(o);
          return (
            <button key={i} type="button" className={'cf-hr xo' + (i === now ? ' now' : '') + (t || ot ? '' : ' zero') + (pick === i ? ' pick' : '')} aria-pressed={pick === i} aria-label={label(c, o, i)} onClick={() => toggle(i)}>
              <span>{mode === 'm' ? TH_M[i] : `ไตรมาส ${i + 1}`}</span>
              <span className="trk" aria-hidden="true">
                {PARTS.map((p) => (c[p.k] ? <i key={p.k} className={p.k} style={{ width: `${(c[p.k] / max) * 100}%` }} /> : null))}
              </span>
              <span>{t ? fmtMoney(t) : '—'}</span>
              <span className="trk xo-trk" aria-hidden="true">
                {OUT_PARTS.map((p) => (o[p.k] ? <i key={p.k} className={p.cls} style={{ width: `${(o[p.k] / max) * 100}%` }} /> : null))}
              </span>
              <span className="xo-v">{ot ? 'ออก ' + fmtMoney(ot) : ''}</span>
            </button>
          );
        })}
      </div>
    );
  }
  // one axis: the step of the larger side, ticks on both sides of zero
  const { ticks } = moneyTicks(Math.max(maxIn, maxOut));
  const step = ticks[1] || 1;
  const topIn = maxIn > 0 ? Math.max(maxIn, Math.floor(maxIn / step) * step) : 0;
  const k = Math.min(topIn > 0 ? H / topIn : Infinity, (H + OUT_MAX) / (topIn + maxOut));
  const inH = Math.round(topIn * k), outH = Math.round(maxOut * k);
  const top = 28 + (H - Math.min(H, inH)); // the plot keeps its height above zero when the money in is the larger
  const base = top + inH, colH = base + outH + OUT_LAB, plotH = colH + 44;
  const yIn = (v: number) => base - Math.round(v * k), yOut = (v: number) => base + Math.round(v * k);
  const upTicks = ticks.filter((t) => t <= topIn), dnTicks = ticks.filter((t) => t > 0 && t <= maxOut);
  const n = data.length;
  return (
    <div className="cf-plot xo" style={{ '--n': n, height: plotH } as CSSProperties} onMouseLeave={() => setTip(null)}>
      {upTicks.map((t) => (
        <span key={'u' + t}>
          <span className={'cf-grid' + (t ? '' : ' base')} style={{ top: yIn(t) }} />
          <span className="cf-yl" style={{ top: yIn(t) }} aria-hidden="true">{compactBaht(t)}</span>
        </span>
      ))}
      {!upTicks.includes(0) && <span className="cf-grid base" style={{ top: base }} />}
      {dnTicks.map((t) => (
        <span key={'d' + t}>
          <span className="cf-grid" style={{ top: yOut(t) }} />
          <span className="cf-yl" style={{ top: yOut(t) }} aria-hidden="true">{'\u2212' + compactBaht(t)}</span>
        </span>
      ))}
      <div className="cf-cols" role="group" aria-label={name + year} style={{ height: colH }}>
        {data.map((c, i) => {
          const t = cashTotal(c), o = out[i] || { paid: 0, unpaid: 0 }, ot = outTotal(o);
          const net = netOf(c.got, o.paid);
          return (
            <div key={i} className="cf-colw">
              <button
                type="button"
                className={'cf-col xo' + (i === now ? ' now' : '') + (pick === i ? ' pick' : '')}
                aria-pressed={pick === i}
                aria-label={label(c, o, i)}
                onClick={() => toggle(i)}
                onMouseEnter={() => setTip(i)}
                onFocus={() => setTip(i)}
                onBlur={() => setTip(null)}
              >
                <span className="cf-up" style={{ height: base }}>
                  {t > 0 && (
                    <>
                      <span className="cf-val" aria-hidden="true">{fmtMoney(t)}</span>
                      <span className="cf-stack" aria-hidden="true">
                        {PARTS.map((p) => (c[p.k] ? <i key={p.k} className={p.k} style={{ height: Math.max(3, Math.round(c[p.k] * k) - 2) }} /> : null))}
                      </span>
                    </>
                  )}
                </span>
                <span className="cf-dn" aria-hidden="true">
                  {ot > 0 && (
                    <>
                      <span className="cf-ostack">
                        {OUT_PARTS.map((p) => (o[p.k] ? <i key={p.k} className={p.cls} style={{ height: Math.max(3, Math.round(o[p.k] * k) - 2) }} /> : null))}
                      </span>
                      <span className="cf-oval">{fmtMoney(ot)}</span>
                    </>
                  )}
                </span>
              </button>
              {tip === i && (t > 0 || ot > 0) && (
                <div className={'cf-tip ' + (i < n / 2 ? 'r' : 'l')} role="tooltip">
                  <span className="cf-tip-t">{slotName(mode, i, year)}</span>
                  {PARTS.map((p) => c[p.k] ? <span key={p.k} className="cf-tip-r"><i className={'cf-sw ' + p.k} />{p.label}<b>{fmtMoney(c[p.k])}</b></span> : null)}
                  <span className="cf-tip-r sum">เงินเข้ารวม<b>{fmtMoney(t)}</b></span>
                  {OUT_PARTS.map((p) => o[p.k] ? <span key={p.k} className="cf-tip-r"><i className={'cf-sw ' + p.cls} />{p.label}<b>{fmtMoney(o[p.k])}</b></span> : null)}
                  {c.got > 0 || o.paid > 0 ? <span className="cf-tip-r sum">คงเหลือสุทธิ<b>{fmtMoney(net.net) || '0'}</b></span> : null}
                  <small>คงเหลือ = รับแล้ว − จ่ายแล้ว · ค้างจ่ายยังไม่หัก · กดเพื่อดูเฉพาะช่วงนี้</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="cf-xl" aria-hidden="true" style={{ top: colH + 8 }}>
        {data.map((_, i) =>
          mode === 'm' ? (
            <span key={i}>{i === now ? <b>{TH_M[i]}</b> : TH_M[i]}</span>
          ) : (
            <span key={i}>
              {i === now ? <b>ไตรมาส {i + 1}</b> : `ไตรมาส ${i + 1}`}
              <small>{Q_TH[i]}</small>
            </span>
          ),
        )}
      </div>
    </div>
  );
}
