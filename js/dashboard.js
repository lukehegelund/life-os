// Life OS — Dashboard
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong, toast } from './utils.js';
import { startPolling } from './polling.js';

const T = today();

async function load() {
  document.getElementById('today-date').textContent = fmtDateLong(T);
  await Promise.all([
    loadStats(),
    loadHealthPrompts(),
    loadUrgentItems(),
    loadTodaysClasses(),
    loadUpcomingWeddings(),
  ]);
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

// ── Urgent Items ──────────────────────────────────────────────────────────
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
    const byModule = {};
    urgentTasks.forEach(t => {
      if (!byModule[t.module]) byModule[t.module] = [];
      byModule[t.module].push(t);
    });
    html += `<div class="urgent-section urgent-section-orange">
      <div class="urgent-section-header">🔴 Urgent Tasks (${urgentTasks.length})</div>
      ${Object.entries(byModule).map(([mod, tasks]) => `
        <div class="urgent-module-label">${mod}</div>
        ${tasks.map(t => `
          <div class="urgent-row">
            <div class="urgent-row-text">${t.title}</div>
            ${t.due_date ? `<div class="urgent-row-meta">Due ${fmtDate(t.due_date)}</div>` : ''}
          </div>`).join('')}`).join('')}
    </div>`;
  }

  if (followups.length) {
    html += `<div class="urgent-section urgent-section-blue">
      <div class="urgent-section-header">📌 Student Follow-ups (${followups.length})</div>
      ${followups.map(n => `
        <a href="student.html?id=${n.student_id}" class="urgent-row urgent-row-link">
          <div class="urgent-row-text"><strong>${n.students?.name}</strong>: ${n.note.slice(0, 90)}${n.note.length > 90 ? '…' : ''}</div>
          <div class="urgent-row-meta">${n.category} · ${fmtDate(n.date)}</div>
        </a>`).join('')}
    </div>`;
  }

  html += '</div>';
  el.innerHTML = html;
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
          <div class="list-item-sub">${timeStr}${c.room ? ' · Room ' + c.room : ''}</div>
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

load();
startPolling(load);
