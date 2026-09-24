// LRC ("[mm:ss.xx] line") parsing for karaoke-style synced lyrics, shared by embedded and lrclib.net lyrics.

const STAMP = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/;

/** Returns [{time (seconds), text}] sorted by time, or [] when the lyrics aren't timed. */
export function parseLrc(raw) {
  const out = [];
  for (const rawLine of String(raw).split(/\r\n|\r|\n/)) {
    let rest = rawLine;
    const stamps = [];
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      const frac = m[3] ? parseFloat(`0.${m[3]}`) : 0;
      stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue; // header tags like [ti:...] or untimed text
    const text = rest.trim();
    for (const time of stamps) out.push({ time, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Plain-text display of lyrics: timestamps and LRC header tags stripped. */
export function formatLyricsForDisplay(raw) {
  return String(raw).split(/\r\n|\r|\n/)
    .map((l) => l.replace(/^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*/, ''))
    .filter((l) => !/^\[(ti|ar|al|by|offset|length|re|ve):[^\]]*\]\s*$/.test(l))
    .join('\n').trim();
}

/** Index of the line that should be highlighted at `position` seconds, or -1 before the first line. */
export function currentLineIndex(lines, position) {
  let index = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].time <= position) index = i; else break; }
  return index;
}
