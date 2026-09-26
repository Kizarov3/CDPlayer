'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, screen, shell, Menu, nativeTheme } = require('electron');
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
const metadata = require('./metadata');
const online = require('./online');
const library = require('./library');
const media = require('./media-protocol');
const updates = require('./updates');
const discord = require('./discord');
const cue = require('./cue');

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
if (!smokeDir && !app.requestSingleInstanceLock()) {
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
    try { win.webContents.send('app-closing'); } catch { /* already gone */ }
    persistSettings();
  });
  win.on('closed', () => { win = null; if (miniWin && !miniWin.isDestroyed()) { quitting = true; miniWin.close(); } });
  win.once('ready-to-show', () => { if (!smokeDir) win.show(); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-finish-load', () => {
    if (smokeDir) { runSmokeTest(); return; }
    if (pendingOpenFiles.length) { win.webContents.send('open-files', pendingOpenFiles.splice(0)); }
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
  const allOk = results.length > 0 && results.every((r) => r.ok);
  process.stdout.write(`${JSON.stringify({ platform: process.platform, arch: process.arch, allOk, results }, null, 2)}\n`);
  app.exit(allOk ? 0 : 1);
}

function buildMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ]));
}

// ---- IPC ------------------------------------------------------------------------------------------------------

const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

handle('state:load', () => ({
  settings,
  queue: store.readQueue(),
  history: store.readHistory(),
  eqPresets: store.readEqPresets(),
  lastPath: store.readLastPath(),
  onboarded: store.isOnboarded(),
  lastVersion: store.readLastVersion(),
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

handle('fs:exists', (p) => cue.entryExists(p));
handle('meta:details', (p, opts) => metadata.getDetails(p, opts));
handle('online:cover', (query) => online.findCover(query));
handle('online:lyrics', (details) => online.findLyrics(details));
handle('spotify:classify', (text) => online.classifySpotifyLink(text));
handle('spotify:resolve', async (text) => {
  try { return await online.resolveSpotifyLink(text); } catch (e) { return { error: (e.message || 'LOOKUP FAILED').toUpperCase() }; }
});
handle('spotify:signIn', () => online.spotifySignIn());

handle('library:collect', async (items) => (await library.collectAudio(items)).sort(library.byName));
handle('library:scan', async () => {
  const folder = store.readLastPath();
  if (!folder || !store.isDir(folder)) return { folder: null, files: [] };
  return { folder, name: path.basename(folder), ...(await library.scanLibrary(folder)) };
});

function dialogDefaultPath() {
  const last = store.readLastPath();
  return last && store.isDir(last) ? last : app.getPath('music');
}
const AUDIO_FILTER = { name: 'Audio files (MP3, M4A, FLAC, WAV, AIFF, AU, OGG, Opus) and CUE sheets', extensions: [...library.AUDIO_EXTENSIONS, 'cue'] };

handle('dialog:openTracks', async () => {
  // macOS can pick files and folders in one dialog; Windows/Linux dialogs are one or the other, so pick files there
  // (folders can still be dragged onto the window).
  const properties = ['openFile', 'multiSelections'];
  if (process.platform === 'darwin') properties.push('openDirectory');
  const r = await dialog.showOpenDialog(win, { title: 'Load a Track', defaultPath: dialogDefaultPath(), properties, filters: [AUDIO_FILTER] });
  if (r.canceled || !r.filePaths.length) return [];
  const first = r.filePaths[0];
  store.writeLastPath(store.isDir(first) && r.filePaths.length === 1 ? first : path.dirname(first));
  return r.filePaths;
});
handle('dialog:savePlaylist', async (entries) => {
  const r = await dialog.showSaveDialog(win, { title: 'Save Playlist', defaultPath: path.join(dialogDefaultPath(), 'playlist.m3u'), filters: [{ name: 'Playlist (M3U)', extensions: ['m3u', 'm3u8'] }] });
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
  const r = await dialog.showOpenDialog(win, { title: 'Load Playlist', defaultPath: dialogDefaultPath(), properties: ['openFile'], filters: [{ name: 'Playlist (M3U)', extensions: ['m3u', 'm3u8'] }] });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const source = r.filePaths[0];
  store.writeLastPath(path.dirname(source));
  try { return { tracks: library.parseM3u(fs.readFileSync(source, 'utf8'), source) }; } catch { return { error: true }; }
});
handle('dialog:importLibrary', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import Library', defaultPath: dialogDefaultPath(), properties: ['openFile'],
    filters: [{ name: 'Library export (iTunes XML, Spotify CSV/JSON)', extensions: ['xml', 'csv', 'json'] }],
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
  miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
handle('win:toggleFullscreen', () => { if (win && !miniMode) win.setFullScreen(!win.isFullScreen()); });
handle('win:isFullscreen', () => !!(win && win.isFullScreen()));
handle('updates:check', () => (smokeDir ? null : updates.checkForUpdate(APP_VERSION)));
handle('updates:openReleases', () => shell.openExternal(updates.RELEASES_PAGE));
handle('shell:openGitHub', (user) => { if (/^[A-Za-z0-9-]+$/.test(user)) shell.openExternal(`https://github.com/${user}`); });

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

// ---- Lifecycle --------------------------------------------------------------------------------------------------

app.whenReady().then(() => {
  protocol.handle('cdp', media.handle);
  registerWindowsShortcut();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (!win) createWindow();
    else if (miniMode && miniWin) miniWin.show();
    else win.show();
  });
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
