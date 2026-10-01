// The interface in the user's language: THEME → ТЕМА. The dictionary comes from the main process as this module
// loads (before anything is built), so module-level text can be translated too; under node (tests) it's English.
import { format } from './i18n-format.js';

const loaded = typeof window !== 'undefined' && window.cdp && window.cdp.i18nDict ? window.cdp.i18nDict() : { code: 'en', dict: {} };
export const locale = loaded.code;
export const t = (text, vars) => format(loaded.dict, text, vars);

/** index.html's and mini.html's own text: elements marked data-i18n (their text) and data-i18n-title (their title). */
export function translatePage(root) {
  for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = t(n.textContent.trim());
  for (const n of root.querySelectorAll('[data-i18n-title]')) n.title = t(n.title);
  if (root.documentElement) root.documentElement.lang = locale;
}
