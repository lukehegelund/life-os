// Life OS — Student List
import { supabase } from './supabase.js';
import { goldStr, goldClass, badge, showSpinner, showEmpty } from './utils.js';
import { startPolling } from './polling.js';

let allStudents = [];
let query = '';

async function load() {
  const res = await supabase.from('students')
    .select('id, name, grade_level, current_gold, status')
    .order('name');
  allStudents = res.data || [];
  render();
}

function render() {
  const el = document.getElementById('student-list');
  const q = query.toLowerCase().trim();
  const filtered = allStudents.filter(s =>
    s.status === 'Active' && (!q || s.name.toLowerCase().includes(q))
  );
  const inactive = allStudents.filter(s => s.status !== 'Active' && (!q || s.name.toLowerCase().includes(q)));

  if (!filtered.length && !inactive.length) {
    showEmpty(el, '🔍', 'No students found');
    return;
  }

  let html = '';
  if (filtered.length) {
    html += filtered.map(s => studentRow(s)).join('');
  }
  if (inactive.length) {
    html += `<div class="section-label" style="margin-top:16px">Inactive / Graduated</div>`;
    html += inactive.map(s => studentRow(s)).join('');
  }
  el.innerHTML = html;
}

function studentRow(s) {
  const goldColor = s.current_gold > 0 ? 'var(--gold)' : s.current_gold < 0 ? 'var(--red)' : 'var(--gray-400)';
  return `
    <a href="student.html?id=${s.id}" style="text-decoration:none;color:inherit">
      <div class="list-item">
        <div class="list-item-left">
          <div class="list-item-name">${s.name}</div>
          <div class="list-item-sub">Grade ${s.grade_level || '—'}</div>
        </div>
        <div class="list-item-right">
          <span style="font-weight:700;color:${goldColor}">${s.current_gold ?? 0} 🪙</span>
          ${s.status !== 'Active' ? `<span class="badge badge-gray">${s.status}</span>` : ''}
          <span style="color:var(--gray-400)">→</span>
        </div>
      </div>
    </a>`;
}

document.getElementById('search-input').addEventListener('input', e => {
  query = e.target.value;
  render();
});

// Followup banner
async function loadFollowups() {
  const res = await supabase.from('student_notes')
    .select('id', { count: 'exact', head: true })
    .eq('followup_needed', true);
  const count = res.count ?? 0;
  const el = document.getElementById('followup-banner');
  if (count > 0) {
    el.innerHTML = `<div class="alert alert-warning"><span class="alert-icon">📌</span><div><strong>${count}</strong> followup${count > 1 ? 's' : ''} pending across all students</div></div>`;
  }
}

load();
loadFollowups();
startPolling(load, 10000);
