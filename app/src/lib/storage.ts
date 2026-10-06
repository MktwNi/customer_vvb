/**
 * All persistence goes through this module. Today everything lives in the
 * browser (IndexedDB for large/structured data, localStorage for small settings),
 * exactly like the design prototype. To move to a shared backend, replace the
 * implementations below — callers only use `kv` and `prefs`.
 */

export interface KVStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /** Read-modify-write in a single transaction (safe across tabs). Returns the stored value. */
  update<T>(key: string, fn: (cur: T | null) => T): Promise<T>;
}

/** IndexedDB database/object-store names are kept identical to the prototype so existing browser data carries over. */
function indexedDbStore(dbName = 'gcc-registry', store = 'kv'): KVStore {
  let p: Promise<IDBDatabase> | null = null;
  const db = () =>
    p ||
    (p = new Promise((res, rej) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(store);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  const tx = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest | void) =>
    db().then(
      (d) =>
        new Promise<T>((res, rej) => {
          const t = d.transaction(store, mode);
          const q = f(t.objectStore(store));
          t.oncomplete = () => res((q && q.result) as T);
          t.onerror = () => rej(t.error);
          // quota errors and similar abort the transaction without an error event
          t.onabort = () => rej(t.error || new DOMException('Transaction aborted', 'AbortError'));
        }),
    );
  return {
    get: <T>(k: string) => tx<T>('readonly', (s) => s.get(k)).then((v) => (v === undefined ? null : v)).catch(() => null),
    set: (k, v) => tx<void>('readwrite', (s) => s.put(v, k)),
    del: (k) => tx<void>('readwrite', (s) => s.delete(k)),
    update: <T>(k: string, fn: (cur: T | null) => T) =>
      db().then(
        (d) =>
          new Promise<T>((res, rej) => {
            const t = d.transaction(store, 'readwrite');
            const os = t.objectStore(store);
            let next: T;
            const g = os.get(k);
            g.onsuccess = () => {
              try {
                next = fn(g.result === undefined ? null : (g.result as T));
                os.put(next, k);
              } catch (e) {
                rej(e);
                t.abort();
              }
            };
            t.oncomplete = () => res(next);
            t.onerror = () => rej(t.error);
            t.onabort = () => rej(t.error || new DOMException('Transaction aborted', 'AbortError'));
          }),
      ),
  };
}

/** In-memory store (no IndexedDB / tests — each call is an isolated "browser"). Values are
 *  copied in and out like IndexedDB does, so callers never share objects with the store. */
export function memoryStore(): KVStore {
  const m = new Map<string, unknown>();
  const out = <T>(k: string) => (m.has(k) ? (structuredClone(m.get(k)) as T) : null);
  return {
    get: async <T>(k: string) => out<T>(k),
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
    update: async <T>(k: string, fn: (cur: T | null) => T) => {
      const next = fn(out<T>(k));
      m.set(k, structuredClone(next));
      return next;
    },
  };
}

export const kv: KVStore = typeof indexedDB !== 'undefined' ? indexedDbStore() : memoryStore();

/** Small JSON settings in localStorage; every access is guarded (storage may be blocked). */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  getRaw(key: string): string {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

/** localStorage keys (same as the prototype). */
export const PREF = {
  ui: 'gcc-ui',
  me: 'gcc-me',
  monitor: 'gcc-monitor',
  sync: 'gcc-tgo-sync',
  team: 'gcc-team-sync',
} as const;
