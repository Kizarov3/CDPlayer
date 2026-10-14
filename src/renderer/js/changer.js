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
  const have = c.slots.findIndex((d) => d && d.id === disc.id);
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
      discs.push({ disc: { id: `album:${r.key}`, kind: r.album.kind || 'album', title: r.album.title, artist: r.album.artist }, tracks: r.tracks, from: r.from, to: r.to });
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

// (Task 2 adds the order: nextIndex, previousIndex, discSkip, playSlot, moveTo, markFinished.)
export function discSkip() { return -1; }
