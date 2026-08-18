# CDPlayer — Windows-native build

A from-scratch rewrite of CDPlayer targeting **Windows only**, living alongside the original
cross-platform Java/Swing build in [`../src`](../src) — this does not replace it. Where the
Java build reaches for the lowest common denominator across Windows/macOS/Linux (plain
Swing/AWT, an external FFmpeg binary for most real-world audio formats), this build uses
Windows' own native APIs directly:

| Concern | Java build (`../src`) | This build (`windows/`) |
| --- | --- | --- |
| UI | Swing/AWT, hand-drawn | WPF (native Win32 windowing, DirectX-composited) |
| Audio decode/playback | Java Sound + bundled **FFmpeg** for MP3/FLAC/M4A | `System.Windows.Media.MediaPlayer`, which is backed by **Media Foundation** — the same OS-level decoder Windows Media Player/Movies & TV use. MP3, AAC/M4A, WAV, WMA, and (Windows 10 1709+) FLAC all decode natively. **No FFmpeg dependency.** |
| Tag/cover art reading | FFmpeg/`ffprobe` | Hand-written ID3v2/ID3v1 (MP3), Vorbis comment + PICTURE block (FLAC), and `ilst` atom (M4A/MP4) parsers in pure C# — see [`Services/MetadataReader.cs`](CDPlayer.Windows/Services/MetadataReader.cs). No external tool. |
| File/folder pickers | Swing `JFileChooser` | Native Win32 common dialogs (`Microsoft.Win32.OpenFileDialog`, WinForms `FolderBrowserDialog`) |

## Current scope

This is a **core-playback MVP**, not yet full feature parity with the Java build. Implemented:

- Add files / add folder (recursive) / drag-and-drop files and folders onto the window
- Queue list with per-track duration (populated the first time a track is opened — see
  "Known simplifications" below), click-to-play, remove
- Transport: play/pause, previous/next, shuffle, three-way repeat (off/one/all)
- Seek bar, volume, elapsed/remaining time
- Metadata (title/artist/album) and embedded cover art, filename as fallback
- Queue + current track + playback position + volume persisted to
  `%LOCALAPPDATA%\CDPlayer\state.json` and restored on next launch (paused, matching the
  Java build's behavior)
- Keyboard shortcuts: `Space`/`K` play-pause, `J`/`L` previous/next, `←`/`→` seek 15s

**Not yet ported** from the Java build: themes, the 10-band equalizer, the audio-reactive
visualizer, lyrics lookup, Spotify link import, crossfade, mono downmix, sleep timer,
fullscreen/CD view, `.m3u` playlist import/export, recursive filename search, recently-played
history, drag-to-reorder in the queue, and the animated welcome/what's-new dialogs.

## Known simplifications

- **Duration** for a queued track shows `--:--` until that track has actually been opened
  once (Media Foundation only reports duration after opening a file, unlike `ffprobe` which
  can be queried upfront without playing anything).
- WAV/AIFF/AU files aren't tag-parsed (rare to have tags in practice) — they always fall back
  to the filename.

## Building and running

**Prerequisites:** [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0), Windows 10
version 1809 or later (Windows 10 1709+ for native FLAC decoding; earlier versions still play
MP3/WAV/M4A/WMA fine).

```powershell
cd windows/CDPlayer.Windows
dotnet run -r win-x64
```

Or open `CDPlayer.Windows.csproj` in Visual Studio 2022 and run/debug from there (`F5`).

To build a standalone folder you can copy elsewhere:

```powershell
dotnet publish -r win-x64 -c Release --self-contained true -p:PublishSingleFile=true
```

## Project layout

```
CDPlayer.Windows/
  App.xaml(.cs)              Application entry point, shared styles/brushes
  MainWindow.xaml(.cs)        The whole UI: queue panel + now-playing panel + transport
  Models/AudioTrack.cs        Bindable track (title/artist/album/duration/art)
  Services/PlaybackEngine.cs  Thin wrapper around WPF's MediaPlayer (Media Foundation)
  Services/MetadataReader.cs  Pure C# ID3v2/ID3v1/FLAC/MP4 tag + cover art parser
  Services/QueueStore.cs      JSON persistence to %LOCALAPPDATA%\CDPlayer\state.json
```
