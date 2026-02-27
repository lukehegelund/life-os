// Life OS — Reminders (v1: ntfy X-At scheduled notifications)
// Saves reminders to Supabase, fires ntfy with X-At header for scheduled delivery.
import { supabase } from './supabase.js';
import { today, toast, pstOffsetStr } from './utils.js?v=2';

const NTFY_TOPIC = 'luke-lifeos-rt2026';
const T = today();

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseNotes(r) {
  try { return JSON.parse(r.notes || '{}'); } catch { return {}; }
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
  const meta = parseNotes(r);
  if (r.status === 'dismissed') return 'done';
  if (!r.due_date) return 'upcoming';
  if (r.due_date < T) return 'overdue';
  if (r.due_date === T) return 'today';
  return 'upcoming';
}

// ── Load & Render ─────────────────────────────────────────────────────────────
async function load() {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .not('notes', 'like', '%claude_schedule%')  // exclude scheduled claude tasks
    .order('due_date', { ascending: true, nullsFirst: false });

  if (error) { console.error(error); return; }

  const active  = (data || []).filter(r => r.status !== 'dismissed');
  const done    = (data || []).filter(r => r.status === 'dismissed');

  const subtitle = active.length === 0
    ? 'Sin recordatorios activos'
    : `${active.length} activo${active.length !== 1 ? 's' : ''} · ${done.length} completado${done.length !== 1 ? 's' : ''}`;
  const subtitleEl = document.getElementById('reminders-subtitle');
  if (subtitleEl) subtitleEl.textContent = subtitle;

  const listEl = document.getElementById('reminders-list');
  if (active.length === 0 && done.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔔</div>
        <div class="empty-title">Sin recordatorios</div>
        <div class="empty-sub">Toca "+ Nuevo" para crear uno. Te llega una notificación en tu celular a la hora exacta.</div>
      </div>`;
    return;
  }

  let html = '';

  if (active.length > 0) {
    // Group: overdue, today, upcoming
    const overdue  = active.filter(r => reminderStatus(r) === 'overdue');
    const todayRem = active.filter(r => reminderStatus(r) === 'today');
    const upcoming = active.filter(r => reminderStatus(r) === 'upcoming');

    if (overdue.length)  html += `<div class="rem-section-label">⚠️ Vencidos (${overdue.length})</div>${overdue.map(renderCard).join('')}`;
    if (todayRem.length) html += `<div class="rem-section-label">📅 Hoy (${todayRem.length})</div>${todayRem.map(renderCard).join('')}`;
    if (upcoming.length) html += `<div class="rem-section-label">Próximos (${upcoming.length})</div>${upcoming.map(renderCard).join('')}`;
  }

  if (done.length > 0) {
    const shown = done.slice(0, 5); // show last 5 completed
    html += `<div class="rem-section-label">✅ Completados (${done.length})</div>${shown.map(renderCard).join('')}`;
    if (done.length > 5) {
      html += `<div style="text-align:center;font-size:12px;color:var(--gray-400);padding:8px">${done.length - 5} más no mostrados</div>`;
    }
  }

  listEl.innerHTML = html;
}

function renderCard(r) {
  const meta    = parseNotes(r);
  const status  = reminderStatus(r);
  const isDone  = status === 'done';

  const dateLabel = r.due_date ? fmtDateLocal(r.due_date) : 'Sin fecha';
  const timeLabel = meta.due_time ? ` · ${meta.due_time}` : '';
  const ntfyFired = meta.ntfy_scheduled ? true : false;

  const chipClass   = isDone ? 'done' : status === 'overdue' ? 'overdue' : status === 'today' ? 'today' : '';
  const cardClass   = isDone ? 'done' : status === 'overdue' ? 'overdue' : status === 'today' ? 'today' : '';

  const moduleIcon = { RT:'🏫', TOV:'💍', Personal:'👤', Health:'🏃', LifeOS:'🖥️' }[r.module] || '🔔';

  return `
    <div class="reminder-card ${cardClass}" data-id="${r.id}">
      <div class="reminder-icon">${moduleIcon}</div>
      <div class="reminder-body">
        <div class="reminder-title">${esc(r.title)}</div>
        <div class="reminder-meta">
          <span class="time-chip ${chipClass}">📅 ${dateLabel}${timeLabel}</span>
          ${ntfyFired ? `<span class="ntfy-badge">📱 ntfy ✓</span>` : ''}
          ${r.module ? `<span style="font-size:11px;color:var(--gray-400)">${r.module}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        ${!isDone ? `<button class="btn btn-sm btn-ghost" onclick="doneReminder(${r.id})" title="Marcar listo" style="font-size:16px;padding:4px 8px">✅</button>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="deleteReminder(${r.id})" title="Eliminar" style="font-size:16px;padding:4px 8px">🗑️</button>
      </div>
    </div>`;
}

// ── ntfy scheduling ───────────────────────────────────────────────────────────
async function scheduleNtfy(title, dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;

  // PST/PDT offset — dynamically computed from America/Los_Angeles
  const offsetStr = pstOffsetStr(); // '-08:00' (PST) or '-07:00' (PDT)
  const atHeader = `${dateStr}T${timeStr}:00${offsetStr}`;

  // Verify the scheduled time is in the future — ntfy silently defers past times to +24h
  const fireUTC = new Date(`${dateStr}T${timeStr}:00${offsetStr}`);
  if (fireUTC <= new Date()) {
    console.warn('scheduleNtfy: target time is in the past, skipping ntfy to avoid silent 24h deferral', atHeader);
    return 'past';
  }

  try {
    const resp = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        'Title': `Recordatorio: ${title}`,
        'X-At': atHeader,
        'Priority': '3',
        'Tags': 'bell',
      },
      body: title,
    });
    return resp.ok;
  } catch (e) {
    console.warn('ntfy scheduling failed:', e);
    return false;
  }
}

// ── Add Modal state ───────────────────────────────────────────────────────────
let _pickedDate = null;   // 'YYYY-MM-DD' or null
let _pickedTime = null;   // 'HH:MM' or null
let _pickedModule = 'Personal';

function _updateWhenDisplay() {
  const el = document.getElementById('selected-when-display');
  const txt = document.getElementById('selected-when-text');
  if (!el || !txt) return;
  if (!_pickedDate && !_pickedTime) {
    el.classList.remove('visible');
    txt.textContent = '';
    return;
  }
  const dateLabel = _pickedDate ? fmtDateLocal(_pickedDate) : 'Sin fecha';
  const timeLabel = _pickedTime ? ` · ${_pickedTime}` : '';
  txt.textContent = dateLabel + timeLabel;
  el.classList.add('visible');
}

function _clearQuickBtns() {
  document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('selected'));
}

window.pickPreset = (btn) => {
  _clearQuickBtns();
  btn.classList.add('selected');
  const preset = btn.dataset.preset;
  const now = new Date();

  if (preset === 'notime') {
    _pickedDate = T;
    _pickedTime = null;
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
    _pickedDate = T;
    _pickedTime = '19:00';
    document.getElementById('rem-time-custom').value = '19:00';
    document.getElementById('rem-date-custom').value = T;
  } else if (preset === 'tmr-am') {
    const tmr = new Date(now.getTime() + 86400000); // +24h
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
  _clearQuickBtns();
  _pickedTime = val || null;
  if (!_pickedDate) { _pickedDate = T; document.getElementById('rem-date-custom').value = T; }
  _updateWhenDisplay();
};

window.pickCustomDate = (val) => {
  _clearQuickBtns();
  _pickedDate = val || null;
  _updateWhenDisplay();
};

window.clearWhen = () => {
  _pickedDate = null;
  _pickedTime = null;
  _clearQuickBtns();
  document.getElementById('rem-time-custom').value = '';
  document.getElementById('rem-date-custom').value = '';
  _updateWhenDisplay();
};

window.pickModule = (btn) => {
  document.querySelectorAll('.mod-pill').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _pickedModule = btn.dataset.mod;
};

window.showAddModal = () => {
  // Reset state
  _pickedDate = null;
  _pickedTime = null;
  _pickedModule = 'Personal';
  document.getElementById('rem-title').value = '';
  document.getElementById('rem-time-custom').value = '';
  document.getElementById('rem-date-custom').value = '';
  _clearQuickBtns();
  document.querySelectorAll('.mod-pill').forEach(b => b.classList.remove('selected'));
  const defMod = document.querySelector('.mod-pill[data-mod="Personal"]');
  if (defMod) defMod.classList.add('selected');
  _updateWhenDisplay();
  document.getElementById('add-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rem-title').focus(), 50);
};

window.closeAddModal = () => {
  document.getElementById('add-modal').style.display = 'none';
};

window.submitReminder = async () => {
  const title  = document.getElementById('rem-title').value.trim();
  if (!title) { toast('Escribe el recordatorio'); return; }

  const date   = _pickedDate;
  const time   = _pickedTime;
  const module = _pickedModule;

  // Schedule ntfy if time provided
  let ntfyResult = false;
  if (time) {
    ntfyResult = await scheduleNtfy(title, date || T, time);
  }

  const meta = {};
  if (time) meta.due_time = time;
  if (ntfyResult === true) meta.ntfy_scheduled = true;

  const { error } = await supabase.from('reminders').insert({
    title,
    module,
    due_date: date || null,
    status: 'active',
    notes: Object.keys(meta).length ? JSON.stringify(meta) : null,
  });

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  closeAddModal();
  if (ntfyResult === true) {
    toast(`✅ Guardado · 📱 ntfy para ${time}`, 'success');
  } else if (ntfyResult === 'past') {
    toast(`✅ Guardado · ⚠️ ${time} ya pasó — sin notif`, 'info');
  } else if (time) {
    toast('✅ Guardado (ntfy sin conexión)', 'info');
  } else {
    toast('✅ Recordatorio guardado', 'success');
  }
  await load();
};

window.doneReminder = async (id) => {
  const { error } = await supabase.from('reminders').update({ status: 'dismissed' }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('✅ ¡Listo!', 'success');
  await load();
};

window.deleteReminder = async (id) => {
  const { error } = await supabase.from('reminders').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('🗑️ Eliminado', 'success');
  await load();
};

// ── Init ──────────────────────────────────────────────────────────────────────
load();
