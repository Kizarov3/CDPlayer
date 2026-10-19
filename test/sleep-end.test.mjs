import test from 'node:test';
import assert from 'node:assert';
import { discEndsAfter } from '../src/renderer/js/sleep-end.js';

const at = (current, next, extra = {}) => discEndsAfter({ current, next, currentIndex: 0, nextIndex: next ? 1 : -1, ...extra });

test('END OF DISC in the queue: the disc is the folder its songs are in', () => {
  assert.strictEqual(at('/m/Kid A/01.flac', '/m/Kid A/02.flac'), false);
  assert.strictEqual(at('/m/Kid A/10.flac', '/m/Amnesiac/01.flac'), true);
  assert.strictEqual(at('C:\\m\\Kid A\\01.flac', 'C:\\m\\Kid A\\02.flac'), false, 'Windows paths');
  assert.strictEqual(at('/m/FtL/CD1/13.flac', '/m/FtL/CD2/01.flac'), true, 'CD1 and CD2 are two discs');
  assert.strictEqual(at('/m/Live/live.cue#3', '/m/Live/live.cue#4'), false, 'cue sheet tracks of one file');
  assert.strictEqual(at('spotify:track:a', 'spotify:track:b'), false, 'a Spotify queue is one disc');
  assert.strictEqual(at('/m/Kid A/10.flac', null), true, 'the end of the queue');
});

test('END OF DISC: the same song again or the queue starting over ends it; shuffled, only another disc does', () => {
  assert.strictEqual(at('/m/A/01.flac', '/m/A/02.flac', { repeatTrack: true }), true);
  assert.strictEqual(discEndsAfter({ current: '/m/A/10.flac', next: '/m/A/01.flac', currentIndex: 9, nextIndex: 0 }), true, 'REPEAT ALL wrapping round');
  assert.strictEqual(discEndsAfter({ current: '/m/A/10.flac', next: '/m/A/01.flac', currentIndex: 9, nextIndex: 0, shuffled: true }), false);
  assert.strictEqual(at('/m/A/03.flac', '/m/B/07.flac', { shuffled: true }), false, 'a shuffled queue is one disc: it plays to its end');
});

test('END OF DISC in the changer: the disc is its slot', () => {
  assert.strictEqual(at('/m/A/01.flac', '/m/B/01.flac', { currentSlot: 2, nextSlot: 2 }), false, 'one slot, whatever the folders');
  assert.strictEqual(at('/m/A/01.flac', '/m/A/02.flac', { currentSlot: 2, nextSlot: 3 }), true);
});
