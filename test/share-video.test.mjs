import test from 'node:test';
import assert from 'node:assert';
import { videoLayout, frameA, lyricsAt, lyricLines, videoSpan, pickVideoType, VIDEO_SECONDS } from '../src/renderer/js/share-video.js';

const inside = (box, f) => box.x >= 0 && box.y >= 0 && box.x + box.w <= f.w && box.y + box.h <= f.h;
const apart = (a, b) => a.y + a.h <= b.y || b.y + b.h <= a.y || a.x + a.w <= b.x || b.x + b.w <= a.x;

test('a vertical and a square video: everything in the frame, nothing on top of anything else', () => {
  for (const format of ['9:16', '1:1']) {
    const l = videoLayout(format);
    assert.deepStrictEqual([l.w, l.h], format === '9:16' ? [1080, 1920] : [1080, 1080]);
    for (const part of ['art', 'names', 'lyrics']) assert.ok(inside(l[part], l), `${format} ${part}`);
    assert.ok(apart(l.art, l.names) && apart(l.art, l.lyrics) && apart(l.names, l.lyrics), format);
  }
  assert.strictEqual(VIDEO_SECONDS, 8);
});

test("each look's things in the frame and clear of each other: the open case, VISUALIZER's strip, HI-FI's display", () => {
  const looks = { case: { aspect: 2 * 142 / 125 }, strip: { strip: 64 }, display: { display: 340 } };
  for (const format of ['9:16', '1:1']) for (const [name, opts] of Object.entries(looks)) {
    const l = frameA(format, opts), parts = ['art', 'strip', 'names', 'lyrics', 'display'].filter((k) => l[k]);
    for (const k of parts) assert.ok(inside(l[k], l) && l[k].h > 0, `${format} ${name} ${k}`);
    for (const a of parts) for (const b of parts) if (a < b) assert.ok(apart(l[a], l[b]), `${format} ${name} ${a}/${b}`);
    if (name === 'case') assert.ok(Math.abs(l.art.w / l.art.h - 2 * 142 / 125) < 0.01, `${format} case proportions`);
  }
  // (the tall one keeps clear of a story's buttons, top and foot)
  const tall = videoLayout('9:16');
  assert.ok(tall.art.y >= 160 && tall.lyrics.y + tall.lyrics.h <= 1760);
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

test("the words as they're sung: a line timed as a whole shares its time out; enhanced LRC's syllables stay one word", () => {
  const lines = lyricLines([{ time: 1, text: 'Hello there' }, { time: 3.5, text: '' },
    { time: 5, text: 'beautiful day', words: [{ time: 5, text: 'beau' }, { time: 5.2, text: 'ti' }, { time: 5.4, text: 'ful ' }, { time: 6, text: 'day', end: 6.5 }] }]);
  assert.strictEqual(lines.length, 2); // (the break isn't a line)
  assert.deepStrictEqual(lines[0].words.map((w) => w.text), ['Hello', 'there']);
  assert.strictEqual(lines[0].end, 3.5);
  assert.ok(lines[0].words[0].time === 1 && lines[0].words[1].time > 1 && lines[0].words[1].stop <= 3.5);
  assert.deepStrictEqual(lines[1].words.map((w) => [w.text, w.parts.length, w.time]), [['beautiful', 3, 5], ['day', 1, 6]]);
  assert.strictEqual(lines[1].words[1].stop, 6.5);
  assert.deepStrictEqual(lyricLines([]), []);
});

test('how long a video runs: as long as the picked lines are sung', () => {
  const timed = [{ time: 1, text: 'Hello' }, { time: 3.5, text: '' }, { time: 5, text: 'World' }, { time: 7, text: 'Again' }];
  assert.deepStrictEqual(videoSpan(timed, [0], 200), { start: 1, end: 3.5 }); // to the break after it
  assert.deepStrictEqual(videoSpan(timed, [1], 200), { start: 5, end: 7 }); // indexes skip the blank line
  assert.deepStrictEqual(videoSpan(timed, [2, 0], 30), { start: 1, end: 30 }); // the last line runs to the song's end
  assert.deepStrictEqual(videoSpan(timed, [2], 0), { start: 7, end: 7 + VIDEO_SECONDS }); // its end unknown
  assert.deepStrictEqual(videoSpan([{ time: 1, text: 'a' }, { time: 1.5, text: 'b' }], [0], 9), { start: 1, end: 3 }); // 2 s at least
  assert.deepStrictEqual(videoSpan(timed, [0, 2], 500), { start: 1, end: 181 }); // three minutes at most
  assert.strictEqual(videoSpan(timed, [], 200), null);
  assert.strictEqual(videoSpan([], [0], 200), null);
});

test('MP4 when it can be recorded, WebM when not', () => {
  assert.deepStrictEqual(pickVideoType((t) => t.startsWith('video/mp4')), { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' });
  assert.deepStrictEqual(pickVideoType((t) => t.startsWith('video/webm')), { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' });
  assert.strictEqual(pickVideoType(() => false), null);
});

// A canvas that draws nothing and remembers how it was asked to: where a shadow is given a colour, whether it was
// also given its blur or offset (a statement lost after a comment on the same line once left the films' shadows hard).
function recordingCanvases() {
  const contexts = [];
  class FakeCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() {
      if (this.ctx) return this.ctx;
      const state = { shadowColor: 'rgba(0,0,0,0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 }, saved = [], hard = [];
      const shadowed = () => !/^(transparent|rgba\(\d+,\s*\d+,\s*\d+,\s*0\))$/.test(String(state.shadowColor));
      const draws = (name) => () => { if (shadowed() && !state.shadowBlur && !state.shadowOffsetX && !state.shadowOffsetY) hard.push(`${name} ${state.shadowColor}`); };
      const own = {
        canvas: this, hard,
        save: () => saved.push({ ...state }), restore: () => Object.assign(state, saved.pop() || {}),
        measureText: (t) => ({ width: String(t).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }),
        createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createConicGradient: () => ({ addColorStop() {} }),
        fill: draws('fill'), fillRect: draws('fillRect'), stroke: draws('stroke'), drawImage: draws('drawImage'), fillText: draws('fillText'),
      };
      contexts.push(own);
      this.ctx = new Proxy(own, {
        get: (o, k) => (k in state ? state[k] : k in o ? o[k] : () => {}),
        set: (o, k, v) => { if (k in state) state[k] = v; else o[k] = v; return true; },
      });
      return this.ctx;
    }
  }
  return { FakeCanvas, contexts };
}

test("every film's shadows, on a dark theme and a light one, are soft: none given a colour without its blur or offset", async () => {
  const { videoFrame } = await import('../src/renderer/js/share-video.js');
  const { THEMES } = await import('../src/renderer/js/theme.js');
  const { FakeCanvas, contexts } = recordingCanvases(), before = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeCanvas;
  try {
    for (const name of ['RED', 'WHITE']) {
      const th = THEMES.find((x) => x.name === name), colors = { bg: th.bg, card: th.card, accent: th.accent, accent2: th.accent2, text: th.text, muted: th.muted };
      for (const look of ['CLASSIC', 'ALBUM', 'CASE', 'HIFI', 'VISUALIZER', 'LYRICS', 'TERMINAL']) for (const format of ['1:1', '9:16']) {
        contexts.length = 0;
        const song = { cover: null, face: new FakeCanvas(474, 474), title: 'Song', artist: 'Artist', subtitle: 'Album', colors, look, track: 1,
          timed: [{ time: 10, text: 'First line of it' }, { time: 12, text: 'Second line' }], position: () => 11, spectrum: (n) => new Array(n).fill(0.4), levels: () => [0.4, 0.4] };
        videoFrame(format, song, 2.5);
        const hard = contexts.flatMap((c) => c.hard);
        assert.deepStrictEqual(hard, [], `${name} ${look} ${format}`);
      }
    }
  } finally { globalThis.OffscreenCanvas = before; }
});
