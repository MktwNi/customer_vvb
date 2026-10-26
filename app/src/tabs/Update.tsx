import { type FormEvent, type ReactNode, useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dtTh, fmtN, isoTh, todayISO } from '../lib/format';
import type { SyncCfg } from '../lib/types';
import { Notice, PageHead, labelCol } from '../components/ui';
import { SelField } from '../components/Select';
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

/** Companies per page of the review queue: every waiting row is listed on some page. */
const QUEUE_PAGE = 40;

/** The TGO review queue (lib/tgoSync.ts): what the pull found, by company, waiting for an approver. Accept or
 *  reject per certificate or per company; a viewer reads it and gets no buttons. Every waiting row is listed, a
 *  page of companies at a time. */
function TgoQueue({ canEdit }: { canEdit: boolean }) {
  const { engine: e } = useApp();
  const [page, setPage] = useState(0);
  const rows = e.tgoRows('p');
  const groups: { org: string; rows: typeof rows }[] = [];
  rows.forEach((r) => {
    const g = groups[groups.length - 1];
    if (g && g.org === r.rec.org) g.rows.push(r);
    else groups.push({ org: r.rec.org, rows: [r] });
  });
  const pages = Math.max(1, Math.ceil(groups.length / QUEUE_PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = groups.slice(cur * QUEUE_PAGE, (cur + 1) * QUEUE_PAGE);
  const accepted = e.tgoRows('a').length, rejected = e.tgoRows('r').length;
  const today = todayISO();
  return (
    <UpdSection
      id="tgo-queue"
      title="รอตรวจก่อนเข้าระบบ"
      status={
        <span className="upd-line">
          <span><span className="t-muted">รอตรวจ</span> {fmtN(rows.length)} ใบ จาก {fmtN(groups.length)} บริษัท</span>
          <span><span className="t-muted">รับแล้ว</span> {fmtN(accepted)} ใบ</span>
          <span><span className="t-muted">ไม่รับ</span> {fmtN(rejected)} ใบ</span>
        </span>
      }
      more="ใบที่ดึงมาจะรอตรวจที่นี่ทั้งทีม ยังไม่เข้าทะเบียนจนกว่าจะกดรับ การรับใบของบริษัทที่ยังไม่มีในทะเบียนจะสร้างบริษัทใหม่ให้ทุกคนเห็นพร้อมกัน (บริษัทเดียวกันในรอบเดียวกันเป็นบริษัทเดียว) ไม่รับแล้วจะไม่ถูกดึงเป็นรายการใหม่อีก ไม่มีอะไรเข้าทะเบียน"
    >
      {!canEdit && <span className="t-meta">บัญชีของคุณดูรายการนี้ได้อย่างเดียว การรับหรือไม่รับทำได้เฉพาะผู้ที่แก้ข้อมูลลูกค้าได้</span>}
      {!rows.length && <span className="empty">ไม่มีใบที่รอตรวจ กดดึงข้อมูลล่าสุดเมื่อ อบก. ประกาศรอบใหม่</span>}
      {shown.map((g) => {
        const ids = g.rows.map((r) => r.rid);
        return (
          <div key={g.org} style={{ borderTop: '1px solid var(--divider)', padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
                <span className="co-name dense">{g.org}</span>
                <span className="t-meta">{`${g.rows[0].gid != null ? 'ผูกกับบริษัทเดิม' : 'บริษัทใหม่'} · ${fmtN(g.rows.length)} ใบ`}</span>
              </span>
              {canEdit && (
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => e.approveTgo(ids)} className="btn sm">รับทั้งบริษัท</button>
                  <button onClick={() => e.rejectTgo(ids)} className="quiet">ไม่รับทั้งบริษัท</button>
                </span>
              )}
            </div>
            {g.rows.map((r) => {
              const expired = !!r.rec.ex && r.rec.ex < today;
              return (
                <div key={r.rid} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', paddingLeft: 12 }}>
                  <span className="t-meta">{r.rec.cert}</span>
                  <span className="t-meta">{`${r.rec.act || 'ไม่ระบุกิจกรรม'} · ${r.rec.prov || 'ไม่ระบุจังหวัด'} · อนุมัติ ${r.rec.ap ? isoTh(r.rec.ap) : '—'} · ${expired ? 'หมดอายุแล้ว ' : 'ถึง '}${r.rec.ex ? isoTh(r.rec.ex) : '—'}`}</span>
                  {canEdit && (
                    <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                      <button onClick={() => e.approveTgo([r.rid])} className="quiet">รับ</button>
                      <button onClick={() => e.rejectTgo([r.rid])} className="quiet">ไม่รับ</button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--divider)', paddingTop: 10 }}>
          <span className="t-meta">{`หน้า ${cur + 1} จาก ${fmtN(pages)} · บริษัทที่ ${fmtN(cur * QUEUE_PAGE + 1)}–${fmtN(Math.min(groups.length, (cur + 1) * QUEUE_PAGE))} จาก ${fmtN(groups.length)}`}</span>
          <button onClick={() => setPage(cur - 1)} disabled={cur === 0} className="quiet">ก่อนหน้า</button>
          <button onClick={() => setPage(cur + 1)} disabled={cur >= pages - 1} className="quiet">ถัดไป</button>
        </div>
      )}
    </UpdSection>
  );
}

export function Update() {
  const { engine: e } = useApp();
  useEngineVersion();
  const C = e.crm;
  // a team that signs in has no use for the team block: who you are is your account, the team list
  // is the users page's (names without an account), and so are an admin's backup files
  const accounts = e.role() != null;
  // pulling and deciding the queue are edits of the registry: a viewer reads the queue only
  const canEdit = e.can('edit.cust');
  const u = e.up, y = e.sy, sc = e.syncCfg(), mon = e.monCfg();
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
    ['แหล่ง', sc.feed ? 'Google Sheet (อัปเดตจากเว็บ อบก.)' : 'หน้าเว็บ TGO'],
    ['บนเว็บ TGO', sc.total ? fmtN(sc.total) + ' รายการ' : '—'],
    ['รับเข้าแล้ว', fmtN(e.tgoRows('a').length) + ' ใบ'],
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
        title="ดึงใบรับรอง CFO ใหม่จาก อบก."
        status={
          <span className="upd-line">
            {syncLine.map(([k, v]) => (
              <span key={k}><span className="t-muted">{k}</span> {v}</span>
            ))}
          </span>
        }
        action={<button onClick={() => e.runSync(false)} disabled={y.status === 'running' || !canEdit} className="btn pri" style={{ flex: 'none' }}>{y.status === 'running' ? 'กำลังดึงข้อมูล…' : 'ดึงข้อมูลล่าสุดตอนนี้'}</button>}
        more={
          <>
            <span>
              {sc.feed
                ? 'อ่านจาก Google Sheet “TGO” ที่ระบบอัปเดตรายชื่อ CFO ดึงจากหน้า "รายชื่อบริษัทและองค์กรที่ขอการรับรอง" ของ อบก. ได้ครบทุกรายการพร้อมที่อยู่ อุตสาหกรรม ขนาด และสัดส่วนประเภท 1–3'
                : 'อ่านหน้า "รายชื่อบริษัทและองค์กรที่ขอการรับรอง" ของ อบก. โดยตรง (3 หน้าแรก ไม่มีรายละเอียดที่อยู่และอุตสาหกรรม)'}
              {' '}ใบที่ดึงได้ รวมใบที่หมดอายุแล้ว จะรอตรวจในส่วน “รอตรวจก่อนเข้าระบบ” ก่อนเข้าทะเบียน ไม่เข้าทันที
            </span>
            {sc.feed && (
              <span>
                เมื่อ อบก. ประกาศรอบใหม่ ให้กด “อัปเดตข้อมูล” ที่{' '}
                <a href={sc.feed} target="_blank" rel="noopener" className="lnk">หน้าอัปเดตรายชื่อ CFO</a> ก่อน แล้วกด “ดึงข้อมูลล่าสุดตอนนี้” ที่นี่
              </span>
            )}
            <span>ลิงก์ข้อมูล: ลิงก์เว็บแอปอัปเดตรายชื่อ CFO (ลงท้าย /exec) · เว้นว่าง = อ่านหน้าเว็บ TGO ผ่าน Proxy</span>
            <input defaultValue={sc.feed} onBlur={(ev) => e.saveSync({ feed: ev.target.value.trim() })} placeholder="https://script.google.com/macros/s/…/exec" aria-label="ลิงก์ข้อมูล" className="fld" style={{ maxWidth: 560 }} />
            <span>Proxy (ขั้นสูง ใช้เมื่อไม่มีลิงก์ข้อมูล): ใช้ {'{u}'} แทนตำแหน่ง URL · ตัวอย่างสำหรับ Cloudflare Worker อยู่ที่ project/tools/tgo-proxy-worker.js</span>
            <input defaultValue={sc.proxy} onBlur={(ev) => e.saveSync({ proxy: ev.target.value.trim() })} placeholder="https://tgo-proxy.example.workers.dev/?url={u}" aria-label="Proxy" className="fld" style={{ maxWidth: 560 }} />
          </>
        }
      >
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <SelField
            style={{ ...labelCol, minWidth: 220 }}
            text="รอบอัปเดตอัตโนมัติ"
            value={sc.freq}
            onChange={(v) => e.saveSync({ freq: v as SyncCfg['freq'] })}
            options={[{ v: 'open', label: 'ทุกครั้งที่เปิดเว็บ' }, { v: 'daily', label: 'วันละครั้ง' }, { v: 'weekly', label: 'สัปดาห์ละครั้ง' }, { v: 'off', label: 'ปิด (กดเองเท่านั้น)' }]}
          />
        </div>
        {y.status === 'running' && <span className="t-link" style={{ fontSize: 14 }}>{y.msg}</span>}
        {y.status === 'error' && <Notice kind="error">{y.msg}</Notice>}
        {(y.status === 'done' || y.status === 'ready') && <Notice kind="ok">{y.msg}</Notice>}
      </UpdSection>

      <TgoQueue canEdit={canEdit} />

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
            <SelField style={{ ...labelCol, minWidth: 200 }} text="ฉันคือ" value={me} onChange={(v) => e.setMe(v)} options={[{ v: '', label: 'ยังไม่เลือก' }, ...C.team.map((v) => ({ v, label: v }))]} />
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
