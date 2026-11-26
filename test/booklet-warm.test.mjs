import test from 'node:test';
import assert from 'node:assert';
import { createWarm, memo } from '../src/renderer/js/booklet-warm.js';

test('asked once, however often it is wanted; there at once when it has come', async () => {
  let asked = 0;
  const m = memo(3, async (q) => { asked++; return `for ${q.album}`; });
  assert.strictEqual(m.peek({ album: 'A' }), undefined);
  const [a, b] = await Promise.all([m.get({ album: 'A' }), m.get({ album: 'A' })]);
  assert.deepStrictEqual([a, b, asked], ['for A', 'for A', 1]);
  assert.strictEqual(m.peek({ album: 'A' }), 'for A');
});

test('what could not be had is asked for again; only so many are kept, the last used', async () => {
  let asked = 0;
  const m = memo(2, async (q) => { asked++; if (q.x === 'fails') throw new Error('offline'); return q.x === 'none' ? null : q.x; }, (r) => r !== null);
  assert.strictEqual(await m.get({ x: 'fails' }), null); // (no throw: there's none, for now)
  assert.strictEqual(await m.get({ x: 'none' }), null);
  await m.get({ x: 'fails' }); await m.get({ x: 'none' });
  assert.strictEqual(asked, 4);
  await m.get({ x: 1 }); await m.get({ x: 2 }); await m.get({ x: 1 }); await m.get({ x: 3 });
  assert.deepStrictEqual([m.peek({ x: 1 }), m.peek({ x: 2 }), m.peek({ x: 3 })], [1, undefined, 3]);
});

test('an album got ready: its story, scans and the words of the songs that have none, a few at a time', async () => {
  let going = 0, most = 0;
  const words = async (q) => { going++; most = Math.max(most, going); await new Promise((r) => setTimeout(r, 2)); going--; return { lyrics: q.title }; };
  const seen = [];
  const warm = createWarm({ albumStory: async (q) => { seen.push(['story', q.album]); return null; }, bookletScans: async (q) => { seen.push(['scans', q.album]); return []; }, bookletLyrics: words });
  const songs = Array.from({ length: 10 }, (_, i) => ({ artist: 'A', title: `T${i}`, album: 'X', duration: 1 }));
  await warm.album({ story: { artist: 'A', album: 'X' }, scans: { artist: 'A', album: 'X' }, songs });
  assert.deepStrictEqual(seen, [['story', 'X'], ['scans', 'X']]);
  assert.strictEqual(most, 4);
  assert.deepStrictEqual(warm.words.peek(songs[9]), { lyrics: 'T9' });
});

test('another album wanted: the words of the one before are not asked for further', async () => {
  let asked = 0;
  const warm = createWarm({ albumStory: async () => null, bookletScans: async () => [], bookletLyrics: async () => { asked++; await new Promise((r) => setTimeout(r, 2)); return { lyrics: 'x' }; } });
  const songs = (n) => Array.from({ length: 20 }, (_, i) => ({ title: `${n}${i}` }));
  const first = warm.album({ songs: songs('a') });
  await warm.album({ songs: [] });
  await first;
  assert.ok(asked <= 4, String(asked));
});

test('words that could not be had are asked for once more, a little later — an instrumental not for ever', async () => {
  const asked = {};
  const cdp = { albumStory: async () => null, bookletScans: async () => [], bookletLyrics: async ({ title }) => { asked[title] = (asked[title] || 0) + 1; return title === 'busy' && asked.busy === 2 ? { lyrics: 'x' } : title === 'fine' ? { lyrics: 'y' } : null; } };
  const warm = createWarm(cdp, { again: 1 });
  await warm.album({ songs: [{ title: 'busy' }, { title: 'fine' }, { title: 'instrumental' }] });
  assert.deepStrictEqual(asked, { busy: 2, fine: 1, instrumental: 2 });
  assert.deepStrictEqual(warm.words.peek({ title: 'busy' }), { lyrics: 'x' });
});

test('a song with no words found (an instrumental) is not looked for again at each song of its album, but is later, and as the booklet is opened', async () => {
  let asked = 0, now = 0;
  const cdp = { albumStory: async () => null, bookletScans: async () => [], bookletLyrics: async () => { asked++; return null; } };
  const warm = createWarm(cdp, { again: 1, clock: () => now });
  await warm.album({ songs: [{ title: 'instrumental' }] });
  assert.strictEqual(asked, 2);
  await warm.album({ songs: [{ title: 'instrumental' }] });
  assert.strictEqual(asked, 2);
  await warm.words.get({ title: 'instrumental' });
  assert.strictEqual(asked, 3);
  now += 31 * 60e3;
  await warm.album({ songs: [{ title: 'instrumental' }] });
  assert.strictEqual(asked, 5);
});
