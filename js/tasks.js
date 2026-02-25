// Life OS — Tasks (v9: schedule labels, reordering, recurring Today auto-flag)
import { supabase } from './supabase.js';
import { today, fmtDate, toast, showEmpty } from './utils.js';
import { initSwipe } from './swipe-handler.js';

const T = today();
let activeModule = 'All';
let activeScheduleFilter = 'All'; // 'All', 'Today', 'Next Up', 'Later', 'Down the Road', 'Unlabeled'
// User-defined category order (persisted in localStorage)
let categoryOrder = JSON.parse(localStorage.getItem('tasks-cat-order') || 'null') || ['RT', 'RT Admin', 'TOV', 'Personal', 'Health'];
// Task order within each group: { groupKey: [id, id, ...] }
let taskOrderMap = JSON.parse(localStorage.getItem('tasks-item-order') || '{}');

const MODULE_ICONS   = { RT: '🏫', 'RT Admin': '🏛️', TOV: '💍', Personal: '👤', Health: '🏃' };
const MODULE_COLORS  = { RT: 'var(--blue)', 'RT Admin': '#7c3aed', TOV: 'var(--green)', Personal: 'var(--orange)', Health: 'var(--coral)' };

const SCHEDULE_LABELS = ['Today', 'Next Up', 'Later', 'Down the Road'];
const SCHEDULE_COLORS = {
  'Today':         { bg: '#fef9c3', color: '#92400e', border: '#fde68a' },
  'Next Up':       { bg: '#eff6ff', color: 'var(--blue)', border: '#bfdbfe' },
  'Later':         { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' },
  'Down the Road': { bg: 'var(--gray-50)', color: 'var(--gray-400)', border: 'var(--gray-200)' },
};

// ── Notes JSON helpers ────────────────────────────────────────────────────────
function parseNotes(t) {
  if (!t.notes) return {};
  try { const p = JSON.parse(t.notes); return typeof p === 'object' && p !== null ? p : {}; } catch { return {}; }
}
function isRTAdmin(t) { return parseNotes(t).rt_admin === true; }
function displayModule(t) { return isRTAdmin(t) ? 'RT Admin' : (t.module || 'Personal'); }
function storageModule(displayMod) { return displayMod === 'RT Admin' ? 'RT' : displayMod; }
function getScheduleLabel(t) { return parseNotes(t).schedule_label || null; }
function notesDisplay(t) {
  const parsed = parseNotes(t);
  if (Object.keys(parsed).length > 0) return parsed.note || '';
  return t.notes || '';
}

function buildNotesJson(displayMod, notesStr, scheduleLabel) {
  const base = displayMod === 'RT Admin' ? { rt_admin: true } : {};
  if (notesStr) base.note = notesStr;
  if (scheduleLabel) base.schedule_label = scheduleLabel;
  return Object.keys(base).length ? JSON.stringify(base) : null;
}

function storageNotes(displayMod, notesStr) {
  return buildNotesJson(displayMod, notesStr, null);
}

// Update schedule_label in a task's notes JSON
async function setScheduleLabel(taskId, label) {
  const { data } = await supabase.from('tasks').select('notes,module').eq('id', taskId).single();
  if (!data) return;
  const parsed = (() => { try { const p = JSON.parse(data.notes || '{}'); return typeof p === 'object' && p !== null ? p : {}; } catch { return {}; } })();
  if (label) { parsed.schedule_label = label; } else { delete parsed.schedule_label; }
  const newNotes = Object.keys(parsed).length ? JSON.stringify(parsed) : null;
  await supabase.from('tasks').update({ notes: newNotes }).eq('id', taskId);
}

// ── Module filter ─────────────────────────────────────────────────────────────
window.setModule = (mod) => {
  activeModule = mod;
  document.querySelectorAll('.mod-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-ghost'); });
  document.getElementById(`mod-${mod}`)?.classList.replace('btn-ghost', 'btn-primary');
  load();
};

// ── Schedule filter ────────────────────────────────────────────────────────────
window.setScheduleFilter = (filter) => {
  activeScheduleFilter = filter;
  document.querySelectorAll('.sched-filter-btn').forEach(b => {
    b.style.background = '';
    b.style.color = b.dataset.defaultColor || '';
    b.style.fontWeight = '400';
  });
  const activeBtn = document.getElementById(`sf-${filter}`);
  if (activeBtn) {
    activeBtn.style.background = 'var(--gray-900)';
    activeBtn.style.color = 'white';
    activeBtn.style.fontWeight = '600';
  }
  loadTasks();
};

async function load() {
  await Promise.all([loadTasks(), loadFutureProjects(), loadRecurring()]);
}

// ── Schedule Label Picker ──────────────────────────────────────────────────────
let _schedulePendingId = null;

window.openSchedulePicker = (taskId, currentLabel, event) => {
  event?.stopPropagation();
  _schedulePendingId = taskId;
  const picker = document.getElementById('schedule-picker');
  picker.style.display = 'flex';

  // Highlight current
  picker.querySelectorAll('.sched-btn').forEach(btn => {
    const lbl = btn.dataset.label;
    btn.style.fontWeight = lbl === currentLabel ? '700' : '400';
    btn.style.outline = lbl === currentLabel ? '2px solid var(--blue)' : 'none';
  });
};

window.closeSchedulePicker = () => {
  document.getElementById('schedule-picker').style.display = 'none';
  _schedulePendingId = null;
};

window.applyScheduleLabel = async (label) => {
  if (!_schedulePendingId) return;
  const realLabel = label === 'none' ? null : label;
  await setScheduleLabel(_schedulePendingId, realLabel);
  window.closeSchedulePicker();
  toast(realLabel ? `Scheduled: ${realLabel}` : 'Label removed', 'success');
  loadTasks();
};

// ── Task ordering helpers ─────────────────────────────────────────────────────
function saveTaskOrder() {
  localStorage.setItem('tasks-item-order', JSON.stringify(taskOrderMap));
}

// Sort tasks by stored order for a given group key
function applyTaskOrder(tasks, groupKey) {
  const order = taskOrderMap[groupKey];
  if (!order || !order.length) return tasks;
  const indexMap = {};
  order.forEach((id, i) => { indexMap[id] = i; });
  return [...tasks].sort((a, b) => {
    const ai = indexMap[a.id] !== undefined ? indexMap[a.id] : 9999;
    const bi = indexMap[b.id] !== undefined ? indexMap[b.id] : 9999;
    return ai - bi;
  });
}

// Move a task up or down within its group
window.moveTask = (taskId, groupKey, direction) => {
  const order = taskOrderMap[groupKey] || [];
  // Ensure all task IDs in the group are in the order array
  // We rebuild from the current DOM order to capture IDs not yet in storage
  const groupEl = document.getElementById(`task-group-${groupKey.replace(/\s+/g, '-')}`);
  const currentIds = groupEl
    ? [...groupEl.querySelectorAll('.task-swipe-row')].map(el => parseInt(el.dataset.id, 10))
    : order.slice();

  // Merge: start from current DOM order, fill in any missing from stored order
  let merged = currentIds.length ? currentIds : (taskOrderMap[groupKey] || []);
  taskOrderMap[groupKey] = merged;

  const idx = merged.indexOf(taskId);
  if (idx === -1) return;

  if (direction === 'up' && idx > 0) {
    [merged[idx - 1], merged[idx]] = [merged[idx], merged[idx - 1]];
  } else if (direction === 'down' && idx < merged.length - 1) {
    [merged[idx], merged[idx + 1]] = [merged[idx + 1], merged[idx]];
  } else {
    return; // already at edge
  }

  taskOrderMap[groupKey] = merged;
  saveTaskOrder();

  // Re-render just this group by re-ordering DOM nodes (fast, no network)
  if (groupEl) {
    const rows = [...groupEl.querySelectorAll('.task-swipe-row')];
    const rowMap = {};
    rows.forEach(r => { rowMap[parseInt(r.dataset.id, 10)] = r; });
    merged.forEach(id => {
      if (rowMap[id]) groupEl.appendChild(rowMap[id]);
    });
    // Update arrow button states
    updateArrowStates(groupKey, merged);
  }
};

function updateArrowStates(groupKey, order) {
  order.forEach((id, idx) => {
    const upBtn  = document.getElementById(`up-${id}`);
    const downBtn = document.getElementById(`dn-${id}`);
    if (upBtn)   upBtn.disabled  = idx === 0;
    if (downBtn) downBtn.disabled = idx === order.length - 1;
    if (upBtn)   upBtn.style.opacity  = idx === 0 ? '0.3' : '1';
    if (downBtn) downBtn.style.opacity = idx === order.length - 1 ? '0.3' : '1';
  });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
async function loadTasks() {
  const res = await supabase.from('tasks')
    .select('*')
    .in('status', ['open', 'in_progress'])
    .order('created_at');

  let tasks = res.data || [];
  if (activeModule === 'RT Admin') {
    tasks = tasks.filter(t => isRTAdmin(t));
  } else if (activeModule !== 'All') {
    tasks = tasks.filter(t => t.module === activeModule && !isRTAdmin(t));
  }

  // Apply schedule filter
  if (activeScheduleFilter !== 'All') {
    if (activeScheduleFilter === 'Unlabeled') {
      tasks = tasks.filter(t => !getScheduleLabel(t));
    } else {
      tasks = tasks.filter(t => getScheduleLabel(t) === activeScheduleFilter);
    }
  }

  const summaryEl = document.getElementById('tasks-summary');
  const todayTasks = tasks.filter(t => getScheduleLabel(t) === 'Today');
  if (summaryEl) {
    const filterLabel = activeScheduleFilter !== 'All' ? ` · filtered: ${activeScheduleFilter}` : '';
    summaryEl.textContent = `${tasks.length} open${todayTasks.length && activeScheduleFilter === 'All' ? ` · ${todayTasks.length} today` : ''}${filterLabel}`;
  }

  // When a schedule filter is active, show all tasks in a flat Today section (or just grouped)
  // Separate Today from the rest only when showing All schedules
  const nonTodayTasks = activeScheduleFilter !== 'All'
    ? tasks // all shown in modules when filtering
    : tasks.filter(t => getScheduleLabel(t) !== 'Today');
  const todayDisplay = activeScheduleFilter !== 'All' ? [] : todayTasks;

  let html = '';

  // ── Today section (only when showing All schedules) ──
  if (todayDisplay.length) {
    const todayGroupKey = '__today__';
    const orderedToday = applyTaskOrder(todayDisplay, todayGroupKey);
    html += `<div class="card" style="border-left:4px solid #f59e0b;padding:0;overflow:hidden;margin-bottom:12px">
      <div style="padding:10px 16px;background:#fffbeb">
        <div class="urgent-section-header" style="color:#92400e">📅 Today (${orderedToday.length})</div>
        <div id="task-group-${todayGroupKey.replace(/\s+/g, '-')}" class="task-group-body">
          ${renderTaskGroup(orderedToday, true, todayGroupKey)}
        </div>
      </div>
    </div>`;
  }

  // ── Normal tasks grouped by module ──
  if (nonTodayTasks.length) {
    const groups = {};
    for (const t of nonTodayTasks) {
      const m = displayModule(t);
      if (!groups[m]) groups[m] = [];
      groups[m].push(t);
    }
    const sortedMods = Object.keys(groups).sort((a, b) => {
      const ai = categoryOrder.indexOf(a); const bi = categoryOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const mod of sortedMods) {
      const color  = MODULE_COLORS[mod] || 'var(--blue)';
      const icon   = MODULE_ICONS[mod] || '';
      const safeId = mod.replace(/\s+/g, '-');
      const groupKey = mod;
      const orderedGroup = applyTaskOrder(groups[mod], groupKey);
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
        <div id="task-group-${safeId}" class="task-group-body">
          ${renderTaskGroup(orderedGroup, false, groupKey)}
        </div>
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

  // Apply arrow button states for all groups
  setTimeout(() => {
    // Today group
    const todayGroupKey = '__today__';
    const todayOrder = taskOrderMap[todayGroupKey];
    if (todayOrder) updateArrowStates(todayGroupKey, todayOrder);
    // Module groups
    for (const key of Object.keys(taskOrderMap)) {
      if (key !== todayGroupKey) updateArrowStates(key, taskOrderMap[key]);
    }
  }, 0);

  // Swipe gestures
  document.querySelectorAll('.task-swipe-row').forEach(item => {
    const taskId = item.dataset.id;
    initSwipe(item,
      async () => { await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', taskId); toast('Task removed', 'info'); load(); },
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

function renderTaskGroup(tasks, inTodaySection, groupKey) {
  return tasks.map((t, idx) => {
    const label = getScheduleLabel(t);
    const sc = label && SCHEDULE_COLORS[label] ? SCHEDULE_COLORS[label] : null;
    const labelBadge = label ? `<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:${sc?.bg};color:${sc?.color};border:1px solid ${sc?.border};font-weight:600;white-space:nowrap">${label}</span>` : '';
    const modLabel = !inTodaySection ? '' : `<span style="font-size:11px;color:var(--gray-400)">${MODULE_ICONS[displayModule(t)] || ''} ${displayModule(t)}</span>`;
    const isFirst = idx === 0;
    const isLast  = idx === tasks.length - 1;
    return `
    <div class="task-row task-swipe-row" id="task-${t.id}" data-id="${t.id}" style="touch-action:pan-y;overflow:hidden;position:relative;display:flex;align-items:center;gap:8px">
      <div data-swipe-inner style="display:flex;align-items:flex-start;gap:10px;flex:1">
        <div class="task-check ${t.priority === 'urgent' ? 'urgent-check' : ''}" onclick="markDone(${t.id}, this)">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="display:none" id="check-${t.id}">
            <polyline points="2,6 5,10 11,3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="task-content" style="flex:1;min-width:0">
          <div class="task-title" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${t.title}
          </div>
          <div class="task-meta" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px">
            ${t.due_date ? `<span>Due ${fmtDate(t.due_date)}</span>` : ''}
            ${modLabel}
            ${notesDisplay(t) ? `<span style="color:var(--gray-500)">${notesDisplay(t)}</span>` : ''}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:3px;flex-shrink:0;align-items:center" ontouchstart="event.stopPropagation()" onclick="event.stopPropagation()">
        <div style="display:flex;flex-direction:column;gap:1px">
          <button id="up-${t.id}" class="btn btn-sm" style="background:var(--gray-100);color:var(--gray-500);border:none;font-size:10px;padding:2px 5px;line-height:1;${isFirst ? 'opacity:0.3' : ''}"
            onclick="moveTask(${t.id}, '${groupKey}', 'up')" title="Move up" ${isFirst ? 'disabled' : ''}>▲</button>
          <button id="dn-${t.id}" class="btn btn-sm" style="background:var(--gray-100);color:var(--gray-500);border:none;font-size:10px;padding:2px 5px;line-height:1;${isLast ? 'opacity:0.3' : ''}"
            onclick="moveTask(${t.id}, '${groupKey}', 'down')" title="Move down" ${isLast ? 'disabled' : ''}>▼</button>
        </div>
        <button class="btn btn-sm" style="background:#f3f4f6;color:#6b7280;border:none;font-size:13px;padding:4px 6px;line-height:1"
          onclick="openSchedulePicker(${t.id}, ${label ? `'${label}'` : 'null'}, event)" title="Schedule">📅</button>
        <button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;font-size:11px;padding:3px 8px"
          onclick="markDoneById(${t.id}, event)" title="Mark done">✓</button>
        <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;font-size:11px;padding:3px 8px"
          onclick="deleteTask(${t.id}, event)" title="Delete task">✕</button>
      </div>
    </div>`;
  }).join('');
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
window.catDragStart = (e) => { const card = e.currentTarget; dragSrcModule = card.dataset.module; card.style.opacity = '0.5'; e.dataTransfer.effectAllowed = 'move'; };
window.catDragOver  = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.style.outline = '2px dashed var(--blue)'; };
window.catDrop = (e) => {
  e.preventDefault();
  const targetCard = e.currentTarget;
  const targetModule = targetCard.dataset.module;
  if (!dragSrcModule || dragSrcModule === targetModule) return;
  const srcIdx = categoryOrder.indexOf(dragSrcModule);
  const tgtIdx = categoryOrder.indexOf(targetModule);
  if (srcIdx !== -1 && tgtIdx !== -1) {
    [categoryOrder[srcIdx], categoryOrder[tgtIdx]] = [categoryOrder[tgtIdx], categoryOrder[srcIdx]];
  } else if (srcIdx !== -1) {
    categoryOrder.splice(srcIdx, 1); categoryOrder.splice(tgtIdx, 0, dragSrcModule);
  }
  localStorage.setItem('tasks-cat-order', JSON.stringify(categoryOrder));
  targetCard.style.outline = '';
  loadTasks();
};
window.catDragEnd = (e) => { e.currentTarget.style.opacity = ''; e.currentTarget.style.outline = ''; dragSrcModule = null; };

// ── Future Projects ───────────────────────────────────────────────────────────
async function loadFutureProjects() {
  const el = document.getElementById('future-projects-section');
  if (!el) return;

  const { data } = await supabase.from('tasks').select('*').eq('status', 'future').order('created_at', { ascending: false });
  let projects = data || [];
  if (activeModule === 'RT Admin') projects = projects.filter(p => isRTAdmin(p));
  else if (activeModule !== 'All') projects = projects.filter(p => p.module === activeModule && !isRTAdmin(p));

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
          ${p.notes ? `<div class="list-item-sub">${notesDisplay(p)}</div>` : ''}
          ${p.module ? `<div class="list-item-sub">${MODULE_ICONS[displayModule(p)] || ''} ${displayModule(p)}</div>` : ''}
        </div>
        <div class="list-item-right" style="display:flex;gap:4px">
          <button class="btn btn-sm" style="background:var(--blue);color:white;border:none;font-size:11px;padding:3px 8px"
            onclick="activateProject(${p.id})">Activate</button>
          <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;font-size:11px;padding:3px 8px"
            onclick="deleteTask(${p.id}, event)">✕</button>
        </div>
      </div>`).join('')}
  </div>`;
}

window.showFutureForm = () => { document.getElementById('future-modal').style.display = 'flex'; setTimeout(() => document.getElementById('future-title').focus(), 50); };
window.closeFutureModal = () => { document.getElementById('future-modal').style.display = 'none'; };
window.submitFutureProject = async () => {
  const title   = document.getElementById('future-title').value.trim();
  const modSel  = document.getElementById('future-module').value;
  const notesRaw = document.getElementById('future-notes').value.trim();
  if (!title) { toast('Enter a title', 'error'); return; }
  const module = storageModule(modSel);
  const notes  = storageNotes(modSel, notesRaw);
  const { error } = await supabase.from('tasks').insert({ title, module, notes, status: 'future', priority: 'normal' });
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
  const { error } = await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id);
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

// ── Add Task modal ────────────────────────────────────────────────────────────
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
  const { error } = await supabase.from('tasks').insert({ title, module, priority, due_date: due, notes, status: 'open' });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Task added!', 'success');
  window.closeTaskModal();
  document.getElementById('task-title').value = '';
  document.getElementById('task-due').value = '';
  document.getElementById('task-notes').value = '';
  load();
};

// ── Recurring Tasks ───────────────────────────────────────────────────────────
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function nextOccurrence(pattern, fromDate) {
  const d = new Date(fromDate + 'T00:00:00');
  const [freq, daysStr] = (pattern || 'weekly:Mon').split(':');
  if (freq === 'daily') {
    const next = new Date(d); next.setDate(d.getDate() + 1);
    return next.toISOString().split('T')[0];
  } else if (freq === 'weekdays') {
    for (let i = 1; i <= 7; i++) {
      const next = new Date(d); next.setDate(d.getDate() + i);
      if (next.getDay() >= 1 && next.getDay() <= 5) return next.toISOString().split('T')[0];
    }
  } else if (freq === 'weekly' || freq === 'weekly_weekend') {
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
  if (freq === 'daily') return 'Every day';
  if (freq === 'weekdays') return 'Every weekday';
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
  const { data } = await supabase.from('reminders').select('*').eq('recurring', true).order('title');
  const items = data || [];

  // Sort: due today or overdue first, then future, then paused
  const sorted = [...items].sort((a, b) => {
    const aDue = a.due_date && a.due_date <= T && a.status === 'active';
    const bDue = b.due_date && b.due_date <= T && b.status === 'active';
    if (aDue && !bDue) return -1;
    if (!aDue && bDue) return 1;
    const aActive = a.status === 'active'; const bActive = b.status === 'active';
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });

  el.innerHTML = `<div class="card" style="margin-bottom:12px;border-top:3px solid #8b5cf6">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>🔄 Repeated Tasks${items.length ? ` <span class="badge badge-gray">${items.length}</span>` : ''}</span>
      <button class="btn btn-sm" style="background:#f5f3ff;color:#7c3aed;border:none;font-size:12px" onclick="showRecurringForm()">+ Add Repeated Task</button>
    </div>
    <div style="font-size:12px;color:var(--gray-400);margin:-4px 0 10px">Tasks that automatically come back on a schedule</div>
    ${!sorted.length
      ? '<div style="text-align:center;color:var(--gray-400);padding:12px;font-size:13px">No recurring tasks yet</div>'
      : sorted.map(r => {
          const isDueToday = r.due_date && r.due_date === T && r.status === 'active';
          const isOverdue  = r.due_date && r.due_date < T && r.status === 'active';
          const isActive   = r.status === 'active';
          const todayBadge = (isDueToday || isOverdue)
            ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#fef9c3;color:#92400e;border:1px solid #fde68a;font-weight:700;margin-left:4px">📅 Today</span>`
            : '';
          return `
          <div class="list-item" style="${isDueToday || isOverdue ? 'background:#fffbeb;border-radius:10px;margin-bottom:4px;padding:8px 10px' : ''}">
            <div class="list-item-left">
              <div class="list-item-name" style="display:flex;align-items:center;gap:4px;${!isActive ? 'color:var(--gray-400)' : ''}">
                ${r.title}${todayBadge}
              </div>
              <div class="list-item-sub">
                ${patternLabel(r.recurrence_pattern)}
                ${r.module ? ' · ' + r.module : ''}
                ${r.due_date
                  ? ` · ${isOverdue
                      ? `<span style="color:var(--red)">Overdue: ${fmtDate(r.due_date)}</span>`
                      : isDueToday
                        ? `<span style="color:#92400e;font-weight:600">Due today!</span>`
                        : `Next ${fmtDate(r.due_date)}`}`
                  : ''}
              </div>
              ${r.notes ? `<div style="font-size:13px;color:var(--gray-600);margin-top:2px">${r.notes}</div>` : ''}
            </div>
            <div class="list-item-right" style="display:flex;gap:4px;align-items:center">
              ${isActive
                ? `<button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;font-size:11px;padding:3px 8px"
                     onclick="doneRecurring(${r.id}, '${r.recurrence_pattern || 'weekly:Mon'}')">✓ Done</button>`
                : `<button class="btn btn-sm" style="background:#eff6ff;color:var(--blue);border:none;font-size:11px;padding:3px 8px"
                     onclick="reactivateRecurring(${r.id})">Reactivate</button>`}
              <button class="btn btn-sm btn-ghost" style="font-size:11px;padding:3px 8px"
                onclick="toggleRecurring(${r.id}, ${!isActive})">${isActive ? '⏸' : '▶'}</button>
            </div>
          </div>`;
        }).join('')
    }
  </div>`;
}

window.doneRecurring = async (id, pattern) => {
  const nextDue = nextOccurrence(pattern, T);
  // If next due date is today or in the past, auto-flag as Today in the main tasks section
  // We update the reminder's next due date and mark it active again
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
window.showRecurringForm = () => { document.getElementById('recurring-modal').style.display = 'flex'; setTimeout(() => document.getElementById('rec-title').focus(), 50); };
window.closeRecurringModal = () => { document.getElementById('recurring-modal').style.display = 'none'; };
window.submitRecurring = async () => {
  const title     = document.getElementById('rec-title').value.trim();
  const module    = document.getElementById('rec-module').value;
  const frequency = document.getElementById('rec-frequency').value;
  const notes     = document.getElementById('rec-notes').value.trim();
  if (!title) { toast('Enter a title', 'error'); return; }
  // First occurrence: if it's due today or overdue, start from today
  const firstDue = T; // set the first due to today so it shows as Today immediately
  const { error } = await supabase.from('reminders').insert({
    title, module, notes: notes || null, recurring: true, recurrence_pattern: frequency,
    status: 'active', due_date: firstDue,
  });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Recurring task added 🔄 — shows as Today until marked done', 'success');
  window.closeRecurringModal();
  document.getElementById('rec-title').value = '';
  document.getElementById('rec-notes').value = '';
  loadRecurring();
};

load();
