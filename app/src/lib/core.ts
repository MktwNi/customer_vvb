/**
 * Data core — port of the design's gcc-core.js:
 * loading, dedup (union-find), company status / target-group rules, and the Excel importer.
 */
import type { Built, Cert, CertDicts, Company, ContactEdit, Dataset, Detail, Dicts, DupGroup, RawCompany } from './types';
import { DAY, todayISO } from './format';
import { kv } from './storage';

export const COLS = ['id', 'name', 'jur', 'type', 'prov', 'addr', 'ind', 'biz', 'src', 'tgt', 'cfo', 'cfoN', 'cfoEx', 'giNow', 'giMax', 'giUntil', 'newYm', 'invest', 'fac', 'set', 'mkt', 'phone', 'email', 'web', 'ct', 'match'] as const;
export const CCOLS = ['gid', 'cert', 'org', 'branch', 'act', 'ind', 'size', 'addr', 'prov', 'zip', 'ap', 'ex', 'fy', 's1', 's2', 's3', 'phone', 'email', 'webId', 'note'] as const;
export const SRC = ['TGO', 'GI', 'กรอ.', 'SET'];

export const dataUrl = (p: string) => `${import.meta.env.BASE_URL}data/${p}`;

/** "บริษัท บริษัท X" → "บริษัท X", collapse whitespace. */
export const fixName = (s: unknown) => String(s || '').replace(/^(บริษัท\s*)+(?=บริษัท)/, '').replace(/\s+/g, ' ').trim();
/** Name key for duplicate detection: strips legal-form words, branch notes and punctuation. */
export const norm = (s: unknown) =>
  String(s || '')
    .replace(/\((สำนักงานใหญ่|สาขา[^)]*|\d{5}[^)]*|มหาชน)\)/g, '')
    .replace(/บริษัท|บจก\.?|บมจ\.?|จำกัด|มหาชน|ห้างหุ้นส่วน|หจก\.?|สามัญ|นิติบุคคล|\(|\)|\.|,|\s+/g, '')
    .toLowerCase();
/** Phone keys: first 9 digits of each "|"-separated number. */
export const phones = (s: unknown) =>
  String(s || '').split('|').map((x) => x.replace(/\D/g, '').slice(0, 9)).filter((x) => x.length >= 8);

export async function loadBase(): Promise<Dataset> {
  const ds = await kv.get<Dataset>('dataset');
  if (ds && ds.rows) return ds;
  const [g, c] = await Promise.all([
    fetch(dataUrl('gcc.json')).then((r) => r.json()),
    fetch(dataUrl('gcc-certs.json')).then((r) => r.json()),
  ]);
  return { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' };
}

const detCache: Record<number, Promise<Record<string, Record<string, unknown[][]>>>> = {};
/** Per-source rows for the given raw ids; uploaded datasets keep their details in IndexedDB. */
export async function getDetail(ids: number[]): Promise<Detail> {
  const out: Detail = { t: [], g: [], f: [], s: [] };
  const up = await kv.get<Record<string, Record<string, unknown[][]>>>('details');
  for (const id of ids) {
    if (id >= 900000 && !up) continue; // companies added in the app (TGO sync, by hand) have no detail files
    let d: Record<string, unknown[][]> | undefined;
    if (up) d = up[id];
    else {
      const b = Math.floor(id / 2000);
      if (!detCache[b]) detCache[b] = fetch(dataUrl(`gcc-detail/${b}.json`)).then((r) => r.json()).catch(() => ({}));
      d = (await detCache[b])[id];
    }
    if (d) for (const k of ['t', 'g', 'f', 's'] as const) (d[k] || []).forEach((x) => out[k].push({ src: id, x }));
  }
  return out;
}

function mergeRows(g: RawCompany[], D: Dicts): RawCompany {
  const p = g.find((r) => r.jur) || g[0];
  const o: RawCompany = { ...p };
  const others = g.filter((r) => r !== p);
  const NOIND = D.ind.indexOf('ไม่ระบุ');
  const rank = (v: number) => ({ 'อยู่ในอายุ': 3, 'หมดอายุ': 2, 'ไม่ระบุวันหมดอายุ': 1 } as Record<string, number>)[D.cfo[v]] || 0;
  const uj = (k: 'phone' | 'email', m: number) =>
    [...new Set(g.flatMap((r) => String(r[k] || '').split('|').map((s) => s.trim())).filter(Boolean))].slice(0, m).join(' | ');
  o.ids = g.map((r) => r.id);
  o.src = g.reduce((m, r) => m | r.src, 0);
  for (const k of ['addr', 'biz', 'set', 'mkt', 'web'] as const) if (!o[k]) o[k] = (others.find((r) => r[k]) || ({} as RawCompany))[k] || '';
  if (!D.prov[o.prov]) o.prov = others.find((r) => D.prov[r.prov])?.prov ?? o.prov;
  if (o.ind === NOIND) o.ind = others.find((r) => r.ind !== NOIND)?.ind ?? o.ind;
  o.cfo = g.slice().sort((a, b) => rank(b.cfo) - rank(a.cfo))[0].cfo;
  o.cfoN = g.reduce((n, r) => n + (r.cfoN || 0), 0) || null;
  o.cfoEx = g.map((r) => r.cfoEx).filter(Boolean).sort().pop() || '';
  o.giNow = Math.max(0, ...g.map((r) => r.giNow || 0)) || null;
  o.giMax = Math.max(0, ...g.map((r) => r.giMax || 0)) || null;
  o.giUntil = g.map((r) => r.giUntil).filter(Boolean).sort().pop() || '';
  o.newYm = g.map((r) => r.newYm).filter(Boolean).sort()[0] || '';
  o.invest = g.reduce((n, r) => n + (r.invest || 0), 0) || null;
  o.fac = g.reduce((n, r) => n + (r.fac || 0), 0) || null;
  o.phone = uj('phone', 3);
  o.email = uj('email', 3);
  if (!o.ct) o.ct = others.find((r) => r.ct)?.ct || 0;
  o.merged = true;
  return o;
}

export interface BuildExtra { added?: Partial<RawCompany>[]; contacts?: Record<string, ContactEdit>; certs?: Partial<Cert>[] }

/**
 * Raw rows → companies. Groups with the same normalised name are merged automatically
 * when exactly one row has a juristic id (unless the user split them); other name/phone
 * groups are merged only when the user decided so. `dec` maps groupKey → 'merge' | 'split'.
 */
export function build(base: Dataset, dec: Record<string, string>, extra: BuildExtra = {}): Built {
  dec = dec || {};
  const D = base.dicts;
  const raw: RawCompany[] = base.rows.map((a) => {
    const o = {} as Record<string, unknown>;
    COLS.forEach((c, i) => (o[c] = a[i]));
    o.name = fixName(o.name);
    o.ids = [o.id];
    return o as unknown as RawCompany;
  });
  (extra.added || []).forEach((o) => raw.push({ ...(o as RawCompany), ids: [o.id as number] }));
  const byId = new Map(raw.map((r) => [r.id, r]));

  const P = new Map<number, number>();
  const find = (x: number) => {
    let r = x;
    while (P.has(r) && P.get(r) !== r) r = P.get(r)!;
    return r;
  };
  const uni = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) {
      P.set(a, a);
      P.set(b, a);
    }
  };
  raw.forEach((r) => P.set(r.id, r.id));

  const groups: DupGroup[] = [];
  const byN: Record<string, number[]> = {};
  raw.forEach((r) => {
    const k = norm(r.name);
    if (k.length < 3) return;
    (byN[k] || (byN[k] = [])).push(r.id);
  });
  Object.entries(byN).forEach(([k, ids]) => {
    if (ids.length < 2) return;
    const jurs = new Set(ids.map((i) => byId.get(i)!.jur).filter(Boolean));
    const why = jurs.size === 1 ? 'auto' : jurs.size > 1 ? 'diffjur' : 'nojur';
    groups.push({ key: 'n:' + k, ids, why, state: 'pending' });
  });
  groups.filter((g) => g.why === 'auto' && dec[g.key] !== 'split').forEach((g) => g.ids.forEach((i) => uni(g.ids[0], i)));
  groups.filter((g) => g.why !== 'auto' && dec[g.key] === 'merge').forEach((g) => g.ids.forEach((i) => uni(g.ids[0], i)));

  const byP: Record<string, Set<number>> = {};
  raw.forEach((r) => phones(r.phone).forEach((p) => (byP[p] || (byP[p] = new Set())).add(r.id)));
  Object.entries(byP).forEach(([p, s]) => {
    const ids = [...s];
    if (ids.length < 2 || ids.length > 4) return;
    if (new Set(ids.map(find)).size < 2 && dec['p:' + p] !== 'merge') return;
    groups.push({ key: 'p:' + p, ids, why: 'phone', state: 'pending' });
  });
  groups.filter((g) => g.why === 'phone' && dec[g.key] === 'merge').forEach((g) => g.ids.forEach((i) => uni(g.ids[0], i)));

  const comp: Record<number, RawCompany[]> = {};
  raw.forEach((r) => {
    const k = find(r.id);
    (comp[k] || (comp[k] = [])).push(r);
  });
  const companies: Company[] = [];
  const alias = new Map<number, number>();
  Object.values(comp).forEach((g) => {
    const c = (g.length > 1 ? mergeRows(g, D) : g[0]) as Company;
    if (g.length > 1) c.id = (g.find((r) => r.jur) || g[0]).id;
    c.ids.forEach((i) => alias.set(i, c.id));
    companies.push(c);
  });
  companies.sort((a, b) => a.id - b.id);

  const ce = extra.contacts || {};
  companies.forEach((c) => {
    const e = ce[c.id];
    if (e) {
      if (e.phone != null) c.phone = e.phone;
      if (e.email != null) c.email = e.email;
      if (e.web != null) c.web = e.web;
      c.cEdited = e;
    }
  });
  groups.forEach((g) => {
    g.state = g.why === 'auto' ? (dec[g.key] === 'split' ? 'split' : 'merged') : ((dec[g.key] as DupGroup['state']) || 'pending');
  });

  const CD: CertDicts = base.cdicts;
  const certs: Cert[] = ((base.certs || []) as unknown[]).concat(extra.certs || []).map((a, i) => {
    let o: Record<string, unknown> = {};
    if (Array.isArray(a)) CCOLS.forEach((c, j) => (o[c] = a[j]));
    else o = { ...(a as object) };
    o.cid = i;
    o.org = fixName(o.org);
    o.gid0 = o.gid;
    o.gid = alias.get(o.gid as number) ?? o.gid;
    return o as unknown as Cert;
  });
  return { D, CD, companies, byId: new Map(companies.map((c) => [c.id, c])), rawById: byId, alias, groups, certs };
}

/**
 * CFO / GI status at reference time T (ms) with a "soon" window of W days, and the
 * target group (0–8): first matching rule wins.
 */
export function status(c: Company, T: number, W: number) {
  const has = (c.cfoN || 0) > 0 || !!(c.src & 1);
  c.days = c.cfoEx ? Math.round((Date.parse(c.cfoEx) - T) / DAY) : null;
  c.cfoSt = !has ? 'none' : c.days == null ? 'unknown' : c.days < 0 ? 'expired' : c.days <= W ? 'soon' : 'active';
  c.giLive = c.giNow && (c.giNow === 1 || !c.giUntil || Date.parse(c.giUntil) >= T) ? c.giNow : null;
  c.giDays = c.giUntil && c.giLive ? Math.round((Date.parse(c.giUntil) - T) / DAY) : null;
  c.tgt =
    c.cfoSt === 'soon' ? 0
    : c.cfoSt === 'active' ? 3
    : c.cfoSt === 'expired' ? (c.days! >= -365 ? 1 : 2)
    : c.cfoSt === 'unknown' ? 2
    : c.src & 8 ? 4
    : (c.giLive || 0) >= 3 ? 5
    : c.newYm && c.newYm >= '2567-01' && (c.invest || 0) >= 5e6 ? 6
    : c.giLive === 2 ? 7
    : 8;
  c.hasPh = !!c.phone;
  return c;
}

/** First worksheet of an .xlsx as objects keyed by the header row (text values; Excel dates stay serial numbers). */
export async function readXlsxRows(file: Blob): Promise<Record<string, string>[]> {
  const { default: JSZip } = await import('jszip');
  const zx = await JSZip.loadAsync(file);
  // character references too: some writers (openpyxl…) store every Thai letter as "&#3610;"
  const ENT: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  const dec = (s: string) =>
    s.replace(/&(?:#(\d+)|#x([\da-fA-F]+)|(lt|gt|quot|apos|amp));/g, (e, d, h, n) => {
      const cp = n ? 0 : d ? parseInt(d, 10) : parseInt(h, 16);
      return n ? ENT[n] : cp <= 0x10ffff ? String.fromCodePoint(cp) : e;
    });
  // a shared or inline string: the text of all its rich-text runs, without phonetic guides
  const str = (x: string) => dec([...x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*[^/>])?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
  const ssF = zx.file('xl/sharedStrings.xml');
  const S = ssF ? [...(await ssF.async('string')).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => str(m[1] || '')) : [];
  const first = Object.keys(zx.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))[0];
  if (!first) throw new Error('ไม่พบชีตในไฟล์ Excel');
  const x = await zx.file(first)!.async('string');
  const rows = [...x.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)].map((r) => {
    const o: Record<number, string> = {};
    let col = 0;
    for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      // column from r="B2"; a cell without one (it is optional) is the one after the previous cell
      const ref = /\br="([A-Z]+)\d*"/.exec(c[1]);
      col = ref ? [...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) : col + 1;
      const t = (/\bt="(\w+)"/.exec(c[1]) || [])[1];
      const is = /<is>([\s\S]*?)<\/is>/.exec(c[2] || '');
      const v = (/<v>([\s\S]*?)<\/v>/.exec(c[2] || '') || [])[1]; // a formula's (<f>) last result
      if (is) o[col] = str(is[1]);
      else if (v != null) o[col] = t === 's' ? (S[+v] ?? '') : dec(v);
    }
    return o;
  }).filter((r) => Object.values(r).some((v) => v.trim()));
  const head = rows.shift() || {};
  return rows.map((r) => Object.fromEntries(Object.entries(head).map(([col, h]) => [h.trim(), r[+col] ?? ''])));
}

/* ---------- Excel importer (ฐานข้อมูลลูกค้า_GCC.xlsx) ---------- */

export interface ParsedUpload { base: Dataset; details: Record<string, Record<string, unknown[][]>> }

export async function parseXlsx(file: File, onProgress?: (m: string) => void): Promise<ParsedUpload> {
  const { default: JSZip } = await import('jszip');
  const zx = await JSZip.loadAsync(file);
  const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const ssF = zx.file('xl/sharedStrings.xml');
  const ss = ssF ? await ssF.async('string') : '';
  const S = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const wb = await zx.file('xl/workbook.xml')!.async('string');
  const rels = await zx.file('xl/_rels/workbook.xml.rels')!.async('string');
  const tgt: Record<string, string> = {};
  [...rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].forEach((m) => (tgt[m[1]] = m[2].replace(/^\/?xl\//, '')));
  const sheets: Record<string, string> = {};
  [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].forEach((m) => (sheets[dec(m[1])] = 'xl/' + tgt[m[2]]));

  type Row = Record<string, string>;
  const read = async (name: string): Promise<Row[] | null> => {
    const f = sheets[name] && zx.file(sheets[name]);
    if (!f) return null;
    onProgress?.('กำลังอ่านชีต ' + name + '…');
    const x = await f.async('string');
    const R = [...x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
      const o: Row = {};
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = /t="(\w+)"/.exec(c[2]);
        let v = (/<v>([\s\S]*?)<\/v>/.exec(c[3] || '') || [])[1];
        if (v == null) v = (/<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] || '') || [])[1];
        if (v == null) continue;
        o[c[1]] = t && t[1] === 's' ? S[+v] : dec(v);
      }
      return o;
    });
    R.shift();
    return R;
  };
  const iso = (v: string | undefined) => {
    if (!v) return '';
    const n = +v;
    if (!isFinite(n)) return String(v);
    return new Date(Math.round((n - 25569) * DAY)).toISOString().slice(0, 10);
  };
  const num = (v: string | undefined) => (v == null || v === '' ? null : +v);
  const gid = (s: string | undefined) => +String(s || '').replace('GCC-', '');

  const main = await read('ทะเบียนบริษัท');
  if (!main || !main.length || !/^GCC-/.test(main[0].A || '')) throw new Error('ไม่พบชีต "ทะเบียนบริษัท" ที่มีรหัส GCC-xxxxxx ในไฟล์นี้');
  const D = { type: [], prov: [], ind: [], tgt: [], cfo: [], ct: [], match: [] } as unknown as Dicts;
  const di = (k: keyof Dicts, v: string | undefined) => {
    v = v ?? '';
    const a = D[k];
    let i = a.indexOf(v);
    if (i < 0) {
      a.push(v);
      i = a.length - 1;
    }
    return i;
  };
  const rows = main.map((r) => {
    const src = (r.I || '').split(',').map((s) => s.trim());
    const m = SRC.reduce((a, s, i) => a | (src.includes(s) ? 1 << i : 0), 0);
    return [gid(r.A), r.B || '', r.C || '', di('type', r.D), di('prov', r.E || ''), r.F || '', di('ind', r.G), r.H || '', m, di('tgt', r.J), di('cfo', r.K || ''), num(r.L), iso(r.M), num(r.N), num(r.O), iso(r.P), r.Q || '', num(r.R), num(r.S), r.T || '', r.U || '', r.V || '', r.W || '', r.X || '', di('ct', r.Y || ''), di('match', r.Z || '')];
  });
  if (D.ind.indexOf('ไม่ระบุ') < 0) D.ind.push('ไม่ระบุ');
  if (D.cfo.indexOf('') < 0) D.cfo.push('');

  const CD: CertDicts = { ind: [], size: [], prov: [], fy: [] };
  const ci = (k: keyof CertDicts, v: string | undefined) => {
    v = v || '';
    let i = CD[k].indexOf(v);
    if (i < 0) {
      CD[k].push(v);
      i = CD[k].length - 1;
    }
    return i;
  };
  const det: Record<string, Record<string, unknown[][]>> = {};
  const push = (id: number, k: string, v: unknown[]) => {
    const o = det[id] || (det[id] = {});
    (o[k] || (o[k] = [])).push(v);
  };
  const s3 = (await read('TGO_CFO')) || [];
  const certs = s3.map((r) => {
    push(gid(r.A), 't', [r.B || '', r.C || '', r.E || '', r.K || '', iso(r.M), iso(r.N), r.O || '', r.P || '', num(r.Q), num(r.R), num(r.S), r.T || '', r.U || '']);
    return [gid(r.A), r.B || '', r.C || '', r.D || '', r.E || '', ci('ind', r.F), ci('size', r.G), r.H || '', ci('prov', r.K), r.L || '', iso(r.M), iso(r.N), ci('fy', r.P), num(r.Q), num(r.R), num(r.S), r.T || '', r.U || '', r.Y || '', r.Z || ''];
  });
  ((await read('GI_อุตสาหกรรมสีเขียว')) || []).forEach((r) =>
    push(gid(r.A), 'g', [num(r.B), num(r.C), r.D || '', r.E || '', r.H || '', r.I || '', r.J || '', iso(r.K), iso(r.L), r.M || '']));
  ((await read('กรอ_โรงงานใหม่')) || []).forEach((r) =>
    push(gid(r.A), 'f', [r.B + '-' + String(r.C).padStart(2, '0'), r.D || '', r.E || '', r.H || '', [r.K, r.L, r.M, r.N, r.O].filter(Boolean).join(' '), r.P || '', r.Q || '', num(r.R), num(r.S), num(r.T)]));
  ((await read('SET_บริษัทจดทะเบียน')) || []).forEach((r) =>
    push(gid(r.A), 's', [r.B || '', r.D || '', r.F || '', r.G || '', r.H || '', r.I || '', r.L || '', r.N || '']));
  const sum = await read('สรุป');
  let asOf = todayISO();
  if (sum) {
    const r = sum.find((x) => /ข้อมูล ณ วันที่/.test(x.B || ''));
    if (r && r.C) asOf = iso(r.C);
  }
  return {
    base: { asOf, dicts: D, rows, cdicts: CD, certs, source: 'upload', fileName: file.name, uploadedAt: new Date().toISOString() },
    details: det,
  };
}
