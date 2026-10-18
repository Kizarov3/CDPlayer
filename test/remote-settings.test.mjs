import test from 'node:test';
import assert from 'node:assert';
import { phoneLine, phoneTagTitle, phoneJoined, addressWords, errorWords } from '../src/renderer/js/remote-settings.js';

test('a phone line names the phone and the time it came, in the local clock', () => {
  assert.strictEqual(phoneLine({ name: 'iPhone', since: new Date(2026, 9, 17, 23, 10).getTime() }), 'iPhone · since 23:10');
  assert.strictEqual(phoneLine({ name: 'Android', since: new Date(2026, 9, 17, 7, 5).getTime() }), 'Android · since 07:05');
});

test('the PHONE tag’s tooltip names the phones, one name with a count when it repeats', () => {
  assert.strictEqual(phoneTagTitle([{ name: 'iPhone' }]), 'iPhone');
  assert.strictEqual(phoneTagTitle([{ name: 'iPhone' }, { name: 'Android' }]), 'iPhone, Android');
  assert.strictEqual(phoneTagTitle([{ name: 'iPhone' }, { name: 'iPhone' }]), 'iPhone ×2');
});

test('PHONE CONNECTED is said when the first phone comes: not for a second, not for one leaving, not at the first look', () => {
  assert.strictEqual(phoneJoined(0, 1), true);
  assert.strictEqual(phoneJoined(1, 2), false);
  assert.strictEqual(phoneJoined(2, 1), false);
  assert.strictEqual(phoneJoined(1, 0), false);
  assert.strictEqual(phoneJoined(0, 0), false);
  assert.strictEqual(phoneJoined(null, 1), false); // the first status heard, a phone already there: not news
});

test('the address in words, and the error in words', () => {
  assert.strictEqual(addressWords({ address: '192.168.1.20', port: 47800 }), '192.168.1.20:47800');
  assert.strictEqual(addressWords({ address: null, port: 47800 }), '');
  assert.match(errorWords('network'), /wi-fi/i);
  assert.match(errorWords('port'), /port/i);
  assert.strictEqual(errorWords(null), '');
});
