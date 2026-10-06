import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { errText, isLocalOnly, isTeamUrl, legacyLogId } from './teamSync';
import { memoryStore } from './storage';
import type { Dataset, RoundRaw } from './types';

const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/x/exec';
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
    expect(createGasSim({ teamKey: '1234567' }).post({ action: 'ping', key: '1234567' }).error).toBe('no_team_key');
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
    // (compaction threshold is remembered so later pushes don't re-read the whole sheet)
    expect(Number(s.props.COMPACT_AT)).toBeGreaterThanOrEqual(5000);
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

describe('Code.gs on a real-size sheet', () => {
  it('grows past the default 1000 rows and trims unused columns', () => {
    const s = createGasSim({ teamKey: KEY });
    for (let b = 0; b < 5; b++) {
      const r = s.post({ action: 'push', key: KEY, ops: Array.from({ length: 300 }, (_, i) => ({ k: `task/b${b}-${i}`, v: { i } })) });
      expect(r).toMatchObject({ ok: true, n: 300 });
    }
    const sh = s.sheet()!;
    expect(sh.getLastRow()).toBe(1501);
    expect(sh.getMaxRows()).toBeGreaterThanOrEqual(1501);
    expect(sh.getMaxColumns()).toBe(6);
    expect(s.post({ action: 'pull', key: KEY, since: 1400 }).rows!.length).toBe(100);
  });
  it('repairs an existing "sync" sheet that has no header row', () => {
    const s = createGasSim({ teamKey: KEY });
    s.addSheet('sync');
    s.post({ action: 'push', key: KEY, ops: [{ k: 'stage/1', v: 'won' }] });
    expect(s.sheet()!.rows[0][0]).toBe('seq');
    expect(s.post({ action: 'pull', key: KEY, since: 0 }).rows!.map((r) => r.k)).toEqual(['stage/1']);
  });
  it('rejects oversized values instead of storing a placeholder', () => {
    const s = createGasSim({ teamKey: KEY });
    const r = s.post({ action: 'push', key: KEY, ops: [{ k: 'contact/1', v: { note: 'x'.repeat(50000) } }, { k: 'stage/1', v: 'won' }] });
    expect(r).toMatchObject({ ok: true, n: 1, rejected: ['contact/1'] });
    expect(s.post({ action: 'pull', key: KEY, since: 0 }).rows!.map((x) => x.k)).toEqual(['stage/1']);
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
    e.store = memoryStore(); // each engine is its own browser
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
    expect(await A.teamConnect(URL, 'wrong')).toBe(false);
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
    expect(await A.teamConnect(URL, KEY)).toBe(true);
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
    expect(await B.teamConnect(URL, KEY)).toBe(true);
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
    expect(B.team.msg).toBe('เชื่อมต่อชีตไม่ได้ชั่วคราว จะลองใหม่อัตโนมัติ');
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

  it('a failed first pull still uploads pre-connect data on the next successful sync', async () => {
    const C = mk();
    const [, , , , c5] = cos();
    C.setStage(c5.id, 'proposal');
    C.toggleWatch(c5.id);
    let fail = true;
    C.transport = async (_u, body) => (fail && body.action === 'pull' ? { ok: false, error: 'busy' } : sim.post(body));
    expect(await C.teamConnect(URL, KEY)).toBe(false);
    expect(C.teamCfg?.seeded).toBe(false);
    fail = false;
    await C.teamSync();
    expect(C.team.status).toBe('ok');
    const keys = new Set(sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.map((r) => r.k));
    expect(keys.has(`watch/${c5.id}`)).toBe(true);
    C.dispose();
  });

  it('after a team-code change, queued edits survive and are sent with the new code', async () => {
    const [c1, c2] = cos();
    let rotated = false;
    const NEW = 'new-team-code-99';
    const real = A.transport;
    A.transport = async (u, body) => {
      if (!rotated) return real(u, body);
      return body.key === NEW ? real(u, { ...body, key: KEY }) : { ok: false, error: 'unauthorized' };
    };
    rotated = true;
    A.setStage(c1.id, 'won');
    A.toggleWatch(c2.id);
    await A.teamSync();
    expect(A.team.msg).toBe('รหัสทีมไม่ถูกต้อง');
    expect(A.teamNeedKey).toBe(true);
    expect(A.teamPendingN).toBeGreaterThanOrEqual(2);
    const ok = A.transport;
    A.transport = async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    };
    expect(await A.teamSetKey(NEW)).toBe(false); // the check timed out
    expect(A.team.msg).toContain('ลองกดอีกครั้ง');
    expect(A.teamNeedKey).toBe(true); // the new-code form stays
    A.transport = ok;
    expect(await A.teamSetKey(NEW)).toBe(true);
    expect(A.teamNeedKey).toBe(false);
    expect(A.teamPendingN).toBe(0);
    expect(A.stage(c1.id)).toBe('won');
    await B.teamSync();
    expect(B.stage(c1.id)).toBe('won');
    A.transport = real;
    A.teamCfg!.key = KEY;
  });

  it('disconnect + reconnect to the same sheet keeps queued edits instead of reverting them', async () => {
    const [c1] = cos();
    const real = A.transport;
    A.transport = async () => {
      throw new TypeError('Failed to fetch');
    };
    A.setStage(c1.id, 'lost'); // queued, can't send
    await A.teamSync();
    A.teamDisconnect();
    A.transport = real;
    expect(await A.teamConnect(URL, KEY)).toBe(true);
    expect(A.stage(c1.id)).toBe('lost');
    await B.teamSync();
    expect(B.stage(c1.id)).toBe('lost');
  });

  it('importing an old backup while connected only fills gaps (no reverts, no resurrected deletions)', async () => {
    const [c1, , c3] = cos();
    const t = { id: 'imp-task-1', gid: c3.id, title: 'x', type: 'call' as const, date: '2026-10-20', time: '', note: 'จากไฟล์สำรอง', done: false };
    A.setStage(c1.id, 'won');
    A.crm.tasks.push(t);
    await A.teamSync();
    A.delTask(A.crm.tasks.find((x) => x.id === t.id)!); // team deletes the task
    await A.teamSync();
    await B.teamSync();
    const [c6] = A.B.companies.filter((c) => c.ids.length === 1).slice(10, 11);
    const backup = { kind: 'gcc-crm-backup', v: 1, at: '2026-09-01T00:00:00.000Z', by: 'old', crm: { stages: { [c1.id]: 'contacted', [c6.id]: 'interested' }, tasks: [t], watch: [], owners: {}, team: [], log: {} }, contacts: {}, dedup: {} };
    const file = { text: async () => JSON.stringify(backup) } as unknown as File;
    await B.importCrm(file); // starts the merge sync in the background
    await vi.waitFor(() => {
      if ((B as unknown as { teamBusy: boolean }).teamBusy) throw new Error('still syncing');
    });
    await B.teamSync();
    expect(B.team.status).toBe('ok');
    await A.teamSync();
    expect(A.stage(c1.id)).toBe('won'); // not reverted to the backup's 'contacted'
    expect(B.stage(c1.id)).toBe('won');
    expect(A.crm.tasks.some((x) => x.id === t.id)).toBe(false); // deletion not undone
    expect(B.crm.tasks.some((x) => x.id === t.id)).toBe(false);
    expect(A.stage(c6.id)).toBe('interested'); // a gap the team didn't have is filled
  });

  it('never shares records of companies added from the TGO website (per-device ids)', () => {
    expect(isLocalOnly('stage/900003')).toBe(true);
    expect(isLocalOnly('log/900001/abc')).toBe(true);
    expect(isLocalOnly('task/x', { gid: 900002 })).toBe(true);
    expect(isLocalOnly('stage/1234')).toBe(false);
    const before = A.teamPendingN;
    A.crm.stages[900001] = 'none';
    A.setStage(900001, 'won');
    expect(A.teamPendingN).toBe(before);
  });

  it('two tabs of one browser share the queue and never re-send stale changes', async () => {
    const [, , , , , c6] = cos();
    const shared = memoryStore();
    const T1 = mk(), T2 = mk();
    T1.store = T2.store = shared;
    expect(await T1.teamConnect(URL, KEY)).toBe(true);
    T2.teamCfg = { ...T1.teamCfg! };
    const real = T1.transport;
    T1.transport = async () => {
      throw new TypeError('Failed to fetch');
    };
    T1.setStage(c6.id, 'contacted'); // queued in shared storage while offline
    await T1.teamSync();
    T1.transport = real;
    await T1.teamSync(); // pushes 'contacted'
    T1.setStage(c6.id, 'won');
    await T1.teamSync(); // pushes 'won'
    await T2.teamSync(); // must not push the stale 'contacted' it saw at startup
    await A.teamSync();
    expect(A.stage(c6.id)).toBe('won');
    expect(T2.stage(c6.id)).toBe('won');
    T1.dispose();
    T2.dispose();
  });

  it('a star on a company that is merged on this device updates the right flags', async () => {
    const merged = A.B.companies.find((c) => c.ids.length > 1)!;
    const alias = merged.ids.find((i) => i !== merged.id)!;
    sim.post({ action: 'push', key: KEY, ops: [{ k: `watch/${alias}`, v: 1 }] });
    await A.teamSync();
    expect(A.crm.watch).toContain(alias);
    expect(merged.fl.watch).toBe(A.crm.watch.includes(merged.id));
  });

  it('only accepts Apps Script web-app URLs and explains network failures', () => {
    expect(isTeamUrl('https://script.google.com/macros/s/AKfycbx_abc-123/exec')).toBe(true);
    expect(isTeamUrl('https://script.google.com/a/macros/acme.co.th/s/AKfy/exec')).toBe(true);
    expect(isTeamUrl('https://script.google.com/macros/s/AKfy/dev')).toBe(false);
    expect(isTeamUrl('https://evil.example/collect')).toBe(false);
    expect(isTeamUrl('http://localhost:8787')).toBe(false); // only when the app itself runs on localhost
    // connecting: a network error usually means a deployment setting; nothing retries by itself
    expect(errText(new TypeError('Failed to fetch'), 'connect')).toContain('/exec');
    expect(errText(Object.assign(new Error('x'), { name: 'TimeoutError' }), 'connect')).toContain('ลองกดอีกครั้ง');
    // background sync of a working setup: transient, retried automatically
    expect(errText(new TypeError('Failed to fetch'))).not.toContain('/exec');
    expect(errText(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toContain('ลองใหม่อัตโนมัติ');
    vi.stubGlobal('navigator', { onLine: false });
    try {
      expect(errText(new TypeError('Failed to fetch'), 'connect')).toContain('กดอีกครั้ง'); // nothing retries a connect
      expect(errText(new TypeError('Failed to fetch'))).toContain('เมื่อกลับมาออนไลน์');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a large first upload reaches the sheet completely (no lost ops between batches)', async () => {
    const D = mk();
    const many = D.B.companies.slice(0, 1300);
    many.forEach((c) => D.toggleWatch(c.id)); // > 4 push batches, all queued within a few ms
    expect(await D.teamConnect(URL, KEY)).toBe(true);
    expect(D.teamPendingN).toBe(0);
    const keys = new Set(sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.map((r) => r.k));
    expect(many.filter((c) => !keys.has(`watch/${c.id}`)).length).toBe(0);
    D.dispose();
  });

  it('a change made while its previous value is being sent stays queued', async () => {
    const [c1] = cos();
    const real = A.transport;
    A.transport = async (u, body) => {
      if (body.action === 'push') A.setStage(c1.id, 'won'); // user edits again mid-request
      return real(u, body);
    };
    A.setStage(c1.id, 'proposal');
    await A.teamSync();
    A.transport = real;
    // acknowledging the 'proposal' push must not drop the newer 'won' (same key, newer op)
    expect(A.teamPendingN).toBe(0);
    const last = sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((r) => r.k === `stage/${c1.id}`).pop()!;
    expect(last.v).toBe('won');
    await B.teamSync();
    expect(B.stage(c1.id)).toBe('won');
  });

  const URL2 = 'https://script.google.com/macros/s/y/exec';
  /** Run with a working localStorage (shared by every engine of the test, like tabs of one browser). */
  const withLocalStorage = async (fn: (ls: Map<string, string>) => Promise<void>) => {
    const ls = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) });
    try {
      await fn(ls);
    } finally {
      vi.unstubAllGlobals();
    }
  };
  const sheetValue = (g: GasSim, k: string) => g.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((r) => r.k === k).pop();

  it('unsent edits move with you to the next link (e.g. the lead re-deployed the sheet)', () =>
    withLocalStorage(async () => {
      const sim2 = createGasSim({ teamKey: KEY });
      const D = mk();
      let down = false;
      D.transport = async (u, body) => {
        if (down) throw new TypeError('Failed to fetch');
        return (u === URL2 ? sim2 : sim).post(body);
      };
      expect(await D.teamConnect(URL, KEY)).toBe(true);
      const [, , , , , , c7] = D.B.companies.filter((c) => c.ids.length === 1);
      sim2.post({ action: 'push', key: KEY, ops: [{ k: `stage/${c7.id}`, v: 'lost' }] }); // the new link already has a value
      down = true;
      D.setStage(c7.id, 'proposal'); // queued for link 1, can't send
      await D.teamSync();
      down = false;
      D.teamDisconnect();
      expect(await D.teamConnect(URL2, KEY)).toBe(true);
      expect(D.stage(c7.id)).toBe('proposal'); // not overwritten by the new sheet's older value
      expect(sheetValue(sim2, `stage/${c7.id}`)!.v).toBe('proposal');
      expect(D.teamPendingN).toBe(0);
      D.dispose();
    }));

  it('a tab on another sheet never takes or sends this sheet\'s queue', async () => {
    const sim2 = createGasSim({ teamKey: KEY });
    const shared = memoryStore();
    const T1 = mk(), T2 = mk();
    T1.store = T2.store = shared;
    let down = false;
    T1.transport = async (_u, body) => {
      if (down) throw new TypeError('Failed to fetch');
      return sim.post(body);
    };
    T2.transport = async (_u, body) => sim2.post(body);
    expect(await T1.teamConnect(URL, KEY)).toBe(true);
    expect(await T2.teamConnect(URL2, KEY)).toBe(true);
    const [, , , , , , , , c9] = T1.B.companies.filter((c) => c.ids.length === 1);
    down = true;
    T1.setStage(c9.id, 'won'); // queued for sheet 1 only
    await T1.teamSync();
    await T2.teamSync();
    expect(sheetValue(sim2, `stage/${c9.id}`)).toBeUndefined();
    down = false;
    await T1.teamSync();
    expect(sheetValue(sim, `stage/${c9.id}`)!.v).toBe('won');
    T1.dispose();
    T2.dispose();
  });

  it('an older queued change never overwrites a newer one that could not be stored', async () => {
    const D = mk();
    const mem = memoryStore();
    let failQueue = false;
    D.store = { ...mem, update: (k, fn) => (failQueue && k.startsWith('teamPending') ? Promise.reject(new DOMException('full', 'QuotaExceededError')) : mem.update(k, fn)) };
    let down = false;
    D.transport = async (_u, body) => {
      if (down) throw new TypeError('Failed to fetch');
      return sim.post(body);
    };
    expect(await D.teamConnect(URL, KEY)).toBe(true);
    const [, , , , , , , , , c10] = D.B.companies.filter((c) => c.ids.length === 1);
    down = true;
    D.setStage(c10.id, 'proposal'); // stored in the queue
    await D.teamSync();
    failQueue = true;
    D.setStage(c10.id, 'won'); // newer, kept in memory only
    await Promise.resolve();
    failQueue = false;
    down = false;
    await D.teamSync();
    await D.teamSync();
    expect(D.teamPendingN).toBe(0);
    expect(sheetValue(sim, `stage/${c10.id}`)!.v).toBe('won');
    D.dispose();
  });

  it('a large first upload survives a queue write that fails only for big writes', async () => {
    const D = mk();
    const mem = memoryStore();
    D.store = {
      ...mem,
      update: (k, fn) =>
        mem.update(k, (cur) => {
          const next = fn(cur as never);
          if (k.startsWith('teamPending') && Array.isArray(next) && next.length > 100) throw new DOMException('full', 'QuotaExceededError');
          return next;
        }),
    };
    const many = D.B.companies.slice(2000, 2700);
    many.forEach((c) => D.toggleWatch(c.id));
    expect(await D.teamConnect(URL, KEY)).toBe(true);
    await D.teamSync();
    const keys = new Set(sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.map((r) => r.k));
    expect(many.filter((c) => !keys.has(`watch/${c.id}`)).length).toBe(0);
    expect(D.teamPendingN).toBe(0);
    D.dispose();
  });

  it('importing while a sync is in flight still fills the gaps afterwards', async () => {
    const D = mk();
    D.transport = async (_u, body) => sim.post(body);
    expect(await D.teamConnect(URL, KEY)).toBe(true);
    const [c11] = D.B.companies.filter((c) => c.ids.length === 1).slice(20, 21);
    let release!: () => void;
    let hold = true;
    D.transport = async (_u, body) => {
      if (hold && body.action === 'pull') {
        hold = false;
        await new Promise<void>((r) => (release = r));
      }
      return sim.post(body);
    };
    const inflight = D.teamSync(); // e.g. started by the window regaining focus after the file picker
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const backup = { kind: 'gcc-crm-backup', v: 1, at: '2026-09-01T00:00:00.000Z', by: 'old', crm: { stages: { [c11.id]: 'interested' }, tasks: [], watch: [], owners: {}, team: [], log: {} }, contacts: {}, dedup: {} };
    await D.importCrm({ text: async () => JSON.stringify(backup) } as unknown as File);
    release();
    await inflight;
    await vi.advanceTimersByTimeAsync(100); // the follow-up round queued by the import
    await vi.waitFor(() => expect((D as unknown as { teamBusy: boolean }).teamBusy).toBe(false));
    expect(sheetValue(sim, `stage/${c11.id}`)!.v).toBe('interested');
    D.dispose();
  });

  it('a tab that follows another tab\'s connect seeds from stored data, not its stale copy', () =>
    withLocalStorage(async () => {
      const shared = memoryStore();
      const T1 = mk(), T2 = mk();
      T1.store = T2.store = shared;
      const starred = new Set(sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.map((r) => r.k));
      const x = T1.B.companies.find((c) => c.ids.length === 1 && !starred.has(`watch/${c.id}`))!;
      T2.crm.watch.push(x.id); // T2 still shows a star that T1 removed before connecting
      T1.saveCrm();
      let release!: () => void;
      T1.transport = async (_u, body) => {
        if (body.action === 'pull' && !release) await new Promise<void>((r) => (release = r));
        return sim.post(body);
      };
      const connecting = T1.teamConnect(URL, KEY);
      await vi.waitFor(() => expect(release).toBeTypeOf('function')); // T1's first round is in flight (seeded: false)
      (T2 as unknown as { teamPrefsChanged: (e: { key: string }) => void }).teamPrefsChanged({ key: 'gcc-team-sync' });
      expect(T2.teamCfg).toMatchObject({ url: URL, seeded: false });
      await vi.waitFor(() => expect((T2 as unknown as { teamBusy: boolean }).teamBusy).toBe(false));
      release();
      expect(await connecting).toBe(true);
      expect(sheetValue(sim, `watch/${x.id}`)).toBeUndefined();
      T1.dispose();
      T2.dispose();
    }));

  it('still uploads and syncs when browser storage cannot be written', async () => {
    const D = mk();
    const mem = memoryStore();
    D.store = { ...mem, update: () => Promise.reject(new DOMException('blocked', 'UnknownError')) };
    const [, , , , , , , c8] = D.B.companies.filter((c) => c.ids.length === 1);
    D.addTeam('คุณดี');
    D.setOwner(c8.id, 'คุณดี');
    expect(await D.teamConnect(URL, KEY)).toBe(true);
    D.setStage(c8.id, 'interested');
    await D.teamSync();
    expect(D.team.status).toBe('ok');
    expect(D.teamPendingN).toBe(0);
    const rows = sim.post({ action: 'pull', key: KEY, since: 0 }).rows!;
    expect(rows.some((r) => r.k === `owner/${c8.id}` && r.v === 'คุณดี')).toBe(true);
    expect(rows.some((r) => r.k === `stage/${c8.id}` && r.v === 'interested')).toBe(true);
    D.dispose();
  });

  it('applying team rows never erases local-only records another tab saved', async () => {
    const shared = memoryStore();
    const T1 = mk(), T2 = mk();
    T1.store = T2.store = shared;
    expect(await T1.teamConnect(URL, KEY)).toBe(true);
    T2.teamCfg = { ...T1.teamCfg! };
    T1.crm.stages[900007] = 'none';
    T1.setStage(900007, 'won'); // TGO-added company: saved locally by T1 only
    await vi.waitFor(async () => expect(((await shared.get<{ stages: Record<string, string> }>('crm'))!.stages[900007])).toBe('won'));
    const [c1] = cos();
    sim.post({ action: 'push', key: KEY, ops: [{ k: `owner/${c1.id}`, v: 'คุณซี' }] });
    await T2.teamSync(); // T2 never saw T1's record; saving the pulled row must not drop it
    expect(T2.crm.owners[c1.id]).toBe('คุณซี');
    await vi.waitFor(async () => {
      const crm = (await shared.get<{ stages: Record<string, string>; owners: Record<string, string> }>('crm'))!;
      expect(crm.owners[c1.id]).toBe('คุณซี');
      expect(crm.stages[900007]).toBe('won');
    });
    T1.dispose();
    T2.dispose();
  });

  it('tabs follow a disconnect / new sheet made in another tab instead of undoing it', async () => {
    const ls = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) });
    try {
      const shared = memoryStore();
      const T1 = mk(), T2 = mk();
      T1.store = T2.store = shared;
      expect(await T1.teamConnect(URL, KEY)).toBe(true);
      T2.teamCfg = { ...T1.teamCfg! };
      await T2.teamSync();
      expect(T2.team.status).toBe('ok');
      T1.teamDisconnect();
      await T2.teamSync(); // T2's poll: adopts the disconnect, doesn't write its config back
      expect(T2.teamCfg).toBeNull();
      expect(T2.team.status).toBe('off');
      expect(JSON.parse(ls.get('gcc-team-sync')!)).toBeNull();
      // a new connection made in T1 is picked up by T2 (storage event)
      expect(await T1.teamConnect(URL, KEY)).toBe(true);
      (T2 as unknown as { teamPrefsChanged: (e: { key: string }) => void }).teamPrefsChanged({ key: 'gcc-team-sync' });
      expect(T2.teamCfg?.url).toBe(URL);
      // a key change in T2 while a stale ping is in flight in T1 doesn't resurrect anything
      T1.teamDisconnect();
      T2.teamDisconnect();
      T1.dispose();
      T2.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a new team code entered just before disconnecting does not reconnect later', async () => {
    const ls = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) });
    try {
      const D = mk();
      expect(await D.teamConnect(URL, KEY)).toBe(true);
      let release!: () => void;
      D.transport = async (_u, body) => {
        if (body.action === 'ping') await new Promise<void>((r) => (release = r));
        return sim.post({ ...body, key: KEY });
      };
      const p = D.teamSetKey('another-code-1');
      D.teamDisconnect();
      release();
      expect(await p).toBe(false);
      expect(D.teamCfg).toBeNull();
      expect(D.team.status).toBe('off');
      expect(JSON.parse(ls.get('gcc-team-sync')!)).toBeNull(); // the next page load stays disconnected
      D.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
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
