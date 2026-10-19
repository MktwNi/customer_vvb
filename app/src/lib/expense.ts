/**
 * Job expenses ("ค่าใช้จ่ายของงาน"): per deal, the money that went out for it (a contractor or outside
 * consultant, travel, TGO fees, a lab…), so a deal can read "เงินเข้า 100,000 · ค่าใช้จ่าย 35,000 · คงเหลือ
 * 65,000". Pure (no DOM), so it is unit-tested; this step holds the records, the screens come next.
 *
 * - One record per expense, `dexp/<dealId>/<expId>` = { c, n?, amt, d, paid?, file?, by, at } (team-sync/Code.gs):
 *   c = the category as typed (free text up to 40 characters, no fixed list: the screens suggest the ones
 *   already used), n = a description (up to 200), amt = baht as on the bill (VAT included), d = the bill's date,
 *   paid = the day it was paid (none: not paid yet), file = the bill, uploaded like a document (docId
 *   `exp_<expId>`), by / at = who wrote it last and when (the team script sets both for every account but an
 *   admin). `expId` is made in the browser, like every record id.
 * - Its history rows are `dlog/exp.<id>` (in SalesState.log); accounting's check of a paid expense is
 *   `dchk/<dealId>/exp.<expId>` = the income check's record with d = the paid date and f = the bill's file id
 *   (SalesState.xchk, apart from the income checks so they never read as cancelled income lines), and a
 *   month's expenses closed `mclose/<YYYY-MM>/out` = { by, at, n, amt } (SalesState.mcloseOut).
 * - Capabilities (lib/caps.ts): ดูค่าใช้จ่ายและกำไรของงาน (view.exp; the team script sends none of these rows
 *   to an account without it) and บันทึกค่าใช้จ่ายของงาน (edit.exp; own work = the deal's ผู้รับผิดชอบ).
 *   Accounting checks them with ตรวจยืนยันรับเงิน (pay.check), as it checks money received.
 */
import type { SalesState } from './sales';

/** The bill of an expense: the uploaded file as the team's Drive keeps it. */
export interface ExpFile { id: string; name: string; mime: string; size: number }
/** `dexp/<dealId>/<expId>`. */
export interface JobExp { c: string; n?: string; amt: number; d: string; paid?: string; file?: ExpFile; by: string; at: string }
/** An expense with where it belongs. */
export interface DealExp extends JobExp { id: string; deal: string }

/** A category is at most this long; a description this long. */
export const EXP_CAT_MAX = 40;
export const EXP_NOTE_MAX = 200;
/** The document id an expense's bill is uploaded under (the team script lets บันทึกค่าใช้จ่ายของงาน upload it). */
export const expDocId = (expId: string) => 'exp_' + expId;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null);
/** A real calendar day 'YYYY-MM-DD' at the start of `v` (30 Feb is not one: Date.parse would roll it over). */
const isDay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d/.test(v)) return false;
  const t = Date.parse(v.slice(0, 10) + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v.slice(0, 10);
};

/** A pulled `dexp/` value, checked like every record from the team sheet: one that has no amount is skipped
 *  (null); fields that are not what they should be are left out. */
export function toExpense(v: unknown): JobExp | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const amt = num(x.amt);
  if (amt == null) return null;
  const out: JobExp = { c: str(x.c, EXP_CAT_MAX).replace(/\s+/g, ' ').trim(), amt, d: isDay(x.d) ? x.d.slice(0, 10) : '', by: str(x.by, 100), at: str(x.at, 40) };
  const n = str(x.n, EXP_NOTE_MAX).trim();
  if (n) out.n = n;
  if (isDay(x.paid)) out.paid = x.paid.slice(0, 10);
  const f = x.file && typeof x.file === 'object' && !Array.isArray(x.file) ? (x.file as Record<string, unknown>) : null;
  if (f && typeof f.id === 'string' && /^[\w-]{1,200}$/.test(f.id)) out.file = { id: f.id, name: str(f.name, 150) || 'บิล', mime: str(f.mime, 100), size: Math.max(0, num(f.size) ?? 0) };
  return out;
}

/** A deal's expenses, by the bill's date (undated last), then when they were written. */
export function expensesOf(s: Pick<SalesState, 'exp'>, dealId: string): DealExp[] {
  const pre = dealId + '/';
  return Object.entries(s.exp || {})
    .filter(([k]) => k.startsWith(pre) && k.length > pre.length)
    .map(([k, e]) => ({ ...e, id: k.slice(pre.length), deal: dealId }))
    .sort((a, b) => (a.d || '9999').localeCompare(b.d || '9999') || a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** Everything about job expenses this browser holds (the account may no longer see them); whether there was any. */
export function purgeExpenses(s: SalesState): boolean {
  let n = Object.keys(s.exp || {}).length + Object.keys(s.xchk || {}).length + Object.keys(s.mcloseOut || {}).length;
  delete s.exp;
  delete s.xchk;
  delete s.mcloseOut;
  Object.keys(s.log || {}).forEach((k) => {
    if (!k.startsWith('exp.')) return;
    delete s.log[k];
    n++;
  });
  return n > 0;
}
