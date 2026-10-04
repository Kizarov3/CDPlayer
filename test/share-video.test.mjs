import test from 'node:test';
import assert from 'node:assert';
import { videoLayout, lyricsAt, videoSpan, pickVideoType, VIDEO_SECONDS } from '../src/renderer/js/share-video.js';

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
  const on = (at) => { const { current, next } = lyricsAt(timed, at); return { current, next }; };
  assert.deepStrictEqual(on(0), { current: null, next: 'Hello' });
  assert.deepStrictEqual(on(2), { current: 'Hello', next: 'World' });
  assert.deepStrictEqual(on(4), { current: null, next: 'World' }); // a break
  assert.deepStrictEqual(on(7.5), { current: 'Again', next: null });
  assert.deepStrictEqual(lyricsAt([], 3), { current: null, next: null, previous: null, since: Infinity });
});

test('what the lines glide from: the line sung before, and how long ago the line changed', () => {
  const timed = [{ time: 1, text: 'Hello' }, { time: 3.5, text: '' }, { time: 5, text: 'World' }, { time: 7, text: 'Again' }];
  const from = (at) => { const { previous, since } = lyricsAt(timed, at); return { previous, since }; };
  assert.deepStrictEqual(from(0), { previous: null, since: Infinity });
  assert.deepStrictEqual(from(1.25), { previous: null, since: 0.25 });
  assert.deepStrictEqual(from(4), { previous: 'Hello', since: 0.5 }); // into a break
  assert.deepStrictEqual(from(5.5), { previous: null, since: 0.5 }); // out of one
  assert.deepStrictEqual(from(7.5), { previous: 'World', since: 0.5 });
});

test('how long a video runs: as long as the picked lines are sung', () => {
  const timed = [{ time: 1, text: 'Hello' }, { time: 3.5, text: '' }, { time: 5, text: 'World' }, { time: 7, text: 'Again' }];
  assert.deepStrictEqual(videoSpan(timed, [0], 200), { start: 1, end: 3.5 }); // to the break after it
  assert.deepStrictEqual(videoSpan(timed, [1], 200), { start: 5, end: 7 }); // indexes skip the blank line
  assert.deepStrictEqual(videoSpan(timed, [2, 0], 30), { start: 1, end: 30 }); // the last line runs to the song's end
  assert.deepStrictEqual(videoSpan(timed, [2], 0), { start: 7, end: 7 + VIDEO_SECONDS }); // its end unknown
  assert.deepStrictEqual(videoSpan([{ time: 1, text: 'a' }, { time: 1.5, text: 'b' }], [0], 9), { start: 1, end: 3 }); // 2 s at least
  assert.deepStrictEqual(videoSpan(timed, [0, 2], 500), { start: 1, end: 61 }); // a minute at most
  assert.strictEqual(videoSpan(timed, [], 200), null);
  assert.strictEqual(videoSpan([], [0], 200), null);
});

test('MP4 when it can be recorded, WebM when not', () => {
  assert.deepStrictEqual(pickVideoType((t) => t.startsWith('video/mp4')), { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' });
  assert.deepStrictEqual(pickVideoType((t) => t.startsWith('video/webm')), { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' });
  assert.strictEqual(pickVideoType(() => false), null);
});
