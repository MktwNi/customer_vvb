import { useState, type CSSProperties, type FormEvent } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CONFIG } from '../lib/constants';
import { dtTh, fmtN } from '../lib/format';
import { ROLE_TH } from '../lib/auth';
import { deploymentId, type TeamStatus } from '../lib/teamSync';
import { Notice, card, inputStyle, labelCol } from './ui';
import { Icon } from './icons';

/** [label, dot colour on white, dot colour on the dark header] */
export const TEAM_ST: Record<TeamStatus, [string, string, string]> = {
  off: ['ยังไม่เชื่อมต่อ', '#A8B0C8', '#A8B0C8'],
  connecting: ['กำลังเชื่อมต่อ…', '#E8A23B', '#F2B84B'],
  syncing: ['กำลังซิงก์…', '#E8A23B', '#F2B84B'],
  ok: ['ซิงก์แล้ว', '#0E8A9A', '#34D1C4'],
  error: ['ซิงก์ไม่สำเร็จ', '#A33A1A', '#FF9E8A'],
  offline: ['ออฟไลน์', '#5E6680', '#C9D4FF'],
};
const hhmm = (iso: string) => (iso ? dtTh(iso).split(' ').slice(-2).join(' ') : '');

export function inviteLink(url: string) {
  return `${location.origin}${location.pathname}#team=${encodeURIComponent(url)}`;
}

export function TeamSyncCard() {
  const { engine: e, set } = useApp();
  useEngineVersion();
  const [copied, setCopied] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState<'' | 'key' | 'leave' | 'open'>('');
  const [url, setUrl] = useState(e.teamJoinUrl);
  const [joinSeen, setJoinSeen] = useState(e.teamJoinUrl);
  // an invite link opened while this page is showing fills the link in
  if (e.teamJoinUrl !== joinSeen) {
    setJoinSeen(e.teamJoinUrl);
    if (e.teamJoinUrl) setUrl(e.teamJoinUrl);
  }
  const cfg = e.teamCfg, t = e.team;
  const acct = cfg?.mode === 'accounts' && e.session ? e.session : null;
  const [label, dot] = TEAM_ST[t.status];
  const btn: CSSProperties = { cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13.5 };
  const ghost: CSSProperties = { ...btn, background: '#fff', color: '#1F5BD8', border: '1.5px solid #1F5BD8' };
  const plain: CSSProperties = { cursor: 'pointer', height: 40, padding: '0 10px', border: 0, background: 'transparent', color: '#475069', fontSize: 13.5, textDecoration: 'underline' };
  // step 2 of connecting (the team code) once the link turned out to be a team-code team
  const keyStep = !!e.teamJoinUrl && url.trim() === e.teamJoinUrl;

  const next = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (keyStep) {
      await e.teamConnect(url, String(new FormData(ev.currentTarget).get('key') || ''));
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
      await navigator.clipboard.writeText(inviteLink(cfg.url));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('คัดลอกลิงก์นี้ส่งให้ทีม', inviteLink(cfg.url));
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

  return (
    <section id="team-sync" style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 260 }}>
          <span style={{ fontSize: 17, fontWeight: 500 }}>แชร์ข้อมูลทีม (ทุกเครื่องเห็นเหมือนกัน)</span>
          <span style={{ fontSize: 13.5, color: '#475069', fontWeight: 300, lineHeight: 1.65, textWrap: 'pretty' }}>
            เชื่อมกับ Google Sheet ของทีม แล้ว ดาว สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ เบอร์ที่แก้ รายชื่อทีม และผลตรวจข้อมูลซ้ำ จะซิงก์ระหว่างทุกเครื่องอัตโนมัติ ทันทีที่แก้ไข และดึงของคนอื่นทุก 30 วินาที
          </span>
        </div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', height: 32, padding: '0 12px', borderRadius: 999, background: '#F6F8FE', fontSize: 13, color: '#384155' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: e.auth === 'expired' ? TEAM_ST.error[1] : dot }} />
          {!cfg ? TEAM_ST.off[0] : e.auth === 'expired' ? 'ต้องเข้าสู่ระบบ' : label}
          {cfg && !e.auth && t.status === 'ok' && t.last ? ` ${hhmm(t.last)}` : ''}
        </span>
      </div>

      {!cfg && (
        <form onSubmit={next} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {e.teamJoinUrl && (
            <Notice kind="ok">
              คุณได้รับลิงก์เชิญเข้าทีม (ชีตรหัส …{deploymentId(e.teamJoinUrl)}) ตรวจกับหัวหน้าทีมว่าตรงกัน แล้วใส่รหัสทีมและกด เชื่อมต่อ
            </Notice>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ ...labelCol, flex: '1 1 320px', minWidth: 0, maxWidth: keyStep ? undefined : 640 }}>
              ลิงก์ Web app ของ Google Apps Script
              <input name="url" value={url} onChange={(ev) => setUrl(ev.target.value)} placeholder="https://script.google.com/macros/s/…/exec" style={inputStyle} autoComplete="off" spellCheck={false} />
            </label>
            {keyStep && (
              <label style={{ ...labelCol, flex: '1 1 240px', minWidth: 0 }}>
                รหัสทีม
                <input name="key" type="password" placeholder="รหัสที่ตั้งไว้ในสคริปต์ (TEAM_KEY)" style={inputStyle} autoComplete="off" autoFocus />
              </label>
            )}
            {keyStep ? (
              <button type="submit" disabled={t.status === 'connecting'} style={btn}>{t.status === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ'}</button>
            ) : (
              <button type="submit" disabled={busy === 'open' || !url.trim()} style={{ ...btn, opacity: url.trim() ? 1 : 0.6 }}>{busy === 'open' ? 'กำลังตรวจสอบ…' : 'ถัดไป'}</button>
            )}
          </div>
          <a href={CONFIG.teamGuideUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, alignSelf: 'flex-start' }}>วิธีตั้งค่า Google Sheet ของทีม (ทำครั้งเดียว ประมาณ 5 นาที)</a>
          <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.6 }}>
            {keyStep
              ? 'ตอนเชื่อมต่อครั้งแรก ข้อมูลที่บันทึกในเครื่องนี้และยังไม่มีในชีตจะถูกส่งขึ้นไปด้วย ส่วนรายการที่ชีตมีอยู่แล้วจะใช้ค่าจากชีต'
              : 'วางลิงก์ที่หัวหน้าทีมส่งให้ แล้วกด ถัดไป ถ้าทีมใช้บัญชีผู้ใช้ จะไปหน้าเข้าสู่ระบบ ถ้าใช้รหัสทีม จะให้ใส่รหัสทีม'}
          </span>
        </form>
      )}

      {cfg && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {acct && (
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
              <span style={{ color: '#0B6E66', display: 'inline-flex' }}><Icon name="check" size={18} /></span>
              <span>เชื่อมต่อแล้ว · เข้าสู่ระบบในชื่อ <b style={{ fontWeight: 500 }}>{acct.name}</b> ({ROLE_TH[acct.role]})</span>
            </span>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8 }}>
            {([
              ['ซิงก์ล่าสุด', t.last ? dtTh(t.last) : '—'],
              ['รอส่งขึ้นชีต', fmtN(e.teamPendingN) + ' รายการ'],
              ['รหัสชีตของทีม', '…' + deploymentId(cfg.url)],
            ] as const).map(([k, v]) => (
              <div key={k} style={{ background: '#F6F8FE', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: '#475069' }}>{k}</span>
                <span style={{ fontSize: 14.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k === 'รหัสชีตของทีม' ? cfg.url : undefined}>{v}</span>
              </div>
            ))}
          </div>
          {e.teamJoinUrl && e.teamJoinUrl !== cfg.url && (
            <Notice kind="error" role="alert">
              ลิงก์เชิญที่เปิดมาชี้ไปชีตอื่น (…{deploymentId(e.teamJoinUrl)}) ไม่ใช่ชีตที่เชื่อมอยู่ (…{deploymentId(cfg.url)}) ถ้าหัวหน้าทีมย้ายชีตจริง ให้กด ยกเลิกการเชื่อมต่อ แล้วเชื่อมใหม่ด้วยลิงก์เชิญ (รายการที่ยังค้างส่งจะตามไปที่ลิงก์ใหม่)
            </Notice>
          )}
          {e.teamNote && !stuck && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Notice kind="info" role="status">{e.teamNote}</Notice>
              </div>
              <button
                onClick={() => {
                  e.teamNote = '';
                  e.emit();
                }}
                aria-label="ปิดข้อความ"
                title="ปิดข้อความ"
                style={{ cursor: 'pointer', flex: 'none', width: 34, height: 34, marginTop: 6, borderRadius: '50%', border: 0, background: '#F6F8FE', color: '#475069', fontSize: 18 }}
              >
                ×
              </button>
            </div>
          )}
          {stuck && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#FFF4DC', borderRadius: 14, padding: '10px 14px' }}>
              <span style={{ flex: 1, minWidth: 220, fontSize: 13.5, color: '#6B4100', lineHeight: 1.6 }}>บัญชีดูอย่างเดียวส่งการแก้ไขไม่ได้ · รอส่ง {fmtN(e.teamPendingN)} รายการ</span>
              <button onClick={dropUnsent} disabled={!!busy} style={{ ...ghost, borderColor: '#6B4100', color: '#6B4100' }}>ทิ้งรายการที่ส่งไม่ได้</button>
            </div>
          )}
          {t.status !== 'ok' && t.msg && (
            <Notice kind="error" role="alert">
              {t.msg} — ข้อมูลที่แก้ไว้ยังอยู่ในเครื่อง{e.teamNeedKey ? ' ใส่รหัสทีมใหม่ด้านล่างเพื่อส่งต่อ' : ' และจะส่งให้เองเมื่อเชื่อมต่อได้'}
              {e.auth === 'expired' && (
                <>
                  {' '}
                  <button onClick={() => set({ hideRelogin: false })} style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0, color: 'inherit', font: 'inherit', fontWeight: 500, textDecoration: 'underline' }}>
                    เข้าสู่ระบบ
                  </button>
                </>
              )}
            </Notice>
          )}
          {e.teamNeedKey && !acct && (
            <form
              onSubmit={setKey}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
            >
              <label style={labelCol}>
                รหัสทีมใหม่ (หัวหน้าทีมเปลี่ยนรหัสแล้ว)
                <input type="password" value={newKey} onChange={(ev) => setNewKey(ev.target.value)} style={inputStyle} autoComplete="off" />
              </label>
              <button type="submit" disabled={!!busy} style={btn}>{busy === 'key' ? 'กำลังตรวจรหัส…' : 'ใช้รหัสใหม่'}</button>
            </form>
          )}
          {caps && caps.v === 3 && caps.mode === 'legacy' && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: 'var(--brand-soft)', borderRadius: 14, padding: '12px 14px' }}>
              <span style={{ color: 'var(--brand-deep)', display: 'inline-flex' }}><Icon name="shield" size={22} /></span>
              <span style={{ flex: 1, minWidth: 220, fontSize: 13.5, color: 'var(--brand-deep)', lineHeight: 1.6 }}>สคริปต์รองรับบัญชีผู้ใช้แล้ว</span>
              <button onClick={enableAccounts} style={btn}>เปิดใช้บัญชีผู้ใช้ (หัวหน้าทีม)</button>
            </div>
          )}
          {caps && caps.v === 2 && (
            <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.6 }}>
              หัวหน้าทีม: อัปเดต Code.gs เพื่อเปิดระบบเข้าสู่ระบบด้วยรหัสผ่าน (<a href={CONFIG.teamGuideUrl} target="_blank" rel="noopener noreferrer">ดูคู่มือ</a>)
            </span>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => e.teamSync()} disabled={t.status === 'syncing' || !!busy || !!e.auth} style={btn}>{t.status === 'syncing' ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้'}</button>
            {(!acct || acct.role === 'admin') && <button onClick={copy} style={ghost}>{copied ? 'คัดลอกลิงก์แล้ว ✓' : 'คัดลอกลิงก์เชิญทีม'}</button>}
            {acct ? (
              <button onClick={() => set({ acctDlg: 'logout' })} style={plain}>
                ออกจากระบบ
              </button>
            ) : (
              <button onClick={disconnect} disabled={!!busy} style={plain}>
                {busy === 'leave' ? 'กำลังส่งรายการที่ค้าง…' : 'ยกเลิกการเชื่อมต่อ'}
              </button>
            )}
          </div>
          <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.6 }}>
            {acct
              ? (acct.role === 'admin' ? 'ลิงก์เชิญจะพาเพื่อนไปหน้าเข้าสู่ระบบของทีมนี้ ส่งชื่อผู้ใช้และรหัสผ่านชั่วคราวให้แต่ละคนแยกกันทางแชตส่วนตัว (สร้างได้ที่ ผู้ใช้และสิทธิ์) · ' : '') +
                'ถ้าสองคนแก้คนละช่องของรายการเดียวกัน จะเก็บไว้ทั้งสองค่า ถ้าแก้ช่องเดียวกัน จะใช้ค่าที่บันทึกถึงชีตทีหลัง'
              : 'ลิงก์เชิญจะพาเพื่อนมาที่หน้านี้พร้อมลิงก์ชีตใส่ไว้ให้ ส่งรหัสทีมให้แยกต่างหาก และบอก รหัสชีตของทีม ด้านบนให้เพื่อนตรวจว่าลิงก์ถูกต้อง · ถ้าสองคนแก้คนละช่องของรายการเดียวกัน (เช่น คนหนึ่งแก้เบอร์ อีกคนแก้อีเมล) จะเก็บไว้ทั้งสองค่า ถ้าแก้ช่องเดียวกัน จะใช้ค่าที่บันทึกถึงชีตทีหลัง — รวมถึงค่าที่แก้ตอนออฟไลน์ ซึ่งจะส่งเมื่อกลับมาออนไลน์'}
          </span>
        </div>
      )}
      {!cfg && t.status === 'error' && t.msg && <Notice kind="error" role="alert">{t.msg}</Notice>}
    </section>
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
        <span className="tb-hide-sm" style={{ fontWeight: 500 }}>{text}</span>
        <span className="tb-show-sm" style={{ fontWeight: 600 }}>ต้องเข้าสู่ระบบ</span>
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
      {bad && <span className="tb-show-sm" style={{ fontWeight: 600 }}>{t.status === 'error' ? 'ซิงก์ไม่ได้' : 'ออฟไลน์'}</span>}
    </button>
  );
}
