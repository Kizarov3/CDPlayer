'use strict';
/**
 * TAKE ALONG: albums copied onto a portable player, a phone, an SD card — into <where>/<Album Artist>/<Album (Year)>/
 * "NN Title.ext", named as RIP names a CD (rip-names.js), with cover.jpg beside them. AS THEY ARE copies each file;
 * MP3 320 makes the lossless ones (FLAC, WAV, AIFF, AU, Apple Lossless) MP3s in a worker, as RIP does (tags and cover
 * written in, LAME's Info frame so the album stays gapless), and copies the lossy ones (MP3, AAC, OGG, Opus) as they
 * are: made MP3 again they'd only lose more, and players that play anything play those. A cue sheet's album-length
 * file is cut into its songs for MP3; as they are, the file goes with its sheet.
 *
 * Each file is written under a temporary name and renamed into place, so a cancel or a card pulled out leaves no half
 * file. What was written is remembered on the destination itself (.cdplayer-take-along.json), so taking the same albums
 * again writes only what's new or changed. Nothing on the destination is ever deleted or written over unless TAKE
 * ALONG wrote it: a file of the same name that was there already stays as it is.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const { Worker } = require('worker_threads');
const crypto = require('crypto');
const tagWriter = require('./tag-writer');
const cue = require('./cue');
const { albumFolder, trackFiles } = require('./rip-names');
const { losslessKind } = require('./encoders/pcm');

const MANIFEST = '.cdplayer-take-along.json';
const TEMP = '.cdplayer-taking-';
// A file being written on the destination: a name no one could have guessed and put a link at, created only if it's new.
const tempName = (folder, ext) => path.join(folder, `${TEMP}${crypto.randomBytes(8).toString('hex')}${ext}`);
const NEW_ONLY = { flag: 'wx' };
const FORMATS = ['COPY', 'MP3'];
const MP3_BYTES_PER_SECOND = 40000; // 320 kbps
const TAG_ROOM = 600 * 1024; // the tags and the cover in each MP3, roughly (a big cover is most of it)
const stop = (reason, extra = {}) => Object.assign(new Error(extra.message || reason), { reason }, extra);

const statOf = async (p) => { try { return await fsp.stat(p); } catch { return null; } };
const stampOf = (st) => (st ? `${st.size}:${Math.round(st.mtimeMs)}` : null);
const relOf = (root, p) => path.relative(root, p).split(path.sep).join('/');

// ---- What goes where ---------------------------------------------------------------------------------------------

// The first bytes of a file: enough to tell Apple Lossless from AAC in an .m4a whose header is at the front.
async function headOf(p) {
  let fh;
  try { fh = await fsp.open(p, 'r'); const b = Buffer.alloc(256 * 1024); const { bytesRead } = await fh.read(b, 0, b.length, 0); return b.subarray(0, bytesRead); } catch { return null; } finally { if (fh) await fh.close().catch(() => {}); }
}
// An .m4a is Apple Lossless or AAC: 'alac' or 'mp4a' in its sample description, which can be at either end of the file.
async function m4aKind(p) {
  const head = await headOf(p);
  if (head && head.includes('alac', 0, 'latin1')) return 'alac';
  if (head && head.includes('mp4a', 0, 'latin1')) return null;
  try { const buf = await fsp.readFile(p); return buf.includes('alac', 0, 'latin1') ? 'alac' : null; } catch { return null; }
}
/** How a file (or a cue sheet's audio) can be made MP3: its lossless kind, or null — lossy, copied as it is. */
async function convertible(file) {
  if (/\.(m4a|mp4|alac|caf)$/i.test(file)) return m4aKind(file);
  return losslessKind(file, null);
}

/**
 * The files for `albums` (the shelf's: { title, artist, year, genre, discs, tracks: [{ path, title, artist, track,
 * disc, duration }] }) at `dest` as `format` makes them: [{ album, src, rel, dest, action: 'copy' | 'mp3', kind, from,
 * to, key, stamp, estimate, tags, lossy }]. Streamed songs and audio CD tracks aren't files to take.
 */
async function planFiles(albums, { dest, format }) {
  const items = [];
  for (const [ai, a] of albums.entries()) {
    const folder = albumFolder(dest, { albumArtist: a.artist || null, album: a.title || null, year: a.year || null, discId: 'unknown' });
    const tracks = (a.tracks || []).filter((t) => typeof t.path === 'string' && !/^[a-z]+:\/\//i.test(t.path));
    const names = trackFiles(tracks.map((t, i) => ({ number: t.track || i + 1, title: t.title, disc: t.disc || 1, discs: a.discs || 1 })), 'x');
    const perDisc = new Map();
    for (const t of tracks) perDisc.set(t.disc || 1, (perDisc.get(t.disc || 1) || 0) + 1);
    const images = new Set(); // a cue sheet's album-length file goes once, with its sheet
    for (const [i, t] of tracks.entries()) {
      const ref = cue.parseRef(t.path);
      const where = ref ? await cue.resolveRef(t.path) : null;
      const file = where ? where.file : ref ? null : t.path;
      const st = file && await statOf(file);
      if (!st || !st.isFile()) continue;
      const kind = format === 'MP3' ? await convertible(file) : null;
      const base = names[i].slice(0, -2); // "NN Title"
      const tags = {
        title: t.title || null, artist: t.artist || a.artist || null, album: a.title || null, albumArtist: a.artist || null,
        year: a.year || null, track: t.track || i + 1, trackCount: perDisc.get(t.disc || 1), genre: a.genre || null,
        disc: (a.discs || 1) > 1 ? t.disc || 1 : null, discCount: (a.discs || 1) > 1 ? a.discs : null,
      };
      if (kind) {
        const seconds = where ? (where.end != null ? where.end - where.start : t.duration) : t.duration;
        const out = path.join(folder, `${base}.mp3`);
        const cueSt = ref ? await statOf(ref.cuePath) : null;
        items.push({
          album: ai, src: file, rel: relOf(dest, out), dest: out, action: 'mp3', kind, tags, cueTrack: !!ref,
          from: where ? where.start : 0, to: where ? where.end : null, key: ref ? t.path : file, stamp: [stampOf(st), stampOf(cueSt)].filter(Boolean).join('|'),
          estimate: seconds > 0 ? Math.ceil(seconds * MP3_BYTES_PER_SECOND) + TAG_ROOM : Math.ceil(st.size / 3) + TAG_ROOM,
        });
      } else if (ref) {
        // As they are (or audio that's lossy already): the album-length file and its sheet, under their own names (the sheet names the file).
        if (images.has(file)) continue;
        images.add(file);
        for (const [src, s] of [[file, st], [ref.cuePath, await statOf(ref.cuePath)]]) {
          if (!s) continue;
          const out = path.join(folder, path.basename(src));
          items.push({ album: ai, src, rel: relOf(dest, out), dest: out, action: 'copy', key: src, stamp: stampOf(s), estimate: s.size, image: true });
        }
      } else {
        const out = path.join(folder, `${base}${path.extname(file).toLowerCase()}`);
        items.push({ album: ai, src: file, rel: relOf(dest, out), dest: out, action: 'copy', key: file, stamp: stampOf(st), estimate: st.size, lossy: format === 'MP3' });
      }
    }
  }
  return items;
}

// ---- What's there already ----------------------------------------------------------------------------------------

/** The destination's record of what TAKE ALONG wrote there: { [relative path]: { key, stamp, action, size } }. */
function readManifest(dest) {
  try { const m = JSON.parse(fs.readFileSync(path.join(dest, MANIFEST), 'utf8')); return m && m.version === 1 && m.files ? m.files : {}; } catch { return {}; }
}
async function writeManifest(dest, files) {
  const target = path.join(dest, MANIFEST), tmp = tempName(dest, '.json');
  await fsp.writeFile(tmp, JSON.stringify({ version: 1, files }), NEW_ONLY);
  await fsp.rename(tmp, target);
}
/**
 * Each item marked: `there` — written before from the same file, unchanged since, and still there; or a file of that
 * name that TAKE ALONG didn't write, which is left alone — or else to be written.
 */
async function markThere(items, manifest) {
  for (const it of items) {
    const st = await statOf(it.dest), m = manifest[it.rel];
    if (!st) it.there = false;
    else if (!m) it.there = true; // not ours: kept as it is
    else it.there = m.key === it.key && m.stamp === it.stamp && m.action === it.action && m.size === st.size;
  }
  return items;
}

async function freeSpace(dest, statfs = (p) => fsp.statfs(p)) {
  try { const s = await statfs(dest); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/**
 * What taking `albums` to `dest` as `format` would do, for the panel before it starts: { albums, songs, toWrite, there,
 * bytes (to write, roughly), free (null: unknown), converting, keptLossy (copied as they are in MP3 320), images }.
 */
async function plan(albums, { dest, format, statfs } = {}) {
  format = FORMATS.includes(format) ? format : 'COPY';
  const items = await planFiles(albums, { dest: dest || '', format }); // (counted before a folder is picked too)
  if (dest && fs.existsSync(dest)) await markThere(items, readManifest(dest)); else items.forEach((i) => { i.there = false; });
  const todo = items.filter((i) => !i.there);
  return {
    albums: new Set(items.map((i) => i.album)).size, songs: items.filter((i) => !i.image).length,
    toWrite: todo.length, there: items.length - todo.length, bytes: todo.reduce((s, i) => s + i.estimate, 0),
    free: dest ? await freeSpace(dest, statfs) : null,
    converting: items.filter((i) => i.action === 'mp3').length, keptLossy: items.filter((i) => i.lossy).length,
    images: items.filter((i) => i.image).length,
  };
}

// ---- Converting (in a worker) ------------------------------------------------------------------------------------

let worker = null, nextId = 1;
const jobs = new Map();
function getWorker() {
  if (worker) return worker;
  const w = worker = new Worker(path.join(__dirname, 'encoders', 'take-along-worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`));
  w.on('message', ({ id, file, error }) => {
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    if (!jobs.size) w.unref();
    error ? job.reject(new Error(error)) : job.resolve(Buffer.from(file));
  });
  const lost = (e) => { if (worker !== w) return; worker = null; for (const j of jobs.values()) j.reject(e || new Error('the encoder stopped')); jobs.clear(); };
  w.on('error', lost);
  w.on('exit', () => lost());
  w.unref();
  return w;
}
/** A lossless file (or the part `from`–`to` seconds of it) as an MP3 file's bytes. A cancel stops the worker at once. */
function convertInWorker({ src, kind, from, to }, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(stop('cancelled')); return; }
    const id = nextId++, w = getWorker();
    jobs.set(id, { resolve, reject });
    if (signal) {
      signal.addEventListener('abort', () => {
        if (!jobs.has(id) || worker !== w) return;
        jobs.delete(id);
        worker = null;
        w.terminate();
        reject(stop('cancelled'));
      }, { once: true });
    }
    w.ref();
    w.postMessage({ id, filePath: src, kind, from, to });
  });
}

// ---- Taking them along -------------------------------------------------------------------------------------------

// What a failed write means: the card's full, or it's gone (unplugged), or something about this one file.
function whyStopped(e, dest) {
  if (e.reason) return e;
  if (e.code === 'ENOSPC') return stop('space');
  if (!fs.existsSync(dest)) return stop('gone');
  return null;
}

async function writeCover(folder, cover) {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(cover || '');
  const target = path.join(folder, 'cover.jpg');
  if (!m || await statOf(target)) return; // (one there already, whoever put it there, stays)
  const tmp = tempName(folder, '.jpg');
  await fsp.writeFile(tmp, Buffer.from(m[1], 'base64'), NEW_ONLY);
  await fsp.rename(tmp, target);
}

/**
 * Takes `albums` to `dest` as `format` ('COPY' or 'MP3'). `onProgress({ done, total, album, artist, written, there,
 * failed, percent })`. → { written, there, failed: [{ path, why }] }; throws { reason: 'cancelled' | 'space' (with
 * need and free) | 'gone' | 'failed' }. A file that can't be read is passed over (in `failed`); the rest go on.
 */
async function takeAlong({ albums, dest, format = 'COPY', signal, onProgress = () => {}, convert = convertInWorker, writeTags = tagWriter.writeTags, readTags = tagWriter.readTags, coverFor = async () => null, statfs }) {
  format = FORMATS.includes(format) ? format : 'COPY';
  if (!dest || !(await statOf(dest))) throw stop('gone');
  const manifest = readManifest(dest);
  const items = await markThere(await planFiles(albums, { dest, format }), manifest);
  const todo = items.filter((i) => !i.there), there = items.length - todo.length;
  const need = todo.reduce((s, i) => s + i.estimate, 0), free = await freeSpace(dest, statfs);
  if (free != null && need > free) throw stop('space', { need, free });
  let written = 0, done = 0;
  const failed = [];
  const report = (a) => onProgress({ done, total: todo.length, album: a ? a.title : null, artist: a ? a.artist : null, written, there, failed: failed.length, percent: todo.length ? Math.round((done / todo.length) * 100) : 100 });
  report(null);
  const folders = new Set(), covers = new Map();
  const coverOf = (ai) => { if (!covers.has(ai)) covers.set(ai, Promise.resolve().then(() => coverFor(albums[ai])).catch(() => null)); return covers.get(ai); };
  try {
    for (const [n, it] of todo.entries()) {
      if (signal && signal.aborted) throw stop('cancelled');
      const a = albums[it.album], folder = path.dirname(it.dest);
      report(a);
      const temp = tempName(folder, path.extname(it.dest));
      try {
        await fsp.mkdir(folder, { recursive: true });
        if (!folders.has(folder)) { folders.add(folder); await writeCover(folder, await coverOf(it.album)); }
        if (it.action === 'mp3') {
          const file = await convert(it, signal);
          if (signal && signal.aborted) throw stop('cancelled');
          await fsp.writeFile(temp, file, NEW_ONLY);
          let tags = {};
          if (!it.cueTrack) try { tags = readTags(it.src) || {}; } catch { /* untagged: the shelf's names do */ }
          const keep = Object.fromEntries(Object.entries(tags).filter(([k, v]) => tagWriter.FIELDS[k] && v != null && v !== ''));
          const cover = await coverOf(it.album);
          await writeTags(temp, { ...keep, ...Object.fromEntries(Object.entries(it.tags).filter(([, v]) => v != null && v !== '')), ...(cover ? { cover } : {}) });
        } else {
          await pipeline(fs.createReadStream(it.src), fs.createWriteStream(temp, { flags: 'wx' }), signal ? { signal } : {});
        }
        if (signal && signal.aborted) throw stop('cancelled');
        await fsp.rename(temp, it.dest);
        manifest[it.rel] = { key: it.key, stamp: it.stamp, action: it.action, size: (await fsp.stat(it.dest)).size };
        written++;
      } catch (e) {
        await fsp.rm(temp, { force: true }).catch(() => {});
        if (e.name === 'AbortError' || (signal && signal.aborted)) throw stop('cancelled');
        const stopped = whyStopped(e, dest);
        if (stopped) throw stopped;
        failed.push({ path: it.src, why: String(e.message || e) });
      }
      done++;
      // (the record is saved as each album is finished, not after every file: a card is slow to write to)
      const next = todo[n + 1];
      if (!next || next.album !== it.album) await writeManifest(dest, manifest).catch(() => {});
    }
  } finally {
    await writeManifest(dest, manifest).catch(() => {});
  }
  report(null);
  return { written, there, failed };
}

module.exports = { takeAlong, plan, planFiles, readManifest, convertInWorker, MANIFEST, FORMATS };
