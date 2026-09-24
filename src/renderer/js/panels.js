// In-window panels (Settings, Equalizer, Lyrics, History, Search, the theme picker, the welcome and What's New
// dialogs). Each is a dimmed full-window layer that blocks clicks/drops/shortcuts to the player behind it, with a
// centered card that grows and fades in, and shrinks and fades out.
import { THEMES } from './theme.js';
import { EQ_FREQUENCIES } from './audio.js';
import { el, pill, toggle, setToggle, Slider, anim } from './widgets.js';
import { catSvg } from './glyphs.js';

const layer = () => document.getElementById('overlays');
const panels = new Map(); // name -> { overlay, card, build }
// Escape closes the closest thing first, in this order.
const ESC_ORDER = ['onboarding', 'changelog', 'theme-menu', 'lyrics', 'eq', 'history', 'search', 'settings'];

function openPanel(name, build, { width } = {}) {
  let p = panels.get(name);
  if (!p) {
    const card = el('div', { class: 'card' });
    if (width) card.style.width = `${width}px`;
    const overlay = el('div', { class: 'overlay' }, card);
    overlay.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; });
    p = { overlay, card, build };
    panels.set(name, p);
    layer().append(overlay);
  } else {
    p.build = build;
    p.overlay.classList.remove('closing');
    layer().append(p.overlay); // bring to front
  }
  p.card.replaceChildren(...[build()].flat(Infinity));
  return p;
}
function closePanel(name) {
  const p = panels.get(name);
  if (!p) return;
  panels.delete(name);
  if (p.onClose) p.onClose();
  if (!anim.enabled) { p.overlay.remove(); return; }
  p.overlay.classList.add('closing');
  p.card.addEventListener('animationend', () => p.overlay.remove(), { once: true });
  setTimeout(() => p.overlay.remove(), 300);
}
function refreshPanel(name) {
  const p = panels.get(name);
  if (!p) return;
  const scrollers = [...p.card.querySelectorAll('.scroll')].map((s) => s.scrollTop);
  p.card.replaceChildren(...[p.build()].flat(Infinity));
  p.card.style.animation = 'none';
  p.card.querySelectorAll('.scroll').forEach((s, i) => { s.scrollTop = scrollers[i] || 0; });
}
export const isOpen = (name) => panels.has(name);
export const anyOpen = () => panels.size > 0 || !!themeMenu;
export function closeTopmost(app) {
  for (const name of ESC_ORDER) {
    if (name === 'theme-menu') { if (themeMenu) { closeThemeMenu(app); return true; } continue; }
    if (panels.has(name)) { closePanel(name); return true; }
  }
  return false;
}

const title = (text) => el('h1', {}, text);
const closeRow = (onClick, caption = 'CLOSE') => el('div', { class: 'close-row' }, pill(caption, onClick));
const gap = (h = 22) => { const d = el('div', { class: 'gap-22' }); d.style.height = `${h}px`; return d; };
const hint = (text) => el('div', { class: 'setting-hint' }, text);
function row(label, control) { return el('div', { class: 'setting-row' }, el('span', {}, label), control); }
function sliderRow(label, slider, valueLabel) {
  const wrap = el('div', { class: 'slider' });
  const r = el('div', { class: 'setting-row slider-row' }, el('span', { class: 'row-label' }, label), wrap, valueLabel);
  requestAnimationFrame(() => slider.mount(wrap));
  return r;
}

// ---- Settings ----------------------------------------------------------------------------------------------------

let themeButton = null;
export function updateThemeButton(app, name) { if (themeButton) themeButton.textContent = name; }

export function showSettings(app) {
  openPanel('settings', () => buildSettings(app));
}
export function refreshSettingsIfOpen(app) { if (isOpen('settings')) refreshPanel('settings'); }

function buildSettings(app) {
  const s = app.state;
  themeButton = pill(THEMES[s.themeIndex].name, () => showThemeMenu(app));
  const eqButton = pill('EQ', () => showEq(app));

  const crossfadeValue = el('span', { class: 'row-value' }, s.crossfade ? `${s.crossfade}S` : 'OFF');
  const crossfade = new Slider({ min: 0, max: 15, value: s.crossfade, onInput: (v) => { crossfadeValue.textContent = v ? `${v}S` : 'OFF'; app.setCrossfade(v); } });
  crossfade.canvas.title = 'Crossfade between tracks (0 = off, up to 15s)';

  // Arms a one-shot countdown from now, only once the drag settles — not on every intermediate value.
  const sleepValue = el('span', { class: 'row-value' }, s.sleepMinutes ? `${s.sleepMinutes}M` : 'OFF');
  const sleep = new Slider({
    min: 0, max: 120, value: s.sleepRemaining > 0 ? s.sleepMinutes : 0,
    onInput: (v) => { sleepValue.textContent = v ? `${v}M` : 'OFF'; },
    onChange: (v) => app.armSleepTimer(v),
  });
  sleep.canvas.title = 'Pause playback after a set time (0 = off, up to 120 minutes)';

  const mono = toggle(s.mono, () => { app.setMono(!s.mono); setToggle(mono, s.mono); });
  const waveform = toggle(s.waveform, () => { app.setWaveform(!s.waveform); setToggle(waveform, s.waveform); });
  const ambient = toggle(s.ambient, () => { app.setAmbient(!s.ambient); setToggle(ambient, s.ambient); });
  const animations = toggle(anim.enabled, () => { app.setAnimations(!anim.enabled); setToggle(animations, anim.enabled); });
  const mini = toggle(s.miniMode, () => app.setMiniMode(!s.miniMode));

  const github = el('div', { class: 'github-link', title: 'Open GitHub profile', onClick: () => app.cdp.openGitHub('Kizarov3') }, catSvg(), el('span', {}, 'Kizarov3'));
  const body = el('div', { class: 'scroll' },
    row('THEME', themeButton), gap(),
    row('EQUALIZER', eqButton), gap(),
    sliderRow('CROSSFADE', crossfade, crossfadeValue), gap(),
    sliderRow('SLEEP TIMER', sleep, sleepValue), gap(),
    row('MONO AUDIO', mono),
    hint("Sums the left and right channels together — useful if you're listening through a single speaker or one earbud."), gap(),
    row('WAVEFORM', waveform), gap(),
    row('AMBIENT BACKGROUND', ambient),
    hint("Washes the window's background with a blurred glow of the current cover art. Turn off for the plain dark background instead."), gap(),
    row('ANIMATIONS', animations), gap(),
    row('MINI MODE', mini),
    hint('Switches to a small always-on-top mini player — the spinning disc, track info, a seek bar and playback controls. Click the disc to play/pause; press M or Esc to come back.'));
  return [title('SETTINGS'), gap(20), body, closeRow(() => closePanel('settings')), github];
}

// ---- Theme picker --------------------------------------------------------------------------------------------------

let themeMenu = null;
function showThemeMenu(app) {
  closeThemeMenu(app);
  const anchor = themeButton.getBoundingClientRect();
  const menu = el('div', { class: 'theme-menu' }, THEMES.map((t, i) => {
    const swatch = el('span', { class: 'swatch' });
    swatch.style.background = `linear-gradient(135deg, rgb(${t.accent}), rgb(${t.accent2}))`;
    return el('div', { class: `theme-item${i === app.state.themeIndex ? ' current' : ''}`, onClick: () => { app.switchTheme(i); closeThemeMenu(app); } }, swatch, t.name);
  }));
  const menuLayer = el('div', { class: 'theme-menu-layer', onMousedown: (e) => { if (e.target === menuLayer) closeThemeMenu(app); } }, menu);
  layer().append(menuLayer);
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(anchor.left, window.innerWidth - m.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(anchor.bottom + 6, window.innerHeight - m.height - 4))}px`;
  themeMenu = menuLayer;
}
export function closeThemeMenu() { if (themeMenu) { themeMenu.remove(); themeMenu = null; } }

// ---- Equalizer -------------------------------------------------------------------------------------------------

const formatDb = (db) => `${Math.round(db) > 0 ? '+' : ''}${Math.round(db)}dB`;
const formatFreq = (f) => (f >= 1000 ? `${f / 1000}K` : String(f));

export function showEq(app) { openPanel('eq', () => buildEq(app)); }
function buildEq(app) {
  const s = app.state;
  const sliders = EQ_FREQUENCIES.map((f, i) => {
    const value = el('span', { class: 'db' }, formatDb(s.eq[i]));
    const slider = new Slider({
      min: -12, max: 12, value: Math.round(s.eq[i]),
      onInput: (v) => { const gains = s.eq.slice(); gains[i] = v; value.textContent = formatDb(v); app.setEq(gains); },
    });
    const wrap = el('div', { class: 'slider' });
    requestAnimationFrame(() => slider.mount(wrap));
    return { slider, value, row: el('div', { class: 'eq-row' }, el('span', { class: 'freq' }, formatFreq(f)), wrap, value) };
  });
  const applyPreset = (gains) => {
    app.setEq(gains);
    sliders.forEach((sl, i) => { sl.slider.setValue(Math.round(gains[i])); sl.value.textContent = formatDb(gains[i]); });
  };
  const presetButtons = [
    ...app.BUILTIN_EQ_PRESETS.map((p) => pill(p.name, () => applyPreset(p.gains))),
    ...s.customPresets.map((p) => el('span', { class: 'preset-item' },
      pill(p.name, () => applyPreset(p.gains)),
      el('button', { class: 'glyph-x', title: `Delete preset "${p.name}"`, onClick: () => {
        s.customPresets = s.customPresets.filter((c) => c.name !== p.name);
        app.saveEq(); refreshPanel('eq');
      } }, '×'))),
  ];
  const nameField = el('input', { class: 'text-input', type: 'text', maxlength: '40', placeholder: 'Preset name' });
  nameField.style.width = '140px';
  const doSave = () => {
    const name = nameField.value.trim();
    if (!name) return;
    const existing = s.customPresets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    const preset = { name, gains: s.eq.slice() };
    if (existing >= 0) s.customPresets[existing] = preset; else s.customPresets.push(preset);
    app.saveEq(); refreshPanel('eq');
  };
  nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); e.stopPropagation(); if (e.key === 'Escape') closePanel('eq'); });
  const inputRow = el('div', {}, nameField, ' ', pill('SAVE', doSave), ' ', pill('CANCEL', () => { inputRow.hidden = true; trigger.hidden = false; nameField.value = ''; }));
  Object.assign(inputRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
  inputRow.hidden = true;
  const trigger = pill('SAVE AS PRESET', () => { trigger.hidden = true; inputRow.hidden = false; nameField.focus(); });
  const saveArea = el('div', {}, trigger, inputRow);
  const presets = el('div', { class: 'presets scroll' }, presetButtons);
  return [title('EQUALIZER'), gap(18), sliders.map((x) => x.row), gap(10),
    el('div', { class: 'setting-row' }, 'PRESETS'), presets, gap(14), saveArea, closeRow(() => closePanel('eq'))];
}

// ---- Lyrics ------------------------------------------------------------------------------------------------------

let lyricsView = null; // { lines, nodes, scroller, highlight }
export function showLyrics(app) {
  if (!app.state.lyrics) return;
  const p = openPanel('lyrics', () => buildLyrics(app), { width: 480 });
  p.onClose = () => { lyricsView = null; };
  requestAnimationFrame(() => updateLyricsSync(app, true));
}
export function refreshLyricsIfOpen(app) {
  if (!isOpen('lyrics')) return;
  if (!app.state.lyrics) { closePanel('lyrics'); return; }
  refreshPanel('lyrics');
  updateLyricsSync(app, true);
}
function buildLyrics(app) {
  const lines = app.lyricsLines();
  let body;
  if (!lines.length) {
    body = el('div', { class: 'scroll' }, el('div', { class: 'lyrics-plain' }, formatPlain(app.state.lyrics)));
    lyricsView = null;
  } else {
    const nodes = lines.map((l) => el('div', { class: 'lyrics-line', onClick: () => app.seekTo(l.time) }, l.text || ' '));
    body = el('div', { class: 'scroll' }, nodes);
    lyricsView = { lines, nodes, scroller: body, highlight: -1 };
  }
  body.style.height = '380px';
  body.style.marginTop = '16px';
  return [title('LYRICS'), body, closeRow(() => closePanel('lyrics'))];
}
function formatPlain(raw) {
  return String(raw).split(/\r\n|\r|\n/).map((l) => l.replace(/^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*/, ''))
    .filter((l) => !/^\[(ti|ar|al|by|offset|length|re|ve):[^\]]*\]\s*$/.test(l)).join('\n').trim();
}
/** Karaoke-style: highlight the line at the current playback position and keep it centered. */
export function updateLyricsSync(app, force = false) {
  if (!lyricsView || !isOpen('lyrics')) return;
  const index = app.currentLineIndex(lyricsView.lines, app.engine.position);
  if (index === lyricsView.highlight && !force) return;
  if (lyricsView.highlight >= 0) lyricsView.nodes[lyricsView.highlight].classList.remove('current');
  lyricsView.highlight = index;
  if (index >= 0) {
    const node = lyricsView.nodes[index];
    node.classList.add('current');
    const sc = lyricsView.scroller;
    sc.scrollTo({ top: Math.max(0, node.offsetTop - sc.offsetTop - sc.clientHeight / 2 + node.offsetHeight / 2), behavior: anim.enabled && !force ? 'smooth' : 'auto' });
  }
}

// ---- History -----------------------------------------------------------------------------------------------------

export function showHistory(app) { openPanel('history', () => buildHistory(app), { width: 480 }); }
export function refreshHistoryIfOpen(app) { if (isOpen('history')) refreshPanel('history'); }
function trackRow(app, path, label, onPlay) {
  const add = pill('ADD', (e) => { e.stopPropagation(); app.addToQueue([path], { sorted: true }); }, 'Add to queue');
  return el('div', { class: 'list-row', title: `Play ${label}`, onClick: onPlay }, el('span', { class: 'entry' }, label), add);
}
function buildHistory(app) {
  const h = app.state.history;
  const body = h.length
    ? el('div', { class: 'scroll' }, h.map((p) => trackRow(app, p, app.queueDisplay(p), async () => {
      if (!(await app.cdp.exists(p))) { app.setStatus('FILE NO LONGER FOUND'); await app.loadHistoryFromDisk(); refreshPanel('history'); return; }
      app.appendAndPlay(p); closePanel('history');
    })))
    : el('div', { class: 'empty-note' }, 'NOTHING PLAYED YET');
  if (h.length) { body.style.height = '380px'; body.style.marginTop = '16px'; }
  else body.style.marginTop = '16px';
  return [title('RECENTLY PLAYED'), body, closeRow(() => closePanel('history'))];
}

// ---- Search ------------------------------------------------------------------------------------------------------

const search = { index: [], labels: {}, folder: null, scanning: false, generation: 0, lastSpotifyUrl: null, field: null, results: null, status: null };
const SEARCH_LIMIT = 100;
const basename = (p) => p.split(/[\\/]/).pop();
// What a search matches and shows: the filename, or for a cue sheet track "<album> · 03 <title>".
const searchName = (p) => search.labels[p] || basename(p);
function significantWords(text) { return new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)); }
function wordOverlap(query, result) {
  const q = significantWords(query);
  if (!q.size) return 1;
  const r = significantWords(result);
  let n = 0; for (const w of q) if (r.has(w)) n++;
  return n / q.size;
}
function findLocalMatch(title, artist) {
  const query = `${title}${artist ? ` ${artist}` : ''}`;
  let best = null, bestScore = 0;
  for (const p of search.index) {
    const score = wordOverlap(query, search.labels[p] || basename(p).replace(/\.[^.]+$/, ''));
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore >= 0.5 ? best : null;
}

async function startLibraryScan(app) {
  const generation = ++search.generation;
  search.index = []; search.labels = {}; search.scanning = true;
  const result = await app.cdp.scanLibrary().catch(() => ({ folder: null, files: [] }));
  if (generation !== search.generation) return; // superseded by a newer scan
  search.index = result.files; search.labels = result.labels || {}; search.folder = result.name || null; search.scanning = false;
  refreshSearchResults(app);
}

export function showSearch(app) {
  search.lastSpotifyUrl = null;
  startLibraryScan(app);
  openPanel('search', () => buildSearch(app), { width: 480 });
  refreshSearchResults(app);
  setTimeout(() => search.field && search.field.focus(), 50);
}
function buildSearch(app) {
  search.status = el('div', { class: 'setting-row' });
  search.status.style.minHeight = '16px';
  search.field = el('input', { class: 'text-input', type: 'text', placeholder: 'Search by filename, or paste a Spotify link' });
  search.field.style.width = '100%';
  search.field.addEventListener('input', () => onSearchInput(app));
  search.field.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closePanel('search'); });
  search.results = el('div', { class: 'scroll' });
  search.results.style.height = '340px';
  const importButton = pill('IMPORT LIBRARY…', () => importLibrary(app), 'Import an iTunes/Music "Library.xml", or a Spotify "Liked Songs" export (CSV or YourLibrary.json)');
  const instructions = el('div', { class: 'tip' }, 'Type to search your library, or paste a Spotify track/playlist link to queue matching songs you already have');
  Object.assign(instructions.style, { fontSize: '11px', fontWeight: 'bold', marginTop: '12px', lineHeight: '1.35' });
  const importRow = el('div', {}, importButton);
  importRow.style.margin = '10px 0';
  const fieldRow = el('div', {}, search.field);
  fieldRow.style.margin = '6px 0 10px';
  return [title('SEARCH LIBRARY'), instructions, importRow, search.status, fieldRow, search.results, closeRow(() => closePanel('search'))];
}
function setSearchStatus(text) { if (search.status) search.status.textContent = text; }
function refreshSearchResults(app) {
  if (!search.results || !isOpen('search')) return;
  const query = (search.field ? search.field.value : '').trim().toLowerCase();
  if (!search.folder && !search.scanning) {
    setSearchStatus('LOAD A TRACK FIRST TO SET A FOLDER TO SEARCH');
    search.results.replaceChildren();
    return;
  }
  const matches = [];
  for (const p of search.index) {
    if (!query || searchName(p).toLowerCase().includes(query)) { matches.push(p); if (matches.length >= SEARCH_LIMIT) break; }
  }
  setSearchStatus(search.scanning ? 'SCANNING YOUR MUSIC FOLDER…'
    : `${matches.length}${matches.length >= SEARCH_LIMIT ? '+' : ''} MATCH${matches.length === 1 ? '' : 'ES'} IN ${search.folder}`);
  search.results.replaceChildren(...(matches.length
    ? matches.map((p) => trackRow(app, p, searchName(p), async () => {
      if (!(await app.cdp.exists(p))) { app.setStatus('FILE NO LONGER FOUND'); startLibraryScan(app); return; }
      app.appendAndPlay(p); closePanel('search');
    }))
    : [el('div', { class: 'list-row plain' }, search.scanning ? 'SCANNING…' : 'NO MATCHES')]));
}
async function onSearchInput(app) {
  const text = search.field.value.trim();
  const link = await app.cdp.classifySpotifyLink(text);
  if (link) {
    if (text === search.lastSpotifyUrl) return; // this exact paste was already handled
    search.lastSpotifyUrl = text;
    importSpotifyLink(app, text, link.kind === 'playlist');
    return;
  }
  search.lastSpotifyUrl = null;
  refreshSearchResults(app);
}
async function importSpotifyLink(app, url, isPlaylist) {
  search.results.replaceChildren();
  setSearchStatus(isPlaylist ? 'RESOLVING SPOTIFY PLAYLIST…' : 'RESOLVING SPOTIFY TRACK…');
  const result = await app.cdp.resolveSpotifyLink(url);
  if (result.needsSignIn) { promptSpotifySignIn(app, url); return; }
  if (result.error) { setSearchStatus(`SPOTIFY IMPORT FAILED — ${result.error}`); return; }
  finishImport(app, result.tracks);
}
function promptSpotifySignIn(app, pendingUrl) {
  setSearchStatus('CONNECT SPOTIFY TO IMPORT PLAYLISTS');
  const explain = el('div', { class: 'list-row plain' }, "Reading a playlist's songs needs you signed in to Spotify — a single track link doesn't.");
  const connect = pill('CONNECT SPOTIFY ACCOUNT', async () => {
    connect.disabled = true;
    setSearchStatus('OPENING SPOTIFY LOGIN IN YOUR BROWSER…');
    const message = await app.cdp.spotifySignIn();
    setSearchStatus(message);
    if (message === 'SPOTIFY CONNECTED') { search.lastSpotifyUrl = null; importSpotifyLink(app, pendingUrl, true); }
    else connect.disabled = false;
  });
  search.results.replaceChildren(explain, connect);
}
function finishImport(app, tracks) {
  if (!tracks) { setSearchStatus('SPOTIFY LOOKUP FAILED — CHECK THE LINK'); return; }
  if (!tracks.length) { setSearchStatus('NO TRACKS FOUND AT THAT LINK'); return; }
  if (!search.index.length) { setSearchStatus('LOAD A TRACK FIRST TO SET A LIBRARY FOLDER TO MATCH AGAINST'); return; }
  const matched = [], missing = [];
  for (const t of tracks) {
    const f = findLocalMatch(t.title, t.artist);
    if (f) matched.push(f); else missing.push(`${t.title}${t.artist ? ` – ${t.artist}` : ''}`);
  }
  if (matched.length) app.addToQueue(matched, { sorted: true });
  setSearchStatus(`${matched.length} OF ${tracks.length} TRACK${tracks.length === 1 ? '' : 'S'} FOUND IN YOUR LIBRARY AND ADDED`);
  search.results.replaceChildren(...missing.map((m) => el('div', { class: 'list-row plain' }, `NOT IN YOUR LIBRARY · ${m}`)));
}
async function importLibrary(app) {
  const r = await app.cdp.importLibraryDialog();
  if (r.canceled) return;
  if (r.error) { setSearchStatus("COULDN'T READ THAT IMPORT FILE"); return; }
  if (r.kind === 'itunes') {
    if (!r.tracks.length) { setSearchStatus('NO PLAYABLE TRACKS FOUND IN THAT LIBRARY FILE'); return; }
    app.addToQueue(r.tracks, { sorted: true });
    setSearchStatus(`${r.tracks.length} TRACK${r.tracks.length === 1 ? '' : 'S'} IMPORTED FROM ITUNES/MUSIC`);
    return;
  }
  if (!r.tracks.length) { setSearchStatus('NO TRACKS FOUND IN THAT EXPORT FILE'); return; }
  finishImport(app, r.tracks);
}

// ---- Welcome & What's New ------------------------------------------------------------------------------------------

function tipsCard(heading, subtitle, bullets, onDone) {
  return [title(heading), el('div', { class: 'subtitle' }, subtitle), gap(20),
    bullets.map((b) => el('div', { class: 'tip-row' }, el('span', { class: 'dot' }, '●'), el('span', { class: 'tip', html: b }))),
    closeRow(onDone, 'GOT IT')];
}

export function showOnboarding(app) {
  return new Promise((resolve) => {
    const done = () => closePanel('onboarding');
    const p = openPanel('onboarding', () => tipsCard('WELCOME TO CDPLAYER', 'A few things worth knowing before you dive in', [
      'Drag &amp; drop audio files or a whole folder onto the window to build your queue',
      'SPACE / K play or pause &middot; J / L previous / next &middot; &larr; / &rarr; skip 5 seconds &middot; F fullscreen',
      'Open SETTINGS &rarr; THEME to explore nine animated themes, each with its own audio visualizer',
      'MP3, M4A, FLAC, WAV, AIFF, OGG and Opus all play right away &mdash; there is nothing else to install',
      'Your queue is saved automatically and restored the next time you open the app',
    ], done));
    p.onClose = () => { app.cdp.markOnboarded(); resolve(); };
  });
}

// Newest first. Only the entry matching the running version is ever shown.
const CHANGELOG = [
  { version: '2.3.1', changes: [
    '<b>New visualizers</b>: Visualizer Mode (V) now follows the actual music &mdash; bass to treble &mdash; with a full-screen scene for every theme, and the one next to NOW PLAYING is a clean, minimal version of it',
    'Better cover art and lyrics for downloaded songs: files without tags are read as Artist &ndash; Title from their name, and website tags and extras are cleaned out of song names',
    'The skip buttons and &larr; / &rarr; now jump 5 seconds instead of 15, and the previous / next track arrows sit centered in their buttons',
    'Leaving CD View, the disc now lands smoothly in place instead of dropping at the end',
    'On Windows, the media controls show CDPlayer instead of &ldquo;Unknown app&rdquo;, and the title bar is dark to match the player',
  ] },
  { version: '2.3.0', changes: [
    '<b>Full-size album art</b>: click the little cover in the jewel case&rsquo;s corner and it opens over the whole case, in place of the disc &mdash; click the art to put it back',
    '<b>Smoother CD View</b>: the disc itself now glides and grows into place (and back), instead of the old warped snapshot',
    'The row of triangles under the header now follows the theme&rsquo;s color instead of staying red',
    'The VISUALIZER button is gone from the header to keep it tidy &mdash; Visualizer Mode is still on the V key, and still starts by itself after a few idle minutes',
  ] },
  { version: '2.2.0', changes: [
    '<b>CUE sheet support</b>: an album ripped to one big file plus a .cue now shows up as its separate tracks, with their own titles &mdash; and plays through them gaplessly, like the CD',
    'Cleared the queue by accident? The button turns into <b>UNDO CLEAR</b> for a few seconds (or press &#8984;Z / Ctrl+Z)',
    'The audio quality now shows under the title &mdash; FLAC &middot; 24-BIT &middot; 96 KHZ, MP3 &middot; 320 KBPS and so on',
    'When a newer CDPlayer is released, a small button in the top-left corner says so and opens the download page',
  ] },
  { version: '2.1.0', changes: [
    '<b>New mini player</b>, styled after Apple Music&rsquo;s: a compact frosted window with the spinning disc, title and artist, a full-width seek bar, and shuffle / back / play / forward / repeat. Press M (or use Settings) to switch; M or Esc brings the full player back, and it remembers where you put it',
    'Keyboard shortcuts (J, K, L and the rest) now work whichever keyboard layout is active &mdash; including Russian and other non-Latin layouts',
  ] },
  { version: '2.0.0', changes: [
    '<b>Rebuilt as a native desktop app for macOS, Windows and Linux</b> &mdash; download it, open it, and it plays. MP3, M4A (AAC and Apple Lossless), FLAC, WAV, AIFF, AU, OGG and Opus all work out of the box; FFmpeg and Java are no longer needed',
    'Your queue, history, settings, EQ presets and Spotify sign-in carry over automatically from the previous version',
    'System media controls everywhere: macOS Control Center, the Windows media overlay, and Linux desktop players all show what&rsquo;s playing, and hardware media keys work',
    'Open audio files straight from Finder or Explorer with &ldquo;Open With &rarr; CDPlayer&rdquo;, or drop them onto the app icon',
  ] },
];
export function showChangelogIfNeeded(app, lastVersion, existingInstall) {
  const version = app.state.version;
  if (lastVersion === version) return;
  if (!lastVersion && !existingInstall) { app.cdp.writeLastVersion(version); return; } // fresh install: nothing is "new"
  // Just this release's new features — not everything since whichever version this user last ran, which could be a
  // wall of notes for someone coming from the Java app or skipping releases.
  const entry = CHANGELOG.find((c) => c.version === version);
  const changes = entry ? entry.changes : [];
  if (!changes.length) { app.cdp.writeLastVersion(version); return; }
  const p = openPanel('changelog', () => tipsCard("WHAT'S NEW", `CDPlayer ${version}`, changes, () => closePanel('changelog')));
  p.onClose = () => app.cdp.writeLastVersion(version);
}
