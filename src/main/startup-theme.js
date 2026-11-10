'use strict';
// The theme the window opens in, as main sees it before the page has loaded the settings: whether it's light (the
// window's own background, the title bar and native menus, the page's first frame) and its colours for that first frame
// (js/first-paint.js). WHITE, or a saved theme of your own whose background is light; a dark one, AUTO or none: null.
const { BUILTIN } = require('./user-themes');

const KEYS = ['bg', 'card', 'accent', 'accent2', 'text', 'muted'];
// = THEMES' WHITE in js/theme.js (a test keeps the two the same)
const WHITE = { bg: [251, 251, 252], card: [255, 255, 255], accent: [224, 68, 46], accent2: [112, 116, 123], text: [42, 44, 48], muted: [112, 116, 123] };

// = js/theme.js's luminance and isLight (a test keeps them agreeing): a background is light when its relative luminance is over half
const luminance = (c) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const isLight = (bg) => luminance(bg) > 0.5;

/** The saved theme's colours if it's light, else null. A built-in name is the built-in theme, as the page picks it. */
function lightPalette(name, userThemes) {
  if (name === 'WHITE') return WHITE;
  if (BUILTIN.includes(name)) return null;
  const t = (userThemes || []).find((x) => x.name === name);
  return t && isLight(t.colors.bg) ? Object.fromEntries(KEYS.map((k) => [k, [...t.colors[k]]])) : null;
}

/** The value of the page's --cdp-light= argument: "r,g,b;r,g,b;…" in KEYS' order (digits, commas and semicolons only). */
const paletteArg = (p) => KEYS.map((k) => p[k].join(',')).join(';');
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

module.exports = { KEYS, WHITE, isLight, lightPalette, paletteArg, hex };
