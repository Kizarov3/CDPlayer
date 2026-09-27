# Audio CDs on Windows

Date: 2026-09-27 · Status: draft for review

## Goal

On Windows, an audio CD in the drive works as it does on macOS and Linux: the **AUDIO CD** button appears, the disc
is named from MusicBrainz (by its disc ID) with its cover, it goes in through the tray and plays, seeking is
instant, and opening the tray (`E`) ejects the real disc.

What the user said: "make listening from CD available for Windows". Tested by the user on Windows 11 (ARM, in UTM on
this Mac) with the Mac's CD drive passed through as a USB device.

## Why Windows needs its own way

macOS mounts an audio CD as AIFF files and GNOME's gvfs as WAV files; CDPlayer plays those like any file
(`src/main/audio-cd.js`). Windows shows only `.cda` shortcut files with no audio behind them, so the audio has to be
read from the drive itself: its table of contents and raw 2352-byte audio sectors, through Windows' own CD device
calls (`DeviceIoControl` on `\\.\D:` — `IOCTL_CDROM_READ_TOC`, `IOCTL_CDROM_RAW_READ`, `IOCTL_STORAGE_EJECT_MEDIA`).

## Design

### 1. The drive helper — `src/main/win-cd/helper.ps1`

A PowerShell script holding a small C# class, compiled with `Add-Type` when the script starts (no install, no
shipped binary). It is started **once**, the first time CDPlayer looks for a disc on Windows, as
`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File helper.ps1`, and stays running.

Protocol over stdin/stdout — one JSON request per stdin line; each answer is one JSON header line on stdout followed
by exactly `bytes` raw bytes (0 for most answers):

| Request | Answer header | Payload |
|---|---|---|
| `{"id":1,"op":"drives"}` | `{"id":1,"ok":true,"drives":["D:"],"bytes":0}` — CD/DVD drives (`DriveType.CDRom`) | — |
| `{"id":2,"op":"toc","drive":"D:"}` | `{"id":2,"ok":true,"bytes":804}` | the raw `CDROM_TOC` structure |
| `{"id":3,"op":"read","drive":"D:","lba":150,"count":25}` | `{"id":3,"ok":true,"bytes":58800}` | `count × 2352` bytes of CD audio (44.1 kHz, 16-bit, stereo, little-endian) |
| `{"id":4,"op":"eject","drive":"D:"}` | `{"id":4,"ok":true,"bytes":0}` | — |

Errors: `{"id":…,"ok":false,"error":"…","bytes":0}` (no disc, not an audio disc, a read error). Reads are split
inside the helper into chunks the driver accepts (≤ 20 sectors per `IOCTL_CDROM_RAW_READ`). The script ships
unpacked from the app archive (added to `asarUnpack`).

### 2. The Node side — `src/main/win-cd.js`

- Starts the helper lazily, writes requests, parses the framed answers back (a small incremental parser: header
  line, then the payload bytes), and matches them to requests by `id`. One request in flight per drive at a time.
- `parseToc(buffer)` → `{ first, last, leadout, offsets, tracks }` — the same shape `tocFromPlist` gives on macOS
  (offsets are absolute sector numbers, +150), audio tracks only (a data track's control bit 2 set is left out; an
  enhanced CD's audio ends 11 400 sectors before its data session, as on macOS).
- `listDiscs()` → for each drive whose TOC has audio tracks: `{ kind: 'win', mount: 'D:', name: 'Audio CD', tracks:
  ['cdda://D/1', …], toc, id: discId(toc) }` — the shape `audio-cd.js` already uses, so naming, the shelf's
  AUDIO CD button, the tray and the queue work unchanged.
- `readSectors(drive, lba, count)`, `eject(drive)`.
- If the helper can't start or dies twice: Windows CD support is off for this session (one log line), and
  `listDiscs()` returns `[]`.

### 3. Finding discs — `src/main/audio-cd.js` / `main.js`

- `findDiscs()` on `win32` asks `win-cd.listDiscs()` (read once when a disc turns up, as for other systems).
- The disc watcher in `main.js` runs on Windows too; `cd:eject` calls `win-cd.eject(drive)`.
- A track's length comes from its TOC entry (next offset − its offset, in sectors / 75 s).

### 4. Playing — `src/main/media-protocol.js`

- A `cdda://D/<n>` path is served as a WAV: a 44-byte header (44.1 kHz, 16-bit, stereo) then the track's sectors.
  Size = 44 + sectors × 2352, known up front, so Range requests (seeking) work: a byte range maps to the sectors
  that cover it, which are read (in chunks of 25) and trimmed to the range.
- A sector that fails to read is retried once, then served as silence (a skip, like a real player) — the song never
  stops on a scratch.

### 5. Other places that assume a file

- `metadata.getDetails` for a `cdda://` path: never touches the file system; title/artist/album/track from
  `audioCd.detailsFor` (MusicBrainz) or "Track N", duration from the TOC, format `CD AUDIO · 16-BIT · 44.1 KHZ`.
- No waveform for CD tracks (as for cue tracks): it would read the whole track off the disc first.
- The renderer's audio-CD checks (`isAudioCdTrack`) also recognise `cdda://` paths; the Tags button stays hidden.
- A restored queue with `cdda://` tracks whose disc is gone drops them, as it does for missing files.

## Out of scope

- Ripping (a later project; it will reuse `readSectors`).
- CD-TEXT, and Windows on locked-down machines where PowerShell is blocked (the button just doesn't appear).
- Drives that don't support raw CD audio reads (very old ones).

## Testing

Unit tests on this Mac (node --test, no Windows needed):
- `parseToc`: a real `CDROM_TOC` byte layout → offsets/leadout/tracks; the MusicBrainz disc ID matches the one
  macOS computes for the same disc (Three Dollar Bill, Y'all$ — the user's CD); a data track left out.
- The framed-answer parser: headers and payloads split across chunks in every way, several answers in one chunk.
- `cdda://` byte range → sector range and trimming; the WAV header bytes.
- `metadata.getDetails` for `cdda://` paths never touches the file system.

On Windows:
- GitHub Actions (`windows-latest`, already in the release workflow): a smoke step starts the helper, which must
  compile its C# and answer `drives` (an empty list there).
- The user, in Windows 11 ARM on UTM (x64 emulation runs the x64 build): a test build from `npm run dist:win`,
  copied into the VM; the Mac's CD drive passed to the VM as a USB device (QEMU backend), CDPlayer on the Mac quit
  first. Check: button appears → named → plays → seeks → next track → eject. Iterate on what they report.
