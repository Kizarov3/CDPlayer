# Missing albums on the shelf

Date: 2026-09-29 · Status: approved; revised 2026-09-29 — studio albums only

## Goal

On the shelf, sorted by artist, each artist you have a few albums of gets a box after them saying how many of their
studio albums you don't have: **+5 MISSING**. Click it and their missing releases stand on the shelf as empty, see-through
places, oldest first. Click one and a ghost case comes out, with its cover and tracklist, to play it on Spotify, look
it up on MusicBrainz, or say you're not interested and never see it again.

Revision (after trying it): **studio albums only** — MusicBrainz primary type Album with no secondary type; live
records, compilations, soundtracks, remixes, EPs and singles are left out, so there are no type labels or slim single
cases. The request asks for `type=album` (fewer pages); the shelf keeps only those with no secondary type.

Originally: count every official release — albums of every kind (studio, live, compilations, soundtracks,
remixes), EPs **and singles**; one collapsed box per artist that opens on a click; a ghost case with PLAY ON SPOTIFY,
MUSICBRAINZ and NOT INTERESTED; look discographies up lazily, as an artist's spines come into view (like covers).
Approved each part of this design in turn.

## What the user sees

- Only under **SORT: ARTIST**, and only for an album artist (not "Various Artists") with **at least two** albums on
  the shelf. Right after their last album stands a box, a see-through cardboard card with a dashed edge:
  - `…` while their discography is being looked up;
  - `+47 MISSING` — click to open (their missing releases stand between their last album and the box), click again
    to close;
  - `COMPLETE ★` when there's nothing missing (leaving out what they said NOT INTERESTED to);
  - no box at all when MusicBrainz doesn't know the artist, or they have fewer than two albums on the shelf.
- A missing release's place: a spine with a dashed outline at about 35% opacity, its title and year written
  vertically like a real spine, and at its foot a small label of what it is — `LIVE`, `COMP`, `OST`, `REMIX`, `EP`,
  `SINGLE` (a studio album has none). A single's place is thin, 18 px, like a slim CD-single case; everything else is
  30 px. Oldest first.
- No dust, stickers, NEW, notes or dragging on a missing place — there's nothing to carry.
- The shelf's filter: matching an artist's name keeps their box; open, their missing places are filtered by their own
  titles like albums are. PULL ONE never picks a missing place.
- Which boxes are open lasts until the shelf is closed; it always opens with every box closed.
- Click a missing place → a **ghost case** slides out as a real case does, see-through with a dashed edge:
  - the cover from the Cover Art Archive (`https://coverartarchive.org/release-group/<id>/front-250`), or while it
    loads / when there's none, an empty clear case with the title in marker, like a CD-R's;
  - the title, `Artist · Year · Type`, and the tracklist, from the group's first official release — `…` while it's
    looked up, `COULDN'T REACH MUSICBRAINZ` if it can't be;
  - **PLAY ON SPOTIFY** (only while Spotify is connected): searches Spotify for `album:<title> artist:<artist>` and
    takes the first album whose title is the same (`sameName`); it goes in as a disc (`playSpotifyDisc`) and the shelf
    closes. None found → `NOT ON SPOTIFY` in the status line;
  - **MUSICBRAINZ**: opens `https://musicbrainz.org/release-group/<id>` in the browser;
  - **NOT INTERESTED**: closes the case; the place leaves the shelf for good and the box's count goes down;
  - **BACK ON THE SHELF**, and Esc, as for a real case.

## Design

### 1. Knowing the artist — `src/main/shelf.js`, `src/main/metadata.js`

- `trackInfo()` also keeps the album artist's MusicBrainz ID when the tags have one (`musicbrainz_albumartistid`, as
  music-metadata reads it; written by TAGS, the ripper and Picard). `CACHE_VERSION` goes up to 2, so the first shelf
  after the update reads every file's tags again once, like the very first time.
- `groupAlbums()` gives each album `artistMbid` (the first track's that has one).

### 2. Discographies — `src/main/discography.js` (new)

- `discographyFor({ artist, mbid })` → `{ state: 'found', groups }` / `{ state: 'unknown' }`, or throws on a network
  error. `groups`: `[{ id, title, type, secondary: [], year }]`, official release groups only.
- The artist: by `mbid` when there is one; otherwise `artist?query=artist:"<name>"` and the first result whose name or
  one of its aliases is the same by `sameName`. None → `unknown`.
- The releases: `release-group?artist=<id>&release-group-status=website-default&limit=100`, a page at a time
  (`offset`) until all are read. `release-group-status=website-default` is MusicBrainz's own "official" filter; groups
  with only bootleg/promo/pseudo releases are left out (checked: Radiohead has 106 such groups against 585 in all).
- Every request through `online.js`'s `mbFetch` (exported for this), so all of CDPlayer keeps to MusicBrainz's one
  request a second.
- Cache `discography.json` in the data folder: `{ version: 1, artists: { [sameName(artist)]: { mbid, fetched,
  state, groups } } }`. A found discography is looked up again after **30 days**; `unknown` after **7 days**. A
  network error isn't cached.
- A queue: one artist at a time. `want(keys)` is told which artists are on screen now; a waiting artist no longer
  wanted is dropped before its turn. Each answer goes to the renderer as `discography` events `{ key, state, groups }`.
- `tracklist(groupId)` → `[{ title, length }]` from `release?release-group=<id>&status=official&inc=recordings&limit=1`
  (in memory for the session).

### 3. Hidden places — `src/main/store.js`

`missing-hidden.txt`: a release-group ID per line, for NOT INTERESTED. `readHiddenMissing()` → Set,
`writeHiddenMissing(set)`.

### 4. What's missing, and where it stands — `src/renderer/js/shelf-missing.js` (new, pure)

- `artistsWanting(albums)` → the artists with a box: album artist not "Various Artists", ≥ 2 albums.
- `missingFor(groups, owned, hidden)` → the groups whose title isn't one of `owned` (the artist's album titles) by
  `sameName`, not hidden, oldest first (no year last).
- `withMissing(items, boxes)` → the ARTIST-sorted shelf with each artist's box after their last album, and their
  places before the box when it's open.
- `typeLabel(group)` → `LIVE` / `COMP` / `OST` / `REMIX` / `EP` / `SINGLE` / `''` (secondary type first, then EP or
  Single), and `isSlim(group)` for a single.
- `sameName`, the shelf's way of comparing names, is copied here (the renderer's modules are ES modules, main's are
  CommonJS); `shelf.js` exports its own, and a test checks the two agree on a list of tricky names.

### 5. The shelf — `src/renderer/js/shelf.js`, `styles.css`

- The IntersectionObserver that loads covers also tells main which artists' spines are on screen (`cdp.wantDiscography`),
  a moment after scrolling settles.
- `discography` events fill in the boxes; a box, its places and the ghost case are drawn as described above.
- The ghost case reuses `openCase`'s layout with a `ghost` class, its own actions, and `cdp.missingTracklist(id)`.

### 6. IPC — `main.js`, `preload.js`

`discography:want(artists)`, `discography:tracklist(groupId)`, `discography:hide(groupId)`, the `discography` event;
`shelf:albums` also carries `hiddenMissing`. `cdp.openUrl` for MUSICBRAINZ (checked to be a musicbrainz.org URL).

## Errors

- Offline, or MusicBrainz busy (503): the box stays `…`; the artist is asked about again when next on screen. No
  errors shown on the shelf.
- The tracklist can't be had: `COULDN'T REACH MUSICBRAINZ` in the ghost case; its buttons still work.
- Albums added or re-tagged: what's missing is worked out in the renderer each time the shelf is drawn, so a new rip
  fills its place at once, without asking MusicBrainz.

## Testing

- `test/discography.test.js`, with `mbFetch` stubbed: by MBID; by name (exact, by alias, unknown); every page read;
  only official; cache kept 30 days / 7 days for unknown; a network error not cached; an unwanted artist dropped
  from the queue.
- `test/shelf-missing.test.mjs`: `sameName` agrees with main's; what's missing (`sameName` matches, hidden left out, oldest first); the two-album
  threshold and Various Artists; box and places in ARTIST order, open and closed; type labels and slim singles.
- `test/state.test.js`: `missing-hidden.txt` round-trip.
- In the app, on a test profile with real requests to MusicBrainz: boxes appear as artists scroll into view, open and
  close, a ghost case's cover and tracklist load, NOT INTERESTED removes a place and survives a restart, MUSICBRAINZ
  opens the right page.

## Not in this

Other sorts than ARTIST; artists with one album; buying links; telling apart a missing release from an edition of one
you have under another title (e.g. a deluxe reissue named differently shows as missing — NOT INTERESTED is for that).
