// minimap.js - canvas change overview with click/drag-to-jump.

export class Minimap {
  constructor(canvas, onJump) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onJump = onJump;
    this.rows = [];
    this.rowPx = 20;
    this.viewportH = 0;
    this.dragging = false;
    this._bind();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.rows.length && this.render(this._lastScroll || 0)).observe(canvas);
    }
  }

  setData(rows, rowPx, viewportH) {
    this.rows = rows;
    this.rowPx = rowPx;
    this.viewportH = viewportH;
    this.render(0);
  }

  _bind() {
    const jumpToY = (clientY) => {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = (clientY - rect.top) / rect.height;
      const totalH = this.rows.length * this.rowPx;
      this.onJump(Math.max(0, ratio * totalH - this.viewportH / 2));
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      jumpToY(e.clientY);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) jumpToY(e.clientY);
    });
    const stop = () => { this.dragging = false; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
  }

  render(scrollTop) {
    this._lastScroll = scrollTop;
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (!cssW || !cssH) return;
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const totalH = Math.max(1, this.rows.length * this.rowPx);
    const scale = cssH / totalH;

    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      let color = null;
      if (row.kind === 'insert') color = 'rgba(63, 185, 80, 0.75)';
      else if (row.kind === 'delete') color = 'rgba(248, 81, 73, 0.75)';
      else if (row.kind === 'pair') color = 'rgba(210, 153, 34, 0.85)';
      else if (row.kind === 'fold') color = 'rgba(139, 147, 157, 0.85)';
      else continue;
      ctx.fillStyle = color;
      const y = i * this.rowPx * scale;
      ctx.fillRect(2, y, cssW - 4, Math.max(1.2, this.rowPx * scale));
    }

    // viewport indicator
    const vy = scrollTop * scale;
    const vh = Math.max(12, this.viewportH * scale);
    ctx.fillStyle = 'rgba(177, 186, 196, 0.18)';
    ctx.fillRect(0, vy, cssW, vh);
    ctx.strokeStyle = 'rgba(177, 186, 196, 0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, vy + 0.5, cssW - 1, vh - 1);
  }
}
