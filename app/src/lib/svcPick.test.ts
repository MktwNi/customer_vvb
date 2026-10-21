/**
 * The service picker (components/SvcChips.tsx SvcPick) as data: the names it offers (lib/jobs.ts svcOptions,
 * usedServices, svcChoices), the add field's rule (addSvcName) and the groups it shows (lib/svcType.ts svcGroups).
 * Pure functions: the picker only shows what they return and stores what it is given.
 */
import { describe, expect, it } from 'vitest';
import { SVC_MAX, addSvcName, svcChoices, svcOptions, usedServices } from './jobs';
import { emptySales, newDeal, type Deal, type SalesState } from './sales';
import { svcGroups } from './svcType';

const Y = '2569';
function deal(s: SalesState, id: string, p: Partial<Deal> = {}) {
  s.deals[id] = newDeal({ id, year: Y, section: 'Retention', order: Object.keys(s.deals).length, client: 'บริษัท ทองมงคล จำกัด', ...p }, 'หมิว', '2026-10-01T03:00:00.000Z');
  return s.deals[id];
}
/** A joint quotation's header: the deal with a quotation of its own (lib/sales.ts jqt). */
function joint(s: SalesState, hid: string) {
  s.jqt = { ...(s.jqt || {}), [hid]: { title: 'ใบเสนอราคาร่วม', at: '2026-10-02T00:00:00.000Z', by: 'หมิว' } };
}

describe('the names the picker offers', () => {
  it('svcOptions: the team list, then the names given; each once by its key, the first spelling kept, spacing collapsed', () => {
    expect(svcOptions(['CFO', 'T-VER', 'CFP'], ['t-ver', ' Net  Zero Workshop ', 'cfp', ''])).toEqual(['CFO', 'T-VER', 'CFP', 'Net Zero Workshop']);
  });

  it('usedServices: every service a job holds, any year, a joint quotation\'s header too; a blank one is none', () => {
    const s = emptySales();
    deal(s, 'a', { service: ['CFO'] });
    deal(s, 'b', { service: ['Net  Zero Workshop', ' '], year: '2568' });
    deal(s, 'h', { service: ['CFP'] });
    joint(s, 'h');
    deal(s, 'c');
    expect(usedServices(s)).toEqual(['CFO', 'Net Zero Workshop', 'CFP']);
  });

  it('svcChoices: the team list, then every service the jobs hold that the list lacks', () => {
    const s = emptySales();
    s.cfg = { ...s.cfg, services: ['CFO', 'T-VER'] };
    deal(s, 'a', { service: ['Carbon Label Review', 't-ver'] });
    expect(svcChoices(s)).toEqual(['CFO', 'T-VER', 'Carbon Label Review']);
  });
});

describe('the add field', () => {
  const OPT = ['CFO', 'CFP', 'T-VER', 'Lab Audit', 'Net Zero Workshop'];

  it('a blank name is refused and said; nothing is picked or added', () => {
    for (const x of ['', '   ']) {
      expect(addSvcName(x, OPT, ['CFO'])).toEqual({ kind: 'empty', name: '', msg: 'กรอกชื่อบริการก่อนกดเพิ่ม', value: ['CFO'], options: OPT, on: false });
    }
  });

  it('invisible characters are not a name: a zero-width space alone is blank; one beside a name is removed, so it matches the listed one', () => {
    for (const x of ['​', ' ​‌ ', '﻿', '­']) expect(addSvcName(x, OPT, ['CFO'])).toMatchObject({ kind: 'empty', name: '', on: false });
    expect(addSvcName('CFO​', OPT, [])).toMatchObject({ kind: 'existing', name: 'CFO', value: ['CFO'], on: true });
    expect(addSvcName('Lab­Audit', OPT, [])).toMatchObject({ kind: 'added', name: 'LabAudit', value: ['LabAudit'], on: true });
  });

  it('a name with no letter or digit (a symbol alone) is refused and said; a Thai letter or a digit is a name', () => {
    for (const x of ['---', '+ / ', '…']) expect(addSvcName(x, OPT, ['CFO'])).toEqual({ kind: 'bare', name: '', msg: 'ชื่อบริการต้องมีตัวอักษรหรือตัวเลข', value: ['CFO'], options: OPT, on: false });
    expect(addSvcName('ก', OPT, [])).toMatchObject({ kind: 'added', name: 'ก' });
    expect(addSvcName('5G', OPT, [])).toMatchObject({ kind: 'added', name: '5G' });
  });

  it('a name of 40 characters is added; 41 is refused as too long (a Thai letter counts as one)', () => {
    expect(SVC_MAX).toBe(40);
    expect(addSvcName('ก'.repeat(40), OPT, [])).toMatchObject({ kind: 'added', name: 'ก'.repeat(40), on: true });
    expect(addSvcName('ก'.repeat(41), OPT, [])).toMatchObject({ kind: 'long', name: '', msg: 'ชื่อบริการต้องไม่เกิน 40 ตัวอักษร', value: [], on: false });
  });

  it('"  t-ver " selects T-VER once: an existing name is never duplicated', () => {
    const r = addSvcName('  t-ver ', OPT, []);
    expect(r).toMatchObject({ kind: 'existing', name: 'T-VER', value: ['T-VER'], on: true, msg: 'มีบริการ “T-VER” อยู่แล้ว เลือกให้แล้ว' });
    expect(r.options).toEqual(OPT);
  });

  it('a name already picked sets on, the value unchanged', () => {
    const r = addSvcName('CFO', OPT, ['CFO', 'CFP']);
    expect(r).toMatchObject({ kind: 'existing', name: 'CFO', value: ['CFO', 'CFP'], on: true, msg: 'มีบริการ “CFO” อยู่แล้ว และเลือกไว้แล้ว' });
  });

  it('"Net  Zero Workshop" (two spaces) matches the listed one', () => {
    expect(addSvcName('Net  Zero Workshop', OPT, [])).toMatchObject({ kind: 'existing', name: 'Net Zero Workshop', value: ['Net Zero Workshop'] });
  });

  it('a new name is kept with its spaces collapsed, picked, and listed', () => {
    const r = addSvcName(' Carbon  Label Review ', OPT, ['CFO']);
    expect(r).toMatchObject({ kind: 'added', name: 'Carbon Label Review', value: ['CFO', 'Carbon Label Review'], on: true, msg: 'เพิ่ม “Carbon Label Review” แล้ว และเลือกไว้แล้ว' });
    expect(r.options).toEqual([...OPT, 'Carbon Label Review']);
  });

  it('"lab audit" after "Lab Audit" is the existing one, whatever its case', () => {
    expect(addSvcName('lab audit', OPT, [])).toMatchObject({ kind: 'existing', name: 'Lab Audit' });
  });
});

describe('the groups the picker shows', () => {
  it('a name a type lists goes under its type (CC under T-VER), groups in list order, the custom group last; an empty group is left out', () => {
    const g = svcGroups(['Net Zero Workshop', 'T-VER', 'CC', 'CFO'], ['CFO', 'T-VER']);
    expect(g.map((x) => [x.id, x.title])).toEqual([['cfo', 'CFO'], ['tvr', 'T-VER'], ['custom', 'บริการที่เพิ่มเอง']]);
    expect(g[1].items).toEqual(['CC', 'T-VER']);
    expect(g[2].desc).toBe('เพิ่มจากงานของทีม ยังไม่อยู่ในรายการตั้งค่า');
  });

  it('a team name with no type goes under อื่นๆ (Course Training, CF-EVENT); a name no type lists and the team lacks goes under the custom group', () => {
    const g = svcGroups(['Course Training', 'CF-EVENT', 'Net Zero Workshop'], ['Course Training', 'CF-EVENT']);
    expect(g.map((x) => x.id)).toEqual(['oth', 'custom']);
    expect(g[0]).toMatchObject({ title: 'อื่นๆ', items: ['CF-EVENT', 'Course Training'] });
  });

  it('a known type the team list no longer has stays under its type, so a job\'s own service can be unticked', () => {
    expect(svcGroups(['VVB'], ['CFO']).map((x) => x.id)).toEqual(['vvb']);
  });

  it('cfo is under CFO (case does not count); the name is shown as written', () => {
    expect(svcGroups(['cfo'], [])).toEqual([{ id: 'cfo', title: 'CFO', desc: 'คาร์บอนฟุตพริ้นท์องค์กร', items: ['cfo'] }]);
  });

  it('names sorted (th, numeric), blank names left out, spacing collapsed; no names, no groups', () => {
    const [g] = svcGroups(['Net Zero 10', 'Net Zero 2', ' ', 'Carbon  Label'], []);
    expect(g.items).toEqual(['Carbon Label', 'Net Zero 2', 'Net Zero 10']);
    expect(svcGroups([], [])).toEqual([]);
  });
});
