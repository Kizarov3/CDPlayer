// The song's words in Latin letters too, under each line (main's romanize.js), when that's turned on and they aren't already.
const NEEDS = /[぀-ヿ㐀-鿿豈-﫿가-힣Ѐ-ӿ]/;
let on = false, known = { lyrics: null, lines: new Map() };

export const needsRoman = (raw) => !!raw && NEEDS.test(raw.replace(/^\[[^\]]*\]/gm, ''));
export const romanOn = () => on;
export const setRomanOn = (value) => { on = !!value; };
/** A line's Latin letters: '' while off, for a line that needs none, or until they've come. */
export const romanFor = (text) => (on && text ? known.lines.get(text) || '' : '');
/** Asks for `texts` of `raw`'s, if on and not asked for yet. → true when they've come and are still the song's. */
export async function prepareRoman(raw, texts, ask) {
  if (!on || !needsRoman(raw) || known.lyrics === raw) return false;
  known = { lyrics: raw, lines: new Map() };
  const unique = [...new Set(texts.filter(Boolean))];
  const lines = await ask(unique).catch(() => null);
  if (known.lyrics !== raw || !Array.isArray(lines)) return false;
  known = { lyrics: raw, lines: new Map(unique.map((t, i) => [t, lines[i]]).filter(([, l]) => l)) };
  return true;
}
