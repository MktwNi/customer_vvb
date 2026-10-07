import { useState, type CSSProperties, type FormEvent } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CONFIG } from '../lib/constants';
import { dtTh, fmtN } from '../lib/format';
import { deploymentId, type TeamStatus } from '../lib/teamSync';
import { Notice, card, inputStyle, labelCol } from './ui';

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
  const { engine: e } = useApp();
  useEngineVersion();
  const [copied, setCopied] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState<'' | 'key' | 'leave'>('');
  const cfg = e.teamCfg, t = e.team;
  const [label, dot] = TEAM_ST[t.status];
  const btn: CSSProperties = { cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13.5 };
  const ghost: CSSProperties = { ...btn, background: '#fff', color: '#1F5BD8', border: '1.5px solid #1F5BD8' };

  const connect = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    await e.teamConnect(String(fd.get('url') || ''), String(fd.get('key') || ''));
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
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot }} />
          {cfg ? label : TEAM_ST.off[0]}
          {cfg && t.status === 'ok' && t.last ? ` ${hhmm(t.last)}` : ''}
        </span>
      </div>

      {!cfg && (
        <form onSubmit={connect} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {e.teamJoinUrl && (
            <Notice kind="ok">
              คุณได้รับลิงก์เชิญเข้าทีม (ชีตรหัส …{deploymentId(e.teamJoinUrl)}) ตรวจกับหัวหน้าทีมว่าตรงกัน แล้วใส่รหัสทีมและกด เชื่อมต่อ
            </Notice>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 10 }}>
            <label style={labelCol}>
              ลิงก์ Web app ของ Google Apps Script
              <input name="url" defaultValue={e.teamJoinUrl} key={e.teamJoinUrl} placeholder="https://script.google.com/macros/s/…/exec" style={inputStyle} autoComplete="off" />
            </label>
            <label style={labelCol}>
              รหัสทีม
              <input name="key" type="password" placeholder="รหัสที่ตั้งไว้ในสคริปต์ (TEAM_KEY)" style={inputStyle} autoComplete="off" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" disabled={t.status === 'connecting'} style={btn}>{t.status === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ'}</button>
            <a href={CONFIG.teamGuideUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5 }}>วิธีตั้งค่า Google Sheet ของทีม (ทำครั้งเดียว ประมาณ 5 นาที)</a>
          </div>
          <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.6 }}>
            ตอนเชื่อมต่อครั้งแรก ข้อมูลที่บันทึกในเครื่องนี้และยังไม่มีในชีตจะถูกส่งขึ้นไปด้วย ส่วนรายการที่ชีตมีอยู่แล้วจะใช้ค่าจากชีต
          </span>
        </form>
      )}

      {cfg && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          {t.status !== 'ok' && t.msg && (
            <Notice kind="error" role="alert">{t.msg} — ข้อมูลที่แก้ไว้ยังอยู่ในเครื่อง{e.teamNeedKey ? ' ใส่รหัสทีมใหม่ด้านล่างเพื่อส่งต่อ' : ' และจะส่งให้เองเมื่อเชื่อมต่อได้'}</Notice>
          )}
          {e.teamNeedKey && (
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => e.teamSync()} disabled={t.status === 'syncing' || !!busy} style={btn}>{t.status === 'syncing' ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้'}</button>
            <button onClick={copy} style={ghost}>{copied ? 'คัดลอกลิงก์แล้ว ✓' : 'คัดลอกลิงก์เชิญทีม'}</button>
            <button
              onClick={disconnect}
              disabled={!!busy}
              style={{ cursor: 'pointer', height: 40, padding: '0 10px', border: 0, background: 'transparent', color: '#475069', fontSize: 13.5, textDecoration: 'underline' }}
            >
              {busy === 'leave' ? 'กำลังส่งรายการที่ค้าง…' : 'ยกเลิกการเชื่อมต่อ'}
            </button>
          </div>
          <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.6 }}>
            ลิงก์เชิญจะพาเพื่อนมาที่หน้านี้พร้อมลิงก์ชีตใส่ไว้ให้ ส่งรหัสทีมให้แยกต่างหาก และบอก รหัสชีตของทีม ด้านบนให้เพื่อนตรวจว่าลิงก์ถูกต้อง · ถ้าสองคนแก้คนละช่องของรายการเดียวกัน (เช่น คนหนึ่งแก้เบอร์ อีกคนแก้อีเมล) จะเก็บไว้ทั้งสองค่า ถ้าแก้ช่องเดียวกัน จะใช้ค่าที่บันทึกถึงชีตทีหลัง — รวมถึงค่าที่แก้ตอนออฟไลน์ ซึ่งจะส่งเมื่อกลับมาออนไลน์
          </span>
        </div>
      )}
      {!cfg && t.status === 'error' && t.msg && <Notice kind="error" role="alert">{t.msg}</Notice>}
    </section>
  );
}

/** Small status chip for the top bar; renders nothing until a team sheet is connected. */
export function TeamChip({ onClick }: { onClick: () => void }) {
  const { engine: e } = useApp();
  useEngineVersion();
  if (!e.teamCfg) return null;
  const t = e.team;
  const [label, dot] = TEAM_ST[t.status];
  const n = e.teamPendingN;
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
