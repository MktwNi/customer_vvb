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
  sheet(): { rows: string[][]; getLastRow(): number; getMaxRows(): number; getMaxColumns(): number } | undefined;
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
  holdLock(): () => void;
  beforeLock(fn: () => void): void;
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
export function createGasSim(opts?: { teamKey?: string; code?: string; driveAuthorized?: boolean; kdfIter?: number }): GasSim;
/** pk as the web app derives it: base64url (no padding) of PBKDF2-HMAC-SHA256(NFC(pw), 'gcc-team|v1|' + tid + '|' + u, it, 32 bytes). */
export function derivePk(tid: string, it: number | string, u: string, pw: string): string;
