import { useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { dmTh, dtTh, isoTh, todayISO } from '../lib/format';
import { norm } from '../lib/core';
import {
  DEAL_STAGE, HOW_TH, KIND_TH, NOTE_MAX, PLAN_MAX, QUOTE_STAGE, beYear, closeReady, dealMoney, dealResult, docsOf, dueOf, fmtMoney, isPayStage, kindForStage, lastContact,
  overdueDays, paidNote, parseAmount, payStageFor, payStages, payState, planLines, planOf, splitAmounts, stageDocs, stageTh, stageTrack, stepOf, whtRate, wonDate,
  type Deal, type DealDoc, type DocKind, type LineView, type PayHow, type PlanInput, type StageState,
} from '../lib/sales';
import { CLOSE_TITLE, closingView, diffText, lineMeta, lineStatusView, relText, shortName } from '../lib/salesUi';
import { DocAttach, SHOWABLE } from './DocAttach';
import { DateChip } from './DateChip';
import { Icon } from './icons';
import { ReadOnly } from './ReadOnly';
import { useSalesActs } from './SalesToast';
import { Bead, reachedOf } from './StageTrack';
import { DateField, Status, labelCol } from './ui';
import { commitFocus, isClosingBlur, useDialog } from './useDialog';

/** A stage's Thai name (CLOSED DEAL says "ผลการขาย": its buttons say YES / NO). */
const thOf = (p: string) => stageTh(p).replace(/\s*\(YES \/ NO\)$/, '');
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
  return <input {...box} aria-label="ชื่อลูกค้า" onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} className="dp-name hv" />;
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

/** An attached document: what it is, its file, and what it counts toward; a click shows its actions
 *  (open the file, correct the amount or the type, delete). */
function DocCard({ d, doc, inUse }: { d: Deal; doc: DealDoc; inUse: boolean }) {
  const { engine: e } = useApp();
  const ro = !e.can('edit');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState('');
  const [link, setLink] = useState('');
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
      // a pop-up opened long after the click is blocked by the browser: then the link below is used
      if (!SHOWABLE.test(doc.mime)) save(url);
      else if (Date.now() - t0 < 2500) window.open(url, '_blank', 'noopener');
    } catch (err) {
      setBusy((err as Error)?.message || String(err));
    }
  };
  const goes = inUse ? TARGET_TH[doc.target] : doc.target === 'forecast' ? 'ไม่ได้ใช้ (มียอดที่ใหม่กว่า)' : TARGET_TH[doc.target];
  return (
    <div className={'sl-docc' + (open ? ' open' : '')}>
      <button type="button" className="sl-docc-h hv" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="sl-docc-t">
          <span>{KIND_TH[doc.kind]}{doc.docNo ? ' ' + doc.docNo : ''}</span>
          <small>{doc.name} · {(doc.size / 1024).toFixed(0)} KB · {doc.fileId ? 'Drive ของทีม' : 'อยู่ในเครื่องที่แนบ รออัปโหลด'} · แนบโดย {doc.by || 'ไม่ระบุ'}{doc.docDate ? ' · ลงวันที่ ' + isoTh(doc.docDate) : ''}</small>
        </span>
        <span className="sl-docc-a">
          <b>{doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : '—'}</b>
          <small className={inUse ? 'ok' : ''}>{goes}</small>
        </span>
      </button>
      {open && (
        <div className="sl-docc-acts">
          <button type="button" onClick={show} className="btn xs">{SHOWABLE.test(doc.mime) ? 'เปิดไฟล์' : 'ดาวน์โหลดไฟล์'}</button>
          {link && SHOWABLE.test(doc.mime) && <a href={link} target="_blank" rel="noopener noreferrer" className="lnk">เปิดในแท็บใหม่</a>}
          {link && <a href={link} download={doc.name} className="lnk">ดาวน์โหลด</a>}
          {!ro && <button type="button" onClick={() => setEdit(!edit)} className="btn xs">{edit ? 'ปิด' : 'แก้ยอด / ประเภท'}</button>}
          {!ro && <button type="button" onClick={() => window.confirm(`ลบเอกสาร "${doc.name}"?`) && e.deleteDoc(d.id, doc.id)} className="quiet">ลบ</button>}
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
            e.updateDoc(d.id, doc.id, { amount, target: amount == null ? 'none' : (String(fd.get('target')) as DealDoc['target']), kind: String(fd.get('kind')) as DocKind, docNo: String(fd.get('docNo') || ''), basis: amount === doc.amount ? doc.basis : 'manual' });
            setEdit(false);
          }}
          className="sl-docc-form"
        >
          <label style={labelCol}>ยอด (บาท)<input name="amount" defaultValue={doc.amount ?? ''} inputMode="decimal" className="fld" /></label>
          <label style={labelCol}>นับเป็น<select name="target" defaultValue={doc.target} className="fld sel"><option value="forecast">Forecast</option><option value="actual">Actual</option><option value="none">ไม่นับยอด</option></select></label>
          <label style={labelCol}>ประเภท<select name="kind" defaultValue={doc.kind} className="fld sel">{(Object.keys(KIND_TH) as DocKind[]).map((k) => <option key={k} value={k}>{KIND_TH[k]}</option>)}</select></label>
          <label style={labelCol}>เลขที่เอกสาร<input name="docNo" defaultValue={doc.docNo} className="fld" /></label>
          <button type="submit" className="btn pri sm">บันทึก</button>
          <span className="t-meta" style={{ gridColumn: '1/-1' }}>ลบเอกสารที่มาแทนใบเดิม ใบเดิมยังไม่นับยอด ตั้งกลับได้ที่ “นับเป็น” ของใบนั้น</span>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the panel

type AttachReq = { stage?: string; kind?: DocKind; file?: File };

export function DealPanel() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const d = ui.deal ? e.sales.deals[ui.deal] : undefined;
  const [att, setAtt] = useState<AttachReq | null>(null);
  useEffect(() => setAtt(null), [ui.deal]);
  const ref = useRef<HTMLElement>(null);
  const acts = useSalesActs();
  // focus the panel itself (its first field is the client name: a stray key would rename it)
  useDialog(ref, { focus: 'dialog', on: !!d });
  // opened at the plan (editor or a receipt): it is brought into view
  useEffect(() => {
    if (d && ui.dpPlan) requestAnimationFrame(() => ref.current?.querySelector('.sl-plan')?.scrollIntoView({ block: 'nearest' }));
  }, [ui.dpPlan, ui.deal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const S = e.sales, C = S.cfg, today = todayISO();
  // blur first: the fields save when they lose focus
  const close = () => {
    commitFocus();
    // an amount refused just now (the click on × / outside blurred the box first): say so before closing
    if (refused && Date.now() - refused.at < 3000) window.alert(refused.msg + ' (ยอดเดิมยังอยู่)');
    refused = null;
    set({ deal: null });
  };
  // an account that can only read sees everything (and opens the files) but changes nothing
  const ro = !e.can('edit');
  const up = (p: Partial<Deal>) => e.updateDeal(d.id, p);
  const m = dealMoney(S, d);
  const t = stageTrack(S, d, today);
  const ps = payState(S, d, today), P = ps.plan, r = t.result, won = r === 'YES';
  const od = overdueDays(S, d, today);
  const ready = d.jobStatus === 'open' && closeReady(S, d, today);
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const attach = (stage?: string, kind?: DocKind, file?: File) => setAtt({ stage, kind, file });
  const planFirst = won || ui.dpPlan !== '';

  // the summary strip: สถานะ · Forecast · Actual · ค้างรับ
  const stWord =
    won ? (P ? (ps.left.length ? `ได้งาน · รับ ${P.paidN}/${P.n} งวด` : 'ได้งาน · รับครบทุกงวด') : ps.left.length ? `ได้งาน · รอชำระ ${ps.left.join(', ')}` : ps.pays.length ? 'ได้งาน · รับชำระครบ' : 'ได้งาน')
    : r === 'NO' ? 'ไม่ได้งาน' : r === 'WAIT' ? 'รอผล' : t.done ? 'กำลังติดตาม' : 'ยังไม่เริ่ม';
  const stKind = won ? 'ok' : r === 'NO' ? 'bad' : r === 'WAIT' ? 'warn' : t.done ? 'info' : 'neutral';
  const acDocs = docsOf(S, d.id).filter((x) => x.target === 'actual' && x.amount != null);
  const lastAc = acDocs[acDocs.length - 1];
  const fcLatest = docsOf(S, d.id).filter((x) => x.target === 'forecast' && x.amount != null).sort((a, b) => (a.cAt || a.at).localeCompare(b.cAt || b.at)).pop();
  const left = P && won ? P.left : won && m.forecast != null ? Math.max(0, m.forecast - (m.actual || 0)) : null;
  const nx = P && won ? P.next : null;
  const typedAc = !m.acDocs && !m.hand && !P;

  return (
    <>
      <div onClick={close} className="dp-back" />
      <aside ref={ref} className="panel dp" tabIndex={-1} role="dialog" aria-modal="true" aria-label={d.client}>
        <div className="dp-head">
          <div className="dp-top">
            <span className="dp-crumb">Sales Tracker · ปี {d.year} · {d.section || 'ไม่ระบุหมวด'}{c ? ' · ' + c.code : ''}</span>
            <span className="dp-acts">
              {!ro &&
                (d.jobStatus === 'closed' ? (
                  <button type="button" className="btn xs" onClick={() => up({ jobStatus: 'open' })}>เปิดงานอีกครั้ง</button>
                ) : (
                  <button type="button" className="btn xs" onClick={() => acts.close(d.id)} title={ready ? 'ย้ายไปแท็บปิดงาน' : 'ยังไม่ครบ ปิดเองได้ (ถามยืนยัน)'}>ปิดงาน</button>
                ))}
              <button type="button" onClick={close} aria-label="ปิด" className="dlg-x"><Icon name="close" size={18} /></button>
            </span>
          </div>
          {ro ? <h3 className="dp-name ro">{d.client}</h3> : <ClientName value={d.client} onSave={(v) => up({ client: v })} />}
          <span className="dp-meta">{[d.contactName, d.phone, d.resp ? 'ผู้รับผิดชอบ ' + d.resp : 'ยังไม่มอบหมายผู้รับผิดชอบ'].filter(Boolean).join(' · ')}</span>
          <div className="dp-strip">
            <div>
              <span>สถานะ</span>
              <Status kind={stKind}>{stWord}</Status>
              {d.jobStatus === 'closed' ? <small>ปิดงานแล้ว{d.closedDate ? ' ' + isoTh(d.closedDate) : ''}</small> : od != null ? <small className="bad">ไม่ได้ติดต่อ {od} วัน</small> : <small>ทำแล้ว {t.done} จาก {t.total} ขั้น</small>}
            </div>
            <div>
              <span>Forecast</span>
              {ro ? <b className={m.forecast == null ? 'none' : ''}>{m.forecast == null ? '—' : fmtMoney(m.forecast)}</b> : <StripMoney label="Forecast" value={m.forecast} onSave={(v) => up({ forecast: v })} />}
              {m.fcDoc ? (
                <small className="ok" title={`${KIND_TH[m.fcDoc.kind]} ${m.fcDoc.docNo}`}>ยืนยันจากเอกสาร</small>
              ) : m.fcOverride && fcLatest && !ro ? (
                <small>พิมพ์เอง · <button type="button" className="lnk" onClick={() => up({ forecast: null })}>ใช้ยอดจากเอกสาร {fmtMoney(fcLatest.amount)}</button></small>
              ) : (
                <small>{m.forecast != null ? 'พิมพ์เอง' : 'แนบที่ QUOTATION'}</small>
              )}
            </div>
            <div>
              <span>Actual</span>
              {ro || !typedAc ? <b className={m.actual == null ? 'none' : ''}>{m.actual == null ? '—' : fmtMoney(m.actual)}</b> : <StripMoney label="Actual" value={m.actual} onSave={(v) => up({ actual: v })} />}
              <small title={acDocs.map((x) => `${KIND_TH[x.kind]} ${x.docNo}`).join('\n') || undefined}>
                {lastAc ? `${lastAc.docNo || KIND_TH[lastAc.kind]}${acDocs.length > 1 ? ` และอีก ${acDocs.length - 1} ใบ` : ''}${m.hand ? ' · บันทึกเอง' : ''}` : m.hand ? 'บันทึกเอง' : m.actual != null ? 'พิมพ์เอง' : 'จาก ' + (payStages(C).join(' + ') || 'ใบเสร็จ')}
              </small>
            </div>
            <div>
              <span>ค้างรับ</span>
              <b className={left ? (nx && nx.lateDays ? 'bad' : 'warn') : 'none'}>{left ? fmtMoney(left) : '—'}</b>
              {won ? (
                nx ? <small className={nx.lateDays ? 'bad' : ''}>{nx.stage} · {nx.lateDays ? `เลยกำหนด ${nx.lateDays} วัน` : nx.due ? dmTh(nx.due) : 'ยังไม่กำหนดวัน'}</small> : left ? <small>{ps.left.join(', ')}</small> : <small className="ok">ครบทุกงวด</small>
              ) : r === 'NO' ? <small>ไม่ได้งาน</small> : P ? <small>แผน {P.n} งวด · {fmtMoney(P.total)}</small> : <small>ยังไม่มีผลการขาย</small>}
            </div>
          </div>
        </div>

        <div className="dp-body">
          {planFirst && <PlanCard d={d} attach={attach} />}
          <StepsCard d={d} attach={attach} />
          {!planFirst && <PlanCard d={d} attach={attach} />}
          <OtherDocs d={d} attach={attach} />
          <ContactCard d={d} ro={ro} />
          <HistoryCard d={d} />
          {e.can('delete') && (
            <button type="button" onClick={() => window.confirm(`ลบ "${d.client}" ออกจาก Sales Tracker? (ลบทั้งขั้นตอน โน้ต แผนชำระ และเอกสารที่แนบ ทุกเครื่องในทีม)`) && (e.deleteDeal(d.id), close())} className="quiet dp-del">
              ลบรายการนี้
            </button>
          )}
        </div>
      </aside>
      {att && <DocAttach deal={d} stage={att.stage} kind={att.kind} file={att.file} onClose={() => setAtt(null)} />}
    </>
  );
}

// ------------------------------------------------------------------ ขั้นตอนการติดตาม

/** The vertical timeline: every stage with its date, note and documents; the next one (or the one
 *  chosen with "แก้ไข") as a card to record it; empty stages further on folded into one line; the
 *  closing step at the end. */
function StepsCard({ d, attach }: { d: Deal; attach: (stage?: string, kind?: DocKind, file?: File) => void }) {
  const { engine: e, ui, set } = useApp();
  const acts = useSalesActs();
  const S = e.sales, stages = S.cfg.stages, today = todayISO();
  const ro = !e.can('edit');
  const t = stageTrack(S, d, today);
  const P = planOf(S, d, today), won = t.result === 'YES';
  const by = stageDocs(S, d).by;
  const m = dealMoney(S, d);
  const reached = reachedOf(stages, t.states);
  const late = overdueDays(S, d, today) != null;
  const [pick, setPick] = useState('');
  // the stage being recorded: the one chosen with "แก้ไข", else the next one
  const cardStage = !ro ? pick || t.next : '';
  const pays = payStages(S.cfg);
  const extras = P ? P.lines.filter((l) => !l.inList).map((l) => l.stage) : [];
  const lastPay = pays.length ? stages.indexOf(pays[pays.length - 1]) : stages.length - 1;
  const items: { p: string; i: number; extra?: boolean }[] = [];
  stages.forEach((p, i) => {
    items.push({ p, i });
    if (i === lastPay) extras.forEach((x) => items.push({ p: x, i: -1, extra: true }));
  });
  const emptyFuture = (x: { p: string; i: number; extra?: boolean }) => !x.extra && t.states[x.p] === 'future' && x.p !== t.next && x.p !== cardStage && !P?.lines.some((l) => l.stage === x.p) && !stepOf(S, d.id, x.p).n;
  const futs = items.filter(emptyFuture);
  const cv = closingView(S, d, today);
  const asking = ui.slPrompt === d.id && cv.ready && d.jobStatus === 'open';
  let futDone = false;
  return (
    <section className="dp-card" aria-labelledby="dp-steps">
      <div className="dp-h">
        <h3 id="dp-steps">ขั้นตอนการติดตาม</h3>
        <span>ทำแล้ว {t.done} จาก {t.total} ขั้น</span>
      </div>
      <ol className="sl-tl">
        {items.map((x) => {
          if (futs.length >= 2 && emptyFuture(x)) {
            if (futDone) return null;
            futDone = true;
            return (
              <li key="fut" className="sl-tl-i fut">
                <Bead state="future" />
                <div className="sl-tl-c">
                  <div className="sl-tl-h"><b>ยังไม่ถึง {futs.length} ขั้น</b><span>{futs.map((f) => f.p).join(' · ')}</span></div>
                </div>
              </li>
            );
          }
          const { p, i, extra } = x;
          const s = stepOf(S, d.id, p);
          const pl = P?.lines.find((l) => l.stage === p) || null;
          const st: StageState = extra ? (pl?.status === 'paid' ? 'done' : 'future') : t.states[p];
          const isNow = !extra && p === t.next;
          const card = !extra && p === cardStage;
          const docs = by[p] || [];
          const doc = docs.find((z) => z.amount != null);
          const unused = !!P && won && isPayStage(S.cfg, p) && !pl;
          const on = !extra && i < reached, dash = on && t.states[stages[i + 1]] === 'planned';
          const fut = (st === 'future' || st === 'off' || unused) && !isNow && !card && !(pl && won);
          let date: ReactNode = s.d ? <span className="sl-tl-d">{st === 'planned' ? 'นัด ' : ''}{isoTh(s.d)}</span> : st === 'off' ? <span className="sl-tl-d">ไม่ต้องทำ</span> : st === 'skipped' ? <span className="sl-tl-d">ข้าม</span> : null;
          if (pl && won) date = pl.status === 'paid' ? <span className="sl-tl-d">รับ {isoTh(pl.rcvDate)}</span> : pl.due ? <span className={'sl-tl-d' + (pl.lateDays ? ' bad' : '')}>ครบกำหนด {isoTh(pl.due)}{pl.lateDays ? ` · เลยมา ${pl.lateDays} วัน` : ''}</span> : null;
          if (unused) date = <span className="sl-tl-d">ไม่มีงวดนี้ในแผน</span>;
          const planLine = pl && pl.status !== 'paid' && (
            <p className="sl-tl-plan">
              แผน {pl.line.amt != null ? fmtMoney(pl.amt) + ' บาท' : 'ยังไม่ใส่ยอด'}{lineMeta(pl.line) ? ' · ' + lineMeta(pl.line) : ''}{!won && pl.line.rel != null && !pl.line.due ? ' · ' + relText(pl.line) : ''}
            </p>
          );
          const edit = ro || card ? null : extra ? (
            <button type="button" className="lnk sl-tl-e" onClick={() => set({ dpPlan: 'edit' })} aria-label={'แก้แผนงวด ' + p}>แก้ไข</button>
          ) : (
            <button type="button" className="lnk sl-tl-e" onClick={() => setPick(p)} aria-label={`แก้ไข ${p} ${thOf(p)}`}>แก้ไข</button>
          );
          let body: ReactNode;
          if (card) {
            body = <StepEdit key={p} d={d} p={p} st={st} line={pl} won={won} doc={!!doc} attach={attach} onDone={() => setPick('')} />;
          } else {
            body = (
              <>
                {p === DEAL_STAGE && (st === 'yes' || st === 'no' || st === 'wait') ? (
                  ro ? <Status kind={st === 'yes' ? 'ok' : st === 'no' ? 'bad' : 'warn'}>{st === 'yes' ? 'ได้งาน (YES)' : st === 'no' ? 'ไม่ได้งาน (NO)' : 'รอผล · ' + s.n}</Status> : <ResultBig d={d} st={st} />
                ) : s.n && !docs.some((z) => z.auto?.n === s.n) && !(pl && s.n === paidNote(pl.line)) ? (
                  <p className="sl-tl-n">{s.n}</p>
                ) : isNow && ro ? (
                  <p className="sl-tl-n t-muted">ยังไม่ได้บันทึก</p>
                ) : null}
                {planLine}
                {docs.map((z) => <DocCard key={z.id} d={d} doc={z} inUse={z.target === 'forecast' ? m.fcDoc?.id === z.id : z.target === 'actual' && z.amount != null} />)}
                {!ro && !doc && st !== 'off' && !unused && !(pl && won) && ((p === QUOTE_STAGE && st === 'done') || (isPayStage(S.cfg, p) && won && !P)) && (
                  <button type="button" className="btn xs sl-tl-att" onClick={() => attach(p)}>แนบ{p === QUOTE_STAGE ? 'ใบเสนอราคา' : 'ใบแจ้งหนี้ / ใบเสร็จ'}</button>
                )}
              </>
            );
          }
          return (
            <li key={p} className={'sl-tl-i' + (on ? (dash ? ' dash' : ' on') : '') + (card ? ' cur-step' : '') + (fut ? ' fut' : '')}>
              <Bead state={unused ? 'off' : st} now={isNow} late={(pl?.lateDays || 0) > 0 || late} stage={p} />
              <div className="sl-tl-c">
                <div className="sl-tl-h">
                  <b>{p}</b>
                  <span>
                    {thOf(p)}
                    {extra ? ' · งวดเพิ่ม' : ''}
                    {isNow && <em> · ขั้นถัดไป</em>}
                  </span>
                  {date}
                  {edit}
                </div>
                {body}
              </div>
            </li>
          );
        })}
        <li className="sl-tl-i sl-tl-end">
          <span className={'sl-flagb' + (cv.ready ? ' ready' : '')} aria-hidden="true" />
          <div className="sl-tl-c">
            <div className={'sl-closing' + (cv.ready ? ' ready' : '')} role={asking ? 'status' : undefined}>
              <b>{asking ? (t.result === 'NO' ? 'ผลการขายเป็น NO แล้ว ปิดงานเลยไหม?' : 'รับชำระครบทุกงวดแล้ว ปิดงานเลยไหม?') : CLOSE_TITLE}</b>
              <p>{d.jobStatus === 'closed' ? `ปิดงานแล้ว${d.closedDate ? ' ' + isoTh(d.closedDate) : ''} งานอยู่ในแท็บ “ปิดงาน” เปิดกลับได้ที่ปุ่มด้านบน` : cv.text}</p>
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
    const was = closeReady(e.sales, d, today);
    e.setStep(d.id, DEAL_STAGE, { d: date || cur.d || today, n: r === 'WAIT' ? (cur.n.trim() && !/^(yes|no)$/i.test(cur.n.trim()) ? cur.n : 'รอผล') : r });
    onPick?.();
    if (r === 'WAIT') acts.say(`บันทึกผลการขายของ ${shortName(d.client)} เป็น รอผล แล้ว`);
    else acts.afterResult(d, was);
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

/** The stage being recorded: its date, its note and, on QUOTATION / a PAY after the win, the place to
 *  drop the document. What was typed is saved also when the panel closes (as the panel's fields always did). */
function StepEdit({ d, p, st, line, won, doc, attach, onDone }: { d: Deal; p: string; st: StageState; line: LineView | null; won: boolean; doc: boolean; attach: (stage?: string, kind?: DocKind, file?: File) => void; onDone: () => void }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const today = todayISO();
  const S = e.sales;
  // the stage as the card opened it (a change by someone else meanwhile is asked about on saving)
  const initRef = useRef(stepOf(S, d.id, p));
  const init = initRef.current;
  const planned = st === 'planned' && !line;
  const date0 = planned || line || !init.d || init.d > today ? today : init.d;
  const [date, setDate] = useState(date0);
  const [note, setNote] = useState(p === DEAL_STAGE && /^(yes|no)$/i.test(init.n.trim()) ? '' : init.n);
  const [over, setOver] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const dirty = note !== (p === DEAL_STAGE && /^(yes|no)$/i.test(init.n.trim()) ? '' : init.n) || date !== date0;
  // saved (or cleared) already: leaving the card writes nothing more
  const done = useRef(false);
  const save = (quiet = false) => {
    const live = stepOf(e.sales, d.id, p);
    if ((live.d !== init.d || live.n !== init.n) && !window.confirm(`มีคนแก้ขั้นนี้ระหว่างที่เปิดอยู่:\n"${live.n || '(ว่าง)'}"\n\nบันทึกของคุณทับหรือไม่?`)) return;
    done.current = true;
    const was = closeReady(e.sales, d, today);
    e.setStep(d.id, p, { d: date, n: p === DEAL_STAGE && !note.trim() && /^(yes|no)$/i.test(init.n.trim()) ? init.n : note });
    if (quiet) return;
    const r = dealResult(e.sales, d);
    if (p === DEAL_STAGE && (r === 'YES' || r === 'NO')) acts.afterResult(d, was);
    else acts.after(d, was, 'payment', `บันทึก ${p} ของ ${shortName(d.client)} แล้ว · ${dmTh(date)}`);
    onDone();
  };
  // closing the panel (×, Escape, the backdrop) keeps what was typed
  const latest = useRef({ dirty, save });
  latest.current = { dirty, save };
  useEffect(() => () => {
    if (latest.current.dirty && !done.current) latest.current.save(true);
  }, []);
  const isMoney = p === QUOTE_STAGE || isPayStage(S.cfg, p) || !!line;
  const drop = isMoney && (p === QUOTE_STAGE || won) && !doc;
  const kind = kindForStage(S.cfg, p);
  return (
    <>
      {p === DEAL_STAGE && <ResultBig d={d} st={st} date={date} onPick={() => ((done.current = true), (initRef.current = stepOf(e.sales, d.id, p)))} />}
      {line && line.status !== 'paid' && (
        <p className="sl-tl-plan">แผน {line.line.amt != null ? fmtMoney(line.amt) + ' บาท' : 'ยังไม่ใส่ยอด'}{lineMeta(line.line) ? ' · ' + lineMeta(line.line) : ''}</p>
      )}
      <div className="sl-fgrid">
        <span style={labelCol}>
          วันที่{planned && init.d ? ` (นัดไว้ ${dmTh(init.d)})` : ''}
          <DateChip value={date} onChange={(v) => ((done.current = false), setDate(v))} label={'วันที่ ' + p} text={date === today ? 'วันนี้ ' + isoTh(date) : undefined} />
        </span>
        <label style={labelCol}>
          โน้ต
          <input
            className="fld"
            value={note}
            maxLength={NOTE_MAX}
            placeholder={p === QUOTE_STAGE ? 'เช่น ส่งใบเสนอราคาทางอีเมลแล้ว' : p === DEAL_STAGE ? 'หมายเหตุ เช่น รอผู้บริหารอนุมัติ' : 'สิ่งที่คุยกัน / สิ่งที่ต้องทำต่อ'}
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
            const f = ev.dataTransfer.files?.[0];
            if (f) attach(p, kind, f);
          }}
        >
          <span className="sl-drop-t">
            <span>แนบ{p === QUOTE_STAGE ? 'ใบเสนอราคา' : 'ใบแจ้งหนี้ / ใบเสร็จ ของงวดนี้'}</span>
            <small>ลากไฟล์มาวาง หรือเลือกไฟล์ · ระบบอ่านยอดให้ คุณตรวจแล้วกดยืนยัน · {p === QUOTE_STAGE ? 'เป็น Forecast' : 'รวมเข้า Actual'}</small>
          </span>
          <span className="sl-drop-b">
            {line && line.status !== 'paid' && <button type="button" className="btn xs" onClick={() => set({ dpPlan: `recv:${p}` })}>รับเงินแล้ว (ไม่มีไฟล์)</button>}
            <button type="button" className="btn xs" onClick={() => fileIn.current?.click()}>เลือกไฟล์</button>
            <input ref={fileIn} type="file" hidden onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) attach(p, kind, f); }} />
          </span>
        </div>
      )}
      <div className="sl-tl-acts">
        {(init.d || init.n) && (
          <button type="button" className="quiet" onClick={() => window.confirm(`ล้าง ${p}? วันที่และโน้ตของขั้นนี้จะหายไป`) && ((done.current = true), e.setStep(d.id, p, { d: '', n: '' }), onDone())}>ล้างขั้นนี้</button>
        )}
        <button type="button" className="btn pri xs" onClick={() => save()}>บันทึก</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ แผนการชำระเงิน

function PlanCard({ d, attach }: { d: Deal; attach: (stage?: string, kind?: DocKind, file?: File) => void }) {
  const { engine: e, ui } = useApp();
  if (ui.dpPlan === 'edit' && e.can('edit')) return <PlanEditor d={d} />;
  return <PlanRead d={d} recv={ui.dpPlan.startsWith('recv:') ? ui.dpPlan.slice(5) : ''} attach={attach} />;
}

/** The plan as agreed, against what came in: one light table, a line per installment. */
function PlanRead({ d, recv, attach }: { d: Deal; recv: string; attach: (stage?: string, kind?: DocKind, file?: File) => void }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const S = e.sales, today = todayISO();
  const ro = !e.can('edit');
  const P = planOf(S, d, today), won = dealResult(S, d) === 'YES';
  const pays = payStages(S.cfg);
  const edit = () => set({ dpPlan: 'edit' });
  if (!P)
    return (
      <section className="dp-card sl-plan" aria-labelledby="dp-plan">
        <div className="sl-pc-h"><h3 id="dp-plan">แผนการชำระเงิน</h3></div>
        <div className="sl-pc-empty">
          <span>{won ? 'ยังไม่มีแผน ตั้งแผนเพื่อติดตามว่าแต่ละงวดต้องรับเท่าไร เมื่อไร' : 'ยังไม่มี พิมพ์ไว้ก่อนได้ เช่น ลูกค้าขอแบ่งจ่าย 2 งวด'}</span>
          {!ro && <button type="button" className="btn xs" onClick={edit}>ตั้งแผนชำระ</button>}
        </div>
      </section>
    );
  const pct = P.total ? Math.min(100, Math.round((P.got / P.total) * 100)) : 0;
  const extra = P.lines.filter((l) => !l.inList);
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
            {P.late.length > 0 && <> · <span className="t-bad">เลยกำหนด {P.late.length} งวด</span></>}
          </span>
        </div>
      ) : (
        <p className="sl-pc-note">แผนที่พิมพ์ไว้ก่อนได้งาน วันครบกำหนดแบบ “หลังได้งาน” จะเป็นวันที่จริงเมื่อบันทึก YES ที่ CLOSED DEAL</p>
      )}
      {canResplit && <p className="sl-pc-x">Forecast ตอนนี้ {fmtMoney(P.base)} บาท · <button type="button" className="lnk" onClick={resplit}>ปรับยอดงวดที่ยังไม่ได้รับตาม %</button></p>}
      <div className="sl-pt" role="table" aria-label="งวดการชำระ">
        <div className="sl-pr ph" role="row">
          <span role="columnheader">งวด</span><span role="columnheader" className="r">ยอด (บาท)</span><span role="columnheader">ครบกำหนด</span><span role="columnheader">วิธีชำระ</span><span role="columnheader">สถานะ</span>
        </div>
        {P.lines.map((l) => {
          const sv = lineStatusView(l, today);
          const hand = l.status === 'paid' && l.hand;
          const lineActs = ro || !won || recv === l.stage ? null : l.status === 'part' ? (
            <>
              <button type="button" className="btn xs" onClick={() => (e.setPayFull(d.id, l.stage, true) ? acts.prompt(d, 'payment') : acts.say(`ถือว่ารับครบ ${l.stage} แล้ว`))}>ถือว่ารับครบ</button>
              <button type="button" className="lnk" onClick={() => attach(l.stage)}>แนบใบเสร็จเพิ่ม</button>
            </>
          ) : l.status !== 'paid' && l.status !== 'off' ? (
            <>
              <button type="button" className="btn xs" onClick={() => set({ dpPlan: `recv:${l.stage}` })}>รับเงินแล้ว</button>
              <button type="button" className="lnk" onClick={() => attach(l.stage)}>แนบใบเสร็จ</button>
            </>
          ) : hand ? (
            <button type="button" className="quiet" onClick={() => window.confirm(`ยกเลิกการรับ ${l.stage}? (${fmtMoney(l.got)} บาท ที่บันทึกเอง)`) && e.unmarkPaid(d.id, l.stage)}>ยกเลิกการรับ</button>
          ) : l.status === 'paid' && l.line.full && l.got < l.amt ? (
            <button type="button" className="quiet" onClick={() => e.setPayFull(d.id, l.stage, false)}>ยกเลิกถือว่าครบ</button>
          ) : null;
          const note = l.line.note;
          return (
            <div key={l.stage} className={'sl-pr s-' + l.status} role="row">
              <span className="c-st" role="cell"><b>{l.stage}</b>{!l.inList && <i className="sl-xtag">งวดเพิ่ม</i>}</span>
              <span className="c-amt r" role="cell">
                {l.line.amt != null ? fmtMoney(l.amt) : '—'}
                {l.line.pct != null && <small>{l.line.pct}%</small>}
              </span>
              <span className="c-due" role="cell">{l.due ? isoTh(l.due) : l.line.due ? isoTh(l.line.due) : relText(l.line) || 'ยังไม่กำหนด'}</span>
              <span className="c-how" role="cell">{HOW_TH[l.line.how]}{l.line.howT ? ' ' + l.line.howT : ''}</span>
              <span className="c-stat" role="cell">
                {sv.kind === 'muted' ? <span className="sl-st-m">{sv.word}</span> : sv.chip ? <span className={'chip ' + sv.kind}>{sv.word}</span> : <Status kind={sv.kind}>{sv.word}</Status>}
                {sv.sub && <small>{sv.sub}</small>}
              </span>
              {(note || lineActs) && (
                <span className="c-note" role="cell">
                  <span>{note}</span>
                  {lineActs && <span className="sl-pk-b">{lineActs}</span>}
                </span>
              )}
              {recv === l.stage && !ro && <RecvForm d={d} l={l} attach={attach} />}
            </div>
          );
        })}
      </div>
      <div className="sl-pc-f">
        {!ro && <button type="button" className="lnk" onClick={edit}>เพิ่มงวด</button>}
        <span>{extra.length ? `${extra.map((l) => l.stage).join(', ')} ยังไม่มีในรายการขั้นตอน ตารางแสดงเป็นแถว “งวดเพิ่ม” ต่อจาก ${pays[pays.length - 1] || 'ขั้นสุดท้าย'}` : `งวดที่เกิน ${pays[pays.length - 1] || 'PAY'} แสดงเป็นแถว “งวดเพิ่ม” ต่อท้าย`}</span>
      </div>
    </section>
  );
}

/** "รับเงินแล้ว" without a document: the date, the amount (the planned one by default), how; a short
 *  amount is counted complete (pre-chosen when it matches withholding tax) or stays owed. */
function RecvForm({ d, l, attach }: { d: Deal; l: LineView; attach: (stage?: string, kind?: DocKind, file?: File) => void }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [amt, setAmt] = useState(fmtMoney(l.amt || null));
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
  const save = () => {
    if (!ok) return;
    const ready = e.markPaid(d.id, l.stage, { date, amount: got ?? null, how, full: fullOn });
    set({ dpPlan: '' });
    if (ready) acts.prompt(d, 'payment');
    else acts.say(`บันทึกรับเงิน ${l.stage} ${fmtMoney(got ?? l.amt)} บาทแล้ว`);
  };
  return (
    <div className="sl-rf" role="group" aria-label={'บันทึกรับเงิน ' + l.stage} ref={box} onKeyDown={(ev) => ev.key === 'Escape' && (ev.stopPropagation(), set({ dpPlan: '' }))}>
      <div className="sl-rf-h"><b>บันทึกรับเงิน {l.stage}</b><span>แผน {fmtMoney(l.amt)} บาท{l.due ? ' · ครบกำหนด ' + isoTh(l.due) : ''}</span></div>
      <div className="sl-rf-g">
        <span style={labelCol}>วันที่รับ<DateChip value={date} onChange={setDate} label="วันที่รับ" /></span>
        <label style={labelCol}>ยอดที่รับ (บาท)<input className="fld num" value={amt} inputMode="decimal" onChange={(ev) => setAmt(ev.target.value)} aria-invalid={!ok} /></label>
        <label style={labelCol}>วิธีชำระ<select className="fld sel" value={how} onChange={(ev) => setHow(ev.target.value as PayHow)}>{HOWS.map((k) => <option key={k} value={k}>{HOW_TH[k]}</option>)}</select></label>
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
        <span className="sl-rf-tip">มีใบเสร็จแล้ว? <button type="button" className="lnk" onClick={() => (set({ dpPlan: '' }), attach(l.stage))}>แนบใบเสร็จแทน</button> ยอดจะมาจากเอกสาร</span>
        <button type="button" className="quiet" onClick={() => set({ dpPlan: '' })}>ยกเลิก</button>
        <button type="button" className="btn pri" disabled={!ok} onClick={save}>บันทึกรับเงิน</button>
      </div>
    </div>
  );
}

type Row = { stage: string; amt: string; pct: string; due: string; rel: number | null; date: boolean; how: PayHow; howT: string; note: string; got: number };
const REL = [0, 15, 30, 45, 60, 90];
const PRESETS: Record<number, number[][]> = { 2: [[50, 50], [30, 70], [40, 60]], 3: [[40, 30, 30], [30, 40, 30], [34, 33, 33]] };

/** Typing the plan ("ตั้งแผนชำระ" / "แก้ไขแผน"): a quick box that fills the lines (how many, how split,
 *  from what total, when due), then the lines one by one. Received lines stay as they are. */
function PlanEditor({ d }: { d: Deal }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const S = e.sales, cfg = S.cfg, today = todayISO();
  const m = dealMoney(S, d);
  const P = planOf(S, d, today);
  const won = wonDate(S, d);
  const [typedTotal, setTypedTotal] = useState<string | null>(m.forecast == null ? '' : null);
  const total = typedTotal != null ? parseAmount(typedTotal) ?? null : m.forecast;
  const [rows, setRows] = useState<Row[]>(() => {
    const L = planLines(S, d);
    if (L) {
      const got = new Map((P?.lines || []).map((l) => [l.stage, l.got]));
      return L.map((x) => ({ stage: x.stage, amt: x.line.amt != null ? fmtMoney(x.line.amt) : '', pct: x.line.pct != null ? String(x.line.pct) : '', due: x.line.due, rel: x.line.rel, date: !!x.line.due, how: x.line.how, howT: x.line.howT, note: x.line.note, got: got.get(x.stage) || 0 }));
    }
    const base = m.forecast || 0;
    const a = base > 0 ? splitAmounts(base, [50, 50]) : [null, null];
    return [0, 1].map((i) => ({ stage: payStageFor(cfg, i + 1), amt: a[i] != null ? fmtMoney(a[i]) : '', pct: '50', due: '', rel: i * 30, date: false, how: 'transfer' as PayHow, howT: '', note: '', got: 0 }));
  });
  const [err, setErr] = useState('');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.sl-pq button[aria-pressed=true]')?.focus();
  }, []);
  const received = rows.filter((r) => r.got > 0);
  const rec = received.reduce((a, r) => a + r.got, 0);
  const amtOf = (r: Row) => parseAmount(r.amt);
  const sum = rows.reduce((a, r) => a + (amtOf(r) || 0), 0);
  const diff = total != null ? sum - total : null;
  const shares = rows.filter((r) => !r.got).map((r) => +r.pct || 0);
  const nextStage = (used: string[]) => {
    for (let i = 1; i <= 99; i++) {
      const p = payStageFor(cfg, i);
      if (!used.includes(p)) return p;
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
      open = [...open, { stage: nextStage([...received, ...open].map((r) => r.stage)), amt: '', pct: '', due: '', rel: prev?.rel != null ? prev.rel + 30 : open.length * 30, date: false, how: prev?.how || 'transfer', howT: '', note: '', got: 0 }];
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
    if (bad) return setErr(`ยอดของ ${bad.stage} อ่านไม่ได้ พิมพ์ตัวเลขเดียว เช่น 53,500`);
    const lines: PlanInput[] = rows.map((r) => ({ stage: r.stage, amt: amtOf(r) ?? null, pct: r.pct.trim() === '' ? null : +r.pct, due: r.date ? r.due : '', rel: r.date ? null : r.rel, how: r.how, howT: r.howT, note: r.note }));
    const { kept } = e.setPlan(d.id, lines);
    set({ dpPlan: '' });
    acts.say(`บันทึกแผนชำระแล้ว · ${lines.length} งวด · รวม ${fmtMoney(sum)} บาท${kept.length ? ' · เก็บงวดที่รับแล้ว ' + kept.join(', ') + ' ไว้' : ''}`);
  };
  const clear = () => {
    if (!window.confirm('ลบแผนชำระนี้? งวดที่รับเงินแล้วยังเก็บไว้')) return;
    const { kept } = e.clearPlan(d.id);
    set({ dpPlan: '' });
    acts.say(kept.length ? `ลบแผนแล้ว เก็บงวดที่รับแล้ว ${kept.join(', ')} ไว้` : 'ลบแผนชำระแล้ว');
  };
  const extras = rows.filter((r) => !cfg.stages.includes(r.stage));
  const pays = payStages(cfg);
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
              {m.forecast != null && <button type="button" className="lnk" onClick={() => setTypedTotal(null)}>ใช้ Forecast</button>}
            </span>
          )}
        </span>
        <span className="sl-pq-l">ครบกำหนด</span>
        <select className="fld sel" defaultValue="" aria-label="ครบกำหนดทุกงวด" onChange={(ev) => { const v = ev.target.value; if (v) dueRule(v === 'date' ? null : +v); ev.target.value = ''; }}>
          <option value="">ตามที่ตั้งในแต่ละงวด</option>
          <option value="30">งวดแรกเมื่อได้งาน แล้วทุก 30 วัน</option>
          <option value="45">งวดแรกเมื่อได้งาน แล้วทุก 45 วัน</option>
          <option value="date">กำหนดวันเองทุกงวด</option>
        </select>
      </div>
      <div className="sl-pe">
        <div className="sl-pe-r ph"><span>งวด</span><span className="r">ยอด (บาท)</span><span className="r">%</span><span>ครบกำหนด</span><span>วิธีชำระ</span><span>หมายเหตุ / เงื่อนไข</span><span /></div>
        {rows.map((r, i) => (
          <div key={r.stage} className="sl-pe-r">
            <span className="c-st"><b>{r.stage}</b>{!cfg.stages.includes(r.stage) && <i className="sl-xtag">งวดเพิ่ม</i>}</span>
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
              <select
                className="fld sel"
                aria-label={'ครบกำหนด ' + r.stage}
                value={r.date ? 'date' : r.rel == null ? 'none' : String(r.rel)}
                onChange={(ev) => {
                  const v = ev.target.value;
                  upRow(i, v === 'date' ? { date: true, due: r.due || (won && r.rel != null ? dueOf(r, won) : '') || today } : v === 'none' ? { date: false, due: '', rel: null } : { date: false, due: '', rel: +v });
                }}
              >
                {REL.map((x) => <option key={x} value={x}>{relText({ rel: x })}</option>)}
                {r.rel != null && !REL.includes(r.rel) && <option value={r.rel}>{relText(r)}</option>}
                <option value="date">เลือกวันที่…</option>
                <option value="none">ยังไม่กำหนด</option>
              </select>
              {r.date ? <DateChip value={r.due} onChange={(v) => upRow(i, { due: v })} label={'วันครบกำหนด ' + r.stage} /> : won && r.rel != null && <small>{isoTh(dueOf(r, won))}</small>}
            </span>
            <span className="sl-pe-how">
              <select className="fld sel" aria-label={'วิธีชำระ ' + r.stage} value={r.how} onChange={(ev) => upRow(i, { how: ev.target.value as PayHow })}>
                <option value="">ไม่ระบุ</option>
                {HOWS.map((k) => <option key={k} value={k}>{HOW_TH[k]}</option>)}
              </select>
              {r.how === 'other' && <input className="fld" value={r.howT} placeholder="เช่น บัตรเครดิต" aria-label={'วิธีชำระอื่น ' + r.stage} onChange={(ev) => upRow(i, { howT: ev.target.value })} />}
            </span>
            <input className="fld" value={r.note} maxLength={300} placeholder="เงื่อนไข เช่น เมื่อส่งรายงาน" aria-label={'หมายเหตุ ' + r.stage} onChange={(ev) => upRow(i, { note: ev.target.value })} />
            {r.got > 0 ? <span className="t-ok sl-pe-rec">รับแล้ว</span> : <button type="button" className="sl-pe-del hv" aria-label={'ลบงวด ' + r.stage} title="ลบงวดนี้" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
      </div>
      {extras.length > 0 && <p className="sl-pc-x">{extras.map((r) => r.stage).join(', ')} ยังไม่มีในรายการขั้นตอน (มี {pays.join(', ') || 'ไม่มีขั้น PAY'}) บันทึกได้ตามปกติ ตารางจะแสดงเป็นแถว “งวดเพิ่ม” ต่อจาก {pays[pays.length - 1] || 'ขั้นสุดท้าย'}</p>}
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
function OtherDocs({ d, attach }: { d: Deal; attach: (stage?: string, kind?: DocKind, file?: File) => void }) {
  const { engine: e } = useApp();
  const other = stageDocs(e.sales, d).other;
  const fcDoc = dealMoney(e.sales, d).fcDoc;
  return (
    <section className="dp-card" aria-labelledby="dp-other">
      <div className="sl-acc">
        <h3 id="dp-other">เอกสารอื่น</h3>
        <small>{other.length ? `${other.length} ฉบับ` : 'สัญญา / PO / เอกสารที่ไม่นับยอด'}</small>
        {e.can('edit') && <button type="button" className="btn xs" onClick={() => attach('', 'other')}>แนบเอกสารอื่น</button>}
      </div>
      {other.map((doc) => <DocCard key={doc.id} d={d} doc={doc} inUse={doc.target === 'forecast' ? fcDoc?.id === doc.id : doc.target === 'actual' && doc.amount != null} />)}
    </section>
  );
}

/** Contact details, the linked company, SOURCE / services, the หมวด and the year: folded by default. */
function ContactCard({ d, ro }: { d: Deal; ro: boolean }) {
  const { engine: e } = useApp();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState(false);
  const S = e.sales, C = S.cfg;
  const up = (p: Partial<Deal>) => e.updateDeal(d.id, p);
  const toggle = (k: 'source' | 'service', x: string) => up({ [k]: d[k].includes(x) ? d[k].filter((y) => y !== x) : [...d[k], x] });
  const referrals = [...new Set(Object.values(S.deals).map((x) => x.referral).filter(Boolean))];
  const years = [...new Set([beYear(), String(+beYear() + 1), String(+beYear() - 1), d.year])].sort();
  const lc = lastContact(S, d, todayISO());
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
        <h3 id="dp-contact">ข้อมูลติดต่อ · SOURCE / บริการ</h3>
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
                {lc && lc !== d.contactDate && <span className="t-meta">ติดต่อล่าสุดตามขั้นตอน {isoTh(lc)}</span>}
              </span>
              <label style={labelCol}>
                หมวด
                <select value={d.section} onChange={(ev) => e.moveDeal(d.id, ev.target.value, null)} className="fld sel">
                  {[...new Set([...C.sections, d.section])].map((x) => <option key={x} value={x}>{x || 'ไม่ระบุหมวด'}</option>)}
                </select>
              </label>
              <label style={labelCol}>
                ปี (พ.ศ.)
                <select value={d.year} onChange={(ev) => up({ year: ev.target.value })} className="fld sel">
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
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
