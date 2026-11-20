import { describe, expect, it } from 'vitest';
import { UAT, ns, nsWith } from './uat';
import { PREF } from './storage';

describe('UAT copy of the site', () => {
  it('names its storage apart from the real site', () => {
    expect(nsWith(true, 'gcc-team-sync')).toBe('uat:gcc-team-sync');
    expect(nsWith(false, 'gcc-team-sync')).toBe('gcc-team-sync');
  });

  it('leaves the real site exactly as it was (its browsers keep their data)', () => {
    // tests build without VITE_UAT, as the real site does
    expect(UAT).toBe(false);
    expect(ns('gcc-registry')).toBe('gcc-registry');
    expect(PREF.team).toBe('gcc-team-sync');
    expect(PREF.session).toBe('gcc-team-session');
    expect(PREF.ui).toBe('gcc-ui');
    expect(Object.values(PREF).every((k) => k.startsWith('gcc-'))).toBe(true);
  });
});
