/**
 * The certificate-sheet save as the engine reports it (applyCertRowsReport) and the review list's decisions (acceptReview,
 * rejectReview), on synthetic companies and rows. The saved result is the import record's own log list (R14); a row the
 * import cannot apply is kept for review, never dropped, and a team member who cannot edit customers cannot decide it (R16).
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GccEngine } from './engine';
import { gccCode } from './format';
import { countLog, type CertFields, type CertLine } from './registryXlsx';
import { makeReview, reviewIdOf } from './sheetReview';
import { memoryStore } from './storage';
import type { Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
vi.setConfig({ testTimeout: 30000 });
const cache = new Map<string, any>();
const json = (f: string) => {
  if (!cache.has(f)) cache.set(f, JSON.parse(readFileSync(join(DATA, f), 'utf8')));
  return cache.get(f);
};
const TODAY = '2026-10-26';
/** Synthetic companies only: the names and ids are made up for these tests. */
const CO_ID = 1e12 + 1;
const CO_NAME = 'บริษัท ทดสอบรายงาน จำกัด';

function engine() {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = TODAY;
  e.store = memoryStore();
  e.rebuild();
  e.custom[CO_ID] = { id: CO_ID, name: CO_NAME, jur: '', prov: '', ind: 'ไม่ระบุ', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '', at: '', by: '' };
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
  vi.stubGlobal('fetch', async (u: string) => new Response(JSON.stringify(json(basename(String(u))))));
});
afterEach(() => vi.unstubAllGlobals());

const fields = (over: Partial<CertFields> = {}): CertFields => ({
  cert: 'SYN-R-1', org: CO_NAME, branch: '', act: 'การผลิต', addr: '', zip: '', prov: 'กรุงเทพมหานคร', ind: 'การผลิต', size: 'ขนาดเล็ก',
  ap: '2025-01-01', ex: '2027-01-01', s1: 0.6, s2: 0.3, s3: 0.1, fy: 'FY67', note: '', webId: '', ...over,
});
const line = (f: CertFields, rowNo: number, over: Partial<CertLine> = {}): CertLine => ({ rowNo, f, errors: [], gcc: '', email: '', emailSt: '', vals: {}, ...over });

describe('the saved result is the engine log list (R14, R19)', () => {
  it('a save returns the log it kept with the import record, with the review row in it, and creates no company', async () => {
    const e = engine();
    const companies = e.B.companies.length;
    const rows = [
      line(fields({ cert: 'SYN-Q-1' }), 2, { gcc: gccCode(CO_ID) }),
      line(fields({ cert: 'SYN-X-1', org: 'บริษัท ไม่มีในระบบ จำกัด' }), 3),
    ];
    const saved = await e.applyCertRowsReport(rows, 'report.xlsx', ['คอลัมน์แปลก']);
    expect(saved.msg).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    expect(saved.msg).toContain('รอตรวจสอบ 1 ใบ');
    expect(saved.msg).toContain('ไม่มีการสร้างบริษัทใหม่');
    expect(saved.log.map((r) => [r.row, r.action])).toEqual([[2, 'queued'], [3, 'review']]);
    expect(saved.log[1]).toMatchObject({ reason: 'ไม่พบบริษัทในระบบ', cert: 'SYN-X-1' });
    // the list the page shows is the import record's own list, and its counts come from that list
    expect(e.certImports[e.certImports.length - 1]?.log).toBe(saved.log);
    expect(countLog(saved.log)).toMatchObject({ queued: 1, review: 1, reasons: { 'ไม่พบบริษัทในระบบ': 1 } });
    expect(e.B.companies.length).toBe(companies);
    expect(e.sheetrev[reviewIdOf('SYN-X-1', 'บริษัท ไม่มีในระบบ จำกัด', '')]?.st).toBe('p');
  });

  it('a second save of the same file changes nothing, and its result lists the rows as already held', async () => {
    const e = engine();
    const rows = [line(fields({ cert: 'SYN-Q-2' }), 2, { gcc: gccCode(CO_ID) })];
    await e.applyCertRowsReport(rows, 'report.xlsx');
    const again = await e.applyCertRowsReport(rows, 'report.xlsx');
    expect(again.msg).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(again.log.map((r) => r.action)).toEqual(['already queued']);
    expect(e.certImports).toHaveLength(1);
  });

  it('a viewer cannot save: the result says so and carries no list', async () => {
    const e = engine();
    vi.spyOn(e, 'can').mockReturnValue(false);
    expect(await e.applyCertRowsReport([line(fields({ cert: 'SYN-V-1' }), 2)], 'v.xlsx')).toEqual({ msg: 'บัญชีของคุณไม่มีสิทธิ์นำเข้าข้อมูล', log: [] });
    expect(e.certImports).toEqual([]);
  });
});

describe('the review list: accept needs a company and a viewer cannot decide (R16)', () => {
  /** A row the import kept for review (no company of that name), so the list holds one waiting record. */
  async function waitingRecord(e: GccEngine, cert = 'SYN-A-1') {
    await e.applyCertRowsReport([line(fields({ cert, org: 'บริษัท ไม่มีในระบบ จำกัด' }), 2, { gcc: 'GCC-999998', email: 'x@example.test', emailSt: 'พบ' })], 'a.xlsx');
    const rec = e.reviewRecs().find((r) => r.cert === cert);
    if (!rec) throw new Error('no review record');
    return rec;
  }

  it('accepting attaches the row to the chosen existing company as a queue row, and creates no company', async () => {
    const e = engine();
    const rec = await waitingRecord(e);
    const companies = e.B.companies.length;
    const msg = await e.acceptReview(rec.id, CO_ID);
    expect(msg).toMatch(/^รับแล้ว · บันทึกแล้ว/);
    expect(e.sheetrev[rec.id]).toMatchObject({ st: 'a', co: CO_ID });
    expect(e.tgoRows('p').map((r) => [r.rec.cert, r.gid])).toEqual([['SYN-A-1', CO_ID]]);
    expect(e.B.companies.length).toBe(companies);
  });

  it('accepting without a company, or with a device-local one, changes nothing', async () => {
    const e = engine();
    const rec = await waitingRecord(e, 'SYN-A-2');
    expect(await e.acceptReview(rec.id, null as unknown as number)).toBe('เลือกบริษัทที่มีในระบบก่อนรับ');
    expect(await e.acceptReview(rec.id, 900007)).toBe('บริษัทนี้ไม่มีในระบบ หรือเก็บไว้ในเครื่องนี้เท่านั้น รับเข้าไม่ได้');
    expect(e.sheetrev[rec.id].st).toBe('p');
    expect(e.tgoRows('p')).toEqual([]);
  });

  it('a viewer cannot accept or reject: nothing is decided', async () => {
    const e = engine();
    const rec = await waitingRecord(e, 'SYN-A-3');
    vi.spyOn(e, 'can').mockReturnValue(false);
    expect(await e.acceptReview(rec.id, CO_ID)).toBe('');
    expect(e.rejectReview(rec.id)).toBe('');
    expect(e.sheetrev[rec.id].st).toBe('p');
    expect(e.tgoRows('p')).toEqual([]);
  });

  it('rejecting keeps the record as rejected, so the same row is reported as declined and not added again', async () => {
    const e = engine();
    const rec = await waitingRecord(e, 'SYN-A-4');
    expect(e.rejectReview(rec.id)).toBe('ไม่รับแล้ว');
    expect(e.sheetrev[rec.id].st).toBe('r');
    const again = await e.applyCertRowsReport([line(fields({ cert: 'SYN-A-4', org: 'บริษัท ไม่มีในระบบ จำกัด' }), 2, { gcc: 'GCC-999998' })], 'a.xlsx');
    expect(again.log.map((r) => r.action)).toEqual(['declined before']);
  });
});

describe('a record made by the review helper reads back as a waiting record', () => {
  it('makeReview keeps the row values and starts waiting', () => {
    const rec = makeReview(line(fields({ cert: 'SYN-M-1' }), 4, { gcc: 'GCC-000001', email: 'm@example.test', emailSt: 'พบ', vals: { อีเมล: 'm@example.test' } }), 'ไม่พบบริษัทในระบบ', 'm.xlsx', '2026-10-26T03:00:00Z', 'ผู้ทดสอบ');
    expect(rec).toMatchObject({ st: 'p', co: null, gcc: 'GCC-000001', email: 'm@example.test', vals: { อีเมล: 'm@example.test' } });
  });
});
