import { useState, type CSSProperties, type FormEvent } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CONFIG } from '../lib/constants';
import { dtTh, fmtN } from '../lib/format';
import type { TeamStatus } from '../lib/teamSync';
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
  const cfg = e.teamCfg, t = e.team;
  const [label, dot] = TEAM_ST[t.status];
  const btn: CSSProperties = { cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13.5 };
  const ghost: CSSProperties = { ...btn, background: '#fff', color: '#0A1A86', border: '1.5px solid #0A1A86' };

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

  return (
    <section id="team-sync" style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 260 }}>
          <span style={{ fontSize: 17, fontWeight: 500 }}>แชร์ข้อมูลทีม (ทุกเครื่องเห็นเหมือนกัน)</span>
          <span style={{ fontSize: 13.5, color: '#475069', fontWeight: 300, lineHeight: 1.65, textWrap: 'pretty' }}>
            เชื่อมกับ Google Sheet ของทีม แล้ว ดาว สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ เบอร์ที่แก้ รายชื่อทีม และผลตรวจข้อมูลซ้ำ จะซิงก์ระหว่างทุกเครื่องอัตโนมัติ ทันทีที่แก้ไข และดึงของคนอื่นทุก 30 วินาที
          </span>
        </div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', height: 32, padding: '0 12px', borderRadius: 999, background: '#F4F6FC', fontSize: 13, color: '#384155' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot }} />
          {cfg ? label : TEAM_ST.off[0]}
          {cfg && t.status === 'ok' && t.last ? ` ${hhmm(t.last)}` : ''}
        </span>
      </div>

      {!cfg && (
        <form onSubmit={connect} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {e.teamJoinUrl && <Notice kind="ok">คุณได้รับลิงก์เชิญเข้าทีม ใส่รหัสทีมที่ได้รับจากหัวหน้าทีมแล้วกด เชื่อมต่อ</Notice>}
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
              ['ชีตของทีม', cfg.url.replace(/^https:\/\/script\.google\.com\/macros\/s\//, '…/').slice(0, 40) + (cfg.url.length > 40 ? '…' : '')],
            ] as const).map(([k, v]) => (
              <div key={k} style={{ background: '#F4F6FC', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: '#475069' }}>{k}</span>
                <span style={{ fontSize: 14.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k === 'ชีตของทีม' ? cfg.url : undefined}>{v}</span>
              </div>
            ))}
          </div>
          {(t.status === 'error' || t.status === 'offline') && t.msg && <Notice kind="error">{t.msg} — ข้อมูลที่แก้ไว้ยังอยู่ในเครื่อง และจะส่งให้เองเมื่อเชื่อมต่อได้</Notice>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => e.teamSync()} disabled={t.status === 'syncing'} style={btn}>{t.status === 'syncing' ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้'}</button>
            <button onClick={copy} style={ghost}>{copied ? 'คัดลอกลิงก์แล้ว ✓' : 'คัดลอกลิงก์เชิญทีม'}</button>
            <button
              onClick={() => {
                if (window.confirm('ยกเลิกการเชื่อมต่อกับชีตของทีม? ข้อมูลในเครื่องนี้ยังอยู่ แต่จะไม่ซิงก์กับทีมแล้ว')) e.teamDisconnect();
              }}
              style={{ cursor: 'pointer', height: 40, padding: '0 10px', border: 0, background: 'transparent', color: '#475069', fontSize: 13.5, textDecoration: 'underline' }}
            >
              ยกเลิกการเชื่อมต่อ
            </button>
          </div>
          <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.6 }}>
            ลิงก์เชิญจะพาเพื่อนมาที่หน้านี้พร้อมลิงก์ชีตใส่ไว้ให้ ส่งรหัสทีมให้แยกต่างหาก · ถ้าสองคนแก้รายการเดียวกัน จะใช้ค่าที่บันทึกถึงชีตทีหลัง
          </span>
        </div>
      )}
      {!cfg && t.status === 'error' && t.msg && <Notice kind="error">{t.msg}</Notice>}
    </section>
  );
}

/** Small status chip for the header; renders nothing until a team sheet is connected. */
export function TeamChip({ onClick }: { onClick: () => void }) {
  const { engine: e } = useApp();
  useEngineVersion();
  if (!e.teamCfg) return null;
  const t = e.team;
  const [label, , dot] = TEAM_ST[t.status];
  return (
    <button onClick={onClick} title={t.msg || 'ข้อมูลทีม'} style={{ cursor: 'pointer', height: 38, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(185,200,255,.45)', background: 'rgba(4,10,60,.3)', color: '#fff', fontSize: 13.5, display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
      <span style={{ color: '#C9D4FF' }}>ทีม</span>
      <span>{label}{t.status === 'ok' && t.last ? ' ' + hhmm(t.last) : ''}</span>
    </button>
  );
}
