// Life OS — Individual Parent Profile
import { supabase } from './supabase.js';
import { fmtDate, fmtDateFull, toast, showSpinner, showEmpty, qp } from './utils.js';

// ── State ─────────────────────────────────────────────────────────────────
const parentName = decodeURIComponent(qp('name') || '');
if (!parentName) { window.location.href = 'parents.html'; }

let parentData = null;      // the parsed parent object
let linkedStudents = [];    // full student records for this parent's students
let enrolledClassesMap = {}; // studentId → [class objects]

const T = new Date().toISOString().split('T')[0];

// ── Helpers ───────────────────────────────────────────────────────────────
function parseParentsFromStudent(student) {
  if (!student.parent_names) return [];
  const rawParents = student.parent_names.split(',').map(s => s.trim()).filter(Boolean);
  const results = [];
  for (const raw of rawParents) {
    const namePart = raw.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').trim();
    if (!namePart || namePart.toLowerCase().includes('emergency') || namePart.toLowerCase() === 'n/a') continue;
    const relMatch = raw.match(/[\(\[]\s*([^)\]]+)\s*[\)\]]/);
    const rel = relMatch ? relMatch[1].trim() : '';
    results.push({ name: namePart, rel });
  }
  return results;
}

function findPhoneForParent(name, contactPhone) {
  if (!contactPhone) return '';
  const parts = contactPhone.split('|').map(s => s.trim());
  for (const part of parts) {
    const ci = part.indexOf(':');
    if (ci === -1) continue;
    const pName = part.slice(0, ci).replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').trim();
    if (pName.toLowerCase() === name.toLowerCase()) return part.slice(ci + 1).trim();
  }
  const first = parts[0];
  if (!first) return '';
  const ci = first.indexOf(':');
  return ci !== -1 ? first.slice(ci + 1).trim() : first;
}

function stringToColor(str) {
  const colors = ['#2563EB','#7C3AED','#1A5E3A','#E8563A','#D97706','#059669','#DC2626','#0891B2'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function relLabel(rel) {
  const map = { D: 'Dad', M: 'Mom', GP: 'Grandpa', GM: 'Grandma', GF: 'Grandpa', F: 'Foster' };
  return map[rel] || rel;
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  // Load all students to find this parent's data
  const studRes = await supabase.from('students')
    .select('id, name, parent_names, contact_email, contact_phone, status, grade_level')
    .eq('status', 'Active');
  const allStudents = studRes.data || [];

  // Find all students belonging to this parent
  const myStudentIds = [];
  const myStudents = [];
  let rel = '';
  let email = '';
  let phone = '';
  const allEmails = [];

  for (const s of allStudents) {
    const parents = parseParentsFromStudent(s);
    const match = parents.find(p => p.name.toLowerCase() === parentName.toLowerCase());
    if (match) {
      myStudents.push(s);
      myStudentIds.push(s.id);
      if (!rel && match.rel) rel = match.rel;
      if (!phone) phone = findPhoneForParent(parentName, s.contact_phone);
      if (s.contact_email) {
        s.contact_email.split(',').map(e => e.trim()).filter(e => e && e !== 'N/A' && e.includes('@')).forEach(e => {
          if (!allEmails.includes(e)) allEmails.push(e);
        });
      }
    }
  }

  email = allEmails[0] || '';
  linkedStudents = myStudents;

  parentData = {
    name: parentName,
    relationship: rel,
    primary_email: email,
    all_emails: allEmails,
    phone,
    students: myStudents.map(s => s.name),
    studentIds: myStudentIds,
    avatarColor: stringToColor(parentName),
  };

  // Update page header
  document.title = parentName + ' — Life OS';
  document.getElementById('parent-name').textContent = parentName;
  document.getElementById('parent-subtitle').textContent =
    (rel ? relLabel(rel) + ' · ' : '') + myStudents.map(s => s.name).join(', ');

  // Render header card
  renderHeaderCard();

  // Load enrolled classes for each student (for note class selector)
  if (myStudentIds.length) {
    const enrRes = await supabase.from('class_enrollments')
      .select('student_id, class_id, classes(id, name)')
      .in('student_id', myStudentIds)
      .is('enrolled_until', null);
    for (const e of enrRes.data || []) {
      if (!enrolledClassesMap[e.student_id]) enrolledClassesMap[e.student_id] = [];
      if (e.classes) enrolledClassesMap[e.student_id].push(e.classes);
    }
  }

  // Populate student selector in Add Note form
  const sel = document.getElementById('note-student-sel');
  if (sel && myStudents.length) {
    myStudents.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    if (myStudents.length === 1) {
      sel.value = myStudents[0].id;
      updateClassSelector(myStudents[0].id);
    }
    sel.addEventListener('change', () => updateClassSelector(sel.value));
  }

  await Promise.all([
    loadParentNotes(),
    loadContactLog(),
  ]);
}

function updateClassSelector(studentId) {
  const clsSel = document.getElementById('note-class-sel');
  if (!clsSel) return;
  clsSel.innerHTML = '<option value="">— No class —</option>';
  const classes = enrolledClassesMap[studentId] || [];
  classes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    clsSel.appendChild(opt);
  });
}

// ── Header Card ───────────────────────────────────────────────────────────
function renderHeaderCard() {
  const p = parentData;
  const initials = p.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  const relStr = p.relationship ? relLabel(p.relationship) : '';

  document.getElementById('parent-header-card').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
      <div style="width:52px;height:52px;border-radius:50%;background:${p.avatarColor};color:white;
                  font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        ${initials}
      </div>
      <div>
        <div style="font-size:20px;font-weight:700">${p.name}</div>
        ${relStr ? `<div style="font-size:13px;color:var(--gray-400)">${relStr}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:14px">
      ${p.all_emails.length ? p.all_emails.map(e => `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--gray-400);font-size:16px">✉️</span>
          <a href="mailto:${e}" style="color:var(--blue);text-decoration:none">${e}</a>
        </div>`).join('') : '<div style="color:var(--gray-400);font-size:13px">No email on file</div>'}
      ${p.phone ? `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--gray-400);font-size:16px">📞</span>
          <a href="tel:${p.phone}" style="color:var(--gray-800);text-decoration:none">${p.phone}</a>
        </div>` : ''}
    </div>
    ${p.students.length ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-100)">
        <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">Students</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${linkedStudents.map(s => `
            <a href="student.html?id=${s.id}"
               style="font-size:13px;background:var(--blue-light);color:var(--blue);border-radius:20px;
                      padding:4px 10px;font-weight:600;text-decoration:none;display:inline-block">
              👤 ${s.name}${s.grade_level ? ' · Gr. ' + s.grade_level : ''}
            </a>`).join('')}
        </div>
      </div>` : ''}`;
}

// ── Notes ─────────────────────────────────────────────────────────────────
async function loadParentNotes() {
  const el = document.getElementById('parent-notes-list');
  if (!parentData.studentIds.length) { showEmpty(el, '📝', 'No students linked'); return; }
  showSpinner(el);

  const res = await supabase.from('student_notes')
    .select('*, classes(name), students(name)')
    .in('student_id', parentData.studentIds)
    .order('date', { ascending: false })
    .limit(60);
  const notes = res.data || [];
  const active = notes.filter(n => !n.logged);
  const logged = notes.filter(n => n.logged);

  if (!notes.length) { showEmpty(el, '📝', 'No notes yet'); return; }

  let html = '';

  // Group active notes by student
  const byStudent = {};
  for (const n of active) {
    const sid = n.student_id;
    if (!byStudent[sid]) byStudent[sid] = { name: n.students?.name || '?', notes: [] };
    byStudent[sid].notes.push(n);
  }

  for (const [sid, group] of Object.entries(byStudent)) {
    html += `<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">
        👤 ${group.name}
      </div>
      ${group.notes.map(n => noteRow(n, Number(sid))).join('')}
    </div>`;
  }

  if (logged.length) {
    html += `<div style="margin-top:16px">
      <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">
        📋 Logged (${logged.length})
      </div>
      ${logged.slice(0,10).map(n => `
        <div class="list-item" style="opacity:0.6;padding:8px 0;border-bottom:1px solid var(--gray-100)">
          <div class="list-item-left">
            <div style="font-size:13px;color:var(--gray-600)">${n.note}</div>
            <div style="font-size:12px;color:var(--gray-400)">${n.students?.name || '?'} · ${n.classes?.name || 'General'} · ${fmtDate(n.date)}</div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  el.innerHTML = html;
}

function noteRow(n, studentId) {
  const classes = enrolledClassesMap[studentId] || [];
  const classOpts = `<option value="">— No class —</option>` +
    classes.map(c => `<option value="${c.id}" ${n.class_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('');

  return `
    <div style="padding:10px 0;border-bottom:1px solid var(--gray-100)" id="pnote-${n.id}">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="flex:1;cursor:pointer" onclick="toggleParentNoteEdit(${n.id})">
          <div style="font-size:14px">${n.note || '—'}</div>
          <div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap;align-items:center">
            <span style="font-size:12px;color:var(--gray-400)">${n.classes?.name || 'General'} · ${fmtDate(n.date)}</span>
            ${n.show_in_overview ? '<span class="flag-badge flag-overview">Overview</span>' : ''}
            ${n.is_todo ? '<span class="flag-badge flag-todo">To-do</span>' : ''}
            ${n.tell_parent ? '<span class="flag-badge flag-parent">Tell Parent</span>' : ''}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button onclick="logParentNote(${n.id})" class="btn btn-sm"
            style="background:var(--green);color:white;padding:4px 8px;border:none;border-radius:6px;cursor:pointer" title="Log">✓</button>
          <button onclick="deleteParentNote(${n.id})" class="btn btn-sm"
            style="background:var(--red);color:white;padding:4px 8px;border:none;border-radius:6px;cursor:pointer" title="Delete">✕</button>
        </div>
      </div>
      <!-- Inline edit -->
      <div id="pnote-edit-${n.id}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--gray-100)">
        <textarea id="pnote-text-${n.id}" class="form-input" rows="3"
          style="width:100%;resize:none;margin-bottom:8px;font-size:14px">${n.note || ''}</textarea>
        <select id="pnote-class-${n.id}" class="form-input" style="width:100%;font-size:13px;margin-bottom:8px">
          ${classOpts}
        </select>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:13px">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="pnote-overview-${n.id}" ${n.show_in_overview ? 'checked' : ''}> Overview
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="pnote-todo-${n.id}" ${n.is_todo ? 'checked' : ''}> To-do
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="pnote-parent-${n.id}" ${n.tell_parent ? 'checked' : ''}> Tell Parent
          </label>
        </div>
        <button onclick="saveParentNoteEdit(${n.id}, ${studentId})" class="btn btn-primary btn-sm" style="width:100%">Save</button>
      </div>
    </div>`;
}

window.toggleParentNoteEdit = (id) => {
  const panel = document.getElementById(`pnote-edit-${id}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

window.saveParentNoteEdit = async (noteId, studentId) => {
  const text = document.getElementById(`pnote-text-${noteId}`)?.value.trim();
  const classId = document.getElementById(`pnote-class-${noteId}`)?.value || null;
  const showInOverview = document.getElementById(`pnote-overview-${noteId}`)?.checked ?? false;
  const isTodo = document.getElementById(`pnote-todo-${noteId}`)?.checked ?? false;
  const tellParent = document.getElementById(`pnote-parent-${noteId}`)?.checked ?? false;

  const { data: existing } = await supabase.from('student_notes')
    .select('tell_parent, note').eq('id', noteId).single();

  const updateObj = {
    class_id: classId ? Number(classId) : null,
    show_in_overview: showInOverview,
    is_todo: isTodo,
    tell_parent: tellParent,
  };
  if (text) updateObj.note = text;

  const { error } = await supabase.from('student_notes').update(updateObj).eq('id', noteId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }

  // If tell_parent just toggled ON, create parent_crm entry
  if (tellParent && !existing?.tell_parent) {
    const { data: already } = await supabase.from('parent_crm').select('id').eq('note_id', noteId).maybeSingle();
    if (!already) {
      await supabase.from('parent_crm').insert({
        note_id: noteId,
        student_id: studentId,
        title: 'Tell Parent',
        notes: text || existing?.note || '',
        status: 'pending',
      });
    }
  }

  toast('Note updated ✓', 'success');
  loadParentNotes();
};

window.logParentNote = async (noteId) => {
  await supabase.from('student_notes').update({ logged: true, logged_at: new Date().toISOString() }).eq('id', noteId);
  toast('Logged ✓', 'success');
  loadParentNotes();
};

window.deleteParentNote = async (noteId) => {
  await supabase.from('student_notes').delete().eq('id', noteId);
  toast('Deleted', 'info');
  loadParentNotes();
};

// ── Add Note ──────────────────────────────────────────────────────────────
window.saveParentNote = async () => {
  const studentId = document.getElementById('note-student-sel')?.value;
  const text = document.getElementById('note-text')?.value.trim();
  if (!studentId) { toast('Select a student first', 'error'); return; }
  if (!text) { toast('Enter a note first', 'error'); return; }

  const classId = document.getElementById('note-class-sel')?.value || null;
  const showInOverview = document.getElementById('note-overview')?.checked ?? false;
  const isTodo = document.getElementById('note-todo')?.checked ?? false;
  const tellParent = document.getElementById('note-parent')?.checked ?? false;

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

  if (tellParent && noteData?.id) {
    await supabase.from('parent_crm').insert({
      note_id: noteData.id,
      student_id: Number(studentId),
      title: 'Tell Parent',
      notes: text,
      status: 'pending',
    });
  }

  document.getElementById('note-text').value = '';
  document.getElementById('note-overview').checked = false;
  document.getElementById('note-todo').checked = false;
  document.getElementById('note-parent').checked = false;
  toast('Note added ✓', 'success');
  loadParentNotes();
};

// ── Contact Log ───────────────────────────────────────────────────────────
async function loadContactLog() {
  const el = document.getElementById('contact-log-list');
  showSpinner(el);
  if (!parentData.studentIds.length) { showEmpty(el, '📋', 'No students linked'); return; }

  const res = await supabase.from('parent_contacts')
    .select('*')
    .in('student_id', parentData.studentIds)
    .order('date', { ascending: false })
    .limit(20);
  const logs = res.data || [];

  if (!logs.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px;text-align:center;padding:12px 0">No contact history yet</div>';
    return;
  }

  el.innerHTML = logs.map(log => {
    // Find student name
    const s = linkedStudents.find(s => s.id === log.student_id);
    const sName = s?.name || '';
    return `
      <div class="list-item" style="padding:10px 0;border-bottom:1px solid var(--gray-100);flex-direction:column;align-items:stretch">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:500">${log.summary || '—'}</div>
            ${log.outcome ? `<div style="font-size:13px;color:var(--gray-600);margin-top:2px">→ ${log.outcome}</div>` : ''}
            ${log.next_action ? `<div style="font-size:13px;color:var(--blue);margin-top:2px">📌 ${log.next_action}</div>` : ''}
            <div style="font-size:12px;color:var(--gray-400);margin-top:4px">
              ${fmtDate(log.date)} · ${log.method || '?'} · ${log.initiated_by ? 'by ' + log.initiated_by : ''}${sName ? ' · ' + sName : ''}
            </div>
          </div>
          <button onclick="deleteContact(${log.id})" class="btn btn-sm"
            style="background:var(--gray-100);color:var(--gray-400);padding:4px 8px;border:none;border-radius:6px;cursor:pointer;flex-shrink:0;margin-left:8px" title="Delete">✕</button>
        </div>
      </div>`;
  }).join('');
}

window.toggleAddContact = () => {
  const form = document.getElementById('add-contact-form');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
};

window.saveContact = async () => {
  const summary = document.getElementById('contact-summary')?.value.trim();
  if (!summary) { toast('Add a summary', 'error'); return; }

  // Use first linked student's id (or let user pick — for now default to first)
  const studentId = parentData.studentIds[0];
  if (!studentId) { toast('No student linked', 'error'); return; }

  const method = document.getElementById('contact-method')?.value || 'Email';
  const initiatedBy = document.getElementById('contact-initiated')?.value || 'Luke';
  const outcome = document.getElementById('contact-outcome')?.value.trim() || null;
  const nextAction = document.getElementById('contact-next-action')?.value.trim() || null;

  const { error } = await supabase.from('parent_contacts').insert({
    student_id: studentId,
    date: T,
    method,
    initiated_by: initiatedBy,
    summary,
    outcome,
    next_action: nextAction,
  });

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  document.getElementById('contact-summary').value = '';
  document.getElementById('contact-outcome').value = '';
  document.getElementById('contact-next-action').value = '';
  document.getElementById('add-contact-form').style.display = 'none';
  toast('Contact logged ✓', 'success');
  loadContactLog();
};

window.deleteContact = async (id) => {
  const { error } = await supabase.from('parent_contacts').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Deleted', 'info');
  loadContactLog();
};

init();
