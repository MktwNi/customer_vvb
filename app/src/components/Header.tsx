import { useRef, useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { addMonths, fmtN, isoTh, todayISO } from '../lib/format';
import { ROLE_TH } from '../lib/auth';
import { TEAM_ST, TeamChip } from './TeamSync';
import { Icon } from './icons';
import { RoleChip, hhmm, nameLetter, sessionLine } from './Login';
import { menuKeys, usePopover } from './usePopover';
import { TABS, useDataLine } from './Sidebar';
import { EMPTY_FILTERS } from '../lib/search';
import mark from '../assets/gcc-mark.png';

/** Top bar across the window: logo, menu button, page name + data line, quick search, team status,
 *  the reference-date picker and who is using this browser ("ฉันคือ"). */
export function TopBar({ navOpen, docked, onMenu, onToggle }: { navOpen: boolean; docked: boolean; onMenu: () => void; onToggle: () => void }) {
  const { engine: e, ui, go, setRef } = useApp();
  useEngineVersion();
  const [dateOpen, setDateOpen] = useState(false);
  const ready = e.ready;
  const today = todayISO();
  const dataLine = useDataLine();
  const title = (TABS.find(([k]) => k === ui.tab) || TABS[0])[1];

  const qd: [string, string | undefined][] = [
    ['วันนี้', today], ['วันที่ข้อมูล', ready ? e.base.asOf : undefined], ['+3 เดือน', addMonths(today, 3)], ['+6 เดือน', addMonths(today, 6)], ['+1 ปี', addMonths(today, 12)],
  ];
  const quick = qd.filter((x, i) => x[1] && qd.findIndex((y) => y[1] === x[1]) === i) as [string, string][];

  return (
    <header className="topbar">
      <div className="tb-brand">
        <img src={mark} alt="Global Carbon Corporation" width={38} height={38} />
        <span className="tb-brand-text">
          <b>Global Carbon</b>
          <small>ฐานข้อมูลลูกค้า GCC</small>
        </span>
      </div>
      <button id="rail-btn" className="tb-round" onClick={onToggle} aria-label={docked || navOpen ? 'ย่อเมนู' : 'ขยายเมนู'} title={docked || navOpen ? 'ย่อเมนู' : 'ขยายเมนู'} aria-expanded={docked || navOpen} aria-controls="side-nav">
        <Icon name={docked || navOpen ? 'collapse' : 'menu'} />
      </button>
      <button id="menu-btn" className="menu-btn" onClick={onMenu} aria-label="เปิดเมนู" aria-expanded={navOpen} aria-controls="side-nav">
        <Icon name="menu" />
      </button>
      <img className="tb-mark" src={mark} alt="Global Carbon Corporation" width={32} height={32} />
      <div className="tb-title">
        <span className="tb-h" id="page-title">{ready ? title : 'ฐานข้อมูลลูกค้า GCC'}</span>
        <span className="tb-sub" title={dataLine}>{dataLine}</span>
      </div>
      {ready && ui.tab !== 'search' && <QuickSearch />}
      <div className="tb-actions">
        {ready && <TeamChip onClick={() => go('update')} />}
        <div style={{ position: 'relative' }}>
          <button className="tb-btn" onClick={() => setDateOpen(!dateOpen)} aria-expanded={dateOpen} aria-label={`สถานะ ณ ${isoTh(e.ref)} · ใกล้หมด ≤ ${e.win} วัน`}>
            <span className="tb-muted tb-hide-sm">สถานะ ณ</span>
            <span style={{ fontWeight: 500 }}>{isoTh(e.ref)}</span>
            <span className="tb-muted tb-hide-md">· ใกล้หมด ≤ {e.win} วัน</span>
            <span className="tb-muted" aria-hidden="true">▾</span>
          </button>
          {dateOpen && (
            <div style={{ position: 'absolute', top: 46, right: 0, zIndex: 30, background: '#fff', color: '#0E1430', borderRadius: 18, padding: 18, boxShadow: '0 24px 60px -16px rgba(4,10,60,.5)', border: '1px solid #E3E7F1', display: 'flex', flexDirection: 'column', gap: 14, width: 'min(340px,86vw)' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: '#475069' }}>
                ดูสถานะ ณ วันที่
                <input type="date" value={e.ref} onChange={(ev) => ev.target.value && setRef(ev.target.value)} className="fld" style={{ height: 42, borderRadius: 10, padding: '0 10px', color: '#0E1430' }} />
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {quick.map(([label, v]) => {
                  const on = e.ref === v;
                  return (
                    <button key={label} onClick={() => setRef(v)} className="hv" style={{ cursor: 'pointer', height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5, border: `1.5px solid ${on ? 'var(--brand)' : '#D5DBEA'}`, '--bg': on ? 'var(--brand)' : '#fff', ...(on ? { '--hv': 'var(--brand-deep)' } : {}), color: on ? '#fff' : '#0E1430' }}>{label}</button>
                  );
                })}
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: '#475069' }}>
                ช่วง "ใกล้หมดอายุ"
                <select value={String(e.win)} onChange={(ev) => setRef(null, +ev.target.value)} className="fld sel" style={{ height: 42, borderRadius: 10 }}>
                  {[30, 60, 90, 180].map((n) => <option key={n} value={n}>{n} วัน</option>)}
                </select>
              </label>
              <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.55, textWrap: 'pretty' }}>ใช้ดูล่วงหน้าหรือย้อนหลัง สถานะ กลุ่มเป้าหมาย และรอบ อบก. จะคำนวณใหม่ทั้งเว็บ</span>
              <button onClick={() => setDateOpen(false)} className="btn pri" style={{ alignSelf: 'flex-end', height: 34, fontSize: 13 }}>เสร็จ</button>
            </div>
          )}
        </div>
        {ready && (e.role() ? <AccountMenu /> : <MeButton />)}
      </div>
    </header>
  );
}

/** Search box in the top bar: Enter searches all companies on the search tab. */
function QuickSearch() {
  const { setF } = useApp();
  const [q, setQ] = useState('');
  return (
    <form
      className="tb-search"
      role="search"
      onSubmit={(ev) => {
        ev.preventDefault();
        const v = q.trim();
        if (!v) return;
        setF({ ...EMPTY_FILTERS, view: 'co', sort: 'default', q: v });
        setQ('');
        // this box is not on the search page: carry on typing in the page's own search field
        requestAnimationFrame(() => document.getElementById('search-q')?.focus());
      }}
    >
      <Icon name="search" />
      <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="ค้นหาบริษัท เลขนิติบุคคล เบอร์โทร…" aria-label="ค้นหาบริษัท (กด Enter)" />
    </form>
  );
}

/** Who is using this browser ("ฉันคือ", set on the update tab): shown in the history of changes. */
function MeButton() {
  const { engine: e, go } = useApp();
  const me = e.me();
  // the letter of the name itself, not of a leading "คุณ" (but keep names such as "คุณากร")
  const initial = me ? nameLetter(me) : '';
  return (
    <button className="tb-me" onClick={() => go('update')} title={me ? `ฉันคือ ${me} · เปลี่ยนชื่อที่แท็บอัปเดตข้อมูล` : 'ใส่ชื่อของคุณที่แท็บอัปเดตข้อมูล'} aria-label={me ? `ฉันคือ ${me} (เปลี่ยนชื่อที่แท็บอัปเดตข้อมูล)` : 'ใส่ชื่อของคุณ (แท็บอัปเดตข้อมูล)'}>
      <span className="tb-me-name">{me || 'ใส่ชื่อของคุณ'}</span>
      <span className="tb-ava" aria-hidden="true">{initial || <Icon name="user" />}</span>
    </button>
  );
}

/**
 * The signed-in account (team accounts): name and role in the top bar; its menu says how the team sync
 * stands and how long this browser stays signed in, and leads to the account's settings.
 */
function AccountMenu() {
  const { engine: e, go, set } = useApp();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  usePopover(open, () => setOpen(false), btn, pop);
  const s = e.session;
  if (!s) return null;
  const t = e.team;
  const [label, dot] = TEAM_ST[t.status];
  const sync = `${e.auth === 'expired' ? 'ต้องเข้าสู่ระบบ' : label}${t.status === 'ok' && t.last ? ' ' + hhmm(Date.parse(t.last)) : ''} · รอส่ง ${fmtN(e.teamPendingN)}`;
  const pick = (f: () => void) => {
    setOpen(false);
    btn.current?.focus(); // a dialog opened from here gives the focus back to this button
    f();
  };
  return (
    <div className="acct">
      <button
        ref={btn}
        className="tb-me acct-btn"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'acct-menu' : undefined}
        aria-label={`บัญชีของฉัน: ${s.name} · ${ROLE_TH[s.role]}`}
        title={`${s.name} (@${s.u}) · ${ROLE_TH[s.role]}`}
      >
        <span className="tb-me-name">{s.name}</span>
        <RoleChip role={s.role} className="tb-me-role" />
        <span className="tb-ava" aria-hidden="true">{nameLetter(s.name)}</span>
      </button>
      {open && (
        <div ref={pop} className="acct-pop">
          <div className="acct-head">
            <span className="acct-ava" aria-hidden="true">{nameLetter(s.name)}</span>
            <span className="acct-who">
              <b>{s.name}</b>
              <small>@{s.u}</small>
            </span>
            <RoleChip role={s.role} />
          </div>
          <div className="acct-meta">
            <span>
              <i style={{ background: e.auth === 'expired' ? TEAM_ST.error[1] : dot }} aria-hidden="true" />
              {sync}
            </span>
            {sessionLine(s) && <span>{sessionLine(s)}</span>}
          </div>
          <div id="acct-menu" role="menu" aria-label="บัญชีของฉัน" className="acct-items" onKeyDown={menuKeys}>
            <button role="menuitem" className="acct-item" onClick={() => pick(() => set({ acctDlg: 'passwd' }))}>
              <Icon name="key" />
              เปลี่ยนรหัสผ่าน
            </button>
            {s.role === 'admin' && (
              <button role="menuitem" className="acct-item" onClick={() => pick(() => go('users'))}>
                <Icon name="shield" />
                ผู้ใช้และสิทธิ์
              </button>
            )}
            <button role="menuitem" className="acct-item" onClick={() => pick(() => go('update'))}>
              <Icon name="link" />
              การเชื่อมต่อทีม
            </button>
            <span className="acct-sep" role="separator" />
            <button role="menuitem" className="acct-item acct-out" onClick={() => pick(() => set({ acctDlg: 'logout' }))}>
              <Icon name="logout" />
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Banners() {
  const { engine: e, go, setRef } = useApp();
  useEngineVersion();
  const today = todayISO();
  const wrap = { maxWidth: 1400, width: '100%', margin: '16px auto 0', padding: '0 var(--main-px)' } as const;
  let ev: { text: string } | null = null;
  if (e.ready) {
    const mon = e.monCfg();
    const unseen = (mon.events || []).filter((x) => x.at > (mon.seenAt || ''));
    if (unseen.length) {
      const L: Record<string, string> = { cfoSoon: 'CFO ใกล้หมดอายุ', cfoExpired: 'CFO หมดอายุ', cfoRenewed: 'CFO ต่ออายุแล้ว', giDown: 'GI หมดอายุ/ลดระดับ', giUp: 'GI ระดับสูงขึ้น' };
      const n = (k: string) => unseen.filter((x) => x.t === k).length;
      ev = { text: 'ตรวจสถานะอัตโนมัติพบเหตุการณ์ใหม่: ' + Object.keys(L).filter(n).map((k) => `${L[k]} ${fmtN(n(k))}`).join(' · ') };
    }
  }
  return (
    <>
      {e.ref !== today && (
        <div style={wrap}>
          <div style={{ background: '#FFF4DC', border: '1px solid #F3D9A4', borderRadius: 16, padding: '10px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: '#6B4100', flex: 1, minWidth: 220 }}>
              กำลังดูสถานะ ณ <b style={{ fontWeight: 600 }}>{isoTh(e.ref)}</b> ซึ่งไม่ใช่วันนี้ ตัวเลขทั้งหมดคำนวณตามวันที่นี้ และการตรวจสถานะอัตโนมัติหยุดไว้ชั่วคราว
            </span>
            <button onClick={() => setRef(today)} className="hv" style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: 0, '--bg': '#6B4100', '--hv': '#523200', color: '#fff', fontSize: 13 }}>กลับไปวันนี้</button>
          </div>
        </div>
      )}
      {ev && (
        <div style={wrap}>
          <div style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 16, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E8A23B', flex: 'none' }} />
            <span style={{ fontSize: 13.5, flex: 1, minWidth: 240, textWrap: 'pretty' }}>{ev.text}</span>
            <button onClick={() => go('track')} className="btn pri" style={{ height: 34, padding: '0 14px', fontSize: 13 }}>ดูเหตุการณ์</button>
            <button onClick={() => e.ackEvents()} className="hv" style={{ cursor: 'pointer', height: 34, padding: '0 10px', border: 0, borderRadius: 999, color: '#475069', fontSize: 13, textDecoration: 'underline' }}>รับทราบ</button>
          </div>
        </div>
      )}
    </>
  );
}
