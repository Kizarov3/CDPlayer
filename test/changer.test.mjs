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
