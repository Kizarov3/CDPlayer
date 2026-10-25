'use strict';
/**
 * Streamed songs (YouTube Music, YouTube, SoundCloud), through yt-dlp: it finds where a song's sound is, and the
 * cdp:// scheme serves it from there (cdp://app/stream?u=<the song's page>) — same origin, so Web Audio hears it and
 * the EQ, spatial audio and the visualizer work as for a file — a piece at a time (YouTube slows a whole song asked
 * for at once to the speed it plays at, and a seek would wait for it).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHUNK = 1024 * 1024; // what's asked of the server at a time
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CANDIDATES = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];

function ytDlpPath() {
  return CANDIDATES.find((p) => fs.existsSync(p)) || 'yt-dlp';
}

function run(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    // (Homebrew's yt-dlp finds deno, for YouTube's checks, on the PATH a Finder-opened app doesn't have)
    const env = { ...process.env, PATH: [path.dirname(ytDlpPath()), process.env.PATH || ''].join(path.delimiter) };
    execFile(ytDlpPath(), args, { timeout, maxBuffer: 64 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) { reject(new Error(String(stderr || err.message).trim().split('\n').pop())); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

// A song's page → where its sound is, kept till a little before the address runs out (YouTube's say when: expire=).
const found = new Map();
function expiry(url) {
  const m = /[?&]expire=(\d+)/.exec(url);
  return m ? Number(m[1]) * 1000 - 10 * 60 * 1000 : Date.now() + 60 * 60 * 1000;
}
async function resolve(page, { fresh = false } = {}) {
  const had = found.get(page);
  if (had && !fresh && had.until > Date.now()) return had;
  const info = await run(['-f', 'bestaudio', '-J', '--no-playlist', page]);
  const entry = {
    url: info.url, headers: info.http_headers || {}, size: info.filesize || info.filesize_approx || null,
    type: info.ext === 'webm' ? 'audio/webm' : info.ext === 'm4a' ? 'audio/mp4' : info.ext === 'mp3' ? 'audio/mpeg' : 'application/octet-stream',
    title: info.track || info.title, artist: info.artist || info.uploader, album: info.album || null, year: info.release_year || null,
    duration: info.duration || null, until: expiry(info.url),
    // YouTube's address answers only a few seconds after it's given (yt-dlp waits too: "as required by the site")
    readyAt: Date.now() + (/googlevideo\.com/.test(info.url) ? 4000 : 0),
  };
  found.set(page, entry);
  return entry;
}

/** What `query` finds: albums on YouTube Music ({ kind: 'album', page }), or songs on SoundCloud. */
async function search(query, where = 'ytmusic-albums') {
  const url = where === 'soundcloud' ? `scsearch10:${query}` : `https://music.youtube.com/search?q=${encodeURIComponent(query)}#albums`;
  const r = await run(['--flat-playlist', '-J', url]);
  return (r.entries || []).map((e) => ({ id: e.id, title: e.title || null, page: e.url, duration: e.duration || null }));
}

/** An album (or playlist) page → its songs, in order. */
async function album(page) {
  const r = await run(['--flat-playlist', '-J', page]);
  return {
    title: String(r.title || '').replace(/^Album - /, ''), page: r.webpage_url || page,
    tracks: (r.entries || []).map((e) => ({
      page: e.url && /^https?:/.test(e.url) ? e.url : `https://music.youtube.com/watch?v=${e.id}`, id: e.id, title: e.title,
      artist: (e.artists && e.artists[0]) || e.channel || null, duration: e.duration || null,
    })),
  };
}

// One piece of the sound, `start`–`last`: the server's answer (asked again while it isn't answering yet, and for a new
// address once that has run out), and the whole song's size.
async function fetchPiece(page, start, last) {
  let entry = await resolve(page);
  if (entry.readyAt > Date.now()) await wait(entry.readyAt - Date.now());
  const ask = () => fetch(entry.url, { headers: { 'User-Agent': entry.headers['User-Agent'] || 'Mozilla/5.0', Range: `bytes=${start}-${last}` } });
  let res = await ask();
  for (let tries = 0; (res.status === 403 || res.status === 410) && tries < 4; tries++) {
    await res.arrayBuffer().catch(() => {});
    if (tries >= 2) entry = await resolve(page, { fresh: true });
    await wait(Math.max(1000, entry.readyAt - Date.now()));
    res = await ask();
  }
  const total = Number((/\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1]) || null;
  if (total) entry.size = total;
  return { res, total };
}

/**
 * cdp://app/stream?u=<page>: the song's sound. The player is answered with all it asks for (a piece shorter than that
 * it takes for the whole song), fetched from the server a CHUNK at a time, one after another as it's read.
 */
async function serveStream(request, page) {
  if (!page || !/^https:\/\/(music\.youtube\.com|www\.youtube\.com|youtube\.com|soundcloud\.com|api\.soundcloud\.com)\//.test(page)) {
    return new Response('Bad page', { status: 400 });
  }
  const m = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
  const start = m ? Number(m[1]) : 0;
  let first, total;
  try { ({ res: first, total } = await fetchPiece(page, start, start + CHUNK - 1)); } catch (e) { return new Response(`Not found: ${e.message}`, { status: 404 }); }
  if (!first.ok || !total) return new Response(`Upstream ${first.status}`, { status: 502 });
  const end = Math.min(m && m[2] ? Number(m[2]) : total - 1, total - 1);
  let at = start, reader = first.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (!done) {
          const take = value.subarray(0, Math.max(0, end + 1 - at));
          at += take.length;
          if (take.length) controller.enqueue(take);
          if (at > end) { reader.cancel().catch(() => {}); controller.close(); }
          return;
        }
        if (at > end) { controller.close(); return; }
        try {
          const { res } = await fetchPiece(page, at, Math.min(end, at + CHUNK - 1));
          if (!res.ok) throw new Error(String(res.status));
          reader = res.body.getReader();
        } catch (e) { controller.error(e); return; }
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });
  const type = (found.get(page) || {}).type || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': String(end - start + 1) };
  if (!m) return new Response(body, { status: 200, headers });
  return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}` } });
}

module.exports = { resolve, search, album, serveStream, ytDlpPath };
