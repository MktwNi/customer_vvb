/**
 * The certificate sheet in the engine. A new TGO certificate in a save waits in the review queue (tgoRecs, 'p'), as a
 * feed pull's does, and enters the registry only when a reviewer accepts it. A save changes nothing else in the registry
 * except the dataset's own rows (saved and reverted as before). A revert takes back the queue rows this save made that
 * still wait, and keeps the rows the team decided since and every row a pull brought in. The old full workbook needs the
 * set.data cap like the sheet does.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GccEngine } from './engine';
import { certFields, type CertFields, type CertLine } from './registryXlsx';
import { FEED_URL, type FeedRow, type TgoRec } from './tgoSync';
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
const tick = () => new Promise<void>((r) => setImmediate(r));

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
const row = (f: CertFields, rowNo = 2): CertLine => ({ rowNo, f, errors: [] });
/** Registry, companies, the local added list, the queue's waiting rows and the TGO-accepted rows, as counts. */
const counts = (e: GccEngine) => ({ certs: e.B.certs.length, cos: e.B.companies.length, tgo: e.tgoCerts.length, added: e.added.length, waiting: e.tgoRows('p').length });
const waitingCerts = (e: GccEngine) => e.tgoRows('p').map((r) => r.rec.cert).sort();

/** The feed answers with these rows; every other address is a data file, as the beforeEach stub gives it. */
function feedServes(rows: FeedRow[]) {
  vi.stubGlobal('fetch', async (u: string) => {
    if (String(u).startsWith(FEED_URL)) return new Response(JSON.stringify({ ok: true, rows, webTotal: rows.length }));
    return new Response(JSON.stringify(json(basename(String(u)))));
  });
}
const feedRow = (o: Partial<FeedRow>): FeedRow => ({
  id: '', cert: '', act: 'การผลิต', org: '', branch: '', prov: 'ชลบุรี', addr: '', tambon: '', amphoe: '', changwat: '', zip: '', ind: '', size: '',
  apBE: '01/02/2569', exBE: '31/01/2570', ap: '', ex: '', s1: null, s2: null, s3: null, fy: 'FY27', note: '', flags: '', ...o,
});
/** A certificate the team accepted from the queue: the record an approval leaves, with the company it went to. */
function accept(e: GccEngine, id: string, cert: string, s1: number) {
  const co = e.B.companies[0];
  e.tgo[id] = {
    cert, org: co.name, act: 'การผลิต', branch: '', prov: 'ชลบุรี', apBE: '', exBE: '', ap: '2025-02-01', ex: '2027-02-01', fy: 'FY27', id,
    addr: '', zip: '', changwat: 'ชลบุรี', ind: '', size: '', s1, s2: null, s3: null, st: 'a', gid: co.id, by: '', at: '', note: '',
  } as TgoRec;
  e.rebuild();
}

describe('the certificate sheet: save, then revert', () => {
  it('a save changes the dataset row and queues the new certificate; revert takes both back', async () => {
    const e = engine();
    const before = counts(e);
    const i = e.B.certs.findIndex((c) => c.s1 != null);
    const first = certFields(e.B.certs[i], e.B.CD);
    const lines: CertLine[] = [row({ ...first, s1: 0.5, s2: 0.4, s3: 0.1 }, 2), row(newCert(), 3)];
    expect(await e.applyCertRows(lines, 'rev.xlsx')).toMatch(/^บันทึกแล้ว/);
    // the dataset row changed; the new certificate waits in the queue and is not in the registry
    expect(counts(e)).toEqual({ ...before, waiting: 1 });
    expect(certFields(e.B.certs[i], e.B.CD).s1).toBe(0.5);
    expect(waitingCerts(e)).toEqual(['REV-1']);
    expect(e.B.certs.some((c) => c.cert === 'REV-1')).toBe(false);
    await e.revertUpload();
    expect(counts(e)).toEqual(before);
    expect(certFields(e.B.certs[i], e.B.CD).s1).toBe(first.s1);
    expect(e.base.source).toBe('file');
  });

  it('a sheet row that changes a certificate the queue accepted is refused with its reason, and nothing changes', async () => {
    const e = engine();
    accept(e, '99001', 'FEED-1', 0.2);
    const held = certFields(e.B.certs.find((c) => c.cert === 'FEED-1')!, e.B.CD);
    expect(held.s1).toBe(0.2);
    const plan = e.certPlan([row({ ...held, s1: 0.5 })]);
    expect(plan.changed).toEqual([]);
    expect(plan.errors).toEqual([{ rowNo: 2, reason: expect.stringContaining('แก้จากไฟล์นี้ไม่ได้') }]);
    const before = counts(e);
    expect(await e.applyCertRows([row({ ...held, s1: 0.5 })], 'rev.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก');
    expect(counts(e)).toEqual(before);
    expect(e.tgo['99001'].st).toBe('a');
    expect(certFields(e.B.certs.find((c) => c.cert === 'FEED-1')!, e.B.CD).s1).toBe(0.2);
  });

  it('a pull that comes after the save stays through the revert', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    feedServes([feedRow({ id: '99002', cert: 'FEED-LATER', org: 'บริษัท ป้อนทีหลัง จำกัด', addr: '1 ถนนทดสอบ', zip: '10110', changwat: 'ชลบุรี', ind: 'อาหาร', size: 'SME', s1: 0.5, s2: 0.5, s3: 0 })]);
    await e.runSync(false);
    expect(waitingCerts(e)).toEqual(['FEED-LATER', 'REV-1']);
    await e.revertUpload();
    expect(waitingCerts(e)).toEqual(['FEED-LATER']);
  });
});

describe('a sheet certificate waits in the TGO review queue', () => {
  it('a save creates one waiting row, and the registry does not show it or its company', async () => {
    const e = engine();
    const co = newCert().org;
    expect(e.B.companies.some((c) => c.name === co)).toBe(false);
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    expect(e.tgoRows('p')).toHaveLength(1);
    expect(e.tgoRows('p')[0].rec).toMatchObject({ st: 'p', cert: 'REV-1', org: co, gid: null });
    expect(e.B.certs.some((c) => c.cert === 'REV-1')).toBe(false);
    expect(e.B.companies.some((c) => c.name === co)).toBe(false);
  });

  it('approving puts the certificate and its company in the registry', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    const [{ rid }] = e.tgoRows('p');
    expect(e.approveTgo([rid])).toBe(1);
    expect(e.B.certs.some((c) => c.cert === 'REV-1')).toBe(true);
    expect(e.B.companies.some((c) => c.name === newCert().org)).toBe(true);
    expect(e.tgoRows('p')).toHaveLength(0);
  });

  it('rejecting keeps the certificate out of the registry, and a later save of the same row does not queue it again', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    const [{ rid }] = e.tgoRows('p');
    expect(e.rejectTgo([rid])).toBe(1);
    expect(e.B.certs.some((c) => c.cert === 'REV-1')).toBe(false);
    expect(e.B.companies.some((c) => c.name === newCert().org)).toBe(false);
    expect(await e.applyCertRows([row(newCert())], 'rev.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(e.tgoRows('p')).toHaveLength(0);
    expect(e.tgoRows('r').map((r) => r.rec.cert)).toEqual(['REV-1']);
  });

  it('a feed row and a sheet row for the same certificate give one row, whichever came first', async () => {
    // the feed first: the sheet row (same TGO id, or same number and organisation) adds nothing
    const e = engine();
    feedServes([feedRow({ id: '99010', cert: 'REV-2', org: 'บริษัท ทดสอบซ้ำ จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME', s1: 1, s2: 0, s3: 0 })]);
    await e.runSync(false);
    expect(waitingCerts(e)).toEqual(['REV-2']);
    // the sheet carries the pulled row's values: a row that changes a queued certificate is refused, not counted as waiting
    const sameInSheet = newCert({ cert: 'REV-2', org: 'บริษัท ทดสอบซ้ำ จำกัด', webId: '99010', branch: '', addr: '1 ถนนทดสอบ', prov: 'ชลบุรี', ind: 'การผลิต', size: 'SME', ap: '2026-02-01', ex: '2027-01-31', s1: 1, s2: 0, s3: 0, fy: 'FY27' });
    expect(e.certPlan([row(sameInSheet)]).waiting.map((w) => w.st)).toEqual(['p']);
    expect(await e.applyCertRows([row(sameInSheet)], 'rev.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(waitingCerts(e)).toEqual(['REV-2']);
    // the sheet first: a pull of the same certificate (no TGO id in the sheet) adds nothing
    const f = engine();
    await f.applyCertRows([row(newCert({ cert: 'REV-3', org: 'บริษัท ทดสอบซ้ำ จำกัด' }))], 'rev.xlsx');
    feedServes([feedRow({ id: '99011', cert: 'REV-3', org: 'บริษัท ทดสอบซ้ำ จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME' })]);
    await f.runSync(false);
    expect(waitingCerts(f)).toEqual(['REV-3']);
  });

  it('a second save of the same sheet row adds nothing', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    const rids = e.tgoRows('p').map((r) => r.rid);
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    expect(e.tgoRows('p').map((r) => r.rid)).toEqual(rids);
    expect(e.certImports).toHaveLength(1);
  });

  it('a waiting row is kept in the store with its save, so it is still there after a reload', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    await tick();
    const saved = await e.store.get<Record<string, { st: string; cert: string }>>('tgoRecs');
    expect(Object.values(saved!).map((r) => [r.st, r.cert])).toEqual([['p', 'REV-1']]);
    const imports = await e.store.get<{ rids: string[] }[]>('certImports');
    expect(imports![0].rids).toEqual(e.tgoRows('p').map((r) => r.rid));
  });

  it('a revert removes the waiting rows of this save and says how many decided rows it kept', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert({ cert: 'REV-A', org: 'บริษัท ก ทดสอบ จำกัด' })), row(newCert({ cert: 'REV-B', org: 'บริษัท ข ทดสอบ จำกัด' }), 3)], 'b.xlsx');
    const a = e.tgoRows('p').find((r) => r.rec.cert === 'REV-A')!;
    expect(e.approveTgo([a.rid])).toBe(1);
    await e.revertUpload();
    expect(e.tgoRows('p')).toHaveLength(0);
    expect(e.tgoRows('a').map((r) => r.rec.cert)).toEqual(['REV-A']);
    expect(e.B.certs.some((c) => c.cert === 'REV-A')).toBe(true);
    expect(e.B.certs.some((c) => c.cert === 'REV-B')).toBe(false);
    expect(e.up.msg).toContain('ลบใบที่รอตรวจจากการบันทึกชีต 1 ใบ');
    expect(e.up.msg).toContain('คงไว้ 1 ใบ');
  });

  it('a viewer cannot save: refused with nothing written', async () => {
    const e = engine();
    const before = counts(e);
    vi.spyOn(e, 'can').mockReturnValue(false);
    expect(await e.applyCertRows([row(newCert())], 'x.xlsx')).toBe('บัญชีของคุณไม่มีสิทธิ์นำเข้าข้อมูล');
    expect(e.tgo).toEqual({});
    expect(e.certImports).toEqual([]);
    expect(counts(e)).toEqual(before);
  });
});

describe('set.data gates the old full workbook and the revert as it gates the sheet', () => {
  it('a save, an apply of the full workbook and a revert are refused without set.data, and nothing changes', async () => {
    const e = engine();
    const before = counts(e);
    const base0 = e.base;
    vi.spyOn(e, 'can').mockReturnValue(false);
    expect(await e.applyCertRows([row(newCert())], 'x.xlsx')).toBe('บัญชีของคุณไม่มีสิทธิ์นำเข้าข้อมูล');
    (e as unknown as { pendingUpload: unknown }).pendingUpload = { base: { ...base0, certs: [] }, details: {} };
    await e.applyUpload();
    expect(e.base).toBe(base0);
    await e.revertUpload();
    expect(e.base).toBe(base0);
    expect(counts(e)).toEqual(before);
  });
});

describe('the certificate sheet against the queue and the registry', () => {
  it('a changed row for a waiting certificate is refused with its reason, and the queued record stays', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    const changed = newCert({ s1: 0.5, s2: 0.4 });
    expect(e.certPlan([row(changed)])).toMatchObject({ waiting: [], news: [], errors: [{ rowNo: 2, reason: expect.stringContaining('แก้จากไฟล์นี้ไม่ได้') }] });
    expect(await e.applyCertRows([row(changed)], 'rev.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก');
    expect(e.tgoRows('p').map((r) => r.rec.s1)).toEqual([0.6]);
  });

  it('a registry certificate saved again unchanged is the same: its province, FY, size and the import note do not count as edits', async () => {
    const e = engine();
    const f = newCert({ cert: 'REV-F', org: 'บริษัท ฟ ทดสอบ จำกัด', prov: 'กรุงเทพมหานคร', fy: 'FY99', size: 'ขนาดทดสอบพิเศษ' });
    await e.applyCertRows([row(f)], 'rev.xlsx');
    expect(e.approveTgo(e.tgoRows('p').map((r) => r.rid))).toBe(1);
    expect(certFields(e.B.certs.find((c) => c.cert === 'REV-F')!, e.B.CD)).toMatchObject({ fy: 'FY99', size: 'ขนาดทดสอบพิเศษ' });
    const plan = e.certPlan([row(f)]);
    expect(plan.errors).toEqual([]);
    expect(plan.changed).toEqual([]);
    expect(plan.same).toBe(1);
  });

  it('a feed row and a sheet row for one certificate give one row, when the feed repeats the บริษัท prefix', async () => {
    const e = engine();
    // no TGO id on the feed row: the sheet row is matched by number and organisation, the key the repeated prefix must not break
    feedServes([feedRow({ cert: 'REV-P', org: 'บริษัท บริษัท ทดสอบซ้ำ จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME', s1: 1, s2: 0, s3: 0 })]);
    await e.runSync(false);
    expect(waitingCerts(e)).toEqual(['REV-P']);
    // the sheet row carries the pulled row's values (a row that changes a queued certificate is refused, not waiting)
    const sheet = newCert({ cert: 'REV-P', org: 'บริษัท ทดสอบซ้ำ จำกัด', branch: '', addr: '1 ถนนทดสอบ', prov: 'ชลบุรี', size: 'SME', ap: '2026-02-01', ex: '2027-01-31', s1: 1, s2: 0, s3: 0, fy: 'FY27' });
    const plan = e.certPlan([row(sheet)]);
    expect(plan.errors).toEqual([]);
    expect(plan.news).toEqual([]);
    expect(plan.waiting.map((w) => [w.rowNo, w.st])).toEqual([[2, 'p']]);
    expect(await e.applyCertRows([row(sheet)], 'rev.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(waitingCerts(e)).toEqual(['REV-P']);
    const f = engine();
    await f.applyCertRows([row(newCert({ cert: 'REV-Q', org: 'บริษัท ทดสอบซ้ำ จำกัด' }))], 'rev.xlsx');
    feedServes([feedRow({ id: '99041', cert: 'REV-Q', org: 'บริษัท บริษัท ทดสอบซ้ำ จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME' })]);
    await f.runSync(false);
    expect(waitingCerts(f)).toEqual(['REV-Q']);
  });

  it('a waiting certificate whose organisation has a leading space: an unchanged re-save of its row is no change, refused or saved', async () => {
    const e = engine();
    // a queued certificate stored with a leading space before the repeated บริษัท prefix: the queue reads its name with fixName,
    // which keeps the prefix, so the sheet's name (one prefix) must not count as a change of the organisation
    e.tgo['99070'] = {
      cert: 'REV-L', org: ' บริษัท บริษัท ทดสอบช่องว่าง จำกัด', act: 'การผลิต', branch: '', prov: 'ชลบุรี', apBE: '', exBE: '', ap: '2025-02-01', ex: '2027-02-01', fy: 'FY27', id: '99070',
      addr: '', zip: '', changwat: 'ชลบุรี', ind: '', size: '', s1: 0.6, s2: null, s3: null, st: 'p', gid: null, by: '', at: '', note: '',
    } as TgoRec;
    e.rebuild();
    // the row an export of this certificate reads back to: the same values as the queue holds, the organisation as the sheet reads it
    const sheet = newCert({ cert: 'REV-L', org: 'บริษัท ทดสอบช่องว่าง จำกัด', branch: '', prov: 'ชลบุรี', ind: '', size: '', ap: '2025-02-01', ex: '2027-02-01', s1: 0.6, s2: null, s3: null, fy: 'FY27', webId: '99070' });
    const plan = e.certPlan([row(sheet)]);
    expect(plan.errors).toEqual([]);
    expect(plan.changed).toEqual([]);
    expect(plan.news).toEqual([]);
    expect(plan.waiting.map((w) => [w.rowNo, w.st])).toEqual([[2, 'p']]);
    const set = vi.spyOn(e.store, 'set');
    expect(await e.applyCertRows([row(sheet)], 'rev.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(set.mock.calls.some(([k]) => k === 'dataset')).toBe(false);
    expect(waitingCerts(e)).toEqual(['REV-L']);
    expect(e.tgo['99070'].st).toBe('p');
  });

  it('a sheet row whose web id belongs to another queued certificate is queued as its own certificate, and that record stays', async () => {
    const e = engine();
    feedServes([feedRow({ id: '99050', cert: 'FEED-B', org: 'บริษัท บี ทดสอบ จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME' })]);
    await e.runSync(false);
    expect(await e.applyCertRows([row(newCert({ cert: 'SHEET-C', org: 'บริษัท ซี ทดสอบ จำกัด', webId: '99050' }))], 'c.xlsx')).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    expect(waitingCerts(e)).toEqual(['FEED-B', 'SHEET-C']);
    expect(e.tgo['99050'].cert).toBe('FEED-B');
  });

  it('a sheet row saved with a typed web id first does not block a pulled certificate with that id: both stay queued', async () => {
    const e = engine();
    const sheet = newCert({ cert: 'SHEET-C', org: 'บริษัท ซี ทดสอบ จำกัด', webId: '99050' });
    expect(await e.applyCertRows([row(sheet)], 'c.xlsx')).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    feedServes([feedRow({ id: '99050', cert: 'FEED-B', org: 'บริษัท บี ทดสอบ จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME' })]);
    await e.runSync(false);
    expect(waitingCerts(e)).toEqual(['FEED-B', 'SHEET-C']);
    // the sheet row still means its own record: saved again unchanged, it adds nothing and is still waiting
    expect(await e.applyCertRows([row(sheet)], 'c.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(waitingCerts(e)).toEqual(['FEED-B', 'SHEET-C']);
  });

  it('a sheet row whose organisation differs from a queued one only by its legal form is another certificate: queued once, and a second save adds nothing', async () => {
    const e = engine();
    const ltd = newCert({ cert: 'NUM-ABC', org: 'บริษัท ABC จำกัด' }), plain = newCert({ cert: 'NUM-ABC', org: 'บริษัท ABC' });
    expect(await e.applyCertRows([row(ltd)], 'a.xlsx')).toMatch(/เข้ารอตรวจ 1 ใบ/);
    // in one sheet with the queued one: the plain row is a new certificate and the queued row waits, not a duplicate of it
    const both = e.certPlan([row(plain, 2), row(ltd, 3)]);
    expect(both.errors).toEqual([]);
    expect(both.news.map((n) => n.rowNo)).toEqual([2]);
    expect(both.waiting.map((w) => w.rowNo)).toEqual([3]);
    // the plain row is queued once, and saved again it adds nothing
    expect(await e.applyCertRows([row(plain)], 'a.xlsx')).toMatch(/เข้ารอตรวจ 1 ใบ/);
    expect(e.tgoRows('p').map((r) => r.rec.org).sort()).toEqual(['บริษัท ABC', 'บริษัท ABC จำกัด']);
    expect(await e.applyCertRows([row(plain)], 'a.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(e.tgoRows('p')).toHaveLength(2);
  });

  it('a row copying a held certificate\'s web id and organisation with another number is a new certificate: the held one is kept as it was', async () => {
    const e = engine();
    const held = e.B.certs.find((c) => c.webId === '32040')!;
    expect(held).toBeDefined();
    const before = certFields(held, e.B.CD);
    const copy: CertFields = { ...before, cert: 'NEWNO-9', s1: 0.9 };
    expect(e.certPlan([row(copy)])).toMatchObject({ changed: [], errors: [], news: [{ f: { cert: 'NEWNO-9' } }] });
    expect(await e.applyCertRows([row(copy)], 'copy.xlsx')).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    expect(waitingCerts(e)).toEqual(['NEWNO-9']);
    expect(certFields(e.B.certs.find((c) => c.webId === '32040')!, e.B.CD)).toEqual(before);
    expect(e.B.certs.some((c) => c.cert === 'NEWNO-9')).toBe(false);
  });

  it('a sheet row with a queued certificate\'s web id and organisation but another number waits as its own certificate; a pull after it does not queue it again', async () => {
    const e = engine();
    feedServes([feedRow({ id: '77001', cert: 'PA-1', org: 'บริษัท พีเอ ทดสอบ จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME' })]);
    await e.runSync(false);
    expect(waitingCerts(e)).toEqual(['PA-1']);
    const sheet = newCert({ cert: 'PA-2', org: 'บริษัท พีเอ ทดสอบ จำกัด', webId: '77001' });
    expect(e.certPlan([row(sheet)])).toMatchObject({ errors: [], waiting: [], news: [{ f: { cert: 'PA-2' } }] });
    expect(await e.applyCertRows([row(sheet)], 'pa.xlsx')).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    expect(waitingCerts(e)).toEqual(['PA-1', 'PA-2']);
    expect(e.tgo['77001'].cert).toBe('PA-1');
  });

  it('a pulled certificate whose web id a sheet row holds, with another number, is queued as its own certificate, and the next pull does not queue it again', async () => {
    const e = engine();
    expect(await e.applyCertRows([row(newCert({ cert: 'PA-2', org: 'บริษัท พีเอ ทดสอบ จำกัด', webId: '77001' }))], 'pa.xlsx')).toMatch(/^บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    feedServes([feedRow({ id: '77001', cert: 'PA-1', org: 'บริษัท พีเอ ทดสอบ จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME' })]);
    await e.runSync(false);
    expect(waitingCerts(e)).toEqual(['PA-1', 'PA-2']);
    expect(e.tgo['77001'].cert).toBe('PA-2');
    await e.runSync(false);
    expect(waitingCerts(e)).toEqual(['PA-1', 'PA-2']);
  });

  it('a pull that lands during a save\'s dataset write does not queue the same certificate twice', async () => {
    const e = engine();
    const real = e.store;
    e.store = {
      ...real,
      set: async (k: string, v: unknown) => {
        if (k === 'dataset') {
          feedServes([feedRow({ id: '99060', cert: 'REV-S', org: 'บริษัท ทดสอบแข่ง จำกัด', addr: '1 ถนนทดสอบ', ind: 'การผลิต', size: 'SME' })]);
          await e.runSync(false);
        }
        return real.set(k, v);
      },
    };
    const i = e.B.certs.findIndex((c) => c.s1 != null);
    const first = certFields(e.B.certs[i], e.B.CD);
    await e.applyCertRows([row({ ...first, s1: 0.5, s2: 0.4, s3: 0.1 }, 2), row(newCert({ cert: 'REV-S', org: 'บริษัท ทดสอบแข่ง จำกัด' }), 3)], 'rev.xlsx');
    expect(waitingCerts(e)).toEqual(['REV-S']);
  });

  it('a save of new certificates only can be reverted: its waiting rows go', async () => {
    const e = engine();
    const before = counts(e);
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    expect(e.base.source).toBe('file');
    expect(e.certImports).toHaveLength(1);
    await e.revertUpload();
    expect(counts(e)).toEqual(before);
    expect(e.certImports).toEqual([]);
  });

  it('a revert keeps the company an accepted row from the same save now goes to', async () => {
    const e = engine();
    const i = e.B.certs.findIndex((c) => c.s1 != null);
    const first = certFields(e.B.certs[i], e.B.CD);
    const moved = 'บริษัท ย้ายไป จำกัด';
    await e.applyCertRows([row({ ...first, org: moved }, 2), row(newCert({ cert: 'REV-M', org: moved }), 3)], 'm.xlsx');
    const co = e.B.companies.find((c) => c.name === moved)!;
    const [{ rid }] = e.tgoRows('p');
    expect(e.approveTgo([rid])).toBe(1);
    await e.revertUpload();
    expect(e.tgo[rid].gid).toBe(co.id);
    expect(e.B.companies.some((c) => c.id === co.id)).toBe(true);
    expect(e.B.certs.find((c) => c.cert === 'REV-M')?.gid).toBe(co.id);
  });

  it('a revert that would remove waiting rows needs the queue right too, and removes nothing without it', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    vi.spyOn(e, 'can').mockImplementation((cap) => cap !== 'edit.cust');
    await e.revertUpload();
    expect(e.tgoRows('p')).toHaveLength(1);
  });
});
