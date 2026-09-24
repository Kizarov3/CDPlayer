'use strict';
/**
 * Tag, cover-art and lyrics reading via music-metadata (pure JavaScript — ID3v1/v2, MP4 atoms, Vorbis comments,
 * FLAC, APE, AIFF/WAV chunks). This is what replaced the Java version's ffprobe/ffmpeg subprocess calls.
 */
const path = require('path');
const { nativeImage } = require('electron');

let mmPromise = null;
const mm = () => (mmPromise ||= import('music-metadata'));

class Lru {
  constructor(limit) { this.limit = limit; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key); this.map.delete(key); this.map.set(key, v); return v;
  }
  set(key, value) {
    this.map.delete(key); this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
}

// Details (small) are cached generously; decoded cover images (large) are cached separately and more tightly —
// the same unbounded-growth concern the Java version's bounded LRU was written for.
const detailsCache = new Lru(500);
const coverCache = new Lru(24);
const inflight = new Map();

function displayName(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
}
function fallbackTitle(filePath) {
  return displayName(filePath).replace(/^\s*\d{1,3}[ ._-]+/, '');
}

function formatLrcTimestamp(ms) {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60), s = total - m * 60;
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
}

// music-metadata reports lyrics as tag objects (plain text and/or SYLT-style synced lines). Synced lines are turned
// into LRC text so the Lyrics panel's single parser handles embedded synced lyrics and lrclib.net results alike.
function extractLyrics(common) {
  const list = common.lyrics || [];
  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) return entry.trim();
    if (entry && Array.isArray(entry.syncText) && entry.syncText.length) {
      return entry.syncText.map((l) => `${formatLrcTimestamp(l.timestamp || 0)}${l.text || ''}`).join('\n');
    }
    if (entry && typeof entry.text === 'string' && entry.text.trim()) return entry.text.trim();
  }
  return null;
}

// Very large embedded artwork (3000px PNGs are common) is scaled down once here, instead of shipping megabytes
// over IPC and re-decoding it on every repaint.
function coverToDataUrl(picture) {
  try {
    let img = nativeImage.createFromBuffer(Buffer.from(picture.data));
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (Math.max(width, height) > 1024) img = img.resize(width >= height ? { width: 1024, quality: 'best' } : { height: 1024, quality: 'best' });
    return `data:image/jpeg;base64,${img.toJPEG(90).toString('base64')}`;
  } catch { return null; }
}

async function parse(filePath, { covers }) {
  const { parseFile } = await mm();
  let meta = await parseFile(filePath, { skipCovers: !covers, duration: false });
  // A CBR/VBR MP3 without a Xing/VBRI header has no stored duration — scanning the frames is the only way to know.
  if (!meta.format.duration && /\.mp3$/i.test(filePath)) {
    meta = await parseFile(filePath, { skipCovers: !covers, duration: true });
  }
  return meta;
}

async function getDetails(filePath, { withCover = true } = {}) {
  const cached = detailsCache.get(filePath);
  if (cached && (!withCover || coverCache.get(filePath) !== undefined)) {
    return { ...cached, cover: withCover ? coverCache.get(filePath) : undefined };
  }
  const key = `${filePath}\0${withCover}`;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    let title = null, artist = null, album = null, lyrics = null, duration = 0, cover = null;
    try {
      const meta = await parse(filePath, { covers: withCover });
      const c = meta.common;
      title = c.title || null;
      artist = c.artist || (c.artists && c.artists[0]) || null;
      album = c.album || null;
      lyrics = extractLyrics(c);
      duration = meta.format.duration || 0;
      if (withCover && c.picture && c.picture.length) {
        const front = c.picture.find((p) => /front/i.test(p.type || '')) || c.picture[0];
        cover = coverToDataUrl(front);
      }
    } catch { /* unreadable tags are normal — fall back to the filename, same as the Java version */ }
    const details = {
      path: filePath,
      title: title && title.trim() ? title.trim() : fallbackTitle(filePath),
      artist: artist && artist.trim() ? artist.trim() : null,
      album: album && album.trim() ? album.trim() : null,
      lyrics,
      duration,
      ext: path.extname(filePath).slice(1).toUpperCase(),
    };
    detailsCache.set(filePath, details);
    if (withCover) coverCache.set(filePath, cover);
    return { ...details, cover: withCover ? cover : undefined };
  })();
  inflight.set(key, job);
  try { return await job; } finally { inflight.delete(key); }
}

module.exports = { getDetails, displayName, fallbackTitle, extractLyrics, Lru };
