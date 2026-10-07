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
  addSheet(name: string): { getRange(r: number, c: number, nr?: number, nc?: number): { setValues(v: string[][]): void } };
  DriveApp: {
    getFolderById(id: string): GasFolder;
    getFileById(id: string): GasFile;
    getRootFolder(): GasFolder;
    createFolder(name: string): GasFolder;
    createFile(blob: GasBlob): GasFile;
    createFile(name: string, content: string, mimeType?: string): GasFile;
  };
  Utilities: { newBlob(data: number[] | string, contentType?: string, name?: string): GasBlob; base64Encode(data: number[] | string): string; base64Decode(s: string): number[] };
  drive: { list(): GasDriveItem[]; remove(id: string): void };
  holdLock(): () => void;
  beforeLock(fn: () => void): void;
}
export function createGasSim(opts?: { teamKey?: string; code?: string; driveAuthorized?: boolean }): GasSim;
