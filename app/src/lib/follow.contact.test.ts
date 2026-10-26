import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPANY_CONTACT, followContact, followContactWords } from './follow';
import { emptySales, newDeal, type Deal, type DealAct, type SalesState } from './sales';
import type { LogEntry } from './types';

const TODAY = '2026-10-12';
/** The date and the count are written with no-break spaces (follow.ts whole). */
const nb = (s: string) => s.replace(/ /g, ' ');
const log = (at: string, type: string, p: Partial<LogEntry> = {}): LogEntry => ({ at, by: 'คุณ ก', type, ...p });
const deal = (id: string, p: Partial<Deal> = {}): Deal => newDeal({ id, client: 'บริษัท', gid: 1, year: '2569', ...p }, 'x', '2026-09-01T00:00:00Z');
function sales(deals: Deal[] = [], acts: DealAct[] = []): SalesState {
  const s = emptySales();
  deals.forEach((d) => (s.deals[d.id] = d));
  if (acts.length) s.acts = Object.fromEntries(acts.map((a) => [a.id, a]));
  return s;
}
const act = (id: string, dealId: string, d: string): DealAct => ({ id, deal: dealId, d, type: 'call', note: '', stage: '', pid: '', by: '', at: d + 'T09:00:00' });

describe('followContact: the company drawer\'s contact, for the ติดตาม line', () => {
  it('no log and no deal: not contacted, nothing counted', () => {
    const c = followContact([], [], emptySales(), TODAY);
    expect(c).toEqual({ last: '', count: 0 });
    expect(followContactWords(c)).toBe('ยังไม่ได้ติดต่อ');
  });

  it('one call: contacted on its day, no count shown', () => {
    const c = followContact([log('2026-10-14T10:00:00', 'call')], [], emptySales(), TODAY);
    expect(c).toEqual({ last: '2026-10-14', count: 1 });
    expect(followContactWords(c)).toBe(`ติดต่อแล้ว · ล่าสุด ${nb('14 ต.ค. 2569')}`);
  });

  it('many entries: the latest contact day, and how many entries the tab lists', () => {
    // in no order: the latest is found whatever the log's order
    const logs = [log('2026-10-02T08:00:00', 'email'), log('2026-10-10T15:00:00', 'meet'), log('2026-09-01T09:00:00', 'call'), log('2026-10-03T11:00:00', 'follow')];
    const c = followContact(logs, [], emptySales(), TODAY);
    expect(c).toEqual({ last: '2026-10-10', count: 4 });
    expect(followContactWords(c)).toBe(`ติดต่อแล้ว · ล่าสุด ${nb('10 ต.ค. 2569')} · ${nb('4 ครั้ง')}`);
  });

  it('the date is in Thai: the day without a leading zero, the month short, the year in พ.ศ.', () => {
    expect(followContactWords({ last: '2026-01-05', count: 1 })).toBe(`ติดต่อแล้ว · ล่าสุด ${nb('5 ม.ค. 2569')}`);
    expect(followContactWords({ last: '2026-12-31', count: 3 })).toBe(`ติดต่อแล้ว · ล่าสุด ${nb('31 ธ.ค. 2569')} · ${nb('3 ครั้ง')}`);
  });

  it('the date and the count do not part on a line: no ordinary space inside them', () => {
    const w = followContactWords({ last: '2026-10-26', count: 12 });
    expect(w).toBe(`ติดต่อแล้ว · ล่าสุด ${nb('26 ต.ค. 2569')} · ${nb('12 ครั้ง')}`);
    expect(w.replace('ติดต่อแล้ว · ล่าสุด ', '').split(' · ')).toEqual([nb('26 ต.ค. 2569'), nb('12 ครั้ง')]);
  });

  it('a note is not a contact: a company with only notes is not contacted, its notes still counted as the tab lists them', () => {
    const c = followContact([log('2026-10-01T09:00:00', 'note', { text: 'ส่งเอกสารแล้ว' }), log('2026-10-05T09:00:00', 'note')], [], emptySales(), TODAY);
    expect(c).toEqual({ last: '', count: 2 });
    expect(followContactWords(c)).toBe('ยังไม่ได้ติดต่อ');
  });

  it('a newer note does not move the last contact', () => {
    const c = followContact([log('2026-10-01T09:00:00', 'call'), log('2026-10-09T09:00:00', 'note')], [], emptySales(), TODAY);
    expect(c).toEqual({ last: '2026-10-01', count: 2 });
    expect(followContactWords(c)).toBe(`ติดต่อแล้ว · ล่าสุด ${nb('1 ต.ค. 2569')} · ${nb('2 ครั้ง')}`);
  });

  it('a deal counts its typed contact date and its contact records; a record is one entry of the tab', () => {
    const d = deal('D1', { contactDate: '2026-10-08' });
    const c = followContact([log('2026-10-02T10:00:00', 'call')], [d], sales([d], [act('A1', 'D1', '2026-10-12')]), TODAY);
    // the record (10-12) is later than the typed date (10-08) and the call (10-02): the last contact
    expect(c).toEqual({ last: '2026-10-12', count: 2 });
    expect(followContactWords(c)).toBe(`ติดต่อแล้ว · ล่าสุด ${nb('12 ต.ค. 2569')} · ${nb('2 ครั้ง')}`);
  });

  it('a deal alone can make the company contacted (its typed contact date), with no entry in the log', () => {
    const d = deal('D2', { contactDate: '2026-10-08' });
    expect(followContact([], [d], sales([d]), TODAY)).toEqual({ last: '2026-10-08', count: 0 });
  });

  it('a contact dated after today is listed but is not the last contact yet, as in the drawer', () => {
    const d = deal('D3');
    const c = followContact([], [d], sales([d], [act('A2', 'D3', '2026-10-20')]), TODAY);
    expect(c).toEqual({ last: '', count: 1 });
    expect(followContactWords(c)).toBe('ยังไม่ได้ติดต่อ');
  });

  it('the company-level types are the drawer\'s: the list of CompanyDrawer.tsx, read from its source', () => {
    const drawer = readFileSync(join(__dirname, '..', 'components', 'CompanyDrawer.tsx'), 'utf8');
    expect(COMPANY_CONTACT).toEqual(['call', 'email', 'meet', 'follow']);
    expect(drawer).toContain(`[${COMPANY_CONTACT.map((t) => `'${t}'`).join(', ')}].includes(l.type)`);
    expect(drawer).toContain('lastContact(e.sales, x, today)');
  });
});
