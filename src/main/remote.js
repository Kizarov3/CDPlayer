'use strict';
/**
 * The phone remote's server: a small HTTP server on one home-network address. A phone pairs by the token in the QR
 * code (/pair → a cookie), then gets the player's state by Server-Sent Events (/events) and sends commands by POST
 * (/command); it can also read the shelf (/api/…) and covers (/cover/…). Everything it knows comes from the injected
 * callbacks — no file path, no filesystem access, nothing served that isn't in `files`. Every request must carry the
 * exact Host (no DNS rebinding) and, past /pair, the cookie; a POST also needs JSON, `X-CDP: 1` and the exact Origin.
 */
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const { hostAllowed, originAllowed, tokenOk, cookieValue, cookieOk, validCommand } = require('./remote-net');

const PAGE_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const BODY_LIMIT = 16 * 1024;
const DRAIN_LIMIT = 1024 * 1024; // past this an oversized body isn't read to its end, the connection is dropped
const PING_MS = 20000;
// A phone that stops reading (a locked iPhone's suspended page, one gone from the Wi-Fi) makes what's sent to it wait
// in main: past this, it's dropped — and counts as gone (the PHONE tag, keeping the PC awake).
const BACKLOG_LIMIT = 256 * 1024;
const KEEPALIVE_MS = 15000;
const COVERS_AT_ONCE = 3;
const COOKIE_AGE = 400 * 24 * 3600; // the longest browsers keep one
const KEY = /^[0-9a-f]{16}$/;

const phoneName = (ua) => (/iPhone|iPod/.test(ua || '') ? 'iPhone' : /Android/.test(ua || '') ? 'Android' : 'Browser');

function imageType(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  return 'image/jpeg';
}

// What a browser opens itself (the address typed in, a page reloaded after NEW CODE) — not the page's own requests.
const API = /^\/(events|command|api\/|cover\/)/;
const wantsPage = (req, path) => !API.test(path) && (path === '/' || /\btext\/html\b/.test(String(req.headers.accept || '')));

/**
 * `unpairedPage()` → the HTML shown to a browser that opens the page without the cookie (it says to scan the code),
 * or none: JSON, as the API answers.
 */
function createRemote({ address, port, token, files = {}, snapshot, command, albums, album, coverFor, nowCover, unpairedPage = null, onPhones = () => {}, log = () => {} }) {
  let server = null;
  let boundPort = null;
  let ping = null;
  let down = false;
  let nextId = 1;
  const clients = new Map(); // id → { res, name, since }

  const phones = () => [...clients].map(([id, c]) => ({ id, name: c.name, since: c.since }));
  const phonesChanged = () => { try { onPhones(phones()); } catch (e) { log(`phone remote: onPhones failed: ${e.message}`); } };

  function send(res, status, body = '', headers = {}) {
    if (res.headersSent) { res.end(); return; }
    const isJson = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    const data = isJson ? JSON.stringify(body) : body;
    res.writeHead(status, {
      ...PAGE_HEADERS,
      'Cache-Control': 'no-store',
      ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      ...headers,
      'Content-Length': Buffer.byteLength(data),
    });
    res.end(data);
  }
  const fail = (res, status, error) => send(res, status, { error });

  // At most COVERS_AT_ONCE covers made at once: making one resizes an image on the main process.
  let making = 0;
  const waiting = [];
  function limited(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        making++;
        Promise.resolve().then(fn).then(resolve, reject).finally(() => { making--; const next = waiting.shift(); if (next) next(); });
      };
      if (making < COVERS_AT_ONCE) run(); else waiting.push(run);
    });
  }

  function sendImage(req, res, bytes, cache) {
    const etag = `"${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 20)}"`;
    const headers = { 'Cache-Control': cache, ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...PAGE_HEADERS, ...headers }); res.end(); return; }
    send(res, 200, bytes, { ...headers, 'Content-Type': imageType(bytes) });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= BODY_LIMIT) chunks.push(c);
        else if (size > DRAIN_LIMIT) req.destroy();
      });
      req.on('end', () => resolve(size > BODY_LIMIT ? null : Buffer.concat(chunks).toString('utf8')));
      req.on('close', () => resolve(null)); // dropped before its end: settles as too big (no-op after 'end')
      req.on('error', reject);
    });
  }

  function pair(res, query) {
    if (!tokenOk(query.get('k'), token)) return fail(res, 403, 'pairing');
    res.writeHead(303, {
      ...PAGE_HEADERS,
      'Cache-Control': 'no-store',
      'Set-Cookie': `cdp=${cookieValue(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_AGE}`,
      Location: '/',
      'Content-Length': 0,
    });
    res.end();
  }

  function openEvents(req, res) {
    const state = down ? null : snapshot();
    if (!state) return fail(res, 503, 'player');
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true, KEEPALIVE_MS);
    res.writeHead(200, { ...PAGE_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    const id = nextId++;
    clients.set(id, { res, name: phoneName(req.headers['user-agent']), since: Date.now() });
    res.on('close', () => { if (clients.delete(id)) phonesChanged(); });
    phonesChanged();
  }

  // `text` to every open stream; one with more than BACKLOG_LIMIT still waiting to go is dropped (and gone at once).
  function toStreams(text) {
    let dropped = false;
    for (const [id, c] of clients) {
      c.res.write(text);
      if (c.res.writableLength > BACKLOG_LIMIT) {
        clients.delete(id);
        c.res.destroy();
        dropped = true;
        log(`phone remote: a phone (${c.name}) stopped reading; dropped`);
      }
    }
    if (dropped) phonesChanged();
  }

  async function postCommand(req, res) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json' || req.headers['x-cdp'] !== '1' || !originAllowed(req.headers.origin, address, boundPort)) return fail(res, 403, 'forbidden');
    if (down || !snapshot()) return fail(res, 503, 'player');
    const text = await readBody(req);
    if (text === null) return fail(res, 413, 'too big');
    let body;
    try { body = JSON.parse(text); } catch { return fail(res, 400, 'json'); }
    const cmd = validCommand(body);
    if (!cmd) return fail(res, 400, 'command');
    const result = await command(cmd);
    if (result && result.stale === true) return send(res, 409, { stale: true });
    send(res, 200, result || { ok: true });
  }

  async function handle(req, res) {
    if (!hostAllowed(req.headers.host, address, boundPort)) return fail(res, 421, 'host');
    if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'method');
    const raw = req.url || '/';
    const q = raw.indexOf('?');
    const path = q < 0 ? raw : raw.slice(0, q);
    const query = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1));
    if (path === '/pair' && req.method === 'GET') return pair(res, query);
    if (!cookieOk(req.headers.cookie, token)) {
      if (req.method === 'GET' && unpairedPage && wantsPage(req, path)) return send(res, 401, unpairedPage(), { 'Content-Type': 'text/html; charset=utf-8' });
      return fail(res, 401, 'unpaired');
    }
    if (path === '/command') return req.method === 'POST' ? postCommand(req, res) : fail(res, 405, 'method');
    if (req.method !== 'GET') return fail(res, 405, 'method');

    if (path === '/events') return openEvents(req, res);
    if (path === '/api/albums') {
      const data = Buffer.from(JSON.stringify(await albums()));
      const headers = { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' };
      if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
        const zipped = await new Promise((resolve, reject) => zlib.gzip(data, (e, out) => (e ? reject(e) : resolve(out))));
        return send(res, 200, zipped, { ...headers, 'Content-Encoding': 'gzip' });
      }
      return send(res, 200, data, headers);
    }
    if (path.startsWith('/api/album/')) {
      const key = path.slice('/api/album/'.length);
      const found = KEY.test(key) ? await album(key) : null;
      return found ? send(res, 200, found) : fail(res, 404, 'gone');
    }
    if (path === '/cover/now') {
      const now = nowCover();
      if (!now || !now.bytes || now.key !== query.get('v')) return fail(res, 404, 'cover');
      return sendImage(req, res, now.bytes, 'max-age=86400');
    }
    if (path.startsWith('/cover/')) {
      const key = path.slice('/cover/'.length);
      const bytes = KEY.test(key) ? await limited(() => coverFor(key)) : null;
      return bytes ? sendImage(req, res, bytes, 'max-age=86400') : fail(res, 404, 'cover');
    }
    if (Object.prototype.hasOwnProperty.call(files, path)) {
      const f = files[path];
      const body = typeof f.body === 'function' ? f.body() : f.body;
      return send(res, 200, body, { 'Content-Type': f.type, 'Cache-Control': 'no-cache' });
    }
    return fail(res, 404, 'not found');
  }

  function closeStreams(event) {
    for (const { res } of clients.values()) {
      if (event) res.write(event);
      res.end();
    }
    const had = clients.size > 0;
    clients.clear();
    if (had) phonesChanged();
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        const s = http.createServer((req, res) => {
          handle(req, res).catch((e) => {
            log(`phone remote: ${req.method} ${(req.url || '').split('?')[0]} failed: ${e && e.message}`);
            if (!res.headersSent) fail(res, 500, 'failed'); else res.end();
          });
        });
        s.once('error', reject);
        s.listen(port, address, () => {
          s.off('error', reject);
          s.on('error', (e) => log(`phone remote: server error: ${e.message}`));
          server = s;
          boundPort = s.address().port;
          ping = setInterval(() => toStreams(': ping\n\n'), PING_MS);
          if (ping.unref) ping.unref();
          resolve({ port: boundPort });
        });
      });
    },
    // `reason` goes to the phones with `event: closed` ("quit" when the app closes, "off" when it's turned off).
    stop(reason = 'quit') {
      if (!server) return Promise.resolve();
      const s = server;
      server = null;
      clearInterval(ping);
      ping = null;
      closeStreams(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`);
      return new Promise((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections();
      });
    },
    // `event`: 'state' (the whole state) or 'tick' ({ playing, position, duration }: where the song is).
    broadcast(data, event = 'state') { toStreams(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    setDown(value) { down = !!value; },
    phones,
    disconnectAll() { closeStreams(null); },
  };
}

module.exports = { createRemote };
