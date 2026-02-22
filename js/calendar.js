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

  const [tasksRes, remindersRes, weddingsRes, classesRes] = await Promise.all([
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
    supabase.from('classes').select('id, name, day_of_week, time_start, subject'),
  ]);

  for (const t of (tasksRes.data || [])) {
    if (!eventCache[t.due_date]) continue;
    eventCache[t.due_date].push({
      type: 'task', title: t.title,
      meta: `${t.module}${t.priority === 'urgent' ? ' · 🔴 Urgent' : ''}`,
      color: t.priority === 'urgent' ? '#E8563A' : '#D97706',
      link: 'tasks.html',
    });
  }

  for (const r of (remindersRes.data || [])) {
    if (!eventCache[r.due_date]) continue;
    eventCache[r.due_date].push({
      type: 'reminder', title: r.title,
      meta: r.module || 'Reminder',
      color: '#DC2626',
      link: 'tasks.html',
    });
  }

  for (const w of (weddingsRes.data || [])) {
    if (!eventCache[w.wedding_date]) continue;
    eventCache[w.wedding_date].push({
      type: 'wedding', title: `💍 ${w.name}`,
      meta: 'Wedding',
      color: '#16a34a',
      link: `tov-client.html?id=${w.id}`,
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
        });
      }
    }
    cur = addDays(cur, 1);
  }

  // Sort each day: classes first (by time), then tasks, reminders, weddings
  const typeOrder = { class: 0, task: 1, reminder: 2, wedding: 3 };
  for (const key of Object.keys(eventCache)) {
    eventCache[key].sort((a, b) => {
      const td = (typeOrder[a.type] || 0) - (typeOrder[b.type] || 0);
      if (td !== 0) return td;
      return (a.meta || '').localeCompare(b.meta || '');
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

// ── Week grid ─────────────────────────────────────────────────────────────────
function renderWeekGrid() {
  document.getElementById('cal-day-labels').style.display = 'none';
  // Reset cal-grid to block so the week table fills naturally
  const gridEl = document.getElementById('cal-grid');
  gridEl.style.display = 'block';
  gridEl.style.gridTemplateColumns = '';

  const weekEnd = addDays(viewWeekStart, 6);
  const startLabel = viewWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('period-label').textContent = `${startLabel} – ${endLabel}`;

  // Build 7 days
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(viewWeekStart, i);
    days.push({ date: d, str: dateStr(d) });
  }

  // Build week table
  let html = `<div class="week-grid"><table class="week-table"><thead><tr>`;
  for (const { date, str } of days) {
    const isToday = str === T;
    const dayName = DAYS_SHORT[date.getDay()];
    const dayNum = date.getDate();
    html += `<th class="week-day-header${isToday ? ' today-col' : ''}" onclick="selectDay('${str}');event.stopPropagation()">
      <div>${dayName}</div>
      <span class="week-day-date${isToday ? ' today-num' : ''}">${dayNum}</span>
    </th>`;
  }
  html += `</tr></thead><tbody><tr>`;

  for (const { str } of days) {
    const events = (eventCache[str] || []).slice(0, 6); // cap at 6 per cell
    html += `<td class="week-cell" onclick="selectDay('${str}')">`;
    for (const e of events) {
      html += `<a href="${e.link}" class="week-event" style="background:${e.color}" title="${e.title}" onclick="event.stopPropagation()">${e.title}</a>`;
    }
    if ((eventCache[str] || []).length > 6) {
      html += `<div style="font-size:10px;color:var(--gray-400);text-align:center">+${(eventCache[str] || []).length - 6} more</div>`;
    }
    html += `</td>`;
  }

  html += `</tr></tbody></table></div>`;
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

  eventsEl.innerHTML = events.map(e => `
    <a href="${e.link}" class="cal-event-item">
      <div class="cal-event-stripe" style="background:${e.color}"></div>
      <div class="cal-event-content">
        <div class="cal-event-title">${e.title}</div>
        ${e.meta ? `<div class="cal-event-meta">${e.meta}</div>` : ''}
      </div>
    </a>`).join('');
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
