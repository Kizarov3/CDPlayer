'use strict';
/**
 * The rules of the phone remote's network side, all pure: which of the PC's addresses may be offered (a private home
 * LAN one, never a tunnel, VM switch or Tailscale), the checks every request must pass (exact Host and Origin), the
 * pairing token and the cookie derived from it, and the allowlist of commands a phone may send with their value shapes.
 */
const crypto = require('crypto');

const BAD_NAME = /^(utun\d|tun\d|tap\d|wg\d|ppp\d|docker|veth|vmnet|vboxnet|tailscale|zt[0-9a-z]{6,}$|lo\d*$|loopback)|vethernet|virtual|vpn/i;
const GOOD_NAME = /^en0$|wi-?fi|wlan|ethernet|^eth/i;

function privateV4(a) {
  const p = String(a).split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

function pickAddresses(interfaces) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    if (BAD_NAME.test(name)) continue;
    for (const i of list || []) {
      if (i && (i.family === 'IPv4' || i.family === 4) && !i.internal && privateV4(i.address)) out.push({ name, address: i.address });
    }
  }
  const rank = (n) => (GOOD_NAME.test(n) ? 0 : 1);
  return out.map((e, k) => ({ e, k })).sort((a, b) => rank(a.e.name) - rank(b.e.name) || a.k - b.k).map((x) => x.e);
}

const hostAllowed = (host, address, port) => host === `${address}:${port}`;
const originAllowed = (origin, address, port) => origin === `http://${address}:${port}`;

const newToken = () => crypto.randomBytes(16).toString('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const tokenOk = (given, token) => typeof given === 'string' && typeof token === 'string' && same(given, token);

const cookieValue = (token) => crypto.createHmac('sha256', token).update('cdplayer phone remote cookie').digest('base64url');
function cookieOk(header, token) {
  if (typeof header !== 'string' || typeof token !== 'string') return false;
  const want = cookieValue(token);
  return header.split(';').some((part) => {
    const eq = part.indexOf('=');
    return eq > 0 && part.slice(0, eq).trim() === 'cdp' && same(part.slice(eq + 1).trim(), want);
  });
}

const FAIL = Symbol('fail');
const isInt = (v, min, max = Infinity) => Number.isInteger(v) && v >= min && v <= max;
const COMMANDS = {
  toggle: null, prev: null, next: null, mute: null, shuffle: null, repeat: null, clear: null, undo: null, discSkip: null,
  seek: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : FAIL),
  volume: (v) => (isInt(v, 0, 100) ? v : FAIL),
  playIndex: (v) => (isInt(v, 0) ? v : FAIL),
  remove: (v) => (isInt(v, 0) ? v : FAIL),
  playSlot: (v) => (isInt(v, 0, 4) ? v : FAIL),
  move: (v) => (v && typeof v === 'object' && isInt(v.from, 0) && isInt(v.to, 0) ? { from: v.from, to: v.to } : FAIL),
  album: (v) => {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !/^[0-9a-f]{1,40}$/i.test(v.id) || !['play', 'next', 'add'].includes(v.how)) return FAIL;
    if (v.track !== undefined && !isInt(v.track, 0)) return FAIL;
    if (v.slot !== undefined && !isInt(v.slot, 0, 4)) return FAIL;
    const o = { id: v.id, how: v.how };
    if (v.track !== undefined) o.track = v.track;
    if (v.slot !== undefined) o.slot = v.slot;
    return o;
  },
};
const NEEDS_REV = new Set(['playIndex', 'remove', 'move', 'playSlot', 'album']);

function validCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') return null;
  const action = body.action;
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, action)) return null;
  let value;
  if (COMMANDS[action]) {
    value = COMMANDS[action](body.value);
    if (value === FAIL) return null;
  }
  let rev;
  if (NEEDS_REV.has(action)) { if (!Number.isInteger(body.rev)) return null; rev = body.rev; }
  else if (Number.isInteger(body.rev)) rev = body.rev;
  return { action, value, rev };
}

module.exports = { pickAddresses, hostAllowed, originAllowed, newToken, tokenOk, cookieValue, cookieOk, COMMANDS, validCommand };
