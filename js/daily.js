// Life OS — Daily Recap
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong, goldStr, goldClass, catBadge, toast, attendanceBadge, showSpinner } from './utils.js';
import { startPolling } from './polling.js';

let selectedDate = today();

async function load() {
  document.getElementById('date-label').textContent = fmtDateLong(selectedDate);
  await Promise.all([loadGoldOwed(), loadAttendance(), loadFollowups(), loadNotesSummary()]);
}

// ── Gold Owed ─────────────────────────────────────────────────────────────────
async function loadGoldOwed() {
  const el = document.getElementById('gold-owed');
  showSpinner(el);

  const res = await supabase.table('gold_transactions')
    .select('*, students(name)')
    .eq('distributed', false)
    .lte('date', selectedDate);

  const txs = res.data || [];

  if (!txs.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🪙</div>No undistributed gold</div>';
    return;
  }

  // Group by student
  const byStudent = {};
  for (const t of txs) {
    const name = t.students?.name || `Student ${t.student_id}`;
    if (!byStudent[t.student_id]) byStudent[t.student_id] = { name, total: 0, txs: [] };
    byStudent[t.student_id].total += t.amount;
    byStudent[t.student_id].txs.push(t);
  }

  const sorted = Object.values(byStudent).sort((a, b) => b.total - a.total);

  el.innerHTML = `
    <button class="btn btn-gold btn-full" onclick="distributeAll()">🪙 Mark All Distributed</button>
    <div style="margin-top:12px">
    ${sorted.map(s => `
      <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:6px">
        <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
          <strong>${s.name}</strong>
          <span class="${goldClass(s.total)}">${goldStr(s.total)} gold</span>
        </div>
        ${s.txs.map(t => `
          <div style="display:flex;justify-content:space-between;width:100%;font-size:13px;color:var(--gray-600)">
            <span>${fmtDate(t.date)} · ${t.reason || '—'}</span>
            <span class="${goldClass(t.amount)}">${goldStr(t.amount)}</span>
          </div>`).join('')}
      </div>`).join('')}
    </div>
  `;
}

async function distributeAll() {
  const res = await supabase.table('gold_transactions')
    .update({ distributed: true, distributed_at: new Date().toISOString() })
    .eq('distributed', false)
    .lte('date', selectedDate);
  if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }
  toast('All gold marked as distributed!', 'success');
  loadGoldOwed();
}
window.distributeAll = distributeAll;

// ── Attendance ────────────────────────────────────────────────────────────────
async function loadAttendance() {
  const el = document.getElementById('attendance-section');
  const dayOfWeek = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const dayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(selectedDate + 'T00:00:00').getDay()];

  const [classRes, sessRes] = await Promise.all([
    supabase.table('classes').select('id, name, time_start').or(`day_of_week.ilike.%${dayShort}%,day_of_week.ilike.%${dayOfWeek}%`),
    supabase.table('daily_sessions').select('class_id, status, gold_distributed').eq('date', selectedDate)
  ]);

  const classes = classRes.data || [];
  const sessions = Object.fromEntries((sessRes.data || []).map(s => [s.class_id, s]));

  if (!classes.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No classes scheduled for this day</div>';
    return;
  }

  el.innerHTML = classes.map(c => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${c.name}</div>
        <div class="list-item-sub">${c.time_start ? c.time_start.slice(0,5) : ''}</div>
      </div>
      <div class="list-item-right">
        ${sessions[c.id]
          ? `<span class="badge badge-green">${sessions[c.id].status}</span>`
          : '<span class="badge badge-gray">Not logged</span>'}
        <a href="class.html?id=${c.id}&date=${selectedDate}" class="btn btn-sm btn-ghost">Log →</a>
      </div>
    </div>`).join('');
}

// ── Followups ─────────────────────────────────────────────────────────────────
async function loadFollowups() {
  const el = document.getElementById('followups');
  const res = await supabase.table('student_notes')
    .select('*, students(name)')
    .eq('followup_needed', true)
    .eq('date', selectedDate);
  const notes = res.data || [];
  if (!notes.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No followups flagged for today</div>';
    return;
  }
  el.innerHTML = notes.map(n => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${n.students?.name || '—'}</div>
        <div class="list-item-sub">${n.note || ''}</div>
      </div>
      <div class="list-item-right">${catBadge(n.category)}</div>
    </div>`).join('');
}

// ── Notes Summary ─────────────────────────────────────────────────────────────
async function loadNotesSummary() {
  const el = document.getElementById('notes-summary');
  const res = await supabase.table('student_notes').select('category').eq('date', selectedDate);
  const notes = res.data || [];
  if (!notes.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No notes logged for today</div>';
    return;
  }
  const counts = {};
  for (const n of notes) counts[n.category] = (counts[n.category] || 0) + 1;
  el.innerHTML = Object.entries(counts).map(([cat, n]) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100)">
      <span>${catBadge(cat)}</span><span style="font-weight:700">${n}</span>
    </div>`).join('');
}

// ── Date navigation ───────────────────────────────────────────────────────────
document.getElementById('date-prev').addEventListener('click', () => {
  const d = new Date(selectedDate + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  selectedDate = d.toISOString().split('T')[0];
  load();
});
document.getElementById('date-next').addEventListener('click', () => {
  const d = new Date(selectedDate + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  if (d.toISOString().split('T')[0] > today()) return;
  selectedDate = d.toISOString().split('T')[0];
  load();
});
document.getElementById('date-today').addEventListener('click', () => {
  selectedDate = today();
  load();
});

// Init
load();
startPolling(load, 10000);
