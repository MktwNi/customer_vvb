import { useState } from 'react';
import { useApp, useEngineVersion, type Tab } from '../state';
import { addMonths, fmtN, isoTh, todayISO } from '../lib/format';
import { TeamChip } from './TeamSync';

export const TABS: [Tab, string][] = [
  ['overview', 'ภาพรวม'], ['search', 'ค้นหา'], ['track', 'ติดตาม'], ['plan', 'แผนติดต่อ'],
  ['map', 'แผนที่'], ['dedup', 'ตรวจข้อมูลซ้ำ'], ['update', 'อัปเดตข้อมูล'], ['notes', 'หมายเหตุ'],
];

export function Header() {
  const { engine: e, ui, go, setRef } = useApp();
  useEngineVersion();
  const [dateOpen, setDateOpen] = useState(false);
  const ready = e.ready;
  const today = todayISO();

  let dataLine = 'กำลังโหลด…';
  const badges: Partial<Record<Tab, number>> = {};
  if (ready) {
    const srcLine = e.base.source === 'upload' ? `ไฟล์ที่อัปโหลด ${e.base.fileName || ''}` : 'ไฟล์ข้อมูลต้นฉบับของเว็บ';
    dataLine = `ข้อมูล ณ ${isoTh(e.base.asOf)} · ${srcLine} · ${fmtN(e.B.companies.length)} บริษัท · ${fmtN(e.B.certs.length)} ใบรับรอง CFO`;
    const mon = e.monCfg();
    badges.track = (mon.events || []).filter((x) => x.at > (mon.seenAt || '')).length;
    badges.plan = e.crm.tasks.filter((t) => !t.done && t.date <= today).length;
    badges.dedup = e.B.groups.filter((g) => g.state === 'pending').length;
  }

  const qd: [string, string | undefined][] = [
    ['วันนี้', today], ['วันที่ข้อมูล', ready ? e.base.asOf : undefined], ['+3 เดือน', addMonths(today, 3)], ['+6 เดือน', addMonths(today, 6)], ['+1 ปี', addMonths(today, 12)],
  ];
  const quick = qd.filter((x, i) => x[1] && qd.findIndex((y) => y[1] === x[1]) === i) as [string, string][];

  return (
    <header style={{ background: 'linear-gradient(135deg,#040A3C 0%,#0A1A86 55%,#1A3FE0 100%)', color: '#fff' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '18px 28px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: '#fff', color: '#0A1A86', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14 }}>GCC</span>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
              <span style={{ fontSize: 19, fontWeight: 500 }}>ฐานข้อมูลลูกค้า GCC</span>
              <span style={{ fontSize: 13, color: '#B9C8FF', fontWeight: 300 }}>{dataLine}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {ready && <TeamChip onClick={() => go('update')} />}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setDateOpen(!dateOpen)} aria-expanded={dateOpen} style={{ cursor: 'pointer', height: 38, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(185,200,255,.45)', background: 'rgba(4,10,60,.3)', color: '#fff', fontSize: 13.5, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: '#C9D4FF' }}>สถานะ ณ</span>
              <span style={{ fontWeight: 500 }}>{isoTh(e.ref)}</span>
              <span style={{ color: '#C9D4FF' }}>· ใกล้หมด ≤ {e.win} วัน ▾</span>
            </button>
            {dateOpen && (
              <div style={{ position: 'absolute', top: 46, right: 0, zIndex: 30, background: '#fff', color: '#0E1430', borderRadius: 18, padding: 18, boxShadow: '0 24px 60px -16px rgba(4,10,60,.5)', display: 'flex', flexDirection: 'column', gap: 14, width: 'min(340px,86vw)' }}>
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
        </div>
        <nav style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {TABS.map(([k, label]) => {
            const on = ready && ui.tab === k;
            const b = badges[k] || 0;
            return (
              <button key={k} onClick={() => ready && go(k)} style={{ cursor: 'pointer', border: 0, padding: '11px 16px', borderRadius: '14px 14px 0 0', fontSize: 14.5, fontWeight: on ? 500 : 400, background: on ? '#F4F6FC' : 'transparent', color: on ? '#0A1A86' : '#C9D4FF', display: 'flex', gap: 7, alignItems: 'center' }}>
                {label}
                {b > 0 && (
                  <span style={{ fontSize: 11, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: on ? '#0A1A86' : '#fff', color: on ? '#fff' : '#0A1A86', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fmtN(b)}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export function Banners() {
  const { engine: e, go, setRef } = useApp();
  useEngineVersion();
  const today = todayISO();
  const wrap = { maxWidth: 1400, width: '100%', margin: '16px auto 0', padding: '0 28px' } as const;
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
