import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../state';
import { dmTh, downloadBlob, isoTh, localDay } from '../lib/format';
import { KIND_TH, QUOTE_STAGE, dealMoney, docMismatch, fmtMoney, mismatchText, parseAmount, type Deal, type DealDoc, type DocKind } from '../lib/sales';
import { fcFig } from '../lib/salesUi';
import { qtDelText, qtFacts, qtRoText, qtVerLabel, qtVerShort, qtVerText, qtView, swapCheck, thList, type QtVersion, type QtView } from '../lib/quotes';
import type { DocFacts } from '../lib/docExtract';
import type { GccEngine } from '../lib/engine';
import { DOC_ACCEPT, DOC_MAX_BYTES, docMime } from '../lib/teamFiles';
import { DocAttach, SHOWABLE, openDocFile } from './DocAttach';
import { DocThumb } from './DocThumb';
import { Modal } from './Dialog';
import { SelField } from './Select';
import { DateField, Notice } from './ui';
import { Icon } from './icons';
import { useSalesActs } from './SalesToast';
import { QtBack, QtCheckLine } from './QtCheckSheet';
import { canMergeFrom } from '../lib/joint';

const TARGET_TH = { forecast: 'เป็น Forecast', actual: 'รวมใน Actual', none: 'ไม่นับยอด' };
const BASIS_LONG: [DealDoc['basis'], string][] = [['total', 'รวมทั้งสิ้น (รวม VAT)'], ['subtotal', 'ก่อน VAT'], ['netPay', 'หลังหัก ณ ที่จ่าย']];
const BASIS_WORD: Record<DealDoc['basis'], string> = { total: 'รวม VAT', subtotal: 'ก่อน VAT', netPay: 'หลังหัก ณ ที่จ่าย', manual: 'ยอดที่พิมพ์' };

/** Delete the version the quotation's card is about, after saying what that does to the Forecast;
 *  true when it was deleted. */
export function deleteQt(e: GccEngine, d: Deal, v: QtView, say: (t: string) => void) {
  const h = v.head;
  if (!h) return false;
  const what = qtDelText(v, d);
  const no = h.doc.docNo ? ' ' + h.doc.docNo : '';
  if (!window.confirm(`ลบใบเสนอราคา${no} ฉบับที่ ${h.n} (${h.doc.name})?\n${what}${h.doc.fileId ? ' · ไฟล์ย้ายไปถังขยะของ Drive ทีม' : ''}`)) return false;
  e.deleteDoc(d.id, h.doc.id);
  say(`ลบใบเสนอราคา${no} ฉบับที่ ${h.n} แล้ว · ${what}`);
  return true;
}

/**
 * The quotation at QUOTATION (item 3): the version in use (else the newest), what it counts toward, and
 * its actions always in view: "แนบฉบับแก้ไข" (a revised quotation, compared with this one, which stays as
 * "ฉบับเดิม"), "แก้ไขข้อมูล" (amount, number, date, type, the figure with or before VAT) and "เปลี่ยนไฟล์"
 * (the same quotation, another file); download and delete in a quiet menu; every version listed under it.
 * An account that can only read opens the files and changes nothing. `onRevise` opens the attach dialog
 * for a revision of that version.
 */
export function QtCard({ d, onRevise }: { d: Deal; onRevise: (docId: string) => void }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const ro = !e.canQuote(d);
  // without ดูยอดเงิน the card names the quotation and nothing it counts toward (its amount never came)
  const money = e.can('view.money'), opens = e.can('docs.open');
  const [form, setForm] = useState(false);
  const [swap, setSwap] = useState(false);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState('');
  const v = qtView(e.sales, d), h = v.head;
  if (!h) return null;
  const doc = h.doc;
  const open = (x: DealDoc) => void openDocFile(e, x).then(() => setTick((n) => n + 1));
  const download = async () => {
    setBusy('กำลังดาวน์โหลด (ไฟล์ใน Drive ของทีมอาจใช้เวลาสักครู่)');
    try {
      downloadBlob(await e.docBlob(doc), doc.name);
      setBusy('');
      setTick((n) => n + 1);
    } catch (err) {
      setBusy((err as Error)?.message || String(err));
    }
  };
  // a figure kept against the document ("คงยอดเดิม"), or a Forecast typed after it that differs
  const m = dealMoney(e.sales, d), mm = docMismatch(doc);
  const typedOver = h.state !== 'cur' && v.typed && doc.target === 'forecast' && fcFig(e.sales, d).doc?.id === doc.id && m.forecast != null && doc.amount != null && m.forecast !== doc.amount;
  const warn = mm ? mismatchText(mm.doc, mm.kept, h.state === 'cur' ? 'Forecast ที่ใช้' : 'ยอดที่นับ') : typedOver ? mismatchText(doc.amount!, m.forecast!, 'Forecast ที่พิมพ์ไว้') : '';
  const useDoc = () => (mm ? e.updateDoc(d.id, doc.id, { amount: mm.doc, basis: 'manual' }) : e.updateDeal(d.id, { forecast: null }));
  const goes = h.state === 'cur' ? TARGET_TH.forecast : v.typed && doc.target === 'forecast' ? 'Forecast พิมพ์เองทีหลัง' : doc.target === 'forecast' ? 'ไม่ได้ใช้ (มียอดที่ใหม่กว่า)' : TARGET_TH[doc.target];
  const meta = [doc.docDate ? 'ลงวันที่ ' + isoTh(doc.docDate) : '', 'แนบโดย ' + (doc.by || 'ไม่ระบุ'), doc.name, doc.fileId ? 'Drive ของทีม' : 'อยู่ในเครื่องที่แนบ รออัปโหลด'].filter(Boolean).join(' · ');
  const olds = v.versions.length > 1 ? [...v.versions].reverse() : [];
  // the check (package notify): its status, and "ตรวจใบนี้" for a checker while it waits
  const cv = e.qtCheckFor(doc);
  const check = cv?.status === 'wait' && !e.checkBlock(doc) ? () => set({ qtCheck: doc.id, qtSig: '' }) : undefined;
  return (
    <div className={'sl-docc qt' + (warn ? ' warn' : '')}>
      <div className="sl-docc-r">
        <DocThumb doc={doc} tick={tick} onOpen={() => open(doc)} />
        <div className="qt-h">
          <span className="sl-docc-t">
            <span className="qt-tl">
              <span>{KIND_TH.quotation}{doc.docNo ? ' ' + doc.docNo : ''}</span>
              <span className="qt-v">· ฉบับที่ {h.n}</span>
            </span>
            <small>{meta}</small>
            {cv && <QtCheckLine doc={doc} v={cv} onCheck={check} sent={e.qtSentFor(doc)} admin={e.can('set.users')} />}
          </span>
          {money && (
            <span className="sl-docc-a">
              <b>{doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : '—'}</b>
              {warn ? <small className="warn">ไม่ตรงเอกสาร</small> : <small className={h.state === 'cur' ? 'ok' : ''}>{goes}</small>}
            </span>
          )}
        </div>
      </div>
      <QtBack v={cv} />
      {money && warn && (
        <p className="sl-docc-w">
          {warn}
          {!ro && <> · <button type="button" className="lnk" onClick={useDoc}>ใช้ยอดจากเอกสาร {fmtMoney(mm ? mm.doc : doc.amount)}</button></>}
        </p>
      )}
      {ro ? (
        <div className="qt-acts">
          {opens && <button type="button" className="btn xs" onClick={() => open(doc)}>{SHOWABLE.test(doc.mime) ? 'เปิดไฟล์' : 'ดาวน์โหลดไฟล์'}</button>}
          <span className="qt-ro">{qtRoText(e.can('docs.up'), d.resp)}</span>
        </div>
      ) : form ? (
        <QtForm d={d} doc={doc} n={h.n} onDone={(said) => (setForm(false), said && acts.say(said))} />
      ) : (
        <div className="qt-acts">
          <button type="button" className="btn xs" onClick={() => onRevise(doc.id)}>แนบฉบับแก้ไข</button>
          <button type="button" className="lnk" onClick={() => setForm(true)}>แก้ไขข้อมูล</button>
          <button type="button" className="lnk" onClick={() => setSwap(true)}>เปลี่ยนไฟล์</button>
          {busy && <span className="qt-busy" role="status">{busy}</span>}
          <QtMenu
            label={'เพิ่มเติม ใบเสนอราคา' + (doc.docNo ? ' ' + doc.docNo : '')}
            items={[
              { label: 'ดาวน์โหลดไฟล์', sub: doc.name, act: download },
              // item 7: this quotation is for several companies (a deal with money received, a plan or closed
              // keeps its job: lib/joint canMergeFrom)
              ...(e.canJoint() && e.canDeal('edit.deal', d) && canMergeFrom(e.sales, d)
                ? [{ label: 'รวมเป็นใบเสนอราคาร่วม', sub: 'ใบนี้ทำให้หลายบริษัท ยอดนับครั้งเดียว', act: () => set({ jqDlg: { k: 'new', from: d.id } }) }]
                : []),
              { label: `ลบฉบับที่ ${h.n}`, sub: qtDelText(v, d), act: () => void deleteQt(e, d, v, acts.say), sep: true },
            ]}
          />
        </div>
      )}
      {olds.length > 0 && (
        <div className="qt-vers" role="list" aria-label="ฉบับของใบเสนอราคานี้">
          <span className="qt-vers-h">ฉบับของใบเสนอราคานี้</span>
          {olds.map((x) => (
            <div key={x.doc.id} className={'qt-ver' + (x === h ? ' cur' : '')} role="listitem">
              <span className="qt-vn">{qtVerLabel(x)}</span>
              <span className={x === h ? '' : 'qt-vw'}>{qtVerText(x, v.typed)}</span>
              <span className="r">{x !== h && <button type="button" className="lnk" onClick={() => open(x.doc)} aria-label={`เปิดไฟล์ ${qtVerLabel(x)} ${x.doc.name}`}>เปิดไฟล์</button>}</span>
            </div>
          ))}
        </div>
      )}
      {swap && <QtSwap d={d} doc={doc} n={h.n} onClose={() => setSwap(false)} />}
    </div>
  );
}

/** The card's quiet ⋯ menu: words only; Escape or a click elsewhere closes it, arrows move through it. */
function QtMenu({ label, items }: { label: string; items: { label: string; sub: string; act: () => void; sep?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  return (
    <span
      ref={ref}
      className="qt-mw"
      onBlur={(ev) => open && !ev.currentTarget.contains(ev.relatedTarget as Node) && setOpen(false)}
      onKeyDown={(ev) => {
        if (!open) return;
        if (ev.key === 'Escape') {
          ev.stopPropagation(); // the menu only, not the panel
          close();
        } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') || [])];
          const i = all.indexOf(document.activeElement as HTMLElement);
          all[(i + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
          ev.preventDefault();
        }
      }}
    >
      <button ref={btn} type="button" className="sl-more hv" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <span role="menu" className="menu qt-menu" aria-label={label}>
          {items.map((x) => (
            <span key={x.label} className="qt-mi">
              {x.sep && <hr />}
              <button role="menuitem" type="button" className="menu-i" onClick={() => (close(), x.act())}>
                {x.label}
                <small>{x.sub}</small>
              </button>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * "แก้ไขข้อมูล": correct a version's figures in place (a misread or a typo; a new price is a revision):
 * amount, number, date, type, and which of the document's figures is counted (with or before VAT, after
 * withholding), offered once the file has been read here ("อ่านค่าจากไฟล์อีกครั้ง" reads it again).
 * Saving re-confirms nothing but what changed (engine.updateDoc); the QUOTATION note follows the number.
 */
export function QtForm({ d, doc, n, onDone }: { d: Deal; doc: DealDoc; n: number; onDone: (said?: string) => void }) {
  const { engine: e } = useApp();
  const [amount, setAmount] = useState(doc.amount != null ? fmtMoney(doc.amount) : '');
  const [basis, setBasis] = useState<DealDoc['basis']>(doc.basis);
  const [docNo, setDocNo] = useState(doc.docNo);
  const [docDate, setDocDate] = useState(doc.docDate);
  const [kind, setKind] = useState<DocKind>(doc.kind);
  const [facts, setFacts] = useState<DocFacts | null>(qtFacts.get(doc.id) || null);
  const [reading, setReading] = useState('');
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => abort.current?.abort();
  }, []);
  const parsed = parseAmount(amount);
  const opts = facts ? BASIS_LONG.map(([b, label]) => [b, label, facts[b as 'total' | 'subtotal' | 'netPay']] as const).filter((x): x is readonly [DealDoc['basis'], string, number] => x[2] != null) : [];
  const whtPct = facts && facts.wht != null && facts.subtotal ? Math.round((facts.wht / facts.subtotal) * 100) : null;
  const reread = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setErr('');
    setReading(doc.fileId ? 'กำลังเปิดไฟล์ (ไฟล์ใน Drive ของทีมอาจใช้เวลาสักครู่)' : 'กำลังเปิดไฟล์');
    try {
      const blob = await e.docBlob(doc);
      const [{ readDocText }, { analyzeDocText, factsScore }] = await Promise.all([import('../lib/docText'), import('../lib/docExtract')]).catch((x) => {
        throw new Error('โหลดตัวอ่านเอกสารไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้านี้', { cause: x });
      });
      const t = await readDocText(blob, { signal: ctl.signal, onProgress: (msg) => setReading(msg), judge: (x) => factsScore(analyzeDocText(x)) });
      if (ctl.signal.aborted) return;
      const fx = analyzeDocText(t.text);
      qtFacts.set(doc.id, fx);
      setFacts(fx);
      // what the form lacks, the file gives; what was typed stays
      if (!docNo.trim() && fx.docNo) setDocNo(fx.docNo);
      if (!docDate && fx.docDate) setDocDate(fx.docDate);
      if (fx.total == null && fx.subtotal == null && fx.netPay == null) setErr('ไม่พบยอดรวม VAT หรือก่อน VAT ในไฟล์นี้ พิมพ์ยอดเองได้');
    } catch (x) {
      if (!ctl.signal.aborted) setErr('อ่านไฟล์ไม่สำเร็จ: ' + ((x as Error)?.message || x));
    } finally {
      if (!ctl.signal.aborted) setReading('');
    }
  };
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    if (parsed === undefined) return setErr('อ่านยอดเงินไม่ได้ พิมพ์ตัวเลขเดียว เช่น 107,000');
    const a = parsed;
    // a figure picked from the file keeps its basis; one typed over it is the user's own
    const b: DealDoc['basis'] = a === doc.amount && basis === 'manual' ? doc.basis : basis;
    e.updateDoc(d.id, doc.id, { amount: a, basis: b, docNo: docNo.trim().slice(0, 60), docDate, kind });
    onDone(`แก้ไขข้อมูลใบเสนอราคา${docNo.trim() ? ' ' + docNo.trim() : ''} ฉบับที่ ${n} แล้ว${a != null ? ' · ' + fmtMoney(a) + ' บาท' : ''}`);
  };
  return (
    <form ref={box} className="qt-form" onSubmit={save} onKeyDown={(ev) => ev.key === 'Escape' && (ev.stopPropagation(), onDone())} aria-label={`แก้ไขข้อมูล ฉบับที่ ${n}`}>
      <div className="qt-form-h">
        <b>แก้ไขข้อมูล · ฉบับที่ {n}</b>
        <button type="button" className="lnk" onClick={reread} disabled={!!reading}>อ่านค่าจากไฟล์อีกครั้ง</button>
      </div>
      <div className="qt-grid">
        <label className="qt-lab">
          ยอด (บาท)
          <input className="fld qt-amt" value={amount} inputMode="decimal" aria-invalid={parsed === undefined} onChange={(ev) => (setAmount(ev.target.value), setBasis('manual'))} />
        </label>
        <label className="qt-lab">
          เลขที่ใบเสนอราคา
          <input className="fld" value={docNo} maxLength={60} onChange={(ev) => setDocNo(ev.target.value)} />
        </label>
        <span className="qt-lab">
          ลงวันที่
          <DateField value={docDate} onChange={setDocDate} label="ลงวันที่" placeholder="ไม่ระบุ" />
        </span>
        <SelField className="qt-lab" text="ประเภทเอกสาร" value={kind} onChange={(x) => setKind(x as DocKind)} options={(Object.keys(KIND_TH) as DocKind[]).map((k) => ({ v: k, label: KIND_TH[k] }))} />
      </div>
      {reading && <span className="qt-form-n" role="status">{reading}</span>}
      {opts.length > 0 ? (
        <div className="qt-basis" role="radiogroup" aria-label="ใช้ยอดไหน">
          <span className="qt-basis-h">ใช้ยอดไหน · ค่าที่อ่านได้จากไฟล์</span>
          {opts.map(([b, label, val]) => (
            <label key={b} className="hv-tx">
              <input type="radio" name={'qtb-' + doc.id} checked={parsed === val && (basis === b || (basis === 'manual' && opts.find((o) => o[2] === parsed)?.[0] === b))} onChange={() => (setBasis(b), setAmount(fmtMoney(val)))} />
              <span>{label}{b === 'netPay' && whtPct ? ` ${whtPct}%` : ''}</span>
              <b>{fmtMoney(val)} บาท</b>
            </label>
          ))}
        </div>
      ) : (
        <p className="qt-form-n">
          ยอดนี้เป็น{BASIS_WORD[doc.basis]} · กด “อ่านค่าจากไฟล์อีกครั้ง” เพื่อเลือกยอดรวม VAT ก่อน VAT หรือหลังหัก ณ ที่จ่าย
        </p>
      )}
      {err && <span className="t-bad qt-form-n" role="alert">{err}</span>}
      <span className="qt-form-n">ใช้แก้ค่าที่พิมพ์หรืออ่านผิด ถ้าลูกค้าได้ใบที่แก้ราคาแล้ว ให้ใช้ “แนบฉบับแก้ไข” ฉบับเดิมจะเก็บไว้ให้เทียบ</span>
      <div className="qt-form-f">
        <button type="button" className="quiet" onClick={() => onDone()}>ยกเลิก</button>
        <button type="submit" className="btn pri xs">บันทึก</button>
      </div>
    </form>
  );
}

/**
 * "เปลี่ยนไฟล์": the same quotation with another file (a wrong file attached, the signed copy). The new
 * file is read and compared with what is stored (amount, number, date): a match says so; a difference
 * suggests a revision instead ("แนบเป็นฉบับแก้ไขแทน" takes the file there). The values stay as they are;
 * the old file goes to the team Drive's trash (engine.replaceDocFile). `onSaved`: after the swap, or the
 * revision attached instead.
 */
export function QtSwap({ d, doc, n, onClose, onSaved }: { d: Deal; doc: DealDoc; n: number; onClose: () => void; onSaved?: () => void }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const [file, setFile] = useState<File | null>(null);
  const [facts, setFacts] = useState<DocFacts | null>(null);
  const [prog, setProg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState('');
  const [asRev, setAsRev] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const pick = async (f: File) => {
    abort.current?.abort();
    setFile(null);
    setFacts(null);
    setErr('');
    setSaving('');
    const bad = f.size > DOC_MAX_BYTES ? 'ไฟล์ใหญ่เกิน 10 MB' : !docMime(f) ? 'รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)' : '';
    if (bad) {
      setErr(`${bad} — เลือกไฟล์อื่น (${f.name})`);
      if (input.current) input.current.value = '';
      return;
    }
    setFile(f);
    const ctl = new AbortController();
    abort.current = ctl;
    setProg('กำลังเปิดไฟล์');
    try {
      const [{ readDocText }, { analyzeDocText, factsScore }] = await Promise.all([import('../lib/docText'), import('../lib/docExtract')]);
      const t = await readDocText(f, { signal: ctl.signal, onProgress: (msg) => setProg(msg), judge: (x) => factsScore(analyzeDocText(x)) });
      if (ctl.signal.aborted) return;
      setFacts(analyzeDocText(t.text));
    } catch {
      // nothing read: the file can still be swapped, checked by eye
    } finally {
      if (!ctl.signal.aborted) setProg('');
    }
  };
  if (asRev && file) return <DocAttach deal={d} stage={QUOTE_STAGE} kind="quotation" target="forecast" revise={doc.id} file={file} onClose={onClose} onSaved={() => onSaved?.()} />;
  const c = swapCheck(doc, facts);
  const read = [c.amount != null ? fmtMoney(c.amount) + ' บาท' : '', c.docNo, c.docDate ? isoTh(c.docDate) : ''].filter(Boolean).join(' · ');
  const save = async () => {
    if (!file) return;
    setSaving('กำลังบันทึก');
    try {
      const x = await e.replaceDocFile(d.id, doc.id, file);
      if (facts) qtFacts.set(x.id, facts);
      onClose();
      onSaved?.();
      acts.say(`เปลี่ยนไฟล์ของใบเสนอราคา${doc.docNo ? ' ' + doc.docNo : ''} ฉบับที่ ${n} แล้ว`);
    } catch (x) {
      setSaving('บันทึกไม่สำเร็จ: ' + ((x as Error)?.message || x));
    }
  };
  const kb = (b: number) => (b / 1024).toFixed(0) + ' KB';
  return (
    <Modal title={`เปลี่ยนไฟล์ · ${doc.docNo || 'ใบเสนอราคา'} ฉบับที่ ${n}`} onClose={onClose} width={560}>
      <span className="sl-dlg-sub">{d.client}</span>
      <div className="qt-swap">
        <p className="qt-swap-p">ใช้เมื่อแนบไฟล์ผิด เช่น แนบไฟล์ของลูกค้ารายอื่น หรือได้ไฟล์ที่เซ็นแล้ว ยอด เลขที่ และวันที่ยังเหมือนเดิม ถ้าลูกค้าได้ใบที่แก้ราคาแล้ว ให้ใช้ “แนบฉบับแก้ไข” แทน</p>
        <div className="qt-swap-r">
          <span className="qt-swap-l">ไฟล์ตอนนี้</span>
          <span className="qt-swap-v">{doc.name} · {kb(doc.size)} · แนบ {doc.at ? dmTh(localDay(doc.at)) : ''} โดย {doc.by || 'ไม่ระบุ'}</span>
        </div>
        <div className="qt-swap-r">
          <span className="qt-swap-l">ไฟล์ใหม่</span>
          <span className="qt-swap-f">
            <button type="button" className="btn sm" onClick={() => input.current?.click()} autoFocus>{file ? 'เลือกไฟล์อื่น' : 'เลือกไฟล์'}</button>
            {file && <span className="t-sec" title={file.name}>{file.name} · {kb(file.size)}</span>}
          </span>
          <input ref={input} type="file" accept={DOC_ACCEPT} hidden onChange={(ev) => { const f = ev.target.files?.[0]; if (f) pick(f); }} />
        </div>
        {prog && <span className="qt-form-n" role="status">{prog}</span>}
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        {file && !prog && (
          c.tone === 'ok' ? (
            <p className="sl-xchk ok" role="status">ระบบอ่านไฟล์ใหม่ได้ <b>{read}</b> ตรงกับข้อมูลเดิม</p>
          ) : c.tone === 'warn' ? (
            <div className="sl-xchk warn qt-swap-w" role="status">
              <span>ไฟล์ใหม่อ่านได้ {read} · {thList(c.differs)}ไม่ตรงกับข้อมูลเดิม ({[doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : '', doc.docNo, doc.docDate ? isoTh(doc.docDate) : ''].filter(Boolean).join(' · ')})</span>
              <span>ถ้าเป็นใบที่แก้ราคาแล้ว ใช้ “แนบฉบับแก้ไข” ฉบับนี้จะเก็บไว้เป็นฉบับเดิม · <button type="button" className="lnk" onClick={() => setAsRev(true)}>แนบเป็นฉบับแก้ไขแทน</button></span>
            </div>
          ) : (
            <p className="qt-form-n">อ่านยอดจากไฟล์ใหม่ไม่ได้ ตรวจด้วยตาว่าเป็นใบเดียวกับฉบับที่ {n}</p>
          )
        )}
        <div className="qt-next">หลังเปลี่ยน: {doc.fileId ? 'ไฟล์เดิมย้ายไปถังขยะของ Drive ทีม (เจ้าของสคริปต์กู้คืนได้ใน 30 วัน)' : 'ไฟล์เดิมยังไม่ได้อัปโหลด จะลบออกจากเครื่องนี้'} · ยอด เลขที่ และวันที่ของฉบับที่ {n} เหมือนเดิม</div>
      </div>
      {saving && <span role="status" className={saving.startsWith('บันทึกไม่') ? 't-bad qt-form-n' : 'qt-form-n'}>{saving}</span>}
      <div className="dlg-act">
        <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn pri" disabled={!file || !!prog || saving === 'กำลังบันทึก'} onClick={save}>เปลี่ยนไฟล์</button>
      </div>
    </Modal>
  );
}

/**
 * The quotation in the phone card's QUOTATION editor: a small card (picture, number and version, figure,
 * what it counts toward), "แนบฉบับแก้ไข", "แก้ไขข้อมูล" | "เปลี่ยนไฟล์", and the earlier versions.
 * `onChange`: its figures were saved or its file swapped (the QUOTATION note may name it anew: the
 * editor's note field follows, see lib/stepEditor).
 */
export function QtPhone({ d, v, onRevise, onChange }: { d: Deal; v: QtView; onRevise: (docId: string) => void; onChange?: () => void }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const [form, setForm] = useState(false);
  const [swap, setSwap] = useState(false);
  const [tick, setTick] = useState(0);
  const h = v.head!;
  const doc = h.doc;
  const open = (x: DealDoc) => void openDocFile(e, x).then(() => setTick((k) => k + 1));
  const olds: QtVersion[] = v.versions.filter((x) => x !== h).reverse();
  const goes = h.state === 'cur' ? TARGET_TH.forecast : v.typed && doc.target === 'forecast' ? 'Forecast พิมพ์เองทีหลัง' : TARGET_TH[doc.target];
  const cv = e.qtCheckFor(doc);
  const ro = !e.canQuote(d);
  return (
    <>
      <div className="qt-mc">
        <DocThumb doc={doc} tick={tick} onOpen={() => open(doc)} />
        <span className="qt-mc-t">
          <span>{doc.docNo || KIND_TH.quotation} · ฉบับที่ {h.n}</span>
          <span className="qt-mc-m"><b>{doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : 'ไม่ระบุยอด'}</b>{doc.docDate ? ' · ' + isoTh(doc.docDate) : ''}</span>
          <span className={'qt-mc-g' + (h.state === 'cur' ? ' ok' : '')}>
            {cv && <QtCheckLine doc={doc} v={cv} bare />}
            {goes}
          </span>
        </span>
      </div>
      <QtBack v={cv} />
      {cv?.status === 'wait' && !e.checkBlock(doc) && (
        <button type="button" className="lnk qt-go" onClick={() => set({ qtCheck: doc.id, qtSig: '' })}>ตรวจใบนี้</button>
      )}
      {ro ? (
        <span className="qt-ro">{qtRoText(e.can('docs.up'), d.resp)}</span>
      ) : form ? (
        <QtForm d={d} doc={doc} n={h.n} onDone={(said) => (setForm(false), said && (acts.say(said), onChange?.()))} />
      ) : (
        <>
          <button type="button" className="btn wide" onClick={() => onRevise(doc.id)}>แนบฉบับแก้ไข</button>
          <span className="qt-m2">
            <button type="button" className="btn" onClick={() => setForm(true)}>แก้ไขข้อมูล</button>
            <button type="button" className="btn" onClick={() => setSwap(true)}>เปลี่ยนไฟล์</button>
          </span>
        </>
      )}
      {olds.map((x) => (
        <div key={x.doc.id} className="qt-mv">
          <span className="qt-mv-n">{qtVerLabel(x)}</span>
          <span className="qt-mv-r">
            <span>{qtVerShort(x)}</span>
            <button type="button" className="lnk" onClick={() => open(x.doc)} aria-label={`เปิดไฟล์ ${qtVerLabel(x)}`}>เปิดไฟล์</button>
          </span>
        </div>
      ))}
      {swap && <QtSwap d={d} doc={doc} n={h.n} onClose={() => setSwap(false)} onSaved={onChange} />}
    </>
  );
}
