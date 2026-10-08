import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Drift guard for the design system (simple-design/final/design-system.md §10.4): two font weights
 * (600 only on the หมวด band name, 700 only on the Montserrat wordmark), eight font sizes, and no
 * decorative glyphs (arrows, ticks, stars, emoji) in the UI code. New code that drifts fails here.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx|css)$/.test(f) || f === 'feeds.ts' ? [p] : [];
  });
const FILES = walk(SRC).map((p) => ({ rel: relative(SRC, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));

/** Files not on the system yet (none left: the Sales Tracker, the deal panel and the feeds' text are on
 *  it). An entry needs a reason and the list must end empty. */
const PENDING: Record<string, string> = {};
/** The Sales dashboard (.sd-*) is the owner's own layout, kept as designed: its sizes stay off the scale on
 *  purpose; its weights and glyphs are still checked. */
const SIZES_KEPT = /\.sd-/;

// blank out comments but keep line numbers
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^(\s*)\/\/.*$/gm, '$1');
// every number in a value (13.5px counts as 13.5, not 13)
const nums = (g: string) => [...g.matchAll(/(?<![\w.-])\d+(?:\.\d+)?/g)].map((m) => +m[0]);

const SCALE = new Set([12, 13, 14, 16, 18, 24, 28, 40]);
// CSS rules allowed off-system: the หมวด band name (600) and the Montserrat wordmark (700, 19–22px)
const BAND = /^\s*(\.sl-msec\s+)?\.sl-sec-name\b/;
const WORDMARK = /^\s*(\.brand-word|\.tb-brand-text b|\.auth-logo b)\b/;
const GLYPH = /[→←↑↓↗‹›▾▴⏰📎📅✓✔✕☆★⬇⬆⚙✎📞✉💬⟲฿]/u;
// a "+" in front of a button's words ("+ เพิ่มนัด"): labelled buttons carry no plus (§6.1 #8)
const PLUS_LABEL = /(^|[>'"`{])\s*\+ [\u0E00-\u0E7F]/;

describe('design system guard', () => {
  for (const { rel, src } of FILES) {
    if (PENDING[rel]) continue;
    const code = noComments(src);
    const lines = code.split('\n');
    it(`${rel}: weights 400/500 only (600 = band, 700 = wordmark)`, () => {
      const bad = lines.flatMap((l, i) =>
        [...l.matchAll(/font(?:Weight|-weight)\s*:([^,;}]*)/g)] // also catches `on ? 600 : 400`
          .flatMap((m) => nums(m[1]).filter((n) => n >= 100 && n <= 900 && n % 100 === 0))
          .filter((w) => w !== 400 && w !== 500 && !(w === 600 && BAND.test(l)) && !(w === 700 && WORDMARK.test(l)))
          .map((w) => `${rel}:${i + 1} weight ${w}`));
      expect(bad).toEqual([]);
    });
    it(`${rel}: sizes on the scale`, () => {
      const bad = lines.flatMap((l, i) =>
        [...l.matchAll(/font(?:Size|-size)\s*:([^,;}]*)/g)]
          .flatMap((m) => nums(m[1]).filter((n) => n >= 6 && n <= 120))
          .filter((s) => !SCALE.has(s) && !WORDMARK.test(l) && !(rel.endsWith('.css') && SIZES_KEPT.test(l)))
          .map((s) => `${rel}:${i + 1} size ${s}`));
      expect(bad).toEqual([]);
    });
    if (/\.(tsx|ts)$/.test(rel))
      it(`${rel}: no decorative glyphs, no "+" on a labelled button`, () => {
        const bad = lines.flatMap((l, i) => (GLYPH.test(l) || PLUS_LABEL.test(l) ? [`${rel}:${i + 1} ${l.trim().slice(0, 70)}`] : []));
        expect(bad).toEqual([]);
      });
  }
  it('lists what is still pending (shrink to nothing)', () => {
    expect(Object.keys(PENDING).every((k) => FILES.some((f) => f.rel === k))).toBe(true);
    expect(Object.keys(PENDING)).toEqual([]);
  });
});
