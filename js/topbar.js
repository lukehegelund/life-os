// Life OS — Global Topbar (quick-add + feedback buttons)
// Import this module on every page. It auto-injects buttons into .header-row
// and mounts the modal overlays.

import { supabase } from './supabase.js';
import { today, toast } from './utils.js';

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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
    <button id="topbar-quick-add" onclick="window.showQuickAgregar()" title="Quick add task or reminder"
      style="width:34px;height:34px;border-radius:50%;background:var(--blue);color:white;border:none;
             font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
             box-shadow:var(--shadow);flex-shrink:0">+</button>
    <button id="topbar-gold" onclick="window.showGlobalGold()" title="Quick gold — all students"
      style="width:34px;height:34px;border-radius:50%;background:var(--orange-light,#fff7ed);color:var(--orange,#f97316);border:1px solid var(--orange,#f97316);
             font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
             box-shadow:var(--shadow);flex-shrink:0">🪙</button>
    <a href="languages.html" id="topbar-languages" title="Languages"
      style="width:34px;height:34px;border-radius:50%;background:var(--gray-100);color:var(--gray-700);border:1px solid var(--gray-200);
             font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
             box-shadow:var(--shadow);flex-shrink:0;text-decoration:none">🌍</a>
    <a href="schedule.html" id="topbar-schedule" title="Scheduled Tasks"
      style="width:34px;height:34px;border-radius:50%;background:var(--gray-100);color:var(--gray-700);border:1px solid var(--gray-200);
             font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
             box-shadow:var(--shadow);flex-shrink:0;text-decoration:none">⏰</a>
    <div id="topbar-chat-wrap" style="position:relative;flex-shrink:0">
      <button id="topbar-chat" onclick="window.toggleChat()" title="Chat with Claude"
        style="width:34px;height:34px;border-radius:50%;background:#1e1e2e;color:white;border:none;
               font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
               box-shadow:var(--shadow)">💬</button>
      <span id="topbar-chat-badge" style="display:none;position:absolute;top:-3px;right:-3px;
        background:#2563eb;color:white;border-radius:50%;width:16px;height:16px;font-size:10px;
        font-weight:700;align-items:center;justify-content:center;line-height:1"></span>
    </div>
    <div id="topbar-bell-wrap" style="position:relative;flex-shrink:0">
      <button id="topbar-bell" onclick="window.toggleNotifications()" title="Notifications"
        style="width:34px;height:34px;border-radius:50%;background:var(--gray-100);color:var(--gray-700);border:1px solid var(--gray-200);
               font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
               box-shadow:var(--shadow)">🔔</button>
      <span id="topbar-bell-badge" style="display:none;position:absolute;top:-3px;right:-3px;
        background:#ef4444;color:white;border-radius:50%;width:16px;height:16px;font-size:10px;
        font-weight:700;align-items:center;justify-content:center;line-height:1"></span>
    </div>
  `;

  // Always append directly to headerRow (not inside a nested container)
  // so the topbar buttons appear at the top level of the flex row
  headerRow.appendChild(wrap);

  // Load unread badge on init
  loadBellBadge();
  loadChatBadge();
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

// ── Chat Badge (combines unread Claude replies + open queue items) ──────────────
async function loadChatBadge() {
  const [repliesRes, tasksRes, feedbackRes] = await Promise.all([
    supabase.from('claude_notifications').select('id').like('title', '💬 Claude:%').eq('read', false),
    supabase.from('claude_tasks').select('id').eq('status', 'open'),
    supabase.from('lifeos_feedback').select('id').eq('status', 'open'),
  ]);
  const count = (repliesRes.data?.length || 0) + (tasksRes.data?.length || 0) + (feedbackRes.data?.length || 0);
  const badge = document.getElementById('topbar-chat-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// Keep alias for any existing callers
async function loadQueueBadge() { await loadChatBadge(); }

// ── Notification Panel ─────────────────────────────────────────────────────────
let notifPanelOpen = false;

window.toggleNotifications = async () => {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;

  notifPanelOpen = !notifPanelOpen;
  const backdrop = document.getElementById('topbar-backdrop');
  if (notifPanelOpen) {
    panel.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';
    await renderNotifications();
  } else {
    panel.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
  }
};

async function renderNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:20px;font-size:13px">Cargando…</div>';

  const { data, error } = await supabase
    .from('claude_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error || !data?.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:24px;font-size:13px">Sin notificaciones aún</div>';
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

window.markTodosNotifsRead = async () => {
  await supabase.from('claude_notifications').update({ read: true }).eq('read', false);
  await renderNotifications();
  loadBellBadge();
};

// ── Claude Chat Panel (single conversation — no tabs) ─────────────────────────
let chatPanelOpen = false;
const DRAFT_KEY = 'lifeos_chat_draft';

// Legacy shim — showTellClaude still works but opens report form inline
window.claudeSetTab = async (tab) => {
  if (tab === 'report') { window.showTellClaude(); return; }
  await renderChat();
};

window.toggleChat = async () => {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  chatPanelOpen = !chatPanelOpen;
  const backdrop = document.getElementById('topbar-backdrop');
  if (chatPanelOpen) {
    panel.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';
    // Restore draft
    const input = document.getElementById('chat-input');
    if (input) {
      const draft = localStorage.getItem(DRAFT_KEY) || '';
      input.value = draft;
      input.style.height = 'auto';
      if (draft) input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    }
    await renderChat();
  } else {
    panel.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
  }
};

async function renderChat() {
  const list = document.getElementById('chat-list');
  const input = document.getElementById('chat-input');
  if (!list) return;

  list.innerHTML = '<div style="text-align:center;color:#a0a0b8;padding:20px;font-size:13px">Cargando…</div>';

  // Only fetch messages from the last 3 days
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch Luke's messages (claude_tasks with page=chat.html) + Claude's replies (💬 Claude: notifications)
  const [tasksRes, repliesRes] = await Promise.all([
    supabase.from('claude_tasks').select('id,instruction,created_at,status').eq('page', 'chat.html').gte('created_at', threeDaysAgo).order('created_at'),
    supabase.from('claude_notifications').select('id,title,body,read,created_at').like('title', '💬 Claude:%').gte('created_at', threeDaysAgo).order('created_at'),
  ]);

  const messages = [
    ...(tasksRes.data || []).map(t => ({
      id: 'task-' + t.id, from: 'luke',
      text: t.instruction,
      time: t.created_at,
    })),
    ...(repliesRes.data || []).map(r => ({
      id: 'notif-' + r.id, from: 'claude',
      text: (r.body || r.title.replace(/^💬 Claude:\s*/, '')),
      title: r.title.replace(/^💬 Claude:\s*/, ''),
      time: r.created_at,
      read: r.read,
      rawId: r.id,
    })),
  ].sort((a, b) => new Date(a.time) - new Date(b.time));

  if (!messages.length) {
    list.innerHTML = '<div style="text-align:center;color:#a0a0b8;padding:24px;font-size:13px">No messages yet.<br>Send Claude a message below!</div>';
  } else {
    list.innerHTML = messages.map(m => {
      const ts = new Date(m.time);
      const timeStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
                      ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      if (m.from === 'luke') {
        return `
          <div style="display:flex;justify-content:flex-end;margin:8px 14px">
            <div style="max-width:80%;background:#2563eb;color:white;border-radius:14px 14px 4px 14px;padding:10px 13px;font-size:13px;line-height:1.4">
              <div>${esc(m.text)}</div>
              <div style="font-size:10px;opacity:0.7;margin-top:4px;text-align:right">${timeStr}</div>
            </div>
          </div>`;
      } else {
        return `
          <div style="display:flex;justify-content:flex-start;margin:8px 14px">
            <div style="max-width:85%;background:#2a2a3e;border-radius:14px 14px 14px 4px;padding:10px 13px;font-size:13px;line-height:1.4;${!m.read ? 'border-left:3px solid #2563eb' : ''}">
              ${m.title ? `<div style="font-size:11px;font-weight:700;color:#7c7caa;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">Claude</div>` : ''}
              <div style="color:#e0e0f0;white-space:pre-wrap">${esc(m.text)}</div>
              <div style="font-size:10px;color:#6060a0;margin-top:4px">${timeStr}</div>
            </div>
          </div>`;
      }
    }).join('');
    // Scroll to bottom
    setTimeout(() => { list.scrollTop = list.scrollHeight; }, 50);
  }

  // Mark unread Claude replies as read
  const unreadIds = (repliesRes.data || []).filter(r => !r.read).map(r => r.id);
  if (unreadIds.length > 0) {
    setTimeout(async () => {
      await supabase.from('claude_notifications').update({ read: true }).in('id', unreadIds);
      loadChatBadge();
    }, 1200);
  }

  if (input) input.focus();
}

window.submitChat = async () => {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  // Clear saved draft on send
  localStorage.removeItem(DRAFT_KEY);

  const page = window.location.pathname.split('/').pop() || 'index.html';
  await supabase.from('claude_tasks').insert({
    instruction: text,
    page: 'chat.html',
    status: 'open',
    context: 'Sent from topbar chat on ' + page,
  });

  await renderChat();
};

// ── Modal HTML ────────────────────────────────────────────────────────────────
function injectModals() {
  if (document.getElementById('topbar-modals')) return;

  const div = document.createElement('div');
  div.id = 'topbar-modals';
  div.innerHTML = `
    <!-- Quick Agregar Modal -->
    <div id="qa-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;align-items:flex-end;justify-content:center"
         onclick="if(event.target===this)window.hideQuickAgregar()">
      <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px 20px 32px;width:100%;max-width:540px;
                  animation:slideUp 0.2s ease">
        <!-- Toggle -->
        <div style="display:flex;gap:0;margin-bottom:16px;background:var(--gray-100);border-radius:8px;padding:3px">
          <button id="qa-tab-task" onclick="window.qaSetTab('task')"
            style="flex:1;padding:7px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
                   background:var(--white);color:var(--gray-800);box-shadow:var(--shadow)">
            ✅ Tarea
          </button>
          <button id="qa-tab-reminder" onclick="window.qaSetTab('reminder')"
            style="flex:1;padding:7px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
                   background:transparent;color:var(--gray-400);box-shadow:none">
            ⏰ Recordatorio
          </button>
        </div>

        <!-- Title -->
        <input id="qa-title" type="text" placeholder="¿Qué hay que hacer?" autocomplete="off"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:10px 12px;
                 font-size:15px;margin-bottom:10px;outline:none"
          onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'"
          onkeydown="if(event.key==='Enter')window.submitQuickAgregar()" />

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
            Programarlo
          </label>
          <input type="date" id="qa-date" style="display:none;border:1.5px solid var(--gray-200);
            border-radius:8px;padding:7px 10px;font-size:13px;flex:1;outline:none" />
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px">
          <button onclick="window.hideQuickAgregar()"
            style="flex:1;padding:11px;border:1.5px solid var(--gray-200);border-radius:8px;
                   background:var(--white);font-size:14px;font-weight:600;color:var(--gray-600);cursor:pointer">
            Cancelarar
          </button>
          <button onclick="window.submitQuickAgregar()"
            style="flex:2;padding:11px;border:none;border-radius:8px;background:var(--blue);
                   color:white;font-size:14px;font-weight:700;cursor:pointer">
            Agregar
          </button>
        </div>
      </div>
    </div>


    <!-- Global Quick Gold Modal -->
    <div id="gg-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;align-items:flex-end;justify-content:center"
         onclick="if(event.target===this)window.hideGlobalGold()">
      <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px 20px 32px;width:100%;max-width:600px;
                  max-height:85vh;overflow-y:auto;animation:slideUp 0.2s ease">
        <div style="font-size:17px;font-weight:700;margin-bottom:4px">🪙 Oro Rápido</div>
        <div style="font-size:12px;color:var(--gray-400);margin-bottom:14px">Da oro a cualquier alumno — no ligado a una clase</div>

        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
          <input type="number" id="gg-amount" class="form-input" placeholder="Cantidad" min="-999" max="999"
            style="width:90px;text-align:center;border:1.5px solid var(--gray-200);border-radius:8px;padding:10px 12px;font-size:14px;outline:none">
          <input type="text" id="gg-reason" class="form-input" placeholder="Razón"
            style="flex:1;border:1.5px solid var(--gray-200);border-radius:8px;padding:10px 12px;font-size:14px;outline:none"
            onkeydown="if(event.key==='Enter')window.submitGlobalGold()">
        </div>

        <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
          <button class="btn btn-sm btn-ghost" onclick="window.ggSelectTodos()">Todos</button>
          <button class="btn btn-sm btn-ghost" onclick="window.ggSelectNone()">Limpiar</button>
          <button class="btn btn-sm" style="background:var(--orange-light,#fff7ed);color:var(--orange,#f97316);border:none" onclick="window.ggSetCantidad(5)">+5</button>
          <button class="btn btn-sm" style="background:var(--orange-light,#fff7ed);color:var(--orange,#f97316);border:none" onclick="window.ggSetCantidad(10)">+10</button>
          <button class="btn btn-sm" style="background:var(--orange-light,#fff7ed);color:var(--orange,#f97316);border:none" onclick="window.ggSetCantidad(25)">+25</button>
          <button class="btn btn-sm" style="background:#fee2e2;color:#ef4444;border:none" onclick="window.ggSetCantidad(-5)">−5</button>
          <button class="btn btn-sm" style="background:#fee2e2;color:#ef4444;border:none" onclick="window.ggSetCantidad(-10)">−10</button>
        </div>

        <!-- Search filter -->
        <input type="text" id="gg-search" placeholder="🔍 Buscar alumnos…"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:8px 12px;font-size:13px;
                 margin-bottom:10px;outline:none;box-sizing:border-box"
          oninput="window.ggFilterStudents(this.value)">

        <div id="gg-student-list" style="margin-bottom:14px">
          <div style="text-align:center;color:var(--gray-400);padding:20px;font-size:13px">Cargando alumnos…</div>
        </div>

        <div style="display:flex;gap:8px">
          <button onclick="window.hideGlobalGold()"
            style="flex:1;padding:11px;border:1.5px solid var(--gray-200);border-radius:8px;
                   background:var(--white);font-size:14px;font-weight:600;color:var(--gray-600);cursor:pointer">
            Cancelarar
          </button>
          <button onclick="window.submitGlobalGold()"
            style="flex:2;padding:11px;border:none;border-radius:8px;background:#f59e0b;
                   color:white;font-size:14px;font-weight:700;cursor:pointer">
            🪙 Dar Oro
          </button>
        </div>
      </div>
    </div>

    <!-- Notification Panel -->
    <div id="notif-panel" style="display:none;position:fixed;bottom:0;left:0;right:0;
         background:var(--white);border-radius:16px 16px 0 0;box-shadow:0 -4px 32px rgba(0,0,0,0.15);
         border-top:1px solid var(--gray-200);z-index:999;overflow:hidden;flex-direction:column;
         max-height:60vh">
      <!-- Drag handle -->
      <div style="display:flex;justify-content:center;padding:10px 0 4px;flex-shrink:0">
        <div style="width:36px;height:4px;border-radius:2px;background:var(--gray-200)"></div>
      </div>
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px 10px;
                  border-bottom:1px solid var(--gray-100);flex-shrink:0">
        <div style="font-size:15px;font-weight:700;color:var(--gray-800)">🔔 Notificaciones</div>
        <button onclick="window.markTodosNotifsRead()"
          style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;font-weight:600;padding:2px 4px">
          Marcar todo leído
        </button>
      </div>
      <!-- List -->
      <div id="notif-list" style="overflow-y:auto;flex:1"></div>
    </div>

    <!-- Claude Chat Panel (single conversation) -->
    <div id="chat-panel" style="display:none;position:fixed;bottom:0;left:0;right:0;
         background:#1e1e2e;border-radius:16px 16px 0 0;box-shadow:0 -4px 32px rgba(0,0,0,0.45);
         border-top:1px solid #3a3a5c;z-index:999;flex-direction:column;overflow:hidden;
         height:75vh;max-height:680px">
      <!-- Drag handle -->
      <div style="display:flex;justify-content:center;padding:10px 0 4px;flex-shrink:0">
        <div style="width:36px;height:4px;border-radius:2px;background:#3a3a5c"></div>
      </div>
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px 10px;
                  border-bottom:1px solid #3a3a5c;flex-shrink:0">
        <div style="font-size:15px;font-weight:700;color:white">🤖 Claude</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button onclick="window.showTellClaude()" title="Reportar bug o sugerencia"
            style="font-size:14px;color:#6060a0;background:none;border:none;cursor:pointer;padding:2px 4px;border-radius:6px;line-height:1"
            onmouseenter="this.style.color='#a0a0c8'" onmouseleave="this.style.color='#6060a0'">🐛</button>
          <button onclick="window.toggleChat()"
            style="font-size:18px;color:#6060a0;background:none;border:none;cursor:pointer;line-height:1;padding:0 2px">×</button>
        </div>
      </div>
      <!-- Inline Report Form (hidden by default) -->
      <div id="claude-report-form" style="display:none;flex-shrink:0;padding:10px 12px;border-bottom:1px solid #3a3a5c;background:#16162a">
        <div style="display:flex;gap:0;margin-bottom:8px;background:#2a2a3e;border-radius:6px;padding:2px">
          <button id="tc-tab-bug" onclick="window.tcSetTab('bug')"
            style="flex:1;padding:5px;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;
                   background:#1e1e2e;color:white;box-shadow:0 1px 3px rgba(0,0,0,0.4)">🐛 Bug</button>
          <button id="tc-tab-feature" onclick="window.tcSetTab('feature')"
            style="flex:1;padding:5px;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;
                   background:transparent;color:#6060a0;box-shadow:none">✨ Feature</button>
          <button id="tc-tab-task" onclick="window.tcSetTab('task')"
            style="flex:1;padding:5px;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;
                   background:transparent;color:#6060a0;box-shadow:none">🤖 Tarea</button>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-end">
          <textarea id="tc-instruction" placeholder="Describe the bug…" rows="2"
            style="flex:1;border:1.5px solid #3a3a5c;border-radius:7px;padding:7px 10px;
                   font-size:13px;outline:none;resize:none;font-family:inherit;
                   background:#2a2a3e;color:white;box-sizing:border-box"
            onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#3a3a5c'"
            onkeydown="if(event.key==='Enter'&&(event.metaKey||event.ctrlKey))window.submitTellClaude()"></textarea>
          <button id="tc-submit-btn" onclick="window.submitTellClaude()"
            style="padding:7px 12px;border:none;border-radius:7px;background:#7c3aed;
                   color:white;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">Enviar</button>
        </div>
      </div>
      <!-- Chat messages -->
      <div id="chat-list" style="overflow-y:auto;flex:1;padding:4px 0"></div>
      <!-- Input bar -->
      <div style="padding:10px 12px;border-top:1px solid #3a3a5c;flex-shrink:0;display:flex;gap:8px;align-items:flex-end">
        <textarea id="chat-input" placeholder="Mensaje para Claude…" rows="1"
          style="flex:1;background:#2a2a3e;border:1.5px solid #3a3a5c;border-radius:10px;padding:8px 11px;
                 color:white;font-size:13px;font-family:inherit;resize:none;outline:none;line-height:1.4;max-height:100px;overflow-y:auto"
          onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#3a3a5c'"
          oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';localStorage.setItem('lifeos_chat_draft',this.value)"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.submitChat()}"></textarea>
        <button onclick="window.submitChat()"
          style="width:34px;height:34px;border-radius:50%;background:#7c3aed;border:none;color:white;
                 font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">↑</button>
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

  // Backdrop div for panel dismissal
  const backdrop = document.createElement('div');
  backdrop.id = 'topbar-backdrop';
  backdrop.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:998;';
  backdrop.addEventListener('click', () => {
    if (notifPanelOpen) { document.getElementById('notif-panel').style.display = 'none'; notifPanelOpen = false; }
    if (chatPanelOpen) { document.getElementById('chat-panel').style.display = 'none'; chatPanelOpen = false; }
    backdrop.style.display = 'none';
  });
  document.body.appendChild(backdrop);

  // Close panels when clicking outside (kept for safety)
  document.addEventListener('click', (e) => {
    // Notification panel
    const panel = document.getElementById('notif-panel');
    const bellWrap = document.getElementById('topbar-bell-wrap');
    if (panel && notifPanelOpen && !panel.contains(e.target) && !bellWrap?.contains(e.target)) {
      panel.style.display = 'none';
      notifPanelOpen = false;
      document.getElementById('topbar-backdrop').style.display = 'none';
    }
    // Chat panel
    const cPanel = document.getElementById('chat-panel');
    const cWrap = document.getElementById('topbar-chat-wrap');
    if (cPanel && chatPanelOpen && !cPanel.contains(e.target) && !cWrap?.contains(e.target)) {
      cPanel.style.display = 'none';
      chatPanelOpen = false;
      document.getElementById('topbar-backdrop').style.display = 'none';
    }
  });
}

// ── Quick Agregar state ───────────────────────────────────────────────────────────
let qaTab = 'task';
let tcTab = 'bug';

window.showQuickAgregar = () => {
  const el = document.getElementById('qa-overlay');
  el.style.display = 'flex';
  document.getElementById('qa-title').value = '';
  document.getElementById('qa-date').value = '';
  document.getElementById('qa-schedule-toggle').checked = false;
  document.getElementById('qa-date').style.display = 'none';
  qaSetTab('task');
  setTimeout(() => document.getElementById('qa-title').focus(), 50);
};

window.hideQuickAgregar = () => {
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

window.submitQuickAgregar = async () => {
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
  window.hideQuickAgregar();
};

// ── Tell Claude (unified: Bug / Feature / Task) ───────────────────────────────
const TC_TABS = {
  bug:     { subtitle: 'Report something that\'s broken.',            placeholder: 'Describe the bug…',              btn: '🐛 Submit Bug' },
  feature: { subtitle: 'Suggest a new feature or improvement.',       placeholder: 'Describe the feature request…',  btn: '✨ Request Feature' },
  task:    { subtitle: 'Agregar a task to my queue — I\'ll tackle it next LifeOS session.', placeholder: 'e.g. Agregar a dark mode toggle to settings…', btn: '🤖 Agregar to Queue' },
};

// showTellClaude — opens chat panel and expands the inline report form
window.showTellClaude = async (defaultTab) => {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  if (!chatPanelOpen) {
    chatPanelOpen = true;
    panel.style.display = 'flex';
    const input = document.getElementById('chat-input');
    if (input) {
      const draft = localStorage.getItem(DRAFT_KEY) || '';
      input.value = draft;
      input.style.height = 'auto';
      if (draft) input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    }
    await renderChat();
  }
  const reportForm = document.getElementById('claude-report-form');
  if (reportForm) {
    const isOpen = reportForm.style.display !== 'none';
    reportForm.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      document.getElementById('tc-instruction').value = '';
      window.tcSetTab(defaultTab || 'bug');
      setTimeout(() => document.getElementById('tc-instruction')?.focus(), 50);
    }
  }
};

window.hideTellClaude = () => {
  const reportForm = document.getElementById('claude-report-form');
  if (reportForm) reportForm.style.display = 'none';
};

window.tcSetTab = (tab) => {
  tcTab = tab;
  const tabs = ['bug', 'feature', 'task'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tc-tab-${t}`);
    if (!btn) return;
    const active = t === tab;
    btn.style.background = active ? '#1e1e2e' : 'transparent';
    btn.style.color = active ? 'white' : '#6060a0';
    btn.style.boxShadow = active ? '0 1px 4px rgba(0,0,0,0.4)' : 'none';
  });
  const cfg = TC_TABS[tab];
  const subtitle = document.getElementById('tc-subtitle');
  const textarea = document.getElementById('tc-instruction');
  const submitBtn = document.getElementById('tc-submit-btn');
  if (subtitle) subtitle.textContent = cfg.subtitle;
  if (textarea) textarea.placeholder = cfg.placeholder;
  if (submitBtn) submitBtn.textContent = cfg.btn;
};

window.submitTellClaude = async () => {
  const text = document.getElementById('tc-instruction').value.trim();
  if (!text) { document.getElementById('tc-instruction').focus(); return; }

  const page = window.location.pathname.split('/').pop() || 'index.html';
  let error;

  if (tcTab === 'task') {
    ({ error } = await supabase.from('claude_tasks').insert({
      instruction: text,
      context: null,
      page,
      status: 'open',
    }));
    if (!error) toast('Agregado a la cola de Claude 🤖', 'success');
  } else {
    ({ error } = await supabase.from('lifeos_feedback').insert({
      type: tcTab,
      title: text,
      description: null,
      page,
      status: 'open',
    }));
    if (!error) toast(tcTab === 'bug' ? 'Bug reportado 🐛' : 'Función solicitada ✨', 'success');
  }

  if (error) { toast('Error: ' + error.message, 'error'); return; }
  document.getElementById('tc-instruction').value = '';
  // Close the inline report form
  const reportForm = document.getElementById('claude-report-form');
  if (reportForm) reportForm.style.display = 'none';
  loadChatBadge();
};

// ── Legacy stubs (buttons removed, kept for safety) ───────────────────────────
let tcQueueOpen = false;
window.toggleTcQueue = () => {};
let queuePanelOpen = false;
window.hideQueueStatus = () => {};
window.toggleQueueStatus = () => window.toggleChat();

// ── Global Quick Gold ─────────────────────────────────────────────────────────
let ggChecked = new Set();
let ggTodosStudents = [];

window.showGlobalGold = async () => {
  const el = document.getElementById('gg-overlay');
  el.style.display = 'flex';
  document.getElementById('gg-amount').value = '';
  document.getElementById('gg-reason').value = '';
  document.getElementById('gg-search').value = '';
  ggChecked.clear();

  // Load all active students
  const { data } = await supabase
    .from('students')
    .select('id, name, current_gold')
    .eq('status', 'Active')
    .order('name');
  ggTodosStudents = data || [];
  renderGgStudents(ggTodosStudents);
  setTimeout(() => document.getElementById('gg-amount').focus(), 50);
};

window.hideGlobalGold = () => {
  document.getElementById('gg-overlay').style.display = 'none';
};

function renderGgStudents(students) {
  const el = document.getElementById('gg-student-list');
  if (!el) return;
  if (!students.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:16px;font-size:13px">Sin alumnos</div>';
    return;
  }
  el.innerHTML = students.map(s => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--gray-100)">
      <input type="checkbox" class="gg-check" id="ggc-${s.id}"
        ${ggChecked.has(s.id) ? 'checked' : ''}
        onchange="window.ggToggle(${s.id}, this.checked)"
        style="width:16px;height:16px;accent-color:#f59e0b;flex-shrink:0">
      <label for="ggc-${s.id}" style="flex:1;font-size:14px;cursor:pointer;color:var(--gray-800)">${s.name}</label>
      <span style="font-size:12px;color:var(--gray-400);font-weight:500">${s.current_gold ?? 0} 🪙</span>
    </div>`).join('');
}

window.ggToggle = (id, checked) => {
  if (checked) ggChecked.add(id); else ggChecked.delete(id);
};

window.ggSelectTodos = () => {
  document.querySelectorTodos('.gg-check').forEach(cb => {
    cb.checked = true;
    ggChecked.add(Number(cb.id.replace('ggc-', '')));
  });
};

window.ggSelectNone = () => {
  document.querySelectorTodos('.gg-check').forEach(cb => { cb.checked = false; });
  ggChecked.clear();
};

window.ggSetCantidad = (val) => {
  const inp = document.getElementById('gg-amount');
  if (inp) inp.value = val;
};

window.ggFilterStudents = (query) => {
  const q = query.toLowerCase().trim();
  const filtered = q ? ggTodosStudents.filter(s => s.name.toLowerCase().includes(q)) : ggTodosStudents;
  renderGgStudents(filtered);
};

window.submitGlobalGold = async () => {
  const amountRaw = parseInt(document.getElementById('gg-amount').value, 10);
  const reason = document.getElementById('gg-reason').value.trim() || 'Quick gold';
  if (!amountRaw || amountRaw === 0) { toast('Ingresa una cantidad', 'info'); return; }
  if (!ggChecked.size) { toast('Selecciona al menos un alumno', 'info'); return; }

  const T = today();
  const inserts = [];
  for (const sid of ggChecked) {
    inserts.push({
      student_id: sid,
      class_id: null,
      date: T,
      amount: amountRaw,
      reason,
      category: amountRaw > 0 ? 'Participation' : 'Behavior',
      distributed: false,
    });
  }

  const { error } = await supabase.from('gold_transactions').insert(inserts);
  if (error) { toast('Error: ' + error.message, 'error'); return; }

  // Update current_gold balances
  for (const sid of ggChecked) {
    const r = await supabase.from('students').select('current_gold').eq('id', sid).single();
    const cur = r.data?.current_gold ?? 0;
    await supabase.from('students').update({ current_gold: cur + amountRaw }).eq('id', sid);
  }

  toast(`¡Oro dado a ${ggChecked.size} student${ggChecked.size > 1 ? 's' : ''}! 🪙`, 'success');
  ggChecked.clear();
  document.getElementById('gg-amount').value = '';
  document.getElementById('gg-reason').value = '';
  // Reload to show updated balances
  const { data } = await supabase.from('students').select('id, name, current_gold').eq('status', 'Active').order('name');
  ggTodosStudents = data || [];
  renderGgStudents(ggTodosStudents);
};

// ── Init ──────────────────────────────────────────────────────────────────────
// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { injectButtons(); injectModals(); });
} else {
  injectButtons();
  injectModals();
}
