// Life OS — Daily Recap (no polling — user-driven)
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong, goldStr, goldClass, catBadge, toast, attendanceBadge, showSpinner, pstDatePlusDays } from './utils.js';

let selectedDate = today();

async function load() {
  document.getElementById('date-label').textContent = fmtDateLong(selectedDate);
  await Promise.all([loadGoldOwed(), loadAttendance(), loadFollowups(), loadNotesSummary(), loadPastLogs()]);
}

// ── Gold Owed ─────────────────────────────────────────────────────────────────
async function loadGoldOwed() {
  const el = document.getElementById('gold-owed');
  showSpinner(el);

  const res = await supabase.from('gold_transactions')
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
    <button class="btn btn-gold btn-full" onclick="distributeAll()">🪙 Import Gold for This and Prior Days</button>
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
  // 1. Get all undistributed transactions to find which students are affected
  const txRes = await supabase.from('gold_transactions')
    .select('student_id, amount')
    .eq('distributed', false)
    .lte('date', selectedDate);
  if (txRes.error) { toast('Error: ' + txRes.error.message, 'error'); return; }

  // 2. Mark all undistributed transactions as distributed
  const markRes = await supabase.from('gold_transactions')
    .update({ distributed: true, distributed_at: new Date().toISOString() })
    .eq('distributed', false)
    .lte('date', selectedDate);
  if (markRes.error) { toast('Error: ' + markRes.error.message, 'error'); return; }

  // 3. Zero out current_gold for every affected student
  //    (current_gold only tracks pending/undistributed balance)
  const affectedIds = [...new Set((txRes.data || []).map(t => t.student_id))];
  for (const sid of affectedIds) {
    await supabase.from('students').update({ current_gold: 0 }).eq('id', sid);
  }

  toast(`Distributed! ${affectedIds.length} student${affectedIds.length !== 1 ? 's' : ''} reset to 0 🪙`, 'success');
  loadGoldOwed();
}
window.distributeAll = distributeAll;

// ── Attendance ────────────────────────────────────────────────────────────────
async function loadAttendance() {
  const el = document.getElementById('attendance-section');
  const dayOfWeek = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const dayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(selectedDate + 'T00:00:00').getDay()];

  const [classRes, attRes, importRes] = await Promise.all([
    supabase.from('classes').select('id, name, time_start').or(`day_of_week.ilike.%${dayShort}%,day_of_week.ilike.%${dayOfWeek}%`).order('time_start', { ascending: true }),
    supabase.from('attendance').select('class_id, status').eq('date', selectedDate),
    supabase.from('attendance_imported').select('class_id').eq('date', selectedDate),
  ]);

  const classes = classRes.data || [];

  // Build a count map: class_id → number of attendance records
  const attCountByClass = {};
  for (const r of (attRes.data || [])) {
    attCountByClass[r.class_id] = (attCountByClass[r.class_id] || 0) + 1;
  }

  // Build imported set: which class_ids are imported for this date
  const importedClassIds = new Set((importRes.data || []).map(r => r.class_id));

  if (!classes.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No classes scheduled for this day</div>';
    return;
  }

  el.innerHTML = classes.map(c => {
    const count = attCountByClass[c.id] || 0;
    const isImported = importedClassIds.has(c.id);
    return `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${c.name}</div>
        <div class="list-item-sub">${c.time_start ? c.time_start.slice(0,5) : ''}</div>
      </div>
      <div class="list-item-right">
        ${isImported
          ? `<span class="badge badge-green">✅ Importada</span>`
          : count > 0
            ? `<span class="badge badge-blue">Tomada (${count})</span>`
            : '<span class="badge badge-gray">Sin tomar</span>'}
        <a href="class.html?id=${c.id}&date=${selectedDate}" class="btn btn-sm btn-ghost">View →</a>
      </div>
    </div>`;
  }).join('');
}

// ── Followups ─────────────────────────────────────────────────────────────────
async function loadFollowups() {
  const el = document.getElementById('followups');
  const res = await supabase.from('student_notes')
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
  const res = await supabase.from('student_notes').select('category').eq('date', selectedDate);
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

// ── Import Attendance ─────────────────────────────────────────────────────────
window.importAttendance = async () => {
  const btn = document.getElementById('import-att-btn');
  const statusEl = document.getElementById('import-att-status');
  btn.disabled = true;
  btn.textContent = '⏳ Importando…';

  const T = selectedDate;

  // Get classes scheduled for this day
  const dayOfWeek = new Date(T + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const dayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(T + 'T00:00:00').getDay()];

  const classRes = await supabase.from('classes')
    .select('id, name')
    .or(`day_of_week.ilike.%${dayShort}%,day_of_week.ilike.%${dayOfWeek}%`);

  const classes = classRes.data || [];
  if (!classes.length) {
    toast('No hay clases programadas para este día', 'info');
    btn.disabled = false;
    btn.textContent = '📥 Importar Asistencia';
    return;
  }

  // Check which classes already have attendance logged
  const attRes = await supabase.from('attendance')
    .select('class_id')
    .eq('date', T);

  const classIdsWithAtt = new Set((attRes.data || []).map(r => r.class_id));
  const classesToImport = classes.filter(c => classIdsWithAtt.has(c.id));

  if (!classesToImport.length) {
    toast('No hay asistencia tomada para importar hoy', 'info');
    btn.disabled = false;
    btn.textContent = '📥 Importar Asistencia';
    return;
  }

  // Upsert import records for each class with attendance
  const importRows = classesToImport.map(c => ({
    date: T,
    class_id: c.id,
    imported_at: new Date().toISOString(),
  }));

  const { error: importErr } = await supabase
    .from('attendance_imported')
    .upsert(importRows, { onConflict: 'date,class_id' });

  if (importErr) {
    toast('Error importando: ' + importErr.message, 'error');
    btn.disabled = false;
    btn.textContent = '📥 Importar Asistencia';
    return;
  }

  const names = classesToImport.map(c => c.name).join(', ');
  statusEl.textContent = `Importada ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  btn.textContent = '✅ Asistencia Importada';
  btn.style.background = 'var(--green)';
  toast(`Asistencia importada para: ${names} ✅`, 'success');
  loadAttendance();
  loadPastLogs();
};

// ── Past Logs ─────────────────────────────────────────────────────────────────
async function loadPastLogs() {
  const el = document.getElementById('past-logs');
  if (!el) return;

  // Get attendance import history
  const { data } = await supabase.from('attendance_imported')
    .select('date, class_id, imported_at, classes(name)')
    .order('imported_at', { ascending: false })
    .limit(60);

  const logs = data || [];
  if (!logs.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No hay asistencias importadas aún</div>';
    return;
  }

  // Group by date
  const byDate = {};
  for (const r of logs) {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  }

  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  el.innerHTML = sortedDates.slice(0, 30).map(date => {
    const entries = byDate[date];
    const classNames = entries.map(e => e.classes?.name || `Class ${e.class_id}`).join(', ');
    return `
      <details style="margin-bottom:8px;border-bottom:1px solid var(--gray-100);padding-bottom:8px">
        <summary style="font-size:14px;font-weight:600;cursor:pointer;padding:4px 0">
          ✅ ${fmtDate(date)}
          <span style="font-size:12px;font-weight:400;color:var(--gray-400);margin-left:8px">${entries.length} clase${entries.length !== 1 ? 's' : ''}</span>
        </summary>
        <div style="margin-top:8px;font-size:13px;color:var(--gray-600)">
          <div style="padding:2px 0">${classNames}</div>
        </div>
      </details>`;
  }).join('');
}

// ── Date navigation ───────────────────────────────────────────────────────────
document.getElementById('date-prev').addEventListener('click', () => {
  // Offset from selectedDate by -1 day using UTC arithmetic (date strings are timezone-safe)
  const [y, m, d2] = selectedDate.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d2 - 1));
  selectedDate = base.toISOString().split('T')[0];
  load();
});
document.getElementById('date-next').addEventListener('click', () => {
  const [y, m, d2] = selectedDate.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d2 + 1));
  const nextStr = next.toISOString().split('T')[0];
  if (nextStr > today()) return;
  selectedDate = nextStr;
  load();
});
document.getElementById('date-today').addEventListener('click', () => {
  selectedDate = today();
  load();
});

// Init
load();
