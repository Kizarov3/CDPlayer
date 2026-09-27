'use strict';
/**
 * Ripping an audio CD into the music folder as FLAC: each track's audio is read here (on Windows through the same
 * drive helper playback uses), encoded and checked in a worker (encoders/worker.js), written, tagged from MusicBrainz
 * and renamed into place; the album's cover goes beside the files as cover.jpg. One track at a time; a cancel or a
 * failure deletes the file being written and keeps the finished ones.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Worker } = require('worker_threads');
const tagWriter = require('./tag-writer');
const winCd = require('./win-cd');
const { aiffToWav } = require('./decoders/aiff');
const { albumFolder, trackFiles } = require('./rip-names');

// ---- Reading a track --------------------------------------------------------------------------------------------

// The 16-bit PCM of a WAV (its data chunk), copied so it's aligned.
function wavPcm(wav) {
  for (let p = 12; p + 8 <= wav.length;) {
    const id = wav.toString('ascii', p, p + 4), size = wav.readUInt32LE(p + 4);
    if (id === 'data') return new Int16Array(new Uint8Array(wav.subarray(p + 8, p + 8 + Math.min(size, wav.length - p - 8))).buffer);
    p += 8 + size + (size & 1);
  }
  throw new Error('no audio in the track');
}
/** A CD track's audio as interleaved 16-bit stereo: macOS's AIFF, GNOME's WAV, or a Windows cdda:// track. */
async function trackPcm(trackPath) {
  if (winCd.parseTrackPath(trackPath)) {
    const info = winCd.trackInfo(trackPath);
    if (!info) { const e = new Error('the disc is gone'); e.code = 'ENOENT'; throw e; }
    const out = new Uint8Array(info.sectors * winCd.SECTOR);
    for (let s = 0; s < info.sectors; s += 25) {
      const n = Math.min(25, info.sectors - s);
      out.set(await winCd.readSectors(info.drive, info.lba + s, n), s * winCd.SECTOR);
    }
    return new Int16Array(out.buffer);
  }
  const buf = await fsp.readFile(trackPath);
  return wavPcm(/\.aiff?$/i.test(trackPath) ? aiffToWav(buf) : buf);
}

// ---- Encoding (in a worker) --------------------------------------------------------------------------------------

let worker = null, nextId = 1;
const jobs = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'encoders', 'worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`));
  worker.on('message', ({ id, flac, error }) => {
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    if (!jobs.size) worker.unref();
    error ? job.reject(new Error(error)) : job.resolve(Buffer.from(flac.buffer, flac.byteOffset, flac.byteLength));
  });
  worker.on('error', (e) => { for (const j of jobs.values()) j.reject(e); jobs.clear(); worker = null; });
  worker.unref();
  return worker;
}
/** A track's PCM as FLAC — encoded, decoded again and compared in the worker. */
function encodeChecked(pcm) {
  return new Promise((resolve, reject) => {
    const id = nextId++, w = getWorker();
    jobs.set(id, { resolve, reject });
    w.ref();
    w.postMessage({ id, pcm });
  });
}

// ---- The rip ----------------------------------------------------------------------------------------------------

const stop = (reason, message) => Object.assign(new Error(message || reason), { reason });

async function ripDisc({ tracks, album, musicFolder, signal, onProgress = () => {}, readPcm = trackPcm, encode = encodeChecked, writeTags = tagWriter.writeTags }) {
  const folder = albumFolder(musicFolder, album), names = trackFiles(tracks), files = [];
  await fsp.mkdir(folder, { recursive: true });
  if (album.cover) {
    const m = /^data:[^;]+;base64,(.*)$/s.exec(album.cover);
    if (m) await fsp.writeFile(path.join(folder, 'cover.jpg'), Buffer.from(m[1], 'base64'));
  }
  const report = (done) => onProgress({ done, total: tracks.length, percent: Math.round((done / tracks.length) * 100) });
  report(0);
  for (let i = 0; i < tracks.length; i++) {
    if (signal && signal.aborted) throw stop('cancelled');
    const t = tracks[i], final = path.join(folder, names[i]), temp = path.join(folder, `.${names[i]}.cdplayer-rip.flac`);
    try {
      let pcm;
      try { pcm = await readPcm(t.path); } catch (e) { throw e.code === 'ENOENT' ? stop('disc-removed') : stop('failed', e.message); }
      if (signal && signal.aborted) throw stop('cancelled');
      let flac;
      try { flac = await encode(pcm); } catch (e) { throw stop('failed', `${e.message} (${t.title || `track ${t.number}`})`); }
      if (signal && signal.aborted) throw stop('cancelled');
      await fsp.writeFile(temp, flac);
      const tagged = await writeTags(temp, {
        title: t.title || `Track ${t.number}`, artist: t.artist || album.artist || null, album: album.album || null,
        albumArtist: album.albumArtist || null, year: album.year || null, track: t.number, trackCount: tracks.length,
        disc: t.discs > 1 ? t.disc : null, discCount: t.discs > 1 ? t.discs : null,
        musicBrainzReleaseId: album.releaseId || null, cover: album.cover || null,
      });
      if (!tagged.ok) throw stop('failed', tagged.error);
      await fsp.rename(temp, final);
      files.push(final);
      report(i + 1);
    } catch (e) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      throw e.reason ? e : stop('failed', e.message);
    }
  }
  return { folder, files };
}

module.exports = { ripDisc, trackPcm, encodeChecked, wavPcm, albumFolder };
