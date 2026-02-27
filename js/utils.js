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

/** Format a date as "X days ago" / "Today" / "Yesterday" (for "last logged" labels) */
export function daysAgo(d) {
  if (!d) return '—';
  const targetDateStr = typeof d === 'string' ? d.slice(0, 10) : d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const todayStr = today();
  if (targetDateStr === todayStr) return 'Today';
  // Compute diff using date strings (YYYY-MM-DD comparison is safe)
  const [ty, tm, td2] = todayStr.split('-').map(Number);
  const [oy, om, od] = targetDateStr.split('-').map(Number);
  const todayMs = Date.UTC(ty, tm - 1, td2);
  const otherMs = Date.UTC(oy, om - 1, od);
  const diffDays = Math.round((todayMs - otherMs) / 86400000);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 0) return 'Future';
  return `${diffDays}d ago`;
}

// ── TIMEZONE: ALL date logic uses America/Los_Angeles (PST/PDT) ──────────────

/** Today as YYYY-MM-DD string, pinned to PST/PDT (America/Los_Angeles). */
export function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** Alias — same as today(), explicit PST name kept for clarity in SRS code. */
export function todayPST() {
  return today();
}

/**
 * Return a YYYY-MM-DD date that is `days` days offset from today in PST.
 * Pass 0 to get today, negative for past dates, positive for future.
 * Example: pstDatePlusDays(-7) = 7 days ago in PST
 */
export function pstDatePlusDays(days) {
  const pstTodayStr = today(); // "YYYY-MM-DD" in PST
  const [y, m, d] = pstTodayStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d)); // midnight UTC for that PST date
  base.setUTCDate(base.getUTCDate() + days);
  // Return the date in PST, not UTC, to avoid boundary issues
  return base.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/**
 * Given a UTC timestamp (ms), return the YYYY-MM-DD date in PST.
 * Use instead of new Date(ts).toISOString().split('T')[0] for date comparisons.
 */
export function pstDateFromMs(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/**
 * Current PST offset string for ntfy X-At scheduling.
 * Returns '-08:00' (PST) or '-07:00' (PDT) depending on DST.
 */
export function pstOffsetStr() {
  // Intl gives us the offset in minutes; PST = 480, PDT = 420
  const offsetMins = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' })
    .match(/GMT([+-]\d+)/)?.[1];
  if (offsetMins === '-7') return '-07:00';
  return '-08:00'; // default PST
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
