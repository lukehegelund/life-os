// projects.js — Claude Projects feature
// Manages long-running agentic projects that Claude works on across LifeOS sessions

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
  return d.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
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
      badge.textContent = `⚠️ ${actionCount} necesita respuesta`;
    } else {
      badge.style.display = 'none';
    }
  }
  if (subtitle) {
    subtitle.textContent = allProjects.length === 0
      ? 'Sin proyectos activos'
      : `${allProjects.length} proyecto${allProjects.length !== 1 ? 's' : ''}`;
  }
}

function renderList() {
  const el = document.getElementById('proj-list');
  if (!el) return;
  if (allProjects.length === 0) {
    el.innerHTML = `<div class="sr-empty" style="padding:30px 0;text-align:center">
      <div style="font-size:40px;margin-bottom:10px">🗂️</div>
      <div style="font-size:14px;color:var(--gray-500)">Sin proyectos todavía.</div>
      <div style="font-size:12px;color:var(--gray-400);margin-top:4px">Toca "+ Nuevo Proyecto" para comenzar.</div>
    </div>`;
    return;
  }
  el.innerHTML = allProjects.map(p => projectCardHtml(p)).join('');
}

function projectCardHtml(p) {
  const needsAction = !!p.action_needed;
  const badgeHtml = needsAction
    ? `<span class="proj-badge action">⚠️ Necesita respuesta</span>`
    : `<span class="proj-badge active">✅ En progreso</span>`;

  const statusSnippet = p.current_status
    ? `<div class="proj-status-snippet">${esc(p.current_status)}</div>`
    : '';

  return `<div class="proj-card${needsAction ? ' needs-action' : ''}" onclick="openProject('${p.id}')">
    <div class="proj-card-top">
      <div style="flex:1;min-width:0">
        <div class="proj-card-title">🗂️ ${esc(p.title)}</div>
        <div class="proj-card-prompt">${esc(p.prompt)}</div>
      </div>
    </div>
    <div class="proj-card-meta">
      ${badgeHtml}
      <span style="font-size:11px;color:var(--gray-400)">Creado ${fmtDate(p.created_at)}</span>
    </div>
    ${statusSnippet}
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
    if (entries.length === 0) return `<div class="proj-section-empty">Sin entradas de log aún.</div>`;
    return [...entries].reverse().map(e => `
      <div class="proj-log-entry">
        <div class="proj-log-ts">${e.ts ? new Date(e.ts).toLocaleString('es-MX', {timeZone:'America/Los_Angeles'}) : ''}</div>
        <div>${esc(e.text)}</div>
      </div>`).join('');
  })();

  const actionHtml = p.action_needed
    ? `<div class="proj-action-banner">
        <div class="proj-action-banner-label">⚠️ Necesita tu respuesta</div>
        <div class="proj-action-banner-text">${esc(p.action_needed)}</div>
        <div class="proj-action-reply">
          <input type="text" id="proj-reply-input" placeholder="Escribe tu respuesta..." />
          <button onclick="submitProjectReply('${p.id}')">Enviar</button>
        </div>
      </div>`
    : '';

  body.innerHTML = `
    ${actionHtml}

    <div class="proj-section">
      <div class="proj-section-label">🎯 Objetivo principal</div>
      <div class="proj-section-text">${esc(p.prompt)}</div>
    </div>

    <div class="proj-section">
      <div class="proj-section-label">📋 Instrucciones detalladas
        <button onclick="editDetailedInstructions('${p.id}')" style="margin-left:6px;font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid var(--gray-300);background:none;cursor:pointer;color:var(--gray-500)">Editar</button>
      </div>
      <div id="di-view-${p.id}">
        ${p.detailed_instructions
          ? `<div class="proj-section-text">${esc(p.detailed_instructions)}</div>`
          : `<div class="proj-section-empty">Claude generará las instrucciones detalladas al iniciar el proyecto.</div>`}
      </div>
      <div id="di-edit-${p.id}" style="display:none">
        <textarea class="proj-editable" id="di-textarea-${p.id}" style="min-height:160px">${esc(p.detailed_instructions || '')}</textarea>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="proj-panel-btn" onclick="cancelEditDI('${p.id}')">Cancelar</button>
          <button class="proj-panel-btn primary" onclick="saveDetailedInstructions('${p.id}')">Guardar</button>
        </div>
      </div>
    </div>

    <div class="proj-section">
      <div class="proj-section-label">📍 Estado actual (Claude)</div>
      ${p.current_status
        ? `<div class="proj-section-text">${esc(p.current_status)}</div>`
        : `<div class="proj-section-empty">Claude aún no ha iniciado este proyecto.</div>`}
    </div>

    <div class="proj-section">
      <div class="proj-section-label">📜 Log</div>
      ${logHtml}
    </div>

    <div class="proj-panel-actions">
      <button class="proj-panel-btn" onclick="archiveProject('${p.id}')">🗄️ Archivar</button>
      <button class="proj-panel-btn danger" onclick="deleteProject('${p.id}')">🗑️ Eliminar</button>
    </div>
  `;

  // Allow Enter in reply input
  setTimeout(() => {
    const inp = document.getElementById('proj-reply-input');
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') window.submitProjectReply(p.id); });
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
  log.push({ ts: now, text: `📋 Claude preguntó: ${p.action_needed}` });
  log.push({ ts: now, text: `✅ Luke respondió: ${reply}` });

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
      : `<div class="proj-section-empty">Claude generará las instrucciones detalladas al iniciar el proyecto.</div>`;
  }
};

// ── Archive / Delete ──────────────────────────────────────────────────────────
window.archiveProject = async function(id) {
  if (!confirm('¿Archivar este proyecto? Dejará de aparecer en la lista activa.')) return;
  const { error } = await supabase
    .from('claude_projects')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { console.error(error); return; }
  closePanel();
  await load();
};

window.deleteProject = async function(id) {
  if (!confirm('¿Eliminar este proyecto permanentemente?')) return;
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
  if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }

  const now = new Date().toISOString();
  const { error } = await supabase.from('claude_projects').insert({
    title,
    prompt,
    log: JSON.stringify([{ ts: now, text: `📁 Proyecto creado` }]),
    active: true,
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Crear Proyecto'; }

  if (error) { console.error('submitNewProject error', error); return; }

  closeNewModal();
  await load();
};

// ── Init ──────────────────────────────────────────────────────────────────────
load();
