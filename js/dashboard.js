// Life OS — Dashboard (Phase 2)
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong, fmtTime, toast } from './utils.js';
// No polling on dashboard
import { initSwipe } from './swipe-handler.js';

const T = today();

async function load() {
  document.getElementById('today-date').textContent = fmtDateLong(T);
  await Promise.all([
    loadCurrentBanner(),
    loadStats(),
    loadHealthPrompts(),
    loadUrgentItems(),
    loadTodaysClasses(),
    loadUpcomingWeddings(),
  ]);
}

// ── Sticky current-item banner ─────────────────────────────────────────────
async function loadCurrentBanner() {
  const el = document.getElementById('current-banner');
  if (!el) return;

  const now = new Date();
  const timeStr = now.toTimeString().slice(0,5); // HH:MM

  // Find current class (within time window)
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

  // Find class currently happening (within 15 min before start to end time)
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

  // No current class — show top urgent task with swipe
  const taskRes = await supabase.from('tasks')
    .select('*')
    .eq('status', 'open')
    .eq('priority', 'urgent')
    .order('due_date')
    .limit(1);
  const task = taskRes.data?.[0];

  if (task) {
    el.style.display = 'block';
    el.innerHTML = `
      <div class="current-banner-inner current-banner-task swipe-item" data-id="${task.id}" style="touch-action:pan-y;overflow:hidden;position:relative">
        <div data-swipe-inner style="display:flex;align-items:center;gap:12px;width:100%">
          <div class="current-banner-icon">🔴</div>
          <div class="current-banner-content">
            <div class="current-banner-label">URGENT TASK ${task.due_date ? '· Due ' + fmtDate(task.due_date) : ''}</div>
            <div class="current-banner-title">${task.title}</div>
            <div class="current-banner-meta">${task.module} · swipe ← delete · → done</div>
          </div>
        </div>
      </div>`;

    const swipeEl = el.querySelector('.swipe-item');
    if (swipeEl) {
      initSwipe(swipeEl,
        // LEFT = delete task
        async () => {
          await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', task.id);
          toast('Task removed', 'info');
          loadCurrentBanner();
          loadUrgentItems();
        },
        // RIGHT = mark done
        async () => {
          await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', task.id);
          toast('Task done! ✅', 'success');
          loadCurrentBanner();
          loadUrgentItems();
        }
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

// ── Stats ──────────────────────────────────────────────────────────────────
async function loadStats() {
  const [studentsRes, clientsRes, wordsRes, exerciseRes, tasksRes] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact' }).eq('status', 'Active'),
    supabase.from('tov_clients').select('id', { count: 'exact' }),
    supabase.from('vocab_words').select('id', { count: 'exact' }).lte('next_review', T),
    supabase.from('exercise_log').select('date').order('date', { ascending: false }).limit(1),
    supabase.from('tasks').select('id', { count: 'exact' }).eq('status', 'open'),
  ]);

  const lastEx = exerciseRes.data?.[0]?.date;
  const daysSince = lastEx ? Math.floor((new Date(T) - new Date(lastEx)) / 86400000) : null;
  const exDisplay = daysSince === null ? 'No log' : daysSince === 0 ? 'Today ✓' : `${daysSince}d ago`;
  const exColor = (daysSince === null || daysSince > 2) ? '#E8563A' : daysSince === 0 ? '#16a34a' : '#D97706';

  document.getElementById('stats-grid').innerHTML = `
    <a href="students.html" class="stat-card" style="border-top:3px solid var(--blue)">
      <div class="stat-num">${studentsRes.count ?? 0}</div>
      <div class="stat-lbl">Students</div>
    </a>
    <a href="tov.html" class="stat-card" style="border-top:3px solid var(--green)">
      <div class="stat-num">${clientsRes.count ?? 0}</div>
      <div class="stat-lbl">TOV Clients</div>
    </a>
    <a href="languages.html" class="stat-card" style="border-top:3px solid var(--purple)">
      <div class="stat-num">${wordsRes.count ?? 0}</div>
      <div class="stat-lbl">Words Due</div>
    </a>
    <a href="health.html" class="stat-card" style="border-top:3px solid ${exColor}">
      <div class="stat-num" style="font-size:1rem;color:${exColor}">${exDisplay}</div>
      <div class="stat-lbl">Last Exercise</div>
    </a>
    <a href="tasks.html" class="stat-card" style="border-top:3px solid var(--orange)">
      <div class="stat-num">${tasksRes.count ?? 0}</div>
      <div class="stat-lbl">Open Tasks</div>
    </a>
    <a href="parents.html" class="stat-card" style="border-top:3px solid var(--coral)">
      <div class="stat-num">📞</div>
      <div class="stat-lbl">Parent CRM</div>
    </a>
  `;
}

// ── Health Prompts ────────────────────────────────────────────────────────
async function loadHealthPrompts() {
  const el = document.getElementById('health-prompts');
  if (!el) return;

  const hour = new Date().getHours();
  const prompts = [];

  const foodRes = await supabase.from('food_log').select('meal').eq('date', T);
  const loggedMeals = new Set((foodRes.data || []).map(f => f.meal));

  const mealWindows = [
    { meal: 'Breakfast', afterHour: 7 },
    { meal: 'Lunch', afterHour: 12 },
    { meal: 'Dinner', afterHour: 18 },
  ];
  for (const { meal, afterHour } of mealWindows) {
    const key = 'dismissed-meal-' + meal;
    if (hour >= afterHour && !loggedMeals.has(meal) && !sessionStorage.getItem(key)) {
      prompts.push({ type: 'food', meal });
    }
  }

  const exRes = await supabase.from('exercise_log').select('date').order('date', { ascending: false }).limit(1);
  const lastEx = exRes.data?.[0]?.date;
  const daysSince = lastEx ? Math.floor((new Date(T) - new Date(lastEx)) / 86400000) : 999;
  const exToday = (await supabase.from('exercise_log').select('id').eq('date', T)).data;
  if (daysSince >= 3 && !exToday?.length && !sessionStorage.getItem('dismissed-exercise-today')) {
    prompts.push({ type: 'exercise', daysSince });
  }

  if (!prompts.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';

  el.innerHTML = `
    <div class="card" style="border-left:4px solid var(--coral)">
      <div class="card-title" style="margin-bottom:10px">🏃 Health Check-In</div>
      ${prompts.map(p => p.type === 'food' ? `
        <div class="prompt-row">
          <span class="prompt-text">Did you have <strong>${p.meal}</strong> today?</span>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn btn-sm" style="background:var(--coral);color:#fff;border:none" onclick="logMealPrompt('${p.meal}')">Log it</button>
            <button class="btn btn-sm btn-ghost" onclick="dismissPrompt('meal-${p.meal}',this.closest('.prompt-row'))">Skip</button>
          </div>
        </div>` : `
        <div class="prompt-row">
          <span class="prompt-text">No exercise in <strong>${p.daysSince} days</strong>. Did you work out today?</span>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn btn-sm" style="background:var(--coral);color:#fff;border:none" onclick="logExercisePrompt()">Log it</button>
            <button class="btn btn-sm btn-ghost" onclick="dismissPrompt('exercise-today',this.closest('.prompt-row'))">Not today</button>
          </div>
        </div>`).join('<hr style="border:none;border-top:1px solid var(--border);margin:10px 0">')}
    </div>`;
}

window.dismissPrompt = (key, el) => {
  sessionStorage.setItem('dismissed-' + key, '1');
  el.style.opacity = '0.3';
  el.style.pointerEvents = 'none';
};

window.logMealPrompt = async (meal) => {
  const desc = prompt(`What did you have for ${meal}?`);
  if (!desc) return;
  await supabase.from('food_log').insert({ date: T, meal, description: desc });
  toast(`${meal} logged!`, 'success');
  loadHealthPrompts();
};

window.logExercisePrompt = async () => {
  const type = prompt('What exercise did you do?');
  if (!type) return;
  await supabase.from('exercise_log').insert({ date: T, type, notes: '' });
  toast('Exercise logged!', 'success');
  loadHealthPrompts();
};

// ── Urgent Items (with swipe on tasks) ────────────────────────────────────
async function loadUrgentItems() {
  const el = document.getElementById('urgent-items');
  if (!el) return;

  const [tasksRes, remindersRes, goldRes, followupsRes] = await Promise.all([
    supabase.from('tasks').select('*').eq('status', 'open').eq('priority', 'urgent').order('module'),
    supabase.from('reminders').select('*').eq('status', 'active').not('due_date', 'is', null).lte('due_date', T),
    supabase.from('gold_transactions').select('*, students(name)').eq('distributed', false),
    supabase.from('student_notes').select('*, students(name)').eq('followup_needed', true).order('date', { ascending: false }).limit(6),
  ]);

  const urgentTasks = tasksRes.data || [];
  const overdueReminders = remindersRes.data || [];
  const undistributedGold = goldRes.data || [];
  const followups = followupsRes.data || [];

  const hasAnything = urgentTasks.length || overdueReminders.length || undistributedGold.length || followups.length;
  if (!hasAnything) {
    el.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:16px;font-size:14px">✅ All clear — nothing urgent</div>`;
    return;
  }

  let html = '<div class="card" style="padding:0;overflow:hidden">';

  if (overdueReminders.length) {
    html += `<div class="urgent-section urgent-section-red">
      <div class="urgent-section-header">⏰ Overdue Reminders (${overdueReminders.length})</div>
      ${overdueReminders.map(r => `
        <div class="urgent-row">
          <div class="urgent-row-text">${r.title}</div>
          <div class="urgent-row-meta">${r.module || ''} · Due ${fmtDate(r.due_date)}</div>
        </div>`).join('')}
    </div>`;
  }

  if (undistributedGold.length) {
    const byStudent = {};
    undistributedGold.forEach(t => {
      const name = t.students?.name || '?';
      byStudent[name] = (byStudent[name] || 0) + t.amount;
    });
    html += `<div class="urgent-section urgent-section-gold">
      <div class="urgent-section-header">🪙 Gold to Distribute (${undistributedGold.length} transactions)</div>
      ${Object.entries(byStudent).map(([name, amt]) => `
        <div class="urgent-row">
          <div class="urgent-row-text">${name}</div>
          <div class="urgent-row-meta">+${amt} gold pending</div>
        </div>`).join('')}
    </div>`;
  }

  if (urgentTasks.length) {
    html += `<div class="urgent-section urgent-section-orange">
      <div class="urgent-section-header">🔴 Urgent Tasks (${urgentTasks.length})
        <span style="font-size:11px;font-weight:400;margin-left:8px">← cancel · → done</span>
      </div>
      ${urgentTasks.map(t => `
        <div class="swipe-item urgent-row" data-id="${t.id}" style="touch-action:pan-y;overflow:hidden;position:relative;display:flex;align-items:center;gap:8px">
          <div data-swipe-inner style="flex:1">
            <div class="urgent-row-text">${t.title}</div>
            ${t.due_date ? `<div class="urgent-row-meta">Due ${fmtDate(t.due_date)} · ${t.module}</div>` : `<div class="urgent-row-meta">${t.module}</div>`}
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;font-size:11px;padding:3px 7px" onclick="doneTask(${t.id}, event)">✓</button>
            <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;font-size:11px;padding:3px 7px" onclick="cancelTask(${t.id}, event)">✕</button>
          </div>
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

  // Apply swipe to urgent task rows
  el.querySelectorAll('.urgent-section-orange .swipe-item').forEach(item => {
    const taskId = item.dataset.id;
    initSwipe(item,
      // LEFT = cancel/delete
      async () => {
        await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', taskId);
        toast('Task removed', 'info');
        loadUrgentItems();
        loadCurrentBanner();
      },
      // RIGHT = done
      async () => {
        await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', taskId);
        toast('Task done! ✅', 'success');
        loadUrgentItems();
        loadCurrentBanner();
      }
    );
  });
}

// ── Today's Classes ───────────────────────────────────────────────────────
async function loadTodaysClasses() {
  const el = document.getElementById('todays-classes');
  if (!el) return;

  const dow = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const res = await supabase.from('classes').select('*').order('time_start');
  const isWeekday = ['Monday','Tuesday','Wednesday','Thursday'].includes(dow);
  const isFriday = dow === 'Friday';

  const classes = (res.data || []).filter(c => {
    const d = (c.day_of_week || '').trim();
    if (d === 'Mon-Thu') return isWeekday;
    if (d === 'Tue-Thu') return ['Tuesday','Wednesday','Thursday'].includes(dow);
    if (d === 'Friday') return isFriday;
    if (d === 'Monday') return dow === 'Monday';
    return d.toLowerCase().includes(dow.toLowerCase());
  });

  if (!classes.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:14px;padding:4px 0">No classes today</div>';
    return;
  }

  const classIds = classes.map(c => c.id);
  const [attRes, enrRes] = await Promise.all([
    supabase.from('attendance').select('class_id,status').eq('date', T).in('class_id', classIds),
    supabase.from('class_enrollments').select('class_id').is('enrolled_until', null).in('class_id', classIds),
  ]);

  const attByClass = {};
  (attRes.data || []).forEach(a => {
    if (!attByClass[a.class_id]) attByClass[a.class_id] = {};
    attByClass[a.class_id][a.status] = (attByClass[a.class_id][a.status] || 0) + 1;
  });
  const enrByClass = {};
  (enrRes.data || []).forEach(e => { enrByClass[e.class_id] = (enrByClass[e.class_id] || 0) + 1; });

  el.innerHTML = classes.map(c => {
    const att = attByClass[c.id] || {};
    const present = att.Present || 0;
    const total = enrByClass[c.id] || 0;
    const taken = Object.values(att).reduce((a, b) => a + b, 0) > 0;
    const timeStr = c.time_start ? c.time_start.slice(0,5) : '';
    return `
      <a href="class.html?id=${c.id}" class="list-item" style="text-decoration:none">
        <div class="list-item-left">
          <div class="list-item-name">${c.name}</div>
          <div class="list-item-sub">${timeStr}${c.room ? ' · Room ' + c.room : ''}${c.track_pages && c.track_pages !== 'None' ? ' · 📄' : ''}</div>
        </div>
        <div class="list-item-right">
          ${taken
            ? `<span class="badge badge-green">${present}/${total}</span>`
            : total > 0 ? `<span class="badge badge-orange">Att. needed</span>` : ''}
        </div>
      </a>`;
  }).join('');
}

// ── Upcoming Weddings ─────────────────────────────────────────────────────
async function loadUpcomingWeddings() {
  const el = document.getElementById('upcoming-weddings');
  if (!el) return;

  const future = new Date(T);
  future.setDate(future.getDate() + 60);
  const futureStr = future.toISOString().split('T')[0];

  const res = await supabase.from('tov_clients')
    .select('id, name, wedding_date, total_price, total_paid')
    .gte('wedding_date', T).lte('wedding_date', futureStr)
    .order('wedding_date');

  if (!res.data?.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:14px;padding:4px 0">No weddings in the next 60 days</div>';
    return;
  }

  el.innerHTML = res.data.map(c => {
    const days = Math.ceil((new Date(c.wedding_date) - new Date(T)) / 86400000);
    const balance = (c.total_price || 0) - (c.total_paid || 0);
    return `
      <a href="tov-client.html?id=${c.id}" class="list-item" style="text-decoration:none">
        <div class="list-item-left">
          <div class="list-item-name">${c.name}</div>
          <div class="list-item-meta">${fmtDate(c.wedding_date)} · ${days === 0 ? 'Today!' : `${days} days away`}</div>
        </div>
        <div class="list-item-right">
          ${balance > 0
            ? `<span class="badge badge-orange">$${balance.toFixed(0)} due</span>`
            : `<span class="badge badge-green">Paid ✓</span>`}
        </div>
      </a>`;
  }).join('');
}

// ── Desktop task action buttons ────────────────────────────────────────────
window.doneTask = async (id, e) => {
  e?.stopPropagation();
  await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id);
  toast('Task done! ✅', 'success');
  loadUrgentItems();
  loadCurrentBanner();
};
window.cancelTask = async (id, e) => {
  e?.stopPropagation();
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
  toast('Task removed', 'info');
  loadUrgentItems();
  loadCurrentBanner();
};

load();
