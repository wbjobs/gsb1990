/*
 * diff-worker.js — 在 Web Worker 中执行 diff，避免阻塞 UI。
 * 输入:  { id, leftLines, rightLines, options }
 * 输出:  { type:'result', id, rows, stats, warnings }
 *        { type:'error',  id, message }
 * 行模型 row: { t, l, r, h }  t: 0=equal 1=del 2=ins 3=replace
 *        l/r 为行号（从 0 计），-1 表示该侧为空；h 为行内高亮（仅 replace）。
 */
importScripts('diff-core.js');

const MAX_INTRA_ROWS = 5000;   // 行内高亮的替换行数上限
const MAX_INTRA_LINE = 5000;   // 单行参与行内 diff 的字符数上限

self.onmessage = function (e) {
  const { id, leftLines, rightLines, options } = e.data;
  try {
    const result = DiffCore.diffLines(leftLines, rightLines, options);
    const built = buildRows(result.blocks, leftLines, rightLines);
    const warnings = [];
    if (result.fallback) {
      warnings.push('差异过大，已切换快速模式：结果正确但可能不是最小差异。');
    }
    if (built.intraSkipped) {
      warnings.push('变更行过多或行过长，已跳过部分行内高亮以保障性能。');
    }
    self.postMessage({
      type: 'result',
      id,
      rows: built.rows,
      stats: {
        leftLines: leftLines.length,
        rightLines: rightLines.length,
        equal: built.stats.equal,
        del: built.stats.del,
        ins: built.stats.ins,
        replace: built.stats.replace
      },
      warnings
    });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String((err && err.message) || err) });
  }
};

function buildRows(blocks, leftLines, rightLines) {
  const rows = [];
  const stats = { equal: 0, del: 0, ins: 0, replace: 0 };
  let intraBudget = MAX_INTRA_ROWS;
  let intraSkipped = false;

  // 把连续的 del/ins 聚成一个变更组，再两两配对为 replace
  let i = 0;
  while (i < blocks.length) {
    const blk = blocks[i];
    if (blk.type === 'equal') {
      for (let k = 0; k < blk.aEnd - blk.aStart; k++) {
        rows.push({ t: 0, l: blk.aStart + k, r: blk.bStart + k, h: null });
      }
      stats.equal += blk.aEnd - blk.aStart;
      i++;
      continue;
    }
    // 变更组
    const dels = [], inss = [];
    while (i < blocks.length && blocks[i].type !== 'equal') {
      const b = blocks[i];
      if (b.type === 'del') for (let x = b.aStart; x < b.aEnd; x++) dels.push(x);
      else for (let y = b.bStart; y < b.bEnd; y++) inss.push(y);
      i++;
    }
    const pairCount = Math.min(dels.length, inss.length);
    for (let k = 0; k < pairCount; k++) {
      const l = dels[k], r = inss[k];
      let h = null;
      if (intraBudget > 0 &&
          leftLines[l].length <= MAX_INTRA_LINE &&
          rightLines[r].length <= MAX_INTRA_LINE) {
        const d = DiffCore.diffChars(leftLines[l], rightLines[r]);
        if (!d.fallback && (d.aSegs.length || d.bSegs.length)) {
          h = { l: d.aSegs, r: d.bSegs };
        }
        intraBudget--;
      } else if (leftLines[l] !== rightLines[r]) {
        intraSkipped = true;
      }
      rows.push({ t: 3, l, r, h });
      stats.replace++;
    }
    for (let k = pairCount; k < dels.length; k++) {
      rows.push({ t: 1, l: dels[k], r: -1, h: null });
      stats.del++;
    }
    for (let k = pairCount; k < inss.length; k++) {
      rows.push({ t: 2, l: -1, r: inss[k], h: null });
      stats.ins++;
    }
  }
  return { rows, stats, intraSkipped };
}
