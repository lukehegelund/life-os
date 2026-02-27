// notes.js — Life OS Notes (v3: list layout, DOM expand/collapse, modern colors)
// Notes stored in `tasks` table with module='Personal' + notes JSON flag {is_note:true}
// body/color/pinned stored in notes JSON; priority='normal', status='open'

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://kxsuzgpnvtepsyhkezin.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c3V6Z3BudnRlcHN5aGtlemluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3Nzc1MDAsImV4cCI6MjA4NzM1MzUwMH0.oKtpiH63heyK-wJ87ZRvkhUzRqy6NT6Z2XWF1xjbtxA';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

const NOTE_MODULE = 'Personal';
const NOTE_FLAG   = '"is_note":true';

// Modern accent colors matching the app palette
const ACCENT_COLORS = {
  none:   { strip: 'transparent', label: 'None' },
  blue:   { strip: '#2563EB',     label: 'Blue' },
  green:  { strip: '#1A5E3A',     label: 'Green' },
  orange: { strip: '#D97706',     label: 'Orange' },
  coral:  { strip: '#E8563A',     label: 'Coral' },
  purple: { strip: '#7C3AED',     label: 'Purple' },
};

let allNotes = [];
let searchQuery = '';
let activeNoteId = null;
const saveTimeouts = {};

// ── Helpers ─────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

// ── Load notes ──────────────────────────────────────────────────
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
      created_at: row.created_at,
      updated_at: row.completed_at || row.created_at,
    };
  });

  renderNotes();
}

// ── Render (full list rebuild) ──────────────────────────────────
function renderNotes() {
  const container = document.getElementById('notes-list');
  const countEl   = document.getElementById('notes-count');

  const q = searchQuery.toLowerCase();
  const visible = q
    ? allNotes.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
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

  // Re-expand active note after re-render
  if (activeNoteId) {
    expandCardDOM(activeNoteId);
  }
}

function noteCardHtml(note) {
  const accentColor = ACCENT_COLORS[note.color]?.strip || 'transparent';
  const isActive = activeNoteId === note.id;
  const titleDisplay = note.title || '<span style="color:var(--gray-400);font-style:italic">Sin título</span>';
  const bodyPreview = note.body ? note.body.replace(/\n/g, ' ').substring(0, 80) + (note.body.length > 80 ? '…' : '') : '';

  return `
    <div class="note-card${isActive ? ' expanded' : ''}${note.pinned ? ' pinned-card' : ''}"
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
        <textarea class="note-edit-body"
          id="note-body-${note.id}"
          placeholder="Escribe una nota..."
          oninput="scheduleSaveNote('${note.id}');autoResizeTA(this)"
          onclick="event.stopPropagation()">${esc(note.body)}</textarea>

        <div class="note-edit-toolbar" onclick="event.stopPropagation()">
          <!-- Color swatches -->
          <div class="note-color-row">
            ${Object.entries(ACCENT_COLORS).map(([key, cfg]) => `
              <div class="note-color-swatch${note.color === key ? ' active' : ''}"
                   style="background:${cfg.strip === 'transparent' ? 'var(--gray-100)' : cfg.strip};${key==='none'?'border:1.5px dashed var(--gray-400);':''}"
                   title="${cfg.label}"
                   onclick="setNoteColor('${note.id}','${key}')"></div>
            `).join('')}
          </div>
          <!-- Action buttons -->
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

// ── Expand / collapse (DOM-based, no full re-render) ─────────────
function expandCardDOM(noteId) {
  const card = document.getElementById(`note-card-${noteId}`);
  if (!card) return;
  card.classList.add('expanded');
  setTimeout(() => {
    const bodyEl = document.getElementById(`note-body-${noteId}`);
    if (bodyEl) { autoResizeTA(bodyEl); bodyEl.focus(); }
  }, 30);
}

window.handleCardClick = function(event, noteId) {
  if (event.target.closest('.note-edit-toolbar') || event.target.closest('.note-card-expanded')) return;
  if (activeNoteId === noteId) return;

  // Collapse previous
  if (activeNoteId) {
    const prev = document.getElementById(`note-card-${activeNoteId}`);
    if (prev) prev.classList.remove('expanded');
    clearTimeout(saveTimeouts[activeNoteId]);
    saveNote(activeNoteId); // fire-and-forget
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
  // Reload to update preview text / date
  await loadNotes();
};

// Collapse on outside click
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

function autoResizeTA(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ── Save note ───────────────────────────────────────────────────
window.scheduleSaveNote = function(noteId) {
  clearTimeout(saveTimeouts[noteId]);
  saveTimeouts[noteId] = setTimeout(() => saveNote(noteId), 800);
};

async function saveNote(noteId) {
  const titleEl = document.getElementById(`note-title-${noteId}`);
  const bodyEl  = document.getElementById(`note-body-${noteId}`);
  if (!titleEl && !bodyEl) return;

  const title = titleEl?.value?.trim() || '';
  const body  = bodyEl?.value?.trim()  || '';
  if (!title && !body) return;

  const existing = allNotes.find(n => n.id === noteId);
  const color  = existing?.color  || 'none';
  const pinned = existing?.pinned || false;
  const now    = new Date().toISOString();

  const { error } = await sb.from('tasks').update({
    title: title || 'Sin título',
    notes: JSON.stringify({ is_note: true, body, color, pinned }),
    completed_at: now,
  }).eq('id', noteId);

  if (error) { console.error('saveNote error', error); return; }

  if (existing) {
    existing.title = title;
    existing.body  = body;
    existing.updated_at = now;
  }
}

// ── Create new note ─────────────────────────────────────────────
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

  // If another card is open, close it
  if (activeNoteId) {
    const prev = document.getElementById(`note-card-${activeNoteId}`);
    if (prev) prev.classList.remove('expanded');
    activeNoteId = null;
  }

  activeNoteId = data.id;
  renderNotes(); // need to add the new card to the DOM first

  setTimeout(() => {
    const titleEl = document.getElementById(`note-title-${data.id}`);
    if (titleEl) titleEl.focus();
  }, 40);
};

// ── Set color ───────────────────────────────────────────────────
window.setNoteColor = async function(noteId, color) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;
  note.color = color;

  const { error } = await sb.from('tasks').update({
    notes: JSON.stringify({ is_note: true, body: note.body || '', color, pinned: note.pinned || false }),
  }).eq('id', noteId);
  if (error) { console.error('setNoteColor error', error); return; }

  // Update accent strip instantly
  const card = document.getElementById(`note-card-${noteId}`);
  if (card) {
    const strip = card.querySelector('.note-card-accent');
    const accentColor = ACCENT_COLORS[color]?.strip || 'transparent';
    if (accentColor !== 'transparent') {
      if (!strip) {
        const div = document.createElement('div');
        div.className = 'note-card-accent';
        div.style.background = accentColor;
        card.prepend(div);
      } else { strip.style.background = accentColor; }
    } else {
      if (strip) strip.remove();
    }
    // Update swatch active state
    card.querySelectorAll('.note-color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.title === ACCENT_COLORS[color]?.label);
    });
  }
};

// ── Pin/unpin ───────────────────────────────────────────────────
window.toggleNotePin = async function(noteId) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;
  const newPinned = !note.pinned;
  note.pinned = newPinned;

  const { error } = await sb.from('tasks').update({
    notes: JSON.stringify({ is_note: true, body: note.body || '', color: note.color || 'none', pinned: newPinned }),
  }).eq('id', noteId);
  if (error) { console.error('togglePin error', error); note.pinned = !newPinned; return; }

  renderNotes();
};

// ── Delete note ─────────────────────────────────────────────────
window.deleteNote = async function(noteId) {
  if (!confirm('¿Eliminar esta nota?')) return;
  await sb.from('tasks').delete().eq('id', noteId);
  allNotes = allNotes.filter(n => n.id !== noteId);
  if (activeNoteId === noteId) activeNoteId = null;
  renderNotes();
};

// ── Search ──────────────────────────────────────────────────────
window.filterNotes = function(q) {
  searchQuery = q;
  renderNotes();
};

// ── Init ────────────────────────────────────────────────────────
loadNotes();
