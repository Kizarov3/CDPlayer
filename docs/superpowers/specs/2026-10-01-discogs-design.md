# Discogs for collectors — design

## Goal

Every album on the shelf knows its exact pressing and what it's worth now: label, catalogue number, country, year,
format, how many people have it and want it, and the lowest price on Discogs' marketplace — on the case, in the booklet,
as a way to sort the shelf, and as the shelf's total. Nothing is sent until the user opens a case or asks for the shelf
to be appraised.

## Decisions (agreed)

- Scope B: the pressing and its price (no writing to the user's Discogs collection — a later step).
- Finding the release: MusicBrainz release ID from the tags when there is one; otherwise Discogs' own search (it works
  without a token, checked 2026-10-01: `x-discogs-ratelimit: 25`). A personal token is optional and only makes
  appraising faster (60 requests a minute instead of 25).
- When: a case's pressing and price when it's opened; the whole shelf only on **APPRAISE** or **SORT: PRICE**.

## Finding an album's release

`src/main/discogs.js`, for an album from the shelf `{ id, artist, title, year, trackCount, barcode, catalog, label,
mbReleaseId }`, tries in order until one gives a Discogs release:

1. `mbReleaseId` (tag `musicbrainz_albumid`, newly read): MusicBrainz `release/<id>?inc=url-rels` through the existing
   `mbFetch`; its `discogs` URL relation → `{ kind: 'release' | 'master', id }`.
2. `barcode` (digits only, 8–14): Discogs `database/search?barcode=<b>&type=release`.
3. Discogs `database/search?artist=<artist>&release_title=<title>&format=CD&type=release&per_page=25`.
4. A master (from step 1) → `masters/<id>` → its `main_release`.

`pickRelease(candidates, album)` scores search results: +4 same barcode, +3 same catalogue number (compared without
spaces/dashes, case-insensitive), +2 track count equal (from the release's `tracklist` when fetched, else not scored),
+1 same year, +1 same label; ties keep Discogs' order. A result whose title or artist doesn't match the album
(`sameName`) is dropped. No candidate → "not on Discogs".

Then `releases/<id>` → `summarize(release)` = `{ id, label, catno, country, year, formats, barcode, have, want, uri,
masterId }` and `marketplace/stats/<id>?curr_abbr=<currency>` → `{ lowest: number | null, currency, forSale }`.

## Requests

- One queue for all Discogs requests: at least 2.5 s apart without a token, 1.1 s with one. `User-Agent: CDPlayer/<version>
  +https://github.com/Kizarov3/CDPlayer`; with a token, `Authorization: Discogs token=<token>`.
- HTTP 429: wait 60 s, then go on with the same request. A network failure ends the request with `OFFLINE`.
- MusicBrainz requests keep going through `mbFetch` (one a second).

## Cache

`discogs.json` in the data folder, by the shelf's album id:
`{ version: 1, albums: { [id]: { releaseId | null, by: 'auto' | 'user', info, price, checkedAt, pricedAt } } }`.
- `info` kept 180 days; `price` 30 days; "not on Discogs" (`releaseId: null`) retried after 7 days.
- A release chosen by hand (`by: 'user'`) is never replaced by a lookup; only its price is refreshed.
- A currency change makes every price stale.

## Interface

**The case** (a shelf album pulled out), under its tracks line, a **PRESSING** block:
- `PARLOPHONE · 7243 5 29590 2 9 · UK · 2000 · CD, Album`
- `from $12 · 34 for sale · 21,304 have · 3,112 want` (no listing: `not for sale`)
- **DISCOGS** (opens the release page) and **OTHER PRESSING…** (a menu of the master's CD versions, `label · catno ·
  country · year`, from `masters/<id>/versions?format=CD`; choosing one is kept, `by: 'user'`).
- States: `LOOKING ON DISCOGS…`, `NOT ON DISCOGS` (with OTHER PRESSING… hidden unless a master is known),
  `DISCOGS UNAVAILABLE` when offline.
- **★ RARE** sticker on the case, a small gold dot on its spine: lowest price ≥ 40 in the chosen
  currency (6000 for JPY), or `want > have` with `have ≥ 10`.

**The shelf:**
- **SORT: PRICE**, after COLOR: most expensive first; dividers `50+`, `20–50`, `10–20`, `UNDER 10`, `NO PRICE`, in the
  currency (`$50+`, `€20–50`; JPY bands ×150). Choosing it starts the appraisal.
- **APPRAISE** button in the shelf's top bar. While appraising, the count line reads `APPRAISING · 120 / 500` and the
  button reads `STOP`. Albums already known (cache fresh) are skipped. Done: `THE SHELF ≈ $1,240` (sum of lowest prices
  found) after the folder name.
- Appraising goes on with the shelf closed; it stops when the app quits; what's found is kept.

**The booklet** (CREDITS page): LABEL, CATALOG NO. and BARCODE from Discogs where the tags have none; COUNTRY and
PRESSING (formats) added.

**Library Check:** a group **NOT ON DISCOGS** (albums looked up and not found) with **CHOOSE PRESSING…**, which opens a
Discogs search menu for that album (the top 10 results of step 3, `artist — title · label · catno · country · year`).

**Settings → DISCOGS:**
- **TOKEN**: PASTE / REMOVE, "Get a token" opens `https://www.discogs.com/settings/developers`; checked with
  `oauth/identity` before it's kept (`TOKEN DIDN'T WORK` otherwise). A later 401 drops it: `TOKEN NO LONGER WORKS`.
- **CURRENCY**: USD (default), EUR, GBP, JPY, CAD, AUD, CHF, SEK, NZD, MXN, BRL, ZAR.
- Hint: "Prices are the lowest on Discogs' marketplace, refreshed monthly. A token makes appraising the shelf faster."

Every new text goes through `t()` and is translated in `ru.json`.

## Code units

- `src/main/discogs.js`: `createDiscogs({ fetchJson, mbFetch, read, write, now, sleep, token: () => string|null,
  currency: () => code })` → `{ lookup(album), appraise(albums, onProgress), stopAppraise(), versions(masterId),
  search(album), choose(albumId, releaseId), known(ids), setToken, verifyToken }`. Pure, exported for tests:
  `discogsLink(mbRelease)`, `pickRelease(candidates, album)`, `summarize(release)`, `isStale(entry, now, currency)`.
- `src/main/store.js`: `discogs.txt` (token, currency); `settings` gets nothing new.
- `src/main/metadata.js`, `src/main/shelf.js`: read `musicbrainz_albumid`; album gets `mbReleaseId`, `barcode`,
  `catalog`, `label` (most common among its tracks); shelf cache version 3.
- IPC: `discogs:lookup`, `discogs:appraise`, `discogs:stop`, `discogs:versions`, `discogs:search`, `discogs:choose`,
  `discogs:known`, `discogs:settings`, `discogs:setToken`, `discogs:setCurrency`; event `discogs-progress`
  `{ done, total, albumId, entry }`.
- `src/renderer/js/shelf-discogs.js` (pure): `pressingLine(info)`, `priceLine(price, info)`, `money(value, currency)`,
  `priceBand(value, currency)`, `isRare(entry)`, `shelfTotal(entries)`.
- `shelf-order.js`: `'PRICE'` sort; `shelf.js`: PRESSING block, sticker, spine dot, APPRAISE; `booklet-content.js`:
  credits rows; `panels.js`: Settings section, Library Check group, pressing menus.

## Errors

- Offline during a lookup → `DISCOGS UNAVAILABLE` on the case; during appraising → stops with
  `APPRAISAL STOPPED · NO CONNECTION`; found entries are kept.
- 429 → waits (the count line says `WAITING FOR DISCOGS…`).
- A token that stops working → dropped, as above; the queue goes on at the slower pace.
- A release without a price → `not for sale`; it isn't in the total and sorts under NO PRICE.

## Testing

`test/discogs.test.js` (fake `fetchJson`/`mbFetch`/clock/sleep; `CDPLAYER_HOME` temp dir):
- each finding step (MB ID → release; MB ID → master → main release; barcode; search) and the order they're tried;
- `pickRelease`: barcode beats catalogue beats track count; wrong artist/title dropped; ties keep order;
- cache: fresh entries not fetched, stale price refetched, user choice kept, currency change, "not found" retry;
- queue spacing with and without a token, 429 wait, `stopAppraise`, offline;
- `test/shelf-discogs.test.mjs`: lines, money formatting in English and Russian, bands per currency, `isRare`, total.

By hand: the real shelf without a token — open cases, OTHER PRESSING…, APPRAISE, SORT: PRICE, booklet, Library Check;
then with a token; then in Russian.

## Out of scope

Writing to the user's Discogs collection or wantlist (OAuth), price history, sales prices (Discogs only gives those to
sellers).
