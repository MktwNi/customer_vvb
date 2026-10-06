import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { legacyLogId } from './teamSync';
import type { Dataset, RoundRaw } from './types';

const KEY = 'test-key-123';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

describe('Code.gs (Apps Script backend, run through the simulator)', () => {
  let s: GasSim;
  beforeEach(() => (s = createGasSim({ teamKey: KEY })));
  const push = (ops: unknown[]) => s.post({ action: 'push', key: KEY, ops });
  const pull = (since: number, limit?: number) => s.post({ action: 'pull', key: KEY, since, limit });

  it('rejects a wrong key and a script without TEAM_KEY', () => {
    expect(s.post({ action: 'ping', key: 'nope' })).toEqual({ ok: false, error: 'unauthorized' });
    expect(createGasSim({ teamKey: '' }).post({ action: 'ping', key: '' }).error).toBe('no_team_key');
    expect(createGasSim({ teamKey: '12345' }).post({ action: 'ping', key: '12345' }).error).toBe('no_team_key');
    expect(s.post('not json').error).toBe('bad_json');
  });

  it('appends ops with increasing seq and returns rows after the cursor', () => {
    expect(push([{ k: 'stage/1', v: 'won', by: 'A' }, { k: 'watch/1', v: 1 }])).toMatchObject({ ok: true, seq: 2, n: 2 });
    expect(push([{ k: 'stage/1', v: 'lost', by: 'B' }, { k: 'watch/1', del: true }])).toMatchObject({ seq: 4 });
    const all = pull(0);
    expect(all.rows!.map((r) => [r.seq, r.k, r.v, r.del, r.by])).toEqual([
      [1, 'stage/1', 'won', false, 'A'], [2, 'watch/1', 1, false, ''], [3, 'stage/1', 'lost', false, 'B'], [4, 'watch/1', null, true, ''],
    ]);
    expect(pull(2).rows!.map((r) => r.seq)).toEqual([3, 4]);
    expect(pull(4)).toEqual({ ok: true, seq: 4, rows: [], more: false });
  });

  it('round-trips values that Sheets would otherwise reinterpret', () => {
    const v = { at: '2026-01-01', phone: '0812345678', n: '00123', t: 'ไทย "quoted"' };
    push([{ k: 'contact/2026-01-01', v }, { k: 'x/1', v: '1.50' }]);
    const rows = pull(0).rows!;
    expect(rows[0]).toMatchObject({ k: 'contact/2026-01-01', v });
    expect(rows[1].v).toBe('1.50');
  });

  it('pages large pulls', () => {
    push(Array.from({ length: 1000 }, (_, i) => ({ k: `task/t${i}`, v: { i } })));
    push(Array.from({ length: 1000 }, (_, i) => ({ k: `task/u${i}`, v: { i } })));
    push(Array.from({ length: 1000 }, (_, i) => ({ k: `task/w${i}`, v: { i } })));
    push([{ k: 'task/last', v: 1 }]);
    const p1 = pull(0);
    expect(p1.rows!.length).toBe(3000);
    expect(p1.more).toBe(true);
    const p2 = pull(p1.rows![2999].seq);
    expect(p2.rows!.map((r) => r.k)).toEqual(['task/last']);
    expect(p2.more).toBe(false);
    expect(push(Array.from({ length: 1001 }, (_, i) => ({ k: `a/${i}`, v: 1 }))).error).toBe('too_many_ops');
  });

  it('compacts superseded rows but keeps the latest value per key and seq order', () => {
    for (let r = 0; r < 6; r++) push(Array.from({ length: 1000 }, (_, i) => ({ k: `stage/${i}`, v: `v${r}` })));
    const sh = s.sheet()!;
    expect(sh.getLastRow() - 1).toBeLessThan(6000); // compaction ran
    const all = pull(0, 3000);
    const rows = [...all.rows!];
    let since = rows[rows.length - 1].seq;
    while (all.more) {
      const nx = pull(since, 3000);
      rows.push(...nx.rows!);
      if (!nx.more) break;
      since = nx.rows![nx.rows!.length - 1].seq;
    }
    const final: Record<string, unknown> = {};
    rows.forEach((r) => (final[r.k] = r.v));
    expect(Object.keys(final).length).toBe(1000);
    expect(Object.values(final).every((v) => v === 'v5')).toBe(true);
    const seqs = rows.map((r) => r.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    // a client whose cursor was mid-way still converges
    const mid: Record<string, unknown> = {};
    let cur = 2500, more = true;
    while (more) {
      const r = pull(cur, 3000);
      r.rows!.forEach((x) => (mid[x.k] = x.v)); // applied in seq order, later rows win
      more = !!r.more;
      if (r.rows!.length) cur = r.rows![r.rows!.length - 1].seq;
    }
    expect(Object.keys(mid).length).toBe(1000);
    expect(Object.values(mid).every((v) => v === 'v5')).toBe(true);
  });
});

describe('team sync between two browsers (engines) on the real dataset', () => {
  let base: Dataset;
  let R: RoundRaw[];
  let sim: GasSim;
  let A: GccEngine, B: GccEngine;
  const mk = () => {
    const e = new GccEngine();
    e.base = structuredClone(base);
    e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
    e.ref = '2026-10-06';
    e.rebuild();
    e.loading = false;
    e.transport = async (_url, body) => sim.post(body);
    return e;
  };
  beforeAll(() => {
    vi.useFakeTimers(); // queued-op flush timers never fire on their own; the tests sync explicitly
    const g = json('gcc.json'), c = json('gcc-certs.json');
    base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' };
    R = json('rounds.json');
    sim = createGasSim({ teamKey: KEY });
    A = mk();
    B = mk();
  });
  afterAll(() => {
    A.dispose();
    B.dispose();
    vi.useRealTimers();
  });

  const cos = () => A.B.companies.filter((c) => c.ids.length === 1).slice(0, 6);

  it('refuses a wrong team code', async () => {
    expect(await A.teamConnect('https://script.google.com/macros/s/x/exec', 'wrong')).toBe(false);
    expect(A.team).toMatchObject({ status: 'error', msg: 'รหัสทีมไม่ถูกต้อง' });
    expect(A.teamCfg).toBeNull();
  });

  it('first connect uploads everything recorded locally before connecting', async () => {
    const [c1, c2, c3] = cos();
    A.setStage(c1.id, 'interested');
    A.setOwner(c1.id, 'คุณเอ');
    A.toggleWatch(c2.id);
    A.addTeam('คุณเอ');
    A.addTasks([c3.id], { type: 'call', date: '2026-10-09', time: '10:30', note: 'โทรครั้งแรก' });
    A.addLog(c3.id, 'call', 'ติดต่อได้', 'คุยกับฝ่ายจัดซื้อ');
    A.saveContact(c2, { phone: '02-111-2222', email: 'a@x.co', web: '', note: 'คุณบี' });
    const g = A.B.groups.find((x) => x.state === 'pending')!;
    A.decide(g.key, 'merge');
    expect(await A.teamConnect('https://script.google.com/macros/s/x/exec', KEY)).toBe(true);
    expect(A.team.status).toBe('ok');
    expect(A.teamPendingN).toBe(0);
    const keys = new Set(sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.map((r) => r.k));
    for (const k of [`stage/${c1.id}`, `owner/${c1.id}`, `watch/${c2.id}`, 'team/คุณเอ', `contact/${c2.id}`, `dedup/${g.key}`]) expect(keys.has(k)).toBe(true);
    expect([...keys].some((k) => k.startsWith('task/'))).toBe(true);
    expect([...keys].filter((k) => k.startsWith(`log/${c3.id}/`)).length).toBeGreaterThanOrEqual(2); // call + auto stage change
  });

  it('a second browser sees the same data after connecting', async () => {
    const [c1, c2, c3] = cos();
    const g = A.B.groups.find((x) => x.state === 'merge')!;
    // B already has its own local note for c1 and a different stage for c1
    B.setStage(c1.id, 'lost');
    B.addLog(c2.id, 'note', '', 'โน้ตจากเครื่อง B');
    expect(await B.teamConnect('https://script.google.com/macros/s/x/exec', KEY)).toBe(true);
    expect(B.stage(c1.id)).toBe('interested'); // the sheet's value wins for keys it already has
    expect(B.crm.owners[c1.id]).toBe('คุณเอ');
    expect(B.crm.watch).toContain(c2.id);
    expect(B.company(c2.id)!.fl.watch).toBe(true);
    expect(B.crm.team).toContain('คุณเอ');
    expect(B.tasksOf(c3.id).map((t) => t.note)).toContain('โทรครั้งแรก');
    expect((B.crm.log[c3.id] || []).some((l) => l.text === 'คุยกับฝ่ายจัดซื้อ')).toBe(true);
    expect(B.company(c2.id)!.phone).toBe('02-111-2222');
    expect(B.company(c2.id)!.hasPh).toBe(true);
    expect(B.dec[g.key]).toBe('merge');
    expect(B.B.groups.find((x) => x.key === g.key)!.state).toBe('merge');
    // B's local-only note was uploaded; A receives it on its next sync
    await A.teamSync();
    expect((A.crm.log[c2.id] || []).some((l) => l.text === 'โน้ตจากเครื่อง B')).toBe(true);
  });

  it('edits and deletions flow both ways; the last change to reach the sheet wins', async () => {
    const [c1, c2, c3] = cos();
    A.setStage(c1.id, 'proposal');
    await A.teamSync();
    B.setStage(c1.id, 'won');
    await B.teamSync();
    await A.teamSync();
    expect(A.stage(c1.id)).toBe('won');
    expect(B.stage(c1.id)).toBe('won');
    // delete a task and unstar on B → gone on A
    const t = B.tasksOf(c3.id)[0];
    B.delTask(t);
    B.toggleWatch(c2.id);
    await B.teamSync();
    await A.teamSync();
    expect(A.crm.tasks.some((x) => x.id === t.id)).toBe(false);
    expect(A.crm.watch).not.toContain(c2.id);
    expect(A.company(c2.id)!.fl.watch).toBe(false);
    // removing a log entry and a team member
    const l = A.crm.log[c3.id].find((x) => x.text === 'คุยกับฝ่ายจัดซื้อ')!;
    A.delLog(c3.id, l);
    A.delTeam('คุณเอ');
    A.setOwner(c1.id, '');
    await A.teamSync();
    await B.teamSync();
    expect((B.crm.log[c3.id] || []).some((x) => x.id === l.id)).toBe(false);
    expect(B.crm.team).not.toContain('คุณเอ');
    expect(B.crm.owners[c1.id]).toBeUndefined();
  });

  it('a pulled row never overwrites a local change that is still queued', async () => {
    const [c1] = cos();
    A.setStage(c1.id, 'contacted');
    await A.teamSync();
    B.setStage(c1.id, 'interested'); // queued, not yet pushed
    expect(B.teamPendingN).toBeGreaterThan(0);
    // simulate: B pulls (sees A's 'contacted') — must keep its own queued value, then push it
    await B.teamSync();
    expect(B.stage(c1.id)).toBe('interested');
    await A.teamSync();
    expect(A.stage(c1.id)).toBe('interested');
  });

  it('keeps changes made while offline and sends them once the sheet is reachable again', async () => {
    const [, , , c4] = cos();
    const real = B.transport;
    B.transport = async () => {
      throw new TypeError('Failed to fetch');
    };
    B.setStage(c4.id, 'won');
    await B.teamSync();
    expect(B.team.status).toBe('error');
    expect(B.team.msg).toContain('เชื่อมต่อไม่ได้');
    expect(B.teamPendingN).toBeGreaterThan(0);
    B.transport = real;
    await B.teamSync();
    expect(B.team.status).toBe('ok');
    expect(B.teamPendingN).toBe(0);
    await A.teamSync();
    expect(A.stage(c4.id)).toBe('won');
  });

  it('undoing a dedup decision on one browser regroups companies on the other', async () => {
    const g = B.B.groups.find((x) => x.state === 'merge')!;
    const before = A.B.companies.length;
    B.decide(g.key, null);
    await B.teamSync();
    await A.teamSync();
    expect(A.dec[g.key]).toBeUndefined();
    expect(A.B.companies.length).toBe(before + g.ids.length - 1);
  });

  it('disconnecting stops sharing but keeps local data', async () => {
    const [c1] = cos();
    A.teamDisconnect();
    expect(A.teamCfg).toBeNull();
    expect(A.team.status).toBe('off');
    A.setStage(c1.id, 'lost');
    expect(A.teamPendingN).toBe(0);
    expect(A.stage(c1.id)).toBe('lost');
  });

  it('legacy log entries get a stable id', () => {
    const e = { at: '2026-01-02T03:04:05.000Z', by: '', type: 'note', text: 'x' };
    expect(legacyLogId(e)).toBe(legacyLogId({ ...e }));
    expect(legacyLogId(e)).not.toBe(legacyLogId({ ...e, text: 'y' }));
  });
});
