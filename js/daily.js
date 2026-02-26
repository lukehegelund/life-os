// Life OS — Daily Recap (no polling — user-driven)
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong, goldStr, goldClass, catBadge, toast, attendanceBadge, showSpinner } from './utils.js';

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

  const [classRes, attRes] = await Promise.all([
    supabase.from('classes').select('id, name, time_start').or(`day_of_week.ilike.%${dayShort}%,day_of_week.ilike.%${dayOfWeek}%`).order('time_start', { ascending: true }),
    supabase.from('attendance').select('class_id, status').eq('date', selectedDate)
  ]);

  const classes = classRes.data || [];

  // Build a count map: class_id → number of attendance records
  const attCountByClass = {};
  for (const r of (attRes.data || [])) {
    attCountByClass[r.class_id] = (attCountByClass[r.class_id] || 0) + 1;
  }

  if (!classes.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No classes scheduled for this day</div>';
    return;
  }

  el.innerHTML = classes.map(c => {
    const count = attCountByClass[c.id] || 0;
    return `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${c.name}</div>
        <div class="list-item-sub">${c.time_start ? c.time_start.slice(0,5) : ''}</div>
      </div>
      <div class="list-item-right">
        ${count > 0
          ? `<span class="badge badge-green">Logged (${count})</span>`
          : '<span class="badge badge-gray">Not logged</span>'}
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

// ── Log & Close Day ──────────────────────────────────────────────────────────
window.logAndCloseDay = async () => {
  const btn = document.getElementById('log-day-btn');
  const statusEl = document.getElementById('log-day-status');
  btn.disabled = true;
  btn.textContent = '⏳ Logging…';

  const T = today();

  // 1. Gather attendance stats for today
  const [attRes, pagesRes, partRes, classRes, goldRes] = await Promise.all([
    supabase.from('attendance').select('class_id, status').eq('date', T),
    supabase.from('student_pages').select('student_id, class_id, pages_delta, total_pages').eq('date', T),
    supabase.from('participation_scores').select('student_id, class_id, score').eq('date', T),
    supabase.from('classes').select('id, name'),
    supabase.from('gold_transactions').select('student_id, amount').eq('distributed', false).lte('date', T),
  ]);

  const classMap = {};
  for (const c of (classRes.data || [])) classMap[c.id] = c.name;

  // Attendance summary
  const attByClass = {};
  for (const a of (attRes.data || [])) {
    if (!attByClass[a.class_id]) attByClass[a.class_id] = { P:0, L:0, A:0, E:0 };
    const s = { Present:'P', Late:'L', Absent:'A', Excused:'E' }[a.status] || 'A';
    attByClass[a.class_id][s]++;
  }

  // Pages summary
  const pagesByClass = {};
  for (const p of (pagesRes.data || [])) {
    if (!pagesByClass[p.class_id]) pagesByClass[p.class_id] = { pages: 0, students: 0 };
    pagesByClass[p.class_id].pages += p.pages_delta || 0;
    pagesByClass[p.class_id].students++;
  }

  // Participation summary
  const partByClass = {};
  for (const p of (partRes.data || [])) {
    if (!partByClass[p.class_id]) partByClass[p.class_id] = { total: 0, count: 0 };
    partByClass[p.class_id].total += p.score || 0;
    partByClass[p.class_id].count++;
  }

  // Build snapshot body text
  const allClassIds = new Set([
    ...Object.keys(attByClass),
    ...Object.keys(pagesByClass),
    ...Object.keys(partByClass),
  ].map(Number));

  let lines = [];
  for (const cid of [...allClassIds].sort((a,b) => a - b)) {
    const name = classMap[cid] || `Class ${cid}`;
    const att = attByClass[cid];
    const pg = pagesByClass[cid];
    const pt = partByClass[cid];
    let parts = [];
    if (att) parts.push(`att: ${att.P}P ${att.L}L ${att.A}A ${att.E}E`);
    if (pg) parts.push(`pages: ${pg.pages}p (${pg.students} students)`);
    if (pt && pt.count) parts.push(`part: ${(pt.total/pt.count).toFixed(1)}/5`);
    if (parts.length) lines.push(`• ${name}: ${parts.join(' | ')}`);
  }
  // Add gold summary to the body
  const goldTxs = (goldRes?.data || []);
  const totalGoldDistributed = goldTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
  let goldLine = '';
  if (goldTxs.length) {
    goldLine = `\n🪙 Total oro del día: ${totalGoldDistributed > 0 ? '+' : ''}${totalGoldDistributed} (${goldTxs.length} transacciones)`;
  }
  const body = (lines.length ? lines.join('\n') : '(Sin actividad hoy)') + goldLine;

  // 2. Save snapshot to claude_notifications
  const { error: logErr } = await supabase.from('claude_notifications').insert({
    title: `📊 Daily Log: ${T}`,
    body,
    read: false,
  });

  if (logErr) {
    toast('Error saving log: ' + logErr.message, 'error');
    btn.disabled = false; btn.textContent = '📊 Log & Close Day';
    return;
  }

  // 3. Reset current_gold to 0 for ALL students (gold history preserved in gold_transactions)
  // First get all student IDs
  const { data: allStudents } = await supabase.from('students').select('id');
  if (allStudents && allStudents.length) {
    await supabase.from('students').update({ current_gold: 0 }).in('id', allStudents.map(s => s.id));
  }

  // 4. Also mark all undistributed gold_transactions as distributed (gold reset)
  await supabase.from('gold_transactions')
    .update({ distributed: true, distributed_at: new Date().toISOString() })
    .eq('distributed', false)
    .lte('date', T);

  // 5. Reset student_pages total_pages counter for today
  await supabase.from('student_pages').update({ total_pages: 0 }).eq('date', T);

  // Note: attendance, participation_scores, and student_pages rows stay in DB for analytics
  // They are date-keyed, so tomorrow's class view will load fresh (no rows for tomorrow yet)

  // 6. Update UI
  statusEl.textContent = `Logged at ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  btn.textContent = '✅ Day Logged';
  btn.style.background = 'var(--green)';
  toast('Día cerrado ✅ Oro, asistencia y páginas reiniciados para mañana', 'success');
  loadPastLogs();
};

// ── Past Logs ─────────────────────────────────────────────────────────────────
async function loadPastLogs() {
  const el = document.getElementById('past-logs');
  if (!el) return;

  const { data } = await supabase.from('claude_notifications')
    .select('id, title, body, created_at')
    .like('title', '📊 Daily Log:%')
    .order('created_at', { ascending: false })
    .limit(30);

  const logs = data || [];
  if (!logs.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No daily logs yet</div>';
    return;
  }

  el.innerHTML = logs.map(log => {
    const dateStr = log.title.replace('📊 Daily Log: ', '');
    const lines = (log.body || '').split('\n');
    return `
      <details style="margin-bottom:8px;border-bottom:1px solid var(--gray-100);padding-bottom:8px">
        <summary style="font-size:14px;font-weight:600;cursor:pointer;padding:4px 0">
          ${fmtDate(dateStr)}
          <span style="font-size:12px;font-weight:400;color:var(--gray-400);margin-left:8px">${lines.length} class${lines.length !== 1 ? 'es' : ''}</span>
        </summary>
        <div style="margin-top:8px;font-size:13px;color:var(--gray-600)">
          ${lines.map(l => `<div style="padding:2px 0">${l}</div>`).join('')}
        </div>
      </details>`;
  }).join('');
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
