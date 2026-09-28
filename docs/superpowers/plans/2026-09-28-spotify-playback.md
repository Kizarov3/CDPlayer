# Spotify Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play Spotify albums and playlists inside CDPlayer as a disc, through the Spotify Web Playback SDK on castLabs' Widevine Electron.

**Architecture:** The main process owns every Spotify credential and Web API call (`src/main/spotify.js`, split out of `online.js`). The renderer runs one SDK player (`SpotifySession` in `src/renderer/js/spotify-deck.js`) and gives the existing `AudioEngine` a `SpotifyTrackElement` per track that behaves like an `<audio>` element, so the transport, disc, seek bar, lyrics and karaoke keep working unchanged. CDPlayer keeps owning the order: it hands Spotify the rest of the disc so albums play gaplessly, and adopts the track Spotify moved on to.

**Tech Stack:** Electron (castLabs `v44.1.0+wvcus`), plain JS (CommonJS in main, ES modules in renderer), `node --test`, electron-builder, castLabs EVS (Python, `castlabs-evs`), Spotify Web API + Web Playback SDK.

**Spec:** `docs/superpowers/specs/2026-09-28-spotify-playback-design.md`

## Global Constraints

- Electron: `https://github.com/castlabs/electron-releases#v44.1.0+wvcus` (from `^44.4.5`).
- Every user brings their own Client ID + Secret, stored in `~/.cdplayer/spotify.txt` (line 1 Client ID, line 2 Secret, line 3 refresh token; this plan adds line 4: granted scopes, space-separated). The Java-era 3-line file must keep working.
- Redirect URI: `http://127.0.0.1:8080/callback` (unchanged).
- Scopes: `streaming user-read-email user-read-private user-library-read user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative`.
- Development-mode Web API (February 2026): playlist contents come from `GET /playlists/{id}/items` with each entry's track under `item` (fall back to `/tracks` + `track` for grandfathered apps); contents only for playlists the user owns or collaborates on; search `limit` max **10**; `linked_from` is gone from Web API track objects; `GET /me` no longer says whether the user has Premium.
- The refresh token and secret never leave the main process; the renderer only gets short-lived access tokens.
- A Spotify disc's queue never mixes with local files. Spotify discs aren't restored after a restart, and don't go into History or play counts.
- Status text is UPPERCASE, like the rest of the app. Exact strings: `SPOTIFY PREMIUM IS NEEDED TO PLAY`, `SPOTIFY PLAYBACK ISN'T SUPPORTED ON THIS SYSTEM`, `SPOTIFY SIGNED OUT · CONNECT AGAIN UNDER SPOTIFY`, `PLAYING ON ANOTHER DEVICE · PRESS PLAY TO BRING IT BACK`, `COULDN'T REACH SPOTIFY`, `COULDN'T PLAY THAT TRACK ON SPOTIFY`. Unavailable controls say `Not available for Spotify`.
- Tests set `CDPLAYER_HOME` to a temp dir; never touch the real `~/.cdplayer`.
- Commits: plain descriptive messages in the repo's style, **no** Co-Authored-By / "Generated with" lines (user rule).

## Review Focus

1. **A Java-era `spotify.txt` (3 lines, playlist scopes only)** → cover art and track-link import keep working, and the SPOTIFY panel asks to reconnect instead of failing at play time. Tested in Task 2.
2. **A followed playlist the user doesn't own** → Spotify returns no contents; the panel says `SPOTIFY ONLY SHARES THE SONGS OF PLAYLISTS YOU OWN OR COLLABORATE ON` instead of putting in an empty disc. Tested in Task 3.
3. **A relinked or regionally swapped track** (Spotify plays a different URI than requested) → it counts as the requested track: no spurious "ended", no skip. Tested in Task 5.
4. **Listening longer than an hour** → the SDK's `getOAuthToken` asks the main process for a fresh token every time rather than reusing the first one. Tested in Task 5.
5. **Another device takes over playback** (the SDK state goes null) → the player shows paused with the take-over message, and PLAY brings it back at the same position. Tested in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | castLabs Electron, electron-builder `afterPack` hook |
| `build/vmp-sign.js` (new) | electron-builder `afterPack`: VMP-sign with castLabs EVS on macOS/Windows |
| `src/main/spotify.js` (new) | Credentials, tokens, sign-in, Web API: links, library, search, disc tracks, start playback, covers |
| `src/main/online.js` | Loses its Spotify section; imports the app token from `spotify.js` for cover art |
| `src/main/main.js` | Spotify IPC handlers; Widevine readiness |
| `src/preload.js` | Spotify calls exposed to the page |
| `src/renderer/index.html` | CSP for the SDK; SPOTIFY button |
| `src/renderer/js/spotify-deck.js` (new) | SDK loader, `SpotifySession`, `SpotifyTrackElement`, `spotifyUpcoming`, `isSpotifyUri` |
| `src/renderer/js/audio.js` | Decks backed by a supplied element (no Web Audio routing) |
| `src/renderer/js/app.js` | Spotify disc: load, order, errors, volume, unavailable features |
| `src/renderer/js/panels.js` | SPOTIFY panel; unavailable rows in Settings/EQ |
| `src/renderer/styles.css` | `.unavailable` |
| `.github/workflows/build.yml` | EVS login, signing, verification |
| `README.md` | Spotify section |
| Tests: `test/spotify.test.js`, `test/spotify-deck.test.mjs`, `test/audio-element-deck.test.mjs`, `test/csp.test.js` (new) | |

---

### Task 1: castLabs Electron and VMP signing

**Files:**
- Modify: `package.json`
- Create: `build/vmp-sign.js`
- Modify: `src/main/main.js` (Widevine readiness helper)

**Interfaces:**
- Produces: `drmReady(): Promise<boolean>` in `src/main/main.js` (used by the `spotify:drmReady` handler in Task 4).

- [ ] **Step 1: Switch Electron**

In `package.json` `devDependencies`, replace `"electron": "^44.4.5"` with:

```json
"electron": "https://github.com/castlabs/electron-releases#v44.1.0+wvcus"
```

Add to `"build"` (next to `"directories"`):

```json
"electronDownload": { "mirror": "https://github.com/castlabs/electron-releases/releases/download/v" },
"afterPack": "build/vmp-sign.js",
```

Add to `"scripts"`:

```json
"postinstall": "node node_modules/electron/install.js",
"vmp-sign-dev": "python3 -m castlabs_evs.vmp sign-pkg node_modules/electron/dist"
```

(The spike showed npm skipped castLabs' own download step; `postinstall` runs it explicitly. `vmp-sign-dev` signs the dev Electron so `npm start` can play Spotify.)

- [ ] **Step 2: Install and confirm the version**

Run: `npm install && node -p "require('./node_modules/electron/package.json').version" && ls node_modules/electron/dist`
Expected: `44.1.0+wvcus`, and `Electron.app` (macOS) in `dist`.

- [ ] **Step 3: Write the afterPack hook**

Create `build/vmp-sign.js`:

```js
'use strict';
// electron-builder afterPack: VMP-signs the packaged app with castLabs EVS, which Spotify's Widevine licence requires.
// It runs before Apple's code signature, the order castLabs requires. macOS and Windows only — Linux has no VMP.
// No EVS login (a fork's pull request has no secrets) → the build carries on unsigned and just can't play Spotify.
const { execFileSync } = require('child_process');

const python = process.platform === 'win32' ? 'python' : 'python3';

exports.default = async function vmpSign(context) {
  const platform = context.electronPlatformName;
  if (platform !== 'darwin' && platform !== 'win32') return;
  // A universal Mac build packs x64 and arm64 separately, then merges them: sign only the merged app.
  if (platform === 'darwin' && /-(x64|arm64)-temp$/.test(context.appOutDir)) return;
  if (!process.env.EVS_ACCOUNT_NAME && !process.env.CDPLAYER_VMP_LOCAL) {
    console.log('  • VMP signing skipped (no EVS_ACCOUNT_NAME) — this build cannot play Spotify');
    return;
  }
  execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  execFileSync(python, ['-m', 'castlabs_evs.vmp', 'verify-pkg', context.appOutDir], { stdio: 'inherit' });
};
```

- [ ] **Step 4: Widevine readiness in main**

In `src/main/main.js`, change the first line's import to also take `components`:

```js
const { app, BrowserWindow, ipcMain, dialog, protocol, screen, shell, Menu, nativeTheme, components } = require('electron');
```

Add below the `handle` helper (line ~168):

```js
// Widevine arrives through castLabs' component updater (downloaded on first run), so it's awaited only when Spotify
// needs it — never at startup, which must work offline and in the smoke test.
function drmReady() {
  if (!components || typeof components.whenReady !== 'function') return Promise.resolve(false);
  return Promise.race([
    components.whenReady().then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 20000)),
  ]);
}
```

- [ ] **Step 5: Tests and the local packaged smoke test still pass**

Run: `npm test`
Expected: all pass.

Run: `npx electron-builder --mac --dir --publish never && dist/mac-universal/CDPlayer.app/Contents/MacOS/CDPlayer --smoke-test=test/fixtures`
Expected: the builder logs `VMP signing skipped`, and the smoke test exits 0, as before the switch.

Run: `CDPLAYER_VMP_LOCAL=1 npx electron-builder --mac --dir --publish never`
Expected: the builder logs `Signature is valid: streaming` from `verify-pkg` (needs the EVS login on this Mac, which you already have).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json build/vmp-sign.js src/main/main.js
git commit -m "castLabs Electron with Widevine, VMP-signed as it's packaged

Spotify licences its audio only to a VMP-signed Widevine build. Electron comes from castLabs (44.1.0+wvcus), and electron-builder signs the Mac and Windows apps through castLabs EVS before Apple's signature. Without an EVS login the build carries on unsigned."
```

---

### Task 2: `spotify.js` — credentials, scopes and sign-in

**Files:**
- Create: `src/main/spotify.js`
- Modify: `src/main/online.js` (remove the `// ---- Spotify ----` section, lines 418–539, and its exports)
- Modify: `src/main/main.js` (the three existing `spotify:*` handlers point at `spotify.js`)
- Test: `test/spotify.test.js`

**Interfaces:**
- Produces (CommonJS exports of `src/main/spotify.js`):
  - `SCOPES: string[]`, `REDIRECT_URI: string`
  - `credentials(): { clientId, clientSecret, refreshToken, scopes: string[] }`
  - `status(): { configured: boolean, connected: boolean, reconnectNeeded: boolean }`
  - `saveCredentials({ clientId, clientSecret }): status()`
  - `authorizeUrl(clientId, state): string`
  - `getSpotifyAppToken(): Promise<string|null>`, `getSpotifyUserToken(): Promise<string|null>`, `accessToken(): Promise<string|null>`
  - `spotifySignIn(): Promise<string>` (`'SPOTIFY CONNECTED'` or `'SPOTIFY SIGN-IN FAILED — …'`)
  - `classifySpotifyLink(text)`, `resolveSpotifyLink(text)` (moved unchanged here; the playlist branch is rewritten in Task 3)
  - `resetForTests()` — clears cached tokens

- [ ] **Step 1: Write the failing tests**

Create `test/spotify.test.js`:

```js
'use strict';
// Spotify: credentials, scopes, tokens and the Web API calls, against canned answers (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const spotify = require('../src/main/spotify');
const realFetch = global.fetch;
test.after(() => { global.fetch = realFetch; fs.rmSync(home, { recursive: true, force: true }); });

const file = path.join(home, 'spotify.txt');
const write = (lines) => fs.writeFileSync(file, lines.join('\n') + '\n');
const ALL = spotify.SCOPES.join(' ');
// Answers keyed by URL prefix; records every request.
let requests = [];
function answer(routes) {
  requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const key = Object.keys(routes).find((k) => String(url).startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const r = typeof routes[key] === 'function' ? routes[key](String(url), init) : routes[key];
    return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body };
  };
}
test.beforeEach(() => { spotify.resetForTests(); try { fs.unlinkSync(file); } catch { /* none yet */ } });

test('status: nothing saved, credentials only, connected, and a Java-era token without the playback scopes', () => {
  assert.deepStrictEqual(spotify.status(), { configured: false, connected: false, reconnectNeeded: false });
  write(['id', 'secret']);
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: false, reconnectNeeded: false });
  write(['id', 'secret', 'refresh', ALL]);
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: true, reconnectNeeded: false });
  write(['id', 'secret', 'refresh']); // the Java version's file: a token for reading playlists only
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: true, reconnectNeeded: true });
});

test('saving credentials keeps the sign-in for the same app, and drops it for another', () => {
  write(['id', 'secret', 'refresh', ALL]);
  spotify.saveCredentials({ clientId: ' id ', clientSecret: 'new-secret' });
  assert.deepStrictEqual(spotify.credentials(), { clientId: 'id', clientSecret: 'new-secret', refreshToken: 'refresh', scopes: spotify.SCOPES });
  const s = spotify.saveCredentials({ clientId: 'other', clientSecret: 'x' });
  assert.deepStrictEqual(s, { configured: true, connected: false, reconnectNeeded: false });
  assert.strictEqual(spotify.credentials().refreshToken, '');
});

test('the sign-in page asks for every scope playback needs, on the loopback redirect', () => {
  const u = new URL(spotify.authorizeUrl('abc', 'st8'));
  assert.strictEqual(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.strictEqual(u.searchParams.get('client_id'), 'abc');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:8080/callback');
  assert.strictEqual(u.searchParams.get('state'), 'st8');
  assert.deepStrictEqual(u.searchParams.get('scope').split(' ').sort(), [...spotify.SCOPES].sort());
  for (const s of ['streaming', 'user-read-email', 'user-read-private', 'user-library-read', 'user-modify-playback-state']) assert.ok(spotify.SCOPES.includes(s), s);
});

test('user token: refreshed with the app credentials, cached, and a rotated refresh token is kept', async () => {
  write(['id', 'secret', 'refresh', ALL]);
  answer({ 'https://accounts.spotify.com/api/token': { body: { access_token: 'user-1', expires_in: 3600, refresh_token: 'refresh-2' } } });
  assert.strictEqual(await spotify.accessToken(), 'user-1');
  assert.strictEqual(await spotify.accessToken(), 'user-1');
  assert.strictEqual(requests.length, 1);
  assert.match(requests[0].init.headers.Authorization, /^Basic /);
  assert.match(String(requests[0].init.body), /grant_type=refresh_token&refresh_token=refresh/);
  assert.strictEqual(spotify.credentials().refreshToken, 'refresh-2');
  assert.deepStrictEqual(spotify.credentials().scopes, spotify.SCOPES); // rotating the token keeps the scopes line
});

test('no sign-in → no access token; a Java-era file still gives the app token for cover art', async () => {
  write(['id', 'secret']);
  assert.strictEqual(await spotify.accessToken(), null);
  answer({ 'https://accounts.spotify.com/api/token': { body: { access_token: 'app-1', expires_in: 3600 } } });
  write(['id', 'secret', 'refresh']);
  assert.strictEqual(await spotify.getSpotifyAppToken(), 'app-1');
});

test('a track link still resolves with only the app token', async () => {
  write(['id', 'secret', 'refresh']);
  answer({
    'https://accounts.spotify.com/api/token': { body: { access_token: 'app-1', expires_in: 3600 } },
    'https://api.spotify.com/v1/tracks/abc': { body: { name: 'Airbag', artists: [{ name: 'Radiohead' }] } },
  });
  assert.deepStrictEqual(await spotify.resolveSpotifyLink('https://open.spotify.com/track/abc?si=x'), { tracks: [{ title: 'Airbag', artist: 'Radiohead' }] });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/spotify.test.js`
Expected: FAIL — `Cannot find module '../src/main/spotify'`.

- [ ] **Step 3: Create `src/main/spotify.js`**

Move the Spotify section out of `online.js` into this file and extend it:

```js
'use strict';
/**
 * Spotify: the user's own developer app (Client ID + Secret), the browser sign-in, tokens, and every Web API call —
 * for cover art and link import (online.js) and for playing Spotify discs (the SPOTIFY panel). Tokens stay here in
 * the main process; the page only ever gets a short-lived access token for the Web Playback SDK.
 *
 * spotify.txt: line 1 Client ID, line 2 Client Secret, line 3 the refresh token from "Connect Spotify", line 4 the
 * scopes it was granted. The Java version wrote the first three; a token without line 4 predates playback.
 */
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const store = require('./store');

const REDIRECT_URI = 'http://127.0.0.1:8080/callback';
const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-library-read', 'user-modify-playback-state',
  'user-read-playback-state', 'playlist-read-private', 'playlist-read-collaborative'];
const USER_AGENT = 'CDPlayer/2.0';
const TIMEOUT_MS = 8000;
const tokens = { app: null, appExpiry: 0, user: null, userExpiry: 0 };

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
  return res.status === 204 ? null : res.json();
}

function credentials() {
  const l = (store.readText(store.FILES.spotify) || '').split(/\r?\n/).map((s) => s.trim());
  return { clientId: l[0] || '', clientSecret: l[1] || '', refreshToken: l[2] || '', scopes: (l[3] || '').split(/\s+/).filter(Boolean) };
}
function writeCredentials(c) {
  store.writeText(store.FILES.spotify, `${c.clientId}\n${c.clientSecret}\n${c.refreshToken}\n${c.scopes.join(' ')}\n`);
}
function status() {
  const c = credentials();
  const connected = !!c.refreshToken;
  return { configured: !!(c.clientId && c.clientSecret), connected, reconnectNeeded: connected && !SCOPES.every((s) => c.scopes.includes(s)) };
}
/** The Client ID and Secret from the SPOTIFY panel. A different app's sign-in isn't valid for this one: dropped. */
function saveCredentials({ clientId, clientSecret }) {
  const old = credentials(), id = String(clientId || '').trim(), secret = String(clientSecret || '').trim();
  const same = id === old.clientId;
  writeCredentials({ clientId: id, clientSecret: secret, refreshToken: same ? old.refreshToken : '', scopes: same ? old.scopes : [] });
  resetForTests();
  return status();
}
function resetForTests() { Object.assign(tokens, { app: null, appExpiry: 0, user: null, userExpiry: 0 }); }

async function postToken(body) {
  const { clientId, clientSecret } = credentials();
  return fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}
const expiry = (json) => Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000;
async function getSpotifyAppToken() {
  const { clientId, clientSecret } = credentials();
  if (!clientId || !clientSecret) return null;
  if (tokens.app && Date.now() < tokens.appExpiry) return tokens.app;
  const json = await postToken('grant_type=client_credentials');
  if (!json || !json.access_token) return null;
  tokens.app = json.access_token; tokens.appExpiry = expiry(json);
  return tokens.app;
}
async function getSpotifyUserToken() {
  if (tokens.user && Date.now() < tokens.userExpiry) return tokens.user;
  const c = credentials();
  if (!c.refreshToken) return null;
  const json = await postToken(`grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refreshToken)}`);
  if (!json || !json.access_token) return null;
  tokens.user = json.access_token; tokens.userExpiry = expiry(json);
  if (json.refresh_token) writeCredentials({ ...credentials(), refreshToken: json.refresh_token }); // Spotify sometimes rotates it
  return tokens.user;
}
/** For the Web Playback SDK's getOAuthToken: asked afresh each time, so a long session gets refreshed tokens. */
async function accessToken() {
  try { return await getSpotifyUserToken(); } catch { return null; }
}
function forgetUserToken() { tokens.user = null; tokens.userExpiry = 0; }

// ---- Links (SEARCH's paste-a-link import) -------------------------------------------------------------------------

const TRACK_URL = /open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]+)|spotify:track:([a-zA-Z0-9]+)/;
const PLAYLIST_URL = /open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([a-zA-Z0-9]+)|spotify:playlist:([a-zA-Z0-9]+)/;
function classifySpotifyLink(text) {
  let m = TRACK_URL.exec(text);
  if (m) return { kind: 'track', id: m[1] || m[2] };
  m = PLAYLIST_URL.exec(text);
  if (m) return { kind: 'playlist', id: m[1] || m[2] };
  return null;
}
```

Then paste `resolveSpotifyLink` and `spotifySignIn` from `online.js` **unchanged** except:
- `spotifyCredentials()` → `credentials()`; `spotify.userToken`/`spotify.userExpiry` → `tokens.user`/`tokens.userExpiry`; `SPOTIFY_REDIRECT_URI` → `REDIRECT_URI`.
- In `spotifySignIn`, replace the inline `const auth = …` with `const auth = authorizeUrl(clientId, state);`.
- Replace `saveRefreshToken(json.refresh_token);` with:

```js
      const granted = String(json.scope || SCOPES.join(' ')).split(/\s+/).filter(Boolean);
      writeCredentials({ ...credentials(), refreshToken: json.refresh_token, scopes: granted });
```

Add `authorizeUrl` and the exports:

```js
function authorizeUrl(clientId, state) {
  return `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}`
    + `&scope=${encodeURIComponent(SCOPES.join(' '))}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
}

module.exports = {
  SCOPES, REDIRECT_URI, credentials, status, saveCredentials, authorizeUrl, resetForTests,
  getSpotifyAppToken, getSpotifyUserToken, accessToken, forgetUserToken, fetchJson,
  classifySpotifyLink, resolveSpotifyLink, spotifySignIn,
};
```

- [ ] **Step 4: Point `online.js` and `main.js` at it**

In `src/main/online.js`: delete lines 418–539 (the whole `// ---- Spotify ----` section), delete `const http = require('http');` and `const crypto = require('crypto');` if nothing else in the file uses them (check with `grep -n "http\.\|crypto\." src/main/online.js`), add `const { getSpotifyAppToken } = require('./spotify');` beside the other requires, and remove `resolveSpotifyLink, spotifySignIn, classifySpotifyLink` from `module.exports`. Update the header comment's "and Spotify link/playlist resolution with the one-time browser sign-in" to "(Spotify's own calls live in spotify.js)".

In `src/main/main.js`: add `const spotify = require('./spotify');` beside `const online = require('./online');`, and change the three handlers:

```js
handle('spotify:classify', (text) => spotify.classifySpotifyLink(text));
handle('spotify:resolve', async (text) => {
  try { return await spotify.resolveSpotifyLink(text); } catch (e) { return { error: (e.message || 'LOOKUP FAILED').toUpperCase() }; }
});
handle('spotify:signIn', () => spotify.spotifySignIn());
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/spotify.test.js && npm test`
Expected: PASS, including the existing cover tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/spotify.js src/main/online.js src/main/main.js test/spotify.test.js
git commit -m "Spotify's sign-in and tokens in their own module, asking for the playback scopes

spotify.txt gains a fourth line, the scopes the token was granted, so a Java-era sign-in (playlists only) is known to need reconnecting before it can play. The Client ID and Secret can be saved from the app."
```

---

### Task 3: `spotify.js` — library, search, disc tracks, playback start, covers

**Files:**
- Modify: `src/main/spotify.js`
- Test: `test/spotify.test.js`

**Interfaces:**
- Consumes: `credentials`, `getSpotifyUserToken`, `forgetUserToken`, `fetchJson` (Task 2).
- Produces:
  - Collection item: `{ kind: 'album'|'playlist', id: string, name: string, owner: string, total: number }`
  - Disc track: `{ uri: string, title: string, artist: string, album: string, durationMs: number, cover: string|null }`
  - `savedAlbums(offset = 0): Promise<{ items, next: number|null } | { error }>`
  - `playlists(offset = 0): Promise<{ items, next: number|null } | { error }>`
  - `search(query): Promise<{ items } | { error }>`
  - `discTracks({ kind, id }): Promise<{ tracks: DiscTrack[] } | { error }>`
  - `startPlayback({ deviceId, uris, positionMs }): Promise<{ ok: boolean, status: number }>`
  - `coverDataUrl(url): Promise<string|null>`
  - Error codes: `'SIGN_IN'` (no or refused token), `'OFFLINE'`, `'NOT_SHARED'` (playlist contents withheld), `'EMPTY'`, or `'HTTP <n>'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/spotify.test.js`:

```js
const connected = () => write(['id', 'secret', 'refresh', ALL]);
const TOKEN = { 'https://accounts.spotify.com/api/token': { body: { access_token: 'user-1', expires_in: 3600 } } };
const img = (w, url) => ({ width: w, height: w, url });

test('saved albums page through 50 at a time as collection items', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/albums': { body: {
    items: [{ album: { id: 'a1', name: 'OK Computer', artists: [{ name: 'Radiohead' }], total_tracks: 12 } }],
    next: 'https://api.spotify.com/v1/me/albums?offset=50&limit=50',
  } } });
  assert.deepStrictEqual(await spotify.savedAlbums(0), { items: [{ kind: 'album', id: 'a1', name: 'OK Computer', owner: 'Radiohead', total: 12 }], next: 50 });
  assert.match(requests[1].url, /\/me\/albums\?limit=50&offset=0/);
  assert.strictEqual(requests[1].init.headers.Authorization, 'Bearer user-1');
});

test('playlists: the old and the renamed track count both read', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/playlists': { body: {
    items: [{ id: 'p1', name: 'Road', owner: { display_name: 'me' }, items: { total: 3 } }, { id: 'p2', name: 'Old', owner: { id: 'u2' }, tracks: { total: 5 } }],
    next: null,
  } } });
  assert.deepStrictEqual(await spotify.playlists(0), { items: [
    { kind: 'playlist', id: 'p1', name: 'Road', owner: 'me', total: 3 },
    { kind: 'playlist', id: 'p2', name: 'Old', owner: 'u2', total: 5 },
  ], next: null });
});

test('search asks for at most 10 albums and playlists (the development-mode limit)', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/search': { body: {
    albums: { items: [{ id: 'a1', name: 'Kid A', artists: [{ name: 'Radiohead' }], total_tracks: 10 }] },
    playlists: { items: [null, { id: 'p1', name: 'Kid A deep cuts', owner: { display_name: 'x' }, items: { total: 4 } }] },
  } } });
  const r = await spotify.search('kid a');
  assert.deepStrictEqual(r.items.map((i) => `${i.kind}:${i.id}`), ['album:a1', 'playlist:p1']);
  const u = new URL(requests[1].url);
  assert.strictEqual(u.searchParams.get('q'), 'kid a');
  assert.strictEqual(u.searchParams.get('type'), 'album,playlist');
  assert.strictEqual(u.searchParams.get('limit'), '10');
});

test('an album becomes disc tracks, with its biggest cover, across pages of tracks', async () => {
  connected();
  answer({ ...TOKEN,
    'https://api.spotify.com/v1/albums/a1/tracks': { body: { items: [{ uri: 'spotify:track:t3', name: 'Three', duration_ms: 3000, artists: [{ name: 'B' }] }], next: null } },
    'https://api.spotify.com/v1/albums/a1': { body: {
      name: 'Alb', artists: [{ name: 'A' }], images: [img(64, 's'), img(640, 'L'), img(300, 'm')],
      tracks: { items: [{ uri: 'spotify:track:t1', name: 'One', duration_ms: 1000, artists: [{ name: 'A' }] }, { uri: 'spotify:track:t2', name: 'Two', duration_ms: 2000, artists: [] }],
        next: 'https://api.spotify.com/v1/albums/a1/tracks?offset=2&limit=50' },
    } },
  });
  const r = await spotify.discTracks({ kind: 'album', id: 'a1' });
  assert.deepStrictEqual(r.tracks, [
    { uri: 'spotify:track:t1', title: 'One', artist: 'A', album: 'Alb', durationMs: 1000, cover: 'L' },
    { uri: 'spotify:track:t2', title: 'Two', artist: 'A', album: 'Alb', durationMs: 2000, cover: 'L' },
    { uri: 'spotify:track:t3', title: 'Three', artist: 'B', album: 'Alb', durationMs: 3000, cover: 'L' },
  ]);
});

test('a playlist becomes disc tracks from /items, skipping episodes, local files and gaps', async () => {
  connected();
  const track = (id, name) => ({ type: 'track', uri: `spotify:track:${id}`, name, duration_ms: 1, artists: [{ name: 'Ar' }], album: { name: 'Al', images: [img(640, `c-${id}`)] } });
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/items': { body: { items: [
    { item: track('t1', 'One') }, { item: null }, { item: { type: 'episode', uri: 'spotify:episode:e' } },
    { is_local: true, item: { type: 'track', uri: 'spotify:local:x', name: 'Local' } }, { track: track('t2', 'Two') },
  ], next: null } } });
  const r = await spotify.discTracks({ kind: 'playlist', id: 'p1' });
  assert.deepStrictEqual(r.tracks.map((t) => [t.uri, t.title, t.cover]), [['spotify:track:t1', 'One', 'c-t1'], ['spotify:track:t2', 'Two', 'c-t2']]);
});

test('a grandfathered app: /items is missing, so /tracks is read instead', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/tracks': { body: { items: [{ track: { type: 'track', uri: 'spotify:track:t1', name: 'One', duration_ms: 1, artists: [], album: { name: 'Al', images: [] } } }], next: null } } });
  assert.deepStrictEqual((await spotify.discTracks({ kind: 'playlist', id: 'p1' })).tracks.map((t) => t.uri), ['spotify:track:t1']);
});

test("a followed playlist: Spotify withholds its songs, and that's said rather than an empty disc", async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/items': { body: { items: [], next: null } } });
  assert.deepStrictEqual(await spotify.discTracks({ kind: 'playlist', id: 'p1' }), { error: 'NOT_SHARED' });
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/items': { status: 403, body: {} } });
  assert.deepStrictEqual(await spotify.discTracks({ kind: 'playlist', id: 'p1' }), { error: 'NOT_SHARED' });
});

test('not signed in, a refused token, and no network each come back as an error code', async () => {
  write(['id', 'secret']);
  assert.deepStrictEqual(await spotify.savedAlbums(0), { error: 'SIGN_IN' });
  connected();
  let calls = 0;
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/albums': () => { calls++; return { status: 401, body: {} }; } });
  assert.deepStrictEqual(await spotify.savedAlbums(0), { error: 'SIGN_IN' });
  assert.strictEqual(calls, 2); // refreshed once and tried again
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  spotify.resetForTests();
  assert.deepStrictEqual(await spotify.savedAlbums(0), { error: 'OFFLINE' });
});

test('starting playback: the whole list to the SDK device, at the position', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/player/play': { status: 204 } });
  assert.deepStrictEqual(await spotify.startPlayback({ deviceId: 'dev 1', uris: ['spotify:track:a', 'spotify:track:b'], positionMs: 1234 }), { ok: true, status: 204 });
  const req = requests[1];
  assert.strictEqual(req.url, 'https://api.spotify.com/v1/me/player/play?device_id=dev%201');
  assert.strictEqual(req.init.method, 'PUT');
  assert.deepStrictEqual(JSON.parse(req.init.body), { uris: ['spotify:track:a', 'spotify:track:b'], position_ms: 1234 });
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/player/play': { status: 403, body: { error: { reason: 'PREMIUM_REQUIRED' } } } });
  assert.deepStrictEqual(await spotify.startPlayback({ deviceId: 'd', uris: ['spotify:track:a'], positionMs: 0 }), { ok: false, status: 403 });
});

test('covers are only fetched from Spotify’s image host', async () => {
  let fetched = false;
  global.fetch = async () => { fetched = true; return { ok: false }; };
  assert.strictEqual(await spotify.coverDataUrl('https://evil.example/x.jpg'), null);
  assert.strictEqual(fetched, false);
});

test('SEARCH’s playlist-link import reads the same /items contents', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/items': { body: { items: [{ item: { type: 'track', uri: 'spotify:track:t1', name: 'One', duration_ms: 1, artists: [{ name: 'Ar' }], album: { name: 'Al', images: [] } } }], next: null } } });
  assert.deepStrictEqual(await spotify.resolveSpotifyLink('https://open.spotify.com/playlist/p1'), { tracks: [{ title: 'One', artist: 'Ar' }] });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/spotify.test.js`
Expected: FAIL — `spotify.savedAlbums is not a function` (and the others).

- [ ] **Step 3: Implement**

Add to `src/main/spotify.js`, above `authorizeUrl`:

```js
// ---- The user's library (the SPOTIFY panel) ----------------------------------------------------------------------

const API = 'https://api.spotify.com/v1';
class SpotifyError extends Error { constructor(code) { super(code); this.code = code; } }
/** A Web API call as the signed-in user: refreshed once on a 401, then 'SIGN_IN'; no network → 'OFFLINE'. */
async function userApi(pathAndQuery, init = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let token;
    try { token = await getSpotifyUserToken(); } catch (e) { throw new SpotifyError(e.status ? 'SIGN_IN' : 'OFFLINE'); }
    if (!token) throw new SpotifyError('SIGN_IN');
    try {
      return await fetchJson(pathAndQuery.startsWith('http') ? pathAndQuery : `${API}${pathAndQuery}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    } catch (e) {
      if (e.status === 401 && attempt === 0) { forgetUserToken(); continue; }
      if (e.status === 401) throw new SpotifyError('SIGN_IN');
      if (!e.status) throw new SpotifyError('OFFLINE');
      throw e;
    }
  }
  throw new SpotifyError('SIGN_IN');
}
const asError = (e) => ({ error: e.code || (e.status ? `HTTP ${e.status}` : 'OFFLINE') });
const nextOffset = (json) => { if (!json.next) return null; const n = Number(new URL(json.next).searchParams.get('offset')); return Number.isFinite(n) ? n : null; };
const artistNames = (a) => (a || []).map((x) => x.name).filter(Boolean).join(', ');
const biggest = (images) => { const list = (images || []).filter((i) => i && i.url); list.sort((a, b) => (b.width || 0) - (a.width || 0)); return list.length ? list[0].url : null; };
const albumItem = (a) => ({ kind: 'album', id: a.id, name: a.name, owner: artistNames(a.artists), total: a.total_tracks || 0 });
const playlistItem = (p) => ({ kind: 'playlist', id: p.id, name: p.name, owner: (p.owner && (p.owner.display_name || p.owner.id)) || '', total: ((p.items || p.tracks) || {}).total || 0 });

async function savedAlbums(offset = 0) {
  try {
    const json = await userApi(`/me/albums?limit=50&offset=${offset}`);
    return { items: (json.items || []).filter((i) => i && i.album).map((i) => albumItem(i.album)), next: nextOffset(json) };
  } catch (e) { return asError(e); }
}
async function playlists(offset = 0) {
  try {
    const json = await userApi(`/me/playlists?limit=50&offset=${offset}`);
    return { items: (json.items || []).filter(Boolean).map(playlistItem), next: nextOffset(json) };
  } catch (e) { return asError(e); }
}
async function search(query) {
  try {
    const json = await userApi(`/search?q=${encodeURIComponent(query)}&type=album,playlist&limit=10`);
    return { items: [...((json.albums || {}).items || []).filter(Boolean).map(albumItem), ...((json.playlists || {}).items || []).filter(Boolean).map(playlistItem)] };
  } catch (e) { return asError(e); }
}

const discTrack = (t, album) => ({
  uri: t.uri, title: t.name, artist: artistNames(t.artists) || album.artist, album: album.name,
  durationMs: t.duration_ms || 0, cover: album.cover,
});
async function albumTracks(id) {
  const a = await userApi(`/albums/${encodeURIComponent(id)}`);
  const album = { name: a.name, artist: artistNames(a.artists), cover: biggest(a.images) };
  const tracks = ((a.tracks || {}).items || []).map((t) => discTrack(t, album));
  let url = (a.tracks || {}).next;
  for (let pages = 0; url && pages < 20; pages++) {
    const page = await userApi(url);
    tracks.push(...(page.items || []).map((t) => discTrack(t, album)));
    url = page.next;
  }
  return tracks;
}
async function playlistTracks(id) {
  // February 2026: /items with each song under `item`; apps from before keep /tracks with `track`.
  let url = `/playlists/${encodeURIComponent(id)}/items?limit=50`;
  try { await userApi(url.replace('limit=50', 'limit=1')); } catch (e) { if (e.status === 404) url = `/playlists/${encodeURIComponent(id)}/tracks?limit=50`; else throw e; }
  const tracks = [];
  for (let pages = 0; url && pages < 40; pages++) {
    const page = await userApi(url);
    for (const entry of page.items || []) {
      const t = entry && (entry.item || entry.track);
      if (!t || entry.is_local || t.is_local || (t.type && t.type !== 'track') || !/^spotify:track:/.test(t.uri || '')) continue;
      const album = { name: (t.album || {}).name || '', artist: '', cover: biggest((t.album || {}).images) };
      tracks.push(discTrack(t, album));
    }
    url = page.next;
  }
  return tracks;
}
/** An album's or playlist's songs, as a disc. A playlist the user only follows comes back empty: 'NOT_SHARED'. */
async function discTracks({ kind, id }) {
  try {
    const tracks = kind === 'album' ? await albumTracks(id) : await playlistTracks(id);
    if (!tracks.length) return { error: kind === 'playlist' ? 'NOT_SHARED' : 'EMPTY' };
    return { tracks };
  } catch (e) {
    if (kind === 'playlist' && (e.status === 403 || e.status === 404)) return { error: 'NOT_SHARED' };
    return asError(e);
  }
}

/** Plays `uris` in order on the SDK's device from `positionMs` into the first. Spotify answers 403 without Premium. */
async function startPlayback({ deviceId, uris, positionMs }) {
  try {
    await userApi(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uris, position_ms: Math.max(0, Math.round(positionMs || 0)) }),
    });
    return { ok: true, status: 204 };
  } catch (e) {
    return { ok: false, status: e.status || (e.code === 'SIGN_IN' ? 401 : 0) };
  }
}

/** A cover from Spotify's image host as a data URL (the page reads its pixels for the AUTO theme). */
async function coverDataUrl(url) {
  if (!/^https:\/\/i\.scdn\.co\/image\//.test(String(url))) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch { return null; }
}
```

Note `fetchJson` returns `null` for a 204; the test answers `startPlayback` with status 204 and no body, which `fetchJson` handles by that check.

Replace the playlist branch of `resolveSpotifyLink` (everything after the `if (link.kind === 'track') { … }` block) with:

```js
  const r = await discTracks({ kind: 'playlist', id: link.id });
  if (r.error === 'SIGN_IN') return { needsSignIn: true };
  if (r.error === 'NOT_SHARED') return { tracks: [] };
  if (r.error) return { error: r.error };
  return { tracks: r.tracks.map((t) => ({ title: t.title, artist: (t.artist || '').split(', ')[0] })) };
```

Add the new names to `module.exports`: `savedAlbums, playlists, search, discTracks, startPlayback, coverDataUrl`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/spotify.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/spotify.js test/spotify.test.js
git commit -m "Spotify library, search and disc tracks, read the February 2026 way

Saved albums and playlists page through 50 at a time, search asks for ten, and an album or playlist becomes a disc's tracks. Playlists read /items (falling back to /tracks for older apps), and a followed playlist whose songs Spotify withholds says so."
```

---

### Task 4: IPC, preload, CSP — and the checkpoint: does the SDK play from `cdp://app/`?

**Files:**
- Modify: `src/main/main.js`, `src/preload.js`, `src/renderer/index.html`
- Create: `src/renderer/js/spotify-deck.js` (just `loadSpotifySdk` for now)
- Test: `test/csp.test.js`

**Interfaces:**
- Consumes: Task 1 `drmReady()`, Task 3 functions.
- Produces (on `window.cdp`): `spotifyStatus()`, `saveSpotifyCredentials({clientId, clientSecret})`, `spotifySignIn()` (existing), `spotifyAccessToken()`, `spotifyAlbums(offset)`, `spotifyPlaylists(offset)`, `spotifySearch(query)`, `spotifyDiscTracks({kind, id})`, `spotifyPlay({deviceId, uris, positionMs})`, `spotifyCover(url)`, `spotifyDrmReady()`, `openSpotifyDashboard()`.
- Produces: `loadSpotifySdk(doc = document, win = window): Promise<typeof Spotify.Player>` in `spotify-deck.js`.

- [ ] **Step 1: Write the failing CSP test**

Create `test/csp.test.js`:

```js
'use strict';
// The page's Content-Security-Policy lets in Spotify's player script and frame, and nothing wider.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

test("the Web Playback SDK's script and frame are allowed", () => {
  assert.deepStrictEqual(directives['script-src'], ["'self'", 'https://sdk.scdn.co']);
  assert.deepStrictEqual(directives['frame-src'], ['https://sdk.scdn.co']);
});
test('nothing broader: no wildcards, no inline script, connections stay local', () => {
  assert.ok(!csp.includes('*'), csp);
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
  assert.deepStrictEqual(directives['connect-src'], ["'self'"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/csp.test.js`
Expected: FAIL on `script-src` (currently `'self'` only) and missing `frame-src`.

- [ ] **Step 3: CSP**

In `src/renderer/index.html` line 5, change `script-src 'self'; connect-src 'self'` to:

```
script-src 'self' https://sdk.scdn.co; frame-src https://sdk.scdn.co; connect-src 'self'
```

Run: `node --test test/csp.test.js` — Expected: PASS.

- [ ] **Step 4: IPC handlers**

In `src/main/main.js`, below the three `spotify:*` handlers:

```js
handle('spotify:status', () => spotify.status());
handle('spotify:saveCredentials', (c) => spotify.saveCredentials(c));
handle('spotify:accessToken', () => spotify.accessToken());
handle('spotify:albums', (offset) => spotify.savedAlbums(offset));
handle('spotify:playlists', (offset) => spotify.playlists(offset));
handle('spotify:search', (query) => spotify.search(query));
handle('spotify:discTracks', (which) => spotify.discTracks(which));
handle('spotify:play', (request) => spotify.startPlayback(request));
handle('spotify:cover', (url) => spotify.coverDataUrl(url));
handle('spotify:drmReady', () => drmReady());
handle('spotify:openDashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));
```

In `src/preload.js`, after `spotifySignIn: invoke('spotify:signIn'),`:

```js
  spotifyStatus: invoke('spotify:status'),
  saveSpotifyCredentials: invoke('spotify:saveCredentials'),
  spotifyAccessToken: invoke('spotify:accessToken'),
  spotifyAlbums: invoke('spotify:albums'),
  spotifyPlaylists: invoke('spotify:playlists'),
  spotifySearch: invoke('spotify:search'),
  spotifyDiscTracks: invoke('spotify:discTracks'),
  spotifyPlay: invoke('spotify:play'),
  spotifyCover: invoke('spotify:cover'),
  spotifyDrmReady: invoke('spotify:drmReady'),
  openSpotifyDashboard: invoke('spotify:openDashboard'),
```

- [ ] **Step 5: The SDK loader**

Create `src/renderer/js/spotify-deck.js`:

```js
// Spotify discs: the Web Playback SDK's one player for the app (SpotifySession), and a stand-in <audio> element per
// track (SpotifyTrackElement) that AudioEngine drives as a deck — so the transport, the disc, the seek bar, lyrics
// and karaoke don't need to know the sound comes from Spotify. The SDK plays through Widevine, outside Web Audio:
// no EQ, mono, crossfade or visualizer for it.

let sdk = null;
/** Loads Spotify's player script once, on first use (never at startup — the player must work offline). */
export function loadSpotifySdk(doc = document, win = window) {
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    if (win.Spotify && win.Spotify.Player) { resolve(win.Spotify.Player); return; }
    win.onSpotifyWebPlaybackSDKReady = () => resolve(win.Spotify.Player);
    const script = doc.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => { sdk = null; script.remove(); reject(new Error('sdk')); };
    doc.head.append(script);
  });
  return sdk;
}
```

- [ ] **Step 6: CHECKPOINT with the user — the SDK from `cdp://app/`**

This needs the user: their Spotify developer app must have the redirect URI `http://127.0.0.1:8080/callback`, and they sign in. Stop and ask them to be ready before running it.

Sign the dev Electron: `npm run vmp-sign-dev`. The credentials panel comes in Task 8, so check whether `~/.cdplayer/spotify.txt` already holds the user's Client ID and Secret on its first two lines (the Java version may have written it — look, don't overwrite). If it doesn't, ask the user to write those two lines into it themselves, so the secret never passes through the conversation.

Temporarily add to the end of `start()` in `src/renderer/js/app.js` (removed in Step 7):

```js
  window.spotifyProbe = async () => {
    console.log('drm', await cdp.spotifyDrmReady());
    if (!(await cdp.spotifyStatus()).connected || (await cdp.spotifyStatus()).reconnectNeeded) console.log(await cdp.spotifySignIn());
    const { loadSpotifySdk } = await import('./spotify-deck.js');
    const Player = await loadSpotifySdk();
    const player = new Player({ name: 'CDPlayer probe', getOAuthToken: (cb) => cdp.spotifyAccessToken().then(cb), volume: 0.5 });
    for (const e of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) player.addListener(e, (x) => console.log(e, x && x.message));
    player.addListener('player_state_changed', (s) => s && console.log('state', s.track_window.current_track.name, s.position, s.paused));
    player.addListener('ready', async ({ device_id }) => console.log('play', await cdp.spotifyPlay({ deviceId: device_id, uris: ['spotify:track:6anwyDGQmsg45JSaYdG2SE'], positionMs: 0 })));
    console.log('connect', await player.connect());
  };
```

Run: `npm start`, open DevTools (View → Toggle Developer Tools), run `spotifyProbe()` in the console, let the user sign in in the browser, and watch for 60 s.

Expected: `drm true`, `connect true`, `play {ok: true, status: 204}`, `state Airbag … false` with the position climbing past 30000, the user hears it, no `playback_error`, and **no CSP violations** in the console.

- If CSP violations appear: add exactly the reported host to the reported directive in `index.html` and to `test/csp.test.js`'s expected list, rerun.
- If the SDK refuses the `cdp://` origin (`initialization_error`, or EME errors): **stop and tell the user**. The fallback from the spec is a hidden `BrowserWindow` on a local `http://127.0.0.1` page driven over IPC; that changes Task 5's `startPlayback`/`Player` wiring and needs its own plan amendment.

- [ ] **Step 7: Remove the probe and commit**

Delete the `window.spotifyProbe` block from `app.js`.

```bash
git add src/main/main.js src/preload.js src/renderer/index.html src/renderer/js/spotify-deck.js test/csp.test.js
git commit -m "Spotify calls for the page, and the player script let in

The page gets the account's state, its albums and playlists, a disc's tracks and a way to start playback, all through the main process. The Content-Security-Policy lets in Spotify's player script and frame, and nothing wider. Checked: the Web Playback SDK plays from the app's own page."
```

---

### Task 5: `SpotifySession` and `SpotifyTrackElement`

**Files:**
- Modify: `src/renderer/js/spotify-deck.js`
- Test: `test/spotify-deck.test.mjs`

**Interfaces:**
- Consumes: `window.cdp.spotifyAccessToken`, `window.cdp.spotifyPlay` (injected, so tests pass fakes).
- Produces:
  - `isSpotifyUri(p): boolean`
  - `spotifyUpcoming(queue: string[], index: number, { shuffle, repeat }): string[]`
  - `class SpotifySession({ loadPlayer, getToken, startPlayback, now?, wait?, volume?, name? })` with `connect(): Promise<{ok, reason?}>`, `play(uri, positionMs, upcoming): Promise<boolean>`, `resume()`, `pause()`, `seek(ms)`, `setVolume(v)`, `resync(upcoming)`, `tick()`, `position(): number` (ms), `get paused`, `currentUri`, `lost`, `on(fn): () => void`. Events: `{type:'trackchange', from, to}`, `{type:'finished', uri}`, `{type:'lost', uri}`, `{type:'error', reason: 'premium'|'unsupported'|'auth'|'offline'|'playback'}`.
  - `class SpotifyTrackElement(session, uri, durationMs, upcoming: () => string[])` with the `<audio>` surface `AudioEngine` uses: `paused`, `ended`, `currentTime` (get/set, seconds), `duration` (seconds), `play()`, `pause()`, `addEventListener`/`removeEventListener` (`'loadedmetadata'`, `'ended'`, `'error'`), `removeAttribute()`, `load()`.

- [ ] **Step 1: Write the failing tests**

Create `test/spotify-deck.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { SpotifySession, SpotifyTrackElement, spotifyUpcoming, isSpotifyUri } from '../src/renderer/js/spotify-deck.js';

const A = 'spotify:track:A', B = 'spotify:track:B', C = 'spotify:track:C';
class FakePlayer {
  constructor(opts) { this.opts = opts; this.handlers = {}; this.calls = []; FakePlayer.last = this; }
  addListener(ev, fn) { this.handlers[ev] = fn; }
  connect() { setTimeout(() => this.handlers.ready({ device_id: 'dev1' }), 0); return Promise.resolve(true); }
  pause() { this.calls.push(['pause']); return Promise.resolve(); }
  resume() { this.calls.push(['resume']); return Promise.resolve(); }
  seek(ms) { this.calls.push(['seek', ms]); return Promise.resolve(); }
  setVolume(v) { this.calls.push(['volume', v]); return Promise.resolve(); }
  emit(ev, arg) { this.handlers[ev](arg); }
}
const st = (uri, position, { paused = false, duration = 200000, linked = null } = {}) =>
  ({ paused, position, duration, track_window: { current_track: { uri, linked_from: { uri: linked } } } });
function setup({ responses = [] } = {}) {
  const clock = { t: 1000 };
  const plays = [];
  const tokens = ['tok-1', 'tok-2'];
  const session = new SpotifySession({
    loadPlayer: async () => FakePlayer,
    getToken: async () => tokens.shift(),
    startPlayback: async (req) => { plays.push(req); return responses.shift() || { ok: true, status: 204 }; },
    now: () => clock.t,
    wait: async () => {},
  });
  const events = [];
  session.on((e) => events.push(e));
  return { session, clock, plays, events, player: () => FakePlayer.last };
}
const ended = (el) => { const seen = []; el.addEventListener('ended', () => seen.push('ended')); return seen; };

test('Spotify URIs, and the order handed to Spotify: the rest of the disc unless shuffling or repeating one', () => {
  assert.ok(isSpotifyUri(A));
  assert.ok(!isSpotifyUri('/music/a.flac') && !isSpotifyUri('spotify:album:x') && !isSpotifyUri(undefined));
  const q = [A, B, C];
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: false, repeat: 'OFF' }), [B, C]);
  assert.deepStrictEqual(spotifyUpcoming(q, 2, { shuffle: false, repeat: 'ALL' }), []);
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: true, repeat: 'OFF' }), []);
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: false, repeat: 'ONE' }), []);
});

test('the element reports its length at once, and playing sends the track and what follows, from where it was set', async () => {
  const { session, plays } = setup();
  const el = new SpotifyTrackElement(session, A, 200000, () => [B, C]);
  await new Promise((resolve) => el.addEventListener('loadedmetadata', resolve));
  assert.strictEqual(el.duration, 200);
  assert.ok(el.paused);
  el.currentTime = 30;
  assert.strictEqual(plays.length, 0); // nothing reaches Spotify before PLAY
  await el.play();
  assert.deepStrictEqual(plays, [{ deviceId: 'dev1', uris: [A, B, C], positionMs: 30000 }]);
  assert.ok(!el.paused);
});

test('the SDK asks for a token every time, so a long session gets fresh ones', async () => {
  const { session, player } = setup();
  await session.connect();
  const got = [];
  player().opts.getOAuthToken((t) => got.push(t));
  player().opts.getOAuthToken((t) => got.push(t));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(got, ['tok-1', 'tok-2']);
});

test('position runs on between Spotify’s reports, and stops when paused', async () => {
  const { session, clock, player } = setup();
  const el = new SpotifyTrackElement(session, A, 200000, () => []);
  await el.play();
  player().emit('player_state_changed', st(A, 10000));
  clock.t += 2500;
  assert.strictEqual(el.currentTime, 12.5);
  el.pause();
  clock.t += 5000;
  assert.strictEqual(el.currentTime, 12.5);
  assert.deepStrictEqual(player().calls.at(-1), ['pause']);
});

test('Spotify moving on to the next track ends this element, and the next one carries on without a new request', async () => {
  const { session, plays, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => [B]);
  const seen = ended(a);
  await a.play();
  player().emit('player_state_changed', st(A, 0));
  player().emit('player_state_changed', st(B, 0));
  assert.deepStrictEqual(seen, ['ended']);
  a.pause(); a.load(); // what AudioEngine does to the finished deck: must not pause Spotify
  assert.ok(!player().calls.some((c) => c[0] === 'pause'));
  const b = new SpotifyTrackElement(session, B, 180000, () => []);
  await b.play();
  assert.strictEqual(plays.length, 1); // gapless: B was already playing
  assert.ok(!b.paused);
});

test('the last track of what was sent: paused back at 0 after reaching its end is the end', async () => {
  const { session, clock, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  const seen = ended(a);
  await a.play();
  player().emit('player_state_changed', st(A, 0));
  clock.t += 199500;
  player().emit('player_state_changed', st(A, 0, { paused: true }));
  assert.deepStrictEqual(seen, ['ended']);
  assert.ok(a.paused);
});

test('repeat one: after the end, playing the track again asks Spotify afresh from the start', async () => {
  const { session, clock, plays, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  await a.play();
  player().emit('player_state_changed', st(A, 0));
  clock.t += 199500;
  player().emit('player_state_changed', st(A, 0, { paused: true }));
  a.currentTime = 0; // what trackFinished does for repeat one: seek(0), then play()
  await a.play();
  assert.deepStrictEqual(plays[1], { deviceId: 'dev1', uris: [A], positionMs: 0 });
});

test('a track that ends without Spotify saying so is ended by the tick', async () => {
  const { session, clock, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  const seen = ended(a);
  await a.play();
  player().emit('player_state_changed', st(A, 0));
  clock.t += 200000;
  session.tick();
  assert.deepStrictEqual(seen, []);
  clock.t += 2000;
  session.tick();
  assert.deepStrictEqual(seen, ['ended']);
});

test('a relinked track (Spotify plays another URI for it) counts as the one asked for', async () => {
  const { session, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => [B]);
  const seen = ended(a);
  await a.play();
  player().emit('player_state_changed', st('spotify:track:A-market', 0));
  player().emit('player_state_changed', st('spotify:track:A-market', 5000));
  assert.deepStrictEqual(seen, []);
  assert.ok(!a.paused);
  player().emit('player_state_changed', st('spotify:track:B-market', 0)); // the next one relinked too
  assert.deepStrictEqual(seen, ['ended']);
  assert.strictEqual(session.currentUri, B);
});

test("the old track's last report, arriving after a new request, isn't taken for the new one", async () => {
  const { session, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  await a.play();
  player().emit('player_state_changed', st(A, 100000));
  a.load();
  const c = new SpotifyTrackElement(session, C, 200000, () => []);
  await c.play();
  player().emit('player_state_changed', st(A, 100500, { paused: true }));
  assert.strictEqual(session.currentUri, C);
  player().emit('player_state_changed', st(C, 0));
  assert.ok(!c.paused);
});

test('turning shuffle on mid-song re-sends just the song, at where it is; the same order sends nothing', async () => {
  const { session, clock, plays, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => [B, C]);
  await a.play();
  player().emit('player_state_changed', st(A, 40000));
  session.resync([B, C]);
  assert.strictEqual(plays.length, 1);
  clock.t += 1000;
  session.resync([]);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(plays[1], { deviceId: 'dev1', uris: [A], positionMs: 41000 });
});

test('a change while paused waits for PLAY', async () => {
  const { session, plays, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => [B, C]);
  await a.play();
  player().emit('player_state_changed', st(A, 40000));
  a.pause();
  session.resync([C]);
  assert.strictEqual(plays.length, 1);
  await a.play();
  assert.deepStrictEqual(plays[1], { deviceId: 'dev1', uris: [A, C], positionMs: 40000 });
});

test('another device taking over: paused where it was, and PLAY brings it back there', async () => {
  const { session, clock, plays, events, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  await a.play();
  player().emit('player_state_changed', st(A, 60000));
  clock.t += 1000;
  player().emit('player_state_changed', null);
  assert.deepStrictEqual(events.at(-1), { type: 'lost', uri: A });
  assert.ok(a.paused);
  assert.strictEqual(a.currentTime, 61);
  await a.play();
  assert.deepStrictEqual(plays[1], { deviceId: 'dev1', uris: [A], positionMs: 61000 });
});

test('errors: no Premium, a licence never granted, a signed-out token, and one bad track', async () => {
  let s = setup();
  await s.session.connect();
  s.player().emit('account_error', { message: 'x' });
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'premium' });

  s = setup();
  const a = new SpotifyTrackElement(s.session, A, 200000, () => [B]);
  await a.play();
  s.player().emit('playback_error', { message: 'x' });
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'playback' });
  s.player().emit('playback_error', { message: 'x' });
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'unsupported' }); // twice and never a second played
  s.player().emit('playback_error', { message: 'x' });
  assert.strictEqual(s.events.filter((e) => e.reason === 'unsupported').length, 1);

  s = setup();
  const b = new SpotifyTrackElement(s.session, A, 200000, () => []);
  await b.play();
  s.player().emit('player_state_changed', st(A, 5000));
  s.player().emit('playback_error', { message: 'x' });
  s.player().emit('playback_error', { message: 'x' });
  assert.ok(!s.events.some((e) => e.reason === 'unsupported')); // it has played: just bad tracks

  s = setup({ responses: [{ ok: false, status: 401 }] });
  const c = new SpotifyTrackElement(s.session, A, 200000, () => []);
  await assert.rejects(c.play());
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'auth' });

  s = setup({ responses: [{ ok: false, status: 403 }] });
  await assert.rejects(new SpotifyTrackElement(s.session, A, 200000, () => []).play());
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'premium' });
});

test("the device not registered yet (404) is asked once more", async () => {
  const { session, plays } = setup({ responses: [{ ok: false, status: 404 }, { ok: true, status: 204 }] });
  await new SpotifyTrackElement(session, A, 200000, () => []).play();
  assert.strictEqual(plays.length, 2);
});

test('no player script (offline) is an error, and connecting can be tried again', async () => {
  let fail = true;
  const session = new SpotifySession({ loadPlayer: async () => { if (fail) throw new Error('sdk'); return FakePlayer; }, getToken: async () => 't', startPlayback: async () => ({ ok: true }) });
  const events = [];
  session.on((e) => events.push(e));
  assert.deepStrictEqual(await session.connect(), { ok: false, reason: 'offline' });
  assert.deepStrictEqual(events.at(-1), { type: 'error', reason: 'offline' });
  fail = false;
  assert.deepStrictEqual(await session.connect(), { ok: true });
});

test('volume reaches the player, before and after it exists', async () => {
  const { session, player } = setup();
  session.setVolume(0.3);
  await session.connect();
  assert.strictEqual(player().opts.volume, 0.3);
  session.setVolume(0.8);
  assert.deepStrictEqual(player().calls.at(-1), ['volume', 0.8]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/spotify-deck.test.mjs`
Expected: FAIL — `SpotifySession` is not exported.

- [ ] **Step 3: Implement**

Append to `src/renderer/js/spotify-deck.js`:

```js
export const isSpotifyUri = (p) => typeof p === 'string' && /^spotify:track:[A-Za-z0-9]+$/.test(p);

/**
 * What Spotify is handed after the current track: the rest of the disc, so an album plays on without a gap. Not when
 * shuffling (CDPlayer picks each next song itself, and there's no gap to keep between unrelated songs) or repeating
 * one track — then just the song, and CDPlayer says what comes next when it ends.
 */
export function spotifyUpcoming(queue, index, { shuffle, repeat }) {
  if (shuffle || repeat === 'ONE' || index < 0) return [];
  return queue.slice(index + 1).filter(isSpotifyUri);
}

const NEAR_END_MS = 2000;   // a track paused back at 0 this close to its end has finished
const OVERRUN_MS = 1500;    // no word from Spotify this long past the end: finished anyway
const STALE_MS = 3000;      // after a request, a report further in than this is still the old track's

export class SpotifySession {
  constructor({ loadPlayer, getToken, startPlayback, now = () => Date.now(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), volume = 1, name = 'CDPlayer' }) {
    Object.assign(this, { loadPlayer, getToken, startPlayback, now, wait, volume, name });
    this.listeners = new Set();
    this.player = null; this.deviceId = null; this.ready = null;
    this.currentUri = null; this.lost = false;
    this.sent = []; this.sentIndex = 0; this.awaiting = null; this.aliases = new Map(); this.pendingUpcoming = null;
    this.pos = { ms: 0, at: now(), paused: true }; this.durationMs = 0;
    this.everPlayed = false; this.playbackErrors = 0; this.saidUnsupported = false;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of [...this.listeners]) fn(e); }

  connect() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      let Player;
      try { Player = await this.loadPlayer(); } catch { Player = null; }
      if (!Player) { this.emit({ type: 'error', reason: 'offline' }); return { ok: false, reason: 'offline' }; }
      return new Promise((resolve) => {
        const fail = (reason) => { this.emit({ type: 'error', reason }); resolve({ ok: false, reason }); };
        const player = this.player = new Player({ name: this.name, volume: this.volume, getOAuthToken: (cb) => { this.getToken().then((t) => cb(t || ''), () => cb('')); } });
        player.addListener('ready', ({ device_id }) => { this.deviceId = device_id; resolve({ ok: true }); });
        player.addListener('not_ready', () => { this.deviceId = null; });
        player.addListener('initialization_error', () => fail('unsupported'));
        player.addListener('authentication_error', () => fail('auth'));
        player.addListener('account_error', () => fail('premium'));
        player.addListener('playback_error', () => this.onPlaybackError());
        player.addListener('player_state_changed', (s) => this.onState(s));
        player.connect().then((ok) => { if (!ok) fail('unsupported'); }, () => fail('unsupported'));
      });
    })();
    this.ready.then((r) => { if (!r.ok) this.ready = null; }); // a failed connection can be tried again
    return this.ready;
  }

  get paused() { return this.pos.paused; }
  position() {
    const p = this.pos.paused ? this.pos.ms : this.pos.ms + (this.now() - this.pos.at);
    return this.durationMs ? Math.min(p, this.durationMs + OVERRUN_MS * 2) : p;
  }

  /** Plays `uri` from `positionMs`, followed by `upcoming`. False when Spotify refused (the error is emitted). */
  async play(uri, positionMs = 0, upcoming = []) {
    const c = await this.connect();
    if (!c.ok) return false;
    this.sent = [uri, ...upcoming]; this.sentIndex = 0;
    this.currentUri = uri; this.awaiting = uri; this.aliases.clear(); this.pendingUpcoming = null; this.lost = false;
    this.pos = { ms: positionMs, at: this.now(), paused: false };
    const request = { deviceId: this.deviceId, uris: this.sent, positionMs: Math.round(positionMs) };
    let r = await this.startPlayback(request);
    if (!r.ok && r.status === 404) { await this.wait(1000); r = await this.startPlayback({ ...request, deviceId: this.deviceId }); }
    if (r.ok) return true;
    this.pos = { ms: positionMs, at: this.now(), paused: true };
    this.emit({ type: 'error', reason: r.status === 401 ? 'auth' : r.status === 403 ? 'premium' : r.status === 0 ? 'offline' : 'playback' });
    return false;
  }
  async resume() {
    if (this.pendingUpcoming) return this.play(this.currentUri, this.position(), this.pendingUpcoming);
    this.pos = { ms: this.pos.ms, at: this.now(), paused: false };
    if (this.player) await this.player.resume();
    return true;
  }
  pause() {
    this.pos = { ms: this.position(), at: this.now(), paused: true };
    if (this.player) this.player.pause();
  }
  seek(ms) {
    this.pos = { ms, at: this.now(), paused: this.pos.paused };
    if (this.player) this.player.seek(ms);
  }
  setVolume(v) { this.volume = v; if (this.player) this.player.setVolume(v); }

  /** The order after the current track changed (shuffle, repeat, the queue): Spotify is re-told only if it differs. */
  resync(upcoming) {
    if (!this.currentUri || this.lost) return;
    const tail = this.sent.slice(this.sentIndex + 1);
    if (tail.length === upcoming.length && tail.every((u, i) => u === upcoming[i])) { this.pendingUpcoming = null; return; }
    if (this.pos.paused) { this.pendingUpcoming = upcoming; return; }
    this.play(this.currentUri, this.position(), upcoming);
  }
  /** Called on the playback timer: a track that ran out without a report from Spotify has finished. */
  tick() {
    if (!this.currentUri || this.pos.paused || !this.durationMs || this.lost) return;
    if (this.position() >= this.durationMs + OVERRUN_MS) this.finish(this.currentUri);
  }
  finish(uri) {
    // Nothing is on Spotify's device now: playing this track again (repeat one) is a fresh request, not a resume.
    this.currentUri = null;
    this.pos = { ms: 0, at: this.now(), paused: true };
    this.emit({ type: 'finished', uri });
  }

  onPlaybackError() {
    this.playbackErrors++;
    if (!this.everPlayed && this.playbackErrors >= 2) {
      if (!this.saidUnsupported) { this.saidUnsupported = true; this.emit({ type: 'error', reason: 'unsupported' }); }
      return;
    }
    this.emit({ type: 'error', reason: 'playback' });
  }

  onState(s) {
    if (!s) {
      if (this.currentUri && !this.lost) {
        this.lost = true;
        this.pos = { ms: this.position(), at: this.now(), paused: true };
        this.emit({ type: 'lost', uri: this.currentUri });
      }
      return;
    }
    const track = s.track_window && s.track_window.current_track;
    if (!track) return;
    const before = this.position();
    const raw = track.uri, linked = track.linked_from && track.linked_from.uri;
    let uri = this.aliases.get(raw) || (linked && this.sent.includes(linked) ? linked : raw);
    if (this.awaiting) {
      if (uri !== this.awaiting) {
        if (s.position > STALE_MS) return; // the previous track's last word
        this.aliases.set(raw, this.awaiting); uri = this.awaiting; // Spotify plays another copy of it (relinked)
      }
      this.awaiting = null;
    } else if (uri !== this.currentUri && !this.sent.includes(uri) && this.sent[this.sentIndex + 1]) {
      this.aliases.set(raw, this.sent[this.sentIndex + 1]); uri = this.sent[this.sentIndex + 1]; // the next one, relinked
    }
    this.lost = false;
    if (uri !== this.currentUri) {
      const from = this.currentUri, i = this.sent.indexOf(uri, this.sentIndex);
      if (i >= 0) this.sentIndex = i;
      this.currentUri = uri;
      this.durationMs = s.duration;
      this.pos = { ms: s.position, at: this.now(), paused: s.paused };
      this.emit({ type: 'trackchange', from, to: uri });
      return;
    }
    if (s.paused && s.position === 0 && this.durationMs > 0 && before >= this.durationMs - NEAR_END_MS) { this.finish(uri); return; }
    if (s.position > 0 && !s.paused) this.everPlayed = true;
    this.durationMs = s.duration;
    this.pos = { ms: s.position, at: this.now(), paused: s.paused };
  }
}

/** One track of a Spotify disc, looking enough like an <audio> element for AudioEngine to play it as a deck. */
export class SpotifyTrackElement {
  constructor(session, uri, durationMs, upcoming = () => []) {
    Object.assign(this, { session, uri, durationMs, upcoming });
    this.handlers = new Map();
    this.pending = 0; this.ended = false; this.disposed = false;
    this.off = session.on((e) => this.onSession(e));
    setTimeout(() => this.fire('loadedmetadata'), 0); // the length is known from the disc already
  }
  addEventListener(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); }
  removeEventListener(type, fn) { const set = this.handlers.get(type); if (set) set.delete(fn); }
  fire(type) { if (!this.disposed) for (const fn of [...(this.handlers.get(type) || [])]) fn(); }

  /** Spotify is on this track (not finished, not taken over by another device). */
  get own() { return !this.ended && !this.disposed && this.session.currentUri === this.uri && !this.session.lost; }
  get paused() { return !this.own || this.session.paused; }
  get duration() { return this.durationMs / 1000; }
  get currentTime() { return this.own ? Math.min(this.durationMs, this.session.position()) / 1000 : this.pending; }
  set currentTime(seconds) {
    if (this.own) this.session.seek(Math.round(seconds * 1000));
    else { this.pending = seconds; this.ended = false; }
  }
  async play() {
    if (this.own) { if (this.session.paused) await this.session.resume(); return; }
    this.ended = false;
    const ok = await this.session.play(this.uri, Math.round(this.pending * 1000), this.upcoming());
    if (!ok) throw new Error('spotify');
  }
  pause() { if (this.own && !this.session.paused) { this.session.pause(); this.pending = this.currentTime; } }
  onSession(e) {
    if ((e.type === 'trackchange' && e.from === this.uri) || (e.type === 'finished' && e.uri === this.uri)) {
      this.pending = 0; this.ended = true; this.fire('ended');
    } else if (e.type === 'lost' && e.uri === this.uri) this.pending = this.session.pos.ms / 1000;
  }
  removeAttribute() {}
  load() {
    if (this.disposed) return;
    if (this.own && !this.session.paused) this.session.pause();
    this.disposed = true;
    this.off();
  }
}
```

Two details the tests rely on:
- In `test('the old track's last report…')`, `a.load()` pauses Spotify (A is still its track), then `c.play()` asks for C. The stale A report at 100500 ms arrives while awaiting C and is dropped by the `STALE_MS` check.
- `pause()` snapshots `pending` **after** `session.pause()`, which freezes the position; `currentTime` then reads `pending` only once the element no longer owns the track.

- [ ] **Step 4: Run the tests**

Run: `node --test test/spotify-deck.test.mjs && npm test`
Expected: PASS. If `'the last track of what was sent'` fails because `before` is clamped, check that `position()` clamps to `durationMs + 2 × OVERRUN_MS`, not to `durationMs`: the end check needs `before ≥ durationMs − 2000`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/spotify-deck.js test/spotify-deck.test.mjs
git commit -m "A Spotify track that plays like an audio element

One Web Playback SDK player for the app, and a stand-in <audio> element per track, so the engine can play a Spotify disc as it plays files. The rest of an album goes to Spotify with each track, so it plays on without a gap; a relinked track counts as the one asked for; another device taking over pauses it where it was."
```

---

### Task 6: `AudioEngine` decks backed by a supplied element

**Files:**
- Modify: `src/renderer/js/audio.js`
- Test: `test/audio-element-deck.test.mjs`

**Interfaces:**
- Consumes: `SpotifyTrackElement`'s `<audio>` surface (Task 5).
- Produces: `engine.load(url, { autoPlay, crossfadeSeconds, segment, element })` — with `element`, the deck plays through it (not Web Audio) and never crossfades.

- [ ] **Step 1: Write the failing test**

Create `test/audio-element-deck.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';

// Just enough Web Audio for AudioEngine's constructor and gain handling.
const param = () => ({ value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueCurveAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param() });
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = node(); this.sampleRate = 44100; }
  createGain() { return node(); }
  createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
  createAnalyser() { return { ...node(), fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0 }; }
  createMediaElementSource() { throw new Error('a supplied element must not be routed through Web Audio'); }
  resume() { return Promise.resolve(); }
};
const { AudioEngine } = await import('../src/renderer/js/audio.js');

class FakeElement {
  constructor() { this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 200; this.h = {}; this.loads = 0; setTimeout(() => this.fire('loadedmetadata'), 0); }
  addEventListener(t, f) { (this.h[t] = this.h[t] || []).push(f); }
  removeEventListener(t, f) { this.h[t] = (this.h[t] || []).filter((x) => x !== f); }
  fire(t) { for (const f of this.h[t] || []) f(); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() { this.loads++; }
}

test('a supplied element is the deck: position, length, play, seek and end come from it', async () => {
  const engine = new AudioEngine();
  const el = new FakeElement();
  const endedDecks = [];
  engine.onEnded = (d) => endedDecks.push(d);
  assert.strictEqual(await engine.load('spotify:track:A', { autoPlay: true, element: el }), true);
  assert.ok(engine.playing);
  assert.strictEqual(engine.duration, 200);
  engine.seek(42);
  assert.strictEqual(el.currentTime, 42);
  assert.strictEqual(engine.position, 42);
  el.fire('ended');
  assert.deepStrictEqual(endedDecks, [engine.deck]);
});

test('no crossfade out of a supplied element: it stops as the next track loads', async () => {
  const engine = new AudioEngine();
  const a = new FakeElement();
  await engine.load('spotify:track:A', { autoPlay: true, element: a });
  const b = new FakeElement();
  await engine.load('spotify:track:B', { autoPlay: true, crossfadeSeconds: 5, element: b });
  assert.ok(!engine.crossfading);
  assert.strictEqual(a.loads, 1); // disposed
  engine.stop();
  assert.strictEqual(b.loads, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/audio-element-deck.test.mjs`
Expected: FAIL — `a supplied element must not be routed through Web Audio`.

- [ ] **Step 3: Implement**

In `src/renderer/js/audio.js`:

Replace `createDeck(url) {` through its closing brace with:

```js
  /** A deck for `url` — or, given `element` (a Spotify track), one that plays through it, outside Web Audio. */
  createDeck(url, element = null) {
    const el = element || new Audio();
    let source = null;
    const gain = this.ctx.createGain();
    if (!element) {
      el.preload = 'auto';
      el.src = url;
      source = this.ctx.createMediaElementSource(el);
      source.connect(gain);
      gain.connect(this.input);
    }
    const deck = { el, source, gain, url, start: 0, end: null, endFired: false };
    el.addEventListener('ended', () => { if (this.onEnded) this.onEnded(deck); });
    return deck;
  }
```

In `disposeDeck`, replace `deck.source.disconnect();` with `if (deck.source) deck.source.disconnect();`.

In `load`, change the signature and the crossfade decision and the deck creation:

```js
  async load(url, { autoPlay = true, crossfadeSeconds = 0, segment = null, element = null } = {}) {
    this.cancelCrossfade();
    const outgoing = this.deck;
    // A Spotify track plays outside Web Audio, so there's nothing to fade — in or out.
    const doCrossfade = crossfadeSeconds > 0 && !element && outgoing && outgoing.source && !outgoing.el.paused;
    if (!doCrossfade) { this.disposeDeck(outgoing); this.deck = null; }
    const deck = this.createDeck(url, element);
```

(The rest of `load` is unchanged.)

- [ ] **Step 4: Run the tests**

Run: `node --test test/audio-element-deck.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/audio.js test/audio-element-deck.test.mjs
git commit -m "The audio engine plays a deck through an element it's given

For Spotify tracks: the deck plays through the supplied element instead of Web Audio, and never crossfades in or out."
```

---

### Task 7: The Spotify disc in the player (`app.js`)

**Files:**
- Modify: `src/renderer/js/app.js`
- Modify: `src/renderer/js/panels.js` (unavailable rows)
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: Tasks 4–6 (`cdp.spotify*`, `SpotifySession`, `SpotifyTrackElement`, `isSpotifyUri`, `spotifyUpcoming`, `loadSpotifySdk`, `engine.load(…, { element })`).
- Produces (on `app`): `playSpotifyDisc(tracks: DiscTrack[], name: string): Promise<void>`, `spotifyActive(): boolean`.

This task is DOM glue with no unit-test harness in the repo (like the rest of `app.js`); its logic lives in the tested Task 5/6 code, and Step 6 checks it by hand.

- [ ] **Step 1: State, session and disc**

In `src/renderer/js/app.js`, add the import beside the others:

```js
import { SpotifySession, SpotifyTrackElement, isSpotifyUri, spotifyUpcoming, loadSpotifySdk } from './spotify-deck.js';
```

Below `const detailsCache = new Map();` add:

```js
const spotifyTracks = new Map(); // spotify:track:… -> { uri, title, artist, album, durationMs, cover } of the Spotify disc
```

Add a new section before `// ---- Audio CDs ----`:

```js
// ---- Spotify discs ---------------------------------------------------------------------------------------------
// An album or playlist from the SPOTIFY panel goes in as a whole disc of spotify:track:… entries. The Web Playback
// SDK plays it (spotify-deck.js); everything else — the disc, transport, lyrics, karaoke — works as for files.

const SPOTIFY_ERRORS = {
  premium: 'SPOTIFY PREMIUM IS NEEDED TO PLAY',
  unsupported: "SPOTIFY PLAYBACK ISN'T SUPPORTED ON THIS SYSTEM",
  auth: 'SPOTIFY SIGNED OUT · CONNECT AGAIN UNDER SPOTIFY',
  offline: "COULDN'T REACH SPOTIFY",
  playback: "COULDN'T PLAY THAT TRACK ON SPOTIFY",
};
let spotifySession = null;
function spotify() {
  if (spotifySession) return spotifySession;
  spotifySession = new SpotifySession({
    loadPlayer: () => loadSpotifySdk(),
    getToken: () => cdp.spotifyAccessToken(),
    startPlayback: (request) => cdp.spotifyPlay(request),
    volume: state.volume / 100,
  });
  spotifySession.on(onSpotifyEvent);
  return spotifySession;
}
const spotifyActive = () => isSpotifyUri(state.loadedPath);
const spotifyDiscIn = () => state.queue.some(isSpotifyUri);
function onSpotifyEvent(e) {
  if (!spotifyActive()) return;
  if (e.type === 'lost') { setPlaying(false); setStatus('PLAYING ON ANOTHER DEVICE · PRESS PLAY TO BRING IT BACK'); return; }
  if (e.type !== 'error') return;
  if (e.reason !== 'playback') { engine.pause(); setPlaying(false); }
  setStatus(SPOTIFY_ERRORS[e.reason] || SPOTIFY_ERRORS.playback);
}
/** Tells Spotify the order after the current track again, after shuffle, repeat or the queue changed. */
function spotifyResync() {
  if (spotifyActive() && spotifySession) spotifySession.resync(spotifyUpcoming(state.queue, state.index, state));
}
async function playSpotifyDisc(tracks, name) {
  if (!tracks.length) return;
  for (const t of tracks) {
    spotifyTracks.set(t.uri, t);
    detailsCache.set(t.uri, { title: t.title, artist: t.artist, album: t.album, duration: t.durationMs / 1000 });
  }
  if (isShelfOpen()) closeShelf();
  await insertDisc(tracks.map((t) => t.uri), { status: `${String(name || 'SPOTIFY').toUpperCase()} ON THE TRAY` });
}
async function loadSpotify(path, token, { autoPlay, startAt }) {
  const t = spotifyTracks.get(path);
  if (!t) { engine.stop(); setPlaying(false); setStatus('THAT SPOTIFY DISC IS NO LONGER IN'); return; }
  $('tags-button').hidden = true;
  const element = new SpotifyTrackElement(spotify(), path, t.durationMs, () => spotifyUpcoming(state.queue, state.index, state));
  const ok = await engine.load(path, { autoPlay: false, element }).catch(() => false);
  if (!ok || token !== state.loadToken) return;
  if (startAt > 0) engine.seek(Math.min(startAt, engine.duration));
  if (autoPlay) await engine.play();
  if (token !== state.loadToken) return;
  setPlaying(autoPlay && engine.playing);
  if (!autoPlay) setStatus('TRACK LOADED');
  $('length').textContent = formatTime(engine.duration);
  updateProgressUi(true);
  renderQueue(); saveQueueSoon();
  panels.refreshSettingsIfOpen(app);
  const details = { title: t.title, artist: t.artist, album: t.album, lyrics: null, cover: null, coverUrl: t.cover, duration: t.durationMs / 1000, ext: 'SPOTIFY' };
  state.details = details; state.detailsPath = path;
  setTrackTitle(details.title, details.artist);
  fadeInNowPlaying();
  $('track-source').textContent = `SPOTIFY${t.album ? ` · ${t.album.toUpperCase()}` : ''}`;
  state.lyrics = null; state.lyricsSource = null;
  lyricsChanged();
  if (details.title) lookUpLyrics(details, token);
  details.cover = t.cover ? await cdp.spotifyCover(t.cover).catch(() => null) : null;
  if (token !== state.loadToken) return;
  await setCover(details.cover);
  updateMediaSession();
}
```

- [ ] **Step 2: Route loading, order, volume and the tick**

In `load()`, right after `$('tags-button').hidden = false;` insert:

```js
  if (isSpotifyUri(path)) { progress.setWaveform(null); await loadSpotify(path, token, { autoPlay, startAt }); return; }
```

(Spotify tracks skip history: `recordHistory` is only called further down `load()`, which a Spotify track never reaches.)

At the end of `toggleShuffle()` and of `cycleRepeat()`, add `spotifyResync();`.

In `setupQueueDrag`'s pointermove handler, change `if (changed) { renderQueue(); saveQueueSoon(); }` to `if (changed) { renderQueue(); saveQueueSoon(); spotifyResync(); }`.

In `removeFromQueue`, before `renderQueue(); saveQueueSoon();`, add `spotifyResync();`.

In `setVolume`, after `engine.setVolume(state.volume / 100);` add `if (spotifySession) spotifySession.setVolume(state.volume / 100);`.

In `buildStaticUi`, the booklet is built from an album's files, so it doesn't open for a Spotify disc. Change `disc.onArtClick = (from) => openBooklet(app, from);` to:

```js
  disc.onArtClick = (from) => { if (!spotifyActive()) openBooklet(app, from); };
```

In `saveFoundLater`, change the guard to `if (!path || /\.cue#\d+$/i.test(path) || isSpotifyUri(path)) return;`.

In `playbackTick`, after `engine.watchSegmentEnd();` add:

```js
  if (spotifyActive()) { if (spotifySession) spotifySession.tick(); }
```

and change the crossfade condition's start to `if (!state.crossfadeStarted && state.crossfade > 0 && !spotifyActive() && dur > 0 …` (keep the rest).

- [ ] **Step 3: Never mix a Spotify disc with files**

In `addToQueue`, after the `if (!songs.length) …` line:

```js
  if (spotifyDiscIn()) { insertDisc(songs); return; } // files replace a Spotify disc, like a new CD
```

In `loadPlaylist`, after the `if (!r.tracks.length) …` line:

```js
  if (spotifyDiscIn()) { insertDisc(r.tracks); return; }
```

In `appendAndPlay`, as its first line:

```js
  if (spotifyDiscIn()) { insertDisc([p]); return; }
```

Add `playSpotifyDisc, spotifyActive,` to the `app` object (next to `insertDisc`).

- [ ] **Step 4: Unavailable controls**

In `src/renderer/styles.css`, after the `.pill:disabled:hover` rule:

```css
.unavailable { opacity: .4; }
.unavailable > * { pointer-events: none; }
```

In `src/renderer/js/panels.js` `buildSettings`, after the `const saveFound = …` line:

```js
  // A Spotify disc plays outside Web Audio: the EQ, crossfade and mono can't shape it.
  const forSpotify = app.spotifyActive();
  const unavailable = (node) => (forSpotify ? el('div', { class: 'unavailable', title: 'Not available for Spotify' }, node) : node);
```

and wrap three rows in the `body`:

```js
    unavailable(row('EQUALIZER', el('div', { class: 'row-pills' }, presetButton, eqButton))),
    unavailable(sliderRow('CROSSFADE', crossfade, crossfadeValue)),
    unavailable(row('MONO AUDIO', mono)),
```

In `buildEq`, at the top of the returned children, when `app.spotifyActive()` is true, add `hint('Not available for Spotify — the equalizer shapes your own files.')` as the first element after the title. (Find the `return [title(…` line in `buildEq` and insert `app.spotifyActive() ? hint('Not available for Spotify — the equalizer shapes your own files.') : null,` right after the title.)

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Check by hand (with the user)**

In the DevTools console of `npm start` (dev Electron signed in Task 4), with the user signed in:

```js
const { tracks } = await cdp.spotifyDiscTracks({ kind: 'album', id: '6dVIqQ8qmQ5GBnJ9shOYGE' });
(await import('./js/app.js')).app.playSpotifyDisc(tracks, 'OK Computer');
```

Expected, with the user listening:
- the tray runs out and back, and Airbag plays; the title, artist, cover and `SPOTIFY · OK COMPUTER` show;
- Up Next lists Paranoid Android; the seek bar moves, and dragging it seeks;
- dragging the seek bar to a few seconds before Airbag's end → it runs on into Paranoid Android with no gap you can hear, and the queue's highlight moves with it;
- REPEAT set to one track → at the end, the same song starts again from 0:00;
- clicking the disc's art doesn't open a booklet;
- SHUFFLE on → the next song is a random one, and Spotify doesn't play Paranoid Android first;
- the volume slider changes Spotify's volume;
- Settings shows EQ, crossfade and mono dimmed with the tooltip;
- lyrics/karaoke appear for a song with synced lyrics and follow it;
- dropping a local file on the player swaps the disc for it.

Fix anything that differs before committing.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/js/app.js src/renderer/js/panels.js src/renderer/styles.css
git commit -m "A Spotify album or playlist plays as a disc

Its tracks go in as a whole disc and play through the Web Playback SDK, with the transport, seek bar, Up Next, lyrics and karaoke as for files. Shuffle, repeat and queue changes re-tell Spotify the order. The EQ, crossfade and mono are dimmed — they can't reach Spotify's audio — and dropping files swaps the disc rather than mixing them in."
```

---

### Task 8: The SPOTIFY button and panel

**Files:**
- Modify: `src/renderer/index.html`, `src/renderer/js/panels.js`, `src/renderer/js/app.js`

**Interfaces:**
- Consumes: `cdp.spotifyStatus`, `saveSpotifyCredentials`, `spotifySignIn`, `spotifyAlbums`, `spotifyPlaylists`, `spotifySearch`, `spotifyDiscTracks`, `spotifyDrmReady`, `openSpotifyDashboard`; `app.playSpotifyDisc`.
- Produces: `showSpotify(app)` exported from `panels.js`.

- [ ] **Step 1: The button**

In `src/renderer/index.html`, after the `shelf-button` line (line 23):

```html
          <button class="pill" id="spotify-button" title="Play albums and playlists from your Spotify (Premium)">SPOTIFY</button>
```

In `app.js` `buildStaticUi`, after the shelf button's listener:

```js
  $('spotify-button').addEventListener('click', () => panels.showSpotify(app));
```

- [ ] **Step 2: The panel**

In `src/renderer/js/panels.js`, add `'spotify'` to `ESC_ORDER` before `'search'`, and add this section before `// ---- Onboarding` (or at the end of the file if there's no such marker — find it with `grep -n "^// ----" src/renderer/js/panels.js`):

```js
// ---- Spotify -----------------------------------------------------------------------------------------------------
// Three states: no developer app yet (the Client ID and Secret, with how to get them), not connected (or connected
// before playback existed), and connected — your saved albums, your playlists, and a search. A click puts it on the tray.

const SPOTIFY_MESSAGES = {
  SIGN_IN: 'CONNECT SPOTIFY AGAIN', OFFLINE: "COULDN'T REACH SPOTIFY",
  NOT_SHARED: 'SPOTIFY ONLY SHARES THE SONGS OF PLAYLISTS YOU OWN OR COLLABORATE ON', EMPTY: 'NOTHING TO PLAY ON THAT ONE',
};
const sp = { account: null, drm: null, tab: 'ALBUMS', lists: { ALBUMS: null, PLAYLISTS: null }, next: { ALBUMS: 0, PLAYLISTS: 0 }, query: '', found: null, status: '', searchTimer: null };
const spotifyMessage = (code) => SPOTIFY_MESSAGES[code] || `SPOTIFY · ${code}`;

export function showSpotify(app) {
  openPanel('spotify', () => buildSpotify(app), { width: 540 });
  refreshSpotifyAccount(app);
}
async function refreshSpotifyAccount(app) {
  sp.account = await app.cdp.spotifyStatus().catch(() => null);
  if (sp.account && sp.account.connected && !sp.account.reconnectNeeded) {
    if (sp.drm === null) app.cdp.spotifyDrmReady().then((ok) => { sp.drm = ok; refreshPanel('spotify'); });
    if (!sp.lists[sp.tab]) loadSpotifyList(app, sp.tab);
  }
  refreshPanel('spotify');
}
async function loadSpotifyList(app, tab) {
  const offset = sp.next[tab];
  if (offset === null) return;
  sp.status = 'LOADING…'; refreshPanel('spotify');
  const r = await (tab === 'ALBUMS' ? app.cdp.spotifyAlbums(offset) : app.cdp.spotifyPlaylists(offset)).catch(() => ({ error: 'OFFLINE' }));
  if (r.error) {
    sp.status = spotifyMessage(r.error);
    if (r.error === 'SIGN_IN') sp.account = { ...sp.account, reconnectNeeded: true };
  } else {
    sp.lists[tab] = [...(sp.lists[tab] || []), ...r.items];
    sp.next[tab] = r.next;
    sp.status = '';
  }
  refreshPanel('spotify');
}
function searchSpotify(app, query) {
  sp.query = query;
  clearTimeout(sp.searchTimer);
  if (!query.trim()) { sp.found = null; refreshPanel('spotify'); return; }
  sp.searchTimer = setTimeout(async () => {
    const r = await app.cdp.spotifySearch(query.trim()).catch(() => ({ error: 'OFFLINE' }));
    if (sp.query !== query) return; // typed on since
    if (r.error) sp.status = spotifyMessage(r.error); else { sp.found = r.items; sp.status = ''; }
    refreshPanel('spotify');
  }, 400);
}
async function putSpotifyOnTray(app, item) {
  sp.status = `READING ${item.name.toUpperCase()}…`; refreshPanel('spotify');
  const r = await app.cdp.spotifyDiscTracks({ kind: item.kind, id: item.id }).catch(() => ({ error: 'OFFLINE' }));
  if (r.error) { sp.status = spotifyMessage(r.error); refreshPanel('spotify'); return; }
  sp.status = '';
  closePanel('spotify');
  app.playSpotifyDisc(r.tracks, item.name);
}

function buildSpotify(app) {
  const a = sp.account;
  const status = el('div', { class: 'setting-hint' }, sp.status);
  const foot = el('div', { class: 'close-row' }, pill('CLOSE', () => closePanel('spotify')));
  if (!a) return [title('SPOTIFY'), gap(18), hint('CHECKING…'), foot];

  if (!a.configured) {
    const id = el('input', { class: 'text-input', type: 'text', placeholder: 'Client ID', spellcheck: 'false' });
    const secret = el('input', { class: 'text-input', type: 'password', placeholder: 'Client Secret', spellcheck: 'false' });
    const save = pill('SAVE', async () => {
      if (!id.value.trim() || !secret.value.trim()) { sp.status = 'BOTH ARE NEEDED'; refreshPanel('spotify'); return; }
      sp.account = await app.cdp.saveSpotifyCredentials({ clientId: id.value, clientSecret: secret.value });
      sp.status = ''; refreshPanel('spotify');
    });
    return [title('SPOTIFY'), gap(12),
      hint('Spotify lets each app play for only five people, so CDPlayer plays through your own free Spotify developer app. You need Spotify Premium.'),
      hint('1. Open the Spotify dashboard and create an app. Tick Web API and Web Playback SDK.'),
      hint('2. Redirect URI: http://127.0.0.1:8080/callback'),
      hint('3. Under User Management, add the email of your Spotify account.'),
      hint('4. Paste the app’s Client ID and Client Secret here.'),
      el('div', { class: 'row-pills' }, pill('OPEN SPOTIFY DASHBOARD', () => app.cdp.openSpotifyDashboard())), gap(12),
      id, gap(8), secret, gap(12), el('div', { class: 'row-pills' }, save), status, foot];
  }

  if (!a.connected || a.reconnectNeeded) {
    const connect = pill(a.reconnectNeeded ? 'RECONNECT SPOTIFY' : 'CONNECT SPOTIFY', async () => {
      connect.disabled = true;
      sp.status = 'OPENING SPOTIFY LOGIN IN YOUR BROWSER…'; status.textContent = sp.status;
      sp.status = await app.cdp.spotifySignIn();
      if (sp.status === 'SPOTIFY CONNECTED') { sp.status = ''; sp.lists = { ALBUMS: null, PLAYLISTS: null }; sp.next = { ALBUMS: 0, PLAYLISTS: 0 }; }
      refreshSpotifyAccount(app);
    });
    return [title('SPOTIFY'), gap(12),
      hint(a.reconnectNeeded ? 'Playing Spotify needs a few more permissions than importing playlists did — connect once more.' : 'Sign in to Spotify in your browser to see your albums and playlists here.'),
      gap(12), el('div', { class: 'row-pills' }, connect), status, foot];
  }

  const tabs = el('div', { class: 'row-pills' }, ...['ALBUMS', 'PLAYLISTS'].map((t) => {
    const b = pill(t, () => { sp.tab = t; sp.query = ''; sp.found = null; if (!sp.lists[t]) loadSpotifyList(app, t); refreshPanel('spotify'); });
    b.classList.toggle('on', !sp.found && sp.tab === t);
    return b;
  }));
  const field = el('input', { class: 'text-input', type: 'text', placeholder: 'Search Spotify for an album or playlist', value: sp.query, spellcheck: 'false' });
  field.addEventListener('input', () => searchSpotify(app, field.value));
  const items = sp.found || sp.lists[sp.tab] || [];
  const rows = items.map((item) => el('div', { class: 'list-row', title: `Put ${item.name} on the tray`, onClick: () => putSpotifyOnTray(app, item) },
    el('span', { class: 'entry' }, `${item.name}${item.owner ? ` · ${item.owner}` : ''}`),
    el('span', { class: 'duration' }, `${sp.found ? `${item.kind.toUpperCase()} · ` : ''}${item.total} TRACKS`)));
  if (!sp.found && sp.next[sp.tab] !== null && sp.lists[sp.tab]) rows.push(el('div', { class: 'row-pills' }, pill('MORE', () => loadSpotifyList(app, sp.tab))));
  if (sp.found && !sp.found.length) rows.push(el('div', { class: 'list-row plain' }, 'NOTHING FOUND'));
  const drm = sp.drm === false ? hint("Spotify playback isn't supported on this system — Widevine isn't available.") : null;
  requestAnimationFrame(() => { if (sp.query && document.activeElement !== field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); } });
  return [title('SPOTIFY'), gap(12), tabs, gap(10), field, drm, gap(10), el('div', { class: 'scroll' }, rows), status, foot];
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Check by hand (with the user)**

Move `~/.cdplayer/spotify.txt` aside first (**ask the user**; restore it at the end). With `npm start`:
- SPOTIFY → the setup guide; OPEN SPOTIFY DASHBOARD opens the browser; pasting the Client ID and Secret and SAVE → CONNECT SPOTIFY.
- CONNECT SPOTIFY → browser login → the ALBUMS list; PLAYLISTS lists them; MORE loads more when there are over 50.
- Typing `ok computer` → albums and playlists; clicking OK Computer → the panel closes and the disc plays.
- A playlist the user follows but didn't make → `SPOTIFY ONLY SHARES THE SONGS OF PLAYLISTS YOU OWN OR COLLABORATE ON`.
- With a 3-line (Java-era) `spotify.txt` → RECONNECT SPOTIFY with the explanation.
- Escape closes the panel.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/js/panels.js src/renderer/js/app.js
git commit -m "SPOTIFY: your albums, playlists and search, a click from the tray

The panel walks through setting up your own Spotify developer app (Client ID and Secret, the redirect URI), connects in the browser, then lists your saved albums and playlists with a search. A sign-in from before playback asks to reconnect once."
```

---

### Task 9: CI signing

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Add EVS setup before Package**

In `.github/workflows/build.yml`, after the Windows CD helper step and before `- name: Package`, add:

```yaml
      - uses: actions/setup-python@v5
        if: runner.os != 'Linux'
        with:
          python-version: '3.12'
      - name: castLabs EVS login, for Spotify's Widevine signature (skipped without the secrets, as on a fork's PR)
        if: runner.os != 'Linux' && env.EVS_ACCOUNT_NAME != ''
        shell: bash
        env:
          EVS_ACCOUNT_NAME: ${{ secrets.EVS_ACCOUNT_NAME }}
          EVS_PASSWD: ${{ secrets.EVS_PASSWD }}
        run: |
          python -m pip install --upgrade castlabs-evs
          python -m castlabs_evs.account reauth -A "$EVS_ACCOUNT_NAME" -P "$EVS_PASSWD"
```

GitHub doesn't allow `secrets` in a step's `if:` directly, so expose them at job level first: under `build:` → `runs-on`, add

```yaml
    env:
      EVS_ACCOUNT_NAME: ${{ secrets.EVS_ACCOUNT_NAME }}
```

(`build/vmp-sign.js` reads `EVS_ACCOUNT_NAME` to decide whether to sign, so the `Package` step sees it through the job env.)

- [ ] **Step 2: Validate the workflow syntax**

Run: `npx --yes @action-validator/cli .github/workflows/build.yml` (or, if unavailable, `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build.yml'))"`)
Expected: no errors.

- [ ] **Step 3: Commit, and hand the secrets to the user**

```bash
git add .github/workflows/build.yml
git commit -m "CI signs the Mac and Windows builds for Spotify's Widevine

With the EVS_ACCOUNT_NAME and EVS_PASSWD secrets, the build logs in to castLabs EVS and electron-builder signs and verifies the app. Without them — a fork's pull request — it builds unsigned, as before."
```

Tell the user: add repository secrets `EVS_ACCOUNT_NAME` and `EVS_PASSWD` (Settings → Secrets and variables → Actions) with their castLabs EVS login. Pushing the branch and watching the run is their call — ask before `git push`.

---

### Task 10: README and the release check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

1. The opening line promises "no accounts, no streaming, no internet required to play a song". Change it to: "…for your local music — no account needed, no internet required to play a song. (If you have Spotify Premium, it can play your Spotify albums too.)"
2. Add a `**Spotify** (Premium)` feature block after the `**The CD shelf**` block:

```markdown
**Spotify** (Premium)
- **SPOTIFY** lists your saved albums and playlists, with a search. Click one and it goes in as a disc and plays — the tray, the disc, Up Next, shuffle and repeat, lyrics and karaoke all work as for your files
- Spotify lets an app play for only five people, so CDPlayer plays through **your own** free Spotify developer app. The SPOTIFY panel walks you through it: create an app at [developer.spotify.com](https://developer.spotify.com/dashboard) with *Web API* and *Web Playback SDK* ticked, redirect URI `http://127.0.0.1:8080/callback`, add your Spotify account's email under *User Management*, and paste its Client ID and Secret
- Spotify's audio is protected, so the EQ, crossfade, mono, visualizer and waveform don't apply to it, and it can't be ripped. Spotify only shares the songs of playlists you made or collaborate on, not ones you just follow
- Works on macOS and Windows. On Linux it depends on your system's Widevine support
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "README: Spotify, and how to set up your own developer app for it"
```

- [ ] **Step 3: Release check (with the user, on packaged builds)**

With the EVS secrets in place and the branch pushed (ask first), download the CI artifacts, then on each system with the user's account:

| System | Check |
|---|---|
| macOS `.dmg` | connect; play an album through a track change (no gap); seek; skip; shuffle on mid-album; lyrics/karaoke follow; eject stops; quit and relaunch → the Spotify disc isn't restored and nothing errors |
| Windows `.exe` | the same |
| Linux AppImage | it plays, or the panel says Widevine isn't available and PLAY says `SPOTIFY PLAYBACK ISN'T SUPPORTED ON THIS SYSTEM` |

Record the results in the PR description. Release notes are written at release time in the usual What's new + Changelog (New/Fixed/Changed) form.
