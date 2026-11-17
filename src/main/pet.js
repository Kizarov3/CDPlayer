'use strict';
/**
 * BLIP, the pet in the deck's display: what it is, worked out from how you listen. It grows with the hours of music
 * (an egg until the first album played start to end, or the first hour, after it's turned on; then BABY, KID at 10 h,
 * TEEN at 30 h), and once it's had 50 h and 30 days it's grown up: on the 1st of each month it takes the form of how
 * the last 30 days were listened to (a molt). Items come for what's piled up — never for days in a row — and two
 * surprise forms turn up by themselves (a hidden track found: GHOST; the same song on the same day a year later: ECHO).
 * It can't go hungry, sulk or die: there's nothing here that goes down.
 * Kept in pet.json: only what can't be read again from the history — its name, when it was turned on and hatched, its
 * forms and items with when they came, what it wears, its temper, the month it last molted.
 */
const DAY = 86400e3, HOUR = 3600e3;
const TEMPERS = ['sleepy', 'bouncy', 'curious', 'shy'];
const HABITS = ['owl', 'bird', 'loyalist', 'explorer', 'raver', 'collector'];
const SURPRISES = ['ghost', 'echo'];
const STAGES = ['egg', 'baby', 'kid', 'teen', 'adult'];
const ITEMS = [ // in the order they're looked at
  ['crown', (s) => s.albums >= 10],
  ['record', (s) => s.maxOne >= 5],
  ['headphones', (s) => s.hours >= 100],
  ['scarf', (s) => s.days >= 7],
];
const UNKNOWN_SECONDS = 240; // a song whose length isn't known: four minutes
const MONTH_DAYS = 30;

const empty = (now = Date.now(), random = Math.random) => ({
  version: 1, name: 'BLIP', since: now, hatchedAt: null, hatchAlbum: null, stage: 'egg', form: null, chosen: null,
  found: {}, items: {}, worn: null, temper: TEMPERS[Math.min(TEMPERS.length - 1, Math.floor(random() * TEMPERS.length))],
  lastMolt: null, pending: {},
});

function parse(text, now = Date.now(), random = Math.random) {
  try {
    const p = JSON.parse(text || '');
    if (!p || typeof p !== 'object' || Array.isArray(p) || p.version !== 1 || !STAGES.includes(p.stage)) return empty(now, random);
    return { ...empty(now, random), ...p, found: { ...p.found }, items: { ...p.items }, pending: { ...p.pending } };
  } catch { return empty(now, random); }
}
const format = (p) => JSON.stringify(p);

const monthKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
// the local day `ms` falls in, as [its midnight, the next midnight) (a clock change makes a day 23 or 25 hours)
const dayOf = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); const start = d.getTime(); d.setDate(d.getDate() + 1); return [start, d.getTime()]; };
// the first play at or after `ms` in a list oldest first
function firstFrom(list, ms) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid][0] < ms) lo = mid + 1; else hi = mid; }
  return lo;
}
const MEMO_MS = 10 * 60e3; // (read all anew at least this often: the shelf's song lengths change with it)
const realArtist = (a) => (a && a.artist && a.artist !== 'Various Artists' ? a.artist : null);

/**
 * What evolve needs to know, from the history: `list` [[ms, path]] oldest first (listens.js), `seconds(path)` a song's
 * length (0: not known), `through` album-runs.js's { [id]: { n, last } }, `albumOf(path)` → { id, title, artist } |
 * null, `album(id)` → { title, paths } | null, `firsts` Map path → its first play, `since` when it was turned on.
 * `memo` ({}, kept between calls): what's been added up so far, so a play that only adds to the end of the history
 * reads only itself and the last 30 days — not years of plays again. Anything else (the oldest trimmed, an import in
 * the middle, songs moved, a new egg) reads it all anew.
 */
function stats({ list = [], seconds = () => 0, through = {}, albumOf = () => null, album = () => null, firsts = new Map(), since = 0, now = Date.now() }, memo = null) {
  const n = list.length;
  const same = memo && memo.list === list && memo.since === since && memo.seconds === seconds && memo.n > 0 && n >= memo.n
    && list[0] === memo.first && list[memo.n - 1] === memo.last && now - memo.at < MEMO_MS && now >= memo.now;
  let secs = same ? memo.secs : 0, secsSince = same ? memo.secsSince : 0, days = same ? memo.days : 0, dayEnd = same ? memo.dayEnd : -Infinity;
  for (let i = same ? memo.n : 0; i < n; i++) {
    const [at, p] = list[i], s = seconds(p) || UNKNOWN_SECONDS;
    secs += s;
    if (at >= since) secsSince += s;
    if (at >= dayEnd) { days++; dayEnd = dayOf(at)[1]; } // (oldest first: a play past the day's end starts a new day)
  }
  if (memo) Object.assign(memo, { list, since, seconds, n, first: list[0], last: list[n - 1], secs, secsSince, days, dayEnd, at: same ? memo.at : now, now });
  const from = now - MONTH_DAYS * DAY;
  const month = { plays: 0, night: 0, morning: 0, topShare: 0, artists: 0, firsts: 0 };
  const byArtist = new Map();
  for (let i = firstFrom(list, from); i < n; i++) {
    const [at, p] = list[i];
    if (at > now) break;
    month.plays++;
    const h = new Date(at).getHours();
    if (h >= 23 || h < 4) month.night++;
    if (h >= 5 && h < 9) month.morning++;
    const who = realArtist(albumOf(p));
    if (who) byArtist.set(who, (byArtist.get(who) || 0) + 1);
  }
  if (month.plays) {
    month.night /= month.plays; month.morning /= month.plays;
    month.topShare = byArtist.size ? Math.max(...byArtist.values()) / month.plays : 0;
  }
  month.artists = byArtist.size;
  for (const at of firsts.values()) if (at >= from && at <= now) month.firsts++;
  let albums = 0, maxOne = 0, fav = null, throughSince = 0;
  for (const [id, r] of Object.entries(through)) {
    const n = (r && r.n) || 0;
    albums += n;
    if (r && r.last >= since) throughSince++;
    if (n > maxOne || (n === maxOne && fav && r.last > fav.last)) { maxOne = n; fav = { id, last: r.last }; }
  }
  const favAlbum = fav && maxOne > 0 ? album(fav.id) : null;
  const lastAlbum = list.length ? albumOf(list[list.length - 1][1]) : null;
  return {
    hours: secs / 3600, hoursSince: secsSince / 3600, throughSince, albums, maxOne, days, month,
    favourite: favAlbum ? { id: fav.id, title: favAlbum.title, paths: favAlbum.paths } : null,
    lastAlbum: lastAlbum ? lastAlbum.title : null,
  };
}

/** The form a month of listening gives (`stats().month`): the first that fits. */
function habitForm(m) {
  if (m.night >= 0.4) return 'owl';
  if (m.morning >= 0.4) return 'bird';
  if (m.topShare >= 0.4) return 'loyalist';
  if (m.firsts >= 50) return 'explorer';
  if (m.artists >= 25) return 'raver';
  return 'collector';
}

const stageFor = (hours) => (hours >= 30 ? 'teen' : hours >= 10 ? 'kid' : 'baby');

/**
 * The pet moved on by `s` (stats()) at `now`; `hidden`: a hidden track was just found; `echo`: this play is a song's
 * echo of a year ago. → { pet (a new object), events: [{ kind: hatch | grow {stage} | molt {from, to} | item {item} |
 * found {form} }] }.
 */
function evolve(old, s, now = Date.now(), { hidden = false, echo = false } = {}) {
  const p = { ...old, found: { ...old.found }, items: { ...old.items }, pending: { ...old.pending } };
  const events = [];
  if (hidden) p.pending.ghost = true;
  if (echo) p.pending.echo = true;
  if (!p.hatchedAt) {
    if (!(s.throughSince >= 1 || s.hoursSince >= 1)) return { pet: p, events };
    p.hatchedAt = now; p.hatchAlbum = s.lastAlbum || null; p.stage = 'baby';
    events.push({ kind: 'hatch' });
  }
  // grown up: on the first reading of each month (once it's had 50 h and 30 days)
  if (s.hours >= 50 && now - p.hatchedAt >= MONTH_DAYS * DAY && monthKey(now) !== p.lastMolt) {
    const from = p.form, to = habitForm(s.month);
    p.form = to; p.lastMolt = monthKey(now);
    if (HABITS.includes(p.chosen)) p.chosen = null; // (a look of its own picked before: the new one shows)
    if (!p.found[to]) p.found[to] = now;
    if (from !== to) events.push({ kind: 'molt', from, to });
  }
  const stage = p.form ? 'adult' : stageFor(s.hours);
  // (only ever up: fewer hours read later — a folder gone from the shelf — don't shrink it)
  if (STAGES.indexOf(stage) > STAGES.indexOf(p.stage)) { p.stage = stage; events.push({ kind: 'grow', stage }); }
  for (const [item, earned] of ITEMS) if (!p.items[item] && earned(s)) { p.items[item] = now; events.push({ kind: 'item', item }); }
  for (const form of SURPRISES) {
    if (!p.pending[form]) continue;
    delete p.pending[form];
    if (p.found[form]) continue;
    p.found[form] = now;
    if (p.stage === 'adult') p.chosen = form;
    events.push({ kind: 'found', form });
  }
  return { pet: p, events };
}

/** The form picked on its card to be shown: one it's found; its own form (or one not found) clears the pick. */
function choose(p, form) {
  return { ...p, chosen: form && form !== p.form && p.found[form] ? form : null };
}

/** What to draw: its stage, the form shown (the stage until it's grown; then the one chosen, if found, or its own), the item worn (the party hat on its hatch day). */
function shown(p, now = Date.now()) {
  const form = p.stage !== 'adult' ? p.stage : p.chosen && p.found[p.chosen] ? p.chosen : p.form || 'collector';
  const h = p.hatchedAt && new Date(p.hatchedAt), d = new Date(now);
  const birthday = h && h.getMonth() === d.getMonth() && h.getDate() === d.getDate() && d.getFullYear() > h.getFullYear();
  return { stage: p.stage, form, item: birthday ? 'party' : p.worn || null };
}

/** Whether `path` played now is the same song played on this day of the year, a year ago. */
function isEcho(list, path, now = Date.now()) {
  const d = new Date(now);
  const then = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
  if (then.getDate() !== d.getDate()) return false; // (29 February: no such day a year before)
  const [start, end] = dayOf(then.getTime());
  for (let i = firstFrom(list, start); i < list.length && list[i][0] < end; i++) if (list[i][1] === path) return true;
  return false;
}

/** The 1st of the month after `now`: when it next looks again. */
const nextLook = (now = Date.now()) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); };

module.exports = { empty, parse, format, stats, habitForm, evolve, choose, shown, isEcho, nextLook, monthKey, TEMPERS, HABITS, SURPRISES, STAGES, ITEMS: ITEMS.map(([k]) => k), HOUR, DAY };
