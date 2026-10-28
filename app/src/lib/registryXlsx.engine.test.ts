/**
 * The certificate sheet in the engine. A new TGO certificate in a save waits in the review queue (tgoRecs, 'p'), as a
 * feed pull's does, and enters the registry only when a reviewer accepts it. A save changes nothing else in the registry
 * except the dataset's own rows (saved and reverted as before). A revert takes back the queue rows this save made that
 * still wait, and keeps the rows the team decided since and every row a pull brought in. The old full workbook needs the
 * set.data cap like the sheet does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { certFields, type CertLine } from './registryXlsx';
import type { TgoRec } from './tgoSync';
import { accept, counts, engine, feedRow, feedServes, newCert, row, stubBrowserGlobals, tick, waitingCerts } from './registryXlsx.engine.helpers';

vi.setConfig({ testTimeout: 30000 });
beforeEach(stubBrowserGlobals);
afterEach(() => vi.unstubAllGlobals());

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
    // the row is reported as refused in the change report (R7); it is not an error row
    expect(plan.errors).toEqual([]);
    expect(plan.log[0]).toMatchObject({ action: 'refused', msg: expect.stringContaining('แก้จากไฟล์นี้ไม่ได้') });
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
  it('a save creates one waiting row, and the registry does not show it; the row keeps the company it names, and no company is made', async () => {
    const e = engine();
    const co = e.B.companies.find((c) => c.name === newCert().org)!;
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    expect(e.tgoRows('p')).toHaveLength(1);
    expect(e.tgoRows('p')[0].rec).toMatchObject({ st: 'p', cert: 'REV-1', org: co.name, gid: co.id });
    expect(e.B.certs.some((c) => c.cert === 'REV-1')).toBe(false);
    expect(e.B.companies.filter((c) => c.name === co.name)).toHaveLength(1);
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

  it('a sheet row an older build saved with no company attaches to the one shared company its name matches, and makes none; with no match it waits (R1)', async () => {
    const e = engine();
    const co = e.B.companies.find((c) => c.name === 'บริษัท ABC จำกัด')!;
    await e.applyCertRows([row(newCert({ cert: 'OLD-1', org: 'บริษัท ABC จำกัด' }))], 'old.xlsx');
    const [{ rid }] = e.tgoRows('p');
    // the older build kept the row with no company: the import tag stays in its note
    e.tgo[rid] = { ...e.tgo[rid], gid: null };
    e.rebuild();
    const cos = e.B.companies.length;
    expect(e.approveTgo([rid])).toBe(1);
    expect(e.tgo[rid]).toMatchObject({ st: 'a', gid: co.id });
    expect(e.B.companies.length).toBe(cos);
    // a row with no company whose name matches none: it stays waiting, and no company is made
    e.tgo['legacy-2'] = {
      cert: 'OLD-2', org: 'บริษัท ไม่มีในระบบ จำกัด', act: '', branch: '', prov: '', apBE: '', exBE: '', ap: '2025-01-01', ex: '2027-01-01', fy: '', id: '',
      addr: '', zip: '', changwat: '', ind: '', size: '', s1: null, s2: null, s3: null, st: 'p', gid: null, by: '', at: '', note: 'นำเข้าจากไฟล์ old.xlsx 27/10/2569',
    } as TgoRec;
    e.rebuild();
    expect(e.approveTgo(['legacy-2'])).toBe(0);
    expect(e.tgo['legacy-2'].st).toBe('p');
    expect(e.B.companies.length).toBe(cos);
  });
  it('rejecting keeps the certificate out of the registry, and a later save of the same row does not queue it again', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    const [{ rid }] = e.tgoRows('p');
    expect(e.rejectTgo([rid])).toBe(1);
    expect(e.B.certs.some((c) => c.cert === 'REV-1')).toBe(false);
    expect(e.B.companies.filter((c) => c.name === newCert().org)).toHaveLength(1);
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
