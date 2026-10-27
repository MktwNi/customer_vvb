import { useRef, useState, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { downloadBlob, fmtN, isoTh, todayISO } from '../lib/format';
import { Notice } from './ui';
import { xlsxBlob } from '../lib/xlsx';
import { ACTION_TH, SHEET, SHEET_TGO, countLog, exportSheets, readCertSheetFull, templateSheets, workbookKind, type CertLine, type CertLogEntry, type EmailAction } from '../lib/registryXlsx';

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

const EMAIL_TH: Record<EmailAction, string> = {
  none: '',
  filled: 'เติมอีเมลให้บริษัท',
  kept: 'มีอีเมลอยู่แล้ว ไม่เปลี่ยน',
  skipped: 'ไม่นำอีเมลไปใช้ เพราะแถวนี้ไม่ได้บันทึก',
};
/** A row's e-mail decision as the report writes it, with the address the sheet has. */
const emailLine = (r: CertLogEntry): string => {
  const a = r.email;
  if (a.action === 'none') return '';
  if (a.action === 'filled') return `${EMAIL_TH.filled}: ${a.to}`;
  return `${EMAIL_TH[a.action]} · ในชีต ${a.to}`;
};

/** One row of the change report: its number and action, the company (GCC code and name), the certificate, what changed
 *  (old and new), the reason of a row that was not applied, and the e-mail decision. */
function ChangeRowLine({ r }: { r: CertLogEntry }) {
  const who = [r.gcc, r.company].filter(Boolean).join(' · ');
  const mail = emailLine(r);
  return (
    <div role="listitem" style={{ borderTop: '1px solid var(--divider)', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 2, overflowWrap: 'anywhere' }}>
      <span>{`แถว ${r.row} · ${ACTION_TH[r.action]}`}</span>
      <span className="t-meta">{[who, r.cert && `เลขที่ใบรับรอง ${r.cert}`].filter(Boolean).join(' · ')}</span>
      {r.changes.map((c) => (
        <span key={c.field} className="t-meta">{`${c.field}: เดิม ${c.from || 'ว่าง'} เป็น ${c.to || 'ว่าง'}`}</span>
      ))}
      {r.msg && <span className="t-meta">{r.msg}</span>}
      {mail && <span className="t-meta">{mail}</span>}
    </div>
  );
}

/**
 * The change report of a sheet save (R10, R14, R19), shown before the save (the preview) and after it (the saved result,
 * the list the import record keeps). The counts are the report's own log list counted (countLog); the list has every row,
 * not a part of them, in a box that scrolls. Unknown headers are named above the counts, never left out.
 */
export function ChangeReport({ log, warnings }: { log: CertLogEntry[]; warnings: string[] }) {
  const c = countLog(log);
  const count = (label: string, n: number) => (
    <span><span className="t-muted">{label}</span> {fmtN(n)}</span>
  );
  const reasons = Object.entries(c.reasons).map(([why, n]) => `${why} ${fmtN(n)} แถว`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {warnings.length > 0 && (
        <Notice kind="warn">{`คอลัมน์ที่ไม่รู้จัก ${warnings.map((h) => `“${h}”`).join(', ')} · ระบบไม่อ่านคอลัมน์เหล่านี้`}</Notice>
      )}
      <div className="upd-line" role="status">
        {count('เข้ารอตรวจ TGO', c.queued)}
        {count('อัปเดตใบรับรอง', c.updated)}
        {count('ไม่เปลี่ยน', c.attached + c.unchanged)}
        {count('อยู่ในรายการ TGO แล้ว', c['already queued'])}
        {count('ถูกปฏิเสธไว้แล้ว', c['declined before'])}
        {count('ต้องแก้ที่รายการ TGO', c.refused)}
        {count('รอตรวจสอบจากไฟล์ชีต', c.review)}
        {count('อยู่ในรายการรอตรวจสอบแล้ว', c['already in review'])}
        {count('แถวที่ข้าม', c.error + c.rejected)}
        <span><span className="t-muted">อีเมลบริษัท</span> {`เติม ${fmtN(c.emailFilled)} · คงเดิม ${fmtN(c.emailKept)}`}</span>
        <span>ไม่สร้างบริษัทใหม่</span>
      </div>
      {reasons.length > 0 && <span className="t-meta">{`รอตรวจสอบ ${fmtN(c.review)} แถว · ${reasons.join(' · ')}`}</span>}
      {log.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="t-muted" style={{ fontSize: 14 }}>{`ทุกแถวของชีต ${fmtN(log.length)} แถว`}</span>
          <div role="list" aria-label="รายการทุกแถว" tabIndex={0} style={{ display: 'flex', flexDirection: 'column', maxHeight: 360, overflow: 'auto' }}>
            {log.map((r, i) => <ChangeRowLine key={`${r.row}-${i}`} r={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Certificates by sheet: the template (ใบรับรอง CFO) or the export of what the app holds, read by header name.
 * The sheet is read and planned here; nothing is saved until the confirm button. The old full workbook (a
 * ทะเบียนบริษัท sheet) goes to the engine's own upload, with its own preview, as before.
 */
export function RegistryXlsx() {
  const { engine: e } = useApp();
  useEngineVersion();
  const [pick, setPick] = useState<{ name: string; sheet: string; lines: CertLine[]; unknown: string[] } | null>(null);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ name: string; msg: string; log: CertLogEntry[]; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const u = e.up;
  const st = e.base.source === 'upload' ? `ไฟล์ที่อัปโหลด ${e.base.fileName || ''}` : 'ไฟล์ข้อมูลต้นฉบับของเว็บ';
  const status = `ข้อมูล ณ ${isoTh(e.base.asOf)} · ${st} · ${fmtN(e.B.companies.length)} บริษัท · ${fmtN(e.B.certs.length)} ใบรับรอง CFO`;
  const plan = pick ? e.certPlan(pick.lines, pick.unknown) : null;
  const canSet = e.can('set.data');
  // a save writes queue rows for the team too, so it also needs the queue's right (edit.cust)
  const canSave = canSet && e.can('edit.cust');
  // what a save writes: the queue rows, the changed rows, the review records and the e-mails it fills
  const toSave = plan ? plan.news.length + plan.changed.length + plan.reviews.length + plan.emails.filter((x) => x.action === 'filled').length : 0;

  async function onPick(f: File) {
    setErr('');
    setResult(null);
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
      const read = await readCertSheetFull(f, k.sheet);
      setPick({ name: f.name, sheet: k.sheet, lines: read.lines, unknown: read.unknown });
    } catch (x) {
      setErr((x as Error)?.message || String(x));
    }
  }
  async function save() {
    if (!pick) return;
    setBusy(true);
    const saved = await e.applyCertRowsReport(pick.lines, pick.name, pick.unknown);
    setBusy(false);
    setPick(null);
    // the result is the engine's own log list of this save, not a count made here
    setResult({ name: pick.name, msg: saved.msg, log: saved.log, warnings: pick.unknown });
  }
  const download = async (name: string, sheets: ReturnType<typeof templateSheets>) => downloadBlob(await xlsxBlob(sheets), name);
  const exportNow = () => {
    const today = todayISO();
    void download(`ใบรับรอง_CFO_ส่งออก_${today}.xlsx`, exportSheets(e.certExportRows(), today));
  };
  const resultKind = (m: string) => (m.startsWith('บันทึกแล้ว') ? 'ok' : m.startsWith('ไม่มีการเปลี่ยนแปลง') ? 'info' : 'error');

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
      more={`ใช้แม่แบบ "ใบรับรอง CFO" ที่มี 27 คอลัมน์เดียวกับชีต ข้อมูล CFO ของ TGO และมีชีต "คำอธิบาย" บอกว่าแต่ละคอลัมน์ต้องกรอกอย่างไร ระบบอ่านจากชื่อหัวคอลัมน์ในแถวแรก ลำดับคอลัมน์ไม่สำคัญ คอลัมน์ที่ระบบไม่รู้จักจะขึ้นเตือนก่อนบันทึก ก่อนบันทึกจะแสดงทุกแถวของชีต ทั้งใบใหม่ ใบที่มีอยู่แล้ว ใบที่เปลี่ยน (พร้อมค่าเดิมและค่าใหม่) ใบที่อยู่ในรายการ TGO แล้ว และแถวที่ข้าม พร้อมเหตุผล ช่องที่ว่างในชีตไม่ทำให้ค่าเดิมหาย ใบรับรองใหม่จากชีตจะเข้ารายการรอตรวจ TGO ที่ทั้งทีมเห็น ยังไม่เข้าทะเบียนจนกว่าผู้ตรวจจะกดรับ แถวที่หาบริษัทในระบบไม่พบหรือรหัส GCC ไม่ตรงจะไปอยู่ในกล่อง “รอตรวจสอบจากไฟล์ชีต” ด้านล่าง ระบบไม่สร้างบริษัทใหม่จากไฟล์นี้ บันทึกแถวเดิมซ้ำจะไม่เพิ่มซ้ำ ใบที่รับเข้าจาก TGO แล้วแก้จากไฟล์นี้ไม่ได้ การแก้ใบเดิมในทะเบียนเก็บไว้ในเบราว์เซอร์เครื่องนี้ ไฟล์ฐานข้อมูลลูกค้าแบบเดิม (มีชีต ทะเบียนบริษัท) ยังใช้ได้เหมือนเดิม`}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => void download('แม่แบบใบรับรอง_CFO.xlsx', templateSheets())} className="btn">ดาวน์โหลดแม่แบบ</button>
        <button onClick={exportNow} className="btn">ส่งออกข้อมูลปัจจุบัน</button>
      </div>

      {busy && <span className="t-link" style={{ fontSize: 14 }} role="status">กำลังบันทึก…</span>}
      {err && <Notice kind="error" role="alert">{err}</Notice>}
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
          <ChangeReport log={plan.log} warnings={plan.warnings} />
          {!canSave && <span className="t-meta">บัญชีนี้นำเข้าข้อมูลไม่ได้ ดูตัวอย่างได้เท่านั้น</span>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => void save()} disabled={!canSave || !toSave || busy} className="btn pri sm">บันทึกเข้าระบบ</button>
            <button onClick={() => setPick(null)} className="quiet">ยกเลิก</button>
          </div>
        </div>
      )}

      {result && (
        <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Notice kind={resultKind(result.msg)} role={resultKind(result.msg) === 'error' ? 'alert' : 'status'}>{result.msg}</Notice>
          {result.log.length > 0 && (
            <>
              <span className="t-name">{`${result.name} · ผลการบันทึก`}</span>
              <ChangeReport log={result.log} warnings={result.warnings} />
            </>
          )}
          <button onClick={() => setResult(null)} className="quiet" style={{ alignSelf: 'flex-start' }}>ซ่อนผลการบันทึก</button>
        </div>
      )}

      {/* a save of new certificates only leaves the base as it was, but its waiting rows are still undone here */}
      {(e.base.source === 'upload' || e.certImports.length > 0) && canSet && <button onClick={() => e.revertUpload()} className="lnk" style={{ alignSelf: 'flex-start' }}>กลับไปใช้ไฟล์ข้อมูลต้นฉบับของเว็บ</button>}
    </Block>
  );
}
