// Life OS — Global Error Reporter
// Auto-captures JS errors, unhandled promise rejections, console.error calls,
// and failed resource loads on every page → writes to console_errors Supabase table.
// Import this module on every HTML page alongside topbar.js.

import { supabase } from './supabase.js';

const PAGE = window.location.pathname.split('/').pop() || 'index.html';
const RECENT_MS = 10_000; // dedupe window: ignore same message within 10s
const recentErrors = new Map(); // message → timestamp

async function reportError(message, stack, errorType) {
  if (!message) return;

  // Never report errors from console_errors itself (supabase.js handles that guard too)
  if (String(message).includes("console_errors")) return;

  // Deduplicate: skip if same message reported within last 10 seconds
  const now = Date.now();
  if (recentErrors.has(message) && now - recentErrors.get(message) < RECENT_MS) return;
  recentErrors.set(message, now);

  // Trim stacks to 2000 chars to avoid hitting column limits
  const trimmedStack = stack ? String(stack).slice(0, 2000) : null;

  try {
    await supabase.from('console_errors').insert({
      page: PAGE,
      message: String(message).slice(0, 500),
      stack: trimmedStack,
      error_type: errorType,
      status: 'open',
    });
  } catch (e) {
    // Silently fail — never let the reporter itself cause errors
  }
}

// ── Intercept uncaught JS errors ──────────────────────────────────────────────
const _origOnError = window.onerror;
window.onerror = (message, source, lineno, colno, error) => {
  const stack = error?.stack || `${source}:${lineno}:${colno}`;
  reportError(message, stack, 'uncaught_error');
  return _origOnError ? _origOnError(message, source, lineno, colno, error) : false;
};

// ── Intercept unhandled promise rejections ────────────────────────────────────
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : null;
  reportError(message, stack, 'unhandled_rejection');
});

// ── Intercept console.error calls ─────────────────────────────────────────────
const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
  _origConsoleError(...args);
  const message = args.map(a => {
    if (a instanceof Error) return a.message;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  }).join(' ');
  const stack = args.find(a => a instanceof Error)?.stack || null;
  reportError(message, stack, 'console_error');
};

// ── Intercept failed resource loads (scripts, stylesheets) ───────────────────
// Uses capture phase so it fires before the element's own handler.
// Ignores favicons (noisy, harmless) and image 404s (too common to be actionable).
window.addEventListener('error', (event) => {
  const el = event.target;
  if (!el || el === window) return; // JS errors are handled by window.onerror above

  const tag = el.tagName?.toUpperCase();
  const src = el.src || el.href || '';

  // Only report scripts and stylesheets — not images/favicons
  if (tag !== 'SCRIPT' && tag !== 'LINK') return;

  const message = `Failed to load ${tag.toLowerCase()}: ${src}`;
  reportError(message, null, 'resource_load_error');
}, true); // <-- true = capture phase, required for resource errors
