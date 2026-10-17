'use strict';
// How main carries the phone remote (remote-wiring.js): remote.json, the page's states, album commands, the replies
// awaited from the page and when the PC is kept awake. No server, no window.
const test = require('node:test');
const assert = require('node:assert');
const w = require('../src/main/remote-wiring');

test('remote.json: off with no token by default; a bad token, port or address is dropped, and port 8080 is never used', () => {
  assert.deepStrictEqual(w.readRemoteConf(null), { on: false, token: null, port: 47800, address: null });
  assert.deepStrictEqual(w.readRemoteConf('not json'), { on: false, token: null, port: 47800, address: null });
  const token = 'AAAAAAAAAAAAAAAAAAAAAA';
  assert.deepStrictEqual(w.readRemoteConf(JSON.stringify({ on: true, token, port: 51234, address: '192.168.1.20' })),
    { on: true, token, port: 51234, address: '192.168.1.20' });
  assert.deepStrictEqual(w.readRemoteConf(JSON.stringify({ on: 'yes', token: 'short', port: 8080, address: '8.8.8.8' })),
    { on: false, token: null, port: 47800, address: null });
  for (const port of [0, 80, 70000, 1.5, '47801']) assert.strictEqual(w.readRemoteConf(JSON.stringify({ port })).port, 47800, String(port));
});

test('a full state is kept without its cover; the cover is kept apart under the key it was sent with', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const full = { rev: 3, playing: false, position: 0, duration: 200, track: { title: 'Airbag', coverKey: 'k.1' }, cover: `data:image/png;base64,${png.toString('base64')}` };
  const a = w.nextRemoteState({ state: null, cover: null }, full);
  assert.strictEqual(a.full, true);
  assert.strictEqual('cover' in a.state, false);
  assert.deepStrictEqual(a.state.track, { title: 'Airbag', coverKey: 'k.1' });
  assert.deepStrictEqual(a.cover, { key: 'k.1', bytes: png });
  assert.strictEqual('cover' in full, true, 'the message itself is left as it came');

  // The same cover (no `cover` in the state): the one kept stays.
  const { cover: _, ...sameCover } = full;
  assert.strictEqual(w.nextRemoteState(a, { ...sameCover, rev: 4 }).cover, a.cover);

  // A new cover that isn't a picture's data (or none at all): nothing to show.
  assert.strictEqual(w.nextRemoteState(a, { ...full, track: { coverKey: null }, cover: null }).cover, null);
  assert.strictEqual(w.nextRemoteState(a, { ...full, track: { coverKey: 'k.2' }, cover: 'cdp://app/media?p=/x.jpg' }).cover, null);
});

test('between full states, where the song is goes into the last full state', () => {
  const kept = { state: { rev: 3, playing: false, position: 0, duration: 200, volume: 40, track: { title: 'Airbag' } }, cover: null };
  const r = w.nextRemoteState(kept, { playing: true, position: 12.5, duration: 201, volume: 99 });
  assert.strictEqual(r.full, false);
  assert.deepStrictEqual(r.state, { rev: 3, playing: true, position: 12.5, duration: 201, volume: 40, track: { title: 'Airbag' } });
  assert.strictEqual(kept.state.position, 0, 'the kept state is not changed in place');
  assert.deepStrictEqual(w.nextRemoteState({ state: null, cover: null }, { playing: true, position: 1, duration: 2 }), { state: null, cover: null, full: false }, 'nothing to merge into yet');
  assert.strictEqual(w.nextRemoteState(kept, null).state, kept.state);
});

test('dataUrlBytes decodes a base64 data URL and nothing else', () => {
  assert.deepStrictEqual(w.dataUrlBytes('data:image/jpeg;base64,AAEC'), Buffer.from([0, 1, 2]));
  for (const bad of [null, '', 'https://x/y.jpg', 'data:image/jpeg,AAEC', 'data:image/jpeg;base64,']) assert.strictEqual(w.dataUrlBytes(bad), null, String(bad));
});

test('an album command from the phone goes to the page as the shelf album, paths and all; without the album, nothing goes', () => {
  const album = {
    id: '/Music/Radiohead/OK Computer', title: 'OK Computer', artist: 'Radiohead', year: '1997', folder: '/Music/Radiohead/OK Computer', plays: 3,
    tracks: [{ path: '/Music/Radiohead/OK Computer/01.flac', title: 'Airbag' }, { path: '/Music/Radiohead/OK Computer/02.flac', title: 'Paranoid Android' }],
  };
  assert.deepStrictEqual(w.albumCommand({ action: 'album', value: { id: 'abcdef0123456789', how: 'play', track: 1 }, rev: 9 }, album), {
    action: 'album', rev: 9,
    value: { how: 'play', track: 1, album: { id: album.id, title: 'OK Computer', artist: 'Radiohead', year: '1997', paths: ['/Music/Radiohead/OK Computer/01.flac', '/Music/Radiohead/OK Computer/02.flac'] } },
  });
  const slotted = w.albumCommand({ action: 'album', value: { id: 'abcdef0123456789', how: 'next', slot: 2 }, rev: 1 }, album);
  assert.deepStrictEqual(Object.keys(slotted.value).sort(), ['album', 'how', 'slot']);
  assert.strictEqual(slotted.value.slot, 2);
  assert.strictEqual(w.albumCommand({ action: 'album', value: { id: 'abcdef0123456789', how: 'add' }, rev: 1 }, undefined), null);
});

test('replies: each command waits for the page\'s answer with its id; none in time is "busy", and so is no page', async () => {
  const sent = [];
  let timers = [];
  const replies = w.createReplies({
    send: (id, cmd) => { sent.push({ id, cmd }); return true; }, timeoutMs: 5000,
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: (t) => { timers = timers.filter((x) => x !== t); },
  });
  const a = replies.ask({ action: 'toggle' }), b = replies.ask({ action: 'next' });
  assert.deepStrictEqual(sent.map((s) => s.cmd.action), ['toggle', 'next']);
  assert.notStrictEqual(sent[0].id, sent[1].id);
  assert.deepStrictEqual(timers.map((t) => t.ms), [5000, 5000]);
  replies.reply(sent[1].id, { ok: true });
  replies.reply(sent[1].id, { error: 'late' }); // a second answer to the same id: ignored
  replies.reply(12345, { ok: true }); // an id nobody asked: ignored
  assert.deepStrictEqual(await b, { ok: true });
  assert.strictEqual(timers.length, 1, 'answered: its timer is cleared');
  timers[0].fn();
  assert.deepStrictEqual(await a, { error: 'busy' });

  const c = replies.ask({ action: 'prev' });
  replies.failAll({ error: 'busy' }); // the page went
  assert.deepStrictEqual(await c, { error: 'busy' });
  assert.strictEqual(timers.length, 0);
  replies.reply(sent[2].id, { ok: true }); // too late: nothing waits for it

  const none = w.createReplies({ send: () => false, timeoutMs: 5000 });
  assert.deepStrictEqual(await none.ask({ action: 'toggle' }), { error: 'busy' });
});

test('the PC is kept awake while the remote is on and a phone is connected or was in the last 30 minutes', () => {
  const now = 10_000_000_000;
  assert.strictEqual(w.keepAwake({ on: true, phones: 1, lastSeen: 0, now }), true);
  assert.strictEqual(w.keepAwake({ on: true, phones: 0, lastSeen: now - 29 * 60e3, now }), true);
  assert.strictEqual(w.keepAwake({ on: true, phones: 0, lastSeen: now - 30 * 60e3, now }), false);
  assert.strictEqual(w.keepAwake({ on: true, phones: 0, lastSeen: 0, now }), false, 'no phone yet');
  assert.strictEqual(w.keepAwake({ on: false, phones: 1, lastSeen: now, now }), false, 'off: never');
});

test('the phone\'s shelf is used only for the music folder it was read from', () => {
  const data = Promise.resolve({ albums: [], byKey: new Map() });
  const cache = { folder: '/Music', data };
  assert.strictEqual(w.shelfCacheFor(cache, '/Music'), data);
  assert.strictEqual(w.shelfCacheFor(cache, '/Other Music'), null, 'another folder picked: read again');
  assert.strictEqual(w.shelfCacheFor(cache, null), null, 'no folder any more');
  assert.strictEqual(w.shelfCacheFor({ folder: null, data }, null), data, 'none then, none now');
  assert.strictEqual(w.shelfCacheFor(null, '/Music'), null, 'nothing read yet (or the library changed)');
});

// ---- The phone's page: the files served, by exact path ------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel));

test('the phone page\'s files: the page, its style and script, boot.js, and the desktop modules it uses — nothing else', () => {
  const asked = [];
  const files = w.pageFiles({ read: (rel) => { asked.push(rel); return Buffer.from(rel); }, dict: () => ({ code: 'en', dict: {} }) });
  assert.deepStrictEqual(Object.keys(files).sort(), ['/', '/boot.js', '/remote.css', '/remote.js',
    ...['disc.js', 'theme.js', 'jog.js', 'disc-wear.js', 'disc-data.js', 'i18n.js', 'i18n-format.js', 'shelf-order.js', 'shelf-dust.js',
      'shelf-discogs.js', 'glyphs.js', 'queue-move.js', 'remote-view.js'].map((n) => `/js/${n}`)].sort());
  assert.strictEqual(files['/'].type, 'text/html; charset=utf-8');
  assert.strictEqual(files['/remote.css'].type, 'text/css; charset=utf-8');
  for (const [p, f] of Object.entries(files)) if (p.endsWith('.js')) assert.strictEqual(f.type, 'text/javascript; charset=utf-8', p);
  assert.strictEqual(files['/'].body.toString(), 'remote/index.html');
  assert.strictEqual(files['/js/disc.js'].body.toString(), 'renderer/js/disc.js');
  assert.ok(asked.every((rel) => /^(remote\/[\w.-]+|renderer\/js\/[\w.-]+)$/.test(rel)), asked.join(' '));
});

test('boot.js hands the page the language in use as it is when the page is loaded', () => {
  let now = { code: 'en', dict: {} };
  const files = w.pageFiles({ read: () => Buffer.alloc(0), dict: () => now });
  const run = () => { const window = {}; new Function('window', files['/boot.js'].body().toString())(window); return window.cdp.i18nDict(); };
  assert.deepStrictEqual(run(), { code: 'en', dict: {} });
  now = { code: 'ru', dict: { _locale: 'ru', SHELF: 'ПОЛКА', 'A "quote" </script> ': 'x' } };
  assert.deepStrictEqual(run(), now);
});

test('every module the phone page imports, and theirs, is one it is served', () => {
  const files = w.pageFiles({ read: readSrc, dict: () => ({ code: 'en', dict: {} }) });
  const seen = new Set();
  const visit = (url) => {
    if (seen.has(url)) return;
    seen.add(url);
    assert.ok(Object.prototype.hasOwnProperty.call(files, url), `imported but not served: ${url}`);
    const text = files[url].body.toString();
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
      visit(new URL(m[1] || m[2], `http://phone${url}`).pathname);
    }
  };
  visit('/remote.js');
  assert.ok(seen.has('/js/disc.js') && seen.has('/js/remote-view.js'));
  const html = files['/'].body.toString();
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) assert.ok(Object.prototype.hasOwnProperty.call(files, m[1]), `the page asks for ${m[1]}`);
  assert.ok(html.indexOf('/boot.js') < html.indexOf('/remote.js'), 'boot.js before the module');
});
