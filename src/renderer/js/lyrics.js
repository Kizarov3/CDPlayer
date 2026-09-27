// LRC ("[mm:ss.xx] line") parsing for karaoke-style synced lyrics, shared by embedded and online lyrics. Enhanced LRC
// — a "<mm:ss.xx>" stamp before each word — is read too, for the word-by-word karaoke view, with the extensions
// ttml.js writes: a stamp with no word ends the word before it, "v1:" names the singer, "[bg: …]" backing vocals.

const STAMP = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/;
const WORD_STAMP = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const seconds = (m, s, frac) => parseInt(m, 10) * 60 + parseInt(s, 10) + (frac ? parseFloat(`0.${frac}`) : 0);

const AGENT = /^v(\d{1,2}):/;
const BG_LINE = /^\[bg:(.*)\]\s*$/;

// A line's words from its enhanced-LRC stamps: { words: [{ time, text, end? }], end } — a stamp with no word after it
// ends the word before it (a pause follows), and the last one also ends the line (`end`, else null). Text before
// the first stamp is sung at the line's own time. → words [] when the line has no word stamps.
function wordsOf(body, lineTime) {
  const stamps = [...body.matchAll(WORD_STAMP)];
  if (!stamps.length) return { words: [], end: null };
  const words = [];
  let end = null;
  const lead = body.slice(0, stamps[0].index);
  if (lead.trim()) words.push({ time: lineTime, text: lead.replace(/^\s+/, '') });
  stamps.forEach((m, i) => {
    const last = i + 1 === stamps.length;
    const text = body.slice(m.index + m[0].length, last ? body.length : stamps[i + 1].index);
    const time = seconds(m[1], m[2], m[3]);
    if (text.trim()) { words.push({ time, text }); return; }
    const prev = words[words.length - 1];
    if (prev && prev.end === undefined && time > prev.time) prev.end = time;
    if (prev && text && !/\s$/.test(prev.text)) prev.text += text;
    if (last) end = time;
  });
  if (words.length) words[words.length - 1].text = words[words.length - 1].text.trimEnd();
  return { words, end };
}
const shifted = (w, by) => (w.end === undefined ? { time: w.time + by, text: w.text } : { time: w.time + by, end: w.end + by, text: w.text });

/**
 * Returns [{time (seconds), text}] sorted by time, or [] when the lyrics aren't timed. A line with word stamps also
 * has `words` ([{time, text, end?}]); one whose last stamp ends it has `end`; a duet line has its singer (`agent`,
 * "v1"…), and a "[bg: …]" line after it gives it backing vocals (`bg`, timed like words). A line stamped more than
 * once (a repeated chorus) has all of these shifted to each time.
 */
export function parseLrc(raw) {
  const out = [];
  let previous = []; // what the last timed line became (one per stamp), for a [bg: line after it
  for (const rawLine of String(raw).split(/\r\n|\r|\n/)) {
    const bg = BG_LINE.exec(rawLine.trim());
    if (bg) {
      if (previous.length) {
        const { words } = wordsOf(bg[1], previous[0].time);
        if (words.length) for (const line of previous) line.bg = words.map((w) => shifted(w, line.time - previous[0].time));
      }
      continue;
    }
    let rest = rawLine;
    const stamps = [];
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      stamps.push(seconds(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue; // header tags like [ti:...] or untimed text
    const who = AGENT.exec(rest.trimStart());
    if (who) rest = rest.trimStart().slice(who[0].length);
    const text = rest.replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
    const { words, end } = wordsOf(rest, stamps[0]);
    previous = stamps.map((time) => {
      const by = time - stamps[0];
      const line = { time, text };
      if (words.length) line.words = words.map((w) => shifted(w, by));
      if (end !== null) line.end = end + by;
      if (who) line.agent = `v${parseInt(who[1], 10)}`;
      out.push(line);
      return line;
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Plain-text display of lyrics: timestamps (line and word), singer prefixes and LRC header tags stripped. */
export function formatLyricsForDisplay(raw) {
  return String(raw).split(/\r\n|\r|\n/)
    .map((l) => {
      const bg = BG_LINE.exec(l.trim());
      if (bg) return bg[1].replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
      return l.replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/, '').replace(AGENT, '').replace(WORD_STAMP, '');
    })
    .filter((l) => !/^\[(ti|ar|al|by|offset|length|re|ve):[^\]]*\]\s*$/.test(l))
    .join('\n').trim();
}

/**
 * The line at `position` and whether it is being sung: { index (as currentLineIndex), singing } — not singing before
 * the first line, or once past a line's end until the next one starts.
 */
export function lineState(lines, position) {
  const index = currentLineIndex(lines, position);
  if (index < 0) return { index, singing: false };
  const end = lines[index].end;
  return { index, singing: end === undefined || position < end + 0.15 };
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
