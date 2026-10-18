import test from 'node:test';
import assert from 'node:assert';
import { snapshot, commandError, fullSlots, musicKey, isStale } from '../src/renderer/js/remote-state.js';

const paths = ['/Users/me/Music/Air/Moon Safari/01 La Femme d’Argent.flac', '/Users/me/Music/Air/Moon Safari/02 Sexy Boy.flac',
  '/Users/me/Music/Air/Moon Safari/03 All I Need.flac', 'C:\\Music\\Björk\\Debut\\01 Human Behaviour.mp3'];
const names = { [paths[0]]: ['Air · La Femme d’Argent', 430], [paths[1]]: ['Air · Sexy Boy', 298], [paths[2]]: ['Air · All I Need', 268], [paths[3]]: ['Björk · Human Behaviour', 252] };
const details = (p) => ({ title: names[p][0], duration: names[p][1] });
const player = { playing: true, position: 12.5, duration: 298 };
const track = { title: 'Sexy Boy', artist: 'Air', album: 'Moon Safari', coverKey: 'k.3' };
const base = { queue: paths, index: 1, nextUp: { start: 2, end: 4 }, shuffle: 'OFF', repeat: 'ALL', changerMode: false, volume: 70, volumeBeforeMute: -1 };

const changerView = {
  slots: [
    { title: 'Moon Safari', artist: 'Air', done: false, next: false, firstPath: paths[0] },
    null,
    { title: 'Debut', artist: 'Björk', done: true, next: true, firstPath: paths[3] },
    null, null,
  ],
  playingSlot: 0,
  tracks: [
    { index: 0, no: 1, title: 'Air · La Femme d’Argent', time: '7:10', duration: 430, current: false },
    { index: 1, no: 2, title: 'Air · Sexy Boy', time: '4:58', duration: 298, current: true },
    { index: 2, no: 3, title: 'Air · All I Need', time: '4:28', duration: 268, current: false },
  ],
};
const slotCover = (p) => (p === paths[0] ? 'data:image/jpeg;base64,AAAA' : null);

const noPaths = (s) => {
  const text = JSON.stringify(s);
  for (const p of paths) {
    assert.ok(!text.includes(JSON.stringify(p).slice(1, -1)), `a path leaked: ${p}`);
  }
  assert.ok(!/Users|C:\\\\|\.flac|\.mp3/.test(text), `something of a path leaked: ${text}`);
};

test('in queue mode the snapshot has every row, its NEXT tag, and the index playing', () => {
  const s = snapshot({ state: base, player, track, details, statusWord: 'NOW SPINNING', rev: 7, canUndo: false });
  assert.deepStrictEqual(s.queue, [
    { title: 'Air · La Femme d’Argent', duration: 430, next: false },
    { title: 'Air · Sexy Boy', duration: 298, next: false },
    { title: 'Air · All I Need', duration: 268, next: true },
    { title: 'Björk · Human Behaviour', duration: 252, next: true },
  ]);
  assert.strictEqual(s.index, 1);
  assert.strictEqual(s.changer, undefined);
  assert.deepStrictEqual({ rev: s.rev, playing: s.playing, position: s.position, duration: s.duration, volume: s.volume, muted: s.muted,
    shuffle: s.shuffle, repeat: s.repeat, changerMode: s.changerMode, status: s.status, canUndo: s.canUndo },
  { rev: 7, playing: true, position: 12.5, duration: 298, volume: 70, muted: false, shuffle: 'OFF', repeat: 'ALL', changerMode: false, status: 'NOW SPINNING', canUndo: false });
  assert.deepStrictEqual(s.track, track);
  noPaths(s);
});

test('a NEXT tag is only on the rows after the song playing, and none without PLAY NEXT', () => {
  const at3 = snapshot({ state: { ...base, index: 3 }, player, track, details, statusWord: '', rev: 1 });
  assert.deepStrictEqual(at3.queue.map((r) => r.next), [false, false, false, false]);
  const none = snapshot({ state: { ...base, nextUp: null }, player, track, details, statusWord: '', rev: 1 });
  assert.deepStrictEqual(none.queue.map((r) => r.next), [false, false, false, false]);
});

test('muted while the volume waits to come back', () => {
  const s = snapshot({ state: { ...base, volume: 0, volumeBeforeMute: 70 }, player, track, details, statusWord: '', rev: 1 });
  assert.strictEqual(s.muted, true);
  assert.strictEqual(s.volume, 0);
});

test('an empty queue is an empty list, the index -1', () => {
  const s = snapshot({ state: { ...base, queue: [], index: -1, nextUp: null }, player: { playing: false, position: 0, duration: 0 }, track, details, statusWord: 'READY TO PLAY', rev: 1 });
  assert.deepStrictEqual(s.queue, []);
  assert.strictEqual(s.index, -1);
});

test('in changer mode the snapshot has five slots with covers, the playing disc’s tracks, and no queue', () => {
  const s = snapshot({ state: { ...base, changerMode: true, shuffle: 'DISC' }, player, track, details, changerView, slotCover, statusWord: 'DISC 1 IN', rev: 3 });
  assert.strictEqual(s.queue, undefined);
  assert.strictEqual(s.index, undefined);
  assert.strictEqual(s.changerMode, true);
  assert.strictEqual(s.changer.slots.length, 5);
  assert.deepStrictEqual(s.changer.slots, [
    { title: 'Moon Safari', artist: 'Air', cover: 'data:image/jpeg;base64,AAAA', done: false, next: false },
    null,
    { title: 'Debut', artist: 'Björk', cover: null, done: true, next: true },
    null, null,
  ]);
  assert.strictEqual(s.changer.playing, 0);
  assert.deepStrictEqual(s.changer.tracks, [
    { index: 0, title: 'Air · La Femme d’Argent', duration: 430, current: false },
    { index: 1, title: 'Air · Sexy Boy', duration: 298, current: true },
    { index: 2, title: 'Air · All I Need', duration: 268, current: false },
  ]);
  noPaths(s);
});

test('the phone gets the theme’s accent colours (only those: its page stays dark), copied, not the live arrays', () => {
  const colors = { bg: [17, 17, 19], card: [31, 31, 34], accent: [196, 20, 28], accent2: [180, 186, 194], text: [232, 233, 236], muted: [138, 142, 148] };
  const s = snapshot({ state: base, player, track, details, statusWord: '', rev: 1, colors });
  assert.deepStrictEqual(s.colors, { accent: [196, 20, 28], accent2: [180, 186, 194] });
  colors.accent[0] = 0;
  assert.strictEqual(s.colors.accent[0], 196);
  assert.strictEqual(snapshot({ state: base, player, track, details, statusWord: '', rev: 1 }).colors, null);
});

test('a changer with nothing playing has no tracks and plays no slot', () => {
  const s = snapshot({ state: { ...base, changerMode: true }, player, track, details, changerView: { slots: [null, null, null, null, null], playingSlot: -1, tracks: [] }, slotCover, statusWord: '', rev: 1 });
  assert.deepStrictEqual(s.changer, { slots: [null, null, null, null, null], playing: -1, tracks: [] });
});

test('a full changer’s answer: the discs in it to pick from, the one playing marked, no paths', () => {
  const slots = fullSlots(changerView, slotCover);
  assert.deepStrictEqual(slots, [
    { slot: 0, title: 'Moon Safari', artist: 'Air', cover: 'data:image/jpeg;base64,AAAA', playing: true },
    { slot: 2, title: 'Debut', artist: 'Björk', cover: null, playing: false },
  ]);
  noPaths(slots);
});

const at = { queueLength: 4, slots: changerView.slots, changerMode: false, playingSlot: -1 };
const inChanger = { ...at, changerMode: true, playingSlot: 0 };

test('a queue index that has gone is an error, never a wrong song', () => {
  assert.strictEqual(commandError({ action: 'playIndex', value: 4 }, at), 'gone');
  assert.strictEqual(commandError({ action: 'remove', value: 9 }, at), 'gone');
  assert.strictEqual(commandError({ action: 'move', value: { from: 1, to: 4 } }, at), 'gone');
  assert.strictEqual(commandError({ action: 'move', value: { from: 4, to: 0 } }, at), 'gone');
  assert.strictEqual(commandError({ action: 'playIndex', value: 0 }, { ...at, queueLength: 0 }), 'gone');
});

test('an empty slot is an error', () => {
  assert.strictEqual(commandError({ action: 'playSlot', value: 1 }, inChanger), 'gone');
  assert.strictEqual(commandError({ action: 'playSlot', value: 4 }, inChanger), 'gone');
});

test('commands for the other mode are errors: no slots in the queue, no removing or moving in the changer', () => {
  assert.strictEqual(commandError({ action: 'playSlot', value: 0 }, at), 'mode');
  assert.strictEqual(commandError({ action: 'remove', value: 0 }, inChanger), 'mode');
  assert.strictEqual(commandError({ action: 'move', value: { from: 0, to: 1 } }, inChanger), 'mode');
});

test('an album with no songs left is gone; one sent to the slot playing is refused', () => {
  assert.strictEqual(commandError({ action: 'album', value: { how: 'play', album: { id: 'x', paths: [] } } }, at), 'gone');
  assert.strictEqual(commandError({ action: 'album', value: { how: 'play' } }, at), 'gone');
  assert.strictEqual(commandError({ action: 'album', value: { how: 'play', slot: 0, album: { id: 'x', paths: ['a'] } } }, inChanger), 'playing');
});

test('good commands are no error', () => {
  for (const cmd of [
    { action: 'toggle' }, { action: 'next' }, { action: 'seek', value: 30 }, { action: 'volume', value: 0 },
    { action: 'playIndex', value: 3 }, { action: 'remove', value: 0 }, { action: 'move', value: { from: 3, to: 0 } },
    { action: 'album', value: { how: 'add', album: { id: 'x', paths: ['a'] } } },
  ]) assert.strictEqual(commandError(cmd, at), null, cmd.action);
  for (const cmd of [
    { action: 'playSlot', value: 0 }, { action: 'playSlot', value: 2 }, { action: 'playIndex', value: 2 }, { action: 'discSkip' },
    { action: 'album', value: { how: 'play', slot: 2, album: { id: 'x', paths: ['a'] } } },
  ]) assert.strictEqual(commandError(cmd, inChanger), null, cmd.action);
});

test('a command carrying another rev is stale; one carrying none, or this one, is not', () => {
  assert.strictEqual(isStale({ action: 'move', value: { from: 0, to: 1 }, rev: 4 }, 5), true);
  assert.strictEqual(isStale({ action: 'move', value: { from: 0, to: 1 }, rev: 5 }, 5), false);
  assert.strictEqual(isStale({ action: 'toggle' }, 5), false);
  assert.strictEqual(isStale({ action: 'toggle', rev: 2 }, 5), true);
});

test('the music’s key changes with the songs, their order, the mode and the discs — not with the song playing', () => {
  const k = musicKey({ queue: paths, changerMode: false, slots: [] });
  assert.strictEqual(musicKey({ queue: paths.slice(), changerMode: false, slots: [] }), k);
  assert.notStrictEqual(musicKey({ queue: [paths[1], paths[0], paths[2], paths[3]], changerMode: false, slots: [] }), k);
  assert.notStrictEqual(musicKey({ queue: paths.slice(0, 3), changerMode: false, slots: [] }), k);
  assert.notStrictEqual(musicKey({ queue: paths, changerMode: true, slots: [] }), k);
  const disc = { id: 'a', start: 0, end: 3 };
  const c = musicKey({ queue: paths, changerMode: true, slots: [disc, null] });
  assert.notStrictEqual(musicKey({ queue: paths, changerMode: true, slots: [null, disc] }), c);
  assert.notStrictEqual(musicKey({ queue: paths, changerMode: true, slots: [{ ...disc, end: 4 }, null] }), c);
});

// The desktop's status line can name a folder (RIPPED TO … · <folder>, RIP FAILED · <an fs error>): never the phone's.
const withPath = [
  'RIPPED TO MOON SAFARI · /Users/me/Music/Air/Moon Safari',
  'RIP FAILED · EACCES: PERMISSION DENIED, MKDIR \'/Volumes/Music/Air\'',
  'RIPPED TO DEBUT · C:\\Users\\me\\Music\\Björk\\Debut',
  'RIPPED TO DEBUT · D:/Music/Björk/Debut',
  'RIP FAILED · \\\\nas\\music\\Björk is not reachable',
  'RIPPED TO DEBUT · ~/Music/Björk/Debut',
  'COULDN’T OPEN file:///Users/me/Music/a.flac',
];
const looksLikePath = /\/Users|\/Volumes|[A-Z]:[\\/]|\\\\nas|~\/|file:/;

for (const statusWord of withPath) {
  test(`a status naming a path is replaced by the plain word for what the player is doing: ${statusWord}`, () => {
    const s = snapshot({ state: base, player, track, details, statusWord, statusFallback: 'NOW SPINNING', rev: 1 });
    assert.strictEqual(s.status, 'NOW SPINNING');
    assert.ok(!looksLikePath.test(JSON.stringify(s)));
  });
}

test('a fallback naming a path is no better: the status is left empty', () => {
  const s = snapshot({ state: base, player, track, details, statusWord: withPath[0], statusFallback: withPath[2], rev: 1 });
  assert.strictEqual(s.status, '');
});

test('the desktop’s own words go through as they are', () => {
  for (const statusWord of ['NOW SPINNING · SOUND OFF', 'ALREADY IN SLOT 2', 'QUEUE 3 / 12', 'RIPPING 3/12 · 40%', 'DISC 3 IN · AC/DC WENT BACK TO THE SHELF', 'UP NEXT · Air · Sexy Boy']) {
    const s = snapshot({ state: base, player, track, details, statusWord, statusFallback: 'PAUSED', rev: 1 });
    assert.strictEqual(s.status, statusWord);
  }
});
