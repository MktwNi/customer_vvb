/**
 * บริษัทที่ติดตาม's bulk selection (tabs/TrackFollow.tsx, components/BulkBar.tsx): "เลือกทั้งหมด" picks every
 * company the list holds under its quick filter, not only the page shown; the unfollow it offers is the search
 * page's own (lib/bulk.ts followedPicked, bulkActs, confirmWords) over the same picked keys; and an account that
 * may not change follows gets no boxes and no bar at all.
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN, type CapId } from './caps';
import {
  allPickWord, bulkActs, bulkPickable, confirmWords, followSplit, followedPicked, pickedCos, pruneSel, selView, toggleAll, toggleKey, unfollowNote, unfollowedWord,
} from './bulk';
import { followFilter, type FollowRow } from './follow';
import type { Company } from './types';

const PAGE = 40;
const co = (id: number, prov = 'นนทบุรี') => ({ id, name: 'บริษัท ' + id, hay: 'บริษัท ' + id, prov }) as unknown as Company;
const fr = (c: Company, owner = '') => ({ c, name: c.name, owner }) as unknown as FollowRow;
const can = (role: 'sales' | 'viewer') => (c: CapId) => !!BUILTIN[role].c[c];
const canon = (id: number) => (id === 10 ? 4 : id); // 10 was merged into 4

/** 116 companies, half in one province: the list the owner had (screenshot). */
const list = Array.from({ length: 116 }, (_, i) => fr(co(i + 1, i % 2 ? 'ชลบุรี' : 'นนทบุรี')));
const provOf = (r: FollowRow) => (r.c as unknown as { prov: string }).prov;

describe('"เลือกทั้งหมด" on บริษัทที่ติดตาม', () => {
  it('picks every company of the list, not only the page of it (116 shown in pages of 40)', () => {
    const rows = followFilter(list, '', provOf);
    expect(rows).toBe(list); // nothing typed: the list as it is
    const cos = rows.map((r) => r.c);
    expect(cos.slice(0, PAGE)).toHaveLength(PAGE);
    const picked = toggleAll(new Set(), cos);
    expect(picked.size).toBe(116);
    expect(selView(picked, cos)).toMatchObject({ n: 116, all: true, mixed: false });
    expect(allPickWord(116)).toBe('เลือกทั้งหมด (116 บริษัท)');
    // all picked: the next press lets them all go
    expect(toggleAll(picked, cos).size).toBe(0);
  });

  it('under the quick filter it picks the matching companies only, across every page of them', () => {
    const rows = followFilter(list, 'นนทบุรี', provOf);
    expect(rows).toHaveLength(58);
    expect(rows.slice(0, PAGE)).toHaveLength(PAGE); // the page holds 40 of the 58
    const picked = toggleAll(new Set(), rows.map((r) => r.c));
    expect(picked.size).toBe(58);
    expect(picked.has(2)).toBe(false); // a company of the other province is not picked
  });

  it('a pick is let go when the filter changes and the company is no longer listed', () => {
    const north = followFilter(list, 'นนทบุรี', provOf).map((r) => r.c);
    const picked = toggleAll(new Set(), north);
    expect(pruneSel(picked, north)).toBe(picked); // nothing left the list
    const east = followFilter(list, 'ชลบุรี', provOf).map((r) => r.c);
    expect(pruneSel(picked, east).size).toBe(0);
    // a row picked alone under the same list is kept while it stays listed
    const one = toggleKey(new Set(), 2); // company 2 is in the eastern province
    expect([...pruneSel(one, east)]).toEqual([2]);
  });

  it('a single tick on a row picks that company (its own key), and a second one on it lets it go', () => {
    const cos = list.slice(0, 3).map((r) => r.c);
    const s1 = toggleKey(new Set(), cos[1].id);
    expect([...s1]).toEqual([2]);
    expect(selView(s1, cos)).toMatchObject({ n: 1, mixed: true, all: false });
    expect([...toggleKey(s1, 2)]).toEqual([]);
  });
});

describe('the unfollow of the picked companies is the search page\'s', () => {
  it('removes exactly the picked companies the team follows, each once, in the list\'s order', () => {
    const watch = new Set([2, 4, 5]);
    expect(followedPicked([1, 2, 3, 4, 4], watch, canon)).toEqual([2, 4]);
    // a company followed by an id since merged into it counts once, as the company
    expect(followedPicked([10, 5], new Set([4, 5]), canon)).toEqual([4, 5]);
    expect(followedPicked([1, 3], watch, canon)).toEqual([]);
  });

  it('the same keys give the same unfollow on the list as on the search page (same companies, same count)', () => {
    const companies = Array.from({ length: 30 }, (_, i) => co(i + 1));
    const watch = new Set([2, 5, 7, 9, 11]);
    const sel = new Set([2, 3, 5, 30]);
    // the search page: its rows are the companies; the follow page: its rows are the followed rows' companies
    const searchCos = pickedCos(sel, companies);
    const followCos = pickedCos(sel, followFilter(companies.map((c) => fr(c)), '', provOf).map((r) => r.c));
    expect(followCos).toEqual(searchCos);
    const fs = followSplit(searchCos.map(canon), new Set([...watch]));
    const removed = followedPicked(followCos, watch, canon);
    expect(removed).toEqual([2, 5]);
    expect(removed).toHaveLength(fs.on);
    expect(bulkActs(can('sales'), fs.on, searchCos.length).unfollow).toBe(true);
    expect(confirmWords('unfollow', fs.on, fs.off, false)).toMatchObject({ title: 'เลิกติดตาม 2 บริษัท?', ok: 'เลิกติดตาม 2 บริษัท' });
  });

  it('says how many were taken off, and how many of the picked were not followed', () => {
    expect(unfollowedWord(3, 0)).toBe('เลิกติดตาม 3 บริษัทแล้ว');
    expect(unfollowedWord(2, 1)).toBe('เลิกติดตาม 2 บริษัทแล้ว (ไม่ได้ติดตามอยู่ 1)');
    expect(unfollowedWord(0, 3)).toBe(unfollowNote(0, 3));
  });
});

describe('who gets the boxes and the bar', () => {
  it('only an account that may change follows (ลูกค้าและผู้ติดต่อ): a sales account yes, a viewer no', () => {
    expect(bulkPickable(can('sales'))).toBe(true);
    expect(bulkPickable(can('viewer'))).toBe(false);
    expect(bulkPickable(() => false)).toBe(false);
  });
});
