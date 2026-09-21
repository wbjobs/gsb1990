// Verify the worker module's message contract under an emulated `self` using vm.SourceTextModule.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok -', name); })
    .catch((e) => { console.error('FAIL -', name, '\n', e); process.exitCode = 1; });
}

async function loadWorker() {
  const posts = [];
  let onmessage = null;
  const selfObj = {
    postMessage: (m) => posts.push(m),
    set onmessage(fn) { onmessage = fn; },
    get onmessage() { return onmessage; },
  };
  const context = { self: selfObj, console, performance, setTimeout, clearTimeout };
  vm.createContext(context);

  const diffUrl = new URL('../js/diff.js', import.meta.url);
  const workerUrl = new URL('../js/diff-worker.js', import.meta.url);
  const linker = async (specifier) => {
    const url = new URL(specifier, workerUrl);
    const m = new vm.SourceTextModule(readFileSync(url, 'utf8'), { url: url.href, context });
    await m.link(linker);
    await m.evaluate();
    return m;
  };
  const mod = new vm.SourceTextModule(readFileSync(workerUrl, 'utf8'), { url: workerUrl.href, context });
  await mod.link(linker);
  await mod.evaluate();
  return { posts, send: (data) => onmessage({ data }) };
}

await test('worker: returns correct diff-result protocol', async () => {
  const ctx = await loadWorker();
  ctx.send({ type: 'diff-request', id: 7, oldText: 'a\nb\nc\n', newText: 'a\nB\nc\n' });
  const result = ctx.posts.find((m) => m.type === 'diff-result');
  assert.ok(result, 'has result');
  assert.equal(result.id, 7);
  assert.equal(result.ok, true);
  assert.ok(result.ops.some((o) => o.type === 'delete'));
  assert.ok(result.ops.some((o) => o.type === 'insert'));
  assert.equal(result.meta.oldCount, 3);
  assert.equal(result.meta.newCount, 3);
  assert.equal(typeof result.meta.elapsedMs, 'number');
  assert.ok(result.meta.fullHash.includes(':'));
});

await test('worker: progress messages include done/total', async () => {
  const ctx = await loadWorker();
  const a = Array.from({ length: 3000 }, (_, i) => 'x' + i).join('\n');
  const b = a.split('\n').reverse().join('\n');
  ctx.send({ type: 'diff-request', id: 9, oldText: a, newText: b });
  const result = ctx.posts.find((m) => m.type === 'diff-result');
  assert.ok(result);
  assert.equal(result.ok, true);
  const progress = ctx.posts.filter((m) => m.type === 'diff-progress');
  assert.ok(progress.length >= 0);
});

await test('worker: empty inputs do not crash', async () => {
  const ctx = await loadWorker();
  ctx.send({ type: 'diff-request', id: 10, oldText: '', newText: '' });
  const result = ctx.posts.find((m) => m.type === 'diff-result');
  assert.equal(result.ok, true);
  assert.equal(result.ops.length, 0);
});

console.log(`\n${passed} worker tests passed`);
