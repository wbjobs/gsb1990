/*
 * model.js — 折叠区域计算与可见行展开。
 * 折叠：连续 equal 行超过 context*2+1 时，中间部分可折叠为一条「折叠条」。
 * 可见项 visible item:
 *   { kind:'row',  row }            普通行（row 来自 worker）
 *   { kind:'fold', regionId, count, firstRow }  折叠条
 */

/** 找出所有可折叠区域（不依赖折叠状态）。返回 [{start, end, count}]，[start,end) 为被隐藏的行下标。 */
export function computeFoldRegions(rows, context = 3, minRun = 8) {
  const regions = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].t !== 0) { i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].t === 0) j++;
    const run = j - i;
    if (run > context * 2 + 1 && run >= minRun) {
      regions.push({ start: i + context, end: j - context, count: run - context * 2 });
    }
    i = j;
  }
  return regions;
}

/**
 * 根据折叠状态生成可见项列表。
 * collapsed: Set<regionId>，regionId 为 regions 数组下标。
 */
export function buildVisibleItems(rows, regions, collapsed) {
  const hidden = new Array(rows.length).fill(-1); // rowIndex -> regionId
  regions.forEach((rg, id) => {
    if (!collapsed.has(id)) return;
    for (let k = rg.start; k < rg.end; k++) hidden[k] = id;
  });
  const items = [];
  let i = 0;
  while (i < rows.length) {
    const rg = hidden[i];
    if (rg >= 0) {
      items.push({ kind: 'fold', regionId: rg, count: regions[rg].count, firstRow: regions[rg].start });
      i = regions[rg].end;
    } else {
      items.push({ kind: 'row', row: rows[i] });
      i++;
    }
  }
  return items;
}

/** 可见项中下一个/上一个「变更行」的位置（用于 上一处/下一处 跳转）。 */
export function findChange(items, fromIndex, dir) {
  let i = fromIndex + dir;
  while (i >= 0 && i < items.length) {
    const it = items[i];
    if (it.kind === 'row' && it.row.t !== 0) return i;
    if (it.kind === 'fold') {
      // 折叠区域内全是 equal，跳过
    }
    i += dir;
  }
  return -1;
}
