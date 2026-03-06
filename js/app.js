/**
 * app.js
 * Main orchestrator for web-colour-flash.
 * Wires together: file upload → color extraction → palette generation → preview → copy/download.
 */

import { generatePalette, ROLE_NAMES, ROLE_KEYS, HARMONY_OPTIONS, contrastRatio, hslToHex, hexToHsl } from './colorEngine.js';
import { extractColors } from './htmlParser.js';
import { applyPalette, applyFont, createBlobUrl, downloadHtml } from './colorApplier.js';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  htmlString:       null,   // raw uploaded HTML
  filename:         null,
  extracted:        null,   // result of extractColors()
  extractedPalette: null,   // 6-slot role mapping from uploaded file
  palette:          new Array(6).fill(null),  // current working palette (hex strings)
  locked:           new Array(6).fill(false), // per-slot lock state
  harmony:          'complementary',
  creativity:       50,
  darkMode:         false,
  fontFamily:       '',   // '' = keep original font
  currentBlobUrl:   null,
  originalBlobUrl:  null,   // blob URL of the unmodified uploaded HTML
  comparing:        false,  // whether compare mode is active
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const uploadZone      = document.getElementById('upload-zone');
const fileInput       = document.getElementById('file-input');
const previewFrame    = document.getElementById('preview-frame');
const generateBtn     = document.getElementById('btn-generate');
const copyCssBtn      = document.getElementById('btn-copy-css');
const copyJsonBtn     = document.getElementById('btn-copy-json');
const downloadBtn     = document.getElementById('btn-download');
const harmonySelect   = document.getElementById('harmony-select');
const creativityRange = document.getElementById('creativity-range');
const creativityVal   = document.getElementById('creativity-val');
const darkModeToggle  = document.getElementById('dark-mode-toggle');
const swatchContainer  = document.getElementById('swatch-container');
const uploadHint       = document.getElementById('upload-hint');
const noFileMsg        = document.getElementById('no-file-msg');
const placeholderMsg   = document.getElementById('preview-placeholder');
const extractedStrip   = document.getElementById('extracted-strip');
const extractedLabel   = document.getElementById('extracted-label');
const headerActions    = document.getElementById('header-actions');
const compareBtn       = document.getElementById('btn-compare');
const restoreBtn       = document.getElementById('btn-restore');
const fontSelect       = document.getElementById('font-select');

// ─── Upload ───────────────────────────────────────────────────────────────────

function handleFile(file) {
  if (!file || !file.name.match(/\.html?$/i)) {
    showToast('请上传 HTML 文件（.html 或 .htm）', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    state.htmlString = e.target.result;
    state.filename   = file.name;
    uploadHint.textContent = file.name;
    uploadHint.classList.add('has-file');

    // Snapshot the original HTML as a blob URL for compare/restore
    if (state.originalBlobUrl) URL.revokeObjectURL(state.originalBlobUrl);
    state.originalBlobUrl = createBlobUrl(state.htmlString);
    state.comparing = false;
    headerActions.style.display = 'none';
    compareBtn.classList.remove('active');

    // Extract colors from the file
    state.extracted = extractColors(state.htmlString);
    state.extractedPalette = state.extracted.extractedPalette;

    // Use extracted palette as initial palette if available
    if (state.extractedPalette) {
      state.palette = state.extractedPalette.map(c => c || null);
    }

    // Auto-detect dark mode from the uploaded HTML and sync the toggle.
    // The toggle now owns the preference — doGenerate reads only state.darkMode.
    if (state.extractedPalette && state.extractedPalette[0]) {
      const { l } = hexToHsl(state.extractedPalette[0]);
      state.darkMode = l < 30;
      darkModeToggle.checked = state.darkMode;
    }

    // Hide no-file message
    noFileMsg && (noFileMsg.style.display = 'none');
    placeholderMsg && (placeholderMsg.style.display = 'none');

    // Show extracted color strip
    renderExtractedStrip(state.extracted.allColors);

    // If no colors found, generate a fresh palette
    if (!state.extractedPalette || state.extractedPalette.every(c => !c)) {
      doGenerate();
    } else {
      renderSwatches();
      // Show the original HTML as-is on upload (user can Generate to apply a new palette)
      previewFrame.src = state.originalBlobUrl;
    }

    enableControls(true);
  };
  reader.readAsText(file);
}

uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});

// ─── Generate ─────────────────────────────────────────────────────────────────

function doGenerate() {
  const locked = state.locked.map((isLocked, i) => isLocked ? state.palette[i] : null);

  state.palette = generatePalette({
    locked,
    harmony:    state.harmony,
    creativity: state.creativity,
    darkMode:   state.darkMode,
  });

  renderSwatches();
  if (state.htmlString) {
    updatePreview();
    // Show compare/restore buttons after the first generate
    if (state.originalBlobUrl) headerActions.style.display = '';
  }
}

generateBtn.addEventListener('click', doGenerate);

// Keyboard shortcut: Space or Enter on generate button
document.addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'Enter') && e.target === generateBtn) doGenerate();
  // G key shortcut (when not in an input)
  if (e.key === 'g' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) doGenerate();
});

// ─── Preview ──────────────────────────────────────────────────────────────────

function updatePreview() {
  if (!state.htmlString || !state.palette.some(Boolean)) return;

  let modified = applyPalette(
    state.htmlString,
    state.extracted,
    state.palette,
    state.extractedPalette
  );
  modified = applyFont(modified, state.fontFamily);

  // Revoke previous blob URL
  if (state.currentBlobUrl) URL.revokeObjectURL(state.currentBlobUrl);

  state.currentBlobUrl = createBlobUrl(modified);

  // Exit compare mode so the preview always shows the latest generated result
  state.comparing = false;
  compareBtn.classList.remove('active');
  compareBtn.querySelector('.btn-ghost-text').textContent = '对比原稿';

  previewFrame.src = state.currentBlobUrl;
}

// ─── Swatches ─────────────────────────────────────────────────────────────────

function renderSwatches() {
  swatchContainer.innerHTML = '';

  state.palette.forEach((hex, i) => {
    if (!hex) return;

    const swatch = document.createElement('div');
    swatch.className = 'swatch' + (state.locked[i] ? ' locked' : '');
    swatch.dataset.index = i;

    // Compute whether text on swatch should be light or dark
    const textColor = contrastRatio(hex, '#ffffff') > 3 ? '#ffffff' : '#111111';

    swatch.innerHTML = `
      <div class="swatch-color" style="background:${hex}" title="Click to pick color">
        <input type="color" class="color-picker" value="${hex}" tabindex="-1" aria-label="Pick color for ${ROLE_NAMES[i]}">
        <span class="swatch-role-badge" style="color:${textColor}">${ROLE_KEYS[i]}</span>
      </div>
      <div class="swatch-info">
        <span class="swatch-role">${ROLE_NAMES[i]}</span>
        <span class="swatch-hex">${hex}</span>
      </div>
      <div class="swatch-actions">
        <button class="btn-icon btn-lock ${state.locked[i] ? 'active' : ''}" title="${state.locked[i] ? 'Unlock' : 'Lock'} color" aria-label="${state.locked[i] ? 'Unlock' : 'Lock'}">
          ${state.locked[i] ? lockIcon() : unlockIcon()}
        </button>
        <button class="btn-icon btn-copy-swatch" title="Copy hex" aria-label="Copy ${hex}">
          ${copyIcon()}
        </button>
      </div>
    `;

    // Color picker — clicking swatch color block
    const colorBlock  = swatch.querySelector('.swatch-color');
    const pickerInput = swatch.querySelector('.color-picker');

    colorBlock.addEventListener('click', () => pickerInput.click());

    pickerInput.addEventListener('input', e => {
      const newHex = e.target.value;
      state.palette[i] = newHex;
      state.locked[i]  = true; // auto-lock on manual pick
      renderSwatches();
      updatePreview();
    });

    // Lock toggle
    swatch.querySelector('.btn-lock').addEventListener('click', e => {
      e.stopPropagation();
      state.locked[i] = !state.locked[i];
      renderSwatches();
    });

    // Copy swatch hex
    swatch.querySelector('.btn-copy-swatch').addEventListener('click', e => {
      e.stopPropagation();
      copyToClipboard(hex, e.currentTarget);
    });

    swatchContainer.appendChild(swatch);
  });
}

// ─── Controls ────────────────────────────────────────────────────────────────

harmonySelect.addEventListener('change', e => {
  state.harmony = e.target.value;
});

creativityRange.addEventListener('input', e => {
  state.creativity = +e.target.value;
  creativityVal.textContent = e.target.value;
});

darkModeToggle.addEventListener('change', e => {
  state.darkMode = e.target.checked;
});

// ─── Font select ──────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  { value: '',                label: '原始字体' },
  { value: 'Inter',           label: 'Inter' },
  { value: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans' },
  { value: 'DM Sans',         label: 'DM Sans' },
  { value: 'Outfit',          label: 'Outfit' },
  { value: 'Sora',            label: 'Sora' },
  { value: 'Nunito',          label: 'Nunito' },
  { value: 'Noto Sans SC',    label: 'Noto Sans SC' },
  { value: 'system-ui',       label: '系统字体' },
];

FONT_OPTIONS.forEach(({ value, label }) => {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  fontSelect.appendChild(opt);
});

fontSelect.addEventListener('change', e => {
  state.fontFamily = e.target.value;
  if (state.htmlString && state.palette.some(Boolean)) {
    updatePreview();
  }
});

// Populate harmony select
const HARMONY_LABELS = {
  complementary: '互补色',
  triadic:       '三角色',
  analogous:     '相似色',
  split:         '分裂互补',
  tetradic:      '四色',
};
HARMONY_OPTIONS.forEach(key => {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = HARMONY_LABELS[key] || key;
  harmonySelect.appendChild(opt);
});

function enableControls(enabled) {
  generateBtn.disabled  = !enabled;
  copyCssBtn.disabled   = !enabled;
  copyJsonBtn.disabled  = !enabled;
  downloadBtn.disabled  = !enabled;
}
enableControls(false);

// ─── Copy & Download ──────────────────────────────────────────────────────────

copyCssBtn.addEventListener('click', () => {
  const css = state.palette
    .map((hex, i) => `  --wcf-${ROLE_KEYS[i]}: ${hex};`)
    .join('\n');
  const full = `:root {\n${css}\n}`;
  copyToClipboard(full, copyCssBtn);
});

copyJsonBtn.addEventListener('click', () => {
  const obj = {};
  ROLE_KEYS.forEach((k, i) => { obj[k] = state.palette[i]; });
  copyToClipboard(JSON.stringify(obj, null, 2), copyJsonBtn);
});

downloadBtn.addEventListener('click', () => {
  if (!state.htmlString) return;
  let modified = applyPalette(
    state.htmlString,
    state.extracted,
    state.palette,
    state.extractedPalette
  );
  modified = applyFont(modified, state.fontFamily);
  downloadHtml(modified, state.filename);
});

// ─── Utility ──────────────────────────────────────────────────────────────────

async function copyToClipboard(text, triggerEl) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制！', 'success', triggerEl);
  } catch {
    // Fallback for restricted contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制！', 'success', triggerEl);
  }
}

let toastTimer;
function showToast(msg, type = 'success', anchorEl = null) {
  let toast = document.getElementById('wcf-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'wcf-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ─── Compare / Restore ────────────────────────────────────────────────────────

compareBtn.addEventListener('click', () => {
  if (!state.originalBlobUrl || !state.currentBlobUrl) return;
  state.comparing = !state.comparing;
  if (state.comparing) {
    previewFrame.src = state.originalBlobUrl;
    compareBtn.classList.add('active');
    compareBtn.querySelector('.btn-ghost-text').textContent = '查看新稿';
  } else {
    previewFrame.src = state.currentBlobUrl;
    compareBtn.classList.remove('active');
    compareBtn.querySelector('.btn-ghost-text').textContent = '对比原稿';
  }
});

restoreBtn.addEventListener('click', () => {
  if (!state.extractedPalette || !state.originalBlobUrl) return;
  state.palette = state.extractedPalette.map(c => c || null);
  state.locked = new Array(6).fill(false);
  // Exit compare mode and show the original HTML
  state.comparing = false;
  compareBtn.classList.remove('active');
  compareBtn.querySelector('.btn-ghost-text').textContent = '对比原稿';
  renderSwatches();
  previewFrame.src = state.originalBlobUrl;
});

// ─── Extracted strip ─────────────────────────────────────────────────────────

function renderExtractedStrip(colors) {
  if (!extractedStrip) return;
  if (!colors || !colors.length) {
    extractedLabel && (extractedLabel.style.display = 'none');
    extractedStrip.style.display = 'none';
    return;
  }
  extractedLabel && (extractedLabel.style.display = '');
  extractedStrip.style.display = '';
  extractedStrip.innerHTML = '';
  colors.slice(0, 20).forEach(hex => {
    const dot = document.createElement('div');
    dot.className = 'extracted-dot';
    dot.style.background = hex;
    dot.title = hex;
    extractedStrip.appendChild(dot);
  });
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function lockIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>`;
}
function unlockIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
  </svg>`;
}
function copyIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Pre-populate harmony options are added above.
// Show the generate button as active to invite interaction.
generateBtn.addEventListener('mouseenter', () => {
  if (!state.htmlString) {
    uploadZone.classList.add('pulse');
    setTimeout(() => uploadZone.classList.remove('pulse'), 600);
  }
});
