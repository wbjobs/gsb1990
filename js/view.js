/*
 * view.js — 虚拟滚动渲染（固定行高，DOM 窗口化）+ 双栏同步滚动 + Canvas 缩略图。
 * 两个 pane 共享同一份 visibleItems，行高一致，因此 scrollTop 可 1:1 同步。
 */
export const ROW_H = 20;
const OVERSCAN = 10;

const TYPE_CLASS = ['t-equal', 't-del', 't-ins', 't-replace'];

export class DiffPane {
  /**
   * @param container .pane 元素
   * @param side 'left' | 'right'
   * @param onFoldClick (regionId) => void
   */
  constructor(container, side, onFoldClick) {
    this.side = side;
    this.onFoldClick = onFoldClick;
    this.items = [];
    this.lines = [];
    this.scroller = container.querySelector('.scroll');
    this.spacer = container.querySelector('.spacer');
    this.window = container.querySelector('.window');
    this._renderScheduled = false;
    this.scroller.addEventListener('scroll', () => this.scheduleRender(), { passive: true });
  }

  setData(items, lines) {
    this.items = items;
    this.lines = lines;
    this.spacer.style.height = items.length * ROW_H + 'px';
    this.scheduleRender();
  }

  scheduleRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.render();
    });
  }

  render() {
    const scrollTop = this.scroller.scrollTop;
    const height = this.scroller.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const end = Math.min(this.items.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
    this.window.style.transform = 'translateY(' + start * ROW_H + 'px)';
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      frag.appendChild(this.renderItem(this.items[i]));
    }
    this.window.replaceChildren(frag);
  }

  renderItem(item) {
    if (item.kind === 'fold') {
      const el = document.createElement('div');
      el.className = 'row t-fold';
      const btn = document.createElement('button');
      btn.className = 'fold-btn';
      btn.textContent = '⋯ 展开 ' + item.count + ' 行相同内容 ⋯';
      btn.addEventListener('click', () => this.onFoldClick(item.regionId));
      el.appendChild(btn);
      return el;
    }
    const row = item.row;
    const el = document.createElement('div');
    el.className = 'row ' + TYPE_CLASS[row.t];
    const isLeft = this.side === 'left';
    const lineNo = isLeft ? row.l : row.r;
    const gutter = document.createElement('span');
    gutter.className = 'gutter';
    gutter.textContent = lineNo >= 0 ? String(lineNo + 1) : '';
    el.appendChild(gutter);
    const code = document.createElement('span');
    code.className = 'code';
    if (lineNo < 0) {
      el.classList.add('t-blank');
    } else {
      const text = this.lines[lineNo];
      const segs = row.h ? (isLeft ? row.h.l : row.h.r) : null;
      appendHighlighted(code, text, segs);
    }
    el.appendChild(code);
    return el;
  }
}

function appendHighlighted(codeEl, text, segs) {
  if (!segs || segs.length === 0) {
    codeEl.textContent = text;
    return;
  }
  // segs 基于码点下标（与 diff-core 的 Array.from 一致）
  const chars = Array.from(text);
  let pos = 0;
  for (const [s, e] of segs) {
    if (s > pos) codeEl.appendChild(document.createTextNode(chars.slice(pos, s).join('')));
    const em = document.createElement('em');
    em.className = 'hl';
    em.textContent = chars.slice(s, e).join('');
    codeEl.appendChild(em);
    pos = e;
  }
  if (pos < chars.length) codeEl.appendChild(document.createTextNode(chars.slice(pos).join('')));
}

/** 双向同步滚动：两个 scroller 的 scrollTop/scrollLeft 保持一致，防回环。 */
export function linkScroll(a, b, onScroll) {
  let syncing = false;
  const sync = (src, dst) => {
    if (syncing) return;
    syncing = true;
    if (dst.scrollTop !== src.scrollTop) dst.scrollTop = src.scrollTop;
    if (dst.scrollLeft !== src.scrollLeft) dst.scrollLeft = src.scrollLeft;
    syncing = false;
    if (onScroll) onScroll();
  };
  a.addEventListener('scroll', () => sync(a, b), { passive: true });
  b.addEventListener('scroll', () => sync(b, a), { passive: true });
}

/** Canvas 缩略图：按全量行绘制变更分布，点击跳转，并显示视口位置。 */
export class Minimap {
  constructor(canvas, onJump) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rows = [];
    this.viewportRatio = 0;
    this.scrollRatio = 0;
    canvas.addEventListener('click', (e) => {
      if (this.rows.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      onJump(Math.floor(ratio * this.rows.length));
    });
  }

  setRows(rows) {
    this.rows = rows;
    this.draw();
  }

  setViewport(scrollRatio, viewportRatio) {
    this.scrollRatio = scrollRatio;
    this.viewportRatio = viewportRatio;
    this.draw();
  }

  draw() {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = this.rows.length;
    if (n === 0) return;
    const rowH = Math.max(h / n, 1);
    for (let i = 0; i < n; i++) {
      const t = this.rows[i].t;
      if (t === 0) continue;
      ctx.fillStyle = t === 1 ? '#e5534b' : t === 2 ? '#57ab5a' : '#c69026';
      ctx.fillRect(0, (i / n) * h, w, Math.ceil(rowH));
    }
    // 视口指示
    ctx.fillStyle = 'rgba(128,128,128,0.25)';
    ctx.fillRect(0, this.scrollRatio * h, w, Math.max(this.viewportRatio * h, 8));
  }
}
