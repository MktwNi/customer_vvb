import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { activeCust, cellDots, cellLabel, cellLines, chipName, monthCustomers, onlyCust, planDayLink } from './planCal';

describe('plan calendar: a day cell', () => {
  it('names a customer on a chip without the legal and country words', () => {
    expect(chipName('บริษัท ซากิโนมิยะ ประเทศไทย จำกัด')).toBe('ซากิโนมิยะ');
    expect(chipName('บริษัท เอ็มอีพี เฮคซ่า (ประเทศไทย) จำกัด')).toBe('เอ็มอีพี เฮคซ่า');
    expect(chipName('บริษัท เอ็นเอ็มบี-มินีแบ ไทย จำกัด')).toBe('เอ็นเอ็มบี-มินีแบ');
    expect(chipName('บริษัท ฝาจีบ จำกัด (มหาชน)')).toBe('ฝาจีบ');
    // "ไทย" inside a word stays
    expect(chipName('บริษัท ปูนซิเมนต์ไทย จำกัด (มหาชน)')).toBe('ปูนซิเมนต์ไทย');
    expect(chipName('บริษัท ไทยพลาสติกรีไซเคิล จำกัด')).toBe('ไทยพลาสติกรีไซเคิล');
    // never empty
    expect(chipName('ประเทศไทย')).toBe('ประเทศไทย');
  });
  it('keeps "ประเทศไทย" inside a word and after "แห่ง" (state enterprises keep their whole name)', () => {
    expect(chipName('ธนาคารแห่งประเทศไทย')).toBe('ธนาคารแห่งประเทศไทย');
    expect(chipName('การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย')).toBe('การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย');
    expect(chipName('การท่าเรือแห่งประเทศไทย')).toBe('การท่าเรือแห่งประเทศไทย');
    expect(chipName('โรงไฟฟ้าแม่เมาะ การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย')).toBe('โรงไฟฟ้าแม่เมาะ การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย');
    expect(chipName('บริษัท เชลล์แห่งประเทศไทย จำกัด')).toBe('เชลล์แห่งประเทศไทย');
    // "แห่ง" typed apart: still kept
    expect(chipName('สมาคมการค้าแห่ง ประเทศไทย')).toBe('สมาคมการค้าแห่ง ประเทศไทย');
    // in the middle or at the end of a word
    expect(chipName('บริษัท เชฟรอนประเทศไทยสำรวจและผลิต จำกัด')).toBe('เชฟรอนประเทศไทยสำรวจและผลิต');
    expect(chipName('บริษัท ซิงเกอร์ประเทศไทย จำกัด (มหาชน)')).toBe('ซิงเกอร์ประเทศไทย');
    // a word of its own in the middle goes, the rest stays
    expect(chipName('บริษัท ไพโอเนียร์ ประเทศไทย อีลาสติค จำกัด')).toBe('ไพโอเนียร์ อีลาสติค');
    // brackets glued to the name or typed with a space inside
    expect(chipName('บริษัท คิวพี(ประเทศไทย) จำกัด')).toBe('คิวพี');
    expect(chipName('บริษัท ลินเด้ (ประเทศไทย ) จำกัด (มหาชน)')).toBe('ลินเด้');
  });
  it('shows up to 3 lines: all of 3, else 2 and "อีก N"', () => {
    expect(cellLines([])).toEqual({ shown: [], more: 0 });
    expect(cellLines(['a', 'b', 'c'])).toEqual({ shown: ['a', 'b', 'c'], more: 0 });
    expect(cellLines(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b'], more: 2 });
    // an auto-planned day of 20
    expect(cellLines(Array.from({ length: 20 }, (_, i) => i))).toEqual({ shown: [0, 1], more: 18 });
  });
  it('shows up to 3 dots on a phone, then "อีก N"', () => {
    expect(cellDots(['a', 'b', 'c'])).toEqual({ shown: ['a', 'b', 'c'], more: 0 });
    expect(cellDots(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b', 'c'], more: 1 });
  });
  it('names the companies for screen readers, each once', () => {
    expect(cellLabel('12 ต.ค. 2569', true, ['ซากิโนมิยะ ประเทศไทย', 'ดีไวน์สตาร์ช', 'ซากิโนมิยะ ประเทศไทย'], [{ name: 'กรีนวัลเลย์ ฟู้ดส์', late: false }])).toBe('12 ต.ค. 2569 (วันนี้) · 3 งาน: ซากิโนมิยะ ประเทศไทย, ดีไวน์สตาร์ช · รับเงิน 1 งวด: กรีนวัลเลย์ ฟู้ดส์');
    expect(cellLabel('13 ต.ค. 2569', false, [], [])).toBe('13 ต.ค. 2569 · 0 งาน');
  });
  it('says in words which installments are late and whose (the red frame is not seen)', () => {
    // a late installment and a due one read differently, not only in colour
    const late = cellLabel('8 ต.ค. 2569', false, ['ฝาจีบ', 'พริมา มารีน'], [{ name: 'ไทยออยล์ เอนเนอร์ยี่', late: true }]);
    const due = cellLabel('15 ต.ค. 2569', false, ['ฝาจีบ', 'พริมา มารีน'], [{ name: 'ไทยออยล์ เอนเนอร์ยี่', late: false }]);
    expect(late).toBe('8 ต.ค. 2569 · 2 งาน: ฝาจีบ, พริมา มารีน · รับเงิน 1 งวด เลยกำหนด: ไทยออยล์ เอนเนอร์ยี่');
    expect(due).toBe('15 ต.ค. 2569 · 2 งาน: ฝาจีบ, พริมา มารีน · รับเงิน 1 งวด: ไทยออยล์ เอนเนอร์ยี่');
    expect(due).not.toContain('เลยกำหนด');
    // two installments of one client on the day: counted twice, named once
    expect(cellLabel('1 ต.ค. 2569', false, [], [{ name: 'บ้านปู', late: true }, { name: 'บ้านปู', late: true }])).toBe('1 ต.ค. 2569 · 0 งาน · รับเงิน 2 งวด เลยกำหนด: บ้านปู');
    // only some late: each late one is marked
    expect(cellLabel('1 ต.ค. 2569', false, [], [{ name: 'บ้านปู', late: true }, { name: 'ฝาจีบ', late: false }])).toBe('1 ต.ค. 2569 · 0 งาน · รับเงิน 2 งวด: บ้านปู (เลยกำหนด), ฝาจีบ');
  });
});

describe('plan calendar: the legend and its filter', () => {
  const T = [
    { date: '2026-10-12', ck: '26', name: 'ซากิโนมิยะ ประเทศไทย' },
    { date: '2026-10-16', ck: '26', name: 'ซากิโนมิยะ ประเทศไทย' },
    { date: '2026-10-12', ck: '301', name: 'ดีไวน์สตาร์ช' },
    { date: '2026-10-13', ck: 'n:เอ็นเอ็มบีมินีแบไทย', name: 'เอ็นเอ็มบี-มินีแบ ไทย' },
    { date: '2026-10-19', ck: '41', name: 'ดูราฟลอร์' },
    { date: '2026-11-02', ck: '78', name: 'ฝาจีบ' },
    { date: '2026-09-30', ck: '78', name: 'ฝาจีบ' },
  ];
  it('lists the month\'s customers once each with their count, in Thai name order', () => {
    const l = monthCustomers(T, '2026-10');
    expect(l.map((x) => [x.name, x.n])).toEqual([['ซากิโนมิยะ ประเทศไทย', 2], ['ดีไวน์สตาร์ช', 1], ['ดูราฟลอร์', 1], ['เอ็นเอ็มบี-มินีแบ ไทย', 1]]);
    // another month: another list; a month with none is empty
    expect(monthCustomers(T, '2026-11').map((x) => x.ck)).toEqual(['78']);
    expect(monthCustomers(T, '2026-12')).toEqual([]);
  });
  it('shows one customer alone, in every list, while it has an entry; "แสดงทุกบริษัท" ("") shows all', () => {
    const keys = T.map((x) => x.ck);
    expect(activeCust('26', keys)).toBe('26');
    expect(onlyCust(T, '26').map((x) => x.date)).toEqual(['2026-10-12', '2026-10-16']);
    // its appointments in other months stay (the filter follows the customer, not the month)
    expect(onlyCust(T, '78')).toHaveLength(2);
    expect(onlyCust(T, '')).toHaveLength(T.length);
    // a customer with nothing left (its appointments deleted): everyone again
    expect(activeCust('999', keys)).toBe('');
    expect(activeCust('', keys)).toBe('');
  });
  it('a link to a day from another page shows every customer (the legend filter is cleared)', () => {
    expect(planDayLink('2026-10-19')).toEqual({ tab: 'plan', calM: '2026-10', calDay: '2026-10-19', plCust: '', plOnlyT: '' });
    // what the day then shows: all of its entries, not the customer pressed earlier
    const before: { plCust: string } = { plCust: '26' };
    const ui = { ...before, ...planDayLink('2026-10-12') };
    const only = activeCust(ui.plCust, T.map((x) => x.ck));
    expect(onlyCust(T, only).filter((x) => x.date === ui.calDay).map((x) => x.ck)).toEqual(['26', '301']);
  });
  it('a bell row or an e-mail link to a day clears the type pressed in the legend too', () => {
    // the bell's day row: planDayLink plus the bell closing
    const before = { plCust: '', plOnlyT: 'plt', plColor: 'type' as const, bell: true };
    const ui = { ...before, ...planDayLink('2026-10-12'), bell: false };
    expect(ui).toMatchObject({ calDay: '2026-10-12', calM: '2026-10', plCust: '', plOnlyT: '', bell: false });
    // the colour mode is the person's choice and stays
    expect(ui.plColor).toBe('type');
  });
  it('every page that opens แผนติดต่อ on a day goes through planDayLink (none sets calDay itself)', () => {
    // the bell (components/Bell.tsx) and the e-mail link #go=plan&d= (App.tsx) once set calDay directly and
    // kept a legend filter that hid the entry they pointed to. Only the plan page moves its own day; the
    // app's state starts it empty.
    const SRC = fileURLToPath(new URL('..', import.meta.url));
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = join(d, f);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
      });
    const OWN = new Set(['lib/planCal.ts', 'tabs/Plan.tsx', 'state.tsx']);
    const files = walk(SRC).map((p) => ({ rel: relative(SRC, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));
    const bad = files.filter((f) => !OWN.has(f.rel) && /\bcalDay\s*:/.test(f.src)).map((f) => f.rel);
    expect(bad).toEqual([]);
    for (const rel of ['components/Bell.tsx', 'App.tsx']) expect(files.find((f) => f.rel === rel)?.src).toMatch(/planDayLink\(/);
  });
});
