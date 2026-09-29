import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { sameName, artistsWanting, missingFor, withMissing, boxLabel, typeLabel, isSlim } from '../src/renderer/js/shelf-missing.js';

const require = createRequire(import.meta.url);
const main = require('../src/main/same-name');

const album = (artist, title, extra = {}) => ({ id: `${artist}/${title}`, artist, title, year: null, artistMbid: null, ...extra });
const g = (id, title, extra = {}) => ({ id, title, type: 'Album', secondary: [], year: '2000', ...extra });

test('names are compared as the shelf does in main', () => {
  for (const s of ['OK Computer', 'ok computer!', "Three Dollar Bill, Y'all$", 'Björk', '!!!', '  ', 'Сплин', 'シングル']) {
    assert.strictEqual(sameName(s), main.sameName(s), s);
  }
});

test('a box for an album artist with two albums or more, not Various Artists', () => {
  const wanting = artistsWanting([
    album('Radiohead', 'OK Computer', { artistMbid: 'a74b' }), album('Radiohead', 'Kid A'),
    album('Korn', 'Issues'),
    album('Various Artists', 'Now 1'), album('Various Artists', 'Now 2'),
    album(null, 'Untitled'), album(null, 'Untitled 2'),
  ]);
  assert.deepStrictEqual([...wanting.keys()], [sameName('Radiohead')]);
  assert.deepStrictEqual(wanting.get(sameName('Radiohead')), { key: sameName('Radiohead'), artist: 'Radiohead', mbid: 'a74b', owned: ['OK Computer', 'Kid A'] });
});

test('missing: not owned under any spelling, not hidden, oldest first, no year last', () => {
  const groups = [g('3', 'Kid A', { year: '2000' }), g('1', 'Pablo Honey', { year: '1993' }), g('x', 'Unknown Promo', { year: null }), g('2', 'Ok Computer!', { year: '1997' }), g('h', 'Hidden', { year: '1995' })];
  assert.deepStrictEqual(missingFor(groups, ['OK Computer'], new Set(['h'])).map((x) => x.id), ['1', '3', 'x']);
  assert.deepStrictEqual(missingFor(groups, ['Kid A', 'OK Computer', 'Pablo Honey', 'Unknown Promo'], new Set(['h'])), []);
});

test('the box stands after the artist\'s last album; open, their places before it', () => {
  const items = [{ divider: 'K' }, album('Korn', 'Issues'), album('Korn', 'Untouchables'), { divider: 'R' }, album('Radiohead', 'Kid A')];
  const shut = { key: sameName('Korn'), artist: 'Korn', state: 'found', missing: [g('f', 'Follow the Leader')], open: false };
  const show = (list) => list.map((x) => (x.divider ? `[${x.divider}]` : x.box ? `<${x.box.artist}>` : x.ghost ? `~${x.ghost.title}` : x.title));
  assert.deepStrictEqual(show(withMissing(items, new Map([[shut.key, shut]]))), ['[K]', 'Issues', 'Untouchables', '<Korn>', '[R]', 'Kid A']);
  const open = { ...shut, open: true };
  assert.deepStrictEqual(show(withMissing(items, new Map([[open.key, open]]))), ['[K]', 'Issues', 'Untouchables', '~Follow the Leader', '<Korn>', '[R]', 'Kid A']);
  assert.deepStrictEqual(show(withMissing(items, new Map())), ['[K]', 'Issues', 'Untouchables', '[R]', 'Kid A']);
});

test('what a box says', () => {
  assert.strictEqual(boxLabel({ state: 'loading', missing: [] }), '…');
  assert.strictEqual(boxLabel({ state: 'found', missing: [g('a', 'A'), g('b', 'B')] }), '+2 MISSING');
  assert.strictEqual(boxLabel({ state: 'found', missing: [] }), 'COMPLETE ★');
});

test('a place is labelled with what it is; a single\'s case is slim', () => {
  assert.strictEqual(typeLabel(g('a', 'A')), '');
  assert.strictEqual(typeLabel(g('a', 'A', { secondary: ['Live'] })), 'LIVE');
  assert.strictEqual(typeLabel(g('a', 'A', { secondary: ['Compilation'] })), 'COMP');
  assert.strictEqual(typeLabel(g('a', 'A', { secondary: ['Soundtrack'] })), 'OST');
  assert.strictEqual(typeLabel(g('a', 'A', { secondary: ['Remix'] })), 'REMIX');
  assert.strictEqual(typeLabel(g('a', 'A', { type: 'EP' })), 'EP');
  assert.strictEqual(typeLabel(g('a', 'A', { type: 'Single' })), 'SINGLE');
  assert.strictEqual(typeLabel(g('a', 'A', { type: 'Single', secondary: ['Live'] })), 'LIVE');
  assert.strictEqual(isSlim(g('a', 'A', { type: 'Single' })), true);
  assert.strictEqual(isSlim(g('a', 'A', { type: 'EP' })), false);
});
