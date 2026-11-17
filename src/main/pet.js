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
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const realArtist = (a) => (a && a.artist && a.artist !== 'Various Artists' ? a.artist : null);

/**
 * What evolve needs to know, from the history: `list` [[ms, path]] oldest first (listens.js), `seconds(path)` a song's
 * length (0: not known), `through` album-runs.js's { [id]: { n, last } }, `albumOf(path)` → { id, title, artist } |
 * null, `album(id)` → { title, paths } | null, `firsts` Map path → its first play, `since` when it was turned on.
 */
function stats({ list = [], seconds = () => 0, through = {}, albumOf = () => null, album = () => null, firsts = new Map(), since = 0, now = Date.now() }) {
  let secs = 0, secsSince = 0;
  const days = new Set(), from = now - MONTH_DAYS * DAY;
  const month = { plays: 0, night: 0, morning: 0, topShare: 0, artists: 0, firsts: 0 };
  const byArtist = new Map();
  for (const [at, p] of list) {
    const s = seconds(p) || UNKNOWN_SECONDS;
    secs += s;
    if (at >= since) secsSince += s;
    days.add(dayKey(at));
    if (at < from || at > now) continue;
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
    hours: secs / 3600, hoursSince: secsSince / 3600, throughSince, albums, maxOne, days: days.size, month,
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
    if (!p.found[to]) p.found[to] = now;
    if (from !== to) events.push({ kind: 'molt', from, to });
  }
  const stage = p.form ? 'adult' : stageFor(s.hours);
  if (stage !== p.stage) { p.stage = stage; events.push({ kind: 'grow', stage }); }
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
  return list.some(([at, p]) => {
    if (p !== path) return false;
    const a = new Date(at);
    return a.getFullYear() === d.getFullYear() - 1 && a.getMonth() === d.getMonth() && a.getDate() === d.getDate();
  });
}

/** The 1st of the month after `now`: when it next looks again. */
const nextLook = (now = Date.now()) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); };

module.exports = { empty, parse, format, stats, habitForm, evolve, shown, isEcho, nextLook, monthKey, TEMPERS, HABITS, SURPRISES, STAGES, ITEMS: ITEMS.map(([k]) => k), HOUR, DAY };
