# CD like Player

A tactile, CD-inspired music player built with Java and plain browser APIs. Drop in a local audio file, press play, and the disc spins like a real one.

## Run locally

Requires **Java 8+**—no framework or package install needed.

```bash
./run.sh
```

Then open [http://localhost:8080](http://localhost:8080).

## Use it

Choose an audio file with the **Load a track** button, or drag one anywhere onto the player. Audio stays in the browser and is never uploaded.

## Share with friends

This project is ready for a GitHub repository. From this directory:

```bash
git add .
git commit -m "Create CD like Player"
# Create an empty GitHub repo, then:
git remote add origin https://github.com/YOUR-USERNAME/cd-like-player.git
git branch -M main
git push -u origin main
```

For a public live version, publish the `public` folder with any static host (GitHub Pages, Netlify, or Vercel). The Java server is only needed for local development.

