export interface GasIterator<T> { hasNext(): boolean; next(): T }
export interface GasBlob {
  getBytes(): number[];
  getContentType(): string | null;
  setContentType(t: string): GasBlob;
  getName(): string | null;
  setName(n: string): GasBlob;
  getDataAsString(): string;
  copyBlob(): GasBlob;
}
export interface GasFile {
  getId(): string;
  getName(): string;
  setName(n: string): GasFile;
  getMimeType(): string;
  getSize(): number;
  getBlob(): GasBlob;
  getParents(): GasIterator<GasFolder>;
  isTrashed(): boolean;
  setTrashed(v: boolean): GasFile;
}
export interface GasFolder {
  getId(): string;
  getName(): string;
  setName(n: string): GasFolder;
  getParents(): GasIterator<GasFolder>;
  isTrashed(): boolean;
  setTrashed(v: boolean): GasFolder;
  createFolder(name: string): GasFolder;
  createFile(blob: GasBlob): GasFile;
  createFile(name: string, content: string, mimeType?: string): GasFile;
  getFiles(): GasIterator<GasFile>;
}
export interface GasDriveItem { id: string; kind: 'folder' | 'file'; name: string; parent: string | null; trashed: boolean; mime?: string; size: number }
export interface GasSim {
  post(body: unknown): Record<string, unknown> & {
    ok: boolean; seq?: number; rows?: { seq: number; k: string; v: unknown; del: boolean; by: string; at: string }[]; more?: boolean; error?: string; n?: number;
    files?: boolean; fileId?: string; size?: number; name?: string; mime?: string; data?: string;
  };
  get(): Record<string, unknown>;
  setup(): void;
  sheet(): GasSheet | undefined;
  /** Any sheet of the spreadsheet by name (e.g. "audit"), or undefined. */
  sheetOf(name: string): GasSheet | undefined;
  /** The script's capability catalogue, key table and built-in roles (undefined in scripts before capabilities). */
  consts: { CAPS_?: GasCap[]; KEY_CAP?: GasKeyRule[]; BUILTIN_ROLES?: { id: string; n: string; d: string }[] };
  /**
   * Mail the script sent (one recipient each), the daily quota left (assignable), whether a lock was held at
   * each send, `fail` = an error every send throws (e.g. no mail permission), `log` = called with each mail sent.
   */
  mail: { sent: GasMail[]; quota: number; calls: { at: number; locked: boolean }[]; fail: string; log: ((m: GasMail) => void) | null };
  /** Call a top-level function of the script by name (as Run or a trigger does, or a helper in a parity test); the result comes back through JSON. */
  run<T = unknown>(name: string, ...args: unknown[]): T;
  /** The project's time-driven triggers. */
  triggers: { getHandlerFunction(): string; getUniqueId(): string; getEventType(): string; every: number }[];
  props: Record<string, string>;
  cache: Record<string, string>;
  /** Drop everything in the script cache, as Google may do at any time. */
  evictCache(): void;
  addSheet(name: string): { getRange(r: number, c: number, nr?: number, nc?: number): { setValues(v: string[][]): void } };
  DriveApp: {
    getFolderById(id: string): GasFolder;
    getFileById(id: string): GasFile;
    getRootFolder(): GasFolder;
    createFolder(name: string): GasFolder;
    createFile(blob: GasBlob): GasFile;
    createFile(name: string, content: string, mimeType?: string): GasFile;
  };
  Utilities: {
    newBlob(data: number[] | string, contentType?: string, name?: string): GasBlob;
    base64Encode(data: number[] | string): string;
    base64Decode(s: string): number[];
    base64EncodeWebSafe(data: number[] | string): string;
    base64DecodeWebSafe(s: string): number[];
    computeDigest(alg: 'SHA_256', value: number[] | string): number[];
    computeHmacSha256Signature(value: number[] | string, key: number[] | string): number[];
    getUuid(): string;
  };
  drive: { list(): GasDriveItem[]; remove(id: string): void };
  /** Take the script lock (or the user lock) as another execution would; returns the release function. */
  holdLock(kind?: GasLockKind): () => void;
  /** Run fn just before that lock is next granted (a concurrent request that got there first); null cancels. */
  beforeLock(fn: (() => void) | null, kind?: GasLockKind): void;
  /** Properties and cache calls so far (assign 0 to reset). */
  stats: GasStats;
  /** Everything Logger.log printed (the editor's Execution log). */
  logs: string[];
  /** The last one-time code setup() printed ("1234-5678"). */
  ownerCode(): string | undefined;
  /** pk for a username and password with this team's id and iteration count (after setup or hello). */
  pk(u: string, pw: string): string;
  /** Run setup and claim the printed code as the first admin; returns the admin's session token. */
  bootstrapAdmin(o: { u: string; name: string; pw: string; rm?: boolean }): string;
}
export interface GasStats { propRead: number; propWrite: number; cacheGet: number }
export interface GasSheet { rows: string[][]; getLastRow(): number; getMaxRows(): number; getMaxColumns(): number }
/** A capability of Code.gs CAPS_: group, Thai label, real (redacted in pull), scope (may be 'own'), needs, built-in defaults [admin, sales, viewer]. */
export interface GasCap { id: string; g: 'v' | 'e' | 'a'; th: string; real?: number; scope?: number; needs?: string; d: (0 | 1 | 'own')[] }
/** A row of Code.gs KEY_CAP: what writing (w) / deleting (d) a key prefix needs, and the own-work rule (ow / od). */
export interface GasKeyRule { p: string; w: string | string[]; d: string | string[]; ow?: 'deal' | 'resp' | 'by'; od?: 'deal' | 'resp' | 'by' }
export interface GasMail { to: string; subject: string; htmlBody?: string; body?: string; name?: string; replyTo?: string; [k: string]: unknown }
/** LockService's script lock, or its user lock (shared by every request of a web app that executes as its owner). */
export type GasLockKind = 'script' | 'user';
export function createGasSim(opts?: { teamKey?: string; code?: string; driveAuthorized?: boolean; kdfIter?: number }): GasSim;
/** pk as the web app derives it: base64url (no padding) of PBKDF2-HMAC-SHA256(NFC(pw), 'gcc-team|v1|' + tid + '|' + u, it, 32 bytes). */
export function derivePk(tid: string, it: number | string, u: string, pw: string): string;
