import test from 'node:test';
import assert from 'node:assert';
import { arrange, SORTS } from '../src/renderer/js/shelf-order.js';

const DAY = 86400000;
const album = (artist, title, extra = {}) => ({ id: `${artist}/${title}`, artist, title, year: null, added: null, plays: 0, ...extra });
const show = (items) => items.map((x) => (x.divider ? `[${x.divider}]` : x.title));

test('four ways to sort, in the order the button goes round', () => {
  assert.deepStrictEqual(SORTS, ['ARTIST', 'NEW', 'PLAYED', 'YEAR']);
});

test('by artist: the order the shelf already has, a letter card where the letter changes, "The" ignored, digits under #', () => {
  const albums = [album('311', 'Grassroots'), album('Air', 'Moon Safari'), album('The Beatles', 'Abbey Road'),
    album('Björk', 'Homogenic'), album('Blur', '13'), album(null, 'Summer Mix')];
  assert.deepStrictEqual(show(arrange(albums, 'ARTIST')),
    ['[#]', 'Grassroots', '[A]', 'Moon Safari', '[B]', 'Abbey Road', 'Homogenic', '13', '[?]', 'Summer Mix']);
});

test('new: newest first, a card for each month; albums with no date at the end', () => {
  const sep = Date.UTC(2026, 8, 20), aug = Date.UTC(2026, 7, 3);
  const albums = [album('A', 'Old', { added: aug }), album('B', 'Newest', { added: sep + DAY }), album('C', 'Undated'), album('D', 'New', { added: sep })];
  assert.deepStrictEqual(show(arrange(albums, 'NEW')), ['[SEP 2026]', 'Newest', 'New', '[AUG 2026]', 'Old', '[?]', 'Undated']);
});

test('most played: by plays, ties by artist; one card before the albums not played yet', () => {
  const albums = [album('A', 'Twice', { plays: 2 }), album('B', 'Never'), album('C', 'Most', { plays: 40 }), album('D', 'Also twice', { plays: 2 })];
  assert.deepStrictEqual(show(arrange(albums, 'PLAYED')), ['Most', 'Twice', 'Also twice', '[NOT PLAYED YET]', 'Never']);
  assert.deepStrictEqual(show(arrange([album('A', 'X', { plays: 1 })], 'PLAYED')), ['X']);
});

test('year: oldest first, a card for each decade, no year at the end', () => {
  const albums = [album('A', 'Ninety-nine', { year: '1999' }), album('B', 'Undated'), album('C', 'Eighty-two', { year: '1982' }), album('D', 'Ninety', { year: '1990' }), album('E', 'Two thousand', { year: '2000' })];
  assert.deepStrictEqual(show(arrange(albums, 'YEAR')),
    ['[1980s]', 'Eighty-two', '[1990s]', 'Ninety', 'Ninety-nine', '[2000s]', 'Two thousand', '[NO YEAR]', 'Undated']);
});
