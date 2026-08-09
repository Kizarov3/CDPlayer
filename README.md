# CDPlayer

CDPlayer is a Java desktop app that recreates the tactile feel of a physical CD player for local audio playback. Load a track, press play, and enjoy a simple, distraction-free music experience without relying on a browser or web app — no accounts, no streaming, no internet required to play a song.

## About

- Built with plain Java and native Swing/AWT — no external UI framework, single self-contained app
- Plays local audio files, with FFmpeg handling the formats Java can't decode natively
- Full queue management: drag-and-drop, shuffle, repeat, crossfade, and per-track removal
- Six built-in visual themes, including an animated snow/Christmas theme
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
- Drag and drop individual files or whole folders (recursively) to build a queue
- Shuffle and repeat modes
- Adjustable crossfade (0–15s) between tracks using an equal-power fade curve, so the transition doesn't dip in volume
- Keyboard shortcuts: `Space` / `K` play-pause, `J` / `L` previous/next track, `←` / `→` skip 15 seconds

**Queue**
- Full queue list with per-track duration, click-to-play, and a hover-to-reveal remove (×) button
- "Up next" preview and live queue position (e.g. `QUEUE 3 / 10`)

**Now playing**
- Spinning disc animation inside a jewel-case backdrop, with your album art on the disc label and case thumbnail
- Live audio visualizer bars that react to the actual decoded waveform, not a fake animation
- Metadata display (artist, title, album) read from the file's tags, with the filename as a fallback
- Embedded album art extraction, with automatic iTunes/Deezer cover lookup when a file has none

**Themes**
- Six built-in themes — RED, BLUE, SUNSET, FOREST, VAPOR, SNOW — with a smooth animated color transition when switching
- The SNOW theme adds gently falling snow across the whole window and swaps the bar visualizer for a small animated Christmas tree whose ornament lights pulse with the music, just like the normal visualizer bars

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

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
