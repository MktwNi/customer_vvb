import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../state';
import { dmTh, localDay, todayISO } from '../lib/format';
import { fmtMoney, hasPlan, type Deal, type SalesState } from '../lib/sales';
import { dayTh } from '../lib/cashUi';
import { chipOf, dealChecks, guardHits, noteOf, ymTh, type ChkRow, type GuardHit } from '../lib/payCheck';
import type { GccEngine } from '../lib/engine';
import { DialogActions, Modal } from './Dialog';

/**
 * The month check in the deal panel (cash impl-note "Follow-up: month check", screens 14 and 14b): the
 * accounting chip on each received installment ("ตรวจแล้ว · ฝน 1 ต.ค."), "บัญชีตรวจแล้ว 1 จาก 1 งวดที่รับ"
 * on the plan, a returned line's note where its recorder works, and the question asked before a checked
 * line (or one of a closed month) is cancelled or changed, from wherever it is changed (askPay).
 */

export function useDealChecks(d: Deal): ChkRow[] {
  const { engine: e } = useApp();
  return dealChecks(e.sales, d, e.payChecks(), e.payChkCfg().since, todayISO());
}

/** "ตรวจแล้ว · ฝน 1 ต.ค." / "รอตรวจ" / "ส่งกลับแก้ไข" (the quotation check's chips); nothing before the first
 *  month checked. */
export function PayChip({ r, bare }: { r: ChkRow | undefined; /** the chip alone (the summary strip) */ bare?: boolean }) {
  const c = r && chipOf(r);
  if (!c) return null;
  return (
    <span className="mc-chk" title={bare && c.meta ? `${c.word} · ${c.meta}` : undefined}>
      <span className={c.cls}>{c.word}</span>
      {!bare && c.meta && <span className="mc-meta">{c.meta}</span>}
    </span>
  );
}

/** The note under a received line: what accounting asked to fix, or what changed after its check. */
export function PayNote({ r }: { r: ChkRow | undefined }) {
  const { engine: e } = useApp();
  if (!r || (r.state !== 'back' && r.state !== 'changed')) return null;
  const n = noteOf(e.sales, r);
  if (!n) return null;
  return (
    <div className="mc-nbox">
      <span className="mc-nh">{n.head}</span>
      {n.body && <p>{n.body}</p>}
    </div>
  );
}

/** A deal without a plan: one chip under the strip's Actual for its received money (all checked, one sent
 *  back, else waiting). */
export function PayStripChip({ d }: { d: Deal }) {
  const { engine: e } = useApp();
  const rows = useDealChecks(d).filter((r) => r.kind === 'got' && r.state !== 'none');
  if (hasPlan(e.sales, d.id) || !rows.length) return null;
  const back = rows.find((r) => r.state === 'back');
  const wait = rows.find((r) => r.state === 'wait' || r.state === 'changed');
  return <PayChip r={back || wait || rows[rows.length - 1]} bare />;
}

/** A deal without a plan: its received money with the check, under the plan card's "ยังไม่มีแผน". */
export function PayNoPlan({ d }: { d: Deal }) {
  const rows = useDealChecks(d).filter((r) => r.kind === 'orphan' || r.state !== 'none');
  if (!rows.length) return null;
  return (
    <div className="mc-np">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="mc-np-r">
            <span>{r.kind === 'orphan' ? 'ยกเลิกหลังตรวจ' : 'รับ ' + dayTh(r.date)} · <b>{fmtMoney(r.amt)}</b> บาท{r.docs.length ? ' · ' + (r.docs[0].docNo || r.docs[0].name) : r.line?.src === 'typed' ? ' · พิมพ์เอง' : ''}</span>
            <PayChip r={r} />
          </div>
          <PayNote r={r} />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the question before changing a checked line

type GuardKind = 'cancel' | 'edit' | 'delete' | 'attach';
export interface PayAsk {
  d: Deal;
  /** the received lines the change may touch (their line ids), when its result can't be worked out first
   *  (a document still to be chosen in the attach dialog) */
  lines?: string[];
  /** the sales state as the change will leave it (lib/payCheck.ts previewOf): only a real change to a line's
   *  amount, date or evidence asks, and money landing in a closed month does too */
  after?: SalesState;
  kind: GuardKind;
  /** the title and the button: "ยกเลิกการรับเงิน PAY1" / "ยกเลิกการรับ" */
  title: string;
  verb: string;
  run: () => void;
  /** asked as before (window.confirm) when no line it touches is checked or in a closed month */
  plain?: string;
}
interface Pending { a: PayAsk; hits: GuardHit[] }
/** The one host on the page (App.tsx PayGuardHost) shows the question. */
let showAsk: ((p: Pending) => void) | null = null;

/** The question's lines for a change, from what this browser holds. */
export function payGuardHits(e: GccEngine, a: Pick<PayAsk, 'd' | 'lines' | 'after'>): GuardHit[] {
  const checks = e.payChecks(), since = e.payChkCfg().since, today = todayISO();
  const before = dealChecks(e.sales, a.d, checks, since, today);
  if (a.after) {
    const d2 = a.after.deals[a.d.id];
    return guardHits(before, e.monthCloses(), { after: d2 ? dealChecks(a.after, d2, checks, since, today) : [] });
  }
  return guardHits(before, e.monthCloses(), { lines: a.lines || [] });
}

/**
 * Ask before a change to received money accounting has checked (or sent back), or that is in or lands in a
 * closed month: what happens to the check (it waits again; money that stops counting shows as
 * "ยกเลิกหลังตรวจ" until accounting acknowledges it), then go ahead or not. Nothing to say: the change runs
 * at once (or after `plain`). Any part of the app calls it (the deal panel, the table, the step editors);
 * the dialog is App's PayGuardHost.
 */
export function askPay(e: GccEngine, a: PayAsk) {
  const hits = payGuardHits(e, a);
  if (!hits.length) {
    if (!a.plain || window.confirm(a.plain)) a.run();
    return;
  }
  if (showAsk) showAsk({ a, hits });
  // no host mounted (never on the app's pages): still ask
  else if (window.confirm(`${a.title}: ${hits.length} รายการที่บัญชีตรวจแล้วหรืออยู่ในเดือนที่ปิดแล้วจะต้องตรวจใหม่ · ${a.verb}?`)) a.run();
}
/** askPay for a component. */
export function usePayGuard(): { ask: (a: PayAsk) => void } {
  const { engine: e } = useApp();
  return { ask: (a) => askPay(e, a) };
}

/** What happens to one line, in words (screen 14b). */
function hitWords(a: PayAsk, h: GuardHit): ReactNode {
  const { r } = h;
  const rec = !h.added && (r.state === 'ok' || r.state === 'back') ? r.rec : null;
  const who = rec?.by || 'บัญชี';
  const month = ymTh(h.ym);
  const closeWords = h.close && <> · เดือน{month}ปิดแล้ว ({h.close.by || 'บัญชี'} {dmTh(localDay(h.close.at))}) {h.added ? 'บันทึกได้' : 'แก้ได้'} แต่เดือนนั้นจะมีรายการที่ต้องตรวจใหม่</>;
  if (h.added) return <>เงินนี้จะนับเป็นเงินเข้าเดือน{month}{closeWords}</>;
  if (a.kind === 'cancel')
    return <>ถ้ายกเลิก งวดนี้กลับเป็น “รอชำระ”{rec ? <> และ {who} จะเห็นรายการนี้ว่า “ยกเลิกหลังตรวจ” ในหน้า Cashflow เดือน{month} จนกว่าจะกดรับทราบ</> : ''}{closeWords}</>;
  if (h.gone)
    return <>ถ้า{a.verb} เงินงวดนี้จะไม่นับเป็นเงินเข้าแล้ว{rec ? <> และ {who} จะเห็นรายการนี้ว่า “ยกเลิกหลังตรวจ” ในหน้า Cashflow เดือน{month} จนกว่าจะกดรับทราบ</> : ''}{closeWords}</>;
  if (a.kind === 'delete')
    return <>ถ้าลบ ยอดหรือหลักฐานของงวดนี้จะเปลี่ยน{rec ? <> งวดนี้จะกลับเป็น “รอตรวจ” ให้ {who} ตรวจใหม่ (ถ้าไม่เหลือเงินรับ จะขึ้นว่า “ยกเลิกหลังตรวจ”)</> : ''}{closeWords}</>;
  if (a.kind === 'attach')
    return <>ถ้าแนบเอกสารที่นับยอดที่งวดนี้ ยอด วันที่รับ หรือหลักฐานของงวดนี้จะเปลี่ยน{rec ? <> งวดนี้จะกลับเป็น “รอตรวจ” และ {who} จะเห็นว่าเปลี่ยนอะไร</> : ''}{closeWords}</>;
  return <>ถ้าแก้ ยอด วันที่รับ หรือหลักฐานของงวดนี้จะเปลี่ยน{rec ? <> งวดนี้จะกลับเป็น “รอตรวจ” และ {who} จะเห็นว่าเปลี่ยนอะไร</> : ''}{closeWords}</>;
}

/** The question, once on the page (App.tsx), over the deal panel and the table alike. */
export function PayGuardHost() {
  const [cur, setCur] = useState<Pending | null>(null);
  useEffect(() => {
    showAsk = setCur;
    return () => {
      if (showAsk === setCur) showAsk = null;
    };
  }, []);
  if (!cur) return null;
  const { a, hits } = cur;
  return (
    <Modal title={a.title} onClose={() => setCur(null)} width={480} focus="dialog">
      <div className="mc-cf">
        {hits.map((h) => {
          const { r } = h;
          const rec = !h.added && (r.state === 'ok' || r.state === 'back') ? r.rec : null;
          return (
            <div key={r.key + (h.added ? '+' : '')} className="mc-cf">
              <p>
                {rec ? <>งวดนี้<b>{rec.s === 'ok' ? 'บัญชีตรวจแล้ว' : 'บัญชีส่งกลับแก้ไข'}</b> ({rec.by || 'บัญชี'} {dmTh(localDay(rec.at))}) · </> : null}
                {fmtMoney(r.amt)} บาท · รับ {dayTh(r.date)}
              </p>
              <div className="mc-nbox">
                <p>{hitWords(a, h)}</p>
                {a.kind === 'cancel' && rec && <span className="mc-nh">ถ้าแค่แก้ยอด วันที่รับ หรือแนบใบเสร็จ ไม่ต้องยกเลิก งวดนี้จะกลับเป็น “รอตรวจ” ให้บัญชีตรวจใหม่</span>}
              </div>
            </div>
          );
        })}
      </div>
      <DialogActions>
        <button type="button" className="quiet" onClick={() => setCur(null)}>ไม่{a.verb}</button>
        <button type="button" className="btn" onClick={() => (setCur(null), a.run())}>{a.verb}</button>
      </DialogActions>
    </Modal>
  );
}
