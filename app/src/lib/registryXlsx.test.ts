import { describe, expect, it } from 'vitest';
import { build } from './core';
import { applyCertPlan, certKey, exportSheets, heldFrom, planCertRows, readCertSheet, readDateBE, readPct, SHEET, SHEET_DESC, SHEET_HEADS, SHEET_TGO, templateSheets, workbookKind, type CertFields, type CertLine } from './registryXlsx';
import { xlsxBytes, type XCell, type XSheet } from './xlsx';
import { parseXlsx } from './core';
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
    const bytes = await xlsxBytes(exportSheets(certs, TODAY));
    const ls = await readCertSheet(bytes, SHEET);
    expect(ls).toHaveLength(4);
    expect(ls.flatMap((l) => l.errors)).toEqual([]);
    const held = certs.map((f, i) => ({ origin: i < 2 ? ('base' as const) : ('tgo' as const), idx: i < 2 ? i : i - 2, gid: 100 + i, f }));
    const plan = planCertRows(ls, held, held.map((h) => ({ id: h.gid, name: h.f.org })));
    expect(plan.read).toBe(4);
    expect(plan.news).toEqual([]);
    expect(plan.changed).toEqual([]);
    expect(plan.same).toBe(4);
    expect(plan.errors).toEqual([]);
  });
  it('a held certificate with a blank expiry date round-trips as the same; blanking a held value is an error', async () => {
    const held = [{ origin: 'base' as const, idx: 0, gid: 1, f: F({ ex: '', cert: '' }) }];
    const companies = [{ id: 1, name: 'บริษัท เอ จำกัด' }];
    const same = await readCertSheet(await xlsxBytes(exportSheets([F({ ex: '', cert: '' })], TODAY)), SHEET);
    expect(same[0].errors).toEqual([]);
    expect(planCertRows(same, held, companies)).toMatchObject({ news: [], changed: [], same: 1, errors: [] });
    const blanked = await readCertSheet(await xlsxBytes(exportSheets([F({ ex: '' })], TODAY)), SHEET);
    const plan = planCertRows(blanked, [{ origin: 'base', idx: 0, gid: 1, f: F({ cert: 'CFO-1' }) }], companies);
    expect([plan.news, plan.changed, plan.same]).toEqual([[], [], 0]);
    expect(plan.errors).toEqual([{ rowNo: 2, reason: 'ต้องกรอก วันที่หมดอายุ (พ.ศ.)' }]);
  });
  it('a web id alone does not name a held certificate: a different number and organisation is a new row', () => {
    const held = [{ origin: 'base' as const, idx: 0, gid: 1, f: F({ webId: '32040' }) }];
    const row: CertLine = { rowNo: 2, f: F({ cert: 'OTHER-9', org: 'บริษัท อื่น จำกัด', webId: '32040' }), errors: [] };
    const plan = planCertRows([row], held, [{ id: 1, name: 'บริษัท เอ จำกัด' }]);
    expect(plan.changed).toEqual([]);
    expect(plan.news.map((n) => n.f.cert)).toEqual(['OTHER-9']);
  });
  it('a stored share is a fraction: it exports as a percent, and the same percent reads back as the same value', async () => {
    const stored = [F({ cert: 'CFO-S', webId: '', s1: 0.0029, s2: 0.1448, s3: 0.8523 })];
    const rows = exportSheets(stored, TODAY)[0].rows;
    expect([rows[0][17], rows[0][18], rows[0][19], rows[0][20]]).toEqual(['0.29%', '14.48%', '85.23%', '100%']);
    expect([readPct({ t: 's', v: '0.29%' }, 'x'), readPct({ t: 's', v: '14.48' }, 'x'), readPct({ t: 'n', v: '0.8523' }, 'x')]).toEqual([{ v: 0.0029 }, { v: 0.1448 }, { v: 0.8523 }]);
    const ls = await readCertSheet(await xlsxBytes(exportSheets(stored, TODAY)), SHEET);
    expect(planCertRows(ls, [{ origin: 'base', idx: 0, gid: 1, f: stored[0] }], [{ id: 1, name: 'บริษัท เอ จำกัด' }])).toMatchObject({ news: [], changed: [], same: 1, errors: [] });
  });
  it('the status and the total follow the held values', () => {
    const rows = exportSheets([F({ ex: '2026-10-31' }), F({ cert: 'C2', ex: '2026-01-01' }), F({ cert: 'C3', ex: '', s1: null, s2: null, s3: null })], TODAY)[0].rows;
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
    const plan = planCertRows(ls, [], []);
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
  it('new, same, changed (with the fields), a duplicate, and a new company for an unknown name', () => {
    const plan = planCertRows(
      [
        L(2, { s1: 0.5 }),
        L(3, { cert: 'CFO-B', org: 'บริษัท บี จำกัด', webId: '', ap: '2024-01-01' }),
        L(4, { cert: 'NEW-1', org: 'บริษัท ใหม่ จำกัด', webId: '' }),
        L(5, { cert: 'NEW-1', org: 'บริษัท ใหม่ จำกัด', webId: '' }),
        L(6, { cert: 'NEW-2', org: 'บริษัท ใหม่ จำกัด', webId: '' }),
        L(7, {}, ['ต้องกรอก ชื่อองค์กร']),
      ],
      held,
      companies,
    );
    expect(plan.read).toBe(6);
    expect(plan.same).toBe(0);
    expect(plan.changed.map((c) => [c.rowNo, c.fields, c.origin, c.idx, c.gid])).toEqual([
      [2, ['ประเภทที่ 1 (%)'], 'base', 0, 1],
      [3, ['วันที่อนุมัติ (พ.ศ.)'], 'tgo', 0, 2],
    ]);
    expect(plan.news.map((n) => [n.rowNo, n.gid])).toEqual([[4, 900001], [6, 900001]]);
    expect(plan.errors).toEqual([{ rowNo: 5, reason: 'ซ้ำกับแถว 4' }, { rowNo: 7, reason: 'ต้องกรอก ชื่อองค์กร' }]);
    expect(plan.companies).toEqual([{ id: 900001, name: 'บริษัท ใหม่ จำกัด' }]);
  });
  it('a row whose number is unique but whose organisation changed is a change of the organisation', () => {
    const plan = planCertRows([L(2, { org: 'บริษัท เอ (ใหม่) จำกัด' })], held, companies);
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0].fields).toEqual(['ชื่อองค์กร']);
    expect(plan.changed[0].gid).toBe(900001);
    expect(plan.companies.map((c) => c.name)).toEqual(['บริษัท เอ (ใหม่) จำกัด']);
  });
  it('two held certificates with one number and organisation and no web ids: the rows pair with them in order', () => {
    const two = [
      { origin: 'base' as const, idx: 0, gid: 1, f: F({ webId: '' }) },
      { origin: 'base' as const, idx: 1, gid: 1, f: F({ webId: '', s1: 0.5, s2: 0.4, s3: 0.1 }) },
    ];
    const plan = planCertRows([L(2, { webId: '' }), L(3, { webId: '', s1: 0.5, s2: 0.4, s3: 0.1 })], two, companies);
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
    const plan = planCertRows([L(2, { webId: '', s1: 0.5 })], held, [{ id: 1, name: 'บริษัท เอ จำกัด' }]);
    expect(plan.changed.map((c) => [c.fields, c.gid])).toEqual([[['ประเภทที่ 1 (%)'], 2]]);
  });
  it('two rows for one held certificate: the second is skipped', () => {
    const plan = planCertRows([L(2, {}), L(3, { s1: 1 })], held, companies);
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
  const save = (ls: CertLine[]) => {
    const B = build(base, {}, {});
    const plan = planCertRows(ls, heldFrom(B.certs, base.certs.length, B.CD), B.companies.map((c) => ({ id: c.id, name: c.name })));
    return { plan, r: applyCertPlan(plan, base, [], [], 'sheet.xlsx', '2026-10-26T00:00:00.000Z') };
  };
  it('changed base row stays in the base; new ones go to the added list with their company; nothing else moves', async () => {
    const ls = await lines([
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'CFO-1', 'ชื่อองค์กร': 'บริษัท เอ จำกัด', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)': '15/03/2568', 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)': '14/03/2570', 'ประเภทที่ 1 (%)': '50%', 'ประเภทที่ 2 (%)': '40%', 'ประเภทที่ 3 (%)': '10%', 'ปีงบประมาณ (FY)': 'FY67', 'รหัสรายการในเว็บ': '32040' }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'CFO-5', 'ชื่อองค์กร': 'บริษัท ห้า จำกัด', 'ขนาดอุตสาหกรรม': 'ขนาดกลาง', 'อุตสาหกรรม': 'บริการ', 'จังหวัด': 'นนทบุรี' }),
    ]);
    const { plan, r } = save(ls);
    expect(plan.changed).toHaveLength(1);
    expect(plan.news).toHaveLength(1);
    expect(r.changed && r.baseChanged && r.tgoChanged && r.addedChanged).toBe(true);
    expect(r.base.source).toBe('upload');
    expect(r.base.fileName).toBe('sheet.xlsx');
    expect((r.base.certs[0] as unknown[])[12]).toBe(0);
    expect((r.base.certs[0] as unknown[]).slice(13, 16)).toEqual([0.5, 0.4, 0.1]);
    expect(r.tgo).toHaveLength(1);
    expect(r.tgo[0]).toMatchObject({ cert: 'CFO-5', gid: 900001, org: 'บริษัท ห้า จำกัด' });
    expect(r.base.cdicts.ind).toContain('บริการ');
    expect(r.added.map((a) => [a.id, a.name])).toEqual([[900001, 'บริษัท ห้า จำกัด']]);
  });
  it('after the save, the same sheet plans no new and no changed rows', async () => {
    const ls = await lines([
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'CFO-1', 'ชื่อองค์กร': 'บริษัท เอ จำกัด', 'วันที่อนุมัติ (พ.ศ. ตามเว็บ)': '15/03/2568', 'วันที่หมดอายุ (พ.ศ. ตามเว็บ)': '14/03/2570', 'ประเภทที่ 1 (%)': '50%', 'ประเภทที่ 2 (%)': '40%', 'ประเภทที่ 3 (%)': '10%' }),
      row({ ...BASE_ROW, 'เลขที่ใบรับรอง': 'CFO-5', 'ชื่อองค์กร': 'บริษัท ห้า จำกัด', 'ขนาดอุตสาหกรรม': 'ขนาดกลาง', 'อุตสาหกรรม': 'บริการ', 'จังหวัด': 'นนทบุรี' }),
    ]);
    const { r } = save(ls);
    const after = build(r.base, {}, { added: r.added, certs: r.tgo.map((c) => ({ ...c, tgo: true })) });
    const again = planCertRows(ls, heldFrom(after.certs, r.base.certs.length, after.CD), after.companies.map((c) => ({ id: c.id, name: c.name })));
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
    expect(certKey(' cfo 1 ', 'บริษัท เอ  จำกัด')).toBe('CFO1|เอ');
    expect(certKey('CFO-1', 'บริษัท เอ จำกัด')).toBe(certKey(' cfo-1 ', 'เอ'));
  });
});
