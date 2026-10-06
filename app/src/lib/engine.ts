/**
 * GccEngine — the app's data model. Holds the dataset, dedup decisions, CRM records and
 * monitor/sync state; recomputes statuses for the reference date; persists through
 * storage.ts. React subscribes via `subscribe` / `getVersion` (useSyncExternalStore).
 */
import type {
  Built, Cert, Company, ContactEdit, Crm, Dataset, FeedKey, LogEntry, MonitorCfg, RawCompany, Round, RoundRaw,
  SetSnap, StageKey, SyncCfg, Task, TaskType,
} from './types';
import { build, dataUrl, getDetail, loadBase, norm, parseXlsx, status, type ParsedUpload } from './core';
import { CONFIG, STG, TGT, tagsOf, CST } from './constants';
import { DAY, addDays, downloadBlob, dtTh, fmtN, gccCode, isoTh, nextWork, pad, todayISO, uid } from './format';
import { kv, prefs, PREF, type KVStore } from './storage';
import * as TGOSync from './tgoSync';
import {
  LOCAL_ID_MIN, TeamSyncError, applyRow, call, errText, fetchTransport, isLocalOnly, isTeamUrl, keyOf, legacyLogId, localRecords, noEffects, opId,
  type SharedState, type SyncOp, type SyncRow, type TeamCfg, type TeamState, type Transport,
} from './teamSync';

/** Each sheet (web-app URL) has its own queue, so switching sheets or a tab still on another sheet
 *  can never drop or mix up another sheet's unsent changes. */
const pendKey = (url: string) => 'teamPending:' + url;
/** Longest free text (notes) shared through the sheet; one cell holds 50,000 characters. */
const TEXT_MAX = 5000;
/** Whether queued change `a` is at least as recent as `b` (same record). */
const newer = (a: SyncOp, b: SyncOp) => (a.t || 0) >= (b.t || 0);
const cap = <T extends string | undefined>(s: T): T => (s && s.length > TEXT_MAX ? (s.slice(0, TEXT_MAX) as T) : s);

export interface RoundInfo { key: string; r?: Round; ideal?: string | null; lapse?: number }
export interface UploadState { status?: 'busy' | 'error' | 'done' | 'preview'; msg?: string; head?: string; preview?: { k: string; v: string }[] }
export interface SyncState { status?: 'running' | 'error' | 'done' | 'ready' | ''; msg?: string }
export interface PendingSync extends TGOSync.TgoResult { nw: (TGOSync.TgoItem & { gid: number | null })[]; at: string }

const emptyCrm = (): Crm => ({ stages: {}, notes: {}, tasks: [], watch: [], owners: {}, team: [], log: {} });

export class GccEngine {
  // ---- observable state
  private version = 0;
  private listeners = new Set<() => void>();
  loading = true;
  loadMsg = 'กำลังโหลดข้อมูลบริษัท…';
  ref = todayISO();
  win = CONFIG.soonWindow;
  up: UploadState = {};
  sy: SyncState = {};
  tmMsg = '';
  monMsg = '';

  // ---- data
  base!: Dataset;
  dec: Record<string, string> = {};
  contacts: Record<string, ContactEdit> = {};
  crm: Crm = emptyCrm();
  added: Partial<RawCompany>[] = [];
  tgoCerts: Partial<Cert>[] = [];
  setSnap: SetSnap | null = null;
  R: Round[] = [];
  sources: unknown[][] = [];

  // ---- derived
  B!: Built;
  certsBy = new Map<number, Cert[]>();
  byNorm = new Map<string, number>();
  certKeys = new Set<string>();
  T = 0;
  W = CONFIG.soonWindow;
  minYm = '';
  maxYm = '';

  private day = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private pendingUpload: ParsedUpload | null = null;
  pendingSync: PendingSync | null = null;

  // ---- team sync (shared CRM data via Google Apps Script; see lib/teamSync.ts)
  team: TeamState = { status: 'off', msg: '', last: '' };
  teamCfg: TeamCfg | null = null;
  /** Invite link target (#team=<url>) waiting for the user to enter the team code. */
  teamJoinUrl = '';
  transport: Transport = fetchTransport;
  /** Browser storage (IndexedDB); injectable so tests can give each simulated browser its own. */
  store: KVStore = kv;
  /** Local changes not yet acknowledged by the server, latest op per key. The copy in
   *  `store` (pendKey(url)) is the source of truth shared by all tabs of this browser. */
  private pending = new Map<string, SyncOp>();
  /** Queued ops this tab could not write to storage (quota, blocked IndexedDB); kept in memory. */
  private unsaved = new Map<string, SyncOp>();
  private opT = 0;
  /** The sheet rejected the team code; the "new code" form stays until a sync succeeds. */
  teamNeedKey = false;
  /** The team config as last written/read by this tab (raw localStorage text), to notice changes
   *  made by other tabs (connect, disconnect, new code). */
  private teamRaw = '';
  private pq: Promise<unknown> = Promise.resolve();
  private importing = false;
  private teamBusy = false;
  private teamAgain = false;
  /** The round in flight (resolves when it ends, successful or not). */
  private teamRunning: Promise<unknown> = Promise.resolve();
  /** Bumped on connect/disconnect so a stale in-flight sync can't touch the new session. */
  private teamGen = 0;
  private teamTimer: ReturnType<typeof setInterval> | null = null;
  private teamFlush: ReturnType<typeof setTimeout> | null = null;
  private teamWake = () => {
    if (this.teamCfg && !(typeof document !== 'undefined' && document.hidden)) this.teamSync();
  };
  private teamPrefsChanged = (e: StorageEvent) => {
    if (e.key !== PREF.team && e.key !== null) return;
    this.adoptTeamPrefs();
    if (this.teamCfg && this.team.status === 'error') this.teamSync(); // e.g. a new code entered in another tab
  };
  /** Storage events are not delivered to a page kept in the back/forward cache. */
  private teamPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) this.adoptTeamPrefs();
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  get ready() {
    return !!this.B && !this.loading;
  }
  /** Resolve a raw / merged id to the current company. */
  company(id: number): Company | undefined {
    return this.B?.byId.get(this.B.alias.get(id) ?? id);
  }
  canonical(id: number) {
    return this.B.alias.get(id) ?? id;
  }

  // ------------------------------------------------------------------ load
  private started = false;
  async load() {
    if (this.started) return;
    this.started = true;
    try {
      this.teamRaw = prefs.getRaw(PREF.team);
      const team0 = prefs.get<TeamCfg | null>(PREF.team, null);
      const [base, dec, contacts, crm, added, tgoCerts, setSnap, R, sources, pending] = await Promise.all([
        loadBase(),
        this.store.get<Record<string, string>>('dedup'),
        this.store.get<Record<string, ContactEdit>>('contacts'),
        this.store.get<Partial<Crm>>('crm'),
        this.store.get<Partial<RawCompany>[]>('addedCos'),
        this.store.get<Partial<Cert>[]>('tgoCerts'),
        this.store.get<SetSnap>('setSnap'),
        fetch(dataUrl('rounds.json')).then((r) => r.json()).catch(() => []) as Promise<RoundRaw[]>,
        fetch(dataUrl('gcc-sources.json')).then((r) => r.json()).catch(() => []) as Promise<unknown[][]>,
        team0 && team0.url ? this.store.get<SyncOp[]>(pendKey(team0.url)) : null,
      ]);
      this.base = base;
      this.dec = dec || {};
      this.contacts = contacts || {};
      this.crm = { ...emptyCrm(), ...(crm || {}) };
      this.added = added || [];
      this.tgoCerts = tgoCerts || [];
      this.setSnap = setSnap || null;
      this.sources = sources;
      // migrate free-form notes (older prototype) into the contact log
      const C = this.crm;
      let mv = 0;
      Object.entries(C.notes || {}).forEach(([id, a]) =>
        (a || []).forEach((n) => {
          (C.log[id] || (C.log[id] = [])).push({ at: n.at, type: 'note', text: n.text, by: '' });
          mv++;
        }),
      );
      // every log entry needs a stable id to be shared as its own record
      Object.values(C.log).forEach((a) =>
        (a || []).forEach((e) => {
          if (!e.id) {
            e.id = legacyLogId(e);
            mv++;
          }
        }),
      );
      if (mv) {
        C.notes = {};
        this.persist('crm', C);
      }
      // the cursor lives in localStorage while the data lives in IndexedDB; they can drift apart
      // (failed write, another tab), so every page load re-reads the (compacted) team log once
      this.teamCfg = team0 && team0.url ? { ...team0, seq: 0 } : null;
      if (this.teamCfg && Array.isArray(pending)) pending.forEach((op) => this.pending.set(op.k, op));
      this.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
      this.loadMsg = 'กำลังรวมข้อมูลและตรวจข้อมูลซ้ำ…';
      this.emit();
      await new Promise((r) => setTimeout(r, 30));
      this.rebuild();
      this.day = todayISO();
      this.loading = false;
      this.emit();
      this.timer = setInterval(() => this.tick(), 6e5);
      if (this.syncDue(this.syncCfg())) setTimeout(() => this.runSync(true), 1500);
      if (this.teamCfg) this.startTeam();
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', this.teamPrefsChanged);
        window.addEventListener('pageshow', this.teamPageShow);
      }
      this.adoptTeamPrefs(); // another tab may have connected / disconnected while this one loaded
    } catch (e) {
      this.loadMsg = 'โหลดข้อมูลไม่สำเร็จ: ' + ((e as Error)?.message || e);
      this.emit();
    }
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.stopTeam();
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.teamPrefsChanged);
      window.removeEventListener('pageshow', this.teamPageShow);
    }
  }
  private tick() {
    const d = todayISO();
    if (d !== this.day) {
      // a new day: keep "today" in sync if the user was looking at today
      if (this.ref === this.day) this.ref = d;
      this.day = d;
      this.recalc();
    } else this.checkMonitor();
    const c = this.syncCfg();
    if (c.freq !== 'open' && this.syncDue(c)) this.runSync(true);
    this.emit();
  }
  persist(k: string, v: unknown) {
    this.store.set(k, v).catch(() => {});
  }
  saveCrm() {
    this.persist('crm', this.crm);
    this.emit();
  }

  setRef(ref?: string | null, win?: number | null) {
    if (ref) this.ref = ref;
    if (win) this.win = win;
    if (this.B) this.recalc();
    this.emit();
  }

  // ------------------------------------------------------------------ build / recalc
  rebuild() {
    const B = build(this.base, this.dec, { added: this.added, contacts: this.contacts, certs: this.tgoCerts.map((c) => ({ ...c, tgo: true })) });
    this.B = B;
    // certificates pulled from the TGO website count towards their company's CFO state
    B.certs.forEach((ct) => {
      if (!ct.tgo) return;
      const c = B.byId.get(ct.gid);
      if (!c) return;
      c.src |= 1;
      c.cfoN = (c.cfoN || 0) + 1;
      if (ct.ex && ct.ex > (c.cfoEx || '')) c.cfoEx = ct.ex;
    });
    this.certsBy = new Map();
    B.certs.forEach((ct) => {
      const a = this.certsBy.get(ct.gid) || [];
      a.push(ct);
      this.certsBy.set(ct.gid, a);
    });
    this.byNorm = new Map();
    B.companies.forEach((c) => {
      const k = norm(c.name);
      if (k && !this.byNorm.has(k)) this.byNorm.set(k, c.id);
    });
    this.certKeys = new Set(B.certs.map((ct) => TGOSync.key(ct.cert, ct.org)));
    // SET snapshot → "newly listed" detection on the next dataset
    const syms = [...new Set(B.companies.map((c) => c.set).filter(Boolean))];
    const today = todayISO();
    if (!this.setSnap) {
      this.setSnap = { syms, at: today, newSyms: {} };
      this.persist('setSnap', this.setSnap);
    } else {
      const old = new Set(this.setSnap.syms);
      const nw = syms.filter((s) => !old.has(s));
      if (nw.length || syms.length !== this.setSnap.syms.length) {
        nw.forEach((s) => (this.setSnap!.newSyms[s] = today));
        this.setSnap.syms = syms;
        this.setSnap.at = today;
        this.persist('setSnap', this.setSnap);
      }
    }
    this.recalc();
  }

  /**
   * TGO round to file a renewal in: the last round announced on/before expiry (no lapse);
   * if its document deadline has passed, the next round still open (with lapse days).
   */
  roundOf(ex: string, T: number): RoundInfo | null {
    const R = this.R;
    if (!ex || !R.length) return null;
    const exT = Date.parse(ex);
    if (exT < T - 365 * DAY) return { key: 'old' };
    if (!R.some((x) => x.annT > exT)) return { key: 'later' };
    let ideal: Round | null = null;
    for (const x of R) if (x.annT <= exT) ideal = x;
    const rn = ideal && ideal.docT >= T ? ideal : R.find((x) => x.docT >= T);
    if (!rn) return { key: 'later' };
    return { key: rn.no, r: rn, ideal: ideal && ideal.no, lapse: Math.max(0, Math.round((rn.annT - exT) / DAY)) };
  }

  recalc() {
    const B = this.B;
    const CD = B.CD;
    const T = Date.parse(this.ref || todayISO());
    const W = +(this.win || CONFIG.soonWindow);
    this.T = T;
    this.W = W;
    let maxYm = '';
    B.companies.forEach((c) => {
      if (c.newYm > maxYm) maxYm = c.newYm;
    });
    let minYm = '';
    if (maxYm) {
      let [y, m] = maxYm.split('-').map(Number);
      m -= 5;
      while (m < 1) {
        m += 12;
        y--;
      }
      minYm = `${y}-${pad(m)}`;
    }
    this.maxYm = maxYm;
    this.minYm = minYm;
    const ns = this.setSnap?.newSyms || {};
    const nsCut = addDays(todayISO(), -180);
    const watch = new Set(this.crm.watch);
    B.companies.forEach((c) => {
      status(c, T, W);
      c.code = c.id >= 900000 ? 'TGO-' + (c.id - 900000) : gccCode(c.id);
      c.hay = [c.name, c.jur, c.set, c.phone, c.code, c.email, c.ids.map((i) => gccCode(i)).join(' ')].join(' ').toLowerCase();
      c.fl = {
        watch: watch.has(c.id),
        cfoSoon: c.cfoSt === 'soon',
        cfoExp: c.cfoSt === 'expired',
        giSoon: c.giDays != null && c.giDays >= 0 && c.giDays <= 90 && (c.giLive || 0) >= 2,
        giDown: (c.giMax || 0) >= 2 && (c.giLive || 0) < c.giMax!,
        newFac: !!(c.newYm && c.newYm >= minYm),
        setNew: !!(c.set && ns[c.set] && ns[c.set] >= nsCut),
        noContact: c.tgt <= 7 && !c.hasPh,
      };
      const r = c.cfoSt === 'soon' || c.cfoSt === 'active' || c.cfoSt === 'expired' ? this.roundOf(c.cfoEx, T) : null;
      c.rnd = r && r.r ? r.key : '';
      c.rndKey = r ? r.key : '';
      c.rndR = (r && r.r) || null;
      c.rndLapse = (r && r.lapse) || 0;
      c.rndIdeal = (r && r.ideal) || null;
    });
    B.certs.forEach((ct) => {
      ct.days = ct.ex ? Math.round((Date.parse(ct.ex) - T) / DAY) : null;
      ct.st = ct.days == null ? 'unknown' : ct.days < 0 ? 'expired' : ct.days <= W ? 'soon' : 'active';
      // certificates normally last a year; < 300 days between approval and expiry is a data error on TGO's site
      ct.bad = !!(ct.ap && ct.ex && (Date.parse(ct.ex) - Date.parse(ct.ap)) / DAY < 300);
      const c = B.byId.get(ct.gid);
      ct.co = c;
      ct.isLatest = !!(c && c.cfoEx === ct.ex);
      ct.hay = (ct.cert + ' ' + ct.org + ' ' + ct.act).toLowerCase();
      ct.provName = ct.provTxt || CD.prov[ct.prov] || '';
      ct.indName = CD.ind[ct.ind] || '';
      ct.apT = ct.ap ? Date.parse(ct.ap) : 0;
      ct.exM = ct.ex ? ct.ex.slice(0, 7) : '';
      // submission year (B.E.): from "FYxx" in the certificate no., else the fiscal year (Oct–Sep) of approval
      const fy = CD.fy[ct.fy] || (/FY(\d\d)/i.exec(ct.cert || '') || [])[0] || '';
      const m = /^FY(\d\d)$/i.exec(fy);
      if (m) {
        const v = +m[1];
        ct.yr = String(v >= 50 ? 2500 + v : 2543 + v);
      } else if (ct.ap) {
        const [y, mo] = ct.ap.split('-').map(Number);
        ct.yr = String(y + 543 + (mo >= 10 ? 1 : 0));
      } else ct.yr = '';
      ct.hasScope = ct.s1 != null && (ct.s1 || 0) + (ct.s2 || 0) + (ct.s3 || 0) > 0;
    });
    this.checkMonitor();
  }

  // ------------------------------------------------------------------ feeds
  feedItems(k: FeedKey, n?: number) {
    const l = this.B.companies.filter((c) => c.fl[k]);
    if (k === 'cfoSoon') l.sort((a, b) => a.days! - b.days!);
    else if (k === 'cfoExp') l.sort((a, b) => b.days! - a.days!);
    else if (k === 'giSoon') l.sort((a, b) => a.giDays! - b.giDays!);
    else if (k === 'newFac') l.sort((a, b) => b.newYm.localeCompare(a.newYm) || (b.invest || 0) - (a.invest || 0));
    else if (k === 'noContact') l.sort((a, b) => a.tgt - b.tgt);
    return n ? l.slice(0, n) : l;
  }

  // ------------------------------------------------------------------ monitor
  monCfg(): MonitorCfg {
    return { snap: null, events: [], last: null, seenAt: null, notify: false, ...prefs.get<Partial<MonitorCfg>>(PREF.monitor, {}) };
  }
  saveMon(p: Partial<MonitorCfg>) {
    const c = { ...this.monCfg(), ...p };
    prefs.set(PREF.monitor, c);
    return c;
  }
  /** Compare each company's CFO/GI state with the last snapshot and log transitions (only when viewing today). */
  checkMonitor(manual?: boolean) {
    if (!this.B || this.ref !== todayISO()) return;
    const c = this.monCfg();
    const now = new Date().toISOString();
    const snap: Record<string, string> = {};
    const ev: [string, number][] = [];
    this.B.companies.forEach((o) => {
      if (o.cfoSt === 'none' && !((o.giMax || 0) >= 2)) return;
      const k = o.cfoSt[0] + (o.giLive || 0);
      snap[o.id] = k;
      const p = c.snap && c.snap[o.id];
      if (!c.snap || !p || p === k) return;
      const ps = ({ a: 'active', s: 'soon', e: 'expired', u: 'unknown', n: 'none' } as Record<string, string>)[p[0]];
      const pg = +p.slice(1);
      if (o.cfoSt !== ps) {
        if (o.cfoSt === 'soon' && ps === 'active') ev.push(['cfoSoon', o.id]);
        else if (o.cfoSt === 'expired' && (ps === 'active' || ps === 'soon')) ev.push(['cfoExpired', o.id]);
        else if ((o.cfoSt === 'active' || o.cfoSt === 'soon') && (ps === 'expired' || ps === 'none' || ps === 'unknown')) ev.push(['cfoRenewed', o.id]);
      }
      const g = o.giLive || 0;
      if (g < pg) ev.push(['giDown', o.id]);
      else if (g > pg) ev.push(['giUp', o.id]);
    });
    const events = ev.map(([t, id]) => ({ t, id, at: now })).concat(c.events || []).slice(0, 400);
    this.saveMon({ snap, events, last: now, seenAt: c.snap ? c.seenAt : now });
    if (ev.length && c.notify && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('GCC: ตรวจสถานะอัตโนมัติ', { body: `พบเหตุการณ์ใหม่ ${ev.length} รายการ` });
      } catch {
        /* ignore */
      }
    }
    if (manual) {
      this.monMsg = ev.length ? `พบเหตุการณ์ใหม่ ${fmtN(ev.length)} รายการ` : 'ไม่มีการเปลี่ยนแปลงสถานะ';
      this.emit();
    }
  }
  ackEvents() {
    this.saveMon({ seenAt: new Date().toISOString() });
    this.emit();
  }
  setNotify(v: boolean) {
    if (v && 'Notification' in window && Notification.permission !== 'granted') Notification.requestPermission();
    this.saveMon({ notify: v });
    this.emit();
  }

  // ------------------------------------------------------------------ TGO sync
  syncCfg(): SyncCfg {
    return { freq: 'daily', proxy: '', autoApply: true, ...prefs.get<Partial<SyncCfg>>(PREF.sync, {}) };
  }
  saveSync(p: Partial<SyncCfg>) {
    const c = { ...this.syncCfg(), ...p };
    prefs.set(PREF.sync, c);
    this.emit();
    return c;
  }
  syncDue(c: SyncCfg) {
    if (c.freq === 'off') return false;
    if (!c.last || c.freq === 'open') return true;
    return Date.now() - Date.parse(c.last) >= (c.freq === 'weekly' ? 168 : 24) * 36e5;
  }
  async runSync(auto: boolean) {
    if (this.syncing || !this.B) return;
    const c = this.syncCfg();
    this.syncing = true;
    this.sy = { status: 'running', msg: 'กำลังเชื่อมต่อเว็บไซต์ TGO…' };
    this.emit();
    try {
      const res = await TGOSync.fetchAll({
        proxy: c.proxy,
        maxPages: 3,
        isKnown: (it) => this.certKeys.has(TGOSync.key(it.cert, it.org)),
        onProgress: (m) => {
          this.sy = { status: 'running', msg: m };
          this.emit();
        },
      });
      const nw = res.items
        .filter((it) => !this.certKeys.has(TGOSync.key(it.cert, it.org)))
        .map((it) => ({ ...it, gid: this.byNorm.get(norm(it.org)) || null }));
      this.pendingSync = { ...res, nw, at: new Date().toISOString() };
      if (!nw.length) {
        this.saveSync({ last: this.pendingSync.at, lastMsg: 'ไม่มีใบรับรองใหม่', total: res.total });
        this.pendingSync = null;
        this.sy = { status: auto ? '' : 'done', msg: `ข้อมูลตรงกับเว็บไซต์ TGO แล้ว (ตรวจ ${fmtN(res.items.length)} รายการล่าสุด)` };
      } else if (auto && c.autoApply) {
        this.applySync(true);
      } else {
        this.saveSync({ total: res.total });
        this.sy = { status: 'ready' };
      }
    } catch (e) {
      this.sy = { status: 'error', msg: (auto ? 'ซิงก์อัตโนมัติไม่สำเร็จ: ' : '') + ((e as Error)?.message || e) };
    } finally {
      this.syncing = false;
      this.emit();
    }
  }
  applySync(auto: boolean) {
    const st = this.pendingSync;
    if (!st) return;
    const D = this.B.D;
    let made = 0;
    st.nw.forEach((it) => {
      let gid = it.gid;
      if (!gid) {
        gid = 900001 + this.added.length;
        made++;
        const pi = D.prov.indexOf(it.prov);
        this.added.push({
          id: gid, name: it.org, jur: '', type: Math.max(0, D.type.indexOf('ไม่ระบุ')), prov: pi >= 0 ? pi : D.prov.indexOf(''), addr: '',
          ind: Math.max(0, D.ind.indexOf('ไม่ระบุ')), biz: it.act, src: 1, tgt: 0, cfo: Math.max(0, D.cfo.indexOf('อยู่ในอายุ')), cfoN: 0, cfoEx: '',
          giNow: null, giMax: null, giUntil: '', newYm: '', invest: null, fac: null, set: '', mkt: '', phone: '', email: '', web: '', ct: 0, match: 0,
        });
        this.byNorm.set(norm(it.org), gid);
      }
      this.tgoCerts.push({
        gid, cert: it.cert, org: it.org, branch: it.branch, act: it.act, ind: -1, size: -1, addr: '', prov: -1, provTxt: it.prov, zip: '',
        ap: it.ap, ex: it.ex, fy: -1, s1: null, s2: null, s3: null, phone: '', email: '', webId: it.id, note: 'ดึงจากเว็บไซต์ TGO อัตโนมัติ ' + isoTh(todayISO()),
      });
    });
    this.persist('addedCos', this.added);
    this.persist('tgoCerts', this.tgoCerts);
    this.rebuild();
    const msg = `${auto ? 'อัปเดตอัตโนมัติ' : 'อัปเดต'}จาก TGO แล้ว: ใบรับรองใหม่ ${fmtN(st.nw.length)} ใบ · ผูกกับบริษัทเดิม ${fmtN(st.nw.length - made)} · สร้างบริษัทใหม่ ${fmtN(made)}`;
    this.saveSync({ last: st.at, lastMsg: `ใหม่ ${fmtN(st.nw.length)} ใบ`, total: st.total });
    this.pendingSync = null;
    this.sy = { status: 'done', msg };
    this.emit();
  }
  cancelSync() {
    this.pendingSync = null;
    this.sy = {};
    this.emit();
  }

  // ------------------------------------------------------------------ upload
  async onFile(file: File) {
    this.up = { status: 'busy', msg: 'กำลังอ่านไฟล์…' };
    this.emit();
    try {
      const r = await parseXlsx(file, (m) => {
        this.up = { status: 'busy', msg: m };
        this.emit();
      });
      const oldIds = new Set(this.base.rows.map((a) => a[0]));
      const newIds = new Set(r.base.rows.map((a) => a[0]));
      const oldSet = new Set(this.base.rows.map((a) => a[19]).filter(Boolean));
      const setN = r.base.rows.filter((a) => a[19] && !oldSet.has(a[19])).length;
      this.pendingUpload = r;
      this.up = {
        status: 'preview',
        head: `${file.name} · ข้อมูล ณ ${isoTh(r.base.asOf)}`,
        preview: ([
          ['แถวบริษัท', r.base.rows.length],
          ['รหัสใหม่', r.base.rows.filter((a) => !oldIds.has(a[0])).length],
          ['รหัสที่หายไป', [...oldIds].filter((i) => !newIds.has(i)).length],
          ['ใบรับรอง CFO', r.base.certs.length],
          ['ชื่อย่อ SET ใหม่', setN],
        ] as [string, number][]).map(([k, v]) => ({ k, v: fmtN(v) })),
      };
    } catch (err) {
      this.up = { status: 'error', msg: (err as Error)?.message || String(err) };
    }
    this.emit();
  }
  async applyUpload() {
    const r = this.pendingUpload;
    if (!r) return;
    this.up = { status: 'busy', msg: 'กำลังบันทึกและคำนวณใหม่…' };
    this.emit();
    try {
      await this.store.set('details', r.details);
      await this.store.set('dataset', r.base);
    } catch {
      /* ignore */
    }
    this.base = r.base;
    this.pendingUpload = null;
    this.rebuild();
    this.up = { status: 'done', msg: `ใช้ข้อมูลชุดใหม่แล้ว ${fmtN(this.B.companies.length)} บริษัท (หลังตัดข้อมูลซ้ำ)` };
    this.emit();
  }
  cancelUpload() {
    this.pendingUpload = null;
    this.up = {};
    this.emit();
  }
  async revertUpload() {
    try {
      await this.store.del('dataset');
      await this.store.del('details');
    } catch {
      /* ignore */
    }
    this.base = await loadBase();
    this.rebuild();
    this.up = { status: 'done', msg: 'กลับไปใช้ไฟล์ข้อมูลต้นฉบับของเว็บแล้ว' };
    this.emit();
  }

  // ------------------------------------------------------------------ dedup
  /** Record a merge/split decision; returns the id the given company now resolves to. */
  decide(key: string, v: 'merge' | 'split' | null) {
    if (v == null) delete this.dec[key];
    else this.dec[key] = v;
    this.op(keyOf.dedup(key), v ?? undefined);
    this.persist('dedup', this.dec);
    this.rebuild();
    this.emit();
  }

  // ------------------------------------------------------------------ CRM
  me() {
    return prefs.getRaw(PREF.me);
  }
  setMe(v: string) {
    prefs.set(PREF.me, v);
    this.emit();
  }
  logAct(id: number, e: Omit<LogEntry, 'at' | 'by' | 'id'>) {
    const L = this.crm.log;
    const entry: LogEntry = { id: uid(), at: new Date().toISOString(), by: this.me(), ...e };
    entry.text = cap(entry.text);
    (L[id] || (L[id] = [])).push(entry);
    this.op(keyOf.log(id, entry.id!), { ...entry });
  }
  stage(id: number): StageKey {
    return this.crm.stages[id] || 'none';
  }
  setStage(id: number, v: StageKey) {
    const C = this.crm;
    if ((C.stages[id] || 'none') === v) return;
    C.stages[id] = v;
    this.op(keyOf.stage(id), v);
    this.logAct(id, { type: 'stage', text: 'เปลี่ยนสถานะการขายเป็น "' + (STG.find((x) => x[0] === v) || STG[0])[1] + '"' });
    this.saveCrm();
  }
  setOwner(id: number, v: string) {
    const C = this.crm;
    if ((C.owners[id] || '') === v) return;
    if (v) C.owners[id] = v;
    else delete C.owners[id];
    this.op(keyOf.owner(id), v || undefined);
    this.logAct(id, { type: 'owner', text: v ? 'กำหนดผู้รับผิดชอบ: ' + v : 'ยกเลิกผู้รับผิดชอบ' });
    this.saveCrm();
  }
  toggleWatch(id: number) {
    const w = this.crm.watch;
    const i = w.indexOf(id);
    if (i >= 0) w.splice(i, 1);
    else w.push(id);
    this.op(keyOf.watch(id), i < 0 ? 1 : undefined);
    const c = this.B.byId.get(id);
    if (c) c.fl.watch = i < 0;
    this.saveCrm();
  }
  addLog(id: number, type: string, result: string, text: string) {
    if (!text && !result) return;
    this.logAct(id, { type, result, text });
    if (type !== 'note' && this.stage(id) === 'none') this.setStage(id, result === 'ไม่สนใจ' ? 'lost' : 'contacted');
    else this.saveCrm();
  }
  delLog(id: number, l: LogEntry) {
    this.crm.log[id] = (this.crm.log[id] || []).filter((x) => x !== l);
    if (l.id) this.op(keyOf.log(id, l.id));
    this.saveCrm();
  }
  addTeam(name: string) {
    const C = this.crm;
    if (name && !C.team.includes(name)) {
      C.team.push(name);
      this.op(keyOf.team(name), 1);
      if (!this.me()) prefs.set(PREF.me, name);
    }
    this.saveCrm();
  }
  delTeam(name: string) {
    this.crm.team = this.crm.team.filter((x) => x !== name);
    this.op(keyOf.team(name));
    this.saveCrm();
  }
  saveContact(c: Company, v: { phone: string; email: string; web: string; note: string }) {
    const e = { ...v, note: cap(v.note), at: new Date().toISOString() };
    this.contacts[c.id] = e;
    this.op(keyOf.contact(c.id), { ...e });
    this.persist('contacts', this.contacts);
    this.patchContact(c, e);
    this.emit();
  }
  /** Apply a contact edit to an already-built company (avoids a full rebuild). */
  private patchContact(c: Company, e: ContactEdit) {
    Object.assign(c, { phone: e.phone, email: e.email, web: e.web, cEdited: e, hasPh: !!e.phone });
    c.fl.noContact = c.tgt <= 7 && !c.hasPh;
    c.hay = [c.name, c.jur, c.set, c.phone, c.code, c.email, c.ids.map((i) => gccCode(i)).join(' ')].join(' ').toLowerCase();
  }

  // ---- tasks
  tasksOf(id: number) {
    return this.crm.tasks.filter((t) => this.canonical(t.gid) === id);
  }
  updateTask(taskId: string, p: Pick<Task, 'type' | 'date' | 'time' | 'note'>) {
    const t = this.crm.tasks.find((x) => x.id === taskId);
    if (t) {
      Object.assign(t, p, { note: cap(p.note) });
      this.op(keyOf.task(t.id), { ...t });
    }
    this.saveCrm();
  }
  /** Create one task per company; with `perDay` > 0 spread them across working days. */
  addTasks(ids: number[], p: { type: TaskType; date: string; time: string; note: string }, perDay = 0) {
    let d = p.date, n = 0;
    ids.forEach((id) => {
      const c = this.company(id);
      if (perDay && n >= perDay) {
        d = nextWork(addDays(d, 1));
        n = 0;
      }
      if (perDay && n === 0) d = nextWork(d);
      n++;
      const t: Task = { id: uid(), gid: id, title: c ? c.name : String(id), type: p.type, date: d, time: p.time, note: cap(p.note), done: false };
      this.crm.tasks.push(t);
      this.op(keyOf.task(t.id), { ...t });
    });
    this.saveCrm();
  }
  autoPlan(list: Company[], perDay: number) {
    let d = nextWork(addDays(todayISO(), 1)), n = 0;
    list.forEach((c) => {
      if (n >= perDay) {
        d = nextWork(addDays(d, 1));
        n = 0;
      }
      n++;
      const t: Task = { id: uid(), gid: c.id, title: c.name, type: 'call', date: d, time: '', note: 'นัดอัตโนมัติ', done: false };
      this.crm.tasks.push(t);
      this.op(keyOf.task(t.id), { ...t });
    });
    this.saveCrm();
  }
  toggleTask(t: Task) {
    t.done = !t.done;
    this.op(keyOf.task(t.id), { ...t });
    if (t.done) this.logAct(this.canonical(t.gid), { type: t.type, text: 'ทำนัดเสร็จ' + (t.note ? ': ' + t.note : '') });
    this.saveCrm();
  }
  delTask(t: Task) {
    this.crm.tasks = this.crm.tasks.filter((x) => x !== t);
    if (t.gid < LOCAL_ID_MIN) this.op(keyOf.task(t.id));
    this.saveCrm();
  }

  // ---- team backup
  exportCrm() {
    const data = { kind: 'gcc-crm-backup', v: 1, at: new Date().toISOString(), by: this.me(), crm: this.crm, contacts: this.contacts, dedup: this.dec };
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'GCC_ข้อมูลทีม_' + todayISO() + '.json');
  }
  /** Merge a teammate's backup into local data — never deletes; newer contact edits win. */
  async importCrm(f: File) {
    // While connected, a backup only fills gaps: instead of pushing every value in the file (which
    // could revert newer team values or resurrect deleted items), re-run the first-connect merge.
    this.importing = !!this.teamCfg;
    try {
      const d = JSON.parse(await f.text());
      if (d.kind !== 'gcc-crm-backup') throw new Error('ไม่ใช่ไฟล์สำรองของระบบนี้');
      const C = this.crm, I: Partial<Crm> = d.crm || {};
      let n = 0;
      Object.entries(I.stages || {}).forEach(([k, v]) => {
        if (v && v !== 'none') {
          C.stages[k] = v;
          this.op(keyOf.stage(k), v);
          n++;
        }
      });
      Object.entries(I.owners || {}).forEach(([k, v]) => {
        if (v) {
          C.owners[k] = v;
          this.op(keyOf.owner(k), v);
          n++;
        }
      });
      (I.team || []).forEach((t) => {
        if (!C.team.includes(t)) {
          C.team.push(t);
          this.op(keyOf.team(t), 1);
        }
      });
      (I.watch || []).forEach((w) => {
        if (!C.watch.includes(w)) {
          C.watch.push(w);
          this.op(keyOf.watch(w), 1);
        }
      });
      const ids = new Set(C.tasks.map((t) => t.id));
      (I.tasks || []).forEach((t) => {
        if (!ids.has(t.id)) {
          C.tasks.push(t);
          this.op(keyOf.task(t.id), { ...t });
          n++;
        }
      });
      Object.entries(I.log || {}).forEach(([k, a]) => {
        const L = C.log[k] || (C.log[k] = []);
        const ks = new Set(L.map((x) => x.at + '|' + x.text));
        (a || []).forEach((x) => {
          if (!ks.has(x.at + '|' + x.text)) {
            const e = { ...x, id: x.id || legacyLogId(x) };
            L.push(e);
            this.op(keyOf.log(k, e.id), { ...e });
            n++;
          }
        });
      });
      Object.entries((d.contacts || {}) as Record<string, ContactEdit>).forEach(([k, v]) => {
        const o = this.contacts[k];
        if (!o || (v.at || '') > (o.at || '')) {
          this.contacts[k] = v;
          this.op(keyOf.contact(k), { ...v });
        }
      });
      Object.entries((d.dedup || {}) as Record<string, string>).forEach(([k, v]) => {
        if (!(k in this.dec)) {
          this.dec[k] = v;
          this.op(keyOf.dedup(k), v);
        }
      });
      this.persist('crm', C);
      this.persist('contacts', this.contacts);
      this.persist('dedup', this.dec);
      this.rebuild();
      this.tmMsg = 'นำเข้าแล้ว ' + fmtN(n) + ' รายการ จากไฟล์ของ ' + (d.by || 'ไม่ระบุชื่อ') + ' (' + dtTh(d.at) + ')';
      if (this.teamCfg) {
        this.tmMsg += ' · รายการที่ทีมยังไม่มีจะส่งขึ้นชีต ส่วนรายการที่ทีมมีแล้วใช้ค่าของทีม';
        this.teamCfg.seq = 0;
        this.teamCfg.seeded = false;
        this.saveTeamCfg(this.teamCfg);
        this.importing = false;
        this.teamSync();
      }
    } catch (err) {
      this.tmMsg = 'นำเข้าไม่สำเร็จ: ' + ((err as Error)?.message || err);
    } finally {
      this.importing = false;
    }
    this.emit();
  }

  // ------------------------------------------------------------------ team sync
  /** Queue a shared-record change (v === undefined → delete). No-op until connected — connecting
   *  uploads everything local that the team sheet doesn't have yet. */
  private op(k: string, v?: unknown) {
    const cfg = this.teamCfg;
    if (!cfg || this.importing || isLocalOnly(k, v)) return;
    const o = this.mkOp(k, v);
    this.pending.set(k, o);
    this.unsaved.delete(k);
    this.writePending(cfg.url, (ops) => ops.filter((x) => x.k !== k).concat(o)).catch(() => {
      if (this.teamCfg === cfg) this.keepUnsaved(o);
    });
    if (this.teamFlush) clearTimeout(this.teamFlush);
    this.teamFlush = setTimeout(() => {
      this.teamFlush = null;
      this.teamSync();
    }, 700);
  }
  /** A queued change (v === undefined → delete); `t` orders this browser's changes to one record. */
  private mkOp(k: string, v?: unknown): SyncOp {
    const t = (this.opT = Math.max(Date.now(), this.opT + 1));
    return v === undefined ? { id: opId(), t, k, del: true, by: this.me() } : { id: opId(), t, k, v, by: this.me() };
  }
  /** Keep an op whose storage write failed in memory, unless a newer one for its record is kept. */
  private keepUnsaved(o: SyncOp) {
    const u = this.unsaved.get(o.k);
    if (!u || newer(o, u)) this.unsaved.set(o.k, o);
  }
  /** Add this tab's unstored ops to a queue, except where the queue already has a newer change. */
  private withUnsaved(m: Map<string, SyncOp>) {
    this.unsaved.forEach((o, k) => {
      const c = m.get(k);
      if (c && c !== o && !newer(o, c)) this.unsaved.delete(k);
      else m.set(k, o);
    });
    return m;
  }
  /** This browser's shared records as stored (every tab saves there); this tab's copy if unreadable. */
  private async storedShared(): Promise<SharedState> {
    const [crm, contacts, dec] = await Promise.all([
      this.store.get<Partial<Crm>>('crm'),
      this.store.get<Record<string, ContactEdit>>('contacts'),
      this.store.get<Record<string, string>>('dedup'),
    ]);
    return { crm: crm ? { ...emptyCrm(), ...crm } : this.crm, contacts: contacts || this.contacts, dec: dec || this.dec };
  }
  /** Read-modify-write of a sheet's stored queue (one transaction, so tabs don't overwrite each other). */
  private writePending(url: string, fn: (ops: SyncOp[]) => SyncOp[]): Promise<SyncOp[]> {
    const p = this.pq.then(() => this.store.update<SyncOp[]>(pendKey(url), (cur) => fn(Array.isArray(cur) ? cur : [])));
    this.pq = p.catch(() => {});
    return p;
  }
  get teamPendingN() {
    return this.pending.size;
  }
  private setTeam(p: Partial<TeamState>) {
    this.team = { ...this.team, ...p };
    this.emit();
  }
  private saveTeamCfg(cfg: TeamCfg | null) {
    prefs.set(PREF.team, cfg);
    this.teamRaw = prefs.getRaw(PREF.team);
    if (cfg) prefs.set(PREF.teamLast, cfg.url);
  }
  /**
   * Every tab shares the team config (localStorage). If another tab connected, disconnected,
   * switched sheet or entered a new team code, follow it instead of writing this tab's stale
   * config back. Returns false when this tab's current session has ended.
   */
  private adoptTeamPrefs() {
    const raw = prefs.getRaw(PREF.team);
    if (raw === this.teamRaw) return true; // unchanged (or localStorage unavailable)
    this.teamRaw = raw;
    const s = prefs.get<TeamCfg | null>(PREF.team, null);
    const cfg = this.teamCfg;
    if (s && s.url && cfg && s.url === cfg.url) {
      // other tabs also save their own cursor and seeding state here; only the code matters
      // (a seeding round reads what this browser has stored, so a following tab may seed too)
      cfg.key = s.key;
      return true;
    }
    if (!cfg && !(s && s.url)) return true;
    this.endTeam();
    if (s && s.url) {
      this.teamCfg = { ...s, seq: 0 };
      this.setTeam({ status: 'syncing', msg: '', last: '' });
      this.startTeam();
    } else this.setTeam({ status: 'off', msg: '', last: '' });
    return false;
  }

  /**
   * One sync round: pull rows newer than the cursor and apply them (skipping keys with local
   * changes still queued), then push the queue. Until `cfg.seeded`, local records the sheet
   * doesn't know yet are queued for upload first; records the sheet already has take its value.
   * Rounds are serialized across tabs with the Web Locks API when available.
   */
  async teamSync(opts: { first?: boolean } = {}) {
    if (this.teamCfg && !this.adoptTeamPrefs()) return;
    const cfg = this.teamCfg;
    if (!cfg || !this.B) return;
    if (this.teamBusy) {
      this.teamAgain = true;
      return;
    }
    const gen = this.teamGen;
    this.teamBusy = true;
    this.setTeam({ status: this.team.status === 'connecting' ? 'connecting' : 'syncing' });
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    const round = () => this.syncRound(cfg, gen, !!opts.first);
    const run = locks ? locks.request('gcc-team-sync', round) : round();
    this.teamRunning = run.catch(() => {});
    try {
      await run;
      if (gen === this.teamGen) {
        this.teamNeedKey = false;
        this.setTeam({ status: 'ok', msg: '', last: new Date().toISOString() });
      }
    } catch (e) {
      if (gen === this.teamGen) {
        if (e instanceof TeamSyncError && e.code === 'unauthorized') this.teamNeedKey = true;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        this.setTeam({ status: offline ? 'offline' : 'error', msg: errText(e) });
      }
    } finally {
      if (gen === this.teamGen) {
        this.teamBusy = false;
        if (this.teamAgain) {
          this.teamAgain = false;
          setTimeout(() => this.teamSync(), 50);
        }
      }
    }
  }

  /** Wait for a round in flight, then run a full one (e.g. to send what is queued before leaving). */
  async teamSyncNow() {
    for (let i = 0; i < 3 && this.teamBusy; i++) await this.teamRunning;
    await this.teamSync();
  }

  private async syncRound(cfg: TeamCfg, gen: number, first: boolean) {
    const live = () => this.teamCfg === cfg && gen === this.teamGen;
    // the stored queue is shared by every tab: start from it (another tab may have pushed or added
    // ops), plus this tab's ops that could not be stored
    await this.pq;
    const stored = await this.store.get<SyncOp[]>(pendKey(cfg.url));
    if (!live()) return;
    this.pending = this.withUnsaved(Array.isArray(stored) ? new Map(stored.map((o) => [o.k, o])) : this.pending);
    const seeding = first || !cfg.seeded;
    const rows: SyncRow[] = [];
    let since = seeding ? 0 : cfg.seq;
    for (;;) {
      const r = await call<{ rows: SyncRow[]; more: boolean }>(this.transport, cfg.url, cfg.key, { action: 'pull', since });
      rows.push(...r.rows);
      if (r.rows.length) since = r.rows[r.rows.length - 1].seq;
      if (!r.more || !r.rows.length) break;
    }
    if (!live()) return;
    let seeded = false;
    if (seeding) {
      // seed from what this browser has stored (shared by all tabs), not from this tab's copy,
      // which may be older than another tab's edits (e.g. a deletion made there before connecting)
      const mine = await this.storedShared();
      if (!live()) return;
      const remote = new Set(rows.map((r) => r.k));
      const add: SyncOp[] = [];
      localRecords(mine).forEach((v, k) => {
        if (!remote.has(k) && !this.pending.has(k)) add.push(this.mkOp(k, v));
      });
      add.forEach((o) => this.pending.set(o.k, o));
      // once the upload is queued durably it survives a reload; if storage fails it is kept in
      // memory (pushed below), and the session counts as seeded only after a complete round
      const keys = new Set(add.map((o) => o.k));
      seeded =
        !add.length ||
        (await this.writePending(cfg.url, (ops) => ops.filter((x) => !keys.has(x.k)).concat(add)).then(
          () => true,
          () => {
            add.forEach((o) => this.keepUnsaved(o));
            return false;
          },
        ));
      if (!live()) return;
    }
    this.applyRows(rows.filter((r) => !this.pending.has(r.k)));
    cfg.seq = since;
    // only a round that seeded may mark the session seeded (an import may have reset it meanwhile)
    if (seeding && seeded) cfg.seeded = true;
    if (!this.adoptTeamPrefs() || !live()) return;
    this.saveTeamCfg(cfg);
    let rejected = 0;
    while (this.pending.size && live()) {
      const batch = [...this.pending.values()].slice(0, 300);
      const r = await call<{ rejected?: string[] }>(this.transport, cfg.url, cfg.key, { action: 'push', ops: batch.map(({ k, v, del, by }) => ({ k, v, del, by })) });
      rejected += (r.rejected || []).length;
      // done: the op that was sent, or an older change to a record whose newer value was sent;
      // a change made while the request was in flight stays queued
      const sent = new Map(batch.map((o) => [o.k, o]));
      const done = (o: SyncOp) => {
        const x = sent.get(o.k);
        return !!x && (x.id === o.id || !newer(o, x));
      };
      this.unsaved.forEach((o, k) => done(o) && this.unsaved.delete(k));
      // acknowledged in this sheet's own queue even if the session changed meanwhile (they were delivered)
      const left = await this.writePending(cfg.url, (ops) => ops.filter((o) => !done(o))).catch(() => null);
      if (!live()) return;
      this.pending = this.withUnsaved(new Map((left || [...this.pending.values()].filter((o) => !done(o))).map((o) => [o.k, o])));
    }
    if (seeding && !cfg.seeded && live()) {
      cfg.seeded = true; // everything local was pushed from memory
      this.saveTeamCfg(cfg);
    }
    if (rejected) throw new Error(`มี ${fmtN(rejected)} รายการยาวเกินกว่าที่ชีตเก็บได้ จึงไม่ได้แชร์ (เก็บไว้ในเครื่องนี้)`);
  }

  /** Apply pulled rows (oldest first) and refresh whatever they affect. */
  private applyRows(rows: SyncRow[]) {
    if (!rows.length) return;
    const fx = noEffects();
    rows.forEach((r) => applyRow(this, r, fx));
    // Save by applying the same rows to what is stored rather than writing this tab's whole copy:
    // another tab may have stored records this tab has never seen (e.g. local-only TGO companies).
    const merged = (s: SharedState) => {
      rows.forEach((r) => applyRow(s, r, noEffects()));
      return s;
    };
    const none = { crm: emptyCrm(), contacts: {}, dec: {} };
    if (fx.crm) this.store.update<Partial<Crm>>('crm', (cur) => (cur ? merged({ ...none, crm: { ...emptyCrm(), ...cur } }).crm : this.crm)).catch(() => {});
    if (fx.contacts.size || fx.contactDel)
      this.store.update<Record<string, ContactEdit>>('contacts', (cur) => (cur ? merged({ ...none, contacts: cur }).contacts : this.contacts)).catch(() => {});
    if (fx.dedup) this.store.update<Record<string, string>>('dedup', (cur) => (cur ? merged({ ...none, dec: cur }).dec : this.dec)).catch(() => {});
    if (fx.dedup || fx.contactDel) {
      this.rebuild(); // regroups companies / restores original contact data
    } else {
      // records are keyed by the company id they were made on; on this device that id may be an
      // alias of a merged company, which shows only its own id's records
      fx.contacts.forEach((id) => {
        const c = this.B.byId.get(id), e = this.contacts[id];
        if (c && e) this.patchContact(c, e);
      });
      if (fx.watch.size) {
        const w = new Set(this.crm.watch);
        this.B.companies.forEach((c) => (c.fl.watch = w.has(c.id)));
      }
    }
    this.emit();
  }

  /** Check the web-app URL + team code, then do a first full sync. Returns true on success. */
  async teamConnect(url: string, key: string) {
    url = url.trim();
    key = key.trim();
    if (!isTeamUrl(url)) {
      this.setTeam({ status: 'error', msg: 'ลิงก์ต้องเป็น Web app ของ Google Apps Script (https://script.google.com/macros/s/…/exec)' });
      return false;
    }
    if (!key) {
      this.setTeam({ status: 'error', msg: 'กรุณาใส่รหัสทีม' });
      return false;
    }
    this.setTeam({ status: 'connecting', msg: '' });
    try {
      await call(this.transport, url, key, { action: 'ping' });
    } catch (e) {
      this.setTeam({ status: 'error', msg: errText(e, 'connect') });
      return false;
    }
    this.endTeam();
    // Changes still queued for this sheet (e.g. from before a disconnect), and those left unsent for
    // the link this browser used before (a re-deployed sheet gets a new link), are re-queued with
    // their current local value, so the first pull can't overwrite them with older team values.
    const last = prefs.getRaw(PREF.teamLast); // stored as plain text
    const moved = last && last !== url ? (await this.store.get<SyncOp[]>(pendKey(last))) || [] : [];
    const local = localRecords(await this.storedShared());
    const requeue = (cur: SyncOp[]) => [...new Map([...moved, ...cur].map((o) => [o.k, o])).keys()].map((k) => this.mkOp(k, local.get(k)));
    let ops: SyncOp[];
    try {
      ops = await this.writePending(url, requeue);
      if (moved.length) await this.writePending(last, () => []).catch(() => {});
    } catch {
      ops = requeue((await this.store.get<SyncOp[]>(pendKey(url))) || []);
      ops.forEach((o) => this.keepUnsaved(o));
    }
    this.pending = new Map(ops.map((o) => [o.k, o]));
    this.teamCfg = { url, key, seq: 0, seeded: false };
    this.teamJoinUrl = '';
    this.saveTeamCfg(this.teamCfg);
    await this.teamSync({ first: true });
    if (this.teamCfg) this.startTeam(false);
    return this.team.status === 'ok';
  }
  /** Replace the team code in place (after the lead changed TEAM_KEY), keeping everything queued. */
  async teamSetKey(key: string) {
    const cfg = this.teamCfg;
    key = key.trim();
    if (!cfg || !key) return false;
    try {
      await call(this.transport, cfg.url, key, { action: 'ping' });
    } catch (e) {
      if (this.teamCfg === cfg) this.setTeam({ status: 'error', msg: errText(e, 'connect') }); // the form stays (teamNeedKey)
      return false;
    }
    if (this.teamCfg !== cfg) return false; // disconnected (or switched sheet) meanwhile
    cfg.key = key;
    this.saveTeamCfg(cfg);
    await this.teamSync();
    return this.team.status === 'ok';
  }
  /** Stop sharing. Queued changes stay stored and are sent with the next connect (this sheet or a new link). */
  teamDisconnect() {
    this.endTeam();
    this.saveTeamCfg(null);
    this.setTeam({ status: 'off', msg: '', last: '' });
  }
  /** End this tab's session; a sync still in flight sees the new generation and stops. */
  private endTeam() {
    this.stopTeam();
    this.teamGen++;
    this.teamBusy = this.teamAgain = false;
    this.teamCfg = null;
    this.pending = new Map();
    this.unsaved = new Map();
    this.teamNeedKey = false;
  }
  /** Poll every 30 s while the page is visible, and right away on focus / reconnect. */
  private startTeam(now = true) {
    this.stopTeam();
    this.teamTimer = setInterval(this.teamWake, 30000);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.teamWake);
      window.addEventListener('online', this.teamWake);
    }
    if (now) this.teamSync();
  }
  private stopTeam() {
    if (this.teamTimer) clearInterval(this.teamTimer);
    this.teamTimer = null;
    if (this.teamFlush) clearTimeout(this.teamFlush);
    this.teamFlush = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.teamWake);
      window.removeEventListener('online', this.teamWake);
    }
  }

  // ---- details
  getDetail(c: Company) {
    return getDetail(c.ids);
  }

  // ---- CSV
  exportCsv(view: 'co' | 'cert', out: (Company | Cert)[]) {
    const D = this.B.D, CD = this.B.CD;
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    let H: string[], L: unknown[][];
    if (view === 'cert') {
      H = ['เลขที่ใบรับรอง', 'องค์กร', 'กิจกรรม', 'จังหวัด', 'วันที่อนุมัติ', 'วันหมดอายุ', 'สถานะ', 'รอบที่ต้องยื่น', 'รหัสบริษัท', 'โทรศัพท์บริษัท'];
      L = (out as Cert[]).map((ct) => [ct.cert, ct.org, ct.act, ct.provTxt || CD.prov[ct.prov], ct.ap, ct.ex, CST[ct.st][0], ct.isLatest ? ct.co!.rnd : '', ct.co!.code, ct.co!.phone]);
    } else {
      H = ['รหัส', 'ชื่อบริษัท', 'เลขนิติบุคคล', 'ประเภท', 'จังหวัด', 'ที่อยู่', 'กลุ่มอุตสาหกรรม', 'กิจการ', 'แหล่งข้อมูล', 'กลุ่มเป้าหมาย', 'สถานะ CFO', 'CFO หมดอายุล่าสุด', 'รอบที่ต้องยื่น', 'GI ระดับที่ยังใช้ได้', 'GI ใช้ได้ถึง', 'โรงงานใหม่ เริ่ม', 'เงินลงทุนโรงงานใหม่', 'SET', 'โทรศัพท์', 'อีเมล', 'เว็บไซต์', 'สถานะการขาย', 'รวมจากรหัส'];
      L = (out as Company[]).map((c) => [
        c.code, c.name, c.jur, D.type[c.type], D.prov[c.prov], c.addr, D.ind[c.ind], c.biz, tagsOf(c.src).map((t) => t.t).join(' '),
        c.tgt + 1 + '. ' + TGT[c.tgt], CST[c.cfoSt][0], c.cfoEx, c.rnd, c.giLive, c.giUntil, c.newYm, c.invest, c.set, c.phone, c.email, c.web,
        (STG.find((x) => x[0] === this.stage(c.id)) || STG[0])[1], c.ids.length > 1 ? c.ids.map(gccCode).join(' ') : '',
      ]);
    }
    const body = '﻿' + [H.join(',')].concat(L.map((r) => r.map(esc).join(','))).join('\n');
    downloadBlob(new Blob([body], { type: 'text/csv;charset=utf-8' }), `GCC_${view === 'cert' ? 'ใบรับรอง' : 'บริษัท'}_${out.length}.csv`);
  }
}
