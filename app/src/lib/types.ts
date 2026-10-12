export type CfoStatus = 'active' | 'soon' | 'expired' | 'unknown' | 'none';
export type CertStatus = Exclude<CfoStatus, 'none'>;
export type StageKey = 'none' | 'contacted' | 'interested' | 'proposal' | 'won' | 'lost';
export type TaskType = 'call' | 'email' | 'meet' | 'follow';
export type FeedKey = 'watch' | 'cfoSoon' | 'cfoExp' | 'giSoon' | 'giDown' | 'newFac' | 'setNew' | 'noContact';

export interface Dicts {
  type: string[]; prov: string[]; ind: string[]; tgt: string[]; cfo: string[]; ct: string[]; match: string[];
}
export interface CertDicts { ind: string[]; size: string[]; prov: string[]; fy: string[] }

/** One row of the company register (gcc.json `rows`, positional — see COLS in core.ts). */
export type BaseRow = unknown[];

export interface Dataset {
  asOf: string;
  dicts: Dicts;
  rows: BaseRow[];
  cdicts: CertDicts;
  certs: unknown[];
  source: 'file' | 'upload';
  fileName?: string;
  uploadedAt?: string;
}

/** A raw register row decoded into named fields. */
export interface RawCompany {
  id: number; name: string; jur: string; type: number; prov: number; addr: string; ind: number; biz: string;
  src: number; tgt: number; cfo: number; cfoN: number | null; cfoEx: string;
  giNow: number | null; giMax: number | null; giUntil: string; newYm: string; invest: number | null; fac: number | null;
  set: string; mkt: string; phone: string; email: string; web: string; ct: number; match: number;
  ids: number[];
  merged?: boolean;
}

export interface ContactEdit { phone: string; email: string; web: string; note: string; at: string }
export type ContactForm = Omit<ContactEdit, 'at'>;
export type TaskForm = Pick<Task, 'type' | 'date' | 'time' | 'note'>;

/** A customer added by hand (not in the registry files); shared with the team like other records. */
export interface CustomCo {
  id: number; name: string; jur: string; prov: string; ind: string; biz: string; addr: string;
  phone: string; email: string; web: string; contact: string; note: string; at: string; by: string;
}

/** A company after dedup + status calculation. Computed fields are filled by engine.recalc(). */
export interface Company extends RawCompany {
  cEdited?: ContactEdit;
  // status (GCC.status)
  days: number | null;
  cfoSt: CfoStatus;
  giLive: number | null;
  giDays: number | null;
  hasPh: boolean;
  // engine.recalc
  code: string;
  hay: string;
  fl: Record<FeedKey, boolean>;
  rnd: string;
  rndKey: string;
  rndR: Round | null;
  rndLapse: number;
  rndIdeal: string | null;
}

export interface Cert {
  cid: number; gid: number; gid0: number; cert: string; org: string; branch: string; act: string;
  ind: number; size: number; addr: string; prov: number; provTxt?: string; zip: string;
  ap: string; ex: string; fy: number; s1: number | null; s2: number | null; s3: number | null;
  phone: string; email: string; webId: string; note: string;
  tgo?: boolean;
  // engine.recalc
  days: number | null; st: CertStatus; bad: boolean; co: Company | undefined; isLatest: boolean;
  hay: string; provName: string; indName: string; apT: number; exM: string; yr: string; hasScope: boolean;
}

export interface DupGroup { key: string; ids: number[]; why: 'auto' | 'nojur' | 'diffjur' | 'phone'; state: 'merged' | 'merge' | 'split' | 'pending' }

export interface Built {
  D: Dicts; CD: CertDicts; companies: Company[]; byId: Map<number, Company>; rawById: Map<number, RawCompany>;
  alias: Map<number, number>; groups: DupGroup[]; certs: Cert[];
}

export interface RoundRaw { no: string; m1: string; ann: string; doc: string; docOff?: string; fee: string; dl: string; cer?: string; annNote?: string; feeNote?: string }
export interface Round extends RoundRaw { annT: number; docT: number }

/** `pid`: the person (ผู้ติดต่อ) it is with, when made from that person's page. */
export interface Task { id: string; gid: number; title: string; type: TaskType; date: string; time: string; note: string; done: boolean; pid?: string }
/** `pid`: the person (ผู้ติดต่อ) it is about; such entries without a company are kept under `p-<pid>`. */
export interface LogEntry { id?: string; at: string; by: string; type: string; text?: string; result?: string; pid?: string }
export type PersonRole = '' | 'decision' | 'influencer' | 'coordinator' | 'user';
/** A contact person at a customer company, shared with the team (see people.ts). */
export interface Person {
  id: string; name: string; nick: string; pos: string; dept: string; role: PersonRole;
  /** Company everyone has (registry or added by hand); null = only named in `company`. */
  gid: number | null; company: string;
  phone: string; email: string; line: string; owner: string; status: 'active' | 'left'; note: string;
  at: string; by: string; upAt: string; upBy: string;
}
/**
 * A customer type (ประเภทลูกค้า) in the admin's list, as resolved from the defaults and the team's
 * changes (lib/ctypes.ts mergeDefs). Tags store the id, so a rename keeps every tag.
 */
export interface CTypeDef {
  /** stable: 'cfo' | 'cfp' | 'con' | 'vvb' | 'plt' | 'tvr', or generated for a type an admin adds */
  id: string;
  /** display name, at most 40 characters ("ทวนสอบ") */
  n: string;
  /** short description ("งานทวนสอบ (VVB)") */
  d?: string;
  /** colour slot 0–5 (the six validated hues; no free colour) */
  c: number;
  /** order in the list */
  o: number;
  /** deal Services that suggest this type (one service suggests at most one type) */
  svc: string[];
  /** retired on (ISO date); '' or missing = in use */
  off?: string;
  at: string; by: string;
}
/**
 * One customer's answer for one type (record `ctag/<ckey>/<typeId>`): 'y' = has it, 'n' = a remembered
 * "no" (a suggestion dismissed, or the type removed by hand: never suggested again). Over all the keys
 * that stand for one customer, the answer with the latest `at` wins (lib/ctypes.ts cmpTag).
 */
export interface CTag {
  s: 'y' | 'n'; at: string; by: string; src: 'hand' | 'deal' | 'bulk' | 'new';
  /** the Sales Tracker deal it was answered on (or moved with): the answer belongs to that deal's
   *  customer, wherever the deal is now (linked, re-linked, unlinked, its client renamed) */
  d?: string;
  /** how many times the answer moved to another key: at the same `at`, the later move wins */
  m?: number;
  /** a moved answer's mark (the key it moved to): no answer here any more, and it outranks the answer
   *  it moved, never a newer one a teammate wrote meanwhile */
  mv?: string;
}
export interface Crm {
  stages: Record<string, StageKey>;
  notes: Record<string, { at: string; text: string }[]>;
  tasks: Task[];
  watch: number[];
  owners: Record<string, string>;
  team: string[];
  log: Record<string, LogEntry[]>;
}

/** Per-source detail rows lazily loaded from data/gcc-detail/*.json (positional arrays). */
export interface Detail { t: { src: number; x: unknown[] }[]; g: { src: number; x: unknown[] }[]; f: { src: number; x: unknown[] }[]; s: { src: number; x: unknown[] }[] }

export interface MonEvent { t: string; id: number; at: string }
export interface MonitorCfg { snap: Record<string, string> | null; events: MonEvent[]; last: string | null; seenAt: string | null; notify: boolean }
export interface SyncCfg { freq: 'open' | 'daily' | 'weekly' | 'off'; proxy: string; autoApply: boolean; last?: string; lastMsg?: string; total?: number | null }
export interface SetSnap { syms: string[]; at: string; newSyms: Record<string, string> }
