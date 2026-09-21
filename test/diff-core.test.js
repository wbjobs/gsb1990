'use strict';
const assert = require('assert');
const DiffCore = require('../js/diff-core.js');

// 朴素 DP 最小编辑距离（单位成本，只允许 删/插/相等）
function naiveDistance(a, b) {
  const n = a.length, m = b.length;
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : Math.min(prev[j] + 1, cur[j - 1] + 1);
    }
    prev = cur;
  }
  return prev[m];
}

// 应用 ops：从 a 重放应得到 b；同时校验下标单调合法
function applyOps(a, b, ops) {
  const out = [];
  let ai = 0, bi = 0;
  for (const op of ops) {
    if (op.type === 'equal') {
      assert.strictEqual(op.ax, ai); assert.strictEqual(op.bx, bi);
      assert.strictEqual(a[op.ax], b[op.bx]);
      out.push(a[op.ax]); ai++; bi++;
    } else if (op.type === 'del') {
      assert.strictEqual(op.ax, ai); ai++;
    } else {
      assert.strictEqual(op.bx, bi);
      out.push(b[op.bx]); bi++;
    }
  }
  assert.strictEqual(ai, a.length); assert.strictEqual(bi, b.length);
  return out;
}

function editCount(ops) {
  return ops.filter(o => o.type !== 'equal').length;
}

// 固定用例
{
  const { ops, fallback } = DiffCore.diffArrays([1, 2, 3], [1, 4, 3]);
  assert.strictEqual(fallback, false);
  assert.deepStrictEqual(applyOps([1, 2, 3], [1, 4, 3], ops), [1, 4, 3]);
  assert.strictEqual(editCount(ops), 2);
}
{
  const { ops } = DiffCore.diffArrays([], [1, 2]);
  assert.strictEqual(editCount(ops), 2);
  assert.deepStrictEqual(applyOps([], [1, 2], ops), [1, 2]);
}
{
  const { ops } = DiffCore.diffArrays([1, 2], []);
  assert.strictEqual(editCount(ops), 2);
  assert.deepStrictEqual(applyOps([1, 2], [], ops), []);
}
{
  const { ops, fallback } = DiffCore.diffArrays([5, 5, 5], [5, 5, 5]);
  assert.strictEqual(fallback, false);
  assert.strictEqual(editCount(ops), 0);
}

// 随机性质测试：编辑距离最小 + 可重放
let seed = 42;
function rand(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }
for (let t = 0; t < 2000; t++) {
  const n = rand(25), m = rand(25);
  const a = Array.from({ length: n }, () => rand(6));
  const b = Array.from({ length: m }, () => rand(6));
  const { ops, fallback } = DiffCore.diffArrays(a, b);
  assert.strictEqual(fallback, false);
  assert.deepStrictEqual(applyOps(a, b, ops), b, `replay failed t=${t}`);
  assert.strictEqual(editCount(ops), naiveDistance(a, b), `not minimal t=${t} a=${a} b=${b}`);
}

// 大输入 + 预算耗尽降级：结果仍可重放
{
  const n = 50000;
  const a = Array.from({ length: n }, (_, i) => i);
  const b = Array.from({ length: n }, (_, i) => i + n); // 完全不同
  const { ops, fallback } = DiffCore.diffArrays(a, b, { maxEdits: 1000 });
  assert.strictEqual(fallback, true);
  assert.deepStrictEqual(applyOps(a, b, ops), b);
}
// 大输入性能：10 万行、少量差异应快速完成
{
  const n = 100000;
  const a = Array.from({ length: n }, (_, i) => 'line-' + i);
  const b = a.slice();
  b[50000] = 'changed'; b.splice(70000, 0, 'inserted'); b.splice(20000, 1);
  const t0 = Date.now();
  const { blocks, fallback } = DiffCore.diffLines(a, b);
  const elapsed = Date.now() - t0;
  assert.strictEqual(fallback, false);
  assert.ok(elapsed < 2000, 'too slow: ' + elapsed + 'ms');
  const changes = blocks.filter(x => x.type !== 'equal');
  assert.strictEqual(changes.length, 4); // replace 拆为 del+ins 两块
}

// 字符级 diff
{
  const { aSegs, bSegs, fallback } = DiffCore.diffChars('hello world', 'hello there world');
  assert.strictEqual(fallback, false);
  assert.ok(bSegs.length >= 1);
  assert.strictEqual(aSegs.length, 0);
}

// mergeOps 合并
{
  const blocks = DiffCore.mergeOps([
    { type: 'equal', ax: 0, bx: 0 }, { type: 'equal', ax: 1, bx: 1 },
    { type: 'del', ax: 2, bx: 2 }, { type: 'del', ax: 3, bx: 2 },
    { type: 'ins', ax: 4, bx: 2 }, { type: 'ins', ax: 4, bx: 3 },
  ]);
  assert.deepStrictEqual(blocks, [
    { type: 'equal', aStart: 0, aEnd: 2, bStart: 0, bEnd: 2 },
    { type: 'del', aStart: 2, aEnd: 4, bStart: 2, bEnd: 2 },
    { type: 'ins', aStart: 4, aEnd: 4, bStart: 2, bEnd: 4 },
  ]);
}

console.log('diff-core: all tests passed');
