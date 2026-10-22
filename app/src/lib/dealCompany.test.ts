import { describe, expect, it } from 'vitest';
import { CUSTOM_ID_MIN, isLocalId } from './teamSync';
import { customIdOf, findCompanyByName } from './dealCompany';

const co = (id: number, name: string) => ({ id, name });
const REG = 1234;
const LOCAL = CUSTOM_ID_MIN - 1; // a company on this device only (TGO sync)
const MADE = CUSTOM_ID_MIN + 42; // a company added by hand

describe('findCompanyByName: the same company by its normalised name', () => {
  it('a name written another way is the same company: legal-form words, brackets and spaces left out', () => {
    const cos = [co(REG, 'เอสซีจี (ประเทศไทย)')];
    expect(findCompanyByName('บริษัท เอสซีจี (ประเทศไทย) จำกัด', cos)?.id).toBe(REG);
    expect(findCompanyByName('เอสซีจี ประเทศไทย', cos)?.id).toBe(REG);
    expect(findCompanyByName('  เอสซีจี (ประเทศไทย)  ', cos)?.id).toBe(REG);
    expect(findCompanyByName('บจก. เอสซีจี (ประเทศไทย)', cos)?.id).toBe(REG);
  });

  it('a partial name is another company: nothing found, so one is added', () => {
    const cos = [co(REG, 'เอสซีจี (ประเทศไทย)')];
    expect(findCompanyByName('เอสซีจี', cos)).toBeUndefined();
    expect(findCompanyByName('ประเทศไทย', cos)).toBeUndefined();
    expect(findCompanyByName('บริษัท อื่น จำกัด', cos)).toBeUndefined();
  });

  it('a blank name and a placeholder match nothing, even a company of that name', () => {
    const cos = [co(REG, 'ลูกค้าใหม่'), co(MADE, '')];
    expect(findCompanyByName('', cos)).toBeUndefined();
    expect(findCompanyByName('   ', cos)).toBeUndefined();
    expect(findCompanyByName('ลูกค้าใหม่', cos)).toBeUndefined();
  });

  it('a company on this device only is not the team\'s: a team company of the name is found, else none', () => {
    expect(isLocalId(LOCAL)).toBe(true);
    expect(findCompanyByName('บริษัท ทดสอบ จำกัด', [co(LOCAL, 'บริษัท ทดสอบ จำกัด')])).toBeUndefined();
    expect(findCompanyByName('ทดสอบ', [co(LOCAL, 'บริษัท ทดสอบ จำกัด'), co(MADE, 'ทดสอบ')])?.id).toBe(MADE);
  });

  it('the registry row first when a registry company and one added by hand share the exact name; never a duplicate', () => {
    const cos = [co(MADE, 'เอสซีจี (ประเทศไทย)'), co(REG, 'เอสซีจี (ประเทศไทย)')];
    expect(findCompanyByName('เอสซีจี (ประเทศไทย)', cos)?.id).toBe(REG);
    expect(findCompanyByName('เอสซีจี (ประเทศไทย)', [co(MADE, 'เอสซีจี (ประเทศไทย)')])?.id).toBe(MADE);
  });
  it('two team companies of one exact name and no registry row: the lowest id, whatever order the browser lists them in', () => {
    const hi = co(1000000000009, 'เอ บี'), lo = co(1000000000003, 'เอ บี');
    expect(findCompanyByName('เอ บี', [hi, lo])?.id).toBe(lo.id);
    expect(findCompanyByName('เอ บี', [lo, hi])?.id).toBe(lo.id);
  });
  it('a name typed exactly beats one that only matches after normalising, a registry row or a lower id notwithstanding', () => {
    const loose = co(REG, 'บริษัท เอ จำกัด'), exact = co(MADE, 'เอ');
    expect(findCompanyByName('เอ', [loose, exact])?.id).toBe(MADE);
    expect(findCompanyByName('เอ', [exact, loose])?.id).toBe(MADE);
    const low = co(1000, 'บริษัท เอ จำกัด'), high = co(2000, 'เอ');
    expect(findCompanyByName('เอ', [low, high])?.id).toBe(high.id);
    // (the typed name is also trimmed before it is compared exactly)
    expect(findCompanyByName('  เอ  ', [low, high])?.id).toBe(high.id);
  });
  it('the exact-name choice is made before the contact\'s company: the contact at the looser match does not win', () => {
    const exact = co(REG, 'เอ บี'), loose = co(REG + 5, 'เอ บี จำกัด');
    expect(findCompanyByName('เอ บี', [exact, loose], [loose.id])?.id).toBe(REG);
  });
  it('the contact\'s own company beats a tie: of two companies of one exact name, the one the contact is at, whatever the id', () => {
    const lo = co(1000000000003, 'เอ บี'), hi = co(1000000000009, 'เอ บี');
    expect(findCompanyByName('เอ บี', [lo, hi], [hi.id])?.id).toBe(hi.id);
    expect(findCompanyByName('เอ บี', [hi, lo], [hi.id])?.id).toBe(hi.id);
    expect(findCompanyByName('เอ บี', [lo, hi], [lo.id])?.id).toBe(lo.id);
    // a company of the contact's that is not one of the tie does not change the choice: the lowest id
    expect(findCompanyByName('เอ บี', [lo, hi], [MADE])?.id).toBe(lo.id);
    expect(findCompanyByName('เอ บี', [lo, hi], [])?.id).toBe(lo.id);
  });
  it('the contact\'s own company beats the registry row before a hand-added one in a tie', () => {
    const cos = [co(REG, 'เอ บี'), co(MADE, 'เอ บี')];
    expect(findCompanyByName('เอ บี', cos, [MADE])?.id).toBe(MADE);
    expect(findCompanyByName('เอ บี', cos, [REG])?.id).toBe(REG);
  });
  it('a blank name and a placeholder match none, even with the contact at a company of that name', () => {
    const cos = [co(REG, 'ลูกค้าใหม่'), co(MADE, '')];
    expect(findCompanyByName('', cos, [REG, MADE])).toBeUndefined();
    expect(findCompanyByName('ลูกค้าใหม่', cos, [REG])).toBeUndefined();
    expect(findCompanyByName('  ', [co(REG, '')], [REG])).toBeUndefined();
  });
});

describe('customIdOf: the id a company added for a name gets, the same on every browser', () => {
  it('the same normalised name, the same id; another name, another id; always in the custom range', () => {
    const a = customIdOf('เอสซีจี (ประเทศไทย)');
    expect(customIdOf('บริษัท เอสซีจี (ประเทศไทย) จำกัด')).toBe(a);
    expect(customIdOf('เอสซีจี ประเทศไทย')).toBe(a);
    expect(customIdOf('เอสซีจี')).not.toBe(a);
    expect(customIdOf('ทดสอบ จำกัด')).not.toBe(customIdOf('ทดสอบ ที่ปรึกษา'));
    for (const n of ['เอสซีจี (ประเทศไทย)', 'ทดสอบ', 'A B C', 'บริษัท ก จำกัด']) {
      const id = customIdOf(n);
      expect(Number.isSafeInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(CUSTOM_ID_MIN);
      expect(id).toBeLessThan(CUSTOM_ID_MIN + 8e12);
      expect(isLocalId(id)).toBe(false);
    }
  });
});
