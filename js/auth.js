// Life OS — Auth Module (v1)
// Simple PIN-based authentication using SHA-256 hash
// PIN hash stored in code; session stored in sessionStorage (clears on tab close)

const SESSION_KEY = 'lifeos_auth_v1';
const SESSION_MAX_MS = 12 * 60 * 60 * 1000; // 12 hours

// SHA-256 of Luke's PIN — regenerate this with: await sha256('yourPIN')
// Default PIN: 2025 → change after first login via the settings
// Hash of '2025' (placeholder — Luke should change via login page first visit)
const PIN_HASH = 'b2b2f104d32c638903e151a9b20d6e27b41d8c0c84cf8458738f83ca2f1dd744';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isLoggedIn() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const { ts } = JSON.parse(raw);
    if (Date.now() - ts > SESSION_MAX_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function tryLogin(pin) {
  const hash = await sha256(String(pin).trim());
  if (hash === PIN_HASH) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
    return true;
  }
  return false;
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}

// Call this at the top of any protected page
// If not logged in, redirects to login.html with returnUrl param
export function requireAuth() {
  if (!isLoggedIn()) {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.replace(`login.html?return=${returnUrl}`);
  }
}
