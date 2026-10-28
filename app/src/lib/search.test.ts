import { describe, expect, it } from 'vitest';
import type { GccEngine } from './engine';
import { EMPTY_FILTERS, VAL_SEP, filterAll, joinVals, splitVals } from './search';
import type { Company } from './types';

// Synthetic companies: only the fields the filters read. rndKey is the round a company's CFO renewal falls in.
const co = (id: number, rndKey: string) =>
  ({ id, name: `บริษัท ${id}`, hay: `บริษัท ${id}`, tgt: 0, src: 0, ind: 0, prov: 0, type: 0, cfoSt: 'soon', rndKey, days: id, giLive: null, giMax: null, hasPh: false, invest: null, newYm: '', fl: {}, ids: [id] }) as unknown as Company;
const ROWS = [co(1, '6/2569'), co(2, '1/2570'), co(3, '2/2570'), co(4, 'later'), co(5, '')];
const engine = (companies: Company[]) => ({ crm: { stages: {}, owners: {} }, B: { companies, certs: [] } }) as unknown as GccEngine;
/** the ids of the companies a rnd filter string keeps, in order */
const kept = (rnd: string) => filterAll(engine(ROWS), { ...EMPTY_FILTERS, rnd }).out.map((c) => (c as Company).id);

describe('rounds filter: one value, several values', () => {
  it('one round keeps the companies whose round it is (the value Notes sets)', () => {
    expect(kept('6/2569')).toEqual([1]);
    expect(kept('2/2570')).toEqual([3]);
  });

  it('several rounds, comma-joined, keep the companies in any of them', () => {
    expect(kept('6/2569,1/2570')).toEqual([1, 2]);
    expect(kept('1/2570,2/2570,6/2569')).toEqual([1, 2, 3]);
  });

  it('spaces around a round are ignored', () => {
    expect(kept('6/2569, 1/2570')).toEqual([1, 2]);
  });

  it('an unknown round matches nothing, and does not spoil a known one chosen with it', () => {
    expect(kept('9/2599')).toEqual([]);
    expect(kept('9/2599,2/2570')).toEqual([3]);
  });

  it('later keeps the companies after the rounds in the table, alone or with others', () => {
    expect(kept('later')).toEqual([4]);
    expect(kept('later,6/2569')).toEqual([1, 4]);
  });

  it('empty = no filter: no rounds chosen keeps every company, company without a round included', () => {
    const all = [1, 2, 3, 4, 5];
    expect(kept('')).toEqual(all);
    expect(kept(',')).toEqual(all);
    expect(kept(' , ')).toEqual(all);
  });

  it('a company with no round is out as soon as any round is chosen', () => {
    expect(kept('6/2569,1/2570')).not.toContain(5);
  });
});

describe('the value string of a several-value filter', () => {
  it('joins the ticks with a comma and reads them back', () => {
    expect(VAL_SEP).toBe(',');
    expect(joinVals(['6/2569', '1/2570'])).toBe('6/2569,1/2570');
    expect([...splitVals('6/2569,1/2570')]).toEqual(['6/2569', '1/2570']);
  });

  it('one tick is that value alone, and no tick is the empty string (no filter)', () => {
    expect(joinVals(['6/2569'])).toBe('6/2569');
    expect([...splitVals('6/2569')]).toEqual(['6/2569']);
    expect(joinVals([])).toBe('');
    expect([...splitVals('')]).toEqual([]);
  });
});
