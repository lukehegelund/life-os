// Life OS — Parent CRM (v5)
// Tab 1: Communications (parent_crm notes, add/edit notes per student)
// Tab 2: Parent List (parsed from students table, clickable profiles)

import { supabase } from './supabase.js';
import { fmtDate, toast, showSpinner } from './utils.js';

// ── State ─────────────────────────────────────────────────────────────────
let activeFilter = 'all';
let activeTab = 'comms';
let allStudents = [];
let allClasses = [];
let parsedParents = [];

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  const [studRes, classRes] = await Promise.all([
    supabase.from('students').select('id, name, parent_names, contact_email, contact_phone, status').eq('status', 'Active').order('name'),
    supabase.from('classes').select('id, name').order('name'),
  ]);
  allStudents = studRes.data || [];
  allClasses = classRes.data || [];

  // Populate student selector in Add Note form
  const sel = document.getElementById('crm-note-student');
  if (sel) {
    allStudents.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', onStudentChange);
  }

  // Populate class selector
  const clsSel = document.getElementById('crm-note-class');
  if (clsSel) {
    allClasses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      clsSel.appendChild(opt);
    });
  }

  // Parse parents from student data
  parsedParents = parseParentsFromStudents(allStudents);

  // Update subtitle
  const pending = await getPendingCount();
  const sub = document.getElementById('page-subtitle');
  if (sub) sub.textContent = `${pending} pending · ${parsedParents.length} parents`;

  // Load default tab
  loadComms();
}

// When student changes in Add Note form, filter classes to their enrolled ones
async function onStudentChange() {
  const sid = document.getElementById('crm-note-student')?.value;
  const clsSel = document.getElementById('crm-note-class');
  if (!clsSel) return;
  clsSel.innerHTML = '<option value="">— No class —</option>';
  if (!sid) return;

  const res = await supabase.from('class_enrollments')
    .select('class_id, classes(id, name)')
    .eq('student_id', sid)
    .is('enrolled_until', null);
  const enrolled = res.data || [];
  enrolled.forEach(e => {
    if (e.classes) {
      const opt = document.createElement('option');
      opt.value = e.classes.id;
      opt.textContent = e.classes.name;
      clsSel.appendChild(opt);
    }
  });
}

async function getPendingCount() {
  const res = await supabase.from('parent_crm').select('id').eq('status', 'pending');
  return (res.data || []).length;
}

// ── Tab switching ─────────────────────────────────────────────────────────
window.switchTab = (tab) => {
  activeTab = tab;
  document.getElementById('view-comms').style.display = tab === 'comms' ? 'block' : 'none';
  document.getElementById('view-parents').style.display = tab === 'parents' ? 'block' : 'none';
  document.getElementById('tab-comms').className = 'crm-tab' + (tab === 'comms' ? ' crm-tab-active' : '');
  document.getElementById('tab-parents').className = 'crm-tab' + (tab === 'parents' ? ' crm-tab-active' : '');
  if (tab === 'parents') renderParentList(parsedParents);
  if (tab === 'comms') loadComms();
};

// ── COMMUNICATIONS TAB ────────────────────────────────────────────────────
window.setFilter = (f) => {
  activeFilter = f;
  document.querySelectorAll('.mod-btn').forEach(b => {
    b.classList.remove('btn-primary'); b.classList.add('btn-ghost');
  });
  document.getElementById(`filter-${f}`)?.classList.replace('btn-ghost', 'btn-primary');
  loadComms();
};

async function loadComms() {
  const el = document.getElementById('crm-list');
  showSpinner(el);

  let query = supabase.from('parent_crm')
    .select('*, students(id, name)')
    .order('created_at', { ascending: false });

  if (activeFilter === 'pending') query = query.eq('status', 'pending');
  if (activeFilter === 'communicated') query = query.eq('status', 'communicated');

  const res = await query;
  const items = res.data || [];

  if (!items.length) {
    el.innerHTML = '<div class="card" style="text-align:center;color:var(--gray-400);padding:20px;font-size:14px">📞 No parent communications</div>';
    return;
  }

  // Group by student
  const byStudent = {};
  for (const item of items) {
    const name = item.students?.name || 'Unknown';
    const sid = item.student_id;
    if (!byStudent[sid]) byStudent[sid] = { name, studentId: sid, items: [] };
    byStudent[sid].items.push(item);
  }

  el.innerHTML = Object.values(byStudent).map(group => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header">
        <div>
          <a href="student.html?id=${group.studentId}" style="font-weight:700;font-size:16px;color:inherit;text-decoration:none">${group.name}</a>
        </div>
        <span class="badge badge-gray">${group.items.length}</span>
      </div>
      ${group.items.map(item => crmItemRow(item)).join('')}
    </div>`).join('');
}

function crmItemRow(item) {
  return `
    <div class="list-item" style="border-bottom:1px solid var(--gray-100);padding:10px 0;flex-direction:column;align-items:stretch" id="crm-item-${item.id}">
      <!-- Main row -->
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="flex:1;cursor:pointer" onclick="toggleCrmEdit(${item.id})">
          <div style="font-size:14px;font-weight:500">${item.title}</div>
          ${item.notes && item.notes !== item.title
            ? `<div style="font-size:13px;color:var(--gray-600);margin-top:2px">${item.notes}</div>`
            : ''}
          <div style="font-size:12px;color:var(--gray-400);margin-top:4px">
            ${fmtDate(item.created_at)}
            ${item.communicated_at ? ` · Communicated ${fmtDate(item.communicated_at)}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;align-self:flex-start;margin-top:2px">
          ${item.status === 'pending'
            ? `<button class="btn btn-sm btn-primary" onclick="markCommunicated(${item.id})">✓ Done</button>`
            : `<span class="badge badge-green">Done ✓</span>`}
          <button class="btn btn-sm" style="background:var(--red);color:white;padding:4px 8px;border:none;border-radius:6px;cursor:pointer" onclick="deleteCrmItem(${item.id})">✕</button>
        </div>
      </div>
      <!-- Inline edit panel -->
      <div id="crm-edit-${item.id}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--gray-100)">
        <div style="font-size:12px;font-weight:600;color:var(--gray-400);text-transform:uppercase;margin-bottom:6px">Edit Note</div>
        <textarea id="crm-edit-title-${item.id}" class="form-input" rows="1"
          style="width:100%;resize:none;margin-bottom:6px;font-size:14px;font-weight:600">${item.title}</textarea>
        <textarea id="crm-edit-notes-${item.id}" class="form-input" rows="3"
          style="width:100%;resize:none;margin-bottom:8px;font-size:14px">${item.notes || ''}</textarea>
        <button onclick="saveCrmEdit(${item.id})" class="btn btn-primary btn-sm" style="width:100%">Save</button>
      </div>
    </div>`;
}

// Toggle inline edit
window.toggleCrmEdit = (id) => {
  const panel = document.getElementById(`crm-edit-${id}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

// Save inline edit
window.saveCrmEdit = async (id) => {
  const title = document.getElementById(`crm-edit-title-${id}`)?.value.trim();
  const notes = document.getElementById(`crm-edit-notes-${id}`)?.value.trim();
  if (!title) { toast('Title cannot be empty', 'error'); return; }
  const { error } = await supabase.from('parent_crm').update({ title, notes }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Updated ✓', 'success');
  loadComms();
};

// Mark as communicated
window.markCommunicated = async (id) => {
  const { error } = await supabase.from('parent_crm').update({
    status: 'communicated',
    communicated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Marked as communicated ✓', 'success');
  loadComms();
};

// Delete CRM item
window.deleteCrmItem = async (id) => {
  const { error } = await supabase.from('parent_crm').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Deleted', 'info');
  loadComms();
};

// ── Add Note from CRM page ─────────────────────────────────────────────────
window.saveCrmNote = async () => {
  const studentId = document.getElementById('crm-note-student')?.value;
  const text = document.getElementById('crm-note-text')?.value.trim();
  if (!studentId) { toast('Select a student first', 'error'); return; }
  if (!text) { toast('Enter a note first', 'error'); return; }

  const classId = document.getElementById('crm-note-class')?.value || null;
  const showInOverview = document.getElementById('crm-note-overview')?.checked ?? false;
  const isTodo = document.getElementById('crm-note-todo')?.checked ?? false;
  const tellParent = document.getElementById('crm-note-parent')?.checked ?? false;

  const T = new Date().toISOString().split('T')[0];

  // Insert into student_notes
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

  // If Tell Parent, create parent_crm entry
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
  document.getElementById('crm-note-text').value = '';
  document.getElementById('crm-note-overview').checked = false;
  document.getElementById('crm-note-todo').checked = false;
  document.getElementById('crm-note-parent').checked = true;
  toast('Note added ✓', 'success');
  loadComms();
};

// ── PARENT LIST TAB ───────────────────────────────────────────────────────

/**
 * Parse structured parent objects from the students table.
 * Groups students by shared parent name (case-insensitive exact match on first name+last).
 */
function parseParentsFromStudents(students) {
  const parentMap = {}; // key: "Firstname Lastname" normalized

  for (const student of students) {
    if (!student.parent_names) continue;

    // Parse individual parent names from the parent_names field
    // Format examples:
    //   "Michelle Becker, Bradley Becker"
    //   "Adam Tebow(D), Madison Tebow(M), Stan Tebow(GP)"
    //   "Kaelyn Hetzler (M), Tim Camarata (D)"
    const rawParents = student.parent_names.split(',').map(s => s.trim()).filter(Boolean);

    for (const raw of rawParents) {
      // Strip relationship label in parens: "Adam Tebow(D)" → "Adam Tebow"
      const namePart = raw.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').trim();
      if (!namePart || namePart.toLowerCase().includes('emergency') || namePart.toLowerCase() === 'n/a') continue;

      // Extract relationship label
      const relMatch = raw.match(/[\(\[]\s*([^)\]]+)\s*[\)\]]/);
      const rel = relMatch ? relMatch[1].trim() : '';

      const key = namePart.toLowerCase();
      if (!parentMap[key]) {
        // Try to find phone for this parent
        const phone = findPhoneForParent(namePart, student.contact_phone);
        // Parse email — use first email for now
        const emails = student.contact_email
          ? student.contact_email.split(',').map(e => e.trim()).filter(e => e && e !== 'N/A' && e.includes('@'))
          : [];
        const email = emails[0] || '';

        parentMap[key] = {
          name: namePart,
          relationship: rel,
          primary_email: email,
          all_emails: emails,
          phone: phone,
          students: [],
          studentIds: [],
          avatarColor: stringToColor(namePart),
        };
      }

      // Add this student to the parent
      if (!parentMap[key].studentIds.includes(student.id)) {
        parentMap[key].students.push(student.name);
        parentMap[key].studentIds.push(student.id);
        // If parent has no email yet, try this student's email
        if (!parentMap[key].primary_email && student.contact_email) {
          const emails = student.contact_email.split(',').map(e => e.trim()).filter(e => e && e !== 'N/A' && e.includes('@'));
          if (emails[0]) {
            parentMap[key].primary_email = emails[0];
            parentMap[key].all_emails = emails;
          }
        }
        // Update relationship if we have one
        if (rel && !parentMap[key].relationship) {
          parentMap[key].relationship = rel;
        }
      }
    }
  }

  return Object.values(parentMap).sort((a, b) => a.name.localeCompare(b.name));
}

function findPhoneForParent(parentName, contactPhone) {
  if (!contactPhone) return '';
  // Contact phone format: "Name: number | Name2: number2"
  const parts = contactPhone.split('|').map(s => s.trim());
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const pName = part.slice(0, colonIdx).replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').trim();
    if (pName.toLowerCase() === parentName.toLowerCase()) {
      return part.slice(colonIdx + 1).trim();
    }
  }
  // Fallback: return first phone
  const firstPart = parts[0];
  if (!firstPart) return '';
  const ci = firstPart.indexOf(':');
  return ci !== -1 ? firstPart.slice(ci + 1).trim() : firstPart;
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

// Render parent list
function renderParentList(parents) {
  const el = document.getElementById('parent-list');
  if (!el) return;
  if (!parents.length) {
    el.innerHTML = '<div class="card" style="text-align:center;color:var(--gray-400);padding:20px;font-size:14px">No parents found</div>';
    return;
  }

  el.innerHTML = parents.map(p => {
    const initials = p.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const relStr = p.relationship ? ` · ${relLabel(p.relationship)}` : '';
    const emailStr = p.primary_email || 'No email';
    const studentStr = p.students.join(', ');
    const encodedId = encodeURIComponent(p.name);
    return `
      <a href="parent.html?name=${encodedId}" class="parent-card" style="text-decoration:none">
        <div class="parent-avatar" style="background:${p.avatarColor}">${initials}</div>
        <div class="parent-info">
          <div class="parent-name">${p.name}${relStr ? `<span style="font-size:12px;font-weight:400;color:var(--gray-400);margin-left:6px">${relStr.slice(3)}</span>` : ''}</div>
          <div class="parent-meta">${emailStr}${p.phone ? ` · ${p.phone}` : ''}</div>
          <span class="parent-students-chip">👤 ${studentStr}</span>
        </div>
        <div style="color:var(--gray-400);font-size:18px">›</div>
      </a>`;
  }).join('');
}

// Filter parent list
window.filterParents = (query) => {
  const q = query.toLowerCase();
  const filtered = q
    ? parsedParents.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.students.some(s => s.toLowerCase().includes(q)) ||
        (p.primary_email || '').toLowerCase().includes(q)
      )
    : parsedParents;
  renderParentList(filtered);
};

// ── Store parsed parents in window for parent.html to access via postMessage ──
window._parsedParents = () => parsedParents;
window._allStudents = () => allStudents;

init();
