'use strict';
// Word-timed lyrics from NetEase Music (YRC), against canned answers (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { yrcToLrc, neteaseLyrics } = require('../src/main/netease');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

// The real start of NetEase's YRC for Radiohead – Knives Out: two credit lines, then the song.
const YRC = [
  '{"t":0,"c":[{"tx":"作词: "},{"tx":"Thom Yorke"}]}',
  '[5090,180](5090,90,0)Knives (5180,90,0)Out',
  '[5270,270](5270,270,0)Radiohead',
  '[19160,7770](19160,210,0)I (19370,1920,0)want (21290,1440,0)you (22730,120,0)to (22850,4080,0)know',
  '[27900,7740](27900,300,0)He\'s (28200,1650,0)not (29850,1800,0)coming (33000,2640,0)back',
].join('\n');

test('YRC becomes word-timed LRC: each word from its start for its length, pauses and the line end stamped, credits left out', () => {
  assert.strictEqual(yrcToLrc(YRC, { title: 'Knives Out', artist: 'Radiohead' }),
    '[00:19.16]<00:19.16>I <00:19.37>want <00:21.29>you <00:22.73>to <00:22.85>know<00:26.93>\n' +
    "[00:27.90]<00:27.90>He's <00:28.20>not <00:29.85>coming <00:31.65> <00:33.00>back<00:35.64>");
  assert.strictEqual(yrcToLrc('', {}), '');
});

const realFetch = global.fetch;
let asked = [];
function answer({ songs = [], yrc = null, fail = false }) {
  asked = [];
  global.fetch = async (url) => {
    asked.push(String(url));
    if (fail) throw new Error('The operation was aborted due to timeout');
    const body = /search/.test(url) ? { result: { songs } } : { code: 200, lrc: { lyric: '[00:19.16]I want you to know' }, ...(yrc ? { yrc: { lyric: yrc } } : {}) };
    return { ok: true, status: 200, json: async () => body };
  };
}
test.after(() => { global.fetch = realFetch; });
const song = (id, name, artist, seconds) => ({ id, name, artists: [{ name: artist }], album: { name: 'Amnesiac' }, duration: seconds * 1000 });

test('the song that is this one, as long as the file: its word-timed lyrics', async () => {
  answer({ songs: [song(1, 'Knives Out (Hollywood)', 'Radiohead', 271.4), song(2, 'Knives Out', 'Radiohead', 254.9)], yrc: YRC });
  const lyrics = await neteaseLyrics({ artist: 'Radiohead', title: 'Knives Out', duration: 254.9 });
  assert.match(lyrics, /^\[00:19\.16\]<00:19\.16>I /);
  assert.ok(asked.some((u) => /lyric.*id=2/.test(u)), 'the studio version, not the live one');
});

test('another song, another length, or no word timing: nothing', async () => {
  answer({ songs: [song(3, 'Karma Police', 'Radiohead', 264)], yrc: YRC });
  assert.strictEqual(await neteaseLyrics({ artist: 'Radiohead', title: 'Knives Out', duration: 254.9 }), null);
  answer({ songs: [song(2, 'Knives Out', 'Radiohead', 240)], yrc: YRC });
  assert.strictEqual(await neteaseLyrics({ artist: 'Radiohead', title: 'Knives Out', duration: 254.9 }), null);
  answer({ songs: [song(2, 'Knives Out', 'Radiohead', 254.9)], yrc: null });
  assert.strictEqual(await neteaseLyrics({ artist: 'Radiohead', title: 'Knives Out', duration: 254.9 }), null);
});

test('NetEase unreachable: reported, so it is not asked again', async () => {
  answer({ fail: true });
  assert.strictEqual(await neteaseLyrics({ artist: 'Radiohead', title: 'Knives Out', duration: 254.9 }), neteaseLyrics.UNREACHABLE);
});
