import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayItems, tgoDaySet } from './homeDay';
import type { Round, RoundRaw, Task } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const R: Round[] = (JSON.parse(readFileSync(join(DATA, 'rounds.json'), 'utf8')) as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
const T = (id: string, date: string, time: string, done = false): Task => ({ id, gid: 1, title: 'บริษัท ' + id, type: 'call', date, time, note: '', done });
const who = (t: Task) => t.title;
const kind = () => 'โทร';
const r6 = R.find((r) => r.no === '6/2569')!;

describe('a day picked on หน้าแรก', () => {
  it("the TGO round's dates first, then the appointments by time, one with no time last", () => {
    const tasks = [T('ข', r6.fee, ''), T('ก', r6.fee, '13:00'), T('ค', r6.fee, '09:30', true), T('ง', '2026-12-31', '10:00')];
    expect(dayItems(r6.fee, tasks, R, who, kind).map((x) => [x.tm, x.t, x.sub])).toEqual([
      ['TGO', 'TGO รอบ 6/2569', 'ชำระค่าธรรมเนียม'],
      ['09:30', 'บริษัท ค', 'โทร · ทำแล้ว'],
      ['13:00', 'บริษัท ก', 'โทร'],
      ['ทั้งวัน', 'บริษัท ข', 'โทร'],
    ]);
  });
  it('a round names its document, fee and result days; a day with nothing has no line', () => {
    expect(dayItems(r6.doc, [], R, who, kind).map((x) => x.sub)).toEqual(['ส่งเอกสารภายใน']);
    expect(dayItems(r6.ann, [], R, who, kind).map((x) => x.sub)).toEqual(['ประกาศผล']);
    expect(dayItems('2026-11-25', [], R, who, kind)).toEqual([]);
  });
  it('the calendar marks exactly the days that list a TGO date', () => {
    const days = tgoDaySet(R);
    expect(days.has(r6.doc) && days.has(r6.fee) && days.has(r6.ann)).toBe(true);
    expect(days.has(r6.m1)).toBe(false);
    for (const d of days) expect(dayItems(d, [], R, who, kind).every((x) => x.tgo)).toBe(true);
  });
});
