import { NO_UNIT_TH, type UnitCtx } from '../lib/contrib';

/** The colour class of a unit ('' = ยังไม่ระบุหน่วยงาน, textured grey): units.css .u0–.u4 / .ux. */
export const unitCls = (ctx: Pick<UnitCtx, 'units'>, id: string) => (id && ctx.units[id] ? 'u' + ctx.units[id].c : 'ux');

/** A unit's square and its name (the name always beside the colour). */
export function UnitName({ ctx, id, cls = '' }: { ctx: Pick<UnitCtx, 'units'>; id: string; cls?: string }) {
  const u = id ? ctx.units[id] : undefined;
  return (
    <span className={'un ' + cls}>
      <i className={'ud ' + unitCls(ctx, id)} aria-hidden="true" />
      <span className="un-n" title={(u ? u.n : NO_UNIT_TH) + (u?.off ? ' (เลิกใช้)' : '')}>
        {u ? u.n : NO_UNIT_TH}
        {/* the break before it, never inside it */}
        {u?.off && <> <span className="un-off">(เลิกใช้)</span></>}
      </span>
    </span>
  );
}
