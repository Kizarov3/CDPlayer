import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { sameName, artistsWanting, missingFor, withMissing, boxLabel, boxesFor, renderGate, pickEdition, fullTracklist, groupOf } from '../src/renderer/js/shelf-missing.js';

const require = createRequire(import.meta.url);
const main = require('../src/main/same-name');

const album = (artist, title, extra = {}) => ({ id: `${artist}/${title}`, artist, title, year: null, artistMbid: null, ...extra });
const g = (id, title, extra = {}) => ({ id, title, type: 'Album', secondary: [], year: '2000', ...extra });

test('names are compared as the shelf does in main', () => {
  for (const s of ['OK Computer', 'ok computer!', "Three Dollar Bill, Y'all$", 'Björk', '!!!', '  ', 'Сплин', 'シングル']) {
    assert.strictEqual(sameName(s), main.sameName(s), s);
  }
});

test('a box for every album artist on the shelf, one album is enough, but not Various Artists', () => {
  const wanting = artistsWanting([
    album('Radiohead', 'OK Computer', { artistMbid: 'a74b' }), album('Radiohead', 'Kid A'),
    album('Korn', 'Issues'),
    album('Various Artists', 'Now 1'), album('Various Artists', 'Now 2'),
    album(null, 'Untitled'), album(null, 'Untitled 2'),
  ]);
  assert.deepStrictEqual([...wanting.keys()], [sameName('Radiohead'), sameName('Korn')]);
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

test('only studio albums are missing: no EPs, singles, live records, compilations, soundtracks or remixes', () => {
  const groups = [
    g('s', 'Studio', { year: '1995' }),
    g('e', 'An EP', { type: 'EP' }), g('x', 'A Single', { type: 'Single' }), g('b', 'Broadcast', { type: 'Broadcast' }),
    g('l', 'Live Album', { secondary: ['Live'] }), g('c', 'Best Of', { secondary: ['Compilation'] }),
    g('o', 'Soundtrack', { secondary: ['Soundtrack'] }), g('r', 'Remixes', { secondary: ['Remix'] }),
  ];
  assert.deepStrictEqual(missingFor(groups, [], new Set()).map((x) => x.id), ['s']);
});

test('a filter narrows which places stand, never what the box counts', () => {
  const albums = [album('Radiohead', 'OK Computer'), album('Radiohead', 'Kid A'), album('Korn', 'Issues'), album('Korn', 'Untouchables')];
  const discogs = new Map([
    [sameName('Radiohead'), { state: 'found', groups: [g('p', 'Pablo Honey', { year: '1993' }), g('b', 'The Bends', { year: '1995' })] }],
    [sameName('Korn'), { state: 'unknown', groups: [] }],
  ]);
  const shown = albums.filter((a) => /computer/i.test(a.title));
  const boxes = boxesFor({ albums, shown, discogs, hidden: new Set(), open: new Set([sameName('Radiohead')]), query: 'computer' });
  const box = boxes.get(sameName('Radiohead'));
  assert.strictEqual(boxLabel(box), '+2 MISSING');
  assert.deepStrictEqual(box.places, []);
  assert.deepStrictEqual(boxesFor({ albums, shown: albums, discogs, hidden: new Set(), open: new Set([sameName('Radiohead')]), query: 'bends' }).get(sameName('Radiohead')).places.map((x) => x.id), ['b']);
  assert.ok(!boxes.has(sameName('Korn')), 'unknown to MusicBrainz, and not shown: no box');
  const waiting = boxesFor({ albums, shown: albums, discogs: new Map(), hidden: new Set(), open: new Set(), query: '' });
  assert.strictEqual(boxLabel(waiting.get(sameName('Korn'))), '…');
});

test('the shelf is redrawn once for a burst of answers, and not while a case is out or a spine carried', () => {
  const timers = [];
  let busy = false, renders = 0;
  const gate = renderGate({ render: () => { renders++; }, busy: () => busy, later: (fn) => timers.push(fn) });
  gate.request(); gate.request(); gate.request();
  assert.strictEqual(timers.length, 1, 'one redraw asked for a burst');
  busy = true;
  timers.shift()();
  assert.strictEqual(renders, 0, 'not while busy');
  assert.strictEqual(timers.length, 1, 'tried again later');
  busy = false;
  timers.shift()();
  assert.strictEqual(renders, 1);
  gate.request();
  timers.shift()();
  assert.strictEqual(renders, 2);
});

const tr = (title, length = 200) => ({ title, length });

test('the edition to list: the one with the most of your songs on it, then the shortest', () => {
  const original = [tr('Airbag'), tr('Paranoid Android'), tr('Lucky')];
  const deluxe = [...original, tr('Polyethylene'), tr('Pearly*')];
  const other = [tr('Something Else')];
  assert.strictEqual(pickEdition([deluxe, original, other], ['airbag', 'Lucky!']), original);
  assert.strictEqual(pickEdition([original, deluxe], ['Airbag', 'Pearly*']), deluxe);
  assert.strictEqual(pickEdition([], ['Airbag']), null);
  // A deluxe edition with a live disc has your songs twice: they still count once each.
  const regular = [tr('Given Up'), tr('Bleed It Out'), tr('Shadow of the Day')];
  const liveDeluxe = [...regular, tr('Given Up'), tr('Bleed It Out'), tr('Faint'), tr('Numb')];
  assert.strictEqual(pickEdition([liveDeluxe, regular], ['Bleed It Out', 'Given Up']), regular);
});

test('the full tracklist: yours where they are, the ones you haven\'t in their place, your extras at the end', () => {
  const edition = [tr('Airbag', 284), tr('Paranoid Android', 383), tr('Lucky', 259)];
  const owned = [{ path: '/a', title: 'Lucky' }, { path: '/b', title: 'Airbag' }, { path: '/c', title: 'Bonus Demo' }];
  assert.deepStrictEqual(fullTracklist(edition, owned).map((r) => [r.no, r.title, r.have ? r.have.path : null]), [
    [1, 'Airbag', '/b'], [2, 'Paranoid Android', null], [3, 'Lucky', '/a'], [null, 'Bonus Demo', '/c'],
  ]);
  assert.strictEqual(fullTracklist(edition, owned)[1].length, 383);
});

test('an album\'s release group, from its artist\'s discography', () => {
  const discogs = new Map([[sameName('Radiohead'), { state: 'found', groups: [g('ok', 'OK Computer'), g('ka', 'Kid A')] }]]);
  assert.strictEqual(groupOf(album('Radiohead', 'Ok Computer!'), discogs).id, 'ok');
  assert.strictEqual(groupOf(album('Radiohead', 'Airbag EP'), discogs), null);
  assert.strictEqual(groupOf(album('Korn', 'Issues'), discogs), null);
});
