// storage.js - IndexedDB persistence for inputs, diff cache and viewer prefs.
// All methods degrade gracefully: failures are reported, never thrown to callers.

const DB_NAME = 'diff-viewer';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';
const STORE_CACHE = 'diffCache';
const STORE_PREFS = 'prefs';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_PREFS)) db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function requestAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    if (req && typeof req.then === 'function') { req.then(resolve, reject); return; }
    t.oncomplete = () => resolve(undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

export class Storage {
  constructor() { this.db = null; this.enabled = true; }

  async init() {
    try {
      this.db = await openDB();
      this.enabled = true;
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  async put(store, value) {
    if (!this.enabled) return false;
    try { await tx(this.db, store, 'readwrite', (s) => s.put(value)); return true; }
    catch { return false; }
  }

  async get(store, key) {
    if (!this.enabled) return null;
    try {
      return await tx(this.db, store, 'readonly', (s) => requestAsPromise(s.get(key)));
    } catch { return null; }
  }

  async clear(store) {
    if (!this.enabled) return false;
    try { await tx(this.db, store, 'readwrite', (s) => requestAsPromise(s.clear())); return true; }
    catch { return false; }
  }

  saveDocument(id, oldText, newText, label) {
    return this.put(STORE_DOCS, { id, oldText, newText, label, updatedAt: Date.now() });
  }
  getDocument(id) { return this.get(STORE_DOCS, id); }

  cacheKey(oldText, newText) {
    let h = 0x811c9dc5;
    const sample = oldText.length + newText.length > 200000;
    const mix = (str) => {
      const step = sample ? Math.max(1, Math.floor(str.length / 50000)) : 1;
      for (let i = 0; i < str.length; i += step) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    };
    mix(oldText); mix('|'); mix(newText);
    return `v1:${oldText.length}:${newText.length}:${h.toString(16)}`;
  }

  getCachedDiff(key) { return this.get(STORE_CACHE, key); }
  putCachedDiff(key, payload) {
    return this.put(STORE_CACHE, { key, payload, createdAt: Date.now() });
  }

  savePrefs(prefs) { return this.put(STORE_PREFS, { key: 'ui', ...prefs }); }
  getPrefs() { return this.get(STORE_PREFS, 'ui'); }
}

export const STORES = { DOCS: STORE_DOCS, CACHE: STORE_CACHE, PREFS: STORE_PREFS };
