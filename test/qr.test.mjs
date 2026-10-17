import test from 'node:test';
import assert from 'node:assert/strict';
import { QrCode, Ecc, qrSvg } from '../src/renderer/js/qr.js';

const URL = 'http://192.168.1.20:47800/pair?k=' + 'A'.repeat(22);

test('Hello, world! at LOW is a 21-module version 1 code (Nayuki example)', () => {
  const qr = QrCode.encodeText('Hello, world!', Ecc.LOW);
  assert.equal(qr.size, 21);
  assert.equal(qr.version, 1);
  // A finder pattern opens the first row: seven dark modules, then the light separator
  const row0 = Array.from({ length: 8 }, (_, x) => qr.getModule(x, 0));
  assert.deepEqual(row0, [true, true, true, true, true, true, true, false]);
});

test('the pairing URL makes a version 4 or 5 code', () => {
  const qr = QrCode.encodeText(URL, Ecc.MEDIUM);
  assert.ok(qr.size === 33 || qr.size === 37, `size ${qr.size}`);
});

test('the three finder patterns sit in the corners', () => {
  const qr = QrCode.encodeText(URL, Ecc.MEDIUM);
  const ring = (ox, oy) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        assert.equal(qr.getModule(ox + dx, oy + dy), edge || core, `(${ox + dx},${oy + dy})`);
      }
    }
  };
  ring(0, 0);
  ring(qr.size - 7, 0);
  ring(0, qr.size - 7);
});

test('qrSvg is a single-path svg with a quiet zone, and deterministic', () => {
  const svg = qrSvg(URL);
  assert.equal(svg, qrSvg(URL));
  const size = QrCode.encodeText(URL, Ecc.MEDIUM).size;
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes(`viewBox="0 0 ${size + 8} ${size + 8}"`));
  assert.equal((svg.match(/<path /g) || []).length, 1);
  assert.ok(qrSvg(URL, { border: 0 }).includes(`viewBox="0 0 ${size} ${size}"`));
});

test('non-ASCII text encodes as UTF-8 bytes', () => {
  assert.ok(QrCode.encodeText('Привет', Ecc.LOW).size >= 21);
});
