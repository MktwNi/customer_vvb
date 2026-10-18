import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useEngineVersion, type UIState } from '../state';
import { daysBetween, dmTh, fmtN } from '../lib/format';
import {
  beOf, cashKpis, cashLines, cashRecon, cashYear, dealMoney, filterDeals, fmtMoney, normSalesFilter, quarterOf,
  type CashKpis, type CashLine, type CashRecon as Recon, type CashYear, type DateBasis, type Deal, type SalesFilter, type SalesState,
} from '../lib/sales';
import { rangeTh, type Range } from '../lib/dateRange';
import { shortName, trackerFields, liveCount } from '../lib/salesUi';
import { MONTHS_TH, Q_TH, cashCardWords, cashRows, crossYearTag, dayTh, instSub, instText, instWords, monthYearTh, payerName, splitExample, type CashCsvMode, type CashLens } from '../lib/cashUi';
import { useMedia } from '../components/Sidebar';
import { Kpi, Status } from '../components/ui';
import { CoAvatar } from '../components/CoAvatar';
import { Modal } from '../components/Dialog';
import { FilterBar, ReadChip, sentence, type FVal } from '../components/FilterBar';
// joint quotations (package quotes, item 7): the same money as the Dashboard under a person filter; customers per company
import { customersOf } from '../lib/sales';
import { viewCashLines } from '../lib/joint';
import { CashChart, CashKey, slotName } from '../components/CashChart';
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
export function CashKpiRow({ K, year, range, show, onShow, onLate }: { K: CashKpis; year: string; range?: { basis: DateBasis; r: Range } | null; show?: Show; onShow?: (s: Show) => void; onLate?: () => void }) {
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
        foot={K.gotN ? `${fmtN(K.gotN)} รายการ · ล่าสุด ${dmTh(K.lastGot)}` : `ยังไม่มีเงินเข้า${W.scope}`} />
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
 * due, whatever the deal's year. The cards (buttons that narrow the list), the line tying them to the
 * KPI ค้างรับ, the filter row (it narrows the deals the money comes from), the chart by month or quarter
 * (a bar picks its month for the list), the list of the year's money grouped by month with the undated
 * bucket after it, and the CSV.
 */
export function CashView({ S, today, year }: { S: SalesState; today: string; year: string }) {
  const { engine: e, ui, set } = useApp();
  const ver = useEngineVersion();
  const phone = useMedia('(max-width: 760px)');
  const me = e.me();
  const F = normSalesFilter({ year, ...ui.slCashF, money: 'cash' });
  const base = filterDeals(S, { year, money: 'cash' }, today);
  const deals = filterDeals(S, F, today);
  // a ผู้รับผิดชอบ / SOURCE / REFERRAL filter counts a joint quotation by the parts of its companies listed,
  // as the Dashboard and the KPIs do (lib/joint viewCashLines)
  const lines = viewCashLines(S, F, today, deals);
  const Y = cashYear(lines, year), K = cashKpis(Y, year, today), R = cashRecon(lines, year);
  const own = Object.values(S.deals).some((d) => d.year === year);
  const mode = ui.slCashMode, pick = ui.slCashPick, show = ui.slCashShow;
  const nowI = beOf(today) === year ? (mode === 'm' ? +today.slice(5, 7) - 1 : quarterOf(today)) : -1;
  const key = JSON.stringify(ui.slCashF);
  const fields = useMemo(() => trackerFields(S, F, { yearDeals: base, job: '', me, today, dash: true }), [ver, key, year, me, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const value: Record<string, FVal | undefined> = { resp: F.resp, source: F.source, service: F.service, referral: F.referral, section: F.section };
  const filtered = !!(F.resp || F.source || F.service || F.referral || F.section);
  const filterWords = fields.filter((f) => value[f.key]?.v.length).map((f) => sentence(f, value[f.key]!)).join(' · ') || 'ผู้รับผิดชอบ ทุกคน';
  const up = (p: Partial<SalesFilter>) => set({ slCashF: toCashF({ ...F, ...p }) });
  const goYear = (y: string) => set({ slYear: y, slCashShow: '' });

  // what the list shows: a bar's month or quarter, a card's kind of money
  const slotOf = (l: CashLine) => (mode === 'm' ? +l.date.slice(5, 7) - 1 : quarterOf(l.date));
  const shown = Y.lines.filter((l) => (pick == null || slotOf(l) === pick) && (show === '' || (show === 'got' ? l.kind === 'got' : show === 'owed' ? l.kind === 'owed' : show === 'late' ? l.status === 'late' && l.kind === 'owed' : false)));
  const undated = pick == null && (show === '' || show === 'undated') ? Y.undated : [];
  const showWord = { got: 'รับแล้ว', owed: 'ค้างรับในปีนี้', late: 'เลยกำหนด', undated: 'ยังไม่กำหนดวันรับ', '': '' }[show];
  // a deal's lines in every year (the cross-year tag), from the whole set, not the filtered view
  const byDeal = new Map<string, CashLine[]>();
  lines.forEach((l) => byDeal.set(l.deal.id, [...(byDeal.get(l.deal.id) || []), l]));

  return (
    <>
      <CashKpiRow K={K} year={year} show={show} onShow={(s) => set({ slCashShow: s })} />
      <ReconLine R={R} K={K} year={year} own={own} goYear={goYear} />
      <div className="cf-tools">
        <FilterBar
          fields={fields}
          value={value}
          onChange={(k, v) => up({ [k]: v || undefined })}
          anySet={filtered}
          onClearAll={() => set({ slCashF: {} })}
          count={filtered ? { shown: customersOf(S, deals).length, total: customersOf(S, base).length } : null}
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
        <CashChart data={mode === 'm' ? Y.months : Y.quarters} mode={mode} year={year} now={nowI} pick={pick} onPick={(i) => set({ slCashPick: i })} phone={phone} />
        <div className="cf-foot">
          {phone ? 'นับเฉพาะงานที่ได้งานแล้ว · ยอดรวม VAT · แตะแถวเพื่อดูรายการ' : 'นับเฉพาะงานที่ได้งานแล้ว (YES) รวมงานที่ปิดแล้ว · ยอดตามเอกสาร รวม VAT · กดแท่งเพื่อดูเฉพาะรายการของช่วงนั้น'}
        </div>
      </section>
      <section className="cf-card" aria-labelledby="cf-list-t">
        <div className="cf-h">
          <div>
            <h3 className="cf-t" id="cf-list-t">รายการเงินเข้าในปี {year}</h3>
            <span className="cf-s">{fmtN(Y.lines.length)} งวด · เรียงตามวันที่ · {phone ? 'แตะ' : 'กด'}รายการเพื่อเปิดงาน</span>
          </div>
          <button type="button" className={'btn ' + (phone ? 'xs' : 'sm')} onClick={() => set({ slCashCsv: true })}>ส่งออก CSV</button>
        </div>
        {(pick != null || show) && (
          <div className="cf-show">
            {pick != null && <ReadChip text={`แสดงเฉพาะ ${slotName(mode, pick, year)}`} onClear={() => set({ slCashPick: null })} label="ดูทั้งปี" />}
            {show && <ReadChip text={`แสดงเฉพาะ${showWord}`} onClear={() => set({ slCashShow: '' })} />}
          </div>
        )}
        {phone ? (
          <CashCards S={S} lines={shown} undated={undated} year={year} mode={mode} today={today} byDeal={byDeal} />
        ) : (
          <CashList S={S} lines={shown} undated={undated} year={year} mode={mode} today={today} byDeal={byDeal} />
        )}
        {!shown.length && !undated.length && (
          <div className="cf-empty">{Y.lines.length || Y.undated.length ? 'ไม่มีรายการตามที่เลือก' : `ยังไม่มีงวดเงินในปี ${year} · งานที่ได้งานแล้วและมีแผนชำระจะแสดงที่นี่`}</div>
        )}
        {pick == null && (show === '' || show === 'undated') && !Y.undated.length && (Y.lines.length > 0 || own) && (
          <div className="cf-empty"><b>ยังไม่กำหนดวันรับ</b> · ไม่มี · งานปี {year} ที่ได้งานแล้วแต่ยังไม่มีแผนชำระจะแสดงที่นี่</div>
        )}
      </section>
      {ui.slCashCsv && <CashExport S={S} year={year} lines={lines} Y={Y} filterWords={filterWords} onClose={() => set({ slCashCsv: false })} />}
    </>
  );
}

/** One list group: a month (or quarter) band, then its rows. */
interface Group { key: string; name: string; lines: CashLine[] }
function groupsOf(lines: CashLine[], mode: 'm' | 'q', year: string): Group[] {
  const out: Group[] = [];
  lines.forEach((l) => {
    const i = mode === 'm' ? +l.date.slice(5, 7) - 1 : quarterOf(l.date);
    const key = mode + i;
    const g = out.find((x) => x.key === key) || (out.push({ key, name: mode === 'm' ? `${MONTHS_TH[i]} ${year}` : `ไตรมาส ${i + 1} · ${Q_TH[i]} ${year}`, lines: [] }), out[out.length - 1]);
    g.lines.push(l);
  });
  return out;
}
/** A band's parts when it holds more than one kind of money: "รับแล้ว 305,000 · เลยกำหนด 80,250 · รอรับ 156,000". */
function BandParts({ lines }: { lines: CashLine[] }) {
  const got = lines.filter((l) => l.kind === 'got').reduce((a, l) => a + l.amt, 0);
  const late = lines.filter((l) => l.kind === 'owed' && l.status === 'late').reduce((a, l) => a + l.amt, 0);
  const wait = lines.filter((l) => l.kind === 'owed' && l.status !== 'late').reduce((a, l) => a + l.amt, 0);
  const parts = [got ? <>รับแล้ว {m0(got)}</> : null, late ? <span className="bad">เลยกำหนด {m0(late)}</span> : null, wait ? <>รอรับ {m0(wait)}</> : null].filter(Boolean);
  return parts.length > 1 ? <span className="cf-bs">{parts.map((p, i) => <Fragment key={i}>{i ? ' · ' : ''}{p}</Fragment>)}</span> : null;
}
/** A line's status: รับแล้ว; a tinted chip when it needs action now (เลยกำหนด / ถึงกำหนด); else รอชำระ and how long. */
function LineStatus({ l, today, inline }: { l: CashLine; today: string; inline?: boolean }) {
  if (l.kind === 'got') return <Status kind="ok">รับแล้ว</Status>;
  if (l.status === 'late') return <span className="chip bad">เลยกำหนด {fmtN(l.lateDays)} วัน</span>;
  if (l.status === 'due') return <span className="chip warn">{l.date === today ? 'ถึงกำหนดวันนี้' : `ถึงกำหนด ${daysBetween(today, l.date)} วัน`}</span>;
  const left = l.date ? `อีก ${fmtN(daysBetween(today, l.date))} วัน` : '';
  if (inline) return <Status kind="neutral">รอชำระ{left ? ' · ' + left : ''}</Status>;
  return <span className="cf-cell"><Status kind="neutral">รอชำระ</Status>{left && <small>{left}</small>}</span>;
}
/** The grey line under a client: "งานปี 2569 · Depa · คุณบี · ปิดงานแล้ว". */
const dealSub = (d: Deal) => [`งานปี ${d.year}`, d.section, d.resp, d.jobStatus === 'closed' ? 'ปิดงานแล้ว' : ''].filter(Boolean).join(' · ');
/** What undated money still needs: a plan or a due date (to whoever may edit), else said in words. */
function UndatedAct({ l }: { l: CashLine }) {
  const { engine: e, set } = useApp();
  if (l.kind === 'got') return <span className="cf-cell"><Status kind="ok">รับแล้ว</Status><small>ไม่มีวันที่รับ</small></span>;
  const plan = l.src === 'plan';
  if (!e.canDeal('edit.pay', l.deal)) return <span className="cf-mute">{plan ? 'ยังไม่กำหนดวันครบกำหนด' : 'ยังไม่มีแผนชำระ'}</span>;
  return <button type="button" className="lnk" onClick={(ev) => { ev.stopPropagation(); set({ deal: l.deal.id, dpPlan: 'edit' }); }}>{plan ? 'กำหนดวันครบกำหนด' : 'ตั้งแผนชำระ'}</button>;
}
/** Under an undated amount: what it comes from ("Forecast 250,000 · รับแล้ว 125,000"). */
function undatedWhy(S: SalesState, l: CashLine) {
  if (l.src === 'rest') {
    const m = dealMoney(S, l.deal);
    return `Forecast ${m0(m.forecast || 0)}${m.actual ? ' · รับแล้ว ' + m0(m.actual) : ''}`;
  }
  if (l.src === 'typed') return 'Actual พิมพ์เอง ไม่มีขั้น PAY ที่ลงวันที่';
  return 'งวดนี้ยังไม่มีวันครบกำหนด';
}

type ListProps = { S: SalesState; lines: CashLine[]; undated: CashLine[]; year: string; mode: 'm' | 'q'; today: string; byDeal: Map<string, CashLine[]> };

/** The year's money on a desktop: month bands (with their parts and sum), a row per amount; the
 *  undated money in its own band after them. A row opens its deal. */
function CashList({ S, lines, undated, year, mode, today, byDeal }: ListProps) {
  const { engine: e, set } = useApp();
  if (!lines.length && !undated.length) return null;
  const open = (l: CashLine) => set({ deal: l.deal.id });
  const name = (l: CashLine) => {
    const c = l.deal.gid != null ? e.company(l.deal.gid) : undefined;
    const tag = crossYearTag(byDeal.get(l.deal.id) || [], year);
    return (
      <span className="cf-nmw">
        <CoAvatar name={c?.name || l.deal.client} web={c?.web} set={c?.set} size={32} />
        <span className="cf-nm">
          <span className="cf-nm-l">
            <button type="button" className="cf-nm-b hv-tx" onClick={(ev) => { ev.stopPropagation(); open(l); }} title={`${l.deal.client} เปิดรายละเอียด`}>{payerName(l, shortName)}</button>
            {tag && <span className="chip cf-tag">{tag}</span>}
          </span>
          <span className="cf-nm-s">{dealSub(l.deal)}</span>
        </span>
      </span>
    );
  };
  const band = (key: string, title: ReactNode, count: string, sum: number, parts: ReactNode) => (
    <Fragment key={'b' + key}>
      <tr className="cf-gap" aria-hidden="true"><td colSpan={6} /></tr>
      <tr className="cf-band">
        <th colSpan={3} scope="rowgroup"><span className="cf-bnw"><span className="sl-sec-name cf-bn">{title}</span><span className="cf-bc">{count}</span></span></th>
        <td colSpan={3}><span className="cf-bwrap">{parts}<span className="cf-bsum">{m0(sum)}</span></span></td>
      </tr>
    </Fragment>
  );
  return (
    <table className="cf-list" aria-label={`รายการเงินเข้าในปี ${year}`}>
      <colgroup><col /><col className="c-inst" /><col className="c-amt" /><col className="c-due" /><col className="c-rcv" /><col className="c-st" /></colgroup>
      <thead>
        <tr><th>ลูกค้า / งาน</th><th>งวด</th><th className="r">ยอด (บาท)</th><th className="c-due">ครบกำหนด</th><th>วันที่รับ</th><th>สถานะ</th></tr>
      </thead>
      <tbody>
        {groupsOf(lines, mode, year).map((g) => (
          <Fragment key={g.key}>
            {band(g.key, g.name, `${fmtN(g.lines.length)} งวด`, g.lines.reduce((a, l) => a + l.amt, 0), <BandParts lines={g.lines} />)}
            {g.lines.map((l) => (
              <tr key={l.id} className="cf-row" onClick={() => open(l)}>
                <td>{name(l)}</td>
                <td><span className="cf-cell"><span>{instText(l)}</span><small>{instSub(l)}</small></span></td>
                <td className="r"><span className="cf-amt">{fmtMoney(l.amt)}</span></td>
                <td className="c-due">{l.due ? dayTh(l.due) : <span className="cf-mute">—</span>}</td>
                <td>{l.rcv ? dayTh(l.rcv) : <span className="cf-mute">—</span>}</td>
                <td><LineStatus l={l} today={today} /></td>
              </tr>
            ))}
          </Fragment>
        ))}
        {undated.length > 0 && (
          <>
            {band('u', 'ยังไม่กำหนดวันรับ', `${fmtN(new Set(undated.map((l) => l.deal.id)).size)} งาน`, undated.reduce((a, l) => a + l.amt, 0), <span className="cf-bs">ไม่อยู่ในยอดปี</span>)}
            {undated.map((l) => (
              <tr key={l.id} className="cf-row" onClick={() => open(l)}>
                <td>{name(l)}</td>
                <td><span className="cf-cell"><span>{instText(l)}</span><small>{instSub(l)}</small></span></td>
                <td className="r"><span className="cf-amt">{fmtMoney(l.amt)}</span></td>
                <td colSpan={2} className="c-due"><span className="cf-cell"><span className="cf-mute">{l.kind === 'got' ? 'ไม่ทราบวันที่รับ' : 'ยังไม่มีวันครบกำหนด'}</span><small>{undatedWhy(S, l)}</small></span></td>
                <td><UndatedAct l={l} /></td>
              </tr>
            ))}
          </>
        )}
      </tbody>
    </table>
  );
}

/** The year's money on a phone: month bands, one short card per amount. */
function CashCards({ S, lines, undated, year, mode, today, byDeal }: ListProps) {
  const { set } = useApp();
  if (!lines.length && !undated.length) return null;
  const item = (l: CashLine, body: ReactNode, extra?: ReactNode) => {
    const tag = crossYearTag(byDeal.get(l.deal.id) || [], year);
    return (
      <div key={l.id} className="cf-mi" onClick={() => set({ deal: l.deal.id })}>
        <div className="cf-mi-1">
          <button type="button" className="cf-nm-b hv-tx" onClick={(ev) => { ev.stopPropagation(); set({ deal: l.deal.id }); }}>{payerName(l, shortName)}</button>
          <span className="cf-amt">{fmtMoney(l.amt)}</span>
        </div>
        <div className="cf-mi-2">{body}</div>
        {(tag || extra) && <div className="cf-mi-2">{tag && <span className="chip">{tag}</span>}{extra}</div>}
      </div>
    );
  };
  return (
    <div className="cf-mcard">
      {groupsOf(lines, mode, year).map((g) => (
        <Fragment key={g.key}>
          <div className="cf-mband">
            <span className="cf-bnw"><span className="sl-sec-name cf-bn">{g.name}</span><span className="cf-bc">{fmtN(g.lines.length)} งวด</span></span>
            <span className="cf-bsum">{m0(g.lines.reduce((a, l) => a + l.amt, 0))}</span>
          </div>
          {g.lines.map((l) => item(l, <><span>{instText(l)} · {l.kind === 'got' ? 'รับ ' + dayTh(l.rcv) : 'ครบกำหนด ' + dayTh(l.due)}</span><LineStatus l={l} today={today} inline /></>))}
        </Fragment>
      ))}
      {undated.length > 0 && (
        <>
          <div className="cf-mband">
            <span className="cf-bnw"><span className="sl-sec-name cf-bn">ยังไม่กำหนดวันรับ</span><span className="cf-bc">{fmtN(new Set(undated.map((l) => l.deal.id)).size)} งาน</span></span>
            <span className="cf-bsum">{m0(undated.reduce((a, l) => a + l.amt, 0))}</span>
          </div>
          {undated.map((l) => item(l, <span>{instText(l)} · {undatedWhy(S, l)}</span>, <UndatedAct l={l} />))}
        </>
      )}
    </div>
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
