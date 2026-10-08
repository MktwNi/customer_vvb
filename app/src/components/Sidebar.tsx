import { useEffect, useRef, useState } from 'react';
import { useApp, useEngineVersion, type Tab } from '../state';
import { fmtN, isoTh, todayISO } from '../lib/format';
import { Icon, type IconName } from './icons';
import { overdueDays } from '../lib/sales';
import mark from '../assets/gcc-mark.png';
import { useSlide } from './useSlide';
import { RoleChip, nameLetter } from './Login';
import { menuKeys, usePopover } from './usePopover';

/** `admin`: shown only to an admin of a team that signs in with accounts. */
export interface NavItem { key: Tab; label: string; icon: IconName; admin?: boolean }

/**
 * Main navigation, grouped like a CRM sidebar. To add a feature: add its key to `Tab` (state.tsx),
 * render it in App.tsx, and add an entry here (in an existing group or a new one).
 */
export const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'งานขาย',
    items: [
      { key: 'overview', label: 'ภาพรวม', icon: 'overview' },
      { key: 'sales', label: 'Sales Tracker', icon: 'sales' },
      { key: 'people', label: 'ผู้ติดต่อ', icon: 'people' },
      { key: 'search', label: 'ค้นหา', icon: 'search' },
      { key: 'track', label: 'ติดตาม', icon: 'track' },
      { key: 'plan', label: 'แผนติดต่อ', icon: 'plan' },
      { key: 'map', label: 'แผนที่', icon: 'map' },
    ],
  },
  {
    title: 'จัดการข้อมูล',
    items: [
      { key: 'dedup', label: 'ตรวจข้อมูลซ้ำ', icon: 'dedup' },
      { key: 'update', label: 'อัปเดตข้อมูล', icon: 'update' },
      { key: 'notes', label: 'หมายเหตุ', icon: 'notes' },
      { key: 'users', label: 'ผู้ใช้และสิทธิ์', icon: 'shield', admin: true },
    ],
  },
];
export const TABS: [Tab, string][] = NAV.flatMap((g) => g.items.map((i): [Tab, string] => [i.key, i.label]));

/** Matches the CSS breakpoint where the sidebar becomes a slide-out drawer. */
export const MOBILE_NAV = '(max-width: 900px)';
/** From this width the full menu can stay docked beside the page. */
export const WIDE_NAV = '(min-width: 1280px)';
export function useMedia(q: string) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** One line describing the loaded data (shown in the top bar, and in the drawer on phones). */
export function useDataLine() {
  const { engine: e } = useApp();
  if (!e.ready) return 'กำลังโหลด…';
  const src = e.base.source === 'upload' ? `ไฟล์ที่อัปโหลด ${e.base.fileName || ''}` : 'ไฟล์ข้อมูลต้นฉบับของเว็บ';
  return `ข้อมูล ณ ${isoTh(e.base.asOf)} · ${src} · ${fmtN(e.B.companies.length)} บริษัท · ${fmtN(e.B.certs.length)} ใบรับรอง CFO`;
}

/**
 * Wide screens: the full menu docked beside the page (☰ in the top bar folds it to an icon rail).
 * 901–1279px: an icon rail; ☰ slides the full menu out over the page, and choosing an item, clicking
 * outside or Escape folds it back. Phones (<= 900px): a drawer opened from the top bar.
 */
export function Sidebar({ open, docked, mobile, onClose }: { open: boolean; docked: boolean; mobile: boolean; onClose: () => void }) {
  const { engine: e, ui, go, set } = useApp();
  useEngineVersion();
  const closeRef = useRef<HTMLButtonElement>(null);
  const ready = e.ready;
  const rail = !mobile && !docked && !open; // icons only
  const mode = mobile ? '' : docked ? ' dock tabs' : open ? ' over' : ' rail tabs';
  // the open page's tab slides to the page chosen (folding the menu just moves it, see useSlide)
  const navRef = useRef<HTMLElement>(null);
  const role = e.role();
  const admin = role === 'admin';
  // (the admin's extra item moves nothing above it, but the highlight is placed again when it comes or goes)
  useSlide(navRef, '.side-item[aria-current=page]', ready ? ui.tab + (admin ? '|a' : '') : '');
  const s = e.session;

  // one badge in the whole menu: the Sales Tracker's overdue follow-ups (say it once)
  const badges: Partial<Record<Tab, number>> = {};
  if (ready) {
    const today = todayISO();
    const yearDeals = Object.values(e.sales.deals).filter((d) => d.year === ui.slYear);
    badges.sales = yearDeals.filter((d) => overdueDays(e.sales, d, today) != null).length;
  }

  // open menu: Escape folds it and focus returns to the button that opened it;
  // on phones focus also moves into the drawer
  useEffect(() => {
    if (!open) return;
    if (mobile) closeRef.current?.focus();
    else (document.querySelector<HTMLElement>('#side-nav .side-item[aria-current=page]') || document.querySelector<HTMLElement>('#side-nav .side-item'))?.focus();
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      onClose();
      document.getElementById(mobile ? 'menu-btn' : 'rail-btn')?.focus();
    };
    document.addEventListener('keydown', kd, true);
    return () => document.removeEventListener('keydown', kd, true);
  }, [open, mobile, onClose]);

  return (
    <>
      <div className={'side-backdrop' + (open ? ' open' : '')} onClick={onClose} />
      <aside id="side-nav" className={'side' + mode + (open ? ' open' : '')} aria-label="เมนูหลัก">
        <div className="side-brand">
          <img className="side-mark" src={mark} alt="Global Carbon Corporation" width={36} height={36} />
          <span className="side-brand-text lbl">
            <b className="brand-word">Global Carbon</b>
            <small>ฐานข้อมูลลูกค้า GCC</small>
          </span>
          <button ref={closeRef} className="side-close" onClick={onClose} aria-label="ปิดเมนู">
            <Icon name="close" />
          </button>
        </div>
        <div className="side-cta">
          {role === 'viewer' ? (
            // a view-only account adds nothing: say so where the add button would be
            <span className="side-ro" title="บัญชีนี้ดูข้อมูลได้ แต่แก้ไขไม่ได้" aria-label={rail ? 'ดูอย่างเดียว: บัญชีนี้ดูข้อมูลได้ แต่แก้ไขไม่ได้' : undefined} role={rail ? 'img' : undefined}>
              <Icon name="eye" />
              <span className="lbl">ดูอย่างเดียว</span>
            </span>
          ) : (
            <AddMenu rail={rail} ready={ready} onDone={onClose} />
          )}
        </div>
        <nav className="side-nav" ref={navRef}>
          <span className="slide-ind" aria-hidden="true" />
          {NAV.map((g) => (
            <div key={g.title} className="side-group" role="group" aria-label={g.title}>
              <span className="side-group-title lbl" aria-hidden="true">{g.title}</span>
              {g.items.filter((it) => !it.admin || admin).map((it) => {
                const on = ready && ui.tab === it.key;
                const b = badges[it.key] || 0;
                return (
                  <button
                    key={it.key}
                    className="side-item"
                    aria-current={on ? 'page' : undefined}
                    title={rail ? it.label + (b ? ` (ค้างติดตาม ${fmtN(b)})` : '') : undefined}
                    aria-label={rail ? it.label + (b ? ` ค้างติดตาม ${fmtN(b)} ราย` : '') : undefined}
                    onClick={() => {
                      if (ready) go(it.key);
                      onClose();
                    }}
                  >
                    <span className="side-ico">
                      <Icon name={it.icon} />
                      {rail && b > 0 && <span className="side-dot">{b > 99 ? '99+' : fmtN(b)}</span>}
                    </span>
                    <span className="side-label lbl">{it.label}</span>
                    {!rail && b > 0 && <span className="side-badge" title={`ค้างติดตาม ${fmtN(b)} ราย`}>{fmtN(b)}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {/* phones: the top bar has no room for the account, so it is here */}
        {mobile && s && role && (
          <div className="side-acct">
            <div className="side-acct-who">
              <span className="acct-ava" aria-hidden="true">{nameLetter(s.name)}</span>
              <span className="side-acct-t">
                <b>{s.name}</b>
                <small>@{s.u}</small>
              </span>
              <RoleChip role={role} />
            </div>
            <div className="side-acct-btns">
              <button
                onClick={() => {
                  onClose();
                  document.getElementById('menu-btn')?.focus();
                  set({ acctDlg: 'passwd' });
                }}
              >
                เปลี่ยนรหัสผ่าน
              </button>
              <button
                className="out"
                onClick={() => {
                  onClose();
                  document.getElementById('menu-btn')?.focus();
                  set({ acctDlg: 'logout' });
                }}
              >
                ออกจากระบบ
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

/**
 * The shell's add button (outlined; the page's own primary is the filled one): two ways to add a
 * customer, the same as the Sales Tracker's. Placed beside the button, so the icon rail doesn't clip it.
 */
function AddMenu({ rail, ready, onDone }: { rail: boolean; ready: boolean; onDone: () => void }) {
  const { set, go } = useApp();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  usePopover(open, () => setOpen(false), btn, pop);
  const toggle = () => {
    const r = btn.current?.getBoundingClientRect();
    // beside the rail's round button; under the full-width one
    if (r) setAt(rail ? { left: r.right + 10, top: r.top } : { left: r.left, top: r.bottom + 8 });
    setOpen(!open);
  };
  const pick = (f: () => void) => {
    setOpen(false);
    onDone();
    f();
  };
  return (
    <>
      <button
        ref={btn}
        className="side-add"
        disabled={!ready}
        title={rail ? 'เพิ่มลูกค้าใหม่' : undefined}
        aria-label={rail ? 'เพิ่มลูกค้าใหม่' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="plus" />
        <span className="lbl">เพิ่มลูกค้าใหม่</span>
      </button>
      {open && (
        <div ref={pop} role="menu" aria-label="เพิ่มลูกค้าใหม่" className="menu side-addmenu" style={at} onKeyDown={menuKeys}>
          <button role="menuitem" className="menu-i" onClick={() => pick(() => { go('search'); setTimeout(() => document.getElementById('search-q')?.focus(), 60); })}>
            ค้นหาบริษัทในทะเบียน<small>แล้วส่งเข้า Sales Tracker</small>
          </button>
          <button role="menuitem" className="menu-i" onClick={() => pick(() => set({ addCust: { deal: false } }))}>
            ลูกค้าใหม่ (ไม่มีในทะเบียน)<small>กรอกข้อมูลเอง</small>
          </button>
        </div>
      )}
    </>
  );
}
