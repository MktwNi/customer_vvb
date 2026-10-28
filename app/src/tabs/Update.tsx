import { type FormEvent, type ReactNode, useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dtTh, fmtN, gccCode, isoTh, todayISO } from '../lib/format';
import type { Company, SyncCfg } from '../lib/types';
import { Notice, PageHead, labelCol } from '../components/ui';
import { SelField } from '../components/Select';
import { TeamSyncCard } from '../components/TeamSync';
import { RegistryXlsx } from '../components/RegistryXlsx';
import { Icon } from '../components/icons';
import { canAcceptReview, missingFields, type ReviewRec } from '../lib/sheetReview';
import { isLocalId } from '../lib/teamSync';

/** One block of the page (design §8): title, one grey status line, the one action at the right; the long
 *  explanation folds under "รายละเอียด". */
export function UpdSection({ title, status, action, more, children, id }: { title: string; status?: ReactNode; action?: ReactNode; more?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <section id={id} className="card upd-sec" tabIndex={id ? -1 : undefined}>
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
/** A date on the queue's rows stays on one line: no break between the day, the month and the year. */
const nbDate = (iso: string) => isoTh(iso).replace(/ /g, ' ');

/** Runs a queue action and keeps the focus where it was: after the action the control at the same place in the queue
 *  (the next row's or the next company's button, else the one before it) takes the focus, so a keyboard user keeps
 *  their place; with none left, the queue's heading does. */
function queueAct(btn: HTMLElement, run: () => void) {
  const at = queueControls('tgo-queue').indexOf(btn as HTMLButtonElement);
  run();
  requestAnimationFrame(() => keepFocus('tgo-queue', at));
}
/** The enabled buttons of a queue block, in order. */
const queueControls = (id: string) => Array.from(document.getElementById(id)?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
function keepFocus(id: string, at: number) {
  const ctrls = queueControls(id);
  const el = document.getElementById(id);
  if (ctrls.length) ctrls[Math.max(0, Math.min(at, ctrls.length - 1))].focus();
  else el?.focus();
}

/** The TGO review queue (lib/tgoSync.ts): what the pull found, by company, waiting for an approver. Accept or
 *  reject per certificate or per company; a viewer reads it and gets no buttons. Every waiting row is listed, a
 *  page of companies at a time. Rejecting a whole company asks first: a rejected certificate does not come back. */
export function TgoQueue({ canEdit }: { canEdit: boolean }) {
  const { engine: e } = useApp();
  const [page, setPage] = useState(0);
  const [sure, setSure] = useState<string | null>(null); // the company whose rejection waits for a yes
  const [msg, setMsg] = useState(''); // what the last action did, read out by a screen reader
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
  const accept = (ids: string[]) => {
    const n = e.approveTgo(ids);
    setMsg(n ? `รับแล้ว ${fmtN(n)} ใบ` : '');
  };
  const reject = (ids: string[]) => {
    const n = e.rejectTgo(ids);
    setSure(null);
    setMsg(n ? `ไม่รับแล้ว ${fmtN(n)} ใบ` : '');
  };
  const turn = (to: number, btn: HTMLElement) => {
    const at = queueControls('tgo-pager').indexOf(btn as HTMLButtonElement);
    setPage(to);
    requestAnimationFrame(() => keepFocus('tgo-pager', at));
  };
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
      more="ใบที่ดึงมา และใบรับรองใหม่ที่บันทึกจากชีตใบรับรอง CFO จะรอตรวจที่นี่ทั้งทีม ยังไม่เข้าทะเบียนจนกว่าจะกดรับ การรับใบของบริษัทที่ยังไม่มีในทะเบียนจะสร้างบริษัทใหม่ให้ทุกคนเห็นพร้อมกัน (บริษัทเดียวกันในรอบเดียวกันเป็นบริษัทเดียว) ไม่รับแล้วจะไม่ถูกดึงเป็นรายการใหม่อีก ไม่มีอะไรเข้าทะเบียน"
    >
      <div role="status" aria-live="polite" className="t-meta">{msg}</div>
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
                  <button onClick={(ev) => queueAct(ev.currentTarget, () => accept(ids))} className="btn sm" aria-label={`รับทั้งบริษัท ${g.org}`}>รับทั้งบริษัท</button>
                  <button onClick={() => setSure(g.org)} className="quiet tgo-act" aria-label={`ไม่รับทั้งบริษัท ${g.org}`} aria-expanded={sure === g.org}>ไม่รับทั้งบริษัท</button>
                </span>
              )}
            </div>
            {canEdit && sure === g.org && (
              <div role="group" aria-label={`ยืนยันไม่รับ ${g.org}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', paddingLeft: 12 }}>
                <span className="t-meta">{`ไม่รับ ${fmtN(ids.length)} ใบของบริษัทนี้ ใบที่ไม่รับแล้วจะไม่กลับมาในรายการรอตรวจ`}</span>
                <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                  <button onClick={(ev) => queueAct(ev.currentTarget, () => reject(ids))} className="quiet tgo-act">ยืนยันไม่รับ</button>
                  <button onClick={() => setSure(null)} className="quiet tgo-act" autoFocus>ยกเลิก</button>
                </span>
              </div>
            )}
            {g.rows.map((r) => {
              const expired = !!r.rec.ex && r.rec.ex < today;
              return (
                <div key={r.rid} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', paddingLeft: 12 }}>
                  <span className="t-meta">{r.rec.cert}</span>
                  <span className="t-meta">{`${r.rec.act || 'ไม่ระบุกิจกรรม'} · ${r.rec.prov || 'ไม่ระบุจังหวัด'} · อนุมัติ ${r.rec.ap ? nbDate(r.rec.ap) : '—'} · ${expired ? 'หมดอายุแล้ว ' : 'ถึง '}${r.rec.ex ? nbDate(r.rec.ex) : '—'}`}</span>
                  {canEdit && (
                    <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                      <button onClick={(ev) => queueAct(ev.currentTarget, () => accept([r.rid]))} className="quiet tgo-act" aria-label={`รับใบ ${r.rec.cert}`}>รับ</button>
                      <button onClick={(ev) => queueAct(ev.currentTarget, () => reject([r.rid]))} className="quiet tgo-act" aria-label={`ไม่รับใบ ${r.rec.cert}`}>ไม่รับ</button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {pages > 1 && (
        <div id="tgo-pager" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--divider)', paddingTop: 10 }}>
          <span className="t-meta">{`หน้า ${cur + 1} จาก ${fmtN(pages)} · บริษัทที่ ${fmtN(cur * QUEUE_PAGE + 1)}–${fmtN(Math.min(groups.length, (cur + 1) * QUEUE_PAGE))} จาก ${fmtN(groups.length)}`}</span>
          <button onClick={(ev) => turn(cur - 1, ev.currentTarget)} disabled={cur === 0} className="quiet tgo-act">ก่อนหน้า</button>
          <button onClick={(ev) => turn(cur + 1, ev.currentTarget)} disabled={cur >= pages - 1} className="quiet tgo-act">ถัดไป</button>
        </div>
      )}
    </UpdSection>
  );
}

/** A search key for a company: lower case, no spaces; the GCC code is matched without its dash too. */
const coKey = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** One row of the review list (R16): its reason, the certificate, the organisation, the GCC code as the sheet wrote it and
 *  the sheet's values. A reviewer picks an existing company (search by name or GCC code), then "รับ" (needs the company and
 *  the required fields) or "ไม่รับ". A viewer reads the row only. */
function SheetReviewItem({ rec, canEdit, companies, onDone }: { rec: ReviewRec; canEdit: boolean; companies: Company[]; onDone: (msg: string) => void }) {
  const { engine: e } = useApp();
  const [q, setQ] = useState('');
  const [co, setCo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = co != null ? companies.find((c) => c.id === co) : undefined;
  const k = coKey(q);
  const kd = k.replace(/-/g, '');
  const found = k ? companies.filter((c) => coKey(c.name).includes(k) || coKey(gccCode(c.id)).replace(/-/g, '').includes(kd)).slice(0, 8) : [];
  const missing = missingFields(rec.f);
  const ok = canAcceptReview(rec, co);
  const decide = async (accept: boolean) => {
    if (accept && co == null) return;
    setBusy(true);
    const msg = accept ? await e.acceptReview(rec.id, co as number) : e.rejectReview(rec.id);
    setBusy(false);
    onDone(msg);
  };
  const vals = Object.entries(rec.vals);
  return (
    <div style={{ borderTop: '1px solid var(--divider)', padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6, overflowWrap: 'anywhere' }}>
      <span className="co-name dense">{rec.org || 'ไม่ระบุชื่อองค์กร'}</span>
      <span className="t-meta">{`เหตุผล ${rec.reason} · เลขที่ใบรับรอง ${rec.cert || 'ไม่ระบุ'} · รหัส GCC ตามชีต ${rec.gcc || 'ไม่ได้กรอก'}`}</span>
      <span className="t-meta">{`จากไฟล์ ${rec.file} · ${dtTh(rec.at)}`}</span>
      <details className="upd-more">
        <summary className="lnk">{`ค่าในชีต (${fmtN(vals.length)} คอลัมน์)`}</summary>
        <div className="upd-more-b">
          {vals.map(([h, v]) => <span key={h}>{`${h}: ${v}`}</span>)}
        </div>
      </details>
      {canEdit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {picked ? (
            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
              <span className="t-meta">เลือกแล้ว</span>
              <span className="co-name dense">{`${gccCode(picked.id)} · ${picked.name}`}</span>
              <button type="button" className="quiet tgo-act" onClick={() => setCo(null)}>เปลี่ยนบริษัท</button>
            </span>
          ) : (
            <>
              <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="ค้นหาบริษัทจากชื่อหรือรหัส GCC" aria-label={`ค้นหาบริษัทสำหรับใบ ${rec.cert}`} className="fld" style={{ maxWidth: 420 }} />
              {found.map((c) => (
                <button type="button" key={c.id} className="quiet tgo-act" style={{ textAlign: 'left' }} onClick={() => setCo(c.id)} aria-label={`เลือก ${gccCode(c.id)} ${c.name}`}>
                  {`${gccCode(c.id)} · ${c.name}`}
                </button>
              ))}
              {k ? (!found.length && <span className="t-meta">ไม่พบบริษัทนี้ในระบบ</span>) : <span className="t-meta">ยังไม่ได้เลือกบริษัท</span>}
            </>
          )}
          {missing.length > 0 && <span className="t-meta">{missing.join(' · ')}</span>}
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void decide(true)} disabled={!ok || busy} className="btn pri sm" aria-label={`รับใบ ${rec.cert}`}>รับ</button>
            <button type="button" onClick={() => void decide(false)} disabled={busy} className="quiet tgo-act" aria-label={`ไม่รับใบ ${rec.cert}`}>ไม่รับ</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** The review list of the certificate sheet (R16, lib/sheetReview.ts): the rows a sheet save could not apply, kept for the
 *  whole team, next to the TGO queue. Decided rows leave the list; a viewer reads it and gets no buttons. */
export function SheetReview({ canEdit }: { canEdit: boolean }) {
  const { engine: e } = useApp();
  useEngineVersion();
  const [msg, setMsg] = useState(''); // what the last decision did, read out by a screen reader
  const recs = e.reviewRecs();
  const waiting = recs.filter((r) => r.st === 'p');
  const accepted = recs.filter((r) => r.st === 'a').length, rejected = recs.filter((r) => r.st === 'r').length;
  // a device-local company (ids from 900000) is not the team's, so a row cannot be attached to it (R16)
  const companies = e.B.companies.filter((c) => !isLocalId(c.id));
  return (
    <UpdSection
      id="sheet-review"
      title="รอตรวจสอบจากไฟล์ชีต"
      status={
        <span className="upd-line">
          <span><span className="t-muted">รอตรวจ</span> {fmtN(waiting.length)} แถว</span>
          <span><span className="t-muted">รับแล้ว</span> {fmtN(accepted)} แถว</span>
          <span><span className="t-muted">ไม่รับ</span> {fmtN(rejected)} แถว</span>
        </span>
      }
      more="แถวจากไฟล์ใบรับรอง CFO ที่บันทึกเข้าระบบไม่ได้ จะมาอยู่ที่นี่แทนที่จะถูกทิ้ง ได้แก่ หาบริษัทในระบบไม่พบ รหัส GCC ไม่พบหรือไม่ตรงกับชื่อ มีบริษัทชื่อเดียวกันหลายแห่ง หรือรหัส GCC ไม่ตรงกับบริษัทของใบรับรองที่มีอยู่แล้ว ระบบไม่สร้างบริษัทใหม่ให้ เลือกบริษัทที่มีอยู่แล้ว แล้วกด “รับ” ระบบจะบันทึกแถวนั้นให้บริษัทที่เลือก เหมือนแถวปกติของไฟล์ (ใบใหม่เข้ารอตรวจ TGO ใบที่มีอยู่แล้วแก้เฉพาะช่องที่มีค่าในชีต) กด “ไม่รับ” แล้วแถวนั้นจะไม่ถูกเพิ่มซ้ำจากไฟล์ใดอีก"
    >
      <div role="status" aria-live="polite" className="t-meta">{msg}</div>
      {!canEdit && <span className="t-meta">บัญชีของคุณดูรายการนี้ได้อย่างเดียว การรับหรือไม่รับทำได้เฉพาะผู้ที่แก้ข้อมูลลูกค้าได้</span>}
      {!waiting.length && <span className="empty">ไม่มีแถวที่รอตรวจจากไฟล์ชีต</span>}
      {waiting.map((r) => (
        <SheetReviewItem key={r.id} rec={r} canEdit={canEdit} companies={companies} onDone={setMsg} />
      ))}
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
  const y = e.sy, sc = e.syncCfg(), mon = e.monCfg();
  const me = e.me();
  const ownN: Record<string, number> = {};
  Object.values(C.owners).forEach((v) => (ownN[v] = (ownN[v] || 0) + 1));
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
      <RegistryXlsx />

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
            <span>ลิงก์ข้อมูล: ลิงก์เว็บแอปอัปเดตรายชื่อ CFO (ลงท้าย /exec) · เว้นว่าง = ใช้ลิงก์ตั้งต้นของระบบ</span>
            <input defaultValue={sc.feed} onBlur={(ev) => e.saveSync({ feed: ev.target.value.trim() })} placeholder="https://script.google.com/macros/s/…/exec" aria-label="ลิงก์ข้อมูล" className="fld" style={{ maxWidth: 560 }} />
            <span>Proxy (ขั้นสูง ตอนนี้ยังไม่ถูกใช้ เว็บอ่านผ่านลิงก์ข้อมูลเสมอ): ใช้ {'{u}'} แทนตำแหน่ง URL · ตัวอย่างสำหรับ Cloudflare Worker อยู่ที่ project/tools/tgo-proxy-worker.js</span>
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
      <SheetReview canEdit={canEdit} />

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
