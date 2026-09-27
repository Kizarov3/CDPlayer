'use strict';
/**
 * Apple-style TTML lyrics ("<p begin=… end=…><span begin=…>word</span> …</p>", as Unison serves them) turned into
 * LRC for the lyrics view — extended enhanced LRC when the words are timed ("[00:08.84]<00:08.84>Now <00:09.15>he's"),
 * which the karaoke view fills in word by word: a stamp before each word, one after a word followed by a pause and at
 * the line's end, "v1:" singer prefixes in a duet, and background vocals (ttm:role="x-bg"), which Apple nests inside
 * the line they are sung under, on a "[bg: …]" line after it.
 */

// A TTML time: [[hh:]mm:]ss[.fff], or an offset like "12.5s" / "500ms". → seconds, or null when it is neither.
function parseTime(value) {
  const text = String(value || '').trim();
  let m = /^(\d+(?:\.\d+)?)(h|m|s|ms)$/.exec(text);
  if (m) return parseFloat(m[1]) * { h: 3600, m: 60, s: 1, ms: 0.001 }[m[2]];
  m = /^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2}(?:\.\d+)?)$/.exec(text);
  if (!m) return null;
  // "01:23" is minutes:seconds — the hour only counts when all three parts are there.
  const [hours, minutes] = m[2] === undefined ? [0, m[1]] : [m[1], m[2]];
  return (parseInt(hours || 0, 10) * 3600) + (parseInt(minutes || 0, 10) * 60) + parseFloat(m[3]);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (all, dec, hex, name) => {
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}
const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeEntities(m[2] ?? m[3]) : '';
};

/**
 * The lines of a TTML document: [{ time, end, agent, text, words: [{ time, end, text }], bg: [{ time, end, text }] }]
 * in document order. `text` is the whole line (background vocals left out); a word's text keeps the space after it.
 * Syllables in spans with no space between them are words of their own (joined back up when shown). Untimed
 * documents have `words` empty.
 */
function ttmlLines(xml) {
  const lines = [];
  let line = null, target = null, word = null, bgDepth = 0;
  const spans = []; // per open span: { word } or { bg }
  const TOKEN = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|([^<]+)/g;
  for (let m = TOKEN.exec(String(xml || '')); m; m = TOKEN.exec(xml)) {
    const [, closing, tag, attrs, selfClosing, raw] = m;
    if (raw !== undefined) {
      if (!line) continue;
      const text = decodeEntities(raw);
      if (!bgDepth) line.text += text;
      if (word) word.text += text;
      else if (target.length && text) target[target.length - 1].text += text.replace(/\s+/g, ' ');
      continue;
    }
    if (!tag) continue; // comment or processing instruction
    const name = tag.replace(/^.*:/, '');
    if (name === 'p') {
      if (closing) {
        if (line) {
          line.text = line.text.replace(/\s+/g, ' ').trim();
          for (const list of [line.words, line.bg]) if (list.length) list[list.length - 1].text = list[list.length - 1].text.trimEnd();
          if (line.text) lines.push(line);
        }
        line = null; target = null; word = null; bgDepth = 0; spans.length = 0;
      } else if (!selfClosing) {
        line = { time: parseTime(attr(attrs, 'begin')), end: parseTime(attr(attrs, 'end')), agent: attr(attrs, 'agent') || null, text: '', words: [], bg: [] };
        target = line.words;
      }
    } else if (line && name === 'span' && !selfClosing) {
      if (closing) {
        const open = spans.pop();
        if (open && open.word) word = null;
        if (open && open.bg && !--bgDepth) target = line.words;
      } else if (attr(attrs, 'role') === 'x-bg') {
        bgDepth++; target = line.bg; spans.push({ bg: true });
      } else {
        const begin = parseTime(attr(attrs, 'begin'));
        if (begin === null) { spans.push({}); continue; }
        word = { time: begin, end: parseTime(attr(attrs, 'end')), text: '' };
        target.push(word);
        spans.push({ word: true });
      }
    } else if (line && name === 'br' && !bgDepth) line.text += ' ';
  }
  return lines;
}

const stamp = (seconds, [open, close] = '[]') => {
  const cs = Math.round(Math.max(0, seconds) * 100);
  return `${open}${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}${close}`;
};
const GAP = 0.02; // a word that ends more than this before the next one starts leaves a pause

// Words as enhanced LRC: "<begin>word " — plus "<end>" after a word a pause follows, and after the last one.
function wordsLrc(words, lineEnd) {
  let out = '';
  words.forEach((w, i) => {
    out += stamp(w.time, '<>') + w.text;
    const next = words[i + 1];
    if (next) {
      if (w.end !== null && next.time - w.end > GAP) out = `${out.replace(/\s+$/, '')} ${stamp(w.end, '<>')} `;
    } else {
      const end = lineEnd !== null && lineEnd !== undefined ? lineEnd : w.end;
      if (end !== null) out += stamp(end, '<>');
    }
  });
  return out;
}

/**
 * LRC for a TTML document: extended enhanced LRC where the words are timed and `words` is on (see the top of this
 * file); line-synced when `words` is off or nothing is word-timed; plain text when it has no timings at all; '' when
 * it has no lyrics.
 */
function ttmlToLrc(xml, { words = true } = {}) {
  const lines = ttmlLines(xml);
  const timed = lines.some((l) => l.time !== null);
  const wordTimed = words && timed && lines.some((l) => l.words.length);
  const singers = new Set(lines.map((l) => l.agent).filter(Boolean));
  return lines.map((l) => {
    if (!timed) return l.text;
    if (!wordTimed || !l.words.length) return `${stamp(l.time || 0)}${l.text}`;
    const who = singers.size > 1 && l.agent ? `${l.agent}:` : '';
    const main = `${stamp(l.time || 0)}${who}${wordsLrc(l.words, l.end)}`;
    return l.bg.length ? `${main}\n[bg: ${wordsLrc(l.bg, null)}]` : main;
  }).join('\n');
}

/** The document's own length (<body dur="2:55.459">), in seconds, or null. */
function ttmlDuration(xml) {
  const m = /<body\b([^>]*)>/.exec(String(xml || ''));
  return m ? parseTime(attr(m[1], 'dur')) : null;
}

module.exports = { ttmlToLrc, ttmlDuration, parseTime };
