// CDPlayer — main controller: playback, queue, themes, view modes (CD View, Visualizer Mode, Mini Mode,
// fullscreen), keyboard shortcuts, persistence, and the per-frame render loop.
import { THEMES, colors, setColors, deriveAutoTheme, visualizerModeFor, particleModeFor, rgb, onColorsChanged, setUserThemes, toFile } from './theme.js';
import { AudioEngine } from './audio.js';
import { Disc } from './disc.js';
import { Visualizer } from './visualizer.js';
import { Particles } from './particles.js';
import { anim, el, pill, roundButton, modeButton, Slider, fitText, pulse } from './widgets.js';
import { openBooklet, closeBooklet } from './booklet.js';
import { parseLrc, currentLineIndex, heardPosition, playbackTimeFor, looksOnlineFor, takesOnline } from './lyrics.js';
import { shortcutKey } from './keys.js';
import { jogSeconds } from './jog.js';
import { insertNext, pinnedNext, afterRemove } from './play-next.js';
import { dockIcon } from './dock-disc.js';
import { drawCard, lyricChoices, cardSubtitle, quoteLines, MAX_QUOTE_LINES } from './share-card.js';
import { recordVideo } from './share-video.js';
import * as panels from './panels.js';
import { DiscNoise, ShakeDetector } from './disc-noise.js';
import { wearFor } from './disc-wear.js';
import { pickOutput, outputName } from './output.js';
import { openShelf, closeShelf, isShelfOpen, escapeShelf, setupShelf, showInPlayer } from './shelf.js';
import { openKaraoke, closeKaraoke, refreshKaraoke, updateKaraoke, isKaraokeOpen, canKaraoke } from './karaoke.js';
import { SpotifySession, SpotifyTrackElement, isSpotifyUri, spotifyUpcoming, loadSpotifySdk } from './spotify-deck.js';

const cdp = window.cdp;
const $ = (id) => document.getElementById(id);
const STATUS_DOT = '●  ';
const IDLE_SECONDS_UNTIL_VISUALIZER = 180;
const CD_VIEW_CURSOR_IDLE_SECONDS = 5;
const HISTORY_LIMIT = 50;
const UNDO_CLEAR_SECONDS = 8;
const SKIP_SECONDS = 5; // ←/→, the round skip buttons and the system media controls' seek back/forward
// The player can stay open for days, so it asks GitHub about the newest release again every 15 minutes (as well as at
// launch) — the "x.y.z AVAILABLE" pill follows new releases while it's open.
const UPDATE_RECHECK_MS = 15 * 60 * 1000;

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
  volume: 100, volumeBeforeMute: -1, crossfade: 0, mono: false, waveform: true, ambient: true, miniMode: false, discord: true, discNoise: false, discWear: true,
  trayBusy: false, // the tray is moving or the disc is being read: transport presses wait
  saveFound: false, // covers and lyrics found online are written into the song's file
  lyricsOffset: 0,  // ms the lyrics are moved by (+ later), on top of the output latency
  shelfSort: 'ARTIST', // how the shelf is sorted (shelf-order.js)
  nextUp: null,        // { start, end }: the run of the queue put to PLAY NEXT (play-next.js)
  audioCd: null,    // the audio CD in the drive: { mount, tracks, name, album, artist, year }
  ripping: false,   // RIP is saving the disc into the music folder
  rip: null,        // the rip for its panel: { album, artist, year, folder, tracks, stages, sizes, done, percent, finished, ok, message }
  themeIndex: 0, eq: new Array(10).fill(0), customPresets: [], history: [],
  loadedPath: null, details: null, detailsPath: null, lyrics: null, cover: null, loadToken: 0, crossfadeStarted: false,
  cdView: false, visualizerMode: false, fullscreen: false,
  sleepRemaining: 0, sleepMinutes: 0,
  lastActivity: Date.now(), lastCdMouse: Date.now(), cursorHidden: false, visualizerEnteredAt: 0,
  lastPath: null, version: '', platform: '',
};
const engine = new AudioEngine();
const disc = new Disc($('disc'));
const visualizer = new Visualizer($('visualizer'));
const bigVisualizer = new Visualizer($('big-visualizer'), { big: true });
const particles = new Particles($('particles'));
const noise = new DiscNoise(engine);
const shake = new ShakeDetector();
const TRAY_MS = 650, READING_MS = 1300;
const detailsCache = new Map(); // path -> details without cover (queue labels, durations)
const spotifyTracks = new Map(); // spotify:track:… -> { uri, title, artist, album, durationMs, cover } of the Spotify disc

// ---- Status / labels ---------------------------------------------------------------------------------------

function setStatus(text) { $('status').textContent = STATUS_DOT + text; }
// A cue sheet track is queued as "<path to .cue>#<track number>" (see src/main/cue.js).
const cueRef = (p) => /^(.*\.cue)#(\d+)$/i.exec(p);
function displayName(p) {
  const ref = cueRef(p);
  const name = (ref ? ref[1] : p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  return ref ? `${name} · Track ${ref[2]}` : name;
}
function extension(p) { const m = /\.([^.\\/#]+)(#\d+)?$/.exec(p); return m ? m[1].toUpperCase() : ''; }
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
  disc.setLabel(state.loadedPath ? name : null, artist); // written on the disc when it has no cover
  refreshDockSoon();
  fitText($('track-title'), name, 456, 34, 20, true);
  fitText($('cd-title'), name, 860, 30, 18, true);
  const has = !!(artist && artist.trim());
  $('track-artist').hidden = !has; $('cd-artist').hidden = !has;
  if (has) {
    fitText($('track-artist'), artist, 456, 15, 12, false);
    fitText($('cd-artist'), artist, 860, 18, 13, false);
  }
  document.title = has ? `${artist} – ${name}` : (state.loadedPath ? name : 'CDPlayer');
  pushMini(true);
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
  const pinned = pinnedNext(state.index, state.nextUp, state.queue.length); // PLAY NEXT comes first, shuffled or not
  if (pinned >= 0) return pinned;
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
// The disc that's in, for its data side (disc-data.js): the songs of the playing one's album that stand together in the
// queue around it — or just the playing song, when its album isn't known.
let discStart = 0;
function updateDiscData() {
  const i = state.index, here = state.loadedPath && detailsCache.get(state.loadedPath);
  if (i < 0 || !here) { disc.setData(null); return; }
  const artistOf = (d) => (d.credits && d.credits.albumArtist) || d.artist || '';
  const same = (p) => { const d = detailsCache.get(p); return !!(here.album && d && d.album === here.album && artistOf(d) === artistOf(here)); };
  let a = i, b = i;
  while (a > 0 && same(state.queue[a - 1])) a--;
  while (b < state.queue.length - 1 && same(state.queue[b + 1])) b++;
  discStart = a;
  const paths = state.queue.slice(a, b + 1);
  disc.setData({
    id: `${here.album || ''}\n${artistOf(here)}\n${state.queue[a]}`,
    durations: paths.map((p) => (p === state.loadedPath && engine.duration) || (detailsCache.get(p) || {}).duration || 240),
    titles: paths.map((p) => (detailsCache.get(p) || {}).title || displayName(p)),
  });
}
function discPosition() {
  const d = disc.data;
  if (!d) return 0;
  const k = state.index - discStart, track = d.layout.tracks[k];
  return track ? track.start + engine.position : 0;
}

function renderQueue() {
  updateDiscData();
  const list = $('queue-list');
  if (undoClear && state.queue.length) { clearTimeout(undoClear.timer); undoClear = null; } // new songs since: keep them
  const clearButton = $('clear-queue-button');
  clearButton.textContent = undoClear ? 'UNDO CLEAR' : 'CLEAR';
  clearButton.title = undoClear ? 'Bring the cleared queue back (⌘Z / Ctrl+Z)' : 'Clear the queue';
  clearButton.classList.toggle('on', !!undoClear);
  clearButton.disabled = !state.queue.length && !undoClear;
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
    const next = !!state.nextUp && i > state.index && i >= state.nextUp.start && i < state.nextUp.end;
    const row = el('div', { class: `queue-row${i === state.index ? ' active' : ''}${i === drag.index ? ' dragging' : ''}`, title: `Play ${queueDisplay(p)}` },
      el('span', { class: 'num' }, `${i + 1}.`),
      el('span', { class: 'entry' }, queueDisplay(p)),
      next ? el('span', { class: 'next-tag', title: 'Plays next' }, 'NEXT') : null,
      el('span', { class: 'east' }, el('span', { class: 'duration' }, formatDuration(d ? d.duration : 0)), remove));
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target === remove) return;
      drag.index = i; drag.lastY = e.clientY; drag.accumulated = 0; drag.moved = false;
      list.setPointerCapture(e.pointerId);
    });
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
    const step = 28; // 26px row + 2px gap
    let changed = false;
    while (Math.abs(drag.accumulated) >= step && state.queue.length > 1) {
      const dir = drag.accumulated > 0 ? 1 : -1, target = drag.index + dir;
      if (target < 0 || target >= state.queue.length) break;
      drag.moved = true; changed = true;
      state.nextUp = null; // reordered by hand: the order is the queue's now
      [state.queue[drag.index], state.queue[target]] = [state.queue[target], state.queue[drag.index]];
      if (state.index === drag.index) state.index = target; else if (state.index === target) state.index = drag.index;
      drag.index = target;
      drag.accumulated -= dir * step;
    }
    if (changed) { renderQueue(); saveQueueSoon(); }
  });
  // The list captures the pointer on press (so a drag keeps tracking outside the row), which also means the
  // browser delivers the release — and the click — to the list, not the row. So "pressed and released without
  // dragging" is handled here: that's a click on the row, and plays it.
  const end = (e) => {
    if (drag.index < 0) return;
    const index = drag.index, moved = drag.moved;
    drag.index = -1; drag.moved = false;
    if (moved) { renderQueue(); spotifyResync(); } // Spotify hears the new order once, when the row is let go
    else if (e.type === 'pointerup' && index < state.queue.length) { state.index = index; load(state.queue[index]); }
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

async function addToQueue(items, { sorted = false } = {}) {
  const songs = sorted ? items : await cdp.collectAudio(items);
  if (!songs.length) { setStatus('NO SUPPORTED AUDIO FOUND'); return; }
  if (spotifyDiscIn()) { insertDisc(songs); return; } // files replace a Spotify disc, like a new CD
  if (disc.trayOpen && !state.trayBusy) { putDiscOnTray(songs); return; }
  state.queue.push(...songs);
  setStatus(`ADDED ${songs.length} TO QUEUE`);
  renderQueue(); saveQueueSoon();
  if (state.index < 0) { state.index = 0; load(state.queue[0]); }
}
/** PLAY NEXT: songs straight after the one playing (after any already put there), to play next even shuffled. */
async function playNext(items, { sorted = false } = {}) {
  if (!state.queue.length || state.index < 0 || spotifyDiscIn() || disc.trayOpen) { await addToQueue(items, { sorted }); return; }
  const songs = sorted ? items : await cdp.collectAudio(items);
  if (!songs.length) { setStatus('NO SUPPORTED AUDIO FOUND'); return; }
  const r = insertNext(state.queue, state.index, state.nextUp, songs);
  state.queue = r.queue; state.nextUp = r.nextUp;
  shuffleCache.index = NaN;
  setStatus(songs.length === 1 ? 'PLAYS NEXT' : `${songs.length} TO PLAY NEXT`);
  spotifyResync();
  renderQueue(); saveQueueSoon();
}
function removeFromQueue(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.queue.splice(i, 1);
  state.nextUp = afterRemove(state.nextUp, i);
  if (!state.queue.length) resetToIdle('QUEUE EMPTY');
  else if (i === state.index) { state.index = Math.min(i, state.queue.length - 1); load(state.queue[state.index]); }
  else if (i < state.index) state.index--;
  spotifyResync();
  renderQueue(); saveQueueSoon();
}
// CLEAR QUEUE can be taken back for a few seconds: the button turns into UNDO CLEAR (and ⌘Z / Ctrl+Z works), and
// the queue comes back with the same track at the same spot, playing if it was.
let undoClear = null;
function clearQueue() {
  if (!state.queue.length) return;
  if (undoClear) clearTimeout(undoClear.timer);
  undoClear = {
    queue: state.queue, index: state.index, position: engine.position, playing: engine.playing,
    timer: setTimeout(() => { undoClear = null; renderQueue(); }, UNDO_CLEAR_SECONDS * 1000),
  };
  state.nextUp = null; state.queue = [];
  resetToIdle('QUEUE CLEARED');
  renderQueue(); saveQueueSoon();
}
function undoClearQueue() {
  if (!undoClear || state.queue.length) return;
  const u = undoClear;
  clearTimeout(u.timer); undoClear = null;
  state.nextUp = null; state.queue = u.queue; state.index = u.index;
  renderQueue(); saveQueueSoon();
  setStatus('QUEUE RESTORED');
  if (state.index >= 0) load(state.queue[state.index], { autoPlay: u.playing, startAt: u.position });
}
function resetToIdle(message) {
  state.index = -1; state.loadToken++;
  engine.stop();
  state.loadedPath = null; state.details = null; state.lyrics = null;
  disc.setWear(null);
  showInPlayer(null);
  setTrackTitle('Pick a track to get started.', null);
  $('track-source').textContent = 'YOUR MUSIC LIBRARY';
  document.title = 'CDPlayer';
  $('elapsed').textContent = $('length').textContent = '0:00';
  progress.setValue(0); progress.setWaveform(null);
  setCover(null); disc.lookingUp = false;
  disc.discPresent = false;
  setPlaying(false);
  lyricsChanged();
  $('tags-button').hidden = true;
  flushFoundSoon();
  setStatus(message);
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

// ---- Loading & playback ----------------------------------------------------------------------------------------

async function load(path, { autoPlay = true, allowCrossfade = false, startAt = 0, reload = false } = {}) {
  const token = ++state.loadToken;
  dropJog();
  disc.discPresent = true;
  const fade = allowCrossfade && engine.playing && state.crossfade > 0 ? state.crossfade : 0;
  state.crossfadeStarted = false;
  if (state.loadedPath !== path) flushFoundSoon();
  state.loadedPath = path;
  showInPlayer(path);
  $('tags-button').hidden = false;
  if (isSpotifyUri(path)) { progress.setWaveform(null); await loadSpotify(path, token, { autoPlay, startAt }); return; }
  progress.setWaveform(null);
  const detailsPromise = cdp.details(path, { withCover: true }).catch(() => null);
  // A cue sheet track is a stretch of an album-length file, so which file and where it starts must be known first.
  const cue = cueRef(path) ? ((await detailsPromise) || {}).cue : null;
  if (token !== state.loadToken) return;
  if (cueRef(path) && !cue) {
    engine.stop(); setPlaying(false);
    setStatus((await cdp.exists(path)) ? 'TRACK NOT FOUND IN CUE SHEET' : 'FILE NO LONGER FOUND');
    return;
  }
  const url = cdp.mediaUrl(cue ? cue.file : path);
  if (cue && !fade && startAt === 0 && engine.continuesInto(url, cue.start)) {
    engine.setSegment(cue); // the previous track runs straight into this one: keep playing, no reload, no gap
  } else {
    try {
      const ok = await engine.load(url, { autoPlay: false, crossfadeSeconds: fade, segment: cue });
      if (!ok || token !== state.loadToken) return;
    } catch {
      if (token !== state.loadToken) return;
      setPlaying(false);
      setStatus((await cdp.exists(path)) ? "COULDN'T PLAY THAT FILE" : 'FILE NO LONGER FOUND');
      return;
    }
    if (startAt > 0) engine.seek(Math.min(startAt, engine.duration));
  }
  if (autoPlay) { if (!reload) recordHistory(path); await engine.play(); }
  if (token !== state.loadToken) return;
  setPlaying(autoPlay);
  if (fade) setStatus('CROSSFADING');
  else if (!autoPlay) setStatus('TRACK LOADED');
  $('length').textContent = formatTime(engine.duration);
  updateProgressUi(true);
  renderQueue(); saveQueueSoon();

  const details = (await detailsPromise) || { title: displayName(path), artist: null, album: null, lyrics: null, cover: null, ext: extension(path), duration: engine.duration };
  if (token !== state.loadToken) return;
  state.details = details; state.detailsPath = path;
  detailsCache.set(path, { ...details, cover: undefined, duration: details.duration || engine.duration });
  setTrackTitle(details.title, details.artist);
  updateWear();
  fadeInNowPlaying();
  const ext = details.quality || details.ext || extension(path);
  const canLookUp = !details.cover && !!details.title && !details.unnamed;
  await setCover(details.cover);
  disc.lookingUp = canLookUp;
  const fromCd = isAudioCdTrack(path);
  $('tags-button').hidden = fromCd; // a CD can't be written to
  $('track-source').textContent = details.cover ? `${fromCd ? 'AUDIO CD · MUSICBRAINZ COVER ART' : 'EMBEDDED ALBUM ART'} · ${ext}` : canLookUp ? `${fromCd ? 'AUDIO CD' : 'LOCAL AUDIO FILE'} · ${ext}` : 'NO EMBEDDED COVER · ADD SONG METADATA';
  updateMediaSession();
  if (canLookUp) lookUpCover(details, path, token);
  state.lyrics = details.lyrics || null; state.lyricsSource = null;
  // Online too when the file's lyrics only time their lines: word-timed ones make karaoke fill word by word.
  if (looksOnlineFor(state.lyrics) && details.title && !details.unnamed) lookUpLyrics(details, token);
  lyricsChanged();
  renderQueue();
  // Waveform last — it decodes the whole file, so it shouldn't hold up anything the user sees first. (Not for a cue
  // track: that would mean decoding the entire album file for one song's outline. Nor for a CD track: it would read
  // the whole track off the disc first.)
  if (!cue && !isAudioCdTrack(path) && engine.duration && engine.duration < 30 * 60) {
    engine.computeWaveform(cdp.mediaUrl(path)).then((w) => { if (token === state.loadToken) progress.setWaveform(w); }).catch(() => {});
  }
}

const lookupName = (d) => ({ artist: d.artist, title: d.title, guessed: !!d.nameGuessed });
// An artist that was only guessed from "A - B" may be the wrong way round ("Title - Artist.mp3"). When a lookup finds
// the song under the other reading, show it that way — in the player and in the queue.
function useFoundName(details, path, name) {
  if (!name || !name.artist || !details.nameGuessed || state.details !== details) return;
  details.nameGuessed = false;
  if (name.artist === details.artist && name.title === details.title) return;
  details.artist = name.artist; details.title = name.title;
  const cached = detailsCache.get(path);
  if (cached) detailsCache.set(path, { ...cached, artist: name.artist, title: name.title });
  setTrackTitle(details.title, details.artist);
  updateMediaSession();
  renderQueue();
}

async function lookUpCover(details, path, token) {
  const result = await cdp.findCover({ ...lookupName(details), album: details.album }).catch(() => ({ cover: null, networkError: true }));
  if (token !== state.loadToken || state.loadedPath !== path) return;
  disc.lookingUp = false;
  useFoundName(details, path, result.name);
  const ext = details.quality || details.ext || extension(path);
  if (result.cover) {
    const img = await decodeCover(result.cover);
    if (token !== state.loadToken) return; // another track was picked while the picture decoded
    applyCover(img);
    $('track-source').textContent = `${result.source} COVER ART · ${ext}`;
    state.details.cover = result.cover;
    state.details.coverUrl = result.url || null;
    if (state.saveFound) saveFoundLater(path, { cover: result.cover });
    updateMediaSession();
  } else {
    $('track-source').textContent = `${result.networkError ? 'COVER LOOKUP UNAVAILABLE' : 'COVER NOT FOUND'} · ${ext}`;
  }
}
async function lookUpLyrics(details, token) {
  const found = await cdp.findLyrics({ ...lookupName(details), album: details.album, duration: details.duration || engine.duration }).catch(() => null);
  if (!found || token !== state.loadToken || !takesOnline(details.lyrics, found.lyrics)) return;
  // (lrclib's entries are user-submitted and some have artist and title swapped, so unlike a cover, the name lyrics
  // were found under never corrects the displayed name.)
  state.lyrics = found.lyrics; state.lyricsSource = found.source || null;
  lyricsChanged();
  if (state.saveFound && !details.lyrics) saveFoundLater(state.loadedPath, { lyrics: found.lyrics }); // never over the file's own
}

// ---- Writing tags into files -----------------------------------------------------------------------------------

/**
 * The Tags panel's SAVE: writes `changes` into the file. The song that's playing is reloaded at the same moment
 * afterwards — its file just changed under it — so it carries on with the new tags (and cover) showing.
 */
async function saveTags(path, changes) {
  const current = path === state.loadedPath, playing = engine.playing, position = engine.position;
  const result = await cdp.writeTags(path, changes);
  if (!result.ok) return result;
  detailsCache.delete(path);
  pendingFound.delete(path);
  if (current && state.loadedPath === path) await load(path, { autoPlay: playing, startAt: position, reload: true });
  renderQueue();
  return result;
}
// SAVE FOUND ART & LYRICS: what was found online for a song is written into its file — but only once the song isn't
// playing any more, so the file never changes under the player (a crossfade's outgoing song included).
const pendingFound = new Map(); // path -> changes
let flushTimer = null;
function saveFoundLater(path, changes) {
  if (!path || /\.cue#\d+$/i.test(path) || isSpotifyUri(path)) return;
  pendingFound.set(path, { ...(pendingFound.get(path) || {}), ...changes });
}
function flushFoundSoon() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    for (const [path, changes] of [...pendingFound]) {
      if (path === state.loadedPath) continue;
      pendingFound.delete(path);
      const r = await cdp.writeTags(path, changes).catch(() => null);
      if (r && r.ok) detailsCache.delete(path);
    }
  }, (state.crossfade + 2) * 1000);
}
function setSaveFound(on) { state.saveFound = on; if (!on) pendingFound.clear(); saveSettingsSoon(); }
function setLyricsOffset(ms) { state.lyricsOffset = ms; saveSettingsSoon(); }
// Where the song is for the lyrics: what's being heard (the output's latency taken off — only while playing: paused,
// nothing is on its way to the speakers) and the user's offset. A clicked line plays from where it's heard.
const heardLatency = () => (engine.playing ? engine.outputLatency : 0);
const lyricsPosition = () => heardPosition(engine.position, heardLatency(), state.lyricsOffset);
const seekToLyric = (t) => seekTo(playbackTimeFor(t, heardLatency(), state.lyricsOffset));
// The lyrics for the loaded song arrived or went: the LYRICS and KARAOKE buttons, and anything showing them, follow.
function lyricsChanged() {
  $('lyrics-button').hidden = !state.lyrics;
  $('karaoke-button').hidden = !canKaraoke(state.lyrics);
  panels.refreshLyricsIfOpen(app);
  refreshKaraoke();
}
function toggleKaraoke() {
  if (isKaraokeOpen()) { closeKaraoke(); return; }
  if (state.miniMode) return;
  if (state.visualizerMode) toggleVisualizerMode();
  if (!openKaraoke(app)) setStatus(state.lyrics ? 'THESE LYRICS AREN’T TIMED' : 'NO LYRICS FOR THIS SONG');
}

async function setCover(dataUrl) { applyCover(await decodeCover(dataUrl)); }
async function decodeCover(dataUrl) {
  if (!dataUrl) return null;
  const img = new Image();
  img.src = dataUrl;
  try { await img.decode(); return img; } catch { return null; }
}
function applyCover(img) {
  state.cover = img;
  disc.setCover(img);
  onCoverChanged();
  pushMini(true);
  refreshDockSoon();
}

// P, or right-click the disc: a picture of what's playing (share-card.js), quoting lines of its lyrics picked in a
// panel, copied to paste into a chat or saved.
function shareCard() {
  if (!state.loadedPath) { setStatus('NOTHING PLAYING TO SHARE'); return; }
  const song = { cover: state.cover, title: state.titleText, artist: state.artistText, subtitle: cardSubtitle(state.details) };
  const choices = lyricChoices(state.lyrics, lyricsPosition());
  const png = (picked) => drawCard({ ...song, quote: quoteLines(choices.lines, picked) }, { ...colors });
  const attempt = (work, done) => async (picked) => {
    try { if (!(await work(await png(picked)))) return false; setStatus(done); return true; } catch { setStatus("COULDN'T MAKE THE CARD"); return false; }
  };
  panels.showCard(app, {
    choices, maxLines: MAX_QUOTE_LINES,
    render: async (picked) => URL.createObjectURL(new Blob([await png(picked)], { type: 'image/png' })),
    copy: attempt(async (bytes) => { await cdp.copyImage(bytes); return true; }, 'CARD COPIED · PASTE IT ANYWHERE'),
    save: attempt((bytes) => cdp.saveCard(bytes, [song.artist, song.title].filter(Boolean).join(' - ')), 'CARD SAVED'),
    // The video: eight seconds recorded as it plays — started for it if it was paused, and paused again after.
    video: async (format, onTick) => {
      const wasPlaying = engine.playing, withSound = !spotifyActive();
      if (!wasPlaying && engine.deck) { await engine.play(); setPlaying(engine.playing); }
      try {
        const made = await recordVideo({ format, audio: withSound ? engine.recordingStream() : null, onTick, song: {
          ...song, face: disc.renderFace(512, 1).canvas, colors: { ...colors },
          timed: state.lyrics ? parseLrc(state.lyrics) : [], start: lyricsPosition(),
        } });
        if (!made) { setStatus("VIDEO CAN'T BE MADE HERE"); return false; }
        const saved = await cdp.saveVideo(made.bytes, [song.artist, song.title].filter(Boolean).join(' - '), made.ext);
        if (saved) setStatus('VIDEO SAVED');
        return saved;
      } finally {
        engine.stopRecording();
        if (!wasPlaying) { engine.pause(); setPlaying(false); }
      }
    },
  });
}

// The Dock / taskbar icon shows the disc that's in (dock-disc.js), redrawn a moment after its cover or label settles.
let dockTimer = null, dockKey = null;
function refreshDockSoon() {
  clearTimeout(dockTimer);
  dockTimer = setTimeout(async () => {
    const key = state.loadedPath ? `${disc.coverVersion || 0}|${disc.cover ? '' : JSON.stringify(disc.label)}|${disc.wear ? disc.wear.key : ''}` : null;
    if (key === dockKey) return;
    dockKey = key;
    if (!key) { cdp.dockDisc(null); return; }
    const face = disc.renderFace(disc.faceCache ? disc.faceCache.side : 380, window.devicePixelRatio || 1);
    const png = await dockIcon(face.canvas);
    if (dockKey === key) cdp.dockDisc(png);
  }, 400);
}

function setPlaying(playing) {
  disc.spinning = playing;
  noise.setPlaying(playing);
  playButton.setGlyph(playing ? 'PAUSE' : 'PLAY'); pulse(playButton, true);
  if (playing) spotifyTrouble = null;
  setStatus(playing ? 'NOW SPINNING' : spotifyActive() && spotifyTrouble ? spotifyTrouble : state.loadedPath ? 'PAUSED' : 'READY TO PLAY');
  visualizer.setActive(playing); bigVisualizer.setActive(playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state.loadedPath ? (playing ? 'playing' : 'paused') : 'none';
  pushMini(true);
  pushDiscord();
}
async function toggle() {
  if (state.trayBusy) return;
  if (disc.trayOpen) { closeTray(); return; } // PLAY with the tray out closes it and plays, like a real deck
  if (!engine.deck) { if (state.queue.length && state.index >= 0) load(state.queue[state.index]); else choose(); return; }
  if (jog) { jog.wasPlaying = !jog.wasPlaying; setPlaying(jog.wasPlaying); return; } // plays on (or not) once the disc is let go
  if (engine.playing) { engine.pause(); setPlaying(false); }
  else { await engine.play(); setPlaying(engine.playing); } // a Spotify track can be refused
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
// The queue entry `p` picks up exactly where the playing cue sheet track ends, in the same file (atBoundary: and
// playback has got there).
function continuesCurrent(p, { atBoundary = true } = {}) {
  const d = detailsCache.get(p);
  if (!d || !d.cue) return false;
  const url = cdp.mediaUrl(d.cue.file);
  return atBoundary ? engine.continuesInto(url, d.cue.start) : engine.runsInto(url, d.cue.start);
}
function trackFinished(deck) {
  if (deck !== engine.deck) return;
  if (state.repeat === 'ONE') { engine.seek(0); engine.play(); setPlaying(true); return; }
  const next = upcomingIndex();
  // A cue sheet track ends mid-file: unless the next track carries straight on from here, stop the file right now
  // rather than let the following song start playing underneath.
  if (next < 0 || !continuesCurrent(state.queue[next])) engine.pause();
  if (nextTrack()) return;
  setPlaying(false);
}
function seek(delta) { if (engine.deck) seekTo(engine.position + delta); }
function seekTo(seconds) {
  if (!engine.deck) return;
  engine.seek(seconds);
  updateProgressUi(true);
  updateMediaSessionPosition();
  pushMini();
  pushDiscord();
}

// ---- Turning the disc by hand -----------------------------------------------------------------------------------
// Grab the disc and turn it: the song moves with it (jog.js) — clockwise forward — further the harder it's turned, and
// a disc let go with a spin coasts on. While it turns you hear snatches of the song, the way a CD player sounds as it
// searches; once it's still, the song plays on from there, or stays paused if it was. Spotify's audio is protected, so
// there are no snatches of it to play: a playing Spotify track keeps playing instead, jumping to where the disc has got
// to a few times a second, and goes quiet while the disc is held still.

let jog = null; // { wasPlaying, target, audible, sentAt, unsent, stillTimer }
const JOG_SEEK_MS = 80, JOG_SPOTIFY_SEEK_MS = 300, JOG_STILL_MS = 150;
// A playing Spotify track pauses once the disc has been held still a moment, and plays on as soon as it turns again.
function holdStillSoon() {
  if (!jog || jog.audible || !jog.wasPlaying) return;
  clearTimeout(jog.stillTimer);
  jog.stillTimer = setTimeout(() => { if (jog && engine.playing) engine.pause(); }, JOG_STILL_MS);
}
function startJog() {
  engine.cancelCrossfade();
  jog = { wasPlaying: engine.playing, target: engine.position, audible: !spotifyActive(), sentAt: 0, unsent: false };
  if (jog.audible && engine.playing) engine.pause();
  noise.setPlaying(false);
  setStatus('SEARCHING');
  holdStillSoon();
}
function turnJog(radians, ms) {
  if (!jog || !engine.deck) return;
  holdStillSoon();
  const dur = engine.duration;
  if (!jog.audible && !jog.unsent) jog.target = engine.position; // a Spotify track played on while the disc was held still
  jog.target = Math.max(0, Math.min(Math.max(0, dur - 0.5), jog.target + jogSeconds(radians, ms)));
  jog.unsent = true;
  const now = performance.now();
  if (now - jog.sentAt < (jog.audible ? JOG_SEEK_MS : JOG_SPOTIFY_SEEK_MS)) {
    progress.setValue(dur ? Math.round((jog.target * 1000) / dur) : 0);
    setText($('elapsed'), formatTime(jog.target));
    return;
  }
  jog.sentAt = now; jog.unsent = false;
  engine.seek(jog.target);
  if (jog.audible) engine.blip();
  else if (jog.wasPlaying && !engine.playing) engine.play();
  updateProgressUi(true);
}
async function endJog() {
  const j = jog;
  if (!j) return;
  jog = null;
  clearTimeout(j.stillTimer);
  if (j.audible) engine.endBlips();
  if (!engine.deck) return;
  if (j.audible || j.unsent) seekTo(j.target);
  if (j.wasPlaying) { await engine.play(); setPlaying(engine.playing); } else setPlaying(false);
}
/** Lets go of the disc without playing on (a new song, the tray opening) → whether it was playing before the grab. */
function dropJog() {
  const j = jog;
  if (!j) return false;
  jog = null;
  clearTimeout(j.stillTimer);
  if (j.audible) engine.endBlips();
  disc.drop();
  return j.wasPlaying;
}

// ---- The disc tray ---------------------------------------------------------------------------------------------
// E (or the ⏏ button) runs the tray out: playback stops and the disc comes out on its tray. Music dropped on the player while it's out goes in as a new disc, replacing the queue. Closing it
// (E again, or PLAY) reads the disc — the drive spins it up — and plays: the new disc from its first track, or the
// same one from where it stopped.

let trayResume = null; // { playing } of the disc that was in when the tray opened
async function openTray({ eject = false } = {}) {
  if (disc.trayOpen || state.trayBusy || state.miniMode) return;
  // Opening the tray on the audio CD that's playing takes it out of the real drive too.
  const cd = state.audioCd;
  if (eject && cd && cd.tracks.includes(state.loadedPath)) { engine.stop(); cdp.ejectAudioCd(cd.mount); }
  if (state.cdView) await toggleCdView();
  state.trayBusy = true;
  trayResume = { playing: dropJog() || engine.playing };
  if (engine.playing) { engine.pause(); setPlaying(false); }
  setStatus('OPENING');
  noise.tray(TRAY_MS);
  await disc.setTray(true);
  state.trayBusy = false;
  setStatus(state.queue.length ? 'OPEN · DROP IN A NEW DISC, OR PRESS E TO CLOSE' : 'OPEN · DROP MUSIC ON THE TRAY');
  $('tray-button').classList.add('on');
}
async function closeTray({ play = true } = {}) {
  if (!disc.trayOpen || state.trayBusy) return;
  state.trayBusy = true;
  setStatus('CLOSING');
  noise.tray(TRAY_MS);
  await disc.setTray(false);
  $('tray-button').classList.remove('on');
  const resume = trayResume || { playing: false };
  trayResume = null;
  if (!state.queue.length || state.index < 0) { state.trayBusy = false; setStatus('NO DISC'); return; }
  // Reading: the disc spins up, slowly, before anything plays.
  setStatus('READING…');
  disc.reading = true; disc.spinning = true;
  noise.spinUp(READING_MS);
  await new Promise((r) => setTimeout(r, READING_MS));
  disc.reading = false;
  state.trayBusy = false;
  if (!engine.deck) { if (play) load(state.queue[state.index]); else disc.spinning = false; return; }
  if (play || resume.playing) { await engine.play(); setPlaying(engine.playing); } else setPlaying(false);
}
function toggleTray() { if (disc.trayOpen) closeTray(); else openTray({ eject: true }); }

// ---- Spotify discs ---------------------------------------------------------------------------------------------
// An album or playlist from the SPOTIFY panel goes in as a whole disc of spotify:track:… entries. The Web Playback
// SDK plays it (spotify-deck.js); everything else — the disc, transport, lyrics, karaoke — works as for files.

const SPOTIFY_ERRORS = {
  premium: 'SPOTIFY PREMIUM IS NEEDED TO PLAY',
  unsupported: "SPOTIFY PLAYBACK ISN'T SUPPORTED ON THIS SYSTEM",
  auth: 'SPOTIFY SIGNED OUT · CONNECT AGAIN UNDER SPOTIFY',
  offline: "COULDN'T REACH SPOTIFY",
  sdk: "COULDN'T LOAD SPOTIFY'S PLAYER",
  notready: "SPOTIFY'S PLAYER DIDN'T START",
  playback: "COULDN'T PLAY THAT TRACK ON SPOTIFY",
};
let spotifySession = null;
let spotifyTrouble = null; // why Spotify last refused to play, kept in the status line until something plays
function spotify() {
  if (spotifySession) return spotifySession;
  spotifySession = new SpotifySession({
    loadPlayer: () => loadSpotifySdk(),
    getToken: () => cdp.spotifyAccessToken(),
    startPlayback: (request) => cdp.spotifyPlay(request),
    drmReady: () => cdp.spotifyDrmReady(),
    log: (text) => cdp.spotifyLog(text),
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
  spotifyTrouble = `${SPOTIFY_ERRORS[e.reason] || SPOTIFY_ERRORS.playback}${e.detail ? ` · ${e.detail}` : ''}`;
  if (e.reason !== 'playback') { engine.pause(); setPlaying(false); }
  setStatus(spotifyTrouble);
}
/** Tells Spotify the order after the current track again, after shuffle, repeat or the queue changed. */
function spotifyResync() {
  if (spotifyActive() && spotifySession) spotifySession.resync(spotifyUpcoming(state.queue, state.index, state));
}
/** DISCONNECT SPOTIFY: a Spotify disc comes out, and the player closes. */
function stopSpotify() {
  if (spotifySession) spotifySession.disconnect();
  if (spotifyDiscIn()) { state.nextUp = null; state.queue = []; resetToIdle('SPOTIFY DISCONNECTED'); renderQueue(); saveQueueSoon(); }
  spotifyTracks.clear();
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
  updateWear();
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

// ---- Audio CDs ---------------------------------------------------------------------------------------------------
// The main process says when a CD is in the drive (and again once MusicBrainz has named it), and when it's gone.

const isAudioCdTrack = (p) => !!(state.audioCd && state.audioCd.tracks.includes(p));
function showAudioCd() {
  const cd = state.audioCd, button = $('cd-button');
  button.hidden = !cd;
  if (!state.ripping) $('rip-button').hidden = !cd || !cd.ready; // not before MusicBrainz has named it (or couldn't)
  if (cd) button.textContent = cd.album ? `▶ ${cd.album}`.toUpperCase() : 'AUDIO CD';
}
function onAudioCd(cd) {
  const first = !state.audioCd || state.audioCd.mount !== cd.mount;
  state.audioCd = cd;
  showAudioCd();
  if (first) setStatus(`AUDIO CD IN THE DRIVE${cd.album ? ` · ${cd.album.toUpperCase()}` : ''} · CLICK IT ABOVE TO PLAY`);
  // Named now: the queue and the song on the disc in the player take the new names (and cover).
  for (const p of cd.tracks) detailsCache.delete(p);
  renderQueue();
  if (cd.album && cd.tracks.includes(state.loadedPath)) refreshLoadedDetails();
}
function onAudioCdGone({ mount, tracks }) {
  if (state.audioCd && state.audioCd.mount === mount) { state.audioCd = null; showAudioCd(); }
  const gone = new Set(tracks);
  if (!state.queue.some((p) => gone.has(p))) return;
  const current = state.loadedPath;
  state.nextUp = null; state.queue = state.queue.filter((p) => !gone.has(p));
  if (gone.has(current)) resetToIdle('DISC EJECTED');
  else state.index = state.queue.indexOf(current);
  renderQueue();
  saveQueueSoon();
}
async function playAudioCd() {
  const cd = state.audioCd;
  if (!cd) return;
  if (isShelfOpen()) closeShelf();
  await insertDisc(cd.tracks, { status: `${(cd.album || 'AUDIO CD').toUpperCase()} ON THE TRAY` });
}
// RIP: the disc saved into the music folder as FLAC. Clicking it again while it rips cancels.
const RIP_STATUS = { cancelled: 'RIP CANCELLED', 'disc-removed': 'DISC REMOVED', busy: 'ALREADY RIPPING', naming: 'STILL NAMING THE DISC — A MOMENT' };
async function ripAudioCd() {
  const cd = state.audioCd, button = $('rip-button');
  if (state.ripping) { panels.showRip(app); return; } // the list of tracks being ripped (CANCEL RIP is there)
  if (!cd) return;
  state.rip = {
    album: cd.album, artist: cd.artist, year: cd.year, folder: null, done: 0, percent: 0, finished: false, ok: false, message: null,
    tracks: cd.tracks.map((p, i) => { const d = detailsCache.get(p); return { title: (d && d.title) || `Track ${i + 1}`, duration: d && d.duration }; }),
    stages: [], sizes: [],
  };
  state.ripping = true;
  button.classList.add('ripping');
  button.textContent = `RIPPING 0/${cd.tracks.length} · 0%`;
  const result = await cdp.startRip(cd.mount).catch((e) => ({ ok: false, reason: 'failed', message: e.message }));
  state.ripping = false;
  button.classList.remove('ripping');
  button.textContent = 'RIP';
  button.hidden = !state.audioCd || !state.audioCd.ready;
  Object.assign(state.rip, { finished: true, ok: !!result.ok, folder: result.folder || state.rip.folder,
    message: result.ok ? null : RIP_STATUS[result.reason] || `RIP FAILED · ${String(result.message || 'unknown').toUpperCase()}` });
  panels.refreshRipIfOpen(app);
  if (result.ok) setStatus(`RIPPED TO ${(result.album || 'YOUR MUSIC FOLDER').toUpperCase()} · ${result.folder}`);
  else setStatus(RIP_STATUS[result.reason] || `RIP FAILED · ${String(result.message || 'unknown').toUpperCase()}`);
}
// The loaded song's details changed underneath (a CD just got its names): show them without touching playback.
async function refreshLoadedDetails() {
  const path = state.loadedPath, d = await cdp.details(path, { withCover: true }).catch(() => null);
  if (!d || state.loadedPath !== path) return;
  state.details = d; state.detailsPath = path;
  detailsCache.set(path, { ...d, cover: undefined });
  setTrackTitle(d.title, d.artist);
  updateWear();
  if (d.cover) { await setCover(d.cover); $('track-source').textContent = `AUDIO CD · MUSICBRAINZ COVER ART · ${d.quality || d.ext || extension(path)}`; }
  updateMediaSession();
  renderQueue();
}
function toggleShelf() {
  if (isShelfOpen()) { closeShelf(); return; }
  if (state.miniMode) return;
  if (state.visualizerMode) toggleVisualizerMode();
  if (isKaraokeOpen()) closeKaraoke();
  openShelf(app);
}
/**
 * A whole new disc: the tray comes out, `paths` go in as the queue (its first track loaded, so its cover is on the
 * disc in the tray), and the tray closes, reads and plays from the first track. For the shelf and real audio CDs.
 */
async function insertDisc(paths, { status, start = 0 } = {}) {
  if (!paths.length || state.miniMode) return;
  if (!disc.trayOpen) await openTray();
  if (state.trayBusy) return;
  putDiscOnTray(paths, start, status);
  await new Promise((r) => setTimeout(r, 450));
  await closeTray();
}
// Music dropped (or picked) while the tray is out: that's the new disc — it replaces the queue, loaded but not playing.
function putDiscOnTray(paths, start = 0, status = 'DISC ON THE TRAY · PRESS E OR PLAY TO CLOSE') {
  state.nextUp = null; state.queue = paths.slice();
  state.index = Math.max(0, Math.min(start, paths.length - 1));
  shuffleCache.index = NaN;
  disc.discPresent = true;
  renderQueue(); saveQueueSoon();
  trayResume = { playing: false };
  load(paths[state.index], { autoPlay: false }).then(() => { if (disc.trayOpen && !state.trayBusy) setStatus(status); });
}

// Disc noise's skip: shaking the window jolts the pickup, and the song stutters.
function watchForShake(now) {
  if (!state.discNoise || !engine.playing) return;
  if (shake.feed(window.screenX, window.screenY, now)) { noise.skip(); disc.startWobble(); }
}

function recordHistory(p) {
  state.history = [p, ...state.history.filter((h) => h !== p)].slice(0, HISTORY_LIMIT);
  cdp.addPlay(p).catch(() => {});
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
  pushDiscord();
}
function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || !engine.duration) return;
  try { navigator.mediaSession.setPositionState({ duration: engine.duration, position: Math.min(engine.position, engine.duration), playbackRate: 1 }); } catch { /* ignore */ }
}
// Discord status (main/discord.js): the song while it plays, nothing while paused or stopped, or with the setting off.
function pushDiscord() {
  const d = state.details;
  const current = d && state.detailsPath === state.loadedPath;
  if (state.discord && current && engine.playing) findDiscordCover(d);
  cdp.setDiscordTrack(state.discord && current && engine.playing ? {
    title: d.title, artist: d.artist, album: d.album, coverUrl: d.coverUrl || null,
    position: engine.position, duration: engine.duration,
  } : null);
}
// Discord only shows covers by web address. A cover found online already has one; a cover inside the file doesn't, so
// the same song's cover is looked up online (once per track, and only while Discord status is on and it's playing).
function findDiscordCover(d) {
  if (!d.cover || d.coverUrl || d.discordLookup || !d.title) return;
  d.discordLookup = true;
  cdp.findCoverUrl(lookupName(d))
    .then((url) => { if (url && state.details === d) { d.coverUrl = url; pushDiscord(); } })
    .catch(() => {});
}
function setDiscord(on) { state.discord = on; pushDiscord(); saveSettingsSoon(); }
function setDiscNoise(on) { state.discNoise = on; noise.setEnabled(on); noise.setPlaying(engine.playing); saveSettingsSoon(); }
// ---- Where the sound goes (Settings → OUTPUT; output.js) ----------------------------------------------------------

/** The outputs there are now: [{ deviceId, label }], not the system's 'default' and 'communications' aliases. */
async function listOutputs() {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}
// Plays through the chosen output when it's there, the system default when it isn't; `announce` says so when that
// changes by itself (headphones unplugged, AirPods back out of their case).
async function applyOutput(announce) {
  const devices = await listOutputs(), id = pickOutput(devices, state.output);
  if (id === (engine.outputId || '')) return;
  if (!(await engine.setOutput(id)) || !announce) return;
  const device = devices.find((d) => d.deviceId === id);
  setStatus(device ? `PLAYING ON ${outputName(device)}` : 'OUTPUT: SYSTEM DEFAULT');
}
/** Settings → OUTPUT: a device ({ deviceId, label }), or null for the system default. */
async function setOutput(device) {
  state.output = device ? { id: device.deviceId, label: device.label } : null;
  await applyOutput(false);
  saveSettingsSoon();
}
const currentOutputName = async () => outputName((await listOutputs()).find((d) => d.deviceId === engine.outputId) || null);

// Disc wear (disc-wear.js): the disc that's in gets the scratches of however many times its album has been played.
// Worked out as a song goes in, so new marks turn up on the next song rather than in the middle of one.
async function updateWear() {
  const path = state.loadedPath, d = state.details;
  if (!path || !d || !state.discWear) { disc.setWear(null); refreshDockSoon(); return; }
  const album = await cdp.albumPlays(path).catch(() => null);
  if (state.loadedPath !== path || state.details !== d) return;
  disc.setWear(state.discWear && album ? wearFor(album.plays, album.disc) : null);
  refreshDockSoon();
}
function setDiscWear(on) { state.discWear = on; updateWear(); saveSettingsSoon(); }

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported action */ } };
  set('play', () => { if (!engine.playing) toggle(); });
  set('pause', () => { if (engine.playing) toggle(); });
  set('nexttrack', () => nextTrack());
  set('previoustrack', () => previousTrack());
  set('seekto', (e) => seekTo(e.seekTime));
  set('seekbackward', () => seek(-SKIP_SECONDS));
  set('seekforward', () => seek(SKIP_SECONDS));
}

// ---- Themes --------------------------------------------------------------------------------------------------

function refreshAutoTheme() {
  const i = THEMES.findIndex((t) => t.name === 'AUTO');
  THEMES[i] = deriveAutoTheme(state.cover);
  return THEMES[i];
}
function applyThemeModes(theme) {
  particles.setMode(particleModeFor(theme));
  visualizer.setMode(visualizerModeFor(theme));
  bigVisualizer.setMode(visualizerModeFor(theme));
  panels.updateThemeButton(app, theme.name);
}
let shownTheme = THEMES[0]; // the theme on screen: the one chosen, or the one being made in the editor
function paintCoverGlow() {
  const backdrop = $('backdrop'), art = $('backdrop-art');
  if (!shownTheme.image && state.ambient && state.cover) {
    // A 48×48 center crop, stretched to fill the window — the browser's bilinear upscale makes it a soft glow.
    art.width = art.height = 48;
    const g = art.getContext('2d');
    const iw = state.cover.naturalWidth, ih = state.cover.naturalHeight, s = Math.min(iw, ih);
    g.drawImage(state.cover, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, 48, 48);
    art.style.objectFit = 'cover';
    backdrop.classList.add('has-art');
  } else backdrop.classList.remove('has-art');
}
// A theme's own image is the background while it's on, in place of the cover's glow.
function applyBackdrop(theme) {
  const backdrop = $('backdrop'), img = $('backdrop-theme');
  if (theme.image) {
    if (img.getAttribute('src') !== theme.image) img.src = theme.image;
    const blur = theme.blur || 0;
    img.style.filter = `blur(${blur}px) brightness(${1 - (theme.dim ?? 30) / 100})`;
    img.style.transform = blur ? 'scale(1.06)' : ''; // so the blur's soft edge stays off screen
    backdrop.classList.add('has-theme-image');
  } else backdrop.classList.remove('has-theme-image');
}
function onCoverChanged() {
  paintCoverGlow();
  if (shownTheme.name === 'AUTO') { shownTheme = refreshAutoTheme(); setColors(shownTheme, anim.enabled); }
}
function showTheme(theme, animate) {
  const hadImage = !!shownTheme.image;
  shownTheme = theme;
  applyThemeModes(theme);
  applyBackdrop(theme);
  paintCoverGlow();
  setColors(theme, animate);
  if (hadImage !== !!theme.image) panels.refreshSettingsIfOpen(app); // AMBIENT BACKGROUND's note
}
function switchTheme(index, { instant = false } = {}) {
  if (index === state.themeIndex && !instant) return;
  state.themeIndex = index;
  let theme = THEMES[index];
  if (theme.name === 'AUTO') theme = refreshAutoTheme();
  showTheme(theme, anim.enabled && !instant);
  saveSettingsSoon();
}
// The editor's live preview, and putting the chosen theme back when it's cancelled.
const previewTheme = (theme) => showTheme(theme, false);
function restoreTheme() { const i = state.themeIndex; state.themeIndex = -1; switchTheme(i, { instant: true }); }

// ---- Themes people make (theme-editor.js; the files are the main process's user-themes.js) ------------------------

// Reads the kept themes into the list again, and puts on `select` (or the theme that was on; RED if it's gone).
async function reloadUserThemes(select = null) {
  const name = select || THEMES[state.themeIndex].name;
  setUserThemes(await cdp.themes.list());
  state.themeIndex = -1;
  switchTheme(Math.max(0, THEMES.findIndex((t) => t.name === name)));
}
async function saveTheme(theme, oldName = null) {
  const saved = await cdp.themes.save(toFile(theme), oldName);
  if (!saved) { setStatus("COULDN'T SAVE THE THEME"); return null; }
  await reloadUserThemes(saved.name);
  setStatus('THEME SAVED');
  return saved;
}
async function importTheme(path = null) {
  const r = await cdp.themes.importFile(path);
  if (r.canceled) return;
  if (r.error) { setStatus(r.error); return; }
  await reloadUserThemes(r.theme.name);
  setStatus('THEME ADDED');
}
async function pasteThemeCode() {
  const theme = await cdp.themes.decode(await cdp.clipboardText());
  if (!theme) { setStatus("THAT CODE ISN'T A THEME"); return; }
  const saved = await cdp.themes.save(theme, null);
  if (!saved) { setStatus("COULDN'T SAVE THE THEME"); return; }
  await reloadUserThemes(saved.name);
  setStatus('THEME ADDED');
}
async function exportTheme(name) { if (await cdp.themes.exportFile(name)) setStatus('THEME EXPORTED'); }
async function copyThemeCode(theme) {
  const code = await cdp.themes.encode(toFile(theme));
  if (!code) return;
  await cdp.copyText(code);
  setStatus('CODE COPIED · PASTE IT IN A CHAT');
}
async function deleteTheme(name) {
  await cdp.themes.remove(name);
  await reloadUserThemes(THEMES[state.themeIndex].name === name ? 'RED' : null);
  setStatus('THEME DELETED');
}

// ---- Settings setters ------------------------------------------------------------------------------------------

function setVolume(v, { fromSlider = false } = {}) {
  state.volume = Math.max(0, Math.min(100, Math.round(v)));
  engine.setVolume(state.volume / 100);
  if (spotifySession) spotifySession.setVolume(state.volume / 100);
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

function applyCdViewState() {
  document.body.classList.toggle('cd-view', state.cdView);
  $('cd-info').hidden = !state.cdView;
  disc.setMode(state.cdView ? 'enlarged' : 'normal');
  $('cd-view-button').textContent = state.cdView ? 'EXIT CD VIEW' : 'CD VIEW';
  state.lastCdMouse = Date.now();
  showCursor();
}
async function toggleCdView() {
  if (discMorph) return; // already on its way in or out
  if (state.miniMode) await setMiniMode(false);
  if (state.visualizerMode) toggleVisualizerMode();
  const entering = !state.cdView;
  if (!anim.enabled) { state.cdView = entering; applyCdViewState(); return; }
  await morphCdView(entering);
}

// CD View opens and closes by moving the disc itself: its canvas floats from where it sits in one layout to where
// it sits in the other, growing or shrinking on the way — redrawn at every in-between size, so it stays sharp and
// keeps spinning — while the rest of the player fades out around it, or back in.
const CD_MORPH_MS = 440;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
let discMorph = null;
function morphCdView(entering) {
  const canvas = $('disc'), body = document.body;
  // Where the disc sits in both layouts, measured without a paint in between. Leaving, the real layout is switched
  // back first and measured as it is — the CD View title under the disc is gone from it, so the disc sits lower.
  const from = canvas.getBoundingClientRect();
  let to;
  // The divider too: the header above it comes and goes, so it sits higher in CD View.
  const chrome = ['header', 'divider', 'player', 'hint'].map($);
  if (entering) {
    body.classList.add('cd-view');
    to = canvas.getBoundingClientRect();
    body.classList.remove('cd-view');
    for (const node of chrome) node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CD_MORPH_MS * 0.45, easing: 'ease-out', fill: 'forwards' });
  } else {
    state.cdView = false; applyCdViewState(); // the player is laid out again underneath, and fades in as the disc lands
    to = canvas.getBoundingClientRect();
    for (const node of chrome) node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CD_MORPH_MS * 0.5, delay: CD_MORPH_MS * 0.5, easing: 'ease-in', fill: 'backwards' });
  }
  Object.assign(canvas.style, { position: 'fixed', right: 'auto', bottom: 'auto', zIndex: '5' });
  disc.morph = { from: entering ? 'normal' : 'enlarged', to: entering ? 'enlarged' : 'normal', t: 0 };
  return new Promise((resolve) => {
    discMorph = { start: performance.now(), from, to, entering, chrome, resolve };
    stepDiscMorph(performance.now());
  });
}
// Runs from the frame loop, just before the disc is drawn, so each frame draws it at that frame's size.
function stepDiscMorph(now, finish = false) {
  const m = discMorph;
  if (!m) return;
  const p = finish ? 1 : Math.min(1, (now - m.start) / CD_MORPH_MS), t = easeOutCubic(p);
  const lerp = (key) => `${m.from[key] + (m.to[key] - m.from[key]) * t}px`;
  const style = $('disc').style;
  Object.assign(style, { left: lerp('left'), top: lerp('top'), width: lerp('width'), height: lerp('height') });
  disc.morph.t = t;
  if (p < 1) return;
  discMorph = null; disc.morph = null;
  for (const key of ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'zIndex']) style[key] = '';
  if (m.entering) {
    state.cdView = true; applyCdViewState();
    for (const node of m.chrome) for (const a of node.getAnimations()) a.cancel();
    $('cd-info').animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
    $('divider').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
  }
  m.resolve();
}

function toggleVisualizerMode() {
  if (!state.visualizerMode && (state.miniMode || state.cdView || isKaraokeOpen() || isShelfOpen())) return;
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

// Mini Mode is a separate small window (see mini.js) — this window keeps playing, hidden, and just feeds it state.
async function setMiniMode(enabled) {
  if (enabled === state.miniMode) return;
  if (enabled) {
    stepDiscMorph(0, true); // a CD View transition still running finishes first
    if (state.cdView) { state.cdView = false; applyCdViewState(); }
    if (state.visualizerMode) { state.visualizerMode = false; $('vis-mode').hidden = true; }
  }
  state.miniMode = enabled;
  panels.closeMenu();
  closeBooklet();
  if (enabled) { closeKaraoke(); closeShelf(); }
  if (enabled) pushMini(true);
  await cdp.setMiniMode(enabled);
  panels.refreshSettingsIfOpen(app);
}

// ---- Mini player sync ----------------------------------------------------------------------------------------

let lastMiniCover = null, miniCoverKey = 0, sentMiniCoverKey = -1;
function pushMini(full = false) {
  if (!state.miniMode) return;
  const msg = { playing: engine.playing, position: engine.position, duration: engine.duration };
  if (full) {
    const d = state.details;
    const cover = state.cover ? state.cover.src : null;
    if (cover !== lastMiniCover) { lastMiniCover = cover; miniCoverKey++; }
    Object.assign(msg, {
      colors, animations: anim.enabled, visMode: visualizerModeFor(shownTheme),
      shuffle: state.shuffle, repeat: state.repeat,
      track: {
        title: state.titleText || 'Pick a track to get started.', artist: state.artistText || null, album: d && d.album ? d.album : null,
        lookingUp: disc.lookingUp, coverKey: miniCoverKey, loaded: !!state.loadedPath,
        // The artwork is a large data URL — only send it when it actually changed.
        cover: miniCoverKey !== sentMiniCoverKey ? cover : undefined,
      },
    });
    sentMiniCoverKey = miniCoverKey;
  }
  cdp.sendMiniState(msg);
}
function onMiniCommand({ action, value }) {
  switch (action) {
    case 'sync': sentMiniCoverKey = -1; pushMini(true); break;
    case 'toggle': toggle(); break;
    case 'prev': previousTrack(); break;
    case 'next': nextTrack(); break;
    case 'seek': seekTo(value); break;
    case 'seekBy': seek(value); break;
    case 'volume': adjustVolume(value); break;
    case 'mute': toggleMute(); break;
    case 'shuffle': toggleShuffle(); break;
    case 'repeat': cycleRepeat(); break;
    case 'exit': setMiniMode(false); break;
    default: break;
  }
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
  if (spotifyDiscIn()) { insertDisc(r.tracks); return; }
  state.queue.push(...r.tracks); // order preserved exactly as saved
  setStatus(`LOADED PLAYLIST · ${r.tracks.length} TRACK${r.tracks.length === 1 ? '' : 'S'}`);
  renderQueue(); saveQueueSoon();
  if (state.index < 0) { state.index = 0; load(state.queue[0]); }
}
function appendAndPlay(p) {
  if (spotifyDiscIn()) { insertDisc([p]); return; }
  state.queue.push(p);
  state.index = state.queue.length - 1;
  renderQueue();
  load(p);
}

// ---- Persistence ---------------------------------------------------------------------------------------------

let settingsTimer = null, queueTimer = null;
function settingsSnapshot() {
  return { volume: state.volume, crossfade: state.crossfade, mono: state.mono, animations: anim.enabled, theme: THEMES[state.themeIndex].name, eq: state.eq, waveform: state.waveform, ambient: state.ambient, discord: state.discord, discNoise: state.discNoise, discWear: state.discWear, output: state.output, saveFound: state.saveFound, lyricsOffset: state.lyricsOffset, shelfSort: state.shelfSort };
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
  if (escapeShelf()) return;
  if (isKaraokeOpen()) closeKaraoke();
  else if (state.visualizerMode) toggleVisualizerMode();
  else if (state.cdView) toggleCdView();
  else if (state.fullscreen) toggleFullscreen();
}

// ---- Build the static UI ---------------------------------------------------------------------------------------

const playButton = roundButton('PLAY', 68, { primary: true, title: 'Play/Pause', onClick: () => toggle() });
function toggleShuffle() {
  state.shuffle = !state.shuffle; shuffleButton.setOn(state.shuffle); shuffleCache.index = NaN; renderQueue();
  pushMini(true);
  spotifyResync();
}
function cycleRepeat() {
  state.repeat = state.repeat === 'OFF' ? 'ONE' : state.repeat === 'ONE' ? 'ALL' : 'OFF';
  repeatButton.setOn(state.repeat !== 'OFF');
  repeatButton.setBadge(state.repeat === 'ONE' ? '1' : null);
  repeatButton.title = state.repeat === 'OFF' ? 'Repeat' : state.repeat === 'ONE' ? 'Repeat: one track' : 'Repeat: whole queue';
  renderQueue();
  pushMini(true);
  spotifyResync();
}
const shuffleButton = modeButton('SHUFFLE', 'Shuffle', toggleShuffle);
const repeatButton = modeButton('REPEAT', 'Repeat', cycleRepeat);

let seeking = false;
const progress = new Slider({
  min: 0, max: 1000, waveform: true,
  onInput: (v) => { seeking = true; $('elapsed').textContent = formatTime((engine.duration * v) / 1000); },
  onChange: (v) => { seeking = false; seekTo((engine.duration * v) / 1000); },
}).mount($('progress-row'));
const volumeSlider = new Slider({ min: 0, max: 100, value: 100, onInput: (v) => { state.volumeBeforeMute = -1; setVolume(v, { fromSlider: true }); } }).mount($('volume-slider'));

function buildStaticUi() {
  $('transport').append(
    shuffleButton, spacer(22),
    roundButton('SKIP_BACK', 36, { title: `Back ${SKIP_SECONDS} seconds`, onClick: () => seek(-SKIP_SECONDS) }), spacer(10),
    roundButton('PREVIOUS_TRACK', 44, { title: 'Previous track', onClick: () => previousTrack() }), spacer(16),
    playButton, spacer(16),
    roundButton('NEXT_TRACK', 44, { title: 'Next track', onClick: () => nextTrack() }), spacer(10),
    roundButton('SKIP_FORWARD', 36, { title: `Forward ${SKIP_SECONDS} seconds`, onClick: () => seek(SKIP_SECONDS) }), spacer(22),
    repeatButton);

  $('load-button').addEventListener('click', choose);
  $('save-playlist-button').addEventListener('click', savePlaylist);
  $('load-playlist-button').addEventListener('click', loadPlaylist);
  $('search-button').addEventListener('click', () => panels.showSearch(app));
  $('clear-queue-button').addEventListener('click', () => (undoClear ? undoClearQueue() : clearQueue()));
  $('lyrics-button').addEventListener('click', () => panels.showLyrics(app));
  $('karaoke-button').addEventListener('click', toggleKaraoke);
  $('tray-button').addEventListener('click', toggleTray);
  $('cd-button').addEventListener('click', playAudioCd);
  $('rip-button').addEventListener('click', () => ripAudioCd());
  cdp.onRipProgress(({ done, total, percent, current, stage, size, folder }) => {
    if (!state.ripping) return;
    $('rip-button').textContent = `RIPPING ${done}/${total} · ${percent}%`;
    const r = state.rip;
    if (!r) return;
    Object.assign(r, { done, percent, folder: folder || r.folder });
    if (current !== undefined) { r.stages[current] = stage; if (size) r.sizes[current] = size; }
    panels.refreshRipIfOpen(app);
  });
  cdp.onAudioCd(onAudioCd);
  cdp.onAudioCdGone(onAudioCdGone);
  $('tags-button').addEventListener('click', () => panels.showTags(app));
  $('shelf-button').addEventListener('click', toggleShelf);
  $('spotify-button').addEventListener('click', () => panels.showSpotify(app));
  setupShelf(app);
  $('history-button').addEventListener('click', () => panels.showHistory(app));
  $('settings-button').addEventListener('click', () => panels.showSettings(app));
  $('cd-view-button').addEventListener('click', toggleCdView);
  $('update-button').addEventListener('click', () => cdp.openReleasesPage());
  $('sleep-indicator').addEventListener('click', () => { armSleepTimer(0); panels.refreshSettingsIfOpen(app); });
  $('vis-mode').addEventListener('mousedown', () => { if (state.visualizerMode) toggleVisualizerMode(); });
  disc.onEjectPeak = () => nextTrack();
  disc.canGrab = () => !!engine.deck && !state.trayBusy;
  $('disc').addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (!state.miniMode && await cdp.discMenu(!!state.loadedPath) === 'card') shareCard();
  });
  disc.onGrab = startJog;
  disc.onJog = turnJog;
  disc.onJogEnd = endJog;
  disc.onArtClick = (from) => { if (!spotifyActive()) openBooklet(app, from); };
  disc.position = discPosition;
  disc.onTrackPick = (k) => { const i = discStart + k; if (i === state.index) return; state.index = i; load(state.queue[i]); };
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
  if (undoClear && (e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey && !e.altKey && !isTyping(e)) { e.preventDefault(); undoClearQueue(); return; }
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = shortcutKey(e);
  if (key === 'm') { e.preventDefault(); setMiniMode(!state.miniMode); return; }
  if (anyOverlayOpen()) return;
  const actions = {
    ArrowLeft: () => seek(-SKIP_SECONDS), ArrowRight: () => seek(SKIP_SECONDS), ArrowUp: () => adjustVolume(5), ArrowDown: () => adjustVolume(-5),
    u: toggleMute, p: shareCard, b: () => disc.flip(), '?': () => panels.showShortcuts(), ' ': toggle, k: toggle, j: previousTrack, l: nextTrack, f: toggleFullscreen, c: toggleCdView, v: toggleVisualizerMode, y: toggleKaraoke, e: toggleTray, s: toggleShelf,
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
    const isTheme = (p) => /\.cdtheme$/i.test(p);
    for (const p of paths.filter(isTheme)) importTheme(p);
    const songs = paths.filter((p) => !isTheme(p));
    if (songs.length) addToQueue(songs).catch(() => setStatus("COULDN'T LOAD THAT FILE"));
  });
}

// ---- Frame loop ------------------------------------------------------------------------------------------------

function updateProgressUi(force = false) {
  if (seeking && !force) return;
  const dur = engine.duration, pos = engine.position;
  const v = dur ? Math.round((pos * 1000) / dur) : 0;
  progress.setValue(v);
  setText($('elapsed'), formatTime(pos));
}
// Writing a label's text, even the same text, makes the page restyle and repaint it — every frame, for the clock.
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

// Playback logic that must keep running even while this window is hidden (Mini Mode) or minimized — where
// requestAnimationFrame stops — so it runs on a plain timer instead of the frame loop.
let sessionTick = 0, miniLevelsAt = 0;
function playbackTick() {
  if (!engine.deck || !engine.playing || jog) return; // the snatches heard while the disc is turned by hand aren't playing
  engine.watchSegmentEnd();
  if (spotifyActive()) { if (spotifySession) spotifySession.tick(); }
  // Crossfade into the next track once we're within the crossfade window of the end — except between cue sheet
  // tracks that run into each other in the same file, which play on through, as on the album.
  const dur = engine.duration, pos = engine.position;
  if (!state.crossfadeStarted && state.crossfade > 0 && !spotifyActive() && dur > 0 && dur - pos <= state.crossfade) {
    state.crossfadeStarted = true;
    if (state.repeat === 'ONE' && state.loadedPath) load(state.loadedPath, { allowCrossfade: true });
    else {
      const next = upcomingIndex();
      if (next >= 0 && !continuesCurrent(state.queue[next], { atBoundary: false })) { state.index = next; load(state.queue[next], { allowCrossfade: true }); }
    }
  }
  const now = performance.now();
  if (now - sessionTick > 1000) { sessionTick = now; updateMediaSessionPosition(); }
  if (state.miniMode) {
    const msg = { playing: true, position: pos, duration: dur };
    if (now - miniLevelsAt > 30) { miniLevelsAt = now; const raw = engine.levels(5, 90); if (raw) msg.levels = raw; }
    cdp.sendMiniState(msg);
  }
}

let last = performance.now(), idleCheck = 0;
// While you're in another app, the window only needs to look alive: drawing it at 30 frames a second instead of 60
// roughly halves what the spinning disc and visualizer cost. Watched — CDPlayer in front, or CD View, Visualizer Mode
// or Karaoke on screen — it stays at full rate.
const BACKGROUND_FRAME_MS = 1000 / 30;
function frame(now) {
  const watched = document.hasFocus() || state.cdView || state.visualizerMode || isKaraokeOpen();
  if (!watched && now - last < BACKGROUND_FRAME_MS - 2) { requestAnimationFrame(frame); return; }
  const dt = Math.min(100, now - last); last = now;
  if (engine.deck && engine.playing && !jog) { // turning the disc, the seek bar shows where it has got to (turnJog)
    updateProgressUi();
    panels.updateLyricsSync(app);
  }
  // Both visualizers draw from the frequency spectrum (Visualizer Mode's only while it's showing); paused, they
  // settle back down.
  // The shelf covers the player (unless a spine is being carried over it): nothing of the player is drawn under it —
  // measuring the disc there made the whole shelf lay itself out again every frame.
  const underShelf = isShelfOpen() && !$('shelf').classList.contains('carrying');
  if (underShelf) { requestAnimationFrame(frame); return; }
  visualizer.setSpectrum(engine.playing ? engine.spectrum(visualizer.n) : null, dt);
  if (state.visualizerMode) bigVisualizer.setSpectrum(engine.playing ? engine.spectrum(bigVisualizer.n) : null, dt);
  visualizer.draw(now);
  if (state.visualizerMode) bigVisualizer.draw(now);
  if (isKaraokeOpen()) updateKaraoke(lyricsPosition());
  watchForShake(now);
  stepDiscMorph(now);
  const discBounds = disc.frame(now, dt);
  // Where the theme's particles mustn't go (the disc, open panels) — measured only for a theme that has them.
  if (particles.mode !== 'NONE') {
    const exclusions = [];
    if (discBounds) { const r = $('disc').getBoundingClientRect(); exclusions.push({ x: r.left + discBounds.x, y: r.top + discBounds.y, w: discBounds.w, h: discBounds.h }); }
    for (const card of document.querySelectorAll('#overlays .card, #overlays .theme-menu')) {
      const r = card.getBoundingClientRect(); exclusions.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    particles.frame(dt, state.visualizerMode ? [] : exclusions);
  }

  if (now - idleCheck > 500) {
    idleCheck = now;
    if (!state.visualizerMode && !state.miniMode && !state.cdView && !isKaraokeOpen() && !isShelfOpen() && !anyOverlayOpen() && engine.playing
      && Date.now() - state.lastActivity >= IDLE_SECONDS_UNTIL_VISUALIZER * 1000) toggleVisualizerMode();
    if (state.cdView && !state.cursorHidden && Date.now() - state.lastCdMouse >= CD_VIEW_CURSOR_IDLE_SECONDS * 1000) {
      document.body.classList.add('cursor-hidden'); state.cursorHidden = true;
    }
  }
  requestAnimationFrame(frame);
}

// ---- The app object the panels module works through ------------------------------------------------------------

export const app = {
  state, engine, disc, THEMES, BUILTIN_EQ_PRESETS, cdp, libraryCheck: () => panels.showLibraryCheck(app),
  setStatus, queueDisplay, displayName, formatTime, load, addToQueue, playNext, appendAndPlay, seekTo,
  detailsFor: (p) => detailsCache.get(p),
  playQueueIndex: (i) => { if (i >= 0 && i < state.queue.length) { state.index = i; load(state.queue[i]); } },
  coverSource: () => { const s = $('track-source').textContent; return /COVER ART|ALBUM ART/.test(s) ? s.split(' · ')[0].replace(/ COVER ART$/, '').replace('EMBEDDED ALBUM ART', 'In the file') : null; },
  switchTheme, previewTheme, restoreTheme, shownTheme: () => shownTheme, saveTheme, importTheme, pasteThemeCode, exportTheme, copyThemeCode, deleteTheme,
  setMono, setWaveform, setAmbient, setAnimations, setCrossfade, setEq, armSleepTimer, setMiniMode, setDiscord, setDiscNoise, setDiscWear, setOutput, listOutputs, currentOutputName,
  insertDisc, playSpotifyDisc, spotifyActive, stopSpotify, saveTags, setSaveFound, setLyricsOffset, lyricsPosition, seekToLyric,
  setShelfSort: (sort) => { state.shelfSort = sort; saveSettingsSoon(); },
  saveEq: () => cdp.saveEqPresets(state.customPresets),
  lyricsLines: () => (state.lyrics ? parseLrc(state.lyrics) : []),
  openKaraoke: () => toggleKaraoke(),
  currentLineIndex,
  anyOverlayOpen, rememberFocus: () => document.activeElement && document.activeElement.blur(),
  loadHistoryFromDisk: async () => { const s = await cdp.loadState(); state.history = s.history; },
};

// ---- Startup ---------------------------------------------------------------------------------------------------

// A newer release on GitHub shows a pill in the header; clicking it opens the download page. Nothing is installed.
// When GitHub can't be reached, the pill is left as it was.
async function checkForUpdate() {
  const update = await cdp.checkForUpdate().catch(() => ({ offline: true }));
  if (update && update.offline) return;
  const button = $('update-button');
  button.hidden = !update;
  if (update) button.textContent = `${update.version} AVAILABLE`;
}

async function start() {
  buildStaticUi();
  setupMediaSession();
  setupDragAndDrop();
  window.addEventListener('keydown', onKeyDown);
  // Buttons never take keyboard focus (as in the Java app) — otherwise Space after clicking, say, LOAD A TRACK
  // would press that button again as well as toggling playback.
  document.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  for (const type of ['mousemove', 'mousedown', 'wheel']) window.addEventListener(type, onMouseActivity, { passive: true });
  window.addEventListener('beforeunload', saveEverythingNow);
  cdp.onAppClosing(saveEverythingNow);
  cdp.onFullscreenChanged((fs) => { state.fullscreen = fs; particles.w = 0; });
  cdp.onOpenFiles((files) => addToQueue(files));
  cdp.onMiniCommand(onMiniCommand);
  onColorsChanged(() => { drawDivider(); pushMini(true); });
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
  state.discord = s.discord !== false;
  setDiscNoise(!!s.discNoise);
  state.discWear = s.discWear !== false;
  state.output = s.output || null;
  applyOutput(false);
  navigator.mediaDevices.addEventListener('devicechange', () => applyOutput(true));
  state.saveFound = !!s.saveFound;
  state.lyricsOffset = s.lyricsOffset || 0;
  state.shelfSort = s.shelfSort || 'ARTIST';
  setEq(s.eq);
  setUserThemes(saved.themes || []);
  const themeIndex = Math.max(0, THEMES.findIndex((t) => t.name === s.theme));
  state.themeIndex = -1;
  switchTheme(themeIndex, { instant: true });
  setTrackTitle('Pick a track to get started.', null);
  renderQueue();
  requestAnimationFrame(frame);
  setInterval(playbackTick, 40);
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_RECHECK_MS);
  cdp.listAudioCds().then((list) => { if (list.length) { state.audioCd = list[0]; showAudioCd(); } }).catch(() => {});
  if (s.miniMode) setMiniMode(true);

  if (saved.queue) {
    state.nextUp = null; state.queue = saved.queue.paths;
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
