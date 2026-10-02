# Audio quality — design

## Goal

A sound-quality setting like Apple Music's: **HIGH**, **LOSSLESS** and **HI-RES LOSSLESS**. Today every track plays
at the system's sample rate (`new AudioContext()` in `src/renderer/js/audio.js` takes the device's rate, usually
48 kHz on a Mac), so a 96 kHz FLAC is cut to 48 kHz and a 44.1 kHz CD rip is resampled to 48. With LOSSLESS or
HI-RES LOSSLESS, a track plays at its own rate all the way to the output device: CDPlayer switches the device's
sample rate on macOS and Windows, and puts it back afterwards. A badge under the title says what reaches the output.

## Decisions (agreed)

- Three levels, named as in Apple Music. Local files have nothing to "download in better quality": the levels decide
  the rate the audio leaves CDPlayer at.
- The output device's rate is switched on **macOS** (CoreAudio) and **Windows** (the device's default format); not on
  Linux, where PipeWire follows the stream's rate when its settings allow.
- No Dolby Atmos; Spotify isn't affected (its SDK has no quality setting).
- Crossfading between two tracks at different rates becomes a plain cut (the engine restarts at the new rate). Within
  an album the rate doesn't change, so crossfade and gapless cue sheets work as before.

## Levels

`targetRate(level, fileRate, systemRate)` (pure):

| Level | Rate the engine plays at |
| --- | --- |
| `HIGH` (default) | `systemRate` — as today; nothing is switched |
| `LOSSLESS` | `fileRate`, but at most 48000 (above that: 48000) |
| `HIRES` | `fileRate`, up to 192000 (above that: 192000) |

A track without a known rate (Spotify, an unreadable header) keeps the engine's current rate. Lossy files (MP3, AAC,
Opus, Vorbis) follow the same rule: no resampling is the point, not the badge.

`deviceRate(wanted, supported)` (pure): `wanted` if the device supports it; otherwise the lowest supported rate that is
a whole multiple of it (88.2 → 176.4); otherwise the highest supported rate below it of the same family (44.1 kHz ×n or
48 kHz ×n), then any highest supported rate. The engine then plays at the device's rate, so only one resampling happens,
in Chromium, never two.

## The engine

`src/renderer/js/audio.js`:
- `AudioEngine` builds its graph in `build(rate)` (input → EQ → analyser → master → destination, plus the recording
  destination when one exists); the constructor calls `build()` with no rate (the system's).
- `async setRate(rate)`: if `rate` equals `ctx.sampleRate`, nothing. Otherwise stops and disposes the decks, closes the
  context, builds a new one with `{ sampleRate: rate, latencyHint: 'playback' }`, and re-applies volume, mono, EQ gains
  and the output device (`setSinkId(outputId)`). Listeners registered with `onContextChange(fn)` get the new context —
  `disc-noise.js` rebuilds its nodes there.
- `rate` getter: `ctx.sampleRate`.

`src/renderer/js/app.js`, before `engine.load(url, …)` of a file track:
1. `wanted = targetRate(settings.quality, details.format.sampleRate, systemRate)`.
2. If `wanted` differs from the engine's rate: `got = await cdp.outputRate.set(outputDevice, wanted)` (the main process
   returns the rate the device is now at, or `null` if it couldn't be switched); `await engine.setRate(got || wanted)`;
   no crossfade for this track.
3. The badge is updated with `{ fileRate, engineRate, deviceRate, reason }`.

`systemRate` is the device's rate as found at startup (or after `outputRate.restore()`), from `cdp.outputRate.current()`,
falling back to a fresh `AudioContext().sampleRate`.

`metadata.js` adds `format: { sampleRate, bitsPerSample, lossless }` to a track's details (CD tracks: 44100 / 16 / true);
`quality` (the readout string) stays as it is.

## Switching the device's rate

`src/main/output-rate.js`, one interface over two helpers, created with `{ platform, run, read, write }` for tests:
- `supported(device)` → `number[]` of rates, or `[]` when unknown;
- `current(device)` → `number | null`;
- `set(device, hz)` → the rate now set (after `deviceRate`), or `null`;
- `restore()` → puts every device it changed back to the rate it had first.

`device` is `{ id, label }` as the OUTPUT setting has it; `null` is the system default. The helpers find a chosen device
by its name (Chromium's device ids are hashed and don't match the system's). An unknown name → the system default.

Before its first change to a device, `output-rate.js` writes `{ [deviceKey]: originalRate }` to `output-rate.json` in
the data folder. `restore()` runs on `before-quit`, when the level is set back to HIGH, and at startup when the file is
left over from a crash; the file is removed once everything is restored.

**macOS — `src/main/mac-rate/rate.swift`**, built by `scripts/build-mac-rate.js` (`swiftc` for arm64 and x86_64,
`lipo` into one binary, `build/mac-rate`) before `electron-builder` on a Mac, and shipped as an extra resource
(`Contents/Resources/mac-rate`). The same universal binary goes into both halves of the universal app, so electron-builder's merge sees identical files; it is then covered by the app's code signature, after the VMP signing in `afterPack` (the order castLabs requires stays as it is). Commands (one per run, JSON on stdout):
- `mac-rate list` → `[{ name, uid, rate, rates: [..] , transport }]` for output devices
  (`kAudioDevicePropertyNominalSampleRate`, `…AvailableNominalSampleRates`, `…TransportType`);
- `mac-rate set <uid|default> <hz>` → `{ rate }` after the change has been confirmed by the device's notification
  (2 s timeout).

**Windows — `src/main/win-rate/helper.ps1`**, like `win-cd/helper.ps1`: C# compiled on the spot with `Add-Type`, run by
`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File`, unpacked from the asar. Commands:
- `list` → output endpoints `{ name, id, rate, bits, rates }`: the current rate from the endpoint's
  `PKEY_AudioEngine_DeviceFormat`; `rates` = which of 44100…192000 `IAudioClient::IsFormatSupported(EXCLUSIVE, …)`
  accepts at the device's bit depth;
- `set <id|default> <hz>` → `{ rate }`: builds a `WAVEFORMATEXTENSIBLE` at the device's channels and bit depth and the new
  rate and calls `IPolicyConfig::SetDeviceFormat(id, fmt, fmt)` — the undocumented interface the Sound control panel
  itself uses; no administrator rights. Read back with `list` to confirm.

**Linux:** `supported`/`current`/`set` return `[]`/`null`/`null`.

**Bluetooth:** a device whose transport is Bluetooth (macOS `kAudioDeviceTransportTypeBluetooth`/`…BluetoothLE`;
Windows: the endpoint's enumerator is `BTHENUM`/`BTHLEDEVICE`) is never switched.

## The badge

Under the title, beside the existing readout (`FLAC · 24-BIT · 96 KHZ`), when the level isn't HIGH and the track is
lossless:
- `◈ LOSSLESS` for a track ≤ 48 kHz, `◈ HI-RES LOSSLESS` above 48 kHz (and ≥ 24-bit);
- dimmed, with the same text, when the output isn't the file's rate.

Hover (tooltip), `badgeText({ fileRate, deviceRate, engineRate, bluetooth, eq, mono, platform })` (pure):
- `OUTPUT: 96 KHZ — NOT RESAMPLED`
- `OUTPUT: 48 KHZ — RESAMPLED (THE DEVICE CAN'T PLAY 192 KHZ)`
- `OUTPUT: 48 KHZ — RESAMPLED (SET THE RATE IN YOUR SOUND SETTINGS)` (Linux, or the helper failed)
- `BLUETOOTH: QUALITY IS LIMITED BY THE WIRELESS CODEC`
- a second line when EQ is not flat or mono is on: `THE EQUALIZER / MONO CHANGES THE SOUND`.

No badge for lossy files, Spotify, or on HIGH.

## Settings

**Settings → QUALITY** (after OUTPUT): a menu `HIGH`, `LOSSLESS · UP TO 24-BIT / 48 KHZ`,
`HI-RES LOSSLESS · UP TO 24-BIT / 192 KHZ`, with the hint: "Lossless plays each song at its own sample rate; CDPlayer
switches your output's rate to match and puts it back when it closes. Over Bluetooth, the wireless codec limits it."
Changing it applies from the next track; switching to HIGH restores the device's rate at once.

`settings.txt` line 19: `HIGH` | `LOSSLESS` | `HIRES` (missing or unknown → `HIGH`).

Every new text goes through `t()` and is translated in `ru.json`.

## Code units

- `src/renderer/js/quality.js` (pure): `targetRate`, `deviceRate`, `badgeLabel(format, level)`, `badgeText(...)`.
- `src/renderer/js/audio.js`: `build`, `setRate`, `rate`, `onContextChange`.
- `src/renderer/js/disc-noise.js`: rebuilds on a new context.
- `src/renderer/js/app.js`: the rate step before loading a track; the badge.
- `src/renderer/js/panels.js`: QUALITY in Settings.
- `src/main/output-rate.js`: the interface, the restore file, choosing the helper; pure parsers `parseMacList`,
  `parseWinList` exported for tests.
- `src/main/mac-rate/rate.swift`, `scripts/build-mac-rate.js`; `src/main/win-rate/helper.ps1`.
- `src/main/metadata.js`: `format` in details. `src/main/store.js`: `quality` setting.
- IPC: `outputRate:current`, `outputRate:set`, `outputRate:restore`.
- `package.json`: `asarUnpack` `src/main/win-rate/**`; mac `extraResources` `build/mac-rate`; `dist:mac` runs the
  Swift build first. CI (`.github/workflows/build.yml`) builds it on the macOS runner.

## Errors

- A helper that can't run, times out (5 s) or answers nonsense → `set` returns `null`; the track plays with the engine
  at the file's rate and the system resampling; the badge says so. The error is logged once per session.
- A device that's unplugged while switched: nothing to restore; its entry is dropped from `output-rate.json`.
- `new AudioContext({ sampleRate })` that throws (a rate Chromium refuses) → the engine stays at its current rate.
- A track whose load is superseded while the rate is being switched: the newer load wins; the rate is set again for it.

## Testing

- `test/quality.test.mjs`: `targetRate` for every level and 44.1/48/88.2/96/176.4/192/352.8 kHz files and unknown rates;
  `deviceRate` (exact, multiple, same family below, anything below, empty list); `badgeLabel`; `badgeText` for each case,
  in English and Russian.
- `test/output-rate.test.js` (fake `run`, `CDPLAYER_HOME` temp dir): `parseMacList`/`parseWinList` on recorded outputs;
  first change writes the original rate, second doesn't overwrite it; `restore` puts it back and deletes the file;
  a leftover file is restored at startup; Bluetooth never switched; helper failure → `null`; Linux → no calls.
- `test/state.test.js`: settings line 19 read and written, unknown → HIGH.
- CI smoke test: on macOS and Windows the packaged helper runs `list` and returns at least one device.

By hand (macOS, Sony WH-1000XM5 on the headphone jack): HI-RES with a 44.1 → 96 → 44.1 kHz queue, checked in Audio MIDI
Setup; LOSSLESS with a 96 kHz file (→ 48); back to HIGH restores; quitting restores; killing the app and starting it
again restores; AirPods → not switched, Bluetooth badge. Windows switching is checked by the user on a Windows PC.
