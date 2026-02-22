// Life OS — Calendar
import { supabase } from './supabase.js';
import { today, fmtDate, fmtDateLong } from './utils.js';

const T = today();
const TODAY = new Date(T + 'T00:00:00');

let viewYear = TODAY.getFullYear();
let viewMonth = TODAY.getMonth(); // 0-based
let selectedDate = T;

// Event cache: { 'YYYY-MM-DD': [{type, title, time, color, link}] }
const eventCache = {};

// ── Navigation ────────────────────────────────────────────────────────────────
window.prevMonth = () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  render();
};
window.nextMonth = () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  render();
};

// ── Main render ───────────────────────────────────────────────────────────────
async function render() {
  await fetchMonthEvents();
  renderGrid();
  renderDayEvents(selectedDate);
}

// ── Fetch all events for visible month range ─────────────────────────────────
async function fetchMonthEvents() {
  // Determine date range (include partial weeks at start/end)
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const rangeStart = new Date(firstDay);
  rangeStart.setDate(rangeStart.getDate() - firstDay.getDay()); // go back to Sunday
  const rangeEnd = new Date(lastDay);
  rangeEnd.setDate(rangeEnd.getDate() + (6 - lastDay.getDay())); // go to Saturday

  const startStr = rangeStart.toISOString().split('T')[0];
  const endStr = rangeEnd.toISOString().split('T')[0];

  // Clear cache for this range
  let d = new Date(rangeStart);
  while (d <= rangeEnd) {
    const key = d.toISOString().split('T')[0];
    eventCache[key] = [];
    d.setDate(d.getDate() + 1);
  }

  // Fetch tasks with due dates in range
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
    supabase.from('classes')
      .select('id, name, day_of_week, time_start'),
  ]);

  // Index tasks
  for (const t of (tasksRes.data || [])) {
    if (!eventCache[t.due_date]) continue;
    eventCache[t.due_date].push({
      type: 'task',
      title: t.title,
      meta: `${t.module} · ${t.priority}`,
      color: t.priority === 'urgent' ? 'var(--red)' : 'var(--orange)',
      link: 'tasks.html',
    });
  }

  // Index reminders
  for (const r of (remindersRes.data || [])) {
    if (!eventCache[r.due_date]) continue;
    eventCache[r.due_date].push({
      type: 'reminder',
      title: r.title,
      meta: r.module || '',
      color: 'var(--red)',
      link: 'tasks.html',
    });
  }

  // Index weddings
  for (const w of (weddingsRes.data || [])) {
    const key = w.wedding_date;
    if (!eventCache[key]) continue;
    eventCache[key].push({
      type: 'wedding',
      title: `💍 ${w.name}`,
      meta: 'Wedding',
      color: 'var(--green)',
      link: `tov-client.html?id=${w.id}`,
    });
  }

  // Expand recurring classes onto each day in range
  const classes = classesRes.data || [];
  let cur = new Date(rangeStart);
  while (cur <= rangeEnd) {
    const dateStr = cur.toISOString().split('T')[0];
    const dow = cur.getDay(); // 0=Sun, 1=Mon,...
    const dowName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow];
    const dowShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow];

    for (const cls of classes) {
      const d = (cls.day_of_week || '').trim();
      let matches = false;
      if (d === 'Mon-Thu' && dow >= 1 && dow <= 4) matches = true;
      if (d === 'Tue-Thu' && dow >= 2 && dow <= 4) matches = true;
      if (d === 'Friday' && dow === 5) matches = true;
      if (d === 'Monday' && dow === 1) matches = true;
      if (!matches && d.toLowerCase().includes(dowName.toLowerCase())) matches = true;
      if (!matches && d.toLowerCase().includes(dowShort.toLowerCase())) matches = true;

      if (matches) {
        if (!eventCache[dateStr]) eventCache[dateStr] = [];
        eventCache[dateStr].push({
          type: 'class',
          title: cls.name,
          meta: cls.time_start ? cls.time_start.slice(0, 5) : '',
          color: 'var(--blue)',
          link: `class.html?id=${cls.id}`,
        });
      }
    }

    cur.setDate(cur.getDate() + 1);
  }
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderGrid() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('month-label').textContent = `${months[viewMonth]} ${viewYear}`;

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startOffset = firstDay.getDay(); // 0=Sun
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

  let html = '';
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    const isThisMonth = dayNum >= 1 && dayNum <= lastDay.getDate();
    const date = isThisMonth
      ? `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
      : null;
    const isToday = date === T;
    const isSelected = date === selectedDate;
    const events = date ? (eventCache[date] || []) : [];

    // Collect up to 3 dot colors
    const dots = [...new Set(events.map(e => e.color))].slice(0, 4);

    html += `
      <div class="cal-day ${!isThisMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}"
        ${date ? `onclick="selectDay('${date}')"` : ''}>
        <div class="cal-day-num">${isThisMonth ? dayNum : ''}</div>
        ${dots.length ? `<div class="cal-dots">${dots.map(c => `<div class="cal-dot" style="background:${c}"></div>`).join('')}</div>` : ''}
      </div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;
}

// ── Day events panel ──────────────────────────────────────────────────────────
function renderDayEvents(dateStr) {
  selectedDate = dateStr;

  const headerEl = document.getElementById('selected-day-header');
  const eventsEl = document.getElementById('day-events');

  const d = new Date(dateStr + 'T00:00:00');
  headerEl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const events = eventCache[dateStr] || [];

  // Sort: classes first (by time), then tasks, then reminders, then weddings
  const typeOrder = { class: 0, task: 1, reminder: 2, wedding: 3 };
  const sorted = [...events].sort((a, b) => {
    const to = (typeOrder[a.type] || 0) - (typeOrder[b.type] || 0);
    if (to !== 0) return to;
    return (a.meta || '').localeCompare(b.meta || '');
  });

  if (!sorted.length) {
    eventsEl.innerHTML = '<div style="color:var(--gray-400);font-size:14px;text-align:center;padding:20px">No events on this day</div>';
    return;
  }

  eventsEl.innerHTML = sorted.map(e => `
    <a href="${e.link}" class="cal-event-item" style="text-decoration:none;color:inherit">
      <div class="cal-event-stripe" style="background:${e.color}"></div>
      <div class="cal-event-content">
        <div class="cal-event-title">${e.title}</div>
        ${e.meta ? `<div class="cal-event-meta">${e.meta}</div>` : ''}
      </div>
    </a>`).join('');
}

window.selectDay = (dateStr) => {
  selectedDate = dateStr;
  renderGrid();
  renderDayEvents(dateStr);
};

// ── Init ──────────────────────────────────────────────────────────────────────
render();
