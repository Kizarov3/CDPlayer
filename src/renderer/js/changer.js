// The CD changer: five slots, each empty or holding a disc — a run [start, end) of the flat queue that playback, the
// mini player, Spotify and the saved queue still work from. Every change to the slots and the queue goes through here,
// so a disc's run and the queue never drift apart. Pure: no DOM, no I/O; a changer is never changed in place.

export const SLOTS = 5;
export const empty = () => ({ slots: Array(SLOTS).fill(null), queue: [], index: -1, nextDisc: null });
export const clear = empty;

const withoutRun = ({ start, end, ...rest }) => rest;
export const tracksOf = (c, s) => (c.slots[s] ? c.queue.slice(c.slots[s].start, c.slots[s].end) : []);
const entriesOf = (c) => c.slots.map((d, s) => (d ? { ...withoutRun(d), tracks: tracksOf(c, s) } : null));

/** The slot and the track on its disc of queue position `index`, or null. */
export function slotOf(c, index) {
  if (index < 0) return null;
  for (let s = 0; s < SLOTS; s++) {
    const d = c.slots[s];
    if (d && index >= d.start && index < d.end) return { slot: s, offset: index - d.start };
  }
  return null;
}

// Slots ({ …disc, tracks } or null; a disc with no tracks frees its slot) and where to stand → a changer, runs back to back.
function build(entries, at, nextDisc) {
  const slots = [], queue = [];
  for (const e of entries) {
    if (!e || !e.tracks.length) { slots.push(null); continue; }
    const { tracks, ...d } = e;
    slots.push({ ...d, start: queue.length, end: queue.length + tracks.length });
    queue.push(...tracks);
  }
  const s = at && slots[at.slot];
  const index = s && at.offset >= 0 && at.offset < s.end - s.start ? s.start + at.offset : -1;
  return { slots, queue, index, nextDisc: nextDisc != null && slots[nextDisc] ? nextDisc : null };
}

/** The invariant: the discs' runs are back to back in slot order and cover the queue; index is in one or -1. */
export function check(c) {
  let at = 0;
  for (const d of c.slots) {
    if (!d) continue;
    if (d.start !== at || d.end <= d.start) throw new Error(`run ${d.id} is ${d.start}..${d.end}, expected from ${at}`);
    at = d.end;
  }
  if (at !== c.queue.length) throw new Error(`runs cover ${at} of ${c.queue.length}`);
  if (c.index !== -1 && !slotOf(c, c.index)) throw new Error(`index ${c.index} is in no disc`);
  if (c.nextDisc != null && !c.slots[c.nextDisc]) throw new Error('nextDisc is empty');
  return true;
}

// Where a new disc goes: the lowest free slot, else the finished disc that finished longest ago (not the playing one).
function roomFor(c) {
  const free = c.slots.findIndex((d) => !d);
  if (free >= 0) return free;
  const here = slotOf(c, c.index);
  let best = -1;
  c.slots.forEach((d, s) => {
    if (d.done && (!here || here.slot !== s) && (best < 0 || d.finishedAt < c.slots[best].finishedAt)) best = s;
  });
  return best;
}

/**
 * Loads `disc` ({ id, kind, title, artist }) with its `tracks` into the changer. `play`: it's where the changer stands
 * now; `next`: it plays when the disc playing ends; `slot`: into that slot (the picker's choice — never the playing
 * one). With nothing playing, the changer stands on its first track. → { changer, slot, replaced } (replaced: the disc
 * taken out, or null), { changer, slot, already: true } when a disc with that id is in, { changer, full: true } when
 * no slot is free or finished, and { changer, slot: -1 } for no tracks or the playing slot.
 */
export function load(c, disc, tracks, { play = false, next = false, slot = null } = {}) {
  if (!tracks.length) return { changer: c, slot: -1 };
  // The same disc: its id, or exactly its songs (a disc loaded another way, or brought over from an old queue).
  const same = (d, s) => d.id === disc.id || (d.end - d.start === tracks.length && tracksOf(c, s).every((p, k) => p === tracks[k]));
  const have = c.slots.findIndex((d, s) => d && same(d, s));
  if (have >= 0) return { changer: c, slot: have, already: true };
  const here = slotOf(c, c.index);
  const at = slot != null ? slot : roomFor(c);
  if (at < 0) return { changer: c, full: true };
  if (here && here.slot === at) return { changer: c, slot: -1 };
  const replaced = c.slots[at] ? withoutRun(c.slots[at]) : null;
  const entries = entriesOf(c);
  entries[at] = { id: disc.id, kind: disc.kind, title: disc.title ?? null, artist: disc.artist ?? null, done: false, finishedAt: null, played: [], tracks: tracks.slice() };
  const stand = play || !here ? { slot: at, offset: 0 } : here;
  const nextDisc = next ? at : c.nextDisc === at ? null : c.nextDisc;
  return { changer: build(entries, stand, nextDisc), slot: at, replaced };
}

/** Takes the disc in `slot` out. The playing disc's going moves on as DISC SKIP would (or stands nowhere). */
export function eject(c, slot, modes = {}, rnd = Math.random) {
  if (!c.slots[slot]) return c;
  const here = slotOf(c, c.index);
  let stand = here;
  if (here && here.slot === slot) {
    const skip = discSkip(c, modes, rnd);
    stand = skip >= 0 ? slotOf(c, skip) : null;
  }
  const entries = entriesOf(c);
  entries[slot] = null;
  return build(entries, stand, c.nextDisc === slot ? null : c.nextDisc);
}

/** Files gone from the disk leave their discs (an emptied disc frees its slot); the changer stays on the same song. */
export function removePaths(c, gone) {
  const here = slotOf(c, c.index);
  let stand = null;
  if (here && !gone.has(c.queue[c.index])) {
    stand = { slot: here.slot, offset: tracksOf(c, here.slot).slice(0, here.offset).filter((p) => !gone.has(p)).length };
  }
  const entries = c.slots.map((d, s) => (d ? { ...withoutRun(d), played: [], tracks: tracksOf(c, s).filter((p) => !gone.has(p)) } : null));
  return build(entries, stand, c.nextDisc);
}

/**
 * An old flat queue (2.14 and before) as discs: a run of two or more tracks of the same album (`albumOf(p)` → { key,
 * title, artist, kind? } or null) is a disc; neighbouring other tracks are one CD-R titled `cdrTitle`. More than five
 * discs: the playing one and the four after it (wrapping round). → { changer, dropped }.
 */
export function fromQueue(paths, index, albumOf, { cdrTitle }) {
  const runs = [];
  paths.forEach((p, i) => {
    const a = albumOf(p), key = a ? a.key : null, last = runs[runs.length - 1];
    if (last && key && last.key === key) { last.tracks.push(p); last.to = i; } else runs.push({ key, album: a, tracks: [p], from: i, to: i });
  });
  const discs = [];
  for (const r of runs) {
    if (r.key && r.tracks.length >= 2) {
      discs.push({ disc: { id: `album:${r.key}:${r.from}`, kind: r.album.kind || 'album', title: r.album.title, artist: r.album.artist }, tracks: r.tracks, from: r.from, to: r.to });
      continue;
    }
    const last = discs[discs.length - 1];
    if (last && last.disc.kind === 'cdr') { last.tracks.push(...r.tracks); last.to = r.to; }
    else discs.push({ disc: { id: `cdr:${r.tracks[0]}`, kind: 'cdr', title: cdrTitle, artist: null }, tracks: [...r.tracks], from: r.from, to: r.to });
  }
  const playing = Math.max(0, discs.findIndex((d) => index >= d.from && index <= d.to));
  const kept = discs.length <= SLOTS ? discs : Array.from({ length: SLOTS }, (_, k) => discs[(playing + k) % discs.length]);
  const entries = Array(SLOTS).fill(null);
  kept.forEach((d, s) => { entries[s] = { ...d.disc, done: false, finishedAt: null, played: [], tracks: d.tracks }; });
  const stand = index >= 0 && discs.length ? { slot: kept.indexOf(discs[playing]), offset: index - discs[playing].from } : null;
  return { changer: build(entries, stand, null), dropped: discs.length - kept.length };
}

// ---- The order: which song comes next, by the changer's modes ----------------------------------------------------

const occupied = (c) => c.slots.map((d, s) => (d ? s : -1)).filter((s) => s >= 0);
// The next occupied slot after `slot` (round to the first with `wrap`), or -1.
function slotAfter(c, slot, wrap) {
  const occ = occupied(c);
  const later = occ.find((s) => s > slot);
  return later != null ? later : wrap && occ.length ? occ[0] : -1;
}
const offsets = (d) => Array.from({ length: d.end - d.start }, (_, k) => k);
const unplayed = (d) => offsets(d).filter((k) => !d.played.includes(k));
const pick = (list, rnd) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];

/** The queue position to play after the one the changer stands on, by `modes` — or -1 at the end. */
export function nextIndex(c, { shuffle = 'OFF', repeat = 'OFF' } = {}, rnd = Math.random) {
  const here = slotOf(c, c.index);
  if (!here) return -1;
  if (repeat === 'TRACK') return c.index;
  const d = c.slots[here.slot], len = d.end - d.start;
  if (shuffle === 'ALL') {
    const left = c.slots.flatMap((x) => (x ? unplayed(x).map((k) => x.start + k) : [])).filter((i) => i !== c.index);
    if (left.length) return pick(left, rnd);
    if (repeat === 'OFF') return -1;
    const any = c.queue.map((_, i) => i).filter((i) => i !== c.index);
    return any.length ? pick(any, rnd) : c.index;
  }
  if (shuffle === 'DISC') {
    const left = unplayed(d).filter((k) => k !== here.offset);
    if (left.length) return d.start + pick(left, rnd);
    if (repeat === 'DISC') { const others = offsets(d).filter((k) => k !== here.offset); return d.start + (others.length ? pick(others, rnd) : here.offset); }
  } else if (here.offset + 1 < len) return c.index + 1;
  else if (repeat === 'DISC') return d.start;
  const to = c.nextDisc != null && c.nextDisc !== here.slot ? c.nextDisc : slotAfter(c, here.slot, repeat === 'ALL');
  if (to < 0) return -1;
  const n = c.slots[to];
  if (shuffle === 'DISC') { const l = unplayed(n); return n.start + pick(l.length ? l : offsets(n), rnd); }
  return n.start;
}

/** The song before: the previous one on the disc, or the last of the disc before. -1 at the very start. */
export const previousIndex = (c) => (c.index > 0 ? c.index - 1 : -1);

/** DISC SKIP: the next occupied slot (round to the first), its first song — a random one when shuffling. -1: no other disc. */
export function discSkip(c, { shuffle = 'OFF' } = {}, rnd = Math.random) {
  const here = slotOf(c, c.index);
  if (!here) return -1;
  const to = slotAfter(c, here.slot, true);
  if (to < 0 || to === here.slot) return -1;
  const n = c.slots[to];
  return shuffle === 'OFF' ? n.start : n.start + pick(offsets(n), rnd);
}

/** A slot's button (or a click on its disc): its first song, or -1 for an empty slot. */
export const playSlot = (c, slot) => (c.slots[slot] ? c.slots[slot].start : -1);

/** The changer stands on `index`: PLAY NEXT's disc, reached, is no longer marked; a finished disc played again isn't. */
export function moveTo(c, index) {
  const here = slotOf(c, index);
  if (!here) return { ...c, index: -1 };
  let slots = c.slots.slice();
  // Every song of every disc played (SHUFFLE ALL's round is over): playing on starts a new round.
  if (slots.every((d) => !d || d.played.length >= d.end - d.start)) slots = slots.map((d) => d && { ...d, played: [] });
  if (slots[here.slot].done) slots[here.slot] = { ...slots[here.slot], done: false, finishedAt: null };
  return { ...c, slots, index, nextDisc: c.nextDisc === here.slot ? null : c.nextDisc };
}

/** The song at `index` played to its end: noted; its disc is finished at its last song (shuffled: once all have played). */
export function markFinished(c, index, { shuffle = 'OFF' } = {}, now = Date.now()) {
  const here = slotOf(c, index);
  if (!here) return c;
  const slots = c.slots.slice(), d = slots[here.slot], len = d.end - d.start;
  const played = d.played.includes(here.offset) ? d.played : [...d.played, here.offset];
  const over = shuffle === 'OFF' ? here.offset === len - 1 : played.length >= len;
  // SHUFFLE DISC starts the disc's next round afresh; SHUFFLE ALL keeps count until every disc has played.
  slots[here.slot] = over ? { ...d, done: true, finishedAt: now, played: shuffle === 'ALL' ? played : [] } : { ...d, played };
  return { ...c, slots };
}
// ---- changer.txt: "v1<TAB>nextDisc|-", then a line per slot: "-" or kind, start, end, done, finishedAt, id, title, artist ----

const clean = (s) => (s == null ? '' : String(s).replace(/[\t\n\r]+/g, ' '));
export function serialize(c) {
  const lines = [`v1\t${c.nextDisc ?? '-'}`];
  for (const d of c.slots) {
    lines.push(d ? [d.kind, d.start, d.end, d.done ? 1 : 0, d.finishedAt ?? '', clean(d.id), clean(d.title), clean(d.artist)].join('\t') : '-');
  }
  return lines.join('\n');
}
/** changer.txt's text for this queue → the changer, or null when it's missing, unreadable or doesn't fit the queue. */
export function parse(text, queue, index) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  const head = /^v1\t(\d|-)$/.exec(lines[0] || '');
  if (!head || lines.length < SLOTS + 1) return null;
  const slots = [];
  for (let s = 0; s < SLOTS; s++) {
    const line = lines[s + 1];
    if (line === '-') { slots.push(null); continue; }
    const [kind, start, end, done, finishedAt, id, title, artist] = line.split('\t');
    if (!['album', 'cdr', 'spotify', 'audiocd'].includes(kind) || !id) return null;
    slots.push({ id, kind, title: title || null, artist: artist || null, start: Number(start), end: Number(end), done: done === '1', finishedAt: finishedAt ? Number(finishedAt) : null, played: [] });
  }
  const c = { slots, queue: queue.slice(), index: index >= 0 && index < queue.length ? index : -1, nextDisc: head[1] === '-' ? null : Number(head[1]) };
  try { check(c); } catch { return null; }
  return c;
}

const key = (s) => String(s || '').toLowerCase().trim();
/**
 * The disc that `paths` (with their `details`) make: their one album, or a CD-R — titled `title` (a playlist's name), or
 * untitled: it's written on when shown, in the interface's language, with the day it was made (cdrMadeAt). `kind` overrides.
 */
export function discFor({ kind = null, paths, details, title = null, now = Date.now() }) {
  const artistOf = (d) => (d && ((d.credits && d.credits.albumArtist) || d.artist)) || '';
  const first = details[0];
  // An album disc takes at least two songs of one album; a single song is a loose pick (a CD-R). The id is this disc's
  // own (`now`): a disc is the same as another only by its very songs (or a shelf album's id), never by its tags.
  const one = paths.length >= 2 && first && first.album && details.length === paths.length
    && details.every((d) => d && key(d.album) === key(first.album) && key(artistOf(d)) === key(artistOf(first)));
  if (one) return { id: `album:${key(artistOf(first))}\n${key(first.album)}:${now}`, kind: kind || 'album', title: first.album, artist: artistOf(first) || null };
  return { id: `${kind || 'cdr'}:${now}`, kind: kind || 'cdr', title, artist: null };
}
/** When a CD-R was made (its id says), or null — one brought over from an old queue doesn't know. */
export function cdrMadeAt(disc) {
  const m = /^cdr:(\d{10,})$/.exec(disc.id || '');
  return m ? new Date(Number(m[1])) : null;
}

/** The tray's turn (degrees) that brings `slot` to the laser, on the right: a fifth of a turn a slot. */
export const trayAngle = (slot) => 90 - slot * 72;

/** The slot a shelf album ({ id, tracks: [{ path }] }) is in: a disc with its id, or holding one of its songs. -1: none. */
export function slotOfAlbum(c, album) {
  const mine = new Set(album.tracks.map((x) => x.path));
  return c.slots.findIndex((d) => d && (d.id === album.id || c.queue.slice(d.start, d.end).some((p) => mine.has(p))));
}

/**
 * The changer at launch: changer.txt read against the queue as it was saved (`savedPaths`, `savedIndex`), then the
 * files gone since (`missing`) taken out of their discs — the slots, done marks and PLAY NEXT stay. null when the
 * text can't be read (then it's rebuilt from the queue with fromQueue).
 */
export function restore(text, savedPaths, savedIndex, missing) {
  const c = parse(text, savedPaths, savedIndex);
  return c && (missing.size ? removePaths(c, missing) : c);
}
