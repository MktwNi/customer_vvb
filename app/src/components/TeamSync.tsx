import { useState, type FormEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CONFIG } from '../lib/constants';
import { dtTh, fmtN } from '../lib/format';
import { ROLE_TH } from '../lib/auth';
import { deploymentId, type TeamStatus } from '../lib/teamSync';
import { Notice, labelCol } from './ui';

/** [label, dot colour on white, dot colour on the dark header] */
export const TEAM_ST: Record<TeamStatus, [string, string, string]> = {
  off: ['ยังไม่เชื่อมต่อ', '#7F88A3', '#A8B0C8'],
  connecting: ['กำลังเชื่อมต่อ…', '#B7791F', '#F2B84B'],
  syncing: ['กำลังซิงก์…', '#B7791F', '#F2B84B'],
  ok: ['ซิงก์แล้ว', '#14833F', '#34D1C4'],
  error: ['ซิงก์ไม่สำเร็จ', '#C4501A', '#FF9E8A'],
  offline: ['ออฟไลน์', '#7F88A3', '#C9D4FF'],
};
const hhmm = (iso: string) => (iso ? dtTh(iso).split(' ').slice(-2).join(' ') : '');

/** The link that brings a teammate to `url`'s team: the site itself for its home team (`home`). */
export function inviteLink(url: string, home = '') {
  if (url && url === home) return location.origin + location.pathname;
  return `${location.origin}${location.pathname}#team=${encodeURIComponent(url)}`;
}

export function TeamSyncCard() {
  const { engine: e, set } = useApp();
  useEngineVersion();
  const [copied, setCopied] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState<'' | 'key' | 'leave' | 'open'>('');
  // the site's own team: no link to paste, and no leaving it
  const home = e.homeTeam;
  const [url, setUrl] = useState(home || e.teamJoinUrl);
  const [joinSeen, setJoinSeen] = useState(e.teamJoinUrl);
  // an invite link opened while this page is showing fills the link in
  if (e.teamJoinUrl !== joinSeen) {
    setJoinSeen(e.teamJoinUrl);
    if (e.teamJoinUrl) setUrl(e.teamJoinUrl);
  }
  const cfg = e.teamCfg, t = e.team;
  const acct = cfg?.mode === 'accounts' && e.session ? e.session : null;
  const [label] = TEAM_ST[t.status];
  // step 2 of connecting (the team code) once the link turned out to be a team-code team; the home
  // team's form starts there
  const keyStep = !!home || (!!e.teamJoinUrl && url.trim() === e.teamJoinUrl);

  const next = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (keyStep) {
      await e.teamConnect(home || url, String(new FormData(ev.currentTarget).get('key') || ''));
      return;
    }
    // ask the script what it is: team code (the code field appears), sign-in, or first-admin setup
    setBusy('open');
    try {
      await e.teamOpen(url);
    } finally {
      setBusy('');
    }
  };
  const copy = async () => {
    if (!cfg) return;
    try {
      await navigator.clipboard.writeText(inviteLink(cfg.url, home));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('คัดลอกลิงก์นี้ส่งให้ทีม', inviteLink(cfg.url, home));
    }
  };
  const setKey = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setBusy('key');
    try {
      if (await e.teamSetKey(newKey)) setNewKey('');
    } finally {
      setBusy('');
    }
  };
  const disconnect = async () => {
    // queued edits belong to this sheet's link: try to send them before leaving it
    if (e.teamPendingN && navigator.onLine !== false) {
      setBusy('leave');
      try {
        await e.teamSyncNow();
      } finally {
        setBusy('');
      }
    }
    if (!e.teamCfg) return;
    const n = e.teamPendingN;
    const warn = n
      ? `\n\nยังมี ${fmtN(n)} รายการที่ส่งขึ้นชีตไม่ได้ จะเก็บไว้ในเครื่องนี้ และส่งให้ชีตที่คุณเชื่อมต่อครั้งถัดไป`
      : '';
    if (window.confirm('ยกเลิกการเชื่อมต่อกับชีตของทีม? ข้อมูลในเครื่องนี้ยังอยู่ แต่จะไม่ซิงก์กับทีมแล้ว' + warn)) e.teamDisconnect();
  };
  // a team-code team whose script can now do accounts: the lead turns them on from here
  const caps = cfg && !acct && e.caps?.url === cfg.url ? e.caps : null;
  const enableAccounts = () => e.teamBeginSetup();
  // an account made ดูอย่างเดียว with edits still queued: they can't be sent; offer to drop them
  const stuck = acct?.role === 'viewer' && e.teamPendingN > 0;
  const dropUnsent = async () => {
    if (!window.confirm(`ทิ้งรายการที่ส่งไม่ได้ ${fmtN(e.teamPendingN)} รายการ? ข้อมูลในเครื่องนี้จะกลับไปเป็นค่าของทีม`)) return;
    setBusy('leave');
    try {
      await e.teamDropUnsent();
    } finally {
      setBusy('');
    }
  };

  const status = !cfg ? TEAM_ST.off[0] : e.auth === 'expired' ? 'ต้องเข้าสู่ระบบ' : label + (!e.auth && t.status === 'ok' && t.last ? ` ${hhmm(t.last)}` : '');
  const bad = !!cfg && (e.auth === 'expired' || t.status === 'error' || t.status === 'offline');
  const chip = <span className={'chip' + (bad ? ' bad' : '')} style={{ flex: 'none' }}>{status}</span>;
  const title = 'แชร์ข้อมูลทีม (ทุกเครื่องเห็นเหมือนกัน)';
  const more = (x: ReactNode) => (
    <details className="upd-more">
      <summary className="lnk">รายละเอียด</summary>
      <div className="upd-more-b">{x}</div>
    </details>
  );
  const about = 'เชื่อมกับ Google Sheet ของทีม แล้ว ติดตาม สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ เบอร์ที่แก้ รายชื่อทีม และผลตรวจข้อมูลซ้ำ จะซิงก์ระหว่างทุกเครื่องอัตโนมัติ ทันทีที่แก้ไข และดึงของคนอื่นทุก 30 วินาที';

  // not connected yet: the form, open; connected: one folded line that opens to the details
  if (!cfg)
    return (
      <section id="team-sync" className="card upd-sec">
        <div className="upd-head">
          <div className="upd-t">
            <h3 className="card-t">{title}</h3>
            <span className="upd-status">{home ? 'ใส่รหัสทีมที่ได้จากหัวหน้าทีม แล้วกด เชื่อมต่อ' : 'วางลิงก์ที่หัวหน้าทีมส่งให้ แล้วกด ถัดไป'}</span>
          </div>
          {chip}
        </div>
        <form onSubmit={next} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {e.teamJoinUrl && !home && (
            <Notice kind="ok">
              คุณได้รับลิงก์เชิญเข้าทีม (ชีตรหัส …{deploymentId(e.teamJoinUrl)}) ตรวจกับหัวหน้าทีมว่าตรงกัน แล้วใส่รหัสทีมและกด เชื่อมต่อ
            </Notice>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {!home && (
              <label style={{ ...labelCol, flex: '1 1 320px', minWidth: 0, maxWidth: keyStep ? undefined : 640 }}>
                ลิงก์ Web app ของ Google Apps Script
                <input name="url" value={url} onChange={(ev) => setUrl(ev.target.value)} placeholder="https://script.google.com/macros/s/…/exec" className="fld" autoComplete="off" spellCheck={false} />
              </label>
            )}
            {keyStep && (
              <label style={{ ...labelCol, flex: '1 1 240px', minWidth: 0, maxWidth: home ? 420 : undefined }}>
                รหัสทีม
                <input name="key" type="password" placeholder="รหัสที่ตั้งไว้ในสคริปต์ (TEAM_KEY)" className="fld" autoComplete="off" autoFocus />
              </label>
            )}
            {keyStep ? (
              <button type="submit" disabled={t.status === 'connecting'} className="btn pri">{t.status === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ'}</button>
            ) : (
              // the next step shows once there is a link to check
              url.trim() && <button type="submit" disabled={busy === 'open'} className="btn pri">{busy === 'open' ? 'กำลังตรวจสอบ…' : 'ถัดไป'}</button>
            )}
          </div>
          <a href={CONFIG.teamGuideUrl} target="_blank" rel="noopener noreferrer" className="hv-tx" style={{ fontSize: 14, alignSelf: 'flex-start' }}>วิธีตั้งค่า Google Sheet ของทีม (ทำครั้งเดียว ประมาณ 5 นาที)</a>
          {more(
            <>
              <span>{about}</span>
              <span>
                {keyStep
                  ? 'ตอนเชื่อมต่อครั้งแรก ข้อมูลที่บันทึกในเครื่องนี้และยังไม่มีในชีตจะถูกส่งขึ้นไปด้วย ส่วนรายการที่ชีตมีอยู่แล้วจะใช้ค่าจากชีต'
                  : 'ถ้าทีมใช้บัญชีผู้ใช้ จะไปหน้าเข้าสู่ระบบ ถ้าใช้รหัสทีม จะให้ใส่รหัสทีม'}
              </span>
            </>,
          )}
        </form>
        {t.status === 'error' && t.msg && <Notice kind="error" role="alert">{t.msg}</Notice>}
      </section>
    );

  return (
    // a problem keeps it open (it needs the person's attention)
    <details id="team-sync" className="card upd-fold" open={bad || !!e.teamNeedKey || stuck || undefined}>
      <summary className="hv">
        <span className="upd-head" style={{ padding: '18px 22px' }}>
          <span className="upd-t">
            <span className="card-t">{title}</span>
            <span className="upd-status">{acct ? `เข้าสู่ระบบในชื่อ ${acct.name} (${ROLE_TH[acct.role]}) · ` : ''}ซิงก์ล่าสุด {t.last ? dtTh(t.last) : '—'} · รอส่ง {fmtN(e.teamPendingN)} รายการ</span>
          </span>
          {chip}
        </span>
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 22px 20px' }}>
        <span className="upd-line">
          <span><span className="t-muted">ซิงก์ล่าสุด</span> {t.last ? dtTh(t.last) : '—'}</span>
          <span><span className="t-muted">รอส่งขึ้นชีต</span> {fmtN(e.teamPendingN)} รายการ</span>
          <span title={cfg.url}><span className="t-muted">รหัสชีตของทีม</span> …{deploymentId(cfg.url)}</span>
        </span>
        {e.teamJoinUrl && e.teamJoinUrl !== cfg.url && !home && (
          <Notice kind="error" role="alert">
            ลิงก์เชิญที่เปิดมาชี้ไปชีตอื่น (…{deploymentId(e.teamJoinUrl)}) ไม่ใช่ชีตที่เชื่อมอยู่ (…{deploymentId(cfg.url)}) ถ้าหัวหน้าทีมย้ายชีตจริง ให้กด ยกเลิกการเชื่อมต่อ แล้วเชื่อมใหม่ด้วยลิงก์เชิญ (รายการที่ยังค้างส่งจะตามไปที่ลิงก์ใหม่)
          </Notice>
        )}
        {e.teamNote && !stuck && (
          <span className="note" role="status">
            <span>{e.teamNote}</span>
            <button
              onClick={() => {
                e.teamNote = '';
                e.emit();
              }}
              className="quiet"
            >
              ซ่อน
            </button>
          </span>
        )}
        {stuck && (
          <span className="note">
            <span className="t-warn">บัญชีดูอย่างเดียวส่งการแก้ไขไม่ได้ · รอส่ง {fmtN(e.teamPendingN)} รายการ</span>
            <button onClick={dropUnsent} disabled={!!busy} className="btn sm">ทิ้งรายการที่ส่งไม่ได้</button>
          </span>
        )}
        {t.status !== 'ok' && t.msg && (
          <Notice kind="error" role="alert">
            {t.msg} · ข้อมูลที่แก้ไว้ยังอยู่ในเครื่อง{e.teamNeedKey ? ' ใส่รหัสทีมใหม่ด้านล่างเพื่อส่งต่อ' : ' และจะส่งให้เองเมื่อเชื่อมต่อได้'}
            {e.auth === 'expired' && (
              <>
                {' '}
                <button onClick={() => set({ hideRelogin: false })} className="lnk" style={{ color: 'inherit', fontSize: 'inherit', fontWeight: 500 }}>
                  เข้าสู่ระบบ
                </button>
              </>
            )}
          </Notice>
        )}
        {e.teamNeedKey && !acct && (
          <form onSubmit={setKey} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={labelCol}>
              รหัสทีมใหม่ (หัวหน้าทีมเปลี่ยนรหัสแล้ว)
              <input type="password" value={newKey} onChange={(ev) => setNewKey(ev.target.value)} className="fld" autoComplete="off" />
            </label>
            <button type="submit" disabled={!!busy} className="btn pri">{busy === 'key' ? 'กำลังตรวจรหัส…' : 'ใช้รหัสใหม่'}</button>
          </form>
        )}
        {caps && caps.v === 3 && caps.mode === 'legacy' && (
          <span className="note">
            <span>สคริปต์รองรับบัญชีผู้ใช้แล้ว</span>
            <button onClick={enableAccounts} className="btn sm">เปิดใช้บัญชีผู้ใช้ (หัวหน้าทีม)</button>
          </span>
        )}
        {caps && caps.v === 2 && (
          <span className="t-meta" style={{ lineHeight: 1.6 }}>
            หัวหน้าทีม: อัปเดต Code.gs เพื่อเปิดระบบเข้าสู่ระบบด้วยรหัสผ่าน (<a href={CONFIG.teamGuideUrl} target="_blank" rel="noopener noreferrer" className="hv-tx">ดูคู่มือ</a>)
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => e.teamSync()} disabled={t.status === 'syncing' || !!busy || !!e.auth} className="btn sm">{t.status === 'syncing' ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้'}</button>
          {(!acct || acct.role === 'admin') && <button onClick={copy} className="btn sm">{copied ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์เชิญทีม'}</button>}
          {acct ? (
            <button onClick={() => set({ acctDlg: 'logout' })} className="quiet">ออกจากระบบ</button>
          ) : (
            !home && (
              <button onClick={disconnect} disabled={!!busy} className="quiet">
                {busy === 'leave' ? 'กำลังส่งรายการที่ค้าง…' : 'ยกเลิกการเชื่อมต่อ'}
              </button>
            )
          )}
        </div>
        {more(
          <>
            <span>{about}</span>
            <span>
              {acct
                ? (acct.role === 'admin'
                    ? (home ? 'ลิงก์เชิญคือที่อยู่ของเว็บนี้ เปิดแล้วจะเจอหน้าเข้าสู่ระบบของทีม' : 'ลิงก์เชิญจะพาเพื่อนไปหน้าเข้าสู่ระบบของทีมนี้') +
                      ' ส่งชื่อผู้ใช้และรหัสผ่านชั่วคราวให้แต่ละคนแยกกันทางแชตส่วนตัว (สร้างได้ที่ ผู้ใช้และสิทธิ์) · '
                    : '') + 'ถ้าสองคนแก้คนละช่องของรายการเดียวกัน จะเก็บไว้ทั้งสองค่า ถ้าแก้ช่องเดียวกัน จะใช้ค่าที่บันทึกถึงชีตทีหลัง'
                : (home ? 'ลิงก์เชิญคือที่อยู่ของเว็บนี้ ส่งรหัสทีมให้แยกต่างหาก' : 'ลิงก์เชิญจะพาเพื่อนมาที่หน้านี้พร้อมลิงก์ชีตใส่ไว้ให้ ส่งรหัสทีมให้แยกต่างหาก และบอก รหัสชีตของทีม ให้เพื่อนตรวจว่าลิงก์ถูกต้อง') +
                  ' · ถ้าสองคนแก้คนละช่องของรายการเดียวกัน จะเก็บไว้ทั้งสองค่า ถ้าแก้ช่องเดียวกัน จะใช้ค่าที่บันทึกถึงชีตทีหลัง รวมถึงค่าที่แก้ตอนออฟไลน์ ซึ่งจะส่งเมื่อกลับมาออนไลน์'}
            </span>
          </>,
        )}
      </div>
    </details>
  );
}

/** Small status chip for the top bar; renders nothing until a team sheet is connected. */
export function TeamChip({ onClick }: { onClick: () => void }) {
  const { engine: e, set } = useApp();
  useEngineVersion();
  if (!e.teamCfg) return null;
  const n = e.teamPendingN;
  if (e.auth === 'expired') {
    // the session ended: edits are queuing on this browser until the account signs in again
    const text = 'ต้องเข้าสู่ระบบ' + (n ? ` · ${fmtN(n)} รายการรอส่ง` : '');
    const red = TEAM_ST.error[1];
    return (
      <button className="tb-btn tb-chip-bad" onClick={() => set({ hideRelogin: false })} title={text} aria-label={'ข้อมูลทีม: ' + text + ' (เข้าสู่ระบบ)'}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: red, flex: 'none', boxShadow: `0 0 0 3px ${red}40` }} />
        <span className="tb-hide-sm">{text}</span>
        <span className="tb-show-sm">ต้องเข้าสู่ระบบ</span>
      </button>
    );
  }
  const t = e.team;
  const [label, dot] = TEAM_ST[t.status];
  const bad = t.status === 'error' || t.status === 'offline';
  const text = label + (t.status === 'ok' && t.last ? ' ' + hhmm(t.last) : '') + (bad && n ? ` · ${fmtN(n)} รายการยังไม่ถึงทีม` : '');
  return (
    <button className="tb-btn" onClick={onClick} title={t.msg || 'ข้อมูลทีม: ' + text} aria-label={'ข้อมูลทีม: ' + text}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flex: 'none', boxShadow: bad ? `0 0 0 3px ${dot}40` : undefined }} />
      <span className="tb-muted">ทีม</span>
      <span className="tb-hide-sm">{text}</span>
      {/* on a phone the label above is hidden: say it when edits are not reaching the team */}
      {bad && <span className="tb-show-sm">{t.status === 'error' ? 'ซิงก์ไม่ได้' : 'ออฟไลน์'}</span>}
    </button>
  );
}
