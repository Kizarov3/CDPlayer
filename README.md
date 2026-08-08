# CDPlayer

CDPlayer is a Java desktop app that recreates the tactile feel of a physical CD player for local audio playback. Load a track, press play, and enjoy a simple, distraction-free music experience without relying on a browser or web app.

## About

- Built with Java and native Swing/AWT desktop UI
- Plays local audio files directly, with optional FFmpeg support for FLAC and M4A
- Includes queue management, shuffle, repeat, metadata display, and album artwork
- Works on Windows, macOS, and Linux

## Quick Start

### Prerequisites

- Java Development Kit (JDK) 8 or newer
- Optional: FFmpeg for FLAC/M4A playback

### Run on Windows

```cmd
run.bat
```

### Run on macOS and Linux

```bash
chmod +x ./run.sh
./run.sh
```

### Run manually

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

## Build and Package

### Build from source

```bash
javac -d out $(find src -name '*.java')
```

### Windows launcher

On a Windows machine, run:

```cmd
build-windows-exe.bat
```

This creates a runnable folder in dist\\windows with a Java launcher and a batch file. A true native .exe installer can be made later with Launch4j or Inno Setup.

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
