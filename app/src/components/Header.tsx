import { useRef, useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { addMonths, dmTh, dtTh, fmtN, isoTh, todayISO } from '../lib/format';
import { reqWords, resultNotice } from '../lib/reqText';
import { TEAM_ST, TeamChip } from './TeamSync';
import { Icon } from './icons';
import { RoleChip, hhmm, nameLetter, sessionLine } from './Login';
import { menuKeys, usePopover } from './usePopover';
import { TABS, useDataLine } from './Sidebar';
import { DateField } from './ui';
import { SelField } from './Select';
import { EMPTY_FILTERS } from '../lib/search';
import mark from '../assets/gcc-mark.png';

/** Top bar across the window: logo, menu button, page name + data line, quick search, team status,
 *  the reference-date picker and who is using this browser ("ฉันคือ"). */
export function TopBar({ navOpen, docked, onMenu, onToggle }: { navOpen: boolean; docked: boolean; onMenu: () => void; onToggle: () => void }) {
  const { engine: e, ui, go } = useApp();
  useEngineVersion();
  const ready = e.ready;
  const dataLine = useDataLine();
  const title = (TABS.find(([k]) => k === ui.tab) || TABS[0])[1];
  // the reference date only changes what these pages count (or a date other than today is in use)
  const dateHere = ready && (['overview', 'search', 'track'].includes(ui.tab) || e.ref !== todayISO());

  return (
    <header className="topbar">
      <div className="tb-brand">
        <img src={mark} alt="Global Carbon Corporation" width={38} height={38} />
        <span className="tb-brand-text">
          {/* the full name on two lines (one span per line; the space keeps copy and screen readers right) */}
          <b><span className="bw">Global Carbon</span> <span className="bw">Corporation</span></b>
          <small>ฐานข้อมูลลูกค้า GCC</small>
        </span>
      </div>
      <button id="rail-btn" className="tb-round" onClick={onToggle} aria-label={docked || navOpen ? 'ย่อเมนู' : 'ขยายเมนู'} title={docked || navOpen ? 'ย่อเมนู' : 'ขยายเมนู'} aria-expanded={docked || navOpen} aria-controls="side-nav">
        <Icon name="menu" />
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
        {dateHere && <RefDate />}
        {ready && (e.role() ? <AccountMenu /> : <MeButton />)}
      </div>
    </header>
  );
}

/**
 * "สถานะ ณ 8 ต.ค. 2569": the date the statuses are counted at, and the "ใกล้หมดอายุ" window. Changes
 * apply at once; a click outside or Escape closes it. The data's own date is said here too.
 */
function RefDate() {
  const { engine: e, setRef } = useApp();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  usePopover(open, () => setOpen(false), btn, pop);
  const today = todayISO();
  const quick: [string, string][] = [['วันนี้', today], ['+3 เดือน', addMonths(today, 3)], ['+6 เดือน', addMonths(today, 6)]];
  const src = e.base.source === 'upload' ? `ไฟล์ที่อัปโหลด ${e.base.fileName || ''}` : 'ไฟล์ข้อมูลต้นฉบับของเว็บ';
  return (
    <div style={{ position: 'relative' }}>
      <button ref={btn} className="tb-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" aria-label={`สถานะ ณ ${isoTh(e.ref)} (เปลี่ยนวันที่)`}>
        <span className="tb-muted tb-hide-sm">สถานะ ณ</span>
        <span className="tb-hide-sm">{isoTh(e.ref)}</span>
        {/* a phone: the year only when it isn't this one, so the page's name keeps its room */}
        <span className="tb-show-sm">{e.ref.slice(0, 4) === today.slice(0, 4) ? dmTh(e.ref) : isoTh(e.ref)}</span>
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label="ดูสถานะ ณ วันที่" className="menu tb-pop">
          <label className="tb-pop-f">
            ดูสถานะ ณ วันที่
            <DateField value={e.ref} onChange={(v) => v && setRef(v)} />
          </label>
          <div className="seg" role="group" aria-label="วันที่ที่ใช้บ่อย">
            {quick.map(([label, v]) => (
              <button key={label} type="button" aria-pressed={e.ref === v} onClick={() => setRef(v)}>{label}</button>
            ))}
          </div>
          <SelField className="tb-pop-f" text={'ช่วง "ใกล้หมดอายุ"'} value={String(e.win)} onChange={(v) => setRef(null, +v)} options={[30, 60, 90, 180].map((n) => ({ v: String(n), label: `${n} วัน` }))} />
          <span className="t-meta" style={{ lineHeight: 1.5 }}>สถานะ กลุ่มเป้าหมาย และรอบ อบก. คำนวณใหม่ทั้งเว็บ · ข้อมูล ณ {isoTh(e.base.asOf)} · {src}</span>
        </div>
      )}
    </div>
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
  const admin = e.can('set.users');
  // a request waiting: its status takes the place of "ขอเปลี่ยนสิทธิ์" (a script without requests: neither)
  const pend = s.req?.st === 'p' ? s.req : null;
  const mayAsk = e.rolesLive && !admin;
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
        aria-label={`บัญชีของฉัน: ${s.name} · ${e.roleName()}`}
        title={`${s.name} (@${s.u}) · ${e.roleName()}`}
      >
        <span className="tb-me-name">{s.name}</span>
        <RoleChip name={e.roleName()} admin={admin} className="tb-me-role" />
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
            <RoleChip name={e.roleName()} admin={admin} />
          </div>
          <div className="acct-meta">
            <span>
              <i style={{ background: e.auth === 'expired' ? TEAM_ST.error[1] : dot }} aria-hidden="true" />
              {sync}
            </span>
            {sessionLine(s) && <span>{sessionLine(s)}</span>}
          </div>
          {pend && (
            <div className="rl-acct-req">
              <div className="rl-acct-req-h">
                <span>คำขอเปลี่ยนสิทธิ์</span>
                <span className="chip">รออนุมัติ</span>
              </div>
              <span>{reqWords(pend, e.roleNameOf)} · ส่งเมื่อ {dtTh(pend.at)}</span>
              <span className="rl-acct-req-l">
                <button type="button" className="lnk" onClick={() => pick(() => set({ acctDlg: 'request', reqInit: { k: pend.k } }))}>ดูคำขอ</button>
                <CancelReq onDone={() => setOpen(false)} />
              </span>
            </div>
          )}
          <div id="acct-menu" role="menu" aria-label="บัญชีของฉัน" className="acct-items" onKeyDown={menuKeys}>
            <button role="menuitem" className="acct-item" onClick={() => pick(() => set({ acctDlg: 'passwd' }))}>
              เปลี่ยนรหัสผ่าน
            </button>
            <button role="menuitem" className="acct-item" onClick={() => pick(() => set({ acctDlg: 'perms' }))}>
              สิทธิ์ของฉัน
            </button>
            {mayAsk && !pend && (
              <button role="menuitem" className="acct-item" onClick={() => pick(() => set({ acctDlg: 'request', reqInit: null }))}>
                ขอเปลี่ยนสิทธิ์
              </button>
            )}
            {admin && (
              <button role="menuitem" className="acct-item" onClick={() => pick(() => go('users'))}>
                  ผู้ใช้และสิทธิ์
              </button>
            )}
            <button role="menuitem" className="acct-item" onClick={() => pick(() => go('update'))}>
              การเชื่อมต่อทีม
            </button>
            <span className="acct-sep" role="separator" />
            <button role="menuitem" className="acct-item acct-out" onClick={() => pick(() => set({ acctDlg: 'logout' }))}>
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "ยกเลิกคำขอ" in the account menu: withdraws the pending request (online only). */
function CancelReq({ onDone }: { onDone: () => void }) {
  const { engine: e } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="quiet"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await e.reqCancel();
          onDone();
        } catch (x) {
          window.alert('ยกเลิกคำขอไม่สำเร็จ: ' + ((x as Error)?.message || x));
        } finally {
          setBusy(false);
        }
      }}
    >
      ยกเลิกคำขอ
    </button>
  );
}

/** The decision on this account's request (approved or not), until "ซ่อน" says it was read. */
function ReqResult() {
  const { engine: e, set } = useApp();
  const [busy, setBusy] = useState(false);
  const r = e.session?.req;
  if (!r || r.st !== 'r') return null;
  const n = resultNotice(r, e.roleNameOf, e.roleName());
  return (
    <div className="note rl-res" role="status">
      <span>
        {n.lead}
        {n.role && <b>{n.role}</b>}
        {n.tail}
        {r.note && <> · “{r.note}”</>}
      </span>
      {r.ok ? (
        <button type="button" className="lnk" onClick={() => set({ acctDlg: 'perms' })}>ดูสิทธิ์ของฉัน</button>
      ) : (
        <button type="button" className="lnk" onClick={() => set({ acctDlg: 'request', reqInit: { k: r.caps?.length ? 'caps' : 'role' } })}>ส่งคำขอใหม่</button>
      )}
      <button
        type="button"
        className="quiet"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await e.reqAck().catch(() => {});
          setBusy(false);
        }}
      >
        ซ่อน
      </button>
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
      ev = { text: 'เหตุการณ์ใหม่จากการตรวจสถานะ: ' + Object.keys(L).filter(n).map((k) => `${L[k]} ${fmtN(n(k))}`).join(' · ') };
    }
  }
  // one quiet line each (design §7.11): what is different, and the one thing to do about it
  return (
    <>
      {e.session?.req?.st === 'r' && (
        <div style={wrap}>
          <ReqResult />
        </div>
      )}
      {e.ref !== today && (
        <div style={wrap}>
          <div className="note" role="status">
            <span className="t-warn">กำลังดูสถานะ ณ {isoTh(e.ref)} ไม่ใช่วันนี้ · การตรวจสถานะอัตโนมัติหยุดไว้</span>
            <button onClick={() => setRef(today)} className="lnk">กลับไปวันนี้</button>
          </div>
        </div>
      )}
      {ev && (
        <div style={wrap}>
          <div className="note" role="status">
            <span>{ev.text}</span>
            <button onClick={() => go('track')} className="lnk">ดูเหตุการณ์</button>
            <button onClick={() => e.ackEvents()} className="quiet">ซ่อน</button>
          </div>
        </div>
      )}
    </>
  );
}
