// Life OS — Reminders (v1: ntfy X-At scheduled notifications)
// Saves reminders to Supabase, fires ntfy with X-At header for scheduled delivery.
import { supabase } from './supabase.js';
import { today, toast } from './utils.js';

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
  document.getElementById('reminders-subtitle').textContent = subtitle;

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

    if (overdue.length)  html += `<div class="section-label">⚠️ Vencidos (${overdue.length})</div>${overdue.map(renderCard).join('')}`;
    if (todayRem.length) html += `<div class="section-label">📅 Hoy (${todayRem.length})</div>${todayRem.map(renderCard).join('')}`;
    if (upcoming.length) html += `<div class="section-label">Próximos (${upcoming.length})</div>${upcoming.map(renderCard).join('')}`;
  }

  if (done.length > 0) {
    const shown = done.slice(0, 5); // show last 5 completed
    html += `<div class="section-label">✅ Completados (${done.length})</div>${shown.map(renderCard).join('')}`;
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

  // Build UTC ISO datetime — assume Luke is in Central Time (UTC-6, or -5 CDT)
  // We send as CT and let ntfy figure it out via X-At
  // Format: YYYY-MM-DDTHH:MM:SS-06:00
  const offsetStr = '-06:00'; // CST; change to -05:00 in CDT (Mar-Nov)
  const atHeader = `${dateStr}T${timeStr}:00${offsetStr}`;

  try {
    const resp = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        'Title': `🔔 Recordatorio: ${title}`,
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

// ── Add Modal ─────────────────────────────────────────────────────────────────
window.showAddModal = () => {
  document.getElementById('rem-title').value = '';
  document.getElementById('rem-date').value = T;
  document.getElementById('rem-time').value = '';
  document.getElementById('rem-module').value = 'Personal';
  document.getElementById('add-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rem-title').focus(), 50);
};

window.closeAddModal = () => {
  document.getElementById('add-modal').style.display = 'none';
};

window.submitReminder = async () => {
  const title  = document.getElementById('rem-title').value.trim();
  const date   = document.getElementById('rem-date').value;
  const time   = document.getElementById('rem-time').value;
  const module = document.getElementById('rem-module').value;

  if (!title) { toast('Escribe el recordatorio'); return; }

  // Schedule ntfy if time provided
  let ntfyOk = false;
  if (time) {
    ntfyOk = await scheduleNtfy(title, date || T, time);
  }

  const meta = {};
  if (time) meta.due_time = time;
  if (ntfyOk) meta.ntfy_scheduled = true;

  const { error } = await supabase.from('reminders').insert({
    title,
    module,
    due_date: date || null,
    status: 'active',
    notes: Object.keys(meta).length ? JSON.stringify(meta) : null,
  });

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  closeAddModal();
  if (ntfyOk) {
    toast(`✅ Recordatorio guardado · 📱 ntfy programado para ${time}`, 'success');
  } else if (time) {
    toast('✅ Recordatorio guardado (ntfy sin conexión — revisa tu red)', 'info');
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
