import type { CSSProperties } from 'react';
import { SVC_TYPE_LABEL, chipTitle, chipVars, svcType, typeOfService, type CustTypes } from '../lib/svcType';
import { NO_SVC, SVC_LABEL, svcClean, svcKey } from '../lib/jobs';
import { Tick } from './Pop';

/** A company's service types (lib/svcType.ts) as calm chips beside its name: each type's word in its ink on
 *  its tint, in list order ("CFO", "ทวนสอบ"; several when its jobs are of several types). The word is always
 *  written, so the colour is never the only cue; the tooltip says which Services it was read from. */
export function SvcChips({ ct }: { ct: CustTypes }) {
  return (
    <span className="svts">
      <span className="sr-only">{SVC_TYPE_LABEL} </span>
      {ct.types.map((id) => (
        <span key={id} className={'svt' + (id === 'none' ? ' none' : '')} style={chipVars(id)} title={chipTitle(id, ct)}>
          {svcType(id).n}
        </span>
      ))}
    </span>
  );
}

/** A job's services as chips: each service's own word ("CFP", "Course Training") in its type's ink on its tint
 *  (the plan page's colours, lib/svcType.ts), in the order the job lists them; "ยังไม่ระบุบริการ" in grey for a
 *  job without one (`none` false: nothing then). The word is always written: colour is never the only cue. */
export function JobSvc({ svc, none = true, className = '', label = true }: { svc: readonly string[]; none?: boolean; className?: string; label?: boolean }) {
  const list = svcClean(svc);
  if (!list.length)
    return none ? (
      <span className={'svts js ' + className}>
        <span className="svt none" style={chipVars('none')} title="งานนี้ยังไม่ได้เลือกบริการ">{NO_SVC}</span>
      </span>
    ) : null;
  return (
    <span className={'svts js ' + className}>
      {/* (a screen reader hears "บริการ CFO" where no visible word says it already) */}
      {label && <span className="sr-only">{SVC_LABEL} </span>}
      {list.map((x) => {
        const t = typeOfService(x) || 'oth';
        return <span key={x} className="svt" style={chipVars(t)} title={`${SVC_LABEL} ${x} · ${SVC_TYPE_LABEL} ${svcType(t).n}`}>{x}</span>;
      })}
    </span>
  );
}

/** The บริการ picker (the send dialog, เพิ่มลูกค้า, the deal panel): the team's services as toggle buttons; a
 *  picked one in its type's colours with a check (the word is always there). Several may be picked: one job
 *  quoted together. */
export function SvcPick({ all, value, onChange, label = SVC_LABEL, disabled }: { all: readonly string[]; value: readonly string[]; onChange: (v: string[]) => void; label?: string; disabled?: boolean }) {
  const on = new Set(value.map(svcKey));
  // a service the job holds that the team's list no longer has stays shown, so it can be taken off
  const opts = svcClean([...all, ...value]);
  return (
    <div className="svp" role="group" aria-label={label}>
      {opts.map((x) => {
        const p = on.has(svcKey(x)), t = typeOfService(x) || 'oth', T = svcType(t);
        return (
          <button
            key={x}
            type="button"
            aria-pressed={p}
            disabled={disabled}
            className={'svp-o' + (p ? ' on' : ' hv')}
            style={{ '--k': T.ink, '--kb': T.tint, '--km': T.mark } as CSSProperties}
            onClick={() => onChange(p ? value.filter((y) => svcKey(y) !== svcKey(x)) : svcClean([...value, x]))}
          >
            {p && <Tick size={14} />}
            <span>{x}</span>
          </button>
        );
      })}
    </div>
  );
}
