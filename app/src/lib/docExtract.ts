// PLACEHOLDER — replaced by the full implementation from branch wf/doc-extract (same signatures).
export type DocKind = 'quotation' | 'invoice' | 'receipt' | 'other';
export interface AmountCandidate { value: number; label: string; source: 'words' | 'keyword' | 'vat' | 'largest'; score: number; line: string }
export interface DocFacts { kind: DocKind | null; docNo: string; docDate: string; total: number | null; subtotal: number | null; vat: number | null; wht: number | null; netPay: number | null; words: number | null; party: string; candidates: AmountCandidate[]; confidence: 'high' | 'medium' | 'low' }
export function analyzeDocText(text: string): DocFacts {
  void text;
  return { kind: null, docNo: '', docDate: '', total: null, subtotal: null, vat: null, wht: null, netPay: null, words: null, party: '', candidates: [], confidence: 'low' };
}
export function bahtTextToNumber(s: string): number | null {
  void s;
  return null;
}
