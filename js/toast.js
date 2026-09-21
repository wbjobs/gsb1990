/* toast.js — 异常/提示通知。 */
const container = () => document.getElementById('toasts');

export function showToast(message, type = 'info', duration = 4000) {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  const close = document.createElement('button');
  close.className = 'toast-close';
  close.textContent = '×';
  close.onclick = () => el.remove();
  el.appendChild(close);
  container().appendChild(el);
  if (duration > 0) setTimeout(() => el.remove(), duration);
}
