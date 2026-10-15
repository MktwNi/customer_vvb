import { useState, type CSSProperties } from 'react';
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
/** The legend: the colour is never the only cue (each part has its word, every bar its total, the list below). */
export function CashKey() {
  return (
    <div className="cf-key" aria-hidden="true">
      {PARTS.map((p) => <span key={p.k}><i className={'cf-sw ' + p.k} />{p.label}</span>)}
    </div>
  );
}

/** What a slot is called: "ตุลาคม 2569" / "ไตรมาส 4 · ต.ค.–ธ.ค. 2569". */
export const slotName = (mode: 'm' | 'q', i: number, year: string) => (mode === 'm' ? `${MONTHS_TH[i]} ${year}` : `ไตรมาส ${i + 1} · ${Q_TH[i]} ${year}`);
const H = 178, BASE = 206; // px of the axis top, and of the base line from the top of the plot

/**
 * Money by month (12 slots) or quarter (4) of one year, one y axis. Desktop: stacked columns 24px wide
 * with the total over each (none on an empty slot), hairlines with compact ticks, this month or quarter on
 * a tint; a column is a button (it picks that slot for the list below) whose hover or focus shows its
 * parts. Phones: one row per slot, a horizontal bar and the total.
 */
export function CashChart({ data, mode, year, now, pick, onPick, phone }: { data: CashSum[]; mode: 'm' | 'q'; year: string; now: number; pick: number | null; onPick: (i: number | null) => void; phone: boolean }) {
  const [tip, setTip] = useState<number | null>(null);
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
