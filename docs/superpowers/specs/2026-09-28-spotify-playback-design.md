# Spotify playback — design

Date: 2026-09-28 · Status: approved in conversation, awaiting spec review

## Goal

Play Spotify albums and playlists inside CDPlayer, with the CD-player look and controls, for any CDPlayer user with
Spotify Premium. Audio plays in the app itself (Spotify Web Playback SDK), not by remote-controlling another Spotify
app.

## Constraints

- **Spotify Development Mode:** since February 2026 an app's Client ID serves at most 5 allowlisted Premium users;
  extended quota requires a registered business with 250k MAU. So every user brings their own Client ID — which the
  existing `spotify.txt` model already does.
- **DRM:** the Web Playback SDK needs Widevine, which stock Electron lacks. castLabs' Electron fork
  (`v44.1.0+wvcus`) has it, and Spotify only licenses playback to a **VMP-signed** build.
- **Premium only**, per Spotify.

## Spike result (throwaway, 2026-09-28)

castLabs Electron `v44.1.0+wvcus`, macOS, dev run, PKCE login, SDK page served from `http://127.0.0.1`:

- Unsigned: Widevine loads, login and device registration work, every track fails with `playback_error` ~1 s in.
- VMP-signed (EVS `sign-pkg`, streaming signature): audio audible; played past 30 s, seek to 2:00, `nextTrack`,
  a full 387 s track then auto-advance; 0 playback errors.

Not covered by the spike: packaged builds, Windows, Linux (no VMP there), and the SDK running from the app's
`cdp://app/` origin.

## Existing Spotify code this builds on

- `~/.cdplayer/spotify.txt`: line 1 Client ID, line 2 Client Secret, line 3 refresh token (Java-era format).
- `src/main/online.js`: client-credentials token (cover art), user sign-in on `127.0.0.1:8080` with scopes
  `playlist-read-private playlist-read-collaborative`, token refresh, link classify/resolve for SEARCH's
  "paste a Spotify link → queue matching local songs".
- No UI to enter the Client ID/Secret today; users edit the file by hand.

## Decisions

| Question | Decision |
|---|---|
| Playback route | In-app Web Playback SDK (not Spotify Connect remote) |
| Audience | Every user; each brings their own Client ID + Secret |
| How to pick music | SPOTIFY button + panel beside AUDIO CD (saved albums, playlists, search) |
| Builds | All three downloads switch to castLabs Electron; macOS + Windows VMP-signed in CI |
| Queue model | A Spotify album/playlist goes in as a whole disc, like an audio CD; never mixed with local files |

## Architecture

### Main process

- **`src/main/spotify.js` (new)** — the Spotify code moves out of `online.js`: credentials (`spotify.txt`), app token,
  user token + refresh (including rotated refresh tokens), browser sign-in, link classify/resolve, plus new calls:
  saved albums (`/me/albums`), playlists (`/me/playlists`), search (albums + playlists), and an album's / playlist's
  tracks as disc tracks `{ uri, title, artist, album, durationMs, cover }`. `online.js` imports it for cover art and
  link import; behaviour unchanged.
- **Scopes:** `streaming user-read-email user-read-private user-library-read user-modify-playback-state
  user-read-playback-state playlist-read-private playlist-read-collaborative`. The granted scopes are saved alongside
  the token; a token missing any of them reports `reconnectNeeded`, and the panel asks once to reconnect.
- **Token handling:** the refresh token and secret never leave the main process. The renderer gets a short-lived
  access token over IPC (`spotify:accessToken`) for the SDK's `getOAuthToken`.
- **Credentials UI:** IPC to read whether credentials exist and to save Client ID + Secret into `spotify.txt`
  (keeping line 3).

### Renderer

- **`src/renderer/js/spotify-deck.js` (new)** — wraps `Spotify.Player` behind the deck surface `app.js` already
  drives: `play`, `pause`, `seek`, `position`, `duration`, `setVolume`, and an ended callback. Transport, disc spin
  and seek bar stay source-agnostic.
- **Spotify disc** — `insertDisc`-style: the disc's tracks carry their Spotify metadata; `app.js` treats a
  `spotify:track:` entry as a Spotify track.
- **Order** — CDPlayer keeps owning shuffle/repeat/Up Next. It hands Spotify `PUT /me/player/play` with
  `uris` = the upcoming order starting at the current track, so Spotify advances gaplessly and Up Next stays true.
  Changing shuffle/repeat re-sends the remaining order without restarting the playing song (current uri + position).
- **SPOTIFY button + panel** (`panels.js`) beside AUDIO CD. States:
  1. no Client ID/Secret → two fields, a short guide (create an app at developer.spotify.com, tick Web API + Web
     Playback SDK, redirect URI `http://127.0.0.1:8080/callback`, add yourself under User Management);
  2. not signed in, or `reconnectNeeded` → CONNECT SPOTIFY;
  3. connected → tabs ALBUMS / PLAYLISTS and a search box; clicking one puts it on the tray.
- **CSP** — `index.html` allows exactly what the SDK needs (`script-src https://sdk.scdn.co`, its `frame-src`,
  and `connect-src` to `api.spotify.com` / the SDK's hosts), nothing broader.
- **Origin risk** — first implementation step verifies the SDK + Widevine work from `cdp://app/`. Fallback: run the
  SDK in a hidden `BrowserWindow` on a local `http://127.0.0.1` page and drive it over IPC; `spotify-deck.js` keeps
  the same interface either way.

## Feature behaviour with a Spotify disc

**Works:** play/pause, previous/next, seek, volume (`player.setVolume`), tray/eject (eject stops playback), mini
mode, fullscreen, keys; shuffle/repeat/Up Next (above); lyrics + karaoke (by artist/title/length + position);
cover from Spotify's album image, track source `SPOTIFY · <ALBUM>`; Discord presence.

**Dimmed with tooltip "Not available for Spotify":** EQ, mono, crossfade (no Web Audio access), visualizer (idle
state), waveform seek bar (plain line), RIP, tag editor, "add song metadata".

**Not in this version:** booklet for Spotify albums; Spotify tracks in History / play counts; restoring a Spotify
disc after restart (the local queue is restored as today; Spotify discs are not).

## Errors

| Situation | Behaviour |
|---|---|
| `account_error` (no Premium) | status `SPOTIFY PREMIUM IS NEEDED TO PLAY` |
| licence refused / no Widevine (e.g. Linux) | status `SPOTIFY PLAYBACK ISN'T SUPPORTED ON THIS SYSTEM` |
| `authentication_error` / 401 after refresh | panel returns to CONNECT SPOTIFY |
| SDK state becomes null (another device took over) | disc pauses, `PLAYING ON ANOTHER DEVICE` |
| offline | the existing offline status |

## Build and release

- `package.json`: `electron` → `https://github.com/castlabs/electron-releases#v44.1.0+wvcus` (from 44.4.5). Ensure
  `npm ci` runs castLabs' install step (the spike needed `node install.js` run by hand).
- electron-builder `afterPack` hook: `python3 -m castlabs_evs.vmp sign-pkg <appOutDir>` on macOS and Windows,
  before Apple's ad-hoc code signature on macOS (castLabs' required order).
- `build.yml`: on macOS and Windows, install `castlabs-evs`, authenticate from secrets `EVS_ACCOUNT_NAME` /
  `EVS_PASSWD`, sign via the hook, then `vmp verify-pkg` — the build fails on an invalid signature. Fork PRs have no
  secrets: they skip signing (those builds can't play Spotify).
- Existing smoke test (local fixtures) keeps running on all three systems — it proves local playback survives the
  Electron switch.
- Future Electron upgrades wait on castLabs releases.

## Testing

Automated (`node --test`, every test with `CDPLAYER_HOME` set to a temp dir):

- `test/spotify.test.js` with a stubbed `fetch`: `spotify.txt` parsing (Java format, missing secret), token
  request/refresh/rotation, sign-in URL scopes, `reconnectNeeded` for old tokens, paging saved albums and playlists,
  search result shape, album/playlist → disc tracks, error → message mapping.
- `test/spotify-deck.test.mjs` with a fake `Spotify.Player`: the `uris` order equals Up Next across
  shuffle/repeat states; toggling shuffle mid-song re-sends without restarting; ended → next; SDK errors and null
  state → the statuses above.
- CSP test: `index.html` allows `sdk.scdn.co` and nothing broader.
- Existing link-import and cover-art tests pass after the move to `spotify.js`.

Manual, before release (needs a real Premium account), on the packaged `.dmg`, `.exe` and AppImage: connect, play an
album through a track change, seek, skip, shuffle mid-album, lyrics/karaoke follow, eject stops; on Linux, plays or
shows the unsupported message.

## Docs

README section "Spotify (Premium)": developer app setup (Client ID, Secret, redirect URI, User Management), the
5-user limit, and what's unavailable for Spotify discs. Release notes in the usual What's new + Changelog
(New/Fixed/Changed) form.
