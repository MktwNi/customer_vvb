import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApp } from '../state';
import { dmTh, isoTh, todayISO } from '../lib/format';
import { ACT_TH, ACT_TYPES, NOTE_MAX, actStage, planLines, type ActType, type Deal, type DealAct, type SalesState } from '../lib/sales';
import { DateChip } from './DateChip';

/**
 * Contacts beyond the stages ("บันทึกการติดต่อ"): the stages are milestones (CALL1 = the first call);
 * every further call, e-mail or meeting is a record of its own (lib/sales.ts DealAct). Shared by the
 * table (Sales.tsx draws its own row), the deal panel and the phone card. Words for the type, no icons.
 */

/** Stages a contact can belong to: the list, then installments of the plan beyond it ("PAY3"). */
export function actStages(S: SalesState, d: Deal) {
  const extra = (planLines(S, d) || []).filter((x) => !x.inList).map((x) => x.stage);
  return [...S.cfg.stages, ...extra];
}

/** The quick-add's state: type (โทร), date (today), note, stage (where the deal is) and person. Enter
 *  saves; `save` returns the record (null when nothing was saved). */
export function useActForm(d: Deal, stage0?: string) {
  const { engine: e } = useApp();
  const today = todayISO();
  const [type, setType] = useState<ActType>('call');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [stage, setStage] = useState(() => stage0 || actStage(e.sales, d, today));
  const [pid, setPid] = useState('');
  const save = () => e.addAct(d.id, { type, note, d: date, stage, pid });
  return { type, setType, date, setDate, note, setNote, stage, setStage, pid, setPid, save, today };
}
export type ActFormState = ReturnType<typeof useActForm>;

/** โทร / อีเมล / นัดพบ / LINE / อื่นๆ as one segmented control. */
export function ActTypeSeg({ f }: { f: ActFormState }) {
  return (
    <span className="seg sl-seg2 sl-af-ty" role="group" aria-label="ประเภทการติดต่อ">
      {ACT_TYPES.map((t) => (
        <button key={t} type="button" aria-pressed={f.type === t} onClick={() => f.setType(t)}>{ACT_TH[t]}</button>
      ))}
    </span>
  );
}
export function ActStageSel({ f, d, label = 'ขั้น' }: { f: ActFormState; d: Deal; label?: string }) {
  const { engine: e } = useApp();
  const list = actStages(e.sales, d);
  return (
    <label className="sl-af-l">
      {label}
      <select className="fld sel" value={f.stage} onChange={(ev) => f.setStage(ev.target.value)} aria-label="ขั้นที่การติดต่อนี้อยู่">
        {[...new Set([...list, f.stage])].map((p) => <option key={p} value={p}>{p || 'ไม่ระบุขั้น'}</option>)}
      </select>
    </label>
  );
}

/** The form in the deal panel and the phone card: type and date, the note (Enter saves, Escape
 *  cancels), the stage and, when the company has people on record, who it was with. */
export function ActForm({ d, stage, onDone, compact }: { d: Deal; stage?: string; onDone: (a: DealAct | null) => void; compact?: boolean }) {
  const { engine: e } = useApp();
  const f = useActForm(d, stage);
  const people = d.gid != null ? e.peopleOf(d.gid).filter((p) => p.status !== 'left') : [];
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.closest('.sl-af')?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const save = () => onDone(f.save());
  const keys = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      onDone(null);
    }
  };
  return (
    <div className={'sl-af' + (compact ? ' compact' : '')} role="group" aria-label="บันทึกการติดต่อ" onKeyDown={keys}>
      <div className="sl-af-r">
        <ActTypeSeg f={f} />
        <DateChip value={f.date} onChange={f.setDate} label="วันที่ติดต่อ" text={f.date === f.today ? 'วันนี้ ' + isoTh(f.date) : undefined} />
      </div>
      <input
        ref={input}
        className="fld"
        value={f.note}
        maxLength={NOTE_MAX}
        placeholder="คุยอะไร ได้ข้อมูลอะไร นัดอะไรต่อ"
        aria-label="โน้ตการติดต่อ"
        onChange={(ev) => f.setNote(ev.target.value)}
        onKeyDown={(ev) => ev.key === 'Enter' && (ev.preventDefault(), save())}
      />
      <div className="sl-af-r">
        <ActStageSel f={f} d={d} />
        {people.length > 0 && (
          <label className="sl-af-l">
            กับ
            <select className="fld sel" value={f.pid} onChange={(ev) => f.setPid(ev.target.value)} aria-label="ผู้ติดต่อ">
              <option value="">ไม่ระบุ</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <span className="sl-af-a">
          <button type="button" className="quiet" onClick={() => onDone(null)}>ยกเลิก</button>
          <button type="button" className="btn pri xs" onClick={save}>บันทึก</button>
        </span>
      </div>
    </div>
  );
}

/** One contact as a small entry: the type word, the date, who wrote it, the note; "ลบ" for its author
 *  (or an admin). `stage`: also say which stage it belongs to. */
export function ActItem({ a, stage, short }: { a: DealAct; stage?: boolean; short?: boolean }) {
  const { engine: e } = useApp();
  const who = a.pid ? e.people[a.pid]?.name : '';
  const meta = [short ? dmTh(a.d) : isoTh(a.d), stage && a.stage, who && 'กับ ' + who, a.by].filter(Boolean).join(' · ');
  return (
    <li className="sl-act">
      <span className="sl-act-h">
        <b>{ACT_TH[a.type]}</b>
        <span>{meta}</span>
        {e.canDelAct(a) && (
          <button type="button" className="quiet sl-act-x" onClick={() => window.confirm(`ลบการติดต่อนี้? (${ACT_TH[a.type]} ${isoTh(a.d)})`) && e.delAct(a.deal, a.id)} aria-label={`ลบการติดต่อ ${ACT_TH[a.type]} ${isoTh(a.d)}`}>ลบ</button>
        )}
      </span>
      {a.note && <span className="sl-act-n">{a.note}</span>}
    </li>
  );
}
/** A list of contacts, newest first: the first `max`, then "ทั้งหมด n". */
export function ActList({ acts, max, stage, short, label, children }: { acts: DealAct[]; max?: number; stage?: boolean; short?: boolean; label: string; children?: ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all || !max ? acts : acts.slice(0, max);
  if (!acts.length && !children) return null;
  return (
    <ul className="sl-acts" aria-label={label}>
      {shown.map((a) => <ActItem key={a.id} a={a} stage={stage} short={short} />)}
      {max != null && acts.length > max && (
        <li className="sl-acts-more"><button type="button" className="lnk" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'แสดงน้อยลง' : `ทั้งหมด ${acts.length}`}</button></li>
      )}
      {children}
    </ul>
  );
}
