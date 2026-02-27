// Life OS — Calendar (Month + Week views, Sunday start)
// Supports drag/resize/add/delete of calendar_events in week view
import { supabase } from './supabase.js';
import { today, toast } from './utils.js';

const T = today();
const TODAY = new Date(T + 'T00:00:00');

let viewMode = 'week'; // 'month' | 'week'
let viewYear = TODAY.getFullYear();
let viewMonth = TODAY.getMonth(); // 0-based
let viewWeekStart = getWeekStart(TODAY); // Date object = Sunday of current week
let selectedDate = T;

// Event cache keyed by 'YYYY-MM-DD'
const eventCache = {};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── View switching ────────────────────────────────────────────────────────────
window.setView = (mode) => {
  viewMode = mode;
  document.getElementById('btn-month').classList.toggle('active', mode === 'month');
  document.getElementById('btn-week').classList.toggle('active', mode === 'week');
  // Show/hide the day-label row
  document.getElementById('cal-day-labels').style.display = mode === 'month' ? 'grid' : 'none';
  render();
};

window.prev = () => {
  if (viewMode === 'month') {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  } else {
    viewWeekStart = addDays(viewWeekStart, -7);
  }
  render();
};

window.next = () => {
  if (viewMode === 'month') {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  } else {
    viewWeekStart = addDays(viewWeekStart, 7);
  }
  render();
};

window.goToday = () => {
  viewYear = TODAY.getFullYear();
  viewMonth = TODAY.getMonth();
  viewWeekStart = getWeekStart(TODAY);
  selectedDate = T;
  render();
};

window.selectDay = (dateStr) => {
  selectedDate = dateStr;
  if (viewMode === 'month') renderMonthGrid();
  renderDayPanel(dateStr);
};

// ── Main render ───────────────────────────────────────────────────────────────
async function render() {
  await fetchEvents();
  if (viewMode === 'month') {
    renderMonthGrid();
  } else {
    renderWeekGrid();
  }
  renderDayPanel(selectedDate);
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

  const [tasksRes, remindersRes, weddingsRes, classesRes, calEventsRes, timeBlocksRes] = await Promise.all([
    supabase.from('tasks')
      .select('id, title, due_date, priority, module')
      .in('status', ['open', 'in_progress'])
      .gte('due_date', startStr)
      .lte('due_date', endStr),
    supabase.from('reminders')
      .select('id, title, due_date, module')
      .eq('status', 'active')
      .not('due_date', 'is', null)
      .gte('due_date', startStr)
      .lte('due_date', endStr),
    supabase.from('tov_clients')
      .select('id, name, wedding_date')
      .not('wedding_date', 'is', null)
      .gte('wedding_date', startStr)
      .lte('wedding_date', endStr),
    supabase.from('classes').select('id, name, day_of_week, time_start, time_end, subject'),
    supabase.from('calendar_events')
      .select('id, title, start_time, end_time, all_day, calendar_name, color, is_busy')
      .gte('start_time', startStr)
      .lte('start_time', endStr + 'T23:59:59'),
    supabase.from('time_blocks')
      .select('id, date, start_time, end_time, title, block_type, assigned_tasks, status, description')
      .gte('date', startStr)
      .lte('date', endStr),
  ]);

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
        eventCache[key].push({
          type: 'class', title: cls.name,
          meta: cls.time_start ? cls.time_start.slice(0,5) : cls.subject || '',
          color: '#2563EB',
          link: `class.html?id=${cls.id}`,
          timeStart: cls.time_start ? cls.time_start.slice(0,5) : null,
          timeEnd: cls.time_end ? cls.time_end.slice(0,5) : null,
          classId: cls.id,
          editable: true,
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
    const events = ds ? (eventCache[ds] || []) : [];
    const dots = [...new Set(events.map(e => e.color))].slice(0, 4);

    html += `<div class="cal-day${!inMonth ? ' other-month' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}"
      ${ds ? `onclick="selectDay('${ds}')"` : ''}>
      <div class="cal-day-num">${inMonth ? dayNum : ''}</div>
      ${dots.length ? `<div class="cal-dots">${dots.map(c => `<div class="cal-dot" style="background:${c}"></div>`).join('')}</div>` : ''}
    </div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;
}

// ── Week grid (Google Calendar style, proportional blocks) ───────────────────
const WEEK_HOUR_START = 6;  // 6am
const WEEK_HOUR_END   = 21; // 9pm
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
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad(h)}:${pad(m)}`;
}

function snapMins(mins) {
  return Math.round(mins / SNAP_MINS) * SNAP_MINS;
}

function pxToMins(px) {
  // Convert px offset within the time grid body to minutes from midnight
  return WEEK_HOUR_START * 60 + (px / TOTAL_HEIGHT) * (WEEK_HOUR_END - WEEK_HOUR_START) * 60;
}

// ── Drag state ────────────────────────────────────────────────────────────────
let dragState = null; // { type: 'create'|'move'|'resize', ... }

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
    html += `<div class="wgcal-day-hdr${isToday ? ' today-col' : ''}" onclick="selectDay('${str}')" style="flex:1;text-align:center;padding:6px 2px;cursor:pointer;font-size:12px;font-weight:600;color:${isToday ? 'var(--blue)' : 'var(--gray-500)'}">
      <div>${dayName}</div>
      <span style="font-size:18px;font-weight:700;display:block;${isToday ? 'background:var(--blue);color:white;border-radius:50%;width:28px;height:28px;line-height:28px;margin:2px auto 0' : 'color:var(--gray-800)'}">${dayNum}</span>
    </div>`;
  }
  html += `</div><!-- /header -->

    <div class="wgcal-allday" style="display:flex;align-items:flex-start;border-bottom:1px solid var(--gray-100);min-height:28px">
      <div style="width:${gutterW}px;flex-shrink:0;font-size:10px;color:var(--gray-400);padding-top:6px;text-align:right;padding-right:4px">all-day</div>`;
  for (const { str } of days) {
    const allDayEvents = (eventCache[str] || []).filter(e => !e.timeStart);
    html += `<div style="flex:1;padding:2px;min-height:28px">`;
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
    const timedEvents = (eventCache[str] || []).filter(e => e.timeStart);
    html += `<div class="wgcal-day-col" data-date="${str}" style="flex:1;position:relative;height:${TOTAL_HEIGHT}px;border-left:1px solid var(--gray-100);${isToday ? 'background:rgba(37,99,235,0.03)' : ''}">`;

    // Current time indicator
    if (isToday) {
      const now = new Date();
      const pstTime = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false });
      const [pstH, pstM] = pstTime.split(':').map(Number);
      const nowMins = pstH * 60 + pstM;
      const startMins = WEEK_HOUR_START * 60;
      const endMins = WEEK_HOUR_END * 60;
      if (nowMins >= startMins && nowMins <= endMins) {
        const pct = (nowMins - startMins) / ((WEEK_HOUR_END - WEEK_HOUR_START) * 60) * 100;
        html += `<div style="position:absolute;left:0;right:0;top:${pct}%;height:2px;background:var(--red);z-index:10;pointer-events:none">
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
      const timeLabel = `${e.timeStart}${e.timeEnd ? '–' + e.timeEnd : ''}`;
      const isEditable = (e.type === 'gcal' && e.id) || (e.type === 'class' && e.classId);
      const cursor = isEditable ? 'grab' : 'pointer';
      const evId = e.id ? `data-ev-id="${e.id}"` : '';
      const classIdAttr = e.classId ? `data-class-id="${e.classId}"` : '';
      const evTypeAttr = `data-ev-type="${e.type}"`;

      html += `<div class="wcal-ev${isEditable ? ' wcal-ev-editable' : ''}" ${evId} ${classIdAttr} ${evTypeAttr}
        data-date="${str}" data-start="${e.timeStart}" data-end="${e.timeEnd || ''}"
        style="position:absolute;top:${topPct}%;left:2px;right:2px;
          min-height:${heightPx}px;background:${e.color};border-radius:4px;
          padding:2px 5px;font-size:10px;font-weight:600;color:white;
          overflow:hidden;z-index:5;display:block;line-height:1.3;
          cursor:${cursor};user-select:none;box-sizing:border-box"
        title="${e.title} ${timeLabel}">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.title}</div>
        ${heightPx > 28 ? `<div style="font-size:9px;opacity:0.85">${timeLabel}</div>` : ''}
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
}

// ── Week view interactions ────────────────────────────────────────────────────
function attachWeekInteractions() {
  const dayCols = document.querySelectorAll('.wgcal-day-col');
  const body = document.getElementById('wgcal-body');

  // Helper: get minutes from a mouse Y relative to the time grid body
  function yToMins(colEl, clientY) {
    const rect = colEl.getBoundingClientRect();
    const py = Math.max(0, Math.min(TOTAL_HEIGHT, clientY - rect.top));
    return snapMins(Math.round(pxToMins(py)));
  }

  dayCols.forEach(col => {
    const dateStr = col.dataset.date;

    // ── Click on column background → create event ─────────────────────────
    col.addEventListener('mousedown', (e) => {
      // Only act on direct column clicks (not on events or resize handles)
      if (e.target !== col) return;
      e.preventDefault();

      const startM = yToMins(col, e.clientY);
      const endM   = startM + 60;

      // Create a ghost block
      const ghost = createGhostBlock(col, startM, endM, dateStr);

      dragState = {
        type: 'create',
        col, dateStr, startM, endM,
        anchorM: startM,
        ghost,
      };
    });

    // ── Mousedown on editable events ──────────────────────────────────────
    col.querySelectorAll('.wcal-ev-editable').forEach(evEl => {
      const evId      = evEl.dataset.evId;
      const classId   = evEl.dataset.classId;
      const evType    = evEl.dataset.evType;
      const evDate    = evEl.dataset.date;
      const evStart   = evEl.dataset.start;
      const evEnd     = evEl.dataset.end;

      // Resize handle
      const resizeHandle = evEl.querySelector('.wcal-resize-handle');
      if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dragState = {
            type: 'resize',
            evEl, evId, classId, evType, evDate,
            startM: timeToMinutes(evStart),
            endM:   timeToMinutes(evEnd) || timeToMinutes(evStart) + 60,
            col,
          };
        });
      }

      // Move (drag entire event)
      evEl.addEventListener('mousedown', (e) => {
        if (e.target === resizeHandle) return;
        e.preventDefault();
        e.stopPropagation();

        const clickMins = yToMins(col, e.clientY);
        const sMins = timeToMinutes(evStart);
        const eMins = timeToMinutes(evEnd) || sMins + 60;
        dragState = {
          type: 'move',
          evEl, evId, classId, evType, evDate: dateStr,
          startM: sMins,
          endM:   eMins,
          duration: eMins - sMins,
          offsetM: clickMins - sMins,
          col,
        };
        evEl.style.opacity = '0.6';
        evEl.style.cursor = 'grabbing';
      });

      // Click (no drag) → open detail popup (only for gcal events)
      evEl.addEventListener('click', (e) => {
        if (dragState) return; // was a drag, not a click
        e.stopPropagation();
        if (evType === 'gcal') {
          openEventPopup(evId, evStart, evEnd, evEl.title.replace(` ${evStart}–${evEnd}`, '').trim(), evDate, evEl);
        } else if (evType === 'class' && classId) {
          window.location.href = `class.html?id=${classId}`;
        }
      });
    });
  });

  // ── Global mouse move ─────────────────────────────────────────────────────
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  function handleMouseMove(e) {
    if (!dragState) return;

    if (dragState.type === 'create') {
      const m = yToMins(dragState.col, e.clientY);
      if (m > dragState.anchorM) {
        dragState.startM = dragState.anchorM;
        dragState.endM = m;
      } else {
        dragState.startM = m;
        dragState.endM = dragState.anchorM;
      }
      dragState.endM = Math.max(dragState.startM + SNAP_MINS, dragState.endM);
      updateGhostBlock(dragState.ghost, dragState.startM, dragState.endM);
    }

    if (dragState.type === 'resize') {
      const m = yToMins(dragState.col, e.clientY);
      dragState.endM = Math.max(dragState.startM + SNAP_MINS, m);
      const topPct = minutesToPct(dragState.startM);
      const heightPx = Math.max(20, (dragState.endM - dragState.startM) / 60 * HOUR_HEIGHT_PX);
      dragState.evEl.style.minHeight = heightPx + 'px';
      // Update time label
      const tl = dragState.evEl.querySelector('div:nth-child(2)');
      if (tl) tl.textContent = `${minsToTimeStr(dragState.startM)}–${minsToTimeStr(dragState.endM)}`;
    }

    if (dragState.type === 'move') {
      // Determine which column we're over
      let targetCol = null;
      let targetDate = dragState.evDate;
      document.querySelectorAll('.wgcal-day-col').forEach(col => {
        const rect = col.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          targetCol = col;
          targetDate = col.dataset.date;
        }
      });
      if (!targetCol) return;

      const m = yToMins(targetCol, e.clientY);
      dragState.startM = m - dragState.offsetM;
      dragState.endM   = dragState.startM + dragState.duration;
      dragState.col = targetCol;
      dragState.evDate = targetDate;

      const topPct = minutesToPct(dragState.startM);
      dragState.evEl.style.top = topPct + '%';
    }
  }

  function handleMouseUp(e) {
    if (!dragState) return;
    const ds = dragState;
    dragState = null;

    if (ds.type === 'create') {
      // Remove ghost, open create modal
      ds.ghost.remove();
      if (ds.endM - ds.startM < SNAP_MINS) return; // too small, ignore
      openCreateModal(ds.dateStr, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM));
    }

    if (ds.type === 'resize') {
      ds.evEl.style.cursor = '';
      if (ds.evType === 'class' && ds.classId) {
        saveClassTime(ds.classId, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM));
      } else {
        saveEventTime(ds.evId, ds.evDate, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM));
      }
    }

    if (ds.type === 'move') {
      ds.evEl.style.opacity = '';
      ds.evEl.style.cursor = 'grab';
      if (ds.evType === 'class' && ds.classId) {
        saveClassTime(ds.classId, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM));
      } else {
        saveEventTime(ds.evId, ds.evDate, minsToTimeStr(ds.startM), minsToTimeStr(ds.endM));
      }
    }

    // Clean up listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }
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
  ghost.textContent = `${minsToTimeStr(startM)}–${minsToTimeStr(endM)}`;
}

// ── Save event time to Supabase ───────────────────────────────────────────────
async function saveEventTime(id, dateStr, startTime, endTime) {
  if (!id) return;
  const startISO = `${dateStr}T${startTime}:00+00:00`;
  const endISO   = `${dateStr}T${endTime}:00+00:00`;
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

// ── Create event modal (with recurrence) ──────────────────────────────────────
function openCreateModal(dateStr, startTime, endTime) {
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
      <div style="display:flex;gap:8px;margin-bottom:10px">
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
      <select id="cev-color" style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:10px;outline:none;box-sizing:border-box;background:var(--white)">
        <option value="#0F9D58">🟢 Green</option>
        <option value="#2563EB">🔵 Blue</option>
        <option value="#7C3AED">🟣 Purple</option>
        <option value="#D97706">🟡 Amber</option>
        <option value="#DC2626">🔴 Red</option>
        <option value="#0891B2">🩵 Teal</option>
      </select>
      <select id="cev-recur" style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:14px;outline:none;box-sizing:border-box;background:var(--white)">
        <option value="none">🔂 Doesn't repeat</option>
        <option value="daily">📅 Daily (30 days)</option>
        <option value="weekdays">🗓 Weekdays Mon–Fri (8 weeks)</option>
        <option value="weekly">📆 Weekly (12 weeks)</option>
        <option value="biweekly">📆 Every 2 weeks (12 occurrences)</option>
        <option value="monthly">🗓 Monthly (6 months)</option>
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

    const rows = dates.map(ds => ({
      title,
      start_time: `${ds}T${start}:00+00:00`,
      end_time:   `${ds}T${end}:00+00:00`,
      all_day: false,
      color,
      calendar_name: 'LifeOS',
      is_busy: true,
    }));

    const { error } = await supabase.from('calendar_events').insert(rows);
    if (error) { toast('Error: ' + error.message, 'error'); if (btn) btn.disabled = false; return; }

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

// ── Build list of dates for recurrence ────────────────────────────────────────
function buildRecurDates(startDateStr, recur) {
  const dates = [startDateStr];
  if (recur === 'none') return dates;

  const start = new Date(startDateStr + 'T00:00:00');
  const dow = start.getDay(); // 0=Sun, 1=Mon...5=Fri, 6=Sat

  if (recur === 'daily') {
    for (let i = 1; i < 30; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(dateStr(d));
    }
  } else if (recur === 'weekdays') {
    let count = 0;
    let i = 1;
    while (count < 39) { // 8 weeks * ~5 days
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (d.getDay() >= 1 && d.getDay() <= 5) {
        dates.push(dateStr(d));
        count++;
      }
      i++;
      if (i > 200) break;
    }
  } else if (recur === 'weekly') {
    for (let i = 1; i < 12; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i * 7);
      dates.push(dateStr(d));
    }
  } else if (recur === 'biweekly') {
    for (let i = 1; i < 12; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i * 14);
      dates.push(dateStr(d));
    }
  } else if (recur === 'monthly') {
    for (let i = 1; i < 6; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      dates.push(dateStr(d));
    }
  }

  return dates;
}

// ── Event detail/edit/delete popup ───────────────────────────────────────────
function openEventPopup(id, startTime, endTime, title, evDate, anchorEl) {
  removeModal();
  const rect = anchorEl.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.id = 'cal-ev-modal';
  popup.style.cssText = `position:fixed;z-index:500;background:var(--white);border-radius:10px;
    padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.2);width:240px;
    top:${Math.min(rect.bottom + 8, window.innerHeight - 200)}px;
    left:${Math.min(rect.left, window.innerWidth - 260)}px;
    border:1px solid var(--gray-200)`;
  popup.innerHTML = `
    <div style="font-size:14px;font-weight:700;color:var(--gray-800);margin-bottom:4px">${title}</div>
    <div style="font-size:12px;color:var(--gray-400);margin-bottom:12px">${evDate} · ${startTime}–${endTime}</div>
    <div style="display:flex;gap:6px">
      <button id="ev-edit-btn" style="flex:1;padding:8px;border:1.5px solid var(--gray-200);border-radius:7px;background:var(--white);font-size:13px;font-weight:600;color:var(--gray-700);cursor:pointer">✏️ Edit</button>
      <button id="ev-del-btn" style="flex:1;padding:8px;border:none;border-radius:7px;background:#FEF2F2;font-size:13px;font-weight:600;color:var(--red);cursor:pointer">🗑 Delete</button>
    </div>
  `;
  document.body.appendChild(popup);

  // Close on outside click
  setTimeout(() => document.addEventListener('click', () => removeModal(), { once: true }), 10);
  popup.addEventListener('click', e => e.stopPropagation());

  document.getElementById('ev-del-btn').addEventListener('click', async () => {
    popup.remove();
    const { error } = await supabase.from('calendar_events').delete().eq('id', id);
    if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
    toast('Event deleted', 'success');
    render();
  });

  document.getElementById('ev-edit-btn').addEventListener('click', () => {
    popup.remove();
    openEditModal(id, title, evDate, startTime, endTime);
  });
}

function openEditModal(id, title, evDate, startTime, endTime) {
  removeModal();
  const modal = document.createElement('div');
  modal.id = 'cal-ev-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:500;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--white);border-radius:12px;padding:20px;width:90%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
      <div style="font-size:16px;font-weight:700;margin-bottom:14px">Edit Event</div>
      <input id="eev-title" type="text" value="${title}" autocomplete="off"
        style="width:100%;border:1.5px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:10px;outline:none;box-sizing:border-box"
        onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--gray-200)'" />
      <div style="display:flex;gap:8px;margin-bottom:14px">
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

  document.getElementById('eev-save-btn').addEventListener('click', async () => {
    const newTitle = titleEl.value.trim();
    if (!newTitle) { titleEl.focus(); return; }
    const start = document.getElementById('eev-start').value;
    const end   = document.getElementById('eev-end').value;
    const startISO = `${evDate}T${start}:00+00:00`;
    const endISO   = end ? `${evDate}T${end}:00+00:00` : null;

    const { error } = await supabase.from('calendar_events').update({
      title: newTitle, start_time: startISO, end_time: endISO,
    }).eq('id', id);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    toast('Event updated ✅', 'success');
    modal.remove();
    render();
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

  const events = eventCache[ds] || [];
  if (!events.length) {
    eventsEl.innerHTML = '<div class="no-events">No events on this day</div>';
    return;
  }

  eventsEl.innerHTML = events.map(e => {
    const timeRange = (e.timeStart && e.timeEnd) ? `<div class="cal-event-time">${e.timeStart}–${e.timeEnd}</div>` :
                      e.timeStart ? `<div class="cal-event-time">${e.timeStart}</div>` : '';
    let taskHtml = '';
    if (e.type === 'timeblock' && e.taskList && e.taskList.length > 0) {
      taskHtml = `<ul class="cal-tb-tasks">${e.taskList.map(t =>
        `<li>${typeof t === 'object' ? (t.title || t.name || JSON.stringify(t)) : t}</li>`
      ).join('')}</ul>`;
    }
    const href = (e.link && e.link !== '#') ? e.link : null;
    const tag = href ? 'a' : 'div';
    const hrefAttr = href ? ` href="${href}"` : '';
    return `<${tag}${hrefAttr} class="cal-event-item${e.isDone ? ' cal-event-done' : ''}">
      <div class="cal-event-stripe" style="background:${e.color}"></div>
      <div class="cal-event-content">
        <div class="cal-event-title">${e.title}</div>
        ${timeRange}
        ${e.meta ? `<div class="cal-event-meta">${e.meta}</div>` : ''}
        ${taskHtml}
      </div>
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

// ── Init ──────────────────────────────────────────────────────────────────────
render();
