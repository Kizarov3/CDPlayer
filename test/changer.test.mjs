// test/changer.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { SLOTS, empty, slotOf, load, eject, removePaths, fromQueue, tracksOf, check } from '../src/renderer/js/changer.js';

const disc = (id, extra = {}) => ({ id, kind: 'album', title: id, artist: 'X', ...extra });
const fill = (n) => { let c = empty(); for (let i = 0; i < n; i++) c = load(c, disc(`d${i}`), [`d${i}/1`, `d${i}/2`]).changer; return c; };

test('a disc goes into the lowest free slot; the queue is the discs in slot order', () => {
  let c = load(empty(), disc('a'), ['a1', 'a2']).changer;
  assert.deepStrictEqual(c.queue, ['a1', 'a2']);
  assert.strictEqual(c.index, 0, 'nothing was playing: stands on its first track');
  const r = load(c, disc('b'), ['b1']);
  assert.strictEqual(r.slot, 1);
  c = eject(r.changer, 0);
  c = load(c, disc('c'), ['c1', 'c2', 'c3']).changer;
  assert.deepStrictEqual(c.slots.map((d) => d && d.id), ['c', 'b', null, null, null]);
  assert.deepStrictEqual(c.queue, ['c1', 'c2', 'c3', 'b1']);
  assert.ok(check(c));
});

test('PLAY stands on the new disc; PLAY NEXT marks it; a disc already in is not loaded twice', () => {
  let c = fill(2);
  c = load(c, disc('p'), ['p1'], { play: true }).changer;
  assert.strictEqual(c.queue[c.index], 'p1');
  c = load(c, disc('n'), ['n1'], { next: true }).changer;
  assert.strictEqual(c.nextDisc, 3);
  const again = load(c, disc('d0'), ['x']);
  assert.deepStrictEqual([again.already, again.slot, again.changer], [true, 0, c]);
});

test('full: a finished disc makes room (the one finished longest ago); none finished → full', () => {
  let c = fill(SLOTS);
  assert.ok(load(c, disc('z'), ['z1']).full);
  c.slots[3] = { ...c.slots[3], done: true, finishedAt: 20 };
  c.slots[1] = { ...c.slots[1], done: true, finishedAt: 10 };
  const r = load(c, disc('z'), ['z1']);
  assert.strictEqual(r.slot, 1);
  assert.strictEqual(r.replaced.id, 'd1');
  assert.ok(check(r.changer));
});

test('the picker\'s slot: any slot but the playing one', () => {
  const c = fill(SLOTS); // standing on d0/1, slot 0
  assert.strictEqual(load(c, disc('z'), ['z1'], { slot: 0 }).slot, -1);
  const r = load(c, disc('z'), ['z1'], { slot: 4 });
  assert.strictEqual(r.changer.slots[4].id, 'z');
  assert.strictEqual(r.changer.queue[r.changer.index], 'd0/1', 'still on the same song');
});

test('ejecting another disc keeps the song; the last disc out leaves nothing', () => {
  let c = fill(3);
  c = { ...c, index: 3 }; // d1/2
  const kept = eject(c, 2);
  assert.strictEqual(kept.queue[kept.index], 'd1/2');
  assert.ok(check(kept));
  const last = eject(load(empty(), disc('a'), ['a1']).changer, 0);
  assert.deepStrictEqual([last.queue, last.index], [[], -1]);
});

test('files gone from the disk leave their discs; an empty disc frees its slot; the song playing stays', () => {
  let c = fill(3);
  c = { ...c, index: 3 }; // d1/2
  c = removePaths(c, new Set(['d1/1', 'd0/1', 'd0/2']));
  assert.deepStrictEqual(c.slots.map((d) => d && d.id), [null, 'd1', 'd2', null, null]);
  assert.strictEqual(c.queue[c.index], 'd1/2');
  assert.ok(check(c));
  const gone = removePaths(c, new Set(['d1/2']));
  assert.strictEqual(gone.index, -1, 'the song playing went: nothing stands');
});

test('an old queue: album runs are discs, neighbouring singles are one CD-R', () => {
  const album = { a1: 'A', a2: 'A', s1: 'S1', s2: 'S2', s3: 'S3', b1: 'B', b2: 'B' };
  const albumOf = (p) => ({ key: album[p], title: `Album ${album[p]}`, artist: 'X' });
  const { changer, dropped } = fromQueue(['a1', 'a2', 's1', 's2', 's3', 'b1', 'b2'], 3, albumOf, { cdrTitle: 'MIX' });
  assert.deepStrictEqual(changer.slots.map((d) => d && [d.kind, d.title]), [['album', 'Album A'], ['cdr', 'MIX'], ['album', 'Album B'], null, null]);
  assert.strictEqual(changer.queue[changer.index], 's2');
  assert.strictEqual(dropped, 0);
  assert.ok(check(changer));
});

test('2.14\'s queue of forty singles from forty albums is one CD-R', () => {
  const paths = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const { changer, dropped } = fromQueue(paths, 7, (p) => ({ key: p, title: p, artist: 'X' }), { cdrTitle: 'MIX' });
  assert.deepStrictEqual([changer.slots.filter(Boolean).length, changer.slots[0].kind, changer.queue.length, dropped], [1, 'cdr', 40, 0]);
  assert.strictEqual(changer.queue[changer.index], 's7');
});

test('more than five discs: the playing one and the four after it', () => {
  const paths = Array.from({ length: 14 }, (_, i) => `${Math.floor(i / 2)}-${i % 2}`); // 7 albums of 2
  const albumOf = (p) => ({ key: p.split('-')[0], title: p.split('-')[0], artist: 'X' });
  const { changer, dropped } = fromQueue(paths, 10, albumOf, { cdrTitle: 'MIX' }); // album 5
  assert.deepStrictEqual(changer.slots.map((d) => d.title), ['5', '6', '0', '1', '2']);
  assert.strictEqual(dropped, 2);
  assert.strictEqual(changer.queue[changer.index], '5-0');
});

test('no queue, no index', () => {
  const { changer } = fromQueue([], -1, () => null, { cdrTitle: 'MIX' });
  assert.deepStrictEqual([changer.queue, changer.index], [[], -1]);
  assert.deepStrictEqual(tracksOf(fill(1), 0), ['d0/1', 'd0/2']);
});

import { nextIndex, previousIndex, discSkip, playSlot, moveTo, markFinished } from '../src/renderer/js/changer.js';

const OFF = { shuffle: 'OFF', repeat: 'OFF' };
const three = () => fill(3); // d0/1 d0/2 | d1/1 d1/2 | d2/1 d2/2, standing on 0
const at = (c, i) => ({ ...c, index: i });
const seq = (...values) => { let k = 0; return () => values[k++ % values.length]; };

test('in order: through the disc, on to the next slot, and after the last slot — the end', () => {
  const c = three();
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((i) => nextIndex(at(c, i), OFF)), [1, 2, 3, 4, 5, -1]);
  assert.strictEqual(nextIndex(at(c, 5), { shuffle: 'OFF', repeat: 'ALL' }), 0);
  assert.strictEqual(nextIndex(at(c, 3), { shuffle: 'OFF', repeat: 'DISC' }), 2);
  assert.strictEqual(nextIndex(at(c, 3), { shuffle: 'OFF', repeat: 'TRACK' }), 3);
});

test('an empty slot between discs is passed over; PLAY NEXT\'s disc comes after the playing one', () => {
  let c = eject(three(), 1); // d0 | — | d2
  assert.strictEqual(c.queue[nextIndex(at(c, 1), OFF)], 'd2/1');
  c = load(three(), disc('n'), ['n1'], { next: true }).changer; // slot 3, next
  assert.strictEqual(c.queue[nextIndex(at(c, 1), OFF)], 'n1');
  c = moveTo(c, c.queue.indexOf('n1'));
  assert.strictEqual(c.nextDisc, null, 'reached: no longer marked');
});

test('SHUFFLE DISC: the disc\'s unplayed songs at random, then the next disc', () => {
  let c = load(empty(), disc('a'), ['a1', 'a2', 'a3']).changer;
  c = load(c, disc('b'), ['b1', 'b2']).changer;
  const modes = { shuffle: 'DISC', repeat: 'OFF' };
  assert.strictEqual(nextIndex(c, modes, seq(0.99)), 2, 'a3: of a2, a3 (not a1, playing)');
  c = markFinished(c, 0, modes); c = moveTo(c, 2);
  c = markFinished(c, 2, modes); c = moveTo(c, 1);
  assert.ok(['b1', 'b2'].includes(c.queue[nextIndex(c, modes, seq(0))]), 'a1 a3 played, on a2: the next disc');
  c = markFinished(c, 1, modes);
  assert.strictEqual(c.slots[0].done, true);
});

test('SHUFFLE ALL: any unplayed song of any disc; once all are played, the end (or again, repeating)', () => {
  let c = load(empty(), disc('a'), ['a1']).changer;
  c = load(c, disc('b'), ['b1']).changer;
  const modes = { shuffle: 'ALL', repeat: 'OFF' };
  assert.strictEqual(nextIndex(c, modes, seq(0)), 1);
  c = markFinished(c, 0, modes); c = moveTo(c, 1); c = markFinished(c, 1, modes);
  assert.strictEqual(nextIndex(c, modes, seq(0)), -1);
  assert.strictEqual(nextIndex(c, { shuffle: 'ALL', repeat: 'ALL' }, seq(0)), 0);
});

test('a disc is finished at its last song in order (or all of them, shuffled), and unfinished when played again', () => {
  let c = three();
  c = markFinished(c, 0, OFF, 5);
  assert.strictEqual(c.slots[0].done, false);
  c = markFinished(c, 1, OFF, 7);
  assert.deepStrictEqual([c.slots[0].done, c.slots[0].finishedAt], [true, 7]);
  c = moveTo(c, 0);
  assert.strictEqual(c.slots[0].done, false);
});

test('previous: the song before, across discs; DISC SKIP and the slot buttons', () => {
  const c = three();
  assert.deepStrictEqual([previousIndex(at(c, 2)), previousIndex(at(c, 0))], [1, -1]);
  assert.strictEqual(discSkip(at(c, 1), OFF), 2);
  assert.strictEqual(discSkip(at(c, 4), OFF), 0, 'wraps round');
  assert.strictEqual(discSkip(at(c, 1), { shuffle: 'DISC', repeat: 'OFF' }, seq(0.99)), 3);
  assert.strictEqual(discSkip(load(empty(), disc('a'), ['a1']).changer, OFF), -1, 'one disc: nowhere to go');
  assert.deepStrictEqual([playSlot(c, 2), playSlot(c, 4)], [4, -1]);
});

test('ejecting the playing disc moves on to the next disc', () => {
  const moved = eject(at(three(), 3), 1); // on d1/2, slot 1 out
  assert.strictEqual(moved.queue[moved.index], 'd2/1');
  assert.ok(check(moved));
});

import { serialize, parse } from '../src/renderer/js/changer.js';

test('the changer round-trips through changer.txt; text that doesn\'t fit the queue is refused', () => {
  let c = load(fill(3), disc('n', { title: 'Tab\there', artist: null }), ['n1'], { next: true }).changer;
  c = markFinished(c, 1, OFF, 99);
  const back = parse(serialize(c), c.queue, c.index);
  assert.deepStrictEqual(back.slots.map((d) => d && [d.id, d.kind, d.title, d.artist, d.start, d.end, d.done, d.finishedAt]),
    c.slots.map((d) => d && [d.id, d.kind, d.title.replace(/\t/g, ' '), d.artist, d.start, d.end, d.done, d.finishedAt]));
  assert.strictEqual(back.nextDisc, 3);
  assert.strictEqual(parse(serialize(c), c.queue.slice(1), 0), null, 'the queue lost a song');
  assert.strictEqual(parse('v1\t-\nalbum\t0\t9\t0\t\tx\tX\t\n-\n-\n-\n-', ['a'], 0), null, 'a run past the queue');
  assert.strictEqual(parse('garbage', ['a'], 0), null);
  assert.strictEqual(parse(null, ['a'], 0), null);
});

import { discFor } from '../src/renderer/js/changer.js';

test('the disc a set of tracks makes: one album is that album; anything else is a CD-R', () => {
  const d = (album, artist) => ({ album, artist, credits: {} });
  assert.deepStrictEqual(discFor({ paths: ['1', '2'], details: [d('Ænima', 'Tool'), d('Ænima', 'Tool')], title: 'MIX · 14 OCT', now: 5 }),
    { id: 'album:tool\nænima', kind: 'album', title: 'Ænima', artist: 'Tool' });
  assert.deepStrictEqual(discFor({ paths: ['1', '2'], details: [d('Ænima', 'Tool'), d('Issues', 'Korn')], title: 'MIX · 14 OCT', now: 5 }),
    { id: 'cdr:5', kind: 'cdr', title: 'MIX · 14 OCT', artist: null });
  assert.strictEqual(discFor({ kind: 'spotify', paths: ['s'], details: [d('X', 'Y')], title: 'MIX', now: 5 }).kind, 'spotify');
});
