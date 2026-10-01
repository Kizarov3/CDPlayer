// What an album's booklet says about it, from its songs' details (as metadata.getDetails gives them): the credits
// most of its songs agree on, a summary of the album, and the small print for the back cover. No page drawing here.
import { t } from './i18n.js';

const time = (seconds) => { const s = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const creditsOf = (details) => (details && details.credits) || {};

// The value most of the songs give for `pick` (the first one named, on a tie), or null when none give one.
function mostSaid(details, pick) {
  const counts = new Map();
  for (const d of details) {
    const v = d ? pick(creditsOf(d)) : null;
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  for (const [v, n] of counts) if (!best || n > best[1]) best = [v, n];
  return best ? best[0] : null;
}

/** The CREDITS page's rows for an album: [[label, value]…], only the ones some song names. */
export function albumCredits(details) {
  return [
    [t('PRODUCED BY'), mostSaid(details, (c) => c.producer)], [t('RELEASED'), mostSaid(details, (c) => c.released)],
    [t('GENRE'), mostSaid(details, (c) => c.genre)], [t('LABEL'), mostSaid(details, (c) => c.label)],
    [t('CATALOG NO.'), mostSaid(details, (c) => c.catalog)],
  ].filter(([, v]) => v);
}

// The album's format: its tracks' ("AAC · 262 KBPS"), or one codec at their average bitrate when that varies (as it
// does from track to track in a variable-bitrate rip), or just the codec; "Mixed" when the codecs differ.
function format(qualities) {
  const kinds = new Set(qualities);
  if (kinds.size <= 1) return qualities[0] || null;
  const codecs = new Set(qualities.map((q) => q.split(' · ')[0]));
  if (codecs.size > 1) return t('Mixed');
  const codec = [...codecs][0];
  const rates = qualities.map((q) => /(\d+) KBPS$/.exec(q));
  return rates.every(Boolean) ? `${codec} · ${Math.round(rates.reduce((s, m) => s + +m[1], 0) / rates.length)} KBPS` : codec;
}

/** THIS ALBUM: how many tracks (and discs), how long, in what format, and how often its songs have been played. */
export function albumSummary({ details, plays, discs }) {
  const total = details.reduce((s, d) => s + ((d && d.duration) || 0), 0);
  const qualities = details.map((d) => d && d.quality).filter(Boolean);
  const played = plays.reduce((s, n) => s + (n || 0), 0);
  return [
    [t('TRACKS'), String(details.length)], [t('DISCS'), discs > 1 ? String(discs) : null], [t('LENGTH'), total ? time(total) : null],
    [t('FORMAT'), format(qualities)], [t('PLAYED'), played ? (played === 1 ? t('1 time') : t('{n} times', { n: played })) : null],
  ].filter(([, v]) => v);
}

/** The back cover's small print: the first copyright, barcode, label and catalog number any song has. */
export function albumSmallPrint(details) {
  const first = (key) => details.map((d) => creditsOf(d)[key]).find(Boolean) || null;
  return { copyright: first('copyright'), barcode: first('barcode'), label: first('label'), catalog: first('catalog') };
}

/** Two album names for the same album: "Three Dollar Bill, Yall$" and "THREE DOLLAR BILL Y'ALL$" (as the shelf groups them). */
export function sameAlbum(a, b) {
  const name = (s) => { const low = String(s || '').toLowerCase(); return low.replace(/[^\p{L}\p{N}]+/gu, '') || low.trim(); };
  return !!a && !!b && name(a) === name(b);
}

// ---- The owner's marks, in pen: what a well-used booklet collects -----------------------------------------------

const MONTHS = [t('Jan'), t('Feb'), t('Mar'), t('Apr'), t('May'), t('Jun'), t('Jul'), t('Aug'), t('Sep'), t('Oct'), t('Nov'), t('Dec')];
const DAY_MS = 86400000;
function ago(then, now) {
  const start = (t) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((start(now) - start(then)) / DAY_MS);
  if (days <= 0) return t('today');
  if (days === 1) return t('yesterday');
  if (days < 30) return t('{n} days ago', { n: days });
  if (days < 365) { const m = Math.floor(days / 30); return m === 1 ? t('a month ago') : t('{n} months ago', { n: m }); }
  const y = Math.floor(days / 365);
  return y === 1 ? t('a year ago') : t('{n} years ago', { n: y });
}

/**
 * An album's songs' plays, and when each was first and last played (ms, or null) → the owner's pen marks: tally marks
 * beside each song ({ fives, ones }, or { times: '×47' } past twenty; null for none), the favourite (the most played,
 * three plays or more; -1 for none) to circle, and notes for the back cover ('1st spin: 12 Mar 2024', 'last: today').
 */
export function ownerMarks({ plays, first, last, now = Date.now() }) {
  const tallies = plays.map((n) => (!n ? null : n > 20 ? { times: `×${n}` } : { fives: Math.floor(n / 5), ones: n % 5 }));
  let favorite = -1;
  plays.forEach((n, i) => { if (n >= 3 && (favorite < 0 || n > plays[favorite])) favorite = i; });
  const known = (list) => list.filter(Boolean);
  const notes = [];
  if (known(first).length) { const d = new Date(Math.min(...known(first))); notes.push(t('1st spin: {date}', { date: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` })); }
  if (known(last).length) notes.push(t('last: {when}', { when: ago(Math.max(...known(last)), now) }));
  return { tallies, favorite, notes };
}
