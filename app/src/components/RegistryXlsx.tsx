import { useRef, useState, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { downloadBlob, fmtN, isoTh, todayISO } from '../lib/format';
import { Notice } from './ui';
import { xlsxBlob } from '../lib/xlsx';
import { SHEET, SHEET_TGO, certFields, exportSheets, readCertSheet, templateSheets, workbookKind, type CertLine } from '../lib/registryXlsx';

/** One block of the Update page for the certificate sheet (same markup as the page's other blocks). */
function Block({ title, status, action, more, children }: { title: string; status?: ReactNode; action?: ReactNode; more?: ReactNode; children?: ReactNode }) {
  return (
    <section className="card upd-sec">
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

const SHOWN = 50;
const ERR_SHOWN = 100;

/**
 * Certificates by sheet: the template (ใบรับรอง CFO) or the export of what the app holds, read by header name.
 * The sheet is read and planned here; nothing is saved until the confirm button. The old full workbook (a
 * ทะเบียนบริษัท sheet) goes to the engine's own upload, with its own preview, as before.
 */
export function RegistryXlsx() {
  const { engine: e } = useApp();
  useEngineVersion();
  const [pick, setPick] = useState<{ name: string; sheet: string; lines: CertLine[] } | null>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const u = e.up;
  const st = e.base.source === 'upload' ? `ไฟล์ที่อัปโหลด ${e.base.fileName || ''}` : 'ไฟล์ข้อมูลต้นฉบับของเว็บ';
  const status = `ข้อมูล ณ ${isoTh(e.base.asOf)} · ${st} · ${fmtN(e.B.companies.length)} บริษัท · ${fmtN(e.B.certs.length)} ใบรับรอง CFO`;
  const plan = pick ? e.certPlan(pick.lines) : null;
  const canSet = e.can('set.data');
  const toSave = plan ? plan.news.length + plan.changed.length + plan.companies.length : 0;

  async function onPick(f: File) {
    setErr('');
    setDone('');
    setPick(null);
    try {
      const k = await workbookKind(f);
      if (k.kind === 'none') {
        setErr(`ไม่พบชีต ${SHEET} หรือ ${SHEET_TGO} ในไฟล์นี้ (พบชีต ${k.names.join(', ') || 'ไม่มี'})`);
        return;
      }
      if (k.kind === 'full') {
        if (e.up.status === 'preview') e.cancelUpload();
        await e.onFile(f);
        return;
      }
      if (e.up.status === 'preview') e.cancelUpload();
      setPick({ name: f.name, sheet: k.sheet, lines: await readCertSheet(f, k.sheet) });
    } catch (x) {
      setErr((x as Error)?.message || String(x));
    }
  }
  async function save() {
    if (!pick) return;
    setBusy(true);
    const msg = await e.applyCertRows(pick.lines, pick.name);
    setBusy(false);
    setPick(null);
    setDone(msg);
  }
  const download = async (name: string, sheets: ReturnType<typeof templateSheets>) => downloadBlob(await xlsxBlob(sheets), name);
  const exportNow = () => {
    const today = todayISO();
    void download(`ใบรับรอง_CFO_ส่งออก_${today}.xlsx`, exportSheets(e.B.certs.map((c) => certFields(c, e.B.CD)), today));
  };

  return (
    <Block
      title="นำเข้าใบรับรอง CFO จากไฟล์ Excel"
      status={status}
      action={
        <>
          <button type="button" className="btn" style={{ flex: 'none' }} onClick={() => fileIn.current?.click()}>เลือกไฟล์ .xlsx</button>
          <input ref={fileIn} type="file" accept=".xlsx" hidden onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) void onPick(f); }} />
        </>
      }
      more={`ใช้แม่แบบ "ใบรับรอง CFO" ที่มี 27 คอลัมน์เดียวกับชีต ข้อมูล CFO ของ TGO และมีชีต "คำอธิบาย" บอกว่าแต่ละคอลัมน์ต้องกรอกอย่างไร ระบบอ่านจากชื่อหัวคอลัมน์ในแถวแรก ลำดับคอลัมน์ไม่สำคัญ ก่อนบันทึกจะแสดงจำนวนใบใหม่ ใบที่มีอยู่แล้ว ใบที่เปลี่ยน (พร้อมฟิลด์ที่เปลี่ยน) และแถวที่บันทึกไม่ได้พร้อมเลขแถวและเหตุผล แถวที่มีข้อผิดพลาดจะถูกข้าม ไม่บันทึกครึ่งแถว ไฟล์ฐานข้อมูลลูกค้าแบบเดิม (มีชีต ทะเบียนบริษัท) ยังใช้ได้เหมือนเดิม การบันทึกเก็บไว้ในเบราว์เซอร์เครื่องนี้ ไม่ส่งไปชีตทีม`}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => void download('แม่แบบใบรับรอง_CFO.xlsx', templateSheets())} className="btn">ดาวน์โหลดแม่แบบ</button>
        <button onClick={exportNow} className="btn">ส่งออกข้อมูลปัจจุบัน</button>
      </div>

      {busy && <span className="t-link" style={{ fontSize: 14 }} role="status">กำลังบันทึก…</span>}
      {err && <Notice kind="error" role="alert">{err}</Notice>}
      {done && <Notice kind={done.startsWith('บันทึกแล้ว') ? 'ok' : 'error'} role={done.startsWith('บันทึกแล้ว') ? 'status' : 'alert'}>{done}</Notice>}
      {u.status === 'busy' && <span className="t-link" style={{ fontSize: 14 }} role="status">{u.msg}</span>}
      {u.status === 'error' && <Notice kind="error" role="alert">{u.msg}</Notice>}
      {u.status === 'done' && <Notice kind="ok" role="status">{u.msg}</Notice>}

      {u.status === 'preview' && (
        <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="t-name">{u.head}</span>
          <div className="upd-line">
            {(u.preview || []).map((b) => (
              <span key={b.k}><span className="t-muted">{b.k}</span> {b.v}</span>
            ))}
          </div>
          {!canSet && <span className="t-meta">บัญชีนี้นำเข้าข้อมูลไม่ได้ ดูตัวอย่างได้เท่านั้น</span>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => e.applyUpload()} disabled={!canSet} className="btn pri sm">ใช้ข้อมูลชุดนี้</button>
            <button onClick={() => e.cancelUpload()} className="quiet">ยกเลิก</button>
          </div>
        </div>
      )}

      {pick && plan && (
        <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="t-name">{`${pick.name} · ชีต ${pick.sheet} · อ่านได้ ${fmtN(plan.read)} แถว`}</span>
          <div className="upd-line" role="status">
            <span><span className="t-muted">ใบรับรองใหม่</span> {fmtN(plan.news.length)}</span>
            <span><span className="t-muted">มีอยู่แล้ว</span> {fmtN(plan.same)}</span>
            <span><span className="t-muted">เปลี่ยนแปลง</span> {fmtN(plan.changed.length)}</span>
            <span><span className="t-muted">บริษัทใหม่</span> {fmtN(plan.companies.length)}</span>
            <span><span className="t-muted">แถวที่ข้าม</span> {fmtN(plan.errors.length)}</span>
          </div>
          {plan.changed.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="t-muted" style={{ fontSize: 14 }}>ที่จะเปลี่ยน</span>
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 280, overflow: 'auto' }}>
                {plan.changed.slice(0, SHOWN).map((c) => (
                  <div key={c.rowNo} style={{ borderTop: '1px solid var(--divider)', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 2, overflowWrap: 'anywhere' }}>
                    <span>{`แถว ${c.rowNo} · ${c.f.org} · ${c.f.cert}`}</span>
                    <span className="t-meta">{`เปลี่ยน: ${c.fields.join(', ')}`}</span>
                  </div>
                ))}
                {plan.changed.length > SHOWN && <span className="t-meta">{`และอีก ${fmtN(plan.changed.length - SHOWN)} ใบ`}</span>}
              </div>
            </div>
          )}
          {plan.news.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="t-muted" style={{ fontSize: 14 }}>ใบรับรองใหม่</span>
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 280, overflow: 'auto' }}>
                {plan.news.slice(0, SHOWN).map((n) => (
                  <div key={n.rowNo} style={{ borderTop: '1px solid var(--divider)', padding: '8px 0', overflowWrap: 'anywhere' }}>
                    {`แถว ${n.rowNo} · ${n.f.org} · ${n.f.cert}${e.B.byId.has(n.gid) ? '' : ' · บริษัทใหม่'}`}
                  </div>
                ))}
                {plan.news.length > SHOWN && <span className="t-meta">{`และอีก ${fmtN(plan.news.length - SHOWN)} ใบ`}</span>}
              </div>
            </div>
          )}
          {plan.errors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Notice kind="warn">{`${fmtN(plan.errors.length)} แถวบันทึกไม่ได้ จะถูกข้ามไป ไม่บันทึกครึ่งแถว`}</Notice>
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 220, overflow: 'auto' }}>
                {plan.errors.slice(0, ERR_SHOWN).map((x) => (
                  <div key={x.rowNo} style={{ borderTop: '1px solid var(--divider)', padding: '6px 0', overflowWrap: 'anywhere' }}>
                    {`แถว ${x.rowNo} · ${x.reason}`}
                  </div>
                ))}
                {plan.errors.length > ERR_SHOWN && <span className="t-meta">{`และอีก ${fmtN(plan.errors.length - ERR_SHOWN)} แถว`}</span>}
              </div>
            </div>
          )}
          {!canSet && <span className="t-meta">บัญชีนี้นำเข้าข้อมูลไม่ได้ ดูตัวอย่างได้เท่านั้น</span>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => void save()} disabled={!canSet || !toSave || busy} className="btn pri sm">บันทึกเข้าระบบ</button>
            <button onClick={() => setPick(null)} className="quiet">ยกเลิก</button>
          </div>
        </div>
      )}

      {e.base.source === 'upload' && canSet && <button onClick={() => e.revertUpload()} className="lnk" style={{ alignSelf: 'flex-start' }}>กลับไปใช้ไฟล์ข้อมูลต้นฉบับของเว็บ</button>}
    </Block>
  );
}
