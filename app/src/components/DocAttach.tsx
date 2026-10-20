import { useEffect, useRef, useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { isoTh, todayISO } from '../lib/format';
import { closeReady, fmtMoney, parseAmount, stepOf, type Deal, type DealDoc } from '../lib/sales';
import { KEEP_WHOLE, attachPlan, sameParty as sameParty0, type AttachChoice, type AttachEntry, type AttachPlan, type DocSaved as DocSaved0 } from '../lib/attachPlan';
import { qtFacts } from '../lib/quotes';
import type { DocFacts } from '../lib/docExtract';
import type { GccEngine } from '../lib/engine';
import { Modal } from './Dialog';
import { DOC_ACCEPT, DOC_MAX_BYTES, docMime } from '../lib/teamFiles';
import { DateField } from './ui';
import { useSalesActs } from './SalesToast';

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

/** Two names refer to the same company? (lib/attachPlan) */
export const sameParty = sameParty0;
export type DocSaved = DocSaved0;

/** A line with its amounts, dates and key words kept whole (lib/attachPlan KEEP_WHOLE). */
function Nw({ t }: { t: string }) {
  return <>{t.split(KEEP_WHOLE).map((x, i) => (i % 2 ? <span key={i} className="nw">{x}</span> : x))}</>;
}

const READING = 'กำลังอ่านยอดจากไฟล์… อ่านในเครื่องนี้';
const OCR = 'อ่านจากภาพของเอกสาร…';

/**
 * Attach a document in one screen (lib/attachPlan): the file is read in this browser (PDF text; a doubtful
 * PDF read is read again from its picture, once, by itself; photos and scans by OCR), then ONE amount with
 * why, what saving changes ("หลังบันทึก"), and one button that names the amount. Other figures, the type and
 * a note are small links; money that may be counted already is one sentence with a word tag and the safe
 * choice made. The plan is worked out again before saving: if the deal changed meanwhile (a sync, a
 * teammate), the new plan shows and nothing is saved on that click. `entry`: the button pressed;
 * `file`: picked or dropped.
 */
export function DocAttach({ deal: d0, entry, file: file0, onClose }: { deal: Deal; entry: AttachEntry; file: File; onClose: () => void }) {
  const { engine: e, set } = useApp();
  useEngineVersion();
  const acts = useSalesActs();
  const today = todayISO();
  const d = e.sales.deals[d0.id] || d0;
  const [file, setFile] = useState<File>(file0);
  const [url, setUrl] = useState('');
  const [thumb, setThumb] = useState('');
  const [prog, setProg] = useState<{ msg: string; pct?: number } | null>({ msg: READING });
  const [facts, setFacts] = useState<DocFacts | null>(null);
  const [bad, setBad] = useState('');
  const [readNote, setReadNote] = useState('');
  const [choice, setChoice] = useState<AttachChoice>({});
  const [alt, setAlt] = useState(false);
  const [type, setType] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [editNo, setEditNo] = useState(false);
  const [manual, setManual] = useState('');
  const [scanUi, setScanUi] = useState(false);
  const [saving, setSaving] = useState('');
  const [moved, setMoved] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const again = useRef<HTMLInputElement>(null);
  const pri = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLInputElement>(null);
  const shown = useRef('');
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  useEffect(() => {
    void read(file0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const read = async (f: File) => {
    abort.current?.abort();
    setFile(f);
    setFacts(null);
    setChoice({});
    setManual('');
    setScanUi(false);
    setAlt(false);
    setType(false);
    setReadNote('');
    setThumb('');
    setSaving('');
    const why = f.size > DOC_MAX_BYTES ? 'ไฟล์ใหญ่เกิน 10 MB' : !docMime(f) ? 'รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)' : '';
    setBad(why ? `${why} · ${f.name}` : '');
    if (why) return setProg(null);
    // the preview gets the checked type, never what the file claims (an .html renamed .pdf must not open as a page here)
    setUrl(URL.createObjectURL(new Blob([f], { type: docMime(f) })));
    const ctl = new AbortController();
    abort.current = ctl;
    setProg({ msg: READING });
    let fx: DocFacts | null = null;
    try {
      const [{ readDocText, docThumb }, { analyzeDocText, factsScore }] = await Promise.all([import('../lib/docText'), import('../lib/docExtract')]).catch((x) => {
        // offline, or this page is older than the site (its chunks were replaced by a new version)
        throw new Error('โหลดตัวอ่านเอกสารไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้านี้', { cause: x });
      });
      void docThumb(f, 160).then((u) => !ctl.signal.aborted && setThumb(u), () => {});
      const judge = (x: string) => factsScore(analyzeDocText(x));
      const t = await readDocText(f, { signal: ctl.signal, judge, onProgress: (_m, pct) => setProg({ msg: READING, pct }) });
      if (ctl.signal.aborted) return;
      fx = analyzeDocText(t.text);
      // a doubtful read of a PDF's text: once more from the page's picture, by itself (no button to find)
      if (t.method === 'pdf-text' && (fx.total == null || fx.confidence !== 'high')) {
        setProg({ msg: OCR });
        try {
          const t2 = await readDocText(f, { signal: ctl.signal, forceOcr: true, judge, onProgress: (_m, pct) => setProg({ msg: OCR, pct }) });
          if (ctl.signal.aborted) return;
          const fx2 = analyzeDocText(t2.text);
          if (factsScore(fx2) > factsScore(fx)) fx = fx2;
        } catch {
          if (ctl.signal.aborted) return;
        }
      }
    } catch (err) {
      if (ctl.signal.aborted) return;
      const msg = (err as Error)?.message;
      setReadNote('อ่านเอกสารไม่สำเร็จ' + (msg && /[฀-๿]/.test(msg) ? ` (${msg})` : ''));
    }
    if (ctl.signal.aborted) return;
    setFacts(fx);
    setProg(null);
  };

  const readInfo = { facts, name: file.name || 'เอกสาร', size: file.size };
  const plan: AttachPlan = attachPlan(e.sales, d, entry, readInfo, choice, today);
  const reading = !!prog;
  // the scan question stays while its number is typed (S2)
  const scan = !reading && !bad && (plan.scan || scanUi);
  useEffect(() => {
    if (reading || bad) return;
    if (plan.scan) setScanUi(true);
    // the reader is not sure: the other figures open by themselves (S3)
    else if (plan.low) setAlt(true);
    requestAnimationFrame(() => (plan.scan ? document.querySelector<HTMLInputElement>('.oa-big') : pri.current)?.focus());
  }, [reading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editNo) requestAnimationFrame(() => noRef.current?.focus());
  }, [editNo]);
  if (!reading) shown.current = plan.key;

  const pick = (c: AttachChoice) => {
    setMoved(false);
    setChoice((x) => ({ ...x, ...c }));
  };
  const save = async (over?: AttachChoice) => {
    if (saving === 'กำลังบันทึก…') return;
    const c = over ? { ...choice, ...over } : choice;
    const now = e.sales.deals[d.id];
    if (!now) return onClose();
    // worked out again on the deal as it is now: a change (a sync, a teammate) shows instead of saving
    const p = attachPlan(e.sales, now, entry, readInfo, c, today);
    if (!over && p.key !== shown.current) {
      shown.current = p.key;
      setMoved(true);
      return;
    }
    if (p.primaryOff && !over) return;
    setSaving('กำลังบันทึก…');
    try {
      const was = closeReady(e.sales, now, today);
      if (p.noSave) {
        // the same file is counted already: nothing new is stored (an installment short by withholding tax is received)
        if (p.full && p.fullStage) e.setPayFull(d.id, p.fullStage, true);
        onClose();
        return acts.after(now, was, 'payment', p.toast);
      }
      const doc = await e.attachDoc(d.id, file, p.save!);
      // what the reader found: the quotation's edit form offers its figures without reading the file again
      if (facts) qtFacts.set(doc.id, facts);
      if (p.full && p.fullStage) e.setPayFull(d.id, p.fullStage, true);
      // the note typed here is the step's note (as the document's own note would be)
      const n = note.trim();
      if (n && doc.stage && e.sales.cfg.stages.includes(doc.stage)) e.setStep(d.id, doc.stage, { d: stepOf(e.sales, d.id, doc.stage).d || today, n });
      onClose();
      if (entry.at !== 'other') entry.onSaved?.({ doc, docFig: p.save!.amount, kept: p.kept });
      const dd = e.sales.deals[d.id];
      if (dd) acts.after(dd, was, 'payment', p.toast);
    } catch (err) {
      setSaving('บันทึกไม่สำเร็จ: ' + ((err as Error)?.message || err));
    }
  };

  const isImg = docMime(file).startsWith('image/') && !/hei[cf]/.test(docMime(file)); // browsers can't show HEIC
  const pic = isImg ? url : thumb;
  const open = plan.save?.amount ?? plan.amount;
  const docMeta = [plan.docWord, plan.docNo ? 'เลขที่ ' + plan.docNo : '', plan.docDate ? isoTh(plan.docDate) : ''].filter(Boolean).join(' · ');
  const viewOld = (id: string) => {
    const x = e.sales.docs[`${d.id}/${id}`];
    if (x) void openDocFile(e, x);
  };

  return (
    <Modal title={plan.title} onClose={onClose} width={520} focus="dialog">
      <div className={'oa' + (alt || type || noteOpen ? ' oa-open' : '')}>
        <span className="oa-sub">
          <span className="oa-wide"><Nw t={plan.sub} /></span>
          <span className="oa-narrow"><Nw t={plan.subShort} /></span>
        </span>
        {/* the document: a picture of its first page, its name, what it is, its number and date */}
        <div className="oa-doc">
          {pic ? <img src={pic} alt="" /> : <span className="oa-ph" aria-hidden="true">{docMime(file) === 'application/pdf' ? 'PDF' : 'รูป'}</span>}
          <span className="oa-doc-t">
            <b title={file.name}>{file.name}</b>
            {!reading && !bad && (
              <span>
                <Nw t={docMeta} />
                {(plan.mode !== 'other' || plan.docNo) && !scan ? <button type="button" className="lnk" aria-expanded={editNo} onClick={() => setEditNo(!editNo)}>แก้</button> : null}
              </span>
            )}
            {!reading && plan.copies && <small>ไฟล์มีต้นฉบับและสำเนา อ่านยอดชุดเดียว</small>}
          </span>
          {url && !bad && (
            <a className="lnk" href={url} target="_blank" rel="noopener noreferrer">
              <span className="oa-wide">เปิดดูไฟล์</span>
              <span className="oa-narrow">เปิดดู</span>
            </a>
          )}
        </div>
        {editNo && !reading && !scan && (
          <div className="oa-row2">
            <label>เลขที่<input ref={noRef} className="fld" value={choice.docNo ?? plan.docNo} maxLength={60} onChange={(ev) => pick({ docNo: ev.target.value })} /></label>
            <span className="oa-lab">ลงวันที่<DateField value={choice.docDate ?? plan.docDate} onChange={(v) => pick({ docDate: v })} label="ลงวันที่" placeholder="ไม่ระบุ" /></span>
          </div>
        )}

        {reading && (
          <div className="oa-read" role="status" aria-live="polite">
            <span>{prog!.msg}</span>
            <span className="oa-bar"><i style={{ width: `${prog!.pct ?? 30}%` }} /></span>
          </div>
        )}
        {bad && (
          <div className="oa-box warn" role="alert">
            <p><span className="oa-tag">เปิดไม่ได้</span>{bad}</p>
          </div>
        )}

        {!reading && !bad && (
          <>
            {moved && (
              <div className="oa-box warn" role="alert"><p><span className="oa-tag">เพิ่งเปลี่ยน</span>งานนี้เพิ่งมีการเปลี่ยนแปลง ตรวจบรรทัดด้านล่างอีกครั้งแล้วกดบันทึก</p></div>
            )}
            {plan.notice && (
              <div className={'oa-box ' + plan.notice.tone} role="status">
                <p>
                  <span className="oa-tag">{plan.notice.tag}</span>
                  {plan.notice.lead && <b><Nw t={plan.notice.lead} /></b>}
                  {plan.notice.lead ? ' · ' : ''}
                  <Nw t={plan.notice.text} />
                  {plan.notice.alts.map((a) => (
                    <span key={a.label}>
                      {' · '}
                      {a.pre ? a.pre + ' ' : ''}
                      <button
                        type="button"
                        className="lnk"
                        onClick={() => (a.choice ? pick(a.choice) : a.open ? (onClose(), set({ deal: a.open })) : a.view ? viewOld(a.view) : undefined)}
                      >
                        {a.label}
                      </button>
                    </span>
                  ))}
                </p>
              </div>
            )}
            {scan ? (
              // S2: nothing read (a photo, a scan): one question
              <div className="oa-scan">
                {pic && <img src={pic} alt="ตัวอย่างเอกสาร" />}
                <div className="oa-scan-f">
                  <label>
                    {readNote ? readNote + ' · ' : ''}อ่านยอดจากรูปนี้ไม่ได้ ยอดเงินในเอกสารเท่าไร?
                    <input
                      className="fld oa-big"
                      inputMode="decimal"
                      placeholder="เช่น 60,000"
                      value={manual}
                      aria-invalid={!!manual.trim() && parseAmount(manual) == null}
                      onChange={(ev) => {
                        setManual(ev.target.value);
                        const v = parseAmount(ev.target.value);
                        pick({ figure: 'manual', manual: v ?? null });
                      }}
                      onKeyDown={(ev) => ev.key === 'Enter' && !plan.primaryOff && void save()}
                    />
                  </label>
                  {plan.mode === 'pay' && <span className="oa-hint">ใบเสร็จที่หัก ณ ที่จ่าย พิมพ์ยอดชำระ (ยอดหลังหัก)</span>}
                  {plan.chip && (
                    <span>
                      <button type="button" className="btn xs" onClick={() => (setManual(fmtMoney(plan.chip!.value)), pick({ figure: 'manual', manual: plan.chip!.value }))}>{plan.chip.label}</button>
                    </span>
                  )}
                  <div className="oa-row2">
                    <label>เลขที่<input className="fld" value={choice.docNo ?? plan.docNo} maxLength={60} onChange={(ev) => pick({ docNo: ev.target.value })} /></label>
                    <span className="oa-lab">ลงวันที่<DateField value={choice.docDate ?? plan.docDate} onChange={(v) => pick({ docDate: v })} label="ลงวันที่" placeholder="ไม่ระบุ" /></span>
                  </div>
                </div>
              </div>
            ) : plan.mode === 'other' ? (
              <p className="oa-evid">เก็บไว้เป็นหลักฐานของงานนี้ ไม่นับเข้า Forecast หรือ Actual</p>
            ) : (
              <div className="oa-amt">
                <span className="oa-amt-l">{plan.amountLabel}</span>
                <span className="oa-amt-v">{fmtMoney(open)}<small>บาท</small></span>
                {plan.reason && <span className="oa-why"><Nw t={plan.reason} /></span>}
                {/* (the figures are listed in "ใช้ยอดอื่น" while it is open) */}
                {plan.figs.length > 0 && !alt && (
                  <span className="oa-fig">
                    ในเอกสาร:{' '}
                    {plan.figs.map((x, i) => (
                      <span key={x}>
                        <span className="nw">{x}</span>
                        {i < plan.figs.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
            {!scan && (plan.links.other || plan.links.type || plan.links.note) && (
              <div className="oa-links">
                {plan.links.other && plan.figures.length > 0 && <button type="button" className="lnk" aria-expanded={alt} onClick={() => setAlt(!alt)}>ใช้ยอดอื่น</button>}
                {plan.links.type && <button type="button" className="lnk" aria-expanded={type} onClick={() => setType(!type)}>เปลี่ยนประเภท</button>}
                {plan.links.note && <button type="button" className="lnk" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>เพิ่มโน้ต</button>}
              </div>
            )}
            {alt && !scan && plan.links.other && plan.figures.length > 0 && (
              <div className="oa-alt" role="radiogroup" aria-label="ยอดที่นับ">
                <span className="oa-alt-h">ใช้ยอดอื่นจากเอกสารนี้<button type="button" className="lnk" onClick={() => setAlt(false)}>ซ่อน</button></span>
                {plan.figures.map((x) => {
                  const on = choice.figure === undefined ? x.proposed : choice.figure === x.key;
                  return (
                    <label key={String(x.key)} className={on ? 'on' : ''}>
                      <input type="radio" name="oa-fig" checked={on} onChange={() => pick({ figure: x.key })} />
                      <span>
                        {x.label}
                        {x.proposed && <em>{x.key === 'netPay' ? `ระบบเลือก · ${plan.mode === 'quote' ? 'เงินที่จะเข้าบัญชีจริง' : 'เงินที่เข้าบัญชีจริง'}` : 'ระบบเลือก'}</em>}
                      </span>
                      <b>{fmtMoney(x.value)}</b>
                    </label>
                  );
                })}
                <label className={choice.figure === 'manual' ? 'on' : ''}>
                  <input type="radio" name="oa-fig" checked={choice.figure === 'manual'} onChange={() => pick({ figure: 'manual', manual: parseAmount(manual) ?? null })} />
                  <span>พิมพ์ยอดเอง</span>
                  <input
                    className="fld"
                    inputMode="decimal"
                    placeholder="เช่น 60,000"
                    aria-label="พิมพ์ยอดเอง (บาท)"
                    value={manual}
                    onFocus={() => choice.figure !== 'manual' && pick({ figure: 'manual', manual: parseAmount(manual) ?? null })}
                    onChange={(ev) => (setManual(ev.target.value), pick({ figure: 'manual', manual: parseAmount(ev.target.value) ?? null }))}
                  />
                </label>
                {plan.whtShort && (
                  <label className="oa-chk">
                    <input type="checkbox" checked={!!choice.notWht} onChange={(ev) => pick({ notWht: ev.target.checked })} />
                    <span>ยังค้าง {fmtMoney(plan.whtShort.short)} บาท (ไม่ใช่หัก ณ ที่จ่าย)</span>
                  </label>
                )}
              </div>
            )}
            {type && plan.links.type && (
              <div className="oa-seg">
                <span className="oa-seg-h">เอกสารนี้คือ<button type="button" className="lnk" onClick={() => setType(false)}>ซ่อน</button></span>
                <div className="oa-seg-r" role="radiogroup" aria-label="ประเภทเอกสาร">
                  {plan.tiles.map((t) => (
                    <button key={t.key} type="button" role="radio" aria-checked={t.on} className={t.on ? 'on' : ''} onClick={() => pick({ ...t.choice, count: undefined, stage: t.choice.stage })}>
                      <span>{t.label}</span>
                      <small>{t.sub}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {noteOpen && plan.links.note && (
              <label className="oa-note">
                โน้ตของขั้นนี้
                <input className="fld" value={note} maxLength={3000} placeholder={plan.mode === 'quote' ? 'เช่น ส่งใบเสนอราคาทางอีเมลแล้ว' : 'เช่น ลูกค้าโอนเข้าบัญชีแล้ว'} onChange={(ev) => setNote(ev.target.value)} />
              </label>
            )}
            {plan.after && (
              <div className={'oa-box after' + (plan.overTag ? ' warn' : '')}>
                <p>
                  <b>หลังบันทึก</b>
                  {plan.overTag && <span className="oa-tag">{plan.overTag}</span>}
                  <Nw t={plan.after} />
                </p>
              </div>
            )}
          </>
        )}
        {saving && <span role="status" className={saving.startsWith('บันทึกไม่') ? 'oa-err' : 'oa-hint'}>{saving}</span>}
        <div className="dlg-act oa-act">
          {plan.left && !reading && !bad && (
            <button type="button" className="lnk left" onClick={() => (plan.left!.act === 'save' ? void save(plan.left!.choice) : setEditNo(true))}>{plan.left.label}</button>
          )}
          {bad && <button type="button" className="lnk left" onClick={() => again.current?.click()}>เลือกไฟล์อื่น</button>}
          <button type="button" className="quiet" onClick={onClose}>{reading || bad ? 'ยกเลิก' : plan.quiet}</button>
          {!reading && !bad && (
            <button ref={pri} type="button" className="btn pri" disabled={plan.primaryOff || saving === 'กำลังบันทึก…'} onClick={() => void save()}>
              {plan.primary}
            </button>
          )}
          <input ref={again} type="file" accept={DOC_ACCEPT} hidden onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) void read(f); }} />
        </div>
      </div>
    </Modal>
  );
}
