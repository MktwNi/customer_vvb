import type { CSSProperties, FormEvent } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dtTh, fmtN, isoTh } from '../lib/format';
import type { SyncCfg } from '../lib/types';
import { Notice, Opts, PageHead, card, inputStyle, labelCol, selectStyle } from '../components/ui';
import { TeamSyncCard } from '../components/TeamSync';

const section: CSSProperties = { ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 };
const intro: CSSProperties = { fontSize: 13.5, color: '#475069', fontWeight: 300, lineHeight: 1.65, textWrap: 'pretty' };
const box: CSSProperties = { background: '#F4F6FC', borderRadius: 12, display: 'flex', flexDirection: 'column' };

export function Update() {
  const { engine: e } = useApp();
  useEngineVersion();
  const C = e.crm;
  const u = e.up, y = e.sy, st = e.pendingSync, sc = e.syncCfg(), mon = e.monCfg();
  const me = e.me();
  const ownN: Record<string, number> = {};
  Object.values(C.owners).forEach((v) => (ownN[v] = (ownN[v] || 0) + 1));
  const srcLine = e.base.source === 'upload' ? `ไฟล์ที่อัปโหลด ${e.base.fileName || ''}` : 'ไฟล์ข้อมูลต้นฉบับของเว็บ';
  const dataLine = `ข้อมูล ณ ${isoTh(e.base.asOf)} · ${srcLine} · ${fmtN(e.B.companies.length)} บริษัท · ${fmtN(e.B.certs.length)} ใบรับรอง CFO`;
  const addTeam = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    e.addTeam(String(new FormData(f).get('name') || '').trim());
    f.reset();
  };
  const stats: [string, number][] = [
    ['บริษัทที่มีผู้รับผิดชอบ', Object.keys(C.owners).length],
    ['สถานะการขาย (ไม่ใช่ยังไม่ติดต่อ)', Object.values(C.stages).filter((v) => v && v !== 'none').length],
    ['นัดทั้งหมด', C.tasks.length],
    ['บันทึกการติดต่อ', Object.values(C.log).reduce((n, a) => n + a.length, 0)],
    ['ติดดาว', C.watch.length],
  ];
  const syncBoxes: [string, string][] = [
    ['ซิงก์ล่าสุด', sc.last ? dtTh(sc.last) : 'ยังไม่เคยซิงก์'],
    ['ผลล่าสุด', sc.lastMsg || '—'],
    ['บนเว็บไซต์ TGO', sc.total ? fmtN(sc.total) + ' รายการ' : '—'],
    ['ใบรับรองที่ดึงเพิ่มไว้', fmtN(e.tgoCerts.length) + ' ใบ'],
  ];

  return (
    <>
      <PageHead title="อัปเดตข้อมูล" sub={dataLine} />
      <TeamSyncCard />
      <section style={section}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 260 }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>อัปโหลดฐานข้อมูลลูกค้าฉบับใหม่</span>
            <span style={intro}>ไฟล์ Excel รูปแบบเดียวกับ ฐานข้อมูลลูกค้า_GCC (ชีต ทะเบียนบริษัท, TGO_CFO, GI, กรอ., SET) ระบบจะแทนข้อมูลบริษัททั้งหมด ส่วนที่เก็บในเครื่อง (ดาว สถานะการขาย โน้ต นัด ข้อมูลติดต่อที่แก้ไข การตัดสินข้อมูลซ้ำ) ยังอยู่ครบ</span>
          </div>
          <label style={{ cursor: 'pointer', height: 44, padding: '0 20px', borderRadius: 999, background: '#0A1A86', color: '#fff', fontSize: 14.5, display: 'flex', alignItems: 'center' }}>
            เลือกไฟล์ .xlsx
            <input type="file" accept=".xlsx" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) e.onFile(f); }} style={{ display: 'none' }} />
          </label>
        </div>
        {u.status === 'busy' && <span style={{ fontSize: 13.5, color: '#1A3FE0' }}>{u.msg}</span>}
        {u.status === 'error' && <Notice kind="error">{u.msg}</Notice>}
        {u.status === 'done' && <Notice kind="ok">{u.msg}</Notice>}
        {u.status === 'preview' && (
          <div style={{ background: '#F4F6FC', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{u.head}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
              {(u.preview || []).map((b) => (
                <div key={b.k} style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 12, color: '#475069' }}>{b.k}</span>
                  <span style={{ fontSize: 20, fontWeight: 500 }}>{b.v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => e.applyUpload()} style={{ cursor: 'pointer', height: 38, padding: '0 16px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13.5 }}>ใช้ข้อมูลชุดนี้</button>
              <button onClick={() => e.cancelUpload()} style={{ cursor: 'pointer', height: 38, padding: '0 12px', border: 0, background: 'transparent', color: '#475069', fontSize: 13.5, textDecoration: 'underline' }}>ยกเลิก</button>
            </div>
          </div>
        )}
        {e.base.source === 'upload' && <button onClick={() => e.revertUpload()} style={{ cursor: 'pointer', alignSelf: 'flex-start', border: 0, background: 'transparent', color: '#1A3FE0', fontSize: 13.5, textDecoration: 'underline', padding: 0 }}>กลับไปใช้ไฟล์ข้อมูลต้นฉบับของเว็บ</button>}
      </section>

      <section style={section}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 260 }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>ดึงใบรับรอง CFO ใหม่จากเว็บไซต์ TGO</span>
            <span style={intro}>อ่านหน้า "รายชื่อบริษัทและองค์กรที่ขอการรับรอง" ของ อบก. ใบรับรองใหม่จะผูกกับบริษัทที่ชื่อตรงกัน ถ้าไม่พบจะสร้างบริษัทใหม่ (แหล่ง TGO) ทำงานเมื่อถึงรอบหรือเมื่อกดปุ่ม</span>
          </div>
          <button onClick={() => e.runSync(false)} disabled={y.status === 'running'} style={{ cursor: 'pointer', height: 44, padding: '0 20px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 14.5 }}>{y.status === 'running' ? 'กำลังดึงข้อมูล…' : 'ดึงข้อมูลล่าสุดตอนนี้'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8 }}>
          {syncBoxes.map(([k, v]) => (
            <div key={k} style={{ ...box, padding: '12px 14px', gap: 3 }}>
              <span style={{ fontSize: 12, color: '#475069' }}>{k}</span>
              <span style={{ fontSize: 14.5, fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={labelCol}>
            รอบอัปเดตอัตโนมัติ
            <select value={sc.freq} onChange={(ev) => e.saveSync({ freq: ev.target.value as SyncCfg['freq'] })} style={{ ...selectStyle, padding: '0 12px' }}>
              <Opts options={[{ v: 'open', label: 'ทุกครั้งที่เปิดเว็บ' }, { v: 'daily', label: 'วันละครั้ง' }, { v: 'weekly', label: 'สัปดาห์ละครั้ง' }, { v: 'off', label: 'ปิด (กดเองเท่านั้น)' }]} />
            </select>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', height: 40, fontSize: 13.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!sc.autoApply} onChange={(ev) => e.saveSync({ autoApply: ev.target.checked })} style={{ width: 18, height: 18 }} />
            เมื่อถึงรอบ ให้อัปเดตทันทีโดยไม่ต้องยืนยัน
          </label>
        </div>
        <details style={{ fontSize: 13, color: '#475069' }}>
          <summary style={{ cursor: 'pointer' }}>ตั้งค่าขั้นสูง: Proxy</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10 }}>
            <span style={{ lineHeight: 1.6 }}>ใช้ {'{u}'} แทนตำแหน่ง URL · ตัวอย่างสำหรับ Cloudflare Worker อยู่ที่ project/tools/tgo-proxy-worker.js</span>
            <input defaultValue={sc.proxy} onBlur={(ev) => e.saveSync({ proxy: ev.target.value.trim() })} placeholder="https://tgo-proxy.example.workers.dev/?url={u}" style={{ ...inputStyle, maxWidth: 560 }} />
          </div>
        </details>
        {y.status === 'running' && <span style={{ fontSize: 13.5, color: '#1A3FE0' }}>{y.msg}</span>}
        {y.status === 'error' && <Notice kind="error">{y.msg}</Notice>}
        {y.status === 'done' && <Notice kind="ok">{y.msg}</Notice>}
        {y.status === 'ready' && st && (
          <div style={{ background: '#F4F6FC', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{`พบใบรับรองใหม่ ${fmtN(st.nw.length)} ใบ จาก ${fmtN(st.items.length)} รายการล่าสุด (ผ่าน ${st.via})`}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflow: 'auto' }}>
              {st.nw.slice(0, 60).map((it, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 10, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 500, padding: '2px 8px', borderRadius: 999, background: it.gid ? '#E6ECFD' : '#DDF5F1', color: it.gid ? '#1A2FB0' : '#0B6E66' }}>{it.gid ? 'ผูกกับบริษัทเดิม' : 'บริษัทใหม่'}</span>
                  <span style={{ fontSize: 13.5 }}>{it.org}</span>
                  <span style={{ fontSize: 12.5, color: '#475069' }}>{`${it.cert} · ${it.prov} · อนุมัติ ${it.apBE}`}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => e.applySync(false)} style={{ cursor: 'pointer', height: 38, padding: '0 16px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13.5 }}>อัปเดตเข้าระบบ</button>
              <button onClick={() => e.cancelSync()} style={{ cursor: 'pointer', height: 38, padding: '0 12px', border: 0, background: 'transparent', color: '#475069', fontSize: 13.5, textDecoration: 'underline' }}>ยกเลิก</button>
            </div>
          </div>
        )}
      </section>

      <section style={section}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 17, fontWeight: 500 }}>ทีมขายและข้อมูลที่บันทึก</span>
          <span style={intro}>{e.teamCfg
            ? 'ดาว สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ ข้อมูลติดต่อที่แก้ และผลตรวจข้อมูลซ้ำ แชร์กับทีมผ่าน Google Sheet แล้ว ส่วน "ฉันคือ" ตั้งแยกในแต่ละเครื่อง ไฟล์สำรองยังส่งออก/นำเข้าได้ (นำเข้าจะรวมกับข้อมูลเดิมและแชร์ให้ทีมด้วย)'
            : 'ดาว สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ ข้อมูลติดต่อที่แก้ และผลตรวจข้อมูลซ้ำ เก็บอยู่ในเบราว์เซอร์เครื่องนี้ ส่งออกเป็นไฟล์สำรองเพื่อเก็บไว้หรือส่งให้เพื่อนร่วมทีมนำเข้า (รวมกับข้อมูลเดิม ไม่ลบของใคร) หรือเชื่อม Google Sheet ด้านบนเพื่อให้ทุกเครื่องเห็นเหมือนกัน'}</span>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={labelCol}>
            ฉันคือ
            <select value={me} onChange={(ev) => e.setMe(ev.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
              <Opts all="ยังไม่เลือก" options={C.team.map((v) => ({ v, label: v }))} />
            </select>
          </label>
          <form onSubmit={addTeam} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label style={labelCol}>เพิ่มชื่อในทีม<input name="name" placeholder="เช่น คุณเอ" style={inputStyle} /></label>
            <button type="submit" style={{ cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13.5 }}>เพิ่ม</button>
          </form>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {C.team.map((name) => (
            <span key={name} style={{ display: 'flex', gap: 6, alignItems: 'center', height: 32, padding: '0 6px 0 12px', borderRadius: 999, background: '#E6ECFD', color: '#1A2FB0', fontSize: 13 }}>
              {name} · {fmtN(ownN[name] || 0)} บริษัท
              <button onClick={() => e.delTeam(name)} aria-label={`ลบ ${name}`} style={{ cursor: 'pointer', width: 22, height: 22, borderRadius: '50%', border: 0, background: 'rgba(10,26,134,.12)', color: '#1A2FB0', fontSize: 13, padding: 0 }}>×</button>
            </span>
          ))}
          {!C.team.length && <span style={{ fontSize: 13, color: '#5E6680' }}>ยังไม่มีรายชื่อทีม เพิ่มชื่อเพื่อกำหนดผู้รับผิดชอบบริษัท</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ ...box, padding: '10px 12px', gap: 2 }}>
              <span style={{ fontSize: 12, color: '#475069' }}>{k}</span>
              <span style={{ fontSize: 20, fontWeight: 500 }}>{fmtN(v)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => e.exportCrm()} style={{ cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13.5 }}>ส่งออกไฟล์สำรอง (.json)</button>
          <label style={{ cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: '1.5px solid #0A1A86', color: '#0A1A86', fontSize: 13.5, display: 'flex', alignItems: 'center' }}>
            นำเข้าไฟล์สำรอง
            <input type="file" accept=".json" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) e.importCrm(f); }} style={{ display: 'none' }} />
          </label>
          {e.tmMsg && <span style={{ fontSize: 13.5, color: '#0B6E66' }}>{e.tmMsg}</span>}
        </div>
      </section>

      <section style={{ ...section, gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 500 }}>ตรวจสถานะหมดอายุอัตโนมัติ</span>
        <span style={intro}>ตรวจทุกบริษัทเทียบกับวันนี้ ทุกครั้งที่เปิดเว็บ หลังอัปเดตข้อมูล ทุก 10 นาทีที่เปิดค้าง และเมื่อขึ้นวันใหม่ บันทึกเหตุการณ์ CFO ใกล้หมดอายุ / หมดอายุ / ต่ออายุแล้ว และ GI หมดอายุหรือถูกลดระดับ ดูได้ในแท็บติดตาม</span>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!mon.notify} onChange={(ev) => e.setNotify(ev.target.checked)} style={{ width: 18, height: 18 }} />
          แจ้งเตือนผ่านเบราว์เซอร์เมื่อมีเหตุการณ์ใหม่
        </label>
        <span style={{ fontSize: 13, color: '#475069' }}>{mon.last ? `ตรวจล่าสุด ${dtTh(mon.last)} · เหตุการณ์ทั้งหมด ${fmtN((mon.events || []).length)}` : 'ยังไม่เคยตรวจ'}</span>
      </section>
    </>
  );
}
