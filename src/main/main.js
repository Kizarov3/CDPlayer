'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, screen, shell, Menu, nativeTheme, components, clipboard, ClipboardItem, nativeImage, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

// `--smoke-test=<folder>`: used by CI on macOS, Windows and Linux to prove the *packaged* app can decode every
// audio file in <folder> and read its tags, then exit 0/1. Runs against a throwaway data folder — set before
// ./store is loaded, so a real user's ~/.cdplayer is never read or written.
const smokeArg = process.argv.find((a) => a.startsWith('--smoke-test='));
const smokeDir = smokeArg ? path.resolve(smokeArg.slice('--smoke-test='.length)) : null;
if (smokeDir) process.env.CDPLAYER_HOME = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cdplayer-smoke-'));
// An isolated data folder (tests) also gets its own Electron profile, so it's a separate single instance and never
// hands off to — or shares browser storage with — a CDPlayer the user already has open.
if (process.env.CDPLAYER_HOME) app.setPath('userData', path.join(process.env.CDPLAYER_HOME, 'electron-profile'));

const store = require('./store');
const userThemes = require('./user-themes');
const i18n = require('./i18n');
const { t } = i18n; // the main process's own text — dialogs and menus — in the interface's language
const metadata = require('./metadata');
const online = require('./online');
const spotify = require('./spotify');
const library = require('./library');
const media = require('./media-protocol');
const updates = require('./updates');
const discord = require('./discord');
const cue = require('./cue');
const shelf = require('./shelf');
const { recordPlay } = require('./plays');
const tagWriter = require('./tag-writer');
const audioCd = require('./audio-cd');
const rip = require('./rip');
const { execFile } = require('child_process');
const { createOutputRate } = require('./output-rate');

const APP_VERSION = app.getVersion();
const APP_ID = 'com.kizarov3.cdplayer'; // = build.appId in package.json
const MAIN_MIN = { width: 760, height: 785 };
const MAIN_DEFAULT = { width: 1120, height: 820 };
const MINI = { width: 340, height: 152 };

// The player is always dark, so the window's title bar should be too (Windows otherwise follows a light system theme).
nativeTheme.themeSource = 'dark';
// Windows names whoever is playing in its media controls by the app's ID (AppUserModelID), which it looks up in the
// Start menu — so set a stable one here, and keep a Start menu shortcut carrying it (see registerWindowsShortcut).
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

protocol.registerSchemesAsPrivileged([
  { scheme: 'cdp', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// Launched with audio files (double-click / "Open with" / drag onto the dock icon): queue them. Also keeps a
// single window — a second launch hands its files to the running instance instead of opening another player.
const pendingOpenFiles = [];
function audioArgs(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && (library.isSupportedAudio(a) || cue.isCueFile(a)) && store.isFile(a));
}
const gotLock = !!smokeDir || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const files = audioArgs(argv);
    if (files.length) win.webContents.send('open-files', files);
  });
  pendingOpenFiles.push(...audioArgs(process.argv));
}
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (win && win.webContents && !win.webContents.isLoading()) win.webContents.send('open-files', [filePath]);
  else pendingOpenFiles.push(filePath);
});

let win = null;
let settings = store.readSettings();
let normalBounds = null;
let miniMode = false;
let miniWin = null;
let quitting = false;

function boundsOnScreen(b) {
  if (!b || b.width < MAIN_MIN.width || b.height < MAIN_MIN.height) return false;
  return screen.getAllDisplays().some(({ bounds: d }) => b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y);
}

function captureNormalBounds() {
  if (!win || miniMode || win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
  normalBounds = win.getBounds();
}

function persistSettings() {
  store.writeSettings({ ...settings, bounds: normalBounds || settings.bounds, miniMode });
}

function createWindow() {
  const saved = boundsOnScreen(settings.bounds) ? settings.bounds : null;
  win = new BrowserWindow({
    ...(saved || MAIN_DEFAULT),
    minWidth: MAIN_MIN.width,
    minHeight: MAIN_MIN.height,
    title: 'CDPlayer',
    backgroundColor: '#111113',
    show: false,
    autoHideMenuBar: true,
    icon: process.platform === 'linux' ? path.join(__dirname, '..', 'renderer', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Playback must keep advancing (track ends, crossfades, the sleep timer) while the window is hidden/minimized.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  if (saved) normalBounds = saved;
  win.on('resize', captureNormalBounds);
  win.on('move', captureNormalBounds);
  win.on('enter-full-screen', () => win.webContents.send('fullscreen-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen-changed', false));
  win.on('close', () => {
    if (!win.webContents.isCrashed()) try { win.webContents.send('app-closing'); } catch { /* already gone */ } // (a page that's gone can't be told)
    persistSettings();
  });
  win.on('closed', () => { win = null; if (miniWin && !miniWin.isDestroyed()) { quitting = true; miniWin.close(); } });
  win.once('ready-to-show', () => { if (!smokeDir) win.show(); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The page's process gone (a crash, or the system ending it): load the player again rather than leave an empty
  // window — at most three times a minute, so a page that dies as it starts can't go round and round.
  let revived = [];
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`The player's page went (${details.reason}, exit code ${details.exitCode})`);
    phonePageGone();
    if (details.reason === 'clean-exit' || quitting || win.isDestroyed()) return;
    const now = Date.now();
    revived = revived.filter((t) => now - t < 60000);
    if (revived.length >= 3) return;
    revived.push(now);
    win.webContents.reload();
  });
  win.webContents.on('did-finish-load', () => {
    if (smokeDir) { runSmokeTest(); return; }
    if (pendingOpenFiles.length) { win.webContents.send('open-files', pendingOpenFiles.splice(0)); }
    phonePageBack();
  });
  win.loadURL('cdp://app/index.html');
}

async function runSmokeTest() {
  const files = library.collectAudio([smokeDir]);
  const paths = (await files).sort(library.byName);
  const results = [];
  for (const p of paths) {
    const details = await metadata.getDetails(p, { withCover: true });
    // Decode through the exact same cdp:// media path the player uses (so AIFF/AU/ALAC go through the fallback
    // decoders), and also make sure an <audio> element accepts the stream.
    const probe = await win.webContents.executeJavaScript(`(async () => {
      const url = window.cdp.mediaUrl(${JSON.stringify(p)});
      const buf = await (await fetch(url)).arrayBuffer();
      const audio = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(buf);
      const el = new Audio(url);
      const elementDuration = await new Promise((ok, fail) => { el.onloadedmetadata = () => ok(el.duration); el.onerror = () => fail(new Error('media element error')); });
      return { decoded: audio.duration, element: elementDuration };
    })()`).catch((e) => ({ error: String(e.message || e) }));
    const ok = !probe.error && probe.decoded > 0.3 && probe.element > 0.3 && !!details.title;
    results.push({ file: path.basename(p), ok, title: details.title, ...probe });
  }
  // The output-rate helper must start and answer in the packaged app (a CI machine may have no outputs: [] is fine).
  const rateList = process.platform === 'linux' ? [] : await outputRate.list();
  const rateOk = Array.isArray(rateList);
  const allOk = results.length > 0 && results.every((r) => r.ok) && rateOk;
  process.stdout.write(`${JSON.stringify({ platform: process.platform, arch: process.arch, allOk, outputRate: rateList, results }, null, 2)}\n`);
  app.exit(allOk ? 0 : 1);
}

function buildMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: t('Window'), submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ]));
}

// ---- IPC ------------------------------------------------------------------------------------------------------

const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

// Settings → QUALITY: the output device's rate, switched by a helper per system (src/main/output-rate.js).
function outputRateHelper() {
  if (process.platform === 'darwin') {
    const bin = app.isPackaged ? path.join(process.resourcesPath, 'mac-rate') : path.join(__dirname, '..', '..', 'build', 'bin', 'mac-rate');
    return (args) => runJson(bin, args);
  }
  const script = path.join(__dirname, 'win-rate', 'helper.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return (args) => runJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args]);
}
function runJson(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) { reject(err); return; }
      try { resolve(JSON.parse(String(stdout).trim())); } catch (e) { reject(e); }
    });
  });
}
const outputRate = createOutputRate({ platform: process.platform, run: outputRateHelper(), file: path.join(store.dataDir(), 'output-rate.json') });
if (!smokeDir && gotLock) outputRate.restore().catch(() => {}); // left over from a run that didn't get to quit (a second launch must not undo the first one's)
handle('outputRate:list', () => outputRate.list());
handle('outputRate:current', (device) => outputRate.current(device));
handle('outputRate:set', (device, hz) => outputRate.set(device, hz));
handle('outputRate:restore', () => outputRate.restore());
// Widevine arrives through castLabs' component updater (downloaded on first run), so it's awaited only when Spotify
// needs it — never at startup, which must work offline and in the smoke test.
function drmReady() {
  if (!components || typeof components.whenReady !== 'function') return Promise.resolve(false);
  return Promise.race([
    components.whenReady().then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 20000)),
  ]);
}

handle('state:load', () => ({
  settings,
  queue: store.readQueue(),
  changerQueue: store.readChangerQueue(),
  history: store.readHistory(),
  eqPresets: store.readEqPresets(),
  lastPath: store.readLastPath(),
  onboarded: store.isOnboarded(),
  lastVersion: store.readLastVersion(),
  themes: userThemes.list(),
  version: APP_VERSION,
  platform: process.platform,
}));
handle('state:saveSettings', (s) => { settings = { ...settings, ...s }; persistSettings(); });
handle('state:saveQueue', (q) => store.writeQueue(q));
handle('state:saveHistory', (paths) => store.writeHistory(paths));
handle('state:saveEqPresets', (presets) => store.writeEqPresets(presets));
handle('state:markOnboarded', () => store.markOnboarded());
handle('state:writeLastVersion', (v) => store.writeLastVersion(v));
// Synchronous on purpose: called from the renderer's beforeunload, where async IPC may never be delivered.
ipcMain.on('state:saveQueueSync', (e, q) => { e.returnValue = store.writeQueue(q); });
// The interface's language (i18n.js): the dictionary, read once by each window as it loads; the languages to pick from;
// and the restart a new pick needs (the window saves the queue on its way out, as on any quit).
ipcMain.on('i18n:dict', (e) => { e.returnValue = i18n.current(); });
handle('i18n:list', () => ({ locales: i18n.listLocales(), auto: i18n.resolveLocale('AUTO', app.getPreferredSystemLanguages(), i18n.listLocales().map((l) => l.code)) }));
handle('app:relaunch', () => { app.relaunch(); app.quit(); });

handle('fs:exists', (p) => cue.entryExists(p));
handle('meta:details', (p, opts) => metadata.getDetails(p, opts));
// Play counts, kept in memory and written a moment after the last change.
let playCounts = null, playsTimer = null;
const plays = () => (playCounts = playCounts || store.readPlayCounts());
let lastPlayed = null, firstPlayed = null;
const playedAt = () => (lastPlayed = lastPlayed || store.readLastPlayed());
const firstPlayedAt = () => (firstPlayed = firstPlayed || store.readFirstPlayed());
function writePlays() {
  playsTimer = null;
  store.writePlayCounts(playCounts);
  if (lastPlayed) store.writeLastPlayed(lastPlayed);
  if (firstPlayed) store.writeFirstPlayed(firstPlayed);
}
handle('plays:add', (p) => {
  const n = recordPlay({ counts: plays(), last: playedAt(), first: firstPlayedAt() }, p, Date.now());
  clearTimeout(playsTimer); playsTimer = setTimeout(writePlays, 1000);
  // Played, its album is out of its shrink-wrap for good (not only while its play count is kept).
  const album = shelf.albumOf(p), w = album && wrap();
  if (w && !w.torn.has(album.id)) { w.torn.add(album.id); store.writeWrap(w); }
  return n;
});
handle('plays:count', (p) => plays().get(p) || 0);
// When each of `paths` was first and last played (ms, or null), for the booklet's pen marks.
handle('plays:times', (paths) => {
  const list = Array.isArray(paths) ? paths : [], first = firstPlayedAt(), last = playedAt();
  return { first: list.map((p) => first.get(p) || null), last: list.map((p) => last.get(p) || null) };
});
// Plays of the whole album a track is on (as the shelf groups it), or of the track alone when it isn't on the shelf,
// and what names that disc (its shelf album, or the track) — the same for every song on it.
handle('plays:album', (p) => {
  const counts = plays(), album = shelf.albumOf(p);
  return { plays: (album ? album.paths : [p]).reduce((n, t) => n + (counts.get(t) || 0), 0), disc: album ? album.id : p };
});
// Sound Check (sound-check.js): songs measured before, kept in soundcheck.json; and the shelf album a song is on.
const soundCheckCache = require('./soundcheck-cache').createSoundCheckCache({
  read: () => store.readText('soundcheck.json'),
  write: (s) => store.writeText('soundcheck.json', s),
  stat: (f) => { try { return fs.statSync(f); } catch { return null; } },
});
handle('soundcheck:get', (files) => soundCheckCache.get(Array.isArray(files) ? files.filter((f) => typeof f === 'string') : []));
handle('soundcheck:put', (file, entry) => { if (typeof file === 'string' && entry && typeof entry === 'object') soundCheckCache.put(file, entry); });
handle('soundcheck:album', (p) => { const a = shelf.albumOf(p); return a ? a.paths : null; });
// The now-playing card (share-card.js), onto the clipboard as a picture.
handle('clipboard:image', (png) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]));
// …or saved as a picture, named after the song, in the Pictures folder to start with. → true once saved.
// The card as a video (share-video.js): saved as MP4 (or WebM), named after the song, in the Movies folder to start with.
handle('dialog:saveVideo', async (bytes, name, ext) => {
  const kind = ext === 'webm' ? 'webm' : 'mp4';
  const safe = String(name || 'Now Playing').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Now Playing';
  const r = await dialog.showSaveDialog(win, { title: t('Save the Video'), defaultPath: path.join(app.getPath('videos'), `${safe}.${kind}`), filters: [{ name: kind === 'mp4' ? t('MP4 video') : t('WebM video'), extensions: [kind] }] });
  if (r.canceled || !r.filePath) return false;
  const target = new RegExp(`\\.${kind}$`, 'i').test(r.filePath) ? r.filePath : `${r.filePath}.${kind}`;
  fs.writeFileSync(target, Buffer.from(bytes));
  return true;
});
handle('dialog:saveCard', async (png, name) => {
  const safe = String(name || 'Now Playing').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Now Playing';
  const r = await dialog.showSaveDialog(win, { title: t('Save the Card'), defaultPath: path.join(app.getPath('pictures'), `${safe}.png`), filters: [{ name: t('PNG picture'), extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return false;
  const target = /\.png$/i.test(r.filePath) ? r.filePath : `${r.filePath}.png`;
  fs.writeFileSync(target, Buffer.from(png));
  return true;
});
// Themes people make (user-themes.js): kept, imported from a .cdtheme (chosen, or dropped on the window), exported, and
// turned into or read from the short code.
handle('themes:list', () => userThemes.list());
handle('themes:save', (theme, oldName) => userThemes.save(theme, oldName || null));
handle('themes:delete', (name) => userThemes.remove(name));
handle('themes:import', async (source) => {
  if (typeof source === 'string' && !/\.cdtheme$/i.test(source)) return { error: t('NOT A CDPLAYER THEME') };
  if (typeof source !== 'string') {
    const r = await dialog.showOpenDialog(win, { title: t('Import a Theme'), defaultPath: app.getPath('downloads'), properties: ['openFile'], filters: [{ name: t('CDPlayer theme'), extensions: ['cdtheme'] }] });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    source = r.filePaths[0];
  }
  const theme = userThemes.importFile(source);
  return theme ? { theme } : { error: t('NOT A CDPLAYER THEME') };
});
handle('themes:export', async (name) => {
  const safe = String(name || 'Theme').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Theme';
  const r = await dialog.showSaveDialog(win, { title: t('Export the Theme'), defaultPath: path.join(app.getPath('documents'), `${safe}.cdtheme`), filters: [{ name: t('CDPlayer theme'), extensions: ['cdtheme'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  return userThemes.exportFile(name, /\.cdtheme$/i.test(r.filePath) ? r.filePath : `${r.filePath}.cdtheme`) ? { ok: true } : { error: true };
});
handle('themes:encode', (theme) => userThemes.encodeCode(theme));
handle('themes:decode', (text) => userThemes.decodeCode(text));
// Right-clicking the disc: its menu → what was chosen ('card'), or null.
handle('menu:disc', (loaded) => new Promise((resolve) => {
  const menu = Menu.buildFromTemplate([{ label: t('Now Playing Card…'), sublabel: 'P', enabled: !!loaded, click: () => resolve('card') }]);
  menu.popup({ window: win, callback: () => setTimeout(() => resolve(null), 0) });
}));
// The Dock (macOS) or taskbar (Windows, Linux) icon: the disc that's in (drawn by dock-disc.js), or the app's own
// icon when nothing is. On Windows the taskbar draws the button from the window's app ID, not its icon — there the disc
// gets an ID of its own (win-taskbar-disc.js). Settings → DISC ICON turns it off for the app's own icon — on Windows it's
// off unless turned on, as the disc there costs a pin that works.
let dockPng = null, dockShown;
let windowAppId = APP_ID;
// The window's app ID, and its relaunch icon — what Windows draws its taskbar button with (the .exe's own, or a disc's).
function setWindowAppId(id, icon) {
  if (id === windowAppId || !win || win.isDestroyed()) return;
  windowAppId = id;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  win.setAppDetails({ appId: id, appIconPath: icon || exe, appIconIndex: 0, relaunchCommand: `"${exe}"`, relaunchDisplayName: 'CDPlayer' });
  // The taskbar reads a window's ID when it makes its button: take the button away and back, so it's made anew (the
  // window itself stays as it is).
  if (win.isVisible() && !miniMode) { win.setSkipTaskbar(true); win.setSkipTaskbar(false); }
}
const taskbarDisc = process.platform === 'win32' && app.isPackaged && !smokeDir && !process.env.CDPLAYER_HOME
  ? require('./win-taskbar-disc').createTaskbarDisc({ appId: APP_ID, dataDir: app.getPath('userData'), setWindowAppId })
  : null;
function showDockIcon() {
  const png = settings.taskbarDisc ? dockPng : null;
  if (png === dockShown) return;
  if (dockShown === undefined && !png) { dockShown = null; return; } // the app's own icon is already there
  if (process.platform !== 'darwin' && (!win || win.isDestroyed())) return;
  dockShown = png;
  const img = png ? nativeImage.createFromBuffer(Buffer.from(png)) : nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'icon.png'));
  if (process.platform === 'darwin') { app.dock.setIcon(img); return; }
  win.setIcon(img); // the title bar and Alt+Tab (and the taskbar on Linux)
  if (taskbarDisc) taskbarDisc.show(png).catch(() => {});
}
handle('dock:disc', (png) => { dockPng = png || null; showDockIcon(); });
handle('dock:taskbarDisc', (on) => { settings.taskbarDisc = !!on; persistSettings(); showDockIcon(); });
handle('online:cover', (query) => online.findCover(query));
handle('online:coverUrl', (query) => online.findCoverUrl(query));
handle('online:lyrics', (details) => online.findLyrics(details));
handle('spotify:classify', (text) => spotify.classifySpotifyLink(text));
handle('spotify:resolve', async (text) => {
  try { return await spotify.resolveSpotifyLink(text); } catch (e) { return { error: (e.message || 'LOOKUP FAILED').toUpperCase() }; }
});
handle('spotify:signIn', () => spotify.spotifySignIn());
// The setup wizard: are these keys real (before saving them), is the signed-in account allowed and Premium, and what to do.
handle('spotify:checkKeys', (creds) => spotify.checkCredentials(creds || {}));
handle('spotify:verify', () => spotify.verifyAccount());
handle('spotify:diagnose', (code) => spotify.diagnose(code));
// Electron 44's clipboard reads and writes are async (they may return a promise), so they're awaited.
handle('clipboard:text', async () => String((await clipboard.readText()) || '').trim().slice(0, 200));
handle('spotify:status', () => spotify.status());
handle('spotify:disconnect', () => spotify.disconnect());
handle('spotify:saveCredentials', (c) => spotify.saveCredentials(c));
handle('spotify:accessToken', () => spotify.accessToken());
handle('spotify:albums', (offset) => spotify.savedAlbums(offset));
handle('spotify:playlists', (offset) => spotify.playlists(offset));
handle('spotify:search', (query) => spotify.search(query));
handle('spotify:discTracks', (which) => spotify.discTracks(which));
handle('spotify:play', (request) => spotify.startPlayback(request));
handle('spotify:cover', (url) => spotify.coverDataUrl(url));
handle('spotify:drmReady', () => drmReady());
// The Spotify log: each step of connecting and playing (never a token), in spotify-log.txt in the data folder, so a
// failure on someone's PC can be traced. Each session starts with the app, the system and Widevine's state.
const SPOTIFY_LOG = 'spotify-log.txt', SPOTIFY_LOG_MAX = 256 * 1024;
let spotifyLogStarted = false;
function widevineState() {
  try {
    const all = components && typeof components.status === 'function' ? components.status() : null;
    const wv = all && Object.values(all).find((c) => /widevine/i.test(`${c.title || ''}`));
    return wv ? `${wv.status || '?'} ${wv.version || ''}`.trim() : all ? 'not listed' : 'no components';
  } catch (e) { return `unknown (${e.message})`; }
}
function spotifyLog(text) {
  try {
    const file = store.file(SPOTIFY_LOG);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let head = '';
    if (!spotifyLogStarted) {
      spotifyLogStarted = true;
      head = `\n--- CDPlayer ${APP_VERSION} · ${process.platform} ${process.arch} ${require('os').release()} · Electron ${process.versions.electron} · Widevine ${widevineState()}\n`;
    }
    fs.appendFileSync(file, `${head}${new Date().toISOString()} ${String(text).replace(/[\r\n]+/g, ' ').slice(0, 400)}\n`);
    if (fs.statSync(file).size > SPOTIFY_LOG_MAX) { const all = fs.readFileSync(file); fs.writeFileSync(file, all.subarray(all.length - SPOTIFY_LOG_MAX / 2)); }
  } catch { /* the log is a nicety */ }
}
handle('spotify:log', (text) => spotifyLog(text));
handle('spotify:showLog', () => {
  const file = store.file(SPOTIFY_LOG);
  if (!fs.existsSync(file)) spotifyLog('(log opened before anything was played)');
  shell.showItemInFolder(file);
});
handle('spotify:openDashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));

handle('library:collect', async (items) => { // as the albums play: by folder, disc and track number
  const files = await library.collectAudio(items);
  return library.inAlbumOrder(files, await shelf.trackNumbers(files));
});
handle('library:scan', async () => {
  const folder = store.readLastPath();
  if (!folder || !store.isDir(folder)) return { folder: null, files: [] };
  const result = await library.scanLibrary(folder);
  // What the shelf last read of each file's tags, so a search finds a song by its artist, album or title, not only
  // by its filename, and shows it as "Artist · Title".
  // (Never read yet: the shelf starts reading them now, in the background — this search has filenames, the next tags.)
  if (!shelf.readCache(folder)) shelf.scanAlbums().catch(() => null);
  const read = shelf.readCache(folder) || {}, tags = {};
  for (const p of result.files) {
    const i = read[p] && read[p].info;
    if (i && i.title) tags[p] = { words: [i.artist, i.albumArtist, i.album, i.title, i.year].filter(Boolean).join(' '), shown: i.artist ? `${i.artist} · ${i.title}` : i.title };
  }
  return { folder, name: path.basename(folder), ...result, tags };
});

// Tags: what's in the file, what MusicBrainz says, and writing changes (and found covers and lyrics) into it.
handle('tags:read', (p) => {
  if (!tagWriter.canWrite(p)) return { canWrite: false };
  try { return { canWrite: true, tags: tagWriter.readTags(p) }; } catch { return { canWrite: false }; }
});
handle('tags:lookup', (details) => online.lookupTags(details));
handle('tags:coverFromUrl', (url) => online.coverFromUrl(url));
handle('tags:write', async (p, changes) => {
  const result = await tagWriter.writeTags(p, changes);
  if (result.ok) { metadata.forget(p); shelf.forget(p); }
  return result;
});
// The music folder, watched so an open shelf keeps up with it (library-watch.js); it follows the folder the shelf reads.
const libraryWatch = require('./library-watch').createLibraryWatch({ onChange: () => {
  phoneShelf = null; // the phone remote's list is read again when it's next asked for
  if (win && !win.isDestroyed()) win.webContents.send('library-changed');
} });
const watchMusicFolder = () => { if (!smokeDir) { const f = store.readLastPath(); libraryWatch.start(f && store.isDir(f) ? f : null); } };
// The shelf's albums with plays, dust, notes and shrink-wrap added; the handler and the phone remote both read it.
async function shelfListing() {
  watchMusicFolder();
  const result = await shelf.scanAlbums((done, total) => { if (win && !win.isDestroyed()) win.webContents.send('shelf-progress', { done, total }); });
  // How many times each album's songs have been played, for the shelf's MOST PLAYED order.
  const counts = plays();
  for (const a of result.albums) a.plays = a.tracks.reduce((n, t) => n + (counts.get(t.path) || 0), 0);
  // …and when each was last played or wiped, for its dust.
  const touch = { ...dust(), lastPlayed: playedAt() };
  for (const a of result.albums) a.touched = shelf.touchedAt(a, touch);
  const notes = store.readNotes();
  for (const a of result.albums) a.note = notes.get(a.id) || null;
  // …and which came in shrink-wrap (new since wrapping began, not played yet, not unwrapped by hand).
  const w = wrap();
  for (const a of result.albums) a.wrapped = shelf.isWrapped(a, w);
  result.hiddenMissing = [...store.readHiddenMissing()];
  return result;
}
handle('shelf:albums', () => shelfListing());
// Missing albums (discography.js): each artist's official releases from MusicBrainz, for the artists on screen.
const discography = require('./discography').createDiscography({
  mbFetch: (q) => require('./online').mbFetch(q),
  onAnswer: (answer) => { if (win) win.webContents.send('discography', answer); },
});
handle('discography:want', (artists) => discography.want(Array.isArray(artists) ? artists.slice(0, 200) : []));
handle('discography:tracklist', (groupId) => discography.tracklist(groupId));
// The booklet's "About the album" pages (album-story.js), in the interface's language.
const albumStory = require('./album-story').createAlbumStory({ mbFetch: (q) => online.mbFetch(q), fetchJson: (url, init) => online.fetchJson(url, init), findGroup: (q) => online.musicBrainzAlbum(q) });
// MusicBrainz or Wikipedia busy or out of reach: { unavailable } (nothing's remembered; the booklet asks again).
handle('story:album', (q) => albumStory.storyFor({ ...(q || {}), lang: i18n.current().code }).catch(() => ({ unavailable: true })));
handle('story:open', (url) => { if (/^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\//.test(String(url))) shell.openExternal(url); });
handle('discography:of', (a) => discography.discographyFor({ artist: String((a && a.artist) || ''), mbid: (a && a.mbid) || null }));
// Discogs (discogs.js): an album's pressing and price when its case is opened, the whole shelf when it's appraised.
const discogs = require('./discogs').createDiscogs({ fetchJson: (url, init) => require('./online').fetchJson(url, init), mbFetch: (q) => require('./online').mbFetch(q), userAgent: `CDPlayer/${APP_VERSION} +https://github.com/Kizarov3/CDPlayer` });
const albumQuery = (a) => (a && typeof a === 'object' && typeof a.id === 'string' ? { id: a.id, artist: a.artist || null, title: a.title || null, year: a.year || null, barcode: a.barcode || null, catalog: a.catalog || null, label: a.label || null, mbReleaseId: a.mbReleaseId || null } : null);
const offline = (e) => ({ error: e && e.status ? 'DISCOGS' : 'OFFLINE' });
handle('discogs:lookup', (a) => { const q = albumQuery(a); return q ? discogs.lookup(q).catch(offline) : null; });
handle('discogs:appraise', (list) => discogs.appraise((Array.isArray(list) ? list : []).map(albumQuery).filter(Boolean), (p) => { if (win) win.webContents.send('discogs-progress', p); }));
handle('discogs:stop', () => discogs.stopAppraise());
handle('discogs:versions', (id) => discogs.versions(id).catch(offline));
handle('discogs:search', (a) => { const q = albumQuery(a); return q ? discogs.search(q).catch(offline) : []; });
handle('discogs:choose', (a, id) => { const q = albumQuery(a); return q && Number(id) > 0 ? discogs.choose(q, id).catch(offline) : null; });
handle('discogs:known', (ids) => discogs.known(Array.isArray(ids) ? ids : []));
handle('discogs:notFound', (ids) => discogs.notFound(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : null));
handle('discogs:settings', () => discogs.settings());
handle('discogs:setToken', (token, opts) => discogs.setToken(typeof token === 'string' ? token : null, { paste: !!(opts && opts.paste) }));
handle('discogs:setCurrency', (code) => discogs.setCurrency(code));
handle('discogs:open', (uri) => { if (/^https:\/\/www\.discogs\.com\//.test(String(uri))) shell.openExternal(uri); });
handle('discography:hide', (groupId) => { const hidden = store.readHiddenMissing(); hidden.add(String(groupId)); store.writeHiddenMissing(hidden); });
handle('discography:open', (groupId) => { if (/^[0-9a-f-]{36}$/.test(groupId)) shell.openExternal(`https://musicbrainz.org/release-group/${groupId}`); });
// A search on YouTube Music, in the browser or its app: playing it inside CDPlayer isn't possible within YouTube's rules.
handle('youtubeMusic:open', (query) => { const q = String(query || '').trim().slice(0, 300); if (q) shell.openExternal(`https://music.youtube.com/search?q=${encodeURIComponent(q)}`); });
// Shrink-wrap on new albums: from the first time the shelf was read with it; unwrapped album by album.
let wrapState = null;
function wrap() {
  if (!wrapState) {
    wrapState = store.readWrap();
    if (!wrapState.since) { wrapState.since = Date.now(); store.writeWrap(wrapState); }
  }
  return wrapState;
}
handle('wrap:tear', (id) => { const w = wrap(); if (typeof id === 'string' && !w.torn.has(id)) { w.torn.add(id); store.writeWrap(w); } });
// Dust on the shelf: gathering since the first time the shelf was read with it, wiped album by album.
let dustState = null;
function dust() {
  if (!dustState) {
    dustState = store.readDust();
    if (!dustState.since) { dustState.since = Date.now(); store.writeDust(dustState); }
  }
  return dustState;
}
// A sticky note on an album; an empty one peels it off.
handle('notes:set', (id, text) => {
  const notes = store.readNotes();
  if (text) notes.set(id, text); else notes.delete(id);
  store.writeNotes(notes);
});
handle('dust:wipe', (id) => { const d = dust(), t = Date.now(); d.wiped.set(id, t); store.writeDust(d); return t; });
// LIBRARY CHECK (the shelf): what's wrong in the music folder — from the tags already read (library-check.js), and
// which albums have no cover on this computer. Progress as 'library-check' events.
handle('library:check', async () => {
  const send = (done, total) => { if (win) win.webContents.send('library-check', { done, total }); };
  const scanned = await shelf.scanAlbums(send);
  if (!scanned.folder) return null;
  const cached = shelf.readCache(scanned.folder) || {};
  const issues = require('./library-check').libraryIssues(Object.entries(cached).map(([p, e]) => ({ path: p, info: e.info })));
  const noCover = [];
  let done = 0;
  for (const a of scanned.albums) {
    if (!(await shelf.albumCover(a.tracks[0].path, { online: false, local: true }))) {
      noCover.push({ album: a.title, artist: a.artist, title: a.tracks[0].title, folder: a.folder, paths: a.tracks.map((t) => t.path) });
    }
    if (++done % 20 === 0) send(done, scanned.albums.length);
  }
  return { ...issues, noCover, folder: scanned.folder };
});
handle('shell:showFile', (p) => { if (typeof p === 'string' && fs.existsSync(cue.parseRef(p) ? cue.parseRef(p).cuePath : p)) shell.showItemInFolder(cue.parseRef(p) ? cue.parseRef(p).cuePath : p); });
handle('shelf:cover', (firstTrack, opts) => shelf.albumCover(firstTrack, { online: !(opts && opts.online === false) }));
// The colours the shelf worked out from covers (spines, and SORT: COLOR), kept between launches.
handle('shelf:colors', () => store.readShelfColors());
handle('shelf:saveColors', (colors) => { if (colors && typeof colors === 'object') store.writeShelfColors(colors); });
handle('shelf:coverFull', (firstTrack) => shelf.albumCoverFull(firstTrack));
handle('dialog:pickMusicFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: t('Your Music Folder'), defaultPath: dialogDefaultPath(), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  store.writeLastPath(r.filePaths[0]);
  return r.filePaths[0];
});

function dialogDefaultPath() {
  const last = store.readLastPath();
  return last && store.isDir(last) ? last : app.getPath('music');
}
const audioFilter = () => ({ name: t('Audio files (MP3, M4A, FLAC, WAV, AIFF, AU, OGG, Opus) and CUE sheets'), extensions: [...library.AUDIO_EXTENSIONS, 'cue'] });

handle('dialog:openTracks', async () => {
  // macOS can pick files and folders in one dialog; Windows/Linux dialogs are one or the other, so pick files there
  // (folders can still be dragged onto the window).
  const properties = ['openFile', 'multiSelections'];
  if (process.platform === 'darwin') properties.push('openDirectory');
  const r = await dialog.showOpenDialog(win, { title: t('Load a Track'), defaultPath: dialogDefaultPath(), properties, filters: [audioFilter()] });
  if (r.canceled || !r.filePaths.length) return [];
  const first = r.filePaths[0];
  store.writeLastPath(store.isDir(first) && r.filePaths.length === 1 ? first : path.dirname(first));
  return r.filePaths;
});
handle('dialog:savePlaylist', async (entries) => {
  const r = await dialog.showSaveDialog(win, { title: t('Save Playlist'), defaultPath: path.join(dialogDefaultPath(), 'playlist.m3u'), filters: [{ name: t('Playlist (M3U)'), extensions: ['m3u', 'm3u8'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  let target = r.filePath;
  if (!/\.m3u8?$/i.test(target)) target += '.m3u';
  try {
    fs.writeFileSync(target, library.formatM3u(entries), 'utf8');
    store.writeLastPath(path.dirname(target));
    return { ok: true, name: path.basename(target) };
  } catch { return { ok: false }; }
});
handle('dialog:loadPlaylist', async () => {
  const r = await dialog.showOpenDialog(win, { title: t('Load Playlist'), defaultPath: dialogDefaultPath(), properties: ['openFile'], filters: [{ name: t('Playlist (M3U)'), extensions: ['m3u', 'm3u8'] }] });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const source = r.filePaths[0];
  store.writeLastPath(path.dirname(source));
  try { return { tracks: library.parseM3u(fs.readFileSync(source, 'utf8'), source), name: path.basename(source).replace(/\.m3u8?$/i, '') }; } catch { return { error: true }; }
});
handle('dialog:importLibrary', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: t('Import Library'), defaultPath: dialogDefaultPath(), properties: ['openFile'],
    filters: [{ name: t('Library export (iTunes XML, Spotify CSV/JSON)'), extensions: ['xml', 'csv', 'json'] }],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const source = r.filePaths[0];
  try {
    const text = fs.readFileSync(source, 'utf8');
    const ext = path.extname(source).toLowerCase();
    if (ext === '.xml') return { kind: 'itunes', tracks: library.parseItunesLibrary(text) };
    return { kind: 'spotify', tracks: ext === '.json' ? library.parseSpotifyJson(text) : library.parseSpotifyCsv(text) };
  } catch { return { error: true }; }
});

// ---- Mini player -------------------------------------------------------------------------------------------------
// A separate small frameless window, like Apple Music's mini player. The main window keeps doing all the playing
// (it's just hidden); the mini window is a remote control that mirrors its state over IPC.

function miniPositionOnScreen(p) {
  return p && screen.getAllDisplays().some(({ workArea: a }) => p.x >= a.x - MINI.width / 2 && p.x <= a.x + a.width - MINI.width / 2 && p.y >= a.y && p.y <= a.y + a.height - 40);
}
function readMiniPosition() {
  const parts = (store.readText(store.FILES.miniPosition) || '').trim().split(',').map((v) => parseInt(v, 10));
  const saved = parts.length === 2 && parts.every(Number.isFinite) ? { x: parts[0], y: parts[1] } : null;
  if (miniPositionOnScreen(saved)) return saved;
  // First time: top-right corner of whichever display the main window is on.
  const { workArea: a } = screen.getDisplayMatching(win ? win.getBounds() : { x: 0, y: 0, width: 1, height: 1 });
  return { x: a.x + a.width - MINI.width - 24, y: a.y + 24 };
}

function createMiniWindow() {
  const mac = process.platform === 'darwin';
  miniWin = new BrowserWindow({
    ...MINI, ...readMiniPosition(),
    frame: false,
    resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    roundedCorners: true,
    transparent: true,
    backgroundColor: '#00000000',
    // macOS: the frosted, translucent material Apple Music's mini player uses. Elsewhere the page paints its own panel.
    vibrancy: mac ? 'hud' : undefined,
    visualEffectState: 'active',
    title: 'CDPlayer',
    icon: process.platform === 'linux' ? path.join(__dirname, '..', 'renderer', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false,
    },
  });
  miniWin.setAlwaysOnTop(true, 'floating');
  // (On macOS this would make CDPlayer a background app with no Dock icon — for good, even after the mini player: kept.)
  miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  miniWin.on('moved', () => {
    const [x, y] = miniWin.getPosition();
    store.writeText(store.FILES.miniPosition, `${x},${y}`);
  });
  // Closing the mini player (Cmd+W, or from the taskbar) goes back to the full window rather than quitting.
  miniWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (win) win.webContents.send('mini-command', { action: 'exit' });
  });
  miniWin.on('closed', () => { miniWin = null; });
  miniWin.webContents.on('will-navigate', (e) => e.preventDefault());
  miniWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const ready = new Promise((resolve) => miniWin.webContents.once('did-finish-load', resolve));
  miniWin.loadURL('cdp://app/mini.html');
  return ready;
}

handle('win:setMiniMode', async (enabled) => {
  if (!win || enabled === miniMode) return;
  miniMode = enabled;
  if (enabled) {
    if (win.isFullScreen()) {
      await new Promise((resolve) => { win.once('leave-full-screen', resolve); win.setFullScreen(false); setTimeout(resolve, 1500); });
    }
    if (!miniWin) await createMiniWindow();
    miniWin.setPosition(...Object.values(readMiniPosition()));
    miniWin.show();
    win.hide();
  } else {
    win.show();
    win.focus();
    if (miniWin) miniWin.hide();
  }
  persistSettings();
});
// Main window → mini player: the state to show. Mini player → main window: what the user pressed.
ipcMain.on('mini:state', (_e, s) => { if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('mini-state', s); });
ipcMain.on('mini:command', (_e, c) => { if (win) win.webContents.send('mini-command', c); });
ipcMain.on('discord:track', (_e, track) => { if (!smokeDir) discord.setTrack(track); });

// ---- Phone remote ------------------------------------------------------------------------------------------------
// Settings → PHONE REMOTE, off unless turned on (and never in a smoke test): a small server on one home-network address
// (remote.js) that a phone pairs with by the QR code. The phone's state and commands go by the player's page, as the
// mini player's do. remote.json keeps { on, token, port, address }; the token never leaves main but inside the QR's
// address, given to Settings.
const os = require('os');
const remoteNet = require('./remote-net');
const remoteWiring = require('./remote-wiring');
const remoteShelf = require('./remote-shelf');
const { createRemote } = require('./remote');
const REMOTE_WATCH_MS = 10000, REMOTE_REPLY_MS = 5000;
let remoteConf = remoteWiring.readRemoteConf(store.readText(store.FILES.remote));
let remote = null; // the server, while it runs
let remoteAt = null; // { address, port } it runs on
let remoteError = null; // on, but not running: 'network' (no home-network address to offer) or 'port' (refused)
let remoteAddresses = []; // the addresses that could be offered, as last looked at
let remoteWatch = null; // the address checked every 10 s, while on
let remoteKept = { state: null, cover: null }; // the page's last full state for the phone, and the cover playing now
let remotePhones = [];
let remoteSeen = 0; // when a phone was last connected (the PC stays awake 30 minutes after)
let remoteBlocker = null; // the powerSaveBlocker's id, while it keeps the PC awake
let remoteWork = Promise.resolve(); // starts and stops, one at a time
let phoneShelf = null; // { folder, data: a promise of the shelf's { albums, byKey } } for the phone, read from `folder`

const saveRemoteConf = () => store.writeText(store.FILES.remote, JSON.stringify(remoteConf));
const pageAlive = () => !!win && !win.isDestroyed() && !win.webContents.isCrashed();
const toPage = (channel, ...args) => { if (pageAlive()) win.webContents.send(channel, ...args); };
const remoteDo = (fn) => (remoteWork = remoteWork.then(fn).catch((e) => console.error(`Phone remote: ${e && e.message}`)));
const lookAtAddresses = () => (remoteAddresses = remoteNet.pickAddresses(os.networkInterfaces()));

function remoteStatus() {
  const at = remote ? remoteAt : null;
  return {
    on: remoteConf.on,
    url: at ? `http://${at.address}:${at.port}/pair?k=${remoteConf.token}` : null,
    address: at ? at.address : null,
    addresses: remoteAddresses,
    port: at ? at.port : null,
    phones: remotePhones,
    error: remoteConf.on && !remote ? remoteError : null,
  };
}
let sentRemoteStatus = null;
function sendRemoteStatus() {
  const status = remoteStatus(), text = JSON.stringify(status);
  if (text === sentRemoteStatus) return;
  sentRemoteStatus = text;
  toPage('remote-status', status);
}

// The PC kept awake while the remote is on and a phone is connected or was in the last 30 minutes (a locked phone drops
// its connection; playing music keeps the PC up anyway).
function remoteKeepAwake() {
  const want = remoteWiring.keepAwake({ on: remoteConf.on, phones: remotePhones.length, lastSeen: remoteSeen, now: Date.now() });
  if (want && remoteBlocker === null) remoteBlocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (!want && remoteBlocker !== null) { powerSaveBlocker.stop(remoteBlocker); remoteBlocker = null; }
}
function phonesChanged(list) {
  if (list.length || remotePhones.length) remoteSeen = Date.now();
  remotePhones = list;
  remoteKeepAwake();
  sendRemoteStatus();
}

// The shelf as the phone sees it: read as the desktop shelf reads it, then kept while it's the same music folder and
// nothing in it has changed (another folder picked: read again, so a key never plays the old folder's songs).
function phoneShelfData() {
  const folder = store.readLastPath();
  const kept = remoteWiring.shelfCacheFor(phoneShelf, folder);
  if (kept) return kept;
  const reading = shelfListing().then((r) => ({ albums: r.albums, byKey: remoteShelf.byKey(r.albums) }));
  const entry = { folder, data: reading };
  phoneShelf = entry;
  reading.catch(() => { if (phoneShelf === entry) phoneShelf = null; });
  return reading;
}
async function phoneCover(key) {
  const album = (await phoneShelfData()).byKey.get(key);
  if (!album || !album.tracks.length) return null;
  // What's on this computer, or was found online before — the phone's scrolling never sends the web a search, nor
  // pushes the desktop shelf's thumbnails out of their cache (the phone keeps its covers itself, for a day).
  return remoteWiring.dataUrlBytes(await shelf.albumCover(album.tracks[0].path, { online: false, cached: true, keep: false }));
}

// The phone's commands go to the page, each answered by its id (none within 5 s: busy). An album's key is turned into
// the shelf album here, paths and all; a key that names none any more is answered here.
const pageReplies = remoteWiring.createReplies({
  timeoutMs: REMOTE_REPLY_MS,
  send: (id, cmd) => { if (!pageAlive()) return false; win.webContents.send('remote-command', { id, cmd }); return true; },
});
async function phoneCommand(cmd) {
  if (cmd.action === 'album') {
    const { byKey } = await phoneShelfData();
    cmd = remoteWiring.albumCommand(cmd, byKey.get(cmd.value.id));
    if (!cmd) return { error: 'gone' };
  }
  return pageReplies.ask(cmd);
}
ipcMain.on('remote:reply', (e, id, result) => { if (win && e.sender === win.webContents) pageReplies.reply(id, result); });
// The page's states: full ones (with `rev`) kept without their cover, which is kept apart for /cover/now; where the
// song is, merged into the last full one. Each goes to the phones as it comes.
ipcMain.on('remote:state', (e, s) => {
  if (!remoteConf.on || !win || e.sender !== win.webContents) return;
  const next = remoteWiring.nextRemoteState(remoteKept, s);
  remoteKept = { state: next.state, cover: next.cover };
  if (remote && next.state) remote.broadcast(next.state);
});
// The page gone (a crash): the phones get 503 until it's back and has sent a fresh state.
function phonePageGone() {
  remoteKept = { state: null, cover: null };
  pageReplies.failAll({ error: 'busy' });
  if (remote) remote.setDown(true);
}
function phonePageBack() {
  if (!remote) return;
  remote.setDown(false);
  toPage('remote-listening', true); // the page sends its full state at once
}

function newRemoteServer(address, port) {
  return createRemote({
    address, port, token: remoteConf.token, files: {},
    snapshot: () => remoteKept.state,
    command: phoneCommand,
    albums: async () => remoteShelf.phoneAlbums((await phoneShelfData()).albums, store.readShelfColors()),
    album: async (key) => { const a = (await phoneShelfData()).byKey.get(key); return a ? remoteShelf.phoneAlbum(a) : null; },
    coverFor: phoneCover,
    nowCover: () => remoteKept.cover,
    onPhones: phonesChanged,
    log: (text) => console.error(text),
  });
}
// On the address kept while it's still offered, else the first offered; on the port kept, or one the system picks
// when that's taken — both then kept.
async function startRemote() {
  if (remote || !remoteConf.on || smokeDir) return;
  const list = lookAtAddresses();
  const address = remoteNet.addressChanged(remoteConf.address, list) || (list.length ? remoteConf.address : null);
  if (!address) { remoteError = 'network'; return; }
  let server = newRemoteServer(address, remoteConf.port), port;
  try {
    ({ port } = await server.start());
  } catch (e) {
    if (e.code !== 'EADDRINUSE') { remoteError = e.code === 'EADDRNOTAVAIL' ? 'network' : 'port'; console.error(`Phone remote: ${e.message}`); return; }
    server = newRemoteServer(address, 0);
    try { ({ port } = await server.start()); } catch (e2) { remoteError = 'port'; console.error(`Phone remote: ${e2.message}`); return; }
  }
  remote = server; remoteAt = { address, port }; remoteError = null;
  remoteConf = { ...remoteConf, address, port };
  saveRemoteConf();
  toPage('remote-listening', true);
}
// `quiet`: the phones aren't told it closed — they try again, and find they must scan the new code (NEW CODE, a new
// address). Otherwise they're told why: 'off' or 'quit'.
async function stopRemote(reason, { quiet = false } = {}) {
  const server = remote;
  remote = null; remoteAt = null;
  if (!server) return;
  if (quiet) server.disconnectAll();
  await server.stop(reason);
}
function watchRemote() {
  remoteDo(async () => {
    if (!remoteConf.on) return;
    // The address it's on (or, not running, the one kept) gone: on the first one offered now. Not running with an
    // address offered (the network back, a port refused before): tried again.
    const list = lookAtAddresses();
    const move = remoteNet.addressChanged(remoteAt ? remoteAt.address : remoteConf.address, list);
    if (move) {
      await stopRemote('off', { quiet: true });
      remoteConf = { ...remoteConf, address: move };
      await startRemote();
    } else if (!remote && list.length) {
      await startRemote();
    }
    remoteKeepAwake();
    sendRemoteStatus();
  });
}
async function turnRemoteOn() {
  if (smokeDir) return;
  if (!remoteConf.on || !remoteConf.token) {
    remoteConf = { ...remoteConf, on: true, token: remoteConf.token || remoteNet.newToken() };
    saveRemoteConf();
  }
  if (!remoteWatch) remoteWatch = setInterval(watchRemote, REMOTE_WATCH_MS);
  await startRemote();
  remoteKeepAwake();
  sendRemoteStatus();
}
async function turnRemoteOff() {
  if (remoteConf.on) { remoteConf = { ...remoteConf, on: false }; saveRemoteConf(); }
  clearInterval(remoteWatch); remoteWatch = null;
  await stopRemote('off');
  remoteKept = { state: null, cover: null }; remoteError = null; remotePhones = [];
  toPage('remote-listening', false);
  remoteKeepAwake();
  sendRemoteStatus();
}
handle('remote:status', () => { lookAtAddresses(); return remoteStatus(); });
handle('remote:set', (on) => remoteDo(() => (on === true ? turnRemoteOn() : turnRemoteOff())).then(remoteStatus));
// Another of the offered addresses, picked in Settings (the phones scan the code again).
handle('remote:address', (address) => remoteDo(async () => {
  if (!lookAtAddresses().some((e) => e.address === address)) return;
  remoteConf = { ...remoteConf, address };
  saveRemoteConf();
  if (remote && remoteAt.address !== address) { await stopRemote('off', { quiet: true }); await startRemote(); }
  sendRemoteStatus();
}).then(remoteStatus));
// NEW CODE: a new token, and a new server with it — every phone's cookie stops working, so each must scan again.
handle('remote:newCode', () => remoteDo(async () => {
  remoteConf = { ...remoteConf, token: remoteNet.newToken() };
  saveRemoteConf();
  if (remote) { await stopRemote('off', { quiet: true }); await startRemote(); }
  sendRemoteStatus();
}).then(remoteStatus));
handle('win:toggleFullscreen', () => { if (win && !miniMode) win.setFullScreen(!win.isFullScreen()); });
handle('win:isFullscreen', () => !!(win && win.isFullScreen()));
// The newest release the last check found (with this system's file), and its download once one has started.
let latestUpdate = null;
let updateDownload = null; // { version, plan, promise → file }
handle('updates:check', async () => {
  if (smokeDir) return null;
  const update = await updates.checkForUpdate(APP_VERSION);
  if (update && update.offline) return update;
  latestUpdate = update;
  return update && { version: update.version, canDownload: !!update.asset };
});
handle('updates:openReleases', () => shell.openExternal(updates.RELEASES_PAGE));
// Downloads the latest release's file (once — asking again while it's coming or done gets the same one). Progress goes
// to the window as 'update-progress' (0…1). → { version, install: 'replace' | 'open' }.
handle('updates:download', async () => {
  const update = latestUpdate;
  if (!update || !update.asset) throw new Error('no update to download');
  if (!updateDownload || updateDownload.version !== update.version) {
    const plan = app.isPackaged ? updates.installPlan() : { kind: 'open' }; // never swap out node_modules' Electron
    const promise = updates.downloadAsset(update.asset, updates.downloadDir(plan, app.getPath('downloads')),
      (fraction) => { if (win) win.webContents.send('update-progress', fraction); });
    updateDownload = { version: update.version, plan, promise };
    promise.catch(() => { if (updateDownload && updateDownload.promise === promise) updateDownload = null; });
  }
  await updateDownload.promise;
  return { version: updateDownload.version, install: updateDownload.plan.kind };
});
// Puts the downloaded release in place and restarts into it — or, where this copy can't be replaced, opens the disk
// image (macOS) or shows the file (Windows, Linux) for the person to take from there.
handle('updates:install', async () => {
  if (!updateDownload) return false;
  const { plan, promise } = updateDownload;
  const file = await promise;
  if (plan.kind === 'replace') {
    await updates.startInstaller(process.platform, { pid: process.pid, file, target: plan.target });
    app.quit();
  } else if (process.platform === 'darwin') {
    await shell.openPath(file);
  } else {
    shell.showItemInFolder(file);
  }
  return true;
});
// Text for the user to paste elsewhere (the Spotify dashboard's Redirect URI). Only short plain text.
handle('clipboard:write', async (text) => { if (typeof text === 'string' && text.length <= 2000) await clipboard.writeText(text); return true; });
handle('shell:openGitHub', (user) => { if (/^[A-Za-z0-9-]+$/.test(user)) shell.openExternal(`https://github.com/${user}`); });

// ---- Audio CDs ---------------------------------------------------------------------------------------------------
// Every few seconds: which audio CDs are in a drive. A new one is named from MusicBrainz (in the background) and the
// window hears about it — first as it is, then again once it has names; a disc that's gone is reported gone.

const discs = new Map(); // mount -> { disc, named, naming }
const discMessage = ({ disc, named, naming }) => ({
  mount: disc.mount, id: disc.id, tracks: disc.tracks, name: disc.name,
  album: named ? named.album : null, artist: named ? named.artist : null, year: named ? named.year : null,
  ready: !naming, // MusicBrainz has answered (or couldn't): ripping now uses the names
});
let polling = false;
async function pollDiscs() {
  if (polling) return; // the last check is still going (a slow drive): skip this one rather than queue behind it
  polling = true;
  try { await checkDiscs(); } finally { polling = false; }
}
async function checkDiscs() {
  const now = await audioCd.findDiscs().catch(() => []);
  const seen = new Set(now.map((d) => d.mount));
  for (const [mount, entry] of discs) {
    if (seen.has(mount) && entry.disc.id === (now.find((d) => d.mount === mount) || {}).id) continue;
    discs.delete(mount);
    audioCd.forgetDisc(entry.disc);
    if (ripping && ripping.mount === mount) { ripping.gone = true; ripping.controller.abort(); } // taken out mid-rip
    if (win) win.webContents.send('audio-cd-gone', { mount, tracks: entry.disc.tracks });
  }
  for (const disc of now) {
    if (discs.has(disc.mount)) continue;
    const entry = { disc, named: null, naming: true };
    discs.set(disc.mount, entry);
    if (win) win.webContents.send('audio-cd', discMessage(entry));
    audioCd.nameDisc(disc, {
      isCurrent: () => discs.get(disc.mount) === entry,
      fetchMb: online.mbFetch,
      fetchCover: (releaseId) => online.coverFromUrl(`https://coverartarchive.org/release/${releaseId}/front-500`),
    }).then((named) => {
      if (!named || discs.get(disc.mount) !== entry) return;
      entry.named = named;
      for (const p of disc.tracks) metadata.forget(p);
    }).catch(() => {}).finally(() => {
      if (discs.get(disc.mount) !== entry) return;
      entry.naming = false;
      if (win) win.webContents.send('audio-cd', discMessage(entry));
    });
  }
}
handle('cd:list', () => [...discs.values()].map(discMessage));
// The real drive's eject, for when the tray is opened on a CD that's in it.
handle('cd:eject', (mount) => {
  if (!discs.has(mount)) return false;
  if (process.platform === 'darwin') execFile('diskutil', ['eject', mount], () => {});
  else if (process.platform === 'linux') execFile('gio', ['mount', '-e', mount], () => {});
  else if (process.platform === 'win32') require('./win-cd').eject(mount).catch(() => {});
  return true;
});

// ---- Ripping ------------------------------------------------------------------------------------------------------
// RIP: the disc in the drive saved into the music folder as FLAC (rip.js). One rip at a time; taking the disc out, or
// RIP clicked again, stops it.
let ripping = null; // { mount, controller }
handle('rip:start', async (mount) => {
  const entry = discs.get(mount);
  if (!entry || ripping) return { ok: false, reason: 'busy' };
  if (entry.naming) return { ok: false, reason: 'naming' }; // (the button waits for this too)
  let musicFolder = store.readLastPath();
  if (!musicFolder || !store.isDir(musicFolder)) {
    const r = await dialog.showOpenDialog(win, { title: t('Your Music Folder'), defaultPath: dialogDefaultPath(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return { ok: false, reason: 'cancelled' };
    musicFolder = r.filePaths[0];
    store.writeLastPath(musicFolder);
  }
  const { disc, named } = entry;
  const first = audioCd.detailsFor(disc.tracks[0]) || {};
  const album = {
    album: named ? named.album : null, albumArtist: first.albumArtist || (named && named.artist) || null, artist: named ? named.artist : null,
    year: named ? named.year : null, releaseId: first.releaseId || null, cover: first.cover || null, discId: disc.id,
  };
  const tracks = disc.tracks.map((p, i) => {
    const d = audioCd.detailsFor(p) || {};
    return { path: p, title: d.title || null, artist: d.artist || null, number: d.track || i + 1, disc: d.disc || 1, discs: d.discs || 1 };
  });
  // Asked only when this rip's own files are there — disc 2 of a set shares disc 1's folder without replacing it.
  const folder = rip.albumFolder(musicFolder, album), already = rip.existingTargets(musicFolder, album, tracks);
  if (already.length) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: [t('Replace'), t('Cancel')], defaultId: 1, cancelId: 1,
      message: album.album ? t('{album} is already in your music folder.', { album: album.album }) : t('This disc is already in your music folder.'),
      detail: already.length === 1 ? t('Replace its track in {folder} with this rip?', { folder }) : t('Replace its {n} tracks in {folder} with this rip?', { n: already.length, folder }),
    });
    if (response !== 0) return { ok: false, reason: 'cancelled' };
  }
  const controller = new AbortController(), current = { mount, controller, gone: false };
  ripping = current;
  try {
    const result = await rip.ripDisc({
      tracks, album, musicFolder, signal: controller.signal,
      onProgress: (p) => { if (win) win.webContents.send('rip-progress', { ...p, folder }); },
    });
    lastRipFolder = result.folder;
    return { ok: true, folder: result.folder, album: album.album };
  } catch (e) {
    const reason = current.gone ? 'disc-removed' : e.reason || 'failed';
    return { ok: false, reason, message: reason === 'failed' ? e.message : null };
  } finally { ripping = null; }
});
handle('rip:cancel', () => { if (ripping) ripping.controller.abort(); return true; });
// The rip panel's SHOW IN FOLDER: the folder the last rip wrote (and nothing else).
let lastRipFolder = null;
handle('rip:showFolder', () => (lastRipFolder ? shell.openPath(lastRipFolder) : null));

// ---- Windows Start menu shortcut ----------------------------------------------------------------------------------
// Without a Start menu shortcut carrying the app's ID, Windows can't tell whose media session it is and shows
// "Unknown app" in its media controls. The portable .exe installs nothing, so the app keeps this one shortcut up to
// date itself — which also makes taskbar pins launch the real .exe, not the temporary copy it runs from.
function registerWindowsShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged || smokeDir || process.env.CDPLAYER_HOME) return;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'CDPlayer.lnk');
  try {
    const existing = fs.existsSync(link) ? shell.readShortcutLink(link) : null;
    if (existing && existing.target === exe && existing.appUserModelId === APP_ID) return;
    shell.writeShortcutLink(link, existing ? 'replace' : 'create', {
      target: exe, cwd: path.dirname(exe), appUserModelId: APP_ID, icon: exe, iconIndex: 0, description: 'CDPlayer',
    });
  } catch { /* best effort — only the media controls' app name depends on it */ }
}
// Per-disc taskbar IDs earlier builds left in the registry (see win-taskbar-disc.js).
function cleanUpTaskbarIds() {
  if (taskbarDisc) taskbarDisc.cleanUp().catch(() => {});
}

// ---- Lifecycle --------------------------------------------------------------------------------------------------

app.whenReady().then(() => {
  i18n.loadLocale(settings.language, app.getPreferredSystemLanguages());
  protocol.handle('cdp', media.handle);
  registerWindowsShortcut();
  cleanUpTaskbarIds();
  buildMenu();
  createWindow();
  watchMusicFolder();
  if (remoteConf.on && !smokeDir && gotLock) remoteDo(turnRemoteOn); // (a second launch, handing over to the first, never)
  if (!smokeDir && (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32' || process.env.CDPLAYER_CD_ROOT)) {
    setTimeout(pollDiscs, 1500);
    setInterval(pollDiscs, 3000);
  }
  app.on('activate', () => {
    if (!win) createWindow();
    else if (miniMode && miniWin) miniWin.show();
    else win.show();
  });
});
let restoredRate = false;
app.on('before-quit', (e) => {
  quitting = true;
  if (playsTimer) { clearTimeout(playsTimer); writePlays(); }
  libraryWatch.stop();
  if (restoredRate || smokeDir || !gotLock) return;
  if (!outputRate.pending()) { outputRate.restore({ final: true }).catch(() => {}); return; } // nothing to put back: quit now, and no more switching
  e.preventDefault();
  restoredRate = true;
  // a helper call can take 5 s, so the cap is longer; the final restore also stops any later switch
  Promise.race([outputRate.restore({ final: true }), new Promise((r) => setTimeout(r, 8000))]).catch(() => {}).finally(() => app.quit());
});
// The phones are told CDPlayer closed.
app.on('will-quit', () => {
  clearInterval(remoteWatch); remoteWatch = null;
  if (remote) { remote.stop('quit'); remote = null; }
});
app.on('window-all-closed', () => app.quit());
