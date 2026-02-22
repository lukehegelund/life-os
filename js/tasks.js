// Life OS — Tasks & Reminders
import { supabase } from './supabase.js';
import { today, fmtDate, toast, showEmpty } from './utils.js';
import { startPolling } from './polling.js';

const T = today();
let activeModule = 'All';

const MODULE_ICONS = { RT: '🏫', TOV: '💍', Personal: '👤', Health: '🏃' };
const MODULE_COLORS = { RT: 'var(--blue)', TOV: 'var(--green)', Personal: 'var(--orange)', Health: 'var(--coral)' };

// ── Module filter ─────────────────────────────────────────────────────────────
window.setModule = (mod) => {
  activeModule = mod;
  document.querySelectorAll('.mod-btn').forEach(b => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-ghost');
  });
  document.getElementById(`mod-${mod}`).classList.replace('btn-ghost', 'btn-primary');
  load();
};

// ── Load ──────────────────────────────────────────────────────────────────────
async function load() {
  await Promise.all([loadReminders(), loadTasks()]);
}

// ── Reminders ─────────────────────────────────────────────────────────────────
async function loadReminders() {
  const el = document.getElementById('reminders-section');

  let query = supabase.from('reminders').select('*').eq('status', 'active').order('due_date');
  const res = await query;
  let reminders = res.data || [];
  if (activeModule !== 'All') reminders = reminders.filter(r => r.module === activeModule);

  const overdue = reminders.filter(r => r.due_date && r.due_date <= T);
  const upcoming = reminders.filter(r => !r.due_date || r.due_date > T);

  let html = '';

  if (overdue.length) {
    html += `
      <div class="card" style="border-left:4px solid var(--red);padding:0;overflow:hidden;margin-bottom:12px">
        <div style="padding:10px 16px;background:#fff5f5">
          <div class="urgent-section-header" style="color:var(--red)">⏰ Overdue Reminders (${overdue.length})</div>
          ${overdue.map(r => reminderRow(r, true)).join('')}
        </div>
      </div>`;
  }

  if (upcoming.length) {
    html += `
      <div class="card" style="margin-bottom:12px">
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
  return `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${r.title}</div>
        <div class="list-item-sub">
          ${r.due_date ? (isOverdue ? `<span style="color:var(--red)">Due ${fmtDate(r.due_date)}</span>` : `Due ${fmtDate(r.due_date)}`) : 'No date'}
          ${r.module ? ' · ' + r.module : ''}
          ${r.recurring ? ' · 🔄' : ''}
        </div>
        ${r.notes ? `<div style="font-size:13px;color:var(--gray-600);margin-top:2px">${r.notes}</div>` : ''}
      </div>
      <div class="list-item-right">
        <button class="btn btn-sm btn-ghost" onclick="dismissReminder(${r.id})" title="Dismiss">✓</button>
      </div>
    </div>`;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
async function loadTasks() {
  const res = await supabase.from('tasks')
    .select('*')
    .in('status', ['open', 'in_progress'])
    .order('due_date');

  let tasks = res.data || [];
  if (activeModule !== 'All') tasks = tasks.filter(t => t.module === activeModule);

  // Summary pill
  const summaryEl = document.getElementById('tasks-summary');
  if (summaryEl) {
    const urgentCount = tasks.filter(t => t.priority === 'urgent').length;
    summaryEl.textContent = `${tasks.length} open${urgentCount ? ` · ${urgentCount} urgent` : ''}`;
  }

  const urgentTasks = tasks.filter(t => t.priority === 'urgent');
  const normalTasks = tasks.filter(t => t.priority !== 'urgent');

  let html = '';

  // Urgent block — top, red accent
  if (urgentTasks.length) {
    html += `
      <div class="card" style="border-left:4px solid var(--red);padding:0;overflow:hidden;margin-bottom:12px">
        <div style="padding:10px 16px;background:#fff5f5">
          <div class="urgent-section-header" style="color:var(--red)">🔴 Urgent Tasks (${urgentTasks.length})</div>
          ${renderTaskGroup(urgentTasks)}
        </div>
      </div>`;
  }

  // Normal tasks — grouped by module
  if (normalTasks.length) {
    const ORDER = ['RT', 'TOV', 'Personal', 'Health'];
    const groups = {};
    for (const t of normalTasks) {
      const m = t.module || 'Personal';
      if (!groups[m]) groups[m] = [];
      groups[m].push(t);
    }

    // Sort modules by preferred order
    const sortedMods = Object.keys(groups).sort((a, b) => {
      const ai = ORDER.indexOf(a);
      const bi = ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const mod of sortedMods) {
      const color = MODULE_COLORS[mod] || 'var(--blue)';
      const icon = MODULE_ICONS[mod] || '';
      html += `
        <div class="card" style="border-top:3px solid ${color};margin-bottom:12px">
          <div class="task-group-header">
            <div class="task-group-label">${icon} ${mod}</div>
            <span class="badge badge-gray">${groups[mod].length}</span>
          </div>
          ${renderTaskGroup(groups[mod])}
        </div>`;
    }
  }

  if (!tasks.length) {
    html = '<div class="card" style="text-align:center;color:var(--gray-400);padding:20px;font-size:14px">✅ All tasks done!</div>';
  }

  document.getElementById('tasks-section').innerHTML = html;
  document.getElementById('urgent-tasks-section').innerHTML = '';  // urgent already in tasks-section
}

function renderTaskGroup(tasks) {
  return tasks.map(t => `
    <div class="task-row" id="task-${t.id}">
      <div class="task-check ${t.priority === 'urgent' ? 'urgent-check' : ''}" onclick="markDone(${t.id}, this)">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="display:none" id="check-${t.id}">
          <polyline points="2,6 5,10 11,3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="task-content">
        <div class="task-title">${t.title}</div>
        <div class="task-meta">
          ${t.due_date ? `Due ${fmtDate(t.due_date)}` : ''}
          ${t.due_date && t.notes ? ' · ' : ''}
          ${t.notes ? t.notes : ''}
        </div>
      </div>
    </div>`).join('');
}

// ── Actions ───────────────────────────────────────────────────────────────────
window.markDone = async (id, checkEl) => {
  // Animate check
  checkEl.style.background = 'var(--green)';
  checkEl.style.borderColor = 'var(--green)';
  const svg = document.getElementById(`check-${id}`);
  if (svg) svg.style.display = 'block';

  const row = document.getElementById(`task-${id}`);
  if (row) {
    row.style.opacity = '0.4';
    row.style.transition = 'opacity 0.3s';
  }

  const { error } = await supabase.from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    toast('Error: ' + error.message, 'error');
    checkEl.style.background = '';
    checkEl.style.borderColor = '';
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

// ── Add task modal ─────────────────────────────────────────────────────────────
window.showTaskForm = () => {
  document.getElementById('task-modal').style.display = 'flex';
};
window.closeTaskModal = () => {
  document.getElementById('task-modal').style.display = 'none';
};
window.submitTask = async () => {
  const title = document.getElementById('task-title').value.trim();
  const module = document.getElementById('task-module').value;
  const priority = document.getElementById('task-priority').value;
  const due = document.getElementById('task-due').value || null;
  const notes = document.getElementById('task-notes').value.trim();
  if (!title) { toast('Enter a title', 'error'); return; }
  const { error } = await supabase.from('tasks').insert({
    title, module, priority, due_date: due, notes: notes || null, status: 'open'
  });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Task added!', 'success');
  window.closeTaskModal();
  document.getElementById('task-title').value = '';
  document.getElementById('task-due').value = '';
  document.getElementById('task-notes').value = '';
  load();
};

load();
startPolling(load, 15000);
