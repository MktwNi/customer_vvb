/**
 * The date chip as markup: the chosen day reads in Thai with the Buddhist year (2027-10-22 → "22 ต.ค. 2570"), the
 * hidden native input carries the saved day, and an empty chip says what to fill in.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DateChip } from './DateChip';

describe('the date chip', () => {
  it('shows the chosen day in Thai, with the Buddhist year', () => {
    const html = renderToStaticMarkup(<DateChip value="2027-10-22" onChange={() => {}} label="วันที่ติดต่อ" />);
    expect(html).toContain('>22 ต.ค. 2570</button>');
    expect(html).toContain('value="2027-10-22"');
  });

  it('an empty chip asks for a date and its native input is empty', () => {
    const html = renderToStaticMarkup(<DateChip value="" onChange={() => {}} label="วันที่ติดต่อ" />);
    expect(html).toContain('>ใส่วันที่</button>');
    expect(html).toContain('class="sl-dc-in"');
    expect(html).toContain('value=""');
  });
});
