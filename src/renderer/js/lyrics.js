// LRC ("[mm:ss.xx] line") parsing for karaoke-style synced lyrics, shared by embedded and online lyrics. Enhanced LRC
// — a "<mm:ss.xx>" stamp before each word — is read too, for the word-by-word karaoke view.

const STAMP = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/;
const WORD_STAMP = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const seconds = (m, s, frac) => parseInt(m, 10) * 60 + parseInt(s, 10) + (frac ? parseFloat(`0.${frac}`) : 0);

// A line's words from its enhanced-LRC stamps: [{time, text}], text keeping the space after the word. Text before the
// first stamp is sung at the line's own time. → [] when the line has no word stamps.
function wordsOf(body, lineTime) {
  const stamps = [...body.matchAll(WORD_STAMP)];
  if (!stamps.length) return [];
  const words = [];
  const lead = body.slice(0, stamps[0].index);
  if (lead.trim()) words.push({ time: lineTime, text: lead.replace(/^\s+/, '') });
  stamps.forEach((m, i) => {
    const end = i + 1 < stamps.length ? stamps[i + 1].index : body.length;
    const text = body.slice(m.index + m[0].length, end);
    if (text.trim()) words.push({ time: seconds(m[1], m[2], m[3]), text: i + 1 < stamps.length ? text : text.trimEnd() });
    else if (words.length && text) words[words.length - 1].text += text;
  });
  return words;
}

/**
 * Returns [{time (seconds), text}] sorted by time, or [] when the lyrics aren't timed. A line with word stamps also
 * has `words` ([{time, text}]); a line stamped more than once (a repeated chorus) has them shifted to each time.
 */
export function parseLrc(raw) {
  const out = [];
  for (const rawLine of String(raw).split(/\r\n|\r|\n/)) {
    let rest = rawLine;
    const stamps = [];
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      stamps.push(seconds(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue; // header tags like [ti:...] or untimed text
    const text = rest.replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
    const words = wordsOf(rest, stamps[0]);
    for (const time of stamps) {
      const line = { time, text };
      if (words.length) line.words = words.map((w) => ({ time: w.time + (time - stamps[0]), text: w.text }));
      out.push(line);
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Plain-text display of lyrics: timestamps (line and word) and LRC header tags stripped. */
export function formatLyricsForDisplay(raw) {
  return String(raw).split(/\r\n|\r|\n/)
    .map((l) => l.replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/, '').replace(WORD_STAMP, ''))
    .filter((l) => !/^\[(ti|ar|al|by|offset|length|re|ve):[^\]]*\]\s*$/.test(l))
    .join('\n').trim();
}

/** Index of the line that should be highlighted at `position` seconds, or -1 before the first line. */
export function currentLineIndex(lines, position) {
  let index = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].time <= position) index = i; else break; }
  return index;
}

/**
 * How far through each word of `line` the singer is at `position`: [0…1] per word (the line's words, or the whole
 * line as one word). A word lasts until the next one starts — or, for the last, until `end` (the next line), capped so
 * a long instrumental gap doesn't stretch it out.
 */
export function wordProgress(line, end, position) {
  const words = line.words && line.words.length ? line.words : [{ time: line.time, text: line.text }];
  return words.map((w, i) => {
    const next = i + 1 < words.length ? words[i + 1].time : Math.min(end, w.time + (line.words ? 1.2 : 4));
    if (position <= w.time) return 0;
    if (next <= w.time || position >= next) return 1;
    return (position - w.time) / (next - w.time);
  });
}
