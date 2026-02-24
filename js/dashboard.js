// Life OS — Dashboard v4 (new nav: School / Apps / Dashboard / Calendar / Tasks)
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong, fmtTime, toast } from './utils.js';
import { initSwipe } from './swipe-handler.js';

const T = today();

async function load() {
  document.getElementById('today-date').textContent = fmtDateLong(T);
  await Promise.all([
    loadCurrentBanner(),
    loadGlance(),
    loadHealthStatus(),
    loadUrgentItems(),
  ]);
}

// ── Sticky current-item banner ─────────────────────────────────────────────
async function loadCurrentBanner() {
  const el = document.getElementById('current-banner');
  if (!el) return;

  const now = new Date();
  const timeStr = now.toTimeString().slice(0,5);
  const dow = now.toLocaleDateString('en-US', { weekday: 'long' });
  const isWeekday = ['Monday','Tuesday','Wednesday','Thursday'].includes(dow);
  const isFriday = dow === 'Friday';

  const classRes = await supabase.from('classes').select('*').order('time_start');
  const allClasses = classRes.data || [];

  const todayClasses = allClasses.filter(c => {
    const d = (c.day_of_week || '').trim();
    if (d === 'Mon-Thu') return isWeekday;
    if (d === 'Tue-Thu') return ['Tuesday','Wednesday','Thursday'].includes(dow);
    if (d === 'Friday') return isFriday;
    if (d === 'Monday') return dow === 'Monday';
    return d.toLowerCase().includes(dow.toLowerCase());
  });

  let currentClass = null;
  for (const c of todayClasses) {
    if (!c.time_start) continue;
    const start = c.time_start.slice(0,5);
    const end = c.time_end?.slice(0,5);
    const startMinus = subtractMinutes(start, 5);
    if (timeStr >= startMinus && (!end || timeStr <= end)) {
      currentClass = c;
      break;
    }
  }

  if (currentClass) {
    el.style.display = 'block';
    el.innerHTML = `
      <a href="class.html?id=${currentClass.id}" class="current-banner-inner current-banner-class">
        <div class="current-banner-icon">🏫</div>
        <div class="current-banner-content">
          <div class="current-banner-label">NOW IN CLASS</div>
          <div class="current-banner-title">${currentClass.name}</div>
          ${currentClass.time_start ? `<div class="current-banner-meta">${fmtTime(currentClass.time_start)}${currentClass.time_end ? ' – ' + fmtTime(currentClass.time_end) : ''} · ${currentClass.room ? 'Room ' + currentClass.room : ''}</div>` : ''}
        </div>
        <div class="current-banner-arrow">→</div>
      </a>`;
    return;
  }

  // Show first "Today" task in banner (or fall back to urgent)
  const taskRes = await supabase.from('tasks')
    .select('*').in('status', ['open', 'in_progress']).order('created_at');
  const allBannerTasks = taskRes.data || [];
  const todayBannerTask = allBannerTasks.find(t => {
    try { const p = JSON.parse(t.notes || '{}'); return p?.schedule_label === 'Today'; } catch { return false; }
  }) || allBannerTasks.find(t => t.priority === 'urgent');
  const task = todayBannerTask;
  if (task) {
    const isToday = (() => { try { return JSON.parse(task.notes || '{}')?.schedule_label === 'Today'; } catch { return false; } })();
    el.style.display = 'block';
    el.innerHTML = `
      <div class="current-banner-inner current-banner-task swipe-item" data-id="${task.id}" style="touch-action:pan-y;overflow:hidden;position:relative">
        <div data-swipe-inner style="display:flex;align-items:center;gap:12px;width:100%">
          <div class="current-banner-icon">${isToday ? '📅' : '🔴'}</div>
          <div class="current-banner-content">
            <div class="current-banner-label">${isToday ? 'TODAY' : 'URGENT TASK'} ${task.due_date ? '· Due ' + fmtDate(task.due_date) : ''}</div>
            <div class="current-banner-title">${task.title}</div>
            <div class="current-banner-meta">${task.module} · swipe ← delete · → done</div>
          </div>
        </div>
      </div>`;
    const swipeEl = el.querySelector('.swipe-item');
    if (swipeEl) {
      initSwipe(swipeEl,
        async () => { await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', task.id); toast('Task removed', 'info'); loadCurrentBanner(); loadUrgentItems(); },
        async () => { await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', task.id); toast('Task done! ✅', 'success'); loadCurrentBanner(); loadUrgentItems(); }
      );
    }
    return;
  }
  el.style.display = 'none';
}

function subtractMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m - mins;
  const hh = Math.floor(Math.max(0, total) / 60).toString().padStart(2, '0');
  const mm = (Math.max(0, total) % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// ── At-a-glance stat tiles ─────────────────────────────────────────────────
async function loadGlance() {
  const el = document.getElementById('glance-grid');
  if (!el) return;

  const [studentsRes, allTasksRes, goldRes, wordsRes] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact' }).eq('status', 'Active'),
    supabase.from('tasks').select('notes').in('status', ['open', 'in_progress']),
    supabase.from('gold_transactions').select('id', { count: 'exact' }).eq('distributed', false),
    supabase.from('vocab_words').select('id', { count: 'exact' }).lte('next_review', T),
  ]);

  // Count Today tasks
  const todayCount = (allTasksRes.data || []).filter(t => {
    try { return JSON.parse(t.notes || '{}')?.schedule_label === 'Today'; } catch { return false; }
  }).length;

  const tile = (icon, val, label, href, color) =>
    `<a href="${href}" style="text-decoration:none;background:var(--gray-50);border-radius:8px;border:1px solid var(--gray-100);padding:12px;display:flex;flex-direction:column;gap:2px">
      <div style="font-size:22px;font-weight:700;color:${color}">${val}</div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:500">${icon} ${label}</div>
    </a>`;

  el.innerHTML =
    tile('🎓', studentsRes.count ?? 0, 'Students', 'students.html', 'var(--blue)') +
    tile('📅', todayCount, 'Today', 'tasks.html', todayCount > 0 ? '#f59e0b' : 'var(--gray-400)') +
    tile('🪙', goldRes.count ?? 0, 'Gold Pending', 'daily.html', (goldRes.count ?? 0) > 0 ? 'var(--orange)' : 'var(--gray-400)') +
    tile('🌍', wordsRes.count ?? 0, 'Words Due', 'languages.html', (wordsRes.count ?? 0) > 0 ? 'var(--purple)' : 'var(--gray-400)');
}

// ── Food & Exercise status (no nagging prompts — shows actual state) ────────
async function loadHealthStatus() {
  const el = document.getElementById('health-status');
  if (!el) return;

  const [foodRes, exRes] = await Promise.all([
    supabase.from('food_log').select('meal, description').eq('date', T),
    supabase.from('exercise_log').select('type, duration').eq('date', T),
  ]);

  const meals = foodRes.data || [];
  const exercises = exRes.data || [];
  const hour = new Date().getHours();

  // Case-insensitive map of logged meals
  const loggedByMeal = {};
  for (const f of meals) {
    loggedByMeal[(f.meal || '').toLowerCase()] = f.description;
  }

  const mealSlots = [
    { name: 'Breakfast', afterHour: 7 },
    { name: 'Lunch',     afterHour: 12 },
    { name: 'Dinner',    afterHour: 18 },
  ];

  let html = '';
  for (const { name, afterHour } of mealSlots) {
    const logged = loggedByMeal[name.toLowerCase()];
    if (logged) {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--gray-100)">
        <span style="font-size:13px;font-weight:600;color:var(--gray-600)">${name}</span>
        <span style="font-size:13px;color:var(--gray-800);text-align:right;max-width:60%">${logged}</span>
      </div>`;
    } else if (hour >= afterHour) {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--gray-100)">
        <span style="font-size:13px;font-weight:600;color:var(--gray-400)">${name}</span>
        <button class="btn btn-sm btn-ghost" style="font-size:11px;padding:3px 8px" onclick="quickLogMeal('${name}')">+ Log</button>
      </div>`;
    }
  }

  if (exercises.length) {
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0">
      <span style="font-size:13px;font-weight:600;color:var(--gray-600)">Exercise</span>
      <span style="font-size:13px;color:var(--green)">${exercises.map(e => e.type).join(', ')} ✓</span>
    </div>`;
  } else if (hour >= 8) {
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0">
      <span style="font-size:13px;font-weight:600;color:var(--gray-400)">Exercise</span>
      <a href="health.html" style="font-size:12px;color:var(--blue)">Not logged →</a>
    </div>`;
  }

  el.innerHTML = html || '<div style="color:var(--gray-400);font-size:13px">Nothing logged yet today</div>';
}

window.quickLogMeal = async (meal) => {
  const desc = prompt(`What did you have for ${meal}?`);
  if (!desc?.trim()) return;
  const { error } = await supabase.from('food_log').insert({ date: T, meal, description: desc.trim() });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast(`${meal} logged!`, 'success');
  loadHealthStatus();
};

// ── Helpers for notes JSON (same as tasks.js) ──────────────────────────────
function parseNotesD(t) {
  if (!t.notes) return {};
  try { const p = JSON.parse(t.notes); return typeof p === 'object' && p !== null ? p : {}; } catch { return {}; }
}
function getScheduleLabelD(t) { return parseNotesD(t).schedule_label || null; }
function isRTAdminD(t) { return parseNotesD(t).rt_admin === true; }
function displayModuleD(t) { return isRTAdminD(t) ? 'RT Admin' : (t.module || 'Personal'); }

const MODULE_ICONS_D = { RT: '🏫', 'RT Admin': '🏛️', TOV: '💍', Personal: '👤', Health: '🏃' };

// ── Urgent Items (now: Today Tasks + Gold + Follow-ups) ────────────────────
async function loadUrgentItems() {
  const el = document.getElementById('urgent-items');
  if (!el) return;

  const [tasksRes, goldRes, followupsRes] = await Promise.all([
    supabase.from('tasks').select('*').in('status', ['open', 'in_progress']).order('created_at'),
    supabase.from('gold_transactions').select('*, students(name)').eq('distributed', false),
    supabase.from('student_notes').select('*, students(name)').eq('followup_needed', true).order('date', { ascending: false }).limit(6),
  ]);

  const allTasks          = tasksRes.data || [];
  const todayTasks        = allTasks.filter(t => getScheduleLabelD(t) === 'Today');
  const undistributedGold = goldRes.data || [];
  const followups         = followupsRes.data || [];

  const hasAnything = todayTasks.length || undistributedGold.length || followups.length;
  if (!hasAnything) {
    el.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:16px;font-size:14px">✅ All clear — no tasks for today</div>`;
    return;
  }

  let html = '<div class="card" style="padding:0;overflow:hidden">';

  if (todayTasks.length) {
    html += `<div class="urgent-section" style="background:#fffbeb;border-bottom:1px solid #fde68a">
      <div class="urgent-section-header" style="color:#92400e">📅 Today (${todayTasks.length})
        <span style="font-size:11px;font-weight:400;margin-left:8px">← cancel · → done</span>
      </div>
      ${todayTasks.map(t => `
        <div class="swipe-item urgent-row" data-id="${t.id}" style="touch-action:pan-y;overflow:hidden;position:relative;display:flex;align-items:center;gap:8px">
          <div data-swipe-inner style="flex:1">
            <div class="urgent-row-text">${t.title}</div>
            <div class="urgent-row-meta">${MODULE_ICONS_D[displayModuleD(t)] || ''} ${displayModuleD(t)}${t.due_date ? ' · Due ' + fmtDate(t.due_date) : ''}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;font-size:11px;padding:3px 7px" onclick="doneTask(${t.id}, event)">✓</button>
            <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;font-size:11px;padding:3px 7px" onclick="cancelTask(${t.id}, event)">✕</button>
          </div>
        </div>`).join('')}
    </div>`;
  }

  if (undistributedGold.length) {
    const byStudent = {};
    undistributedGold.forEach(t => { const n = t.students?.name || '?'; byStudent[n] = (byStudent[n] || 0) + t.amount; });
    html += `<div class="urgent-section urgent-section-gold">
      <div class="urgent-section-header">🪙 Gold to Distribute (${undistributedGold.length} transactions)</div>
      ${Object.entries(byStudent).map(([name, amt]) => `
        <div class="urgent-row">
          <div class="urgent-row-text">${name}</div>
          <div class="urgent-row-meta">+${amt} gold pending</div>
        </div>`).join('')}
    </div>`;
  }

  if (followups.length) {
    html += `<div class="urgent-section urgent-section-blue">
      <div class="urgent-section-header">📌 Student Follow-ups (${followups.length})</div>
      ${followups.map(n => `
        <a href="student.html?id=${n.student_id}" class="urgent-row urgent-row-link">
          <div class="urgent-row-text"><strong>${n.students?.name}</strong>: ${n.note.slice(0, 90)}${n.note.length > 90 ? '…' : ''}</div>
          <div class="urgent-row-meta">${fmtDate(n.date)}</div>
        </a>`).join('')}
    </div>`;
  }

  html += '</div>';
  el.innerHTML = html;

  el.querySelectorAll('.swipe-item').forEach(item => {
    const taskId = item.dataset.id;
    initSwipe(item,
      async () => { await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', taskId); toast('Task removed', 'info'); loadUrgentItems(); loadCurrentBanner(); },
      async () => { await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', taskId); toast('Task done! ✅', 'success'); loadUrgentItems(); loadCurrentBanner(); }
    );
  });
}

window.doneTask = async (id, e) => {
  e?.stopPropagation();
  await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id);
  toast('Task done! ✅', 'success');
  loadUrgentItems(); loadCurrentBanner();
};
window.cancelTask = async (id, e) => {
  e?.stopPropagation();
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
  toast('Task removed', 'info');
  loadUrgentItems(); loadCurrentBanner();
};

load();
