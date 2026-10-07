import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dtTh, isoTh } from '../lib/format';
import { norm } from '../lib/core';
import {
  DEAL_STAGE, KIND_TH, NOTE_MAX, STAGE_TH, beYear, dealMoney, dealStatus, docsOf, fmtMoney, money, stepOf,
  type Deal, type DealDoc, type DocKind,
} from '../lib/sales';
import { Modal } from '../tabs/Sales';
import { DocAttach } from './DocAttach';
import { heroGrad, inputStyle, labelCol, selectStyle } from './ui';

const box: CSSProperties = { background: '#fff', border: '1px solid #E3E7F1', borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 };
const kicker: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#2A4BE0' };
const chip = (on: boolean, c: [string, string]): CSSProperties => ({ cursor: 'pointer', fontSize: 12.5, padding: '4px 11px', borderRadius: 999, border: `1.5px solid ${on ? c[1] : '#D5DBEA'}`, background: on ? c[0] : '#fff', color: on ? c[1] : '#475069' });
const small: CSSProperties = { cursor: 'pointer', height: 32, padding: '0 12px', borderRadius: 999, border: '1.5px solid #D5DBEA', background: '#fff', color: '#0E1430', fontSize: 12.5 };
const TARGET_TH = { forecast: 'นับเป็น Forecast', actual: 'นับเป็น Actual', none: 'ไม่นับยอด' };

/** Date + note editor for one stage (from the table). */
export function StepEditor({ dealId, stage, onClose }: { dealId: string; stage: string; onClose: () => void }) {
  const { engine: e } = useApp();
  const d = e.sales.deals[dealId];
  const st = stepOf(e.sales, dealId, stage);
  const [date, setDate] = useState(st.d);
  const [note, setNote] = useState(st.n);
  if (!d) return null;
  const save = (n = note, dt = date) => {
    e.setStep(dealId, stage, { d: dt, n });
    onClose();
  };
  return (
    <Modal title={`${stage}${STAGE_TH[stage] ? ' · ' + STAGE_TH[stage] : ''}`} onClose={onClose}>
      <span style={{ fontSize: 13.5, color: '#475069' }}>{d.client}</span>
      <label style={labelCol}>
        วันที่
        <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} style={inputStyle} />
      </label>
      {stage === DEAL_STAGE && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => save('YES')} style={{ ...small, borderColor: '#14633F', color: '#14633F' }}>✓ ปิดการขายได้ (YES)</button>
          <button onClick={() => save('NO')} style={{ ...small, borderColor: '#8A2B12', color: '#8A2B12' }}>✕ ไม่สำเร็จ (NO)</button>
        </div>
      )}
      <label style={labelCol}>
        {stage === DEAL_STAGE ? 'ผล (YES / NO) หรือหมายเหตุ เช่น รอผู้บริหารอนุมัติ' : 'โน้ต'}
        <textarea value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={NOTE_MAX} rows={5} autoFocus style={{ ...inputStyle, height: 'auto', padding: 10, resize: 'vertical', lineHeight: 1.6 }} />
      </label>
      <span style={{ fontSize: 12, color: '#5E6680' }}>ใส่โน้ตโดยไม่ใส่วันที่ ระบบใส่วันนี้ให้ · วันที่ที่ผ่านมาแล้วนับเป็นวันที่ติดต่อล่าสุด</span>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {(st.d || st.n) && <button onClick={() => save('', '')} style={{ ...small, color: '#8A2B12' }}>ล้างขั้นนี้</button>}
        <button onClick={onClose} style={small}>ยกเลิก</button>
        <button onClick={() => save()} style={{ ...small, background: '#0A1A86', borderColor: '#0A1A86', color: '#fff' }}>บันทึก</button>
      </div>
    </Modal>
  );
}

/** Text field that saves when it loses focus (so typing doesn't write a change per keystroke). */
function Field({ label, value, onSave, type = 'text', list, placeholder }: { label: string; value: string; onSave: (v: string) => void; type?: string; list?: string; placeholder?: string }) {
  return (
    <label style={labelCol}>
      {label}
      <input key={value} type={type} defaultValue={value} list={list} placeholder={placeholder} onBlur={(ev) => ev.target.value !== value && onSave(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} style={inputStyle} />
    </label>
  );
}

function LinkCompany({ d }: { d: Deal }) {
  const { engine: e, set } = useApp();
  const [q, setQ] = useState('');
  const found = useMemo(() => {
    const k = norm(q);
    if (k.length < 3) return [];
    return e.B.companies.filter((c) => norm(c.name).includes(k)).slice(0, 6);
  }, [q, e]);
  const c = d.gid != null ? e.company(d.gid) : undefined;
  if (c)
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5 }}>
        <span style={{ flex: 1, minWidth: 200 }}>
          เชื่อมกับบริษัท <b style={{ fontWeight: 500 }}>{c.name}</b> <span style={{ color: '#5E6680' }}>({c.code})</span>
        </span>
        <button onClick={() => set({ sel: c.id, dTab: 'info' })} style={small}>เปิดหน้าบริษัท</button>
        <button onClick={() => e.updateDeal(d.id, { gid: null })} style={{ ...small, color: '#475069' }}>ยกเลิกการเชื่อม</button>
      </div>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 13, color: '#475069' }}>ยังไม่ได้เชื่อมกับบริษัทในทะเบียน — เชื่อมแล้วจะเห็นสถานะ CFO / GI ข้อมูลติดต่อ และนัดหมายร่วมกัน</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="พิมพ์ชื่อบริษัทเพื่อค้นในทะเบียน" aria-label="ค้นบริษัทในทะเบียน" style={{ ...inputStyle, flex: '1 1 220px', minWidth: 0 }} />
        <button onClick={() => set({ addCust: { deal: false, name: d.client, link: d.id } })} style={small}>เพิ่มเป็นลูกค้าใหม่ในทะเบียน</button>
      </div>
      {found.map((x) => (
        <button key={x.id} onClick={() => e.updateDeal(d.id, { gid: x.id })} className="h-bg" style={{ cursor: 'pointer', border: '1px solid #E3E7F1', borderRadius: 10, background: '#fff', textAlign: 'left', padding: '8px 12px', fontSize: 13.5, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span>{x.name}</span>
          <span style={{ color: '#5E6680', fontSize: 12 }}>{x.code} · เชื่อม</span>
        </button>
      ))}
    </div>
  );
}

function DocRow({ d, doc }: { d: Deal; doc: DealDoc }) {
  const { engine: e } = useApp();
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState('');
  const open = async () => {
    setBusy('กำลังเปิด…');
    try {
      const b = await e.docBlob(doc);
      const url = URL.createObjectURL(b);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setBusy('');
    } catch (err) {
      setBusy((err as Error)?.message || String(err));
    }
  };
  return (
    <div style={{ border: '1px solid #E3E7F1', borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{KIND_TH[doc.kind]}{doc.docNo ? ' ' + doc.docNo : ''}</span>
          <span style={{ fontSize: 12, color: '#5E6680', wordBreak: 'break-all' }}>{doc.name} · {(doc.size / 1024).toFixed(0)} KB{doc.docDate ? ' · ลงวันที่ ' + isoTh(doc.docDate) : ''}</span>
          <span style={{ fontSize: 12, color: doc.fileId ? '#14633F' : '#6B4100' }}>{doc.fileId ? '☁ อยู่ใน Drive ของทีม' : '💻 อยู่ในเครื่องที่แนบ รออัปโหลดขึ้น Drive ของทีม'} · แนบโดย {doc.by || '—'} {dtTh(doc.at)}</span>
        </span>
        <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 500 }}>{doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : '—'}</span>
          <span style={{ fontSize: 11.5, color: doc.target === 'none' ? '#5E6680' : '#14633F' }}>{doc.target !== 'none' ? '✓ ' : ''}{TARGET_TH[doc.target]}</span>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={open} style={small}>เปิดไฟล์</button>
        <button onClick={() => setEdit(!edit)} style={small}>{edit ? 'ปิด' : 'แก้ยอด / ประเภท'}</button>
        <button onClick={() => window.confirm(`ลบเอกสาร "${doc.name}"?`) && e.deleteDoc(d.id, doc.id)} style={{ ...small, color: '#8A2B12' }}>ลบ</button>
        {busy && <span style={{ fontSize: 12, color: '#475069' }}>{busy}</span>}
      </div>
      {edit && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.currentTarget);
            const amount = money(fd.get('amount'));
            e.updateDoc(d.id, doc.id, { amount, target: amount == null ? 'none' : (String(fd.get('target')) as DealDoc['target']), kind: String(fd.get('kind')) as DocKind, docNo: String(fd.get('docNo') || ''), basis: amount === doc.amount ? doc.basis : 'manual' });
            setEdit(false);
          }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, alignItems: 'end' }}
        >
          <label style={labelCol}>ยอด (บาท)<input name="amount" defaultValue={doc.amount ?? ''} inputMode="decimal" style={inputStyle} /></label>
          <label style={labelCol}>นับเป็น<select name="target" defaultValue={doc.target} style={selectStyle}><option value="forecast">Forecast</option><option value="actual">Actual</option><option value="none">ไม่นับยอด</option></select></label>
          <label style={labelCol}>ประเภท<select name="kind" defaultValue={doc.kind} style={selectStyle}>{(Object.keys(KIND_TH) as DocKind[]).map((k) => <option key={k} value={k}>{KIND_TH[k]}</option>)}</select></label>
          <label style={labelCol}>เลขที่เอกสาร<input name="docNo" defaultValue={doc.docNo} style={inputStyle} /></label>
          <button type="submit" style={{ ...small, height: 40, background: '#0A1A86', borderColor: '#0A1A86', color: '#fff' }}>บันทึก</button>
        </form>
      )}
    </div>
  );
}

export function DealPanel() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const d = ui.deal ? e.sales.deals[ui.deal] : undefined;
  const [attach, setAttach] = useState<DocKind | null>(null);
  useEffect(() => setAttach(null), [ui.deal]);
  if (!d) return null;
  const S = e.sales, C = S.cfg;
  const close = () => set({ deal: null });
  const st = dealStatus(S, d);
  const m = dealMoney(S, d);
  const docs = docsOf(S, d.id);
  const up = (p: Partial<Deal>) => e.updateDeal(d.id, p);
  const toggle = (k: 'source' | 'service', x: string) => up({ [k]: d[k].includes(x) ? d[k].filter((y) => y !== x) : [...d[k], x] });
  const log = Object.values(S.log).filter((l) => l.deal === d.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  const referrals = [...new Set(Object.values(S.deals).map((x) => x.referral).filter(Boolean))];
  const years = [...new Set([beYear(), String(+beYear() + 1), String(+beYear() - 1), d.year])].sort();
  const fcDoc = d.fcDoc ? docs.find((x) => x.id === d.fcDoc) : undefined;
  const acDocs = docs.filter((x) => x.target === 'actual' && x.amount != null);

  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,60,.38)', zIndex: 38 }} />
      <aside role="dialog" aria-modal="true" aria-label={d.client} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(720px,100vw)', background: '#F4F6FC', zIndex: 39, overflowY: 'auto', boxShadow: '-20px 0 60px -20px rgba(4,10,60,.4)' }}>
        <div style={{ background: heroGrad, color: '#fff', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#C9D4FF' }}>Sales Tracker · ปี {d.year} · {d.section || 'ไม่ระบุหมวด'}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => up({ jobStatus: d.jobStatus === 'closed' ? 'open' : 'closed' })} style={{ cursor: 'pointer', height: 36, padding: '0 14px', borderRadius: 999, border: 0, background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 13 }}>{d.jobStatus === 'closed' ? 'เปิดงานอีกครั้ง' : 'ปิดงาน'}</button>
              <button onClick={close} aria-label="ปิด" style={{ cursor: 'pointer', width: 36, height: 36, borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 18 }}>×</button>
            </div>
          </div>
          <input key={d.client} defaultValue={d.client} aria-label="ชื่อลูกค้า" onBlur={(ev) => ev.target.value.trim() && ev.target.value !== d.client && up({ client: ev.target.value })} onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} style={{ fontSize: 22, fontWeight: 500, background: 'transparent', border: 0, borderBottom: '1px dashed rgba(255,255,255,.35)', color: '#fff', padding: '2px 0', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#DCE6FF' }}>
            <span>สถานะ <b style={{ fontWeight: 500, color: '#fff' }}>{st.overall}</b></span>
            <span>Forecast <b style={{ fontWeight: 500, color: '#fff' }}>{m.forecast != null ? fmtMoney(m.forecast) : '—'}</b>{m.fcConfirmed ? ' ✓' : ''}</span>
            <span>Actual <b style={{ fontWeight: 500, color: '#fff' }}>{m.actual != null ? fmtMoney(m.actual) : '—'}</b>{m.acConfirmed ? ' ✓' : ''}</span>
            {d.closedDate && <span>ปิดงาน {isoTh(d.closedDate)}</span>}
          </div>
        </div>

        <div style={{ padding: '18px 24px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={box}>
            <span style={kicker}>บริษัท</span>
            <LinkCompany d={d} />
          </div>

          <div style={box}>
            <span style={kicker}>ข้อมูลติดต่อ</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
              <Field label="ผู้ติดต่อ" value={d.contactName} onSave={(v) => up({ contactName: v })} />
              <Field label="เบอร์โทร" value={d.phone} onSave={(v) => up({ phone: v })} type="tel" />
              <Field label="อีเมล" value={d.email} onSave={(v) => up({ email: v })} type="email" />
              <Field label="ผู้รับผิดชอบ" value={d.resp} onSave={(v) => up({ resp: v })} list="sl-team" />
              <Field label="แหล่งที่มา (Referral)" value={d.referral} onSave={(v) => up({ referral: v })} list="sl-ref" />
              <label style={labelCol}>
                วันที่ติดต่อล่าสุด
                <input type="date" value={d.contactDate} onChange={(ev) => up({ contactDate: ev.target.value })} style={inputStyle} />
              </label>
              <label style={labelCol}>
                หมวด
                <select value={d.section} onChange={(ev) => e.moveDeal(d.id, ev.target.value, null)} style={selectStyle}>
                  {[...new Set([...C.sections, d.section])].map((x) => <option key={x} value={x}>{x || 'ไม่ระบุหมวด'}</option>)}
                </select>
              </label>
              <label style={labelCol}>
                ปี (พ.ศ.)
                <select value={d.year} onChange={(ev) => up({ year: ev.target.value })} style={selectStyle}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
            <datalist id="sl-team">{e.crm.team.map((x) => <option key={x} value={x} />)}</datalist>
            <datalist id="sl-ref">{referrals.map((x) => <option key={x} value={x} />)}</datalist>
          </div>

          <div style={box}>
            <span style={kicker}>SOURCE (ช่องทาง)</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {C.sources.map((x) => <button key={x} aria-pressed={d.source.includes(x)} onClick={() => toggle('source', x)} style={chip(d.source.includes(x), ['#E6ECFD', '#1A2FB0'])}>{d.source.includes(x) ? '✓ ' : ''}{x}</button>)}
            </div>
            <span style={kicker}>Services (บริการ)</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {C.services.map((x) => <button key={x} aria-pressed={d.service.includes(x)} onClick={() => toggle('service', x)} style={chip(d.service.includes(x), ['#DDF5F1', '#0B6E66'])}>{d.service.includes(x) ? '✓ ' : ''}{x}</button>)}
            </div>
          </div>

          <div style={box}>
            <span style={kicker}>ยอดเงิน และเอกสารยืนยัน</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Field label="Forecast (บาท) — ยอดที่คาดว่าจะได้" value={d.forecast == null ? '' : String(d.forecast)} onSave={(v) => up({ forecast: money(v) })} placeholder={fcDoc ? `ใช้ยอดจากเอกสาร ${fmtMoney(fcDoc.amount)}` : 'พิมพ์เอง หรือแนบใบเสนอราคา'} />
                <span style={{ fontSize: 12, color: fcDoc ? '#14633F' : '#6B4100' }}>{fcDoc ? `✓ ใช้ยอดจาก${KIND_TH[fcDoc.kind]} ${fcDoc.docNo} = ${fmtMoney(fcDoc.amount)} บาท` : d.forecast != null ? 'ยังไม่ได้ยืนยันด้วยเอกสาร' : ''}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Field label="Actual (บาท) — ยอดที่ได้จริง" value={d.actual == null ? '' : String(d.actual)} onSave={(v) => up({ actual: money(v) })} placeholder={acDocs.length ? `ใช้ยอดรวมจากเอกสาร ${fmtMoney(m.actual)}` : 'พิมพ์เอง หรือแนบใบแจ้งหนี้'} />
                <span style={{ fontSize: 12, color: acDocs.length ? '#14633F' : '#6B4100' }}>{acDocs.length ? `✓ รวมจากเอกสาร ${acDocs.length} ฉบับ = ${fmtMoney(m.actual)} บาท` : d.actual != null ? 'ยังไม่ได้ยืนยันด้วยเอกสาร' : ''}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setAttach('quotation')} style={small}>📎 แนบใบเสนอราคา</button>
              <button onClick={() => setAttach('invoice')} style={small}>📎 แนบใบแจ้งหนี้</button>
              <button onClick={() => setAttach('receipt')} style={small}>📎 แนบใบเสร็จ / ใบกำกับภาษี</button>
              <button onClick={() => setAttach('other')} style={small}>📎 เอกสารอื่น</button>
            </div>
            {docs.map((doc) => <DocRow key={doc.id} d={d} doc={doc} />)}
            <span style={{ fontSize: 12, color: '#5E6680', lineHeight: 1.6 }}>ระบบอ่านยอดเงินจากเอกสารให้ คุณตรวจแล้วกดยืนยัน ยอดจากใบเสนอราคาเป็น Forecast และยอดจากใบแจ้งหนี้รวมกันเป็น Actual (แก้ได้)</span>
          </div>

          <div style={box}>
            <span style={kicker}>ขั้นตอนการติดตาม</span>
            {C.stages.map((p) => {
              const x = stepOf(S, d.id, p);
              return (
                <div key={p} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,150px) 150px minmax(0,1fr)', gap: 8, alignItems: 'start', borderTop: '1px solid #EEF1F8', paddingTop: 8 }} className="sl-steprow">
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p}</span>
                    <span style={{ fontSize: 11.5, color: '#5E6680' }}>{STAGE_TH[p] || ''}</span>
                  </span>
                  <input type="date" value={x.d} aria-label={p + ' วันที่'} onChange={(ev) => e.setStep(d.id, p, { d: ev.target.value, n: x.n })} style={{ ...inputStyle, height: 36, fontSize: 13 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {p === DEAL_STAGE && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => e.setStep(d.id, p, { d: x.d, n: 'YES' })} style={{ ...small, height: 28, borderColor: '#14633F', color: '#14633F' }}>✓ YES</button>
                        <button onClick={() => e.setStep(d.id, p, { d: x.d, n: 'NO' })} style={{ ...small, height: 28, borderColor: '#8A2B12', color: '#8A2B12' }}>✕ NO</button>
                      </span>
                    )}
                    <textarea key={x.n} defaultValue={x.n} aria-label={p + ' โน้ต'} rows={x.n.split('\n').length > 2 ? 4 : 2} maxLength={NOTE_MAX} placeholder="โน้ต…" onBlur={(ev) => ev.target.value !== x.n && e.setStep(d.id, p, { d: x.d, n: ev.target.value })} style={{ ...inputStyle, height: 'auto', padding: '7px 10px', resize: 'vertical', lineHeight: 1.55, fontSize: 13 }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={box}>
            <span style={kicker}>ประวัติ</span>
            {!log.length && <span style={{ fontSize: 13, color: '#8A93AD' }}>ยังไม่มี</span>}
            {log.map((l) => (
              <div key={l.id} style={{ fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid #EEF1F8', paddingTop: 6 }}>
                <span style={{ color: '#5E6680' }}>{dtTh(l.at)}</span>
                <span style={{ color: '#0E1430' }}>{l.by || '—'}</span>
                <span style={{ fontWeight: 500 }}>{l.action}</span>
                <span style={{ color: '#475069' }}>{l.detail}</span>
              </div>
            ))}
          </div>

          <button onClick={() => window.confirm(`ลบ "${d.client}" ออกจาก Sales Tracker? (ลบทั้งขั้นตอน โน้ต และเอกสารที่แนบ ทุกเครื่องในทีม)`) && (e.deleteDeal(d.id), close())} style={{ ...small, alignSelf: 'flex-start', color: '#8A2B12' }}>
            ลบรายการนี้
          </button>
        </div>
      </aside>
      {attach && <DocAttach deal={d} kind={attach} onClose={() => setAttach(null)} />}
    </>
  );
}

