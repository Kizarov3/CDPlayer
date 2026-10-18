'use strict';
/**
 * How main carries the phone remote between its server (remote.js) and the player's page, all pure: what remote.json
 * may say, the page's states as the phone gets them (the cover kept apart; a whole state or a tick), the page for a
 * browser that isn't paired, an album command turned into the shelf album the page plays, the page's answers awaited
 * by id, and when the PC is kept awake for a phone.
 */
const { privateV4 } = require('./remote-net');
const { t, current } = require('./i18n');

const DEFAULT_PORT = 47800;
const AWAKE_MS = 30 * 60e3; // a locked phone drops its connection: the PC stays up this long after the last one went
const TOKEN = /^[A-Za-z0-9_-]{22}$/; // 16 bytes, base64url (remote-net.js newToken)

// remote.json → { on, token, port, address }. Anything odd in it falls back to off / none / the default port; never
// port 8080 (Spotify's sign-in callback) and never a port below 1024.
function readRemoteConf(text) {
  let c = null;
  try { c = JSON.parse(text); } catch { /* none yet, or unreadable */ }
  if (!c || typeof c !== 'object') c = {};
  const ok = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535 && p !== 8080;
  return {
    on: c.on === true,
    token: typeof c.token === 'string' && TOKEN.test(c.token) ? c.token : null,
    port: ok(c.port) ? c.port : DEFAULT_PORT,
    address: typeof c.address === 'string' && privateV4(c.address) ? c.address : null,
  };
}

/** A base64 data URL → its bytes, or null for anything else (an empty one too). */
function dataUrlBytes(url) {
  const m = typeof url === 'string' ? /^data:[^,;]*(?:;[^,;]*)*;base64,(.+)$/s.exec(url) : null;
  if (!m) return null;
  const bytes = Buffer.from(m[1], 'base64');
  return bytes.length ? bytes : null;
}

/**
 * The page's message → what main keeps: `kept` is { state, cover } (the last full state, without its cover; the cover
 * playing now as { key, bytes }). A full state (it has `rev`) replaces the state; its `cover`, sent only when the
 * cover changed, is taken off and kept apart under the state's track.coverKey (for /cover/now). A small one —
 * { playing, position, duration } — goes into the last full state. → { state, cover, full }.
 */
function nextRemoteState(kept, msg) {
  if (!msg || typeof msg !== 'object') return { state: kept.state, cover: kept.cover, full: false };
  if (Number.isInteger(msg.rev)) {
    const { cover, ...state } = msg;
    let now = kept.cover;
    if ('cover' in msg && cover !== undefined) {
      const bytes = dataUrlBytes(cover), key = state.track && state.track.coverKey;
      now = bytes && key ? { key, bytes } : null;
    }
    return { state, cover: now, full: true };
  }
  if (!kept.state) return { state: null, cover: kept.cover, full: false };
  const { playing, position, duration } = msg;
  return { state: { ...kept.state, playing: !!playing, position: Number(position) || 0, duration: Number(duration) || 0 }, cover: kept.cover, full: false };
}

/**
 * What goes to the phones for one of the page's messages (`next`: nextRemoteState's answer; `sent`: what the last whole
 * state sent was, but for where the song is). A full state that changed in anything else → event 'state' with it
 * whole (the queue, the changer's covers…); otherwise → a 'tick' with only { playing, position, duration }, so where
 * the song is costs a phone a few bytes a second. Nothing kept yet → nothing. → { event, data, sent }.
 */
function phoneEvent(next, sent) {
  if (!next || !next.state) return { event: null, data: null, sent };
  const { playing, position, duration, ...rest } = next.state;
  if (next.full) {
    const key = JSON.stringify(rest);
    if (key !== sent) return { event: 'state', data: next.state, sent: key };
  }
  return { event: 'tick', data: { playing, position, duration }, sent };
}

/**
 * The page a browser gets when it opens the remote without being paired (the address typed in, a reload after NEW
 * CODE, a camera app that kept its cookie elsewhere): dark, in the interface's language, saying where the code is.
 * No script and no style — the page's CSP (default-src 'self') refuses inline ones, and nothing else is served unpaired.
 */
function unpairedPage() {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const { code } = current();
  const font = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  return `<!doctype html>
<html lang="${esc(code)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<title>CDPlayer</title>
</head>
<body bgcolor="#000000" text="#e8e9ec">
<table width="100%" cellpadding="24"><tr><td align="center">
<font face="${font}" size="5"><b>${esc(t('THIS PHONE ISN’T PAIRED'))}</b></font>
<p><font face="${font}" size="4" color="#a9adb6">${esc(t('Open CDPlayer on the computer, go to Settings → PHONE REMOTE and scan the code with this phone’s camera.'))}</font></p>
</td></tr></table>
</body>
</html>
`;
}

/**
 * The phone's album command (its key already looked up: `album` is the shelf album, or nothing when the key names none)
 * → the command for the page, with the album as the shelf has it, paths and all; or null when there's no album.
 */
function albumCommand(cmd, album) {
  if (!album) return null;
  const { how, track, slot } = cmd.value;
  const value = { how };
  if (track !== undefined) value.track = track;
  if (slot !== undefined) value.slot = slot;
  value.album = { id: album.id, title: album.title, artist: album.artist, year: album.year, paths: album.tracks.map((t) => t.path) };
  return { action: 'album', value, rev: cmd.rev };
}

/**
 * Commands sent to the page, each answered by its id: `ask(cmd)` → a promise of the page's answer, or of { error:
 * 'busy' } when `send` can't reach the page or no answer comes within `timeoutMs`. `reply(id, result)` settles one;
 * `failAll(result)` settles every one still waiting (the page went).
 */
function createReplies({ send, timeoutMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let nextId = 1;
  const waiting = new Map(); // id → { resolve, timer }
  const settle = (id, result) => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    clearTimer(w.timer);
    w.resolve(result);
  };
  return {
    ask(cmd) {
      const id = nextId++;
      return new Promise((resolve) => {
        waiting.set(id, { resolve, timer: setTimer(() => settle(id, { error: 'busy' }), timeoutMs) });
        if (!send(id, cmd)) settle(id, { error: 'busy' });
      });
    },
    reply(id, result) { settle(id, result && typeof result === 'object' ? result : { ok: true }); },
    failAll(result) { for (const id of [...waiting.keys()]) settle(id, result); },
  };
}

/** Whether the PC is kept from sleeping: the remote on, and a phone connected now or within the last 30 minutes. */
const keepAwake = ({ on, phones, lastSeen, now }) => !!on && (phones > 0 || (lastSeen > 0 && now - lastSeen < AWAKE_MS));

/**
 * The shelf as read for the phone (`cache`: { folder, data }) → its data while the music folder is still the one it
 * was read from, else null (read it again). Keyed by the folder itself, so no change of folder can be missed.
 */
const shelfCacheFor = (cache, folder) => (cache && cache.folder === folder ? cache.data : null);

// The phone's page (src/remote/) and the player's own modules it imports (src/renderer/js/, served under /js/).
const PAGE_MODULES = ['disc.js', 'theme.js', 'jog.js', 'disc-wear.js', 'disc-data.js', 'i18n.js', 'i18n-format.js', 'shelf-order.js',
  'shelf-dust.js', 'shelf-discogs.js', 'glyphs.js', 'queue-move.js', 'remote-view.js'];
const JS = 'text/javascript; charset=utf-8';
/**
 * The files the phone remote serves, by exact path — remote.js serves nothing else. `read(rel)` → the bytes of a
 * file under src/ (only the names listed here are ever asked for); `dict()` → the language in use ({ code, dict }),
 * which /boot.js hands the page as the preload hands the desktop's (window.cdp.i18nDict), read on each load.
 */
function pageFiles({ read, dict }) {
  const files = {
    '/': { body: read('remote/index.html'), type: 'text/html; charset=utf-8' },
    '/remote.css': { body: read('remote/remote.css'), type: 'text/css; charset=utf-8' },
    '/remote.js': { body: read('remote/remote.js'), type: JS },
    '/boot.js': { body: () => Buffer.from(`window.cdp = { i18nDict: () => (${JSON.stringify(dict())}) };\n`), type: JS },
  };
  for (const name of PAGE_MODULES) files[`/js/${name}`] = { body: read(`renderer/js/${name}`), type: JS };
  return files;
}

module.exports = { DEFAULT_PORT, shelfCacheFor, pageFiles, readRemoteConf, dataUrlBytes, nextRemoteState, phoneEvent, unpairedPage, albumCommand, createReplies, keepAwake };
