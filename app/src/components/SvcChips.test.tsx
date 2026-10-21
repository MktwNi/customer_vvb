/**
 * The บริการ picker (SvcPick) as markup: the legend, the count line, the groups under their headings, a checkbox per
 * name, and the add field only where it may be used (a read-only account sees the list and no field).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SvcPick } from './SvcChips';

const ALL = ['CFO', 'T-VER', 'Net Zero Workshop'];
const TEAM = ['CFO', 'T-VER'];

describe('the บริการ picker', () => {
  it('a checklist: the legend, the count, each group under its heading, a checkbox per name, and the add field', () => {
    const html = renderToStaticMarkup(<SvcPick all={ALL} team={TEAM} value={['CFO']} onChange={() => {}} />);
    expect(html).toContain('<legend>บริการ</legend>');
    expect(html).toContain('เลือกแล้ว 1 บริการ');
    expect((html.match(/type="checkbox"/g) || []).length).toBe(3);
    expect(html).toContain('บริการที่เพิ่มเอง');
    expect(html).toContain('เพิ่มบริการใหม่');
    expect(html).toContain('>เพิ่ม</button>');
    expect(html).not.toContain('svc-ck-msg err');
  });

  it('read-only: every box is disabled and there is no add field', () => {
    const html = renderToStaticMarkup(<SvcPick all={ALL} team={TEAM} value={[]} onChange={() => {}} disabled />);
    expect(html).toContain('ยังไม่ได้เลือกบริการ');
    expect((html.match(/<input[^>]*disabled/g) || []).length).toBe(3);
    expect(html).not.toContain('svc-ck-add');
    expect(html).not.toContain('เพิ่มบริการใหม่');
  });
});
