// Life OS — Class Dashboard (Phase 2, v3 — no polling, single-expand, desktop buttons)
import { supabase } from './supabase.js';
import { qp, today, fmtDate, fmtTime, daysAgo, goldStr, goldClass, toast, showSpinner, showEmpty, pstDatePlusDays } from './utils.js';
import { initSwipe } from './swipe-handler.js';

const classId = qp('id');
if (!classId) { window.location.href = 'classes.html'; }

const T = today();
let cls = null;

// ── Expand state: only ONE open at a time ─────────────────────────────────
let expandedStudent = null;  // single student id, not a Set

async function load() {
  const res = await supabase.from('classes').select('*').eq('id', classId).single();
  cls = res.data;
  if (!cls) return;

  document.title = cls.name + ' — Life OS';
  document.getElementById('class-name').textContent = cls.name;
  document.getElementById('class-subtitle').textContent =
    [cls.subject, cls.day_of_week, cls.room ? 'Room ' + cls.room : null]
      .filter(Boolean).join(' · ');
  if (cls.current_unit) document.getElementById('class-unit').textContent = '📖 ' + cls.current_unit;

  renderClassSettingsBadge(cls);

  await Promise.all([
    loadUniversalClassNotes(),
    loadOverviewNotesSection(),
    loadRoster(cls),
    loadGoldBulk(),
    loadLessonPlans(),
    loadRecentNotes(),
    loadAttendanceGrid(),
    cls.track_pages !== 'None' ? loadAnalytics() : Promise.resolve(),
  ]);
}

function renderClassSettingsBadge(cls) {
  const el = document.getElementById('class-settings-badge');
  if (!el) return;
  if (cls.track_pages && cls.track_pages !== 'None') {
    el.textContent = '📄 Tracking ' + cls.track_pages + ' Pages';
    el.style.display = 'inline-block';
  } else {
    el.style.display = 'none';
  }
}

// ── Roster + side-by-side attendance buttons ──────────────────────────────
const attMap = {};
const partMap = {}; // participation scores: { studentId: score }
let enrollments = [];

async function loadRoster(cls) {
  const el = document.getElementById('roster');
  showSpinner(el);

  const [enrRes, attRes, pagesRes, partRes] = await Promise.all([
    supabase.from('class_enrollments')
      .select('*, students(id, name, current_gold, english_pages_class_id, math_pages_class_id)')
      .eq('class_id', classId)
      .is('enrolled_until', null),
    supabase.from('attendance')
      .select('*')
      .eq('class_id', classId)
      .eq('date', T),
    cls.track_pages !== 'None'
      ? supabase.from('student_pages')
          .select('student_id, total_pages')
          .eq('class_id', classId)
          .eq('date', T)
      : Promise.resolve({ data: [] }),
    supabase.from('participation_scores')
      .select('student_id, score')
      .eq('class_id', classId)
      .eq('date', T),
  ]);

  // Filter out students who skip today's day of week
  const todayAbbr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(T + 'T00:00:00').getDay()];
  enrollments = (enrRes.data || []).filter(e => {
    if (!e.skip_days) return true;
    const skipList = e.skip_days.split(',').map(s => s.trim());
    return !skipList.includes(todayAbbr);
  });
  if (!enrollments.length) { showEmpty(el, '👥', 'No students enrolled'); return; }

  for (const a of (attRes.data || [])) {
    attMap[a.student_id] = a.status;
  }

  for (const p of (partRes.data || [])) {
    partMap[p.student_id] = p.score;
  }

  const pagesMap = {};
  for (const p of (pagesRes.data || [])) {
    pagesMap[p.student_id] = p.total_pages;
  }

  renderRoster(enrollments, pagesMap);
  // Re-expand if one was open
  if (expandedStudent) {
    loadOverviewNotes(expandedStudent);
  }
}

function renderRoster(enrs, pagesMap = {}) {
  const el = document.getElementById('roster');
  const trackPages = cls?.track_pages !== 'None';

  el.innerHTML = enrs.map(e => {
    const s = e.students;
    const status = attMap[s.id] || null;
    const isExpanded = expandedStudent === s.id;
    const pages = pagesMap[s.id] ?? null;

    const attButtons = ['Present','Late','Absent','Excused'].map(opt => {
      const sel = status === opt;
      const colors = {
        Present: 'var(--green)', Late: 'var(--orange)',
        Absent: 'var(--red)', Excused: 'var(--gray-400)'
      };
      return `<button class="att-pill ${sel ? 'att-pill-selected' : ''}"
        style="${sel ? `background:${colors[opt]};color:#fff;` : ''}"
        onclick="setAtt(${s.id},'${opt}')">${opt[0]}</button>`;
    }).join('');

    const partScore = partMap[s.id] ?? null;
    const partColors = ['#ef4444','#f97316','#eab308','#84cc16','#22c55e']; // 1=red … 5=green
    const partLabels = ['1','2','3','4','5'];
    const partButtons = partLabels.map((lbl, idx) => {
      const val = idx + 1;
      const sel = partScore === val;
      return `<button class="part-pill ${sel ? 'part-pill-selected' : ''}"
        id="part-pill-${s.id}-${val}"
        style="width:26px;height:26px;border-radius:50%;border:2px solid ${partColors[idx]};
               background:${sel ? partColors[idx] : 'transparent'};
               color:${sel ? '#fff' : partColors[idx]};
               font-size:11px;font-weight:700;cursor:pointer;padding:0;flex-shrink:0"
        onclick="setParticipation(${s.id},${val})">${lbl}</button>`;
    }).join('');

    return `
      <div class="roster-row" id="roster-row-${s.id}">
        <div class="roster-main" style="flex-wrap:wrap;gap:4px">
          <button class="roster-expand-btn" onclick="toggleExpand(${s.id})" title="Expand">
            ${isExpanded ? '▼' : '▶'}
          </button>
          <a href="student.html?id=${s.id}" class="roster-name">
            ${s.name}
          </a>
          <span class="roster-gold">${s.current_gold ?? 0}🪙</span>
          ${trackPages && pages !== null ? `<span class="roster-pages">${pages}p</span>` : ''}
          <div class="att-pills">${attButtons}</div>
          <div class="part-pills" style="display:flex;gap:3px;align-items:center;margin-left:4px" title="Participation (1–5)">
            <span style="font-size:10px;color:var(--gray-400);margin-right:2px">⭐</span>
            ${partButtons}
          </div>
        </div>
        ${isExpanded ? renderExpandedStudent(s, pages) : ''}
      </div>`;
  }).join('');
}

function renderExpandedStudent(s, pages) {
  const trackPages = cls?.track_pages !== 'None';
  const trackType = cls?.track_pages;

  return `
    <div class="roster-expanded" id="expanded-${s.id}">
      ${trackPages ? `
        <div class="pages-control">
          <span class="pages-label">📄 ${trackType} Pages Today: <strong id="pages-display-${s.id}">${pages ?? 0}</strong></span>
          <div class="pages-buttons">
            <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;min-width:36px" onclick="adjustPages(${s.id}, -1)">−</button>
            <button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;min-width:36px" onclick="adjustPages(${s.id}, 1)">+</button>
          </div>
          <span style="font-size:12px;color:var(--gray-400)">±2🪙 per page</span>
        </div>
        <div id="pages-stats-${s.id}" style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <div style="color:var(--gray-400);font-size:12px">Loading pace…</div>
        </div>` : ''}
      <div id="overview-notes-${s.id}" class="overview-notes">
        <div style="color:var(--gray-400);font-size:13px">Loading notes…</div>
      </div>
      <div class="quick-note-form">
        <input type="text" id="quick-note-input-${s.id}" class="form-input"
          placeholder="Quick note for ${s.name}…"
          style="font-size:13px"
          onclick="event.stopPropagation()">
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
          <label class="flag-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" id="qn-overview-${s.id}"> 👁 Overview
          </label>
          <label class="flag-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" id="qn-todo-${s.id}"> ✅ To-do
          </label>
          <label class="flag-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" id="qn-parent-${s.id}"> 📞 Tell Parent
          </label>
          <button class="btn btn-sm btn-primary" onclick="submitQuickNote(${s.id})">Add Note</button>
        </div>
      </div>
    </div>`;
}

// ── Single-expand: close previous, open new ────────────────────────────────
window.toggleExpand = async (studentId) => {
  if (expandedStudent === studentId) {
    // Close this one
    expandedStudent = null;
  } else {
    // Open this one, close any previous
    expandedStudent = studentId;
  }

  // Rebuild pagesMap from current DOM
  const pagesMap = {};
  document.querySelectorAll('[id^="pages-display-"]').forEach(el => {
    const sid = parseInt(el.id.replace('pages-display-', ''), 10);
    pagesMap[sid] = parseInt(el.textContent, 10) || 0;
  });
  renderRoster(enrollments, pagesMap);

  if (expandedStudent) {
    loadOverviewNotes(expandedStudent);
  }
};

async function loadOverviewNotes(studentId) {
  const el = document.getElementById(`overview-notes-${studentId}`);
  if (!el) return;

  const thirtyAgo = pstDatePlusDays(-30);
  const sevenAgo  = pstDatePlusDays(-7);
  const trackPages = cls?.track_pages !== 'None';

  const fetches = [
    supabase.from('student_notes')
      .select('id, note, is_todo, tell_parent, logged, date, class_id')
      .eq('student_id', studentId)
      .eq('class_id', classId)
      .eq('show_in_overview', true)
      .eq('logged', false)
      .order('date', { ascending: false })
      .limit(5),
  ];

  if (trackPages) {
    fetches.push(
      supabase.from('student_pages')
        .select('date, pages_delta')
        .eq('student_id', studentId)
        .eq('class_id', classId)
        .gte('date', thirtyAgo)
        .order('date', { ascending: false })
    );
  }

  const [notesRes, pagesRes] = await Promise.all(fetches);

  // Populate pages stats tile
  if (trackPages) {
    const statsEl = document.getElementById(`pages-stats-${studentId}`);
    if (statsEl) {
      const rows = pagesRes?.data || [];
      const total7  = rows.filter(r => r.date >= sevenAgo).reduce((s, r) => s + (r.pages_delta || 0), 0);
      const total30 = rows.reduce((s, r) => s + (r.pages_delta || 0), 0);
      const lastDate = rows.length ? rows[0].date : null;

      if (rows.length === 0) {
        statsEl.innerHTML = '<div style="color:var(--gray-400);font-size:12px">No pages logged yet for this class</div>';
      } else {
        const tile = (label, val) =>
          `<div style="background:var(--gray-50);border-radius:8px;padding:6px 10px;min-width:80px;text-align:center;flex:1">
            <div style="font-size:18px;font-weight:700;color:var(--orange)">${val}</div>
            <div style="font-size:11px;color:var(--gray-400)">${label}</div>
          </div>`;
        statsEl.innerHTML =
          `<div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.04em;width:100%;margin-bottom:4px">📄 Pages — This Class</div>` +
          tile('7 days', total7) +
          tile('30 days', total30) +
          tile('last logged', lastDate ? daysAgo(lastDate) : '—');
      }
    }
  }

  const notes = notesRes.data || [];
  if (!notes.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:4px 0">No overview notes for this class.</div>';
    return;
  }

  el.innerHTML = notes.map(n => `
    <div class="overview-note-row" data-id="${n.id}" style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--gray-100)">
      <div style="flex:1;font-size:13px">${n.note}
        <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">
          ${n.is_todo ? '<span class="flag-badge flag-todo">✅</span>' : ''}
          ${n.tell_parent ? '<span class="flag-badge flag-parent">📞</span>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;font-size:11px;padding:2px 6px" onclick="logNote('${n.id}',${studentId})">✓ Log</button>
        <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;font-size:11px;padding:2px 6px" onclick="deleteNote('${n.id}',${studentId})">✕</button>
      </div>
    </div>`).join('');
}

window.logNote = async (noteId, studentId) => {
  await supabase.from('student_notes').update({ logged: true, logged_at: new Date().toISOString() }).eq('id', noteId);
  toast('Note logged ✓', 'success');
  loadOverviewNotes(studentId);
};

window.deleteNote = async (noteId, studentId) => {
  await supabase.from('student_notes').delete().eq('id', noteId);
  toast('Note deleted', 'info');
  loadOverviewNotes(studentId);
};

window.submitQuickNote = async (studentId) => {
  const input = document.getElementById(`quick-note-input-${studentId}`);
  const note = input?.value?.trim();
  if (!note) { toast('Enter a note first', 'info'); return; }

  const showInOverview = document.getElementById(`qn-overview-${studentId}`)?.checked || false;
  const isTodo = document.getElementById(`qn-todo-${studentId}`)?.checked || false;
  const tellParent = document.getElementById(`qn-parent-${studentId}`)?.checked || false;

  try {
    const { error } = await supabase.from('student_notes').insert({
      student_id: studentId,
      class_id: Number(classId),
      date: T,
      note,
      category: 'Class Note',
      show_in_overview: showInOverview,
      is_todo: isTodo,
      tell_parent: tellParent,
      logged: false,
    });

    if (error) { toast('Note error: ' + error.message, 'error'); return; }

    if (tellParent) {
      const { error: crmErr } = await supabase.from('parent_crm').insert({
        student_id: studentId,
        title: note.slice(0, 100),
        notes: note,
        status: 'pending',
      });
      if (crmErr) toast('CRM error: ' + crmErr.message, 'error');
    }

    toast('Note added!', 'success');
    if (input) input.value = '';
    loadOverviewNotes(studentId);
  } catch (e) {
    toast('Network error: ' + (e.message || 'failed to fetch'), 'error');
    console.error('submitQuickNote error:', e);
  }
};

// ── Attendance: side-by-side buttons ─────────────────────────────────────
window.setAtt = async (studentId, status) => {
  // Toggle off if same status clicked again
  const newStatus = attMap[studentId] === status ? null : status;
  const prev = attMap[studentId];
  attMap[studentId] = newStatus;

  // Update pills in-place
  const row = document.getElementById(`roster-row-${studentId}`);
  if (row) {
    const colors = { Present: 'var(--green)', Late: 'var(--orange)', Absent: 'var(--red)', Excused: 'var(--gray-400)' };
    const opts = ['Present','Late','Absent','Excused'];
    row.querySelectorAll('.att-pill').forEach((btn, idx) => {
      const optName = opts[idx];
      const sel = optName === newStatus;
      btn.className = `att-pill ${sel ? 'att-pill-selected' : ''}`;
      btn.style.background = sel ? colors[optName] : '';
      btn.style.color = sel ? '#fff' : '';
    });
  }

  if (newStatus) {
    const { error } = await supabase.from('attendance').upsert({
      student_id: studentId, class_id: Number(classId), date: T, status: newStatus
    }, { onConflict: 'student_id,class_id,date' });
    if (error) { toast('Error saving attendance', 'error'); attMap[studentId] = prev; }
  } else {
    // Remove attendance record
    await supabase.from('attendance').delete()
      .eq('student_id', studentId).eq('class_id', Number(classId)).eq('date', T);
  }
};

// ── Participation Score ───────────────────────────────────────────────────
window.setParticipation = async (studentId, score) => {
  const prev = partMap[studentId];
  // Toggle off if same score clicked again
  const newScore = prev === score ? null : score;
  partMap[studentId] = newScore;

  // Update pills in-place
  const partColors = ['#ef4444','#f97316','#eab308','#84cc16','#22c55e'];
  for (let v = 1; v <= 5; v++) {
    const btn = document.getElementById(`part-pill-${studentId}-${v}`);
    if (!btn) continue;
    const sel = v === newScore;
    btn.style.background = sel ? partColors[v-1] : 'transparent';
    btn.style.color = sel ? '#fff' : partColors[v-1];
  }

  if (newScore !== null) {
    const { error } = await supabase.from('participation_scores').upsert({
      student_id: studentId,
      class_id: Number(classId),
      date: T,
      score: newScore,
    }, { onConflict: 'student_id,class_id,date' });
    if (error) { toast('Error saving participation', 'error'); partMap[studentId] = prev; }
  } else {
    await supabase.from('participation_scores').delete()
      .eq('student_id', studentId).eq('class_id', Number(classId)).eq('date', T);
  }
};

// ── Pages tracking ────────────────────────────────────────────────────────
window.adjustPages = async (studentId, delta) => {
  const displayEl = document.getElementById(`pages-display-${studentId}`);
  const currentPages = parseInt(displayEl?.textContent || '0', 10);
  const newPages = Math.max(0, currentPages + delta);
  const goldDelta = delta * 2;

  if (displayEl) displayEl.textContent = newPages;

  const studentEnr = enrollments.find(e => e.students?.id === studentId);
  const studentData = studentEnr?.students;
  const currentGold = studentData?.current_gold ?? 0;
  const newGold = currentGold + goldDelta;

  document.querySelectorAll(`#roster-row-${studentId} .roster-gold`).forEach(el => el.textContent = newGold + '🪙');

  // Fetch existing row for today first, then update or insert
  const { data: existingRows } = await supabase.from('student_pages')
    .select('id, total_pages, gold_delta, pages_delta')
    .eq('student_id', studentId)
    .eq('class_id', Number(classId))
    .eq('date', T)
    .limit(1);

  let pagesErr;
  if (existingRows && existingRows.length > 0) {
    const existing = existingRows[0];
    const result = await supabase.from('student_pages').update({
      pages_delta: (existing.pages_delta || 0) + delta,
      total_pages: newPages,
      gold_delta: (existing.gold_delta || 0) + goldDelta,
    }).eq('id', existing.id);
    pagesErr = result.error;
  } else {
    const result = await supabase.from('student_pages').insert({
      student_id: studentId,
      class_id: Number(classId),
      date: T,
      pages_delta: delta,
      total_pages: newPages,
      gold_delta: goldDelta,
    });
    pagesErr = result.error;
  }

  if (pagesErr) { toast('Pages error: ' + pagesErr.message, 'error'); return; }

  await supabase.from('students').update({ current_gold: newGold }).eq('id', studentId);
  await supabase.from('gold_transactions').insert({
    student_id: studentId,
    class_id: Number(classId),
    date: T,
    amount: goldDelta,
    reason: `Pages: ${delta > 0 ? '+' : ''}${delta} page${Math.abs(delta) !== 1 ? 's' : ''}`,
    category: 'Participation',
    distributed: false,
  });

  // Refresh analytics without full reload
  if (cls?.track_pages !== 'None') loadAnalytics();
};

// ── Bulk Gold (no polling — user-driven only) ─────────────────────────────
const goldChecked = new Set();
let goldBulkRendered = false;

async function loadGoldBulk() {
  const res = await supabase.from('class_enrollments')
    .select('student_id, skip_days, students(id, name, current_gold)')
    .eq('class_id', classId)
    .is('enrolled_until', null);
  // Filter out students skipping today
  const todayAbbrG = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(T + 'T00:00:00').getDay()];
  const filtered = (res.data || []).filter(e => {
    if (!e.skip_days) return true;
    return !e.skip_days.split(',').map(s => s.trim()).includes(todayAbbrG);
  });
  renderGoldBulk(filtered);
  goldBulkRendered = true;
}

function renderGoldBulk(enrs) {
  const el = document.getElementById('gold-adder');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
      <input type="number" id="gold-amount" class="form-input" placeholder="Amount" min="-999" max="999" style="width:90px;text-align:center">
      <input type="text" id="gold-reason" class="form-input" placeholder="Reason" style="flex:1">
    </div>
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-sm btn-ghost" onclick="selectAll()">All</button>
      <button class="btn btn-sm btn-ghost" onclick="selectNone()">Clear</button>
      <button class="btn btn-sm" style="background:var(--orange-light);color:var(--orange);border:none" onclick="setAmount(5)">+5</button>
      <button class="btn btn-sm" style="background:var(--orange-light);color:var(--orange);border:none" onclick="setAmount(10)">+10</button>
      <button class="btn btn-sm" style="background:var(--orange-light);color:var(--orange);border:none" onclick="setAmount(25)">+25</button>
      <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none" onclick="setAmount(-5)">−5</button>
      <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none" onclick="setAmount(-10)">−10</button>
    </div>
    ${enrs.map(e => {
      const s = e.students;
      return `
        <div class="gold-bulk-row">
          <input type="checkbox" class="gold-bulk-check" id="gc-${s.id}"
            ${goldChecked.has(s.id) ? 'checked' : ''}
            onchange="toggleGoldCheck(${s.id}, this.checked)">
          <label for="gc-${s.id}" class="gold-bulk-name" style="cursor:pointer">${s.name}</label>
          <span class="gold-bulk-bal">${s.current_gold ?? 0} 🪙</span>
        </div>`;
    }).join('')}
    <div style="margin-top:14px">
      <button class="btn btn-gold btn-full" onclick="submitBulkGold()">🪙 Submit Gold</button>
    </div>`;
}

window.toggleGoldCheck = (id, checked) => {
  if (checked) goldChecked.add(id); else goldChecked.delete(id);
};
window.selectAll = () => {
  document.querySelectorAll('.gold-bulk-check').forEach(cb => {
    cb.checked = true; goldChecked.add(Number(cb.id.replace('gc-', '')));
  });
};
window.selectNone = () => {
  document.querySelectorAll('.gold-bulk-check').forEach(cb => { cb.checked = false; });
  goldChecked.clear();
};
window.setAmount = (val) => {
  const inp = document.getElementById('gold-amount');
  if (inp) inp.value = val;
};

window.submitBulkGold = async () => {
  const amountRaw = parseInt(document.getElementById('gold-amount').value, 10);
  const reason = document.getElementById('gold-reason').value.trim() || 'Class gold';
  if (!amountRaw || amountRaw === 0) { toast('Enter an amount', 'info'); return; }
  if (!goldChecked.size) { toast('Select at least one student', 'info'); return; }

  const inserts = [];
  for (const sid of goldChecked) {
    inserts.push({
      student_id: sid, class_id: Number(classId), date: T,
      amount: amountRaw, reason,
      category: amountRaw > 0 ? 'Participation' : 'Behavior',
      distributed: false,
    });
  }

  const { error } = await supabase.from('gold_transactions').insert(inserts);
  if (error) { toast('Error: ' + error.message, 'error'); return; }

  for (const sid of goldChecked) {
    const r = await supabase.from('students').select('current_gold').eq('id', sid).single();
    const cur = r.data?.current_gold ?? 0;
    await supabase.from('students').update({ current_gold: cur + amountRaw }).eq('id', sid);
  }

  toast(`Gold submitted for ${goldChecked.size} student${goldChecked.size > 1 ? 's' : ''}!`, 'success');
  goldChecked.clear();
  document.getElementById('gold-amount').value = '';
  document.getElementById('gold-reason').value = '';
  loadGoldBulk();
};

// ── Recent Notes (class-level) — desktop action buttons + swipe ───────────
async function loadRecentNotes() {
  const el = document.getElementById('recent-notes');
  const res = await supabase.from('student_notes')
    .select('*, students(id, name), classes(name)')
    .eq('class_id', classId)
    .eq('logged', false)
    .order('date', { ascending: false })
    .limit(20);
  const notes = res.data || [];

  // Fetch all classes for the class-change dropdown
  const classesRes = await supabase.from('classes').select('id, name').order('name');
  const allClasses = classesRes.data || [];

  if (!notes.length) { showEmpty(el, '📝', 'No active notes for this class'); return; }

  el.innerHTML = notes.map(n => `
    <div class="note-row-desktop" data-id="${n.id}" id="note-${n.id}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <strong style="font-size:14px">${n.students?.name || '—'}</strong>
          ${n.show_in_overview ? '<span class="flag-badge flag-overview">👁</span>' : ''}
          ${n.is_todo ? '<span class="flag-badge flag-todo">✅</span>' : ''}
          ${n.tell_parent ? '<span class="flag-badge flag-parent">📞</span>' : ''}
        </div>
        <div style="font-size:13px;color:var(--gray-600);margin-top:2px">${n.note || '—'}</div>
        <div style="font-size:12px;color:var(--gray-400);margin-top:2px;display:flex;align-items:center;gap:6px">
          ${fmtDate(n.date)}
          <select class="note-class-select" onchange="changeNoteClass('${n.id}', this.value)" style="font-size:11px;border:1px solid var(--gray-200);border-radius:4px;padding:1px 4px;color:var(--gray-600)">
            ${allClasses.map(c => `<option value="${c.id}" ${c.id === n.class_id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0;align-items:flex-start">
        <button class="btn btn-sm" style="background:var(--green-light);color:var(--green);border:none;font-size:11px;padding:3px 7px" onclick="logRecentNote('${n.id}')">✓ Log</button>
        <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none;font-size:11px;padding:3px 7px" onclick="deleteRecentNote('${n.id}')">✕ Del</button>
      </div>
    </div>`).join('');

  // Also attach swipe for mobile
  el.querySelectorAll('.note-row-desktop').forEach(item => {
    const noteId = item.dataset.id;
    initSwipe(item,
      async () => { await deleteRecentNoteById(noteId); loadRecentNotes(); },
      async () => { await logRecentNoteById(noteId); loadRecentNotes(); }
    );
  });
}

async function logRecentNoteById(noteId) {
  await supabase.from('student_notes').update({ logged: true, logged_at: new Date().toISOString() }).eq('id', noteId);
  toast('Note logged ✓', 'success');
}
async function deleteRecentNoteById(noteId) {
  await supabase.from('student_notes').delete().eq('id', noteId);
  toast('Note deleted', 'info');
}

window.logRecentNote = async (noteId) => {
  await logRecentNoteById(noteId);
  loadRecentNotes();
};
window.deleteRecentNote = async (noteId) => {
  await deleteRecentNoteById(noteId);
  loadRecentNotes();
};
window.changeNoteClass = async (noteId, newClassId) => {
  await supabase.from('student_notes').update({ class_id: Number(newClassId) }).eq('id', noteId);
  toast('Note moved', 'success');
};

// ── Attendance Grid ────────────────────────────────────────────────────────
async function loadAttendanceGrid() {
  const el = document.getElementById('att-grid');
  const start = pstDatePlusDays(-14);

  const [rosterRes, attRes] = await Promise.all([
    supabase.from('class_enrollments')
      .select('student_id, students(id, name)')
      .eq('class_id', classId)
      .is('enrolled_until', null),
    supabase.from('attendance')
      .select('*')
      .eq('class_id', classId)
      .gte('date', start)
      .lte('date', T),
  ]);

  const students = (rosterRes.data || []).map(e => e.students);
  const attRecords = attRes.data || [];
  const histMap = {};
  for (const a of attRecords) {
    if (!histMap[a.student_id]) histMap[a.student_id] = {};
    histMap[a.student_id][a.date] = a.status;
  }

  const days = [];
  for (let i = 9; i >= 0; i--) {
    days.push(pstDatePlusDays(-i));
  }

  const colors = { Present: 'var(--green)', Absent: 'var(--red)', Late: 'var(--orange)', Excused: 'var(--gray-400)' };

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;font-size:12px;min-width:100%">
        <tr>
          <th style="text-align:left;padding:4px 8px;color:var(--gray-400)">Student</th>
          ${days.map(d => `<th style="padding:4px;color:var(--gray-400)">${d.slice(5)}</th>`).join('')}
        </tr>
        ${students.map(s => `
          <tr>
            <td style="padding:4px 8px;font-weight:600;white-space:nowrap">
              <a href="student.html?id=${s.id}" style="color:inherit;text-decoration:none">${s.name}</a>
            </td>
            ${days.map(d => {
              const st = histMap[s.id]?.[d];
              return `<td style="padding:4px;text-align:center">
                <div title="${st || '—'}" style="width:12px;height:12px;border-radius:50%;margin:auto;background:${st ? colors[st] : 'var(--gray-200)'}"></div>
              </td>`;
            }).join('')}
          </tr>`).join('')}
      </table>
    </div>`;
}

// ── Class Analytics (pages tracking classes only) ─────────────────────────
async function loadAnalytics() {
  const el = document.getElementById('analytics-section');
  if (!el) return;
  el.style.display = 'block';

  const weekAgo = pstDatePlusDays(-7);

  const [pagesRes, enrRes] = await Promise.all([
    supabase.from('student_pages')
      .select('student_id, total_pages, pages_delta, date')
      .eq('class_id', classId)
      .gte('date', weekAgo)
      .lte('date', T),
    supabase.from('class_enrollments')
      .select('student_id, students(id, name, current_gold)')
      .eq('class_id', classId)
      .is('enrolled_until', null),
  ]);

  const pagesData = pagesRes.data || [];
  const students = (enrRes.data || []).map(e => e.students);

  const weekTotals = {};
  const daysWithPages = {};
  for (const p of pagesData) {
    weekTotals[p.student_id] = (weekTotals[p.student_id] || 0) + (p.pages_delta || 0);
    if (!daysWithPages[p.student_id]) daysWithPages[p.student_id] = new Set();
    daysWithPages[p.student_id].add(p.date);
  }

  const ranked = students
    .map(s => ({ ...s, weekPages: weekTotals[s.id] || 0, activeDays: daysWithPages[s.id]?.size || 0 }))
    .sort((a, b) => b.weekPages - a.weekPages);

  const todayPages = pagesData.filter(p => p.date === T);
  const todaySet = new Set(todayPages.map(p => p.student_id));

  el.innerHTML = `
    <div class="card-title">📊 Pages Analytics (Last 7 Days)</div>
    <div style="margin-bottom:12px">
      <div style="font-size:13px;color:var(--gray-400);margin-bottom:6px">📅 Today's Pages</div>
      ${students.map(s => `
        <div class="list-item" style="padding:6px 0">
          <div class="list-item-left"><div style="font-size:14px">${s.name}</div></div>
          <div class="list-item-right">
            ${todaySet.has(s.id)
              ? `<span class="badge badge-green">✓ ${pagesData.find(p => p.student_id === s.id && p.date === T)?.total_pages || 0}p</span>`
              : '<span class="badge badge-gray">—</span>'}
          </div>
        </div>`).join('')}
    </div>
    <div>
      <div style="font-size:13px;color:var(--gray-400);margin-bottom:6px">🏆 Week Leaderboard</div>
      ${ranked.map((s, i) => `
        <div class="list-item" style="padding:6px 0">
          <div class="list-item-left">
            <div style="font-size:14px"><strong>#${i+1}</strong> ${s.name}</div>
            <div style="font-size:12px;color:var(--gray-400)">${s.activeDays} days active</div>
          </div>
          <div class="list-item-right">
            <span style="font-weight:700;color:var(--orange)">${s.weekPages} pages</span>
          </div>
        </div>`).join('')}
    </div>`;
}

// ── Class Settings Modal ──────────────────────────────────────────────────
window.openClassSettings = async () => {
  const modal = document.getElementById('class-settings-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const sel = document.getElementById('track-pages-select');
  if (sel && cls) sel.value = cls.track_pages || 'None';
};

window.closeClassSettings = () => {
  const modal = document.getElementById('class-settings-modal');
  if (modal) modal.style.display = 'none';
};

window.saveClassSettings = async () => {
  const trackPages = document.getElementById('track-pages-select')?.value || 'None';
  const { error } = await supabase.from('classes')
    .update({ track_pages: trackPages })
    .eq('id', classId);
  if (error) { toast('Error saving settings', 'error'); return; }
  cls.track_pages = trackPages;
  renderClassSettingsBadge(cls);
  toast('Settings saved!', 'success');
  closeClassSettings();
  load();
};

// ── Lesson Plans ──────────────────────────────────────────────────────────
async function loadLessonPlans() {
  const el = document.getElementById('lesson-plans-content');
  if (!el) return;
  showSpinner(el);

  const { data, error } = await supabase
    .from('lesson_plans')
    .select('*')
    .eq('class_id', classId)
    .order('date', { ascending: false })
    .limit(20);

  if (error || !data) { el.innerHTML = '<div class="empty-state">Could not load plans</div>'; return; }
  if (!data.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--gray-400);font-size:13px;padding:16px 0">No lesson plans yet. Tap + Plan to add one.</div>';
    return;
  }

  const today = T; // "YYYY-MM-DD"
  el.innerHTML = data.map(p => {
    const isToday = p.date === today;
    const isPast  = p.date < today;
    const dateLabel = isToday ? '📌 Today' : fmtDate(p.date);
    const statusDot = p.completed
      ? '<span style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:50%;margin-left:6px;vertical-align:middle" title="Completed"></span>'
      : '';
    return `<div class="lesson-plan-item${isToday ? ' lp-today' : ''}${isPast && !p.completed ? ' lp-past' : ''}"
      style="border-left:3px solid ${isToday ? 'var(--blue)' : p.completed ? 'var(--green)' : 'var(--gray-200)'};
             padding:10px 12px;margin-bottom:8px;border-radius:0 6px 6px 0;background:${isToday ? 'var(--blue-light,#EFF6FF)' : 'var(--gray-50)'}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div>
          <span style="font-size:12px;font-weight:700;color:${isToday ? 'var(--blue)' : 'var(--gray-500)'}">${dateLabel}</span>${statusDot}
          ${p.title ? `<div style="font-size:14px;font-weight:600;color:var(--gray-800);margin-top:2px">${p.title}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${!p.completed ? `<button onclick="markLessonDone('${p.id}')" style="padding:4px 8px;border:none;border-radius:5px;background:var(--green);color:white;font-size:11px;font-weight:600;cursor:pointer" title="Mark done">✓</button>` : ''}
          <button onclick="editLessonPlan('${p.id}')" style="padding:4px 8px;border:1px solid var(--gray-200);border-radius:5px;background:var(--white);color:var(--gray-600);font-size:11px;cursor:pointer">✏️</button>
          <button onclick="deleteLessonPlan('${p.id}')" style="padding:4px 8px;border:none;border-radius:5px;background:#FEF2F2;color:var(--red);font-size:11px;cursor:pointer">🗑</button>
        </div>
      </div>
      ${p.objectives ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px"><strong>Objectives:</strong> ${p.objectives}</div>` : ''}
      ${p.materials ? `<div style="font-size:12px;color:var(--gray-500);margin-top:2px"><strong>Materials:</strong> ${p.materials}</div>` : ''}
      ${p.notes ? `<div style="font-size:12px;color:var(--gray-400);margin-top:2px;font-style:italic">${p.notes}</div>` : ''}
    </div>`;
  }).join('');
}

window.openLessonPlanModal = (prefill = {}) => {
  const modal = document.getElementById('lesson-plan-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('lp-modal-title').textContent = prefill.id ? '✏️ Edit Lesson Plan' : '📋 New Lesson Plan';
  document.getElementById('lp-edit-id').value = prefill.id || '';
  document.getElementById('lp-date').value = prefill.date || T;
  document.getElementById('lp-title').value = prefill.title || '';
  document.getElementById('lp-objectives').value = prefill.objectives || '';
  document.getElementById('lp-materials').value = prefill.materials || '';
  document.getElementById('lp-notes').value = prefill.notes || '';
  setTimeout(() => document.getElementById('lp-title').focus(), 80);
};

window.closeLessonPlanModal = () => {
  const modal = document.getElementById('lesson-plan-modal');
  if (modal) modal.style.display = 'none';
};

window.saveLessonPlan = async () => {
  const editId  = document.getElementById('lp-edit-id').value;
  const date    = document.getElementById('lp-date').value;
  const title   = document.getElementById('lp-title').value.trim();
  const objectives = document.getElementById('lp-objectives').value.trim() || null;
  const materials  = document.getElementById('lp-materials').value.trim() || null;
  const notes      = document.getElementById('lp-notes').value.trim() || null;

  if (!date) { toast('Please pick a date', 'error'); return; }

  const payload = { class_id: parseInt(classId), date, title: title || null, objectives, materials, notes };

  let error;
  if (editId) {
    ({ error } = await supabase.from('lesson_plans').update(payload).eq('id', editId));
  } else {
    ({ error } = await supabase.from('lesson_plans').insert(payload));
  }

  if (error) { toast('Error saving plan: ' + error.message, 'error'); return; }
  toast(editId ? 'Plan updated ✅' : 'Plan added ✅', 'success');
  closeLessonPlanModal();
  loadLessonPlans();
};

window.editLessonPlan = async (id) => {
  const { data } = await supabase.from('lesson_plans').select('*').eq('id', id).single();
  if (!data) return;
  openLessonPlanModal(data);
};

window.markLessonDone = async (id) => {
  const { error } = await supabase.from('lesson_plans').update({ completed: true }).eq('id', id);
  if (error) { toast('Error', 'error'); return; }
  toast('Marked done ✅', 'success');
  loadLessonPlans();
};

window.deleteLessonPlan = async (id) => {
  const { error } = await supabase.from('lesson_plans').delete().eq('id', id);
  if (error) { toast('Error deleting plan', 'error'); return; }
  toast('Plan deleted', 'success');
  loadLessonPlans();
};

// ── Universal Class Notes (shown on ALL class pages) ──────────────────────
// Stored in `tasks` table with module='LifeOS', notes JSON {is_universal_class_note:true, body:"..."}
const UNIVERSAL_NOTE_FLAG = '"is_universal_class_note":true';

async function loadUniversalClassNotes() {
  const section = document.getElementById('universal-class-notes-section');
  if (!section) return;

  const { data } = await supabase
    .from('tasks')
    .select('id, title, notes, created_at')
    .eq('module', 'LifeOS')
    .eq('status', 'open')
    .like('notes', `%${UNIVERSAL_NOTE_FLAG}%`)
    .order('created_at');

  const notes = (data || []).map(row => {
    let meta = {};
    try { meta = JSON.parse(row.notes || '{}'); } catch {}
    return { id: row.id, body: meta.body || row.title || '', created_at: row.created_at };
  });

  renderUniversalNotes(notes);
}

function renderUniversalNotes(notes) {
  const section = document.getElementById('universal-class-notes-section');
  if (!section) return;

  section.innerHTML = `
    <div class="card" style="margin-bottom:12px;border-top:3px solid #8b5cf6">
      <div class="card-header" style="margin-bottom:${notes.length ? '10px' : '0'}">
        <div class="card-title" style="margin:0;color:#7c3aed">📋 Universal Class Notes</div>
        <button class="btn btn-sm" style="background:#f5f3ff;color:#7c3aed;border:none"
          onclick="addUniversalClassNote()">+ Note</button>
      </div>
      <div style="font-size:11px;color:var(--gray-400);margin:-8px 0 8px">These notes appear at the top of every class page.</div>
      <div id="universal-notes-list">
        ${notes.length === 0
          ? '<div style="font-size:13px;color:var(--gray-400)">No universal notes yet. Add one to pin info across all classes.</div>'
          : notes.map(n => `
            <div id="un-card-${n.id}" style="background:#f5f3ff;border-radius:8px;padding:10px 12px;margin-bottom:8px;border-left:3px solid #8b5cf6">
              <div style="display:flex;align-items:flex-start;gap:8px">
                <div style="flex:1;font-size:13px;color:var(--gray-800);white-space:pre-wrap;line-height:1.5">${escHtml(n.body)}</div>
                <div style="display:flex;gap:4px;flex-shrink:0">
                  <button onclick="editUniversalClassNote('${n.id}', ${JSON.stringify(n.body).replace(/'/g,"&apos;")})"
                    style="padding:4px 7px;border:1px solid var(--gray-200);border-radius:5px;background:var(--white);color:var(--gray-500);font-size:11px;cursor:pointer">✏️</button>
                  <button onclick="deleteUniversalClassNote('${n.id}')"
                    style="padding:4px 7px;border:none;border-radius:5px;background:#FEF2F2;color:var(--red);font-size:11px;cursor:pointer">🗑</button>
                </div>
              </div>
            </div>`).join('')}
      </div>
    </div>`;
}

window.addUniversalClassNote = () => openUniversalNoteModal();
window.editUniversalClassNote = (id, body) => openUniversalNoteModal(id, body);

window.deleteUniversalClassNote = async (id) => {
  if (!confirm('Delete this universal class note?')) return;
  await supabase.from('tasks').delete().eq('id', id);
  toast('Universal note deleted', 'info');
  loadUniversalClassNotes();
};

function openUniversalNoteModal(editId = null, prefillBody = '') {
  document.getElementById('un-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'un-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:500;display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:600px">
      <div style="font-size:17px;font-weight:700;margin-bottom:6px;color:#7c3aed">
        ${editId ? '✏️ Edit Universal Note' : '📋 New Universal Class Note'}
      </div>
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:12px">This note will appear at the top of every class page.</div>
      <textarea id="un-modal-text" rows="5" class="form-input"
        placeholder="e.g. All classes: remind students about the art fair on Friday."
        style="resize:vertical;font-size:14px;line-height:1.5">${escHtml(prefillBody)}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" style="flex:1;background:#7c3aed;border-color:#7c3aed"
          onclick="saveUniversalClassNote(${JSON.stringify(editId)})">
          ${editId ? 'Save Changes' : 'Add Note'}
        </button>
        <button class="btn btn-ghost" onclick="document.getElementById('un-modal').remove()">Cancel</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('un-modal-text')?.focus(), 60);
}

window.saveUniversalClassNote = async (editId) => {
  const body = document.getElementById('un-modal-text')?.value.trim();
  if (!body) { toast('Enter a note', 'error'); return; }

  const now = new Date().toISOString();
  let error;
  if (editId) {
    ({ error } = await supabase.from('tasks').update({
      notes: JSON.stringify({ is_universal_class_note: true, body }),
      completed_at: now,
    }).eq('id', editId));
  } else {
    ({ error } = await supabase.from('tasks').insert({
      title: body.slice(0, 80),
      notes: JSON.stringify({ is_universal_class_note: true, body }),
      module: 'LifeOS',
      priority: 'normal',
      status: 'open',
      completed_at: now,
    }));
  }

  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast(editId ? 'Note updated ✅' : 'Universal note added ✅', 'success');
  document.getElementById('un-modal')?.remove();
  loadUniversalClassNotes();
};

// ── Class Overview Notes ──────────────────────────────────────────────────
async function loadOverviewNotesSection() {
  const section = document.getElementById('class-overview-notes-section');
  if (!section) return;

  const { data: notes } = await supabase
    .from('class_overview_notes')
    .select('*')
    .eq('class_id', classId)
    .order('sort_order')
    .order('created_at');

  renderOverviewNotesSection(notes || []);
}

function renderOverviewNotesSection(notes) {
  const section = document.getElementById('class-overview-notes-section');
  if (!section) return;

  section.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header" style="margin-bottom:${notes.length ? '10px' : '0'}">
        <div class="card-title" style="margin:0">📌 Class Overview Notes</div>
        <button class="btn btn-sm btn-primary" onclick="addOverviewNote()">+ Note</button>
      </div>
      <div id="overview-notes-list">
        ${notes.length === 0
          ? '<div style="font-size:13px;color:var(--gray-400);padding:4px 0">No overview notes yet. Add one to keep info visible across all visits.</div>'
          : notes.map(n => renderOverviewNoteCard(n)).join('')}
      </div>
    </div>`;
}

function renderOverviewNoteCard(n) {
  const preview = n.note.length > 120 && n.collapsed
    ? n.note.slice(0, 120) + '…'
    : n.note;
  return `
    <div class="overview-note-card" id="on-card-${n.id}"
      style="background:var(--gray-50);border-radius:8px;padding:10px 12px;margin-bottom:8px;
             border-left:3px solid var(--blue)">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div id="on-text-${n.id}" style="font-size:13px;color:var(--gray-800);white-space:pre-wrap;line-height:1.5">${escHtml(preview)}</div>
          ${n.note.length > 120 ? `
            <button onclick="toggleOverviewNoteCollapse('${n.id}', ${!n.collapsed})"
              style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;padding:2px 0;margin-top:4px">
              ${n.collapsed ? '▼ Show more' : '▲ Collapse'}
            </button>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button onclick="editOverviewNote('${n.id}')"
            style="padding:4px 7px;border:1px solid var(--gray-200);border-radius:5px;
                   background:var(--white);color:var(--gray-500);font-size:11px;cursor:pointer">✏️</button>
          <button onclick="deleteOverviewNote('${n.id}')"
            style="padding:4px 7px;border:none;border-radius:5px;
                   background:#FEF2F2;color:var(--red);font-size:11px;cursor:pointer">🗑</button>
        </div>
      </div>
    </div>`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.addOverviewNote = () => openOverviewNoteModal();

window.editOverviewNote = async (id) => {
  const { data } = await supabase.from('class_overview_notes').select('*').eq('id', id).single();
  if (data) openOverviewNoteModal(data);
};

window.deleteOverviewNote = async (id) => {
  await supabase.from('class_overview_notes').delete().eq('id', id);
  toast('Note deleted', 'info');
  loadOverviewNotesSection();
};

window.toggleOverviewNoteCollapse = async (id, collapsed) => {
  await supabase.from('class_overview_notes').update({ collapsed }).eq('id', id);
  loadOverviewNotesSection();
};

function openOverviewNoteModal(prefill = {}) {
  // Remove any existing modal
  document.getElementById('on-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'on-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:500;display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--white);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:600px">
      <div style="font-size:17px;font-weight:700;margin-bottom:14px">
        ${prefill.id ? '✏️ Edit Overview Note' : '📌 New Overview Note'}
      </div>
      <textarea id="on-modal-text" rows="5" class="form-input"
        placeholder="e.g. Class is working on chapters 4–6. Friday quiz on vocab. Monroe needs extra support."
        style="resize:vertical;font-size:14px;line-height:1.5">${escHtml(prefill.note || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" style="flex:1" onclick="saveOverviewNote('${prefill.id || ''}')">
          ${prefill.id ? 'Save Changes' : 'Add Note'}
        </button>
        <button class="btn btn-ghost" onclick="document.getElementById('on-modal').remove()">Cancel</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('on-modal-text')?.focus(), 60);
}

window.saveOverviewNote = async (editId) => {
  const note = document.getElementById('on-modal-text')?.value.trim();
  if (!note) { toast('Enter a note', 'error'); return; }

  let error;
  if (editId) {
    ({ error } = await supabase.from('class_overview_notes')
      .update({ note, updated_at: new Date().toISOString() })
      .eq('id', editId));
  } else {
    ({ error } = await supabase.from('class_overview_notes')
      .insert({ class_id: Number(classId), note }));
  }

  if (error) { toast('Error saving note: ' + error.message, 'error'); return; }
  toast(editId ? 'Note updated ✅' : 'Note added ✅', 'success');
  document.getElementById('on-modal')?.remove();
  loadOverviewNotesSection();
};

load();
// No polling — data updates happen manually via user actions
