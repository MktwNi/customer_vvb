import { describe, expect, it } from 'vitest';
import { build } from './core';
import { ACTION_TH, applyCertPlan, branchOfName, certKey, countLog, diffFields, exportSheets, gccIdOf, heldFrom, importNameKey, keepHeld, mergeCoEmail, planCertRows, readCertSheet, readCertSheetFull, readDateBE, readPct, sheetNoteOf, splitEmails, SHEET, SHEET_DESC, SHEET_HEADS, SHEET_TGO, templateSheets, workbookKind, type CertFields, type CertLine, type HeldCert, type PlanCtx } from './registryXlsx';
import { xlsxBytes, type XCell, type XSheet } from './xlsx';
import { parseXlsx } from './core';
import * as TGOSync from './tgoSync';
import type { Cert, CertDicts, Dataset } from './types';

const TODAY = '2026-10-26';
const F = (o: Partial<CertFields> = {}): CertFields => ({
  cert: 'CFO-1', org: 'บริษัท เอ จำกัด', branch: 'สำนักงานใหญ่', act: 'การผลิต', addr: '1 ถนนทดสอบ กรุงเทพมหานคร 10110', zip: '10110',
  prov: 'กรุงเทพมหานคร', ind: 'การผลิต', size: 'ขนาดเล็ก', ap: '2025-03-15', ex: '2027-03-14', fy: 'FY67', s1: 0.6, s2: 0.3, s3: 0.1,
  note: '', webId: '32040', ...o,
});
/** A sheet row of 27 cells, by header name. */
const row = (v: Record<string, XCell>) => SHEET_HEADS.map((h) => (h in v ? v[h] : null));
const sheetOf = (rows: XCell[][]): XSheet => ({ name: SHEET, head: SHEET_HEADS, rows });
const BASE_ROW = {
  'เลขที่ใบรับรอง': 'CFO-9', 'ชื่อองค์กร': 'บริษัท ทดสอบ จำกัด', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)': '15/03/2568', 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)': '14/03/2570',
};
const lines = async (rows: XCell[][]) => readCertSheet(await xlsxBytes([sheetOf(rows)]), SHEET);
/** The planner's context: the companies given (all shared, below the device-local range), the held certificates, and the
 *  queue, review and e-mail lookups the test sets (none by default). */
const ctxOf = (held: HeldCert[], companies: { id: number; name: string }[], extra: Partial<PlanCtx> = {}): PlanCtx => ({
  held, companies: companies.map((c) => ({ ...c, local: false })), canon: (id) => id, emailOf: () => '', queue: () => undefined, review: () => undefined, ...extra,
});
/** The planner on these rows, against the held certificates and companies given. */
const planWith = (ls: CertLine[], held: HeldCert[], companies: { id: number; name: string }[], extra: Partial<PlanCtx> = {}) =>
  planCertRows(ls, ctxOf(held, companies, extra));
/** The export of certificates that carry neither a GCC code nor an e-mail. */
const exportOf = (certs: CertFields[], today: string) => exportSheets(certs.map((f) => ({ f, gcc: '', email: '' })), today);

describe('template', () => {
  it('has the 27 TGO headers in order, one example row and the description sheet', () => {
    const [reg, desc] = templateSheets();
    expect(reg.name).toBe(SHEET);
    expect(reg.head).toHaveLength(27);
    expect(reg.head[0]).toBe('ลำดับ');
    expect(reg.head[13]).toBe('วันที่อนุมัติ (พ.ศ. ตามเว็บ)');
    expect(reg.head[26]).toBe('ข้อความเพิ่มเติมในการ์ด');
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0]).toHaveLength(27);
    expect(reg.rows[0][1]).toBe('CFO-EXAMPLE-0001');
    expect(reg.rows[0][13]).toBe('01/01/2568');
    expect(reg.rows[0][15]).toEqual({ date: '2025-01-01' });
    expect(reg.rows[0][17]).toBe('60%');
    expect(desc.name).toBe(SHEET_DESC);
    const required = desc.rows.filter((r) => r[2] === 'ต้องกรอก').map((r) => r[1]);
    expect(required).toEqual(['เลขที่ใบรับรอง', 'ชื่อองค์กร', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)', 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)']);
  });
  it('the example row reads back as one valid new certificate', async () => {
    const bytes = await xlsxBytes(templateSheets());
    const ls = await readCertSheet(bytes, SHEET);
    expect(ls).toHaveLength(1);
    expect(ls[0].errors).toEqual([]);
    expect(ls[0].f.ap).toBe('2025-01-01');
    expect(ls[0].f.s1).toBe(0.6);
  });
});

describe('export and round trip', () => {
  it('export, then import the same file: no new rows and no changed rows', async () => {
    const certs: CertFields[] = [
      F(),
      F({ cert: 'CFO-2', org: 'บริษัท บี จำกัด', s1: 0.5, s2: null, s3: null, zip: '01234', note: 'ทดสอบ & <หมายเหตุ> "1"', webId: '32041', ap: '2024-11-01', ex: '2026-10-31', fy: 'FY66' }),
      F({ cert: 'CFO-3', org: 'บริษัท ซี  จำกัด', webId: '', s1: null, s2: null, s3: null, branch: '', fy: '' }),
      F({ cert: 'CFO-4', org: 'บริษัท ดี จำกัด', webId: '40001', s1: 1, s2: 0, s3: 0, ap: '2026-01-10', ex: '2028-01-09' }),
    ];
    const bytes = await xlsxBytes(exportOf(certs, TODAY));
    const ls = await readCertSheet(bytes, SHEET);
    expect(ls).toHaveLength(4);
    expect(ls.flatMap((l) => l.errors)).toEqual([]);
    const held = certs.map((f, i) => ({ origin: i < 2 ? ('base' as const) : ('tgo' as const), idx: i < 2 ? i : i - 2, gid: 100 + i, f }));
    const plan = planWith(ls, held, held.map((h) => ({ id: h.gid, name: h.f.org })));
    expect(plan.read).toBe(4);
    expect(plan.news).toEqual([]);
    expect(plan.changed).toEqual([]);
    expect(plan.same).toBe(4);
    expect(plan.errors).toEqual([]);
  });
  it('a blank required cell is an error row (R2) unless the held certificate is blank in it too; a blank other cell keeps the held value', async () => {
    const companies = [{ id: 1, name: 'บริษัท เอ จำกัด' }];
    // no web id names the held certificate, so there is no held value to keep: the blank required cells are an error row
    const held = [{ origin: 'base' as const, idx: 0, gid: 1, f: F({ ex: '', cert: '', webId: '' }) }];
    const same = await readCertSheet(await xlsxBytes(exportOf([F({ ex: '', cert: '', webId: '' })], TODAY)), SHEET);
    expect(same[0].errors).toEqual([]);
    expect(planWith(same, held, companies)).toMatchObject({ news: [], changed: [], same: 0, errors: [{ rowNo: 2, reason: 'ต้องกรอก เลขที่ใบรับรอง · ต้องกรอก วันที่หมดอายุ (พ.ศ.)' }] });
    // the held certificate is named by its web id and is blank in those cells too: nothing to keep, so the row matches it (R2, R12)
    const named = [{ origin: 'base' as const, idx: 0, gid: 1, f: F({ ex: '', cert: '', webId: '32040' }) }];
    const exported = await readCertSheet(await xlsxBytes(exportOf([F({ ex: '', cert: '', webId: '32040' })], TODAY)), SHEET);
    expect(planWith(exported, named, companies)).toMatchObject({ news: [], changed: [], same: 1, errors: [] });
    // the held certificate has a value in the blank cell: the row is an error row, and the held value is not cleared (R2)
    const valued = [{ origin: 'base' as const, idx: 0, gid: 1, f: F({ ex: '2027-03-14' }) }];
    expect(planWith(await readCertSheet(await xlsxBytes(exportOf([F({ ex: '' })], TODAY)), SHEET), valued, companies)).toMatchObject({
      news: [], changed: [], errors: [{ rowNo: 2, reason: 'ต้องกรอก วันที่หมดอายุ (พ.ศ.)' }],
    });
    const blanked = await readCertSheet(await xlsxBytes(exportOf([F({ ex: '' })], TODAY)), SHEET);
    const plan = planWith(blanked, [{ origin: 'base', idx: 0, gid: 1, f: F({ cert: 'CFO-1' }) }], companies);
    // R2: the expiry date is required: the blank one is an error row, not a change of the held value
    expect([plan.news, plan.changed, plan.same]).toEqual([[], [], 0]);
    expect(plan.errors).toEqual([{ rowNo: 2, reason: 'ต้องกรอก วันที่หมดอายุ (พ.ศ.)' }]);
    // a blank cell that is not required keeps the held value: no change, no error
    const noZip = await readCertSheet(await xlsxBytes(exportOf([F({ zip: '' })], TODAY)), SHEET);
    expect(planWith(noZip, [{ origin: 'base', idx: 0, gid: 1, f: F({ cert: 'CFO-1' }) }], companies)).toMatchObject({ news: [], changed: [], same: 1, errors: [] });
  });
  it('a web id alone does not name a held certificate: a different number and organisation is a new row', () => {
    const held = [{ origin: 'base' as const, idx: 0, gid: 1, f: F({ webId: '32040' }) }];
    const row: CertLine = { rowNo: 2, f: F({ cert: 'OTHER-9', org: 'บริษัท อื่น จำกัด', webId: '32040' }), errors: [] };
    const plan = planWith([row], held, [{ id: 1, name: 'บริษัท เอ จำกัด' }]);
    expect(plan.changed).toEqual([]);
    // the company is not in the app: the row is kept for review and no company is made (R1)
    expect(plan.news).toEqual([]);
    expect(plan.reviews.map((r) => [r.line.f.cert, r.reason])).toEqual([['OTHER-9', 'ไม่พบบริษัทในระบบ']]);
  });
  it('a stored share is a fraction: it exports as a percent, and the same percent reads back as the same value', async () => {
    const stored = [F({ cert: 'CFO-S', webId: '', s1: 0.0029, s2: 0.1448, s3: 0.8523 })];
    const rows = exportOf(stored, TODAY)[0].rows;
    expect([rows[0][17], rows[0][18], rows[0][19], rows[0][20]]).toEqual(['0.29%', '14.48%', '85.23%', '100%']);
    expect([readPct({ t: 's', v: '0.29%' }, 'x'), readPct({ t: 's', v: '14.48' }, 'x'), readPct({ t: 'n', v: '0.8523' }, 'x')]).toEqual([{ v: 0.0029 }, { v: 0.1448 }, { v: 0.8523 }]);
    const ls = await readCertSheet(await xlsxBytes(exportOf(stored, TODAY)), SHEET);
    expect(planWith(ls, [{ origin: 'base', idx: 0, gid: 1, f: stored[0] }], [{ id: 1, name: 'บริษัท เอ จำกัด' }])).toMatchObject({ news: [], changed: [], same: 1, errors: [] });
  });
  it('the status and the total follow the held values', () => {
    const rows = exportOf([F({ ex: '2026-10-31' }), F({ cert: 'C2', ex: '2026-01-01' }), F({ cert: 'C3', ex: '', s1: null, s2: null, s3: null })], TODAY)[0].rows;
    expect(SHEET_HEADS[22]).toBe('สถานะ ณ วันที่ดึงข้อมูล');
    expect(rows[0][22]).toBe('อยู่ในอายุ');
    expect(rows[1][22]).toBe('หมดอายุ');
    expect(rows[2][22]).toBe('ไม่ระบุวันหมดอายุ');
    expect(rows[0][20]).toBe('100%');
    expect(rows[0][21]).toBe('ประเภทที่ 1');
    expect(rows[2][20]).toBeNull();
  });
});

describe('reading values', () => {
  it('a province typed as กรุงเทพฯ reads as the dictionary name, as TGO\'s cards are read', async () => {
    const [l] = await lines([row({ ...BASE_ROW, 'จังหวัด': 'กรุงเทพฯ' })]);
    expect(l.f.prov).toBe('กรุงเทพมหานคร');
  });
  it('a queue note keeps the sheet\'s own text: the import tag and a pull\'s tag are not part of it', () => {
    expect(sheetNoteOf('')).toBe('');
    expect(sheetNoteOf('นำเข้าจากไฟล์ rev.xlsx 26 ต.ค. 2569')).toBe('');
    expect(sheetNoteOf('ทดสอบ · นำเข้าจากไฟล์ rev.xlsx 26 ต.ค. 2569')).toBe('ทดสอบ');
    expect(sheetNoteOf('ดึงจาก Google Sheet ที่อัปเดตจากเว็บ อบก. 26 ต.ค. 2569')).toBe('');
    expect(sheetNoteOf('หมายเหตุของผู้ใช้')).toBe('หมายเหตุของผู้ใช้');
  });
  it('percent: "12.20%", "12.2" and 0.122 are the same value; 1% is written 1%', async () => {
    const ls = await lines([
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'P1', 'ประเภทที่ 1 (%)': '12.20%', 'ประเภทที่ 2 (%)': 12.2, 'ประเภทที่ 3 (%)': 0.122 }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'P2', 'ประเภทที่ 1 (%)': '1%', 'ประเภทที่ 2 (%)': 1, 'ประเภทที่ 3 (%)': '0.5' }),
    ]);
    expect([ls[0].f.s1, ls[0].f.s2, ls[0].f.s3]).toEqual([0.122, 0.122, 0.122]);
    expect([ls[1].f.s1, ls[1].f.s2, ls[1].f.s3]).toEqual([0.01, 1, 0.5]);
    expect(readPct({ t: 's', v: 'abc' }, 'ประเภทที่ 1 (%)')).toEqual({ err: 'ประเภทที่ 1 (%) ไม่ใช่ตัวเลข: abc' });
  });
  it('ids with thousands commas read as plain digits', async () => {
    const ls = await lines([
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'I1', 'รหัสรายการในเว็บ': '32,040' }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'I2', 'รหัสรายการในเว็บ': 32041 }),
    ]);
    expect(ls[0].f.webId).toBe('32040');
    expect(ls[1].f.webId).toBe('32041');
  });
  it('dates: dd/mm/yyyy in พ.ศ. text, a real Excel date, a 2568 typed into a date cell', async () => {
    const ls = await lines([
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'D1', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)': '15/03/2568', 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)': { date: '2027-03-14' } }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'D2', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)': { date: '2568-03-15' }, 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)': '1/2/2570' }),
    ]);
    expect(ls[0].f.ap).toBe('2025-03-15');
    expect(ls[0].f.ex).toBe('2027-03-14');
    expect(ls[1].f.ap).toBe('2025-03-15');
    expect(ls[1].f.ex).toBe('2027-02-01');
    expect(readDateBE({ t: 's', v: '15-03-2568' }, 'x')).toEqual({ v: '2025-03-15' });
    expect(readDateBE({ t: 's', v: '2568-03-15' }, 'x')).toEqual({ v: '2025-03-15' });
    expect(readDateBE({ t: 's', v: '31/02/2568' }, 'x')).toEqual({ err: 'x อ่านไม่ได้: 31/02/2568' });
  });
  it('a bare year typed as a number into a date cell is an error, not a date in 1907; a real Excel date still reads', () => {
    expect(readDateBE({ t: 'n', v: '2568' }, 'x')).toEqual({ err: 'x ต้องเป็นวว/ดด/ปปปป เป็น พ.ศ. เช่น 15/03/2568: 2568' });
    expect(readDateBE({ t: 'n', v: '2025' }, 'x')).toEqual({ err: 'x ต้องเป็นวว/ดด/ปปปป เป็น พ.ศ. เช่น 15/03/2568: 2025' });
    expect(readDateBE({ t: 'n', v: '45730' }, 'x')).toEqual({ v: '2025-03-14' });
  });
  it('a file that is not an xlsx is refused in Thai', async () => {
    await expect(workbookKind(new Uint8Array([80, 75, 1, 2]))).rejects.toThrow('ไฟล์นี้ไม่ใช่ไฟล์ .xlsx');
    await expect(readCertSheet(new Uint8Array([1, 2, 3]), SHEET)).rejects.toThrow('ไฟล์นี้ไม่ใช่ไฟล์ .xlsx');
  });
  it('error rows are listed with their row number and reason, and are not planned', async () => {
    const ls = await lines([
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'E1', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)': '15/03/2025' }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'E2', 'ประเภทที่ 1 (%)': 'มาก' }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'E3', 'ชื่อองค์กร': '' }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': null }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'OK-1' }),
    ]);
    expect(ls.map((l) => l.rowNo)).toEqual([2, 3, 4, 5, 6]);
    expect(ls[0].errors[0]).toMatch(/ต้องเป็นปี พ.ศ./);
    expect(ls[1].errors).toEqual(['ประเภทที่ 1 (%) ไม่ใช่ตัวเลข: มาก']);
    expect(ls[2].errors).toEqual([]);
    expect(ls[3].errors).toEqual([]);
    expect(ls[4].errors).toEqual([]);
    const plan = planWith(ls, [], [{ id: 1, name: 'บริษัท ทดสอบ จำกัด' }]);
    expect(plan.read).toBe(5);
    expect(plan.news.map((n) => n.f.cert)).toEqual(['OK-1']);
    expect(plan.errors.map((e) => e.rowNo)).toEqual([2, 3, 4, 5]);
    expect(plan.errors[2].reason).toBe('ต้องกรอก ชื่อองค์กร');
    expect(plan.errors[3].reason).toBe('ต้องกรอก เลขที่ใบรับรอง');
  });
  it('a file without a required column is refused by name', async () => {
    const bytes = await xlsxBytes([{ name: SHEET, head: ['เลขที่ใบรับรอง', 'ชื่อองค์กร'], rows: [['A', 'B']] }]);
    await expect(readCertSheet(bytes, SHEET)).rejects.toThrow('ไม่พบคอลัมน์ "วันที่อนุมัติ (พ.ศ. ตามเว็บ)", "วันที่หมดอายุ (พ.ศ. ตามเว็บ)" ในแถวที่ 1');
  });
  it('reads by header name: column order does not matter, the old names apBE/exBE and the TGO tab work', async () => {
    const head = ['exBE', 'ชื่อองค์กร', 'เลขที่ใบรับรอง', 'apBE'];
    const bytes = await xlsxBytes([{ name: SHEET_TGO, head, rows: [[ '14/03/2570', 'บริษัท สลับ จำกัด', 'SW-1', '15/03/2568' ]] }]);
    expect(await workbookKind(bytes)).toEqual({ kind: 'template', sheet: SHEET_TGO, names: [SHEET_TGO] });
    const ls = await readCertSheet(bytes, SHEET_TGO);
    expect(ls[0].f.cert).toBe('SW-1');
    expect(ls[0].f.ap).toBe('2025-03-15');
    expect(ls[0].errors).toEqual([]);
  });
});

describe('planning', () => {
  const held = [
    { origin: 'base' as const, idx: 0, gid: 1, f: F() },
    { origin: 'tgo' as const, idx: 0, gid: 2, f: F({ cert: 'CFO-B', org: 'บริษัท บี จำกัด', webId: '' }) },
  ];
  const companies = [{ id: 1, name: 'บริษัท เอ จำกัด' }, { id: 2, name: 'บริษัท บี จำกัด' }];
  const L = (rowNo: number, f: Partial<CertFields>, errors: string[] = []): CertLine => ({ rowNo, f: F(f), errors });
  it('new, same, changed (with the fields), a duplicate, a missing cell, and an unknown company goes to review; no company is made', () => {
    const plan = planWith(
      [
        L(2, { s1: 0.5 }),
        L(3, { cert: 'CFO-B', org: 'บริษัท บี จำกัด', webId: '', ap: '2024-01-01' }),
        L(4, { cert: 'NEW-1', org: 'บริษัท เอ จำกัด', webId: '' }),
        L(5, { cert: 'NEW-1', org: 'บริษัท เอ จำกัด', webId: '' }),
        L(6, { cert: 'NEW-2', org: 'บริษัท เอ จำกัด', webId: '' }),
        L(7, {}, ['ต้องกรอก ชื่อองค์กร']),
        L(8, { cert: 'NEW-3', org: 'บริษัท ใหม่ จำกัด', webId: '' }),
      ],
      held,
      companies,
    );
    expect(plan.read).toBe(7);
    expect(plan.same).toBe(0);
    expect(plan.changed.map((c) => [c.rowNo, c.fields, c.origin, c.idx, c.gid])).toEqual([
      [2, ['ประเภทที่ 1 (%)'], 'base', 0, 1],
    ]);
    // a certificate the queue brought in is changed in the queue, not here (R7): row 3 is refused, nothing is written
    expect(plan.log.find((e) => e.row === 3)?.action).toBe('refused');
    expect(plan.news.map((n) => [n.rowNo, n.gid])).toEqual([[4, 1], [6, 1]]);
    expect(plan.errors).toEqual([{ rowNo: 5, reason: 'ซ้ำกับแถว 4' }, { rowNo: 7, reason: 'ต้องกรอก ชื่อองค์กร' }]);
    expect(plan.reviews.map((r) => [r.rowNo, r.reason])).toEqual([[8, 'ไม่พบบริษัทในระบบ']]);
    expect(plan.companies).toEqual([]);
  });
  it('a row whose number is unique but whose organisation changed is a change of the organisation', () => {
    const plan = planWith([L(2, { org: 'บริษัท เอ (ใหม่) จำกัด' })], held, companies);
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0].fields).toEqual(['ชื่อองค์กร']);
    expect(plan.changed[0].gid).toBe(1);
    expect(plan.companies).toEqual([]);
  });
  it('a row that copies a held certificate\'s web id and organisation with another number is a new certificate: the held one is not changed', () => {
    const plan = planWith([L(2, { cert: 'NEWNO-9', s1: 0.9 })], held, companies);
    expect(plan.changed).toEqual([]);
    expect(plan.news.map((n) => [n.rowNo, n.f.cert])).toEqual([[2, 'NEWNO-9']]);
    expect(plan.errors).toEqual([]);
  });
  it('a row with the held certificate\'s web id and number is still that certificate, whatever its organisation says', () => {
    const plan = planWith([L(2, { org: 'บริษัท เอ (ใหม่) จำกัด' })], held, companies);
    expect(plan.changed.map((c) => [c.rowNo, c.origin, c.fields])).toEqual([[2, 'base', ['ชื่อองค์กร']]]);
    expect(plan.news).toEqual([]);
  });
  it('two held certificates with one number and organisation and no web ids: the rows pair with them in order', () => {
    const two = [
      { origin: 'base' as const, idx: 0, gid: 1, f: F({ webId: '' }) },
      { origin: 'base' as const, idx: 1, gid: 1, f: F({ webId: '', s1: 0.5, s2: 0.4, s3: 0.1 }) },
    ];
    const plan = planWith([L(2, { webId: '' }), L(3, { webId: '', s1: 0.5, s2: 0.4, s3: 0.1 })], two, companies);
    expect(plan.errors).toEqual([]);
    expect(plan.same).toBe(2);
  });
  it('a changed certificate keeps the company id it is stored under, even when that company is merged into another', () => {
    const stored = {
      cid: 0, gid: 1, gid0: 2, cert: 'CFO-1', org: 'บริษัท เอ จำกัด', branch: 'สำนักงานใหญ่', act: 'การผลิต', ind: 0, size: 0,
      addr: '1 ถนนทดสอบ กรุงเทพมหานคร 10110', prov: 0, zip: '10110', ap: '2025-03-15', ex: '2027-03-14', fy: 0, s1: 0.6, s2: 0.3, s3: 0.1,
      phone: '', email: '', webId: '', note: '',
    } as unknown as Cert;
    const held = heldFrom([stored], 1, { ind: ['การผลิต'], size: ['ขนาดเล็ก'], prov: ['กรุงเทพมหานคร'], fy: ['FY67'] });
    const plan = planWith([L(2, { webId: '', s1: 0.5 })], held, [{ id: 1, name: 'บริษัท เอ จำกัด' }]);
    expect(plan.changed.map((c) => [c.fields, c.gid])).toEqual([[['ประเภทที่ 1 (%)'], 2]]);
  });
  it('two rows for one held certificate: the second is skipped', () => {
    const plan = planWith([L(2, {}), L(3, { s1: 1 })], held, companies);
    expect(plan.same).toBe(1);
    expect(plan.errors).toEqual([{ rowNo: 3, reason: 'ตรงกับใบรับรองเดียวกับแถว 2' }]);
  });
});

describe('saving', () => {
  const CD: CertDicts = { ind: ['การผลิต'], size: ['ขนาดเล็ก'], prov: ['กรุงเทพมหานคร'], fy: ['FY67'] };
  const base = {
    asOf: TODAY, dicts: { type: ['ไม่ระบุ'], prov: ['กรุงเทพมหานคร'], ind: ['ไม่ระบุ'], tgt: [], cfo: ['อยู่ในอายุ'], ct: [], match: [] },
    rows: [], cdicts: CD,
    certs: [[1, 'CFO-1', 'บริษัท เอ จำกัด', 'สำนักงานใหญ่', 'การผลิต', 0, 0, '1 ถนนทดสอบ', 0, '10110', '2025-03-15', '2027-03-14', 0, 0.6, 0.3, 0.1, '', '', '32040', '']],
    source: 'file',
  } as unknown as Dataset;
  const save = (ls: CertLine[], companies = [{ id: 5, name: 'บริษัท เอ จำกัด' }]) => {
    const B = build(base, {}, {});
    const plan = planWith(ls, heldFrom(B.certs, base.certs.length, B.CD), companies);
    return { plan, r: applyCertPlan(plan, base, [], [], 'sheet.xlsx', '2026-10-26T00:00:00.000Z') };
  };
  it('changed base row stays in the base; new ones go to the added list with their company; nothing else moves', async () => {
    const ls = await lines([
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'CFO-1', 'ชื่อองค์กร': 'บริษัท เอ จำกัด', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)': '15/03/2568', 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)': '14/03/2570', 'ประเภทที่ 1 (%)': '50%', 'ประเภทที่ 2 (%)': '40%', 'ประเภทที่ 3 (%)': '10%', 'ปีงบประมาณ (FY)': 'FY67', 'รหัสรายการในเว็บ': '32040' }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'CFO-5', 'ชื่อองค์กร': 'บริษัท เอ จำกัด', 'ขนาดอุตสาหกรรม': 'ขนาดกลาง', 'อุตสาหกรรม': 'บริการ', 'จังหวัด': 'นนทบุรี' }),
    ]);
    const { plan, r } = save(ls);
    expect(plan.changed).toHaveLength(1);
    expect(plan.news).toHaveLength(1);
    expect(r.changed && r.baseChanged && r.tgoChanged).toBe(true);
    expect(r.addedChanged).toBe(false); // no company is made (R15)
    expect(r.base.source).toBe('upload');
    expect(r.base.fileName).toBe('sheet.xlsx');
    expect((r.base.certs[0] as unknown[])[12]).toBe(0);
    expect((r.base.certs[0] as unknown[]).slice(13, 16)).toEqual([0.5, 0.4, 0.1]);
    expect(r.tgo).toHaveLength(1);
    expect(r.tgo[0]).toMatchObject({ cert: 'CFO-5', gid: 5, org: 'บริษัท เอ จำกัด' });
    expect(r.base.cdicts.ind).toContain('บริการ');
    expect(r.added).toEqual([]);
  });
  it('after the save, the same sheet plans no new and no changed rows', async () => {
    const ls = await lines([
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'CFO-1', 'ชื่อองค์กร': 'บริษัท เอ จำกัด', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)': '15/03/2568', 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)': '14/03/2570', 'ประเภทที่ 1 (%)': '50%', 'ประเภทที่ 2 (%)': '40%', 'ประเภทที่ 3 (%)': '10%' }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'CFO-5', 'ชื่อองค์กร': 'บริษัท เอ จำกัด', 'ขนาดอุตสาหกรรม': 'ขนาดกลาง', 'อุตสาหกรรม': 'บริการ', 'จังหวัด': 'นนทบุรี' }),
    ]);
    const { r } = save(ls);
    const after = build(r.base, {}, { added: r.added, certs: r.tgo.map((c) => ({ ...c, tgo: true })) });
    const again = planWith(ls, heldFrom(after.certs, r.base.certs.length, after.CD), [{ id: 5, name: 'บริษัท เอ จำกัด' }]);
    expect(again.news).toEqual([]);
    expect(again.changed).toEqual([]);
    expect(again.same).toBe(2);
  });
  it('a sheet with nothing to change saves nothing', async () => {
    const { r } = save([]);
    expect(r.changed).toBe(false);
    expect(r.base).toBe(base);
  });
});

describe('the old full workbook still goes through core.ts', () => {
  it('a workbook with ทะเบียนบริษัท is the full kind, and parseXlsx reads its TGO_CFO sheet by letter', async () => {
    const cols = (o: Record<string, string>) => Array.from({ length: 26 }, (_, i) => o[String.fromCharCode(65 + i)] ?? '');
    const bytes = await xlsxBytes([
      { name: 'ทะเบียนบริษัท', head: cols({ A: 'รหัส', B: 'ชื่อ' }), rows: [cols({ A: 'GCC-000001', B: 'บริษัท เอ จำกัด' })] },
      { name: 'TGO_CFO', head: cols({ A: 'รหัส', B: 'เลขที่' }), rows: [cols({ A: 'GCC-000001', B: 'OLD-1', C: 'บริษัท เอ จำกัด', M: '2025-03-15', N: '2027-03-14' })] },
    ]);
    expect((await workbookKind(bytes)).kind).toBe('full');
    const parsed = await parseXlsx(new File([new Uint8Array(bytes)], 'old.xlsx'));
    expect(parsed.base.certs).toHaveLength(1);
    expect(parsed.base.rows).toHaveLength(1);
    expect(parsed.base.fileName).toBe('old.xlsx');
  });
  it('the key the registry matches on is the TGO sync key', () => {
    // the legal form is part of the organisation, as the queue keys it: a sheet and the queue name one certificate alike
    expect(certKey(' cfo 1 ', 'บริษัท เอ  จำกัด')).toBe('CFO1|บริษัทเอจำกัด');
    expect(certKey(' cfo 1 ', 'บริษัท เอ  จำกัด')).toBe(TGOSync.key(' cfo 1 ', 'บริษัท เอ  จำกัด'));
    expect(certKey('CFO-1', 'บริษัท เอ จำกัด')).toBe(certKey(' cfo-1 ', 'บริษัท  เอ จำกัด'));
    expect(certKey('CFO-1', 'บริษัท เอ จำกัด')).not.toBe(certKey('CFO-1', 'เอ'));
  });
});

describe('the sheet rules of the owner v2 spec', () => {
  const CO = [{ id: 1, name: 'บริษัท เอ จำกัด' }, { id: 2, name: 'บริษัท บี จำกัด' }];
  const NEW = { webId: '' };
  const LG = (rowNo: number, f: Partial<CertFields>, extra: Partial<CertLine> = {}): CertLine => ({ rowNo, f: F(f), errors: [], ...extra });
  it('a GCC code that names an existing company attaches a new certificate to it; no company is made (R3a, R15)', () => {
    const plan = planWith([LG(2, { cert: 'G-1', org: 'บริษัท บี จำกัด', ...NEW }, { gcc: 'GCC-000002' })], [], CO);
    expect(plan.news.map((n) => [n.rowNo, n.gid])).toEqual([[2, 2]]);
    expect(plan.log[0]).toMatchObject({ action: 'queued', co: 2, gcc: 'GCC-000002', company: 'บริษัท บี จำกัด', cert: 'G-1' });
    expect(plan.companies).toEqual([]);
  });
  it('a GCC row that matches a certificate the queue accepted, with the same values, is attached: no company is made (R3a)', () => {
    const accepted = [{ origin: 'tgo' as const, idx: 0, gid: 2, f: F({ cert: 'G-A', org: 'บริษัท บี จำกัด', webId: '' }) }];
    const plan = planWith([LG(2, { cert: 'G-A', org: 'บริษัท บี จำกัด', webId: '' }, { gcc: 'GCC-000002' })], accepted, CO);
    expect(plan.log[0]).toMatchObject({ action: 'attached', co: 2, gcc: 'GCC-000002', company: 'บริษัท บี จำกัด' });
    expect([plan.news, plan.changed, plan.companies]).toEqual([[], [], []]);
  });
  it('a GCC code that names no company goes to the review list with its reason (R3a)', () => {
    const plan = planWith([LG(2, { cert: 'G-2', org: 'บริษัท บี จำกัด', ...NEW }, { gcc: 'GCC-000999' })], [], CO);
    expect(plan.news).toEqual([]);
    expect(plan.reviews.map((r) => [r.rowNo, r.reason])).toEqual([[2, 'รหัส GCC ไม่พบในระบบ']]);
    expect(plan.log[0].action).toBe('review');
  });
  it('a name with a bracketed branch suffix matches the base company; the queued certificate takes the branch from the suffix (R3b, R4)', () => {
    const plan = planWith([LG(2, { cert: 'B-1', org: 'บริษัท เอ จำกัด (65)', branch: '', ...NEW })], [], CO);
    expect(plan.news).toHaveLength(1);
    expect(plan.news[0]).toMatchObject({ gid: 1, f: { branch: '65' } });
    expect(importNameKey('บริษัท เอ จำกัด (65)')).toBe(importNameKey('บริษัท เอ จำกัด (สำนักงานใหญ่)'));
  });
  it('a GCC code and a name that name different companies go to review (R3d)', () => {
    const plan = planWith([LG(2, { cert: 'D-1', org: 'บริษัท เอ จำกัด', ...NEW }, { gcc: 'GCC-000002' })], [], CO);
    expect(plan.reviews.map((r) => r.reason)).toEqual(['รหัส GCC กับชื่อไม่ตรงกัน']);
  });
  it('a name that matches two companies goes to review as a duplicate (R3b)', () => {
    const plan = planWith([LG(2, { cert: 'D-2', org: 'บริษัท เอ จำกัด', ...NEW })], [], [...CO, { id: 3, name: 'บริษัท เอ (65) จำกัด' }]);
    expect(plan.reviews.map((r) => r.reason)).toEqual(['พบบริษัทซ้ำ']);
  });
  it('a held certificate keeps its company: a GCC code of another company is a review, and the certificate is not moved (R3e)', () => {
    const plan = planWith([LG(2, { s1: 0.5 }, { gcc: 'GCC-000002' })], [{ origin: 'base', idx: 0, gid: 1, f: F() }], CO);
    expect(plan.changed).toEqual([]);
    expect(plan.reviews.map((r) => [r.rowNo, r.reason])).toEqual([[2, 'รหัส GCC ไม่ตรงกับบริษัทของใบรับรองนี้']]);
  });
  it('blank cells keep the held values; a change lists only the non-blank cells, old -> new (R2, R6)', () => {
    const plan = planWith([LG(2, { s1: 0.5, zip: '', prov: '' })], [{ origin: 'base', idx: 0, gid: 1, f: F() }], CO);
    expect(plan.changed.map((c) => c.fields)).toEqual([['ประเภทที่ 1 (%)']]);
    expect(plan.log[0].changes).toEqual([{ field: 'ประเภทที่ 1 (%)', from: '60%', to: '50%' }]);
    expect(keepHeld(F({ zip: '', s1: null }), F())).toEqual(F());
    expect(diffFields(F({ s1: 0.5 }), F())).toEqual([{ field: 'ประเภทที่ 1 (%)', from: '60%', to: '50%' }]);
  });
  it('e-mail: a row with status พบ fills an empty company e-mail; other statuses are ignored; addresses are split and joined (R8). An existing address is never removed or replaced; the rule is v3, a new address is added after it (see the union tests)', () => {
    const rows = [
      LG(2, { cert: 'E-1', org: 'บริษัท บี จำกัด', ...NEW }, { emailSt: 'พบ', email: 'a@x.co; b@x.co, a@x.co' }),
      LG(3, { cert: 'E-2', org: 'บริษัท บี จำกัด', ...NEW }, { emailSt: 'พบ', email: 'x@x.co' }),
      LG(4, { cert: 'E-3', org: 'บริษัท เอ จำกัด', ...NEW }, { emailSt: 'ค้นแล้วไม่พบ', email: 'z@x.co' }),
    ];
    const plan = planWith(rows, [], CO, { emailOf: (id) => (id === 2 ? '' : 'old@x.co') });
    expect(plan.emails).toEqual([expect.objectContaining({ co: 2, action: 'filled', to: 'a@x.co | b@x.co | x@x.co' })]);
    expect(plan.log.map((e) => e.email)).toEqual([
      { action: 'filled', from: '', to: 'a@x.co | b@x.co | x@x.co' },
      { action: 'filled', from: '', to: 'a@x.co | b@x.co | x@x.co' },
      { action: 'none', from: '', to: '' },
    ]);
    // v3: the old rule kept the existing address and added nothing; now the new address follows it, the old one stays first
    const added = planWith([LG(2, { cert: 'E-4', org: 'บริษัท บี จำกัด', ...NEW }, { emailSt: 'พบ', email: 'new@x.co' })], [], CO, { emailOf: () => 'old@x.co' });
    expect(added.emails).toEqual([expect.objectContaining({ co: 2, action: 'filled', from: 'old@x.co', to: 'old@x.co | new@x.co' })]);
    expect(added.log[0].email).toEqual({ action: 'filled', from: 'old@x.co', to: 'old@x.co | new@x.co' });
    expect(splitEmails('a@x.co; b@x.co, a@x.co |c@x.co')).toEqual(['a@x.co', 'b@x.co', 'c@x.co']);
  });
  it('the template example row is skipped with its message (R11)', () => {
    const plan = planWith([LG(2, { cert: 'CFO-EXAMPLE-0001', org: 'บริษัท ตัวอย่าง จำกัด' })], [], CO);
    expect([plan.news, plan.errors, plan.reviews]).toEqual([[], [], []]);
    expect(plan.log[0]).toMatchObject({ action: 'rejected', msg: 'แถวตัวอย่างจากแม่แบบ ข้ามแถวนี้' });
  });
  it('a queue record that was rejected is declined before, and a waiting one is already queued; neither is added again (R5)', () => {
    const rows = [LG(2, { cert: 'R-1', org: 'บริษัท บี จำกัด', ...NEW }), LG(3, { cert: 'W-1', org: 'บริษัท บี จำกัด', ...NEW })];
    const plan = planWith(rows, [], CO, { queue: (f) => (f.cert === 'R-1' ? { st: 'r', f } : f.cert === 'W-1' ? { st: 'p', f } : undefined) });
    expect(plan.news).toEqual([]);
    expect(plan.waiting.map((w) => w.st)).toEqual(['r', 'p']);
    expect(plan.log.map((e) => e.action)).toEqual(['declined before', 'already queued']);
    expect(ACTION_TH['declined before']).toBe('ถูกปฏิเสธไว้แล้ว');
  });
  it('an unknown header is listed as a warning; the known ones (the e-mail check note by its start) are not (R10)', async () => {
    const bytes = await xlsxBytes([{ name: SHEET, head: [...SHEET_HEADS, 'คอลัมน์ไม่รู้จัก', 'หมายเหตุการตรวจสอบอีเมล (ค้นเมื่อ 27/10/2026)', 'อีเมล'], rows: [] }]);
    const r = await readCertSheetFull(bytes, SHEET);
    expect(r.unknown).toEqual(['คอลัมน์ไม่รู้จัก']);
    expect(planCertRows([], ctxOf([], CO), r.unknown).warnings).toEqual(['คอลัมน์ไม่รู้จัก']);
  });
  it('export writes รหัสบริษัท (GCC) and อีเมล after the 27 columns, and its round trip gives no change (R12, R13)', async () => {
    const sheet = exportSheets([{ f: F(), gcc: 'GCC-000001', email: 'a@x.co | b@x.co' }], TODAY)[0];
    expect(sheet.head.slice(27)).toEqual(['รหัสบริษัท (GCC)', 'อีเมล']);
    expect(sheet.rows[0].slice(27)).toEqual(['GCC-000001', 'a@x.co | b@x.co']);
    const ls = await readCertSheet(await xlsxBytes([sheet]), SHEET);
    expect([ls[0].gcc, ls[0].email, ls[0].emailSt]).toEqual(['GCC-000001', 'a@x.co | b@x.co', '']);
    expect(planWith(ls, [{ origin: 'base', idx: 0, gid: 1, f: F() }], CO)).toMatchObject({ news: [], changed: [], same: 1, errors: [] });
  });
  it('the change report counts rows per action, and the companies whose e-mail was filled (R14)', () => {
    const plan = planWith([LG(2, { cert: 'C-1', org: 'บริษัท บี จำกัด', ...NEW }, { emailSt: 'พบ', email: 'a@x.co' }), LG(3, { cert: 'C-2', org: 'บริษัท ไม่มี จำกัด', ...NEW })], [], CO);
    const c = countLog(plan.log);
    expect([c.queued, c.review, c.emailFilled, c.emailKept]).toEqual([1, 1, 1, 0]);
  });
  it('a GCC code reads back the company id it names; a name key ignores legal form, spaces, head office and branch numbers (R3)', () => {
    expect([gccIdOf('GCC-000361'), gccIdOf(' gcc-361 '), gccIdOf('TGO-7'), gccIdOf('NEW-A'), gccIdOf('GCC-'), gccIdOf('361')]).toEqual([361, 361, 900007, 1e12 + 10, null, null]);
    expect(importNameKey('บริษัท เอ จำกัด')).toBe('เอ');
    expect(importNameKey('บริษัท  เอ  จำกัด (00000)')).toBe('เอ');
    expect(importNameKey('บริษัท เอ จำกัด (0001)')).toBe('เอ');
    expect([branchOfName('บริษัท เอ จำกัด (65)'), branchOfName('บริษัท เอ (0001)'), branchOfName('บริษัท เอ จำกัด (00000)'), branchOfName('บริษัท เอ')]).toEqual(['65', '0001', '', '']);
  });
  // v3 (owner rule R8): the company's e-mail is the union of its own addresses and the sheet's new ones, never a replacement
  describe('the company e-mail union (R8, v3)', () => {
    /** Sheet rows of company 2 (บริษัท บี), each with one e-mail cell and status พบ, against a company that holds `have`. */
    const union = (have: string, cells: string[]) =>
      planWith(cells.map((email, i) => LG(i + 2, { cert: `U-${i + 1}`, org: 'บริษัท บี จำกัด', ...NEW }, { emailSt: 'พบ', email })), [], CO, {
        emailOf: (id) => (id === 2 ? have : ''),
      });
    it('a company with one e-mail A and a sheet e-mail B gets "A | B", and the change is filled', () => {
      const plan = union('a@example.test', ['b@example.test']);
      expect(plan.emails).toEqual([{ co: 2, name: 'บริษัท บี จำกัด', from: 'a@example.test', to: 'a@example.test | b@example.test', action: 'filled' }]);
      expect(plan.log[0].email).toEqual({ action: 'filled', from: 'a@example.test', to: 'a@example.test | b@example.test' });
      expect(countLog(plan.log)).toMatchObject({ emailFilled: 1, emailKept: 0 });
    });
    it('a sheet e-mail equal to A, in any case, is kept: the company keeps A and nothing is written', () => {
      const plan = union('a@example.test', ['A@Example.TEST']);
      expect(plan.emails).toEqual([{ co: 2, name: 'บริษัท บี จำกัด', from: 'a@example.test', to: 'a@example.test', action: 'kept' }]);
      expect(plan.log[0].email).toEqual({ action: 'kept', from: 'a@example.test', to: 'a@example.test' });
      expect(countLog(plan.log)).toMatchObject({ emailFilled: 0, emailKept: 1 });
    });
    it('a sheet cell "A; B" on a company with A gives "A | B"; an existing ";" list is read, and its addresses stay', () => {
      expect(union('a@example.test', ['a@example.test; b@example.test']).emails[0]).toMatchObject({ action: 'filled', to: 'a@example.test | b@example.test' });
      expect(union('a@example.test;c@example.test', ['b@example.test']).emails[0]).toMatchObject({ action: 'filled', to: 'a@example.test | c@example.test | b@example.test' });
    });
    it('two rows of one company with B and C give both once: the distinct addresses across the rows, one planned write', () => {
      const plan = union('a@example.test', ['b@example.test', 'c@example.test; B@example.test', 'C@example.test']);
      const to = 'a@example.test | b@example.test | c@example.test';
      expect(plan.emails).toEqual([expect.objectContaining({ co: 2, action: 'filled', to })]);
      expect(plan.log.map((e) => e.email)).toEqual([0, 1, 2].map(() => ({ action: 'filled', from: 'a@example.test', to })));
    });
    it('a company with no e-mail gets the sheet addresses, each once', () => {
      expect(union('', ['x@example.test; y@example.test', 'X@example.test']).emails).toEqual([expect.objectContaining({ action: 'filled', from: '', to: 'x@example.test | y@example.test' })]);
    });
    it('an existing address is never removed or replaced, and one it holds is not written again', () => {
      expect(union('a@example.test | b@example.test', ['c@example.test']).emails[0].to).toBe('a@example.test | b@example.test | c@example.test');
      expect(union('a@example.test | a@example.test', ['A@example.test']).emails[0]).toMatchObject({ action: 'kept', to: 'a@example.test | a@example.test' });
    });
    it('a second import of the same file is a no-op for e-mail: the addresses are there, so nothing is filled (R13)', () => {
      const saved = union('a@example.test', ['b@example.test; c@example.test']).emails[0].to;
      const second = union(saved, ['b@example.test; c@example.test']);
      expect(second.emails).toEqual([expect.objectContaining({ action: 'kept', to: saved })]);
      expect(countLog(second.log)).toMatchObject({ emailFilled: 0, emailKept: 1 });
      // the row itself is unchanged too: its held certificate matches, so the file writes nothing at all
      const held: HeldCert[] = [{ origin: 'base', idx: 0, gid: 2, f: F({ cert: 'U-1', org: 'บริษัท บี จำกัด', webId: '' }) }];
      const again = planWith([LG(2, { cert: 'U-1', org: 'บริษัท บี จำกัด', webId: '' }, { emailSt: 'พบ', email: 'b@example.test; c@example.test' })], held, CO, { emailOf: () => saved });
      expect([again.news, again.changed, again.reviews, again.same]).toEqual([[], [], [], 1]);
      expect(again.emails.filter((x) => x.action === 'filled')).toEqual([]);
    });
    it('the e-mail cell read from a workbook keeps its line breaks, so one address to a line is split', async () => {
      const sheet = { name: SHEET, head: [...SHEET_HEADS, 'อีเมล', 'สถานะการค้นหาอีเมล'], rows: [[...row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'U-9', 'ชื่อองค์กร': 'บริษัท บี จำกัด' }), 'b@example.test\nc@example.test', 'พบ']] };
      const read = await readCertSheet(await xlsxBytes([sheet]), SHEET);
      expect(read[0].email).toBe('b@example.test\nc@example.test');
      expect(planWith(read, [], CO, { emailOf: () => 'a@example.test' }).emails).toEqual([expect.objectContaining({ action: 'filled', to: 'a@example.test | b@example.test | c@example.test' })]);
    });
    it('splitEmails takes ";", ",", "|" and line breaks, trims, and drops empties and repeats (case does not count)', () => {
      expect(splitEmails(' a@example.test\r\nb@example.test\n;| ,A@example.test ,  ')).toEqual(['a@example.test', 'b@example.test']);
    });
    it('mergeCoEmail: the company\'s own addresses come first as they are, the new ones after them; nothing new is kept as it is', () => {
      expect(mergeCoEmail('A;B', ['C'])).toEqual({ action: 'filled', to: 'A | B | C' });
      expect(mergeCoEmail('A | B', ['b'])).toEqual({ action: 'kept', to: 'A | B' });
      expect(mergeCoEmail('', ['C', 'c'])).toEqual({ action: 'filled', to: 'C' });
    });
  });
});
