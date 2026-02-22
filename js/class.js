// Life OS — Class Dashboard
import { supabase } from './supabase.js';
import { qp, today, fmtDate, goldStr, goldClass, catBadge, toast, showSpinner, showEmpty } from './utils.js';
import { startPolling } from './polling.js';

const classId = qp('id');
if (!classId) { window.location.href = 'classes.html'; }

const T = today();

async function load() {
  const res = await supabase.from('classes').select('*').eq('id', classId).single();
  const cls = res.data;
  if (!cls) return;

  document.title = cls.name + ' — Life OS';
  document.getElementById('class-name').textContent = cls.name;
  document.getElementById('class-subtitle').textContent =
    [cls.subject, cls.day_of_week, cls.room ? 'Room ' + cls.room : null]
      .filter(Boolean).join(' · ');
  if (cls.current_unit) document.getElementById('class-unit').textContent = '📖 ' + cls.current_unit;

  await Promise.all([
    loadRoster(cls),
    loadGoldBulk(cls),
    loadRecentNotes(cls),
    loadAttendanceGrid(cls),
  ]);
}

// ── Roster + tap-to-cycle attendance ─────────────────────────────────────────
const ATT_CYCLE = ['Present', 'Late', 'Absent', 'Excused'];
const attMap = {};  // student_id → current status string

async function loadRoster(cls) {
  const el = document.getElementById('roster');
  showSpinner(el);

  const [enrRes, attRes] = await Promise.all([
    supabase.from('class_enrollments')
      .select('*, students(id, name, current_gold)')
      .eq('class_id', classId)
      .is('enrolled_until', null),
    supabase.from('attendance')
      .select('*')
      .eq('class_id', classId)
      .eq('date', T),
  ]);

  const enrollments = enrRes.data || [];
  if (!enrollments.length) { showEmpty(el, '👥', 'No students enrolled'); return; }

  // Seed the attMap
  for (const a of (attRes.data || [])) {
    attMap[a.student_id] = a.status;
  }

  renderRoster(enrollments);
}

function renderRoster(enrollments) {
  const el = document.getElementById('roster');
  el.innerHTML = enrollments.map(e => {
    const s = e.students;
    const status = attMap[s.id] || null;
    return `
      <div class="list-item">
        <div class="list-item-left">
          <a href="student.html?id=${s.id}" style="text-decoration:none">
            <div class="list-item-name">${s.name}</div>
          </a>
          <div class="list-item-sub">${s.current_gold ?? 0} 🪙</div>
        </div>
        <div class="list-item-right">
          <button class="att-btn ${attBtnClass(status)}"
            onclick="cycleAtt(${s.id}, '${status || ''}')"
            id="att-btn-${s.id}">
            ${status || 'Mark'}
          </button>
        </div>
      </div>`;
  }).join('');
}

function attBtnClass(status) {
  if (status === 'Present') return 'att-present';
  if (status === 'Absent')  return 'att-absent';
  if (status === 'Late')    return 'att-late';
  if (status === 'Excused') return 'att-excused';
  return 'att-none';
}

window.cycleAtt = async (studentId, current) => {
  const idx = ATT_CYCLE.indexOf(current);
  const next = idx === -1 ? ATT_CYCLE[0] : ATT_CYCLE[(idx + 1) % ATT_CYCLE.length];

  // Optimistic UI update
  attMap[studentId] = next;
  const btn = document.getElementById(`att-btn-${studentId}`);
  if (btn) {
    btn.textContent = next;
    btn.className = `att-btn ${attBtnClass(next)}`;
    btn.setAttribute('onclick', `cycleAtt(${studentId}, '${next}')`);
  }

  const { error } = await supabase.from('attendance').upsert({
    student_id: studentId, class_id: classId, date: T, status: next
  }, { onConflict: 'student_id,class_id,date' });

  if (error) {
    toast('Error saving attendance', 'error');
    attMap[studentId] = current;
    if (btn) {
      btn.textContent = current || 'Mark';
      btn.className = `att-btn ${attBtnClass(current || null)}`;
      btn.setAttribute('onclick', `cycleAtt(${studentId}, '${current}')`);
    }
  }
};

// ── Bulk Gold ─────────────────────────────────────────────────────────────────
// State: which student IDs are checked, plus the amount + reason
const goldChecked = new Set();

async function loadGoldBulk(cls) {
  const el = document.getElementById('gold-adder');
  const res = await supabase.from('class_enrollments')
    .select('student_id, students(id, name, current_gold)')
    .eq('class_id', classId)
    .is('enrolled_until', null);
  const enrollments = res.data || [];
  renderGoldBulk(enrollments);
}

function renderGoldBulk(enrollments) {
  const el = document.getElementById('gold-adder');
  el.innerHTML = `
    <!-- Amount + Reason inputs -->
    <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
      <input type="number" id="gold-amount" class="form-input" placeholder="Amount" min="1" max="999" style="width:90px;text-align:center">
      <input type="text" id="gold-reason" class="form-input" placeholder="Reason" style="flex:1">
    </div>

    <!-- Quick-select buttons -->
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-sm btn-ghost" onclick="selectAll()">Select All</button>
      <button class="btn btn-sm btn-ghost" onclick="selectNone()">Clear</button>
      <button class="btn btn-sm" style="background:var(--orange-light);color:var(--orange);border:none" onclick="setAmount(5)">+5</button>
      <button class="btn btn-sm" style="background:var(--orange-light);color:var(--orange);border:none" onclick="setAmount(10)">+10</button>
      <button class="btn btn-sm" style="background:var(--orange-light);color:var(--orange);border:none" onclick="setAmount(25)">+25</button>
      <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none" onclick="setAmount(-5)">−5</button>
      <button class="btn btn-sm" style="background:var(--coral-light);color:var(--red);border:none" onclick="setAmount(-10)">−10</button>
    </div>

    <!-- Student list with checkboxes -->
    ${enrollments.map(e => {
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

    <!-- Submit button -->
    <div style="margin-top:14px">
      <button class="btn btn-gold btn-full" onclick="submitBulkGold()">🪙 Submit Gold</button>
    </div>`;
}

window.toggleGoldCheck = (id, checked) => {
  if (checked) goldChecked.add(id);
  else goldChecked.delete(id);
};

window.selectAll = () => {
  document.querySelectorAll('.gold-bulk-check').forEach(cb => {
    cb.checked = true;
    goldChecked.add(Number(cb.id.replace('gc-', '')));
  });
};

window.selectNone = () => {
  document.querySelectorAll('.gold-bulk-check').forEach(cb => {
    cb.checked = false;
  });
  goldChecked.clear();
};

window.setAmount = (val) => {
  const inp = document.getElementById('gold-amount');
  if (inp) inp.value = val;
};

window.submitBulkGold = async () => {
  const amountRaw = parseInt(document.getElementById('gold-amount').value, 10);
  const reason = document.getElementById('gold-reason').value.trim() || 'Class gold';
  if (!amountRaw || amountRaw === 0) { toast('Enter an amount first', 'info'); return; }
  if (!goldChecked.size) { toast('Select at least one student', 'info'); return; }

  const inserts = [];
  for (const sid of goldChecked) {
    inserts.push({
      student_id: sid,
      class_id: Number(classId),
      date: T,
      amount: amountRaw,
      reason,
      category: amountRaw > 0 ? 'Participation' : 'Behavior',
      distributed: false,
    });
  }

  const { error } = await supabase.from('gold_transactions').insert(inserts);
  if (error) { toast('Error: ' + error.message, 'error'); return; }

  // Update student balances (manual fallback — increment_gold RPC may not exist)
  for (const sid of goldChecked) {
    const r = await supabase.from('students').select('current_gold').eq('id', sid).single();
    const cur = r.data?.current_gold ?? 0;
    await supabase.from('students').update({ current_gold: cur + amountRaw }).eq('id', sid);
  }

  toast(`Gold submitted for ${goldChecked.size} student${goldChecked.size > 1 ? 's' : ''}!`, 'success');
  goldChecked.clear();

  // Refresh gold balances display
  loadGoldBulk();
};

// ── Recent Notes ──────────────────────────────────────────────────────────────
async function loadRecentNotes(cls) {
  const el = document.getElementById('recent-notes');
  const res = await supabase.from('student_notes')
    .select('*, students(name)')
    .eq('class_id', classId)
    .order('date', { ascending: false })
    .limit(20);
  const notes = res.data || [];
  if (!notes.length) { showEmpty(el, '📝', 'No notes for this class'); return; }

  el.innerHTML = notes.map(n => `
    <div class="list-item">
      <div class="list-item-left">
        <div style="display:flex;align-items:center;gap:6px">
          <strong style="font-size:14px">${n.students?.name || '—'}</strong>
          ${catBadge(n.category)}
          ${n.followup_needed ? '<span style="font-size:13px">📌</span>' : ''}
        </div>
        <div class="list-item-sub">${fmtDate(n.date)}</div>
        <div style="font-size:14px;margin-top:2px;color:var(--gray-800)">${n.note || '—'}</div>
      </div>
    </div>`).join('');
}

// ── Attendance Grid ────────────────────────────────────────────────────────────
async function loadAttendanceGrid(cls) {
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
  for (let i = 13; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0]);
  }

  const colors = {
    Present: 'var(--green)', Absent: 'var(--red)',
    Late: 'var(--orange)', Excused: 'var(--gray-400)'
  };

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;font-size:12px;min-width:100%">
        <tr>
          <th style="text-align:left;padding:4px 8px;color:var(--gray-400)">Student</th>
          ${days.slice(-10).map(d => `<th style="padding:4px;color:var(--gray-400)">${d.slice(5)}</th>`).join('')}
        </tr>
        ${students.map(s => `
          <tr>
            <td style="padding:4px 8px;font-weight:600;white-space:nowrap">
              <a href="student.html?id=${s.id}" style="color:inherit;text-decoration:none">${s.name}</a>
            </td>
            ${days.slice(-10).map(d => {
              const st = histMap[s.id]?.[d];
              return `<td style="padding:4px;text-align:center">
                <div title="${st || '—'}" style="width:12px;height:12px;border-radius:50%;margin:auto;background:${st ? colors[st] : 'var(--gray-200)'}"></div>
              </td>`;
            }).join('')}
          </tr>`).join('')}
      </table>
    </div>`;
}

load();
startPolling(load, 10000);
