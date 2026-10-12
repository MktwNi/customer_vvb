import { describe, expect, it } from 'vitest';
import { HELP_FAQ, HELP_GROUPS, HELP_TOPICS, QUICK_STARTS, normHelp, searchHelp, topicScore, type HelpTopic } from './helpContent';

const ids = (r: { id: string }[]) => r.map((x) => x.id);

describe('help search', () => {
  it('ignores case and spaces (Thai is written without them)', () => {
    expect(normHelp('  Sales  Tracker ')).toBe('salestracker');
    expect(normHelp('แผน ชำระ')).toBe('แผนชำระ');
    expect(normHelp('“ผู้ใช้และสิทธิ์”')).toBe('ผู้ใช้และสิทธิ์');
    expect(ids(searchHelp('แผน ชำระ').topics)).toEqual(ids(searchHelp('แผนชำระ').topics));
    expect(ids(searchHelp('LOGIN').topics)).toEqual(ids(searchHelp('login').topics));
  });

  it('matches title, keywords, summary, then steps and tips, the title first', () => {
    const t: HelpTopic[] = [
      { id: 'steps', group: 'g', title: 'จ', summary: 'ฉ', steps: ['payment plan'], tips: [], roles: '', keywords: [] },
      { id: 'kw', group: 'g', title: 'ก', summary: 'ข', steps: [], tips: [], roles: '', keywords: ['payment plan'] },
      { id: 'sum', group: 'g', title: 'ค', summary: 'มี payment plan ในนี้', steps: [], tips: [], roles: '', keywords: [] },
      { id: 'title', group: 'g', title: 'Payment Plan', summary: 'ง', steps: [], tips: [], roles: '', keywords: [] },
      { id: 'tips', group: 'g', title: 'ช', summary: 'ซ', steps: [], tips: ['ดู payment plan'], roles: '', keywords: [] },
    ];
    expect(ids(searchHelp('paymentplan', t, []).topics)).toEqual(['title', 'kw', 'sum', 'steps', 'tips']);
    expect(topicScore(t[0], 'paymentplan')).toBe(0.5);
    // a keyword counts when it starts with the query, not when the query is somewhere inside it
    expect(topicScore(t[1], 'payment')).toBe(1);
    expect(topicScore(t[1], 'plan')).toBe(0);
    // one step's end and the next one's start don't make a match
    const two: HelpTopic = { ...t[0], steps: ['ไปที่แผน', 'ชำระแล้ว'] };
    expect(topicScore(two, normHelp('แผนชำระ'))).toBe(0);
  });

  it('reads "ำ" typed as two characters as one', () => {
    expect(normHelp('แผนช\u0E4D\u0E32ระ')).toBe(normHelp('แผนชำระ'));
    expect(normHelp('น\u0E49\u0E4D\u0E32')).toBe(normHelp('น้ำ'));
    expect(normHelp('น\u0E4D\u0E49\u0E32')).toBe(normHelp('น้ำ'));
    expect(ids(searchHelp('แผนช\u0E4D\u0E32ระ').topics)).toEqual(ids(searchHelp('แผนชำระ').topics));
  });

  it('finds LINE without the offline topic ("ไลน์" sits inside "ออฟไลน์")', () => {
    const thai = ids(searchHelp('ไลน์').topics);
    expect(thai.slice(0, 3)).toEqual(expect.arrayContaining(['add-person', 'person-page', 'sales-contact']));
    expect(thai).not.toContain('offline-queue');
    expect(ids(searchHelp('line').topics)).not.toContain('offline-queue');
    expect(ids(searchHelp('ออฟไลน์').topics)[0]).toBe('offline-queue');
    expect(ids(searchHelp('ไลน์').faq)).not.toContain('pending');
  });

  it('finds the words sales staff type', () => {
    expect(searchHelp('อีเมล์').topics.length).toBeGreaterThan(0);
    expect(searchHelp('แดชบอร์ด').topics[0].id).toBe('sales-dash');
    expect(searchHelp('เพิ่มพนักงาน').topics[0].id).toBe('add-user');
    expect(searchHelp('เพิ่มคน').topics[0].id).toBe('add-user');
    expect(searchHelp('ลบลูกค้า').topics[0].id).toBe('sales-panel');
    expect(ids(searchHelp('VAT').topics)).toEqual(expect.arrayContaining(['sales-attach', 'sales-partial']));
    expect(searchHelp('Esc').topics.length).toBeGreaterThan(0);
  });

  it('puts the payment plan first for "แผนชำระ" and a call for "โทร" (Enter opens the first)', () => {
    const plan = searchHelp('แผนชำระ').topics;
    expect(ids(plan).slice(0, 2)).toEqual(['sales-quickplan', 'sales-plan']);
    const call = searchHelp('โทร').topics;
    expect(call[0].id).toBe('sales-contact');
    expect(ids(call)).toEqual(expect.arrayContaining(['log-contact', 'person-page', 'schedule', 'edit-contact']));
  });

  it('searches the FAQ by question and answer', () => {
    expect(ids(searchHelp('หัก ณ ที่จ่าย').faq)).toContain('wht');
    expect(searchHelp('หัก ณ ที่จ่าย').faq[0].id).toBe('wht');
  });

  it('gives everything for an empty query, nothing for a word that is nowhere', () => {
    expect(searchHelp('   ').topics).toHaveLength(HELP_TOPICS.length);
    expect(searchHelp('').faq).toHaveLength(HELP_FAQ.length);
    expect(searchHelp('zzqqxx')).toEqual({ topics: [], faq: [] });
  });
});

describe('help content', () => {
  it('has unique ids, known groups, and every group in use', () => {
    const t = ids(HELP_TOPICS);
    expect(new Set(t).size).toBe(t.length);
    expect(new Set(ids(HELP_FAQ)).size).toBe(HELP_FAQ.length);
    const groups = new Set(ids(HELP_GROUPS));
    expect(HELP_TOPICS.every((x) => groups.has(x.group))).toBe(true);
    expect(HELP_GROUPS.every((g) => HELP_TOPICS.some((x) => x.group === g.id))).toBe(true);
  });

  it('has steps, a role line and a summary on every topic, and quick starts that point at topics', () => {
    for (const x of HELP_TOPICS) {
      expect(x.steps.length, x.id).toBeGreaterThan(0);
      expect(x.roles.trim(), x.id).not.toBe('');
      expect(x.summary.trim(), x.id).not.toBe('');
    }
    const known = new Set(ids(HELP_TOPICS));
    expect(QUICK_STARTS.flatMap((s) => s.steps).every((s) => known.has(s.topic))).toBe(true);
  });

  it('is words, not glyphs (the drift guard does not read .ts files)', () => {
    const GLYPH = /[→←↑↓↗‹›▾▴⏰📎📅✓✔✕☆★⬇⬆⚙✎📞✉💬⟲฿]/u;
    const all = [
      ...HELP_GROUPS.flatMap((g) => [g.name, g.desc]),
      ...HELP_TOPICS.flatMap((x) => [x.title, x.summary, x.roles, ...x.steps, ...x.tips]),
      ...HELP_FAQ.flatMap((f) => [f.q, f.a]),
      ...QUICK_STARTS.flatMap((s) => [s.title, s.who, ...s.steps.map((x) => x.text)]),
    ];
    expect(all.filter((s) => GLYPH.test(s) || /(^|\s)\+ [฀-๿]/.test(s))).toEqual([]);
  });
});
