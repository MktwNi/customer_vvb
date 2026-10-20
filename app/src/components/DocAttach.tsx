import { useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../state';
import { norm } from '../lib/core';
import { dmTh, isoTh, todayISO } from '../lib/format';
import {
  KIND_TH, QUOTE_STAGE, attachPreview, closeReady, countAs, countGuard, dealMoney, fmtMoney, mismatchText, parseAmount, planOf, stageTh, stageTrack, stepOf, targetForStage,
  type AttachInfo, type CountGuard, type CountMode, type Deal, type DealDoc, type DocKind, type DocTarget,
} from '../lib/sales';
import { attachCheck, attachKind0, attachRevision, qtDiffText, qtFacts, qtView } from '../lib/quotes';
import { jointHeadOf, jointRole } from '../lib/sales';
import type { DocFacts } from '../lib/docExtract';
import type { GccEngine } from '../lib/engine';
import { Modal } from './Dialog';
import { DOC_ACCEPT, DOC_MAX_BYTES, docMime } from '../lib/teamFiles';
import { DateField, Notice, labelCol } from './ui';
import { Bead } from './StageTrack';
import { SelField } from './Select';
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

/** Two names refer to the same company? (ignores company-type words and punctuation) */
export function sameParty(a: string, b: string) {
  const strip = (s: string) => norm(s).replace(/บริษัท|จำกัด|มหาชน|ห้างหุ้นส่วน|co|ltd|plc|company|limited/gi, '');
  const x = strip(a), y = strip(b);
  return !x || !y || x.includes(y) || y.includes(x);
}

/** The figure a document is checked against: "แผน" 160,000, "Forecast ที่พิมพ์ไว้" 350,000, … */
export interface DocCheck { what: string; value: number }
/** What the attach ended with: the document's own figure, and whether the user kept theirs instead. */
export interface DocSaved { doc: DealDoc; docFig: number | null; kept: boolean }
/** Where an attach comes from: the figure it backs presets what it counts toward (`target`) and what it
 *  is checked against (`check`; without it the stage's figure is used, see DocAttach); `add`: more for a
 *  part-paid installment ("แนบใบเสร็จเพิ่ม"), so it adds to what came in unless the user picks "ใช้ยอดนี้แทน";
 *  `revise`: the quotation version a revised one follows ("แนบฉบับแก้ไข", lib/quotes). */
export interface AttachMore { target?: DocTarget; check?: DocCheck; add?: boolean; revise?: string; onSaved?: (r: DocSaved) => void }
const BASIS_TH: Record<DealDoc['basis'], string> = { total: 'รวม VAT', subtotal: 'ก่อน VAT', netPay: 'หลังหัก ณ ที่จ่าย', manual: 'ยอดที่พิมพ์' };

/**
 * The words of the "how does this count" question (lib/sales countGuard): what is already counted,
 * each choice with what it does, and — when "นับเพิ่ม" would take Actual past what the job expects — what
 * Actual becomes. `before`: Actual now; `after`: Actual with the current choice; `noPlan`: the deal has no
 * payment plan (every PAY stage must be paid before closing, which is why a receipt gets attached twice).
 */
function countWords(g: CountGuard, choice: CountMode, before: number | null, after: number | null, noPlan: boolean) {
  const at = g.stage, docName = (x: DealDoc) => KIND_TH[x.kind] + (x.docNo ? ' ' + x.docNo : '');
  const elsewhere = !!g.same && !!g.same.stage && g.same.stage !== at;
  const legend = g.same
    ? `${g.sameBy === 'file' ? 'ไฟล์ ' + g.same.name : docName(g.same)} นี้นับยอด${elsewhere ? 'ที่ ' + g.same.stage + ' ' : ''}แล้ว ${fmtMoney(g.same.amount)} บาท`
    : g.old ? `${at} นับยอดจาก${docName(g.old)} ${fmtMoney(g.old.amount)} บาท อยู่แล้ว`
    : g.handPart ? `${at} บันทึกรับเงินเองไว้ ${fmtMoney(g.handPart.got)} บาท ยังไม่มีเอกสาร`
    : g.over ? `งานนี้รับเงินแล้ว ${fmtMoney(g.over.before)} บาท จาก${g.over.what} ${fmtMoney(g.over.cap)} บาท`
    : g.hand ? `${g.hand.stage} บันทึกรับเงินเองไว้ ${fmtMoney(g.hand.handGot)} บาท${g.hand.line.rcv ? ' เมื่อ ' + isoTh(g.hand.line.rcv) : ''} ยังไม่มีใบเสร็จ`
    : '';
  const words: Record<CountMode, [string, string]> = {
    replace: ['ใช้ยอดนี้แทน', elsewhere ? `นับที่ ${at} แทน ใบที่ ${g.same!.stage} เก็บไว้เป็นหลักฐาน ไม่นับยอด` : g.same || g.old ? 'ใบเดิมเก็บไว้เป็นหลักฐาน ไม่นับยอด' : 'ใบนี้เป็นใบเสร็จของเงินก้อนนั้น'],
    move: [`เป็นใบเสร็จของเงินที่ ${g.hand?.stage}`, `แนบที่ ${g.hand?.stage} แทนยอดที่บันทึกเอง`],
    none: ['ไม่นับยอดซ้ำ', `แนบไว้เป็นหลักฐาน Actual เท่าเดิม${before != null ? ' ' + fmtMoney(before) : ''}`],
    add: ['นับเพิ่ม', g.same ? 'เป็นเงินคนละก้อน' : g.old ? 'งวดนี้จ่ายหลายครั้ง' : g.handPart ? 'ใบนี้คือส่วนที่เหลือ รวมกับยอดที่บันทึกไว้' : `เป็นเงินอีกก้อน นับที่ ${at}`],
  };
  return {
    legend,
    warn: !!(g.same || g.over || g.hand || (g.overAdd && choice === 'add')),
    opts: g.modes.map((x) => [x, ...words[x]] as const),
    over: g.overAdd && choice === 'add' && g.modes.length > 0 ? `นับเพิ่มแล้ว Actual จะเป็น ${fmtMoney(after ?? g.overAdd.after)} บาท เกิน${g.overAdd.what} ${fmtMoney(g.overAdd.cap)} บาท` : '',
    hint: elsewhere && noPlan ? `งานที่รับเงินครั้งเดียวไม่ต้องแนบใบเดิมซ้ำที่ ${at} ตั้งแผนชำระ 1 งวด แล้วปิดงานได้` : '',
  };
}

/**
 * Attach a quotation / invoice: the document is read in the browser (PDF text, or OCR for scans and
 * photos), the amounts found are shown, and nothing is saved until the user confirms the figure.
 * `stage`: the stage it was attached at (QUOTATION is the Forecast, a PAY the Actual of that
 * installment); without it the stage is chosen ("ระบบเลือกขั้นให้"), '' = a document of no stage
 * ("เอกสารอื่น"). `file`: a file dropped on the panel, read at once. The amount read is checked
 * against the figure it should match (`check`, else the typed Forecast / the installment's plan / the
 * typed Actual): when they differ the user chooses "ใช้ยอดจากเอกสาร" or "คงยอดเดิม" (the document is
 * attached either way, and a kept figure shows "ไม่ตรงเอกสาร"). Nothing changes silently, nothing blocks saving.
 * A quotation for the Forecast while the deal has one at QUOTATION is a revision ("แนบฉบับแก้ไข", `revise`
 * names the version it follows; chosen as the type it becomes one too): the old and new figures are
 * compared instead of the typed-Forecast check (a `check` the caller gave, such as a typed plan total, is
 * still asked about), and the old version stays as "ฉบับเดิม", not counted. The rules: lib/quotes attach*.
 */
export function DocAttach({ deal, kind: kindIn, stage: stage0, file: dropped, onClose, target: target0, check, add: add0, revise: revise0, onSaved }: { deal: Deal; kind?: DocKind; stage?: string; file?: File; onClose: () => void } & AttachMore) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const cfg = e.sales.cfg, today = todayISO();
  const m0 = dealMoney(e.sales, deal);
  // a joint quotation's member holds no money of its own: what it files is evidence, at no stage, never
  // counted (its quotation and payments are attached at the joint quotation; the engine holds to it too)
  const jm = jointRole(e.sales, deal) === 'member';
  // the stage it was opened at (the receipt of money recorded by hand elsewhere may go there instead: `stage` below)
  const stage1 = jm ? '' : stage0, revise = jm ? undefined : revise0;
  // "ระบบเลือกขั้นให้": a quotation until the deal is won (a revised one, once there is one), then an invoice
  const kind0 = jm ? kindIn ?? 'other' : attachKind0(e.sales, deal, { kind: kindIn, stage: stage1, revise });
  // what a kind counts toward at this stage (a receipt at a PAY stage is Actual); a figure's own attach keeps its target
  const defaultTarget = (k: DocKind): DocTarget => (jm ? 'none' : target0 ?? targetForStage(cfg, stage1 ?? '', k));
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
  // the figure proposed for this file (lib/docExtract proposedAmount: after withholding tax when the
  // document shows it, else the total including VAT)
  const [prop, setProp] = useState<DealDoc['basis']>('manual');
  // how it counts next to money already counted (lib/sales countGuard); null = as suggested
  const [mode, setMode] = useState<CountMode | null>(null);
  // "ถือว่ารับครบงวดนี้" on a short payment: null = as suggested (ticked when it matches withholding tax)
  const [full, setFull] = useState<boolean | null>(null);
  // the document's figure differs from the one it should match: keep the user's ("คงยอดเดิม")
  const [keep, setKeep] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pickH = useId();
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
    setProp('manual');
    setAmount('');
    setDocNo('');
    setDocDate('');
    setKeep(false);
    setMode(null);
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
      const [{ readDocText }, { analyzeDocText, factsScore, proposedAmount }] = await Promise.all([import('../lib/docText'), import('../lib/docExtract')]).catch((e) => {
        // offline, or this page is older than the site (its chunks were replaced by a new version)
        throw new Error('โหลดตัวอ่านเอกสารไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้านี้', { cause: e });
      });
      const t = await readDocText(f, { signal: ctl.signal, forceOcr, onProgress: (msg, pct) => setProg({ msg, pct }), judge: (x) => factsScore(analyzeDocText(x)) });
      if (ctl.signal.aborted) return;
      const fx = analyzeDocText(t.text);
      setFacts(fx);
      setMethod(t.method);
      // (a revision asked for from the quotation's card stays a quotation, whatever the file looks like)
      if (fx.kind && revise == null) {
        setKind(fx.kind);
        setTarget(defaultTarget(fx.kind));
      }
      setDocNo(fx.docNo);
      setDocDate(fx.docDate);
      // what the customer actually pays: after withholding tax when the document shows it, else the
      // total including VAT — for a quotation as for a receipt, so Forecast and Actual compare
      const { basis: b, value: best } = proposedAmount(fx);
      setBasis(b);
      setProp(b);
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
  const tgt0: DocTarget = amt == null ? 'none' : target;
  // money already counted that this document may be (lib/sales countGuard): the same document (its number
  // or file) anywhere in the deal, another one at this installment, money recorded by hand; only money
  // received (Actual, with an amount) is asked about
  const base: AttachInfo = { kind, amount: amt, target: tgt0, docDate, stage: stage1 };
  const g: CountGuard | null = file && tgt0 === 'actual'
    ? countGuard(e.sales, deal, { ...base, add: add0, docNo, name: (file.name || 'เอกสาร').slice(0, 120), size: file.size, figures: facts ? [facts.total, facts.netPay, facts.subtotal] : [] }, today)
    : null;
  const choice: CountMode = g && mode && g.modes.includes(mode) ? mode : g ? g.pick : 'add';
  const how = g ? countAs(g, choice, base) : base;
  // where it goes and what it counts toward: 'move' attaches it at the installment paid by hand, 'none' counts nothing
  const stage = how.stage, tgt: DocTarget = how.target, replace = how.replace, addHand = !!how.addHand;
  // the installment planned at this stage, and the stage's circle
  const line = stage ? planOf(e.sales, deal, today)?.lines.find((l) => l.stage === stage) : undefined;
  const st = stage ? stageTrack(e.sales, deal, today).states[stage] : undefined;
  // "นับเพิ่ม" on money already counted at this installment: checked against what the plan still lacks
  const adding = choice === 'add' && !!g && (!!g.old || !!g.handPart || (!!g.same && g.same.stage === g.stage));
  // a revision: the version it follows (the one asked for, else the one the card is about), whose figures
  // it is compared with; `fixed` = asked for from the quotation's card (type and target are not choices)
  const qv = qtView(e.sales, deal), fixed = revise != null;
  const rev = attachRevision(e.sales, deal, { kind, target, stage: stage1, revise }, today);
  const revN = qv.versions.length + 1;
  // the figure this document should match: given by the figure it was attached from (also on a revision),
  // else none on a revision, else the typed Forecast, the installment's plan (or what was received by
  // hand), or the typed Actual
  const chk: DocCheck | null = attachCheck(check, rev, () =>
    tgt === 'forecast' ? (!m0.fcDoc && m0.forecast != null ? { what: 'Forecast ที่พิมพ์ไว้', value: m0.forecast } : null)
    : tgt !== 'actual' ? null
    : line ? (line.hand && !line.docs.length && !addHand ? { what: 'ยอดที่รับ', value: line.got } : line.amt > 0 ? (adding ? { what: 'ยอดที่ยังขาดตามแผน', value: Math.max(0, line.amt - line.got) } : { what: 'แผน', value: line.amt }) : null)
    : !m0.acDocs && !m0.hand && deal.actual != null ? { what: 'Actual ที่พิมพ์ไว้', value: deal.actual } : null);
  const same = !!chk && amt != null && Math.abs(amt - chk.value) < 0.005;
  const differs = !!chk && amt != null && !same && tgt !== 'none';
  // the figure confirmed: the document's, or the user's own when they keep it (the document is attached either way)
  const fin = differs && keep ? chk!.value : amt;
  // what attaching changes: the installment of the plan, the Actual, and whether the job becomes ready to close
  const pv = file && fin != null && tgt !== 'none' ? attachPreview(e.sales, deal, { kind, amount: fin, target: tgt, docDate, stage, replace, addHand }, today) : null;
  const short = !!pv?.line && pv.short > 0 && pv.line.got > 0;
  const fullOn = short && (full ?? pv?.wht != null);
  const ad = docDate && docDate <= today ? docDate : today;
  const after = !pv
    ? g && choice === 'none' && fin != null
      ? `หลังแนบ: แนบไว้${g.stage ? 'ที่ ' + g.stage + ' ' : ''}เป็นหลักฐาน ไม่นับยอด · Actual เท่าเดิม${m0.actual != null ? ' ' + fmtMoney(m0.actual) : ''}`
      : ''
    : [
        pv.line
          ? `หลังแนบ: ${pv.stage} รับแล้ว ${fmtMoney(pv.line.got)} บาท · ${pv.short > 0 ? `ขาด ${fmtMoney(pv.short)} จากแผน ${fmtMoney(pv.line.amt)}` : pv.line.amt > 0 && pv.line.got > pv.line.amt ? `รับเกินแผน ${fmtMoney(pv.line.got - pv.line.amt)}` : 'ครบตามแผน'}`
          : tgt === 'forecast'
            ? `หลังแนบ: ${pv.stage ? pv.stage + ' ทำแล้ว ' + isoTh(ad) + ' · ' : ''}Forecast จะเป็น ${fmtMoney(fin)}`
            : `หลังแนบ: ${pv.stage ? pv.stage + ' ทำแล้ว ' + isoTh(ad) + ' · ' : ''}Actual จะเป็น ${fmtMoney(pv.actual)}${pv.fcFull ? ' (ครบตาม Forecast)' : ''}`,
        pv.ready || (fullOn && pv.readyIfFull) ? (pv.line ? 'รับครบทุกงวดแล้ว งานนี้จะพร้อมปิดงาน' : 'งานนี้จะพร้อมปิดงาน') : '',
      ].filter(Boolean).join(' · ');
  const save = async () => {
    if (!file || badAmt) return;
    setSaving('กำลังบันทึก…');
    try {
      const was = closeReady(e.sales, deal, today);
      const kept = differs && keep;
      // `detected` keeps the document's own figure: a kept one differs from it ("ไม่ตรงเอกสาร", docMismatch)
      const revising = rev && tgt === 'forecast' ? rev.doc.id : undefined;
      const doc = await e.attachDoc(deal.id, file, { kind, amount: fin, target: tgt, basis: amt == null || kept ? 'manual' : basis, detected: amt, docNo, docDate, stage, replace, addHand, kept, revise: revising });
      // what the reader found: the quotation's edit form offers its figures without reading the file again
      if (facts) qtFacts.set(doc.id, facts);
      // a short payment counted complete (withholding tax): the installment is received
      if (fullOn && doc.stage) e.setPayFull(deal.id, doc.stage, true);
      onClose();
      onSaved?.({ doc, docFig: amt, kept });
      const d = e.sales.deals[deal.id];
      if (d)
        acts.after(d, was, 'payment', revising
          ? `แนบใบเสนอราคา${doc.docNo ? ' ' + doc.docNo : ''} ฉบับที่ ${revN} แล้ว · Forecast ${fmtMoney(fin)} บาท`
          : `แนบ${KIND_TH[doc.kind]}${doc.docNo ? ' ' + doc.docNo : ''}${doc.stage ? ' ที่ ' + doc.stage : ''} แล้ว${kept ? ' · คงยอดเดิม ' + fmtMoney(fin) : ''}${g && choice === 'none' ? ' · ไม่นับยอดซ้ำ' : ''}`);
    } catch (err) {
      setSaving('บันทึกไม่สำเร็จ: ' + ((err as Error)?.message || err));
    }
  };

  // the figure proposed first: the amount payable after withholding tax when the document shows it
  const opts: [DealDoc['basis'], string, number | null][] = facts
    ? ([
        ['netPay', 'ยอดชำระ (หลังหัก ณ ที่จ่าย)', facts.netPay],
        ['total', 'รวมทั้งสิ้น (รวม VAT)', facts.total],
        ['subtotal', 'ก่อน VAT', facts.subtotal],
      ] as [DealDoc['basis'], string, number | null][])
        .filter((x) => x[2] != null)
        .sort((a, b) => (prop === 'netPay' ? 0 : (a[0] === 'netPay' ? 1 : 0) - (b[0] === 'netPay' ? 1 : 0)))
    : [];
  // the money it is, as the document shows it: ยอดรวม · หัก ณ ที่จ่าย · ยอดชำระ
  const whtRow = facts && facts.wht != null && facts.total != null && facts.netPay != null && facts.netPay < facts.total;
  // the question when this document may be money already counted (lib/sales countGuard)
  const ask = g && g.modes.length > 0 && amt != null ? countWords(g, choice, m0.actual, pv?.actual ?? null, !planOf(e.sales, deal, today)) : null;
  const others = facts ? facts.candidates.filter((c) => !opts.some((o) => o[2] === c.value)).slice(0, 5) : [];
  const wordsOk = facts && facts.words != null && facts.total != null && Math.abs(facts.words - facts.total) < 0.01;
  // a joint quotation's member: the quotation may name its payer (the header's client) instead
  const payer = jointRole(e.sales, deal) === 'member' ? e.sales.deals[jointHeadOf(e.sales, deal.id)]?.client : undefined;
  const partyWarn = facts && facts.party && !sameParty(facts.party, deal.client) && !(payer && sameParty(facts.party, payer));
  const isImg = file && docMime(file).startsWith('image/') && !/hei[cf]/.test(docMime(file)); // browsers can't show HEIC

  // the revision against the version it follows: number and date, the figure counted, and the difference
  const qtNo = rev?.doc.docNo || '';
  // the number and the date each kept whole, so a narrow (phone) column breaks between them, not inside a date
  const noDate = (no: string, date: string) => <><span className="qt-nw">{no || 'ไม่ระบุเลขที่'}</span> · <span className="qt-nw">{date ? isoTh(date) : 'ไม่ระบุวันที่'}</span></>;
  const qtStep = stepOf(e.sales, deal.id, QUOTE_STAGE);

  return (
    <Modal title={jm ? 'แนบเอกสารอื่น · ไม่นับยอด' : rev ? `แนบฉบับแก้ไข · ใบเสนอราคา${qtNo ? ' ' + qtNo : ''}` : stage ? `แนบเอกสารที่ ${stage}${stageTh(stage) ? ' · ' + stageTh(stage) : ''}` : `แนบ${KIND_TH[kind]}`} onClose={onClose} width={rev ? 640 : 620}>
      <span className="sl-dlg-sub">{deal.client}</span>
      {jm && <Notice kind="info">บริษัทนี้อยู่ในใบเสนอราคาร่วม เอกสารที่แนบที่นี่เก็บไว้เป็นหลักฐาน ไม่นับยอด · ใบเสนอราคาและใบเสร็จของงานนี้แนบที่ใบเสนอราคาร่วม</Notice>}
      {rev ? (
        <div className="sl-stagebar">
          <Bead state={stageTrack(e.sales, deal, today).states[QUOTE_STAGE] || 'future'} now stage={QUOTE_STAGE} />
          <span>
            ไฟล์นี้จะเป็น <b>ฉบับที่ {revN}</b>{qtNo ? ' ของ ' + qtNo : ''} ที่ขั้น <b>{QUOTE_STAGE}</b> · ยอดที่ยืนยันเป็น Forecast {rev.state === 'cur' ? 'แทนฉบับที่ ' + rev.n : qv.typed ? 'แทนยอดที่พิมพ์ไว้' : ''}
          </span>
        </div>
      ) : stage && (
        <div className="sl-stagebar">
          <Bead state={st || 'future'} now stage={stage} />
          <span>
            เอกสารนี้จะผูกกับขั้น <b>{stage}</b> · ยอดที่ยืนยัน{target === 'forecast' ? 'เป็น Forecast' : target === 'actual' && choice !== 'none' ? 'รวมเข้า Actual' : 'ไม่นับยอด'}
            {line && line.amt > 0 && <> · <b>แผนงวดนี้ {fmtMoney(line.amt)} บาท{line.due ? ' ครบกำหนด ' + dmTh(line.due) : ''}</b></>}
          </span>
        </div>
      )}
      {/* a button in the app's words, as every other file picker (the browser's own control speaks its language) */}
      <div style={{ ...labelCol, gap: 8 }}>
        <span id={pickH}>เลือกไฟล์ PDF หรือรูปถ่าย / สแกน (ไม่เกิน 10 MB)</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          <button type="button" className="btn sm" style={{ flex: 'none' }} onClick={() => input.current?.click()} aria-describedby={pickH} autoFocus={!dropped}>
            {file ? 'เลือกไฟล์อื่น' : 'เลือกไฟล์'}
          </button>
          {file && <span className="t-sec" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>{file.name}</span>}
          {/* a revision's dialog is longer: its PDF link sits by the name */}
          {rev && file && !prog && docMime(file) === 'application/pdf' && <a href={url} target="_blank" rel="noopener noreferrer" className="hv-tx" style={{ flex: 'none', fontSize: 13 }}>เปิดดูไฟล์</a>}
        </span>
        <input ref={input} type="file" accept={DOC_ACCEPT} hidden onChange={(ev) => { const f = ev.target.files?.[0]; if (f) pick(f); }} />
      </div>
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
          {!isImg && !rev && docMime(file) === 'application/pdf' && <a href={url} target="_blank" rel="noopener noreferrer" className="hv-tx" style={{ alignSelf: 'flex-start', fontSize: 14 }}>เปิดดูไฟล์ {file.name} เพื่อเทียบยอด</a>}
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
              {whtRow && <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>ยอดรวม {fmtMoney(facts.total)} · หัก ณ ที่จ่าย {fmtMoney(facts.wht)} · ยอดชำระ {fmtMoney(facts.netPay)}</span>}
              {whtRow && prop === 'netPay' && <span className="t-meta">ระบบเลือกยอดชำระ เพราะเป็นเงินที่{target === 'forecast' ? 'จะได้รับจริง เทียบกับ Actual ได้' : 'ได้รับจริงหลังลูกค้าหัก ณ ที่จ่าย'}</span>}
              {facts.vat != null && <span className="t-meta">VAT {fmtMoney(facts.vat)} บาท{facts.wht != null && !whtRow ? ` · หัก ณ ที่จ่าย ${fmtMoney(facts.wht)} บาท` : ''}</span>}
              {wordsOk && <span className="t-ok" style={{ fontSize: 12 }}>ตรงกับจำนวนเงินตัวอักษรในเอกสาร</span>}
              {facts.copies ? <span className="t-meta">ไฟล์นี้มีทั้งต้นฉบับและสำเนา อ่านยอดชุดเดียว ไม่นับสำเนาซ้ำ</span> : null}
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
              {chk || rev || jm ? 'ยอดในเอกสาร (บาท)' : 'ยอดเงินที่ยืนยัน (บาท)'}
              <input value={amount} onChange={(ev) => { setAmount(ev.target.value); setBasis('manual'); }} inputMode="decimal" placeholder="เช่น 107,000" aria-invalid={badAmt} className="fld" style={{ fontWeight: 500, ...(badAmt ? { borderColor: 'var(--bad)' } : {}) }} />
              {badAmt && <span role="alert" style={{ fontSize: 12, color: 'var(--bad)' }}>อ่านเป็นจำนวนเงินไม่ได้ พิมพ์ตัวเลขเดียว เช่น 107,000 หรือ 1.5 ล้าน</span>}
            </label>
            {/* a revision from the quotation's card is a quotation for the Forecast: no choice to make */}
            {!fixed && !jm && <SelField
              style={labelCol}
              text="นับยอดนี้เป็น"
              value={target}
              onChange={(v) => setTarget(v as DocTarget)}
              width={280}
              options={[{ v: 'forecast', label: 'Forecast', sub: 'ยอดที่คาดว่าจะได้' }, { v: 'actual', label: 'Actual', sub: 'ยอดที่ได้จริง' }, { v: 'none', label: 'ไม่นับยอด', sub: 'แนบไว้เป็นหลักฐาน' }]}
            />}
            {!fixed && <SelField
              style={labelCol}
              text="ประเภทเอกสาร"
              value={kind}
              onChange={(v) => {
                const k = v as DocKind;
                setKind(k);
                setTarget(defaultTarget(k));
              }}
              options={(Object.keys(KIND_TH) as DocKind[]).map((k) => ({ v: k, label: KIND_TH[k] }))}
            />}
            <label style={labelCol}>
              เลขที่เอกสาร
              <input value={docNo} onChange={(ev) => setDocNo(ev.target.value)} className="fld" />
            </label>
            <label style={labelCol}>
              ลงวันที่
              <DateField value={docDate} onChange={setDocDate} placeholder="ไม่ระบุ" />
            </label>
          </div>
          {chk && amt != null && tgt !== 'none' && (
            same ? (
              <p className="sl-xchk ok" role="status"><b>ตรงกับเอกสาร</b> <span>{chk.what} {fmtMoney(chk.value)} บาท · {BASIS_TH[basis]}</span></p>
            ) : (
              <fieldset className="sl-xchk warn">
                <legend>{mismatchText(amt, chk.value, chk.what)}</legend>
                {opts.length > 1 && (
                  <span className="sl-xchk-b" role="group" aria-label="ยอดในเอกสารที่ใช้เทียบ">
                    เทียบด้วย
                    {opts.map(([b, label, v]) => (
                      <button key={b} type="button" className="btn xs" aria-pressed={basis === b && amt === v} onClick={() => choose(b, v)} title={label}>{BASIS_TH[b]} {fmtMoney(v)}</button>
                    ))}
                  </span>
                )}
                <label className="hv-tx"><input type="radio" name="xchk" checked={!keep} onChange={() => setKeep(false)} /> ใช้ยอดจากเอกสาร <b>{fmtMoney(amt)}</b> <span className="t-meta">{BASIS_TH[basis]}</span></label>
                <label className="hv-tx"><input type="radio" name="xchk" checked={keep} onChange={() => setKeep(true)} /> คงยอดเดิม <b>{fmtMoney(chk.value)}</b> <span className="t-meta">แนบไว้ ขึ้นว่าไม่ตรงเอกสาร</span></label>
              </fieldset>
            )
          )}
          {ask && (
            // money that may be counted twice (the same document, a job already paid) is a warning; another
            // payment at this installment is the plain question it always was
            <fieldset className={ask.warn ? 'sl-xchk warn' : 'sl-repl'}>
              <legend>{ask.legend}</legend>
              {ask.opts.map(([x, label, sub]) => (
                <label key={x} className="hv-tx"><input type="radio" name="repl" checked={choice === x} onChange={() => setMode(x)} /> {label} <span className="t-meta">{sub}</span></label>
              ))}
              {ask.over && <span className="t-warn" style={{ fontSize: 13 }}>{ask.over}</span>}
              {ask.hint && <span className="t-meta">{ask.hint}</span>}
            </fieldset>
          )}
          {rev && (
            <div className="qt-cmp" role="group" aria-label="เทียบกับฉบับเดิม">
              <span className="qt-cmp-h">เทียบกับฉบับเดิม</span>
              <table>
                <thead>
                  <tr><td /><th scope="col">ฉบับที่ {rev.n} · ฉบับเดิม</th><th scope="col">ฉบับที่ {revN} · ฉบับแก้ไข</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row"><span className="qt-nw">เลขที่</span> · <span className="qt-nw">ลงวันที่</span></th><td className="old">{noDate(rev.doc.docNo, rev.doc.docDate)}</td><td>{noDate(docNo, docDate)}</td></tr>
                  <tr className="sum"><th scope="row">ยอดที่นับ{basis !== 'manual' && fin === amt ? ` (${BASIS_TH[basis]})` : ''}</th><td className="old">{rev.doc.amount != null ? fmtMoney(rev.doc.amount) : '—'}</td><td>{fin != null ? fmtMoney(fin) : '—'}</td></tr>
                </tbody>
              </table>
              {qtDiffText(rev.doc.amount, fin) && <span className="qt-diff">{qtDiffText(rev.doc.amount, fin)}</span>}
            </div>
          )}
          {rev && fin != null && (
            <div className="qt-next">
              หลังแนบ: Forecast เป็น <b>{fmtMoney(fin)} บาท</b> · ฉบับที่ {rev.n} เก็บไว้เป็น “ฉบับเดิม” เปิดดูได้ ไม่นับยอด
              {qtStep.d ? ` · วันที่ของขั้น ${QUOTE_STAGE} ยังเป็น ${isoTh(qtStep.d)} (ส่งครั้งแรก)` : ''}
            </div>
          )}
          {after && !rev && <div className="sl-after">{after}</div>}
          {short && (
            <label className="sl-rf-full">
              <input type="checkbox" checked={fullOn} onChange={(ev) => setFull(ev.target.checked)} /> ถือว่ารับครบงวดนี้ (เช่น หัก ณ ที่จ่าย)
            </label>
          )}
          {saving && <span role="status" style={{ fontSize: 13, color: saving.startsWith('บันทึกไม่') ? 'var(--bad)' : 'var(--ink-2)' }}>{saving}</span>}
          <div className="dlg-act">
            <button onClick={onClose} className="quiet">ยกเลิก</button>
            {/* a revision is attached with its figure: it is the Forecast from now on */}
            {rev && fin == null && !badAmt && <span className="t-sec">ใส่ยอดในเอกสารก่อน จึงแนบเป็นฉบับแก้ไขได้</span>}
            {!badAmt && !(rev && fin == null) && (
              <button onClick={save} disabled={saving === 'กำลังบันทึก…'} className="btn pri">
                {jm ? 'แนบเอกสาร (ไม่นับยอด)' : rev ? `ยืนยันยอด ${fmtMoney(fin)} บาท และแนบเป็นฉบับที่ ${revN}` : g && choice === 'none' && fin != null ? `${stage ? 'แนบที่ ' + stage : 'แนบเอกสาร'} (ไม่นับยอดซ้ำ)` : fin != null ? `ยืนยันยอด ${fmtMoney(fin)} บาท และ${stage ? 'แนบที่ ' + stage : 'แนบเอกสาร'}` : 'แนบเอกสาร (ไม่ระบุยอด)'}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
