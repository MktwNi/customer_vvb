import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dtTh, fmtN, isoTh, todayISO } from '../lib/format';
import {
  DEAL_STAGE, KIND_TH, STAGE_TH, dealMoney, dealResult, dealStatus, docsOf, filterDeals, fmtMoney, money, overdueDays, salesStats, sectionsFor, stepOf,
  type Deal, type SalesFilter, type SalesState, type SalesStats,
} from '../lib/sales';
import { beYearInput, facetOptions, winRateBySource, yearOptions } from '../lib/salesUi';
import { useMedia } from '../components/Sidebar';
import { Notice, Opts, PageHead, btnOutline, btnPrimary, card, inputStyle, selectStyle, tabular } from '../components/ui';
import { StepEditor } from '../components/DealPanel';
import { commitFocus, isTopDialog, useDialog } from '../components/useDialog';

type Engine = ReturnType<typeof useApp>['engine'];
const TH_M = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const short = (iso: string) => (iso ? `${+iso.slice(8, 10)} ${TH_M[+iso.slice(5, 7)]}` : '');
const RES: Record<string, [string, string, string]> = {
  YES: ['ปิดการขายได้', '#DDF5E8', '#14633F'],
  NO: ['ไม่สำเร็จ', '#FBE3DC', '#8A2B12'],
  WAIT: ['รอผล', '#FFF4DC', '#6B4100'],
  '': ['', '#F4F6FC', '#475069'],
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
            <button key={k} role="tab" aria-selected={on} onClick={() => set({ slView: k })} style={{ cursor: 'pointer', flex: 'none', border: 0, background: 'transparent', padding: '10px 14px', fontSize: 14.5, fontWeight: on ? 600 : 400, color: on ? '#0A1A86' : '#475069', borderBottom: `2.5px solid ${on ? '#0A1A86' : 'transparent'}`, display: 'flex', gap: 6, alignItems: 'center' }}>
              {label}
              {n > 0 && <span style={{ fontSize: 11, minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999, background: '#E6ECFD', color: '#1A2FB0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fmtN(n)}</span>}
            </button>
          );
        })}
      </div>
      {v === 'table' && <TableView e={e} S={S} deals={shown.filter((d) => d.jobStatus === 'open')} all={shown} facets={yearDeals} today={today} />}
      {v === 'dash' && <Dashboard S={S} deals={yearDeals} today={today} />}
      {v === 'closed' && <ClosedView S={S} deals={shown.filter((d) => d.jobStatus === 'closed')} facets={yearDeals} total={closedN} />}
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
  const { open, setOpen, close, btn, wrap } = useMenu();
  const [lists, setLists] = useState(false);
  const [imp, setImp] = useState<{ msg: string; err?: boolean; years?: string[] } | null>(null);
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
          <button className="h-bg" style={item} onClick={() => { close(); e.exportSalesCsv(year, deals); }}>⬇ ส่งออกตาราง (CSV เปิดใน Excel)</button>
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
          <button onClick={onClose} aria-label="ปิด" style={{ cursor: 'pointer', width: 34, height: 34, borderRadius: '50%', border: 0, background: '#F4F6FC', fontSize: 18, color: '#475069' }}>×</button>
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
          <span key={x} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, padding: '3px 4px 3px 10px', borderRadius: 999, background: '#F4F6FC', border: '1px solid #E3E7F1' }}>
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
  const nSet = Object.entries(F).filter(([k, v]) => k !== 'q' && v).length;
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
  const { ui } = useApp();
  const st = salesStats(S, open, today);
  const sum = salesStats(S, all, today);
  const note = filtersOn(ui.slF) ? ' · ตามตัวกรอง' : '';
  const tiles: [string, string, string?][] = [
    [fmtN(st.total), 'ลูกค้าที่ยังเปิดงาน' + note],
    [fmtN(st.overdue), `ค้างติดตาม (เกิน 14 วัน)`, st.overdue ? '#8A2B12' : undefined],
    [fmtMoney(sum.forecast) || '0', `Forecast รวม (บาท) · รวมงานที่ปิดแล้ว${note}`],
    [fmtMoney(sum.actual) || '0', `Actual รวม (บาท) · รวมงานที่ปิดแล้ว${note}`],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
      {tiles.map(([v, l, c]) => (
        <div key={l} style={{ ...card, borderRadius: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 22, fontWeight: 500, color: c || '#0E1430', ...tabular }}>{v}</span>
          <span style={{ fontSize: 12.5, color: '#475069' }}>{l}</span>
        </div>
      ))}
    </div>
  );
}

function TableView({ e, S, deals, all, facets, today }: { e: Engine; S: SalesState; deals: Deal[]; all: Deal[]; facets: Deal[]; today: string }) {
  const { ui, set } = useApp();
  const mobile = useMedia('(max-width: 760px)');
  const [step, setStep] = useState<{ id: string; stage: string } | null>(null);
  const secs = sectionsFor(S, deals);
  const bySec = new Map<string, Deal[]>(secs.map((s) => [s, []]));
  deals.forEach((d) => bySec.get(d.section)!.push(d));
  const team = e.crm.team;
  // sections with rows are shown as groups; empty ones only as quick "add here" buttons
  const visible = secs.filter((s) => bySec.get(s)!.length);
  const empty = S.cfg.sections.filter((s) => !bySec.get(s)?.length);
  const addIn = (sec: string) => {
    const d = e.addDeal({ client: 'ลูกค้าใหม่', section: sec, year: ui.slYear });
    set({ deal: d.id });
  };
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
      {step && <StepEditor dealId={step.id} stage={step.stage} onClose={() => setStep(null)} />}
      {!deals.length ? (
        <div style={{ ...card, borderRadius: 18, padding: '20px 22px', fontSize: 14, color: '#475069' }}>
          {filtersOn(ui.slF) ? <NoMatch text="ไม่พบงานที่ยังเปิดตามตัวกรองนี้" /> : `ไม่มีงานที่ยังเปิดในปี ${ui.slYear} — งานที่ปิดแล้วอยู่ในแท็บ "ปิดงาน"`}
        </div>
      ) : mobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map((sec) => {
            const list = bySec.get(sec)!;
            if (!list.length) return null;
            return (
              <div key={sec} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#2A4BE0', padding: '6px 2px 0' }}>{sec || 'ไม่ระบุหมวด'} · {fmtN(list.length)}</span>
                {list.map((d) => <DealCard key={d.id} S={S} d={d} today={today} onOpen={() => set({ deal: d.id })} />)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sl-wrap" style={{ ...card, borderRadius: 18, overflow: 'auto', maxHeight: 'calc(100vh - 170px)' }}>
          <table className="sl-table">
            <thead>
              <tr>
                <th className="sl-sticky" style={{ minWidth: 300 }}>ลูกค้า</th>
                <th style={{ minWidth: 120 }}>ผู้รับผิดชอบ</th>
                <th style={{ minWidth: 132 }} title="อัปเดตเองเมื่อบันทึกขั้นตอนด้วยวันที่ใหม่กว่า · เกิน 14 วันขึ้นค้างติดตาม">ติดต่อล่าสุด</th>
                {S.cfg.stages.map((p) => (
                  <th key={p} style={{ minWidth: 118 }} title={STAGE_TH[p] || p}>
                    {p}
                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 300, color: '#5E6680' }}>{STAGE_TH[p] || ''}</span>
                  </th>
                ))}
                <th style={{ minWidth: 120, textAlign: 'right' }}>Forecast</th>
                <th style={{ minWidth: 120, textAlign: 'right' }}>Actual</th>
                <th style={{ minWidth: 90 }}>เอกสาร</th>
                <th style={{ minWidth: 120 }}>สถานะ</th>
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
                    {list.map((d, i) => <DealRow key={d.id} e={e} S={S} d={d} n={i + 1} today={today} team={team} onStep={(stage) => setStep({ id: d.id, stage })} />)}
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
        คลิกชื่อลูกค้าเพื่อแก้รายละเอียด SOURCE / Services แนบใบเสนอราคา · คลิกช่องขั้นตอนเพื่อใส่วันที่และโน้ต · ลูกค้าที่ไม่ได้ติดต่อเกิน 14 วันขึ้นป้าย ⏰ · งานที่ปิดแล้วย้ายไปแท็บ "ปิดงาน"
      </span>
    </>
  );
}

function SectionRows({ sec, list, collapsed, cols, onToggle, onAdd, children }: { sec: string; list: Deal[]; collapsed: boolean; cols: number; onToggle: () => void; onAdd: () => void; children: ReactNode }) {
  return (
    <>
      <tr className="sl-sec">
        <td className="sl-sticky" colSpan={1}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={onToggle} aria-expanded={!collapsed} style={{ cursor: 'pointer', border: 0, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: '#0A1A86', padding: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
              {sec || 'ไม่ระบุหมวด'}
              <span style={{ fontSize: 11, fontWeight: 500, minWidth: 20, height: 18, padding: '0 6px', borderRadius: 999, background: '#E6ECFD', color: '#1A2FB0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{fmtN(list.length)}</span>
            </button>
            <button onClick={onAdd} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#1A3FE0', fontSize: 12.5, padding: 0 }}>+ เพิ่มในหมวดนี้</button>
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
  return (
    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {d.source.map((x) => <span key={'s' + x} style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 999, background: '#E6ECFD', color: '#1A2FB0' }}>{x}</span>)}
      {d.service.map((x) => <span key={'v' + x} style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 999, background: '#DDF5F1', color: '#0B6E66' }}>{x}</span>)}
    </span>
  );
}

function StatusPill({ S, d }: { S: SalesState; d: Deal }) {
  const st = dealStatus(S, d);
  const [, bg, fg] = d.jobStatus === 'closed' ? ['', '#EEF1F8', '#475069'] : RES[st.result];
  return <span style={{ fontSize: 12, padding: '3px 9px', borderRadius: 999, background: bg, color: fg, whiteSpace: 'nowrap' }}>{st.result === 'YES' ? '✓ ' : st.result === 'NO' ? '✕ ' : ''}{st.overall}</span>;
}

function MoneyCell({ e, d, which, value, confirmed }: { e: Engine; d: Deal; which: 'forecast' | 'actual'; value: number | null; confirmed: boolean }) {
  if (confirmed)
    return (
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, ...tabular }} title={which === 'forecast' ? 'ยืนยันจากใบเสนอราคาที่แนบ' : 'ยืนยันจากใบแจ้งหนี้ที่แนบ'}>
        <span style={{ fontWeight: 500 }}>{fmtMoney(value)}</span>
        <span style={{ fontSize: 10.5, color: '#14633F' }}>✓ ยืนยันด้วยเอกสาร</span>
      </span>
    );
  return (
    <input
      key={d.id + which + (value ?? '')}
      defaultValue={value == null ? '' : fmtMoney(value)}
      inputMode="decimal"
      aria-label={which === 'forecast' ? 'Forecast (บาท)' : 'Actual (บาท)'}
      placeholder="—"
      onBlur={(ev) => {
        const n = money(ev.target.value);
        if (n !== value) e.updateDeal(d.id, { [which]: n });
      }}
      style={{ width: '100%', height: 32, border: '1px solid transparent', borderRadius: 8, padding: '0 6px', fontSize: 13, textAlign: 'right', background: 'transparent', ...tabular }}
      className="sl-input"
    />
  );
}

function DealRow({ e, S, d, n, today, team, onStep }: { e: Engine; S: SalesState; d: Deal; n: number; today: string; team: string[]; onStep: (stage: string) => void }) {
  const { set } = useApp();
  const od = overdueDays(d, today);
  const m = dealMoney(S, d);
  const docs = docsOf(S, d.id);
  const res = dealResult(S, d);
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const resps = [...new Set([...team, d.resp].filter(Boolean))];
  return (
    <tr className="sl-row">
      <td className="sl-sticky">
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 11.5, color: '#8A93AD', minWidth: 18, paddingTop: 2, ...tabular }}>{n}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <button onClick={() => set({ deal: d.id })} className="h-blue" style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0, textAlign: 'left', fontSize: 14, fontWeight: 500, color: '#0E1430', lineHeight: 1.35 }}>{d.client}</button>
            <span style={{ fontSize: 12, color: '#475069', lineHeight: 1.4 }}>
              {[d.contactName, d.phone].filter(Boolean).join(' · ') || <span style={{ color: '#8A93AD' }}>ยังไม่มีผู้ติดต่อ</span>}
              {c && <span style={{ marginLeft: 6, fontSize: 10.5, padding: '0 6px', borderRadius: 999, background: c.src & 16 ? '#FFF4DC' : '#EEF1F8', color: c.src & 16 ? '#6B4100' : '#384155' }}>{c.code}</span>}
            </span>
            <Chips d={d} />
          </div>
        </div>
      </td>
      <td>
        <select value={d.resp} onChange={(ev) => e.updateDeal(d.id, { resp: ev.target.value })} aria-label="ผู้รับผิดชอบ" className="sl-input" style={{ width: '100%', height: 32, border: '1px solid transparent', borderRadius: 8, fontSize: 13, background: 'transparent', color: '#0E1430' }}>
          <option value="">—</option>
          {resps.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <input type="date" value={d.contactDate} onChange={(ev) => e.updateDeal(d.id, { contactDate: ev.target.value })} aria-label="ติดต่อล่าสุด" className="sl-input" style={{ height: 32, border: '1px solid transparent', borderRadius: 8, fontSize: 12.5, background: 'transparent', color: '#0E1430', width: '100%' }} />
          {od != null && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: '#FBE3DC', color: '#8A2B12', alignSelf: 'flex-start' }}>⏰ ค้าง {fmtN(od)} วัน</span>}
        </div>
      </td>
      {S.cfg.stages.map((p) => {
        const st = stepOf(S, d.id, p);
        const filled = !!(st.d || st.n.trim());
        const isRes = p === DEAL_STAGE && res;
        const [, bg, fg] = isRes ? RES[res] : filled ? ['', '#F0F4FF', '#0E1430'] : ['', 'transparent', '#8A93AD'];
        return (
          <td key={p}>
            <button onClick={() => onStep(p)} className="sl-step" title={st.n || STAGE_TH[p] || p} style={{ background: bg, color: fg }}>
              {filled ? (
                <>
                  {st.d && <span style={{ fontSize: 11, fontWeight: 500, color: isRes ? fg : '#1A3FE0' }}>{short(st.d)}</span>}
                  {st.n.trim() && <span className="sl-clamp">{st.n}</span>}
                </>
              ) : (
                <span aria-label={'ใส่ ' + p}>+</span>
              )}
            </button>
          </td>
        );
      })}
      <td style={{ textAlign: 'right' }}><MoneyCell e={e} d={d} which="forecast" value={m.forecast} confirmed={m.fcConfirmed} /></td>
      <td style={{ textAlign: 'right' }}><MoneyCell e={e} d={d} which="actual" value={m.actual} confirmed={m.acConfirmed} /></td>
      <td>
        <button onClick={() => set({ deal: d.id })} style={{ ...small, height: 28, padding: '0 10px' }} title={docs.map((x) => `${KIND_TH[x.kind]} ${x.docNo || x.name}`).join('\n') || 'แนบใบเสนอราคา / ใบแจ้งหนี้'}>
          📎 {docs.length ? fmtN(docs.length) : 'แนบ'}
        </button>
      </td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <StatusPill S={S} d={d} />
          <button onClick={() => window.confirm(`ปิดงาน "${d.client}"? (ย้ายไปแท็บปิดงาน เปิดกลับได้)`) && e.updateDeal(d.id, { jobStatus: 'closed' })} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#475069', fontSize: 11.5, textDecoration: 'underline', padding: 0 }}>ปิดงาน</button>
        </div>
      </td>
    </tr>
  );
}

function DealCard({ S, d, today, onOpen }: { S: SalesState; d: Deal; today: string; onOpen: () => void }) {
  const od = overdueDays(d, today);
  const m = dealMoney(S, d);
  let last = '';
  S.cfg.stages.forEach((p) => {
    const st = stepOf(S, d.id, p);
    if (st.d || st.n.trim()) last = p;
  });
  return (
    <button onClick={onOpen} style={{ ...card, borderRadius: 16, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 14.5, fontWeight: 500, color: '#0E1430' }}>{d.client}</span>
        <StatusPill S={S} d={d} />
      </span>
      <span style={{ fontSize: 12.5, color: '#475069' }}>{[d.resp && 'ผู้รับผิดชอบ ' + d.resp, d.contactDate && 'ติดต่อ ' + isoTh(d.contactDate), last && 'ล่าสุด ' + last].filter(Boolean).join(' · ') || 'ยังไม่เริ่ม'}</span>
      <Chips d={d} />
      <span style={{ display: 'flex', gap: 12, fontSize: 12.5, color: '#384155', flexWrap: 'wrap', ...tabular }}>
        {m.forecast != null && <span>Forecast {fmtMoney(m.forecast)}{m.fcConfirmed ? ' ✓' : ''}</span>}
        {m.actual != null && <span>Actual {fmtMoney(m.actual)}{m.acConfirmed ? ' ✓' : ''}</span>}
        {od != null && <span style={{ color: '#8A2B12' }}>⏰ ค้าง {fmtN(od)} วัน</span>}
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ dashboard

/** Bar list; rows at 0 are left out unless `keepZero` (the items are then already the ones to show). */
function Bars({ title, sub, items, fmt = fmtN, unit = '', keepZero }: { title: string; sub: string; items: [string, number][]; fmt?: (n: number) => string; unit?: string; keepZero?: boolean }) {
  const list = keepZero ? items : items.filter((x) => x[1] > 0);
  const max = Math.max(1, ...list.map((x) => x[1]));
  return (
    <div style={{ ...card, borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 12, color: '#5E6680' }}>{sub}</span>
      </div>
      {!list.length ? (
        <span style={{ fontSize: 13, color: '#8A93AD', padding: '8px 0' }}>ยังไม่มีข้อมูล</span>
      ) : (
        <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map(([k, v]) => (
            <div key={k} role="listitem" title={`${k}: ${fmt(v)}${unit}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,140px) minmax(0,1fr) auto', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: '#384155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
              <span style={{ height: 12, background: '#F0F2F8', borderRadius: 4, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.max(2, (v / max) * 100)}%`, background: '#1A3FE0', borderRadius: '0 4px 4px 0' }} />
              </span>
              <span style={{ color: '#0E1430', fontWeight: 500, ...tabular }}>{fmt(v)}{unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: [string, SalesStats['byResp'][string]][] }) {
  return (
    <div style={{ ...card, borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, overflowX: 'auto' }}>
      <span style={{ fontSize: 15, fontWeight: 500 }}>{title}</span>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, ...tabular }}>
        <thead>
          <tr style={{ color: '#475069', textAlign: 'right' }}>
            <th style={{ textAlign: 'left', fontWeight: 500, padding: '6px 8px' }}>ชื่อ</th>
            <th style={{ fontWeight: 500, padding: '6px 8px' }}>ลูกค้า</th>
            <th style={{ fontWeight: 500, padding: '6px 8px' }}>Forecast</th>
            <th style={{ fontWeight: 500, padding: '6px 8px' }}>Actual</th>
            <th style={{ fontWeight: 500, padding: '6px 8px' }}>%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderTop: '1px solid #EEF1F8', textAlign: 'right' }}>
              <td style={{ textAlign: 'left', padding: '6px 8px' }}>{k}</td>
              <td style={{ padding: '6px 8px' }}>{fmtN(v.n)}</td>
              <td style={{ padding: '6px 8px' }}>{fmtMoney(v.forecast)}</td>
              <td style={{ padding: '6px 8px' }}>{fmtMoney(v.actual)}</td>
              <td style={{ padding: '6px 8px' }}>{v.forecast ? Math.round((v.actual / v.forecast) * 100) + '%' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ S, deals, today }: { S: SalesState; deals: Deal[]; today: string }) {
  const { set } = useApp();
  const [f, setF] = useState({ resp: '', referral: '', month: '' });
  const list = deals.filter((d) => (!f.resp || (d.resp || '(ไม่ระบุ)') === f.resp) && (!f.referral || (d.referral || '(ไม่ระบุ)') === f.referral) && (!f.month || d.contactDate.slice(5, 7) === f.month));
  const st = salesStats(S, list, today);
  const uniq = (k: 'resp' | 'referral') => [...new Set(deals.map((d) => d[k] || '(ไม่ระบุ)'))].sort();
  const sel = { ...selectStyle, height: 36, fontSize: 13 };
  const kpi: [string, string, string, string?][] = [
    ['👥', fmtN(st.total), 'ลูกค้า (ตามตัวกรอง)'],
    ['🎯', st.winRate + '%', `Win rate · ปิดได้ ÷ รู้ผลแล้ว (${fmtN(st.decided)})`],
    ['✓', fmtN(st.yes), 'ปิดการขายได้ (YES)', '#14633F'],
    ['✕', fmtN(st.no), 'ไม่สำเร็จ (NO)', '#8A2B12'],
    ['…', fmtN(st.wait + st.none), 'รอผล / ยังไม่มีผล'],
    ['฿', fmtMoney(st.forecast) || '0', `Forecast รวม · ยืนยันด้วยเอกสาร ${fmtMoney(st.fcConfirmed) || '0'}`],
    ['฿', fmtMoney(st.actual) || '0', `Actual รวม · ยืนยันด้วยเอกสาร ${fmtMoney(st.acConfirmed) || '0'}`],
    ['%', st.achieved + '%', 'Actual ÷ Forecast'],
    ['⏹', fmtN(st.closed), 'ปิดงานแล้ว'],
    ['▶', fmtN(st.open), 'งานที่ยังเปิด'],
    ['⏰', fmtN(st.overdue), 'ค้างติดตาม (เกิน 14 วัน)', st.overdue ? '#8A2B12' : undefined],
  ];
  const follow = list
    .filter((d) => d.jobStatus === 'open' && !['YES', 'NO'].includes(dealResult(S, d)))
    .sort((a, b) => (a.contactDate || '0').localeCompare(b.contactDate || '0'));
  const srcRows = Object.entries(st.bySource);
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={f.resp} onChange={(ev) => setF({ ...f, resp: ev.target.value })} style={sel} aria-label="ผู้รับผิดชอบ"><Opts all="ผู้รับผิดชอบ: ทั้งหมด" options={uniq('resp').map((x) => ({ v: x, label: x }))} /></select>
        <select value={f.referral} onChange={(ev) => setF({ ...f, referral: ev.target.value })} style={sel} aria-label="แหล่งที่มา"><Opts all="แหล่งที่มา: ทั้งหมด" options={uniq('referral').map((x) => ({ v: x, label: x }))} /></select>
        <select value={f.month} onChange={(ev) => setF({ ...f, month: ev.target.value })} style={sel} aria-label="เดือนที่ติดต่อ"><Opts all="เดือน: ทั้งหมด" options={TH_M.slice(1).map((m, i) => ({ v: String(i + 1).padStart(2, '0'), label: m }))} /></select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
        {kpi.map(([ic, v, l, c]) => (
          <div key={l} style={{ ...card, borderRadius: 16, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span aria-hidden="true" style={{ width: 36, height: 36, flex: 'none', borderRadius: 10, background: '#F0F4FF', color: c || '#1A3FE0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{ic}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 21, fontWeight: 500, color: c || '#0E1430', ...tabular }}>{v}</span>
              <span style={{ fontSize: 12, color: '#475069', lineHeight: 1.4 }}>{l}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 12 }}>
        <Bars title="Pipeline ตามขั้นตอน" sub="จำนวนลูกค้าที่มีวันที่หรือโน้ตในแต่ละขั้น" items={st.stages.map((x) => [x.name, x.n])} />
        <Bars title="ลูกค้าตามช่องทาง" sub="SOURCE · ลูกค้าที่ติ๊กหลายช่องทางนับในทุกช่องทาง" items={srcRows.map(([k, x]) => [k, x.n])} />
        <Bars title="ลูกค้าตามบริการ" sub="Services" items={Object.entries(st.byService)} />
        <Bars title="Forecast ตามช่องทาง" sub="บาท · ลูกค้าหลายช่องทางนับซ้ำ ผลรวมจึงอาจเกิน Forecast รวม" items={srcRows.map(([k, x]) => [k, x.forecast])} fmt={(n) => fmtMoney(n)} />
        <Bars title="Win rate ตามช่องทาง" sub="ปิดได้ ÷ รู้ผลแล้ว ในแต่ละช่องทาง" items={winRateBySource(st.bySource)} unit="%" keepZero />
        <GroupTable title="สรุปยอดตามผู้รับผิดชอบ" rows={Object.entries(st.byResp).sort((a, b) => b[1].forecast - a[1].forecast)} />
        <GroupTable title="สรุปยอดตามแหล่งที่มา" rows={Object.entries(st.byReferral).sort((a, b) => b[1].forecast - a[1].forecast)} />
      </div>
      <div style={{ ...card, borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>รายการที่ต้องติดตาม <span style={{ fontSize: 12.5, color: '#5E6680', fontWeight: 300 }}>ยังเปิดงานและยังไม่รู้ผล · ติดต่อนานที่สุดก่อน</span></span>
        {!follow.length && <span style={{ fontSize: 13, color: '#8A93AD' }}>ไม่มีรายการค้าง</span>}
        {follow.slice(0, 50).map((d) => {
          const od = overdueDays(d, today);
          return (
            <button key={d.id} onClick={() => set({ deal: d.id })} className="h-bg" style={{ cursor: 'pointer', border: 0, borderTop: '1px solid #EEF1F8', background: 'transparent', textAlign: 'left', padding: '8px 4px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, fontSize: 13.5 }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ color: '#0E1430' }}>{d.client}</span>
                <span style={{ fontSize: 12, color: '#475069' }}>{[d.section, d.resp, d.contactDate ? 'ติดต่อล่าสุด ' + isoTh(d.contactDate) : 'ยังไม่ระบุวันที่ติดต่อ'].filter(Boolean).join(' · ')}</span>
              </span>
              {od != null && <span style={{ fontSize: 12, padding: '2px 9px', borderRadius: 999, background: '#FBE3DC', color: '#8A2B12', alignSelf: 'center' }}>⏰ {fmtN(od)} วัน</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ closed + log

/** Closed jobs of the year, with the same filters as the table (shown here too, so what is counted is what is listed). */
function ClosedView({ S, deals, facets, total }: { S: SalesState; deals: Deal[]; facets: Deal[]; total: number }) {
  const { engine: e, ui, set } = useApp();
  const on = filtersOn(ui.slF);
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

