import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../state';
import type { GccEngine } from '../lib/engine';
import { daysBetween, dmTh, fmtN, localDay } from '../lib/format';
import { dealMoney, fmtMoney, jobServices, type SalesState } from '../lib/sales';
import { JobSvc } from './SvcChips';
import { MONTHS_TH, dayTh } from '../lib/cashUi';
import { shortName } from '../lib/salesUi';
import { sameName } from '../lib/caps';
import {
  canConfirm, canReclose, canReturn, canTick, canUndo, chipOf, chkMatch, isSelf, isWaiting, sumRows, waitingElsewhere, yearCheck, ymOf, ymTh,
  type ChkRow, type MonthRow,
} from '../lib/payCheck';
import { NO_CAT, X_CHK_F, carriedOwed, expNoteOf, netOf, netSplit, pctWord, rowWhat, type ExpKpis, type ExpLine, type XChkF, type XRow } from '../lib/expenseMoney';
import { CoAvatar } from './CoAvatar';
import { DialogActions, Modal } from './Dialog';
import { SHOWABLE } from './DocAttach';
import { Select } from './Select';
import { Kpi, Status } from './ui';
import { useSalesActs } from './SalesToast';
import { Band, ExcelDialog, TickBox, useOpenMonth } from './MonthCheck';

/**
 * Job expenses in the Cashflow tab, for those who see them (ดูค่าใช้จ่ายและกำไรของงาน; lib/expenseMoney.ts does
 * the work): the cards "จ่ายแล้ว", "ค้างจ่าย" and "คงเหลือสุทธิ" under the money in, the switch เงินเข้า / เงินออก
 * of the month check, and its out side: a month (or the year) of paid expenses with their check, the bills
 * not paid yet, closing the month's money out, and the year table of the out side. The check works as the
 * income's (the same rows, chips, rules and words): holders of ตรวจยืนยันรับเงิน tick, confirm, send back with a
 * note, undo, acknowledge an expense cancelled after its check, and close; the recorder of an expense can't
 * check it; everyone else who sees expenses reads it. Money out is never red (red is late money).
 */

const m0 = (n: number) => fmtMoney(Math.round(n * 100) / 100) || '0';
const MONTH_IDX = Array.from({ length: 12 }, (_, i) => i);

/** Whether this account sees job expenses (the team script sends them only then). */
export const seesExp = (e: Pick<GccEngine, 'can'>) => e.can('view.money') && e.can('view.exp');

// ------------------------------------------------------------------ the cards

/**
 * The money out of the year under the Cashflow cards: paid (on the paid date), still to pay (bills dated in
 * the year), and what is left of the money received once the paid expenses are taken off (with a bar of
 * the two parts, each named). The first two open the out side of the month check.
 */
export function ExpKpiRow({ K, year, onOpen }: { K: ExpKpis; year: string; onOpen: (f: XChkF) => void }) {
  // one rounded figure: the text's "เหลือ 65%" and the bar's "คงเหลือ 65%" are the same number
  const B = netSplit(K.got, K.paid);
  return (
    <div className="kpis sl-kpis xo-kpis" role="group" aria-label={`เงินออกและคงเหลือ ปี ${year}`}>
      <Kpi
        label="จ่ายแล้ว"
        value={m0(K.paid)}
        unit="บาท"
        zero={!K.paid}
        onClick={() => onOpen('all')}
        title="ดูค่าใช้จ่ายที่จ่ายแล้วในส่วนตรวจเงินออก"
        foot={K.paidN ? `ค่าใช้จ่าย ${fmtN(K.paidN)} รายการ · ${fmtN(K.deals)} งาน · ล่าสุด ${dmTh(K.lastPaid)}` : `ยังไม่มีค่าใช้จ่ายที่จ่ายในปี ${year}`}
      />
      <Kpi
        label="ค้างจ่าย"
        value={m0(K.unpaid)}
        unit="บาท"
        zero={!K.unpaid}
        onClick={K.unpaidN ? () => onOpen('owed') : undefined}
        title={K.unpaidN ? 'ดูบิลที่ยังไม่ได้จ่าย' : undefined}
        foot={K.unpaidN ? `${fmtN(K.unpaidN)} รายการ · นับตามวันที่บิล ไม่รวมในยอดจ่ายแล้ว` : 'ไม่มีบิลค้างจ่าย'}
      />
      <div className="kpi xo-net">
        <span className="kpi-l">คงเหลือสุทธิ · ปี {year}</span>
        <span className={'kpi-v' + (K.got || K.paid ? '' : ' zero')}>{m0(K.net)}<small>บาท</small></span>
        <span className="kpi-f">
          <span className="xo-net-w">รับแล้ว {m0(K.got)} − จ่ายแล้ว {m0(K.paid)} · เหลือ <b>{pctWord(K.pct)}</b> ของเงินที่รับ</span>
          {B && (
            <span className="xo-bar" role="img" aria-label={`ค่าใช้จ่าย ${pctWord(B.ex)} · คงเหลือ ${pctWord(B.left)} ของเงินที่รับแล้ว`}>
              <i className="ex" style={{ flex: `${B.exW} 1 0` }} />
              <i className="nt" style={{ flex: `${B.leftW} 1 0` }} />
            </span>
          )}
          {B && <span className="xo-bar-k" aria-hidden="true"><span><i className="ex" />ค่าใช้จ่าย {pctWord(B.ex)}</span><span><i className="nt" />คงเหลือ {pctWord(B.left)}</span></span>}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the switch

/** The month check's two sides: เงินเข้า (the income check) and เงินออก (job expenses), each with how many wait. */
export function SideSeg({ side, onSide, waitIn, waitOut }: { side: 'in' | 'out'; onSide: (s: 'in' | 'out') => void; waitIn: number; waitOut: number }) {
  return (
    <div className="xo-side">
      <div className="seg" role="group" aria-label="แสดงเงินเข้าหรือเงินออก">
        <button type="button" aria-pressed={side === 'in'} onClick={() => onSide('in')} title="เงินที่รับจากลูกค้า">เงินเข้า{waitIn > 0 && <span className="n">รอตรวจ {fmtN(waitIn)}</span>}</button>
        <button type="button" aria-pressed={side === 'out'} onClick={() => onSide('out')} title="ค่าใช้จ่ายของงาน">เงินออก{waitOut > 0 && <span className="n">รอตรวจ {fmtN(waitOut)}</span>}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the out side of the month check

/** "ปิดเดือน" of the money out: the engine works out the whole month itself (every deal's expenses). */
function useCloseOut() {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  return (ym: string) => {
    const v = e.closeMonthOut(ym);
    acts.say(v ? `ปิดเดือนเงินออก ${ymTh(ym)} แล้ว · ตรวจแล้ว ${fmtN(v.n)} รายการ${v.amt != null ? ' ' + m0(v.amt) + ' บาท' : ''}` : `ปิดเงินออก ${ymTh(ym)} ไม่ได้ ยังมีค่าใช้จ่ายในเดือนนี้ที่ยังไม่ได้ตรวจ`, { ms: 5000 });
  };
}
const CLOSE_ALL = 'ปิดทั้งเดือน รวมรายการที่ไม่อยู่ในตัวกรอง';

/**
 * Open an expense's bill (engine.expBill: this browser's copy, else the team's Drive, kept as the bill's own
 * copy that signing out and a lost เปิดเอกสารแนบ clear, never a document's): the
 * tab is opened within the click, then filled (a pop-up opened after a slow download would be blocked).
 */
export async function openOutBill(e: Pick<GccEngine, 'expBill'>, x: Pick<ExpLine, 'expId' | 'file'>) {
  const f = x.file;
  if (!f) return;
  const w = SHOWABLE.test(f.mime) ? window.open('', '_blank') : null;
  try {
    const url = URL.createObjectURL(await e.expBill({ id: x.expId, file: f }));
    if (w) w.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    w?.close();
    window.alert('เปิดบิลไม่สำเร็จ: ' + ((err as Error)?.message || err));
  }
}

interface Ctl {
  me: string;
  checker: boolean;
  tickOn: (r: XRow) => boolean;
  toggle: (k: string) => void;
  check: (rs: XRow[]) => void;
  undo: (r: XRow) => void;
  ret: (r: XRow) => void;
  ack: (r: XRow) => void;
}

/**
 * The out side of the month card: the month (or the year) of money out with three figures (paid, still to
 * pay, and what is left of the money received), how much accounting has checked, the filter, and the
 * expenses: paid ones with their check, the bills not paid yet, and the checks whose expense no longer counts.
 * `rows`: the year's out rows through the page's filter; `wide` the filter over every year; `team` every
 * row (closing covers the whole month); `inRows` / `inTeam` the income side's, for the money left and the file.
 */
export function ExpCheck({ S, rows, wide, team, inRows, inTeam, filter: fw, year, scope, today, phone, side }: {
  S: SalesState; rows: XRow[]; wide: XRow[]; team: XRow[]; inRows: ChkRow[]; inTeam: ChkRow[]; filter: string; year: string; scope: number | 'y'; today: string; phone: boolean; side: ReactNode;
}) {
  const { engine: e, ui, set } = useApp();
  const acts = useSalesActs();
  const open = useOpenMonth();
  const closeOut = useCloseOut();
  const me = e.me();
  const checker = e.can('pay.check');
  const block = e.expCheckBlock();
  const ce = +year - 543;
  const ym = scope === 'y' ? '' : ymOf(ce, scope);
  const inScope = ym ? rows.filter((r) => r.ym === ym) : rows;
  const sum = sumRows(inScope);
  const got = sumRows(ym ? inRows.filter((r) => r.ym === ym) : inRows).got;
  const f = ui.slXchkF;
  const counts = Object.fromEntries(X_CHK_F.map((x) => [x.id, inScope.filter((r) => chkMatch(r, x.id)).length])) as Record<XChkF, number>;
  const list = inScope.filter((r) => chkMatch(r, f));
  const closes = e.monthClosesOut();
  const close = ym ? closes[ym] || null : null;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ret, setRet] = useState<XRow | null>(null);
  const [xl, setXl] = useState(false);
  useEffect(() => setSel(new Set()), [scope, f, year]);
  const may = checker && !block;
  const tickable = may ? list.filter((r) => canTick(r, me)) : [];
  const picked = tickable.filter((r) => sel.has(r.key));
  const toggle = (k: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const allOn = tickable.length > 0 && picked.length === tickable.length;
  const check = (rs: XRow[]) => {
    const keys = e.checkExps(rs);
    if (!keys.length) return;
    const amt = rs.filter((r) => keys.includes(r.key)).reduce((a, r) => a + r.amt, 0);
    setSel(new Set());
    acts.say(`ตรวจเงินออกแล้ว ${fmtN(keys.length)} รายการ · ${m0(amt)} บาท`, { acts: [{ label: 'เลิกทำ', act: 'expUndo' }], ms: 12000 });
  };
  const undo = (r: XRow) => {
    const n = e.undoExpChecks([r.key]);
    acts.say(n ? `เลิกทำแล้ว ${r.deal ? shortName(r.deal.client) : ''} กลับเป็น “รอตรวจ”` : 'เลิกทำได้ภายใน 10 นาทีหลังตรวจ และเฉพาะรายการที่คุณตรวจเอง', { ms: 4000 });
  };
  const yearMonths = yearCheck(rows, ce, closes, today, team).months;
  const monthRow = ym ? yearMonths.find((m) => m.ym === ym)! : null;
  const canCloseNow = !!monthRow && monthRow.state === 'can' && may;
  const whole = monthRow ? monthRow.team : sum;
  // the income side of the same scope (the file holds both)
  const inYear = yearCheck(inRows, ce, e.monthCloses(), today, inTeam).months;

  const title = ym ? `ตรวจเงินออก · ${ymTh(ym)}` : `ตรวจเงินออก · ทั้งปี ${year}`;
  const n = sum.gotN + sum.owedN;
  const sub = `${fmtN(n)} รายการ · จ่ายแล้ว ${m0(sum.got)} บาท · ${ym ? `เท่ากับเงินออกจ่ายแล้วของ ${ymTh(ym, true).split(' ')[0]} ในกราฟ` : 'เท่ากับการ์ดจ่ายแล้วทั้งปี'}`;
  const monthOpts = [
    { v: 'y', label: `ทั้งปี ${year}`, n: fmtN(rows.filter((r) => r.kind !== 'orphan').length) + ' รายการ' },
    ...MONTH_IDX.map((i) => {
      const c = sumRows(rows.filter((r) => r.ym === ymOf(ce, i)));
      const w = c.wait + c.changed;
      return { v: String(i), label: ymTh(ymOf(ce, i)), sub: c.got || c.owed ? `จ่ายแล้ว ${m0(c.got)}${w ? ` · รอตรวจ ${w}` : ''}` : 'ไม่มีเงินออก', n: c.gotN + c.owedN ? fmtN(c.gotN + c.owedN) : '' };
    }),
  ];
  const monthPick = (
    <Select variant="tool" prefix="เดือน" label="เดือนที่ตรวจ" value={scope === 'y' ? 'y' : String(scope)} shown={ym ? ymTh(ym) : `ทั้งปี ${year}`} search={false} width={300} className={phone ? 'mc-ph-sel' : undefined} options={monthOpts} onChange={(v) => open(v === 'y' ? 'y' : +v)} />
  );
  const xlBtn = <button type="button" className={'btn ' + (phone ? 'sm mc-ph-x' : 'sm')} onClick={() => setXl(true)}>{ym ? 'ดาวน์โหลด Excel เดือนนี้' : 'ดาวน์โหลด Excel ทั้งปี'}</button>;
  const closeBtn = canCloseNow && <button type="button" className="btn sm" title={fw ? CLOSE_ALL : undefined} onClick={() => closeOut(ym)}>ปิดเดือนเงินออก</button>;

  // the three figures
  const nm = ym ? 'เดือนนี้' : 'ทั้งปี';
  // bills of earlier months still unpaid (as the income side's late money): the words open this year's
  // unpaid bills, and each earlier year that holds some has its own link
  const carried = ym ? carriedOwed(wide, ym) : { n: 0, amt: 0, years: [] };
  const owedIn = (be: string) => {
    if (be === year) return (set({ slXchkF: 'owed' }), open('y'));
    set({ slYear: be, slChkM: 'y', slXchkF: 'owed', slCashShow: '' });
    requestAnimationFrame(() => document.getElementById('mc-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  const carriedWords = `ค้างจากเดือนก่อน ${fmtN(carried.n)} รายการ · ${m0(carried.amt)} บาท`;
  const carriedTxt = carried.n > 0 && (
    <>
      {' · '}
      {carried.years.some((x) => x.be === year) ? <button type="button" className="lnk" title={`ดูบิลค้างจ่ายทั้งปี ${year}`} onClick={() => owedIn(year)}>{carriedWords}</button> : carriedWords}
      {carried.years.filter((x) => x.be !== year).map((x) => <Fragment key={x.be}> · <button type="button" className="lnk" title={`ดูบิลค้างจ่ายปี ${x.be} · ${fmtN(x.n)} รายการ`} onClick={() => owedIn(x.be)}>ดูปี {x.be}</button></Fragment>)}
    </>
  );
  const net = netOf(got, sum.got);
  const figs = (
    <div className="mc-figs">
      <div className="mc-fig">
        <span className="mc-fig-l">จ่ายแล้ว{nm}</span>
        <span className={'mc-fig-v' + (sum.got ? '' : ' zero')}>{m0(sum.got)}<small>บาท</small></span>
        <span className="mc-fig-f">{sum.gotN ? `${fmtN(sum.gotN)} รายการ · ล่าสุด ${dmTh(sum.lastGot)} · นับตามวันที่จ่าย` : 'ยังไม่มีค่าใช้จ่ายที่จ่าย'}</span>
      </div>
      <div className="mc-fig">
        <span className="mc-fig-l">ค้างจ่าย</span>
        <span className={'mc-fig-v' + (sum.owed ? '' : ' zero')}>{m0(sum.owed)}<small>บาท</small></span>
        <span className="mc-fig-f">
          {sum.owedN ? `${fmtN(sum.owedN)} รายการ · บิลลงวันที่${ym ? 'ในเดือนนี้' : 'ในปีนี้'} ยังไม่ได้จ่าย` : 'ไม่มีบิลค้างจ่าย'}
          {carriedTxt}
        </span>
      </div>
      <div className="mc-fig">
        <span className="mc-fig-l">คงเหลือสุทธิ{nm}</span>
        <span className={'mc-fig-v' + (got || sum.got ? '' : ' zero')}>{m0(net.net)}<small>บาท</small></span>
        <span className="mc-fig-f">เงินเข้า {m0(got)} − จ่ายแล้ว {m0(sum.got)}{net.pct != null ? ` · เหลือ ${pctWord(net.pct)}` : ''}</span>
      </div>
    </div>
  );

  // the closed month's banner (the whole month against its close)
  const drift = close && monthRow ? monthRow.drift : null;
  const k = drift ? drift.redo + drift.orphans + drift.moved : 0;
  const reclose = may && canReclose(whole, ym, drift, today);
  const banner = close && (
    <div className="mc-closed">
      <span className="mc-closed-1">
        <b>ปิดเดือนเงินออกแล้ว</b>
        <span>{close.by || 'บัญชี'} · {dayTh(localDay(close.at))} · ตอนปิด ตรวจแล้วครบ {fmtN(close.n)} รายการ{close.amt != null ? ` ${m0(close.amt)} บาท` : ''}</span>
        {may && <><span className="sp" /><button type="button" className="lnk" onClick={() => (e.reopenMonthOut(ym), acts.say(`เปิดเดือนเงินออก ${ymTh(ym)} อีกครั้งแล้ว`))}>เปิดเดือนอีกครั้ง</button></>}
      </span>
      {drift?.flagged && (
        <span>
          {k ? <>มีรายการเปลี่ยนหลังปิดเดือน <b>{fmtN(k)} รายการ</b>{drift.redo ? ` · ต้องตรวจใหม่ ${fmtN(drift.redo)}` : ''}{drift.moved ? ` · ย้ายไปเดือนอื่น ${fmtN(drift.moved)}` : ''}{drift.orphans ? ` · ยกเลิกหลังตรวจ ${fmtN(drift.orphans)} รอรับทราบ` : ''}</> : <>ยอดที่ตรวจแล้วเปลี่ยนจากตอนปิด</>}
          {' '}· จ่ายแล้วเดือนนี้{fw ? 'ทั้งเดือน' : ''}ตอนนี้ {m0(whole.got)} บาท {close.amt == null ? '' : Math.abs(close.amt - whole.got) < 0.005 ? 'เท่ากับตอนปิด' : `ตอนปิด ${m0(close.amt)} บาท`}
          {reclose && <> · <button type="button" className="lnk" onClick={() => closeOut(ym)}>ปิดเดือนอีกครั้งด้วยยอดนี้</button></>}
        </span>
      )}
    </div>
  );

  // how far accounting has got
  const pct = sum.amt ? Math.min(100, Math.round((sum.okAmt / sum.amt) * 100)) : 0;
  const elsewhere = ym ? waitingElsewhere(wide, ym) : { n: 0, months: [], years: [], words: '' };
  const outside = fw && ym && !close ? whole.n - whole.ok + whole.orphans - (sum.n - sum.ok + sum.orphans) : 0;
  const none = inScope.some((r) => r.kind === 'got' && r.state === 'none');
  const roNote = !checker ? 'ฝ่ายบัญชีเป็นผู้ตรวจ · คุณดูสถานะได้อย่างเดียว' : block === 'name' ? 'ใส่ชื่อของคุณที่แท็บอัปเดตข้อมูลก่อน จึงจะตรวจได้' : '';
  const prog = (
    <div className="mc-prog">
      {sum.n ? (
        <>
          <span className="mc-prog-t">บัญชีตรวจเงินออกแล้ว <b>{fmtN(sum.ok)} จาก {fmtN(sum.n)} รายการ</b> · <span className="mc-nw">{m0(sum.okAmt)} จาก {m0(sum.amt)} บาท</span></span>
          <span className="mc-pb" role="img" aria-label={`บัญชีตรวจแล้ว ${pct}% ของค่าใช้จ่ายที่จ่ายแล้ว`}><i style={{ width: pct + '%' }} /></span>
        </>
      ) : (
        <span className="mc-prog-t">{sum.gotN ? 'ค่าใช้จ่ายในช่วงนี้อยู่ก่อนเดือนที่เริ่มตรวจ ไม่ต้องตรวจ' : `ยังไม่มีค่าใช้จ่ายที่จ่ายให้ตรวจ${ym ? 'ในเดือนนี้' : 'ในปีนี้'}`}</span>
      )}
      <span className="mc-prog-r">
        {sum.wait + sum.changed > 0 && <span>รอตรวจ {fmtN(sum.wait + sum.changed)} รายการ</span>}
        {sum.back > 0 && <span>ส่งกลับแก้ไข {fmtN(sum.back)} รายการ</span>}
        {sum.orphans > 0 && <span>ยกเลิกหลังตรวจ {fmtN(sum.orphans)} รายการ</span>}
        {elsewhere.n > 0 && <span>รอตรวจในเดือนอื่น {fmtN(elsewhere.n)} รายการ · {elsewhere.words}</span>}
        {outside > 0 && <span>นอกตัวกรองยังไม่ได้ตรวจ {fmtN(outside)} รายการ · ปิดเดือนได้เมื่อตรวจครบทั้งเดือน</span>}
        {roNote && <span className="mc-ro">{roNote}</span>}
      </span>
      <span className="mc-prog-n">
        บัญชีตรวจเฉพาะค่าใช้จ่ายที่จ่ายแล้ว เทียบกับบัญชีธนาคารและบิล · บิลค้างจ่ายจะเข้ามาให้ตรวจเมื่อมีคนบันทึกว่าจ่ายแล้ว · คนที่บันทึกค่าใช้จ่ายตรวจรายการของตัวเองไม่ได้
        {none && ` · ค่าใช้จ่ายที่จ่ายก่อน ${ymTh(e.payChkCfg().since.slice(0, 7))} ไม่ต้องตรวจ`}
      </span>
    </div>
  );

  const filter = phone ? (
    <div className="mc-ph-row">
      <Select variant="tool" prefix="แสดง" label="แสดงรายการ" value={f} shown={`${X_CHK_F.find((x) => x.id === f)!.label} · ${fmtN(counts[f])} รายการ`} search={false} className="mc-ph-sel" options={X_CHK_F.map((x) => ({ v: x.id, label: x.label, n: fmtN(counts[x.id]) }))} onChange={(v) => set({ slXchkF: v as XChkF })} />
    </div>
  ) : (
    <div className="mc-tools">
      <div className="seg sl-seg" role="group" aria-label="แสดงรายการเงินออก">
        {X_CHK_F.map((x) => (
          <button key={x.id} type="button" aria-pressed={f === x.id} onClick={() => set({ slXchkF: x.id })}>
            {x.label}<span className="n">{fmtN(counts[x.id])}</span>
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

  const groups: { key: string; name: string; rows: XRow[]; right: string }[] = [];
  if (ym) {
    const paid = list.filter((r) => r.kind === 'got');
    const c = sumRows(paid);
    groups.push({ key: 'got', name: 'จ่ายแล้ว', rows: paid, right: [c.ok ? `ตรวจแล้ว ${c.ok}` : '', c.wait + c.changed ? `รอตรวจ ${c.wait + c.changed}` : '', c.back ? `ส่งกลับแก้ไข ${c.back}` : ''].filter(Boolean).join(' · ') });
    groups.push({ key: 'owed', name: 'ค้างจ่าย', rows: list.filter((r) => r.kind === 'owed'), right: 'ยังไม่ได้จ่าย ไม่นับในยอดจ่ายแล้ว' });
    groups.push({ key: 'orphan', name: 'ยกเลิกหลังตรวจ', rows: list.filter((r) => r.kind === 'orphan'), right: 'ไม่นับในยอด' });
  } else
    MONTH_IDX.forEach((i) => {
      const rs = list.filter((r) => r.ym === ymOf(ce, i));
      if (!rs.length) return;
      // the band's sum holds the bills not paid yet too: it says how much of it is which
      const c = sumRows(rs);
      groups.push({ key: 'm' + i, name: ymTh(ymOf(ce, i)), rows: rs, right: c.owed ? `จ่ายแล้ว ${m0(c.got)} · ค้างจ่าย ${m0(c.owed)}` : '' });
    });
  const shown = groups.filter((g) => g.rows.length);
  const sumOf = (g: { key: string; rows: XRow[] }) => g.rows.filter((r) => (g.key === 'orphan') === (r.kind === 'orphan')).reduce((a, r) => a + r.amt, 0);
  const ctl: Ctl = { me, checker: may, tickOn: (r) => sel.has(r.key), toggle, check, undo, ret: setRet, ack: (r) => (e.ackExpOrphan(r), acts.say('รับทราบแล้ว นำรายการออกแล้ว', { ms: 3000 })) };

  return (
    <section className={'cf-card mc-card xo-card' + (phone ? ' mc-ph' : '')} id="mc-card" aria-labelledby="xo-t">
      <div className="cf-h">
        <div>
          <h3 className="cf-t" id="xo-t">{title}</h3>
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
      {bulk}
      {phone ? (
        <div className="mc-phl">
          {shown.map((g) => (
            <Fragment key={g.key}>
              <div className="cf-mband xo-band">
                <span className="cf-bnw"><span className="sl-sec-name cf-bn">{g.name}</span><span className="cf-bc">{fmtN(g.rows.length)} รายการ</span></span>
                <span className="cf-bsum">{m0(sumOf(g))}</span>
              </div>
              {g.rows.map((r) => <PhoneRow key={r.key} S={S} r={r} today={today} ctl={ctl} />)}
            </Fragment>
          ))}
        </div>
      ) : (
        shown.length > 0 && (
          <table className={'cf-list mc-list xo-list' + (ctl.checker ? '' : ' ro')} aria-label={title}>
            <colgroup><col className="c-cb" /><col /><col className="c-cat" /><col className="c-amt" /><col className="c-date" /><col className="c-ev" /><col className="c-st" /></colgroup>
            <thead>
              <tr>
                <th className="mc-cbc">{ctl.checker && <TickBox on={allOn} mixed={picked.length > 0 && !allOn} disabled={!tickable.length} label="เลือกทุกรายการที่รอตรวจ" onClick={() => setSel(allOn ? new Set() : new Set(tickable.map((r) => r.key)))} />}</th>
                <th>ลูกค้า / งาน</th><th>ค่าใช้จ่าย</th><th className="r">ยอด (บาท)</th><th className="mc-dt">วันที่</th><th>บิล / ใบเสร็จ</th><th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <Fragment key={g.key}>
                  <Band name={g.name} count={`${fmtN(g.rows.length)} รายการ`} sum={sumOf(g)} right={g.right} />
                  {g.rows.map((r) => <Row key={r.key} S={S} r={r} today={today} ctl={ctl} />)}
                </Fragment>
              ))}
            </tbody>
          </table>
        )
      )}
      {!shown.length && <div className="cf-empty">{inScope.length ? 'ไม่มีรายการตามที่เลือก' : ym ? `${ymTh(ym)} ไม่มีค่าใช้จ่ายที่จ่ายและไม่มีบิลค้างจ่าย` : `ยังไม่มีค่าใช้จ่ายของงานในปี ${year} · บันทึกค่าใช้จ่ายได้ที่การ์ด “ค่าใช้จ่ายของงาน” ในรายละเอียดงาน`}</div>}
      {phone && <div className="mc-ph-row">{closeBtn}{xlBtn}</div>}
      {ret && <ReturnDialog S={S} r={ret} onClose={() => setRet(null)} />}
      {xl && (
        <ExcelDialog
          S={S}
          rows={ym ? inRows.filter((r) => r.ym === ym) : inRows}
          months={ym ? inYear.filter((m) => m.ym === ym) : inYear}
          ym={ym || null}
          ce={ce}
          year={year}
          filter={fw}
          out={{ rows: inScope, months: ym ? [monthRow!] : yearMonths }}
          outFirst
          onClose={() => setXl(false)}
        />
      )}
    </section>
  );
}

/** The client and the job: a joint quotation's expense says whose (the quotation's, or one company's). */
function XName({ S, r }: { S: SalesState; r: XRow }) {
  const { engine: e, set } = useApp();
  const d = r.deal;
  const c = d && d.gid != null ? e.company(d.gid) : undefined;
  const j = r.x?.joint;
  const sub = !d ? 'งานนี้ถูกลบแล้ว' : j ? (j.role === 'header' ? `ใบเสนอราคาร่วม ${j.members} บริษัท${j.part ? ` · ส่วนของ ${j.part} บริษัท` : ''}` : 'บริษัทในใบเสนอราคาร่วม') : [dealMoney(S, d).fcDoc?.docNo, d.section].filter(Boolean).join(' · ');
  const name = d ? shortName(d.client) : 'งานที่ถูกลบ';
  return (
    <span className="cf-nmw">
      <CoAvatar name={c?.name || d?.client || 'งาน'} web={c?.web} set={c?.set} size={32} />
      <span className="cf-nm">
        <span className="cf-nm-l">
          {d ? <button type="button" className="cf-nm-b hv-tx co-name dense" onClick={() => set({ deal: d.id })} title={`${d.client} เปิดรายละเอียด`}>{name}</button> : <span className="cf-nm-b co-name dense">{name}</span>}
          {d && <JobSvc svc={jobServices(S, d)} none={false} />}
        </span>
        <span className="cf-nm-s">{sub}{d?.resp ? ` · ${d.resp}` : ''}</span>
      </span>
    </span>
  );
}

/** The bill: its file (opens it, for those who may open attached documents), or "ไม่มีไฟล์". */
function Bill({ x }: { x: ExpLine | null }) {
  const { engine: e } = useApp();
  if (!x) return <span className="cf-mute">—</span>;
  if (!x.file) return <span className="mc-ev"><span className="cf-mute">ไม่มีไฟล์</span></span>;
  const name = x.file.name;
  return (
    <span className="mc-ev">
      {e.can('docs.open') ? <button type="button" className="lnk xo-bill" title={`เปิดไฟล์ ${name}`} onClick={() => void openOutBill(e, x)}>บิล / ใบเสร็จ</button> : <span>บิล / ใบเสร็จ</span>}
      <small title={name}>{name}</small>
    </span>
  );
}

/** A bill not paid yet: ค้างจ่าย (never red) and how long since its date. */
function Unpaid({ r, today, inline }: { r: XRow; today: string; inline?: boolean }) {
  const days = r.date && r.date <= today ? daysBetween(r.date, today) : null;
  const w = days == null ? 'บิลยังไม่ถึงวันที่' : days === 0 ? 'บิลลงวันที่วันนี้' : `บิลมา ${fmtN(days)} วันแล้ว`;
  if (inline) return <Status kind="neutral">ค้างจ่าย · {w}</Status>;
  return <span className="cf-cell"><Status kind="neutral">ค้างจ่าย</Status><small>{w}</small></span>;
}

function StatusCell({ r, today, ctl }: { r: XRow; today: string; ctl: Ctl }) {
  if (r.kind === 'owed') return <Unpaid r={r} today={today} />;
  const c = chipOf(r);
  if (!c) return <span className="cf-mute">ก่อนเริ่มตรวจ</span>;
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
      {ctl.checker && isSelf(r, ctl.me) && r.kind === 'got' && r.state !== 'ok' && r.state !== 'none' && <span className="mc-meta">คุณบันทึกเอง ให้คนอื่นตรวจ</span>}
    </span>
  );
}

/** Whose expense it is to fix: the recorder (or, unknown, the job's ผู้รับผิดชอบ). */
const mineToFix = (r: XRow, me: string) => !!me && (r.by.some((b) => sameName(b, me)) || sameName(r.deal?.resp, me));
function NoteBox({ r, ctl }: { r: XRow; ctl: Ctl }) {
  const { set } = useApp();
  const note = expNoteOf(r);
  if (!note) return null;
  const fix = r.state === 'back' && r.kind === 'got' && !ctl.checker && r.deal && mineToFix(r, ctl.me);
  return (
    <div className="mc-nbox">
      <span className="mc-nh">{note.head}</span>
      {note.body && <p>{note.body}</p>}
      {fix && <button type="button" className="lnk" onClick={() => set({ deal: r.deal!.id })}>เปิดงานเพื่อแก้ไข</button>}
    </div>
  );
}

function Row({ S, r, today, ctl }: { S: SalesState; r: XRow; today: string; ctl: Ctl }) {
  const tick = ctl.checker && canTick(r, ctl.me);
  const on = tick && ctl.tickOn(r);
  const x = r.x;
  const paid = r.kind === 'got' || r.kind === 'orphan';
  const hasNote = !!expNoteOf(r);
  return (
    <>
      <tr className={'cf-row' + (on ? ' mc-sel' : '') + (r.kind === 'orphan' ? ' mc-orph' : '')}>
        <td className="mc-cbc">{tick && <TickBox on={on} label={`เลือก ${r.deal ? shortName(r.deal.client) : ''} ${rowWhat(r)} ${m0(r.amt)} บาท`} onClick={() => ctl.toggle(r.key)} />}</td>
        <td><XName S={S} r={r} /></td>
        <td><span className="cf-cell"><span className="xo-cat" title={x?.c || ''}>{x ? x.c || NO_CAT : 'รายการที่ลบแล้ว'}</span><small title={x?.n || ''}>{x?.n || (x?.joint?.part ? `ส่วนของ ${x.joint.part} บริษัท จากบิล ${m0(x.full)}` : '')}</small></span></td>
        <td className="r"><span className="cf-cell mc-amt"><span className="cf-amt">{m0(r.amt)}</span><small>{r.kind === 'orphan' ? 'ตอนตรวจ' : 'ตามบิล รวม VAT'}</small></span></td>
        <td className="mc-dt">
          {paid ? (
            <span className="cf-cell"><span>จ่าย {dayTh(r.date)}</span><small>{r.kind === 'orphan' ? 'ไม่นับเป็นเงินออกแล้ว' : 'บันทึกโดย ' + (r.by.join(', ') || 'ไม่ระบุ')}</small></span>
          ) : (
            <span className="cf-cell"><span>บิล {dayTh(r.date)}</span><small>บันทึกโดย {r.by.join(', ') || 'ไม่ระบุ'}</small></span>
          )}
        </td>
        <td><Bill x={x} /></td>
        <td><StatusCell r={r} today={today} ctl={ctl} /></td>
      </tr>
      {hasNote && (
        <tr className={'mc-note' + (on ? ' mc-sel' : '')}>
          <td />
          <td colSpan={6}><NoteBox r={r} ctl={ctl} /></td>
        </tr>
      )}
    </>
  );
}

function PhoneRow({ S: _S, r, today, ctl }: { S: SalesState; r: XRow; today: string; ctl: Ctl }) {
  const { set } = useApp();
  const x = r.x;
  const paid = r.kind === 'got' || r.kind === 'orphan';
  const tick = ctl.checker && canTick(r, ctl.me);
  const on = tick && ctl.tickOn(r);
  return (
    <div className={'mc-mi' + (on ? ' xo-sel' : '')}>
      <div className="cf-mi-1">
        {r.deal ? <button type="button" className="cf-nm-b hv-tx co-name dense" onClick={() => set({ deal: r.deal!.id })} title={r.deal.client}>{shortName(r.deal.client)}</button> : <span className="cf-nm-b co-name dense">งานที่ถูกลบ</span>}
        <span className="cf-amt">{m0(r.amt)}</span>
      </div>
      <div className="cf-mi-2"><span>{x ? x.c || NO_CAT : 'รายการที่ลบแล้ว'}{x?.n ? ` · ${x.n}` : ''}</span></div>
      <div className="cf-mi-2"><span>{paid ? `จ่าย ${dmTh(r.date)}` : `บิล ${dmTh(r.date)}`}{r.by.length ? ` · บันทึกโดย ${r.by.join(', ')}` : ''}</span></div>
      {x && <div className="cf-mi-2"><Bill x={x} /></div>}
      <div className="cf-mi-2">
        {tick && <TickBox on={on} label={`เลือก ${rowWhat(r)} ${m0(r.amt)} บาท`} onClick={() => ctl.toggle(r.key)} />}
        {r.kind === 'owed' ? <Unpaid r={r} today={today} inline /> : <StatusCell r={r} today={today} ctl={ctl} />}
      </div>
      <NoteBox r={r} ctl={ctl} />
    </div>
  );
}

/** "ส่งกลับแก้ไข" of an expense: its facts and a note (required) to whoever recorded it. */
function ReturnDialog({ S, r, onClose }: { S: SalesState; r: XRow; onClose: () => void }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const [note, setNote] = useState('');
  const to = r.by[0] || r.deal?.resp || 'คนที่บันทึก';
  const d = r.deal!, x = r.x;
  const send = () => {
    if (!note.trim()) return;
    if (e.returnExp(r, note)) acts.say(`ส่งกลับให้ ${to} แก้ไขแล้ว`, { ms: 4000 });
    onClose();
  };
  return (
    <Modal title={`ส่งกลับแก้ไข · ${shortName(d.client)}`} onClose={onClose} width={600} focus="field">
      <dl className="mc-dl">
        <dt>งาน</dt>
        <dd><span>{d.client}</span><small>{[dealMoney(S, d).fcDoc?.docNo, d.section, d.resp ? 'ผู้รับผิดชอบ ' + d.resp : ''].filter(Boolean).join(' · ')}</small></dd>
        <dt>ค่าใช้จ่าย</dt>
        <dd><span>{x ? x.c || NO_CAT : '—'}</span>{x?.n && <small>{x.n}</small>}</dd>
        <dt>ยอด</dt>
        <dd><span>{m0(r.fp?.amt ?? r.amt)} บาท</span><small>ตามบิล รวม VAT</small></dd>
        <dt>วันที่จ่าย</dt>
        <dd><span>{dayTh(r.date)}</span><small>บันทึกโดย {r.by.join(', ') || 'ไม่ระบุ'}{x?.bill ? ` · บิลลงวันที่ ${dayTh(x.bill)}` : ''}</small></dd>
        <dt>บิล</dt>
        <dd><span>{x?.file ? x.file.name : 'ไม่มีไฟล์'}</span></dd>
      </dl>
      <label className="mc-ret">
        บอก {to} ว่าต้องแก้อะไร
        <textarea rows={3} value={note} maxLength={300} onChange={(ev) => setNote(ev.target.value)} placeholder="เช่น ยอดไม่ตรงกับบิล ช่วยแนบใบเสร็จตัวจริง" data-autofocus="" />
        <small>{to} จะเห็นข้อความนี้ในหน้า Cashflow ส่วนเงินออก · ระหว่างรอแก้ ยอดนี้ยังนับเป็นเงินออกตามเดิม</small>
      </label>
      <DialogActions>
        <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn pri" disabled={!note.trim()} onClick={send}>ส่งกลับให้ {to} แก้ไข</button>
      </DialogActions>
    </Modal>
  );
}

// ------------------------------------------------------------------ the year table of the out side

/**
 * "สรุปรายเดือน · เงินออก · ปี 2569": each month's paid and unpaid money, what is left of the money received,
 * the check of its money out and closing it; a row opens its month above. The totals equal the cards.
 */
export function ExpYearCheck({ S, rows, team, inRows, inTeam, filter, year, scope, today, phone, side }: {
  S: SalesState; rows: XRow[]; team: XRow[]; inRows: ChkRow[]; inTeam: ChkRow[]; filter: string; year: string; scope: number | 'y'; today: string; phone: boolean; side: ReactNode;
}) {
  const { engine: e } = useApp();
  const [xl, setXl] = useState(false);
  const open = useOpenMonth();
  const closeOut = useCloseOut();
  const ce = +year - 543;
  const Y = yearCheck(rows, ce, e.monthClosesOut(), today, team);
  const may = e.can('pay.check') && !e.expCheckBlock();
  const pick = scope === 'y' ? '' : ymOf(ce, scope);
  const gotOf = (ym: string) => inRows.filter((r) => r.kind === 'got' && r.ym === ym).reduce((a, r) => a + r.amt, 0);
  const chk = (m: MonthRow) => {
    const c = m.sum;
    if (!c.gotN) return c.owedN ? <span className="cf-mute">ยังไม่ได้จ่าย</span> : null;
    if (!c.n) return <span className="cf-mute">ก่อนเริ่มตรวจ</span>;
    if (c.ok === c.n && !c.orphans) return <span className="mc-chk"><span className="chip info">ตรวจครบ</span><span className="mc-meta">{fmtN(c.n)} รายการ</span></span>;
    const extra = [c.wait + c.changed ? `รอตรวจ ${c.wait + c.changed}` : '', c.back ? `ส่งกลับแก้ไข ${c.back}` : '', c.orphans ? `ยกเลิกหลังตรวจ ${c.orphans}` : ''].filter(Boolean);
    return <span className="cf-cell"><span>ตรวจแล้ว {fmtN(c.ok)} จาก {fmtN(c.n)}</span><small>{extra.join(' · ')}</small></span>;
  };
  const closeCell = (m: MonthRow) => {
    if (m.state === 'closed')
      return (
        <span className="cf-cell">
          <span>ปิดแล้ว</span>
          <small>{[m.drift?.flagged ? 'มีรายการเปลี่ยนหลังปิด' : '', [m.close!.by, dmTh(localDay(m.close!.at))].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</small>
        </span>
      );
    if (m.state === 'current') return <span className="cf-mute">เดือนปัจจุบัน</span>;
    if (m.state === 'can') return may ? <button type="button" className="btn xs" title={filter ? CLOSE_ALL : undefined} onClick={(ev) => (ev.stopPropagation(), closeOut(m.ym))}>ปิดเดือน</button> : <span className="cf-mute">ยังไม่ปิด</span>;
    if (m.state === 'open') return filter ? <span className="cf-cell"><span className="cf-mute">ตรวจยังไม่ครบ</span><small>ทั้งเดือน ตรวจแล้ว {fmtN(m.team.ok)} จาก {fmtN(m.team.n)}</small></span> : <span className="cf-mute">ตรวจยังไม่ครบ</span>;
    return null;
  };
  const money = (v: number) => (v ? m0(v) : <span className="cf-mute">—</span>);
  const T = Y.total;
  const totGot = Y.months.reduce((a, m) => a + gotOf(m.ym), 0);
  const xlBtn = <button type="button" className="btn sm" onClick={() => setXl(true)}>ดาวน์โหลด Excel ทั้งปี</button>;
  return (
    <section className="cf-card" id="mc-year" aria-labelledby="xo-yt-t">
      <div className="cf-h">
        <div>
          <h3 className="cf-t" id="xo-yt-t">สรุปรายเดือน · เงินออก · ปี {year}</h3>
          <span className="cf-s">{phone ? 'แตะ' : 'กด'}เดือนเพื่อเปิดรายการในส่วนตรวจเงินออกด้านบน · จ่ายแล้วนับตามวันที่จ่าย · คงเหลือ = เงินเข้าแล้ว − จ่ายแล้ว{filter ? ' · ปิดเดือนนับทุกรายการของเดือน ไม่ขึ้นกับตัวกรอง' : ''}</span>
        </div>
        {!phone && xlBtn}
      </div>
      {side}
      {phone ? (
        <div className="mc-yl">
          {Y.months.map((m, i) => {
            const c = m.sum, any = c.gotN + c.owedN + c.orphans + (m.drift?.flagged ? 1 : 0);
            return (
              <div key={m.ym} className={'mc-yl-r' + (m.ym === pick ? ' cur' : '') + (any ? '' : ' empty')}>
                <button type="button" className="mc-yl-b" aria-pressed={m.ym === pick} disabled={!any} onClick={() => open(i)}>
                  <span className="mc-yl-1"><b>{ymTh(m.ym).split(' ')[0]}</b><span>{c.got ? 'จ่าย ' + m0(c.got) : '—'}</span></span>
                  {any > 0 && <span className="mc-yl-2">{[c.owed ? `ค้างจ่าย ${m0(c.owed)}` : '', `คงเหลือ ${m0(gotOf(m.ym) - c.got)}`].filter(Boolean).join(' · ')}</span>}
                </button>
                {(any > 0 || m.close) && <span className="mc-yl-3">{chk(m)}{closeCell(m)}</span>}
              </div>
            );
          })}
          <div className="mc-yl-r tot xo-tot">
            <span className="mc-yl-1"><b>รวมปี {year}</b><span>จ่าย {m0(T.got)}</span></span>
            <span className="mc-yl-2">ค้างจ่าย {m0(T.owed)} · คงเหลือ {m0(totGot - T.got)} · ตรวจแล้ว {fmtN(T.ok)} จาก {fmtN(T.n)} · ปิดแล้ว {fmtN(Y.closed)} เดือน</span>
          </div>
          <div className="mc-ph-row">{xlBtn}</div>
        </div>
      ) : (
        <table className="cf-list mc-yt xo-yt" aria-label={`สรุปรายเดือน เงินออก ปี ${year}`}>
          <colgroup><col className="y-m" /><col className="y-n" /><col className="y-n" /><col className="y-n" /><col className="y-c" /><col className="y-x" /></colgroup>
          <thead>
            <tr><th>เดือน</th><th className="r">จ่ายแล้ว (บาท)</th><th className="r">ค้างจ่าย</th><th className="r">คงเหลือสุทธิ</th><th>บัญชีตรวจเงินออก</th><th>ปิดเดือนเงินออก</th></tr>
          </thead>
          <tbody>
            {Y.months.map((m, i) => {
              const c = m.sum, any = c.gotN + c.owedN + c.orphans + (m.drift?.flagged ? 1 : 0);
              const cur = m.ym === pick;
              const g = gotOf(m.ym);
              return (
                <tr key={m.ym} className={'cf-row' + (any ? '' : ' mc-empty') + (cur ? ' mc-cur' : '')} onClick={any ? () => open(i) : undefined}>
                  <td>{any ? <button type="button" className="mc-mo hv-tx" aria-pressed={cur} onClick={(ev) => (ev.stopPropagation(), open(i))}>{MONTHS_TH[i]}{cur && <small>เลือกอยู่</small>}</button> : MONTHS_TH[i]}</td>
                  <td className="r">{money(c.got)}</td>
                  <td className="r">{money(c.owed)}</td>
                  <td className="r">{g || c.got ? m0(g - c.got) : <span className="cf-mute">—</span>}</td>
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
              <td className="r">{m0(totGot - T.got)}</td>
              <td><span className="cf-cell"><span>ตรวจแล้ว {fmtN(T.ok)} จาก {fmtN(T.n)}</span><small className="mc-meta">{m0(T.okAmt)} จาก {m0(T.amt)} บาท</small></span></td>
              <td>ปิดแล้ว {fmtN(Y.closed)} เดือน</td>
            </tr>
          </tfoot>
        </table>
      )}
      {xl && <ExcelDialog S={S} rows={inRows} months={yearCheck(inRows, ce, e.monthCloses(), today, inTeam).months} ym={null} ce={ce} year={year} filter={filter} out={{ rows, months: Y.months }} outFirst onClose={() => setXl(false)} />}
    </section>
  );
}

/** Rows of the out side waiting for a check (the switch's count). */
export const waitingOut = (rows: XRow[]) => rows.filter(isWaiting).length;
