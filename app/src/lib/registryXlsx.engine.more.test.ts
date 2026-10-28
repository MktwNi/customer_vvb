/**
 * The certificate sheet, the second half: the sheet against the queue and the registry, then the review list, the e-mail and
 * the report of a sheet save, with the export. The first half is in registryXlsx.engine.test.ts; the shared setup is in
 * registryXlsx.engine.helpers.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { certFields, type CertFields, type CertLine } from './registryXlsx';
import { gccCode } from './format';
import type { TgoRec } from './tgoSync';
import { counts, engine, feedRow, feedServes, newCert, row, stubBrowserGlobals, waitingCerts } from './registryXlsx.engine.helpers';

vi.setConfig({ testTimeout: 30000 });
beforeEach(stubBrowserGlobals);
afterEach(() => vi.unstubAllGlobals());

describe('the certificate sheet against the queue and the registry', () => {
  it('a changed row for a waiting certificate is refused with its reason, and the queued record stays', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert())], 'rev.xlsx');
    const changed = newCert({ s1: 0.5, s2: 0.4 });
    expect(e.certPlan([row(changed)])).toMatchObject({ waiting: [{ rowNo: 2, st: 'p' }], news: [], errors: [] });
    expect(e.certPlan([row(changed)]).log[0]).toMatchObject({ action: 'refused' });
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

  it('a sheet row whose organisation differs from a queued one only by its legal form is the same certificate (its number is unique): queued once, and a second save adds nothing', async () => {
    const e = engine();
    const ltd = newCert({ cert: 'NUM-ABC', org: 'บริษัท ABC จำกัด' }), plain = newCert({ cert: 'NUM-ABC', org: 'บริษัท ABC' });
    expect(await e.applyCertRows([row(ltd)], 'a.xlsx')).toMatch(/เข้ารอตรวจ 1 ใบ/);
    // in one sheet with the queued one: the queued row is already queued, and the plain spelling is the same certificate
    // (the unique-number fallback), refused for its other spelling: nothing is queued twice
    const both = e.certPlan([row(plain, 2), row(ltd, 3)]);
    expect(both.errors).toEqual([]);
    expect(both.news).toEqual([]);
    expect(both.waiting.map((w) => w.rowNo)).toEqual([2, 3]);
    expect(await e.applyCertRows([row(plain)], 'a.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก');
    expect(e.tgoRows('p').map((r) => r.rec.org)).toEqual(['บริษัท ABC จำกัด']);
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

describe('the review list, the e-mail and the report of a sheet save (owner v2)', () => {
  it('a row whose company is not in the app is kept for review once: the same row again is already in review, and nothing is made', async () => {
    const e = engine();
    const unknown = newCert({ cert: 'RV-1', org: 'บริษัท ไม่มีในระบบ จำกัด' });
    expect(await e.applyCertRows([row(unknown)], 'rv.xlsx')).toMatch(/รอตรวจสอบ 1 ใบ/);
    expect(e.reviewRecs()).toMatchObject([{ st: 'p', cert: 'RV-1', reason: 'ไม่พบบริษัทในระบบ', file: 'rv.xlsx' }]);
    expect(e.tgoRows('p')).toHaveLength(0);
    expect(e.B.companies.some((c) => c.name === unknown.org)).toBe(false);
    expect(e.certPlan([row(unknown)]).log[0].action).toBe('already in review');
    expect(await e.applyCertRows([row(unknown)], 'rv.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก');
    expect(e.reviewRecs()).toHaveLength(1);
  });

  it('accepting a review row attaches it, as a queue row, to the company the reviewer chooses; rejecting one keeps it declined before', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert({ cert: 'RV-2', org: 'บริษัท ไม่มีในระบบ จำกัด' }))], 'rv.xlsx');
    const [rec] = e.reviewRecs();
    const co = e.B.companies.find((c) => c.name === newCert().org)!;
    expect(await e.acceptReview(rec.id, co.id)).toMatch(/^รับแล้ว · บันทึกแล้ว: เข้ารอตรวจ 1 ใบ/);
    expect(e.reviewRecs()[0]).toMatchObject({ st: 'a', co: co.id });
    expect(e.tgoRows('p')).toEqual([expect.objectContaining({ rec: expect.objectContaining({ cert: 'RV-2', gid: co.id }) })]);
    expect(e.B.companies.filter((c) => c.name === co.name)).toHaveLength(1);
    // a second row, rejected: kept as rejected, and the same row is declined before
    const r3 = newCert({ cert: 'RV-3', org: 'บริษัท ไม่มีในระบบ จำกัด' });
    await e.applyCertRows([row(r3)], 'rv.xlsx');
    const rec3 = e.reviewRecs().find((r) => r.st === 'p')!;
    expect(e.rejectReview(rec3.id)).toBe('ไม่รับแล้ว');
    expect(e.reviewRecs().find((r) => r.id === rec3.id)).toMatchObject({ st: 'r' });
    expect(e.certPlan([row(r3)]).log[0].action).toBe('declined before');
    expect(await e.acceptReview(rec3.id, co.id)).toBe('รายการนี้ตัดสินไปแล้ว');
  });

  it('a review row cannot be accepted for no company, or for a device-local one (R16)', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert({ cert: 'RV-4', org: 'บริษัท ไม่มีในระบบ จำกัด' }))], 'rv.xlsx');
    const [rec] = e.reviewRecs();
    const refused = 'บริษัทนี้ไม่มีในระบบ หรือเก็บไว้ในเครื่องนี้เท่านั้น รับเข้าไม่ได้';
    expect(await e.acceptReview(rec.id, 0)).toBe(refused);
    expect(await e.acceptReview(rec.id, 900001)).toBe(refused);
    expect(e.reviewRecs()[0].st).toBe('p');
  });

  it('accepting a review row for a held certificate of another company is refused and the record stays waiting; for the certificate\'s own company it is accepted (R3e, R16)', async () => {
    const e = engine();
    const i = e.B.certs.findIndex((c) => c.cert && c.org && c.ap && c.ex && c.cid < e.base.certs.length);
    const held = e.B.certs[i];
    const own = e.canonical(held.gid);
    const other = e.B.companies.find((c) => c.name === 'บริษัท ABC จำกัด')!;
    expect(other.id).not.toBe(own);
    // the held certificate's values, with the GCC code of another company: the row goes to review (R3e), the certificate is not moved
    const f = certFields(held, e.B.CD);
    expect(await e.applyCertRows([{ ...row(f), gcc: gccCode(other.id) }], 'hv.xlsx')).toMatch(/รอตรวจสอบ 1 ใบ/);
    const [rec] = e.reviewRecs();
    expect(rec).toMatchObject({ st: 'p', reason: 'รหัส GCC ไม่ตรงกับบริษัทของใบรับรองนี้' });
    const before = counts(e);
    expect(await e.acceptReview(rec.id, other.id)).toBe('ยังรับไม่ได้: รหัส GCC ไม่ตรงกับบริษัทของใบรับรองนี้');
    expect(e.reviewRecs()[0].st).toBe('p');
    expect(counts(e)).toEqual(before);
    expect(e.B.certs[i].gid).toBe(held.gid);
    // the certificate's own company: the row matches it as it is, so the record is accepted
    expect(await e.acceptReview(rec.id, own)).toMatch(/^รับแล้ว/);
    expect(e.reviewRecs()[0]).toMatchObject({ st: 'a', co: own });
  });

  it('accepting a review row whose certificate the queue rejected is refused, and the record stays waiting (R16)', async () => {
    const e = engine();
    const unknown = newCert({ cert: 'RV-8', org: 'บริษัท ไม่มีในระบบ จำกัด' });
    await e.applyCertRows([row(unknown)], 'rv.xlsx');
    const [rec] = e.reviewRecs();
    // the team rejected this certificate in the queue
    e.tgo['rej-1'] = {
      cert: 'RV-8', org: unknown.org, act: unknown.act, branch: '', prov: '', apBE: '', exBE: '', ap: unknown.ap, ex: unknown.ex, fy: '', id: '',
      addr: '', zip: '', changwat: '', ind: '', size: '', s1: null, s2: null, s3: null, st: 'r', gid: null, by: '', at: '', note: '',
    } as TgoRec;
    e.rebuild();
    const co = e.B.companies.find((c) => c.name === newCert().org)!;
    expect(await e.acceptReview(rec.id, co.id)).toBe('ยังรับไม่ได้: ถูกปฏิเสธไว้แล้ว ไม่เพิ่มซ้ำ');
    expect(e.reviewRecs()[0].st).toBe('p');
    expect(e.tgoRows('p')).toHaveLength(0);
  });

  it('a revert takes back the queue rows of its save and never a review record (R17)', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert({ cert: 'RV-5', org: 'บริษัท ไม่มีในระบบ จำกัด' })), row(newCert({ cert: 'RV-6' }), 3)], 'rv.xlsx');
    expect(e.reviewRecs().filter((r) => r.st === 'p')).toHaveLength(1);
    expect(e.tgoRows('p')).toHaveLength(1);
    await e.revertUpload();
    expect(e.tgoRows('p')).toHaveLength(0);
    expect(e.reviewRecs().filter((r) => r.st === 'p')).toHaveLength(1);
  });

  it('an e-mail with status พบ fills an empty company e-mail through its contact record; a second save keeps it and changes nothing', async () => {
    const e = engine();
    const co = e.B.companies.find((c) => c.name === 'บริษัท ABC จำกัด')!;
    expect(co.email).toBe('');
    const line = { ...row(newCert({ cert: 'EM-1', org: 'บริษัท ABC จำกัด' })), gcc: '', email: 'x@x.co; y@x.co', emailSt: 'พบ' };
    expect(await e.applyCertRows([line], 'em.xlsx')).toMatch(/เพิ่มอีเมล 1 บริษัท/);
    expect(e.B.companies.find((c) => c.id === co.id)!.email).toBe('x@x.co | y@x.co');
    expect(e.contacts[co.id]).toMatchObject({ email: 'x@x.co | y@x.co' });
    expect(await e.applyCertRows([line], 'em.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
  });

  it('the save keeps its change report with the import record (R14)', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert({ cert: 'LG-1' })), row(newCert({ cert: 'LG-2', org: 'บริษัท ไม่มีในระบบ จำกัด' }), 3)], 'lg.xlsx');
    const rec = e.certImports[e.certImports.length - 1];
    expect(rec.log?.map((l) => [l.row, l.action])).toEqual([[2, 'queued'], [3, 'review']]);
    expect(rec.log?.[0]).toMatchObject({ cert: 'LG-1', company: newCert().org, co: expect.any(Number) });
  });

  it('an export of a certificate a sheet saved and the queue accepted carries the sheet\'s own note, and its re-import changes nothing (R12, R13)', async () => {
    const e = engine();
    await e.applyCertRows([row(newCert({ cert: 'EX-1', webId: '' }))], 'ex.xlsx');
    const [{ rid }] = e.tgoRows('p');
    expect(e.approveTgo([rid])).toBe(1);
    const rows = e.certExportRows().filter((r) => r.f.cert === 'EX-1');
    expect(rows).toHaveLength(1);
    // the app's import tag is not part of the sheet's note
    expect(rows[0].f.note).toBe('');
    const lines: CertLine[] = rows.map((r, i) => ({ rowNo: i + 2, f: r.f, errors: [], gcc: r.gcc, email: r.email, emailSt: '' }));
    expect(e.certPlan(lines).log.map((l) => l.action)).toEqual(['attached']);
  });

  it('the export carries each certificate\'s company code and e-mail (R12)', () => {
    const e = engine();
    const rows = e.certExportRows();
    expect(rows).toHaveLength(e.B.certs.length);
    const c = e.B.certs[0];
    const co = e.B.byId.get(e.canonical(c.gid))!;
    expect(rows[0]).toMatchObject({ gcc: gccCode(co.id), email: co.email });
  });
});

// v3 (owner rule R8): the company's e-mail is the union of its own addresses and the sheet's new ones, written through its contact record
describe('the company e-mail union through the contact record (R8, v3)', () => {
  const abc = (e: ReturnType<typeof engine>) => e.B.companies.find((c) => c.name === 'บริษัท ABC จำกัด')!;
  const emailOfCo = (e: ReturnType<typeof engine>, id: number) => e.B.companies.find((c) => c.id === id)!.email;

  it('a company with one e-mail A and a sheet e-mail B is saved as "A | B" through its contact record, and the report says filled', async () => {
    const e = engine();
    const co = abc(e);
    e.saveContact(co, { phone: '', email: 'a@example.test', web: '', note: '' });
    const line = { ...row(newCert({ cert: 'UN-1', org: 'บริษัท ABC จำกัด' })), gcc: '', email: 'b@example.test', emailSt: 'พบ' };
    expect(await e.applyCertRows([line], 'un.xlsx')).toMatch(/เพิ่มอีเมล 1 บริษัท/);
    expect(emailOfCo(e, co.id)).toBe('a@example.test | b@example.test');
    expect(e.contacts[co.id]).toMatchObject({ email: 'a@example.test | b@example.test' });
    expect(e.certImports[e.certImports.length - 1].log?.[0].email).toEqual({ action: 'filled', from: 'a@example.test', to: 'a@example.test | b@example.test' });
  });

  it('a sheet e-mail the company holds already, in any case, writes nothing: the contact record keeps its value', async () => {
    const e = engine();
    const co = abc(e);
    e.saveContact(co, { phone: '', email: 'a@example.test', web: '', note: '' });
    const cert = newCert({ cert: 'KP-1', org: 'บริษัท ABC จำกัด' });
    await e.applyCertRows([row(cert)], 'kp.xlsx');
    const before = JSON.stringify(e.contacts[co.id]);
    const line = { ...row(cert), gcc: '', email: 'A@Example.TEST', emailSt: 'พบ' };
    expect(e.certPlan([line]).emails).toEqual([expect.objectContaining({ action: 'kept', to: 'a@example.test' })]);
    expect(await e.applyCertRows([line], 'kp.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(JSON.stringify(e.contacts[co.id])).toBe(before);
    expect(emailOfCo(e, co.id)).toBe('a@example.test');
  });

  it('two rows of one company with B and C write the company e-mail once, with both; a second save of the file writes nothing (R13)', async () => {
    const e = engine();
    const co = abc(e);
    e.saveContact(co, { phone: '', email: 'a@example.test', web: '', note: '' });
    const lines = [
      { ...row(newCert({ cert: 'UN-2', org: 'บริษัท ABC จำกัด' }), 2), gcc: '', email: 'b@example.test', emailSt: 'พบ' },
      { ...row(newCert({ cert: 'UN-3', org: 'บริษัท ABC จำกัด' }), 3), gcc: '', email: 'c@example.test; B@example.test', emailSt: 'พบ' },
    ];
    expect(await e.applyCertRows(lines, 'un2.xlsx')).toMatch(/เพิ่มอีเมล 1 บริษัท/);
    expect(emailOfCo(e, co.id)).toBe('a@example.test | b@example.test | c@example.test');
    expect(await e.applyCertRows(lines, 'un2.xlsx')).toBe('ไม่มีการเปลี่ยนแปลงให้บันทึก (ใบที่อยู่ในรายการ TGO แล้วไม่เพิ่มซ้ำ)');
    expect(emailOfCo(e, co.id)).toBe('a@example.test | b@example.test | c@example.test');
  });
});
