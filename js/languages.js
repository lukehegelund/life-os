// Life OS — Languages / SRS
import { supabase } from './supabase.js';
import { today, fmtDate, badge, toast, showSpinner, showEmpty } from './utils.js';
import { startPolling } from './polling.js';

const T = today();

let dueWords = [];
let currentIdx = 0;
let cardRevealed = false;
let activeLanguage = 'All';

async function load() {
  await Promise.all([loadStats(), loadDueWords(), loadBrowser()]);
}

async function loadStats() {
  const [totalRes, dueRes] = await Promise.all([
    supabase.from('vocab_words').select('language, srs_stage', { count: 'exact' }),
    supabase.from('vocab_words').select('language', { count: 'exact' }).lte('next_review', T)
  ]);

  const words = totalRes.data || [];
  const langs = ['Spanish', 'Danish', 'Russian'];
  const el = document.getElementById('lang-stats');
  el.innerHTML = `<div class="stats-grid">
    ${langs.map(lang => {
      const total = words.filter(w => w.language === lang).length;
      const due = (dueRes.data || []).filter(w => w.language === lang).length;
      if (!total) return '';
      return `
        <div class="stat-card">
          <div class="label">${lang}</div>
          <div class="value" style="color:var(--purple)">${total}</div>
          <div class="sublabel">${due > 0 ? `${due} due` : 'all done ✓'}</div>
        </div>`;
    }).join('')}
  </div>`;
}

async function loadDueWords() {
  const el = document.getElementById('flashcard-section');
  const query = supabase.from('vocab_words').select('*').lte('next_review', T);
  if (activeLanguage !== 'All') query.eq('language', activeLanguage);
  const res = await query.order('next_review').limit(20);
  dueWords = res.data || [];
  currentIdx = 0;
  cardRevealed = false;

  if (!dueWords.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🎉</div>No words due for review!</div>';
    return;
  }

  renderCard();
}

function renderCard() {
  const el = document.getElementById('flashcard-section');
  if (currentIdx >= dueWords.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">✅</div>Session complete! All reviewed.</div>';
    load(); // Refresh stats
    return;
  }

  const w = dueWords[currentIdx];
  const langColors = { Spanish: 'var(--coral)', Danish: 'var(--blue)', Russian: 'var(--purple)' };
  const color = langColors[w.language] || 'var(--purple)';

  el.innerHTML = `
    <div class="card" style="text-align:center;padding:24px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--gray-400);margin-bottom:8px">${w.language} · Stage ${w.srs_stage}/6 · ${currentIdx + 1}/${dueWords.length}</div>
      <div style="font-size:28px;font-weight:700;margin-bottom:8px;color:${color}">${w.english}</div>
      ${cardRevealed ? `
        <div style="font-size:24px;margin:16px 0;color:var(--gray-800)">${w.translation}</div>
        ${w.example_sentence ? `<div style="font-size:13px;color:var(--gray-400);font-style:italic;margin-bottom:16px">${w.example_sentence}</div>` : ''}
        <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
          <button class="btn btn-red" onclick="reviewWord(${w.id}, 'wrong')">✗ Wrong</button>
          <button class="btn btn-green" onclick="reviewWord(${w.id}, 'correct')">✓ Correct</button>
        </div>` : `
        <div style="margin:24px 0;color:var(--gray-400);font-size:14px">Think of the translation...</div>
        <button class="btn btn-primary btn-full" onclick="revealCard()">Reveal</button>`}
    </div>`;
}

window.revealCard = () => {
  cardRevealed = true;
  renderCard();
};

window.reviewWord = async (wordId, result) => {
  const w = dueWords[currentIdx];
  const oldStage = w.srs_stage;
  const newStage = result === 'correct' ? Math.min(oldStage + 1, 6) : Math.max(0, oldStage - 1);

  // SRS interval in days by stage
  const intervals = [1, 3, 7, 14, 30, 60, 120];
  const nextReview = new Date(Date.now() + intervals[newStage] * 86400000).toISOString().split('T')[0];

  const now = new Date().toISOString();
  await Promise.all([
    supabase.from('vocab_words').update({
      srs_stage: newStage,
      next_review: nextReview,
      last_reviewed: now,
      times_seen: w.times_seen + 1,
      times_correct: w.times_correct + (result === 'correct' ? 1 : 0),
      times_wrong: w.times_wrong + (result === 'wrong' ? 1 : 0)
    }).eq('id', wordId),
    supabase.from('srs_reviews').insert({
      word_id: wordId, reviewed_at: now, result, old_stage: oldStage, new_stage: newStage
    })
  ]);

  currentIdx++;
  cardRevealed = false;
  renderCard();
};

async function loadBrowser() {
  const el = document.getElementById('vocab-browser');
  const query = supabase.from('vocab_words').select('*').order('language').order('srs_stage').order('english');
  if (activeLanguage !== 'All') query.eq('language', activeLanguage);
  const res = await query;
  const words = res.data || [];
  if (!words.length) { showEmpty(el, '📖', 'No vocabulary added yet'); return; }

  const langColors = { Spanish: 'coral', Danish: 'blue', Russian: 'purple' };
  el.innerHTML = words.map(w => `
    <div class="list-item">
      <div class="list-item-left">
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge badge-${langColors[w.language] || 'gray'}">${w.language}</span>
          <strong>${w.english}</strong> → <span style="color:var(--purple)">${w.translation}</span>
        </div>
        <div class="list-item-sub">Stage ${w.srs_stage} · ${w.times_correct}✓ ${w.times_wrong}✗ · Next: ${w.next_review ? fmtDate(w.next_review) : '—'}</div>
      </div>
    </div>`).join('');
}

// Language filter
window.setLanguage = async (lang) => {
  activeLanguage = lang;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('btn-primary'));
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.add('btn-ghost'));
  document.getElementById(`lang-${lang.toLowerCase()}`).classList.replace('btn-ghost', 'btn-primary');
  await loadDueWords();
  await loadBrowser();
};

load();
startPolling(load, 30000);
