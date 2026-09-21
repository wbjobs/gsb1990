// diff-worker.js - runs heavy diff computation off the main thread.
import { splitLines, myersDiff } from './diff.js';

const PROGRESS_EVERY_MS = 60;

function hashText(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== 'diff-request') return;
  const { id, oldText, newText } = msg;
  const started = Date.now();
  let lastPost = 0;
  try {
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);

    const result = myersDiff(oldLines, newLines, undefined, (d, total) => {
      const now = Date.now();
      if (now - lastPost > PROGRESS_EVERY_MS) {
        lastPost = now;
        self.postMessage({ type: 'diff-progress', id, done: d, total, phase: 'myers' });
      }
    });

    self.postMessage({
      type: 'diff-result',
      id,
      ok: true,
      ops: result.ops,
      meta: {
        method: result.method,
        fallback: result.fallback,
        reason: result.reason || null,
        oldCount: oldLines.length,
        newCount: newLines.length,
        elapsedMs: Date.now() - started,
        fullHash: hashText(oldText) + ':' + hashText(newText),
      },
    });
  } catch (err) {
    self.postMessage({
      type: 'diff-result',
      id,
      ok: false,
      error: String((err && err.message) || err),
      elapsedMs: Date.now() - started,
    });
  }
};
