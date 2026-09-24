'use strict';
/** File-system side of the queue: collecting audio from drops/folders, library scans, M3U, and library imports. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { fileURLToPath } = require('url');

const AUDIO_EXTENSIONS = new Set(['wav', 'wave', 'aif', 'aiff', 'aifc', 'au', 'snd', 'flac', 'm4a', 'mp3', 'aac', 'ogg', 'oga', 'opus']);
const isSupportedAudio = (p) => AUDIO_EXTENSIONS.has(path.extname(p).slice(1).toLowerCase());
const byName = (a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base', numeric: true });

/** Recursively collects supported audio under each dropped/chosen item (files or folders). */
async function collectAudio(items) {
  const out = [];
  const seenDirs = new Set();
  async function walk(p) {
    let st;
    try { st = await fsp.stat(p); } catch { return; }
    if (st.isDirectory()) {
      let real;
      try { real = await fsp.realpath(p); } catch { return; }
      if (seenDirs.has(real)) return; // symlink loop guard
      seenDirs.add(real);
      let entries = [];
      try { entries = await fsp.readdir(p); } catch { return; }
      for (const name of entries) await walk(path.join(p, name));
    } else if (st.isFile() && isSupportedAudio(p)) {
      out.push(p);
    }
  }
  for (const item of items) await walk(item);
  return out;
}

/** Search-panel index: every audio file under the last-used folder, sorted by filename. */
async function scanLibrary(folder) {
  const files = await collectAudio([folder]);
  files.sort(byName);
  return files;
}

function formatM3u(entries) {
  let out = '#EXTM3U\n';
  for (const { path: p, display } of entries) {
    if (/[\r\n]/.test(p)) continue;
    out += `#EXTINF:-1,${String(display).replace(/[\r\n]/g, ' ')}\n${p}\n`;
  }
  return out;
}

function parseM3u(text, playlistPath) {
  const base = path.dirname(playlistPath);
  const tracks = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let p = line;
    if (/^file:\/\//i.test(p)) { try { p = fileURLToPath(p); } catch { continue; } }
    // Playlists written on another OS may use the other separator style.
    if (!path.isAbsolute(p)) p = path.resolve(base, p.replace(/[\\/]/g, path.sep));
    try { if (fs.statSync(p).isFile() && isSupportedAudio(p)) tracks.push(p); } catch { /* missing file */ }
  }
  return tracks;
}

function decodeXmlEntities(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** iTunes / Music.app "Library.xml" → local file paths that still exist. */
function parseItunesLibrary(xml) {
  const tracks = [];
  const re = /<key>Location<\/key>\s*<string>([^<]*)<\/string>/g;
  let m;
  while ((m = re.exec(xml))) {
    const location = decodeXmlEntities(m[1]);
    if (!/^file:/i.test(location)) continue;
    try {
      // iTunes writes file://localhost/... — normalize to a plain file:/// URL before converting.
      const p = fileURLToPath(location.replace(/^file:\/\/localhost\//i, 'file:///'));
      if (fs.statSync(p).isFile()) tracks.push(p);
    } catch { /* one malformed/missing Location shouldn't fail the whole import */ }
  }
  return tracks;
}

function parseCsvLine(line) {
  const fields = [];
  let field = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

/** Spotify "Liked Songs" CSV export (Exportify-style: "Track Name", "Artist Name(s)" columns) → [{title, artist}]. */
function parseSpotifyCsv(text) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!rows.length) return [];
  const header = parseCsvLine(rows[0]).map((h) => h.trim().toLowerCase());
  const titleCol = header.findIndex((h) => h.includes('track name'));
  const artistCol = header.findIndex((h) => h.includes('artist name'));
  if (titleCol < 0) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].trim()) continue;
    const row = parseCsvLine(rows[i]);
    const title = (row[titleCol] || '').trim();
    if (!title) continue;
    const artist = artistCol >= 0 ? (row[artistCol] || '').split(',')[0].trim() : '';
    out.push({ title, artist });
  }
  return out;
}

/** Spotify "Download your data" YourLibrary.json → [{title, artist}]. */
function parseSpotifyJson(text) {
  const json = JSON.parse(text.replace(/^﻿/, ''));
  const list = Array.isArray(json.tracks) ? json.tracks : Array.isArray(json) ? json : [];
  return list.filter((t) => t && t.track).map((t) => ({ title: String(t.track), artist: t.artist ? String(t.artist) : '' }));
}

module.exports = {
  AUDIO_EXTENSIONS, isSupportedAudio, collectAudio, scanLibrary, formatM3u, parseM3u,
  parseItunesLibrary, parseCsvLine, parseSpotifyCsv, parseSpotifyJson, byName,
};
