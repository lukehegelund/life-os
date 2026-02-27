// Life OS — Dashboard v4 (new nav: School / Apps / Dashboard / Calendar / Tasks)
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong, fmtTime, toast, pstDatePlusDays } from './utils.js';
import { initSwipe } from './swipe-handler.js';

const T = today();

async function load() {
  document.getElementById('today-date').textContent = fmtDateLong(T);
  await Promise.all([
    loadCurrentBanner(),
    loadGlance(),
    loadHealthStatus(),
    loadUrgentItems(),
    loadUpcomingEvents(),
    loadTOVStats(),
    loadLanguageStats(),
    loadStudentActivity(),
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
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }), 10);

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

// ── Upcoming calendar events (next 7 days) ─────────────────────────────────
async function loadUpcomingEvents() {
  const el = document.getElementById('upcoming-events');
  if (!el) return;

  const endStr = pstDatePlusDays(7);

  const [calRes, classRes, weddingRes] = await Promise.all([
    supabase.from('calendar_events')
      .select('id, title, start_time, end_time, color')
      .gte('start_time', T)
      .lte('start_time', endStr + 'T23:59:59')
      .order('start_time')
      .limit(10),
    supabase.from('classes').select('id, name, day_of_week, time_start, subject'),
    supabase.from('tov_clients')
      .select('id, name, wedding_date')
      .gte('wedding_date', T)
      .lte('wedding_date', endStr)
      .limit(3),
  ]);

  const items = [];

  // Calendar events
  for (const ev of (calRes.data || [])) {
    const ds = ev.start_time?.slice(0, 10);
    const timeStr = ev.start_time?.slice(11, 16);
    items.push({ ds, timeStr, title: ev.title, color: ev.color || '#0F9D58', link: 'calendar.html' });
  }

  // Weddings this week
  for (const w of (weddingRes.data || [])) {
    items.push({ ds: w.wedding_date, timeStr: null, title: `💍 ${w.name}`, color: '#16a34a', link: `tov-client.html?id=${w.id}` });
  }

  // Expand classes for next 7 days
  const classes = classRes.data || [];
  for (let i = 0; i < 7; i++) {
    const ds = pstDatePlusDays(i);
    const [y, m, dd] = ds.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    for (const cls of classes) {
      const dayOfWeek = (cls.day_of_week || '').trim();
      const matches =
        (dayOfWeek === 'Mon-Thu' && dow >= 1 && dow <= 4) ||
        (dayOfWeek === 'Tue-Thu' && dow >= 2 && dow <= 4) ||
        (dayOfWeek === 'Friday' && dow === 5) ||
        (dayOfWeek === 'Monday' && dow === 1);
      if (matches) {
        items.push({ ds, timeStr: cls.time_start?.slice(0, 5) || null, title: cls.name, color: '#2563EB', link: `class.html?id=${cls.id}` });
      }
    }
  }

  // Sort by date + time
  items.sort((a, b) => {
    const ka = a.ds + (a.timeStr || '00:00');
    const kb = b.ds + (b.timeStr || '00:00');
    return ka.localeCompare(kb);
  });

  if (!items.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:13px">Sin eventos próximos</div>';
    return;
  }

  const shown = items.slice(0, 8);
  let html = '';
  let lastDate = null;
  for (const item of shown) {
    const dayLabel = new Date(item.ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (item.ds !== lastDate) {
      if (lastDate !== null) html += '<div style="height:4px"></div>';
      html += `<div style="font-size:10px;font-weight:700;color:var(--gray-400);text-transform:uppercase;margin-bottom:2px">${dayLabel}</div>`;
      lastDate = item.ds;
    }
    html += `<a href="${item.link}" style="display:flex;align-items:center;gap:8px;padding:5px 0;text-decoration:none;border-bottom:1px solid var(--gray-100)">
      <div style="width:3px;height:28px;border-radius:2px;background:${item.color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.title}</div>
        ${item.timeStr ? `<div style="font-size:11px;color:var(--gray-400)">${item.timeStr}</div>` : ''}
      </div>
    </a>`;
  }
  el.innerHTML = html;
}

// ── TOV Stats ──────────────────────────────────────────────────────────────
async function loadTOVStats() {
  const el = document.getElementById('tov-stats');
  if (!el) return;

  const thirtyStr = pstDatePlusDays(30);

  const [upcomingRes, inquiryRes, allRes] = await Promise.all([
    supabase.from('tov_clients')
      .select('id, name, wedding_date')
      .gte('wedding_date', T)
      .lte('wedding_date', thirtyStr)
      .order('wedding_date')
      .limit(5),
    supabase.from('tov_clients')
      .select('id', { count: 'exact' })
      .eq('status', 'inquiry'),
    supabase.from('tov_clients')
      .select('id', { count: 'exact' })
      .eq('status', 'booked'),
  ]);

  const upcoming = upcomingRes.data || [];
  const inquiryCount = inquiryRes.count ?? 0;
  const bookedCount = allRes.count ?? 0;

  let html = `<div style="display:flex;gap:12px;margin-bottom:10px">
    <div style="flex:1;text-align:center;background:var(--gray-50);border-radius:8px;padding:8px 4px">
      <div style="font-size:20px;font-weight:700;color:var(--blue)">${bookedCount}</div>
      <div style="font-size:11px;color:var(--gray-400)">Booked</div>
    </div>
    <div style="flex:1;text-align:center;background:var(--gray-50);border-radius:8px;padding:8px 4px">
      <div style="font-size:20px;font-weight:700;color:${inquiryCount > 0 ? '#f59e0b' : 'var(--gray-400)'}">${inquiryCount}</div>
      <div style="font-size:11px;color:var(--gray-400)">Inquiries</div>
    </div>
  </div>`;

  if (upcoming.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;margin-bottom:4px">Next 30 Days</div>`;
    for (const w of upcoming) {
      const wDate = new Date(w.wedding_date + 'T00:00:00');
      const daysAway = Math.round((wDate - new Date(T + 'T00:00:00')) / 86400000);
      html += `<a href="tov-client.html?id=${w.id}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray-100);text-decoration:none">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--gray-800)">💍 ${w.name}</div>
          <div style="font-size:11px;color:var(--gray-400)">${wDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
        </div>
        <div style="font-size:12px;font-weight:700;color:${daysAway <= 7 ? 'var(--red)' : daysAway <= 14 ? '#f59e0b' : 'var(--gray-400)'}">${daysAway}d</div>
      </a>`;
    }
  } else {
    html += `<div style="color:var(--gray-400);font-size:13px">Sin bodas próximas en 30 días</div>`;
  }

  el.innerHTML = html;
}

// ── Language Stats ──────────────────────────────────────────────────────────
async function loadLanguageStats() {
  const el = document.getElementById('language-stats');
  if (!el) return;

  const [dueRes, totalRes, masteredRes, stage3Res] = await Promise.all([
    supabase.from('vocab_words').select('id', { count: 'exact' }).lte('next_review', T),
    supabase.from('vocab_words').select('id', { count: 'exact' }),
    supabase.from('vocab_words').select('id', { count: 'exact' }).gte('stage', 6),
    supabase.from('vocab_words').select('id', { count: 'exact' }).gte('stage', 3).lt('stage', 6),
  ]);

  const due      = dueRes.count ?? 0;
  const total    = totalRes.count ?? 0;
  const mastered = masteredRes.count ?? 0;
  const learning = stage3Res.count ?? 0;
  const pct = total > 0 ? Math.round(mastered / total * 100) : 0;

  let html = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
    <div style="text-align:center;background:var(--gray-50);border-radius:8px;padding:8px 4px">
      <div style="font-size:18px;font-weight:700;color:${due > 0 ? '#7C3AED' : 'var(--gray-400)'}">${due}</div>
      <div style="font-size:10px;color:var(--gray-400)">Due Today</div>
    </div>
    <div style="text-align:center;background:var(--gray-50);border-radius:8px;padding:8px 4px">
      <div style="font-size:18px;font-weight:700;color:#16a34a">${mastered}</div>
      <div style="font-size:10px;color:var(--gray-400)">Mastered</div>
    </div>
    <div style="text-align:center;background:var(--gray-50);border-radius:8px;padding:8px 4px">
      <div style="font-size:18px;font-weight:700;color:var(--blue)">${total}</div>
      <div style="font-size:10px;color:var(--gray-400)">Total</div>
    </div>
  </div>`;

  // Progress bar
  html += `<div style="margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray-400);margin-bottom:3px">
      <span>Mastery progress</span><span>${pct}%</span>
    </div>
    <div style="height:6px;background:var(--gray-100);border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#7C3AED,#2563EB);border-radius:3px;transition:width 0.3s"></div>
    </div>
  </div>`;

  if (due > 0) {
    html += `<a href="languages.html" style="display:block;text-align:center;background:#F5F3FF;color:#7C3AED;border-radius:8px;padding:8px;font-size:13px;font-weight:700;text-decoration:none">📚 Review ${due} word${due !== 1 ? 's' : ''} →</a>`;
  }

  el.innerHTML = html;
}

// ── Recent Student Activity ─────────────────────────────────────────────────
async function loadStudentActivity() {
  const el = document.getElementById('student-activity');
  if (!el) return;

  const [notesRes, goldRes] = await Promise.all([
    supabase.from('student_notes')
      .select('id, note, date, followup_needed, students(id, name)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('gold_transactions')
      .select('id, amount, reason, created_at, students(name)')
      .order('created_at', { ascending: false })
      .limit(3),
  ]);

  const notes = notesRes.data || [];
  const gold  = goldRes.data || [];

  if (!notes.length && !gold.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:13px">Sin actividad reciente</div>';
    return;
  }

  let html = '';

  if (notes.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;margin-bottom:4px">Notas Recientes</div>`;
    for (const n of notes) {
      const name = n.students?.name || '?';
      const noteText = (n.note || '').slice(0, 80) + ((n.note || '').length > 80 ? '…' : '');
      html += `<a href="student.html?id=${n.students?.id}" style="display:block;padding:6px 0;border-bottom:1px solid var(--gray-100);text-decoration:none">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
          <div style="flex:1;min-width:0">
            <span style="font-size:12px;font-weight:700;color:var(--blue)">${name}</span>
            ${n.followup_needed ? '<span style="font-size:10px;color:var(--red);margin-left:4px">📌</span>' : ''}
            <div style="font-size:12px;color:var(--gray-600);margin-top:1px">${noteText}</div>
          </div>
          <div style="font-size:10px;color:var(--gray-400);flex-shrink:0">${fmtDate(n.date)}</div>
        </div>
      </a>`;
    }
  }

  if (gold.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;margin:8px 0 4px">Oro Reciente</div>`;
    for (const g of gold) {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--gray-100)">
        <div>
          <span style="font-size:12px;font-weight:600;color:var(--gray-700)">${g.students?.name || '?'}</span>
          ${g.reason ? `<span style="font-size:11px;color:var(--gray-400);margin-left:4px">· ${(g.reason).slice(0, 40)}</span>` : ''}
        </div>
        <span style="font-size:13px;font-weight:700;color:var(--orange)">+${g.amount} 🪙</span>
      </div>`;
    }
  }

  el.innerHTML = html;
}

load();
