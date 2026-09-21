// app.js - orchestration: inputs, worker, cache, folds, errors, persistence.
import { splitLines } from './diff.js';
import { buildRows, applyFolds, toggleFold } from './model.js';
import { DiffView, ROW_PX } from './diff-view.js';
import { Minimap } from './minimap.js';
import { Storage } from './storage.js';

const $ = (sel) => document.querySelector(sel);

class DiffApp {
  constructor() {
    this.storage = new Storage();
    this.view = null;
    this.minimap = null;
    this.worker = null;
    this.reqId = 0;
    this.pending = null;          // newest text pair waiting
    this.inflightId = null;
    this.baseRows = [];
    this.ops = null;
    this.oldLines = [];
    this.newLines = [];
    this.foldMode = 'auto';
    this.overrides = new Map();
    this.debounceTimer = null;
    this.watchdogTimer = null;
    this.lastKey = null;
  }

  async init() {
    this.cacheDom();
    this.bindUi();
    const storageOk = await this.storage.init();
    if (!storageOk) this.toast('IndexedDB 不可用：缓存与自动保存已停用，功能不受影响', 'warn');

    this.minimap = new Minimap(this.el.minimap, (top) => this.view._setScrollTop(top));
    this.view = new DiffView({
      scroller: this.el.scroller,
      foldLayer: this.el.foldLayer,
      minimap: this.minimap,
      onFoldToggle: (id) => this.handleFoldToggle(id),
    });

    const prefs = await this.storage.getPrefs();
    if (prefs) {
      this.foldMode = prefs.foldMode || 'auto';
      if (prefs.wordWrap) document.body.classList.add('word-wrap');
    }
    this.syncFoldButtons();

    const doc = await this.storage.getDocument('last');
    if (doc && doc.oldText != null) {
      this.el.oldText.value = doc.oldText;
      this.el.newText.value = doc.newText;
    } else {
      this.loadSample();
    }
    this.scheduleRun(true);
  }

  cacheDom() {
    this.el = {
      oldText: $('#oldText'),
      newText: $('#newText'),
      runBtn: $('#runBtn'),
      swapBtn: $('#swapBtn'),
      sampleBtn: $('#sampleBtn'),
      clearBtn: $('#clearBtn'),
      foldAuto: $('#foldAuto'),
      foldAll: $('#foldAll'),
      foldNone: $('#foldNone'),
      scroller: $('#scroller'),
      foldLayer: $('#foldLayer'),
      minimap: $('#minimap'),
      status: $('#status'),
      toast: $('#toast'),
      progress: $('#progress'),
      stats: $('#stats'),
    };
  }

  bindUi() {
    let scheduled = false;
    const onInput = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; }, 300);
      this.scheduleRun(false);
    };
    this.el.oldText.addEventListener('input', onInput);
    this.el.newText.addEventListener('input', onInput);
    this.el.runBtn.addEventListener('click', () => this.scheduleRun(true));
    this.el.swapBtn.addEventListener('click', () => {
      const t = this.el.oldText.value;
      this.el.oldText.value = this.el.newText.value;
      this.el.newText.value = t;
      this.scheduleRun(true);
    });
    this.el.sampleBtn.addEventListener('click', () => { this.loadSample(); this.scheduleRun(true); });
    this.el.clearBtn.addEventListener('click', () => {
      this.el.oldText.value = ''; this.el.newText.value = '';
      this.scheduleRun(true);
    });

    this.el.foldAuto.addEventListener('click', () => this.setFoldMode('auto'));
    this.el.foldAll.addEventListener('click', () => this.setFoldMode('all'));
    this.el.foldNone.addEventListener('click', () => this.setFoldMode('none'));

    window.addEventListener('error', (e) => {
      this.toast('页面异常: ' + (e.message || '未知错误'), 'error');
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.toast('异步任务失败: ' + ((e.reason && e.reason.message) || e.reason || '未知错误'), 'error');
    });

    // Ctrl/Cmd+Enter forces immediate run
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') this.scheduleRun(true);
    });

    const save = () => {
      this.storage.saveDocument('last', this.el.oldText.value, this.el.newText.value, 'last');
    };
    setInterval(save, 5000);
    window.addEventListener('beforeunload', save);
  }

  setFoldMode(mode) {
    this.foldMode = mode;
    this.syncFoldButtons();
    this.rebuildView();
    this.storage.savePrefs({ foldMode: mode });
  }

  syncFoldButtons() {
    for (const [btn, mode] of [[this.el.foldAuto, 'auto'], [this.el.foldAll, 'all'], [this.el.foldNone, 'none']]) {
      btn.classList.toggle('active', mode === this.foldMode);
      btn.setAttribute('aria-pressed', String(mode === this.foldMode));
    }
  }

  handleFoldToggle(id) {
    const current = applyFolds(this.baseRows, this.foldMode, this.overrides)
      .find((r) => r.kind === 'fold' && r.id === id);
    this.overrides = toggleFold(this.overrides, id, !!current);
    this.rebuildView(true);
  }

  rebuildView(keepAnchor) {
    const rows = applyFolds(this.baseRows, this.foldMode, this.overrides);
    this.view.setRows(rows, keepAnchor);
    this.minimap.setData(rows, ROW_PX, this.el.scroller.clientHeight);
  }

  loadSample() {
    const oldText = [
      'function greet(name) {',
      '  const message = "hello, " + name;',
      '  console.log(message);',
      '  return message;',
      '}',
      '',
      'const unused = 42;',
      '',
      ...Array.from({ length: 26 }, (_, i) => `// unchanged padding line ${i + 1}`),
      '',
      'greet("world");',
    ].join('\n');
    const newText = [
      'function greet(name) {',
      '  const message = `hello, ${name}!`;',
      '  console.info(message);',
      '  return message.trim();',
      '}',
      '',
      'const value = 42;',
      '',
      ...Array.from({ length: 26 }, (_, i) => `// unchanged padding line ${i + 1}`),
      '',
      'greet("developer");',
      'greet("world");',
    ].join('\n');
    this.el.oldText.value = oldText;
    this.el.newText.value = newText;
  }

  scheduleRun(immediate) {
    clearTimeout(this.debounceTimer);
    const delay = immediate ? 0 : 450;
    this.debounceTimer = setTimeout(() => this.run(), delay);
  }

  async run() {
    const oldText = this.el.oldText.value;
    const newText = this.el.newText.value;
    const size = oldText.length + newText.length;
    if (size > 20 * 1024 * 1024) {
      this.toast('内容过大（>20MB），请拆分后再比较', 'error');
      return;
    }

    const key = this.storage.cacheKey(oldText, newText);
    if (key === this.lastKey && this.baseRows.length) return;

    const cached = await this.storage.getCachedDiff(key);
    if (cached && cached.payload && cached.payload.fullHash) {
      this.el.status.textContent = '已从 IndexedDB 缓存载入';
      this.consumeResult({ ok: true, ops: cached.payload.ops, meta: Object.assign({ cached: true }, cached.payload.meta) },
        oldText, newText, key);
      return;
    }

    this.ensureWorker();
    const id = ++this.reqId;
    this.pending = { id, oldText, newText, key };
    this.inflightId = id;
    this.el.status.textContent = '正在比较…';
    this.setProgress(0);
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      if (this.inflightId === id) {
        this.toast('比较耗时较长，仍在后台运行（大文件会自动切换算法）', 'warn');
      }
    }, 4000);

    this.worker.postMessage({ type: 'diff-request', id, oldText, newText });
  }

  ensureWorker() {
    if (this.worker) return;
    try {
      this.worker = new Worker('./js/diff-worker.js', { type: 'module' });
    } catch (e) {
      this.toast('无法启动 Web Worker，回退到主线程计算（大文件可能卡顿）', 'warn');
      this.worker = makeInlineWorkerFallback();
    }
    this.worker.onmessage = (e) => this.onWorkerMessage(e.data);
    this.worker.onerror = (e) => {
      this.toast('Worker 错误: ' + (e.message || '未知错误'), 'error');
    };
  }

  onWorkerMessage(msg) {
    if (msg.type === 'diff-progress') {
      if (this.inflightId !== msg.id) return;
      this.setProgress(msg.total ? msg.done / msg.total : 0);
      return;
    }
    // stale results from earlier edits (or progress of superseded runs) are ignored
    if (msg.type !== 'diff-result' || !this.pending || msg.id !== this.pending.id) return;
    clearTimeout(this.watchdogTimer);
    this.setProgress(1);
    this.consumeResult(msg, this.pending.oldText, this.pending.newText, this.pending.key);
    this.pending = null;
    this.inflightId = null;
  }

  consumeResult(msg, oldText, newText, key) {
    if (!msg.ok) {
      this.el.status.textContent = '比较失败';
      this.toast('Diff 计算失败: ' + (msg.error || '未知错误'), 'error');
      return;
    }
    try {
      this.oldLines = splitLines(oldText);
      this.newLines = splitLines(newText);
      const { rows, stats } = buildRows(msg.ops, this.oldLines, this.newLines);
      this.ops = msg.ops;
      this.baseRows = rows;
      this.lastKey = key;
      // fold overrides are keyed by line boundaries; stale ids are simply ignored
      this.rebuildView(false);

      const m = msg.meta || {};
      const algo = m.fallback ? `Myers 回退 → Patience（${m.reason || '自动'}）` : 'Myers 最短编辑脚本';
      this.el.stats.textContent =
        `+${stats.additions}  -${stats.deletions}  ·  原 ${m.oldCount || this.oldLines.length} 行 / 新 ${m.newCount || this.newLines.length} 行`;
      this.el.status.textContent =
        `${algo}${m.cached ? ' · 缓存' : ''} · 耗时 ${m.elapsedMs != null ? m.elapsedMs + ' ms' : '—'}`;

      if (!m.cached) {
        this.storage.putCachedDiff(key, {
          ops: msg.ops,
          meta: { method: m.method, fallback: m.fallback, reason: m.reason,
                  oldCount: this.oldLines.length, newCount: this.newLines.length,
                  elapsedMs: m.elapsedMs, fullHash: m.fullHash },
        });
      }
    } catch (e) {
      this.toast('渲染结果时出错: ' + (e.message || e), 'error');
    }
  }

  setProgress(p) {
    const pct = Math.round(p * 100);
    this.el.progress.style.width = pct + '%';
    this.el.progress.parentElement.classList.toggle('visible', p > 0 && p < 1);
  }

  toast(message, level = 'info') {
    const item = document.createElement('div');
    item.className = 'toast-item ' + level;
    item.textContent = message;
    this.el.toast.appendChild(item);
    setTimeout(() => {
      item.classList.add('fade');
      setTimeout(() => item.remove(), 400);
    }, level === 'error' ? 8000 : 4000);
  }
}

// Fallback when module workers are unavailable (e.g. file:// in some browsers).
function makeInlineWorkerFallback() {
  const listeners = { message: null };
  return {
    postMessage: async (msg) => {
      try {
        const { myersDiff, splitLines } = await import('./diff.js');
        const oldLines = splitLines(msg.oldText);
        const newLines = splitLines(msg.newText);
        const result = myersDiff(oldLines, newLines);
        listeners.message({ data: {
          type: 'diff-result', id: msg.id, ok: true, ops: result.ops,
          meta: { method: result.method, fallback: result.fallback, reason: result.reason,
                  oldCount: oldLines.length, newCount: newLines.length, elapsedMs: 0, fullHash: 'inline' },
        } });
      } catch (e) {
        listeners.message({ data: { type: 'diff-result', id: msg.id, ok: false, error: String(e.message || e) } });
      }
    },
    set onmessage(fn) { listeners.message = fn; },
    get onerror() { return null; },
    set onerror(fn) { window.addEventListener('error', fn); },
    terminate() {},
  };
}

const app = new DiffApp();
app.init();
