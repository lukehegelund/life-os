// Life OS — Class List
import { supabase } from './supabase.js';
import { today, showSpinner, showEmpty } from './utils.js';

async function load() {
  const res = await supabase.table('classes').select('id, name, subject, day_of_week, time_start, room, current_unit').order('name');
  const classes = res.data || [];

  const el = document.getElementById('class-list');
  if (!classes.length) { showEmpty(el, '📚', 'No classes found'); return; }

  // Group by subject
  const groups = {};
  for (const c of classes) {
    const s = c.subject || 'Other';
    if (!groups[s]) groups[s] = [];
    groups[s].push(c);
  }

  const subjectColors = {
    English: 'blue', Guitar: 'green', Math: 'blue', Music: 'purple',
    Technology: 'blue', Performance: 'purple', Humanities: 'orange', Other: 'gray'
  };

  el.innerHTML = Object.entries(groups).map(([subj, cls]) => `
    <div class="section-label">${subj}</div>
    ${cls.map(c => `
      <a href="class.html?id=${c.id}" style="text-decoration:none;color:inherit">
        <div class="list-item">
          <div class="list-item-left">
            <div class="list-item-name">${c.name}</div>
            <div class="list-item-sub">${c.day_of_week || '—'} · ${c.time_start ? c.time_start.slice(0,5) : ''}${c.room ? ' · ' + c.room : ''}</div>
            ${c.current_unit ? `<div style="font-size:12px;color:var(--blue);margin-top:2px">📖 ${c.current_unit}</div>` : ''}
          </div>
          <div class="list-item-right">
            <span style="color:var(--gray-400)">→</span>
          </div>
        </div>
      </a>`).join('')}`).join('');
}

load();
