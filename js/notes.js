// notes.js — Life OS Notes (v4: rich text, modern font, instant delete)
// Notes stored in `tasks` table with module='Personal' + notes JSON flag {is_note:true}
// body = HTML string (contenteditable), color/pinned in notes JSON

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://kxsuzgpnvtepsyhkezin.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c3V6Z3BudnRlcHN5aGtlemluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3Nzc1MDAsImV4cCI6MjA4NzM1MzUwMH0.oKtpiH63heyK-wJ87ZRvkhUzRqy6NT6Z2XWF1xjbtxA';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

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

let allNotes = [];
let searchQuery = '';
let activeNoteId = null;
const saveTimeouts = {};

// ── Helpers ──────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Strip HTML tags to get plain text for preview
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
      body: meta.body || '',          // HTML string
      color: meta.color || 'none',
      pinned: meta.pinned || false,
      created_at: row.created_at,
      updated_at: row.completed_at || row.created_at,
    };
  });

  renderNotes();
}

// ── Render (full list rebuild) ────────────────────────────────────
function renderNotes() {
  const container = document.getElementById('notes-list');
  const countEl   = document.getElementById('notes-count');

  const q = searchQuery.toLowerCase();
  const visible = q
    ? allNotes.filter(n => n.title.toLowerCase().includes(q) || stripHtml(n.body).toLowerCase().includes(q))
    : allNotes;

  countEl.textContent = visible.length ? `${visible.length} nota${visible.length !== 1 ? 's' : ''}` : '';

  if (!visible.length) {
    container.innerHTML = `<div class="notes-empty"><div class="empty-icon">📝</div><p>Toca + para crear tu primera nota</p></div>`;
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

  // Re-expand active note
  if (activeNoteId) expandCardDOM(activeNoteId);
}

function noteCardHtml(note) {
  const accentColor = ACCENT_COLORS[note.color]?.strip || 'transparent';
  const bodyText = stripHtml(note.body);
  const bodyPreview = bodyText ? bodyText.substring(0, 90) + (bodyText.length > 90 ? '…' : '') : '';

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
        </div>
        <div class="note-collapsed-meta">
          ${note.pinned ? '<span class="note-pin-badge">📌</span>' : ''}
          <span class="note-meta-date">${fmtDate(note.updated_at)}</span>
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
          data-placeholder="Escribe una nota..."
          oninput="scheduleSaveNote('${note.id}')"
          onclick="event.stopPropagation()">${note.body || ''}</div>

        <div class="note-edit-toolbar" onclick="event.stopPropagation()">
          <div class="note-color-row">
            ${Object.entries(ACCENT_COLORS).map(([key, cfg]) => `
              <div class="note-color-swatch${note.color === key ? ' active' : ''}"
                   style="background:${cfg.strip === 'transparent' ? 'var(--gray-100)' : cfg.strip};${key==='none'?'border:1.5px dashed var(--gray-400);':''}"
                   title="${cfg.label}"
                   onclick="setNoteColor('${note.id}','${key}')"></div>
            `).join('')}
          </div>
          <div class="note-toolbar-actions">
            <button class="note-tool-btn" onclick="toggleNotePin('${note.id}')" title="${note.pinned ? 'Desfijar' : 'Fijar'}">
              ${note.pinned ? '📌' : '📍'}
            </button>
            <button class="note-tool-btn" onclick="deleteNote('${note.id}')" title="Eliminar" style="color:var(--coral)">
              🗑️
            </button>
            <button class="note-tool-btn note-done-btn" onclick="collapseCard('${note.id}')">
              ✓ Listo
            </button>
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
  if (activeCard && !activeCard.contains(e.target) && !e.target.closest('.fab')) {
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

  const existing = allNotes.find(n => n.id === noteId);
  const color  = existing?.color  || 'none';
  const pinned = existing?.pinned || false;
  const now    = new Date().toISOString();

  const { error } = await sb.from('tasks').update({
    title: title || 'Sin título',
    notes: JSON.stringify({ is_note: true, body: bodyHtml, color, pinned }),
    completed_at: now,
  }).eq('id', noteId);

  if (error) { console.error('saveNote error', error); return; }

  if (existing) {
    existing.title = title;
    existing.body  = bodyHtml;
    existing.updated_at = now;
  }
}

// ── Create new note ───────────────────────────────────────────────
window.createNewNote = async function() {
  const now = new Date().toISOString();
  const { data, error } = await sb.from('tasks').insert({
    title: '',
    notes: JSON.stringify({ is_note: true, body: '', color: 'none', pinned: false }),
    module: NOTE_MODULE,
    priority: 'normal',
    status: 'open',
    completed_at: now,
    due_date: null,
  }).select().single();

  if (error) { console.error('createNewNote error', error); return; }

  const newNote = {
    id: data.id, title: '', body: '', color: 'none', pinned: false,
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
  note.color = color;

  sb.from('tasks').update({
    notes: JSON.stringify({ is_note: true, body: note.body || '', color, pinned: note.pinned || false }),
  }).eq('id', noteId);

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
  const newPinned = !note.pinned;
  note.pinned = newPinned;

  sb.from('tasks').update({
    notes: JSON.stringify({ is_note: true, body: note.body || '', color: note.color || 'none', pinned: newPinned }),
  }).eq('id', noteId);

  renderNotes();
};

// ── Delete note (instant DOM removal) ────────────────────────────
window.deleteNote = async function(noteId) {
  if (!confirm('¿Eliminar esta nota?')) return;
  // Remove from DOM immediately
  const card = document.getElementById(`note-card-${noteId}`);
  if (card) card.remove();
  allNotes = allNotes.filter(n => n.id !== noteId);
  if (activeNoteId === noteId) activeNoteId = null;
  // Update count
  const countEl = document.getElementById('notes-count');
  if (countEl) countEl.textContent = allNotes.length ? `${allNotes.length} nota${allNotes.length !== 1 ? 's' : ''}` : '';
  if (!allNotes.length) renderNotes();
  // DB delete in background
  sb.from('tasks').delete().eq('id', noteId);
};

// ── Search ────────────────────────────────────────────────────────
window.filterNotes = function(q) {
  searchQuery = q;
  renderNotes();
};

// ── Init ──────────────────────────────────────────────────────────
loadNotes();
