/**
 * colorApplier.js
 * Apply a new 6-color palette to an HTML string.
 *
 * Strategy A (preferred): override CSS custom properties via injected <style>
 * Strategy B (fallback):  direct text substitution of hardcoded color values
 */

// colorApplier imports nothing at module level — all dependencies passed as arguments

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
export function buildVarToRole(cssVarMap, extractedPalette) {
  const varToRole = new Map();
  for (const [varName, hex] of cssVarMap) {
    const roleIdx = extractedPalette.findIndex(
      p => p && p.toLowerCase() === hex.toLowerCase()
    );
    if (roleIdx !== -1) varToRole.set(varName, roleIdx);
  }
  return varToRole;
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

  if (extracted.hasCssVars && extractedPalette) {
    // Strategy A: inject CSS var overrides
    const varToRole = buildVarToRole(extracted.cssVars, extractedPalette);
    const overrideBlock = buildVarOverrideStyle(extracted.cssVars, varToRole, newPalette);

    if (overrideBlock) {
      // Remove any previously injected override
      modified = modified.replace(/<style id="wcf-override">[\s\S]*?<\/style>\n?/g, '');
      // Insert before </head> or at beginning
      if (modified.includes('</head>')) {
        modified = modified.replace('</head>', overrideBlock + '</head>');
      } else {
        modified = overrideBlock + modified;
      }
    }

    // Also apply direct substitution for hardcoded colors that aren't covered by vars
    if (extractedPalette) {
      const uncoveredOriginals = extractedPalette
        .map((orig, i) => ({ orig, i }))
        .filter(({ orig }) => {
          if (!orig) return false;
          // Check if this color is covered by a CSS var
          for (const [, varHex] of extracted.cssVars) {
            if (varHex.toLowerCase() === orig.toLowerCase()) return false;
          }
          return true;
        });
      if (uncoveredOriginals.length) {
        modified = substituteColors(
          modified,
          uncoveredOriginals.map(u => u.orig),
          uncoveredOriginals.map(u => newPalette[u.i])
        );
      }
    }
  } else if (extractedPalette) {
    // Strategy B: direct substitution only
    const originals = extractedPalette.filter(Boolean);
    const replacements = extractedPalette.map((_, i) => newPalette[i]).filter((_, i) => extractedPalette[i]);
    modified = substituteColors(modified, originals, replacements);
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
