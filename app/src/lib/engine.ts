/**
 * GccEngine — the app's data model. Holds the dataset, dedup decisions, CRM records and
 * monitor/sync state; recomputes statuses for the reference date; persists through
 * storage.ts. React subscribes via `subscribe` / `getVersion` (useSyncExternalStore).
 */
import type {
  Built, Cert, Company, ContactEdit, Crm, CustomCo, Dataset, FeedKey, LogEntry, MonitorCfg, RawCompany, Round, RoundRaw,
  SetSnap, StageKey, SyncCfg, Task, TaskType,
} from './types';
import { build, dataUrl, getDetail, loadBase, norm, parseXlsx, readXlsxRows, status, type ParsedUpload } from './core';
import { CONFIG, STG, TGT, tagsOf, CST } from './constants';
import { DAY, addDays, downloadBlob, dtTh, fmtN, gccCode, isoTh, nextWork, pad, todayISO, uid } from './format';
import { kv, prefs, PREF, type KVStore } from './storage';
import * as TGOSync from './tgoSync';
import {
  CUSTOM_ID_MIN, TeamSyncError, applyRow, isLocalId, call, errText, fetchTransport, isLocalOnly, isTeamUrl, keyOf, legacyLogId, localRecords, mergeFields, mergeListEdits, applyListEdit, noEffects, opId, rebaseOp, uniqueTaskIds, type ListEdit,
  type SharedState, type SyncOp, type SyncRow, type TeamCfg, type TeamState, type Transport,
} from './teamSync';
import {
  KIND_TH, NOTE_MAX, beYear, csvCell, csvPhone, dealMoney, decodeTrackerText, docsOf, lastContact, toCust, toDeal, toDoc, toLog, toStep, dealStatus, emptyCfg, emptySales, fmtMoney, importId, importKey, matchSource, newDeal, parseCsv,
  parseTrackerJson, parseTrackerSheet, stepOf,
  type Deal, type DealDoc, type DealLog, type DealStep, type DocKind, type DocTarget, type SalesCfg, type SalesState, type TrackerData,
} from './sales';
import { DOC_MAX_BYTES, deleteDocFile, docMime, downloadDocFile, fileErrText, fileFetchTransport, scriptSupportsFiles, uploadDocFile } from './teamFiles';

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
  /** Sales Tracker: deals, stage notes, attached documents, change log and lists (lib/sales.ts). */
  sales: SalesState = emptySales();
  /** Customers added by hand (ids ≥ CUSTOM_ID_MIN), shared with the team. */
  custom: Record<string, CustomCo> = {};

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
  /** Pushed ops whose acknowledgement could not be written to storage (so the stored queue still
   *  lists them); never pushed again. Latest per record. */
  private delivered = new Map<string, SyncOp>();
  /** Unsent in-memory ops of an ended session, re-queued by the next connect. */
  private carry = new Map<string, SyncOp>();
  /** Bumped by an import that needs a re-seed; a seeding round that started earlier can't mark it done. */
  private seedGen = 0;
  /** Shared stores ('crm', 'contacts', 'dedup') whose last save from this tab failed. */
  private unstored = new Set<string>();
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
      const [base, dec, contacts, crm, added, tgoCerts, setSnap, R, sources, pending, sales, custom] = await Promise.all([
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
        this.store.get<Partial<SalesState>>('sales'),
        this.store.get<Record<string, CustomCo>>('customCos'),
      ]);
      this.sales = { ...emptySales(), ...(sales || {}), cfg: { ...emptyCfg(), ...((sales && sales.cfg) || {}) } };
      this.custom = custom || {};
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
      // task ids made by an older version could repeat (bulk plans in the same millisecond)
      const renamed = uniqueTaskIds(C.tasks);
      mv += renamed;
      if (mv) {
        C.notes = {};
        this.persist('crm', C);
      }
      // the cursor lives in localStorage while the data lives in IndexedDB; they can drift apart
      // (failed write, another tab), so every page load re-reads the (compacted) team log once
      this.teamCfg = team0 && team0.url ? { ...team0, seq: 0 } : null;
      if (this.teamCfg && renamed) this.teamCfg.seeded = false; // upload the renamed tasks
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
    this.store.set(k, v).then(
      () => this.unstored.delete(k),
      () => this.unstored.add(k),
    );
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
    const B = build(this.base, this.dec, { added: [...this.added, ...this.customRaw()], contacts: this.contacts, certs: this.tgoCerts.map((c) => ({ ...c, tgo: true })) });
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
      c.code = gccCode(c.id);
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
    if (!isLocalId(t.gid)) this.op(keyOf.task(t.id));
    this.saveCrm();
  }

  // ---- team backup
  exportCrm() {
    const data = { kind: 'gcc-crm-backup', v: 1, at: new Date().toISOString(), by: this.me(), crm: this.crm, contacts: this.contacts, dedup: this.dec, sales: this.sales, custom: this.custom };
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
      // Sales Tracker + customers added by hand: add what this browser doesn't have
      const IS = (d.sales || {}) as Partial<SalesState>, S = this.sales;
      // lists: keep ours, add the backup's extra sections / SOURCE / Services / stages (notes in a
      // stage that is not in the list would be hidden)
      if (IS.cfg)
        (['sections', 'sources', 'services', 'stages'] as const).forEach((k) => {
          const extra = (Array.isArray(IS.cfg![k]) ? IS.cfg![k] : []).map(String).filter((x) => x && !S.cfg[k].includes(x));
          if (extra.length) this.setSalesList(k, [...S.cfg[k], ...extra]);
        });
      // every record checked (toDeal…): a hand-edited backup must not break the screen for the team
      Object.entries(IS.deals || {}).forEach(([id, x]) => {
        const deal = toDeal(x, id);
        if (deal && !S.deals[id] && !S.gone[id]) {
          S.deals[id] = deal;
          n++;
        }
      });
      Object.entries(IS.steps || {}).forEach(([k, v]) => {
        const st = toStep(v);
        if (st && k.includes('/') && !(k in S.steps)) S.steps[k] = st;
      });
      Object.entries(IS.docs || {}).forEach(([k, v]) => {
        const j = k.indexOf('/'), doc = j > 0 ? toDoc(v, k.slice(0, j), k.slice(j + 1)) : null;
        if (doc && !(k in S.docs)) S.docs[k] = doc;
      });
      Object.entries(IS.log || {}).forEach(([k, v]) => {
        const l = toLog(v, k);
        if (l && !(k in S.log)) S.log[k] = l;
      });
      Object.entries((d.custom || {}) as Record<string, unknown>).forEach(([k, v]) => {
        const c = toCust(v, +k);
        if (c && !this.custom[c.id]) {
          this.custom[c.id] = c;
          n++;
        }
      });
      this.persist('sales', S);
      this.persist('customCos', this.custom);
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
        this.seedGen++;
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

  // ------------------------------------------------------------------ customers added by hand
  /** Customers added by hand as registry rows (dictionary indexes for the text fields). */
  private customRaw(): Partial<RawCompany>[] {
    const D = this.base.dicts;
    const ix = (arr: string[], v: string, dflt: string) => {
      const i = arr.indexOf(v);
      return i >= 0 ? i : Math.max(0, arr.indexOf(dflt));
    };
    return Object.values(this.custom).map((c) => ({
      id: c.id, name: c.name, jur: c.jur || '', type: ix(D.type, 'ไม่ระบุ', 'ไม่ระบุ'), prov: ix(D.prov, c.prov, ''), addr: c.addr || '',
      ind: ix(D.ind, c.ind, 'ไม่ระบุ'), biz: c.biz || '', src: 16, tgt: 8, cfo: ix(D.cfo, '', ''), cfoN: 0, cfoEx: '', giNow: null, giMax: null,
      giUntil: '', newYm: '', invest: null, fac: null, set: '', mkt: '', phone: c.phone || '', email: c.email || '', web: c.web || '', ct: 0, match: 0,
    }));
  }
  /** Registry companies that look like the one about to be added (same juristic id or name). */
  similarCompanies(name: string, jur: string): Company[] {
    const k = norm(name), j = jur.replace(/\D/g, '');
    if (k.length < 3 && j.length < 10) return [];
    return this.B.companies
      .filter((c) => (j.length >= 10 && c.jur.replace(/\D/g, '') === j) || (k.length >= 3 && (norm(c.name) === k || (k.length >= 6 && norm(c.name).includes(k)))))
      .slice(0, 8);
  }
  /** Add a customer that is not in the registry; returns its company id. */
  addCustomer(p: Omit<CustomCo, 'id' | 'at' | 'by'>): number {
    let id: number;
    do id = CUSTOM_ID_MIN + Math.floor(Math.random() * 8e12);
    while (this.custom[id] || this.B.byId.has(id));
    const c: CustomCo = { ...p, name: p.name.trim().slice(0, 200), note: cap(p.note || ''), id, at: new Date().toISOString(), by: this.me() };
    this.custom[id] = c;
    this.op(keyOf.cust(id), { ...c });
    this.persist('customCos', this.custom);
    this.rebuild();
    this.emit();
    return id;
  }
  updateCustomer(id: number, patch: Partial<Omit<CustomCo, 'id'>>) {
    const c = this.custom[id];
    if (!c) return;
    const n = { ...c, ...patch, id, note: cap(patch.note ?? c.note) };
    const f = (Object.keys(n) as (keyof CustomCo)[]).filter((k) => n[k] !== c[k]);
    if (!f.length) return;
    this.custom[id] = n;
    this.op(keyOf.cust(id), { ...n }, { f });
    this.persist('customCos', this.custom);
    this.rebuild();
    this.emit();
  }
  deleteCustomer(id: number) {
    if (!this.custom[id]) return;
    delete this.custom[id];
    this.op(keyOf.cust(id));
    this.persist('customCos', this.custom);
    this.rebuild();
    this.emit();
  }

  // ------------------------------------------------------------------ Sales Tracker
  saveSales() {
    this.persist('sales', this.sales);
    this.emit();
  }
  private salesLog(d: Pick<Deal, 'id' | 'client'>, action: string, detail = '') {
    const at = new Date().toISOString(), by = this.me();
    // typing in one field after another, or rewording a note, is one history entry: the same record
    // is rewritten (the sheet keeps only its last version) instead of a new row per keystroke-save
    const prev = d.id && (action === 'แก้ไข' || action.startsWith('อัปเดต ')) ? this.lastLog : null;
    const same = prev && this.sales.log[prev.id] && prev.deal === d.id && prev.by === by && prev.action === action && Date.parse(at) - Date.parse(prev.at) < 10 * 60000;
    if (same && action === 'แก้ไข') detail = [...new Set([...prev.detail.split(', '), ...detail.split(', ')])].join(', ');
    const id = same ? prev.id : uid();
    const L: DealLog = { id, at, by, action, client: d.client, detail: detail.slice(0, 300), deal: d.id };
    this.lastLog = L;
    this.sales.log[id] = L;
    this.op(keyOf.dlog(id), { ...L });
  }
  /** The history entry this browser wrote last (see salesLog). */
  private lastLog: DealLog | null = null;
  /** Save a deal and queue it; `f` = the fields this edit changes (merged field by field with a
   *  teammate's concurrent edit, see rebaseOp); without it the whole record is this browser's. */
  private putDeal(d: Deal, f?: (keyof Deal)[]) {
    this.sales.deals[d.id] = d;
    this.op(keyOf.deal(d.id), { ...d }, { f });
  }
  /** Deals linked to a company (any of its merged ids). A company from the TGO website sync exists
   *  on this device only, so its deals are not linked by id: they are found by name. */
  dealsOf(gid: number) {
    const c = this.company(gid);
    if (c && isLocalId(c.id)) {
      const k = norm(c.name);
      return k ? Object.values(this.sales.deals).filter((d) => d.gid == null && norm(d.client) === k) : [];
    }
    const g = this.canonical(gid);
    return Object.values(this.sales.deals).filter((d) => d.gid != null && this.canonical(d.gid) === g);
  }
  /** Section a company most likely belongs to, from where it was found. */
  suggestSection(c: Company | undefined) {
    const S = this.sales.cfg.sections;
    const pick = (...names: string[]) => names.find((n) => S.includes(n)) || '';
    if (!c) return '';
    return (c.src & 8 && pick('SET/mai')) || (c.src & 1 && pick('TGO')) || '';
  }
  /** Where a deal goes when nothing says otherwise: "อื่นๆ" rather than the first channel. */
  private defaultSection() {
    const S = this.sales.cfg.sections;
    return S.includes('อื่นๆ') ? 'อื่นๆ' : S[0] || '';
  }
  /** New deal; `gid` links it to a company whose contact details fill in what is not given. */
  addDeal(p: Partial<Deal>): Deal {
    const c = p.gid != null ? this.company(p.gid) : undefined;
    const gid = c && !isLocalId(c.id) ? c.id : null; // TGO-sync companies exist on this device only
    const cc = c ? this.custom[c.id] : undefined;
    const section = p.section ?? (this.suggestSection(c) || this.defaultSection());
    const d = newDeal(
      {
        client: c?.name || '', phone: c?.phone || '', email: c?.email || '', contactName: cc?.contact || '',
        resp: (c && this.crm.owners[c.id]) || this.me(), section, source: [matchSource(this.sales.cfg.sources, section)].filter((x): x is string => !!x),
        ...p, id: opId(), gid,
      },
      this.me(),
    );
    d.client = (d.client || '').trim().slice(0, 200) || 'ลูกค้าใหม่';
    this.putDeal(d);
    this.salesLog(d, 'เพิ่มลูกค้า', d.section);
    this.saveSales();
    return d;
  }
  /** Send companies (e.g. the starred ones) to the tracker; those already tracked in the year are skipped. */
  addDealsFromCompanies(ids: number[], opts: { section?: string; year?: string } = {}) {
    return this.batchOps(() => this.addDealsFrom(ids, opts));
  }
  private addDealsFrom(ids: number[], opts: { section?: string; year?: string }) {
    const year = opts.year || beYear();
    const seen = new Set<number>();
    let added = 0, skipped = 0;
    ids.forEach((id) => {
      const c = this.company(id);
      if (!c || seen.has(c.id)) return;
      seen.add(c.id);
      if (this.dealsOf(c.id).some((d) => d.year === year)) {
        skipped++;
        return;
      }
      this.addDeal({ gid: c.id, year, ...(opts.section != null ? { section: opts.section } : {}) });
      added++;
    });
    return { added, skipped };
  }
  updateDeal(id: string, patch: Partial<Deal>) {
    const d = this.sales.deals[id];
    if (!d) return;
    const n: Deal = { ...d, ...patch, id };
    // A forecast typed now is newer than any quotation this browser has seen — also when its clock is
    // behind the attacher's, and when it equals a figure typed earlier that the quotation hides.
    const fcTyped = 'forecast' in patch && (patch.forecast !== d.forecast || (patch.forecast != null && !!dealMoney(this.sales, d).fcDoc));
    if (fcTyped) n.fcAt = this.stampAfter(docsOf(this.sales, id).filter((x) => x.target === 'forecast').map((x) => x.cAt || x.at));
    if (patch.jobStatus === 'closed' && d.jobStatus !== 'closed') n.closedDate = n.closedDate || todayISO();
    if (patch.jobStatus === 'open') n.closedDate = '';
    if ('client' in patch) n.client = String(patch.client || '').trim().slice(0, 200) || d.client;
    if ('gid' in patch) n.gid = patch.gid != null && !isLocalId(patch.gid) ? this.canonical(patch.gid) : null;
    const changed = (Object.keys(patch) as (keyof Deal)[]).filter((k) => JSON.stringify(d[k]) !== JSON.stringify(n[k]) || (k === 'forecast' && fcTyped));
    if (!changed.length) return;
    this.putDeal(n, [...new Set([...changed, ...(['fcAt', 'closedDate'] as const).filter((k) => n[k] !== d[k])])]);
    const TH: Partial<Record<keyof Deal, string>> = {
      client: 'ชื่อลูกค้า', contactName: 'ผู้ติดต่อ', phone: 'เบอร์', email: 'อีเมล', resp: 'ผู้รับผิดชอบ', referral: 'แหล่งที่มา', contactDate: 'วันที่ติดต่อ',
      jobStatus: 'สถานะงาน', forecast: 'Forecast', actual: 'Actual', source: 'SOURCE', service: 'Services', section: 'หมวด', gid: 'เชื่อมกับบริษัท', year: 'ปี',
    };
    const what = changed.map((k) => TH[k]).filter(Boolean).join(', ');
    if (what) this.salesLog(n, patch.jobStatus === 'closed' ? 'ปิดงาน' : patch.jobStatus === 'open' ? 'เปิดงานอีกครั้ง' : 'แก้ไข', what);
    this.saveSales();
  }
  /** Stage date + note; a note without a date gets today's date. Only the step record is written —
   *  the last contact is derived from it (lastContact), so a note never rewrites the deal. */
  setStep(id: string, stage: string, st: DealStep, quiet = false, auto = false) {
    const d = this.sales.deals[id];
    if (!d) return;
    const k = `${id}/${stage}`;
    const n = (st.n || '').slice(0, NOTE_MAX);
    const date = st.d || (n.trim() ? todayISO() : '');
    const cur = this.sales.steps[k] || { d: '', n: '' };
    if (cur.d === date && cur.n === n) return;
    // a note written for a document (auto) only replaces what this browser saw there: a teammate who
    // wrote in the stage meanwhile keeps their note (rebaseOp)
    const base = auto ? (cur.d || cur.n ? { d: cur.d, n: cur.n } : null) : undefined;
    if (!date && !n.trim()) {
      delete this.sales.steps[k];
      this.op(keyOf.dstep(id, stage), undefined, { base });
    } else {
      this.sales.steps[k] = { d: date, n };
      this.op(keyOf.dstep(id, stage), { d: date, n }, { base });
    }
    if (!quiet) this.salesLog(d, 'อัปเดต ' + stage, n.trim().slice(0, 120) || isoTh(date));
    this.saveSales();
  }
  /** Move a deal to another section and/or before another deal (null = end of the section). */
  moveDeal(id: string, section: string, beforeId: string | null) {
    const d = this.sales.deals[id];
    if (!d) return;
    const rows = Object.values(this.sales.deals).filter((x) => x.year === d.year && x.section === section && x.id !== id).sort((a, b) => a.order - b.order);
    const i = beforeId ? rows.findIndex((x) => x.id === beforeId) : -1;
    const order = i < 0 ? (rows.length ? rows[rows.length - 1].order + 1000 : Date.now()) : i === 0 ? rows[0].order - 1000 : (rows[i - 1].order + rows[i].order) / 2;
    this.putDeal({ ...d, section, order }, ['section', 'order']);
    if (section !== d.section) this.salesLog(d, 'ย้ายหมวด', `${d.section || '-'} → ${section || '-'}`);
    this.saveSales();
  }
  deleteDeal(id: string) {
    const d = this.sales.deals[id];
    if (!d) return;
    this.batchOps(() => this.deleteDealNow(d));
    this.saveSales();
  }
  private deleteDealNow(d: Deal, why = 'ลบลูกค้า') {
    const id = d.id;
    delete this.sales.deals[id];
    this.sales.gone[id] = new Date().toISOString();
    this.op(keyOf.deal(id));
    Object.keys(this.sales.steps).forEach((k) => {
      if (!k.startsWith(id + '/')) return;
      delete this.sales.steps[k];
      this.op('dstep/' + k);
    });
    Object.entries(this.sales.docs).forEach(([k, doc]) => {
      if (doc.deal !== id) return;
      delete this.sales.docs[k];
      this.op('ddoc/' + k);
      this.dropDocFile(doc);
    });
    this.salesLog(d, why, d.section);
  }
  /** Replace one of the tracker's lists (sections, SOURCE, Services, stages). */
  setSalesList(name: keyof SalesCfg, items: string[]) {
    // a stage name is part of its notes' record keys (dstep/<deal>/<stage>), so no "/" there; other
    // lists are plain values ("SET/mai")
    const v = [...new Set(items.map((x) => (name === 'stages' ? x.trim().replace(/\//g, '-') : x.trim())).filter(Boolean))];
    if (name === 'stages' && !v.length) return;
    const cur = this.sales.cfg[name];
    // queued as what changed, so two people adding at once both keep their item (rebaseOp)
    const lst = { add: v.filter((x) => !cur.includes(x)), rm: cur.filter((x) => !v.includes(x)) };
    if (!this.teamCfg || this.importing) {
      const O = this.sales.offAdds || (this.sales.offAdds = {});
      O[name] = [...new Set([...(O[name] || []), ...lst.add])].filter((x) => !lst.rm.includes(x));
    }
    this.sales.cfg[name] = v;
    this.op(keyOf.scfg(name), v.slice(), { lst });
    this.saveSales();
  }
  renameSection(from: string, to: string) {
    to = to.trim();
    if (!to || to === from) return;
    const S = this.sales.cfg;
    this.setSalesList('sections', S.sections.map((x) => (x === from ? to : x)));
    if (S.sources.includes(from)) this.setSalesList('sources', S.sources.map((x) => (x === from ? to : x)));
    this.batchOps(() =>
      Object.values(this.sales.deals).forEach((d) => {
        if (d.section !== from && !d.source.includes(from)) return;
        this.putDeal({ ...d, section: d.section === from ? to : d.section, source: d.source.map((x) => (x === from ? to : x)) }, ['section', 'source']);
      }),
    );
    this.saveSales();
  }

  // ---- attached documents (quotation / invoice); files go to the team's Drive, a copy stays in this browser
  /** Script supports attachments (null = not checked yet for this connection). */
  teamFiles: boolean | null = null;
  fileTransport: Transport = fileFetchTransport;
  docMsg = '';
  private docUploading = false;
  private docBlobKey = (docId: string) => 'docblob:' + docId;

  async attachDoc(dealId: string, file: Blob & { name: string }, info: { kind: DocKind; amount: number | null; target: DocTarget; basis: DealDoc['basis']; detected: number | null; docNo: string; docDate: string }) {
    const d = this.sales.deals[dealId];
    if (!d) throw new Error('ไม่พบรายการนี้แล้ว');
    if (file.size > DOC_MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 10 MB');
    const mime = docMime({ name: file.name || '', type: file.type || '' });
    if (!mime) throw new Error('รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)');
    const S = this.sales;
    const id = uid();
    const filled = (p: string) => {
      const x = stepOf(S, dealId, p);
      return !!(x.d || x.n.trim());
    };
    const stage = info.target === 'forecast' || (info.target === 'none' && info.kind === 'quotation') ? 'QUOTATION' : info.target === 'actual' ? (filled('PAY1') ? 'PAY2' : 'PAY1') : '';
    const at = new Date().toISOString();
    const cAt = this.stampAfter([d.fcAt, ...docsOf(S, dealId).map((x) => x.cAt || x.at)]);
    const doc: DealDoc = {
      id, deal: dealId, kind: info.kind, name: (file.name || 'เอกสาร').slice(0, 120), mime, size: file.size, fileId: '',
      docNo: info.docNo.slice(0, 60), docDate: info.docDate, amount: info.amount, target: info.amount == null ? 'none' : info.target,
      detected: info.detected, basis: info.basis, stage, at, cAt, by: this.me(),
    };
    // fill the stage the document stands for, if empty, and remember the note so it can follow the
    // document (edited amount, deleted document)
    const ad = info.docDate && info.docDate <= todayISO() ? info.docDate : todayISO();
    if (stage && !filled(stage)) doc.auto = { stage, n: this.autoNote(doc), d: ad };
    // keep the file in this browser first: it is uploaded to the team's Drive in the background
    let kept = true;
    try {
      await this.store.set(this.docBlobKey(id), { name: doc.name, mime: doc.mime, data: await file.arrayBuffer() });
    } catch {
      kept = false;
    }
    if (!kept) {
      if (!this.teamCfg) throw new Error('บันทึกไฟล์ในเบราว์เซอร์ไม่สำเร็จ (พื้นที่เต็ม?) และยังไม่ได้เชื่อมต่อทีม');
      const r = await uploadDocFile(this.fileTransport, this.teamCfg.url, this.teamCfg.key, { docId: id, name: doc.name, mime: doc.mime, blob: file });
      doc.fileId = r.fileId;
    }
    S.docs[`${dealId}/${id}`] = doc;
    this.op(keyOf.ddoc(dealId, id), { ...doc });
    // the forecast follows the newest confirmed quotation (dealMoney): the deal record is not touched
    if (doc.auto) this.setStep(dealId, doc.auto.stage, { d: ad, n: doc.auto.n }, true, true);
    this.salesLog(d, 'แนบ' + KIND_TH[doc.kind], `${doc.name}${doc.amount != null ? ' · ' + fmtMoney(doc.amount) + ' บาท' : ''}`);
    this.saveSales();
    this.uploadDocs();
    return doc;
  }
  /** An ISO time now, but after every given one: the order of "typed forecast" and "confirmed
   *  quotation" follows what each person saw, not the clocks of different computers. */
  private stampAfter(after: (string | undefined)[]) {
    const t = Math.max(Date.now(), ...after.map((x) => (x ? Date.parse(x) + 1 : 0)).filter((x) => isFinite(x)));
    return new Date(t).toISOString();
  }
  /** The stage note a document fills in: "ใบเสนอราคา QT-1 · 107,000 บาท". */
  private autoNote(doc: Pick<DealDoc, 'kind' | 'docNo' | 'amount'>) {
    return `${KIND_TH[doc.kind]}${doc.docNo ? ' ' + doc.docNo : ''}${doc.amount != null ? ' · ' + fmtMoney(doc.amount) + ' บาท' : ''}`;
  }
  /** The note a document filled in, if nobody has changed it since (else it is the user's now). */
  private autoStillThere(doc: DealDoc) {
    return !!doc.auto && stepOf(this.sales, doc.deal, doc.auto.stage).n === doc.auto.n;
  }
  updateDoc(dealId: string, docId: string, patch: Partial<Pick<DealDoc, 'amount' | 'target' | 'basis' | 'kind' | 'docNo' | 'docDate'>>) {
    const k = `${dealId}/${docId}`, doc = this.sales.docs[k], d = this.sales.deals[dealId];
    if (!doc || !d) return;
    const n: DealDoc = { ...doc, ...patch };
    if (n.amount == null) n.target = 'none';
    const f = (Object.keys(n) as (keyof DealDoc)[]).filter((x) => JSON.stringify(n[x]) !== JSON.stringify(doc[x]));
    if (!f.length) return;
    // Changing what it counts toward is a new confirmation (as a quotation it becomes the forecast), and
    // so is a new amount — except on an older quotation a newer one replaced: correcting that record
    // must not make it the forecast again.
    const fcs = docsOf(this.sales, dealId).filter((x) => x.target === 'forecast' && x.amount != null).sort((a, b) => (a.cAt || a.at).localeCompare(b.cAt || b.at));
    // not the figure in use (a newer quotation or a forecast typed after it replaced it): a correction only
    const superseded = doc.target === 'forecast' && dealMoney(this.sales, d).fcDoc?.id !== docId;
    if (n.target !== doc.target || (n.amount !== doc.amount && !superseded)) {
      n.cAt = this.stampAfter([d.fcAt, ...fcs.filter((x) => x.id !== docId).map((x) => x.cAt || x.at)]);
      f.push('cAt');
    }
    const note = this.autoNote(n);
    if (doc.auto && note !== doc.auto.n && this.autoStillThere(doc)) {
      const st = stepOf(this.sales, dealId, doc.auto.stage);
      n.auto = { ...doc.auto, n: note };
      f.push('auto');
      this.setStep(dealId, doc.auto.stage, { d: st.d, n: note }, true, true);
    }
    this.sales.docs[k] = n;
    this.op(keyOf.ddoc(dealId, docId), { ...n }, { f });
    this.salesLog(d, 'แก้ไขเอกสาร', `${n.name}${n.amount != null ? ' · ' + fmtMoney(n.amount) + ' บาท' : ''}`);
    this.saveSales();
  }
  deleteDoc(dealId: string, docId: string) {
    const k = `${dealId}/${docId}`, doc = this.sales.docs[k], d = this.sales.deals[dealId];
    if (!doc) return;
    // The stage note it filled in goes with it, unless someone has written in it since. Another
    // document for the same stage (a revised quotation, a second invoice) takes the stage over.
    if (doc.auto && this.autoStillThere(doc)) {
      const stage = doc.auto.stage, st = stepOf(this.sales, dealId, stage);
      const heir = docsOf(this.sales, dealId)
        .filter((x) => x.id !== doc.id && x.stage === stage)
        .sort((a, b) => (a.cAt || a.at).localeCompare(b.cAt || b.at))
        .pop();
      const userDate = doc.auto.d && st.d !== doc.auto.d ? st.d : ''; // a date the user corrected stays
      if (heir) {
        const hk = `${dealId}/${heir.id}`, note = this.autoNote(heir);
        this.sales.docs[hk] = { ...heir, auto: { stage, n: note, ...(doc.auto.d ? { d: doc.auto.d } : {}) } };
        this.op(keyOf.ddoc(dealId, heir.id), { ...this.sales.docs[hk] }, { f: ['auto'] });
        this.setStep(dealId, stage, { d: st.d, n: note }, true, true);
      } else this.setStep(dealId, stage, { d: userDate, n: '' }, true, true);
    }
    delete this.sales.docs[k];
    this.op(keyOf.ddoc(dealId, docId));
    this.dropDocFile(doc);
    if (d) this.salesLog(d, 'ลบเอกสาร', doc.name);
    this.saveSales();
  }
  private dropDocFile(doc: DealDoc) {
    this.store.del(this.docBlobKey(doc.id)).catch(() => {});
    if (doc.fileId) this.dropDriveFile(doc.fileId);
  }
  /** Trash a document's file in the team's Drive; when that can't be done now (offline, not
   *  connected) it is remembered and retried after a later sync (flushDocDeletes). */
  private dropDriveFile(fileId: string) {
    const cfg = this.teamCfg;
    const later = () => this.store.update<string[]>('docDelQueue', (q) => [...new Set([...(q || []), fileId])]).catch(() => {});
    if (!cfg) return void later();
    deleteDocFile(this.fileTransport, cfg.url, cfg.key, fileId).catch(later);
  }
  private async flushDocDeletes(cfg: TeamCfg) {
    const q = (await this.store.get<string[]>('docDelQueue').catch(() => null)) || [];
    for (const fileId of q) {
      if (this.teamCfg !== cfg) return;
      try {
        await deleteDocFile(this.fileTransport, cfg.url, cfg.key, fileId);
      } catch {
        return; // still failing: try again after the next sync
      }
      await this.store.update<string[]>('docDelQueue', (cur) => (cur || []).filter((x) => x !== fileId)).catch(() => {});
    }
  }
  /** The file itself: this browser's copy, else downloaded from the team's Drive (and kept). */
  async docBlob(doc: DealDoc): Promise<Blob> {
    const b = await this.store.get<{ name: string; mime: string; data: ArrayBuffer }>(this.docBlobKey(doc.id));
    if (b) return new Blob([b.data], { type: b.mime || doc.mime });
    const cfg = this.teamCfg;
    if (!doc.fileId) throw new Error('ไฟล์นี้ยังอยู่ในเครื่องของคนที่แนบ ยังไม่ได้อัปโหลดขึ้น Drive ของทีม');
    if (!cfg) throw new Error('เชื่อมต่อทีม (แท็บอัปเดตข้อมูล) ก่อน จึงจะเปิดไฟล์ใน Drive ของทีมได้');
    let r: Awaited<ReturnType<typeof downloadDocFile>>;
    try {
      r = await downloadDocFile(this.fileTransport, cfg.url, cfg.key, doc.fileId);
    } catch (e) {
      throw new Error('เปิดไฟล์จาก Drive ของทีมไม่ได้: ' + fileErrText(e));
    }
    this.store.set(this.docBlobKey(doc.id), { name: doc.name, mime: r.mime || doc.mime, data: await r.blob.arrayBuffer() }).catch(() => {});
    return r.blob;
  }
  /** Documents attached in this browser that are not in the team's Drive yet. */
  get docsWaiting() {
    return Object.values(this.sales.docs).filter((d) => !d.fileId).length;
  }
  /** Upload files attached in this browser to the team's Drive (after each successful sync). */
  /** After a failed upload round the next one waits (1, 2, 4 … up to 30 minutes), not every sync. */
  private docRetryAt = 0;
  private docFails = 0;
  /** Documents the script refused for good (too large…): not re-sent until the page is reloaded. */
  private docRefused = new Set<string>();
  private teamFilesAt = 0;
  async uploadDocs() {
    const cfg = this.teamCfg;
    if (!cfg || this.docUploading) return;
    // one tab of this browser uploads at a time (they share the files); the others skip this round
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks) return void (await locks.request('gcc-doc-upload', { ifAvailable: true }, (lock) => (lock ? this.uploadDocsNow(cfg) : undefined)));
    return this.uploadDocsNow(cfg);
  }
  private async uploadDocsNow(cfg: TeamCfg) {
    if (this.docUploading || this.teamCfg !== cfg) return;
    this.docUploading = true;
    const failed: string[] = [];
    try {
      await this.flushDocDeletes(cfg);
      // only documents of deals that still exist, and that this browser has the file of
      const todo = Object.values(this.sales.docs).filter((d) => !d.fileId && this.sales.deals[d.deal] && !this.docRefused.has(d.id));
      if (!todo.length || Date.now() < this.docRetryAt) return;
      // "old script" is checked again every 10 minutes: the lead may deploy the new one meanwhile
      if (this.teamFiles === false && Date.now() - this.teamFilesAt > 10 * 60000) this.teamFiles = null;
      if (this.teamFiles == null) {
        this.teamFiles = await scriptSupportsFiles(this.fileTransport, cfg.url, cfg.key);
        this.teamFilesAt = Date.now();
      }
      if (!this.teamFiles) {
        this.docMsg = 'สคริปต์ของทีมยังเป็นเวอร์ชันเก่า เอกสารจึงเก็บไว้ในเครื่องนี้ — อัปเดต Code.gs แล้ว Deploy เวอร์ชันใหม่ (ดูคู่มือ) เพื่อเก็บใน Drive ของทีม';
        return;
      }
      for (const doc of todo) {
        if (this.teamCfg !== cfg) return;
        const b = await this.store.get<{ name: string; mime: string; data: ArrayBuffer }>(this.docBlobKey(doc.id));
        if (!b) continue; // attached on another device
        let r: { fileId: string };
        try {
          r = await uploadDocFile(this.fileTransport, cfg.url, cfg.key, { docId: doc.id, name: doc.name, mime: doc.mime, blob: new Blob([b.data], { type: doc.mime }) });
        } catch (e) {
          // a file the script refuses for good must not hold back every other upload
          if (e instanceof TeamSyncError && ['file_too_large', 'bad_file_type', 'empty_file', 'bad_doc_id', 'bad_data'].includes(e.code ?? '')) {
            failed.push(`${doc.name}: ${fileErrText(e)}`);
            this.docRefused.add(doc.id);
            continue;
          }
          throw e;
        }
        const k = `${doc.deal}/${doc.id}`, cur = this.sales.docs[k];
        if (!cur) {
          this.dropDriveFile(r.fileId); // deleted meanwhile
          continue;
        }
        this.sales.docs[k] = { ...cur, fileId: r.fileId };
        // only the file link: a teammate's correction of the amount meanwhile is kept (rebaseOp)
        this.op(keyOf.ddoc(doc.deal, doc.id), { ...this.sales.docs[k] }, { f: ['fileId'] });
        this.saveSales();
      }
      this.docFails = 0;
      this.docRetryAt = 0;
      this.docMsg = failed.length ? 'อัปโหลดเอกสารขึ้น Drive ไม่ได้ — ' + failed.join(' · ') + ' (ไฟล์ยังอยู่ในเครื่องนี้ ลบแล้วแนบไฟล์ใหม่)' : '';
    } catch (e) {
      this.docFails++;
      const wait = Math.min(30 * 60000, 60000 * 2 ** (this.docFails - 1));
      this.docRetryAt = Date.now() + wait;
      this.docMsg = 'อัปโหลดเอกสารขึ้น Drive ไม่สำเร็จ: ' + fileErrText(e) + ` (เก็บไว้ในเครื่องนี้ จะลองใหม่ในอีก ${Math.round(wait / 60000)} นาที)`;
    } finally {
      this.docUploading = false;
      this.emit();
    }
  }

  // ---- import / export
  /**
   * Import the old Sales Tracker: its JSON backup (needs the year), or its Google Sheet downloaded as CSV /
   * Excel. Rows get stable ids, so importing the same file again updates instead of duplicating; clients whose
   * name matches a registry company are linked to it.
   */
  /** Import the old tracker's data. Never overwrites: a row already imported (or a client already
   *  tracked that year) is skipped, so the team's newer edits always win over an old file. A client
   *  name is linked to a registry company only when exactly one company has that name. */
  async importTracker(f: File, year: string): Promise<{ deals: number; skipped: number; linked: number; ambiguous: number; inexact: number; years: string[]; batch: string }> {
    const name = (f.name || '').toLowerCase();
    let data: TrackerData[];
    if (name.endsWith('.json')) data = [parseTrackerJson(JSON.parse(await f.text()), year)];
    // a CSV re-saved by Excel is often Windows-874 (Thai), not UTF-8
    else if (name.endsWith('.csv')) data = parseTrackerSheet(parseCsv(decodeTrackerText(await f.arrayBuffer()).text));
    else if (name.endsWith('.xlsx')) data = parseTrackerSheet(await readXlsxRows(f));
    else throw new Error('รองรับไฟล์ .json (สำรองข้อมูลจาก Sales Tracker) หรือ .csv / .xlsx (ดาวน์โหลดจาก Google Sheet ของ Sales Tracker)');
    if (!data.length || !data.some((x) => x.clients.length))
      throw new Error('ไม่พบรายการลูกค้าในไฟล์ — ใช้ไฟล์ที่มีคอลัมน์ client (ชื่อลูกค้า) จาก Google Sheet ของ Sales Tracker เดิม หรือไฟล์สำรองข้อมูล (JSON)');
    // everything this import changes is queued for the team in one write
    return this.batchOps(() => this.importTrackerData(data));
  }
  private importTrackerData(data: TrackerData[]) {
    const S = this.sales, me = this.me();
    const batch = uid(); // marks the deals of this import, so it can be undone (undoImport)
    // companies per normalised name (merged duplicates count once)
    const named = new Map<string, Set<number>>();
    this.B.companies.forEach((c) => {
      const k = norm(c.name);
      if (k && !isLocalId(c.id)) (named.get(k) || named.set(k, new Set()).get(k)!).add(this.canonical(c.id));
    });
    let deals = 0, skipped = 0, linked = 0, ambiguous = 0, inexact = 0;
    const listsAdded: Partial<Record<keyof SalesCfg, string[]>> = {};
    data.forEach((t) => {
      // lists: keep ours, add what the file has that we don't (remembered, so an undo can take them out)
      (['sections', 'sources', 'services', 'stages'] as const).forEach((k) => {
        const extra = (t.cfg[k] || []).filter((x) => !S.cfg[k].includes(x));
        if (k === 'sections') t.clients.forEach((c) => c.section && !S.cfg.sections.includes(c.section) && !extra.includes(c.section) && extra.push(c.section));
        if (k === 'stages') t.clients.forEach((c) => Object.keys(c.progress).forEach((p) => !S.cfg.stages.includes(p) && !extra.includes(p) && extra.push(p)));
        if (!extra.length) return;
        this.setSalesList(k, [...S.cfg[k], ...extra]);
        (listsAdded[k] || (listsAdded[k] = [])).push(...extra.filter((x) => S.cfg[k].includes(x)));
      });
      // clients this year already tracked here, e.g. sent from the registry before importing
      const have = new Map<string, number>();
      Object.values(S.deals).forEach((d) => {
        if (d.year !== t.year || d.id.startsWith('imp')) return;
        const k = norm(d.client);
        if (k) have.set(k, (have.get(k) || 0) + 1);
      });
      const nth = new Map<string, number>();
      let added = 0;
      t.clients.forEach((c, i) => {
        const key = importKey(c);
        const n = (nth.get(key) || 0) + 1;
        nth.set(key, n);
        const id = importId(t.year, c, n);
        // already imported, deleted by the team since (never brought back — unless the deletion was
        // an undone import), or tracked by hand
        if (S.deals[id] || (S.gone[id] && !S.undone[id]) || n <= (have.get(norm(c.client)) || 0)) {
          skipped++;
          return;
        }
        const ids = named.get(norm(c.client));
        const gid = ids && ids.size === 1 ? [...ids][0] : null;
        if (gid != null) linked++;
        else if (ids && ids.size > 1) ambiguous++;
        const d: Deal = {
          ...newDeal({ id, client: c.client || c.contactName || 'ลูกค้า' }, me),
          year: t.year, section: c.section, gid, contactName: c.contactName, phone: c.phone, email: c.email,
          resp: c.resp, referral: c.referral, contactDate: c.contactDate, jobStatus: c.jobStatus, closedDate: c.closedDate, forecast: c.forecast, actual: c.actual,
          source: c.source, service: c.service, order: Object.keys(S.deals).length + i, imp: batch,
        };
        // create-only (SyncOp.nx): if a teammate imported or deleted this row first, theirs stands — except
        // for a row this team undid, which comes back as a plain write (its own tombstone is on the sheet)
        this.importNew = !S.undone[id];
        try {
          this.putDeal(d);
          Object.entries(c.progress).forEach(([p, st]) => {
            S.steps[`${id}/${p}`] = st;
            this.op(keyOf.dstep(id, p), { ...st });
          });
        } finally {
          this.importNew = false;
        }
        if (S.undone[id]) {
          delete S.undone[id];
          delete S.gone[id];
          this.op(keyOf.dundo(id));
        }
        // an amount like "50,000-80,000" counts as its lower end; keep what was typed in the history
        const raw = [c.forecastText && `Forecast เดิม "${c.forecastText}"`, c.actualText && `Actual เดิม "${c.actualText}"`].filter(Boolean).join(' · ');
        if (raw) {
          inexact++;
          this.salesLog(d, 'จำนวนเงินจากไฟล์เดิม', raw + ' — ตรวจตัวเลขอีกครั้ง');
        }
        added++;
      });
      deals += added;
      this.salesLog({ id: '', client: '' }, 'นำเข้าจาก Sales Tracker เดิม', `ปี ${t.year} · เพิ่ม ${added} ราย` + (t.clients.length > added ? ` · ข้าม ${t.clients.length - added} รายที่มีอยู่แล้ว` : ''));
    });
    this.saveSales();
    this.importLists[batch] = listsAdded;
    return { deals, skipped, linked, ambiguous, inexact, years: data.map((x) => x.year), batch };
  }
  /** List items each import of this session added (for undoImport). */
  private importLists: Record<string, Partial<Record<keyof SalesCfg, string[]>>> = {};
  /** Deals added by one import (see importTracker's `batch`). */
  importedBy(batch: string) {
    return Object.values(this.sales.deals).filter((d) => d.imp === batch);
  }
  /** Undo an import: its deals are removed for the whole team. Unlike deleting by hand, the same
   *  file can be imported again afterwards. */
  undoImport(batch: string) {
    const S = this.sales, ds = this.importedBy(batch), at = new Date().toISOString();
    this.batchOps(() => {
      ds.forEach((d) => {
        this.deleteDealNow(d, 'ยกเลิกการนำเข้า');
        delete S.gone[d.id];
        // shared, so this browser's own tombstone coming back (and every teammate) knows it was an undo
        S.undone[d.id] = at;
        this.op(keyOf.dundo(d.id), at);
      });
      // the sections / SOURCE / Services / stages the import added, unless something uses them now
      const added = this.importLists[batch] || {};
      (Object.keys(added) as (keyof SalesCfg)[]).forEach((k) => {
        const used = new Set<string>();
        Object.values(S.deals).forEach((d) => (k === 'sections' ? used.add(d.section) : k === 'sources' ? d.source.forEach((x) => used.add(x)) : k === 'services' ? d.service.forEach((x) => used.add(x)) : null));
        if (k === 'stages') Object.keys(S.steps).forEach((x) => used.add(x.slice(x.indexOf('/') + 1)));
        const rm = (added[k] || []).filter((x) => !used.has(x));
        if (rm.length) this.setSalesList(k, S.cfg[k].filter((x) => !rm.includes(x)));
      });
    });
    delete this.importLists[batch];
    this.saveSales();
    return ds.length;
  }
  /** CSV (opens in Excel) of a year's tracker table, like the old tracker's export. */
  exportSalesCsv(year: string, deals: Deal[]) {
    downloadBlob(new Blob(['﻿' + this.salesCsv(deals)], { type: 'text/csv;charset=utf-8' }), `Sales_Tracker_${year}_${todayISO()}.csv`);
  }
  salesCsv(deals: Deal[]) {
    const S = this.sales, C = S.cfg, today = todayISO();
    const head = ['NO.', 'หมวด', 'POTENTIAL CLIENT', 'รหัสบริษัท', 'ผู้ติดต่อ', 'เบอร์', 'อีเมล', 'RESPONSIBLE', 'REFERRAL', 'วันที่ติดต่อ', 'ติดต่อล่าสุด', 'สถานะงาน', 'สถานะ']
      .concat(C.sources.map((x) => 'SOURCE: ' + x), ['SOURCE อื่น'], C.services.map((x) => 'Service: ' + x), ['Services อื่น'], C.stages.flatMap((p) => [p + ' วันที่', p + ' โน้ต']), ['ขั้นตอนอื่น'])
      .concat(['FORECAST (บาท)', 'Forecast ยืนยันด้วยเอกสาร', 'ACTUAL (บาท)', 'Actual ยืนยันด้วยเอกสาร', 'เอกสารแนบ']);
    const lines = deals.map((d, i) => {
      const m = dealMoney(S, d), st = dealStatus(S, d);
      const docs = Object.values(S.docs).filter((x) => x.deal === d.id);
      // ticks and notes no longer in the lists are kept (removing a list item keeps them on the deals)
      const otherSteps = Object.entries(S.steps)
        .filter(([k]) => k.startsWith(d.id + '/') && !C.stages.includes(k.slice(d.id.length + 1)))
        .map(([k, x]) => `${k.slice(d.id.length + 1)}: ${[x.d, x.n].filter(Boolean).join(' ')}`);
      return [csvCell(i + 1), csvCell(d.section), csvCell(d.client), csvCell(d.gid != null ? this.company(d.gid)?.code || '' : ''), csvCell(d.contactName), csvPhone(d.phone), csvCell(d.email), csvCell(d.resp), csvCell(d.referral),
        csvCell(d.contactDate), csvCell(lastContact(S, d, today)), csvCell(d.jobStatus === 'closed' ? 'ปิดงาน ' + (d.closedDate || '') : 'เปิด'), csvCell(st.overall)]
        .concat(C.sources.map((x) => csvCell(d.source.includes(x) ? '✓' : '')), [csvCell(d.source.filter((x) => !C.sources.includes(x)).join(', '))])
        .concat(C.services.map((x) => csvCell(d.service.includes(x) ? '✓' : '')), [csvCell(d.service.filter((x) => !C.services.includes(x)).join(', '))])
        .concat(C.stages.flatMap((p) => {
          const x = stepOf(S, d.id, p);
          return [csvCell(x.d), csvCell(x.n)];
        }), [csvCell(otherSteps.join(' | '))])
        .concat([m.forecast ?? '', m.fcConfirmed ? '✓' : '', m.actual ?? '', m.acConfirmed ? '✓' : '', docs.map((x) => `${KIND_TH[x.kind]} ${x.docNo || x.name}${x.amount != null ? ' ' + fmtMoney(x.amount) : ''}`).join(' | ')].map(csvCell))
        .join(',');
    });
    return [head.map(csvCell).join(','), ...lines].join('\r\n');
  }

  // ------------------------------------------------------------------ team sync
  /** Queue a shared-record change (v === undefined → delete). No-op until connected — connecting
   *  uploads everything local that the team sheet doesn't have yet. */
  private op(k: string, v?: unknown, opt: { f?: string[]; lst?: ListEdit; base?: SyncOp['base'] } = {}) {
    const cfg = this.teamCfg;
    if (!cfg || this.importing || isLocalOnly(k, v)) return;
    const o = this.mkOp(k, v);
    const prev = this.pending.get(k);
    if (v !== undefined) {
      const nxPrev = !!prev?.nx && !prev.sent;
      if (this.importNew) o.nx = true; // created by an import: only fills a gap
      else if (nxPrev && opt.f) {
        // a person's edit of an import row not shared yet: if the team has that row, their record wins
        // except for the fields edited here (rebaseOp), so the edit isn't lost
        o.nx = true;
        o.f = [...new Set([...(prev!.f || []), ...opt.f])];
      }
      if (!o.nx) {
        const fl = mergeFields(prev, opt.f);
        if (fl) o.f = fl;
      }
      const le = opt.lst && mergeListEdits(prev, opt.lst);
      if (le) o.lst = le;
    }
    // conditional only while every queued write to this record is a document's own (setStep auto)
    if (opt.base !== undefined && (!prev || prev.base !== undefined)) o.base = prev ? prev.base : opt.base;
    this.pending.set(k, o);
    this.unsaved.delete(k);
    if (this.opBatch) this.opBatch.push(o);
    else this.queueOps(cfg, [o]);
    if (this.teamFlush) clearTimeout(this.teamFlush);
    this.teamFlush = setTimeout(() => {
      this.teamFlush = null;
      this.teamSync();
    }, 700);
  }
  /** Ops made inside batchOps(), stored in one queue write at the end. */
  private opBatch: SyncOp[] | null = null;
  /** Set while an import writes the records it creates (create-only ops, see SyncOp.nx). */
  private importNew = false;
  /** A deal this browser is (re)creating as a whole, which a teammate's older deletion doesn't remove. */
  private pendingDealAlive(id: string) {
    const o = this.pending.get(keyOf.deal(id));
    return !!o && !o.del && !o.f && !o.nx;
  }
  /** Run `fn` storing all the changes it queues in one write: an import of hundreds of records
   *  would otherwise rewrite the stored queue once per record. */
  batchOps<T>(fn: () => T): T {
    if (this.opBatch) return fn();
    this.opBatch = [];
    try {
      return fn();
    } finally {
      const b = this.opBatch;
      this.opBatch = null;
      const cfg = this.teamCfg;
      if (cfg && b.length) this.queueOps(cfg, b);
    }
  }
  /** Store queued changes (one read-modify-write of the queue every tab shares). */
  private queueOps(cfg: TeamCfg, list: SyncOp[]) {
    const byK = new Map(list.map((o) => [o.k, o])); // the latest op per record
    const drop = new Set<string>();
    this.writePending(cfg.url, (ops) => {
      drop.clear();
      const stored = new Map(ops.map((x) => [x.k, x]));
      byK.forEach((o, k) => {
        const p = stored.get(k);
        if (!p || p.id === o.id) return;
        // a change replacing another tab's queued change to the same record is always the newer one
        if (!newer(o, p)) o.t = this.opT = Math.max(this.opT, (p.t || 0) + 1);
        // Another tab of this browser queued a change to the record; this tab's copy of it may be older.
        if (o.f && p.del) {
          drop.add(k); // that tab deleted it: the deletion wins over an edit (as rebaseOp does)
          return;
        }
        if (o.base !== undefined && p.base === undefined) {
          drop.add(k); // that tab wrote the note by hand: a document's automatic note yields
          return;
        }
        if (o.f && !p.f && !p.del && p.v && typeof p.v === 'object' && o.v && typeof o.v === 'object' && !p.nx) {
          // that tab wrote the whole record (e.g. created it offline): keep it, with this tab's fields on top
          const mine = o.v as Record<string, unknown>;
          o.v = { ...(p.v as Record<string, unknown>), ...Object.fromEntries(o.f.filter((x) => x in mine).map((x) => [x, mine[x]])) };
          delete o.f;
          return;
        }
        if (o.f && o.nx && p.nx) o.f = [...new Set([...(p.f || []), ...o.f])]; // an edit of an import row not shared yet (see op)
        else if (o.f) {
          const fl = mergeFields(p, o.f);
          if (fl && p.f && p.v && typeof p.v === 'object' && o.v && typeof o.v === 'object') {
            // keep that tab's values for the fields it changed and this tab didn't
            const pv = p.v as Record<string, unknown>, v = { ...(o.v as Record<string, unknown>) };
            p.f.filter((x) => !o.f!.includes(x)).forEach((x) => (x in pv ? (v[x] = pv[x]) : delete v[x]));
            o.v = v;
          }
          if (fl) o.f = fl;
          else delete o.f;
        }
        if (o.lst) {
          if (Array.isArray(p.v)) o.v = applyListEdit((p.v as unknown[]).map(String), o.lst); // that tab's list + ours
          const le = mergeListEdits(p, o.lst);
          if (le) o.lst = le;
          else delete o.lst;
        }
      });
      return ops.filter((x) => !byK.has(x.k) || drop.has(x.k)).concat([...byK.values()].filter((o) => !drop.has(o.k)));
    }).then(() => drop.forEach((k) => byK.get(k) && this.pending.get(k) === byK.get(k) && this.pending.delete(k))).catch(() => {
      if (this.teamCfg === cfg) byK.forEach((o) => this.keepUnsaved(o));
    });
  }
  /** A queued change (v === undefined → delete); `t` orders this browser's changes to one record. */
  private opTick() {
    return (this.opT = Math.max(Date.now(), this.opT + 1));
  }
  /** `t` is shared by a burst (seeding, re-queue) so this tab's clock never runs ahead of real time. */
  private mkOp(k: string, v?: unknown, t = this.opTick()): SyncOp {
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
  private wasDelivered(o: SyncOp) {
    const d = this.delivered.get(o.k);
    return !!d && (d.id === o.id || !newer(o, d));
  }
  /** This browser's shared records as stored (every tab saves there); this tab's copy if unreadable. */
  private async storedShared(): Promise<SharedState> {
    const [crm, contacts, dec, sales, custom] = await Promise.all([
      this.store.get<Partial<Crm>>('crm'),
      this.store.get<Record<string, ContactEdit>>('contacts'),
      this.store.get<Record<string, string>>('dedup'),
      this.store.get<SalesState>('sales'),
      this.store.get<Record<string, CustomCo>>('customCos'),
    ]);
    // where this tab's own last save failed, the stored copy is older than this tab's: use this tab's
    const ok = (k: string, v: unknown) => !!v && !this.unstored.has(k);
    return {
      crm: ok('crm', crm) ? { ...emptyCrm(), ...crm } : this.crm,
      contacts: ok('contacts', contacts) ? contacts! : this.contacts,
      dec: ok('dedup', dec) ? dec! : this.dec,
      sales: ok('sales', sales) ? sales! : this.sales,
      custom: ok('customCos', custom) ? custom! : this.custom,
    };
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
      if (s.seeded === false && cfg.seeded) {
        cfg.seeded = false; // another tab imported a backup or reconnected: seed again (harmless)
        this.seedGen++;
      }
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
        this.uploadDocs();
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
    const fresh = Array.isArray(stored) ? stored.filter((o) => !this.wasDelivered(o)) : null;
    this.pending = this.withUnsaved(fresh ? new Map(fresh.map((o) => [o.k, o])) : this.pending);
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
    // A push whose reply was lost (tab closed, timeout) may still have reached the sheet. An op sent
    // when the sheet was at seq S is settled once the sheet has a later row for its record: it was
    // either delivered, or someone changed the record after it was sent (the later change wins).
    const lastSeq = new Map(rows.map((r) => [r.k, r.seq]));
    // A field or list change is merged with a teammate's (rebaseOp), so a later row for the record only
    // settles it if it is this change's own row — else it is kept and merged, not lost.
    const own = (o: SyncOp) =>
      rows.some((r) => r.k === o.k && r.seq > o.sent! && r.by === String(o.by || '').slice(0, 100) && (o.del ? r.del : !r.del && JSON.stringify(r.v) === JSON.stringify(o.v)));
    const settled = (o: SyncOp) => o.sent != null && (lastSeq.get(o.k) ?? -1) > o.sent && (!(o.f || o.lst) || own(o));
    if ([...this.pending.values()].some(settled)) {
      this.pending.forEach((o, k) => settled(o) && this.pending.delete(k));
      this.unsaved.forEach((o, k) => settled(o) && this.unsaved.delete(k));
      await this.writePending(cfg.url, (ops) => ops.filter((o) => !settled(o))).catch(() => {});
      if (!live()) return;
    }
    let seeded = false;
    let sg = -1;
    const seedMerged: SyncRow[] = [];
    if (seeding) {
      // seed from what this browser has stored (shared by all tabs), not from this tab's copy,
      // which may be older than another tab's edits (e.g. a deletion made there before connecting)
      sg = this.seedGen; // an import after this read is not included in it
      const mine = await this.storedShared();
      if (!live()) return;
      const remote = new Map(rows.map((r) => [r.k, r]));
      const add: SyncOp[] = [];
      const t = this.opTick();
      localRecords(mine).forEach((v, k) => {
        if (this.pending.has(k)) return;
        const r = remote.get(k);
        if (!r) add.push(this.mkOp(k, v, t));
        else if (k.startsWith('scfg/') && Array.isArray(v) && Array.isArray(r.v) && !r.del) {
          // a list both have: add the items this browser added while it was not connected (not the
          // starting ones, nor items it got from the team earlier — the team may have removed them)
          const mineOff = (mine.sales?.offAdds || {})[k.slice(5) as keyof SalesCfg] || [];
          const extra = (v as string[]).filter((x) => !(r.v as string[]).includes(x) && mineOff.includes(x));
          if (extra.length) {
            const o = this.mkOp(k, [...(r.v as string[]), ...extra], t);
            o.lst = { add: extra, rm: [] }; // merges with a teammate's change to the list like any list edit
            add.push(o);
            seedMerged.push({ ...r, v: o.v });
          }
        }
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
    // A teammate changed a record this browser still has a queued change for: merge field by field
    // instead of pushing the stale copy over theirs, and let their deletion win over an edit (rebaseOp).
    const lastRow = new Map<string, SyncRow>();
    rows.forEach((r) => this.pending.has(r.k) && lastRow.set(r.k, r));
    const merged: SyncRow[] = [], dropped: SyncOp[] = [], revised = new Map<string, SyncOp>();
    // a deal the team deleted: notes and documents this browser queued for it are dropped too
    const lastDeal = new Map<string, SyncRow>();
    rows.forEach((r) => r.k.startsWith('deal/') && lastDeal.set(r.k.slice(5), r));
    const goneNow = new Set([...lastDeal].filter(([, r]) => r.del || r.v == null).map(([id]) => id));
    this.pending.forEach((o, k) => {
      const m = /^(dstep|ddoc)\/([^/]+)\//.exec(k);
      if (m && goneNow.has(m[2]) && !o.del && !lastRow.has(k) && !this.pendingDealAlive(m[2])) dropped.push(o);
    });
    lastRow.forEach((r, k) => {
      const q = this.pending.get(k)!;
      // this browser deletes a document a teammate just gave a Drive file: that file goes too
      if (q.del && k.startsWith('ddoc/') && !r.del && (r.v as DealDoc | null)?.fileId) this.dropDriveFile((r.v as DealDoc).fileId);
    });
    lastRow.forEach((r, k) => {
      const o = this.pending.get(k)!;
      const res = rebaseOp(r, o);
      if (!res) return;
      if ('drop' in res) dropped.push(o);
      else {
        revised.set(k, { ...o, v: res.v });
        merged.push({ ...r, v: res.v, del: false });
      }
    });
    if (dropped.length || revised.size) {
      dropped.forEach((o) => (this.pending.delete(o.k), this.unsaved.delete(o.k)));
      revised.forEach((n, k) => {
        this.pending.set(k, n);
        if (this.unsaved.has(k)) this.unsaved.set(k, n);
      });
      const gone = new Set(dropped.map((o) => o.id));
      await this.writePending(cfg.url, (ops) => ops.filter((x) => !gone.has(x.id)).map((x) => (revised.get(x.k)?.id === x.id ? revised.get(x.k)! : x))).catch(() => {});
      if (!live()) return;
      // a document deleted by a teammate while this browser was uploading its file: the file goes too
      dropped.forEach((o) => {
        const doc = o.k.startsWith('ddoc/') ? (o.v as DealDoc | undefined) : undefined;
        if (doc?.fileId) this.dropDocFile(doc);
      });
    }
    this.applyRows(rows.filter((r) => !this.pending.has(r.k)).concat(merged, seedMerged));
    cfg.seq = since;
    // only a round that seeded may mark the session seeded, not while part of the upload exists only
    // in memory, and not if an import asked for a new seed after this round read the data
    if (seeding && seeded && sg === this.seedGen && !this.unsaved.size) {
      cfg.seeded = true;
      if (this.sales.offAdds) {
        delete this.sales.offAdds; // shared now
        this.store.update<SalesState>('sales', (cur) => (cur ? (delete cur.offAdds, cur) : this.sales)).catch(() => {});
      }
    }
    if (!this.adoptTeamPrefs() || !live()) return;
    this.saveTeamCfg(cfg);
    let rejected = 0;
    while (this.pending.size && live()) {
      const batch = [...this.pending.values()].slice(0, 300);
      // remember the sheet's position when sending, to recognise a delivery whose reply is lost
      const at = cfg.seq;
      const ids = new Set(batch.map((o) => o.id));
      batch.forEach((o) => (o.sent = at));
      await this.writePending(cfg.url, (ops) => ops.map((x) => (ids.has(x.id) ? { ...x, sent: at } : x))).catch(() => {});
      if (!live()) return;
      let r: { rejected?: string[] };
      try {
        r = await call<{ rejected?: string[] }>(this.transport, cfg.url, cfg.key, { action: 'push', ops: batch.map(({ k, v, del, by }) => ({ k, v, del, by })) });
      } catch (e) {
        // the sheet answered and refused (busy, wrong code): these were certainly not delivered
        if (e instanceof TeamSyncError && e.code) {
          batch.forEach((o) => delete o.sent);
          await this.writePending(cfg.url, (ops) => ops.map((x) => (ids.has(x.id) ? (({ sent: _s, ...y }) => y)(x) : x))).catch(() => {});
        }
        throw e;
      }
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
      const left = await this.writePending(cfg.url, (ops) => ops.filter((o) => !done(o) && !this.wasDelivered(o))).then(
        (l) => {
          this.delivered.clear(); // the stored queue no longer lists them
          return l;
        },
        () => {
          batch.forEach((o) => {
            const d = this.delivered.get(o.k);
            if (!d || newer(o, d)) this.delivered.set(o.k, o);
          });
          return null;
        },
      );
      if (!live()) return;
      this.pending = this.withUnsaved(new Map((left || [...this.pending.values()].filter((o) => !done(o))).map((o) => [o.k, o])));
    }
    if (seeding && !cfg.seeded && sg === this.seedGen && live()) {
      cfg.seeded = true; // everything local was pushed from memory
      this.saveTeamCfg(cfg);
    }
    if (rejected) throw new Error(`มี ${fmtN(rejected)} รายการยาวเกินกว่าที่ชีตเก็บได้ จึงไม่ได้แชร์ (เก็บไว้ในเครื่องนี้)`);
  }

  /** Apply pulled rows (oldest first) and refresh whatever they affect. */
  private applyRows(rows: SyncRow[]) {
    if (!rows.length) return;
    const fx = noEffects();
    // a teammate deleted a document: its Drive file goes (whoever deleted it may not have known the
    // file yet) and so does this browser's copy of it
    const delDocs = rows.filter((r) => (r.del || r.v == null) && r.k.startsWith('ddoc/')).map((r) => this.sales.docs[r.k.slice(5)]).filter(Boolean);
    rows.forEach((r) => applyRow(this, r, fx));
    delDocs.forEach((doc) => !this.sales.docs[`${doc.deal}/${doc.id}`] && this.dropDocFile(doc));
    // a teammate deleted a deal: the notes and documents this browser has for it go too — also those
    // the teammate had not seen yet (added here meanwhile), which would otherwise be left orphaned
    const goneDeals = rows.filter((r) => (r.del || r.v == null) && r.k.startsWith('deal/') && !this.sales.deals[r.k.slice(5)]).map((r) => r.k.slice(5));
    if (goneDeals.length)
      this.batchOps(() =>
        goneDeals.forEach((id) => {
          Object.keys(this.sales.steps).forEach((k) => {
            if (!k.startsWith(id + '/')) return;
            delete this.sales.steps[k];
            this.op('dstep/' + k);
          });
          Object.entries(this.sales.docs).forEach(([k, doc]) => {
            if (doc.deal !== id) return;
            delete this.sales.docs[k];
            this.op('ddoc/' + k);
            this.dropDocFile(doc);
          });
          fx.sales = true;
        }),
      );
    // Save by applying the same rows to what is stored rather than writing this tab's whole copy:
    // another tab may have stored records this tab has never seen (e.g. local-only TGO companies).
    const merged = (s: SharedState) => {
      rows.forEach((r) => applyRow(s, r, noEffects()));
      return s;
    };
    const none = { crm: emptyCrm(), contacts: {}, dec: {}, sales: emptySales(), custom: {} };
    if (fx.crm) this.store.update<Partial<Crm>>('crm', (cur) => (cur ? merged({ ...none, crm: { ...emptyCrm(), ...cur } }).crm : this.crm)).catch(() => {});
    if (fx.contacts.size || fx.contactDel)
      this.store.update<Record<string, ContactEdit>>('contacts', (cur) => (cur ? merged({ ...none, contacts: cur }).contacts : this.contacts)).catch(() => {});
    if (fx.dedup) this.store.update<Record<string, string>>('dedup', (cur) => (cur ? merged({ ...none, dec: cur }).dec : this.dec)).catch(() => {});
    if (fx.sales)
      this.store.update<SalesState>('sales', (cur) => (cur ? merged({ ...none, sales: { ...emptySales(), ...cur, cfg: { ...emptyCfg(), ...cur.cfg } } }).sales : this.sales)).catch(() => {});
    if (fx.custom) this.store.update<Record<string, CustomCo>>('customCos', (cur) => (cur ? merged({ ...none, custom: cur }).custom : this.custom)).catch(() => {});
    if (fx.dedup || fx.contactDel || fx.custom) {
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
    const carried = [...this.carry.values()]; // unsent changes that could not be stored
    this.carry = new Map();
    const local = localRecords(await this.storedShared());
    const t = this.opTick();
    const requeue = (cur: SyncOp[]) =>
      [...new Map([...moved, ...carried, ...cur].map((o) => [o.k, o])).values()].map((p) => {
        const o = this.mkOp(p.k, local.get(p.k), t);
        if (o.v !== undefined && p.f && !p.del) o.f = p.f; // still only those fields of ours
        if (o.v !== undefined && p.lst && !p.del) o.lst = p.lst;
        if (o.v !== undefined && p.nx && !p.del) o.nx = true; // still only filling a gap
        if (p.base !== undefined) o.base = p.base; // still only over what was seen there
        return o;
      });
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
    this.unsaved.forEach((o, k) => this.carry.set(k, o));
    this.unsaved = new Map();
    this.delivered = new Map();
    this.teamNeedKey = false;
    this.teamFiles = null;
    this.docRetryAt = this.docFails = 0;
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
    downloadBlob(new Blob([this.registryCsv(view, out)], { type: 'text/csv;charset=utf-8' }), `GCC_${view === 'cert' ? 'ใบรับรอง' : 'บริษัท'}_${out.length}.csv`);
  }
  registryCsv(view: 'co' | 'cert', out: (Company | Cert)[]) {
    const D = this.B.D, CD = this.B.CD;
    // same cells as the tracker export: text can't run as a formula (names typed by teammates), and
    // juristic ids / phone numbers keep their leading 0
    let H: string[], L: unknown[][], keep0: number[];
    if (view === 'cert') {
      H = ['เลขที่ใบรับรอง', 'องค์กร', 'กิจกรรม', 'จังหวัด', 'วันที่อนุมัติ', 'วันหมดอายุ', 'สถานะ', 'รอบที่ต้องยื่น', 'รหัสบริษัท', 'โทรศัพท์บริษัท'];
      L = (out as Cert[]).map((ct) => [ct.cert, ct.org, ct.act, ct.provTxt || CD.prov[ct.prov], ct.ap, ct.ex, CST[ct.st][0], ct.isLatest ? ct.co!.rnd : '', ct.co!.code, ct.co!.phone]);
      keep0 = [9];
    } else {
      H = ['รหัส', 'ชื่อบริษัท', 'เลขนิติบุคคล', 'ประเภท', 'จังหวัด', 'ที่อยู่', 'กลุ่มอุตสาหกรรม', 'กิจการ', 'แหล่งข้อมูล', 'กลุ่มเป้าหมาย', 'สถานะ CFO', 'CFO หมดอายุล่าสุด', 'รอบที่ต้องยื่น', 'GI ระดับที่ยังใช้ได้', 'GI ใช้ได้ถึง', 'โรงงานใหม่ เริ่ม', 'เงินลงทุนโรงงานใหม่', 'SET', 'โทรศัพท์', 'อีเมล', 'เว็บไซต์', 'สถานะการขาย', 'รวมจากรหัส'];
      L = (out as Company[]).map((c) => [
        c.code, c.name, c.jur, D.type[c.type], D.prov[c.prov], c.addr, D.ind[c.ind], c.biz, tagsOf(c.src).map((t) => t.t).join(' '),
        c.tgt + 1 + '. ' + TGT[c.tgt], CST[c.cfoSt][0], c.cfoEx, c.rnd, c.giLive, c.giUntil, c.newYm, c.invest, c.set, c.phone, c.email, c.web,
        (STG.find((x) => x[0] === this.stage(c.id)) || STG[0])[1], c.ids.length > 1 ? c.ids.map(gccCode).join(' ') : '',
      ]);
      keep0 = [2, 18];
    }
    return '\ufeff' + [H.map(csvCell).join(',')].concat(L.map((r) => r.map((v, i) => (keep0.includes(i) ? csvPhone(v) : csvCell(v))).join(','))).join('\r\n');
  }
}
