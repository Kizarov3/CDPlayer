'use strict';
/**
 * The `cdp://` scheme. The UI itself is served from cdp://app/..., and audio from cdp://app/media?p=<path> — same
 * origin on purpose, so Web Audio can read the samples (a file:// <audio> routed into an AudioContext is treated
 * as cross-origin and plays silence). Supports HTTP Range requests so seeking is instant, and transparently
 * decodes the few formats Chromium can't play (AIFF, AU, Apple Lossless) to WAV first.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { Worker } = require('worker_threads');
const { fallbackKind } = require('./decoders');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.wav': 'audio/wav', '.wave': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
};

// ---- Fallback decoding ------------------------------------------------------------------------------------------

let worker = null, nextJob = 1;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  // Worker threads can't load scripts from inside the packaged app.asar archive, so the decoders ship unpacked.
  worker = new Worker(path.join(__dirname, 'decoders', 'worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`));
  worker.on('message', ({ id, wav, error }) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    error ? job.reject(new Error(error)) : job.resolve(Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength));
  });
  worker.on('error', (e) => { for (const job of pending.values()) job.reject(e); pending.clear(); worker = null; });
  worker.unref();
  return worker;
}
function decodeInWorker(kind, filePath) {
  return new Promise((resolve, reject) => {
    const id = nextJob++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, kind, filePath });
  });
}

// Decoded WAVs are kept for the few most recent tracks: the player, the waveform pass and a crossfade can all ask
// for the same file within seconds of each other.
const decoded = new Map();
async function getDecoded(kind, filePath) {
  const st = await fsp.stat(filePath);
  const key = `${filePath}\0${st.mtimeMs}\0${st.size}`;
  if (decoded.has(key)) { const v = decoded.get(key); decoded.delete(key); decoded.set(key, v); return v; }
  const job = decodeInWorker(kind, filePath);
  decoded.set(key, job);
  while (decoded.size > 3) decoded.delete(decoded.keys().next().value);
  try { return await job; } catch (e) { decoded.delete(key); throw e; }
}

// .m4a can be AAC (Chromium plays it) or Apple Lossless (it can't). The codec is named inside 'moov', which may sit
// at either end of the file, so walk the top-level box headers and read only 'moov' itself.
const codecCache = new Map();
async function isAppleLossless(filePath) {
  if (codecCache.has(filePath)) return codecCache.get(filePath);
  let result = false;
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
    const { size } = await fh.stat();
    const head = Buffer.alloc(16);
    let pos = 0;
    while (pos + 8 <= size) {
      await fh.read(head, 0, 16, pos);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (boxSize === 1) boxSize = Number(head.readBigUInt64BE(8));
      else if (boxSize === 0) boxSize = size - pos;
      if (boxSize < 8) break;
      if (type === 'moov') {
        const moov = Buffer.alloc(Math.min(boxSize, 64 * 1024 * 1024));
        await fh.read(moov, 0, moov.length, pos);
        result = fallbackKind(filePath, moov) === 'alac';
        break;
      }
      pos += boxSize;
    }
  } catch { result = false; }
  finally { if (fh) await fh.close().catch(() => {}); }
  codecCache.set(filePath, result);
  return result;
}

async function resolvePlayable(filePath) {
  let kind = fallbackKind(filePath, null);
  if (!kind && /\.(m4a|mp4)$/i.test(filePath) && await isAppleLossless(filePath)) kind = 'alac';
  return kind;
}

// ---- Responses ------------------------------------------------------------------------------------------------

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m) return null;
  let start = m[1] === '' ? null : parseInt(m[1], 10);
  let end = m[2] === '' ? null : parseInt(m[2], 10);
  if (start === null) { start = Math.max(0, size - end); end = size - 1; }
  else if (end === null || end >= size) end = size - 1;
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

function respond(request, size, type, bodyFor) {
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  if (range) {
    return new Response(bodyFor(range.start, range.end), {
      status: 206,
      headers: { ...headers, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` },
    });
  }
  return new Response(size ? bodyFor(0, size - 1) : null, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
}

async function serveMedia(request, filePath) {
  if (!filePath || !path.isAbsolute(filePath)) return new Response('Bad path', { status: 400 });
  let st;
  try { st = await fsp.stat(filePath); } catch { return new Response('Not found', { status: 404 }); }
  if (!st.isFile()) return new Response('Not found', { status: 404 });
  const kind = await resolvePlayable(filePath);
  if (kind) {
    let wav;
    try { wav = await getDecoded(kind, filePath); } catch (e) { return new Response(`Cannot decode: ${e.message}`, { status: 415 }); }
    return respond(request, wav.length, 'audio/wav', (start, end) => wav.subarray(start, end + 1));
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  return respond(request, st.size, type, (start, end) => Readable.toWeb(fs.createReadStream(filePath, { start, end })));
}

async function serveUi(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const full = path.normalize(path.join(RENDERER_DIR, rel));
  if (!full.startsWith(RENDERER_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const data = await fsp.readFile(full);
    return new Response(data, { headers: { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' } });
  } catch { return new Response('Not found', { status: 404 }); }
}

function handle(request) {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response('Not found', { status: 404 });
  if (url.pathname === '/media') return serveMedia(request, url.searchParams.get('p'));
  return serveUi(url.pathname);
}

module.exports = { handle, resolvePlayable, parseRange };
