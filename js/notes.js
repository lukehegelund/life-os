// notes.js — Life OS Notes (v5: fix color/pin persistence, await DB updates)
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
          data-placeholder="Escribe una nota... (prueba /task o /note)"
          oninput="detectSlashCommand('${note.id}', event)"
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

// ── Slash Command Detection ───────────────────────────────────────
// When user types /task or /note at start of a line, show action popup
let slashPopupActive = false;

function getCurrentLineText(el) {
  // Get the text content of the current cursor line
  const sel = window.getSelection();
  if (!sel.rangeCount) return '';
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const text = node.textContent || '';
  const offset = range.startOffset;
  // Find start of line
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return text.slice(lineStart, offset);
}

function removeSlashCommand(el, cmd) {
  // Remove /task or /note from the current line in the contenteditable
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

  // Replace the command text in the node
  const newText = text.slice(0, lineStart + cmdIdx) + text.slice(lineStart + cmdIdx + cmd.length);
  const remainder = lineText.slice(0, cmdIdx) + lineText.slice(cmdIdx + cmd.length);
  node.textContent = newText;
  // Restore cursor position
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

  // Position near center of screen (simplest for mobile)
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
    popup.innerHTML = `
      <div style="font-size:14px;font-weight:700;color:var(--gray-800);margin-bottom:4px">📝 Agregar nota como…</div>
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">
        "${lineText.replace(cmd,'').trim() || '(contenido del mismo renglón)'}"
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-ghost" style="justify-content:flex-start;text-align:left;padding:10px 12px;border-radius:10px"
          onclick="openSlashNoteFlow('universal', ${JSON.stringify(lineText.replace(cmd,'').trim())})">
          📋 <strong>Universal</strong> — aparece en todas las clases
        </button>
        <button class="btn btn-ghost" style="justify-content:flex-start;text-align:left;padding:10px 12px;border-radius:10px"
          onclick="openSlashNoteFlow('class', ${JSON.stringify(lineText.replace(cmd,'').trim())})">
          🏫 <strong>Nota de clase</strong> — elige una clase específica
        </button>
        <button class="btn btn-ghost" style="justify-content:flex-start;text-align:left;padding:10px 12px;border-radius:10px"
          onclick="openSlashNoteFlow('student', ${JSON.stringify(lineText.replace(cmd,'').trim())})">
          👤 <strong>Nota de alumno</strong> — elige alumno y clase
        </button>
        <button class="btn btn-sm btn-ghost" onclick="dismissSlashPopup()">Cancelar</button>
      </div>`;
    // Remove the command from the editor
    setTimeout(() => removeSlashCommand(bodyEl, cmd), 0);
  }

  document.body.appendChild(popup);
}

window.dismissSlashPopup = function() {
  document.getElementById('slash-popup')?.remove();
  slashPopupActive = false;
};

// Listen for slash commands on oninput in note body
window.detectSlashCommand = function(noteId, event) {
  const bodyEl = document.getElementById(`note-body-${noteId}`);
  if (!bodyEl) return;

  scheduleSaveNote(noteId);

  if (slashPopupActive) return; // already showing one

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
  // Show a brief confirmation toast in the note
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
    // Create universal class note immediately
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

  // Class or student note — need to pick a class first
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
    // Student note
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
  const { error } = await sb.from('class_overview_notes').insert({
    class_id: Number(classId),
    note: content,
  });
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
  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // PST date

  const { error } = await sb.from('student_notes').insert({
    student_id: studentId,
    class_id: Number(classId),
    note: content,
    date: now,
    category,
    followup_needed: false,
    show_in_overview: isOverview || true,
    is_todo: isTodo || false,
    tell_parent: isParent || false,
    logged: false,
  });

  document.getElementById('slash-note-modal')?.remove();
  if (error) { alert('Error: ' + error.message); return; }
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a5e3a;color:white;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;z-index:900;pointer-events:none';
  t.textContent = '👤 Nota de alumno guardada';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
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
    // Keep color and pinned in sync (they may have been updated separately)
    existing.color  = color;
    existing.pinned = pinned;
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

  // Flush any pending save first so we don't lose body edits
  if (saveTimeouts[noteId]) {
    clearTimeout(saveTimeouts[noteId]);
    await saveNote(noteId);
  }

  note.color = color;

  // Await the DB update so collapse/reload doesn't race with it
  await sb.from('tasks').update({
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

  // Flush any pending save first so we don't lose body edits
  if (saveTimeouts[noteId]) {
    clearTimeout(saveTimeouts[noteId]);
    await saveNote(noteId);
  }

  const newPinned = !note.pinned;
  note.pinned = newPinned;

  // Await the DB update so collapse/reload doesn't race with it
  await sb.from('tasks').update({
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

// ── Global: dismiss slash popup on Escape ─────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && slashPopupActive) window.dismissSlashPopup();
});

// ── Init ──────────────────────────────────────────────────────────
loadNotes();
