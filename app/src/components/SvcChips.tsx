import { useId, useRef, useState } from 'react';
import { SVC_TYPE_LABEL, chipTitle, chipVars, svcGroups, svcType, typeOfService, type CustTypes } from '../lib/svcType';
import { NO_SVC, SVC_ADD, SVC_LABEL, addSvcName, svcClean, svcCount, svcKey, svcOptions, svcText } from '../lib/jobs';

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
 *  job without one (`none` false: nothing then). The word is always written: colour is never the only cue. `max`
 *  (a line of one row: the table, a list): the first `max` chips, then "อีก 2" in words, the whole list in the
 *  tooltip and for a screen reader, so a chip is never cut. */
export function JobSvc({ svc, none = true, className = '', label = true, max = 0 }: { svc: readonly string[]; none?: boolean; className?: string; label?: boolean; max?: number }) {
  const list = svcClean(svc);
  if (!list.length)
    return none ? (
      <span className={'svts js ' + className}>
        <span className="svt none" style={chipVars('none')} title="งานนี้ยังไม่ได้เลือกบริการ">{NO_SVC}</span>
      </span>
    ) : null;
  const shown = max > 0 && list.length > max ? list.slice(0, max) : list;
  const more = list.length - shown.length;
  return (
    <span className={'svts js ' + className} title={more ? `${SVC_LABEL} ${svcText(list)}` : undefined}>
      {/* (a screen reader hears "บริการ CFO" where no visible word says it already) */}
      {label && <span className="sr-only">{SVC_LABEL} </span>}
      {more > 0 && <span className="sr-only">{svcText(list)}</span>}
      {shown.map((x) => {
        const t = typeOfService(x) || 'oth';
        return <span key={x} className="svt" style={chipVars(t)} aria-hidden={more ? true : undefined} title={more ? undefined : `${SVC_LABEL} ${x} · ${SVC_TYPE_LABEL} ${svcType(t).n}`}>{x}</span>;
      })}
      {more > 0 && <span className="svt-more" aria-hidden="true">{`อีก ${more}`}</span>}
    </span>
  );
}

/**
 * The บริการ picker (the deal panel, เพิ่มลูกค้า, the send dialog): a formal checklist in a bordered panel. The
 * legend is `label`; the count line says how many are picked; the names are grouped under their type's plain
 * heading (lib/svcType.ts svcGroups), each a native checkbox, so Tab, Space and the state are the browser's.
 * `all`: the names offered (the team's list and every service a job holds, lib/jobs.ts svcChoices); `team`: the
 * team's list alone (it tells a name with no type, อื่นๆ, from one a salesperson added). The add field stores
 * a new name in the list at once (it is picked here, and a job's own value takes it on save); `disabled`
 * shows the list read-only with no add field. A name this panel added or ticked stays listed while it is open,
 * so the box a keyboard user just used is not removed under the cursor.
 */
export function SvcPick({ all, team, value, onChange, label = SVC_LABEL, disabled }: { all: readonly string[]; team: readonly string[]; value: readonly string[]; onChange: (v: string[]) => void; label?: string; disabled?: boolean }) {
  const uid = useId();
  const [kept, setKept] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState({ text: '', err: false });
  const input = useRef<HTMLInputElement>(null);
  const picked = svcClean(value);
  const on = new Set(picked.map(svcKey));
  // the job's own services stay listed even when the team's list no longer has them, so they can be taken off
  const opts = svcOptions(all, [...kept, ...picked]);
  const groups = svcGroups(opts, team);
  const pick = (x: string) => {
    const p = on.has(svcKey(x));
    setKept((k) => svcClean([...k, x]));
    onChange(p ? picked.filter((y) => svcKey(y) !== svcKey(x)) : svcClean([...picked, x]));
  };
  const add = () => {
    const r = addSvcName(text, opts, picked);
    setMsg({ text: r.msg, err: r.kind === 'empty' || r.kind === 'long' });
    if (r.name) setKept((k) => svcClean([...k, r.name]));
    if (r.kind === 'added' || r.kind === 'existing') setText('');
    if (r.value.length !== picked.length || r.value.some((x, i) => x !== picked[i])) onChange(r.value);
    input.current?.focus();
  };
  return (
    <fieldset className="svc-ck" disabled={disabled}>
      <legend>{label}</legend>
      <p className="svc-ck-count" aria-live="polite">{svcCount(picked.length)}</p>
      <div className="svc-ck-list">
        {groups.map((g) => (
          <div key={g.id} className="svc-ck-g" role="group" aria-labelledby={`${uid}-${g.id}`}>
            <div className="svc-ck-h">
              <b id={`${uid}-${g.id}`}>{g.title}</b>
              <span>{g.desc}</span>
            </div>
            {g.items.map((x) => (
              <label key={x} className="svc-ck-o">
                <input type="checkbox" checked={on.has(svcKey(x))} disabled={disabled} onChange={() => pick(x)} />
                <span>{x}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      {!disabled && (
        <div className="svc-ck-add">
          <div className="svc-ck-addhead">
            <label htmlFor={`${uid}-new`}>{SVC_ADD.label}</label>
            <span>{SVC_ADD.hint}</span>
          </div>
          <div className="svc-ck-row">
            <input
              id={`${uid}-new`}
              ref={input}
              type="text"
              value={text}
              placeholder={SVC_ADD.placeholder}
              autoComplete="off"
              onChange={(ev) => setText(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="btn sm" onClick={add}>{SVC_ADD.button}</button>
          </div>
          <p className={'svc-ck-msg' + (msg.err ? ' err' : '')} role="status">{msg.text}</p>
        </div>
      )}
    </fieldset>
  );
}
