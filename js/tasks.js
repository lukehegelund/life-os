// Life OS — Tasks & Reminders
import { supabase } from './supabase.js';
import { today, fmtDate, badge, toast, showEmpty } from './utils.js';
import { startPolling } from './polling.js';

const T = today();

async function load() {
  await Promise.all([loadTasks(), loadReminders()]);
}

async function loadTasks() {
  const el = document.getElementById('tasks-list');
  const res = await supabase.table('tasks')
    .select('*, students(name), tov_clients(name)')
    .in('status', ['open', 'in_progress'])
    .order('priority')
    .order('due_date');
  const tasks = res.data || [];
  if (!tasks.length) { showEmpty(el, '✅', 'No open tasks'); return; }

  const priorityOrder = { urgent: 0, normal: 1, someday: 2 };
  const priorityColors = { urgent: 'red', normal: 'blue', someday: 'gray' };
  const moduleColors = { RT: 'blue', TOV: 'green', Health: 'coral', Languages: 'purple', Personal: 'orange', System: 'gray' };

  // Group by module
  const groups = {};
  for (const t of tasks) {
    const m = t.module || 'Personal';
    if (!groups[m]) groups[m] = [];
    groups[m].push(t);
  }

  el.innerHTML = Object.entries(groups).map(([mod, items]) => `
    <div class="section-label">${mod}</div>
    ${items.map(t => `
      <div class="list-item" id="task-${t.id}">
        <div class="list-item-left">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <input type="checkbox" style="width:16px;height:16px;cursor:pointer" onchange="markDone(${t.id}, this.checked)">
            <span class="list-item-name" style="font-size:15px">${t.title}</span>
          </div>
          <div class="list-item-sub">
            ${t.due_date ? `Due: ${fmtDate(t.due_date)} · ` : ''}
            ${t.students?.name ? `👤 ${t.students.name} · ` : ''}
            ${t.tov_clients?.name ? `💍 ${t.tov_clients.name} · ` : ''}
            ${badge(t.priority, priorityColors[t.priority])}
          </div>
          ${t.notes ? `<div style="font-size:13px;color:var(--gray-600);margin-top:2px">${t.notes}</div>` : ''}
        </div>
      </div>`).join('')}`).join('');
}

async function loadReminders() {
  const el = document.getElementById('reminders-list');
  const res = await supabase.table('reminders')
    .select('*')
    .eq('status', 'active')
    .order('due_date');
  const reminders = res.data || [];
  if (!reminders.length) { showEmpty(el, '🔔', 'No active reminders'); return; }
  el.innerHTML = reminders.map(r => {
    const overdue = r.due_date && r.due_date < T;
    return `
      <div class="list-item">
        <div class="list-item-left">
          <div class="list-item-name">${r.title}</div>
          <div class="list-item-sub">${r.due_date ? fmtDate(r.due_date) : 'No date'}${r.recurring ? ' · 🔄 recurring' : ''}${r.module ? ' · ' + r.module : ''}</div>
          ${r.notes ? `<div style="font-size:13px;color:var(--gray-600)">${r.notes}</div>` : ''}
        </div>
        <div class="list-item-right">
          ${overdue ? '<span class="badge badge-red">Overdue</span>' : ''}
          <button class="btn btn-sm btn-ghost" onclick="dismissReminder(${r.id})">✓</button>
        </div>
      </div>`;
  }).join('');
}

window.markDone = async (id, checked) => {
  if (!checked) return;
  const { error } = await supabase.table('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  const el = document.getElementById(`task-${id}`);
  if (el) {
    el.style.opacity = '0.4';
    el.style.textDecoration = 'line-through';
    setTimeout(() => el.remove(), 800);
  }
  toast('Task done! ✅', 'success');
};

window.dismissReminder = async (id) => {
  await supabase.table('reminders').update({ status: 'dismissed' }).eq('id', id);
  load();
};

// Add task form
window.showTaskForm = () => { document.getElementById('task-modal').style.display = 'flex'; };
window.closeTaskModal = () => { document.getElementById('task-modal').style.display = 'none'; };
window.submitTask = async () => {
  const title = document.getElementById('task-title').value.trim();
  const module = document.getElementById('task-module').value;
  const priority = document.getElementById('task-priority').value;
  const due = document.getElementById('task-due').value || null;
  const notes = document.getElementById('task-notes').value.trim();
  if (!title) { toast('Enter a title', 'error'); return; }
  const { error } = await supabase.table('tasks').insert({ title, module, priority, due_date: due, notes: notes || null });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Task added!', 'success');
  window.closeTaskModal();
  loadTasks();
};

load();
startPolling(load, 15000);
