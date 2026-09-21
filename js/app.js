/*
 * app.js — 主控：输入 → Worker diff → 折叠/渲染/同步滚动 → IndexedDB 持久化。
 * 异常策略：任何环节失败都 toast 提示，且不让应用进入不可用状态。
 */
import { computeFoldRegions, buildVisibleItems, findChange } from './model.js';
import { DiffPane, Minimap, linkScroll, ROW_H } from './view.js';
import { idbGet, idbSet } from './db.js';
import { showToast } from './toast.js';

const MAX_FILE_MB = 20;
const SESSION_KEY = 'session';

const $ = (id) => document.getElementById(id);
const els = {
  leftText: $('left-text'), rightText: $('right-text'),
  leftFile: $('left-file'), rightFile: $('right-file'),
  leftName: $('left-name'), rightName: $('right-name'),
  compareBtn: $('compare-btn'), demoBtn: $('demo-btn'), editBtn: $('edit-btn'),
  prevBtn: $('prev-btn'), nextBtn: $('next-btn'),
  collapseBtn: $('collapse-btn'), expandBtn: $('expand-btn'),
  contextSel: $('context-sel'),
  inputPanel: $('input-panel'), diffView: $('diff-view'),
  status: $('status'), spinner: $('spinner'),
  minimap: $('minimap'),
};

const state = {
  leftLines: [], rightLines: [],
  rows: [],          // worker 返回的全量行
  regions: [],       // 可折叠区域
  collapsed: new Set(),
  items: [],         // 可见项
  jobId: 0,
  worker: null,
};

/* ---------- Worker ---------- */

function ensureWorker() {
  if (state.worker) return state.worker;
  const w = new Worker('js/diff-worker.js');
  w.onerror = (e) => {
    setBusy(false);
    showToast('后台计算出错：' + (e.message || '未知错误'), 'error', 6000);
  };
  state.worker = w;
  return w;
}

function runDiff(leftLines, rightLines) {
  const worker = ensureWorker();
  const id = ++state.jobId;
  setBusy(true);
  const maxEdits = 30000;
  worker.postMessage({ id, leftLines, rightLines, options: { maxEdits } });
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.id !== state.jobId) return; // 过期任务
    setBusy(false);
    if (msg.type === 'error') {
      showToast('对比失败：' + msg.message, 'error', 6000);
      return;
    }
    (msg.warnings || []).forEach((w) => showToast(w, 'warning', 6000));
    applyResult(msg.rows, leftLines, rightLines, msg.stats);
  };
}

/* ---------- 结果应用与渲染 ---------- */

const leftPane = new DiffPane($('pane-left'), 'left', expandRegion);
const rightPane = new DiffPane($('pane-right'), 'right', expandRegion);
const minimap = new Minimap(els.minimap, (rowIndex) => scrollToRow(rowIndex));

linkScroll(
  $('pane-left').querySelector('.scroll'),
  $('pane-right').querySelector('.scroll'),
  updateMinimapViewport
);

function applyResult(rows, leftLines, rightLines, stats) {
  state.rows = rows;
  state.leftLines = leftLines;
  state.rightLines = rightLines;
  rebuildFolds();
  els.inputPanel.classList.add('hidden');
  els.diffView.classList.remove('hidden');
  els.editBtn.classList.remove('hidden');
  const s = stats;
  els.status.textContent =
    `左 ${s.leftLines} 行 / 右 ${s.rightLines} 行 · 相同 ${s.equal} · 删除 ${s.del} · 新增 ${s.ins} · 修改 ${s.replace}`;
  if (rows.every((r) => r.t === 0)) {
    showToast('两份内容完全相同。', 'info');
  }
  refreshView();
  minimap.setRows(rows);
  updateMinimapViewport();
}

function rebuildFolds() {
  const context = Number(els.contextSel.value);
  state.regions = computeFoldRegions(state.rows, context);
  state.collapsed = new Set(state.regions.map((_, i) => i)); // 默认全部折叠
}

function refreshView(keepScroll = true) {
  const scroller = $('pane-left').querySelector('.scroll');
  const top = keepScroll ? scroller.scrollTop : 0;
  state.items = buildVisibleItems(state.rows, state.regions, state.collapsed);
  leftPane.setData(state.items, state.leftLines);
  rightPane.setData(state.items, state.rightLines);
  scroller.scrollTop = top;
  updateMinimapViewport();
}

function expandRegion(regionId) {
  state.collapsed.delete(regionId);
  refreshView();
}

function scrollToRow(rowIndex) {
  // 将「全量行号」映射到可见项下标
  let acc = 0;
  for (let i = 0; i < state.items.length; i++) {
    const it = state.items[i];
    if (it.kind === 'row') {
      if (acc === rowIndex || acc > rowIndex) { scrollToItem(i); return; }
      acc++;
    } else {
      if (rowIndex < acc + it.count) { scrollToItem(i); return; }
      acc += it.count;
    }
  }
}

function scrollToItem(itemIndex) {
  const top = Math.max(0, itemIndex * ROW_H - $('pane-left').querySelector('.scroll').clientHeight / 2);
  $('pane-left').querySelector('.scroll').scrollTop = top;
}

function updateMinimapViewport() {
  const scroller = $('pane-left').querySelector('.scroll');
  const total = scroller.scrollHeight - scroller.clientHeight;
  minimap.setViewport(
    total > 0 ? scroller.scrollTop / total : 0,
    scroller.scrollHeight > 0 ? scroller.clientHeight / scroller.scrollHeight : 1
  );
}

/* ---------- 事件 ---------- */

els.compareBtn.addEventListener('click', () => {
  const left = els.leftText.value, right = els.rightText.value;
  if (!left && !right) {
    showToast('请先输入或选择要对比的内容。', 'warning');
    return;
  }
  const leftLines = splitLines(left), rightLines = splitLines(right);
  persistSession();
  runDiff(leftLines, rightLines);
});

els.demoBtn.addEventListener('click', () => {
  const demo = makeDemo();
  els.leftText.value = demo.left;
  els.rightText.value = demo.right;
  showToast('已生成示例内容，点击「开始对比」查看效果。', 'info');
});

els.editBtn.addEventListener('click', () => {
  els.inputPanel.classList.remove('hidden');
  els.diffView.classList.add('hidden');
});

els.collapseBtn.addEventListener('click', () => {
  state.collapsed = new Set(state.regions.map((_, i) => i));
  refreshView();
});

els.expandBtn.addEventListener('click', () => {
  state.collapsed = new Set();
  refreshView();
});

els.contextSel.addEventListener('change', () => {
  if (state.rows.length === 0) return;
  rebuildFolds();
  refreshView(false);
});

els.prevBtn.addEventListener('click', () => jumpChange(-1));
els.nextBtn.addEventListener('click', () => jumpChange(1));

function jumpChange(dir) {
  if (state.items.length === 0) return;
  const scroller = $('pane-left').querySelector('.scroll');
  const current = Math.floor(scroller.scrollTop / ROW_H);
  const idx = findChange(state.items, current, dir);
  if (idx < 0) {
    showToast(dir > 0 ? '已是最后一处变更。' : '已是第一处变更。', 'info');
    return;
  }
  scrollToItem(idx);
}

function bindFileInput(input, textarea, nameEl) {
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      showToast(`文件「${file.name}」超过 ${MAX_FILE_MB}MB，已拒绝读取。`, 'error');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      textarea.value = String(reader.result || '');
      nameEl.textContent = file.name;
      persistSession();
    };
    reader.onerror = () => showToast('读取文件失败：' + (reader.error && reader.error.message || '未知错误'), 'error');
    reader.readAsText(file);
  });
}
bindFileInput(els.leftFile, els.leftText, els.leftName);
bindFileInput(els.rightFile, els.rightText, els.rightName);

/* ---------- 持久化（IndexedDB） ---------- */

let saveTimer = 0;
function persistSession() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await idbSet(SESSION_KEY, {
        left: els.leftText.value,
        right: els.rightText.value,
        leftName: els.leftName.textContent,
        rightName: els.rightName.textContent,
        savedAt: Date.now(),
      });
    } catch (err) {
      showToast('会话保存失败（不影响对比）：' + err.message, 'warning');
    }
  }, 500);
}
[els.leftText, els.rightText].forEach((t) => t.addEventListener('input', persistSession));

async function restoreSession() {
  try {
    const s = await idbGet(SESSION_KEY);
    if (s && (s.left || s.right)) {
      els.leftText.value = s.left || '';
      els.rightText.value = s.right || '';
      els.leftName.textContent = s.leftName || '';
      els.rightName.textContent = s.rightName || '';
      showToast('已恢复上次会话。', 'info');
    }
  } catch (err) {
    showToast('无法读取本地会话（IndexedDB 不可用）。', 'warning');
  }
}

/* ---------- 工具 ---------- */

function splitLines(text) {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function setBusy(busy) {
  els.spinner.classList.toggle('hidden', !busy);
  els.compareBtn.disabled = busy;
}

function makeDemo() {
  const left = [], right = [];
  for (let i = 1; i <= 3000; i++) {
    left.push(`line ${i}: const value_${i} = ${i * 7};`);
    if (i % 97 === 0) right.push(`line ${i}: const value_${i} = ${i * 7}; // modified`);
    else right.push(`line ${i}: const value_${i} = ${i * 7};`);
    if (i % 131 === 0) right.push(`line ${i}: inserted extra line after ${i};`);
    if (i % 173 === 0) left.push(`line ${i}: only-in-left ${i};`);
  }
  return { left: left.join('\n'), right: right.join('\n') };
}

restoreSession();
