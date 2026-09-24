'use strict';
/**
 * CUE sheets: the text file that splits one big album rip (album.flac + album.cue) into its tracks. Each track goes
 * into the queue as "<path to .cue>#<track number>", which keeps the queue, history, playlists and queue.txt plain
 * lists of strings; this module turns such a reference back into "play <file> from <start> to <end> seconds".
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const AUDIO_EXTENSIONS = ['flac', 'wav', 'wave', 'aif', 'aiff', 'aifc', 'm4a', 'mp3', 'ogg', 'oga', 'opus', 'aac', 'au', 'snd'];
const FRAMES_PER_SECOND = 75; // CD frames: INDEX times are mm:ss:ff

const isCueFile = (p) => /\.cue$/i.test(p);
const makeRef = (cuePath, number) => `${cuePath}#${number}`;
function parseRef(p) {
  const m = /^(.*\.cue)#(\d{1,3})$/i.exec(typeof p === 'string' ? p : '');
  return m ? { cuePath: m[1], number: parseInt(m[2], 10) } : null;
}

// Cue sheets predate UTF-8 being the norm: rippers on Windows wrote the system code page. Invalid UTF-8 falls back
// to Cyrillic (Windows-1251) when the high bytes come in runs — as they do in Cyrillic words — else Western (1252).
function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not UTF-8 */ }
  return new TextDecoder(/[\xc0-\xff]{3}/.test(buf.toString('latin1')) ? 'windows-1251' : 'windows-1252').decode(buf);
}

function unquote(rest) {
  const s = rest.trim();
  const first = s.indexOf('"'), last = s.lastIndexOf('"');
  return first === 0 && last > 0 ? s.slice(1, last) : s;
}

/** Cue sheet text → { title, performer, tracks: [{ number, title, performer, file, start }] } (file as written). */
function parseCue(text) {
  const sheet = { title: null, performer: null, tracks: [] };
  let file = null, track = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    const m = /^(\S+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const command = m[1].toUpperCase(), rest = m[2];
    if (command === 'FILE') {
      const f = /^(?:"([^"]*)"|(\S+))/.exec(rest);
      file = f ? (f[1] !== undefined ? f[1] : f[2]) : null;
      track = null;
    } else if (command === 'TRACK') {
      const t = /^(\d+)\s+(\S+)/.exec(rest);
      track = t && t[2].toUpperCase() === 'AUDIO' && file ? { number: parseInt(t[1], 10), title: null, performer: null, file, start: null, pregap: null } : null;
      if (track) sheet.tracks.push(track);
    } else if (command === 'TITLE' || command === 'PERFORMER') {
      const key = command.toLowerCase(), value = unquote(rest) || null;
      if (track) track[key] = value; else sheet[key] = value;
    } else if (command === 'INDEX' && track) {
      const i = /^(\d+)\s+(\d+):(\d+):(\d+)/.exec(rest);
      if (!i) continue;
      const seconds = parseInt(i[2], 10) * 60 + parseInt(i[3], 10) + parseInt(i[4], 10) / FRAMES_PER_SECOND;
      if (parseInt(i[1], 10) === 1) track.start = seconds;
      else if (parseInt(i[1], 10) === 0) track.pregap = seconds;
    }
  }
  for (const t of sheet.tracks) { if (t.start === null) t.start = t.pregap || 0; delete t.pregap; }
  return sheet;
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
// The FILE line often names what the album was ripped to before it was re-encoded ("album.wav" next to an
// album.flac), so fall back to the same name with any other audio extension, then to the cue sheet's own name.
function resolveAudioFile(cuePath, written) {
  const dir = path.dirname(cuePath);
  const exact = path.resolve(dir, written.replace(/[\\/]/g, path.sep));
  if (isFile(exact) && AUDIO_EXTENSIONS.includes(path.extname(exact).slice(1).toLowerCase())) return exact;
  for (const stem of [exact.replace(/\.[^.\\/]*$/, ''), cuePath.replace(/\.cue$/i, '')]) {
    for (const ext of AUDIO_EXTENSIONS) {
      if (isFile(`${stem}.${ext}`)) return `${stem}.${ext}`;
      if (isFile(`${stem}.${ext.toUpperCase()}`)) return `${stem}.${ext.toUpperCase()}`;
    }
  }
  return null;
}

/**
 * A cue sheet on disk → its playable tracks, each { ref, number, title, performer, album, file, start, end } with
 * file resolved to an existing audio file, and end = where the next track in the same file starts (null: to the
 * end of the file). Tracks whose audio can't be found are left out. Cached per file until it changes.
 */
const sheets = new Map();
async function readCueSheet(cuePath) {
  let st;
  try { st = await fsp.stat(cuePath); } catch { return null; }
  if (!st.isFile() || st.size > 1024 * 1024) return null;
  const key = `${st.mtimeMs}\0${st.size}`;
  const cached = sheets.get(cuePath);
  if (cached && cached.key === key) return cached.tracks;
  let sheet;
  try { sheet = parseCue(decodeText(await fsp.readFile(cuePath))); } catch { return null; }
  const files = new Map();
  const tracks = [];
  sheet.tracks.forEach((t, i) => {
    if (!files.has(t.file)) files.set(t.file, resolveAudioFile(cuePath, t.file));
    const file = files.get(t.file);
    if (!file) return;
    const next = sheet.tracks[i + 1];
    tracks.push({
      ref: makeRef(cuePath, t.number), number: t.number,
      title: t.title, performer: t.performer || sheet.performer, album: sheet.title,
      file, start: t.start, end: next && next.file === t.file && next.start > t.start ? next.start : null,
    });
  });
  sheets.set(cuePath, { key, tracks });
  if (sheets.size > 200) sheets.delete(sheets.keys().next().value);
  return tracks;
}

async function resolveRef(ref) {
  const r = parseRef(ref);
  if (!r) return null;
  const tracks = await readCueSheet(r.cuePath);
  return (tracks && tracks.find((t) => t.number === r.number)) || null;
}

/** A queue entry that still exists: a plain file, or a cue track whose .cue file is still there. */
function entryExists(p) {
  const r = parseRef(p);
  return isFile(r ? r.cuePath : p);
}

module.exports = { isCueFile, makeRef, parseRef, decodeText, parseCue, readCueSheet, resolveRef, entryExists };
