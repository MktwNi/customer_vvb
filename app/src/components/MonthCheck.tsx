import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useApp, type UIState } from '../state';
import { daysBetween, dmTh, downloadBlob, fmtN, localDay } from '../lib/format';
import { dealMoney, fmtMoney, type CashLine, type Deal, type SalesState } from '../lib/sales';
import { MONTHS_TH, dayTh, instSub, instText, payerName } from '../lib/cashUi';
import { shortName } from '../lib/salesUi';
import { sameName } from '../lib/caps';
import {
  CHK_F, PREVIEW_HEAD, basisWord, canConfirm, canReclose, canReturn, canTick, canUndo, carriedLate, chipOf, chkCounts, chkFileName, chkMatch, chkSheets, docWord, driftWords, instOf, isSelf, logsByDeal, noteOf,
  sheetPreview, sumRows, sumTotal, waitingElsewhere, yearCheck, ymOf, ymTh, type ChkF, type ChkRow, type MonthRow,
} from '../lib/payCheck';
import { xlsxBlob } from '../lib/xlsx';
import { CoAvatar } from './CoAvatar';
import { DialogActions, Modal } from './Dialog';
import { openDocFile } from './DocAttach';
import { ReadChip } from './FilterBar';
import { Icon } from './icons';
import { Check } from './Pop';
import { Select } from './Select';
import { Status } from './ui';
import { useSalesActs } from './SalesToast';
// money out in the same file (job expenses, for those who see them; components/ExpCash.tsx)
import { X_PREVIEW_HEAD, expSheets, xSheetPreview, type XRow } from '../lib/expenseMoney';

/**
 * The month check for accounting under the Cashflow chart ("ตรวจรับเงิน", cash impl-note "Follow-up: month
 * check", screens 09–17): a month (or the whole year) with its three figures (they add up to its bar), how
 * much accounting has checked, a filter, and every line of money grouped as received / late / to come, each
 * received line with its check. Holders of ตรวจยืนยันรับเงิน tick lines and confirm them, send one back with
 * a note, acknowledge a line cancelled after its check, and close the month in the year table below; everyone
 * else who sees Cashflow reads the same card without the controls. lib/payCheck.ts does the work.
 */

type Show = UIState['slCashShow'];
const m0 = (n: number) => fmtMoney(Math.round(n * 100) / 100) || '0';
const SHOW_WORD: Record<Exclude<Show, ''>, string> = { got: 'รับแล้ว', owed: 'ค้างรับในปีนี้', late: 'เลยกำหนด', undated: 'ยังไม่กำหนดวันรับ' };
/** The KPI card picked above narrows the list (the year's money of that kind). */
const showMatch = (r: ChkRow, show: Show) => (show === 'got' ? r.kind === 'got' : show === 'owed' ? r.kind === 'late' || r.kind === 'owed' : show === 'late' ? r.kind === 'late' : show === 'undated' ? false : true);

/** Open a month (or the year) in the card (with a filter), and bring it into view unless `scroll` is false
 *  (a bar of the chart just above it). */
export function useOpenMonth() {
  const { set } = useApp();
  return (m: number | 'y', f?: ChkF, scroll = true) => {
    set({ slChkM: m, slCashShow: '', ...(f ? { slChkF: f } : {}) });
    if (scroll) requestAnimationFrame(() => document.getElementById('mc-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
}

/** Open another year's whole-year scope with a filter (late money or lines waiting there). */
function useOpenYear() {
  const { set } = useApp();
  return (be: string, f: ChkF) => {
    set({ slYear: be, slChkM: 'y', slChkF: f, slCashShow: '' });
    requestAnimationFrame(() => document.getElementById('mc-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
}

/** "ปิดเดือน": the engine works out the whole month itself (every deal's lines, not the page's filter) and
 *  refuses while any of it is not checked; the message says what was closed. */
function useCloseMonth() {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  return (ym: string) => {
    const v = e.closeMonth(ym);
    acts.say(v ? `ปิดเดือน ${ymTh(ym)} แล้ว · ตรวจแล้ว ${fmtN(v.n)} รายการ${v.amt != null ? ' ' + m0(v.amt) + ' บาท' : ''}` : `ปิด ${ymTh(ym)} ไม่ได้ ยังมีรายการในเดือนนี้ที่ยังไม่ได้ตรวจ`, { ms: 5000 });
  };
}
/** The filter's words on the close: it covers the whole month. */
const CLOSE_ALL = 'ปิดทั้งเดือน รวมรายการที่ไม่อยู่ในตัวกรอง';

/** Whose line it is, for "เปิดงานเพื่อแก้ไข": the recorder (or, unknown, the deal's ผู้รับผิดชอบ). */
const mineToFix = (r: ChkRow, me: string) => !!me && (r.by.some((b) => sameName(b, me)) || sameName(r.deal?.resp, me));

// ------------------------------------------------------------------ small parts

/** The app's own tick box (.ckb, as DoneBox in Plan.tsx): a button with aria-pressed; "mixed" draws a bar. */
export function TickBox({ on, mixed, label, disabled, onClick }: { on: boolean; mixed?: boolean; label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={'ckb mc-cb ' + (on || mixed ? 'hv-dk on' : 'hv')} aria-pressed={mixed ? 'mixed' : on} aria-label={label} disabled={disabled} onClick={(ev) => (ev.stopPropagation(), onClick?.())}>
      {mixed ? (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M6.5 12h11" /></svg>
      ) : on ? (
        <Icon name="check" size={14} />
      ) : null}
    </button>
  );
}

/** Money still owed: เลยกำหนด / ถึงกำหนด as a tinted chip (it needs action now), else รอชำระ and how long. */
export function LineStatus({ l, today, inline }: { l: CashLine; today: string; inline?: boolean }) {
  if (l.kind === 'got') return <Status kind="ok">รับแล้ว</Status>;
  if (l.status === 'late') return <span className="chip bad">เลยกำหนด {fmtN(l.lateDays)} วัน</span>;
  if (l.status === 'due') return <span className="chip warn">{l.date === today ? 'ถึงกำหนดวันนี้' : `ถึงกำหนด ${daysBetween(today, l.date)} วัน`}</span>;
  const left = l.date ? `อีก ${fmtN(daysBetween(today, l.date))} วัน` : '';
  if (inline) return <Status kind="neutral">รอชำระ{left ? ' · ' + left : ''}</Status>;
  return <span className="cf-cell"><Status kind="neutral">รอชำระ</Status>{left && <small>{left}</small>}</span>;
}

/** What undated money still needs: a plan or a due date (to whoever may edit), else said in words. */
function UndatedAct({ l }: { l: CashLine }) {
  const { engine: e, set } = useApp();
  if (l.kind === 'got') return <span className="cf-cell"><Status kind="ok">รับแล้ว</Status><small>ไม่มีวันที่รับ</small></span>;
  const plan = l.src === 'plan';
  if (!e.canDeal('edit.pay', l.deal)) return <span className="cf-mute">{plan ? 'ยังไม่กำหนดวันครบกำหนด' : 'ยังไม่มีแผนชำระ'}</span>;
  return <button type="button" className="lnk" onClick={() => set({ deal: l.deal.id, dpPlan: 'edit' })}>{plan ? 'กำหนดวันครบกำหนด' : 'ตั้งแผนชำระ'}</button>;
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

/** The grey line under a client: its quotation number and หมวด. */
const subOf = (S: SalesState, d: Deal | null) => (d ? [dealMoney(S, d).fcDoc?.docNo, d.section].filter(Boolean).join(' · ') : 'งานนี้ถูกลบแล้ว');
const nameOf = (r: ChkRow) => (r.line ? payerName(r.line, shortName) : r.deal ? shortName(r.deal.client) : 'งานที่ถูกลบ');

// ------------------------------------------------------------------ the card

export function MonthCheck({ S, rows, wide, team, filter: fw, undated, year, scope, show, today, phone, tags, side, outXl }: {
  S: SalesState;
  /** the year's lines through the page's filter */
  rows: ChkRow[];
  /** the same filter over every year: late money carried from December, lines waiting in another year */
  wide: ChkRow[];
  /** the year's lines of every deal: a month is closed (and its banner compared) as a whole */
  team: ChkRow[];
  /** the page's filter in words ('' none) */
  filter: string;
  undated: CashLine[]; year: string; scope: number | 'y'; show: Show; today: string; phone: boolean;
  /** deal id → its cross-year tag ('' none) */ tags?: Map<string, string>;
  /** the switch เงินเข้า / เงินออก (those who see job expenses), under the title */ side?: ReactNode;
  /** the money out of the same scope for the Excel file's out sheets */ outXl?: OutXl;
}) {
  const { engine: e, ui, set } = useApp();
  const acts = useSalesActs();
  const open = useOpenMonth();
  const openYear = useOpenYear();
  const closeMonth = useCloseMonth();
  const me = e.me();
  const checker = e.can('pay.check');
  const block = e.payCheckBlock();
  const ce = +year - 543;
  const y = show ? 'y' : scope;
  const ym = y === 'y' ? '' : ymOf(ce, y);
  const inScope = ym ? rows.filter((r) => r.ym === ym) : rows;
  const sum = sumRows(inScope);
  const base = show ? inScope.filter((r) => showMatch(r, show)) : inScope;
  const counts = chkCounts(base);
  const f: ChkF = ui.slChkF;
  const list = base.filter((r) => chkMatch(r, f));
  const logs = logsByDeal(S);
  const closes = e.monthCloses();
  const close = ym ? closes[ym] || null : null;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ret, setRet] = useState<ChkRow | null>(null);
  const [xl, setXl] = useState(false);
  useEffect(() => setSel(new Set()), [y, f, show, year]);
  const tickable = checker && !block ? list.filter((r) => canTick(r, me)) : [];
  const picked = tickable.filter((r) => sel.has(r.key));
  const toggle = (k: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const allOn = tickable.length > 0 && picked.length === tickable.length;
  const check = (rs: ChkRow[]) => {
    const keys = e.checkPays(rs);
    if (!keys.length) return;
    const amt = rs.filter((r) => keys.includes(r.key)).reduce((a, r) => a + r.amt, 0);
    setSel(new Set());
    acts.say(`ตรวจแล้ว ${fmtN(keys.length)} รายการ · ${m0(amt)} บาท`, { acts: [{ label: 'เลิกทำ', act: 'payUndo' }], ms: 12000 });
  };
  const undo = (r: ChkRow) => {
    const n = e.undoPayChecks([r.key]);
    acts.say(n ? `เลิกทำแล้ว ${r.deal ? shortName(r.deal.client) : ''} กลับเป็น “รอตรวจ”` : 'เลิกทำได้ภายใน 10 นาทีหลังตรวจ และเฉพาะรายการที่คุณตรวจเอง', { ms: 4000 });
  };
  const yearMonths = yearCheck(rows, ce, closes, today, team).months;
  const monthRow = ym ? yearMonths.find((m) => m.ym === ym)! : null;
  // closing is the whole month's (every deal's lines), whatever the page's filter shows
  const canCloseNow = !!monthRow && monthRow.state === 'can' && checker && !block;
  const whole = monthRow ? monthRow.team : sum;

  const title = ym ? `ตรวจรับเงิน · ${ymTh(ym)}` : `ตรวจรับเงิน · ทั้งปี ${year}`;
  const n = sum.gotN + sum.lateN + sum.owedN;
  const sub = `${fmtN(n)} รายการ · รวม ${m0(sumTotal(sum))} บาท · ${ym ? `เท่ากับแท่ง ${ymTh(ym, true).split(' ')[0]} ในกราฟ` : 'เท่ากับการ์ดเงินเข้าทั้งปี'}`;
  const monthOpts = [
    { v: 'y', label: `ทั้งปี ${year}`, n: fmtN(rows.filter((r) => r.kind !== 'orphan').length) + ' รายการ' },
    ...MONTH_IDX.map((i) => {
      const c = sumRows(rows.filter((r) => r.ym === ymOf(ce, i)));
      const w = c.wait + c.changed;
      return { v: String(i), label: ymTh(ymOf(ce, i)), sub: c.got || c.owed || c.late ? `เข้าแล้ว ${m0(c.got)}${w ? ` · รอตรวจ ${w}` : ''}` : 'ไม่มีเงินเข้า', n: c.gotN + c.lateN + c.owedN ? fmtN(c.gotN + c.lateN + c.owedN) : '' };
    }),
  ];
  const monthPick = (
    <Select
      variant="tool"
      prefix="เดือน"
      label="เดือนที่ตรวจ"
      value={y === 'y' ? 'y' : String(y)}
      shown={ym ? ymTh(ym) : `ทั้งปี ${year}`}
      search={false}
      width={300}
      className={phone ? 'mc-ph-sel' : undefined}
      options={monthOpts}
      onChange={(v) => open(v === 'y' ? 'y' : +v)}
    />
  );
  const xlBtn = <button type="button" className={'btn ' + (phone ? 'sm mc-ph-x' : 'sm')} onClick={() => setXl(true)}>{ym ? 'ดาวน์โหลด Excel เดือนนี้' : 'ดาวน์โหลด Excel ทั้งปี'}</button>;
  const closeBtn = canCloseNow && (
    <button type="button" className="btn sm" title={fw ? CLOSE_ALL : undefined} onClick={() => closeMonth(ym)}>ปิดเดือน</button>
  );

  // the three figures (they add up to the bar)
  // other years' links ("ดูปี 2568"): this year's lines open in the year scope, an earlier year's in its own
  const yearLinks = (ys: { be: string; n: number }[], f: ChkF) =>
    ys.filter((x) => x.be !== year).map((x) => <Fragment key={x.be}> · <button type="button" className="lnk" onClick={() => openYear(x.be, f)}>ดูปี {x.be}</button></Fragment>);
  const carried = ym ? carriedLate(wide, ym) : { n: 0, amt: 0, years: [] };
  const carriedWords = `ค้างจากเดือนก่อน ${fmtN(carried.n)} รายการ · ${m0(carried.amt)} บาท`;
  const carriedTxt = carried.n ? (
    <>
      {carried.years.some((x) => x.be === year) ? <button type="button" className="lnk" onClick={() => open('y', 'late')}>{carriedWords}</button> : carriedWords}
      {yearLinks(carried.years, 'late')}
    </>
  ) : 'ไม่มียอดค้างจากเดือนก่อน';
  const nm = ym ? 'เดือนนี้' : 'ทั้งปี';
  const dues = ym && sum.dues.length ? ' · ครบกำหนด ' + sum.dues.map((d) => String(+d.slice(8, 10))).join(' และ ') + ' ' + ymTh(ym, true).split(' ')[0] : '';
  const figs = (
    <div className="mc-figs">
      <div className="mc-fig">
        <span className="mc-fig-l">เข้าแล้ว{nm}</span>
        <span className={'mc-fig-v' + (sum.got ? '' : ' zero')}>{m0(sum.got)}<small>บาท</small></span>
        <span className="mc-fig-f">{sum.gotN ? `${fmtN(sum.gotN)} รายการ · ล่าสุด ${dmTh(sum.lastGot)}` : 'ยังไม่มีเงินเข้า'}</span>
      </div>
      <div className="mc-fig">
        <span className="mc-fig-l">รอรับ{nm}</span>
        <span className={'mc-fig-v' + (sum.owed ? '' : ' zero')}>{m0(sum.owed)}<small>บาท</small></span>
        <span className="mc-fig-f">{sum.owedN ? `${fmtN(sum.owedN)} รายการ · ลูกค้ายังไม่จ่าย${dues}` : 'ไม่มีรายการรอรับ'}</span>
      </div>
      <div className="mc-fig">
        <span className="mc-fig-l">เลยกำหนด</span>
        <span className={'mc-fig-v' + (sum.late ? ' bad' : ' zero')}>{m0(sum.late)}<small>บาท</small></span>
        <span className="mc-fig-f">
          {sum.lateN ? `${fmtN(sum.lateN)} รายการ · ครบกำหนด ${dmTh(sum.firstLate)}` : 'ไม่มีรายการเลยกำหนด'}
          {ym && <> · {carriedTxt}</>}
        </span>
      </div>
    </div>
  );

  // the closed month's banner: the whole month against the close record (not the filter's share of it): a
  // line to check again, cancelled, or moved to another month, or a checked sum that is not the close's
  const drift = close && monthRow ? monthRow.drift : null;
  const k = drift ? drift.redo + drift.orphans + drift.moved : 0;
  const driftParts = drift
    ? [
        drift.redo ? `กลับเป็น “รอตรวจ” ต้องตรวจใหม่${k !== drift.redo ? ` ${fmtN(drift.redo)} รายการ` : ''}` : '',
        drift.moved ? `ย้ายไปเดือนอื่น ${fmtN(drift.moved)} รายการ รอตรวจในเดือนใหม่` : '',
        drift.orphans ? `ยกเลิกหลังตรวจ ${fmtN(drift.orphans)} รายการ รอรับทราบ` : '',
      ].filter(Boolean)
    : [];
  // every line of it checked again: closed again with what it holds now
  const reclose = checker && !block && canReclose(whole, ym, drift, today);
  const banner = close && (
    <div className="mc-closed">
      <span className="mc-closed-1">
        <b>ปิดเดือนแล้ว</b>
        <span>{close.by || 'บัญชี'} · {dayTh(localDay(close.at))} · ตอนปิด ตรวจแล้วครบ {fmtN(close.n)} รายการ{close.amt != null ? ` ${m0(close.amt)} บาท` : ''}</span>
        {checker && !block && <><span className="sp" /><button type="button" className="lnk" onClick={() => (e.reopenMonth(ym), acts.say(`เปิดเดือน ${ymTh(ym)} อีกครั้งแล้ว`))}>เปิดเดือนอีกครั้ง</button></>}
      </span>
      {drift?.flagged && (
        <span>
          {k ? <>มีรายการเปลี่ยนหลังปิดเดือน <b>{fmtN(k)} รายการ</b> {driftParts.join(' · ')}</> : <>ยอดที่ตรวจแล้วเปลี่ยนจากตอนปิด · ตรวจแล้วตอนนี้ <b>{fmtN(whole.ok)} รายการ</b> ตอนปิด {fmtN(close.n)} รายการ</>}
          {' '}· ยอดเข้าเดือนนี้{fw ? 'ทั้งเดือน' : ''}ตอนนี้ {m0(whole.got)} บาท {close.amt == null ? '' : Math.abs(close.amt - whole.got) < 0.005 ? 'เท่ากับตอนปิด' : `ตอนปิด ${m0(close.amt)} บาท`}
          {reclose && <> · <button type="button" className="lnk" onClick={() => closeMonth(ym)}>ปิดเดือนอีกครั้งด้วยยอดนี้</button></>}
        </span>
      )}
    </div>
  );

  // how far accounting has got
  const pct = sum.amt ? Math.min(100, Math.round((sum.okAmt / sum.amt) * 100)) : 0;
  const elsewhere = ym ? waitingElsewhere(wide, ym) : { n: 0, months: [], years: [], words: '' };
  const elseWords = `รอตรวจในเดือนอื่น ${fmtN(elsewhere.n)} รายการ · ${elsewhere.words}`;
  // with a filter: what of the month outside it still stops the close
  const outside = fw && ym && !close ? whole.n - whole.ok + whole.orphans - (sum.n - sum.ok + sum.orphans) : 0;
  const none = inScope.some((r) => r.kind === 'got' && r.state === 'none');
  const roNote = !checker ? 'ฝ่ายบัญชีเป็นผู้ตรวจ · คุณดูสถานะได้อย่างเดียว' : block === 'name' ? 'ใส่ชื่อของคุณที่แท็บอัปเดตข้อมูลก่อน จึงจะตรวจได้' : '';
  const prog = (
    <div className="mc-prog">
      {sum.n ? (
        <>
          <span className="mc-prog-t">บัญชีตรวจแล้ว <b>{fmtN(sum.ok)} จาก {fmtN(sum.n)} รายการ</b> · <span className="mc-nw">{m0(sum.okAmt)} จาก {m0(sum.amt)} บาท</span></span>
          <span className="mc-pb" role="img" aria-label={`บัญชีตรวจแล้ว ${pct}% ของเงินที่เข้า`}><i style={{ width: pct + '%' }} /></span>
        </>
      ) : (
        <span className="mc-prog-t">{sum.gotN ? 'เงินเข้าในช่วงนี้อยู่ก่อนเดือนที่เริ่มตรวจ ไม่ต้องตรวจ' : `ยังไม่มีเงินเข้าให้ตรวจ${ym ? 'ในเดือนนี้' : 'ในปีนี้'}`}</span>
      )}
      <span className="mc-prog-r">
        {sum.wait + sum.changed > 0 && <span>รอตรวจ {fmtN(sum.wait + sum.changed)} รายการ</span>}
        {sum.back > 0 && <span>ส่งกลับแก้ไข {fmtN(sum.back)} รายการ</span>}
        {sum.orphans > 0 && <span>ยกเลิกหลังตรวจ {fmtN(sum.orphans)} รายการ</span>}
        {elsewhere.n > 0 && (
          <span>
            {elsewhere.years.some((x) => x.be === year) ? <button type="button" className="lnk" onClick={() => open('y', 'wait')}>{elseWords}</button> : elseWords}
            {yearLinks(elsewhere.years, 'wait')}
          </span>
        )}
        {outside > 0 && <span>นอกตัวกรองยังไม่ได้ตรวจ {fmtN(outside)} รายการ · ปิดเดือนได้เมื่อตรวจครบทั้งเดือน</span>}
        {roNote && <span className="mc-ro">{roNote}</span>}
      </span>
      <span className="mc-prog-n">
        บัญชีตรวจเฉพาะเงินที่รับแล้ว เทียบกับบัญชีธนาคารและหลักฐาน · ยอดรอรับและเลยกำหนดจะเข้ามาให้ตรวจเมื่อมีคนบันทึกรับเงิน
        {none && ` · เงินที่รับก่อน ${ymTh(e.payChkCfg().since.slice(0, 7))} ไม่ต้องตรวจ`}
      </span>
    </div>
  );

  const filter = phone ? (
    <div className="mc-ph-row">
      <Select
        variant="tool"
        prefix="แสดง"
        label="แสดงรายการ"
        value={f}
        shown={`${CHK_F.find((x) => x.id === f)!.label} · ${fmtN(counts[f])} รายการ`}
        search={false}
        className="mc-ph-sel"
        options={CHK_F.map((x) => ({ v: x.id, label: x.label, n: fmtN(counts[x.id]) }))}
        onChange={(v) => set({ slChkF: v as ChkF })}
      />
    </div>
  ) : (
    <div className="mc-tools">
      <div className="seg sl-seg" role="group" aria-label="แสดงรายการ">
        {CHK_F.map((x) => (
          <button key={x.id} type="button" aria-pressed={f === x.id} onClick={() => set({ slChkF: x.id })}>
            {x.label}<span className={'n' + (x.id === 'late' && counts.late ? ' od' : '')}>{fmtN(counts[x.id])}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const bulk = picked.length > 0 && (
    <div className="mc-bulk" role="region" aria-label="รายการที่เลือก">
      <span className="mc-bulk-t">เลือก <b>{fmtN(picked.length)} รายการ</b> · {m0(picked.reduce((a, r) => a + r.amt, 0))} บาท</span>
      <span className="sp" />
      <button type="button" className="quiet" onClick={() => setSel(new Set())}>ล้างที่เลือก</button>
      <button type="button" className="btn pri sm" onClick={() => check(picked)}>ตรวจทั้งหมดที่เลือก</button>
    </div>
  );

  // the groups: a month's received / late / to come (and lines cancelled after their check); the year's months
  const groups: { key: string; name: string; rows: ChkRow[]; right: ReactNode }[] = [];
  if (ym) {
    const got = list.filter((r) => r.kind === 'got');
    const c = sumRows(got);
    groups.push({ key: 'got', name: 'เงินเข้าแล้ว', rows: got, right: [c.ok ? `ตรวจแล้ว ${c.ok}` : '', c.wait + c.changed ? `รอตรวจ ${c.wait + c.changed}` : '', c.back ? `ส่งกลับแก้ไข ${c.back}` : ''].filter(Boolean).join(' · ') });
    groups.push({ key: 'late', name: 'เลยกำหนด', rows: list.filter((r) => r.kind === 'late'), right: 'ยังไม่ได้รับ' });
    groups.push({ key: 'owed', name: 'รอรับ', rows: list.filter((r) => r.kind === 'owed'), right: 'ลูกค้ายังไม่จ่าย' });
    groups.push({ key: 'orphan', name: 'ยกเลิกหลังตรวจ', rows: list.filter((r) => r.kind === 'orphan'), right: 'ไม่นับในยอด' });
  } else
    MONTH_IDX.forEach((i) => {
      const rs = list.filter((r) => r.ym === ymOf(ce, i));
      if (rs.length) groups.push({ key: 'm' + i, name: ymTh(ymOf(ce, i)), rows: rs, right: '' });
    });
  const shownGroups = groups.filter((g) => g.rows.length);
  const und = !ym && f === 'all' && (show === '' || show === 'undated') ? undated : [];
  // a band's money; the band of lines cancelled after their check shows what was checked (not counted)
  const sumOf = (g: { key: string; rows: ChkRow[] }) => g.rows.filter((r) => (g.key === 'orphan') === (r.kind === 'orphan')).reduce((a, r) => a + r.amt, 0);

  const ctl = { me, checker: checker && !block, logs, tag: (id: string) => tags?.get(id) || '', tickOn: (r: ChkRow) => sel.has(r.key), toggle, check, undo, ret: setRet, ack: (r: ChkRow) => (e.ackPayOrphan(r), acts.say('รับทราบแล้ว นำรายการออกแล้ว', { ms: 3000 })) };
  const empty = !shownGroups.length && !und.length;

  return (
    <section className={'cf-card mc-card' + (phone ? ' mc-ph' : '')} id="mc-card" aria-labelledby="mc-t">
      <div className="cf-h">
        <div>
          <h3 className="cf-t" id="mc-t">{title}</h3>
          <span className="cf-s">{sub}</span>
        </div>
        {!phone && <div className="mc-tools-r">{monthPick}{closeBtn}{xlBtn}</div>}
      </div>
      {side}
      {phone && <div className="mc-ph-row">{monthPick}</div>}
      {figs}
      {banner}
      {prog}
      {filter}
      {show && (
        <div className="cf-show">
          <ReadChip text={`แสดงเฉพาะ${SHOW_WORD[show]} · ทั้งปี ${year}`} onClear={() => set({ slCashShow: '' })} />
        </div>
      )}
      {bulk}
      {phone ? (
        <PhoneList S={S} groups={shownGroups} sumOf={sumOf} undated={und} today={today} ctl={ctl} />
      ) : (
        !empty && (
          <table className={'cf-list mc-list' + (ctl.checker ? '' : ' ro')} aria-label={title}>
            <colgroup><col className="c-cb" /><col /><col className="c-inst" /><col className="c-amt" /><col className="c-date" /><col className="c-ev" /><col className="c-st" /></colgroup>
            <thead>
              <tr>
                <th className="mc-cbc">{ctl.checker && <TickBox on={allOn} mixed={picked.length > 0 && !allOn} disabled={!tickable.length} label="เลือกทุกรายการที่รอตรวจ" onClick={() => setSel(allOn ? new Set() : new Set(tickable.map((r) => r.key)))} />}</th>
                <th>ลูกค้า / งาน</th><th>งวด</th><th className="r">ยอด (บาท)</th><th className="mc-dt">วันที่</th><th>หลักฐาน</th><th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {shownGroups.map((g) => (
                <Fragment key={g.key}>
                  <Band name={g.name} count={`${fmtN(g.rows.length)} รายการ`} sum={sumOf(g)} right={g.right} />
                  {g.rows.map((r) => <Row key={r.key} S={S} r={r} today={today} ctl={ctl} />)}
                </Fragment>
              ))}
              {und.length > 0 && (
                <>
                  <Band name="ยังไม่กำหนดวันรับ" count={`${fmtN(new Set(und.map((l) => l.deal.id)).size)} งาน`} sum={und.reduce((a, l) => a + l.amt, 0)} right="ไม่อยู่ในยอดปี" />
                  {und.map((l) => <UndatedRow key={l.id} S={S} l={l} />)}
                </>
              )}
            </tbody>
          </table>
        )
      )}
      {empty && <div className="cf-empty">{base.length ? 'ไม่มีรายการตามที่เลือก' : ym ? `${ymTh(ym)} ไม่มีเงินเข้าและไม่มีงวดที่ครบกำหนด` : `ยังไม่มีงวดเงินในปี ${year} · งานที่ได้งานแล้วและมีแผนชำระจะแสดงที่นี่`}</div>}
      {phone && <div className="mc-ph-row">{closeBtn}{xlBtn}</div>}
      {ret && <ReturnDialog S={S} r={ret} onClose={() => setRet(null)} />}
      {xl && <ExcelDialog S={S} rows={inScope} months={ym ? [monthRow!] : yearMonths} ym={ym || null} ce={ce} year={year} filter={fw} out={outXl?.(ym || null)} onClose={() => setXl(false)} />}
    </section>
  );
}
const MONTH_IDX = Array.from({ length: 12 }, (_, i) => i);

interface Ctl {
  me: string;
  /** a deal's cross-year tag */
  tag: (dealId: string) => string;
  /** may check (holds the capability and has a name) */
  checker: boolean;
  logs: ReturnType<typeof logsByDeal>;
  tickOn: (r: ChkRow) => boolean;
  toggle: (k: string) => void;
  check: (rs: ChkRow[]) => void;
  undo: (r: ChkRow) => void;
  ret: (r: ChkRow) => void;
  ack: (r: ChkRow) => void;
}

export function Band({ name, count, sum, right }: { name: string; count: string; sum: number; right: ReactNode }) {
  return (
    <>
      <tr className="cf-gap" aria-hidden="true"><td colSpan={7} /></tr>
      <tr className="cf-band">
        <th colSpan={4} scope="rowgroup"><span className="cf-bnw"><span className="sl-sec-name cf-bn">{name}</span><span className="cf-bc">{count}</span></span></th>
        <td colSpan={3}><span className="cf-bwrap">{right && <span className="cf-bs">{right}</span>}<span className="cf-bsum">{m0(sum)}</span></span></td>
      </tr>
    </>
  );
}

/** The status of a line: its check (received), its money status (owed), or "ยกเลิกหลังตรวจ"; the controls. */
function StatusCell({ r, today, ctl }: { r: ChkRow; today: string; ctl: Ctl }) {
  if (r.kind === 'late' || r.kind === 'owed') return <LineStatus l={r.line!} today={today} />;
  const c = chipOf(r);
  if (!c) return <span className="cf-mute">ก่อนเริ่มตรวจ</span>;
  const self = isSelf(r, ctl.me);
  const acts: ReactNode[] = [];
  if (ctl.checker) {
    if (r.kind === 'orphan') acts.push(<button key="a" type="button" className="btn xs" onClick={() => ctl.ack(r)}>รับทราบ</button>);
    else {
      if (canConfirm(r, ctl.me)) acts.push(<button key="c" type="button" className="btn xs" onClick={() => ctl.check([r])}>ตรวจแล้ว</button>);
      if (canReturn(r, ctl.me)) acts.push(<button key="r" type="button" className="lnk" onClick={() => ctl.ret(r)}>ส่งกลับแก้ไข</button>);
      if (r.state === 'ok' && canUndo(r.rec, ctl.me, Date.now())) acts.push(<button key="u" type="button" className="lnk" onClick={() => ctl.undo(r)}>เลิกทำ</button>);
    }
  }
  return (
    <span className="mc-st">
      <span className="mc-chk"><span className={c.cls}>{c.word}</span>{c.meta && <span className="mc-meta">{c.meta}</span>}</span>
      {acts.length > 0 && <span className="mc-acts">{acts}</span>}
      {ctl.checker && self && r.kind === 'got' && r.state !== 'ok' && r.state !== 'none' && <span className="mc-meta">คุณบันทึกเอง ให้คนอื่นตรวจ</span>}
    </span>
  );
}

/** The evidence: the document (opens its file), or "ไม่มีไฟล์"; money still owed has none. */
function Evidence({ r, short }: { r: ChkRow; short?: boolean }) {
  const { engine: e } = useApp();
  if (r.kind !== 'got') return <span className="cf-mute">—</span>;
  if (!r.docs.length) return <span className="mc-ev"><span className="cf-mute">ไม่มีไฟล์</span></span>;
  const doc = r.docs[0];
  const word = docWord(doc) + (r.docs.length > 1 ? ` และอีก ${r.docs.length - 1}` : '');
  return (
    <span className="mc-ev">
      {e.can('docs.open') ? <button type="button" className="lnk" title="เปิดไฟล์" onClick={() => void openDocFile(e, doc).catch(() => {})}>{word}</button> : <span>{word}</span>}
      {!short && doc.docDate && <small>ลงวันที่ {dmTh(doc.docDate)}</small>}
    </span>
  );
}

function Row({ S, r, today, ctl }: { S: SalesState; r: ChkRow; today: string; ctl: Ctl }) {
  const { set } = useApp();
  const note = noteOf(S, r, ctl.logs);
  const tick = ctl.checker && canTick(r, ctl.me);
  const on = tick && ctl.tickOn(r);
  const inst = instOf(r, S);
  const openDeal = () => r.deal && set({ deal: r.deal.id });
  const got = r.kind === 'got' || r.kind === 'orphan';
  return (
    <>
      <tr className={'cf-row' + (on ? ' mc-sel' : '') + (r.kind === 'orphan' ? ' mc-orph' : '')}>
        <td className="mc-cbc">{tick && <TickBox on={on} label={`เลือก ${nameOf(r)} ${m0(r.amt)} บาท`} onClick={() => ctl.toggle(r.key)} />}</td>
        <td><NameCell S={S} r={r} onOpen={openDeal} tag={ctl.tag(r.dealId)} /></td>
        <td><span className="cf-cell"><span>{inst.text}</span><small>{inst.sub}</small></span></td>
        <td className="r"><span className="cf-cell mc-amt"><span className="cf-amt">{m0(r.amt)}</span><small>{r.kind === 'orphan' ? 'ตอนตรวจ' : basisWord(r)}</small></span></td>
        <td className="mc-dt">
          {got ? (
            <span className="cf-cell"><span>รับ {dayTh(r.date)}</span><small>{r.kind === 'orphan' ? 'ยกเลิกการรับแล้ว' : 'บันทึกโดย ' + (r.by.join(', ') || 'ไม่ระบุ')}</small></span>
          ) : (
            <span className="cf-cell"><span>ครบกำหนด {dmTh(r.date)}</span><small>ผู้รับผิดชอบ {r.deal?.resp || 'ไม่ระบุ'}</small></span>
          )}
        </td>
        <td><Evidence r={r} /></td>
        <td><StatusCell r={r} today={today} ctl={ctl} /></td>
      </tr>
      {note && (
        <tr className={'mc-note' + (on ? ' mc-sel' : '')}>
          <td />
          <td colSpan={6}><NoteBox note={note} r={r} ctl={ctl} /></td>
        </tr>
      )}
    </>
  );
}

function NameCell({ S, r, onOpen, tag }: { S: SalesState; r: ChkRow; onOpen: () => void; tag: string }) {
  const { engine: e } = useApp();
  const c = r.deal && r.deal.gid != null ? e.company(r.deal.gid) : undefined;
  return (
    <span className="cf-nmw">
      <CoAvatar name={c?.name || r.deal?.client || 'งาน'} web={c?.web} set={c?.set} size={32} />
      <span className="cf-nm">
        <span className="cf-nm-l">
          {r.deal ? (
            <button type="button" className="cf-nm-b hv-tx co-name dense" onClick={onOpen} title={`${nameOf(r)} · ${r.deal.client} เปิดรายละเอียด`}>{nameOf(r)}</button>
          ) : (
            <span className="cf-nm-b co-name dense">{nameOf(r)}</span>
          )}
        </span>
        {/* the cross-year chip on the second line: the name (a joint quotation's "มจพ · ใบเสนอราคาร่วม 4 บริษัท")
            keeps the first line whole at 1366 */}
        <span className="cf-nm-s">{tag && <span className="chip cf-tag" title={tag}>{tag}</span>}{subOf(S, r.deal)}</span>
      </span>
    </span>
  );
}

function NoteBox({ note, r, ctl }: { note: { head: string; body: string; to: string }; r: ChkRow; ctl: Ctl }) {
  const { set } = useApp();
  // a returned line, read by whoever recorded it (or is responsible for the deal): open it to fix
  const fix = r.state === 'back' && r.kind === 'got' && !ctl.checker && r.deal && mineToFix(r, ctl.me);
  return (
    <div className="mc-nbox">
      <span className="mc-nh">{note.head}</span>
      {note.body && <p>{note.body}</p>}
      {fix && <button type="button" className="lnk" onClick={() => set({ deal: r.deal!.id })}>เปิดงานเพื่อแก้ไข</button>}
    </div>
  );
}

function UndatedRow({ S, l }: { S: SalesState; l: CashLine }) {
  const { engine: e, set } = useApp();
  const c = l.deal.gid != null ? e.company(l.deal.gid) : undefined;
  return (
    <tr className="cf-row">
      <td className="mc-cbc" />
      <td>
        <span className="cf-nmw">
          <CoAvatar name={c?.name || l.deal.client} web={c?.web} set={c?.set} size={32} />
          <span className="cf-nm">
            <span className="cf-nm-l"><button type="button" className="cf-nm-b hv-tx co-name dense" onClick={() => set({ deal: l.deal.id })} title={l.deal.client}>{payerName(l, shortName)}</button></span>
            <span className="cf-nm-s">{subOf(S, l.deal)}</span>
          </span>
        </span>
      </td>
      <td><span className="cf-cell"><span>{instText(l)}</span><small>{instSub(l)}</small></span></td>
      <td className="r"><span className="cf-amt">{m0(l.amt)}</span></td>
      <td colSpan={2} className="mc-dt"><span className="cf-cell"><span className="cf-mute">{l.kind === 'got' ? 'ไม่ทราบวันที่รับ' : 'ยังไม่มีวันครบกำหนด'}</span><small>{undatedWhy(S, l)}</small></span></td>
      <td><UndatedAct l={l} /></td>
    </tr>
  );
}

/** The card's list on a phone: bands, one short card per line with the same chips and notes. */
function PhoneList({ S, groups, sumOf, undated, today, ctl }: { S: SalesState; groups: { key: string; name: string; rows: ChkRow[] }[]; sumOf: (g: { key: string; rows: ChkRow[] }) => number; undated: CashLine[]; today: string; ctl: Ctl }) {
  const { set } = useApp();
  if (!groups.length && !undated.length) return null;
  return (
    <div className="mc-phl">
      {groups.map((g) => (
        <Fragment key={g.key}>
          <div className="cf-mband">
            <span className="cf-bnw"><span className="sl-sec-name cf-bn">{g.name}</span><span className="cf-bc">{fmtN(g.rows.length)} รายการ</span></span>
            <span className="cf-bsum">{m0(sumOf(g))}</span>
          </div>
          {g.rows.map((r) => {
            const note = noteOf(S, r, ctl.logs);
            const inst = instOf(r, S);
            const got = r.kind === 'got' || r.kind === 'orphan';
            return (
              <div key={r.key} className="mc-mi">
                <div className="cf-mi-1">
                  {r.deal ? <button type="button" className="cf-nm-b hv-tx co-name dense" onClick={() => set({ deal: r.deal!.id })} title={r.deal.client}>{nameOf(r)}</button> : <span className="cf-nm-b co-name dense">{nameOf(r)}</span>}
                  <span className="cf-amt">{m0(r.amt)}</span>
                </div>
                <div className="cf-mi-2"><span>{inst.text} · {got ? `รับ ${dmTh(r.date)}` : `ครบกำหนด ${dmTh(r.date)}`}{r.kind === 'got' && r.by.length ? ` · บันทึกโดย ${r.by.join(', ')}` : ''}</span></div>
                {r.kind === 'got' && <div className="cf-mi-2"><span>หลักฐาน</span><Evidence r={r} short /><span>· {basisWord(r)}</span></div>}
                {ctl.tag(r.dealId) && <div className="cf-mi-2"><span className="chip">{ctl.tag(r.dealId)}</span></div>}
                <div className="cf-mi-2">{r.kind === 'late' || r.kind === 'owed' ? <LineStatus l={r.line!} today={today} inline /> : <StatusCell r={r} today={today} ctl={ctl} />}</div>
                {note && <NoteBox note={note} r={r} ctl={ctl} />}
              </div>
            );
          })}
        </Fragment>
      ))}
      {undated.length > 0 && (
        <>
          <div className="cf-mband">
            <span className="cf-bnw"><span className="sl-sec-name cf-bn">ยังไม่กำหนดวันรับ</span><span className="cf-bc">{fmtN(new Set(undated.map((l) => l.deal.id)).size)} งาน</span></span>
            <span className="cf-bsum">{m0(undated.reduce((a, l) => a + l.amt, 0))}</span>
          </div>
          {undated.map((l) => (
            <div key={l.id} className="mc-mi">
              <div className="cf-mi-1"><button type="button" className="cf-nm-b hv-tx co-name dense" onClick={() => set({ deal: l.deal.id })} title={l.deal.client}>{payerName(l, shortName)}</button><span className="cf-amt">{m0(l.amt)}</span></div>
              <div className="cf-mi-2"><span>{instText(l)} · {undatedWhy(S, l)}</span></div>
              <div className="cf-mi-2"><UndatedAct l={l} /></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ dialogs

/** "ส่งกลับแก้ไข": the line's facts and a note (required) to whoever recorded it. */
function ReturnDialog({ S, r, onClose }: { S: SalesState; r: ChkRow; onClose: () => void }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const [note, setNote] = useState('');
  const to = r.by[0] || r.deal?.resp || 'คนที่บันทึก';
  const d = r.deal!;
  const inst = instOf(r, S);
  const send = () => {
    if (!note.trim()) return;
    if (e.returnPay(r, note)) acts.say(`ส่งกลับให้ ${to} แก้ไขแล้ว`, { ms: 4000 });
    onClose();
  };
  return (
    <Modal title={`ส่งกลับแก้ไข · ${shortName(d.client)}`} onClose={onClose} width={600} focus="field">
      <dl className="mc-dl">
        <dt>งาน</dt>
        <dd><span>{d.client}</span><small>{[subOf(S, d), d.resp ? 'ผู้รับผิดชอบ ' + d.resp : ''].filter(Boolean).join(' · ')}</small></dd>
        <dt>ยอด</dt>
        <dd><span>{m0(r.amt)} บาท</span><small>{basisWord(r)} · {inst.text} ({inst.sub})</small></dd>
        <dt>วันที่รับ</dt>
        <dd><span>{dayTh(r.date)}</span><small>บันทึกโดย {r.by.join(', ') || 'ไม่ระบุ'}</small></dd>
        <dt>หลักฐาน</dt>
        <dd><span>{r.docs.length ? r.docs.map(docWord).join(', ') : `ไม่มีไฟล์${r.line?.src === 'typed' ? ' · พิมพ์ยอดเอง' : ''}`}</span></dd>
      </dl>
      <label className="mc-ret">
        บอก {to} ว่าต้องแก้อะไร
        <textarea rows={3} value={note} maxLength={300} onChange={(ev) => setNote(ev.target.value)} placeholder="เช่น ยอดเข้าบัญชีธนาคารไม่ตรง ช่วยแนบใบเสร็จหรือสลิปโอน" data-autofocus="" />
        <small>{to} จะเห็นข้อความนี้ที่งานนี้และในหน้า Cashflow · ระหว่างรอแก้ ยอดนี้ยังนับเป็นเงินเข้าตามเดิม</small>
      </label>
      <DialogActions>
        <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn pri" disabled={!note.trim()} onClick={send}>ส่งกลับให้ {to} แก้ไข</button>
      </DialogActions>
    </Modal>
  );
}

/** The money out of a scope (a month, or the year: ym null) for the file's out sheets. */
export type OutXl = (ym: string | null) => { rows: XRow[]; months: MonthRow[] } | null;
/** "ดาวน์โหลด Excel": two sheets (รายการ, สรุป), the money still to come optional, a preview; with `out` (those
 *  who see job expenses) two more, เงินออก and สรุปเงินออก (lib/expenseMoney expSheets). */
export function ExcelDialog({ S, rows, months, ym, ce, year, filter, out, outFirst, onClose }: { S: SalesState; rows: ChkRow[]; months: MonthRow[]; ym: string | null; ce: number; year: string; /** the page's filter in words ('' none) */ filter: string; out?: { rows: XRow[]; months: MonthRow[] } | null; /** opened from the out side: its sheet previewed */ outFirst?: boolean; onClose: () => void }) {
  const [owed, setOwed] = useState(true);
  const [busy, setBusy] = useState('');
  const sheets = [...chkSheets(S, rows, months, owed, filter), ...(out ? expSheets(out.rows, out.months, owed, (d) => dealMoney(S, d).fcDoc?.docNo || '', months, filter) : [])];
  const ls = sheets[0];
  const got = rows.filter((r) => r.kind === 'got');
  const toCome = rows.filter((r) => r.kind === 'late' || r.kind === 'owed');
  // the bills not paid yet go with the money still to come (one choice for the file)
  const unpaid = out ? out.rows.filter((r) => r.kind === 'owed') : [];
  const orphans = rows.filter((r) => r.kind === 'orphan').length;
  const c = sumRows(rows);
  // the preview: the sheet's first lines in short columns that fit the dialog (screen 17)
  const prev = sheetPreview(S, rows, owed, 4, shortName);
  const xprev = out && outFirst ? xSheetPreview(out.rows, owed, 4, shortName) : null;
  const name = chkFileName(ym, ce);
  const save = async () => {
    setBusy('กำลังทำไฟล์…');
    try {
      downloadBlob(await xlsxBlob(sheets), name);
      onClose();
    } catch (x) {
      setBusy('ทำไฟล์ไม่สำเร็จ: ' + ((x as Error)?.message || x));
    }
  };
  return (
    <Modal title={`ดาวน์โหลด Excel · ${ym ? ymTh(ym) : 'ทั้งปี ' + year}`} onClose={onClose} width={720}>
      <div className="cf-dlg mc-xl">
        <div>
          <div className="cf-fl">ในไฟล์มี {out ? 4 : 2} ชีต</div>
          <div className="mc-xl-t">
            <b>รายการ</b> หนึ่งแถวต่อหนึ่งรายการ {fmtN(ls.rows.length)} แถว{orphans ? ` (รวมยกเลิกหลังตรวจ ${fmtN(orphans)} แถวท้ายชีต ไม่นับในยอด)` : ''} · <b>สรุป</b> ยอดเข้าแล้ว รอรับ เลยกำหนด และบัญชีตรวจแล้ว {fmtN(c.ok)} จาก {fmtN(c.n)} รายการ
            {out && <> · <b>เงินออก</b> ค่าใช้จ่ายของงาน {fmtN(sheets[2].rows.length)} แถว · <b>สรุปเงินออก</b> จ่ายแล้ว ค้างจ่าย คงเหลือสุทธิ และบัญชีตรวจเงินออก</>}
          </div>
        </div>
        {filter && (
          <div>
            <div className="cf-fl">ตัวกรอง</div>
            <div>เฉพาะ {filter} <span className="cf-mute">(ตามที่กรองอยู่ในหน้านี้ · ไฟล์บอกตัวกรองไว้ในชีต “สรุป” · สถานะปิดเดือนเป็นของทั้งเดือน)</span></div>
          </div>
        )}
        {toCome.length + unpaid.length > 0 && (
          <label className={'cf-ck' + (owed ? ' on' : '')}>
            <input type="checkbox" className="sr-only" checked={owed} onChange={(ev) => setOwed(ev.target.checked)} />
            <Check on={owed} />
            <span>
              {out ? 'รวมรายการรอรับ เลยกำหนด และค้างจ่าย' : 'รวมรายการรอรับและเลยกำหนด'}
              <small>
                {fmtN(toCome.length)} รายการ · {m0(toCome.reduce((a, r) => a + r.amt, 0))} บาท{out ? ` · ค้างจ่าย ${fmtN(unpaid.length)} รายการ ${m0(unpaid.reduce((a, r) => a + r.amt, 0))} บาท` : ''} · ไม่ติ๊ก = เฉพาะเงินที่รับ{out ? 'และจ่าย' : ''}แล้ว{out ? '' : ` ${fmtN(got.length)} รายการ`}
              </small>
            </span>
          </label>
        )}
        {xprev && (
          <div>
            <div className="cf-fl">ตัวอย่าง {fmtN(xprev.length)} แถวแรกของชีต “เงินออก”</div>
            {xprev.length ? (
              <div className="cf-prev mc-prev">
                <table>
                  <thead><tr>{X_PREVIEW_HEAD.map((h, i) => <th key={i} className={i === 2 ? 'r' : undefined}>{h}</th>)}</tr></thead>
                  <tbody>{xprev.map((r, j) => <tr key={j}>{r.map((v, i) => <td key={i} className={i === 2 ? 'r' : i === 0 ? 'wr' : undefined}>{v}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ) : (
              <span className="cf-mute">ยังไม่มีรายการ</span>
            )}
          </div>
        )}
        {!xprev && <div>
          <div className="cf-fl">ตัวอย่าง {fmtN(prev.length)} แถวแรกของชีต “รายการ”</div>
          {prev.length ? (
            <div className="cf-prev mc-prev">
              <table>
                <thead><tr>{PREVIEW_HEAD.map((h, i) => <th key={i} className={i === 3 ? 'r' : undefined}>{h}</th>)}</tr></thead>
                <tbody>{prev.map((r, j) => <tr key={j}>{r.map((v, i) => <td key={i} className={i === 3 ? 'r' : i === 0 ? 'wr' : undefined}>{v}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : (
            <span className="cf-mute">ยังไม่มีรายการ</span>
          )}
        </div>}
        <p className="cf-dnote">{out ? 'ชีตเงินออกมีหมวดค่าใช้จ่าย รายละเอียด วันที่บิล วันที่จ่าย บิล บันทึกโดย และการตรวจของบัญชี · ' : ''}ในไฟล์มีคอลัมน์ ครบกำหนด ฐานยอด (รวม VAT / หลังหัก ณ ที่จ่าย / พิมพ์เอง) วิธีชำระ หลักฐาน บันทึกโดย วันที่ตรวจ และข้อความส่งกลับแก้ไข · ยอดเป็นตัวเลขและวันที่เป็นวันที่จริงของ Excel รวมยอดและกรองได้ทันที · ชื่อไฟล์ {name}</p>
        {busy && <span className="t-sec" role="status">{busy}</span>}
        <div className="dlg-act">
          <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn pri" onClick={() => void save()}>ดาวน์โหลด Excel</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ the year table

/** "สรุปรายเดือน · ปี 2569": each month's money and check, closing a month; a row opens its month above.
 *  The totals equal the Cashflow cards. */
export function YearCheck({ S, rows, team, filter, year, scope, today, phone, side, outXl }: { S: SalesState; rows: ChkRow[]; /** the year's lines of every deal (closing a month) */ team: ChkRow[]; /** the page's filter in words ('' none) */ filter: string; year: string; scope: number | 'y'; today: string; phone: boolean; /** the switch เงินเข้า / เงินออก */ side?: ReactNode; outXl?: OutXl }) {
  const { engine: e } = useApp();
  const open = useOpenMonth();
  const closeMonth = useCloseMonth();
  const [xl, setXl] = useState(false);
  const ce = +year - 543;
  // the figures are the filter's; whether a month may be closed is the whole month's
  const Y = yearCheck(rows, ce, e.monthCloses(), today, team);
  const may = e.can('pay.check') && !e.payCheckBlock();
  const pick = scope === 'y' ? '' : ymOf(ce, scope);
  const chk = (m: MonthRow) => {
    const c = m.sum;
    if (!c.gotN) return c.owedN || c.lateN ? <span className="cf-mute">ยังไม่มีเงินเข้า</span> : null;
    if (!c.n) return <span className="cf-mute">ก่อนเริ่มตรวจ</span>;
    if (c.ok === c.n && !c.orphans) return <span className="mc-chk"><span className="chip info">ตรวจครบ</span><span className="mc-meta">{fmtN(c.n)} รายการ</span></span>;
    const extra = [c.wait + c.changed ? `รอตรวจ ${c.wait + c.changed}` : '', c.back ? `ส่งกลับแก้ไข ${c.back}` : '', c.orphans ? `ยกเลิกหลังตรวจ ${c.orphans}` : ''].filter(Boolean);
    return <span className="cf-cell"><span>ตรวจแล้ว {fmtN(c.ok)} จาก {fmtN(c.n)}</span><small>{extra.join(' · ')}</small></span>;
  };
  const closeCell = (m: MonthRow) => {
    // the whole month against its close: what changed after it (a line moved out of it too)
    if (m.state === 'closed')
      return (
        <span className="cf-cell">
          <span>ปิดแล้ว</span>
          <small>{[m.drift?.flagged ? driftWords(m.drift) : '', [m.close!.by, dmTh(localDay(m.close!.at))].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</small>
        </span>
      );
    if (m.state === 'current') return <span className="cf-mute">เดือนปัจจุบัน</span>;
    if (m.state === 'can')
      return may ? (
        <button type="button" className="btn xs" title={filter ? CLOSE_ALL : undefined} onClick={(ev) => (ev.stopPropagation(), closeMonth(m.ym))}>ปิดเดือน</button>
      ) : (
        <span className="cf-mute">ยังไม่ปิด</span>
      );
    if (m.state === 'open')
      return filter ? <span className="cf-cell"><span className="cf-mute">ตรวจยังไม่ครบ</span><small>ทั้งเดือน ตรวจแล้ว {fmtN(m.team.ok)} จาก {fmtN(m.team.n)}</small></span> : <span className="cf-mute">ตรวจยังไม่ครบ</span>;
    return null;
  };
  const money = (v: number, bad = false) => (v ? (bad ? <span className="bad">{m0(v)}</span> : m0(v)) : <span className="cf-mute">—</span>);
  const T = Y.total;
  const xlBtn = <button type="button" className="btn sm" onClick={() => setXl(true)}>ดาวน์โหลด Excel ทั้งปี</button>;
  return (
    <section className="cf-card" id="mc-year" aria-labelledby="mc-yt-t">
      <div className="cf-h">
        <div>
          <h3 className="cf-t" id="mc-yt-t">สรุปรายเดือน · ปี {year}</h3>
          <span className="cf-s">{phone ? 'แตะ' : 'กด'}เดือนเพื่อเปิดรายการในส่วนตรวจรับเงินด้านบน · ยอดตรงกับกราฟและการ์ดด้านบน{filter ? ' · ปิดเดือนนับทุกรายการของเดือน ไม่ขึ้นกับตัวกรอง' : ''}</span>
        </div>
        {!phone && xlBtn}
      </div>
      {side}
      {phone ? (
        <div className="mc-yl">
          {Y.months.map((m, i) => {
            const c = m.sum, any = c.gotN + c.owedN + c.lateN + c.orphans + (m.drift?.flagged ? 1 : 0);
            return (
              <div key={m.ym} className={'mc-yl-r' + (m.ym === pick ? ' cur' : '') + (any ? '' : ' empty')}>
                <button type="button" className="mc-yl-b" aria-pressed={m.ym === pick} disabled={!any} onClick={() => open(i)}>
                  <span className="mc-yl-1"><b>{ymTh(m.ym).split(' ')[0]}</b><span>{c.got ? m0(c.got) : '—'}</span></span>
                  {any > 0 && <span className="mc-yl-2">{[c.owed ? `รอรับ ${m0(c.owed)}` : '', c.late ? `เลยกำหนด ${m0(c.late)}` : ''].filter(Boolean).join(' · ') || 'ไม่มียอดค้าง'}</span>}
                </button>
                {(any > 0 || m.close) && <span className="mc-yl-3">{chk(m)}{closeCell(m)}</span>}
              </div>
            );
          })}
          <div className="mc-yl-r tot">
            <span className="mc-yl-1"><b>รวมปี {year}</b><span>{m0(T.got)}</span></span>
            <span className="mc-yl-2">รอรับ {m0(T.owed)} · เลยกำหนด {m0(T.late)} · ตรวจแล้ว {fmtN(T.ok)} จาก {fmtN(T.n)} · ปิดแล้ว {fmtN(Y.closed)} เดือน</span>
          </div>
          <div className="mc-ph-row">{xlBtn}</div>
        </div>
      ) : (
        <table className="cf-list mc-yt" aria-label={`สรุปรายเดือน ปี ${year}`}>
          <colgroup><col className="y-m" /><col className="y-n" /><col className="y-n" /><col className="y-n" /><col className="y-c" /><col className="y-x" /></colgroup>
          <thead>
            <tr><th>เดือน</th><th className="r">เข้าแล้ว (บาท)</th><th className="r">รอรับ</th><th className="r">เลยกำหนด</th><th>บัญชีตรวจ</th><th>ปิดเดือน</th></tr>
          </thead>
          <tbody>
            {Y.months.map((m, i) => {
              const c = m.sum, any = c.gotN + c.owedN + c.lateN + c.orphans + (m.drift?.flagged ? 1 : 0);
              const cur = m.ym === pick;
              return (
                <tr key={m.ym} className={'cf-row' + (any ? '' : ' mc-empty') + (cur ? ' mc-cur' : '')} onClick={any ? () => open(i) : undefined}>
                  <td>
                    {any ? (
                      <button type="button" className="mc-mo hv-tx" aria-pressed={cur} onClick={(ev) => (ev.stopPropagation(), open(i))}>{MONTHS_TH[i]}{cur && <small>เลือกอยู่</small>}</button>
                    ) : (
                      MONTHS_TH[i]
                    )}
                  </td>
                  <td className="r">{money(c.got)}</td>
                  <td className="r">{money(c.owed)}</td>
                  <td className="r">{money(c.late, true)}</td>
                  <td>{chk(m)}</td>
                  <td>{closeCell(m)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="cf-gap"><td colSpan={6} /></tr>
            <tr>
              <td>รวมปี {year}</td>
              <td className="r">{m0(T.got)}</td>
              <td className="r">{m0(T.owed)}</td>
              <td className="r">{T.late ? <span className="bad">{m0(T.late)}</span> : '0'}</td>
              <td><span className="cf-cell"><span>ตรวจแล้ว {fmtN(T.ok)} จาก {fmtN(T.n)}</span><small className="mc-meta">{m0(T.okAmt)} จาก {m0(T.amt)} บาท</small></span></td>
              <td>ปิดแล้ว {fmtN(Y.closed)} เดือน</td>
            </tr>
          </tfoot>
        </table>
      )}
      {xl && <ExcelDialog S={S} rows={rows} months={Y.months} ym={null} ce={ce} year={year} filter={filter} out={outXl?.(null)} onClose={() => setXl(false)} />}
    </section>
  );
}
