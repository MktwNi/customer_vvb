import { useState, type ReactNode } from 'react';
import { useApp } from '../state';
import { dmTh, localDay, todayISO } from '../lib/format';
import { fmtMoney, hasPlan, type Deal } from '../lib/sales';
import { dayTh } from '../lib/cashUi';
import { chipOf, dealChecks, noteOf, ymTh, type ChkRow, type MonthClose } from '../lib/payCheck';
import { DialogActions, Modal } from './Dialog';

/**
 * The month check in the deal panel (cash impl-note "Follow-up: month check", screens 14 and 14b): the
 * accounting chip on each received installment ("ตรวจแล้ว · ฝน 1 ต.ค."), "บัญชีตรวจแล้ว 1 จาก 1 งวดที่รับ"
 * on the plan, a returned line's note where its recorder works, and the question asked before a checked
 * line (or one of a closed month) is cancelled or changed.
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

type GuardKind = 'cancel' | 'edit' | 'delete';
interface Ask {
  d: Deal;
  /** the received lines the change touches (their line ids) */
  lines: string[];
  kind: GuardKind;
  /** the title and the button: "ยกเลิกการรับเงิน PAY1" / "ยกเลิกการรับ" */
  title: string;
  verb: string;
  run: () => void;
  /** asked as before (window.confirm) when no line it touches is checked or in a closed month */
  plain?: string;
}
interface Hit { r: ChkRow; close: MonthClose | null }

/**
 * Ask before a change to received money accounting has checked (or that falls in a closed month): what
 * happens to the check (it waits again; a cancelled receipt shows as "ยกเลิกหลังตรวจ" until accounting
 * acknowledges it), then go ahead or not. Nothing to say: the change runs at once (or after `plain`).
 * Returns `ask` and the dialog to render.
 */
export function usePayGuard(): { ask: (a: Ask) => void; node: ReactNode } {
  const { engine: e } = useApp();
  const [cur, setCur] = useState<{ a: Ask; hits: Hit[] } | null>(null);
  const ask = (a: Ask) => {
    const closes = e.monthCloses();
    const rows = dealChecks(e.sales, a.d, e.payChecks(), e.payChkCfg().since, todayISO());
    const hits = rows
      .filter((r) => r.kind === 'got' && a.lines.includes(r.lineId))
      .map((r) => ({ r, close: closes[r.ym] || null }))
      .filter((h) => h.r.state === 'ok' || h.r.state === 'back' || h.close);
    if (!hits.length) {
      if (!a.plain || window.confirm(a.plain)) a.run();
      return;
    }
    setCur({ a, hits });
  };
  const node = cur && (
    <Modal title={cur.a.title} onClose={() => setCur(null)} width={480} focus="dialog">
      <div className="mc-cf">
        {cur.hits.map(({ r, close }) => {
          const rec = r.state === 'ok' || r.state === 'back' ? r.rec : null;
          const who = rec?.by || 'บัญชี';
          const month = ymTh(r.ym);
          return (
            <div key={r.key} className="mc-cf">
              <p>
                {rec ? (
                  <>งวดนี้<b>{rec.s === 'ok' ? 'บัญชีตรวจแล้ว' : 'บัญชีส่งกลับแก้ไข'}</b> ({who} {dmTh(localDay(rec.at))}) · </>
                ) : null}
                {fmtMoney(r.amt)} บาท · รับ {dayTh(r.date)}
              </p>
              <div className="mc-nbox">
                <p>
                  {cur.a.kind === 'cancel'
                    ? <>ถ้ายกเลิก งวดนี้กลับเป็น “รอชำระ”{rec ? <> และ {who} จะเห็นรายการนี้ว่า “ยกเลิกหลังตรวจ” ในหน้า Cashflow เดือน{month} จนกว่าจะกดรับทราบ</> : ''}</>
                    : cur.a.kind === 'delete'
                      ? <>ถ้าลบ ยอดหรือหลักฐานของงวดนี้จะเปลี่ยน{rec ? <> งวดนี้จะกลับเป็น “รอตรวจ” ให้ {who} ตรวจใหม่ (ถ้าไม่เหลือเงินรับ จะขึ้นว่า “ยกเลิกหลังตรวจ”)</> : ''}</>
                      : <>ถ้าแก้ ยอดหรือหลักฐานของงวดนี้จะเปลี่ยน{rec ? <> งวดนี้จะกลับเป็น “รอตรวจ” และ {who} จะเห็นว่าเปลี่ยนอะไร</> : ''}</>}
                  {close && <> · เดือน{month}ปิดแล้ว ({close.by || 'บัญชี'} {dmTh(localDay(close.at))}) แก้ได้ แต่เดือนนั้นจะมีรายการที่ต้องตรวจใหม่</>}
                </p>
                {cur.a.kind === 'cancel' && rec && <span className="mc-nh">ถ้าแค่แก้ยอด วันที่รับ หรือแนบใบเสร็จ ไม่ต้องยกเลิก งวดนี้จะกลับเป็น “รอตรวจ” ให้บัญชีตรวจใหม่</span>}
              </div>
            </div>
          );
        })}
      </div>
      <DialogActions>
        <button type="button" className="quiet" onClick={() => setCur(null)}>ไม่{cur.a.verb}</button>
        <button type="button" className="btn" onClick={() => (setCur(null), cur.a.run())}>{cur.a.verb}</button>
      </DialogActions>
    </Modal>
  );
  return { ask, node };
}
