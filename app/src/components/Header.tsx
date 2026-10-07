import { useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { addMonths, fmtN, isoTh, todayISO } from '../lib/format';
import { TeamChip } from './TeamSync';
import { Icon } from './icons';
import { TABS, useDataLine } from './Sidebar';

/** Top bar of the content area: page name + data line, team status and the reference-date picker. */
export function TopBar({ navOpen, onMenu }: { navOpen: boolean; onMenu: () => void }) {
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
      <button id="menu-btn" className="menu-btn" onClick={onMenu} aria-label="เปิดเมนู" aria-expanded={navOpen} aria-controls="side-nav">
        <Icon name="menu" />
      </button>
      <div className="tb-title">
        <span className="tb-h">{ready ? title : 'ฐานข้อมูลลูกค้า GCC'}</span>
        <span className="tb-sub" title={dataLine}>{dataLine}</span>
      </div>
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
                <input type="date" value={e.ref} onChange={(ev) => ev.target.value && setRef(ev.target.value)} style={{ height: 42, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14, color: '#0E1430' }} />
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {quick.map(([label, v]) => {
                  const on = e.ref === v;
                  return (
                    <button key={label} onClick={() => setRef(v)} style={{ cursor: 'pointer', height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5, border: `1.5px solid ${on ? '#0A1A86' : '#D5DBEA'}`, background: on ? '#0A1A86' : '#fff', color: on ? '#fff' : '#0E1430' }}>{label}</button>
                  );
                })}
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: '#475069' }}>
                ช่วง "ใกล้หมดอายุ"
                <select value={String(e.win)} onChange={(ev) => setRef(null, +ev.target.value)} style={{ height: 42, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14, background: '#fff', color: '#0E1430' }}>
                  {[30, 60, 90, 180].map((n) => <option key={n} value={n}>{n} วัน</option>)}
                </select>
              </label>
              <span style={{ fontSize: 12.5, color: '#5E6680', lineHeight: 1.55, textWrap: 'pretty' }}>ใช้ดูล่วงหน้าหรือย้อนหลัง สถานะ กลุ่มเป้าหมาย และรอบ อบก. จะคำนวณใหม่ทั้งเว็บ</span>
              <button onClick={() => setDateOpen(false)} style={{ cursor: 'pointer', alignSelf: 'flex-end', height: 34, padding: '0 16px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13 }}>เสร็จ</button>
            </div>
          )}
        </div>
      </div>
    </header>
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
            <button onClick={() => setRef(today)} style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: 0, background: '#6B4100', color: '#fff', fontSize: 13 }}>กลับไปวันนี้</button>
          </div>
        </div>
      )}
      {ev && (
        <div style={wrap}>
          <div style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 16, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E8A23B', flex: 'none' }} />
            <span style={{ fontSize: 13.5, flex: 1, minWidth: 240, textWrap: 'pretty' }}>{ev.text}</span>
            <button onClick={() => go('track')} style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13 }}>ดูเหตุการณ์</button>
            <button onClick={() => e.ackEvents()} style={{ cursor: 'pointer', height: 34, padding: '0 10px', border: 0, background: 'transparent', color: '#475069', fontSize: 13, textDecoration: 'underline' }}>รับทราบ</button>
          </div>
        </div>
      )}
    </>
  );
}
