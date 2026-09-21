// Storage logic test with an in-memory IndexedDB fake.
import assert from 'node:assert/strict';

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log('  ok -', name); })
    .catch((e) => { console.error('FAIL -', name, '\n', e); process.exitCode = 1; });
}

function installFakeIndexedDB(fail = false) {
  const stores = new Map();
  class Store {
    constructor(name) { this.name = name; this.data = new Map(); }
    put(v) { this.data.set(v.key != null ? v.key : v.id, structuredClone(v)); return makeReq(null); }
    get(k) { return makeReq(this.data.has(k) ? structuredClone(this.data.get(k)) : undefined); }
    clear() { this.data.clear(); return makeReq(null); }
  }
  function makeReq(result) {
    const handlers = {};
    const req = {
      result,
      get onsuccess() { return null; },
      set onsuccess(fn) { queueMicrotask(() => fn({ target: req })); },
      get onerror() { return null; },
      set onerror(_v) {},
    };
    return req;
  }
  class TX {
    constructor(storeNames, mode) {
      this.oncomplete = null; this.onerror = null; this.onabort = null;
      queueMicrotask(() => this.oncomplete && this.oncomplete());
    }
    objectStore(name) { return stores.get(name); }
  }
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    transaction: (names, mode) => new TX(names, mode),
  };
  globalThis.indexedDB = fail ? undefined : {
    open() {
      const names = ['documents', 'diffCache', 'prefs'];
      const req = {
        result: db,
        set onsuccess(fn) { queueMicrotask(() => fn({ target: req })); },
        set onerror(fn) {},
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        names.forEach((n) => { if (!stores.has(n)) stores.set(n, new Store(n)); });
      });
      return req;
    },
  };
}

await test('storage: put/get document, cache and prefs', async () => {
  installFakeIndexedDB();
  const { Storage } = await import(`../js/storage.js?${Date.now()}`);
  const s = new Storage();
  assert.equal(await s.init(), true);
  assert.equal(await s.saveDocument('d1', 'aaa', 'bbb', 'label'), true);
  const doc = await s.getDocument('d1');
  assert.equal(doc.oldText, 'aaa');
  assert.equal(doc.newText, 'bbb');

  const key = s.cacheKey('hello world', 'hello brave world');
  assert.match(key, /^v1:\d+:\d+:[0-9a-f]+$/);
  assert.equal(await s.putCachedDiff(key, { ops: [{ type: 'equal' }], fullHash: 'abc:def' }), true);
  const hit = await s.getCachedDiff(key);
  assert.equal(hit.payload.fullHash, 'abc:def');

  assert.equal(await s.savePrefs({ foldMode: 'all' }), true);
  const prefs = await s.getPrefs();
  assert.equal(prefs.foldMode, 'all');
});

await test('storage: same input -> same key; different -> different key', async () => {
  installFakeIndexedDB();
  const { Storage } = await import(`../js/storage.js?${Date.now()}b`);
  const s = new Storage();
  await s.init();
  assert.equal(s.cacheKey('abc', 'xyz'), s.cacheKey('abc', 'xyz'));
  assert.notEqual(s.cacheKey('abc', 'xyz'), s.cacheKey('abc', 'xyZ'));
});

await test('storage: unavailable indexedDB degrades gracefully', async () => {
  installFakeIndexedDB(true);
  const { Storage } = await import(`../js/storage.js?${Date.now()}c`);
  const s = new Storage();
  assert.equal(await s.init(), false);
  assert.equal(await s.saveDocument('x', 'a', 'b'), false);
  assert.equal(await s.getDocument('x'), null);
});

console.log(`\n${passed} storage tests passed`);
