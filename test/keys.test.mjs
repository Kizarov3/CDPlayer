import test from 'node:test';
import assert from 'node:assert';
import { shortcutKey } from '../src/renderer/js/keys.js';

test('Latin letters are taken as typed (so AZERTY/Dvorak users get their own letters)', () => {
  assert.strictEqual(shortcutKey({ key: 'L', code: 'KeyL' }), 'l');
  assert.strictEqual(shortcutKey({ key: 'm', code: 'Semicolon' }), 'm'); // AZERTY M
});

test('non-Latin layouts fall back to the physical key (Russian J/K/L type о/л/д)', () => {
  assert.strictEqual(shortcutKey({ key: 'о', code: 'KeyJ' }), 'j');
  assert.strictEqual(shortcutKey({ key: 'л', code: 'KeyK' }), 'k');
  assert.strictEqual(shortcutKey({ key: 'д', code: 'KeyL' }), 'l');
  assert.strictEqual(shortcutKey({ key: 'ь', code: 'KeyM' }), 'm');
});

test('space and named keys pass through', () => {
  assert.strictEqual(shortcutKey({ key: ' ', code: 'Space' }), ' ');
  assert.strictEqual(shortcutKey({ key: 'ArrowLeft', code: 'ArrowLeft' }), 'ArrowLeft');
});
