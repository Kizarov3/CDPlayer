'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createBookletWords, pruneFolders } = require('../src/main/booklet-words');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-words-'));
const song = { artist: 'Eminem', title: 'Business', album: 'The Eminem Show', duration: 251.4 };

test("a song's words are kept once found, for a month; not found, they're looked for again", async () => {
  const dir = tmp();
  let asked = 0, answer = { lyrics: '[00:01.00]Marshall!', source: 'lrclib.net', name: { title: 'x' } }, now = 1e12;
  const make = () => createBookletWords({ dir: () => dir, find: async () => { asked++; return answer; }, now: () => now });
  assert.deepStrictEqual(await make()(song), { lyrics: '[00:01.00]Marshall!', source: 'lrclib.net' });
  assert.deepStrictEqual(await make()(song), { lyrics: '[00:01.00]Marshall!', source: 'lrclib.net' }); // another run
  assert.strictEqual(asked, 1);
  now += 31 * 86400e3;
  await make()(song);
  assert.strictEqual(asked, 2);
  answer = null;
  assert.strictEqual(await make()({ ...song, title: 'Other' }), null);
  assert.strictEqual(await make()({ ...song, title: 'Other' }), null);
  assert.strictEqual(asked, 4);
  assert.strictEqual(await make()({ artist: 'x' }), null); // (no title: nothing to ask)
  assert.strictEqual(asked, 4);
});

test('a file that cannot be read is asked for again, not thrown', async () => {
  const dir = tmp();
  const words = createBookletWords({ dir: () => dir, find: async () => ({ lyrics: 'a', source: 's' }) });
  await words(song);
  fs.writeFileSync(path.join(dir, fs.readdirSync(dir)[0]), '{');
  assert.deepStrictEqual(await words(song), { lyrics: 'a', source: 's' });
});

test("only the scans of the albums last opened are kept, and what isn't a folder is left alone", () => {
  const dir = tmp();
  for (let i = 0; i < 5; i++) { fs.mkdirSync(path.join(dir, `a${i}`)); fs.writeFileSync(path.join(dir, `a${i}`, '0.jpg'), 'x'); fs.utimesSync(path.join(dir, `a${i}`), 1000 + i, 1000 + i); }
  fs.writeFileSync(path.join(dir, 'b.none'), '');
  pruneFolders(dir, 3);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['a2', 'a3', 'a4', 'b.none']);
  pruneFolders(path.join(dir, 'nowhere'), 3);
});

test('words kept past their month are cleared away, not only passed over', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-words-'));
  const old = path.join(dir, 'old.json'), fresh = path.join(dir, 'fresh.json');
  for (const f of [old, fresh]) fs.writeFileSync(f, '{}');
  const past = new Date(Date.now() - 31 * 86400e3);
  fs.utimesSync(old, past, past);
  await createBookletWords({ dir: () => dir, find: async () => ({ lyrics: 'x' }) })({ artist: 'a', title: 't' });
  assert.deepStrictEqual([fs.existsSync(old), fs.existsSync(fresh)], [false, true]);
});
