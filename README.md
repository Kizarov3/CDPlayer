# CDPlayer

A desktop music player that feels like a real CD player — for your local music, your CDs, and (with Spotify Premium) your Spotify albums. No account, nothing else to install: MP3, M4A/ALAC, FLAC, WAV, AIFF, AU, OGG and Opus all play out of the box on macOS, Windows and Linux.

<p align="center">
  <img src="docs/screenshots/main-red.jpg" width="49%" alt="CDPlayer main window, RED theme, playing a ripped OK Computer">
  <img src="docs/screenshots/main-snow.jpg" width="49%" alt="CDPlayer main window, SNOW theme with falling snow">
</p>

## Download

Grab the file for your system from [**Releases**](https://github.com/Kizarov3/CDPlayer/releases):

| System | File | How to run |
| --- | --- | --- |
| **macOS** (Apple Silicon and Intel) | `CDPlayer-x.y.z-mac.dmg` | Open it, drag **CDPlayer** into **Applications** |
| **Windows** 10 / 11 | `CDPlayer-x.y.z-windows.exe` | Double-click — no installation |
| **Linux** | `CDPlayer-x.y.z-linux.AppImage` | `chmod +x`, then double-click |

The builds aren't signed with a paid certificate, so the first launch asks once: on macOS right-click the app → **Open** → **Open**; on Windows **More info** → **Run anyway**. When a new version is out, an **AVAILABLE** button appears in the player.

## Features

- **The disc** — spins in its jewel case with your cover printed on it, catches the light as you move the mouse, wears scratches as you play it, turns over (`B`) to show a ring for each track, and can be turned by hand like a DJ's jog wheel
- **The CD shelf** (`S`) — every album in your music folder spine-out, sorted by artist, year, most played or colour. Unplayed albums gather dust (wipe it off with the mouse), new ones come shrink-wrapped, sticky notes on cases, and the studio albums you're missing stand as see-through places
- **The booklet** — the album's tracklist, lyrics and credits, marked in pen as you play: tally marks per song, your favourite circled
- **Discogs** — each album's exact pressing and market price; **APPRAISE** values your whole shelf
- **Audio CDs** — play a real CD, named from MusicBrainz, or **RIP** it to verified, tagged FLAC in one click
- **Lyrics & Karaoke** (`Y`) — lyrics found online, highlighted word by word as they're sung
- **Spotify** (Premium) — your saved albums and playlists play as discs, with lyrics and karaoke
- **Playback** — gapless CUE sheets, crossfade, 10-band EQ with presets, output device picker, sleep timer, `.m3u` playlists, media keys
- **Now Playing card** (`P`) — a picture or short video of the album and lyrics to share; Discord *Listening to* status
- **Make it yours** — ten themes with animated scenes, your own themes shared as a file or code, Mini Mode (`M`), CD view, Visualizer Mode
- **Library tools** — fix tags from MusicBrainz, find missing covers, spot duplicates and broken files
- **Languages** — English and Russian; adding one is a single file ([docs/TRANSLATING.md](docs/TRANSLATING.md))

<p align="center">
  <img src="docs/screenshots/shelf.jpg" width="49%" alt="The CD shelf sorted by artist: dusty spines, new albums shrink-wrapped, a sticky note's corner, +N MISSING boxes and the index down the side">
  <img src="docs/screenshots/booklet.jpg" width="49%" alt="An album's booklet marked in pen: tally marks for each song's plays, the favourite circled, and the lyrics">
</p>
<p align="center">
  <img src="docs/screenshots/disc-wear.jpg" width="49%" alt="A much-played disc in CD view: scratches, scuffs and a thumbprint over its cover art">
  <img src="docs/screenshots/karaoke.jpg" width="49%" alt="Karaoke Mode: the line being sung, filling in word by word, a duet's singers on either side">
</p>

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` or `K` | Play / Pause |
| `J` / `L` | Previous / next track |
| `←` / `→` | Skip back / forward 5 seconds |
| `↑` / `↓` | Volume up / down |
| `U` | Mute / unmute |
| `F` | Toggle fullscreen |
| `C` | Toggle CD view |
| `M` | Toggle Mini Mode |
| `V` | Toggle Visualizer Mode |
| `Y` | Toggle Karaoke Mode |
| `E` | Open / close the disc tray |
| `S` | The CD shelf |
| `B` | Turn the disc over to its data side: a ring for each track, the laser where it's playing |
| `P` | Now Playing card: pick lines of the lyrics, then copy or save it |
| `?` | These keyboard shortcuts |
| `Esc` | Close whatever's open, or leave fullscreen / CD view / Visualizer Mode / Mini Mode |

## FAQ

More answers are in the app: **Settings → HELP**.

**How do I choose my music folder?**<br>
Open the SHELF and click FOLDER…. Songs outside it still play — drop them on the window.

**Where is my data kept?**<br>
In `~/.cdplayer` on Mac and Linux, `%LOCALAPPDATA%\CDPlayer` on Windows. Your music files are never changed unless you save tags or found art into them.

**Does CDPlayer send anything over the internet?**<br>
Only lookups — covers, lyrics, album details from MusicBrainz and Discogs — and a check for a new version on GitHub. No account, no tracking. Spotify is contacted only if you connect it.

## Coming from the Java version?

The original lives at [Kizarov3/CDPlayer-Legacy](https://github.com/Kizarov3/CDPlayer-Legacy). Your queue, history, settings and Spotify sign-in carry over automatically.

## Spotify (optional)

Spotify lets each developer app play for only five people, so CDPlayer uses your own free one. The **SPOTIFY** button walks you through it:

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) with **Web API** and **Web Playback SDK** ticked
2. Add the redirect URI `http://127.0.0.1:8080/callback`
3. Under **User Management**, add your Spotify account's email
4. Paste the **Client ID** and **Client Secret** into the SPOTIFY panel and **CONNECT SPOTIFY**

Spotify's audio is protected, so the EQ, crossfade and visualizer don't apply to it. Works on macOS and Windows; on Linux it depends on Widevine support.

## Build from source

Needs [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm start      # run the app
npm test       # unit tests
npm run dist   # build for the current OS into dist/
```

Pushing a `v*` tag builds, smoke-tests and releases all three platforms via [GitHub Actions](.github/workflows/build.yml).

## License

MIT — see [LICENSE](LICENSE). Tags are written with [node-taglib-sharp](https://github.com/benrr101/node-taglib-sharp) (LGPL-2.1-or-later), used unmodified.
