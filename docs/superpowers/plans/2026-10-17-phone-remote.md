# Phone Remote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A page on the phone, opened by a QR code on the home Wi-Fi, that plays, pauses, skips, seeks, sets the
volume, shuffles, repeats, picks albums and songs from the shelf and rearranges the queue, while the music plays on
the PC.

**Architecture:** Main runs a small HTTP server (`remote.js`, Node built-ins only) while Settings → PHONE REMOTE is on:
it pairs a phone by a token in the QR, streams state by Server-Sent Events and takes commands by POST. State and
commands travel between main and the player's page over IPC, extending the mini player's channel. The phone page
(`src/remote/`) is plain HTML/CSS/ES modules and reuses the renderer's `disc.js`, `i18n.js`, `shelf-order.js` and
`shelf-dust.js` as served files.

**Tech Stack:** Electron 44 (castLabs), Node `http`/`crypto`/`os`/`zlib`, plain ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-17-phone-remote-design.md` — read it first; it has the agreed screens, the
security rules and the file:line references this plan relies on.

## Global Constraints

- Off by default. No server, no port, no timer while PHONE REMOTE is off; never in smoke-test runs (`smokeDir`).
- No new npm dependency. The QR encoder is Nayuki's `qrcodegen` (MIT), vendored as one file.
- Nothing goes to the internet. No HTTPS, no service worker, no manifest, no Wake Lock, no clipboard, no Web Share.
- Bound to one private IPv4 address (10/8, 172.16/12, 192.168/16; not 169.254, not 100.64/10; not utun/tun/wg/ppp/docker/vEthernet/vmnet). Never port 8080. Default port 47800, remembered; if taken, one the system picks, remembered.
- Pairing: 16-byte base64url token, kept in main only (`remote.json` in the data folder), QR = `http://IP:PORT/pair?k=TOKEN`; `/pair` → `timingSafeEqual` → cookie `HttpOnly; SameSite=Strict` (HMAC of the token) → `303` to `/`. NEW CODE replaces the token.
- Every request: `Host` exactly `IP:PORT`; the cookie (except `/pair`); POST only with `Content-Type: application/json`, header `X-CDP: 1` and `Origin: http://IP:PORT`; no CORS preflight answered. Page headers: `Content-Security-Policy: default-src 'self'; img-src 'self' data:; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- No file path ever reaches the phone; album ids are a truncated SHA-1; covers only through `/cover/…`; never a proxy to `cdp://app/media`.
- A command carrying a stale `rev` is refused with 409. Nothing pressed while disconnected is ever sent; a reconnect never starts music.
- The phone page is always dark (`background:#000` inline in the HTML, dark `theme-color`); only the accent comes from the player's theme.
- Phone commands never open the tray, never hit `insertDisc`'s Mini Mode return, never open a question on the PC.
- Every new string through `t()` with its Russian in `src/locales/ru.json` (the i18n test fails otherwise).
- Tests and manual runs use `CDPLAYER_HOME` in a temporary folder, never the real `~/.cdplayer`.
- Commits: plain sentences in the repo's style; no Co-Authored-By or "Generated with" lines.

## Review Focus

1. **Two phones, or one phone with two tabs**: both get state; a command from one moves the other; a reorder from the one with an old list is refused (409) and it takes the fresh state — Task 5 tests two SSE clients and a stale `rev`.
2. **The player's page reloads after a crash while a phone is connected**: requests get 503, then a fresh snapshot arrives; no command is replayed — Task 7 tests the 503 path with the state source marked down.
3. **The PC's address changes (DHCP, Wi-Fi → Ethernet) while on**: the server rebinds, the QR redraws, the old address stops answering — Task 7's address watch is tested with an injected interface list.
4. **A big library (3 000+ albums)**: the listing is one gzipped response, the phone filters locally, covers load lazily at most 3 at a time in main — Task 2 tests the listing size; Task 5 tests the cover concurrency limit.
5. **A command for something that has gone** (an album removed from disk, a queue index past the end, a slot now empty): answered with an error the phone shows briefly, never a crash or a wrong song — Task 6 tests each against the renderer's handler.

---

### Task 1: Network and pairing rules (pure)

**Files:**
- Create: `src/main/remote-net.js`
- Test: `test/remote-net.test.js`

**Interfaces:**
- Produces (CommonJS):
  - `pickAddresses(interfaces: os.NetworkInterfaces): { name: string, address: string }[]` — usable ones, preferred first (en0, names containing Wi-Fi/WLAN/wlan/Ethernet/eth before others).
  - `hostAllowed(hostHeader: string, address: string, port: number): boolean`.
  - `originAllowed(originHeader: string | undefined, address: string, port: number): boolean`.
  - `newToken(): string` (16 random bytes, base64url).
  - `cookieValue(token: string): string` (HMAC-SHA256 of a fixed label with the token as key, base64url) and `cookieOk(cookieHeader: string | undefined, token: string): boolean` (cookie name `cdp`; `timingSafeEqual`).
  - `tokenOk(given: string, token: string): boolean` (`timingSafeEqual`, false on length mismatch).
  - `COMMANDS` and `validCommand(body): { action, value, rev } | null` — allowlist with value types: `toggle`, `prev`, `next`, `mute`, `shuffle`, `repeat`, `clear`, `undo`, `discSkip` (no value); `seek` (number ≥ 0); `volume` (integer 0–100); `playIndex`, `remove` (integer ≥ 0); `move` (`{ from, to }` integers ≥ 0); `playSlot` (integer 0–4); `album` (`{ id: hex string, how: 'play'|'next'|'add', track?: integer ≥ 0, slot?: integer 0–4 }`). `rev` an integer, required for `playIndex`, `remove`, `move`, `playSlot`, `album`.

- [ ] **Step 1: Write failing tests** — `pickAddresses` on a fixture with `en0` 192.168.1.20, `utun3` 10.8.0.2, `bridge100` 192.168.64.1, `lo0`, a 169.254 address, an IPv6-only interface and a Tailscale 100.101.1.2 → `[{ name: 'en0', address: '192.168.1.20' }, { name: 'bridge100', … }]`; a Windows fixture (`Wi-Fi` 10.0.0.5, `vEthernet (WSL)` 172.20.0.1) → only Wi-Fi. `hostAllowed('192.168.1.20:47800', '192.168.1.20', 47800)` true; `'evil.example:47800'`, `'192.168.1.20'` (no port) false. `originAllowed(undefined, …)` false. Cookie round-trip true; another token's cookie false; malformed header false. `validCommand` accepts each command's good shape and rejects: unknown action, `volume: 101`, `seek: -1`, `move` without `to`, `album` with `how: 'burn'`, `playIndex` without `rev`.
- [ ] **Step 2: Run** `node --test test/remote-net.test.js` — FAIL.
- [ ] **Step 3: Implement** with `os`-free pure functions (interfaces passed in) and `crypto`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** — `"Phone remote: which network address to offer, and the checks every request must pass"`

### Task 2: The shelf for the phone

**Files:**
- Create: `src/main/remote-shelf.js`
- Modify: `src/main/main.js:468-482` (the body of `shelf:albums` becomes `shelfListing()` used by the handler and by the remote)
- Test: `test/remote-shelf.test.js`

**Interfaces:**
- Produces:
  - `albumKey(id: string): string` — first 16 hex chars of SHA-1 of the shelf album id.
  - `phoneAlbums(albums, colors: { [id]: { spine: [r,g,b] } }): PhoneAlbum[]` — `{ id: albumKey, title, artist, year, n: tracks.length, added, plays, touched, wrapped, color: spine | null }`; no `folder`, no paths, no `note`.
  - `phoneAlbum(album): { id, title, artist, year, tracks: [{ title, duration, disc, track }] }`.
  - `byKey(albums): Map<albumKey, album>` for main to find an album's paths from a phone id.
  - In `main.js`: `async function shelfListing()` → the same `result` the handler returns today (progress still sent to `win`).

(The spec has the listing built "from the renderer". Plays, dust times and shrink-wrap are in fact added in main's
`shelf:albums` handler, and colours come from `shelf-colors.json`; sharing that handler gives the phone the same data
and the same scan-and-watch, without a round trip through the page.)

- [ ] **Step 1: Write failing tests** — no `/` or `\` in any string of `JSON.stringify(phoneAlbums(fixture))`; keys stable and 16 hex chars; two albums with the same title in different folders get different keys; `color` from the colour cache when present, else null; 3 000 synthetic albums gzip (`zlib.gzipSync`) under 120 KB.
- [ ] **Step 2: Run** `node --test test/remote-shelf.test.js` — FAIL.
- [ ] **Step 3: Implement**; move the handler's body into `shelfListing()` unchanged in behaviour (the shelf test and a manual shelf open still behave the same).
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** — `"Phone remote: the shelf as the phone sees it — names, years, plays and dust, with no file paths"`

### Task 3: QR code

**Files:**
- Create: `src/renderer/js/qr.js` (Nayuki's `qrcodegen` TypeScript/JavaScript port as an ES module, its MIT notice kept at the top), `test/qr.test.mjs`

**Interfaces:**
- Produces: `export function qrSvg(text: string, { border = 4 } = {}): string` — an `<svg>` string, error correction M, dark modules as one `<path>`; and the vendored `QrCode` class.

- [ ] **Step 1: Write failing tests** — `qrSvg('http://192.168.1.20:47800/pair?k=' + 'A'.repeat(22))` makes a version-4-or-5 code (size 33 or 37 modules + border), contains the three finder patterns at the corners (sample their 7×7 module grids from `QrCode.encodeText(...).getModule`), and is deterministic; `QrCode.encodeText('Hello, world!', Ecc.LOW)` matches the size and first row from Nayuki's own published example (`size === 21`).
- [ ] **Step 2: Run** `node --test test/qr.test.mjs` — FAIL.
- [ ] **Step 3: Vendor** the encoder; write `qrSvg`.
- [ ] **Step 4: Run** — PASS. Scan the SVG of a test URL with a phone camera once (open it in a browser on the PC): it reads back the exact URL.
- [ ] **Step 5: Commit** — `"A QR code drawn as SVG, from Nayuki's qrcodegen (MIT), for the phone remote"`

### Task 4: Moving a queue row (pure) and using it for the drag

**Files:**
- Create: `src/renderer/js/queue-move.js`
- Modify: `src/renderer/js/app.js:330-350` (the drag's swap loop)
- Test: `test/queue-move.test.mjs`

**Interfaces:**
- Produces: `export function moveItem(queue: string[], index: number, from: number, to: number): { queue: string[], index: number }` — a new array with the row at `from` moved to `to`; `index` (the song playing) follows its song. Out-of-range `from`/`to` → the inputs unchanged.

- [ ] **Step 1: Write failing tests** — moving the playing row (index follows), moving a row from above to below the playing one (index − 1) and back (index + 1), moving to the same place, out of range, a queue with the same path twice (index follows the row, not the path).
- [ ] **Step 2: Run** `node --test test/queue-move.test.mjs` — FAIL.
- [ ] **Step 3: Implement**, and have the drag handler call `moveItem(state.queue, state.index, drag.index, target)` per step instead of its inline swap (behaviour unchanged).
- [ ] **Step 4: Run** `npm test` — PASS; drag a few rows in the app by hand — same as before.
- [ ] **Step 5: Commit** — `"A queue row moved by one rule, for the drag and the phone"`

### Task 5: The server

**Files:**
- Create: `src/main/remote.js`
- Test: `test/remote.test.js`

**Interfaces:**
- Consumes: Task 1 (all), Task 2 `phoneAlbums`/`phoneAlbum`/`byKey`.
- Produces: `createRemote({ address, port, token, files, snapshot, command, albums, coverFor, nowCover, onPhones, log })` → `{ start(): Promise<{ port }>, stop(): Promise<void>, broadcast(state), setDown(down: boolean), phones(): { id, name, since }[], disconnectAll() }`.
  - `files`: `{ [urlPath]: { body: Buffer | () => Buffer, type } }` — the page's allowlist (Task 8 fills it).
  - `snapshot(): object | null` (null = the player's page is gone → 503); `command(cmd) → Promise<{ ok: true } | { error: string } | { full: slots }>`; `albums() → Promise<PhoneAlbum[]>`; `coverFor(albumKey) → Promise<Buffer | null>`; `nowCover() → { key, bytes } | null`.
  - Routes: `GET /pair?k=` · `GET /` and the `files` · `GET /events` (SSE: `event: state` full snapshot on connect and on each `broadcast`; `: ping` every 20 s) · `POST /command` · `GET /api/albums` (gzip when accepted) · `GET /api/album/:key` · `GET /cover/:key` (ETag, `Cache-Control: max-age=86400`, at most 3 covers made at once) · `GET /cover/now?v=key`.
  - A phone's name for `phones()`: from its User-Agent ("iPhone", "Android", else "Browser").

- [ ] **Step 1: Write failing tests** (server on `127.0.0.1`, port 0, injected callbacks, `CDPLAYER_HOME` not needed — nothing is written): pairing sets the cookie and redirects 303 to `/`; a wrong `k` → 403 and no cookie; `/events` without cookie → 401; wrong `Host` → 421; POST without `X-CDP`, with a wrong `Origin`, or with `text/plain` → 403; OPTIONS → 405; an invalid command → 400; a valid one reaches `command` and its result is returned as JSON; a command whose `rev` the injected `command` reports stale → 409; `snapshot()` null → `/events` and `/command` answer 503; two SSE clients both receive a `broadcast` (Review Focus 1); four simultaneous `/cover/:key` requests call `coverFor` at most 3 at once (Review Focus 4); every page response carries the CSP, nosniff and no-referrer headers; `stop()` ends open SSE streams with `event: closed`.
- [ ] **Step 2: Run** `node --test test/remote.test.js` — FAIL.
- [ ] **Step 3: Implement.** Node `http` only; JSON bodies capped at 16 KB; `/pair` strips nothing else from the URL.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** — `"Phone remote: the server — pairing by the QR's token, the player's state as it changes, commands, the shelf and covers"`

### Task 6: The player answers the phone

**Files:**
- Modify: `src/renderer/js/app.js` (`pushMini` ~`:1817`, `playbackTick` ~`:2182`, `onMiniCommand` ~`:1839`, `renderQueue` ~`:256`, `loadDisc`/`insertDisc` ~`:421`/`:1334`), `src/preload.js`
- Create: `src/renderer/js/remote-state.js` (pure: snapshot building and command dispatch rules)
- Test: `test/remote-state.test.mjs`

**Interfaces:**
- Consumes: Task 4 `moveItem`.
- Produces:
  - Preload: `cdp.sendRemoteState(s)` (`ipcRenderer.send('remote:state', s)`), `cdp.onRemoteCommand(fn)` (fn gets `{ id, cmd }`, replies through `cdp.remoteReply(id, result)`), `cdp.onRemoteListening(fn)` (boolean).
  - `remote-state.js`: `snapshot({ state, details, changerView, statusWord, rev }): RemoteState` = `{ rev, playing, position, duration, volume, muted, shuffle, repeat, changerMode, status, track: { title, artist, album, coverKey }, queue?: [{ title, duration, next: boolean }], index?, changer?: { slots: [{ title, artist, cover, done, next }], playing, tracks: [{ title, duration, current }] } }` — a slot's `cover` is a small data URL (at most 96 px, made once per disc and cached by its key) from the cover the changer view already shows, so Spotify and CD discs have theirs too; sent only in full snapshots; `commandError(cmd, { queueLength, slots })` → `null` or an error word for an index or slot that no longer exists (Review Focus 5).
  - `state.remoteListening`; `state.rev` incremented by every queue/changer change (in `renderQueue`).

- [ ] **Step 1: Write failing tests** for `remote-state.js` — the snapshot in queue mode (queue rows with NEXT flags, index), in changer mode (five slots, tracks of the playing disc, no `queue`), no paths anywhere in it; `commandError` for `playIndex` past the end, `remove` past the end, `move` with `to` past the end, `playSlot` of an empty slot → error words; good ones → null.
- [ ] **Step 2: Run** `node --test test/remote-state.test.mjs` — FAIL.
- [ ] **Step 3: Implement** `remote-state.js`; in `app.js`:
  - `pushMini` and the tick's state send run when `state.miniMode || state.remoteListening`; the remote gets the full snapshot on every `pushMini(true)` and `renderQueue()`, and `{ playing, position, duration }` at most once a second from the tick.
  - Commands: `toggle`, `prev`, `next`, `seek`, `mute`, `shuffle`, `repeat` as `onMiniCommand`; `volume` → `setVolume(value)` (absolute, unlike the mini player's relative one); `playIndex` → `goTo`; `remove` → `removeFromQueue`; `move` → `moveItem` then what the drag's release does (`state.nextUp = null`, `upcomingCache = null`, `renderQueue()`, `saveQueueSoon()`, `spotifyResync()`); `clear`/`undo` → CLEAR and ⌘Z's own functions; `playSlot`; `discSkip`; `album` → main has already turned the key into `paths` and a `disc` (Task 7): `how: 'play'` puts the disc in without the tray (queue mode: replace the queue and play from `track || 0`, as `putDiscOnTray` + close does, with no tray animation; changer mode: `changer.load(…, { play: true, slot })`), `'next'`/`'add'` as the case's PLAY NEXT / ADD buttons (`loadDisc(…, { next })`); a full changer answers `{ full: slots }` instead of calling `app.onFullChanger`; then the album's shrink-wrap comes off as on the desktop (`unwrapped`'s main-side call).
  - A stale `rev` → `{ stale: true }` (main turns it into 409).
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** — `"The player takes commands from the phone remote and tells it what's playing, the queue and the changer"`

### Task 7: Main wiring

**Files:**
- Modify: `src/main/main.js` (beside the mini player's IPC, ~`main.js:703-705`; the settings; `app.on('will-quit')`), `src/preload.js`
- Test: `test/remote-net.test.js` (address watch rule)

**Interfaces:**
- Consumes: Tasks 1, 2, 5, 6.
- Produces:
  - IPC for Settings: `remote:status` → `{ on, url, address, addresses: [{ name, address }], port, phones, error }`; `remote:set(on: boolean)`; `remote:address(address)`; `remote:newCode()`. Events to the window: `remote-status` (same shape) when anything in it changes; `remote-listening` (boolean).
  - `remote.json`: `{ on, token, port, address }`.
  - `addressChanged(prev, list): string | null` (pure, in `remote-net.js`) — the address to move to when `prev` is no longer in `list` (the first of the list), else null.

- [ ] **Step 1: Write a failing test** for `addressChanged` (prev kept, prev gone → first, list empty → null) — Review Focus 3.
- [ ] **Step 2: Run** — FAIL; **implement**; **run** — PASS.
- [ ] **Step 3: Wire** — on launch, if `remote.json` says on (and not `smokeDir`): start. `remote:set(true)`: token made if none, address picked, port 47800 → on `EADDRINUSE` port 0, remembered. Every 10 s while on: `pickAddresses(os.networkInterfaces())` → `addressChanged` → restart on the new address, `remote-status` sent. `snapshot` = the latest `remote:state` from the page (null after `render-process-gone` until `did-finish-load`, then `remote-listening` re-sent so the page pushes a full state — Review Focus 2). `command` → `win.webContents.send('remote-command', { id, cmd })` and await `remote:reply` with that id (5 s timeout → `{ error: 'busy' }`); for `album`, main first maps the key with `byKey(shelfListing().albums)` to paths, and answers `{ error: 'gone' }` when missing. `albums` → `phoneAlbums(shelfListing().albums, shelfColors)` cached until `library-changed`. `coverFor` → `shelf.albumCover(first track, { online: false })` data URL → bytes (plus covers already found online, through the same cache the shelf uses). `nowCover` → the cover from the latest full state. Sleep: `powerSaveBlocker.start('prevent-app-suspension')` while on and a phone has been connected in the last 30 minutes; stopped otherwise. `will-quit`: `remote.stop()` (phones get `closed`).
- [ ] **Step 4: Run** `npm test` — PASS. `CDPLAYER_HOME=$(mktemp -d) npm start`, turn it on from the dev console (`cdp.remoteSet(true)`), open the URL on the PC's own browser with the address, pair, see `/events` stream.
- [ ] **Step 5: Commit** — `"Phone remote runs from main while it's on: its address, port and code kept, the address followed, the PC kept awake for a phone, and closed with the app"`

### Task 8: The phone page

**Files:**
- Create: `src/remote/index.html`, `src/remote/remote.css`, `src/remote/remote.js`
- Modify: `src/main/main.js` (the `files` allowlist for `createRemote`: `/` → `index.html`, `/remote.css`, `/remote.js`, `/boot.js` generated as `window.cdp = { i18nDict: () => (<the current locale's { code, dict }>) };`, and from `src/renderer/js/`: `disc.js`, `theme.js`, `jog.js`, `disc-wear.js`, `disc-data.js`, `i18n.js`, `i18n-format.js`, `shelf-order.js`, `shelf-dust.js`, `shelf-discogs.js` (imported by `shelf-order.js`), `glyphs.js` — each served at `/js/<name>`; index.html loads `/boot.js` before the module)

**Interfaces:**
- Consumes: Task 5's routes and SSE `state`/`closed` events; Task 6's `RemoteState`; Task 2's `PhoneAlbum`.

- [ ] **Step 1: Build the page** per the spec's *The phone page*:
  - Three tabs at the bottom: PLAYING · SHELF · QUEUE (CHANGER in changer mode).
  - PLAYING: `Disc` in mini mode with the cover from `/cover/now?v=<coverKey>`, tap = `toggle`; title, artist — album, status; seek bar sent on release; SHUFFLE · PREV · PLAY · NEXT · REPEAT; volume slider (absolute).
  - SHELF: list with cover (`/cover/:id`, `loading="lazy"`), title, artist · year, spine stripe (`color` or the neutral), dusty greyed (`dustLevel(touched) > 0`), NEW on `wrapped`; search with `matchesFilter`; ⇅ cycles ARTIST · NEW · PLAYED · YEAR with `shelf-order.js`'s comparators, kept on the phone only; READING THE SHELF… until `/api/albums` answers. A tap opens the case: cover, tracks (tap = `album {how:'play', track}`), PLAY NEXT · ADD TO QUEUE / INTO THE CHANGER · PLAY. `{ full: slots }` → the slot picker with covers (not the one playing) and CANCEL, then the same command with `slot`.
  - QUEUE: rows (number, title, duration, NEXT tag, playing marked), ≈ 52 px; drag only by the ≡ grip (pointer events, the row follows the finger, `move {from, to}` sent once on release with `rev`); × (44 px); tap = `playIndex`; CLEAR → UNDO for 8 s.
  - CHANGER: five slot tabs with covers (done dimmed, next marked), tap = `playSlot`; DISC SKIP; the playing disc's tracks, tap = `playIndex`.
  - Connection: `EventSource('/events')`; on error the last state dimmed under PLAYER NOT REACHABLE · TRYING AGAIN and every control disabled; `visibilitychange` → reopen if closed; `closed` → CDPLAYER CLOSED (or PHONE REMOTE OFF); 409 → wait for the next state, no retry; an `{ error }` shown briefly in the status line.
  - Dark only; accent from the state's colours; `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; no vibration, no manifest.
- [ ] **Step 2: Run** `npm test` — PASS (the i18n test picks up the page's strings; add their Russian).
- [ ] **Step 3: Check by hand** on a real phone on the same Wi-Fi (iPhone Safari; Android Chrome if available): pair by QR, each tab, play an album, PLAY NEXT, ADD, a full changer, reorder by the grip, ×, CLEAR/UNDO, shuffle and repeat in both modes, volume, seek; lock the phone for a minute and come back; quit the app (CDPLAYER CLOSED); turn it off in Settings (PHONE REMOTE OFF); no white flash at load in a dark room.
- [ ] **Step 4: Commit** — `"The phone remote's page: what's playing on a turning disc, the shelf as a list with its cases, and the queue or the changer"`

### Task 9: Settings and the PHONE tag on the desktop

**Files:**
- Modify: `src/renderer/js/panels.js` (a `PHONE REMOTE` section after PLAYBACK ~`:317`, and in the jump row), `src/renderer/index.html:16` (a `#phone-tag` pill beside `#update-button`), `src/renderer/js/app.js` (status word), the stylesheet, `src/locales/ru.json`

**Interfaces:**
- Consumes: Task 7's `remote:status`, `remote:set`, `remote:address`, `remote:newCode`, `remote-status`; Task 3 `qrSvg`.

- [ ] **Step 1: Implement** — the section: a toggle (off by default); when on, the QR (`qrSvg(url)`), the address in words under it, the address choice when `addresses.length > 1`, the phones connected (`"iPhone · since 23:10"`), NEW CODE; one help line: *Same Wi-Fi, not a guest network. On Windows, allow CDPlayer through the firewall on a Private network — it asks again after each update.* With `error` (port refused, no usable network) the error in words instead of the QR. The PHONE tag shows while `phones.length > 0`, its tooltip naming the phones; the status line says `PHONE CONNECTED` once when the count goes from 0 to 1. Russian for every new string.
- [ ] **Step 2: Run** `npm test` — PASS.
- [ ] **Step 3: Check by hand** — toggle on/off, NEW CODE signs the phone out (it shows the pairing failure; scanning again works), PHONE tag appears and goes, Russian fits.
- [ ] **Step 4: Commit** — `"Settings → PHONE REMOTE: its QR code, the phones connected and a new code; a PHONE tag while one is"`

### Task 10: Final check

- [ ] **Step 1: Run** `npm test` — all PASS; paste the summary.
- [ ] **Step 2: Windows VM** (UTM "Windows", see the project's notes): a portable build; turn the remote on; the firewall dialog — **Allow**: the phone connects; **Cancel**: it doesn't, and the help line explains. Note the result in the hand-over.
- [ ] **Step 3: macOS with the firewall on**: the incoming-connections prompt; whether macOS 26 also asks for Local Network access. Note it.
- [ ] **Step 4: Sleep** — paused, phone connected and then locked: the PC stays awake for 30 minutes, then may sleep.
- [ ] **Step 5: README** — a **Phone remote** feature line and an FAQ answer (same Wi-Fi; the Windows firewall dialog). Commit: `"README: the phone remote"`.
