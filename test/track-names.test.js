'use strict';
// Badly named tracks: what the player shows (tidyNames) and what the cover/lyrics lookups try (nameVariants).
const test = require('node:test');
const assert = require('node:assert');
const { tidyNames, nameVariants, parseFilename, splitName, bareTitle, primaryArtist, cleanArtist } = require('../src/main/track-names');

const tidy = (tags, file = '/m/song.mp3') => { const { artist, title } = tidyNames(tags, file); return { artist, title }; };

test('website tags and video noise come off', () => {
  assert.deepStrictEqual(tidy({ artist: 'Korn', title: 'Got The Life (mp3.pm)' }), { artist: 'Korn', title: 'Got The Life' });
  assert.deepStrictEqual(tidy({ artist: 'Korn', title: 'Got The Life (Official Video) [HD]' }), { artist: 'Korn', title: 'Got The Life' });
});

test('junk artist tags give way to the filename', () => {
  for (const junk of ['Unknown Artist', 'VA', 'Various Artists', 'www.muzmo.ru', 'Неизвестный исполнитель', '']) {
    assert.deepStrictEqual(tidy({ artist: junk, title: 'Got The Life' }, '/m/Korn - Got The Life.mp3'), { artist: 'Korn', title: 'Got The Life' }, junk);
  }
  assert.strictEqual(cleanArtist('Unknown Artist'), null);
});

test('junk title tags give way to the filename', () => {
  assert.deepStrictEqual(tidy({ artist: null, title: 'Track 01' }, '/m/Korn - Got The Life.mp3'), { artist: 'Korn', title: 'Got The Life' });
});

test('track numbers come off titles — but not off "7 Rings" or "99 Problems"', () => {
  assert.strictEqual(tidy({ artist: 'Korn', title: '01. Got The Life' }).title, 'Got The Life');
  assert.strictEqual(tidy({ artist: 'Korn', title: '03 - Got The Life' }).title, 'Got The Life');
  assert.strictEqual(tidy({ artist: 'Korn', title: '01 Got The Life' }).title, 'Got The Life');
  assert.strictEqual(tidy({ artist: 'Ariana Grande', title: '7 Rings' }).title, '7 Rings');
  assert.strictEqual(tidy({ artist: 'Jay-Z', title: '99 Problems' }).title, '99 Problems');
  assert.strictEqual(tidy({ artist: 'Logic', title: '1-800-273-8255' }).title, '1-800-273-8255');
});

test('"Artist - Title" in the title tag', () => {
  assert.deepStrictEqual(tidy({ artist: null, title: 'Korn - Got The Life' }), { artist: 'Korn', title: 'Got The Life' });
  assert.deepStrictEqual(tidy({ artist: 'Korn', title: 'Korn - Got The Life' }), { artist: 'Korn', title: 'Got The Life' }); // repeated
  assert.deepStrictEqual(tidy({ artist: 'Queen', title: 'Bohemian Rhapsody - Remastered 2011' }), { artist: 'Queen', title: 'Bohemian Rhapsody - Remastered 2011' });
  assert.deepStrictEqual(tidy({ artist: null, title: 'Bohemian Rhapsody - Remastered 2011' }).artist, null); // not an artist
});

test('filenames: numbers, one-sided dashes, "Artist - Album - 01 - Title", dashes inside names', () => {
  assert.deepStrictEqual(parseFilename('/m/01 - Korn - Got The Life (mp3.pm).mp3'), { artist: 'Korn', title: 'Got The Life' });
  assert.deepStrictEqual(parseFilename('/m/Korn -Got The Life.mp3'), { artist: 'Korn', title: 'Got The Life' });
  assert.deepStrictEqual(parseFilename('/m/Korn_-_Got_The_Life.mp3'), { artist: 'Korn', title: 'Got The Life' });
  assert.deepStrictEqual(parseFilename('/m/Korn - Follow The Leader - 05 - Got The Life.flac'), { artist: 'Korn', title: 'Got The Life' });
  assert.deepStrictEqual(parseFilename('/m/Jay-Z - 99 Problems.mp3'), { artist: 'Jay-Z', title: '99 Problems' });
  assert.deepStrictEqual(parseFilename('/m/03 - Queen - Bohemian Rhapsody - Remastered 2011.mp3'), { artist: 'Queen', title: 'Bohemian Rhapsody - Remastered 2011' });
  assert.deepStrictEqual(splitName('Anti-Hero'), null);
});

test('versions, credits and extra artists are left out of the searches', () => {
  assert.strictEqual(bareTitle('Bohemian Rhapsody - Remastered 2011'), 'Bohemian Rhapsody');
  assert.strictEqual(bareTitle('Levels - Radio Edit'), 'Levels');
  assert.strictEqual(bareTitle('Blinding Lights - Slowed + Reverb'), 'Blinding Lights');
  assert.strictEqual(bareTitle('Get Lucky (feat. Pharrell Williams) [Radio Edit]'), 'Get Lucky');
  assert.strictEqual(bareTitle('Mask Off prod. by Metro Boomin'), 'Mask Off');
  assert.strictEqual(primaryArtist('Daft Punk feat. Pharrell Williams'), 'Daft Punk');
  assert.strictEqual(primaryArtist('Calvin Harris, Dua Lipa'), 'Calvin Harris');
  assert.strictEqual(primaryArtist('Skrillex & Diplo'), 'Skrillex');
});

test('the guesses, best first: as named, bare, first artist', () => {
  assert.deepStrictEqual(nameVariants({ artist: 'Daft Punk feat. Pharrell', title: 'Get Lucky (Radio Edit)' }), [
    { artist: 'Daft Punk feat. Pharrell', title: 'Get Lucky (Radio Edit)' },
    { artist: 'Daft Punk feat. Pharrell', title: 'Get Lucky' },
    { artist: 'Daft Punk', title: 'Get Lucky' },
  ]);
});

test('"Title - Artist" files: the guessed artist is also tried the other way round', () => {
  const names = tidyNames({}, '/m/Got The Life - Korn.mp3');
  assert.deepStrictEqual(names, { artist: 'Got The Life', title: 'Korn', guessed: true });
  assert.deepStrictEqual(nameVariants(names), [
    { artist: 'Got The Life', title: 'Korn' },
    { artist: 'Korn', title: 'Got The Life' },
  ]);
  // A real artist tag is never swapped.
  assert.strictEqual(nameVariants({ artist: 'Korn', title: 'Got The Life', guessed: false }).length, 1);
});
