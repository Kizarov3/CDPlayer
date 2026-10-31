import test from 'node:test';
import assert from 'node:assert';
import { caseKind, discRuns, withDiscHeads, discChange, discOfDetails } from '../src/renderer/js/box-set.js';
import { empty, load, loadSet, check, tracksOf } from '../src/renderer/js/changer.js';

test('one disc: a jewel case; two: a double case; three or more: a box', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 7].map(caseKind), ['', '', 'double', 'box', 'box']);
});

test('an album\'s tracks disc by disc; a track that doesn\'t say is on disc 1', () => {
  const runs = discRuns([{ path: 'a', disc: 1 }, { path: 'b', disc: null }, { path: 'c', disc: 2 }, { path: 'd', disc: 3 }]);
  assert.deepStrictEqual(runs.map((r) => [r.no, r.tracks.map((x) => x.path)]), [[1, ['a', 'b']], [2, ['c']], [3, ['d']]]);
});

test('a DISC heading before each disc of a set; one disc\'s list stays as it was', () => {
  const one = [{ disc: 1 }, { disc: 1 }];
  assert.deepStrictEqual(withDiscHeads(one), one);
  const set = [{ n: 1, disc: 1 }, { n: 2, disc: 2 }, { n: 3, disc: 2 }];
  assert.deepStrictEqual(withDiscHeads(set), [{ disc: 1 }, set[0], { disc: 2 }, set[1], set[2]]);
  // only discs 2 and 3 of a set: their own numbers
  assert.deepStrictEqual(withDiscHeads([{ disc: 2 }, { disc: 3 }]).filter((r) => !('x' in r)).length, 4);
  // a row that doesn't say (a song you don't have) is on the disc of the one before it; leading ones on the first that says
  const rows = [{ k: 'm' }, { k: 'a', d: 1 }, { k: 'gap' }, { k: 'b', d: 2 }];
  assert.deepStrictEqual(withDiscHeads(rows, (r) => r.d || null).map((r) => r.k || `DISC ${r.disc}`), ['DISC 1', 'm', 'a', 'gap', 'DISC 2', 'b']);
});

test('the deck changes discs only between two discs of one album', () => {
  const d = (album, artist, no) => discOfDetails({ album, artist, credits: no ? { disc: { no, of: 2 } } : {} });
  assert.strictEqual(discChange(d('Mellon Collie', 'Smashing Pumpkins', 1), d('MELLON COLLIE', 'Smashing Pumpkins', 2)), 2);
  assert.strictEqual(discChange(d('Mellon Collie', 'SP', 1), d('Mellon Collie', 'SP', 1)), 0, 'the same disc');
  assert.strictEqual(discChange(d('A', 'SP', 1), d('B', 'SP', 2)), 0, 'another album');
  assert.strictEqual(discChange(d('A', 'SP', null), d('A', 'SP', 2)), 0, 'no disc tag');
  assert.strictEqual(discChange(null, d('A', 'SP', 2)), 0);
  assert.deepStrictEqual(discOfDetails({ album: 'A', artist: 'x', credits: { albumArtist: 'Y', disc: { no: 3 } } }), { album: 'A', artist: 'Y', disc: 3 });
});

const part = (id, n, tracks) => ({ disc: { id: `${id}#${n}`, kind: 'album', title: `${id} · CD ${n}`, artist: 'X' }, tracks });
const other = (id) => ({ id, kind: 'album', title: id, artist: 'Y' });

test('a set\'s discs go into free slots side by side, the first played or put next', () => {
  let c = load(empty(), other('a'), ['a1']).changer;
  const r = loadSet(c, [part('s', 1, ['s1', 's2']), part('s', 2, ['s3'])], { next: true });
  assert.deepStrictEqual(r.slots, [1, 2]);
  assert.ok(check(r.changer));
  assert.deepStrictEqual([tracksOf(r.changer, 1), tracksOf(r.changer, 2)], [['s1', 's2'], ['s3']]);
  assert.strictEqual(r.changer.nextDisc, 1);
  assert.strictEqual(r.changer.queue[r.changer.index], 'a1', 'what was playing still is');
  const played = loadSet(c, [part('s', 1, ['s1']), part('s', 2, ['s3'])], { play: true });
  assert.strictEqual(played.changer.queue[played.changer.index], 's1');
  // in already: not twice
  const again = loadSet(r.changer, [part('s', 1, ['s1', 's2']), part('s', 2, ['s3'])]);
  assert.deepStrictEqual([again.already, again.slot], [true, 1]);
});

test('no room side by side for a set: null (it goes in as one disc)', () => {
  let c = empty();
  for (const id of ['a', 'b', 'c']) c = load(c, other(id), [`${id}1`]).changer;
  c = load(c, other('e'), ['e1'], { slot: 4 }).changer; // slots 0,1,2,4 full: one free
  assert.strictEqual(loadSet(c, [part('s', 1, ['s1']), part('s', 2, ['s2'])]), null);
  assert.strictEqual(loadSet(empty(), [part('s', 1, ['s1'])]), null, 'one disc is no set');
});
