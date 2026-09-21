'use strict';
// 在 Node 中模拟 Worker 环境，冒烟测试 diff-worker.js 的消息协议与行对齐。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const posted = [];
global.self = global;
global.importScripts = (p) => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', p), 'utf8');
  // 屏蔽 module/exports，让 UMD 走 self.DiffCore 分支（模拟真实 Worker）
  new Function('module', 'exports', code).call(global, undefined, undefined);
};
global.postMessage = (msg) => posted.push(msg);

require('../js/diff-worker.js');

self.onmessage({
  data: {
    id: 1,
    leftLines: ['a', 'b', 'c', 'd'],
    rightLines: ['a', 'B2', 'c', 'e', 'f'],
    options: {},
  },
});
assert.strictEqual(posted.length, 1);
const msg = posted[0];
assert.strictEqual(msg.type, 'result');
assert.strictEqual(msg.id, 1);
// 期望行：equal(a) replace(b→B2) equal(c) replace(d→e) ins(f)
assert.deepStrictEqual(msg.rows.map((r) => r.t), [0, 3, 0, 3, 2]);
assert.deepStrictEqual(msg.rows.map((r) => [r.l, r.r]), [
  [0, 0], [1, 1], [2, 2], [3, 3], [-1, 4],
]);
// replace 行应有行内高亮
assert.ok(msg.rows[1].h && msg.rows[1].h.l.length > 0);
assert.strictEqual(msg.stats.replace, 2);
assert.strictEqual(msg.stats.del, 0);
assert.strictEqual(msg.stats.ins, 1);

// 异常路径：触发 error 消息（传入不可序列化/非法数据导致抛错）
posted.length = 0;
self.onmessage({ data: { id: 2, leftLines: null, rightLines: [], options: {} } });
assert.strictEqual(posted[0].type, 'error');
assert.strictEqual(posted[0].id, 2);

console.log('worker smoke: all tests passed');
