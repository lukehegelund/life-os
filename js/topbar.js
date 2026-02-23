// Life OS — Global Topbar (quick-add + feedback buttons)
// Import this module on every page. It auto-injects buttons into .header-row
// and mounts the modal overlays.

import { supabase } from './supabase.js';
import { today, toast } from './utils.js';

// ── Inject buttons into header ────────────────────────────────────────────────
function injectButtons() {
  // Support both standard .header-row pages and the calendar's .cal-toolbar
  const headerRow = document.querySelector('.header-row') || document.querySelector('.cal-toolbar');
  if (!headerRow) return;

  // Avoid double-injection
  if (document.getElementById('topbar-btns')) return;

  const wrap = document.createElement('div');
  wrap.id = 'topbar-btns';
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0';
  wrap.innerHTML = `
    <button id="topbar-quick-add" onclick="window.showQuickAdd()" title="Quick add task or reminder"
      style="width:34px;height:34px;border-radius:50%;background:var(--blue);color:white;border:none;
             font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
             box-shadow:var(--shadow);flex-shrink:0">+</button>
    <button id="topbar-tell-claude" onclick="window.showTellClaude()" title="Tell Claude to do something"
      style="width:34px;height:34px;border-radius:50%;background:#1e1e2e;color:white;border:none;
             font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
             box-shadow:var(--shadow);flex-shrink:0">🤖</button>
    <div id="topbar-bell-wrap" style="position:relative;flex-shrink:0">
      <button id="topbar-bell" onclick="window.toggleNotifications()" title="Notifications"
        style="width:34px;height:34px;border-radius:50%;background:var(--gray-100);color:var(--gray-700);border:1px solid var(--gray-200);
               font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
               box-shadow:var(--shadow)">🔔</button>
      <span id="topbar-bell-badge" style="display:none;position:absolute;top:-3px;right:-3px;
        background:#ef4444;color:white;border-radius:50%;width:16px;height:16px;font-size:10px;
        font-weight:700;align-items:center;justify-content:center;line-height:1"></span>
    </div>
    <button id="topbar-feedback" onclick="window.showFeedback()" title="Submit bug or feature request"
      style="width:34px;height:34px;border-radius:50%;background:var(--gray-100);color:var(--gray-600);border:1px solid var(--gray-200);
             font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
             box-shadow:var(--shadow);flex-shrink:0">🐛</button>
  `;

  // Insert before any existing right-side button (like "+ Task"), or just append
  const existingBtn = headerRow.querySelector('button, a.btn');
  if (existingBtn) {
    headerRow.insertBefore(wrap, existingBtn);
  } else {
    headerRow.appendChild(wrap);
  }

  // Load unread badge on init
  loadBellBadge();
}

// ── Bell badge ─────────────────────────────────────────────────────────────────
async function loadBellBadge() {
  const { data } = await supabase
    .from('claude_notifications')
    .select('id')
    .eq('read', false);
  const count = data?.length || 0;
  const badge = document.getElementById('topbar-bell-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Notification Panel ─────────────────────────────────────────────────────────
let notifPanelOpen = false;

window.toggleNotifications = async () => {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;

  notifPanelOpen = !notifPanelOpen;
  if (notifPanelOpen) {
    panel.style.display = 'block';
    await renderNotifications();
  } else {
    panel.style.display = 'none';
  }
};

async function renderNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:20px;font-size:13px">Loading…</div>';

  const { data, error } = await supabase
    .from('claude_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error || !data?.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:24px;font-size:13px">No notifications yet</div>';
    return;
  }

  list.innerHTML = data.map(n => {
    const ts = new Date(n.created_at);
    const timeStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                    ' · ' + ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const unreadDot = !n.read
      ? `<span style="width:8px;height:8px;border-radius:50%;background:#3b82f6;flex-shrink:0;margin-top:3px"></span>`
      : `<span style="width:8px;height:8px;flex-shrink:0"></span>`;
    return `
      <div data-notif-id="${n.id}" onclick="window.markNotifRead('${n.id}', this)"
        style="display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid var(--gray-100);
               cursor:pointer;background:${n.read ? 'transparent' : 'rgba(59,130,246,0.04)'};
               transition:background 0.15s"
        onmouseenter="this.style.background='var(--gray-50)'"
        onmouseleave="this.style.background='${n.read ? 'transparent' : 'rgba(59,130,246,0.04)'}'">
        ${unreadDot}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:${n.read ? '500' : '600'};color:var(--gray-800);margin-bottom:3px;line-height:1.3">${n.title}</div>
          ${n.body ? `<div style="font-size:12px;color:var(--gray-500);line-height:1.4;white-space:pre-wrap">${n.body}</div>` : ''}
          <div style="font-size:11px;color:var(--gray-400);margin-top:4px">${timeStr}</div>
        </div>
      </div>
    `;
  }).join('');

  // Mark all as read after viewing
  const unreadIds = data.filter(n => !n.read).map(n => n.id);
  if (unreadIds.length > 0) {
    setTimeout(async () => {
      await supabase.from('claude_notifications').update({ read: true }).in('id', unreadIds);
      loadBellBadge();
    }, 1500);
  }
}

window.markNotifRead = async (id, el) => {
  await supabase.from('claude_notifications').update({ read: true }).eq('id', id);
  if (el) {
    el.style.background = 'transparent';
    const dot = el.querySelector('span');
    if (dot) dot.style.background = 'transparent';
    const title = el.querySelector('div > div:first-child');
    if (title) title.style.fontWeight = '500';
  }
  loadBellBadge();
};

window.markAllNotifsRead = async () => {
  await supabase.from('claude_notifications').update({ read: true }).eq('read', false);
  await renderNotifications();
  loadBellBadge();
};

// ── Modal HTML ────────────────────────────────────────────────────────────────
function injectModals() {
  if (document.getElementById('topbar-modals')) return;

  const div = document.createElement('div');
  div.id = 'topbar-modals';
  div.innerHTML = `
    <!-- Quick Add Modal -->
    <div id="qa-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;align-items:flex-end;justify-content:center"
         onclick="if(event.target===this)window.hideQuickAdd()">
      <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px 20px 32px;width:100%;max-width:540px;
                  animation:slideUp 0.2s ease">
        <!-- Toggle -->
        <div style="display:flex;gap:0;margin-bottom:16px;background:var(--gray-100);border-radius:8px;padding:3px">
          <button id="qa-tab-task" onclick="window.qaSetTab('task')"
            style="flex:1;padding:7px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
                   background:var(--white);color:var(--gray-800);box-shadow:var(--shadow)">
            ✅ Task
          </button>
          <button id="qa-tab-reminder" onclick="window.qaSetTab('reminder')"
            style="flex:1;padding:7px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
                   background:transparent;color:var(--gray-400);box-shadow:none">
            ⏰ Reminder
          </button>
        </div>

        <!-- Title -->
        <input id="qa-title" type="text" placeholder="What needs to be done?" autocomplete="off"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:10px 12px;
                 font-size:15px;margin-bottom:10px;outline:none"
          onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'"
          onkeydown="if(event.key==='Enter')window.submitQuickAdd()" />

        <!-- Module -->
        <select id="qa-module"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:10px 12px;
                 font-size:14px;margin-bottom:10px;background:var(--white);color:var(--gray-800);outline:none">
          <option value="RT">🏫 River Tech</option>
          <option value="TOV">💍 Take One Visuals</option>
          <option value="Personal">👤 Personal</option>
        </select>

        <!-- Schedule toggle -->
        <div id="qa-schedule-row" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--gray-600);cursor:pointer">
            <input type="checkbox" id="qa-schedule-toggle" onchange="window.qaToggleDate(this.checked)"
              style="width:16px;height:16px;accent-color:var(--blue)">
            Schedule it
          </label>
          <input type="date" id="qa-date" style="display:none;border:1.5px solid var(--gray-200);
            border-radius:8px;padding:7px 10px;font-size:13px;flex:1;outline:none" />
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px">
          <button onclick="window.hideQuickAdd()"
            style="flex:1;padding:11px;border:1.5px solid var(--gray-200);border-radius:8px;
                   background:var(--white);font-size:14px;font-weight:600;color:var(--gray-600);cursor:pointer">
            Cancel
          </button>
          <button onclick="window.submitQuickAdd()"
            style="flex:2;padding:11px;border:none;border-radius:8px;background:var(--blue);
                   color:white;font-size:14px;font-weight:700;cursor:pointer">
            Add
          </button>
        </div>
      </div>
    </div>

    <!-- Tell Claude Modal -->
    <div id="tc-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;align-items:flex-end;justify-content:center"
         onclick="if(event.target===this)window.hideTellClaude()">
      <div style="background:#1e1e2e;border-radius:16px 16px 0 0;padding:20px 20px 32px;width:100%;max-width:540px;animation:slideUp 0.2s ease">
        <div style="font-size:17px;font-weight:700;margin-bottom:6px;color:white">🤖 Tell Claude</div>
        <div style="font-size:12px;color:#a0a0b8;margin-bottom:14px">I'll add this to my task list and work on it next time you say "Work on LifeOS".</div>

        <!-- Instruction -->
        <textarea id="tc-instruction" placeholder="e.g. Add a dark mode toggle to the settings page…" rows="3"
          style="width:100%;border:1.5px solid #3a3a5c;border-radius:8px;padding:10px 12px;
                 font-size:14px;margin-bottom:10px;outline:none;resize:vertical;font-family:inherit;
                 background:#2a2a3e;color:white;box-sizing:border-box"
          onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#3a3a5c'"
          onkeydown="if(event.key==='Enter'&&(event.metaKey||event.ctrlKey))window.submitTellClaude()"></textarea>

        <!-- Optional context -->
        <input id="tc-context" type="text" placeholder="Context (optional) — e.g. 'on the calendar page'" autocomplete="off"
          style="width:100%;border:1.5px solid #3a3a5c;border-radius:8px;padding:9px 12px;
                 font-size:13px;margin-bottom:14px;outline:none;background:#2a2a3e;color:white;box-sizing:border-box"
          onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#3a3a5c'" />

        <!-- Pending tasks count -->
        <div id="tc-pending-count" style="font-size:12px;color:#a0a0b8;margin-bottom:14px;text-align:center"></div>

        <!-- Actions -->
        <div style="display:flex;gap:8px">
          <button onclick="window.hideTellClaude()"
            style="flex:1;padding:11px;border:1.5px solid #3a3a5c;border-radius:8px;
                   background:transparent;font-size:14px;font-weight:600;color:#a0a0b8;cursor:pointer">
            Cancel
          </button>
          <button onclick="window.submitTellClaude()"
            style="flex:2;padding:11px;border:none;border-radius:8px;background:#7c3aed;
                   color:white;font-size:14px;font-weight:700;cursor:pointer">
            Add to Claude's List
          </button>
        </div>
      </div>
    </div>

    <!-- Feedback Modal -->
    <div id="fb-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;align-items:flex-end;justify-content:center"
         onclick="if(event.target===this)window.hideFeedback()">
      <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px 20px 32px;width:100%;max-width:540px;
                  animation:slideUp 0.2s ease">
        <div style="font-size:17px;font-weight:700;margin-bottom:14px">💬 Send Feedback</div>

        <!-- Toggle bug/feature -->
        <div style="display:flex;gap:0;margin-bottom:14px;background:var(--gray-100);border-radius:8px;padding:3px">
          <button id="fb-tab-bug" onclick="window.fbSetTab('bug')"
            style="flex:1;padding:7px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
                   background:var(--white);color:var(--gray-800);box-shadow:var(--shadow)">
            🐛 Bug
          </button>
          <button id="fb-tab-feature" onclick="window.fbSetTab('feature')"
            style="flex:1;padding:7px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
                   background:transparent;color:var(--gray-400);box-shadow:none">
            ✨ Feature
          </button>
        </div>

        <!-- Title -->
        <input id="fb-title" type="text" placeholder="Short summary…" autocomplete="off"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:10px 12px;
                 font-size:15px;margin-bottom:10px;outline:none"
          onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'"/>

        <!-- Description -->
        <textarea id="fb-desc" placeholder="More detail (optional)…" rows="3"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:10px 12px;
                 font-size:14px;margin-bottom:14px;resize:vertical;font-family:inherit;outline:none"
          onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'"></textarea>

        <!-- Actions -->
        <div style="display:flex;gap:8px">
          <button onclick="window.hideFeedback()"
            style="flex:1;padding:11px;border:1.5px solid var(--gray-200);border-radius:8px;
                   background:var(--white);font-size:14px;font-weight:600;color:var(--gray-600);cursor:pointer">
            Cancel
          </button>
          <button onclick="window.submitFeedback()"
            style="flex:2;padding:11px;border:none;border-radius:8px;background:var(--purple);
                   color:white;font-size:14px;font-weight:700;cursor:pointer">
            Submit
          </button>
        </div>
      </div>
    </div>

    <!-- Notification Panel -->
    <div id="notif-panel" style="display:none;position:fixed;top:58px;right:12px;width:340px;max-height:480px;
         background:var(--white);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15);
         border:1px solid var(--gray-200);z-index:999;overflow:hidden;display:none;flex-direction:column">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;
                  border-bottom:1px solid var(--gray-100);flex-shrink:0">
        <div style="font-size:14px;font-weight:700;color:var(--gray-800)">🔔 Notifications</div>
        <button onclick="window.markAllNotifsRead()"
          style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;font-weight:600;padding:2px 4px">
          Mark all read
        </button>
      </div>
      <!-- List -->
      <div id="notif-list" style="overflow-y:auto;flex:1;max-height:420px"></div>
    </div>

    <style>
      @keyframes slideUp {
        from { transform: translateY(100%); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }
    </style>
  `;
  document.body.appendChild(div);

  // Close notification panel when clicking outside
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const bellWrap = document.getElementById('topbar-bell-wrap');
    if (panel && notifPanelOpen && !panel.contains(e.target) && !bellWrap?.contains(e.target)) {
      panel.style.display = 'none';
      notifPanelOpen = false;
    }
  });
}

// ── Quick Add state ───────────────────────────────────────────────────────────
let qaTab = 'task';
let fbTab = 'bug';

window.showQuickAdd = () => {
  const el = document.getElementById('qa-overlay');
  el.style.display = 'flex';
  document.getElementById('qa-title').value = '';
  document.getElementById('qa-date').value = '';
  document.getElementById('qa-schedule-toggle').checked = false;
  document.getElementById('qa-date').style.display = 'none';
  qaSetTab('task');
  setTimeout(() => document.getElementById('qa-title').focus(), 50);
};

window.hideQuickAdd = () => {
  document.getElementById('qa-overlay').style.display = 'none';
};

window.qaSetTab = (tab) => {
  qaTab = tab;
  const taskBtn     = document.getElementById('qa-tab-task');
  const reminderBtn = document.getElementById('qa-tab-reminder');
  if (tab === 'task') {
    taskBtn.style.background = 'var(--white)'; taskBtn.style.color = 'var(--gray-800)'; taskBtn.style.boxShadow = 'var(--shadow)';
    reminderBtn.style.background = 'transparent'; reminderBtn.style.color = 'var(--gray-400)'; reminderBtn.style.boxShadow = 'none';
  } else {
    reminderBtn.style.background = 'var(--white)'; reminderBtn.style.color = 'var(--gray-800)'; reminderBtn.style.boxShadow = 'var(--shadow)';
    taskBtn.style.background = 'transparent'; taskBtn.style.color = 'var(--gray-400)'; taskBtn.style.boxShadow = 'none';
  }
};

window.qaToggleDate = (show) => {
  document.getElementById('qa-date').style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('qa-date').value = today();
    document.getElementById('qa-date').focus();
  }
};

window.submitQuickAdd = async () => {
  const title  = document.getElementById('qa-title').value.trim();
  const module = document.getElementById('qa-module').value;
  const date   = document.getElementById('qa-schedule-toggle').checked
                   ? document.getElementById('qa-date').value || null
                   : null;
  if (!title) { document.getElementById('qa-title').focus(); return; }

  let error;
  if (qaTab === 'task') {
    ({ error } = await supabase.from('tasks').insert({
      title, module, status: 'open', priority: 'normal',
      ...(date ? { due_date: date } : {}),
    }));
  } else {
    ({ error } = await supabase.from('reminders').insert({
      title, module, status: 'active',
      ...(date ? { due_date: date } : {}),
    }));
  }

  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast(`${qaTab === 'task' ? 'Task' : 'Reminder'} added ✅`, 'success');
  window.hideQuickAdd();
};

// ── Feedback state ────────────────────────────────────────────────────────────
window.showFeedback = () => {
  const el = document.getElementById('fb-overlay');
  el.style.display = 'flex';
  document.getElementById('fb-title').value = '';
  document.getElementById('fb-desc').value = '';
  fbSetTab('bug');
  setTimeout(() => document.getElementById('fb-title').focus(), 50);
};

window.hideFeedback = () => {
  document.getElementById('fb-overlay').style.display = 'none';
};

window.fbSetTab = (tab) => {
  fbTab = tab;
  const bugBtn     = document.getElementById('fb-tab-bug');
  const featureBtn = document.getElementById('fb-tab-feature');
  if (tab === 'bug') {
    bugBtn.style.background = 'var(--white)'; bugBtn.style.color = 'var(--gray-800)'; bugBtn.style.boxShadow = 'var(--shadow)';
    featureBtn.style.background = 'transparent'; featureBtn.style.color = 'var(--gray-400)'; featureBtn.style.boxShadow = 'none';
  } else {
    featureBtn.style.background = 'var(--white)'; featureBtn.style.color = 'var(--gray-800)'; featureBtn.style.boxShadow = 'var(--shadow)';
    bugBtn.style.background = 'transparent'; bugBtn.style.color = 'var(--gray-400)'; bugBtn.style.boxShadow = 'none';
  }
};

window.submitFeedback = async () => {
  const title = document.getElementById('fb-title').value.trim();
  const desc  = document.getElementById('fb-desc').value.trim();
  if (!title) { document.getElementById('fb-title').focus(); return; }

  const page = window.location.pathname.split('/').pop() || 'index.html';
  const { error } = await supabase.from('lifeos_feedback').insert({
    type: fbTab,
    title,
    description: desc || null,
    page,
    status: 'open',
  });

  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Feedback submitted 🙏', 'success');
  window.hideFeedback();
};

// ── Tell Claude state ─────────────────────────────────────────────────────────
window.showTellClaude = async () => {
  const el = document.getElementById('tc-overlay');
  el.style.display = 'flex';
  document.getElementById('tc-instruction').value = '';
  document.getElementById('tc-context').value = '';
  setTimeout(() => document.getElementById('tc-instruction').focus(), 50);

  // Show count of pending tasks
  const { data } = await supabase.from('claude_tasks').select('id').eq('status', 'open');
  const count = data?.length || 0;
  const countEl = document.getElementById('tc-pending-count');
  if (countEl) {
    countEl.textContent = count > 0
      ? `📋 ${count} task${count !== 1 ? 's' : ''} already in my queue`
      : '📋 No tasks in queue yet';
  }
};

window.hideTellClaude = () => {
  document.getElementById('tc-overlay').style.display = 'none';
};

window.submitTellClaude = async () => {
  const instruction = document.getElementById('tc-instruction').value.trim();
  const context     = document.getElementById('tc-context').value.trim() || null;
  if (!instruction) { document.getElementById('tc-instruction').focus(); return; }

  const page = window.location.pathname.split('/').pop() || 'index.html';
  const { error } = await supabase.from('claude_tasks').insert({
    instruction,
    context,
    page,
    status: 'open',
  });

  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Added to Claude\'s list 🤖', 'success');
  window.hideTellClaude();
};

// ── Init ──────────────────────────────────────────────────────────────────────
// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { injectButtons(); injectModals(); });
} else {
  injectButtons();
  injectModals();
}
