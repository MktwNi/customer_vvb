import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApp } from '../state';
import { dmTh, isoTh, todayISO } from '../lib/format';
import { ACT_TH, ACT_TYPES, NOTE_MAX, actStage, dealSteps, stepLabel, stepWords, type ActType, type Deal, type DealAct, type SalesState, type StepEntry } from '../lib/sales';
import { OLD_TH, stepIdOf } from '../lib/steps';
import type { GccEngine } from '../lib/engine';
import { actPeople } from '../lib/people';
import { DateChip } from './DateChip';
import { Select } from './Select';

/**
 * Contacts ("บันทึกการติดต่อ"): every call, e-mail or meeting is a record of its own (lib/sales.ts DealAct),
 * filed at the step it belongs to (CONTACT ติดต่อประสานงาน, FOLLOW ติดตามผล …) and shown inside that step. Shared
 * by the table (Sales.tsx draws its own row), the deal panel and the phone card. Words for the type, no icons.
 */

/** The steps a contact can belong to: the deal's steps in order ("CONTACT ติดต่อประสานงาน", …, "PAY1 ชำระงวดที่ 1"),
 *  an installment outside the plan too (it still shows, with what is filed there). */
export function actStages(S: SalesState, d: Deal, today: string): { v: string; label: string }[] {
  return dealSteps(S, d, today).steps.map((v) => ({ v: v.id, label: stepWords({ code: v.code, th: v.th.replace(/\s*\(YES \/ NO\)$/, '') }) }));
}

/** Who a contact record of `d` may be with ("กับ"): the deal's contacts first, then the company's other people
 *  still there; `pid` the default, the deal's main contact (lib/people.ts actPeople), unless they are at another
 *  company now (engine contactElsewhere: chosen each time, the card says so). */
export const actWith = (e: GccEngine, d: Deal) => actPeople(e.dealPeople(d.id), e.dealPool(d), (p) => e.contactElsewhere(d, p));

/** The quick-add's state: type (โทร), date (today), note, stage (where the deal is) and person (the deal's
 *  contact). Enter saves; `save` returns the record (null when nothing was saved). */
export function useActForm(d: Deal, stage0?: string) {
  const { engine: e } = useApp();
  const today = todayISO();
  const [type, setType] = useState<ActType>('call');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [stage, setStage] = useState(() => stage0 || actStage(e.sales, d, today));
  const [pid, setPid] = useState(() => actWith(e, d).pid);
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
  const list = actStages(e.sales, d, f.today);
  const id = useId();
  // a stage no step of the deal has now (an older one, CALL2): it reads as the step it belongs to
  const own = f.stage && !list.some((x) => x.v === f.stage) ? [{ v: f.stage, label: stepWords(stepLabel(e.sales, d, f.stage, f.today)) }] : [];
  return (
    <div className="sl-af-l">
      <span id={id}>{label}</span>
      <Select className="sm" labelledBy={id} label="ขั้นที่การติดต่อนี้อยู่" value={f.stage} onChange={f.setStage} width={260} options={[...list, ...own, ...(f.stage ? [] : [{ v: '', label: 'ไม่ระบุขั้น' }])]} />
    </div>
  );
}

/** The form in the deal panel and the phone card: type and date, the note (Enter saves, Escape
 *  cancels), the stage and, when the deal has a contact or the company has people on record, who it was
 *  with (the deal's contact to begin with). */
export function ActForm({ d, stage, onDone, compact }: { d: Deal; stage?: string; onDone: (a: DealAct | null) => void; compact?: boolean }) {
  const { engine: e } = useApp();
  const f = useActForm(d, stage);
  const people = actWith(e, d).list;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.closest('.sl-af')?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const save = () => onDone(f.save());
  const withId = useId();
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
          <div className="sl-af-l">
            <span id={withId}>กับ</span>
            <Select className="sm" labelledBy={withId} label="ผู้ติดต่อ" value={f.pid} onChange={f.setPid} width={240} options={[{ v: '', label: 'ไม่ระบุ' }, ...people.map((p) => ({ v: p.id, label: p.name, sub: e.contactElsewhere(d, p) ? 'อยู่ที่ ' + (e.personCompany(p)?.name || p.company || 'บริษัทอื่น') : undefined }))]} />
          </div>
        )}
        <span className="sl-af-a">
          <button type="button" className="quiet" onClick={() => onDone(null)}>ยกเลิก</button>
          <button type="button" className="btn pri xs" onClick={save}>บันทึก</button>
        </span>
      </div>
    </div>
  );
}

/** "ลบ" on a contact (asked first). Its row goes, so the keyboard stays close: the next contact's "ลบ" in
 *  the same table, panel or card (else the one before), else the nearest "บันทึกการติดต่อ" — the stage's
 *  own, the panel's, or the deal's row. */
export function delActFocus(e: GccEngine, a: DealAct, btn: HTMLElement) {
  if (!window.confirm(`ลบการติดต่อนี้? (${ACT_TH[a.type]} ${isoTh(a.d)})`)) return;
  const scope: ParentNode = btn.closest('.dp, .sl-mc, table') || document;
  const mine = (x: Element) => (x as HTMLElement).dataset.delAct?.startsWith(a.deal + '/');
  const dels = [...scope.querySelectorAll<HTMLElement>('[data-del-act]')].filter(mine);
  const i = dels.indexOf(btn);
  const near = dels.slice(i + 1).concat(dels.slice(0, Math.max(0, i)).reverse()).find((x) => x.dataset.delAct !== btn.dataset.delAct)?.dataset.delAct;
  e.delAct(a.deal, a.id);
  requestAnimationFrame(() => {
    const q = (sel: string) => scope.querySelector<HTMLElement>(sel);
    const to = (near && q(`[data-del-act="${CSS.escape(near)}"]`)) || q(`[data-act-at="${CSS.escape(a.stage)}"]`) || q(`[data-act-at="${CSS.escape(stepIdOf(a.stage))}"]`) || q('[data-act-at=""]') || document.querySelector<HTMLElement>(`[data-qa="${CSS.escape(a.deal + ':act')}"]`);
    to?.focus();
  });
}

/** The code of the step a contact is filed at ("CALL2" reads as CONTACT, an installment as the deal names it). */
export const actCode = (S: SalesState, a: Pick<DealAct, 'deal' | 'stage'>, today = todayISO()) => (a.stage ? stepLabel(S, S.deals[a.deal] || null, a.stage, today).code : '');

/** One contact as a small entry: the type word, the date, who wrote it, the note; "ลบ" for its author
 *  (or an admin). `stage`: also say which step it belongs to. */
export function ActItem({ a, stage, short }: { a: DealAct; stage?: boolean; short?: boolean }) {
  const { engine: e } = useApp();
  const who = a.pid ? e.people[a.pid]?.name : '';
  const meta = [short ? dmTh(a.d) : isoTh(a.d), stage && actCode(e.sales, a), who && 'กับ ' + who, a.by].filter(Boolean).join(' · ');
  return (
    <li className="sl-act">
      <span className="sl-act-h">
        <b>{ACT_TH[a.type]}</b>
        <span>{meta}</span>
        {e.canDelAct(a) && (
          <button type="button" className="quiet sl-act-x" data-del-act={a.deal + '/' + a.id} onClick={(ev) => delActFocus(e, a, ev.currentTarget)} aria-label={`ลบการติดต่อ ${ACT_TH[a.type]} ${isoTh(a.d)}`}>ลบ</button>
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

/** What an older stage's record was, as the eight-stage tracker named it: CALL1, CALL2 a call (โทร), FOLLOW1,
 *  FOLLOW2 a follow-up (ติดตาม). */
export const oldWord = (stage: string) => (/^CALL/i.test(stage) ? 'โทร' : /^FOLLOW/i.test(stage) ? 'ติดตาม' : 'บันทึก');

/** An older stage's record inside the step that reads it ("โทร · 25 ก.ย. 2569 · บันทึกเดิม CALL2"): the note as it
 *  was; "แก้ไข" (`onEdit`) edits it where it is stored, as a browser still on the older build would. */
export function OldItem({ x, short, onEdit }: { x: StepEntry; short?: boolean; onEdit?: (stage: string) => void }) {
  const n = x.step?.n || '';
  return (
    <li className="sl-act sl-act-old">
      <span className="sl-act-h">
        <b>{oldWord(x.stage)}</b>
        <span title={OLD_TH[x.stage] ? `${x.stage} ${OLD_TH[x.stage]}` : x.stage}>{[x.d ? (short ? dmTh(x.d) : isoTh(x.d)) : 'ไม่ระบุวันที่', 'บันทึกเดิม ' + x.stage].join(' · ')}</span>
        {onEdit && (
          <button type="button" className="quiet sl-act-x" data-old-at={x.stage} onClick={() => onEdit(x.stage)} aria-label={`แก้ไขบันทึกเดิม ${x.stage}${x.d ? ' ' + isoTh(x.d) : ''}`}>แก้ไข</button>
        )}
      </span>
      {n && <span className="sl-act-n">{n}</span>}
    </li>
  );
}

/**
 * The entries inside a step, newest first: its contact records and the older stages' records it reads (CALL2,
 * CALL1 in CONTACT). The first `max`, then "ดูอีก n ครั้ง"; `add` (the step's "บันทึกการติดต่อเพิ่ม") on the same
 * line. `onEditOld`: "แก้ไข" on an older stage's record.
 */
export function StepEntries({ entries, max, label, short, onEditOld, add }: { entries: StepEntry[]; max?: number; label: string; short?: boolean; onEditOld?: (stage: string) => void; add?: ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all || !max ? entries : entries.slice(0, max);
  const hidden = entries.length - shown.length;
  return (
    <>
      {entries.length > 0 && (
        <ul className="sl-acts" aria-label={label}>
          {shown.map((x) => (x.kind === 'act' && x.act ? <ActItem key={'a' + x.act.id} a={x.act} short={short} /> : <OldItem key={'o' + x.stage} x={x} short={short} onEdit={onEditOld} />))}
        </ul>
      )}
      {(hidden > 0 || (all && max != null && entries.length > max) || add) && (
        <span className="sl-tl-more">
          {hidden > 0 && <button type="button" className="lnk" aria-expanded={false} onClick={() => setAll(true)}>ดูอีก {hidden} ครั้ง</button>}
          {all && max != null && entries.length > max && <button type="button" className="lnk" aria-expanded onClick={() => setAll(false)}>แสดงน้อยลง</button>}
          {add}
        </span>
      )}
    </>
  );
}
