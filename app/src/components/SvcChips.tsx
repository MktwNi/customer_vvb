import { SVC_TYPE_LABEL, chipTitle, chipVars, svcType, type CustTypes } from '../lib/svcType';

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
