// diff.js — Myers diff with automatic patience fallback and inline (word-level) diff.
// Pure ESM, runs in both browser and Node. No DOM access here.

export function splitLines(text) {
  if (text === '' || text == null) return [];
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized.endsWith('\n')) return normalized.slice(0, -1).split('\n');
  return normalized.split('\n');
}

/**
 * Patience diff — stable, worst-case O((n+m) log(n+m)) via LIS.
 * Used as a fallback when Myers would be too slow / too memory hungry.
 */
export function patienceDiff(a, b, isEqual = (x, y) => x === y) {
  const ops = [];
  const unique = new Map();
  for (let i = 0; i < a.length; i++) {
    const entry = unique.get(a[i]);
    if (!entry) unique.set(a[i], { line: i, count: 1 });
    else entry.count++;
  }
  const matches = [];
  const seenB = new Set();
  for (let j = 0; j < b.length; j++) {
    const entry = unique.get(b[j]);
    if (entry && entry.count === 1 && !seenB.has(b[j])) {
      seenB.add(b[j]);
      matches.push([entry.line, j]);
    }
  }
  matches.sort((p, q) => p[0] - q[0]);

  // LIS on the b indices (strictly increasing).
  const tails = [];
  const prev = new Array(matches.length).fill(-1);
  for (let i = 0; i < matches.length; i++) {
    const v = matches[i][1];
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (matches[tails[mid]][1] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const lis = [];
  if (tails.length) {
    let k = tails[tails.length - 1];
    while (k !== -1) { lis.push(matches[k]); k = prev[k]; }
    lis.reverse();
  }

  let ai = 0, bi = 0;
  const flushTo = (endA, endB) => {
    // Canonical patience fallback for regions without unique common lines:
    // consume true diagonal matches, otherwise use set membership to decide
    // which side advances. Always valid, not necessarily minimal.
    const restB = new Set();
    for (let k = bi; k < endB; k++) restB.add(b[k]);
    const restA = new Set();
    for (let k = ai; k < endA; k++) restA.add(a[k]);
    while (ai < endA || bi < endB) {
      if (ai >= endA) { ops.push({ type: 'insert', newIndex: bi }); bi++; continue; }
      if (bi >= endB) { ops.push({ type: 'delete', oldIndex: ai }); ai++; continue; }
      if (isEqual(a[ai], b[bi])) { ops.push({ type: 'equal', oldIndex: ai, newIndex: bi }); ai++; bi++; continue; }
      const aInB = restB.has(a[ai]);
      const bInA = restA.has(b[bi]);
      if (!aInB) { ops.push({ type: 'delete', oldIndex: ai }); restA.delete(a[ai]); ai++; }
      else if (!bInA) { ops.push({ type: 'insert', newIndex: bi }); restB.delete(b[bi]); bi++; }
      else { ops.push({ type: 'delete', oldIndex: ai }); ai++; }
    }
  };
  for (const [ma, mb] of lis) {
    flushTo(ma, mb);
    ops.push({ type: 'equal', oldIndex: ai, newIndex: bi });
    ai++; bi++;
  }
  flushTo(a.length, b.length);
  return { ops, fallback: false, method: 'patience' };
}

const FALLBACK_EDITS = 4000;    // SES longer than this -> patience
const FALLBACK_BUDGET_MS = 120; // wall-clock budget inside Myers
const MAX_TRACE_MB = 96;

/**
 * Myers O(ND) diff with Int32Array V rows.
 * Returns { ops, fallback, method, reason? }.
 */
export function myersDiff(a, b, isEqual = (x, y) => x === y, onProgress = null) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const bail = (reason) => {
    const e = new Error('myers-bailout');
    e.bail = true;
    e.reason = reason;
    throw e;
  };

  let trace = [];
  try {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const v = new Int32Array(2 * max + 1);
    v.fill(-1);
    v[max + 1] = 0;
    trace.push(v.slice()); // d = 0 initial row
    let found = false;
    for (let d = 0; d <= max && !found; d++) {
      const row = v.slice();
      if (d > 0) trace.push(row);
      for (let k = -d; k <= d; k += 2) {
        const idx = k + max;
        let x;
        if (k === -d || (k !== d && row[idx - 1] < row[idx + 1])) x = row[idx + 1];
        else x = row[idx - 1] + 1;
        let y = x - k;
        while (x < n && y < m && isEqual(a[x], b[y])) { x++; y++; }
        v[idx] = x;
        if (x >= n && y >= m) { found = true; break; }
      }
      if (found) break;
      if (d >= FALLBACK_EDITS) bail('edits');
      if (trace.length * v.byteLength > MAX_TRACE_MB * 1024 * 1024) bail('memory');
      if (onProgress && (d & 31) === 0) {
        onProgress(Math.min(d, max), max);
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (now - t0 > FALLBACK_BUDGET_MS) bail('time');
      }
    }

    // Backtrack over saved V rows.
    const ops = [];
    let x = n, y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const row = trace[d];
      const k = x - y;
      const kPrev = (k === -d || (k !== d && row[k + max - 1] < row[k + max + 1])) ? k + 1 : k - 1;
      const prevX = row[kPrev + max];
      const prevY = prevX - kPrev;
      while (x > prevX && y > prevY) { ops.push({ type: 'equal', oldIndex: x - 1, newIndex: y - 1 }); x--; y--; }
      if (d > 0) {
        if (x === prevX) { ops.push({ type: 'insert', newIndex: y - 1 }); y--; }
        else { ops.push({ type: 'delete', oldIndex: x - 1 }); x--; }
      }
    }
    ops.reverse();
    return { ops, fallback: false, method: 'myers' };
  } catch (e) {
    if (e && e.bail) {
      return { ops: patienceDiff(a, b, isEqual), fallback: true, method: 'patience', reason: e.reason };
    }
    throw e;
  }
}

export function diffLines(a, b, opts = {}) {
  const isEqual = opts.isEqual || ((x, y) => x === y);
  return myersDiff(a, b, isEqual, opts.onProgress);
}

// ---- Inline (word-level) diff for paired changed lines ----

const TOKEN_RE = /(\s+|[A-Za-z0-9_]+|.)/g;

export function tokenize(line) {
  if (line === '' || line == null) return [];
  return line.match(TOKEN_RE) || [];
}

function lcsPieces(oldTokens, newTokens) {
  const n = oldTokens.length, m = newTokens.length;
  if (n * m > 60000) return null; // too large for quadratic inline LCS
  const w = m + 1;
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const k = i * w + j;
      dp[k] = oldTokens[i] === newTokens[j]
        ? dp[k + w + 1] + 1
        : Math.max(dp[k + w], dp[k + 1]);
    }
  }
  const pieces = [];
  let i = 0, j = 0;
  const push = (kind, text) => {
    const last = pieces[pieces.length - 1];
    if (last && last.type === kind) last.text += text;
    else pieces.push({ type: kind, text });
  };
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) { push('equal', oldTokens[i]); i++; j++; }
    else if (dp[i * w + j + 1] >= dp[(i + 1) * w + j]) { push('add', newTokens[j]); j++; }
    else { push('del', oldTokens[i]); i++; }
  }
  while (j < m) push('add', newTokens[j++]);
  while (i < n) push('del', oldTokens[i++]);
  return pieces;
}

/**
 * Align deletes/insertions inside a change run into side-by-side rows:
 *   { kind:'pair',   old:{index,text,pieces}, new:{index,text,pieces} }
 *   { kind:'delete', index, text, pieces }
 *   { kind:'insert', index, text, pieces }
 * Paired similar lines share one row; unpaired lines are half rows.
 */
export function pairChanged(deletes, inserts, opts = {}) {
  const maxInlineTokens = opts.maxInlineTokens || 300;
  const pairOfDelete = new Map();
  const pairedInsert = new Set();
  for (const da of deletes) {
    const ta = tokenize(da.text);
    if (ta.length === 0 || ta.length > maxInlineTokens) continue;
    const setA = new Set(ta);
    let best = -1, bestScore = 0.15;
    for (let bi = 0; bi < inserts.length; bi++) {
      if (pairedInsert.has(bi)) continue;
      const tb = tokenize(inserts[bi].text);
      if (tb.length === 0 || tb.length > maxInlineTokens) continue;
      const setB = new Set(tb);
      let inter = 0;
      for (const t of setA) if (setB.has(t)) inter++;
      const score = inter / (setA.size + setB.size - inter);
      if (score > bestScore) { bestScore = score; best = bi; }
    }
    if (best !== -1) {
      pairedInsert.add(best);
      pairOfDelete.set(da.index, best);
    }
  }

  const out = [];
  for (const da of deletes) {
    const bi = pairOfDelete.get(da.index);
    if (bi === undefined) {
      out.push({ kind: 'delete', index: da.index, text: da.text, pieces: null });
    } else {
      const ib = inserts[bi];
      const pieces = lcsPieces(tokenize(da.text), tokenize(ib.text));
      out.push({
        kind: 'pair',
        old: { index: da.index, text: da.text, pieces: pieces && pieces.filter((p) => p.type !== 'add') },
        new: { index: ib.index, text: ib.text, pieces: pieces && pieces.filter((p) => p.type !== 'del') },
      });
    }
  }
  inserts.forEach((ib, bi) => {
    if (!pairedInsert.has(bi)) {
      out.push({ kind: 'insert', index: ib.index, text: ib.text, pieces: null });
    }
  });
  return out;
}
