/*
 * diff-core.js — Myers O(ND) diff，线性空间（middle-snake 二分）+ 显式栈。
 * UMD：既可在 Web Worker 中 importScripts，也可在 Node 中 require（便于测试）。
 * 输出逐条 op：{ type: 'equal'|'del'|'ins', ax, bx }，ax/bx 为 a/b 中的下标。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiffCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_MAX_EDITS = 30000;

  /**
   * 对两个数组做 diff。元素用 === 比较。
   * 返回 { ops, fallback }；fallback=true 表示编辑距离超过预算，
   * 中间块退化为「整块删除+整块插入」，结果仍正确但非最小编辑脚本。
   */
  function diffArrays(a, b, options) {
    const maxEdits = (options && options.maxEdits) || DEFAULT_MAX_EDITS;
    const ops = [];
    const budget = { used: 0, limit: maxEdits, exceeded: false };
    const stack = [{ a0: 0, a1: a.length, b0: 0, b1: b.length }];
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame.op) { ops.push(frame.op); continue; }
      let a0 = frame.a0, a1 = frame.a1, b0 = frame.b0, b1 = frame.b1;
      // 公共前缀
      while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) {
        ops.push({ type: 'equal', ax: a0, bx: b0 });
        a0++; b0++;
      }
      // 公共后缀：先压栈（倒序），保证中间部分先出栈处理
      const sA = a1, sB = b1;
      while (a1 > a0 && b1 > b0 && a[a1 - 1] === b[b1 - 1]) { a1--; b1--; }
      for (let i = sA - 1, j = sB - 1; i >= a1; i--, j--) {
        stack.push({ op: { type: 'equal', ax: i, bx: j } });
      }
      const n = a1 - a0, m = b1 - b0;
      if (n === 0 && m === 0) continue;
      if (n === 0) {
        for (let j = b0; j < b1; j++) ops.push({ type: 'ins', ax: a0, bx: j });
        continue;
      }
      if (m === 0) {
        for (let i = a0; i < a1; i++) ops.push({ type: 'del', ax: i, bx: b0 });
        continue;
      }
      const mid = findMiddleSnake(a, a0, a1, b, b0, b1, budget);
      if (!mid) {
        budget.exceeded = true;
        for (let i = a0; i < a1; i++) ops.push({ type: 'del', ax: i, bx: b0 });
        for (let j = b0; j < b1; j++) ops.push({ type: 'ins', ax: a1, bx: j });
        continue;
      }
      stack.push({ a0: mid.ax, a1: a1, b0: mid.bx, b1: b1 });
      stack.push({ a0: a0, a1: mid.ax, b0: b0, b1: mid.bx });
    }
    return { ops: ops, fallback: budget.exceeded };
  }

  // Myers 线性空间 middle-snake。返回分割点 {ax, bx}（原数组下标），预算耗尽返回 null。
  function findMiddleSnake(a, a0, a1, b, b0, b1, budget) {
    const n = a1 - a0, m = b1 - b0;
    const max = n + m;
    const delta = n - m;
    const odd = (delta & 1) !== 0;
    const offset = max;
    const vf = new Int32Array(2 * max + 1);
    const vb = new Int32Array(2 * max + 1);
    const ceilHalf = Math.ceil(max / 2);
    for (let d = 0; d <= ceilHalf; d++) {
      budget.used++;
      if (budget.used > budget.limit) return null;
      // 前向
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && vf[offset + k - 1] < vf[offset + k + 1])) x = vf[offset + k + 1];
        else x = vf[offset + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++; }
        vf[offset + k] = x;
        const kb = delta - k;
        if (odd && kb >= -(d - 1) && kb <= d - 1 && vf[offset + k] + vb[offset + kb] >= n) {
          return { ax: a0 + x, bx: b0 + y };
        }
      }
      // 后向（从末尾反向，x/y 表示距末尾的距离）
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && vb[offset + k - 1] < vb[offset + k + 1])) x = vb[offset + k + 1];
        else x = vb[offset + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[a1 - 1 - x] === b[b1 - 1 - y]) { x++; y++; }
        vb[offset + k] = x;
        const kf = delta - k;
        if (!odd && kf >= -d && kf <= d && vf[offset + kf] + vb[offset + k] >= n) {
          return { ax: a1 - x, bx: b1 - y };
        }
      }
    }
    return null;
  }

  /** 逐条 op 合并为块：{ type, aStart, aEnd, bStart, bEnd } */
  function mergeOps(ops) {
    const blocks = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const last = blocks[blocks.length - 1];
      if (last && last.type === op.type &&
          (op.type === 'equal'
            ? last.aEnd === op.ax && last.bEnd === op.bx
            : op.type === 'del' ? last.aEnd === op.ax : last.bEnd === op.bx)) {
        if (op.type !== 'ins') last.aEnd = op.ax + 1;
        if (op.type !== 'del') last.bEnd = op.bx + 1;
      } else {
        blocks.push({
          type: op.type,
          aStart: op.ax, aEnd: op.type === 'ins' ? op.ax : op.ax + 1,
          bStart: op.bx, bEnd: op.type === 'del' ? op.bx : op.bx + 1
        });
      }
    }
    return blocks;
  }

  /** 行级 diff：先把行哈希成整数 id 再比较，加速大文件。 */
  function diffLines(leftLines, rightLines, options) {
    const ids = new Map();
    let next = 0;
    const toIds = (lines) => {
      const out = new Int32Array(lines.length);
      for (let i = 0; i < lines.length; i++) {
        let id = ids.get(lines[i]);
        if (id === undefined) { id = next++; ids.set(lines[i], id); }
        out[i] = id;
      }
      return out;
    };
    const a = toIds(leftLines);
    const b = toIds(rightLines);
    const { ops, fallback } = diffArrays(a, b, options);
    return { blocks: mergeOps(ops), fallback };
  }

  /**
   * 字符级 diff（用于替换行内高亮）。返回两侧「不同」的区间 [start, end)。
   * 超预算时 fallback=true 且区间为空（调用方应整行高亮）。
   */
  function diffChars(textA, textB, options) {
    const opts = Object.assign({ maxEdits: 4000 }, options);
    const a = Array.from(textA);
    const b = Array.from(textB);
    const { ops, fallback } = diffArrays(a, b, opts);
    if (fallback) return { aSegs: [], bSegs: [], fallback: true };
    const aSegs = [], bSegs = [];
    for (const op of ops) {
      if (op.type === 'del') pushSeg(aSegs, op.ax);
      else if (op.type === 'ins') pushSeg(bSegs, op.bx);
    }
    return { aSegs, bSegs, fallback: false };
  }

  function pushSeg(segs, idx) {
    const last = segs[segs.length - 1];
    if (last && last[1] === idx) last[1] = idx + 1;
    else segs.push([idx, idx + 1]);
  }

  return { diffArrays, diffLines, diffChars, mergeOps, DEFAULT_MAX_EDITS };
});
