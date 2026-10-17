# Phone remote — design

## Goal

The user's moment: lying in bed, CDPlayer playing on the PC across the room. Today getting up is the only way to
pause, skip or put on another album. Spotify solves this with its phone app controlling the desktop one; CDPlayer has
no phone app and won't get one.

Settings → PHONE REMOTE shows a QR code. The phone's camera opens it as a page in the phone's browser, on the home
Wi-Fi: no app to install, no account, nothing over the internet. From that page: play/pause, previous/next, volume,
seek, shuffle, repeat, choosing an album or a song from the shelf, and the queue — reordered, trimmed, played from.
The music keeps playing on the PC.

## Decisions (agreed with the user)

- What the phone does: pause, previous/next track, volume, choosing from the shelf, reordering the queue, shuffle,
  repeat. (The user's list.)
- A page in the phone's browser opened by a QR code, home Wi-Fi only.
- The three screens of the approved mockup: PLAYING · SHELF · QUEUE, described below.

The rest was designed with two agents' reviews of the code; the user approved the description in chat. Calls that
were mine are marked *(my call)*.

## Non-goals (first version)

- Lyrics, karaoke, EQ, spatial audio, quality, Sound Check, themes, any setting.
- The booklet, Discogs prices, missing albums, sticky notes, dust wiping, CHECK.
- Spotify's library (its albums and playlists). Spotify discs already in the queue or changer are controlled like any
  other, since the PC plays them.
- SEARCH for single songs across the library, HISTORY. (The shelf's filter covers most of it; they can come later.)
- Audio CDs: their tracks show and play like any queued song; inserting, ejecting a real CD and RIP stay on the PC.
- Rearranging the changer's five discs. The phone shows them and plays them; the queue's grip and × are never shown
  in changer mode. *(my call)*
- Remote control over the internet, more than one PC, a phone app, a home-screen web app.

## Anti-goals (it fails if…)

- Anyone else on the same Wi-Fi can control the player, or read file paths, or fetch any file but covers.
- The phone lights up the bedroom: a white flash on load, a light theme.
- A press made while disconnected is sent later; a reconnect starts music by itself.
- A question pops up on the PC that the person in bed can't answer (the full changer's, an open tray).
- It's gimmicky on a phone: spines that can't be read, dust to rub off, tray animations, vibration on every tap,
  "add to home screen" prompts, a screen kept awake.
- It's on for anyone who didn't turn it on. Off by default; no server runs while it's off.
- A new npm dependency for it, or anything reaching the internet.

## The phone page

One page, always dark (`background:#000` inline in the HTML and a dark `<meta name="theme-color">`, so nothing
flashes white before the CSS); only the accent colour comes from the player's current theme, as the mini player takes
`colors` (`mini.js:81-86`). In the app's language (EN / RU, from `src/locales`). Three tabs at the bottom, under the
thumb: **PLAYING · SHELF · QUEUE** (**CHANGER** in changer mode).

**PLAYING**
- The cover printed on a disc that turns while it plays and stops on pause — `disc.js` in its `mini` mode, as the
  mini player uses it (`mini.js:18-19`); no wear, shine or visualizer. Tapping the disc plays / pauses.
- Title; artist — album; one status line in the desktop's own words (UP NEXT · …, PAUSED, DISC 2 IN).
- A seek bar, sent when the finger lifts (as `mini.js:60-75`).
- One row: SHUFFLE · PREV · PLAY/PAUSE (large) · NEXT · REPEAT. SHUFFLE and REPEAT cycle as on the desktop, through
  the mode's own lists (`SHUFFLES` / `REPEATS`, `app.js:1929`), with the badge (1, ◉) and a word under the row.
- Volume: the app's own (`setVolume`, `app.js:1665`, which reaches Spotify too), a slider at the bottom. Not the
  phone's volume buttons (a web page can't read them).

**SHELF**
- A list, not spines: cover thumbnail, title, artist · year, a thin stripe on the left in the spine's colour
  (`shelf.colors`). A dusty album's cover is greyed; a shrink-wrapped one has the NEW sticker. A count at the top.
- A search field filtering as the desktop's does (`matchesFilter`, `shelf-order.js:15`), and ⇅ cycling ARTIST · NEW ·
  PLAYED · YEAR — the desktop's `SORTS` (`shelf-order.js:7`) without PRICE (Discogs is a non-goal) and COLOR (colours
  exist only for spines the desktop has drawn). Filtering and sorting happen on the phone over the full list; the
  phone's sort is its own and never changes the desktop's saved `shelfSort`. *(my call)* The spine-colour stripe uses
  the colour cached in `shelf-colors.json` when there is one, else the theme's neutral.
- Tapping an album opens its case full-screen: cover, tracklist, and the desktop case's buttons in the same order
  (`shelf.js:802-805`): PLAY NEXT · ADD TO QUEUE (INTO THE CHANGER in changer mode) · **PLAY**. Tapping a track plays
  from it, as `trackRow` does (`shelf.js:723`).
- These do exactly what the desktop's do (`shelf.js:858` → `insertDisc`): PLAY replaces the queue in queue mode
  (`app.js:1346`) and goes into a slot in changer mode; playing an album tears its shrink-wrap off as on the desktop.
  - Two desktop paths must not be hit: `insertDisc` returns early in Mini Mode (`app.js:1336`), and an open tray takes
    the album onto the tray (`app.js:423`). Phone commands take a path that does neither.
  - A full changer asks on the desktop which disc goes back (`onFullChanger`, `app.js:430`). For a phone command the
    PC asks nothing: the command answers "full", and the phone asks — the five slots with their covers (not the one
    playing) and CANCEL.

**QUEUE** (queue mode)
- Rows as on the desktop (`app.js:294-323`): number, title, duration, the NEXT tag, the song playing marked; ~52 px
  rows.
- Drag only by a ≡ grip on the left (dragging a whole row would fight scrolling); × on the right (44 px target);
  tapping a row plays it (as `app.js:356`).
- CLEAR, which turns into UNDO for 8 s (the desktop's ⌘Z, `app.js:38/493`).

**CHANGER** (changer mode)
- Five slot tabs across the top with small covers; a finished disc dimmed, the one playing next marked; tapping a
  tab plays that disc (`playSlot`, `app.js:984`). DISC SKIP.
- Under them the playing disc's heading and tracklist; tapping a track plays it.

**When the connection goes**
- The PC app quits: the server says so first, and the page shows CDPLAYER CLOSED.
- The PC sleeps, the Wi-Fi drops, the phone was locked: the last state stays on screen, dimmed, under PLAYER NOT
  REACHABLE · TRYING AGAIN; buttons greyed; it reconnects by itself and takes a fresh state. Nothing pressed while
  down is ever sent.
- iOS freezes a page under a locked screen: on `visibilitychange` the page reopens its connection if closed.

## The desktop

**Settings → PHONE REMOTE** (where in Settings is the builder's), off by default:
- On: the QR code (inline SVG), the address under it in words, and a line of help: same Wi-Fi; on Windows, allow
  CDPlayer through the firewall on a Private network (the dialog comes back after each update, see *Risks*).
- More than one usable network → a choice of which.
- The phones connected ("iPhone · since 23:10") and **NEW CODE**, which voids the old pairing and signs every phone
  out.
- Off: the server stops; a connected phone shows PHONE REMOTE OFF.

**While a phone is connected:** a small PHONE tag in the player's top-left (where AVAILABLE sits), its tooltip naming
the phone; the status line says PHONE CONNECTED once. What the phone does shows on the desktop as if clicked there —
no messages about the phone pop up.

**Sleep.** Playing audio keeps the PC awake already; paused, it can idle to sleep and the phone can't wake it. While
the remote is on and a phone has been connected in the last 30 minutes, `powerSaveBlocker.start('prevent-app-
suspension')`; released after that, or when the remote goes off. *(my call — a locked phone drops its connection, so
"while connected" alone would let the PC sleep the moment the phone is put down.)*

## How it works

**Server** — a new `src/main/remote.js`, `createRemote({ snapshot, command, albums, album, cover })`, injected like
`createDiscography` (`main.js:483`), on Node's own `http`, `crypto`, `os`, `zlib`. No new dependency.
- **Server-Sent Events** for state (a full snapshot on every connect, then changes; a `:` heartbeat every 20 s;
  position at most once a second) and **POST** for commands. Never port 8080 (Spotify's sign-in callback,
  `spotify.js:197-209`).
- Runs only while the setting is on; never in smoke-test runs (`smokeDir`).
- The phone's page and its files are served from an allowlist, with their own headers:
  `Content-Security-Policy: default-src 'self'; img-src 'self' data:; frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: no-referrer`. The desktop's CSP (`index.html`, `test/csp.test.js`) is untouched.

**Address and port**
- Bound to one IPv4 address, not `0.0.0.0`, chosen by a pure `pickAddress(os.networkInterfaces())`: private ranges
  only (10/8, 172.16/12, 192.168/16); not 169.254, not 100.64/10 (Tailscale); not utun/tun/wg/ppp/docker/vEthernet/
  vmnet; en0 / Wi-Fi / Ethernet first. No IPv6. Checked again every ~10 s while on: a new address → bound again, QR
  redrawn (the phone must scan again — its cookie belongs to the old address).
- Port: a fixed default (e.g. 47800), remembered; if taken, one the system picks, then remembered.

**Pairing and every request**
- A 16-byte base64url token kept in settings (pairing survives restarts). The QR holds `http://IP:PORT/pair?k=TOKEN`;
  `/pair` compares with `timingSafeEqual`, sets an `HttpOnly; SameSite=Strict` cookie (an HMAC of the token), and
  redirects 303 to `/` so the token leaves the address bar. NEW CODE replaces the token.
- Every request: `Host` exactly `IP:PORT` (no DNS rebinding); the cookie; POSTs only with `Content-Type:
  application/json`, an `X-CDP` header and a matching `Origin`; no answer to CORS preflights.
- Plain http on the home network is accepted: someone sniffing the Wi-Fi could take the token and control the music,
  nothing more. The page isn't a secure context, so it uses no Wake Lock, clipboard, Web Share, service worker or
  web-app manifest.

**State and commands** — through the mini player's channel, which is already "a remote control that mirrors state
over IPC" (`main.js:627`, `main.js:703`, `onMiniCommand` at `app.js:1839`):
- `pushMini` and its tick run only in Mini Mode (`app.js:1818`, `2182`): they run while the mini player **or** the
  remote is listening.
- The snapshot gains what the phone needs and the mini player lacks: volume and mute, the queue (titles, durations,
  NEXT, the index playing) or the changer's slots and the playing disc's tracks, `changerMode`, SHUFFLE / REPEAT, the
  status line's words, and a `rev` that changes with each queue or changer change. Built in the renderer (only it
  knows Spotify titles and covers), from where `renderQueue()` runs (`app.js:256`).
- Commands: the mini player's (toggle, prev, next, seek, mute, shuffle, repeat, sync; not exit) plus `volume`,
  `playIndex` (`app.js:2240`), `remove` (`app.js:412`), `move {from, to}`, `clear`, `undo`, `playSlot`,
  `discSkip`, `album {id, how: play | next | add, track?}`, `album … slot` (answer to "full"). Each is checked against
  an allowlist with value types. A command carrying a stale `rev` is refused (409) and the phone takes the fresh
  state — a reorder tapped on an old list can't move the wrong song.
- Queue reorder today is inline in the drag handler (`app.js:338-350`): it becomes a pure `moveItem(queue, index,
  from, to)` used by both, followed by what the drag does after (`nextUp = null`, `spotifyResync`).

**The shelf and covers**
- Never a file path to the phone, and never a proxy to `cdp://app/media` (it serves any absolute file,
  `media-protocol.js:155`). Album ids (`groupAlbums` puts the folder path in them, `shelf.js:71`) go out as a
  truncated SHA-1; main maps them back.
- The list comes **from the renderer**, built the way the desktop shelf builds its own: the same `shelf:albums` call
  (which scans the music folder and starts the library watcher, `main.js:467-469`) with plays, dust, shrink-wrap
  added there. So the first time the phone opens SHELF in a session, the library is read as if the desktop shelf had
  been opened — without opening it or showing its progress on the desktop; until it's ready the phone shows
  READING THE SHELF…. Later requests reuse it, refreshed when the watcher reports a change. *(my call — main alone
  doesn't keep the scan, and dust / NEW / plays are worked out in the renderer.)* Every album goes out as
  `{ id, title, artist, year, n, added, plays, color, dusty, wrapped }`, gzipped (~60 KB for 3 000 albums). An
  album's tracks on `/api/album/:id`.
- `/cover/:id`: `shelf.albumCover(first, { online: false })`'s 256 px JPEG (`shelf.js:217-221`) as bytes, with an
  `ETag` and `max-age`; covers found online and cached count too (a "cached only" option). At most 2–3 made at
  once (resizing blocks the main process); the phone's scrolling mustn't flush the desktop's cover cache
  (`shelf.js:214`). The cover playing now is the one main already has from the mini state (`app.js:1832`).

**QR code** — Nayuki's `qrcodegen` (MIT, one file, no dependencies) vendored as `src/renderer/js/qr.js`, drawn as
inline SVG.

**The player's page reloading** after a crash (`main.js:136`): the server answers 503 meanwhile and sends a fresh
state once it's back.

## Risks to check by hand

- **Windows:** the portable `.exe` runs from a new `%TEMP%` folder each release, so the firewall dialog comes back
  after each update. **Cancel** silently blocks it; "Allow" needs admin; a network marked Public stays blocked. The
  app can't detect this itself — hence the help line. Check in the Windows VM.
- **macOS:** with the firewall on, the ad-hoc-signed app is asked about incoming connections again after updates. No
  Bonjour / mDNS (it would bring the Local Network privacy prompt). Check whether macOS 26 asks anyway.
- **Linux:** an active ufw blocks the port; the port is shown in Settings.
- Guest Wi-Fi with client isolation can't work; the help line says "same Wi-Fi, not a guest network".

## Testing

- Pure, under `node --test`: `pickAddress`, the Host check, token and cookie checks, command validation, `moveItem`,
  album ids and the listing, the page's headers, QR output against Nayuki's test vectors.
- The server end to end on 127.0.0.1, port 0, with injected callbacks: pairing, refused requests (no cookie, wrong
  Host, wrong Origin, no `X-CDP`, stale `rev`), SSE snapshot on connect, a command reaching `command`, a cover — with
  `CDPLAYER_HOME` in a temporary folder, never the real `~/.cdplayer`.
- By hand with a real phone (iPhone Safari and Android Chrome if available): pairing by QR, each screen, reorder by
  the grip, a full changer from the phone, lock the phone and come back, quit the app, sleep, NEW CODE; Windows VM
  firewall dialog (Allow and Cancel); Russian.
