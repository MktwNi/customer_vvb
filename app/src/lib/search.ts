import type { Cert, Company, FeedKey } from './types';
import type { GccEngine } from './engine';

/** Search-tab filters. '' = no filter. Selects hold dictionary indices as strings. */
export interface Filters {
  view: 'co' | 'cert';
  q: string; tgt: string; src: string; ind: string; prov: string; type: string; cfo: string; gi: string; ph: string; inv: string;
  feed: FeedKey | ''; ym: string; rnd: string; stage: string; owner: string; sort: string;
  // certificate-level filters set from the CFO dashboard
  expM: string; cInd: string; cFy: string; cProv: string;
}
export const EMPTY_FILTERS: Filters = {
  view: 'co', q: '', tgt: '', src: '', ind: '', prov: '', type: '', cfo: '', gi: '', ph: '', inv: '', feed: '', ym: '', rnd: '', stage: '', owner: '', sort: 'default',
  expM: '', cInd: '', cFy: '', cProv: '',
};
/** Everything except view/sort — used by "ล้างตัวกรอง". */
export const CLEAR_FILTERS: Partial<Filters> = {
  expM: '', cInd: '', cFy: '', cProv: '', q: '', tgt: '', src: '', ind: '', prov: '', type: '', cfo: '', gi: '', ph: '', inv: '', feed: '', ym: '', rnd: '', stage: '', owner: '',
};

function matchCo(e: GccEngine, c: Company, s: Filters, q: string[] | null, skipTgt: boolean, skipCfo = false) {
  const C = e.crm;
  if (!skipTgt && s.tgt !== '' && c.tgt !== +s.tgt) return false;
  if (s.src !== '' && !(c.src & (1 << +s.src))) return false;
  if (s.ind !== '' && c.ind !== +s.ind) return false;
  if (s.prov !== '' && c.prov !== +s.prov) return false;
  if (s.type !== '' && c.type !== +s.type) return false;
  if (!skipCfo && s.cfo && c.cfoSt !== s.cfo) return false;
  if (s.gi) {
    if (s.gi === '35') {
      if (!((c.giLive || 0) >= 3)) return false;
    } else if (s.gi === 'none') {
      if (c.giMax) return false;
    } else if (c.giLive !== +s.gi) return false;
  }
  if (s.ph === '1' && !c.hasPh) return false;
  if (s.ph === '0' && c.hasPh) return false;
  if (s.inv && !((c.invest || 0) >= +s.inv)) return false;
  if (s.feed && !c.fl[s.feed]) return false;
  if (s.ym && c.newYm !== s.ym) return false;
  if (s.rnd && c.rndKey !== s.rnd) return false;
  if (s.stage && (C.stages[c.id] || 'none') !== s.stage) return false;
  if (s.owner && (s.owner === '-' ? !!C.owners[c.id] : C.owners[c.id] !== s.owner)) return false;
  if (q) for (const w of q) if (!c.hay.includes(w)) return false;
  return true;
}

export interface FilterResult { out: (Company | Cert)[]; tc: number[]; ph: number }

/**
 * Applies the filters. `tc` counts matches per target group ignoring the target-group
 * filter itself (for the chips). In certificate view, company filters apply to the
 * certificate's owner and query words may match either the certificate or the company.
 */
export function filterAll(e: GccEngine, s: Filters): FilterResult {
  const q = s.q.toLowerCase().split(/\s+/).filter(Boolean);
  const tc = Array(9).fill(0);
  if (s.view === 'cert') {
    const certs: Cert[] = [];
    e.B.certs.forEach((ct) => {
      const c = ct.co;
      if (!c) return;
      if (s.cfo && ct.st !== s.cfo) return;
      if (s.expM && ct.exM !== s.expM) return;
      if (s.cInd !== '' && String(ct.ind) !== s.cInd) return;
      if (s.cFy && ct.yr !== s.cFy) return;
      if (s.cProv && ct.provName !== s.cProv) return;
      const qq = q.filter((w) => !ct.hay.includes(w));
      if (!matchCo(e, c, s, qq.length ? qq : null, true, true)) return;
      tc[c.tgt]++;
      if (s.tgt === '' || c.tgt === +s.tgt) certs.push(ct);
    });
    const S: Record<string, (a: Cert, b: Cert) => number> = {
      exp: (a, b) => (a.days ?? 1e9) - (b.days ?? 1e9),
      ap: (a, b) => (b.ap || '').localeCompare(a.ap || ''),
      name: (a, b) => a.org.localeCompare(b.org, 'th'),
    };
    certs.sort(S[s.sort] || S.ap);
    return { out: certs, tc, ph: 0 };
  }
  const cos: Company[] = [];
  e.B.companies.forEach((c) => {
    if (s.expM && (c.cfoEx || '').slice(0, 7) !== s.expM) return;
    if (!matchCo(e, c, s, q, true)) return;
    tc[c.tgt]++;
    if (s.tgt === '' || c.tgt === +s.tgt) cos.push(c);
  });
  const S: Record<string, (a: Company, b: Company) => number> = {
    default: (a, b) => a.tgt - b.tgt || (a.days ?? 1e9) - (b.days ?? 1e9),
    exp: (a, b) => (a.days ?? 1e9) - (b.days ?? 1e9),
    invest: (a, b) => (b.invest || 0) - (a.invest || 0),
    gi: (a, b) => (b.giLive || 0) - (a.giLive || 0) || (b.giMax || 0) - (a.giMax || 0),
    fac: (a, b) => (b.fac || 0) - (a.fac || 0),
    name: (a, b) => a.name.localeCompare(b.name, 'th'),
  };
  if (S[s.sort]) cos.sort(S[s.sort]);
  return { out: cos, tc, ph: cos.reduce((n, c) => n + (c.hasPh ? 1 : 0), 0) };
}
