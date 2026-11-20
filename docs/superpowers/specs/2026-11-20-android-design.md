# CDPlayer for Android — design

## Goal

CDPlayer on Android phones, for the app's users (not a personal build): it plays the music stored on the phone
and is used the way the desktop app is used, with the same shelf, disc, case, booklet, looks and sound. The only
desktop feature deliberately left out is the phone remote, because the phone *is* the player. It should feel like
a real phone app (one hand, screen off, lock-screen controls), not like the desktop window squeezed onto a phone.

Delivered in stages. **This document specifies stage 1 in full.** Stages 2 and 3 are listed only so that stage 1
doesn't block them.

| Stage | Contents |
|---|---|
| 1 | Music already on the phone, shelf, disc and case, changer and queue, playback with the screen off, lock-screen and headset controls, all looks/themes, sound (EQ, crossfeed, gapless, Sound Check, AUTOMIX), history and play counts, settings. Portrait touch layout. Runs on the emulator; signed APK built locally. |
| 2 | Online features: covers and disc photos, booklet scans, album story, lyrics and karaoke (word timing models), MusicBrainz discography and missing albums, Discogs, scrobbling, BLIP, share cards and videos (to Android's share sheet), backup and restore (including a backup made on the desktop), importing plays. |
| 3 | Google Play: release signing, store listing and screenshots, privacy policy, closed testing with volunteers. |

## Constraints

- **Nobody can test on a real phone.** All verification happens on Android emulators on this Mac (Apple Silicon,
  arm64 system images) plus automated tests. Anything that only a real device can reveal (OEM battery killers on
  Samsung/Xiaomi, real low-end GPU smoothness, Bluetooth headset buttons) is called out as unverified, and stage 3's
  closed testing is where it gets checked.
- **The desktop app must not regress.** Its 148 test files keep passing at every step; every module that moves into
  shared code still works in Electron.
- The Android SDK isn't installed yet. `adb` is (`/opt/homebrew/bin/adb`); Java 26 is installed (Gradle/AGP may
  need a JDK 17/21, so install one through Homebrew if Gradle refuses 26).
- Minimum Android 10 (API 29); target the current API level Play requires.
- Push, tag and release only when the user asks. Commits and releases carry no AI attribution.
- **Nothing from stages 1–2 is released** (user's decision, 2026-11-20): no APK on GitHub or anywhere else. So the
  permanent signing identity, the versionCode scheme and any "new version available" notice wait for stage 3; stage 1
  uses a local throwaway keystore.

## Non-goals

Not on Android, ever or for now: phone remote, Spotify (castLabs Widevine is Electron-only), yt-dlp streaming,
audio CD playback/ripping/take-along, Discord presence, taskbar/dock disc, mini player window, the desktop updater
(Play updates the app), output sample-rate switching, theme-shots/perf-report developer tools, Android Auto
(a Reddit idea, not promised), iOS.

## Anti-goals (failure even if it "works")

- Music stops when the screen turns off or the user switches apps.
- It feels like a web page: rubber-band scrolling of the whole page, text getting selected on long-press, blue tap
  flashes, pinch-zooming the UI, keyboard hints on screen.
- It drains battery while paused or hidden (the disc keeps spinning in a canvas nobody sees).
- The desktop app gets worse, or the two apps drift into two separate codebases.

## Approaches considered

1. **Capacitor around the existing web UI** — chosen. `src/renderer` is plain web code (81 files, no `require`),
   so it runs in Android's WebView largely as is; the Web Audio engine (EQ, crossfeed, gapless, AUTOMIX) comes along
   unchanged. Native Kotlin only where the web can't reach: finding music, background playback, files.
2. Native Kotlin rewrite — best battery and smoothness, but rewrites ~36k lines including every look, and leaves two
   codebases that drift apart. Rejected.
3. Tauri mobile / Flutter — Tauri is the same WebView but the back end would have to be rewritten in Rust; Flutter is
   a full rewrite without Kotlin's advantages. Rejected.

Within Capacitor, how the desktop "main process" logic (`src/main`, ~60 modules behind 150 IPC calls) gets onto the
phone:

- **A. Embed Node.js (nodejs-mobile)** and run `src/main` almost unchanged. Rejected: the project is stuck on Node 18
  and looks unmaintained, while the app's dependencies already ask for Node 20 (`file-type`); it also adds 30–50 MB
  and a second runtime on the phone.
- **B. Shared code + thin platform layer** — chosen. Logic that doesn't need the operating system moves to
  `src/shared` and stops depending on Node directly; file, network, path and image access come in through a small
  adapter. On the desktop the adapter is Node/Electron; on Android it's Capacitor plus a few Kotlin plugins.
  Slower to build than A, but no dead dependency, and new features in shared modules land on both platforms.

## How it fits together

```
 src/renderer (unchanged UI + small mobile additions)
        │  window.cdp  (same API on both platforms)
        ├── desktop: src/preload.js → ipcMain → src/main/* ──┐
        └── android: src/android/cdp.js ──────────────────────┤→ src/shared/*  (logic)
                                                              │      │ platform adapter
                                                   node adapter     android adapter
                                                   (fs, net, …)     (Capacitor + Kotlin plugins)
```

### Repository layout

- `src/shared/` — modules moved out of `src/main` once they no longer need Node or Electron directly. `src/main`
  keeps thin wrappers (or simply re-requires them), so desktop code and tests keep working. Move a module only when
  stage 1 needs it; don't do a big-bang move.
- `src/platform/node.js` and `src/platform/android.js` — the adapters (see below).
- `src/android/` — the Android implementation of `window.cdp` (`cdp.js`), the mobile stylesheet and mobile-only UI
  bits, and anything renderer-side that only Android needs.
- `android/` — the Capacitor/Gradle project, including the Kotlin plugins.
- `scripts/build-android.mjs` — assembles the WebView bundle (renderer + shared + android files, bundled for the
  browser) into Capacitor's web directory, then runs the Gradle build. The desktop build is untouched.
- Same version number as the desktop app; application id `com.kizarov3.cdplayer`.

### The platform adapter

One object handed to shared modules, covering what they actually use today. At minimum:

- **files** — read/write/list/stat/remove in the app's data directory and read access to music files.
- **http** — `fetch`-like requests. On the desktop, `http.js`'s Electron `net.fetch`. On Android, Capacitor's native
  HTTP so CORS doesn't apply (needed in stage 2 for MusicBrainz, lyrics sites, Last.fm…).
- **path** — a small POSIX path helper (Android paths are POSIX).
- **images** — decode/resize/encode to data URL. Replaces `nativeImage` in `shelf.js`/`metadata.js`; on Android an
  `OffscreenCanvas`/`createImageBitmap` implementation in the WebView.
- **clock/platform info** as needed.

**Synchronous file access.** `store.js` (and modules built on it) read and write small line-based files
synchronously. The WebView has no synchronous file API, so on Android the data directory's small state files are
read into memory at startup (before the UI's first `loadState`), served from memory afterwards, and written back
asynchronously (debounced, plus an immediate flush when the app goes to the background). Large caches (covers,
booklet scans, models) use the async API only. The desktop keeps its real sync `fs`.

Data lives in the app's private storage (`Context.getFilesDir()/cdplayer`), in the same file formats as the
desktop's `~/.cdplayer`, so a desktop backup can be restored on the phone in stage 2.

### `window.cdp` on Android

`src/android/cdp.js` exposes the same object shape as `src/preload.js`, so the renderer doesn't branch on platform
except where the UI genuinely differs. Each call is implemented by calling shared modules directly (no IPC needed:
they run in the same page). Calls for non-goal features exist but report "not available"
(`stream.available() → false`, `listAudioCds() → []`, `spotifyStatus()` → disconnected, etc.), and the renderer
hides the corresponding UI when `cdp.platform === 'android'` — add that one field to both preloads.

Calls needing replacement rather than a shared module, stage 1:

- `i18nDict` is synchronous on the desktop. On Android, load the locale before `app.js` runs (the bundle includes
  the locale JSON; pick by the saved language, else the system language).
- `saveQueueSync` / `onAppClosing` → flush on Capacitor's `pause` / `visibilitychange: hidden`.
- `pickMusicFolder` / `musicFolders` → the folder filter described under "Finding music".
- `discMenu` (a native desktop menu) → an in-page menu opened by long-press.
- `toggleFullscreen` / `isFullscreen` → Android immersive mode (optional in stage 1).
- `openGitHub`, `showFile`, `open*` links → open in the browser (Capacitor Browser/App launcher); `showFile` hidden.
- `copyText` → Android clipboard.
- `relaunch` → reload the WebView.
- `mediaUrl(path)` → see "Playing files".

### Finding music

- A Kotlin plugin queries `MediaStore.Audio` for every audio file on the phone (path, title, artist, album,
  album artist, track/disc number, duration, size, date modified, and the album art id). That gives an instant first
  shelf even for large libraries, with no file reading.
- Tags are then read properly in the background with `music-metadata` (browser build) on the shared path, the same
  code the desktop uses, so album grouping, names and covers match the desktop's rules. Results go into the same
  cache the desktop uses, so only new or changed files are read on later starts.
- Rescan on start and when MediaStore reports a change (a content observer → `onLibraryChanged`).
- Settings → LIBRARY's music folders become a **folder filter**: by default, everything; the user can tick the folders
  (from MediaStore's relative paths) that should be on the shelf. No folder picker needed.
- Permissions: `READ_MEDIA_AUDIO` (Android 13+) or `READ_EXTERNAL_STORAGE` (10–12), asked on first launch with an
  explanation screen in the app's style. `READ_MEDIA_IMAGES` is also requested (optional) so `folder.jpg`-style
  covers next to the music can be shown; embedded covers and MediaStore album art work without it.
- Known limitation: since Android 11, apps can't see non-media files (`.cue`, `.lrc`) in shared storage without the
  "all files" permission, which Play restricts. Stage 1 doesn't support cue sheets or `.lrc` side files on Android;
  online lyrics come in stage 2.

### Playing files

- `mediaUrl(path)` returns Capacitor's local-server URL for the file (`Capacitor.convertFileSrc`), which is
  same-origin with the page, so Web Audio can read the samples (the same reason the desktop uses `cdp://`). Verify
  early that seeking works (HTTP Range); if Capacitor's server doesn't honour Range for these files, add a small
  Kotlin path handler that does.
- Formats the WebView can't play (AIFF, AU, ALAC — the desktop's `decoders/`) are decoded to WAV in a Web Worker by
  the same decoder code, moved to shared, and played from a blob URL.
- The rest of `audio.js` is unchanged.

### Playback with the screen off

**This is the plan's biggest risk and its first gate.** Before any module moves to `src/shared`, a throwaway spike
(bare Capacitor app + the real `audio.js` + a foreground service) proves on the emulator that Web Audio keeps playing
with the screen off for 30+ minutes, across track changes and a gapless album transition, under Doze
(`adb shell dumpsys deviceidle force-idle`).

If it can't be made reliable, the fallback (builder's call, marked for the user to confirm): **native playback in the
background** with Media3/ExoPlayer — Web Audio while the app is open, handed over to ExoPlayer (same queue, same
position) when the app goes to the background, and back on return. Gapless comes from ExoPlayer; AUTOMIX, crossfeed
and the custom EQ are missing in the background at first and are ported natively afterwards. Report the spike's
outcome to the user before going further either way.

- A Kotlin foreground service (type `mediaPlayback`) with a `MediaSession` runs while something is playing or paused
  recently: it keeps the process alive, shows the media notification and lock-screen controls (title, artist, album,
  cover, play/pause, previous/next, seek bar), and receives headset/Bluetooth buttons and audio-focus changes.
  A maintained Capacitor plugin may be used if it does all of this; otherwise write a small one.
- The JS side sends now-playing state (track, cover, position, duration, playing) to it; it sends commands back
  (play, pause, next, previous, seek, stop), which go through the same functions the keyboard shortcuts use.
- Audio focus: pause for calls and other apps' playback and resume after a short interruption. Pause when headphones
  are unplugged (`ACTION_AUDIO_BECOMING_NOISY`).
- The WebView must keep running audio in the background: don't let Capacitor pause the WebView or its timers while
  the service is up. Verify on the emulator with the screen off for at least 30 minutes, across several track
  changes, including gapless album transitions.
- When the app is hidden: stop all animation and canvas drawing (disc spin, visualizer, backdrop flow, BLIP); audio
  only. The desktop already has a software-rendering "fewer effects" path; reuse it for low-RAM devices.

### Mobile layout (portrait)

**Stage 1 is phone portrait only** (builder's call): phones are locked to portrait. Tablets (smallest width ≥ 760
CSS px) get the desktop layout as a best effort, with no tablet emulator, touch adaptation or screenshot checks in
stage 1. For phone portrait
(roughly 360–430 CSS px wide), a mobile stylesheet (`src/android/mobile.css`, loaded only on Android) and a few
small DOM additions arrange the same elements into a single screen:

```
┌──────────────────────────┐
│ status pill        ⋯ ⚙   │  header: status, menu, settings
│                          │
│      ( spinning disc )   │  disc / case: tap = CD VIEW, long-press = disc menu
│                          │
│ TRACK TITLE              │  faceplate: title, artist, badges
│ Artist                   │
│ ━━━━━━━●─────── 1:23 4:56│  progress (drag to seek)
│   ⏮    ⏯    ⏭   🔀 🔁   │  transport, large touch targets (≥ 48 dp)
│ ─────── volume ───────   │
│ ▔▔▔ queue (pull up) ▔▔▔  │  changer + queue as a bottom sheet
│ [ SHELF ]                │  shelf: full-screen view
└──────────────────────────┘
```

- **Shelf**: full-screen, vertically scrolling; spines/covers sized for thumbs. Tap = open the case, as on the
  desktop. Its look follows the active theme.
- **Queue/changer**: a bottom sheet pulled up from the faceplate; drag to reorder (the touch version of the desktop's
  mouse reordering).
- **Settings, booklet, history, karaoke, CD VIEW**: full-screen views with a back gesture/button. Android's back
  closes the topmost view, then backgrounds the app (never quits playback).
- **Gestures replace keys**: keyboard hints and the key reference are hidden; anything only reachable by a shortcut
  today gets a touch path (a button or a menu entry). Long-press replaces right-click.
- Web-page feel removed: no page overscroll, no text selection outside text fields, no tap highlight, no pinch-zoom,
  safe-area insets respected (notches, gesture bar), status/navigation bar colours follow the theme.
- Every look and theme must render correctly in portrait; each gets a portrait screenshot check (the desktop's
  shots/compare tool approach).

Exact visual details are left to the builder, following the desktop's style; consult 2–3 agents on visual choices
and show the user screenshots before finishing.

### Stage 1 features, explicitly

In: shelf (grouping, colours, dividers, notes, dust, wrap tear, hidden-track handling, year shelf, missing albums
only when already cached), case and disc, changer, queue, history by day, LAST PLAYED, play counts and skips,
EQ and presets, crossfeed, gapless/album-rate gapless, Sound Check, AUTOMIX, sleep timer, all looks and user themes
(import/export via the share sheet / file picker), languages, onboarding.

Out of stage 1 (stage 2): anything that needs the network, karaoke/word timing, BLIP, share cards/videos,
backup/restore, import plays, tag editing (writing tags to shared storage needs per-file user consent on Android 11+;
decide in stage 2).

## Testing

- Desktop: the existing `npm test` passes after every module move.
- Shared modules: unit tests run under Node as today, with an in-memory adapter where useful.
- Android unit tests for `cdp.js` and the adapter's sync-state cache, run under Node with fakes for Capacitor.
- Emulators (Android SDK command-line tools via Homebrew): a current Pixel image (latest API) and an Android 10
  low-RAM image. Test music is pushed with `adb` into `/sdcard/Music` (several albums: MP3, FLAC, M4A/ALAC, AIFF,
  an album with embedded cover, one with `folder.jpg`, multi-disc, a gapless album).
- End-to-end on the emulator, driven through the WebView's DevTools connection (Playwright's Android support or
  plain CDP over `adb forward`): permission flow, first scan, shelf → case → play, next/previous, seek, queue
  reorder, theme switch, settings persist across restart, screen-off playback for 30 minutes with track changes,
  notification controls via `adb shell cmd media_session dispatch`, audio focus (start another player), headphones
  unplugged (simulated broadcast).
- Gapless: measure seams on the emulator the same way the desktop does, against the files.
- Performance: frame rate of the spinning disc and shelf scroll on the low-RAM image; CPU near zero while paused and
  hidden (`adb shell top` / `dumpsys`).
- Report honestly which items were only possible on the emulator.

## Done when (stage 1)

A release-signed APK (local keystore, not committed) installs on both emulators; a fresh install asks for access,
builds the shelf from the phone's music and plays it with the screen off and controls on the lock screen; every
stage-1 feature above works in portrait; all looks render; the desktop tests pass; and the user has seen
screenshots. The APK is not published anywhere.

## Left to the builder

The exact Capacitor plugins, how modules are bundled for the WebView, the precise adapter interface, which modules
move to shared and in what order, mobile CSS details, and the testing harness — within the decisions above.
