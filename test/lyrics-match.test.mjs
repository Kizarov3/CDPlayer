import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const { sameSong, sameLyricsSong } = createRequire(import.meta.url)('../src/main/online.js');

test('a Latin letter with an accent or slash is the same letter: BLØOD is BLOOD, Beyoncé is Beyonce', () => {
  assert.ok(sameSong({ title: 'BLØOD', artist: 'lynch.' }, 'Lynch', 'BLOOD'));
  assert.ok(sameSong({ title: 'Halo', artist: 'Beyonce' }, 'Beyoncé', 'Halo'));
});

test('lyrics: a hit whose own title is mostly other words is another song', () => {
  assert.ok(!sameLyricsSong({ title: 'Blood on da Rug', artist: 'Brotha Lynch Hung' }, 'Lynch', 'BLOOD'));
  assert.ok(sameLyricsSong({ title: 'BLØOD', artist: 'lynch.' }, 'Lynch', 'BLOOD'));
  assert.ok(sameLyricsSong({ title: 'Song Name (Remastered 2011)', artist: 'Band' }, 'Band', 'Song Name'));
});
