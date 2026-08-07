# CDPlayer

A tactile, CD-inspired **Java desktop app**. Load a local track, press play, and the CD spins like a real one. It does not use a browser or HTML.

## Run locally

Requires a **Java Development Kit (JDK) 8+**-no framework or package install needed.

```bash
./run.sh
```

The CDPlayer desktop window opens directly.

## Use it

Choose an audio file with the **Load a track** button, or drag one onto the player. Audio stays on your device and is never uploaded. WAV, AIFF, and AU work with Java directly. FLAC and M4A are automatically converted for playback with [FFmpeg](https://ffmpeg.org/), which must be installed and available on your system path (`brew install ffmpeg` on macOS).

Drop several songs or an entire folder to create a queue. CDPlayer scans folders for supported audio, plays them in order, and includes Shuffle and Repeat controls.

CDPlayer prioritizes embedded album artwork and song tags (artist, title, album) from the audio file itself, so the displayed cover is the one packaged with the track. When no embedded art is available, it searches Apple’s iTunes catalogue using the tagged artist and title. The artwork updates for each new song.

## How to run

Prerequisites:

- Java Development Kit (JDK) 8 or newer
- `ffmpeg` on your PATH for FLAC/M4A support (`brew install ffmpeg` on macOS)

Run locally (recommended):

```bash
chmod +x ./run.sh
./run.sh
```

Alternative (compile & run manually):

```bash
# compile
javac -d out $(find src -name '*.java')

# run
java -cp out com.cdplayer.CDPlayer
```

If `ffmpeg` is not available, WAV/AIFF/AU play natively; FLAC/M4A tracks will fail to play until `ffmpeg` is installed.

## Features

- Local audio playback (WAV, AIFF, AU). FLAC/M4A supported via `ffmpeg` conversion.
- Drag & drop files or folders to add items to the queue.
- Folder scanning to add entire albums or directories.
- Queue management with Shuffle and Repeat modes.
- Embedded metadata display (artist, title, album, track time).
- Album artwork priority: uses embedded art when available, falls back to iTunes lookup.
- Simple, CD-like desktop UI with compact and expanded views.

## Troubleshooting

- Permission errors running `./run.sh`: ensure it is executable (`chmod +x ./run.sh`).
- No sound: check system audio output and verify Java can access audio devices.
- Missing artwork: confirm files include embedded tags, or internet access is available for iTunes lookup.
