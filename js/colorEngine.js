/**
 * colorEngine.js
 * Pure algorithmic color palette generation using HSL harmony rules.
 * No AI/ML — deterministic + controlled randomness.
 */

// ─── Conversion helpers ───────────────────────────────────────────────────────

export function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length === 8) hex = hex.slice(0, 6); // strip alpha
  r = parseInt(hex.slice(0, 2), 16) / 255;
  g = parseInt(hex.slice(2, 4), 16) / 255;
  b = parseInt(hex.slice(4, 6), 16) / 255;
  return rgbToHsl(r, g, b);
}

export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length === 8) hex = hex.slice(0, 6);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

// ─── WCAG contrast ────────────────────────────────────────────────────────────

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Adjust lightness of a color until contrast >= minRatio against bg. */
function enforceContrast(colorHex, bgHex, minRatio = 4.5) {
  let { h, s, l } = hexToHsl(colorHex);
  const bgLum = relativeLuminance(bgHex);
  // Decide direction: if bg is light, darken text; if dark, lighten text
  const direction = bgLum > 0.4 ? -1 : 1;
  let attempts = 0;
  while (contrastRatio(hslToHex(h, s, l), bgHex) < minRatio && attempts < 30) {
    l = Math.max(0, Math.min(100, l + direction * 3));
    attempts++;
  }
  return hslToHex(h, s, l);
}

// ─── Harmony hue sets ─────────────────────────────────────────────────────────

const HARMONIES = {
  complementary:  h => [h, (h + 180) % 360, (h + 30) % 360, (h + 210) % 360],
  triadic:        h => [h, (h + 120) % 360, (h + 240) % 360, (h + 60) % 360],
  analogous:      h => [h, (h + 30) % 360, (h - 30 + 360) % 360, (h + 60) % 360],
  split:          h => [h, (h + 150) % 360, (h + 210) % 360, (h + 330) % 360],
  tetradic:       h => [h, (h + 90) % 360, (h + 180) % 360, (h + 270) % 360],
};

// ─── Jitter helper ────────────────────────────────────────────────────────────

function jitter(value, range, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value + (Math.random() - 0.5) * 2 * range));
}

// ─── Palette role definitions ─────────────────────────────────────────────────

/**
 * ROLES = [bg, surface, primary, secondary, text, accent]
 * Each has a base HSL profile; creativity expands the jitter window.
 */
function buildRoleColors(hues, creativity, isDark) {
  const c = creativity / 100; // 0–1

  const bgL      = isDark ? jitter(10, c * 8, 4, 18)   : jitter(97, c * 4, 90, 100);
  const bgS      = jitter(isDark ? 10 : 8, c * 12, 0, 25);
  const surfL    = isDark ? jitter(16, c * 6, 10, 24)   : jitter(93, c * 4, 85, 98);
  const surfS    = jitter(isDark ? 12 : 10, c * 10, 0, 25);
  const primaryS = jitter(72, c * 20, 40, 95);
  const primaryL = jitter(isDark ? 58 : 48, c * 12, 32, 68);
  const secS     = jitter(55, c * 22, 30, 85);
  const secL     = jitter(isDark ? 60 : 50, c * 12, 35, 70);
  const textL    = isDark ? jitter(92, c * 8, 80, 100) : jitter(10, c * 8, 4, 22);
  const textS    = jitter(8, c * 10, 0, 20);
  const accentS  = jitter(80, c * 18, 50, 100);
  const accentL  = jitter(isDark ? 62 : 50, c * 12, 35, 68);

  return [
    hslToHex(hues[0], bgS, bgL),         // bg
    hslToHex(hues[0], surfS, surfL),      // surface
    hslToHex(hues[1], primaryS, primaryL),// primary
    hslToHex(hues[2], secS, secL),        // secondary
    hslToHex(hues[0], textS, textL),      // text
    hslToHex(hues[3], accentS, accentL),  // accent
  ];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const ROLE_NAMES = ['Background', 'Surface', 'Primary', 'Secondary', 'Text', 'Accent'];
export const ROLE_KEYS  = ['bg', 'surface', 'primary', 'secondary', 'text', 'accent'];

/**
 * Generate a 6-color palette.
 *
 * @param {object} opts
 * @param {(string|null)[]} opts.locked   - Array of 6 hex strings or null (null = regenerate)
 * @param {string}          opts.harmony  - Key from HARMONIES
 * @param {number}          opts.creativity - 0–100
 * @param {boolean}         opts.darkMode  - Prefer dark bg
 * @param {number|null}     opts.baseHue   - Override base hue (null = random)
 * @returns {string[]} Array of 6 hex colors
 */
export function generatePalette({ locked = [], harmony = 'complementary', creativity = 50, darkMode = false, baseHue = null } = {}) {
  const hue = baseHue !== null ? baseHue : Math.random() * 360;
  const harmonyFn = HARMONIES[harmony] || HARMONIES.complementary;
  const hues = harmonyFn(hue);

  const generated = buildRoleColors(hues, creativity, darkMode);

  // Merge locked values: if locked[i] is a non-null hex, keep it
  const palette = generated.map((color, i) => {
    if (locked[i] && /^#[0-9a-fA-F]{6}$/.test(locked[i])) return locked[i];
    return color;
  });

  // Enforce text contrast against bg (index 4 vs 0)
  if (!locked[4]) {
    palette[4] = enforceContrast(palette[4], palette[0], 5.0);
  }
  // Enforce primary readability (not required to pass WCAG on bg, but should be visible)
  if (!locked[2] && contrastRatio(palette[2], palette[0]) < 2.5) {
    let { h, s, l } = hexToHsl(palette[2]);
    const bgLum = relativeLuminance(palette[0]);
    l = bgLum > 0.5 ? Math.max(20, l - 20) : Math.min(80, l + 20);
    palette[2] = hslToHex(h, s, l);
  }

  return palette;
}

export const HARMONY_OPTIONS = Object.keys(HARMONIES);
