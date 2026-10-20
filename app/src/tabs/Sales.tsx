import { Fragment, createContext, useCallback, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { useApp, useEngineVersion, type UIState } from '../state';
import { daysBetween, dmTh, dtTh, fmtN, isoTh, localDay, todayISO } from '../lib/format';
import {
  ACT_TH, DEAL_STAGE, KIND_TH, NOTE_MAX, QUOTE_STAGE, actsOf, attachStage, beYear, closeReady, dateMatch, dealMoney, dealResult, dealStatus, docMismatch, filterDeals, fmtMoney, isPayStage, lastContactInfo, mismatchText,
  normSalesFilter, overdueDays, owedIn, paidNote, parseAmount, payStages, payState, planOf, quickMatch, receivables, receivedIn, salesStats, stageActs, stageDocs, stageTh, stageTrack, stepOf, withActIndex,
  type BasisDate, type Deal, type DealAct, type DealDoc, type DocKind, type LineView, type QuickView, type ResultF, type SalesFilter, type SalesState, type StageState,
} from '../lib/sales';
import { BASIS_TH, acFig, actualSource, beYearInput, closingView, fcFig, lineMeta, lineStatusView, liveCount, monthCounts, nextStepView, overPlan, relText, shortName, stageFig, statusView, trackerFields, yearOptions, type FigView } from '../lib/salesUi';
import { rangeTh, resolveDate, type DateBasis, type DateF, type Range } from '../lib/dateRange';
import { useMedia } from '../components/Sidebar';
import { Kpi, Notice, PageHead, Status } from '../components/ui';
import { CoAvatar } from '../components/CoAvatar';
import { Icon } from '../components/icons';
import { Modal } from '../components/Dialog';
import { DocAttach, openDocFile, type AttachMore } from '../components/DocAttach';
import { QtPhone, deleteQt } from '../components/QtCard';
import { QtCheckLine } from '../components/QtCheckSheet';
import { qtFigWords, qtView } from '../lib/quotes';
import { followStep, stepMoved, type StepEd, type StepFields } from '../lib/stepEditor';
import { ActForm, ActList, ActStageSel, ActTypeSeg, delActFocus, useActForm } from '../components/DealActs';
import { DateChip } from '../components/DateChip';
import { Bead, Chevron, MiniTrack, reachedOf } from '../components/StageTrack';
import { useSalesActs } from '../components/SalesToast';
// ค่าใช้จ่ายของงาน: the row menu's บันทึกค่าใช้จ่าย and the phone card's row
import { BillsStuckNote, ExpMini, expMenuSub, openExp } from '../components/ExpCard';
import { Av, insidePop } from '../components/Pop';
import { Select } from '../components/Select';
import { FilterBar, ReadChip, type FVal } from '../components/FilterBar';
import { DateFilter, dateWords } from '../components/DateFilter';
import { SalesDash } from './SalesDash';
import { CashKpiRow, CashView, LensChip, LensMoney, LensNote } from './SalesCash';
import { cashLines, cashYear, cashYears } from '../lib/sales';
import { askPay } from '../components/PayChk';
import { attachLines, previewOf } from '../lib/payCheck';
import { cashLensOf, lensSum, lensWhere, yearMoneyLabel, type CashLens } from '../lib/cashUi';
// joint quotations (package quotes, item 7): bands and member rows, counted once
import { customersOf, jointAttr, jointHeadOf, jointOf, jointRole, moneyHolds, moneySum } from '../lib/sales';
import { canMergeFrom, jointNo, jointRows, rowDeals, type JRow } from '../lib/joint';
import { JointBand, JointCard, JointClosedRows, JointShare } from '../components/JointQt';
// units (package dash): the หน่วยงาน filter's set-up link
import { UnitsDialog } from '../components/UnitsDialog';
// เพิ่มลูกค้า → ส่งบริษัทที่ติดตามอยู่: บริษัทที่ติดตาม's list, at most TRACKER_MAX a send
import { followRows } from '../lib/follow';
import { followedBatch, followedMenuWords } from '../lib/bulk';

// the shared dialog (components/Dialog.tsx); kept importable from here for older callers
export { Modal } from '../components/Dialog';

type Engine = ReturnType<typeof useApp>['engine'];
/** A stage's Thai name in the tracker's rows (CLOSED DEAL says "ผลการขาย": its buttons say YES / NO). */
const thOf = (p: string) => stageTh(p).replace(/\s*\(YES \/ NO\)$/, '');
const agoTh = (iso: string, today: string) => {
  const n = daysBetween(iso, today);
  return n === 0 ? 'วันนี้' : n === 1 ? 'เมื่อวาน' : n > 1 ? `${fmtN(n)} วันก่อน` : `อีก ${fmtN(-n)} วัน`;
};
/** A stage note a document or "รับเงินแล้ว" wrote (shown muted, and not repeated next to the document). */
const isAutoNote = (S: SalesState, d: Deal, stage: string) => {
  const n = stepOf(S, d.id, stage).n;
  const line = planOf(S, d, todayISO())?.lines.find((l) => l.stage === stage);
  return !!n && ((stageDocs(S, d).by[stage] || []).some((x) => x.auto?.n === n) || (!!line && n === paidNote(line.line)));
};

/** The table's filters as one shape (old string values read too: filterDeals normalises at every read). */
const useSalesF = (): SalesFilter => {
  const { ui } = useApp();
  return normSalesFilter({ year: ui.slYear, ...ui.slF });
};
/** Filters back into view state (without the year: the year picker owns it). */
const toSlF = (F: SalesFilter): UIState['slF'] => {
  const { year: _y, money: _m, ...rest } = F;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as UIState['slF'];
};
/** Anything that narrows the rows besides the quick view (the count and "ล้างทั้งหมด" show then). */
const narrowed = (F: SalesFilter) => !!(F.date || F.resp || F.source || F.service || F.referral || F.section || F.result || (F.q || '').trim() || F.quick === 'paylate');
/** The date filter in force: its basis and today's range of it (a named preset is worked out again). */
export interface DateIn { f: DateF; basis: DateBasis; r: Range }
const dateIn = (F: SalesFilter, today: string): DateIn | null => (F.date ? { f: F.date, basis: F.date.basis, r: resolveDate(F.date, F.year, today) } : null);

export function Sales() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const S = e.sales;
  const year = ui.slYear;
  const today = todayISO();
  const f = useSalesF();
  const yearDeals = filterDeals(S, { year }, today);
  // the lens "เงินเข้าตามปี" (table only): deals of another year with an installment in this one count too
  // (money by the year it comes in is Cashflow's: without ดู Cashflow the table counts by the deal's year)
  const lens = ui.slLens === 'cash' && e.can('view.cash');
  const fT: SalesFilter = lens ? { ...f, money: 'cash' } : f;
  const shown = filterDeals(S, fT, today);
  // the quick views are about open work: their counts come from the other filters, and the closed tab ignores them
  const noQuick = f.quick || lens ? filterDeals(S, { ...fT, quick: '' }, today) : shown;
  const closedRows = (lens ? filterDeals(S, { ...f, quick: '' }, today) : noQuick).filter((d) => d.jobStatus === 'closed');
  // not memoised: the engine changes S.deals in place (an import or a team sync can add a year)
  const all = Object.values(S.deals);
  const v = ui.slView;
  // the money views (Cashflow, the table's lens) count money in the picker ("เงินเข้า 15 งวด"), and offer
  // every year money falls in
  const moneyLines = v === 'cash' || (v === 'table' && lens) ? cashLines(S, all, today) : null;
  const years = yearOptions(all, year, beYear(), moneyLines ? cashYears(moneyLines) : []);
  const perYear = new Map<string, number>();
  customersOf(S, all).forEach((d) => perYear.set(d.year, (perYear.get(d.year) || 0) + 1));
  const yearSub = (y: string) => {
    if (y === beYear()) return 'ปีนี้';
    if (!moneyLines || perYear.get(y)) return undefined;
    const from = [...new Set(cashYear(moneyLines, y).lines.map((l) => l.dealYear))].sort();
    return from.length ? `มีงวดจากงานปี ${from.join(', ')}` : undefined;
  };
  // the table's count and its filters' choices follow the lens: in "เงินเข้าตามปี" they hold the other years'
  // jobs with money in this one
  const tableYear = lens ? filterDeals(S, { year, money: 'cash' }, today) : yearDeals;
  const openN = customersOf(S, tableYear).filter((d) => d.jobStatus === 'open').length;
  const closedN = customersOf(S, yearDeals).filter((d) => d.jobStatus === 'closed').length;
  const [said, setSaid] = useState('');
  const tabs: [typeof v, ReactNode, number | null, string?][] = [
    // five tabs fit a phone's row: the first reads "ตาราง" there
    ['table', <>ตาราง<span className="sl-long">ติดตาม</span></>, openN],
    ['dash', 'Dashboard', null],
    ['cash', 'Cashflow', null, 'เงินเข้าตามปี: รับแล้วนับตามวันที่รับ ที่ยังไม่รับนับตามวันครบกำหนด'],
    ['closed', 'ปิดงาน', closedN, 'งานที่กด “ปิดงาน” แล้ว ทั้งได้งานและไม่ได้งาน · เปิดกลับได้ · ยอดยังนับในสรุปปี'],
    ['log', <>ประวัติ<span className="sl-long">การแก้ไข</span></>, null],
  ];
  // Cashflow is for an account that may see it (ดู Cashflow): without it the tab goes, and a remembered
  // choice of it opens the table
  const cashOk = e.can('view.cash');
  if (!cashOk) tabs.splice(2, 1);
  const view = v === 'cash' && !cashOk ? 'table' : v;

  return (
    <>
      <PageHead
        title="Sales Tracker"
        sub="ตารางติดตามสถานะการขาย · ทั้งทีมเห็นข้อมูลเดียวกัน"
        right={
          <div className="sl-ph-r">
            {/* the year picks the table (and the Dashboard, ปิดงาน and history follow it); a date range goes
                back to the whole year, the other filters stay */}
            <Select
              variant="head"
              value={year}
              shown={`ปี ${year}`}
              label="ปี (พ.ศ.)"
              ariaLabel={`ปี ${year} (พ.ศ.)`}
              width={240}
              search={false}
              options={years.map((y) => ({ v: y, label: `ปี ${y}`, sub: yearSub(y), n: moneyLines ? yearMoneyLabel(cashYear(moneyLines, y)) : perYear.get(y) ? `${fmtN(perYear.get(y)!)} งาน` : 'ยังไม่มีงาน' }))}
              onChange={(y) => {
                set({ slYear: y, slF: toSlF({ ...f, date: null }), slCollapsed: {} });
                setSaid(f.date ? `ช่วงเวลากลับเป็นทั้งปี ${y}` : '');
              }}
            />
            {e.can('edit.deal') && <AddMenu />}
            <MoreMenu year={year} deals={[...shown.filter((d) => d.jobStatus === 'open'), ...closedRows]} />
          </div>
        }
      />
      <span className="sr-only" role="status">{said}</span>
      {e.docMsg && <Notice kind="error">{e.docMsg}</Notice>}
      <BillsStuckNote />
      {ui.slNote && (
        <Notice kind="ok" role="status">
          {ui.slNote}
          <button className="quiet" onClick={() => set({ slNote: '' })}>ซ่อน</button>
        </Notice>
      )}
      <div className="sl-tabbar">
        <div role="tablist" aria-label="Sales Tracker" className="utabs">
          {tabs.map(([k, label, n, title]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => set({ slView: k })} title={title}>
              <span>{label}</span>
              {n != null && <span className="n">{fmtN(n)}</span>}
            </button>
          ))}
        </div>
        {view === 'cash' ? (
          <span className="sl-close-hint cf-hint">
            <b>เงินเข้าตามปี</b>
            <span className="sl-long"> นับแต่ละงวดในปีที่รับเงินหรือครบกำหนด ไม่ว่างานเป็นของปีไหน</span>
          </span>
        ) : (
          <span className="sl-close-hint">
            <b>ได้งาน (YES) ยังไม่ใช่ปิดงาน</b>
            <span className="sl-long"> กดปิดงานเมื่องานจบ แล้วงานจะย้ายไปแท็บ “ปิดงาน”</span>
          </span>
        )}
      </div>
      <p className="sl-m-hint">
        {view === 'cash' ? <><b>เงินเข้าตามปี</b> นับแต่ละงวดในปีที่รับเงินหรือครบกำหนด ไม่ว่างานเป็นของปีไหน</> : <><b>ได้งาน (YES) ยังไม่ใช่ปิดงาน</b> ปิดงานแล้วงานจะย้ายไปแท็บ “ปิดงาน”</>}
      </p>
      {view === 'table' && <TableView e={e} S={S} F={fT} deals={shown.filter((d) => d.jobStatus === 'open')} base={noQuick.filter((d) => d.jobStatus === 'open')} all={noQuick} facets={tableYear} today={today} openN={openN} />}
      {view === 'dash' && <SalesDash S={S} deals={yearDeals} today={today} year={ui.slYear} />}
      {view === 'cash' && <CashView S={S} today={today} year={ui.slYear} />}
      {view === 'closed' && <ClosedView S={S} F={f} deals={closedRows} facets={yearDeals} total={closedN} today={today} />}
      {view === 'log' && <LogView S={S} year={year} />}
    </>
  );
}

// ------------------------------------------------------------------ menus

/** Keeps an open drop-down menu (`[role=menu]` in `box`, under its button) in view: moved sideways into
 *  the window (on a phone the page's buttons wrap to the left, and a menu anchored at their right edge
 *  would start off screen), and opened upward (`up`) when the page's scroll area has no room for it
 *  below the button but more above. */
function useFitMenu(open: boolean, box: RefObject<HTMLElement | null>) {
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    const m = box.current?.querySelector<HTMLElement>('[role=menu]');
    if (!open || !m) return setUp(false);
    const r = m.getBoundingClientRect(), b = box.current!.getBoundingClientRect(), pad = 12;
    const dx = r.left < pad ? pad - r.left : r.right > innerWidth - pad ? Math.max(pad - r.left, innerWidth - pad - r.right) : 0;
    if (dx) m.style.translate = `${Math.round(dx)}px 0`;
    const sc = document.getElementById('scroller')?.getBoundingClientRect();
    const below = Math.min(innerHeight, sc?.bottom ?? innerHeight) - r.bottom, above = b.top - Math.max(0, sc?.top ?? 0) - 6;
    setUp(below < pad && above > r.height + pad);
  }, [open, box]);
  return up;
}

/** A drop-down menu: closes when focus leaves it, or on Escape (focus goes back to its button); ↑ / ↓
 *  move between its items. Choosing an item also puts focus back on the button, so a dialog it opens
 *  returns there. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => {
    btn.current?.focus();
    setOpen(false);
  };
  // the first item takes the keyboard when the menu opens
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  }, [open]);
  const up = useFitMenu(open, ref);
  const wrap = {
    ref,
    onBlur: (ev: ReactFocusEvent) => {
      if (open && !ref.current?.contains(ev.relatedTarget as Node) && !insidePop(ev.relatedTarget)) setOpen(false);
    },
    onKeyDown: (ev: ReactKeyboardEvent) => {
      if (!open) return;
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        close();
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') || [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        ev.preventDefault();
      }
    },
  };
  return { open, setOpen, close, btn, wrap, cls: 'menu sl-menu' + (up ? ' up' : '') };
}

function AddMenu() {
  const { engine: e, ui, set, go } = useApp();
  const { open, setOpen, close, btn, wrap, cls } = useMenu();
  // companies being followed that are not in this year's table yet, in บริษัทที่ติดตาม's order (what needs doing
  // first; worked out while the menu is open): one send takes at most TRACKER_MAX of them (lib/bulk.ts)
  const notIn = open ? followRows(e, ui.slYear || beYear(), todayISO()).filter((r) => !r.deal).map((r) => r.c.id) : [];
  const batch = followedBatch(notIn), fw = followedMenuWords(notIn.length);
  return (
    <div {...wrap} className="sl-menuw">
      <button ref={btn} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} className="btn pri">เพิ่มลูกค้า</button>
      {open && (
        <div role="menu" aria-label="เพิ่มลูกค้า" className={cls}>
          <button role="menuitem" className="menu-i" onClick={() => { close(); go('search'); setTimeout(() => document.getElementById('search-q')?.focus(), 60); }}>
            ค้นหาบริษัทในทะเบียน<small>แล้วส่งเข้า Sales Tracker</small>
          </button>
          {notIn.length > 0 && (
            <button role="menuitem" className="menu-i" onClick={() => { close(); set({ sendIds: batch.ids, sendMore: batch.more }); }}>
              {fw.label}<small>{fw.sub}</small>
            </button>
          )}
          <button role="menuitem" className="menu-i" onClick={() => { close(); set({ addCust: { deal: true } }); }}>
            ลูกค้าใหม่ (ไม่มีในทะเบียน)<small>กรอกข้อมูลเอง</small>
          </button>
          {e.canJoint() && (
            <>
              <hr />
              <button role="menuitem" className="menu-i" onClick={() => { close(); set({ jqDlg: { k: 'new' } }); }}>
                สร้างใบเสนอราคาร่วม<small>ใบเดียว หลายบริษัท เช่น CFP ของ มจพ</small>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MoreMenu({ year, deals }: { year: string; deals: Deal[] }) {
  const { engine: e, ui, set } = useApp();
  const yearTotal = Object.values(e.sales.deals).filter((d) => d.year === year).length;
  const { open, setOpen, close, btn, wrap, cls } = useMenu();
  const [lists, setLists] = useState(false);
  const [units, setUnits] = useState(false);
  const [imp, setImp] = useState<{ msg: string; err?: boolean; years?: string[]; batch?: string; n?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The Buddhist-era year a JSON backup belongs to (it doesn't say): 25xx, or a 20xx year converted after a confirm. */
  const askYear = (f: File): string | null => {
    const m = /(25\d\d)/.exec(f.name);
    let def = m ? m[1] : year;
    for (;;) {
      const ans = window.prompt('ไฟล์สำรองของ Sales Tracker เดิมไม่ได้บอกปี ข้อมูลนี้เป็นของปี พ.ศ. ใด? (เช่น 2569)', def);
      if (ans == null || !ans.trim()) return null;
      const y = beYearInput(ans);
      if (y && !y.ce) return y.year;
      if (y && window.confirm(`${y.ce} เป็นปี ค.ศ. นำเข้าเป็นปี พ.ศ. ${y.year} ใช่ไหม?`)) return y.year;
      if (!y) window.alert(`"${ans.trim()}" ไม่ใช่ปี พ.ศ. ใส่ปี พ.ศ. 4 หลัก เช่น ${year}`);
      def = y ? y.year : year;
    }
  };
  const doImport = async (f: File) => {
    let y = year;
    if (f.name.toLowerCase().endsWith('.json')) {
      const ans = askYear(f);
      if (!ans) return;
      y = ans;
    }
    setImp({ msg: 'กำลังนำเข้า…' });
    try {
      const r = await e.importTracker(f, y);
      setImp({
        years: r.years,
        batch: r.deals ? r.batch : undefined,
        n: r.deals,
        msg: [
          `เพิ่ม ${fmtN(r.deals)} รายการ (ปี ${r.years.join(', ')})`,
          r.skipped ? `ข้าม ${fmtN(r.skipped)} รายการที่มีอยู่แล้ว (ไม่เขียนทับข้อมูลที่ทีมแก้ไว้)` : '',
          `เชื่อมกับบริษัทในทะเบียน ${fmtN(r.linked)} ราย`,
          r.ambiguous ? `${fmtN(r.ambiguous)} รายมีบริษัทชื่อเดียวกันหลายแห่ง ยังไม่ได้เชื่อม เปิดรายการแล้วเลือกบริษัทเอง` : '',
          r.inexact ? `${fmtN(r.inexact)} รายการมีจำนวนเงินที่ไม่ใช่ตัวเลขล้วน (เช่น ช่วงราคา) ใช้ค่าต่ำสุด และเก็บข้อความเดิมไว้ในประวัติ ตรวจอีกครั้ง` : '',
        ].filter(Boolean).join(' · '),
      });
    } catch (err) {
      setImp({ msg: 'นำเข้าไม่สำเร็จ: ' + ((err as Error)?.message || err), err: true });
    }
  };
  return (
    <div {...wrap} className="sl-menuw">
      <button ref={btn} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="เพิ่มเติม" title="เพิ่มเติม" className="btn more">
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div role="menu" aria-label="เพิ่มเติม" className={cls}>
          {ui.slView === 'cash' && (
            <button role="menuitem" className="menu-i" onClick={() => { close(); set({ slCashCsv: true }); }}>
              ส่งออก CSV · Cashflow ปี {year}
              <small>รายงวด หรือสรุปรายเดือน / รายไตรมาส</small>
            </button>
          )}
          <button role="menuitem" className="menu-i" onClick={() => { close(); e.exportSalesCsv(year, deals); }}>
            {/* the table's filters apply (also when another tab is open): say so */}
            ส่งออก CSV
            <small>{deals.length < yearTotal ? `${fmtN(deals.length)} จาก ${fmtN(yearTotal)} รายการ ตามตัวกรอง` : `ทั้งตาราง ${fmtN(yearTotal)} รายการ · เปิดใน Excel`}</small>
          </button>
          {e.can('set.data') && <button role="menuitem" className="menu-i" onClick={() => { close(); fileRef.current?.click(); }}>นำเข้าจาก Sales Tracker เดิม<small>ไฟล์สำรอง JSON หรือ CSV / Excel</small></button>}
          {e.can('set.lists') && <button role="menuitem" className="menu-i" onClick={() => { close(); setLists(true); }}>จัดการหมวด / SOURCE / Services</button>}
          {/* units and commission rates (package dash): for ตั้งค่าหน่วยงานและอัตราคอมมิชชั่น, where commission is private */}
          {e.can('set.units') && e.seesComm() && <button role="menuitem" className="menu-i" onClick={() => { close(); setUnits(true); }}>หน่วยงานและค่าคอมมิชชั่น<small>สัดส่วนรายได้และอัตรา %</small></button>}
        </div>
      )}
      <input ref={fileRef} type="file" accept=".json,.csv,.xlsx" style={{ display: 'none' }} onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) doImport(f); }} />
      {imp && (
        <Modal title="นำเข้าจาก Sales Tracker เดิม" onClose={() => setImp(null)}>
          <Notice kind={imp.err ? 'error' : 'ok'} role="status">{imp.msg}</Notice>
          {imp.years && imp.years.some((y) => y !== year) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {imp.years.filter((y) => y !== year).map((y) => (
                <button key={y} onClick={() => { set({ slYear: y, slView: 'table' }); setImp(null); }} className="btn sm">ดูตารางปี {y}</button>
              ))}
            </div>
          )}
          {imp.batch && (
            <button
              onClick={() => {
                if (!window.confirm(`ยกเลิกการนำเข้านี้? ${fmtN(imp.n || 0)} รายการที่เพิ่งนำเข้าจะถูกลบออกจาก Sales Tracker ของทั้งทีม (นำเข้าไฟล์ใหม่ได้ภายหลัง)`)) return;
                const n = e.undoImport(imp.batch!);
                setImp({ msg: `ยกเลิกการนำเข้าแล้ว ลบ ${fmtN(n)} รายการ` });
              }}
              className="btn sm"
              style={{ alignSelf: 'flex-start' }}
            >
              ยกเลิกการนำเข้านี้
            </button>
          )}
          <span className="t-meta" style={{ lineHeight: 1.6 }}>
            ใช้ไฟล์ได้ 2 แบบ: ไฟล์ "สำรองข้อมูล (JSON)" จากเมนูเพิ่มเติมของ Sales Tracker เดิม หรือ Google Sheet ของ Sales Tracker เดิมที่ดาวน์โหลดเป็น CSV / Excel (เมนู ไฟล์ แล้วเลือก ดาวน์โหลด)
          </span>
        </Modal>
      )}
      {lists && <ListsModal onClose={() => setLists(false)} />}
      {units && <UnitsDialog onClose={() => setUnits(false)} />}
    </div>
  );
}

function ListsModal({ onClose }: { onClose: () => void }) {
  const { engine: e } = useApp();
  useEngineVersion();
  const C = e.sales.cfg;
  const box = (name: 'sections' | 'sources' | 'services', title: string, hint: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="card-t" style={{ fontSize: 14 }}>{title}</span>
      <span className="t-meta">{hint}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {C[name].map((x) => (
          <span key={x} className="sl-litem">
            {/* a หมวด's name is its rename button (no "เปลี่ยนชื่อ" link on every item) */}
            {name === 'sections' ? (
              <button className="sl-litem-n hv-tx" title="เปลี่ยนชื่อ" aria-label={'เปลี่ยนชื่อ ' + x} onClick={() => { const n = window.prompt('ชื่อหมวดใหม่', x); if (n) e.renameSection(x, n); }}>{x}</button>
            ) : (
              x
            )}
            <button title="ลบ" aria-label={'ลบ ' + x} onClick={() => window.confirm(`ลบ "${x}" ออกจากรายการ? (รายการที่ใช้อยู่ยังคงเดิม)`) && e.setSalesList(name, C[name].filter((y) => y !== x))} className="sl-litem-x"><Icon name="close" size={12} /></button>
          </span>
        ))}
      </div>
      <form onSubmit={(ev) => { ev.preventDefault(); const inp = ev.currentTarget.elements.namedItem('v') as HTMLInputElement; if (inp.value.trim()) e.setSalesList(name, [...C[name], inp.value]); inp.value = ''; }} style={{ display: 'flex', gap: 8 }}>
        <input name="v" placeholder="เพิ่มใหม่…" aria-label={'เพิ่มใน ' + title} className="fld" style={{ height: 36, flex: 1, minWidth: 0 }} />
        <button type="submit" className="btn sm">เพิ่ม</button>
      </form>
    </div>
  );
  return (
    // its fields only add to the lists: focus the dialog (a phone would pop its keyboard up for a field)
    <Modal title="จัดการรายการ" onClose={onClose} width={640} focus="dialog">
      {box('sections', 'หมวด (กลุ่มแถวในตาราง)', 'แต่ละลูกค้าอยู่ในหมวดเดียว เช่น ช่องทางที่ได้ลูกค้ามา · กดที่ชื่อหมวดเพื่อเปลี่ยนชื่อ')}
      {box('sources', 'SOURCE (ช่องทาง)', 'ติ๊กได้หลายช่องต่อหนึ่งลูกค้า ใช้ในกราฟและอัตราได้งานตามช่องทาง')}
      {box('services', 'Services (บริการ)', 'บริการที่เสนอให้ลูกค้า')}
    </Modal>
  );
}

// ------------------------------------------------------------------ filters and quick views

/**
 * Above the rows (filters spec §6.1). Table tab: the quick views and the search, then the filter row: the
 * date chip, ผู้รับผิดชอบ (the same filter as "ของฉัน"), "เฉพาะงวดเลยกำหนด" when reached from ค้างรับ, the
 * chips in use, "เพิ่มตัวกรอง", "ล้างทั้งหมด" and "แสดง 5 จาก 32 งาน". ปิดงาน: no quick views, the search leads
 * the filter row. Filters are view state only: an account that can only read uses them too.
 */
function Toolbar({ S, F, yearDeals, base, today, job, shown, total }: { S: SalesState; F: SalesFilter; yearDeals: Deal[]; base?: Deal[]; today: string; job: 'open' | 'closed'; shown: number; total: number }) {
  const { engine: e, ui, set } = useApp();
  const ver = useEngineVersion();
  const me = e.me();
  const up = (p: Partial<SalesFilter>, more?: Partial<UIState>) => set({ slF: toSlF({ ...F, ...p }), ...more });
  const mine = !!me && !!F.resp && !F.resp.not && F.resp.v.length === 1 && F.resp.v[0] === me;
  const quick = F.quick || '';
  const seg = quick === 'paylate' ? 'payment' : quick;
  const views: [QuickView, string][] = [['', 'ทั้งหมด'], ['overdue', 'ค้างติดตาม'], ['notstarted', 'ยังไม่เริ่ม'], ['active', 'กำลังติดตาม'], ['payment', 'รอชำระเงิน'], ['ready', 'พร้อมปิดงาน']];
  const pick = (q: QuickView) => up({ quick: q }, { slCollapsed: {} });
  // the quick views' counts: one pass each over the rows, the contact records indexed once (ค้างติดตาม reads them)
  const cust = base ? customersOf(S, base) : [];
  const viewN = base ? withActIndex(S, () => views.map(([k]) => (k ? cust.filter((d) => quickMatch(S, d, k, today)).length : cust.length))) : [];
  const anyLate = !!base && withActIndex(S, () => base.some((d) => quickMatch(S, d, 'paylate', today)));
  // the counts in the field menu follow the search too, a little behind the typing (six passes over the year)
  const key = useDeferredValue(JSON.stringify(ui.slF));
  // (the lens "เงินเข้าตามปี" counts the other years' jobs with money in this one too)
  const fields = useMemo(() => trackerFields(S, normSalesFilter({ year: F.year, ...JSON.parse(key), money: F.money }), { yearDeals, job, me, today }), [ver, key, F.year, F.money, job, me, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const value: Record<string, FVal | undefined> = { resp: F.resp, source: F.source, service: F.service, referral: F.referral, section: F.section, result: F.result ? { v: [F.result] } : undefined };
  const toF = (k: string, v: FVal | null): Partial<SalesFilter> => (k === 'result' ? { result: (v?.v[0] || '') as ResultF } : { [k]: v || undefined });
  const search = (
    <label className="sl-search">
      <Icon name="search" size={17} />
      <input
        value={F.q || ''}
        onChange={(ev) => {
          const q = ev.target.value;
          up({ q }, q.trim() && !(F.q || '').trim() ? { slCollapsed: {} } : undefined);
        }}
        placeholder="ค้นหาบริษัท / ผู้ติดต่อ / โน้ต"
        aria-label="ค้นหา"
      />
    </label>
  );
  // the closed tab has no quick views: เฉพาะงวดเลยกำหนด is neither shown nor counted there
  const on = narrowed(job === 'open' ? F : { ...F, quick: '' });
  return (
    <div className="sl-filt">
      {base && (
        <div className="sl-tools">
          <div className="seg sl-seg" role="group" aria-label="มุมมอง">
            {/* the jobs of whoever is using this browser: ผู้รับผิดชอบ คือ (me), on top of any view */}
            {me && (
              <button type="button" aria-pressed={mine} onClick={() => up({ resp: mine ? undefined : { v: [me] } }, { slCollapsed: {} })} title={mine ? 'แสดงงานของทุกคน' : `เฉพาะงานที่ ${me} รับผิดชอบ`}>
                ของฉัน<span className="n">{fmtN(cust.filter((d) => d.resp === me).length)}</span>
              </button>
            )}
            {views.map(([k, label], i) => {
              const n = viewN[i];
              const od = (k === 'overdue' && n > 0) || (k === 'payment' && anyLate);
              return (
                <button key={k || 'all'} type="button" aria-pressed={seg === k} onClick={() => pick(k)}>
                  {label}<span className={'n' + (od ? ' od' : '')}>{fmtN(n)}</span>
                </button>
              );
            })}
          </div>
          {search}
        </div>
      )}
      <FilterBar
        fields={fields}
        value={value}
        onChange={(k, v) => up(toF(k, v))}
        search={base ? undefined : search}
        lead={
          <>
          {job === 'open' && e.can('view.cash') && <LensChip S={S} year={F.year} today={today} value={ui.slLens} onChange={(slLens) => set({ slLens, slCollapsed: {} })} onCashTab={() => set({ slView: 'cash' })} />}
          <DateFilter
            value={F.date}
            onChange={(date) => up({ date })}
            year={F.year}
            today={today}
            count={(draft) => liveCount(S, F, 'date', draft, job, today)}
            monthCounts={(basis, y) => monthCounts(S, F, basis, y, job, today)}
            // open jobs have no closing date: say where the jobs closed in the range are (the KPIs count them)
            elsewhere={job === 'open' ? (draft) => (draft.basis === 'closed' ? `อยู่ในแท็บ “ปิดงาน” ${fmtN(liveCount(S, F, 'date', draft, 'closed', today))} งาน` : null) : undefined}
          />
          </>
        }
        extra={job === 'open' && quick === 'paylate' ? <ReadChip text="เฉพาะงวดเลยกำหนด" onClear={() => pick('payment')} /> : undefined}
        anySet={on}
        // chips and the search go; the quick view stays (เฉพาะงวดเลยกำหนด goes back to รอชำระเงิน)
        onClearAll={() => set({ slF: job === 'open' ? { quick: quick === 'paylate' ? 'payment' : quick } : { quick: F.quick }, slCollapsed: {} })}
        count={on ? { shown, total } : null}
        liveCount={(k, d) => liveCount(S, F, k, k === 'result' ? ((d?.v[0] || '') as ResultF) : d, job, today)}
      />
    </div>
  );
}

/** In place of the rows when the filters leave none: "ล้างทั้งหมด" resets every filter, the quick view too. */
function NoMatch({ text }: { text: string }) {
  const { set } = useApp();
  return (
    <span className="sl-nomatch">
      <span role="status">{text}</span>
      <button type="button" onClick={() => set({ slF: {} })} className="quiet">ล้างทั้งหมด</button>
    </span>
  );
}

/** The KPI cards (design §7.1): the year's money (open and closed jobs: closing a paid job must not take
 *  its revenue out of the totals), what is still to be received, and the share of jobs won. They follow
 *  the filters (the date range too), not the quick view; money is each matching job's whole figure, and
 *  the caption says the range. Only the footers of รับเงิน and ครบกำหนดชำระ count money inside the range. */
function Kpis({ S, open, all, today, year, date, attr }: { S: SalesState; open: Deal[]; all: Deal[]; today: string; year: string; date: DateIn | null; attr: boolean }) {
  const { ui, set } = useApp();
  // a joint quotation once (under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter: the parts of its companies shown)
  const st = salesStats(S, all, today, attr);
  const rc = receivables(S, open, today, attr);
  const { fcOpen, fcClosed } = moneySum(S, all, attr);
  const m = (n: number) => fmtMoney(Math.round(n)) || '0';
  const pct = st.forecast > 0 ? Math.round((st.actual / st.forecast) * 100) : null;
  const words = date ? BASIS_TH[date.basis] : null;
  const label = date && words ? <>Forecast รวม · {words.short} <span className="sl-kpi-r">{rangeTh(date.r, { dropYear: year })}</span></> : `Forecast รวม · ปี ${year}`;
  const title = date && words ? `นับเฉพาะงานตามตัวกรอง · ${words.sent} ${rangeTh(date.r)} · ตัวเลขเป็นยอดเต็มของแต่ละงาน` : undefined;
  const got = date?.basis === 'paid' ? receivedIn(S, all, date.r, today, attr) : null;
  const owed = date?.basis === 'due' ? owedIn(S, all, date.r, today, attr) : null;
  return (
    <div className="kpis sl-kpis">
      <Kpi hero label={label} title={title} value={m(st.forecast)} unit="บาท" foot={<>งานเปิด <b>{m(fcOpen)}</b> · ปิดแล้ว <b>{m(fcClosed)}</b></>} />
      <Kpi
        label="Actual รวม"
        value={m(st.actual)}
        unit="บาท"
        zero={!st.actual}
        foot={
          got != null ? (
            <>รับในช่วงนี้ <b>{m(got)}</b>{st.forecast > 0 && got > 0 ? <> · {Math.round((got / st.forecast) * 100)}% ของ Forecast</> : null}</>
          ) : pct != null ? (
            <><b className="ok">{pct}%</b> ของ Forecast</>
          ) : (
            'ยังไม่มี Forecast'
          )
        }
      />
      <Kpi
        label="ค้างรับ"
        value={m(rc.receivable)}
        unit="บาท"
        zero={!rc.receivable}
        foot={
          <span className="sl-kpi-two">
            {rc.late ? (
              <button type="button" className="lnk sl-kpi-link" onClick={() => set({ slF: { ...ui.slF, quick: 'paylate' }, slCollapsed: {} })} title="ดูเฉพาะงานที่มีงวดเลยกำหนดรับเงิน">
                เลยกำหนด <b>{m(rc.late)}</b>
              </button>
            ) : (
              <span>ไม่มีงวดเลยกำหนด</span>
            )}
            {owed != null ? <span>ค้างในช่วงนี้ <b>{m(owed)}</b></span> : <span>ถึงกำหนดเดือนนี้ {m(rc.dueMonth)}</span>}
          </span>
        }
      />
      <Kpi label="อัตราได้งาน" value={st.decided ? st.winRate : '—'} unit={st.decided ? '%' : undefined} zero={!st.decided} foot={`ได้ ${fmtN(st.yes)} · ไม่ได้ ${fmtN(st.no)}`} />
    </div>
  );
}

// ------------------------------------------------------------------ the table

/** What the rows, child rows and phone cards share (one table at a time). */
interface Tk {
  e: Engine; S: SalesState; today: string; ro: boolean; team: string[];
  /** the date filter in force: the rows show its date (the contact column keeps its editor on the default basis) */
  date: DateIn | null; year: string;
  /** the lens "เงินเข้าตามปี": the money cells count the year's installments (null = by the deal's year) */
  cash: CashLens | null;
  /** the deal being worked on (open, or opened last) */
  cur: string | undefined;
  edit: UIState['slEdit'];
  menu: string; setMenu: (id: string) => void;
  pop: string; setPop: (id: string) => void;
  toggle: (id: string, focusChev?: boolean) => void;
  /** `act`: the quick-add of a contact record (at `stage`) instead of the stage's own editor */
  openEditor: (id: string, stage: string, trigger?: HTMLElement | null, act?: boolean) => void;
  closeEditor: () => void;
  attach: (deal: Deal, stage?: string, kind?: DocKind, more?: AttachMore) => void;
  openPanel: (id: string, plan?: UIState['dpPlan']) => void;
  acts: ReturnType<typeof useSalesActs>;
  dup: (d: Deal) => boolean;
}
const TkCtx = createContext<Tk | null>(null);
const useTk = () => useContext(TkCtx)!;
/** Notes typed in a stage editor and left with Escape: back when it opens again (this session only). */
const drafts = new Map<string, string>();

/** The page scroller: the app window's content on desktop, the page itself on phones. */
const scroller = () => (window.innerWidth > 900 ? document.getElementById('scroller') : null);
const stickyTop = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top')) || 0;

function TableView({ e, S, F, deals, base, all, facets, today, openN }: { e: Engine; S: SalesState; F: SalesFilter; deals: Deal[]; base: Deal[]; all: Deal[]; facets: Deal[]; today: string; openN: number }) {
  const { ui, set } = useApp();
  const date = dateIn(F, today);
  const mobile = useMedia('(max-width: 760px)');
  const acts = useSalesActs();
  // the lens "เงินเข้าตามปี": each deal's money in the year (a date range narrows it), and the cards over the
  // same money (the year's, or the range's: they say which)
  // a ผู้รับผิดชอบ / SOURCE / REFERRAL filter counts a joint quotation by the parts of its companies shown
  const attr = jointAttr(F);
  const cash = ui.slLens === 'cash' && e.can('view.cash') ? cashLensOf(S, all, ui.slYear, date?.r ?? null, today, attr) : null;
  // an account that may not edit deals: no adding, no stage notes, no edits in the rows (one that may
  // edit only its own deals gets each row's own answer, ForDeal)
  const ro = !e.can('edit.deal');
  const money = e.can('view.money');
  const cardRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState('');
  const [pop, setPop] = useState('');
  const [att, setAtt] = useState<{ deal: Deal; stage?: string; kind?: DocKind; more?: AttachMore } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const editSeq = useRef(0);
  // each section's rows: a joint quotation as a band at the top of its header's section with its members
  // under it (lib/joint jointRows), then the other rows
  const { secs: visible, rows: bySec } = jointRows(S, deals);
  const [jqFold, setJqFold] = useState<Record<string, 1>>({});
  const foldJq = (id: string) => setJqFold((x) => (x[id] ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== id)) : { ...x, [id]: 1 }));
  // one company twice in the year (two people sent it at the same moment): marked, to delete one (the lens's
  // jobs of other years are not the year's rows; a joint quotation's header, the payer's row for it, and its
  // members are rows of their own on purpose)
  const perCo = new Map<number, number>();
  facets.forEach((d) => d.gid != null && d.year === ui.slYear && jointRole(S, d) === 'plain' && perCo.set(e.canonical(d.gid), (perCo.get(e.canonical(d.gid)) || 0) + 1));
  const cur = ui.deal || ui.last.deal;

  const toggle = (id: string, focusChev = false) => {
    set((s) => {
      const open = { ...s.slOpen }, all = { ...s.slShowAll };
      if (open[id]) {
        delete open[id];
        delete all[id];
      } else open[id] = 1;
      return { slOpen: open, slShowAll: all, slEdit: !open[id] && s.slEdit?.id === id ? null : s.slEdit };
    });
    if (focusChev) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-chev="${id}"]`)?.focus({ preventScroll: true }));
  };
  const openEditor = (id: string, stage: string, t?: HTMLElement | null, act?: boolean) => {
    trigger.current = t || null;
    editSeq.current++;
    setMenu('');
    setPop('');
    // the stage edited from the table marks its row too (the row you are working on)
    set((s) => ({ slEdit: act ? { id, stage, act: 1 } : { id, stage }, slOpen: { ...s.slOpen, [id]: 1 }, last: { ...s.last, deal: id } }));
  };
  const closeEditor = () => {
    const was = ui.slEdit, t = trigger.current, seq = ++editSeq.current;
    trigger.current = null;
    set({ slEdit: null });
    // back to what opened it, or the deal's chevron (phones: its card toggle) when that is gone
    requestAnimationFrame(() => {
      if (seq !== editSeq.current) return; // another editor opened meanwhile: it has the keyboard
      const back = t?.isConnected ? t : was && document.querySelector<HTMLElement>(was.act ? `[data-qa="${was.id}:act"]` : `[data-chev="${was.id}"],[data-tog="${was.id}"]`);
      back?.focus({ preventScroll: true });
    });
  };
  const tk: Tk = {
    e, S, today, ro, team: e.crm.team, date, year: ui.slYear, cash, cur, edit: ui.slEdit, menu, setMenu, pop, setPop, toggle, openEditor, closeEditor, acts,
    attach: (deal, stage, kind, more) => {
      setMenu('');
      if (ui.slEdit) set({ slEdit: null });
      // a document for the Actual at a stage accounting checked (or of a closed month): asked first
      askPay(e, { d: deal, lines: attachLines(S, deal.id, stage, kind, more?.target), kind: 'attach', title: 'แนบเอกสาร' + (stage ? ' ' + stage : ''), verb: 'แนบเอกสาร', run: () => setAtt({ deal, stage, kind, more }) });
    },
    openPanel: (id, plan = '') => {
      setMenu('');
      set({ deal: id, dpPlan: plan, slToast: null });
    },
    dup: (d) => d.gid != null && d.year === ui.slYear && jointRole(S, d) === 'plain' && (perCo.get(e.canonical(d.gid)) || 0) > 1,
  };

  // the section bars stick right under the column headings: their height (fonts, zoom) sets the offset
  const headObs = useRef<ResizeObserver | null>(null);
  const theadRef = useCallback((el: HTMLTableSectionElement | null) => {
    headObs.current?.disconnect();
    headObs.current = null;
    const card = el?.closest<HTMLElement>('.sl-card');
    if (!el || !card) return;
    const put = () => card.style.setProperty('--sl-head-h', Math.floor(el.getBoundingClientRect().height) + 'px');
    put();
    if (typeof ResizeObserver !== 'undefined') {
      headObs.current = new ResizeObserver(put);
      headObs.current.observe(el);
    }
  }, []);
  // back on the table (or after closing a deal): the marked row is brought into view
  useEffect(() => {
    if (cur && !ui.deal) cardRef.current?.parentElement?.querySelector('.sl-row[aria-current="true"], .sl-mc[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur, ui.deal]);
  // the open deal moved (its หมวด changed in the panel) into a folded section: that section unfolds
  const openSec = ui.deal ? S.deals[ui.deal]?.section : undefined;
  useEffect(() => {
    if (openSec == null || !ui.slCollapsed[openSec]) return;
    const c = { ...ui.slCollapsed };
    delete c[openSec];
    set({ slCollapsed: c });
  }, [openSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const headH = () => parseFloat(getComputedStyle(cardRef.current || document.documentElement).getPropertyValue('--sl-head-h')) || 52;
  // a row's date popover or ⋯ menu closes once its row scrolls under the stuck headings and band: it
  // would paint over them (the headings never show a row's content). The keyboard stays on its button.
  useEffect(() => {
    if (!menu && !pop) return;
    const onScroll = () => {
      const btn = document.querySelector<HTMLElement>(menu ? `.sl-more[aria-expanded="true"]` : `[data-cpop="${CSS.escape(pop)}"]`);
      if (!btn) return;
      const box = scroller();
      const line = (box ? box.getBoundingClientRect().top : 0) + stickyTop() + (mobile ? 0 : headH() + 48);
      if (btn.getBoundingClientRect().bottom > line) return;
      const inside = !!document.activeElement?.closest('.sl-menu, .sl-pop');
      setMenu('');
      setPop('');
      if (inside) btn.focus({ preventScroll: true });
    };
    // capture: the app window's scroller does not bubble its scroll
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [menu, pop, mobile]); // eslint-disable-line react-hooks/exhaustive-deps
  const allCol = visible.length > 0 && visible.every((x) => ui.slCollapsed[x]);
  const toggleAll = () => set({ slCollapsed: allCol ? {} : { ...ui.slCollapsed, ...Object.fromEntries(visible.map((x) => [x, 1 as const])) } });
  /** Fold or unfold a section. Folding from a stuck bar first brings the section's start up to where the
   *  bar is stuck, so the bar stays put and the next section follows right under it. */
  const fold = (sec: string, el: HTMLElement) => {
    const col = !!ui.slCollapsed[sec];
    const grp = el.closest<HTMLElement>('tbody.sl-group, section.sl-mgroup');
    if (!col && grp) {
      const box = scroller();
      const line = (box ? box.getBoundingClientRect().top : 0) + stickyTop() + (mobile ? 0 : headH()) - 1;
      const dy = grp.getBoundingClientRect().top - line;
      if (dy < -1) (box ? (box.scrollTop += dy) : window.scrollBy(0, dy));
    }
    const c = { ...ui.slCollapsed };
    if (col) delete c[sec];
    else c[sec] = 1;
    set({ slCollapsed: c });
  };
  // a control reached with Tab must not sit under the stuck headings and band (the browser leaves it
  // there). Only right after a Tab: a click is left alone, so rows do not move under the pointer.
  const tabAt = useRef(0);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Tab' && (tabAt.current = Date.now());
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  const keepFocusInView = (ev: ReactFocusEvent<HTMLDivElement>) => {
    if (Date.now() - tabAt.current > 300) return;
    const t = ev.target as HTMLElement;
    if (t.closest('thead, tr.sl-sec')) return;
    const box = scroller();
    const cover = (box ? box.getBoundingClientRect().top : 0) + stickyTop() + headH() + 48 + 8;
    const top = t.getBoundingClientRect().top;
    if (top < cover) (box ? (box.scrollTop -= cover - top) : window.scrollBy(0, top - cover));
  };
  // the whole row opens and closes its steps; its controls keep their own action, and a drag that
  // selects text is not a click
  const rowClick = (ev: ReactMouseEvent) => {
    const t = ev.target as HTMLElement;
    const row = t.closest<HTMLElement>('tr.sl-row, .sl-mc-h');
    if (!row || t.closest('button,select,input,label,a,textarea,[role=menu],[role=dialog]')) return;
    if (window.getSelection()?.toString()) return;
    const id = row.dataset.id || row.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (id) toggle(id, !mobile);
  };

  /** A section's counts (its customers: plain rows and joint quotations' members) and money (plain rows and
   *  the joint quotations' headers, once; members carry none, but under a ผู้รับผิดชอบ / SOURCE / REFERRAL
   *  filter a joint quotation counts the parts of its companies shown). */
  const secSum = (rows: JRow[]) => {
    const list = rowDeals(rows), held = [...rows.flatMap((r) => (r.k === 'band' && r.inList ? [r.g.head] : [])), ...list];
    let od = 0, rd = 0;
    for (const d of list) {
      if (overdueDays(S, d, today) != null) od++;
      if (closeReady(S, d, today)) rd++;
    }
    let { fc, ac } = moneySum(S, held, attr);
    // the lens: the section's money in the year, and what of it came in
    if (cash) ({ fc, ac } = lensSum(cash, moneyHolds(S, held, attr).map((h) => h.d)));
    return { n: list.length, od, rd, fc, ac };
  };

  // a year with no jobs of its own: in the lens "เงินเข้าตามปี" the other years' jobs with money in it are its
  // table; otherwise the empty card says so, and offers the lens when such money exists
  if (!Object.values(S.deals).some((d) => d.year === ui.slYear) && !(cash && all.length)) {
    const from = cash ? [] : [...new Set(cashYear(cashLines(S, Object.values(S.deals), today), ui.slYear).lines.map((l) => l.dealYear))].sort();
    return (
      <div className="card sl-empty-card">
        <span className="card-t">ยังไม่มีลูกค้าในตารางปี {ui.slYear}</span>
        <span className="t-sec" style={{ lineHeight: 1.7 }}>
          {ro ? 'เมื่อทีมเพิ่มลูกค้า รายการจะแสดงที่นี่' : <>กด <b>เพิ่มลูกค้า</b> เพื่อค้นหาบริษัทในทะเบียนหรือเพิ่มลูกค้าใหม่ · ถ้ามีข้อมูลใน Sales Tracker เดิม ใช้เมนู ⋯ แล้วเลือก นำเข้าจาก Sales Tracker เดิม</>}
        </span>
        {from.length > 0 && (
          <span className="t-sec cf-elsewhere">
            ปี {ui.slYear} มีงวดเงินจากงานปี {from.join(', ')} · <button type="button" className="lnk" onClick={() => set({ slLens: 'cash', slCollapsed: {} })}>ดูแบบเงินเข้าตามปี</button>
          </span>
        )}
      </div>
    );
  }
  const stages = S.cfg.stages;
  return (
    <TkCtx.Provider value={tk}>
      {!money ? null : cash ? (
        <CashKpiRow K={cash.K} year={ui.slYear} range={date} onLate={() => set({ slF: { ...ui.slF, quick: 'paylate' }, slCollapsed: {} })} />
      ) : (
        <Kpis S={S} open={base} all={all} today={today} year={ui.slYear} date={date} attr={attr} />
      )}
      <Toolbar S={S} F={F} yearDeals={facets} base={base} today={today} job="open" shown={customersOf(S, deals).length} total={openN} />
      {cash && <LensNote year={ui.slYear} range={cash.range} onBack={() => set({ slLens: 'deal' })} />}
      {!deals.length ? (
        <div className="card sl-empty-card">
          {date?.basis === 'closed' ? (
            // open jobs have no closing date: the closed ones are on their own tab (the filters go along)
            <span className="sl-nomatch">
              <span role="status">งานที่ปิดแล้วอยู่ในแท็บ “ปิดงาน”</span>
              <button type="button" className="lnk" onClick={() => set({ slView: 'closed' })}>ดูในแท็บปิดงาน</button>
            </span>
          ) : narrowed(F) || F.quick ? (
            <NoMatch text="ไม่พบงานที่ยังเปิดตามตัวกรองนี้" />
          ) : (
            <span className="t-sec">ไม่มีงานที่ยังเปิดในปี {ui.slYear} งานที่ปิดแล้วอยู่ในแท็บ “ปิดงาน”</span>
          )}
        </div>
      ) : mobile ? (
        <div className="sl-mlist" onClick={rowClick}>
          {visible.length > 1 && (
            <div className="sl-mtools">
              <span>{fmtN(visible.length)} หมวด</span>
              <button type="button" className="lnk" onClick={toggleAll}>{allCol ? 'ขยายทุกหมวด' : 'ย่อทุกหมวด'}</button>
            </div>
          )}
          {visible.map((sec) => {
            const list = bySec.get(sec)!;
            const col = !!ui.slCollapsed[sec];
            const sum = secSum(list);
            const name = sec || 'ไม่ระบุหมวด';
            return (
              <section key={sec || '-'} className={'sl-mgroup' + (col ? ' closed' : '')} aria-label={'หมวด ' + name}>
                <div className="sl-msec">
                  <div className="sl-msec-bar">
                    <button type="button" className="sl-caret hv2" aria-expanded={!col} aria-label={(col ? 'แสดง' : 'ย่อ') + 'หมวด ' + name} onClick={(ev) => fold(sec, ev.currentTarget)}><Chevron /></button>
                    <span className="sl-s-tx">
                      <span className="sl-sec-name">{name}</span>
                      <SecMeta sum={sum} />
                    </span>
                    {money && <span className="sl-s-tot">{cash ? (cash.range ? 'ในช่วงนี้' : `ปี ${ui.slYear}`) : 'Forecast'} <b>{fmtMoney(sum.fc) || '0'}</b></span>}
                  </div>
                </div>
                {!col && list.map((r) => (r.k === 'deal' ? <ForDeal key={r.d.id} d={r.d}><DealCard d={r.d} /></ForDeal> : <JointCard key={'jq' + r.g.head.id} b={r} attr={attr} onOpen={(id) => tk.openPanel(id)} />))}
                {!col && !ro && <button type="button" className="lnk sl-m-add" onClick={() => addIn(e, set, sec, ui.slYear)}>เพิ่มลูกค้าในหมวด {name}</button>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="sl-card" ref={cardRef} onFocus={keepFocusInView} onClick={rowClick}>
          <table className={'sl-table' + (money ? '' : ' sl-nomoney')} aria-label={`Sales Tracker ปี ${ui.slYear} งานที่ยังเปิด`}>
            <colgroup>
              <col className="w-chev" /><col className="w-name" /><col className="w-resp" /><col className="w-src" /><col className="w-stage" />
              <col className="w-last" /><col className="w-fc" /><col className="w-ac" /><col className="w-st" /><col className="w-act" />
            </colgroup>
            <thead ref={theadRef}>
              <tr>
                <th className="k-chev"><span className="sr-only">ขยาย</span></th>
                <th className="k-name">
                  <span className="sl-th-name">
                    ลูกค้า
                    {visible.length > 1 && <button type="button" className="lnk sl-allbtn" onClick={toggleAll}>{allCol ? 'ขยายทุกหมวด' : 'ย่อทุกหมวด'}</button>}
                  </span>
                </th>
                <th className="k-resp"><span className="sl-th2">ผู้รับ</span><span className="sl-th2">ผิดชอบ</span></th>
                <th className="k-src" />
                <th className="k-stage">ขั้นตอน · ถัดไป</th>
                {date && date.basis !== 'contact' ? (
                  // the date the filter is about takes the column (its words in link blue)
                  <th className="k-last sl-th-basis" title={'วันที่ตามตัวกรอง: ' + BASIS_TH[date.basis].hint}>{BASIS_TH[date.basis].head}</th>
                ) : (
                  <th className="k-last" title="ติดต่อล่าสุด คือวันที่ติดต่อที่พิมพ์ไว้ วันที่ของขั้นตอนล่าสุด หรือการติดต่อที่บันทึกไว้ แล้วแต่วันไหนใหม่กว่า · เกิน 14 วันขึ้นว่า ค้าง">ติดต่อล่าสุด</th>
                )}
                {/* one short line under it: "และ Actual" in its place once the Actual column folds into this one */}
                {cash ? (
                  <>
                    <th className="k-fc" title={`ยอดของงวดที่รับหรือครบกำหนดในปี ${ui.slYear}${cash.range ? ' เฉพาะในช่วงที่เลือก' : ''}`}>เงินเข้าปี {ui.slYear}<small className="sl-th-fc">{cash.range ? 'งวดในช่วงนี้' : 'งวดในปีนี้'}</small><small className="sl-th-ac2">และรับแล้ว</small></th>
                    <th className="k-ac" title={`ยอดที่รับแล้วในปี ${ui.slYear}${cash.range ? ' เฉพาะในช่วงที่เลือก' : ''}`}>รับแล้ว<small>{cash.range ? 'ในช่วงนี้' : `ในปี ${ui.slYear}`}</small></th>
                  </>
                ) : (
                  <>
                    <th className="k-fc" title="Forecast คือยอดในใบเสนอราคาที่แนบที่ขั้น QUOTATION (หรือยอดที่พิมพ์เอง)">Forecast<small className="sl-th-fc">จาก QUOTATION</small><small className="sl-th-ac2">และ Actual</small></th>
                    <th className="k-ac" title={`Actual คือยอดใบแจ้งหนี้ / ใบเสร็จที่แนบที่ ${payStages(S.cfg).join(', ') || 'PAY'} รวมกัน`}>Actual<small>{actualSource(S.cfg)}</small></th>
                  </>
                )}
                <th className="k-st">สถานะ</th>
                <th className="k-act"><span className="sr-only">เพิ่มเติม</span></th>
              </tr>
            </thead>
            {visible.map((sec, gi) => {
              const list = bySec.get(sec)!;
              const col = !!ui.slCollapsed[sec];
              const sum = secSum(list);
              const name = sec || 'ไม่ระบุหมวด';
              return (
                <tbody key={sec || '-'} className={'sl-group' + (col ? ' closed' : '')}>
                  <tr className="sl-sgap" aria-hidden="true"><td colSpan={10} /></tr>
                  <tr className="sl-sec">
                    {/* named by the section name alone (not the whole bar) for the rows under it */}
                    <th scope="rowgroup" colSpan={6} aria-labelledby={'sl-sec-' + gi}>
                      <span className="sl-s-in">
                        <button type="button" className="sl-caret hv2" aria-expanded={!col} aria-label={(col ? 'แสดง' : 'ย่อ') + 'หมวด ' + name} onClick={(ev) => fold(sec, ev.currentTarget)}><Chevron /></button>
                        <span className="sl-sec-name" id={'sl-sec-' + gi}>{name}</span>
                        <SecMeta sum={sum} />
                      </span>
                    </th>
                    <td className="k-m2" colSpan={2}>
                      <span className="sl-m2">
                        <span className="k2-fc"><span className={'sl-s-sum' + (sum.fc ? '' : ' none')} title={cash ? `รวมเงินเข้า${cash.range ? 'ในช่วงนี้' : 'ปี ' + ui.slYear} ของหมวดนี้` : 'รวม Forecast ของหมวดนี้ (งานที่เปิด)'}>{sum.fc ? fmtMoney(sum.fc) : '—'}</span></span>
                        <span className="k2-ac"><span className={'sl-s-sum' + (sum.ac ? '' : ' none')} title={cash ? `รวมที่รับแล้ว${cash.range ? 'ในช่วงนี้' : 'ในปี ' + ui.slYear} ของหมวดนี้` : 'รวม Actual ของหมวดนี้ (งานที่เปิด)'}>{sum.ac ? fmtMoney(sum.ac) : '—'}</span></span>
                      </span>
                    </td>
                    <td className="sl-s-add" colSpan={2}>
                      {!ro && <button type="button" className="lnk sl-addbtn" onClick={() => addIn(e, set, sec, ui.slYear)} aria-label={'เพิ่มลูกค้าในหมวด ' + name}>เพิ่มในหมวดนี้</button>}
                    </td>
                  </tr>
                  {!col &&
                    list.map((r) =>
                      r.k === 'deal' ? (
                        <DealRows key={r.d.id} d={r.d} open={!!ui.slOpen[r.d.id]} stages={stages} />
                      ) : (
                        <JointBand key={'jq' + r.g.head.id} b={r} folded={!!jqFold[r.g.head.id]} onFold={() => foldJq(r.g.head.id)} ro={ro || !e.canDeal('edit.deal', r.g.head)} cash={cash} attr={attr} onOpen={(id, plan) => tk.openPanel(id, plan)} onRevise={(id) => tk.attach(r.g.head, QUOTE_STAGE, 'quotation', { target: 'forecast', revise: id })}>
                          {!jqFold[r.g.head.id] && r.shown.map((d, i) => <DealRows key={d.id} d={d} open={!!ui.slOpen[d.id]} stages={stages} jm={i === r.shown.length - 1 ? 'last' : 'mid'} />)}
                        </JointBand>
                      ),
                    )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      {!mobile && (
        <>
          <div className="sl-legend" aria-label="ความหมายของวงกลมและป้าย">
            <span><Bead state="done" />ทำแล้ว</span>
            <span><Bead state="future" now />ขั้นถัดไป</span>
            <span><Bead state="planned" />นัดไว้</span>
            <span><Bead state="yes" stage={DEAL_STAGE} />ได้งาน</span>
            <span><Bead state="no" stage={DEAL_STAGE} />ไม่ได้งาน</span>
            <span><Bead state="future" />ยังไม่ถึง</span>
            <span><span className="chip bad">ค้าง 15 วัน</span>ไม่ได้ติดต่อเกิน 14 วัน</span>
            <span><span className="chip bad">เลยกำหนด</span>งวดที่เลยวันครบกำหนดรับเงิน</span>
          </div>
          <p className="sl-foot">
            กดที่แถวลูกค้าเพื่อดูทุกขั้นตอน · กดปุ่มถัดไปเพื่อบันทึกในตารางได้เลย · ใบเสนอราคาที่ QUOTATION คือ Forecast · ใบเสร็จ / ใบแจ้งหนี้ที่ PAY แต่ละงวด คือ Actual · แผนการชำระพิมพ์ไว้ก่อนได้ที่หน้ารายละเอียดของลูกค้า
          </p>
        </>
      )}
      {att && <DocAttach deal={att.deal} stage={att.stage} kind={att.kind} {...att.more} onClose={() => setAtt(null)} />}
    </TkCtx.Provider>
  );
}

/** A new row in a section, opened in the panel to fill in. */
function addIn(e: Engine, set: ReturnType<typeof useApp>['set'], sec: string, year: string) {
  const d = e.addDeal({ client: 'ลูกค้าใหม่', section: sec, year });
  set({ deal: d.id });
}

/** A section's counts: "4 ราย", "ค้าง 1" (red), "พร้อมปิด 1" (green) — words, no chips. */
function SecMeta({ sum }: { sum: { n: number; od: number; rd: number } }) {
  return (
    <>
      <span className="sl-s-n">{fmtN(sum.n)} ราย</span>
      {sum.od > 0 && <span className="sl-s-od" title="ไม่ได้ติดต่อเกิน 14 วัน">ค้าง {fmtN(sum.od)}</span>}
      {sum.rd > 0 && <span className="sl-s-rd" title="งานที่พร้อมปิด">พร้อมปิด {fmtN(sum.rd)}</span>}
    </>
  );
}

/** A deal's row, and when it is open: its stages (one child row each) and the closing row, framed together. */
/** A deal's rows and card read the table's context with this deal's own answer to "may edit": an
 *  account that may edit only its own deals (scope "own") sees another person's deal read-only. */
function ForDeal({ d, children }: { d: Deal; children: ReactNode }) {
  const tk = useTk();
  const ro = tk.ro || !tk.e.canDeal('edit.deal', d);
  return <TkCtx.Provider value={ro === tk.ro ? tk : { ...tk, ro }}>{children}</TkCtx.Provider>;
}

function DealRows(p: { d: Deal; open: boolean; stages: string[]; jm?: 'mid' | 'last' }) {
  return (
    <ForDeal d={p.d}>
      <DealRowsIn {...p} />
    </ForDeal>
  );
}
function DealRowsIn({ d, open, stages, jm }: { d: Deal; open: boolean; stages: string[]; jm?: 'mid' | 'last' }) {
  const { S, today } = useTk();
  const t = stageTrack(S, d, today);
  const kids = open ? kidList(S, d, today) : [];
  return (
    <>
      {open && <tr className="sl-gap" aria-hidden="true"><td colSpan={10} /></tr>}
      <DealRow d={d} open={open} t={t} kidIds={kids.map((_, i) => `k-${d.id}-${i}`).concat(`k-${d.id}-end`)} stages={stages} jm={jm} />
      {open && <KidRows d={d} t={t} list={kids} />}
      {open && <tr className="sl-gap" aria-hidden="true"><td colSpan={10} /></tr>}
    </>
  );
}

type Track = ReturnType<typeof stageTrack>;

function DealRow({ d, open, t, kidIds, stages, jm }: { d: Deal; open: boolean; t: Track; kidIds: string[]; stages: string[]; jm?: 'mid' | 'last' }) {
  const tk = useTk();
  const { e, S, today } = tk;
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const cur = tk.cur === d.id;
  const name = shortName(d.client);
  const isNew = !dealStatus(S, d).started && !!d.at && daysBetween(localDay(d.at), today) <= 7;
  const lc = lastContactInfo(S, d, today).date;
  const late = overdueDays(S, d, today) != null || nextStepView(S, d, today).tone === 'late';
  const reached = reachedOf(stages, t.states);
  return (
    <tr className={'sl-row' + (cur ? ' cur' : '') + (open ? ' og ogf' : '') + (jm ? ' jq-m' + (jm === 'last' && !open ? ' last' : '') : '')} aria-current={cur ? 'true' : undefined} data-id={d.id} style={open && reached >= 0 ? { '--line-c': 'var(--brand)' } : undefined}>
      <td className="k-chev">
        <button type="button" className="sl-chev" data-chev={d.id} aria-expanded={open} aria-controls={kidIds.join(' ')} aria-label={`${open ? 'ซ่อน' : 'แสดง'}ขั้นตอนของ ${name}`} onClick={() => tk.toggle(d.id, true)}>
          <Chevron />
        </button>
      </td>
      <th scope="row" className="k-name">
        <span className="sl-nmw">
          <CoAvatar name={c?.name || d.client} web={c?.web} set={c?.set} size={34} />
          <span className="sl-nm">
            <button type="button" className="sl-nm-b hv-tx co-name dense" onClick={() => tk.openPanel(d.id)} title={`${d.client} เปิดรายละเอียด`} aria-label={`${d.client} เปิดรายละเอียด`}>{name}</button>
            <span className="sl-nm-s">
              {cur && <span className="sl-tg">เปิดล่าสุด</span>}
              {isNew && <span className="sl-tg">ใหม่</span>}
              {tk.dup(d) && <span className="sl-tg bad" title={`บริษัทนี้มีในตารางปี ${d.year} มากกว่า 1 แถว เปิดแถวที่ซ้ำแล้วลบออก`}>ซ้ำ</span>}
              {tk.cash && d.year !== tk.year && <span className="sl-tg" title={`งานของปี ${d.year} ที่มีงวดเงินในปี ${tk.year}`}>งานปี {d.year}</span>}
              <span className={'sl-ct' + (d.contactName ? '' : ' none')}>{d.contactName || 'ยังไม่มีผู้ติดต่อ'}</span>
              <span className="sl-sub-last">· {lc ? dmTh(lc) : 'ยังไม่ได้ติดต่อ'}</span>
            </span>
          </span>
        </span>
      </th>
      <td className="k-resp"><Owner d={d} /></td>
      <td className="k-src" />
      <td className="k-stage">
        <span className="sl-stw">
          <NextPill d={d} />
          <MiniTrack stages={stages} states={t.states} next={t.next} done={t.done} late={late} />
        </span>
      </td>
      <td className="k-last">{tk.date && tk.date.basis !== 'contact' ? <BasisCell d={d} /> : <ContactCell d={d} />}</td>
      <td className="k-fc"><MoneyFc d={d} /></td>
      <td className="k-ac"><MoneyAc d={d} /></td>
      <td className="k-st"><StatusCell d={d} /></td>
      <td className="k-act">{(!tk.ro || tk.e.canExp(d)) && <RowMenu d={d} />}</td>
    </tr>
  );
}

/** ผู้รับผิดชอบ: the name as text, a styled picker under the pointer (one avatar per row: the company's;
 *  the people's initials are in the list). Its list renders only while open, so a long table costs nothing. */
function Owner({ d }: { d: Deal }) {
  const { e, ro, team } = useTk();
  const name = d.resp || 'มอบหมาย';
  if (ro) return <span className="sl-owner ro" title={'ผู้รับผิดชอบ ' + (d.resp || 'ยังไม่ระบุ')}><span className="sl-owner-name">{d.resp || '—'}</span></span>;
  const resps = [...new Set([...team, d.resp].filter(Boolean))];
  return (
    <Select
      variant="cell"
      id={'sl-owner-' + d.id}
      className={'sl-owner-sel' + (d.resp ? '' : ' none')}
      value={d.resp}
      shown={name}
      title={`ผู้รับผิดชอบ: ${name} กดเพื่อเปลี่ยน`}
      label={`ผู้รับผิดชอบ ${shortName(d.client)}`}
      valueText={d.resp || 'ไม่ระบุ'}
      width={220}
      search={false}
      onChange={(v) => e.updateDeal(d.id, { resp: v })}
      options={[...resps.map((x) => ({ v: x, label: x, lead: <Av name={x} /> })), { v: '', label: 'ไม่ระบุ', lead: <Av name="" /> }]}
    />
  );
}

/** "ถัดไป CALL2 โทรครั้งที่ 2": opens the stage editor on that stage; plain text for viewers. A won deal
 *  with a plan names its next installment (red when late, amber when due within 7 days or part paid). */
function NextPill({ d, card }: { d: Deal; card?: boolean }) {
  const tk = useTk();
  const v = nextStepView(tk.S, d, tk.today);
  if (v.kind === 'no') return <span className="sl-nx txt">ไม่ต้องติดตามต่อ</span>;
  if (v.kind === 'done') return <span className="sl-nx txt ok">ครบทุกขั้น</span>;
  if (v.kind === 'joint') return <span className="sl-nx txt">{v.hint}</span>;
  const inner = (
    <>
      <span className="nx-l">ถัดไป</span>
      <b>{v.stage}</b>
      <em>{v.kind === 'next' || v.kind === 'overdue' ? thOf(v.stage) : v.hint}</em>
    </>
  );
  const tone = v.tone ? ' ' + v.tone : '';
  const title = v.label.replace(/ — .*/, '');
  if (tk.ro) return <span className={'sl-nx ro' + tone} title={title}>{inner}</span>;
  // an installment beyond the stage list has no row to edit in: the panel takes the receipt
  const inList = tk.S.cfg.stages.includes(v.stage);
  return (
    <button
      type="button"
      className={'sl-nx hv' + tone}
      data-qa={d.id + ':' + v.stage + (card ? ':card' : '')}
      title={v.label}
      aria-label={v.label}
      onClick={(ev) => (inList ? tk.openEditor(d.id, v.stage, ev.currentTarget) : tk.openPanel(d.id, `recv:${v.stage}`))}
    >
      {inner}
    </button>
  );
}

/** ติดต่อล่าสุด: the date (a button that edits the typed contact date) and "7 วันก่อน", or the red
 *  "ค้าง 36 วัน" when the deal has gone more than 14 days without one. */
function ContactCell({ d }: { d: Deal }) {
  const tk = useTk();
  const { e, S, today, ro } = tk;
  const { date, from, act } = lastContactInfo(S, d, today);
  const od = overdueDays(S, d, today);
  const src = from === 'act' && act ? `จากบันทึกการติดต่อ (${ACT_TH[act.type]}${act.stage ? ' ที่ ' + act.stage : ''})` : from && from !== 'typed' ? `จากขั้น ${from}` : from === 'typed' ? 'วันที่ติดต่อที่พิมพ์ไว้' : '';
  const main = date ? dmTh(date) : '—';
  // a contact range on: the latest contact inside it, when that is not the last one ("ในช่วงนี้ 20 ก.ย. · CALL2")
  const inR = tk.date?.basis === 'contact' ? dateMatch(S, d, tk.date.r, 'contact', today) : null;
  const other = inR && inR.d !== date ? inR : null;
  const sub =
    od != null ? <span className="chip bad" title="ไม่ได้ติดต่อเกิน 14 วัน">ค้าง {fmtN(od)} วัน</span>
    : other ? (
      // two short lines (the column is narrow): the day in the range, then what it was, both whole
      <span className="sl-inrange">
        <span>ในช่วงนี้ {dmTh(other.d)}</span>
        <span>{other.what}</span>
      </span>
    )
    : <span className="sl-ago">{date ? agoTh(date, today) : 'ยังไม่ได้ติดต่อ'}</span>;
  const rangeNote = other && tk.date ? ` · ติดต่อในช่วง ${rangeTh(tk.date.r)}: ${isoTh(other.d)} (${other.what})` : '';
  const open = tk.pop === d.id;
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>('.sl-datechip')?.focus();
  }, [open]);
  if (ro) return <span className="sl-cdw"><span className="sl-cdate ro" title={`ติดต่อล่าสุด ${date ? isoTh(date) : 'ยังไม่มี'} ${src}${rangeNote}`}>{main}</span>{sub}</span>;
  const close = () => {
    tk.setPop('');
    btn.current?.focus();
  };
  return (
    <span
      className={'sl-cdw' + (open ? ' open' : '')}
      onBlur={(ev) => open && !ev.currentTarget.contains(ev.relatedTarget as Node) && !insidePop(ev.relatedTarget) && tk.setPop('')}
      onKeyDown={(ev) => {
        if (open && ev.key === 'Escape') {
          ev.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        className="sl-cdate hv"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-cpop={d.id}
        title={`ติดต่อล่าสุด ${date ? isoTh(date) + ' · ' + src : 'ยังไม่มี'}${rangeNote} กดเพื่อแก้วันที่ติดต่อ`}
        aria-label={`ติดต่อล่าสุด ${date ? isoTh(date) : 'ยังไม่มี'}${src ? ' (' + src + ')' : ''} แก้วันที่ติดต่อ`}
        onClick={() => tk.setPop(open ? '' : d.id)}
      >
        {main}
      </button>
      {sub}
      {open && (
        <div ref={box} className="sl-pop" role="dialog" aria-label="วันที่ติดต่อ" tabIndex={-1}>
          <b>วันที่ติดต่อ</b>
          <span className="sl-pop-row">
            <DateChip value={d.contactDate} onChange={(v) => e.updateDeal(d.id, { contactDate: v })} label="วันที่ติดต่อ" />
            {d.contactDate && <button type="button" className="quiet" onClick={() => e.updateDeal(d.id, { contactDate: '' })}>ล้าง</button>}
          </span>
          <p>ติดต่อล่าสุดในตาราง คือวันที่นี้ วันที่ของขั้นตอนล่าสุด หรือการติดต่อที่บันทึกไว้ แล้วแต่วันไหนใหม่กว่า{from && from !== 'typed' ? ` · ตอนนี้${src} ${isoTh(date)}` : ''}</p>
        </div>
      )}
    </span>
  );
}

/** How long ago, or until, a basis date: "อีก 8 วัน" / "วันนี้" / "เลยมา 4 วัน" (red when owed) / "รับแล้ว"
 *  for due dates; "รับแล้ว" for money received; "5 วันก่อน" for the rest. */
function basisRel(x: BasisDate, basis: DateBasis, today: string): { text: string; tone: '' | 'ok' | 'bad' } {
  if (basis === 'paid' || (basis === 'due' && x.tone === 'ok')) return { text: 'รับแล้ว', tone: 'ok' };
  if (basis !== 'due') return { text: agoTh(x.d, today), tone: '' };
  const n = daysBetween(today, x.d);
  return n > 0 ? { text: `อีก ${fmtN(n)} วัน`, tone: '' } : n === 0 ? { text: 'วันนี้', tone: '' } : { text: `เลยมา ${fmtN(-n)} วัน`, tone: x.tone === 'bad' ? 'bad' : '' };
}
/** What a basis date was, short enough for the column and the card: "PAY1" without its amount (the
 *  title says it). */
const whatShort = (x: BasisDate, basis: DateBasis) => (basis === 'paid' || basis === 'due' ? x.what.split(' · ')[0] : x.what);
/** The row's date when the date filter is about another date than contacts: read-only, the date over
 *  what it was and how long ago or until ("PAY1 · 175,000 · อีก 3 วัน"); the year only when not the table's. */
function BasisCell({ d }: { d: Deal }) {
  const { S, today, date, year } = useTk();
  const x = date ? dateMatch(S, d, date.r, date.basis, today) : null;
  if (!date || !x) return <span className="sl-bdate"><span className="sl-bdate-d none">—</span></span>;
  const rel = basisRel(x, date.basis, today);
  const when = x.d.slice(0, 4) === String(+year - 543) ? dmTh(x.d) : isoTh(x.d);
  return (
    <span className="sl-bdate" title={`${BASIS_TH[date.basis].head} ${isoTh(x.d)} · ${x.what} · ${rel.text}`}>
      <span className="sl-bdate-d">{when}</span>
      <span className="sl-bdate-w">
        {date.basis === 'result' ? <span className={'st ' + (x.tone === 'ok' ? 'ok' : 'bad')}>{x.what}</span> : whatShort(x, date.basis)}
        {' · '}
        <span className={rel.tone ? 't-' + rel.tone : undefined}>{rel.text}</span>
      </span>
    </span>
  );
}

/** A typed amount: the figure (a button) turns into a box on click; "1.5 ล้าน", "120,000.-" are read too. */
function TypedMoney({ value, label, onSave }: { value: number | null; label: string; onSave: (v: number | null) => void }) {
  const [ed, setEd] = useState(false);
  if (ed)
    return (
      <input
        autoFocus
        className="fld sl-mfld"
        defaultValue={value == null ? '' : fmtMoney(value)}
        inputMode="decimal"
        aria-label={label}
        placeholder="เช่น 120,000"
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') ev.currentTarget.blur();
          if (ev.key === 'Escape') {
            ev.stopPropagation();
            ev.currentTarget.value = value == null ? '' : fmtMoney(value);
            ev.currentTarget.blur();
          }
        }}
        onBlur={(ev) => {
          const n = parseAmount(ev.target.value);
          setEd(false);
          // not one clear amount ("50,000-80,000", words): keep the saved figure, say why
          if (n === undefined) return void window.alert(`อ่าน "${ev.target.value}" เป็นจำนวนเงินไม่ได้ พิมพ์ตัวเลขเดียว เช่น 120,000 หรือ 1.5 ล้าน`);
          if (n !== value) onSave(n);
        }}
      />
    );
  return (
    <button type="button" className="sl-mbtn hv" title={`${label} พิมพ์เอง กดเพื่อแก้`} aria-label={`${label} ${value == null ? 'ยังไม่มี' : fmtMoney(value)} แก้`} onClick={() => setEd(true)}>
      <b className={value == null ? 'none' : ''}>{value == null ? '—' : fmtMoney(value)}</b>
    </button>
  );
}

/** The word under a figure in a row (salesUi FigView): "จากเอกสาร" (ok, the document in its title),
 *  "ไม่ตรงเอกสาร" (warn, both numbers in its title), or "พิมพ์เอง" / "บันทึกเอง", which gives way to
 *  "แนบเอกสาร" while the row is pointed at or has the keyboard (the cell holds one short line). */
function FigSub({ v, onAttach }: { v: FigView; onAttach?: () => void }) {
  if (v.kind === 'ok') return <small className="ok" title={v.title}>จากเอกสาร</small>;
  if (v.kind === 'warn') return <small className="warn" title={v.title}>ไม่ตรงเอกสาร</small>;
  if (!v.kind) return null;
  return (
    <small className={'sl-fig' + (onAttach ? ' has-a' : '')} title={v.title}>
      <span className="sl-fig-w">{v.word}</span>
      {onAttach && <button type="button" className="lnk sl-fig-a" onClick={onAttach} aria-label={'แนบเอกสาร · ' + v.title}>แนบเอกสาร</button>}
    </small>
  );
}

/** Forecast: the quotation's figure ("จากเอกสาร"), or the typed one ("พิมพ์เอง", editable; a quotation
 *  attached from here is read and checked against it). */
function MoneyFc({ d }: { d: Deal }) {
  const tk = useTk();
  const { e, S, ro } = tk;
  if (tk.cash) return <LensMoney L={tk.cash} d={d} col="fc" won={dealResult(S, d) === 'YES'} />;
  if (jointRole(S, d) === 'member') return <JointShare S={S} d={d} col="fc" />;
  const m = dealMoney(S, d);
  const att = ro ? undefined : () => tk.attach(d, S.cfg.stages.includes(QUOTE_STAGE) ? QUOTE_STAGE : undefined, 'quotation', { target: 'forecast' });
  const sub = <FigSub v={fcFig(S, d)} onAttach={att} />;
  const ac2 = m.actual != null && <span className="sl-ac2">Actual <b>{fmtMoney(m.actual)}</b></span>;
  if (m.fcDoc || ro)
    return (
      <span className="sl-mn">
        <b className={m.forecast == null ? 'none' : ''}>{m.forecast == null ? '—' : fmtMoney(m.forecast)}</b>
        {sub}
        {ac2}
      </span>
    );
  return (
    <span className="sl-mn">
      <TypedMoney value={m.forecast} label="Forecast (บาท)" onSave={(v) => e.updateDeal(d.id, { forecast: v })} />
      {sub}
      {ac2}
    </span>
  );
}

/** Actual: with a plan what came in + what is still owed (red when an installment is late), "แผน 3 งวด"
 *  before the deal is won; without one the documents' sum (or the typed figure, editable). */
function MoneyAc({ d }: { d: Deal }) {
  const tk = useTk();
  const { e, S, today, ro } = tk;
  if (tk.cash) return <LensMoney L={tk.cash} d={d} col="ac" won={dealResult(S, d) === 'YES'} />;
  if (jointRole(S, d) === 'member') return <JointShare S={S} d={d} col="ac" />;
  const m = dealMoney(S, d), r = dealResult(S, d), ps = payState(S, d, today), P = ps.plan, v = acFig(S, d);
  // an invoice or receipt for the installment due next (or the first PAY stage not paid)
  const att = ro ? undefined : () => tk.attach(d, attachStage(S, d, { kind: 'receipt', target: 'actual' }, today) || undefined, 'receipt', { target: 'actual' });
  if (P && r === 'YES')
    return (
      <span className="sl-mn">
        <b className={P.got ? '' : 'none'}>{P.got ? fmtMoney(P.got) : '—'}</b>
        {v.kind === 'warn' && !P.late.length ? (
          <FigSub v={v} />
        ) : P.left ? (
          <small className={P.late.length ? 'bad' : ''} title={`ค้างรับตามแผน ${fmtMoney(P.left)} บาท${P.late.length ? ' · เลยกำหนด ' + P.late.map((l) => l.stage).join(', ') : ''}`}>ค้าง {fmtMoney(P.left)}</small>
        ) : (
          <small className="ok">รับครบ</small>
        )}
      </span>
    );
  if (P && r !== 'NO')
    return (
      <span className="sl-mn">
        <b className="none">—</b>
        <small title={`แผนการชำระที่พิมพ์ไว้ก่อน รวม ${fmtMoney(P.total)} บาท`}>แผน {P.n} งวด</small>
      </span>
    );
  // what needs a look first: a document that disagrees, then what is still owed, then where it comes from
  const owe = r === 'YES' && m.actual != null && m.forecast != null && m.actual < m.forecast;
  // still owed on a typed Actual: "ค้าง x", and on hover the attach, as for any typed figure
  const sub =
    v.kind === 'warn' ? <FigSub v={v} />
    : owe && v.kind === 'typed' && att ? <FigSub v={{ ...v, word: 'ค้าง ' + fmtMoney(m.forecast! - m.actual!), title: `Actual พิมพ์เอง · ค้าง ${fmtMoney(m.forecast! - m.actual!)} บาท แนบใบเสร็จเพื่อตรวจยอด` }} onAttach={att} />
    : owe ? <small>ค้าง {fmtMoney(m.forecast! - m.actual!)}</small>
    : v.kind === 'ok' ? <FigSub v={v} />
    : r === 'YES' && m.actual != null && !ps.left.length ? <small className="ok">รับครบ</small>
    : <FigSub v={v} onAttach={att} />;
  // with documents (or a hand receipt) the figure is their sum: changed on them, not here
  if (ro || m.acDocs || m.hand)
    return (
      <span className="sl-mn">
        <b className={m.actual == null ? 'none' : ''}>{m.actual == null ? '—' : fmtMoney(m.actual)}</b>
        {sub}
      </span>
    );
  return (
    <span className="sl-mn">
      <TypedMoney value={m.actual} label="Actual (บาท)" onSave={(v) => askPay(e, { d, after: previewOf.deal(S, d.id, { actual: v }), kind: 'edit', title: 'แก้ Actual ที่พิมพ์ไว้', verb: 'แก้ยอด', run: () => e.updateDeal(d.id, { actual: v }) })} />
      {sub}
    </span>
  );
}

/** สถานะ: dot + word and one grey line under it, or "ปิดงาน" when the job is ready to close. */
function StatusCell({ d, compact }: { d: Deal; compact?: boolean }) {
  const tk = useTk();
  const sv = statusView(tk.S, d, tk.today);
  return (
    <span className="sl-stw2">
      <Status kind={sv.kind} title={sv.sub && sv.tone === 'wait' ? sv.sub : undefined}>{sv.word}</Status>
      {!compact &&
        (sv.ready && !tk.ro ? (
          <button type="button" className="lnk sl-closeb" onClick={() => tk.acts.close(d.id)} title="ย้ายไปแท็บปิดงาน (เปิดกลับได้)">ปิดงาน</button>
        ) : (
          sv.sub && <span className="sl-st-sub" title={sv.sub}>{sv.sub}</span>
        ))}
    </span>
  );
}

/** ⋯: words only (not for viewers: "เปิดรายละเอียด" alone would repeat what the name does). Opens
 *  upward when there is no room below it in the window. */
function RowMenu({ d }: { d: Deal }) {
  const tk = useTk();
  const { set: setUi } = useApp();
  const open = tk.menu === d.id;
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const up = useFitMenu(open, ref);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  }, [open]);
  const close = () => {
    tk.setMenu('');
    btn.current?.focus();
  };
  const pick = (fn: () => void) => () => {
    close();
    fn();
  };
  const ready = closeReady(tk.S, d, tk.today);
  // a quotation there already: its revision is one click from the row
  const qv = open && !tk.ro ? qtView(tk.S, d) : null, qh = qv?.head;
  const hid = open && jointRole(tk.S, d) === 'member' ? jointHeadOf(tk.S, d.id) : '';
  return (
    <span
      ref={ref}
      className="sl-actw"
      onBlur={(ev) => open && !ev.currentTarget.contains(ev.relatedTarget as Node) && !insidePop(ev.relatedTarget) && tk.setMenu('')}
      onKeyDown={(ev) => {
        if (!open) return;
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          close();
        } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') || [])];
          const i = items.indexOf(document.activeElement as HTMLElement);
          items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
          ev.preventDefault();
        }
      }}
    >
      <button ref={btn} type="button" className="sl-more hv" aria-label={'เพิ่มเติม ' + shortName(d.client)} aria-haspopup="menu" aria-expanded={open} onClick={() => tk.setMenu(open ? '' : d.id)}>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <span role="menu" className={'menu sl-menu sl-rowmenu' + (up ? ' up' : '')}>
          <button role="menuitem" className="menu-i" onClick={pick(() => tk.openPanel(d.id))}>เปิดรายละเอียด</button>
          {hid && <button role="menuitem" className="menu-i" onClick={pick(() => tk.openPanel(hid))}>เปิดใบเสนอราคาร่วม<small>{jointNo(tk.S, jointOf(tk.S, { id: hid })!) || 'ใบเดียว หลายบริษัท'}</small></button>}
          {!tk.ro && (
            <>
              {/* a joint quotation's member holds no money: what it files is evidence (its quotation and
                  payments are the joint quotation's, "เปิดใบเสนอราคาร่วม" above) */}
              {hid ? (
                <button role="menuitem" className="menu-i" onClick={pick(() => tk.attach(d, '', 'other'))}>แนบเอกสารอื่น<small>ไม่นับยอด · ใบเสนอราคาและการชำระอยู่ที่ใบเสนอราคาร่วม</small></button>
              ) : (
                <button role="menuitem" className="menu-i" onClick={pick(() => tk.attach(d))}>แนบเอกสาร<small>ระบบเลือกขั้นให้</small></button>
              )}
              {qh && !hid && (
                <button role="menuitem" className="menu-i" onClick={pick(() => tk.attach(d, QUOTE_STAGE, 'quotation', { target: 'forecast', revise: qh.doc.id }))}>
                  แนบใบเสนอราคาฉบับแก้ไข<small>{qh.doc.docNo || 'ใบเสนอราคา'} · {qv!.cur ? `ตอนนี้ใช้ฉบับที่ ${qv!.cur.n}` : `ล่าสุดฉบับที่ ${qh.n}`}</small>
                </button>
              )}
              {qh && tk.e.canJoint() && canMergeFrom(tk.S, d) && (
                <button role="menuitem" className="menu-i" onClick={pick(() => setUi({ jqDlg: { k: 'new', from: d.id } }))}>
                  รวมเป็นใบเสนอราคาร่วม<small>ใบนี้ทำให้หลายบริษัท</small>
                </button>
              )}
              {!hid && <button role="menuitem" className="menu-i" onClick={pick(() => tk.openPanel(d.id, 'edit'))}>แผนการชำระเงิน<small>{planOf(tk.S, d, tk.today) ? 'แก้ไขแผน' : 'ตั้งแผน งวดละเท่าไร เมื่อไร'}</small></button>}
              <button
                role="menuitem"
                className="menu-i"
                onClick={pick(() => {
                  // the row's ผู้รับผิดชอบ picker opens (its list takes the keyboard)
                  const b = document.getElementById('sl-owner-' + d.id);
                  b?.focus();
                  b?.click();
                })}
              >
                เปลี่ยนผู้รับผิดชอบ
              </button>
              <button role="menuitem" className="menu-i" onClick={() => { tk.setMenu(''); tk.setPop(d.id); }}>แก้วันที่ติดต่อ</button>
              <hr />
              <button role="menuitem" className="menu-i" onClick={pick(() => tk.acts.close(d.id))}>ปิดงาน<small>{ready ? 'ย้ายไปแท็บปิดงาน' : 'ยังไม่ครบ ปิดเองได้ (ถามยืนยัน)'}</small></button>
            </>
          )}
          {/* ค่าใช้จ่ายของงาน: whoever records expenses on this deal (an account without ดีลและขั้นตอน too) */}
          {open && tk.e.canExp(d) && <button role="menuitem" className="menu-i" onClick={pick(() => openExp(d.id))}>บันทึกค่าใช้จ่าย<small>{expMenuSub(jointRole(tk.S, d))}</small></button>}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ child rows (one per stage)

/** A child row: a stage of the list, a run of done stages folded into one line, or an installment of the
 *  plan beyond the stage list ("งวดเพิ่ม", after the last PAY stage). `i` is the index in the stage list. */
type Kid = { fold: string[]; i: number } | { p: string; i: number; extra?: boolean };
function kidList(S: SalesState, d: Deal, today: string, showAll = false, editStage = ''): Kid[] {
  const stages = S.cfg.stages, t = stageTrack(S, d, today), P = planOf(S, d, today), pays = payStages(S.cfg);
  const extras = P ? P.lines.filter((l) => !l.inList).map((l) => l.stage) : [];
  const lastPay = pays.length ? stages.indexOf(pays[pays.length - 1]) : stages.length - 1;
  // done stages that hold no money and no result (CALL…, FOLLOW…) fold into one line when there are two or more
  const foldable = showAll ? [] : stages.filter((p) => t.states[p] === 'done' && p !== QUOTE_STAGE && p !== DEAL_STAGE && !isPayStage(S.cfg, p) && p !== editStage);
  const fold = foldable.length >= 2 ? foldable : [];
  const rows: Kid[] = [];
  stages.forEach((p, i) => {
    if (fold.includes(p)) {
      if (p === fold[0]) rows.push({ fold, i: stages.indexOf(fold[fold.length - 1]) });
    } else rows.push({ p, i });
    if (i === lastPay) extras.forEach((x) => rows.push({ p: x, i: -1, extra: true }));
  });
  if (lastPay < 0) extras.forEach((x) => rows.push({ p: x, i: -1, extra: true }));
  return rows;
}

function KidRows({ d, t, list: list0 }: { d: Deal; t: Track; list: Kid[] }) {
  const { engine: e, ui, set } = useApp();
  const tk = useTk();
  const { S, today, ro } = tk;
  const stages = S.cfg.stages;
  const editStage = tk.edit?.id === d.id && !tk.edit.act ? tk.edit.stage : '';
  // contacts beyond the stages: "+2 ครั้ง" by a stage's date opens that stage's under its row
  const byAct = stageActs(S, d);
  const [actOpen, setActOpen] = useState<Record<string, boolean>>({});
  const actsUnder = (p: string) => (actOpen[p] ? (byAct.by[p] || []).map((a) => <ActRow key={a.id} a={a} under />) : null);
  const more = (p: string) => {
    const n = (byAct.by[p] || []).length;
    return n ? (
      <button type="button" className="lnk sl-kmore" aria-expanded={!!actOpen[p]} onClick={() => setActOpen({ ...actOpen, [p]: !actOpen[p] })} aria-label={`การติดต่อเพิ่มที่ ${p} ${n} ครั้ง`}>
        {timesWord(S, d, p, n)}
      </button>
    ) : null;
  };
  // the list from the parent (for the chevron's aria-controls) unless the editor or "แสดง" changed it
  const list = editStage || ui.slShowAll[d.id] ? kidList(S, d, today, !!ui.slShowAll[d.id], editStage) : list0;
  const reached = reachedOf(stages, t.states);
  const P = planOf(S, d, today), won = t.result === 'YES';
  const late = overdueDays(S, d, today) != null;
  const cv = closingView(S, d, today);
  const ps = payState(S, d, today);
  const hid = jointRole(S, d) === 'member' ? jointHeadOf(S, d.id) : '';
  return (
    <>
      {list.map((r, ri) => {
        const id = `k-${d.id}-${ri}`;
        if ('fold' in r) {
          const last = r.fold.map((p) => stepOf(S, d.id, p).d).filter(Boolean).sort().pop();
          const nf = r.fold.reduce((a, p) => a + (byAct.by[p] || []).length, 0);
          return (
            <tr key={id} id={id} className={'sl-kid og on1 kfold' + (r.i < reached ? ' on2' : '')} data-deal={d.id} data-stage="fold">
              <td className="k-chev"><Bead state="done" /></td>
              <th scope="row" className="k-name" colSpan={4}>
                <span className="sl-kf">
                  <b>{r.fold.join(' · ')}</b>
                  <span>ทำแล้ว {r.fold.length} ขั้น{nf ? ` · ติดต่อเพิ่ม ${nf} ครั้ง` : ''}{last ? ' · ล่าสุด ' + isoTh(last) : ''}</span>
                  <button type="button" className="lnk" onClick={() => set({ slShowAll: { ...ui.slShowAll, [d.id]: 1 } })} aria-label={'แสดงขั้น ' + r.fold.join(', ')}>แสดง</button>
                </span>
              </th>
              <td className="k-last" />
              <td className="k-m2" colSpan={2} />
              <td className="k-st"><Status kind="ok">ทำแล้ว</Status></td>
              <td className="k-act" />
            </tr>
          );
        }
        const { p, i, extra } = r;
        const line = P?.lines.find((l) => l.stage === p) || null;
        const st: StageState = extra ? (line?.status === 'paid' ? 'done' : 'future') : t.states[p];
        const isNow = !extra && p === t.next;
        const editing = p === editStage && !ro && !extra;
        const on1 = !extra && i <= reached, on2 = !extra && i < reached;
        const dash1 = on1 && st === 'planned', dash2 = on2 && t.states[stages[i + 1]] === 'planned';
        const fut = (st === 'future' || st === 'off') && !isNow && !editing && !line;
        // a PAY stage the plan does not use (one done on its own, paid the old way, reads as its step)
        const unused = !!P && won && isPayStage(S.cfg, p) && !line && t.states[p] === 'off';
        const cls = ['sl-kid og', on1 && 'on1', on2 && 'on2', dash1 && 'dash1', dash2 && 'dash2', (st === 'off' || unused) && 'off', (fut || unused) && 'fut', editing && 'editing', line && 'pk'].filter(Boolean).join(' ');
        const nameCell = (
          <th scope="row" className="k-name">
            <span className="sl-kn">
              <b>{p}</b>
              <span>{thOf(p)}</span>
              {extra && <i className="sl-xtag" title="ยังไม่มีขั้นนี้ในรายการขั้นตอน แสดงจากแผนการชำระ (ผู้ดูแลระบบเพิ่มขั้นได้ที่จัดการรายการ)">งวดเพิ่ม</i>}
            </span>
          </th>
        );
        const editBtn = ro ? null : extra ? (
          <button type="button" className="sl-kedit lnk" onClick={() => tk.openPanel(d.id, 'edit')} aria-label={'แก้แผนงวด ' + p}>แก้ไข</button>
        ) : (
          <button type="button" className="sl-kedit lnk" data-qa={d.id + ':' + p + ':kid'} onClick={(ev) => tk.openEditor(d.id, p, ev.currentTarget)} aria-label={`แก้ไข ${p} ${thOf(p)}`}>แก้ไข</button>
        );
        if (editing)
          return (
            <tr key={id} id={id} className={cls} data-deal={d.id} data-stage={p}>
              <td className="k-chev"><Bead state={st} now={isNow} late={late} stage={p} /></td>
              {nameCell}
              <KidEditor d={d} stage={p} line={line} won={won} />
            </tr>
          );
        // an installment of the plan (typed in advance, or after the win)
        if (line)
          return (
            <Fragment key={id}>
              <PayRow id={id} cls={cls} d={d} line={line} st={st} isNow={isNow} won={won} next={P?.next?.stage === p} nameCell={nameCell} editBtn={editBtn} more={more(p)} />
              {actsUnder(p)}
            </Fragment>
          );
        // a PAY stage the plan does not use (won deal)
        if (unused)
          return (
            <tr key={id} id={id} className={cls} data-deal={d.id} data-stage={p}>
              <td className="k-chev"><Bead state="off" stage={p} /></td>
              {nameCell}
              <td className="sl-knote" colSpan={3}><span className="t-muted">ไม่มีงวดนี้ในแผนการชำระ</span></td>
              <td className="k-last" />
              <td className="k-m2" colSpan={2} />
              <td className="k-st"><span className="sl-st-m">ไม่ใช้</span></td>
              <td className="k-act" />
            </tr>
          );
        const s = stepOf(S, d.id, p);
        const chip =
          st === 'done' ? <Status kind="ok">ทำแล้ว</Status>
          : st === 'yes' ? <Status kind="ok">ได้งาน</Status>
          : st === 'no' ? <Status kind="bad">ไม่ได้งาน</Status>
          : st === 'wait' ? <Status kind="warn">รอผล</Status>
          : st === 'planned' ? <Status kind="info">นัดไว้</Status>
          : isNow ? <Status kind={late ? 'bad' : 'info'}>ถัดไป</Status>
          : st === 'skipped' ? <span className="sl-st-m">ข้าม</span>
          : st === 'off' ? <span className="sl-st-m">ไม่ต้องทำ</span>
          : null;
        let note: ReactNode = null;
        if (p === DEAL_STAGE && st !== 'future' && st !== 'off' && !(isNow && !s.d)) {
          note = ro ? (
            <span className="t-muted">{st === 'yes' ? 'ได้งาน (YES)' : st === 'no' ? 'ไม่ได้งาน (NO)' : st === 'wait' ? s.n : ''}</span>
          ) : (
            <span className="sl-ynw">
              <ResultSeg d={d} state={st} />
              <span className="sl-kcap" title={st === 'wait' ? s.n : undefined}>{st === 'yes' || st === 'no' ? 'ยังไม่ใช่การปิดงาน' : st === 'wait' ? s.n : ''}</span>
            </span>
          );
        } else if (p === DEAL_STAGE && isNow) {
          note = ro ? null : (
            <span className="sl-ynw">
              <ResultSeg d={d} state={st} />
              <span className="sl-kcap">ยังไม่ใช่การปิดงาน</span>
            </span>
          );
        } else if (!P && won && isPayStage(S.cfg, p) && isNow && !ro) {
          note = <QuickPlan d={d} />;
        } else if (s.n) {
          note = <span className={'sl-clamp' + (isAutoNote(S, d, p) ? ' auto' : '')} title={s.n}>{s.n}</span>;
          // a joint quotation's member: its quotation is the joint one's
          if (hid && p === QUOTE_STAGE) note = <span className="qt-kn">{note}<button type="button" className="lnk" onClick={() => tk.openPanel(hid)}>เปิดใบเสนอราคาร่วม</button></span>;
        } else if (isNow && !ro) {
          note = <button type="button" className="lnk" data-qa={d.id + ':' + p + ':add'} onClick={(ev) => tk.openEditor(d.id, p, ev.currentTarget)}>บันทึกวันที่และโน้ต</button>;
        }
        // QUOTATION with a quotation: its check status (package notify) and "แนบฉบับแก้ไข" always in view by
        // its note, the version under its figure
        // (a joint quotation's member: its quotation is the joint one; one of its own counts nowhere, เอกสารอื่น)
        const qv = p === QUOTE_STAGE && !hid ? qtView(S, d) : null;
        const qcv = qv?.head ? e.qtCheckFor(qv.head.doc) : null;
        if (qv?.head && (!ro || qcv))
          note = (
            <span className="qt-kn">
              {note}
              {qcv && <QtCheckLine doc={qv.head.doc} v={qcv} bare />}
              {!ro && <button type="button" className="lnk" onClick={() => tk.attach(d, QUOTE_STAGE, 'quotation', { target: 'forecast', revise: qv.head!.doc.id })} aria-label={`แนบใบเสนอราคาฉบับแก้ไขของ ${shortName(d.client)}`}>แนบฉบับแก้ไข</button>}
            </span>
          );
        const date = s.d ? (st === 'planned' ? <span className="sl-kdate">นัด {dmTh(s.d)}<small>{agoTh(s.d, today)}</small></span> : <span className="sl-kdate">{isoTh(s.d)}</span>) : null;
        // documents and amounts sit in the column they feed: QUOTATION under Forecast, PAY under Actual
        let money: ReactNode = null;
        const isMoney = p === QUOTE_STAGE || isPayStage(S.cfg, p);
        if (isMoney && st !== 'off') {
          const fig = hid ? null : stageFig(S, d, p);
          const slot = !fig && !hid && (p === QUOTE_STAGE ? isNow || st === 'done' : won && isNow) && !ro;
          money = fig ? <StageAmount fig={fig} ver={qv ? qtFigWords(qv, fig.doc.id) : null} /> : slot ? (
            <button type="button" className="lnk" onClick={() => tk.attach(d, p)} title={p === QUOTE_STAGE ? 'ยอดจะเป็น Forecast' : 'ยอดจะรวมเข้า Actual'} aria-label={`แนบ${p === QUOTE_STAGE ? 'ใบเสนอราคา' : 'ใบแจ้งหนี้ หรือใบเสร็จ'}ที่ ${p}`}>
              แนบ{p === QUOTE_STAGE ? 'ใบเสนอราคา' : 'ใบเสร็จ'}
            </button>
          ) : null;
        }
        return (
          <Fragment key={id}>
            <tr id={id} className={cls} data-deal={d.id} data-stage={p}>
              <td className="k-chev"><Bead state={st} now={isNow} late={late} stage={p} /></td>
              {nameCell}
              <td className="sl-knote" colSpan={3}>{note}</td>
              <td className="k-last">{date}{more(p)}</td>
              <td className="k-m2" colSpan={2}>
                <span className="sl-m2">
                  <span className="k2-fc">{p === QUOTE_STAGE && money}</span>
                  <span className="k2-ac">{p !== QUOTE_STAGE && money}</span>
                </span>
              </td>
              <td className="k-st">{chip}</td>
              <td className="k-act">{editBtn}</td>
            </tr>
            {actsUnder(p)}
          </Fragment>
        );
      })}
      <ActRows d={d} />
      <tr id={`k-${d.id}-end`} className="sl-kend og ogl">
        <td className="k-chev"><span className={'sl-flagb' + (cv.ready ? ' ready' : '')} aria-hidden="true" /></td>
        <th scope="row" className="k-name">
          <span className="sl-kend-n"><b>ปิดงาน</b><span>ย้ายไปแท็บปิดงาน</span></span>
        </th>
        <td className="sl-rule" colSpan={4}>
          <span className="sl-clamp">
            {closingRule(cv.state, P, ps, ro)} · <button type="button" className="lnk" onClick={() => tk.openPanel(d.id)}>รายละเอียดทั้งหมด</button>
          </span>
        </td>
        <td className="k-m2" colSpan={2}>
          {cv.progress && (
            <span className="sl-payp" title={`รับชำระแล้ว ${cv.progress.pct}% ของ${P ? 'แผนการชำระ' : ' Forecast'}`}>
              <span><b>รับแล้ว {cv.progress.pct}%</b><span>{cv.progress.left > 0 ? 'เหลือ ' + fmtMoney(cv.progress.left) : 'ครบ'}</span></span>
              <span className="sl-pb"><i style={{ width: cv.progress.pct + '%' }} /></span>
            </span>
          )}
        </td>
        <td className="sl-kend-a" colSpan={2}>
          {cv.ready ? (ro ? <span className="sl-lockn">พร้อมปิดงาน</span> : <button type="button" className="btn pri xs" onClick={() => tk.acts.close(d.id)}>ปิดงาน</button>) : <span className="sl-lockn">{cv.hint || 'รอผลการขาย'}</span>}
        </td>
      </tr>
    </>
  );
}

// ------------------------------------------------------------------ contacts beyond the stages (dact records)

/** "+2 ครั้ง" by a stage that has its own record (contacts beyond its milestone), "2 ครั้ง" by one not recorded yet. */
const timesWord = (S: SalesState, d: Deal, p: string, n: number) => {
  const st = stepOf(S, d.id, p);
  return `${st.d || st.n.trim() ? '+' : ''}${n} ครั้ง`;
};

/** One contact as a child row: the type word (and its stage) under ลูกค้า, the note, the date under
 *  ติดต่อล่าสุด, who wrote it, "ลบ" for its author. `under`: shown under its stage's row (no stage repeated). */
function ActRow({ a, under }: { a: DealAct; under?: boolean }) {
  const { e } = useTk();
  return (
    <tr className={'sl-kid og sl-kact' + (under ? ' under' : '')} data-deal={a.deal} data-act={a.id}>
      <td className="k-chev" />
      <th scope="row" className="k-name">
        <span className="sl-kn"><b>{ACT_TH[a.type]}</b>{!under && a.stage && <span>{a.stage}</span>}</span>
      </th>
      <td className="sl-knote" colSpan={3}>{a.note ? <span className="sl-clamp" title={a.note}>{a.note}</span> : <span className="t-muted">ไม่มีโน้ต</span>}</td>
      <td className="k-last"><span className="sl-kdate">{isoTh(a.d)}</span></td>
      <td className="k-m2" colSpan={2} />
      <td className="k-st"><span className="sl-st-m" title={'บันทึกโดย ' + (a.by || 'ไม่ระบุชื่อ')}>{a.by}</span></td>
      <td className="k-act">
        {e.canDelAct(a) && (
          <button type="button" className="sl-kedit quiet" data-del-act={a.deal + '/' + a.id} onClick={(ev) => delActFocus(e, a, ev.currentTarget)} aria-label={`ลบการติดต่อ ${ACT_TH[a.type]} ${isoTh(a.d)}`}>ลบ</button>
        )}
      </td>
    </tr>
  );
}

/** Under the stage rows: "การติดต่อ" with how many, "บันทึกการติดต่อ" (the quick-add row: type, note,
 *  date, stage; Enter saves, Escape or a click elsewhere leaves it), then the newest 3 and "ทั้งหมด n". */
function ActRows({ d }: { d: Deal }) {
  const tk = useTk();
  const { S, ro } = tk;
  const list = actsOf(S, d.id);
  const [all, setAll] = useState(false);
  const adding = !ro && tk.edit?.id === d.id && !!tk.edit.act;
  if (ro && !list.length) return null;
  const shown = all ? list : list.slice(0, 3);
  return (
    <>
      <tr id={`k-${d.id}-acts`} className="sl-kid og sl-kact-h">
        <td className="k-chev" />
        <th scope="row" className="k-name">
          <span className="sl-kn"><b>การติดต่อ</b><span>{list.length ? `ติดต่อเพิ่ม ${list.length} ครั้ง` : 'ยังไม่มีบันทึกเพิ่ม'}</span></span>
        </th>
        <td className="sl-knote" colSpan={3}>
          {!ro && !adding && (
            <button type="button" className="lnk" data-qa={d.id + ':act'} onClick={(ev) => tk.openEditor(d.id, '', ev.currentTarget, true)}>บันทึกการติดต่อ</button>
          )}
        </td>
        <td className="k-last" />
        <td className="k-m2" colSpan={2} />
        <td className="k-st" />
        <td className="k-act" />
      </tr>
      {adding && <ActEditRow d={d} stage={tk.edit!.stage} />}
      {shown.map((a) => <ActRow key={a.id} a={a} />)}
      {list.length > 3 && (
        <tr className="sl-kid og sl-kact">
          <td className="k-chev" />
          <td className="k-name" />
          <td className="sl-knote" colSpan={3}>
            <button type="button" className="lnk" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'แสดงน้อยลง' : `ทั้งหมด ${list.length}`}</button>
          </td>
          <td className="k-last" />
          <td className="k-m2" colSpan={2} />
          <td className="k-st" />
          <td className="k-act" />
        </tr>
      )}
    </>
  );
}

/** The quick-add in a row, laid out like a stage's editor: type and note under the note columns, the
 *  date under ติดต่อล่าสุด, the stage under the money, then บันทึก / ยกเลิก. */
function ActEditRow({ d, stage }: { d: Deal; stage: string }) {
  const tk = useTk();
  const f = useActForm(d, stage || undefined);
  const box = useRef<HTMLTableRowElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    box.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const save = () => {
    const a = f.save();
    tk.closeEditor();
    if (a) tk.acts.say(`บันทึกการติดต่อ ${shortName(d.client)} แล้ว · ${ACT_TH[a.type]} ${dmTh(a.d)}${a.stage ? ' ที่ ' + a.stage : ''}`);
  };
  // a click outside the row (not in a dialog it opened) leaves it, as the stage editor does
  const cancelRef = useRef(tk.closeEditor);
  cancelRef.current = tk.closeEditor;
  useEffect(() => {
    const down = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement;
      if (!box.current || box.current.contains(t) || t.closest?.('[role=dialog],.sl-live,[data-pop]')) return;
      cancelRef.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
  const keys = (ev: ReactKeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    tk.closeEditor();
  };
  return (
    <tr ref={box} className="sl-kid og editing sl-kact-ed" data-deal={d.id} onKeyDown={keys}>
      <td className="k-chev" />
      <th scope="row" className="k-name"><span className="sl-kn"><b>บันทึกการติดต่อ</b></span></th>
      <td className="sl-knote" colSpan={3}>
        <span className="sl-qaw">
          <ActTypeSeg f={f} />
          <span className="sl-qa-row">
            <input
              ref={input}
              className="fld sl-fld"
              value={f.note}
              maxLength={NOTE_MAX}
              placeholder="คุยอะไร ได้ข้อมูลอะไร นัดอะไรต่อ"
              aria-label="โน้ตการติดต่อ"
              onChange={(ev) => f.setNote(ev.target.value)}
              onKeyDown={(ev) => ev.key === 'Enter' && !ev.shiftKey && (ev.preventDefault(), save())}
            />
            {/* (the date's own column folds away in a narrow table: it comes here instead) */}
            <span className="sl-qa-date"><DateChip value={f.date} onChange={f.setDate} label="วันที่ติดต่อ" /></span>
          </span>
          <span className="sl-qa-hint">Enter บันทึก · Esc ยกเลิก</span>
        </span>
      </td>
      <td className="k-last"><DateChip value={f.date} onChange={f.setDate} label="วันที่ติดต่อ" /></td>
      <td className="k-m2" colSpan={2}><ActStageSel f={f} d={d} /></td>
      <td className="k-st"><button type="button" className="btn pri xs" onClick={save}>บันทึก</button></td>
      <td className="k-act"><button type="button" className="sl-kedit quiet" onClick={tk.closeEditor} aria-label="ยกเลิก (Esc)">ยกเลิก</button></td>
    </tr>
  );
}

/** The closing row's sentence (the lead phrase 500); `ro` (an account that can only read): the lead
 *  phrase alone, without the steps it has no buttons for. */
function closingRule(state: ReturnType<typeof closingView>['state'], P: ReturnType<typeof planOf>, ps: ReturnType<typeof payState>, ro: boolean): ReactNode {
  if (ro) {
    switch (state) {
      case 'no':
        return <b>ผลการขายเป็น NO</b>;
      case 'plan':
        return <b>ได้งานแล้ว · รับ {P?.paidN} จาก {P?.n} งวดตามแผน</b>;
      case 'pays':
        return <b>ได้งานแล้ว · รับชำระ {ps.paid.length} จาก {ps.pays.length} งวด</b>;
      case 'nopay':
        return <b>ได้งานแล้ว</b>;
      case 'joint':
        return <b>ได้งานแล้ว · ชำระผ่านใบเสนอราคาร่วม</b>;
      case 'done':
        return <b>ได้งานและรับชำระครบ{P ? 'ทุกงวดตามแผน' : ''}แล้ว</b>;
      default:
        return <>ยังไม่มีผลการขาย</>;
    }
  }
  switch (state) {
    case 'no':
      return <><b>ผลการขายเป็น NO</b> ไม่ต้องติดตามต่อ กดปิดงานเพื่อย้ายไปแท็บปิดงาน (เปิดกลับได้)</>;
    case 'plan':
      return <><b>ได้งานแล้ว · รับ {P?.paidN} จาก {P?.n} งวดตามแผน</b> รับครบทุกงวดแล้วปุ่มปิดงานจะขึ้น</>;
    case 'pays':
      return <><b>ได้งานแล้ว · รับชำระ {ps.paid.length} จาก {ps.pays.length} งวด</b> แนบเอกสาร {ps.left.join(', ')} แล้วปุ่มปิดงานจะขึ้น</>;
    case 'nopay':
      return <><b>ได้งานแล้ว</b> ตารางนี้ไม่มีขั้นชำระเงิน (PAY) กดปิดงานเมื่องานจบ</>;
    case 'joint':
      return <><b>ได้งานแล้ว · ชำระผ่านใบเสนอราคาร่วม</b> ปิดได้เมื่อผู้จ่ายชำระครบ หรือปิดทั้งกลุ่มที่ใบเสนอราคาร่วม</>;
    case 'done':
      return <><b>ได้งานและรับชำระครบ{P ? 'ทุกงวดตามแผน' : ''}แล้ว</b> กดปิดงานเพื่อย้ายไปแท็บปิดงาน</>;
    default:
      return <>ผลการขาย YES / NO <b>ยังไม่ใช่การปิดงาน</b> ปุ่มปิดงานจะขึ้นเมื่อผลเป็น NO หรือได้งานและรับชำระครบ</>;
  }
}

/** A document's amount in a child row: a button that opens the file, the document number under it (a
 *  quotation with versions: "ฉบับที่ 2", `ver`), or "ไม่ตรงเอกสาร" when the figure counted is the user's own
 *  (both numbers in its title). */
function DocAmount({ doc, ver }: { doc: DealDoc; ver?: { text: string; title: string } | null }) {
  const { e } = useTk();
  const mm = docMismatch(doc);
  return (
    <>
      <button type="button" className="sl-amt hv-tx" onClick={() => openDocFile(e, doc)} title={`${KIND_TH[doc.kind]} ${doc.docNo}${ver ? ' ' + ver.text : ''} · ${fmtMoney(doc.amount)} บาท เปิดไฟล์`}>{fmtMoney(doc.amount)}</button>
      {mm ? (
        <span className="sl-dno warn" title={`${KIND_TH[doc.kind]} ${doc.docNo}: ${mismatchText(mm.doc, mm.kept, 'ยอดที่นับ')}`}>ไม่ตรงเอกสาร</span>
      ) : ver ? (
        <span className="sl-dno" title={ver.title}>{ver.text}</span>
      ) : (
        <span className="sl-dno" title={'จากเอกสาร ' + (doc.docNo || KIND_TH[doc.kind])}>{doc.docNo || KIND_TH[doc.kind]}</span>
      )}
    </>
  );
}

/** A money stage's figure (stageFig): one document as DocAmount, several counted at a PAY stage as their
 *  sum, named by the latest. */
function StageAmount({ fig, ver }: { fig: NonNullable<ReturnType<typeof stageFig>>; ver?: { text: string; title: string } | null }) {
  const { e } = useTk();
  if (fig.n === 1) return <DocAmount doc={fig.doc} ver={ver} />;
  const name = fig.doc.docNo || KIND_TH[fig.doc.kind];
  return (
    <>
      <button type="button" className="sl-amt hv-tx" onClick={() => openDocFile(e, fig.doc)} title={`${fig.n} ใบรวม ${fmtMoney(fig.sum)} บาท · ล่าสุด ${name} เปิดไฟล์`}>{fmtMoney(fig.sum)}</button>
      <span className="sl-dno">{name} และอีก {fig.n - 1} ใบ</span>
    </>
  );
}

/** ได้งาน / ไม่ได้งาน / รอผล: saves the result at once (ผลการขาย is not ปิดงาน). */
function ResultSeg({ d, state, big, date }: { d: Deal; state: StageState; big?: boolean; date?: string }) {
  const { e, today, acts } = useTk();
  const save = (r: 'YES' | 'NO' | 'WAIT') => {
    const cur = stepOf(e.sales, d.id, DEAL_STAGE);
    if (dealResult(e.sales, d) === r) return;
    const v = { d: date || cur.d || today, n: r === 'WAIT' ? 'รอผล' : r };
    askPay(e, { d, after: previewOf.step(e.sales, d.id, DEAL_STAGE, v), kind: 'edit', title: 'ผลการขาย ' + (r === 'WAIT' ? 'รอผล' : r), verb: 'บันทึกผล', run: () => {
      const was = closeReady(e.sales, d, today);
      e.setStep(d.id, DEAL_STAGE, v);
      if (r === 'WAIT') acts.say(`บันทึกผลการขายของ ${shortName(d.client)} เป็น รอผล แล้ว`);
      else acts.afterResult(d, was);
    } });
  };
  return <ResultButtons state={state} big={big} label={'ผลการขาย ' + shortName(d.client)} onPick={save} />;
}
export function ResultButtons({ state, big, label, onPick }: { state: StageState | ''; big?: boolean; label: string; onPick: (r: 'YES' | 'NO' | 'WAIT') => void }) {
  return (
    <span className={'sl-yn' + (big ? ' lg' : '')} role="group" aria-label={label}>
      <button type="button" className="yes" aria-pressed={state === 'yes'} onClick={() => onPick('YES')}>{big ? 'ได้งาน (YES)' : 'ได้งาน'}</button>
      <button type="button" className="no" aria-pressed={state === 'no'} onClick={() => onPick('NO')}>{big ? 'ไม่ได้งาน (NO)' : 'ไม่ได้งาน'}</button>
      <button type="button" className="wait" aria-pressed={state === 'wait'} onClick={() => onPick('WAIT')}>รอผล</button>
    </span>
  );
}

/** Won, no plan yet, the next stage is a PAY: set one up in one click (the panel has the full editor). */
function QuickPlan({ d }: { d: Deal }) {
  const { e, S, acts, openPanel } = useTk();
  const m = dealMoney(S, d), left = Math.max(0, (m.forecast || 0) - (m.actual || 0));
  // money already received moves onto the plan's stages: a checked line is asked about first
  const go = (n: number) => askPay(e, { d, after: previewOf.firstPlan(S, d.id, todayISO()), kind: 'edit', title: 'ตั้งแผนชำระ', verb: 'ตั้งแผน', run: () => {
    const r = e.quickPlan(d.id, n);
    if (!r) return;
    const amts = r.amounts.every((x) => x != null) ? r.amounts.map((x) => fmtMoney(x)).join(' + ') + ' บาท' : 'ใส่ยอดได้ที่แผนการชำระ';
    acts.say(`ตั้งแผน ${n} งวดแล้ว · ${amts} · งวดแรกครบกำหนด 30 วันหลังได้งาน${n > 1 ? ' แล้วทุก 30 วัน' : ''}`, { ms: 8000, acts: [{ label: 'แก้ไขแผน', act: 'plan', deal: d.id, primary: true }] });
  } });
  return (
    <span className="sl-qp">
      <span className="sl-qp-l">ยังไม่มีแผนชำระ{m.forecast ? ` · ${m.actual ? 'เหลือ ' + fmtMoney(left) : 'จาก Forecast ' + fmtMoney(m.forecast)}` : ''}</span>
      <span className="sl-qp-b">
        <button type="button" className="btn xs" onClick={() => go(1)}>1 งวด</button>
        <button type="button" className="btn xs" onClick={() => go(2)}>2 งวด 50/50</button>
        <button type="button" className="btn xs" onClick={() => go(3)}>3 งวด</button>
        <button type="button" className="lnk" onClick={() => openPanel(d.id, 'edit')}>กำหนดเอง</button>
      </span>
    </span>
  );
}

/** An installment's child row: its terms, when it is due or came in, the amount under Actual, the status. */
function PayRow({ id, cls, d, line: x, st, isNow, won, next, nameCell, editBtn, more }: { id: string; cls: string; d: Deal; line: LineView; st: StageState; isNow: boolean; won: boolean; next: boolean; nameCell: ReactNode; editBtn: ReactNode; more?: ReactNode }) {
  const tk = useTk();
  const { S, today, ro } = tk;
  const s = stepOf(S, d.id, x.stage);
  const meta = lineMeta(x.line);
  const userNote = s.n && !isAutoNote(S, d, x.stage) ? s.n : '';
  const acts = !won || ro || !next ? null : x.status === 'part' ? (
    <span className="sl-pk-b">
      <button type="button" className="btn xs" onClick={() => { const r = tk.e.setPayFull(d.id, x.stage, true); if (r) tk.acts.prompt(d, 'payment'); else tk.acts.say(`ถือว่ารับครบ ${x.stage} แล้ว`); }}>ถือว่ารับครบ</button>
      <button type="button" className="lnk" onClick={() => tk.attach(d, x.stage, undefined, { add: true })}>แนบใบเสร็จเพิ่ม</button>
    </span>
  ) : x.status !== 'paid' ? (
    <span className="sl-pk-b">
      <button type="button" className="btn xs" onClick={() => tk.openPanel(d.id, `recv:${x.stage}`)}>รับเงินแล้ว</button>
      <button type="button" className="lnk" onClick={() => tk.attach(d, x.stage)}>แนบใบเสร็จ</button>
    </span>
  ) : null;
  const date =
    x.status === 'paid' ? (
      <span className="sl-kdate" title={`รับ ${isoTh(x.rcvDate)} · ครบกำหนด ${x.due ? isoTh(x.due) : 'ไม่ได้กำหนด'}`}>รับ {x.rcvDate ? dmTh(x.rcvDate) : ''}<small>กำหนด {x.due ? dmTh(x.due) : '—'}</small></span>
    ) : x.status === 'draft' ? (
      <span className="sl-kdate mut">{x.line.due ? isoTh(x.line.due) : relText(x.line) || '—'}</span>
    ) : x.due ? (
      <span className="sl-kdate">
        {isoTh(x.due)}
        <small className={x.lateDays ? 'bad' : ''}>{x.lateDays ? `เลยมา ${x.lateDays} วัน` : x.due === today ? 'วันนี้' : `อีก ${daysBetween(today, x.due)} วัน`}</small>
      </span>
    ) : (
      <span className="sl-kdate mut">ยังไม่กำหนด</span>
    );
  const over = overPlan(x);
  const money =
    x.status === 'paid' ? (
      // more than planned (a document's figure used over the plan), or from several sources: the total, and what it is
      over ? <><span className="sl-amt">{fmtMoney(x.got)}</span><span className="sl-dno warn" title={`แผน ${fmtMoney(x.amt)} บาท`}>เกินแผน {fmtMoney(over)}</span></>
      : x.doc && (x.hand || x.docs.length > 1) ? <><span className="sl-amt">{fmtMoney(x.got)}</span><span className="sl-dno">{x.hand ? 'เอกสาร + รับเอง' : `${x.docs.length} ใบ`}</span></>
      : x.doc ? <DocAmount doc={x.doc} />
      : <><span className="sl-amt">{fmtMoney(x.got)}</span><span className="sl-dno">รับเอง{x.line.how ? ' · ' + lineMeta({ pct: null, how: x.line.how, howT: '', note: '' }) : ''}</span></>
    ) : x.status === 'part' ? (
      <><span className="sl-amt warn">{fmtMoney(x.got)}</span><span className="sl-dno">จาก {fmtMoney(x.amt)}</span></>
    ) : (
      <><span className={'sl-amt' + (x.status === 'draft' || x.status === 'off' ? ' draft' : '')} title="ยอดตามแผน">{x.line.amt != null ? fmtMoney(x.amt) : '—'}</span><span className="sl-dno">ตามแผน</span></>
    );
  const sv = lineStatusView(x, today);
  const stat = sv.kind === 'muted' ? <span className="sl-st-m">{sv.word}</span> : sv.chip ? <span className={'chip ' + sv.kind}>{sv.word}</span> : <Status kind={sv.kind}>{sv.word}</Status>;
  // the lens: where the installment's money falls ("นับในปี 2570" / "อยู่ปี 2569", the row muted)
  // (the amount is the part that counts, as in the deal's money cell; the whole installment when none does)
  const lw = tk.cash ? lensWhere(tk.cash, d, x.stage) : null;
  const lensMoney = lw?.text ? (
    <>
      <span className="sl-amt">{fmtMoney(lw.amt)}</span>
      <span className={'sl-dno' + (lw.inYear ? ' cf-cnt' : '')}>{lw.text}</span>
    </>
  ) : null;
  return (
    <tr id={id} className={cls + (lw?.text ? (lw.inYear ? ' cf-in' : ' cf-off') : '')} data-deal={d.id} data-stage={x.stage}>
      <td className="k-chev"><Bead state={st} now={isNow} late={x.lateDays > 0} stage={x.stage} /></td>
      {nameCell}
      <td className="sl-knote" colSpan={3}>
        <span className="sl-pk-w">
          <span className="sl-pk-t">
            <span className="sl-pk-m" title={meta}>{meta || (x.line.amt != null ? 'งวดที่ ' + x.n : 'ยังไม่ได้ใส่ยอด')}</span>
            {userNote && <span className="sl-pk-n" title={userNote}>{userNote}</span>}
          </span>
          {acts}
        </span>
      </td>
      <td className="k-last">{date}{more}</td>
      <td className="k-m2" colSpan={2}>
        <span className="sl-m2">
          <span className="k2-fc" />
          <span className="k2-ac">{lensMoney || money}</span>
        </span>
      </td>
      <td className="k-st">{stat}</td>
      <td className="k-act">{editBtn}</td>
    </tr>
  );
}

// ------------------------------------------------------------------ the stage editor (table row and phone card)

/** The editor's state: the note (a draft left with Escape comes back), the date (today unless the stage
 *  was done earlier), save / cancel / the result. Saving checks that nobody changed the stage meanwhile;
 *  a change while nothing was typed (a quotation action, a teammate) is followed instead (lib/stepEditor). */
function useStepEditor(d: Deal, stage: string) {
  const tk = useTk();
  const { e, today } = tk;
  const key = d.id + '/' + stage;
  // what the fields show for a stage: its note (a YES / NO is the result's buttons, not a note), its date (else today)
  const fields: StepFields = (s) => ({ note: stage === DEAL_STAGE && /^(yes|no)$/i.test(s.n.trim()) ? '' : s.n, date: s.d && s.d <= today ? s.d : today });
  const [ed, setEd] = useState<StepEd>(() => {
    const init = stepOf(e.sales, d.id, stage), f = fields(init);
    return { init, note: drafts.get(key) ?? f.note, date: f.date };
  });
  const { init, note, date } = ed;
  const setNote = (n: string) => setEd((x) => ({ ...x, note: n }));
  const setDate = (v: string) => setEd((x) => ({ ...x, date: v }));
  // `own`: moved by this editor's own quotation action (what was typed stays, and saving does not ask)
  const follow = (own = false) => setEd((x) => followStep(x, stepOf(e.sales, d.id, stage), fields, own));
  const live = stepOf(e.sales, d.id, stage);
  useEffect(() => follow(), [live.d, live.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => {
    const now = stepOf(e.sales, d.id, stage);
    return stepMoved(init, now) && !window.confirm(`มีคนแก้ขั้นนี้ระหว่างที่เปิดอยู่:\n"${now.n || '(ว่าง)'}"\n\nบันทึกของคุณทับหรือไม่?`);
  };
  const save = () => {
    if (changed()) return tk.closeEditor();
    // a PAY stage's date is the received date of its documents: a checked line is asked about first
    askPay(e, { d, after: previewOf.step(e.sales, d.id, stage, { d: date, n: note }), kind: 'edit', title: `บันทึก ${stage}`, verb: 'บันทึก', run: () => {
      const was = closeReady(e.sales, d, today);
      e.setStep(d.id, stage, { d: date, n: note });
      drafts.delete(key);
      tk.closeEditor();
      const r = dealResult(e.sales, d);
      if (stage === DEAL_STAGE && (r === 'YES' || r === 'NO')) tk.acts.afterResult(d, was);
      else tk.acts.after(d, was, 'payment', `บันทึก ${stage} ของ ${shortName(d.client)} แล้ว · ${dmTh(date)}`);
    } });
  };
  const cancel = () => {
    if (note.trim() && note !== init.n) drafts.set(key, note);
    else drafts.delete(key);
    tk.closeEditor();
  };
  const result = (r: 'YES' | 'NO' | 'WAIT') => {
    if (changed()) return tk.closeEditor();
    const typed = note.trim();
    const v = { d: date, n: r === 'WAIT' ? (typed && !/^(yes|no)$/i.test(typed) ? typed : 'รอผล') : r };
    askPay(e, { d, after: previewOf.step(e.sales, d.id, DEAL_STAGE, v), kind: 'edit', title: 'ผลการขาย ' + (r === 'WAIT' ? 'รอผล' : r), verb: 'บันทึกผล', run: () => {
      const was = closeReady(e.sales, d, today);
      e.setStep(d.id, DEAL_STAGE, v);
      drafts.delete(key);
      tk.closeEditor();
      if (r === 'WAIT') tk.acts.say(`บันทึกผลการขายของ ${shortName(d.client)} เป็น รอผล แล้ว`);
      else tk.acts.afterResult(d, was);
    } });
  };
  // a click outside the editor (not in a dialog it opened) leaves it, keeping the draft
  const box = useRef<HTMLElement | null>(null);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const down = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement;
      if (!box.current || box.current.contains(t) || t.closest?.('[role=dialog],.sl-live,[data-pop]')) return;
      cancelRef.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
  const keys = (ev: ReactKeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    }
  };
  return { note, setNote, date, setDate, save, cancel, result, box, keys, init, follow };
}
const PLACEHOLDER = (S: SalesState, p: string) =>
  p === QUOTE_STAGE ? 'หรือพิมพ์โน้ต เช่น ส่งใบเสนอราคาทางอีเมลแล้ว' : isPayStage(S.cfg, p) ? 'หรือพิมพ์โน้ต เช่น ลูกค้าโอนงวดนี้แล้ว' : p === DEAL_STAGE ? 'หรือหมายเหตุ เช่น รอผู้บริหารอนุมัติ' : 'โน้ต เช่น คุยกับใคร ได้ข้อมูลอะไร นัดอะไรต่อ';

/** The editor in a child row: the same columns become fields (on the tint). */
function KidEditor({ d, stage, line, won }: { d: Deal; stage: string; line: LineView | null; won: boolean }) {
  const tk = useTk();
  const { S } = tk;
  const ed = useStepEditor(d, stage);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.closest('tr')?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const isMoney = stage === QUOTE_STAGE || isPayStage(S.cfg, stage);
  const hasDoc = (stageDocs(S, d).by[stage] || []).some((x) => x.amount != null);
  // a quotation there already: a revised one (compared with it, which stays as "ฉบับเดิม")
  const qh = stage === QUOTE_STAGE ? qtView(S, d).head : null;
  const jm = jointRole(S, d) === 'member';
  return (
    <>
      <td className="sl-knote" colSpan={3} ref={(el) => void (ed.box.current = el?.closest('tr') || null)}>
        <span className="sl-qaw">
          <span className={'sl-qa-row' + (stage === DEAL_STAGE ? ' yn' : '')}>
            {stage === DEAL_STAGE && <ResultButtons state="" label={'ผลการขาย ' + shortName(d.client)} onPick={ed.result} />}
            <input
              ref={input}
              className="fld sl-fld"
              value={ed.note}
              maxLength={NOTE_MAX}
              placeholder={PLACEHOLDER(S, stage)}
              aria-label={`${stage} โน้ต`}
              onChange={(ev) => ed.setNote(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) {
                  ev.preventDefault();
                  ed.save();
                } else ed.keys(ev);
              }}
            />
            {/* (the date's own column folds away in a narrow table: it comes here instead) */}
            <span className="sl-qa-date" onKeyDown={ed.keys}><DateChip value={ed.date} onChange={ed.setDate} label={`วันที่ ${stage}`} /></span>
            {line && won && line.status !== 'paid' && <button type="button" className="btn xs" onClick={() => { ed.cancel(); tk.openPanel(d.id, `recv:${stage}`); }}>รับเงินแล้ว</button>}
          </span>
          <span className="sl-qa-hint">Enter บันทึก · Esc ยกเลิก</span>
        </span>
      </td>
      <td className="k-last" onKeyDown={ed.keys}><DateChip value={ed.date} onChange={ed.setDate} label={`วันที่ ${stage}`} /></td>
      <td className="k-m2" colSpan={2}>
        <span className="sl-m2">
          <span className="k2-fc">
            {stage === QUOTE_STAGE && !tk.ro && !jm && (qh ? (
              <button type="button" className="btn xs" onClick={() => { ed.cancel(); tk.attach(d, stage, 'quotation', { target: 'forecast', revise: qh.doc.id }); }}>แนบฉบับแก้ไข</button>
            ) : !hasDoc && <button type="button" className="btn xs" onClick={() => { ed.cancel(); tk.attach(d, stage); }}>แนบใบเสนอราคา</button>)}
          </span>
          <span className="k2-ac">{isMoney && stage !== QUOTE_STAGE && won && !hasDoc && !jm && <button type="button" className="btn xs" onClick={() => { ed.cancel(); tk.attach(d, stage); }}>แนบใบเสร็จ</button>}</span>
        </span>
      </td>
      <td className="k-st"><button type="button" className="btn pri xs" onClick={ed.save}>บันทึก</button></td>
      <td className="k-act"><button type="button" className="sl-kedit quiet" onClick={ed.cancel} aria-label="ยกเลิก (Esc)">ยกเลิก</button></td>
    </>
  );
}

// ------------------------------------------------------------------ phones: one card per deal

function DealCard({ d }: { d: Deal }) {
  const { ui } = useApp();
  const tk = useTk();
  const { e, S, today, ro } = tk;
  const open = !!ui.slOpen[d.id];
  const cur = tk.cur === d.id;
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const t = stageTrack(S, d, today);
  const m = dealMoney(S, d);
  const lc = lastContactInfo(S, d, today).date;
  const od = overdueDays(S, d, today);
  const sv = statusView(S, d, today);
  const P = planOf(S, d, today), won = t.result === 'YES';
  const name = shortName(d.client);
  const money = e.can('view.money'); // without ดูยอดเงิน the card has no figures at all
  // the figures' words: from a document, against one ("ไม่ตรงเอกสาร"), or typed with "แนบเอกสาร"
  const fv = fcFig(S, d), av = acFig(S, d);
  const word = (v: FigView, none: string) => (v.kind === 'ok' ? 'จากเอกสาร ' + v.docNo : v.kind === 'warn' ? 'ไม่ตรงเอกสาร' : v.word || none);
  const tone = (v: FigView) => (v.kind === 'ok' ? 'ok' : v.kind === 'warn' ? 'warn' : '');
  const attFc = !ro && (fv.kind === 'typed' || !fv.kind) ? () => tk.attach(d, S.cfg.stages.includes(QUOTE_STAGE) ? QUOTE_STAGE : undefined, 'quotation', { target: 'forecast' }) : null;
  const attAc = !ro && (av.kind === 'typed' || av.kind === 'hand' || (!av.kind && won)) ? () => tk.attach(d, attachStage(S, d, { kind: 'receipt', target: 'actual' }, today) || undefined, 'receipt', { target: 'actual' }) : null;
  const acTile = P && won ? (
    <>
      <b className={P.got ? '' : 'none'}>{P.got ? fmtMoney(P.got) : '—'}</b>
      {av.kind === 'warn' && !P.late.length ? (
        <small className="warn" title={av.title}>ไม่ตรงเอกสาร</small>
      ) : (
        <small className={P.left ? (P.late.length ? 'bad' : '') : 'ok'}>{P.left ? `ค้าง ${fmtMoney(P.left)}${P.next?.due ? ' · ' + (P.next.lateDays ? 'เลยกำหนด' : dmTh(P.next.due)) : ''}` : 'รับครบ'}</small>
      )}
    </>
  ) : P && t.result !== 'NO' ? (
    <><b className="none">—</b><small>แผน {P.n} งวด · {fmtMoney(P.total)}</small></>
  ) : (
    <>
      <b className={m.actual != null ? '' : 'none'}>{m.actual != null ? fmtMoney(m.actual) : '—'}</b>
      {av.kind !== 'warn' && m.actual != null && m.forecast != null && m.forecast > m.actual && won ? (
        <small>ค้าง {fmtMoney(m.forecast - m.actual)}</small>
      ) : (
        <small className={tone(av)} title={av.title || undefined}>{word(av, actualSource(S.cfg))}</small>
      )}
    </>
  );
  return (
    <article className={'sl-mc' + (cur ? ' cur' : '')} aria-current={cur ? 'true' : undefined} data-id={d.id} aria-label={d.client}>
      <div className="sl-mc-h">
        <CoAvatar name={c?.name || d.client} web={c?.web} set={c?.set} size={34} />
        <div className="sl-mc-t">
          <button type="button" className="sl-nm-b hv-tx co-name dense" onClick={() => tk.openPanel(d.id)} aria-label={`${d.client} เปิดรายละเอียด`}>{name}</button>
          <span className="sl-nm-s">
            {cur && <span className="sl-tg">เปิดล่าสุด</span>}
            {tk.cash && d.year !== tk.year && <span className="sl-tg">งานปี {d.year}</span>}
            <CardWhen d={d} lc={lc} />
            {od != null && <span className="chip bad">ค้าง {fmtN(od)} วัน</span>}
          </span>
        </div>
        <div className="sl-mc-st"><Status kind={sv.kind}>{sv.word}</Status></div>
      </div>
      <MiniTrack stages={S.cfg.stages} states={t.states} next={t.next} done={t.done} late={od != null || nextStepView(S, d, today).tone === 'late'} />
      {!money ? null : tk.cash ? (
        <div className="sl-mc-money">
          <div className="sl-mc-m"><span>{tk.cash.range ? 'เงินเข้าในช่วงนี้' : `เงินเข้าปี ${tk.year}`}</span><LensMoney L={tk.cash} d={d} col="fc" won={won} /></div>
          <div className="sl-mc-m"><span>{tk.cash.range ? 'รับแล้วในช่วงนี้' : `รับแล้วในปี ${tk.year}`}</span><LensMoney L={tk.cash} d={d} col="ac" won={won} /></div>
        </div>
      ) : (
      <div className="sl-mc-money">
        <div className="sl-mc-m">
          <span>Forecast</span>
          <b className={m.forecast != null ? '' : 'none'}>{m.forecast != null ? fmtMoney(m.forecast) : '—'}</b>
          <small className={tone(fv)} title={fv.title || undefined}>{word(fv, 'จาก QUOTATION')}</small>
          {attFc && <button type="button" className="lnk sl-mc-att" onClick={attFc}>แนบเอกสาร</button>}
        </div>
        <div className="sl-mc-m">
          <span>Actual</span>
          {acTile}
          {attAc && <button type="button" className="lnk sl-mc-att" onClick={attAc}>แนบเอกสาร</button>}
        </div>
      </div>
      )}
      <div className="sl-mc-f">
        {sv.ready && !ro ? <button type="button" className="btn pri xs" onClick={() => tk.acts.close(d.id)}>ปิดงาน</button> : sv.ready ? <span className="sl-nx txt ok">พร้อมปิดงาน</span> : <NextPill d={d} card />}
        <button type="button" className="sl-mc-tog hv" aria-expanded={open} aria-controls={`mk-${d.id}`} data-tog={d.id} onClick={() => tk.toggle(d.id)}>
          {open ? 'ซ่อน' : 'ขั้นตอน'}
          <Chevron />
        </button>
      </div>
      {open && <CardKids d={d} t={t} />}
    </article>
  );
}

/** The card's line under the name: "หมิว · ติดต่อ 5 ต.ค.", with a contact range "· ในช่วงนี้ 20 ก.ย." when
 *  that is not the last contact; another date basis: "หมิว · ครบกำหนด 15 ต.ค. · PAY1 · อีก 3 วัน". */
function CardWhen({ d, lc }: { d: Deal; lc: string }) {
  const { S, today, date } = useTk();
  const who = d.resp || 'ยังไม่มอบหมาย';
  const x = date ? dateMatch(S, d, date.r, date.basis, today) : null;
  if (date && x && date.basis !== 'contact') {
    const rel = basisRel(x, date.basis, today);
    return (
      <span className="sl-ct">
        {who} · {BASIS_TH[date.basis].short} {dmTh(x.d)} · {whatShort(x, date.basis)} · <span className={rel.tone ? 't-' + rel.tone : undefined}>{rel.text}</span>
      </span>
    );
  }
  return (
    <span className="sl-ct">
      {who} · {lc ? 'ติดต่อ ' + dmTh(lc) : 'ยังไม่ได้ติดต่อ'}
      {x && x.d !== lc && <span className="t-link"> · ในช่วงนี้ {dmTh(x.d)}</span>}
    </span>
  );
}

/** The open card: the stages as a short vertical timeline, then the closing step. */
function CardKids({ d, t }: { d: Deal; t: Track }) {
  const { engine: e, ui, set } = useApp();
  const tk = useTk();
  const { S, today, ro } = tk;
  const stages = S.cfg.stages;
  const editStage = tk.edit?.id === d.id && !tk.edit.act ? tk.edit.stage : '';
  const adding = !ro && tk.edit?.id === d.id && !!tk.edit.act;
  const list = kidList(S, d, today, !!ui.slShowAll[d.id], editStage);
  // contacts beyond the stages: "+2 ครั้ง" by a stage opens its own; the newest 3 sit before ปิดงาน
  const byAct = stageActs(S, d), allActs = actsOf(S, d.id);
  const [actOpen, setActOpen] = useState<Record<string, boolean>>({});
  const nAct = (p: string) => (byAct.by[p] || []).length;
  const actDone = (a: DealAct | null) => {
    tk.closeEditor();
    if (a) tk.acts.say(`บันทึกการติดต่อแล้ว · ${ACT_TH[a.type]} ${dmTh(a.d)}${a.stage ? ' ที่ ' + a.stage : ''}`);
  };
  const reached = reachedOf(stages, t.states);
  const P = planOf(S, d, today), won = t.result === 'YES';
  const late = overdueDays(S, d, today) != null;
  const cv = closingView(S, d, today);
  const ps = payState(S, d, today);
  return (
    <div className="sl-mc-kids" id={`mk-${d.id}`} role="list" aria-label={'ขั้นตอนของ ' + shortName(d.client)}>
      {list.map((r, ri) => {
        if ('fold' in r)
          return (
            <div key={ri} className="sl-mk on" role="listitem">
              <Bead state="done" />
              <div className="sl-mk-t">
                <div><b>{r.fold.join(' · ')}</b></div>
                <p className="sl-mk-plan">ทำแล้ว {r.fold.length} ขั้น{r.fold.some(nAct) ? ` · ติดต่อเพิ่ม ${r.fold.reduce((a, p) => a + nAct(p), 0)} ครั้ง` : ''} · <button type="button" className="lnk" onClick={() => set({ slShowAll: { ...ui.slShowAll, [d.id]: 1 } })}>แสดง</button></p>
              </div>
              <div className="sl-mk-r" />
            </div>
          );
        const { p, i, extra } = r;
        const s = stepOf(S, d.id, p);
        const pl = P?.lines.find((l) => l.stage === p) || null;
        const st: StageState = extra ? (pl?.status === 'paid' ? 'done' : 'future') : t.states[p];
        const isNow = !extra && p === t.next;
        const editing = p === editStage && !ro && !extra;
        const on = !extra && i < reached, dash = on && t.states[stages[i + 1]] === 'planned';
        const isMoney = p === QUOTE_STAGE || isPayStage(S.cfg, p);
        const fig = isMoney ? stageFig(S, d, p) : null;
        const unused = !!P && won && isPayStage(S.cfg, p) && !pl && t.states[p] === 'off';
        const fut = (st === 'future' || st === 'off' || unused) && !isNow && !(pl && won);
        let right: ReactNode = s.d && !editing && !pl ? <span className="sl-kdate">{st === 'planned' ? 'นัด ' : ''}{dmTh(s.d)}</span> : null;
        if (pl && !editing) {
          const sv = lineStatusView(pl, today);
          right = (
            <>
              <span className={'sl-amt' + (pl.status === 'part' ? ' warn' : pl.status === 'draft' ? ' draft' : '')}>{fmtMoney(pl.status === 'paid' || pl.status === 'part' ? pl.got : pl.amt)}</span>
              {sv.kind === 'muted' ? <span className="sl-st-m">{sv.word}</span> : sv.chip ? <span className={'chip ' + sv.kind}>{sv.word}</span> : <Status kind={sv.kind}>{sv.word}</Status>}
            </>
          );
        } else if (isMoney && st !== 'off' && !editing && !unused && (fig || (p === QUOTE_STAGE && (isNow || st === 'done')) || (won && isNow)))
          right = (
            <>
              {right}
              {fig ? <StageAmount fig={fig} ver={p === QUOTE_STAGE ? qtFigWords(qtView(S, d), fig.doc.id) : null} /> : ro ? null : <button type="button" className="lnk" onClick={() => tk.attach(d, p)}>แนบ{p === QUOTE_STAGE ? 'ใบเสนอราคา' : 'ใบเสร็จ'}</button>}
            </>
          );
        // the quotation's check status (package notify), by its figure
        const qh = p === QUOTE_STAGE && !editing ? qtView(S, d).head : null;
        const qcv = qh ? e.qtCheckFor(qh.doc) : null;
        if (qh && qcv)
          right = (
            <>
              {right}
              <QtCheckLine doc={qh.doc} v={qcv} bare />
            </>
          );
        // a QUOTATION done (its quotation attached) is edited here too: a revision, its figures, its file
        if (p === QUOTE_STAGE && st === 'done' && !ro && !editing)
          right = (
            <>
              {right}
              <button type="button" className="lnk sl-mk-e" data-qa={d.id + ':' + p + ':edit'} onClick={(ev) => tk.openEditor(d.id, p, ev.currentTarget)} aria-label={`แก้ไข ${p} ${thOf(p)}`}>แก้ไข</button>
            </>
          );
        let body: ReactNode =
          p === DEAL_STAGE && (st === 'yes' || st === 'no' || st === 'wait') ? (
            <Status kind={st === 'yes' ? 'ok' : st === 'no' ? 'bad' : 'warn'}>{st === 'yes' ? 'ได้งาน (YES)' : st === 'no' ? 'ไม่ได้งาน (NO)' : 'รอผล'}</Status>
          ) : s.n && !isAutoNote(S, d, p) ? (
            <p>{s.n}</p>
          ) : null;
        if (pl)
          body = (
            <>
              {body}
              <p className="sl-mk-plan">
                {pl.status === 'paid' ? `รับ ${dmTh(pl.rcvDate)}${pl.doc ? ' · ' + (pl.doc.docNo || KIND_TH[pl.doc.kind]) : ''}${overPlan(pl) ? ' · รับเกินแผน ' + fmtMoney(overPlan(pl)) : ''}` : pl.status === 'draft' ? (pl.line.due ? dmTh(pl.line.due) : relText(pl.line)) : pl.due ? (pl.lateDays ? <><span className="t-bad">เลยกำหนด {pl.lateDays} วัน</span> · ครบกำหนด {dmTh(pl.due)}</> : `ครบกำหนด ${dmTh(pl.due)}`) : 'ยังไม่กำหนดวัน'}
                {lineMeta({ ...pl.line, pct: null }) ? ' · ' + lineMeta({ ...pl.line, pct: null }) : ''}
              </p>
            </>
          );
        if (unused) body = <p className="sl-mk-plan">ไม่มีงวดนี้ในแผน</p>;
        if (pl && won && !ro && !editing && P?.next?.stage === p)
          body = (
            <>
              {body}
              <span className="sl-pk-b sl-mk-a">
                {pl.status === 'part' ? (
                  <button type="button" className="btn xs" onClick={() => { const r = tk.e.setPayFull(d.id, p, true); if (r) tk.acts.prompt(d, 'payment'); }}>ถือว่ารับครบ</button>
                ) : (
                  <button type="button" className="btn xs" onClick={() => tk.openPanel(d.id, `recv:${p}`)}>รับเงินแล้ว</button>
                )}
                {pl.status === 'part' ? (
                  <button type="button" className="lnk" onClick={() => tk.attach(d, p, undefined, { add: true })}>แนบใบเสร็จเพิ่ม</button>
                ) : (
                  <button type="button" className="lnk" onClick={() => tk.attach(d, p)}>แนบใบเสร็จ</button>
                )}
              </span>
            </>
          );
        if (nAct(p) && !editing)
          right = (
            <>
              {right}
              <button type="button" className="lnk sl-kmore" aria-expanded={!!actOpen[p]} onClick={() => setActOpen({ ...actOpen, [p]: !actOpen[p] })} aria-label={`การติดต่อเพิ่มที่ ${p} ${nAct(p)} ครั้ง`}>{timesWord(S, d, p, nAct(p))}</button>
            </>
          );
        if (actOpen[p] && !editing) body = <>{body}<ActList acts={byAct.by[p]} short label={'การติดต่อที่ ' + p} /></>;
        return (
          <div key={ri} className={'sl-mk' + (on ? (dash ? ' dash' : ' on') : '') + (fut ? ' fut' : '') + (editing ? ' editing' : '')} role="listitem">
            <Bead state={unused ? 'off' : st} now={isNow} late={late || (pl?.lateDays || 0) > 0} stage={p} />
            <div className="sl-mk-t">
              <div>
                <b>{p}</b>
                <span>{isNow && !editing ? 'ถัดไป · ' : ''}{thOf(p)}</span>
                {extra && <i className="sl-xtag">งวดเพิ่ม</i>}
              </div>
              {body}
              {editing && <CardEditor d={d} stage={p} line={pl} won={won} />}
            </div>
            {!editing && <div className="sl-mk-r">{right}</div>}
          </div>
        );
      })}
      {(allActs.length > 0 || !ro) && (
        <div className={'sl-mk sl-mk-acts' + (adding ? ' editing' : '')} role="listitem">
          <span className="sl-mk-dot" aria-hidden="true" />
          <div className="sl-mk-t">
            <div><b>การติดต่อ</b><span>{allActs.length ? `ติดต่อเพิ่ม ${allActs.length} ครั้ง` : 'ยังไม่มีบันทึกเพิ่ม'}</span></div>
            <ActList acts={allActs} max={3} stage short label={'การติดต่อของ ' + shortName(d.client)} />
            {adding ? (
              <ActForm d={d} stage={tk.edit!.stage || undefined} onDone={actDone} compact />
            ) : (
              !ro && <button type="button" className="btn xs sl-mk-a" data-qa={d.id + ':act'} onClick={(ev) => tk.openEditor(d.id, '', ev.currentTarget, true)}>บันทึกการติดต่อ</button>
            )}
          </div>
        </div>
      )}
      {/* ค่าใช้จ่ายของงาน: the panel's card in short (only with ดูยอดเงิน and ดูค่าใช้จ่าย) */}
      {e.can('view.money') && <ExpMini d={d} onOpen={() => tk.openPanel(d.id)} />}
      <div className="sl-mk" role="listitem">
        <span className={'sl-flagb' + (cv.ready ? ' ready' : '')} aria-hidden="true" />
        <div className="sl-mk-t">
          <div><b>ปิดงาน</b><span>ย้ายไปแท็บปิดงาน</span></div>
          <p className="sl-mk-plan">
            {cv.state === 'no' ? (ro ? 'ผลเป็น NO' : 'ผลเป็น NO กดปิดงานเพื่อย้ายไปแท็บปิดงาน')
              : cv.state === 'plan' || cv.state === 'pays' ? `ได้งานแล้ว · รับ ${ps.paid.length}/${ps.pays.length} งวด${P ? 'ตามแผน' : ''} · ${cv.hint}`
              : cv.state === 'done' || cv.state === 'nopay' ? (ro ? 'ได้งานและรับชำระครบ' : 'ได้งานและรับชำระครบ ปิดงานได้')
              : cv.state === 'joint' ? 'ได้งานแล้ว · ชำระผ่านใบเสนอราคาร่วม'
              : 'ผล YES / NO ยังไม่ใช่การปิดงาน'}
          </p>
        </div>
        <div className="sl-mk-r">{cv.ready && !ro && <button type="button" className="btn pri xs" onClick={() => tk.acts.close(d.id)}>ปิดงาน</button>}</div>
      </div>
    </div>
  );
}

/** The editor in an open phone card: attach first on QUOTATION / a PAY after the win, then the note. */
function CardEditor({ d, stage, line, won }: { d: Deal; stage: string; line: LineView | null; won: boolean }) {
  const tk = useTk();
  const ed = useStepEditor(d, stage);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ta.current?.focus();
    ta.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const isMoney = stage === QUOTE_STAGE || isPayStage(tk.S.cfg, stage);
  // QUOTATION with a quotation: the quotation (a revision, its figures, its file, earlier versions) first
  const qv = stage === QUOTE_STAGE ? qtView(tk.S, d) : null;
  return (
    <div className="sl-mk-ed" ref={(el) => void (ed.box.current = el)} onKeyDown={ed.keys}>
      {stage === DEAL_STAGE && <ResultButtons state="" label="ผลการขาย" onPick={ed.result} />}
      {qv?.head ? (
        <>
          {/* its figures corrected or its file swapped here: the note below follows the new QUOTATION note */}
          <QtPhone d={d} v={qv} onRevise={(id) => { ed.cancel(); tk.attach(d, QUOTE_STAGE, 'quotation', { target: 'forecast', revise: id }); }} onChange={() => ed.follow(true)} />
          <span className="sl-or">โน้ตของขั้นนี้</span>
        </>
      ) : isMoney && (stage === QUOTE_STAGE || won) && (
        <>
          <button type="button" className="btn wide" onClick={() => { ed.cancel(); tk.attach(d, stage); }}>{stage === QUOTE_STAGE ? 'แนบใบเสนอราคา (Forecast)' : 'แนบใบเสร็จ / ใบแจ้งหนี้ (Actual)'}</button>
          {line && <button type="button" className="btn wide" onClick={() => { ed.cancel(); tk.openPanel(d.id, `recv:${stage}`); }}>รับเงินแล้ว (ไม่มีไฟล์)</button>}
          <span className="sl-or">หรือบันทึกโน้ต</span>
        </>
      )}
      <textarea ref={ta} value={ed.note} maxLength={NOTE_MAX} aria-label={`${stage} โน้ต`} placeholder={PLACEHOLDER(tk.S, stage)} onChange={(ev) => ed.setNote(ev.target.value)} className="fld" />
      <div className="sl-mk-row">
        <DateChip value={ed.date} onChange={ed.setDate} label={`วันที่ ${stage}`} text={ed.date === tk.today ? 'วันนี้ ' + isoTh(ed.date) : undefined} />
        <button type="button" className="quiet" onClick={ed.cancel}>ยกเลิก</button>
        <button type="button" className="btn pri xs" onClick={ed.save}>บันทึก</button>
      </div>
      {qv?.head && <button type="button" className="quiet qt-mdel" onClick={() => deleteQt(tk.e, d, qv, tk.acts.say) && ed.follow(true)}>ลบใบเสนอราคานี้</button>}
    </div>
  );
}

// ------------------------------------------------------------------ closed + log

/** Closed jobs of the year, with the same filters as the table (shown here too, so what is counted is what is listed). */
function ClosedView({ S, F, deals, facets, total, today }: { S: SalesState; F: SalesFilter; deals: Deal[]; facets: Deal[]; total: number; today: string }) {
  const { engine: e, ui, set } = useApp();
  const on = narrowed({ ...F, quick: '' }); // the quick views are about open work: not applied here
  const date = dateIn(F, today);
  // another date than contacts or closing: the date the filter found, under ปิดเมื่อ
  const extra = date && date.basis !== 'contact' && date.basis !== 'closed' ? date : null;
  // a joint quotation's money counts once, on the header (under a ผู้รับผิดชอบ / SOURCE / REFERRAL filter, the
  // parts of its companies shown)
  const attr = jointAttr(F);
  const { fc, ac } = moneySum(S, deals, attr);
  // a joint quotation is one group (its band, then its closed companies): the groups first, then the
  // other rows in their order (mockup 14)
  const jr = jointRows(S, deals);
  const all = jr.secs.flatMap((x) => jr.rows.get(x) || []);
  const flat = [...all.filter((r) => r.k === 'band'), ...all.filter((r) => r.k === 'deal')];
  const nCust = customersOf(S, deals).length;
  const which = date ? `ตามตัวกรอง · ${dateWords(date.f, date.r).field} ${dateWords(date.f, date.r).op} ${rangeTh(date.r)}` : 'ตามตัวกรอง';
  return (
    <>
      <p className="sl-closed-sum">
        <span>ปิดแล้ว <b>{fmtN(nCust)}</b> งาน{on ? ` จาก ${fmtN(total)} (${which})` : ''}{e.can('view.money') && <> · Forecast <b>{fmtMoney(fc) || '0'}</b> · Actual <b>{fmtMoney(ac) || '0'}</b></>}</span>
        <span className="t-meta">งานที่กด “ปิดงาน” แล้ว ทั้งได้งานและไม่ได้งาน · เปิดกลับได้ · ยอดยังนับในสรุปปี</span>
      </p>
      <Toolbar S={S} F={F} yearDeals={facets} today={today} job="closed" shown={nCust} total={total} />
      <div className="card sl-list">
        {!deals.length ? (
          <div className="sl-list-empty">
            {on && total > 0 ? (
              <NoMatch text="ไม่พบงานที่ปิดแล้วตามตัวกรองนี้" />
            ) : (
              <span>ยังไม่มีงานที่ปิด ผลการขาย YES / NO ไม่ได้ย้ายงานมาที่นี่ กด “ปิดงาน” ที่แถวในตารางติดตาม (ปุ่มจะขึ้นเมื่องานพร้อมปิด)</span>
            )}
          </div>
        ) : (
          <table className="sl-ltable" aria-label={`งานที่ปิดแล้ว ปี ${ui.slYear}`}>
            <colgroup><col /><col className="c-opt w-sec" /><col className="c-opt w-resp" /><col className="w-res" /><col className="w-m" /><col className="w-m c-opt" /><col className="w-dt c-opt" /><col className="w-act" /></colgroup>
            <thead>
              <tr><th>ลูกค้า</th><th className="c-opt">หมวด</th><th className="c-opt">ผู้รับผิดชอบ</th><th>ผล</th><th className="r">Forecast</th><th className="r c-opt">Actual</th><th className="c-opt">ปิดเมื่อ</th><th><span className="sr-only">เปิดงานอีกครั้ง</span></th></tr>
            </thead>
            <tbody>
              {flat.map((row) => {
                if (row.k === 'band') return <JointClosedRows key={'jq' + row.g.head.id} b={row} attr={attr} onReopen={e.canDeal('edit.deal', row.g.head) ? () => e.reopenJoint(row.g.head.id) : undefined} />;
                const d = row.d;
                const m = dealMoney(S, d), r = dealResult(S, d);
                return (
                  <tr key={d.id}>
                    <td><button type="button" className="sl-nm-b hv-tx co-name dense" onClick={() => set({ deal: d.id })} title={d.client}>{shortName(d.client)}</button></td>
                    <td className="c-opt t-sec">{d.section || 'ไม่ระบุหมวด'}</td>
                    <td className="c-opt">{d.resp || '—'}</td>
                    <td><Status kind={r === 'YES' ? 'ok' : r === 'NO' ? 'bad' : 'neutral'}>{r === 'YES' ? 'ได้งาน' : r === 'NO' ? 'ไม่ได้งาน' : 'ไม่ระบุผล'}</Status></td>
                    <td className="r"><span className="sl-mn"><b className={m.forecast == null ? 'none' : ''}>{m.forecast == null ? '—' : fmtMoney(m.forecast)}</b><FigSub v={fcFig(S, d)} /></span></td>
                    <td className="r c-opt"><span className="sl-mn"><b className={m.actual == null ? 'none' : ''}>{m.actual == null ? '—' : fmtMoney(m.actual)}</b><FigSub v={acFig(S, d)} /></span></td>
                    <td className="c-opt t-sec">
                      {d.closedDate ? isoTh(d.closedDate) : '—'}
                      {extra && (() => {
                        const x = dateMatch(S, d, extra.r, extra.basis, today);
                        return x && <span className="sl-bdate-w">{BASIS_TH[extra.basis].short} {dmTh(x.d)} · {x.what}</span>;
                      })()}
                    </td>
                    <td className="r">{e.canDeal('edit.deal', d) && <button type="button" className="lnk sl-reopen" onClick={() => e.updateDeal(d.id, { jobStatus: 'open' })}>เปิดงานอีกครั้ง</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** The day a log entry belongs to, in words: วันนี้ / เมื่อวาน / 6 ต.ค. 2569. */
const dayWord = (iso: string, today: string) => {
  const day = localDay(iso);
  const n = daysBetween(day, today);
  return n === 0 ? 'วันนี้' : n === 1 ? 'เมื่อวาน' : isoTh(day);
};

function LogView({ S, year }: { S: SalesState; year: string }) {
  const { engine: e, set } = useApp();
  const [q, setQ] = useState('');
  const today = todayISO();
  const ids = new Set(Object.values(S.deals).filter((d) => d.year === year).map((d) => d.id));
  const all = Object.values(S.log)
    .filter((l) => !l.deal || ids.has(l.deal) || !S.deals[l.deal])
    .filter((l) => !q || [l.client, l.action, l.detail, l.by].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 500);
  const days: [string, typeof all][] = [];
  all.forEach((l) => {
    const w = dayWord(l.at, today);
    const last = days[days.length - 1];
    if (last && last[0] === w) last[1].push(l);
    else days.push([w, [l]]);
  });
  // older entries wrote a move with an arrow between the two names: read it as words
  const words = (s: string) => s.replace(/\s*\u2192\s*/g, ' เป็น ');
  return (
    <>
      <label className="sl-search sl-log-q">
        <Icon name="search" size={17} />
        <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="ค้นหาในประวัติ" aria-label="ค้นหาในประวัติ" />
      </label>
      <div className="card sl-list">
        {!all.length && <div className="sl-list-empty">ยังไม่มีประวัติ</div>}
        {days.map(([day, list]) => (
          <section key={day} className="sl-log-day" aria-label={day}>
            <h3>{day}</h3>
            <ul>
              {list.map((l) => (
                <li key={l.id}>
                  <span className="sl-log-t">{dtTh(l.at).split(' ').slice(3).join(' ')}</span>
                  <span className="sl-log-s">
                    <span>
                      {l.by || 'ไม่ระบุชื่อ'} {l.action}
                      {l.client && (
                        <>
                          {' · '}
                          {l.deal && S.deals[l.deal] ? <button type="button" className="lnk" onClick={() => set({ deal: l.deal })}>{shortName(l.client)}</button> : shortName(l.client)}
                        </>
                      )}
                    </span>
                    {l.detail && <span className="t-sec">{words(l.detail)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!e.me() && <span className="t-meta">ประวัติแชร์ทั้งทีม ใส่ชื่อตัวเองที่ “ฉันคือ” (แท็บอัปเดตข้อมูล) เพื่อให้รู้ว่าใครแก้</span>}
    </>
  );
}
