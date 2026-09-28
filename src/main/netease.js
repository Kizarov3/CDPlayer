'use strict';
/**
 * Word-timed lyrics from NetEase Music (music.163.com), for karaoke: its "YRC" lyrics time every word, and it has
 * them for many songs Unison doesn't. Only a song that is this one — same title and artist, and within a few seconds
 * of the file's length — counts. NetEase's API is unofficial: when it doesn't answer, lyrics come from elsewhere.
 */
const { httpFetch } = require('./http');
const TIMEOUT_MS = 8000;
const LENGTH_SLACK = 4; // seconds a recording may differ from the file and still be the same one
const GAP = 0.02; // a word that ends more than this before the next one starts leaves a pause
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', Referer: 'https://music.163.com/' };
const UNREACHABLE = Symbol('unreachable'); // NetEase didn't answer at all (offline, a timeout, blocked)

const stamp = (seconds, [open, close] = '[]') => {
  const cs = Math.round(Math.max(0, seconds) * 100);
  return `${open}${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}${close}`;
};
const bare = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * YRC ("[lineStart,lineLength](wordStart,wordLength,0)word …", all in ms) as word-timed LRC, the way ttml.js writes
 * it: a stamp before each word, one after a word a pause follows, and one at the line's end. The credit lines NetEase
 * puts first (JSON lines, "作词: …", or just the title and artist) are left out.
 */
function yrcToLrc(yrc, { title, artist } = {}) {
  const credits = new Set([bare(title), bare(artist)].filter(Boolean));
  const out = [];
  for (const raw of String(yrc || '').split(/\r?\n/)) {
    const head = /^\[(\d+),(\d+)\]/.exec(raw);
    if (!head) continue;
    const words = [...raw.slice(head[0].length).matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)]
      .map((m) => ({ time: +m[1] / 1000, end: (+m[1] + +m[2]) / 1000, text: m[3] }))
      .filter((w) => w.text !== '');
    const text = words.map((w) => w.text).join('').trim();
    if (!text || (!out.length && (credits.has(bare(text)) || /[:：]/.test(text)))) continue;
    out.push(timedLine(+head[1] / 1000, (+head[1] + +head[2]) / 1000, words));
  }
  return out.join('\n');
}

/**
 * One line of word-timed LRC from its start, its end and its words ([{ time, end, text }], seconds): a stamp before
 * each word, one after a word a pause follows, and one at the line's end.
 */
function timedLine(start, lineEnd, words) {
  let lrc = stamp(start);
  words.forEach((w, i) => {
    const next = words[i + 1];
    lrc += stamp(w.time, '<>') + (next ? w.text : w.text.trimEnd());
    if (next) { if (next.time - w.end > GAP) lrc = `${lrc.replace(/\s+$/, '')} ${stamp(w.end, '<>')} `; }
    else {
      lrc += stamp(w.end, '<>');
      if (lineEnd - w.end > GAP) lrc += ` ${stamp(lineEnd, '<>')}`;
    }
  });
  return lrc;
}

async function getJson(url) {
  const res = await httpFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
  return res.json();
}

/**
 * NetEase's word-timed lyrics for { artist, title, duration }: the search hit that is this song and closest in
 * length (within a few seconds), as LRC. → LRC, null when it has none for this song, or neteaseLyrics.UNREACHABLE.
 */
async function neteaseLyrics({ artist, title, duration }) {
  if (!artist || !title) return null;
  const { sameSong } = require('./online'); // (online.js asks this module; required late, after it has loaded)
  let songs;
  try {
    const json = await getJson(`https://music.163.com/api/search/get?s=${encodeURIComponent(`${artist} ${title}`)}&type=1&limit=10`);
    songs = (json.result && json.result.songs) || [];
  } catch (e) { return e && e.status ? null : UNREACHABLE; }
  const length = (s) => (s.duration || 0) / 1000;
  const hits = songs
    .filter((s) => sameSong({ title: s.name || '', artist: (s.artists || []).map((a) => a.name).join(' ') }, artist, title))
    .filter((s) => !(duration > 0) || Math.abs(length(s) - duration) <= LENGTH_SLACK)
    .sort((a, b) => (duration > 0 ? Math.abs(length(a) - duration) - Math.abs(length(b) - duration) : 0));
  if (!hits.length) return null;
  try {
    const json = await getJson(`https://music.163.com/api/song/lyric/v1?id=${hits[0].id}&lv=0&yv=0&tv=0&rv=0&kv=0`);
    const lrc = json.yrc && json.yrc.lyric ? yrcToLrc(json.yrc.lyric, { title, artist }) : '';
    return lrc || null;
  } catch (e) { return e && e.status ? null : UNREACHABLE; }
}
neteaseLyrics.UNREACHABLE = UNREACHABLE;

module.exports = { yrcToLrc, neteaseLyrics, timedLine };
