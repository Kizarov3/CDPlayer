# CD changer as a mode — design

## Goal

The CD changer (2026-10-14) replaced the queue. It becomes a **mode** instead: by default CDPlayer has its queue as in
2.14; Settings → CHANGER: ON switches to the five-disc changer. Queue and changer keep **their own music**.

## Decisions (agreed)

- **Two stores.** The queue and the changer each keep their contents and where you were. Switching the mode saves the
  one in use and brings up the other: its song loaded at its saved position, not playing.
- **The switch is in Settings** (Look section): CHANGER: OFF / ON. Default OFF.
- **Queue mode is 2.14's queue**: the list, drag to reorder, × to remove a song, PLAY NEXT (play-next.js), SHUFFLE
  on/off, REPEAT off / track / all, a Spotify disc or a new disc on the tray replacing the queue, `queue.txt` in 2.14's
  format.
- **Changer mode is the changer as it is now**: carousel, slots, DISC SKIP / EJECT, `D` and `1`–`5`, SHUFFLE off / disc /
  all, REPEAT off / track / disc / all, the full-changer picker.

## Where the mode shows

- The queue card: the list (queue) or carousel + the playing disc's tracklist (changer). DISC SKIP and EJECT only in the
  changer.
- Shelf: ADD TO QUEUE (queue) or INTO THE CHANGER (changer); slot numbers on spines only in the changer.
- Drag and drop, LOAD A TRACK, SEARCH, HISTORY, playlists, Spotify, Audio CD: into whichever mode is on.
- `D`, `1`–`5`: changer only. Mini player's "DISC n": changer only. The booklet's tracklist: the playing disc
  (changer) or the album's songs together in the queue (queue, as 2.14).
- SHUFFLE / REPEAT: one setting, cycled through the mode's own values; switching to the queue turns DISC into ALL.

## Persistence

- Queue: `queue.txt`, unchanged from 2.14.
- Changer: `changer-queue.txt` (same format as queue.txt: its flat list, index, position) and `changer.txt` (its
  slots). `store.writeQueue({ …, mode })` writes the active mode's files; `state:load` returns both stores.
- Settings: a new `changer` line (ON / OFF), default OFF.
- **Upgrade from the changer build** (changer.txt but no changer-queue.txt): queue.txt held the changer's list, so the
  changer gets queue.txt + changer.txt, and the queue starts from the same list.

## In the code

- `app.js` keeps one set of transport functions; each asks `state.changerMode` where the changer and the queue differ
  (upcoming / previous / move / note played / add / tray / clear / remove paths / render / Spotify's disc end / save).
- `changer.js`, `changer-view.js` unchanged. `play-next.js` and its test come back from git.
- Switching: `setChangerMode(on)` saves the active store, swaps in the other, renders, loads its song paused.

## Testing

- `store`: both files written by mode, read back; the upgrade path; the settings line.
- `play-next.test.mjs` back.
- The app in an isolated instance, Russian, both modes: the screen tour (no text cut or spilling), switching back and
  forth keeps each mode's music and position, shelf / keys per mode.
