import assert from 'node:assert/strict';
import {
  splitLines, myersDiff, patienceDiff, diffLines, pairChanged, tokenize,
} from '../js/diff.js';
import { buildRows, applyFolds, toggleFold, foldId, DEFAULT_THRESHOLD } from '../js/model.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok -', name); }
  catch (e) { console.error('FAIL -', name, '\n', e); process.exitCode = 1; }
}

function applyOps(ops, a, b) {
  const rebuiltA = [], rebuiltB = [];
  for (const op of ops) {
    if (op.type === 'equal') { assert.equal(a[op.oldIndex], b[op.newIndex]); rebuiltA.push(a[op.oldIndex]); rebuiltB.push(b[op.newIndex]); }
    if (op.type === 'delete') rebuiltA.push(a[op.oldIndex]);
    if (op.type === 'insert') rebuiltB.push(b[op.newIndex]);
  }
  assert.deepEqual(rebuiltA, a, 'old side reconstructed');
  assert.deepEqual(rebuiltB, b, 'new side reconstructed');
}

function checkEditScript(a, b) {
  const r = myersDiff(a, b);
  applyOps(r.ops, a, b);
  return r;
}

// ---------- diff correctness ----------
test('splitLines: empty, trailing newline, CRLF', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\n'), ['a']);
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines('a\r\nb\r'), ['a', 'b']);
  assert.deepEqual(splitLines('no newline'), ['no newline']);
});

test('myers: identical files -> only equals', () => {
  const a = ['x', 'y', 'z'];
  const r = checkEditScript(a, a);
  assert.equal(r.ops.every((o) => o.type === 'equal'), true);
});

test('myers: pure insert', () => {
  const a = ['a', 'c'];
  const b = ['a', 'b', 'c'];
  const r = checkEditScript(a, b);
  assert.deepEqual(r.ops.filter((o) => o.type !== 'equal').map((o) => o.type), ['insert']);
});

test('myers: pure delete', () => {
  const r = checkEditScript(['a', 'b', 'c'], ['a', 'c']);
  assert.deepEqual(r.ops.filter((o) => o.type !== 'equal').map((o) => o.type), ['delete']);
});

test('myers: minimal edits classic case', () => {
  // abcabba -> cbabac (known Myers example)
  const a = ['a', 'b', 'c', 'a', 'b', 'b', 'a'];
  const b = ['c', 'b', 'a', 'b', 'a', 'c'];
  const r = checkEditScript(a, b);
  const edits = r.ops.filter((o) => o.type !== 'equal').length;
  assert.equal(edits, 5, 'SES length 5, got ' + edits);
});

test('myers: empty sides', () => {
  checkEditScript([], ['x', 'y']);
  checkEditScript(['x', 'y'], []);
  checkEditScript([], []);
});

test('myers: indices valid and ordered', () => {
  const a = 'the quick brown fox jumps over the lazy dog'.split(' ');
  const b = 'the slow brown fox leaped over a lazy cat'.split(' ');
  const r = checkEditScript(a, b);
  let oi = -1, ni = -1;
  for (const op of r.ops) {
    if (op.type === 'equal' || op.type === 'delete') { assert.ok(op.oldIndex > oi); oi = op.oldIndex; }
    if (op.type === 'equal' || op.type === 'insert') { assert.ok(op.newIndex > ni); ni = op.newIndex; }
  }
});

test('patience fallback matches content', () => {
  const a = Array.from({ length: 3000 }, (_, i) => 'line' + (i % 7) + '-' + i);
  const b = a.slice();
  b.splice(1500, 0, 'brand-new-line');
  const r = myersDiff(a, b);
  applyOps(r.ops, a, b);
});

test('random fuzz: myers vs patience consistency', () => {
  for (let trial = 0; trial < 60; trial++) {
    const n = 1 + Math.floor(Math.random() * 40);
    const alpha = 3;
    const a = Array.from({ length: n }, () => 'v' + Math.floor(Math.random() * alpha));
    let b = a.slice();
    const edits = 1 + Math.floor(Math.random() * 6);
    for (let e = 0; e < edits; e++) {
      const pos = Math.floor(Math.random() * (b.length + 1));
      const roll = Math.random();
      if (roll < 0.4) b.splice(pos, 0, 'v' + Math.floor(Math.random() * alpha));
      else if (roll < 0.7 && b.length) b.splice(pos, 1);
      else if (b.length) b[pos] = 'v' + Math.floor(Math.random() * alpha);
    }
    const rm = myersDiff(a, b);
    const rp = patienceDiff(a, b);
    applyOps(rm.ops, a, b);
    applyOps(rp.ops, a, b);
    const em = rm.ops.filter((o) => o.type !== 'equal').length;
    const ep = rp.ops.filter((o) => o.type !== 'equal').length;
    assert.ok(ep >= em, 'patience cannot be shorter than SES');
  }
});

// ---------- inline diff ----------
test('pairChanged: simple rename becomes a pair row with pieces', () => {
  const rows = pairChanged(
    [{ index: 0, text: 'const foo = 1;' }],
    [{ index: 0, text: 'const bar = 1;' }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'pair');
  assert.ok(rows[0].old.pieces.some((p) => p.type === 'del' && p.text.includes('foo')));
  assert.ok(rows[0].new.pieces.some((p) => p.type === 'add' && p.text.includes('bar')));
});

test('pairChanged: unmatched lines stay separate half rows', () => {
  const rows = pairChanged([{ index: 0, text: 'aaaaaa' }], [{ index: 0, text: 'zzzzzz' }]);
  const del = rows.find((r) => r.kind === 'delete');
  const ins = rows.find((r) => r.kind === 'insert');
  assert.ok(del && ins);
  assert.equal(del.pieces, null);
  assert.equal(ins.pieces, null);
});

test('tokenize handles CJK as single chars', () => {
  assert.deepEqual(tokenize('你好'), ['你', '好']);
});

// ---------- rows + folds ----------
test('buildRows alignment and stats', () => {
  const a = ['keep', 'the old value here', 'keep2'];
  const b = ['keep', 'the new value here', 'keep2'];
  const { ops } = diffLines(a, b);
  const { rows, stats } = buildRows(ops, a, b);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, 'equal');
  assert.equal(rows[1].kind, 'pair');
  assert.equal(rows[1].oldIndex, 1);
  assert.equal(rows[1].newIndex, 1);
  assert.deepEqual(stats, { additions: 1, deletions: 1, total: 2 });
});

test('folds: long unchanged region collapses in auto mode', () => {
  const a = ['h0'];
  const b = ['h0'];
  for (let i = 0; i < 20; i++) { a.push('same' + i); b.push('same' + i); }
  a.push('tail-del'); b.push('tail-ins');
  const { ops } = diffLines(a, b);
  const { rows: base } = buildRows(ops, a, b);
  const folded = applyFolds(base, 'auto', new Map());
  assert.ok(folded.some((r) => r.kind === 'fold'), 'expected a fold row');
  const fold = folded.find((r) => r.kind === 'fold');
  assert.equal(fold.count, 21);
  assert.equal(fold.startA, 1);
  assert.equal(fold.endA, 21);
});

test('folds: none mode shows everything; toggle expands', () => {
  const a = ['h0']; const b = ['h0'];
  for (let i = 0; i < 20; i++) { a.push('same' + i); b.push('same' + i); }
  const { ops } = diffLines(a, b);
  const { rows: base } = buildRows(ops, a, b);
  assert.equal(applyFolds(base, 'none', new Map()).some((r) => r.kind === 'fold'), false);

  const folded = applyFolds(base, 'all', new Map());
  const fold = folded.find((r) => r.kind === 'fold');
  const expanded = applyFolds(base, 'all', toggleFold(new Map(), fold.id, true));
  assert.equal(expanded.some((r) => r.kind === 'fold' && r.id === fold.id), false);
});

test('folds: short equal runs never fold', () => {
  const a = ['a', 'b', 'c'];
  const b = ['a', 'x', 'c'];
  const { ops } = diffLines(a, b);
  const { rows: base } = buildRows(ops, a, b);
  assert.equal(applyFolds(base, 'all', new Map()).some((r) => r.kind === 'fold'), false);
});

// ---------- performance sanity ----------
test('perf: 50k near-identical lines completes fast', () => {
  const a = Array.from({ length: 50000 }, (_, i) => `line ${i}`);
  const b = a.slice();
  b[25000] = 'changed line';
  b.splice(40000, 0, 'inserted');
  const t0 = Date.now();
  const r = myersDiff(a, b);
  const ms = Date.now() - t0;
  applyOps(r.ops, a, b);
  assert.ok(ms < 3000, `took ${ms}ms`);
});

console.log(`\n${passed} tests passed`);
