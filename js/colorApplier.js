/**
 * colorApplier.js
 * Apply a new 6-color palette to an HTML string.
 *
 * Strategy A (preferred): override CSS custom properties via injected <style>
 * Strategy B (fallback):  direct text substitution of hardcoded color values
 */

// colorApplier imports nothing at module level — all dependencies passed as arguments

// ─── Color distance (perceptual weighted Euclidean in RGB) ────────────────────

function colorDistance(hex1, hex2) {
  if (!hex1 || !hex2 || hex1.length < 7 || hex2.length < 7) return Infinity;
  const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
}

// ─── Strategy A: CSS variable injection ──────────────────────────────────────

/**
 * Build a :root override block that reassigns extracted CSS vars to new palette colors.
 *
 * @param {Map<string,string>} cssVarMap   - varName → original hex
 * @param {Map<string,number>} varToRole   - varName → role index (0–5)
 * @param {string[]}           palette     - 6-color new palette
 * @returns {string}                       - <style> block to prepend
 */
function buildVarOverrideStyle(cssVarMap, varToRole, palette) {
  const decls = [];
  for (const [varName, origHex] of cssVarMap) {
    const roleIdx = varToRole.get(varName);
    if (roleIdx !== undefined && palette[roleIdx]) {
      decls.push(`  ${varName}: ${palette[roleIdx]};`);
    }
  }
  if (!decls.length) return '';
  return `<style id="wcf-override">:root {\n${decls.join('\n')}\n}</style>\n`;
}

/**
 * Build a mapping from CSS var name → role index, based on which palette slot
 * the original colour was assigned to.
 *
 * @param {Map<string,string>} cssVarMap       - varName → originalHex
 * @param {(string|null)[]}    extractedPalette - 6-slot role palette
 * @returns {Map<string,number>}
 */
export function buildVarToRole(cssVarMap, extractedPalette, newPalette) {
  const varToRole = new Map();
  for (const [varName, hex] of cssVarMap) {
    let roleIdx = extractedPalette.findIndex(
      p => p && p.toLowerCase() === hex.toLowerCase()
    );
    if (roleIdx === -1) {
      // Fuzzy fallback: find closest extractedPalette color by perceptual distance
      let minDist = Infinity;
      extractedPalette.forEach((p, i) => {
        if (!p) return;
        const d = colorDistance(hex, p);
        if (d < minDist) { minDist = d; roleIdx = i; }
      });
    }
    if (roleIdx !== -1) varToRole.set(varName, roleIdx);
  }
  return varToRole;
}

// ─── Global color map: map every extracted color to nearest palette role ──────

/**
 * For each color in allColors, find the closest extractedPalette slot (by
 * perceptual distance) and return the corresponding newPalette color.
 *
 * @param {string[]}          allColors        - all unique colors extracted from HTML
 * @param {(string|null)[]}   extractedPalette - 6-slot role palette (original)
 * @param {string[]}          newPalette       - 6-slot new palette to apply
 * @returns {Map<string,string>}               - origHex → newHex
 */
function buildGlobalColorMap(allColors, extractedPalette, newPalette) {
  const map = new Map();
  for (const orig of allColors) {
    let minDist = Infinity, bestRole = -1;
    extractedPalette.forEach((p, i) => {
      if (!p || !newPalette[i]) return;
      const d = colorDistance(orig, p);
      if (d < minDist) { minDist = d; bestRole = i; }
    });
    if (bestRole !== -1) map.set(orig, newPalette[bestRole]);
  }
  return map;
}

// ─── Strategy B: direct color substitution ───────────────────────────────────

/**
 * Replace all occurrences of original colors in the HTML string with new palette colors.
 * Works on hex, rgb, rgba, hsl text directly.
 *
 * @param {string}   html
 * @param {string[]} originalColors - ordered list of original hex values to replace
 * @param {string[]} newColors      - corresponding replacement hex values
 * @returns {string}
 */
function substituteColors(html, originalColors, newColors) {
  // Build a sorted list so longer/more-specific replacements go first
  const pairs = originalColors
    .map((orig, i) => ({ orig, next: newColors[i] }))
    .filter(p => p.orig && p.next && p.orig !== p.next);

  // We need to handle multiple color formats for each original.
  // Build a big regex that matches all source color representations.
  for (const { orig, next } of pairs) {
    html = replaceColorInHtml(html, orig, next);
  }
  return html;
}

/**
 * Replace all representations of `origHex` (hex/rgb/rgba/hsl) in html with `newHex`.
 */
function replaceColorInHtml(html, origHex, newHex) {
  // Normalise origHex just in case
  const norm = origHex.toLowerCase().replace('#', '');
  if (norm.length !== 6) return html;

  const r = parseInt(norm.slice(0, 2), 16);
  const g = parseInt(norm.slice(2, 4), 16);
  const b = parseInt(norm.slice(4, 6), 16);

  // Escape for regex
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patterns = [
    // 6-digit hex (case-insensitive)
    new RegExp(esc('#' + norm), 'gi'),
    // 3-digit hex shorthand (only if valid)
    ...(norm[0] === norm[1] && norm[2] === norm[3] && norm[4] === norm[5]
      ? [new RegExp(esc('#' + norm[0] + norm[2] + norm[4]), 'gi')]
      : []),
    // rgb(r, g, b)
    new RegExp(`rgb\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*\\)`, 'g'),
    // rgba(r, g, b, alpha) — replace keeping alpha
    new RegExp(`rgba\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*,\\s*([\\d.]+)\\s*\\)`, 'g'),
  ];

  for (const re of patterns) {
    if (re.source.includes('([\\d.]+)')) {
      // rgba — keep alpha channel
      html = html.replace(re, (_, alpha) => {
        const nr = parseInt(newHex.slice(1, 3), 16);
        const ng = parseInt(newHex.slice(3, 5), 16);
        const nb = parseInt(newHex.slice(5, 7), 16);
        return `rgba(${nr}, ${ng}, ${nb}, ${alpha})`;
      });
    } else {
      html = html.replace(re, newHex);
    }
  }
  return html;
}

// ─── Single-pass global substitution (prevents chain replacement) ─────────────

/**
 * Apply all color substitutions in a single regex pass over the HTML.
 * Using String.replace with a combined regex ensures the original source is
 * scanned only once — a new color written by one replacement can never be
 * picked up and overwritten by a later replacement (chain substitution).
 *
 * @param {string}             html
 * @param {Map<string,string>} colorMap  - origHex → newHex
 * @returns {string}
 */
function applyGlobalColorMap(html, colorMap) {
  const entries = [...colorMap.entries()].filter(([o, n]) => o !== n);
  if (!entries.length) return html;

  // Build hex lookup and collect rgb/rgba pairs
  const hexLookup = new Map(); // lowercase hex pattern → newHex
  const rgbaEntries = [];

  for (const [orig, next] of entries) {
    const norm = orig.toLowerCase().replace('#', '');
    if (norm.length !== 6) continue;
    hexLookup.set('#' + norm, next);
    // 3-digit shorthand
    if (norm[0] === norm[1] && norm[2] === norm[3] && norm[4] === norm[5]) {
      hexLookup.set('#' + norm[0] + norm[2] + norm[4], next);
    }
    rgbaEntries.push({ norm, next });
  }

  // Single-pass hex substitution: all patterns replaced in one .replace() call
  if (hexLookup.size) {
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [...hexLookup.keys()]
      .map(esc)
      .sort((a, b) => b.length - a.length); // longer patterns first
    const re = new RegExp(patterns.join('|'), 'gi');
    html = html.replace(re, m => hexLookup.get(m.toLowerCase()) || m);
  }

  // rgb/rgba substitution — sequential is safe here because hex output (#rrggbb)
  // cannot match rgb(...) patterns, so no chaining is possible.
  for (const { norm, next } of rgbaEntries) {
    const r = parseInt(norm.slice(0, 2), 16);
    const g = parseInt(norm.slice(2, 4), 16);
    const b = parseInt(norm.slice(4, 6), 16);
    const nr = parseInt(next.slice(1, 3), 16);
    const ng = parseInt(next.slice(3, 5), 16);
    const nb = parseInt(next.slice(5, 7), 16);
    html = html.replace(
      new RegExp(`rgb\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*\\)`, 'g'),
      `rgb(${nr}, ${ng}, ${nb})`
    );
    html = html.replace(
      new RegExp(`rgba\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*,\\s*([\\d.]+)\\s*\\)`, 'g'),
      (_, alpha) => `rgba(${nr}, ${ng}, ${nb}, ${alpha})`
    );
  }

  return html;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Apply a new palette to the HTML string and return modified HTML.
 *
 * @param {string}           htmlString
 * @param {object}           extracted      - result of extractColors()
 * @param {string[]}         newPalette     - 6-color new palette
 * @param {(string|null)[]}  extractedPalette - 6-slot role palette from extraction
 * @returns {string}                         - modified HTML string
 */
export function applyPalette(htmlString, extracted, newPalette, extractedPalette) {
  let modified = htmlString;

  // Strategy A: inject CSS var overrides (with fuzzy matching)
  if (extracted.hasCssVars && extractedPalette) {
    const varToRole = buildVarToRole(extracted.cssVars, extractedPalette, newPalette);
    const overrideBlock = buildVarOverrideStyle(extracted.cssVars, varToRole, newPalette);
    if (overrideBlock) {
      modified = modified.replace(/<style id="wcf-override">[\s\S]*?<\/style>\n?/g, '');
      if (modified.includes('</head>')) {
        modified = modified.replace('</head>', overrideBlock + '</head>');
      } else {
        modified = overrideBlock + modified;
      }
    }
  }

  // Strategy B (global): map ALL extracted colors to nearest new palette color,
  // applied in a single pass to prevent chain substitution.
  if (extractedPalette && extracted.allColors && extracted.allColors.length) {
    const globalMap = buildGlobalColorMap(extracted.allColors, extractedPalette, newPalette);
    modified = applyGlobalColorMap(modified, globalMap);
  }

  return modified;
}

/**
 * Create a blob URL from a modified HTML string.
 * @param {string} html
 * @returns {string} blob URL
 */
export function createBlobUrl(html) {
  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

/**
 * Download the modified HTML as a file.
 * @param {string} html
 * @param {string} originalFilename
 */
export function downloadHtml(html, originalFilename) {
  const name = originalFilename
    ? originalFilename.replace(/\.html?$/i, '') + '-recoloured.html'
    : 'recoloured.html';
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
