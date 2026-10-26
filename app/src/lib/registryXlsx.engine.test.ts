/**
 * The certificate sheet in the engine: a save adds what it adds and nothing more, so revert takes exactly that back
 * (rows the TGO feed brings in later stay), and the old full workbook needs the set.data cap like the sheet does.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GccEngine } from './engine';
import { certFields, type CertFields, type CertLine } from './registryXlsx';
import { memoryStore } from './storage';
import type { Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
vi.setConfig({ testTimeout: 30000 });
const cache = new Map<string, any>();
/** The web's data files, read once (each engine and each revert reads them again). */
const json = (f: string) => {
  if (!cache.has(f)) cache.set(f, JSON.parse(readFileSync(join(DATA, f), 'utf8')));
  return cache.get(f);
};
const TODAY = '2026-10-26';

function engine() {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = TODAY;
  e.store = memoryStore();
  e.rebuild();
  e.loading = false;
  return e;
}

beforeEach(() => {
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
});
afterEach(() => vi.unstubAllGlobals());

const newCert = (over: Partial<CertFields> = {}): CertFields => ({
  cert: 'REV-1', org: 'บริษัท ทดสอบย้อนกลับ จำกัด', branch: 'สำนักงานใหญ่', act: 'การผลิต', addr: '', zip: '', prov: 'กรุงเทพมหานคร',
  ind: 'การผลิต', size: 'ขนาดเล็ก', ap: '2025-01-01', ex: '2027-01-01', s1: 0.6, s2: 0.3, s3: 0.1, fy: 'FY67', note: '', webId: '', ...over,
});
const counts = (e: GccEngine) => ({ certs: e.B.certs.length, cos: e.B.companies.length, tgo: e.tgoCerts.length, added: e.added.length });

describe('the certificate sheet: save, then revert', () => {
  it('a save adds its certificate, its company and a changed row; revert takes exactly those back', async () => {
    const e = engine();
    const before = counts(e);
    const i = e.B.certs.findIndex((c) => c.s1 != null);
    const first = certFields(e.B.certs[i], e.B.CD);
    const lines: CertLine[] = [
      { rowNo: 2, f: { ...first, s1: 0.5, s2: 0.4, s3: 0.1 }, errors: [] },
      { rowNo: 3, f: newCert(), errors: [] },
    ];
    expect(await e.applyCertRows(lines, 'rev.xlsx')).toMatch(/^บันทึกแล้ว/);
    expect(counts(e)).toEqual({ certs: before.certs + 1, cos: before.cos + 1, tgo: before.tgo + 1, added: before.added + 1 });
    expect(certFields(e.B.certs[i], e.B.CD).s1).toBe(0.5);
    await e.revertUpload();
    expect(counts(e)).toEqual(before);
    expect(certFields(e.B.certs[i], e.B.CD).s1).toBe(first.s1);
    expect(e.base.source).toBe('file');
  });

  it('rows the feed brings in after the save stay through the revert; a feed row the save changed goes back to its values', async () => {
    const e = engine();
    const co = e.B.companies[0];
    e.tgoCerts = [{ gid: co.id, cert: 'FEED-1', org: co.name, branch: '', act: '', ind: -1, size: -1, addr: '', prov: -1, provTxt: 'ชลบุรี', zip: '', ap: '2025-02-01', ex: '2027-02-01', fy: -1, s1: 0.2, s2: null, s3: null, phone: '', email: '', webId: '99001', note: '' }];
    e.rebuild();
    const feedHeld = certFields(e.B.certs[e.base.certs.length], e.B.CD);
    expect(feedHeld.s1).toBe(0.2);
    await e.applyCertRows([{ rowNo: 2, f: { ...feedHeld, s1: 0.5 }, errors: [] }, { rowNo: 3, f: newCert(), errors: [] }], 'rev.xlsx');
    expect(e.tgoCerts.map((c) => [c.cert, c.s1])).toEqual([['FEED-1', 0.5], ['REV-1', 0.6]]);
    e.tgoCerts = [...e.tgoCerts, { ...e.tgoCerts[0], cert: 'FEED-LATER', webId: '99002', s1: 0.1 }];
    e.rebuild();
    await e.revertUpload();
    expect(e.tgoCerts.map((c) => [c.cert, c.s1])).toEqual([['FEED-1', 0.2], ['FEED-LATER', 0.1]]);
    expect(e.added.some((c) => c.name === 'บริษัท ทดสอบย้อนกลับ จำกัด')).toBe(false);
  });
});

describe('set.data gates the old full workbook and the revert as it gates the sheet', () => {
  it('a save, an apply of the full workbook and a revert are refused without set.data, and nothing changes', async () => {
    const e = engine();
    const before = counts(e);
    const base0 = e.base;
    vi.spyOn(e, 'can').mockReturnValue(false);
    expect(await e.applyCertRows([{ rowNo: 2, f: newCert(), errors: [] }], 'x.xlsx')).toBe('บัญชีของคุณไม่มีสิทธิ์นำเข้าข้อมูล');
    (e as unknown as { pendingUpload: unknown }).pendingUpload = { base: { ...base0, certs: [] }, details: {} };
    await e.applyUpload();
    expect(e.base).toBe(base0);
    await e.revertUpload();
    expect(e.base).toBe(base0);
    expect(counts(e)).toEqual(before);
  });
});
