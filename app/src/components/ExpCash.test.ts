/**
 * The out side's bill link (ExpCash openOutBill): it opens the bill through engine.expBill (this browser's
 * copy of a bill attached here first, else the team's Drive; its copy is the bill's own, which signing out
 * and a lost เปิดเอกสารแนบ clear), never the document opener, whose copies under 'docblob:' they would not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openOutBill } from './ExpCash';

afterEach(() => vi.unstubAllGlobals());

describe('the out side\'s bill link', () => {
  it('opens a bill attached in this browser (no Drive file yet) through engine.expBill, in a tab opened within the click', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.stubGlobal('window', { open: vi.fn(() => tab), alert: vi.fn() });
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const expBill = vi.fn(async () => blob);
    const file = { id: '', name: 'ใบเสร็จ.pdf', mime: 'application/pdf', size: 8 };
    await openOutBill({ expBill }, { expId: 'e9', file });
    expect(expBill).toHaveBeenCalledWith({ id: 'e9', file });
    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(tab.location.href).toMatch(/^blob:/);
    expect(window.alert).not.toHaveBeenCalled();
  });
  it('says why when it can\'t (the bill still on the recorder\'s computer) and closes the tab it opened', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.stubGlobal('window', { open: vi.fn(() => tab), alert: vi.fn() });
    const expBill = vi.fn(async () => {
      throw new Error('บิลนี้ยังอยู่ในเครื่องของคนที่บันทึก ยังไม่ได้อัปโหลดขึ้น Drive ของทีม');
    });
    await openOutBill({ expBill }, { expId: 'e8', file: { id: '', name: 'x.pdf', mime: 'application/pdf', size: 3 } });
    expect(tab.close).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('ยังอยู่ในเครื่องของคนที่บันทึก'));
    // no bill: nothing opens
    await openOutBill({ expBill }, { expId: 'e7', file: null });
    expect(expBill).toHaveBeenCalledTimes(1);
  });
});
