import { useEffect, useRef, useState } from 'react';
import { useApp, useEngineVersion, type ToastAct } from '../state';
import { todayISO } from '../lib/format';
import { attachStage, stepCode, type Deal } from '../lib/sales';
import { receiveNow, recvOverText, recvPlan, recvToast, type AttachEntry } from '../lib/attachPlan';
import { attachLines, previewOf } from '../lib/payCheck';
import { DOC_ACCEPT } from '../lib/teamFiles';
import { prefs } from '../lib/storage';
import { askPay } from './PayChk';
import { DocAttach } from './DocAttach';
import { useSalesActs } from './SalesToast';

/**
 * One picker for every attach button (lib/attachPlan AttachEntry): the button opens the browser's own file
 * picker at once — no empty dialog first — and the dialog (DocAttach) opens with the file read. Mounted once
 * (App.tsx), beside the pay guard, so the deal panel, the table and the phone cards share it. The input is
 * clicked within the click that asked for it (a browser opens a picker only then); it has no `capture`, so a
 * phone offers the camera and its files alike.
 */
interface Cur { deal: string; entry: AttachEntry; file: File; n: number }
let host: { pick: (deal: string, entry: AttachEntry) => void; show: (deal: string, entry: AttachEntry, file: File) => void } | null = null;

export function AttachHost() {
  const { engine: e } = useApp();
  useEngineVersion();
  const [cur, setCur] = useState<Cur | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pend = useRef<{ deal: string; entry: AttachEntry } | null>(null);
  const n = useRef(0);
  useEffect(() => {
    // the per-browser memory of the figure last confirmed ("รวม VAT / ก่อน VAT / หลังหัก") is gone: the amount
    // is what the customer pays, the same on every computer (lib/docAmount)
    prefs.del('gcc-doc-basis');
    const me = {
      pick: (deal: string, entry: AttachEntry) => {
        const el = input.current;
        if (!el) return;
        pend.current = { deal, entry };
        el.value = ''; // the same file picked again still opens the dialog
        el.click();
      },
      show: (deal: string, entry: AttachEntry, file: File) => setCur({ deal, entry, file, n: ++n.current }),
    };
    host = me;
    return () => {
      if (host === me) host = null;
    };
  }, []);
  const d = cur ? e.sales.deals[cur.deal] : undefined;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={DOC_ACCEPT}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-attach-input=""
        onChange={(ev) => {
          const f = ev.target.files?.[0], p = pend.current;
          pend.current = null;
          if (f && p) setCur({ ...p, file: f, n: ++n.current });
        }}
      />
      {cur && d && <DocAttach key={cur.n} deal={d} entry={cur.entry} file={cur.file} onClose={() => setCur(null)} />}
    </>
  );
}

/**
 * `open(deal, entry)`: the picker straight from the click (after the pay guard's question, when accounting
 * checked that installment or its month is closed); `drop(deal, entry, file)`: a file dropped on a card or
 * the panel; `recv(deal, stage, typed?, o?)`: "รับเงินแล้ว (ไม่มีไฟล์)" in one tap — 'ask' when there is no
 * amount to record and the caller asks for it in place (`o.inline`: the PAY card); else the plan's form
 * "แก้ยอด / วันที่" opens ('form': part paid already, or no planned amount); 'over' when the job's money
 * already makes up its plan (nothing recorded, a message says why); else 'done'.
 */
export function useAttach() {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const guard = (d: Deal, entry: AttachEntry, run: () => void) => {
    const S = e.sales;
    const stage = entry.at === 'pay' ? entry.stage ?? (attachStage(S, d, { kind: 'receipt', target: 'actual' }, todayISO()) || undefined) : undefined;
    const lines = entry.at === 'pay' ? attachLines(S, d.id, stage, 'receipt', 'actual') : [];
    askPay(e, { d, lines, kind: 'attach', title: 'แนบเอกสาร' + (stage ? ' ' + stepCode(S, d, stage, todayISO()) : ''), verb: 'แนบเอกสาร', run });
  };
  const open = (d: Deal, entry: AttachEntry) => guard(d, entry, () => host?.pick(d.id, entry));
  const drop = (d: Deal, entry: AttachEntry, file: File) => guard(d, entry, () => host?.show(d.id, entry, file));
  const form = (d: Deal, stage: string) => set({ deal: d.id, dpPlan: `recv:${stage}`, slToast: null });
  const recv = (d: Deal, stage: string, typed?: number | null, o: { inline?: boolean } = {}): 'ask' | 'form' | 'over' | 'done' => {
    const today = todayISO(), S = e.sales;
    const r = recvPlan(S, d, stage, today);
    if (!r) return form(d, stage), 'form';
    if (r.over) {
      // the money of this job is in already (an earlier receipt counted more than its installment, say):
      // one tap would count it again — the form is there for money that really came in on top
      acts.say(recvOverText(S, d, r), { ms: 12000, acts: [{ label: 'แก้ยอด / วันที่', act: 'recvEdit', deal: d.id, k: stage }] });
      return 'over';
    }
    if (r.ask && !(typed != null && typed > 0)) {
      if (o.inline) return 'ask';
      // (a line with no planned amount: the form asks for it; no plan at all: the PAY card does)
      if (r.plan) set({ deal: d.id, dpPlan: '', slToast: null });
      else form(d, stage);
      return 'form';
    }
    const ask = r.plan ? { lines: attachLines(S, d.id, undefined, 'receipt', 'actual') } : { after: previewOf.pay(S, d.id, stage, { rcv: today, got: r.ask ? typed! : r.amount, full: false }) };
    askPay(e, {
      d, ...ask, kind: 'edit', title: 'บันทึกรับเงิน ' + stepCode(S, d, stage, today), verb: 'บันทึกรับเงิน',
      run: () => {
        const x = receiveNow(e, d.id, stage, today, typed);
        const dd = e.sales.deals[d.id];
        if (!x || !dd) return;
        const tacts: ToastAct[] = [
          ...(x.ready ? [{ label: 'ปิดงาน', act: 'close' as const, deal: d.id, primary: true }] : []),
          { label: 'แก้ยอด / วันที่', act: 'recvEdit', deal: d.id, k: x.stage },
          { label: 'เลิกทำ', act: 'recvUndo', deal: d.id, k: x.stage, recv: x.undo, primary: !x.ready },
        ];
        if (x.ready) set({ slPrompt: d.id });
        acts.say(recvToast(e.sales, dd, x.stage, x.amount) + (x.ready ? ' · รับครบทุกงวดแล้ว' : ''), { ms: 12000, acts: tacts });
      },
    });
    return 'done';
  };
  return { open, drop, recv };
}
