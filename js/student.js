// Life OS — Individual Student Profile (Phase 2)
import { supabase } from './supabase.js';
import { qp, fmtDate, fmtDateFull, goldStr, goldClass, attendanceBadge, toast, showSpinner, showEmpty } from './utils.js';
import { initSwipe } from './swipe-handler.js';

const studentId = qp('id');
if (!studentId) { window.location.href = 'students.html'; }

const T = new Date().toISOString().split('T')[0];
let studentData = null;
let allClasses = [];

async function load() {
  const [studentRes, classesRes] = await Promise.all([
    supabase.from('students').select('*').eq('id', studentId).single(),
    supabase.from('classes').select('id, name, track_pages'),
  ]);
  studentData = studentRes.data;
  allClasses = classesRes.data || [];
  const s = studentData;
  if (!s) { document.getElementById('student-name').textContent = 'Not found'; return; }

  document.title = s.name + ' — Life OS';
  document.getElementById('student-name').textContent = s.name;
  document.getElementById('student-subtitle').textContent = `Grade ${s.grade_level || '—'} · ${s.status}`;

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

  await Promise.all([
    loadNotes(s),
    loadGold(s),
    loadAttendance(s),
    loadGrades(s),
    loadClasses(s),
    loadPagesAnalytics(s),
  ]);
}

// ── Notes (grouped by class, with flags + swipe) ──────────────────────────
async function loadNotes(s) {
  const el = document.getElementById('notes-list');
  showSpinner(el);
  const res = await supabase.from('student_notes')
    .select('*, classes(name)')
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(100);
  const notes = res.data || [];

  // Separate active vs logged
  const active = notes.filter(n => !n.logged);
  const logged = notes.filter(n => n.logged);

  // Group active by class_id
  const byClass = {};
  const noClass = [];
  for (const n of active) {
    if (n.class_id) {
      if (!byClass[n.class_id]) byClass[n.class_id] = { name: n.classes?.name || 'Class ' + n.class_id, notes: [] };
      byClass[n.class_id].notes.push(n);
    } else {
      noClass.push(n);
    }
  }

  if (!active.length && !logged.length) { showEmpty(el, '📝', 'No notes yet'); return; }

  let html = '';

  // Render by class
  for (const [cid, group] of Object.entries(byClass)) {
    html += `<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">📚 ${group.name}</div>
      ${group.notes.map(n => noteRow(n)).join('')}
    </div>`;
  }
  if (noClass.length) {
    html += `<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">📝 General</div>
      ${noClass.map(n => noteRow(n)).join('')}
    </div>`;
  }

  // Log section
  if (logged.length) {
    html += `<div style="margin-top:16px">
      <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">📋 Log (${logged.length})</div>
      ${logged.slice(0,10).map(n => `
        <div class="list-item" style="opacity:0.6;padding:8px 0;border-bottom:1px solid var(--gray-100)">
          <div class="list-item-left">
            <div style="font-size:13px;color:var(--gray-600)">${n.note}</div>
            <div style="font-size:12px;color:var(--gray-400)">${n.classes?.name || 'General'} · ${fmtDate(n.date)} · Logged ${n.logged_at ? fmtDate(n.logged_at) : ''}</div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  el.innerHTML = html;

  // Apply swipe to all active note rows
  el.querySelectorAll('.swipe-note-item').forEach(item => {
    const noteId = item.dataset.id;
    initSwipe(item,
      // LEFT = delete
      async () => {
        await supabase.from('student_notes').delete().eq('id', noteId);
        toast('Note deleted', 'info');
        loadNotes(s);
      },
      // RIGHT = log it
      async () => {
        await supabase.from('student_notes').update({
          logged: true,
          logged_at: new Date().toISOString()
        }).eq('id', noteId);
        toast('Note logged ✓', 'success');
        loadNotes(s);
      }
    );
  });
}

function noteRow(n) {
  return `
    <div class="swipe-note-item list-item" data-id="${n.id}" style="padding:10px 12px;margin-bottom:4px;border-radius:8px;background:var(--gray-50);position:relative;overflow:hidden;touch-action:pan-y">
      <div data-swipe-inner style="width:100%">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="font-size:14px;flex:1">${n.note || '—'}</div>
          <div style="font-size:12px;color:var(--gray-400);white-space:nowrap;margin-left:8px">${fmtDate(n.date)}</div>
        </div>
        <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">
          ${n.show_in_overview ? '<span class="flag-badge flag-overview">👁 Overview</span>' : ''}
          ${n.is_todo ? '<span class="flag-badge flag-todo">✅ To-do</span>' : ''}
          ${n.tell_parent ? '<span class="flag-badge flag-parent">📞 Parent</span>' : ''}
        </div>
      </div>
    </div>`;
}

// ── Pages Analytics + class assignment warnings ───────────────────────────
async function loadPagesAnalytics(s) {
  const el = document.getElementById('pages-analytics');
  if (!el) return;

  // Check assignments
  const warnings = [];
  const englishClasses = allClasses.filter(c => c.track_pages === 'English');
  const mathClasses = allClasses.filter(c => c.track_pages === 'Math');

  // Check if student is enrolled in english/math page tracking classes
  const enrRes = await supabase.from('class_enrollments')
    .select('class_id, classes(id, name, track_pages)')
    .eq('student_id', studentId)
    .is('enrolled_until', null);
  const enrolledClassIds = new Set((enrRes.data || []).map(e => e.class_id));
  const enrolledClasses = (enrRes.data || []).map(e => e.classes).filter(Boolean);

  const enrolledEnglish = enrolledClasses.filter(c => c.track_pages === 'English');
  const enrolledMath = enrolledClasses.filter(c => c.track_pages === 'Math');

  if (enrolledEnglish.length === 0) {
    warnings.push({ type: 'missing', subject: 'English', msg: 'Not enrolled in any English pages class' });
  } else if (enrolledEnglish.length > 1) {
    warnings.push({ type: 'duplicate', subject: 'English', msg: `Enrolled in ${enrolledEnglish.length} English pages classes: ${enrolledEnglish.map(c => c.name).join(', ')}` });
  }
  if (enrolledMath.length === 0) {
    warnings.push({ type: 'missing', subject: 'Math', msg: 'Not enrolled in any Math pages class' });
  } else if (enrolledMath.length > 1) {
    warnings.push({ type: 'duplicate', subject: 'Math', msg: `Enrolled in ${enrolledMath.length} Math pages classes: ${enrolledMath.map(c => c.name).join(', ')}` });
  }

  // Fetch pages history
  const weekAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const pagesRes = await supabase.from('student_pages')
    .select('*, classes(name, track_pages)')
    .eq('student_id', studentId)
    .gte('date', weekAgo)
    .order('date', { ascending: false });
  const pages = pagesRes.data || [];

  let html = '';

  if (warnings.length) {
    html += warnings.map(w => `
      <div style="background:${w.type === 'duplicate' ? '#FEF3C7' : '#FEE2E2'};border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px">
        <strong>${w.type === 'duplicate' ? '⚠️' : '❗'} ${w.subject} Pages:</strong> ${w.msg}
      </div>`).join('');
  }

  if (pages.length) {
    const byClass = {};
    for (const p of pages) {
      const key = p.class_id;
      if (!byClass[key]) byClass[key] = { name: p.classes?.name || 'Class', entries: [] };
      byClass[key].entries.push(p);
    }
    for (const [cid, group] of Object.entries(byClass)) {
      const total = group.entries.reduce((sum, p) => sum + (p.total_pages || 0), 0);
      html += `
        <div style="margin-bottom:10px">
          <div style="font-size:12px;font-weight:700;color:var(--gray-400);margin-bottom:4px">${group.name}</div>
          ${group.entries.slice(0,7).map(p => `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid var(--gray-100)">
              <span>${fmtDate(p.date)}</span>
              <span style="font-weight:600">${p.total_pages}p ${p.gold_delta !== 0 ? `(${p.gold_delta > 0 ? '+' : ''}${p.gold_delta}🪙)` : ''}</span>
            </div>`).join('')}
        </div>`;
    }
  } else if (!warnings.length) {
    html = '<div style="color:var(--gray-400);font-size:14px">No pages logged in the last 2 weeks</div>';
  }

  el.innerHTML = html;
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
  let bal = s.current_gold ?? 0;
  const rows = [];
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
          <div class="list-item-sub">${fmtDate(g.date)} · ${g.classes?.name || '—'}</div>
        </div>
        <div class="list-item-right">
          <span style="font-weight:700;color:${color}">${g.score != null ? g.score : '—'}${g.max_points ? `/${g.max_points}` : ''}</span>
        </div>
      </div>`;
  }).join('');
}

async function loadClasses(s) {
  const el = document.getElementById('classes-list');
  const res = await supabase.from('class_enrollments')
    .select('*, classes(id, name, subject, day_of_week, track_pages)')
    .eq('student_id', studentId)
    .is('enrolled_until', null);
  const enrollments = res.data || [];
  if (!enrollments.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">Not enrolled in any classes</div>'; return; }
  el.innerHTML = enrollments.map(e => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${e.classes?.name || '—'}</div>
        <div class="list-item-sub">${e.classes?.subject || ''} · ${e.classes?.day_of_week || ''}${e.classes?.track_pages && e.classes.track_pages !== 'None' ? ` · 📄 ${e.classes.track_pages} Pages` : ''}</div>
      </div>
      <div class="list-item-right">
        <a href="class.html?id=${e.classes?.id}" class="btn btn-sm btn-ghost">→</a>
      </div>
    </div>`).join('');
}

load();
