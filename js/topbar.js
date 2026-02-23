// Life OS — Global Topbar (quick-add + feedback buttons)
// Import this module on every page. It auto-injects buttons into .header-row
// and mounts the modal overlays.

import { supabase } from './supabase.js';
import { today, toast } from './utils.js';

// ── Inject buttons into header ────────────────────────────────────────────────
function injectButtons() {
  const headerRow = document.querySelector('.header-row');
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
}

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

    <style>
      @keyframes slideUp {
        from { transform: translateY(100%); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }
    </style>
  `;
  document.body.appendChild(div);
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
  const active   = 'background:var(--white);color:var(--gray-800);box-shadow:var(--shadow)';
  const inactive = 'background:transparent;color:var(--gray-400);box-shadow:none';
  taskBtn.style.cssText     += tab === 'task'     ? active : inactive;
  reminderBtn.style.cssText += tab === 'reminder' ? active : inactive;
  // Re-apply cleanly
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

// ── Init ──────────────────────────────────────────────────────────────────────
// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { injectButtons(); injectModals(); });
} else {
  injectButtons();
  injectModals();
}
