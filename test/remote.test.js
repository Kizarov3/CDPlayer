'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const zlib = require('zlib');
const net = require('net');
const { createRemote } = require('../src/main/remote');
const { cookieValue } = require('../src/main/remote-net');

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';
const COOKIE = `cdp=${cookieValue(TOKEN)}`;
const CSP = "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'";
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

// A server on 127.0.0.1 with a system-picked port and injected callbacks; stopped when the test ends.
async function serve(t, opts = {}) {
  const calls = { command: [] };
  const remote = createRemote({
    address: '127.0.0.1', port: 0, token: TOKEN,
    files: { '/': { body: Buffer.from('<!doctype html><title>remote</title>'), type: 'text/html; charset=utf-8' } },
    snapshot: () => ({ title: 'Song', rev: 1 }),
    command: async (cmd) => { calls.command.push(cmd); return { ok: true }; },
    albums: async () => [],
    album: async () => null,
    coverFor: async () => null,
    nowCover: () => null,
    ...opts,
  });
  const { port } = await remote.start();
  t.after(() => remote.stop());
  return { remote, port, calls };
}

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const POST_OK = (port) => ({ 'content-type': 'application/json', 'x-cdp': '1', origin: `http://127.0.0.1:${port}`, cookie: COOKIE });
const post = (port, body, headers = POST_OK(port)) => request(port, { method: 'POST', path: '/command', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

// An open /events stream: its parsed events as they come, waitFor(n) until n have arrived, close() to hang up.
function events(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/events', headers: { cookie: COOKIE, ...headers }, agent: false }, (res) => {
      const stream = { status: res.statusCode, headers: res.headers, list: [], raw: '', ended: false, waiters: [] };
      const check = () => { stream.waiters = stream.waiters.filter((w) => (w.test() ? (w.done(), false) : true)); };
      res.setEncoding('utf8');
      res.on('data', (c) => {
        stream.raw += c;
        let i;
        while ((i = stream.raw.indexOf('\n\n')) >= 0) {
          const block = stream.raw.slice(0, i); stream.raw = stream.raw.slice(i + 2);
          const ev = { event: 'message', data: '', comment: null };
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) ev.comment = line.slice(1).trim();
            else if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) ev.data += line.slice(6);
          }
          stream.list.push(ev);
        }
        check();
      });
      res.on('end', () => { stream.ended = true; check(); });
      res.on('error', () => {});
      stream.waitFor = (n) => new Promise((done) => { stream.waiters.push({ test: () => stream.list.length >= n, done }); check(); });
      stream.waitEnd = () => new Promise((done) => { stream.waiters.push({ test: () => stream.ended, done }); check(); });
      stream.close = () => req.destroy();
      resolve(stream);
    });
    req.on('error', reject);
    req.end();
  });
}

test('pairing with the right k sets an HttpOnly, SameSite=Strict cookie and redirects 303 to /', async (t) => {
  const { port } = await serve(t);
  const r = await request(port, { path: `/pair?k=${TOKEN}` });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(r.headers.location, '/');
  const set = r.headers['set-cookie'];
  assert.strictEqual(set.length, 1);
  assert.match(set[0], new RegExp(`^cdp=${cookieValue(TOKEN)};`));
  assert.match(set[0], /HttpOnly/);
  assert.match(set[0], /SameSite=Strict/);
  const page = await request(port, { path: '/', headers: { cookie: set[0].split(';')[0] } });
  assert.strictEqual(page.status, 200);
});

test('pairing with a wrong or missing k answers 403 and sets no cookie', async (t) => {
  const { port } = await serve(t);
  for (const path of ['/pair?k=BBBBBBBBBBBBBBBBBBBBBB', '/pair?k=', '/pair', `/pair?k=${TOKEN}x`]) {
    const r = await request(port, { path });
    assert.strictEqual(r.status, 403, path);
    assert.strictEqual(r.headers['set-cookie'], undefined, path);
  }
});

test('without the cookie, or with a wrong one, every route but /pair answers 401', async (t) => {
  const { port, calls } = await serve(t);
  for (const path of ['/events', '/', '/api/albums', '/api/album/0123456789abcdef', '/cover/0123456789abcdef', '/cover/now?v=x']) {
    assert.strictEqual((await request(port, { path })).status, 401, path);
    assert.strictEqual((await request(port, { path, headers: { cookie: 'cdp=nope' } })).status, 401, path);
  }
  const headers = { ...POST_OK(port) }; delete headers.cookie;
  assert.strictEqual((await post(port, { action: 'toggle' }, headers)).status, 401);
  assert.strictEqual(calls.command.length, 0);
});

test('a browser opening the page unpaired gets a page saying to scan the code; the API still answers JSON', async (t) => {
  const page = '<!doctype html><html lang="en"><body bgcolor="#000000">Scan the code</body></html>';
  const { port } = await serve(t, { unpairedPage: () => page });
  for (const path of ['/', '/?from=settings']) {
    const r = await request(port, { path, headers: { cookie: 'cdp=nope' } });
    assert.strictEqual(r.status, 401, path);
    assert.strictEqual(r.headers['content-type'], 'text/html; charset=utf-8', path);
    assert.strictEqual(r.body.toString(), page, path);
    assert.strictEqual(r.headers['content-security-policy'], CSP, path);
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff', path);
    assert.strictEqual(r.headers['referrer-policy'], 'no-referrer', path);
    assert.strictEqual(r.headers['cache-control'], 'no-store', path);
  }
  // Another page a browser opens itself (it says it wants HTML): the same page.
  const other = await request(port, { path: '/index.html', headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
  assert.strictEqual(other.status, 401);
  assert.strictEqual(other.body.toString(), page);
  // What the page's own script asks for, and anything else: JSON, as before — the API even when it says it takes HTML.
  for (const path of ['/events', '/api/albums', '/api/album/0123456789abcdef', '/cover/0123456789abcdef', '/cover/now?v=x', '/remote.js', '/favicon.ico']) {
    const r = await request(port, { path, headers: /^\/(events|api|cover)/.test(path) ? { accept: 'text/html,*/*' } : {} });
    assert.strictEqual(r.status, 401, path);
    assert.match(r.headers['content-type'], /^application\/json/, path);
    assert.deepStrictEqual(JSON.parse(r.body), { error: 'unpaired' }, path);
  }
  const headers = { ...POST_OK(port), accept: 'text/html' }; delete headers.cookie;
  const r = await post(port, { action: 'toggle' }, headers);
  assert.strictEqual(r.status, 401);
  assert.deepStrictEqual(JSON.parse(r.body), { error: 'unpaired' });
});

test('a Host other than exactly IP:PORT answers 421, even for a right pairing', async (t) => {
  const { port } = await serve(t);
  for (const host of [`localhost:${port}`, 'evil.example', '127.0.0.1', `127.0.0.1:${port + 1}`, `127.0.0.1:${port}.evil.example`]) {
    const r = await request(port, { path: `/pair?k=${TOKEN}`, headers: { host } });
    assert.strictEqual(r.status, 421, host);
    assert.strictEqual(r.headers['set-cookie'], undefined, host);
    assert.strictEqual((await request(port, { path: '/events', headers: { host, cookie: COOKIE } })).status, 421, host);
  }
});

test('a POST without X-CDP, with a wrong or missing Origin, or not JSON answers 403 and reaches nothing', async (t) => {
  const { port, calls } = await serve(t);
  const ok = POST_OK(port);
  const without = (name) => { const h = { ...ok }; delete h[name]; return h; };
  const cases = [
    without('x-cdp'),
    { ...ok, 'x-cdp': '0' },
    { ...ok, origin: 'http://evil.example' },
    { ...ok, origin: `http://localhost:${port}` },
    without('origin'),
    { ...ok, 'content-type': 'text/plain' },
    { ...ok, 'content-type': 'application/x-www-form-urlencoded' },
    without('content-type'),
  ];
  for (const headers of cases) assert.strictEqual((await post(port, { action: 'toggle' }, headers)).status, 403, JSON.stringify(headers));
  assert.strictEqual(calls.command.length, 0);
});

test('a CORS preflight is not answered: OPTIONS is 405 with no Access-Control headers', async (t) => {
  const { port } = await serve(t);
  const r = await request(port, { method: 'OPTIONS', path: '/command', headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST', cookie: COOKIE } });
  assert.strictEqual(r.status, 405);
  assert.ok(!Object.keys(r.headers).some((h) => h.startsWith('access-control-')));
});

test('an invalid command, broken JSON or a body over 16 KB is refused and never reaches command', async (t) => {
  const { port, calls } = await serve(t);
  assert.strictEqual((await post(port, { action: 'format-disk' })).status, 400);
  assert.strictEqual((await post(port, { action: 'volume', value: 400 })).status, 400);
  assert.strictEqual((await post(port, { action: 'remove', value: 2 })).status, 400); // no rev
  assert.strictEqual((await post(port, '{"action":')).status, 400);
  assert.strictEqual((await post(port, JSON.stringify({ action: 'toggle', pad: 'x'.repeat(17 * 1024) }))).status, 413);
  assert.strictEqual(calls.command.length, 0);
});

test('a valid command reaches command as the checked shape, and its result comes back as JSON', async (t) => {
  let answer = { ok: true };
  const got = [];
  const { port } = await serve(t, { command: async (cmd) => { got.push(cmd); return answer; } });
  let r = await post(port, { action: 'volume', value: 40, extra: 'dropped' });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers['content-type'], /^application\/json/);
  assert.deepStrictEqual(JSON.parse(r.body), { ok: true });
  assert.deepStrictEqual(got, [{ action: 'volume', value: 40, rev: undefined }]);
  answer = { full: [{ slot: 0, title: 'A' }] };
  r = await post(port, { action: 'album', value: { id: '0123456789abcdef', how: 'play' }, rev: 3 });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.body), answer);
  answer = { error: 'gone' };
  r = await post(port, { action: 'playIndex', value: 9, rev: 3 });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.body), { error: 'gone' });
  const h = POST_OK(port); h['content-type'] = 'application/json; charset=utf-8';
  assert.strictEqual((await post(port, { action: 'toggle' }, h)).status, 200);
});

test('a command whose rev command reports stale answers 409', async (t) => {
  const { port } = await serve(t, { command: async (cmd) => (cmd.rev === 7 ? { ok: true } : { stale: true }) });
  assert.strictEqual((await post(port, { action: 'move', value: { from: 0, to: 2 }, rev: 6 })).status, 409);
  assert.strictEqual((await post(port, { action: 'move', value: { from: 0, to: 2 }, rev: 7 })).status, 200);
});

test('while snapshot() is null or the server is set down, /events and /command answer 503', async (t) => {
  let state = null;
  const { remote, port, calls } = await serve(t, { snapshot: () => state });
  assert.strictEqual((await request(port, { path: '/events', headers: { cookie: COOKIE } })).status, 503);
  assert.strictEqual((await post(port, { action: 'toggle' })).status, 503);
  state = { rev: 1 };
  remote.setDown(true);
  assert.strictEqual((await request(port, { path: '/events', headers: { cookie: COOKIE } })).status, 503);
  assert.strictEqual((await post(port, { action: 'toggle' })).status, 503);
  assert.strictEqual(calls.command.length, 0);
  remote.setDown(false);
  assert.strictEqual((await post(port, { action: 'toggle' })).status, 200);
  const s = await events(port);
  assert.strictEqual(s.status, 200);
  await s.waitFor(1);
  s.close();
});

test('two SSE clients each get the snapshot on connect and every broadcast; phones() names them', async (t) => {
  const seen = [];
  const { remote, port } = await serve(t, { snapshot: () => ({ rev: 1 }), onPhones: (list) => seen.push(list.length) });
  const a = await events(port, { 'user-agent': IPHONE });
  const b = await events(port, { 'user-agent': ANDROID });
  assert.strictEqual(a.status, 200);
  assert.match(a.headers['content-type'], /^text\/event-stream/);
  await Promise.all([a.waitFor(1), b.waitFor(1)]);
  assert.deepStrictEqual(a.list[0], { event: 'state', data: '{"rev":1}', comment: null });
  assert.deepStrictEqual(b.list[0], { event: 'state', data: '{"rev":1}', comment: null });
  const phones = remote.phones();
  assert.deepStrictEqual(phones.map((p) => p.name).sort(), ['Android', 'iPhone']);
  assert.ok(phones.every((p) => p.id !== undefined && typeof p.since === 'number'));
  assert.notStrictEqual(phones[0].id, phones[1].id);
  remote.broadcast({ rev: 2, title: 'Next' });
  await Promise.all([a.waitFor(2), b.waitFor(2)]);
  assert.deepStrictEqual(JSON.parse(a.list[1].data), { rev: 2, title: 'Next' });
  assert.deepStrictEqual(JSON.parse(b.list[1].data), { rev: 2, title: 'Next' });
  a.close();
  await new Promise((r) => { const tick = () => (remote.phones().length === 1 ? r() : setTimeout(tick, 5)); tick(); });
  assert.strictEqual(remote.phones()[0].name, 'Android');
  assert.deepStrictEqual(seen, [1, 2, 1]);
  b.close();
});

test('a tick goes as its own small event, only where the song is', async (t) => {
  const { remote, port } = await serve(t);
  const s = await events(port);
  await s.waitFor(1);
  remote.broadcast({ playing: true, position: 12.5, duration: 200 }, 'tick');
  await s.waitFor(2);
  assert.deepStrictEqual(s.list[1], { event: 'tick', data: '{"playing":true,"position":12.5,"duration":200}', comment: null });
  s.close();
});

// A phone that's stopped reading (a locked iPhone's suspended page, a phone gone from the Wi-Fi): a raw connection
// that asks for /events and then never reads.
async function stuckPhone(port) {
  const sock = net.connect(port, '127.0.0.1');
  await new Promise((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
  sock.on('error', () => {});
  sock.write(`GET /events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${COOKIE}\r\nUser-Agent: ${IPHONE}\r\n\r\n`);
  sock.pause();
  return sock;
}
const until = (ok) => new Promise((resolve) => { const look = () => (ok() ? resolve() : setTimeout(look, 5)); look(); });
const BIG = { rev: 2, pad: 'x'.repeat(64 * 1024) };

test('a phone that stops reading is dropped once 256 KB wait for it, and counts as gone', async (t) => {
  const seen = [];
  const { remote, port } = await serve(t, { onPhones: (list) => seen.push(list.length) });
  const sock = await stuckPhone(port);
  t.after(() => sock.destroy());
  await until(() => remote.phones().length === 1);
  let sent = 0;
  while (remote.phones().length && sent < 4000) { remote.broadcast(BIG); sent++; await new Promise((r) => setImmediate(r)); }
  assert.deepStrictEqual(remote.phones(), [], `still there after ${sent} states of 64 KB`);
  assert.deepStrictEqual(seen, [1, 0]);
  await new Promise((r) => sock.once('close', r).resume()); // and its connection is closed
});

test('a phone that keeps reading is never dropped, however much it is sent', async (t) => {
  const { remote, port } = await serve(t);
  const s = await events(port);
  await s.waitFor(1);
  for (let k = 0; k < 40; k++) { remote.broadcast(BIG); await s.waitFor(k + 2); }
  assert.strictEqual(remote.phones().length, 1);
  s.close();
});

test('a browser that is neither iPhone nor Android is named Browser', async (t) => {
  const { remote, port } = await serve(t);
  const s = await events(port, { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/131.0' });
  await s.waitFor(1);
  assert.deepStrictEqual(remote.phones().map((p) => p.name), ['Browser']);
  s.close();
});

test('an open stream gets a ": ping" comment every 20 s', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { port } = await serve(t);
  const s = await events(port);
  await s.waitFor(1);
  t.mock.timers.tick(20000);
  await s.waitFor(2);
  assert.strictEqual(s.list[1].comment, 'ping');
  s.close();
});

test('disconnectAll ends every open stream', async (t) => {
  const { remote, port } = await serve(t);
  const a = await events(port); const b = await events(port);
  await Promise.all([a.waitFor(1), b.waitFor(1)]);
  remote.disconnectAll();
  await Promise.all([a.waitEnd(), b.waitEnd()]);
  assert.deepStrictEqual(remote.phones(), []);
});

test('stop() ends open streams with event: closed and stops listening', async (t) => {
  const { remote, port } = await serve(t);
  const s = await events(port);
  await s.waitFor(1);
  await remote.stop();
  await s.waitEnd();
  assert.strictEqual(s.list.at(-1).event, 'closed');
  await assert.rejects(request(port, { path: '/' }));
  await remote.stop(); // a second stop is harmless
});

test('four covers asked at once call coverFor at most three at a time; covers carry an ETag and max-age', async (t) => {
  let inFlight = 0, most = 0;
  const pending = [];
  const { port } = await serve(t, {
    coverFor: (key) => new Promise((resolve) => {
      inFlight++; most = Math.max(most, inFlight);
      pending.push(() => { inFlight--; resolve(key === 'ffffffffffffffff' ? null : Buffer.from([0xff, 0xd8, 0xff, key.charCodeAt(0)])); });
    }),
  });
  const keys = ['0000000000000001', '0000000000000002', '0000000000000003', '0000000000000004'];
  const asks = keys.map((k) => request(port, { path: `/cover/${k}`, headers: { cookie: COOKIE } }));
  await new Promise((r) => { const tick = () => (pending.length >= 3 ? r() : setTimeout(tick, 5)); tick(); });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(pending.length, 3);
  while (pending.length) pending.shift()();
  await new Promise((r) => { const tick = () => (pending.length >= 1 ? r() : setTimeout(tick, 5)); tick(); });
  pending.shift()();
  const answers = await Promise.all(asks);
  assert.strictEqual(most, 3);
  for (const a of answers) {
    assert.strictEqual(a.status, 200);
    assert.strictEqual(a.headers['content-type'], 'image/jpeg');
    assert.strictEqual(a.headers['cache-control'], 'max-age=86400');
    assert.ok(a.headers.etag);
  }
  const again = request(port, { path: `/cover/${keys[0]}`, headers: { cookie: COOKIE, 'if-none-match': answers[0].headers.etag } });
  await new Promise((r) => { const tick = () => (pending.length >= 1 ? r() : setTimeout(tick, 5)); tick(); });
  pending.shift()();
  assert.strictEqual((await again).status, 304);
  const none = request(port, { path: '/cover/ffffffffffffffff', headers: { cookie: COOKIE } });
  await new Promise((r) => { const tick = () => (pending.length >= 1 ? r() : setTimeout(tick, 5)); tick(); });
  pending.shift()();
  assert.strictEqual((await none).status, 404);
  assert.strictEqual((await request(port, { path: '/cover/not-a-key', headers: { cookie: COOKIE } })).status, 404);
});

test('/cover/now serves the cover playing now for its own key only', async (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  let now = { key: 'abc', bytes: png };
  const { port } = await serve(t, { nowCover: () => now });
  const r = await request(port, { path: '/cover/now?v=abc', headers: { cookie: COOKIE } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['content-type'], 'image/png');
  assert.deepStrictEqual(r.body, png);
  assert.strictEqual((await request(port, { path: '/cover/now?v=old', headers: { cookie: COOKIE } })).status, 404);
  now = null;
  assert.strictEqual((await request(port, { path: '/cover/now?v=abc', headers: { cookie: COOKIE } })).status, 404);
});

test('/api/albums is JSON, gzipped when the phone accepts it; /api/album/:key is 404 when album() finds none', async (t) => {
  const list = [{ id: '0123456789abcdef', title: 'Album', artist: 'Artist', year: 1999, n: 10 }];
  const one = { id: '0123456789abcdef', title: 'Album', artist: 'Artist', year: 1999, tracks: [{ title: 'One', duration: 200, disc: 1, track: 1 }] };
  const { port } = await serve(t, { albums: async () => list, album: async (key) => (key === one.id ? one : null) });
  const plain = await request(port, { path: '/api/albums', headers: { cookie: COOKIE } });
  assert.strictEqual(plain.status, 200);
  assert.match(plain.headers['content-type'], /^application\/json/);
  assert.strictEqual(plain.headers['content-encoding'], undefined);
  assert.deepStrictEqual(JSON.parse(plain.body), list);
  const gz = await request(port, { path: '/api/albums', headers: { cookie: COOKIE, 'accept-encoding': 'gzip, deflate, br' } });
  assert.strictEqual(gz.headers['content-encoding'], 'gzip');
  assert.deepStrictEqual(JSON.parse(zlib.gunzipSync(gz.body)), list);
  const a = await request(port, { path: `/api/album/${one.id}`, headers: { cookie: COOKIE } });
  assert.strictEqual(a.status, 200);
  assert.deepStrictEqual(JSON.parse(a.body), one);
  assert.strictEqual((await request(port, { path: '/api/album/fedcba9876543210', headers: { cookie: COOKIE } })).status, 404);
  assert.strictEqual((await request(port, { path: '/api/album/..%2F..%2Fetc', headers: { cookie: COOKIE } })).status, 404);
});

test('only the files allowlist is served, by exact path, with the page headers on every response', async (t) => {
  let made = 0;
  const { port } = await serve(t, {
    files: {
      '/': { body: Buffer.from('<!doctype html>'), type: 'text/html; charset=utf-8' },
      '/boot.js': { body: () => { made++; return Buffer.from('window.cdp = {};'); }, type: 'text/javascript; charset=utf-8' },
    },
  });
  const check = (r, what) => {
    assert.strictEqual(r.headers['content-security-policy'], CSP, what);
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff', what);
    assert.strictEqual(r.headers['referrer-policy'], 'no-referrer', what);
  };
  const page = await request(port, { path: '/', headers: { cookie: COOKIE } });
  assert.strictEqual(page.status, 200);
  assert.strictEqual(page.headers['content-type'], 'text/html; charset=utf-8');
  check(page, '/');
  const boot = await request(port, { path: '/boot.js', headers: { cookie: COOKIE } });
  assert.strictEqual(boot.body.toString(), 'window.cdp = {};');
  assert.strictEqual(made, 1);
  check(boot, '/boot.js');
  for (const path of ['/boot.js/', '/./boot.js', '/js/../boot.js', '/../package.json', '/index.html', '/toString', '/__proto__', '//boot.js']) {
    const r = await request(port, { path, headers: { cookie: COOKIE } });
    assert.strictEqual(r.status, 404, path);
    check(r, path);
  }
  check(await request(port, { path: '/' }), '401');
  check(await request(port, { path: '/pair?k=nope' }), '403');
  check(await request(port, { path: `/pair?k=${TOKEN}` }), '303');
});

test('start() with port 0 resolves the port the system picked, and Host is checked against it', async (t) => {
  const { port } = await serve(t);
  assert.ok(Number.isInteger(port) && port > 0);
  assert.strictEqual((await request(port, { path: '/', headers: { cookie: COOKIE, host: `127.0.0.1:${port}` } })).status, 200);
  assert.strictEqual((await request(port, { path: '/', headers: { cookie: COOKIE, host: '127.0.0.1:0' } })).status, 421);
});
