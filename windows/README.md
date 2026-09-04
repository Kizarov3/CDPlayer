# CDPlayer — Windows-only build

A Windows-only fork of the Java/Swing CDPlayer in [`../src`](../src) — this does not replace it.
It starts from the exact same file (so it has full feature parity: themes, equalizer,
visualizer, lyrics, Spotify import, everything) and then strips the handful of places that
existed only to accommodate macOS/Linux, leaning into Windows-only assumptions instead.

## What's different from `../src`

| Concern | Cross-platform build (`../src`) | This build (`windows/`) |
| --- | --- | --- |
| Fullscreen | Branches at runtime: real exclusive `GraphicsDevice` fullscreen on macOS (needed there to cover the system menu bar), borderless-maximized on everything else | Always borderless-maximized — the original code's own `[perf]` measurements showed exclusive fullscreen costs far more per frame than a plain window on Windows, since it bypasses DWM entirely. No runtime OS check, no dead branch. |
| FFmpeg/ffprobe lookup | Searches Homebrew/MacPorts paths (`/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`, …) before falling back to PATH | Searches winget's shim directory (`%LOCALAPPDATA%\Microsoft\WinGet\Links`), `Program Files\ffmpeg\bin`, `C:\ffmpeg\bin` (the folder most Windows install guides tell people to extract to), and Chocolatey's bin folder, before falling back to PATH. The winget shim check matters concretely: right after `winget install`, a PATH update doesn't reach a process that was already running, so this closes that gap immediately instead of requiring a restart. |
| App data storage | `~/.cdplayer/` (a Unix dotfile-in-home-directory convention that works on Windows but isn't native to it) | `%LOCALAPPDATA%\CDPlayer\` — the location Explorer, backup tools, and antivirus scanners actually expect for per-user app data on Windows |
| Look & feel | `UIManager.getSystemLookAndFeelClassName()` — a runtime reflection lookup that resolves to the right L&F per OS | Sets `WindowsLookAndFeel` directly — same result, skips the per-OS detection step since this build only ever runs on Windows |
| Continuous animation pacing (disc spin, theme particles, disc eject) | Fixed intervals (16ms disc/eject, 35ms particles) tuned by feel | Paced to the real display refresh rate via `ANIMATION_TICK_MS` (capped at 60fps — see its own doc comment), so DWM's compositor never re-presents a stale frame or discards one the app painted too fast. Motion constants (particle fall speed, drift, shooting-star velocity/spawn rate, disc rotation) are all rescaled by `TIME_SCALE`/`ROTATION_RAD_PER_MS` so real-world animation speed stays identical regardless of the tick length. |
| macOS Control Center bridge | `MacNowPlaying` talks to `MPNowPlayingInfoCenter`/`MPRemoteCommandCenter` via the JDK's Foreign Function & Memory API, guarded to a no-op off macOS | Stripped entirely — it's dead weight here (never activates on Windows) but its `java.lang.foreign` imports force a JDK 22+ compiler, breaking the JDK 8+ promise below for no benefit |
| Java2D rendering pipeline | `-Dsun.java2d.metal=false` — Metal (the default since JDK 17) is disabled in favor of the older OpenGL pipeline; see run.sh's own comment for why | `-Dsun.java2d.opengl=true` — Windows has had no hardware-accelerated pipeline by default since the Direct3D one was removed after JDK 8, so every antialiased fill/gradient and the disc's own per-frame rotate+blit (see DiscView.paintComponent) runs on the CPU otherwise. Requesting OpenGL explicitly turns those back into GPU work; Java2D silently falls back to software if a machine's drivers don't support it, so this is safe to leave on unconditionally. |

Nothing about the actual audio engine, UI, themes, or feature set changed — this is a lean-out
of dead cross-platform accommodation, not a rewrite. Kept in sync with `../src` by hand (see its
own commit history for "windows: ..." / "Mirrored into windows/ ..." commits) whenever the
cross-platform build changes; this fork is periodically re-forked wholesale from `../src` and has
the deltas above re-applied, rather than porting every intervening commit one at a time.

## Building and running

**Prerequisites:** JDK 8+, and (same as the cross-platform build) **FFmpeg** for MP3/FLAC/M4A
playback — see the [FFmpeg install instructions](../README.md#installing-ffmpeg) in the main
README; `winget install Gyan.FFmpeg` is the easiest route on Windows.

```powershell
cd windows
run.bat
```

Or manually, same shape as the cross-platform build's `run.sh`:

```powershell
cd windows
javac -d out (Get-ChildItem -Recurse -Filter *.java src | ForEach-Object FullName)
Copy-Item src\main\java\com\cdplayer\icon.png out\com\cdplayer\icon.png
java -Dsun.java2d.opengl=true -cp out com.cdplayer.CDPlayer
```

## Project layout

```
windows/
  run.bat                                    Build + launch in one step
  src/main/java/com/cdplayer/CDPlayer.java   Forked from ../src, Windows-only edits applied
  src/main/java/com/cdplayer/icon.png        Same app icon as the cross-platform build
```
