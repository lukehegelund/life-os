// Life OS — Languages (Flashcards + Translator + Vocab Browser)
import { supabase } from './supabase.js';
import { today, fmtDate, toast, showSpinner, showEmpty, pstDatePlusDays } from './utils.js';
// No polling — user-driven

const T = today();

let dueWords = [];
let currentIdx = 0;
let cardRevealed = false;
let activeLanguage = 'All';
let activeTab = 'flashcards';
let transLang = 'All';
let allWords = [];  // cached for translator search
let transDebounce = null;

// ── Tab switching ─────────────────────────────────────────────────────────────
window.switchTab = (tab) => {
  activeTab = tab;
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
  if (tab === 'vocab') loadBrowser();
};

// ── Language filter ───────────────────────────────────────────────────────────
window.setLanguage = async (lang) => {
  activeLanguage = lang;
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-ghost');
  });
  document.getElementById(`lang-${lang}`).classList.replace('btn-ghost', 'btn-primary');
  await loadDueWords();
  if (activeTab === 'vocab') loadBrowser();
};

window.setTransLang = (lang) => {
  transLang = lang;
  document.querySelectorAll('.trans-lang-btn').forEach(b => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-ghost');
  });
  const tlBtn = document.getElementById(`tlang-${lang}`);
  if (tlBtn) tlBtn.classList.replace('btn-ghost', 'btn-primary');
  handleTranslatorInput();
};

// ── Load all ──────────────────────────────────────────────────────────────────
async function load() {
  await Promise.all([loadStats(), loadDueWords(), prefetchAllWords()]);
}

async function loadStats() {
  const [totalRes, dueRes] = await Promise.all([
    supabase.from('vocab_words').select('language, srs_stage'),
    supabase.from('vocab_words').select('language').lte('next_review', T),
  ]);

  const words = totalRes.data || [];
  const langs = ['Spanish', 'Danish', 'Russian'];
  const dueByLang = {};
  for (const w of (dueRes.data || [])) {
    dueByLang[w.language] = (dueByLang[w.language] || 0) + 1;
  }

  const parts = langs
    .map(l => {
      const cnt = words.filter(w => w.language === l).length;
      if (!cnt) return null;
      const due = dueByLang[l] || 0;
      return `${l}: ${cnt} (${due} due)`;
    })
    .filter(Boolean);

  const sumEl = document.getElementById('lang-summary');
  if (sumEl) sumEl.textContent = parts.join(' · ');

  const totalDue = dueRes.data?.length || 0;
  const el = document.getElementById('flashcard-section');
  if (!el) return;
  // summary pill at top of flashcard tab
  const existing = document.getElementById('fc-summary');
  if (!existing) {
    const pill = document.createElement('div');
    pill.id = 'fc-summary';
    pill.style = 'text-align:center;font-size:13px;color:var(--gray-400);margin-bottom:10px';
    el.parentElement.insertBefore(pill, el);
  }
  const fcSum = document.getElementById('fc-summary');
  if (fcSum) fcSum.textContent = `${totalDue} word${totalDue !== 1 ? 's' : ''} due for review`;
}

async function prefetchAllWords() {
  const res = await supabase.from('vocab_words')
    .select('id, english, translation, language, srs_stage, example_sentence, next_review')
    .order('language')
    .order('english');
  allWords = res.data || [];
}

// ── Flashcards ────────────────────────────────────────────────────────────────
async function loadDueWords() {
  const el = document.getElementById('flashcard-section');
  if (!el) return;
  showSpinner(el);

  let query = supabase.from('vocab_words').select('*').lte('next_review', T);
  if (activeLanguage !== 'All') query = query.eq('language', activeLanguage);
  const res = await query.order('next_review').limit(30);

  dueWords = res.data || [];
  currentIdx = 0;
  cardRevealed = false;

  if (!dueWords.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🎉</div>No words due — great job!</div>';
    return;
  }

  renderCard();
}

function renderCard() {
  const el = document.getElementById('flashcard-section');
  if (!el) return;

  if (currentIdx >= dueWords.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">✅</div>Session complete! All reviewed.</div>';
    load();
    return;
  }

  const w = dueWords[currentIdx];
  const langColors = { Spanish: 'var(--coral)', Danish: 'var(--blue)', Russian: 'var(--purple)' };
  const color = langColors[w.language] || 'var(--purple)';

  el.innerHTML = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--gray-400);margin-bottom:8px">
        ${w.language} · Stage ${w.srs_stage}/6 · ${currentIdx + 1} of ${dueWords.length}
      </div>
      <div style="font-size:30px;font-weight:700;margin-bottom:4px;color:${color}">${w.english}</div>
      ${cardRevealed ? `
        <div style="font-size:22px;margin:16px 0 8px;color:var(--gray-800)">${w.translation}</div>
        ${w.example_sentence ? `<div style="font-size:13px;color:var(--gray-400);font-style:italic;margin-bottom:12px;padding:0 16px">"${w.example_sentence}"</div>` : ''}
        <div style="display:flex;gap:12px;justify-content:center;margin-top:20px">
          <button class="btn btn-red" onclick="reviewWord(${w.id}, 'wrong')">✗ Wrong</button>
          <button class="btn btn-green" onclick="reviewWord(${w.id}, 'correct')">✓ Correct</button>
        </div>
        <div style="font-size:12px;color:var(--gray-400);margin-top:12px">${w.times_correct}✓ ${w.times_wrong}✗ so far</div>
      ` : `
        <div style="margin:24px 0;color:var(--gray-400);font-size:14px">Think of the translation…</div>
        <button class="btn btn-primary btn-full" onclick="revealCard()">Reveal</button>
        <button class="btn btn-ghost btn-full" style="margin-top:8px" onclick="skipCard()">Skip →</button>
      `}
    </div>`;
}

window.revealCard = () => {
  cardRevealed = true;
  renderCard();
};

window.skipCard = () => {
  currentIdx++;
  cardRevealed = false;
  renderCard();
};

window.reviewWord = async (wordId, result) => {
  const w = dueWords[currentIdx];
  const oldStage = w.srs_stage;
  const newStage = result === 'correct' ? Math.min(oldStage + 1, 6) : Math.max(0, oldStage - 1);
  const intervals = [0, 3, 7, 14, 30, 60, 120]; // stage 0 = same day, so new words stay reviewable today
  const nextReview = pstDatePlusDays(intervals[newStage]);
  const now = new Date().toISOString();

  await Promise.all([
    supabase.from('vocab_words').update({
      srs_stage: newStage, next_review: nextReview, last_reviewed: now,
      times_seen: (w.times_seen || 0) + 1,
      times_correct: (w.times_correct || 0) + (result === 'correct' ? 1 : 0),
      times_wrong: (w.times_wrong || 0) + (result === 'wrong' ? 1 : 0),
    }).eq('id', wordId),
    supabase.from('srs_reviews').insert({
      word_id: wordId, reviewed_at: now, result, old_stage: oldStage, new_stage: newStage,
    }),
  ]);

  currentIdx++;
  cardRevealed = false;
  renderCard();
};

// ── Translator / Lookup ───────────────────────────────────────────────────────
window.handleTranslatorInput = () => {
  clearTimeout(transDebounce);
  transDebounce = setTimeout(runTranslatorSearch, 200);
};

function runTranslatorSearch() {
  const q = (document.getElementById('trans-input')?.value || '').toLowerCase().trim();
  const el = document.getElementById('trans-results');
  if (!el) return;

  if (!q) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px;text-align:center;padding:20px">Type to search your vocabulary…</div>';
    return;
  }

  const langColors = { Spanish: 'coral', Danish: 'blue', Russian: 'purple' };
  let pool = allWords;
  if (transLang !== 'All') pool = pool.filter(w => w.language === transLang);

  const results = pool.filter(w =>
    w.english.toLowerCase().includes(q) ||
    w.translation.toLowerCase().includes(q) ||
    (w.example_sentence || '').toLowerCase().includes(q)
  ).slice(0, 20);

  if (!results.length) {
    el.innerHTML = `<div style="color:var(--gray-400);font-size:14px;text-align:center;padding:20px">No matches found for "<strong>${q}</strong>"</div>`;
    return;
  }

  el.innerHTML = results.map(w => `
    <div class="list-item">
      <div class="list-item-left">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="badge badge-${langColors[w.language] || 'gray'}">${w.language}</span>
          <strong>${w.english}</strong>
          <span style="color:var(--gray-400)">→</span>
          <span style="color:var(--purple);font-weight:600">${w.translation}</span>
        </div>
        ${w.example_sentence ? `<div class="list-item-sub" style="font-style:italic">"${w.example_sentence}"</div>` : ''}
        <div class="list-item-sub">Stage ${w.srs_stage} · Next: ${w.next_review ? fmtDate(w.next_review) : '—'}</div>
      </div>
    </div>`).join('');
}

window.addWord = async () => {
  const english = document.getElementById('add-english')?.value.trim();
  const translation = document.getElementById('add-translation')?.value.trim();
  const language = document.getElementById('add-language')?.value;
  const example_sentence = document.getElementById('add-example')?.value.trim() || null;

  if (!english || !translation || !language) {
    toast('Please fill in English, translation, and language', 'error');
    return;
  }

  const { error } = await supabase.from('vocab_words').insert({
    english, translation, language, example_sentence,
    srs_stage: 0,
    next_review: T,
    times_seen: 0, times_correct: 0, times_wrong: 0,
  });

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  toast(`"${english}" added to ${language}!`, 'success');
  document.getElementById('add-english').value = '';
  document.getElementById('add-translation').value = '';
  document.getElementById('add-example').value = '';

  // Refresh cache + stats + flashcard queue
  await prefetchAllWords();
  await Promise.all([loadStats(), loadDueWords()]);
  if (activeTab === 'vocab') loadBrowser();
};

// ── Vocabulary Browser ────────────────────────────────────────────────────────
async function loadBrowser() {
  const el = document.getElementById('vocab-browser');
  if (!el) return;
  showSpinner(el);

  let query = supabase.from('vocab_words')
    .select('*')
    .order('language')
    .order('srs_stage')
    .order('english');
  if (activeLanguage !== 'All') query = query.eq('language', activeLanguage);
  const res = await query;
  const words = res.data || [];

  const countEl = document.getElementById('vocab-count');
  if (countEl) countEl.textContent = `${words.length} word${words.length !== 1 ? 's' : ''}`;

  if (!words.length) { showEmpty(el, '📖', 'No vocabulary yet — add some in the Translator tab!'); return; }

  const langColors = { Spanish: 'coral', Danish: 'blue', Russian: 'purple' };
  el.innerHTML = words.map(w => `
    <div class="list-item">
      <div class="list-item-left">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="badge badge-${langColors[w.language] || 'gray'}">${w.language}</span>
          <strong>${w.english}</strong>
          <span style="color:var(--gray-400)">→</span>
          <span style="color:var(--purple)">${w.translation}</span>
        </div>
        <div class="list-item-sub">Stage ${w.srs_stage} · ${w.times_correct}✓ ${w.times_wrong}✗ · Next: ${w.next_review ? fmtDate(w.next_review) : '—'}</div>
      </div>
    </div>`).join('');
}

load();
