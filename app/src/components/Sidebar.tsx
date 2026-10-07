import { useEffect, useRef, useState } from 'react';
import { useApp, useEngineVersion, type Tab } from '../state';
import { fmtN, isoTh, todayISO } from '../lib/format';
import { Icon, type IconName } from './icons';

export interface NavItem { key: Tab; label: string; icon: IconName }

/**
 * Main navigation, grouped like a CRM sidebar. To add a feature: add its key to `Tab` (state.tsx),
 * render it in App.tsx, and add an entry here (in an existing group or a new one).
 */
export const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'งานขาย',
    items: [
      { key: 'overview', label: 'ภาพรวม', icon: 'overview' },
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
    ],
  },
];
export const TABS: [Tab, string][] = NAV.flatMap((g) => g.items.map((i): [Tab, string] => [i.key, i.label]));

/** Matches the CSS breakpoint where the sidebar becomes a slide-out drawer. */
export const MOBILE_NAV = '(max-width: 900px)';
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
 * Desktop: an icon rail; the ☰ button slides the full menu out over the page, and choosing an item,
 * clicking outside or Escape folds it back. Phones (<= 900px): a drawer opened from the top bar.
 */
export function Sidebar({ open, onToggle, onClose }: { open: boolean; onToggle: () => void; onClose: () => void }) {
  const { engine: e, ui, go } = useApp();
  useEngineVersion();
  const mobile = useMedia(MOBILE_NAV);
  const dataLine = useDataLine();
  const closeRef = useRef<HTMLButtonElement>(null);
  const ready = e.ready;
  const rail = !mobile && !open; // icons only

  const badges: Partial<Record<Tab, number>> = {};
  if (ready) {
    const today = todayISO();
    const mon = e.monCfg();
    badges.track = (mon.events || []).filter((x) => x.at > (mon.seenAt || '')).length;
    badges.plan = e.crm.tasks.filter((t) => !t.done && t.date <= today).length;
    badges.dedup = e.B.groups.filter((g) => g.state === 'pending').length;
  }

  // open menu: Escape folds it and focus returns to the button that opened it;
  // on phones focus also moves into the drawer
  useEffect(() => {
    if (!open) return;
    if (mobile) closeRef.current?.focus();
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
      <aside id="side-nav" className={'side' + (open ? ' open' : '')} aria-label="เมนูหลัก">
        <div className="side-brand">
          <button id="rail-btn" className="rail-btn" onClick={onToggle} aria-label={open ? 'ย่อเมนู' : 'ขยายเมนู'} title={open ? 'ย่อเมนู' : 'ขยายเมนู'} aria-expanded={open} aria-controls="side-nav">
            <Icon name={open ? 'collapse' : 'menu'} />
          </button>
          <span className="side-logo lbl">GCC</span>
          <span className="side-brand-text lbl">
            <b>ฐานข้อมูลลูกค้า GCC</b>
            <small>CRM ทีมขาย</small>
          </span>
          <button ref={closeRef} className="side-close" onClick={onClose} aria-label="ปิดเมนู">
            <Icon name="close" />
          </button>
        </div>
        <nav className="side-nav">
          {NAV.map((g) => (
            <div key={g.title} className="side-group" role="group" aria-label={g.title}>
              <span className="side-group-title lbl" aria-hidden="true">{g.title}</span>
              {g.items.map((it) => {
                const on = ready && ui.tab === it.key;
                const b = badges[it.key] || 0;
                return (
                  <button
                    key={it.key}
                    className="side-item"
                    aria-current={on ? 'page' : undefined}
                    title={rail ? it.label + (b ? ` (${fmtN(b)})` : '') : undefined}
                    aria-label={rail ? it.label + (b ? ` ${fmtN(b)} รายการ` : '') : undefined}
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
                    {!rail && b > 0 && <span className="side-badge">{fmtN(b)}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {mobile && (
          <div className="side-foot">
            <span className="side-data">{dataLine}</span>
          </div>
        )}
      </aside>
    </>
  );
}
