// What an album's booklet says about it, from its songs' details (as metadata.getDetails gives them): the credits
// most of its songs agree on, a summary of the album, and the small print for the back cover. No page drawing here.
import { t, locale } from './i18n.js';

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
export function albumCredits(details, pressing = null) {
  // pressing: what Discogs says of this album's release (main/discogs.js) — it fills in what the tags leave out.
  const p = pressing || {};
  return [
    [t('PRODUCED BY'), mostSaid(details, (c) => c.producer)], [t('RELEASED'), formatReleased(mostSaid(details, (c) => c.released), locale)],
    [t('GENRE'), mostSaid(details, (c) => c.genre)], [t('LABEL'), mostSaid(details, (c) => c.label) || p.label],
    [t('CATALOG NO.'), mostSaid(details, (c) => c.catalog) || p.catno], [t('BARCODE'), mostSaid(details, (c) => c.barcode) || p.barcode],
    [t('COUNTRY'), p.country], [t('PRESSING'), p.formats],
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
 * The tracklist's rows (`track`: the index of the album's track a row is, or -1) with the hidden songs found in them
 * (`hidden[i]`: track i's, or null) written in under their track, in pen as the owner would — and a missing row of
 * the same name (MusicBrainz lists some as tracks of their own) left out, as it's on the disc after all.
 */
export function penHidden(rows, hidden) {
  const names = new Set(hidden.filter(Boolean).map((n) => n.toLowerCase()));
  if (!names.size) return rows;
  return rows.flatMap((r) => (r.missing && names.has(String(r.name).toLowerCase()) ? []
    : r.track >= 0 && hidden[r.track] ? [r, { pen: true, name: hidden[r.track] }] : [r]));
}

/**
 * An album's songs' plays, and when each was first and last played (ms, or null) → the owner's pen marks: tally marks
 * beside each song ({ fives, ones }, or { times: '×47' } past twenty; null for none), the favourite (the most played,
 * three plays or more; -1 for none) to circle, and notes for the back cover ('1st spin: 12 Mar 2024', 'last: today',
 * 'start to end ×3' — `through`: the times the whole album was played through, in order).
 */
export function ownerMarks({ plays, first, last, through = 0, now = Date.now() }) {
  const tallies = plays.map((n) => (!n ? null : n > 20 ? { times: `×${n}` } : { fives: Math.floor(n / 5), ones: n % 5 }));
  let favorite = -1;
  plays.forEach((n, i) => { if (n >= 3 && (favorite < 0 || n > plays[favorite])) favorite = i; });
  const known = (list) => list.filter(Boolean);
  const notes = [];
  if (known(first).length) { const d = new Date(Math.min(...known(first))); notes.push(t('1st spin: {date}', { date: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` })); }
  if (known(last).length) notes.push(t('last: {when}', { when: ago(Math.max(...known(last)), now) }));
  if (through > 0 && plays.length > 1) notes.push(t('start to end ×{n}', { n: through })); // the album heard as an album
  return { tallies, favorite, notes };
}

/**
 * The album's story (paragraphs) in pieces of at most `max` characters, cut at sentences (0: every sentence its own
 * piece), so a page can end between them. `end`: the last piece of a paragraph.
 */
export function storyChunks(paragraphs, max = 420) {
  const out = [];
  for (const p of paragraphs) {
    const sentences = p.split(/(?<=[.!?…»”"])\s+(?=[\p{Lu}\p{N}«“"(])/u);
    let piece = '';
    for (const s of sentences) {
      if (piece && piece.length + 1 + s.length > max) { out.push({ text: piece, end: false }); piece = s; } else piece = piece ? `${piece} ${s}` : s;
    }
    if (piece) out.push({ text: piece, end: true });
  }
  return out;
}

/** "Released 17 September 1996 · 30 years ago" from a MusicBrainz date (YYYY, YYYY-MM or YYYY-MM-DD); null without one. */
/** A release date as people write it ("2 October 2000", "2 октября 2000 г."); a year alone stays as it is. */
export function formatReleased(released, locale = 'en') {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(released || '').trim());
  if (!m || !m[2]) return released || null;
  const opts = m[3] ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' };
  try { return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1)))); } catch { return released; }
}

export function releasedLine(released, { locale = 'en', now = new Date() } = {}) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(released || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), m[2] ? Number(m[2]) : null, m[3] ? Number(m[3]) : null];
  const at = new Date(Date.UTC(y, (mo || 1) - 1, d || 1));
  const opts = d ? { day: 'numeric', month: 'long', year: 'numeric' } : mo ? { month: 'long', year: 'numeric' } : { year: 'numeric' };
  let date;
  try { date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { ...opts, timeZone: 'UTC' }).format(at); } catch { date = released; }
  // Whole years since: by the date when it's known, else by the year.
  let years = now.getUTCFullYear() - y;
  if (mo && (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && d && now.getUTCDate() < d))) years--;
  if (years < 1) return t('Released {date}', { date });
  return years === 1 ? t('Released {date} · 1 year ago', { date }) : t('Released {date} · {n} years ago', { date, n: years });
}
