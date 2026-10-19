/**
 * GccEngine — the app's data model. Holds the dataset, dedup decisions, CRM records and
 * monitor/sync state; recomputes statuses for the reference date; persists through
 * storage.ts. React subscribes via `subscribe` / `getVersion` (useSyncExternalStore).
 */
import type {
  Built, Cert, Company, ContactEdit, ContactForm, Crm, CustomCo, Person, Dataset, FeedKey, LogEntry, MonitorCfg, RawCompany, Round, RoundRaw,
  SetSnap, StageKey, SyncCfg, Task, TaskForm, TaskType,
} from './types';
import { build, dataUrl, getDetail, loadBase, norm, parseXlsx, readXlsxRows, status, type ParsedUpload } from './core';
import { CONFIG, STG, TGT, tagsOf, CST } from './constants';
import { DAY, addDays, downloadBlob, dtTh, fmtN, gccCode, isoTh, nextWork, pad, todayISO, uid } from './format';
import { kv, prefs, PREF, type KVStore } from './storage';
import * as TGOSync from './tgoSync';
import { NOTE_CAP, PERSON_FIELDS, personSuggestions, toPerson, type PersonForm } from './people';
import {
  CUSTOM_ID_MIN, TeamSyncError, applyRow, codeError, isLocalId, call, errText, fetchTransport, hello, isLocalOnly, isTeamUrl, keyOf, legacyLogId, localRecords, mergeFields, mergeFieldLists, mergeListEdits, applyListEdit, withFields, noEffects, opId, rebaseOp, uniqueTaskIds, type ListEdit,
  parseMe, type Caps, type Cred, type Role, type Session, type SharedState, type SyncOp, type SyncRow, type TeamCfg, type TeamState, type Transport,
} from './teamSync';
import { derivePk, normUser, tempPassword } from './auth';
import {
  BUILTIN, CAPS, can as capCan, canWriteKey as capWrite, capsOf, hasWrite, isBuiltin, keyRule, lateUnknown, parseAudit, parseGrants, parseReqs, parseRoles, sameName, roleWire,
  type AuditRow, type CapAsk, type CapDef, type CapId, type CapSet, type Grants, type ReqPending, type RoleDef,
} from './caps';
import {
  ACT_TH, HOW_TH, KIND_TH, NOTE_MAX, PLAN_FIELDS, PLAN_MAX, actStage, attachStage, beYear, closeReady, countedAt, countsActual, isExtraPay, isPayStage, planOf, planStart, csvCell, csvPhone, dealMoney, decodeTrackerText, docsOf, lastContact, paidNote, payDue, payState, payStageFor, planCsv, planLines, splitAmounts,
  toAct, toCust, toDeal, toDoc, toLog, toPay, toStep, dealStatus, emptyCfg, emptySales, fmtMoney, importId, importKey, matchSource, newDeal, parseCsv, parseTrackerJson, parseTrackerSheet, stepOf,
  type ActType, type Deal, type DealAct, type DealDoc, type DealLog, type DealStep, type DocKind, type DocTarget, type PayHow, type PayLine, type PlanInput, type SalesCfg, type SalesState, type TrackerData,
} from './sales';
import { cashYear, setMoneyHidden, type CashLine } from './sales';
import { purgeExpenses, toExpense } from './expense';
import { NAME_MAX, freeSlot, isUnitId, newUnitId, paysComm, shareValid, slotTaken, staffKey, toShare, toUnit, toUnitMember, unitCtx, unitWire, withOff, withRate, type ShareLine, type UnitCtx, type UnitRec } from './contrib';
import { cashCsv, cashRows, type CashCsvMode } from './cashUi';
import { DOC_MAX_BYTES, deleteDocFile, docMime, downloadDocFile, fileErrText, fileFetchTransport, scriptSupportsFiles, uploadDocFile } from './teamFiles';
import { isQtVersion, qtFacts, qtPrev, qtVersions } from './quotes';
// joint quotations (package quotes, item 7)
import { QUOTE_STAGE, jointHeadOf, jointOf, jointRole, toJqm, toJqt, type JointGroup } from './sales';
import { canMergeFrom, isJointNote, jointNo, jointNote, jointTitle, rowFate, shareOf, type JointNew, type JointPick } from './joint';
import {
  QT_NOTE_MAX, fpOf, myNotify0, needsCheck, parseMyNotify, parseNotifyCfg, parseNotifyFlag, parseNotifyStatus, qtCheckOf, toQtCheck,
  type MyNotify, type NotifyCfg, type NotifyLive, type NotifyStatus, type QtCheck, type QtCheckView, type Scope,
} from './notify';
import { PAY_NOTE_MAX, canClose, canUndo, closeRecord, lineLabel, parsePayChkCfg, splitKey, teamMonth, toMonthClose, toPayCheck, ymTh, type ChkRow, type MonthClose, type PayCheck, type PayChkCfg } from './payCheck';
// the month check of money out (job expenses in the money views)
import { expTeamMonth, expWhat, rowWhat, type XRow } from './expenseMoney';

/** Each sheet (web-app URL) has its own queue, so switching sheets or a tab still on another sheet
 *  can never drop or mix up another sheet's unsent changes. */
const pendKey = (url: string) => 'teamPending:' + url;
/** The accounts that have signed in on this browser, per sheet ({u, name}[]): on a shared computer,
 *  whose unsent edits and documents are whose. */
const acctKey = (url: string) => 'teamAccts:' + url;
const CODE_AGAIN = 'สคริปต์ของทีมกลับไปใช้รหัสทีม — ใส่รหัสทีมเพื่อซิงก์ต่อ';
/** Longest free text (notes) shared through the sheet; one cell holds 50,000 characters. */
const TEXT_MAX = 5000;
/** Whether queued change `a` is at least as recent as `b` (same record). */
const newer = (a: SyncOp, b: SyncOp) => (a.t || 0) >= (b.t || 0);
/** One op per record, the newest. */
const newestPerKey = (ops: SyncOp[]) => {
  const m = new Map<string, SyncOp>();
  ops.forEach((o) => {
    const p = m.get(o.k);
    if (!p || newer(o, p)) m.set(o.k, o);
  });
  return [...m.values()];
};
/** The script's answer to login / claim. */
interface SignIn extends Record<string, unknown> { tok: string; exp: number; me: { u: string; name: string; role: Role } & Record<string, unknown>; mc?: boolean }
/** An account as the admin page lists it. `role` is the account's role id (a script with configurable
 *  roles may name one an admin made); `em` / `ok` its notification e-mail and whether it is verified
 *  (Code.gs v4 with notifications; left out by older scripts). */
/** An account as the admin page reads it; `notify` = its e-mail settings (a script with notifications). */
export interface TeamUser { u: string; name: string; role: Role; on: number | boolean; mc: boolean; ll: string; c: string; locked?: number; em?: string; ok?: number | boolean; notify?: unknown }
/** Everything the admin page reads in one `users` call. `v4`: the script has configurable roles (it sent
 *  its roles); an older one sends only the accounts, and the built-in roles stand in. */
export interface TeamDir { users: TeamUser[]; roles: RoleDef[]; grants: Record<string, Grants>; reqs: Record<string, ReqPending>; audit: AuditRow[]; v4: boolean }
/** What a request asks for (req_send). */
export interface ReqInput { k: 'role' | 'caps'; role?: string; caps?: CapAsk[]; note: string; until?: string }
/** A script that does not know an action yet (deployed before configurable roles). */
const OLD_SCRIPT = 'สคริปต์ของทีมยังไม่รองรับบทบาทและคำขอสิทธิ์ — ให้ผู้ดูแลระบบอัปเดต Code.gs แล้ว Deploy เวอร์ชันใหม่';
/** The same for the notification actions (qt_check, notify_*). */
const OLD_NOTIFY = 'สคริปต์ของทีมยังไม่รองรับการแจ้งเตือนและการตรวจใบเสนอราคา — ให้ผู้ดูแลระบบอัปเดต Code.gs ตามขั้นตอนในหน้า ผู้ใช้และสิทธิ์ › การแจ้งเตือน';
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
  /** Contact persons at customer companies (people.ts), shared with the team. */
  people: Record<string, Person> = {};

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

  // ---- team accounts (Code.gs v3; see lib/auth.ts)
  /** The account signed in on this browser for the connected team (PREF.session), if it uses accounts. */
  session: Session | null = null;
  /** What the team script at `caps.url` supports (from `hello`). */
  caps: (Caps & { url: string }) | null = null;
  /** The team this site belongs to (CONFIG.teamUrl): a browser not connected yet opens on its gate,
   *  and one stored with another link of it moves to this one. '' = none (any team, or none). */
  homeTeam = CONFIG.teamUrl;
  /** A screen in front of the app: checking the home team (`authMsg`: why it can't be reached), sign
   *  in, first-admin setup, set your password, session expired, account disabled; '' = none.
   *  `authUrl` is the team it is for. */
  auth: '' | 'connect' | 'login' | 'setup' | 'change' | 'expired' | 'disabled' = '';
  authUrl = '';
  /** A notice for the sign-in screen (e.g. "you signed out"). */
  authMsg = '';
  /** A notice about team sync for this account (changes it may not make, unsent edits). */
  teamNote = '';
  /** Records this account changed but may not: put back to the team's value by the next round. */
  private revert = new Set<string>();
  /** Records another account of this browser made and has not sent yet: the next round takes them
   *  out of this account's view (they stay queued for their owner). */
  private hidden = new Set<string>();
  /** The other accounts that have signed in on this browser for the connected team (read by each
   *  session's first round, see acctsRead). */
  private others: { u: string; name: string }[] = [];
  private acctsRead = new WeakSet<TeamCfg>();
  /** PREF.wipe as this page last saw it (another tab's sign-out that wiped the team data). */
  private wipeRaw = '';
  /** While load() runs: settles when it ends. */
  private loadEnd: Promise<void> | null = null;
  /** An older link of the site whose queues this page could not move (stays PREF.teamLast, so the
   *  next load moves them). */
  private unmoved = '';
  /** When `caps` was last asked for (a team-code team's lead may update the script meanwhile). */
  private capsAt = 0;
  /** PREF.session as last read or written by this tab (to notice other tabs signing in and out). */
  private sessionRaw = '';
  /** The temporary password typed at sign-in, kept in memory until the new one is set (must-change). */
  private lastPw = '';
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
    if (e.key === PREF.wipe) {
      if (typeof location !== 'undefined') location.reload(); // another tab signed out and wiped the team data
      return;
    }
    if (e.key === PREF.session || e.key === null) this.adoptSession();
    if (e.key !== PREF.team && e.key !== null) return;
    this.adoptTeamPrefs();
    if (this.teamCfg && this.team.status === 'error') this.teamSync(); // e.g. a new code entered in another tab
  };
  /** Storage events are not delivered to a page kept in the back/forward cache: catch up with what
   *  other tabs did meanwhile (a sign-out, with or without wiping the team data, a new setting). */
  private teamPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    if (prefs.getRaw(PREF.wipe) !== this.wipeRaw && typeof location !== 'undefined') return location.reload();
    this.adoptSession();
    this.adoptTeamPrefs();
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit() {
    // a session without ดูยอดเงิน works nothing out from the amounts it never received (lib/sales.ts)
    setMoneyHidden(this.sales, !this.can('view.money'));
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
    let end = () => {};
    this.loadEnd = new Promise<void>((r) => (end = r));
    try {
      this.wipeRaw = prefs.getRaw(PREF.wipe);
      this.teamRaw = prefs.getRaw(PREF.team);
      let team0 = prefs.get<TeamCfg | null>(PREF.team, null);
      const home = this.homeTeam;
      // the site's own team stored with another of its links (an older deployment): moved below
      const from = home && team0 && team0.url && team0.url !== home ? team0.url : '';
      // an older link with no team stored for it (left on the old site, unsent edits staying queued
      // under it) or one a move could not store: its queues move too, before the gate's answer makes
      // the home link the last one and nothing reads them again
      const last = prefs.getRaw(PREF.teamLast);
      const left = home && !from && last && last !== home ? last : '';
      // a team with accounts: the session signed in on this browser, if it can still be used (one not
      // remembered ends 12 h after sign-in, for a shared computer); otherwise the sign-in screen
      this.sessionRaw = prefs.getRaw(PREF.session);
      const s0 = prefs.get<Session | null>(PREF.session, null);
      let acct: Session | null = null;
      if (team0 && team0.url && team0.mode === 'accounts') {
        if (s0 && s0.url === team0.url && s0.u && (s0.rm || s0.exp > Date.now())) {
          acct = s0;
          if (!s0.tok) this.auth = 'expired'; // signed out by the script: sign in again over the app
          else if (s0.mc) {
            // a password to set: its screen from the first frame (with the name it greets), not the app
            this.auth = 'change';
            this.session = s0;
          }
        } else {
          if (s0) this.saveSession(null);
          this.authUrl = from ? home : team0.url;
          this.auth = 'login';
        }
        this.emit(); // the sign-in screen shows while the data loads
      } else if (home && !(team0 && team0.url)) {
        // a browser not connected yet: nothing but the gate until the home team answers (sign in,
        // first-admin setup, or the app with the team-code form); asked while the data loads
        this.auth = 'connect';
        this.authUrl = home;
        this.emit();
      }
      if (from) {
        // the same script (and sheet) under the built-in link: the queues move first, then the stored
        // settings, so a page closed halfway moves again at its next load
        if (await this.moveTeam(from, home, acct?.u || '')) {
          team0 = { ...team0!, url: home };
          if (acct) this.saveSession((acct = { ...acct, url: home }));
          if (this.session === s0) this.session = acct;
          this.saveTeamCfg(team0);
        } else if (this.authUrl === home) this.authUrl = from;
      } else if (left) {
        if (await this.moveTeam(left, home, acct?.u || '')) prefs.set(PREF.teamLast, home);
        else this.unmoved = left; // stays the last link (saveTeamCfg): moved at the next load
      }
      if (this.auth === 'connect') this.teamRetry();
      const signN = this.sessionN; // a sign-in finished during the load wins over what was read here
      const queue = team0 && team0.url ? (team0.mode === 'accounts' ? (acct ? pendKey(team0.url) + '#' + acct.u : '') : pendKey(team0.url)) : '';
      const [base, dec, contacts, crm, added, tgoCerts, setSnap, R, sources, pending, sales, custom, people] = await Promise.all([
        loadBase(),
        this.store.get<Record<string, string>>('dedup'),
        this.store.get<Record<string, ContactEdit>>('contacts'),
        this.store.get<Partial<Crm>>('crm'),
        this.store.get<Partial<RawCompany>[]>('addedCos'),
        this.store.get<Partial<Cert>[]>('tgoCerts'),
        this.store.get<SetSnap>('setSnap'),
        fetch(dataUrl('rounds.json')).then((r) => r.json()).catch(() => []) as Promise<RoundRaw[]>,
        fetch(dataUrl('gcc-sources.json')).then((r) => r.json()).catch(() => []) as Promise<unknown[][]>,
        queue ? this.store.get<SyncOp[]>(queue) : null,
        this.store.get<Partial<SalesState>>('sales'),
        this.store.get<Record<string, CustomCo>>('customCos'),
        this.store.get<Record<string, Person>>('people'),
      ]);
      this.people = people || {};
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
      if (signN === this.sessionN) {
        this.teamCfg = team0 && team0.url && (team0.mode !== 'accounts' || acct) ? { ...team0, seq: 0, ...(acct ? { u: acct.u } : {}) } : null;
        if (acct) {
          this.session = acct;
          if (acct.mc) this.auth = 'change';
        }
        if (this.teamCfg && Array.isArray(pending)) pending.forEach((op) => this.pending.set(op.k, op));
      }
      if (this.teamCfg && renamed) this.teamCfg.seeded = false; // upload the renamed tasks
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
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', this.teamPrefsChanged);
        window.addEventListener('pageshow', this.teamPageShow);
      }
      // another tab may have connected, disconnected, signed in or out, or wiped this browser's team
      // data while this one loaded (before the listener): follow it before syncing as what was read above
      if (prefs.getRaw(PREF.wipe) !== this.wipeRaw && typeof location !== 'undefined') return location.reload();
      this.adoptSession();
      this.adoptTeamPrefs();
      if (this.teamCfg && !this.auth && !this.teamTimer) this.startTeam();
      // the sign-in screen of a team with accounts: its script may have gone back to the team code
      if (team0?.url && team0.mode === 'accounts' && (this.auth === 'login' || this.auth === 'expired')) this.checkCode(team0.url);
    } catch (e) {
      this.loadMsg = 'โหลดข้อมูลไม่สำเร็จ: ' + ((e as Error)?.message || e);
      this.emit();
    } finally {
      this.loadEnd = null;
      end();
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
    if (!this.can('set.dedup')) return this.deny();
    if (v == null) delete this.dec[key];
    else this.dec[key] = v;
    this.op(keyOf.dedup(key), v ?? undefined);
    this.persist('dedup', this.dec);
    this.rebuild();
    this.emit();
  }

  // ------------------------------------------------------------------ CRM
  /** Who is using this browser: the signed-in account's name when the team uses accounts (the
   *  same string as in owners, ผู้รับผิดชอบ and history), else the name chosen at "ฉันคือ". */
  me() {
    return this.teamCfg?.mode === 'accounts' || this.auth ? this.session?.name || '' : prefs.getRaw(PREF.me);
  }
  setMe(v: string) {
    if (this.teamCfg?.mode === 'accounts') return; // the account says who it is
    prefs.set(PREF.me, v);
    this.emit();
  }
  /** The signed-in account's role (the built-in word the script reports: admin / sales / viewer), or
   *  null when the team has no accounts (team code, or this browser only): then everything is allowed,
   *  as before accounts. What the account may do is caps(). */
  role(): Role | null {
    return this.teamCfg?.mode === 'accounts' && this.session ? this.session.role : null;
  }
  /** What the signed-in account may do (lib/caps.ts); null = no accounts: everything. From a script that
   *  sends no capabilities (deployed before roles became configurable): the built-in caps of its role. */
  myCaps(): CapSet | null {
    return this.role() == null ? null : capsOf(this.session);
  }
  /** The account's role name: the one the script sent, a built-in's, or the id. */
  roleName(): string {
    const s = this.session;
    if (!s) return '';
    const id = s.rid || s.role;
    return s.rn || (isBuiltin(id) ? BUILTIN[id].n : id);
  }
  /** The script sent capabilities (configurable roles and permission requests are there). */
  get rolesLive() {
    return !!this.session?.caps;
  }
  /** The team's roles as last read (teamRoles, or the admin page): names for request lines. */
  knownRoles: RoleDef[] = parseRoles(null);
  /** A role's name by id (a role read from the script, a built-in, else the id itself). */
  roleNameOf = (id: string) => this.knownRoles.find((r) => r.id === id)?.n || (isBuiltin(id) ? BUILTIN[id].n : id);
  /** Every role and what it lets people do (the request dialog, สิทธิ์ของฉัน): read through `me`, which a
   *  script with configurable roles answers with its roles; an older one: the built-in three. */
  async teamRoles(): Promise<RoleDef[]> {
    const r = await this.adminCall<Record<string, unknown>>({ action: 'me' });
    this.knownRoles = parseRoles(r.roles);
    this.noteRoles(r.roles);
    this.emit();
    return this.knownRoles;
  }
  /** Capabilities of this build the team script does not know (lateUnknown), from the last roles it sent. */
  private lateOff: CapId[] = [];
  private noteRoles(x: unknown) {
    if (x && typeof x === 'object') this.lateOff = lateUnknown(x);
  }
  /** The capabilities the role editor, extras, requests and สิทธิ์ของฉัน offer: the catalogue, less any the
   *  team script would refuse ('bad_cap': a script with roles deployed before job expenses). */
  capsShown(): CapDef[] {
    return this.lateOff.length ? CAPS.filter((c) => !this.lateOff.includes(c.id)) : CAPS;
  }
  /**
   * May this account do `cap`? `owner`: whose record it is (a deal's ผู้รับผิดชอบ, a record's writer),
   * for a capability held only for its own work; left out, any scope counts (show the control at all).
   */
  can(cap: CapId, owner?: string) {
    return capCan(this.myCaps(), cap, owner === undefined ? undefined : sameName(owner, this.me()));
  }
  /** `can` for a deal: its ผู้รับผิดชอบ decides an `own` scope. */
  canDeal(cap: CapId, d: Pick<Deal, 'resp'> | null | undefined) {
    return this.can(cap, d ? d.resp || '' : undefined);
  }
  /** May this account attach or change a deal's quotation (แนบเอกสาร)? A quotation moves the deal's
   *  Forecast: an account whose ดีลและขั้นตอน covers its own work only does it on its own deals only (one
   *  without ดีลและขั้นตอน at all, e.g. บัญชี, by แนบเอกสาร alone). */
  canQuote(d: Pick<Deal, 'resp'>) {
    return this.can('docs.up') && (this.myCaps()?.['edit.deal'] !== 'own' || this.canDeal('edit.deal', d));
  }
  /** The account can send changes at all (a view-only one sends nothing). */
  canWrite() {
    return hasWrite(this.myCaps());
  }
  /** May this account write (or delete) record `k`? An `own` capability looks at the record's owner: the
   *  deal's ผู้รับผิดชอบ (here and in the new value), or who wrote the record. */
  canWriteKey(k: string, del: boolean, v?: unknown) {
    const caps = this.myCaps();
    if (caps == null) return true;
    const rule = keyRule(k, del);
    let own: boolean | undefined;
    if (rule && rule !== 'never' && rule.own) {
      const me = this.me();
      const [type, id, rest] = k.split('/');
      if (rule.own === 'resp') {
        // the script also wants the deal to have been the account's before the push this goes in (Code.gs
        // opGate_): a deal taken over and written to before one push is refused there (denied → team value)
        const d = this.sales.deals[id];
        const nv = type === 'deal' && v && typeof v === 'object' ? (v as { resp?: string }).resp : undefined;
        own = !!d && sameName(d.resp, me) && (type !== 'deal' || del || sameName(nv ?? d.resp, me));
      } else {
        const by = type === 'log' ? (this.crm.log[id] || []).find((x) => x.id === rest)?.by : type === 'dact' ? this.sales.acts?.[`${id}/${rest}`]?.by : undefined;
        own = sameName(by, me);
      }
    }
    return capWrite(caps, k, del, own);
  }
  /** A change this account may not make: nothing happens, and it is said why. */
  private deny() {
    this.teamNote = 'บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้';
    this.emit();
  }
  logAct(id: number | string, e: Omit<LogEntry, 'at' | 'by' | 'id'>) {
    const L = this.crm.log;
    const entry: LogEntry = { id: uid(), at: new Date().toISOString(), by: this.me(), ...e };
    entry.text = cap(entry.text);
    (L[id] || (L[id] = [])).push(entry);
    this.op(keyOf.log(id, entry.id!), { ...entry });
  }
  stage(id: number): StageKey {
    return this.crm.stages[id] || 'none';
  }
  /** `auto`: set by a logged call on a company with no stage — only if the team has no stage for it
   *  either (a teammate who moved it on meanwhile keeps theirs). */
  setStage(id: number, v: StageKey, auto = false) {
    const C = this.crm;
    if ((C.stages[id] || 'none') === v) return;
    C.stages[id] = v;
    this.op(keyOf.stage(id), v, { nx: auto });
    // an automatic stage may yield to a teammate's: the logged call that set it is the history
    if (!auto) this.logAct(id, { type: 'stage', text: 'เปลี่ยนสถานะการขายเป็น "' + (STG.find((x) => x[0] === v) || STG[0])[1] + '"' });
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
  /** `pid`: the person (ผู้ติดต่อ) it was with. */
  addLog(id: number, type: string, result: string, text: string, pid?: string) {
    if (!text && !result) return;
    this.logAct(id, { type, result, text, ...(pid ? { pid } : {}) });
    if (type !== 'note' && this.stage(id) === 'none') this.setStage(id, result === 'ไม่สนใจ' ? 'lost' : 'contacted', true);
    else this.saveCrm();
  }
  delLog(id: number | string, l: LogEntry) {
    // queued while the entry is still here: an "own" capability checks who wrote it (canWriteKey)
    if (l.id) this.op(keyOf.log(id, l.id));
    this.crm.log[id] = (this.crm.log[id] || []).filter((x) => x !== l);
    this.saveCrm();
  }
  addTeam(name: string) {
    if (!this.can('set.users')) return this.deny();
    const C = this.crm;
    if (name && !C.team.includes(name)) {
      C.team.push(name);
      this.op(keyOf.team(name), 1);
      if (!this.me()) prefs.set(PREF.me, name);
    }
    this.saveCrm();
  }
  delTeam(name: string) {
    if (!this.can('set.users')) return this.deny();
    this.crm.team = this.crm.team.filter((x) => x !== name);
    this.op(keyOf.team(name));
    this.saveCrm();
  }
  /** Save the contact form. Only the fields changed in it are written — over the values the form
   *  opened with (`init`), so a teammate's change to another field meanwhile is kept. */
  saveContact(c: Company, v: ContactForm, init?: ContactForm) {
    const x = this.contacts[c.id];
    const cur: ContactForm = x ? { phone: x.phone, email: x.email, web: x.web, note: x.note } : { phone: c.phone || '', email: c.email || '', web: c.web || '', note: '' };
    const nv: ContactForm = { ...v, note: cap(v.note) };
    const f = (['phone', 'email', 'web', 'note'] as const).filter((k) => nv[k] !== cur[k] && (!init || nv[k] !== init[k]));
    if (!f.length) return;
    const e: ContactEdit = { ...cur, ...Object.fromEntries(f.map((k) => [k, nv[k]])), at: new Date().toISOString() };
    this.contacts[c.id] = e;
    this.op(keyOf.contact(c.id), { ...e }, { f: [...f, 'at'] });
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
  /** Save the appointment form: only the fields changed in it (over the values it opened with,
   *  `init`), so a teammate's tick or reschedule meanwhile is kept. */
  updateTask(taskId: string, p: TaskForm, init?: TaskForm) {
    const t = this.crm.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const nv: TaskForm = { ...p, note: cap(p.note) };
    const f = (['type', 'date', 'time', 'note'] as const).filter((k) => nv[k] !== t[k] && (!init || nv[k] !== init[k]));
    if (!f.length) return;
    f.forEach((k) => Object.assign(t, { [k]: nv[k] }));
    this.op(keyOf.task(t.id), { ...t }, { f: [...f] });
    this.saveCrm();
  }
  /** Create one task per company; with `perDay` > 0 spread them across working days. */
  addTasks(ids: number[], p: { type: TaskType; date: string; time: string; note: string }, perDay = 0, pid?: string) {
    if (!this.can('edit.task')) return this.deny();
    let d = p.date, n = 0;
    ids.forEach((id) => {
      const c = this.company(id);
      if (perDay && n >= perDay) {
        d = nextWork(addDays(d, 1));
        n = 0;
      }
      if (perDay && n === 0) d = nextWork(d);
      n++;
      const t: Task = { id: uid(), gid: id, title: c ? c.name : String(id), type: p.type, date: d, time: p.time, note: cap(p.note), done: false, ...(pid ? { pid } : {}) };
      this.crm.tasks.push(t);
      this.op(keyOf.task(t.id), { ...t });
    });
    this.saveCrm();
  }
  autoPlan(list: Company[], perDay: number) {
    if (!this.can('edit.task')) return this.deny();
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
    this.op(keyOf.task(t.id), { ...t }, { f: ['done'] });
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
    if (!this.can('set.data')) return this.deny();
    const data = { kind: 'gcc-crm-backup', v: 1, at: new Date().toISOString(), by: this.me(), crm: this.crm, contacts: this.contacts, dedup: this.dec, sales: this.sales, custom: this.custom, people: this.people };
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'GCC_ข้อมูลทีม_' + todayISO() + '.json');
  }
  /** Merge a teammate's backup into local data — never deletes; newer contact edits win. */
  async importCrm(f: File) {
    if (!this.can('set.data')) return this.deny();
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
      Object.entries(IS.pays || {}).forEach(([k, v]) => {
        const l = toPay(v);
        if (l && k.indexOf('/') > 0 && !(k in S.pays)) S.pays[k] = l;
      });
      Object.entries(IS.acts || {}).forEach(([k, v]) => {
        const j = k.indexOf('/'), a = j > 0 ? toAct(v, k.slice(0, j), k.slice(j + 1)) : null;
        const A = S.acts || (S.acts = {});
        if (a && !(k in A)) A[k] = a;
      });
      Object.entries(IS.log || {}).forEach(([k, v]) => {
        const l = toLog(v, k);
        if (l && !(k in S.log)) S.log[k] = l;
      });
      // units, who is in which and the revenue splits (package dash), for those who may set them; rates and
      // splits only for those who may see commission (as the script would send them)
      if (this.can('set.units')) {
        const comm = this.can('view.comm');
        Object.entries((IS.units || {}) as Record<string, unknown>).forEach(([id, v]) => {
          const u = isUnitId(id) ? toUnit(v) : null;
          const U = S.units || (S.units = {});
          if (u && !(id in U)) U[id] = comm ? u : { ...u, rates: [] };
        });
        Object.entries((IS.unitm || {}) as Record<string, unknown>).forEach(([k, v]) => {
          const m = staffKey(k) === k ? toUnitMember(v) : null;
          const M = S.unitm || (S.unitm = {});
          if (m && !(k in M)) M[k] = m;
        });
      }
      if (this.can('edit.share') && this.can('view.comm'))
        Object.entries((IS.shares || {}) as Record<string, unknown>).forEach(([id, v]) => {
          const x = toShare(v);
          const D = S.shares || (S.shares = {});
          if (x && S.deals[id] && !(id in D)) D[id] = x;
        });
      // the month check's records (lib/payCheck.ts), checked like the rest
      Object.entries(IS.pchk || {}).forEach(([k, v]) => {
        const c = toPayCheck(v), P = S.pchk || (S.pchk = {});
        if (c && k.indexOf('/') > 0 && !(k in P)) P[k] = c;
      });
      Object.entries(IS.mclose || {}).forEach(([k, v]) => {
        const c = toMonthClose(v), M = S.mclose || (S.mclose = {});
        if (c && /^\d{4}-\d\d$/.test(k) && !(k in M)) M[k] = c;
      });
      // job expenses (lib/expense.ts), only for an account that sees them (as the script would send them)
      if (this.can('view.exp')) {
        Object.entries((IS.exp || {}) as Record<string, unknown>).forEach(([k, v]) => {
          const x = toExpense(v), E = S.exp || (S.exp = {}), j = k.indexOf('/');
          if (x && j > 0 && j < k.length - 1 && !k.includes('/', j + 1) && S.deals[k.slice(0, j)] && !(k in E)) E[k] = x;
        });
        Object.entries((IS.xchk || {}) as Record<string, unknown>).forEach(([k, v]) => {
          const c = toPayCheck(v), X = S.xchk || (S.xchk = {}), j = k.indexOf('/');
          if (c && j > 0 && j < k.length - 1 && !k.includes('/', j + 1) && !(k in X)) X[k] = c;
        });
        Object.entries((IS.mcloseOut || {}) as Record<string, unknown>).forEach(([k, v]) => {
          const c = toMonthClose(v), M = S.mcloseOut || (S.mcloseOut = {});
          if (c && /^\d{4}-\d\d$/.test(k) && !(k in M)) M[k] = c;
        });
      }
      // joint quotations: the header's mark and each membership (else the header turns into a plain customer
      // and the members' own typed figures count again); only for deals this browser has
      Object.entries(IS.jqt || {}).forEach(([k, v]) => {
        const q = toJqt(v), J = S.jqt || (S.jqt = {});
        if (q && !k.includes('/') && S.deals[k] && !(k in J)) J[k] = q;
      });
      Object.entries(IS.jqm || {}).forEach(([k, v]) => {
        const i = k.indexOf('/'), m = toJqm(v), J = S.jqm || (S.jqm = {});
        if (m && i > 0 && S.jqt?.[k.slice(0, i)] && S.deals[k.slice(i + 1)] && !(k in J)) J[k] = m;
      });
      Object.entries((d.custom || {}) as Record<string, unknown>).forEach(([k, v]) => {
        const c = toCust(v, +k);
        if (c && !this.custom[c.id]) {
          this.custom[c.id] = c;
          n++;
        }
      });
      Object.entries((d.people || {}) as Record<string, unknown>).forEach(([k, v]) => {
        const p = toPerson(v, k);
        if (p && !this.people[k]) {
          this.people[k] = p;
          n++;
        }
      });
      this.persist('sales', S);
      this.persist('customCos', this.custom);
      this.persist('people', this.people);
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
    if (!this.can('del.rec')) return this.deny();
    if (!this.custom[id]) return;
    delete this.custom[id];
    this.op(keyOf.cust(id));
    this.persist('customCos', this.custom);
    this.rebuild();
    this.emit();
  }

  // ------------------------------------------------------------------ people (ผู้ติดต่อ)
  /** The company a person is linked to as the whole team has it (null: a company on this device only,
   *  e.g. from the TGO website sync — the person then just names it, so the team still gets them). */
  private personGid(gid: number | null | undefined) {
    if (gid == null) return null;
    const c = this.company(gid);
    return c && !isLocalId(c.id) ? c.id : null;
  }
  private newPerson(p: Partial<PersonForm> & { name: string }, id: string) {
    const c = p.gid != null ? this.company(p.gid) : undefined;
    const gid = this.personGid(p.gid);
    const at = new Date().toISOString(), by = this.me();
    return toPerson(
      { ...p, gid, company: (c?.name || p.company || '').trim(), line: (p.line || '').trim(), owner: p.owner !== undefined ? p.owner : (gid != null && this.crm.owners[gid]) || by, status: p.status || 'active', at, by, upAt: at, upBy: by },
      id,
    );
  }
  /** Add a contact person; returns its id. `id` + `nx`: one found in the Sales Tracker — the same id on
   *  every browser, so if a teammate added the same person first, theirs stands. */
  addPerson(p: Partial<PersonForm> & { name: string }, opt: { id?: string; nx?: boolean } = {}): string {
    if (opt.id && this.people[opt.id]) return opt.id;
    const v = this.newPerson(p, opt.id || opId());
    if (!v) return '';
    const id = v.id;
    this.people[id] = v;
    this.op(keyOf.person(id), { ...v }, { nx: !!opt.nx });
    this.persist('people', this.people);
    this.emit();
    return id;
  }
  /** Add several contacts found in the Sales Tracker at once (one queue write, one save). */
  addPeople(list: (Partial<PersonForm> & { name: string; id: string })[]) {
    let n = 0;
    this.batchOps(() =>
      list.forEach((p) => {
        if (this.people[p.id]) return;
        const v = this.newPerson(p, p.id);
        if (!v) return;
        this.people[v.id] = v;
        this.op(keyOf.person(v.id), { ...v }, { nx: true });
        n++;
      }),
    );
    if (n) {
      this.persist('people', this.people);
      this.emit();
    }
    return n;
  }
  /** Save a person's form: only the fields changed in it (over the values it opened with, `init`), so
   *  a teammate's change to another field meanwhile is kept. */
  updatePerson(id: string, patch: Partial<PersonForm>, init?: Partial<PersonForm>) {
    const cur = this.people[id];
    if (!cur) return;
    const n: Person = { ...cur, ...patch };
    // the company only when the form changed it: a save of other fields keeps the team's link as it is
    // (this device may not know the company, or know it under a merged id)
    const coEdited = ('gid' in patch || 'company' in patch) && (!init || patch.gid !== init.gid || patch.company !== init.company);
    if (coEdited) {
      const g = patch.gid !== undefined ? patch.gid : cur.gid;
      const c = g != null ? this.company(g) : undefined;
      n.gid = g == null ? null : c ? (isLocalId(c.id) ? null : c.id) : isLocalId(g) ? null : this.canonical(g);
      if (c) n.company = c.name;
    } else {
      n.gid = cur.gid;
      n.company = cur.company;
    }
    n.line = (n.line || '').trim();
    n.name = (n.name || '').trim().slice(0, 200) || cur.name;
    n.note = (n.note || '').slice(0, NOTE_CAP);
    const f = PERSON_FIELDS.filter((k) => n[k] !== cur[k] && (!init || !(k in init) || n[k] !== init[k]));
    if (!f.length) return;
    const out: Person = { ...cur, upAt: new Date().toISOString(), upBy: this.me() };
    f.forEach((k) => Object.assign(out, { [k]: n[k] }));
    this.people[id] = out;
    this.op(keyOf.person(id), { ...out }, { f: [...f, 'upAt', 'upBy'] });
    this.persist('people', this.people);
    this.emit();
  }
  /** Delete a person. Their calls and notes at a company stay in its contact log; those kept under the
   *  person (no company the team shares) are shown nowhere else, so they go too. */
  deletePerson(id: string) {
    if (!this.can('del.rec')) return this.deny();
    if (!this.people[id]) return;
    delete this.people[id];
    this.batchOps(() => {
      this.op(keyOf.person(id));
      (this.crm.log['p-' + id] || []).slice().forEach((l) => this.delLog('p-' + id, l));
    });
    delete this.crm.log['p-' + id];
    this.saveCrm();
    this.forgetPeople([id]); // one found in the Sales Tracker is not suggested again
    this.persist('people', this.people);
    this.emit();
  }
  /** People at a company (any of its merged ids; by name for a company on this device only). */
  peopleOf(gid: number) {
    const c = this.company(gid);
    if (c && isLocalId(c.id)) {
      const k = norm(c.name);
      return Object.values(this.people).filter((p) => p.gid == null && norm(p.company) === k);
    }
    const g = this.canonical(gid);
    return Object.values(this.people).filter((p) => p.gid != null && this.canonical(p.gid) === g);
  }
  /** The company page a person links to (registry, added by hand, or found by name on this device). */
  personCompany(p: Person) {
    if (p.gid != null) return this.company(p.gid);
    return p.company ? this.localCo(p.company) : undefined;
  }
  /** Calls, e-mails, meetings and notes with a person, newest first. */
  personLogs(p: Person) {
    // filed under the company id of the time (a company merged or changed since) or under the person
    const out: { l: LogEntry; key: string }[] = [];
    Object.entries(this.crm.log).forEach(([key, a]) => (a || []).forEach((l) => l.pid === p.id && out.push({ l, key })));
    return out.sort((a, b) => b.l.at.localeCompare(a.l.at));
  }
  /** Companies on this device only, by name (for people who name one): built once per registry. */
  private localByName: { B: unknown; m: Map<string, Company> } | null = null;
  private localCo(name: string) {
    if (!this.localByName || this.localByName.B !== this.B) {
      const m = new Map<string, Company>();
      this.B.companies.forEach((c) => isLocalId(c.id) && !m.has(norm(c.name)) && m.set(norm(c.name), c));
      this.localByName = { B: this.B, m };
    }
    return this.localByName.m.get(norm(name));
  }
  /** A call, e-mail, meeting or note with a person: in the company's contact log (the company page
   *  shows it too), or kept under the person when they have no company everyone has. */
  addPersonLog(pid: string, type: string, result: string, text: string) {
    const p = this.people[pid];
    if (!p) return;
    const c = this.personCompany(p);
    if (c && !isLocalId(c.id)) return this.addLog(c.id, type, result, text, pid);
    if (!text && !result) return;
    this.logAct('p-' + pid, { type, result, text, pid });
    this.saveCrm();
  }
  /** Contact persons named in the Sales Tracker or in customers added by hand, not recorded yet. */
  personSuggestions() {
    const hidden = new Set([...(prefs.get<string[]>(PREF.peopleHide, []) || []), ...(prefs.get<string[]>(PREF.peopleGone, []) || [])]);
    return personSuggestions(Object.values(this.people), Object.values(this.sales.deals), Object.values(this.custom), (g) => this.personGid(g), hidden, (g) => this.company(g)?.ids || [g]);
  }
  /** "ไม่ต้อง": don't suggest this one again on this browser (kept apart from deletions, never cut). */
  hideSuggestion(id: string) {
    const h = prefs.get<string[]>(PREF.peopleHide, []) || [];
    if (!h.includes(id)) prefs.set(PREF.peopleHide, [...h, id]);
    this.emit();
  }
  /** People deleted (here or by a teammate) that came from the Sales Tracker: not suggested again. */
  private forgetPeople(ids: string[]) {
    const sids = ids.filter((x) => x.startsWith('s'));
    if (!sids.length) return;
    const g = prefs.get<string[]>(PREF.peopleGone, []) || [];
    const have = new Set(g);
    const add = sids.filter((x) => !have.has(x));
    if (add.length) prefs.set(PREF.peopleGone, [...g, ...add].slice(-5000));
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
    const prev = d.id && (action === 'แก้ไข' || action.startsWith('อัปเดต ') || action === 'แก้แผนชำระ') ? this.lastLog : null;
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
  private putDeal(d: Deal, f?: (keyof Deal)[], fl?: Record<string, ListEdit>) {
    this.sales.deals[d.id] = d;
    this.op(keyOf.deal(d.id), { ...d }, { f, fl });
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
  /** New deal; `gid` links it to a company whose contact details fill in what is not given. `why`: the
   *  history entry (a joint quotation's header says what it is). */
  addDeal(p: Partial<Deal>, why = 'เพิ่มลูกค้า'): Deal {
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
    // an account that may edit only its own deals adds deals of its own (else the team would refuse it)
    if (this.myCaps()?.['edit.deal'] === 'own') d.resp = this.me();
    this.putDeal(d);
    this.salesLog(d, why, d.section);
    this.saveSales();
    return d;
  }
  /** Send companies (e.g. the starred ones) to the tracker; those already tracked in the year are skipped. */
  addDealsFromCompanies(ids: number[], opts: { section?: string; year?: string } = {}) {
    if (!this.can('edit.deal')) {
      this.deny();
      return { added: 0, skipped: 0 };
    }
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
      // a joint quotation's header is the payer's row for that quotation, not the company's own row of the year
      if (this.dealsOf(c.id).some((d) => d.year === year && jointRole(this.sales, d) !== 'header')) {
        skipped++;
        return;
      }
      this.addDeal({ gid: c.id, year, ...(opts.section != null ? { section: opts.section } : {}) });
      added++;
    });
    return { added, skipped };
  }
  updateDeal(id: string, patch: Partial<Deal>, opt: { keepJoint?: boolean } = {}) {
    const d = this.sales.deals[id];
    if (!d) return;
    // a joint quotation and its companies share a year (package quotes): moveJointYear
    if (!opt.keepJoint && patch.year != null && patch.year !== d.year && jointRole(this.sales, d) !== 'plain') return this.moveJointYear(d, patch);
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
    // SOURCE / Services: the items ticked and unticked, so a teammate ticking another item keeps theirs
    const fl: Record<string, ListEdit> = {};
    (['source', 'service'] as const).forEach((k) => {
      if (!changed.includes(k)) return;
      const a = d[k] || [], b = n[k] || [];
      fl[k] = { add: b.filter((x) => !a.includes(x)), rm: a.filter((x) => !b.includes(x)) };
    });
    this.putDeal(n, [...new Set([...changed, ...(['fcAt', 'closedDate'] as const).filter((k) => n[k] !== d[k])])], Object.keys(fl).length ? fl : undefined);
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
    // the note a receipt or a document fills in is the deal's (dstep/): an account that may record money
    // or attach documents but not edit this deal (บัญชี/การเงิน) leaves the stage as it is, rather than
    // have every receipt come back refused
    if (auto && !this.canDeal('edit.deal', d)) return;
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
      // by hand: only what changed, so a teammate's note (or date) written meanwhile is kept
      const f = auto ? undefined : (['d', 'n'] as const).filter((x) => (x === 'd' ? date : n) !== cur[x]);
      this.op(keyOf.dstep(id, stage), { d: date, n }, { base, f });
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
    if (section !== d.section) this.salesLog(d, 'ย้ายหมวด', `จาก ${d.section || 'ไม่ระบุหมวด'} ไป ${section || 'ไม่ระบุหมวด'}`);
    this.saveSales();
  }
  deleteDeal(id: string) {
    if (!this.can('del.rec')) return this.deny();
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
    this.dropDealRecords(id);
    this.salesLog(d, why, d.section);
  }
  /** A deleted deal's stage notes, documents (and their files), payment plan and contact records go with it;
   *  a joint quotation's header takes its mark and memberships along, a member its membership. */
  private dropDealRecords(id: string) {
    const S = this.sales;
    if (S.jqt?.[id]) {
      delete S.jqt[id];
      this.op(keyOf.jqt(id));
    }
    Object.keys(S.jqm || {}).forEach((k) => {
      const i = k.indexOf('/');
      if (k.slice(0, i) !== id && k.slice(i + 1) !== id) return;
      delete S.jqm![k];
      this.op('jqm/' + k);
    });
    const bags = { steps: 'dstep/', pays: 'dpay/', acts: 'dact/' } as const;
    (Object.keys(bags) as (keyof typeof bags)[]).forEach((bag) =>
      Object.keys(S[bag] || {}).forEach((k) => {
        if (!k.startsWith(id + '/')) return;
        delete S[bag]![k];
        this.op(bags[bag] + k);
      }),
    );
    Object.entries(S.docs).forEach(([k, doc]) => {
      if (doc.deal !== id) return;
      delete S.docs[k];
      this.op('ddoc/' + k);
      this.dropDocFile(doc);
    });
    // its revenue split: the script removes it with the deal for an account (one that may not change splits
    // leaves it to the script); with the team code it goes here
    if (S.shares?.[id]) {
      delete S.shares[id];
      if (this.canWriteKey(keyOf.dshare(id), true)) this.op(keyOf.dshare(id));
    }
    // its job expenses: the same (the script deletes them with the deal for an account); accounting's checks
    // of them stay, as checks of income do
    Object.keys(S.exp || {}).forEach((k) => {
      if (!k.startsWith(id + '/')) return;
      delete S.exp![k];
      if (this.canWriteKey('dexp/' + k, true)) this.op('dexp/' + k);
    });
  }
  /** Replace one of the tracker's lists (sections, SOURCE, Services, stages). */
  setSalesList(name: keyof SalesCfg, items: string[]) {
    if (!this.can('set.lists')) return this.deny();
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
    if (!this.can('set.lists')) return this.deny();
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

  // ---- payment plan: one record per installment, dpay/<deal>/<stage> (lib/sales.ts planOf)
  /** Write one installment's plan fields (`p`; received fields are not among them): a new line by all
   *  of them, a changed one by the fields that changed — either way a teammate's receipt on it (rcv / got
   *  / full), also on a line this browser has not pulled yet, or their edit of another field stays
   *  (rebaseOp). Returns whether anything changed. */
  private putPay(d: Deal, stage: string, p: Partial<PlanInput>, at: string, by: string) {
    const k = `${d.id}/${stage}`, cur = this.sales.pays[k];
    const was: PayLine = cur || { amt: null, pct: null, due: '', rel: null, how: '', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at, by };
    const typed = Object.fromEntries(PLAN_FIELDS.filter((x) => p[x] !== undefined).map((x) => [x, p[x]]));
    const n = toPay({ ...was, ...typed, at, by })!;
    const f = PLAN_FIELDS.filter((x) => n[x] !== was[x]);
    if (cur && !f.length) return false;
    this.sales.pays[k] = n;
    this.op(keyOf.dpay(d.id, stage), { ...n }, { f: [...(cur ? f : PLAN_FIELDS), 'at', 'by'] });
    return true;
  }
  /** What an installment would have come to with this line: its documents and its hand receipt. */
  private gotWith(d: Deal, stage: string, l: PayLine) {
    const S = { ...this.sales, pays: { ...this.sales.pays, [`${d.id}/${stage}`]: l } };
    return planOf(S, d, todayISO())?.lines.find((x) => x.stage === stage)?.got ?? 0;
  }
  /** Received already (by hand, or an Actual document at its stage): such a line is never deleted. */
  private payReceived(d: Deal, stage: string) {
    return !!this.sales.pays[`${d.id}/${stage}`]?.rcv || countedAt(this.sales, d, stage).length > 0;
  }
  /** One-line summary for the history: "2 งวด · 53,500 + 53,500". */
  private planSummary(d: Deal) {
    const L = planLines(this.sales, d) || [];
    return L.length ? `${L.length} งวด · ${L.map((x) => (x.line.amt != null ? fmtMoney(x.line.amt) : '-')).join(' + ')}` : '';
  }
  /**
   * Replace a deal's plan ("บันทึกแผน"), at most PLAN_MAX lines, one per stage. A new line is written
   * by all its plan fields, a changed line by its changed fields; a line no longer listed is deleted
   * unless it was received — then it stays, and its stage is in `kept` (the UI says so). The first plan
   * of a deal takes a PAY stage paid the old way (its note and the typed Actual, planStart) as received
   * by hand on that day. An empty list removes the plan (clearPlan). History: ตั้งแผนชำระ / แก้แผนชำระ / ลบแผนชำระ.
   */
  setPlan(dealId: string, lines: PlanInput[]): { kept: string[] } {
    const S = this.sales, d = S.deals[dealId], kept: string[] = [];
    if (!this.canDeal('edit.pay', d)) return this.deny(), { kept };
    if (!d) return { kept };
    const had = planLines(S, d), at = new Date().toISOString(), by = this.me();
    const old = had ? [] : planStart(S, d, todayISO()).lines.filter((x) => x.old && x.amt != null);
    // a stage name is part of the record key: no "/" (as in setSalesList)
    const want = new Map<string, PlanInput>();
    lines.forEach((x) => {
      const stage = String(x.stage || '').trim().replace(/\//g, '-').slice(0, 60);
      if (stage && !want.has(stage) && want.size < PLAN_MAX) want.set(stage, x);
    });
    let changed = false;
    this.batchOps(() => {
      want.forEach((x, stage) => {
        if (this.putPay(d, stage, x, at, by)) changed = true;
        // paid before there was a plan, by its note: received by hand that day (its note stays as it is)
        const o = old.find((z) => z.stage === stage), k = `${dealId}/${stage}`, l = S.pays[k];
        if (!o || !l || l.rcv || !((l.amt || 0) > 0)) return;
        S.pays[k] = { ...l, rcv: o.old, got: l.amt, at, by };
        this.op(keyOf.dpay(dealId, stage), { ...S.pays[k] }, { f: ['rcv', 'got', 'at', 'by'] });
      });
      (had || []).forEach(({ stage }) => {
        if (want.has(stage)) return;
        if (this.payReceived(d, stage)) return void kept.push(stage);
        delete S.pays[`${dealId}/${stage}`];
        this.op(keyOf.dpay(dealId, stage));
        changed = true;
      });
      if (!changed) return;
      if (!want.size) this.salesLog(d, 'ลบแผนชำระ', kept.length ? 'เก็บงวดที่รับแล้ว ' + kept.join(', ') : '');
      else this.salesLog(d, had ? 'แก้แผนชำระ' : 'ตั้งแผนชำระ', this.planSummary(d));
    });
    if (changed) this.saveSales();
    return { kept };
  }
  /** Remove the plan: every line not received goes (received ones stay, in `kept`). */
  clearPlan(dealId: string) {
    return this.setPlan(dealId, []);
  }
  /**
   * The table's one-click plan ("2 งวด 50/50"): n installments of what is left of the Forecast (Forecast −
   * Actual so far), in `shares` (default equal; 50/50 for 2), the first due 30 days after the deal was
   * won and then every 30 days, by transfer. Installments already received stay — also PAY stages paid
   * before there was a plan, by their documents or the old way (planStart) — and the new ones take the
   * next PAY stages not paid yet (then "PAY<n>"). Returns the new stages and amounts (for the toast), or
   * null when nothing was done.
   */
  quickPlan(dealId: string, n: number, shares?: number[]): { stages: string[]; amounts: (number | null)[] } | null {
    const S = this.sales, d = S.deals[dealId];
    if (!this.canDeal('edit.pay', d)) return this.deny(), null;
    if (!d) return null;
    const today = todayISO(), m = dealMoney(S, d), ps = payState(S, d, today), start = planStart(S, d, today);
    const keep: PlanInput[] = ps.plan
      ? ps.plan.lines.filter((l) => l.got > 0).map(({ stage, line: l }) => ({ stage, amt: l.amt, pct: l.pct, due: l.due, rel: l.rel, how: l.how, howT: l.howT, note: l.note }))
      : // paid before there was a plan: the line says what came in (one paid by its note alone, with no
        // amount to go on, stays out of the plan with its note)
        start.lines.flatMap(({ stage, amt }) => (amt != null ? [{ stage, amt, pct: null, due: '', rel: null, how: '' as PayHow, howT: '', note: '' }] : []));
    n = Math.max(1, Math.min(PLAN_MAX - keep.length, Math.floor(n) || 1));
    const used = new Set([...keep.map((x) => x.stage), ...start.used]);
    const stages: string[] = [];
    for (let i = 1; stages.length < n && i <= 99; i++) {
      const p = payStageFor(S.cfg, i);
      if (!used.has(p) && !stages.includes(p)) stages.push(p);
    }
    const sh = shares && shares.length === stages.length ? shares : stages.length === 2 ? [50, 50] : stages.map(() => 1);
    const total = sh.reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
    const received = m.actual || 0, base = Math.max(0, (m.forecast || 0) - received);
    const amounts = base > 0 ? splitAmounts(base, sh) : stages.map(() => null);
    // a share of the Forecast only when nothing has come in yet (else it is a share of what is left)
    const pct = (i: number) => (received || keep.length ? null : Math.round(((sh[i] > 0 ? sh[i] : 0) / total) * 100));
    this.setPlan(dealId, [...keep, ...stages.map((stage, i) => ({ stage, amt: amounts[i], pct: pct(i), due: '', rel: 30 * (i + 1), how: 'transfer' as PayHow, howT: '', note: '' }))]);
    return { stages, amounts };
  }
  /** Change one installment's plan fields in place (the panel's inline edit); a stage without a line gets one. */
  updatePayLine(dealId: string, stage: string, patch: Partial<Omit<PlanInput, 'stage'>>) {
    const d = this.sales.deals[dealId];
    if (!this.canDeal('edit.pay', d)) return this.deny();
    if (!d || !stage || stage.includes('/')) return;
    const had = !!planLines(this.sales, d);
    this.batchOps(() => {
      if (this.putPay(d, stage, patch, new Date().toISOString(), this.me())) this.salesLog(d, had ? 'แก้แผนชำระ' : 'ตั้งแผนชำระ', this.planSummary(d));
    });
    this.saveSales();
  }
  /**
   * "รับเงินแล้ว" without a document: the date, the amount (null = as planned), how, and whether a short
   * amount counts as complete ("ถือว่ารับครบงวดนี้"). An empty note of the stage is filled in as a
   * document's would be ("รับชำระแล้ว 53,500 บาท · โอน", on the date received), so builds without the
   * plan see the stage done too. A document attached there later takes over the amount. Returns true
   * when this made the deal ready to close (the UI then offers ปิดงาน).
   */
  markPaid(dealId: string, stage: string, r: { date: string; amount: number | null; how?: PayHow; full?: boolean }): boolean {
    const S = this.sales, d = S.deals[dealId], k = `${dealId}/${stage}`, cur = S.pays[k];
    if (!this.canDeal('edit.pay', d)) return this.deny(), false;
    if (!d || !cur) return false;
    const today = todayISO(), was = closeReady(S, d, today);
    const n = toPay({ ...cur, rcv: r.date, got: r.amount, full: !!r.full, fullAt: null, ...(r.how !== undefined ? { how: r.how } : {}), at: new Date().toISOString(), by: this.me() })!;
    n.rcv = n.rcv || today;
    if (n.full) n.fullAt = this.gotWith(d, stage, n); // counted complete for what came in now
    const f = (['rcv', 'got', 'full', 'fullAt', 'how'] as const).filter((x) => n[x] !== cur[x]);
    this.batchOps(() => {
      S.pays[k] = n;
      this.op(keyOf.dpay(dealId, stage), { ...n }, { f: [...f, 'at', 'by'] });
      if (S.cfg.stages.includes(stage) && !stepOf(S, dealId, stage).n.trim()) this.setStep(dealId, stage, { d: n.rcv, n: paidNote(n) }, true, true);
      this.salesLog(d, 'รับชำระ ' + stage, [`${fmtMoney(n.got ?? n.amt ?? 0)} บาท`, n.how ? HOW_TH[n.how] : '', n.full ? 'ถือว่าครบ' : ''].filter(Boolean).join(' · '));
    });
    this.saveSales();
    return !was && closeReady(S, d, today);
  }
  /** Undo a hand receipt ("ยกเลิกการรับ"): the stage note it filled in goes too, while it is unchanged. */
  unmarkPaid(dealId: string, stage: string) {
    const S = this.sales, d = S.deals[dealId], k = `${dealId}/${stage}`, cur = S.pays[k];
    if (!this.canDeal('edit.pay', d)) return this.deny();
    if (!d || !cur || (!cur.rcv && cur.got == null && !cur.full)) return;
    const st = stepOf(S, dealId, stage), auto = st.n === paidNote(cur);
    this.batchOps(() => {
      S.pays[k] = { ...cur, rcv: '', got: null, full: false, fullAt: null, add: false, at: new Date().toISOString(), by: this.me() };
      this.op(keyOf.dpay(dealId, stage), { ...S.pays[k] }, { f: ['rcv', 'got', 'full', 'fullAt', 'add', 'at', 'by'] });
      if (auto) this.setStep(dealId, stage, { d: st.d !== cur.rcv ? st.d : '', n: '' }, true, true); // a date the user corrected stays
      this.salesLog(d, 'ยกเลิกการรับ ' + stage);
    });
    this.saveSales();
  }
  /** Count a short installment as complete (withholding tax, rounding) or open it again. It holds for
   *  what has come in now (PayLine.fullAt): a receipt deleted or changed later opens it again. Returns
   *  true when this made the deal ready to close. */
  setPayFull(dealId: string, stage: string, full: boolean): boolean {
    const S = this.sales, d = S.deals[dealId], k = `${dealId}/${stage}`, cur = S.pays[k];
    if (!this.canDeal('edit.pay', d)) return this.deny(), false;
    if (!d || !cur) return false;
    const fullAt = full ? this.gotWith(d, stage, cur) : null;
    if (cur.full === full && cur.fullAt === fullAt) return false;
    const today = todayISO(), was = closeReady(S, d, today);
    this.batchOps(() => {
      S.pays[k] = { ...cur, full, fullAt, at: new Date().toISOString(), by: this.me() };
      this.op(keyOf.dpay(dealId, stage), { ...S.pays[k] }, { f: ['full', 'fullAt', 'at', 'by'] });
      if (full) this.salesLog(d, 'ถือว่ารับครบ ' + stage);
      else this.salesLog(d, 'แก้แผนชำระ', stage + ' ยังค้างรับ');
    });
    this.saveSales();
    return !was && closeReady(S, d, today);
  }
  /** Installments due from `from` to `to` (`from` '' = the late ones too) of won, open deals: the
   *  calendar's read-only "รับชำระ" entries. */
  payDue(from: string, to: string) {
    return payDue(this.sales, Object.values(this.sales.deals), from, to, todayISO());
  }

  // ---- contacts beyond the stages: one record each, dact/<deal>/<id> (lib/sales.ts DealAct)
  /** "บันทึกการติดต่อ": a call, e-mail or meeting on `d` (default today) at `stage` (default where the
   *  deal is, actStage). Never rewrites the deal or a stage: the last contact is derived (lastContact). */
  addAct(dealId: string, a: { type: ActType; note: string; d?: string; stage?: string; pid?: string }): DealAct | null {
    const S = this.sales, deal = S.deals[dealId];
    if (!this.canDeal('edit.deal', deal)) return this.deny(), null;
    if (!deal) return null;
    const today = todayISO(), id = uid();
    const act = toAct({ d: a.d || today, type: a.type, note: (a.note || '').trim(), stage: a.stage ?? actStage(S, deal, today), pid: a.pid || '', by: this.me(), at: new Date().toISOString() }, dealId, id);
    if (!act) return null;
    const { deal: _d, id: _i, ...v } = act;
    (S.acts || (S.acts = {}))[`${dealId}/${id}`] = act;
    this.batchOps(() => {
      this.op(keyOf.dact(dealId, id), v);
      this.salesLog(deal, 'บันทึกการติดต่อ', [ACT_TH[act.type], act.stage, act.note.slice(0, 120)].filter(Boolean).join(' · '));
    });
    this.saveSales();
    return act;
  }
  /** Who may remove a contact record: as with the company's contact log, its author (an account that
   *  can edit) or an admin; without accounts, anyone. */
  canDelAct(a: Pick<DealAct, 'by'>) {
    return this.can('del.log', a.by || '');
  }
  delAct(dealId: string, actId: string) {
    const S = this.sales, k = `${dealId}/${actId}`, a = (S.acts || {})[k], deal = S.deals[dealId];
    if (!a) return;
    if (!this.canDelAct(a)) return this.deny();
    // queued while the record is still here: an "own" capability checks who wrote it (canWriteKey)
    this.batchOps(() => {
      this.op(keyOf.dact(dealId, actId));
      if (deal) this.salesLog(deal, 'ลบการติดต่อ', [ACT_TH[a.type], isoTh(a.d), a.note.slice(0, 80)].filter(Boolean).join(' · '));
    });
    delete S.acts![k];
    this.saveSales();
  }

  // ---- joint quotations (package quotes, item 7): the header is an ordinary deal (the payer's row) marked by
  // jqt/<hid>; each member company keeps its own row, joined by jqm/<hid>/<dealId> (lib/sales.ts jointOf)

  /** May this account make or change joint quotations ("สร้างใบเสนอราคาร่วม")? It writes deals too (the
   *  header, the members' QUOTATION, new member rows): สร้างใบเสนอราคาร่วม with ดีลและขั้นตอน (own work is
   *  enough: the header is its own, and only its own rows can be reused, rowFate 'locked'). */
  canJoint() {
    return this.can('edit.jqt') && this.can('edit.deal');
  }
  /** rowFate as this account may do it: a row it may not edit is 'locked'. */
  jointFate(d: Deal, hid = '') {
    return rowFate(this.sales, d, hid, (x) => this.canDeal('edit.deal', x));
  }
  /** Why a joint quotation's header or member cannot move to another year now ('' = it can, after asking):
   *  a member leaves the joint quotation (สร้างใบเสนอราคาร่วม), the header takes every company along (each
   *  must be a row this account may edit). */
  jointYearBlock(d: Deal): string {
    const S = this.sales, r = jointRole(S, d);
    if (r === 'member') return this.can('edit.jqt') ? '' : 'บริษัทนี้อยู่ในใบเสนอราคาร่วม ให้ผู้ที่แก้ไขใบเสนอราคาร่วมได้เอาออกก่อน แล้วจึงย้ายปี';
    if (r !== 'header') return '';
    if (!this.canJoint()) return 'บัญชีของคุณแก้ไขใบเสนอราคาร่วมไม่ได้';
    const x = jointOf(S, d)?.members.find((m) => !this.canDeal('edit.deal', m.deal));
    return x ? `ย้ายปีไม่ได้: ${x.deal.client} เป็นงานของ ${x.deal.resp || 'คนอื่น'} บัญชีของคุณแก้ไขแถวนั้นไม่ได้` : '';
  }
  /** A joint quotation's header or member moves to another year: a member leaves the joint quotation (its
   *  row and its own records stay); the header takes every company with it, in one push. */
  private moveJointYear(d: Deal, patch: Partial<Deal>) {
    const S = this.sales, g = jointOf(S, d), why = this.jointYearBlock(d);
    if (why) {
      this.teamNote = why;
      this.emit();
      return;
    }
    this.batchOps(() => {
      if (g && g.head.id !== d.id) this.leaveJoint(g, d);
      this.updateDeal(d.id, patch, { keepJoint: true });
      if (g && g.head.id === d.id) g.members.forEach((x) => this.updateDeal(x.deal.id, { year: patch.year }, { keepJoint: true }));
    });
  }
  /**
   * "สร้างใบเสนอราคาร่วม" (and, with `p.from`, "รวมเป็นใบเสนอราคาร่วม"): the header, the payer's row of the year
   * (its client the payer; its documents and plan are the quotation's money); its mark; the member rows
   * (reused, or new: lib/joint rowFate) with one membership each; then the quotation as the header's
   * Forecast: attached from the file, or moved there with every version from the deal it was attached to
   * (same document ids, so its Drive file, this browser's copy and its check stay, and no two live records
   * ever share a file), or, with neither, the total as the header's typed Forecast. Each member's empty
   * QUOTATION stage is noted "ใบเสนอราคาร่วม QT-…". Returns the header's id, and why the file could not be
   * attached (the joint quotation stands; the file can be attached from its card).
   */
  async createJoint(p: JointNew): Promise<{ hid: string; attachErr: string }> {
    if (!this.canJoint()) throw new Error('บัญชีของคุณสร้างใบเสนอราคาร่วมไม่ได้');
    if ((p.file || p.from) && !this.can('docs.up')) throw new Error('บัญชีของคุณแนบเอกสารไม่ได้');
    const payer = p.payer.trim().slice(0, 200);
    if (!payer) throw new Error('ใส่ชื่อผู้จ่าย');
    if (!p.members.length) throw new Error('เพิ่มบริษัทอย่างน้อย 1 บริษัท');
    if (p.file) {
      if (p.file.size > DOC_MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 10 MB');
      if (!docMime({ name: p.file.name || '', type: p.file.type || '' })) throw new Error('รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)');
    }
    const S = this.sales, from = p.from ? S.deals[p.from] : undefined;
    if (p.from && (!from || jointRole(S, from) !== 'plain')) throw new Error('ไม่พบรายการนี้แล้ว หรืออยู่ในใบเสนอราคาร่วมอื่นแล้ว');
    // a deal with money received, a plan or closed keeps its job: only its quotation alone may move
    if (from && (!canMergeFrom(S, from) || !this.canDeal('edit.deal', from))) throw new Error('รายการนี้รวมเป็นใบเสนอราคาร่วมไม่ได้ (มียอดรับเงิน แผนชำระ หรือปิดงานแล้ว หรือเป็นงานที่บัญชีของคุณแก้ไขไม่ได้)');
    const locked = this.jointLocked(p.members, '', from?.id);
    if (locked) throw new Error(locked);
    const title = (p.title.trim() || payer).slice(0, 200);
    const docNo = p.docNo.trim().slice(0, 60);
    let hid = '';
    this.batchOps(() => {
      const h = this.addDeal({ client: payer, gid: p.payerGid, year: p.year, section: p.section, resp: p.resp, service: p.service.slice() }, 'สร้างใบเสนอราคาร่วม');
      hid = h.id;
      const jq = { title, at: new Date().toISOString(), by: this.me() };
      (S.jqt || (S.jqt = {}))[hid] = jq;
      this.op(keyOf.jqt(hid), { ...jq });
      let no = docNo;
      if (from) no = this.moveQt(from.id, hid) || no;
      else if (!p.file) this.jointTyped(hid, p.total, docNo, p.docDate);
      this.joinMembers(S.deals[hid], p.members, no, p.docDate, title);
    });
    let attachErr = '';
    if (p.file)
      try {
        await this.attachDoc(hid, p.file, { kind: 'quotation', amount: p.total, target: 'forecast', basis: p.basis || 'manual', detected: p.detected ?? p.total, docNo, docDate: p.docDate, stage: QUOTE_STAGE });
      } catch (err) {
        attachErr = (err as Error)?.message || String(err);
        // the joint quotation stands without its file: what was typed is kept as if none had been chosen
        if (S.deals[hid]) this.batchOps(() => this.jointTyped(hid, p.total, docNo, p.docDate));
      }
    this.saveSales();
    return { hid, attachErr };
  }
  /**
   * A joint quotation without its file (none chosen, or it could not be attached): its total is the header's
   * typed Forecast, and the quotation is recorded at the header's QUOTATION as its members' is ("ใบเสนอราคาร่วม
   * QT-…", on the day it is dated, today at the latest), so the band, the search, the closing dialog and the
   * members' line have its number and the day it was sent (lib/joint jointNo). Attaching the file later takes
   * the note over (attachDoc). Existing records only.
   */
  private jointTyped(hid: string, total: number | null, docNo: string, docDate: string) {
    const S = this.sales, today = todayISO();
    if (total != null) this.updateDeal(hid, { forecast: total });
    const st = stepOf(S, hid, QUOTE_STAGE);
    if (S.cfg.stages.includes(QUOTE_STAGE) && !st.d && !st.n.trim()) this.setStep(hid, QUOTE_STAGE, { d: docDate && docDate <= today ? docDate : today, n: jointNote(docNo) }, true, true);
  }
  /** Why picks may not join ('' = they may): another person's row this account may not edit (rowFate
   *  'locked'). `skip`: the deal "รวมเป็นใบเสนอราคาร่วม" comes from (its quotation moves first, then it joins). */
  private jointLocked(picks: JointPick[], hid: string, skip?: string): string {
    for (const x of picks) {
      const d = x.deal ? this.sales.deals[x.deal] : undefined;
      if (d && d.id !== skip && this.jointFate(d, hid) === 'locked') return `${d.client} เป็นงานของ ${d.resp || 'คนอื่น'} บัญชีของคุณใส่แถวนี้ในใบเสนอราคาร่วมไม่ได้`;
    }
    return '';
  }
  /** Members join header `h` (a pick's row, or a new row when it has a job of its own, or is not in the
   *  table): a membership each, in the order picked; an empty QUOTATION stage noted. */
  private joinMembers(h: Deal, picks: JointPick[], docNo: string, docDate: string, title: string) {
    const S = this.sales, today = todayISO(), t0 = Date.now(), by = this.me();
    const J = S.jqm || (S.jqm = {});
    picks.forEach((x, i) => {
      let d = x.deal ? S.deals[x.deal] : undefined;
      const fate = d ? this.jointFate(d, h.id) : 'new';
      // gone, in another joint quotation, or a row this account may not edit
      if (x.deal && (!d || d.id === h.id || fate === 'taken' || fate === 'locked')) return;
      if (!d || fate === 'new') {
        // a new row of the year: the registry company's details, or those of the company's own row; its job is
        // the joint quotation's, so it has its Services (the Services chart and filter count it as a customer)
        const like = d || (x.like ? S.deals[x.like] : undefined);
        const gid = x.gid != null ? x.gid : like?.gid ?? null;
        d = this.addDeal({
          year: h.year, section: h.section, service: h.service.slice(),
          ...(gid != null ? { gid } : { client: (x.name || like?.client || '').trim() }),
          ...(like ? { contactName: like.contactName, phone: like.phone, email: like.email, resp: like.resp } : {}),
        });
      }
      const m = { share: x.share, pct: x.pct, at: new Date(t0 + i).toISOString(), by };
      J[`${h.id}/${d.id}`] = m;
      this.op(keyOf.jqm(h.id, d.id), { ...m });
      // QUOTATION is done for every member by the joint quotation (a note of the row's own stays)
      const st = stepOf(S, d.id, QUOTE_STAGE);
      if (S.cfg.stages.includes(QUOTE_STAGE) && !st.d && !st.n.trim()) this.setStep(d.id, QUOTE_STAGE, { d: docDate && docDate <= today ? docDate : today, n: jointNote(docNo) }, true, true);
      this.salesLog(d, 'เข้าร่วมใบเสนอราคาร่วม', [title, docNo].filter(Boolean).join(' · '));
    });
  }
  /**
   * "รวมเป็นใบเสนอราคาร่วม": a deal's quotation (every version) moves to the header under the same document
   * ids: the header's record is written whole and the deal's deleted without its file (a move, never a copy:
   * a later delete of either would trash the other's file). The header's QUOTATION is the quotation's note,
   * following the version in use; the deal's own QUOTATION note, when the quotation wrote it, now names the
   * joint quotation. Returns the quotation's number.
   */
  /**
   * "ย้ายไปใบเสนอราคาร่วม": a document on a member that counts nowhere (lib/joint strayDocs: attached by an
   * older build, or before the company joined) moves to its joint quotation's header under the same id
   * (one live record per file, this browser's copy kept). A quotation, while the joint quotation has none
   * yet, becomes its quotation with every version (moveQt); anything else is kept there as a document that
   * is not counted, so no figure changes unless someone confirms it there. Returns how it moved.
   */
  moveToJoint(memberId: string, docId: string): 'qt' | 'doc' | '' {
    const S = this.sales, d = S.deals[memberId], doc = S.docs[`${memberId}/${docId}`];
    const h = d && jointRole(S, d) === 'member' ? S.deals[jointHeadOf(S, d.id)] : undefined;
    if (!d || !doc || !h) return '';
    if (!this.can('docs.up') || !this.canDeal('edit.deal', d) || !this.canDeal('edit.deal', h)) {
      this.deny();
      return '';
    }
    let how: 'qt' | 'doc' = 'doc';
    this.batchOps(() => {
      if (isQtVersion(doc) && !qtVersions(S, h).length) {
        this.moveQt(d.id, h.id, 'ย้ายไปใบเสนอราคาร่วม');
        how = 'qt';
        return;
      }
      // the stage note it filled in on the member passes on, or goes (a QUOTATION then names the joint one)
      const st = doc.auto?.stage || '';
      this.releaseAuto(doc);
      if (st === QUOTE_STAGE && !stepOf(S, d.id, QUOTE_STAGE).n.trim()) {
        const g = jointOf(S, h);
        if (g) this.setStep(d.id, QUOTE_STAGE, { d: stepOf(S, h.id, QUOTE_STAGE).d || todayISO(), n: jointNote(jointNo(S, g)) }, true, true);
      }
      const { auto: _a, ...vals } = doc;
      const n: DealDoc = { ...vals, deal: h.id, target: 'none', stage: '' };
      S.docs[`${h.id}/${docId}`] = n;
      this.op(keyOf.ddoc(h.id, docId), { ...n });
      delete S.docs[`${memberId}/${docId}`];
      this.op(keyOf.ddoc(memberId, docId));
      this.salesLog(d, 'ย้ายไปใบเสนอราคาร่วม', `${doc.name} · ไม่นับยอด`);
    });
    this.saveSales();
    return how;
  }
  private moveQt(fromId: string, toId: string, why = 'รวมเป็นใบเสนอราคาร่วม'): string {
    const S = this.sales, from = S.deals[fromId], vs = qtVersions(S, { id: fromId });
    if (!from || !vs.length) return '';
    const cur = dealMoney(S, from).fcDoc?.id || vs[vs.length - 1].id;
    const st = stepOf(S, fromId, QUOTE_STAGE), today = todayISO();
    const wrote = vs.some((x) => !!x.auto && x.auto.stage === QUOTE_STAGE && this.autoStillThere(x));
    let head: DealDoc | undefined;
    vs.forEach((x) => {
      const { auto: _a, ...vals } = x;
      const n: DealDoc = { ...vals, deal: toId };
      if (x.id === cur) {
        n.auto = { stage: QUOTE_STAGE, n: this.autoNote(n), d: st.d || (x.docDate && x.docDate <= today ? x.docDate : today) };
        head = n;
      }
      S.docs[`${toId}/${x.id}`] = n;
      this.op(keyOf.ddoc(toId, x.id), { ...n });
      delete S.docs[`${fromId}/${x.id}`];
      this.op(keyOf.ddoc(fromId, x.id));
    });
    if (head?.auto) this.setStep(toId, QUOTE_STAGE, { d: head.auto.d!, n: head.auto.n }, true, true);
    if (wrote) this.setStep(fromId, QUOTE_STAGE, { d: st.d, n: jointNote(head?.docNo || '') }, true, true);
    this.salesLog(from, why, `${head?.docNo || 'ใบเสนอราคา'} ย้ายไปใบเสนอราคาร่วม`);
    return head?.docNo || '';
  }
  /**
   * "แก้ไขรายชื่อ": the joint quotation's companies become `picks` (in that order): those no longer listed
   * leave (their rows stay, the QUOTATION note it wrote goes), new ones join (lib/joint rowFate), and parts
   * typed differently are written (field by field, so a teammate's edit of another member never collides).
   */
  setJointMembers(hid: string, picks: JointPick[]) {
    const S = this.sales, g = jointOf(S, { id: hid });
    if (!g) return;
    if (!this.canJoint() || !this.canDeal('edit.deal', g.head)) return this.deny();
    const locked = this.jointLocked(picks, hid);
    if (locked) {
      this.teamNote = locked;
      this.emit();
      return;
    }
    // (a company whose row this account may not edit stays: leaving would put its own figures back)
    const keep = new Set([...picks.map((x) => x.deal).filter(Boolean), ...g.members.filter((x) => !this.canDeal('edit.deal', x.deal)).map((x) => x.deal.id)]);
    const no = jointNo(S, g), day = stepOf(S, hid, QUOTE_STAGE).d;
    this.batchOps(() => {
      g.members.forEach((x) => !keep.has(x.deal.id) && this.leaveJoint(g, x.deal));
      const fresh: JointPick[] = [];
      picks.forEach((x) => {
        const k = `${hid}/${x.deal}`, cur = x.deal ? S.jqm?.[k] : undefined;
        if (!cur) return void fresh.push(x);
        if (cur.share === x.share && cur.pct === x.pct) return;
        S.jqm![k] = { ...cur, share: x.share, pct: x.pct, at: cur.at, by: this.me() };
        this.op('jqm/' + k, { ...S.jqm![k] }, { f: ['share', 'pct', 'by'] });
      });
      this.joinMembers(g.head, fresh, no, day, g.qt.title);
      this.salesLog(g.head, 'แก้ไขใบเสนอราคาร่วม', `${picks.length} บริษัท`);
    });
    this.saveSales();
  }
  /** A member leaves (its row stays): its membership goes, and the QUOTATION note the joint quotation wrote. */
  private leaveJoint(g: JointGroup, d: Deal) {
    const S = this.sales, k = `${g.head.id}/${d.id}`;
    if (S.jqm?.[k]) {
      delete S.jqm[k];
      this.op('jqm/' + k);
    }
    const st = stepOf(S, d.id, QUOTE_STAGE);
    if (isJointNote(st.n)) this.setStep(d.id, QUOTE_STAGE, { d: '', n: '' }, true, true);
    this.salesLog(d, 'ออกจากใบเสนอราคาร่วม', g.qt.title);
  }
  /** The joint quotation's name (jqt.title), field by field. */
  setJointTitle(hid: string, title: string) {
    const S = this.sales, cur = S.jqt?.[hid], h = S.deals[hid];
    const t = title.trim().slice(0, 200);
    if (!cur || !h || !t || t === cur.title) return;
    if (!this.canJoint() || !this.canDeal('edit.deal', h)) return this.deny();
    S.jqt![hid] = { ...cur, title: t, by: this.me() };
    this.batchOps(() => {
      this.op(keyOf.jqt(hid), { ...S.jqt![hid] }, { f: ['title', 'by'] });
      this.salesLog(h, 'แก้ไข', 'ชื่องาน');
    });
    this.saveSales();
  }
  /** "ปิดงานทั้ง N บริษัท": the header and every member still open move to ปิดงาน in one batch (a row this
   *  account may not edit stays). Returns how many closed. */
  closeJoint(hid: string): number {
    const g = jointOf(this.sales, { id: hid });
    if (!g) return 0;
    let n = 0;
    this.batchOps(() =>
      [g.head, ...g.members.map((x) => x.deal)].forEach((d) => {
        if (d.jobStatus !== 'open' || !this.canDeal('edit.deal', d)) return;
        this.updateDeal(d.id, { jobStatus: 'closed' });
        if (this.sales.deals[d.id]?.jobStatus === 'closed') n++;
      }),
    );
    return n;
  }
  /** Back from ปิดงาน: the header and the members closed with it (on its day; one closed alone earlier, such
   *  as a company that withdrew, stays closed). */
  reopenJoint(hid: string): number {
    const g = jointOf(this.sales, { id: hid });
    if (!g) return 0;
    const day = g.head.closedDate;
    const back = [g.head, ...g.members.map((x) => x.deal).filter((d) => d.jobStatus === 'closed' && (!day || d.closedDate === day))];
    let n = 0;
    this.batchOps(() =>
      back.forEach((d) => {
        if (d.jobStatus !== 'closed' || !this.canDeal('edit.deal', d)) return;
        this.updateDeal(d.id, { jobStatus: 'open' });
        n++;
      }),
    );
    return n;
  }
  /** "ยกเลิกใบเสนอราคาร่วม": the header goes with its documents (the quotation's file to the team Drive's
   *  trash), plan and memberships; the member rows stay, without the QUOTATION note it wrote. */
  cancelJoint(hid: string) {
    if (!this.can('del.rec')) return this.deny();
    const S = this.sales, g = jointOf(S, { id: hid });
    if (!g) return;
    this.batchOps(() => {
      g.members.forEach((x) => {
        const st = stepOf(S, x.deal.id, QUOTE_STAGE);
        if (isJointNote(st.n)) this.setStep(x.deal.id, QUOTE_STAGE, { d: '', n: '' }, true, true);
      });
      this.deleteDealNow(g.head, 'ยกเลิกใบเสนอราคาร่วม');
    });
    this.saveSales();
  }

  // ---- attached documents (quotation / invoice); files go to the team's Drive, a copy stays in this browser
  /** Script supports attachments (null = not checked yet for this connection). */
  teamFiles: boolean | null = null;
  fileTransport: Transport = fileFetchTransport;
  docMsg = '';
  private docUploading = false;
  private docBlobKey = (docId: string) => 'docblob:' + docId;

  /**
   * Attach a document. `info.stage` = the stage the user attached at: a quotation at QUOTATION is the
   * Forecast; an invoice or receipt at a PAY stage (or an installment of the plan, also an extra one)
   * is Actual for that installment. Without a stage it is chosen (attachStage). The stage becomes done
   * on the document date (a PAY stage only with a counted payment): an empty or planned-only stage
   * gets the document's note; a stage with the user's note keeps it and only its date moves.
   * `info.replace` = the counted Actual document at that stage the new one replaces ("ใช้ยอดนี้แทน"): it
   * stays as evidence, no longer counted, and its stage note passes to the new one — so an installment
   * is never counted twice. Without it, both add up ("นับเพิ่ม"); `info.addHand`: the installment's hand
   * receipt adds up with the new one too (else the document replaces it). Only a document counted as
   * money received replaces anything. `info.kept`: the user kept their figure (`amount`) against the
   * document's own (`detected`, "คงยอดเดิม").
   * `info.revise` = the quotation version a revised one follows ("แนบฉบับแก้ไข", lib/quotes): the new one
   * is attached after every version (by `at`), becomes the Forecast, and takes over the QUOTATION note an
   * earlier version filled in (its date, the first send, stays); the earlier versions stay as history,
   * no longer counted. Only a quotation for the Forecast with an amount revises anything.
   */
  async attachDoc(dealId: string, file: Blob & { name: string }, info: { kind: DocKind; amount: number | null; target: DocTarget; basis: DealDoc['basis']; detected: number | null; docNo: string; docDate: string; stage?: string; replace?: string; addHand?: boolean; kept?: boolean; revise?: string }) {
    if (!this.can('docs.up')) throw new Error('บัญชีของคุณแนบเอกสารไม่ได้');
    const d = this.sales.deals[dealId];
    if (!d) throw new Error('ไม่พบรายการนี้แล้ว');
    if (file.size > DOC_MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 10 MB');
    const mime = docMime({ name: file.name || '', type: file.type || '' });
    if (!mime) throw new Error('รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)');
    const S = this.sales, today = todayISO();
    // a joint quotation's member holds no money of its own (its quotation and payments are the joint
    // quotation's): what is attached there is kept as a document that is not counted, at no stage
    if (jointRole(S, d) === 'member') info = { ...info, target: 'none', stage: '', replace: undefined, addHand: false, revise: undefined, kept: false };
    const id = uid();
    const stage = attachStage(S, d, info, today);
    const inList = !!stage && S.cfg.stages.includes(stage); // an extra installment (PAY3) has no step record
    // a revision is numbered after every version, also when this computer's clock is behind the one that attached the last
    const at = info.revise != null ? this.stampAfter(qtVersions(S, d).map((x) => x.at)) : new Date().toISOString();
    const cAt = this.stampAfter([d.fcAt, ...docsOf(S, dealId).map((x) => x.cAt || x.at)]);
    const doc: DealDoc = {
      id, deal: dealId, kind: info.kind, name: (file.name || 'เอกสาร').slice(0, 120), mime, size: file.size, fileId: '',
      docNo: info.docNo.slice(0, 60), docDate: info.docDate, amount: info.amount, target: info.amount == null ? 'none' : info.target,
      detected: info.detected, basis: info.basis, stage, at, cAt, by: this.me(),
    };
    if (info.kept && doc.amount != null) doc.kept = true;
    // fill the stage the document stands for when it is empty, or has only a planned date, and remember
    // the note so it can follow the document (edited amount, deleted document)
    const ad = info.docDate && info.docDate <= today ? info.docDate : today;
    // at a PAY stage only a counted payment completes it: a contract filed there is evidence, not money
    const st = inList && (!isPayStage(S.cfg, stage) || countsActual(doc)) ? stepOf(S, dealId, stage) : null;
    // (a joint quotation made without its file noted its QUOTATION for it: the file takes that note over)
    const noted = !!st?.n.trim() && !(isQtVersion(doc) && isJointNote(st.n) && jointRole(S, d) === 'header');
    if (st && !noted) doc.auto = { stage, n: this.autoNote(doc), d: ad };
    // keep the file in this browser first: it is uploaded to the team's Drive in the background
    let kept = true;
    try {
      await this.store.set(this.docBlobKey(id), { name: doc.name, mime: doc.mime, data: await file.arrayBuffer() });
    } catch {
      kept = false;
    }
    if (!kept) {
      if (!this.teamCfg) throw new Error('บันทึกไฟล์ในเบราว์เซอร์ไม่สำเร็จ (พื้นที่เต็ม?) และยังไม่ได้เชื่อมต่อทีม');
      const r = await uploadDocFile(this.fileTransport, this.teamCfg.url, this.cred(this.teamCfg), { docId: id, name: doc.name, mime: doc.mime, blob: file });
      doc.fileId = r.fileId;
    }
    const k = `${dealId}/${id}`;
    // a document that is not money received (no amount, not Actual) replaces nothing
    const old = info.replace && countsActual(doc) ? S.docs[`${dealId}/${info.replace}`] : undefined;
    // a revised quotation: the versions before it (as this browser has them now, after the file was stored)
    const revising = info.revise != null && isQtVersion(doc) && doc.target === 'forecast';
    const earlier = revising ? qtVersions(S, d) : [];
    const pk = `${dealId}/${stage}`, pl = S.pays[pk];
    this.batchOps(() => {
      S.docs[k] = doc;
      this.op(keyOf.ddoc(dealId, id), { ...doc });
      // the forecast follows the newest confirmed quotation (dealMoney): the deal record is not touched
      if (doc.auto) this.setStep(dealId, stage, { d: ad, n: doc.auto.n }, true, true);
      // the user's note stays; a planned date becomes the document date (only `d`, so a teammate's note edit merges)
      else if (st && noted && (!st.d || st.d > today)) this.setStep(dealId, stage, { d: ad, n: st.n }, true);
      this.salesLog(d, revising ? 'แนบใบเสนอราคาฉบับแก้ไข' : 'แนบ' + KIND_TH[doc.kind], `${doc.name}${doc.amount != null ? ' · ' + fmtMoney(doc.amount) + ' บาท' : ''}${revising ? ' · ฉบับที่ ' + (earlier.length + 1) : ''}`);
      if (old && old.id !== id) {
        if (old.stage === stage && this.autoStillThere(old)) this.handOverAuto(old, S.docs[k], true);
        this.updateDoc(dealId, old.id, { target: 'none' });
      }
      if (revising) {
        // the QUOTATION note a version filled in ("ใบเสนอราคา QT-1 · 192,600 บาท") now names this one
        const owner = earlier.find((x) => x.auto?.stage === stage && this.autoStillThere(x));
        if (owner) this.handOverAuto(owner, S.docs[k], true);
        // one live quotation: every earlier version still counted stops counting (kept as "ฉบับเดิม")
        earlier.filter((x) => x.target === 'forecast').forEach((x) => this.updateDoc(dealId, x.id, { target: 'none' }, { log: false }));
      }
      // paid partly by hand, the rest with this receipt: both count
      if (info.addHand && countsActual(doc) && pl?.rcv && !pl.add) {
        S.pays[pk] = { ...pl, add: true, at, by: this.me() };
        this.op(keyOf.dpay(dealId, stage), { ...S.pays[pk] }, { f: ['add', 'at', 'by'] });
      }
    });
    this.saveSales();
    this.uploadDocs();
    return S.docs[k];
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
  /** `to` (stored) takes over the stage note `from` filled in: the note now names `to`, and follows its
   *  edits and removal. `clear`: `from` stays (a replaced document) and stops owning the note. */
  private handOverAuto(from: DealDoc, to: DealDoc, clear = false) {
    const stage = from.auto!.stage, st = stepOf(this.sales, from.deal, stage), note = this.autoNote(to);
    const tk = `${to.deal}/${to.id}`, fk = `${from.deal}/${from.id}`;
    this.sales.docs[tk] = { ...to, auto: { stage, n: note, ...(from.auto!.d ? { d: from.auto!.d } : {}) } };
    this.op(keyOf.ddoc(to.deal, to.id), { ...this.sales.docs[tk] }, { f: ['auto'] });
    if (clear && this.sales.docs[fk]) {
      const { auto: _a, ...rest } = this.sales.docs[fk];
      this.sales.docs[fk] = rest;
      this.op(keyOf.ddoc(from.deal, from.id), { ...rest }, { f: ['auto'] });
    }
    this.setStep(from.deal, stage, { d: st.d, n: note }, true, true);
  }
  /** Correct a document: its amount, what it counts toward, kind, number, date. A new amount is the
   *  document's figure as the user reads it (a misread corrected, or "ใช้ยอดจากเอกสาร"), so it is no
   *  longer one kept against the document. At a PAY stage a document that stops counting as money
   *  received gives up the stage it completed (releaseAuto). `opt.log` false: no history line of its own
   *  (a step of another action that logs itself); `opt.confirm`: confirmed again even with nothing changed
   *  (an earlier quotation version that is the Forecast again). */
  updateDoc(dealId: string, docId: string, patch: Partial<Pick<DealDoc, 'amount' | 'target' | 'basis' | 'kind' | 'docNo' | 'docDate'>>, opt: { log?: boolean; confirm?: boolean } = {}) {
    const k = `${dealId}/${docId}`, doc = this.sales.docs[k], d = this.sales.deals[dealId];
    if (!doc || !d) return;
    const n: DealDoc = { ...doc, ...patch };
    if (n.amount == null) n.target = 'none';
    if (patch.amount !== undefined && patch.amount !== doc.amount) {
      n.detected = n.amount;
      delete n.kept;
    }
    // (a field dropped, `kept`, is named too: a teammate's copy loses it as well)
    const f = [...new Set([...Object.keys(n), ...Object.keys(doc)])].filter((x) => JSON.stringify(n[x as keyof DealDoc]) !== JSON.stringify(doc[x as keyof DealDoc]));
    if (!f.length && !opt.confirm) return;
    // Changing what it counts toward is a new confirmation (as a quotation it becomes the forecast), and
    // so is a new amount — except on an older quotation a newer one replaced: correcting that record
    // must not make it the forecast again.
    const fcs = docsOf(this.sales, dealId).filter((x) => x.target === 'forecast' && x.amount != null).sort((a, b) => (a.cAt || a.at).localeCompare(b.cAt || b.at));
    // not the figure in use (a newer quotation or a forecast typed after it replaced it): a correction only
    const superseded = doc.target === 'forecast' && dealMoney(this.sales, d).fcDoc?.id !== docId;
    if (opt.confirm || n.target !== doc.target || (n.amount !== doc.amount && !superseded)) {
      n.cAt = this.stampAfter([d.fcAt, ...fcs.filter((x) => x.id !== docId).map((x) => x.cAt || x.at)]);
      f.push('cAt');
    }
    const note = this.autoNote(n);
    if (doc.auto && this.autoStillThere(doc) && this.payAuto(doc) && countsActual(doc) && !countsActual(n)) {
      // no longer money received: the PAY stage it completed passes on, or is empty again
      this.releaseAuto(doc);
      delete n.auto;
      f.push('auto');
    } else if (doc.auto && note !== doc.auto.n && this.autoStillThere(doc)) {
      const st = stepOf(this.sales, dealId, doc.auto.stage);
      n.auto = { ...doc.auto, n: note };
      f.push('auto');
      this.setStep(dealId, doc.auto.stage, { d: st.d, n: note }, true, true);
    }
    this.sales.docs[k] = n;
    this.op(keyOf.ddoc(dealId, docId), { ...n }, { f });
    if (opt.log !== false) this.salesLog(d, 'แก้ไขเอกสาร', `${n.name}${n.amount != null ? ' · ' + fmtMoney(n.amount) + ' บาท' : ''}`);
    this.saveSales();
  }
  /** Whether the stage note a document filled in is a PAY stage's (an installment, also an extra one). */
  private payAuto(doc: DealDoc) {
    return !!doc.auto && (isPayStage(this.sales.cfg, doc.auto.stage) || isExtraPay(this.sales.cfg, doc.auto.stage));
  }
  /** `doc` (deleted, or no longer counted) gives up the stage note it filled in, unless someone has
   *  written in it since: another document for the same stage (a revised quotation, a second invoice)
   *  takes the stage over — at a PAY stage only one counted as money received, as a contract filed
   *  there or a replaced invoice never completes it — else the note goes (a date the user corrected
   *  stays). `doc`'s own record is left to the caller. */
  private releaseAuto(doc: DealDoc) {
    if (!doc.auto || !this.autoStillThere(doc)) return;
    const stage = doc.auto.stage, st = stepOf(this.sales, doc.deal, stage), pay = this.payAuto(doc);
    const heir = docsOf(this.sales, doc.deal)
      .filter((x) => x.id !== doc.id && x.stage === stage && (!pay || countsActual(x)))
      .sort((a, b) => (a.cAt || a.at).localeCompare(b.cAt || b.at))
      .pop();
    const userDate = doc.auto.d && st.d !== doc.auto.d ? st.d : '';
    if (heir) this.handOverAuto(doc, heir);
    else this.setStep(doc.deal, stage, { d: userDate, n: '' }, true, true);
  }
  deleteDoc(dealId: string, docId: string) {
    const k = `${dealId}/${docId}`, doc = this.sales.docs[k], d = this.sales.deals[dealId];
    if (!doc) return;
    this.batchOps(() => {
      // the quotation in use deleted: the version before it is the Forecast again (confirmed anew, so it
      // is the newest confirmation), and so the heir of the QUOTATION note below
      const prev = d && isQtVersion(doc) && dealMoney(this.sales, d).fcDoc?.id === docId ? qtPrev(qtVersions(this.sales, d), docId) : null;
      if (prev) this.updateDoc(dealId, prev.id, { target: 'forecast' }, { log: false, confirm: true });
      // the stage note it filled in goes with it, or passes to another document of that stage
      this.releaseAuto(doc);
      delete this.sales.docs[k];
      this.op(keyOf.ddoc(dealId, docId));
      if (d) this.salesLog(d, 'ลบเอกสาร', doc.name);
    });
    this.dropDocFile(doc);
    this.saveSales();
  }
  /**
   * "เปลี่ยนไฟล์": the same document with another file (a wrong file attached, the signed copy). A new
   * record under a new id takes every value of the old one (amount, number, date, what it counts toward,
   * when it was attached and confirmed, so its version and the Forecast stay as they were) and the stage
   * note it filled in; the old record goes, with its file (team Drive trash, or only this browser's copy
   * when it was never uploaded). A new id, not a new file under the old one: teammates' browsers keep a
   * copy of each file by document id (docBlob) and would go on showing the old one.
   */
  async replaceDocFile(dealId: string, docId: string, file: Blob & { name: string }) {
    if (!this.can('docs.up')) throw new Error('บัญชีของคุณเปลี่ยนไฟล์ไม่ได้');
    const S = this.sales, ok = `${dealId}/${docId}`;
    if (!S.deals[dealId] || !S.docs[ok]) throw new Error('ไม่พบเอกสารนี้แล้ว');
    if (file.size > DOC_MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 10 MB');
    const mime = docMime({ name: file.name || '', type: file.type || '' });
    if (!mime) throw new Error('รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)');
    const id = uid(), name = (file.name || 'เอกสาร').slice(0, 120);
    let fileId = '';
    try {
      await this.store.set(this.docBlobKey(id), { name, mime, data: await file.arrayBuffer() });
    } catch {
      if (!this.teamCfg) throw new Error('บันทึกไฟล์ในเบราว์เซอร์ไม่สำเร็จ (พื้นที่เต็ม?) และยังไม่ได้เชื่อมต่อทีม');
      fileId = (await uploadDocFile(this.fileTransport, this.teamCfg.url, this.cred(this.teamCfg), { docId: id, name, mime, blob: file })).fileId;
    }
    // as it is now (a teammate may have corrected or deleted it while the file was stored)
    const old = S.docs[ok], d = S.deals[dealId];
    if (!old || !d) {
      this.store.del(this.docBlobKey(id)).catch(() => {});
      if (fileId) this.dropDriveFile(fileId);
      throw new Error('ไม่พบเอกสารนี้แล้ว (มีคนลบไประหว่างนี้)');
    }
    const { auto: _a, ...vals } = old;
    const doc: DealDoc = { ...vals, id, name, mime, size: file.size, fileId, by: this.me() };
    // the stage note the old record filled in follows the record (it names the same number and amount)
    if (old.auto && this.autoStillThere(old)) doc.auto = { ...old.auto, n: this.autoNote(doc) };
    const k = `${dealId}/${id}`;
    this.batchOps(() => {
      S.docs[k] = doc;
      this.op(keyOf.ddoc(dealId, id), { ...doc });
      if (doc.auto && doc.auto.n !== old.auto!.n) this.setStep(dealId, doc.auto.stage, { d: stepOf(S, dealId, doc.auto.stage).d, n: doc.auto.n }, true, true);
      delete S.docs[ok];
      this.op(keyOf.ddoc(dealId, docId));
      this.salesLog(d, 'เปลี่ยนไฟล์เอกสาร', `${KIND_TH[doc.kind]}${doc.docNo ? ' ' + doc.docNo : ''} · ${old.name} เป็น ${name}`);
    });
    this.dropDocFile(old);
    this.saveSales();
    this.uploadDocs();
    return S.docs[k];
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
    if (!cfg || !this.can('docs.up')) return void later();
    deleteDocFile(this.fileTransport, cfg.url, this.cred(cfg), fileId).catch(later);
  }
  private async flushDocDeletes(cfg: TeamCfg) {
    if (!this.can('docs.up')) return;
    const q = (await this.store.get<string[]>('docDelQueue').catch(() => null)) || [];
    for (const fileId of q) {
      if (this.teamCfg !== cfg) return;
      try {
        await deleteDocFile(this.fileTransport, cfg.url, this.cred(cfg), fileId);
      } catch {
        return; // still failing: try again after the next sync
      }
      await this.store.update<string[]>('docDelQueue', (cur) => (cur || []).filter((x) => x !== fileId)).catch(() => {});
    }
  }
  /** This browser's copy of a document's file, or null (a thumbnail does not download from Drive). */
  async docLocalBlob(doc: DealDoc): Promise<Blob | null> {
    const b = await this.store.get<{ name: string; mime: string; data: ArrayBuffer }>(this.docBlobKey(doc.id)).catch(() => null);
    return b ? new Blob([b.data], { type: b.mime || doc.mime }) : null;
  }
  /** The file itself: this browser's copy, else downloaded from the team's Drive (and kept). */
  async docBlob(doc: DealDoc): Promise<Blob> {
    const b = await this.store.get<{ name: string; mime: string; data: ArrayBuffer }>(this.docBlobKey(doc.id));
    if (b) return new Blob([b.data], { type: b.mime || doc.mime });
    const cfg = this.teamCfg;
    // the team's copy is opened by whoever may open attached documents (the script checks it too)
    if (!this.can('docs.open')) throw new Error('บัญชีของคุณเปิดเอกสารแนบไม่ได้ (ขอสิทธิ์ “เปิดเอกสารแนบ” ได้ที่ สิทธิ์ของฉัน)');
    if (!doc.fileId) throw new Error('ไฟล์นี้ยังอยู่ในเครื่องของคนที่แนบ ยังไม่ได้อัปโหลดขึ้น Drive ของทีม');
    if (!cfg) throw new Error('เชื่อมต่อทีม (แท็บอัปเดตข้อมูล) ก่อน จึงจะเปิดไฟล์ใน Drive ของทีมได้');
    let r: Awaited<ReturnType<typeof downloadDocFile>>;
    try {
      r = await downloadDocFile(this.fileTransport, cfg.url, this.cred(cfg), doc.fileId);
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
  /** This account's documents whose only copy of the file is in this browser (not uploaded to the
   *  team's Drive yet): the sign-out dialog counts them with the unsent edits. */
  get docsUnsent() {
    const cfg = this.teamCfg;
    return Object.values(this.sales.docs).filter((d) => !d.fileId && this.sales.deals[d.deal] && !this.docsAway.has(d.id) && (!cfg || this.docMine(cfg, d))).length;
  }
  /** Whose file this browser uploads: with accounts, this account's, and those attached here with the
   *  team code (by a name that is not another account's of this browser), as its queue was taken over. */
  private docMine(cfg: TeamCfg, d: DealDoc) {
    return cfg.mode !== 'accounts' || d.by === this.me() || !this.others.some((a) => a.name === d.by);
  }
  /** Upload files attached in this browser to the team's Drive (after each successful sync). */
  /** After a failed upload round the next one waits (1, 2, 4 … up to 30 minutes), not every sync. */
  private docRetryAt = 0;
  private docFails = 0;
  /** Documents the script refused for good (too large…): not re-sent until the page is reloaded. */
  private docRefused = new Set<string>();
  /** Documents whose file is not in this browser (attached on another device). */
  private docsAway = new Set<string>();
  private teamFilesAt = 0;
  /** The upload run in flight: a caller that needs it done (signing out) waits for it. */
  private docRun: Promise<void> | null = null;
  async uploadDocs() {
    const cfg = this.teamCfg;
    if (!cfg || !this.can('docs.up')) return;
    if (this.docRun) return this.docRun;
    // one tab of this browser uploads at a time (they share the files); the others skip this round
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    const run = (locks ? locks.request('gcc-doc-upload', { ifAvailable: true }, (lock) => (lock ? this.uploadDocsNow(cfg) : undefined)) : this.uploadDocsNow(cfg)).then(
      () => {},
      () => {},
    );
    this.docRun = run;
    await run;
    if (this.docRun === run) this.docRun = null;
  }
  private async uploadDocsNow(cfg: TeamCfg) {
    if (this.docUploading || this.teamCfg !== cfg) return;
    this.docUploading = true;
    const failed: string[] = [];
    try {
      await this.flushDocDeletes(cfg);
      // only documents of deals that still exist, and that this browser has the file of
      // with accounts, only this account's files: another person's unsent file on a shared browser is theirs to send
      const todo = Object.values(this.sales.docs).filter((d) => !d.fileId && this.sales.deals[d.deal] && !this.docRefused.has(d.id) && this.docMine(cfg, d));
      if (!todo.length || Date.now() < this.docRetryAt) return;
      // "old script" is checked again every 10 minutes: the lead may deploy the new one meanwhile
      if (this.teamFiles === false && Date.now() - this.teamFilesAt > 10 * 60000) this.teamFiles = null;
      if (this.teamFiles == null) {
        this.teamFiles = await scriptSupportsFiles(this.fileTransport, cfg.url, this.cred(cfg));
        this.teamFilesAt = Date.now();
      }
      if (!this.teamFiles) {
        this.docMsg = 'สคริปต์ของทีมยังเป็นเวอร์ชันเก่า เอกสารจึงเก็บไว้ในเครื่องนี้ — อัปเดต Code.gs แล้ว Deploy เวอร์ชันใหม่ (ดูคู่มือ) เพื่อเก็บใน Drive ของทีม';
        return;
      }
      for (const doc of todo) {
        if (this.teamCfg !== cfg) return;
        const b = await this.store.get<{ name: string; mime: string; data: ArrayBuffer }>(this.docBlobKey(doc.id));
        if (!b) {
          this.docsAway.add(doc.id); // attached on another device
          continue;
        }
        let r: { fileId: string };
        try {
          r = await uploadDocFile(this.fileTransport, cfg.url, this.cred(cfg), { docId: doc.id, name: doc.name, mime: doc.mime, blob: new Blob([b.data], { type: doc.mime }) });
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
    if (!this.can('set.data')) throw new Error('บัญชีของคุณนำเข้าข้อมูลไม่ได้');
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
    if (!this.can('set.data')) {
      this.deny();
      return 0;
    }
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
  /** CSV of a year of Cashflow (lib/cashUi.ts cashRows): the money lines, or the months / quarters summed;
   *  `undated` adds "ยังไม่กำหนดวันรับ" at the end. Same BOM and cells as the tracker's file. */
  exportCashCsv(year: string, lines: CashLine[], mode: CashCsvMode, undated: boolean) {
    const text = cashCsv(cashRows(this.sales, year, cashYear(lines, year), mode, undated));
    downloadBlob(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), `Cashflow_${year}_${todayISO()}.csv`);
  }
  salesCsv(deals: Deal[]) {
    const S = this.sales, C = S.cfg, today = todayISO();
    const head = ['NO.', 'หมวด', 'POTENTIAL CLIENT', 'รหัสบริษัท', 'ผู้ติดต่อ', 'เบอร์', 'อีเมล', 'RESPONSIBLE', 'REFERRAL', 'วันที่ติดต่อ', 'ติดต่อล่าสุด', 'สถานะงาน', 'สถานะ']
      .concat(C.sources.map((x) => 'SOURCE: ' + x), ['SOURCE อื่น'], C.services.map((x) => 'Service: ' + x), ['Services อื่น'], C.stages.flatMap((p) => [p + ' วันที่', p + ' โน้ต']), ['ขั้นตอนอื่น'])
      .concat(['ใบเสนอราคาร่วม', 'FORECAST (บาท)', 'Forecast ยืนยันด้วยเอกสาร', 'ACTUAL (บาท)', 'Actual ยืนยันด้วยเอกสาร', 'เอกสารแนบ', 'แผนชำระ']);
    const lines = deals.map((d, i) => {
      const st = dealStatus(S, d), jr = jointRole(S, d), g = jr === 'plain' ? null : jointOf(S, d);
      // a joint quotation counts once: its header carries the money, a member's cells stay empty (its share said)
      const m = jr === 'member' ? { forecast: null, actual: null, fcConfirmed: false, acConfirmed: false } : dealMoney(S, d);
      const sh = jr === 'member' ? shareOf(S, d) : null;
      const joint = !g ? '' : jr === 'header' ? `${jointTitle(S, g)} · ผู้จ่าย · ${g.members.length} บริษัท` : `${jointTitle(S, g)} · บริษัทร่วม${sh?.amt != null ? ' · ส่วนแบ่ง ' + fmtMoney(sh.amt) : ''}`;
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
        .concat([joint, m.forecast ?? '', m.fcConfirmed ? '✓' : '', m.actual ?? '', m.acConfirmed ? '✓' : '', docs.map((x) => `${KIND_TH[x.kind]} ${x.docNo || x.name}${x.amount != null ? ' ' + fmtMoney(x.amount) : ''}`).join(' | '), planCsv(S, d, today)].map(csvCell))
        .join(',');
    });
    return [head.map(csvCell).join(','), ...lines].join('\r\n');
  }

  // ------------------------------------------------------------------ units, revenue split, commission (package dash)
  /** The units, who is in which and the deals' revenue splits (lib/contrib.ts), read in place. */
  unitCtx(): UnitCtx {
    return unitCtx(this.sales);
  }
  /**
   * Whether this account sees the revenue split and the commission: ดูค่าคอมมิชชั่น / สัดส่วนรายได้ (with
   * accounts the script sends splits and rates to those only), or this browser alone. With the team code
   * there is no identity and every browser would download the rates: the cards stay hidden.
   */
  seesComm(): boolean {
    if (this.teamCfg && this.teamCfg.mode !== 'accounts') return false;
    return this.can('view.money') && this.can('view.comm');
  }
  /**
   * Add (`id` null) or change a unit: its name, commission rate (null = none) and rates by service, and with
   * `members` the names in it (as written: each one moves here from any other unit, and those left out leave
   * it). Rates are effective-dated (contrib withRate): a change prices the money received from today; `back`
   * prices the money before too, for a unit that has only been "ไม่คิด" (rateMode 'choose'). A unit that
   * pays commission takes the first free colour. Returns the unit's id.
   */
  saveUnit(id: string | null, p: { n: string; r: number | null; svc: Record<string, number>; members?: string[]; back?: boolean }): string | undefined {
    if (!this.can('set.units')) return void this.deny();
    const S = this.sales, U = S.units || (S.units = {}), M = S.unitm || (S.unitm = {});
    const n = p.n.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
    if (!n) return;
    const at = new Date().toISOString(), by = this.me();
    const cur = id ? U[id] : undefined;
    const uid2 = cur ? id! : newUnitId(Object.keys(U));
    const today = todayISO();
    const rates = withRate(cur?.rates || [], p.r, p.svc, today, !!p.back);
    const ctx = unitCtx(S);
    const c = cur?.c || (paysComm({ rates }) ? freeSlot(ctx, today, id || '') : 0);
    const o = cur ? cur.o : Math.max(0, ...Object.values(U).map((u) => u.o + 1));
    const rec: UnitRec = { n, c, o, rates, ...(cur?.off ? { off: true } : {}), ...(cur?.offs ? { offs: cur.offs } : {}), at, by };
    this.batchOps(() => {
      const f = cur ? (['n', 'c', 'rates'] as const).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(rec[k])) : [];
      if (!cur || f.length) {
        U[uid2] = rec;
        this.op(keyOf.unit(uid2), unitWire(rec), cur ? { f: [...f, 'at', 'by'] } : {});
      }
      if (p.members) {
        const want = new Map(p.members.map((x) => [staffKey(x), x.trim().replace(/\s+/g, ' ')] as const).filter(([k]) => !!k));
        Object.entries(M).forEach(([k, m]) => {
          if (m.unit !== uid2 || want.has(k)) return;
          delete M[k];
          this.op(keyOf.unitm(k));
        });
        want.forEach((name, k) => {
          if (M[k]?.unit === uid2) return;
          M[k] = { unit: uid2, n: name, at, by };
          this.op(keyOf.unitm(k), { ...M[k] });
        });
      }
    });
    this.saveSales();
    return uid2;
  }
  /** Retire a unit (`off`) or bring it back. A retired one keeps the money received before today (its
   *  members and the splits that name it stay); the money that comes in from today on is
   *  ยังไม่ระบุหน่วยงาน's (contrib lineParts: the span is kept in `offs`, so using it again later does not
   *  give it the money of the days it was retired). It is no longer offered for new splits or people. Used
   *  again while a live unit has its colour, it takes a free one (contrib freeSlot). */
  retireUnit(id: string, off: boolean) {
    if (!this.can('set.units')) return this.deny();
    const cur = this.sales.units?.[id];
    if (!cur || !!cur.off === off) return;
    const { off: _o, offs: _s, ...rest } = cur;
    const today = todayISO();
    const offs = withOff(cur.offs, off, today);
    const c = !off && slotTaken(unitCtx(this.sales), id) ? freeSlot(unitCtx(this.sales), today, id) : cur.c;
    const rec: UnitRec = { ...rest, c, ...(off ? { off: true } : {}), ...(offs.length ? { offs } : {}), at: new Date().toISOString(), by: this.me() };
    this.sales.units![id] = rec;
    this.op(keyOf.unit(id), unitWire(rec), { f: [...(c !== cur.c ? ['c'] : []), 'off', 'offs', 'at', 'by'] });
    this.saveSales();
  }
  /** Put a person (a name as written: an account's display name or a free-text ผู้รับผิดชอบ) in a unit;
   *  '' takes them out of any. */
  setUnitMember(name: string, unit: string) {
    if (!this.can('set.units')) return this.deny();
    const k = staffKey(name);
    if (!k || (unit && !this.sales.units?.[unit])) return;
    const M = this.sales.unitm || (this.sales.unitm = {});
    if ((M[k]?.unit || '') === unit) return;
    if (!unit) {
      delete M[k];
      this.op(keyOf.unitm(k));
    } else {
      M[k] = { unit, n: name.trim().replace(/\s+/g, ' '), at: new Date().toISOString(), by: this.me() };
      this.op(keyOf.unitm(k), { ...M[k] });
    }
    this.saveSales();
  }
  /** A deal's revenue split: units and % adding up to 100 (anything else is refused); null = back to the
   *  default (100% to the ผู้รับผิดชอบ's unit). The deal's history says only that it changed (the split is
   *  for those who may see commission). */
  setShare(id: string, lines: ShareLine[] | null) {
    if (!this.can('edit.share')) return this.deny();
    const d = this.sales.deals[id];
    if (!d) return;
    const D = this.sales.shares || (this.sales.shares = {});
    if (!lines) {
      if (!D[id]) return;
      delete D[id];
      this.op(keyOf.dshare(id));
    } else {
      const clean = lines.map((l) => ({ u: l.u, p: Math.round(l.p * 10) / 10 }));
      if (!shareValid(clean)) return;
      if (D[id] && JSON.stringify(D[id].lines) === JSON.stringify(clean)) return;
      D[id] = { lines: clean, at: new Date().toISOString(), by: this.me() };
      this.op(keyOf.dshare(id), { ...D[id], lines: clean.map((l) => ({ ...l })) });
    }
    this.salesLog(d, lines ? 'แก้สัดส่วนรายได้' : 'ล้างสัดส่วนรายได้');
    this.saveSales();
  }

  // ------------------------------------------------------------------ team sync
  /** Queue a shared-record change (v === undefined → delete). No-op until connected — connecting
   *  uploads everything local that the team sheet doesn't have yet. */
  private op(k: string, v?: unknown, opt: { f?: string[]; lst?: ListEdit; fl?: Record<string, ListEdit>; base?: SyncOp['base']; nx?: boolean } = {}) {
    const cfg = this.teamCfg;
    if (!cfg || this.importing || isLocalOnly(k, v)) return;
    if (!this.canWriteKey(k, v === undefined, v)) {
      // not this account's to change: the next round puts the team's value back
      this.revert.add(k);
      this.teamNote = 'บัญชีของคุณแก้รายการนี้ไม่ได้ จึงใช้ค่าของทีมแทน';
      this.flushSoon();
      return;
    }
    const o = this.mkOp(k, v);
    const prev = this.pending.get(k);
    // Fields and list edits merge here only with a change not stored yet (this batch, or a failed
    // write). A stored one may be another tab's, loaded by a sync round; queueOps merges with the
    // stored queue, taking that tab's values too — merging here as well would apply a list edit twice.
    const mp = prev && ((this.opBatch && this.opBatch.includes(prev)) || this.unsaved.get(k) === prev) ? prev : undefined;
    if (v !== undefined) {
      const nxPrev = !!prev?.nx && !prev.sent;
      // created by an import, or a stage set automatically by a logged call: only fills a gap
      if (this.importNew || opt.nx) o.nx = true;
      else if (nxPrev && opt.f) {
        // a person's edit of an import row not shared yet: if the team has that row, their record wins
        // except for the fields edited here (rebaseOp), so the edit isn't lost
        o.nx = true;
        o.f = [...new Set([...(mp?.f || []), ...opt.f])]; // and queueOps adds the stored import row's
        const fl = mergeFieldLists(mp, opt.f, opt.fl);
        if (fl) o.fl = fl;
      }
      if (!o.nx) {
        const f = mergeFields(mp, opt.f);
        if (f) {
          o.f = f;
          const fl = mergeFieldLists(mp, opt.f!, opt.fl);
          if (fl) o.fl = fl;
          o.seen = Math.min(cfg.seq, mp?.seen ?? cfg.seq);
        }
      }
      const le = opt.lst && mergeListEdits(mp, opt.lst);
      if (le) o.lst = le;
    }
    // conditional only while every queued write to this record is a document's own (setStep auto)
    if (opt.base !== undefined && (!prev || prev.base !== undefined)) o.base = prev ? prev.base : opt.base;
    this.pending.set(k, o);
    this.unsaved.delete(k);
    if (this.opBatch) this.opBatch.push(o);
    else this.queueOps(cfg, [o]);
    this.flushSoon();
  }
  /** Sync shortly (changes made together go in one round). */
  private flushSoon() {
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
    // merged into copies, which replace this tab's ops only once the queue is stored: after a failed
    // write the ops stay as they were (merging them again on the next write would apply an edit twice)
    const out = new Map<string, SyncOp>();
    this.writePending(this.qk(cfg), (ops) => {
      drop.clear();
      out.clear();
      const stored = new Map(ops.map((x) => [x.k, x]));
      byK.forEach((o0, k) => {
        const o: SyncOp = { ...o0 };
        out.set(k, o);
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
        if (o.nx && !o.f && !p.nx && !p.del && k.startsWith('stage/') && p.v !== 'none') {
          drop.add(k); // that tab set the stage by hand: one set automatically by a logged call yields
          return;
        }
        if (o.f && !p.f && !p.del && p.v && typeof p.v === 'object' && o.v && typeof o.v === 'object' && !p.nx) {
          // that tab wrote the whole record (e.g. created it offline): keep it, with this tab's fields on top
          o.v = withFields(p.v as Record<string, unknown>, o);
          delete o.f;
          delete o.fl;
          delete o.seen;
          return;
        }
        if (o.f && o.nx && p.nx) {
          // an edit of an import row not shared yet (see op)
          const fl = mergeFieldLists(p, o.f, o.fl);
          o.f = [...new Set([...(p.f || []), ...o.f])];
          if (fl) o.fl = fl;
          else delete o.fl;
        } else if (o.f) {
          const f = mergeFields(p, o.f);
          if (f && p.f && p.v && typeof p.v === 'object' && o.v && typeof o.v === 'object') {
            // keep that tab's values for the fields it changed and this tab didn't; a list both edited
            // item by item is that tab's list with this tab's items added and removed
            const pv = p.v as Record<string, unknown>, v = { ...(o.v as Record<string, unknown>) };
            p.f.filter((x) => !o.f!.includes(x)).forEach((x) => (x in pv ? (v[x] = pv[x]) : delete v[x]));
            Object.entries(o.fl || {}).forEach(([x, e]) => p.f!.includes(x) && Array.isArray(pv[x]) && (v[x] = applyListEdit((pv[x] as unknown[]).map(String), e)));
            o.v = v;
          }
          const fl = f && mergeFieldLists(p, o.f, o.fl);
          if (f) o.f = f;
          else delete o.f;
          if (fl) o.fl = fl;
          else delete o.fl;
          // that tab's values came from its copy, which may be older than this tab's
          if (f && p.seen != null && o.seen != null) o.seen = Math.min(o.seen, p.seen);
          if (!f) delete o.seen;
        }
        if (o.lst) {
          if (Array.isArray(p.v)) o.v = applyListEdit((p.v as unknown[]).map(String), o.lst); // that tab's list + ours
          const le = mergeListEdits(p, o.lst);
          if (le) o.lst = le;
          else delete o.lst;
        }
      });
      return ops.filter((x) => !byK.has(x.k) || drop.has(x.k)).concat([...out.values()].filter((o) => !drop.has(o.k)));
    }).then(() => {
      out.forEach((n, k) => {
        const o = byK.get(k)! as unknown as Record<string, unknown>;
        Object.keys(o).forEach((x) => !(x in n) && delete o[x]);
        Object.assign(o, n);
      });
      drop.forEach((k) => byK.get(k) && this.pending.get(k) === byK.get(k) && this.pending.delete(k));
    }).catch(() => {
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
    const [crm, contacts, dec, sales, custom, people] = await Promise.all([
      this.store.get<Partial<Crm>>('crm'),
      this.store.get<Record<string, ContactEdit>>('contacts'),
      this.store.get<Record<string, string>>('dedup'),
      this.store.get<SalesState>('sales'),
      this.store.get<Record<string, CustomCo>>('customCos'),
      this.store.get<Record<string, Person>>('people'),
    ]);
    // where this tab's own last save failed, the stored copy is older than this tab's: use this tab's
    const ok = (k: string, v: unknown) => !!v && !this.unstored.has(k);
    return {
      crm: ok('crm', crm) ? { ...emptyCrm(), ...crm } : this.crm,
      contacts: ok('contacts', contacts) ? contacts! : this.contacts,
      dec: ok('dedup', dec) ? dec! : this.dec,
      sales: ok('sales', sales) ? sales! : this.sales,
      custom: ok('customCos', custom) ? custom! : this.custom,
      people: ok('people', people) ? people! : this.people,
    };
  }
  /** The stored queue of a team session: per sheet, and per account when the team signs in (one
   *  person's unsent edits are never sent under another's account on a shared browser). */
  private qk(cfg: TeamCfg) {
    return pendKey(cfg.url) + (cfg.mode === 'accounts' && cfg.u ? '#' + cfg.u : '');
  }
  /** What this session's requests are signed with: the account's token, or the team code. */
  private cred(cfg: TeamCfg): Cred {
    return cfg.mode === 'accounts' ? { tok: this.session && this.session.u === cfg.u ? this.session.tok : '' } : cfg.key;
  }
  /** Read-modify-write of a stored queue (`key` from qk / pendKey; one transaction, so tabs don't
   *  overwrite each other). */
  private writePending(key: string, fn: (ops: SyncOp[]) => SyncOp[]): Promise<SyncOp[]> {
    const p = this.pq.then(() => this.store.update<SyncOp[]>(key, (cur) => fn(Array.isArray(cur) ? cur : [])));
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
    // who is signed in is in PREF.session, not here
    prefs.set(PREF.team, cfg && (({ u: _u, ...rest }) => rest)(cfg));
    this.teamRaw = prefs.getRaw(PREF.team);
    if (cfg) prefs.set(PREF.teamLast, this.unmoved || cfg.url);
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
    if (s && s.url && cfg && s.url === cfg.url && (s.mode || '') === (cfg.mode || '')) {
      // other tabs also save their own cursor and seeding state here; only the code matters
      // (a seeding round reads what this browser has stored, so a following tab may seed too)
      cfg.key = s.key;
      if (s.seeded === false && cfg.seeded) {
        cfg.seeded = false; // another tab imported a backup or reconnected: seed again (harmless)
        this.seedGen++;
      }
      return true;
    }
    if (!cfg && !(s && s.url)) {
      if (this.auth && !this.homeTeam) {
        // another tab went back to working without a team
        this.auth = '';
        this.authUrl = '';
        this.emit();
      }
      return true;
    }
    // another tab moved this browser to the home team's link (its page load): what this tab queued
    // under the old link meanwhile follows
    if (cfg && s && s.url === this.homeTeam && cfg.url !== s.url) this.moveTeam(cfg.url, s.url, cfg.u || '');
    this.endTeam();
    if (s && s.url && s.mode === 'accounts') {
      // the team signs in (another tab switched, or signed in): this tab follows that tab's session
      const ses = prefs.get<Session | null>(PREF.session, null);
      this.sessionRaw = prefs.getRaw(PREF.session);
      if (ses && ses.url === s.url && ses.tok) {
        this.session = ses;
        this.teamCfg = { ...s, seq: 0, u: ses.u };
        this.auth = ses.mc ? 'change' : '';
        if (!this.auth) {
          this.setTeam({ status: 'syncing', msg: '', last: '' });
          this.startTeam();
        } else this.emit();
      } else {
        this.session = null;
        this.authUrl = s.url;
        this.auth = 'login';
        this.setTeam({ status: 'off', msg: '', last: '' });
      }
    } else if (s && s.url) {
      this.auth = '';
      this.teamCfg = { ...s, seq: 0 };
      this.setTeam({ status: 'syncing', msg: '', last: '' });
      this.startTeam();
    } else {
      // (a page of an older version disconnected): with a home team, back to its gate
      this.auth = this.homeTeam ? 'connect' : '';
      this.authUrl = this.homeTeam;
      this.setTeam({ status: 'off', msg: '', last: '' });
      this.teamRetry();
    }
    return false;
  }

  /**
   * One sync round: pull rows newer than the cursor and apply them (skipping keys with local
   * changes still queued), then push the queue. Until `cfg.seeded`, local records the sheet
   * doesn't know yet are queued for upload first; records the sheet already has take its value.
   * Rounds are serialized across tabs with the Web Locks API when available.
   */
  async teamSync(opts: { first?: boolean } = {}) {
    // a sign-in or out in another tab that this one did not hear of (a page restored from the
    // back/forward cache, a frozen tab) is followed before anything is sent as the old account
    if (this.teamCfg) this.adoptSession();
    if (this.teamCfg && !this.adoptTeamPrefs()) return;
    const cfg = this.teamCfg;
    if (!cfg || !this.B || this.auth) return; // signed out / must set a password: nothing is sent
    if (cfg.mode !== 'accounts' && !cfg.key) {
      // back on the team code (the older script pasted back) and no code entered yet: ask for it
      this.teamNeedKey = true;
      if (this.team.status !== 'error') this.setTeam({ status: 'error', msg: CODE_AGAIN });
      return;
    }
    if (this.teamBusy) {
      this.teamAgain = true;
      return;
    }
    const gen = this.teamGen;
    // the token this round is sent with (a failure about an older one is not about this session)
    const tok = cfg.mode === 'accounts' ? this.session?.tok || '' : '';
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
        // say if the script can do accounts (and, with accounts, whether it sends notifications); asked
        // again now and then, as the lead may update it
        if (!this.caps || this.caps.url !== cfg.url || Date.now() - this.capsAt > 10 * 60000) this.probeCaps(cfg.url);
      }
    } catch (e) {
      if (gen === this.teamGen && e instanceof TeamSyncError) {
        const c = e.code;
        if (cfg.mode === 'accounts' && ['session_expired', 'login_required', 'account_disabled', 'must_change_password'].includes(c)) {
          // sent with a token replaced meanwhile (a new password, a renewal in another tab): the
          // answer is about that one, not this session; run again with the current token
          if (this.tokReplaced(tok)) return void (this.teamAgain = true);
          return void this.authLost(c);
        }
        if (cfg.mode !== 'accounts' && c === 'login_required') return void this.toAccounts(cfg);
        if (cfg.mode === 'accounts' && c === 'unauthorized') return void this.maybeLegacy(cfg);
      }
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

  /** Records this tab saw deleted in pulled rows (see syncRound). */
  private goneKeys = new Set<string>();
  /** This tab's copy of a record edited field by field (see syncRound); a stage step not there is empty. */
  private localRecord(k: string): Record<string, unknown> | undefined {
    const i = k.indexOf('/'), type = k.slice(0, i), rest = k.slice(i + 1);
    const S = this.sales;
    const r: object | undefined =
      type === 'deal' ? S.deals[rest]
      : type === 'ddoc' ? S.docs[rest]
      : type === 'dpay' ? S.pays[rest]
      : type === 'dstep' ? S.steps[rest] || { d: '', n: '' }
      : type === 'cust' ? this.custom[rest as unknown as number]
      : type === 'contact' ? this.contacts[rest as unknown as number]
      : type === 'task' ? this.crm.tasks.find((t) => t.id === rest)
      : type === 'person' ? this.people[rest]
      : type === 'jqt' ? S.jqt?.[rest]
      : type === 'jqm' ? S.jqm?.[rest]
      : type === 'scfg' && rest.startsWith('unit.') ? S.units?.[rest.slice(5)]
      : undefined;
    return r && { ...(r as Record<string, unknown>) };
  }

  /** Wait for a round in flight, then run a full one (e.g. to send what is queued before leaving). */
  async teamSyncNow() {
    for (let i = 0; i < 3 && this.teamBusy; i++) await this.teamRunning;
    await this.teamSync();
  }

  /** Pull every row after `since` (in pages). */
  private async pullFrom(cfg: TeamCfg, since: number) {
    const rows: SyncRow[] = [];
    for (;;) {
      // xp: this build knows job expenses (an older one would get an expense's month check as a deletion)
      const r = await call<{ rows: SyncRow[]; more: boolean }>(this.transport, cfg.url, this.cred(cfg), { action: 'pull', since, xp: 1 });
      this.meta(cfg, r);
      rows.push(...r.rows);
      if (r.rows.length) since = r.rows[r.rows.length - 1].seq;
      if (!r.more || !r.rows.length) break;
    }
    return { rows, since };
  }
  /** A reply for this account: a renewed token, or a new name or role set by an admin. */
  private meta(cfg: TeamCfg, r: Record<string, unknown>) {
    // the script's notification state, when a reply says it (hello does too, see setCaps)
    if (r && 'notify' in r) {
      const f = parseNotifyFlag(r.notify);
      if (f) this.heardNotify(cfg.url, f);
    }
    const s = this.session;
    if (cfg.mode !== 'accounts' || !s || s.u !== cfg.u) return;
    let changed = false;
    if (typeof r.tok === 'string' && r.tok && r.tok !== s.tok) {
      s.tok = r.tok;
      s.exp = Number(r.exp) || s.exp;
      changed = true;
    }
    const me = parseMe(r.me);
    if (me.u === s.u && this.adoptMe(s, me)) changed = true;
    if (changed) {
      // signed out in another tab (or someone else signed in) and this tab did not hear of it: the
      // session is never written back (a renewed token would sign the browser in again)
      const p = prefs.get<Session | null>(PREF.session, null);
      if (!p || p.u !== s.u || p.url !== s.url) return void this.adoptSession();
      this.saveSession(s);
      this.emit();
    }
  }

  /**
   * The account as the script describes it now (name, role, capabilities, requests). Returns whether
   * anything changed. A role that gains or loses what the script hides from it (money, commission, job
   * expenses) pulls everything again — the rows it holds were sent without those fields, or with them — one
   * that may no longer open documents drops the copies kept in this browser, and one that may no longer see
   * job expenses drops them at once.
   */
  private adoptMe(s: Session, me: ReturnType<typeof parseMe>) {
    const before = capsOf(s) || {};
    const was = { name: s.name, role: s.role, rid: s.rid, rn: s.rn, caps: JSON.stringify(s.caps ?? null), rq: s.rq, req: JSON.stringify(s.req ?? null), g: JSON.stringify(s.g ?? null), nf: JSON.stringify(s.nf ?? null) };
    if (me.name) s.name = me.name;
    if (me.role) s.role = me.role;
    if (me.rid !== undefined) s.rid = me.rid;
    if (me.rn !== undefined) s.rn = me.rn;
    if (me.caps !== undefined) s.caps = me.caps;
    if (me.rq !== undefined) s.rq = me.rq;
    if (me.req !== undefined) s.req = me.req;
    if (me.g !== undefined) s.g = me.g;
    if (me.nf !== undefined) s.nf = me.nf;
    const nfOnly = was.nf !== JSON.stringify(s.nf ?? null);
    const changed = was.name !== s.name || was.role !== s.role || was.rid !== s.rid || was.rn !== s.rn || was.caps !== JSON.stringify(s.caps ?? null) || was.rq !== s.rq || was.req !== JSON.stringify(s.req ?? null) || was.g !== JSON.stringify(s.g ?? null);
    if (!changed) return nfOnly;
    const after = capsOf(s) || {};
    const roleNow = s.rid || s.role, roleWas = was.rid || was.role;
    const res = s.req?.st === 'r' ? s.req : null;
    // a temporary role or extra that ran out (the dates the script sent before, me.grants)
    const today = todayISO();
    const oldG = was.g !== 'null' ? (JSON.parse(was.g) as Session['g']) : undefined;
    // the script keeps a lapsed entry (until an admin's next look) but no longer applies it, so whatever this
    // browser's clock says: the same temporary role still listed but no longer in force, or an extra
    // still listed whose capability went
    const newG = s.g;
    const sameR = !!oldG?.r && !!newG?.r && newG.r.id === oldG.r.id && newG.r.until === oldG.r.until;
    const lapsed =
      (sameR && roleWas === oldG!.r!.id && roleNow !== oldG!.r!.id) ||
      (newG?.c || []).some((x) => !!x.until && (oldG?.c || []).some((o) => o.k === x.k && o.until === x.until) && !!before[x.k as CapId] && !after[x.k as CapId]);
    const ranOut = lapsed || (!!oldG && (!!(oldG.r && oldG.r.until && oldG.r.until < today) || (oldG.c || []).some((x) => !!x.until && x.until < today)));
    if (roleNow !== roleWas && !res) {
      // the role changed (a decided request says so itself, in the banner)
      this.teamNote = ranOut
        ? `บทบาทชั่วคราวหมดอายุแล้ว ตอนนี้คุณเป็น ${this.roleName()}`
        : !hasWrite(after) && hasWrite(before)
          ? `ผู้ดูแลระบบเปลี่ยนบัญชีของคุณเป็น ${this.roleName()} — แก้ไขข้อมูลไม่ได้แล้ว`
          : `ผู้ดูแลระบบเปลี่ยนบทบาทของคุณเป็น ${this.roleName()}`;
    } else if (!res && was.caps !== 'null' && JSON.stringify(before) !== JSON.stringify(after)) {
      // the same role, other capabilities: the role was edited, or an extra was added or ran out
      this.teamNote = ranOut ? 'สิทธิ์เพิ่มชั่วคราวหมดอายุแล้ว · ดูได้ที่ สิทธิ์ของฉัน ในเมนูบัญชี' : 'สิทธิ์ของคุณเปลี่ยนแล้ว · ดูได้ที่ สิทธิ์ของฉัน ในเมนูบัญชี';
    }
    // what the script leaves out depends on these three: the rows held here were sent for the old set
    const real = (c: CapSet) => `${!!c['view.money']}|${!!c['view.comm']}|${!!c['view.exp']}`;
    const cfg = this.teamCfg;
    if (real(before) !== real(after) && cfg && cfg.mode === 'accounts' && cfg.u === s.u) {
      // the next round pulls every row again (each record is replaced whole); set after this round ends,
      // which may be the one that brought the news
      this.repull = true;
      this.flushSoon();
    }
    if ((before['docs.open'] && !after['docs.open']) || (before['view.money'] && !after['view.money'])) this.purgeDocCopies();
    // the job expenses go at once (the pull that follows brings them as deletions anyway)
    if (before['view.exp'] && !after['view.exp'] && purgeExpenses(this.sales)) this.saveSales();
    return true;
  }
  /** The account's capabilities changed what the script sends it: pull everything again (adoptMe). */
  private repull = false;
  /** Copies of the team's documents kept in this browser (those the team's Drive has: a file not uploaded
   *  yet is someone's only copy and stays). */
  private purgeDocCopies() {
    const ids = Object.values(this.sales.docs).filter((d) => d.fileId).map((d) => d.id);
    ids.forEach((id) => this.store.del(this.docBlobKey(id)).catch(() => {}));
    qtFacts.clear(); // what was read from them (figures) goes too
  }

  private async syncRound(cfg: TeamCfg, gen: number, first: boolean) {
    // changes this account may not make, and records another account of this browser has not sent,
    // put back to the team's value in this round (kept for the next one if this round fails before applying)
    const rv = new Set(this.revert), hd = new Set(this.hidden);
    this.revert.clear();
    this.hidden.clear();
    let applied = false;
    try {
      return await this.syncRoundBody(cfg, gen, first, rv, hd, () => (applied = true));
    } finally {
      if (!applied) {
        rv.forEach((k) => this.revert.add(k));
        if (gen === this.teamGen) hd.forEach((k) => this.hidden.add(k));
      }
    }
  }
  /** Queued deletions of a deal, customer or person this account may not make, with what went with
   *  them (a deal's stage notes, documents, payment plan, contact records and history entry; a person's notes). */
  private refusedCascade(ops: SyncOp[]) {
    const cut = new Set<string>(), deals = new Set<string>(), people = new Set<string>();
    const del = (o: SyncOp) => !!o.del || o.v == null;
    ops.forEach((o) => {
      const m = /^(deal|cust|person)\/(.+)$/.exec(o.k);
      if (!m || !del(o) || this.canWriteKey(o.k, true)) return;
      cut.add(o.k);
      if (m[1] === 'deal') deals.add(m[2]);
      if (m[1] === 'person') people.add(m[2]);
    });
    if (cut.size)
      ops.forEach((o) => {
        const [type, id] = o.k.split('/');
        const v = o.v as Partial<DealLog> | undefined;
        if (
          (del(o) && (type === 'dstep' || type === 'ddoc' || type === 'dpay' || type === 'dact' || type === 'jqt') && deals.has(id)) ||
          (del(o) && type === 'jqm' && (deals.has(id) || deals.has(o.k.split('/')[2]))) ||
          (type === 'dundo' && deals.has(id)) ||
          (type === 'dlog' && !!v && deals.has(v.deal || '') && (v.action === 'ลบลูกค้า' || v.action === 'ยกเลิกการนำเข้า')) ||
          (del(o) && type === 'log' && id.startsWith('p-') && people.has(id.slice(2)))
        )
          cut.add(o.k);
      });
    return cut;
  }
  private async syncRoundBody(cfg: TeamCfg, gen: number, first: boolean, rv: Set<string>, hd: Set<string>, onApplied: () => void) {
    const live = () => this.teamCfg === cfg && gen === this.teamGen;
    // the stored queue is shared by every tab: start from it (another tab may have pushed or added
    // ops), plus this tab's ops that could not be stored
    await this.pq;
    const s = this.session;
    if (cfg.mode === 'accounts' && s && this.canWrite()) {
      // edits queued with the team code after this account signed in (a tab of the older app still
      // open): sent in its name, as those queued before it signed in
      const old = (await this.store.get<SyncOp[]>(pendKey(cfg.url)).catch(() => null)) || [];
      if (old.length) {
        const ids = new Set(old.map((o) => o.id));
        await this.writePending(this.qk(cfg), (cur) => newestPerKey([...cur, ...old.map(this.stampFor(s))]))
          .then(() => this.writePending(pendKey(cfg.url), (cur) => cur.filter((o) => !ids.has(o.id))))
          .catch(() => {});
        if (!live()) return;
      }
    }
    const stored = await this.store.get<SyncOp[]>(this.qk(cfg));
    if (!live()) return;
    const fresh = Array.isArray(stored) ? stored.filter((o) => !this.wasDelivered(o)) : null;
    this.pending = this.withUnsaved(fresh ? new Map(fresh.map((o) => [o.k, o])) : this.pending);
    if (this.canWrite() && !this.can('del.rec')) {
      // A deletion this account may not make (queued with the team code, or before an admin made it
      // sales) is refused by the script, but what went with it would not be: the stage notes,
      // documents and their Drive files, the history entry. None of it is sent; the team's values come back.
      const cut = this.refusedCascade([...this.pending.values()]);
      if (cut.size) {
        cut.forEach((k) => (this.pending.delete(k), this.unsaved.delete(k), rv.add(k)));
        await this.writePending(this.qk(cfg), (ops) => ops.filter((o) => !cut.has(o.k))).catch(() => {});
        this.teamNote = `มี ${fmtN(cut.size)} รายการที่บัญชีของคุณแก้ไม่ได้ จึงใช้ค่าของทีมแทน`;
        if (!live()) return;
      }
    }
    if (cfg.mode === 'accounts' && !this.acctsRead.has(cfg)) {
      // On a shared computer, records another account made here and has not sent yet (still in its
      // queue) are not this account's to see or send: they leave this view, and stay queued for it.
      this.acctsRead.add(cfg);
      this.others = (await this.accts(cfg.url)).filter((a) => a.u !== cfg.u);
      for (const a of this.others) ((await this.store.get<SyncOp[]>(pendKey(cfg.url) + '#' + a.u).catch(() => null)) || []).forEach((o) => hd.add(o.k));
      if (!live()) return;
    }
    const seeding = first || !cfg.seeded;
    const from = seeding ? 0 : cfg.seq;
    const pulled = await this.pullFrom(cfg, from);
    const rows = pulled.rows;
    let since = pulled.since;
    if (!live()) return;
    // the team's value of each refused record (its last row since the start; no row: it goes)
    const back: SyncRow[] = [], quiet = new Set<string>();
    if (rv.size || hd.size) {
      const all = from === 0 ? rows : (await this.pullFrom(cfg, 0)).rows;
      if (!live()) return;
      const last = new Map<string, SyncRow>(), now = new Set(rows.map((r) => r.k));
      all.forEach((r) => (rv.has(r.k) || hd.has(r.k)) && last.set(r.k, r));
      rv.forEach((k) => {
        // queued again since, or in this round's rows anyway (newer than the full pull's)
        if (this.pending.has(k) || now.has(k)) return;
        const r = last.get(k);
        if (r) back.push(r);
        else if (k.startsWith('scfg/')) {
          const name = k.slice(5) as keyof SalesCfg;
          if (name in this.sales.cfg) {
            this.sales.cfg[name] = emptyCfg()[name];
            this.saveSales();
          }
        }
        // a deal made here that the team never got (a viewer's) goes; a refused deletion of one leaves
        // nothing to put back without a team row (the deal is gone here already)
        else if (!k.startsWith('deal/') || this.sales.deals[k.slice(5)]) back.push({ seq: 0, k, v: null, del: true, by: '', at: '' });
      });
      hd.forEach((k) => {
        if (this.pending.has(k) || rv.has(k) || now.has(k)) return;
        const r = last.get(k);
        if (r) back.push(r);
        else {
          quiet.add(k); // not the team's: it only leaves this view (its files and the rest stay)
          back.push({ seq: 0, k, v: null, del: true, by: '', at: '' });
        }
      });
      // a document put back keeps its file in the team's Drive (a refused deletion queued it to be trashed)
      const files = [...rv].map((k) => last.get(k)).map((r) => (r && r.k.startsWith('ddoc/') && !r.del ? (r.v as DealDoc | null)?.fileId : '')).filter(Boolean);
      if (files.length) await this.store.update<string[]>('docDelQueue', (q) => (q || []).filter((x) => !files.includes(x))).catch(() => {});
      if (!live()) return;
    }
    // A push whose reply was lost (tab closed, timeout) may still have reached the sheet. An op sent
    // when the sheet was at seq S is settled once the sheet has its own row after S: it was delivered
    // (a teammate's row after that is newer and wins). A teammate's row alone does not settle it — the
    // push may have failed (a deletion, or an edit made while the previous push was in flight), and it
    // is kept and merged with theirs (rebaseOp) rather than lost.
    const lastSeq = new Map(rows.map((r) => [r.k, r.seq]));
    const own = (o: SyncOp) =>
      rows.some((r) => r.k === o.k && r.seq > o.sent! && r.by === String(o.by || '').slice(0, 100) && (o.del ? r.del : !r.del && JSON.stringify(r.v) === JSON.stringify(o.v)));
    // Compaction drops a row once a later one for its record exists, so a delivered whole value can
    // have no own row left: where the rows since it was sent have gaps, the earlier rule applies to it.
    const gap = (o: SyncOp) => {
      const n = rows.filter((r) => r.seq > o.sent!).length;
      return n > 0 && rows[rows.length - 1].seq - o.sent! !== n;
    };
    const settled = (o: SyncOp) => o.sent != null && (lastSeq.get(o.k) ?? -1) > o.sent && (own(o) || (!(o.f || o.lst) && gap(o)));
    if ([...this.pending.values()].some(settled)) {
      this.pending.forEach((o, k) => settled(o) && this.pending.delete(k));
      this.unsaved.forEach((o, k) => settled(o) && this.unsaved.delete(k));
      await this.writePending(this.qk(cfg), (ops) => ops.filter((o) => !settled(o))).catch(() => {});
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
        if (this.pending.has(k) || !this.canWriteKey(k, false) || hd.has(k)) return; // not another account's
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
        (await this.writePending(this.qk(cfg), (ops) => ops.filter((x) => !keys.has(x.k)).concat(add)).then(
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
    // a deal the team deleted: notes, documents, plan lines and contacts this browser queued for it are dropped too
    const lastDeal = new Map<string, SyncRow>();
    rows.forEach((r) => r.k.startsWith('deal/') && lastDeal.set(r.k.slice(5), r));
    const goneNow = new Set([...lastDeal].filter(([, r]) => r.del || r.v == null).map(([id]) => id));
    this.pending.forEach((o, k) => {
      const m = /^(dstep|ddoc|dpay|dact)\/([^/]+)\//.exec(k);
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
        revised.set(k, { ...o, v: res.v, ...(o.seen != null && { seen: since }) });
        merged.push({ ...r, v: res.v, del: false });
      }
    });
    // A field change queued by another tab of this browser was made on that tab's copy, which may be
    // older than this tab's: what this tab pulled since (not pulled again now) goes under its fields.
    this.pending.forEach((o, k) => {
      if (lastRow.has(k) || !o.f || o.nx || o.del || o.base !== undefined || o.seen == null || o.seen >= cfg.seq || dropped.includes(o)) return;
      const cur = this.localRecord(k);
      if (!cur) {
        // deleted by a teammate in a row this tab already pulled: the deletion wins over an edit
        const deal = /^(?:deal|ddoc|dpay)\/([^/]+)/.exec(k)?.[1];
        if (this.goneKeys.has(k) || (deal && this.sales.gone?.[deal])) dropped.push(o);
        return;
      }
      const v = withFields(cur, o);
      revised.set(k, { ...o, v, seen: since });
    });
    if (dropped.length || revised.size) {
      dropped.forEach((o) => (this.pending.delete(o.k), this.unsaved.delete(o.k)));
      revised.forEach((n, k) => {
        this.pending.set(k, n);
        if (this.unsaved.has(k)) this.unsaved.set(k, n);
      });
      const gone = new Set(dropped.map((o) => o.id));
      await this.writePending(this.qk(cfg), (ops) => ops.filter((x) => !gone.has(x.id)).map((x) => (revised.get(x.k)?.id === x.id ? revised.get(x.k)! : x))).catch(() => {});
      if (!live()) return;
      // a document deleted by a teammate while this browser was uploading its file: the file goes too
      dropped.forEach((o) => {
        const doc = o.k.startsWith('ddoc/') ? (o.v as DealDoc | undefined) : undefined;
        if (doc?.fileId) this.dropDocFile(doc);
      });
    }
    this.applyRows(rows.filter((r) => !this.pending.has(r.k)).concat(merged, seedMerged, back), quiet);
    onApplied();
    cfg.seq = since;
    if (this.repull) {
      this.repull = false;
      cfg.seq = 0;
      this.teamAgain = true;
    }
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
    // an account that can only read sends nothing; its queue (made before) waits for someone who can
    if (!this.canWrite()) {
      if (this.pending.size) this.teamNote = `บัญชีดูอย่างเดียวส่งการแก้ไขไม่ได้ · รอส่ง ${fmtN(this.pending.size)} รายการ`;
      return;
    }
    let rejected = 0;
    while (this.pending.size && live()) {
      const batch = [...this.pending.values()].slice(0, 300);
      // remember the sheet's position when sending, to recognise a delivery whose reply is lost
      const at = cfg.seq;
      const ids = new Set(batch.map((o) => o.id));
      batch.forEach((o) => (o.sent = at));
      await this.writePending(this.qk(cfg), (ops) => ops.map((x) => (ids.has(x.id) ? { ...x, sent: at } : x))).catch(() => {});
      if (!live()) return;
      let r: { rejected?: string[]; denied?: string[] };
      try {
        r = await call<{ rejected?: string[]; denied?: string[] }>(this.transport, cfg.url, this.cred(cfg), { action: 'push', ops: batch.map(({ k, v, del, by }) => ({ k, v, del, by })) });
      } catch (e) {
        // the sheet answered and refused (busy, wrong code): these were certainly not delivered
        if (e instanceof TeamSyncError && e.code) {
          batch.forEach((o) => delete o.sent);
          await this.writePending(this.qk(cfg), (ops) => ops.map((x) => (ids.has(x.id) ? (({ sent: _s, ...y }) => y)(x) : x))).catch(() => {});
        }
        throw e;
      }
      this.meta(cfg, r);
      rejected += (r.rejected || []).length;
      // changes this account may not make (the script decides): dropped below with the batch, and the
      // team's value put back by the next round
      const den = r.denied || [];
      if (den.length) {
        den.forEach((k) => this.revert.add(k));
        this.teamNote = `มี ${fmtN(den.length)} รายการที่บัญชีของคุณแก้ไม่ได้ จึงใช้ค่าของทีมแทน`;
        this.teamAgain = true;
      }
      // done: the op that was sent, or an older change to a record whose newer value was sent;
      // a change made while the request was in flight stays queued
      const sent = new Map(batch.map((o) => [o.k, o]));
      const done = (o: SyncOp) => {
        const x = sent.get(o.k);
        return !!x && (x.id === o.id || !newer(o, x));
      };
      this.unsaved.forEach((o, k) => done(o) && this.unsaved.delete(k));
      // acknowledged in this sheet's own queue even if the session changed meanwhile (they were delivered)
      const left = await this.writePending(this.qk(cfg), (ops) => ops.filter((o) => !done(o) && !this.wasDelivered(o))).then(
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

  /** Apply pulled rows (oldest first) and refresh whatever they affect. `quiet`: records that only
   *  leave this view (another account's not sent yet): nothing that goes with a deletion happens. */
  private applyRows(rows: SyncRow[], quiet = new Set<string>()) {
    if (!rows.length) return;
    const fx = noEffects();
    const gone = rows.filter((r) => (r.del || r.v == null) && !quiet.has(r.k));
    // a teammate deleted a document: its Drive file goes (whoever deleted it may not have known the
    // file yet) and so does this browser's copy of it
    const delDocs = gone.filter((r) => r.k.startsWith('ddoc/')).map((r) => this.sales.docs[r.k.slice(5)]).filter(Boolean);
    rows.forEach((r) => (r.del || r.v == null ? !quiet.has(r.k) && this.goneKeys.add(r.k) : this.goneKeys.delete(r.k)));
    this.forgetPeople(gone.filter((r) => r.k.startsWith('person/')).map((r) => r.k.slice(7)));
    rows.forEach((r) => applyRow(this, r, fx));
    const unmark = (S: SalesState) => quiet.forEach((k) => k.startsWith('deal/') && S.gone && delete S.gone[k.slice(5)]);
    unmark(this.sales); // not deleted by anyone
    delDocs.forEach((doc) => !this.sales.docs[`${doc.deal}/${doc.id}`] && this.dropDocFile(doc));
    // a teammate deleted a deal: the notes and documents this browser has for it go too — also those
    // the teammate had not seen yet (added here meanwhile), which would otherwise be left orphaned
    const goneDeals = gone.filter((r) => r.k.startsWith('deal/') && !this.sales.deals[r.k.slice(5)]).map((r) => r.k.slice(5));
    if (goneDeals.length)
      this.batchOps(() =>
        goneDeals.forEach((id) => {
          this.dropDealRecords(id);
          fx.sales = true;
        }),
      );
    // Save by applying the same rows to what is stored rather than writing this tab's whole copy:
    // another tab may have stored records this tab has never seen (e.g. local-only TGO companies).
    const merged = (s: SharedState) => {
      rows.forEach((r) => applyRow(s, r, noEffects()));
      unmark(s.sales);
      return s;
    };
    const none = { crm: emptyCrm(), contacts: {}, dec: {}, sales: emptySales(), custom: {}, people: {} };
    if (fx.crm) this.store.update<Partial<Crm>>('crm', (cur) => (cur ? merged({ ...none, crm: { ...emptyCrm(), ...cur } }).crm : this.crm)).catch(() => {});
    if (fx.contacts.size || fx.contactDel)
      this.store.update<Record<string, ContactEdit>>('contacts', (cur) => (cur ? merged({ ...none, contacts: cur }).contacts : this.contacts)).catch(() => {});
    if (fx.dedup) this.store.update<Record<string, string>>('dedup', (cur) => (cur ? merged({ ...none, dec: cur }).dec : this.dec)).catch(() => {});
    if (fx.sales)
      this.store.update<SalesState>('sales', (cur) => (cur ? merged({ ...none, sales: { ...emptySales(), ...cur, cfg: { ...emptyCfg(), ...cur.cfg } } }).sales : this.sales)).catch(() => {});
    if (fx.custom) this.store.update<Record<string, CustomCo>>('customCos', (cur) => (cur ? merged({ ...none, custom: cur }).custom : this.custom)).catch(() => {});
    if (fx.people) this.store.update<Record<string, Person>>('people', (cur) => (cur ? merged({ ...none, people: cur }).people! : this.people)).catch(() => {});
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
    if (this.foreign(url)) return false; // the site's own team only
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
      if (e instanceof TeamSyncError && e.code === 'login_required') {
        // this team signs in with personal accounts now: the team code is not needed
        this.setTeam({ status: 'off', msg: '' });
        await this.teamOpen(url);
        return false;
      }
      this.setTeam({ status: 'error', msg: errText(e, url === this.homeTeam ? 'home' : 'connect') });
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
    // this team signed in with accounts before going back to the team code: their unsent edits go as
    // they were made, in their names (this browser may show another account's values for them now)
    const acctQ: { k: string; ops: SyncOp[] }[] = [];
    for (const a of await this.accts(url)) {
      const k = pendKey(url) + '#' + a.u;
      const q = (await this.store.get<SyncOp[]>(k).catch(() => null)) || [];
      if (q.length) acctQ.push({ k, ops: q.map((o) => ({ ...o, by: a.name })) });
    }
    const acctOps = newestPerKey(acctQ.flatMap((x) => x.ops)), acctKeys = new Set(acctOps.map((o) => o.k));
    const local = localRecords(await this.storedShared());
    const t = this.opTick();
    const requeue = (cur: SyncOp[]) =>
      [...new Map([...moved, ...carried, ...cur].map((o) => [o.k, o])).values()]
        .filter((p) => !acctKeys.has(p.k))
        .map((p) => {
          const o = this.mkOp(p.k, local.get(p.k), t);
          if (o.v !== undefined && p.f && !p.del) {
            o.f = p.f; // still only those fields of ours
            if (p.fl) o.fl = p.fl;
          }
          if (o.v !== undefined && p.lst && !p.del) o.lst = p.lst;
          if (o.v !== undefined && p.nx && !p.del) o.nx = true; // still only filling a gap
          if (p.base !== undefined) o.base = p.base; // still only over what was seen there
          return o;
        })
        .concat(acctOps);
    let ops: SyncOp[];
    try {
      ops = await this.writePending(pendKey(url), requeue);
      if (moved.length) await this.writePending(pendKey(last), () => []).catch(() => {});
      for (const x of acctQ) await this.writePending(x.k, () => []).catch(() => {});
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
  // ------------------------------------------------------------------ team accounts
  /** Changes of this tab's session (see load). */
  private sessionN = 0;
  private saveSession(s: Session | null) {
    this.sessionN++;
    if (s) prefs.set(PREF.session, s);
    else prefs.del(PREF.session);
    this.sessionRaw = prefs.getRaw(PREF.session);
  }
  /** Ask a team-code team's script whether it can do accounts (the team card says so). */
  private probeCaps(url: string) {
    this.capsAt = Date.now(); // one question at a time
    hello(this.transport, url).then(
      (c) => {
        this.setCaps(c, url);
        this.emit();
      },
      () => {},
    );
  }
  private setCaps(c: Caps, url: string) {
    this.caps = { ...c, url };
    this.capsAt = Date.now();
    if (c.v === 3) this.heardNotify(url, c.nf ?? null);
  }
  /** The script's public values for hashing a password (team id, rounds); they never change. */
  private async capsFor(url: string) {
    if (this.caps && this.caps.url === url && this.caps.v === 3 && this.caps.tid) return this.caps;
    const c = await hello(this.transport, url);
    this.setCaps(c, url);
    if (c.v !== 3 || !c.tid) throw new Error('สคริปต์ของทีมยังไม่รองรับบัญชีผู้ใช้ — ให้หัวหน้าทีมอัปเดต Code.gs');
    return this.caps!;
  }
  /** Whether `tok` is no longer this session's token (changed here, or in another tab of this browser). */
  private tokReplaced(tok: string) {
    const s = this.session, p = prefs.get<Session | null>(PREF.session, null);
    return (s?.tok || '') !== tok || (!!p?.tok && p.u === s?.u && p.url === s?.url && p.tok !== tok);
  }
  /** The session can't go on (expired, disabled, must set a password): sync pauses, edits keep queuing. */
  private authLost(code: string) {
    this.auth = code === 'account_disabled' ? 'disabled' : code === 'must_change_password' ? 'change' : 'expired';
    this.stopTeam();
    const s = this.session;
    if (s && this.auth === 'expired') {
      s.tok = ''; // other tabs follow
      this.saveSession(s);
    } else if (s && this.auth === 'change') {
      s.mc = true;
      this.saveSession(s);
    }
    const msg = { disabled: 'บัญชีนี้ถูกปิดการใช้งาน', change: 'ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน', expired: 'หมดเวลาการเข้าระบบ — เข้าสู่ระบบอีกครั้งเพื่อซิงก์ต่อ' }[this.auth];
    this.setTeam({ status: 'error', msg });
  }
  /** The team has just switched to personal accounts (the lead set up the first admin): sign in.
   *  What this browser queued with the team code is kept, and sent under the account signed in. */
  private toAccounts(cfg: TeamCfg) {
    this.saveTeamCfg({ url: cfg.url, key: '', seq: 0, seeded: cfg.seeded, mode: 'accounts' });
    this.endTeam();
    this.session = null;
    this.authUrl = cfg.url;
    this.auth = 'login';
    this.authMsg = 'ทีมของคุณเปลี่ยนมาใช้บัญชีผู้ใช้แล้ว เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านจากผู้ดูแลระบบ';
    this.setTeam({ status: 'off', msg: '', last: '' });
    this.probeCaps(cfg.url);
  }
  /** The script refused the token as a team-code script would: if it went back to the team code
   *  (an older Code.gs pasted back), unsent edits go back to the sheet's queue. */
  private async maybeLegacy(cfg: TeamCfg) {
    let c: Caps | null = null;
    try {
      c = await hello(this.transport, cfg.url);
    } catch (e) {
      // can't tell now (offline): polling goes on, and the next round asks again
      if (this.teamCfg === cfg) this.setTeam({ status: 'error', msg: errText(e) });
      return;
    }
    if (this.teamCfg !== cfg) return;
    this.setCaps(c, cfg.url);
    if (c.v === 3 && c.mode === 'accounts') return this.authLost('session_expired');
    await this.backToCode(cfg.url);
  }
  /** A sign-in (or new password) the script answered as a team-code script would, or whose `hello`
   *  says it is one: if it went back to the team code, so does this browser (backToCode). */
  private async codeAgain(url: string, e: unknown, u = '') {
    const legacy = (c: Caps | null) => !!c && (c.v === 2 || c.mode === 'legacy');
    if (!legacy(this.caps?.url === url ? this.caps : null) && !(e instanceof TeamSyncError && ['unauthorized', 'no_accounts'].includes(e.code))) return false;
    try {
      this.setCaps(await hello(this.transport, url), url); // the cached answer may be from before
    } catch {
      return false;
    }
    if (!legacy(this.caps)) return false;
    await this.backToCode(url, u);
    return true;
  }
  /** On the sign-in screen of a team with accounts (page load): if its script went back to the team
   *  code, go back with it now rather than when signing in fails. */
  private checkCode(url: string) {
    hello(this.transport, url).then(
      (c) => {
        this.setCaps(c, url);
        const here = (this.auth === 'login' && !this.teamCfg && this.authUrl === url) || (this.auth === 'expired' && this.teamCfg?.url === url);
        if (here && (c.v === 2 || c.mode === 'legacy')) this.backToCode(url);
      },
      () => {},
    );
  }
  /**
   * The older Code.gs was pasted back (rollback): the team-code form asks for the code again. Every
   * account's unsent edits on this browser go back to the sheet's queue, in its name, so nothing
   * queued is lost; `u`: the account trying to sign in, whose name this browser uses from now on.
   */
  private async backToCode(url: string, u = '') {
    const s = this.session?.url === url ? this.session : null;
    const t = prefs.get<TeamCfg | null>(PREF.team, null);
    const seeded = this.teamCfg?.url === url ? !!this.teamCfg.seeded : t?.url === url && !!t.seeded;
    const accts = await this.accts(url);
    if (s && !accts.some((a) => a.u === s.u)) accts.push({ u: s.u, name: s.name });
    for (const a of accts) {
      const k = pendKey(url) + '#' + a.u;
      const ops = (await this.store.get<SyncOp[]>(k).catch(() => null)) || [];
      if (!ops.length) continue;
      try {
        await this.writePending(pendKey(url), (cur) => newestPerKey([...cur, ...ops.map((o) => ({ ...o, by: a.name }))]));
        await this.writePending(k, () => []);
      } catch {
        /* stays where it was: teamConnect takes it */
      }
    }
    const name = s?.name || accts.find((a) => a.u === (u || this.lastUser?.u))?.name || '';
    if (name) prefs.set(PREF.me, name);
    this.endTeam();
    this.saveSession(null);
    this.session = null;
    const n: TeamCfg = { url, key: '', seq: 0, seeded };
    this.saveTeamCfg(n);
    this.teamCfg = n;
    this.pending = new Map(((await this.store.get<SyncOp[]>(pendKey(url)).catch(() => null)) || []).map((o) => [o.k, o]));
    this.auth = '';
    this.authUrl = '';
    this.authMsg = '';
    this.teamNeedKey = true;
    this.setTeam({ status: 'error', msg: CODE_AGAIN, last: '' });
    this.startTeam(false); // and polls again once the code is entered
  }
  /** The accounts that have signed in on this browser for `url`. */
  private async accts(url: string) {
    return ((await this.store.get<{ u: string; name: string }[]>(acctKey(url)).catch(() => null)) || []).filter((a) => a && a.u);
  }
  /**
   * Move what this browser keeps per link from `from` to `to` (an older deployment of the same script:
   * the same sheet and token secret): the team-code queue, each account's queue and who has signed in
   * here. Each op is added to the new queue before it leaves the old one, so a page closed halfway loses
   * nothing; tabs moving at once take turns. False when it could not be read or stored (the old link stays).
   */
  private async moveTeam(from: string, to: string, u: string) {
    const run = async () => {
      await this.pq; // this tab's writes to the old queues first
      // read in a transaction: store.get gives null when IndexedDB fails, which would pass for "nothing
      // to move" and leave the queues under a link nothing reads again
      type Acct = { u: string; name: string };
      const who = ((await this.store.update<Acct[] | null>(acctKey(from), (cur) => cur)) || []).filter((a) => a && a.u);
      for (const x of new Set(['', ...who.map((a) => '#' + a.u), ...(u ? ['#' + u] : [])])) {
        const old = await this.writePending(pendKey(from) + x, (cur) => cur);
        if (!old.length) continue;
        const ids = new Set(old.map((o) => o.id));
        await this.writePending(pendKey(to) + x, (cur) => newestPerKey([...cur, ...old]));
        await this.writePending(pendKey(from) + x, (cur) => cur.filter((o) => !ids.has(o.id)));
      }
      if (who.length) {
        await this.store.update<Acct[]>(acctKey(to), (cur) => {
          const had = (cur || []).filter((a) => a && a.u);
          return [...had, ...who.filter((a) => !had.some((b) => b.u === a.u))];
        });
        await this.store.del(acctKey(from));
      }
      return true;
    };
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    try {
      return await (locks ? locks.request('gcc-team-move', run) : run());
    } catch {
      return false;
    }
  }
  /**
   * Open a team by its web-app link (connect form, invite link): a team-code team asks for the code
   * as before; a team with accounts shows the sign-in screen; a new script with no admin yet shows the
   * first-admin setup. Returns what it found ('' when the link can't be reached).
   */
  async teamOpen(url: string): Promise<'legacy' | 'accounts' | 'setup' | ''> {
    url = url.trim();
    if (this.foreign(url)) return ''; // the site belongs to its own team: another team's link is ignored
    if (!isTeamUrl(url)) {
      this.setTeam({ status: 'error', msg: 'ลิงก์ต้องเป็น Web app ของ Google Apps Script (https://script.google.com/macros/s/…/exec)' });
      return '';
    }
    let c: Caps;
    try {
      c = await hello(this.transport, url);
    } catch (e) {
      this.setTeam({ status: 'error', msg: errText(e, url === this.homeTeam ? 'home' : 'connect') });
      return '';
    }
    this.setCaps(c, url);
    if (c.v === 2 || c.mode === 'legacy') {
      if (this.teamCfg?.url !== url) this.teamJoinUrl = url; // the team-code form
      this.emit();
      return 'legacy';
    }
    // opened while this page is still loading, on a browser signed in to this team (the invite link
    // again): the session being restored decides, not a sign-in screen shown before it is
    if (this.loadEnd && this.signedInHere(url)) await this.loadEnd;
    if (this.teamCfg?.url === url && this.teamCfg.mode === 'accounts' && this.session && !this.auth) {
      this.emit();
      return 'accounts'; // already signed in to it
    }
    // remembered so a reload stays on the sign-in screen (kept as is when this browser had it already)
    const had = prefs.get<TeamCfg | null>(PREF.team, null);
    if (!this.teamCfg && c.mode === 'accounts' && !(had?.url === url && had.mode === 'accounts')) this.saveTeamCfg({ url, key: '', seq: 0, seeded: false, mode: 'accounts' });
    this.authUrl = url;
    this.auth = c.mode === 'setup' ? 'setup' : 'login';
    this.authMsg = '';
    this.emit();
    return c.mode === 'setup' ? 'setup' : 'accounts';
  }
  /** A link that is not the home team's, on a site that has one. */
  foreign(url: string) {
    return !!this.homeTeam && url.trim() !== this.homeTeam;
  }
  /**
   * Ask the home team what it is, for a browser not connected to it yet (the gate's "ลองอีกครั้ง"):
   * its sign-in, its first-admin setup, or (team code) the app with the code form. While it can't be
   * reached the gate stays, with why in `authMsg`.
   */
  async teamRetry() {
    const url = this.homeTeam;
    if (!url || this.teamCfg || (this.auth !== 'connect' && this.auth !== 'setup')) return '';
    this.auth = 'connect';
    this.authUrl = url;
    this.authMsg = '';
    this.emit();
    const m = await this.teamOpen(url);
    if (this.auth !== 'connect' || this.teamCfg) return m; // answered: sign in or set up (or another tab signed in)
    if (m === 'legacy') {
      this.auth = '';
      this.authUrl = '';
    } else if (!m) {
      this.authMsg = this.team.msg || 'เชื่อมต่อทีมไม่ได้';
      this.team = { status: 'off', msg: '', last: '' }; // said on the gate, not on the team card later
    }
    this.emit();
    return m;
  }
  /** The lead turns on accounts for a team-code team whose script can do them: the first-admin
   *  setup screen (syncing with the code pauses meanwhile). */
  teamBeginSetup() {
    const url = this.teamCfg?.url || this.teamJoinUrl;
    if (!url) return;
    this.authUrl = url;
    this.auth = 'setup';
    this.authMsg = '';
    this.emit();
  }
  /** Whether this browser's stored settings say it is signed in to `url` (another tab, or this page
   *  before its load has restored the session). */
  private signedInHere(url: string) {
    const t = prefs.get<TeamCfg | null>(PREF.team, null), s = prefs.get<Session | null>(PREF.session, null);
    return t?.url === url && t.mode === 'accounts' && s?.url === url && !!s.u;
  }
  /** Leave a sign-in or setup screen: back to the team still connected, or to this browser only. */
  teamCancelAuth() {
    const cfg = this.teamCfg;
    if (cfg && (this.auth === 'login' || this.auth === 'setup')) {
      this.authUrl = '';
      this.authMsg = '';
      if (cfg.mode === 'accounts' && !this.session?.tok) {
        this.auth = 'expired'; // the script ended this session: sign in again over the app
        this.emit();
        return;
      }
      this.auth = '';
      if (this.teamTimer) return void this.emit();
      // the sign-in screen came up before this page started syncing (e.g. the invite link opened
      // while it loaded): nothing polls yet
      this.setTeam({ status: 'syncing', msg: '' });
      this.startTeam();
    } else this.teamForget(); // (none with a home team: its gate stays)
  }
  /** Sign in with a username and password. Throws a TeamSyncError with a Thai message on failure. */
  async teamLogin(u: string, pw: string, rm: boolean) {
    const url = this.authUrl || this.teamCfg?.url || '';
    if (!url) throw new Error('ยังไม่ได้เลือกทีม');
    u = normUser(u);
    let r: SignIn;
    try {
      const c = await this.capsFor(url);
      const pk = await derivePk(c.tid!, c.it!, u, pw);
      r = await call<SignIn>(this.transport, url, null, { action: 'login', u, pk, rm });
    } catch (e) {
      if (await this.codeAgain(url, e, u)) return; // the older script was pasted back: the team code again
      throw e;
    }
    await this.signedIn(url, r, rm, pw);
  }
  /** The lead's first admin account, with the one-time code printed by setup() in Apps Script. */
  async teamClaim(code: string, u: string, name: string, pw: string, rm = true) {
    const url = this.authUrl || this.teamCfg?.url || '';
    const c = await this.capsFor(url);
    u = normUser(u);
    const pk = await derivePk(c.tid!, c.it!, u, pw);
    const r = await call<SignIn>(this.transport, url, null, { action: 'claim', code, u, name: name.trim(), pk, rm });
    await this.signedIn(url, r, rm, '');
    // the lead can be chosen as ผู้รับผิดชอบ too, like the accounts they create (adminCreate)
    const n = this.session?.name;
    if (n && this.ready && this.can('set.users') && !this.crm.team.includes(n)) this.addTeam(n);
  }
  /** A forgotten admin password: a new one with a recovery code from setup(). */
  async teamRecover(code: string, u: string, pw: string, rm = true) {
    const url = this.authUrl || this.teamCfg?.url || '';
    const c = await this.capsFor(url);
    u = normUser(u);
    const pk = await derivePk(c.tid!, c.it!, u, pw);
    const r = await call<SignIn>(this.transport, url, null, { action: 'claim', code, u, pk, rm });
    await this.signedIn(url, r, rm, '');
  }
  private async signedIn(url: string, r: SignIn, rm: boolean, pw: string) {
    const s: Session = { url, u: r.me.u, name: r.me.name, role: r.me.role, tok: r.tok, exp: Number(r.exp) || 0, rm, mc: !!r.mc };
    const me = parseMe(r.me);
    (['rid', 'rn', 'caps', 'rq', 'req', 'g'] as const).forEach((k) => me[k] !== undefined && Object.assign(s, { [k]: me[k] }));
    this.saveSession(s);
    prefs.set(PREF.me, s.name); // the same name if the team ever goes back to the team code
    if (rm) prefs.set(PREF.lastUser, { u: s.u, name: s.name });
    else prefs.del(PREF.lastUser);
    this.lastPw = s.mc ? pw : '';
    const cfg = this.teamCfg;
    if (cfg && cfg.url === url && cfg.mode === 'accounts' && cfg.u === s.u) {
      // the same person signing in again (session expired): the session and its queue go on
      this.session = s;
      this.authMsg = '';
      this.auth = s.mc ? 'change' : '';
      if (!this.auth) {
        this.setTeam({ status: 'syncing', msg: '' });
        this.startTeam();
      } else this.emit();
      return;
    }
    this.endTeam();
    await this.openSession(url, s);
  }
  /** Start an account's session: its own queue (plus what this browser queued before accounts, sent
   *  under it), then the first sync. */
  private async openSession(url: string, s: Session) {
    const stored = prefs.get<TeamCfg | null>(PREF.team, null);
    const cfg: TeamCfg = { url, key: '', seq: 0, seeded: stored?.url === url ? !!stored.seeded : false, mode: 'accounts', u: s.u };
    // remembered for a shared computer: whose unsent edits and documents are whose (see syncRound)
    await this.store.update<{ u: string; name: string }[]>(acctKey(url), (cur) => [...(cur || []).filter((a) => a && a.u !== s.u), { u: s.u, name: s.name }]).catch(() => {});
    if (hasWrite(capsOf(s))) {
      const last = prefs.getRaw(PREF.teamLast);
      const before = [
        ...((await this.store.get<SyncOp[]>(pendKey(url)).catch(() => null)) || []),
        ...(last && last !== url ? (await this.store.get<SyncOp[]>(pendKey(last)).catch(() => null)) || [] : []),
        ...this.carry.values(),
      ];
      if (before.length) {
        try {
          await this.writePending(this.qk(cfg), (cur) => newestPerKey([...cur, ...before.map(this.stampFor(s))]));
          await this.writePending(pendKey(url), () => []);
          if (last && last !== url) await this.writePending(pendKey(last), () => []).catch(() => {});
          this.carry = new Map();
          this.teamNote = `ส่งรายการที่แก้ไว้ก่อนเข้าสู่ระบบ ${fmtN(before.length)} รายการ ในชื่อของคุณ`;
        } catch {
          /* stays where it was: taken at the next sign-in */
        }
      }
    }
    this.pending = new Map(((await this.store.get<SyncOp[]>(this.qk(cfg)).catch(() => null)) || []).map((o) => [o.k, o]));
    this.session = s;
    this.teamCfg = cfg;
    this.saveTeamCfg(cfg);
    this.authUrl = '';
    this.authMsg = '';
    this.teamJoinUrl = '';
    this.teamNeedKey = false;
    if (s.mc) {
      this.auth = 'change';
      this.emit();
      return;
    }
    this.auth = '';
    this.setTeam({ status: 'syncing', msg: '', last: '' });
    await this.teamSync({ first: !cfg.seeded });
    if (this.teamCfg === cfg) this.startTeam(false);
  }
  /** What this browser queued with the team code, taken over by account `s`: sent in its name (the
   *  script writes the account's name on the rows, and on contact-log entries of a sales account). */
  private stampFor(s: Session) {
    return (o: SyncOp): SyncOp => {
      const v = o.v as Record<string, unknown> | undefined;
      const own = !capsOf(s)?.['set.users'] && /^(d?log|dact)\//.test(o.k) && !!v && typeof v === 'object' && !Array.isArray(v) && 'by' in v;
      return { ...o, by: s.name, ...(own ? { v: { ...v, by: s.name } } : {}) };
    };
  }
  /** Set a new password (the temporary one after an admin made the account or reset it, or any time).
   *  `old` may be left empty right after signing in with a temporary password. Signs out this
   *  account's other browsers. */
  async teamChangePassword(old: string, pw: string) {
    const s = this.session;
    if (!s) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
    let r: { tok: string; exp: number };
    try {
      const c = await this.capsFor(s.url);
      const [pkOld, pkNew] = await Promise.all([derivePk(c.tid!, c.it!, s.u, old || this.lastPw), derivePk(c.tid!, c.it!, s.u, pw)]);
      r = await call<{ tok: string; exp: number }>(this.transport, s.url, { tok: s.tok }, { action: 'passwd', old: pkOld, pk: pkNew, rm: s.rm });
    } catch (e) {
      if (await this.codeAgain(s.url, e, s.u)) return; // the older script was pasted back: the team code again
      throw e;
    }
    s.tok = r.tok;
    s.exp = Number(r.exp) || s.exp;
    s.mc = false;
    this.saveSession(s);
    this.lastPw = '';
    if (this.auth === 'change') {
      this.auth = '';
      const cfg = this.teamCfg;
      if (cfg) {
        this.setTeam({ status: 'syncing', msg: '', last: '' });
        await this.teamSync({ first: !cfg.seeded });
        if (this.teamCfg === cfg) this.startTeam(false);
      }
    }
    this.emit();
  }
  /** Edits this account can no longer send (made before an admin made it ดูอย่างเดียว): drop them,
   *  and the next round shows the team's values again. */
  async teamDropUnsent() {
    const cfg = this.teamCfg;
    if (!cfg) return;
    const keys = [...this.pending.keys(), ...this.unsaved.keys()];
    this.pending = new Map();
    this.unsaved = new Map();
    await this.writePending(this.qk(cfg), () => []).catch(() => {});
    keys.forEach((k) => this.revert.add(k));
    this.teamNote = '';
    this.emit();
    await this.teamSyncNow();
  }
  /** Whether the temporary password typed at sign-in is still known here (the must-change screen
   *  then asks only for the new one). */
  get knowsTempPassword() {
    return !!this.lastPw;
  }
  /** The account that chose "จดจำฉัน" on this browser, offered on the sign-in screen. */
  get lastUser(): { u: string; name: string } | null {
    return prefs.get<{ u: string; name: string } | null>(PREF.lastUser, null);
  }
  /**
   * Sign out. What is queued is sent first when online (unsent edits stay for the next sign-in of this
   * account). `all`: also sign out this account's other browsers. `wipe`: delete the team data kept in
   * this browser (shared computer), keeping data of this browser only; `dropUnsent` deletes the queue too.
   * A wipe, or `forget` ("ใช้บัญชีอื่น"), also forgets the account: the sign-in screen doesn't greet it.
   */
  async teamLogout(o: { all?: boolean; wipe?: boolean; dropUnsent?: boolean; forget?: boolean } = {}) {
    const cfg = this.teamCfg, s = this.session;
    if (cfg && !this.auth && (this.pending.size || this.docsUnsent) && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      this.docRetryAt = 0; // a last try for files waiting after a failed upload, too
      const flush = async () => {
        await this.teamSyncNow().catch(() => {});
        await this.uploadDocs();
      };
      await Promise.race([flush(), new Promise((r) => setTimeout(r, 10000))]);
    }
    if (cfg && s?.tok) await call(this.transport, cfg.url, { tok: s.tok }, { action: 'logout', all: !!o.all }).catch(() => {});
    const url = cfg?.url || s?.url || this.authUrl;
    this.endTeam();
    this.saveSession(null);
    if (!s?.rm || o.wipe || o.forget) prefs.del(PREF.lastUser);
    this.session = null;
    this.authUrl = url;
    this.auth = url ? 'login' : '';
    this.authMsg = 'คุณออกจากระบบแล้ว';
    this.teamNote = '';
    this.setTeam({ status: 'off', msg: '', last: '' });
    if (o.wipe && cfg) {
      await this.wipeTeamData(cfg, !!o.dropUnsent, s);
      prefs.set(PREF.wipe, String(Date.now()));
      if (typeof location !== 'undefined') location.reload();
    }
  }
  /** Delete the team's data kept in this browser, keeping what exists on this browser only (companies
   *  from the TGO website sync and what was recorded about them) and, unless asked, unsent edits. */
  private async wipeTeamData(cfg: TeamCfg, dropUnsent: boolean, s: Session | null) {
    const loc = (id: string | number) => isLocalId(Number(id));
    const pick = <T>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o || {}).filter(([id]) => loc(id))) as Record<string, T>;
    const C = this.crm;
    const keep: Crm = { ...emptyCrm(), stages: pick(C.stages), owners: pick(C.owners), log: pick(C.log), watch: C.watch.filter(loc), tasks: C.tasks.filter((t) => loc(t.gid)) };
    await this.store.set('crm', keep).catch(() => {});
    await this.store.set('contacts', pick(this.contacts)).catch(() => {});
    for (const k of ['dedup', 'sales', 'customCos', 'people']) await this.store.del(k).catch(() => {});
    // a file not uploaded yet is an unsent edit too: its only copy, uploaded at the next sign-in (that
    // account's, or this one's unless asked to drop what is unsent)
    const others = (await this.accts(cfg.url)).filter((a) => a.u !== s?.u);
    const mine = (d: DealDoc) => d.by === s?.name || !others.some((a) => a.name === d.by);
    for (const d of Object.values(this.sales.docs)) if (d.fileId || (dropUnsent && mine(d))) await this.store.del(this.docBlobKey(d.id)).catch(() => {});
    prefs.del(PREF.peopleHide);
    prefs.del(PREF.peopleGone);
    if (dropUnsent) {
      await this.store.del(this.qk(cfg)).catch(() => {});
      await this.store.del(pendKey(cfg.url)).catch(() => {});
    }
    this.saveTeamCfg({ url: cfg.url, key: '', seq: 0, seeded: true, mode: 'accounts' });
  }
  /** Stop using this team on this browser (from the sign-in screen): back to this browser's own data.
   *  Not on a site with a home team (it belongs to that team). */
  teamForget() {
    if (this.homeTeam) return;
    this.endTeam();
    this.saveTeamCfg(null);
    this.saveSession(null);
    this.session = null;
    this.auth = '';
    this.authUrl = '';
    this.authMsg = '';
    this.setTeam({ status: 'off', msg: '', last: '' });
  }
  /** Another tab signed in, out, or got a new token. */
  private adoptSession() {
    const raw = prefs.getRaw(PREF.session);
    if (raw === this.sessionRaw) return;
    this.sessionRaw = raw;
    const s = prefs.get<Session | null>(PREF.session, null);
    const cfg = this.teamCfg;
    if (cfg?.mode === 'accounts') {
      if (!s) {
        this.endTeam();
        this.session = null;
        this.authUrl = cfg.url;
        this.auth = 'login';
        this.authMsg = 'คุณออกจากระบบแล้ว';
        this.setTeam({ status: 'off', msg: '', last: '' });
        return;
      }
      if (s.u !== cfg.u) {
        if (typeof location !== 'undefined') location.reload(); // someone else signed in on this browser
        return;
      }
      this.session = s;
      if (!s.tok) {
        if (this.auth !== 'expired' && this.auth !== 'disabled') this.authLost('session_expired');
      } else if ((this.auth === 'expired' || this.auth === 'change') && !s.mc) {
        this.auth = '';
        this.setTeam({ status: 'syncing', msg: '' });
        this.startTeam();
      }
      this.emit();
      return;
    }
    if (!cfg && this.auth && s?.tok && s.url === this.authUrl) {
      const t = prefs.get<TeamCfg | null>(PREF.team, null);
      if (!t || t.url !== s.url) return;
      this.session = s;
      this.teamCfg = { ...t, seq: 0, u: s.u };
      this.auth = s.mc ? 'change' : '';
      this.authUrl = '';
      this.authMsg = '';
      if (!this.auth) {
        this.setTeam({ status: 'syncing', msg: '', last: '' });
        this.startTeam(); // the round reads this account's queue
      } else this.emit();
    }
  }

  // ---- account admin (online only, never queued)
  private async adminCall<T>(body: Record<string, unknown>, old = OLD_SCRIPT): Promise<T> {
    const s = this.session, cfg = this.teamCfg;
    if (!s || !cfg || cfg.mode !== 'accounts') throw new Error('ยังไม่ได้เข้าสู่ระบบ');
    let r: Record<string, unknown>;
    try {
      r = await call<Record<string, unknown>>(this.transport, cfg.url, { tok: s.tok }, body);
    } catch (x) {
      // an action the deployed script does not know yet: say which update it needs
      if (x instanceof TeamSyncError && x.code === 'unknown_action') throw new TeamSyncError(old, 'unknown_action', x.extra);
      throw x;
    }
    this.meta(cfg, r);
    return r as T;
  }
  async adminUsers() {
    return (await this.adminDir()).users;
  }
  /** The admin page's data: accounts, and (Code.gs v4) roles, extras, requests and the audit trail. */
  async adminDir(): Promise<TeamDir> {
    const r = await this.adminCall<Record<string, unknown>>({ action: 'users' });
    const v4 = 'roles' in r;
    if (v4) {
      this.knownRoles = parseRoles(r.roles);
      this.noteRoles(r.roles);
    }
    return {
      users: (Array.isArray(r.users) ? r.users : []) as TeamUser[],
      roles: parseRoles(r.roles),
      grants: parseGrants(r.grants),
      reqs: parseReqs(r.reqs),
      audit: parseAudit(r.audit),
      v4,
    };
  }
  /** A new account with a temporary password made here (shown once to the admin, never stored).
   *  `em`: its notification e-mail (a script with notifications sends it a code to confirm). */
  async adminCreate(p: { u: string; name: string; role: Role; em?: string }) {
    const cfg = this.teamCfg!;
    const c = await this.capsFor(cfg.url);
    const u = normUser(p.u), temp = tempPassword();
    const pk = await derivePk(c.tid!, c.it!, u, temp);
    const r = await this.adminCall<{ user: TeamUser }>({ action: 'user_save', create: true, u, name: p.name.trim(), role: p.role, pk, ...(p.em ? { em: p.em } : {}) });
    if (!this.crm.team.includes(r.user.name)) this.addTeam(r.user.name); // in the ผู้รับผิดชอบ lists
    return { user: r.user, temp };
  }
  async adminUpdate(u: string, patch: { name?: string; role?: Role; on?: 0 | 1; em?: string }) {
    return (await this.adminCall<{ user: TeamUser }>({ action: 'user_save', u, ...patch })).user;
  }
  /** Create (no id) or change a role: name, description, capabilities. `from`: the role it was copied
   *  from (the audit trail says so). Returns the roles as they are now. */
  async roleSave(r: { id?: string; n: string; d: string; c: CapSet; from?: string }) {
    const x = await this.adminCall<Record<string, unknown>>({ action: 'role_save', ...(r.id ? { id: r.id } : {}), n: r.n.trim(), d: r.d.trim(), c: roleWire(r.c), ...(r.from ? { from: r.from } : {}) }).catch((e) => {
      // the script shares these codes with accounts: say them about a role
      throw e instanceof TeamSyncError && e.code === 'name_taken' ? codeError('name_dup', e.extra) : e instanceof TeamSyncError && e.code === 'bad_name' ? codeError('role_name', e.extra) : e;
    });
    this.noteRoles(x.roles);
    return { id: typeof x.id === 'string' ? x.id : r.id || '', roles: 'roles' in x ? parseRoles(x.roles) : null };
  }
  /** Delete a role made by an admin; its accounts (and temporary grants of it) move to `to`. */
  async roleDel(id: string, to: string) {
    const x = await this.adminCall<Record<string, unknown>>({ action: 'role_del', id, to });
    this.noteRoles(x.roles);
    return 'roles' in x ? parseRoles(x.roles) : null;
  }
  /** Extras for one account beyond its role (until a date, or for good). */
  async grantSave(u: string, c: { k: CapId; s: 'all' | 'own'; until?: string }[]) {
    await this.adminCall({ action: 'grant_save', u, c }).catch((e) => {
      throw e instanceof TeamSyncError && e.code === 'cap_held' ? codeError('grant_held', e.extra) : e;
    });
  }
  async grantDel(u: string, k: CapId | 'role') {
    await this.adminCall({ action: 'grant_del', u, k });
  }
  /** Approve or refuse an account's request, with a note to them. `id`: the request the admin is looking
   *  at; one the requester replaced since is refused ('req_changed': look at it again), never decided unseen. */
  async reqDecide(u: string, ok: boolean, note: string, id: string) {
    await this.adminCall({ action: 'req_decide', u, ok, note: note.trim(), id }).catch((e) => {
      throw e instanceof TeamSyncError && e.code === 'changed' ? codeError('req_changed', e.extra) : e;
    });
  }
  /** Ask the admins for another role or more capabilities (online only; replaces a pending request). */
  async reqSend(q: ReqInput) {
    const r = await this.adminCall<Record<string, unknown>>({ action: 'req_send', k: q.k, ...(q.k === 'role' ? { role: q.role } : { caps: q.caps }), note: q.note.trim(), ...(q.until ? { until: q.until } : {}) });
    this.reqLocal(r, { st: 'p', id: '', k: q.k, ...(q.k === 'role' ? { role: q.role } : { caps: q.caps }), note: q.note.trim(), ...(q.until ? { until: q.until } : {}), at: new Date().toISOString() });
  }
  /** Withdraw the pending request. */
  async reqCancel() {
    const r = await this.adminCall<Record<string, unknown>>({ action: 'req_cancel' });
    this.reqLocal(r, null);
  }
  /** The decision was read: the banner goes. */
  async reqAck() {
    const r = await this.adminCall<Record<string, unknown>>({ action: 'req_ack' });
    this.reqLocal(r, null);
  }
  /** After a request action: the script's me.req if it sent one, else what the action means. */
  private reqLocal(r: Record<string, unknown>, v: Session['req']) {
    const s = this.session;
    if (!s) return;
    const me = r.me && typeof r.me === 'object' && 'req' in (r.me as object);
    if (me) return; // meta() took the script's word
    s.req = v;
    this.saveSession(s);
    this.emit();
  }
  // ---- notifications and the quotation check (package notify; lib/notify.ts)
  /** The team script's notification state as last heard (hello, or a reply that says `notify`) for the
   *  connected team; null = a script without notifications: its setup steps show, the bell has payments
   *  and appointments only, quotations show no check. Kept in this browser, so it holds from the first frame. */
  get notifyLive(): NotifyLive | null {
    const url = this.teamCfg?.url;
    return url ? this.nfFor(url) : null;
  }
  private nfHeard: { url: string; f: NotifyLive | null } | null = null;
  /** As heard by this tab, else as this browser last heard it (read once). */
  private nfFor(url: string): NotifyLive | null {
    if (!this.nfHeard || this.nfHeard.url !== url) {
      const p = prefs.get<{ url?: string; f?: NotifyLive | null } | null>(PREF.notify, null);
      const f = p && p.url === url && p.f ? { on: !!p.f.on, since: String(p.f.since || '') } : null;
      this.nfHeard = { url, f };
    }
    return this.nfHeard.f;
  }
  private heardNotify(url: string, f: NotifyLive | null) {
    const was = this.nfFor(url);
    this.nfHeard = { url, f };
    if (JSON.stringify(was) === JSON.stringify(f)) return;
    prefs.set(PREF.notify, this.nfHeard);
    this.emit();
  }
  /** Quotations are checked here: a team with accounts whose script has notifications switched on. */
  get qtLive() {
    return !!this.notifyLive?.on && this.teamCfg?.mode === 'accounts' && !!this.session;
  }
  /** The team's notification rules (scfg/notify.cfg, defaults until an admin saves them). */
  notifyCfg(): NotifyCfg {
    return parseNotifyCfg(this.sales.ncfg);
  }
  /** Every quotation check this browser holds (docId → record). */
  checks(): Record<string, QtCheck> {
    return this.sales.qchk || {};
  }
  /** The check status a quotation shows ("รอตรวจ" / "ตรวจแล้ว" / "ส่งกลับแก้ไข"), or null: no check here
   *  (no notifications yet, or a document outside the check with nothing recorded). */
  qtCheckFor(doc: DealDoc): QtCheckView | null {
    const live = this.notifyLive;
    // the check is of the amounts: an account that may not see money sees no check either
    if (!live?.on || this.teamCfg?.mode !== 'accounts' || !this.can('view.money')) return null;
    const v = qtCheckOf(this.checks()[doc.id], doc);
    if (v.status === 'wait' && !needsCheck(this.sales, doc, live.since)) return null;
    return v;
  }
  /** Why this account can't check `doc` ('' = it can): no check here, no สิทธิ์ ตรวจ/อนุมัติใบเสนอราคา, or
   *  its own quotation (unless the team allows that). The script decides again (also the row's last writer). */
  checkBlock(doc: Pick<DealDoc, 'by'>): '' | 'off' | 'cap' | 'self' {
    if (!this.qtLive) return 'off';
    if (!this.can('qt.check')) return 'cap';
    if (!this.notifyCfg().self && sameName(doc.by, this.me())) return 'self';
    return '';
  }
  /**
   * Check a quotation (online only; the script writes `qchk/<docId>` and a history line): `ok` approves the
   * figures, `back` sends it back with a note, `undo` takes back this account's latest check (within 10
   * minutes). `s`: the e-mail link's signature, passed on (the script records whether it came from a mail).
   * The record shows at once; the script's own row replaces it with the next pull.
   */
  async qtCheck(doc: DealDoc, st: 'ok' | 'back' | 'undo', note = '', s = '') {
    const fp = fpOf(doc), n = note.trim().slice(0, QT_NOTE_MAX);
    if (st === 'back' && !n) throw codeError('note_required');
    let r: Record<string, unknown>;
    try {
      r = await this.adminCall<Record<string, unknown>>({ action: 'qt_check', k: keyOf.ddoc(doc.deal, doc.id), st, fp, ...(n ? { note: n } : {}), ...(s ? { s } : {}) }, OLD_NOTIFY);
    } catch (x) {
      if (x instanceof TeamSyncError) {
        // an undo that is no longer this account's latest check (taken back already, or someone checked since)
        if (st === 'undo' && x.code === 'changed') throw codeError('too_late', x.extra);
        // the script's word for a missing (or too long) note
        if (x.code === 'req_note') throw codeError('note_required', x.extra);
        // changed meanwhile: the next round brings the document as it is now
        if (x.code === 'changed') this.flushSoon();
      }
      throw x;
    }
    const Q = this.sales.qchk || (this.sales.qchk = {});
    if (st === 'undo') delete Q[doc.id];
    else Q[doc.id] = toQtCheck(r.chk ?? r.rec ?? r.v) || { st, by: this.me(), at: new Date().toISOString(), fp, ...(n ? { note: n } : {}), ...(this.session ? { u: this.session.u } : {}) };
    this.saveSales();
    this.emit();
    this.flushSoon();
  }
  /** This account's notification settings as the script last sent them (me.notify), else the defaults. */
  myNotify(): MyNotify {
    return this.session?.nf || myNotify0(this.can('set.users'));
  }
  /** Whether the script has sent this account's settings (a script with notifications). */
  get myNotifyLive() {
    return !!this.session?.nf;
  }
  /** Read this account's settings again (online). */
  async notifyMe(): Promise<MyNotify> {
    return this.nfLocal(await this.adminCall<Record<string, unknown>>({ action: 'notify_me', get: 1 }, OLD_NOTIFY));
  }
  /** Save them; a new address (`em`) is stored unconfirmed and the script mails it a 6-digit code. */
  async saveNotifyMe(p: Pick<MyNotify, 'on' | 't' | 'sc'> & { em?: string }) {
    const r = await this.adminCall<Record<string, unknown>>({ action: 'notify_me', on: p.on, t: p.t, sc: p.sc, ...(p.em !== undefined ? { em: p.em } : {}) }, OLD_NOTIFY);
    const cur = this.myNotify();
    const mailNew = p.em !== undefined && p.em !== cur.em;
    return this.nfLocal(r, { ...cur, on: p.on, t: p.t, sc: p.sc, ...(mailNew ? { em: p.em!, ok: false } : {}) });
  }
  /** Confirm the address with the code from the mail. */
  async verifyEmail(code: string) {
    const r = await this.adminCall<Record<string, unknown>>({ action: 'notify_verify', code: code.replace(/\D/g, '').slice(0, 6) }, OLD_NOTIFY);
    return this.nfLocal(r, { ...this.myNotify(), ok: true });
  }
  /** One test mail to this account's confirmed address (counts against the day's quota). */
  async notifyTest() {
    await this.adminCall({ action: 'notify_test' }, OLD_NOTIFY);
  }
  /** The admin page's status card: last run, today's sending and the quota, each account's choices. */
  async notifyStatus(): Promise<NotifyStatus> {
    const r = await this.adminCall<Record<string, unknown>>({ action: 'notify_status' }, OLD_NOTIFY);
    // st.on says whether mail goes out (the timer); the checks follow hello's flag (setup done), not this
    return parseNotifyStatus(r);
  }
  /** After notify_me / notify_verify: the script's me.notify when it sent one (meta took it), else a
   *  settings object in the reply, else what was saved. */
  private nfLocal(r: Record<string, unknown>, saved?: MyNotify): MyNotify {
    const s = this.session;
    const meSent = !!r.me && typeof r.me === 'object' && 'notify' in (r.me as object);
    if (s && !meSent) {
      const own = [r.prefs, r.notify].find((x) => !!x && typeof x === 'object' && typeof (x as { on?: unknown }).on === 'object');
      const nf = parseMyNotify(own, this.can('set.users')) || saved;
      if (nf) {
        s.nf = nf;
        this.saveSession(s);
        this.emit();
      }
    }
    return this.myNotify();
  }
  /** The scope of the bell (and the digest): งานที่ฉันรับผิดชอบ or ทั้งทีม — the account's setting, else
   *  what was chosen in this browser, else the whole team for whoever manages users (or no accounts). */
  bellScope(): Scope {
    const nf = this.session?.nf;
    if (nf) return nf.sc;
    const p = prefs.getRaw(PREF.bellScope);
    return p === 'mine' || p === 'team' ? p : this.role() == null || this.can('set.users') ? 'team' : 'mine';
  }
  setBellScope(sc: Scope) {
    prefs.set(PREF.bellScope, sc);
    this.emit();
  }
  /** An admin saves the team's rules (a shared record; `site` is this page's address, which the e-mails link to). */
  saveNotifyCfg(c: NotifyCfg) {
    if (!this.can('set.users')) return this.deny();
    const site = typeof location !== 'undefined' && /^https?:/.test(location.protocol) ? location.origin + location.pathname : c.site;
    const v: NotifyCfg = { ...c, site };
    this.sales.ncfg = v;
    this.op('scfg/notify.cfg', { ...v });
    this.saveSales();
    this.emit();
  }
  // ---- the month check for accounting ("ตรวจรับเงินรายเดือน", package cash; lib/payCheck.ts)
  /** Every payment check this browser holds (`<dealId>/<lineId>` → record). */
  payChecks(): Record<string, PayCheck> {
    return this.sales.pchk || {};
  }
  /** The months closed ('YYYY-MM' → record). */
  monthCloses(): Record<string, MonthClose> {
    return this.sales.mclose || {};
  }
  /** The first day whose money is checked (scfg/paychk.cfg; ม.ค. 2569 until an admin sets another). */
  payChkCfg(): PayChkCfg {
    return parsePayChkCfg(this.sales.pcfg);
  }
  /** Why this account can't check (a line) — '' = it can: no สิทธิ์ ตรวจยืนยันรับเงิน, no name to sign the
   *  check with (this browser only, before "ฉันคือ"), or money it recorded itself. The team script forces
   *  who and when; the self-check is this client's rule. */
  payCheckBlock(r?: Pick<ChkRow, 'by'>): '' | 'cap' | 'name' | 'self' {
    if (!this.can('pay.check')) return 'cap';
    const me = this.me();
    if (!me.trim()) return 'name';
    return r && r.by.some((b) => sameName(b, me)) ? 'self' : '';
  }
  /** The checks made last ("ตรวจแล้ว", "ตรวจทั้งหมดที่เลือก"): the toast's เลิกทำ takes them back. */
  lastPayChecks: { keys: string[]; at: number } | null = null;
  private putPayCheck(key: string, v: PayCheck | null) {
    const P = this.sales.pchk || (this.sales.pchk = {});
    if (v) P[key] = v;
    else delete P[key];
    this.op('dchk/' + key, v ? { ...v } : undefined);
  }
  /** "ตรวจแล้ว" on received lines, in one sync round, each with a deal-history row ("ตรวจรับเงิน PAY1").
   *  Lines this account may not check (its own, already checked, before the first month checked) are left
   *  out. Returns the keys written. */
  checkPays(rows: ChkRow[]): string[] {
    if (this.payCheckBlock()) return this.deny(), [];
    const ok = rows.filter((r) => r.kind === 'got' && r.fp && r.deal && r.state !== 'none' && r.state !== 'ok' && !this.payCheckBlock(r));
    if (!ok.length) return [];
    const at = new Date().toISOString(), by = this.me();
    this.batchOps(() =>
      ok.forEach((r) => {
        const fp = r.fp!;
        this.putPayCheck(r.key, { s: 'ok', by, at, amt: fp.amt, d: fp.d, f: fp.f });
        this.salesLog(r.deal!, 'ตรวจรับเงิน ' + lineLabel(r), `${fmtMoney(fp.amt)} บาท · รับ ${isoTh(fp.d)}`);
      }),
    );
    this.lastPayChecks = { keys: ok.map((r) => r.key), at: Date.now() };
    this.saveSales();
    return this.lastPayChecks.keys;
  }
  /** "ส่งกลับแก้ไข": the line goes back to whoever recorded it with what to fix; it still counts as money
   *  received until they change it (then it waits for a check again). */
  returnPay(r: ChkRow, note: string): boolean {
    const n = note.trim().slice(0, PAY_NOTE_MAX);
    if (this.payCheckBlock()) return this.deny(), false;
    if (!n || r.kind !== 'got' || !r.fp || !r.deal || r.state === 'none' || this.payCheckBlock(r)) return false;
    const fp = r.fp;
    this.batchOps(() => {
      this.putPayCheck(r.key, { s: 'back', by: this.me(), at: new Date().toISOString(), amt: fp.amt, d: fp.d, f: fp.f, note: n });
      this.salesLog(r.deal!, 'ส่งรับเงินกลับแก้ไข ' + lineLabel(r), `${fmtMoney(fp.amt)} บาท · ${n}`);
    });
    this.lastPayChecks = null;
    this.saveSales();
    return true;
  }
  /** "เลิกทำ": this account's own checks of the last 10 minutes are taken back (the lines wait again). */
  undoPayChecks(keys: string[]): number {
    if (this.payCheckBlock()) return this.deny(), 0;
    const P = this.payChecks(), me = this.me(), now = Date.now();
    const ks = keys.filter((k) => canUndo(P[k], me, now));
    this.batchOps(() =>
      ks.forEach((k) => {
        const { dealId, lineId } = splitKey(k);
        this.putPayCheck(k, null);
        this.salesLog(this.sales.deals[dealId] || { id: dealId, client: '' }, 'เลิกตรวจรับเงิน ' + lineLabel({ line: null, lineId }, this.sales));
      }),
    );
    this.lastPayChecks = null;
    if (ks.length) this.saveSales();
    return ks.length;
  }
  /** "รับทราบ" on a line cancelled after its check: the record goes. */
  ackPayOrphan(r: ChkRow) {
    if (!this.can('pay.check')) return this.deny();
    if (r.kind !== 'orphan' || !this.payChecks()[r.key]) return;
    this.batchOps(() => {
      this.putPayCheck(r.key, null);
      this.salesLog(r.deal || { id: r.dealId, client: '' }, 'รับทราบยกเลิกหลังตรวจ ' + lineLabel(r, this.sales), r.rec?.amt != null ? fmtMoney(r.rec.amt) + ' บาท' : '');
    });
    this.saveSales();
  }
  /** "ปิดเดือน": the whole month, every deal's received lines, worked out here (never a screen's filtered
   *  view): only once it has ended and every line in it is checked. Its lines and sum checked are kept
   *  with it (the banner and the file show them). Returns the record, or null when it may not be closed. */
  closeMonth(ym: string): MonthClose | null {
    if (this.payCheckBlock()) return this.deny(), null;
    if (!/^\d{4}-\d\d$/.test(ym)) return null;
    const today = todayISO();
    const c = teamMonth(this.sales, this.payChecks(), this.payChkCfg().since, today, ym);
    if (!canClose(c, ym, today)) return null;
    const v = closeRecord(c, this.me(), new Date().toISOString());
    const M = this.sales.mclose || (this.sales.mclose = {});
    M[ym] = v;
    this.batchOps(() => {
      this.op('mclose/' + ym, { ...v });
      this.salesLog({ id: '', client: '' }, 'ปิดเดือนตรวจรับเงิน', `${ymTh(ym)} · ${v.n} รายการ · ${fmtMoney(v.amt ?? 0)} บาท`);
    });
    this.saveSales();
    return v;
  }
  /** "เปิดเดือนอีกครั้ง". */
  reopenMonth(ym: string) {
    if (this.payCheckBlock()) return this.deny();
    const M = this.sales.mclose || {};
    if (!M[ym]) return;
    delete M[ym];
    this.batchOps(() => {
      this.op('mclose/' + ym);
      this.salesLog({ id: '', client: '' }, 'เปิดเดือนตรวจรับเงินอีกครั้ง', ymTh(ym));
    });
    this.saveSales();
  }
  // ---- the month check of money out (job expenses, lib/expenseMoney.ts): the income check's rules on paid
  //      expenses, `dchk/<dealId>/exp.<expId>` and `mclose/<YYYY-MM>/out`, for accounts that see expenses
  /** Every check of a paid expense this browser holds (`<dealId>/<expId>` → record). */
  expChecks(): Record<string, PayCheck> {
    return this.sales.xchk || {};
  }
  /** The months whose money out is closed ('YYYY-MM' → record). */
  monthClosesOut(): Record<string, MonthClose> {
    return this.sales.mcloseOut || {};
  }
  /** Why this account can't check money out ('' = it can): ดูค่าใช้จ่ายและกำไรของงาน is needed besides
   *  ตรวจยืนยันรับเงิน; the rest is payCheckBlock (a name to sign with; not an expense it recorded itself). */
  expCheckBlock(r?: Pick<ChkRow, 'by'>): '' | 'cap' | 'name' | 'self' {
    if (!this.can('view.exp')) return 'cap';
    return this.payCheckBlock(r);
  }
  /** The checks of money out made last: the toast's เลิกทำ takes them back. */
  lastExpChecks: { keys: string[]; at: number } | null = null;
  private putExpCheck(key: string, v: PayCheck | null) {
    const X = this.sales.xchk || (this.sales.xchk = {});
    if (v) X[key] = v;
    else delete X[key];
    const { dealId, lineId } = splitKey(key);
    this.op(keyOf.dchkExp(dealId, lineId), v ? { ...v } : undefined);
  }
  /** A history row about money out, under `dlog/exp.<id>` (the team script sends those only to accounts that
   *  see expenses). */
  private expCheckLog(d: Pick<Deal, 'id' | 'client'>, action: string, detail = '') {
    const id = uid(), L: DealLog = { id: 'exp.' + id, at: new Date().toISOString(), by: this.me(), action, client: d.client, detail: detail.slice(0, 300), deal: d.id };
    this.sales.log[L.id] = L;
    this.op(keyOf.dlogExp(id), { ...L });
  }
  /** "ตรวจแล้ว" on paid expenses, in one sync round, each with a history row ("ตรวจเงินออก ค่าเดินทาง").
   *  Rows this account may not check (its own, already checked, before the first month checked) are left
   *  out. Returns the keys written. */
  checkExps(rows: XRow[]): string[] {
    if (this.expCheckBlock()) return this.deny(), [];
    const ok = rows.filter((r) => r.kind === 'got' && r.fp && r.deal && r.state !== 'none' && r.state !== 'ok' && !this.expCheckBlock(r));
    if (!ok.length) return [];
    const at = new Date().toISOString(), by = this.me();
    this.batchOps(() =>
      ok.forEach((r) => {
        const fp = r.fp!;
        this.putExpCheck(r.key, { s: 'ok', by, at, amt: fp.amt, d: fp.d, f: fp.f });
        this.expCheckLog(r.deal!, 'ตรวจเงินออก ' + rowWhat(r), `${fmtMoney(fp.amt)} บาท · จ่าย ${isoTh(fp.d)}`);
      }),
    );
    this.lastExpChecks = { keys: ok.map((r) => r.key), at: Date.now() };
    this.saveSales();
    return this.lastExpChecks.keys;
  }
  /** "ส่งกลับแก้ไข": the expense goes back to whoever recorded it with what to fix; it still counts as paid. */
  returnExp(r: XRow, note: string): boolean {
    const n = note.trim().slice(0, PAY_NOTE_MAX);
    if (this.expCheckBlock()) return this.deny(), false;
    if (!n || r.kind !== 'got' || !r.fp || !r.deal || r.state === 'none' || this.expCheckBlock(r)) return false;
    const fp = r.fp;
    this.batchOps(() => {
      this.putExpCheck(r.key, { s: 'back', by: this.me(), at: new Date().toISOString(), amt: fp.amt, d: fp.d, f: fp.f, note: n });
      this.expCheckLog(r.deal!, 'ส่งเงินออกกลับแก้ไข ' + rowWhat(r), `${fmtMoney(fp.amt)} บาท · ${n}`);
    });
    this.lastExpChecks = null;
    this.saveSales();
    return true;
  }
  /** "เลิกทำ": this account's own checks of money out of the last 10 minutes are taken back. */
  undoExpChecks(keys: string[]): number {
    if (this.expCheckBlock()) return this.deny(), 0;
    const X = this.expChecks(), me = this.me(), now = Date.now();
    const ks = keys.filter((k) => canUndo(X[k], me, now));
    this.batchOps(() =>
      ks.forEach((k) => {
        const { dealId, lineId } = splitKey(k);
        const e = this.sales.exp?.[k];
        this.putExpCheck(k, null);
        this.expCheckLog(this.sales.deals[dealId] || { id: dealId, client: '' }, 'เลิกตรวจเงินออก ' + expWhat(e || { c: '', n: lineId }));
      }),
    );
    this.lastExpChecks = null;
    if (ks.length) this.saveSales();
    return ks.length;
  }
  /** "รับทราบ" on money out cancelled after its check (the expense deleted, or no longer paid): the record goes. */
  ackExpOrphan(r: XRow) {
    if (!this.can('pay.check') || !this.can('view.exp')) return this.deny();
    if (r.kind !== 'orphan' || !this.expChecks()[r.key]) return;
    this.batchOps(() => {
      this.putExpCheck(r.key, null);
      this.expCheckLog(r.deal || { id: r.dealId, client: '' }, 'รับทราบเงินออกยกเลิกหลังตรวจ ' + rowWhat(r), r.rec?.amt != null ? fmtMoney(r.rec.amt) + ' บาท' : '');
    });
    this.saveSales();
  }
  /** "ปิดเดือน" of money out: the whole month, every deal's paid expenses, worked out here; only once it has
   *  ended and every one of them is checked. Returns the record, or null when it may not be closed. */
  closeMonthOut(ym: string): MonthClose | null {
    if (this.expCheckBlock()) return this.deny(), null;
    if (!/^\d{4}-\d\d$/.test(ym)) return null;
    const today = todayISO();
    const c = expTeamMonth(this.sales, this.expChecks(), this.payChkCfg().since, ym);
    if (!canClose(c, ym, today)) return null;
    const v = closeRecord(c, this.me(), new Date().toISOString());
    const M = this.sales.mcloseOut || (this.sales.mcloseOut = {});
    M[ym] = v;
    this.batchOps(() => {
      this.op(keyOf.mcloseOut(ym), { ...v });
      this.expCheckLog({ id: '', client: '' }, 'ปิดเดือนตรวจเงินออก', `${ymTh(ym)} · ${v.n} รายการ · ${fmtMoney(v.amt ?? 0)} บาท`);
    });
    this.saveSales();
    return v;
  }
  /** "เปิดเดือนอีกครั้ง" of money out. */
  reopenMonthOut(ym: string) {
    if (this.expCheckBlock()) return this.deny();
    const M = this.sales.mcloseOut || {};
    if (!M[ym]) return;
    delete M[ym];
    this.batchOps(() => {
      this.op(keyOf.mcloseOut(ym));
      this.expCheckLog({ id: '', client: '' }, 'เปิดเดือนตรวจเงินออกอีกครั้ง', ymTh(ym));
    });
    this.saveSales();
  }
  /** แก้ชื่อที่แสดง (before the account's first sign-in): the team list takes the new name in place of the
   *  old one, which would otherwise stay behind as a name with no account. */
  async adminRename(u: TeamUser, name: string) {
    const r = await this.adminUpdate(u.u, { name });
    if (r.name !== u.name && this.crm.team.includes(u.name)) this.delTeam(u.name);
    if (!this.crm.team.includes(r.name)) this.addTeam(r.name);
    return r;
  }
  /** A new temporary password (signs the account out everywhere). */
  async adminReset(u: string) {
    const cfg = this.teamCfg!;
    const c = await this.capsFor(cfg.url);
    const temp = tempPassword();
    const pk = await derivePk(c.tid!, c.it!, u, temp);
    const r = await this.adminCall<{ user: TeamUser }>({ action: 'user_save', u, pk });
    return { user: r.user, temp };
  }
  async adminUnlock(u: string) {
    return (await this.adminCall<{ user: TeamUser }>({ action: 'user_save', u, unlock: true })).user;
  }
  async adminKick(u: string) {
    return (await this.adminCall<{ user: TeamUser }>({ action: 'user_save', u, kick: true })).user;
  }
  /** Names used in the team's data (team list, company and deal owners, people's ผู้ดูแล) with how many
   *  companies each looks after: who needs an account. */
  legacyNames() {
    const n = new Map<string, number>();
    const add = (x: unknown, k = 0) => {
      const s = String(x || '').trim();
      if (s) n.set(s, (n.get(s) || 0) + k);
    };
    this.crm.team.forEach((x) => add(x));
    Object.values(this.crm.owners).forEach((x) => add(x, 1));
    Object.values(this.sales.deals).forEach((d) => add(d.resp));
    Object.values(this.people).forEach((p) => add(p.owner));
    return [...n].map(([name, cos]) => ({ name, cos })).sort((a, b) => b.cos - a.cos || a.name.localeCompare(b.name, 'th'));
  }

  /** Stop sharing. Queued changes stay stored and are sent with the next connect (this sheet or a new link).
   *  Not on a site with a home team. */
  teamDisconnect() {
    if (this.homeTeam) return;
    this.endTeam();
    this.saveTeamCfg(null);
    this.setTeam({ status: 'off', msg: '', last: '' });
  }
  /** End this tab's session; a sync still in flight sees the new generation and stops. */
  private endTeam() {
    this.stopTeam();
    this.teamGen++;
    this.teamBusy = this.teamAgain = false;
    // kept for the next session of this sheet; an account's are not (never sent under someone else's)
    if (this.teamCfg?.mode !== 'accounts') this.unsaved.forEach((o, k) => this.carry.set(k, o));
    this.teamCfg = null;
    this.pending = new Map();
    this.unsaved = new Map();
    this.delivered = new Map();
    this.teamNeedKey = false;
    this.teamFiles = null;
    this.docRetryAt = this.docFails = 0;
    this.hidden = new Set();
    this.others = [];
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
