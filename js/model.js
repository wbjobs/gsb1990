// model.js — builds aligned view rows from atomic diff ops and handles folding.
// Pure ESM, no DOM.

import { pairChanged } from './diff.js';

/**
 * Build aligned rows from atomic ops.
 * Row kinds:
 *   equal  { kind, oldIndex, newIndex, text }
 *   pair   { kind:'pair', oldIndex, newIndex, oldText, newText, oldPieces, newPieces }
 *   delete { kind:'delete', oldIndex, text, pieces }
 *   insert { kind:'insert', newIndex, text, pieces }
 */
export function buildRows(ops, oldLines, newLines, inlineOpts = {}) {
  const rows = [];
  let additions = 0, deletions = 0;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'equal') {
      rows.push({ kind: 'equal', oldIndex: op.oldIndex, newIndex: op.newIndex, text: newLines[op.newIndex] });
      i++;
      continue;
    }
    const dels = [], ins = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') { dels.push({ index: ops[i].oldIndex, text: oldLines[ops[i].oldIndex] }); deletions++; }
      else { ins.push({ index: ops[i].newIndex, text: newLines[ops[i].newIndex] }); additions++; }
      i++;
    }
    for (const change of pairChanged(dels, ins, inlineOpts)) {
      if (change.kind === 'pair') {
        rows.push({
          kind: 'pair',
          oldIndex: change.old.index,
          newIndex: change.new.index,
          oldText: change.old.text,
          newText: change.new.text,
          oldPieces: change.old.pieces,
          newPieces: change.new.pieces,
        });
      } else if (change.kind === 'delete') {
        rows.push({ kind: 'delete', oldIndex: change.index, text: change.text, pieces: change.pieces });
      } else {
        rows.push({ kind: 'insert', newIndex: change.index, text: change.text, pieces: change.pieces });
      }
    }
  }
  return { rows, stats: { additions, deletions, total: additions + deletions } };
}

export const DEFAULT_THRESHOLD = 6;

// Deterministic fold id; boundaries are stable across re-diffs of the same anchors.
export function foldId(oldStart, oldEnd, newStart, newEnd) {
  return `${oldStart}-${oldEnd}|${newStart}-${newEnd}`;
}

export function defaultCollapsed(runLen, mode, threshold = DEFAULT_THRESHOLD) {
  if (mode === 'none') return false;
  if (mode === 'all') return runLen >= threshold;
  return runLen >= threshold * 3; // 'auto': only fold long, boring regions
}

/**
 * Apply folding state to base rows.
 * overrides: Map<foldId, boolean> — manual collapsed(true)/expanded(false) state.
 */
export function applyFolds(baseRows, mode, overrides, threshold = DEFAULT_THRESHOLD) {
  const out = [];
  let i = 0;
  while (i < baseRows.length) {
    if (baseRows[i].kind !== 'equal') { out.push(baseRows[i]); i++; continue; }
    let j = i;
    while (j < baseRows.length && baseRows[j].kind === 'equal') j++;
    const runLen = j - i;
    if (runLen >= threshold) {
      const first = baseRows[i], last = baseRows[j - 1];
      const id = foldId(first.oldIndex, last.oldIndex, first.newIndex, last.newIndex);
      let collapsed = defaultCollapsed(runLen, mode, threshold);
      if (overrides.has(id)) collapsed = overrides.get(id);
      if (collapsed) {
        out.push({
          kind: 'fold',
          id,
          startA: first.oldIndex + 1,
          endA: last.oldIndex + 1,
          startB: first.newIndex + 1,
          endB: last.newIndex + 1,
          count: runLen,
          beforeText: baseRows[i - 1] ? changeText(baseRows[i - 1]) : '',
          afterText: baseRows[j] ? changeText(baseRows[j]) : '',
        });
      } else {
        for (let k = i; k < j; k++) out.push(baseRows[k]);
      }
    } else {
      for (let k = i; k < j; k++) out.push(baseRows[k]);
    }
    i = j;
  }
  return out;
}

function changeText(row) {
  return row.text != null ? row.text : '';
}

export function toggleFold(overrides, id, currentlyCollapsed) {
  const next = new Map(overrides);
  next.set(id, !currentlyCollapsed);
  return next;
}

export function findRowAtOffset(rows, scrollTop, rowPx) {
  return Math.max(0, Math.min(rows.length - 1, Math.floor(scrollTop / rowPx)));
}
