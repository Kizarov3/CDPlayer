import test from 'node:test';
import assert from 'node:assert';
import { videoLayout, lyricsAt, pickVideoType, VIDEO_SECONDS } from '../src/renderer/js/share-video.js';

const inside = (box, f) => box.x >= 0 && box.y >= 0 && box.x + box.w <= f.w && box.y + box.h <= f.h;
const apart = (a, b) => a.y + a.h <= b.y || b.y + b.h <= a.y || a.x + a.w <= b.x || b.x + b.w <= a.x;

test('a vertical and a square video: everything in the frame, nothing on top of anything else', () => {
  for (const format of ['9:16', '1:1']) {
    const l = videoLayout(format);
    assert.deepStrictEqual([l.w, l.h], format === '9:16' ? [1080, 1920] : [1080, 1080]);
    for (const part of ['case', 'names', 'lyrics']) assert.ok(inside(l[part], l), `${format} ${part}`);
    assert.ok(apart(l.case, l.names) && apart(l.case, l.lyrics) && apart(l.names, l.lyrics), format);
  }
  assert.strictEqual(VIDEO_SECONDS, 8);
});

test('the lyrics on screen at a moment: the line being sung, and the next', () => {
  const timed = [{ time: 1, text: 'Hello' }, { time: 3.5, text: '' }, { time: 5, text: 'World' }, { time: 7, text: 'Again' }];
  assert.deepStrictEqual(lyricsAt(timed, 0), { current: null, next: 'Hello' });
  assert.deepStrictEqual(lyricsAt(timed, 2), { current: 'Hello', next: 'World' });
  assert.deepStrictEqual(lyricsAt(timed, 4), { current: null, next: 'World' }); // a break
  assert.deepStrictEqual(lyricsAt(timed, 7.5), { current: 'Again', next: null });
  assert.deepStrictEqual(lyricsAt([], 3), { current: null, next: null });
});

test('MP4 when it can be recorded, WebM when not', () => {
  assert.deepStrictEqual(pickVideoType((t) => t.startsWith('video/mp4')), { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' });
  assert.deepStrictEqual(pickVideoType((t) => t.startsWith('video/webm')), { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' });
  assert.strictEqual(pickVideoType(() => false), null);
});
