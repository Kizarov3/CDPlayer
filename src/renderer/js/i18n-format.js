// Translating a piece of the interface: the English text is the key into a language's dictionary
// (src/locales/<code>.json); {names} are filled in, and a text that changes with a number has a form per plural category.
// src/main/i18n-format.js is the same code for the main process (a test keeps them alike).

const rules = new Map();
function pluralRules(locale) {
  if (!rules.has(locale)) {
    let r;
    try { r = new Intl.PluralRules(locale); } catch { r = new Intl.PluralRules('en'); }
    rules.set(locale, r);
  }
  return rules.get(locale);
}
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));

/** `text` in the dictionary's language (or as it is), with `vars` filled in; `vars.n` picks a plural form. */
export function format(dict, text, vars = {}) {
  let out = dict && !text.startsWith('_') && Object.prototype.hasOwnProperty.call(dict, text) ? dict[text] : null;
  if (out && typeof out === 'object') {
    const category = typeof vars.n === 'number' ? pluralRules(dict._locale || 'en').select(vars.n) : 'other';
    out = out[category] || out.other || null;
  }
  return fill(typeof out === 'string' && out ? out : text, vars);
}
