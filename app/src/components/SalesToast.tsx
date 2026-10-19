import { useEffect, useRef } from 'react';
import { useApp, useEngineVersion, type ToastAct } from '../state';
import { todayISO } from '../lib/format';
import { closeReady, dealResult, hasPlan, jointRole, planOf, type Deal } from '../lib/sales';
import { closeConfirm, closePrompt, shortName } from '../lib/salesUi';
import { errText } from '../lib/teamSync';
import { docById, qtSentView } from '../lib/notify';
import { DialogActions, Modal } from './Dialog';

/**
 * What the Sales Tracker's own actions say, and closing a job (tracker spec §1): the table, the phone
 * cards, the deal panel and the attach dialog all go through these, so a job closes the same way
 * everywhere and the closing prompt follows only this user's own actions (a teammate's change never asks).
 */
export function useSalesActs() {
  const { engine: e, set } = useApp();
  /** One message at the bottom; `ms` 0 = it stays until acted on. */
  const say = (text: string, o: { acts?: ToastAct[]; ms?: number } = {}) => set((s) => ({ slToast: { text, acts: o.acts, ms: o.ms ?? 4000, n: (s.slToast?.n || 0) + 1 } }));
  /** "รับชำระครบทุกงวดแล้ว ปิดงาน X เลยไหม?" with ปิดงาน / ไว้ก่อน; the deal's panel asks in its closing card too. */
  const prompt = (d: Deal, via: 'result' | 'payment') => {
    say(closePrompt(e.sales, d, shortName(d.client), via), { ms: 0, acts: [{ label: 'ปิดงาน', act: 'close', deal: d.id, primary: true }, { label: 'ไว้ก่อน', act: 'dismiss' }] });
    set({ slPrompt: d.id });
  };
  /** After this user's own change: ask to close when it just made the deal ready, else say `done`. */
  const after = (d: Deal, wasReady: boolean, via: 'result' | 'payment', done = '') => {
    if (!wasReady && d.jobStatus === 'open' && closeReady(e.sales, d, todayISO())) prompt(d, via);
    else if (done) say(done);
  };
  /** The result was just saved: NO (or a won deal with nothing left to receive) asks to close; a win
   *  without a plan offers to set one up; a win with a plan says its due dates now count from today. */
  const afterResult = (d: Deal, wasReady: boolean) => {
    const today = todayISO();
    if (!wasReady && closeReady(e.sales, d, today)) return prompt(d, 'result');
    if (dealResult(e.sales, d) !== 'YES') return;
    // a company in a joint quotation has no plan of its own: the payer pays the whole quotation
    if (jointRole(e.sales, d) === 'member') return say('ได้งานแล้ว · การชำระเงินอยู่ที่ใบเสนอราคาร่วม (ผู้จ่ายชำระทั้งใบ)');
    if (!hasPlan(e.sales, d.id)) {
      if (!e.canDeal('edit.pay', d)) return;
      say('ได้งานแล้ว ตั้งแผนชำระเลยไหม? (ผลการขายยังไม่ใช่การปิดงาน)', { ms: 0, acts: [{ label: 'ตั้งแผนชำระ', act: 'plan', deal: d.id, primary: true }, { label: 'ไว้ก่อน', act: 'dismiss' }] });
    } else say(`ได้งานแล้ว · แผนชำระ ${planOf(e.sales, d, today)?.n} งวดเริ่มนับวันครบกำหนดจากวันนี้`);
  };
  /** Move a finished job to the ปิดงาน tab: at once when it is ready, else after asking. A joint quotation
   *  always asks: it closes its companies too (components/JointQt.tsx JointClose). */
  const close = (id: string) => {
    const d = e.sales.deals[id];
    if (!d || !e.canDeal('edit.deal', d)) return;
    if (jointRole(e.sales, d) === 'header') return set({ jqDlg: { k: 'close', hid: id }, slPrompt: null, slToast: null });
    if (closeReady(e.sales, d, todayISO())) closeNow(id);
    else set({ slConfirm: id });
  };
  const closeNow = (id: string) => {
    const d = e.sales.deals[id];
    if (!d) return;
    e.updateDeal(id, { jobStatus: 'closed' });
    if (e.sales.deals[id]?.jobStatus !== 'closed') return; // refused (an account that can only read)
    set((s) => {
      const open = { ...s.slOpen };
      delete open[id];
      return {
        slOpen: open, slPrompt: null, slConfirm: null,
        deal: s.deal === id ? null : s.deal,
        slEdit: s.slEdit?.id === id ? null : s.slEdit,
        slToast: { text: `ย้าย ${shortName(d.client)} ไปแท็บปิดงานแล้ว`, ms: 8000, n: (s.slToast?.n || 0) + 1, acts: [{ label: 'ดูแท็บปิดงาน', act: 'closedTab', primary: true }, { label: 'เลิกทำ', act: 'undo', deal: id }] },
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
  const held = useRef(false);
  // what the team script did about a quotation this account just attached or edited: who was mailed, or why
  // nobody was (a question waiting at the bottom keeps its place: the bell has it too)
  const fresh = e.qtFresh;
  useEffect(() => {
    if (!fresh) return;
    const doc = docById(e.sales, fresh.id), o = doc && e.qtSentFor(doc);
    if (!doc || !o || (ui.slToast && !ui.slToast.ms)) return;
    const admin = e.can('set.users');
    const w = qtSentView(o, { admin, checker: e.can('qt.check') });
    acts.say(`${doc.docNo || 'ใบเสนอราคา'} · ${w.text}`, { ms: 9000, ...(w.fix && admin ? { acts: [{ label: w.fix === 'checker' ? 'ตั้งผู้ตรวจ' : 'ดูการแจ้งเตือน', act: 'notify' as const }, { label: 'ปิด', act: 'dismiss' as const }] } : {}) });
  }, [fresh?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // a message goes after its time unless the pointer or the keyboard is on it (then when it leaves)
  useEffect(() => {
    if (!t || !t.ms) return;
    const n = t.n;
    const h = setInterval(() => !held.current && set((s) => (s.slToast?.n === n ? { slToast: null } : {})), t.ms);
    return () => clearInterval(h);
  }, [t?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (a: ToastAct) => {
    if (a.act === 'close' && a.deal) return acts.close(a.deal);
    if (a.act === 'closedTab') return go('sales', { slView: 'closed', slToast: null });
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
    if (a.act === 'jqUndo' && a.deal) {
      e.reopenJoint(a.deal);
      return acts.say('เปิดใบเสนอราคาร่วมและบริษัทที่ปิดพร้อมกันอีกครั้งแล้ว', { ms: 3000 });
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
    if (a.act === 'undo' && a.deal) {
      e.updateDeal(a.deal, { jobStatus: 'open' });
      const d = e.sales.deals[a.deal];
      return acts.say(d ? `เปิดงาน ${shortName(d.client)} อีกครั้งแล้ว` : 'เปิดงานอีกครั้งแล้ว', { ms: 3000 });
    }
    set({ slToast: null, slPrompt: null });
  };
  const ask = ui.slConfirm ? e.sales.deals[ui.slConfirm] : undefined;
  const q = ask ? closeConfirm(e.sales, ask, todayISO(), shortName(ask.client)) : '';
  return (
    <>
      {/* (centred in the deal panel while it is open) */}
      <div className={'sl-live' + (ui.deal ? ' in-dp' : '')} role="status" aria-live="polite">
        {t && (
          <div className="sl-toast" key={t.n} onMouseEnter={() => (held.current = true)} onMouseLeave={() => (held.current = false)} onFocus={() => (held.current = true)} onBlur={() => (held.current = false)}>
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
      {ask && (
        <Modal title="ปิดงานตอนนี้?" onClose={() => set({ slConfirm: null })} focus="dialog">
          <p style={{ margin: 0, lineHeight: 1.6 }}>{q || `ปิดงาน “${shortName(ask.client)}” ตอนนี้? งานจะย้ายไปแท็บปิดงาน เปิดกลับได้`}</p>
          <DialogActions>
            <button type="button" className="quiet" onClick={() => set({ slConfirm: null })}>ยกเลิก</button>
            <button type="button" className="btn pri" onClick={() => acts.closeNow(ask.id)}>ปิดงาน</button>
          </DialogActions>
        </Modal>
      )}
    </>
  );
}
