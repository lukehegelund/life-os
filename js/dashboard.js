// Life OS — Dashboard
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong, fmtMoney, showSpinner, showEmpty } from './utils.js';
import { startPolling } from './polling.js';

const T = today();

async function load() {
  await Promise.all([loadStats(), loadPending(), loadToday(), loadUpcoming()]);
}

async function loadStats() {
  const el = document.getElementById('stats');
  const [studentsRes, clientsRes, vocabRes] = await Promise.all([
    supabase.table('students').select('id', { count: 'exact', head: true }).eq('status', 'Active'),
    supabase.table('tov_clients').select('id', { count: 'exact', head: true }).not('contract_status', 'eq', 'Void'),
    supabase.table('vocab_words').select('id', { count: 'exact', head: true }).lte('next_review', T)
  ]);
  const students = studentsRes.count ?? 0;
  const clients = clientsRes.count ?? 0;
  const dueWords = vocabRes.count ?? 0;
  el.innerHTML = `
    <div class="stat-card">
      <div class="label">Students</div>
      <div class="value" style="color:var(--blue)">${students}</div>
      <div class="sublabel">active</div>
    </div>
    <div class="stat-card">
      <div class="label">TOV Clients</div>
      <div class="value" style="color:var(--green)">${clients}</div>
      <div class="sublabel">active</div>
    </div>
    <div class="stat-card">
      <div class="label">Words Due</div>
      <div class="value" style="color:var(--purple)">${dueWords}</div>
      <div class="sublabel">for review</div>
    </div>
    <div class="stat-card" id="stat-exercise">
      <div class="label">Exercise</div>
      <div class="value" style="color:var(--coral)" id="ex-days">—</div>
      <div class="sublabel">days ago</div>
    </div>
  `;
  // Load last exercise
  const exRes = await supabase.table('exercise_log').select('date').order('date', { ascending: false }).limit(1);
  if (exRes.data && exRes.data.length) {
    const last = new Date(exRes.data[0].date + 'T00:00:00');
    const diff = Math.floor((new Date(T) - last) / 86400000);
    document.getElementById('ex-days').textContent = diff === 0 ? 'Today' : diff;
  } else {
    document.getElementById('ex-days').textContent = '?';
  }
}

async function loadPending() {
  const el = document.getElementById('pending');
  const [goldRes, followupRes, mealsRes] = await Promise.all([
    supabase.table('gold_transactions').select('student_id', { count: 'exact', head: true }).eq('distributed', false),
    supabase.table('student_notes').select('id', { count: 'exact', head: true }).eq('followup_needed', true),
    supabase.table('food_log').select('date').gte('date', new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0])
  ]);
  const goldCount = goldRes.count ?? 0;
  const followupCount = followupRes.count ?? 0;
  // Count days in last 7 with at least one meal logged
  const loggedDays = new Set((mealsRes.data || []).map(r => r.date)).size;
  const missingMeals = 7 - loggedDays;

  el.innerHTML = '';
  if (goldCount > 0) el.innerHTML += `
    <div class="alert alert-warning">
      <span class="alert-icon">🪙</span>
      <div><strong>${goldCount}</strong> gold transactions not yet distributed — <a href="daily.html">see Daily</a></div>
    </div>`;
  if (followupCount > 0) el.innerHTML += `
    <div class="alert alert-info">
      <span class="alert-icon">📌</span>
      <div><strong>${followupCount}</strong> student followup${followupCount > 1 ? 's' : ''} pending — <a href="students.html">see Students</a></div>
    </div>`;
  if (missingMeals > 0) el.innerHTML += `
    <div class="alert alert-info">
      <span class="alert-icon">🍽️</span>
      <div><strong>${missingMeals}</strong> day${missingMeals > 1 ? 's' : ''} missing food log — <a href="health.html">see Health</a></div>
    </div>`;
  if (!el.innerHTML) el.innerHTML = '<div class="alert alert-success"><span class="alert-icon">✅</span><div>All caught up!</div></div>';
}

async function loadToday() {
  const el = document.getElementById('today-classes');
  const dayOfWeek = new Date(T + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const dayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(T + 'T00:00:00').getDay()];

  const res = await supabase.table('classes').select('id, name, time_start, subject').or(`day_of_week.ilike.%${dayShort}%,day_of_week.ilike.%${dayOfWeek}%`);
  const classes = res.data || [];

  if (!classes.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📅</div>No classes scheduled today</div>';
    return;
  }

  // Check which have attendance logged
  const classIds = classes.map(c => c.id);
  const attRes = await supabase.table('attendance').select('class_id').eq('date', T).in('class_id', classIds);
  const logged = new Set((attRes.data || []).map(a => a.class_id));

  el.innerHTML = classes.map(c => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${c.name}</div>
        <div class="list-item-sub">${c.time_start ? c.time_start.slice(0,5) : ''} · ${c.subject || ''}</div>
      </div>
      <div class="list-item-right">
        ${logged.has(c.id)
          ? '<span class="badge badge-green">Att ✓</span>'
          : '<span class="badge badge-gray">Att —</span>'}
        <a href="class.html?id=${c.id}" class="btn btn-sm btn-ghost">→</a>
      </div>
    </div>`).join('');
}

async function loadUpcoming() {
  const el = document.getElementById('upcoming-tov');
  const next30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const res = await supabase.table('tov_clients').select('id, name, wedding_date, package, contract_status')
    .gte('wedding_date', T).lte('wedding_date', next30).order('wedding_date');
  const clients = res.data || [];
  if (!clients.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No upcoming weddings in 30 days</div>';
    return;
  }
  el.innerHTML = clients.map(c => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${c.name}</div>
        <div class="list-item-sub">${fmtDate(c.wedding_date)} · ${c.package || ''}</div>
      </div>
      <div class="list-item-right">
        <span class="badge badge-${c.contract_status === 'Signed' ? 'green' : 'gold'}">${c.contract_status || 'None'}</span>
        <a href="tov-client.html?id=${c.id}" class="btn btn-sm btn-ghost">→</a>
      </div>
    </div>`).join('');
}

// Init
load();
startPolling(load, 10000);
