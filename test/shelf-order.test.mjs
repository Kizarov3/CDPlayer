import test from 'node:test';
import assert from 'node:assert';
import { arrange, SORTS, dominantColor, colorBand, jumpTargets } from '../src/renderer/js/shelf-order.js';

const DAY = 86400000;
const album = (artist, title, extra = {}) => ({ id: `${artist}/${title}`, artist, title, year: null, added: null, plays: 0, ...extra });
const show = (items) => items.map((x) => (x.divider ? `[${x.divider}]` : x.title));

test('the ways to sort, in the order the button goes round', () => {
  assert.deepStrictEqual(SORTS, ['ARTIST', 'NEW', 'PLAYED', 'YEAR', 'COLOR', 'PRICE']);
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

// A w×h RGBA image from a list of [r, g, b] pixels.
const image = (pixels) => Uint8ClampedArray.from(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));

test('the colour an album is filed under: its most common vivid colour, not the muddy average', () => {
  const cover = image([...Array(40).fill([20, 20, 22]), ...Array(15).fill([220, 30, 30]), ...Array(9).fill([30, 60, 210])]);
  const [r, g, b] = dominantColor(cover);
  assert.ok(r > 180 && g < 80 && b < 80, `${r},${g},${b}`);
  const grey = image(Array(64).fill([128, 128, 130]));
  assert.deepStrictEqual(dominantColor(grey), [128, 128, 130]);
});

test('colour bands round the rainbow, and black & white', () => {
  assert.strictEqual(colorBand([220, 30, 30]).band, 'RED');
  assert.strictEqual(colorBand([230, 20, 60]).band, 'RED'); // crimson, past 345°
  assert.strictEqual(colorBand([240, 140, 20]).band, 'ORANGE');
  assert.strictEqual(colorBand([230, 210, 40]).band, 'YELLOW');
  assert.strictEqual(colorBand([40, 180, 60]).band, 'GREEN');
  assert.strictEqual(colorBand([30, 170, 210]).band, 'BLUE');
  assert.strictEqual(colorBand([30, 60, 210]).band, 'BLUE');
  assert.strictEqual(colorBand([140, 40, 200]).band, 'PURPLE');
  assert.strictEqual(colorBand([128, 128, 130]).band, 'B&W');
  assert.strictEqual(colorBand([10, 12, 30]).band, 'B&W'); // nearly black
  assert.strictEqual(colorBand(null).band, 'B&W');
});

test('SORT: COLOR stands the shelf in rainbow order, a card for each colour, black & white last from light to dark', () => {
  const list = [
    album('A', 'Blue', { color: [30, 60, 210] }), album('B', 'Black', { color: [15, 15, 15] }),
    album('C', 'Red', { color: [220, 30, 30] }), album('D', 'White', { color: [240, 240, 240] }),
    album('E', 'Green', { color: [40, 180, 60] }), album('F', 'Crimson', { color: [230, 20, 60] }),
    album('G', 'No cover', { color: null }),
  ];
  assert.deepStrictEqual(show(arrange(list, 'COLOR')), ['[RED]', 'Crimson', 'Red', '[GREEN]', 'Green', '[BLUE]', 'Blue', '[B&W]', 'White', 'No cover', 'Black']);
  assert.deepStrictEqual(SORTS, ['ARTIST', 'NEW', 'PLAYED', 'YEAR', 'COLOR']);
});

test('the sections to jump to: the divider cards in order, short names shortened', () => {
  const items = arrange([album('ABBA', 'Gold'), album('Björk', 'Post'), album('Beck', 'Odelay'), album('The Cure', 'Disintegration')], 'ARTIST');
  assert.deepStrictEqual(jumpTargets(items), [{ label: 'A', short: 'A' }, { label: 'B', short: 'B' }, { label: 'C', short: 'C' }]);
  const years = arrange([album('X', 'One', { year: '1994' }), album('Y', 'Two', { year: '2011' })], 'YEAR');
  assert.deepStrictEqual(jumpTargets(years).map((t) => t.short), ['90s', '10s']);
  const played = arrange([album('X', 'One', { plays: 3 }), album('Y', 'Two', { plays: 0 })], 'PLAYED');
  assert.deepStrictEqual(jumpTargets(played).map((t) => t.short), ['NOT']);
  const colours = arrange([album('X', 'One', { color: [240, 140, 20] }), album('Y', 'Two', { color: [230, 210, 40] })], 'COLOR');
  assert.deepStrictEqual(jumpTargets(colours).map((t) => t.short), ['ORA', 'YEL']);
});
