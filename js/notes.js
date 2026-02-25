// notes.js — Life OS Notes page
// Notes are stored in the `tasks` table with module='__note__'
// title → title, body text → notes field, color → priority field, pinned → status='pinned'

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://kxsuzgpnvtepsyhkezin.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c3V6Z3BudnRlcHN5aGtlemluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3Nzc1MDAsImV4cCI6MjA4NzM1MzUwMH0.oKtpiH63heyK-wJ87ZRvkhUzRqy6NT6Z2XWF1xjbtxA';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

const NOTE_MODULE = '__note__';

// Color → CSS class and background hex
const COLOR_MAP = {
  yellow: { cls: 'note-yellow', bg: '#FFF9C4', editorBg: '#FFF9C4' },
  white:  { cls: 'note-white',  bg: '#FFFFFF', editorBg: '#FFFFFF' },
  blue:   { cls: 'note-blue',   bg: '#BBDEFB', editorBg: '#BBDEFB' },
  green:  { cls: 'note-green',  bg: '#C8E6C9', editorBg: '#C8E6C9' },
  pink:   { cls: 'note-pink',   bg: '#F8BBD9', editorBg: '#F8BBD9' },
  orange: { cls: 'note-orange', bg: '#FFE0B2', editorBg: '#FFE0B2' },
  purple: { cls: 'note-purple', bg: '#E1BEE7', editorBg: '#E1BEE7' },
  teal:   { cls: 'note-teal',   bg: '#B2DFDB', editorBg: '#B2DFDB' },
};

let allNotes = [];
let currentNote = null;   // { id, title, body, color, pinned, created_at, updated_at }
let currentColor = 'yellow';
let saveTimeout = null;
let searchQuery = '';

// ── Load notes ─────────────────────────────────────────────────
async function loadNotes() {
  const { data, error } = await sb
    .from('tasks')
    .select('id, title, notes, priority, status, created_at, completed_at')
    .eq('module', NOTE_MODULE)
    .order('completed_at', { ascending: false });  // use completed_at as updated_at

  if (error) { console.error('loadNotes error', error); return; }

  allNotes = (data || []).map(row => ({
    id: row.id,
    title: row.title || '',
    body: row.notes || '',
    color: row.priority || 'yellow',
    pinned: row.status === 'pinned',
    created_at: row.created_at,
    updated_at: row.completed_at || row.created_at,
  }));

  renderNotes(allNotes);
}

// ── Render notes list ──────────────────────────────────────────
function renderNotes(notes) {
  const container = document.getElementById('notes-list');
  const countEl = document.getElementById('notes-count');

  if (!notes.length) {
    countEl.textContent = '';
    container.innerHTML = `
      <div class="notes-empty">
        <div class="empty-icon">📝</div>
        <p>Toca + para crear tu primera nota</p>
      </div>`;
    return;
  }

  const q = searchQuery.toLowerCase();
  const visible = q
    ? notes.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
    : notes;

  countEl.textContent = `${visible.length} nota${visible.length !== 1 ? 's' : ''}`;

  const pinned = visible.filter(n => n.pinned);
  const others = visible.filter(n => !n.pinned);

  let html = '';

  if (pinned.length) {
    if (others.length) html += `<div class="notes-section-label">📌 Fijadas</div>`;
    html += `<div class="notes-grid">${pinned.map(noteCard).join('')}</div>`;
  }

  if (others.length) {
    if (pinned.length) html += `<div class="notes-section-label">Otras</div>`;
    html += `<div class="notes-grid">${others.map(noteCard).join('')}</div>`;
  }

  if (!visible.length) {
    html = `<div class="notes-empty"><div class="empty-icon">🔍</div><p>No se encontraron notas</p></div>`;
  }

  container.innerHTML = html;
}

function noteCard(note) {
  const colorInfo = COLOR_MAP[note.color] || COLOR_MAP.yellow;
  const title = note.title ? `<div class="note-title">${esc(note.title)}</div>` : '';
  const body = note.body ? `<div class="note-body">${esc(note.body)}</div>` : '';
  const dateStr = fmtDate(note.updated_at);
  return `
    <div class="note-card ${colorInfo.cls} ${note.pinned ? 'pinned' : ''}"
         onclick="openNote('${note.id}')">
      ${title}
      ${body}
      <div class="note-date">${dateStr}</div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

// ── Open/close editor ──────────────────────────────────────────
window.openNewNote = function() {
  currentNote = null;
  currentColor = 'yellow';
  document.getElementById('editor-title').value = '';
  document.getElementById('editor-body').value = '';
  document.getElementById('editor-status').textContent = 'Nueva nota';
  document.getElementById('pin-btn').style.opacity = '0.4';
  setEditorColor('yellow');
  document.getElementById('note-editor').classList.add('open');
  document.getElementById('editor-title').focus();
};

window.openNote = function(id) {
  const note = allNotes.find(n => n.id === id);
  if (!note) return;
  currentNote = { ...note };
  currentColor = note.color || 'yellow';
  document.getElementById('editor-title').value = note.title;
  document.getElementById('editor-body').value = note.body;
  document.getElementById('editor-status').textContent = fmtDate(note.updated_at);
  document.getElementById('pin-btn').style.opacity = note.pinned ? '1' : '0.4';
  setEditorColor(currentColor);
  document.getElementById('note-editor').classList.add('open');
  document.getElementById('editor-body').focus();
};

window.closeEditor = async function() {
  clearTimeout(saveTimeout);
  await saveNote();
  document.getElementById('note-editor').classList.remove('open');
  loadNotes();
};

// ── Auto-save on input ─────────────────────────────────────────
document.getElementById('editor-title').addEventListener('input', scheduleSave);
document.getElementById('editor-body').addEventListener('input', scheduleSave);

function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNote, 1200);
}

async function saveNote() {
  const title = document.getElementById('editor-title').value.trim();
  const body = document.getElementById('editor-body').value.trim();

  if (!title && !body) return; // Nothing to save

  const now = new Date().toISOString();

  if (!currentNote) {
    // Create new note
    const { data, error } = await sb.from('tasks').insert({
      title: title || 'Sin título',
      notes: body,
      module: NOTE_MODULE,
      priority: currentColor,
      status: 'open',
      completed_at: now,
      due_date: null,
    }).select().single();

    if (error) { console.error('create note error', error); return; }
    currentNote = {
      id: data.id,
      title: data.title,
      body: data.notes,
      color: data.priority,
      pinned: false,
      created_at: data.created_at,
      updated_at: data.completed_at,
    };
    document.getElementById('editor-status').textContent = 'Guardado';
  } else {
    // Update existing note
    const { error } = await sb.from('tasks').update({
      title: title || 'Sin título',
      notes: body,
      priority: currentColor,
      completed_at: now,
    }).eq('id', currentNote.id);

    if (error) { console.error('update note error', error); return; }
    currentNote.title = title;
    currentNote.body = body;
    currentNote.color = currentColor;
    currentNote.updated_at = now;
    document.getElementById('editor-status').textContent = 'Guardado';
  }
}

// ── Pin/unpin ──────────────────────────────────────────────────
window.togglePin = async function() {
  if (!currentNote) {
    // Save first
    await saveNote();
    if (!currentNote) return;
  }
  const newPinned = !currentNote.pinned;
  const { error } = await sb.from('tasks').update({
    status: newPinned ? 'pinned' : 'open',
  }).eq('id', currentNote.id);

  if (!error) {
    currentNote.pinned = newPinned;
    document.getElementById('pin-btn').style.opacity = newPinned ? '1' : '0.4';
    document.getElementById('editor-status').textContent = newPinned ? '📌 Fijada' : 'Sin fijar';
  }
};

// ── Color ──────────────────────────────────────────────────────
window.setColor = function(color, el) {
  currentColor = color;
  setEditorColor(color);
  // Update swatch selection
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  // Trigger save
  scheduleSave();
};

function setEditorColor(color) {
  const info = COLOR_MAP[color] || COLOR_MAP.yellow;
  document.getElementById('editor-bg').style.background = info.bg;
  // Update swatch selection
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === color);
  });
}

// ── Delete ─────────────────────────────────────────────────────
window.confirmDelete = function() {
  if (!currentNote) {
    closeEditor();
    return;
  }
  document.getElementById('delete-confirm').classList.add('open');
};

window.deleteCurrentNote = async function() {
  document.getElementById('delete-confirm').classList.remove('open');
  if (!currentNote) return;

  await sb.from('tasks').delete().eq('id', currentNote.id);
  document.getElementById('note-editor').classList.remove('open');
  currentNote = null;
  loadNotes();
};

// ── Search ─────────────────────────────────────────────────────
window.filterNotes = function(q) {
  searchQuery = q;
  renderNotes(allNotes);
};

// ── Init ───────────────────────────────────────────────────────
loadNotes();
