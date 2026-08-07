# CDPlayer

A tactile, CD-inspired **Java desktop app**. Load a local track, press play, and the CD spins like a real one. It does not use a browser or HTML.

## Run locally

Requires a **Java Development Kit (JDK) 8+**—no framework or package install needed.

```bash
./run.sh
```

The CDPlayer desktop window opens directly.

## Use it

Choose an audio file with the **Load a track** button, or drag one onto the player. Audio stays on your device and is never uploaded. The built-in Java audio engine supports WAV, AIFF, and AU files.

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
