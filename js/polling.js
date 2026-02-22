// Life OS — Polling Engine
// Calls a refresh function every N milliseconds.
// Automatically pauses when the tab is hidden (Page Visibility API).

let _timer = null;
let _fn = null;
let _interval = 10000;

/** Start polling. refreshFn is called immediately, then every intervalMs. */
export function startPolling(refreshFn, intervalMs = 10000) {
  _fn = refreshFn;
  _interval = intervalMs;
  _run();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _stop();
    } else {
      _fn && _fn(); // refresh immediately on tab resume
      _run();
    }
  });
}

function _run() {
  _stop();
  if (_fn) {
    _timer = setInterval(_fn, _interval);
  }
}

function _stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

export function stopPolling() {
  _stop();
}
