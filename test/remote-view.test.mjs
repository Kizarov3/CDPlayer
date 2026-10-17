import test from 'node:test';
import assert from 'node:assert';
import {
  PHONE_SORTS, nextSort, shelfRows, dropTarget, connectionAfter, canSend, connectionWords, retryDelay,
  outcome, errorWords, modeWords, badges, formatTime, livePosition, discHeading, pickableSlots,
} from '../src/renderer/js/remote-view.js';

const DAY = 86400000, now = Date.UTC(2026, 9, 17);
const albums = [
  { id: 'a1', title: 'Moon Safari', artist: 'Air', year: '1998', n: 10, added: now - 400 * DAY, plays: 40, touched: now - 2 * DAY, wrapped: false, color: [200, 120, 60] },
  { id: 'a2', title: 'Debut', artist: 'Björk', year: '1993', n: 12, added: now - 3 * DAY, plays: 0, touched: now - 3 * DAY, wrapped: true, color: null },
  { id: 'a3', title: 'Mezzanine', artist: 'Massive Attack', year: '1998', n: 11, added: now - 100 * DAY, plays: 7, touched: now - 200 * DAY, wrapped: false, color: null },
];
const titles = (rows) => rows.map((r) => (r.divider ? `[${r.divider}]` : r.album.title));

test('the phone sorts the shelf four of the desktop’s ways — no PRICE, no COLOR — round and round', () => {
  assert.deepStrictEqual(PHONE_SORTS, ['ARTIST', 'NEW', 'PLAYED', 'YEAR']);
  assert.strictEqual(nextSort('ARTIST'), 'NEW');
  assert.strictEqual(nextSort('YEAR'), 'ARTIST');
  assert.strictEqual(nextSort('COLOR'), 'ARTIST'); // anything else starts over
});

test('the shelf’s rows: as the desktop arranges them, with its divider cards, filtered as its search filters', () => {
  assert.deepStrictEqual(titles(shelfRows(albums, { sort: 'ARTIST', now })), ['[A]', 'Moon Safari', '[B]', 'Debut', '[M]', 'Mezzanine']);
  assert.deepStrictEqual(titles(shelfRows(albums, { sort: 'PLAYED', now })), ['Moon Safari', 'Mezzanine', '[NOT PLAYED YET]', 'Debut']);
  assert.deepStrictEqual(titles(shelfRows(albums, { sort: 'YEAR', now })), ['[1990s]', 'Debut', 'Moon Safari', 'Mezzanine']);
  assert.deepStrictEqual(titles(shelfRows(albums, { sort: 'NEW', now })).filter((x) => !x.startsWith('[')), ['Debut', 'Mezzanine', 'Moon Safari']);
  assert.deepStrictEqual(titles(shelfRows(albums, { query: 'bjork', sort: 'ARTIST', now })), ['[B]', 'Debut']);
  assert.deepStrictEqual(titles(shelfRows(albums, { query: '1998 attack', sort: 'ARTIST', now })), ['[M]', 'Mezzanine']);
  assert.deepStrictEqual(shelfRows(albums, { query: 'nothing like it', now }), []);
});

test('a row says whether its album is dusty (not played or wiped in a month) and new (still in its shrink-wrap)', () => {
  const rows = shelfRows(albums, { sort: 'ARTIST', now }).filter((r) => r.album);
  assert.deepStrictEqual(rows.map((r) => [r.album.id, r.dusty, r.isNew]), [['a1', false, false], ['a2', false, true], ['a3', true, false]]);
});

test('the drag lands where the finger is, a row height at a time, never off the list', () => {
  assert.strictEqual(dropTarget(2, 0, 52, 6), 2);
  assert.strictEqual(dropTarget(2, 20, 52, 6), 2); // not half a row yet
  assert.strictEqual(dropTarget(2, 30, 52, 6), 3);
  assert.strictEqual(dropTarget(2, -110, 52, 6), 0);
  assert.strictEqual(dropTarget(2, -900, 52, 6), 0);
  assert.strictEqual(dropTarget(2, 900, 52, 6), 5);
});

test('the connection: live on a state, down on an error, closed (and so it stays) when the PC says so', () => {
  assert.strictEqual(connectionAfter('connecting', { type: 'state' }), 'live');
  assert.strictEqual(connectionAfter('live', { type: 'error' }), 'down');
  assert.strictEqual(connectionAfter('connecting', { type: 'error' }), 'down');
  assert.strictEqual(connectionAfter('live', { type: 'closed', reason: 'quit' }), 'quit');
  assert.strictEqual(connectionAfter('live', { type: 'closed', reason: 'off' }), 'off');
  assert.strictEqual(connectionAfter('live', { type: 'closed', reason: 'anything' }), 'quit');
  assert.strictEqual(connectionAfter('quit', { type: 'error' }), 'quit'); // the stream ending after it isn't news
  assert.strictEqual(connectionAfter('off', { type: 'error' }), 'off');
  assert.strictEqual(connectionAfter('down', { type: 'unpaired' }), 'unpaired');
  assert.strictEqual(connectionAfter('unpaired', { type: 'error' }), 'unpaired');
  assert.strictEqual(connectionAfter('quit', { type: 'state' }), 'live'); // the app back, the remote on again
});

test('back from a long lock the old state is not live: nothing can be pressed until a fresh one comes', () => {
  assert.strictEqual(connectionAfter('live', { type: 'resume' }), 'down');
  assert.strictEqual(connectionAfter('connecting', { type: 'resume' }), 'down');
  assert.strictEqual(canSend(connectionAfter('live', { type: 'resume' })), false);
  assert.strictEqual(connectionAfter('quit', { type: 'resume' }), 'quit'); // what the PC said still stands
  assert.strictEqual(connectionAfter('off', { type: 'resume' }), 'off');
  assert.strictEqual(connectionAfter('unpaired', { type: 'resume' }), 'unpaired');
  assert.strictEqual(connectionAfter(connectionAfter('live', { type: 'resume' }), { type: 'state' }), 'live');
});

test('only a live connection sends anything; the others say why, and when to try again', () => {
  assert.deepStrictEqual(['connecting', 'live', 'down', 'quit', 'off', 'unpaired'].map(canSend), [false, true, false, false, false, false]);
  assert.strictEqual(connectionWords('live'), '');
  assert.strictEqual(connectionWords('connecting'), '');
  assert.strictEqual(connectionWords('down'), 'PLAYER NOT REACHABLE · TRYING AGAIN');
  assert.strictEqual(connectionWords('quit'), 'CDPLAYER CLOSED');
  assert.strictEqual(connectionWords('off'), 'PHONE REMOTE OFF');
  assert.strictEqual(connectionWords('unpaired'), 'SCAN THE CODE ON THE PC AGAIN');
  assert.ok(retryDelay('down') > 0 && retryDelay('down') < retryDelay('quit'));
  assert.strictEqual(retryDelay('quit'), retryDelay('off'));
  assert.strictEqual(retryDelay('unpaired'), null); // a cookie that's no good won't become good: not until the page is looked at again
});

test('a command’s answer: stale (wait for the next state), full (pick a slot), an error, or done', () => {
  assert.deepStrictEqual(outcome(409, { stale: true }), { kind: 'stale' });
  const slots = [{ slot: 0, title: 'A', playing: false }, { slot: 1, title: 'B', playing: true }, { slot: 3, title: 'D', playing: false }];
  assert.deepStrictEqual(outcome(200, { full: slots }), { kind: 'full', slots });
  assert.deepStrictEqual(outcome(200, { ok: true }), { kind: 'ok' });
  assert.deepStrictEqual(outcome(200, { error: 'gone' }), { kind: 'error', error: 'gone' });
  assert.deepStrictEqual(outcome(503, { error: 'player' }), { kind: 'error', error: 'player' });
  assert.deepStrictEqual(outcome(401, null), { kind: 'error', error: 'unpaired' });
  assert.deepStrictEqual(outcome(500, null), { kind: 'error', error: 'failed' });
  assert.deepStrictEqual(outcome(0, null), { kind: 'error', error: 'failed' }); // never reached
});

test('a full changer’s slots to pick from leave out the disc playing', () => {
  const slots = [{ slot: 0, title: 'A', playing: false }, { slot: 1, title: 'B', playing: true }, { slot: 3, title: 'D', playing: false }];
  assert.deepStrictEqual(pickableSlots(slots).map((s) => s.slot), [0, 3]);
  assert.deepStrictEqual(pickableSlots(null), []);
});

test('errors in words, for the status line', () => {
  assert.strictEqual(errorWords('playing'), 'THAT DISC IS PLAYING NOW · PICK ANOTHER');
  assert.strictEqual(errorWords('gone'), 'NOT THERE ANY MORE');
  assert.strictEqual(errorWords('empty'), 'NOTHING TO PLAY');
  assert.strictEqual(errorWords('busy'), 'PLAYER BUSY · TRY AGAIN');
  assert.strictEqual(errorWords('player'), 'PLAYER BUSY · TRY AGAIN');
  assert.strictEqual(errorWords('unpaired'), 'SCAN THE CODE ON THE PC AGAIN');
  assert.strictEqual(errorWords('mode'), 'THAT DIDN’T GO THROUGH');
  assert.strictEqual(errorWords('whatever'), 'THAT DIDN’T GO THROUGH');
});

test('SHUFFLE and REPEAT: the word under the row and the buttons’ badges, as the desktop shows them', () => {
  assert.strictEqual(modeWords({ shuffle: 'OFF', repeat: 'OFF' }), '');
  assert.strictEqual(modeWords({ shuffle: 'ALL', repeat: 'TRACK' }), 'SHUFFLE: ALL · REPEAT: TRACK');
  assert.strictEqual(modeWords({ shuffle: 'DISC', repeat: 'OFF' }), 'SHUFFLE: DISC');
  assert.deepStrictEqual(badges({ shuffle: 'DISC', repeat: 'TRACK' }), { shuffle: '◉', repeat: '1' });
  assert.deepStrictEqual(badges({ shuffle: 'ALL', repeat: 'DISC' }), { shuffle: '', repeat: '◉' });
  assert.deepStrictEqual(badges({ shuffle: 'OFF', repeat: 'ALL' }), { shuffle: '', repeat: '' });
});

test('times as the player prints them; where the song is now, between the PC’s once-a-second updates', () => {
  assert.strictEqual(formatTime(0), '0:00');
  assert.strictEqual(formatTime(65.9), '1:05');
  assert.strictEqual(formatTime(-3), '0:00');
  assert.strictEqual(formatTime(undefined), '0:00');
  assert.strictEqual(livePosition({ playing: true, position: 10, duration: 200 }, 1000, 3500), 12.5);
  assert.strictEqual(livePosition({ playing: false, position: 10, duration: 200 }, 1000, 3500), 10);
  assert.strictEqual(livePosition({ playing: true, position: 199, duration: 200 }, 0, 5000), 200);
  assert.strictEqual(livePosition({ playing: true, position: 5, duration: 0 }, 0, 5000), 5); // no length known: as it was
});

test('the changer’s playing disc, as its heading reads', () => {
  const changer = { slots: [{ title: 'Moon Safari', artist: 'Air' }, null, { title: 'Debut', artist: null }, null, null], playing: 2, tracks: [] };
  assert.strictEqual(discHeading(changer), 'DISC 3 · Debut');
  assert.strictEqual(discHeading({ ...changer, playing: 0 }), 'DISC 1 · Moon Safari · Air');
  assert.strictEqual(discHeading({ ...changer, playing: -1 }), '');
});
