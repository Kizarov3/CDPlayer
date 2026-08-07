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

When a track is loaded, CDPlayer also searches [MusicBrainz](https://musicbrainz.org/) and the [Cover Art Archive](https://coverartarchive.org/) for a matching public album cover. The artwork is shown on the CD label and updates for each new song. If no match is found, the player keeps its original CD design.

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
