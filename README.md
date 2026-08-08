# CDPlayer

CDPlayer is a Java desktop app that recreates the tactile feel of a physical CD player for local audio playback. Load a track, press play, and enjoy a simple, distraction-free music experience without relying on a browser or web app.

## About

- Built with Java and native Swing/AWT desktop UI
- Plays local audio files directly, with FFmpeg support for FLAC and M4A
- Includes queue management, shuffle, repeat, metadata display, and album artwork
- Works on Windows, macOS, and Linux
------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
## Quick Start

### Prerequisites

- Java Development Kit (JDK) 8 or newer
- **FFmpeg** for playback

### Installing FFmpeg



#### Windows

The easiest way is with **WinGet**. Open Command Prompt or PowerShell and run:

```powershell
winget install Gyan.FFmpeg
```

#### MacOS

The easiest way is with **Homebrew**. Open Terminal and run:

```bash
brew install ffmpeg
```

### Linux
#### Fedora

```bash
sudo dnf install ffmpeg
```

#### Arch

```bash
sudo pacman -S ffmpeg
```

#### Debian / Ubuntu:

```bash
sudo apt install ffmpeg
```

### Run the released app

If you downloaded a release archive, extract it and run the executable file inside:

- Windows: double-click the .exe file
- macOS: open the app bundle or run the launcher from Terminal
- Linux: run the launcher script or executable from the extracted folder

### Run from source

```bash
javac -d out $(find src -name '*.java')
java -cp out com.cdplayer.CDPlayer
```

## Features

- Local audio playback for WAV, AIFF, MP3 and AU files
- Optional FLAC/M4A support through FFmpeg
- Drag and drop files or folders into the queue
- Shuffle and repeat controls
- Metadata display for artist, title, album, and track time
- Embedded album artwork support

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
