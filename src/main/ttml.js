'use strict';
/**
 * Apple-style TTML lyrics ("<p begin=… end=…><span begin=…>word</span> …</p>", as Unison serves them) turned into
 * LRC for the lyrics view — enhanced LRC when the words are timed ("[00:08.84]<00:08.84>Now <00:09.15>he's"), which
 * the karaoke view fills in word by word. Background vocals (ttm:role="x-bg"), which Apple nests inside the line
 * they are sung under, are left out.
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
 * The lines of a TTML document: [{ time (seconds), text }], in document order. `text` carries a "\u0000<s>\u0000"
 * marker before each timed word (s = its time), turned into a stamp or dropped by the caller.
 */
function ttmlLines(xml) {
  const lines = [];
  let line = null, skipDepth = 0, wordTime = null;
  const TOKEN = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|([^<]+)/g;
  for (let m = TOKEN.exec(String(xml || '')); m; m = TOKEN.exec(xml)) {
    const [, closing, tag, attrs, selfClosing, text] = m;
    if (text !== undefined) {
      if (!line || skipDepth) continue;
      if (wordTime !== null && text.trim()) { line.text += `\u0000${wordTime}\u0000`; wordTime = null; }
      line.text += decodeEntities(text);
      continue;
    }
    if (!tag) continue; // comment or processing instruction
    const name = tag.replace(/^.*:/, '');
    if (name === 'p') {
      if (closing) {
        if (line) lines.push({ time: line.time, text: line.text.replace(/\s+/g, ' ').trim() });
        line = null; skipDepth = 0; wordTime = null;
      } else if (!selfClosing) line = { time: parseTime(attr(attrs, 'begin')), text: '' };
    } else if (line && name === 'span' && !selfClosing) {
      if (closing) { if (skipDepth) skipDepth--; wordTime = null; }
      else if (skipDepth || attr(attrs, 'role') === 'x-bg') skipDepth++;
      else if (attr(attrs, 'begin')) wordTime = parseTime(attr(attrs, 'begin'));
    } else if (line && name === 'br' && !skipDepth) line.text += ' ';
  }
  return lines.filter((l) => l.text.replace(/\u0000[^\u0000]*\u0000/g, '').trim());
}

const stamp = (seconds, [open, close] = '[]') => {
  const cs = Math.round(Math.max(0, seconds) * 100);
  return `${open}${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}${close}`;
};

/**
 * LRC for a TTML document: enhanced (a stamp before every word) where the words are timed and `words` is on,
 * line-synced otherwise; plain text when it has no timings at all; '' when it has no lyrics.
 */
function ttmlToLrc(xml, { words = true } = {}) {
  const lines = ttmlLines(xml);
  const timed = lines.some((l) => l.time !== null);
  return lines.map((l) => {
    const text = l.text.replace(/\u0000([^\u0000]*)\u0000/g, (_, t) => (words && timed ? stamp(parseFloat(t), '<>') : ''));
    return timed ? `${stamp(l.time || 0)}${text}` : text;
  }).join('\n');
}

/** The document's own length (<body dur="2:55.459">), in seconds, or null. */
function ttmlDuration(xml) {
  const m = /<body\b([^>]*)>/.exec(String(xml || ''));
  return m ? parseTime(attr(m[1], 'dur')) : null;
}

module.exports = { ttmlToLrc, ttmlDuration, parseTime };
