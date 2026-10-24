// test/edge-changer.test.mjs — edge cases of the changer's SKIP-aware order and FILL
import test from 'node:test';
import assert from 'node:assert';
import { empty, load, check, nextIndex, previousIndex, discSkip, moveTo, markFinished, fillWith, eject } from '../src/renderer/js/changer.js';

const disc = (id, extra = {}) => ({ id, kind: 'album', title: id, artist: 'X', ...extra });
// Discs [[id, songs]] loaded in slot order; songs are `${id}1`, `${id}2`…
const make = (spec) => {
  let c = empty();
  for (const [id, n, extra] of spec) c = load(c, disc(id, extra), Array.from({ length: n }, (_, k) => `${id}${k + 1}`)).changer;
  return c;
};
const skipOf = (c, paths) => { const off = new Set(paths); return (i) => off.has(c.queue[i]); };
const at = (c, index) => ({ ...c, index });
const withSlot = (c, slot, change) => ({ ...c, slots: c.slots.map((d, s) => (s === slot ? { ...d, ...change } : d)) });
// Every answer a random pick can give, by sweeping rnd over [0, 1).
const sweep = (f) => { const out = new Set(); for (let r = 0; r < 1; r += 0.01) out.add(f(() => r)); return out; };
const subset = (set, allowed, msg) => { for (const x of set) assert.ok(allowed.includes(x), `${msg}: ${x} not in ${allowed}`); };

const MODES = [];
for (const shuffle of ['OFF', 'DISC', 'ALL']) for (const repeat of ['OFF', 'DISC', 'ALL']) MODES.push({ shuffle, repeat });

test('SKIP: every song marked not to play — nothing comes next in any mode, nothing before, no disc to skip to', () => {
  const c = make([['a', 2], ['b', 3]]), skip = () => true;
  for (const m of MODES) {
    for (let i = 0; i < c.queue.length; i++) {
      assert.strictEqual(nextIndex(at(c, i), { ...m, skip }, () => 0.5), -1, `${m.shuffle}/${m.repeat} from ${i}`);
    }
  }
  assert.strictEqual(previousIndex(at(c, 4), skip), -1);
  assert.strictEqual(discSkip(c, { skip }), -1);
  assert.strictEqual(discSkip(c, { shuffle: 'ALL', skip }, () => 0.5), -1);
});

test('SKIP: a one-song disc passed over — going on, going back and DISC SKIP all go past it', () => {
  const c = make([['a', 2], ['s', 1], ['b', 2]]), skip = skipOf(c, ['s1']); // s1 is index 2
  assert.strictEqual(nextIndex(at(c, 1), { skip }), 3, 'a2 → b1');
  assert.strictEqual(previousIndex(at(c, 3), skip), 1, 'b1 ← a2');
  assert.strictEqual(discSkip(c, { skip }), 3, 'a → b, s passed over');
  subset(sweep((rnd) => nextIndex(withSlot(at(c, 1), 0, { played: [0] }), { shuffle: 'DISC', skip }, rnd)), [3, 4], 'SHUFFLE DISC on to the next disc with one to play');
  // s1 picked by hand under REPEAT DISC: its disc has nothing to play again — on to the next
  assert.strictEqual(nextIndex(at(c, 2), { repeat: 'DISC', skip }), 3);
  assert.strictEqual(nextIndex(at(c, 2), { shuffle: 'DISC', repeat: 'DISC', skip }, () => 0), 3);
  assert.strictEqual(nextIndex(at(c, 2), { skip }), 3, 'picked by hand: on to b1 at its end');
});

test('a one-song disc alone: REPEAT plays it again — unless it is one passed over', () => {
  const c = make([['x', 1]]), skip = () => true;
  assert.strictEqual(nextIndex(c, {}), -1);
  assert.strictEqual(nextIndex(c, { repeat: 'ALL' }), 0);
  assert.strictEqual(nextIndex(c, { repeat: 'DISC' }), 0);
  assert.strictEqual(nextIndex(c, { shuffle: 'ALL', repeat: 'ALL' }, () => 0.3), 0);
  assert.strictEqual(nextIndex(c, { shuffle: 'DISC', repeat: 'DISC' }, () => 0.3), 0);
  assert.strictEqual(nextIndex(c, { repeat: 'ALL', skip }), -1);
  assert.strictEqual(nextIndex(c, { shuffle: 'ALL', repeat: 'ALL', skip }, () => 0.3), -1);
});

test('SKIP: the song playing is itself one passed over (picked by hand)', () => {
  const c = at(make([['a', 4]]), 1), skip = skipOf(c, ['a2', 'a4']);
  assert.strictEqual(nextIndex(c, { skip }), 2);
  assert.strictEqual(previousIndex(c, skip), 0);
  subset(sweep((rnd) => nextIndex(c, { shuffle: 'ALL', skip }, rnd)), [0, 2], 'SHUFFLE ALL: only ones to play');
  const played = withSlot(c, 0, { played: [0, 2] });
  const again = sweep((rnd) => nextIndex(played, { shuffle: 'DISC', repeat: 'DISC', skip }, rnd));
  subset(again, [0, 2], 'REPEAT DISC, all played: round again, never a passed-over one');
  assert.ok(again.size > 0);
  assert.strictEqual(nextIndex(played, { shuffle: 'DISC', skip }, () => 0), -1, 'shuffled round over, REPEAT OFF: the end');
  // played to its end: a disc with ones to play after it isn't finished
  assert.strictEqual(markFinished(c, 1, { skip }).slots[0].done, false);
  const m = moveTo(c, 3, skip);
  assert.strictEqual(m.index, 3, 'a song passed over can still be stood on');
  assert.ok(check(m));
});

test('SKIP with shuffle and repeat across discs: never lands on one passed over', () => {
  const c = make([['a', 3], ['b', 2], ['c', 2]]), skip = skipOf(c, ['a1', 'b2', 'c1']); // to play: 1 2 3 6
  assert.strictEqual(nextIndex(at(c, 2), { skip }), 3);
  assert.strictEqual(nextIndex(at(c, 3), { skip }), 6, 'b2 and c1 passed over');
  assert.strictEqual(nextIndex(at(c, 6), { skip }), -1);
  assert.strictEqual(nextIndex(at(c, 6), { repeat: 'ALL', skip }), 1, 'round to a2, a1 passed over');
  assert.strictEqual(nextIndex(at(c, 2), { repeat: 'DISC', skip }), 1);
  const aPlayed = withSlot(at(c, 2), 0, { played: [1, 2] });
  assert.strictEqual(nextIndex(aPlayed, { shuffle: 'DISC', skip }, () => 0.9), 3, 'on to b, its one to play');
  assert.strictEqual(nextIndex(aPlayed, { shuffle: 'DISC', repeat: 'DISC', skip }, () => 0.9), 1);
  let all = withSlot(withSlot(withSlot(at(c, 6), 0, { played: [1, 2] }), 1, { played: [0] }), 2, { played: [1] });
  assert.strictEqual(nextIndex(all, { shuffle: 'ALL', skip }, () => 0.5), -1, 'SHUFFLE ALL round over');
  subset(sweep((rnd) => nextIndex(all, { shuffle: 'ALL', repeat: 'ALL', skip }, rnd)), [1, 2, 3], 'a new round, never 0 4 5');
  assert.deepStrictEqual([...sweep((rnd) => discSkip(c, { shuffle: 'DISC', skip }, rnd))], [3]);
  assert.deepStrictEqual([...sweep((rnd) => discSkip(at(c, 3), { shuffle: 'ALL', skip }, rnd))], [6]);
  assert.strictEqual(discSkip(at(c, 6), { skip }), 1, 'round to a, its first one to play');
});

test('DISC SKIP past a PLAY NEXT disc that is all passed over still finds the other discs', () => {
  let c = make([['a', 2], ['b', 2], ['c', 2]]);
  c = load(c, disc('n'), ['n1', 'n2'], { next: true }).changer; // slot 3, marked to play next
  const skip = skipOf(c, ['n1', 'n2']);
  assert.strictEqual(c.nextDisc, 3);
  // "-1: no other disc" — but b and c are other discs with songs to play
  assert.strictEqual(discSkip(c, { skip }), 2, 'b1');
  const out = eject(c, 0, { skip });
  assert.strictEqual(out.queue[out.index], 'b1', 'the playing disc taken out moves on as DISC SKIP would');
});

test('markFinished with SKIP: the last one to play finishes the disc; all passed over is finished by any', () => {
  const c = make([['a', 3], ['z', 2]]), skip = skipOf(c, ['a1', 'z1', 'z2']);
  assert.strictEqual(markFinished(c, 0, { skip }).slots[0].done, false, 'a1 played by hand: a2 a3 still to play');
  const done = markFinished(c, 2, { skip }, 42);
  assert.deepStrictEqual([done.slots[0].done, done.slots[0].finishedAt], [true, 42]);
  const z = markFinished(c, 3, { skip }, 9);
  assert.strictEqual(z.slots[1].done, true, 'nothing on it to play');
  assert.deepStrictEqual(markFinished(c, 3, { shuffle: 'DISC', skip }).slots[1].played, [], 'SHUFFLE DISC: next round afresh');
  assert.deepStrictEqual(markFinished(c, 3, { shuffle: 'ALL', skip }).slots[1].played, [0], 'SHUFFLE ALL: kept count');
  const twice = markFinished(markFinished(c, 1, { shuffle: 'ALL', skip }), 1, { shuffle: 'ALL', skip });
  assert.deepStrictEqual(twice.slots[0].played, [1], 'noted once');
  assert.strictEqual(markFinished(c, -1), c);
  assert.strictEqual(markFinished(c, 99), c);
  assert.ok(check(done) && check(z) && check(twice));
});

test('moveTo with SKIP: the round starts afresh when every song to play has played; PLAY NEXT reached is unmarked', () => {
  let c = make([['a', 2], ['b', 2]]);
  c = withSlot(withSlot(c, 0, { played: [0, 1] }), 1, { played: [0] });
  const skip = skipOf(c, ['b2']);
  const fresh = moveTo(c, 0, skip);
  const playedOf = (x) => x.slots.filter(Boolean).map((d) => d.played);
  assert.deepStrictEqual(playedOf(fresh), [[], []], 'b2 passed over: the round was over');
  assert.deepStrictEqual(playedOf(moveTo(c, 0)), [[0, 1], [0]], 'b2 still to play: no new round');
  let n = load(make([['a', 2], ['b', 2]]), disc('n'), ['n1'], { next: true }).changer;
  n = withSlot(n, 2, { done: true, finishedAt: 5 });
  const reached = moveTo(n, 4);
  assert.deepStrictEqual([reached.nextDisc, reached.slots[2].done, reached.slots[2].finishedAt], [null, false, null]);
  assert.strictEqual(moveTo(n, 1).nextDisc, 2, 'another disc: still marked');
  assert.strictEqual(moveTo(n, 99).index, -1);
  assert.strictEqual(moveTo(n, -1).index, -1);
  for (const x of [fresh, reached, moveTo(n, 99)]) assert.ok(check(x));
});

test('FILL: a disc picked twice, or already in by its songs, or with no songs, goes in once or not at all', () => {
  const picks = [
    { disc: disc('a'), tracks: ['a1', 'a2'] },
    { disc: disc('a'), tracks: ['a1', 'a2'] },
    { disc: disc('other-id'), tracks: ['a1', 'a2'] }, // the same songs
    { disc: disc('nothing'), tracks: [] },
    { disc: disc('b'), tracks: ['b1'] },
  ];
  const r = fillWith(empty(), picks);
  assert.deepStrictEqual(r.changer.slots.map((d) => d && d.id), ['a', 'b', null, null, null]);
  assert.deepStrictEqual([r.loaded, r.replaced, r.full], [[0, 1], [], false]);
  assert.strictEqual(r.changer.queue[r.changer.index], 'a1');
  assert.ok(check(r.changer));
  const none = fillWith(r.changer, []);
  assert.deepStrictEqual([none.changer, none.loaded, none.full], [r.changer, [], false]);
});

test('FILL: never the playing disc nor a CD-R, even finished; finished albums go back longest-finished first', () => {
  let c = make([['p', 2], ['r', 1, { kind: 'cdr' }], ['f30', 1], ['f20', 1], ['n', 1]]);
  c = withSlot(c, 0, { done: true, finishedAt: 1 }); // playing, and finished: stays
  c = withSlot(c, 1, { done: true, finishedAt: 2 }); // a finished CD-R: stays
  c = withSlot(c, 2, { done: true, finishedAt: 30 });
  c = withSlot(c, 3, { done: true, finishedAt: 20 });
  c = { ...c, nextDisc: 3 };
  const r = fillWith(c, ['x', 'y', 'z'].map((id) => ({ disc: disc(id), tracks: [`${id}1`] })));
  assert.deepStrictEqual(r.changer.slots.map((d) => d.id), ['p', 'r', 'y', 'x', 'n']);
  assert.deepStrictEqual(r.loaded, [3, 2]);
  assert.deepStrictEqual(r.replaced.map((d) => d.id), ['f20', 'f30']);
  assert.strictEqual(r.full, false);
  assert.strictEqual(r.changer.queue[r.changer.index], 'p1', 'still where it was');
  assert.strictEqual(r.changer.nextDisc, null, 'PLAY NEXT\'s disc went back to the shelf: no longer marked');
  assert.ok(check(r.changer));
  const onlyPlaying = withSlot(withSlot(c, 2, { done: false }), 3, { done: false });
  const full = fillWith(onlyPlaying, [{ disc: disc('x'), tracks: ['x1'] }]);
  assert.deepStrictEqual([full.changer, full.loaded, full.full], [onlyPlaying, [], true]);
});

test('REPEAT ALL with only one disc in: round to its own first song', () => {
  const c = make([['a', 3]]);
  assert.strictEqual(nextIndex(at(c, 2), { repeat: 'ALL' }), 0);
  assert.strictEqual(nextIndex(at(c, 2), { repeat: 'ALL', skip: skipOf(c, ['a1']) }), 1, 'a1 passed over');
  assert.strictEqual(nextIndex(at(c, 2), {}), -1, 'REPEAT OFF: the end');
});
