// Life OS — Shared Utilities

/** Format a date string (YYYY-MM-DD or Date object) → "Feb 22" */
export function fmtDate(d) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a date → "Feb 22, 2026" */
export function fmtDateFull(d) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format a date → "Monday, February 22" */
export function fmtDateLong(d) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Today as YYYY-MM-DD string */
export function today() {
  return new Date().toISOString().split('T')[0];
}

/** Format gold amount with color class */
export function goldClass(amount) {
  return amount >= 0 ? 'gold-pos' : 'gold-neg';
}

/** Format gold amount with sign */
export function goldStr(amount) {
  return (amount >= 0 ? '+' : '') + amount;
}

/** Build a badge element string */
export function badge(text, color = 'gray') {
  return `<span class="badge badge-${color}">${text}</span>`;
}

/** Map gold transaction category to badge color */
export function goldCatBadge(cat) {
  const map = { Work: 'blue', Behavior: 'red', Participation: 'gold', Other: 'gray' };
  return badge(cat || 'Other', map[cat] || 'gray');
}

/** Map student note category to dot class */
export function catDot(cat) {
  const map = {
    Academic: 'dot-academic', Behavior: 'dot-behavior', Social: 'dot-social',
    Administrative: 'dot-admin', Gold: 'dot-behavior', Pattern: 'dot-pattern',
    Parent: 'dot-parent', Health: 'dot-health', General: 'dot-general'
  };
  return `<span class="dot ${map[cat] || 'dot-general'}"></span>`;
}

/** Map note category to badge color */
export function catBadge(cat) {
  const map = {
    Academic: 'blue', Behavior: 'red', Social: 'purple',
    Administrative: 'gray', Gold: 'gold', Pattern: 'gold',
    Parent: 'green', Health: 'red', General: 'gray'
  };
  return badge(cat, map[cat] || 'gray');
}

/** Map attendance status to badge color */
export function attendanceBadge(status) {
  const map = { Present: 'green', Absent: 'red', Late: 'gold', Excused: 'gray' };
  return badge(status || '—', map[status] || 'gray');
}

/** Truncate text to maxLen chars */
export function trunc(str, maxLen = 80) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/** Get URL query param */
export function qp(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Format currency */
export function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Show a quick toast notification */
export function toast(msg, type = 'success') {
  const colors = { success: '#1A5E3A', error: '#DC2626', info: '#2563EB' };
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
    background: colors[type] || colors.info, color: '#fff', padding: '10px 20px',
    borderRadius: '8px', fontSize: '14px', fontWeight: '600', zIndex: 9999,
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)', transition: 'opacity 0.3s'
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}

/** Show spinner in a container */
export function showSpinner(container) {
  container.innerHTML = '<div class="spinner"></div>';
}

/** Show empty state */
export function showEmpty(container, icon, msg) {
  container.innerHTML = `<div class="empty"><div class="empty-icon">${icon}</div>${msg}</div>`;
}

/** Format time (HH:MM:SS → H:MM AM/PM) */
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Week day short names */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
