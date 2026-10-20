import { useEffect, useMemo, useRef, useState, type DragEvent, type FocusEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dmTh, dtTh, isoTh, todayISO } from '../lib/format';
import { norm } from '../lib/core';
import {
  ACT_TH, DEAL_STAGE, HOW_TH, KIND_TH, NOTE_MAX, PLAN_MAX, QUOTE_STAGE, actsOf, beYear, closeReady, dealMoney, dealResult, dealSteps, docMismatch, docsOf, dueOf, dupCounted, fmtMoney,
  lastContactInfo, mismatchText, overdueDays, paidNote, parseAmount, payStageFor, payStages, payState, planLines, planStart, planOf, splitAmounts, stepCode, stepOf, whtRate, wonDate,
  type Deal, type DealAct, type DealDoc, type DocKind, type LineView, type PayHow, type PlanInput, type StageState, type StepView,
} from '../lib/sales';
import { OLD_TH } from '../lib/steps';
import { CLOSE_TITLE, JOINT_PAID, acFig, actualSource, closingView, diffText, dupText, fcFig, lineFig, lineMeta, lineStatusView, overPlan, relText, shortName, stepEdit, type FigView } from '../lib/salesUi';
import { SHOWABLE, openDocFile } from './DocAttach';
import { useAttach } from './AttachProvider';
import { panelEntry, recvPlan, type AttachEntry } from '../lib/attachPlan';
import { DocThumb } from './DocThumb';
import { QtCard } from './QtCard';
import { isQtVersion, qtView } from '../lib/quotes';
import { followStep, stepMoved, stepTyped, type StepEd, type StepFields } from '../lib/stepEditor';
import { ActForm, ActList, StepEntries, actCode } from './DealActs';
import { DateChip } from './DateChip';
import { Icon } from './icons';
import { ReadOnly } from './ReadOnly';
import { useSalesActs } from './SalesToast';
import { Bead, beadOf, reachedOf } from './StageTrack';
import { SelField, Select } from './Select';
import { DateField, Status, labelCol } from './ui';
import { commitFocus, isClosingBlur, useDialog } from './useDialog';
import { PlanYears, YearChip } from './PlanYears';
// joint quotations (package quotes, item 7): the header's own panel, a member's line and stages
import { jointHeadOf, jointOf, jointRole } from '../lib/sales';
import { isJointNote, jointNo, strayDocs } from '../lib/joint';
import { JointPanel, MemberBanner, MemberStage, MemberStrip } from './JointQt';
// สัดส่วนรายได้ (package dash, items 8 and 9b)
import { ShareCard } from './ShareCard';
// the month check (cash follow-up): the chips on received lines, the question before a checked line changes
import { PayChip, PayNoPlan, PayNote, PayStripChip, askPay, useDealChecks, usePayGuard } from './PayChk';
import { invoiceOnly, planCheckWords, previewOf } from '../lib/payCheck';
// ค่าใช้จ่ายของงาน (job expenses), after the payment plan: only with ดูค่าใช้จ่ายและกำไรของงาน
import { ExpCard, dealGoneCheckWords } from './ExpCard';
import { expensesOf } from '../lib/expense';

const TARGET_TH = { forecast: 'เป็น Forecast', actual: 'รวมใน Actual', none: 'ไม่นับยอด' };
const HOWS: PayHow[] = ['transfer', 'cheque', 'cash', 'other'];

/**
 * A box that saves when it loses focus (so typing doesn't write a change per keystroke). Not focused,
 * it shows the saved value, a teammate's change included. While it has focus a teammate's change
 * doesn't replace what is being typed; on leaving, if the saved value changed since the box got focus,
 * the person is asked before theirs goes over it.
 */
function useEditBox<T extends HTMLInputElement | HTMLTextAreaElement>(value: string, commit: (typed: string, el: T) => void, valid?: (typed: string) => boolean) {
  const ref = useRef<T>(null);
  const atFocus = useRef<string | null>(null); // the saved value when the box got focus
  // set once: React re-applies a changed defaultValue even to a focused box nobody has typed in yet
  const [first] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (el && atFocus.current === null && el.value !== value) el.value = value;
  }, [value]);
  return {
    ref,
    defaultValue: first,
    onFocus: () => {
      atFocus.current = value;
    },
    onBlur: (ev: FocusEvent<T>) => {
      const was = atFocus.current ?? value, el = ev.currentTarget, typed = el.value;
      atFocus.current = null;
      if (typed === value) return;
      // what can't be saved anyway (commit refuses it) is not worth the question
      if (typed === was || (value !== was && (!valid || valid(typed)) && !window.confirm(`มีคนแก้ช่องนี้ระหว่างที่พิมพ์อยู่:\n"${value || '(ว่าง)'}"\n\nบันทึกของคุณทับหรือไม่?`))) {
        el.value = value; // untouched here, or theirs kept: show the saved value
        return;
      }
      commit(typed, el);
    },
  };
}

function Field({ label, value, onSave, type = 'text', list, placeholder }: { label: string; value: string; onSave: (v: string) => void; type?: string; list?: string; placeholder?: string }) {
  const box = useEditBox<HTMLInputElement>(value, (v) => onSave(v));
  return (
    <label style={labelCol}>
      {label}
      <input {...box} type={type} list={list} placeholder={placeholder} onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} className="fld" />
    </label>
  );
}

/** The customer's name in the panel's head, edited in place. */
function ClientName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const box = useEditBox<HTMLInputElement>(value, (v, el) => (v.trim() ? onSave(v) : (el.value = value)), (v) => !!v.trim());
  return <input {...box} aria-label="ชื่อลูกค้า" onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} className="dp-name hv co-name title" />;
}

/** The last amount a money box refused (closing the panel right after must say so). */
let refused: { msg: string; at: number } | null = null;
/** A Forecast / Actual figure of the summary strip: the figure (a button) turns into a box on click;
 *  "120,000.-", "1.5 ล้าน", "200k" are read; text that isn't one clear amount is refused with a message
 *  instead of erasing the saved figure. */
function StripMoney({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number | null) => void }) {
  const [ed, setEd] = useState(false);
  const [err, setErr] = useState('');
  const shown = value == null ? '' : fmtMoney(value);
  const box = useEditBox<HTMLInputElement>(shown, (typed, el) => {
    const v = parseAmount(typed);
    if (v === undefined) {
      const msg = `อ่าน "${typed}" เป็นจำนวนเงินไม่ได้ พิมพ์ตัวเลขเดียว เช่น 120,000 หรือ 1.5 ล้าน`;
      setErr(msg);
      el.value = shown;
      // also when the panel is being closed (Escape / ×): the message would vanish with it
      if (isClosingBlur()) window.alert(msg + ' (ยอดเดิมยังอยู่)');
      else refused = { msg, at: Date.now() };
      return;
    }
    setErr('');
    onSave(v);
  }, (typed) => parseAmount(typed) !== undefined);
  if (!ed)
    return (
      <>
        <button type="button" className={'dp-strip-v hv-tx' + (value == null ? ' none' : '')} onClick={() => setEd(true)} title={`แก้ ${label} (พิมพ์เอง)`} aria-label={`${label} ${value == null ? 'ยังไม่มี' : fmtMoney(value)} แก้`}>
          {value == null ? '—' : fmtMoney(value)}
        </button>
        {err && <small role="alert" className="bad">{err}</small>}
      </>
    );
  return (
    <input
      {...box}
      autoFocus
      inputMode="decimal"
      aria-label={label + ' (บาท)'}
      placeholder="เช่น 120,000"
      className="fld dp-strip-in"
      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === 'Escape') && (ev.key === 'Escape' && (ev.currentTarget.value = shown), ev.currentTarget.blur())}
      onBlurCapture={() => setTimeout(() => setEd(false), 0)}
    />
  );
}

/** The word under a figure of the summary strip (salesUi FigView): "จากเอกสาร QT-1" (ok), "ไม่ตรงเอกสาร" or
 *  "นับซ้ำ" (warn, the numbers in its title and on the document's card), or "พิมพ์เอง · แนบเอกสาร". `none`: what
 *  shows without a figure (read-only), `extra`: a second fact after it ("บันทึกเอง"). */
function FigLine({ v, ro, onAttach, none, extra }: { v: FigView; ro: boolean; onAttach: () => void; none: string; extra?: string }) {
  const tail = extra ? ' · ' + extra : '';
  if (v.kind === 'ok') return <small className="ok" title={v.title}>จากเอกสาร {v.docNo}{tail}</small>;
  if (v.kind === 'warn') return <small className="warn" title={v.title}>{v.word}{tail}</small>;
  if (ro) return <small>{v.word || none}</small>;
  return (
    <small title={v.title || undefined}>
      {v.word ? v.word + ' · ' : ''}
      <button type="button" className="lnk" onClick={onAttach}>แนบเอกสาร</button>
    </small>
  );
}

/** `ro`: an account that can only read still opens the linked company, but links and unlinks nothing
 *  (not inside a read-only fieldset, which would disable that button too). */
function LinkCompany({ d, ro }: { d: Deal; ro: boolean }) {
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
      <div className="dp-link">
        <span>เชื่อมกับบริษัท <b>{c.name}</b> <span className="t-muted">({c.code})</span></span>
        <button type="button" onClick={() => set({ sel: c.id, dTab: 'info' })} className="btn xs">เปิดหน้าบริษัท</button>
        {!ro && <button type="button" onClick={() => e.updateDeal(d.id, { gid: null })} className="quiet">ยกเลิกการเชื่อม</button>}
      </div>
    );
  if (ro) return <span className="t-sec">ยังไม่ได้เชื่อมกับบริษัทในทะเบียน</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="t-sec">ยังไม่ได้เชื่อมกับบริษัทในทะเบียน เชื่อมแล้วจะเห็นสถานะ CFO / GI และสถานะการขายนี้ในหน้าบริษัท</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="พิมพ์ชื่อบริษัทเพื่อค้นในทะเบียน" aria-label="ค้นบริษัทในทะเบียน" className="fld" style={{ flex: '1 1 220px', minWidth: 0 }} />
        <button type="button" onClick={() => set({ addCust: { deal: false, name: d.client, link: d.id } })} className="btn xs">เพิ่มเป็นลูกค้าใหม่ในทะเบียน</button>
      </div>
      {found.map((x) => (
        <button key={x.id} type="button" onClick={() => e.updateDeal(d.id, { gid: x.id })} className="dp-found hv">
          <span>{x.name}</span>
          <span className="t-meta">{x.code} · เชื่อม</span>
        </button>
      ))}
    </div>
  );
}

/** An attached document: a picture of it (opens the file), what it is and what it counts toward; a click
 *  shows its actions (open the file, correct the amount or the type, delete). A figure kept against the
 *  document says so with both numbers, and offers the document's. */
function DocCard({ d, doc, inUse, stray }: { d: Deal; doc: DealDoc; inUse: boolean; stray?: boolean }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  // a received line accounting checked (or of a closed month): asked before it changes (PayChk.tsx), the
  // document's money compared before and after (one that starts to count is asked about too)
  const guard = usePayGuard();
  const ro = !e.can('docs.up');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState('');
  const [link, setLink] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => () => {
    if (link) URL.revokeObjectURL(link);
  }, [link]);
  const save = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.click();
  };
  const show = async () => {
    if (link) return void (SHOWABLE.test(doc.mime) ? window.open(link, '_blank', 'noopener') : save(link));
    setBusy(doc.fileId ? 'กำลังเปิด… (ไฟล์ใน Drive ของทีมอาจใช้เวลาสักครู่)' : 'กำลังเปิด…');
    const t0 = Date.now();
    try {
      const url = URL.createObjectURL(await e.docBlob(doc));
      setLink(url);
      setBusy('');
      setTick((n) => n + 1); // the file is in this browser now: its picture can be made
      // a pop-up opened long after the click is blocked by the browser: then the link below is used
      if (!SHOWABLE.test(doc.mime)) save(url);
      else if (Date.now() - t0 < 2500) window.open(url, '_blank', 'noopener');
    } catch (err) {
      setBusy((err as Error)?.message || String(err));
    }
  };
  // a joint quotation's member: a document that would count elsewhere counts nowhere here (lib/joint strayDocs)
  const goes = stray ? 'ไม่นับยอด · อยู่ในใบเสนอราคาร่วม' : inUse ? TARGET_TH[doc.target] : doc.target === 'forecast' ? 'ไม่ได้ใช้ (มียอดที่ใหม่กว่า)' : TARGET_TH[doc.target];
  // the figure counted against the document's own: kept here ("คงยอดเดิม"), or a Forecast typed after it
  const m = dealMoney(e.sales, d), mm = stray ? null : docMismatch(doc);
  const typedOver = !stray && !inUse && doc.target === 'forecast' && m.fcOverride && doc.id === fcFig(e.sales, d).doc?.id && m.forecast != null && doc.amount != null && m.forecast !== doc.amount;
  const warn = mm ? mismatchText(mm.doc, mm.kept, doc.target === 'forecast' ? 'Forecast ที่ใช้' : 'ยอดที่นับ') : typedOver ? mismatchText(doc.amount!, m.forecast!, 'Forecast ที่พิมพ์ไว้') : '';
  const g = stray ? jointOf(e.sales, d) : null;
  const canMove = !!g && e.can('docs.up') && e.canDeal('edit.deal', d) && e.canDeal('edit.deal', g.head);
  const move = () => {
    const how = e.moveToJoint(d.id, doc.id);
    if (how === 'qt') acts.say(`ย้าย${KIND_TH[doc.kind]}${doc.docNo ? ' ' + doc.docNo : ''} ไปเป็นใบเสนอราคาของใบเสนอราคาร่วมแล้ว · นับยอดครั้งเดียวที่ใบเสนอราคาร่วม`);
    else if (how === 'doc') acts.say(`ย้าย${KIND_TH[doc.kind]}${doc.docNo ? ' ' + doc.docNo : ''} ไปที่ใบเสนอราคาร่วมแล้ว · เก็บเป็นเอกสารที่ไม่นับยอด แก้ให้นับได้ที่นั่น`);
  };
  // the document's figure in place of the one kept: the counted amount of a received line changes, so a
  // checked one is asked about first
  const useDoc = () =>
    mm
      ? guard.ask({ d, after: previewOf.doc(e.sales, d.id, doc.id, { amount: mm.doc, basis: 'manual' }), kind: 'edit', title: `ใช้ยอดจากเอกสาร ${doc.docNo || doc.name}`, verb: 'ใช้ยอดจากเอกสาร', run: () => e.updateDoc(d.id, doc.id, { amount: mm.doc, basis: 'manual' }) })
      : e.updateDeal(d.id, { forecast: null });
  return (
    <div className={'sl-docc' + (open ? ' open' : '') + (warn ? ' warn' : '')}>
      <div className="sl-docc-r">
        <DocThumb doc={doc} tick={tick} onOpen={() => void openDocFile(e, doc).then(() => setTick((n) => n + 1))} />
        <button type="button" className="sl-docc-h hv" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="sl-docc-t">
            <span>{KIND_TH[doc.kind]}{doc.docNo ? ' ' + doc.docNo : ''}</span>
            <small>{doc.name} · {(doc.size / 1024).toFixed(0)} KB · {doc.fileId ? 'Drive ของทีม' : 'อยู่ในเครื่องที่แนบ รออัปโหลด'} · แนบโดย {doc.by || 'ไม่ระบุ'}{doc.docDate ? ' · ลงวันที่ ' + isoTh(doc.docDate) : ''}</small>
          </span>
          <span className="sl-docc-a">
            <b>{doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : '—'}</b>
            {warn ? <small className="warn">ไม่ตรงเอกสาร</small> : <small className={inUse ? 'ok' : ''}>{goes}</small>}
          </span>
        </button>
      </div>
      {warn && (
        <p className="sl-docc-w">
          {warn}
          {!ro && <> · <button type="button" className="lnk" onClick={useDoc}>ใช้ยอดจากเอกสาร {fmtMoney(mm ? mm.doc : doc.amount)}</button></>}
        </p>
      )}
      {g && (
        <p className="sl-docc-n">
          บริษัทนี้อยู่ในใบเสนอราคาร่วม{jointNo(e.sales, g) ? ' ' + jointNo(e.sales, g) : ''} ยอดนับที่ใบเสนอราคาร่วมครั้งเดียว เอกสารนี้จึงไม่นับยอด
          {canMove && <> · <button type="button" className="lnk" onClick={move}>ย้ายไปใบเสนอราคาร่วม</button></>}
        </p>
      )}
      {open && (
        <div className="sl-docc-acts">
          <button type="button" onClick={show} className="btn xs">{SHOWABLE.test(doc.mime) ? 'เปิดไฟล์' : 'ดาวน์โหลดไฟล์'}</button>
          {link && SHOWABLE.test(doc.mime) && <a href={link} target="_blank" rel="noopener noreferrer" className="lnk">เปิดในแท็บใหม่</a>}
          {link && <a href={link} download={doc.name} className="lnk">ดาวน์โหลด</a>}
          {!ro && <button type="button" onClick={() => setEdit(!edit)} className="btn xs">{edit ? 'ปิด' : 'แก้ยอด / ประเภท'}</button>}
          {!ro && <button type="button" onClick={() => guard.ask({ d, after: previewOf.doc(e.sales, d.id, doc.id, null), kind: 'delete', title: `ลบเอกสาร ${doc.docNo || doc.name}`, verb: 'ลบ', plain: `ลบเอกสาร "${doc.name}"?`, run: () => e.deleteDoc(d.id, doc.id) })} className="quiet">ลบ</button>}
          {busy && <span className="t-sec">{busy}</span>}
        </div>
      )}
      {open && edit && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.currentTarget);
            const amount = parseAmount(String(fd.get('amount') ?? ''));
            if (amount === undefined) return void window.alert('อ่านยอดเงินไม่ได้ พิมพ์ตัวเลขเดียว เช่น 107,000');
            const target = amount == null ? 'none' : (String(fd.get('target')) as DealDoc['target']);
            const patch = { amount, target, kind: String(fd.get('kind')) as DocKind, docNo: String(fd.get('docNo') || ''), basis: amount === doc.amount ? doc.basis : 'manual' } as const;
            guard.ask({ d, after: previewOf.doc(e.sales, d.id, doc.id, patch), kind: 'edit', title: `แก้ยอด ${doc.docNo || doc.name}`, verb: 'บันทึก', run: () => (e.updateDoc(d.id, doc.id, patch), setEdit(false)) });
          }}
          className="sl-docc-form"
        >
          <label style={labelCol}>ยอด (บาท)<input name="amount" defaultValue={doc.amount ?? ''} inputMode="decimal" className="fld" /></label>
          <SelField style={labelCol} text="นับเป็น" name="target" defaultValue={doc.target} options={[{ v: 'forecast', label: 'Forecast' }, { v: 'actual', label: 'Actual' }, { v: 'none', label: 'ไม่นับยอด' }]} />
          <SelField style={labelCol} text="ประเภท" name="kind" defaultValue={doc.kind} options={(Object.keys(KIND_TH) as DocKind[]).map((k) => ({ v: k, label: KIND_TH[k] }))} />
          <label style={labelCol}>เลขที่เอกสาร<input name="docNo" defaultValue={doc.docNo} className="fld" /></label>
          <button type="submit" className="btn pri sm">บันทึก</button>
          <span className="t-meta" style={{ gridColumn: '1/-1' }}>ลบเอกสารที่มาแทนใบเดิม ใบเดิมยังไม่นับยอด ตั้งกลับได้ที่ “นับเป็น” ของใบนั้น</span>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the panel

/** Attach a document: the button's entry (lib/attachPlan) says what it is; with a dropped `file` the dialog
 *  opens with it, else the file picker opens straight from the click (components/AttachProvider). */
type Attach = (entry: AttachEntry, file?: File) => void;

export function DealPanel() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const d = ui.deal ? e.sales.deals[ui.deal] : undefined;
  const at = useAttach();
  const ref = useRef<HTMLElement>(null);
  const acts = useSalesActs();
  const guard = usePayGuard();
  // focus the panel itself (its first field is the client name: a stray key would rename it)
  useDialog(ref, { focus: 'dialog', on: !!d });
  // opened at the plan (editor or a receipt): it is brought into view
  useEffect(() => {
    if (d && ui.dpPlan) requestAnimationFrame(() => ref.current?.querySelector('.sl-plan')?.scrollIntoView({ block: 'nearest' }));
  }, [ui.dpPlan, ui.deal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const S = e.sales, today = todayISO();
  // blur first: the fields save when they lose focus
  const close = () => {
    commitFocus();
    // an amount refused just now (the click on × / outside blurred the box first): say so before closing
    if (refused && Date.now() - refused.at < 3000) window.alert(refused.msg + ' (ยอดเดิมยังอยู่)');
    refused = null;
    set({ deal: null });
  };
  // an account that may not edit this deal (view only, or another person's under "own" scope) sees
  // everything it may see but changes nothing here; money shows only with ดูยอดเงิน
  const ro = !e.canDeal('edit.deal', d);
  const money = e.can('view.money');
  const up = (p: Partial<Deal>) => e.updateDeal(d.id, p);
  const m = dealMoney(S, d);
  const t = dealSteps(S, d, today);
  const ps = payState(S, d, today), P = ps.plan, r = t.result, won = r === 'YES';
  // installments in the deal's words: PAY (a single one), PAY1 … PAYn, "PAY ส่วนที่เหลือ" (the rest without a plan)
  const codes = (ids: string[]) => ids.map((p) => stepCode(S, d, p, today)).join(', ');
  const od = overdueDays(S, d, today);
  const ready = d.jobStatus === 'open' && closeReady(S, d, today);
  const c = d.gid != null ? e.company(d.gid) : undefined;
  // (a document for the Actual at a stage accounting checked, or of a closed month: asked first, useAttach)
  const attach: Attach = (entry, file) => (file ? at.drop(d, entry, file) : at.open(d, entry));
  const planFirst = won || ui.dpPlan !== '';
  // a joint quotation's header has its own panel (this one hosts it: keyboard, Escape, the attach dialog);
  // a member has no money or plan of its own
  const jr = jointRole(S, d);
  if (jr === 'header')
    return (
      <>
        <JointPanel d={d} panelRef={ref} close={close} attach={attach} plan={<><PlanCard d={d} attach={attach} /><ExpCard d={d} /><ShareCard key={'sh' + d.id} d={d} /></>} info={<ContactCard d={d} ro={ro} title="ข้อมูลใบเสนอราคา" />} history={<HistoryCard d={d} />} />
      </>
    );

  // the summary strip: สถานะ · Forecast · Actual · ค้างรับ
  const stWord =
    won ? (P ? (ps.left.length ? `ได้งาน · รับ ${P.paidN}/${P.n} งวด` : 'ได้งาน · รับครบทุกงวด') : ps.left.length ? `ได้งาน · รอชำระ ${codes(ps.left)}` : ps.pays.length ? 'ได้งาน · รับชำระครบ' : 'ได้งาน')
    : r === 'NO' ? 'ไม่ได้งาน' : r === 'WAIT' ? 'รอผล' : t.done ? 'กำลังติดตาม' : 'ยังไม่เริ่ม';
  const stKind = won ? 'ok' : r === 'NO' ? 'bad' : r === 'WAIT' ? 'warn' : t.done ? 'info' : 'neutral';
  const left = P && won ? P.left : won && m.forecast != null ? Math.max(0, m.forecast - (m.actual || 0)) : null;
  const nx = P && won ? P.next : null;
  const typedAc = !m.acDocs && !m.hand && !P;
  // "แนบเอกสาร" at the figures: a quotation for the Forecast (checked against the typed one), an invoice
  // or receipt for the Actual at the installment it pays (checked against the plan or the typed Actual)
  const fv = fcFig(S, d), av = acFig(S, d);
  const attachFc = () => attach({ at: 'quote' });
  // (the installment is the app's choice, the first not received: a receipt may be another one's)
  const attachAc = () => attach({ at: 'pay' });
  // a file dropped anywhere on the panel goes to the current step (lib/attachPlan panelEntry)
  const canDrop = !ro && e.can('docs.up');
  const dropOn = (ev: DragEvent<HTMLElement>) => {
    const f = ev.dataTransfer.files?.[0];
    if (!canDrop || !f) return;
    ev.preventDefault();
    // a bill dropped on the job's expenses is money out, never a receipt of this job (the expense card's
    // own box takes its bill; anywhere else on that card nothing happens)
    if ((ev.target as Element | null)?.closest?.('.xp-card')) return;
    attach(panelEntry(S, d, t.next?.id || '', today), f);
  };
  // one document counted more than once (an old double count, two teammates attaching the same receipt)
  const dups = money && jr !== 'member' ? dupCounted(S, d) : [];

  return (
    <>
      <div onClick={close} className="dp-back" />
      <aside ref={ref} className="panel dp" tabIndex={-1} role="dialog" aria-modal="true" aria-label={d.client} onDragOver={(ev) => canDrop && ev.dataTransfer.types.includes('Files') && ev.preventDefault()} onDrop={dropOn}>
        <div className="dp-head">
          <div className="dp-top">
            <span className="dp-crumb">Sales Tracker · ปี {d.year} · {d.section || 'ไม่ระบุหมวด'}{c ? ' · ' + c.code : ''}</span>
            <span className="dp-acts">
              {!ro &&
                (d.jobStatus === 'closed' ? (
                  // a company of a joint quotation reopens with the whole quotation (it closed as one)
                  jr === 'member' ? (
                    <button type="button" className="btn xs" onClick={() => acts.say(e.reopenJoint(jointHeadOf(S, d.id)) ? 'เปิดใบเสนอราคาร่วมอีกครั้งแล้ว' : e.teamNote || 'ไม่มีรายการให้เปิดอีกครั้ง', { ms: 6000 })} title="เปิดกลับทั้งใบเสนอราคาและทุกบริษัท">เปิดใบเสนอราคาร่วมอีกครั้ง</button>
                  ) : (
                    <button type="button" className="btn xs" onClick={() => up({ jobStatus: 'open' })}>เปิดงานอีกครั้ง</button>
                  )
                ) : (
                  <button type="button" className="btn xs" onClick={() => acts.close(d.id)} title={jr === 'member' ? 'ปิดทั้งใบเสนอราคาร่วมและทุกบริษัท (ถามยืนยัน)' : ready ? 'ย้ายไปแท็บปิดงาน' : 'ยังไม่ครบ ปิดเองได้ (ถามยืนยัน)'}>ปิดงาน</button>
                ))}
              <button type="button" onClick={close} aria-label="ปิด" className="dlg-x"><Icon name="close" size={18} /></button>
            </span>
          </div>
          {ro ? <h3 className="dp-name ro co-name title">{d.client}</h3> : <ClientName value={d.client} onSave={(v) => up({ client: v })} />}
          <span className="dp-meta">{[d.contactName, d.phone, d.resp ? 'ผู้รับผิดชอบ ' + d.resp : 'ยังไม่มอบหมายผู้รับผิดชอบ'].filter(Boolean).join(' · ')}</span>
          {jr === 'member' && <MemberBanner d={d} />}
          <div className="dp-strip">
            <div>
              <span>สถานะ</span>
              <Status kind={stKind}>{stWord}</Status>
              {d.jobStatus === 'closed' ? <small>ปิดงานแล้ว{d.closedDate ? ' ' + isoTh(d.closedDate) : ''}</small> : od != null ? <small className="bad">ไม่ได้ติดต่อ {od} วัน</small> : <small>ทำแล้ว {t.done} จาก {t.total} ขั้น</small>}
            </div>
            {money && jr === 'member' && <>
            <div><span>Forecast</span><MemberStrip d={d} /></div>
            <div><span>Actual</span><b className="none">—</b><small>ชำระผ่านใบเสนอราคาร่วม</small></div>
            <div><span>ค้างรับ</span><b className="none">—</b><small>ดูที่ใบเสนอราคาร่วม</small></div>
            </>}
            {money && jr !== 'member' && <>
            <div>
              <span>Forecast</span>
              {ro ? <b className={m.forecast == null ? 'none' : ''}>{m.forecast == null ? '—' : fmtMoney(m.forecast)}</b> : <StripMoney label="Forecast" value={m.forecast} onSave={(v) => up({ forecast: v })} />}
              <FigLine v={fv} ro={ro} onAttach={attachFc} none="แนบที่ QUOTATION" />
            </div>
            <div>
              <span>Actual</span>
              {ro || !typedAc ? <b className={m.actual == null ? 'none' : ''}>{m.actual == null ? '—' : fmtMoney(m.actual)}</b> : <StripMoney label="Actual" value={m.actual} onSave={(v) => guard.ask({ d, after: previewOf.deal(S, d.id, { actual: v }), kind: 'edit', title: 'แก้ Actual ที่พิมพ์ไว้', verb: 'แก้ยอด', run: () => up({ actual: v }) })} />}
              <FigLine v={av} ro={ro || (!!P && !won)} onAttach={attachAc} none={actualSource()} extra={av.doc && m.hand ? 'บันทึกเอง' : ''} />
              <PayStripChip d={d} />
            </div>
            <div>
              <span>ค้างรับ</span>
              <b className={left ? (nx && nx.lateDays ? 'bad' : 'warn') : 'none'}>{left ? fmtMoney(left) : '—'}</b>
              {won ? (
                nx ? <small className={nx.lateDays ? 'bad' : ''}>{nx.code} · {nx.lateDays ? `เลยกำหนด ${nx.lateDays} วัน` : nx.due ? dmTh(nx.due) : 'ยังไม่กำหนดวัน'}</small> : left ? <small>{codes(ps.left)}</small> : <small className="ok">ครบทุกงวด</small>
              ) : r === 'NO' ? <small>ไม่ได้งาน</small> : P ? <small>แผน {P.n} งวด · {fmtMoney(P.total)}</small> : <small>ยังไม่มีผลการขาย</small>}
            </div>
            </>}
          </div>
        </div>

        <div className="dp-body">
          {dups.map((gr) => (
            // (the panel's warning box, as a short payment's)
            <div key={gr[0].id} className="sl-rf-short" role="status">{dupText(gr)} · เงินก้อนเดียวควรนับครั้งเดียว ที่ใบที่ซ้ำ กด "แก้ยอด / ประเภท" แล้วเลือกนับเป็น "ไม่นับยอด"</div>
          ))}
          {/* the plan is amounts: an account without ดูยอดเงิน follows payments by the PAY stages below */}
          {money && planFirst && jr !== 'member' && <PlanCard d={d} attach={attach} />}
          {money && planFirst && <ExpCard d={d} />}
          {/* สัดส่วนรายได้ under the plan, wherever it is (package dash; only with ดูค่าคอมมิชชั่น); a joint
              quotation's member splits its part of the header's money */}
          {money && planFirst && <ShareCard key={'sh' + d.id} d={d} />}
          {/* its own state (the card held, the quick-add) belongs to this deal */}
          <StepsCard key={d.id} d={d} attach={attach} />
          {money && !planFirst && jr !== 'member' && <PlanCard d={d} attach={attach} />}
          {money && !planFirst && <ExpCard d={d} />}
          {money && !planFirst && <ShareCard key={'sh' + d.id} d={d} />}
          <OtherDocs d={d} attach={attach} />
          <ContactCard d={d} ro={ro} />
          <HistoryCard d={d} />
          {e.can('del.rec') && (
            <button type="button" onClick={() => guard.ask({ d, after: previewOf.noDeal(S, d.id), kind: 'delete', title: `ลบ ${shortName(d.client)}`, verb: 'ลบรายการ', plain: `ลบ "${d.client}" ออกจาก Sales Tracker? (ลบทั้งขั้นตอน โน้ต แผนชำระ และเอกสารที่แนบ${e.can('view.exp') && expensesOf(S, d.id).length ? ' รวมค่าใช้จ่ายของงานและบิล' : ''} ทุกเครื่องในทีม)${dealGoneCheckWords(e, d.id) ? ' · ' + dealGoneCheckWords(e, d.id) : ''}`, run: () => (e.deleteDeal(d.id), close()) })} className="quiet dp-del">
              ลบรายการนี้
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ ขั้นตอนการติดตาม

/** "ผลการขาย (YES / NO)" says "ผลการขาย" where its buttons say YES / NO already (the table, the phone card). */
const thShort = (th: string) => th.replace(/\s*\(YES \/ NO\)$/, '');

/** The vertical timeline of the deal's steps (dealSteps: CONTACT, QUOTATION, FOLLOW, CLOSE, PAY per installment):
 *  each with its date, note, documents and the contacts filed there (an older stage's record too, "บันทึกเดิม
 *  CALL2", edited in place); the next one (or the one chosen with "แก้ไข") as a card to record it; empty steps
 *  further on folded into one line; the closing step at the end. */
function StepsCard({ d, attach }: { d: Deal; attach: Attach }) {
  const { engine: e, ui, set } = useApp();
  const acts = useSalesActs();
  const S = e.sales, today = todayISO();
  const ro = !e.canDeal('edit.deal', d);
  const money = e.can('view.money');
  const t = dealSteps(S, d, today);
  const P = planOf(S, d, today), won = t.result === 'YES';
  // a joint quotation's member: a quotation or money document of its own counts nowhere, so it is not
  // shown at its step as if it counted (เอกสารอื่น lists it, with "ย้ายไปใบเสนอราคาร่วม")
  const stray = strayDocs(S, d);
  const m = dealMoney(S, d);
  const late = overdueDays(S, d, today) != null;
  const [pick, setPick] = useState('');
  // the stored stage being recorded: the one chosen with "แก้ไข" (a step's own, or an older stage's record read
  // into it), else the next step. Once the user is in its fields it is held (pick): a teammate's sync that moves
  // "next" on must not swap the card away under their typing (they are asked about the change when they save)
  // (a step done with a call booked ahead: the record holding that date, an older stage's in place)
  const cardStage = !ro ? pick || (t.next?.ahead ? t.next.top.stage : t.next?.id) || '' : '';
  const isCard = (v: StepView) => !!cardStage && (v.id === cardStage || v.aliases.includes(cardStage));
  // the quick-add of a contact: null = closed, '' = the card's own (under its heading), a step = in that step
  const [actAt, setActAt] = useState<string | null>(null);
  const sec = useRef<HTMLElement>(null);
  const actDone = (a: DealAct | null) => {
    const at = actAt;
    setActAt(null);
    // the keyboard goes back to what opened the form
    requestAnimationFrame(() => sec.current?.querySelector<HTMLElement>(`[data-act-at="${CSS.escape(at || '')}"]`)?.focus());
    if (a) acts.say(`บันทึกการติดต่อแล้ว · ${ACT_TH[a.type]} ${dmTh(a.d)}${a.stage ? ' ที่ ' + actCode(e.sales, a, today) : ''}`);
  };
  /** The contacts inside a step (its records and the older stages' it reads), "บันทึกการติดต่อเพิ่ม" by them. */
  const entriesOf = (v: StepView, off: boolean) => (
    <>
      <StepEntries
        entries={v.entries}
        max={3}
        label={'การติดต่อในขั้น ' + v.code}
        onEditOld={ro ? undefined : (stage) => setPick(stage)}
        add={!ro && !off && actAt !== v.id ? <button type="button" className="lnk sl-tl-act" data-act-at={v.id} onClick={() => setActAt(v.id)} aria-label={'บันทึกการติดต่อเพิ่มที่ ' + v.code}>บันทึกการติดต่อเพิ่ม</button> : undefined}
      />
      {actAt === v.id && <ActForm d={d} stage={v.id} onDone={actDone} />}
    </>
  );
  const views = t.steps, next = t.next?.id || '';
  const emptyFuture = (v: StepView) =>
    v.state === 'future' && v.counted && v.id !== next && !isCard(v) && !v.line && !v.own.n.trim() && !v.entries.length && !v.docs.length && actAt !== v.id;
  const futs = views.filter(emptyFuture);
  const reached = reachedOf(views.map((v) => ({ state: beadOf(v) })));
  const cv = closingView(S, d, today, ro, t);
  const asking = ui.slPrompt === d.id && cv.ready && d.jobStatus === 'open';
  const jm = jointRole(S, d) === 'member';
  const canPlan = money && e.canDeal('edit.pay', d);
  let futDone = false;
  return (
    <section ref={sec} className="dp-card" aria-labelledby="dp-steps">
      <div className="dp-h">
        <h3 id="dp-steps">ขั้นตอนการติดตาม</h3>
        <span className="dp-h-r">
          <span>ทำแล้ว {t.done} จาก {t.total} ขั้น{t.contacts ? ` · ติดต่อ ${t.contacts} ครั้ง` : ''}</span>
          {!ro && actAt !== '' && <button type="button" className="btn xs" data-act-at="" onClick={() => setActAt('')}>บันทึกการติดต่อ</button>}
        </span>
      </div>
      {actAt === '' && <ActForm d={d} onDone={actDone} />}
      <ol className="sl-tl">
        {views.map((v, i) => {
          if (futs.length >= 2 && emptyFuture(v)) {
            if (futDone) return null;
            futDone = true;
            return (
              <li key="fut" className="sl-tl-i fut">
                <Bead state="future" />
                <div className="sl-tl-c">
                  <div className="sl-tl-h"><b>ยังไม่ถึง {futs.length} ขั้น</b><span>{futs.map((f) => f.code).join(' · ')}</span></div>
                </div>
              </li>
            );
          }
          const st = v.state, s = v.own, pl = v.line;
          const isNow = v.id === next;
          const card = isCard(v);
          const docs = v.docs.filter((x) => !stray.includes(x));
          const doc = docs.find((z) => z.amount != null);
          // QUOTATION: its quotation versions are one card (QtCard); other documents there stay cards of their own
          const qts = v.kind === 'quote' ? docs.filter(isQtVersion) : [];
          const off = st === 'off' || !!v.outside;
          const on = i < reached, dash = on && views[i + 1] && beadOf(views[i + 1]) === 'planned';
          const fut = (st === 'future' || off) && !isNow && !card && !(pl && won);
          let date: ReactNode =
            v.outside === 'plan' ? <span className="sl-tl-d">นอกแผนชำระ</span>
            : st === 'off' ? <span className="sl-tl-d">{jm || v.outside === 'joint' ? JOINT_PAID : 'ไม่ต้องทำ'}</span>
            : v.kind === 'pay' && pl ? (s.d ? <span className="sl-tl-d">{s.d > today ? 'นัด ' : ''}{isoTh(s.d)}</span> : null)
            : v.ahead ? <span className="sl-tl-d">{v.date ? isoTh(v.date) + ' · ' : ''}นัด {isoTh(v.ahead)}</span>
            : v.date ? <span className="sl-tl-d">{st === 'planned' ? 'นัด ' : ''}{isoTh(v.date)}</span>
            : st === 'skipped' ? <span className="sl-tl-d">ข้าม</span>
            : v.kind === 'pay' && !won && !P ? <span className="sl-tl-d">หลังได้งาน</span>
            : null;
          if (pl && won) date = pl.status === 'paid' ? <span className="sl-tl-d">รับ {isoTh(pl.rcvDate)}</span> : pl.due ? <span className={'sl-tl-d' + (pl.lateDays ? ' bad' : '')}>ครบกำหนด {isoTh(pl.due)}{pl.lateDays ? ` · เลยมา ${pl.lateDays} วัน` : ''}</span> : null;
          const planLine = pl && pl.status !== 'paid' && (
            <p className="sl-tl-plan">
              แผน {pl.line.amt != null ? fmtMoney(pl.amt) + ' บาท' : 'ยังไม่ใส่ยอด'}{lineMeta(pl.line) ? ' · ' + lineMeta(pl.line) : ''}{!won && pl.line.rel != null && !pl.line.due ? ' · ' + relText(pl.line) : ''}
            </p>
          );
          // what the step's line shows (stepEdit): its own record, an older stage's in place, or one more contact
          const se = stepEdit(v);
          const edit = ro || card || (se.act && actAt === v.id) ? null : (
            <button type="button" className="lnk sl-tl-e" data-act-at={se.act ? v.id : undefined} onClick={() => (se.act ? setActAt(v.id) : setPick(se.stage))} aria-label={se.act ? `บันทึกการติดต่อเพิ่มที่ ${v.code}` : se.old ? `แก้ไขบันทึกเดิม ${se.stage} ในขั้น ${v.code}` : `แก้ไข ${v.code} ${thShort(v.th)}`}>
              {se.label}
            </button>
          );
          let body: ReactNode;
          if (card) {
            body = (
              <>
                <StepEdit key={cardStage} d={d} p={cardStage} v={v} won={won} doc={!!doc} qt={qts.length && cardStage === v.id ? qtView(S, d).head?.doc : undefined} attach={attach} onHold={() => setPick((x) => x || cardStage)} onDone={() => setPick('')} />
                {entriesOf(v, off)}
              </>
            );
          } else {
            // a note a document or "รับเงินแล้ว" wrote, or the joint quotation's on its company: not repeated
            const showNote = !!s.n && !docs.some((z) => z.auto?.n === s.n) && !(pl && s.n === paidNote(pl.line)) && !(jm && v.kind === 'quote' && isJointNote(s.n));
            body = (
              <>
                {v.kind === 'close' && (st === 'yes' || st === 'no' || st === 'wait') ? (
                  ro ? <Status kind={st === 'yes' ? 'ok' : st === 'no' ? 'bad' : 'warn'}>{st === 'yes' ? 'ได้งาน (YES)' : st === 'no' ? 'ไม่ได้งาน (NO)' : 'รอผล · ' + s.n}</Status> : <ResultBig d={d} st={st} />
                ) : showNote ? (
                  <p className="sl-tl-n">{s.n}</p>
                ) : isNow && ro && !v.entries.length ? (
                  <p className="sl-tl-n t-muted">ยังไม่ได้บันทึก</p>
                ) : null}
                {planLine}
                {v.kind === 'pay' && v.state === 'future' && !won && !P && t.result !== 'NO' && v.counted && (
                  <p className="sl-tl-plan">ตั้งแผนกี่งวด ขั้น PAY จะขึ้นตามจำนวนงวด</p>
                )}
                {money && v.short != null && (
                  <p className="sl-tl-plan">{m.actual == null ? `ยังไม่มียอดที่รับ (Actual) · ค้างรับ ${fmtMoney(v.short)} บาท จาก Forecast` : `ยังค้างรับ ${fmtMoney(v.short)} บาท · Actual ${fmtMoney(m.actual)} จาก Forecast ${fmtMoney(m.forecast)}`}</p>
                )}
                {v.outside === 'plan' && (
                  <p className="sl-tl-plan">
                    แผนตอนนี้มี {P ? P.n : 0} งวด ข้อมูลที่บันทึกไว้ที่ {v.id} ยังอยู่ครบ แต่ไม่นับเป็นขั้น
                    {canPlan && <> · ใส่กลับเป็นงวดได้ที่ <button type="button" className="lnk" onClick={() => set({ dpPlan: 'edit' })}>แก้ไขแผน</button></>}
                  </p>
                )}
                {jm && <MemberStage d={d} stage={v.id} pay={false} />}
                {qts.length > 0 && <QtCard d={d} onRevise={(id) => attach({ at: 'quote', revise: id })} />}
                {docs.filter((z) => !qts.includes(z)).map((z) => <DocCard key={z.id} d={d} doc={z} inUse={z.target === 'forecast' ? m.fcDoc?.id === z.id : z.target === 'actual' && z.amount != null} />)}
                {!ro && !jm && !doc && !qts.length && !off && !(pl && won) && ((v.kind === 'quote' && st === 'done') || (v.kind === 'pay' && won && !P)) && (
                  <button type="button" className="btn xs sl-tl-att" onClick={() => attach(v.kind === 'quote' ? { at: 'quote' } : { at: 'pay', stage: v.id })}>แนบ{v.kind === 'quote' ? 'ใบเสนอราคา' : 'ใบเสร็จ'}</button>
                )}
                {entriesOf(v, off)}
              </>
            );
          }
          return (
            <li key={v.id} className={'sl-tl-i' + (on ? (dash ? ' dash' : ' on') : '') + (card ? ' cur-step' : '') + (fut ? ' fut' : '')}>
              <Bead state={beadOf(v)} now={isNow} late={(pl?.lateDays || 0) > 0 || late} stage={v.id} />
              <div className="sl-tl-c">
                <div className="sl-tl-h">
                  <b>{v.code}</b>
                  <span>
                    {v.th}
                    {card && cardStage !== v.id ? <em> · แก้บันทึกเดิม {cardStage}</em> : isNow && <em> · ขั้นถัดไป</em>}
                  </span>
                  {date}
                  {edit}
                </div>
                {body}
              </div>
            </li>
          );
        })}
        {t.other.acts.length > 0 && (
          <li className="sl-tl-i">
            <Bead state="off" />
            <div className="sl-tl-c">
              <div className="sl-tl-h"><b>การติดต่ออื่น</b><span>ขั้นที่บันทึกไว้ไม่อยู่ในขั้นตอนแล้ว</span></div>
              <ActList acts={t.other.acts} stage label="การติดต่ออื่น" />
            </div>
          </li>
        )}
        <li className="sl-tl-i sl-tl-end">
          <span className={'sl-flagb' + (cv.ready ? ' ready' : '')} aria-hidden="true" />
          <div className="sl-tl-c">
            <div className={'sl-closing' + (cv.ready ? ' ready' : '')} role={asking ? 'status' : undefined}>
              <b>{asking ? (t.result === 'NO' ? 'ผลการขายเป็น NO แล้ว ปิดงานเลยไหม?' : 'รับชำระครบทุกงวดแล้ว ปิดงานเลยไหม?') : CLOSE_TITLE}</b>
              <p>{d.jobStatus === 'closed' ? `ปิดงานแล้ว${d.closedDate ? ' ' + isoTh(d.closedDate) : ''} งานอยู่ในแท็บ “ปิดงาน”${ro ? '' : ' เปิดกลับได้ที่ปุ่มด้านบน'}` : cv.text}</p>
              {cv.ready && !ro && d.jobStatus === 'open' && (
                <span className="sl-closing-acts">
                  <button type="button" className="btn pri" onClick={() => acts.close(d.id)}>ปิดงาน</button>
                  {asking && <button type="button" className="quiet" onClick={() => set({ slPrompt: null, slToast: null })}>ไว้ก่อน</button>}
                </span>
              )}
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}

/** ได้งาน (YES) / ไม่ได้งาน (NO) / รอผล, and why it is not ปิดงาน. */
function ResultBig({ d, st, date, onPick }: { d: Deal; st: StageState; date?: string; onPick?: () => void }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const pick = (r: 'YES' | 'NO' | 'WAIT') => {
    const today = todayISO(), cur = stepOf(e.sales, d.id, DEAL_STAGE);
    if (dealResult(e.sales, d) === r) return;
    const v = { d: date || cur.d || today, n: r === 'WAIT' ? (cur.n.trim() && !/^(yes|no)$/i.test(cur.n.trim()) ? cur.n : 'รอผล') : r };
    // money received stops counting once the result is not YES: asked when accounting checked it
    askPay(e, { d, after: previewOf.step(e.sales, d.id, DEAL_STAGE, v), kind: 'edit', title: 'ผลการขาย ' + (r === 'WAIT' ? 'รอผล' : r), verb: 'บันทึกผล', run: () => {
      const was = closeReady(e.sales, d, today);
      e.setStep(d.id, DEAL_STAGE, v);
      onPick?.();
      if (r === 'WAIT') acts.say(`บันทึกผลการขายของ ${shortName(d.client)} เป็น รอผล แล้ว`);
      else acts.afterResult(d, was);
    } });
  };
  return (
    <>
      <span className="sl-yn lg" role="group" aria-label="ผลการขาย">
        <button type="button" className="yes" aria-pressed={st === 'yes'} onClick={() => pick('YES')}>ได้งาน (YES)</button>
        <button type="button" className="no" aria-pressed={st === 'no'} onClick={() => pick('NO')}>ไม่ได้งาน (NO)</button>
        <button type="button" className="wait" aria-pressed={st === 'wait'} onClick={() => pick('WAIT')}>รอผล</button>
      </span>
      <span className="sl-capt">ผลการขายบอกแค่ว่าได้งานหรือไม่ ยังไม่ใช่การปิดงาน งานยังอยู่ในตารางจนกว่าจะกดปิดงาน</span>
    </>
  );
}

/** The step being recorded: its date, its note and, on QUOTATION / a PAY after the win, the place to drop the
 *  document (on QUOTATION with a quotation `qt` already, a revised one). `p` is the stored stage it writes: the
 *  step's own (`v.id`), or an older stage's record read into it (CALL2: "แก้บันทึกเดิม", edited where it is, as a
 *  browser still on the older build would). What was typed is saved also when the panel closes (as the panel's
 *  fields always did). */
function StepEdit({ d, p, v, won, doc, qt, attach, onHold, onDone }: { d: Deal; p: string; v: StepView; won: boolean; doc: boolean; qt?: DealDoc; attach: Attach; onHold: () => void; onDone: () => void }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const today = todayISO();
  const S = e.sales;
  const own = p === v.id, line = own ? v.line : null, st = v.state;
  // "บันทึก CONTACT", "บันทึก PAY", "บันทึก CALL2" (an older stage's record)
  const code = own ? v.code : p;
  // what the fields show for a stage: its note (a YES / NO is the result's buttons), its date (else today; a
  // date booked ahead, a call planned: today, as the day it happened)
  const fields: StepFields = (s) => ({ note: p === DEAL_STAGE && /^(yes|no)$/i.test(s.n.trim()) ? '' : s.n, date: line || !s.d || s.d > today ? today : s.d });
  // the stage as the card opened it (a change by someone else meanwhile is asked about on saving; one
  // while nothing was typed, such as the QUOTATION note a revision rewrites, is followed: lib/stepEditor)
  const [ed, setEd] = useState<StepEd>(() => {
    const s = stepOf(S, d.id, p);
    return { init: s, ...fields(s) };
  });
  const { init, note, date } = ed;
  const planned = !line && init.d > today;
  const setNote = (x: string) => setEd((y) => ({ ...y, note: x }));
  const setDate = (x: string) => setEd((y) => ({ ...y, date: x }));
  const follow = (mine = false) => setEd((x) => followStep(x, stepOf(e.sales, d.id, p), fields, mine));
  const live = stepOf(S, d.id, p);
  useEffect(() => follow(), [live.d, live.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [over, setOver] = useState(false);
  const at = useAttach();
  // "รับเงินแล้ว (ไม่มีไฟล์)" with no plan and no Forecast: the amount is asked for here (two taps)
  const [recvAsk, setRecvAsk] = useState<string | null>(null);
  const dirty = stepTyped(ed, fields);
  // saved (or cleared) already: leaving the card writes nothing more
  const done = useRef(false);
  const save = (quiet = false) => {
    const now = stepOf(e.sales, d.id, p);
    if (stepMoved(init, now) && !window.confirm(`มีคนแก้ขั้นนี้ระหว่างที่เปิดอยู่:\n"${now.n || '(ว่าง)'}"\n\nบันทึกของคุณทับหรือไม่?`)) return;
    done.current = true;
    const val = { d: date, n: p === DEAL_STAGE && !note.trim() && /^(yes|no)$/i.test(init.n.trim()) ? init.n : note };
    // a PAY step's date is the received date of its documents: a checked line is asked about first
    askPay(e, { d, after: previewOf.step(e.sales, d.id, p, val), kind: 'edit', title: `บันทึก ${code}`, verb: 'บันทึก', run: () => {
      const was = closeReady(e.sales, d, today);
      e.setStep(d.id, p, val);
      if (quiet) return;
      const r = dealResult(e.sales, d);
      if (p === DEAL_STAGE && (r === 'YES' || r === 'NO')) acts.afterResult(d, was);
      else acts.after(d, was, 'payment', `บันทึก ${code} ของ ${shortName(d.client)} แล้ว · ${dmTh(date)}`);
      onDone();
    } });
  };
  // closing the panel (×, Escape, the backdrop) keeps what was typed
  const latest = useRef({ dirty, save, follow });
  latest.current = { dirty, save, follow };
  useEffect(() => () => {
    if (latest.current.dirty && !done.current) latest.current.save(true);
  }, []);
  const isMoney = own && (v.kind === 'quote' || v.kind === 'pay' || !!line);
  // a joint quotation's member: its quotation and payments are the joint quotation's (nothing to attach here)
  const drop = isMoney && (v.kind === 'quote' || won) && (!doc || !!qt) && jointRole(S, d) !== 'member';
  // a file attached from here: the card's work is done, it closes (the step shows the document and the
  // note it wrote); with something typed it stays open, and saving that does not ask about the document's note
  const attached = () => (latest.current.dirty ? latest.current.follow(true) : onDone());
  // the card says what the document is: the quotation (a revised one when there is one: it follows that
  // version, which stays as "ฉบับเดิม"), else the receipt / invoice of this installment
  const entry: AttachEntry = v.kind === 'quote' ? { at: 'quote', ...(qt ? { revise: qt.id } : {}), onSaved: attached } : { at: 'pay', stage: p, onSaved: attached };
  const P = planOf(S, d, today);
  // one tap: with a plan the installment not received yet (part received by hand: its form opens, as one
  // installment keeps one hand receipt and its date); without one, a won deal's PAY step (the single PAY, or
  // the rest of the payment "PAY ส่วนที่เหลือ": recvPlan sets a plan of one installment for what is left)
  const canRecv = own && v.kind === 'pay' && won && (line ? line.status !== 'paid' && line.status !== 'off' && (!!recvPlan(S, d, p, today) || line.handGot > 0) : !P && !v.outside && v.state !== 'done');
  const recv = (typed?: number | null) => {
    const r = at.recv(d, p, typed, { inline: true });
    if (r === 'ask') setRecvAsk('');
    else if (r === 'done') setRecvAsk(null);
  };
  const askN = recvAsk != null ? parseAmount(recvAsk) : null;
  const fc = dealMoney(S, d).forecast;
  return (
    <>
      {p === DEAL_STAGE && <ResultBig d={d} st={st} date={date} onPick={() => ((done.current = true), follow(true))} />}
      {line && line.status !== 'paid' && (
        <p className="sl-tl-plan">แผน {line.line.amt != null ? fmtMoney(line.amt) + ' บาท' : 'ยังไม่ใส่ยอด'}{lineMeta(line.line) ? ' · ' + lineMeta(line.line) : ''}</p>
      )}
      {own && v.short != null && e.can('view.money') && (
        <p className="sl-tl-plan">
          {dealMoney(S, d).actual == null
            ? `ยังไม่มียอดที่รับ (Actual) · ค้างรับ ${fmtMoney(v.short)} บาท · แนบใบเสร็จ หรือใส่ยอด Actual ที่แถบด้านบนถ้ารับครบแล้ว`
            : `ยังค้างรับ ${fmtMoney(v.short)} บาท · แนบใบเสร็จของส่วนที่เหลือ หรือพิมพ์โน้ตถ้าตกลงลดยอดแล้ว`}
        </p>
      )}
      {!own && <p className="sl-tl-plan">บันทึกเดิมที่ {p}{OLD_TH[p] ? ' ' + OLD_TH[p] : ''} · แก้ที่เดิม ยังอยู่ในขั้น {v.code}</p>}
      <div className="sl-fgrid" onFocus={onHold}>
        <span style={labelCol}>
          วันที่{planned && init.d ? ` (นัดไว้ ${dmTh(init.d)})` : ''}
          <DateChip value={date} onChange={(x) => ((done.current = false), setDate(x))} label={'วันที่ ' + code} text={date === today ? 'วันนี้ ' + isoTh(date) : undefined} />
        </span>
        <label style={labelCol}>
          โน้ต
          <input
            className="fld"
            value={note}
            maxLength={NOTE_MAX}
            placeholder={v.kind === 'quote' ? 'เช่น ส่งใบเสนอราคาทางอีเมลแล้ว' : p === DEAL_STAGE ? 'หมายเหตุ เช่น รอผู้บริหารอนุมัติ' : 'สิ่งที่คุยกัน / สิ่งที่ต้องทำต่อ'}
            onChange={(ev) => ((done.current = false), setNote(ev.target.value))}
            onKeyDown={(ev) => ev.key === 'Enter' && (ev.preventDefault(), save())}
          />
        </label>
      </div>
      {drop && (
        <div
          className={'sl-drop' + (over ? ' over' : '')}
          onDragOver={(ev) => (ev.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(ev) => {
            ev.preventDefault();
            setOver(false);
            ev.stopPropagation(); // (not the panel's own drop as well)
            const f = ev.dataTransfer.files?.[0];
            if (f) attach(entry, f);
          }}
        >
          <span className="sl-drop-t">
            <span>{v.kind === 'quote' ? (qt ? `แนบฉบับแก้ไข${qt.docNo ? 'ของ ' + qt.docNo : ''}` : 'แนบใบเสนอราคา') : `แนบใบเสร็จ / ใบแจ้งหนี้${P && P.n > 1 ? ' ของ ' + code : ''}`}</span>
            <small>
              <span className="oa-wide">ลากไฟล์มาวาง หรือกดเลือกไฟล์</span>
              <span className="oa-narrow">ถ่ายรูปหรือเลือกไฟล์</span>
              {' · '}
              {v.kind !== 'quote' ? 'นับเงินที่เข้าบัญชีจริง (หลังหัก ณ ที่จ่าย)' : qt && fc != null ? `ยอดใหม่จะแทน Forecast ${fmtMoney(fc)}` : 'ยอดในใบนี้เป็น Forecast ของงาน'}
            </small>
          </span>
          <span className="sl-drop-b">
            {canRecv && recvAsk == null && <button type="button" className="btn xs" onClick={() => recv()}>รับเงินแล้ว (ไม่มีไฟล์)</button>}
            <button type="button" className="btn xs sl-drop-pick" onClick={() => attach(entry)}>
              <span className="oa-wide">เลือกไฟล์</span>
              <span className="oa-narrow">{p === QUOTE_STAGE ? 'เลือกไฟล์' : 'ถ่ายรูป / เลือกไฟล์'}</span>
            </button>
          </span>
          {recvAsk != null && (
            <span className="sl-drop-ask">
              <label style={labelCol}>
                ยอดที่รับ (บาท)
                <input className="fld num" autoFocus inputMode="decimal" value={recvAsk} placeholder="เช่น 53,500" onChange={(ev) => setRecvAsk(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && recv(parseAmount(recvAsk))} />
              </label>
              <button type="button" className="quiet" onClick={() => setRecvAsk(null)}>ยกเลิก</button>
              {/* (named for what it saves: the card's own "บันทึก" below saves the date and note) */}
              <button type="button" className="btn pri xs" disabled={!(askN ?? 0)} onClick={() => recv(askN)}>{askN ? `บันทึกรับเงิน ${fmtMoney(askN)} บาท` : 'บันทึกรับเงิน'}</button>
            </span>
          )}
        </div>
      )}
      <div className="sl-tl-acts">
        {!own && <button type="button" className="quiet" onClick={() => ((done.current = true), onDone())}>ยกเลิก</button>}
        {(init.d || init.n) && (
          <button type="button" className="quiet" onClick={() => askPay(e, { d, after: previewOf.step(e.sales, d.id, p, { d: '', n: '' }), kind: 'edit', title: 'ล้าง ' + code, verb: own ? 'ล้างขั้นนี้' : 'ลบบันทึกเดิม', plain: own ? `ล้าง ${code}? วันที่และโน้ตของขั้นนี้จะหายไป` : `ลบบันทึกเดิม ${p}? วันที่และโน้ตนี้จะหายไป`, run: () => ((done.current = true), e.setStep(d.id, p, { d: '', n: '' }), onDone()) })}>{own ? 'ล้างขั้นนี้' : 'ลบบันทึกเดิม'}</button>
        )}
        {/* (quiet while the amount received is asked for above: one primary at a time) */}
        <button type="button" className={recvAsk != null ? 'btn xs' : 'btn pri xs'} onClick={() => save()}>บันทึก</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ แผนการชำระเงิน

function PlanCard({ d, attach }: { d: Deal; attach: Attach }) {
  const { engine: e, ui } = useApp();
  if (ui.dpPlan === 'edit' && e.canDeal('edit.pay', d)) return <PlanEditor d={d} attach={attach} />;
  return <PlanRead d={d} recv={ui.dpPlan.startsWith('recv:') ? ui.dpPlan.slice(5) : ''} attach={attach} />;
}

/** The plan as agreed, against what came in: one light table, a line per installment. */
function PlanRead({ d, recv, attach }: { d: Deal; recv: string; attach: Attach }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const at = useAttach();
  // the month check: each received line's check, and the question before a checked one changes
  const chk = useDealChecks(d);
  const guard = usePayGuard();
  const S = e.sales, today = todayISO();
  const ro = !e.canDeal('edit.pay', d);
  const P = planOf(S, d, today), won = dealResult(S, d) === 'YES';
  const edit = () => set({ dpPlan: 'edit' });
  if (!P)
    return (
      <section className="dp-card sl-plan" aria-labelledby="dp-plan">
        <div className="sl-pc-h"><h3 id="dp-plan">แผนการชำระเงิน</h3></div>
        {ro ? (
          <span className="empty">ยังไม่มีแผนการชำระเงิน</span>
        ) : (
          <div className="sl-pc-empty">
            <span>{won ? 'ยังไม่มีแผน ตั้งแผนเพื่อติดตามว่าแต่ละงวดต้องรับเท่าไร เมื่อไร' : 'ยังไม่มี พิมพ์ไว้ก่อนได้ เช่น ลูกค้าขอแบ่งจ่าย 2 งวด'}</span>
            <button type="button" className="btn xs" onClick={edit}>ตั้งแผนชำระ</button>
          </div>
        )}
        <PayNoPlan d={d} />
      </section>
    );
  const pct = P.total ? Math.min(100, Math.round((P.got / P.total) * 100)) : 0;
  const over = P.lines.reduce((a, l) => a + overPlan(l), 0);
  // a Forecast that changed after the plan was typed as shares: offer to re-split what is not received yet
  const open = P.lines.filter((l) => l.got <= 0);
  const canResplit = !ro && P.base != null && !!P.diff && open.length > 0 && open.every((l) => l.line.pct != null);
  const resplit = () => {
    const rec = P.lines.filter((l) => l.got > 0).reduce((a, l) => a + l.got, 0);
    const amts = splitAmounts(Math.max(0, (P.base || 0) - rec), open.map((l) => l.line.pct || 0));
    e.setPlan(d.id, P.lines.map((l) => ({ stage: l.stage, amt: l.got > 0 ? l.line.amt : amts[open.indexOf(l)], pct: l.line.pct, due: l.line.due, rel: l.line.rel, how: l.line.how, howT: l.line.howT, note: l.line.note })));
    acts.say('ปรับยอดงวดที่ยังไม่ได้รับตาม % แล้ว');
  };
  return (
    <section className="dp-card sl-plan" aria-labelledby="dp-plan">
      <div className="sl-pc-h">
        <h3 id="dp-plan">แผนการชำระเงิน</h3>
        {!ro && <button type="button" className="lnk" onClick={edit}>แก้ไขแผน</button>}
        <span className="sl-pc-s">{P.n} งวด · รวม {fmtMoney(P.total)} บาท · <span className={P.diff ? 't-warn' : ''}>{diffText(P)}</span></span>
      </div>
      {won ? (
        <div className="sl-pc-p">
          <span className="sl-pb" role="img" aria-label={`รับแล้ว ${pct}% ของแผน`}><i style={{ width: pct + '%' }} /></span>
          <span>
            รับแล้ว <b>{fmtMoney(P.got) || '0'}</b> · {P.left ? <>ค้าง <b>{fmtMoney(P.left)}</b></> : <span className="t-ok">รับครบทุกงวด</span>}
            {over > 0 && <> · <span className="t-warn">รับเกินแผน {fmtMoney(over)}</span></>}
            {P.late.length > 0 && <> · <span className="t-bad">เลยกำหนด {P.late.length} งวด</span></>}
            {planCheckWords(chk) && <span className="mc-pc-n">{planCheckWords(chk)}</span>}
          </span>
        </div>
      ) : (
        <p className="sl-pc-note">แผนที่พิมพ์ไว้ก่อนได้งาน วันครบกำหนดแบบ “หลังได้งาน” จะเป็นวันที่จริงเมื่อบันทึก YES ที่ CLOSE</p>
      )}
      {won && <PlanYears S={S} d={d} today={today} />}
      {canResplit && <p className="sl-pc-x">Forecast ตอนนี้ {fmtMoney(P.base)} บาท · <button type="button" className="lnk" onClick={resplit}>ปรับยอดงวดที่ยังไม่ได้รับตาม %</button></p>}
      <div className="sl-pt" role="table" aria-label="งวดการชำระ">
        <div className="sl-pr ph" role="row">
          <span role="columnheader">งวด</span><span role="columnheader" className="r">ยอด (บาท)</span><span role="columnheader">ครบกำหนด</span><span role="columnheader">วิธีชำระ</span><span role="columnheader">สถานะ</span>
        </div>
        {P.lines.map((l) => {
          const sv = lineStatusView(l, today), lf = lineFig(l);
          const hand = l.status === 'paid' && l.hand;
          // received on an invoice only (it counts as money in): its receipt replaces it, as accounting asks
          const invOnly = l.status === 'paid' && !hand && invoiceOnly(S, d.id, l.stage);
          // every installment takes its receipt (or invoice) with one button: whether it replaces what is counted
          // there or is the rest of it, the dialog says in one sentence (lib/attachPlan)
          const att = <button type="button" className="lnk" onClick={() => attach({ at: 'pay', stage: l.stage })}>แนบใบเสร็จ</button>;
          const editRecv = <button type="button" className="lnk" onClick={() => set({ dpPlan: `recv:${l.stage}` })}>แก้ยอด / วันที่</button>;
          const unmark = <button type="button" className="quiet" onClick={() => guard.ask({ d, lines: [l.stage], kind: 'cancel', title: 'ยกเลิกการรับเงิน ' + l.code, verb: 'ยกเลิกการรับ', plain: `ยกเลิกการรับ ${l.code}? (${fmtMoney(l.handGot)} บาท ที่บันทึกเอง)`, run: () => e.unmarkPaid(d.id, l.stage) })}>ยกเลิกการรับ</button>;
          const row = chk.find((r) => r.kind === 'got' && r.lineId === l.stage);
          const lineActs = ro || !won || recv === l.stage ? null : l.status === 'part' ? (
            <>
              <button type="button" className="btn xs" onClick={() => (e.setPayFull(d.id, l.stage, true) ? acts.prompt(d, 'payment') : acts.say(`ถือว่ารับครบ ${l.code} แล้ว`))}>ถือว่ารับครบ</button>
              {att}
              {/* (the rest came in by hand: the amount received, with its date, in the form) */}
              {l.hand && editRecv}
              {l.hand && unmark}
            </>
          ) : l.status !== 'paid' && l.status !== 'off' ? (
            <>
              {/* one tap: recorded at once, with "แก้ยอด / วันที่" and "เลิกทำ" in the message */}
              <button type="button" className="btn xs" onClick={() => at.recv(d, l.stage)}>รับเงินแล้ว</button>
              {att}
            </>
          ) : hand ? (
            <>
              {att}
              {editRecv}
              {unmark}
            </>
          ) : invOnly ? (
            att
          ) : l.status === 'paid' && l.full && l.got < l.amt ? (
            <button type="button" className="quiet" onClick={() => e.setPayFull(d.id, l.stage, false)}>ยกเลิกถือว่าครบ</button>
          ) : null;
          const note = l.line.note;
          return (
            <div key={l.stage} className={'sl-pr s-' + l.status} role="row">
              <span className="c-st" role="cell"><b>{l.code}</b></span>
              <span className="c-amt r" role="cell">
                {l.line.amt != null ? fmtMoney(l.amt) : '—'}
                {l.line.pct != null && <small>{l.line.pct}%</small>}
              </span>
              <span className="c-due" role="cell">
                {l.due ? isoTh(l.due) : l.line.due ? isoTh(l.line.due) : relText(l.line) || 'ยังไม่กำหนด'}
                <YearChip d={d} date={l.status === 'paid' ? l.rcvDate : l.due || l.line.due} />
              </span>
              <span className="c-how" role="cell">{HOW_TH[l.line.how]}{l.line.howT ? ' ' + l.line.howT : ''}</span>
              <span className="c-stat" role="cell">
                {sv.kind === 'muted' ? <span className="sl-st-m">{sv.word}</span> : sv.chip ? <span className={'chip ' + sv.kind}>{sv.word}</span> : <Status kind={sv.kind}>{sv.word}</Status>}
                {sv.sub && <small>{sv.sub}</small>}
                {lf.kind === 'warn' && <small className="t-warn" title={lf.title}>ไม่ตรงเอกสาร</small>}
                <PayChip r={row} />
              </span>
              {(note || lineActs) && (
                <span className="c-note" role="cell">
                  <span>{note}</span>
                  {lineActs && <span className="sl-pk-b">{lineActs}</span>}
                </span>
              )}
              <PayNote r={row} />
              {recv === l.stage && !ro && <RecvForm d={d} l={l} attach={attach} />}
            </div>
          );
        })}
      </div>
      <div className="sl-pc-f">
        {!ro && <button type="button" className="lnk" onClick={edit}>เพิ่มงวด</button>}
        <span>แต่ละงวดเป็นขั้นชำระเงินของตัวเองในขั้นตอนการติดตาม</span>
      </div>
    </section>
  );
}

/** "รับเงินแล้ว" without a document: the date, the amount (the planned one by default), how; a short
 *  amount is counted complete (pre-chosen when it matches withholding tax) or stays owed. */
function RecvForm({ d, l, attach }: { d: Deal; l: LineView; attach: Attach }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const today = todayISO();
  // "แก้ยอด / วันที่" of money recorded by hand: as it was recorded
  const byHand = !!l.line.rcv && l.hand;
  const [date, setDate] = useState(byHand ? l.line.rcv : today);
  const [amt, setAmt] = useState(fmtMoney(byHand ? l.line.got ?? l.amt : l.amt || null));
  const [how, setHow] = useState<PayHow>(l.line.how || 'transfer');
  const got = parseAmount(amt);
  const short = got != null && got > 0 && l.amt > 0 ? l.amt - got : 0;
  const wht = short > 0 ? whtRate(l.amt, got!) : null;
  const [full, setFull] = useState<boolean | null>(null);
  const fullOn = short > 0 && (full ?? wht != null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLInputElement>('input.num')?.focus();
  }, []);
  const ok = got !== undefined && (got == null ? l.amt > 0 : got > 0);
  // "มีใบเสร็จ?": the money typed here is saved first, then its receipt is picked; the dialog finds it is the
  // receipt of that money (lib/attachPlan R5c: in its place, nothing counts twice)
  const save = (thenAttach = false) => {
    if (!ok) return;
    // a part-paid line accounting checked, or money landing in a closed month: asked first
    askPay(e, { d, after: previewOf.pay(e.sales, d.id, l.stage, { rcv: date || today, got: got ?? null, full: fullOn }), kind: 'edit', title: 'บันทึกรับเงิน ' + l.code, verb: 'บันทึกรับเงิน', run: () => {
      const ready = e.markPaid(d.id, l.stage, { date, amount: got ?? null, how, full: fullOn });
      set({ dpPlan: '' });
      // (the receipt of the money just typed: it counts in that money's place, lib/attachPlan R5c)
      if (thenAttach) return attach({ at: 'pay', stage: l.stage, ofHand: true });
      if (ready) acts.prompt(d, 'payment');
      else acts.say(`บันทึกรับเงิน ${l.code} ${fmtMoney(got ?? l.amt)} บาทแล้ว`);
    } });
  };
  return (
    <div className="sl-rf" role="group" aria-label={'บันทึกรับเงิน ' + l.code} ref={box} onKeyDown={(ev) => ev.key === 'Escape' && (ev.stopPropagation(), set({ dpPlan: '' }))}>
      <div className="sl-rf-h"><b>บันทึกรับเงิน {l.code}</b><span>แผน {fmtMoney(l.amt)} บาท{l.due ? ' · ครบกำหนด ' + isoTh(l.due) : ''}</span></div>
      <div className="sl-rf-g">
        <span style={labelCol}>วันที่รับ<DateChip value={date} onChange={setDate} label="วันที่รับ" /></span>
        <label style={labelCol}>ยอดที่รับ (บาท)<input className="fld num" value={amt} inputMode="decimal" onChange={(ev) => setAmt(ev.target.value)} aria-invalid={!ok} /></label>
        <SelField style={labelCol} text="วิธีชำระ" value={how} onChange={(v) => setHow(v as PayHow)} options={HOWS.map((k) => ({ v: k, label: HOW_TH[k] }))} />
      </div>
      {got === undefined && <span className="t-bad" role="alert" style={{ fontSize: 12 }}>อ่านยอดไม่ได้ พิมพ์ตัวเลขเดียว เช่น 53,500</span>}
      {short > 0 && (
        <div className="sl-rf-short">
          <p>รับน้อยกว่าแผน {fmtMoney(short)} บาท{wht ? ` · เท่ากับหัก ณ ที่จ่าย ${wht}% ของ ${fmtMoney(Math.round(l.amt / 1.07))} (ก่อน VAT)` : ''}</p>
          <label className="hv-tx"><input type="radio" name={'rs-' + l.stage} checked={fullOn} onChange={() => setFull(true)} /> ถือว่ารับครบงวดนี้</label>
          <label className="hv-tx"><input type="radio" name={'rs-' + l.stage} checked={!fullOn} onChange={() => setFull(false)} /> ยังค้าง {fmtMoney(short)} บาท</label>
        </div>
      )}
      <div className="sl-rf-a">
        <span className="sl-rf-tip">
          มีใบเสร็จ? <button type="button" className="lnk" disabled={!ok} onClick={() => save(true)}>บันทึกแล้วแนบใบเสร็จ</button>
        </span>
        <button type="button" className="quiet" onClick={() => set({ dpPlan: '' })}>ยกเลิก</button>
        <button type="button" className="btn pri" disabled={!ok} onClick={() => save()}>บันทึกรับเงิน</button>
      </div>
    </div>
  );
}

type Row = { stage: string; amt: string; pct: string; due: string; rel: number | null; date: boolean; how: PayHow; howT: string; note: string; got: number };
const REL = [0, 15, 30, 45, 60, 90];
const PRESETS: Record<number, number[][]> = { 2: [[50, 50], [30, 70], [40, 60]], 3: [[40, 30, 30], [30, 40, 30], [34, 33, 33]] };

/** Typing the plan ("ตั้งแผนชำระ" / "แก้ไขแผน"): a quick box that fills the lines (how many, how split,
 *  from what total, when due), then the lines one by one. Received lines stay as they are. */
function PlanEditor({ d, attach }: { d: Deal; attach: Attach }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const guard = usePayGuard();
  const S = e.sales, cfg = S.cfg, today = todayISO();
  const m = dealMoney(S, d);
  const P = planOf(S, d, today);
  const won = wonDate(S, d);
  const [typedTotal, setTypedTotal] = useState<string | null>(m.forecast == null ? '' : null);
  const total = typedTotal != null ? parseAmount(typedTotal) ?? null : m.forecast;
  // the first plan: PAY stages paid already (by their documents, or the old way by a note and the typed
  // Actual) are received lines; new ones take the other stages
  const [start] = useState(() => planStart(S, d, today));
  const [rows, setRows] = useState<Row[]>(() => {
    const L = planLines(S, d);
    if (L) {
      const got = new Map((P?.lines || []).map((l) => [l.stage, l.got]));
      return L.map((x) => ({ stage: x.stage, amt: x.line.amt != null ? fmtMoney(x.line.amt) : '', pct: x.line.pct != null ? String(x.line.pct) : '', due: x.line.due, rel: x.line.rel, date: !!x.line.due, how: x.line.how, howT: x.line.howT, note: x.line.note, got: got.get(x.stage) || 0 }));
    }
    const kept = start.lines.flatMap((x) => (x.amt != null ? [{ stage: x.stage, amt: fmtMoney(x.amt), pct: '', due: '', rel: null, date: false, how: '' as PayHow, howT: '', note: '', got: x.amt }] : []));
    const rec0 = kept.reduce((a, r) => a + r.got, 0);
    // what is left of the Forecast over the PAY stages still to come (two when none is paid yet)
    const free = payStages(cfg).filter((p) => !start.used.includes(p));
    const open = start.used.length ? free : [payStageFor(cfg, 1), payStageFor(cfg, 2)];
    const stages = open.length ? open : [payStageFor(cfg, payStages(cfg).length + 1)];
    const base = Math.max(0, (m.forecast || 0) - rec0);
    const a = base > 0 ? splitAmounts(base, stages.map(() => 1)) : stages.map(() => null);
    const pct = kept.length ? '' : String(Math.round(100 / stages.length));
    // 30 days after the win, then every 30 days (as the table's quick plan); after installments received, on from there
    return [...kept, ...stages.map((stage, i) => ({ stage, amt: a[i] != null ? fmtMoney(a[i]) : '', pct, due: '', rel: (kept.length + i + 1) * 30, date: false, how: 'transfer' as PayHow, howT: '', note: '', got: 0 }))];
  });
  const [err, setErr] = useState('');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.sl-pq button[aria-pressed=true]')?.focus();
  }, []);
  // a plan of one installment shows it as PAY (as the steps do), two or more as PAY1 … PAYn
  const rowCode = (r: Row) => (rows.length === 1 ? 'PAY' : r.stage);
  /** something recorded at an installment's stage: its note or date, a document, a contact */
  const holds = (p: string) => !!(stepOf(S, d.id, p).d || stepOf(S, d.id, p).n.trim()) || docsOf(S, d.id).some((x) => x.stage === p) || actsOf(S, d.id).some((a) => a.stage === p);
  const received = rows.filter((r) => r.got > 0);
  const rec = received.reduce((a, r) => a + r.got, 0);
  const amtOf = (r: Row) => parseAmount(r.amt);
  const sum = rows.reduce((a, r) => a + (amtOf(r) || 0), 0);
  const diff = total != null ? sum - total : null;
  const shares = rows.filter((r) => !r.got).map((r) => +r.pct || 0);
  const nextStage = (used: string[]) => {
    for (let i = 1; i <= 99; i++) {
      const p = payStageFor(cfg, i);
      if (!used.includes(p) && !start.used.includes(p)) return p;
    }
    return 'PAY' + (used.length + 1);
  };
  /** n lines (received ones kept), the rest splitting what is left of the total in these shares. */
  const layout = (n: number, sh?: number[]) => {
    n = Math.max(received.length || 1, Math.min(PLAN_MAX, n));
    const k = n - received.length;
    let open = rows.filter((r) => !r.got).slice(0, k);
    while (open.length < k) {
      const prev = [...received, ...open].pop();
      open = [...open, { stage: nextStage([...received, ...open].map((r) => r.stage)), amt: '', pct: '', due: '', rel: prev?.rel != null ? prev.rel + 30 : (open.length + 1) * 30, date: false, how: prev?.how || 'transfer', howT: '', note: '', got: 0 }];
    }
    const s = sh && sh.length === k ? sh : k === 2 ? [50, 50] : open.map(() => 1);
    const ssum = s.reduce((a, b) => a + b, 0) || 1;
    const left = total != null ? Math.max(0, total - rec) : null;
    const amts = left ? splitAmounts(left, s) : null;
    open = open.map((r, i) => ({ ...r, amt: amts ? fmtMoney(amts[i]) : r.amt, pct: received.length ? '' : String(Math.round((s[i] / ssum) * 100)) }));
    // lines already there take their new amounts in place (received ones stay as they are)
    const upd = new Map(open.map((r) => [r.stage, r]));
    setRows([...rows.flatMap((r) => (r.got > 0 ? [r] : upd.has(r.stage) ? [upd.get(r.stage)!] : [])), ...open.filter((r) => !rows.some((x) => x.stage === r.stage))]);
  };
  const dueRule = (step: number | null) =>
    setRows(rows.map((r, i) => (r.got ? r : step == null ? { ...r, date: true, due: r.due || (won ? dueOf(r, won) : '') || today } : { ...r, date: false, due: '', rel: i * step })));
  const upRow = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const n = rows.length;
  const preset = shares.join('/');
  const save = () => {
    const bad = rows.find((r) => amtOf(r) === undefined);
    if (bad) return setErr(`ยอดของ ${rowCode(bad)} อ่านไม่ได้ พิมพ์ตัวเลขเดียว เช่น 53,500`);
    const lines: PlanInput[] = rows.map((r) => ({ stage: r.stage, amt: amtOf(r) ?? null, pct: r.pct.trim() === '' ? null : +r.pct, due: r.date ? r.due : '', rel: r.date ? null : r.rel, how: r.how, howT: r.howT, note: r.note }));
    const run = () => {
      const { kept } = e.setPlan(d.id, lines);
      set({ dpPlan: '' });
      acts.say(`บันทึกแผนชำระแล้ว · ${lines.length} งวด · รวม ${fmtMoney(sum)} บาท${kept.length ? ' · เก็บงวดที่รับแล้ว ' + kept.join(', ') + ' ไว้' : ''}`);
    };
    // the plan as it will be: money received by hand at the planned amount moves with it, and a deal's
    // first plan takes its received money from its documents or typed Actual to its stages; a checked line
    // (or one of a closed month) is asked about first
    guard.ask({ d, after: previewOf.plan(S, d.id, lines, today), kind: 'edit', title: P ? 'แก้แผนชำระ' : 'ตั้งแผนชำระ', verb: 'บันทึกแผน', run });
  };
  const clear = () => {
    if (!window.confirm('ลบแผนชำระนี้? งวดที่รับเงินแล้วยังเก็บไว้')) return;
    const { kept } = e.clearPlan(d.id);
    set({ dpPlan: '' });
    acts.say(kept.length ? `ลบแผนแล้ว เก็บงวดที่รับแล้ว ${kept.join(', ')} ไว้` : 'ลบแผนชำระแล้ว');
  };
  // an installment taken out of the plan that holds something (a note, a document, a contact): it still shows in
  // the steps, uncounted ("นอกแผนชำระ"), and can be put back here
  const stays = (P?.lines || []).map((l) => l.stage).filter((p) => !rows.some((r) => r.stage === p) && holds(p));
  return (
    <section ref={ref} className="dp-card sl-plan editing" aria-labelledby="dp-plan" onKeyDown={(ev) => ev.key === 'Escape' && (ev.stopPropagation(), set({ dpPlan: '' }))}>
      <div className="sl-pc-h">
        <h3 id="dp-plan">{P ? 'แก้ไขแผนชำระ' : 'ตั้งแผนชำระ'}</h3>
        <span className="sl-pc-s r">พิมพ์ไว้ก่อนได้ · ยอดที่รับจริงมาจากใบเสร็จ หรือปุ่ม “รับเงินแล้ว”</span>
      </div>
      <div className="sl-pq" role="group" aria-label="ตั้งเร็ว">
        <span className="sl-pq-l">จำนวนงวด</span>
        <span className="seg sl-seg2">
          {[1, 2, 3, 4].map((k) => <button key={k} type="button" aria-pressed={n === k} onClick={() => layout(k)}>{k}</button>)}
          <button type="button" aria-pressed={n > 4} onClick={() => layout(n > 4 ? n + 1 : 5)} title="เพิ่มได้ถึง 12 งวด">{n > 4 ? `${n} งวด` : 'อื่นๆ'}</button>
        </span>
        {n - received.length > 1 && (
          <>
            <span className="sl-pq-l">แบ่งยอด</span>
            <span className="seg sl-seg2">
              <button type="button" aria-pressed={shares.every((x) => x === shares[0]) && n - received.length !== 2} onClick={() => layout(n, rows.filter((r) => !r.got).map(() => 1))}>เท่ากัน</button>
              {(PRESETS[n - received.length] || []).map((p) => (
                <button key={p.join('/')} type="button" aria-pressed={preset === p.join('/')} onClick={() => layout(n, p)}>{p.join('/')}</button>
              ))}
              <span className="sl-seg2-x" aria-live="polite">{!(PRESETS[n - received.length] || []).some((p) => p.join('/') === preset) && !shares.every((x) => x === shares[0]) ? 'กำหนดเอง' : ''}</span>
            </span>
          </>
        )}
        <span className="sl-pq-l">จากยอด</span>
        <span className="sl-pq-v">
          {typedTotal == null ? (
            <>
              Forecast {fmtMoney(m.forecast)}{m.fcDoc?.docNo ? ` (${m.fcDoc.docNo})` : ''}
              {rec > 0 && ` · รับแล้ว ${fmtMoney(rec)}`} · <button type="button" className="lnk" onClick={() => setTypedTotal(fmtMoney(m.forecast))}>พิมพ์ยอดรวมเอง</button>
            </>
          ) : (
            <span className="sl-pq-tot">
              <input className="fld num" value={typedTotal} inputMode="decimal" onChange={(ev) => setTypedTotal(ev.target.value)} aria-label="ยอดรวมของแผน (บาท)" placeholder={m.forecast == null ? 'ยังไม่มี Forecast พิมพ์ยอดรวม' : ''} />
              <button type="button" className="btn xs" onClick={() => layout(n, shares.length === n - received.length ? shares : undefined)}>แบ่งตามยอดนี้</button>
              {/* the quotation behind a typed total: read, checked against it, and (as a quotation) the Forecast */}
              <button
                type="button"
                className="lnk"
                onClick={() => attach({ at: 'quote', plan: true, onSaved: (r) => r.docFig != null && setTypedTotal(fmtMoney(r.docFig)) })}
              >
                แนบเอกสาร
              </button>
              {m.forecast != null && <button type="button" className="lnk" onClick={() => setTypedTotal(null)}>ใช้ Forecast</button>}
            </span>
          )}
        </span>
        <span className="sl-pq-l">ครบกำหนด</span>
        {/* an action, not a value: it sets every installment's due date, then reads "ตามที่ตั้งในแต่ละงวด" again */}
        <Select
          className="sm"
          label="ครบกำหนดทุกงวด"
          value=""
          onChange={(v) => v && dueRule(v === 'date' ? null : +v)}
          width={300}
          options={[{ v: '', label: 'ตามที่ตั้งในแต่ละงวด' }, { v: '30', label: 'งวดแรกเมื่อได้งาน แล้วทุก 30 วัน' }, { v: '45', label: 'งวดแรกเมื่อได้งาน แล้วทุก 45 วัน' }, { v: 'date', label: 'กำหนดวันเองทุกงวด' }]}
        />
      </div>
      <div className="sl-pe">
        <div className="sl-pe-r ph"><span>งวด</span><span className="r">ยอด (บาท)</span><span className="r">%</span><span>ครบกำหนด</span><span>วิธีชำระ</span><span>หมายเหตุ / เงื่อนไข</span><span /></div>
        {rows.map((r, i) => (
          <div key={r.stage} className="sl-pe-r">
            <span className="c-st"><b>{rowCode(r)}</b>{r.got > 0 && <span className="t-ok sl-pe-rec">รับแล้ว</span>}</span>
            <input className="fld num" value={r.amt} inputMode="decimal" aria-label={'ยอด ' + r.stage} aria-invalid={amtOf(r) === undefined} onChange={(ev) => upRow(i, { amt: ev.target.value, pct: '' })} />
            <input
              className="fld num pct"
              value={r.pct}
              inputMode="decimal"
              aria-label={'เปอร์เซ็นต์ ' + r.stage}
              placeholder="—"
              disabled={r.got > 0}
              onChange={(ev) => {
                const pct = ev.target.value.replace(/[^\d.]/g, '');
                upRow(i, { pct, ...(total != null && pct ? { amt: fmtMoney(Math.round((total * +pct) / 100)) } : {}) });
              }}
            />
            <span className="sl-pe-due">
              <Select
                className="sm"
                label={'ครบกำหนด ' + r.stage}
                value={r.date ? 'date' : r.rel == null ? 'none' : String(r.rel)}
                width={240}
                onChange={(v) => upRow(i, v === 'date' ? { date: true, due: r.due || (won && r.rel != null ? dueOf(r, won) : '') || today } : v === 'none' ? { date: false, due: '', rel: null } : { date: false, due: '', rel: +v })}
                options={[
                  ...REL.map((x) => ({ v: String(x), label: relText({ rel: x }) })),
                  ...(r.rel != null && !REL.includes(r.rel) ? [{ v: String(r.rel), label: relText(r) }] : []),
                  { v: 'date', label: 'เลือกวันที่…' },
                  { v: 'none', label: 'ยังไม่กำหนด' },
                ]}
              />
              {r.date ? <DateChip value={r.due} onChange={(v) => upRow(i, { due: v })} label={'วันครบกำหนด ' + r.stage} /> : won && r.rel != null && <small>{isoTh(dueOf(r, won))}</small>}
              {!r.got && <YearChip d={d} date={r.date ? r.due : won ? dueOf(r, won) : ''} />}
            </span>
            <span className="sl-pe-how">
              <Select className="sm" label={'วิธีชำระ ' + r.stage} value={r.how} onChange={(v) => upRow(i, { how: v as PayHow })} options={[{ v: '', label: 'ไม่ระบุ' }, ...HOWS.map((k) => ({ v: k, label: HOW_TH[k] }))]} />
              {r.how === 'other' && <input className="fld" value={r.howT} placeholder="เช่น บัตรเครดิต" aria-label={'วิธีชำระอื่น ' + r.stage} onChange={(ev) => upRow(i, { howT: ev.target.value })} />}
            </span>
            <input className="fld" value={r.note} maxLength={300} placeholder="เงื่อนไข เช่น เมื่อส่งรายงาน" aria-label={'หมายเหตุ ' + r.stage} onChange={(ev) => upRow(i, { note: ev.target.value })} />
            {r.got > 0 ? <span className="sl-pe-x" aria-hidden="true" /> : <button type="button" className="sl-pe-del hv" aria-label={'ลบงวด ' + r.stage} title="ลบงวดนี้" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
      </div>
      {stays.length > 0 && <p className="sl-pc-x">{stays.join(', ')} มีข้อมูลบันทึกไว้ จะยังแสดงในขั้นตอน ไม่นับเป็นงวด</p>}
      <div className="sl-pe-f">
        {n < PLAN_MAX ? <button type="button" className="lnk" onClick={() => layout(n + 1, [...shares, shares.length ? shares[shares.length - 1] : 1])}>เพิ่มงวด</button> : <span />}
        <span>รวม <b>{fmtMoney(sum) || '0'}</b> บาท · <span className={diff ? 't-warn' : 't-ok'}>{diff == null ? 'ยังไม่มี Forecast' : diff === 0 ? 'เท่ากับ Forecast' : diff < 0 ? `น้อยกว่า Forecast ${fmtMoney(-diff)}` : `มากกว่า Forecast ${fmtMoney(diff)}`}</span></span>
      </div>
      {err && <span className="t-bad" role="alert" style={{ fontSize: 13 }}>{err}</span>}
      <div className="sl-pe-a">
        {P && <button type="button" className="quiet" onClick={clear} style={{ marginRight: 'auto' }}>ลบแผน</button>}
        <button type="button" className="quiet" onClick={() => set({ dpPlan: '' })}>ยกเลิก</button>
        <button type="button" className="btn pri" onClick={save} disabled={!rows.length}>บันทึกแผน</button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ the rest

/** Documents of no stage (or a stage no longer in the list): contracts, POs, anything not counted. */
function OtherDocs({ d, attach }: { d: Deal; attach: Attach }) {
  const { engine: e } = useApp();
  const stray = strayDocs(e.sales, d);
  const other = dealSteps(e.sales, d, todayISO()).other.docs.filter((x) => !stray.includes(x));
  const fcDoc = dealMoney(e.sales, d).fcDoc;
  const n = other.length + stray.length;
  return (
    <section className="dp-card" aria-labelledby="dp-other">
      <div className="sl-acc">
        <h3 id="dp-other">เอกสารอื่น</h3>
        <small>{n ? `${n} ฉบับ` : 'สัญญา / PO / เอกสารที่ไม่นับยอด'}</small>
        {e.can('docs.up') && <button type="button" className="btn xs" onClick={() => attach({ at: 'other' })}>แนบเอกสารอื่น</button>}
      </div>
      {stray.map((doc) => <DocCard key={doc.id} d={d} doc={doc} inUse={false} stray />)}
      {other.map((doc) => <DocCard key={doc.id} d={d} doc={doc} inUse={doc.target === 'forecast' ? fcDoc?.id === doc.id : doc.target === 'actual' && doc.amount != null} />)}
    </section>
  );
}

/** Contact details, the linked company, SOURCE / services, the หมวด and the year: folded by default. */
function ContactCard({ d, ro, title = 'ข้อมูลติดต่อ · SOURCE / บริการ' }: { d: Deal; ro: boolean; title?: string }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState(false);
  const S = e.sales, C = S.cfg;
  const up = (p: Partial<Deal>) => e.updateDeal(d.id, p);
  /** Another year: a joint quotation's company leaves it, its header takes every company along (asked first). */
  const setYear = (y: string) => {
    const jr = jointRole(S, d), g = jr === 'plain' ? null : jointOf(S, d);
    if (y === d.year || !g) return up({ year: y });
    const why = e.jointYearBlock(d);
    if (why) return acts.say(why);
    const no = jointNo(S, g);
    const ask = jr === 'member'
      ? `ย้าย ${d.client} ไปปี ${y}? บริษัทนี้จะออกจากใบเสนอราคาร่วม${no ? ' ' + no : ''} (บริษัทในใบเสนอราคาร่วมอยู่ปีเดียวกัน) แถวและข้อมูลของบริษัทยังอยู่ ยอดของใบเสนอราคาร่วมไม่เปลี่ยน`
      : `ย้ายใบเสนอราคาร่วม${no ? ' ' + no : ''} ไปปี ${y}? ทั้ง ${g.members.length} บริษัทในใบนี้ย้ายไปปี ${y} ด้วย`;
    if (window.confirm(ask)) up({ year: y });
  };
  const toggle = (k: 'source' | 'service', x: string) => up({ [k]: d[k].includes(x) ? d[k].filter((y) => y !== x) : [...d[k], x] });
  const referrals = [...new Set(Object.values(S.deals).map((x) => x.referral).filter(Boolean))];
  const years = [...new Set([beYear(), String(+beYear() + 1), String(+beYear() - 1), d.year])].sort();
  const lc = lastContactInfo(S, d, todayISO());
  const sum = [d.contactName, ...d.source, ...d.service].filter(Boolean).join(' · ') || 'ยังไม่มีข้อมูล';
  const chips = (k: 'source' | 'service', all: string[]) =>
    opts && !ro ? (
      <div className="sl-opts">
        {all.map((x) => (
          <button key={x} type="button" aria-pressed={d[k].includes(x)} onClick={() => toggle(k, x)} className={'sl-opt hv' + (d[k].includes(x) ? ' on' : '')}>{x}</button>
        ))}
      </div>
    ) : (
      <div className="sl-opts">{d[k].length ? d[k].map((x) => <span key={x} className="chip pick">{x}</span>) : <span className="t-muted">ยังไม่ได้เลือก</span>}</div>
    );
  return (
    <section className="dp-card" aria-labelledby="dp-contact">
      <div className="sl-acc">
        <h3 id="dp-contact">{title}</h3>
        <small>{sum}</small>
        <button type="button" className="lnk" aria-expanded={open} aria-controls="dp-contact-b" onClick={() => setOpen(!open)}>{open ? 'ซ่อน' : 'แสดง'}</button>
      </div>
      {open && (
        <div id="dp-contact-b" className="sl-acc-b">
          <LinkCompany d={d} ro={ro} />
          <ReadOnly ro={ro}>
            <div className="sl-fields">
              <Field label="ผู้ติดต่อ" value={d.contactName} onSave={(v) => up({ contactName: v })} />
              <Field label="เบอร์โทร" value={d.phone} onSave={(v) => up({ phone: v })} type="tel" />
              <Field label="อีเมล" value={d.email} onSave={(v) => up({ email: v })} type="email" />
              <Field label="ผู้รับผิดชอบ" value={d.resp} onSave={(v) => up({ resp: v })} list="sl-team" />
              <Field label="แหล่งที่มา (Referral)" value={d.referral} onSave={(v) => up({ referral: v })} list="sl-ref" />
              <span style={labelCol}>
                วันที่ติดต่อ
                <DateField value={d.contactDate} onChange={(v) => up({ contactDate: v })} label="วันที่ติดต่อ" placeholder="ยังไม่ระบุ" />
                {lc.date && lc.from !== 'typed' && <span className="t-meta">ติดต่อล่าสุด {isoTh(lc.date)} {lc.from === 'act' ? 'จากบันทึกการติดต่อ' : 'จากขั้น ' + lc.from}</span>}
              </span>
              {/* หมวด moves the deal: it changes only on a choice in the list, never on a key over the closed button */}
              <SelField style={labelCol} text="หมวด" value={d.section} onChange={(v) => e.moveDeal(d.id, v, null)} options={[...new Set([...C.sections, d.section])].map((x) => ({ v: x, label: x || 'ไม่ระบุหมวด' }))} />
              <SelField style={labelCol} text="ปี (พ.ศ.)" value={d.year} onChange={setYear} options={years.map((y) => ({ v: y, label: y }))} />
            </div>
            <datalist id="sl-team">{e.crm.team.map((x) => <option key={x} value={x} />)}</datalist>
            <datalist id="sl-ref">{referrals.map((x) => <option key={x} value={x} />)}</datalist>
          </ReadOnly>
          <div className="sl-opt-h">
            <span>SOURCE (ช่องทาง) และบริการ</span>
            {!ro && <button type="button" className="lnk" onClick={() => setOpts(!opts)}>{opts ? 'เสร็จ' : 'แก้ไข'}</button>}
          </div>
          {chips('source', C.sources)}
          {chips('service', C.services)}
        </div>
      )}
    </section>
  );
}

function HistoryCard({ d }: { d: Deal }) {
  const { engine: e } = useApp();
  const [open, setOpen] = useState(false);
  const log = Object.values(e.sales.log).filter((l) => l.deal === d.id).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section className="dp-card" aria-labelledby="dp-hist">
      <div className="sl-acc">
        <h3 id="dp-hist">ประวัติการแก้ไข</h3>
        <small>{log.length ? `${log.length} รายการ · ล่าสุด ${dtTh(log[0].at)}` : 'ยังไม่มี'}</small>
        {log.length > 0 && <button type="button" className="lnk" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'ซ่อน' : 'แสดง'}</button>}
      </div>
      {open && (
        <ul className="sl-hist">
          {log.slice(0, 50).map((l) => (
            <li key={l.id}>
              <span className="t-meta">{dtTh(l.at)}</span>
              <span>{l.by || 'ไม่ระบุชื่อ'} {l.action}{l.detail ? <span className="t-sec"> · {l.detail.replace(/\s*\u2192\s*/g, ' เป็น ')}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
