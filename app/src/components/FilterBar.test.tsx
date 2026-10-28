/**
 * The rounds filter (รอบ อบก. ที่ต้องยื่น) is a list: ticks in its popup, and the filter state holds the ticks
 * comma-joined. The popup's clicks go through flipVal, so the test ticks through it; the chip is read as markup.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FilterBar, flipVal, type FField } from './FilterBar';
import { joinVals } from '../lib/search';

const ROUNDS: FField = {
  key: 'rnd', label: 'รอบ อบก. ที่ต้องยื่น', kind: 'multi', all: 'ทั้งหมด',
  options: [{ v: '6/2569', label: 'รอบ 6/2569' }, { v: '1/2570', label: 'รอบ 1/2570' }, { v: 'later', label: 'หลังรอบในตาราง' }],
};

describe('the rounds ticks', () => {
  it('ticking two rounds leaves both in the filter state, comma-joined', () => {
    let sel: string[] = [];
    sel = flipVal(false, sel, '6/2569');
    sel = flipVal(false, sel, '1/2570');
    expect(joinVals(sel)).toBe('6/2569,1/2570');
  });

  it('a second press unticks one round, and ทั้งหมด clears every tick (no filter)', () => {
    const two = ['6/2569', '1/2570'];
    expect(joinVals(flipVal(false, two, '6/2569'))).toBe('1/2570');
    expect(joinVals(flipVal(false, two, ''))).toBe('');
  });

  it('a single choice (the other fields) takes one value alone', () => {
    expect(flipVal(true, ['6/2569'], '1/2570')).toEqual(['1/2570']);
    expect(flipVal(true, ['6/2569'], '')).toEqual([]);
  });
});

describe('the rounds chip', () => {
  it('shows every chosen round, joined with a comma and a space, after the question', () => {
    const html = renderToStaticMarkup(
      <FilterBar fields={[ROUNDS]} value={{ rnd: { v: ['6/2569', '1/2570'] } }} onChange={() => {}} anySet={false} />,
    );
    expect(html).toContain('รอบ อบก. ที่ต้องยื่น');
    expect(html).toContain('>คือ<');
    expect(html).toContain('>รอบ 6/2569, รอบ 1/2570<');
  });

  it('with no round chosen there is no rounds chip: the field waits in เพิ่มตัวกรอง', () => {
    const html = renderToStaticMarkup(<FilterBar fields={[ROUNDS]} value={{}} onChange={() => {}} anySet={false} />);
    expect(html).not.toContain('รอบ อบก. ที่ต้องยื่น');
    expect(html).not.toContain('>คือ<');
    expect(html).toContain('เพิ่มตัวกรอง');
  });
});
