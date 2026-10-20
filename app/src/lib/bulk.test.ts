import { describe, expect, it } from 'vitest';
import {
  BIG, MAX_BULK, TIMED_MAX, TRACKER_MAX, allWord, bulkActs, clearedWord, confirmWords, createSel, dealSig, followNote, followSplit, hintWord, keyView, localWord,
  noTimeWord, ownerNote, ownerSplit, ownerSub, pickedCos, pickedRows, planNote, planWarn, pruneSel, rowCo, rowFits, rowKey, selKey, selView, selWord, spread,
  taskDates, timedOk, toggleAll, toggleKey, tooManyWord, trackerCapWord, trackerNote, trackerWarn, undoSentNote, unfollowNote,
  followedBatch, followedMenuWords, followedMoreWord, followedSendTip, followedSendWord,
} from './bulk';
import { newDeal } from './sales';
import { EMPTY_FILTERS, type Filters } from './search';
import type { CapId } from './caps';
import type { Cert, Company } from './types';

const co = (id: number) => ({ id, name: 'บริษัท ' + id }) as unknown as Company;
const cert = (cid: number, gid: number, coId = gid) => ({ cid, gid, co: { id: coId } }) as unknown as Cert;
const rows = [co(1), co(2), co(3), co(4)];
const S = (...k: number[]) => new Set(k);

describe('selection', () => {
  it('a row is picked by its company (view บริษัท) or its certificate (view ใบรับรอง CFO)', () => {
    expect(rowKey(co(7))).toBe(7);
    expect(rowCo(co(7))).toBe(7);
    expect(rowKey(cert(30, 7))).toBe(30);
    expect(rowCo(cert(30, 5, 7))).toBe(7); // the certificate's company as it stands now (merged)
    expect(rowCo({ cid: 31, gid: 9, co: undefined } as unknown as Cert)).toBe(9);
  });

  it('says the picked rows in the results\' order, and whether all or some are picked', () => {
    expect(selView(S(), rows)).toEqual({ keys: [], n: 0, all: false, mixed: false });
    expect(selView(S(3, 1), rows)).toEqual({ keys: [1, 3], n: 2, all: false, mixed: true });
    expect(selView(S(1, 2, 3, 4), rows)).toEqual({ keys: [1, 2, 3, 4], n: 4, all: true, mixed: false });
    // a key no longer among the results does not count
    expect(selView(S(1, 99), rows)).toMatchObject({ n: 1, mixed: true });
    expect(selView(S(1), [])).toMatchObject({ n: 0, all: false, mixed: false });
  });

  it('toggles one row, and "เลือกทั้งหมด" picks every result (not only the page shown), or none when all are', () => {
    const a = S(1);
    const b = toggleKey(a, 2);
    expect([...b]).toEqual([1, 2]);
    expect([...a]).toEqual([1]); // never changed in place: the page re-renders on a new Set
    expect([...toggleKey(b, 1)]).toEqual([2]);
    const many = Array.from({ length: 2228 }, (_, i) => co(i + 1));
    expect(toggleAll(S(5), many).size).toBe(2228); // some picked: all
    expect(toggleAll(new Set(many.map((c) => c.id)), many).size).toBe(0); // all picked: none
    expect(toggleAll(S(), [])).toEqual(S());
  });

  it('lets go of picked rows that left the results, keeping the same Set when none did', () => {
    const s = S(1, 2);
    expect(pruneSel(s, rows)).toBe(s);
    expect([...pruneSel(S(1, 9), rows)]).toEqual([1]);
    const empty = S();
    expect(pruneSel(empty, [])).toBe(empty);
  });

  it('gives the picked rows (the CSV) and their companies once each, in the results\' order', () => {
    expect(pickedRows(S(4, 2), rows).map((c) => c.id)).toEqual([2, 4]);
    const certs = [cert(10, 1), cert(11, 2), cert(12, 1), cert(13, 3)];
    expect(pickedCos(S(12, 11, 10), certs)).toEqual([1, 2]); // two certificates of company 1 count once
    expect(pickedCos(S(3, 1), rows)).toEqual([1, 3]);
  });

  it('keys the filters that decide the rows: sort and page do not let go of what was picked', () => {
    const f: Filters = { ...EMPTY_FILTERS, tgt: '0', ph: '1' };
    expect(selKey({ ...f, sort: 'name' })).toBe(selKey(f));
    expect(selKey({ ...f, prov: '3' })).not.toBe(selKey(f));
    expect(selKey({ ...f, view: 'cert' })).not.toBe(selKey(f));
    expect(selKey({ ...f, q: 'abc' })).not.toBe(selKey(f));
    // the list is made with the deferred query: the key follows it, not the box
    expect(selKey({ ...f, q: 'abcd' }, 'abc')).toBe(selKey({ ...f, q: 'abc' }));
    // key order does not matter (an object built another way)
    const g = Object.fromEntries(Object.entries(f).reverse()) as unknown as Filters;
    expect(selKey(g)).toBe(selKey(f));
    expect(keyView(selKey(f))).toBe('co');
    expect(keyView(selKey({ ...f, view: 'cert' }))).toBe('cert');
    expect(keyView('')).toBe('co');
  });

  it('a store: one notice per change, none when nothing changed', () => {
    const st = createSel();
    let n = 0;
    const off = st.sub(() => n++);
    const ids = S(1);
    st.set({ key: 'k', ids });
    st.set({ key: 'k', ids });
    expect(n).toBe(1);
    st.set({ key: 'k', ids: S(1) });
    expect(n).toBe(2);
    off();
    st.set({ key: 'x', ids: S() });
    expect(n).toBe(2);
    expect(st.get().key).toBe('x');
  });
});

describe('what the account may do', () => {
  const can = (caps: CapId[]) => (c: CapId) => caps.includes(c);
  it('admin (or no accounts): everything; ติดตาม while some picked are not followed, เลิกติดตาม while some are', () => {
    const all = can(['edit.cust', 'edit.deal', 'view.sales', 'edit.task']);
    expect(bulkActs(all, 0, 15)).toEqual({ follow: true, unfollow: false, tracker: true, plan: true, owner: true, csv: true, tooMany: false });
    expect(bulkActs(all, 3, 15)).toMatchObject({ follow: true, unfollow: true });
    expect(bulkActs(all, 15, 15)).toMatchObject({ follow: false, unfollow: true });
  });
  it('more than one change may take (the whole registry picked): the export only, and why', () => {
    const all = can(['edit.cust', 'edit.deal', 'view.sales', 'edit.task']);
    expect(bulkActs(all, 3, MAX_BULK)).toMatchObject({ follow: true, tracker: true, tooMany: false });
    expect(bulkActs(all, 3, MAX_BULK + 1)).toEqual({ follow: false, unfollow: false, tracker: false, plan: false, owner: false, csv: true, tooMany: true });
    expect(tooManyWord(55645)).toBe('เลือกไว้ 55,645 บริษัท ทำรายการได้ครั้งละไม่เกิน 5,000 บริษัท กรองให้แคบลงก่อน (ส่งออก CSV ได้)');
  });
  it('a viewer: export only; Sales Tracker needs both ดีลและขั้นตอน and seeing the tracker', () => {
    expect(bulkActs(can([]), 5, 9)).toEqual({ follow: false, unfollow: false, tracker: false, plan: false, owner: false, csv: true, tooMany: false });
    expect(bulkActs(can(['edit.deal']), 0, 9).tracker).toBe(false);
    expect(bulkActs(can(['edit.task']), 0, 9)).toMatchObject({ plan: true, follow: false, owner: false, tracker: false });
  });
  it('counts the followed and the owners among the picked', () => {
    expect(followSplit([1, 2, 3], S(2, 9))).toEqual({ on: 1, off: 2 });
    expect(ownerSplit([1, 2, 3, 4], { 1: 'หมิว', 2: 'คุณบี' }, 'หมิว')).toEqual({ same: 1, other: 1, none: 2 });
    expect(ownerSplit([1, 2, 3], { 1: 'หมิว' }, '')).toEqual({ same: 2, other: 1, none: 0 });
  });
});

describe('words', () => {
  it('says the count of the selection and of every result', () => {
    expect(selWord('co', 15, 15)).toBe('เลือก 15 บริษัท');
    expect(selWord('cert', 12, 10)).toBe('เลือก 12 ใบรับรอง (10 บริษัท)');
    expect(selWord('cert', 3, 3)).toBe('เลือก 3 ใบรับรอง');
    // the narrow bar leaves the companies to its menu's title
    expect(selWord('cert', 4367, 1963, true)).toBe('เลือก 4,367 ใบรับรอง');
    expect(selWord('co', 15, 15, true)).toBe('เลือก 15 บริษัท');
    expect(allWord('co', 2228)).toBe('เลือกทั้งหมด 2,228 บริษัท');
    expect(allWord('cert', 5)).toBe('เลือกทั้งหมด 5 ใบรับรอง');
    expect(clearedWord(15, 'co')).toBe('ล้างที่เลือก 15 บริษัทแล้ว เพราะเปลี่ยนคำค้นหรือตัวกรอง');
  });
  it('says what each action did', () => {
    expect(followNote(12, 3)).toBe('ติดตามเพิ่ม 12 บริษัท (ติดตามอยู่แล้ว 3)');
    expect(followNote(15, 0)).toBe('ติดตามเพิ่ม 15 บริษัท');
    expect(followNote(0, 4)).toBe('ติดตามอยู่แล้วทั้ง 4 บริษัท');
    expect(unfollowNote(2, 1)).toBe('เลิกติดตาม 2 บริษัท (ไม่ได้ติดตามอยู่ 1)');
    expect(unfollowNote(0, 3)).toBe('บริษัทที่เลือกไม่ได้อยู่ใน “บริษัทที่ติดตาม”');
    expect(trackerNote(15, 2, '2569')).toBe('ส่งเข้า Sales Tracker 15 ราย (ข้าม 2 รายที่มีในปี 2569 แล้ว)');
    expect(trackerNote(1200, 0, '2569')).toBe('ส่งเข้า Sales Tracker 1,200 ราย');
    expect(trackerNote(0, 3, '2569')).toBe('ทุกบริษัทที่เลือกมีในตารางปี 2569 แล้ว');
    expect(ownerNote('หมิว', { changed: 10, same: 2, kept: 3 })).toBe('ตั้ง หมิว เป็นผู้รับผิดชอบ 10 บริษัท (เป็นอยู่แล้ว 2 · ไม่เปลี่ยนคนเดิม 3)');
    expect(ownerNote('หมิว', { changed: 0, same: 4, kept: 0 })).toBe('หมิว เป็นผู้รับผิดชอบอยู่แล้ว');
    expect(ownerNote('', { changed: 5, same: 1, kept: 0 })).toBe('ล้างผู้รับผิดชอบ 5 บริษัท (เป็นอยู่แล้ว 1)');
    expect(planNote(15, '2026-10-20', '2026-10-22')).toBe('นัดติดต่อ 15 บริษัท 20 ต.ค. 2569 ถึง 22 ต.ค. 2569');
    expect(planNote(3, '2026-10-20', '2026-10-20')).toBe('นัดติดต่อ 3 บริษัท วันที่ 20 ต.ค. 2569');
  });
  it('asks before acting on many, and warns how many rows the tracker gets', () => {
    expect(BIG).toBe(200);
    expect(confirmWords('follow', 2225, 3, true)).toEqual({ title: 'ติดตาม 2,225 บริษัท?', body: expect.stringContaining('ติดตามอยู่แล้ว 3 บริษัท จะข้ามไป'), ok: 'ติดตาม 2,225 บริษัท' });
    expect(confirmWords('unfollow', 300, 0, true).ok).toBe('เลิกติดตาม 300 บริษัท');
    expect(trackerWarn(250, '2569', true)).toBe('จะเพิ่ม 250 แถวในตารางปี 2569 ของทั้งทีม ตรวจหมวดและปีให้ถูกก่อนส่ง');
  });
  it('speaks of the team only when one is connected (review: the words said so with no team at all)', () => {
    // (the list is named as the ติดตาม page names it: บริษัทที่ติดตาม, tabs/TrackFollow.tsx)
    expect(confirmWords('follow', 2228, 0, true).body).toBe('บริษัทที่เลือกจะขึ้นใน “บริษัทที่ติดตาม” ของทีม ทุกคนในทีมเห็นรายชื่อนี้');
    expect(confirmWords('follow', 2228, 0, false).body).toBe('บริษัทที่เลือกจะขึ้นใน “บริษัทที่ติดตาม”');
    expect(confirmWords('unfollow', 300, 0, true).body).toBe('บริษัทที่เลือกจะออกจาก “บริษัทที่ติดตาม” ของทีม ทุกคนในทีมจะไม่เห็นในรายชื่อนี้อีก');
    expect(confirmWords('unfollow', 300, 0, false).body).toBe('บริษัทที่เลือกจะออกจาก “บริษัทที่ติดตาม”');
    expect(trackerWarn(250, '2569', false)).toBe('จะเพิ่ม 250 แถวในตารางปี 2569 ตรวจหมวดและปีให้ถูกก่อนส่ง');
    expect(ownerSub(12, true)).toBe('ให้ 12 บริษัทที่เลือก · ทั้งทีมเห็นชื่อนี้ในหน้าบริษัท และใช้กรองได้');
    expect(ownerSub(12, false)).toBe('ให้ 12 บริษัทที่เลือก · ชื่อนี้ขึ้นในหน้าบริษัท และใช้กรองได้');
    expect(planWarn(2228, true)).toBe('จะสร้าง 2,228 นัดในแผนติดต่อของทีม ทุกคนในทีมเห็นนัดเหล่านี้');
    expect(planWarn(2228, false)).toBe('จะสร้าง 2,228 นัดในแผนติดต่อ');
    for (const w of [confirmWords('follow', 9, 1, false).body, confirmWords('unfollow', 9, 1, false).body, trackerWarn(9, '2569', false), ownerSub(9, false), planWarn(9, false), noTimeWord(false), trackerCapWord(400, false)])
      expect(w).not.toMatch(/ทีม/);
    // companies from the TGO website sync stay on this device: counted apart in the result
    expect(followNote(3, 0) + localWord(3)).toBe('ติดตามเพิ่ม 3 บริษัท · 3 บริษัทจากเว็บไซต์ TGO อยู่ในเครื่องนี้เท่านั้น');
    expect(localWord(0)).toBe('');
  });
  it('the bar before anything is picked says what ticking leads to', () => {
    expect(hintWord('co', false)).toBe('ติ๊กเลือกหลายบริษัท แล้วเลือกว่าจะทำอะไรที่แถบนี้');
    expect(hintWord('cert', true)).toBe('ติ๊กเลือกหลายใบรับรอง แล้วส่งออก CSV ได้ที่แถบนี้');
  });
});

describe('the Sales Tracker: one send adds at most TRACKER_MAX rows, and can be taken back', () => {
  it('says why a send of more is held, and what to do (review: thousands of rows froze the table)', () => {
    expect(TRACKER_MAX).toBe(300);
    expect(trackerCapWord(2227, true)).toBe(
      'ส่งเข้า Sales Tracker ได้ครั้งละไม่เกิน 300 บริษัท ตอนนี้จะเพิ่ม 2,227 แถว ตารางที่ยาวมากจะเปิดช้าสำหรับทุกคนในทีม ติ๊กออกให้เหลือไม่เกินนี้ หรือกรองในหน้าค้นหาให้แคบลงแล้วส่งทีละชุด (ส่งออก CSV ได้)',
    );
    expect(trackerCapWord(301, false)).toMatch(/^ส่งเข้า Sales Tracker ได้ครั้งละไม่เกิน 300 บริษัท ตอนนี้จะเพิ่ม 301 แถว ตารางที่ยาวมากจะเปิดช้า ติ๊กออก/);
  });
  it('a row is the same while what is typed in it is (who saved it, and when, do not count)', () => {
    const d = newDeal({ id: 'd1', client: 'บริษัท ก', year: '2569', section: 'TGO', gid: 7 }, 'หมิว');
    expect(dealSig({ ...d, at: '2030-01-01T00:00:00Z', by: 'คุณบี' })).toBe(dealSig(d));
    for (const p of [{ resp: 'คุณบี' }, { forecast: 50000 }, { section: 'อื่นๆ' }, { jobStatus: 'closed' as const }, { service: ['CFO'] }, { contactDate: '2026-10-20' }])
      expect(dealSig({ ...d, ...p })).not.toBe(dealSig(d));
  });
  it('says what เลิกทำ did', () => {
    expect(undoSentNote({ removed: 15, kept: 0 })).toBe('เอาออกจาก Sales Tracker แล้ว 15 ราย');
    expect(undoSentNote({ removed: 13, kept: 2 })).toBe('เอาออกจาก Sales Tracker แล้ว 13 ราย (2 รายที่มีคนแก้หรือเพิ่มข้อมูลแล้วยังอยู่)');
    expect(undoSentNote({ removed: 0, kept: 2 })).toBe('2 รายที่มีคนแก้หรือเพิ่มข้อมูลแล้วยังอยู่');
    expect(undoSentNote({ removed: 0, kept: 0, late: true })).toMatch(/^เลิกทำได้ภายใน 10 นาทีหลังส่ง/);
  });
});

describe('sending every followed company: at most TRACKER_MAX a press (review: 907 followed opened a dialog with nothing to send)', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  it('up to the cap: all of them, nothing left', () => {
    expect(followedBatch([])).toEqual({ ids: [], more: 0 });
    expect(followedBatch(ids(166))).toEqual({ ids: ids(166), more: 0 });
    expect(followedBatch(ids(300))).toEqual({ ids: ids(300), more: 0 });
  });
  it('past it: the first TRACKER_MAX in the list\'s order, and how many wait for the next press', () => {
    const b = followedBatch(ids(907));
    expect(b.ids).toEqual(ids(300));
    expect(b.more).toBe(607);
    expect(followedBatch(ids(301))).toEqual({ ids: ids(300), more: 1 });
    // pressed again after each send (the sent ones are in the table now): 607 → 300 + 307 → 300 + 7 → 7
    let left = ids(907), presses = 0;
    while (left.length) {
      const x = followedBatch(left);
      expect(x.ids.length).toBeLessThanOrEqual(TRACKER_MAX);
      left = left.filter((id) => !x.ids.includes(id));
      expect(x.more).toBe(left.length);
      presses++;
    }
    expect(presses).toBe(4);
  });
  it('the buttons say what they send; the dialog says what is left', () => {
    expect(followedSendWord(166)).toBe('ส่งเข้า Sales Tracker ทั้งหมด (166)');
    expect(followedSendWord(300)).toBe('ส่งเข้า Sales Tracker ทั้งหมด (300)');
    expect(followedSendWord(907)).toBe('ส่งเข้า Sales Tracker 300 บริษัทแรก');
    expect(followedSendTip(166, '2569')).toBe('166 บริษัทที่ยังไม่อยู่ในตารางปี 2569');
    expect(followedSendTip(907, '2569')).toBe('907 บริษัทที่ยังไม่อยู่ในตารางปี 2569 ส่งได้ครั้งละไม่เกิน 300 บริษัท ตามลำดับในรายการ แล้วกดอีกครั้งเพื่อส่งชุดถัดไป');
    expect(followedMenuWords(12)).toEqual({ label: 'ส่งบริษัทที่ติดตามอยู่ (12)', sub: 'ที่ยังไม่อยู่ในตารางปีนี้' });
    expect(followedMenuWords(1478)).toEqual({ label: 'ส่งบริษัทที่ติดตามอยู่ 300 บริษัทแรก', sub: 'จาก 1,478 บริษัทที่ยังไม่อยู่ในตารางปีนี้' });
    expect(followedMoreWord(607)).toBe('ส่งได้ครั้งละไม่เกิน 300 บริษัท อีก 607 บริษัทที่ติดตามส่งได้ในครั้งถัดไป');
  });
});

describe('the bar keeps one row (review: the first tick pushed the list 68px down under the pointer)', () => {
  it('the buttons fit when the count, the buttons and ล้างที่เลือก fit the width with their gaps; else the menu', () => {
    // 1366 with the menu docked: 1,040px inside; count 200 + six buttons 679 + ล้างที่เลือก 64, gaps 12
    expect(rowFits(1040, [204, 679, 64], 12)).toBe(true);
    // 1280: 956px inside
    expect(rowFits(926, [204, 679, 64], 12)).toBe(false);
    expect(rowFits(10, [], 12)).toBe(true);
    expect(rowFits(100, [50, 38], 12)).toBe(true);
    expect(rowFits(99, [50, 38], 12)).toBe(false);
  });
});

describe('appointments for many keep a เวลา only while a day has a few (review: one mail each used the team quota)', () => {
  it('at most TIMED_MAX a day', () => {
    expect(TIMED_MAX).toBe(5);
    expect(timedOk(2000, 0)).toBe(false); // ทั้งหมดในวันเดียว
    expect(timedOk(5, 0)).toBe(true);
    expect(timedOk(6, 0)).toBe(false);
    expect(timedOk(2000, 3)).toBe(true);
    expect(timedOk(2000, 5)).toBe(true);
    expect(timedOk(2000, 10)).toBe(false);
    expect(timedOk(2000, 20)).toBe(false);
    expect(timedOk(4, 10)).toBe(true); // fewer than a day's share: 4 on the day
    expect(noTimeWord(true)).toBe('ใส่เวลาได้เมื่อนัดไม่เกินวันละ 5 ราย เพราะนัดที่มีเวลาส่งอีเมลเตือนก่อน 1 ชั่วโมงทีละนัด ให้ทุกคนที่เปิดการเตือนไว้');
    expect(noTimeWord(false)).toBe('ใส่เวลาได้เมื่อนัดไม่เกินวันละ 5 ราย');
  });
});

describe('spreading appointments over working days', () => {
  it('fills each working day with `perDay`, skipping weekends, from the first working day on or after the start', () => {
    // Fri 9 Oct 2026, 3 a day: Fri, Fri, Fri, Mon, Mon, Mon, Tue
    expect(taskDates('2026-10-09', 7, 3)).toEqual(['2026-10-09', '2026-10-09', '2026-10-09', '2026-10-12', '2026-10-12', '2026-10-12', '2026-10-13']);
    // a Saturday start moves to Monday; 0 a day = all on the day given
    expect(taskDates('2026-10-10', 2, 5)).toEqual(['2026-10-12', '2026-10-12']);
    expect(taskDates('2026-10-10', 3, 0)).toEqual(['2026-10-10', '2026-10-10', '2026-10-10']);
    expect(taskDates('2026-10-12', 0, 5)).toEqual([]);
  });
  it('says the last day and how many days a big spread takes', () => {
    expect(spread('2026-10-12', 15, 5)).toEqual({ first: '2026-10-12', last: '2026-10-14', days: 3 });
    const big = spread('2026-10-12', 2228, 20);
    expect(big.days).toBe(112);
    expect(big.first).toBe('2026-10-12');
    expect(spread('2026-10-12', 0, 5)).toEqual({ first: '2026-10-12', last: '2026-10-12', days: 0 });
  });
});
