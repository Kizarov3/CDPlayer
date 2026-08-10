# CDPlayer

CDPlayer is a Java desktop app that recreates the tactile feel of a physical CD player for local audio playback. Load a track, press play, and enjoy a simple, distraction-free music experience without relying on a browser or web app — no accounts, no streaming, no internet required to play a song.

<p align="center">
  <img src="assets/screenshots/main-red-theme-3.png" width="49%" alt="CDPlayer main window, RED theme, playing a track">
  <img src="assets/screenshots/main-snow-theme-3.png" width="49%" alt="CDPlayer main window, SNOW theme with falling snow overlay">
</p>

## About

- Built with plain Java and native Swing/AWT — no external UI framework, single self-contained app
- Plays local audio files through a custom low-latency streaming engine, with FFmpeg handling the formats Java can't decode natively
- Full queue management: drag-and-drop, shuffle, repeat, crossfade, volume, mono downmix, and per-track removal — queue is saved automatically and restored next launch
- Nine built-in animated themes, each with its own falling/drifting particle effect and a matching reactive visualizer
- True fullscreen, and a dedicated Settings dialog for theme/crossfade/mono
- Automatic metadata and album art, with an online lookup fallback when a file has none
- Works on Windows, macOS, and Linux

## ⚠️ FFmpeg is required

**CDPlayer cannot play most real-world music files without FFmpeg installed.** Java's built-in audio support only understands a handful of uncompressed/legacy formats:

| Format | Needs FFmpeg? |
| --- | --- |
| WAV, AIFF, AU | No — plays natively |
| **MP3, FLAC, M4A** | **Yes — will not play at all without FFmpeg** |

If FFmpeg isn't installed (or can't be found), loading an MP3/FLAC/M4A file fails with an "INSTALL FFMPEG FOR FLAC / M4A" status message instead of playing. FFmpeg (via `ffprobe`) is also what reads embedded tags (artist/title/album) and extracts embedded cover art — without it, CDPlayer falls back to guessing the title from the filename and skips embedded artwork. Since MP3 is by far the most common format people actually have, **installing FFmpeg should be treated as a required step, not an optional one.**

See [Installing FFmpeg](#installing-ffmpeg) below for your platform.

## Features

**Playback**
- Native playback for WAV, AIFF, and AU; FFmpeg-backed playback for MP3, FLAC, and M4A
- Custom low-latency streaming audio engine — volume changes and seeks apply in well under 100ms, not the multi-second lag you'd get from Java's stock `Clip` API
- Drag and drop individual files or whole folders (recursively) to build a queue, or use **Load a Track** — the file picker remembers the last folder you browsed and reopens there next time
- Shuffle and repeat as icon toggles next to the transport controls, with an "Up Next" preview that always reflects what will actually play next (the shuffled pick or the repeated track, not just the next queue slot)
- Adjustable crossfade (0–15s) using an equal-power fade curve so the transition doesn't dip in volume — only kicks in when the queue naturally advances to the next track, never when you manually pick a different one
- Volume slider with near-instant gain control, correctly blended into an in-progress crossfade instead of fighting it
- Mono audio toggle — sums left/right channels together, useful for a single speaker or one earbud
- True fullscreen (`F` to enter, `Esc` to exit) that hides the OS menu bar/dock, not just a resized window
- Keyboard shortcuts: `Space` / `K` play-pause, `J` / `L` previous/next track, `←` / `→` skip 15 seconds

**Queue**
- Full queue list with per-track duration, click-to-play, and a hover-to-reveal remove (×) button
- One-click **Clear Queue** button, disabled automatically when there's nothing to clear
- "Up next" preview and live queue position (e.g. `QUEUE 3 / 10`)
- The queue, current track, and exact playback position are all saved when you close the app and restored next launch — resumes right where you left off, ready to play but not auto-started

**Now playing**
- Spinning disc animation inside a jewel-case backdrop, with your album art on the disc label and case thumbnail
- Live audio visualizer that reacts to the actual decoded waveform, not a fake animation — its shape changes with the active theme (see below)
- Metadata display (artist, title, album) read from the file's tags, with the filename as a fallback
- Embedded album art extraction, with automatic iTunes/Deezer cover lookup when a file has none

**Settings**
- A dedicated Settings dialog (opened from the header) holds the Theme picker, Crossfade slider, Mono Audio toggle, and an Animations toggle, keeping the main screen focused on playback
- Fully live: switching themes updates the dialog's own colors immediately, even while it's open
- Volume, crossfade, mono audio, and the animations preference all persist across launches instead of resetting to defaults
- A GitHub link at the bottom (icon + username) opens the project author's profile in your browser

**Motion**
- Buttons, toggles, and the Settings dialog animate smoothly — hover fades, a squish-and-recover pulse on press, crossfaded on/off states, and a grow-and-fade dialog open/close — instead of snapping instantly
- An **Animations** toggle in Settings turns all of it off at once for anyone who prefers a completely static UI

<p align="center">
  <img src="assets/screenshots/settings-dialog-4.png" width="70%" alt="CDPlayer Settings dialog showing Theme, Crossfade, Mono Audio, and Animations controls">
</p>

**Themes**
- Nine built-in themes — RED, BLUE, SUNSET, FOREST, GALAXY, OCEAN, MATRIX, AUTUMN, SNOW — each with a genuinely distinct palette, and a smooth animated color transition when switching
- Five of them replace the plain bar visualizer with a themed, audio-reactive shape driven by the exact same levels the bars use:
  - **SNOW** — gently falling snow across the whole window; visualizer becomes a small pine tree whose ornament lights pulse with the music
  - **GALAXY** — a twinkling starfield with the occasional shooting star; visualizer becomes a 5-star constellation that brightens with the beat
  - **OCEAN** — rising bubbles with a soft light shimmer sweeping across the water; visualizer becomes a pair of reactive wave layers
  - **MATRIX** — falling green code rain; visualizer becomes a miniature version of the same rain, column heights driven by the audio
  - **AUTUMN** — drifting, tumbling autumn leaves; visualizer becomes a small branch whose leaves brighten and grow with the music

**First launch**
- A one-time welcome dialog covers drag-and-drop, keyboard shortcuts, themes, the FFmpeg requirement, and queue persistence — shown once, then never again

## Quick Start

### Prerequisites

- Java Development Kit (JDK) 8 or newer
- **FFmpeg** — required for MP3/FLAC/M4A playback, metadata tags, and embedded cover art (see above)

### Installing FFmpeg

#### Windows

The easiest way is with **WinGet**. Open Command Prompt or PowerShell and run:

```powershell
winget install Gyan.FFmpeg
```

#### macOS

The easiest way is with **Homebrew**. Open Terminal and run:

```bash
brew install ffmpeg
```

#### Linux

##### Fedora

```bash
sudo dnf install ffmpeg
```

##### Arch

```bash
sudo pacman -S ffmpeg
```

##### Debian / Ubuntu

```bash
sudo apt install ffmpeg
```

After installing, restart CDPlayer if it was already running.

### Run the released app

If you downloaded a release archive, extract it and run the executable file inside:

- Windows: double-click the `.exe` file
- macOS: open the app bundle or run the launcher from Terminal
- Linux: run the launcher script or executable from the extracted folder

### Run from source

```bash
javac -d out $(find src -name '*.java')
java -cp out com.cdplayer.CDPlayer
```

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` or `K` | Play / Pause |
| `J` | Previous track |
| `L` | Next track |
| `←` | Skip back 15 seconds |
| `→` | Skip forward 15 seconds |
| `F` | Toggle fullscreen |
| `Esc` | Exit fullscreen |

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
