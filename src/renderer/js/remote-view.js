// The phone remote's page (src/remote/remote.js), the parts that are worked out rather than drawn: the shelf as the
// phone lists it, where a dragged queue row lands, how the connection stands, what a command's answer means, and the
// player's words. Served to the phone at /js/remote-view.js; the desktop never loads it.
import { t } from './i18n.js';
import { arrange, matchesFilter } from './shelf-order.js';
import { dustLevel } from './shelf-dust.js';

// The desktop's SORTS without PRICE (Discogs isn't on the phone) and COLOR (only spines drawn on the desktop have one).
// MY DIVIDERS stands the phone's list behind the user's own dividers too (filed on the desktop).
// The phone's choice is its own: it never changes the desktop's.
export const PHONE_SORTS = ['ARTIST', 'NEW', 'PLAYED', 'RECENT', 'YEAR', 'MINE'];
export const nextSort = (sort) => PHONE_SORTS[(PHONE_SORTS.indexOf(sort) + 1) % PHONE_SORTS.length];
export const sortLabel = (sort) => ({ ARTIST: t('ARTIST'), NEW: t('NEW|sort'), PLAYED: t('MOST PLAYED'), RECENT: t('LAST PLAYED'), YEAR: t('YEAR'), MINE: t('MY DIVIDERS') })[sort] || sort;

/**
 * The phone's albums ({ id, title, artist, year, n, added, plays, lastPlayed, touched, wrapped, color, filedUnder }) → the rows of its list:
 * { divider } cards as the desktop arranges them under `sort`, and { album, dusty, isNew } — only those the search
 * finds, as the desktop's filter finds them.
 */
export function shelfRows(albums, { query = '', sort = 'ARTIST', now = Date.now() } = {}) {
  const shown = albums.filter((a) => matchesFilter(a, query));
  return arrange(shown, sort).map((x) => (x.divider ? x : { album: x, dusty: dustLevel(x.touched, now) > 0, isNew: !!x.wrapped }));
}

/** A queue row taken by its grip at `from` and moved `dy` px: the row it lands on, a row height at a time. */
export function dropTarget(from, dy, rowHeight, length) {
  return Math.max(0, Math.min(length - 1, from + Math.round(dy / rowHeight)));
}

// ---- The connection -----------------------------------------------------------------------------------------------
// 'connecting' (nothing heard yet), 'live', 'down' (not reachable: trying again), 'quit' / 'off' (the PC said it
// closed, or the remote was turned off), 'unpaired' (the cookie's no good any more: NEW CODE, another address).

/** The connection after `event`: { type: 'state' | 'error' | 'resume' | 'unpaired' } | { type: 'closed', reason }. */
export function connectionAfter(conn, event) {
  switch (event.type) {
    case 'state': return 'live';
    case 'closed': return event.reason === 'off' ? 'off' : 'quit';
    case 'unpaired': return 'unpaired';
    // 'resume': back after a long while hidden (a locked phone) — what's on screen may be minutes old, so it isn't live
    // until a fresh state comes.
    case 'error': case 'resume': return conn === 'quit' || conn === 'off' || conn === 'unpaired' ? conn : 'down';
    default: return conn;
  }
}
/** Nothing is sent but on a live connection — a press while it's down is dropped, never sent later. */
export const canSend = (conn) => conn === 'live';
export function connectionWords(conn) {
  switch (conn) {
    case 'down': return t('PLAYER NOT REACHABLE · TRYING AGAIN');
    case 'quit': return t('CDPLAYER CLOSED');
    case 'off': return t('PHONE REMOTE OFF');
    case 'unpaired': return t('SCAN THE CODE ON THE PC AGAIN');
    default: return '';
  }
}
/** How long until the connection is tried again (ms), or null: not until the page is looked at again. */
export function retryDelay(conn) {
  if (conn === 'unpaired') return null;
  return conn === 'quit' || conn === 'off' ? 10000 : 2500;
}

// ---- Commands -----------------------------------------------------------------------------------------------------

/** A command's answer (HTTP status, JSON body or null) → { kind: 'stale' | 'full' (with slots) | 'error' | 'ok' }. */
export function outcome(status, body) {
  if (status === 409) return { kind: 'stale' };
  if (body && Array.isArray(body.full)) return { kind: 'full', slots: body.full };
  if (status >= 200 && status < 300 && !(body && body.error)) return { kind: 'ok' };
  return { kind: 'error', error: (body && typeof body.error === 'string' && body.error) || (status === 401 ? 'unpaired' : 'failed') };
}
/** A full changer's discs that can go back to the shelf: every one but the one playing. */
export const pickableSlots = (slots) => (Array.isArray(slots) ? slots.filter((s) => s && !s.playing) : []);
export function errorWords(error) {
  switch (error) {
    case 'playing': return t('THAT DISC IS PLAYING NOW · PICK ANOTHER');
    case 'gone': return t('NOT THERE ANY MORE');
    case 'empty': return t('NOTHING TO PLAY');
    case 'busy': case 'player': return t('PLAYER BUSY · TRY AGAIN');
    case 'unpaired': return t('SCAN THE CODE ON THE PC AGAIN');
    default: return t('THAT DIDN’T GO THROUGH');
  }
}

// ---- The player's words -------------------------------------------------------------------------------------------

const MODE_NAMES = () => ({ TRACK: t('TRACK'), DISC: t('DISC'), ALL: t('ALL') });
/** SHUFFLE and REPEAT in words, as the desktop's queue line puts them ('' when both are off). */
export function modeWords({ shuffle, repeat }) {
  const name = MODE_NAMES();
  return [shuffle !== 'OFF' ? t('SHUFFLE: {m}', { m: name[shuffle] || shuffle }) : null, repeat !== 'OFF' ? t('REPEAT: {m}', { m: name[repeat] || repeat }) : null].filter(Boolean).join(' · ');
}
/** The one character on the SHUFFLE and REPEAT buttons, as the desktop's: ◉ for a disc, 1 for one song. */
export const badges = ({ shuffle, repeat }) => ({ shuffle: shuffle === 'DISC' ? '◉' : '', repeat: repeat === 'TRACK' ? '1' : repeat === 'DISC' ? '◉' : '' });

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Where the song is at `now` (ms), from a state heard at `heardAt`: on from there while it plays, up to its end. */
export function livePosition({ playing, position, duration }, heardAt, now) {
  if (!playing || !(duration > 0)) return position;
  return Math.min(duration, position + Math.max(0, now - heardAt) / 1000);
}
/** The PC's tick (where the song is, once a second) → the last state with only that moved on; no state yet: null. */
export const withTick = (state, { playing, position, duration }) => (state
  ? { ...state, playing: !!playing, position: Number(position) || 0, duration: Number(duration) || 0 } : null);
/** The heading over the changer's tracklist: DISC 3 · its title · its artist ('' with no disc playing). */
export function discHeading(changer) {
  const d = changer && changer.playing >= 0 ? changer.slots[changer.playing] : null;
  return d ? [t('DISC {n}', { n: changer.playing + 1 }), d.title, d.artist].filter(Boolean).join(' · ') : '';
}
