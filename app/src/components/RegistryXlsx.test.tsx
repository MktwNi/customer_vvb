/**
 * The change report of a certificate-sheet save as markup (components/RegistryXlsx.tsx ChangeReport), from synthetic rows:
 * an unknown header is named as a warning and read from a real workbook (R10), the list keeps every row and does not cap
 * at 50 (R14), the rows sent to review are counted with each reason (R19), and the company count reads "ไม่สร้างบริษัทใหม่".
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChangeReport } from './RegistryXlsx';
import { SHEET, readCertSheetFull, type CertLogEntry } from '../lib/registryXlsx';
import { xlsxBytes, type XSheet } from '../lib/xlsx';

const logRow = (over: Partial<CertLogEntry>): CertLogEntry => ({
  row: 2, action: 'queued', co: 1e12 + 1, gcc: 'NEW-1', company: 'บริษัท ทดสอบ จำกัด', cert: 'SYN-1', changes: [],
  email: { action: 'none', from: '', to: '' }, msg: 'เข้ารอตรวจ TGO (เข้าทะเบียนเมื่อผู้ตรวจรับแล้ว)', ...over,
});

describe('the change report of a certificate-sheet save', () => {
  it('names an unknown header as a warning, and says the import does not read it', () => {
    const h = renderToStaticMarkup(<ChangeReport log={[]} warnings={['คอลัมน์แปลก']} />);
    expect(h).toContain('คอลัมน์ที่ไม่รู้จัก');
    expect(h).toContain('“คอลัมน์แปลก”');
    expect(h).toContain('ระบบไม่อ่านคอลัมน์เหล่านี้');
  });

  it('reads an unknown header from a real workbook, and no known extra column (the e-mail, its status) is unknown', async () => {
    const head = ['เลขที่ใบรับรอง', 'ชื่อองค์กร', 'วันที่อนุมัติ (พ.ศ.)', 'วันที่หมดอายุ (พ.ศ.)', 'รหัสบริษัท (GCC)', 'อีเมล', 'สถานะการค้นหาอีเมล', 'หมายเหตุการตรวจสอบอีเมล (ค้นเมื่อ 1 ม.ค. 2569)', 'คอลัมน์แปลก'];
    const sheet: XSheet = {
      name: SHEET, head, rows: [['SYN-U-1', 'บริษัท ทดสอบ หัวคอลัมน์ จำกัด', '01/02/2569', '31/01/2570', 'GCC-000001', 'a@example.test', 'พบ', 'ตรวจแล้ว', 'ค่าอะไรก็ได้']],
    };
    const r = await readCertSheetFull(await xlsxBytes([sheet]), SHEET);
    expect(r.unknown).toEqual(['คอลัมน์แปลก']);
    expect(r.lines).toHaveLength(1);
    expect([r.lines[0].gcc, r.lines[0].email, r.lines[0].emailSt]).toEqual(['GCC-000001', 'a@example.test', 'พบ']);
  });

  it('lists every row, not only the first 50, in a scrollable list', () => {
    const log = Array.from({ length: 60 }, (_, i) => logRow({ row: i + 2, cert: `SYN-${i}`, company: `บริษัท ทดสอบ ${i} จำกัด` }));
    const h = renderToStaticMarkup(<ChangeReport log={log} warnings={[]} />);
    expect((h.match(/role="listitem"/g) || []).length).toBe(60);
    expect(h).toContain('แถว 61 · เข้ารอตรวจ TGO');
    expect(h).toContain('ทุกแถวของชีต 60 แถว');
    expect(h).toContain('max-height:360px;overflow:auto');
    expect(h).not.toContain('และอีก');
  });

  it('counts the rows sent to review with each reason, and says the import creates no company', () => {
    const log = [
      logRow({ row: 2, action: 'review', msg: 'ไม่พบบริษัทในระบบ · ส่งไปรายการรอตรวจสอบจากไฟล์ชีต', reason: 'ไม่พบบริษัทในระบบ' }),
      logRow({ row: 3, action: 'review', msg: 'รหัส GCC ไม่พบในระบบ · ส่งไปรายการรอตรวจสอบจากไฟล์ชีต', reason: 'รหัส GCC ไม่พบในระบบ' }),
      logRow({ row: 4, action: 'review', msg: 'ไม่พบบริษัทในระบบ · ส่งไปรายการรอตรวจสอบจากไฟล์ชีต', reason: 'ไม่พบบริษัทในระบบ' }),
    ];
    const h = renderToStaticMarkup(<ChangeReport log={log} warnings={[]} />);
    expect(h).toContain('รอตรวจสอบ 3 แถว · ไม่พบบริษัทในระบบ 2 แถว · รหัส GCC ไม่พบในระบบ 1 แถว');
    expect(h).toContain('รอตรวจสอบจากไฟล์ชีต</span> 3');
    expect(h).toContain('ไม่สร้างบริษัทใหม่');
    expect(h).not.toContain('>บริษัทใหม่<');
  });

  it('shows each changed field as the old value and the new one, and the e-mail decision with the sheet address', () => {
    const log = [
      logRow({
        row: 5, action: 'updated', gcc: 'GCC-000361', company: 'บริษัท ทดสอบ ห้า จำกัด', cert: 'SYN-5',
        changes: [{ field: 'ประเภทที่ 1 (%)', from: '60%', to: '50%' }, { field: 'สาขา/รหัสสาขา', from: '', to: '(65)' }],
        email: { action: 'kept', from: 'old@example.test', to: 'new@example.test' },
      }),
    ];
    const h = renderToStaticMarkup(<ChangeReport log={log} warnings={[]} />);
    expect(h).toContain('ประเภทที่ 1 (%): เดิม 60% เป็น 50%');
    expect(h).toContain('สาขา/รหัสสาขา: เดิม ว่าง เป็น (65)');
    expect(h).toContain('มีอีเมลอยู่แล้ว ไม่เปลี่ยน · ในชีต new@example.test');
    expect(h).toContain('GCC-000361 · บริษัท ทดสอบ ห้า จำกัด · เลขที่ใบรับรอง SYN-5');
  });
});
