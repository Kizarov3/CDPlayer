'use strict';
/**
 * How main carries the phone remote between its server (remote.js) and the player's page, all pure: what remote.json
 * may say, the page's states as the phone gets them (the cover kept apart), an album command turned into the shelf
 * album the page plays, the page's answers awaited by id, and when the PC is kept awake for a phone.
 */
const { privateV4 } = require('./remote-net');

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

module.exports = { DEFAULT_PORT, readRemoteConf, dataUrlBytes, nextRemoteState, albumCommand, createReplies, keepAwake };
