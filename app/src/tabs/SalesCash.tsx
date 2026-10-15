import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useEngineVersion, type UIState } from '../state';
import { dmTh, fmtN } from '../lib/format';
import {
  beOf, cashKpis, cashLines, cashRecon, cashYear, filterDeals, fmtMoney, normSalesFilter, quarterOf,
  type CashKpis, type CashLine, type CashRecon as Recon, type CashYear, type DateBasis, type Deal, type SalesFilter, type SalesState,
} from '../lib/sales';
import { rangeTh, type Range } from '../lib/dateRange';
import { shortName, trackerFields, liveCount } from '../lib/salesUi';
import { cashCardWords, cashRows, crossYearTag, dayTh, instWords, monthYearTh, splitExample, type CashCsvMode, type CashLens } from '../lib/cashUi';
import { useMedia } from '../components/Sidebar';
import { Kpi } from '../components/ui';
import { Modal } from '../components/Dialog';
import { FilterBar, sentence, type FVal } from '../components/FilterBar';
import { CashChart, CashKey } from '../components/CashChart';
import { MonthCheck, YearCheck, useOpenMonth } from '../components/MonthCheck';
import { cashCheckRows, chkRows, pageKeep, sumRows, ymOf } from '../lib/payCheck';
import { Check, Pop, Radio } from '../components/Pop';
import { Chevron } from '../components/StageTrack';

type Show = UIState['slCashShow'];
const m0 = (n: number) => fmtMoney(Math.round(n)) || '0';

// ------------------------------------------------------------------ the cards and the line under them

/**
 * A card that is a button and holds a link of its own (ค้างรับในปีนี้ with its late figure): a link cannot
 * sit inside a button, so the button covers the card from behind and the link sits above it (cashflow.css
 * .cf-kpi-st). Same look as ui.tsx Kpi.
 */
function KpiWithLink({ label, value, zero, foot, onClick, pressed, title }: { label: string; value: string; zero?: boolean; foot: ReactNode; onClick: () => void; pressed?: boolean; title: string }) {
  return (
    <div className="kpi hv cf-kpi-st">
      <button type="button" className="cf-kpi-hit" onClick={onClick} aria-pressed={pressed} title={title} aria-label={`${label} ${value} บาท · ${title}`} />
      <span className="kpi-l">{label}</span>
      <span className={'kpi-v' + (zero ? ' zero' : '')}>{value}<small>บาท</small></span>
      <span className="kpi-f">{foot}</span>
    </div>
  );
}

/**
 * The four Cashflow cards of a year (the tab, and the table in the lens "เงินเข้าตามปี"): the year's money
 * (hero), received, owed in the year (late in red, due this month), and the year's undated money. In the
 * lens with a ช่วงเวลา (`range`) the cards count the range's money and say so (cashCardWords).
 * `onShow`: the cards are buttons that narrow the list below to that money; the late figure is a link.
 */
export function CashKpiRow({ K, year, range, show, onShow, onLate, checked }: { K: CashKpis; year: string; range?: { basis: DateBasis; r: Range } | null; show?: Show; onShow?: (s: Show) => void; onLate?: () => void; /** the month check: the year's received lines accounting has checked ("บัญชีตรวจแล้ว 6") */ checked?: number }) {
  const W = cashCardWords(year, range);
  const fromOther = K.n > 0 && K.ownN === 0 ? Object.keys(K.from).sort() : [];
  const pct = K.total ? Math.round((K.got / K.total) * 100) : 0;
  const pick = (s: Show) => (onShow ? () => onShow(show === s ? '' : s) : undefined);
  const late = K.late > 0 && (onLate || onShow) ? (
    <button type="button" className="lnk sl-kpi-link" onClick={onLate || (() => onShow!(show === 'late' ? '' : 'late'))} title="ดูเฉพาะงวดที่เลยกำหนด">
      เลยกำหนด <b>{m0(K.late)}</b>
    </button>
  ) : K.late > 0 ? <span className="t-bad">เลยกำหนด {m0(K.late)}</span> : null;
  const owedFoot =
    K.late > 0 || K.dueMonthN > 0 ? (
      <span className="sl-kpi-two">
        {late || <span>ไม่มีงวดเลยกำหนด</span>}
        {K.dueMonthN > 0 && <span>ถึงกำหนดเดือนนี้ {m0(K.dueMonth)}</span>}
      </span>
    ) : K.owedN ? `${fmtN(K.owedN)} งวด · ครบกำหนด ${dayTh(K.firstDue)}${K.owedN > 1 ? ' เป็นงวดแรก' : ''}` : `ไม่มียอดค้าง${W.scope}`;
  const owedTitle = 'ดูเฉพาะงวดที่ยังไม่ได้รับ';
  return (
    <div className="kpis sl-kpis">
      <Kpi
        hero
        label={W.heroR ? <>{W.hero} <span className="sl-kpi-r">{W.heroR}</span></> : W.hero}
        value={m0(K.total)}
        unit="บาท"
        title={W.heroTitle}
        foot={
          fromOther.length ? <>มาจากงาน{fromOther.map((y) => 'ปี ' + y).join(' และ ')} ทั้งหมด · {fmtN(K.n)} งวด</>
          : K.n ? <>รับแล้ว <b>{pct}%</b> · ทั้งหมด {fmtN(K.n)} งวด</>
          : `ยังไม่มีงวดเงิน${W.scope}`
        }
      />
      <Kpi label="รับแล้ว" value={m0(K.got)} unit="บาท" zero={!K.got} onClick={pick('got')} pressed={onShow ? show === 'got' : undefined} title={onShow ? 'ดูเฉพาะรายการที่รับแล้ว' : undefined}
        foot={K.gotN ? `${fmtN(K.gotN)} รายการ · ${checked != null ? `บัญชีตรวจแล้ว ${fmtN(checked)}` : `ล่าสุด ${dmTh(K.lastGot)}`}` : `ยังไม่มีเงินเข้า${W.scope}`} />
      {onShow && K.owed && late ? (
        // the card narrows the list to what is owed, its late figure to what is late
        <KpiWithLink label={W.owed} value={m0(K.owed)} foot={owedFoot} onClick={pick('owed')!} pressed={show === 'owed'} title={owedTitle} />
      ) : (
        <Kpi label={W.owed} value={m0(K.owed)} unit="บาท" zero={!K.owed} onClick={K.owed && !late ? pick('owed') : undefined} pressed={onShow && K.owed && !late ? show === 'owed' : undefined} title={onShow && K.owed && !late ? owedTitle : undefined} foot={owedFoot} />
      )}
      <Kpi label="ยังไม่กำหนดวันรับ" value={m0(K.undated)} unit="บาท" zero={!K.undated} onClick={K.undated ? pick('undated') : undefined} pressed={onShow && K.undated ? show === 'undated' : undefined} title={onShow && K.undated ? 'ดูเฉพาะเงินที่ยังไม่มีวันรับ' : undefined}
        foot={K.undatedDeals ? `งานปี ${year} · ${fmtN(K.undatedDeals)} งาน · ${W.undated}` : `งานปี ${year} ยังไม่มี`} />
    </div>
  );
}

/** The line that ties the cards to today's KPI ค้างรับ (sales.ts cashRecon): the money still owed on the
 *  year's open jobs, split by where it falls; the other years are links to them. */
function ReconLine({ R, K, year, own, goYear }: { R: Recon; K: CashKpis; year: string; own: boolean; goYear: (y: string) => void }) {
  const yearLink = (y: string, text = 'ปี ' + y) => <button type="button" className="lnk" onClick={() => goYear(y)}>{text}</button>;
  const from = Object.keys(K.from).sort();
  const extra = [R.closedIn ? <>งานปิดแล้วที่ยังค้าง <b>{m0(R.closedIn)}</b></> : null, R.otherIn ? <>งวดจากงานปีอื่น <b>{m0(R.otherIn)}</b></> : null].filter(Boolean);
  return (
    <p className="cf-recon">
      {R.open ? (
        <>
          ค้างรับของงานปี {year} ทั้งหมด <b>{m0(R.open)}</b> บาท แบ่งเป็น ในปีนี้ <b>{m0(R.inYear)}</b>
          {R.byYear.map((y) => <Fragment key={y.year}> · {yearLink(y.year)} <b>{m0(y.amt)}</b></Fragment>)}
          {R.undated > 0 && <> · ยังไม่กำหนดวันรับ <b>{m0(R.undated)}</b></>}
        </>
      ) : own ? (
        <>งานปี {year} ที่ยังเปิดไม่มียอดค้างรับ</>
      ) : (
        <>ปี {year} ยังไม่มีงานของปีนี้</>
      )}
      {from.length > 0 && !R.open && <> · เงินในปีนี้มาจากงวดของ {from.map((y, i) => <Fragment key={y}>{i ? ' และ ' : ''}{yearLink(y, 'งานปี ' + y)} {fmtN(K.from[y])} งาน</Fragment>)}</>}
      {extra.length > 0 && (R.open > 0 || own) && <> · การ์ดค้างรับในปีนี้รวม{extra.map((x, i) => <Fragment key={i}>{i ? ' และ' : ''} {x}</Fragment>)} ด้วย</>}
    </p>
  );
}

// ------------------------------------------------------------------ the tab

/** The filters of the Cashflow tab back into view state (the year and the lens are the page's). */
const toCashF = (F: SalesFilter): UIState['slCashF'] => {
  const { year: _y, money: _m, ...rest } = F;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as UIState['slCashF'];
};

/**
 * The Sales Tracker's Cashflow tab (cash impl-note §4): each installment in the year it is received or
 * due, whatever the deal's year. The cards (buttons that narrow the list below), the line tying them to
 * the KPI ค้างรับ, the filter row (it narrows the deals the money comes from), the chart by month or
 * quarter (a bar opens its month below), the month check for accounting (the year's money a month at a
 * time, or the whole year with the undated bucket after it; components/MonthCheck.tsx), the year table
 * "สรุปรายเดือน", and the CSV.
 */
export function CashView({ S, today, year }: { S: SalesState; today: string; year: string }) {
  const { engine: e, ui, set } = useApp();
  const ver = useEngineVersion();
  const phone = useMedia('(max-width: 760px)');
  const me = e.me();
  const F = normSalesFilter({ year, ...ui.slCashF, money: 'cash' });
  const base = filterDeals(S, { year, money: 'cash' }, today);
  const deals = filterDeals(S, F, today);
  const lines = cashLines(S, deals, today);
  const Y = cashYear(lines, year), K = cashKpis(Y, year, today), R = cashRecon(lines, year);
  const own = Object.values(S.deals).some((d) => d.year === year);
  const mode = ui.slCashMode, show = ui.slCashShow;
  const nowI = beOf(today) === year ? (mode === 'm' ? +today.slice(5, 7) - 1 : quarterOf(today)) : -1;
  const key = JSON.stringify(ui.slCashF);
  const fields = useMemo(() => trackerFields(S, F, { yearDeals: base, job: '', me, today, dash: true }), [ver, key, year, me, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const value: Record<string, FVal | undefined> = { resp: F.resp, source: F.source, service: F.service, referral: F.referral, section: F.section };
  const filtered = !!(F.resp || F.source || F.service || F.referral || F.section);
  const filterWords = fields.filter((f) => value[f.key]?.v.length).map((f) => sentence(f, value[f.key]!)).join(' · ') || 'ผู้รับผิดชอบ ทุกคน';
  const up = (p: Partial<SalesFilter>) => set({ slCashF: toCashF({ ...F, ...p }) });
  const goYear = (y: string) => set({ slYear: y, slCashShow: '' });

  // the month check under the chart (lib/payCheck.ts): every deal's lines (a check whose line is gone is an
  // orphan only when no deal holds it); the card and the table show the year through this page's filters,
  // late money carried and lines waiting elsewhere reach into other years, closing a month counts the
  // whole month (`team`); the month open is the picked bar
  const allLines = cashLines(S, Object.values(S.deals), today);
  const ce = +year - 543;
  const { rows, wide, team } = cashCheckRows(chkRows(S, allLines, e.payChecks(), e.payChkCfg().since), ce, pageKeep(S, F, today));
  // a deal whose money falls in more than one year says where the rest is ("ข้ามปี: งวด 3 อยู่ปี 2570")
  const byDeal = new Map<string, CashLine[]>();
  allLines.forEach((l) => byDeal.set(l.deal.id, [...(byDeal.get(l.deal.id) || []), l]));
  const tags = new Map([...byDeal].map(([id, ls]) => [id, crossYearTag(ls, year)]));
  const firstM = rows.find((r) => r.kind !== 'orphan');
  const scope: number | 'y' = ui.slChkM ?? (beOf(today) === year ? +today.slice(5, 7) - 1 : firstM ? +firstM.ym.slice(5, 7) - 1 : 'y');
  const picked = show || scope === 'y' ? null : mode === 'm' ? scope : quarterOf(ymOf(ce, scope) + '-01');
  const open = useOpenMonth();
  const onPick = (i: number | null) => {
    if (i == null) return open('y', undefined, phone);
    if (mode === 'm') return open(i, undefined, phone);
    // a quarter: its month with money (this month when it is in it), else its first
    const ms = [0, 1, 2].map((k) => i * 3 + k);
    const now = beOf(today) === year ? +today.slice(5, 7) - 1 : -1;
    open(ms.includes(now) ? now : ms.find((m) => rows.some((r) => r.ym === ymOf(ce, m) && r.kind !== 'orphan')) ?? ms[0], undefined, phone);
  };

  return (
    <>
      <CashKpiRow K={K} year={year} show={show} onShow={(s) => set({ slCashShow: s })} checked={sumRows(rows).ok} />
      <ReconLine R={R} K={K} year={year} own={own} goYear={goYear} />
      <div className="cf-tools">
        <FilterBar
          fields={fields}
          value={value}
          onChange={(k, v) => up({ [k]: v || undefined })}
          anySet={filtered}
          onClearAll={() => set({ slCashF: {} })}
          count={filtered ? { shown: deals.length, total: base.length } : null}
          liveCount={(k, d) => liveCount(S, F, k, d, '', today)}
        />
      </div>
      <section className="cf-card" aria-labelledby="cf-chart-t">
        <div className="cf-h">
          <div>
            <h3 className="cf-t" id="cf-chart-t">{mode === 'm' ? 'เงินเข้ารายเดือน' : 'เงินเข้ารายไตรมาส'} · ปี {year}</h3>
            <span className="cf-s">รับแล้วนับตามวันที่รับเงิน · ที่ยังไม่รับนับตามวันครบกำหนด</span>
            {!phone && <CashKey />}
          </div>
          <div className="seg" role="group" aria-label="ช่วงของกราฟ">
            <button type="button" aria-pressed={mode === 'm'} onClick={() => set({ slCashMode: 'm', slCashPick: null })}>รายเดือน</button>
            <button type="button" aria-pressed={mode === 'q'} onClick={() => set({ slCashMode: 'q', slCashPick: null })}>รายไตรมาส</button>
          </div>
        </div>
        {phone && <CashKey />}
        <CashChart data={mode === 'm' ? Y.months : Y.quarters} mode={mode} year={year} now={nowI} pick={picked} onPick={onPick} phone={phone} />
        <div className="cf-foot">
          {phone ? 'นับเฉพาะงานที่ได้งานแล้ว · ยอดรวม VAT · แตะเดือนเพื่อเปิดส่วนตรวจรับเงิน' : 'นับเฉพาะงานที่ได้งานแล้ว (YES) รวมงานที่ปิดแล้ว · ยอดตามเอกสาร รวม VAT · กดแท่งเพื่อเปิดเดือนนั้นในส่วนตรวจรับเงินด้านล่าง'}
        </div>
      </section>
      <MonthCheck S={S} rows={rows} wide={wide} team={team} filter={filtered ? filterWords : ''} undated={Y.undated} year={year} scope={scope} show={show} today={today} phone={phone} tags={tags} />
      <YearCheck S={S} rows={rows} team={team} filter={filtered ? filterWords : ''} year={year} scope={show ? 'y' : scope} today={today} phone={phone} />
      {ui.slCashCsv && <CashExport S={S} year={year} lines={lines} Y={Y} filterWords={filterWords} onClose={() => set({ slCashCsv: false })} />}
    </>
  );
}

// ------------------------------------------------------------------ the CSV

/** "ส่งออก Cashflow ปี 2569 เป็น CSV": one row per amount or the months / quarters summed, with or without
 *  the undated money, the page's filters; the first rows as they will be in the file. */
function CashExport({ S, year, lines, Y, filterWords, onClose }: { S: SalesState; year: string; lines: CashLine[]; Y: CashYear; filterWords: string; onClose: () => void }) {
  const { engine: e } = useApp();
  const [mode, setMode] = useState<CashCsvMode>('lines');
  const [und, setUnd] = useState(true);
  const has = Y.undated.length > 0;
  const rows = cashRows(S, year, Y, mode, und && has);
  const n = (m: CashCsvMode) => cashRows(S, year, Y, m, und && has).rows.length;
  // the preview's columns: the money and its dates (the file has more: the year, the deal's year, หมวด, …)
  const cols = mode === 'lines' ? [1, 2, 6, 7, 8, 9, 10] : rows.head.map((_, i) => i).slice(1);
  const money = new Set(mode === 'lines' ? [7] : [2, 3, 4, 5, 6]);
  const undSum = Y.undated.reduce((a, l) => a + l.amt, 0);
  return (
    <Modal title={`ส่งออก Cashflow ปี ${year} เป็น CSV`} onClose={onClose} width={660}>
      <div className="cf-dlg" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="cf-fl" id="cf-csv-mode">ข้อมูลในไฟล์</div>
          <div className="seg" role="group" aria-labelledby="cf-csv-mode">
            <button type="button" aria-pressed={mode === 'lines'} onClick={() => setMode('lines')}>รายงวด · {fmtN(n('lines'))} แถว</button>
            <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>สรุปรายเดือน · {fmtN(n('month'))} แถว</button>
            <button type="button" aria-pressed={mode === 'quarter'} onClick={() => setMode('quarter')}>สรุปรายไตรมาส · {fmtN(n('quarter'))} แถว</button>
          </div>
        </div>
        <div>
          <div className="cf-fl">ช่วงและตัวกรอง</div>
          <div>ทั้งปี {year} · {filterWords} <span className="cf-mute">(ตามที่กรองอยู่ในหน้านี้)</span></div>
        </div>
        {has && (
          <label className={'cf-ck' + (und ? ' on' : '')}>
            <input type="checkbox" className="sr-only" checked={und} onChange={(ev) => setUnd(ev.target.checked)} />
            <Check on={und} />
            <span>
              รวมรายการ “ยังไม่กำหนดวันรับ”
              <small>{fmtN(new Set(Y.undated.map((l) => l.deal.id)).size)} งาน · {m0(undSum)} บาท · {mode === 'lines' ? 'อยู่ท้ายไฟล์ เดือนเว้นว่าง' : 'เป็นแถวสุดท้าย'}</small>
            </span>
          </label>
        )}
        <div>
          <div className="cf-fl">ตัวอย่าง {Math.min(3, rows.rows.length)} แถวแรก</div>
          {rows.rows.length ? (
            <div className="cf-prev">
              <table>
                <thead><tr>{cols.map((i) => <th key={i} className={money.has(i) ? 'r' : undefined}>{rows.head[i]}</th>)}</tr></thead>
                <tbody>{rows.rows.slice(0, 3).map((r, j) => <tr key={j}>{cols.map((i) => <td key={i} className={money.has(i) ? 'r' : undefined}>{String(r[i])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : (
            <span className="cf-mute">ยังไม่มีรายการในปีนี้</span>
          )}
        </div>
        <p className="cf-dnote">
          {mode === 'lines' ? 'ในไฟล์มีคอลัมน์ ปีของงาน หมวด ผู้รับผิดชอบ และเลขใบเสนอราคาด้วย · ' : ''}ยอดรวม VAT ตามเอกสาร · วันที่แบบ 2026-04-20 ให้ Excel เรียงได้
        </p>
        <div className="dlg-act">
          <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn pri" onClick={() => { e.exportCashCsv(year, lines, mode, und && has); onClose(); }}>ส่งออก CSV</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ the table's lens "นับยอด"

/** A deal's money in the lens: the Forecast column holds what falls in the year ("งวด 3/3"), the Actual
 *  column what of it came in. */
export function LensMoney({ L, d, col, won }: { L: CashLens; d: Deal; col: 'fc' | 'ac'; won: boolean }) {
  const ls = L.inYear.get(d.id) || [];
  const all = ls.reduce((a, l) => a + l.amt, 0), got = ls.filter((l) => l.kind === 'got').reduce((a, l) => a + l.amt, 0);
  const owed = all - got, late = ls.some((l) => l.kind === 'owed' && l.status === 'late');
  if (col === 'fc') {
    if (!ls.length) return <span className="sl-mn"><b className="none">—</b><small>{won ? 'ไม่มีงวดในปีนี้' : 'ยังไม่ได้งาน'}</small></span>;
    const of = ls[0].of, ns = ls.map((l) => l.n).filter((n) => n > 0);
    return <span className="sl-mn"><b>{fmtMoney(all)}</b><small className="sl-fig">{ns.length ? `${instWords(ns)}/${of}` : 'ไม่มีแผน'}</small></span>;
  }
  if (!ls.length) return <span className="sl-mn"><b className="none">—</b></span>;
  return (
    <span className="sl-mn">
      <b className={got ? '' : 'none'}>{got ? fmtMoney(got) : '—'}</b>
      {owed > 0 ? <small className={late ? 'bad' : ''}>{got ? `ค้าง ${fmtMoney(owed)}` : late ? 'เลยกำหนด' : 'ยังไม่ถึงกำหนด'}</small> : <small className="ok">รับครบ</small>}
    </span>
  );
}
/** The note above the table in the lens, with the way back. */
export function LensNote({ year, range, onBack }: { year: string; range?: Range | null; onBack: () => void }) {
  return (
    <p className="cf-lnote">
      <b>นับยอดแบบเงินเข้าตามปี {year}</b> · แสดงงานทุกปีที่มีงวดในปี {year} · ยอดนับเฉพาะงวด{range ? `ใน ${rangeTh(range, { dropYear: year })}` : 'ในปีนี้'} · <button type="button" className="lnk" onClick={onBack}>กลับไปนับยอดขายตามปีของงาน</button>
    </p>
  );
}

/**
 * "นับยอด" in the table's filter row: the deal's year (as always) or "เงินเข้าตามปี". Its popover says what
 * each counts, with a worked example from the data (a deal whose money falls in two years); nothing changes
 * before "ใช้".
 */
export function LensChip({ S, year, today, value, onChange, onCashTab }: { S: SalesState; year: string; today: string; value: 'deal' | 'cash'; onChange: (v: 'deal' | 'cash') => void; onCashTab: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const btn = useRef<HTMLButtonElement>(null);
  const on = value === 'cash';
  const word = on ? 'เงินเข้าตามปี' : 'ยอดขายตามปีของงาน';
  const ex = open ? splitExample(cashLines(S, Object.values(S.deals), today)) : null;
  const opt = (v: 'deal' | 'cash', title: string, desc: string) => (
    <label className={'fck' + (draft === v ? ' on' : '')} data-hl="">
      <input type="radio" name="cf-lens" className="sr-only" checked={draft === v} onChange={() => setDraft(v)} data-autofocus={draft === v ? '' : undefined} />
      <Radio />
      <span className="fck-l">{title}<small className="fck-d">{desc}</small></span>
    </label>
  );
  return (
    <>
      <span className={'fchip cf-lensc' + (on ? ' on' : '') + (open ? ' open' : '')}>
        <button ref={btn} type="button" className="fchip-b" aria-haspopup="dialog" aria-expanded={open} aria-label={`นับยอดแบบ ${word} — เลือก`} title={on ? 'นับเงินแต่ละงวดในปีที่รับหรือครบกำหนด' : 'นับยอดเต็มของงานในปีของงาน'} onClick={() => { setDraft(value); setOpen(!open); }}>
          <span className="fchip-f">นับยอด</span>
          <span className="fchip-v">{word}</span>
          <Chevron size={14} />
        </button>
      </span>
      {open && (
        <Pop anchor={btn} onClose={() => setOpen(false)} label="นับยอดแบบ" title="นับยอดแบบ" kind="dialog" width={440} className="val">
          <div className="fval">
            <div className="fval-h cf-lens-h"><span className="fval-t">นับยอดแบบ</span></div>
            <div className="fval-line">ใช้กับตัวเลขบนการ์ดและยอดเงินในตาราง</div>
            <div className="hl-list fval-list fval-rich cf-opts" role="radiogroup" aria-label="นับยอดแบบ">
              {opt('deal', 'ยอดขายตามปีของงาน', `งานของปี ${year} นับยอดเต็ม ไม่ว่าเงินเข้าปีไหน · แบบที่ใช้อยู่`)}
              {opt('cash', 'เงินเข้าตามปี (Cashflow)', `นับเฉพาะงวดที่รับหรือครบกำหนดในปี ${year} รวมงานของปีอื่น`)}
            </div>
            <div className="cf-ex">
              {ex ? (
                <>
                  ตัวอย่าง <b>{shortName(ex.deal.client)} {m0(ex.total)}</b> · {fmtN(ex.n)} งวด งวดสุดท้าย {monthYearTh(ex.last)}
                  <br />ตามปีของงาน: ปี {ex.deal.year} นับ <b>{m0(ex.total)}</b>
                  <br />เงินเข้าตามปี: {ex.years.map((y, i) => <Fragment key={y.year}>{i ? ' · ' : ''}ปี {y.year} นับ <b>{m0(y.amt)}</b></Fragment>)}
                </>
              ) : (
                <>
                  ตัวอย่าง งาน 300,000 บาท แบ่ง 3 งวด งวดสุดท้ายข้ามไปปีหน้า
                  <br />ตามปีของงาน: ปีของงานนับ <b>300,000</b>
                  <br />เงินเข้าตามปี: ปีนี้นับ <b>200,000</b> · ปีหน้านับ <b>100,000</b>
                </>
              )}
            </div>
            <div className="fval-foot">
              <span className="pop-sum">ดูรายเดือนได้ที่แท็บ <button type="button" className="lnk" style={{ fontSize: 'var(--fs-sec)' }} onClick={() => { setOpen(false); onCashTab(); }}>Cashflow</button></span>
              <button type="button" className="quiet fval-cancel" onClick={() => setOpen(false)}>ยกเลิก</button>
              <button type="button" className="btn pri sm" onClick={() => { setOpen(false); if (draft !== value) onChange(draft); }}>ใช้</button>
            </div>
          </div>
        </Pop>
      )}
    </>
  );
}
