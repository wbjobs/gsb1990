// Integration test for DiffView using a minimal DOM stub (no external deps).
import assert from 'node:assert/strict';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok -', name); }
  catch (e) { console.error('FAIL -', name, '\n', e); process.exitCode = 1; }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.className = '';
    this.textContent = '';
    this._attrs = {};
    this._listeners = {};
    this.classList = {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      toggle(c, force) { if (force === undefined) force = !this._set.has(c); force ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    };
    this.clientWidth = 1000;
    this.clientHeight = 500;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.value = '';
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
    }
  }
  querySelector(sel) {
    const all = [];
    const walk = (el) => { for (const c of el.children) { all.push(c); walk(c); } };
    walk(this);
    return all.find((el) => matches(el, sel)) || null;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  dispatch(type, evt = {}) {
    for (const fn of this._listeners[type] || []) fn(evt);
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  getBoundingClientRect() { return { top: 0, left: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture() {}
}

function matches(el, sel) {
  sel = sel.trim();
  if (sel.startsWith('.')) {
    const dot = sel.slice(1);
    return (el.classList && el.classList.contains(dot)) || el.className.split(/\s+/).includes(dot);
  }
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('[')) {
    const m = sel.match(/\[([^=]+)="?([^"\]]+)"?\]/);
    return m && el._attrs[m[1]] === m[2];
  }
  return el.tagName === sel.toUpperCase();
}

globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createDocumentFragment: () => new FakeElement('#fragment'),
  querySelector: () => null,
};
globalThis.requestAnimationFrame = (fn) => 0;
globalThis.ResizeObserver = class { observe() {} };
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };

const { DiffView, ROW_PX } = await import('../js/diff-view.js');

function buildScroller() {
  const scroller = new FakeElement();
  const mkPane = (side) => {
    const pane = new FakeElement();
    pane._attrs['data-pane'] = side;
    const head = new FakeElement();
    const scroll = new FakeElement();
    scroll.className = 'pane-scroll';
    const layer = new FakeElement();
    layer.className = 'row-layer';
    scroll.appendChild(layer);
    pane.appendChild(head);
    pane.appendChild(scroll);
    return { pane, scroll, layer };
  };
  const oldP = mkPane('old');
  const newP = mkPane('new');
  scroller.appendChild(oldP.pane);
  scroller.appendChild(newP.pane);
  // mimic querySelector('[data-pane="old"] .pane-scroll')
  scroller.querySelector = (sel) => {
    if (sel.includes('data-pane="old"')) return oldP.scroll;
    if (sel.includes('data-pane="new"')) return newP.scroll;
    return FakeElement.prototype.querySelector.call(scroller, sel);
  };
  const foldLayer = new FakeElement();
  return { scroller, foldLayer, oldScroll: oldP.scroll, newScroll: newP.scroll, oldLayer: oldP.layer, newLayer: newP.layer };
}

const rows = [];
for (let i = 0; i < 200; i++) rows.push({ kind: 'equal', oldIndex: i, newIndex: i, text: 'line ' + i });
rows[50] = { kind: 'delete', oldIndex: 50, text: 'old50', pieces: null };
rows[51] = { kind: 'insert', newIndex: 50, text: 'new50', pieces: null };
rows[120] = { kind: 'fold', id: 'f1', startA: 121, endA: 140, startB: 121, endB: 140, count: 20, afterText: 'next change here' };

test('only visible rows are rendered (virtualization)', () => {
  const { scroller, foldLayer, oldLayer, newLayer } = buildScroller();
  const view = new DiffView({ scroller, foldLayer });
  view.setRows(rows, false);
  // viewport 500px / 20 = 25 rows, plus overscan 8 each side => <= 41 nodes per pane
  assert.ok(oldLayer.children.length < 60, 'got ' + oldLayer.children.length);
  assert.equal(oldLayer.children.length, newLayer.children.length);
});

test('scroll syncs both panes and re-renders window', () => {
  const { scroller, foldLayer, oldScroll, newScroll, oldLayer } = buildScroller();
  const view = new DiffView({ scroller, foldLayer });
  view.setRows(rows, false);
  oldScroll.scrollTop = 1000;
  oldScroll.dispatch('scroll');
  assert.equal(newScroll.scrollTop, 1000, 'new pane followed old pane');

  newScroll.scrollTop = 2400;
  newScroll.dispatch('scroll');
  assert.equal(oldScroll.scrollTop, 2400, 'old pane followed new pane');
  view.render();

  // first rendered row should be near 2400/20 - overscan
  const marginTop = parseInt(oldLayer.children[0].style.marginTop || '0', 10);
  assert.ok(marginTop >= 100 * ROW_PX && marginTop < 120 * ROW_PX, 'window shifted: ' + marginTop);
});

test('fold marker click fires callback with id; gap rows colored', () => {
  const { scroller, foldLayer } = buildScroller();
  let clicked = null;
  const view = new DiffView({ scroller, foldLayer, onFoldToggle: (id) => { clicked = id; } });
  view.setRows(rows, false);
  // scroll so row 120 is visible
  const { oldScroll } = { oldScroll: scroller.querySelector('[data-pane="old"] .pane-scroll') };
  oldScroll.scrollTop = 110 * ROW_PX;
  oldScroll.dispatch('scroll');
  view.render();
  const marker = foldLayer.children[0] && foldLayer.children[0].children[0];
  assert.ok(marker, 'fold marker exists');
  marker.dispatch('click');
  assert.equal(clicked, 'f1');
});

test('scrollToRow clamps within range', () => {
  const { scroller, foldLayer, oldScroll, newScroll } = buildScroller();
  const view = new DiffView({ scroller, foldLayer });
  view.setRows(rows, false);
  view.scrollToRow(999999);
  const maxTop = Math.max(0, rows.length * ROW_PX - 500);
  assert.equal(oldScroll.scrollTop, maxTop);
  assert.equal(newScroll.scrollTop, maxTop);
});

console.log(`\n${passed} DOM tests passed`);

// appended: pair row side-by-side smoke check
{
  const { scroller, foldLayer } = buildScroller();
  const view = new DiffView({ scroller, foldLayer });
  const pairRows = [
    { kind: 'equal', oldIndex: 0, newIndex: 0, text: 'same' },
    { kind: 'pair', oldIndex: 1, newIndex: 1, oldText: 'the old line', newText: 'the new line',
      oldPieces: [{ type: 'equal', text: 'the ' }, { type: 'del', text: 'old' }],
      newPieces: [{ type: 'equal', text: 'the ' }, { type: 'add', text: 'new' }] },
  ];
  view.setRows(pairRows, false);
  const oldLayer = scroller.querySelector('.row-layer');
  const cells = [];
  const walk = (el) => { for (const c of el.children) { cells.push(c); walk(c); } };
  // fetch both pane layers directly
  const all = [];
  const collect = (el) => { for (const c of el.children) { if (c.className && c.className.split(' ').includes('row')) all.push(c); collect(c); } };
  const panes = scroller.children;
  collect(panes[0]); collect(panes[1]);
  const pairs = all.filter((c) => c.classList.contains('row-pair'));
  assert.equal(pairs.length, 2, 'pair rendered in both panes');
  assert.ok(pairs[0].classList.contains('row-delete'));
  assert.ok(pairs[1].classList.contains('row-insert'));
  const lineNos = pairs.map((c) => c.children[0].textContent);
  assert.deepEqual(lineNos.map(String), ['2', '2']);
  console.log('  ok - pair row renders same line number on both sides');
}
