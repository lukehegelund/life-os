// Life OS — Calendar (Month + Week views, Sunday start)
// Supports drag/resize/add/delete of calendar_events in week view
import { supabase } from './supabase.js';
import { today, toast } from './utils.js';

const T = today();
const TODAY = new Date(T + 'T00:00:00');

let viewMode = 'week'; // 'month' | 'week' | 'day'
let viewYear = TODAY.getFullYear();
let viewMonth = TODAY.getMonth(); // 0-based
let viewWeekStart = getWeekStart(TODAY); // Date object = Sunday of current week
let viewDay = new Date(TODAY); // Current day for day view
let selectedDate = T;

// Event cache keyed by 'YYYY-MM-DD'
const eventCache = {};

// ── Color filter — set of hex colors currently hidden ──────────────────────
const hiddenColors = new Set();

window._calToggleColor = (color) => {
  if (hiddenColors.has(color)) {
    hiddenColors.delete(color);
  } else {
    hiddenColors.add(color);
  }
  // Update swatch UI — dim hidden, show active with ring
  document.querySelectorAll('.cal-filter-swatch').forEach(sw => {
    const c = sw.dataset.color;
    const hidden = hiddenColors.has(c);
    sw.style.opacity = hidden ? '0.25' : '1';
    sw.style.transform = hidden ? 'scale(0.8)' : 'scale(1)';
    sw.style.boxShadow = hidden
      ? 'none'
      : '0 0 0 2px white,0 0 0 3px rgba(0,0,0,0.15)';
  });
  render();
};

// Filter events from cache applying hiddenColors
function getVisibleEvents(dateKey) {
  const evs = eventCache[dateKey] || [];
  if (hiddenColors.size === 0) return evs;
  return evs.filter(e => !hiddenColors.has(e.color));
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── View switching ────────────────────────────────────────────────────────────
window.setView = (mode, dateStr) => {
  viewMode = mode;
  document.getElementById('btn-month').classList.toggle('active', mode === 'month');
  document.getElementById('btn-week').classList.toggle('active', mode === 'week');
  document.getElementById('btn-day').classList.toggle('active', mode === 'day');
  // Show/hide the day-label row
  document.getElementById('cal-day-labels').style.display = mode === 'month' ? 'grid' : 'none';
  if (mode === 'day') {
    if (dateStr) {
      viewDay = new Date(dateStr + 'T00:00:00');
      selectedDate = dateStr;
    }
    // Otherwise keep current viewDay
  }
  render();
};

window.prev = () => {
  if (viewMode === 'month') {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  } else if (viewMode === 'day') {
    viewDay = addDays(viewDay, -1);
    selectedDate = dateStr(viewDay);
  } else {
    viewWeekStart = addDays(viewWeekStart, -7);
  }
  render();
};

window.next = () => {
  if (viewMode === 'month') {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  } else if (viewMode === 'day') {
    viewDay = addDays(viewDay, 1);
    selectedDate = dateStr(viewDay);
  } else {
    viewWeekStart = addDays(viewWeekStart, 7);
  }
  render();
};

window.goToday = () => {
  viewYear = TODAY.getFullYear();
  viewMonth = TODAY.getMonth();
  viewWeekStart = getWeekStart(TODAY);
  viewDay = new Date(TODAY);
  selectedDate = T;
  render();
};

window.selectDay = (dateStr) => {
  selectedDate = dateStr;
  if (viewMode === 'month') renderMonthGrid();
  renderDayPanel(dateStr);
};

// Switch to day view when clicking a day number in week view header
window.drillToDay = (ds) => {
  viewDay = new Date(ds + 'T00:00:00');
  selectedDate = ds;
  setView('day');
};

// ── Main render ───────────────────────────────────────────────────────────────
async function render() {
  await fetchEvents();
  if (viewMode === 'month') {
    renderMonthGrid();
  } else if (viewMode === 'day') {
    renderDayGrid();
  } else {
    renderWeekGrid();
  }
  if (viewMode !== 'day') {
    renderDayPanel(selectedDate);
  } else {
    // Clear the day panel below when in day view (events shown in timeline)
    const hEl = document.getElementById('selected-day-header');
    const eEl = document.getElementById('day-events');
    if (hEl) hEl.textContent = '';
    if (eEl) eEl.innerHTML = '';
  }
}

// ── Fetch events for visible range ────────────────────────────────────────────
async function fetchEvents() {
  let rangeStart, rangeEnd;

  if (viewMode === 'month') {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    rangeStart = new Date(firstDay);
    rangeStart.setDate(rangeStart.getDate() - firstDay.getDay());
    rangeEnd = new Date(lastDay);
    rangeEnd.setDate(rangeEnd.getDate() + (6 - lastDay.getDay()));
  } else if (viewMode === 'day') {
    rangeStart = new Date(viewDay);
    rangeEnd = new Date(viewDay);
  } else {
    rangeStart = new Date(viewWeekStart);
    rangeEnd = addDays(rangeStart, 6);
  }

  const startStr = dateStr(rangeStart);
  const endStr = dateStr(rangeEnd);

  // Seed cache
  let d = new Date(rangeStart);
  while (d <= rangeEnd) {
    eventCache[dateStr(d)] = [];
    d = addDays(d, 1);
  }

  const [tasksRes, remindersRes, weddingsRes, classesRes, calEventsRes, timeBlocksRes, classDailyNotesRes] = await Promise.all([
    supabase.from('tasks')
      .select('id, title, due_date, priority, module')
      .in('status', ['open', 'in_progress'])
      .gte('due_date', startStr)
      .lte('due_date', endStr),
    supabase.from('reminders')
      .select('id, title, due_date, module')
      .eq('status', 'active')
      .gte('due_date', startStr)
      .lte('due_date', endStr),
    supabase.from('tov_clients')
      .select('id, name, wedding_date')
      .gte('wedding_date', startStr)
      .lte('wedding_date', endStr),
    supabase.from('classes').select('id, name, day_of_week, time_start, time_end, subject'),
    supabase.from('calendar_events')
      .select('id, title, start_time, end_time, all_day, calendar_name, color, is_busy, notes, recurrence, recurrence_group_id')
      .gte('start_time', startStr)
      .lte('start_time', endStr + 'T23:59:59'),
    supabase.from('time_blocks')
      .select('id, date, start_time, end_time, title, block_type, assigned_tasks, status, description')
      .gte('date', startStr)
      .lte('date', endStr),
    supabase.from('class_daily_notes')
      .select('class_id, date, note')
      .gte('date', startStr)
      .lte('date', endStr),
  ]);

  // Build classDateNotes lookup: classId → date → note
  const classDateNotes = {};
  for (const n of (classDailyNotesRes.data || [])) {
    if (!n.note) continue;
    if (!classDateNotes[n.class_id]) classDateNotes[n.class_id] = {};
    classDateNotes[n.class_id][n.date] = n.note;
  }
  // Make accessible globally for the class popup
  window._classDateNotes = classDateNotes;

  for (const t of (tasksRes.data || [])) {
    if (!eventCache[t.due_date]) continue;
    eventCache[t.due_date].push({
      type: 'task', title: t.title,
      meta: `${t.module}${t.priority === 'urgent' ? ' · 🔴 Urgent' : ''}`,
      color: t.priority === 'urgent' ? '#E8563A' : '#D97706',
      link: 'tasks.html',
      timeStart: null, timeEnd: null,
    });
  }

  for (const r of (remindersRes.data || [])) {
    if (!eventCache[r.due_date]) continue;
    eventCache[r.due_date].push({
      type: 'reminder', title: r.title,
      meta: r.module || 'Reminder',
      color: '#DC2626',
      link: 'tasks.html',
      timeStart: null, timeEnd: null,
    });
  }

  for (const w of (weddingsRes.data || [])) {
    if (!eventCache[w.wedding_date]) continue;
    eventCache[w.wedding_date].push({
      type: 'wedding', title: `💍 ${w.name}`,
      meta: 'Wedding',
      color: '#16a34a',
      link: `tov-client.html?id=${w.id}`,
      timeStart: null, timeEnd: null,
    });
  }

  // Expand recurring classes onto each day in range
  const classes = classesRes.data || [];
  let cur = new Date(rangeStart);
  while (cur <= rangeEnd) {
    const key = dateStr(cur);
    const dow = cur.getDay();
    for (const cls of classes) {
      if (classMatchesDow(cls.day_of_week, dow)) {
        if (!eventCache[key]) eventCache[key] = [];
        const classNote = (classDateNotes[cls.id] && classDateNotes[cls.id][key]) || null;
        eventCache[key].push({
          type: 'class', title: cls.name,
          meta: cls.time_start ? fmt12(cls.time_start.slice(0,5)) : cls.subject || '',
          color: '#2563EB',
          link: `class.html?id=${cls.id}`,
          timeStart: cls.time_start ? cls.time_start.slice(0,5) : null,
          timeEnd: cls.time_end ? cls.time_end.slice(0,5) : null,
          classId: cls.id,
          editable: true,
          notes: classNote,
        });
      }
    }
    cur = addDays(cur, 1);
  }

  // Add Google Calendar events (editable)
  for (const ev of (calEventsRes.data || [])) {
    const key = ev.start_time ? ev.start_time.slice(0, 10) : null;
    if (!key || !eventCache[key]) continue;
    const startLocal = ev.start_time ? ev.start_time.slice(11, 16) : null;
    const endLocal   = ev.end_time   ? ev.end_time.slice(11, 16)   : null;
    const calColor = ev.color || '#0F9D58';
    eventCache[key].push({
      type: 'gcal',
      id: ev.id,
      title: ev.title,
      meta: ev.calendar_name || 'Calendar',
      color: calColor,
      link: '#',
      timeStart: ev.all_day ? null : startLocal,
      timeEnd:   ev.all_day ? null : endLocal,
      isBusy: ev.is_busy,
      editable: true,
      notes: ev.notes || null,
      recurrence: ev.recurrence || null,
      recurrenceGroupId: ev.recurrence_group_id || null,
    });
  }

  // Add time blocks (focus sessions)
  for (const tb of (timeBlocksRes.data || [])) {
    const key = tb.date;
    if (!eventCache[key]) continue;
    const tasks = tb.assigned_tasks || [];
    const taskCount = Array.isArray(tasks) ? tasks.length : 0;
    const label = taskCount > 0 ? `${tb.title} · ${taskCount} task${taskCount !== 1 ? 's' : ''}` : tb.title;
    const blockColor = tb.block_type === 'focus'  ? '#7C3AED'
                     : tb.block_type === 'buffer' ? '#6B7280'
                     : tb.block_type === 'open'   ? '#0891B2'
                     : '#7C3AED';
    const tStart = tb.start_time ? tb.start_time.slice(0,5) : null;
    const tEnd   = tb.end_time   ? tb.end_time.slice(0,5)   : null;
    eventCache[key].push({
      type: 'timeblock',
      title: label,
      meta: tb.status === 'done' ? '✅ Done' : (tb.description || 'Focus block'),
      color: blockColor,
      link: '#',
      timeStart: tStart,
      timeEnd: tEnd,
      taskCount,
      taskList: Array.isArray(tasks) ? tasks : [],
      isDone: tb.status === 'done',
    });
  }

  // Sort each day: gcal + classes first (by time), then time blocks, tasks, reminders, weddings
  const typeOrder = { gcal: 0, class: 0, timeblock: 1, task: 2, reminder: 3, wedding: 4 };
  for (const key of Object.keys(eventCache)) {
    eventCache[key].sort((a, b) => {
      const td = (typeOrder[a.type] ?? 2) - (typeOrder[b.type] ?? 2);
      if (td !== 0) return td;
      const ta = a.timeStart || '99:99';
      const tb2 = b.timeStart || '99:99';
      return ta.localeCompare(tb2);
    });
  }
}

// ── Month grid ────────────────────────────────────────────────────────────────
function renderMonthGrid() {
  document.getElementById('period-label').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  document.getElementById('cal-day-labels').style.display = 'grid';
  const gridEl = document.getElementById('cal-grid');
  gridEl.style.display = 'grid';
  gridEl.style.gridTemplateColumns = 'repeat(7, 1fr)';

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startOffset = firstDay.getDay();
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

  let html = '';
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    const inMonth = dayNum >= 1 && dayNum <= lastDay.getDate();
    const ds = inMonth
      ? `${viewYear}-${pad(viewMonth + 1)}-${pad(dayNum)}`
      : null;
    const isToday = ds === T;
    const isSelected = ds === selectedDate;
    const events = ds ? getVisibleEvents(ds) : [];
    const dots = [...new Set(events.map(e => e.color))].slice(0, 4);

    html += `<div class="cal-day${!inMonth ? ' other-month' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}"
      ${ds ? `onclick="selectDay('${ds}')"` : ''}>
      <div class="cal-day-num">${inMonth ? dayNum : ''}</div>
      ${dots.length ? `<div class="cal-dots">${dots.map(c => `<div class="cal-dot" style="background:${c}"></div>`).join('')}</div>` : ''}
    </div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;
}

// ── Shared color palette ──────────────────────────────────────────────────────
const EVENT_COLORS = [
  { val: '#2563EB', label: 'Blue' },
  { val: '#0F9D58', label: 'Green' },
  { val: '#7C3AED', label: 'Purple' },
  { val: '#DC2626', label: 'Red' },
  { val: '#EA580C', label: 'Orange' },
  { val: '#EAB308', label: 'Yellow' },
  { val: '#0891B2', label: 'Teal' },
  { val: '#F9A8D4', label: 'Flamingo' },
  { val: '#DB2777', label: 'Pink' },
  { val: '#65A30D', label: 'Lime' },
  { val: '#854D0E', label: 'Brown' },
  { val: '#475569', label: 'Slate' },
];

// ── Week grid (Google Calendar style, proportional blocks) ───────────────────
const WEEK_HOUR_START = 5;  // 5am
const WEEK_HOUR_END   = 23; // 11pm
const HOUR_HEIGHT_PX  = 56; // px per hour
const TOTAL_HEIGHT    = (WEEK_HOUR_END - WEEK_HOUR_START) * HOUR_HEIGHT_PX;
const SNAP_MINS       = 15; // snap to 15-minute increments

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToPct(mins) {
  const startMins = WEEK_HOUR_START * 60;
  const totalMins = (WEEK_HOUR_END - WEEK_HOUR_START) * 60;
  return Math.max(0, Math.min(100, (mins - startMins) / totalMins * 100));
}

function minsToTimeStr(mins) {
  // Returns 24hr HH:MM — used for <input type="time"> values and Supabase saves
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad(h)}:${pad(m)}`;
}

function fmt12(timeStr) {
  // Convert HH:MM to 12-hour display (e.g. "14:30" → "2:30pm", "08:00" → "8am")
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${pad(m)}${suffix}`;
}

function fmt12Range(start, end) {
  if (!start) return '';
  return end ? `${fmt12(start)}–${fmt12(end)}` : fmt12(start);
}

function snapMins(mins) {
  return Math.round(mins / SNAP_MINS) * SNAP_MINS;
}

function pxToMins(px) {
  // Convert px offset within the time grid body to minutes from midnight
  return WEEK_HOUR_START * 60 + (px / TOTAL_HEIGHT) * (WEEK_HOUR_END - WEEK_HOUR_START) * 60;
}

// ── Drag state ────────────────────────────────────────────────────────────────
let dragState = null;
let lastDragEnd = 0; // timestamp of last completed drag, to suppress click
let _dragListenersAttached = false; // global listeners attached once only

// ── Undo stack ────────────────────────────────────────────────────────────────
const undoStack = []; // each entry: { type, data } — max 20 entries
const MAX_UNDO = 20;

function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  updateUndoBtn();
}

function updateUndoBtn() {
  const btn = document.getElementById('cal-undo-btn');
  if (btn) {
    btn.style.opacity = undoStack.length > 0 ? '1' : '0.35';
    btn.disabled = undoStack.length === 0;
  }
}

window.calUndo = async () => {
  if (!undoStack.length) return;
  const entry = undoStack.pop();
  updateUndoBtn();

  if (entry.type === 'create') {
    // Undo: delete the created event(s)
    for (const id of entry.ids) {
      await supabase.from('calendar_events').delete().eq('id', id);
    }
    toast('Undo: event deleted ↩', 'success');
    render();
  } else if (entry.type === 'move' || entry.type === 'resize') {
    // Undo: restore old time
    const startISO = `${entry.oldDate}T${entry.oldStart}:00+00:00`;
    const endISO   = entry.oldEnd ? `${entry.oldDate}T${entry.oldEnd}:00+00:00` : null;
    await supabase.from('calendar_events').update({
      start_time: startISO, end_time: endISO,
    }).eq('id', entry.id);
    toast('Undo: time restored ↩', 'success');
    render();
  } else if (entry.type === 'delete') {
    // Undo: re-insert the deleted event
    await supabase.from('calendar_events').insert(entry.row);
    toast('Undo: event restored ↩', 'success');
    render();
  }
};

// Cmd+Z / Ctrl+Z keyboard shortcut
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    calUndo();
  }
});

function renderDayGrid() {
  document.getElementById('cal-day-labels').style.display = 'none';
  const gridEl = document.getElementById('cal-grid');
  gridEl.style.display = 'block';
  gridEl.style.gridTemplateColumns = '';

  const ds = dateStr(viewDay);
  const dayLabel = viewDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('period-label').textContent = dayLabel;

  const hours = [];
  for (let h = WEEK_HOUR_START; h < WEEK_HOUR_END; h++) {
    const label = h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
    hours.push(label);
  }

  const gutterW = 36;
  const isToday = ds === T;
  const timedEvents = getVisibleEvents(ds).filter(e => e.timeStart);
  const allDayEvents = getVisibleEvents(ds).filter(e => !e.timeStart);

  let html = `<div class="week-gcal-wrap" style="overflow-x:auto">
  <div class="week-gcal" style="min-width:300px">`;

  // All-day section — always show so user can click to add
  html += `<div class="wgcal-allday" style="display:flex;align-items:flex-start;border-bottom:1px solid var(--gray-100);min-height:28px">
      <div style="width:${gutterW}px;flex-shrink:0;font-size:10px;color:var(--gray-400);padding-top:6px;text-align:right;padding-right:4px">all-day</div>
      <div class="wgcal-allday-cell" data-date="${ds}" style="flex:1;padding:2px;min-height:28px;cursor:pointer;" title="Click to add all-day event">`;
  for (const e of allDayEvents) {
    html += `<a href="${e.link}" onclick="event.stopPropagation()" class="week-event" style="background:${e.color};display:block;border-radius:3px;padding:1px 4px;font-size:10px;font-weight:500;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;text-decoration:none">${e.title}</a>`;
  }
  html += `</div></div>`;

  html += `<div id="wgcal-body" style="display:flex;overflow-y:auto;max-height:${TOTAL_HEIGHT + 20}px">
      <div style="width:${gutterW}px;flex-shrink:0;position:relative;height:${TOTAL_HEIGHT}px">`;

  for (let i = 0; i < hours.length; i++) {
    html += `<div style="position:absolute;top:${i * HOUR_HEIGHT_PX - 8}px;right:4px;font-size:10px;color:var(--gray-400);white-space:nowrap">${hours[i]}</div>`;
  }

  html += `</div><!-- /gutter -->
      <div id="wgcal-daycols" style="flex:1;display:flex;position:relative">
        <div style="position:absolute;inset:0;pointer-events:none">`;
  for (let i = 0; i < hours.length; i++) {
    html += `<div style="position:absolute;left:0;right:0;top:${i * HOUR_HEIGHT_PX}px;border-top:1px solid var(--gray-100)"></div>`;
  }
  html += `</div>`;

  html += `<div class="wgcal-day-col" data-date="${ds}" style="flex:1;position:relative;height:${TOTAL_HEIGHT}px;${isToday ? 'background:rgba(37,99,235,0.03)' : ''}">`;

  // Current time indicator (day view)
  if (isToday) {
    const now = new Date();
    const pstTime = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false });
    const [pstH, pstM] = pstTime.split(':').map(Number);
    const nowMins = pstH * 60 + pstM;
    const startMins = WEEK_HOUR_START * 60;
    const endMins = WEEK_HOUR_END * 60;
    if (nowMins >= startMins && nowMins <= endMins) {
      const pct = (nowMins - startMins) / ((WEEK_HOUR_END - WEEK_HOUR_START) * 60) * 100;
      html += `<div id="cal-now-line" data-view="day" style="position:absolute;left:0;right:0;top:${pct}%;height:2px;background:var(--red);z-index:10;pointer-events:none">
        <div style="position:absolute;left:-3px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--red)"></div>
      </div>`;
    }
  }

  for (const e of timedEvents) {
    const startMins = timeToMinutes(e.timeStart);
    const rawEnd = e.timeEnd ? timeToMinutes(e.timeEnd) : startMins + 60;
    const endMins = Math.max(rawEnd, startMins + 30);
    const topPct = minutesToPct(startMins);
    const heightPx = Math.max(20, (endMins - startMins) / 60 * HOUR_HEIGHT_PX);
    const timeLabel = fmt12Range(e.timeStart, e.timeEnd);
    const isEditable = (e.type === 'gcal' && e.id) || (e.type === 'class' && e.classId);
    const cursor = isEditable ? 'grab' : 'pointer';
    const evId = e.id ? `data-ev-id="${e.id}"` : '';
    const classIdAttr = e.classId ? `data-class-id="${e.classId}"` : '';
    const evTypeAttr = `data-ev-type="${e.type}"`;

    const hasNote1 = !!(e.notes);
    const recurAttr1 = e.recurrenceGroupId ? `data-group-id="${e.recurrenceGroupId}" data-recurrence="${e.recurrence || ''}"` : '';
    html += `<div class="wcal-ev${isEditable ? ' wcal-ev-editable' : ''}" ${evId} ${classIdAttr} ${evTypeAttr} ${recurAttr1}
      data-date="${ds}" data-start="${e.timeStart}" data-end="${e.timeEnd || ''}" data-title="${(e.title||'').replace(/"/g,'&quot;')}" data-notes="${(e.notes||'').replace(/"/g,'&quot;')}"
      style="position:absolute;top:${topPct}%;left:2px;right:2px;
        min-height:${heightPx}px;background:${e.color};border-radius:4px;
        padding:2px 5px;font-size:10px;font-weight:600;color:white;
        overflow:hidden;z-index:5;display:block;line-height:1.3;
        cursor:${cursor};user-select:none;box-sizing:border-box"
      title="${e.title} ${timeLabel}">
      ${hasNote1 ? '<div style="position:absolute;top:3px;right:4px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.95);box-shadow:0 0 0 1px rgba(0,0,0,0.15);z-index:2;pointer-events:none"></div>' : ''}
      <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:${hasNote1 ? '10px' : '0'}">${e.title}</div>
      ${heightPx > 28 ? `<div class="wcal-time-lbl" style="font-size:9px;opacity:0.85">${timeLabel}</div>` : ''}
      ${isEditable ? `<div class="wcal-resize-handle" style="position:absolute;bottom:0;left:0;right:0;height:6px;cursor:s-resize;background:rgba(0,0,0,0.15);border-radius:0 0 4px 4px"></div>` : ''}
    </div>`;
  }

  html += `</div><!-- /day col -->
      </div><!-- /day cols -->
    </div><!-- /time grid body -->
  </div><!-- /week-gcal -->
</div><!-- /wrap -->`;

  document.getElementById('cal-grid').innerHTML = html;
  attachWeekInteractions();
  attachSwipeNavigation();
}

function renderWeekGrid() {
  document.getElementById('cal-day-labels').style.display = 'none';
  const gridEl = document.getElementById('cal-grid');
  gridEl.style.display = 'block';
  gridEl.style.gridTemplateColumns = '';

  const weekEnd = addDays(viewWeekStart, 6);
  const startLabel = viewWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('period-label').textContent = `${startLabel} – ${endLabel}`;

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(viewWeekStart, i);
    days.push({ date: d, str: dateStr(d) });
  }

  const hours = [];
  for (let h = WEEK_HOUR_START; h < WEEK_HOUR_END; h++) {
    const label = h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
    hours.push(label);
  }

  const gutterW = 36;

  let html = `<div class="week-gcal-wrap" style="overflow-x:auto">
  <div class="week-gcal" style="min-width:480px">
    <div class="wgcal-header" style="display:flex;padding-left:${gutterW}px;border-bottom:1px solid var(--gray-200)">`;

  for (const { date, str } of days) {
    const isToday = str === T;
    const dayName = DAYS_SHORT[date.getDay()];
    const dayNum = date.getDate();
    html += `<div class="wgcal-day-hdr${isToday ? ' today-col' : ''}" onclick="drillToDay('${str}')" style="flex:1;text-align:center;padding:6px 2px;cursor:pointer;font-size:12px;font-weight:600;color:${isToday ? 'var(--blue)' : 'var(--gray-500)'}"
      title="See day view">
      <div>${dayName}</div>
      <span style="font-size:18px;font-weight:700;display:block;${isToday ? 'background:var(--blue);color:white;border-radius:50%;width:28px;height:28px;line-height:28px;margin:2px auto 0' : 'color:var(--gray-800)'}">${dayNum}</span>
    </div>`;
  }
  html += `</div><!-- /header -->

    <div class="wgcal-allday" style="display:flex;align-items:flex-start;border-bottom:1px solid var(--gray-100);min-height:28px">
      <div style="width:${gutterW}px;flex-shrink:0;font-size:10px;color:var(--gray-400);padding-top:6px;text-align:right;padding-right:4px">all-day</div>`;
  for (const { str } of days) {
    const allDayEvents = getVisibleEvents(str).filter(e => !e.timeStart);
    html += `<div class="wgcal-allday-cell" data-date="${str}" style="flex:1;padding:2px;min-height:28px;cursor:pointer;" title="Click to add all-day event">`;
    for (const e of allDayEvents) {
      html += `<a href="${e.link}" onclick="event.stopPropagation()" class="week-event" style="background:${e.color};display:block;border-radius:3px;padding:1px 4px;font-size:10px;font-weight:500;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;text-decoration:none">${e.title}</a>`;
    }
    html += `</div>`;
  }
  html += `</div><!-- /allday -->

    <div id="wgcal-body" style="display:flex;overflow-y:auto;max-height:${TOTAL_HEIGHT + 20}px">
      <div style="width:${gutterW}px;flex-shrink:0;position:relative;height:${TOTAL_HEIGHT}px">`;

  for (let i = 0; i < hours.length; i++) {
    html += `<div style="position:absolute;top:${i * HOUR_HEIGHT_PX - 8}px;right:4px;font-size:10px;color:var(--gray-400);white-space:nowrap">${hours[i]}</div>`;
  }
  html += `</div><!-- /gutter -->

      <div id="wgcal-daycols" style="flex:1;display:flex;position:relative">
        <div style="position:absolute;inset:0;pointer-events:none">`;
  for (let i = 0; i < hours.length; i++) {
    html += `<div style="position:absolute;left:0;right:0;top:${i * HOUR_HEIGHT_PX}px;border-top:1px solid var(--gray-100)"></div>`;
  }
  html += `</div>`;

  for (let di = 0; di < days.length; di++) {
    const { str } = days[di];
    const isToday = str === T;
    const timedEvents = getVisibleEvents(str).filter(e => e.timeStart);
    html += `<div class="wgcal-day-col" data-date="${str}" style="flex:1;position:relative;height:${TOTAL_HEIGHT}px;border-left:1px solid var(--gray-100);${isToday ? 'background:rgba(37,99,235,0.03)' : ''}">`;

    // Current time indicator (week view)
    if (isToday) {
      const now = new Date();
      const pstTime = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false });
      const [pstH, pstM] = pstTime.split(':').map(Number);
      const nowMins = pstH * 60 + pstM;
      const startMins = WEEK_HOUR_START * 60;
      const endMins = WEEK_HOUR_END * 60;
      if (nowMins >= startMins && nowMins <= endMins) {
        const pct = (nowMins - startMins) / ((WEEK_HOUR_END - WEEK_HOUR_START) * 60) * 100;
        html += `<div id="cal-now-line" data-view="week" style="position:absolute;left:0;right:0;top:${pct}%;height:2px;background:var(--red);z-index:10;pointer-events:none">
          <div style="position:absolute;left:-3px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--red)"></div>
        </div>`;
      }
    }

    for (const e of timedEvents) {
      const startMins = timeToMinutes(e.timeStart);
      const rawEnd = e.timeEnd ? timeToMinutes(e.timeEnd) : startMins + 60;
      const endMins = Math.max(rawEnd, startMins + 30);
      const topPct = minutesToPct(startMins);
      const heightPx = Math.max(20, (endMins - startMins) / 60 * HOUR_HEIGHT_PX);
      const timeLabel = fmt12Range(e.timeStart, e.timeEnd);
      const isEditable = (e.type === 'gcal' && e.id) || (e.type === 'class' && e.classId);
      const cursor = isEditable ? 'grab' : 'pointer';
      const evId = e.id ? `data-ev-id="${e.id}"` : '';
      const classIdAttr = e.classId ? `data-class-id="${e.classId}"` : '';
      const evTypeAttr = `data-ev-type="${e.type}"`;

      const hasNote2 = !!(e.notes);
      const recurAttr2 = e.recurrenceGroupId ? `data-group-id="${e.recurrenceGroupId}" data-recurrence="${e.recurrence || ''}"` : '';
      html += `<div class="wcal-ev${isEditable ? ' wcal-ev-editable' : ''}" ${evId} ${classIdAttr} ${evTypeAttr} ${recurAttr2}
        data-date="${str}" data-start="${e.timeStart}" data-end="${e.timeEnd || ''}" data-title="${(e.title||'').replace(/"/g,'&quot;')}" data-notes="${(e.notes||'').replace(/"/g,'&quot;')}"
        style="position:absolute;top:${topPct}%;left:2px;right:2px;
          min-height:${heightPx}px;background:${e.color};border-radius:4px;
          padding:2px 5px;font-size:10px;font-weight:600;color:white;
          overflow:hidden;z-index:5;display:block;line-height:1.3;
          cursor:${cursor};user-select:none;box-sizing:border-box"
        title="${e.title} ${timeLabel}">
        ${hasNote2 ? '<div style="position:absolute;top:3px;right:4px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.95);box-shadow:0 0 0 1px rgba(0,0,0,0.15);z-index:2;pointer-events:none"></div>' : ''}
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:${hasNote2 ? '10px' : '0'}">${e.title}</div>
        ${heightPx > 28 ? `<div class="wcal-time-lbl" style="font-size:9px;opacity:0.85">${timeLabel}</div>` : ''}
        ${isEditable ? `<div class="wcal-resize-handle" style="position:absolute;bottom:0;left:0;right:0;height:6px;cursor:s-resize;background:rgba(0,0,0,0.15);border-radius:0 0 4px 4px"></div>` : ''}
      </div>`;
    }

    html += `</div>`;
  }

  html += `</div><!-- /day cols -->
    </div><!-- /time grid body -->
  </div><!-- /week-gcal -->
</div><!-- /wrap -->`;

  document.getElementById('cal-grid').innerHTML = html;

  // Attach interaction listeners after DOM is rendered
  attachWeekInteractions();
  attachSwipeNavigation();
}


// ── Shared drag helpers (module-level, persist across re-renders) ─────────────
function _getXY(e) {
  if (e.touches && e.touches.length > 0)               return { x: e.touches[0].clientX,        y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches.length > 0) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function _yToMins(colEl, clientY) {
  const rect = colEl.getBoundingClientRect();
  const py   = Math.max(0, Math.min(TOTAL_HEIGHT, clientY - rect.top));
  return snapMins(Math.round(pxToMins(py)));
}

function _colAtX(clientX) {
  let found = null;
  document.querySelectorAll('.wgcal-day-col').forEach(col => {
    const r = col.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) found = col;
  });
  return found;
}

function _handleDragMove(e) {
  if (!dragState) return;
  if (e.cancelable) e.preventDefault();
  const { x, y } = _getXY(e);

  if (dragState.type === 'create') {
    const m = _yToMins(dragState.col, y);
    if (m > dragState.anchorM) { dragState.startM = dragState.anchorM; dragState.endM = m; }
    else                        { dragState.startM = m;                dragState.endM = dragState.anchorM; }
    dragState.endM = Math.max(dragState.startM + SNAP_MINS, dragState.endM);
    updateGhostBlock(dragState.ghost, dragState.startM, dragState.endM);
  }

  if (dragState.type === 'resize') {
    const m = _yToMins(dragState.col, y);
    dragState.endM = Math.max(dragState.startM + SNAP_MINS, m);
    const heightPx = Math.max(20, (dragState.endM - dragState.startM) / 60 * HOUR_HEIGHT_PX);
    dragState.evEl.style.minHeight = heightPx + 'px';
    dragState.evEl.style.height    = heightPx + 'px';
    const liveStr = `${fmt12(minsToTimeStr(dragState.startM))}–${fmt12(minsToTimeStr(dragState.endM))}`;
    const tl = dragState.evEl.querySelector('.wcal-time-lbl');
    if (tl) tl.textContent = liveStr;
  }

  if (dragState.type === 'move') {
    const targetCol = _colAtX(x);
    if (!targetCol) return;
    dragState.startM = Math.max(WEEK_HOUR_START * 60, _yToMins(targetCol, y) - dragState.offsetM);
    dragState.endM   = dragState.startM + dragState.duration;
    dragState.col    = targetCol;
    dragState.evDate = targetCol.dataset.date;

    // Move the floating ghost to follow cursor across columns
    const colRect  = targetCol.getBoundingClientRect();
    const topPx    = colRect.top + (dragState.startM - WEEK_HOUR_START * 60) / ((WEEK_HOUR_END - WEEK_HOUR_START) * 60) * TOTAL_HEIGHT;
    const heightPx = Math.max(20, dragState.duration / 60 * HOUR_HEIGHT_PX);
    dragState.ghost.style.left   = (colRect.left + 2) + 'px';
    dragState.ghost.style.top    = topPx + 'px';
    dragState.ghost.style.width  = (colRect.width - 4) + 'px';
    dragState.ghost.style.height = heightPx + 'px';

    const liveStr = `${fmt12(minsToTimeStr(dragState.startM))}–${fmt12(minsToTimeStr(dragState.endM))}`;
    const tl = dragState.ghost.querySelector('.wcal-time-lbl');
    if (tl) tl.textContent = liveStr;
  }
}

async function _handleDragUp(e) {
  if (!dragState) return;
  const ds = dragState;
  dragState = null;

  if (ds.type === 'create') {
    ds.ghost.remove();
    if (ds.endM - ds.startM < SNAP_MINS) return;
    openCreateModal(ds.dateStr, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM));
  }

  if (ds.type === 'resize') {
    ds.evEl.style.cursor = '';
    lastDragEnd = Date.now();
    if (ds.evType === 'class' && ds.classId) {
      saveClassTime(ds.classId, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM));
    } else if (ds.groupId) {
      // Recurring event resize — ask scope
      const scope = await openMoveScopeModal('resize');
      if (!scope) {
        // Cancelled — restore original visual state
        render();
        return;
      }
      saveEventTime(ds.evId, ds.evDate, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM),
        ds.origDate, ds.origStart, ds.origEnd, 'resize', scope, ds.groupId);
    } else {
      saveEventTime(ds.evId, ds.evDate, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM),
        ds.origDate, ds.origStart, ds.origEnd, 'resize');
    }
  }

  if (ds.type === 'move') {
    ds.ghost.remove();
    ds.evEl.style.opacity = '';
    ds.evEl.style.cursor  = 'grab';
    lastDragEnd = Date.now();
    if (ds.evType === 'class' && ds.classId) {
      saveClassTime(ds.classId, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM));
    } else if (ds.groupId) {
      // Recurring event move — ask scope
      const scope = await openMoveScopeModal('move');
      if (!scope) {
        // Cancelled — restore original visual state
        render();
        return;
      }
      saveEventTime(ds.evId, ds.evDate, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM),
        ds.origDate, ds.origStart, ds.origEnd, 'move', scope, ds.groupId);
    } else {
      saveEventTime(ds.evId, ds.evDate, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM),
        ds.origDate, ds.origStart, ds.origEnd, 'move');
    }
  }
}

// ── Move/Resize scope modal for recurring events ──────────────────────────────
function openMoveScopeModal(action) {
  const verb = action === 'resize' ? 'resize' : 'move';
  const verbLabel = action === 'resize' ? 'Resize' : 'Move';
  return new Promise((resolve) => {
    removeModal();
    const modal = document.createElement('div');
    modal.id = 'cal-ev-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:500;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:var(--white);border-radius:12px;padding:20px;width:90%;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
        <div style="font-size:15px;font-weight:700;color:var(--gray-800);margin-bottom:6px">${verbLabel} recurring event</div>
        <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px">Which events do you want to ${verb}?</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button id="mv-scope-this" style="padding:10px 14px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:13px;font-weight:600;color:var(--gray-700);cursor:pointer;text-align:left">
            🗂 This event only
          </button>
          <button id="mv-scope-following" style="padding:10px 14px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:13px;font-weight:600;color:var(--gray-700);cursor:pointer;text-align:left">
            ⏩ This and all following
          </button>
          <button id="mv-scope-all" style="padding:10px 14px;border:1.5px solid var(--blue,#2563EB);border-radius:8px;background:#EFF6FF;font-size:13px;font-weight:600;color:var(--blue,#2563EB);cursor:pointer;text-align:left">
            📆 All events in series
          </button>
          <button id="mv-scope-cancel" style="padding:8px 14px;border:none;border-radius:8px;background:transparent;font-size:13px;color:var(--gray-400);cursor:pointer">
            Cancel
          </button>
        </div>
      </div>`;
    modal.addEventListener('click', () => { modal.remove(); resolve(null); });
    document.body.appendChild(modal);
    document.getElementById('mv-scope-cancel').addEventListener('click', (e) => { e.stopPropagation(); modal.remove(); resolve(null); });
    document.getElementById('mv-scope-this').addEventListener('click', (e) => { e.stopPropagation(); modal.remove(); resolve('this'); });
    document.getElementById('mv-scope-following').addEventListener('click', (e) => { e.stopPropagation(); modal.remove(); resolve('following'); });
    document.getElementById('mv-scope-all').addEventListener('click', (e) => { e.stopPropagation(); modal.remove(); resolve('all'); });
  });
}

// Attach global drag listeners once — they stay alive permanently across re-renders
function _ensureGlobalDragListeners() {
  if (_dragListenersAttached) return;
  _dragListenersAttached = true;
  document.addEventListener('mousemove',   _handleDragMove);
  document.addEventListener('mouseup',     _handleDragUp);
  document.addEventListener('touchmove',   _handleDragMove, { passive: false });
  document.addEventListener('touchend',    _handleDragUp);
  document.addEventListener('touchcancel', _handleDragUp);
  // Safety net: if the window loses focus mid-drag, cancel cleanly so events don't vanish
  window.addEventListener('blur', _cancelDragSafely);
  document.addEventListener('visibilitychange', () => { if (document.hidden) _cancelDragSafely(); });
}

function _cancelDragSafely() {
  if (!dragState) return;
  const ds = dragState;
  dragState = null;
  // Restore hidden original event element
  if (ds.evEl) { ds.evEl.style.opacity = ''; ds.evEl.style.cursor = 'grab'; }
  // Remove any floating ghost
  if (ds.ghost && ds.ghost.parentNode) ds.ghost.remove();
}

// ── Week view interactions ────────────────────────────────────────────────────
function attachWeekInteractions() {
  _ensureGlobalDragListeners();

  // ── All-day row cells → click to add all-day event ─────────────────────────
  document.querySelectorAll('.wgcal-allday-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // don't intercept existing event links
      openCreateModal(cell.dataset.date, '09:00', '10:00', true);
    });
  });

  const dayCols = document.querySelectorAll('.wgcal-day-col');

  let touchHoldTimer = null;
  let touchStartInfo = null;

  dayCols.forEach(col => {
    const colDateStr = col.dataset.date;

    // ── Mousedown on column background → create event ─────────────────────
    col.addEventListener('mousedown', (e) => {
      if (e.target !== col) return;
      e.preventDefault();
      const startM = _yToMins(col, e.clientY);
      const endM   = startM + 60;
      const ghost  = createGhostBlock(col, startM, endM, colDateStr);
      dragState = { type: 'create', col, dateStr: colDateStr, startM, endM, anchorM: startM, ghost };
    });

    // ── Touchstart on column background → long-press to create ────────────
    col.addEventListener('touchstart', (e) => {
      if (e.target !== col) return;
      const { x, y } = _getXY(e);
      touchStartInfo = { col, dateStr: colDateStr, x, y };
      touchHoldTimer = setTimeout(() => {
        const startM = _yToMins(col, touchStartInfo.y);
        const endM   = startM + 60;
        const ghost  = createGhostBlock(col, startM, endM, colDateStr);
        dragState = { type: 'create', col, dateStr: colDateStr, startM, endM, anchorM: startM, ghost };
      }, 500);
    }, { passive: true });

    col.addEventListener('touchmove',  () => { if (touchHoldTimer) { clearTimeout(touchHoldTimer); touchHoldTimer = null; } }, { passive: true });
    col.addEventListener('touchend',   () => { if (touchHoldTimer) { clearTimeout(touchHoldTimer); touchHoldTimer = null; } }, { passive: true });

    // ── Mousedown / Touchstart on editable events ──────────────────────────
    col.querySelectorAll('.wcal-ev-editable').forEach(evEl => {
      const evId    = evEl.dataset.evId;
      const classId = evEl.dataset.classId;
      const evType  = evEl.dataset.evType;
      const groupId = evEl.dataset.groupId || null;

      const resizeHandle = evEl.querySelector('.wcal-resize-handle');

      function startResize(e) {
        e.preventDefault();
        e.stopPropagation();
        // Read live dataset values — may have changed after prior drag
        const evStart = evEl.dataset.start;
        const evEnd   = evEl.dataset.end;
        const evDate  = evEl.dataset.date || colDateStr;
        dragState = {
          type: 'resize',
          evEl, evId, classId, evType, evDate,
          groupId,
          startM:   timeToMinutes(evStart),
          endM:     timeToMinutes(evEnd) || timeToMinutes(evStart) + 60,
          col,
          origDate: evDate, origStart: evStart, origEnd: evEnd,
        };
      }

      if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', startResize);
        resizeHandle.addEventListener('touchstart', startResize, { passive: false });
      }

      function startMove(e) {
        if (e.target === resizeHandle) return;
        // Do NOT preventDefault here — that would cancel the subsequent click event.
        // Instead, we use a pending-drag pattern: commit to a drag only after >5px movement.
        e.stopPropagation();

        // Read live dataset values — may have changed after prior drag
        const evStart = evEl.dataset.start;
        const evEnd   = evEl.dataset.end;
        const evDate  = evEl.dataset.date || colDateStr;

        const { x: startX, y: startY } = _getXY(e);
        const clickMins = _yToMins(col, startY);
        const sMins = timeToMinutes(evStart);
        const eMins = timeToMinutes(evEnd) || sMins + 60;

        let dragCommitted = false;

        function commitDrag() {
          if (dragCommitted) return;
          dragCommitted = true;

          const colRect  = col.getBoundingClientRect();
          const heightPx = Math.max(20, (eMins - sMins) / 60 * HOUR_HEIGHT_PX);
          const topPx    = colRect.top + (sMins - WEEK_HOUR_START * 60) / ((WEEK_HOUR_END - WEEK_HOUR_START) * 60) * TOTAL_HEIGHT;
          const evColor  = evEl.style.background || evEl.style.backgroundColor || '#2563EB';
          const liveStr  = `${fmt12(minsToTimeStr(sMins))}–${fmt12(minsToTimeStr(eMins))}`;
          const isRecurring = !!groupId;
          const ghost    = document.createElement('div');
          ghost.style.cssText = `
            position:fixed;z-index:9999;pointer-events:none;box-sizing:border-box;
            left:${colRect.left + 2}px;top:${topPx}px;
            width:${colRect.width - 4}px;height:${heightPx}px;
            background:${evColor};border-radius:4px;
            padding:2px 5px;font-size:10px;font-weight:600;color:white;
            opacity:0.88;box-shadow:0 4px 18px rgba(0,0,0,0.28);
            transition:none;
          `;
          ghost.innerHTML = `
            <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${evEl.dataset.title || ''}${isRecurring ? ' <span style="opacity:0.8;font-size:8px">🔁</span>' : ''}</div>
            <div class="wcal-time-lbl" style="font-size:9px;opacity:0.9">${liveStr}</div>
          `;
          document.body.appendChild(ghost);

          // Hide original during drag
          evEl.style.opacity = '0';
          evEl.style.cursor  = 'grabbing';

          dragState = {
            type: 'move',
            evEl, evId, classId, evType, evDate,
            groupId,
            startM:   sMins,
            endM:     eMins,
            duration: eMins - sMins,
            offsetM:  clickMins - sMins,
            col,
            ghost,
            origDate: evDate, origStart: evStart, origEnd: evEnd,
          };
        }

        function onPendingMove(ev) {
          const { x, y } = _getXY(ev);
          const dist = Math.hypot(x - startX, y - startY);
          if (dist > 5) {
            document.removeEventListener('mousemove', onPendingMove);
            document.removeEventListener('mouseup',   onPendingCancel);
            document.removeEventListener('touchmove', onPendingMove);
            document.removeEventListener('touchend',  onPendingCancel);
            commitDrag();
          }
        }

        function onPendingCancel() {
          document.removeEventListener('mousemove', onPendingMove);
          document.removeEventListener('mouseup',   onPendingCancel);
          document.removeEventListener('touchmove', onPendingMove);
          document.removeEventListener('touchend',  onPendingCancel);
        }

        document.addEventListener('mousemove', onPendingMove);
        document.addEventListener('mouseup',   onPendingCancel);
        document.addEventListener('touchmove', onPendingMove, { passive: true });
        document.addEventListener('touchend',  onPendingCancel);
      }

      evEl.addEventListener('mousedown', startMove);
      evEl.addEventListener('touchstart', startMove, { passive: false });

      // Click (no drag) → open detail popup
      evEl.addEventListener('click', (e) => {
        if (Date.now() - lastDragEnd < 400) return;
        e.stopPropagation();
        const evStart = evEl.dataset.start;
        const evEnd   = evEl.dataset.end;
        const evDate  = evEl.dataset.date || colDateStr;
        if (evType === 'gcal') {
          openEventPopup(evId, evStart, evEnd, evEl.dataset.title || evEl.title, evDate, evEl, evEl.dataset.notes || '', evEl.dataset.recurrence || null);
        } else if (evType === 'class' && classId) {
          const className = evEl.dataset.title || evEl.title;
          openClassEditModal(classId, className, evStart, evEnd, evDate);
        }
      });

    });
  });
}
function attachSwipeNavigation() {
  const wrap = document.querySelector('.week-gcal-wrap');
  if (!wrap) return;

  let swipeStartX = null;
  let swipeStartY = null;
  const SWIPE_THRESHOLD = 60; // px

  wrap.addEventListener('touchstart', (e) => {
    if (dragState) return; // don't interfere with a drag in progress
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
  }, { passive: true });

  wrap.addEventListener('touchend', (e) => {
    if (swipeStartX === null || dragState) { swipeStartX = null; return; }
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    swipeStartX = null;
    swipeStartY = null;
    // Only count as a swipe if horizontal movement is dominant and big enough
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) window.next();   // swipe left → next week
      else         window.prev();  // swipe right → prev week
    }
  }, { passive: true });

  wrap.addEventListener('touchcancel', () => { swipeStartX = null; }, { passive: true });
}

function createGhostBlock(col, startM, endM, dateStr) {
  const ghost = document.createElement('div');
  ghost.className = 'wcal-ghost';
  ghost.style.cssText = `
    position:absolute;left:2px;right:2px;z-index:20;
    background:rgba(37,99,235,0.25);border:2px dashed var(--blue);
    border-radius:4px;pointer-events:none;box-sizing:border-box;
    font-size:10px;color:var(--blue);font-weight:600;padding:2px 5px;
  `;
  updateGhostBlock(ghost, startM, endM);
  col.appendChild(ghost);
  return ghost;
}

function updateGhostBlock(ghost, startM, endM) {
  const topPct = minutesToPct(startM);
  const heightPx = Math.max(20, (endM - startM) / 60 * HOUR_HEIGHT_PX);
  ghost.style.top = topPct + '%';
  ghost.style.minHeight = heightPx + 'px';
  ghost.textContent = `${fmt12(minsToTimeStr(startM))}–${fmt12(minsToTimeStr(endM))}`;
}

// ── Save event time to Supabase ───────────────────────────────────────────────
// scope: 'this' | 'following' | 'all' | undefined (for non-recurring)
// groupId: recurrence_group_id if recurring
async function saveEventTime(id, dateStr, startTime, endTime, oldDate, oldStart, oldEnd, undoType, scope, groupId) {
  if (!id) return;
  // Push undo entry before saving (single-event undo)
  if (oldStart) {
    pushUndo({ type: undoType || 'move', id, oldDate: oldDate || dateStr, oldStart, oldEnd });
  }
  const startISO = `${dateStr}T${startTime}:00+00:00`;
  const endISO   = `${dateStr}T${endTime}:00+00:00`;

  // ── scope === 'all' — update TIME on ALL events in the group ──────────────
  // We can't do a single bulk UPDATE with per-row date-keeping via REST API,
  // so we store only the time portion in two helper columns and reconstruct.
  // FAST PATH: fetch all rows, batch-update times keeping each row's own date.
  if (scope === 'all' && groupId) {
    const { data: groupRows, error: fetchErr } = await supabase
      .from('calendar_events').select('id, start_time').eq('recurrence_group_id', groupId);
    if (fetchErr) { toast('Save failed: ' + fetchErr.message, 'error'); return; }
    // Build upsert array — each row keeps its date, only time changes
    const upserts = (groupRows || []).map(row => ({
      id: row.id,
      start_time: `${(row.start_time || startISO).slice(0, 10)}T${startTime}:00+00:00`,
      end_time:   `${(row.start_time || startISO).slice(0, 10)}T${endTime}:00+00:00`,
    }));
    const { error: upErr } = await supabase.from('calendar_events').upsert(upserts, { onConflict: 'id' });
    if (upErr) { toast('Save failed: ' + upErr.message, 'error'); return; }
    toast('All events in series updated ✅', 'success');
    render();
    return;
  }

  // ── scope === 'following' — update time on this event and all after it ─────
  if (scope === 'following' && groupId) {
    const fromDate = `${oldDate || dateStr}T00:00:00+00:00`;
    const { data: groupRows, error: fetchErr } = await supabase
      .from('calendar_events').select('id, start_time')
      .eq('recurrence_group_id', groupId)
      .gte('start_time', fromDate);
    if (fetchErr) { toast('Save failed: ' + fetchErr.message, 'error'); return; }
    const upserts = (groupRows || []).map(row => ({
      id: row.id,
      start_time: `${(row.start_time || startISO).slice(0, 10)}T${startTime}:00+00:00`,
      end_time:   `${(row.start_time || startISO).slice(0, 10)}T${endTime}:00+00:00`,
    }));
    const { error: upErr } = await supabase.from('calendar_events').upsert(upserts, { onConflict: 'id' });
    if (upErr) { toast('Save failed: ' + upErr.message, 'error'); return; }
    toast('This and all following events updated ✅', 'success');
    render();
    return;
  }

  // ── scope === 'this' or non-recurring — single event update ───────────────
  const { error } = await supabase.from('calendar_events').update({
    start_time: startISO,
    end_time: endISO,
  }).eq('id', id);
  if (error) { toast('Save failed: ' + error.message, 'error'); }
  else { render(); }
}

// ── Save CLASS time to Supabase (updates recurring schedule globally) ─────────
async function saveClassTime(classId, startTime, endTime) {
  if (!classId) return;
  const { error } = await supabase.from('classes').update({
    time_start: startTime + ':00',
    time_end:   endTime + ':00',
  }).eq('id', classId);
  if (error) { toast('Class save failed: ' + error.message, 'error'); }
  else {
    toast('Class time updated ✅ (all recurring days updated)', 'success');
    render();
  }
}

// ── Class edit modal (edit time, today's note; navigate to class page) ────────
function openClassEditModal(classId, className, startTime, endTime, evDate) {
  removeModal();

  // Get current note from our in-memory cache
  const existingNote = (window._classDateNotes?.[classId]?.[evDate]) || '';

  const modal = document.createElement('div');
  modal.id = 'cal-ev-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:500;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--white);border-radius:12px;padding:20px;width:90%;max-width:380px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div style="width:10px;height:10px;border-radius:50%;background:#2563EB;flex-shrink:0"></div>
        <div style="font-size:16px;font-weight:700">${className}</div>
      </div>
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:14px">Recurring class · time changes apply to all days</div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <div style="flex:1">
          <label style="font-size:11px;color:var(--gray-400);margin-bottom:3px;display:block">Start</label>
          <input id="cem-start" type="time" value="${startTime || ''}"
            style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:8px 10px;font-size:14px;outline:none;box-sizing:border-box"
            onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'" />
        </div>
        <div style="flex:1">
          <label style="font-size:11px;color:var(--gray-400);margin-bottom:3px;display:block">End</label>
          <input id="cem-end" type="time" value="${endTime || ''}"
            style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:8px 10px;font-size:14px;outline:none;box-sizing:border-box"
            onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'" />
        </div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:11px;color:var(--gray-400);margin-bottom:4px;display:flex;align-items:center;gap:5px">
          📝 Today's Notes <span style="font-size:10px;color:var(--gray-300)">(synced with class page)</span>
        </label>
        <textarea id="cem-note" rows="4" placeholder="Notes for this class on this day…"
          style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:13px;resize:vertical;line-height:1.5;outline:none;box-sizing:border-box;font-family:inherit"
          onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'">${existingNote.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
        <div id="cem-note-status" style="font-size:11px;color:var(--gray-400);text-align:right;min-height:14px;margin-top:2px"></div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="cem-goto-btn"
          style="flex:1;padding:10px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:13px;font-weight:600;color:var(--gray-700);cursor:pointer">
          📋 Open Class
        </button>
        <button id="cem-save-btn"
          style="flex:2;padding:10px;border:none;border-radius:8px;background:var(--blue);color:white;font-size:14px;font-weight:700;cursor:pointer">
          Save Time
        </button>
      </div>
    </div>
  `;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);

  // ── Note auto-save ──
  let _cemNoteSavedValue = existingNote;
  let _cemNoteTimer = null;
  const noteArea = document.getElementById('cem-note');
  const noteStatus = document.getElementById('cem-note-status');

  async function saveCemNote() {
    if (!noteArea || !evDate) return;
    const note = noteArea.value;
    if (note === _cemNoteSavedValue) { if (noteStatus) noteStatus.textContent = ''; return; }
    if (noteStatus) noteStatus.textContent = 'Saving…';
    const { error } = await supabase
      .from('class_daily_notes')
      .upsert({ class_id: Number(classId), date: evDate, note, updated_at: new Date().toISOString() },
              { onConflict: 'class_id,date' });
    if (error) { if (noteStatus) noteStatus.textContent = '⚠️ Error'; return; }
    _cemNoteSavedValue = note;
    // Update in-memory cache so blue dot appears immediately
    if (!window._classDateNotes) window._classDateNotes = {};
    if (!window._classDateNotes[classId]) window._classDateNotes[classId] = {};
    if (note) {
      window._classDateNotes[classId][evDate] = note;
    } else {
      delete window._classDateNotes[classId][evDate];
    }
    if (noteStatus) { noteStatus.textContent = 'Saved ✓'; setTimeout(() => { if (noteStatus) noteStatus.textContent = ''; }, 1500); }
    render();
  }

  if (noteArea) {
    noteArea.addEventListener('input', () => {
      clearTimeout(_cemNoteTimer);
      if (noteStatus) noteStatus.textContent = 'Unsaved…';
      _cemNoteTimer = setTimeout(saveCemNote, 900);
    });
    noteArea.addEventListener('blur', () => { clearTimeout(_cemNoteTimer); saveCemNote(); });
  }

  document.getElementById('cem-goto-btn').addEventListener('click', () => {
    modal.remove();
    window.location.href = `class.html?id=${classId}${evDate ? '&date=' + evDate : ''}`;
  });

  document.getElementById('cem-save-btn').addEventListener('click', async () => {
    const start = document.getElementById('cem-start').value;
    const end   = document.getElementById('cem-end').value;
    if (!start) { document.getElementById('cem-start').focus(); return; }
    const btn = document.getElementById('cem-save-btn');
    if (btn) btn.disabled = true;
    clearTimeout(_cemNoteTimer);
    await saveCemNote();
    await saveClassTime(classId, start, end);
    modal.remove();
  });
}

// ── Create event modal (with recurrence) ──────────────────────────────────────
function openCreateModal(dateStr, startTime, endTime, allDay = false) {
  removeModal();
  const d = new Date(dateStr + 'T00:00:00');
  const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const modal = document.createElement('div');
  modal.id = 'cal-ev-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:500;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--white);border-radius:12px;padding:20px;width:90%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
      <div style="font-size:16px;font-weight:700;margin-bottom:4px">New Event</div>
      <div style="font-size:13px;color:var(--gray-400);margin-bottom:14px">${dayLabel}</div>
      <input id="cev-title" type="text" placeholder="Event title" autocomplete="off"
        style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:10px;outline:none;box-sizing:border-box"
        onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'" />
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;user-select:none">
        <div id="cev-allday-toggle" style="
          width:36px;height:20px;border-radius:10px;
          background:${allDay ? 'var(--blue)' : 'var(--gray-200)'};
          position:relative;transition:background 0.15s;flex-shrink:0">
          <div id="cev-allday-knob" style="
            position:absolute;top:2px;left:${allDay ? '18px' : '2px'};
            width:16px;height:16px;border-radius:50%;background:white;
            transition:left 0.15s;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></div>
        </div>
        <span style="font-size:13px;color:var(--gray-600)">All day</span>
      </label>
      <div id="cev-time-row" style="display:${allDay ? 'none' : 'flex'};gap:8px;margin-bottom:10px">
        <div style="flex:1">
          <label style="font-size:11px;color:var(--gray-400);margin-bottom:3px;display:block">Start</label>
          <input id="cev-start" type="time" value="${startTime}"
            style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:8px 10px;font-size:14px;outline:none;box-sizing:border-box" />
        </div>
        <div style="flex:1">
          <label style="font-size:11px;color:var(--gray-400);margin-bottom:3px;display:block">End</label>
          <input id="cev-end" type="time" value="${endTime}"
            style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:8px 10px;font-size:14px;outline:none;box-sizing:border-box" />
        </div>
      </div>
      <input type="hidden" id="cev-color" value="#2563EB" />
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--gray-400);margin-bottom:6px;display:block">Color</label>
        <div id="cev-color-swatches" style="display:grid;grid-template-columns:repeat(8,28px);gap:6px;">
          ${EVENT_COLORS.map(c => `<div data-color="${c.val}" title="${c.label}" style="width:28px;height:28px;border-radius:50%;background:${c.val};cursor:pointer;transition:transform 0.1s,box-shadow 0.1s;${c.val==='#2563EB'?'box-shadow:0 0 0 2px var(--white),0 0 0 4px #2563EB;transform:scale(1.15)':''}"></div>`).join('')}
        </div>
      </div>
      <select id="cev-recur" style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:14px;outline:none;box-sizing:border-box;background:var(--white)">
        <option value="none">🔂 Doesn't repeat</option>
        <option value="daily">📅 Daily</option>
        <option value="weekdays">🗓 Weekdays Mon–Fri</option>
        <option value="weekly">📆 Weekly</option>
        <option value="biweekly">📆 Every 2 weeks</option>
        <option value="monthly">🗓 Monthly</option>
      </select>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('cal-ev-modal').remove()"
          style="flex:1;padding:10px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:14px;font-weight:600;color:var(--gray-600);cursor:pointer">
          Cancel
        </button>
        <button id="cev-save-btn"
          style="flex:2;padding:10px;border:none;border-radius:8px;background:var(--blue);color:white;font-size:14px;font-weight:700;cursor:pointer">
          Add Event
        </button>
      </div>
    </div>
  `;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);

  const titleEl = document.getElementById('cev-title');
  titleEl.focus();

  // Wire up all-day toggle
  let isAllDay = allDay;
  document.getElementById('cev-allday-toggle').addEventListener('click', () => {
    isAllDay = !isAllDay;
    const toggle = document.getElementById('cev-allday-toggle');
    const knob = document.getElementById('cev-allday-knob');
    const timeRow = document.getElementById('cev-time-row');
    toggle.style.background = isAllDay ? 'var(--blue)' : 'var(--gray-200)';
    knob.style.left = isAllDay ? '18px' : '2px';
    timeRow.style.display = isAllDay ? 'none' : 'flex';
  });

  // Wire up color swatches for create modal
  _attachSwatchListeners('cev-color-swatches', 'cev-color');

  document.getElementById('cev-save-btn').addEventListener('click', async () => {
    const title = titleEl.value.trim();
    if (!title) { titleEl.focus(); return; }
    const start  = document.getElementById('cev-start').value;
    const end    = document.getElementById('cev-end').value;
    const color  = document.getElementById('cev-color').value;
    const recur  = document.getElementById('cev-recur').value;

    // Build list of dates to create events on
    const dates = buildRecurDates(dateStr, recur);

    const btn = document.getElementById('cev-save-btn');
    if (btn) btn.disabled = true;

    const groupId = recur !== 'none' ? crypto.randomUUID() : null;

    const rows = dates.map(ds => ({
      title,
      start_time: isAllDay ? `${ds}T00:00:00+00:00` : `${ds}T${start}:00+00:00`,
      end_time:   isAllDay ? null : `${ds}T${end}:00+00:00`,
      all_day: isAllDay,
      color,
      calendar_name: 'LifeOS',
      is_busy: !isAllDay,
      recurrence: recur,
      recurrence_group_id: groupId,
    }));

    const { data: insertedRows, error } = await supabase.from('calendar_events').insert(rows).select('id');
    if (error) { toast('Error: ' + error.message, 'error'); if (btn) btn.disabled = false; return; }

    // Push undo entry
    if (insertedRows && insertedRows.length) {
      pushUndo({ type: 'create', ids: insertedRows.map(r => r.id) });
    }
    const countMsg = dates.length > 1 ? `${dates.length} events added ✅` : 'Event added ✅';
    toast(countMsg, 'success');
    modal.remove();
    render();
  });

  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('cev-save-btn').click();
    if (e.key === 'Escape') modal.remove();
  });
}

// ── Build list of dates for recurrence (indefinite = 10 years out) ────────────
function buildRecurDates(startDateStr, recur) {
  const dates = [startDateStr];
  if (recur === 'none') return dates;

  const start = new Date(startDateStr + 'T00:00:00');
  // End date: 10 years from start
  const endDate = new Date(start);
  endDate.setFullYear(endDate.getFullYear() + 10);

  if (recur === 'daily') {
    for (let i = 1; ; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (d > endDate) break;
      dates.push(dateStr(d));
    }
  } else if (recur === 'weekdays') {
    for (let i = 1; ; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (d > endDate) break;
      if (d.getDay() >= 1 && d.getDay() <= 5) {
        dates.push(dateStr(d));
      }
    }
  } else if (recur === 'weekly') {
    for (let i = 1; ; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i * 7);
      if (d > endDate) break;
      dates.push(dateStr(d));
    }
  } else if (recur === 'biweekly') {
    for (let i = 1; ; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i * 14);
      if (d > endDate) break;
      dates.push(dateStr(d));
    }
  } else if (recur === 'monthly') {
    for (let i = 1; ; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      if (d > endDate) break;
      dates.push(dateStr(d));
    }
  }

  return dates;
}

// ── Shared swatch-grid wiring ─────────────────────────────────────────────────
// Attach click + hover handlers to a swatch grid. Updates a hidden input with the chosen color.
function _attachSwatchListeners(gridId, inputId) {
  const grid = document.getElementById(gridId);
  const input = document.getElementById(inputId);
  if (!grid || !input) return;
  grid.querySelectorAll('[data-color]').forEach(sw => {
    sw.addEventListener('mouseenter', () => { sw.style.transform = 'scale(1.2)'; });
    sw.addEventListener('mouseleave', () => {
      sw.style.transform = sw.dataset.color === input.value ? 'scale(1.15)' : 'scale(1)';
    });
    sw.addEventListener('click', () => {
      // Deselect all, select clicked
      grid.querySelectorAll('[data-color]').forEach(s => {
        s.style.boxShadow = 'none';
        s.style.transform = 'scale(1)';
      });
      sw.style.boxShadow = `0 0 0 2px var(--white),0 0 0 4px ${sw.dataset.color}`;
      sw.style.transform = 'scale(1.15)';
      input.value = sw.dataset.color;
    });
  });
}

// ── Event detail popup (title + color swatches + edit + delete) ───────────────
function openEventPopup(id, startTime, endTime, title, evDate, anchorEl, notes = '', recurrence = null) {
  removeModal();
  const rect = anchorEl.getBoundingClientRect();
  const currentColor = anchorEl.style.background || '#2563EB';

  const swatchesHTML = EVENT_COLORS.map(c => {
    const isSel = c.val.toLowerCase() === currentColor.toLowerCase();
    return `<div data-color="${c.val}" title="${c.label}" style="
      width:26px;height:26px;border-radius:50%;background:${c.val};cursor:pointer;flex-shrink:0;
      box-shadow:${isSel ? `0 0 0 2px #fff,0 0 0 4px ${c.val}` : 'none'};
      transform:${isSel ? 'scale(1.18)' : 'scale(1)'};
      transition:transform 0.1s,box-shadow 0.1s;
    "></div>`;
  }).join('');

  const popup = document.createElement('div');
  popup.id = 'cal-ev-modal';
  // Position below event, but keep on screen
  const top  = Math.min(rect.bottom + 6, window.innerHeight - 220);
  const left = Math.min(Math.max(rect.left, 4), window.innerWidth - 228);
  popup.style.cssText = `position:fixed;z-index:600;background:var(--white);border-radius:12px;
    padding:14px 14px 12px;box-shadow:0 8px 28px rgba(0,0,0,0.18);width:220px;
    top:${top}px;left:${left}px;border:1px solid var(--gray-200)`;

  // Notes area — show inline editable textarea or placeholder
  const notesHTML = `
    <div id="ev-notes-wrap" style="margin-bottom:10px">
      <textarea id="ev-notes-area"
        placeholder="Add a note…"
        style="width:100%;min-height:56px;max-height:140px;border:1.5px solid var(--gray-200);border-radius:8px;
          padding:7px 10px;font-size:12px;color:var(--gray-700);resize:vertical;
          outline:none;box-sizing:border-box;font-family:inherit;line-height:1.4;
          background:var(--gray-50,#f9fafb);"
        onfocus="this.style.borderColor='var(--blue)';this.style.background='white'"
        onblur="this.style.borderColor='var(--gray-200)';this.style.background='var(--gray-50,#f9fafb)'"
      >${(notes||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
      <button id="ev-notes-save" style="display:none;margin-top:4px;padding:4px 10px;border:none;border-radius:6px;background:var(--blue);color:white;font-size:11px;font-weight:700;cursor:pointer">Save note</button>
    </div>`;

  const recurLabel = recurrence && recurrence !== 'none' ? {
    daily: '🔁 Repeats daily',
    weekdays: '🔁 Repeats weekdays',
    weekly: '🔁 Repeats weekly',
    biweekly: '🔁 Repeats every 2 weeks',
    monthly: '🔁 Repeats monthly',
  }[recurrence] || null : null;

  popup.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">${title}</div>
    <div style="font-size:11px;color:var(--gray-400);margin-bottom:${recurLabel ? '3px' : '10px'}">${fmt12Range(startTime, endTime)}</div>
    ${recurLabel ? `<div style="font-size:11px;color:var(--blue,#2563EB);margin-bottom:10px;font-weight:500">${recurLabel}</div>` : ''}
    ${notesHTML}
    <div id="ev-color-swatches" style="display:grid;grid-template-columns:repeat(6,26px);gap:7px;margin-bottom:12px">
      ${swatchesHTML}
    </div>
    <div style="display:flex;gap:6px">
      <button id="ev-edit-btn" style="flex:1;padding:7px 0;border:1.5px solid var(--gray-200);border-radius:7px;background:var(--white);font-size:12px;font-weight:600;color:var(--gray-700);cursor:pointer">✏️ Edit</button>
      <button id="ev-del-btn" style="flex:1;padding:7px 0;border:none;border-radius:7px;background:#FEF2F2;font-size:12px;font-weight:600;color:var(--red);cursor:pointer">🗑 Delete</button>
    </div>
  `;
  document.body.appendChild(popup);

  // Wire up color swatches — instant save, no modal close
  let liveColor = currentColor;
  popup.querySelectorAll('[data-color]').forEach(sw => {
    sw.addEventListener('mouseenter', () => { sw.style.transform = 'scale(1.22)'; });
    sw.addEventListener('mouseleave', () => {
      sw.style.transform = sw.dataset.color === liveColor ? 'scale(1.18)' : 'scale(1)';
    });
    sw.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newColor = sw.dataset.color;
      liveColor = newColor;
      // Update ring on swatches
      popup.querySelectorAll('[data-color]').forEach(s => {
        const sel = s.dataset.color === newColor;
        s.style.boxShadow = sel ? `0 0 0 2px #fff,0 0 0 4px ${newColor}` : 'none';
        s.style.transform = sel ? 'scale(1.18)' : 'scale(1)';
      });
      // Optimistic update on the event block itself
      anchorEl.style.background = newColor;
      const { error } = await supabase.from('calendar_events').update({ color: newColor }).eq('id', id);
      if (error) { toast('Color update failed', 'error'); render(); }
    });
  });

  // ── Notes auto-save logic ─────────────────────────────────────────────────
  const notesArea = document.getElementById('ev-notes-area');
  const notesSaveBtn = document.getElementById('ev-notes-save');
  let notesSaveTimer = null;
  let lastSavedNotes = notes || '';

  if (notesArea) {
    notesArea.addEventListener('input', () => {
      notesSaveBtn.style.display = notesArea.value !== lastSavedNotes ? 'inline-block' : 'none';
    });

    const saveNotes = async () => {
      const newNotes = notesArea.value;
      if (newNotes === lastSavedNotes) return;
      notesSaveBtn.textContent = 'Saving…';
      notesSaveBtn.disabled = true;
      const { error } = await supabase.from('calendar_events').update({ notes: newNotes }).eq('id', id);
      if (error) {
        toast('Note save failed', 'error');
        notesSaveBtn.textContent = 'Save note';
        notesSaveBtn.disabled = false;
      } else {
        lastSavedNotes = newNotes;
        notesSaveBtn.style.display = 'none';
        notesSaveBtn.textContent = 'Save note';
        notesSaveBtn.disabled = false;
        // Update the data-notes attr on the event block so next popup open has latest
        if (anchorEl) anchorEl.dataset.notes = newNotes;
        toast('Note saved ✓', 'success');
      }
    };

    notesSaveBtn.addEventListener('click', (e) => { e.stopPropagation(); saveNotes(); });

    // Auto-save on blur (500ms debounce)
    notesArea.addEventListener('blur', () => {
      clearTimeout(notesSaveTimer);
      notesSaveTimer = setTimeout(saveNotes, 300);
    });
  }

  // Close on outside click
  setTimeout(() => document.addEventListener('click', () => removeModal(), { once: true }), 10);
  popup.addEventListener('click', e => e.stopPropagation());

  document.getElementById('ev-del-btn').addEventListener('click', async () => {
    popup.remove();
    // Fetch the row before deleting (for undo / group check)
    const { data: rows } = await supabase.from('calendar_events').select('*').eq('id', id);
    const row = rows && rows[0];
    const grpId = row && row.recurrence_group_id;

    if (grpId) {
      // Recurring event — ask scope with 3-option modal
      await openDeleteScopeModal(id, evDate, grpId, row);
      return;
    }

    const { error } = await supabase.from('calendar_events').delete().eq('id', id);
    if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
    if (row) {
      const { id: _, created_at, ...rowData } = row;
      pushUndo({ type: 'delete', row: rowData });
    }
    toast('Event deleted — Cmd+Z to undo', 'success');
    render();
  });

  document.getElementById('ev-edit-btn').addEventListener('click', async () => {
    popup.remove();
    // Fetch recurrence field before opening edit modal
    const { data: rows } = await supabase.from('calendar_events').select('recurrence, recurrence_group_id, color').eq('id', id);
    const recurrence = (rows && rows[0] && rows[0].recurrence) || 'none';
    const groupId    = (rows && rows[0] && rows[0].recurrence_group_id) || null;
    const color      = (rows && rows[0] && rows[0].color) || '#2563EB';
    // Re-fetch notes (might have been edited inline in popup)
    const currentNotes = anchorEl?.dataset?.notes || notes || '';
    if (groupId) {
      // Recurring event — ask scope before opening edit modal
      const scope = await openEditScopeModal();
      if (!scope) return; // cancelled
      openEditModal(id, title, evDate, startTime, endTime, recurrence, groupId, color, currentNotes, scope);
    } else {
      openEditModal(id, title, evDate, startTime, endTime, recurrence, groupId, color, currentNotes);
    }
  });
}

// ── Edit scope modal — ask "which events to edit?" before opening edit form ────
function openEditScopeModal() {
  return new Promise((resolve) => {
    removeModal();
    const modal = document.createElement('div');
    modal.id = 'cal-ev-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:500;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:var(--white);border-radius:12px;padding:20px;width:90%;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
        <div style="font-size:15px;font-weight:700;color:var(--gray-800);margin-bottom:6px">Edit recurring event</div>
        <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px">Which events do you want to edit?</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button id="edit-scope-this" style="padding:10px 14px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:13px;font-weight:600;color:var(--gray-700);cursor:pointer;text-align:left">
            🗂 This event only
          </button>
          <button id="edit-scope-following" style="padding:10px 14px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:13px;font-weight:600;color:var(--gray-700);cursor:pointer;text-align:left">
            ⏩ This and all following
          </button>
          <button id="edit-scope-all" style="padding:10px 14px;border:1.5px solid var(--blue,#2563EB);border-radius:8px;background:#EFF6FF;font-size:13px;font-weight:600;color:var(--blue,#2563EB);cursor:pointer;text-align:left">
            📆 All events in series
          </button>
          <button id="edit-scope-cancel" style="padding:8px 14px;border:none;border-radius:8px;background:transparent;font-size:13px;color:var(--gray-400);cursor:pointer">
            Cancel
          </button>
        </div>
      </div>`;
    modal.addEventListener('click', () => { modal.remove(); resolve(null); });
    document.body.appendChild(modal);

    document.getElementById('edit-scope-cancel').addEventListener('click', (e) => { e.stopPropagation(); modal.remove(); resolve(null); });
    document.getElementById('edit-scope-this').addEventListener('click', (e) => { e.stopPropagation(); modal.remove(); resolve('this'); });
    document.getElementById('edit-scope-following').addEventListener('click', (e) => { e.stopPropagation(); modal.remove(); resolve('following'); });
    document.getElementById('edit-scope-all').addEventListener('click', (e) => { e.stopPropagation(); modal.remove(); resolve('all'); });
  });
}

function openEditModal(id, title, evDate, startTime, endTime, currentRecur = 'none', groupId = null, currentColor = '#2563EB', currentNotes = '', preSelectedScope = 'this') {
  removeModal();
  const modal = document.createElement('div');
  modal.id = 'cal-ev-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:500;display:flex;align-items:center;justify-content:center';

  const recurOptions = ['none','daily','weekdays','weekly','biweekly','monthly'];
  const recurLabels  = {
    none: '🔂 Doesn\'t repeat',
    daily: '📅 Daily',
    weekdays: '🗓 Weekdays Mon–Fri',
    weekly: '📆 Weekly',
    biweekly: '📆 Every 2 weeks',
    monthly: '🗓 Monthly',
  };
  const recurSelectHTML = recurOptions.map(v =>
    `<option value="${v}"${v === currentRecur ? ' selected' : ''}>${recurLabels[v]}</option>`
  ).join('');

  const colorSwatchesHTML = EVENT_COLORS.map(c => {
    const isSel = c.val.toLowerCase() === (currentColor || '').toLowerCase();
    return `<div data-color="${c.val}" title="${c.label}" style="width:28px;height:28px;border-radius:50%;background:${c.val};cursor:pointer;transition:transform 0.1s,box-shadow 0.1s;${isSel ? `box-shadow:0 0 0 2px var(--white),0 0 0 4px ${c.val};transform:scale(1.15)` : ''}"></div>`;
  }).join('');

  const hasGroup = !!groupId;

  modal.innerHTML = `
    <div style="background:var(--white);border-radius:12px;padding:20px;width:90%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
      <div style="font-size:16px;font-weight:700;margin-bottom:14px">Edit Event</div>
      <input id="eev-title" type="text" value="${title.replace(/"/g, '&quot;')}" autocomplete="off"
        style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:10px;outline:none;box-sizing:border-box"
        onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'" />
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <div style="flex:1">
          <label style="font-size:11px;color:var(--gray-400);margin-bottom:3px;display:block">Start</label>
          <input id="eev-start" type="time" value="${startTime}"
            style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:8px 10px;font-size:14px;outline:none;box-sizing:border-box" />
        </div>
        <div style="flex:1">
          <label style="font-size:11px;color:var(--gray-400);margin-bottom:3px;display:block">End</label>
          <input id="eev-end" type="time" value="${endTime || ''}"
            style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:8px 10px;font-size:14px;outline:none;box-sizing:border-box" />
        </div>
      </div>
      <input type="hidden" id="eev-color" value="${currentColor || '#2563EB'}" />
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--gray-400);margin-bottom:6px;display:block">Color</label>
        <div id="eev-color-swatches" style="display:grid;grid-template-columns:repeat(8,28px);gap:6px;">
          ${colorSwatchesHTML}
        </div>
      </div>
      <select id="eev-recur" style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:${hasGroup ? '6px' : '14px'};outline:none;box-sizing:border-box;background:var(--white)">
        ${recurSelectHTML}
      </select>
      ${hasGroup ? `
      <input type="hidden" id="eev-scope-hidden" value="${preSelectedScope}" />
      <div id="eev-scope-wrap" style="margin-bottom:14px;padding:8px 12px;background:#EFF6FF;border-radius:8px;border:1px solid #BFDBFE;display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">${preSelectedScope === 'this' ? '🗂' : preSelectedScope === 'following' ? '⏩' : '📆'}</span>
        <span style="font-size:12px;color:var(--blue,#2563EB);font-weight:600">${preSelectedScope === 'this' ? 'This event only' : preSelectedScope === 'following' ? 'This and all following' : 'All events in series'}</span>
      </div>` : ''}
      <div style="margin-bottom:14px">
        <label style="font-size:11px;color:var(--gray-400);margin-bottom:6px;display:block">Notes</label>
        <textarea id="eev-notes" placeholder="Add a note…"
          style="width:100%;min-height:64px;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;
            font-size:13px;color:var(--gray-700);resize:vertical;outline:none;box-sizing:border-box;
            font-family:inherit;line-height:1.4;background:var(--gray-50,#f9fafb);"
          onfocus="this.style.borderColor='var(--blue)';this.style.background='white'"
          onblur="this.style.borderColor='var(--gray-200)';this.style.background='var(--gray-50,#f9fafb)'"
        >${(currentNotes||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('cal-ev-modal').remove()"
          style="flex:1;padding:10px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:14px;font-weight:600;color:var(--gray-600);cursor:pointer">
          Cancel
        </button>
        <button id="eev-save-btn"
          style="flex:2;padding:10px;border:none;border-radius:8px;background:var(--blue);color:white;font-size:14px;font-weight:700;cursor:pointer">
          Save
        </button>
      </div>
    </div>
  `;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);

  const titleEl = document.getElementById('eev-title');
  titleEl.select();

  // Wire up color swatches for edit modal
  _attachSwatchListeners('eev-color-swatches', 'eev-color');

  const recurEl = document.getElementById('eev-recur');

  document.getElementById('eev-save-btn').addEventListener('click', async () => {
    const newTitle  = titleEl.value.trim();
    if (!newTitle) { titleEl.focus(); return; }
    const start     = document.getElementById('eev-start').value;
    const end       = document.getElementById('eev-end').value;
    const newRecur  = recurEl.value;
    const newColor  = document.getElementById('eev-color').value;
    const newNotes  = (document.getElementById('eev-notes')?.value) ?? currentNotes;
    const scopeHidden = document.getElementById('eev-scope-hidden');
    const scope     = scopeHidden ? scopeHidden.value : 'this';

    const btn = document.getElementById('eev-save-btn');
    if (btn) btn.disabled = true;

    const startISO = `${evDate}T${start}:00+00:00`;
    const endISO   = end ? `${evDate}T${end}:00+00:00` : null;

    // If recurrence changed and scope === 'all' and there's a group, rebuild the series
    const recurChanged = newRecur !== currentRecur;

    // ── scope === 'following' — update this event and all after it ──────────────
    if (scope === 'following' && groupId) {
      if (recurChanged) {
        // Delete all occurrences from evDate forward, re-create with new recurrence
        const { error: delErr } = await supabase.from('calendar_events')
          .delete().eq('recurrence_group_id', groupId)
          .gte('start_time', `${evDate}T00:00:00+00:00`);
        if (delErr) { toast('Error: ' + delErr.message, 'error'); if (btn) btn.disabled = false; return; }
        const newGroupId = crypto.randomUUID();
        const dates = buildRecurDates(evDate, newRecur);
        const rows = dates.map(ds => ({
          title: newTitle,
          start_time: `${ds}T${start}:00+00:00`,
          end_time: end ? `${ds}T${end}:00+00:00` : null,
          all_day: false,
          color: newColor,
          calendar_name: 'LifeOS',
          is_busy: true,
          recurrence: newRecur,
          recurrence_group_id: newGroupId,
          notes: newNotes,
        }));
        const { error: insErr } = await supabase.from('calendar_events').insert(rows);
        if (insErr) { toast('Error: ' + insErr.message, 'error'); if (btn) btn.disabled = false; return; }
        toast(`Updated this + all following — ${dates.length} events ✅`, 'success');
        modal.remove(); render(); return;
      }
      // Title/color/notes update for this and all following
      const { error } = await supabase.from('calendar_events').update({
        title: newTitle, color: newColor, recurrence: newRecur, notes: newNotes,
      }).eq('recurrence_group_id', groupId)
        .gte('start_time', `${evDate}T00:00:00+00:00`);
      if (error) { toast('Error: ' + error.message, 'error'); if (btn) btn.disabled = false; return; }
      toast('This event and all following updated ✅', 'success');
      modal.remove(); render(); return;
    }

    if (recurChanged && scope === 'all' && groupId) {
      // Delete old group, re-create from this event's date forward with new recurrence
      const { error: delErr } = await supabase.from('calendar_events')
        .delete().eq('recurrence_group_id', groupId)
        .gte('start_time', `${evDate}T00:00:00+00:00`);
      if (delErr) { toast('Error: ' + delErr.message, 'error'); if (btn) btn.disabled = false; return; }

      const newGroupId = crypto.randomUUID();
      const dates = buildRecurDates(evDate, newRecur);
      const rows = dates.map(ds => ({
        title: newTitle,
        start_time: `${ds}T${start}:00+00:00`,
        end_time:   end ? `${ds}T${end}:00+00:00` : null,
        all_day: false,
        color: newColor,
        calendar_name: 'LifeOS',
        is_busy: true,
        recurrence: newRecur,
        recurrence_group_id: newGroupId,
      }));
      const { error: insErr } = await supabase.from('calendar_events').insert(rows);
      if (insErr) { toast('Error: ' + insErr.message, 'error'); if (btn) btn.disabled = false; return; }
      toast(`Series updated — ${dates.length} events ✅`, 'success');
      modal.remove(); render(); return;
    }

    // Scope === 'all' title/time/color update across group
    if (scope === 'all' && groupId) {
      const { error } = await supabase.from('calendar_events').update({
        title: newTitle, color: newColor,
        recurrence: newRecur,
      }).eq('recurrence_group_id', groupId);
      if (error) { toast('Error: ' + error.message, 'error'); if (btn) btn.disabled = false; return; }
      toast('All events in series updated ✅', 'success');
      modal.remove(); render(); return;
    }

    // Single event update (scope === 'this' OR no group)
    const newGroupId = (newRecur !== 'none' && !groupId) ? crypto.randomUUID() : (groupId || null);

    if (newRecur !== 'none' && !groupId) {
      // First time setting recurrence on a standalone event — build the series
      const dates = buildRecurDates(evDate, newRecur);
      const rows = dates.map(ds => ({
        title: newTitle,
        start_time: `${ds}T${start}:00+00:00`,
        end_time:   end ? `${ds}T${end}:00+00:00` : null,
        all_day: false,
        color: newColor,
        calendar_name: 'LifeOS',
        is_busy: true,
        recurrence: newRecur,
        recurrence_group_id: newGroupId,
      }));
      // Update this event in place (first of series), insert the rest
      const { error: updErr } = await supabase.from('calendar_events').update({
        title: newTitle, start_time: startISO, end_time: endISO,
        color: newColor, recurrence: newRecur, recurrence_group_id: newGroupId,
      }).eq('id', id);
      if (updErr) { toast('Error: ' + updErr.message, 'error'); if (btn) btn.disabled = false; return; }
      const restRows = rows.slice(1);
      if (restRows.length) {
        const { error: insErr } = await supabase.from('calendar_events').insert(restRows);
        if (insErr) { toast('Error: ' + insErr.message, 'error'); if (btn) btn.disabled = false; return; }
      }
      toast(`Recurrence set — ${dates.length} events ✅`, 'success');
      modal.remove(); render(); return;
    }

    // Plain single-event update
    const { error } = await supabase.from('calendar_events').update({
      title: newTitle, start_time: startISO, end_time: endISO,
      color: newColor, recurrence: newRecur, notes: newNotes,
      recurrence_group_id: newRecur === 'none' ? null : newGroupId,
    }).eq('id', id);
    if (error) { toast('Error: ' + error.message, 'error'); if (btn) btn.disabled = false; return; }
    toast('Event updated ✅', 'success');
    modal.remove();
    render();
  });
}

async function openDeleteScopeModal(id, evDate, grpId, row) {
  removeModal();
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.id = 'cal-ev-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:500;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:var(--white);border-radius:12px;padding:20px;width:90%;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
        <div style="font-size:15px;font-weight:700;color:var(--gray-800);margin-bottom:6px">Delete recurring event</div>
        <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px">Which events do you want to delete?</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button id="del-this" style="padding:10px 14px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:13px;font-weight:600;color:var(--gray-700);cursor:pointer;text-align:left">
            🗂 This event only
          </button>
          <button id="del-following" style="padding:10px 14px;border:1.5px solid var(--gray-200);border-radius:8px;background:var(--white);font-size:13px;font-weight:600;color:var(--gray-700);cursor:pointer;text-align:left">
            ⏩ This and all following
          </button>
          <button id="del-all" style="padding:10px 14px;border:1.5px solid #FEE2E2;border-radius:8px;background:#FEF2F2;font-size:13px;font-weight:600;color:var(--red,#DC2626);cursor:pointer;text-align:left">
            🗑 All events in series
          </button>
          <button id="del-cancel" style="padding:8px 14px;border:none;border-radius:8px;background:transparent;font-size:13px;color:var(--gray-400);cursor:pointer">
            Cancel
          </button>
        </div>
      </div>`;
    modal.addEventListener('click', () => { modal.remove(); resolve(); });
    document.body.appendChild(modal);

    document.getElementById('del-cancel').addEventListener('click', (e) => {
      e.stopPropagation(); modal.remove(); resolve();
    });

    document.getElementById('del-this').addEventListener('click', async (e) => {
      e.stopPropagation(); modal.remove();
      const { error } = await supabase.from('calendar_events').delete().eq('id', id);
      if (error) { toast('Delete failed: ' + error.message, 'error'); resolve(); return; }
      if (row) { const { id: _, created_at, ...rowData } = row; pushUndo({ type: 'delete', row: rowData }); }
      toast('Event deleted — Cmd+Z to undo', 'success');
      render(); resolve();
    });

    document.getElementById('del-following').addEventListener('click', async (e) => {
      e.stopPropagation(); modal.remove();
      const { error } = await supabase.from('calendar_events').delete()
        .eq('recurrence_group_id', grpId)
        .gte('start_time', `${evDate}T00:00:00+00:00`);
      if (error) { toast('Delete failed: ' + error.message, 'error'); resolve(); return; }
      toast('This event and all following deleted', 'success');
      render(); resolve();
    });

    document.getElementById('del-all').addEventListener('click', async (e) => {
      e.stopPropagation(); modal.remove();
      const { error } = await supabase.from('calendar_events').delete().eq('recurrence_group_id', grpId);
      if (error) { toast('Delete failed: ' + error.message, 'error'); resolve(); return; }
      toast('All events in series deleted', 'success');
      render(); resolve();
    });
  });
}

function removeModal() {
  const existing = document.getElementById('cal-ev-modal');
  if (existing) existing.remove();
}

// ── Day events panel ──────────────────────────────────────────────────────────
function renderDayPanel(ds) {
  const headerEl = document.getElementById('selected-day-header');
  const eventsEl = document.getElementById('day-events');

  if (!ds) { headerEl.textContent = ''; eventsEl.innerHTML = ''; return; }

  const d = new Date(ds + 'T00:00:00');
  headerEl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const events = getVisibleEvents(ds);
  if (!events.length) {
    eventsEl.innerHTML = '<div class="no-events">No events on this day</div>';
    return;
  }

  eventsEl.innerHTML = events.map(e => {
    const timeRange = (e.timeStart && e.timeEnd) ? `<div class="cal-event-time">${fmt12Range(e.timeStart, e.timeEnd)}</div>` :
                      e.timeStart ? `<div class="cal-event-time">${fmt12(e.timeStart)}</div>` : '';
    let taskHtml = '';
    if (e.type === 'timeblock' && e.taskList && e.taskList.length > 0) {
      taskHtml = `<ul class="cal-tb-tasks">${e.taskList.map(t =>
        `<li>${typeof t === 'object' ? (t.title || t.name || JSON.stringify(t)) : t}</li>`
      ).join('')}</ul>`;
    }
    const hasNote = !!(e.notes);
    const noteDot = hasNote
      ? `<div style="position:absolute;top:8px;right:8px;width:7px;height:7px;border-radius:50%;background:#2563EB;flex-shrink:0" title="Has note"></div>`
      : '';
    const href = (e.link && e.link !== '#') ? e.link : null;
    const tag = href ? 'a' : 'div';
    const hrefAttr = href ? ` href="${href}"` : '';
    return `<${tag}${hrefAttr} class="cal-event-item${e.isDone ? ' cal-event-done' : ''}" style="position:relative">
      <div class="cal-event-stripe" style="background:${e.color}"></div>
      <div class="cal-event-content">
        <div class="cal-event-title" style="padding-right:${hasNote ? '16px' : '0'}">${e.title}</div>
        ${timeRange}
        ${e.meta ? `<div class="cal-event-meta">${e.meta}</div>` : ''}
        ${taskHtml}
      </div>
      ${noteDot}
    </${tag}>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getWeekStart(d) {
  const result = new Date(d);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function addDays(d, n) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function classMatchesDow(dayOfWeek, dow) {
  const d = (dayOfWeek || '').trim();
  if (d === 'Mon-Thu') return dow >= 1 && dow <= 4;
  if (d === 'Tue-Thu') return dow >= 2 && dow <= 4;
  if (d === 'Friday') return dow === 5;
  if (d === 'Monday') return dow === 1;
  const dowName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow];
  const dowShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow];
  return d.toLowerCase().includes(dowName.toLowerCase()) || d.toLowerCase().includes(dowShort.toLowerCase());
}

// ── FAB (Floating Action Button) ──────────────────────────────────────────────
window.calFabClick = () => {
  // Use today's date and round current time to nearest 30 min
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const roundedMin = now.getMinutes() < 30 ? 30 : 0;
  const roundedHr  = now.getMinutes() < 30 ? now.getHours() : now.getHours() + 1;
  const clampedHr  = Math.min(roundedHr, 23);
  const startTime  = `${pad(clampedHr)}:${pad(roundedMin)}`;
  const endHr      = Math.min(clampedHr + 1, 23);
  const endTime    = `${pad(endHr)}:${pad(roundedMin)}`;
  openCreateModal(todayStr, startTime, endTime);
};

// ── Color filter panel ───────────────────────────────────────────────────────
function _initFilterSwatches() {
  const container = document.getElementById('cal-filter-swatches');
  if (!container) return;
  container.innerHTML = EVENT_COLORS.map(c => `
    <div class="cal-filter-swatch" data-color="${c.val}" title="${c.label}"
      onclick="window._calToggleColor('${c.val}')"
      style="width:26px;height:26px;border-radius:50%;background:${c.val};cursor:pointer;
        transition:opacity 0.15s,transform 0.15s,box-shadow 0.15s;
        box-shadow:0 0 0 2px white,0 0 0 3px rgba(0,0,0,0.15);
        flex-shrink:0">
    </div>`).join('');
}

window._calToggleFilterPanel = () => {
  const panel = document.getElementById('cal-filter-panel');
  const btn   = document.getElementById('cal-filter-btn');
  if (!panel) return;
  const isOpen = panel.style.display === 'flex';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (btn) btn.style.background = isOpen ? 'white' : 'rgba(37,99,235,0.06)';
  if (btn) btn.style.borderColor = isOpen ? 'var(--gray-200)' : 'var(--blue)';
  if (btn) btn.style.color = isOpen ? 'var(--gray-600)' : 'var(--blue)';
};

window._calResetFilter = () => {
  hiddenColors.clear();
  document.querySelectorAll('.cal-filter-swatch').forEach(sw => {
    sw.style.opacity = '1';
    sw.style.transform = 'scale(1)';
    sw.style.boxShadow = '0 0 0 2px white,0 0 0 3px rgba(0,0,0,0.15)';
  });
  document.getElementById('cal-filter-btn')?.classList.remove('has-filter');
  render();
};

// Patch _calToggleColor to also update filter button badge
const _origToggle = window._calToggleColor;
window._calToggleColor = (color) => {
  _origToggle(color);
  const btn = document.getElementById('cal-filter-btn');
  if (btn) btn.classList.toggle('has-filter', hiddenColors.size > 0);
};

// ── Init ──────────────────────────────────────────────────────────────────────
_initFilterSwatches();
render();

// ── Auto-update current time indicator every 30 seconds ───────────────────────
function _updateNowLine() {
  const line = document.getElementById('cal-now-line');
  if (!line) return;
  const now = new Date();
  const pstTime = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false });
  const [pstH, pstM] = pstTime.split(':').map(Number);
  const nowMins = pstH * 60 + pstM;
  const startMins = WEEK_HOUR_START * 60;
  const endMins = WEEK_HOUR_END * 60;
  if (nowMins >= startMins && nowMins <= endMins) {
    const pct = (nowMins - startMins) / ((WEEK_HOUR_END - WEEK_HOUR_START) * 60) * 100;
    line.style.top = `${pct}%`;
    line.style.display = '';
  } else {
    line.style.display = 'none';
  }
}
setInterval(_updateNowLine, 30000);
