'use strict';

// ─── LC Call Number Parser ────────────────────────────────────────────────────

/**
 * Normalize common OCR substitutions before parsing.
 */
function ocrNormalize(text) {
  return text
    .replace(/[,]/g, '.')          // comma → period (label separators)
    .replace(/\bO\b/g, '0')        // standalone O → 0
    .replace(/(?<=[A-Z])l(?=\d)/g, '1')  // letter l after class letter before digit → 1
    .replace(/(?<=\d)l/g, '1')     // digit-l → digit-1
    .trim();
}

/**
 * Parse a single candidate string into an LC call number object.
 * Returns null if it doesn't look like an LC call number.
 *
 * Object shape:
 * {
 *   raw: string,          // original text used for parse
 *   letters: string,      // e.g. "UA"
 *   classNum: number,     // e.g. 163
 *   classDecimal: number, // e.g. 0.5 (0 if none)
 *   cutter1Letter: string,
 *   cutter1Num: number,   // as decimal, e.g. .S66 → 0.66
 *   cutter2Letter: string,
 *   cutter2Num: number,
 *   year: number,         // 0 if none
 *   uncertain: boolean,
 *   display: string,      // nicely formatted
 * }
 */
function parseLCCallNumber(raw) {
  // Collapse whitespace and uppercase everything
  let s = raw.replace(/\s+/g, ' ').trim().toUpperCase();

  // Common OCR normalization
  s = s
    .replace(/,/g, '.')
    .replace(/(?<=[A-Z])l(?=\d)/g, '1')
    .replace(/(?<=\d)l(?=\d)/g, '1');

  // Extended regex that handles multi-token input (class letters may be
  // on a separate token from the class number after OCR/line-split)
  const RE = /^([A-Z]{1,3})\s*(\d+)(\.\d+)?\s*(?:\.([A-Z]\d+(?:\.\d+)?))?\s*(?:\.?([A-Z]\d+(?:\.\d+)?))?\s*(\b(?:1[89]\d{2}|20[0-4]\d)\b)?/;

  const m = RE.exec(s);
  if (!m) return null;

  const letters = m[1];
  const classNum = parseInt(m[2], 10);
  const classDecimal = m[3] ? parseFloat(m[3]) : 0;

  const parseCutter = (str) => {
    if (!str) return { letter: '', num: 0 };
    // Strip leading dot if present
    const clean = str.replace(/^\./, '');
    const letter = clean[0] || '';
    const digits = clean.slice(1);
    // Treat digits as decimal: "66" → 0.66, "946" → 0.946
    const num = digits ? parseFloat('0.' + digits) : 0;
    return { letter, num };
  };

  const c1 = parseCutter(m[4]);
  const c2 = parseCutter(m[5]);
  const year = m[6] ? parseInt(m[6], 10) : 0;

  // Heuristic: flag uncertain if matched text is shorter than input (extra junk)
  const matchedLen = (m[0] || '').length;
  const uncertain = matchedLen < s.length - 3;

  // Build display string
  let display = letters + ' ' + classNum;
  if (classDecimal) display += classDecimal.toString().slice(1); // ".5"
  if (c1.letter) display += ' .' + c1.letter + (c1.num ? String(c1.num).slice(2) : '');
  if (c2.letter) display += ' .' + c2.letter + (c2.num ? String(c2.num).slice(2) : '');
  if (year) display += ' ' + year;

  return {
    raw,
    letters,
    classNum,
    classDecimal,
    cutter1Letter: c1.letter,
    cutter1Num: c1.num,
    cutter2Letter: c2.letter,
    cutter2Num: c2.num,
    year,
    uncertain,
    display: display.trim(),
  };
}

/**
 * Compare two parsed LC call number objects.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareLCCallNumbers(a, b) {
  // 1. Class letters alphabetically
  if (a.letters < b.letters) return -1;
  if (a.letters > b.letters) return 1;

  // 2. Class number as integer
  if (a.classNum !== b.classNum) return a.classNum - b.classNum;

  // 3. Class decimal as decimal
  if (a.classDecimal !== b.classDecimal) return a.classDecimal - b.classDecimal;

  // 4. First cutter letter
  if (a.cutter1Letter < b.cutter1Letter) return -1;
  if (a.cutter1Letter > b.cutter1Letter) return 1;

  // 5. First cutter number as decimal
  if (a.cutter1Num !== b.cutter1Num) return a.cutter1Num - b.cutter1Num;

  // 6. Second cutter letter
  if (a.cutter2Letter < b.cutter2Letter) return -1;
  if (a.cutter2Letter > b.cutter2Letter) return 1;

  // 7. Second cutter number as decimal
  if (a.cutter2Num !== b.cutter2Num) return a.cutter2Num - b.cutter2Num;

  // 8. Year
  return a.year - b.year;
}

/**
 * Given an array of parsed call numbers (in shelf order), determine
 * which are out of order. Returns array of status objects:
 * { index, item, status: 'correct'|'wrong'|'uncertain', hint }
 */
function checkShelfOrder(items) {
  const results = items.map((item, i) => ({
    index: i,
    item,
    status: item.uncertain ? 'uncertain' : 'correct',
    hint: item.uncertain ? 'Uncertain parse — please verify' : '',
  }));

  // Find the longest increasing subsequence (LIS) positions to determine
  // the minimal set of items that are out of order.
  // Simpler approach: mark item as wrong if it's less than the previous
  // non-wrong item.
  let lastGoodParsed = null;
  let lastGoodIndex = -1;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.item.uncertain) continue; // skip uncertain for ordering checks

    if (lastGoodParsed === null) {
      lastGoodParsed = r.item;
      lastGoodIndex = i;
      continue;
    }

    const cmp = compareLCCallNumbers(lastGoodParsed, r.item);

    if (cmp <= 0) {
      // In order
      lastGoodParsed = r.item;
      lastGoodIndex = i;
    } else {
      // Out of order: this item should come before lastGood
      r.status = 'wrong';
      // Find where this item actually belongs (first position where prev <= item < next)
      let shouldBeAfter = -1;
      for (let j = 0; j < i; j++) {
        if (results[j].item.uncertain) continue;
        if (compareLCCallNumbers(results[j].item, r.item) <= 0) {
          shouldBeAfter = j;
        } else {
          break;
        }
      }
      if (shouldBeAfter === -1) {
        r.hint = `Should be before position 1 (${results[0].item.display})`;
      } else {
        const after = results[shouldBeAfter].item.display;
        const next = shouldBeAfter + 1 < results.length ? results[shouldBeAfter + 1].item.display : null;
        r.hint = next
          ? `Should be between #${shouldBeAfter + 1} (${after}) and #${shouldBeAfter + 2} (${next})`
          : `Should be after #${shouldBeAfter + 1} (${after})`;
      }
    }
  }

  return results;
}

// ─── OCR text → call numbers ──────────────────────────────────────────────────

/**
 * Given raw OCR text, extract LC call numbers.
 *
 * Strategy: sliding window over non-empty lines, trying 1–5 consecutive
 * lines per window. De-duplicate by preferring non-uncertain parses, then
 * shorter (tighter) spans so one label doesn't consume the next.
 * Blank-line boundaries are injected as hard stops: a window cannot cross
 * a blank line (blank lines reliably separate distinct labels in most OCR).
 */
function extractCallNumbersFromOCR(ocrText) {
  // Build an array of non-empty lines, recording which belong to which block.
  // Lines within the same blank-line-delimited block share a blockId.
  const rawLines = ocrText.split('\n');
  const lines = [];     // { text, blockId }
  let blockId = 0;
  let prevBlank = true;
  for (const raw of rawLines) {
    const t = raw.trim();
    if (!t) { if (!prevBlank) blockId++; prevBlank = true; continue; }
    lines.push({ text: t, blockId });
    prevBlank = false;
  }

  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    for (let len = 1; len <= 5 && i + len <= lines.length; len++) {
      // Do not cross a block boundary
      if (lines[i + len - 1].blockId !== lines[i].blockId) break;
      const joined = lines.slice(i, i + len).map(l => l.text).join(' ');
      const parsed = parseLCCallNumber(joined);
      if (parsed && parsed.letters && parsed.classNum > 0) {
        candidates.push({ parsed, startLine: i, endLine: i + len - 1, span: len });
      }
    }
  }

  if (candidates.length === 0) return [];

  // Sort: by start line, then prefer non-uncertain, then prefer shorter span
  // (shorter = tighter match, less likely to bleed into next label)
  candidates.sort((a, b) =>
    a.startLine - b.startLine ||
    (a.parsed.uncertain ? 1 : 0) - (b.parsed.uncertain ? 1 : 0) ||
    a.span - b.span
  );

  const deduped = [];
  const usedLines = new Set();

  for (const c of candidates) {
    let alreadyUsed = false;
    for (let l = c.startLine; l <= c.endLine; l++) {
      if (usedLines.has(l)) { alreadyUsed = true; break; }
    }
    if (!alreadyUsed) {
      deduped.push(c.parsed);
      for (let l = c.startLine; l <= c.endLine; l++) usedLines.add(l);
    }
  }

  return deduped;
}

// ─── App State ────────────────────────────────────────────────────────────────

const state = {
  stream: null,
  capturedImageURL: null,
  parsedItems: [],    // array of parsed call number objects
  checkResults: [],   // from checkShelfOrder()
};

// ─── DOM References ───────────────────────────────────────────────────────────

const screens = {
  camera: document.getElementById('camera-screen'),
  processing: document.getElementById('processing-screen'),
  results: document.getElementById('results-screen'),
};

const video = document.getElementById('video');
const canvas = document.getElementById('capture-canvas');
const cameraError = document.getElementById('camera-error');
const btnScan = document.getElementById('btn-scan');
const btnRetry = document.getElementById('btn-retry-camera');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const captureThumb = document.getElementById('capture-thumb');
const cnList = document.getElementById('cn-list');
const summaryBar = document.getElementById('summary-bar');
const addCnInput = document.getElementById('add-cn-input');
const btnAddCn = document.getElementById('btn-add-cn');
const btnScanAgain = document.getElementById('btn-scan-again');
const btnManualEntry = document.getElementById('btn-manual-entry');
const toast = document.getElementById('toast');

// ─── Screen Navigation ────────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
}

// ─── Camera ───────────────────────────────────────────────────────────────────

async function startCamera() {
  cameraError.style.display = 'none';
  video.style.display = 'block';

  try {
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = state.stream;
    await video.play();
  } catch (err) {
    console.error('Camera error:', err);
    video.style.display = 'none';
    cameraError.style.display = 'flex';

    const msg = cameraError.querySelector('p');
    if (err.name === 'NotAllowedError') {
      msg.textContent = 'Camera access was denied. Please allow camera access in your browser settings, then reload the page.';
    } else if (err.name === 'NotFoundError') {
      msg.textContent = 'No camera found on this device.';
    } else {
      msg.textContent = `Camera error: ${err.message}. Try using HTTPS or a different browser.`;
    }
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
}

function captureFrame() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.92);
}

// ─── Vision extraction ────────────────────────────────────────────────────────

/**
 * Send the captured image to the server, which calls OpenAI vision
 * and returns an array of call number strings in left-to-right shelf order.
 */
async function extractFromVision(imageDataURL) {
  progressLabel.textContent = 'Reading labels…';
  progressBar.style.width = '40%';

  const res = await fetch('/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataURL }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }

  progressBar.style.width = '100%';
  const { callNumbers } = await res.json();
  return callNumbers;
}

// ─── Render Results ───────────────────────────────────────────────────────────

function renderResults() {
  const results = state.checkResults;

  // Summary
  const total = results.length;
  const wrong = results.filter(r => r.status === 'wrong').length;
  const uncertain = results.filter(r => r.status === 'uncertain').length;
  const correct = total - wrong - uncertain;

  summaryBar.innerHTML = '';
  if (total === 0) {
    summaryBar.innerHTML = '<span class="badge badge-yellow">No call numbers found</span>';
  } else {
    if (correct > 0) summaryBar.innerHTML += `<span class="badge badge-green">✓ ${correct} in order</span>`;
    if (wrong > 0)   summaryBar.innerHTML += `<span class="badge badge-red">✗ ${wrong} out of order</span>`;
    if (uncertain > 0) summaryBar.innerHTML += `<span class="badge badge-yellow">? ${uncertain} uncertain</span>`;
  }

  // List
  cnList.innerHTML = '';

  if (total === 0) {
    cnList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>No LC call numbers detected.<br>Try adding them manually below.</p>
      </div>`;
    return;
  }

  results.forEach((r, i) => {
    const item = cnList.appendChild(document.createElement('div'));
    item.className = `cn-item ${r.status}`;
    item.dataset.index = i;

    const icon = r.status === 'correct' ? '✓' : r.status === 'wrong' ? '✗' : '?';

    item.innerHTML = `
      <div class="cn-item-header">
        <div class="cn-index">${i + 1}</div>
        <div class="cn-text-wrap">
          <div class="cn-raw">${escHtml(r.item.display)}</div>
          <div class="cn-parsed">${formatParsedMeta(r.item)}</div>
        </div>
        <button class="btn-edit-toggle" title="Edit" aria-label="Edit call number">✎</button>
        <div class="cn-status-icon">${icon}</div>
      </div>
      ${r.hint ? `<div class="cn-hint">${escHtml(r.hint)}</div>` : ''}
      <div class="cn-edit-row" style="display:none">
        <input class="cn-edit-input" type="text" value="${escHtml(r.item.display)}" spellcheck="false" autocomplete="off">
        <button class="btn-edit-apply">Apply</button>
      </div>`;

    // Toggle edit
    item.querySelector('.btn-edit-toggle').addEventListener('click', () => {
      const row = item.querySelector('.cn-edit-row');
      const visible = row.style.display !== 'none';
      row.style.display = visible ? 'none' : 'flex';
      if (!visible) item.querySelector('.cn-edit-input').focus();
    });

    // Apply edit
    item.querySelector('.btn-edit-apply').addEventListener('click', () => {
      const input = item.querySelector('.cn-edit-input');
      applyEdit(i, input.value.trim());
    });

    item.querySelector('.cn-edit-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyEdit(i, e.target.value.trim());
      }
    });
  });
}

function formatParsedMeta(item) {
  const parts = [];
  parts.push(`letters: ${item.letters}`);
  parts.push(`num: ${item.classNum}${item.classDecimal ? item.classDecimal.toString().slice(1) : ''}`);
  if (item.cutter1Letter) parts.push(`c1: .${item.cutter1Letter}${item.cutter1Num ? String(item.cutter1Num).slice(2) : ''}`);
  if (item.cutter2Letter) parts.push(`c2: .${item.cutter2Letter}${item.cutter2Num ? String(item.cutter2Num).slice(2) : ''}`);
  if (item.year) parts.push(`year: ${item.year}`);
  return parts.join(' · ');
}

function applyEdit(index, newText) {
  if (!newText) return;
  const parsed = parseLCCallNumber(newText);
  if (!parsed || !parsed.letters) {
    showToast('Could not parse — check the format');
    return;
  }
  state.parsedItems[index] = parsed;
  recheck();
}

function recheck() {
  state.checkResults = checkShelfOrder(state.parsedItems);
  renderResults();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── Main Flow ────────────────────────────────────────────────────────────────

btnScan.addEventListener('click', async () => {
  const imageDataURL = captureFrame();
  state.capturedImageURL = imageDataURL;

  stopCamera();
  showScreen('processing');
  progressBar.style.width = '0%';
  progressLabel.textContent = 'Sending to vision API…';

  captureThumb.src = imageDataURL;

  try {
    const callNumbers = await extractFromVision(imageDataURL);
    console.log('Vision result:', callNumbers);

    state.parsedItems = callNumbers
      .map(s => parseLCCallNumber(s))
      .filter(Boolean);
    state.checkResults = checkShelfOrder(state.parsedItems);

    showScreen('results');
    renderResults();
  } catch (err) {
    console.error('Vision extract failed:', err);
    showScreen('results');
    state.parsedItems = [];
    state.checkResults = [];
    renderResults();
    showToast(err.message || 'Failed — add call numbers manually');
  }
});

btnRetry.addEventListener('click', () => {
  startCamera();
});

btnScanAgain.addEventListener('click', () => {
  state.parsedItems = [];
  state.checkResults = [];
  state.capturedImageURL = null;
  captureThumb.src = '';
  addCnInput.value = '';
  showScreen('camera');
  startCamera();
});

btnManualEntry.addEventListener('click', () => {
  // Show results screen without scanning (manual entry mode)
  stopCamera();
  state.capturedImageURL = null;
  state.parsedItems = [];
  state.checkResults = [];
  captureThumb.style.display = 'none';
  showScreen('results');
  renderResults();
  addCnInput.focus();
});

btnAddCn.addEventListener('click', addCallNumber);
addCnInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCallNumber();
});

function addCallNumber() {
  const raw = addCnInput.value.trim();
  if (!raw) return;
  const parsed = parseLCCallNumber(raw);
  if (!parsed || !parsed.letters) {
    showToast('Cannot parse — try format like: UA 163 .S66 2015');
    return;
  }
  state.parsedItems.push(parsed);
  recheck();
  addCnInput.value = '';
  addCnInput.focus();

  // Scroll to bottom of list
  setTimeout(() => {
    cnList.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

showScreen('camera');
startCamera();

// PWA service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
