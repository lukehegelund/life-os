// Life OS — Spelling Tests Module
// Handles: entry logging, Drive file uploads, progress stats
// Used by: class.js (English classes only) and student.js

import { supabase } from './supabase.js';
import { fmtDate, toast, today } from './utils.js';

const DRIVE_UPLOAD_URL = 'https://kxsuzgpnvtepsyhkezin.supabase.co/functions/v1/drive-upload';

// ── Grade helpers ─────────────────────────────────────────────────────────────
function gradeColor(letter) {
  if (!letter) return 'var(--gray-400)';
  const l = letter.toUpperCase();
  if (l.startsWith('A')) return '#059669';
  if (l.startsWith('B')) return '#2563eb';
  if (l.startsWith('C')) return '#d97706';
  if (l.startsWith('D')) return '#ea580c';
  return '#dc2626';
}

function gradeBadge(letter) {
  if (!letter) return '';
  return `<span style="display:inline-block;font-weight:700;font-size:16px;color:${gradeColor(letter)};min-width:28px;text-align:center">${letter}</span>`;
}

function scoreStr(earned, total) {
  if (earned == null || total == null) return null;
  return `${earned}/${total}`;
}

// ── Stats computation ─────────────────────────────────────────────────────────
function computeStats(tests, cutoffDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cutoffDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const recent = tests.filter(t => t.test_date >= cutoffStr);
  if (!recent.length) return null;

  const gradeOrder = ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'];
  const gradeToNum = Object.fromEntries(gradeOrder.map((g, i) => [g, gradeOrder.length - i]));
  const grades = recent.map(t => t.letter_grade?.toUpperCase()).filter(g => g && gradeToNum[g] != null);
  if (!grades.length) return null;

  const avgNum = grades.reduce((s, g) => s + gradeToNum[g], 0) / grades.length;
  const closestGrade = gradeOrder.reduce((best, g) =>
    Math.abs(gradeToNum[g] - avgNum) < Math.abs(gradeToNum[best] - avgNum) ? g : best
  );

  // Trend: compare first half vs second half
  let trend = '→';
  if (grades.length >= 3) {
    const mid = Math.floor(grades.length / 2);
    const older = grades.slice(0, mid).map(g => gradeToNum[g]);
    const newer = grades.slice(mid).map(g => gradeToNum[g]);
    const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
    const avgNewer = newer.reduce((a, b) => a + b, 0) / newer.length;
    if (avgNewer > avgOlder + 0.5) trend = '↑';
    else if (avgNewer < avgOlder - 0.5) trend = '↓';
  }

  return { avg: closestGrade, count: recent.length, trend, color: gradeColor(closestGrade) };
}

function renderStats(tests) {
  const s30 = computeStats(tests, 30);
  const s90 = computeStats(tests, 90);
  if (!s30 && !s90) return '';

  const statBox = (label, s) => s ? `
    <div style="flex:1;min-width:80px;background:var(--gray-50);border-radius:8px;padding:8px 10px;text-align:center">
      <div style="font-size:20px;font-weight:700;color:${s.color}">${s.avg} <span style="font-size:14px">${s.trend}</span></div>
      <div style="font-size:11px;color:var(--gray-400)">${label} · ${s.count} test${s.count !== 1 ? 's' : ''}</div>
    </div>` : '';

  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    ${statBox('30 days', s30)}
    ${statBox('90 days', s90)}
  </div>`;
}

// ── Entry list ─────────────────────────────────────────────────────────────────
function renderEntry(t) {
  const scores = [
    scoreStr(t.spelling_score_earned, t.spelling_score_total) ? `Spelling: ${scoreStr(t.spelling_score_earned, t.spelling_score_total)}` : null,
    scoreStr(t.definitions_score_earned, t.definitions_score_total) ? `Defs: ${scoreStr(t.definitions_score_earned, t.definitions_score_total)}` : null,
    t.handwriting_score != null ? `Writing: ${t.handwriting_score}/5` : null,
    t.formatting_score != null ? `Format: ${t.formatting_score}/5` : null,
  ].filter(Boolean);

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--gray-100)">
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          ${gradeBadge(t.letter_grade)}
          <span style="font-size:13px;color:var(--gray-600)">${fmtDate(t.test_date)}</span>
        </div>
        ${scores.length ? `<div style="font-size:12px;color:var(--gray-400);margin-top:3px">${scores.join(' · ')}</div>` : ''}
      </div>
      <button onclick="window.deleteSpellingTest(${t.id})" style="background:none;border:none;cursor:pointer;color:var(--gray-300);font-size:16px;padding:2px 4px" title="Delete">✕</button>
    </div>`;
}

// ── Add Entry Form ─────────────────────────────────────────────────────────────
function addEntryFormHtml(studentId, classId) {
  return `
    <div id="st-form-${studentId}" style="display:none;margin-top:10px;padding:12px;background:var(--gray-50);border-radius:10px">
      <div style="font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:10px">📝 Add Spelling Test Entry</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label style="font-size:12px;color:var(--gray-500);display:block;margin-bottom:3px">Date *</label>
          <input type="date" id="st-date-${studentId}" value="${today()}"
            style="width:100%;border:1px solid var(--gray-200);border-radius:6px;padding:6px 8px;font-size:13px;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:12px;color:var(--gray-500);display:block;margin-bottom:3px">Letter Grade *</label>
          <select id="st-grade-${studentId}"
            style="width:100%;border:1px solid var(--gray-200);border-radius:6px;padding:6px 8px;font-size:13px;box-sizing:border-box">
            <option value="">— Select —</option>
            ${['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'].map(g => `<option>${g}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label style="font-size:12px;color:var(--gray-500);display:block;margin-bottom:3px">Handwriting _/5</label>
          <input type="number" id="st-hw-${studentId}" min="0" max="5" placeholder="e.g. 4"
            style="width:100%;border:1px solid var(--gray-200);border-radius:6px;padding:6px 8px;font-size:13px;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:12px;color:var(--gray-500);display:block;margin-bottom:3px">Formatting _/5</label>
          <input type="number" id="st-fmt-${studentId}" min="0" max="5" placeholder="e.g. 5"
            style="width:100%;border:1px solid var(--gray-200);border-radius:6px;padding:6px 8px;font-size:13px;box-sizing:border-box">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="grid-column:span 2">
          <label style="font-size:12px;color:var(--gray-500);display:block;margin-bottom:3px">Spelling _/_</label>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="st-sp-earned-${studentId}" min="0" placeholder="earned"
              style="flex:1;border:1px solid var(--gray-200);border-radius:6px;padding:6px 8px;font-size:13px">
            <span style="color:var(--gray-400)">/</span>
            <input type="number" id="st-sp-total-${studentId}" min="0" placeholder="total"
              style="flex:1;border:1px solid var(--gray-200);border-radius:6px;padding:6px 8px;font-size:13px">
          </div>
        </div>
        <div style="grid-column:span 2">
          <label style="font-size:12px;color:var(--gray-500);display:block;margin-bottom:3px">Definitions _/_</label>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="st-def-earned-${studentId}" min="0" placeholder="earned"
              style="flex:1;border:1px solid var(--gray-200);border-radius:6px;padding:6px 8px;font-size:13px">
            <span style="color:var(--gray-400)">/</span>
            <input type="number" id="st-def-total-${studentId}" min="0" placeholder="total"
              style="flex:1;border:1px solid var(--gray-200);border-radius:6px;padding:6px 8px;font-size:13px">
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="window.saveSpellingEntry(${studentId}, ${classId})"
          class="btn btn-primary btn-sm" style="flex:1">Save Entry</button>
        <button onclick="document.getElementById('st-form-${studentId}').style.display='none'"
          class="btn btn-ghost btn-sm">Cancel</button>
      </div>
    </div>`;
}

// ── Main render: one student block ─────────────────────────────────────────────
export function renderSpellingStudentBlock(student, tests, classId) {
  const folderUrl = student.spelling_test_folder_id
    ? `https://drive.google.com/drive/folders/${student.spelling_test_folder_id}`
    : null;

  const recent5 = (tests || []).slice(0, 5);
  const statsHtml = renderStats(tests || []);
  const entriesHtml = recent5.length
    ? recent5.map(renderEntry).join('')
    : '<div style="font-size:13px;color:var(--gray-400);padding:8px 0">No entries yet</div>';

  const moreCount = (tests || []).length - 5;

  return `
    <div style="border:1px solid var(--gray-100);border-radius:10px;padding:12px;margin-bottom:10px">
      <!-- Student header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:15px;font-weight:600;color:var(--gray-800)">${student.name}</div>
        <div style="display:flex;gap:6px;align-items:center">
          ${folderUrl ? `<a href="${folderUrl}" target="_blank" rel="noopener"
            style="font-size:12px;color:var(--blue);text-decoration:none;white-space:nowrap">
            📂 Drive Folder
          </a>` : ''}
          <label title="Upload spelling test to Drive folder"
            style="cursor:pointer;font-size:12px;background:var(--gray-100);color:var(--gray-600);padding:4px 8px;border-radius:6px;white-space:nowrap">
            ⬆️ Upload
            <input type="file" accept="image/*,application/pdf" style="display:none"
              onchange="window.uploadSpellingTest(event, ${student.id}, '${student.spelling_test_folder_id || ''}', '${escapeHtml(student.name)}')">
          </label>
          <button onclick="window.toggleSpellingForm(${student.id})"
            style="font-size:12px;background:var(--blue-light,#EFF6FF);color:var(--blue);border:none;border-radius:6px;padding:4px 8px;cursor:pointer;white-space:nowrap">
            + Entry
          </button>
        </div>
      </div>

      <!-- Stats -->
      ${statsHtml}

      <!-- Recent entries -->
      <div id="st-entries-${student.id}">
        ${entriesHtml}
        ${moreCount > 0 ? `<div style="font-size:12px;color:var(--gray-400);margin-top:6px">+${moreCount} older entries</div>` : ''}
      </div>

      <!-- Add entry form -->
      ${addEntryFormHtml(student.id, classId)}
    </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ── Fetch tests for a list of student IDs ─────────────────────────────────────
export async function fetchSpellingTestsByClass(classId) {
  const { data, error } = await supabase
    .from('spelling_tests')
    .select('*')
    .eq('class_id', classId)
    .order('test_date', { ascending: false });
  if (error) { console.error('spelling_tests fetch error:', error); return {}; }
  // Group by student_id
  const byStudent = {};
  for (const t of (data || [])) {
    if (!byStudent[t.student_id]) byStudent[t.student_id] = [];
    byStudent[t.student_id].push(t);
  }
  return byStudent;
}

export async function fetchSpellingTestsByStudent(studentId) {
  const { data, error } = await supabase
    .from('spelling_tests')
    .select('*')
    .eq('student_id', studentId)
    .order('test_date', { ascending: false });
  if (error) { console.error('spelling_tests fetch error:', error); return []; }
  return data || [];
}

// ── Global handlers (called from inline HTML onclick) ────────────────────────
window.toggleSpellingForm = (studentId) => {
  const el = document.getElementById(`st-form-${studentId}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window.saveSpellingEntry = async (studentId, classId) => {
  const date   = document.getElementById(`st-date-${studentId}`)?.value;
  const grade  = document.getElementById(`st-grade-${studentId}`)?.value;
  if (!date || !grade) { toast('Date and letter grade are required', 'error'); return; }

  const hwRaw   = document.getElementById(`st-hw-${studentId}`)?.value;
  const fmtRaw  = document.getElementById(`st-fmt-${studentId}`)?.value;
  const spE     = document.getElementById(`st-sp-earned-${studentId}`)?.value;
  const spT     = document.getElementById(`st-sp-total-${studentId}`)?.value;
  const defE    = document.getElementById(`st-def-earned-${studentId}`)?.value;
  const defT    = document.getElementById(`st-def-total-${studentId}`)?.value;

  const entry = {
    student_id: Number(studentId),
    class_id:   Number(classId),
    test_date:  date,
    letter_grade: grade,
    handwriting_score: hwRaw !== '' && hwRaw != null ? Number(hwRaw) : null,
    formatting_score:  fmtRaw !== '' && fmtRaw != null ? Number(fmtRaw) : null,
    spelling_score_earned: spE !== '' && spE != null ? Number(spE) : null,
    spelling_score_total:  spT !== '' && spT != null ? Number(spT) : null,
    definitions_score_earned: defE !== '' && defE != null ? Number(defE) : null,
    definitions_score_total:  defT !== '' && defT != null ? Number(defT) : null,
  };

  const { error } = await supabase.from('spelling_tests').insert(entry);
  if (error) { toast('Error saving: ' + error.message, 'error'); return; }

  toast('Entry saved ✓', 'success');
  document.getElementById(`st-form-${studentId}`).style.display = 'none';

  // Reload the section
  if (window._reloadSpellingSection) window._reloadSpellingSection();
};

window.deleteSpellingTest = async (testId) => {
  if (!confirm('Delete this spelling test entry?')) return;
  const { error } = await supabase.from('spelling_tests').delete().eq('id', testId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Deleted', 'info');
  if (window._reloadSpellingSection) window._reloadSpellingSection();
};

window.uploadSpellingTest = async (event, studentId, folderId, studentName) => {
  const file = event.target.files[0];
  if (!file || !folderId) {
    toast('No Drive folder configured for this student', 'error');
    return;
  }

  const d = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const safeName = studentName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
  const ext = file.name.split('.').pop() || 'pdf';
  const fileName = `${safeName}_${d}.${ext}`;

  toast('Uploading to Drive…', 'info');

  try {
    const fd = new FormData();
    fd.append('file', file, fileName);
    fd.append('folderId', folderId);
    fd.append('fileName', fileName);

    const res = await fetch(DRIVE_UPLOAD_URL, { method: 'POST', body: fd });
    const json = await res.json();

    if (!res.ok || json.error) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }

    toast(`Uploaded: ${fileName} ✓`, 'success');
    // Reset the input
    event.target.value = '';
  } catch (e) {
    toast('Upload failed: ' + e.message, 'error');
    console.error('Drive upload error:', e);
  }
};
