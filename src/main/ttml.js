'use strict';
/**
 * Apple-style TTML lyrics ("<p begin=… end=…><span begin=…>word</span> …</p>", as Unison serves them) turned into
 * line-synced LRC for the lyrics view. Word timings are dropped (the view highlights whole lines), and so are
 * background vocals (ttm:role="x-bg"), which Apple nests inside the line they are sung under.
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

/** The lines of a TTML document: [{ time (seconds), text }], in document order. */
function ttmlLines(xml) {
  const lines = [];
  let line = null, skipDepth = 0;
  const TOKEN = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|([^<]+)/g;
  for (let m = TOKEN.exec(String(xml || '')); m; m = TOKEN.exec(xml)) {
    const [, closing, tag, attrs, selfClosing, text] = m;
    if (text !== undefined) { if (line && !skipDepth) line.text += decodeEntities(text); continue; }
    if (!tag) continue; // comment or processing instruction
    const name = tag.replace(/^.*:/, '');
    if (name === 'p') {
      if (closing) {
        if (line) lines.push({ time: line.time, text: line.text.replace(/\s+/g, ' ').trim() });
        line = null; skipDepth = 0;
      } else if (!selfClosing) line = { time: parseTime(attr(attrs, 'begin')), text: '' };
    } else if (line && name === 'span' && !selfClosing) {
      if (closing) { if (skipDepth) skipDepth--; } else if (skipDepth || attr(attrs, 'role') === 'x-bg') skipDepth++;
    } else if (line && name === 'br' && !skipDepth) line.text += ' ';
  }
  return lines.filter((l) => l.text);
}

const stamp = (seconds) => {
  const cs = Math.round(Math.max(0, seconds) * 100);
  return `[${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}]`;
};

/** Line-synced LRC for a TTML document — plain text when it has no timings, '' when it has no lyrics. */
function ttmlToLrc(xml) {
  const lines = ttmlLines(xml);
  const timed = lines.some((l) => l.time !== null);
  return lines.map((l) => (timed ? `${stamp(l.time || 0)}${l.text}` : l.text)).join('\n');
}

/** The document's own length (<body dur="2:55.459">), in seconds, or null. */
function ttmlDuration(xml) {
  const m = /<body\b([^>]*)>/.exec(String(xml || ''));
  return m ? parseTime(attr(m[1], 'dur')) : null;
}

module.exports = { ttmlToLrc, ttmlDuration, parseTime };
