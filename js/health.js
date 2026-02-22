// Life OS — Health
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateFull, badge, toast, showSpinner, showEmpty } from './utils.js';
import { startPolling } from './polling.js';

const T = today();
let selectedDate = T;

async function load() {
  await Promise.all([loadFoodLog(), loadExercise(), loadHealthNotes(), loadPendingMeals()]);
}

async function loadFoodLog() {
  const el = document.getElementById('food-log');
  showSpinner(el);
  // Last 7 days
  const since = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0];
  const res = await supabase.table('food_log').select('*').gte('date', since).order('date', { ascending: false }).order('meal');
  const entries = res.data || [];

  if (!entries.length) { showEmpty(el, '🍽️', 'No food logged recently'); return; }

  // Group by date
  const byDate = {};
  for (const e of entries) {
    if (!byDate[e.date]) byDate[e.date] = {};
    if (!byDate[e.date][e.meal]) byDate[e.date][e.meal] = [];
    byDate[e.date][e.meal].push(e.description);
  }

  const mealOrder = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  el.innerHTML = Object.entries(byDate).map(([date, meals]) => `
    <div style="margin-bottom:16px">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:var(--gray-600)">${fmtDateFull(date)}</div>
      ${mealOrder.filter(m => meals[m]).map(m => `
        <div style="display:flex;gap:10px;margin-bottom:6px">
          <div style="min-width:70px;font-size:13px;color:var(--gray-400);font-weight:600">${m}</div>
          <div style="font-size:14px">${meals[m].join(', ')}</div>
        </div>`).join('')}
    </div>`).join('<div style="border-bottom:1px solid var(--gray-100);margin-bottom:16px"></div>');
}

async function loadPendingMeals() {
  const el = document.getElementById('pending-meals');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    days.push(d);
  }
  const since = days[0];
  const res = await supabase.table('food_log').select('date, meal').gte('date', since);
  const logged = {};
  for (const r of (res.data || [])) {
    if (!logged[r.date]) logged[r.date] = new Set();
    logged[r.date].add(r.meal);
  }
  const missing = days.filter(d => {
    const s = logged[d];
    return !s || s.size < 2; // at least 2 meals expected
  });
  if (!missing.length) {
    el.innerHTML = '<div class="alert alert-success"><span class="alert-icon">✅</span><div>All meals logged for the past week</div></div>';
  } else {
    el.innerHTML = `<div class="alert alert-warning"><span class="alert-icon">🍽️</span><div>${missing.length} day${missing.length > 1 ? 's' : ''} with incomplete food log: ${missing.map(d => fmtDate(d)).join(', ')}</div></div>`;
  }
}

async function loadExercise() {
  const el = document.getElementById('exercise-log');
  const res = await supabase.table('exercise_log').select('*').order('date', { ascending: false }).limit(15);
  const entries = res.data || [];
  if (!entries.length) { showEmpty(el, '🏃', 'No exercise logged'); return; }

  const last = entries[0];
  const daysSince = Math.floor((new Date(T) - new Date(last.date + 'T00:00:00')) / 86400000);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--gray-100)">
      <div>
        <div style="font-size:24px;font-weight:700;color:${daysSince === 0 ? 'var(--green)' : daysSince <= 2 ? 'var(--orange)' : 'var(--red)'}">${daysSince === 0 ? 'Today' : daysSince + 'd ago'}</div>
        <div style="font-size:13px;color:var(--gray-400)">last exercise</div>
      </div>
    </div>
    ${entries.map(e => `
      <div class="list-item">
        <div class="list-item-left">
          <div class="list-item-name">${e.type || 'Exercise'}</div>
          <div class="list-item-sub">${fmtDate(e.date)}${e.duration_minutes ? ' · ' + e.duration_minutes + ' min' : ''}${e.notes ? ' · ' + e.notes : ''}</div>
        </div>
      </div>`).join('')}`;
}

async function loadHealthNotes() {
  const el = document.getElementById('health-notes');
  const res = await supabase.table('health_notes').select('*').order('date', { ascending: false }).limit(10);
  const notes = res.data || [];
  if (!notes.length) { showEmpty(el, '💊', 'No health notes'); return; }
  const colors = { Medication: 'blue', Recovery: 'orange', General: 'gray', Dental: 'purple', Sleep: 'gold' };
  el.innerHTML = notes.map(n => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name" style="font-size:14px">${n.note}</div>
        <div class="list-item-sub">${fmtDate(n.date)}</div>
      </div>
      <div class="list-item-right">${badge(n.category, colors[n.category] || 'gray')}</div>
    </div>`).join('');
}

// Log meal form
window.showMealForm = () => {
  document.getElementById('meal-modal').style.display = 'flex';
  document.getElementById('meal-date').value = T;
};
window.closeMealModal = () => { document.getElementById('meal-modal').style.display = 'none'; };
window.submitMeal = async () => {
  const meal = document.getElementById('meal-type').value;
  const desc = document.getElementById('meal-desc').value.trim();
  const date = document.getElementById('meal-date').value;
  if (!desc || !date) { toast('Fill in all fields', 'error'); return; }
  const { error } = await supabase.table('food_log').insert({ date, meal, description: desc });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Meal logged!', 'success');
  window.closeMealModal();
  load();
};

// Log exercise form
window.showExerciseForm = () => {
  document.getElementById('exercise-modal').style.display = 'flex';
  document.getElementById('ex-date').value = T;
};
window.closeExerciseModal = () => { document.getElementById('exercise-modal').style.display = 'none'; };
window.submitExercise = async () => {
  const type = document.getElementById('ex-type').value.trim();
  const duration = parseInt(document.getElementById('ex-duration').value) || null;
  const date = document.getElementById('ex-date').value;
  const notes = document.getElementById('ex-notes').value.trim();
  if (!type || !date) { toast('Fill in type and date', 'error'); return; }
  const { error } = await supabase.table('exercise_log').insert({ date, type, duration_minutes: duration, notes: notes || null });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Exercise logged!', 'success');
  window.closeExerciseModal();
  load();
};

load();
startPolling(load, 30000); // Health can poll slower
