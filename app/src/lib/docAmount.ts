/**
 * The figure a read document is counted at (the attach dialog's one amount, lib/attachPlan): small and
 * pure, apart from the reader (lib/docExtract, loaded only when a file is picked) so the dialog's rules can
 * use it from the main bundle. docExtract re-exports both functions; its API is unchanged.
 */

/** Usual withholding-tax rates (also the reader's own check of a "หัก ณ ที่จ่าย" figure). */
export const WHT_RATES = [0.01, 0.015, 0.02, 0.03, 0.05, 0.1];

/** The money fields of a read document (lib/docExtract DocFacts). */
export interface NetFacts {
  total: number | null;
  subtotal: number | null;
  vat: number | null;
  wht: number | null;
  netPay: number | null;
  deduct?: number;
}

/** Withholding tax at a usual rate (1–10 %) of what it is taken from — the amount before VAT, or the
 *  total for a seller outside VAT, less a deposit already paid — within a baht (rounded on the document). */
function whtFits(w: number, f: NetFacts, dd: number) {
  const T = f.total!, vat = f.vat ?? (f.subtotal != null ? T - f.subtotal : null);
  const bases = [f.subtotal, vat != null ? T - vat : null, T / 1.07, T].filter((b): b is number => b != null && b > 0);
  return bases.flatMap((b) => (dd ? [b, b - dd, b - dd / 1.07] : [b])).some((b) => b > 0 && WHT_RATES.some((r) => Math.abs(b * r - w) <= Math.max(1, b * r * 0.005)));
}
/**
 * What the customer pays now, as the document shows it, when its figures add up: the total less withholding
 * tax at a usual rate and/or less money already paid (หักเงินมัดจำ), equal to the amount payable printed (or
 * the balance line) to the satang. null otherwise — no deduction shown, a "WHT" that is a rate or a form
 * number in a note, or an amount payable misread — and the total is then the safer figure.
 */
export function netOf(f: NetFacts): { wht: number; deduct: number; net: number } | null {
  const T = f.total, N = f.netPay;
  if (T == null || N == null || !(N > 0) || N > T - 0.005) return null;
  const w = f.wht != null && f.wht > 0 ? f.wht : 0, dd = f.deduct != null && f.deduct > 0 ? f.deduct : 0;
  if (!w && !dd) return null;
  if (Math.abs(T - w - dd - N) > 0.02) return null;
  if (w && !whtFits(w, f, dd)) return null;
  return { wht: w, deduct: dd, net: N };
}

/**
 * The figure proposed for a document: what the customer actually pays. When the document shows
 * withholding tax and / or a deposit already paid, and the amount payable after them, and the three add up
 * ("61,730.77 − หัก ณ ที่จ่าย 1,730.77 = ยอดชำระ 60,000": netOf), that net amount — the money that comes in;
 * else the total including VAT; without one, the best amount found ('manual'). The same rule for a
 * quotation (Forecast) as for an invoice or receipt (Actual), so the two stay comparable: a job quoted at
 * 60,000 after withholding is received as 60,000.
 * `follow`: the quotation version a revision follows ("แนบฉบับแก้ไข"): the figure equal to its amount, else
 * the one at its basis, so the same price at the same basis never reads as a price change.
 */
export function proposedAmount(
  f: NetFacts & { candidates: { value: number }[] },
  follow?: { basis: 'total' | 'subtotal' | 'netPay' | 'manual'; amount: number | null },
): { basis: 'total' | 'subtotal' | 'netPay' | 'manual'; value: number | null } {
  if (follow) {
    const by = { netPay: f.netPay, total: f.total, subtotal: f.subtotal } as const;
    const same = (['total', 'netPay', 'subtotal'] as const).find((b) => by[b] != null && follow.amount != null && Math.abs(by[b]! - follow.amount) < 0.005);
    if (same) return { basis: same, value: by[same] };
    if (follow.basis !== 'manual' && by[follow.basis] != null) return { basis: follow.basis, value: by[follow.basis] };
  }
  if (netOf(f)) return { basis: 'netPay', value: f.netPay };
  if (f.total != null) return { basis: 'total', value: f.total };
  return { basis: 'manual', value: f.candidates[0]?.value ?? null };
}
