// notes.js — Life OS Notes (v10: link task from note view)
// Notes stored in `tasks` table with module='Personal' + notes JSON flag {is_note:true}
// Folders stored in `note_folders` table; folder_id stored in note JSON

import { supabase as sb } from './supabase.js';

const NOTE_MODULE = 'Personal';
const NOTE_FLAG   = '"is_note":true';

// Accent color strips using app CSS variables
const ACCENT_COLORS = {
  none:   { strip: 'transparent',  label: 'None' },
  blue:   { strip: '#2563EB',      label: 'Blue' },
  green:  { strip: '#1A5E3A',      label: 'Green' },
  orange: { strip: '#D97706',      label: 'Orange' },
  coral:  { strip: '#E8563A',      label: 'Coral' },
  purple: { strip: '#7C3AED',      label: 'Purple' },
};

// Folder accent colors (for chip display)
const FOLDER_COLORS = {
  blue:   { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  green:  { bg: '#F0FDF4', text: '#1A5E3A', border: '#BBF7D0' },
  orange: { bg: '#FFF7ED', text: '#D97706', border: '#FED7AA' },
  coral:  { bg: '#FFF1EE', text: '#E8563A', border: '#FECACA' },
  purple: { bg: '#F5F3FF', text: '#7C3AED', border: '#DDD6FE' },
  gray:   { bg: '#F9FAFB', text: '#6B7280', border: '#E5E7EB' },
};

let allNotes   = [];
let allFolders = [];
let activeFolderId = null; // null = "All", 'none' = unfiled
let searchQuery = '';
let activeNoteId = null;
const saveTimeouts = {};

// ── Helpers ──────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return tmp.textContent || '';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffHrs = diffMs / 3600000;
  if (diffHrs < 1) return 'Hace unos minutos';
  if (diffHrs < 24) return `Hace ${Math.floor(diffHrs)}h`;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return `Hace ${diffDays} días`;
  return d.toLocaleDateString('es', { month: 'short', day: 'numeric' });
}

// ── Load folders ──────────────────────────────────────────────────
async function loadFolders() {
  const { data, error } = await sb
    .from('note_folders')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) { console.error('loadFolders error', error); return; }
  allFolders = data || [];
  renderFolderBar();
}

// ── Load notes ───────────────────────────────────────────────────
async function loadNotes() {
  const { data, error } = await sb
    .from('tasks')
    .select('id, title, notes, created_at, completed_at')
    .eq('module', NOTE_MODULE)
    .like('notes', `%${NOTE_FLAG}%`)
    .eq('status', 'open')
    .order('completed_at', { ascending: false, nullsFirst: false });

  if (error) { console.error('loadNotes error', error); return; }

  allNotes = (data || []).map(row => {
    let meta = {};
    try { meta = JSON.parse(row.notes || '{}'); } catch { meta = {}; }
    return {
      id: row.id,
      title: row.title || '',
      body: meta.body || '',
      color: meta.color || 'none',
      pinned: meta.pinned || false,
      folderId: meta.folder_id || null,
      linkedTaskId: meta.linked_task_id || null,
      created_at: row.created_at,
      updated_at: row.completed_at || row.created_at,
    };
  });

  renderNotes();
  loadLinkedTaskTitles();
}

// ── Folder bar render ─────────────────────────────────────────────
function renderFolderBar() {
  let bar = document.getElementById('folder-bar');
  if (!bar) return;

  const allCount    = allNotes.length;
  const noneCount   = allNotes.filter(n => !n.folderId).length;

  let html = `
    <button class="folder-chip${activeFolderId === null ? ' active' : ''}"
      onclick="setActiveFolder(null)">
      🗂️ Todas <span class="folder-chip-count">${allCount}</span>
    </button>`;

  allFolders.forEach(f => {
    const count = allNotes.filter(n => n.folderId === f.id).length;
    const col = FOLDER_COLORS[f.color] || FOLDER_COLORS.gray;
    const isActive = activeFolderId === f.id;
    html += `
      <button class="folder-chip${isActive ? ' active' : ''}"
        style="${isActive ? `background:${col.bg};color:${col.text};border-color:${col.border}` : ''}"
        onclick="setActiveFolder(${f.id})"
        oncontextmenu="event.preventDefault();openFolderMenu(event,${f.id})">
        ${esc(f.icon)} ${esc(f.name)} <span class="folder-chip-count">${count}</span>
      </button>`;
  });

  if (noneCount > 0 || allFolders.length > 0) {
    html += `
      <button class="folder-chip${activeFolderId === 'none' ? ' active' : ''}"
        onclick="setActiveFolder('none')">
        📄 Sin carpeta <span class="folder-chip-count">${noneCount}</span>
      </button>`;
  }

  html += `
    <button class="folder-chip folder-chip-add" onclick="openCreateFolderModal()" title="Nueva carpeta">
      + Carpeta
    </button>`;

  bar.innerHTML = html;
}

// ── Render (full list rebuild) ────────────────────────────────────
function renderNotes() {
  const container = document.getElementById('notes-list');
  const countEl   = document.getElementById('notes-count');

  const q = searchQuery.toLowerCase();
  let visible = allNotes;

  // Filter by folder
  if (activeFolderId === null) {
    // show all
  } else if (activeFolderId === 'none') {
    visible = visible.filter(n => !n.folderId);
  } else {
    visible = visible.filter(n => n.folderId === activeFolderId);
  }

  // Filter by search
  if (q) {
    visible = visible.filter(n => n.title.toLowerCase().includes(q) || stripHtml(n.body).toLowerCase().includes(q));
  }

  countEl.textContent = visible.length ? `${visible.length} nota${visible.length !== 1 ? 's' : ''}` : '';

  if (!visible.length) {
    container.innerHTML = `<div class="notes-empty"><div class="empty-icon">📝</div><p>Toca + para crear tu primera nota</p></div>`;
    renderFolderBar();
    return;
  }

  const pinned = visible.filter(n => n.pinned);
  const others  = visible.filter(n => !n.pinned);

  let html = '';
  if (pinned.length) {
    html += `<div class="notes-section-label">📌 Fijadas</div>`;
    html += `<div class="notes-list-stack">${pinned.map(n => noteCardHtml(n)).join('')}</div>`;
  }
  if (others.length) {
    if (pinned.length) html += `<div class="notes-section-label" style="margin-top:16px">Notas</div>`;
    html += `<div class="notes-list-stack">${others.map(n => noteCardHtml(n)).join('')}</div>`;
  }

  container.innerHTML = html;
  renderFolderBar();

  if (activeNoteId) expandCardDOM(activeNoteId);
}

function noteCardHtml(note) {
  const accentColor = ACCENT_COLORS[note.color]?.strip || 'transparent';
  const bodyText = stripHtml(note.body);
  const bodyPreview = bodyText ? bodyText.substring(0, 90) + (bodyText.length > 90 ? '…' : '') : '';

  // Folder badge for collapsed view
  const folder = note.folderId ? allFolders.find(f => f.id === note.folderId) : null;
  const folderBadge = folder
    ? `<span class="note-folder-badge" style="background:${(FOLDER_COLORS[folder.color]||FOLDER_COLORS.gray).bg};color:${(FOLDER_COLORS[folder.color]||FOLDER_COLORS.gray).text}">${esc(folder.icon)} ${esc(folder.name)}</span>`
    : '';

  // Build folder selector options
  const folderOptions = [
    `<option value="">Sin carpeta</option>`,
    ...allFolders.map(f => `<option value="${f.id}" ${note.folderId === f.id ? 'selected' : ''}>${esc(f.icon)} ${esc(f.name)}</option>`)
  ].join('');

  return `
    <div class="note-card${note.pinned ? ' pinned-card' : ''}"
         id="note-card-${note.id}"
         onclick="handleCardClick(event, '${note.id}')">

      ${accentColor !== 'transparent' ? `<div class="note-card-accent" style="background:${accentColor}"></div>` : ''}

      <!-- Collapsed row -->
      <div class="note-card-collapsed">
        <div class="note-collapsed-text">
          <div class="note-collapsed-title">${note.title ? esc(note.title) : '<span style="color:var(--gray-400);font-style:italic">Sin título</span>'}</div>
          ${bodyPreview ? `<div class="note-collapsed-body">${esc(bodyPreview)}</div>` : ''}
          <div style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap" onclick="event.stopPropagation()">
            ${folderBadge ? folderBadge : ''}
            <select class="note-folder-select-collapsed"
              style="font-size:11px;padding:2px 5px;border:1px solid var(--gray-200);border-radius:6px;background:var(--white);color:var(--gray-500);cursor:pointer;max-width:110px"
              onchange="event.stopPropagation();setNoteFolder('${note.id}', this.value);this.blur()"
              onclick="event.stopPropagation()"
              title="Cambiar carpeta">
              <option value="">📁 Carpeta</option>
              <option value="">Sin carpeta</option>
              ${allFolders.map(f => `<option value="${f.id}" ${note.folderId === f.id ? 'selected' : ''}>${esc(f.icon)} ${esc(f.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="note-collapsed-meta">
          ${note.pinned ? '<span class="note-pin-badge">📌</span>' : ''}
          <span class="note-meta-date">${fmtDate(note.updated_at)}</span>
          <button class="note-copy-quick" title="Copiar nota"
            onclick="event.stopPropagation();copyNote('${note.id}',this)">📋</button>
        </div>
      </div>

      <!-- Expanded editor -->
      <div class="note-card-expanded">
        <input type="text" class="note-edit-title"
          id="note-title-${note.id}"
          value="${esc(note.title)}"
          placeholder="Título"
          oninput="scheduleSaveNote('${note.id}')"
          onclick="event.stopPropagation()">

        <!-- Rich text formatting bar -->
        <div class="note-fmt-bar" onclick="event.stopPropagation()">
          <button class="fmt-btn" onmousedown="event.preventDefault();fmtCmd('bold')" title="Bold"><b>B</b></button>
          <button class="fmt-btn" onmousedown="event.preventDefault();fmtCmd('italic')" title="Italic"><i>I</i></button>
          <button class="fmt-btn" onmousedown="event.preventDefault();fmtCmd('underline')" title="Underline"><u>U</u></button>
          <div class="fmt-divider"></div>
          <button class="fmt-btn" onmousedown="event.preventDefault();fmtFontSize('small')" title="Small">S</button>
          <button class="fmt-btn fmt-btn-active" onmousedown="event.preventDefault();fmtFontSize('normal')" title="Normal">M</button>
          <button class="fmt-btn" onmousedown="event.preventDefault();fmtFontSize('large')" title="Large">L</button>
          <div class="fmt-divider"></div>
          <button class="fmt-btn" onmousedown="event.preventDefault();fmtCmd('insertUnorderedList')" title="Bullet list">•</button>
          <button class="fmt-btn" onmousedown="event.preventDefault();fmtCmd('removeFormat')" title="Clear format">✕</button>
        </div>

        <!-- contenteditable body -->
        <div class="note-edit-body"
          id="note-body-${note.id}"
          contenteditable="true"
          data-placeholder="Escribe una nota... (prueba /task o /note)"
          oninput="detectSlashCommand('${note.id}', event)"
          onclick="event.stopPropagation()">${note.body || ''}</div>

        <div class="note-edit-toolbar" onclick="event.stopPropagation()">
          <div class="note-color-row" onclick="event.stopPropagation()">
            ${Object.entries(ACCENT_COLORS).map(([key, cfg]) => `
              <div class="note-color-swatch${note.color === key ? ' active' : ''}"
                   style="background:${cfg.strip === 'transparent' ? 'var(--gray-100)' : cfg.strip};${key==='none'?'border:1.5px dashed var(--gray-400);':''}"
                   title="${cfg.label}"
                   onclick="event.stopPropagation();setNoteColor('${note.id}','${key}')"></div>
            `).join('')}
          </div>
          <div class="note-toolbar-actions">
            <!-- Folder selector -->
            <select class="note-folder-select"
              id="note-folder-sel-${note.id}"
              onchange="setNoteFolder('${note.id}', this.value)"
              onclick="event.stopPropagation()"
              title="Mover a carpeta">
              ${folderOptions}
            </select>
            <button class="note-tool-btn" onclick="toggleNotePin('${note.id}')" title="${note.pinned ? 'Desfijar' : 'Fijar'}">
              ${note.pinned ? '📌' : '📍'}
            </button>
            <button class="note-tool-btn" onclick="copyNote('${note.id}')" title="Copiar nota">
              📋
            </button>
            <button class="note-tool-btn" onclick="deleteNote('${note.id}')" title="Eliminar" style="color:var(--coral)">
              🗑️
            </button>
            <button class="note-tool-btn note-done-btn" onclick="collapseCard('${note.id}')">
              ✓ Listo
            </button>
          </div>
          <!-- Linked task row -->
          <div class="note-linked-task-row" id="note-linked-task-row-${note.id}" onclick="event.stopPropagation()">
            ${note.linkedTaskId
              ? `<div class="note-linked-task-badge" id="note-linked-task-badge-${note.id}">
                   <span>🔗 Cargando tarea...</span>
                   <button class="note-linked-task-clear" onclick="clearLinkedTask('${note.id}')">✕</button>
                 </div>`
              : `<button class="note-link-task-btn" onclick="openLinkTaskPicker('${note.id}')">🔗 Vincular tarea</button>`
            }
          </div>
        </div>
      </div>

    </div>`;
}

// ── Rich text commands ────────────────────────────────────────────
window.fmtCmd = function(cmd) {
  document.execCommand(cmd, false, null);
  if (activeNoteId) scheduleSaveNote(activeNoteId);
};

const FONT_SIZES = { small: '1', normal: '3', large: '5' };
window.fmtFontSize = function(size) {
  document.execCommand('fontSize', false, FONT_SIZES[size] || '3');
  if (activeNoteId) scheduleSaveNote(activeNoteId);
};

// ── Auto bullet detection ─────────────────────────────────────────
function tryAutoBullet(noteId, event) {
  const bodyEl = document.getElementById(`note-body-${noteId}`);
  if (!bodyEl) return false;

  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;

  const text = node.textContent || '';
  const offset = range.startOffset;

  if (offset < 2) return false;
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineText = before.slice(lineStart);

  if (lineText === '- ') {
    node.textContent = text.slice(0, offset - 2) + text.slice(offset);
    const r = document.createRange();
    r.setStart(node, Math.max(0, offset - 2));
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand('insertUnorderedList', false, null);
    scheduleSaveNote(noteId);
    return true;
  }
  return false;
}

// ── Slash Command Detection ───────────────────────────────────────
let slashPopupActive = false;

function getCurrentLineText(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return '';
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const text = node.textContent || '';
  const offset = range.startOffset;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return text.slice(lineStart, offset);
}

function removeSlashCommand(el, cmd) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return '';
  const range = sel.getRangeAt(0).cloneRange();
  const node = range.startContainer;
  const text = node.textContent || '';
  const offset = range.startOffset;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineText = text.slice(lineStart, offset);
  const cmdIdx = lineText.lastIndexOf(cmd);
  if (cmdIdx === -1) return lineText.replace(cmd, '').trim();

  const newText = text.slice(0, lineStart + cmdIdx) + text.slice(lineStart + cmdIdx + cmd.length);
  const remainder = lineText.slice(0, cmdIdx) + lineText.slice(cmdIdx + cmd.length);
  node.textContent = newText;
  const newOffset = lineStart + cmdIdx;
  const newRange = document.createRange();
  newRange.setStart(node, Math.min(newOffset, node.textContent.length));
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  return remainder.trim();
}

function showSlashPopup(cmd, lineText, bodyEl) {
  dismissSlashPopup();
  slashPopupActive = true;

  const popup = document.createElement('div');
  popup.id = 'slash-popup';
  popup.style.cssText = `
    position:fixed;z-index:800;background:var(--white);
    border:1px solid var(--gray-200);border-radius:12px;
    box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:14px;
    width:min(320px, 90vw);
  `;
  popup.style.left = '50%';
  popup.style.transform = 'translateX(-50%)';
  popup.style.bottom = '120px';

  if (cmd === '/task') {
    const cats = JSON.parse(localStorage.getItem('tasks-cat-order') || 'null') || ['RT', 'TOV', 'Personal', 'Health', 'LifeOS'];
    popup.innerHTML = `
      <div style="font-size:14px;font-weight:700;color:var(--gray-800);margin-bottom:4px">✅ Crear tarea</div>
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">
        "${lineText.replace(cmd,'').trim() || '(contenido del mismo renglón)'}"
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--gray-600);margin-bottom:6px">Categoría:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${cats.map(c => `<button class="btn btn-sm btn-ghost slash-cat-btn"
          data-cat="${esc(c)}" style="border-radius:20px">${c}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" id="slash-confirm-btn" style="flex:1;opacity:0.5;cursor:default" disabled>Crear tarea</button>
        <button class="btn btn-sm btn-ghost" onclick="dismissSlashPopup()">Cancelar</button>
      </div>`;

    let selectedCat = null;
    popup.querySelectorAll('.slash-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        popup.querySelectorAll('.slash-cat-btn').forEach(b => { b.style.background=''; b.style.color=''; });
        btn.style.background = 'var(--blue)'; btn.style.color = 'white';
        selectedCat = btn.dataset.cat;
        const confirmBtn = popup.querySelector('#slash-confirm-btn');
        confirmBtn.disabled = false; confirmBtn.style.opacity = '1'; confirmBtn.style.cursor = 'pointer';
      });
    });

    popup.querySelector('#slash-confirm-btn').addEventListener('click', async () => {
      if (!selectedCat) return;
      const content = removeSlashCommand(bodyEl, cmd);
      const taskTitle = content || (lineText.replace(cmd,'').trim()) || 'Nueva tarea';
      await createTaskFromNote(taskTitle, selectedCat);
      dismissSlashPopup();
    });

  } else if (cmd === '/note') {
    const noteContent = lineText.replace(cmd, '').trim();
    popup.innerHTML = `
      <div style="font-size:14px;font-weight:700;color:var(--gray-800);margin-bottom:4px">📝 Agregar nota como…</div>
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">
        "${esc(noteContent) || '(contenido del mismo renglón)'}"
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-ghost slash-note-type-btn" data-type="universal" style="justify-content:flex-start;text-align:left;padding:10px 12px;border-radius:10px">
          📋 <strong>Universal</strong> — aparece en todas las clases
        </button>
        <button class="btn btn-ghost slash-note-type-btn" data-type="class" style="justify-content:flex-start;text-align:left;padding:10px 12px;border-radius:10px">
          🏫 <strong>Nota de clase</strong> — elige una clase específica
        </button>
        <button class="btn btn-ghost slash-note-type-btn" data-type="student" style="justify-content:flex-start;text-align:left;padding:10px 12px;border-radius:10px">
          👤 <strong>Nota de alumno</strong> — elige alumno y clase
        </button>
        <button class="btn btn-sm btn-ghost" id="slash-note-cancel-btn">Cancelar</button>
      </div>`;

    popup.querySelectorAll('.slash-note-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.openSlashNoteFlow(btn.dataset.type, noteContent);
      });
    });
    popup.querySelector('#slash-note-cancel-btn').addEventListener('click', () => dismissSlashPopup());
    setTimeout(() => removeSlashCommand(bodyEl, cmd), 0);
  }

  document.body.appendChild(popup);
}

window.dismissSlashPopup = function() {
  document.getElementById('slash-popup')?.remove();
  slashPopupActive = false;
};

window.detectSlashCommand = function(noteId, event) {
  const bodyEl = document.getElementById(`note-body-${noteId}`);
  if (!bodyEl) return;

  if (event && event.inputType === 'insertText' && event.data === ' ') {
    if (tryAutoBullet(noteId, event)) return;
  }

  scheduleSaveNote(noteId);

  if (slashPopupActive) return;

  const line = getCurrentLineText(bodyEl);

  if (line.endsWith('/task')) {
    showSlashPopup('/task', line, bodyEl);
  } else if (line.endsWith('/note')) {
    showSlashPopup('/note', line, bodyEl);
  }
};

// ── Create task from note ─────────────────────────────────────────
async function createTaskFromNote(title, category) {
  const storeMod = category === 'RT Admin' ? 'RT' : category;
  const notesJson = category === 'RT Admin' ? JSON.stringify({ rt_admin: true }) : null;
  const { error } = await sb.from('tasks').insert({
    title, module: storeMod, notes: notesJson, status: 'open', priority: 'normal',
  });
  if (error) { alert('Error creating task: ' + error.message); return; }
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a5e3a;color:white;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;z-index:900;pointer-events:none';
  toast.textContent = `✅ Tarea "${title}" → ${category}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ── /note slash command flow ──────────────────────────────────────
window.openSlashNoteFlow = async function(type, content) {
  dismissSlashPopup();

  if (type === 'universal') {
    const now = new Date().toISOString();
    const { error } = await sb.from('tasks').insert({
      title: content.slice(0, 80) || 'Nota universal',
      notes: JSON.stringify({ is_universal_class_note: true, body: content }),
      module: 'LifeOS', priority: 'normal', status: 'open', completed_at: now,
    });
    if (error) { alert('Error: ' + error.message); return; }
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#7c3aed;color:white;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;z-index:900;pointer-events:none';
    t.textContent = '📋 Nota universal guardada';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
    return;
  }

  const { data: classes } = await sb.from('classes').select('id,name').order('name');
  if (!classes?.length) { alert('No classes found'); return; }

  const modal = document.createElement('div');
  modal.id = 'slash-note-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:850;display:flex;align-items:flex-end;justify-content:center';

  if (type === 'class') {
    modal.innerHTML = `
      <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:600px;max-height:70vh;overflow-y:auto">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px">🏫 Selecciona una clase</div>
        <div style="font-size:12px;color:var(--gray-400);margin-bottom:12px">"${esc(content)}"</div>
        ${classes.map(c => `
          <button class="btn btn-ghost" style="width:100%;justify-content:flex-start;padding:10px 12px;margin-bottom:6px;border-radius:10px"
            onclick="saveSlashClassNote(${c.id}, ${JSON.stringify(content)})">
            ${esc(c.name)}
          </button>`).join('')}
        <button class="btn btn-sm btn-ghost" style="width:100%;margin-top:4px" onclick="document.getElementById('slash-note-modal').remove()">Cancelar</button>
      </div>`;
  } else {
    modal.innerHTML = `
      <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:600px;max-height:70vh;overflow-y:auto">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px">👤 Selecciona una clase</div>
        <div style="font-size:12px;color:var(--gray-400);margin-bottom:12px">Primero elige la clase del alumno</div>
        ${classes.map(c => `
          <button class="btn btn-ghost" style="width:100%;justify-content:flex-start;padding:10px 12px;margin-bottom:6px;border-radius:10px"
            onclick="pickStudentForSlashNote(${c.id}, ${JSON.stringify(c.name)}, ${JSON.stringify(content)})">
            ${esc(c.name)}
          </button>`).join('')}
        <button class="btn btn-sm btn-ghost" style="width:100%;margin-top:4px" onclick="document.getElementById('slash-note-modal').remove()">Cancelar</button>
      </div>`;
  }

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
};

window.saveSlashClassNote = async function(classId, content) {
  document.getElementById('slash-note-modal')?.remove();
  const { error } = await sb.from('class_overview_notes').insert({ class_id: Number(classId), note: content });
  if (error) { alert('Error: ' + error.message); return; }
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a5e3a;color:white;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;z-index:900;pointer-events:none';
  t.textContent = '🏫 Nota de clase guardada';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
};

window.pickStudentForSlashNote = async function(classId, className, content) {
  const modal = document.getElementById('slash-note-modal');
  if (!modal) return;
  modal.querySelector('div').innerHTML = `
    <div style="font-size:16px;font-weight:700;margin-bottom:4px">👤 ${esc(className)}</div>
    <div style="font-size:12px;color:var(--gray-400);margin-bottom:8px">Selecciona un alumno</div>
    <div id="slash-student-list" style="text-align:center;padding:16px;color:var(--gray-400);font-size:13px">Cargando...</div>
    <div style="font-size:12px;font-weight:600;color:var(--gray-600);margin:10px 0 6px">Tipo:</div>
    <label style="display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:13px"><input type="checkbox" id="slash-cat-overview"> Resumen (overview)</label>
    <label style="display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:13px"><input type="checkbox" id="slash-cat-todo"> To-do</label>
    <label style="display:flex;gap:6px;align-items:center;margin-bottom:12px;font-size:13px"><input type="checkbox" id="slash-cat-parent"> Contacto de padres</label>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1" onclick="submitSlashStudentNote(${classId}, ${JSON.stringify(content)})">Guardar nota</button>
      <button class="btn btn-ghost" onclick="document.getElementById('slash-note-modal').remove()">Cancelar</button>
    </div>`;

  const { data: enrollments } = await sb.from('class_enrollments')
    .select('students(id, name)')
    .eq('class_id', classId)
    .is('enrolled_until', null);
  const students = (enrollments || []).map(e => e.students).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name));

  const listEl = document.getElementById('slash-student-list');
  if (!listEl) return;
  listEl.innerHTML = students.length
    ? students.map(s => `
        <button class="btn btn-ghost slash-stu-btn" data-id="${s.id}" data-name="${esc(s.name)}"
          style="width:100%;justify-content:flex-start;padding:8px 12px;margin-bottom:4px;border-radius:8px;font-size:13px">
          ${esc(s.name)}
        </button>`).join('')
    : '<div style="font-size:13px;color:var(--gray-400)">No hay alumnos en esta clase</div>';

  let selectedStudentId = null;
  document.querySelectorAll('.slash-stu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.slash-stu-btn').forEach(b => { b.style.background=''; b.style.color=''; });
      btn.style.background = 'var(--blue)'; btn.style.color = 'white';
      selectedStudentId = Number(btn.dataset.id);
    });
  });
  modal._selectedStudentId = () => selectedStudentId;
};

window.submitSlashStudentNote = async function(classId, content) {
  const modal = document.getElementById('slash-note-modal');
  const studentId = modal?._selectedStudentId?.();
  if (!studentId) { alert('Selecciona un alumno'); return; }

  const isOverview = document.getElementById('slash-cat-overview')?.checked;
  const isTodo = document.getElementById('slash-cat-todo')?.checked;
  const isParent = document.getElementById('slash-cat-parent')?.checked;
  const category = isTodo ? 'To-Do' : isParent ? 'Parent Contact' : 'Overview';
  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  const { error } = await sb.from('student_notes').insert({
    student_id: studentId, class_id: Number(classId), note: content, date: now, category,
    followup_needed: false, show_in_overview: isOverview || true,
    is_todo: isTodo || false, tell_parent: isParent || false, logged: false,
  });

  document.getElementById('slash-note-modal')?.remove();
  if (error) { alert('Error: ' + error.message); return; }
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a5e3a;color:white;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;z-index:900;pointer-events:none';
  t.textContent = '👤 Nota de alumno guardada';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
};

// ── Folder management ─────────────────────────────────────────────

window.setActiveFolder = function(folderId) {
  activeFolderId = folderId;
  renderNotes();
};

window.openCreateFolderModal = function() {
  const existingModal = document.getElementById('folder-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'folder-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:850;display:flex;align-items:center;justify-content:center;padding:16px';

  const colorOpts = Object.entries(FOLDER_COLORS).map(([key, col]) => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="radio" name="fcolor" value="${key}" ${key==='blue'?'checked':''} style="accent-color:${col.text}">
      <span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${col.bg};border:2px solid ${col.border}"></span>
      <span style="font-size:12px;color:var(--gray-700)">${key}</span>
    </label>`).join('');

  const quickEmojis = ['📁','📂','⭐','🎯','💡','📚','🎵','💼','🏠','🔥','✨','🌿','💜','🎨','📌','🧠'];

  modal.innerHTML = `
    <div style="background:var(--white);border-radius:16px;padding:24px;width:100%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.18)">
      <div style="font-size:17px;font-weight:700;color:var(--gray-800);margin-bottom:18px">📁 Nueva carpeta</div>

      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:6px">Nombre</label>
        <input id="folder-name-input" type="text" placeholder="Ej: Trabajo, Personal, Ideas…"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:10px;padding:9px 12px;font-size:14px;outline:none;box-sizing:border-box"
          maxlength="40">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:6px">Ícono</label>
        <div id="folder-emoji-val" style="font-size:24px;margin-bottom:6px;text-align:center;cursor:pointer" title="Clic para cambiar">📁</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${quickEmojis.map(e => `<button class="emoji-pick-btn" data-emoji="${e}"
            style="font-size:20px;background:var(--gray-50);border:1.5px solid var(--gray-200);border-radius:8px;padding:4px 6px;cursor:pointer;line-height:1"
            onclick="pickEmoji('${e}')">${e}</button>`).join('')}
        </div>
      </div>

      <div style="margin-bottom:20px">
        <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:8px">Color</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${colorOpts}</div>
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" style="flex:1" onclick="submitCreateFolder()">Crear</button>
        <button class="btn btn-ghost" onclick="document.getElementById('folder-modal').remove()">Cancelar</button>
      </div>
    </div>`;

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  document.getElementById('folder-name-input')?.focus();
};

window.pickEmoji = function(emoji) {
  const display = document.getElementById('folder-emoji-val');
  if (display) {
    display.textContent = emoji;
    display.dataset.selected = emoji;
  }
  // Highlight selected
  document.querySelectorAll('.emoji-pick-btn').forEach(b => {
    b.style.borderColor = b.dataset.emoji === emoji ? 'var(--blue)' : 'var(--gray-200)';
    b.style.background  = b.dataset.emoji === emoji ? 'var(--blue-light)' : 'var(--gray-50)';
  });
};

window.submitCreateFolder = async function() {
  const nameEl  = document.getElementById('folder-name-input');
  const emojiEl = document.getElementById('folder-emoji-val');
  const colorEl = document.querySelector('input[name="fcolor"]:checked');

  const name  = nameEl?.value?.trim();
  const icon  = emojiEl?.dataset.selected || emojiEl?.textContent?.trim() || '📁';
  const color = colorEl?.value || 'blue';

  if (!name) { nameEl?.focus(); return; }

  const sort_order = allFolders.length;
  const { data, error } = await sb.from('note_folders').insert({ name, icon, color, sort_order }).select().single();
  if (error) { alert('Error creando carpeta: ' + error.message); return; }

  document.getElementById('folder-modal')?.remove();
  allFolders.push(data);
  activeFolderId = data.id;
  renderFolderBar();
  renderNotes();
};

window.openFolderMenu = function(event, folderId) {
  // Context menu to edit/delete folder (right-click on chip)
  const existing = document.getElementById('folder-ctx-menu');
  if (existing) existing.remove();

  const folder = allFolders.find(f => f.id === folderId);
  if (!folder) return;

  const menu = document.createElement('div');
  menu.id = 'folder-ctx-menu';
  menu.style.cssText = `
    position:fixed;z-index:900;background:var(--white);
    border:1px solid var(--gray-200);border-radius:12px;
    box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:6px;
    min-width:160px;
  `;
  menu.style.left = Math.min(event.clientX, window.innerWidth - 180) + 'px';
  menu.style.top  = Math.min(event.clientY, window.innerHeight - 120) + 'px';

  menu.innerHTML = `
    <button class="folder-menu-item" onclick="openEditFolderModal(${folderId})">✏️ Editar carpeta</button>
    <button class="folder-menu-item" style="color:var(--coral)" onclick="deleteFolder(${folderId})">🗑️ Eliminar carpeta</button>`;

  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 10);
  document.body.appendChild(menu);
};

window.openEditFolderModal = function(folderId) {
  document.getElementById('folder-ctx-menu')?.remove();
  const folder = allFolders.find(f => f.id === folderId);
  if (!folder) return;

  const quickEmojis = ['📁','📂','⭐','🎯','💡','📚','🎵','💼','🏠','🔥','✨','🌿','💜','🎨','📌','🧠'];
  const colorOpts = Object.entries(FOLDER_COLORS).map(([key, col]) => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="radio" name="fcolor-edit" value="${key}" ${folder.color===key?'checked':''} style="accent-color:${col.text}">
      <span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${col.bg};border:2px solid ${col.border}"></span>
      <span style="font-size:12px;color:var(--gray-700)">${key}</span>
    </label>`).join('');

  const modal = document.createElement('div');
  modal.id = 'folder-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:850;display:flex;align-items:center;justify-content:center;padding:16px';

  modal.innerHTML = `
    <div style="background:var(--white);border-radius:16px;padding:24px;width:100%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.18)">
      <div style="font-size:17px;font-weight:700;color:var(--gray-800);margin-bottom:18px">✏️ Editar carpeta</div>

      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:6px">Nombre</label>
        <input id="folder-name-input" type="text" value="${esc(folder.name)}"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:10px;padding:9px 12px;font-size:14px;outline:none;box-sizing:border-box"
          maxlength="40">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:6px">Ícono</label>
        <div id="folder-emoji-val" data-selected="${esc(folder.icon)}" style="font-size:24px;margin-bottom:6px;text-align:center">${esc(folder.icon)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${quickEmojis.map(e => `<button class="emoji-pick-btn" data-emoji="${e}"
            style="font-size:20px;background:${e===folder.icon?'var(--blue-light)':'var(--gray-50)'};border:1.5px solid ${e===folder.icon?'var(--blue)':'var(--gray-200)'};border-radius:8px;padding:4px 6px;cursor:pointer;line-height:1"
            onclick="pickEmoji('${e}')">${e}</button>`).join('')}
        </div>
      </div>

      <div style="margin-bottom:20px">
        <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:8px">Color</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${colorOpts}</div>
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" style="flex:1" onclick="submitEditFolder(${folderId})">Guardar</button>
        <button class="btn btn-ghost" onclick="document.getElementById('folder-modal').remove()">Cancelar</button>
      </div>
    </div>`;

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
};

window.submitEditFolder = async function(folderId) {
  const nameEl  = document.getElementById('folder-name-input');
  const emojiEl = document.getElementById('folder-emoji-val');
  const colorEl = document.querySelector('input[name="fcolor-edit"]:checked');

  const name  = nameEl?.value?.trim();
  const icon  = emojiEl?.dataset.selected || emojiEl?.textContent?.trim() || '📁';
  const color = colorEl?.value || 'blue';

  if (!name) { nameEl?.focus(); return; }

  const { error } = await sb.from('note_folders').update({ name, icon, color }).eq('id', folderId);
  if (error) { alert('Error: ' + error.message); return; }

  document.getElementById('folder-modal')?.remove();
  const f = allFolders.find(f => f.id === folderId);
  if (f) { f.name = name; f.icon = icon; f.color = color; }
  renderFolderBar();
  renderNotes();
};

window.deleteFolder = async function(folderId) {
  document.getElementById('folder-ctx-menu')?.remove();
  const folder = allFolders.find(f => f.id === folderId);
  if (!folder) return;

  const noteCount = allNotes.filter(n => n.folderId === folderId).length;
  const msg = noteCount
    ? `¿Eliminar la carpeta "${folder.name}"? Las ${noteCount} notas dentro quedarán sin carpeta.`
    : `¿Eliminar la carpeta "${folder.name}"?`;
  if (!confirm(msg)) return;

  // Remove folder_id from notes in this folder
  const affectedNotes = allNotes.filter(n => n.folderId === folderId);
  for (const note of affectedNotes) {
    note.folderId = null;
    await sb.from('tasks').update({
      notes: JSON.stringify({ is_note: true, body: note.body || '', color: note.color || 'none', pinned: note.pinned || false, folder_id: null }),
    }).eq('id', note.id);
  }

  const { error } = await sb.from('note_folders').delete().eq('id', folderId);
  if (error) { alert('Error: ' + error.message); return; }

  allFolders = allFolders.filter(f => f.id !== folderId);
  if (activeFolderId === folderId) activeFolderId = null;
  renderFolderBar();
  renderNotes();
};

// ── Set folder on a note ──────────────────────────────────────────
window.setNoteFolder = async function(noteId, folderIdStr) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;

  const folderId = folderIdStr ? Number(folderIdStr) : null;
  note.folderId = folderId;

  const folderMeta = { is_note: true, body: note.body || '', color: note.color || 'none', pinned: note.pinned || false, folder_id: folderId };
  if (note.linkedTaskId) folderMeta.linked_task_id = note.linkedTaskId;
  await sb.from('tasks').update({
    notes: JSON.stringify(folderMeta),
  }).eq('id', noteId);

  renderFolderBar();
};

// ── Expand / collapse ─────────────────────────────────────────────
function expandCardDOM(noteId) {
  const card = document.getElementById(`note-card-${noteId}`);
  if (!card) return;
  card.classList.add('expanded');
  setTimeout(() => {
    const bodyEl = document.getElementById(`note-body-${noteId}`);
    if (bodyEl) bodyEl.focus();
  }, 30);
}

window.handleCardClick = function(event, noteId) {
  if (event.target.closest('.note-edit-toolbar') ||
      event.target.closest('.note-card-expanded') ||
      event.target.closest('.note-fmt-bar')) return;
  if (activeNoteId === noteId) return;

  if (activeNoteId) {
    const prev = document.getElementById(`note-card-${activeNoteId}`);
    if (prev) prev.classList.remove('expanded');
    clearTimeout(saveTimeouts[activeNoteId]);
    saveNote(activeNoteId);
  }

  activeNoteId = noteId;
  expandCardDOM(noteId);
};

window.collapseCard = async function(noteId) {
  clearTimeout(saveTimeouts[noteId]);
  await saveNote(noteId);
  const card = document.getElementById(`note-card-${noteId}`);
  if (card) card.classList.remove('expanded');
  activeNoteId = null;
  await loadNotes();
};

document.addEventListener('click', async (e) => {
  if (!activeNoteId) return;
  const activeCard = document.getElementById(`note-card-${activeNoteId}`);
  if (activeCard && !activeCard.contains(e.target) && !e.target.closest('.fab') && !e.target.closest('#folder-bar')) {
    clearTimeout(saveTimeouts[activeNoteId]);
    await saveNote(activeNoteId);
    activeCard.classList.remove('expanded');
    activeNoteId = null;
    await loadNotes();
  }
});

// ── Save note ─────────────────────────────────────────────────────
window.scheduleSaveNote = function(noteId) {
  clearTimeout(saveTimeouts[noteId]);
  saveTimeouts[noteId] = setTimeout(() => saveNote(noteId), 800);
};

async function saveNote(noteId) {
  const titleEl = document.getElementById(`note-title-${noteId}`);
  const bodyEl  = document.getElementById(`note-body-${noteId}`);
  if (!titleEl && !bodyEl) return;

  const title   = titleEl?.value?.trim() || '';
  const bodyHtml = bodyEl?.innerHTML?.trim() || '';
  const bodyText = stripHtml(bodyHtml);
  if (!title && !bodyText) return;

  const existing      = allNotes.find(n => n.id === noteId);
  const color         = existing?.color        || 'none';
  const pinned        = existing?.pinned        || false;
  const folderId      = existing?.folderId      ?? null;
  const linkedTaskId  = existing?.linkedTaskId  ?? null;
  const now           = new Date().toISOString();

  const metaJson = { is_note: true, body: bodyHtml, color, pinned, folder_id: folderId };
  if (linkedTaskId) metaJson.linked_task_id = linkedTaskId;

  const { error } = await sb.from('tasks').update({
    title: title || 'Sin título',
    notes: JSON.stringify(metaJson),
    completed_at: now,
  }).eq('id', noteId);

  if (error) { console.error('saveNote error', error); return; }

  if (existing) {
    existing.title = title;
    existing.body  = bodyHtml;
    existing.updated_at = now;
    existing.color  = color;
    existing.pinned = pinned;
    existing.folderId = folderId;
  }
}

// ── Create new note ───────────────────────────────────────────────
window.createNewNote = async function() {
  const now = new Date().toISOString();
  // Pre-assign to active folder if one is selected
  const folderId = (activeFolderId !== null && activeFolderId !== 'none') ? activeFolderId : null;

  const { data, error } = await sb.from('tasks').insert({
    title: '',
    notes: JSON.stringify({ is_note: true, body: '', color: 'none', pinned: false, folder_id: folderId }),
    module: NOTE_MODULE,
    priority: 'normal',
    status: 'open',
    completed_at: now,
    due_date: null,
  }).select().single();

  if (error) { console.error('createNewNote error', error); return; }

  const newNote = {
    id: data.id, title: '', body: '', color: 'none', pinned: false, folderId,
    created_at: data.created_at, updated_at: data.completed_at,
  };
  allNotes.unshift(newNote);

  if (activeNoteId) {
    const prev = document.getElementById(`note-card-${activeNoteId}`);
    if (prev) prev.classList.remove('expanded');
    activeNoteId = null;
  }

  activeNoteId = data.id;
  renderNotes();

  setTimeout(() => {
    const titleEl = document.getElementById(`note-title-${data.id}`);
    if (titleEl) titleEl.focus();
  }, 40);
};

// ── Set color ─────────────────────────────────────────────────────
window.setNoteColor = async function(noteId, color) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;

  if (saveTimeouts[noteId]) {
    clearTimeout(saveTimeouts[noteId]);
    await saveNote(noteId);
  }

  note.color = color;

  const colorMeta = { is_note: true, body: note.body || '', color, pinned: note.pinned || false, folder_id: note.folderId ?? null };
  if (note.linkedTaskId) colorMeta.linked_task_id = note.linkedTaskId;
  await sb.from('tasks').update({ notes: JSON.stringify(colorMeta) }).eq('id', noteId);

  const card = document.getElementById(`note-card-${noteId}`);
  if (card) {
    let strip = card.querySelector('.note-card-accent');
    const accentColor = ACCENT_COLORS[color]?.strip || 'transparent';
    if (accentColor !== 'transparent') {
      if (!strip) {
        strip = document.createElement('div');
        strip.className = 'note-card-accent';
        card.prepend(strip);
      }
      strip.style.background = accentColor;
    } else {
      if (strip) strip.remove();
    }
    card.querySelectorAll('.note-color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.title === ACCENT_COLORS[color]?.label);
    });
  }
};

// ── Pin/unpin ─────────────────────────────────────────────────────
window.toggleNotePin = async function(noteId) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;

  if (saveTimeouts[noteId]) {
    clearTimeout(saveTimeouts[noteId]);
    await saveNote(noteId);
  }

  const newPinned = !note.pinned;
  note.pinned = newPinned;

  const pinMeta = { is_note: true, body: note.body || '', color: note.color || 'none', pinned: newPinned, folder_id: note.folderId ?? null };
  if (note.linkedTaskId) pinMeta.linked_task_id = note.linkedTaskId;
  await sb.from('tasks').update({ notes: JSON.stringify(pinMeta) }).eq('id', noteId);

  renderNotes();
};

// ── Copy note to clipboard ────────────────────────────────────────
window.copyNote = function(noteId, refBtn) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;

  const titlePart = note.title ? note.title + '\n' + '─'.repeat(Math.min(note.title.length, 40)) + '\n' : '';
  const bodyPart = stripHtml(note.body);
  const fullText = (titlePart + bodyPart).trim();

  const flashBtn = (btn, success) => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = success ? '✅' : '❌';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  };

  // Find copy button for this note (quick copy or toolbar copy)
  const targetBtn = refBtn
    || document.querySelector(`#note-card-${noteId} .note-copy-quick`)
    || document.querySelector(`#note-card-${noteId} .note-tool-btn[title="Copiar nota"]`);

  const showToast = (msg, color) => {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${color};color:white;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;z-index:900;pointer-events:none`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullText).then(() => {
      flashBtn(targetBtn, true);
      showToast('✅ Nota copiada', '#1A5E3A');
    }).catch(() => {
      // Fallback for iOS/Safari
      _copyFallback(fullText, targetBtn, showToast);
    });
  } else {
    _copyFallback(fullText, targetBtn, showToast);
  }
};

function _copyFallback(text, btn, showToast) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) {
      if (btn) { const orig = btn.textContent; btn.textContent = '✅'; setTimeout(() => { btn.textContent = orig; }, 1500); }
      showToast('✅ Nota copiada', '#1A5E3A');
    } else {
      showToast('⚠️ No se pudo copiar', '#e8563a');
    }
  } catch {
    showToast('⚠️ No se pudo copiar', '#e8563a');
  }
}

// ── Delete note (instant DOM removal) ────────────────────────────
window.deleteNote = async function(noteId) {
  if (!confirm('¿Eliminar esta nota?')) return;
  // Remove from DOM immediately for snappy UX
  const card = document.getElementById(`note-card-${noteId}`);
  if (card) card.remove();
  allNotes = allNotes.filter(n => n.id !== noteId);
  if (activeNoteId === noteId) activeNoteId = null;
  const countEl = document.getElementById('notes-count');
  if (countEl) countEl.textContent = allNotes.length ? `${allNotes.length} nota${allNotes.length !== 1 ? 's' : ''}` : '';
  if (!allNotes.length) renderNotes();
  renderFolderBar();
  // Persist deletion — await so errors are caught and the note doesn't ghost back
  const { error } = await sb.from('tasks').delete().eq('id', noteId);
  if (error) {
    console.error('deleteNote error', error);
    // Re-add note to allNotes and re-render so it isn't silently lost
    await loadNotes();
  }
};

// ── Search ────────────────────────────────────────────────────────
window.filterNotes = function(q) {
  searchQuery = q;
  renderNotes();
};

// ── Global: dismiss popups on Escape ─────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && slashPopupActive) window.dismissSlashPopup();
});

// ── Link Task Picker ──────────────────────────────────────────────

/** Load linked task title into badge after note cards render */
async function loadLinkedTaskTitles() {
  const notesWithLinks = allNotes.filter(n => n.linkedTaskId);
  if (!notesWithLinks.length) return;
  const ids = notesWithLinks.map(n => n.linkedTaskId);
  // Fetch titles in one query
  const { data: tasks } = await sb.from('tasks')
    .select('id, title')
    .in('id', ids);
  const titleMap = {};
  (tasks || []).forEach(t => { titleMap[t.id] = t.title; });

  notesWithLinks.forEach(n => {
    const badge = document.getElementById(`note-linked-task-badge-${n.id}`);
    if (badge) {
      const title = titleMap[n.linkedTaskId] || 'Tarea';
      badge.innerHTML = `<span>🔗 ${title.replace(/</g,'&lt;').slice(0, 40)}</span><button class="note-linked-task-clear" onclick="clearLinkedTask('${n.id}')">✕</button>`;
    }
  });
}

/** Open task picker for a note */
window.openLinkTaskPicker = async function(noteId) {
  document.getElementById('task-link-picker')?.remove();

  // Fetch open tasks (non-note)
  const { data: tasks } = await sb.from('tasks')
    .select('id, title, module, notes')
    .eq('status', 'open')
    .not('notes', 'like', '%"is_note":true%')
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (tasks || []).map(t => {
    const safeTitle = (t.title || 'Sin título').replace(/</g,'&lt;');
    const mod = t.module || '';
    return `<div class="task-link-row" onclick="_selectLinkedTask('${noteId}', ${t.id}, this.dataset.title)" data-title="${safeTitle}">
      <span style="font-weight:600;font-size:14px">${safeTitle}</span>
      ${mod ? `<span style="font-size:11px;color:var(--gray-400);margin-left:6px">${mod}</span>` : ''}
    </div>`;
  }).join('');

  const picker = document.createElement('div');
  picker.id = 'task-link-picker';
  picker.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:700;display:flex;align-items:flex-end;justify-content:center';
  picker.innerHTML = `
    <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:600px;max-height:75vh;display:flex;flex-direction:column">
      <div style="font-size:16px;font-weight:700;margin-bottom:12px">🔗 Vincular una tarea</div>
      <div style="overflow-y:auto;flex:1">${rows || '<div style="color:var(--gray-400);text-align:center;padding:20px">No hay tareas abiertas</div>'}</div>
      <button class="btn btn-ghost" style="margin-top:12px" onclick="document.getElementById(\'task-link-picker\').remove()">Cancelar</button>
    </div>`;

  if (!document.getElementById('task-link-picker-style')) {
    const s = document.createElement('style');
    s.id = 'task-link-picker-style';
    s.textContent = '.task-link-row{padding:10px 12px;border-radius:10px;cursor:pointer;margin-bottom:4px;border:1.5px solid var(--gray-100);}.task-link-row:hover{background:var(--gray-50);border-color:var(--blue);}';
    document.head.appendChild(s);
  }

  picker.addEventListener('click', e => { if (e.target === picker) picker.remove(); });
  document.body.appendChild(picker);
};

window._selectLinkedTask = async function(noteId, taskId, taskTitle) {
  document.getElementById('task-link-picker')?.remove();
  const note = allNotes.find(n => n.id == noteId);
  if (!note) return;
  note.linkedTaskId = taskId;

  // Update note JSON in DB
  const metaJson = { is_note: true, body: note.body || '', color: note.color || 'none', pinned: note.pinned || false, folder_id: note.folderId ?? null, linked_task_id: taskId };
  await sb.from('tasks').update({ notes: JSON.stringify(metaJson) }).eq('id', note.id);

  // Also update task's linked_note_id
  const { data: taskRow } = await sb.from('tasks').select('notes').eq('id', taskId).single();
  let taskMeta = {};
  try { taskMeta = JSON.parse(taskRow?.notes || '{}'); } catch {}
  taskMeta.linked_note_id = typeof note.id === 'number' ? note.id : parseInt(note.id);
  await sb.from('tasks').update({ notes: JSON.stringify(taskMeta) }).eq('id', taskId);

  // Update badge in DOM
  const row = document.getElementById(`note-linked-task-row-${note.id}`);
  if (row) {
    row.innerHTML = `<div class="note-linked-task-badge" id="note-linked-task-badge-${note.id}"><span>🔗 ${(taskTitle||'Tarea').replace(/</g,'&lt;').slice(0,40)}</span><button class="note-linked-task-clear" onclick="clearLinkedTask('${note.id}')">✕</button></div>`;
  }
};

window.clearLinkedTask = async function(noteId) {
  const note = allNotes.find(n => n.id == noteId);
  if (!note) return;
  const oldTaskId = note.linkedTaskId;
  note.linkedTaskId = null;

  const metaJson = { is_note: true, body: note.body || '', color: note.color || 'none', pinned: note.pinned || false, folder_id: note.folderId ?? null };
  await sb.from('tasks').update({ notes: JSON.stringify(metaJson) }).eq('id', note.id);

  // Clear linked_note_id from old task
  if (oldTaskId) {
    const { data: taskRow } = await sb.from('tasks').select('notes').eq('id', oldTaskId).single();
    let taskMeta = {};
    try { taskMeta = JSON.parse(taskRow?.notes || '{}'); } catch {}
    delete taskMeta.linked_note_id;
    await sb.from('tasks').update({ notes: JSON.stringify(taskMeta) }).eq('id', oldTaskId);
  }

  // Reset to button
  const row = document.getElementById(`note-linked-task-row-${note.id}`);
  if (row) row.innerHTML = `<button class="note-link-task-btn" onclick="openLinkTaskPicker('${note.id}')">🔗 Vincular tarea</button>`;
};

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  await loadFolders();
  await loadNotes();
}
init();
