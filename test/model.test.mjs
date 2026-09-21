import assert from 'assert';
import { computeFoldRegions, buildVisibleItems, findChange } from '../js/model.js';

// 构造行：t=0 equal, 其他为变更
const eq = (n) => Array.from({ length: n }, () => ({ t: 0, l: 0, r: 0, h: null }));

// 短相同段不折叠
{
  const rows = [...eq(5), { t: 1, l: 0, r: -1, h: null }, ...eq(5)];
  assert.strictEqual(computeFoldRegions(rows, 3).length, 0);
}
// 长相同段折叠中间，保留上下文
{
  const rows = [...eq(20), { t: 2, l: -1, r: 0, h: null }, ...eq(20)];
  const regions = computeFoldRegions(rows, 3);
  assert.strictEqual(regions.length, 2);
  assert.deepStrictEqual(regions[0], { start: 3, end: 17, count: 14 });
  assert.deepStrictEqual(regions[1], { start: 24, end: 38, count: 14 });

  // 全部折叠：可见项 = 3 + fold + 3 + change + 3 + fold + 3
  const items = buildVisibleItems(rows, regions, new Set([0, 1]));
  assert.strictEqual(items.length, 3 + 1 + 3 + 1 + 3 + 1 + 3);
  assert.strictEqual(items[3].kind, 'fold');
  assert.strictEqual(items[3].count, 14);
  // 展开后无折叠条
  const expanded = buildVisibleItems(rows, regions, new Set());
  assert.strictEqual(expanded.length, rows.length);
  assert.ok(expanded.every((i) => i.kind === 'row'));
  // 跳转：从 0 向后找变更，应命中中间的 change 行（下标 7）
  assert.strictEqual(findChange(items, 0, 1), 7);
  assert.strictEqual(findChange(items, 7, 1), -1);
  assert.strictEqual(findChange(items, items.length - 1, -1), 7);
}
// 全相同：整段一个折叠区
{
  const rows = eq(100);
  const regions = computeFoldRegions(rows, 3);
  assert.strictEqual(regions.length, 1);
  assert.strictEqual(regions[0].count, 94);
}
console.log('model: all tests passed');
