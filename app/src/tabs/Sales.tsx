import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dtTh, fmtN, isoTh, todayISO } from '../lib/format';
import {
  KIND_TH, STAGE_TH, dealMoney, dealResult, dealStatus, docsOf, filterDeals, fmtMoney, lastContact, overdueDays, parseAmount, quickMatch, salesStats, sectionsFor, stageTrack, stepOf,
  type Deal, type QuickView, type SalesFilter, type SalesState, type StageState,
} from '../lib/sales';
import { beYearInput, facetOptions, yearOptions } from '../lib/salesUi';
import { useMedia } from '../components/Sidebar';
import { Notice, Opts, PageHead, btnOutline, btnPrimary, card, inputStyle, selectStyle, tabular } from '../components/ui';
import { StepEditor } from '../components/DealPanel';
import { CoAvatar } from '../components/CoAvatar';
import { SalesDash } from './SalesDash';
import { commitFocus, isTopDialog, useDialog } from '../components/useDialog';

type Engine = ReturnType<typeof useApp>['engine'];
const TH_M = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const short = (iso: string) => (iso ? `${+iso.slice(8, 10)} ${TH_M[+iso.slice(5, 7)]}` : '');
const RES: Record<string, [string, string, string]> = {
  YES: ['ปิดการขายได้', '#DDF5E8', '#14633F'],
  NO: ['ไม่สำเร็จ', '#FBE3DC', '#8A2B12'],
  WAIT: ['รอผล', '#FFF4DC', '#6B4100'],
  '': ['', '#F6F8FE', '#475069'],
};
const small: CSSProperties = { cursor: 'pointer', height: 32, padding: '0 12px', borderRadius: 999, border: '1.5px solid #D5DBEA', background: '#fff', color: '#0E1430', fontSize: 12.5 };

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
  const tabs: [typeof v, string, number][] = [['table', 'ตารางติดตาม', openN], ['dash', 'Dashboard', 0], ['closed', 'ปิดงาน', closedN], ['log', 'ประวัติการแก้ไข', 0]];

  return (
    <>
      <PageHead
        title="Sales Tracker"
        sub="ตารางติดตามสถานะการขาย · ทั้งทีมเห็นข้อมูลเดียวกัน"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#475069' }}>
              ปี
              <select value={year} onChange={(ev) => set({ slYear: ev.target.value })} style={{ ...selectStyle, height: 36 }} aria-label="ปี (พ.ศ.)">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <AddMenu />
            <MoreMenu year={year} deals={shown} />
          </div>
        }
      />
      {!e.teamCfg && (
        <Notice kind="ok">
          ตอนนี้ข้อมูลอยู่ในเครื่องนี้เท่านั้น — เชื่อมต่อทีมที่แท็บ <b>อัปเดตข้อมูล → แชร์ข้อมูลทีม</b> เพื่อให้ทุกคนเห็นตารางเดียวกันและเก็บเอกสารใน Drive ของทีม
        </Notice>
      )}
      {e.docMsg && <Notice kind="error">{e.docMsg}</Notice>}
      {ui.slNote && (
        <Notice kind="ok" role="status">
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
            {ui.slNote}
            <button onClick={() => set({ slNote: '' })} aria-label="ปิดข้อความ" style={{ cursor: 'pointer', border: 0, background: 'transparent', color: 'inherit', fontSize: 16 }}>×</button>
          </span>
        </Notice>
      )}
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E3E7F1', overflowX: 'auto' }}>
        {tabs.map(([k, label, n]) => {
          const on = v === k;
          return (
            <button key={k} role="tab" aria-selected={on} onClick={() => set({ slView: k })} style={{ cursor: 'pointer', flex: 'none', border: 0, background: 'transparent', padding: '10px 14px', fontSize: 14.5, fontWeight: on ? 600 : 400, color: on ? '#1F5BD8' : '#475069', borderBottom: `2.5px solid ${on ? '#1F5BD8' : 'transparent'}`, display: 'flex', gap: 6, alignItems: 'center' }}>
              {label}
              {n > 0 && <span style={{ fontSize: 11, minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999, background: '#E6ECFD', color: '#1745B8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fmtN(n)}</span>}
            </button>
          );
        })}
      </div>
      {v === 'table' && <TableView e={e} S={S} deals={shown.filter((d) => d.jobStatus === 'open')} base={noQuick.filter((d) => d.jobStatus === 'open')} all={shown} facets={yearDeals} today={today} />}
      {v === 'dash' && <SalesDash S={S} deals={yearDeals} today={today} year={ui.slYear} />}
      {v === 'closed' && <ClosedView S={S} deals={noQuick.filter((d) => d.jobStatus === 'closed')} facets={yearDeals} total={closedN} />}
      {v === 'log' && <LogView S={S} year={year} />}
    </>
  );
}

// ------------------------------------------------------------------ toolbar menus

/** Drop-down menu: closes when focus leaves it, or on Escape (only the menu — focus goes back to its
 *  button). Choosing an item also puts focus back on the button, so a dialog it opens returns there. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => {
    btn.current?.focus();
    setOpen(false);
  };
  const wrap = {
    ref,
    onBlur: (ev: React.FocusEvent) => {
      if (open && !ref.current?.contains(ev.relatedTarget as Node)) setOpen(false);
    },
    onKeyDown: (ev: ReactKeyboardEvent) => {
      if (ev.key !== 'Escape' || !open) return;
      ev.stopPropagation();
      close();
    },
  };
  return { open, setOpen, close, btn, wrap };
}
const menuBox: CSSProperties = { position: 'absolute', right: 0, top: 42, zIndex: 20, background: '#fff', border: '1px solid #E3E7F1', borderRadius: 14, boxShadow: '0 20px 50px -16px rgba(4,10,60,.35)', padding: 6, display: 'flex', flexDirection: 'column' };

function AddMenu() {
  const { engine: e, ui, set, go } = useApp();
  const { open, setOpen, close, btn, wrap } = useMenu();
  const starred = e.crm.watch.map((id) => e.company(id)).filter((c) => c && !e.dealsOf(c.id).some((d) => d.year === ui.slYear));
  const item: CSSProperties = { cursor: 'pointer', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 14px', fontSize: 13.5, color: '#0E1430', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 2 };
  const off: CSSProperties = { ...item, cursor: 'default', color: '#8A93AD' };
  const sub: CSSProperties = { fontSize: 12, color: '#5E6680' };
  return (
    <div {...wrap} style={{ position: 'relative' }}>
      <button ref={btn} onClick={() => setOpen(!open)} aria-expanded={open} style={{ ...btnPrimary, height: 36 }}>+ เพิ่มลูกค้า ▾</button>
      {open && (
        <div style={{ ...menuBox, width: 'min(320px,86vw)' }}>
          <button className="h-bg" style={item} onClick={() => { close(); go('search'); }}>
            เลือกจากทะเบียนบริษัท<span style={sub}>ค้นหาในแท็บค้นหา แล้วกด "ส่งเข้า Sales Tracker" ในหน้าบริษัท</span>
          </button>
          <button className={starred.length ? 'h-bg' : undefined} style={starred.length ? item : off} disabled={!starred.length} onClick={() => { close(); set({ sendIds: starred.map((c) => c!.id) }); }}>
            ส่งบริษัทที่ติดดาว ({fmtN(starred.length)}){' '}
            <span style={sub}>{starred.length ? 'ที่ยังไม่อยู่ในตารางปีนี้ — เลือกได้ก่อนส่ง' : 'ติดดาว ☆ บริษัทในหน้าค้นหาก่อน'}</span>
          </button>
          <button className="h-bg" style={item} onClick={() => { close(); set({ addCust: { deal: true } }); }}>
            เพิ่มลูกค้าใหม่ (ไม่มีในทะเบียน)<span style={sub}>กรอกชื่อบริษัทและข้อมูลติดต่อเอง ทุกคนในทีมจะเห็นด้วย</span>
          </button>
          <button className="h-bg" style={item} onClick={() => { close(); const d = e.addDeal({ client: 'ลูกค้าใหม่', year: ui.slYear }); set({ deal: d.id }); }}>
            เพิ่มแถวว่าง<span style={sub}>พิมพ์ชื่อลูกค้าเอง ไม่ผูกกับทะเบียนบริษัท</span>
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
  const item: CSSProperties = { cursor: 'pointer', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 14px', fontSize: 13.5, color: '#0E1430', borderRadius: 10 };
  /** The Buddhist-era year a JSON backup belongs to (it doesn't say): 25xx, or a 20xx year converted after a confirm. */
  const askYear = (f: File): string | null => {
    const m = /(25\d\d)/.exec(f.name);
    let def = m ? m[1] : year;
    for (;;) {
      const ans = window.prompt('ไฟล์สำรองของ Sales Tracker เดิมไม่ได้บอกปี — ข้อมูลนี้เป็นของปี พ.ศ. ใด? (เช่น 2569)', def);
      if (ans == null || !ans.trim()) return null;
      const y = beYearInput(ans);
      if (y && !y.ce) return y.year;
      if (y && window.confirm(`${y.ce} เป็นปี ค.ศ. — นำเข้าเป็นปี พ.ศ. ${y.year} ใช่ไหม?`)) return y.year;
      if (!y) window.alert(`"${ans.trim()}" ไม่ใช่ปี พ.ศ. — ใส่ปี พ.ศ. 4 หลัก เช่น ${year}`);
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
          r.ambiguous ? `${fmtN(r.ambiguous)} รายมีบริษัทชื่อเดียวกันหลายแห่ง ยังไม่ได้เชื่อม — เปิดรายการแล้วเลือกบริษัทเอง` : '',
          r.inexact ? `${fmtN(r.inexact)} รายการมีจำนวนเงินที่ไม่ใช่ตัวเลขล้วน (เช่น ช่วงราคา) ใช้ค่าต่ำสุด และเก็บข้อความเดิมไว้ในประวัติ — ตรวจอีกครั้ง` : '',
        ].filter(Boolean).join(' · '),
      });
    } catch (err) {
      setImp({ msg: 'นำเข้าไม่สำเร็จ: ' + ((err as Error)?.message || err), err: true });
    }
  };
  return (
    <div {...wrap} style={{ position: 'relative' }}>
      <button ref={btn} onClick={() => setOpen(!open)} aria-expanded={open} style={{ ...btnOutline, height: 36 }}>เพิ่มเติม ▾</button>
      {open && (
        <div style={{ ...menuBox, width: 'min(300px,86vw)' }}>
          <button className="h-bg" style={item} onClick={() => { close(); e.exportSalesCsv(year, deals); }}>
            {/* the table's filters apply (also when another tab is open): say so */}
            ⬇ {deals.length < yearTotal ? `ส่งออก ${fmtN(deals.length)} จาก ${fmtN(yearTotal)} รายการ ตามตัวกรองตาราง` : 'ส่งออกตาราง'} (CSV เปิดใน Excel)
          </button>
          <button className="h-bg" style={item} onClick={() => { close(); fileRef.current?.click(); }}>⬆ นำเข้าจาก Sales Tracker เดิม</button>
          <button className="h-bg" style={item} onClick={() => { close(); setLists(true); }}>⚙ จัดการหมวด / SOURCE / Services</button>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".json,.csv,.xlsx" style={{ display: 'none' }} onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) doImport(f); }} />
      {imp && (
        <Modal title="นำเข้าจาก Sales Tracker เดิม" onClose={() => setImp(null)}>
          <Notice kind={imp.err ? 'error' : 'ok'} role="status">{imp.msg}</Notice>
          {imp.years && imp.years.some((y) => y !== year) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {imp.years.filter((y) => y !== year).map((y) => (
                <button key={y} onClick={() => { set({ slYear: y, slView: 'table' }); setImp(null); }} style={{ ...btnOutline, height: 36 }}>ดูตารางปี {y}</button>
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
              style={{ ...btnOutline, height: 36, alignSelf: 'flex-start', color: '#8A2B12', borderColor: '#E7B9AC' }}
            >
              ยกเลิกการนำเข้านี้
            </button>
          )}
          <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.6 }}>
            ใช้ไฟล์ได้ 2 แบบ: ไฟล์ "สำรองข้อมูล (JSON)" จากเมนูเพิ่มเติมของ Sales Tracker เดิม หรือ Google Sheet ของ Sales Tracker เดิมที่ดาวน์โหลดเป็น CSV / Excel (ไฟล์ → ดาวน์โหลด)
          </span>
        </Modal>
      )}
      {lists && <ListsModal onClose={() => setLists(false)} />}
    </div>
  );
}

/** Centered dialog. Focus goes to its first field (`focus="dialog"`: to the dialog itself), stays in it, and returns on close. */
export function Modal({ title, children, onClose, width = 520, focus }: { title: string; children: ReactNode; onClose: () => void; width?: number; focus?: 'field' | 'dialog' }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { focus });
  // Escape closes this dialog only (not the panel underneath)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !isTopDialog(ref.current)) return;
      ev.stopPropagation();
      commitFocus();
      closeRef.current();
    };
    document.addEventListener('keydown', kd, true);
    return () => document.removeEventListener('keydown', kd, true);
  }, []);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,60,.45)', zIndex: 54 }} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: `min(${width}px,94vw)`, maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 22, padding: 22, zIndex: 55, display: 'flex', flexDirection: 'column', gap: 14, outline: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 500 }}>{title}</span>
          <button onClick={onClose} aria-label="ปิด" style={{ cursor: 'pointer', width: 34, height: 34, borderRadius: '50%', border: 0, background: '#F6F8FE', fontSize: 18, color: '#475069' }}>×</button>
        </div>
        {children}
      </div>
    </>
  );
}

function ListsModal({ onClose }: { onClose: () => void }) {
  const { engine: e } = useApp();
  useEngineVersion();
  const C = e.sales.cfg;
  const box = (name: 'sections' | 'sources' | 'services', title: string, hint: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
      <span style={{ fontSize: 12.5, color: '#5E6680' }}>{hint}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {C[name].map((x) => (
          <span key={x} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, padding: '3px 4px 3px 10px', borderRadius: 999, background: '#F6F8FE', border: '1px solid #E3E7F1' }}>
            {x}
            {name === 'sections' && (
              <button title="เปลี่ยนชื่อ" onClick={() => { const n = window.prompt('ชื่อหมวดใหม่', x); if (n) e.renameSection(x, n); }} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#475069', fontSize: 12 }}>✎</button>
            )}
            <button title="ลบ" aria-label={'ลบ ' + x} onClick={() => window.confirm(`ลบ "${x}" ออกจากรายการ? (รายการที่ใช้อยู่ยังคงเดิม)`) && e.setSalesList(name, C[name].filter((y) => y !== x))} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#8A2B12', fontSize: 14 }}>×</button>
          </span>
        ))}
      </div>
      <form onSubmit={(ev) => { ev.preventDefault(); const inp = ev.currentTarget.elements.namedItem('v') as HTMLInputElement; if (inp.value.trim()) e.setSalesList(name, [...C[name], inp.value]); inp.value = ''; }} style={{ display: 'flex', gap: 8 }}>
        <input name="v" placeholder="เพิ่มใหม่…" style={{ ...inputStyle, height: 36, flex: 1 }} />
        <button type="submit" style={{ ...btnOutline, height: 36 }}>เพิ่ม</button>
      </form>
    </div>
  );
  return (
    // its fields only add to the lists: focus the dialog (a phone would pop its keyboard up for a field)
    <Modal title="จัดการรายการ" onClose={onClose} width={640} focus="dialog">
      {box('sections', 'หมวด (กลุ่มแถวในตาราง)', 'แต่ละลูกค้าอยู่ในหมวดเดียว เช่น ช่องทางที่ได้ลูกค้ามา')}
      {box('sources', 'SOURCE (ช่องทาง)', 'ติ๊กได้หลายช่องต่อหนึ่งลูกค้า ใช้ในกราฟและ Win rate ตามช่องทาง')}
      {box('services', 'Services (บริการ)', 'บริการที่เสนอให้ลูกค้า')}
    </Modal>
  );
}

// ------------------------------------------------------------------ table

/** Table / closed-tab filters. `facets`: all of the year's deals (the ผู้รับผิดชอบ / แหล่งที่มา choices). */
function Filters({ S, facets }: { S: SalesState; facets: Deal[] }) {
  const { ui, set } = useApp();
  const F = ui.slF;
  const up = (p: Partial<typeof F>) => set({ slF: { ...F, ...p } });
  const uniq = (k: 'resp' | 'referral') => facetOptions(facets, k, F[k]);
  const sel = { ...selectStyle, height: 36, fontSize: 13 };
  const any = filtersOn(F);
  const nSet = Object.entries(F).filter(([k, v]) => k !== 'q' && k !== 'quick' && v).length;
  // phones: the selects fold behind one button (they would take half the screen)
  const [more, setMore] = useState(false);
  return (
    <div className={'sl-filters' + (more ? ' open' : '')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input value={F.q || ''} onChange={(ev) => up({ q: ev.target.value })} placeholder="ค้นหาบริษัท / ผู้ติดต่อ / โน้ต" aria-label="ค้นหา" style={{ ...inputStyle, height: 36, flex: '1 1 220px', minWidth: 0 }} />
      <button className="sl-ftoggle" onClick={() => setMore(!more)} aria-expanded={more} style={{ ...small, height: 36 }}>ตัวกรอง{nSet ? ` (${nSet})` : ''} {more ? '▴' : '▾'}</button>
      <select value={F.source || ''} onChange={(ev) => up({ source: ev.target.value })} style={sel} aria-label="SOURCE"><Opts all="SOURCE: ทั้งหมด" options={S.cfg.sources.map((x) => ({ v: x, label: x }))} /></select>
      <select value={F.service || ''} onChange={(ev) => up({ service: ev.target.value })} style={sel} aria-label="Services"><Opts all="Services: ทั้งหมด" options={S.cfg.services.map((x) => ({ v: x, label: x }))} /></select>
      <select value={F.resp || ''} onChange={(ev) => up({ resp: ev.target.value })} style={sel} aria-label="ผู้รับผิดชอบ"><Opts all="ผู้รับผิดชอบ: ทั้งหมด" options={uniq('resp').map((x) => ({ v: x, label: x }))} /></select>
      <select value={F.referral || ''} onChange={(ev) => up({ referral: ev.target.value })} style={sel} aria-label="แหล่งที่มา"><Opts all="แหล่งที่มา: ทั้งหมด" options={uniq('referral').map((x) => ({ v: x, label: x }))} /></select>
      <select value={F.result || ''} onChange={(ev) => up({ result: ev.target.value as typeof F.result })} style={sel} aria-label="ผลการขาย">
        <Opts all="ผลการขาย: ทั้งหมด" options={[{ v: 'YES', label: 'ปิดการขายได้ (YES)' }, { v: 'NO', label: 'ไม่สำเร็จ (NO)' }, { v: 'WAIT', label: 'มีหมายเหตุ / รอผล' }, { v: 'EMPTY', label: 'ยังไม่มีผล' }]} />
      </select>
      <select value={F.month || ''} onChange={(ev) => up({ month: ev.target.value })} style={sel} aria-label="เดือนที่ติดต่อ"><Opts all="ติดต่อ: ทุกเดือน" options={TH_M.slice(1).map((m, i) => ({ v: String(i + 1).padStart(2, '0'), label: 'ติดต่อ ' + m }))} /></select>
      <select value={F.day || ''} onChange={(ev) => up({ day: ev.target.value })} style={sel} aria-label="วันที่ติดต่อ"><Opts all="ทุกวัน" options={Array.from({ length: 31 }, (_, i) => ({ v: String(i + 1).padStart(2, '0'), label: 'วันที่ ' + (i + 1) }))} /></select>
      {any && <button onClick={() => set({ slF: {} })} style={{ ...small, height: 36 }}>ล้างตัวกรอง</button>}
    </div>
  );
}
const filtersOn = (F: Omit<SalesFilter, 'year'>) => Object.values(F).some(Boolean);

/** In place of the rows when the filters leave none. */
function NoMatch({ text }: { text: string }) {
  const { set } = useApp();
  return (
    <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 14, color: '#475069' }}>
      <span role="status">{text}</span>
      <button onClick={() => set({ slF: {} })} style={{ ...small, height: 36 }}>ล้างตัวกรอง</button>
    </span>
  );
}

/** Table tiles: the open jobs to follow up, and the money of all the year's jobs (open and closed —
 *  closing a paid job must not take its revenue out of the totals). Both follow the filters. */
function Summary({ S, open, all, today }: { S: SalesState; open: Deal[]; all: Deal[]; today: string }) {
  const { ui, set } = useApp();
  const st = salesStats(S, open, today);
  const sum = salesStats(S, all, today);
  const note = filtersOn(ui.slF) ? ' · ตามตัวกรอง' : '';
  const tiles: [string, string, string?, (() => void)?][] = [
    [fmtN(st.total), 'ลูกค้าที่ยังเปิดงาน' + note],
    [fmtN(st.overdue), `ค้างติดตาม (เกิน 14 วัน)`, st.overdue ? '#8A2B12' : undefined, st.overdue ? () => set({ slF: { ...ui.slF, quick: 'overdue' } }) : undefined],
    [fmtMoney(sum.forecast) || '0', `Forecast รวม (บาท) · รวมงานที่ปิดแล้ว${note}`],
    [fmtMoney(sum.actual) || '0', `Actual รวม (บาท) · รวมงานที่ปิดแล้ว${note}`],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
      {tiles.map(([v, l, c, on]) => {
        const body = (
          <>
            <span style={{ fontSize: 22, fontWeight: 500, color: c || '#0E1430', ...tabular }}>{v}</span>
            <span style={{ fontSize: 12.5, color: '#475069' }}>{l}{on ? ' · ดูรายชื่อ ›' : ''}</span>
          </>
        );
        const st: CSSProperties = { ...card, borderRadius: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' };
        return on ? <button key={l} onClick={on} className="sl-tile" style={{ ...st, cursor: 'pointer', font: 'inherit' }}>{body}</button> : <div key={l} style={st}>{body}</div>;
      })}
    </div>
  );
}

/** Quick views over the open jobs: what needs doing (combined with the filters). */
const QUICK: [QuickView, string][] = [['', 'ทั้งหมด'], ['overdue', '⏰ ค้างติดตาม'], ['notstarted', 'ยังไม่เริ่ม'], ['active', 'กำลังติดตาม'], ['payment', 'รอชำระเงิน']];
function QuickTabs({ S, base, today }: { S: SalesState; base: Deal[]; today: string }) {
  const { ui, set } = useApp();
  const cur = ui.slF.quick || '';
  return (
    <div role="group" aria-label="แสดงงาน" className="sl-quick">
      {QUICK.map(([k, label]) => {
        const n = k ? base.filter((d) => quickMatch(S, d, k, today)).length : base.length;
        if (k === 'payment' && !n && cur !== k) return null; // only when the table has stages after CLOSED DEAL in use
        return (
          <button key={k || 'all'} aria-pressed={cur === k} onClick={() => set({ slF: { ...ui.slF, quick: k } })} className={k === 'overdue' && n ? 'warn' : ''}>
            {label} <span>{fmtN(n)}</span>
          </button>
        );
      })}
    </div>
  );
}

function TableView({ e, S, deals, base, all, facets, today }: { e: Engine; S: SalesState; deals: Deal[]; base: Deal[]; all: Deal[]; facets: Deal[]; today: string }) {
  const { ui, set } = useApp();
  const mobile = useMedia('(max-width: 760px)');
  const [step, setStep] = useState<{ id: string; stage: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const secs = sectionsFor(S, deals);
  const bySec = new Map<string, Deal[]>(secs.map((s) => [s, []]));
  deals.forEach((d) => bySec.get(d.section)!.push(d));
  const team = e.crm.team;
  // one company twice in the year (two people sent it at the same moment): marked, to delete one
  const perCo = new Map<number, number>();
  facets.forEach((d) => d.gid != null && perCo.set(e.canonical(d.gid), (perCo.get(e.canonical(d.gid)) || 0) + 1));
  const dup = (d: Deal) => d.gid != null && (perCo.get(e.canonical(d.gid)) || 0) > 1;
  // sections with rows are shown as groups; empty ones only as quick "add here" buttons
  const visible = secs.filter((s) => bySec.get(s)!.length);
  const empty = S.cfg.sections.filter((s) => !bySec.get(s)?.length);
  const addIn = (sec: string) => {
    const d = e.addDeal({ client: 'ลูกค้าใหม่', section: sec, year: ui.slYear });
    set({ deal: d.id });
  };
  // a stage opened from the table marks its row too (the row you are working on)
  const openStep = (id: string, stage: string) => {
    setStep({ id, stage });
    set((s) => ({ last: { ...s.last, deal: id } }));
  };
  const cur = ui.deal || ui.last.deal;
  // back on the table (or after closing a deal): the marked row is brought into view
  useEffect(() => {
    if (cur) wrapRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur, ui.deal]);
  if (!Object.values(S.deals).some((d) => d.year === ui.slYear))
    return (
      <>
        <Filters S={S} facets={facets} />
        <div style={{ ...card, padding: 28, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 17, fontWeight: 500 }}>ยังไม่มีลูกค้าในตารางปี {ui.slYear}</span>
          <span style={{ fontSize: 13.5, color: '#475069', lineHeight: 1.7 }}>
            กด <b>+ เพิ่มลูกค้า</b> เพื่อส่งบริษัทที่ติดดาวเข้ามา เพิ่มลูกค้าใหม่ หรือเพิ่มแถวว่าง · ถ้ามีข้อมูลใน Sales Tracker เดิม ใช้ <b>เพิ่มเติม → นำเข้าจาก Sales Tracker เดิม</b>
          </span>
        </div>
      </>
    );
  return (
    <>
      <Summary S={S} open={deals} all={all} today={today} />
      <Filters S={S} facets={facets} />
      <QuickTabs S={S} base={base} today={today} />
      {step && <StepEditor dealId={step.id} stage={step.stage} onClose={() => setStep(null)} />}
      {!deals.length ? (
        <div style={{ ...card, borderRadius: 18, padding: '20px 22px', fontSize: 14, color: '#475069' }}>
          {filtersOn(ui.slF) ? <NoMatch text="ไม่พบงานที่ยังเปิดตามตัวกรองนี้" /> : `ไม่มีงานที่ยังเปิดในปี ${ui.slYear} — งานที่ปิดแล้วอยู่ในแท็บ "ปิดงาน"`}
        </div>
      ) : mobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} ref={wrapRef}>
          {visible.map((sec) => {
            const list = bySec.get(sec)!;
            if (!list.length) return null;
            return (
              <div key={sec} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1F5BD8', padding: '6px 2px 0' }}>{sec || 'ไม่ระบุหมวด'} · {fmtN(list.length)}</span>
                {list.map((d) => <DealCard key={d.id} e={e} S={S} d={d} today={today} cur={cur === d.id} onOpen={() => set({ deal: d.id })} onStep={(stage) => openStep(d.id, stage)} />)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sl-wrap" ref={wrapRef} onScroll={(ev) => ev.currentTarget.classList.toggle('scrolled', ev.currentTarget.scrollLeft > 4)}>
          <table className="sl-table">
            <thead>
              <tr>
                <th className="sl-sticky" style={{ minWidth: 330 }}>ลูกค้า</th>
                <th style={{ minWidth: 150 }}>ผู้รับผิดชอบ</th>
                <th style={{ minWidth: 150 }} title="วันที่ติดต่อที่พิมพ์ไว้ · ถ้าขั้นตอนมีวันที่ใหม่กว่า จะแสดง “ล่าสุด” ใต้ช่อง · ไม่ได้ติดต่อเกิน 14 วันขึ้นค้างติดตาม">วันที่ติดต่อ</th>
                {S.cfg.stages.map((p) => (
                  <th key={p} style={{ minWidth: 112 }} title={STAGE_TH[p] || p}>
                    {p}
                    <span className="sl-th-sub">{STAGE_TH[p] || ''}</span>
                  </th>
                ))}
                <th style={{ minWidth: 118, textAlign: 'right' }}>Forecast</th>
                <th style={{ minWidth: 118, textAlign: 'right' }}>Actual</th>
                <th style={{ minWidth: 84 }}>เอกสาร</th>
                <th style={{ minWidth: 150 }}>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((sec) => {
                const list = bySec.get(sec)!;
                const col = !!ui.slCollapsed[sec];
                return (
                  <SectionRows key={sec || '-'} sec={sec} list={list} collapsed={col} cols={S.cfg.stages.length + 7}
                    onToggle={() => { const c = { ...ui.slCollapsed }; if (col) delete c[sec]; else c[sec] = 1; set({ slCollapsed: c }); }}
                    onAdd={() => addIn(sec)}>
                    {list.map((d, i) => <DealRow key={d.id} e={e} S={S} d={d} n={i + 1} today={today} team={team} dup={dup(d)} cur={cur === d.id} onStep={(stage) => openStep(d.id, stage)} />)}
                  </SectionRows>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {empty.length > 0 && !Object.values(ui.slF).some(Boolean) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: '#475069' }}>
          หมวดที่ยังไม่มีลูกค้า (กดเพื่อเพิ่ม):
          {empty.map((s) => (
            <button key={s} onClick={() => addIn(s)} style={{ ...small, height: 28 }}>+ {s}</button>
          ))}
        </div>
      )}
      <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.6 }}>
        คลิกชื่อลูกค้าเพื่อแก้รายละเอียด SOURCE / Services แนบใบเสนอราคา · คลิกขั้นตอนบนเส้นเพื่อใส่วันที่และโน้ต · ปุ่ม “ถัดไป” ใต้ชื่อพาไปขั้นที่ต้องทำต่อ · แถวสีน้ำเงินคือลูกค้าที่เปิดล่าสุด · ไม่ได้ติดต่อเกิน 14 วันขึ้นป้าย ⏰ · งานที่ปิดแล้วย้ายไปแท็บ "ปิดงาน"
      </span>
    </>
  );
}

function SectionRows({ sec, list, collapsed, cols, onToggle, onAdd, children }: { sec: string; list: Deal[]; collapsed: boolean; cols: number; onToggle: () => void; onAdd: () => void; children: ReactNode }) {
  return (
    <>
      <tr className="sl-sec">
        <td className="sl-sticky" colSpan={1}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onToggle} aria-expanded={!collapsed} className="sl-sec-btn">
              <span aria-hidden="true" className={'sl-caret' + (collapsed ? '' : ' open')}>›</span>
              {sec || 'ไม่ระบุหมวด'}
              <span className="sl-count">{fmtN(list.length)}</span>
            </button>
            <button onClick={onAdd} className="sl-sec-add">+ เพิ่มในหมวดนี้</button>
          </div>
        </td>
        <td colSpan={cols - 1} />
      </tr>
      {!collapsed && children}
    </>
  );
}

function Chips({ d }: { d: Deal }) {
  if (!d.source.length && !d.service.length) return null;
  const all = [...d.source.map((x) => ['s', x]), ...d.service.map((x) => ['v', x])];
  const shown = all.slice(0, 3);
  return (
    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} title={all.length > 3 ? all.map((x) => x[1]).join(', ') : undefined}>
      {shown.map(([k, x]) => <span key={k + x} className={'sl-tag ' + (k === 's' ? 'src' : 'svc')}>{x}</span>)}
      {all.length > 3 && <span className="sl-tag more">+{all.length - 3}</span>}
    </span>
  );
}

/** Status as a coloured dot and words (the result's colour; blue while in progress). */
function StatusDot({ S, d }: { S: SalesState; d: Deal }) {
  const st = dealStatus(S, d);
  const color = st.result ? RES[st.result][2] : st.started ? '#1F5BD8' : '#8A93AD';
  const text = st.overall.length > 28 ? st.overall.slice(0, 28) + '…' : st.overall;
  return (
    <span className="sl-status" title={st.overall}>
      <span className="sl-sdot" style={{ background: color }} />
      {text}
    </span>
  );
}

function MoneyCell({ e, d, which, value, confirmed }: { e: Engine; d: Deal; which: 'forecast' | 'actual'; value: number | null; confirmed: boolean }) {
  if (confirmed)
    return (
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, ...tabular }} title={which === 'forecast' ? 'ยืนยันจากใบเสนอราคาที่แนบ' : 'ยืนยันจากใบแจ้งหนี้ที่แนบ'}>
        <span style={{ fontWeight: 500 }}>{fmtMoney(value)}</span>
        <span className="sl-ok">✓ ยืนยันด้วยเอกสาร</span>
      </span>
    );
  return (
    <input
      key={d.id + which + (value ?? '')}
      defaultValue={value == null ? '' : fmtMoney(value)}
      inputMode="decimal"
      aria-label={which === 'forecast' ? 'Forecast (บาท)' : 'Actual (บาท)'}
      placeholder="—"
      title="พิมพ์ได้ เช่น 120,000 · 1.5 ล้าน · 200k"
      onBlur={(ev) => {
        const n = parseAmount(ev.target.value);
        if (n === undefined) {
          // not one clear amount ("50,000-80,000", words): keep the saved figure, say why
          window.alert(`อ่าน "${ev.target.value}" เป็นจำนวนเงินไม่ได้ — พิมพ์ตัวเลขเดียว เช่น 120,000 หรือ 1.5 ล้าน`);
          ev.target.value = value == null ? '' : fmtMoney(value);
          return;
        }
        if (n !== value) e.updateDeal(d.id, { [which]: n });
      }}
      style={{ width: '100%', height: 32, border: '1px solid transparent', borderRadius: 8, padding: '0 6px', fontSize: 13, textAlign: 'right', background: 'transparent', ...tabular }}
      className="sl-input"
    />
  );
}

const STATE_TH: Record<StageState, string> = { done: 'ทำแล้ว', planned: 'นัดไว้', yes: 'ปิดการขายได้', no: 'ไม่สำเร็จ', wait: 'รอผล', skipped: 'ข้าม', next: 'ขั้นถัดไป', future: 'ยังไม่ถึง', off: 'ไม่ต้องทำ' };
const daysAgo = (iso: string, today: string) => Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 864e5);
const agoTh = (iso: string, today: string) => {
  const n = daysAgo(iso, today);
  return !isFinite(n) || n < 0 ? '' : n === 0 ? 'วันนี้' : n === 1 ? 'เมื่อวาน' : `${fmtN(n)} วันก่อน`;
};

/** The step to do now, under the client's name: opens that stage (orange when the client is overdue). */
function NextStep({ d, tr, od, onStep }: { d: Deal; tr: ReturnType<typeof stageTrack>; od: number | null; onStep: (stage: string) => void }) {
  if (d.jobStatus === 'closed') return null;
  if (!tr.next) return tr.result === 'NO' ? null : <span className="sl-next done">✓ ครบทุกขั้น</span>;
  const planned = tr.states[tr.next] === 'planned' && tr.nextStep ? tr.nextStep.d : '';
  return (
    <button onClick={() => onStep(tr.next)} className={'sl-next' + (od != null ? ' warn' : '')} title={STAGE_TH[tr.next] || tr.next}>
      {od != null ? `⏰ ${fmtN(od)} วัน · ` : planned ? '📅 ' : '→ '}
      {tr.next}
      <span className="sl-next-sub">{planned ? ' นัด ' + short(planned) : STAGE_TH[tr.next] ? ' ' + STAGE_TH[tr.next] : ''}</span>
    </button>
  );
}

function DealRow({ e, S, d, n, today, team, dup, cur, onStep }: { e: Engine; S: SalesState; d: Deal; n: number; today: string; team: string[]; dup: boolean; cur: boolean; onStep: (stage: string) => void }) {
  const { set } = useApp();
  const od = overdueDays(S, d, today);
  const lc = lastContact(S, d, today);
  const m = dealMoney(S, d);
  const docs = docsOf(S, d.id);
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const resps = [...new Set([...team, d.resp].filter(Boolean))];
  const tr = stageTrack(S, d, today);
  const stages = S.cfg.stages;
  // the track is drawn solid up to the last stage that has something
  let reached = -1;
  stages.forEach((p, i) => ['done', 'planned', 'yes', 'no', 'wait'].includes(tr.states[p]) && (reached = i));
  return (
    <tr className="sl-row" aria-current={cur ? 'true' : undefined}>
      <td className="sl-sticky">
        <div className="sl-client">
          <span className="sl-num">{n}</span>
          <CoAvatar name={c?.name || d.client} web={c?.web} set={c?.set} size={34} ring={cur ? '#fff' : undefined} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <button onClick={() => set({ deal: d.id })} className="sl-name">{d.client}</button>
            <span className="sl-sub">
              {[d.contactName, d.phone].filter(Boolean).join(' · ') || <span className="sl-faint">ยังไม่มีผู้ติดต่อ</span>}
              {c && <span className={'sl-tag ' + (c.src & 16 ? 'own' : 'code')}>{c.code}</span>}
              {dup && <span title={`บริษัทนี้มีในตารางปี ${d.year} มากกว่า 1 แถว — เปิดแถวที่ซ้ำแล้วลบออก`} className="sl-tag dup">ซ้ำ</span>}
            </span>
            <Chips d={d} />
            <NextStep d={d} tr={tr} od={od} onStep={onStep} />
          </div>
        </div>
      </td>
      <td>
        <span className="sl-resp">
          <span className="sl-resp-ava" aria-hidden="true">{d.resp ? Array.from(d.resp.replace(/^(คุณ|k\.)\s*/i, ''))[0] : '+'}</span>
          <select value={d.resp} onChange={(ev) => e.updateDeal(d.id, { resp: ev.target.value })} aria-label="ผู้รับผิดชอบ" className="sl-input sl-pill">
            <option value="">{d.resp ? '— ไม่ระบุ' : 'มอบหมาย'}</option>
            {resps.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </span>
      </td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input type="date" value={d.contactDate} onChange={(ev) => e.updateDeal(d.id, { contactDate: ev.target.value })} aria-label="วันที่ติดต่อ" className={'sl-input sl-pill sl-date' + (od != null ? ' warn' : '')} />
          {d.contactDate && d.contactDate <= today && <span className="sl-mini">{agoTh(d.contactDate, today)}</span>}
          {lc && lc !== d.contactDate && <span className="sl-mini">ล่าสุด {isoTh(lc)}</span>}
        </div>
      </td>
      {stages.map((p, i) => {
        const st = stepOf(S, d.id, p);
        const state = tr.states[p];
        const label = `${p} ${STAGE_TH[p] || ''} — ${STATE_TH[state]}${st.d ? ' ' + isoTh(st.d) : ''}${st.n.trim() ? ' · ' + st.n.trim().slice(0, 80) : ''}`;
        return (
          <td key={p} className={'sl-stg s-' + state + (i <= reached ? ' on' : '') + (i < reached ? ' on2' : '') + (i === 0 ? ' first' : '') + (i === stages.length - 1 ? ' last' : '')}>
            <button onClick={() => onStep(p)} className="sl-step" aria-label={label} title={st.n || STAGE_TH[p] || p} aria-current={tr.next === p ? 'step' : undefined}>
              <span className="sl-node" aria-hidden="true">{state === 'done' || state === 'yes' ? '✓' : state === 'no' ? '✕' : state === 'wait' ? '…' : ''}</span>
              {state === 'yes' || state === 'no' || state === 'wait' ? (
                <span className={'sl-res ' + state}>{state === 'wait' ? st.n.trim().slice(0, 24) : state === 'yes' ? 'ปิดการขายได้' : 'ไม่สำเร็จ'}</span>
              ) : st.d || st.n.trim() ? (
                <>
                  {st.d && <span className="sl-sdate">{state === 'planned' ? 'นัด ' : ''}{short(st.d)}</span>}
                  {st.n.trim() && <span className="sl-clamp">{st.n}</span>}
                </>
              ) : state === 'next' ? (
                <span className="sl-add">+ บันทึก</span>
              ) : state === 'skipped' ? (
                <span className="sl-faint">ข้าม</span>
              ) : state === 'future' ? (
                <span className="sl-plus">+</span>
              ) : null}
            </button>
          </td>
        );
      })}
      <td style={{ textAlign: 'right' }}><MoneyCell e={e} d={d} which="forecast" value={m.forecast} confirmed={m.fcConfirmed} /></td>
      <td style={{ textAlign: 'right' }}><MoneyCell e={e} d={d} which="actual" value={m.actual} confirmed={m.acConfirmed} /></td>
      <td>
        <button onClick={() => set({ deal: d.id })} className="sl-doc" title={docs.map((x) => `${KIND_TH[x.kind]} ${x.docNo || x.name}`).join('\n') || 'แนบใบเสนอราคา / ใบแจ้งหนี้'}>
          📎 {docs.length ? fmtN(docs.length) : 'แนบ'}
        </button>
      </td>
      <td>
        <div className="sl-end">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', minWidth: 0 }}>
            <StatusDot S={S} d={d} />
            <button onClick={() => window.confirm(`ปิดงาน "${d.client}"? (ย้ายไปแท็บปิดงาน เปิดกลับได้)`) && e.updateDeal(d.id, { jobStatus: 'closed' })} className="sl-close">ปิดงาน</button>
          </div>
          <button onClick={() => set({ deal: d.id })} className="sl-chev" aria-label={'เปิดรายละเอียด ' + d.client}>›</button>
        </div>
      </td>
    </tr>
  );
}

/** Phones: one card per client, with a mini progress track and the next step. */
function DealCard({ e, S, d, today, cur, onOpen, onStep }: { e: Engine; S: SalesState; d: Deal; today: string; cur: boolean; onOpen: () => void; onStep: (stage: string) => void }) {
  const od = overdueDays(S, d, today);
  const m = dealMoney(S, d);
  const tr = stageTrack(S, d, today);
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const lc = lastContact(S, d, today);
  return (
    <div className="sl-card" aria-current={cur ? 'true' : undefined}>
      <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <CoAvatar name={c?.name || d.client} web={c?.web} set={c?.set} size={34} ring={cur ? '#fff' : undefined} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
          <button onClick={onOpen} className="sl-name">{d.client}</button>
          <span className="sl-sub">{[d.resp && 'ผู้รับผิดชอบ ' + d.resp, lc && 'ติดต่อล่าสุด ' + isoTh(lc)].filter(Boolean).join(' · ') || 'ยังไม่เริ่ม'}</span>
        </span>
        <StatusDot S={S} d={d} />
      </span>
      <span className="pe-mini" role="img" aria-label={`ทำแล้ว ${tr.done} จาก ${tr.total} ขั้น${tr.next ? ' · ถัดไป ' + tr.next : ''}`}>
        {S.cfg.stages.map((p) => <i key={p} className={'s-' + tr.states[p]} />)}
      </span>
      <Chips d={d} />
      <span style={{ display: 'flex', gap: 12, fontSize: 12.5, flexWrap: 'wrap', alignItems: 'center', ...tabular }} className="sl-sub">
        {m.forecast != null && <span>Forecast {fmtMoney(m.forecast)}{m.fcConfirmed ? ' ✓' : ''}</span>}
        {m.actual != null && <span>Actual {fmtMoney(m.actual)}{m.acConfirmed ? ' ✓' : ''}</span>}
      </span>
      <NextStep d={d} tr={tr} od={od} onStep={onStep} />
    </div>
  );
}

// ------------------------------------------------------------------ closed + log

/** Closed jobs of the year, with the same filters as the table (shown here too, so what is counted is what is listed). */
function ClosedView({ S, deals, facets, total }: { S: SalesState; deals: Deal[]; facets: Deal[]; total: number }) {
  const { engine: e, ui, set } = useApp();
  const on = filtersOn({ ...ui.slF, quick: '' }); // the quick views are about open work: not applied here
  const note = on ? ' · ตามตัวกรอง' : '';
  let fc = 0, ac = 0;
  deals.forEach((d) => {
    const m = dealMoney(S, d);
    fc += m.forecast || 0;
    ac += m.actual || 0;
  });
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[[fmtN(deals.length), on ? `งานที่ปิดแล้ว · ตามตัวกรอง (จากทั้งหมด ${fmtN(total)})` : 'งานที่ปิดแล้ว'], [fmtMoney(fc) || '0', 'Forecast รวม (บาท)' + note], [fmtMoney(ac) || '0', 'Actual รวม (บาท)' + note]].map(([v, l]) => (
          <div key={l} style={{ ...card, borderRadius: 16, padding: '12px 16px', minWidth: 170, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 22, fontWeight: 500, ...tabular }}>{v}</span>
            <span style={{ fontSize: 12.5, color: '#475069' }}>{l}</span>
          </div>
        ))}
      </div>
      <Filters S={S} facets={facets} />
      <div style={{ ...card, borderRadius: 18, overflowX: 'auto' }}>
        <table className="sl-table" style={{ minWidth: 760 }}>
          <thead>
            <tr><th>ลูกค้า</th><th>หมวด</th><th>ผู้รับผิดชอบ</th><th>ผล</th><th style={{ textAlign: 'right' }}>Forecast</th><th style={{ textAlign: 'right' }}>Actual</th><th>ปิดเมื่อ</th><th /></tr>
          </thead>
          <tbody>
            {!deals.length && <tr><td colSpan={8} style={{ color: '#8A93AD', padding: 18 }}>{on && total > 0 ? <NoMatch text="ไม่พบงานที่ปิดแล้วตามตัวกรองนี้" /> : 'ยังไม่มีงานที่ปิด'}</td></tr>}
            {deals.map((d) => {
              const m = dealMoney(S, d);
              return (
                <tr key={d.id} className="sl-row">
                  <td><button onClick={() => set({ deal: d.id })} className="h-blue" style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0, textAlign: 'left', fontSize: 14, color: '#0E1430' }}>{d.client}</button></td>
                  <td>{d.section}</td>
                  <td>{d.resp}</td>
                  <td>{RES[dealResult(S, d)][0] || '—'}</td>
                  <td style={{ textAlign: 'right', ...tabular }}>{fmtMoney(m.forecast)}{m.fcConfirmed ? ' ✓' : ''}</td>
                  <td style={{ textAlign: 'right', ...tabular }}>{fmtMoney(m.actual)}{m.acConfirmed ? ' ✓' : ''}</td>
                  <td>{isoTh(d.closedDate)}</td>
                  <td><button onClick={() => e.updateDeal(d.id, { jobStatus: 'open' })} style={small}>เปิดงานอีกครั้ง</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LogView({ S, year }: { S: SalesState; year: string }) {
  const { set } = useApp();
  const [q, setQ] = useState('');
  const ids = new Set(Object.values(S.deals).filter((d) => d.year === year).map((d) => d.id));
  const all = Object.values(S.log)
    .filter((l) => !l.deal || ids.has(l.deal) || !S.deals[l.deal])
    .filter((l) => !q || [l.client, l.action, l.detail, l.by].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="ค้นหาในประวัติ" aria-label="ค้นหาในประวัติ" style={{ ...inputStyle, height: 36, maxWidth: 360 }} />
      <div style={{ ...card, borderRadius: 18, overflowX: 'auto' }}>
        <table className="sl-table" style={{ minWidth: 720 }}>
          <thead><tr><th>เวลา</th><th>ผู้แก้ไข</th><th>การกระทำ</th><th>ลูกค้า</th><th>รายละเอียด</th></tr></thead>
          <tbody>
            {!all.length && <tr><td colSpan={5} style={{ color: '#8A93AD', padding: 18 }}>ยังไม่มีประวัติ</td></tr>}
            {all.slice(0, 500).map((l) => (
              <tr key={l.id} className="sl-row">
                <td style={{ whiteSpace: 'nowrap' }}>{dtTh(l.at)}</td>
                <td>{l.by || '—'}</td>
                <td>{l.action}</td>
                <td>{l.deal && S.deals[l.deal] ? <button onClick={() => set({ deal: l.deal })} className="h-blue" style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0, textAlign: 'left', fontSize: 13.5, color: '#0E1430' }}>{l.client}</button> : l.client}</td>
                <td style={{ color: '#475069' }}>{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span style={{ fontSize: 12.5, color: '#5E6680' }}>ประวัติแชร์ทั้งทีม ใส่ชื่อตัวเองที่ "ฉันคือ" (แท็บอัปเดตข้อมูล) เพื่อให้รู้ว่าใครแก้</span>
    </>
  );
}

