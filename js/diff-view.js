// diff-view.js - virtualized, synchronized two-pane diff renderer.

export const ROW_PX = 20;
const OVERSCAN = 8;

export class DiffView {
  constructor({ scroller, foldLayer, minimap, onFoldToggle }) {
    this.scroller = scroller;
    this.foldLayer = foldLayer || null;
    this.minimap = minimap || null;
    this.onFoldToggle = onFoldToggle || (() => {});
    this.rows = [];
    this.rowNodes = new Map();
    this.foldNodes = new Map();
    this.suppress = false;
    this.oldScroll = scroller.querySelector('[data-pane="old"] .pane-scroll');
    this.newScroll = scroller.querySelector('[data-pane="new"] .pane-scroll');
    this.oldPad = this.oldScroll.querySelector('.row-layer');
    this.newPad = this.newScroll.querySelector('.row-layer');
    this._pending = false;
    if (this.foldLayer) {
      this.foldLayer.style.pointerEvents = 'none';
      this.foldInner = document.createElement('div');
      this.foldInner.className = 'fold-inner';
      this.foldInner.style.position = 'absolute';
      this.foldInner.style.left = '0';
      this.foldInner.style.right = '0';
      this.foldInner.style.top = '0';
      this.foldLayer.appendChild(this.foldInner);
    }
    this._bindScroll();
    new ResizeObserver(() => this.render()).observe(scroller);
  }

  setRows(rows, keepAnchor) {
    const anchor = keepAnchor ? this._captureAnchor() : null;
    this.rows = rows;
    this.rowNodes.forEach((nodes) => { nodes.oldCell.remove(); nodes.newCell.remove(); });
    this.rowNodes.clear();
    this.foldNodes.forEach((n) => n.remove());
    this.foldNodes.clear();
    const total = rows.length * ROW_PX;
    this.oldPad.style.height = total + 'px';
    this.newPad.style.height = total + 'px';
    if (this.foldInner) this.foldInner.style.height = total + 'px';
    if (anchor) this._restoreAnchor(anchor, rows);
    this.render();
  }

  _captureAnchor() {
    const st = this.oldScroll.scrollTop;
    const idx = Math.floor(st / ROW_PX);
    return { key: rowAnchorKey(this.rows[idx]), offset: st - idx * ROW_PX };
  }

  _restoreAnchor(anchor, rows) {
    let idx = rows.findIndex((r) => rowAnchorKey(r) === anchor.key);
    if (idx < 0) idx = 0;
    const maxTop = Math.max(0, this.rows.length * ROW_PX - this.oldScroll.clientHeight);
    const top = Math.min(maxTop, idx * ROW_PX + anchor.offset);
    this.suppress = true;
    this.oldScroll.scrollTop = top;
    this.newScroll.scrollTop = top;
    this.suppress = false;
  }

  _bindScroll() {
    const link = (source, target, side) => {
      source.addEventListener('scroll', () => {
        if (this.suppress) return;
        this.suppress = true;
        target.scrollTop = source.scrollTop;
        this.suppress = false;
        this._scheduleRender();
        if (this.minimap) this.minimap.render(source.scrollTop);
      }, { passive: true });
    };
    link(this.oldScroll, this.newScroll, 'old');
    link(this.newScroll, this.oldScroll, 'new');
  }

  _scheduleRender() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => {
      this._pending = false;
      this.render();
    });
  }

  scrollToFraction(frac) {
    const top = frac * this.rows.length * ROW_PX;
    this._setScrollTop(top);
  }

  scrollToRow(index) {
    this._setScrollTop(index * ROW_PX);
  }

  _setScrollTop(top) {
    const maxTop = Math.max(0, this.rows.length * ROW_PX - this.oldScroll.clientHeight);
    const clamped = Math.max(0, Math.min(maxTop, top));
    this.suppress = true;
    this.oldScroll.scrollTop = clamped;
    this.newScroll.scrollTop = clamped;
    this.suppress = false;
    this.render();
  }

  render() {
    const viewH = this.oldScroll.clientHeight;
    const scrollTop = this.oldScroll.scrollTop;
    if (this.foldInner) this.foldInner.style.transform = `translateY(${-scrollTop}px)`;
    const start = Math.max(0, Math.floor(scrollTop / ROW_PX) - OVERSCAN);
    const end = Math.min(this.rows.length, Math.ceil((scrollTop + viewH) / ROW_PX) + OVERSCAN);

    const live = new Set();
    let firstPlaced = false;
    for (let i = start; i < end; i++) {
      live.add(i);
      let nodes = this.rowNodes.get(i);
      if (!nodes) {
        nodes = {
          oldCell: this._cellFor(this.rows[i], 'old'),
          newCell: this._cellFor(this.rows[i], 'new'),
        };
        this.oldPad.appendChild(nodes.oldCell);
        this.newPad.appendChild(nodes.newCell);
        this.rowNodes.set(i, nodes);
      }
      // In-flow virtual list: only the first rendered row carries an offset.
      const top = firstPlaced ? '' : `${(i - 0) * ROW_PX}px`;
      if (!firstPlaced) {
        nodes.oldCell.style.marginTop = top;
        nodes.newCell.style.marginTop = top;
        firstPlaced = true;
      } else {
        nodes.oldCell.style.marginTop = '';
        nodes.newCell.style.marginTop = '';
      }
      // ascending visit order + append => DOM order already matches row order

      if (this.foldLayer) {
        let marker = this.foldNodes.get(i);
        if (this.rows[i].kind === 'fold') {
          if (!marker) {
            marker = this._createFoldMarker(this.rows[i]);
            this.foldInner.appendChild(marker);
            this.foldNodes.set(i, marker);
          }
          marker.style.transform = `translateY(${i * ROW_PX}px)`;
        } else if (marker) {
          marker.remove();
          this.foldNodes.delete(i);
        }
      }
    }

    for (const [i, nodes] of this.rowNodes) {
      if (!live.has(i)) {
        nodes.oldCell.remove();
        nodes.newCell.remove();
        this.rowNodes.delete(i);
      }
    }
    for (const [i, node] of this.foldNodes) {
      if (!live.has(i)) { node.remove(); this.foldNodes.delete(i); }
    }
    if (this.minimap) this.minimap.render(scrollTop);
  }

  _createFoldMarker(row) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'fold-marker';
    marker.style.height = ROW_PX + 'px';
    const glyph = document.createElement('span');
    glyph.className = 'fold-glyph';
    glyph.textContent = '▸';
    const label = document.createElement('span');
    label.className = 'fold-label';
    label.textContent = `展开 ${row.count} 个未更改行（原 ${row.startA}–${row.endA} / 新 ${row.startB}–${row.endB}）`;
    const preview = document.createElement('span');
    preview.className = 'fold-preview';
    preview.textContent = row.afterText ? '下一处: ' + truncate(row.afterText, 48) : '';
    marker.appendChild(glyph);
    marker.appendChild(label);
    marker.appendChild(preview);
    marker.addEventListener('click', () => this.onFoldToggle(row.id));
    return marker;
  }

  _cellFor(row, side) {
    const cell = document.createElement('div');
    cell.className = 'row';
    cell.style.height = ROW_PX + 'px';
    const gutter = document.createElement('div');
    gutter.className = 'gutter';
    const code = document.createElement('div');
    code.className = 'code';

    if (row.kind === 'fold') {
      cell.classList.add('fold-row');
      cell.appendChild(gutter);
      cell.appendChild(code);
      return cell;
    }

    if (row.kind === 'pair') return this._pairCell(row, side, cell, gutter, code);

    const belongs = row.kind === 'equal' ||
      (side === 'old' && row.kind === 'delete') ||
      (side === 'new' && row.kind === 'insert');

    if (!belongs) {
      cell.classList.add(side === 'old' ? 'gap-ins' : 'gap-del', 'row-' + row.kind);
      cell.appendChild(gutter);
      cell.appendChild(code);
      return cell;
    }

    cell.classList.add('row-' + row.kind);
    gutter.textContent = side === 'old' ? row.oldIndex + 1 : row.newIndex + 1;
    renderPieces(code, row.text, row.pieces, row.kind === 'delete' ? 'del' : 'add');

    cell.appendChild(gutter);
    cell.appendChild(code);
    return cell;
  }

  _pairCell(row, side, cell, gutter, code) {
    cell.classList.add('row-pair', side === 'old' ? 'row-delete' : 'row-insert');
    if (side === 'old') {
      gutter.textContent = row.oldIndex + 1;
      renderPieces(code, row.oldText, row.oldPieces, 'del');
    } else {
      gutter.textContent = row.newIndex + 1;
      renderPieces(code, row.newText, row.newPieces, 'add');
    }
    cell.appendChild(gutter);
    cell.appendChild(code);
    return cell;
  }
}

function renderPieces(code, text, pieces, want) {
  if (pieces) {
    for (const piece of pieces) {
      if (piece.type !== 'equal' && piece.type !== want) continue;
      const span = document.createElement('span');
      span.className = 'hl-' + piece.type;
      span.textContent = piece.text;
      code.appendChild(span);
    }
  } else {
    code.textContent = text;
  }
}

function truncate(str, n) {
  const trimmed = str.trim();
    return trimmed.length > n ? trimmed.slice(0, n) + '…' : trimmed;
}

function rowAnchorKey(row) {
  if (!row) return null;
  if (row.kind === 'fold') return 'fold:' + row.id;
  if (row.kind === 'equal') return `e:${row.oldIndex}:${row.newIndex}`;
  if (row.kind === 'pair') return `p:${row.oldIndex}:${row.newIndex}`;
  if (row.kind === 'delete') return `d:${row.oldIndex}`;
  return `i:${row.newIndex}`;
}
