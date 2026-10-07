import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../state';
import { isoTh } from '../lib/format';
import { norm } from '../lib/core';
import { KIND_TH, fmtMoney, money, type Deal, type DealDoc, type DocKind, type DocTarget } from '../lib/sales';
import type { DocFacts } from '../lib/docExtract';
import { Modal } from '../tabs/Sales';
import { DOC_ACCEPT, DOC_MAX_BYTES, docMime } from '../lib/teamFiles';
import { prefs } from '../lib/storage';
import { Notice, inputStyle, labelCol, selectStyle } from './ui';

const small: CSSProperties = { cursor: 'pointer', height: 36, padding: '0 14px', borderRadius: 999, border: '1.5px solid #D5DBEA', background: '#fff', color: '#0E1430', fontSize: 13 };
const BASIS_PREF = 'gcc-doc-basis';
const defaultTarget = (k: DocKind): DocTarget => (k === 'quotation' ? 'forecast' : k === 'invoice' ? 'actual' : 'none');

/** Two names refer to the same company? (ignores company-type words and punctuation) */
function sameParty(a: string, b: string) {
  const strip = (s: string) => norm(s).replace(/บริษัท|จำกัด|มหาชน|ห้างหุ้นส่วน|co|ltd|plc|company|limited/gi, '');
  const x = strip(a), y = strip(b);
  return !x || !y || x.includes(y) || y.includes(x);
}

/**
 * Attach a quotation / invoice: the document is read in the browser (PDF text, or OCR for scans and
 * photos), the amounts found are shown, and nothing is saved until the user confirms the figure.
 */
export function DocAttach({ deal, kind: kind0, onClose }: { deal: Deal; kind: DocKind; onClose: () => void }) {
  const { engine: e } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [prog, setProg] = useState<{ msg: string; pct?: number } | null>(null);
  const [facts, setFacts] = useState<DocFacts | null>(null);
  const [method, setMethod] = useState('');
  const [readErr, setReadErr] = useState('');
  const [kind, setKind] = useState<DocKind>(kind0);
  const [target, setTarget] = useState<DocTarget>(defaultTarget(kind0));
  const [basis, setBasis] = useState<DealDoc['basis']>('manual');
  const [amount, setAmount] = useState('');
  const [docNo, setDocNo] = useState('');
  const [docDate, setDocDate] = useState('');
  const [saving, setSaving] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => {
    abort.current?.abort();
  }, []);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const pick = async (f: File, forceOcr = false) => {
    abort.current?.abort();
    setFacts(null);
    setMethod('');
    setReadErr('');
    setSaving('');
    if (f.size > DOC_MAX_BYTES) {
      setReadErr('ไฟล์ใหญ่เกิน 10 MB');
      return;
    }
    if (!docMime(f)) {
      setReadErr('รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)');
      return;
    }
    setFile(f);
    // the preview gets the checked type, never what the file claims (an .html renamed to .pdf
    // must not open as a page of this site)
    setUrl(URL.createObjectURL(new Blob([f], { type: docMime(f) })));
    const ctl = new AbortController();
    abort.current = ctl;
    setProg({ msg: 'กำลังเปิดไฟล์…' });
    try {
      const [{ readDocText }, { analyzeDocText, factsScore }] = await Promise.all([import('../lib/docText'), import('../lib/docExtract')]).catch((e) => {
        // offline, or this page is older than the site (its chunks were replaced by a new version)
        throw new Error('โหลดตัวอ่านเอกสารไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้านี้', { cause: e });
      });
      const t = await readDocText(f, { signal: ctl.signal, forceOcr, onProgress: (msg, pct) => setProg({ msg, pct }), judge: (x) => factsScore(analyzeDocText(x)) });
      if (ctl.signal.aborted) return;
      const fx = analyzeDocText(t.text);
      setFacts(fx);
      setMethod(t.method);
      if (fx.kind) {
        setKind(fx.kind);
        setTarget(defaultTarget(fx.kind));
      }
      setDocNo(fx.docNo);
      setDocDate(fx.docDate);
      // the figure this person confirmed last time (with or before VAT, after withholding) when the document has it
      const pref = prefs.get<DealDoc['basis']>(BASIS_PREF, 'total');
      const byBasis = { total: fx.total, subtotal: fx.subtotal, netPay: fx.netPay, manual: null };
      const b: DealDoc['basis'] = byBasis[pref] != null ? pref : fx.total != null ? 'total' : 'manual';
      const best = byBasis[b] ?? fx.candidates[0]?.value ?? null;
      setBasis(b);
      setAmount(best != null ? String(best) : '');
      if (!t.text.trim()) setReadErr('อ่านข้อความจากไฟล์นี้ไม่ได้ — กรอกยอดเงินเองด้านล่าง');
      else if (best == null) setReadErr('ไม่พบยอดเงินที่ชัดเจนในเอกสาร — กรอกยอดเงินเองด้านล่าง');
    } catch (err) {
      // readDocText rejects with a Thai message (or an AbortError, after a cancel)
      const msg = (err as Error)?.message;
      if (!ctl.signal.aborted) setReadErr('อ่านเอกสารไม่สำเร็จ (' + (msg && /[\u0E00-\u0E7F]/.test(msg) ? msg : 'ข้อผิดพลาดที่ไม่คาดคิด') + ') — กรอกยอดเงินเองด้านล่าง');
    } finally {
      if (!ctl.signal.aborted) setProg(null);
    }
  };

  const choose = (b: DealDoc['basis'], v: number | null) => {
    setBasis(b);
    setAmount(v == null ? '' : String(v));
  };
  const amt = money(amount);
  const save = async () => {
    if (!file) return;
    setSaving('กำลังบันทึก…');
    try {
      if (amt != null && basis !== 'manual') prefs.set(BASIS_PREF, basis);
      await e.attachDoc(deal.id, file, { kind, amount: amt, target: amt == null ? 'none' : target, basis: amt == null ? 'manual' : basis, detected: facts?.total ?? facts?.candidates[0]?.value ?? null, docNo, docDate });
      onClose();
    } catch (err) {
      setSaving('บันทึกไม่สำเร็จ: ' + ((err as Error)?.message || err));
    }
  };

  const opts: [DealDoc['basis'], string, number | null][] = facts
    ? ([
        ['total', 'รวมทั้งสิ้น (รวม VAT)', facts.total],
        ['subtotal', 'ก่อน VAT', facts.subtotal],
        ['netPay', 'ยอดชำระหลังหัก ณ ที่จ่าย', facts.netPay],
      ] as [DealDoc['basis'], string, number | null][]).filter((x) => x[2] != null)
    : [];
  const others = facts ? facts.candidates.filter((c) => !opts.some((o) => o[2] === c.value)).slice(0, 5) : [];
  const wordsOk = facts && facts.words != null && facts.total != null && Math.abs(facts.words - facts.total) < 0.01;
  const partyWarn = facts && facts.party && !sameParty(facts.party, deal.client);
  const isImg = file && docMime(file).startsWith('image/') && !/hei[cf]/.test(docMime(file)); // browsers can't show HEIC

  return (
    <Modal title={`แนบ${KIND_TH[kind]} · ${deal.client}`} onClose={onClose} width={620}>
      <label style={{ ...labelCol, gap: 8 }}>
        เลือกไฟล์ PDF หรือรูปถ่าย / สแกน (ไม่เกิน 10 MB)
        <input type="file" accept={DOC_ACCEPT} onChange={(ev) => { const f = ev.target.files?.[0]; if (f) pick(f); }} style={{ fontSize: 13.5 }} />
      </label>
      {prog && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13.5, color: '#475069' }}>{prog.msg}</span>
          <span style={{ height: 6, background: '#EEF1F8', borderRadius: 999, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${prog.pct ?? 30}%`, background: '#1A3FE0', transition: 'width .2s' }} />
          </span>
          <span style={{ fontSize: 12, color: '#5E6680' }}>อ่านในเครื่องนี้ ไม่ได้ส่งไฟล์ไปที่อื่น · รูปถ่าย / สแกนใช้เวลาอ่านนานกว่า PDF (ครั้งแรกต้องโหลดตัวอ่านภาษาไทย)</span>
        </div>
      )}
      {readErr && <Notice kind="error" role="alert">{readErr}</Notice>}
      {file && !prog && (
        <>
          {isImg && <img src={url} alt="ตัวอย่างเอกสาร" style={{ maxHeight: 220, objectFit: 'contain', borderRadius: 12, border: '1px solid #E3E7F1', background: '#F4F6FC' }} />}
          {!isImg && <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5 }}>เปิดดูไฟล์ {file.name} เพื่อเทียบยอด ↗</a>}
          {facts && (opts.length > 0 || others.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#F7F8FC', borderRadius: 14, padding: '12px 14px' }}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                ยอดเงินที่ระบบอ่านได้{' '}
                <span style={{ fontSize: 12, fontWeight: 400, color: facts.confidence === 'high' ? '#14633F' : facts.confidence === 'medium' ? '#6B4100' : '#8A2B12' }}>
                  · ความมั่นใจ{facts.confidence === 'high' ? 'สูง' : facts.confidence === 'medium' ? 'ปานกลาง' : 'ต่ำ — โปรดตรวจกับเอกสาร'}
                </span>
              </span>
              {opts.map(([b, label, v]) => (
                <label key={b} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, cursor: 'pointer' }}>
                  <input type="radio" name="basis" checked={basis === b && amt === v} onChange={() => choose(b, v)} />
                  <span style={{ flex: 1 }}>{label}</span>
                  <b style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(v)} บาท</b>
                </label>
              ))}
              {facts.vat != null && <span style={{ fontSize: 12, color: '#5E6680' }}>VAT {fmtMoney(facts.vat)} บาท{facts.wht != null ? ` · หัก ณ ที่จ่าย ${fmtMoney(facts.wht)} บาท` : ''}</span>}
              {wordsOk && <span style={{ fontSize: 12, color: '#14633F' }}>✓ ตรงกับจำนวนเงินตัวอักษรในเอกสาร</span>}
              {others.length > 0 && (
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: '#475069' }}>
                  ตัวเลขอื่นที่พบ:
                  {others.map((c) => (
                    <button key={c.value} onClick={() => choose('manual', c.value)} title={c.line} style={{ ...small, height: 28, fontSize: 12 }}>{fmtMoney(c.value)}</button>
                  ))}
                </span>
              )}
            </div>
          )}
          {method === 'pdf-text' && facts && (facts.total == null || facts.confidence !== 'high') && (
            <button onClick={() => pick(file, true)} style={{ ...small, alignSelf: 'flex-start' }}>ยอดไม่ถูก? อ่านใหม่จากภาพของเอกสาร (OCR)</button>
          )}
          {partyWarn && <Notice kind="error">ชื่อลูกค้าในเอกสาร "{facts!.party}" ไม่ตรงกับ "{deal.client}" — ตรวจว่าแนบถูกรายการ</Notice>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
            <label style={labelCol}>
              ยอดเงินที่ยืนยัน (บาท)
              <input value={amount} onChange={(ev) => { setAmount(ev.target.value); setBasis('manual'); }} inputMode="decimal" placeholder="เช่น 107,000" style={{ ...inputStyle, fontSize: 16, fontWeight: 500 }} />
            </label>
            <label style={labelCol}>
              นับยอดนี้เป็น
              <select value={target} onChange={(ev) => setTarget(ev.target.value as DocTarget)} style={selectStyle}>
                <option value="forecast">Forecast (ยอดที่คาดว่าจะได้)</option>
                <option value="actual">Actual (ยอดที่ได้จริง)</option>
                <option value="none">ไม่นับยอด (แนบไว้เป็นหลักฐาน)</option>
              </select>
            </label>
            <label style={labelCol}>
              ประเภทเอกสาร
              <select value={kind} onChange={(ev) => { const k = ev.target.value as DocKind; setKind(k); setTarget(defaultTarget(k)); }} style={selectStyle}>
                {(Object.keys(KIND_TH) as DocKind[]).map((k) => <option key={k} value={k}>{KIND_TH[k]}</option>)}
              </select>
            </label>
            <label style={labelCol}>
              เลขที่เอกสาร
              <input value={docNo} onChange={(ev) => setDocNo(ev.target.value)} style={inputStyle} />
            </label>
            <label style={labelCol}>
              ลงวันที่{docDate ? ` (${isoTh(docDate)})` : ''}
              <input type="date" value={docDate} onChange={(ev) => setDocDate(ev.target.value)} style={inputStyle} />
            </label>
          </div>
          {saving && <span role="status" style={{ fontSize: 13, color: saving.startsWith('บันทึกไม่') ? '#8A2B12' : '#475069' }}>{saving}</span>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={onClose} style={small}>ยกเลิก</button>
            <button onClick={save} disabled={saving === 'กำลังบันทึก…'} style={{ ...small, background: '#0A1A86', borderColor: '#0A1A86', color: '#fff' }}>
              {amt != null ? `ยืนยันยอด ${fmtMoney(amt)} บาท และแนบเอกสาร` : 'แนบเอกสาร (ไม่ระบุยอด)'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
