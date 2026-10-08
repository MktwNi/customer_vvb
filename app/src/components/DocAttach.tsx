import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { norm } from '../lib/core';
import { dmTh, isoTh, todayISO } from '../lib/format';
import {
  KIND_TH, attachPreview, closeReady, countedAt, dealMoney, fmtMoney, kindForStage, parseAmount, planOf, stageTh, stageTrack, targetForStage,
  type Deal, type DealDoc, type DocKind, type DocTarget,
} from '../lib/sales';
import type { DocFacts } from '../lib/docExtract';
import type { GccEngine } from '../lib/engine';
import { Modal } from './Dialog';
import { DOC_ACCEPT, DOC_MAX_BYTES, docMime } from '../lib/teamFiles';
import { prefs } from '../lib/storage';
import { DateField, Notice, labelCol } from './ui';
import { Bead } from './StageTrack';
import { useSalesActs } from './SalesToast';

const BASIS_PREF = 'gcc-doc-basis';

/** Browsers show PDF and common images in a tab; anything else (HEIC from an iPhone) is downloaded. */
export const SHOWABLE = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;
/** Open an attached document's file (from this browser, or the team's Drive). The tab is opened within
 *  the click, then filled: a pop-up opened after a slow download would be blocked. */
export async function openDocFile(e: GccEngine, doc: DealDoc) {
  const w = SHOWABLE.test(doc.mime) ? window.open('', '_blank') : null;
  try {
    const url = URL.createObjectURL(await e.docBlob(doc));
    if (w) w.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    w?.close();
    window.alert('เปิดไฟล์ไม่สำเร็จ: ' + ((err as Error)?.message || err));
  }
}

/** Two names refer to the same company? (ignores company-type words and punctuation) */
function sameParty(a: string, b: string) {
  const strip = (s: string) => norm(s).replace(/บริษัท|จำกัด|มหาชน|ห้างหุ้นส่วน|co|ltd|plc|company|limited/gi, '');
  const x = strip(a), y = strip(b);
  return !x || !y || x.includes(y) || y.includes(x);
}

/**
 * Attach a quotation / invoice: the document is read in the browser (PDF text, or OCR for scans and
 * photos), the amounts found are shown, and nothing is saved until the user confirms the figure.
 * `stage`: the stage it was attached at (QUOTATION is the Forecast, a PAY the Actual of that
 * installment); without it the stage is chosen ("ระบบเลือกขั้นให้"), '' = a document of no stage
 * ("เอกสารอื่น"). `file`: a file dropped on the panel, read at once.
 */
export function DocAttach({ deal, kind: kindIn, stage, file: dropped, onClose }: { deal: Deal; kind?: DocKind; stage?: string; file?: File; onClose: () => void }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const cfg = e.sales.cfg, today = todayISO();
  const kind0: DocKind = kindIn ?? (stage ? kindForStage(cfg, stage) : dealMoney(e.sales, deal).fcDoc ? 'invoice' : 'quotation');
  // what a kind counts toward at this stage (a receipt at a PAY stage is Actual)
  const defaultTarget = (k: DocKind): DocTarget => targetForStage(cfg, stage ?? '', k);
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
  // a document already counted at this stage: the new one replaces it (kept as evidence) or adds to it
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  // "ถือว่ารับครบงวดนี้" on a short payment: null = as suggested (ticked when it matches withholding tax)
  const [full, setFull] = useState<boolean | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    abort.current?.abort();
  }, []);
  // a file dropped on the deal panel is read right away
  useEffect(() => {
    if (dropped) pick(dropped);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const pick = async (f: File, forceOcr = false) => {
    // a new pick starts from an empty form: a rejected file must not leave the previous file (and its
    // amount) ready to attach, and a read still running for the previous file must not keep the progress bar
    abort.current?.abort();
    setProg(null);
    setFile(null);
    setUrl('');
    setFacts(null);
    setMethod('');
    setReadErr('');
    setSaving('');
    if (!forceOcr) {
      // (re-reading the same file keeps the type chosen for it)
      setKind(kind0);
      setTarget(defaultTarget(kind0));
    }
    setBasis('manual');
    setAmount('');
    setDocNo('');
    setDocDate('');
    const bad = f.size > DOC_MAX_BYTES ? 'ไฟล์ใหญ่เกิน 10 MB' : !docMime(f) ? 'รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)' : '';
    if (bad) {
      setReadErr(`${bad} — เลือกไฟล์อื่น (${f.name})`);
      if (input.current) input.current.value = '';
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
  // the same reading as every other amount box ("208,650.-", "1.5 ล้าน", Thai digits); text that
  // isn't one clear amount blocks saving instead of attaching the document with no amount
  const parsed = parseAmount(amount);
  const amt = parsed ?? null;
  const badAmt = parsed === undefined;
  const counted = stage && target === 'actual' ? countedAt(e.sales, deal, stage) : [];
  const old = counted[counted.length - 1];
  const replace = old && mode === 'replace' ? old.id : undefined;
  const tgt: DocTarget = amt == null ? 'none' : target;
  // what attaching changes: the installment of the plan, the Actual, and whether the job becomes ready to close
  const pv = file && amt != null && tgt !== 'none' ? attachPreview(e.sales, deal, { kind, amount: amt, target: tgt, docDate, stage, replace }, today) : null;
  const short = !!pv?.line && pv.short > 0 && pv.line.got > 0;
  const fullOn = short && (full ?? pv?.wht != null);
  const ad = docDate && docDate <= today ? docDate : today;
  const after = !pv
    ? ''
    : [
        pv.line
          ? `หลังแนบ: ${pv.stage} รับแล้ว ${fmtMoney(pv.line.got)} บาท · ${pv.short > 0 ? `ขาด ${fmtMoney(pv.short)} จากแผน ${fmtMoney(pv.line.amt)}` : 'ครบตามแผน'}`
          : tgt === 'forecast'
            ? `หลังแนบ: ${pv.stage ? pv.stage + ' ทำแล้ว ' + isoTh(ad) + ' · ' : ''}Forecast จะเป็น ${fmtMoney(amt)}`
            : `หลังแนบ: ${pv.stage ? pv.stage + ' ทำแล้ว ' + isoTh(ad) + ' · ' : ''}Actual จะเป็น ${fmtMoney(pv.actual)}${pv.fcFull ? ' (ครบตาม Forecast)' : ''}`,
        pv.ready || (fullOn && pv.readyIfFull) ? (pv.line ? 'รับครบทุกงวดแล้ว งานนี้จะพร้อมปิดงาน' : 'งานนี้จะพร้อมปิดงาน') : '',
      ].filter(Boolean).join(' · ');
  const save = async () => {
    if (!file || badAmt) return;
    setSaving('กำลังบันทึก…');
    try {
      if (amt != null && basis !== 'manual') prefs.set(BASIS_PREF, basis);
      const was = closeReady(e.sales, deal, today);
      const doc = await e.attachDoc(deal.id, file, { kind, amount: amt, target: tgt, basis: amt == null ? 'manual' : basis, detected: facts?.total ?? facts?.candidates[0]?.value ?? null, docNo, docDate, stage, replace });
      // a short payment counted complete (withholding tax): the installment is received
      if (fullOn && doc.stage) e.setPayFull(deal.id, doc.stage, true);
      onClose();
      const d = e.sales.deals[deal.id];
      if (d) acts.after(d, was, 'payment', `แนบ${KIND_TH[doc.kind]}${doc.docNo ? ' ' + doc.docNo : ''}${doc.stage ? ' ที่ ' + doc.stage : ''} แล้ว`);
    } catch (err) {
      setSaving('บันทึกไม่สำเร็จ: ' + ((err as Error)?.message || err));
    }
  };
  // the installment planned at this stage, and the stage's circle
  const line = stage ? planOf(e.sales, deal, today)?.lines.find((l) => l.stage === stage) : undefined;
  const st = stage ? stageTrack(e.sales, deal, today).states[stage] : undefined;

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
    <Modal title={stage ? `แนบเอกสารที่ ${stage}${stageTh(stage) ? ' · ' + stageTh(stage) : ''}` : `แนบ${KIND_TH[kind]}`} onClose={onClose} width={620}>
      <span className="sl-dlg-sub">{deal.client}</span>
      {stage && (
        <div className="sl-stagebar">
          <Bead state={st || 'future'} now stage={stage} />
          <span>
            เอกสารนี้จะผูกกับขั้น <b>{stage}</b> · ยอดที่ยืนยัน{target === 'forecast' ? 'เป็น Forecast' : target === 'actual' ? 'รวมเข้า Actual' : 'ไม่นับยอด'}
            {line && line.amt > 0 && <> · <b>แผนงวดนี้ {fmtMoney(line.amt)} บาท{line.due ? ' ครบกำหนด ' + dmTh(line.due) : ''}</b></>}
          </span>
        </div>
      )}
      <label style={{ ...labelCol, gap: 8 }}>
        เลือกไฟล์ PDF หรือรูปถ่าย / สแกน (ไม่เกิน 10 MB)
        <input ref={input} type="file" accept={DOC_ACCEPT} onChange={(ev) => { const f = ev.target.files?.[0]; if (f) pick(f); }} style={{ fontSize: 14 }} />
      </label>
      {prog && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="t-sec" style={{ fontSize: 14 }}>{prog.msg}</span>
          <span style={{ height: 6, background: 'var(--bar-track)', borderRadius: 999, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${prog.pct ?? 30}%`, background: 'var(--bar)', transition: 'width .2s' }} />
          </span>
          <span className="t-meta">อ่านในเครื่องนี้ ไม่ได้ส่งไฟล์ไปที่อื่น · รูปถ่าย / สแกนใช้เวลาอ่านนานกว่า PDF</span>
        </div>
      )}
      {readErr && <Notice kind="error" role="alert">{readErr}</Notice>}
      {file && !prog && (
        <>
          {isImg && <img src={url} alt="ตัวอย่างเอกสาร" style={{ maxHeight: 220, objectFit: 'contain', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--frame)' }} />}
          {!isImg && docMime(file) === 'application/pdf' && <a href={url} target="_blank" rel="noopener noreferrer" className="hv-tx" style={{ alignSelf: 'flex-start', fontSize: 14 }}>เปิดดูไฟล์ {file.name} เพื่อเทียบยอด</a>}
          {!isImg && docMime(file) !== 'application/pdf' && <span className="t-meta" style={{ fontSize: 13 }}>เบราว์เซอร์นี้แสดงตัวอย่างรูป {file.name} ไม่ได้ (HEIC) เทียบยอดกับรูปในเครื่องของคุณ</span>}
          {facts && (opts.length > 0 || others.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px' }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                ยอดเงินที่ระบบอ่านได้{' '}
                <span style={{ fontSize: 12, fontWeight: 400, color: facts.confidence === 'high' ? 'var(--ok)' : facts.confidence === 'medium' ? 'var(--warn)' : 'var(--bad)' }}>
                  · ความมั่นใจ{facts.confidence === 'high' ? 'สูง' : facts.confidence === 'medium' ? 'ปานกลาง' : 'ต่ำ โปรดตรวจกับเอกสาร'}
                </span>
              </span>
              {opts.map(([b, label, v]) => (
                <label key={b} className="hv-tx" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
                  <input type="radio" name="basis" checked={basis === b && amt === v} onChange={() => choose(b, v)} style={{ accentColor: 'var(--brand)' }} />
                  <span style={{ flex: 1 }}>{label}</span>
                  <b style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(v)} บาท</b>
                </label>
              ))}
              {facts.vat != null && <span className="t-meta">VAT {fmtMoney(facts.vat)} บาท{facts.wht != null ? ` · หัก ณ ที่จ่าย ${fmtMoney(facts.wht)} บาท` : ''}</span>}
              {wordsOk && <span className="t-ok" style={{ fontSize: 12 }}>ตรงกับจำนวนเงินตัวอักษรในเอกสาร</span>}
              {others.length > 0 && (
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: 'var(--ink-2)' }}>
                  ตัวเลขอื่นที่พบ:
                  {others.map((c) => (
                    <button key={c.value} onClick={() => choose('manual', c.value)} title={c.line} className="btn xs">{fmtMoney(c.value)}</button>
                  ))}
                </span>
              )}
            </div>
          )}
          {method === 'pdf-text' && facts && (facts.total == null || facts.confidence !== 'high') && (
            <button onClick={() => pick(file, true)} className="lnk" style={{ alignSelf: 'flex-start' }}>ยอดไม่ถูก? อ่านใหม่จากภาพของเอกสาร (OCR)</button>
          )}
          {partyWarn && <Notice kind="error">ชื่อลูกค้าในเอกสาร "{facts!.party}" ไม่ตรงกับ "{deal.client}" — ตรวจว่าแนบถูกรายการ</Notice>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
            <label style={labelCol}>
              ยอดเงินที่ยืนยัน (บาท)
              <input value={amount} onChange={(ev) => { setAmount(ev.target.value); setBasis('manual'); }} inputMode="decimal" placeholder="เช่น 107,000" aria-invalid={badAmt} className="fld" style={{ fontWeight: 500, ...(badAmt ? { borderColor: 'var(--bad)' } : {}) }} />
              {badAmt && <span role="alert" style={{ fontSize: 12, color: 'var(--bad)' }}>อ่านเป็นจำนวนเงินไม่ได้ พิมพ์ตัวเลขเดียว เช่น 107,000 หรือ 1.5 ล้าน</span>}
            </label>
            <label style={labelCol}>
              นับยอดนี้เป็น
              <select value={target} onChange={(ev) => setTarget(ev.target.value as DocTarget)} className="fld sel">
                <option value="forecast">Forecast (ยอดที่คาดว่าจะได้)</option>
                <option value="actual">Actual (ยอดที่ได้จริง)</option>
                <option value="none">ไม่นับยอด (แนบไว้เป็นหลักฐาน)</option>
              </select>
            </label>
            <label style={labelCol}>
              ประเภทเอกสาร
              <select value={kind} onChange={(ev) => { const k = ev.target.value as DocKind; setKind(k); setTarget(defaultTarget(k)); }} className="fld sel">
                {(Object.keys(KIND_TH) as DocKind[]).map((k) => <option key={k} value={k}>{KIND_TH[k]}</option>)}
              </select>
            </label>
            <label style={labelCol}>
              เลขที่เอกสาร
              <input value={docNo} onChange={(ev) => setDocNo(ev.target.value)} className="fld" />
            </label>
            <label style={labelCol}>
              ลงวันที่
              <DateField value={docDate} onChange={setDocDate} placeholder="ไม่ระบุ" />
            </label>
          </div>
          {old && amt != null && (
            <fieldset className="sl-repl">
              <legend>{stage} นับยอดจาก{KIND_TH[old.kind]}{old.docNo ? ' ' + old.docNo : ''} {fmtMoney(old.amount)} บาท อยู่แล้ว</legend>
              <label className="hv-tx"><input type="radio" name="repl" checked={mode === 'replace'} onChange={() => setMode('replace')} /> ใช้ยอดนี้แทน <span className="t-meta">ใบเดิมเก็บไว้เป็นหลักฐาน ไม่นับยอด</span></label>
              <label className="hv-tx"><input type="radio" name="repl" checked={mode === 'add'} onChange={() => setMode('add')} /> นับเพิ่ม <span className="t-meta">งวดนี้จ่ายหลายครั้ง</span></label>
            </fieldset>
          )}
          {after && <div className="sl-after">{after}</div>}
          {short && (
            <label className="sl-rf-full hv-tx">
              <input type="checkbox" checked={fullOn} onChange={(ev) => setFull(ev.target.checked)} /> ถือว่ารับครบงวดนี้ (เช่น หัก ณ ที่จ่าย)
            </label>
          )}
          {saving && <span role="status" style={{ fontSize: 13, color: saving.startsWith('บันทึกไม่') ? 'var(--bad)' : 'var(--ink-2)' }}>{saving}</span>}
          <div className="dlg-act">
            <button onClick={onClose} className="quiet">ยกเลิก</button>
            {!badAmt && (
              <button onClick={save} disabled={saving === 'กำลังบันทึก…'} className="btn pri">
                {amt != null ? `ยืนยันยอด ${fmtMoney(amt)} บาท และ${stage ? 'แนบที่ ' + stage : 'แนบเอกสาร'}` : 'แนบเอกสาร (ไม่ระบุยอด)'}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
