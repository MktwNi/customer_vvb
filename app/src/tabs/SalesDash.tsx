import { useRef, useState, type ReactNode } from 'react';
import { useApp } from '../state';
import { addDays, dow, fmtN, isoTh } from '../lib/format';
import { DEAL_STAGE, STAGE_TH, dealMoney, dealResult, fmtMoney, lastContact, overdueDays, salesStats, stepOf, type Deal, type SalesState, type SalesStats } from '../lib/sales';
import { winRateBySource } from '../lib/salesUi';
import { TT } from '../lib/constants';
import type { Task } from '../lib/types';
import { CoAvatar, coreName } from '../components/CoAvatar';
import { Icon } from '../components/icons';
import { Opts, heroGrad } from '../components/ui';

const TH_M = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_MONTH = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const WD = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const WD_LONG = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
/** Win / loss segment colours (validated: blue vs orange stays apart for colour-blind readers). */
const WIN = '#1F5BD8', LOSS = '#C4501A';
const short = (iso: string) => `${+iso.slice(8, 10)} ${TH_M[+iso.slice(5, 7)]}`;
/** Compact baht: 1.2M / 350K / 9,500. */
const baht = (n: number) => {
  const r = Math.round(n);
  return r >= 999500 ? `${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M` : r >= 9950 ? `${Math.round(n / 1e3).toLocaleString('en-US')}K` : fmtN(r);
};
const mondayOf = (iso: string) => addDays(iso, -((dow(iso) + 6) % 7));

/** Bar list; rows at 0 are left out unless `keepZero` (the items are then already the ones to show). */
function Bars({ items, fmt = fmtN, unit = '', keepZero }: { items: [string, number][]; fmt?: (n: number) => string; unit?: string; keepZero?: boolean }) {
  const list = keepZero ? items : items.filter((x) => x[1] > 0);
  const max = Math.max(1, ...list.map((x) => x[1]));
  if (!list.length) return <span className="sd-muted">ยังไม่มีข้อมูล</span>;
  return (
    <div role="list" className="sd-bars">
      {list.map(([k, v]) => (
        <div key={k} role="listitem" title={`${k}: ${fmt(v)}${unit}`} className="sd-bar-row">
          <span className="sd-bar-k">{k}</span>
          <span className="sd-bar-t"><i style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /></span>
          <span className="sd-bar-v">{fmt(v)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

function GroupTable({ rows }: { rows: [string, SalesStats['byResp'][string]][] }) {
  if (!rows.length) return <span className="sd-muted">ยังไม่มีข้อมูล</span>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="sd-table">
        <thead>
          <tr>
            <th>ชื่อ</th>
            <th>Forecast</th>
            <th>Actual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>
                {k}
                <small>{fmtN(v.n)} ราย</small>
              </td>
              <td>{fmtMoney(v.forecast) || '0'}</td>
              <td>
                {fmtMoney(v.actual) || '0'}
                <small>{v.forecast ? Math.round((v.actual / v.forecast) * 100) + '%' : '—'}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Acc({ title, sub, open, onToggle, children }: { title: string; sub?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={'sd-acc' + (open ? ' open' : '')}>
      <button className="sd-acc-h" aria-expanded={open} onClick={onToggle}>
        <span>
          {title}
          {sub && <small>{sub}</small>}
        </span>
        <span className="sd-chev" aria-hidden="true" />
      </button>
      {open && <div className="sd-acc-b">{children}</div>}
    </div>
  );
}

/**
 * Sales dashboard (the owner's own layout, kept as designed; only weights, text colours and glyphs follow
 * the design system): greeting + headline numbers, the pipeline by stage, the top seller, this week's
 * contacts, sales against forecast, win rate, follow-ups, this week's appointments and the breakdowns.
 * One filter row on top scopes everything.
 */
export function SalesDash({ S, deals, today, year }: { S: SalesState; deals: Deal[]; today: string; year: string }) {
  const { engine: e, set, open } = useApp();
  const [f, setF] = useState({ resp: '', referral: '', month: '' });
  const [acc, setAcc] = useState<Record<string, boolean>>({ resp: true });
  const [showAll, setShowAll] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [wk, setWk] = useState(0); // weeks from this one, for the appointments
  const [evTip, setEvTip] = useState<string | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const list = deals.filter((d) => (!f.resp || (d.resp || '(ไม่ระบุ)') === f.resp) && (!f.referral || (d.referral || '(ไม่ระบุ)') === f.referral) && (!f.month || lastContact(S, d, today).slice(5, 7) === f.month));
  const st = salesStats(S, list, today);
  const uniq = (k: 'resp' | 'referral') => [...new Set(deals.map((d) => d[k] || '(ไม่ระบุ)'))].sort();
  const me = e.me();

  // top sellers: actual first, then forecast; closed deals per person
  const yesBy: Record<string, number> = {};
  list.forEach((d) => dealResult(S, d) === 'YES' && (yesBy[d.resp || '(ไม่ระบุ)'] = (yesBy[d.resp || '(ไม่ระบุ)'] || 0) + 1));
  const sellers = Object.entries(st.byResp)
    .filter(([k]) => k !== '(ไม่ระบุ)')
    .sort((a, b) => b[1].actual - a[1].actual || b[1].forecast - a[1].forecast || b[1].n - a[1].n);
  const top = sellers[0];

  // steps dated this week (Monday to today: a later date is a plan, not a contact yet), compared
  // with the same days of last week
  const mon = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const ids = new Set(list.map((d) => d.id));
  const perDay: Record<string, number> = {};
  let lastWeek = 0;
  const prevMon = addDays(mon, -7), prevToday = addDays(today, -7);
  Object.entries(S.steps).forEach(([k, x]) => {
    if (!x.d || !ids.has(k.slice(0, k.indexOf('/')))) return;
    if (x.d >= mon && x.d <= today) perDay[x.d] = (perDay[x.d] || 0) + 1;
    else if (x.d >= prevMon && x.d <= prevToday) lastWeek++;
  });
  const weekN = days.reduce((a, d) => a + (perDay[d] || 0), 0);
  const peak = days.reduce((best, d, i) => ((perDay[d] || 0) > (perDay[days[best]] || 0) ? i : best), 0);
  const shownDay = hover ?? (weekN ? peak : null);
  const maxDay = Math.max(1, ...days.map((d) => perDay[d] || 0));

  // follow-ups: open jobs not decided yet, and any open job overdue (the headline count);
  // overdue first, then the longest without contact
  const follow = list
    .filter((d) => d.jobStatus === 'open' && (!['YES', 'NO'].includes(dealResult(S, d)) || overdueDays(S, d, today) != null))
    .sort((a, b) => (overdueDays(S, b, today) ?? -1) - (overdueDays(S, a, today) ?? -1) || (lastContact(S, a, today) || '0').localeCompare(lastContact(S, b, today) || '0'));
  const overdueN = follow.filter((d) => overdueDays(S, d, today) != null).length;

  // appointments of the chosen week (team plan)
  const wMon = addDays(mon, wk * 7);
  const wDays = Array.from({ length: 7 }, (_, i) => addDays(wMon, i));
  // with a filter set, only the filtered customers' appointments (and, for an owner, the companies they own)
  const filtered = !!(f.resp || f.referral || f.month);
  const gids = new Set(list.filter((d) => d.gid != null).map((d) => e.canonical(d.gid as number)));
  const inScope = (t: Task) => !filtered || gids.has(e.canonical(t.gid)) || (!!f.resp && !f.referral && !f.month && e.crm.owners[e.canonical(t.gid)] === f.resp);
  const tasks = e.crm.tasks.filter((t) => t.date >= wDays[0] && t.date <= wDays[6] && inScope(t));
  const m0 = +wDays[0].slice(5, 7), m6 = +wDays[6].slice(5, 7), y0 = +wDays[0].slice(0, 4) + 543, y6 = +wDays[6].slice(0, 4) + 543;
  const wLabel = m0 === m6 ? `${TH_MONTH[m0]} ${y0}` : y0 === y6 ? `${TH_M[m0]} – ${TH_M[m6]} ${y6}` : `${TH_M[m0]} ${y0} – ${TH_M[m6]} ${y6}`;
  const band = (t: Task) => (!t.time ? 0 : t.time < '12:00' ? 1 : 2);
  const next = e.crm.tasks
    .filter((t) => !t.done && t.date >= today && inScope(t))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'))
    .slice(0, 3);
  const BANDS = ['ไม่ระบุเวลา', 'เช้า', 'บ่าย'];

  const pct = st.forecast > 0 ? Math.round((st.actual / st.forecast) * 100) : 0;
  const R = 54, C = 2 * Math.PI * R;
  const undecided = st.wait + st.none;
  const segs: [string, number, string, string][] = [
    ['ปิดได้', st.yes, WIN, '#fff'],
    ['ไม่สำเร็จ', st.no, LOSS, '#fff'],
    ['รอผล', undecided, '', ''],
  ];
  const srcRows = Object.entries(st.bySource);
  // the latest wins: deals marked YES, newest result date first
  const wins = list
    .filter((d) => dealResult(S, d) === 'YES')
    .map((d) => {
      const m = dealMoney(S, d);
      return { d, at: stepOf(S, d.id, DEAL_STAGE).d || d.closedDate || '', amt: m.actual || m.forecast || 0, fc: !m.actual };
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3);

  return (
    <div className="sd">
      <div className="sd-head">
        <div className="sd-hello">
          <h3>{me ? `สวัสดี, ${me}` : 'สวัสดีทีมขาย'}</h3>
          <span>{`ภาพรวมการขาย ปี ${year}${f.resp || f.referral || f.month ? ' · ตามตัวกรอง' : ''}`}</span>
        </div>
        <div className="sd-heroes">
          {([
            ['user', st.total, 'ลูกค้า', 'ราย', `เปิดงาน ${fmtN(st.open)} · ปิดงาน ${fmtN(st.closed)}`, ''],
            ['sales', st.yes, 'ปิดการขายได้', 'ราย', st.decided ? `Win rate ${st.winRate}%` : 'ยังไม่มีลูกค้าที่รู้ผล', 'pri'],
            ['plan', st.overdue, 'ค้างติดตาม', 'ราย', 'ไม่ได้ติดต่อเกิน 14 วัน', st.overdue ? 'warn' : ''],
          ] as const).map(([ic, n, l, unit, sub2, tone]) => (
            <div key={l} className={'sd-stat' + (tone ? ' ' + tone : '')}>
              <span className="sd-stat-l"><Icon name={ic} />{l}</span>
              <span className="sd-stat-v"><b>{fmtN(n)}</b> {unit}</span>
              <small>{sub2}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="sd-filters" role="group" aria-label="ตัวกรอง Dashboard">
        <select className={'fld sel' + (f.resp ? ' on' : '')} value={f.resp} onChange={(ev) => setF({ ...f, resp: ev.target.value })} aria-label="ผู้รับผิดชอบ"><Opts all="ผู้รับผิดชอบ: ทั้งหมด" options={uniq('resp').map((x) => ({ v: x, label: 'ผู้รับผิดชอบ: ' + x }))} /></select>
        <select className={'fld sel' + (f.referral ? ' on' : '')} value={f.referral} onChange={(ev) => setF({ ...f, referral: ev.target.value })} aria-label="แหล่งที่มา"><Opts all="แหล่งที่มา: ทั้งหมด" options={uniq('referral').map((x) => ({ v: x, label: 'แหล่งที่มา: ' + x }))} /></select>
        <select className={'fld sel' + (f.month ? ' on' : '')} value={f.month} onChange={(ev) => setF({ ...f, month: ev.target.value })} aria-label="เดือนที่ติดต่อล่าสุด"><Opts all="ติดต่อล่าสุด: ทุกเดือน" options={TH_M.slice(1).map((m, i) => ({ v: String(i + 1).padStart(2, '0'), label: 'ติดต่อล่าสุด ' + m }))} /></select>
        {filtered && <button className="btn sm" onClick={() => setF({ resp: '', referral: '', month: '' })}>ล้างตัวกรอง</button>}
      </div>

      <div className="sd-pipe" role="list" aria-label="จำนวนลูกค้าที่ผ่านแต่ละขั้น">
        {st.stages.map((x) => {
          const share = st.total ? Math.round((x.n / st.total) * 100) : 0;
          return (
            <div key={x.name} role="listitem" className="sd-stage" title={`${x.name}${STAGE_TH[x.name] ? ' · ' + STAGE_TH[x.name] : ''}: ${fmtN(x.n)} ราย (${share}%)`}>
              <span className="sd-stage-l">{STAGE_TH[x.name] || x.name}</span>
              <span className={'sd-stage-p' + (x.n ? '' : ' zero')}>{fmtN(x.n)} ราย · {share}%</span>
            </div>
          );
        })}
      </div>

      <div className="sd-grid">
        <section className="sd-card sd-top hero" style={{ background: heroGrad }} aria-label="ผู้ทำยอดสูงสุด">
          <span className="sd-card-t">ผู้ทำยอดสูงสุด</span>
          {top ? (
            <>
              <CoAvatar colored name={top[0]} size={92} ring="rgba(255,255,255,.9)" style={{ alignSelf: 'center', marginTop: 6 }} />
              <div className="sd-top-name">
                <b>{top[0]}</b>
                <span>{`ลูกค้า ${fmtN(top[1].n)} ราย · ปิดได้ ${fmtN(yesBy[top[0]] || 0)}`}</span>
              </div>
              <span className="sd-top-money" title={`Actual ${fmtMoney(top[1].actual) || 0} บาท · Forecast ${fmtMoney(top[1].forecast) || 0} บาท`}>{top[1].actual ? `Actual ${baht(top[1].actual)} บาท` : `Forecast ${baht(top[1].forecast)} บาท`}</span>
              {sellers.length > 1 && (
                <div className="sd-runners">
                  {sellers.slice(1, 4).map(([k, v], i) => (
                    <span key={k} title={`${k}: Actual ${fmtMoney(v.actual) || 0} · Forecast ${fmtMoney(v.forecast) || 0}`}>
                      <i>{i + 2}</i>
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <span className="sd-empty-w">ใส่ชื่อผู้รับผิดชอบในตาราง แล้วอันดับจะขึ้นที่นี่</span>
          )}
        </section>

        <section className="sd-card sd-act" aria-label="การติดต่อสัปดาห์นี้">
          <div className="sd-card-h">
            <span className="sd-card-t">การติดต่อสัปดาห์นี้</span>
            <span className="sd-delta" title="เทียบกับวันเดียวกันของสัปดาห์ก่อน (จันทร์ถึงวันนี้)">{weekN === lastWeek ? 'เท่าสัปดาห์ก่อน' : weekN > lastWeek ? `มากกว่าสัปดาห์ก่อน ${fmtN(weekN - lastWeek)}` : `น้อยกว่าสัปดาห์ก่อน ${fmtN(lastWeek - weekN)}`}</span>
          </div>
          <div className="sd-act-n">
            <b>{fmtN(weekN)}</b>
            <span>ครั้ง<br />ขั้นตอนที่ลงวันที่ในตาราง (ถึงวันนี้)</span>
          </div>
          <div className="sd-cols" role="list" aria-label="จำนวนครั้งรายวัน" onMouseLeave={() => setHover(null)}>
            {days.map((d, i) => {
              const n = perDay[d] || 0;
              const later = d > today;
              return (
                <div key={d} role="listitem" className={'sd-col' + (shownDay === i ? ' on' : '') + (d === today ? ' today' : '') + (later ? ' later' : '')} onMouseEnter={() => setHover(i)} aria-label={`${WD_LONG[dow(d)]} ${isoTh(d)}: ${later ? 'ยังไม่ถึง' : fmtN(n) + ' ครั้ง'}`}>
                  <span className="sd-col-t" aria-hidden="true"><i style={{ height: `${n ? Math.max(8, (n / maxDay) * 100) : 0}%` }} /></span>
                  <span className="sd-col-n" aria-hidden="true">{later ? '·' : fmtN(n)}</span>
                  <span className="sd-col-d" aria-hidden="true">{WD[dow(d)]}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="sd-card sd-ring" aria-label="ยอดขายเทียบ Forecast">
          <div className="sd-card-h">
            <span className="sd-card-t">ยอดขายเทียบ Forecast</span>
          </div>
          <div className="sd-gauge">
            <svg viewBox="0 0 140 140" aria-hidden="true">
              <circle cx="70" cy="70" r={R} fill="none" stroke="#C9D7F6" strokeWidth="12" />
              <circle cx="70" cy="70" r={R} fill="none" stroke="var(--brand)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(Math.min(pct, 100) / 100) * C} ${C}`} transform="rotate(-90 70 70)" style={{ opacity: pct ? 1 : 0 }} />
            </svg>
            <span className="sd-gauge-c">
              <b>{pct}%</b>
              <small>Actual ÷ Forecast</small>
            </span>
          </div>
          <div className="sd-money">
            <span><i style={{ background: 'var(--brand)' }} />Actual <b>{fmtMoney(st.actual) || 0} บาท</b></span>
            <span><i className="fc" />Forecast <b>{fmtMoney(st.forecast) || 0} บาท</b></span>
            <small>{`ยืนยันด้วยเอกสาร: Actual ${fmtMoney(st.acConfirmed) || 0} · Forecast ${fmtMoney(st.fcConfirmed) || 0} บาท`}</small>
          </div>
        </section>

        <section className="sd-card sd-win" aria-label="ผลการขาย">
          <div className="sd-card-h">
            <span className="sd-card-t">ผลการขาย</span>
            <b className="sd-big">{st.decided ? `${st.winRate}%` : '—'}</b>
          </div>
          <span className="sd-muted">{`Win rate · ปิดได้ ÷ รู้ผลแล้ว (${fmtN(st.decided)} ราย)`}</span>
          <div className="sd-wins">
            <span className="sd-wins-h">ปิดการขายล่าสุด</span>
            {!wins.length && <span className="sd-muted">ยังไม่มี · ใส่ YES ในขั้น CLOSED DEAL ของตาราง</span>}
            {wins.map(({ d, at, amt, fc }) => {
              const c = d.gid != null ? e.company(d.gid) : undefined;
              return (
                <button key={d.id} className="sd-win-i" title={d.client} onClick={() => set({ deal: d.id })}>
                  <CoAvatar colored name={d.client} web={c?.web} set={c?.set} size={32} />
                  <span className="sd-fi-t">
                    <b>{coreName(d.client) || d.client}</b>
                    <small>{[d.resp, at ? short(at) : ''].filter(Boolean).join(' · ')}</small>
                  </span>
                  {amt > 0 && <span className={'sd-win-amt' + (fc ? ' fc' : '')} title={fc ? 'ยังไม่มี Actual · แสดง Forecast' : 'Actual'}>{fc ? 'Forecast ' : ''}{baht(amt)} บาท</span>}
                </button>
              );
            })}
          </div>
          {st.total > 0 && (
            <>
              <div className="sd-key">
                {segs.map(([l, n, bg]) => (
                  <span key={l}><i className={bg ? '' : 'wait'} style={bg ? { background: bg } : undefined} />{l} <b>{fmtN(n)}</b></span>
                ))}
              </div>
              <div className="sd-seg" role="img" aria-label={`ปิดได้ ${st.yes} · ไม่สำเร็จ ${st.no} · รอผล ${undecided} จากลูกค้าทั้งหมด ${st.total} ราย`}>
                {segs.map(([l, n, bg, fg]) => {
                  const p = Math.round((n / st.total) * 100);
                  return n ? (
                    <span key={l} className={'sd-seg-b' + (bg ? '' : ' wait')} style={{ flex: `${n} 1 0`, background: bg || undefined, color: fg || undefined }} title={`${l}: ${fmtN(n)} ราย (${p}%)`}>
                      {n / st.total >= 0.15 ? `${p}%` : ''}
                    </span>
                  ) : null;
                })}
              </div>
              <span className="sd-muted">{`% ของลูกค้าทั้งหมด ${fmtN(st.total)} ราย`}</span>
            </>
          )}
          {!st.total && <span className="sd-muted">ยังไม่มีลูกค้าในปีนี้</span>}
        </section>

        <section className="sd-card sd-week" aria-label="นัดหมายของทีม">
          <div className="sd-card-h">
            <span className="sd-card-t">
              นัดหมาย{filtered ? 'ตามตัวกรอง' : 'ของทีม'} <small aria-live="polite">{`${wLabel} · ${+wDays[0].slice(8, 10)}–${short(wDays[6])}`}</small>
            </span>
            <span className="sd-wk-nav">
              <button aria-disabled={wk === 0} className={wk === 0 ? 'off' : ''} onClick={() => { if (wk !== 0) { setWk(0); nextRef.current?.focus(); } }}>สัปดาห์นี้</button>
              <button aria-label="สัปดาห์ก่อน" onClick={() => setWk(wk - 1)}><span className="sd-arr" aria-hidden="true" /></button>
              <button ref={nextRef} aria-label="สัปดาห์ถัดไป" onClick={() => setWk(wk + 1)}><span className="sd-arr r" aria-hidden="true" /></button>
            </span>
          </div>
          <div className="sd-wk" role="table" aria-label="นัดหมายรายวัน">
            <div role="row" className="sd-wk-r sd-wk-head">
              <span role="columnheader" />
              {wDays.map((d) => (
                <span role="columnheader" key={d} className={d === today ? 'today' : ''} aria-label={WD_LONG[dow(d)] + ' ' + isoTh(d) + (d === today ? ' (วันนี้)' : '')}>
                  <small>{WD[dow(d)]}</small>
                  <b>{+d.slice(8, 10)}</b>
                </span>
              ))}
            </div>
            {BANDS.map((bl, bi) => (
              <div role="row" key={bl} className="sd-wk-r">
                <span role="rowheader" className="sd-wk-band">{bl}</span>
                {wDays.map((d) => {
                  const ts = tasks.filter((t) => t.date === d && band(t) === bi).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
                  return (
                    <span role="cell" key={d} className="sd-wk-c">
                      {ts.slice(0, 3).map((t) => {
                        const c = e.company(t.gid);
                        const ty = TT.find((x) => x[0] === t.type) || TT[0];
                        const label = `${c ? c.name : t.title} · ${ty[1]} · ${WD_LONG[dow(d)]} ${short(d)}${t.time ? ' ' + t.time : ''}${t.done ? ' · เสร็จแล้ว' : ''}`;
                        return (
                          <button key={t.id} className={'sd-ev' + (t.done ? ' done' : '')} style={{ boxShadow: `0 0 0 2px ${ty[2]}, 0 0 0 4px #F7F9FE` }} onClick={() => open(t.gid)} title={label} aria-label={label}
                            onMouseEnter={() => setEvTip(label)} onMouseLeave={() => setEvTip(null)} onFocus={() => setEvTip(label)} onBlur={() => setEvTip(null)}>
                            <CoAvatar colored name={c ? c.name : t.title} web={c?.web} set={c?.set} size={24} />
                          </button>
                        );
                      })}
                      {ts.length > 3 && (
                        <button className="sd-ev more" onClick={() => set({ tab: 'plan', calM: d.slice(0, 7), calDay: d })} aria-label={`อีก ${ts.length - 3} นัด ${isoTh(d)} (เปิดแผนติดต่อ)`}>+{ts.length - 3}</button>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="sd-legend">
            {evTip ? (
              <span className="sd-evtip">{evTip}</span>
            ) : (
              <>
                {TT.map(([k, l, c]) => <span key={k}><i style={{ boxShadow: `inset 0 0 0 2.5px ${c}` }} />{l}</span>)}
                <span className="sd-muted">{tasks.length ? 'ชี้หรือเลือกรูปเพื่อดูรายละเอียด · กดเพื่อเปิดบริษัท' : 'ไม่มีนัดในสัปดาห์นี้ · วางแผนได้ที่แท็บแผนติดต่อ'}</span>
              </>
            )}
          </div>
          {next.length > 0 && (
            <div className="sd-next">
              <span className="sd-wins-h">นัดถัดไป</span>
              {next.map((t) => {
                const c = e.company(t.gid);
                const ty = TT.find((x) => x[0] === t.type) || TT[0];
                const name = c ? c.name : t.title;
                return (
                  <button key={t.id} className="sd-win-i" title={name} onClick={() => open(t.gid)}>
                    <CoAvatar colored name={name} web={c?.web} set={c?.set} size={30} ring={ty[2]} />
                    <span className="sd-fi-t">
                      <b>{coreName(name) || name}</b>
                      <small>{`${ty[1]} · ${t.date === today ? 'วันนี้' : `${WD_LONG[dow(t.date)]} ${short(t.date)}`}${t.time ? ' ' + t.time : ''}`}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="sd-card sd-follow" aria-label="ลูกค้าที่ต้องติดตาม">
          <div className="sd-card-h">
            <span className="sd-card-t">ต้องติดตาม</span>
            <b className="sd-big" title="ค้างเกิน 14 วัน / ต้องติดตามทั้งหมด">{fmtN(overdueN)}/{fmtN(follow.length)}</b>
          </div>
          <span className="sd-follow-sub">ค้างเกิน 14 วัน / ต้องติดตามทั้งหมด</span>
          <div className="sd-follow-list">
            {!follow.length && <span className="sd-follow-sub">ไม่มีรายการค้าง</span>}
            {(showAll ? follow : follow.slice(0, 8)).map((d) => {
              const od = overdueDays(S, d, today);
              const lc = lastContact(S, d, today);
              const c = d.gid != null ? e.company(d.gid) : undefined;
              const when = lc ? 'ติดต่อล่าสุด ' + (lc.slice(0, 4) === today.slice(0, 4) ? short(lc) : isoTh(lc)) : 'ยังไม่ระบุวันที่ติดต่อ';
              return (
                <button key={d.id} className="sd-fi" title={d.client} onClick={() => set({ deal: d.id })}>
                  <CoAvatar colored name={d.client} web={c?.web} set={c?.set} size={34} />
                  <span className="sd-fi-t">
                    <b>{coreName(d.client) || d.client}</b>
                    <small>{[d.section, d.resp, when].filter(Boolean).join(' · ')}</small>
                  </span>
                  {od != null ? <span className="sd-od">{fmtN(od)} วัน</span> : <span className="sd-ok" title="ยังไม่ค้าง" aria-label="ยังไม่ค้าง"><Icon name="check" size={12} /></span>}
                </button>
              );
            })}
          </div>
          {follow.length > 8 && <button className="sd-more" onClick={() => setShowAll(!showAll)}>{showAll ? 'ย่อรายการ' : `ดูทั้งหมด ${fmtN(follow.length)} ราย`}</button>}
        </section>

        <section className="sd-card sd-acc-card" aria-label="รายละเอียด">
          <Acc title="สรุปยอดตามผู้รับผิดชอบ" open={!!acc.resp} onToggle={() => setAcc({ ...acc, resp: !acc.resp })}>
            <GroupTable rows={Object.entries(st.byResp).sort((a, b) => b[1].forecast - a[1].forecast)} />
          </Acc>
          <Acc title="สรุปยอดตามแหล่งที่มา" open={!!acc.ref} onToggle={() => setAcc({ ...acc, ref: !acc.ref })}>
            <GroupTable rows={Object.entries(st.byReferral).sort((a, b) => b[1].forecast - a[1].forecast)} />
          </Acc>
          <Acc title="ลูกค้าตามช่องทาง" sub="SOURCE · ลูกค้าหลายช่องทางนับในทุกช่องทาง" open={!!acc.src} onToggle={() => setAcc({ ...acc, src: !acc.src })}>
            <Bars items={srcRows.map(([k, x]) => [k, x.n])} />
          </Acc>
          <Acc title="Forecast ตามช่องทาง" sub="บาท · ลูกค้าหลายช่องทางนับซ้ำ" open={!!acc.fsrc} onToggle={() => setAcc({ ...acc, fsrc: !acc.fsrc })}>
            <Bars items={srcRows.map(([k, x]) => [k, x.forecast])} fmt={(n) => fmtMoney(n)} />
          </Acc>
          <Acc title="Win rate ตามช่องทาง" sub="ปิดได้ ÷ รู้ผลแล้ว" open={!!acc.wsrc} onToggle={() => setAcc({ ...acc, wsrc: !acc.wsrc })}>
            <Bars items={winRateBySource(st.bySource)} unit="%" keepZero />
          </Acc>
          <Acc title="ลูกค้าตามบริการ" sub="Services" open={!!acc.svc} onToggle={() => setAcc({ ...acc, svc: !acc.svc })}>
            <Bars items={Object.entries(st.byService)} />
          </Acc>
          <Acc title="ขั้นตอนการขาย (ตาราง)" sub="จำนวนลูกค้าที่มีวันที่หรือโน้ตในแต่ละขั้น" open={!!acc.stg} onToggle={() => setAcc({ ...acc, stg: !acc.stg })}>
            <Bars items={st.stages.map((x) => [STAGE_TH[x.name] ? `${x.name} · ${STAGE_TH[x.name]}` : x.name, x.n])} keepZero />
          </Acc>
        </section>
      </div>
    </div>
  );
}
