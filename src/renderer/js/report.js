// COPY REPORT (Settings → HELP): what a bug report needs, in one paste — the version, the system, where the sound goes
// and at what rate, the sound settings, what kind of song is in, and the last things said and gone wrong. No music's
// paths or file names: a path or a web address in what was said becomes <path> or <address>.

const TRAIL = 40;
const trail = [];

/** A file's path, a web address → stand-ins; CDPlayer's own code keeps its file name and line (app.js:1234). */
export function scrub(text) {
  return String(text)
    .replace(/(?:cdp|file|https?):\/\/[^\s'"()]*\/((?:[\w-]+\.)+m?js):(\d+)(?::\d+)?/g, '$1:$2')
    .replace(/(?:https?|cdp|file|spotify):\/?\/?[^\s'"()]+/gi, '<address>')
    .replace(/(['"])(?:\/|~\/|[a-z]:\\|\\\\)[^\n]*\1/gi, '$1<path>$1') // (a quoted one may have spaces in it, or the quote: to the last)
    // any other: from where it begins to the next · or the end — a path with spaces in it taken whole, and more with it
    .replace(/(?:~\/|\/(?=[^\s/]+\/)|[a-z]:\\|\\\\)[^'"()·\n]*/gi, '<path>');
}

/** Something said in the status line, or an error: kept, the last 40. */
export function note(kind, text, now = Date.now()) {
  const line = scrub(text).trim();
  if (!line) return;
  const last = trail[trail.length - 1];
  if (last && last.kind === kind && last.text === line) return; // said again
  trail.push({ at: now, kind, text: line });
  if (trail.length > TRAIL) trail.shift();
}
export const recent = () => trail.slice();

const onOff = (on) => (on ? 'on' : 'off');
const khz = (hz) => (hz ? `${+(hz / 1000).toFixed(1)} kHz` : '?');

// (names in it: an output's — "Sam's AirPods" — or who's signed in where, as `<name>`)
const unnamed = (text, names) => names.reduce((s, n) => s.split(n).join('<name>').split(n.toUpperCase()).join('<name>'), text);
/** The report's text, from what app.js gathers (`info`: `names` are the person's, taken out) and what was noted. */
export function buildReport(info, notes = recent()) {
  const i = info || {}, r = i.rate;
  const lines = [
    `CDPlayer ${i.version || '?'} · ${i.os || '?'} · Electron ${i.electron || '?'} (Chrome ${i.chrome || '?'})${i.gpu === 'software' ? ' · no GPU' : ''}`,
    `Language: ${i.language || '?'} · Music folders: ${i.folders ?? '?'} · Streaming: ${i.streaming ? `on (yt-dlp ${i.ytdlp || 'not found'})` : 'off'}`,
    `Output: ${i.output || '?'}${r ? ` · song ${khz(r.fileRate)} → aimed ${khz(r.aimed)} · device ${khz(r.deviceRate)}${r.switched ? ' (switched)' : ''}${r.bluetooth ? ' · Bluetooth' : ''}` : ''}`,
    `Quality: ${i.quality || '?'} · Transition: ${i.transition || '?'} · EQ: ${onOff(i.eq)} · Mono: ${onOff(i.mono)} · Spatial: ${i.spatial ? `on ${i.spatialAmount}%` : 'off'} · Sound check: ${i.soundCheck || '?'} · Disc noise: ${onOff(i.discNoise)}`,
    `In: ${i.playing ? `${i.playing.kind}${i.playing.format ? ` · ${i.playing.format}` : ''} · ${i.playing.state}` : 'nothing'}`,
  ];
  if (notes.length) {
    lines.push('', 'Lately:');
    for (const n of notes) lines.push(`${new Date(n.at).toISOString().slice(11, 19)} ${n.kind === 'error' ? 'ERROR ' : ''}${n.text}`);
  }
  const names = [...new Set((i.names || []).filter((n) => typeof n === 'string' && n.trim().length > 1))].sort((a, b) => b.length - a.length);
  return unnamed(lines.join('\n'), names);
}
