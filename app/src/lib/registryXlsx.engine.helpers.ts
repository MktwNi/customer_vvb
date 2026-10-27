/**
 * Shared setup for the certificate sheet tests (registryXlsx.engine.test.ts and registryXlsx.engine.more.test.ts): the engine
 * built from the web's data files, the browser stubs, and the fixtures the tests build their rows from. Not a test file.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { vi } from 'vitest';
import { GccEngine } from './engine';
import type { CertFields, CertLine } from './registryXlsx';
import { FEED_URL, type FeedRow, type TgoRec } from './tgoSync';
import { memoryStore } from './storage';
import type { Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');

const cache = new Map<string, any>();
/** The web's data files, read once (each engine and each revert reads them again). */
export const json = (f: string) => {
  if (!cache.has(f)) cache.set(f, JSON.parse(readFileSync(join(DATA, f), 'utf8')));
  return cache.get(f);
};
export const TODAY = '2026-10-26';
export const tick = () => new Promise<void>((r) => setImmediate(r));

export function engine() {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = TODAY;
  e.store = memoryStore();
  e.rebuild();
  addCos(e);
  e.loading = false;
  return e;
}

/** The companies the sheet rows of these tests name: shared customers (ids from CUSTOM_ID_MIN), as a team's customers are.
 *  An import creates no company (R15), so a row of an unknown company goes to the review list instead. */
const SYN_COS = [
  'บริษัท ทดสอบซ้ำ จำกัด', 'บริษัท พีเอ ทดสอบ จำกัด', 'บริษัท บี ทดสอบ จำกัด', 'บริษัท ทดสอบแข่ง จำกัด', 'บริษัท ซี ทดสอบ จำกัด',
  'บริษัท ฟ ทดสอบ จำกัด', 'บริษัท ป้อนทีหลัง จำกัด', 'บริษัท ทดสอบย้อนกลับ จำกัด', 'บริษัท ทดสอบช่องว่าง จำกัด',
  'บริษัท ก ทดสอบ จำกัด', 'บริษัท ข ทดสอบ จำกัด', 'บริษัท ABC จำกัด', 'บริษัท ย้ายไป จำกัด',
];
function addCos(e: GccEngine) {
  SYN_COS.forEach((name, i) => {
    const id = 1e12 + 1 + i;
    e.custom[id] = { id, name, jur: '', prov: '', ind: 'ไม่ระบุ', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '', at: '', by: '' };
  });
  e.rebuild();
}

/** Stubs the browser globals the sheet tests need: the local storage, and fetch, which answers with the web's data files. */
export function stubBrowserGlobals() {
  const ls = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null),
    setItem: (k: string, v: string) => void ls.set(k, String(v)),
    removeItem: (k: string) => void ls.delete(k),
  });
  // revert reloads the web's own data files (loadBase)
  vi.stubGlobal('fetch', async (u: string) => {
    try {
      return new Response(JSON.stringify(json(basename(String(u)))));
    } catch {
      return new Response('', { status: 404 });
    }
  });
}

export const newCert = (over: Partial<CertFields> = {}): CertFields => ({
  cert: 'REV-1', org: 'บริษัท ทดสอบย้อนกลับ จำกัด', branch: 'สำนักงานใหญ่', act: 'การผลิต', addr: '', zip: '', prov: 'กรุงเทพมหานคร',
  ind: 'การผลิต', size: 'ขนาดเล็ก', ap: '2025-01-01', ex: '2027-01-01', s1: 0.6, s2: 0.3, s3: 0.1, fy: 'FY67', note: '', webId: '', ...over,
});
export const row = (f: CertFields, rowNo = 2): CertLine => ({ rowNo, f, errors: [] });
/** Registry, companies, the local added list, the queue's waiting rows and the TGO-accepted rows, as counts. */
export const counts = (e: GccEngine) => ({ certs: e.B.certs.length, cos: e.B.companies.length, tgo: e.tgoCerts.length, added: e.added.length, waiting: e.tgoRows('p').length });
export const waitingCerts = (e: GccEngine) => e.tgoRows('p').map((r) => r.rec.cert).sort();

/** The feed answers with these rows; every other address is a data file, as the beforeEach stub gives it. */
export function feedServes(rows: FeedRow[]) {
  vi.stubGlobal('fetch', async (u: string) => {
    if (String(u).startsWith(FEED_URL)) return new Response(JSON.stringify({ ok: true, rows, webTotal: rows.length }));
    return new Response(JSON.stringify(json(basename(String(u)))));
  });
}
export const feedRow = (o: Partial<FeedRow>): FeedRow => ({
  id: '', cert: '', act: 'การผลิต', org: '', branch: '', prov: 'ชลบุรี', addr: '', tambon: '', amphoe: '', changwat: '', zip: '', ind: '', size: '',
  apBE: '01/02/2569', exBE: '31/01/2570', ap: '', ex: '', s1: null, s2: null, s3: null, fy: 'FY27', note: '', flags: '', ...o,
});
/** A certificate the team accepted from the queue: the record an approval leaves, with the company it went to. */
export function accept(e: GccEngine, id: string, cert: string, s1: number) {
  const co = e.B.companies[0];
  e.tgo[id] = {
    cert, org: co.name, act: 'การผลิต', branch: '', prov: 'ชลบุรี', apBE: '', exBE: '', ap: '2025-02-01', ex: '2027-02-01', fy: 'FY27', id,
    addr: '', zip: '', changwat: 'ชลบุรี', ind: '', size: '', s1, s2: null, s3: null, st: 'a', gid: co.id, by: '', at: '', note: '',
  } as TgoRec;
  e.rebuild();
}
