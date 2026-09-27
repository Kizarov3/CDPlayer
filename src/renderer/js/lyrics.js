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

const wordTimed = (raw) => /<\d{1,3}:\d{2}/.test(String(raw || ''));
const timed = (raw) => parseLrc(raw).length > 0;
/**
 * Whether to look for lyrics online for a file with these lyrics: unless they time every word already. Untimed ones
 * can't follow the song at all, and line-timed ones can't fill word by word.
 */
export const looksOnlineFor = (fileLyrics) => !fileLyrics || !wordTimed(fileLyrics);
/**
 * Whether lyrics found online replace the file's: when it has none, when the found ones time every word, or when
 * the file's aren't timed and the found ones are.
 */
export const takesOnline = (fileLyrics, found) => !!found && (!fileLyrics || wordTimed(found) || (!timed(fileLyrics) && timed(found)));

/**
 * Where the song is for the ears: `position` less the audio output's latency (large over Bluetooth), and moved by the
 * user's lyrics offset (ms; + shows the lyrics later). Never before 0.
 */
export function heardPosition(position, latencySeconds, offsetMs) {
  return Math.max(0, Math.round((position - (latencySeconds || 0) - (offsetMs || 0) / 1000) * 1e6) / 1e6);
}

/** The playback position at which lyric time `t` is heard: the inverse of heardPosition (for a clicked line). */
export function playbackTimeFor(t, latencySeconds, offsetMs) {
  return Math.round((t + (latencySeconds || 0) + (offsetMs || 0) / 1000) * 1e6) / 1e6;
}

const VOWELS = /[aeiouyäöüàáâãåæèéêëìíîïòóôõøùúûýÿаеёиоуыэюяіїє]+/gi;
/** Roughly how many syllables a word has (vowel groups; a silent final e dropped; one per letter where there are no vowels, as in CJK). */
export function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^\p{L}]/gu, '');
  if (!w) return 1;
  const groups = w.match(VOWELS);
  if (!groups) return w.length;
  let n = groups.length;
  if (n > 1 && /[^aeiouy]e$/.test(w)) n--; // "whole", "line"
  return Math.max(1, n);
}

const wordsOfText = (text) => String(text || '').match(/\S+\s*/g) || [text || ''];
const DEFAULT_PACE = 0.6;
/**
 * How long a syllable may take in this song, for lyrics timed by the line: its slower sung lines' time per syllable
 * (the upper quartile, so the lines before a break don't count), with a quarter to spare — a slow chorus is let run
 * over its whole line, and a verse line before a break isn't stretched across it. 0.25…1.2 s.
 */
export function songPace(lines) {
  const rates = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].text) continue;
    const n = wordsOfText(lines[i].text).reduce((s, w) => s + syllables(w), 0);
    rates.push((lines[i + 1].time - lines[i].time) / n);
  }
  if (rates.length < 4) return DEFAULT_PACE;
  rates.sort((a, b) => a - b);
  const q = rates[Math.floor(0.75 * (rates.length - 1))];
  return Math.round(Math.min(1.2, Math.max(0.25, q * 1.25)) * 1000) / 1000;
}

/**
 * The words of `line`, timed: its own (enhanced LRC), or — for a line timed as a whole — its text split into words
 * that share the line's time by their syllables, the last held a little longer. The line runs until a breath before
 * its own end or `end` (the next line), and no longer than `pace` (songPace) a syllable.
 */
export function lineWords(line, end, pace = DEFAULT_PACE) {
  if (line.words && line.words.length) return line.words;
  const parts = wordsOfText(line.text);
  const weights = parts.map((w, i) => syllables(w) + (i === parts.length - 1 && parts.length > 1 ? 1 : 0));
  const total = weights.reduce((s, n) => s + n, 0);
  const until = line.end !== undefined ? Math.min(end, line.end) : end;
  const gap = Math.max(0, until - line.time);
  const length = Math.min(gap - Math.min(0.3, gap * 0.1), total * pace);
  let at = line.time;
  return parts.map((text, i) => {
    const time = at;
    at += (length * weights[i]) / total;
    return { time, end: at, text };
  });
}

/**
 * How far through each word of `line` the singer is at `position`: [0…1] per word of lineWords(line, end, pace). A
 * word with an end fills over its own length and stays full through a pause after it; one without lasts until the
 * next starts — the last until `end` (the next line), at most 1.2 s.
 */
export function wordProgress(line, end, position, pace) {
  const words = lineWords(line, end, pace);
  return words.map((w, i) => {
    const stop = w.end !== undefined ? w.end : i + 1 < words.length ? words[i + 1].time : Math.min(end, w.time + 1.2);
    if (position <= w.time) return 0;
    if (stop <= w.time || position >= stop) return 1;
    return (position - w.time) / (stop - w.time);
  });
}
