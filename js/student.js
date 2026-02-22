// Life OS — Individual Student Profile
import { supabase } from './supabase.js';
import { qp, fmtDate, fmtDateFull, goldStr, goldClass, catBadge, catDot, attendanceBadge, toast, showSpinner, showEmpty } from './utils.js';

const studentId = qp('id');
if (!studentId) { window.location.href = 'students.html'; }

async function load() {
  const [studentRes] = await Promise.all([
    supabase.from('students').select('*').eq('id', studentId).single()
  ]);
  const s = studentRes.data;
  if (!s) { document.getElementById('student-name').textContent = 'Not found'; return; }

  document.title = s.name + ' — Life OS';
  document.getElementById('student-name').textContent = s.name;
  document.getElementById('student-subtitle').textContent = `Grade ${s.grade_level || '—'} · ${s.status}`;

  // Header card
  document.getElementById('student-header').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:22px;font-weight:700">${s.name}</div>
          <div style="color:var(--gray-400);font-size:13px">Grade ${s.grade_level || '—'} · ${s.date_of_birth ? fmtDate(s.date_of_birth) : ''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:28px;font-weight:700;color:var(--gold)">${s.current_gold ?? 0} 🪙</div>
          <div style="font-size:12px;color:var(--gray-400)">gold balance</div>
        </div>
      </div>
      ${s.parent_names || s.contact_phone || s.contact_email ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-100);font-size:13px;color:var(--gray-600)">
          ${s.parent_names ? `<div>👨‍👩‍👧 ${s.parent_names}</div>` : ''}
          ${s.contact_phone ? `<div>📞 <a href="tel:${s.contact_phone}">${s.contact_phone}</a></div>` : ''}
          ${s.contact_email ? `<div>✉️ <a href="mailto:${s.contact_email}">${s.contact_email}</a></div>` : ''}
        </div>` : ''}
      ${s.notes ? `<div style="margin-top:10px;font-size:13px;color:var(--gray-600);padding-top:10px;border-top:1px solid var(--gray-100)">${s.notes}</div>` : ''}
    </div>`;

  await Promise.all([loadNotes(s), loadGold(s), loadAttendance(s), loadGrades(s), loadClasses(s), loadFollowups(s)]);
}

async function loadNotes(s) {
  const el = document.getElementById('notes-list');
  showSpinner(el);
  const res = await supabase.from('student_notes')
    .select('*')
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(50);
  const notes = res.data || [];
  if (!notes.length) { showEmpty(el, '📝', 'No notes yet'); return; }

  // Filter controls
  const cats = [...new Set(notes.map(n => n.category))].sort();
  let active = 'All';
  function renderNotes() {
    const filtered = active === 'All' ? notes : notes.filter(n => n.category === active);
    el.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${['All', ...cats].map(c => `<button class="btn btn-sm ${c === active ? 'btn-primary' : 'btn-ghost'}" onclick="filterNotes('${c}')">${c}</button>`).join('')}
      </div>
      ${filtered.map(n => `
        <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:4px">
          <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
            <div style="display:flex;gap:6px;align-items:center">${catDot(n.category)} ${catBadge(n.category)}</div>
            <div style="font-size:12px;color:var(--gray-400)">${fmtDate(n.date)}${n.followup_needed ? ' 📌' : ''}</div>
          </div>
          <div style="font-size:14px">${n.note || '—'}</div>
        </div>`).join('')}`;
  }
  window.filterNotes = (cat) => { active = cat; renderNotes(); };
  renderNotes();
}

async function loadGold(s) {
  const el = document.getElementById('gold-list');
  const res = await supabase.from('gold_transactions')
    .select('*')
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(30);
  const txs = res.data || [];
  if (!txs.length) { showEmpty(el, '🪙', 'No gold transactions'); return; }
  let running = s.current_gold ?? 0;
  // Build running total backwards — add back each tx
  // We show balance at time of each tx going backward
  const rows = [];
  let bal = running;
  for (const t of txs) {
    rows.push({ ...t, balance: bal });
    bal -= t.amount;
  }
  el.innerHTML = rows.map(t => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name" style="font-size:14px">${t.reason || '—'}</div>
        <div class="list-item-sub">${fmtDate(t.date)} · ${t.category || '—'}${t.distributed ? '' : ' · pending'}</div>
      </div>
      <div class="list-item-right">
        <span class="${goldClass(t.amount)}" style="font-weight:700">${goldStr(t.amount)}</span>
        <span style="font-size:12px;color:var(--gray-400)">${t.balance}🪙</span>
      </div>
    </div>`).join('');
}

async function loadAttendance(s) {
  const el = document.getElementById('attendance-summary');
  const res = await supabase.from('attendance')
    .select('*, classes(name)')
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(60);
  const rows = res.data || [];
  if (!rows.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No attendance records</div>'; return; }
  const total = rows.length;
  const present = rows.filter(r => r.status === 'Present').length;
  const pct = total > 0 ? Math.round(present / total * 100) : 0;
  el.innerHTML = `
    <div style="font-size:24px;font-weight:700;color:${pct >= 90 ? 'var(--green)' : pct >= 75 ? 'var(--orange)' : 'var(--red)'}">${pct}%</div>
    <div style="font-size:13px;color:var(--gray-400);margin-bottom:12px">${present} present / ${total} sessions</div>
    ${rows.slice(0, 10).map(r => `
      <div class="list-item">
        <div class="list-item-left"><div class="list-item-sub">${r.classes?.name || '—'} · ${fmtDate(r.date)}</div></div>
        <div class="list-item-right">${attendanceBadge(r.status)}</div>
      </div>`).join('')}`;
}

async function loadGrades(s) {
  const el = document.getElementById('grades-list');
  const res = await supabase.from('grades')
    .select('*, classes(name)')
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(20);
  const grades = res.data || [];
  if (!grades.length) { showEmpty(el, '📊', 'No grades recorded'); return; }
  el.innerHTML = grades.map(g => {
    const pct = g.max_points > 0 ? Math.round(g.score / g.max_points * 100) : null;
    const color = pct == null ? 'var(--gray-400)' : pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--orange)' : 'var(--red)';
    return `
      <div class="list-item">
        <div class="list-item-left">
          <div class="list-item-name" style="font-size:14px">${g.assignment || '—'}</div>
          <div class="list-item-sub">${fmtDate(g.date)} · ${g.classes?.name || '—'} · ${g.category || '—'}</div>
        </div>
        <div class="list-item-right">
          <span style="font-weight:700;color:${color}">${g.score != null ? g.score : '—'}${g.max_points ? `/${g.max_points}` : ''}</span>
          ${pct != null ? `<span style="font-size:12px;color:${color}">${pct}%</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function loadClasses(s) {
  const el = document.getElementById('classes-list');
  const res = await supabase.from('class_enrollments')
    .select('*, classes(id, name, subject, day_of_week)')
    .eq('student_id', studentId)
    .is('enrolled_until', null);
  const enrollments = res.data || [];
  if (!enrollments.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">Not enrolled in any classes</div>'; return; }
  el.innerHTML = enrollments.map(e => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${e.classes?.name || '—'}</div>
        <div class="list-item-sub">${e.classes?.subject || ''} · ${e.classes?.day_of_week || ''}${e.skip_days ? ` (skips ${e.skip_days})` : ''}</div>
      </div>
      <div class="list-item-right">
        <a href="class.html?id=${e.classes?.id}" class="btn btn-sm btn-ghost">→</a>
      </div>
    </div>`).join('');
}

async function loadFollowups(s) {
  const el = document.getElementById('followups-list');
  const res = await supabase.from('student_notes')
    .select('*')
    .eq('student_id', studentId)
    .eq('followup_needed', true)
    .order('date', { ascending: false });
  const notes = res.data || [];
  if (!notes.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No pending followups</div>'; return; }
  el.innerHTML = notes.map(n => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-sub">${fmtDate(n.date)} · ${n.category}</div>
        <div style="font-size:14px;margin-top:2px">${n.note || '—'}</div>
      </div>
    </div>`).join('');
}

load();
