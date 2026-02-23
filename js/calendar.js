// Life OS — Calendar (Month + Week views, Sunday start)
import { supabase } from './supabase.js';
import { today } from './utils.js';

const T = today();
const TODAY = new Date(T + 'T00:00:00');

let viewMode = 'month'; // 'month' | 'week'
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
        });
      }
    }
    cur = addDays(cur, 1);
  }

  // Add Google Calendar events
  for (const ev of (calEventsRes.data || [])) {
    // start_time is stored as ISO with +00:00 but the time values represent local time
    // (i.e. "07:30:00+00:00" means 7:30am local, not UTC). Extract date from the ISO string directly.
    const key = ev.start_time ? ev.start_time.slice(0, 10) : null; // "YYYY-MM-DD"
    if (!key || !eventCache[key]) continue;
    const startLocal = ev.start_time ? ev.start_time.slice(11, 16) : null; // "HH:MM"
    const endLocal   = ev.end_time   ? ev.end_time.slice(11, 16)   : null;
    // Map Google Calendar color names to hex; default teal
    const calColor = ev.color || '#0F9D58';
    eventCache[key].push({
      type: 'gcal',
      title: ev.title,
      meta: ev.calendar_name || 'Calendar',
      color: calColor,
      link: '#',
      timeStart: ev.all_day ? null : startLocal,
      timeEnd:   ev.all_day ? null : endLocal,
      isBusy: ev.is_busy,
    });
  }

  // Add time blocks (focus sessions)
  for (const tb of (timeBlocksRes.data || [])) {
    const key = tb.date; // 'YYYY-MM-DD'
    if (!eventCache[key]) continue;
    const tasks = tb.assigned_tasks || [];
    const taskCount = Array.isArray(tasks) ? tasks.length : 0;
    const label = taskCount > 0 ? `${tb.title} · ${taskCount} task${taskCount !== 1 ? 's' : ''}` : tb.title;
    const blockColor = tb.block_type === 'focus'  ? '#7C3AED'
                     : tb.block_type === 'buffer' ? '#6B7280'
                     : tb.block_type === 'open'   ? '#0891B2'
                     : '#7C3AED';
    // start_time from DB is "HH:MM:SS"
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
      // Within same type, sort by start time
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
  // Ensure cal-grid uses grid layout (in case class is missing from HTML)
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

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToPct(mins) {
  // Convert absolute minutes to position relative to WEEK_HOUR_START
  const startMins = WEEK_HOUR_START * 60;
  const totalMins = (WEEK_HOUR_END - WEEK_HOUR_START) * 60;
  return Math.max(0, Math.min(100, (mins - startMins) / totalMins * 100));
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

  // Build hour labels
  const hours = [];
  for (let h = WEEK_HOUR_START; h < WEEK_HOUR_END; h++) {
    const label = h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
    hours.push(label);
  }

  // Time gutter width
  const gutterW = 36;

  let html = `<div class="week-gcal-wrap" style="overflow-x:auto">
  <div class="week-gcal" style="min-width:480px">
    <!-- Header row: gutter + day names -->
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

    <!-- All-day row for timed=false events -->
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

    <!-- Time grid body -->
    <div style="display:flex;overflow-y:auto;max-height:${TOTAL_HEIGHT + 20}px">
      <!-- Hour gutter -->
      <div style="width:${gutterW}px;flex-shrink:0;position:relative;height:${TOTAL_HEIGHT}px">`;

  for (let i = 0; i < hours.length; i++) {
    html += `<div style="position:absolute;top:${i * HOUR_HEIGHT_PX - 8}px;right:4px;font-size:10px;color:var(--gray-400);white-space:nowrap">${hours[i]}</div>`;
  }
  html += `</div><!-- /gutter -->

      <!-- Day columns -->
      <div style="flex:1;display:flex;position:relative">
        <!-- Hour lines -->
        <div style="position:absolute;inset:0;pointer-events:none">`;
  for (let i = 0; i < hours.length; i++) {
    html += `<div style="position:absolute;left:0;right:0;top:${i * HOUR_HEIGHT_PX}px;border-top:1px solid var(--gray-100)"></div>`;
  }
  html += `</div>`;

  // Day columns with timed events
  for (const { str } of days) {
    const isToday = str === T;
    const timedEvents = (eventCache[str] || []).filter(e => e.timeStart);
    html += `<div onclick="selectDay('${str}')" style="flex:1;position:relative;height:${TOTAL_HEIGHT}px;border-left:1px solid var(--gray-100);cursor:pointer${isToday ? ';background:rgba(37,99,235,0.03)' : ''}">`;

    // Current time indicator
    if (isToday) {
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
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
      const rawEnd = e.timeEnd ? timeToMinutes(e.timeEnd) : startMins + 60; // default 1hr
      const endMins = Math.max(rawEnd, startMins + 30); // min 30min height
      const topPct = minutesToPct(startMins);
      const heightPct = ((endMins - startMins) / ((WEEK_HOUR_END - WEEK_HOUR_START) * 60)) * 100;
      const heightPx = (endMins - startMins) / 60 * HOUR_HEIGHT_PX;
      const timeLabel = `${e.timeStart}${e.timeEnd ? '–' + e.timeEnd : ''}`;

      html += `<a href="${e.link}" onclick="event.stopPropagation()" style="
        position:absolute;
        top:${topPct}%;
        left:2px;right:2px;
        min-height:${Math.max(20, heightPx)}px;
        background:${e.color};
        border-radius:4px;
        padding:2px 5px;
        font-size:10px;
        font-weight:600;
        color:white;
        overflow:hidden;
        text-decoration:none;
        z-index:5;
        display:block;
        line-height:1.3
      " title="${e.title} ${timeLabel}">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.title}</div>
        ${heightPx > 28 ? `<div style="font-size:9px;opacity:0.85">${timeLabel}</div>` : ''}
      </a>`;
    }

    html += `</div>`;
  }

  html += `</div><!-- /day cols -->
    </div><!-- /time grid body -->
  </div><!-- /week-gcal -->
</div><!-- /wrap -->`;

  document.getElementById('cal-grid').innerHTML = html;
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
  result.setDate(result.getDate() - result.getDay()); // go back to Sunday
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
