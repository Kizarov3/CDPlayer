'use strict';
// Word-timed lyrics from Kugou (KRC), against canned answers (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { krcToLrc, decodeKrc, kugouLyrics } = require('../src/main/kugou');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

// The real start of Kugou's KRC for Sevendust – Denial: headers, a credit line, then the song.
const KRC = [
  '[ti:Denial]', '[ar:Sevendust]', '[offset:0]', '[language:eyJjb250ZW50IjogW119]',
  '[0,44980]<0,8996,0>Denial<8996,8996,0> <17992,8996,0>-<26988,8996,0> <35984,8996,0>Sevendust',
  '[44980,1310]<0,120,0>What <120,190,0>- <310,120,0>never <430,260,0>say <690,240,0>what <930,190,0>you <1120,190,0>mean',
  '[55090,3070]<0,330,0>Let&apos;s <330,180,0>don&apos;t <510,240,0>stop',
  '[63340,4560]<0,190,0>Denial <190,1000,0>seems <1190,430,0>it <1620,500,0>had <2120,560,0>to <2680,1880,0>come',
  '[72510,17660]<0,380,0>Denial <380,430,0>has <810,310,0>left <1120,690,0>you <1810,560,0>all <2370,15290,0>alone',
].join('\r\n');

// Kugou's packing: "krc1", then the zlib-deflated text XOR-ed with a fixed key, as base64.
const KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
const pack = (text) => {
  const z = zlib.deflateSync(Buffer.from(text, 'utf8'));
  return Buffer.concat([Buffer.from('krc1'), Buffer.from(z.map((b, i) => b ^ KEY[i % 16]))]).toString('base64');
};

test('KRC is unpacked: base64, the key, then inflated', () => {
  assert.strictEqual(decodeKrc(pack(KRC)), KRC);
  assert.strictEqual(decodeKrc('not krc'), '');
});

test('KRC becomes word-timed LRC: each word from its line for its length, dashes and the credit line left out, a held note cut short', () => {
  const lrc = krcToLrc(KRC, { title: 'Denial', artist: 'Sevendust' }).split('\n');
  assert.strictEqual(lrc.length, 4);
  assert.strictEqual(lrc[0], '[00:44.98]<00:44.98>What <00:45.29>never <00:45.41>say <00:45.67>what <00:45.91>you <00:46.10>mean<00:46.29>');
  assert.strictEqual(lrc[1], "[00:55.09]<00:55.09>Let's <00:55.42>don't <00:55.60>stop<00:55.84> <00:58.16>");
  assert.strictEqual(lrc[2], '[01:03.34]<01:03.34>Denial <01:03.53>seems <01:04.53>it <01:04.96>had <01:05.46>to <01:06.02>come<01:07.90>');
  // "alone" is marked as lasting through the 15 s break after it: it is held 4 s at most, and the line ends with it.
  assert.strictEqual(lrc[3], '[01:12.51]<01:12.51>Denial <01:12.89>has <01:13.32>left <01:13.63>you <01:14.32>all <01:14.88>alone<01:18.88>');
});

const realFetch = global.fetch;
let asked = [];
function answer({ candidates = [], content = pack(KRC), fail = false }) {
  asked = [];
  global.fetch = async (url) => {
    asked.push(String(url));
    if (fail) throw new Error('The operation was aborted due to timeout');
    const body = /search/.test(url) ? { status: 200, candidates } : { status: 200, fmt: 'krc', content };
    return { ok: true, status: 200, json: async () => body };
  };
}
test.after(() => { global.fetch = realFetch; });
const hit = (id, song, singer, seconds) => ({ id: String(id), accesskey: `K${id}`, song, singer, duration: seconds * 1000 });

test('the song that is this one, as long as the file: its word-timed lyrics', async () => {
  answer({ candidates: [hit(1, 'Denial (Live)', 'Sevendust', 301), hit(2, 'Denial', 'Sevendust', 257.3)] });
  const lyrics = await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27 });
  assert.match(lyrics, /^\[00:44\.98\]<00:44\.98>What /);
  assert.ok(asked.some((u) => /download.*id=2&accesskey=K2/.test(u)), 'the album version, not the live one');
});

test('another song, another length, or nothing to download: nothing', async () => {
  answer({ candidates: [hit(3, 'Black', 'Sevendust', 257.3)] });
  assert.strictEqual(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27 }), null);
  answer({ candidates: [hit(2, 'Denial', 'Sevendust', 230)] });
  assert.strictEqual(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27 }), null);
  answer({ candidates: [hit(2, 'Denial', 'Sevendust', 257.3)], content: '' });
  assert.strictEqual(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27 }), null);
});

test('with line-timed lyrics to check against: the version whose lines start where they do, moved onto them if it is a little off', async () => {
  // Version 1 is the closest in length but 1.2 s late; version 2 is 0.3 s early; version 3 is another song's words.
  const at = (lines, by) => lines.map(([t, words]) => `[${Math.round((t + by) * 1000)},900]` + words.split(' ').map((w, i) => `<${i * 200},200,0>${w} `).join('')).join('\n');
  const LINES = [[10, 'one two three'], [14, 'four five six'], [18, 'seven eight nine'], [22, 'ten eleven twelve']];
  const reference = '[00:10.00]One two three\n[00:14.00]Four five six\n[00:18.00]Seven eight nine\n[00:22.00]Ten eleven twelve';
  const versions = { 1: at(LINES, 1.2), 2: at(LINES, -0.3), 3: at([[10, 'la la la'], [14, 'la la la'], [18, 'la la la']], 0) };
  asked = [];
  global.fetch = async (url) => {
    asked.push(String(url));
    const body = /search/.test(url) ? { status: 200, candidates: [hit(1, 'Denial', 'Sevendust', 257.3), hit(2, 'Denial', 'Sevendust', 259), hit(3, 'Denial', 'Sevendust', 258)] }
      : { status: 200, content: pack(versions[/id=(\d)/.exec(url)[1]]) };
    return { ok: true, status: 200, json: async () => body };
  };
  const lyrics = await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27, reference });
  assert.match(lyrics, /^\[00:10\.00\]<00:10\.00>one <00:10\.20>two /, 'version 2, moved 0.3 s later');
  assert.match(lyrics, /\n\[00:22\.00\]<00:22\.00>ten /);
  // Close enough (a quarter second or less): left as Kugou has it.
  versions[2] = at(LINES, -0.2);
  assert.match(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27, reference }), /^\[00:09\.80\]/);
  // Nothing to check against: the closest in length.
  assert.match(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27 }), /^\[00:11\.20\]/);
});

test('a version a few more seconds longer (another master, a longer fade) is used when its lines check out — only then', async () => {
  const reference = "[00:44.98]What never say what you mean\n[00:55.09]Let's don't stop\n[01:03.34]Denial seems it had to come";
  answer({ candidates: [hit(2, 'Denial', 'Sevendust', 262)] });
  assert.match(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 254.9, reference }), /^\[00:44\.98\]/);
  answer({ candidates: [hit(2, 'Denial', 'Sevendust', 262)] });
  assert.strictEqual(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 254.9 }), null);
  answer({ candidates: [hit(2, 'Denial', 'Sevendust', 262)] });
  assert.strictEqual(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 254.9, reference: '[00:10.00]Something else entirely\n[00:20.00]And more of it\n[00:30.00]Still other words' }), null);
});

test('Kugou unreachable: reported, so it is not asked again', async () => {
  answer({ fail: true });
  assert.strictEqual(await kugouLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27 }), kugouLyrics.UNREACHABLE);
});
