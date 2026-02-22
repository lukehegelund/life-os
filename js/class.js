// Life OS — Class Dashboard (Phase 2)
import { supabase } from './supabase.js';
import { qp, today, fmtDate, fmtTime, goldStr, goldClass, toast, showSpinner, showEmpty } from './utils.js';
import { startPolling } from './polling.js';
import { initSwipe } from './swipe-handler.js';

const classId = qp('id');
if (!classId) { window.location.href = 'classes.html'; }

const T = today();
let cls = null;

// ── Expand/collapse state for roster dropdowns
const expandedStudents = new Set();

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

  // Settings gear icon — show/hide page tracking badge
  renderClassSettingsBadge(cls);

  await Promise.all([
    loadRoster(cls),
    loadGoldBulk(),
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
const attMap = {};  // student_id → current status string
let enrollments = [];  // cached for re-renders

async function loadRoster(cls) {
  const el = document.getElementById('roster');
  showSpinner(el);

  const [enrRes, attRes, pagesRes] = await Promise.all([
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
  ]);

  enrollments = enrRes.data || [];
  if (!enrollments.length) { showEmpty(el, '👥', 'No students enrolled'); return; }

  // Seed attMap
  for (const a of (attRes.data || [])) {
    attMap[a.student_id] = a.status;
  }

  // Pages map
  const pagesMap = {};
  for (const p of (pagesRes.data || [])) {
    pagesMap[p.student_id] = p.total_pages;
  }

  renderRoster(enrollments, pagesMap);
}

function renderRoster(enrs, pagesMap = {}) {
  const el = document.getElementById('roster');
  const trackPages = cls?.track_pages !== 'None';

  el.innerHTML = enrs.map(e => {
    const s = e.students;
    const status = attMap[s.id] || null;
    const isExpanded = expandedStudents.has(s.id);
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

    return `
      <div class="roster-row" id="roster-row-${s.id}">
        <div class="roster-main">
          <button class="roster-expand-btn" onclick="toggleExpand(${s.id})" title="Show details">
            ${isExpanded ? '▼' : '▶'}
          </button>
          <a href="student.html?id=${s.id}" class="roster-name" style="text-decoration:none;color:inherit;font-weight:600">
            ${s.name}
          </a>
          <span class="roster-gold">${s.current_gold ?? 0}🪙</span>
          ${trackPages && pages !== null ? `<span class="roster-pages">${pages}p</span>` : ''}
          <div class="att-pills">${attButtons}</div>
        </div>
        ${isExpanded ? renderExpandedStudent(s, pages) : ''}
      </div>`;
  }).join('');
}

function renderExpandedStudent(s, pages) {
  const trackPages = cls?.track_pages !== 'None';
  const trackType = cls?.track_pages; // 'English', 'Math', or 'None'

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
        </div>` : ''}
      <div id="overview-notes-${s.id}" class="overview-notes">
        <div style="color:var(--gray-400);font-size:13px">Loading notes…</div>
      </div>
      <div class="quick-note-form">
        <input type="text" id="quick-note-input-${s.id}" class="form-input" placeholder="Quick note for ${s.name}…" style="font-size:13px">
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <label class="flag-toggle"><input type="checkbox" id="qn-overview-${s.id}"> 👁 Overview</label>
          <label class="flag-toggle"><input type="checkbox" id="qn-todo-${s.id}"> ✅ To-do</label>
          <label class="flag-toggle"><input type="checkbox" id="qn-parent-${s.id}"> 📞 Tell Parent</label>
          <button class="btn btn-sm btn-primary" onclick="submitQuickNote(${s.id})">Add Note</button>
        </div>
      </div>
    </div>`;
}

window.toggleExpand = async (studentId) => {
  if (expandedStudents.has(studentId)) {
    expandedStudents.delete(studentId);
  } else {
    expandedStudents.add(studentId);
  }
  // Re-render roster preserving pages
  const pagesMap = {};
  document.querySelectorAll('[id^="pages-display-"]').forEach(el => {
    const sid = el.id.replace('pages-display-', '');
    pagesMap[sid] = parseInt(el.textContent, 10) || 0;
  });
  renderRoster(enrollments, pagesMap);
  // Load overview notes for expanded
  if (expandedStudents.has(studentId)) {
    loadOverviewNotes(studentId);
  }
};

async function loadOverviewNotes(studentId) {
  const el = document.getElementById(`overview-notes-${studentId}`);
  if (!el) return;

  const res = await supabase.from('student_notes')
    .select('id, note, is_todo, tell_parent, logged, date, class_id')
    .eq('student_id', studentId)
    .eq('class_id', classId)
    .eq('show_in_overview', true)
    .eq('logged', false)
    .order('date', { ascending: false })
    .limit(5);

  const notes = res.data || [];
  if (!notes.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:4px 0">No overview notes for this class.</div>';
    return;
  }

  el.innerHTML = notes.map(n => `
    <div class="overview-note-row swipe-item" data-id="${n.id}">
      <div data-swipe-inner class="overview-note-inner">
        <div style="font-size:13px">${n.note}</div>
        <div style="display:flex;gap:6px;margin-top:4px">
          ${n.is_todo ? '<span class="flag-badge flag-todo">✅ To-do</span>' : ''}
          ${n.tell_parent ? '<span class="flag-badge flag-parent">📞 Parent</span>' : ''}
        </div>
      </div>
    </div>`).join('');

  // Apply swipe gestures
  el.querySelectorAll('.swipe-item').forEach(item => {
    const noteId = item.dataset.id;
    initSwipe(item,
      // LEFT = delete
      async () => {
        await supabase.from('student_notes').delete().eq('id', noteId);
        toast('Note deleted', 'info');
        loadOverviewNotes(studentId);
      },
      // RIGHT = log it
      async () => {
        await supabase.from('student_notes').update({
          logged: true,
          logged_at: new Date().toISOString()
        }).eq('id', noteId);
        toast('Note logged ✓', 'success');
        loadOverviewNotes(studentId);
      }
    );
  });
}

window.submitQuickNote = async (studentId) => {
  const input = document.getElementById(`quick-note-input-${studentId}`);
  const note = input?.value?.trim();
  if (!note) { toast('Enter a note first', 'info'); return; }

  const showInOverview = document.getElementById(`qn-overview-${studentId}`)?.checked || false;
  const isTodo = document.getElementById(`qn-todo-${studentId}`)?.checked || false;
  const tellParent = document.getElementById(`qn-parent-${studentId}`)?.checked || false;

  const { error } = await supabase.from('student_notes').insert({
    student_id: studentId,
    class_id: Number(classId),
    date: T,
    note,
    show_in_overview: showInOverview,
    is_todo: isTodo,
    tell_parent: tellParent,
    logged: false,
  });

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  // If tell_parent, add to parent_crm
  if (tellParent) {
    await supabase.from('parent_crm').insert({
      student_id: studentId,
      title: note.slice(0, 100),
      notes: note,
      status: 'pending',
    });
  }

  toast('Note added!', 'success');
  if (input) input.value = '';
  loadOverviewNotes(studentId);
};

// ── Attendance: side-by-side buttons ─────────────────────────────────────
window.setAtt = async (studentId, status) => {
  const prev = attMap[studentId];
  attMap[studentId] = status;

  // Refresh just this student's buttons
  const row = document.getElementById(`roster-row-${studentId}`);
  if (row) {
    const colors = { Present: 'var(--green)', Late: 'var(--orange)', Absent: 'var(--red)', Excused: 'var(--gray-400)' };
    row.querySelectorAll('.att-pill').forEach(btn => {
      const opt = { P: 'Present', L: 'Late', A: 'Absent', E: 'Excused' }[btn.textContent] || btn.textContent;
      const opts = ['Present','Late','Absent','Excused'];
      const idx = opts.findIndex(o => o[0] === btn.textContent);
      const optName = opts[idx];
      const sel = optName === status;
      btn.className = `att-pill ${sel ? 'att-pill-selected' : ''}`;
      btn.style.background = sel ? colors[optName] : '';
      btn.style.color = sel ? '#fff' : '';
    });
  }

  const { error } = await supabase.from('attendance').upsert({
    student_id: studentId, class_id: Number(classId), date: T, status
  }, { onConflict: 'student_id,class_id,date' });

  if (error) {
    toast('Error saving attendance', 'error');
    attMap[studentId] = prev;
  }
};

// ── Pages tracking ────────────────────────────────────────────────────────
window.adjustPages = async (studentId, delta) => {
  const displayEl = document.getElementById(`pages-display-${studentId}`);
  const currentPages = parseInt(displayEl?.textContent || '0', 10);
  const newPages = Math.max(0, currentPages + delta);
  const goldDelta = delta * 2; // ±2 gold per page

  // Optimistic UI
  if (displayEl) displayEl.textContent = newPages;

  // Get student current gold
  const studentEnr = enrollments.find(e => e.students?.id === studentId);
  const studentData = studentEnr?.students;
  const currentGold = studentData?.current_gold ?? 0;
  const newGold = currentGold + goldDelta;

  // Update gold display in roster
  const goldEls = document.querySelectorAll(`[id="roster-row-${studentId}"] .roster-gold`);
  goldEls.forEach(el => el.textContent = newGold + '🪙');

  // Upsert to student_pages (same day)
  const { error: pagesErr } = await supabase.from('student_pages').upsert({
    student_id: studentId,
    class_id: Number(classId),
    date: T,
    pages_delta: delta,
    total_pages: newPages,
    gold_delta: goldDelta,
  }, { onConflict: 'student_id,class_id,date' });

  if (pagesErr) { toast('Pages error: ' + pagesErr.message, 'error'); return; }

  // Update student gold
  await supabase.from('students').update({ current_gold: newGold }).eq('id', studentId);

  // Gold transaction
  await supabase.from('gold_transactions').insert({
    student_id: studentId,
    class_id: Number(classId),
    date: T,
    amount: goldDelta,
    reason: `Pages: ${delta > 0 ? '+' : ''}${delta} page${Math.abs(delta) !== 1 ? 's' : ''}`,
    category: 'Participation',
    distributed: false,
  });
};

// ── Bulk Gold (polling-safe: don't re-render if inputs have values) ────────
const goldChecked = new Set();
let goldBulkRendered = false;

async function loadGoldBulk() {
  // If user is actively typing, skip re-render
  const amountVal = document.getElementById('gold-amount')?.value;
  const reasonVal = document.getElementById('gold-reason')?.value;
  if (goldBulkRendered && (amountVal || reasonVal)) return;

  const res = await supabase.from('class_enrollments')
    .select('student_id, students(id, name, current_gold)')
    .eq('class_id', classId)
    .is('enrolled_until', null);
  const enrs = res.data || [];
  renderGoldBulk(enrs);
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
  goldBulkRendered = false;
  loadGoldBulk();
};

// ── Recent Notes (class-level, with flags + swipe) ────────────────────────
async function loadRecentNotes() {
  const el = document.getElementById('recent-notes');
  const res = await supabase.from('student_notes')
    .select('*, students(name)')
    .eq('class_id', classId)
    .eq('logged', false)
    .order('date', { ascending: false })
    .limit(20);
  const notes = res.data || [];
  if (!notes.length) { showEmpty(el, '📝', 'No active notes for this class'); return; }

  el.innerHTML = notes.map(n => `
    <div class="swipe-item list-item" data-id="${n.id}" style="padding:10px 12px;position:relative;overflow:hidden;touch-action:pan-y">
      <div data-swipe-inner style="display:flex;width:100%;gap:8px;align-items:flex-start">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <strong style="font-size:14px">${n.students?.name || '—'}</strong>
            ${n.show_in_overview ? '<span class="flag-badge flag-overview">👁</span>' : ''}
            ${n.is_todo ? '<span class="flag-badge flag-todo">✅</span>' : ''}
            ${n.tell_parent ? '<span class="flag-badge flag-parent">📞</span>' : ''}
          </div>
          <div class="list-item-sub">${fmtDate(n.date)}</div>
          <div style="font-size:14px;margin-top:2px;color:var(--gray-800)">${n.note || '—'}</div>
        </div>
      </div>
    </div>`).join('');

  // Swipe gestures on notes
  el.querySelectorAll('.swipe-item').forEach(item => {
    const noteId = item.dataset.id;
    initSwipe(item,
      // LEFT = delete (with 3s undo)
      async () => {
        let undone = false;
        const t = toast('Note deleted — tap to undo', 'info');
        const toastEl = document.querySelector('.life-os-toast');
        if (toastEl) {
          toastEl.style.cursor = 'pointer';
          toastEl.onclick = () => { undone = true; loadRecentNotes(); };
        }
        setTimeout(async () => {
          if (!undone) {
            await supabase.from('student_notes').delete().eq('id', noteId);
            loadRecentNotes();
          }
        }, 3000);
      },
      // RIGHT = log it
      async () => {
        await supabase.from('student_notes').update({
          logged: true,
          logged_at: new Date().toISOString()
        }).eq('id', noteId);
        toast('Note logged ✓', 'success');
        loadRecentNotes();
      }
    );
  });
}

// ── Attendance Grid ────────────────────────────────────────────────────────
async function loadAttendanceGrid() {
  const el = document.getElementById('att-grid');
  const start = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

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
    days.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0]);
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

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const [pagesRes, enrRes] = await Promise.all([
    supabase.from('student_pages')
      .select('student_id, total_pages, date')
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

  // Pages by student (sum this week)
  const weekTotals = {};
  const daysWithPages = {};
  for (const p of pagesData) {
    weekTotals[p.student_id] = (weekTotals[p.student_id] || 0) + (p.pages_delta || 0);
    if (!daysWithPages[p.student_id]) daysWithPages[p.student_id] = new Set();
    daysWithPages[p.student_id].add(p.date);
  }

  // Leaderboard
  const ranked = students
    .map(s => ({ ...s, weekPages: weekTotals[s.id] || 0, activeDays: daysWithPages[s.id]?.size || 0 }))
    .sort((a, b) => b.weekPages - a.weekPages);

  // Who did pages today
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
  // Set current track_pages value
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
  load(); // Reload to show/hide pages features
};

load();
startPolling(load, 10000);
