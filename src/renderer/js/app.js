// CDPlayer — main controller: playback, queue, themes, view modes (CD View, Visualizer Mode, Mini Mode,
// fullscreen), keyboard shortcuts, persistence, and the per-frame render loop.
import { THEMES, colors, setColors, deriveAutoTheme, visualizerModeFor, particleModeFor, rgb } from './theme.js';
import { AudioEngine } from './audio.js';
import { Disc } from './disc.js';
import { Visualizer, BeatDetector } from './visualizer.js';
import { Particles } from './particles.js';
import { snapshotTransition } from './transitions.js';
import { anim, el, pill, roundButton, modeButton, Slider, fitText, pulse } from './widgets.js';
import { parseLrc, currentLineIndex } from './lyrics.js';
import * as panels from './panels.js';

const cdp = window.cdp;
const $ = (id) => document.getElementById(id);
const STATUS_DOT = '●  ';
const IDLE_SECONDS_UNTIL_VISUALIZER = 180;
const CD_VIEW_CURSOR_IDLE_SECONDS = 5;
const HISTORY_LIMIT = 50;

export const BUILTIN_EQ_PRESETS = [
  { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass Boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'Treble Boost', gains: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6] },
  { name: 'Vocal', gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: 'Rock', gains: [4, 3, 2, 0, -1, 0, 1, 2, 3, 4] },
  { name: 'Pop', gains: [-1, 0, 2, 3, 3, 2, 0, -1, -1, -1] },
  { name: 'Classical', gains: [3, 2, 0, 0, 0, 0, 0, 2, 3, 4] },
  { name: 'Electronic', gains: [5, 4, 1, 0, -2, 0, 1, 2, 4, 5] },
];

const state = {
  queue: [], index: -1, shuffle: false, repeat: 'OFF',
  volume: 100, volumeBeforeMute: -1, crossfade: 0, mono: false, waveform: true, ambient: true, miniMode: false,
  themeIndex: 0, eq: new Array(10).fill(0), customPresets: [], history: [],
  loadedPath: null, details: null, lyrics: null, cover: null, loadToken: 0, crossfadeStarted: false,
  cdView: false, visualizerMode: false, fullscreen: false,
  sleepRemaining: 0, sleepMinutes: 0,
  lastActivity: Date.now(), lastCdMouse: Date.now(), cursorHidden: false, visualizerEnteredAt: 0,
  lastPath: null, version: '', platform: '',
};
const engine = new AudioEngine();
const disc = new Disc($('disc'));
const visualizer = new Visualizer($('visualizer'));
const bigVisualizer = new Visualizer($('big-visualizer'), { big: true });
const beats = new BeatDetector();
const particles = new Particles($('particles'));
const detailsCache = new Map(); // path -> details without cover (queue labels, durations)

// ---- Status / labels ---------------------------------------------------------------------------------------

function setStatus(text) { $('status').textContent = STATUS_DOT + text; }
function displayName(p) { return p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '); }
function extension(p) { const m = /\.([^.\\/]+)$/.exec(p); return m ? m[1].toUpperCase() : ''; }
function queueDisplay(p) {
  const d = detailsCache.get(p);
  return d && d.artist ? `${d.artist} · ${d.title}` : displayName(p);
}
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const formatDuration = (sec) => (sec > 0 ? formatTime(sec) : '--:--');

function setTrackTitle(name, artist) {
  state.titleText = name; state.artistText = artist;
  fitText($('track-title'), name, 456, 34, 20, true);
  fitText($('cd-title'), name, 860, 30, 18, true);
  fitText($('mini-title'), name, 220, 13, 10, true);
  const has = !!(artist && artist.trim());
  $('track-artist').hidden = !has; $('cd-artist').hidden = !has;
  if (has) {
    fitText($('track-artist'), artist, 456, 15, 12, false);
    fitText($('cd-artist'), artist, 860, 18, 13, false);
    fitText($('mini-artist'), artist, 220, 10, 8, false);
  } else { $('mini-artist').textContent = ''; }
  document.title = has ? `${artist} – ${name}` : (state.loadedPath ? name : 'CDPlayer');
}
function fadeInNowPlaying() {
  for (const id of ['track-title', 'track-artist', 'track-source']) pulseClass($(id), 'fade-in');
}
function pulseClass(node, cls) {
  if (!anim.enabled) return;
  node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
}

// ---- Details cache (queue labels & durations) ----------------------------------------------------------------

const detailQueue = [];
let detailWorkers = 0;
function ensureDetails(p) {
  if (detailsCache.has(p) || detailQueue.includes(p)) return;
  detailQueue.push(p);
  pumpDetails();
}
function pumpDetails() {
  while (detailWorkers < 4 && detailQueue.length) {
    const p = detailQueue.shift();
    detailWorkers++;
    cdp.details(p, { withCover: false }).then((d) => { detailsCache.set(p, d); scheduleQueueRender(); })
      .catch(() => detailsCache.set(p, { title: displayName(p), artist: null, duration: 0 }))
      .finally(() => { detailWorkers--; pumpDetails(); });
  }
}

// ---- Queue ---------------------------------------------------------------------------------------------------

let shuffleCache = { index: NaN, size: -1, value: -1 };
function nextIndex() {
  if (!state.queue.length) return -1;
  if (state.shuffle && state.queue.length > 1) {
    if (shuffleCache.index !== state.index || shuffleCache.size !== state.queue.length) {
      let next;
      do { next = Math.floor(Math.random() * state.queue.length); } while (next === state.index);
      shuffleCache = { index: state.index, size: state.queue.length, value: next };
    }
    return shuffleCache.value;
  }
  return state.index + 1 < state.queue.length ? state.index + 1 : -1;
}
function upcomingIndex() {
  let next = nextIndex();
  if (next < 0 && state.repeat === 'ALL' && state.queue.length) next = 0;
  return next;
}

let queueRenderPending = false;
function scheduleQueueRender() {
  if (queueRenderPending) return;
  queueRenderPending = true;
  requestAnimationFrame(() => { queueRenderPending = false; renderQueue(); });
}

const drag = { index: -1, lastY: 0, accumulated: 0, moved: false };
function renderQueue() {
  const list = $('queue-list');
  $('clear-queue-button').disabled = !state.queue.length;
  if (!state.queue.length || state.index < 0) {
    $('queue-info').textContent = 'QUEUE EMPTY';
    $('queue-next').textContent = 'DROP SONGS OR A FOLDER TO BUILD A QUEUE';
    list.replaceChildren();
    return;
  }
  $('queue-info').textContent = `QUEUE ${state.index + 1} / ${state.queue.length}${state.shuffle ? ' · SHUFFLED' : ''}`;
  const next = upcomingIndex();
  $('queue-next').textContent = state.repeat === 'ONE' ? 'REPEATING THIS TRACK'
    : next >= 0 && next !== state.index ? `UP NEXT · ${queueDisplay(state.queue[next])}` : 'END OF QUEUE';
  const scrollTop = list.scrollTop;
  const rows = state.queue.map((p, i) => {
    ensureDetails(p);
    const d = detailsCache.get(p);
    const remove = el('button', { class: 'glyph-x', title: 'Remove from queue', onClick: (e) => { e.stopPropagation(); removeFromQueue(i); } }, '×');
    const row = el('div', { class: `queue-row${i === state.index ? ' active' : ''}${i === drag.index ? ' dragging' : ''}`, title: `Play ${queueDisplay(p)}` },
      el('span', { class: 'entry' }, `${i + 1}. ${queueDisplay(p)}`),
      el('span', { class: 'east' }, el('span', { class: 'duration' }, formatDuration(d ? d.duration : 0)), remove));
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target === remove) return;
      drag.index = i; drag.lastY = e.clientY; drag.accumulated = 0; drag.moved = false;
      list.setPointerCapture(e.pointerId);
    });
    row.addEventListener('click', () => { if (!drag.moved) { state.index = i; load(p); } drag.moved = false; });
    return row;
  });
  list.replaceChildren(...rows);
  list.scrollTop = scrollTop;
}
function setupQueueDrag() {
  const list = $('queue-list');
  list.addEventListener('pointermove', (e) => {
    if (drag.index < 0) return;
    drag.accumulated += e.clientY - drag.lastY;
    drag.lastY = e.clientY;
    const step = 21; // 18px row + 3px gap
    let changed = false;
    while (Math.abs(drag.accumulated) >= step && state.queue.length > 1) {
      const dir = drag.accumulated > 0 ? 1 : -1, target = drag.index + dir;
      if (target < 0 || target >= state.queue.length) break;
      drag.moved = true; changed = true;
      [state.queue[drag.index], state.queue[target]] = [state.queue[target], state.queue[drag.index]];
      if (state.index === drag.index) state.index = target; else if (state.index === target) state.index = drag.index;
      drag.index = target;
      drag.accumulated -= dir * step;
    }
    if (changed) { renderQueue(); saveQueueSoon(); }
  });
  const end = () => { if (drag.index >= 0) { drag.index = -1; if (drag.moved) renderQueue(); } };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

async function addToQueue(items, { sorted = false } = {}) {
  const songs = sorted ? items : await cdp.collectAudio(items);
  if (!songs.length) { setStatus('NO SUPPORTED AUDIO FOUND'); return; }
  state.queue.push(...songs);
  setStatus(`ADDED ${songs.length} TO QUEUE`);
  renderQueue(); saveQueueSoon();
  if (state.index < 0) { state.index = 0; load(state.queue[0]); }
}
function removeFromQueue(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.queue.splice(i, 1);
  if (!state.queue.length) resetToIdle('QUEUE EMPTY');
  else if (i === state.index) { state.index = Math.min(i, state.queue.length - 1); load(state.queue[state.index]); }
  else if (i < state.index) state.index--;
  renderQueue(); saveQueueSoon();
}
function clearQueue() {
  if (!state.queue.length) return;
  state.queue = [];
  resetToIdle('QUEUE CLEARED');
  renderQueue(); saveQueueSoon();
}
function resetToIdle(message) {
  state.index = -1; state.loadToken++;
  engine.stop();
  state.loadedPath = null; state.details = null; state.lyrics = null;
  setTrackTitle('Pick a track to get started.', null);
  $('track-source').textContent = 'YOUR MUSIC LIBRARY';
  document.title = 'CDPlayer';
  $('elapsed').textContent = $('length').textContent = '0:00';
  progress.setValue(0); progress.setWaveform(null);
  setCover(null); disc.lookingUp = false;
  setPlaying(false);
  $('lyrics-button').hidden = true;
  panels.refreshLyricsIfOpen(app);
  setStatus(message);
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

// ---- Loading & playback ----------------------------------------------------------------------------------------

async function load(path, { autoPlay = true, allowCrossfade = false, startAt = 0 } = {}) {
  const token = ++state.loadToken;
  const fade = allowCrossfade && engine.playing && state.crossfade > 0 ? state.crossfade : 0;
  state.crossfadeStarted = false;
  state.loadedPath = path;
  progress.setWaveform(null);
  const detailsPromise = cdp.details(path, { withCover: true }).catch(() => null);
  try {
    const ok = await engine.load(cdp.mediaUrl(path), { autoPlay: false, crossfadeSeconds: fade });
    if (!ok || token !== state.loadToken) return;
  } catch {
    if (token !== state.loadToken) return;
    setPlaying(false);
    setStatus((await cdp.exists(path)) ? "COULDN'T PLAY THAT FILE" : 'FILE NO LONGER FOUND');
    return;
  }
  if (startAt > 0) engine.seek(Math.min(startAt, engine.duration));
  if (autoPlay) { recordHistory(path); await engine.play(); }
  if (token !== state.loadToken) return;
  setPlaying(autoPlay);
  if (fade) setStatus('CROSSFADING');
  else if (!autoPlay) setStatus('TRACK LOADED');
  $('length').textContent = formatTime(engine.duration);
  updateProgressUi(true);
  renderQueue(); saveQueueSoon();

  const details = (await detailsPromise) || { title: displayName(path), artist: null, album: null, lyrics: null, cover: null, ext: extension(path), duration: engine.duration };
  if (token !== state.loadToken) return;
  state.details = details;
  detailsCache.set(path, { ...details, cover: undefined, duration: details.duration || engine.duration });
  setTrackTitle(details.title, details.artist);
  fadeInNowPlaying();
  const ext = details.ext || extension(path);
  const canLookUp = !details.cover && !!details.title;
  await setCover(details.cover);
  disc.lookingUp = canLookUp;
  $('track-source').textContent = details.cover ? `EMBEDDED ALBUM ART · ${ext}` : canLookUp ? `LOCAL AUDIO FILE · ${ext}` : 'NO EMBEDDED COVER · ADD SONG METADATA';
  updateMediaSession();
  if (canLookUp) lookUpCover(details, path, token);
  state.lyrics = details.lyrics || null;
  $('lyrics-button').hidden = !state.lyrics;
  if (!state.lyrics && details.title) lookUpLyrics(details, token);
  panels.refreshLyricsIfOpen(app);
  renderQueue();
  // Waveform last — it decodes the whole file, so it shouldn't hold up anything the user sees first.
  if (engine.duration && engine.duration < 30 * 60) {
    engine.computeWaveform(cdp.mediaUrl(path)).then((w) => { if (token === state.loadToken) progress.setWaveform(w); }).catch(() => {});
  }
}

async function lookUpCover(details, path, token) {
  const query = `${details.artist ? `${details.artist} ` : ''}${details.title}`;
  const result = await cdp.findCover(query).catch(() => ({ cover: null, networkError: true }));
  if (token !== state.loadToken || state.loadedPath !== path) return;
  disc.lookingUp = false;
  const ext = details.ext || extension(path);
  if (result.cover) {
    await setCover(result.cover);
    $('track-source').textContent = `${result.source} COVER ART · ${ext}`;
    state.details.cover = result.cover;
    updateMediaSession();
  } else {
    $('track-source').textContent = `${result.networkError ? 'COVER LOOKUP UNAVAILABLE' : 'COVER NOT FOUND'} · ${ext}`;
  }
}
async function lookUpLyrics(details, token) {
  const found = await cdp.findLyrics({ title: details.title, artist: details.artist, album: details.album }).catch(() => null);
  if (!found || token !== state.loadToken) return;
  state.lyrics = found;
  $('lyrics-button').hidden = false;
  panels.refreshLyricsIfOpen(app);
}

async function setCover(dataUrl) {
  let img = null;
  if (dataUrl) {
    img = new Image();
    img.src = dataUrl;
    try { await img.decode(); } catch { img = null; }
  }
  state.cover = img;
  disc.setCover(img);
  onCoverChanged();
}
function onCoverChanged() {
  const backdrop = $('backdrop'), art = $('backdrop-art');
  if (state.ambient && state.cover) {
    // A 48×48 center crop, stretched to fill the window — the browser's bilinear upscale makes it a soft glow.
    art.width = art.height = 48;
    const g = art.getContext('2d');
    const iw = state.cover.naturalWidth, ih = state.cover.naturalHeight, s = Math.min(iw, ih);
    g.drawImage(state.cover, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, 48, 48);
    art.style.objectFit = 'cover';
    backdrop.classList.add('has-art');
  } else backdrop.classList.remove('has-art');
  if (THEMES[state.themeIndex].name === 'AUTO') setColors(refreshAutoTheme(), anim.enabled);
}

function setPlaying(playing) {
  disc.spinning = playing;
  playButton.setGlyph(playing ? 'PAUSE' : 'PLAY'); pulse(playButton, true);
  miniPlayButton.setGlyph(playing ? 'PAUSE' : 'PLAY'); pulse(miniPlayButton, true);
  setStatus(playing ? 'NOW SPINNING' : state.loadedPath ? 'PAUSED' : 'READY TO PLAY');
  visualizer.setActive(playing); bigVisualizer.setActive(playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state.loadedPath ? (playing ? 'playing' : 'paused') : 'none';
}
async function toggle() {
  if (!engine.deck) { if (state.queue.length && state.index >= 0) load(state.queue[state.index]); else choose(); return; }
  if (engine.playing) { engine.pause(); setPlaying(false); }
  else { await engine.play(); setPlaying(true); }
}
function nextTrack() {
  const next = upcomingIndex();
  if (next < 0) return false;
  state.index = next;
  load(state.queue[next]);
  return true;
}
function previousTrack() {
  if (engine.deck && engine.position > 5) { seekTo(0); return; }
  if (state.index > 0) { state.index--; load(state.queue[state.index]); }
  else if (engine.deck) seekTo(0);
}
function trackFinished(deck) {
  if (deck !== engine.deck) return;
  if (state.repeat === 'ONE') { engine.seek(0); engine.play(); setPlaying(true); return; }
  if (nextTrack()) return;
  setPlaying(false);
}
function seek(delta) { if (engine.deck) seekTo(engine.position + delta); }
function seekTo(seconds) {
  if (!engine.deck) return;
  engine.seek(seconds);
  updateProgressUi(true);
  updateMediaSessionPosition();
}

function recordHistory(p) {
  state.history = [p, ...state.history.filter((h) => h !== p)].slice(0, HISTORY_LIMIT);
  cdp.saveHistory(state.history);
  panels.refreshHistoryIfOpen(app);
}

// ---- Media Session: macOS Control Center / Windows media overlay / Linux MPRIS, plus hardware media keys ----

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.details) return;
  const d = state.details;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: d.title || '', artist: d.artist || '', album: d.album || '',
    artwork: d.cover ? [{ src: d.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
  updateMediaSessionPosition();
}
function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || !engine.duration) return;
  try { navigator.mediaSession.setPositionState({ duration: engine.duration, position: Math.min(engine.position, engine.duration), playbackRate: 1 }); } catch { /* ignore */ }
}
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported action */ } };
  set('play', () => { if (!engine.playing) toggle(); });
  set('pause', () => { if (engine.playing) toggle(); });
  set('nexttrack', () => nextTrack());
  set('previoustrack', () => previousTrack());
  set('seekto', (e) => seekTo(e.seekTime));
  set('seekbackward', () => seek(-15));
  set('seekforward', () => seek(15));
}

// ---- Themes --------------------------------------------------------------------------------------------------

function refreshAutoTheme() {
  const i = THEMES.findIndex((t) => t.name === 'AUTO');
  THEMES[i] = deriveAutoTheme(state.cover);
  return THEMES[i];
}
function applyThemeModes(name) {
  particles.setMode(particleModeFor(name));
  visualizer.setMode(visualizerModeFor(name));
  bigVisualizer.setMode(visualizerModeFor(name));
  panels.updateThemeButton(app, name);
}
function switchTheme(index, { instant = false } = {}) {
  if (index === state.themeIndex && !instant) return;
  state.themeIndex = index;
  let theme = THEMES[index];
  applyThemeModes(theme.name);
  if (theme.name === 'AUTO') theme = refreshAutoTheme();
  setColors(theme, anim.enabled && !instant);
  saveSettingsSoon();
}

// ---- Settings setters ------------------------------------------------------------------------------------------

function setVolume(v, { fromSlider = false } = {}) {
  state.volume = Math.max(0, Math.min(100, Math.round(v)));
  engine.setVolume(state.volume / 100);
  $('volume-value').textContent = `${state.volume}%`;
  if (!fromSlider) volumeSlider.setValue(state.volume);
  saveSettingsSoon();
}
function adjustVolume(delta) { state.volumeBeforeMute = -1; setVolume(state.volume + delta); }
function toggleMute() {
  if (state.volumeBeforeMute >= 0) { setVolume(state.volumeBeforeMute); state.volumeBeforeMute = -1; }
  else { state.volumeBeforeMute = state.volume; setVolume(0); }
}
function setMono(on) { state.mono = on; engine.setMono(on); saveSettingsSoon(); }
function setWaveform(on) { state.waveform = on; progress.setWaveformEnabled(on); saveSettingsSoon(); }
function setAmbient(on) { state.ambient = on; onCoverChanged(); saveSettingsSoon(); }
function setAnimations(on) { anim.enabled = on; document.body.classList.toggle('no-anim', !on); saveSettingsSoon(); }
function setCrossfade(v) { state.crossfade = v; saveSettingsSoon(); }
function setEq(gains) { state.eq = gains.slice(); engine.setEq(state.eq); saveSettingsSoon(); }

let sleepTimer = null;
function armSleepTimer(minutes) {
  clearInterval(sleepTimer); sleepTimer = null;
  state.sleepMinutes = minutes;
  state.sleepRemaining = Math.max(0, minutes) * 60;
  if (state.sleepRemaining > 0) {
    sleepTimer = setInterval(() => {
      state.sleepRemaining--;
      if (state.sleepRemaining <= 0) {
        clearInterval(sleepTimer); sleepTimer = null; state.sleepRemaining = 0; state.sleepMinutes = 0;
        if (engine.playing) toggle(); // pause — a no-op if already paused
        panels.refreshSettingsIfOpen(app);
      }
      updateSleepIndicator();
    }, 1000);
  }
  updateSleepIndicator();
}
function updateSleepIndicator() {
  const s = state.sleepRemaining;
  $('sleep-indicator').textContent = s > 0 ? `SLEEP ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
}

// ---- View modes --------------------------------------------------------------------------------------------------

function discRectInViewport() {
  const r = $('disc').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}
const fullRect = () => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });

function applyCdViewState() {
  document.body.classList.toggle('cd-view', state.cdView);
  $('cd-info').hidden = !state.cdView;
  disc.setMode(state.cdView ? 'enlarged' : 'normal');
  $('cd-view-button').textContent = state.cdView ? 'EXIT CD VIEW' : 'CD VIEW';
  state.lastCdMouse = Date.now();
  showCursor();
}
let cdTransitioning = false;
async function toggleCdView() {
  if (cdTransitioning) return; // a second press while the snapshot is being taken
  if (state.miniMode) await setMiniMode(false);
  if (state.visualizerMode) toggleVisualizerMode();
  const entering = !state.cdView;
  const before = discRectInViewport();
  const apply = () => { state.cdView = entering; applyCdViewState(); };
  if (!anim.enabled || Math.max(window.innerWidth, window.innerHeight) > 3200) { apply(); return; }
  cdTransitioning = true;
  try {
    // Entering: the whole window warps down into the enlarged disc. Exiting: the disc warps back out to the window.
    await snapshotTransition($('transition'), cdp.capture, apply,
      () => (entering ? { source: fullRect(), target: discRectInViewport() } : { source: before, target: fullRect() }));
  } finally { cdTransitioning = false; }
}

function toggleVisualizerMode() {
  if (!state.visualizerMode && (state.miniMode || state.cdView)) return;
  state.visualizerMode = !state.visualizerMode;
  const node = $('vis-mode');
  if (state.visualizerMode) {
    state.visualizerEnteredAt = Date.now();
    node.hidden = false;
    if (anim.enabled) node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
  } else if (anim.enabled) {
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).onfinish = () => { if (!state.visualizerMode) node.hidden = true; };
  } else node.hidden = true;
}

async function setMiniMode(enabled) {
  if (enabled === state.miniMode) return;
  if (enabled) {
    if (state.cdView) { state.cdView = false; applyCdViewState(); }
    if (state.visualizerMode) { state.visualizerMode = false; $('vis-mode').hidden = true; }
    if (state.fullscreen) { await cdp.toggleFullscreen(); await waitForFullscreen(false); }
  }
  state.miniMode = enabled;
  panels.closeThemeMenu(app);
  await cdp.setMiniMode(enabled);
  document.body.classList.toggle('mini', enabled);
  (enabled ? $('mini-disc-slot') : $('disc-column')).append($('disc'));
  disc.setMode(enabled ? 'mini' : state.cdView ? 'enlarged' : 'normal');
  panels.refreshSettingsIfOpen(app);
  if (anim.enabled) (enabled ? $('mini') : $('main')).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
}
function waitForFullscreen(target) {
  return new Promise((resolve) => {
    if (state.fullscreen === target) return resolve();
    const started = Date.now();
    const check = () => (state.fullscreen === target || Date.now() - started > 1500 ? resolve() : setTimeout(check, 50));
    check();
  });
}
function toggleFullscreen() { if (!state.miniMode) cdp.toggleFullscreen(); }

function showCursor() { if (state.cursorHidden) { document.body.classList.remove('cursor-hidden'); state.cursorHidden = false; } }

// ---- File actions --------------------------------------------------------------------------------------------

async function choose() {
  const picked = await cdp.openTracksDialog();
  if (picked.length) addToQueue(picked);
}
async function savePlaylist() {
  if (!state.queue.length) { setStatus('QUEUE IS EMPTY'); return; }
  const r = await cdp.savePlaylistDialog(state.queue.map((p) => ({ path: p, display: queueDisplay(p) })));
  if (r.ok) setStatus(`SAVED PLAYLIST · ${r.name}`);
  else if (!r.canceled) setStatus("COULDN'T SAVE PLAYLIST");
}
async function loadPlaylist() {
  const r = await cdp.loadPlaylistDialog();
  if (r.canceled) return;
  if (r.error) { setStatus("COULDN'T READ PLAYLIST"); return; }
  if (!r.tracks.length) { setStatus('NO PLAYABLE TRACKS IN PLAYLIST'); return; }
  state.queue.push(...r.tracks); // order preserved exactly as saved
  setStatus(`LOADED PLAYLIST · ${r.tracks.length} TRACK${r.tracks.length === 1 ? '' : 'S'}`);
  renderQueue(); saveQueueSoon();
  if (state.index < 0) { state.index = 0; load(state.queue[0]); }
}
function appendAndPlay(p) {
  state.queue.push(p);
  state.index = state.queue.length - 1;
  renderQueue();
  load(p);
}

// ---- Persistence ---------------------------------------------------------------------------------------------

let settingsTimer = null, queueTimer = null;
function settingsSnapshot() {
  return { volume: state.volume, crossfade: state.crossfade, mono: state.mono, animations: anim.enabled, theme: THEMES[state.themeIndex].name, eq: state.eq, waveform: state.waveform, ambient: state.ambient };
}
function saveSettingsSoon() { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => cdp.saveSettings(settingsSnapshot()), 300); }
function queueSnapshot() {
  return { paths: state.queue, index: state.index, positionMicros: engine.deck ? Math.round(engine.position * 1e6) : 0 };
}
function saveQueueSoon() { clearTimeout(queueTimer); queueTimer = setTimeout(() => cdp.saveQueue(queueSnapshot()), 500); }
function saveEverythingNow() {
  clearTimeout(settingsTimer); clearTimeout(queueTimer);
  cdp.saveSettings(settingsSnapshot());
  cdp.saveQueueSync(queueSnapshot());
}

// ---- Overlays / Esc --------------------------------------------------------------------------------------------

function anyOverlayOpen() { return !state.miniMode && panels.anyOpen(); }
function escape() {
  if (state.miniMode) { setMiniMode(false); return; }
  if (panels.closeTopmost(app)) return;
  if (state.visualizerMode) toggleVisualizerMode();
  else if (state.cdView) toggleCdView();
  else if (state.fullscreen) toggleFullscreen();
}

// ---- Build the static UI ---------------------------------------------------------------------------------------

const playButton = roundButton('PLAY', 68, { primary: true, title: 'Play/Pause', onClick: () => toggle() });
const miniPlayButton = roundButton('PLAY', 34, { primary: true, title: 'Play/Pause', onClick: () => toggle() });
const shuffleButton = modeButton('SHUFFLE', 'Shuffle', () => {
  state.shuffle = !state.shuffle; shuffleButton.setOn(state.shuffle); shuffleCache.index = NaN; renderQueue();
});
const repeatButton = modeButton('REPEAT', 'Repeat', () => {
  state.repeat = state.repeat === 'OFF' ? 'ONE' : state.repeat === 'ONE' ? 'ALL' : 'OFF';
  repeatButton.setOn(state.repeat !== 'OFF');
  repeatButton.setBadge(state.repeat === 'ONE' ? '1' : null);
  repeatButton.title = state.repeat === 'OFF' ? 'Repeat' : state.repeat === 'ONE' ? 'Repeat: one track' : 'Repeat: whole queue';
  renderQueue();
});

let seeking = false;
const progress = new Slider({
  min: 0, max: 1000, waveform: true,
  onInput: (v) => { seeking = true; $('elapsed').textContent = formatTime((engine.duration * v) / 1000); },
  onChange: (v) => { seeking = false; seekTo((engine.duration * v) / 1000); },
}).mount($('progress-row'));
const miniProgress = new Slider({
  min: 0, max: 1000, trackHeight: 14,
  onInput: (v) => { seeking = true; $('mini-elapsed').textContent = formatTime((engine.duration * v) / 1000); },
  onChange: (v) => { seeking = false; seekTo((engine.duration * v) / 1000); },
}).mount($('mini-progress'));
const volumeSlider = new Slider({ min: 0, max: 100, value: 100, onInput: (v) => { state.volumeBeforeMute = -1; setVolume(v, { fromSlider: true }); } }).mount($('volume-slider'));

function buildStaticUi() {
  $('transport').append(
    roundButton('SKIP_BACK_15', 36, { title: 'Back 15 seconds', onClick: () => seek(-15) }), spacer(10),
    roundButton('PREVIOUS_TRACK', 44, { title: 'Previous track', onClick: () => previousTrack() }), spacer(16),
    playButton, spacer(16),
    roundButton('NEXT_TRACK', 44, { title: 'Next track', onClick: () => nextTrack() }), spacer(10),
    roundButton('SKIP_FORWARD_15', 36, { title: 'Forward 15 seconds', onClick: () => seek(15) }));
  $('mini-transport').append(
    roundButton('PREVIOUS_TRACK', 26, { title: 'Previous track', onClick: () => previousTrack() }),
    miniPlayButton,
    roundButton('NEXT_TRACK', 26, { title: 'Next track', onClick: () => nextTrack() }));
  $('modes-cluster').append(shuffleButton, repeatButton);
  // Load a Track / Clear Queue anchor the right edge; the same width is mirrored on the left so the transport
  // and mode clusters center on the column's true middle, as in the Java layout.
  const trail = Math.max($('load-button').offsetWidth, $('clear-queue-button').offsetWidth) + 6;
  document.documentElement.style.setProperty('--trail', `${trail}px`);

  $('load-button').addEventListener('click', choose);
  $('save-playlist-button').addEventListener('click', savePlaylist);
  $('load-playlist-button').addEventListener('click', loadPlaylist);
  $('search-button').addEventListener('click', () => panels.showSearch(app));
  $('clear-queue-button').addEventListener('click', clearQueue);
  $('lyrics-button').addEventListener('click', () => panels.showLyrics(app));
  $('history-button').addEventListener('click', () => panels.showHistory(app));
  $('settings-button').addEventListener('click', () => panels.showSettings(app));
  $('cd-view-button').addEventListener('click', toggleCdView);
  $('visualizer-button').addEventListener('click', toggleVisualizerMode);
  $('sleep-indicator').addEventListener('click', () => { armSleepTimer(0); panels.refreshSettingsIfOpen(app); });
  $('mini-exit').addEventListener('click', () => setMiniMode(false));
  $('vis-mode').addEventListener('mousedown', () => { if (state.visualizerMode) toggleVisualizerMode(); });
  disc.onEjectPeak = () => nextTrack();
  disc.onMiniClick = () => toggle();
  engine.onEnded = trackFinished;
  engine.onCrossfadeDone = () => { if (engine.playing) setStatus('NOW SPINNING'); };
  setupQueueDrag();
  drawDivider();
  new ResizeObserver(drawDivider).observe($('divider'));
}
function spacer(w) { const s = el('span'); s.style.width = `${w}px`; s.style.flex = `0 0 ${w}px`; return s; }

function drawDivider() {
  const c = $('divider'), dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
  if (!r.width) return;
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, mid = r.height / 2;
  g.strokeStyle = 'rgba(255,255,255,0.157)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
  for (let x = 12; x < w; x += 26) {
    g.fillStyle = rgb(colors.accent);
    g.beginPath(); g.moveTo(x - 4, mid); g.lineTo(x, mid - 6); g.lineTo(x + 4, mid); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.235)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x - 3, mid - 1); g.lineTo(x, mid - 5); g.stroke();
  }
}

// ---- Input -----------------------------------------------------------------------------------------------------

function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
function onKeyDown(e) {
  state.lastActivity = Date.now();
  if (e.key === 'Escape') { e.preventDefault(); escape(); return; }
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'm') { e.preventDefault(); setMiniMode(!state.miniMode); return; }
  if (anyOverlayOpen()) return;
  const actions = {
    ArrowLeft: () => seek(-15), ArrowRight: () => seek(15), ArrowUp: () => adjustVolume(5), ArrowDown: () => adjustVolume(-5),
    u: toggleMute, ' ': toggle, k: toggle, j: previousTrack, l: nextTrack, f: toggleFullscreen, c: toggleCdView, v: toggleVisualizerMode,
  };
  if (actions[key]) { e.preventDefault(); if (!e.repeat || key.startsWith('Arrow')) actions[key](); }
}
function onMouseActivity(e) {
  state.lastActivity = Date.now();
  // Mouse activity dismisses Visualizer Mode — after a short grace period, so the click that opened it (or a hand
  // still settling on the mouse) doesn't instantly close it again.
  if (state.visualizerMode && Date.now() - state.visualizerEnteredAt > 500 && (e.type !== 'mousemove' || Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) toggleVisualizerMode();
  if (state.cdView && e.type === 'mousemove') { state.lastCdMouse = Date.now(); showCursor(); }
}
function setupDragAndDrop() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); if (++depth === 1 && !anyOverlayOpen()) document.body.classList.add('drop-target'); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('drop-target'); } });
  window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = anyOverlayOpen() ? 'none' : 'copy'; });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('drop-target');
    if (anyOverlayOpen()) return; // an open panel blocks drops, the same way it blocks clicks
    const paths = [...e.dataTransfer.files].map((f) => cdp.pathForFile(f)).filter(Boolean);
    if (paths.length) addToQueue(paths).catch(() => setStatus("COULDN'T LOAD THAT FILE"));
  });
}

// ---- Frame loop ------------------------------------------------------------------------------------------------

function updateProgressUi(force = false) {
  if (seeking && !force) return;
  const dur = engine.duration, pos = engine.position;
  const v = dur ? Math.round((pos * 1000) / dur) : 0;
  progress.setValue(v); miniProgress.setValue(v);
  const e = formatTime(pos);
  $('elapsed').textContent = e; $('mini-elapsed').textContent = e;
  $('mini-length').textContent = $('length').textContent;
}

let last = performance.now(), idleCheck = 0, sessionTick = 0;
function frame(now) {
  const dt = Math.min(100, now - last); last = now;
  if (engine.deck && engine.playing) {
    updateProgressUi();
    const raw = engine.levels(5, 90);
    if (raw) { const lv = beats.update(raw, dt); visualizer.setLevels(lv); bigVisualizer.setLevels(lv); }
    panels.updateLyricsSync(app);
    // Crossfade into the next track once we're within the crossfade window of the end.
    const dur = engine.duration, pos = engine.position;
    if (!state.crossfadeStarted && state.crossfade > 0 && dur > 0 && dur - pos <= state.crossfade) {
      state.crossfadeStarted = true;
      if (state.repeat === 'ONE' && state.loadedPath) load(state.loadedPath, { allowCrossfade: true });
      else { const next = upcomingIndex(); if (next >= 0) { state.index = next; load(state.queue[next], { allowCrossfade: true }); } }
    }
    if (now - sessionTick > 1000) { sessionTick = now; updateMediaSessionPosition(); }
  }
  if (!state.miniMode) visualizer.draw(now);
  if (state.visualizerMode) bigVisualizer.draw(now);
  const discBounds = disc.frame(now, dt);
  const exclusions = [];
  if (discBounds) { const r = $('disc').getBoundingClientRect(); exclusions.push({ x: r.left + discBounds.x, y: r.top + discBounds.y, w: discBounds.w, h: discBounds.h }); }
  for (const card of document.querySelectorAll('#overlays .card, #overlays .theme-menu')) {
    const r = card.getBoundingClientRect(); exclusions.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  particles.frame(dt, state.visualizerMode ? [] : exclusions);

  if (now - idleCheck > 500) {
    idleCheck = now;
    if (!state.visualizerMode && !state.miniMode && !state.cdView && !anyOverlayOpen() && engine.playing
      && Date.now() - state.lastActivity >= IDLE_SECONDS_UNTIL_VISUALIZER * 1000) toggleVisualizerMode();
    if (state.cdView && !state.cursorHidden && Date.now() - state.lastCdMouse >= CD_VIEW_CURSOR_IDLE_SECONDS * 1000) {
      document.body.classList.add('cursor-hidden'); state.cursorHidden = true;
    }
  }
  requestAnimationFrame(frame);
}

// ---- The app object the panels module works through ------------------------------------------------------------

export const app = {
  state, engine, disc, THEMES, BUILTIN_EQ_PRESETS, cdp,
  setStatus, queueDisplay, displayName, formatTime, load, addToQueue, appendAndPlay, seekTo,
  switchTheme, setMono, setWaveform, setAmbient, setAnimations, setCrossfade, setEq, armSleepTimer, setMiniMode,
  saveEq: () => cdp.saveEqPresets(state.customPresets),
  lyricsLines: () => (state.lyrics ? parseLrc(state.lyrics) : []),
  currentLineIndex,
  anyOverlayOpen, rememberFocus: () => document.activeElement && document.activeElement.blur(),
  loadHistoryFromDisk: async () => { const s = await cdp.loadState(); state.history = s.history; },
};

// ---- Startup ---------------------------------------------------------------------------------------------------

async function start() {
  buildStaticUi();
  setupMediaSession();
  setupDragAndDrop();
  window.addEventListener('keydown', onKeyDown);
  for (const type of ['mousemove', 'mousedown', 'wheel']) window.addEventListener(type, onMouseActivity, { passive: true });
  window.addEventListener('beforeunload', saveEverythingNow);
  cdp.onAppClosing(saveEverythingNow);
  cdp.onFullscreenChanged((fs) => { state.fullscreen = fs; particles.w = 0; });
  cdp.onOpenFiles((files) => addToQueue(files));
  window.addEventListener('resize', () => { drawDivider(); if (state.titleText) setTrackTitle(state.titleText, state.artistText); });

  const saved = await cdp.loadState();
  state.version = saved.version; state.platform = saved.platform;
  document.body.dataset.platform = saved.platform;
  state.history = saved.history;
  state.customPresets = saved.eqPresets;
  const s = saved.settings;
  setAnimations(s.animations);
  setVolume(s.volume);
  state.crossfade = s.crossfade;
  setMono(s.mono);
  setWaveform(s.waveform);
  state.ambient = s.ambient;
  setEq(s.eq);
  const themeIndex = Math.max(0, THEMES.findIndex((t) => t.name === s.theme));
  state.themeIndex = -1;
  switchTheme(themeIndex, { instant: true });
  setTrackTitle('Pick a track to get started.', null);
  renderQueue();
  requestAnimationFrame(frame);
  if (s.miniMode) setMiniMode(true);

  if (saved.queue) {
    state.queue = saved.queue.paths;
    state.index = saved.queue.index;
    renderQueue();
    // Restored ready-to-play at the saved position, but not auto-started.
    load(state.queue[state.index], { autoPlay: false, startAt: saved.queue.positionMicros / 1e6 });
  }
  const existingInstall = saved.onboarded;
  if (!saved.onboarded) await panels.showOnboarding(app);
  panels.showChangelogIfNeeded(app, saved.lastVersion, existingInstall);
}

start();
