// Life OS — Tasks (v9: schedule labels, reordering, recurring Today auto-flag)
import { supabase } from './supabase.js';
import { today, fmtDate, toast, showEmpty } from './utils.js';
import { initSwipe } from './swipe-handler.js';

const T = today();
let activeModule = 'All';
let activeScheduleFilter = 'All'; // 'All', 'Today', 'Next Up', 'Later', 'Down the Road', 'Unlabeled'
// User-defined category order (persisted in localStorage)
let categoryOrder = JSON.parse(localStorage.getItem('tasks-cat-order') || 'null') || ['RT', 'RT Admin', 'TOV', 'Personal', 'Health', 'LifeOS'];
// Task order within each group: { groupKey: [id, id, ...] }
let taskOrderMap = JSON.parse(localStorage.getItem('tasks-item-order') || '{}');

const MODULE_ICONS   = { RT: '🏫', 'RT Admin': '🏛️', TOV: '💍', Personal: '👤', Health: '🏃', LifeOS: '🖥️' };
const MODULE_COLORS  = { RT: 'var(--blue)', 'RT Admin': '#7c3aed', TOV: 'var(--green)', Personal: 'var(--orange)', Health: 'var(--coral)', LifeOS: '#0891b2' };

const SCHEDULE_LABELS = ['Today', 'Next Up', 'Later', 'Down the Road'];
const SCHEDULE_COLORS = {
  'Today':         { bg: '#fef9c3', color: '#92400e', border: '#fde68a' },
  'Next Up':       { bg: '#eff6ff', color: 'var(--blue)', border: '#bfdbfe' },
  'Later':         { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' },
  'Down the Road': { bg: 'var(--gray-50)', color: 'var(--gray-400)', border: 'var(--gray-200)' },
};

// ── Notes JSON helpers ────────