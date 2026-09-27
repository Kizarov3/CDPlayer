// What an album's booklet says about it, from its songs' details (as metadata.getDetails gives them): the credits
// most of its songs agree on, a summary of the album, and the small print for the back cover. No page drawing here.

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
    ['PRODUCED BY', mostSaid(details, (c) => c.producer)], ['RELEASED', mostSaid(details, (c) => c.released)],
    ['GENRE', mostSaid(details, (c) => c.genre)], ['LABEL', mostSaid(details, (c) => c.label)],
    ['CATALOG NO.', mostSaid(details, (c) => c.catalog)],
  ].filter(([, v]) => v);
}

// The album's format: its tracks' ("AAC · 262 KBPS"), or one codec at their average bitrate when that varies (as it
// does from track to track in a variable-bitrate rip), or just the codec; "Mixed" when the codecs differ.
function format(qualities) {
  const kinds = new Set(qualities);
  if (kinds.size <= 1) return qualities[0] || null;
  const codecs = new Set(qualities.map((q) => q.split(' · ')[0]));
  if (codecs.size > 1) return 'Mixed';
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
    ['TRACKS', String(details.length)], ['DISCS', discs > 1 ? String(discs) : null], ['LENGTH', total ? time(total) : null],
    ['FORMAT', format(qualities)], ['PLAYED', played ? `${played} ${played === 1 ? 'time' : 'times'}` : null],
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
