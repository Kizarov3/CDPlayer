'use strict';
/**
 * THE YEAR ON THE SHELF: a year of listening (or ALL TIME) told from the shelf — the hours, the albums and artists
 * played most, the albums played start to end, the ones that came in and haven't been played, the busiest day, and
 * the year month by month. A year is read from the log of plays (listens.js), which knows each play's day only from
 * 2.21 on (and before that, each song's first and last play and the listens imported); ALL TIME counts every play
 * (plays.txt) but knows its days only as far as the log does.
 */
const TOP_ALBUMS = 10, TOP_ARTISTS = 5, LISTED = 12;

const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * { log (listens.js), albums (the shelf's), counts (Map path → plays), through ({ [album id]: { n, last } }), year
 * (a number, or 'ALL'), now } → { year, years, plays, minutes, albums, artists, through, arrivals, busiest, strip,
 * since, from }.
 */
function yearOnShelf({ log, albums, counts = new Map(), through = {}, year = 'ALL', now = Date.now() }) {
  const all = year === 'ALL';
  const from = all ? -Infinity : new Date(year, 0, 1).getTime(), to = all ? Infinity : new Date(year + 1, 0, 1).getTime();
  const inYear = (at) => at >= from && at < to;
  const albumOf = new Map(), seconds = new Map();
  for (const a of albums) for (const t of a.tracks) { albumOf.set(t.path, a); seconds.set(t.path, t.duration || 0); }

  // Each song's plays in the year: from the log (ALL TIME: every play counted, the log only for the days).
  const songPlays = new Map(), days = new Map(), months = new Map();
  for (const [at, p] of log.list) {
    if (!inYear(at)) continue;
    if (!all) songPlays.set(p, (songPlays.get(p) || 0) + 1);
    const day = startOfDay(at), s = seconds.get(p) || 0, d = new Date(at);
    const was = days.get(day) || { plays: 0, seconds: 0 };
    days.set(day, { plays: was.plays + 1, seconds: was.seconds + s });
    const key = all ? d.getFullYear() : d.getMonth();
    months.set(key, (months.get(key) || 0) + s);
  }
  if (all) for (const [p, n] of counts) songPlays.set(p, n);

  let plays = 0, secs = 0;
  const byAlbum = new Map(), byArtist = new Map();
  for (const [p, n] of songPlays) {
    plays += n;
    const s = (seconds.get(p) || 0) * n;
    secs += s;
    const a = albumOf.get(p);
    if (!a) continue; // a song no longer on the shelf: in the hours, not among the albums
    const was = byAlbum.get(a.id) || { album: a, plays: 0, seconds: 0 };
    byAlbum.set(a.id, { album: a, plays: was.plays + n, seconds: was.seconds + s });
    const track = a.tracks.find((t) => t.path === p) || {};
    const who = (a.artist && a.artist !== 'Various Artists' ? a.artist : track.artist) || null;
    if (who) { const w = byArtist.get(who) || { name: who, plays: 0, seconds: 0 }; byArtist.set(who, { name: who, plays: w.plays + n, seconds: w.seconds + s }); }
  }
  const brief = (a) => ({ id: a.id, title: a.title, artist: a.artist, year: a.year || null, first: (a.tracks[0] || {}).path || null }); // (first: for its cover)
  const most = (x, y) => (y.plays - x.plays) || (y.seconds - x.seconds);
  const topAlbums = [...byAlbum.values()].sort(most).slice(0, TOP_ALBUMS)
    .map((x) => ({ ...brief(x.album), plays: x.plays, minutes: Math.round(x.seconds / 60) }));
  const topArtists = [...byArtist.values()].sort(most).slice(0, TOP_ARTISTS)
    .map((x) => ({ name: x.name, plays: x.plays, minutes: Math.round(x.seconds / 60) }));

  // Played start to end: album-runs.js keeps how many times, and the last — so a year has the albums last played
  // through in it.
  const onShelf = new Map(albums.map((a) => [a.id, a]));
  const throughs = Object.entries(through).filter(([id, r]) => onShelf.has(id) && r && (all || inYear(r.last)))
    .sort((x, y) => (y[1].n - x[1].n) || (y[1].last - x[1].last)).map(([id, r]) => ({ ...brief(onShelf.get(id)), n: r.n }));

  // New arrivals never played: on the shelf since this year (ALL TIME: ever), not one song of them played.
  const heard = (a) => a.tracks.some((t) => counts.get(t.path));
  const arrived = (a) => a.arrived || a.added || null;
  const arrivals = albums.filter((a) => !heard(a) && (all || inYear(arrived(a)))).sort((x, y) => (arrived(y) || 0) - (arrived(x) || 0));

  let busiest = null;
  for (const [day, d] of days) if (!busiest || d.seconds > busiest.seconds || (d.seconds === busiest.seconds && d.plays > busiest.plays)) busiest = { day, ...d };

  const years = [...new Set([new Date(now).getFullYear(), ...log.list.map(([at]) => new Date(at).getFullYear())])].sort((x, y) => y - x);
  const strip = all
    ? years.slice().reverse().map((y) => ({ year: y, minutes: Math.round((months.get(y) || 0) / 60) }))
    : Array.from({ length: 12 }, (_, m) => ({ month: m, minutes: Math.round((months.get(m) || 0) / 60) }));
  return {
    year, years, plays, minutes: Math.round(secs / 60),
    albums: topAlbums, artists: topArtists,
    through: throughs.slice(0, LISTED), throughCount: throughs.length,
    arrivals: arrivals.slice(0, LISTED).map(brief), arrivalsCount: arrivals.length,
    busiest: busiest && { day: busiest.day, plays: busiest.plays, minutes: Math.round(busiest.seconds / 60) },
    strip,
    since: log.since || null, from: log.list.length ? log.list[0][0] : null,
  };
}

module.exports = { yearOnShelf };
