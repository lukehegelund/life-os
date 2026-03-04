// projects.js — Claude Projects feature
// Manages long-running agentic projects that Claude works on across LifeOS sessions
// v2: English content strings throughout

import { supabase } from './supabase.js';
import { todayPST } from './utils.js';

const T = todayPST();

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

// ── State ─────────────────────────────────────────────────────────────────────
let allProjects = [];
let _openProjectId = null;

// ── Load & Render ─────────────────────────────────────────────────────────────
async function load() {
  const { data, error } = await supabase
    .from('claude_projects')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) { console.error('load error', error); return; }
  allProjects = data || [];

  renderList();

  const actionCount = allProjects.filter(p => p.action_needed).length;
  const badge = document.getElementById('proj-action-count');
  const subtitle = document.getElementById('proj-subtitle');
  if (badge) {
    if (actionCount > 0) {
      badge.style.display = '';
      badge.textContent = `⚠️ ${actionCount} need${actionCount !== 1 ? '' : 's'} your reply`;
    } else {
      badge.style.display = 'none';
    }
  }
  if (subtitle) {
    subtitle.textContent = allProjects.length === 0
      ? 'No active projects'
      : `${allProjects.length} project${allProjects.length !== 1 ? 's' : ''}`;
  }
}

function renderList() {
  const el = document.getElementById('proj-list');
  if (!el) return;
  if (allProjects.length === 0) {
    el.innerHTML = `<div class="sr-empty" style="padding:30px 0;text-align:center">
      <div style="font-size:40px;margin-bottom:10px">🗂️</div>
      <div style="font-size:14px;color:var(--gray-500)">No projects yet.</div>
      <div style="font-size:12px;color:var(--gray-400);margin-top:4px">Tap "+ New Project" to get started.</div>
    </div>`;
    return;
  }
  el.innerHTML = allProjects.map(p => projectCardHtml(p)).join('');
}

function projectCardHtml(p) {
  const needsAction = !!p.action_needed;
  const badgeHtml = needsAction
    ? `<span class="proj-badge action">⚠️ Needs your reply</span>`
    : `<span class="proj-badge active">✅ In progress</span>`;

  const statusSnippet = p.current_status
    ? `<div class="proj-status-snippet">${esc(p.current_status)}</div>`
    : '';

  return `<div class="proj-card${needsAction ? ' needs-action' : ''}" onclick="openProject('${p.id}')">
    <div class="proj-card-inner">
      <div class="proj-card-accent"></div>
      <div class="proj-card-body">
        <div class="proj-card-title">🗂️ ${esc(p.title)}</div>
        <div class="proj-card-prompt">${esc(p.prompt)}</div>
        <div class="proj-card-meta">
          ${badgeHtml}
          <span class="proj-date-label">Created ${fmtDate(p.created_at)}</span>
        </div>
        ${statusSnippet}
      </div>
    </div>
  </div>`;
}

// ── Project Detail Panel ──────────────────────────────────────────────────────
window.openProject = function(id) {
  const p = allProjects.find(x => x.id === id);
  if (!p) return;
  _openProjectId = id;

  document.getElementById('pp-title').textContent = p.title;
  renderPanelBody(p);

  document.getElementById('proj-panel-overlay').classList.add('open');
  document.getElementById('proj-panel').classList.add('open');
};

window.closePanel = function() {
  _openProjectId = null;
  document.getElementById('proj-panel-overlay').classList.remove('open');
  document.getElementById('proj-panel').classList.remove('open');
};

function renderPanelBody(p) {
  const body = document.getElementById('pp-body');
  if (!body) return;

  const logHtml = (() => {
    let entries = [];
    try { entries = Array.isArray(p.log) ? p.log : JSON.parse(p.log || '[]'); } catch {}
    if (entries.length === 0) return `<div class="proj-section-empty">No log entries yet.</div>`;
    return `<div class="proj-log-timeline">${
      [...entries].reverse().map(e => `
        <div class="proj-log-entry">
          <div class="proj-log-ts">${e.ts ? new Date(e.ts).toLocaleString('en-US', {timeZone:'America/Los_Angeles'}) : ''}</div>
          <div class="proj-log-text">${esc(e.text)}</div>
        </div>`).join('')
    }</div>`;
  })();

  const actionHtml = p.action_needed
    ? `<div class="proj-action-block">
        <div class="proj-action-header">
          <div class="proj-action-icon">⚠️</div>
          <div class="proj-action-label">Needs your reply</div>
        </div>
        <div class="proj-action-body">
          <div class="proj-action-question">${esc(p.action_needed)}</div>
          <div class="proj-action-reply">
            <input type="text" id="proj-reply-input" placeholder="Type your reply..." />
            <button onclick="submitProjectReply('${p.id}')">Send →</button>
          </div>
        </div>
      </div>`
    : '';

  // ── Chat history for this project (from log) ─────────────────────────────
  let chatEntries = [];
  try { chatEntries = Array.isArray(p.log) ? p.log : JSON.parse(p.log || '[]'); } catch {}
  const chatMsgs = chatEntries.filter(e => e.text && (
    e.text.startsWith('💬 Luke:') ||
    e.text.startsWith('📋 Claude asked:') ||
    e.text.startsWith('✅ Luke replied:') ||
    e.text.startsWith('💬 Claude:') ||
    // backwards-compat with older Spanish prefixes
    e.text.startsWith('📋 Claude preguntó:') ||
    e.text.startsWith('✅ Luke respondió:')
  ));

  const chatHtml = `
    <div class="proj-chat-box">
      <div class="proj-chat-header">💬 Project Chat</div>
      <div class="proj-chat-messages" id="proj-chat-msgs-${p.id}">
        ${chatMsgs.length === 0
          ? `<div class="proj-chat-empty">No messages yet. Message Claude about this project.</div>`
          : chatMsgs.map(e => {
              const isLuke = e.text.startsWith('💬 Luke:') || e.text.startsWith('✅ Luke replied:') || e.text.startsWith('✅ Luke respondió:');
              const isClaude = e.text.startsWith('📋 Claude asked:') || e.text.startsWith('💬 Claude:') || e.text.startsWith('📋 Claude preguntó:');
              const ts = e.ts ? new Date(e.ts).toLocaleString('en-US', {timeZone:'America/Los_Angeles', hour:'2-digit', minute:'2-digit', month:'short', day:'numeric'}) : '';
              return `<div class="proj-chat-msg ${isLuke ? 'msg-luke' : 'msg-claude'}">
                <div class="proj-chat-bubble">${esc(e.text)}</div>
                <div class="proj-chat-ts">${ts}</div>
              </div>`;
            }).join('')
        }
      </div>
      <div class="proj-chat-input-row">
        <textarea id="proj-chat-input-${p.id}" placeholder="Message Claude..." rows="2" class="proj-chat-input"></textarea>
        <button class="proj-chat-send" onclick="sendProjectChat('${p.id}')">Enviar</button>
      </div>
    </div>
  `;

  body.innerHTML = `
    ${chatHtml}
    ${actionHtml}

    <div class="proj-block theme-blue">
      <div class="proj-block-header">
        <div class="proj-block-icon">🎯</div>
        <div class="proj-block-label">Main Goal</div>
      </div>
      <div class="proj-block-body">
        <div class="proj-section-text">${esc(p.prompt)}</div>
      </div>
    </div>

    <div class="proj-block theme-amber">
      <div class="proj-block-header">
        <div class="proj-block-icon">📋</div>
        <div class="proj-block-label">Detailed Instructions</div>
        <button class="proj-block-action" onclick="editDetailedInstructions('${p.id}')">Edit</button>
      </div>
      <div class="proj-block-body">
        <div id="di-view-${p.id}">
          ${p.detailed_instructions
            ? `<div class="proj-section-text">${esc(p.detailed_instructions)}</div>`
            : `<div class="proj-section-empty">Claude will generate detailed instructions when the project starts.</div>`}
        </div>
        <div id="di-edit-${p.id}" style="display:none">
          <textarea class="proj-editable" id="di-textarea-${p.id}" style="min-height:160px">${esc(p.detailed_instructions || '')}</textarea>
          <div class="proj-edit-row">
            <button class="proj-panel-btn" onclick="cancelEditDI('${p.id}')">Cancel</button>
            <button class="proj-panel-btn" style="background:var(--blue);color:white;border-color:var(--blue)" onclick="saveDetailedInstructions('${p.id}')">Save</button>
          </div>
        </div>
      </div>
    </div>

    <div class="proj-block theme-green">
      <div class="proj-block-header">
        <div class="proj-block-icon">📍</div>
        <div class="proj-block-label">Current Status</div>
      </div>
      <div class="proj-block-body">
        ${p.current_status
          ? `<div class="proj-section-text">${esc(p.current_status)}</div>`
          : `<div class="proj-section-empty">Claude hasn't started this project yet.</div>`}
      </div>
    </div>

    <div class="proj-block theme-purple">
      <div class="proj-block-header">
        <div class="proj-block-icon">📜</div>
        <div class="proj-block-label">Activity Log</div>
      </div>
      <div class="proj-block-body">
        ${logHtml}
      </div>
    </div>

    <div class="proj-block theme-gray">
      <div class="proj-block-header">
        <div class="proj-block-icon">⚙️</div>
        <div class="proj-block-label">Actions</div>
      </div>
      <div class="proj-block-body">
        <div class="proj-panel-footer">
          <button class="proj-panel-btn" onclick="archiveProject('${p.id}')">🗄️ Archive</button>
          <button class="proj-panel-btn danger" onclick="deleteProject('${p.id}')">🗑️ Delete</button>
        </div>
      </div>
    </div>
  `;

  // Allow Enter in reply input + scroll into view on mobile keyboard open
  setTimeout(() => {
    const inp = document.getElementById('proj-reply-input');
    if (inp) {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') window.submitProjectReply(p.id); });
      inp.addEventListener('focus', () => {
        setTimeout(() => { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 320);
      });
    }

    // Scroll chat messages to bottom
    const msgs = document.getElementById(`proj-chat-msgs-${p.id}`);
    if (msgs) msgs.scrollTop = msgs.scrollHeight;

    // Ctrl+Enter or Shift+Enter = newline, plain Enter = send on desktop
    const chatInp = document.getElementById(`proj-chat-input-${p.id}`);
    if (chatInp) {
      chatInp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
          e.preventDefault();
          window.sendProjectChat(p.id);
        }
      });
      chatInp.addEventListener('focus', () => {
        setTimeout(() => { chatInp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 320);
      });
    }
  }, 50);
}

// ── Reply to action_needed ────────────────────────────────────────────────────
window.submitProjectReply = async function(id) {
  const inp = document.getElementById('proj-reply-input');
  const reply = inp?.value?.trim();
  if (!reply) return;

  const p = allProjects.find(x => x.id === id);
  if (!p) return;

  // Append to log: log the question + the reply
  let log = [];
  try { log = Array.isArray(p.log) ? [...p.log] : JSON.parse(p.log || '[]'); } catch {}
  const now = new Date().toISOString();
  log.push({ ts: now, text: `📋 Claude asked: ${p.action_needed}` });
  log.push({ ts: now, text: `✅ Luke replied: ${reply}` });

  const { error } = await supabase
    .from('claude_projects')
    .update({
      action_needed: null,
      log,
      updated_at: now,
    })
    .eq('id', id);

  if (error) { console.error('submitProjectReply error', error); return; }

  p.action_needed = null;
  p.log = log;
  p.updated_at = now;

  await load();
  // Re-open the panel with updated data
  if (_openProjectId === id) {
    openProject(id);
  }
};

// ── Project chat — send a message to Claude about this project ────────────────
window.sendProjectChat = async function(id) {
  const inp = document.getElementById(`proj-chat-input-${id}`);
  const msg = inp?.value?.trim();
  if (!msg) return;

  const p = allProjects.find(x => x.id === id);
  if (!p) return;

  inp.value = '';
  inp.disabled = true;

  const now = new Date().toISOString();

  // 1. Append the message to the project log so it shows in chat history
  let log = [];
  try { log = Array.isArray(p.log) ? [...p.log] : JSON.parse(p.log || '[]'); } catch {}
  log.push({ ts: now, text: `💬 Luke: ${msg}` });

  await supabase.from('claude_projects').update({ log, updated_at: now }).eq('id', id);

  // 2. Create a claude_task so Claude picks it up in the next LifeOS session
  await supabase.from('claude_tasks').insert({
    instruction: `[Project: ${p.title}] ${msg}`,
    status: 'open',
    context: `Chat message sent from project "${p.title}" (id: ${id}) in projects.html`,
    page: 'chat.html',
  });

  inp.disabled = false;

  // Refresh the panel to show the new message
  p.log = log;
  renderPanelBody(p);
};

// ── Edit detailed instructions ────────────────────────────────────────────────
window.editDetailedInstructions = function(id) {
  document.getElementById(`di-view-${id}`).style.display = 'none';
  document.getElementById(`di-edit-${id}`).style.display = 'block';
  document.getElementById(`di-textarea-${id}`)?.focus();
};

window.cancelEditDI = function(id) {
  document.getElementById(`di-view-${id}`).style.display = 'block';
  document.getElementById(`di-edit-${id}`).style.display = 'none';
};

window.saveDetailedInstructions = async function(id) {
  const val = document.getElementById(`di-textarea-${id}`)?.value?.trim();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('claude_projects')
    .update({ detailed_instructions: val || null, updated_at: now })
    .eq('id', id);

  if (error) { console.error('saveDetailedInstructions error', error); return; }

  const p = allProjects.find(x => x.id === id);
  if (p) p.detailed_instructions = val || null;

  cancelEditDI(id);
  // Update the view without re-opening
  const viewEl = document.getElementById(`di-view-${id}`);
  if (viewEl) {
    viewEl.innerHTML = val
      ? `<div class="proj-section-text">${esc(val)}</div>`
      : `<div class="proj-section-empty">Claude will generate detailed instructions when the project starts.</div>`;
  }
};

// ── Archive / Delete ──────────────────────────────────────────────────────────
window.archiveProject = async function(id) {
  if (!confirm('Archive this project? It will no longer appear in the active list.')) return;
  const { error } = await supabase
    .from('claude_projects')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { console.error(error); return; }
  closePanel();
  await load();
};

window.deleteProject = async function(id) {
  if (!confirm('Permanently delete this project?')) return;
  const { error } = await supabase.from('claude_projects').delete().eq('id', id);
  if (error) { console.error(error); return; }
  closePanel();
  await load();
};

// ── New Project Modal ─────────────────────────────────────────────────────────
window.showNewProjectModal = function() {
  document.getElementById('np-title').value = '';
  document.getElementById('np-prompt').value = '';
  document.getElementById('new-proj-modal').classList.add('open');
  setTimeout(() => document.getElementById('np-title')?.focus(), 100);
};

window.closeNewModal = function() {
  document.getElementById('new-proj-modal').classList.remove('open');
};

// Close modal on overlay click
document.getElementById('new-proj-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeNewModal();
});

window.submitNewProject = async function() {
  const title = document.getElementById('np-title')?.value?.trim();
  const prompt = document.getElementById('np-prompt')?.value?.trim();
  if (!title || !prompt) {
    if (!title) document.getElementById('np-title')?.focus();
    else document.getElementById('np-prompt')?.focus();
    return;
  }

  const btn = document.querySelector('#new-proj-modal .modal-btn.save');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

  const now = new Date().toISOString();
  const { error } = await supabase.from('claude_projects').insert({
    title,
    prompt,
    log: JSON.stringify([{ ts: now, text: `📁 Project created` }]),
    active: true,
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Create Project'; }

  if (error) { console.error('submitNewProject error', error); return; }

  closeNewModal();
  await load();
};

// ── Init ──────────────────────────────────────────────────────────────────────
load();
