'use strict';
/**
 * Discord status: "Listening to CDPlayer" with the song, artist and a progress bar on the user's Discord profile.
 * Talks to the Discord desktop app over its local RPC socket — no sign-in, nothing sent anywhere else. Does nothing
 * while Discord isn't running (it tries again every 20 seconds while there's a song to show). Pausing or stopping
 * clears the status, and so does quitting (Discord drops it when the socket closes).
 */
const net = require('net');
const path = require('path');

// The "CDPlayer" application on discord.com/developers — its name is the "CDPlayer" in "Listening to CDPlayer".
const CLIENT_ID = process.env.CDPLAYER_DISCORD_CLIENT_ID || '1553468501866315836';
const ICON_URL = 'https://raw.githubusercontent.com/Kizarov3/CDPlayer/main/build/icon.png';
const RELEASES_URL = 'https://github.com/Kizarov3/CDPlayer/releases/latest';
const DEBUG = !!process.env.CDPLAYER_DEBUG_DISCORD;
const RETRY_MS = 20000;
const MIN_GAP_MS = 4000; // Discord takes about 5 status updates per 20 seconds
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const LISTENING = 2;
const STATUS_SHOWS = { NAME: 0, STATE: 1, DETAILS: 2 };

function socketPaths() {
  const names = [...Array(10).keys()].map((i) => `discord-ipc-${i}`);
  if (process.platform === 'win32') return names.map((n) => `\\\\?\\pipe\\${n}`);
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  // Linux Flatpak and Snap builds of Discord put the socket in their own subfolder.
  const dirs = [base, path.join(base, 'app/com.discordapp.Discord'), path.join(base, 'snap.discord')];
  return dirs.flatMap((d) => names.map((n) => path.join(d, n)));
}

function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}
/** Splits a buffer into whole frames → { frames: [{ op, data }], rest } (rest = an incomplete frame, kept for later). */
function decode(buffer) {
  const frames = [];
  let at = 0;
  while (buffer.length - at >= 8) {
    const op = buffer.readInt32LE(at), length = buffer.readInt32LE(at + 4);
    if (buffer.length - at - 8 < length) break;
    const body = buffer.subarray(at + 8, at + 8 + length).toString('utf8');
    let data = null;
    try { data = JSON.parse(body); } catch { /* not JSON: ignore the frame */ }
    frames.push({ op, data });
    at += 8 + length;
  }
  return { frames, rest: buffer.subarray(at) };
}

// Discord wants 2–128 characters in each text field.
function text(value, max = 128) {
  let s = String(value || '').trim();
  if (!s) return undefined;
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s.length < 2 ? `${s}⠀` : s;
}
function isWebImage(url) { return typeof url === 'string' && /^https:\/\//.test(url); }

/**
 * { title, artist, album, position, duration (seconds), coverUrl } → the activity Discord shows. Timestamps become
 * the progress bar; an online cover (https) becomes the picture, otherwise the CDPlayer icon.
 */
function activityFor(track, now = Date.now()) {
  const activity = {
    type: LISTENING,
    details: text(track.title) || 'Unknown track',
    state: text(track.artist),
    assets: {
      large_image: isWebImage(track.coverUrl) ? track.coverUrl : ICON_URL,
      large_text: text(track.album) || 'CDPlayer',
    },
    buttons: [{ label: 'Get CDPlayer', url: RELEASES_URL }],
    instance: false,
  };
  if (!activity.state) delete activity.state;
  // The member list reads "Listening to <artist>" (or the title when there's no artist), like Spotify's; the full
  // card still says CDPlayer.
  activity.status_display_type = activity.state ? STATUS_SHOWS.STATE : STATUS_SHOWS.DETAILS;
  if (track.duration > 0) {
    const start = Math.round(now - Math.max(0, track.position || 0) * 1000);
    activity.timestamps = { start, end: Math.round(start + track.duration * 1000) };
  }
  return activity;
}

// ---- Connection -------------------------------------------------------------------------------------------------

let socket = null, ready = false, connecting = false;
let desired = null;   // the activity to show, or null for none
let shown = null;     // JSON of what Discord is showing (null = nothing)
let lastSentAt = 0, sendTimer = null, retryTimer = null, nonce = 0;

function reset() {
  if (socket) socket.destroy();
  socket = null; ready = false; connecting = false; shown = null;
}

function connect() {
  if (!CLIENT_ID || socket || connecting || retryTimer) return;
  connecting = true;
  const paths = socketPaths();
  if (DEBUG) console.log('[discord] connecting');
  const tryPath = (i) => {
    if (i >= paths.length) { // Discord isn't running
      connecting = false;
      retryTimer = setTimeout(() => { retryTimer = null; if (desired) connect(); }, RETRY_MS);
      return;
    }
    const s = net.createConnection(paths[i]);
    let opened = false, pending = Buffer.alloc(0);
    s.once('connect', () => {
      opened = true; socket = s;
      s.write(encode(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID }));
    });
    s.on('data', (chunk) => {
      const { frames, rest } = decode(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const f of frames) {
        if (DEBUG) console.log('[discord] <-', f.op, JSON.stringify(f.data));
        if (f.data && f.data.evt === 'ERROR') console.warn('[discord] Discord refused the status:', f.data.data && f.data.data.message);
        if (f.op === OP.PING) s.write(encode(OP.PONG, f.data));
        else if (f.op === OP.CLOSE) s.destroy(); // e.g. an unknown client id
        else if (f.op === OP.FRAME && f.data && f.data.evt === 'READY') { ready = true; connecting = false; pump(); }
      }
    });
    s.on('error', () => { if (!opened) { s.destroy(); tryPath(i + 1); } });
    s.on('close', () => {
      if (!opened) return;
      if (socket === s) reset();
      if (desired) retryTimer = retryTimer || setTimeout(() => { retryTimer = null; if (desired) connect(); }, RETRY_MS);
    });
  };
  tryPath(0);
}

// Sends the wanted status when it differs from what Discord shows, no faster than Discord allows.
function pump() {
  if (sendTimer) return;
  const want = desired ? JSON.stringify(desired) : null;
  if (!ready) { if (desired) connect(); return; }
  if (want === shown) return;
  const wait = lastSentAt + MIN_GAP_MS - Date.now();
  if (wait > 0) { sendTimer = setTimeout(() => { sendTimer = null; pump(); }, wait); return; }
  lastSentAt = Date.now();
  const args = desired ? { pid: process.pid, activity: desired } : { pid: process.pid };
  socket.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args, nonce: String(++nonce) }));
  shown = want;
}

/** The track playing (see activityFor), or null to clear the status — paused, stopped, or turned off in Settings. */
function setTrack(track) {
  desired = track ? activityFor(track) : null;
  pump();
}

module.exports = { setTrack, activityFor, encode, decode, ICON_URL };
