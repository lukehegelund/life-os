// Life OS — Individual Student Profile (Phase 2)
import { supabase } from './supabase.js';
import { qp, fmtDate, fmtDateFull, daysAgo, goldStr, goldClass, attendanceBadge, toast, showSpinner, showEmpty, today, pstDatePlusDays } from './utils.js';
import { initSwipe } from './swipe-handler.js';

const studentId = qp('id');
if (!studentId) { window.location.href = 'students.html'; }

const T = today(); // PST date
let studentData = null;
let allClasses = [];
let enrolledClasses = []; // only classes this student is currently enrolled in

async function load() {
  const [studentRes, classesRes, enrRes] = await Promise.all([
    supabase.from('students').select('*').eq('id', studentId).single(),
    supabase.from('classes').select('id, name, track_pages'),
    supabase.from('class_enrollments').select('class_id').eq('student_id', studentId).is('enrolled_until', null),
  ]);
  studentData = studentRes.data;
  allClasses = classesRes.data || [];
  // Build enrolled-only class list for note selectors
  const enrolledIds = new Set((enrRes.data || []).map(e => e.class_id));
  enrolledClasses = allClasses.filter(c => enrolledIds.has(c.id));
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
          <div style="color:var(--gray-400);font-size:13px">Grade ${s.grade_level || '—'} · ${s.date_of_birth ? '🎂 ' + fmtDateFull(s.date_of_birth) : ''}</div>
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

  // Populate class selector in add-note form (only enrolled classes)
  const classSelect = document.getElementById('new-note-class');
  if (classSelect) {
    enrolledClasses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      classSelect.appendChild(opt);
    });
    // Pre-select first enrolled class
    if (enrolledClasses.length > 0) classSelect.value = enrolledClasses[0].id;
  }

  await Promise.all([
    loadNotes(s),
    loadGold(s),
    loadAttendance(s),
    loadGrades(s),
    loadClasses(s),
    loadPagesAnalytics(s),
    loadEodReminder(s),
  ]);
}

// ── Add Note ──────────────────────────────────────────────────────────────
window.saveNote = async () => {
  const text = document.getElementById('new-note-text')?.value.trim();
  if (!text) { toast('Enter a note first', 'error'); return; }

  const classId = document.getElementById('new-note-class')?.value || null;
  const showInOverview = document.getElementById('new-note-overview')?.checked ?? false;
  const isTodo = document.getElementById('new-note-todo')?.checked ?? false;
  const tellParent = document.getElementById('new-note-parent')?.checked ?? false;

  const { data: noteData, error } = await supabase.from('student_notes').insert({
    student_id: Number(studentId),
    class_id: classId ? Number(classId) : null,
    date: T,
    note: text,
    category: classId ? 'Class Note' : 'General',
    show_in_overview: showInOverview,
    is_todo: isTodo,
    tell_parent: tellParent,
    logged: false,
  }).select('id').single();

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  // If flagged Tell Parent, create a parent_crm entry
  if (tellParent && noteData?.id) {
    await supabase.from('parent_crm').insert({
      note_id: noteData.id,
      student_id: Number(studentId),
      title: 'Tell Parent',
      notes: text,
      status: 'pending',
    });
  }

  // Reset form
  document.getElementById('new-note-text').value = '';
  document.getElementById('new-note-overview').checked = false;
  document.getElementById('new-note-todo').checked = false;
  document.getElementById('new-note-parent').checked = false;

  toast('Note added ✓', 'success');
  loadNotes(studentData);
};

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
  // Build class options for inline edit — only enrolled classes
  const classOpts = `<option value="">— No class —</option>` +
    enrolledClasses.map(c => `<option value="${c.id}" ${n.class_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('');

  return `
    <div class="note-row-desktop swipe-note-item" data-id="${n.id}" style="flex-direction:column;align-items:stretch;gap:0">
      <!-- Main row -->
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div data-swipe-inner style="flex:1;min-width:0;cursor:pointer" onclick="toggleNoteEdit(${n.id}, event)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="font-size:14px;flex:1">${n.note || '—'}</div>
            <div style="font-size:12px;color:var(--gray-400);white-space:nowrap;margin-left:8px">${fmtDate(n.date)}</div>
          </div>
          <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">
            ${n.show_in_overview ? '<span class="flag-badge flag-overview">Overview</span>' : ''}
            ${n.is_todo ? '<span class="flag-badge flag-todo">To-do</span>' : ''}
            ${n.tell_parent ? '<span class="flag-badge flag-parent">Tell Parent</span>' : ''}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;align-self:center">
          <button onclick="logNote(${n.id}, event)" class="btn btn-sm" style="background:var(--green);color:white;padding:4px 8px;border:none;border-radius:6px;cursor:pointer" title="Log note">✓</button>
          <button onclick="deleteNote(${n.id}, event)" class="btn btn-sm" style="background:var(--red);color:white;padding:4px 8px;border:none;border-radius:6px;cursor:pointer" title="Delete note">✕</button>
        </div>
      </div>
      <!-- Inline edit panel (hidden by default, tap note text to open) -->
      <div id="note-edit-${n.id}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--gray-100)">
        <select id="note-class-${n.id}" class="form-input" style="width:100%;font-size:13px;margin-bottom:8px">
          ${classOpts}
        </select>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:13px">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="note-overview-${n.id}" ${n.show_in_overview ? 'checked' : ''}> Overview
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="note-todo-${n.id}" ${n.is_todo ? 'checked' : ''}> To-do
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="note-parent-${n.id}" ${n.tell_parent ? 'checked' : ''}> Tell Parent
          </label>
        </div>
        <button onclick="saveNoteEdit(${n.id}, event)" class="btn btn-primary btn-sm" style="width:100%">Save</button>
      </div>
    </div>`;
}

window.logNote = async (noteId, e) => {
  e?.stopPropagation();
  await supabase.from('student_notes').update({ logged: true, logged_at: new Date().toISOString() }).eq('id', noteId);
  toast('Note logged ✓', 'success');
  loadNotes(studentData);
};

window.deleteNote = async (noteId, e) => {
  e?.stopPropagation();
  await supabase.from('student_notes').delete().eq('id', noteId);
  toast('Note deleted', 'info');
  loadNotes(studentData);
};

window.toggleNoteEdit = (noteId, e) => {
  e?.stopPropagation();
  const panel = document.getElementById(`note-edit-${noteId}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

window.saveNoteEdit = async (noteId, e) => {
  e?.stopPropagation();
  const classId = document.getElementById(`note-class-${noteId}`)?.value || null;
  const showInOverview = document.getElementById(`note-overview-${noteId}`)?.checked ?? false;
  const isTodo = document.getElementById(`note-todo-${noteId}`)?.checked ?? false;
  const tellParent = document.getElementById(`note-parent-${noteId}`)?.checked ?? false;

  // Fetch current state to detect tell_parent toggle
  const { data: existing } = await supabase.from('student_notes').select('tell_parent, note, student_id').eq('id', noteId).single();

  const { error } = await supabase.from('student_notes').update({
    class_id: classId ? Number(classId) : null,
    show_in_overview: showInOverview,
    is_todo: isTodo,
    tell_parent: tellParent,
  }).eq('id', noteId);

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  // If tell_parent was just turned ON, create parent_crm entry (if one doesn't already exist)
  if (tellParent && !existing?.tell_parent) {
    const { data: alreadyExists } = await supabase.from('parent_crm').select('id').eq('note_id', noteId).maybeSingle();
    if (!alreadyExists) {
      await supabase.from('parent_crm').insert({
        note_id: noteId,
        student_id: existing?.student_id || Number(studentId),
        title: 'Tell Parent',
        notes: existing?.note || '',
        status: 'pending',
      });
    }
  }

  toast('Note updated ✓', 'success');
  loadNotes(studentData);
};

// ── Pages Analytics ───────────────────────────────────────────────────────
async function loadPagesAnalytics(s) {
  const el = document.getElementById('pages-analytics');
  if (!el) return;

  // Fetch 30 days of pages history
  const thirtyAgo = pstDatePlusDays(-30);
  const sevenAgo  = pstDatePlusDays(-7);

  const pagesRes = await supabase.from('student_pages')
    .select('*, classes(name, track_pages)')
    .eq('student_id', studentId)
    .gte('date', thirtyAgo)
    .order('date', { ascending: false });
  const pages = pagesRes.data || [];

  if (!pages.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No pages logged in the last 30 days</div>';
    return;
  }

  // Group by class and compute stats
  const byClass = {};
  for (const p of pages) {
    const key = p.class_id;
    if (!byClass[key]) byClass[key] = { name: p.classes?.name || 'Class', entries: [], total7: 0, total30: 0, lastDate: null };
    byClass[key].entries.push(p);
    byClass[key].total30 += p.pages_delta || 0;
    if (p.date >= sevenAgo) byClass[key].total7 += p.pages_delta || 0;
    if (!byClass[key].lastDate || p.date > byClass[key].lastDate) byClass[key].lastDate = p.date;
  }

  let html = '';
  for (const [cid, group] of Object.entries(byClass)) {
    html += `
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">${group.name}</div>
        <div style="display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:80px;background:var(--gray-50);border-radius:8px;padding:8px 10px;text-align:center">
            <div style="font-size:18px;font-weight:700;color:var(--primary)">${group.total7}</div>
            <div style="font-size:11px;color:var(--gray-400)">pages / 7 days</div>
          </div>
          <div style="flex:1;min-width:80px;background:var(--gray-50);border-radius:8px;padding:8px 10px;text-align:center">
            <div style="font-size:18px;font-weight:700;color:var(--primary)">${group.total30}</div>
            <div style="font-size:11px;color:var(--gray-400)">pages / 30 days</div>
          </div>
          <div style="flex:1;min-width:80px;background:var(--gray-50);border-radius:8px;padding:8px 10px;text-align:center">
            <div style="font-size:13px;font-weight:600;color:var(--gray-600)">${group.lastDate ? daysAgo(group.lastDate) : '—'}</div>
            <div style="font-size:11px;color:var(--gray-400)">last logged</div>
          </div>
        </div>
        ${group.entries.slice(0,5).map(p => `
          <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid var(--gray-100)">
            <span style="color:var(--gray-500)">${fmtDate(p.date)}</span>
            <span style="font-weight:600">${p.total_pages}p ${p.gold_delta !== 0 ? `<span style="color:var(--gold);font-size:12px">(${p.gold_delta > 0 ? '+' : ''}${p.gold_delta}🪙)</span>` : ''}</span>
          </div>`).join('')}
      </div>`;
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

// ── End of Day Reminder ────────────────────────────────────────────────────
async function loadEodReminder(s) {
  const el = document.getElementById('eod-reminder-content');
  if (!el) return;

  const enabled = s.eod_reminder_enabled || false;
  const note = s.eod_reminder_note || '';

  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:${enabled ? '14px' : '0'}">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1">
        <input type="checkbox" id="eod-enabled" ${enabled ? 'checked' : ''}
          onchange="window.saveEodReminder()"
          style="width:18px;height:18px;accent-color:var(--blue);flex-shrink:0">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--gray-800)">Send me a reminder at 2:25pm</div>
          <div style="font-size:12px;color:var(--gray-400)">You'll get a daily ntfy notification on weekdays</div>
        </div>
      </label>
    </div>
    <div id="eod-note-wrap" style="display:${enabled ? 'block' : 'none'}">
      <textarea id="eod-note" rows="2" placeholder="Reminder note (e.g. Check in about homework, mention spelling test tomorrow…)"
        style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:10px 12px;
               font-size:14px;resize:vertical;font-family:inherit;outline:none;box-sizing:border-box;color:var(--gray-800)"
        onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)';window.saveEodReminder()"
        onkeydown="if(event.key==='Enter'&&(event.metaKey||event.ctrlKey))this.blur()"
        >${note}</textarea>
      <div style="font-size:11px;color:var(--gray-400);margin-top:4px">Auto-saves on blur · Cmd+Enter to save</div>
    </div>`;

  // Toggle note visibility when checkbox changes
  document.getElementById('eod-enabled').addEventListener('change', function() {
    document.getElementById('eod-note-wrap').style.display = this.checked ? 'block' : 'none';
  });
}

window.saveEodReminder = async () => {
  const enabled = document.getElementById('eod-enabled')?.checked ?? false;
  const note = document.getElementById('eod-note')?.value?.trim() || '';

  const { error } = await supabase
    .from('students')
    .update({ eod_reminder_enabled: enabled, eod_reminder_note: note || null })
    .eq('id', studentId);

  if (error) { toast('Error saving reminder: ' + error.message, 'error'); return; }
  toast(enabled ? '🔔 Reminder on' : 'Reminder off', 'success');
};

load();
