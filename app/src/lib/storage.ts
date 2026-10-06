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
        }),
    );
  return {
    get: <T>(k: string) => tx<T>('readonly', (s) => s.get(k)).then((v) => (v === undefined ? null : v)).catch(() => null),
    set: (k, v) => tx<void>('readwrite', (s) => s.put(v, k)),
    del: (k) => tx<void>('readwrite', (s) => s.delete(k)),
  };
}

/** In-memory fallback (private mode / tests). */
function memoryStore(): KVStore {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => (m.has(k) ? (m.get(k) as T) : null),
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
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
