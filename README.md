# CDPlayer

A tactile, CD-inspired **Java desktop app**. Load a local track, press play, and the CD spins like a real one. It does not use a browser or HTML.

## Run locally

Requires a **Java Development Kit (JDK) 8+**—no framework or package install needed.

```bash
./run.sh
```

The CDPlayer desktop window opens directly.

## Use it

Choose an audio file with the **Load a track** button, or drag one onto the player. Audio stays on your device and is never uploaded. WAV, AIFF, and AU work with Java directly. FLAC and M4A are automatically converted for playback with [FFmpeg](https://ffmpeg.org/), which must be installed and available on your system path (`brew install ffmpeg` on macOS).

Drop several songs or an entire folder to create a queue. CDPlayer scans folders for supported audio, plays them in order, and includes Shuffle and Repeat controls.

CDPlayer prioritizes embedded album artwork and song tags (artist, title, album) from the audio file itself, so the displayed cover is the one packaged with the track. When no embedded art is available, it searches Apple’s iTunes catalogue using the tagged artist and title. The artwork updates for each new song.

## Share with friends

This project is ready for a GitHub repository. From this directory:

```bash
git add .
git commit -m "Create CDPlayer"
# Create an empty GitHub repo, then:
git remote add origin https://github.com/YOUR-USERNAME/CDPlayer.git
git branch -M main
git push -u origin main
```

Friends can clone the repository and run `./run.sh` with a JDK installed.
