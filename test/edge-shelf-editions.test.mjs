// test/edge-shelf-editions.test.mjs — editions with odd titles
import test from 'node:test';
import assert from 'node:assert';
import { groupEditions, editionName } from '../src/renderer/js/shelf-editions.js';

const album = (artist, title, extra = {}) => ({ id: `${artist}/${title}`, artist, title, year: null, plays: 0, lastPlayed: null, tracks: [], ...extra });
const names = (list) => list.map((a) => (a.editions ? `${a.title} ×${a.editions.length}` : a.title));

test('editions whatever the case, the brackets or the dash: one spine, each named by its own words', () => {
  const plain = album('Radiohead', 'OK Computer'), bracket = album('RADIOHEAD', 'ok computer [Remastered]'), dash = album('Radiohead', 'OK Computer – 2017 Remaster');
  const out = groupEditions([plain, album('Radiohead', 'Kid A'), bracket, dash]);
  assert.deepStrictEqual(names(out), ['OK Computer ×3', 'Kid A']);
  assert.deepStrictEqual(plain.editions, [plain, bracket, dash], 'in the shelf\'s order');
  assert.strictEqual(editionName(bracket, plain.editions), 'Remastered');
  assert.strictEqual(editionName(dash, plain.editions), '2017 Remaster');
  assert.strictEqual(editionName(plain, plain.editions), '', 'no years to tell them by: the plain one says nothing');
});

test('editions in another alphabet, and a title with brackets of its own', () => {
  const a = album('Кино', 'Группа крови'), b = album('КИНО', 'Группа Крови (Remastered)');
  assert.deepStrictEqual(names(groupEditions([a, b])), ['Группа крови ×2']);
  assert.strictEqual(editionName(b, [a, b]), 'Remastered');
  const live = album('A', 'Ten [Live]'), liveDeluxe = album('A', 'Ten [Live] (Deluxe)');
  assert.deepStrictEqual(names(groupEditions([album('A', 'Ten'), live, liveDeluxe])), ['Ten', 'Ten [Live] ×2'], '[Live] is no edition: another album');
  assert.strictEqual(editionName(liveDeluxe, [live, liveDeluxe]), 'Deluxe');
});

test('a set\'s discs, however written, and Various Artists in any case stand on their own', () => {
  const shelf = [album('C', 'Live (CD1)'), album('C', 'Live (CD2)'), album('C', 'Live [Disk 3]'),
    album('VARIOUS ARTISTS', 'Now 5'), album('Various  Artists', 'Now 5 (Deluxe)')];
  assert.deepStrictEqual(names(groupEditions(shelf)), shelf.map((a) => a.title));
  assert.ok(shelf.every((a) => a.editions === null));
});

test('three editions: the most played in front (ties: the first), where the first stood', () => {
  const x = album('A', 'X', { plays: 1 }), y = album('A', 'X (Deluxe Edition)', { plays: 5 }), z = album('A', 'X - 2011 Remaster', { plays: 5 });
  const out = groupEditions([x, album('A', 'Y'), y, z]);
  assert.deepStrictEqual(names(out), ['X (Deluxe Edition) ×3', 'Y']);
  assert.deepStrictEqual([x.editions, y.editions, z.editions], [null, [x, y, z], null]);
  z.lastPlayed = 1; // played last, however little: in front
  assert.deepStrictEqual(names(groupEditions([x, y, z])), ['X - 2011 Remaster ×3']);
});

test('the year names an edition only when no other edition has it', () => {
  const a = album('A', 'X', { year: '1990' }), mono = album('A', 'X (Mono)', { year: '1990' }), deluxe = album('A', 'X (Deluxe)', { year: '2010' });
  const all = [a, mono, deluxe];
  assert.deepStrictEqual(all.map((e) => editionName(e, all)), ['', 'Mono', 'Deluxe'], 'the plain one shares its year with Mono');
  const old = album('A', 'X', { year: '1990' }), re = album('A', 'X', { year: '2000' });
  assert.deepStrictEqual([editionName(old, [old, re]), editionName(re, [old, re])], ['1990', '2000'], 'two copies of one title: their years');
  const twin = album('A', 'X', { year: '1990' });
  assert.deepStrictEqual([editionName(old, [old, twin]), editionName(twin, [old, twin])], ['', ''], 'the same year: nothing to tell them by');
});

test('neither edition the plain one: each is named by its own words, brackets and all taken off', () => {
  const re = album('A', 'Ten (Remastered)'), deluxe = album('A', 'Ten [Deluxe Edition]');
  assert.deepStrictEqual(names(groupEditions([re, deluxe])), ['Ten (Remastered) ×2']);
  // What both titles start with is the plain title; each is named by the rest.
  assert.strictEqual(editionName(deluxe, [re, deluxe]), 'Deluxe Edition');
});
