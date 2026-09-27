'use strict';
/**
 * Word-timed lyrics from Kugou (lyrics.kugou.com), for karaoke: its "KRC" lyrics time every word, and it has them for
 * many songs neither Unison nor NetEase does (Western rock and metal among them). Only a song that is this one — same
 * title and artist, close to the file's length, and with its lines where the song's line timing has them — counts.
 * Kugou's API is unofficial: when it doesn't answer, lyrics come from elsewhere.
 */
const zlib = require('zlib');
const { timedLine } = require('./netease');

const TIMEOUT_MS = 8000;
const LENGTH_SLACK = 4; // seconds a recording may differ from the file and still be the same one
const CHECKED_SLACK = 10; // …or more, when its lines are checked against the song's line timing and start where they do
const LONGEST_WORD = 4; // seconds: KRC often has a line's last word last through the break after it
const UNREACHABLE = Symbol('unreachable'); // Kugou didn't answer at all (offline, a timeout, blocked)
const KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

const bare = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' };
const decodeEntities = (s) => s.replace(/&(amp|apos|quot|lt|gt|#(\d+));/g, (_, name, code) => (code ? String.fromCharCode(+code) : ENTITIES[name]));

/** KRC as Kugou sends it — base64 of "krc1" and the zlib-deflated text XOR-ed with a fixed key — as text ('' if it isn't). */
function decodeKrc(content) {
  try {
    const raw = Buffer.from(String(content || ''), 'base64');
    if (raw.subarray(0, 4).toString('latin1') !== 'krc1') return '';
    return zlib.inflateSync(Buffer.from(raw.subarray(4).map((b, i) => b ^ KEY[i % 16]))).toString('utf8');
  } catch { return ''; }
}

/**
 * KRC ("[lineStart,lineLength]<offset,length,0>word …", ms, each word's offset from its line's start) as word-timed
 * LRC, the way ttml.js writes it. A lone dash between words is left out (its time goes to the word before), a word
 * held past LONGEST_WORD is cut there (and so is its line), and the credit line Kugou puts first ("Title - Artist")
 * is left out.
 */
function krcToLrc(krc, { title, artist } = {}) {
  const credits = new Set([bare(`${title}${artist}`), bare(`${artist}${title}`), bare(title), bare(artist)].filter(Boolean));
  const out = [];
  for (const raw of String(krc || '').split(/\r?\n/)) {
    const head = /^\[(\d+),(\d+)\]/.exec(raw);
    if (!head) continue;
    const start = +head[1] / 1000;
    const words = [];
    for (const m of raw.slice(head[0].length).matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)) {
      const w = { time: start + +m[1] / 1000, end: start + (+m[1] + +m[2]) / 1000, text: decodeEntities(m[3]) };
      if (/^\s*[-–—]\s*$/.test(w.text) && words.length) { words[words.length - 1].end = w.end; continue; }
      if (w.text.trim()) words.push(w);
    }
    const text = words.map((w) => w.text).join('').trim();
    if (!text || (!out.length && (credits.has(bare(text)) || /[:：]/.test(text)))) continue;
    let lineEnd = start + +head[2] / 1000;
    const last = words[words.length - 1];
    if (last.end - last.time > LONGEST_WORD) { last.end = last.time + LONGEST_WORD; lineEnd = last.end; }
    out.push(timedLine(start, lineEnd, words));
  }
  return out.join('\n');
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
  return res.json();
}

// Where each line starts, with its words: [{ time, words: ['all', 'i', 'hear'] }] — for checking one timing against another.
function lineStarts(lrc) {
  const out = [];
  for (const l of String(lrc || '').split(/\r?\n/)) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/.exec(l);
    if (!m) continue;
    const words = m[3].replace(/<[^>]*>/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
    if (words.length) out.push({ time: +m[1] * 60 + +m[2], words });
  }
  return out;
}

/**
 * How far `lrc`'s lines start from `reference`'s (seconds, + = later): the median over the lines that begin with the
 * same two words within a few seconds of each other. null when too few lines can be matched to tell.
 */
function offsetFrom(lrc, reference) {
  const mine = lineStarts(lrc), theirs = lineStarts(reference), gaps = [];
  for (const line of mine) {
    const near = theirs.filter((r) => r.words[0] === line.words[0] && r.words[1] === line.words[1] && Math.abs(r.time - line.time) < 5);
    if (near.length) gaps.push(near.map((r) => line.time - r.time).sort((a, b) => Math.abs(a) - Math.abs(b))[0]);
  }
  if (!gaps.length || gaps.length < Math.min(3, mine.length)) return null;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

const STAMP = /([[<])(\d+):(\d+(?:\.\d+)?)([\]>])/g;
/** Every line and word stamp of `lrc` moved by `by` seconds. */
function shiftLrc(lrc, by) {
  return lrc.replace(STAMP, (_, open, m, sec, close) => {
    const cs = Math.max(0, Math.round((+m * 60 + +sec + by) * 100));
    return `${open}${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}${close}`;
  });
}

const VERSIONS = 4; // Kugou versions of a song compared, at most
const CLOSE_ENOUGH = 0.25; // seconds: a version this near the reference is left as it is

/**
 * Kugou's word-timed lyrics for { artist, title, duration, reference }: among the versions that are this song and
 * close in length (within a few seconds — ten when they can be checked), the one whose lines start where
 * `reference`'s (line-timed LRC, e.g. lrclib's) do — moved onto them when it is a little off — or, when none can be
 * checked, the closest in length if it is within a few seconds.
 * Kugou has several timings of many songs, and some run a second or more early or late. → LRC, null when it has none
 * for this song, or kugouLyrics.UNREACHABLE.
 */
async function kugouLyrics({ artist, title, duration, reference }) {
  if (!artist || !title) return null;
  const { sameSong } = require('./online'); // (online.js asks this module; required late, after it has loaded)
  let candidates;
  try {
    let url = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(`${artist} - ${title}`)}&hash=`;
    if (duration > 0) url += `&duration=${Math.round(duration * 1000)}`;
    candidates = (await getJson(url)).candidates || [];
  } catch (e) { return e && e.status ? null : UNREACHABLE; }
  const checkable = lineStarts(reference).length > 0;
  const apart = (c) => (duration > 0 ? Math.abs((c.duration || 0) / 1000 - duration) : 0);
  const hits = candidates
    .filter((c) => c.id && c.accesskey && sameSong({ title: c.song || '', artist: c.singer || '' }, artist, title))
    .filter((c) => apart(c) <= (checkable ? CHECKED_SLACK : LENGTH_SLACK))
    .sort((a, b) => apart(a) - apart(b))
    .slice(0, checkable ? VERSIONS : 1);
  if (!hits.length) return null;
  let versions;
  try {
    versions = await Promise.all(hits.map(async (c) => {
      const json = await getJson(`https://lyrics.kugou.com/download?ver=1&client=pc&id=${c.id}&accesskey=${c.accesskey}&fmt=krc&charset=utf8`);
      return krcToLrc(decodeKrc(json.content), { title, artist });
    }));
  } catch (e) { return e && e.status ? null : UNREACHABLE; }
  versions = versions.map((lrc, i) => ({ lrc, near: apart(hits[i]) <= LENGTH_SLACK })).filter((v) => v.lrc);
  const checked = versions.map((v) => ({ ...v, off: offsetFrom(v.lrc, reference) })).filter((v) => v.off !== null);
  if (!checked.length) return versions.length && versions[0].near ? versions[0].lrc : null;
  const best = checked.sort((a, b) => Math.abs(a.off) - Math.abs(b.off))[0];
  return Math.abs(best.off) > CLOSE_ENOUGH ? shiftLrc(best.lrc, -best.off) : best.lrc;
}
kugouLyrics.UNREACHABLE = UNREACHABLE;

module.exports = { decodeKrc, krcToLrc, kugouLyrics };
