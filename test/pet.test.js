'use strict';
const test = require('node:test');
const assert = require('node:assert');
const pet = require('../src/main/pet');

const DAY = 86400e3, HOUR = 3600e3;
const NOW = new Date(2026, 10, 17, 15, 0).getTime();
// stats as evolve wants them, with nothing heard
const quiet = (over = {}) => ({ hours: 0, hoursSince: 0, throughSince: 0, albums: 0, maxOne: 0, favourite: null, days: 0, lastAlbum: null, month: { plays: 0, night: 0, morning: 0, topShare: 0, artists: 0, firsts: 0 }, ...over });
const fixed = () => 0.5; // the temper picked: always the same one

test('parse garbage: a fresh egg, no throw', () => {
  for (const text of ['{', '', null, '[]', '{"version":2}']) {
    const p = pet.parse(text, 5, fixed);
    assert.strictEqual(p.stage, 'egg');
    assert.strictEqual(p.name, 'BLIP');
    assert.strictEqual(p.since, 5);
  }
});

test('parse round-trip keeps it as it was (turned off and on again: no new egg)', () => {
  const p = { ...pet.empty(NOW, fixed), stage: 'kid', hatchedAt: NOW - DAY, name: 'MOOF', found: { ghost: NOW }, items: { crown: NOW } };
  assert.deepStrictEqual(pet.parse(pet.format(p), NOW + DAY), p);
  assert.ok(pet.TEMPERS.includes(p.temper));
});

test('hatch by an album played through since it was turned on', () => {
  const { pet: p, events } = pet.evolve(pet.empty(NOW - HOUR, fixed), quiet({ throughSince: 1, lastAlbum: 'In Rainbows' }), NOW);
  assert.strictEqual(p.stage, 'baby');
  assert.strictEqual(p.hatchedAt, NOW);
  assert.strictEqual(p.hatchAlbum, 'In Rainbows');
  assert.deepStrictEqual(events.map((e) => e.kind), ['hatch']);
});

test('hatch by an hour of listening since it was turned on', () => {
  const { pet: p } = pet.evolve(pet.empty(NOW - 2 * HOUR, fixed), quiet({ hoursSince: 1 }), NOW);
  assert.strictEqual(p.stage, 'baby');
  const still = pet.evolve(pet.empty(NOW, fixed), quiet({ hoursSince: 0.9 }), NOW).pet;
  assert.strictEqual(still.stage, 'egg');
});

test('imported history: an egg first, then a growth spurt to TEEN at most, items it earned, no molt', () => {
  const lots = quiet({ hours: 400, albums: 50, maxOne: 6, days: 90, month: { plays: 900, night: 0.6, morning: 0, topShare: 0.1, artists: 40, firsts: 10 } });
  const egg = pet.evolve(pet.empty(NOW, fixed), lots, NOW);
  assert.strictEqual(egg.pet.stage, 'egg');
  assert.deepStrictEqual(egg.events, []);
  const { pet: p, events } = pet.evolve(egg.pet, { ...lots, throughSince: 1 }, NOW + HOUR);
  assert.strictEqual(p.stage, 'teen');
  assert.strictEqual(p.form, null);
  assert.deepStrictEqual(events.map((e) => e.kind), ['hatch', 'grow', 'item', 'item', 'item', 'item']);
  assert.deepStrictEqual(Object.keys(p.items).sort(), ['crown', 'headphones', 'record', 'scarf']);
});

test('adult at the month change, its form from the last 30 days', () => {
  const hatched = { ...pet.empty(NOW - 40 * DAY, fixed), stage: 'teen', hatchedAt: NOW - 31 * DAY, lastMolt: '2026-10' };
  const month = { plays: 300, night: 0.5, morning: 0, topShare: 0.2, artists: 10, firsts: 3 };
  const { pet: p, events } = pet.evolve(hatched, quiet({ hours: 60, month }), NOW);
  assert.strictEqual(p.stage, 'adult');
  assert.strictEqual(p.form, 'owl');
  assert.strictEqual(p.lastMolt, '2026-11');
  assert.ok(p.found.owl);
  assert.deepStrictEqual(events.find((e) => e.kind === 'molt'), { kind: 'molt', from: null, to: 'owl' });
  // not again this month, whatever the month says now
  const again = pet.evolve(p, quiet({ hours: 61, month: { ...month, night: 0, artists: 30 } }), NOW + DAY);
  assert.strictEqual(again.pet.form, 'owl');
  assert.ok(!again.events.some((e) => e.kind === 'molt'));
});

test('not adult before 30 days since hatching, nor before 50 hours', () => {
  const young = { ...pet.empty(NOW - 40 * DAY, fixed), stage: 'teen', hatchedAt: NOW - 10 * DAY };
  assert.strictEqual(pet.evolve(young, quiet({ hours: 200 }), NOW).pet.stage, 'teen');
  const light = { ...young, hatchedAt: NOW - 60 * DAY };
  assert.strictEqual(pet.evolve(light, quiet({ hours: 40 }), NOW).pet.stage, 'teen');
});

test('habit forms, first match wins', () => {
  const m = (o) => ({ plays: 100, night: 0, morning: 0, topShare: 0, artists: 0, firsts: 0, ...o });
  assert.strictEqual(pet.habitForm(m({ night: 0.4, artists: 30 })), 'owl');
  assert.strictEqual(pet.habitForm(m({ morning: 0.45 })), 'bird');
  assert.strictEqual(pet.habitForm(m({ topShare: 0.4 })), 'loyalist');
  assert.strictEqual(pet.habitForm(m({ firsts: 50, artists: 30 })), 'explorer');
  assert.strictEqual(pet.habitForm(m({ artists: 30 })), 'raver');
  assert.strictEqual(pet.habitForm(m({})), 'collector');
});

test('items at their thresholds, each earned once', () => {
  const baby = { ...pet.empty(NOW - DAY, fixed), stage: 'baby', hatchedAt: NOW - DAY };
  const run = (s) => pet.evolve(baby, quiet(s), NOW).pet.items;
  assert.ok(!run({ albums: 9 }).crown);
  assert.ok(run({ albums: 10 }).crown);
  assert.ok(run({ maxOne: 5 }).record);
  assert.ok(!run({ hours: 99 }).headphones);
  assert.ok(run({ hours: 100 }).headphones);
  assert.ok(run({ days: 7 }).scarf);
  const once = pet.evolve({ ...baby, items: { crown: 1 } }, quiet({ albums: 20 }), NOW);
  assert.strictEqual(once.pet.items.crown, 1);
  assert.ok(!once.events.some((e) => e.kind === 'item'));
});

test('ghost: found when a hidden track is found; shown when adult; kept for later while still an egg', () => {
  const adult = { ...pet.empty(NOW - 90 * DAY, fixed), stage: 'adult', hatchedAt: NOW - 60 * DAY, form: 'raver', lastMolt: '2026-11', found: { raver: 1 } };
  const { pet: p, events } = pet.evolve(adult, quiet({ hours: 80 }), NOW, { hidden: true });
  assert.ok(p.found.ghost);
  assert.strictEqual(p.chosen, 'ghost');
  assert.deepStrictEqual(events, [{ kind: 'found', form: 'ghost' }]);
  assert.deepStrictEqual(pet.shown(p, NOW).form, 'ghost');
  const egg = pet.evolve(pet.empty(NOW, fixed), quiet(), NOW, { hidden: true }).pet;
  assert.ok(!egg.found.ghost);
  const hatched = pet.evolve(egg, quiet({ throughSince: 1 }), NOW + HOUR);
  assert.ok(hatched.pet.found.ghost);
});

test('echo: the same song on the same day, a year before', () => {
  const lastYear = new Date(2025, 10, 17, 9).getTime();
  const list = [[lastYear, '/a.mp3'], [new Date(2025, 10, 18).getTime(), '/b.mp3']];
  assert.strictEqual(pet.isEcho(list, '/a.mp3', NOW), true);
  assert.strictEqual(pet.isEcho(list, '/b.mp3', NOW), false);
  assert.strictEqual(pet.isEcho([[new Date(2024, 10, 17).getTime(), '/a.mp3']], '/a.mp3', NOW), false);
});

test('stats: hours, days, month shares, favourite; a song not on the shelf counts for hours', () => {
  const at = (d, h) => NOW - d * DAY + (h - 15) * HOUR;
  const list = [[at(1, 23), '/x/1.mp3'], [at(2, 23), '/x/2.mp3'], [at(2, 10), '/y/1.mp3'], [at(40, 10), '/stream'], [NOW - 30 * 60e3, '/x/1.mp3']];
  const albums = { '/x/1.mp3': { id: 'X', title: 'X Album', artist: 'Xer' }, '/x/2.mp3': { id: 'X', title: 'X Album', artist: 'Xer' }, '/y/1.mp3': { id: 'Y', title: 'Y', artist: 'Various Artists' } };
  const s = pet.stats({
    list, seconds: (p) => (p === '/stream' ? 0 : 1800), through: { X: { n: 3, last: NOW - HOUR }, Y: { n: 1, last: NOW - 50 * DAY } },
    albumOf: (p) => albums[p] || null, album: (id) => (id === 'X' ? { title: 'X Album', paths: ['/x/1.mp3', '/x/2.mp3'] } : null),
    firsts: new Map([['/y/1.mp3', at(2, 10)]]), since: NOW - 2 * HOUR, now: NOW,
  });
  assert.strictEqual(s.hours, (4 * 1800 + 240) / 3600);
  assert.strictEqual(s.hoursSince, 0.5);
  assert.strictEqual(s.throughSince, 1);
  assert.strictEqual(s.albums, 4);
  assert.strictEqual(s.maxOne, 3);
  assert.deepStrictEqual(s.favourite, { id: 'X', title: 'X Album', paths: ['/x/1.mp3', '/x/2.mp3'] });
  assert.strictEqual(s.days, 4);
  assert.strictEqual(s.month.plays, 4);
  assert.strictEqual(s.month.night, 0.5);
  assert.strictEqual(s.month.artists, 1);
  assert.strictEqual(s.month.topShare, 0.75);
  assert.strictEqual(s.month.firsts, 1);
  assert.strictEqual(s.lastAlbum, 'X Album');
});

test('shown: the stage until adult, the chosen form after; the party hat on its hatch day', () => {
  const p = { ...pet.empty(NOW, fixed), stage: 'kid', hatchedAt: new Date(2025, 10, 17).getTime(), worn: 'crown' };
  assert.deepStrictEqual(pet.shown(p, NOW), { stage: 'kid', form: 'kid', item: 'party' });
  assert.deepStrictEqual(pet.shown(p, NOW + DAY), { stage: 'kid', form: 'kid', item: 'crown' });
  const adult = { ...p, stage: 'adult', form: 'owl', chosen: 'raver', found: { owl: 1 } };
  assert.strictEqual(pet.shown(adult, NOW + DAY).form, 'owl'); // (a form not found can't be chosen)
  assert.strictEqual(pet.shown({ ...adult, found: { owl: 1, raver: 2 } }, NOW + DAY).form, 'raver');
});
