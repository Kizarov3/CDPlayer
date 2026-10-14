# CD changer — design

## Goal

The queue becomes a five-disc carousel changer. Music is loaded as discs into five slots; the player plays them disc
by disc, with a changer's shuffle and repeat modes, and the carousel turns to bring each disc to the laser. It replaces
the queue list: there is no other place music plays from.

## Decisions (agreed)

- The changer **replaces the queue** (not a separate mode).
- Everything that used to go into the queue becomes a **disc**: a shelf album or a dropped folder is an album disc;
  loose tracks added in one action are one **CD-R** (written on in marker, "MIX · 14 OCT"); an `.m3u` playlist is a
  CD-R named after it; a Spotify album or playlist is a disc; a real Audio CD is a disc.
- **Five slots.** A new disc takes the lowest free slot; with none free, the slot of the disc that finished longest
  ago (it goes back to the shelf); with none finished, the user picks which disc to take out.
- **Changer modes.** SHUFFLE: OFF → DISC → ALL. REPEAT: OFF → TRACK → DISC → ALL. Plus **DISC SKIP**.
- **Look:** the carousel replaces the queue list on the right; the disc in its jewel case on the left stays.
- **Architecture: slots over the flat queue.** `state.queue` stays a flat list of paths — what playback, gapless,
  crossfade, the mini player, Spotify and the saved queue already work from — and `state.discs` marks which run of it
  each slot holds. All changes to both go through a pure module, `changer.js`.

## The model — `src/renderer/js/changer.js` (pure, no DOM)

- A changer is `{ slots: [Disc | null] × 5, queue: string[], index, nextDisc: slot | null }`, where
  `Disc = { id, kind: 'album' | 'cdr' | 'spotify' | 'audiocd', title, artist, start, end, done, finishedAt }`.
  `queue` is the discs' tracks in slot order; `[start, end)` is a disc's run of it. Empty slots hold no tracks.
- **Invariant** (checked by tests after every operation): the occupied slots' runs are back to back, in slot order,
  and cover the whole queue; `index` is inside a disc or `-1`.
- `load(changer, disc, tracks, { play, next })` → `{ changer, slot }` or `{ full: true }` when every slot holds an
  unfinished disc. `play`: it plays now. `next` (PLAY NEXT): it's marked `nextDisc`, played when the current disc ends.
  A disc already in the changer (same `id`) isn't loaded twice: `{ changer, slot, already: true }`.
- `eject(changer, slot)` → changer. Ejecting the playing disc first moves on as DISC SKIP would.
- `clear(changer)`.
- `slotOf(changer, index)`.
- `nextIndex(changer, { shuffle, repeat }, rnd)` and `previousIndex(…)`:
  - in order: the next track of the disc; at its end, `nextDisc` if set, else the next occupied slot (wrapping only
    with REPEAT ALL); after the last, `-1`.
  - REPEAT TRACK: the same track; REPEAT DISC: the disc's first track after its last.
  - SHUFFLE DISC: an unplayed track of this disc at random; once all are played, the next disc (shuffled too).
  - SHUFFLE ALL: an unplayed track of any disc at random.
  - Played tracks are tracked per disc for the shuffles; a disc is **done** when its last track (in order) or, shuffled,
    all of its tracks have played. `finishedAt` decides which finished disc makes room first.
- `discSkip(changer, mode, rnd)`: the next occupied slot's first track (a random one when shuffling).
- `removePaths(changer, paths)`: files gone from the disk leave their discs; an emptied disc frees its slot.
- `fromQueue(queue, index, detailsFor)`: an old flat queue as discs — a run of two or more tracks of the same album is
  an album disc; neighbouring single tracks of different albums are one CD-R. More than five discs: the playing one and
  the four after it are kept. → `{ changer, dropped }`.

## Persistence

`changer.txt` beside `queue.txt` (`store.js`): one line per slot — empty, or the disc's kind, start, end, done,
finishedAt, id, title and artist, tab-separated — plus the `nextDisc` line. `queue.txt` stays as it is. A missing or
unreadable `changer.txt` with a `queue.txt` is the upgrade: `fromQueue`, then the status line says
"5 DISCS IN THE CHANGER · {n} WENT BACK TO THE SHELF" when some didn't fit.

## The app — `src/renderer/js/app.js`

- `addToQueue` / `playNext` / the shelf's PLAY / drag and drop / LOAD A TRACK / `.m3u` LOAD / Spotify / Audio CD all
  build a disc and call `load`. A full changer opens the **which disc goes back** picker (five covers; Esc cancels and
  nothing is loaded).
- `nextTrack` / `previousTrack` / track end / gapless preload / Spotify's upcoming list use `nextIndex` /
  `previousIndex` instead of today's queue arithmetic.
- The shuffle and repeat buttons cycle the changer modes; their badges say DISC / ALL / 1.
- **Spotify next to file discs.** Today a Spotify disc fills the queue on its own. When the next track is on a disc
  of the other kind, the playing engine stops at the end of its track and the other one starts: no gapless or
  crossfade across that seam. This is checked first in implementation; if mixing turns out fragile, a Spotify disc
  unloads the others instead (and the user is asked first).
- The open tray (`E`): music dropped on it is a new disc, played at once.

## The carousel — `src/renderer/js/changer-view.js`

- Replaces the queue list: a tray seen from above, five small discs round it with their covers printed (like the big
  disc), the slot numbers moulded in the tray; an empty slot is an empty recess; a finished disc is dimmed; the
  `nextDisc` has a small arrow. The playing disc sits at the laser, on the side facing the big disc.
- A disc change turns the tray one way, ~0.4 s a slot, while the big disc spins down, takes the new cover and spins
  up. With animation off it's immediate.
- Clicking a disc plays it from its first track (as a changer's DISC 3 button); hover says its title, artist and slot.
- Under the tray: "DISC 3 · Ænima · Tool", the playing disc's tracklist (click to play a track), and DISC SKIP,
  EJECT, SEARCH (all discs), LOAD (`.m3u` → CD-R), SAVE (this disc as `.m3u`), CLEAR (with its undo, as today).
- Info line: "DISC 3 · 2 / 15 · SHUFFLE: DISC".
- Tracks inside a disc can't be removed or reordered; discs can't be moved between slots.

## Elsewhere

- **Shelf:** ADD TO QUEUE becomes INTO THE CHANGER; the spine of an album in the changer shows its slot number;
  "ALREADY IN SLOT 3" turns the carousel to it instead of loading it again.
- **Keys:** `D` DISC SKIP; `1`–`5` play that slot's disc. The shortcuts list and help say so.
- **Mini player:** "DISC 3" in its line; no carousel.
- **Translations:** every new text in `ru.json` (100 %).

## Testing

- `test/changer.test.mjs`: load (free slot, finished slot, full, PLAY NEXT, already loaded), eject (playing and not),
  clear, next/previous in every mode, done and finishedAt, disc skip, removePaths, fromQueue (album runs, CD-R of
  singles, more than five), and the invariant after each.
- The persistence round trip and the upgrade from `queue.txt` alone (with a fake home).
- The app in an isolated instance (`CDPLAYER_HOME`), driven over DevTools, with screenshots of the carousel, a disc
  change, the full-changer picker and the shelf's slot numbers.
- No platform code: no Windows VM check needed.
