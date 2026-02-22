// Life OS — Parent CRM
import { supabase } from './supabase.js';
import { fmtDate, toast, showSpinner } from './utils.js';

let activeFilter = 'all';

window.setFilter = (f) => {
  activeFilter = f;
  document.querySelectorAll('.mod-btn').forEach(b => {
    b.classList.remove('btn-primary'); b.classList.add('btn-ghost');
  });
  document.getElementById(`filter-${f}`)?.classList.replace('btn-ghost', 'btn-primary');
  load();
};

async function load() {
  const el = document.getElementById('crm-list');
  showSpinner(el);

  let query = supabase.from('parent_crm')
    .select('*, students(id, name)')
    .order('created_at', { ascending: false });

  if (activeFilter === 'pending') query = query.eq('status', 'pending');
  if (activeFilter === 'communicated') query = query.eq('status', 'communicated');

  const res = await query;
  const items = res.data || [];

  // Summary
  const allRes = await supabase.from('parent_crm').select('status');
  const allItems = allRes.data || [];
  const pendingCount = allItems.filter(i => i.status === 'pending').length;
  const summaryEl = document.getElementById('crm-summary');
  if (summaryEl) summaryEl.textContent = `${pendingCount} pending · ${allItems.length} total`;

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
      ${group.items.map(item => `
        <div class="list-item" style="border-bottom:1px solid var(--gray-100);padding:10px 0" id="crm-item-${item.id}">
          <div class="list-item-left" style="flex:1">
            <div style="font-size:14px;font-weight:500">${item.title}</div>
            ${item.notes && item.notes !== item.title ? `<div style="font-size:13px;color:var(--gray-600);margin-top:2px">${item.notes}</div>` : ''}
            <div style="font-size:12px;color:var(--gray-400);margin-top:4px">
              ${fmtDate(item.created_at)}
              ${item.communicated_at ? ` · Communicated ${fmtDate(item.communicated_at)}` : ''}
            </div>
          </div>
          <div class="list-item-right" style="flex-shrink:0">
            ${item.status === 'pending'
              ? `<button class="btn btn-sm btn-primary" onclick="markCommunicated(${item.id})">✓ Done</button>`
              : `<span class="badge badge-green">Done ✓</span>`}
          </div>
        </div>`).join('')}
    </div>`).join('');
}

window.markCommunicated = async (id) => {
  const { error } = await supabase.from('parent_crm').update({
    status: 'communicated',
    communicated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Marked as communicated ✓', 'success');
  load();
};

load();
