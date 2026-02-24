// Life OS — Tasks & Reminders
import { supabase } from './supabase.js';
import { today, fmtDate, toast, showEmpty } from './utils.js';
import { initSwipe } from './swipe-handler.js';

const T = today();
let activeModule = 'All';
// User-defined category order (persisted in localStorage)
let categoryOrder = JSON.parse(localStorage.getItem('tasks-cat-order') || 'null') || ['RT', 'RT Admin', 'TOV', 'Personal', 'Health'];

const MODULE_ICONS   = { RT: '🏫', 'RT Admin': '🏛️', TOV: '💍', Personal: '👤', Health: '🏃' };
const MODULE_COLORS  = { RT: 'var(--blue)', 'RT Admin': '#7c3aed', TOV: 'var(--green)', Personal: 'var(--orange)', Health: 'var(--coral)' };

// RT Admin is a virtual module stored as module='RT' with notes JSON tag {rt_admin:true}
// These helpers handle the translation between display and storage.
function isRTAdmin(t) {
  if (!t.notes) return false;
  try { return JSON.parse(t.notes).rt_admin === true; } catch { return false; }
}
function displayModule(t) {
  return isRTAdmin(t) ? 'RT Admin' : (t.module || 'Personal');
}
function storageModule(displayMod) {
  return displayMod === 'RT Admin' ? 'RT' : displayMod;
}
function storageNotes(displayMod, notesStr) {
  if (displayMod === 'RT Admin') {
    try {
      const existing = notesStr ? JSON.parse(notesStr) : {};
      if (typeof existing === 'object') return JSON.stringify({ ...existing, rt_admin: true });
    } catch {}
    return JSON.stringify({ rt_admin: true, note: notesStr || '' });
  }
  return notesStr || null;
}

window.setModule = (mod) => {
  activeModule = mod;
  document.querySelectorAll('.mod-btn').forEach(b => {
    b.classList.remove('btn-primary'); b.classList.add('btn-ghost');
  });
  document.getElementById(`mod-${mod}`)?.classList.replace('btn-ghost', 'btn-primary');
  load();
};

async function load() {
  await Promise.all([loadReminders(), loadTasks(), loadFutureProjects(), loadRecurring()]);
}

// ── Reminders ─────────────────────────────────────────────────────────────────
async function loadReminders() {
  const el = document.getElementById('reminders-section');
  let query = supabase.from('reminders').select('*').eq('status', 'active').or('recurring.is.null,recurring.eq.false').order('due_date');
  const res = await query;
  let reminders = res.data || [];
  if (activeModule === 'RT Admin') {
    reminders = reminders.filter(r => isRTAdmin(r));
  } else if (activeModule !== 'All') {
    reminders = reminders.filter(r => r.module === activeModule && !isRTAdmin(r));
  }

  const overdue  = reminders.filter(r => r.due_date && r.due_date <= T);
  const upcoming = reminders.filter(r => !r.due_date || r.due_date > T);

  let html = '';
  if (overdue.length) {
    html += `<div class="card" style="border-left:4px solid var(--red);padding:0;overflow:hidden;margin-bottom:12px">
      <div style="padding:10px 16px;background:#fff5f5">
        <div class="urgent-section-header" style="color:var(--red)">⏰ Overdue Reminders (${overdue.length})</div>
        ${overdue.map(r => reminderRow(r, true)).join('')}
      </div>
    </div>`;
  }
  if (upcoming.length) {
    html += `<div class="card" style="margin-bottom:12px">
      <div class="card-title">🔔 Reminders (${upcoming.length})</div>
      ${upcoming.map(r => reminderRow(r, false)).join('')}
    </div>`;
  }
  if (!reminders.length) {
    html = '<div class="card" style="text-align:center;color:var(--gray-400);padding:14px;font-size:14px;margin-bottom:12px">🔔 No active reminders</div>';
  }
  el.innerHTML = html;
}

function reminderRow(r, isOverdue) {
  const ntfyLabel = r.ntfy_time
    ? `<span style="color:var(--blue);font-size:11px">🔔 ${r.ntfy_time}</span>`
    : '';
  return `
    <div class="list-item" style="position:relative">
      <div class="list-item-left">
        <div class="list-item-name">${r.title}</div>
        <div class="list-item-sub">
          ${r.due_date ? (isOverdue ? `<span style="color:var(--red)">Due ${fmtDate(r.due_date)}</span>` : `Due ${fmtDate(r.due_date)}`) : 'No date'}
          ${r.module ? ' · ' + r.module : ''}
          ${r.recurring ? ' · 🔄' : ''}
          ${r.ntfy_time ? ' · ' : ''}${ntfyLabel}
        </div>
        ${r.notes ? `<div style="font-size:13px;color:var(--gray-600);margin-top:2px">${r.notes}</div>` : ''}
      </div>
      <div class="list-item-right" style="display:flex;gap:4px;align-items:center">
        <button class="btn btn-sm" style="background:var(--blue-light,#eff6ff);color:var(--blue);border:none;font-size:11px;padding:3px 7px"
          onclick="convertToTask(${r.id}, 'reminder')" title="Convert to task">→ Task</button>
        <button class="btn btn-sm btn-ghost" onclick="dismissReminder(${r.id})" title="Dismiss">✓</button>
      </div>
    </div>`;
}

// ── Convert reminder ↔ task ───────────────────────────────────────────────────
window.convertToTask = async (id, sourceType) => {
  if (sourceType === 'reminder') {
    // fetch reminder
    const { data } = await supabase.from('reminders').select('*').eq('id', id).single();
    if (!data) return;
    // insert as task
    const { error } = await supabase.from('tasks').insert({
      title: data.title,
      module: data.module || 'Personal',
      status: 'open',
      priority: 'normal',
      due_date: data.due_date || null,
      notes: data.notes || null,
    });
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    // dismiss the reminder
    await supabase.from('reminders').update({ status: 'dismissed' }).eq('id', id);
    toast('Converted to task ✅', 'success');
    load();
  }
};

window.convertToReminder = async (id) => {
  const { data } = await supabase.from('tasks').select('*').eq('id', id).single();
  if (!data) return;
  const { error } = await supabase.from('reminders').insert({
    title: data.title,
    module: data.module || 'Personal',
    status: 'active',
    due_date: data.due_date || null,
    notes: data.notes || null,
  });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
  toast('Converted to reminder 🔔', 'success');
  load();
};

// ── Tasks ─────────────────────────────────────────────────────────────────────
async function loadTasks() {
  const res = await supabase.from('tasks')
    .select('*')
    .in('status', ['open', 'in_progress'])
    .order('due_date');

  let tasks = res.data || [];
  if (activeModule === 'RT Admin') {
    tasks = tasks.filter(t => isRTAdmin(t));
  } else if (activeModule !== 'All') {
    tasks = tasks.filter(t => t.module === activeModule && !isRTAdmin(t));
  }

  const summaryEl = document.getElementById('tasks-summary');
  if (summaryEl) {
    const urgentCount = tasks.filter(t => t.priority === 'urgent').length;
    summaryEl.textContent = `${tasks.length} open${urgentCount ? ` · ${urgentCount} urgent` : ''}`;
  }

  const urgentTasks = tasks.filter(t => t.priority === 'urgent');
  const normalTasks = tasks.filter(t => t.priority !== 'urgent');

  let html = '';

  if (urgentTasks.length) {
    html += `<div class="card" style="border-left:4px solid var(--red);padding:0;overflow:hidden;margin-bottom:12px">
      <div style="padding:10px 16px;background:#fff5f5">
        <div class="urgent-section-header" style="color:var(--red)">🔴 Urgent Tasks (${urgentTasks.length})
          <span style="font-size:11px;font-weight:400;margin-left:8px">← cancel · → done</span>
        </div>
        ${renderTaskGroup(urgentTasks)}
      </div>
    </div>`;
  }

  if (normalTasks.length) {
    const groups = {};
    for (const t of normalTasks) {
      const m = displayModule(t);
      if (!groups[m]) groups[m] = [];
      groups[m].push(t);
    }
    // Sort by user-defined order
    const sortedMods = Object.keys(groups).sort((a, b) => {
      const ai = categoryOrder.indexOf(a); const bi = categoryOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const mod of sortedMods) {
      const color   = MODULE_COLORS[mod] || 'var(--blue)';
      const icon    = MODULE_ICONS[mod] || '';
      const safeId  = mod.replace(/\s+/g, '-');
      html += `<div class="card task-category-card" data-module="${mod}"
        draggable="true"
        ondragstart="window.catDragStart(event)"
        ondragover="window.catDragOver(event)"
        ondrop="window.catDrop(event)"
        ondragend="window.catDragEnd(event)"
        style="border-top:3px solid ${color};margin-bottom:12px;cursor:grab">
        <div class="task-group-header">
          <div class="task-group-label" style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;color:var(--gray-300);cursor:grab" title="Drag to reorder">⠿</span>
            ${icon} ${mod}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="badge badge-gray">${groups[mod].length}</span>
            <button class="btn btn-sm btn-ghost" style="font-size:11px;padding:2px 8px;line-height:1.4"
              onclick="event.stopPropagation();showInlineAdd('${mod}')" title="Add task to ${mod}">+ Add</button>
          </div>
        </div>
        ${renderTaskGroup(groups[mod])}
        <div id="inline-add-${safeId}" style="display:none;padding:8px 0 4px 0;border-top:1px solid var(--gray-100);margin-top:4px">
          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" id="inline-title-${safeId}"
              placeholder="New task…"
              style="flex:1;border:1px solid var(--gray-200);border-radius:8px;padding:6px 10px;font-size:13px;outline:none"
              onkeydown="if(event.key==='Enter'){submitInlineTask('${mod}')}else if(event.key==='Escape'){hideInlineAdd('${mod}')}">
            <button class="btn btn-sm" style="background:${color};color:white;border:none;padding:6px 12px;flex-shrink:0"
              onclick="submitInlineTask('${mod}')">Add</button>
            <button class="btn btn-sm btn-ghost" style="padding:6px 8px;flex-shrink:0"
              onclick="hideInlineAdd('${mod}')">✕</button>
          </div>
        </div>
      </div>`;
    }
  }

  if (!tasks.length) {
    html = '<div class="card" style="text-align:center;color:var(--gray-400);padding:20px;font-size:14px">✅ All tasks done!</div>';
  }

  document.getElementById('tasks-section').innerHTML = html;
  document.getElementById('urgent-tasks-section').innerHTML = '';

  // Apply swipe gestures
  document.querySelectorAll('.task-swipe-row').forEach(item => {
    const taskId = item.dataset.id;
    initSwipe(item,
      async () => {
        await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', taskId);
        toast('Task removed', 'info');
        load();
      },
      async () => {
        const checkEl = item.querySelector('.task-check');
        if (checkEl) { checkEl.style.background = 'var(--green)'; checkEl.style.borderColor = 'var(--green)'; }
        item.style.opacity = '0.4';
        await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', taskId);
        toast('Task done! ✅', 'success');
        setTimeout(() => load(), 400);
      }
    );
  });
}

function notesDisplay(t) {
  // Don't show raw JSON for rt_admin tagged tasks; show the 'note' sub-key if present
  if (!t.notes) return '';
  try {
    const parsed = JSON.parse(t.notes);
    if (typeof parsed === 'object') {
      return parsed.note || '';
    }
  } catch {}
  return t.notes;
}

function renderTaskGroup(tasks) {
  return tasks.map(t => `
    <div class="task-row task-swipe-row" id="task-${t.id}" data-id="${t.id}" style="touch-action:pan-y;overflow:hidden;position:relative;display:flex;align-items:center;gap:8px">
      <div data-swipe-inner style="display:flex;align-items:flex-start;gap:10px;flex:1">
        <div class="task-check ${t.priority === 'urgent' ? 'urgent-check' : ''}" onclick="markDone(${t.id}, this)">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="display:none" id="check-${t.id}">
            <polyline points="2,6 5,10 11,3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="task-content">
          <div class="task-title">${t.title}</div>
          <div class="task-meta">
            ${t.due_date ? `Due ${fmtDate(t.due_date)}` : ''}
            ${t.due_date && notesDisplay(t) ? ' · ' : ''}
            ${notesDisplay(t)}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn btn-sm" style="background:#eff6ff;color:var(--blue);border:none;font-size:11px;padding:3px 7px"
          onclick="convertToReminder(${t.id})" title="Convert to reminder">→ 🔔</button>
        <button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;font-size:11px;padding:3px 8px"
          onclick="markDoneById(${t.id}, event)" title="Mark done">✓</button>
        <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;font-size:11px;padding:3px 8px"
          onclick="deleteTask(${t.id}, event)" title="Delete task">✕</button>
      </div>
    </div>`).join('');
}

// ── Inline task creation ──────────────────────────────────────────────────────
window.showInlineAdd = (mod) => {
  const safeId = mod.replace(/\s+/g, '-');
  const el = document.getElementById(`inline-add-${safeId}`);
  if (!el) return;
  el.style.display = 'block';
  setTimeout(() => document.getElementById(`inline-title-${safeId}`)?.focus(), 50);
};

window.hideInlineAdd = (mod) => {
  const safeId = mod.replace(/\s+/g, '-');
  const el = document.getElementById(`inline-add-${safeId}`);
  if (el) el.style.display = 'none';
  const input = document.getElementById(`inline-title-${safeId}`);
  if (input) input.value = '';
};

window.submitInlineTask = async (mod) => {
  const safeId = mod.replace(/\s+/g, '-');
  const input = document.getElementById(`inline-title-${safeId}`);
  const title = input?.value.trim();
  if (!title) { input?.focus(); return; }
  const module = storageModule(mod);
  const notes  = storageNotes(mod, '');
  const { error } = await supabase.from('tasks').insert({
    title, module, notes: notes || null, priority: 'normal', status: 'open'
  });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Task added! ✅', 'success');
  window.hideInlineAdd(mod);
  loadTasks();
};

// ── Category drag-to-reorder ──────────────────────────────────────────────────
let dragSrcModule = null;

window.catDragStart = (e) => {
  const card = e.currentTarget;
  dragSrcModule = card.dataset.module;
  card.style.opacity = '0.5';
  e.dataTransfer.effectAllowed = 'move';
};

window.catDragOver = (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.currentTarget;
  card.style.outline = '2px dashed var(--blue)';
};

window.catDrop = (e) => {
  e.preventDefault();
  const targetCard = e.currentTarget;
  const targetModule = targetCard.dataset.module;
  if (!dragSrcModule || dragSrcModule === targetModule) return;

  // Swap in categoryOrder array
  const srcIdx = categoryOrder.indexOf(dragSrcModule);
  const tgtIdx = categoryOrder.indexOf(targetModule);
  if (srcIdx !== -1 && tgtIdx !== -1) {
    [categoryOrder[srcIdx], categoryOrder[tgtIdx]] = [categoryOrder[tgtIdx], categoryOrder[srcIdx]];
  } else if (srcIdx !== -1) {
    categoryOrder.splice(srcIdx, 1);
    categoryOrder.splice(tgtIdx, 0, dragSrcModule);
  }
  localStorage.setItem('tasks-cat-order', JSON.stringify(categoryOrder));
  targetCard.style.outline = '';
  loadTasks(); // re-render with new order
};

window.catDragEnd = (e) => {
  e.currentTarget.style.opacity = '';
  e.currentTarget.style.outline = '';
  dragSrcModule = null;
};

// ── Future Projects ───────────────────────────────────────────────────────────
async function loadFutureProjects() {
  const el = document.getElementById('future-projects-section');
  if (!el) return;

  const { data } = await supabase.from('tasks')
    .select('*')
    .eq('status', 'future')
    .order('created_at', { ascending: false });

  let projects = data || [];
  // Filter future projects by module the same way tasks are filtered
  if (activeModule === 'RT Admin') {
    projects = projects.filter(p => isRTAdmin(p));
  } else if (activeModule !== 'All') {
    projects = projects.filter(p => p.module === activeModule && !isRTAdmin(p));
  }
  if (!projects.length) {
    el.innerHTML = `<div class="card" style="margin-bottom:12px">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
        🌱 Future Projects
        <button class="btn btn-sm btn-ghost" onclick="showFutureForm()">+ Add</button>
      </div>
      <div style="text-align:center;color:var(--gray-400);padding:12px;font-size:13px">No future projects yet</div>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="card" style="margin-bottom:12px">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
      🌱 Future Projects <span class="badge badge-gray">${projects.length}</span>
      <button class="btn btn-sm btn-ghost" onclick="showFutureForm()">+ Add</button>
    </div>
    ${projects.map(p => `
      <div class="list-item">
        <div class="list-item-left">
          <div class="list-item-name">${p.title}</div>
          ${p.notes ? `<div class="list-item-sub">${p.notes}</div>` : ''}
          ${p.module ? `<div class="list-item-sub">${MODULE_ICONS[displayModule(p)] || ''} ${displayModule(p)}</div>` : ''}
        </div>
        <div class="list-item-right" style="display:flex;gap:4px">
          <button class="btn btn-sm" style="background:var(--blue);color:white;border:none;font-size:11px;padding:3px 8px"
            onclick="activateProject(${p.id})" title="Move to active tasks">Activate</button>
          <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;font-size:11px;padding:3px 8px"
            onclick="deleteTask(${p.id}, event)">✕</button>
        </div>
      </div>`).join('')}
  </div>`;
}

window.showFutureForm = () => {
  document.getElementById('future-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('future-title').focus(), 50);
};
window.closeFutureModal = () => {
  document.getElementById('future-modal').style.display = 'none';
};
window.submitFutureProject = async () => {
  const title  = document.getElementById('future-title').value.trim();
  const modSel = document.getElementById('future-module').value;
  const notesRaw = document.getElementById('future-notes').value.trim();
  if (!title) { toast('Enter a title', 'error'); return; }
  const module = storageModule(modSel);
  const notes  = storageNotes(modSel, notesRaw);
  const { error } = await supabase.from('tasks').insert({
    title, module, notes, status: 'future', priority: 'normal',
  });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Future project added 🌱', 'success');
  window.closeFutureModal();
  document.getElementById('future-title').value = '';
  document.getElementById('future-notes').value = '';
  loadFutureProjects();
};

window.activateProject = async (id) => {
  await supabase.from('tasks').update({ status: 'open' }).eq('id', id);
  toast('Project activated! ✅', 'success');
  load();
};

// ── Shared task actions ───────────────────────────────────────────────────────
window.markDoneById = async (id, e) => {
  e?.stopPropagation();
  const row = document.getElementById(`task-${id}`);
  if (row) { row.style.opacity = '0.4'; row.style.transition = 'opacity 0.3s'; }
  await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id);
  toast('Task done! ✅', 'success');
  setTimeout(() => load(), 300);
};

window.deleteTask = async (id, e) => {
  e?.stopPropagation();
  const row = document.getElementById(`task-${id}`);
  if (row) { row.style.opacity = '0.3'; row.style.transition = 'opacity 0.3s'; }
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
  toast('Task deleted', 'info');
  setTimeout(() => load(), 300);
};

window.markDone = async (id, checkEl) => {
  checkEl.style.background = 'var(--green)';
  checkEl.style.borderColor = 'var(--green)';
  const svg = document.getElementById(`check-${id}`);
  if (svg) svg.style.display = 'block';
  const row = document.getElementById(`task-${id}`);
  if (row) { row.style.opacity = '0.4'; row.style.transition = 'opacity 0.3s'; }
  const { error } = await supabase.from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    toast('Error: ' + error.message, 'error');
    checkEl.style.background = ''; checkEl.style.borderColor = '';
    if (svg) svg.style.display = 'none';
    if (row) row.style.opacity = '';
    return;
  }
  setTimeout(() => { if (row) row.remove(); }, 400);
  toast('Task done! ✅', 'success');
};

window.dismissReminder = async (id) => {
  await supabase.from('reminders').update({ status: 'dismissed' }).eq('id', id);
  load();
};

// ── Add Task modal (kept for showTaskForm() calls from topbar + future) ───────
window.showTaskForm = () => { document.getElementById('task-modal').style.display = 'flex'; };
window.closeTaskModal = () => { document.getElementById('task-modal').style.display = 'none'; };
window.submitTask = async () => {
  const title    = document.getElementById('task-title').value.trim();
  const modSel   = document.getElementById('task-module').value;
  const priority = document.getElementById('task-priority').value;
  const due      = document.getElementById('task-due').value || null;
  const notesRaw = document.getElementById('task-notes').value.trim();
  if (!title) { toast('Enter a title', 'error'); return; }
  const module = storageModule(modSel);
  const notes  = storageNotes(modSel, notesRaw);
  const { error } = await supabase.from('tasks').insert({
    title, module, priority, due_date: due, notes, status: 'open'
  });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Task added!', 'success');
  window.closeTaskModal();
  document.getElementById('task-title').value = '';
  document.getElementById('task-due').value = '';
  document.getElementById('task-notes').value = '';
  load();
};

// ── Recurring Tasks ───────────────────────────────────────────────────────────
const DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function nextOccurrence(pattern, fromDate) {
  // pattern formats: "weekly:Sat,Sun", "weekly:Fri", "biweekly:Mon", "monthly"
  const d = new Date(fromDate + 'T00:00:00');
  const [freq, daysStr] = (pattern || 'weekly:Mon').split(':');
  if (freq === 'weekly' || freq === 'weekly_weekend') {
    const days = freq === 'weekly_weekend' ? ['Sat','Sun'] : (daysStr || 'Mon').split(',').map(s => s.trim());
    const targetNums = days.map(s => DAY_NAMES.indexOf(s)).filter(n => n >= 0);
    for (let i = 1; i <= 14; i++) {
      const next = new Date(d); next.setDate(d.getDate() + i);
      if (targetNums.includes(next.getDay())) return next.toISOString().split('T')[0];
    }
  } else if (freq === 'biweekly') {
    const day = DAY_NAMES.indexOf((daysStr || 'Mon').trim());
    for (let i = 8; i <= 21; i++) {
      const next = new Date(d); next.setDate(d.getDate() + i);
      if (next.getDay() === day) return next.toISOString().split('T')[0];
    }
  } else if (freq === 'monthly') {
    const next = new Date(d); next.setMonth(next.getMonth() + 1);
    return next.toISOString().split('T')[0];
  }
  const next = new Date(d); next.setDate(d.getDate() + 7);
  return next.toISOString().split('T')[0];
}

function patternLabel(pattern) {
  if (!pattern) return 'Recurring';
  const [freq, daysStr] = pattern.split(':');
  if (freq === 'weekly_weekend') return 'Every weekend';
  if (freq === 'weekly') {
    const days = (daysStr || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!days.length) return 'Weekly';
    if (days.join(',') === 'Sat,Sun' || days.join(',') === 'Sun,Sat') return 'Every weekend';
    return 'Every ' + days.join(' & ');
  }
  if (freq === 'biweekly') return 'Every other ' + (daysStr || 'week');
  if (freq === 'monthly') return 'Monthly';
  return pattern;
}

async function loadRecurring() {
  const el = document.getElementById('recurring-section');
  if (!el) return;

  const { data } = await supabase.from('reminders')
    .select('*')
    .eq('recurring', true)
    .order('title');

  const items = (data || []);

  el.innerHTML = `<div class="card" style="margin-bottom:12px">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>🔄 Recurring Tasks${items.length ? ` <span class="badge badge-gray">${items.length}</span>` : ''}</span>
      <button class="btn btn-sm btn-ghost" onclick="showRecurringForm()">+ Add</button>
    </div>
    ${!items.length
      ? '<div style="text-align:center;color:var(--gray-400);padding:12px;font-size:13px">No recurring tasks yet</div>'
      : items.map(r => {
          const isOverdue = r.due_date && r.due_date <= T;
          const isActive  = r.status === 'active';
          return `
          <div class="list-item">
            <div class="list-item-left">
              <div class="list-item-name" style="${!isActive ? 'color:var(--gray-400)' : ''}">${r.title}</div>
              <div class="list-item-sub">
                ${patternLabel(r.recurrence_pattern)}
                ${r.module ? ' · ' + r.module : ''}
                ${r.due_date ? ` · ${isOverdue ? `<span style="color:var(--red)">Due ${fmtDate(r.due_date)}</span>` : `Next ${fmtDate(r.due_date)}`}` : ''}
              </div>
              ${r.notes ? `<div style="font-size:13px;color:var(--gray-600);margin-top:2px">${r.notes}</div>` : ''}
            </div>
            <div class="list-item-right" style="display:flex;gap:4px;align-items:center">
              ${isActive
                ? `<button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;font-size:11px;padding:3px 8px"
                     onclick="doneRecurring(${r.id}, '${r.recurrence_pattern || 'weekly:Mon'}')" title="Mark done, schedule next">✓ Done</button>`
                : `<button class="btn btn-sm" style="background:#eff6ff;color:var(--blue);border:none;font-size:11px;padding:3px 8px"
                     onclick="reactivateRecurring(${r.id})" title="Reactivate">Reactivate</button>`}
              <button class="btn btn-sm btn-ghost" style="font-size:11px;padding:3px 8px"
                onclick="toggleRecurring(${r.id}, ${!isActive})" title="${isActive ? 'Pause' : 'Resume'}">
                ${isActive ? '⏸' : '▶'}
              </button>
            </div>
          </div>`;
        }).join('')
    }
  </div>`;
}

window.doneRecurring = async (id, pattern) => {
  const nextDue = nextOccurrence(pattern, T);
  await supabase.from('reminders').update({ status: 'active', due_date: nextDue }).eq('id', id);
  toast(`✅ Done! Next: ${fmtDate(nextDue)}`, 'success');
  loadRecurring();
};

window.reactivateRecurring = async (id) => {
  await supabase.from('reminders').update({ status: 'active' }).eq('id', id);
  toast('Recurring task reactivated 🔄', 'success');
  loadRecurring();
};

window.toggleRecurring = async (id, makeActive) => {
  await supabase.from('reminders').update({ status: makeActive ? 'active' : 'dismissed' }).eq('id', id);
  loadRecurring();
};

window.showRecurringForm = () => {
  document.getElementById('recurring-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rec-title').focus(), 50);
};
window.closeRecurringModal = () => {
  document.getElementById('recurring-modal').style.display = 'none';
};
window.submitRecurring = async () => {
  const title     = document.getElementById('rec-title').value.trim();
  const module    = document.getElementById('rec-module').value;
  const frequency = document.getElementById('rec-frequency').value;
  const notes     = document.getElementById('rec-notes').value.trim();
  if (!title) { toast('Enter a title', 'error'); return; }

  const nextDue = nextOccurrence(frequency, T);
  const { error } = await supabase.from('reminders').insert({
    title, module, notes: notes || null,
    recurring: true, recurrence_pattern: frequency,
    status: 'active', due_date: nextDue,
  });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Recurring task added 🔄', 'success');
  window.closeRecurringModal();
  document.getElementById('rec-title').value = '';
  document.getElementById('rec-notes').value = '';
  loadRecurring();
};

load();
