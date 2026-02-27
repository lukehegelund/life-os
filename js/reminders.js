// Life OS — Reminders v6 — recurring editable
// One-time reminders: saved to Supabase, Edge Function fires ntfy via pg_cron every minute
// Recurring reminders: daily / weekly / monthly / custom — also handled by Edge Function
import { supabase } from './supabase.js';
import { today, toast } from './utils.js?v=2';

const NTFY_TOPIC = 'luke-lifeos-rt2026';
const T = today();

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseNotes(r) {
  try { return JSON.parse(r.notes || '{}'); } catch { return {}; }
}
function parsePattern(r) {
  try { return JSON.parse(r.recurrence_pattern || '{}'); } catch { return {}; }
}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtDateLocal(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  const dt = new Date(+y, +m - 1, +d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function reminderStatus(r) {
  if (r.status === 'dismissed') return 'done';
  if (!r.due_date) return 'upcoming';
  if (r.due_date < T) return 'overdue';
  if (r.due_date === T) return 'today';
  return 'upcoming';
}

const DOW_LABELS = { sun:'Dom', mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb' };
const DOW_ORDER  = ['sun','mon','tue','wed','thu','fri','sat'];

function recurrenceLabel(r) {
  const p = parsePattern(r);
  if (!p.freq) return '';
  const timeStr = p.time ? ` a las ${p.time}` : '';
  if (p.freq === 'daily') return `Cada día${timeStr}`;
  if (p.freq === 'weekly') {
    const days = (p.days || []).map(d => DOW_LABELS[d] || d).join(', ');
    return `Semanal · ${days}${timeStr}`;
  }
  if (p.freq === 'monthly') return `Mensual · día ${p.day_of_month}${timeStr}`;
  if (p.freq === 'custom') {
    const days = (p.days || []).map(d => DOW_LABELS[d] || d).join(', ');
    return `Personalizado · ${days}${timeStr}`;
  }
  return p.freq;
}

// ── Load & Render ─────────────────────────────────────────────────────────────
async function load() {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .not('notes', 'like', '%claude_schedule%')
    .order('due_date', { ascending: true, nullsFirst: false });

  if (error) { console.error(error); return; }

  const oneTime   = (data || []).filter(r => !r.recurring);
  const recurring = (data || []).filter(r => r.recurring);

  const activeOT  = oneTime.filter(r => r.status !== 'dismissed');
  const doneOT    = oneTime.filter(r => r.status === 'dismissed');
  const activeRec = recurring.filter(r => r.status !== 'dismissed');

  const totalActive = activeOT.length + activeRec.length;
  const subtitle = totalActive === 0
    ? 'Sin recordatorios activos'
    : `${activeOT.length} activo${activeOT.length !== 1 ? 's' : ''} · ${activeRec.length} repetitivo${activeRec.length !== 1 ? 's' : ''} · ${doneOT.length} completado${doneOT.length !== 1 ? 's' : ''}`;
  const subtitleEl = document.getElementById('reminders-subtitle');
  if (subtitleEl) subtitleEl.textContent = subtitle;

  // ── One-time reminders ──
  const listEl = document.getElementById('reminders-list');
  let html = '';

  if (activeOT.length === 0 && doneOT.length === 0) {
    html = `<div class="empty-state">
      <div class="empty-icon">🔔</div>
      <div class="empty-title">Sin recordatorios</div>
      <div class="empty-sub">Toca "+ Nuevo" para crear uno.</div>
    </div>`;
  } else {
    const overdue  = activeOT.filter(r => reminderStatus(r) === 'overdue');
    const todayRem = activeOT.filter(r => reminderStatus(r) === 'today');
    const upcoming = activeOT.filter(r => reminderStatus(r) === 'upcoming');

    if (overdue.length)  html += `<div class="rem-section-label">⚠️ Vencidos (${overdue.length})</div>${overdue.map(renderCard).join('')}`;
    if (todayRem.length) html += `<div class="rem-section-label">📅 Hoy (${todayRem.length})</div>${todayRem.map(renderCard).join('')}`;
    if (upcoming.length) html += `<div class="rem-section-label">Próximos (${upcoming.length})</div>${upcoming.map(renderCard).join('')}`;

    if (doneOT.length > 0) {
      const shown = doneOT.slice(0, 5);
      html += `<div class="rem-section-label">✅ Completados (${doneOT.length})</div>${shown.map(renderCard).join('')}`;
      if (doneOT.length > 5) html += `<div style="text-align:center;font-size:12px;color:var(--gray-400);padding:8px">${doneOT.length - 5} más no mostrados</div>`;
    }
  }
  listEl.innerHTML = html;

  // ── Recurring reminders section ──
  const recEl = document.getElementById('recurring-section');
  let recHtml = `
    <div class="recurring-header" onclick="toggleRecurringSection()">
      <div class="recurring-header-title">🔁 Repetitivos ${activeRec.length > 0 ? `<span style="background:#f5f3ff;color:#7c3aed;padding:2px 8px;border-radius:99px;font-size:11px">${activeRec.length}</span>` : ''}</div>
      <div class="recurring-header-right">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();showRecurringModal()" style="font-size:12px;padding:4px 10px">+ Agregar</button>
        <span class="recurring-toggle" id="rec-toggle">▼</span>
      </div>
    </div>
    <div id="recurring-list">`;

  if (activeRec.length === 0) {
    recHtml += `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px">Sin recordatorios repetitivos. Toca "🔁" para crear uno.</div>`;
  } else {
    recHtml += activeRec.map(renderRecurringCard).join('');
  }
  recHtml += '</div>';
  recEl.innerHTML = recHtml;
}

function renderCard(r) {
  const meta    = parseNotes(r);
  const status  = reminderStatus(r);
  const isDone  = status === 'done';
  const dateLabel = r.due_date ? fmtDateLocal(r.due_date) : 'Sin fecha';
  const timeLabel = meta.due_time ? ` · ${meta.due_time}` : '';
  const chipClass = isDone ? 'done' : status === 'overdue' ? 'overdue' : status === 'today' ? 'today' : '';
  const cardClass = isDone ? 'done' : status === 'overdue' ? 'overdue' : status === 'today' ? 'today' : '';
  const moduleIcon = { RT:'🏫', TOV:'💍', Personal:'👤', Health:'🏃', LifeOS:'🖥️' }[r.module] || '🔔';
  const lastFired = meta.last_fired_date || meta.ntfy_fired;

  return `
    <div class="reminder-card ${cardClass}" data-id="${r.id}">
      <div class="reminder-icon">${moduleIcon}</div>
      <div class="reminder-body">
        <div class="reminder-title">${esc(r.title)}</div>
        <div class="reminder-meta">
          <span class="time-chip ${chipClass}">📅 ${dateLabel}${timeLabel}</span>
          ${lastFired ? `<span class="ntfy-badge">📱 ntfy ✓</span>` : ''}
          ${r.module ? `<span style="font-size:11px;color:var(--gray-400)">${r.module}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        ${!isDone ? `<button class="btn btn-sm btn-ghost" onclick="doneReminder(${r.id})" title="Marcar listo" style="font-size:16px;padding:4px 8px">✅</button>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="deleteReminder(${r.id})" title="Eliminar" style="font-size:16px;padding:4px 8px">🗑️</button>
      </div>
    </div>`;
}

function renderRecurringCard(r) {
  const moduleIcon = { RT:'🏫', TOV:'💍', Personal:'👤', Health:'🏃', LifeOS:'🖥️' }[r.module] || '🔔';
  const label = recurrenceLabel(r);
  const meta = parseNotes(r);
  const lastFired = meta.last_fired_date;

  return `
    <div class="reminder-card recurring-card" data-id="${r.id}">
      <div class="reminder-icon recurring-icon">${moduleIcon}</div>
      <div class="reminder-body">
        <div class="reminder-title">${esc(r.title)}</div>
        <div class="reminder-meta">
          <span class="time-chip recurring">🔁 ${esc(label)}</span>
          ${lastFired ? `<span class="ntfy-badge">📱 última: ${lastFired}</span>` : ''}
          ${r.module ? `<span style="font-size:11px;color:var(--gray-400)">${r.module}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-ghost" onclick="editRecurring(${r.id})" title="Editar" style="font-size:14px;padding:4px 8px">✏️</button>
        <button class="btn btn-sm btn-ghost" onclick="pauseRecurring(${r.id})" title="Pausar" style="font-size:14px;padding:4px 8px">⏸️</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteReminder(${r.id})" title="Eliminar" style="font-size:16px;padding:4px 8px">🗑️</button>
      </div>
    </div>`;
}

window.toggleRecurringSection = () => {
  const list   = document.getElementById('recurring-list');
  const toggle = document.getElementById('rec-toggle');
  if (!list || !toggle) return;
  const hidden = list.style.display === 'none';
  list.style.display = hidden ? '' : 'none';
  toggle.classList.toggle('open', hidden);
};

// ── Add ONE-TIME Modal state ──────────────────────────────────────────────────
let _pickedDate = null;
let _pickedTime = null;
let _pickedModule = 'Personal';

function _updateWhenDisplay() {
  const el  = document.getElementById('selected-when-display');
  const txt = document.getElementById('selected-when-text');
  if (!el || !txt) return;
  if (!_pickedDate && !_pickedTime) { el.classList.remove('visible'); txt.textContent = ''; return; }
  const dateLabel = _pickedDate ? fmtDateLocal(_pickedDate) : 'Sin fecha';
  const timeLabel = _pickedTime ? ` · ${_pickedTime}` : '';
  txt.textContent = dateLabel + timeLabel;
  el.classList.add('visible');
}
function _clearQuickBtns() {
  document.querySelectorAll('#add-modal .quick-btn').forEach(b => b.classList.remove('selected'));
}

window.pickPreset = (btn) => {
  _clearQuickBtns();
  btn.classList.add('selected');
  const preset = btn.dataset.preset;
  const now = new Date();
  if (preset === 'notime') {
    _pickedDate = T; _pickedTime = null;
    document.getElementById('rem-time-custom').value = '';
    document.getElementById('rem-date-custom').value = T;
  } else if (preset === 'in30') {
    const t = new Date(now.getTime() + 30*60000);
    _pickedDate = t.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    _pickedTime = t.toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
    document.getElementById('rem-time-custom').value = _pickedTime;
    document.getElementById('rem-date-custom').value = _pickedDate;
  } else if (preset === 'in1h') {
    const t = new Date(now.getTime() + 60*60000);
    _pickedDate = t.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    _pickedTime = t.toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
    document.getElementById('rem-time-custom').value = _pickedTime;
    document.getElementById('rem-date-custom').value = _pickedDate;
  } else if (preset === 'tonight') {
    _pickedDate = T; _pickedTime = '19:00';
    document.getElementById('rem-time-custom').value = '19:00';
    document.getElementById('rem-date-custom').value = T;
  } else if (preset === 'tmr-am') {
    const tmr = new Date(now.getTime() + 86400000);
    _pickedDate = tmr.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    _pickedTime = '08:00';
    document.getElementById('rem-time-custom').value = '08:00';
    document.getElementById('rem-date-custom').value = _pickedDate;
  } else if (preset === 'tmr-pm') {
    const tmr = new Date(now.getTime() + 86400000);
    _pickedDate = tmr.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    _pickedTime = '15:00';
    document.getElementById('rem-time-custom').value = '15:00';
    document.getElementById('rem-date-custom').value = _pickedDate;
  }
  _updateWhenDisplay();
};
window.pickCustomTime = (val) => {
  _clearQuickBtns(); _pickedTime = val || null;
  if (!_pickedDate) { _pickedDate = T; document.getElementById('rem-date-custom').value = T; }
  _updateWhenDisplay();
};
window.pickCustomDate = (val) => { _clearQuickBtns(); _pickedDate = val || null; _updateWhenDisplay(); };
window.clearWhen = () => {
  _pickedDate = null; _pickedTime = null;
  _clearQuickBtns();
  document.getElementById('rem-time-custom').value = '';
  document.getElementById('rem-date-custom').value = '';
  _updateWhenDisplay();
};
window.pickModule = (btn) => {
  document.querySelectorAll('#add-modal .mod-pill').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _pickedModule = btn.dataset.mod;
};
window.showAddModal = () => {
  _pickedDate = null; _pickedTime = null; _pickedModule = 'Personal';
  document.getElementById('rem-title').value = '';
  document.getElementById('rem-time-custom').value = '';
  document.getElementById('rem-date-custom').value = '';
  _clearQuickBtns();
  document.querySelectorAll('#add-modal .mod-pill').forEach(b => b.classList.remove('selected'));
  const defMod = document.querySelector('#add-modal .mod-pill[data-mod="Personal"]');
  if (defMod) defMod.classList.add('selected');
  _updateWhenDisplay();
  document.getElementById('add-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rem-title').focus(), 50);
};
window.closeAddModal = () => { document.getElementById('add-modal').style.display = 'none'; };

window.submitReminder = async () => {
  const title  = document.getElementById('rem-title').value.trim();
  if (!title) { toast('Escribe el recordatorio'); return; }
  const date   = _pickedDate;
  const time   = _pickedTime;
  const module = _pickedModule;
  const meta   = {};
  if (time) meta.due_time = time;
  const { error } = await supabase.from('reminders').insert({
    title, module,
    due_date: date || null,
    status: 'active',
    notes: Object.keys(meta).length ? JSON.stringify(meta) : null,
  });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  closeAddModal();
  toast(time ? `✅ Guardado · 📱 notif a las ${time} PST` : '✅ Recordatorio guardado', 'success');
  await load();
};

// ── RECURRING Modal state ─────────────────────────────────────────────────────
let _recFreq      = 'daily';
let _recDays      = [];       // for weekly/custom
let _recDom       = 1;        // for monthly
let _recTime      = null;     // 'HH:MM'
let _recModule    = 'Personal';
let _editingRecId = null;     // null = new, number = editing existing

function _updateRecPreview() {
  const titleEl = document.getElementById('rec-title');
  const preview = document.getElementById('rec-preview');
  if (!preview) return;
  const title = titleEl?.value.trim() || '(sin título)';
  let freq = '';
  if (_recFreq === 'daily') freq = 'Cada día';
  else if (_recFreq === 'weekly') {
    const labels = _recDays.map(d => DOW_LABELS[d] || d);
    freq = labels.length ? `Cada ${labels.join(', ')}` : 'Semanal (selecciona días)';
  } else if (_recFreq === 'monthly') {
    freq = `El día ${_recDom} de cada mes`;
  } else if (_recFreq === 'custom') {
    const labels = _recDays.map(d => DOW_LABELS[d] || d);
    freq = labels.length ? `Días: ${labels.join(', ')}` : 'Personalizado (selecciona días)';
  }
  const timeStr = _recTime || '(sin hora)';
  preview.style.display = 'block';
  preview.innerHTML = `🔁 <strong>${esc(title)}</strong> · ${freq} a las <strong>${timeStr} PST</strong>`;
}

window.pickFreq = (btn) => {
  document.querySelectorAll('#freq-pills .freq-pill').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _recFreq = btn.dataset.freq;
  // Show/hide sub-sections
  const dowSection = document.getElementById('rec-dow-section');
  const domSection = document.getElementById('rec-dom-section');
  dowSection.style.display = (_recFreq === 'weekly' || _recFreq === 'custom') ? '' : 'none';
  domSection.style.display = (_recFreq === 'monthly') ? '' : 'none';
  _updateRecPreview();
};

window.toggleDow = (btn) => {
  const dow = btn.dataset.dow;
  btn.classList.toggle('selected');
  if (btn.classList.contains('selected')) {
    if (!_recDays.includes(dow)) _recDays.push(dow);
  } else {
    _recDays = _recDays.filter(d => d !== dow);
  }
  // Sort by calendar order
  _recDays.sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b));
  _updateRecPreview();
};

window.pickRecTime = (btn, time) => {
  document.querySelectorAll('#recurring-modal .quick-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _recTime = time;
  document.getElementById('rec-time-custom').value = time;
  _updateRecPreview();
};

window.pickRecTimeCustom = (val) => {
  document.querySelectorAll('#recurring-modal .quick-btn').forEach(b => b.classList.remove('selected'));
  _recTime = val || null;
  _updateRecPreview();
};

window.pickRecModule = (btn) => {
  document.querySelectorAll('#rec-mod-pills .mod-pill').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _recModule = btn.dataset.mod;
};

window.showRecurringModal = () => {
  _editingRecId = null;
  _recFreq = 'daily'; _recDays = []; _recDom = 1; _recTime = null; _recModule = 'Personal';
  document.getElementById('rec-title').value = '';
  document.getElementById('rec-time-custom').value = '';
  document.getElementById('rec-dom').value = '1';
  document.querySelectorAll('#freq-pills .freq-pill').forEach(b => b.classList.remove('selected'));
  document.querySelector('#freq-pills [data-freq="daily"]').classList.add('selected');
  document.querySelectorAll('.dow-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('#recurring-modal .quick-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('#rec-mod-pills .mod-pill').forEach(b => b.classList.remove('selected'));
  document.querySelector('#rec-mod-pills [data-mod="Personal"]').classList.add('selected');
  document.getElementById('rec-dow-section').style.display = 'none';
  document.getElementById('rec-dom-section').style.display = 'none';
  document.getElementById('rec-preview').style.display = 'none';
  // Update modal title for new vs edit
  const modalTitle = document.getElementById('rec-modal-title');
  if (modalTitle) modalTitle.textContent = '🔁 Nuevo repetitivo';
  const submitBtn = document.querySelector('#recurring-modal .submit-rec-btn');
  if (submitBtn) submitBtn.textContent = 'Guardar repetitivo';
  document.getElementById('recurring-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rec-title').focus(), 50);
};
window.closeRecurringModal = () => { document.getElementById('recurring-modal').style.display = 'none'; _editingRecId = null; };

// ── Edit existing recurring reminder ──────────────────────────────────────────
window.editRecurring = async (id) => {
  // Load the reminder data from the DOM (it's already loaded in memory)
  const { data, error } = await supabase.from('reminders').select('*').eq('id', id).single();
  if (error || !data) { toast('Error al cargar recordatorio', 'error'); return; }

  _editingRecId = id;
  const p = parsePattern(data);

  // Pre-fill title
  document.getElementById('rec-title').value = data.title || '';

  // Pre-fill freq
  _recFreq = p.freq || 'daily';
  document.querySelectorAll('#freq-pills .freq-pill').forEach(b => b.classList.remove('selected'));
  const freqBtn = document.querySelector(`#freq-pills [data-freq="${_recFreq}"]`);
  if (freqBtn) freqBtn.classList.add('selected');

  // Show/hide sub-sections
  document.getElementById('rec-dow-section').style.display = (_recFreq === 'weekly' || _recFreq === 'custom') ? '' : 'none';
  document.getElementById('rec-dom-section').style.display = (_recFreq === 'monthly') ? '' : 'none';

  // Pre-fill days
  _recDays = Array.isArray(p.days) ? [...p.days] : [];
  document.querySelectorAll('.dow-btn').forEach(b => {
    b.classList.toggle('selected', _recDays.includes(b.dataset.dow));
  });

  // Pre-fill day of month
  _recDom = p.day_of_month || 1;
  document.getElementById('rec-dom').value = String(_recDom);

  // Pre-fill time
  _recTime = p.time || null;
  document.getElementById('rec-time-custom').value = _recTime || '';
  document.querySelectorAll('#recurring-modal .quick-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset?.time === _recTime || b.textContent === _recTime);
  });

  // Pre-fill module
  _recModule = data.module || 'Personal';
  document.querySelectorAll('#rec-mod-pills .mod-pill').forEach(b => b.classList.remove('selected'));
  const modBtn = document.querySelector(`#rec-mod-pills [data-mod="${_recModule}"]`);
  if (modBtn) modBtn.classList.add('selected');

  // Update modal title and submit button
  const modalTitle = document.getElementById('rec-modal-title');
  if (modalTitle) modalTitle.textContent = '✏️ Editar repetitivo';
  const submitBtn = document.querySelector('#recurring-modal .submit-rec-btn');
  if (submitBtn) submitBtn.textContent = 'Guardar cambios';

  _updateRecPreview();
  document.getElementById('recurring-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rec-title').focus(), 50);
};

window.submitRecurring = async () => {
  const title = document.getElementById('rec-title').value.trim();
  if (!title) { toast('Escribe el recordatorio'); return; }
  if (!_recTime) { toast('Elige una hora'); return; }
  if ((_recFreq === 'weekly' || _recFreq === 'custom') && _recDays.length === 0) {
    toast('Selecciona al menos un día'); return;
  }

  const domVal = Number(document.getElementById('rec-dom')?.value) || 1;
  const pattern = { freq: _recFreq, time: _recTime };
  if (_recFreq === 'weekly' || _recFreq === 'custom') pattern.days = _recDays;
  if (_recFreq === 'monthly') pattern.day_of_month = domVal;

  const payload = {
    title,
    module: _recModule,
    recurring: true,
    recurrence_pattern: JSON.stringify(pattern),
    status: 'active',
  };

  let error;
  if (_editingRecId) {
    // Update existing
    ({ error } = await supabase.from('reminders').update(payload).eq('id', _editingRecId));
  } else {
    // Insert new
    ({ error } = await supabase.from('reminders').insert({ ...payload, notes: null }));
  }

  if (error) { toast('Error: ' + error.message, 'error'); return; }
  closeRecurringModal();
  toast(_editingRecId ? '✏️ Repetitivo actualizado' : '🔁 Recordatorio repetitivo guardado', 'success');
  await load();
};

// ── CRUD ──────────────────────────────────────────────────────────────────────
window.doneReminder = async (id) => {
  const { error } = await supabase.from('reminders').update({ status: 'dismissed' }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('✅ ¡Listo!', 'success');
  await load();
};

window.pauseRecurring = async (id) => {
  const { error } = await supabase.from('reminders').update({ status: 'dismissed' }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('⏸️ Repetitivo pausado', 'success');
  await load();
};

window.deleteReminder = async (id) => {
  const { error } = await supabase.from('reminders').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('🗑️ Eliminado', 'success');
  await load();
};

// ── Init ──────────────────────────────────────────────────────────────────────
// Update preview live as title is typed
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('rec-title')?.addEventListener('input', _updateRecPreview);
  document.getElementById('rec-dom')?.addEventListener('input', (e) => {
    _recDom = Number(e.target.value);
    _updateRecPreview();
  });
});

load();
