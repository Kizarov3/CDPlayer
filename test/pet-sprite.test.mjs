import test from 'node:test';
import assert from 'node:assert';
import { frame, termRows, termPet, W, H, POSES, FORMS, REACTIONS } from '../src/renderer/js/pet-sprite.js';

const ok = (g) => g.length === H && g.every((row) => row.length === W && row.every((v) => v === 0 || v === 1));
const lit = (g) => g.flat().reduce((a, b) => a + b, 0);

test('every pose of every form is a 25×16 grid of dots', () => {
  for (const form of FORMS) for (const pose of POSES) for (const t of [0, 1, 7, 23, 50]) {
    const g = frame(t, { pose, form, item: 'crown', level: 0.6 });
    assert.ok(ok(g), `${pose} ${form} ${t}`);
  }
});

test('every reaction draws, and the eject has it gone for a moment', () => {
  for (const react of REACTIONS) for (const ms of [0, 300, 900, 2000]) assert.ok(ok(frame(0, { pose: 'paused', form: 'teen', react, reactMs: ms })));
  assert.strictEqual(lit(frame(0, { pose: 'paused', form: 'teen', react: 'eject', reactMs: 1500 })), 0);
});

test('the egg paused is there; items and forms change the dots', () => {
  assert.ok(lit(frame(0, { pose: 'paused', form: 'egg' })) > 50);
  const plain = frame(0, { pose: 'paused', form: 'raver' }), crowned = frame(0, { pose: 'paused', form: 'raver', item: 'crown' });
  assert.notDeepStrictEqual(plain, crowned);
  assert.notDeepStrictEqual(frame(0, { pose: 'paused', form: 'owl' }), plain);
});

test('the eyes follow `look`', () => {
  assert.notDeepStrictEqual(frame(0, { pose: 'paused', form: 'kid', look: 1 }), frame(0, { pose: 'paused', form: 'kid', look: -1 }));
});

test('TERMINAL: two rows of dots to a character, 8 lines of 25', () => {
  const rows = termRows(frame(0, { pose: 'paused', form: 'collector' }));
  assert.strictEqual(rows.length, 8);
  assert.ok(rows.every((r) => [...r].length === 25 && /^[ ▀▄█]+$/.test(r)));
  assert.ok(rows.join('').includes('█'));
});

test('TERMINAL glyphs: 3 lines of 13 cells for every pose, form and reaction, a tone for each cell', () => {
  const fine = (p) => p.rows.length === 3 && p.rows.every((r, i) => [...r].length === 13 && [...p.tones[i]].length === 13 && /^[am ]+$/.test(p.tones[i]));
  for (const form of FORMS) for (const pose of POSES) for (const t of [0, 1, 5, 13, 23, 40, 60]) assert.ok(fine(termPet(t, { pose, form, item: 'crown', level: 0.6 })), `${pose} ${form} ${t}`);
  for (const react of REACTIONS) for (const ms of [0, 300, 900, 2000]) assert.ok(fine(termPet(0, { form: 'kid', react, reactMs: ms })), react);
  const face = (o) => termPet(0, { pose: 'paused', form: 'kid', ...o }).rows[1];
  assert.match(face({}), /o o/);
  assert.notStrictEqual(face({ look: 1 }), face({ look: -1 }));
  assert.match(termPet(0, { form: 'kid', react: 'skip', reactMs: 0 }).rows[1], /@ @/);
  assert.notStrictEqual(termPet(0, { pose: 'paused', form: 'raver' }).rows[1], face({}));
  assert.strictEqual(termPet(0, { form: 'kid', react: 'eject', reactMs: 1500 }).rows.join('').trim(), '');
  const crowned = termPet(0, { pose: 'paused', form: 'kid', item: 'crown' });
  assert.notStrictEqual(crowned.rows[0], termPet(0, { pose: 'paused', form: 'kid' }).rows[0]);
  assert.ok(crowned.tones[0].includes('a'), 'what it wears is in the accent');
});
