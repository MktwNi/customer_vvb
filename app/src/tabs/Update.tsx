import { type FormEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dtTh, fmtN, isoTh } from '../lib/format';
import type { SyncCfg } from '../lib/types';
import { Notice, Opts, PageHead, labelCol } from '../components/ui';
import { TeamSyncCard } from '../components/TeamSync';
import { Icon } from '../components/icons';

/** One block of the page (design §8): title, one grey status line, the one action at the right; the long
 *  explanation folds under "รายละเอียด". */
export function UpdSection({ title, status, action, more, children, id }: { title: string; status?: ReactNode; action?: ReactNode; more?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <section id={id} className="card upd-sec">
      <div className="upd-head">
        <div className="upd-t">
          <h3 className="card-t">{title}</h3>
          {status != null && status !== '' && <span className="upd-status">{status}</span>}
        </div>
        {action}
      </div>
      {children}
      {more && (
        <details className="upd-more">
          <summary className="lnk">รายละเอียด</summary>
          <div className="upd-more-b">{more}</div>
        </details>
      )}
    </section>
  );
}

export function Update() {
  const { engine: e } = useApp();
  useEngineVersion();
  const C = e.crm;
  // a team that signs in has no use for the team block: who you are is your account, the team list
  // is the users page's (names without an account), and so are an admin's backup files
  const accounts = e.role() != null;
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
    ['มีผู้รับผิดชอบ', Object.keys(C.owners).length],
    ['มีสถานะการขาย', Object.values(C.stages).filter((v) => v && v !== 'none').length],
    ['นัด', C.tasks.length],
    ['บันทึกการติดต่อ', Object.values(C.log).reduce((n, a) => n + a.length, 0)],
    ['ติดตาม', C.watch.length],
  ];
  const syncLine: [string, string][] = [
    ['ซิงก์ล่าสุด', sc.last ? dtTh(sc.last) : 'ยังไม่เคย'],
    ['ผลล่าสุด', sc.lastMsg || '—'],
    ['บนเว็บ TGO', sc.total ? fmtN(sc.total) + ' รายการ' : '—'],
    ['ดึงเพิ่มไว้', fmtN(e.tgoCerts.length) + ' ใบ'],
  ];

  return (
    <>
      <PageHead title="อัปเดตข้อมูล" />
      <TeamSyncCard />
      <UpdSection
        title="อัปโหลดฐานข้อมูลลูกค้าฉบับใหม่"
        status={dataLine}
        action={
          <label className="btn" style={{ flex: 'none' }}>
            เลือกไฟล์ .xlsx
            <input type="file" accept=".xlsx" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) e.onFile(f); }} style={{ display: 'none' }} />
          </label>
        }
        more="ไฟล์ Excel รูปแบบเดียวกับ ฐานข้อมูลลูกค้า_GCC (ชีต ทะเบียนบริษัท, TGO_CFO, GI, กรอ., SET) ระบบจะแทนข้อมูลบริษัททั้งหมด ส่วนที่ทีมบันทึก (ติดตาม สถานะการขาย โน้ต นัด ข้อมูลติดต่อที่แก้ การตัดสินข้อมูลซ้ำ) ยังอยู่ครบ"
      >
        {u.status === 'busy' && <span className="t-link" style={{ fontSize: 14 }}>{u.msg}</span>}
        {u.status === 'error' && <Notice kind="error">{u.msg}</Notice>}
        {u.status === 'done' && <Notice kind="ok">{u.msg}</Notice>}
        {u.status === 'preview' && (
          <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span className="t-name">{u.head}</span>
            <div className="upd-line">
              {(u.preview || []).map((b) => (
                <span key={b.k}><span className="t-muted">{b.k}</span> {b.v}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => e.applyUpload()} className="btn sm">ใช้ข้อมูลชุดนี้</button>
              <button onClick={() => e.cancelUpload()} className="quiet">ยกเลิก</button>
            </div>
          </div>
        )}
        {e.base.source === 'upload' && <button onClick={() => e.revertUpload()} className="lnk" style={{ alignSelf: 'flex-start' }}>กลับไปใช้ไฟล์ข้อมูลต้นฉบับของเว็บ</button>}
      </UpdSection>

      <UpdSection
        title="ดึงใบรับรอง CFO ใหม่จากเว็บไซต์ TGO"
        status={
          <span className="upd-line">
            {syncLine.map(([k, v]) => (
              <span key={k}><span className="t-muted">{k}</span> {v}</span>
            ))}
          </span>
        }
        action={<button onClick={() => e.runSync(false)} disabled={y.status === 'running'} className="btn pri" style={{ flex: 'none' }}>{y.status === 'running' ? 'กำลังดึงข้อมูล…' : 'ดึงข้อมูลล่าสุดตอนนี้'}</button>}
        more={
          <>
            <span>อ่านหน้า "รายชื่อบริษัทและองค์กรที่ขอการรับรอง" ของ อบก. ใบรับรองใหม่จะผูกกับบริษัทที่ชื่อตรงกัน ถ้าไม่พบจะสร้างบริษัทใหม่ (แหล่ง TGO)</span>
            <span>Proxy (ขั้นสูง): ใช้ {'{u}'} แทนตำแหน่ง URL · ตัวอย่างสำหรับ Cloudflare Worker อยู่ที่ project/tools/tgo-proxy-worker.js</span>
            <input defaultValue={sc.proxy} onBlur={(ev) => e.saveSync({ proxy: ev.target.value.trim() })} placeholder="https://tgo-proxy.example.workers.dev/?url={u}" aria-label="Proxy" className="fld" style={{ maxWidth: 560 }} />
          </>
        }
      >
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={labelCol}>
            รอบอัปเดตอัตโนมัติ
            <select value={sc.freq} onChange={(ev) => e.saveSync({ freq: ev.target.value as SyncCfg['freq'] })} className="fld sel">
              <Opts options={[{ v: 'open', label: 'ทุกครั้งที่เปิดเว็บ' }, { v: 'daily', label: 'วันละครั้ง' }, { v: 'weekly', label: 'สัปดาห์ละครั้ง' }, { v: 'off', label: 'ปิด (กดเองเท่านั้น)' }]} />
            </select>
          </label>
          <label className="hv" style={{ display: 'flex', gap: 8, alignItems: 'center', height: 40, padding: '0 8px', margin: '0 -8px', borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!sc.autoApply} onChange={(ev) => e.saveSync({ autoApply: ev.target.checked })} style={{ width: 18, height: 18 }} />
            เมื่อถึงรอบ ให้อัปเดตทันทีโดยไม่ต้องยืนยัน
          </label>
        </div>
        {y.status === 'running' && <span className="t-link" style={{ fontSize: 14 }}>{y.msg}</span>}
        {y.status === 'error' && <Notice kind="error">{y.msg}</Notice>}
        {y.status === 'done' && <Notice kind="ok">{y.msg}</Notice>}
        {y.status === 'ready' && st && (
          <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="t-name">{`พบใบรับรองใหม่ ${fmtN(st.nw.length)} ใบ จาก ${fmtN(st.items.length)} รายการล่าสุด (ผ่าน ${st.via})`}</span>
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 280, overflow: 'auto' }}>
              {st.nw.slice(0, 60).map((it, i) => (
                <div key={i} style={{ borderTop: '1px solid var(--divider)', padding: '8px 0', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14 }}>{it.org}</span>
                  <span className="t-meta">{`${it.gid ? 'ผูกกับบริษัทเดิม' : 'บริษัทใหม่'} · ${it.cert} · ${it.prov} · อนุมัติ ${it.apBE}`}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => e.applySync(false)} className="btn sm">อัปเดตเข้าระบบ</button>
              <button onClick={() => e.cancelSync()} className="quiet">ยกเลิก</button>
            </div>
          </div>
        )}
      </UpdSection>

      {!accounts && (
        <UpdSection
          title="ทีมขายและข้อมูลที่บันทึก"
          status={
            <span className="upd-line">
              {stats.map(([k, v]) => (
                <span key={k}><span className="t-muted">{k}</span> {fmtN(v)}</span>
              ))}
            </span>
          }
          more={e.teamCfg
            ? 'ติดตาม สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ ข้อมูลติดต่อที่แก้ และผลตรวจข้อมูลซ้ำ แชร์กับทีมผ่าน Google Sheet แล้ว ส่วน "ฉันคือ" ตั้งแยกในแต่ละเครื่อง ไฟล์สำรองยังส่งออก/นำเข้าได้ (นำเข้าจะเพิ่มเฉพาะรายการที่ทีมยังไม่มี) · ข้อมูลของบริษัทที่ดึงเพิ่มจากเว็บ TGO เก็บเฉพาะเครื่องนี้'
            : 'ติดตาม สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ ข้อมูลติดต่อที่แก้ และผลตรวจข้อมูลซ้ำ เก็บในเบราว์เซอร์เครื่องนี้ ส่งออกเป็นไฟล์สำรองเพื่อเก็บไว้หรือส่งให้เพื่อนร่วมทีมนำเข้า (รวมกับข้อมูลเดิม ไม่ลบของใคร) หรือเชื่อม Google Sheet ด้านบนเพื่อให้ทุกเครื่องเห็นเหมือนกัน'}
        >
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={labelCol}>
              ฉันคือ
              <select value={me} onChange={(ev) => e.setMe(ev.target.value)} className="fld sel" style={{ minWidth: 200 }}>
                <Opts all="ยังไม่เลือก" options={C.team.map((v) => ({ v, label: v }))} />
              </select>
            </label>
            <form onSubmit={addTeam} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={labelCol}>เพิ่มชื่อในทีม<input name="name" placeholder="เช่น คุณเอ" className="fld" /></label>
              <button type="submit" className="btn">เพิ่ม</button>
            </form>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {C.team.map((name) => (
              <span key={name} className="chip upd-chip">
                {name} · {fmtN(ownN[name] || 0)} บริษัท
                <button onClick={() => e.delTeam(name)} aria-label={`ลบ ${name}`} title={`ลบ ${name}`} className="upd-x"><Icon name="close" size={12} /></button>
              </span>
            ))}
            {!C.team.length && <span className="empty">ยังไม่มีรายชื่อทีม เพิ่มชื่อเพื่อกำหนดผู้รับผิดชอบบริษัท</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => e.exportCrm()} className="btn">ส่งออกไฟล์สำรอง (.json)</button>
            <label className="btn">
              นำเข้าไฟล์สำรอง
              <input type="file" accept=".json" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) e.importCrm(f); }} style={{ display: 'none' }} />
            </label>
            {e.tmMsg && <span className="t-ok" style={{ fontSize: 14 }}>{e.tmMsg}</span>}
          </div>
        </UpdSection>
      )}

      <UpdSection
        title="ตรวจสถานะหมดอายุอัตโนมัติ"
        status={mon.last ? `ตรวจล่าสุด ${dtTh(mon.last)} · เหตุการณ์ทั้งหมด ${fmtN((mon.events || []).length)}` : 'ยังไม่เคยตรวจ'}
        more="ตรวจทุกบริษัทเทียบกับวันนี้ ทุกครั้งที่เปิดเว็บ หลังอัปเดตข้อมูล ทุก 10 นาทีที่เปิดค้าง และเมื่อขึ้นวันใหม่ บันทึกเหตุการณ์ CFO ใกล้หมดอายุ / หมดอายุ / ต่ออายุแล้ว และ GI หมดอายุหรือถูกลดระดับ ดูได้ในแท็บติดตาม"
      >
        <label className="hv" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', margin: '-4px -8px', borderRadius: 10, fontSize: 14, cursor: 'pointer', alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={!!mon.notify} onChange={(ev) => e.setNotify(ev.target.checked)} style={{ width: 18, height: 18 }} />
          แจ้งเตือนผ่านเบราว์เซอร์เมื่อมีเหตุการณ์ใหม่
        </label>
      </UpdSection>
    </>
  );
}
