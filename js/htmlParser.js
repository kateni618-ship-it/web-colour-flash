/**
 * htmlParser.js
 * Extract color information from an HTML string.
 * Returns both CSS custom property (variable) colors and hardcoded color values.
 */

import { hexToHsl, relativeLuminance } from './colorEngine.js';

// ─── Regex patterns ───────────────────────────────────────────────────────────

const RE_HEX   = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const RE_RGB   = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)/g;
const RE_HSL   = /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*[\d.]+)?\s*\)/g;
const RE_CSSVAR = /(--([\w-]+))\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/g;

// ─── Normalise any color string to lowercase 6-digit hex ──────────────────────

export function normaliseColor(raw) {
  raw = raw.trim();
  // hex
  if (raw.startsWith('#')) {
    const h = raw.replace('#', '');
    if (h.length === 3) return '#' + h.split('').map(c => c + c).join('').toLowerCase();
    if (h.length === 6) return '#' + h.toLowerCase();
    if (h.length === 8) return '#' + h.slice(0, 6).toLowerCase(); // drop alpha
  }
  // rgb / rgba
  const rgbMatch = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  // hsl / hsla  — convert via canvas trick
  const hslMatch = raw.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (hslMatch) {
    return hslToHexDirect(parseFloat(hslMatch[1]), parseFloat(hslMatch[2]), parseFloat(hslMatch[3]));
  }
  return null;
}

function hslToHexDirect(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ─── Ignored / UI-irrelevant colors ──────────────────────────────────────────

const IGNORED = new Set([
  'transparent', 'inherit', 'currentcolor',
]);

// Named CSS colors to skip (very common noise)
const NAMED_SKIP = new Set(['black', 'white', 'transparent', 'none', 'inherit', 'initial', 'currentcolor']);

function isIgnored(hex) {
  return IGNORED.has(hex);
}

// ─── Gather all raw CSS text from an HTML string ─────────────────────────────

function extractCssText(htmlString) {
  // style tag contents
  const styleTagContents = [];
  const styleTagRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleTagRe.exec(htmlString)) !== null) {
    styleTagContents.push(m[1]);
  }
  // inline style attributes
  const inlineStyles = [];
  const inlineRe = /style=["']([^"']+)["']/gi;
  while ((m = inlineRe.exec(htmlString)) !== null) {
    inlineStyles.push(m[1]);
  }
  return { styleTagContents, inlineStyles };
}

// ─── Extract CSS variables ────────────────────────────────────────────────────

/**
 * Returns Map<varName, normalisedHex>
 * e.g. { '--primary-color' => '#4f46e5' }
 */
function extractCssVars(cssText) {
  const vars = new Map();
  let m;
  RE_CSSVAR.lastIndex = 0;
  while ((m = RE_CSSVAR.exec(cssText)) !== null) {
    const varName = m[1];       // e.g. --primary-color
    const rawVal  = m[3].trim();
    const hex = normaliseColor(rawVal);
    if (hex && !isIgnored(hex)) vars.set(varName, hex);
  }
  return vars;
}

// ─── Extract hardcoded colors ─────────────────────────────────────────────────

function extractHardcoded(cssText) {
  const colorMap = new Map(); // hex → count
  let m;

  RE_HEX.lastIndex = 0;
  while ((m = RE_HEX.exec(cssText)) !== null) {
    const hex = normaliseColor(m[0]);
    if (hex && !isIgnored(hex)) colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
  }
  RE_RGB.lastIndex = 0;
  while ((m = RE_RGB.exec(cssText)) !== null) {
    const hex = normaliseColor(m[0]);
    if (hex && !isIgnored(hex)) colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
  }
  RE_HSL.lastIndex = 0;
  while ((m = RE_HSL.exec(cssText)) !== null) {
    const hex = normaliseColor(m[0]);
    if (hex && !isIgnored(hex)) colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
  }

  // Sort by frequency descending
  return [...colorMap.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// ─── Cluster colors into 6 palette roles ─────────────────────────────────────

/**
 * Roles: [bg, surface, primary, secondary, text, accent]
 * Strategy:
 *  - Sort by luminance
 *  - Highest luminance group → bg / surface
 *  - Lowest luminance group  → text
 *  - Highest saturation remaining → primary / accent
 *  - Rest → secondary
 */
function clusterToRoles(hexList) {
  if (!hexList.length) return null;

  const analyzed = hexList.map(hex => {
    const { h, s, l } = hexToHsl(hex);
    const lum = relativeLuminance(hex);
    return { hex, h, s, l, lum };
  });

  analyzed.sort((a, b) => b.lum - a.lum); // lightest first

  const roles = new Array(6).fill(null);
  const used  = new Set();

  const pick = (list, idx) => {
    for (const item of list) {
      if (!used.has(item.hex)) { roles[idx] = item.hex; used.add(item.hex); return; }
    }
  };

  const byDarkness = [...analyzed].sort((a, b) => a.lum - b.lum);

  // Detect dark vs light theme by median luminance
  const midLum = analyzed[Math.floor(analyzed.length / 2)].lum;
  const isDark = midLum < 0.15;

  if (isDark) {
    // Dark theme: bg = darkest, surface = second darkest, text = lightest
    pick(byDarkness, 0);
    pick(byDarkness.slice(1), 1);
    pick(analyzed, 4);
  } else {
    // Light theme: bg = lightest, surface = second lightest, text = darkest
    pick(analyzed, 0);
    pick(analyzed.slice(1), 1);
    pick(byDarkness, 4);
  }
  // primary (highest saturation from remaining)
  const bySaturation = [...analyzed].sort((a, b) => b.s - a.s);
  pick(bySaturation, 2);
  // accent (second highest saturation, different hue family)
  const primaryHex = roles[2];
  const primaryH   = primaryHex ? hexToHsl(primaryHex).h : -1;
  const accentCandidates = bySaturation.filter(c => {
    if (used.has(c.hex)) return false;
    const hueDiff = Math.abs(c.h - primaryH);
    return Math.min(hueDiff, 360 - hueDiff) > 20; // prefer distinct hue
  });
  if (accentCandidates.length) pick(accentCandidates, 5);
  else pick(bySaturation, 5);
  // secondary (whatever's left with good saturation)
  pick(bySaturation, 3);

  // Fill any remaining nulls with first available color
  for (let i = 0; i < 6; i++) {
    if (!roles[i]) {
      const fallback = analyzed.find(c => !used.has(c.hex));
      if (fallback) { roles[i] = fallback.hex; used.add(fallback.hex); }
    }
  }

  return roles;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Parse an HTML string and extract color information.
 *
 * @param {string} htmlString
 * @returns {{
 *   hasCssVars: boolean,
 *   cssVars: Map<string, string>,       // varName → hex (if CSS vars found)
 *   hardcoded: string[],                // sorted by frequency
 *   extractedPalette: (string|null)[],  // 6-slot role palette (best guess)
 *   allColors: string[],                // all unique colors found
 * }}
 */
export function extractColors(htmlString) {
  const { styleTagContents, inlineStyles } = extractCssText(htmlString);
  const allCss = [...styleTagContents, ...inlineStyles].join('\n');

  // CSS variables (from style tags only — variables are always in :root / style tags)
  const cssVarMap = new Map();
  for (const block of styleTagContents) {
    for (const [k, v] of extractCssVars(block)) cssVarMap.set(k, v);
  }

  // Hardcoded colors from all CSS
  const hardcoded = extractHardcoded(allCss);

  // Deduplicate: prefer CSS var values, add hardcoded on top
  const allColors = [...new Set([...cssVarMap.values(), ...hardcoded])].slice(0, 80);

  const extractedPalette = allColors.length >= 3 ? clusterToRoles(allColors) : null;

  return {
    hasCssVars: cssVarMap.size > 0,
    cssVars: cssVarMap,
    hardcoded,
    extractedPalette,
    allColors,
  };
}
