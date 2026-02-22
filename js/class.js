// Life OS — Class Dashboard
import { supabase } from './supabase.js';
import { qp, today, fmtDate, goldStr, goldClass, attendanceBadge, toast, showSpinner, showEmpty } from './utils.js';
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
  document.getElementById('class-subtitle').textContent = `${cls.subject || ''} · ${cls.day_of_week || ''}${cls.room ? ' · ' + cls.room : ''}`;
  if (cls.current_unit) document.getElementById('class-unit').textContent = '📖 ' + cls.current_unit;

  await Promise.all([loadRoster(cls), loadGoldAdder(cls), loadRecentNotes(cls), loadAttendanceGrid(cls)]);
}

async function loadRoster(cls) {
  const el = document.getElementById('roster');
  const res = await supabase.from('class_enrollments')
    .select('*, students(id, name, current_gold)')
    .eq('class_id', classId)
    .is('enrolled_until', null);
  const enrollments = res.data || [];
  if (!enrollments.length) { showEmpty(el, '👥', 'No students enrolled'); return; }

  // Load today's attendance
  const ids = enrollments.map(e => e.student_id);
  const attRes = await supabase.from('attendance').select('*').eq('class_id', classId).eq('date', T).in('student_id', ids);
  const attMap = Object.fromEntries((attRes.data || []).map(a => [a.student_id, a]));

  el.innerHTML = enrollments.map(e => {
    const s = e.students;
    const att = attMap[s.id];
    return `
      <div class="list-item">
        <div class="list-item-left">
          <a href="student.html?id=${s.id}" style="text-decoration:none">
            <div class="list-item-name">${s.name}</div>
          </a>
          <div class="list-item-sub">${s.current_gold ?? 0} 🪙${e.skip_days ? ' · skips ' + e.skip_days : ''}</div>
        </div>
        <div class="list-item-right">
          ${att ? attendanceBadge(att.status) : '<span class="badge badge-gray">—</span>'}
          <select class="form-select" style="width:auto;padding:4px 8px;font-size:13px" onchange="logAtt(${s.id}, this.value)">
            <option value="">Mark...</option>
            <option value="Present" ${att?.status === 'Present' ? 'selected' : ''}>Present</option>
            <option value="Absent" ${att?.status === 'Absent' ? 'selected' : ''}>Absent</option>
            <option value="Late" ${att?.status === 'Late' ? 'selected' : ''}>Late</option>
            <option value="Excused" ${att?.status === 'Excused' ? 'selected' : ''}>Excused</option>
          </select>
        </div>
      </div>`;
  }).join('');
}

async function logAtt(studentId, status) {
  if (!status) return;
  const { error } = await supabase.from('attendance').upsert({
    student_id: studentId, class_id: classId, date: T, status
  }, { onConflict: 'student_id,class_id,date' });
  if (error) toast('Error: ' + error.message, 'error');
  else toast('Attendance saved', 'success');
}
window.logAtt = logAtt;

async function loadGoldAdder(cls) {
  const el = document.getElementById('gold-adder');
  const res = await supabase.from('class_enrollments')
    .select('student_id, students(id, name)')
    .eq('class_id', classId)
    .is('enrolled_until', null);
  const enrollments = res.data || [];

  // Pending gold state per student
  const pending = {};
  enrollments.forEach(e => { pending[e.student_id] = 0; });

  function renderAdder() {
    el.innerHTML = `
      <div style="margin-bottom:12px">
        <input type="text" class="form-input" id="gold-reason" placeholder="Reason (e.g. great participation)">
      </div>
      ${enrollments.map(e => `
        <div class="gold-adder-row">
          <div class="gold-adder-name">${e.students.name}</div>
          <button class="gold-btn gold-btn-minus" onclick="adjustGold(${e.student_id}, -1)">−</button>
          <div class="gold-pending ${pending[e.student_id] > 0 ? 'gold-pos' : pending[e.student_id] < 0 ? 'gold-neg' : ''}" id="gp-${e.student_id}">${pending[e.student_id] === 0 ? '—' : goldStr(pending[e.student_id])}</div>
          <button class="gold-btn gold-btn-plus" onclick="adjustGold(${e.student_id}, 1)">+</button>
        </div>`).join('')}
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn btn-gold" style="flex:1" onclick="submitGold()">Submit Gold</button>
        <button class="btn btn-ghost" onclick="resetGold()">Reset</button>
      </div>`;
  }

  window.adjustGold = (sid, delta) => {
    pending[sid] = (pending[sid] || 0) + delta;
    const el2 = document.getElementById(`gp-${sid}`);
    if (el2) {
      el2.textContent = pending[sid] === 0 ? '—' : goldStr(pending[sid]);
      el2.className = `gold-pending ${pending[sid] > 0 ? 'gold-pos' : pending[sid] < 0 ? 'gold-neg' : ''}`;
    }
  };

  window.submitGold = async () => {
    const reason = document.getElementById('gold-reason').value.trim() || 'Class gold';
    const entries = Object.entries(pending).filter(([,v]) => v !== 0);
    if (!entries.length) { toast('No gold to submit', 'info'); return; }
    const inserts = entries.map(([sid, amount]) => ({
      student_id: Number(sid), class_id: Number(classId), date: T,
      amount, reason,
      category: amount > 0 ? 'Participation' : 'Behavior',
      distributed: false
    }));
    const { error } = await supabase.from('gold_transactions').insert(inserts);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    // Update student balances
    for (const [sid, amount] of entries) {
      await supabase.rpc('increment_gold', { p_student_id: Number(sid), p_amount: amount }).catch(() => {
        // Fallback: manual update
        supabase.from('students').select('current_gold').eq('id', sid).single().then(r => {
          const cur = r.data?.current_gold ?? 0;
          supabase.from('students').update({ current_gold: cur + amount }).eq('id', sid);
        });
      });
    }
    Object.keys(pending).forEach(k => { pending[k] = 0; });
    toast(`Gold submitted for ${entries.length} student${entries.length > 1 ? 's' : ''}!`, 'success');
    renderAdder();
  };

  window.resetGold = () => {
    Object.keys(pending).forEach(k => { pending[k] = 0; });
    renderAdder();
  };

  renderAdder();
}

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
          <span class="badge badge-${catColor(n.category)}">${n.category}</span>
        </div>
        <div class="list-item-sub">${fmtDate(n.date)}${n.followup_needed ? ' 📌' : ''}</div>
        <div style="font-size:14px;margin-top:2px">${n.note || '—'}</div>
      </div>
    </div>`).join('');
}

function catColor(cat) {
  const m = { Academic:'blue', Behavior:'red', Social:'purple', Administrative:'gray', Pattern:'gold', Parent:'green', Health:'red' };
  return m[cat] || 'gray';
}

async function loadAttendanceGrid(cls) {
  const el = document.getElementById('att-grid');
  // Last 14 days
  const end = T;
  const start = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  const [rosterRes, attRes] = await Promise.all([
    supabase.from('class_enrollments').select('student_id, students(id, name)').eq('class_id', classId).is('enrolled_until', null),
    supabase.from('attendance').select('*').eq('class_id', classId).gte('date', start).lte('date', end)
  ]);

  const students = (rosterRes.data || []).map(e => e.students);
  const attRecords = attRes.data || [];
  const attMap = {};
  for (const a of attRecords) {
    if (!attMap[a.student_id]) attMap[a.student_id] = {};
    attMap[a.student_id][a.date] = a.status;
  }

  // Only show class days
  const days = [];
  for (let i = 14; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    days.push(d);
  }

  const colors = { Present: 'var(--green)', Absent: 'var(--red)', Late: 'var(--orange)', Excused: 'var(--gray-400)' };

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;font-size:12px;min-width:100%">
        <tr>
          <th style="text-align:left;padding:4px 8px;color:var(--gray-400)">Student</th>
          ${days.slice(-10).map(d => `<th style="padding:4px;color:var(--gray-400)">${d.slice(5)}</th>`).join('')}
        </tr>
        ${students.map(s => `
          <tr>
            <td style="padding:4px 8px;font-weight:600;white-space:nowrap"><a href="student.html?id=${s.id}" style="color:inherit;text-decoration:none">${s.name}</a></td>
            ${days.slice(-10).map(d => {
              const st = attMap[s.id]?.[d];
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
