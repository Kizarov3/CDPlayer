// The TERMINAL look's screen, with no window: characters to cells, the frames, what's where to click.
import test from 'node:test';
import assert from 'node:assert';
import { cellWidth, glyphs, textWidth, clip, levelChar, stackedLevel, seekLevels, asciiCells, Grid, panes, screen, trayRows } from '../src/renderer/js/tui.js';

test('characters to cells: a kanji or hangul takes two, a combining mark none', () => {
  assert.strictEqual(cellWidth('a'), 1);
  assert.strictEqual(cellWidth('я'), 1);
  assert.strictEqual(cellWidth('語'), 2);
  assert.strictEqual(cellWidth('한'), 2);
  assert.strictEqual(cellWidth('́'), 0);
  assert.strictEqual(textWidth('Café'), 4);
  assert.strictEqual(textWidth('日本語 ok'), 9);
  assert.deepStrictEqual(glyphs('a\nb').map((g) => g.ch), ['a', ' ', 'b']);
});

test('clip: fits in its cells, never half a wide character, … only when cut', () => {
  assert.strictEqual(clip('short', 10), 'short');
  assert.strictEqual(clip('longer text', 6), 'longe…');
  assert.strictEqual(clip('日本語', 4), '日…');
  assert.ok(textWidth(clip('日本語日本語', 5)) <= 5);
  assert.strictEqual(clip('anything', 0), '');
});

test('levels: as high as they are, stacked rows fill from the bottom', () => {
  assert.strictEqual(levelChar(0), ' ');
  assert.strictEqual(levelChar(1), '█');
  assert.strictEqual(levelChar(2), '█');
  assert.strictEqual(stackedLevel(0.5, 1, 2), '█'); // half of two rows: the bottom one full…
  assert.strictEqual(stackedLevel(0.5, 0, 2), ' '); // …the top one empty
  assert.deepStrictEqual(seekLevels(null, 3), [0.25, 0.25, 0.25]);
  const shape = seekLevels([0, 10, 5, 0], 2);
  assert.strictEqual(shape[0], 1);
  assert.ok(shape[1] < 1 && shape[1] > 0);
});

test('a picture in characters: clear stays blank, brighter is denser, dark still readable', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255, 10, 0, 0, 255]);
  const [row] = asciiCells(rgba, 3, 1);
  assert.strictEqual(row[0], null);
  assert.strictEqual(row[1].ch, '@');
  assert.ok(row[2].ch !== ' ');
  assert.ok(Math.max(...row[2].rgb) >= 100);
});

test('the grid: a wide character holds two cells, nothing past the limit, the last hit on top', () => {
  const g = new Grid(6, 2);
  assert.strictEqual(g.put(0, 0, '語a'), 3);
  assert.strictEqual(g.cells[0][1].w, 0);
  g.put(4, 1, '語語');
  assert.strictEqual(g.cells[1][4].ch, '語');
  g.put(5, 0, '語'); // (doesn't fit in the last cell)
  assert.strictEqual(g.cells[0][5], null);
  g.hit(0, 0, 6, 'row', 1); g.hit(5, 0, 1, 'remove', 1);
  assert.strictEqual(g.hitAt(5, 0).act, 'remove');
  assert.strictEqual(g.hitAt(1, 0).act, 'row');
  assert.strictEqual(g.hitAt(1, 1), null);
});

const model = (over = {}) => ({
  words: { now: 'NOW PLAYING', volume: 'VOLUME', disc: 'CD' }, title: '日本語のタイトルがとても長い場合'.repeat(8), artist: 'Band', album: 'Album', year: '1999', source: 'FLAC', status: 'NOW SPINNING',
  elapsed: '1:23', remaining: '-2:44', fraction: 0.5, volume: 72, muted: false, waveform: [1, 2, 3], spectrum: (n) => Array(n).fill(0.5), disc: null,
  transport: [{ label: 'SHUFFLE: OFF', act: 'shuffle' }, { label: '|<', act: 'prev' }, { label: ' |> ', act: 'toggle', on: true }, { label: '>|', act: 'next' }],
  tools: [{ label: 'KARAOKE', act: 'click', arg: 'karaoke-button' }],
  queue: { info: 'QUEUE 2 / 40', next: 'UP NEXT', actions: [{ label: 'CLEAR', act: 'click', arg: 'clear-queue-button' }], slots: null, total: 40, active: 20, top: null, removable: true, nextWord: 'NEXT', rowAt: (i) => ({ index: i, no: i + 1, title: `Song ${i}`, time: '3:00', active: i === 20 }) },
  hint: 'SPACE PLAY', ...over,
});
const rowText = (g, y) => g.cells[y].map((c) => (c ? c.ch : ' ')).join('');

test('the screen: frames closed, nothing out of line with a long Japanese title; every key there and clickable', () => {
  for (const [cols, rows] of [[140, 40], [100, 30], [60, 24], [44, 20]]) {
    const g = screen(model(), cols, rows);
    const p = panes(cols, rows);
    assert.strictEqual(g.cells[0][cols - 1].ch, '┐', `${cols}×${rows}`);
    assert.strictEqual(g.cells[p.top - 1][cols - 1].ch, '┘', `${cols}×${rows}`);
    for (let y = 1; y < p.top - 1; y++) assert.strictEqual(g.cells[y][cols - 1].ch, '│', `${cols}×${rows} row ${y}`);
    for (const act of ['seek', 'volume', 'mute', 'toggle', 'next', 'row', 'remove']) assert.ok(g.hits.some((h) => h.act === act), `${cols}×${rows}: ${act}`);
    for (const h of g.hits) assert.ok(h.x + h.w <= cols && h.y < rows, `${h.act} inside`);
    assert.ok(!rowText(g, p.top - 1).includes('['), `${cols}×${rows}: nothing on the frame's bottom edge`);
  }
});

test('the queue: round the song playing, or where it was scrolled to, never past its end', () => {
  const g = screen(model(), 100, 30);
  assert.ok(g.meta.queueRows > 0);
  const shown = g.hits.filter((h) => h.act === 'row').map((h) => h.arg);
  assert.ok(shown.includes(20));
  const q = model(); q.queue.top = 999;
  const end = screen(q, 100, 30);
  const last = end.hits.filter((h) => h.act === 'row').map((h) => h.arg);
  assert.strictEqual(last[last.length - 1], 39);
  assert.ok(rowText(g, g.hits.find((h) => h.arg === 20 && h.act === 'row').y).includes('> '));
});

test('the changer: its five discs to click, no × on its songs', () => {
  const q = model();
  q.queue.removable = false;
  q.queue.slots = [{ title: 'One', playing: true }, null, { title: 'Three' }, null, null];
  const g = screen(q, 100, 30);
  assert.deepStrictEqual(g.hits.filter((h) => h.act === 'slot').map((h) => h.arg), [0, 2]);
  assert.ok(!g.hits.some((h) => h.act === 'remove'));
});

test('a window too small: no crash; narrow: the disc goes, not the player', () => {
  assert.strictEqual(screen(model(), 10, 4).hits.length, 0);
  assert.strictEqual(panes(60, 30).discWidth, 0);
  assert.ok(panes(140, 40).discWidth > 0);
  const small = panes(97, 41, 2.3); // the smallest window: every key still fits beside a smaller disc
  assert.ok(small.discWidth > 0 && 97 - small.discWidth >= 66);
  assert.ok(Math.abs(small.discInner / small.discRows - 2.3) < 0.3); // (still round)
});

test('the tray: shut and out exactly, one speed between, past its stop and back, a hair in on the latch', async () => {
  const { traySlide, trayReveal } = await import('../src/renderer/js/tray-motion.js');
  assert.strictEqual(traySlide(0), 0);
  assert.strictEqual(traySlide(1), 1);
  assert.ok(traySlide(0.05) < 0);
  assert.ok(traySlide(0.9) > 1);
  const a = traySlide(0.4) - traySlide(0.35), b = traySlide(0.7) - traySlide(0.65);
  assert.ok(Math.abs(a - b) < 1e-9, 'one speed in the middle');
  for (let t = 0.1; t < 0.9; t += 0.01) assert.ok(traySlide(t + 0.01) >= traySlide(t) - 1e-9, 'only ever out');
  assert.strictEqual(trayReveal(0), 0);
  assert.strictEqual(trayReveal(0.5), 1);
});

test('the tray in TERMINAL: the disc frame runs down over the queue, the opening shaded behind, clicking it closes it', () => {
  const m = model({ tray: 1, disc: (w, h) => Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: '#', rgb: [1, 2, 3] }))), words: { now: 'N', volume: 'V', disc: 'CD', tray: 'TRAY', noDisc: 'NO DISC' } });
  const g = screen(m, 140, 40), p = panes(140, 40), by = trayRows(1, p.top);
  assert.ok(by > 3);
  assert.strictEqual(g.cells[1][2].ch, '░');
  assert.strictEqual(g.cells[by][0].ch, '┌');
  assert.strictEqual(g.cells[by + p.top - 1][0].ch, '└');
  const hit = g.hitAt(3, by + 2);
  assert.strictEqual(hit.arg, 'tray-button');
  const none = screen({ ...m, disc: () => null }, 140, 40);
  assert.ok(none.cells.some((_, y) => rowText(none, y).includes('NO DISC')));
  // shut: as if it weren't there
  assert.strictEqual(rowText(screen({ ...m, tray: 0 }, 140, 40), 1)[2], '#');
});

test('the album said once: not on a line of its own when the source line has it already', () => {
  const m = { words: { now: 'NOW', volume: 'VOL', disc: 'CD' }, title: 'Song', artist: 'Band', album: 'Jar Of Flies', year: '1994', source: 'Jar Of Flies (1994) · FLAC', transport: [], tools: [], queue: null };
  const text = (mm) => screen(mm, 120, 40, 2).cells.map((r) => r.map((c) => (c ? c.ch : ' ')).join('')).join('\n');
  assert.ok(!text(m).includes('Jar Of Flies · 1994'));
  assert.ok(text(m).includes('Jar Of Flies (1994)'));
  assert.ok(text({ ...m, source: 'FLAC' }).includes('Jar Of Flies · 1994'));
});

test('? ALL KEYS at the foot can be clicked, when it fits', () => {
  const m = { words: { now: 'NOW', volume: 'VOL', disc: 'CD' }, title: 'Song', transport: [], tools: [], queue: null, hint: 'SPACE PLAY · ? ALL KEYS', allKeys: '? ALL KEYS' };
  const grid = screen(m, 120, 40, 2), x = 1 + 'SPACE PLAY · '.length;
  assert.strictEqual(grid.hitAt(x, 39).act, 'keys');
  assert.strictEqual(grid.hitAt(x + 9, 39).act, 'keys');
  assert.strictEqual(grid.hitAt(x - 1, 39), null);
  assert.ok(!screen({ ...m, hint: `${'x'.repeat(200)} ? ALL KEYS` }, 120, 40, 2).hits.some((h) => h.act === 'keys'));
});

test('the queue says how far it can be scrolled, so the wheel stops at its end', () => {
  const q = { info: 'Q', actions: [], slots: null, total: 100, active: 0, top: 500, rowAt: (i) => ({ index: i, no: i + 1, title: `t${i}`, time: '1:00' }) };
  const grid = screen({ words: { now: 'NOW', volume: 'VOL', disc: 'CD' }, title: 'Song', transport: [], tools: [], queue: q }, 120, 40, 2);
  assert.strictEqual(grid.meta.queueMost, 100 - grid.meta.queueRows);
  assert.strictEqual(grid.meta.queueTop, grid.meta.queueMost);
});

test('onPaper: a pale colour of the disc is darkened (its hue kept) to stand out on a light paper; a dark one is kept', async () => {
  const { onPaper } = await import('../src/renderer/js/tui.js');
  const { contrast } = await import('../src/renderer/js/theme.js');
  const paper = [251, 251, 252];
  for (const c of [[255, 255, 255], [240, 230, 120], [180, 220, 255], [200, 200, 200]]) {
    const d = onPaper(c, paper);
    assert.ok(contrast(d, paper) >= 2.95, `${c} → ${d}: ${contrast(d, paper)}`);
    assert.ok(d.every((v, i) => v <= c[i]), 'only darkened');
  }
  const yellow = onPaper([240, 230, 120], paper);
  assert.ok(yellow[0] > yellow[2] && yellow[1] > yellow[2], 'still a yellow');
  assert.deepStrictEqual(onPaper([60, 40, 120], paper), [60, 40, 120]);
});

test('asciiCells on paper: white is the paper (no character), anything else as on a dark screen', () => {
  const px = new Uint8ClampedArray([250, 250, 250, 255, 120, 60, 200, 255]);
  const dark = asciiCells(px, 2, 1), paper = asciiCells(px, 2, 1, { paper: true });
  assert.ok(dark[0][0], 'a dark screen shows white');
  assert.strictEqual(paper[0][0], null);
  assert.deepStrictEqual(paper[0][1], dark[0][1]);
});
