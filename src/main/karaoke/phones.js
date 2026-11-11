'use strict';
// How English words sound, as the aligning model's phones. From the CMU Pronouncing Dictionary (cmudict.txt.gz, BSD), with
// a rough reading of the letters for what it doesn't have.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const PHONES = ['a', 'aɪ', 'aʊ', 'b', 'd', 'dʒ', 'e', 'ee', 'eɪ', 'eː', 'f', 'h', 'i', 'iː', 'j', 'k', 'l', 'm', 'n', 'o', 'oʊ', 'oː', 'p', 'r', 's', 'ss', 't', 'ts', 'tʃ', 'tː', 'u', 'uː', 'v', 'w', 'x', 'y', 'z', 'æ', 'ç', 'ð', 'ŋ', 'ɐ', 'ɑː', 'ɑːɹ', 'ɑ̃', 'ɔ', 'ɔː', 'ɔ̃', 'ə', 'ɚ', 'ɛ', 'ɛ̃', 'ɜ', 'ɜː', 'ɡ', 'ɣ', 'ɪ', 'ɲ', 'ɹ', 'ɾ', 'ʁ', 'ʃ', 'ʊ', 'ʊɹ', 'ʌ', 'ʒ', 'ʝ', 'β', 'θ', ' '];
const ID = new Map(PHONES.map((p, i) => [p, i]));
const BLANK = 71, SPACE = ID.get(' ');
const CAN_HOLD = new Set(['a', 'aɪ', 'aʊ', 'e', 'ee', 'eɪ', 'eː', 'i', 'iː', 'o', 'oʊ', 'oː', 'u', 'uː', 'y', 'æ', 'ɐ', 'ɑː', 'ɑːɹ', 'ɑ̃', 'ɔ', 'ɔː', 'ɔ̃', 'ə', 'ɚ', 'ɛ', 'ɛ̃', 'ɜ', 'ɜː', 'ɪ', 'ʊ', 'ʊɹ', 'ʌ'].map((p) => ID.get(p)));
const SOUNDS = { AA: 'ɑː', AE: 'æ', AH: 'ʌ', AH0: 'ə', AO: 'ɔː', AW: 'aʊ', AY: 'aɪ', B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', EH: 'ɛ', ER: 'ɜː', ER0: 'ɚ', EY: 'eɪ', F: 'f', G: 'ɡ', HH: 'h', IH: 'ɪ', IY: 'iː', IY0: 'i', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', OW: 'oʊ', OY: 'ɔ ɪ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', UH: 'ʊ', UW: 'uː', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ' };
const LETTERS = [['sch', 'ʃ'], ['tch', 'tʃ'], ['igh', 'aɪ'], ['ing', 'ɪ ŋ'], ['sh', 'ʃ'], ['ch', 'tʃ'], ['th', 'θ'], ['ph', 'f'], ['ck', 'k'], ['ng', 'ŋ'], ['qu', 'k w'], ['wh', 'w'], ['wr', 'ɹ'], ['kn', 'n'], ['ee', 'iː'], ['ea', 'iː'], ['oo', 'uː'], ['ou', 'aʊ'], ['ow', 'aʊ'], ['ai', 'eɪ'], ['ay', 'eɪ'], ['oa', 'oʊ'], ['oi', 'ɔ ɪ'], ['oy', 'ɔ ɪ'], ['au', 'ɔː'], ['aw', 'ɔː'], ['ar', 'ɑːɹ'], ['er', 'ɚ'], ['ir', 'ɜː'], ['ur', 'ɜː'], ['or', 'ɔː ɹ'], ['a', 'æ'], ['b', 'b'], ['c', 'k'], ['d', 'd'], ['e', 'ɛ'], ['f', 'f'], ['g', 'ɡ'], ['h', 'h'], ['i', 'ɪ'], ['j', 'dʒ'], ['k', 'k'], ['l', 'l'], ['m', 'm'], ['n', 'n'], ['o', 'ɑː'], ['p', 'p'], ['q', 'k'], ['r', 'ɹ'], ['s', 's'], ['t', 't'], ['u', 'ʌ'], ['v', 'v'], ['w', 'w'], ['x', 'k s'], ['y', 'j'], ['z', 'z']];
const CENSORED = [[/^f\*+k/, 'fuck'], [/^s\*+t/, 'shit'], [/^b\*+h/, 'bitch'], [/^a\*+s?/, 'ass'], [/^d\*+n/, 'damn']];

let dictionary = null;
function words() {
  if (dictionary) return dictionary;
  dictionary = new Map();
  for (const row of zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'cmudict.txt.gz'))).toString('utf8').split('\n')) {
    const at = row.indexOf(' ');
    if (at > 0) dictionary.set(row.slice(0, at), row.slice(at + 1));
  }
  return dictionary;
}
/** A word as it's looked up: small letters and apostrophes, with the swear words' stars filled back in. */
function plain(word) {
  let w = word.normalize('NFKC').toLowerCase().replace(/[’‘`]/g, "'");
  for (const [re, whole] of CENSORED) if (re.test(w)) { w = w.replace(re, whole); break; }
  return w.replace(/[^a-z']/g, '').replace(/^'+|'+$/g, (m, at) => (at === 0 ? '' : m));
}
function fromDictionary(code) {
  const parts = code.split(' '), out = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^([A-Z]+)([012])?$/.exec(parts[i]);
    if (!m) continue;
    const next = parts[i + 1] || '';
    if (m[1] === 'AA' && next === 'R') { out.push('ɑːɹ'); i++; continue; } // (one phone to the model)
    if (m[1] === 'UH' && next === 'R') { out.push('ʊɹ'); i++; continue; }
    const sound = (m[2] === '0' && SOUNDS[m[1] + '0']) || SOUNDS[m[1]];
    if (sound) out.push(...sound.split(' '));
  }
  return out;
}
function fromLetters(w) {
  const out = [];
  let s = w.replace(/'/g, '');
  if (s.length > 3) s = s.replace(/e$/, '');
  for (let i = 0; i < s.length;) {
    const hit = LETTERS.find(([l]) => s.startsWith(l, i));
    if (!hit) { i++; continue; }
    out.push(...hit[1].split(' '));
    i += hit[0].length;
  }
  return out;
}
const known = (w) => { const d = words(); return d.has(w) || (w.endsWith("in'") && d.has(`${w.slice(0, -1)}g`)); };
/** A word's phones; [] when it has none to say (punctuation). */
function phonesOf(word) {
  const w = plain(word);
  if (!w.replace(/'/g, '')) return [];
  const d = words();
  if (d.has(w)) return fromDictionary(d.get(w));
  if (w.endsWith("in'") && d.has(`${w.slice(0, -1)}g`)) return fromDictionary(d.get(`${w.slice(0, -1)}g`));
  // A word made of words ("tongue-tied"): each said as it is, not the whole run together and spelled out letter by letter.
  const parts = partsOf(word);
  if (parts.length > 1) return parts.flatMap(phonesOf);
  return fromLetters(w);
}
const partsOf = (word) => String(word).split(/[-‐‑‒–—]+/).filter((p) => plain(p).replace(/'/g, ''));
/** Whether these words (`lines`: arrays of words) are English enough for the dictionary to read them: most it must know. */
function readsAsEnglish(lines, least = 0.7) {
  const seen = new Set();
  for (const line of lines) for (const word of line) for (const part of partsOf(word)) { const w = plain(part); if (/[a-z]/.test(w)) seen.add(w); }
  if (seen.size < 3) return false;
  let hits = 0;
  for (const w of seen) if (known(w)) hits++;
  return hits / seen.size >= least;
}
/** A line's words as the model's phone numbers, spaces between them: { ids, spans: [{ word, first, last }] } (words with phones only). */
function linePhones(wordsOfLine) {
  const ids = [], spans = [];
  wordsOfLine.forEach((word, i) => {
    const phones = phonesOf(word);
    if (!phones.length) return;
    if (ids.length) ids.push(SPACE);
    const first = ids.length;
    for (const p of phones) ids.push(ID.has(p) ? ID.get(p) : 70);
    spans.push({ word: i, first, last: ids.length - 1 });
  });
  return { ids, spans };
}
module.exports = { phonesOf, readsAsEnglish, linePhones, BLANK, PHONES, CAN_HOLD };
