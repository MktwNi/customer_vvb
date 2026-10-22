import { useEffect, useRef, useState } from 'react';
import { useApp, useEngineVersion, type ToastAct } from '../state';
import { fmtN, todayISO } from '../lib/format';
import { closeReady, dealResult, hasPlan, jointOf, jointRole, planOf, type Deal } from '../lib/sales';
import { jointCloseOf, jointLine } from '../lib/joint';
import { closeConfirm, closePrompt, jobName } from '../lib/salesUi';
import { errText } from '../lib/teamSync';
import { docById, qtSentView } from '../lib/notify';
import { refollowIds, refollowWord, undoSentNote } from '../lib/bulk';
import { planDayLink } from '../lib/planCal';
import { recvUndoText, undoReceive } from '../lib/attachPlan';
import { KEEP_HINT, KEEP_LABEL, RECONTACT_LABEL, keptLine, recontactErr, yearLater } from '../lib/recontact';
import { DialogActions, Modal } from './Dialog';
import { DateField } from './ui';
import { CycleDialog } from './CycleDialog';

/**
 * What the Sales Tracker's own actions say, and closing a job (tracker spec §1): the table, the phone
 * cards, the deal panel and the attach dialog all go through these, so a job closes the same way
 * everywhere and the closing prompt follows only this user's own actions (a teammate's change never asks).
 */
export function useSalesActs() {
  const { engine: e, set } = useApp();
  /** One message at the bottom; `ms` 0 = it stays until acted on. */
  const say = (text: string, o: { acts?: ToastAct[]; ms?: number } = {}) => set((s) => ({ slToast: { text, acts: o.acts, ms: o.ms ?? 4000, n: (s.slToast?.n || 0) + 1 } }));
  /** "รับชำระครบทุกงวดแล้ว ปิดงาน X เลยไหม?" with ปิดงาน / ไว้ก่อน; the deal's panel asks in its closing card too.
   *  A joint quotation is named by its payer and its quotation, with its companies: they close as one (its ปิดงาน
   *  opens the joint dialog), as the message after closing says. */
  const prompt = (d: Deal, via: 'result' | 'payment') => {
    const g = jointRole(e.sales, d) === 'header' ? jointOf(e.sales, d) : null;
    const open = g ? g.members.filter((x) => x.deal.jobStatus === 'open').length : 0;
    const name = g ? `${jointLine(e.sales, g, true)}${open ? ` และ ${fmtN(open)} บริษัท` : ''}` : jobName(d);
    say(closePrompt(e.sales, d, name, via), { ms: 0, acts: [{ label: 'ปิดงาน', act: 'close', deal: d.id, primary: true }, { label: 'ไว้ก่อน', act: 'dismiss' }] });
    set({ slPrompt: d.id });
  };
  /** After this user's own change: ask to close when it just made the deal ready, else say `done`. A
   *  company of a joint quotation is never asked about on its own: it closes with the whole quotation. */
  const after = (d: Deal, wasReady: boolean, via: 'result' | 'payment', done = '') => {
    if (!wasReady && d.jobStatus === 'open' && jointRole(e.sales, d) !== 'member' && closeReady(e.sales, d, todayISO())) prompt(d, via);
    else if (done) say(done);
  };
  /** The result was just saved: NO (or a won deal with nothing left to receive) asks to close; a win
   *  without a plan offers to set one up; a win with a plan says its due dates now count from today. */
  const afterResult = (d: Deal, wasReady: boolean) => {
    const today = todayISO(), r = dealResult(e.sales, d);
    // a company in a joint quotation has no plan of its own (the payer pays the whole quotation), and closes
    // with the whole quotation: never on its own, so it is not asked about
    if (jointRole(e.sales, d) === 'member') return r === 'YES' || r === 'NO' ? say(`${r === 'YES' ? 'ได้งานแล้ว' : 'บันทึกว่าไม่ได้งานแล้ว'} · ปิดงานพร้อมกันทั้งใบเสนอราคาร่วม`) : undefined;
    if (!wasReady && d.jobStatus === 'open' && closeReady(e.sales, d, today)) return prompt(d, 'result');
    if (r !== 'YES') return;
    if (!hasPlan(e.sales, d.id)) {
      if (!e.canDeal('edit.pay', d)) return;
      say('ได้งานแล้ว ตั้งแผนชำระเลยไหม? (ผลการขายยังไม่ใช่การปิดงาน)', { ms: 0, acts: [{ label: 'ตั้งแผนชำระ', act: 'plan', deal: d.id, primary: true }, { label: 'ไว้ก่อน', act: 'dismiss' }] });
    } else say(`ได้งานแล้ว · แผนชำระ ${planOf(e.sales, d, today)?.n} งวดเริ่มนับวันครบกำหนดจากวันนี้`);
  };
  /** Close a job (the ปิดงาน action). A joint quotation always asks, from its header or any of its companies: it
   *  closes as one (components/JointQt.tsx JointClose). A single job asks how: plain ปิดงาน, or ปิดแต่เก็บไว้ติดตาม
   *  on a date (CloseJobDialog). */
  const close = (id: string) => {
    const d = e.sales.deals[id];
    if (!d || !e.canDeal('edit.deal', d)) return;
    const hid = jointCloseOf(e.sales, d);
    if (hid) return set({ jqDlg: { k: 'close', hid }, slPrompt: null, slToast: null });
    set({ slConfirm: id, slPrompt: null, slToast: null });
  };
  /** Move the job to the ปิดงาน tab; `keep`: the date it is kept to contact again ('' = a plain ปิดงาน). */
  const closeNow = (id: string, keep = '') => {
    const d = e.sales.deals[id];
    if (!d) return;
    e.updateDeal(id, keep ? { jobStatus: 'closed', recontact: keep } : { jobStatus: 'closed' });
    if (e.sales.deals[id]?.jobStatus !== 'closed') return; // refused (an account that can only read)
    set((s) => {
      const open = { ...s.slOpen };
      delete open[id];
      return {
        slOpen: open, slPrompt: null, slConfirm: null,
        deal: s.deal === id ? null : s.deal,
        slEdit: s.slEdit?.id === id ? null : s.slEdit,
        slToast: { text: `ย้าย ${jobName(d)} ไปแท็บปิดงานแล้ว` + (keep ? ` · ${keptLine(keep)}` : ''), ms: 8000, n: (s.slToast?.n || 0) + 1, acts: [{ label: 'ดูแท็บปิดงาน', act: 'closedTab', primary: true }, { label: 'เลิกทำ', act: 'undo', deal: id }] },
      };
    });
  };
  return { say, prompt, after, afterResult, close, closeNow };
}

/**
 * The bottom message (a polite live region, so it is read out) and the question asked before closing a
 * job that is not finished. Mounted once, beside the deal panel, so both the table and the panel use it.
 */
export function SalesMessages() {
  const { engine: e, ui, set, go } = useApp();
  useEngineVersion();
  const acts = useSalesActs();
  const t = ui.slToast;
  const box = useRef<HTMLDivElement>(null);
  // what the team script did about a quotation this account just attached or edited: who was mailed, or why
  // nobody was (a question waiting at the bottom keeps its place: the bell has it too)
  const fresh = e.qtFresh;
  useEffect(() => {
    if (!fresh) return;
    const doc = docById(e.sales, fresh.id), o = doc && e.qtSentFor(doc);
    if (!doc || !o || (ui.slToast && !ui.slToast.ms)) return;
    const ctx = e.qtSentCtx(), admin = ctx.admin;
    const w = qtSentView(o, ctx);
    acts.say(`${doc.docNo || 'ใบเสนอราคา'} · ${w.text}`, { ms: 9000, ...(w.fix && admin ? { acts: [{ label: w.fix === 'checker' ? 'ตั้งผู้ตรวจ' : 'ดูการแจ้งเตือน', act: 'notify' as const }, { label: 'ปิด', act: 'dismiss' as const }] } : {}) });
  }, [fresh?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // a message goes after its time unless the pointer or the keyboard is on it (then when it leaves). Asked
  // of the message itself at each tick: a flag set on mouseenter / focus would stay set when the message is
  // removed under the pointer (its link clicked: ดูบริษัทที่ติดตาม, ดูตารางปี …), and hold every later one.
  useEffect(() => {
    if (!t || !t.ms) return;
    const n = t.n;
    const h = setInterval(() => !box.current?.matches(':hover, :focus-within') && set((s) => (s.slToast?.n === n ? { slToast: null } : {})), t.ms);
    return () => clearInterval(h);
  }, [t?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (a: ToastAct) => {
    if (a.act === 'close' && a.deal) return acts.close(a.deal);
    if (a.act === 'closedTab') return go('sales', { slView: 'closed', slToast: null });
    // the search page's bulk actions: where the companies went
    // (บริษัทที่ติดตาม, first on the ติดตาม page: tabs/TrackFollow.tsx, id track-watch; a day of แผนติดต่อ with
    // every customer and type shown, lib/planCal.ts planDayLink)
    if (a.act === 'goTrack') {
      go('track', { slToast: null, sel: null });
      return void requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('track-watch')?.scrollIntoView({ block: 'start' })));
    }
    // a bulk unfollow taken back (BulkBar): exactly the ids it took off go back on the list (lib/bulk.ts refollowIds)
    if (a.act === 'refollow' && a.ids) return acts.say(refollowWord(refollowIds(e, a.ids)), { ms: 4000 });
    // a send just made, taken back (engine.undoSent: within 10 minutes, rows nobody has worked on since)
    if (a.act === 'sendUndo' && a.k) return acts.say(undoSentNote(e.undoSent(a.k)), { ms: 6000 });
    if (a.act === 'goSales') return go('sales', { slView: 'table', ...(a.year ? { slYear: a.year } : {}), slToast: null, sel: null });
    if (a.act === 'goPlan') return go('plan', { ...(a.day ? planDayLink(a.day) : {}), slToast: null, sel: null });
    if (a.act === 'plan' && a.deal) return set({ deal: a.deal, dpPlan: 'edit', slToast: null });
    // nobody could be told about a quotation: the admin's page says why, and who checks
    if (a.act === 'notify') return go('users', { usersSec: 'notify', slToast: null, deal: null });
    // a quotation check taken back (the script allows it for 10 minutes, for the checker's own latest)
    if (a.act === 'qtUndo' && a.k) {
      const doc = e.sales.docs[a.k];
      set({ slToast: null });
      if (doc)
        e.qtCheck(doc, 'undo').then(
          () => acts.say(`เลิกทำแล้ว ${doc.docNo || 'ใบเสนอราคา'} กลับเป็น “รอตรวจ”`, { ms: 4000 }),
          (x) => acts.say('เลิกทำไม่สำเร็จ: ' + errText(x, 'connect'), { ms: 6000 }),
        );
      return;
    }
    // the joint quotation just closed here: back as it was (the companies' results recorded then too)
    if (a.act === 'jqUndo' && a.deal) {
      const n = e.undoCloseJoint(a.deal);
      return acts.say(n ? 'เปิดใบเสนอราคาร่วมและบริษัทที่ปิดพร้อมกันอีกครั้งแล้ว' : e.teamNote || 'ไม่มีรายการให้เปิดอีกครั้ง', { ms: n ? 3000 : 6000 });
    }
    // the month check: this account's checks just made (engine.lastPayChecks), for 10 minutes
    if (a.act === 'payUndo') {
      const n = e.lastPayChecks ? e.undoPayChecks(e.lastPayChecks.keys) : 0;
      return acts.say(n ? `เลิกทำแล้ว ${n} รายการกลับเป็น “รอตรวจ”` : 'เลิกทำได้ภายใน 10 นาทีหลังตรวจ และเฉพาะรายการที่คุณตรวจเอง', { ms: 4000 });
    }
    // the same for money out (engine.lastExpChecks)
    if (a.act === 'expUndo') {
      const n = e.lastExpChecks ? e.undoExpChecks(e.lastExpChecks.keys) : 0;
      return acts.say(n ? `เลิกทำแล้ว ${n} รายการเงินออกกลับเป็น “รอตรวจ”` : 'เลิกทำได้ภายใน 10 นาทีหลังตรวจ และเฉพาะรายการที่คุณตรวจเอง', { ms: 4000 });
    }
    // "รับเงินแล้ว (ไม่มีไฟล์)" in one tap (lib/attachPlan receiveNow): its amount and date in the plan's form,
    // or taken back as it was before (the plan the tap set up, the amount it asked for) — unless the line
    // was changed since (a teammate's correction synced in): that is never undone over
    if (a.act === 'recvEdit' && a.deal && a.k) return set({ deal: a.deal, dpPlan: `recv:${a.k}`, slToast: null });
    if (a.act === 'recvUndo' && a.recv) {
      const u = a.recv, d = e.sales.deals[u.deal];
      if (!d) return set({ slToast: null });
      const r = undoReceive(e, u);
      set({ slPrompt: null });
      if (r.stale.length) return acts.say(recvUndoText(e.sales, d, u, r), { ms: 8000, acts: [{ label: 'แก้ยอด / วันที่', act: 'recvEdit', deal: u.deal, k: u.stage }] });
      return acts.say(recvUndoText(e.sales, d, u, r), { ms: 4000 });
    }
    if (a.act === 'undo' && a.deal) {
      e.updateDeal(a.deal, { jobStatus: 'open' });
      const d = e.sales.deals[a.deal];
      return acts.say(d ? `เปิดงาน ${jobName(d)} อีกครั้งแล้ว` : 'เปิดงานอีกครั้งแล้ว', { ms: 3000 });
    }
    set({ slToast: null, slPrompt: null });
  };
  const ask = ui.slConfirm ? e.sales.deals[ui.slConfirm] : undefined;
  return (
    <>
      {/* (centred in the deal panel while it is open) */}
      <div className={'sl-live' + (ui.deal ? ' in-dp' : '')} role="status" aria-live="polite">
        {t && (
          <div className="sl-toast" key={t.n} ref={box}>
            <span>{t.text}</span>
            {t.acts?.map((a) => (
              <button key={a.label} type="button" className={a.primary ? 'p' : ''} onClick={() => run(a)}>{a.label}</button>
            ))}
            {!t.acts?.length && (
              <button type="button" className="x" aria-label="ปิดข้อความ" onClick={() => set({ slToast: null })}>×</button>
            )}
          </div>
        )}
      </div>
      {ask && <CloseJobDialog d={ask} onClose={() => set({ slConfirm: null })} />}
      {ui.cycleDlg && <CycleDialog id={ui.cycleDlg} />}
    </>
  );
}

/**
 * Closing a single job (the ปิดงาน action): the question when it is not finished yet (closeConfirm), then the
 * choice. ปิดงาน closes it as it always did; ปิดแต่เก็บไว้ติดตาม closes it and keeps the date to contact again
 * (lib/recontact.ts): the date is a real one, today or later, a year on when nothing is changed.
 */
function CloseJobDialog({ d, onClose }: { d: Deal; onClose: () => void }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const today = todayISO();
  const [keep, setKeep] = useState(false);
  const [date, setDate] = useState(() => yearLater(today));
  const name = jobName(d);
  const q = closeConfirm(e.sales, d, today, name);
  const err = keep ? recontactErr(date, today) : '';
  return (
    <Modal title="ปิดงานตอนนี้?" onClose={onClose} focus="dialog">
      {/* a form, so Enter on the choice confirms (display: contents keeps the dialog's layout) */}
      <form style={{ display: 'contents' }} onSubmit={(ev) => { ev.preventDefault(); if (!err) acts.closeNow(d.id, keep ? date : ''); }}>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{q || `งาน “${name}” พร้อมปิดแล้ว งานจะย้ายไปแท็บปิดงาน เปิดกลับได้`}</p>
        <fieldset className="cl-how">
          <legend>วิธีปิดงาน</legend>
          <label className="cl-opt">
            <input type="radio" name="close-how" checked={!keep} onChange={() => setKeep(false)} />
            <span><b>ปิดงาน</b><small>งานจะย้ายไปแท็บปิดงาน</small></span>
          </label>
          <label className="cl-opt">
            <input type="radio" name="close-how" checked={keep} onChange={() => setKeep(true)} />
            <span><b>{KEEP_LABEL}</b><small>{KEEP_HINT}</small></span>
          </label>
        </fieldset>
        {keep && (
          <div className="cl-date">
            <span>{RECONTACT_LABEL}</span>
            <DateField value={date} onChange={setDate} label={RECONTACT_LABEL} min={today} />
            {err && <small role="alert" className="t-warn">{err}</small>}
          </div>
        )}
        <DialogActions>
          <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="btn pri" disabled={!!err}>{keep ? KEEP_LABEL : 'ปิดงาน'}</button>
        </DialogActions>
      </form>
    </Modal>
  );
}
