import { createContext, useCallback, useContext, useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion, type UIState } from '../state';
import { daysBetween, dmTh, dtTh, fmtN, isoTh, localDay, todayISO } from '../lib/format';
import {
  DEAL_STAGE, KIND_TH, NOTE_MAX, QUOTE_STAGE, closeReady, dealMoney, dealResult, dealStatus, filterDeals, fmtMoney, isPayStage, lastContactInfo, overdueDays, paidNote,
  parseAmount, payStages, payState, planOf, quickMatch, receivables, salesStats, sectionsFor, stageDocs, stageTh, stageTrack, stepOf,
  type Deal, type DealDoc, type DocKind, type LineView, type QuickView, type SalesFilter, type SalesState, type StageState,
} from '../lib/sales';
import { actualSource, beYearInput, closingView, facetOptions, lineMeta, lineStatusView, nextStepView, relText, shortName, statusView, yearOptions } from '../lib/salesUi';
import { useMedia } from '../components/Sidebar';
import { Kpi, Notice, Opts, PageHead, Status } from '../components/ui';
import { CoAvatar } from '../components/CoAvatar';
import { Icon } from '../components/icons';
import { Modal } from '../components/Dialog';
import { DocAttach, openDocFile } from '../components/DocAttach';
import { DateChip } from '../components/DateChip';
import { Bead, Chevron, MiniTrack, reachedOf } from '../components/StageTrack';
import { useSalesActs } from '../components/SalesToast';
import { SalesDash } from './SalesDash';

// the shared dialog (components/Dialog.tsx); kept importable from here for older callers
export { Modal } from '../components/Dialog';

type Engine = ReturnType<typeof useApp>['engine'];
const TH_M = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
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

export function Sales() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const S = e.sales;
  const year = ui.slYear;
  const today = todayISO();
  const f: SalesFilter = { year, ...ui.slF };
  const yearDeals = filterDeals(S, { year });
  const shown = filterDeals(S, f);
  // the quick views are about open work: their counts come from the other filters, and the closed tab ignores them
  const noQuick = f.quick ? filterDeals(S, { ...f, quick: '' }) : shown;
  // not memoised: the engine changes S.deals in place (an import or a team sync can add a year)
  const years = yearOptions(Object.values(S.deals), year);
  const openN = yearDeals.filter((d) => d.jobStatus === 'open').length;
  const closedN = yearDeals.length - openN;
  const v = ui.slView;
  const tabs: [typeof v, ReactNode, number | null, string?][] = [
    ['table', 'ตารางติดตาม', openN],
    ['dash', 'Dashboard', null],
    ['closed', 'ปิดงาน', closedN, 'งานที่กด “ปิดงาน” แล้ว ทั้งได้งานและไม่ได้งาน · เปิดกลับได้ · ยอดยังนับในสรุปปี'],
    ['log', <>ประวัติ<span className="sl-long">การแก้ไข</span></>, null],
  ];

  return (
    <>
      <PageHead
        title="Sales Tracker"
        sub="ตารางติดตามสถานะการขาย · ทั้งทีมเห็นข้อมูลเดียวกัน"
        right={
          <div className="sl-ph-r">
            <label className="btn sl-yr" title="ปี (พ.ศ.)">
              ปี {year}
              <Chevron />
              <select value={year} onChange={(ev) => set({ slYear: ev.target.value })} aria-label="ปี (พ.ศ.)">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            {e.can('edit') && <AddMenu />}
            <MoreMenu year={year} deals={[...shown.filter((d) => d.jobStatus === 'open'), ...noQuick.filter((d) => d.jobStatus === 'closed')]} />
          </div>
        }
      />
      {e.docMsg && <Notice kind="error">{e.docMsg}</Notice>}
      {ui.slNote && (
        <Notice kind="ok" role="status">
          {ui.slNote}
          <button className="quiet" onClick={() => set({ slNote: '' })}>ซ่อน</button>
        </Notice>
      )}
      <div className="sl-tabbar">
        <div role="tablist" aria-label="Sales Tracker" className="utabs">
          {tabs.map(([k, label, n, title]) => (
            <button key={k} role="tab" aria-selected={v === k} onClick={() => set({ slView: k })} title={title}>
              <span>{label}</span>
              {n != null && <span className="n">{fmtN(n)}</span>}
            </button>
          ))}
        </div>
        <span className="sl-close-hint">
          <b>ได้งาน (YES) ยังไม่ใช่ปิดงาน</b>
          <span className="sl-long"> กดปิดงานเมื่องานจบ แล้วงานจะย้ายไปแท็บ “ปิดงาน”</span>
        </span>
      </div>
      <p className="sl-m-hint">
        <b>ได้งาน (YES) ยังไม่ใช่ปิดงาน</b> ปิดงานแล้วงานจะย้ายไปแท็บ “ปิดงาน”
      </p>
      {v === 'table' && <TableView e={e} S={S} deals={shown.filter((d) => d.jobStatus === 'open')} base={noQuick.filter((d) => d.jobStatus === 'open')} all={noQuick} facets={yearDeals} today={today} />}
      {v === 'dash' && <SalesDash S={S} deals={yearDeals} today={today} year={ui.slYear} />}
      {v === 'closed' && <ClosedView S={S} deals={noQuick.filter((d) => d.jobStatus === 'closed')} facets={yearDeals} total={closedN} />}
      {v === 'log' && <LogView S={S} year={year} />}
    </>
  );
}

// ------------------------------------------------------------------ menus

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
  const wrap = {
    ref,
    onBlur: (ev: ReactFocusEvent) => {
      if (open && !ref.current?.contains(ev.relatedTarget as Node)) setOpen(false);
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
  return { open, setOpen, close, btn, wrap };
}

function AddMenu() {
  const { engine: e, ui, set, go } = useApp();
  const { open, setOpen, close, btn, wrap } = useMenu();
  // companies being followed that are not in this year's table yet
  const starred = e.crm.watch.map((id) => e.company(id)).filter((c) => c && !e.dealsOf(c.id).some((d) => d.year === ui.slYear));
  return (
    <div {...wrap} className="sl-menuw">
      <button ref={btn} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} className="btn pri">เพิ่มลูกค้า</button>
      {open && (
        <div role="menu" aria-label="เพิ่มลูกค้า" className="menu sl-menu">
          <button role="menuitem" className="menu-i" onClick={() => { close(); go('search'); setTimeout(() => document.getElementById('search-q')?.focus(), 60); }}>
            ค้นหาบริษัทในทะเบียน<small>แล้วส่งเข้า Sales Tracker</small>
          </button>
          {starred.length > 0 && (
            <button role="menuitem" className="menu-i" onClick={() => { close(); set({ sendIds: starred.map((c) => c!.id) }); }}>
              ส่งบริษัทที่ติดตามอยู่ ({fmtN(starred.length)})<small>ที่ยังไม่อยู่ในตารางปีนี้</small>
            </button>
          )}
          <button role="menuitem" className="menu-i" onClick={() => { close(); set({ addCust: { deal: true } }); }}>
            ลูกค้าใหม่ (ไม่มีในทะเบียน)<small>กรอกข้อมูลเอง</small>
          </button>
        </div>
      )}
    </div>
  );
}

function MoreMenu({ year, deals }: { year: string; deals: Deal[] }) {
  const { engine: e, set } = useApp();
  const yearTotal = Object.values(e.sales.deals).filter((d) => d.year === year).length;
  const { open, setOpen, close, btn, wrap } = useMenu();
  const [lists, setLists] = useState(false);
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
        <div role="menu" aria-label="เพิ่มเติม" className="menu sl-menu">
          <button role="menuitem" className="menu-i" onClick={() => { close(); e.exportSalesCsv(year, deals); }}>
            {/* the table's filters apply (also when another tab is open): say so */}
            ส่งออก CSV
            <small>{deals.length < yearTotal ? `${fmtN(deals.length)} จาก ${fmtN(yearTotal)} รายการ ตามตัวกรอง` : `ทั้งตาราง ${fmtN(yearTotal)} รายการ · เปิดใน Excel`}</small>
          </button>
          {e.can('admin') && <button role="menuitem" className="menu-i" onClick={() => { close(); fileRef.current?.click(); }}>นำเข้าจาก Sales Tracker เดิม<small>ไฟล์สำรอง JSON หรือ CSV / Excel</small></button>}
          {e.can('admin') && <button role="menuitem" className="menu-i" onClick={() => { close(); setLists(true); }}>จัดการหมวด / SOURCE / Services</button>}
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
            {x}
            {name === 'sections' && (
              <button className="lnk" style={{ fontSize: 12 }} onClick={() => { const n = window.prompt('ชื่อหมวดใหม่', x); if (n) e.renameSection(x, n); }}>เปลี่ยนชื่อ</button>
            )}
            <button title="ลบ" aria-label={'ลบ ' + x} onClick={() => window.confirm(`ลบ "${x}" ออกจากรายการ? (รายการที่ใช้อยู่ยังคงเดิม)`) && e.setSalesList(name, C[name].filter((y) => y !== x))} className="sl-litem-x hv2">×</button>
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
      {box('sections', 'หมวด (กลุ่มแถวในตาราง)', 'แต่ละลูกค้าอยู่ในหมวดเดียว เช่น ช่องทางที่ได้ลูกค้ามา')}
      {box('sources', 'SOURCE (ช่องทาง)', 'ติ๊กได้หลายช่องต่อหนึ่งลูกค้า ใช้ในกราฟและอัตราได้งานตามช่องทาง')}
      {box('services', 'Services (บริการ)', 'บริการที่เสนอให้ลูกค้า')}
    </Modal>
  );
}

// ------------------------------------------------------------------ filters and quick views

/** Search, the quick views (table only) and the filters folded behind "ตัวกรอง". `facets`: all of the
 *  year's deals (the ผู้รับผิดชอบ / แหล่งที่มา choices). */
function Toolbar({ S, facets, base, today }: { S: SalesState; facets: Deal[]; base?: Deal[]; today: string }) {
  const { engine: e, ui, set } = useApp();
  const F = ui.slF;
  const up = (p: Partial<typeof F>) => set({ slF: { ...F, ...p } });
  const uniq = (k: 'resp' | 'referral') => facetOptions(facets, k, F[k]);
  const nSet = Object.entries(F).filter(([k, v]) => k !== 'q' && k !== 'quick' && v).length;
  const [more, setMore] = useState(nSet > 0);
  const me = e.me();
  const mine = !!me && F.resp === me;
  const quick = F.quick || '';
  const seg = quick === 'paylate' ? 'payment' : quick;
  const views: [QuickView, string][] = [['', 'ทั้งหมด'], ['overdue', 'ค้างติดตาม'], ['notstarted', 'ยังไม่เริ่ม'], ['active', 'กำลังติดตาม'], ['payment', 'รอชำระเงิน'], ['ready', 'พร้อมปิดงาน']];
  const anyLate = !!base?.some((d) => quickMatch(S, d, 'paylate', today));
  const pick = (q: QuickView) => set({ slF: { ...F, quick: q }, slCollapsed: {} });
  return (
    <>
      <div className="sl-tools">
        {base && (
          <div className="seg sl-seg" role="group" aria-label="มุมมอง">
            {/* the jobs of whoever is using this browser (their ผู้รับผิดชอบ), on top of any view */}
            {me && (
              <button type="button" aria-pressed={mine} onClick={() => set({ slF: { ...F, resp: mine ? '' : me }, slCollapsed: {} })} title={mine ? 'แสดงงานของทุกคน' : `เฉพาะงานที่ ${me} รับผิดชอบ`}>
                ของฉัน<span className="n">{fmtN(base.filter((d) => d.resp === me).length)}</span>
              </button>
            )}
            {views.map(([k, label]) => {
              const n = k ? base.filter((d) => quickMatch(S, d, k, today)).length : base.length;
              const od = (k === 'overdue' && n > 0) || (k === 'payment' && anyLate);
              return (
                <button key={k || 'all'} type="button" aria-pressed={seg === k} onClick={() => pick(k)}>
                  {label}<span className={'n' + (od ? ' od' : '')}>{fmtN(n)}</span>
                </button>
              );
            })}
          </div>
        )}
        <label className="sl-search">
          <Icon name="search" size={17} />
          <input
            value={F.q || ''}
            onChange={(ev) => { const q = ev.target.value; set({ slF: { ...F, q }, ...(q.trim() && !(F.q || '').trim() ? { slCollapsed: {} } : {}) }); }}
            placeholder="ค้นหาบริษัท / ผู้ติดต่อ / โน้ต"
            aria-label="ค้นหา"
          />
        </label>
        <button type="button" className="btn" onClick={() => setMore(!more)} aria-expanded={more} aria-controls="sl-filters">
          ตัวกรอง{nSet ? ` (${nSet})` : ''}
        </button>
        {quick === 'paylate' && (
          <button type="button" className="ftag" onClick={() => pick('payment')} aria-label="ล้างตัวกรอง เฉพาะงวดเลยกำหนด">
            เฉพาะงวดเลยกำหนด<span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {more && (
        <div className="sl-filters" id="sl-filters">
          <select value={F.source || ''} onChange={(ev) => up({ source: ev.target.value })} className="fld sel" aria-label="SOURCE"><Opts all="SOURCE: ทั้งหมด" options={S.cfg.sources.map((x) => ({ v: x, label: x }))} /></select>
          <select value={F.service || ''} onChange={(ev) => up({ service: ev.target.value })} className="fld sel" aria-label="Services"><Opts all="Services: ทั้งหมด" options={S.cfg.services.map((x) => ({ v: x, label: x }))} /></select>
          <select value={F.resp || ''} onChange={(ev) => up({ resp: ev.target.value })} className="fld sel" aria-label="ผู้รับผิดชอบ"><Opts all="ผู้รับผิดชอบ: ทั้งหมด" options={uniq('resp').map((x) => ({ v: x, label: x }))} /></select>
          <select value={F.referral || ''} onChange={(ev) => up({ referral: ev.target.value })} className="fld sel" aria-label="แหล่งที่มา"><Opts all="แหล่งที่มา: ทั้งหมด" options={uniq('referral').map((x) => ({ v: x, label: x }))} /></select>
          <select value={F.result || ''} onChange={(ev) => up({ result: ev.target.value as typeof F.result })} className="fld sel" aria-label="ผลการขาย">
            <Opts all="ผลการขาย: ทั้งหมด" options={[{ v: 'YES', label: 'ได้งาน (YES)' }, { v: 'NO', label: 'ไม่ได้งาน (NO)' }, { v: 'WAIT', label: 'รอผล / มีหมายเหตุ' }, { v: 'EMPTY', label: 'ยังไม่มีผล' }]} />
          </select>
          <select value={F.month || ''} onChange={(ev) => up({ month: ev.target.value })} className="fld sel" aria-label="เดือนที่ติดต่อ"><Opts all="ติดต่อ: ทุกเดือน" options={TH_M.slice(1).map((m, i) => ({ v: String(i + 1).padStart(2, '0'), label: 'ติดต่อ ' + m }))} /></select>
          <select value={F.day || ''} onChange={(ev) => up({ day: ev.target.value })} className="fld sel" aria-label="วันที่ติดต่อ"><Opts all="ทุกวัน" options={Array.from({ length: 31 }, (_, i) => ({ v: String(i + 1).padStart(2, '0'), label: 'วันที่ ' + (i + 1) }))} /></select>
          {filtersOn({ ...F, quick: '' }) && <button type="button" onClick={() => set({ slF: {} })} className="quiet">ล้างตัวกรอง</button>}
        </div>
      )}
    </>
  );
}
const filtersOn = (F: Omit<SalesFilter, 'year'>) => Object.values(F).some(Boolean);

/** In place of the rows when the filters leave none. */
function NoMatch({ text }: { text: string }) {
  const { set } = useApp();
  return (
    <span className="sl-nomatch">
      <span role="status">{text}</span>
      <button onClick={() => set({ slF: {} })} className="lnk">ล้างตัวกรอง</button>
    </span>
  );
}

/** The KPI cards (design §7.1): the year's money (open and closed jobs: closing a paid job must not take
 *  its revenue out of the totals), what is still to be received, and the share of jobs won. They follow
 *  the filters, not the quick view. */
function Kpis({ S, open, all, today, year }: { S: SalesState; open: Deal[]; all: Deal[]; today: string; year: string }) {
  const { ui, set } = useApp();
  const st = salesStats(S, all, today);
  const rc = receivables(S, open, today);
  let fcOpen = 0, fcClosed = 0;
  all.forEach((d) => {
    const fc = dealMoney(S, d).forecast || 0;
    if (d.jobStatus === 'closed') fcClosed += fc;
    else fcOpen += fc;
  });
  const m = (n: number) => fmtMoney(Math.round(n)) || '0';
  const pct = st.forecast > 0 ? Math.round((st.actual / st.forecast) * 100) : null;
  return (
    <div className="kpis sl-kpis">
      <Kpi hero label={`Forecast รวม · ปี ${year}`} value={m(st.forecast)} unit="บาท" foot={<>งานเปิด <b>{m(fcOpen)}</b> · ปิดแล้ว <b>{m(fcClosed)}</b></>} />
      <Kpi label="Actual รวม" value={m(st.actual)} unit="บาท" zero={!st.actual} foot={pct != null ? <><b className="ok">{pct}%</b> ของ Forecast</> : 'ยังไม่มี Forecast'} />
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
            <span>ถึงกำหนดเดือนนี้ {m(rc.dueMonth)}</span>
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
  /** the deal being worked on (open, or opened last) */
  cur: string | undefined;
  edit: UIState['slEdit'];
  menu: string; setMenu: (id: string) => void;
  pop: string; setPop: (id: string) => void;
  toggle: (id: string, focusChev?: boolean) => void;
  openEditor: (id: string, stage: string, trigger?: HTMLElement | null) => void;
  closeEditor: () => void;
  attach: (deal: Deal, stage?: string, kind?: DocKind) => void;
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

function TableView({ e, S, deals, base, all, facets, today }: { e: Engine; S: SalesState; deals: Deal[]; base: Deal[]; all: Deal[]; facets: Deal[]; today: string }) {
  const { ui, set } = useApp();
  const mobile = useMedia('(max-width: 760px)');
  const acts = useSalesActs();
  // an account that can only read: no adding, no stage notes, no edits in the rows
  const ro = !e.can('edit');
  const cardRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState('');
  const [pop, setPop] = useState('');
  const [att, setAtt] = useState<{ deal: Deal; stage?: string; kind?: DocKind } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const editSeq = useRef(0);
  const secs = sectionsFor(S, deals);
  const bySec = new Map<string, Deal[]>(secs.map((s) => [s, []]));
  deals.forEach((d) => bySec.get(d.section)!.push(d));
  const visible = secs.filter((s) => bySec.get(s)!.length);
  // one company twice in the year (two people sent it at the same moment): marked, to delete one
  const perCo = new Map<number, number>();
  facets.forEach((d) => d.gid != null && perCo.set(e.canonical(d.gid), (perCo.get(e.canonical(d.gid)) || 0) + 1));
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
  const openEditor = (id: string, stage: string, t?: HTMLElement | null) => {
    trigger.current = t || null;
    editSeq.current++;
    setMenu('');
    setPop('');
    // the stage edited from the table marks its row too (the row you are working on)
    set((s) => ({ slEdit: { id, stage }, slOpen: { ...s.slOpen, [id]: 1 }, last: { ...s.last, deal: id } }));
  };
  const closeEditor = () => {
    const was = ui.slEdit, t = trigger.current, seq = ++editSeq.current;
    trigger.current = null;
    set({ slEdit: null });
    // back to what opened it, or the deal's chevron (phones: its card toggle) when that is gone
    requestAnimationFrame(() => {
      if (seq !== editSeq.current) return; // another editor opened meanwhile: it has the keyboard
      const back = t?.isConnected ? t : was && document.querySelector<HTMLElement>(`[data-chev="${was.id}"],[data-tog="${was.id}"]`);
      back?.focus({ preventScroll: true });
    });
  };
  const tk: Tk = {
    e, S, today, ro, team: e.crm.team, cur, edit: ui.slEdit, menu, setMenu, pop, setPop, toggle, openEditor, closeEditor, acts,
    attach: (deal, stage, kind) => {
      setMenu('');
      if (ui.slEdit) set({ slEdit: null });
      setAtt({ deal, stage, kind });
    },
    openPanel: (id, plan = '') => {
      setMenu('');
      set({ deal: id, dpPlan: plan, slToast: null });
    },
    dup: (d) => d.gid != null && (perCo.get(e.canonical(d.gid)) || 0) > 1,
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

  const secSum = (list: Deal[]) => {
    let od = 0, rd = 0, fc = 0, ac = 0;
    for (const d of list) {
      if (overdueDays(S, d, today) != null) od++;
      if (closeReady(S, d, today)) rd++;
      const m = dealMoney(S, d);
      fc += m.forecast || 0;
      ac += m.actual || 0;
    }
    return { n: list.length, od, rd, fc, ac };
  };

  if (!Object.values(S.deals).some((d) => d.year === ui.slYear))
    return (
      <div className="card sl-empty-card">
        <span className="card-t">ยังไม่มีลูกค้าในตารางปี {ui.slYear}</span>
        <span className="t-sec" style={{ lineHeight: 1.7 }}>
          {ro ? 'เมื่อทีมเพิ่มลูกค้า รายการจะแสดงที่นี่' : <>กด <b>เพิ่มลูกค้า</b> เพื่อค้นหาบริษัทในทะเบียนหรือเพิ่มลูกค้าใหม่ · ถ้ามีข้อมูลใน Sales Tracker เดิม ใช้เมนู ⋯ แล้วเลือก นำเข้าจาก Sales Tracker เดิม</>}
        </span>
      </div>
    );
  const stages = S.cfg.stages;
  return (
    <TkCtx.Provider value={tk}>
      <Kpis S={S} open={base} all={all} today={today} year={ui.slYear} />
      <Toolbar S={S} facets={facets} base={base} today={today} />
      {!deals.length ? (
        <div className="card sl-empty-card">
          {filtersOn(ui.slF) ? <NoMatch text="ไม่พบงานที่ยังเปิดตามตัวกรองนี้" /> : <span className="t-sec">ไม่มีงานที่ยังเปิดในปี {ui.slYear} งานที่ปิดแล้วอยู่ในแท็บ “ปิดงาน”</span>}
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
                    <span className="sl-s-tot">Forecast <b>{fmtMoney(sum.fc) || '0'}</b></span>
                  </div>
                </div>
                {!col && list.map((d) => <DealCard key={d.id} d={d} />)}
                {!col && !ro && <button type="button" className="lnk sl-m-add" onClick={() => addIn(e, set, sec, ui.slYear)}>เพิ่มลูกค้าในหมวด {name}</button>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="sl-card" ref={cardRef} onFocus={keepFocusInView} onClick={rowClick}>
          <table className="sl-table" aria-label={`Sales Tracker ปี ${ui.slYear} งานที่ยังเปิด`}>
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
                <th className="k-last" title="ติดต่อล่าสุด คือวันที่ติดต่อที่พิมพ์ไว้ หรือวันที่ของขั้นตอนล่าสุด แล้วแต่วันไหนใหม่กว่า · เกิน 14 วันขึ้นว่า ค้าง">ติดต่อล่าสุด</th>
                <th className="k-fc" title="Forecast คือยอดในใบเสนอราคาที่แนบที่ขั้น QUOTATION (หรือยอดที่พิมพ์เอง)">Forecast<small>จาก QUOTATION</small><small className="sl-th-ac2">และ Actual</small></th>
                <th className="k-ac" title={`Actual คือยอดใบแจ้งหนี้ / ใบเสร็จที่แนบที่ ${payStages(S.cfg).join(', ') || 'PAY'} รวมกัน`}>Actual<small>{actualSource(S.cfg)}</small></th>
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
                        <span className="k2-fc"><span className={'sl-s-sum' + (sum.fc ? '' : ' none')} title="รวม Forecast ของหมวดนี้ (งานที่เปิด)">{sum.fc ? fmtMoney(sum.fc) : '—'}</span></span>
                        <span className="k2-ac"><span className={'sl-s-sum' + (sum.ac ? '' : ' none')} title="รวม Actual ของหมวดนี้ (งานที่เปิด)">{sum.ac ? fmtMoney(sum.ac) : '—'}</span></span>
                      </span>
                    </td>
                    <td className="sl-s-add" colSpan={2}>
                      {!ro && <button type="button" className="lnk sl-addbtn" onClick={() => addIn(e, set, sec, ui.slYear)} aria-label={'เพิ่มลูกค้าในหมวด ' + name}>เพิ่มในหมวดนี้</button>}
                    </td>
                  </tr>
                  {!col &&
                    list.map((d) => {
                      const open = !!ui.slOpen[d.id];
                      return (
                        <DealRows key={d.id} d={d} open={open} stages={stages} />
                      );
                    })}
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
      {att && <DocAttach deal={att.deal} stage={att.stage} kind={att.kind} onClose={() => setAtt(null)} />}
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
function DealRows({ d, open, stages }: { d: Deal; open: boolean; stages: string[] }) {
  const { S, today } = useTk();
  const t = stageTrack(S, d, today);
  const kids = open ? kidList(S, d, today) : [];
  return (
    <>
      {open && <tr className="sl-gap" aria-hidden="true"><td colSpan={10} /></tr>}
      <DealRow d={d} open={open} t={t} kidIds={kids.map((_, i) => `k-${d.id}-${i}`).concat(`k-${d.id}-end`)} stages={stages} />
      {open && <KidRows d={d} t={t} list={kids} />}
      {open && <tr className="sl-gap" aria-hidden="true"><td colSpan={10} /></tr>}
    </>
  );
}

type Track = ReturnType<typeof stageTrack>;

function DealRow({ d, open, t, kidIds, stages }: { d: Deal; open: boolean; t: Track; kidIds: string[]; stages: string[] }) {
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
    <tr className={'sl-row' + (cur ? ' cur' : '') + (open ? ' og ogf' : '')} aria-current={cur ? 'true' : undefined} data-id={d.id} style={open && reached >= 0 ? { '--line-c': 'var(--brand)' } : undefined}>
      <td className="k-chev">
        <button type="button" className="sl-chev" data-chev={d.id} aria-expanded={open} aria-controls={kidIds.join(' ')} aria-label={`${open ? 'ซ่อน' : 'แสดง'}ขั้นตอนของ ${name}`} onClick={() => tk.toggle(d.id, true)}>
          <Chevron />
        </button>
      </td>
      <th scope="row" className="k-name">
        <span className="sl-nmw">
          <CoAvatar name={c?.name || d.client} web={c?.web} set={c?.set} size={34} />
          <span className="sl-nm">
            <button type="button" className="sl-nm-b hv-tx" onClick={() => tk.openPanel(d.id)} title={`${d.client} เปิดรายละเอียด`} aria-label={`${d.client} เปิดรายละเอียด`}>{name}</button>
            <span className="sl-nm-s">
              {cur && <span className="sl-tg">เปิดล่าสุด</span>}
              {isNew && <span className="sl-tg">ใหม่</span>}
              {tk.dup(d) && <span className="sl-tg bad" title={`บริษัทนี้มีในตารางปี ${d.year} มากกว่า 1 แถว เปิดแถวที่ซ้ำแล้วลบออก`}>ซ้ำ</span>}
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
      <td className="k-last"><ContactCell d={d} /></td>
      <td className="k-fc"><MoneyFc d={d} /></td>
      <td className="k-ac"><MoneyAc d={d} /></td>
      <td className="k-st"><StatusCell d={d} /></td>
      <td className="k-act"><RowMenu d={d} /></td>
    </tr>
  );
}

/** ผู้รับผิดชอบ: the name as text over a real <select> (one avatar per row: the company's). */
function Owner({ d }: { d: Deal }) {
  const { e, ro, team } = useTk();
  const name = d.resp || 'มอบหมาย';
  if (ro) return <span className="sl-owner ro" title={'ผู้รับผิดชอบ ' + (d.resp || 'ยังไม่ระบุ')}><span className="sl-owner-name">{d.resp || '—'}</span></span>;
  const resps = [...new Set([...team, d.resp].filter(Boolean))];
  return (
    <label className="sl-owner" title={`ผู้รับผิดชอบ: ${name} กดเพื่อเปลี่ยน`}>
      <span className={'sl-owner-name' + (d.resp ? '' : ' none')}>{name}</span>
      <select value={d.resp} data-owner={d.id} onChange={(ev) => e.updateDeal(d.id, { resp: ev.target.value })} aria-label={`ผู้รับผิดชอบ ${shortName(d.client)}`}>
        {resps.map((x) => <option key={x} value={x}>{x}</option>)}
        <option value="">ไม่ระบุ</option>
      </select>
    </label>
  );
}

/** "ถัดไป CALL2 โทรครั้งที่ 2": opens the stage editor on that stage; plain text for viewers. A won deal
 *  with a plan names its next installment (red when late, amber when due within 7 days or part paid). */
function NextPill({ d, card }: { d: Deal; card?: boolean }) {
  const tk = useTk();
  const v = nextStepView(tk.S, d, tk.today);
  if (v.kind === 'no') return <span className="sl-nx txt">ไม่ต้องติดตามต่อ</span>;
  if (v.kind === 'done') return <span className="sl-nx txt ok">ครบทุกขั้น</span>;
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
  const { date, from } = lastContactInfo(S, d, today);
  const od = overdueDays(S, d, today);
  const src = from && from !== 'typed' ? `จากขั้น ${from}` : from === 'typed' ? 'วันที่ติดต่อที่พิมพ์ไว้' : '';
  const main = date ? dmTh(date) : '—';
  const sub = od != null ? <span className="chip bad" title="ไม่ได้ติดต่อเกิน 14 วัน">ค้าง {fmtN(od)} วัน</span> : <span className="sl-ago">{date ? agoTh(date, today) : 'ยังไม่ได้ติดต่อ'}</span>;
  const open = tk.pop === d.id;
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>('.sl-datechip')?.focus();
  }, [open]);
  if (ro) return <span className="sl-cdw"><span className="sl-cdate ro" title={`ติดต่อล่าสุด ${date ? isoTh(date) : 'ยังไม่มี'} ${src}`}>{main}</span>{sub}</span>;
  const close = () => {
    tk.setPop('');
    btn.current?.focus();
  };
  return (
    <span
      className="sl-cdw"
      onBlur={(ev) => open && !ev.currentTarget.contains(ev.relatedTarget as Node) && tk.setPop('')}
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
        data-pop={d.id}
        title={`ติดต่อล่าสุด ${date ? isoTh(date) + ' · ' + src : 'ยังไม่มี'} กดเพื่อแก้วันที่ติดต่อ`}
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
          <p>ติดต่อล่าสุดในตาราง คือวันที่นี้ หรือวันที่ของขั้นตอนล่าสุด แล้วแต่วันไหนใหม่กว่า{from && from !== 'typed' ? ` · ตอนนี้มาจาก ${from} ${isoTh(date)}` : ''}</p>
        </div>
      )}
    </span>
  );
}

/** A typed amount: the figure (a button) turns into a box on click; "1.5 ล้าน", "120,000.-" are read too. */
function TypedMoney({ value, sub, label, onSave }: { value: number | null; sub?: ReactNode; label: string; onSave: (v: number | null) => void }) {
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
      {sub}
    </button>
  );
}

/** Forecast: the quotation's figure ("ยืนยันจากเอกสาร"), or the typed one ("พิมพ์เอง", editable). */
function MoneyFc({ d }: { d: Deal }) {
  const { e, S, ro } = useTk();
  const m = dealMoney(S, d);
  const sub = m.fcDoc ? <small className="ok" title={`${KIND_TH[m.fcDoc.kind]} ${m.fcDoc.docNo} (ขั้น QUOTATION)`}>ยืนยันจากเอกสาร</small> : m.forecast != null ? <small>พิมพ์เอง</small> : null;
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
      <TypedMoney value={m.forecast} sub={sub} label="Forecast (บาท)" onSave={(v) => e.updateDeal(d.id, { forecast: v })} />
      {ac2}
    </span>
  );
}

/** Actual: with a plan what came in + what is still owed (red when an installment is late), "แผน 3 งวด"
 *  before the deal is won; without one the documents' sum (or the typed figure, editable). */
function MoneyAc({ d }: { d: Deal }) {
  const { e, S, today, ro } = useTk();
  const m = dealMoney(S, d), r = dealResult(S, d), ps = payState(S, d, today), P = ps.plan;
  if (P && r === 'YES')
    return (
      <span className="sl-mn">
        <b className={P.got ? '' : 'none'}>{P.got ? fmtMoney(P.got) : '—'}</b>
        {P.left ? (
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
  const sub = r === 'YES' && m.actual != null && m.forecast != null && m.actual < m.forecast ? <small>ค้าง {fmtMoney(m.forecast - m.actual)}</small> : r === 'YES' && m.actual != null && !ps.left.length ? <small className="ok">รับครบ</small> : null;
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
      <TypedMoney value={m.actual} sub={sub} label="Actual (บาท)" onSave={(v) => e.updateDeal(d.id, { actual: v })} />
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

/** ⋯: words only. Viewers get "เปิดรายละเอียด" alone. */
function RowMenu({ d }: { d: Deal }) {
  const tk = useTk();
  const open = tk.menu === d.id;
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
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
  return (
    <span
      ref={ref}
      className="sl-actw"
      onBlur={(ev) => open && !ev.currentTarget.contains(ev.relatedTarget as Node) && tk.setMenu('')}
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
        <span role="menu" className="menu sl-menu sl-rowmenu">
          <button role="menuitem" className="menu-i" onClick={pick(() => tk.openPanel(d.id))}>เปิดรายละเอียด</button>
          {!tk.ro && (
            <>
              <button role="menuitem" className="menu-i" onClick={pick(() => tk.attach(d))}>แนบเอกสาร<small>ระบบเลือกขั้นให้</small></button>
              <button role="menuitem" className="menu-i" onClick={pick(() => tk.openPanel(d.id, 'edit'))}>แผนการชำระเงิน<small>{planOf(tk.S, d, tk.today) ? 'แก้ไขแผน' : 'ตั้งแผน งวดละเท่าไร เมื่อไร'}</small></button>
              <button
                role="menuitem"
                className="menu-i"
                onClick={pick(() => {
                  const sel = document.querySelector<HTMLSelectElement>(`select[data-owner="${d.id}"]`);
                  sel?.focus();
                  try {
                    sel?.showPicker();
                  } catch {
                    /* the focused select still opens with the keyboard */
                  }
                })}
              >
                เปลี่ยนผู้รับผิดชอบ
              </button>
              <button role="menuitem" className="menu-i" onClick={() => { tk.setMenu(''); tk.setPop(d.id); }}>แก้วันที่ติดต่อ</button>
              <hr />
              <button role="menuitem" className="menu-i" onClick={pick(() => tk.acts.close(d.id))}>ปิดงาน<small>{ready ? 'ย้ายไปแท็บปิดงาน' : 'ยังไม่ครบ ปิดเองได้ (ถามยืนยัน)'}</small></button>
            </>
          )}
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
  const { ui, set } = useApp();
  const tk = useTk();
  const { S, today, ro } = tk;
  const stages = S.cfg.stages;
  const editStage = tk.edit?.id === d.id ? tk.edit.stage : '';
  // the list from the parent (for the chevron's aria-controls) unless the editor or "แสดง" changed it
  const list = editStage || ui.slShowAll[d.id] ? kidList(S, d, today, !!ui.slShowAll[d.id], editStage) : list0;
  const reached = reachedOf(stages, t.states);
  const P = planOf(S, d, today), won = t.result === 'YES';
  const late = overdueDays(S, d, today) != null;
  const by = stageDocs(S, d).by;
  const cv = closingView(S, d, today);
  const ps = payState(S, d, today);
  return (
    <>
      {list.map((r, ri) => {
        const id = `k-${d.id}-${ri}`;
        if ('fold' in r) {
          const last = r.fold.map((p) => stepOf(S, d.id, p).d).filter(Boolean).sort().pop();
          return (
            <tr key={id} id={id} className={'sl-kid og on1 kfold' + (r.i < reached ? ' on2' : '')} data-deal={d.id} data-stage="fold">
              <td className="k-chev"><Bead state="done" /></td>
              <th scope="row" className="k-name" colSpan={4}>
                <span className="sl-kf">
                  <b>{r.fold.join(' · ')}</b>
                  <span>ทำแล้ว {r.fold.length} ขั้น{last ? ' · ล่าสุด ' + isoTh(last) : ''}</span>
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
        const unused = !!P && won && isPayStage(S.cfg, p) && !line;
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
        if (line) return <PayRow key={id} id={id} cls={cls} d={d} line={line} st={st} isNow={isNow} won={won} next={P?.next?.stage === p} nameCell={nameCell} editBtn={editBtn} />;
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
        } else if (isNow && !ro) {
          note = <button type="button" className="lnk" data-qa={d.id + ':' + p + ':add'} onClick={(ev) => tk.openEditor(d.id, p, ev.currentTarget)}>บันทึกวันที่และโน้ต</button>;
        }
        const date = s.d ? (st === 'planned' ? <span className="sl-kdate">นัด {dmTh(s.d)}<small>{agoTh(s.d, today)}</small></span> : <span className="sl-kdate">{isoTh(s.d)}</span>) : null;
        // documents and amounts sit in the column they feed: QUOTATION under Forecast, PAY under Actual
        let money: ReactNode = null;
        const isMoney = p === QUOTE_STAGE || isPayStage(S.cfg, p);
        if (isMoney && st !== 'off') {
          const doc = (by[p] || []).find((x) => x.amount != null);
          const slot = !doc && (p === QUOTE_STAGE ? isNow || st === 'done' : won && isNow) && !ro;
          money = doc ? <DocAmount doc={doc} /> : slot ? (
            <button type="button" className="lnk" onClick={() => tk.attach(d, p)} title={p === QUOTE_STAGE ? 'ยอดจะเป็น Forecast' : 'ยอดจะรวมเข้า Actual'} aria-label={`แนบ${p === QUOTE_STAGE ? 'ใบเสนอราคา' : 'ใบแจ้งหนี้ หรือใบเสร็จ'}ที่ ${p}`}>
              แนบ{p === QUOTE_STAGE ? 'ใบเสนอราคา' : 'ใบเสร็จ'}
            </button>
          ) : null;
        }
        return (
          <tr key={id} id={id} className={cls} data-deal={d.id} data-stage={p}>
            <td className="k-chev"><Bead state={st} now={isNow} late={late} stage={p} /></td>
            {nameCell}
            <td className="sl-knote" colSpan={3}>{note}</td>
            <td className="k-last">{date}</td>
            <td className="k-m2" colSpan={2}>
              <span className="sl-m2">
                <span className="k2-fc">{p === QUOTE_STAGE && money}</span>
                <span className="k2-ac">{p !== QUOTE_STAGE && money}</span>
              </span>
            </td>
            <td className="k-st">{chip}</td>
            <td className="k-act">{editBtn}</td>
          </tr>
        );
      })}
      <tr id={`k-${d.id}-end`} className="sl-kend og ogl">
        <td className="k-chev"><span className={'sl-flagb' + (cv.ready ? ' ready' : '')} aria-hidden="true" /></td>
        <th scope="row" className="k-name">
          <span className="sl-kend-n"><b>ปิดงาน</b><span>ย้ายไปแท็บปิดงาน</span></span>
        </th>
        <td className="sl-rule" colSpan={4}>
          <span className="sl-clamp">
            {closingRule(cv.state, P, ps)} · <button type="button" className="lnk" onClick={() => tk.openPanel(d.id)}>รายละเอียดทั้งหมด</button>
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

/** The closing row's sentence (the lead phrase 500). */
function closingRule(state: ReturnType<typeof closingView>['state'], P: ReturnType<typeof planOf>, ps: ReturnType<typeof payState>): ReactNode {
  switch (state) {
    case 'no':
      return <><b>ผลการขายเป็น NO</b> ไม่ต้องติดตามต่อ กดปิดงานเพื่อย้ายไปแท็บปิดงาน (เปิดกลับได้)</>;
    case 'plan':
      return <><b>ได้งานแล้ว · รับ {P?.paidN} จาก {P?.n} งวดตามแผน</b> รับครบทุกงวดแล้วปุ่มปิดงานจะขึ้น</>;
    case 'pays':
      return <><b>ได้งานแล้ว · รับชำระ {ps.paid.length} จาก {ps.pays.length} งวด</b> แนบเอกสาร {ps.left.join(', ')} แล้วปุ่มปิดงานจะขึ้น</>;
    case 'nopay':
      return <><b>ได้งานแล้ว</b> ตารางนี้ไม่มีขั้นชำระเงิน (PAY) กดปิดงานเมื่องานจบ</>;
    case 'done':
      return <><b>ได้งานและรับชำระครบ{P ? 'ทุกงวดตามแผน' : ''}แล้ว</b> กดปิดงานเพื่อย้ายไปแท็บปิดงาน</>;
    default:
      return <>ผลการขาย YES / NO <b>ยังไม่ใช่การปิดงาน</b> ปุ่มปิดงานจะขึ้นเมื่อผลเป็น NO หรือได้งานและรับชำระครบ</>;
  }
}

/** A document's amount in a child row: a button that opens the file, the document number under it. */
function DocAmount({ doc }: { doc: DealDoc }) {
  const { e } = useTk();
  return (
    <>
      <button type="button" className="sl-amt hv-tx" onClick={() => openDocFile(e, doc)} title={`${KIND_TH[doc.kind]} ${doc.docNo} · ${fmtMoney(doc.amount)} บาท เปิดไฟล์`}>{fmtMoney(doc.amount)}</button>
      <span className="sl-dno">{doc.docNo || KIND_TH[doc.kind]}</span>
    </>
  );
}

/** ได้งาน / ไม่ได้งาน / รอผล: saves the result at once (ผลการขาย is not ปิดงาน). */
function ResultSeg({ d, state, big, date }: { d: Deal; state: StageState; big?: boolean; date?: string }) {
  const { e, today, acts } = useTk();
  const save = (r: 'YES' | 'NO' | 'WAIT') => {
    const cur = stepOf(e.sales, d.id, DEAL_STAGE);
    if (dealResult(e.sales, d) === r) return;
    const was = closeReady(e.sales, d, today);
    e.setStep(d.id, DEAL_STAGE, { d: date || cur.d || today, n: r === 'WAIT' ? 'รอผล' : r });
    if (r === 'WAIT') acts.say(`บันทึกผลการขายของ ${shortName(d.client)} เป็น รอผล แล้ว`);
    else acts.afterResult(d, was);
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
  const go = (n: number) => {
    const r = e.quickPlan(d.id, n);
    if (!r) return;
    const amts = r.amounts.every((x) => x != null) ? r.amounts.map((x) => fmtMoney(x)).join(' + ') + ' บาท' : 'ใส่ยอดได้ที่แผนการชำระ';
    acts.say(`ตั้งแผน ${n} งวดแล้ว · ${amts} · งวดแรกครบกำหนด 30 วันหลังได้งาน${n > 1 ? ' แล้วทุก 30 วัน' : ''}`, { ms: 8000, acts: [{ label: 'แก้ไขแผน', act: 'plan', deal: d.id, primary: true }] });
  };
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
function PayRow({ id, cls, d, line: x, st, isNow, won, next, nameCell, editBtn }: { id: string; cls: string; d: Deal; line: LineView; st: StageState; isNow: boolean; won: boolean; next: boolean; nameCell: ReactNode; editBtn: ReactNode }) {
  const tk = useTk();
  const { S, today, ro } = tk;
  const s = stepOf(S, d.id, x.stage);
  const meta = lineMeta(x.line);
  const userNote = s.n && !isAutoNote(S, d, x.stage) ? s.n : '';
  const acts = !won || ro || !next ? null : x.status === 'part' ? (
    <span className="sl-pk-b">
      <button type="button" className="btn xs" onClick={() => { const r = tk.e.setPayFull(d.id, x.stage, true); if (r) tk.acts.prompt(d, 'payment'); else tk.acts.say(`ถือว่ารับครบ ${x.stage} แล้ว`); }}>ถือว่ารับครบ</button>
      <button type="button" className="lnk" onClick={() => tk.attach(d, x.stage)}>แนบใบเสร็จเพิ่ม</button>
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
  const money =
    x.status === 'paid' ? (
      x.doc ? <DocAmount doc={x.doc} /> : <><span className="sl-amt">{fmtMoney(x.got)}</span><span className="sl-dno">รับเอง{x.line.how ? ' · ' + lineMeta({ pct: null, how: x.line.how, howT: '', note: '' }) : ''}</span></>
    ) : x.status === 'part' ? (
      <><span className="sl-amt warn">{fmtMoney(x.got)}</span><span className="sl-dno">จาก {fmtMoney(x.amt)}</span></>
    ) : (
      <><span className={'sl-amt' + (x.status === 'draft' || x.status === 'off' ? ' draft' : '')} title="ยอดตามแผน">{x.line.amt != null ? fmtMoney(x.amt) : '—'}</span><span className="sl-dno">ตามแผน</span></>
    );
  const sv = lineStatusView(x, today);
  const stat = sv.kind === 'muted' ? <span className="sl-st-m">{sv.word}</span> : sv.chip ? <span className={'chip ' + sv.kind}>{sv.word}</span> : <Status kind={sv.kind}>{sv.word}</Status>;
  return (
    <tr id={id} className={cls} data-deal={d.id} data-stage={x.stage}>
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
      <td className="k-last">{date}</td>
      <td className="k-m2" colSpan={2}>
        <span className="sl-m2">
          <span className="k2-fc" />
          <span className="k2-ac">{money}</span>
        </span>
      </td>
      <td className="k-st">{stat}</td>
      <td className="k-act">{editBtn}</td>
    </tr>
  );
}

// ------------------------------------------------------------------ the stage editor (table row and phone card)

/** The editor's state: the note (a draft left with Escape comes back), the date (today unless the stage
 *  was done earlier), save / cancel / the result. Saving checks that nobody changed the stage meanwhile. */
function useStepEditor(d: Deal, stage: string) {
  const tk = useTk();
  const { e, today } = tk;
  const key = d.id + '/' + stage;
  const [init] = useState(() => stepOf(e.sales, d.id, stage));
  const [note, setNote] = useState(() => drafts.get(key) ?? (stage === DEAL_STAGE && /^(yes|no)$/i.test(init.n.trim()) ? '' : init.n));
  const [date, setDate] = useState(() => (init.d && init.d <= today ? init.d : today));
  const changed = () => {
    const live = stepOf(e.sales, d.id, stage);
    return (live.d !== init.d || live.n !== init.n) && !window.confirm(`มีคนแก้ขั้นนี้ระหว่างที่เปิดอยู่:\n"${live.n || '(ว่าง)'}"\n\nบันทึกของคุณทับหรือไม่?`);
  };
  const save = () => {
    if (changed()) return tk.closeEditor();
    const was = closeReady(e.sales, d, today);
    e.setStep(d.id, stage, { d: date, n: note });
    drafts.delete(key);
    tk.closeEditor();
    const r = dealResult(e.sales, d);
    if (stage === DEAL_STAGE && (r === 'YES' || r === 'NO')) tk.acts.afterResult(d, was);
    else tk.acts.after(d, was, 'payment', `บันทึก ${stage} ของ ${shortName(d.client)} แล้ว · ${dmTh(date)}`);
  };
  const cancel = () => {
    if (note.trim() && note !== init.n) drafts.set(key, note);
    else drafts.delete(key);
    tk.closeEditor();
  };
  const result = (r: 'YES' | 'NO' | 'WAIT') => {
    if (changed()) return tk.closeEditor();
    const was = closeReady(e.sales, d, today);
    const typed = note.trim();
    e.setStep(d.id, DEAL_STAGE, { d: date, n: r === 'WAIT' ? (typed && !/^(yes|no)$/i.test(typed) ? typed : 'รอผล') : r });
    drafts.delete(key);
    tk.closeEditor();
    if (r === 'WAIT') tk.acts.say(`บันทึกผลการขายของ ${shortName(d.client)} เป็น รอผล แล้ว`);
    else tk.acts.afterResult(d, was);
  };
  // a click outside the editor (not in a dialog it opened) leaves it, keeping the draft
  const box = useRef<HTMLElement | null>(null);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const down = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement;
      if (!box.current || box.current.contains(t) || t.closest?.('[role=dialog],.sl-live')) return;
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
  return { note, setNote, date, setDate, save, cancel, result, box, keys, init };
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
  return (
    <>
      <td className="sl-knote" colSpan={3} ref={(el) => void (ed.box.current = el?.closest('tr') || null)}>
        <span className="sl-qaw">
          <span className="sl-qa-row">
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
            {line && won && line.status !== 'paid' && <button type="button" className="btn xs" onClick={() => { ed.cancel(); tk.openPanel(d.id, `recv:${stage}`); }}>รับเงินแล้ว</button>}
          </span>
          <span className="sl-qa-hint">Enter บันทึก · Esc ยกเลิก</span>
        </span>
      </td>
      <td className="k-last" onKeyDown={ed.keys}><DateChip value={ed.date} onChange={ed.setDate} label={`วันที่ ${stage}`} /></td>
      <td className="k-m2" colSpan={2}>
        <span className="sl-m2">
          <span className="k2-fc">{stage === QUOTE_STAGE && !hasDoc && !tk.ro && <button type="button" className="btn xs" onClick={() => { ed.cancel(); tk.attach(d, stage); }}>แนบใบเสนอราคา</button>}</span>
          <span className="k2-ac">{isMoney && stage !== QUOTE_STAGE && won && !hasDoc && <button type="button" className="btn xs" onClick={() => { ed.cancel(); tk.attach(d, stage); }}>แนบใบเสร็จ</button>}</span>
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
  const acTile = P && won ? (
    <><b className={P.got ? '' : 'none'}>{P.got ? fmtMoney(P.got) : '—'}</b><small className={P.left ? (P.late.length ? 'bad' : '') : 'ok'}>{P.left ? `ค้าง ${fmtMoney(P.left)}${P.next?.due ? ' · ' + (P.next.lateDays ? 'เลยกำหนด' : dmTh(P.next.due)) : ''}` : 'รับครบ'}</small></>
  ) : P && t.result !== 'NO' ? (
    <><b className="none">—</b><small>แผน {P.n} งวด · {fmtMoney(P.total)}</small></>
  ) : (
    <><b className={m.actual != null ? '' : 'none'}>{m.actual != null ? fmtMoney(m.actual) : '—'}</b><small className={m.actual != null && !(m.forecast != null && m.forecast > m.actual) && won ? 'ok' : ''}>{m.actual != null ? (m.forecast != null && m.forecast > m.actual ? 'ค้าง ' + fmtMoney(m.forecast - m.actual) : won ? 'รับครบ' : 'พิมพ์เอง') : actualSource(S.cfg)}</small></>
  );
  return (
    <article className={'sl-mc' + (cur ? ' cur' : '')} aria-current={cur ? 'true' : undefined} data-id={d.id} aria-label={d.client}>
      <div className="sl-mc-h">
        <CoAvatar name={c?.name || d.client} web={c?.web} set={c?.set} size={34} />
        <div className="sl-mc-t">
          <button type="button" className="sl-nm-b hv-tx" onClick={() => tk.openPanel(d.id)} aria-label={`${d.client} เปิดรายละเอียด`}>{name}</button>
          <span className="sl-nm-s">
            {cur && <span className="sl-tg">เปิดล่าสุด</span>}
            <span className="sl-ct">{d.resp || 'ยังไม่มอบหมาย'} · {lc ? 'ติดต่อ ' + dmTh(lc) : 'ยังไม่ได้ติดต่อ'}</span>
            {od != null && <span className="chip bad">ค้าง {fmtN(od)} วัน</span>}
          </span>
        </div>
        <div className="sl-mc-st"><Status kind={sv.kind}>{sv.word}</Status></div>
      </div>
      <MiniTrack stages={S.cfg.stages} states={t.states} next={t.next} done={t.done} late={od != null || nextStepView(S, d, today).tone === 'late'} />
      <div className="sl-mc-money">
        <div className="sl-mc-m"><span>Forecast</span><b className={m.forecast != null ? '' : 'none'}>{m.forecast != null ? fmtMoney(m.forecast) : '—'}</b><small className={m.fcDoc ? 'ok' : ''}>{m.fcDoc ? 'ยืนยันจากเอกสาร' : m.forecast != null ? 'พิมพ์เอง' : 'จาก QUOTATION'}</small></div>
        <div className="sl-mc-m"><span>Actual</span>{acTile}</div>
      </div>
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

/** The open card: the stages as a short vertical timeline, then the closing step. */
function CardKids({ d, t }: { d: Deal; t: Track }) {
  const { ui, set } = useApp();
  const tk = useTk();
  const { S, today, ro } = tk;
  const stages = S.cfg.stages;
  const editStage = tk.edit?.id === d.id ? tk.edit.stage : '';
  const list = kidList(S, d, today, !!ui.slShowAll[d.id], editStage);
  const reached = reachedOf(stages, t.states);
  const P = planOf(S, d, today), won = t.result === 'YES';
  const late = overdueDays(S, d, today) != null;
  const by = stageDocs(S, d).by;
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
                <p className="sl-mk-plan">ทำแล้ว {r.fold.length} ขั้น · <button type="button" className="lnk" onClick={() => set({ slShowAll: { ...ui.slShowAll, [d.id]: 1 } })}>แสดง</button></p>
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
        const doc = (by[p] || []).find((x) => x.amount != null);
        const unused = !!P && won && isPayStage(S.cfg, p) && !pl;
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
        } else if (isMoney && st !== 'off' && !editing && !unused && (doc || (p === QUOTE_STAGE && (isNow || st === 'done')) || (won && isNow)))
          right = (
            <>
              {right}
              {doc ? <DocAmount doc={doc} /> : ro ? null : <button type="button" className="lnk" onClick={() => tk.attach(d, p)}>แนบ{p === QUOTE_STAGE ? 'ใบเสนอราคา' : 'ใบเสร็จ'}</button>}
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
                {pl.status === 'paid' ? `รับ ${dmTh(pl.rcvDate)}${pl.doc ? ' · ' + (pl.doc.docNo || KIND_TH[pl.doc.kind]) : ''}` : pl.status === 'draft' ? (pl.line.due ? dmTh(pl.line.due) : relText(pl.line)) : pl.due ? (pl.lateDays ? <><span className="t-bad">เลยกำหนด {pl.lateDays} วัน</span> · ครบกำหนด {dmTh(pl.due)}</> : `ครบกำหนด ${dmTh(pl.due)}`) : 'ยังไม่กำหนดวัน'}
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
                <button type="button" className="lnk" onClick={() => tk.attach(d, p)}>แนบใบเสร็จ</button>
              </span>
            </>
          );
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
      <div className="sl-mk" role="listitem">
        <span className={'sl-flagb' + (cv.ready ? ' ready' : '')} aria-hidden="true" />
        <div className="sl-mk-t">
          <div><b>ปิดงาน</b><span>ย้ายไปแท็บปิดงาน</span></div>
          <p className="sl-mk-plan">
            {cv.state === 'no' ? 'ผลเป็น NO กดปิดงานเพื่อย้ายไปแท็บปิดงาน'
              : cv.state === 'plan' || cv.state === 'pays' ? `ได้งานแล้ว · รับ ${ps.paid.length}/${ps.pays.length} งวด${P ? 'ตามแผน' : ''} · ${cv.hint}`
              : cv.state === 'done' || cv.state === 'nopay' ? 'ได้งานและรับชำระครบ ปิดงานได้'
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
  return (
    <div className="sl-mk-ed" ref={(el) => void (ed.box.current = el)} onKeyDown={ed.keys}>
      {stage === DEAL_STAGE && <ResultButtons state="" label="ผลการขาย" onPick={ed.result} />}
      {isMoney && (stage === QUOTE_STAGE || won) && (
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
    </div>
  );
}

// ------------------------------------------------------------------ closed + log

/** Closed jobs of the year, with the same filters as the table (shown here too, so what is counted is what is listed). */
function ClosedView({ S, deals, facets, total }: { S: SalesState; deals: Deal[]; facets: Deal[]; total: number }) {
  const { engine: e, ui, set } = useApp();
  const on = filtersOn({ ...ui.slF, quick: '' }); // the quick views are about open work: not applied here
  let fc = 0, ac = 0;
  deals.forEach((d) => {
    const m = dealMoney(S, d);
    fc += m.forecast || 0;
    ac += m.actual || 0;
  });
  const today = todayISO();
  return (
    <>
      <p className="sl-closed-sum">
        <span>ปิดแล้ว <b>{fmtN(deals.length)}</b> งาน{on ? ` จาก ${fmtN(total)} (ตามตัวกรอง)` : ''} · Forecast <b>{fmtMoney(fc) || '0'}</b> · Actual <b>{fmtMoney(ac) || '0'}</b></span>
        <span className="t-meta">งานที่กด “ปิดงาน” แล้ว ทั้งได้งานและไม่ได้งาน · เปิดกลับได้ · ยอดยังนับในสรุปปี</span>
      </p>
      <Toolbar S={S} facets={facets} today={today} />
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
              {deals.map((d) => {
                const m = dealMoney(S, d), r = dealResult(S, d);
                return (
                  <tr key={d.id}>
                    <td><button type="button" className="sl-nm-b hv-tx" onClick={() => set({ deal: d.id })} title={d.client}>{shortName(d.client)}</button></td>
                    <td className="c-opt t-sec">{d.section || 'ไม่ระบุหมวด'}</td>
                    <td className="c-opt">{d.resp || '—'}</td>
                    <td><Status kind={r === 'YES' ? 'ok' : r === 'NO' ? 'bad' : 'neutral'}>{r === 'YES' ? 'ได้งาน' : r === 'NO' ? 'ไม่ได้งาน' : 'ไม่ระบุผล'}</Status></td>
                    <td className="r"><span className="sl-mn"><b className={m.forecast == null ? 'none' : ''}>{m.forecast == null ? '—' : fmtMoney(m.forecast)}</b>{m.fcConfirmed && <small className="ok">ยืนยันแล้ว</small>}</span></td>
                    <td className="r c-opt"><span className="sl-mn"><b className={m.actual == null ? 'none' : ''}>{m.actual == null ? '—' : fmtMoney(m.actual)}</b>{m.acConfirmed && <small className="ok">ยืนยันแล้ว</small>}</span></td>
                    <td className="c-opt t-sec">{d.closedDate ? isoTh(d.closedDate) : '—'}</td>
                    <td className="r">{e.can('edit') && <button type="button" className="lnk sl-reopen" onClick={() => e.updateDeal(d.id, { jobStatus: 'open' })}>เปิดงานอีกครั้ง</button>}</td>
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
