'use strict';
// BLIP stays quick with years of history, on any machine: what it does per play is counted (songs looked at, lengths
// asked for), not timed — a slow CI runner or a virtual machine gives the same counts.
const test = require('node:test');
const assert = require('node:assert');
const pet = require('../src/main/pet');
const listens = require('../src/main/listens');

const DAY = 86400e3, NOW = new Date(2026, 10, 17, 15, 0).getTime();
const N = listens.LIMIT; // the most the log keeps
const history = () => { const list = []; for (let i = 0; i < N; i++) list.push([NOW - (N - i) * 600e3, `/m/a${i % 3000}/t${i % 12}.flac`]); return list; };
// a list that counts how many of its plays are looked at
function counted(list) {
  const seen = { n: 0 };
  const proxy = new Proxy(list, { get(target, key, recv) { if (typeof key === 'string' && /^\d+$/.test(key)) seen.n++; return Reflect.get(target, key, recv); } });
  return { proxy, seen };
}
const album = { id: 'x', title: 'X', artist: 'Y', paths: [], seconds: [] };
// (one song-length lookup for all of them, as main has: a memo is kept for the same lookup)
const calls = { seconds: 0 }, seconds = () => { calls.seconds++; return 200; };
const argsFor = (list, over = {}) => ({ calls, args: { list, seconds, through: {}, albumOf: () => album, album: () => album, firsts: new Map(), since: NOW - 400 * DAY, now: NOW, ...over } });
const inMonth = (list, now) => list.filter(([at]) => at >= now - 30 * DAY && at <= now).length;

test('a play with years of history: only the new play, and the last 30 days, are read again — the same answer as reading it all', () => {
  const list = history(), memo = {}, { proxy, seen } = counted(list);
  pet.stats(argsFor(proxy).args, memo);
  list.push([NOW + 1000, '/m/new/song.flac']);
  seen.n = 0; calls.seconds = 0;
  const quick = pet.stats(argsFor(proxy, { now: NOW + 2000 }).args, memo);
  assert.strictEqual(calls.seconds, 1, 'one song length asked for: the new one');
  assert.ok(seen.n <= inMonth(list, NOW + 2000) + 64, `${seen.n} plays read`);
  assert.deepStrictEqual(quick, pet.stats(argsFor(list, { now: NOW + 2000 }).args));
});

test('the history changed under it (the oldest trimmed, an import in the middle, songs moved): read anew, never a stale answer', () => {
  const memo = {}, list = history();
  pet.stats(argsFor(list).args, memo);
  const fresh = (l) => pet.stats(argsFor(l).args);
  list.splice(0, 10); // trimmed
  assert.deepStrictEqual(pet.stats(argsFor(list).args, memo), fresh(list));
  list.push([NOW - 3 * DAY + 7, '/m/old.flac']); list.sort((a, b) => a[0] - b[0]); // imported, in its place
  assert.deepStrictEqual(pet.stats(argsFor(list).args, memo), fresh(list));
  const moved = list.map(([at, p]) => [at, p.replace('/m/', '/n/')]); // moved: a new list
  assert.deepStrictEqual(pet.stats(argsFor(moved).args, memo), fresh(moved));
  assert.deepStrictEqual(pet.stats(argsFor(moved, { since: NOW - DAY }).args, memo), pet.stats(argsFor(moved, { since: NOW - DAY }).args), 'a new egg (since) reads anew');
});

test('days counted the same quick way across a clock change (the day boundaries are local)', () => {
  const list = [];
  for (let at = new Date(2026, 2, 20).getTime(); at < new Date(2026, 3, 10).getTime(); at += 5 * 3600e3) list.push([at, '/s.flac']);
  const days = new Set(list.map(([at]) => new Date(at).toDateString())).size;
  assert.strictEqual(pet.stats(argsFor(list, { now: new Date(2026, 3, 10).getTime() }).args).days, days);
});

test('ECHO: a year ago today is found in a handful of looks, not by reading the whole history', () => {
  const list = history(), yearAgo = new Date(NOW); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const i = list.findIndex(([at]) => at >= yearAgo.getTime());
  const song = list[i + 2][1];
  const { proxy, seen } = counted(list);
  assert.strictEqual(pet.isEcho(proxy, song, NOW), true);
  assert.ok(seen.n < 400, `${seen.n} plays read`);
  assert.strictEqual(pet.isEcho(list, '/never/played.flac', NOW), false);
});
