// notes.js — Life OS Notes page (v2: Google Keep style, multi-note view)
// Notes stored in `tasks` table with module='Personal' + notes JSON flag {is_note:true}
// title → title, body/color/pinned → notes JSON field, priority='normal', status='open'

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://kxsuzgpnvtepsyhkezin.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c3V6Z3BudnRlcHN5aGtlemluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3Nzc1MDAsImV4cCI6MjA4NzM1MzUwMH0.oKtpiH63heyK-wJ87ZRvkhUzRqy6NT6Z2XWF1xjbtxA';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// Notes use module='Personal' + notes JSON contains "is_note":true
// This avoids the tasks_module_check constraint that blocks '__note__'
const NOTE_MODULE = 'Personal';
const NOTE_FLAG   = '"is_note":true';

const COLOR_MAP = {
  yellow: '#FFF9C4',
  white:  '#FFFFFF',
  blue:   '#BBDEFB',
  green:  '#C8E6C9',
  pink:   '#F8BBD9',
  orange: '#FFE0B2',
  purple: '#E1BEE7',
  teal:   '#B2DFDB',
};

let allNotes = [];
let searchQuery = '';
// Track which note card is currently "expanded" for editing (null = none)
let activeNoteId = null;
// Track per-note save timeouts
const saveTimeouts = {};

// ── Load notes ─────────────────────────────────────────────────
async function loadNotes() {
  const { data, error } = await sb
    .from('tasks')
    .select('id, title, notes, priority, status, created_at, completed_at')
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
      color: meta.color || 'yellow',   // color stored in notes JSON (priority field is reserved for task priority)
      pinned: meta.pinned || false,    // pinned stored in notes JSON (status field only allows 'open'/'done')
      created_at: row.created_at,
      updated_at: row.completed_at || row.created_at,
    };
  });

  renderNotes();
}

// ── Render all notes as Keep-style cards ──────────────────────
function renderNotes() {
  const container = document.getElementById('notes-list');
  const countEl   = document.getElementById('notes-count');

  const q = searchQuery.toLowerCase();
  const visible = q
    ? allNotes.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
    : allNotes;

  countEl.textContent = visible.length ? `${visible.length} nota${visible.length !== 1 ? 's' : ''}` : '';

  const pinned = visible.filter(n => n.pinned);
  const others = visible.filter(n => !n.pinned);

  let html = '';

  if (!visible.length) {
    html = `<div class="notes-empty"><div class="empty-icon">📝</div><p>Toca + para crear tu primera nota</p></div>`;
  } else {
    if (pinned.length) {
      if (others.length) html += `<div class="notes-section-label">📌 Fijadas</div>`;
      html += `<div class="notes-masonry">${pinned.map(n => noteCardHtml(n)).join('')}</div>`;
    }
    if (others.length) {
      if (pinned.length) html += `<div class="notes-section-label" style="margin-top:16px">Otras</div>`;
      html += `<div class="notes-masonry">${others.map(n => noteCardHtml(n)).join('')}</div>`;
    }
  }

  container.innerHTML = html;

  // Re-open active note if one was being edited
  if (activeNoteId) {
    const card = document.getElementById(`note-card-${activeNoteId}`);
    if (card) expandCard(card, activeNoteId);
  }
}

function noteCardHtml(note) {
  const bg = COLOR_MAP[note.color] || COLOR_MAP.yellow;
  const border = note.color === 'white' ? 'border:1.5px solid #e5e7eb;' : '';
  const pinIcon = note.pinned ? '<span class="note-pin-icon" title="Fijada">📌</span>' : '';
  const isActive = activeNoteId === note.id;

  return `
    <div class="note-card-keep ${isActive ? 'note-card-active' : ''}"
         id="note-card-${note.id}"
         style="background:${bg};${border}"
         onclick="handleCardClick(event, '${note.id}')">
      ${pinIcon}
      <div class="note-card-content">
        <div class="note-title-area" id="note-title-area-${note.id}">
          ${isActive
            ? `<input type="text" class="note-inline-title" id="note-title-${note.id}"
                 value="${esc(note.title)}"
                 placeholder="Título"
                 oninput="scheduleSaveNote('${note.id}')"
                 onclick="event.stopPropagation()">`
            : (note.title ? `<div class="note-title-display">${esc(note.title)}</div>` : '')}
        </div>
        <div class="note-body-area" id="note-body-area-${note.id}">
          ${isActive
            ? `<textarea class="note-inline-body" id="note-body-${note.id}"
                 placeholder="Escribe una nota..."
                 oninput="scheduleSaveNote('${note.id}');autoResize(this)"
                 onclick="event.stopPropagation()">${esc(note.body)}</textarea>`
            : (note.body ? `<div class="note-body-display">${esc(note.body)}</div>` : '')}
        </div>
        ${isActive ? `
          <div class="note-inline-toolbar" onclick="event.stopPropagation()">
            <div class="note-colors-inline">
              ${Object.entries(COLOR_MAP).map(([c, hex]) => `
                <div class="note-color-dot ${note.color === c ? 'selected' : ''}"
                     style="background:${hex};${c==='white'?'border:1.5px solid #d1d5db;':''}"
                     onclick="setNoteColor('${note.id}','${c}')" title="${c}"></div>
              `).join('')}
            </div>
            <div class="note-card-actions">
              <button class="note-action-btn" onclick="toggleNotePin('${note.id}')" title="${note.pinned ? 'Desfijar' : 'Fijar'}">
                ${note.pinned ? '📌' : '📍'}
              </button>
              <button class="note-action-btn" onclick="deleteNote('${note.id}')" title="Eliminar" style="color:#ef4444">
                🗑️
              </button>
              <button class="note-action-btn close-btn" onclick="collapseCard('${note.id}')" title="Cerrar">
                ✓ Listo
              </button>
            </div>
          </div>` : `
          <div class="note-date-display">${fmtDate(note.updated_at)}</div>`}
      </div>
    </div>`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

// ── Card expand/collapse ───────────────────────────────────────
window.handleCardClick = function(event, noteId) {
  if (event.target.closest('.note-inline-toolbar')) return;
  if (activeNoteId === noteId) return; // already active, don't re-render
  activeNoteId = noteId;
  renderNotes();
  // Focus body after render
  setTimeout(() => {
    const bodyEl = document.getElementById(`note-body-${noteId}`);
    if (bodyEl) { bodyEl.focus(); autoResize(bodyEl); }
  }, 30);
};

function expandCard(card, noteId) {
  // Focus body
  setTimeout(() => {
    const bodyEl = document.getElementById(`note-body-${noteId}`);
    if (bodyEl) { bodyEl.focus(); autoResize(bodyEl); }
  }, 30);
}

window.collapseCard = async function(noteId) {
  // Save before collapsing
  clearTimeout(saveTimeouts[noteId]);
  await saveNote(noteId);
  activeNoteId = null;
  await loadNotes();
};

// Collapse if clicking outside any note card
document.addEventListener('click', async (e) => {
  if (!activeNoteId) return;
  const activeCard = document.getElementById(`note-card-${activeNoteId}`);
  if (activeCard && !activeCard.contains(e.target) && !e.target.closest('.fab')) {
    clearTimeout(saveTimeouts[activeNoteId]);
    await saveNote(activeNoteId);
    activeNoteId = null;
    await loadNotes();
  }
});

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ── Save note ──────────────────────────────────────────────────
window.scheduleSaveNote = function(noteId) {
  clearTimeout(saveTimeouts[noteId]);
  saveTimeouts[noteId] = setTimeout(() => saveNote(noteId), 800);
};

async function saveNote(noteId) {
  const titleEl = document.getElementById(`note-title-${noteId}`);
  const bodyEl  = document.getElementById(`note-body-${noteId}`);
  if (!titleEl && !bodyEl) return; // card not open

  const title = titleEl?.value?.trim() || '';
  const body  = bodyEl?.value?.trim()  || '';
  if (!title && !body) return;

  const now = new Date().toISOString();

  // Find existing note in allNotes
  const existing = allNotes.find(n => n.id === noteId);
  const color = existing?.color || 'yellow';
  const pinned = existing?.pinned || false;

  // Store everything (body, color, pinned) inside notes JSON
  // priority field is reserved for task priority (urgent/normal) — do not use for color
  const notesJson = JSON.stringify({ is_note: true, body, color, pinned });

  const { error } = await sb.from('tasks').update({
    title: title || 'Sin título',
    notes: notesJson,
    completed_at: now,
  }).eq('id', noteId);

  if (error) { console.error('saveNote error', error); return; }

  // Update local cache
  if (existing) {
    existing.title = title;
    existing.body = body;
    existing.updated_at = now;
  }
}

// ── Create new note ────────────────────────────────────────────
window.createNewNote = async function() {
  const now = new Date().toISOString();
  const { data, error } = await sb.from('tasks').insert({
    title: '',
    notes: JSON.stringify({ is_note: true, body: '', color: 'yellow', pinned: false }),
    module: NOTE_MODULE,   // 'Personal' — passes tasks_module_check constraint
    priority: 'normal',    // 'normal' — only 'normal'/'urgent' pass tasks_priority_check
    status: 'open',        // 'open' — only 'open'/'done' pass tasks_status_check
    completed_at: now,
    due_date: null,
  }).select().single();

  if (error) { console.error('createNewNote error', error); return; }

  // Add to local list
  const newNote = {
    id: data.id,
    title: '',
    body: '',
    color: 'yellow',
    pinned: false,
    created_at: data.created_at,
    updated_at: data.completed_at,
  };
  allNotes.unshift(newNote);
  activeNoteId = data.id;
  renderNotes();

  setTimeout(() => {
    const titleEl = document.getElementById(`note-title-${data.id}`);
    if (titleEl) titleEl.focus();
  }, 30);
};

// ── Set color ──────────────────────────────────────────────────
window.setNoteColor = async function(noteId, color) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;
  note.color = color;

  // Store color inside notes JSON (priority field is reserved for task priority)
  const notesJson = JSON.stringify({ is_note: true, body: note.body || '', color, pinned: note.pinned || false });
  const { error } = await sb.from('tasks').update({ notes: notesJson }).eq('id', noteId);
  if (error) { console.error('setNoteColor error', error); return; }

  // Update card background immediately without full re-render
  const card = document.getElementById(`note-card-${noteId}`);
  if (card) {
    card.style.background = COLOR_MAP[color] || COLOR_MAP.yellow;
    card.style.border = color === 'white' ? '1.5px solid #e5e7eb' : '';
    // Update dots selection
    card.querySelectorAll('.note-color-dot').forEach(dot => {
      dot.classList.toggle('selected', dot.title === color);
    });
  }
};

// ── Pin/unpin ──────────────────────────────────────────────────
window.toggleNotePin = async function(noteId) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;
  const newPinned = !note.pinned;
  note.pinned = newPinned;

  // Store pinned inside notes JSON (status field only allows 'open'/'done')
  const notesJson = JSON.stringify({ is_note: true, body: note.body || '', color: note.color || 'yellow', pinned: newPinned });
  const { error } = await sb.from('tasks').update({ notes: notesJson }).eq('id', noteId);

  if (error) { console.error('togglePin error', error); note.pinned = !newPinned; return; }
  renderNotes();
};

// ── Delete note ────────────────────────────────────────────────
window.deleteNote = async function(noteId) {
  if (!confirm('¿Eliminar esta nota?')) return;
  // Hard delete — 'cancelled' is not a valid status value per tasks_status_check
  await sb.from('tasks').delete().eq('id', noteId);
  allNotes = allNotes.filter(n => n.id !== noteId);
  if (activeNoteId === noteId) activeNoteId = null;
  renderNotes();
};

// ── Search ─────────────────────────────────────────────────────
window.filterNotes = function(q) {
  searchQuery = q;
  renderNotes();
};

// ── Init ───────────────────────────────────────────────────────
loadNotes();
