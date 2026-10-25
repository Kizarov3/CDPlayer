// CDPlayer — main controller: playback, queue, themes, view modes (CD View, Visualizer Mode, Mini Mode,
// fullscreen), keyboard shortcuts, persistence, and the per-frame render loop.
import { THEMES, colors, setColors, deriveAutoTheme, visualizerModeFor, particleModeFor, rgb, onColorsChanged, setUserThemes, toFile } from './theme.js';
import { AudioEngine } from './audio.js';
import { moveItem } from './queue-move.js';
import { snapshot as remoteSnapshot, fullSlots, commandError, isStale, musicKey } from './remote-state.js';
import { Disc } from './disc.js';
import { Visualizer } from './visualizer.js';
import { Particles } from './particles.js';
import { anim, EASE, el, pill, roundButton, modeButton, Slider, fitText, pulse, followPlaying } from './widgets.js';
import { openBooklet, closeBooklet } from './booklet.js';
import { withoutHeader, parseLrc, currentLineIndex, heardPosition, playbackTimeFor, looksOnlineFor, takesOnline } from './lyrics.js';
import { shortcutKey } from './keys.js';
import { jogSeconds } from './jog.js';
import * as changer from './changer.js';
import { insertNext, pinnedNext, afterRemove } from './play-next.js';
import { discEndsAfter } from './sleep-end.js';
import { DeckDisplay } from './deck-display.js';
import { createChangerView } from './changer-view.js';
import { pointAtDrawn } from './tour-view.js';
import { dockIcon } from './dock-disc.js';
import { drawCard, lyricChoices, cardSubtitle, quoteLines, MAX_QUOTE_LINES } from './share-card.js';
import { recordVideo, videoSpan, VIDEO_SECONDS } from './share-video.js';
import * as panels from './panels.js';
import { t, locale, translatePage } from './i18n.js';
import { DiscNoise, ShakeDetector } from './disc-noise.js';
import { wearFor } from './disc-wear.js';
import { targetRate, albumRate, badgeLabel, badgeText, badgeExact, levelName, LEVELS } from './quality.js';
import { createSoundCheck, measureFile, MAX_DECODE_BYTES } from './sound-check.js';
import { MAX_MEASURE_SECONDS } from './loudness.js';
import { seamlessNext, PREPARE_SECONDS } from './gapless.js';
import { frameGap, glowSize } from './render-budget.js';
import { detectHidden, hiddenPhase, countdown, hiddenName, displayTitle, shownTitle, splitTitle } from './hidden-track.js';
import { measureEdges, continuesAlbum, nextPlan, prepareWindow, skipSilence, MAX_OVERLAP } from './automix.js';
import { pickOutput, outputName } from './output.js';
import { soundOf, sameSound, deviceKey } from './device-sound.js';
import { note as noteForReport, buildReport } from './report.js';
import { phoneTagTitle, phoneJoined } from './remote-settings.js';
import { openShelf, shelfShowMe, closeShelf, isShelfOpen, escapeShelf, setupShelf, showInPlayer, showChangerSlots, choosePressing, shelfAlbumIds, discogsCurrencyChanged } from './shelf.js';
import { openKaraoke, closeKaraoke, refreshKaraoke, updateKaraoke, isKaraokeOpen, canKaraoke, karaokeCover } from './karaoke.js';
import { SpotifySession, SpotifyTrackElement, isSpotifyUri, spotifyUpcoming, loadSpotifySdk } from './spotify-deck.js';

const cdp = window.cdp;
const $ = (id) => document.getElementById(id);
const STATUS_DOT = '●  ';
const IDLE_SECONDS_UNTIL_VISUALIZER = 180;
const CD_VIEW_CURSOR_IDLE_SECONDS = 5;
const HISTORY_LIMIT = 200;
const UNDO_CLEAR_SECONDS = 8;
const SKIP_SECONDS = 5; // ←/→, the round skip buttons and the system media controls' seek back/forward
// The player can stay open for days, so it asks GitHub about the newest release again every 15 minutes (as well as at
// launch) — the "x.y.z AVAILABLE" pill follows new releases while it's open.
const UPDATE_RECHECK_MS = 15 * 60 * 1000;

export const BUILTIN_EQ_PRESETS = [
  { name: t('Flat'), gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: t('Bass Boost'), gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: t('Treble Boost'), gains: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6] },
  { name: t('Vocal'), gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: t('Rock'), gains: [4, 3, 2, 0, -1, 0, 1, 2, 3, 4] },
  { name: t('Pop'), gains: [-1, 0, 2, 3, 3, 2, 0, -1, -1, -1] },
  { name: t('Classical'), gains: [3, 2, 0, 0, 0, 0, 0, 2, 3, 4] },
  { name: t('Electronic'), gains: [5, 4, 1, 0, -2, 0, 1, 2, 4, 5] },
];

const state = {
  queue: [], index: -1, shuffle: 'OFF', repeat: 'OFF', playModes: null, // playModes: the other mode's SHUFFLE / REPEAT, kept for it; SHUFFLE OFF / DISC / ALL, REPEAT OFF / TRACK / DISC / ALL
  changer: { slots: Array(changer.SLOTS).fill(null), nextDisc: null }, // the slots over queue and index (changer.js)
  changerMode: false,  // Settings → CHANGER: the five-disc changer instead of the queue (each keeps its own music)
  hidden: null, hiddenPhase: null, // the playing file's hidden track and where the position is in it (hidden-track.js)
  softwareRendering: false, // the window put together without the graphics card (gpu-status.js, render-budget.js)
  skipped: new Set(),  // songs (paths) marked SKIP in their case: passed over as the music moves on, still played when picked
  nextUp: null,        // the queue's { start, end }: the run put to PLAY NEXT (play-next.js)
  volume: 100, volumeBeforeMute: -1, transition: 'OFF', crossfade: 5, mono: false, spatial: false, spatialAmount: 50, waveform: true, ambient: true, miniMode: false, discord: true, discNoise: false, discWear: true, discShine: true, taskbarDisc: true,
  trayBusy: false, // the tray is moving or the disc is being read: transport presses wait
  saveFound: false, // covers and lyrics found online are written into the song's file
  streaming: false, // the search finds albums on YouTube Music and songs on SoundCloud too (streaming.js, through yt-dlp)
  lyricsOffset: 0,  // ms the lyrics are moved by (+ later), on top of the output latency
  shelfSort: 'ARTIST', // how the shelf is sorted (shelf-order.js)
  audioCd: null,    // the audio CD in the drive: { mount, tracks, name, album, artist, year }
  ripping: false,   // RIP is saving the disc into the music folder
  rip: null,        // the rip for its panel: { album, artist, year, folder, tracks, stages, sizes, done, percent, finished, ok, message }
  themeIndex: 0, eq: new Array(10).fill(0), customPresets: [], history: [],
  quality: 'HIGH', rateInfo: null, soundCheck: 'OFF', soundCheckInfo: null,
  language: 'AUTO', // Settings → LANGUAGE (applies after a restart)
  loadedPath: null, details: null, detailsPath: null, lyrics: null, cover: null, loadToken: 0, deckToken: 0, crossfadeStarted: false,
  cdView: false, visualizerMode: false, fullscreen: false,
  display: 'DECK', // Settings → DISPLAY: the deck's display under the seek bar, or CLASSIC (the plain times)
  look: 'CLASSIC', // Settings → PLAYER LOOK: how the player is laid out (styles.css, body.look-…)
  sleepRemaining: 0, sleepMinutes: 0, sleepAtEnd: false, // sleepAtEnd: the sleep timer's END OF DISC
  lastActivity: Date.now(), lastCdMouse: Date.now(), cursorHidden: false, visualizerEnteredAt: 0,
  lastPath: null, version: '', platform: '',
  remoteListening: false, // a phone remote is connected (main says so): the state is sent to it as it changes
  rev: Date.now(),        // the music's version for the phone (+1 at each queue or changer change; never the same after a reload)
};
const engine = new AudioEngine();
// The display's time: how far into the song — or, clicked, what's left of it counting down, like a CD deck's TIME
// button. Which one stays chosen (in this window's storage: it's only how the clock reads).
let showRemaining = false;
try { showRemaining = localStorage.getItem('timeRemaining') === '1'; } catch { /* no storage: how far in */ }
const deckDisplay = new DeckDisplay({
  track: $('vfd-track'), time: $('vfd-time'), of: $('vfd-of'), total: $('vfd-total'), flags: [...document.querySelectorAll('.vfd-flag')],
  elapsed: $('elapsed'), length: $('length'),
});
deckDisplay.left = showRemaining;
// Settings → SOUND CHECK (sound-check.js): every song at the same loudness — not Spotify's (it does its own) nor a live CD's.
const soundCheck = createSoundCheck({
  details: (p) => cdp.details(p, { withCover: false }).catch(() => null),
  cache: cdp.soundCheck,
  measure: (file) => measureFile(cdp.mediaUrl(file)),
});
// A streamed song (YouTube Music, SoundCloud — streaming.js): its page's address. No file to tag, measure or evens out.
const isStream = (p) => typeof p === 'string' && p.startsWith('https://');
const evensOut = (p) => !isSpotifyUri(p) && !isAudioCdTrack(p) && !isStream(p);
state.systemRate = engine.rate; // the device's rate as CDPlayer found it, before any setRate: what HIGH plays at
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

// The status line: a word on what just happened, then — after a few seconds — back to what the player is doing.
let statusTimer = null, statusHeld = false; // held: a word just said, for its six seconds
let remoteTimer = null; // a full state for the phone, coming (remoteSoon)
function stateStatus() {
  if (disc.trayOpen) return state.queue.length ? t('OPEN · DROP IN A NEW DISC, OR PRESS E TO CLOSE') : t('OPEN · DROP MUSIC ON THE TRAY');
  if (engine.playing && state.hidden && state.hiddenPhase === 'silence') return countdown(state.hidden, engine.position);
  if (engine.playing) return state.volume === 0 ? t('NOW SPINNING · SOUND OFF') : t('NOW SPINNING'); // (silent: said, so it isn't taken for broken)
  if (spotifyActive() && spotifyTrouble) return spotifyTrouble;
  return state.loadedPath ? t('PAUSED') : t('READY TO PLAY');
}
function setStatus(text) {
  const node = $('status'), said = STATUS_DOT + text;
  noteForReport('status', text);
  // A new word fades in over the old (the same one said again stays still).
  if (anim.enabled && node.textContent !== said) node.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 220, easing: EASE.out });
  node.textContent = said;
  remoteSoon(); // the phone shows the same words
  clearTimeout(statusTimer);
  statusHeld = true;
  statusTimer = setTimeout(() => { statusHeld = false; if (!state.trayBusy && !disc.reading) { $('status').textContent = STATUS_DOT + stateStatus(); remoteSoon(); } }, 6000);
}
let streamReading = null; // the load (its token) a streamed song is being read for
// Done reading — or the reading left for another song, or for none (a load whose sound never comes never says so).
function stopStreamReading(token = streamReading) {
  if (streamReading === null || streamReading !== token) return;
  streamReading = null; disc.reading = false;
  if (statusWords() === t('READING…')) { $('status').textContent = STATUS_DOT + stateStatus(); remoteSoon(); }
}
const statusWords = () => $('status').textContent.replace(STATUS_DOT, '');
// A cue sheet track is queued as "<path to .cue>#<track number>" (see src/main/cue.js).
const cueRef = (p) => /^(.*\.cue)#(\d+)$/i.exec(p);
function displayName(p) {
  const ref = cueRef(p);
  const name = (ref ? ref[1] : p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/\s+[-–—]\s+/g, ' · ').replace(/_/g, ' '); // "Artist - Title" as the tags would show it
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
    cdp.details(p, { withCover: false }).then((d) => { detailsCache.set(p, d); scheduleQueueRender(); panels.refreshHistoryIfOpen(app); })
      .catch(() => detailsCache.set(p, { title: displayName(p), artist: null, duration: 0 }))
      .finally(() => { detailWorkers--; pumpDetails(); });
  }
}

// ---- Queue ---------------------------------------------------------------------------------------------------

// Two modes, each with its own music: the queue (2.14's: a list to reorder, PLAY NEXT's run) and the CD changer
// (changer.js owns state.queue and state.index together with its slots). state.queue / state.index are the mode's in use;
// the other one waits in `stores`. In the changer, ch() and apply() read and write all three.
const ch = () => ({ ...state.changer, queue: state.queue, index: state.index });
let preparedNext = null; // gapless: { path, index, token } — the track waiting on the engine's standby deck
// …dropped when something it was prepared for changes (modes, quality, Sound Check, crossfade, the mode); prepared again on a tick.
// (A song already starting on the standby — the seam's ~10 ms — keeps its mark: onAdvance needs it to show that song.)
function dropPrepared() { engine.cancelPrepared(); if (!engine.seaming) preparedNext = null; }
let changerView = null; // the carousel (changer-view.js)
let shownChanger = null; // what it was last drawn from — the phone's changer is the same
let picking = Promise.resolve(); // the full changer's question, one at a time
// A disc's cover in the carousel: the album's (its first song's folder or tags), or the Spotify album's.
const coverForPath = (p) => (isSpotifyUri(p) ? Promise.resolve((spotifyTracks.get(p) || {}).cover || null) : cdp.shelfCover(p).catch(() => null));
function apply(c) {
  state.changer = { slots: c.slots, nextDisc: c.nextDisc };
  state.queue = c.queue; state.index = c.index;
  upcomingCache = null;
}
// A song in the queue marked not to play (SKIP): the changer's order and the queue's pass over it.
const isSkipped = (i) => state.skipped.size > 0 && state.skipped.has(state.queue[i]);
const modes = () => ({ shuffle: state.shuffle, repeat: state.repeat, skip: isSkipped });
// The playing disc's end in the queue (Spotify is told the tracks up to it), or the queue's end.
const discEnd = () => { const h = state.changerMode && changer.slotOf(ch(), state.index); return h ? state.changer.slots[h.slot].end : state.queue.length; };
// The changer slot the song playing is on — never in queue mode.
const playingSlot = () => (state.changerMode ? changer.slotOf(ch(), state.index) : null);
// The queue's next song (2.14): PLAY NEXT's run first, then shuffled or in order, round again with REPEAT ALL — the
// songs marked SKIP passed over.
function queueNextIndex() {
  const n = state.queue.length;
  if (!n) return -1;
  for (let at = state.index, tries = 0; tries < n; tries++) {
    const pinned = pinnedNext(at, state.nextUp, n);
    if (pinned >= 0) { if (!isSkipped(pinned)) return pinned; at = pinned; continue; }
    if (state.shuffle !== 'OFF' && n > 1) {
      const choices = state.queue.map((_, i) => i).filter((i) => i !== state.index && !isSkipped(i));
      return choices.length ? choices[Math.floor(Math.random() * choices.length)] : -1;
    }
    const next = at + 1 < n ? at + 1 : state.repeat === 'ALL' ? 0 : -1;
    if (next < 0 || !isSkipped(next)) return next;
    at = next;
  }
  return -1; // every one marked SKIP
}

let upcomingCache = null; // { index, size, value }: the shuffle's pick, the same until the music moves or changes
function upcomingIndex() {
  if (upcomingCache && upcomingCache.index === state.index && upcomingCache.size === state.queue.length) return upcomingCache.value;
  const value = state.changerMode ? changer.nextIndex(ch(), modes()) : queueNextIndex();
  upcomingCache = { index: state.index, size: state.queue.length, value };
  return value;
}

let queueRenderPending = false;
function scheduleQueueRender() {
  if (queueRenderPending) return;
  queueRenderPending = true;
  requestAnimationFrame(() => { queueRenderPending = false; renderQueue(); });
}

const drag = { index: -1, lastY: 0, accumulated: 0, moved: false };
// The disc that's in, for its data side (disc-data.js): the playing changer disc's songs — or, in the queue, the
// songs of the playing one's album that stand together around it (just the playing song when its album isn't known).
let discStart = 0;
function updateDiscData() {
  const i = state.index, here = state.loadedPath && detailsCache.get(state.loadedPath);
  if (i < 0 || !here) { disc.setData(null); return; }
  const artistOf = (d) => (d.credits && d.credits.albumArtist) || d.artist || '';
  let a = i, b = i;
  const slot = playingSlot();
  if (slot) { a = state.changer.slots[slot.slot].start; b = state.changer.slots[slot.slot].end - 1; } else {
    const same = (p) => { const d = detailsCache.get(p); return !!(here.album && d && d.album === here.album && artistOf(d) === artistOf(here)); };
    while (a > 0 && same(state.queue[a - 1])) a--;
    while (b < state.queue.length - 1 && same(state.queue[b + 1])) b++;
  }
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
  if (!changerView) return; // not built yet
  syncRev();
  remoteSoon();
  updateDiscData();
  showChangerSlots();
  showDeckTrack();
  if (undoClear && state.queue.length) { clearTimeout(undoClear.timer); undoClear = null; } // new music since: keep it
  const clearButton = $('clear-queue-button');
  clearButton.textContent = undoClear ? t('UNDO CLEAR') : t('CLEAR');
  clearButton.title = state.changerMode ? (undoClear ? t('Bring the discs back (⌘Z / Ctrl+Z)') : t('Take every disc out'))
    : undoClear ? t('Bring the cleared queue back (⌘Z / Ctrl+Z)') : t('Clear the queue');
  clearButton.classList.toggle('on', !!undoClear);
  clearButton.disabled = !state.queue.length && !undoClear;
  if (!state.changerMode) { renderQueueList(); return; }
  const c = ch(), here = changer.slotOf(c, state.index);
  $('eject-disc-button').disabled = !here;
  $('disc-skip-button').disabled = !here || c.slots.filter(Boolean).length < 2;
  const slots = c.slots.map((d, s) => (d ? { title: discLabel(d), note: discNote(d), artist: d.artist, kind: d.kind, done: d.done, next: c.nextDisc === s, firstPath: c.queue[d.start] } : null));
  if (!here) {
    $('queue-info').textContent = c.queue.length ? t('CHANGER · {n} DISCS', { n: slots.filter(Boolean).length }) : t('CHANGER EMPTY');
    $('queue-next').textContent = t('OPEN THE SHELF (S) AND PUT AN ALBUM IN — OR DROP A FOLDER HERE');
    changerView.render(shownChanger = { slots, playingSlot: -1, tracks: [], heading: '' });
    return;
  }
  const d = c.slots[here.slot];
  const modeName = { TRACK: t('TRACK'), DISC: t('DISC'), ALL: t('ALL') };
  const modeText = [state.shuffle !== 'OFF' ? t('SHUFFLE: {m}', { m: modeName[state.shuffle] }) : null, state.repeat !== 'OFF' ? t('REPEAT: {m}', { m: modeName[state.repeat] }) : null].filter(Boolean).join(' · ');
  $('queue-info').textContent = [t('DISC {n} · {at} / {of}', { n: here.slot + 1, at: here.offset + 1, of: d.end - d.start }), modeText].filter(Boolean).join(' · ');
  const next = upcomingIndex();
  $('queue-next').textContent = state.repeat === 'TRACK' ? t('REPEATING THIS TRACK')
    : next >= 0 && next !== state.index ? t('UP NEXT · {song}', { song: (ensureDetails(state.queue[next]), queueDisplay(state.queue[next])) }) : t('END OF THE LAST DISC');
  const tracks = changer.tracksOf(c, here.slot).map((p, k) => {
    ensureDetails(p);
    const det = detailsCache.get(p);
    return { index: d.start + k, no: k + 1, title: queueDisplay(p), time: formatDuration(det ? det.duration : 0), duration: det ? det.duration : 0, current: d.start + k === state.index, skipped: state.skipped.has(p) };
  });
  const ghost = ghostRow(), at = tracks.findIndex((tr) => tr.current);
  if (ghost && at >= 0) tracks.splice(at + 1, 0, { ghost });
  changerView.render(shownChanger = { slots, playingSlot: here.slot, tracks, heading: [t('DISC {n}', { n: here.slot + 1 }), d.kind === 'cdr' ? 'CD-R' : null, discLabel(d), d.artist].filter(Boolean).join(' · ') });
}

// The queue, as 2.14 showed it: every song, the one playing marked, PLAY NEXT's run tagged; drag to reorder, × to remove.
function renderQueueList() {
  const list = $('queue-list');
  if (!state.queue.length || state.index < 0) {
    $('queue-info').textContent = t('QUEUE EMPTY');
    $('queue-next').textContent = t('OPEN THE SHELF (S) AND PICK AN ALBUM — OR DROP SONGS HERE');
    list.replaceChildren();
    return;
  }
  $('queue-info').textContent = (state.shuffle !== 'OFF' ? t('QUEUE {at} / {of} · SHUFFLED', { at: state.index + 1, of: state.queue.length }) : t('QUEUE {at} / {of}', { at: state.index + 1, of: state.queue.length }))
    + (state.repeat === 'ALL' ? ` · ${t('ROUND AGAIN AT THE END')}` : '');
  const next = upcomingIndex();
  $('queue-next').textContent = state.repeat === 'TRACK' ? t('REPEATING THIS TRACK')
    : next >= 0 && next !== state.index ? t('UP NEXT · {song}', { song: (ensureDetails(state.queue[next]), queueDisplay(state.queue[next])) }) : t('END OF QUEUE');
  const scrollTop = list.scrollTop;
  const rows = state.queue.map((p, i) => {
    ensureDetails(p);
    const d = detailsCache.get(p);
    const remove = el('button', { class: 'glyph-x', title: t('Remove from queue'), onClick: (e) => { e.stopPropagation(); removeFromQueue(i); } }, '×');
    const next = !!state.nextUp && i > state.index && i >= state.nextUp.start && i < state.nextUp.end;
    const row = el('div', { class: `queue-row${i === state.index ? ' active' : ''}${i === drag.index ? ' dragging' : ''}${isSkipped(i) ? ' skipped' : ''}`, title: isSkipped(i) ? `${t('Play {song}', { song: queueDisplay(p) })}\n${t('Marked SKIP: passed over as the music moves on')}` : t('Play {song}', { song: queueDisplay(p) }) },
      el('span', { class: 'num' }, `${i + 1}.`),
      el('span', { class: 'entry' }, queueDisplay(p)),
      next ? el('span', { class: 'next-tag', title: t('Plays next') }, t('NEXT')) : null,
      el('span', { class: 'east' }, el('span', { class: 'duration' }, formatDuration(d ? d.duration : 0)), remove));
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target === remove) return;
      drag.index = i; drag.lastY = e.clientY; drag.accumulated = 0; drag.moved = false;
      list.setPointerCapture(e.pointerId);
    });
    return row;
  });
  const ghost = ghostRow();
  const was = list.querySelector('.queue-row.active')?.offsetTop ?? null;
  list.replaceChildren(...(ghost ? [...rows.slice(0, state.index + 1), ghost, ...rows.slice(state.index + 1)] : rows));
  list.scrollTop = scrollTop;
  // The song playing moved on: the list follows it, if it went out of sight (scrolling by hand is left alone otherwise).
  if (state.index !== shownIndex && drag.index < 0) followPlaying(rows[state.index], was, list); // the next songs in sight too
  shownIndex = state.index;
}
let shownIndex = -1;
// A hidden track's row, under the song playing (the row, not every row of that file): no number, no time; ??? until
// it's been heard, then its name, a click away once it's been found.
let ghostShown = null;
function ghostRow() {
  const h = state.hidden;
  if (!h || !h.revealed || h.path !== state.loadedPath) return null;
  const name = h.found || state.hiddenPhase === 'hidden' ? h.name || t('Hidden track') : null;
  const row = el('div', { class: `queue-row ghost${h.found ? ' found' : ''}`, title: h.found ? t('Play {song}', { song: name }) : '', onClick: () => { if (h.found && state.hidden === h) seekTo(h.hiddenStart); } },
    el('span', { class: 'entry' }, `· · ·  ${name || '???'}`));
  if (name && ghostShown === '???') pulseClass(row, 'fade-in'); // the ??? turns into its name
  ghostShown = name || '???';
  return row;
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
      ({ queue: state.queue, index: state.index } = moveItem(state.queue, state.index, drag.index, target));
      drag.index = target;
      drag.accumulated -= dir * step;
    }
    if (changed) { upcomingCache = null; renderQueue(); saveQueueSoon(); }
  });
  // The list captures the pointer on press (so a drag keeps tracking outside the row), which also means the
  // browser delivers the release — and the click — to the list, not the row. So "pressed and released without
  // dragging" is handled here: that's a click on the row, and plays it.
  const end = (e) => {
    if (drag.index < 0) return;
    const index = drag.index, moved = drag.moved;
    drag.index = -1; drag.moved = false;
    if (moved) { renderQueue(); spotifyResync(); } // Spotify hears the new order once, when the row is let go
    else if (e.type === 'pointerup' && index < state.queue.length) goTo(index); // (so PREVIOUS, shuffled, comes back to it)
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

// What's written on a disc: its title, or for an untitled CD-R "MIX · 14 OCT" — in the language of the day.
function discLabel(d) {
  if (d.title) return d.title;
  if (d.kind !== 'cdr') return t('CD-R');
  const made = changer.cdrMadeAt(d);
  return made ? t('MIX · {date}', { date: made.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).toUpperCase() }) : t('MIX');
}
// What a CD-R is, said when the mouse is on it: a home-made disc of songs added one at a time (or of a playlist).
function discNote(d) {
  if (d.kind !== 'cdr') return null;
  if (d.title) return t('A CD-R made from the playlist “{name}”', { name: d.title });
  const made = changer.cdrMadeAt(d);
  return made ? t('A CD-R of songs added one at a time, put together on {date}', { date: made.toLocaleDateString(locale, { day: 'numeric', month: 'long' }) })
    : t('A CD-R of songs added one at a time');
}
async function discOf(paths, { kind = null, title = null } = {}) {
  const details = await Promise.all(paths.map((p) => detailsCache.get(p) || cdp.details(p, { withCover: false }).catch(() => null)));
  return changer.discFor({ kind, paths, details, title });
}
// Into the changer: a free slot, a finished disc's, or the one the user picks. `startPlayback: false` leaves loading the
// song to the caller (the tray). (`item`, not `disc`: `disc` is the big disc's renderer everywhere else in app.js.)
// → { slot } or { cancelled: true }.
// The queue (2.14): songs to the end, or (`next`) straight after the one playing as PLAY NEXT's run; `play` plays the
// first of them. Files put into a queue holding a Spotify disc replace it, like a new CD. A song to play that's in the
// queue already is played there.
function queueAdd(songs, { play = false, next = false, startPlayback = true } = {}) {
  if (spotifyDiscIn() && !songs.some(isSpotifyUri)) { insertDisc(songs); return { slot: -1 }; }
  if (play && startPlayback && songs.length === 1 && state.queue.includes(songs[0])) { goTo(state.queue.indexOf(songs[0])); return { slot: -1 }; }
  let first;
  if (next && state.queue.length && state.index >= 0 && !play) {
    const r = insertNext(state.queue, state.index, state.nextUp, songs);
    state.queue = r.queue; state.nextUp = r.nextUp; first = r.nextUp.end - songs.length;
    setStatus(songs.length === 1 ? t('PLAYS NEXT') : t('{n} TO PLAY NEXT', { n: songs.length }));
  } else {
    first = state.queue.length;
    state.queue.push(...songs);
    setStatus(t('ADDED {n} TO QUEUE', { n: songs.length }));
  }
  upcomingCache = null;
  if (play && startPlayback) state.index = first;
  else if (state.index < 0) state.index = first;
  else { renderQueue(); saveQueueSoon(); spotifyResync(); return { slot: -1 }; }
  renderQueue(); saveQueueSoon();
  if (startPlayback) load(state.queue[state.index]);
  return { slot: -1 };
}
function removeFromQueue(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.queue.splice(i, 1);
  state.nextUp = afterRemove(state.nextUp, i);
  if (!state.queue.length) resetToIdle(t('QUEUE EMPTY'));
  else if (i === state.index) { state.index = Math.min(i, state.queue.length - 1); load(state.queue[state.index]); }
  else if (i < state.index) state.index--;
  spotifyResync();
  renderQueue(); saveQueueSoon();
}
// `remote`: the phone's — never onto the tray, and a full changer answers { full: true } instead of asking here (the
// phone asks, and sends the disc again with the `slot` to take out, used only if the changer is still full).
async function loadDisc(item, tracks, { play = false, next = false, startPlayback = true, remote = false, slot: chosen = null } = {}) {
  if (!remote && startPlayback && disc.trayOpen && !state.trayBusy) { await putDiscOnTray(tracks, 0, undefined, { disc: item }); return { slot: -1 }; } // music dropped on the open tray
  if (!state.changerMode) return queueAdd(tracks, { play, next, startPlayback });
  // One song to play, already on a disc in the changer (from SEARCH or HISTORY): it's played there, not loaded again.
  if (play && startPlayback && tracks.length === 1 && state.queue.includes(tracks[0])) { goTo(state.queue.indexOf(tracks[0])); return { slot: changer.slotOf(ch(), state.index).slot }; }
  let r = changer.load(ch(), item, tracks, { play, next });
  if (r.full && remote) {
    if (chosen == null) return { full: true };
    r = changer.load(ch(), item, tracks, { play, next, slot: chosen }); // the slot playing (by now) gives -1: cancelled below
  }
  if (r.full) {
    // One question at a time: a second disc waits for the first answer (and is asked about the changer as it is then).
    const asked = picking.then(() => { const again = changer.load(ch(), item, tracks, { play, next }); return again.full ? app.onFullChanger(ch()) : -1; });
    picking = asked.catch(() => null);
    const slot = await asked;
    if (slot == null || !state.changerMode) return { cancelled: true };
    r = changer.load(ch(), item, tracks, { play, next, slot: slot < 0 ? null : slot });
    if (r.full) return { cancelled: true };
    if (r.slot < 0 && !r.already) { setStatus(t('THAT DISC IS PLAYING NOW · PICK ANOTHER')); return { cancelled: true }; }
  }
  if (r.already) {
    setStatus(t('ALREADY IN SLOT {n}', { n: r.slot + 1 }));
    const at = changer.playSlot(ch(), r.slot) + Math.max(0, changer.tracksOf(ch(), r.slot).indexOf(tracks[0])); // the song asked for
    if (play && startPlayback) goTo(at); else if (play) apply(changer.moveTo(ch(), at));
    else { changerView.turnTo(r.slot); setTimeout(renderQueue, 1600); } // the tray shows where it is, then turns back
    return { slot: r.slot };
  }
  if (r.slot < 0) return { cancelled: true };
  const wasPlaying = state.index >= 0 && !!engine.deck;
  apply(r.changer);
  setStatus(!r.replaced ? t('DISC {n} IN', { n: r.slot + 1 }) : r.replaced.kind === 'album' ? t('DISC {n} IN · {title} WENT BACK TO THE SHELF', { n: r.slot + 1, title: discLabel(r.replaced) })
    : t('DISC {n} IN · {title} TAKEN OUT', { n: r.slot + 1, title: discLabel(r.replaced) }));
  renderQueue(); saveQueueSoon(); spotifyResync();
  if (startPlayback && (play || !wasPlaying)) load(state.queue[state.index], { autoPlay: true }); // an idle player plays it, as before the changer
  return { slot: r.slot };
}
// SKIP (a song's in its case on the shelf): not played as the music moves on — still played when picked. What comes
// next is worked out again, and the song waiting for a gapless start dropped.
async function toggleSkip(p) {
  const on = !state.skipped.has(p);
  state.skipped = new Set(await cdp.skips.set(p, on).catch(() => [...state.skipped]));
  upcomingCache = null; dropPrepared(); renderQueue();
  setStatus(state.skipped.has(p) ? t('PASSED OVER FROM NOW ON') : t('PLAYED AGAIN AS THE MUSIC MOVES ON'));
  return state.skipped.has(p);
}
// The SKIP marks as the main process has them now (moved with moved songs): what comes next worked out again.
async function reloadSkips() {
  state.skipped = new Set(await cdp.skips.list().catch(() => [...state.skipped]));
  upcomingCache = null; dropPrepared(); renderQueue();
}
// FILL on the shelf (changer mode): albums it picked, into every slot that's free or holds a finished disc; an idle
// player starts on the first of them.
function fillChanger(picks, { quiet = false } = {}) {
  if (!state.changerMode) return { loaded: [] };
  const r = changer.fillWith(ch(), picks);
  if (!r.loaded.length) { if (!quiet) setStatus(r.full ? t('THE CHANGER IS FULL') : t('THOSE ALBUMS ARE IN THE CHANGER ALREADY')); return r; }
  const wasPlaying = state.index >= 0 && !!engine.deck;
  apply(r.changer);
  upcomingCache = null; dropPrepared(); // what comes next may be one of them now
  setStatus(r.loaded.length === 1 ? t('DISC {n} IN', { n: r.loaded[0] + 1 }) : t('{n} DISCS IN', { n: r.loaded.length }));
  renderQueue(); saveQueueSoon(); spotifyResync();
  if (!wasPlaying) load(state.queue[state.index], { autoPlay: true });
  return r;
}
// FILL · KEEP IT FULL (changer mode; till it's turned off, the changer put away or CDPlayer closed): a disc played to
// its end makes room for another album picked from those the shelf showed — `pick` () → picks — so the music never
// runs out. Done a moment after the next song has begun (not under a song changing over), or at once when nothing's
// left to play.
let keepFull = null;
function keepChangerFull(pick) {
  keepFull = state.changerMode && pick ? pick : null;
  if (keepFull) refillChanger();
}
const keepingFull = () => !!keepFull;
function refillChanger() {
  if (!keepFull || !state.changerMode) return false;
  const loaded = fillChanger(keepFull(), { quiet: true }).loaded.length > 0;
  aimOnward();
  return loaded;
}
// …and when the disc playing ends, on to the nearest one not played yet round the changer (back to slot 1 too, which
// it wouldn't do without REPEAT ALL), else to the nearest one at all: kept full, the music doesn't stop. PLAY NEXT's
// choice stands.
function aimOnward() {
  const c = ch();
  if (!keepFull || c.nextDisc != null || state.index < 0) return;
  const to = changer.discAfter(c, isSkipped);
  if (to < 0) return;
  apply({ ...c, nextDisc: to });
  upcomingCache = null; dropPrepared(); renderQueue(); saveQueueSoon();
}
async function addToQueue(items, { sorted = false, play = false, next = false, title = null } = {}) {
  const songs = sorted ? items : await cdp.collectAudio(items);
  if (!songs.length) { setStatus(t('NO SUPPORTED AUDIO FOUND')); return; }
  if (disc.trayOpen && !state.trayBusy) { await putDiscOnTray(songs); return; }
  if (!state.changerMode) { queueAdd(songs, { play, next }); return; }
  const item = await discOf(songs, { title });
  // Loose songs (SEARCH, HISTORY) go on the CD-R being put together, while there is one: a compilation, not a disc each.
  const cdr = item.kind === 'cdr' && !title && !play && !next ? changer.openCdr(ch()) : -1;
  if (cdr >= 0) {
    apply(changer.appendTo(ch(), cdr, songs));
    setStatus(t('ON THE CD-R IN SLOT {n}', { n: cdr + 1 }));
    renderQueue(); saveQueueSoon(); spotifyResync();
    return;
  }
  await loadDisc(item, songs, { play, next });
}
/** PLAY NEXT: into the changer, to play when the disc playing ends. */
const playNext = (items, opts = {}) => addToQueue(items, { ...opts, next: true });
// CLEAR takes every disc out, and can be taken back for a few seconds: the button turns into UNDO CLEAR (and ⌘Z /
// Ctrl+Z works), and the changer comes back with the same track at the same spot, playing if it was.
let undoClear = null;
// The music of the mode in use, to put back later (undo, or switching modes) — and putting it back.
function takeStore() { return state.changerMode ? { changer: ch() } : { queue: state.queue.slice(), index: state.index, nextUp: state.nextUp }; }
function putStore(s) {
  if (s && s.changer) { apply(s.changer); return; }
  state.queue = s && s.queue ? s.queue.slice() : []; state.index = s && s.queue ? s.index : -1; state.nextUp = (s && s.nextUp) || null;
  upcomingCache = null;
}
// Files gone (an Audio CD out, Spotify disconnected) leave the music; the changer stays on the same song.
function dropPaths(gone) {
  const other = stores[state.changerMode ? 'QUEUE' : 'CHANGER'];
  if (other && other.changer) other.changer = changer.removePaths(other.changer, gone);
  else if (other && other.queue) { const at = other.queue[other.index]; other.queue = other.queue.filter((p) => !gone.has(p)); other.index = at && !gone.has(at) ? other.queue.indexOf(at) : -1; other.nextUp = null; }
  if (state.changerMode) { apply(changer.removePaths(ch(), gone)); return; }
  const current = state.queue[state.index];
  state.nextUp = null; state.queue = state.queue.filter((p) => !gone.has(p));
  state.index = current && !gone.has(current) ? state.queue.indexOf(current) : -1;
  upcomingCache = null;
}
function clearQueue() {
  if (!state.queue.length) return;
  if (undoClear) clearTimeout(undoClear.timer);
  clearTimeout(refillTimer);
  undoClear = { store: takeStore(), position: engine.position, playing: engine.playing, timer: setTimeout(() => { undoClear = null; renderQueue(); }, UNDO_CLEAR_SECONDS * 1000) };
  putStore(state.changerMode ? { changer: changer.clear() } : { queue: [], index: -1, nextUp: null });
  resetToIdle(state.changerMode ? t('CHANGER EMPTIED') : t('QUEUE CLEARED'));
  setStatus(t('{what} · {key} BRINGS IT BACK', { what: state.changerMode ? t('CHANGER EMPTIED') : t('QUEUE CLEARED'), key: state.platform === 'darwin' ? '⌘Z' : 'CTRL+Z' }));
  renderQueue(); saveQueueSoon();
}
function undoClearQueue() {
  if (!undoClear || state.queue.length) return;
  const u = undoClear;
  clearTimeout(u.timer); undoClear = null;
  putStore(u.store);
  renderQueue(); saveQueueSoon();
  setStatus(state.changerMode ? t('CHANGER RESTORED') : t('QUEUE RESTORED'));
  if (state.index >= 0) load(state.queue[state.index], { autoPlay: u.playing, startAt: u.position });
}
/** EJECT: the disc in `slot` comes out; the playing one's going moves on to the next disc. ⌘Z puts it back, as it was. */
// Each EJECT can be taken back in turn, latest first (two quick ejects, two ⌘Z), for a few seconds after the last.
const undoEjects = [];
// Which discs are in which slots (not what's been played on them, which changes as the music goes on): what an undo
// checks hasn't changed since.
const discsIn = () => state.changer.slots.map((d) => (d ? `${d.id}:${d.end - d.start}` : '-')).join('|'); // [{ store, position, playing, wasOn, after: the changer's slots just after }]
let undoEject = null, undoEjectTimer = null; // undoEject: the latest of them, or null
function ejectSlot(slot) {
  if (!Number.isInteger(slot) || !state.changer || !ch().slots[slot]) return; // an empty slot (a second click): nothing to take out
  const playing = changer.slotOf(ch(), state.index);
  const wasOn = playing && playing.slot === slot;
  const before = { store: takeStore(), position: engine.position, playing: engine.playing, wasOn };
  apply(changer.eject(ch(), slot, modes()));
  undoEjects.push({ ...before, after: discsIn() });
  undoEject = undoEjects[undoEjects.length - 1];
  clearTimeout(undoEjectTimer);
  undoEjectTimer = setTimeout(() => { undoEjects.length = 0; undoEject = null; }, UNDO_CLEAR_SECONDS * 1000);
  const said = () => setStatus(t('DISC {n} OUT · {key} PUTS IT BACK', { n: slot + 1, key: state.platform === 'darwin' ? '⌘Z' : 'CTRL+Z' }));
  if (!state.queue.length || state.index < 0) { resetToIdle(t('CHANGER EMPTY')); said(); } else if (wasOn) load(state.queue[state.index]).then(said); else said(); // after the next disc's own news
  renderQueue(); saveQueueSoon(); spotifyResync();
}
function undoEjectSlot() {
  const u = undoEjects.pop();
  undoEject = undoEjects[undoEjects.length - 1] || null;
  // Only while nothing else changed in the changer since: else it would take back more than the one disc.
  if (!u || !state.changerMode) return false;
  if (discsIn() !== u.after) { undoEjects.length = 0; undoEject = null; setStatus(t('CAN’T PUT IT BACK · THE CHANGER CHANGED SINCE')); return false; }
  const playingNow = state.loadedPath;
  putStore(u.store);
  // Another disc's song went on playing meanwhile (maybe the next one by now): the changer stays on it.
  const at = !u.wasOn && playingNow ? state.queue.indexOf(playingNow) : -1;
  if (at >= 0) apply(changer.moveTo(ch(), at));
  renderQueue(); saveQueueSoon(); spotifyResync();
  const said = () => setStatus(t('DISC BACK IN'));
  if (at < 0 && state.index >= 0) load(state.queue[state.index], { autoPlay: u.playing, startAt: u.position }).then(said); else said();
  return true;
}
// A song that wouldn't play: its name shown (not the one before it), with nothing to play.
function showUnplayed(path, d) {
  state.details = null; state.detailsPath = null; state.lyrics = null;
  resetHidden();
  disc.setWear(null);
  setTrackTitle((d && d.title) || displayName(path), (d && d.artist) || null);
  $('track-source').textContent = '';
  deckDisplay.setTime(0, 0);
  progress.setValue(0); progress.setWaveform(null);
  setCover((d && d.cover) || null); disc.lookingUp = false;
  $('tags-button').hidden = true;
  updateQualityBadge();
  lyricsChanged();
}
function resetToIdle(message) {
  state.index = -1; state.loadToken++;
  stopStreamReading();
  engine.stop();
  state.loadedPath = null; state.details = null; state.lyrics = null;
  resetHidden(); // no ? on an empty seek bar, no HIDDEN badge
  disc.setWear(null);
  showInPlayer(null);
  setTrackTitle(t('Pick a track to get started.'), null);
  $('track-source').textContent = t('YOUR MUSIC LIBRARY');
  document.title = 'CDPlayer';
  deckDisplay.setTime(0, 0);
  progress.setValue(0); progress.setWaveform(null);
  setCover(null); disc.lookingUp = false;
  disc.discPresent = false;
  setPlaying(false);
  lyricsChanged();
  $('tags-button').hidden = true;
  updateQualityBadge(); showSoundCheck(null, true); // no song: no format, no gain
  flushFoundSoon();
  setStatus(message);
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

// ---- Loading & playback ----------------------------------------------------------------------------------------

// Settings → QUALITY: before a song loads, the engine (and, through the main process, the output device) is set to
// the rate it should play at. → true when the engine was rebuilt, so the song can't crossfade in.
// LOSSLESS / HI-RES: the rate a song plays at within its album — the highest of that album's songs in the queue (by
// album and album artist, as the changer makes discs), so an album of 44.1 and 96 kHz songs plays through at 96
// instead of stopping between them for the device to switch.
function albumAimFor(path, details) {
  const own = details && details.format && details.format.sampleRate;
  const key = (d) => (d && d.album ? `${(d.credits && d.credits.albumArtist) || d.artist || ''}\n${d.album}`.toLowerCase() : null);
  const album = key(details), rates = [own];
  if (album && own) for (const p of state.queue) {
    const d = p === path ? null : detailsCache.get(p);
    if (d && key(d) === album && d.format) rates.push(d.format.sampleRate);
  }
  return albumRate(state.quality, rates);
}

async function applyQuality(details, token, path) {
  if (state.quality === 'HIGH') {
    state.rateInfo = null;
    return engine.customRate ? engine.setRate(null) : false;
  }
  const fileRate = details && details.format && details.format.sampleRate;
  const aimed = albumAimFor(path, details);
  if (!aimed) return false;
  const known = state.rateInfo;
  if (known && known.aimed === aimed && engine.rate === (known.switched ? known.deviceRate : aimed)) {
    state.rateInfo = { ...known, fileRate };
    return false;
  }
  engine.pause(); // the old song mustn't play on while the device's format changes under it (that pops on Windows)
  const result = await cdp.outputRate.set(state.output, aimed).catch(() => null);
  if (token !== state.loadToken) return false;
  state.rateInfo = {
    fileRate, aimed, deviceRate: result ? result.rate : state.systemRate, // not switched: the device stays as the system has it
    switched: !!(result && result.switched), bluetooth: !!(result && result.bluetooth),
  };
  const playAt = result && result.switched ? result.rate : aimed;
  if (playAt === engine.rate) return false;
  return engine.setRate(playAt);
}

// `seamless`: the track is already playing — started on the standby deck as the last one ended (gapless) — so only
// what's shown and kept is brought up to date.
async function load(path, { autoPlay = true, allowCrossfade = false, startAt = 0, reload = false, seamless = false } = {}) {
  const token = ++state.loadToken;
  if (reload && path === state.loadedPath && scrobbleFor === token - 1) scrobbleFor = token; // the same song again: heard so far, and sent, as it was
  stopStreamReading();
  // The tray's out: the new song waits on it, and plays when it closes (nothing plays from an open tray).
  if (disc.trayOpen && autoPlay && !seamless) { autoPlay = false; if (trayResume) trayResume.playing = true; }
  preparedNext = null;
  dropJog();
  disc.discPresent = true;
  let fade = allowCrossfade && engine.playing && crossfadeSeconds() > 0 ? crossfadeSeconds() : 0;
  state.crossfadeStarted = false;
  if (state.loadedPath !== path) flushFoundSoon();
  state.loadedPath = path;
  resetHidden();
  showSoundCheck(null); // until it's known (and hidden for Spotify and CDs)
  showInPlayer(path);
  $('tags-button').hidden = isStream(path); // (no file to write tags to)
  if (isSpotifyUri(path)) { progress.setWaveform(null); await loadSpotify(path, token, { autoPlay, startAt }); return; }
  progress.setWaveform(null);
  const detailsPromise = cdp.details(path, { withCover: true }).catch(() => null);
  // A cue sheet track is a stretch of an album-length file, so which file and where it starts must be known first.
  const cue = cueRef(path) ? ((await detailsPromise) || {}).cue : null;
  if (token !== state.loadToken) return;
  if (cueRef(path) && !cue) {
    engine.stop(); setPlaying(false);
    setStatus((await cdp.exists(path)) ? t('TRACK NOT FOUND IN CUE SHEET') : t('FILE NO LONGER FOUND'));
    return;
  }
  if (!seamless && (state.quality !== 'HIGH' || engine.customRate)) {
    const rateChanged = await applyQuality(await detailsPromise, token, path);
    if (token !== state.loadToken) return;
    if (rateChanged) fade = 0; // a new context: nothing left to fade out of
  } else if (seamless && state.rateInfo) { // the rate stays as it is; the badge says this song's own
    const format = ((await detailsPromise) || {}).format;
    if (token !== state.loadToken) return;
    if (format && format.sampleRate) state.rateInfo = { ...state.rateInfo, fileRate: format.sampleRate };
  }
  const soundMode = evensOut(path) ? state.soundCheck : 'OFF';
  const knownLevel = await soundCheck.known(path, soundMode).catch(() => null);
  if (token !== state.loadToken) return;
  showSoundCheck(knownLevel);
  const trim = knownLevel ? knownLevel.linear : 1;
  const url = cdp.mediaUrl(cue ? cue.file : path);
  if (seamless) {
    engine.setTrim(trim); // the prepared deck is already playing; Sound Check as it is now (it may have changed since)
    state.deckToken = token;
  } else if (cue && !fade && startAt === 0 && engine.continuesInto(url, cue.start)) {
    engine.setSegment(cue); // the previous track runs straight into this one: keep playing, no reload, no gap
    engine.setTrim(trim);
    state.deckToken = token;
  } else {
    // A streamed song takes a few seconds to come (YouTube's more): the disc reads, as when the tray closes.
    if (isStream(path)) { streamReading = token; disc.reading = true; setStatus(t('READING…')); }
    const doneReading = () => stopStreamReading(token);
    try {
      const ok = await engine.load(url, { autoPlay: false, crossfadeSeconds: fade, segment: cue, trim });
      doneReading();
      if (!ok || token !== state.loadToken) return;
      state.deckToken = token; // the engine holds this load's track now: its next one may be prepared
      passedOver = 0;
    } catch {
      doneReading();
      if (token !== state.loadToken) return;
      setPlaying(false);
      const why = isStream(path) ? ((await cdp.stream.locked(path).catch(() => false)) ? t('THAT SONG IS LOCKED BY ITS LABEL (DRM)') : t("COULDN'T STREAM THAT SONG"))
        : (await cdp.exists(path)) ? t("COULDN'T PLAY THAT FILE") : t('FILE NO LONGER FOUND');
      if (token !== state.loadToken) return;
      showUnplayed(path, await detailsPromise);
      setStatus(why);
      passOver(token);
      return;
    }
    if (startAt > 0) engine.seek(Math.min(startAt, engine.duration));
  }
  followSoundCheck(path, soundMode, token);
  if (reload) recordedFor = token; // the same song again: already in HISTORY
  if (autoPlay && !seamless) await engine.play();
  if (token !== state.loadToken) return;
  setPlaying(autoPlay);
  if (fade) setStatus(t('CROSSFADING'));
  else if (seamless && engine.crossfading) setStatus(t('AUTOMIX')); // mixing in: the last song still winding down under it
  else if (!autoPlay) setStatus(t('TRACK LOADED'));
  deckDisplay.setTime(engine.position, engine.duration);
  updateProgressUi(true);
  renderQueue(); saveQueueSoon();

  // (a streamed song's quality is known once its sound has been found: asked again, now; its cover is kept in main)
  const details = (await (isStream(path) ? cdp.details(path, { withCover: true }).catch(() => null) : detailsPromise)) || { title: displayName(path), artist: null, album: null, lyrics: null, cover: null, ext: extension(path), duration: engine.duration };
  if (token !== state.loadToken) return;
  state.details = details; state.detailsPath = path;
  detailsCache.set(path, { ...details, cover: undefined, duration: details.duration || engine.duration });
  setTrackTitle(details.title, details.artist); // (A of "A / B" once it's known to hide B: followHidden)
  updateWear();
  updateQualityBadge();
  fadeInNowPlaying();
  const ext = details.quality || details.ext || extension(path);
  const canLookUp = !details.cover && ((!!details.title && !details.unnamed) || !isAudioCdTrack(path)); // (lookUpCover: the album's cover, then by name)
  await setCover(details.cover);
  disc.lookingUp = canLookUp;
  const fromCd = isAudioCdTrack(path);
  $('tags-button').hidden = fromCd || isStream(path); // a CD can't be written to (nor a streamed song)
  $('track-source').textContent = sourceLine(details, ext, fromCd);
  state.coverFrom = details.cover ? (fromCd ? 'MusicBrainz' : t('In the file')) : null; // where the cover came from, for the booklet
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
    const waveform = engine.computeWaveform(cdp.mediaUrl(path));
    waveform.then((w) => { if (token === state.loadToken) progress.setWaveform(w.buckets); }).catch(() => {});
    followHidden(path, details, token, waveform.then((w) => w.power, () => null));
  }
}

// ---- Hidden tracks (hidden-track.js) -----------------------------------------------------------------------------
// A song hidden after minutes of silence at the end of a disc's last track. The silence plays, as on the CD, counted
// down to in the pill; the hidden song is named when it begins. Nothing gives it away before the silence the first
// time; once 8 s of it have been heard it's "found", and shown from the start after that.

function resetHidden() {
  state.hidden = null; state.hiddenPhase = null;
  progress.setMarker(null);
  $('hidden-badge').hidden = true;
}
// What hidden.json knows of the file at once, else what the waveform's decode (`power`) shows once it's done.
async function followHidden(path, details, token, power) {
  const got = await cdp.hidden.get(path).catch(() => null);
  if (!got || token !== state.loadToken) return;
  const track = details.credits && details.credits.track;
  const last = got.lastOfDisc ?? !!(track && track.of && track.no === track.of);
  let entry = got.entry;
  if (entry === undefined) {
    const p = await power;
    if (!p || token !== state.loadToken) return;
    const found = detectHidden(p);
    entry = found ? { ...found, name: null, asked: false, found: false } : null;
    cdp.hidden.put(path, entry).catch(() => {});
  }
  if (!entry || !last) return;
  const h = state.hidden = { ...entry, name: hiddenName(entry, details), path, revealed: entry.found }; // (its name from "A / B" too)
  if (!h.name && !h.asked && !splitTitle(details.title)) { // asked once; kept to itself until the hidden song begins
    cdp.hidden.name({ artist: details.artist, title: displayTitle(details), duration: engine.duration }).then((r) => {
      if (!r || r.networkError) return;
      cdp.hidden.update(path, { name: r.name, asked: true }).catch(() => {});
      h.name = r.name; h.asked = true;
    }).catch(() => {});
  }
  if (shownTitle(details, h) !== details.title) setTrackTitle(shownTitle(details, h), details.artist);
  showHidden();
  followHiddenPhase();
}
function showHidden() {
  const h = state.hidden;
  progress.setMarker(h && h.revealed && engine.duration ? (h.hiddenStart * 1000) / engine.duration : null);
  renderQueue();
}
// Each tick (and seek): the title, badge, pill and what the media keys and Discord say follow where the position is.
function followHiddenPhase() {
  const h = state.hidden;
  if (!h || h.path !== state.loadedPath) return;
  const phase = hiddenPhase(h, engine.position), was = state.hiddenPhase;
  if (phase !== was) {
    state.hiddenPhase = phase;
    if (phase !== 'song' && !h.revealed) { h.revealed = true; showHidden(); }
    if (phase === 'hidden') {
      if (was) setStatus(t('HIDDEN TRACK'));
      setTrackTitle(hiddenName(h, state.details) || t('Hidden track'), state.artistText);
    } else if (was === 'hidden') setTrackTitle(shownTitle(state.details, h), state.artistText);
    $('hidden-badge').hidden = phase !== 'hidden';
    // Out of the silence (a seek back into the song): the countdown leaves the pill.
    if (was === 'silence' && phase === 'song' && !statusHeld) setText($('status'), STATUS_DOT + stateStatus());
    if (was) { updateMediaSession(); renderQueue(); }
  }
  if (phase === 'hidden' && !h.found && engine.playing && engine.position - h.hiddenStart >= HEARD_SECONDS) {
    h.found = true;
    cdp.hidden.update(h.path, { found: true }).catch(() => {});
    renderQueue();
  }
  if (phase === 'silence' && engine.playing && !statusHeld) setText($('status'), STATUS_DOT + stateStatus());
}

// Under the artist: the album (and its year), then the format — or, for a file with no name in its tags, what to do.
// Where the cover came from is the booklet's to say.
const yearOf = (d) => { const m = /\d{4}/.exec(String(d.year || (d.credits && d.credits.released) || '')); return m ? m[0] : null; };
function sourceLine(d, ext, fromCd = false) {
  if (!d.title || d.unnamed) return t('NO TAGS · ADD THEM WITH TAGS');
  return [fromCd ? t('AUDIO CD') : null, d.album ? `${d.album}${yearOf(d) ? ` (${yearOf(d)})` : ''}` : null, ext].filter(Boolean).join(' · ');
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
  // The album's cover first, the one its case on the shelf has (a cover image beside the files, or the album found
  // online) — a search by the song's name finds its single's. Still searched by name when the name was guessed.
  const own = isAudioCdTrack(path) ? null : await cdp.shelfCoverFull(path).catch(() => null);
  if (token !== state.loadToken || state.loadedPath !== path) return;
  let found = false; // the album's cover is on: the name searched for only to put it right
  if (own) {
    const img = await decodeCover(own);
    if (token !== state.loadToken) return;
    if (img) {
      applyCover(img);
      state.coverFrom = t('The album’s cover');
      state.details.cover = own;
      updateMediaSession();
      found = true;
      if (!details.nameGuessed) { disc.lookingUp = false; return; }
    }
  }
  if (!details.title || details.unnamed) { disc.lookingUp = false; return; }
  const result = await cdp.findCover({ ...lookupName(details), album: details.album }).catch(() => ({ cover: null, networkError: true }));
  if (token !== state.loadToken || state.loadedPath !== path) return;
  disc.lookingUp = false;
  useFoundName(details, path, result.name);
  if (result.cover && !found) {
    const img = await decodeCover(result.cover);
    if (token !== state.loadToken) return; // another track was picked while the picture decoded
    applyCover(img);
    state.coverFrom = result.source;
    state.details.cover = result.cover;
    state.details.coverUrl = result.url || null;
    if (state.saveFound) saveFoundLater(path, { cover: result.cover });
    updateMediaSession();
  }
}
async function lookUpLyrics(details, token) {
  const found = await cdp.findLyrics({ ...lookupName(details), album: details.album, duration: details.duration || engine.duration }).catch(() => null);
  if (!found || token !== state.loadToken || !takesOnline(details.lyrics, found.lyrics)) return;
  // (lrclib's entries are user-submitted and some have artist and title swapped, so unlike a cover, the name lyrics
  // were found under never corrects the displayed name.)
  state.lyrics = withoutHeader(found.lyrics, { title: details.title, artist: details.artist }); state.lyricsSource = found.source || null;
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
  if (!path || /\.cue#\d+$/i.test(path) || isSpotifyUri(path) || isStream(path)) return;
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
  }, (Math.max(crossfadeSeconds(), automixOn() ? MAX_OVERLAP : 0) + 2) * 1000);
}
// YOUTUBE MUSIC & SOUNDCLOUD: on only with yt-dlp there to stream with.
async function setStreaming(on, say = setStatus) {
  // (turned on the first time: yt-dlp is got for it, unless the user has one)
  if (on && !(await cdp.stream.available().catch(() => null))) {
    say(t('GETTING YT-DLP…'));
    if (!(await cdp.stream.install().catch(() => null))) { say(t('COULDN’T GET YT-DLP · CHECK THE CONNECTION')); return false; }
    say(t('YT-DLP IS READY · SEARCH WITH /'));
  }
  state.streaming = !!on; saveSettingsSoon();
  return true;
}
function setSaveFound(on) { state.saveFound = on; if (!on) pendingFound.clear(); saveSettingsSoon(); }
function setLyricsOffset(ms) { state.lyricsOffset = ms; saveSettingsSoon(); }
// Where the song is for the lyrics: what's being heard (the output's latency taken off — only while playing: paused,
// nothing is on its way to the speakers) and the user's offset. A clicked line plays from where it's heard.
const heardLatency = () => (engine.playing ? engine.outputLatency : 0);
const lyricsPosition = () => heardPosition(engine.position, heardLatency(), state.lyricsOffset);
const seekToLyric = (time) => seekTo(playbackTimeFor(time, heardLatency(), state.lyricsOffset));
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
  if (!openKaraoke(app)) setStatus(state.lyrics ? t('THESE LYRICS AREN’T TIMED') : t('NO LYRICS FOR THIS SONG'));
  else panels.closeLyricsPanel();
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
  // (PLAYER LOOK: COVER shows it flat, as a streaming app does, instead of on the disc)
  $('cover-art').style.backgroundImage = img ? `url("${img.src}")` : '';
  $('cover-art').classList.toggle('none', !img);
  karaokeCover();
  onCoverChanged();
  pushMini(true);
  refreshDockSoon();
}

// While a video records: whether the song is still going — playing, and its position moving on (not stuck loading).
function stillGoing() {
  let last = -1, movedAt = performance.now();
  return () => {
    const now = performance.now(), at = engine.position;
    if (at !== last) { last = at; movedAt = now; }
    return engine.playing && now - movedAt < 700;
  };
}
// P, or right-click the disc: a picture of what's playing (share-card.js), quoting lines of its lyrics picked in a
// panel, copied to paste into a chat or saved.
function shareCard() {
  if (!state.loadedPath) { setStatus(t('NOTHING PLAYING TO SHARE')); return; }
  const themeImage = shownTheme.image ? $('backdrop-theme') : null;
  const song = { cover: state.cover, title: state.titleText, artist: state.artistText, subtitle: cardSubtitle(state.details),
    backdrop: themeImage && themeImage.complete ? { image: themeImage, blur: shownTheme.blur, dim: shownTheme.dim } : null };
  const choices = lyricChoices(state.hiddenPhase === 'hidden' ? null : state.lyrics, lyricsPosition()); // a hidden song: not the main song's lines
  const png = (picked) => drawCard({ ...song, quote: quoteLines(choices.lines, picked) }, { ...colors });
  const attempt = (work, done) => async (picked) => {
    try { if (!(await work(await png(picked)))) return false; setStatus(done); return true; } catch { setStatus(t("COULDN'T MAKE THE CARD")); return false; }
  };
  panels.showCard(app, {
    choices, maxLines: MAX_QUOTE_LINES,
    render: async (picked) => URL.createObjectURL(new Blob([await png(picked)], { type: 'image/png' })),
    copy: attempt(async (bytes) => { await cdp.copyImage(bytes); return true; }, t('CARD COPIED · PASTE IT ANYWHERE')),
    save: attempt((bytes) => cdp.saveCard(bytes, [song.artist, song.title].filter(Boolean).join(' - ')), t('CARD SAVED')),
    // The video: the picked lines, recorded as they play from the first one's start (eight seconds from here, with
    // none) — the song started for it if it was paused, and paused again after.
    video: async (format, picked, onTick) => {
      const wasPlaying = engine.playing, withSound = !spotifyActive();
      const timed = state.lyrics ? parseLrc(state.lyrics) : [];
      const span = engine.deck ? videoSpan(timed, picked, heardPosition(engine.duration, 0, state.lyricsOffset)) : null;
      const begin = async () => {
        if (span) {
          seekTo(playbackTimeFor(span.start, 0, state.lyricsOffset));
          const el = engine.deck && engine.deck.el;
          if (el && el.seeking) await new Promise((resolve) => el.addEventListener('seeked', resolve, { once: true }));
        }
        if (!engine.playing && engine.deck) { await engine.play(); setPlaying(engine.playing); }
      };
      try {
        const made = await recordVideo({ format, audio: withSound ? engine.recordingStream() : null, onTick, begin, playing: withSound ? stillGoing() : () => true,
          seconds: span ? span.end - span.start : VIDEO_SECONDS, song: {
            ...song, face: disc.renderFace(512, 1).canvas, colors: { ...colors }, timed,
            // Where the song is as each frame is drawn: what's recorded is taken before the output, so no delay for it.
            position: () => heardPosition(engine.position, 0, state.lyricsOffset),
          } });
        if (!made) { setStatus(t("VIDEO CAN'T BE MADE HERE")); return false; }
        const saved = await cdp.saveVideo(made.bytes, [song.artist, song.title].filter(Boolean).join(' - '), made.ext);
        if (saved) setStatus(made.stoppedEarly ? t('VIDEO SAVED · THE MUSIC STOPPED, SO IT ENDS THERE') : t('VIDEO SAVED'));
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

// A song goes into HISTORY once it has played a few seconds — however it got there (a click, the tray closing, Space
// after a restart) — once per time it's loaded; one skipped past straight away isn't in it.
const HEARD_SECONDS = 8;
let recordedFor = -1, heardTimer = null;
function setPlaying(playing) {
  queueMicrotask(showDeckFlags); // (once engine.playing says so)
  if (playing && state.loadedPath && recordedFor !== state.loadToken) {
    const token = state.loadToken, path = state.loadedPath;
    recordedFor = token;
    clearTimeout(heardTimer);
    heardTimer = setTimeout(() => { if (state.loadToken === token && state.loadedPath === path && engine.playing) recordHistory(path); else if (state.loadToken === token) recordedFor = -1; }, HEARD_SECONDS * 1000); // (paused before then: counted when it plays on)
  }
  disc.spinning = playing;
  noise.setPlaying(playing);
  playButton.setGlyph(playing ? 'PAUSE' : 'PLAY'); pulse(playButton, true);
  if (playing) spotifyTrouble = null;
  setStatus(playing ? (state.volume === 0 ? t('NOW SPINNING · SOUND OFF') : t('NOW SPINNING')) : spotifyActive() && spotifyTrouble ? spotifyTrouble : state.loadedPath ? t('PAUSED') : t('READY TO PLAY'));
  visualizer.setActive(playing); bigVisualizer.setActive(playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state.loadedPath ? (playing ? 'playing' : 'paused') : 'none';
  pushMini(true);
  pushDiscord();
}
async function toggle() {
  if (state.trayBusy) return;
  if (disc.trayOpen) { closeTray(); return; } // PLAY with the tray out closes it and plays, like a real deck
  if (!engine.deck) {
    if (state.queue.length && state.index >= 0) load(state.queue[state.index]);
    else if (state.queue.length) { if (state.changerMode) playSlot(state.changer.slots.findIndex(Boolean)); else goTo(0); } // the song playing went: the first one left
    else { openShelf(app); setStatus(t('PICK AN ALBUM TO PLAY')); } // nothing to play yet: the music is on the shelf
    return;
  }
  if (jog) { jog.wasPlaying = !jog.wasPlaying; setPlaying(jog.wasPlaying); return; } // plays on (or not) once the disc is let go
  if (engine.playing) { engine.pause(); setPlaying(false); }
  else { await engine.play(); setPlaying(engine.playing); } // a Spotify track can be refused
}
// The changer stands on queue position `index` and plays it (the tray turns when it's on another disc).
// The songs moved on from, latest last: shuffled, PREVIOUS goes back through what actually played, not down the list.
const trail = [];
function goTo(index, opts, { back = false } = {}) {
  if (!back && state.index >= 0 && index !== state.index) { trail.push(state.queue[state.index]); if (trail.length > 200) trail.shift(); }
  if (!state.changerMode) { state.index = index; upcomingCache = null; load(state.queue[index], opts); return; }
  const from = changer.slotOf(ch(), state.index), to = changer.slotOf(ch(), index);
  if (from && to && from.slot !== to.slot && anim.enabled) disc.spinning = false; // slows while the tray turns; load spins it up
  apply(changer.moveTo(ch(), index, isSkipped));
  load(state.queue[state.index], opts);
}
function nextTrack() {
  const next = upcomingIndex();
  if (next < 0) return false;
  goTo(next);
  return true;
}
// NEXT pressed (not a song ending): when there's nowhere to go, it says so.
function userNext() { if (!nextTrack()) setStatus(state.queue.length ? t('THAT WAS THE LAST SONG') : t('NOTHING TO PLAY · S OPENS THE SHELF')); }
function previousTrack() {
  if (!state.queue.length) { setStatus(t('NOTHING TO PLAY · S OPENS THE SHELF')); return; }
  if (engine.deck && engine.position > 5) { seekTo(0); return; }
  if (state.shuffle !== 'OFF') {
    while (trail.length) {
      const at = state.queue.lastIndexOf(trail.pop());
      if (at >= 0 && at !== state.index) { goTo(at, undefined, { back: true }); return; }
    }
  }
  const prev = changer.previousIndex(ch(), isSkipped);
  if (prev >= 0) goTo(prev); else if (engine.deck) seekTo(0);
}
/** DISC SKIP (D): the next disc in the changer. */
function discSkip() {
  if (!state.changerMode) return;
  const to = changer.discSkip(ch(), modes());
  if (to < 0) { setStatus(t('NO OTHER DISC IN THE CHANGER')); return; }
  goTo(to);
}
/** A slot's disc (1–5, or a click on it in the carousel), from its first song. */
function playSlot(slot) {
  if (!state.changerMode) return;
  const to = changer.playSlot(ch(), slot, isSkipped);
  if (to >= 0) goTo(to); else setStatus(t('SLOT {n} IS EMPTY', { n: slot + 1 }));
}
// The playing song has played to its end: the changer notes it (a disc is finished at its last song).
function notePlayed() {
  if (state.index < 0 || !state.changerMode) return;
  const pick = upcomingCache; // the current song was never a candidate: the pick shown as UP NEXT still stands
  const here = changer.slotOf(ch(), state.index), wasDone = !!(here && ch().slots[here.slot].done);
  apply({ ...changer.markFinished(ch(), state.index, modes()), index: state.index });
  upcomingCache = pick;
  saveQueueSoon();
  const slot = here && ch().slots[here.slot];
  // finished, or one finished before played to its end again
  if (keepFull && slot && slot.done && (!wasDone || state.index === slot.end - 1)) {
    clearTimeout(refillTimer);
    // (not if the changer's been cleared meanwhile: new discs mustn't start the music again)
    refillTimer = setTimeout(() => { if (state.index >= 0) refillChanger(); }, REFILL_AFTER_MS);
  }
}
let refillTimer = null;
const REFILL_AFTER_MS = 1500;
// The queue entry `p` picks up exactly where the playing cue sheet track ends, in the same file (atBoundary: and
// playback has got there).
function continuesCurrent(p, { atBoundary = true } = {}) {
  const d = detailsCache.get(p);
  if (!d || !d.cue) return false;
  const url = cdp.mediaUrl(d.cue.file);
  return atBoundary ? engine.continuesInto(url, d.cue.start) : engine.runsInto(url, d.cue.start);
}
// Gapless: the queue's next track, loaded on the engine's standby deck while this one plays its last seconds, so it
// starts the moment this one ends. Re-done when what comes next changes; dropped by any other load.
async function prepareNext() {
  if (state.deckToken !== state.loadToken) return; // a track is still loading: what's playing is on its way out
  if (engine.seaming) return; // the prepared one is starting this moment
  if (sleepsAfterThis()) { if (preparedNext || engine.prepared) dropPrepared(); return; } // END OF DISC: nothing follows this one
  const next = upcomingIndex(), path = next >= 0 ? state.queue[next] : null;
  const same = preparedNext && preparedNext.path === path && preparedNext.index === next;
  if (same && preparedNext.seen === edgesSeen(path)) return;
  // Edges learnt this late would only re-plan a seam that's about to happen — and might miss it: it stays as armed.
  if (same && engine.prepared && engine.seamLeft() < 3) return;
  if (preparedNext || engine.prepared) dropPrepared();
  if (!path || isSpotifyUri(path)) return;
  // A streamed song next: its address asked for now, so it starts as soon as it's due (not prepared to run on: nothing
  // here knows where its sound begins and ends)
  if (isStream(path) || isStream(state.loadedPath)) { if (isStream(path)) cdp.stream.prepare(path); return; }
  const token = state.loadToken, mark = { path, index: next, token, seen: edgesSeen(path) };
  preparedNext = mark;
  const nextDetails = detailsCache.get(path) || await cdp.details(path, { withCover: false }).catch(() => null);
  if (preparedNext !== mark || token !== state.loadToken) return;
  if (nextDetails && !detailsCache.has(path)) detailsCache.set(path, { ...nextDetails, cover: undefined }); // albumRunsOn reads it
  const plan = seamlessNext({
    crossfade: crossfadeSeconds(), repeat: state.repeat, spotify: spotifyActive(), nextPath: path, nextDetails, aimedRate: albumAimFor(path, nextDetails),
    isCdTrack: isAudioCdTrack(path), sameFileCue: continuesCurrent(path, { atBoundary: false }),
    quality: state.quality, customRate: engine.customRate, rateInfo: state.rateInfo, engineRate: engine.rate,
    mediaUrl: (p) => cdp.mediaUrl(p),
  });
  if (!plan) return; // stays marked, so it isn't asked again every tick; the 'ended' path plays it
  // AUTOMIX: past the next song's leading silence, and mixed in where this one winds down — unless its album runs on.
  const { mix, startAt } = nextPlan({ automix: automixOn(), albumRunsOn: albumRunsOn(next), segment: plan.segment, out: edgesOf(state.loadedPath), inc: edgesOf(path) });
  const level = await soundCheck.known(path, evensOut(path) ? state.soundCheck : 'OFF').catch(() => null);
  if (preparedNext !== mark || token !== state.loadToken) return;
  if (await engine.prepare(plan.url, { segment: plan.segment, trim: level ? level.linear : 1, startAt }) && mix && preparedNext === mark) engine.armMix(mix);
}

// ---- AUTOMIX ------------------------------------------------------------------------------------------------------
// Where the playing and the upcoming song start, wind down and end (automix.js edges): measured one file at a time
// while AUTOMIX is on — from automix.json when measured before — and kept here. null: silent, or not measurable (a cue
// track's album file, a Spotify or CD track, too long to decode).
const songEdges = new Map(), edgesWanted = new Set();
let edgesJobs = Promise.resolve();
// Settings → TRANSITION: OFF (gapless), AUTOMIX or CROSSFADE (over state.crossfade seconds, kept while another is picked).
const automixOn = () => state.transition === 'AUTOMIX';
const crossfadeSeconds = () => (state.transition === 'CROSSFADE' ? state.crossfade : 0);
const upcomingPath = () => { const n = upcomingIndex(); return n >= 0 ? state.queue[n] : null; };
const edgesOf = (p) => songEdges.get(p); // undefined: not known yet
const edgesKnown = (p) => songEdges.has(p);
function measureEdgesSoon(p) {
  if (!automixOn() || !p || songEdges.has(p) || edgesWanted.has(p)) return;
  if (isSpotifyUri(p) || isAudioCdTrack(p) || cueRef(p) || isStream(p)) { songEdges.set(p, null); return; }
  edgesWanted.add(p);
  edgesJobs = edgesJobs.then(async () => {
    if (!automixOn() || (p !== state.loadedPath && p !== upcomingPath())) return; // no longer playing or next: asked again if it is
    try {
      const cached = (await cdp.automix.get([p]))[p];
      if (cached !== undefined) { songEdges.set(p, cached); return; }
      const d = detailsCache.get(p) || await cdp.details(p, { withCover: false }).catch(() => null);
      const duration = d && d.duration, rate = (d && d.format && d.format.sampleRate) || 48000;
      if (!(duration > 0) || duration > MAX_MEASURE_SECONDS || duration * rate * 2 * 4 > MAX_DECODE_BYTES) { songEdges.set(p, null); return; }
      const e = await measureEdges(cdp.mediaUrl(p));
      songEdges.set(p, e);
      cdp.automix.put(p, e).catch(() => {});
    } catch { songEdges.set(p, null); }
  }).catch(() => {}).finally(() => edgesWanted.delete(p));
}
// The queue's next song carries on the playing one's album, so it follows gaplessly, never mixed. Not known: not mixed.
function albumRunsOn(next) {
  const p = state.queue[next], a = detailsCache.get(state.loadedPath), b = detailsCache.get(p);
  if (!a || !b) return true;
  return continuesAlbum({ path: state.loadedPath, details: a }, { path: p, details: b }, { inOrder: state.shuffle === 'OFF' && next === state.index + 1 });
}
// The prepared next song was planned before both songs' edges were known: planned again once they are.
const edgesSeen = (path) => `${edgesKnown(state.loadedPath)}|${edgesKnown(path)}`;
// A mix that can't overlap (the next song needs the output at another rate) still loses the silence: this song ends where
// its sound does, and the next starts where its own begins.
function automixSkipSilence() {
  // (Not while a song is loading: the deck playing is still the last one, the edges already the new one's.)
  if (state.deckToken !== state.loadToken || state.automixSkipped === state.loadToken) return;
  if (sleepsAfterThis()) return; // END OF DISC: it plays out, and the player sleeps
  const next = upcomingIndex();
  if (!skipSilence({
    automix: automixOn(), out: edgesOf(state.loadedPath), fileTime: engine.deck.el.currentTime, timeLeft: engine.timeLeft(),
    prepared: !!engine.prepared, crossfading: engine.crossfading, repeat: state.repeat, hasNext: next >= 0, albumRunsOn: next >= 0 && albumRunsOn(next),
  })) return;
  state.automixSkipped = state.loadToken;
  engine.pause(); // its silence mustn't run on to 'ended' meanwhile, which would move on a second time
  notePlayed();
  goTo(next, automixStart(next));
}
// Where the queue's next song starts when it's put on after this one ended (not mixed): past its leading silence under
// AUTOMIX, unless its album runs on.
function automixStart(next) {
  const inc = automixOn() && !albumRunsOn(next) ? edgesOf(state.queue[next]) : null;
  return inc ? { startAt: inc.start } : undefined;
}
/** Settings → TRANSITION: OFF, AUTOMIX or CROSSFADE; what's next is planned again. */
function setTransition(mode) {
  state.transition = ['OFF', 'AUTOMIX', 'CROSSFADE'].includes(mode) ? mode : 'OFF';
  saveSettingsSoon();
  dropPrepared();
}
function trackFinished(deck) {
  if (deck !== engine.deck) return;
  const sleeps = sleepsAfterThis();
  notePlayed();
  if (sleeps) { engine.pause(); setPlaying(false); armSleepAtEnd(false); setStatus(t('END OF DISC · SLEEP WELL')); panels.refreshSettingsIfOpen(app); return; }
  if (state.repeat === 'TRACK') { engine.seek(0); engine.play(); setPlaying(true); return; }
  if (keepFull && upcomingIndex() < 0) refillChanger(); // nothing to go on to: new discs in, and on into them
  const next = upcomingIndex();
  // A cue sheet track ends mid-file: unless the next track carries straight on from here, stop the file right now
  // rather than let the following song start playing underneath.
  if (next < 0 || !continuesCurrent(state.queue[next])) engine.pause();
  if (next >= 0) { movingOn = state.loadToken + 1; goTo(next, automixStart(next)); return; }
  setPlaying(false);
}
// The music moving on came to a song that won't play (gone, broken, a stream that failed): on past it after a moment,
// as a CD player skips a bad track — once round the queue at most. One picked by hand stays, saying why.
let movingOn = 0, passedOver = 0;
function passOver(token) {
  if (movingOn !== token || passedOver >= state.queue.length) return;
  passedOver++;
  setTimeout(() => {
    if (token !== state.loadToken) return;
    const next = upcomingIndex();
    if (next >= 0) { movingOn = state.loadToken + 1; goTo(next); }
  }, 1500);
}
function seek(delta) { if (engine.deck) seekTo(engine.position + delta); }
function seekTo(seconds) {
  if (!engine.deck) return;
  engine.seek(seconds);
  updateProgressUi(true);
  followHiddenPhase();
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
  setStatus(t('SEARCHING'));
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
    deckDisplay.setTime(jog.target, engine.duration);
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
  setStatus(t('OPENING'));
  noise.tray(TRAY_MS);
  await disc.setTray(true);
  state.trayBusy = false;
  setStatus(state.queue.length ? t('OPEN · DROP IN A NEW DISC, OR PRESS E TO CLOSE') : t('OPEN · DROP MUSIC ON THE TRAY'));
  $('tray-button').classList.add('on');
}
async function closeTray({ play = true } = {}) {
  if (!disc.trayOpen || state.trayBusy) return;
  state.trayBusy = true;
  setStatus(t('CLOSING'));
  noise.tray(TRAY_MS);
  await disc.setTray(false);
  $('tray-button').classList.remove('on');
  const resume = trayResume || { playing: false };
  trayResume = null;
  if (!state.queue.length || state.index < 0) { state.trayBusy = false; setStatus(t('NO DISC')); return; }
  // Reading: the disc spins up, slowly, before anything plays.
  setStatus(t('READING…'));
  disc.reading = true; disc.spinning = true;
  noise.spinUp(READING_MS);
  await new Promise((r) => setTimeout(r, READING_MS));
  disc.reading = false;
  state.trayBusy = false;
  if (!engine.deck) { if (play) load(state.queue[state.index]); else disc.spinning = false; return; }
  if (play || resume.playing) { await engine.play(); setPlaying(engine.playing); } else setPlaying(false);
}
// E closes it as it was: playing again only if it was playing when it opened (PLAY closes it and plays).
function toggleTray() { if (disc.trayOpen) closeTray({ play: false }); else openTray({ eject: true }); }

// ---- Spotify discs ---------------------------------------------------------------------------------------------
// An album or playlist from the SPOTIFY panel goes in as a whole disc of spotify:track:… entries. The Web Playback
// SDK plays it (spotify-deck.js); everything else — the disc, transport, lyrics, karaoke — works as for files.

const SPOTIFY_ERRORS = {
  premium: t('SPOTIFY PREMIUM IS NEEDED TO PLAY'),
  unsupported: t("SPOTIFY PLAYBACK ISN'T SUPPORTED ON THIS SYSTEM"),
  auth: t('SPOTIFY SIGNED OUT · CONNECT AGAIN UNDER SPOTIFY'),
  offline: t("COULDN'T REACH SPOTIFY"),
  sdk: t("COULDN'T LOAD SPOTIFY'S PLAYER"),
  notready: t("SPOTIFY'S PLAYER DIDN'T START"),
  playback: t("COULDN'T PLAY THAT TRACK ON SPOTIFY"),
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
  if (e.type === 'lost') { setPlaying(false); setStatus(t('PLAYING ON ANOTHER DEVICE · PRESS PLAY TO BRING IT BACK')); return; }
  if (e.type !== 'error') return;
  spotifyTrouble = `${SPOTIFY_ERRORS[e.reason] || SPOTIFY_ERRORS.playback}${e.detail ? ` · ${e.detail}` : ''}`; // the detail is Spotify's own words
  if (e.reason !== 'playback') { engine.pause(); setPlaying(false); }
  setStatus(spotifyTrouble);
}
/** Tells Spotify the order after the current track again, after shuffle, repeat or the queue changed. */
function spotifyResync() {
  if (spotifyActive() && spotifySession) spotifySession.resync(spotifyUpcoming(state.queue, state.index, modes(), discEnd()));
}
/** DISCONNECT SPOTIFY: a Spotify disc comes out, and the player closes. */
function stopSpotify() {
  if (spotifySession) spotifySession.disconnect();
  if (spotifyDiscIn()) {
    const was = state.loadedPath;
    dropPaths(new Set(state.queue.filter(isSpotifyUri)));
    if (state.index < 0 || isSpotifyUri(was)) resetToIdle(t('SPOTIFY DISCONNECTED'));
    renderQueue(); saveQueueSoon();
  }
  spotifyTracks.clear();
}
async function playSpotifyDisc(tracks, name) {
  if (!tracks.length) return;
  for (const track of tracks) {
    spotifyTracks.set(track.uri, track);
    detailsCache.set(track.uri, { title: track.title, artist: track.artist, album: track.album, duration: track.durationMs / 1000 });
  }
  if (isShelfOpen()) closeShelf();
  await insertDisc(tracks.map((track) => track.uri), { status: t('{disc} ON THE TRAY', { disc: String(name || 'SPOTIFY').toUpperCase() }), kind: 'spotify', title: name || 'Spotify' });
}
async function loadSpotify(path, token, { autoPlay, startAt }) {
  const track = spotifyTracks.get(path);
  if (!track) { engine.stop(); setPlaying(false); setStatus(t('THAT SPOTIFY DISC IS NO LONGER IN')); return; }
  $('tags-button').hidden = true;
  const element = new SpotifyTrackElement(spotify(), path, track.durationMs, () => spotifyUpcoming(state.queue, state.index, modes(), discEnd()));
  const ok = await engine.load(path, { autoPlay: false, element }).catch(() => false);
  if (!ok || token !== state.loadToken) return;
  if (startAt > 0) engine.seek(Math.min(startAt, engine.duration));
  if (autoPlay) await engine.play();
  if (token !== state.loadToken) return;
  setPlaying(autoPlay && engine.playing);
  if (!autoPlay) setStatus(t('TRACK LOADED'));
  deckDisplay.setTime(engine.position, engine.duration);
  updateProgressUi(true);
  renderQueue(); saveQueueSoon();
  panels.refreshSettingsIfOpen(app);
  const details = { title: track.title, artist: track.artist, album: track.album, lyrics: null, cover: null, coverUrl: track.cover, duration: track.durationMs / 1000, ext: 'SPOTIFY' };
  state.details = details; state.detailsPath = path;
  setTrackTitle(details.title, details.artist);
  updateWear();
  updateQualityBadge();
  fadeInNowPlaying();
  $('track-source').textContent = `SPOTIFY${track.album ? ` · ${track.album.toUpperCase()}` : ''}`;
  state.lyrics = null; state.lyricsSource = null;
  lyricsChanged();
  if (details.title) lookUpLyrics(details, token);
  details.cover = track.cover ? await cdp.spotifyCover(track.cover).catch(() => null) : null;
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
  if (cd) button.textContent = cd.album ? `▶ ${cd.album}`.toUpperCase() : t('AUDIO CD');
}
function onAudioCd(cd) {
  const first = !state.audioCd || state.audioCd.mount !== cd.mount;
  state.audioCd = cd;
  showAudioCd();
  if (first) setStatus(cd.album ? t('AUDIO CD IN THE DRIVE · {album} · CLICK IT ABOVE TO PLAY', { album: cd.album.toUpperCase() }) : t('AUDIO CD IN THE DRIVE · CLICK IT ABOVE TO PLAY'));
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
  dropPaths(gone);
  if (gone.has(current) || state.index < 0) resetToIdle(t('DISC EJECTED'));
  renderQueue();
  saveQueueSoon();
}
async function playAudioCd() {
  const cd = state.audioCd;
  if (!cd) return;
  if (isShelfOpen()) closeShelf();
  await insertDisc(cd.tracks, { status: t('{disc} ON THE TRAY', { disc: (cd.album || t('AUDIO CD')).toUpperCase() }), kind: 'audiocd', title: cd.album || t('AUDIO CD') });
}
// RIP: the disc saved into the music folder as FLAC. Clicking it again while it rips cancels.
const RIP_STATUS = { cancelled: t('RIP CANCELLED'), 'disc-removed': t('DISC REMOVED'), busy: t('ALREADY RIPPING'), naming: t('STILL NAMING THE DISC — A MOMENT') };
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
  button.textContent = t('RIPPING {done}/{total} · {percent}%', { done: 0, total: cd.tracks.length, percent: 0 });
  const result = await cdp.startRip(cd.mount).catch((e) => ({ ok: false, reason: 'failed', message: e.message }));
  state.ripping = false;
  button.classList.remove('ripping');
  button.textContent = t('RIP');
  button.hidden = !state.audioCd || !state.audioCd.ready;
  Object.assign(state.rip, { finished: true, ok: !!result.ok, folder: result.folder || state.rip.folder,
    message: result.ok ? null : RIP_STATUS[result.reason] || t('RIP FAILED · {why}', { why: String(result.message || 'unknown').toUpperCase() }) });
  panels.refreshRipIfOpen(app);
  if (result.ok) setStatus(t('RIPPED TO {album} · {folder}', { album: (result.album || t('YOUR MUSIC FOLDER')).toUpperCase(), folder: result.folder }));
  else setStatus(RIP_STATUS[result.reason] || t('RIP FAILED · {why}', { why: String(result.message || 'unknown').toUpperCase() }));
}
// The loaded song's details changed underneath (a CD just got its names): show them without touching playback.
async function refreshLoadedDetails() {
  const path = state.loadedPath, d = await cdp.details(path, { withCover: true }).catch(() => null);
  if (!d || state.loadedPath !== path) return;
  state.details = d; state.detailsPath = path;
  detailsCache.set(path, { ...d, cover: undefined });
  setTrackTitle(d.title, d.artist);
  updateWear();
  if (d.cover) { await setCover(d.cover); state.coverFrom = 'MusicBrainz'; }
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
async function insertDisc(paths, { status, start = 0, disc: given = null, kind = null, title = null } = {}) {
  if (!paths.length || state.miniMode) return;
  if (!disc.trayOpen) await openTray();
  if (state.trayBusy) return;
  await putDiscOnTray(paths, start, status, { disc: given, kind, title });
  await new Promise((r) => setTimeout(r, 450));
  await closeTray();
}
// Music dropped (or picked) while the tray is out: that's a new disc in the changer, the one in the player — loaded but
// not playing. `given`: the disc it is (a shelf album); else it's worked out from the tracks.
async function putDiscOnTray(paths, start = 0, status = t('DISC ON THE TRAY · PRESS E OR PLAY TO CLOSE'), { disc: given = null, kind = null, title = null } = {}) {
  if (!state.changerMode) { // the queue (2.14): the new disc replaces it
    state.nextUp = null; state.queue = paths.slice();
    state.index = Math.max(0, Math.min(start, paths.length - 1));
    upcomingCache = null;
    disc.discPresent = true;
    renderQueue(); saveQueueSoon();
    trayResume = { playing: false };
    load(state.queue[state.index], { autoPlay: false }).then(() => { if (disc.trayOpen && !state.trayBusy) setStatus(status); });
    return;
  }
  const r = await loadDisc(given || await discOf(paths, { kind, title }), paths, { play: true, startPlayback: false });
  if (r.cancelled) return;
  const run = state.changer.slots[r.slot];
  apply(changer.moveTo(ch(), run.start + Math.max(0, Math.min(start, run.end - run.start - 1))));
  disc.discPresent = true;
  renderQueue(); saveQueueSoon();
  trayResume = { playing: false };
  load(state.queue[state.index], { autoPlay: false }).then(() => { if (disc.trayOpen && !state.trayBusy) setStatus(status); });
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
    title: state.titleText || d.title || '', artist: d.artist || '', album: d.album || '',
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
  // With a hidden track, the bar is the song's own stretch: none through the silence, so it never runs past the song.
  const h = state.hidden && state.hidden.path === state.loadedPath ? state.hidden : null, phase = h && state.hiddenPhase;
  cdp.setDiscordTrack(state.discord && current && engine.playing ? {
    title: state.titleText || d.title, artist: d.artist, album: d.album, coverUrl: d.coverUrl || null,
    position: phase === 'hidden' ? engine.position - h.hiddenStart : engine.position,
    duration: phase === 'silence' ? 0 : phase === 'hidden' ? engine.duration - h.hiddenStart : phase === 'song' ? h.songEnd : engine.duration,
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
function setDiscNoise(on) { state.discNoise = on; noise.setEnabled(on); noise.setPlaying(engine.playing); updateQualityBadge(); saveSettingsSoon(); }
// ---- Where the sound goes (Settings → OUTPUT; output.js) ----------------------------------------------------------

/** The outputs there are now: [{ deviceId, label }], not the system's 'default' and 'communications' aliases. */
async function listOutputs() {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}
// Plays through the chosen output when it's there, the system default when it isn't; `announce` says so when that
// changes by itself (headphones unplugged, AirPods back out of their case).
async function applyOutput(announce) {
  await applyOutputDevice(announce);
  await followDeviceSound();
}
async function applyOutputDevice(announce) {
  const devices = await listOutputs(), id = pickOutput(devices, state.output);
  // The rate known may be for another device: with OUTPUT = SYSTEM DEFAULT, plugging in headphones changes the OS default
  // while Chromium's id stays '', so this runs before the early return; the next song switches the output afresh.
  state.rateInfo = null; updateQualityBadge();
  if (id === (engine.outputId || '')) return;
  if (!(await engine.setOutput(id)) || !announce) return;
  const device = devices.find((d) => d.deviceId === id);
  setStatus(device ? t('PLAYING ON {device}', { device: outputName(device) }) : t('OUTPUT: SYSTEM DEFAULT'));
}
// Each output's own sound (device-sound.js): what's set is kept for the output playing, and an output played on before
// brings its own back.
let soundDevice = null, applyingSound = false, deviceSoundsTimer = null;
function keepDeviceSound() {
  if (!soundDevice || applyingSound) return;
  state.deviceSounds[soundDevice] = soundOf(state);
  clearTimeout(deviceSoundsTimer);
  deviceSoundsTimer = setTimeout(() => cdp.saveDeviceSounds(state.deviceSounds).catch(() => {}), 1000);
}
async function followDeviceSound() {
  const key = deviceKey(await navigator.mediaDevices.enumerateDevices().catch(() => []), engine.outputId || '');
  if (!key || key === soundDevice) return;
  const before = soundDevice;
  soundDevice = key;
  const kept = state.deviceSounds[key];
  const usable = kept && Array.isArray(kept.eq) && kept.eq.length === state.eq.length && kept.eq.every(Number.isFinite);
  if (!usable) { keepDeviceSound(); return; } // a new one starts from the sound there is (and one kept broken is replaced)
  if (sameSound(kept, soundOf(state))) return;
  applyingSound = true;
  try {
    if (Number.isFinite(kept.spatialAmount)) state.spatialAmount = kept.spatialAmount;
    setEq(kept.eq); setMono(!!kept.mono); setSpatial(!!kept.spatial);
  } finally { applyingSound = false; }
  panels.refreshSettingsIfOpen(app); // (its rows: this output's EQ, mono and spatial)
  if (before) setStatus(t('{device}: ITS OWN SOUND', { device: outputName({ label: key }) }));
}
// COPY REPORT (report.js): the errors that happen kept with what was said, and all of it copied for a bug report.
window.addEventListener('error', (e) => noteForReport('error', `${e.message}${e.filename ? ` at ${e.filename}:${e.lineno}` : ''}`));
window.addEventListener('unhandledrejection', (e) => noteForReport('error', String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).split('\n').slice(0, 2).join(' ')));
async function copyReport() {
  const info = await cdp.reportInfo(state.streaming).catch(() => ({}));
  const p = state.loadedPath, d = state.details && state.detailsPath === p ? state.details : null;
  const kind = !p ? null : isSpotifyUri(p) ? 'Spotify' : isStream(p) ? 'stream' : isAudioCdTrack(p) ? 'audio CD' : 'file';
  // The outputs' names ("Sam's AirPods") and who's signed in where are the person's: not in a report made to be posted.
  const outs = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.label);
  const signed = await cdp.scrobbleStatus().catch(() => null);
  const names = [...outs.flatMap((d) => [d.label, outputName(d)]), ...Object.values(signed || {}).map((s) => s && s.user)];
  const text = buildReport({
    ...info, version: state.version, language: state.language, output: state.output ? 'one chosen' : 'system default', rate: state.rateInfo, names,
    quality: state.quality, transition: state.transition, eq: state.eq.some((g) => g !== 0), mono: state.mono, spatial: state.spatial,
    spatialAmount: state.spatialAmount, soundCheck: state.soundCheck, discNoise: state.discNoise, streaming: state.streaming,
    playing: kind && { kind, format: d && [d.ext, d.quality].filter(Boolean).join(' · '), state: engine.playing ? 'playing' : 'paused' },
  });
  await cdp.copyText(text);
  setStatus(t('REPORT COPIED · PASTE IT INTO THE ISSUE'));
}
/** Settings → OUTPUT: a device ({ deviceId, label }), or null for the system default. */
async function setOutput(device) {
  state.output = device ? { id: device.deviceId, label: device.label } : null;
  state.rateInfo = null;
  await applyOutput(false);
  updateQualityBadge();
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
/** The ◈ LOSSLESS / ◈ HI-RES LOSSLESS badge under the title, and what reaches the output on hover. */
function updateQualityBadge() {
  const badge = $('quality-badge'), d = state.details;
  const label = d && !isSpotifyUri(state.loadedPath || '') ? badgeLabel(d.format, state.quality) : null;
  badge.hidden = !label;
  if (!label) return;
  const fileRate = d.format.sampleRate;
  const info = state.rateInfo || { fileRate, aimed: targetRate(state.quality, fileRate), deviceRate: state.systemRate, switched: false, bluetooth: false };
  const full = { ...info, eq: state.eq.some((g) => g !== 0), mono: state.mono, spatial: state.spatial, noise: state.discNoise };
  badge.textContent = label;
  badge.title = badgeText(full);
  badge.classList.toggle('dim', !badgeExact(full));
}

/** SC −4.2 DB under the title while Sound Check is on: the gain the song plays at, and where it came from on hover. */
// `settled`: Sound Check is done with the song — with no gain (silence, a file it can't or won't decode), there's no badge.
function showSoundCheck(info, settled = false) {
  state.soundCheckInfo = info;
  const badge = $('soundcheck-badge'), on = state.soundCheck !== 'OFF' && evensOut(state.loadedPath || '') && (!!info || !settled);
  badge.hidden = !on;
  if (!on) return;
  const db = info ? info.db : null;
  const amount = db === null ? null : `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)}`;
  badge.textContent = db === null ? t('LEVEL …') : t('LEVEL {db} DB', { db: amount });
  // The tooltip says it in words first (louder, quieter), then how it was worked out.
  const plain = db === null ? '' : db > 0.05 ? t('Sound Check plays this song {n} dB louder, to match the others', { n: Math.abs(db).toFixed(1) })
    : db < -0.05 ? t('Sound Check plays this song {n} dB quieter, to match the others', { n: Math.abs(db).toFixed(1) }) : t('Sound Check: this song is already at the level of the others');
  badge.title = !info ? t('SOUND CHECK · MEASURING THE SONG')
    : `${plain}\n${[t('SOUND CHECK'), info.scope === 'ALBUM' ? t('ALBUM') : t('TRACK'), info.source === 'TAGS' ? t('FROM REPLAYGAIN TAGS') : t('MEASURED'), info.limited ? t("LIMITED BY THE SONG'S PEAKS") : null].filter(Boolean).join(' · ')}`;
}
// What Sound Check still has to measure for the song loaded with `token`: its gain is changed as each answer comes.
function followSoundCheck(path, mode, token) {
  soundCheck.follow(path, mode, (info, ramp) => { if (token === state.loadToken) { engine.setTrim(info.linear, ramp); showSoundCheck(info); } })
    .then((settled) => { if (token === state.loadToken && !settled && !state.soundCheckInfo) showSoundCheck(null, true); }).catch(() => {});
}
/** Settings → SOUND CHECK: OFF, TRACK or ALBUM; applied to the song playing now, over half a second. */
async function setSoundCheck(mode) {
  dropPrepared(); // the next track was prepared at the old level
  state.soundCheck = ['OFF', 'TRACK', 'ALBUM'].includes(mode) ? mode : 'OFF';
  saveSettingsSoon();
  const p = state.loadedPath, token = state.loadToken;
  const m = p && evensOut(p) ? state.soundCheck : 'OFF';
  const info = p ? await soundCheck.known(p, m).catch(() => null) : null;
  if (token !== state.loadToken) return;
  engine.setTrim(info ? info.linear : 1, 0.5);
  showSoundCheck(info);
  if (p) followSoundCheck(p, m, token);
}

/** Settings → QUALITY. Applies from the next song; back to HIGH puts the outputs' rates back at once. */
async function setQuality(level) {
  dropPrepared(); // the next track may need another rate now
  state.quality = LEVELS.includes(level) ? level : 'HIGH';
  saveSettingsSoon();
  state.rateInfo = null;
  if (state.quality === 'HIGH') {
    await cdp.outputRate.restore().catch(() => {});
    const now = await cdp.outputRate.current(state.output).catch(() => null);
    if (now > 0) state.systemRate = now; // the device's own rate again (engine.rate stays custom until the next load)
  }
  updateQualityBadge();
}
function setDiscWear(on) { state.discWear = on; updateWear(); saveSettingsSoon(); }
function setTaskbarDisc(on) { state.taskbarDisc = on; cdp.setTaskbarDisc(on); }
function setDiscShine(on) { state.discShine = on; disc.setShine(on); pushMini(true); saveSettingsSoon(); }

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported action */ } };
  set('play', () => { if (!engine.playing) toggle(); });
  // A pause from outside — headphones taken off, a media key, another app taking over — says so: else it looks like
  // the music stopped by itself.
  set('pause', async () => { if (!engine.playing) return; await toggle(); setStatus(t('PAUSED · BY HEADPHONES, A MEDIA KEY OR ANOTHER APP')); });
  set('nexttrack', () => userNext());
  set('previoustrack', () => previousTrack());
  set('seekto', (e) => seekTo(e.seekTime));
  set('seekbackward', () => seek(-SKIP_SECONDS));
  set('seekforward', () => seek(SKIP_SECONDS));
}

// ---- Themes --------------------------------------------------------------------------------------------------

function refreshAutoTheme() {
  const i = THEMES.findIndex((theme) => theme.name === 'AUTO');
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
let glowFade = 0, glowResize = 0;
const glowSmall = Object.assign(document.createElement('canvas'), { width: 48, height: 48 }); // the glow, before stretching
function paintCoverGlow() {
  const backdrop = $('backdrop'), art = $('backdrop-art');
  if (!shownTheme.image && state.ambient && state.cover) {
    // A 48×48 center crop, stretched to fill the window — the browser's bilinear upscale makes it a soft glow. Drawn
    // without the graphics card, it's stretched here once instead (render-budget.js), as the upscale would be redone on
    // every frame. The glow there before (another album's) fades into this one, rather than the background jumping.
    const had = backdrop.classList.contains('has-art');
    const before = had && anim.enabled ? Object.assign(document.createElement('canvas'), { width: 48, height: 48 }) : null;
    if (before) before.getContext('2d').drawImage(glowSmall, 0, 0);
    const size = glowSize({ software: state.softwareRendering, width: innerWidth, height: innerHeight, dpr: window.devicePixelRatio || 1 });
    if (art.width !== size.width || art.height !== size.height) { art.width = size.width; art.height = size.height; }
    const g = glowSmall.getContext('2d'), out = art.getContext('2d');
    const cover = state.cover, iw = cover.naturalWidth, ih = cover.naturalHeight, s = Math.min(iw, ih);
    const draw = (f) => {
      g.globalAlpha = 1;
      if (before && f < 1) g.drawImage(before, 0, 0);
      g.globalAlpha = before ? f : 1;
      g.drawImage(cover, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, 48, 48);
      g.globalAlpha = 1;
      out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'high';
      out.drawImage(glowSmall, 0, 0, art.width, art.height);
    };
    cancelAnimationFrame(glowFade);
    if (before) {
      const start = performance.now();
      const step = (now) => { const p = Math.min(1, (now - start) / 600); draw(p * p * (3 - 2 * p)); if (p < 1 && state.cover === cover) glowFade = requestAnimationFrame(step); };
      glowFade = requestAnimationFrame(step);
    } else draw(1);
    art.style.objectFit = 'cover';
    backdrop.classList.add('has-art');
  } else backdrop.classList.remove('has-art');
}
// The window resized while the glow is stretched here: stretched again once it has settled (not on every step).
function paintCoverGlowSoon() { clearTimeout(glowResize); glowResize = setTimeout(paintCoverGlow, 200); }
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
  if (shownTheme.name === 'AUTO' && !shownTheme.user && THEMES[state.themeIndex] === shownTheme) { shownTheme = refreshAutoTheme(); setColors(shownTheme, anim.enabled); }
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
  switchTheme(Math.max(0, THEMES.findIndex((theme) => theme.name === name)));
}
async function saveTheme(theme, oldName = null) {
  const saved = await cdp.themes.save(toFile(theme), oldName);
  if (!saved) { setStatus(t("COULDN'T SAVE THE THEME")); return null; }
  await reloadUserThemes(saved.name);
  setStatus(t('THEME SAVED'));
  return saved;
}
async function importTheme(path = null) {
  const r = await cdp.themes.importFile(path);
  if (r.canceled) return;
  if (r.error) { setStatus(r.error); return; }
  await reloadUserThemes(r.theme.name);
  setStatus(t('THEME ADDED'));
}
async function pasteThemeCode() {
  const theme = await cdp.themes.decode(await cdp.clipboardText());
  if (!theme) { setStatus(t("THAT CODE ISN'T A THEME")); return; }
  const saved = await cdp.themes.save(theme, null);
  if (!saved) { setStatus(t("COULDN'T SAVE THE THEME")); return; }
  await reloadUserThemes(saved.name);
  setStatus(t('THEME ADDED'));
}
async function exportTheme(name) {
  const r = await cdp.themes.exportFile(name).catch(() => ({ error: true }));
  if (r.ok) setStatus(t('THEME EXPORTED'));
  else if (!r.canceled) setStatus(t("COULDN'T EXPORT THE THEME"));
}
async function copyThemeCode(theme) {
  const code = await cdp.themes.encode(toFile(theme));
  if (!code) return;
  await cdp.copyText(code);
  setStatus(t('CODE COPIED · PASTE IT IN A CHAT'));
}
async function deleteTheme(name) {
  await cdp.themes.remove(name);
  await reloadUserThemes(THEMES[state.themeIndex].name === name ? 'RED' : null);
  setStatus(t('THEME DELETED'));
}

// ---- Settings setters ------------------------------------------------------------------------------------------

function setVolume(v, { fromSlider = false } = {}) {
  const was = state.volume;
  state.volume = Math.max(0, Math.min(100, Math.round(v)));
  engine.setVolume(state.volume / 100);
  if ((was === 0) !== (state.volume === 0) && engine.playing) setStatus(stateStatus()); // SOUND OFF said, or taken back
  if (spotifySession) spotifySession.setVolume(state.volume / 100);
  $('volume-value').textContent = `${state.volume}%`;
  if (!fromSlider) volumeSlider.setValue(state.volume);
  remoteSoon(); // the phone's slider follows
  saveSettingsSoon();
}
function adjustVolume(delta) { state.volumeBeforeMute = -1; setVolume(state.volume + delta); }
function toggleMute() {
  if (state.volumeBeforeMute >= 0) { setVolume(state.volumeBeforeMute); state.volumeBeforeMute = -1; }
  else { state.volumeBeforeMute = state.volume; setVolume(0); }
}
function setMono(on) { state.mono = on; engine.setMono(on); updateQualityBadge(); saveSettingsSoon(); keepDeviceSound(); }
/** Settings → SPATIAL AUDIO (spatial.js): on or off, and how much room, 0–100. */
function setSpatial(on) { state.spatial = on; engine.setSpatial(on, state.spatialAmount / 100); updateQualityBadge(); saveSettingsSoon(); keepDeviceSound(); }
function setSpatialAmount(v) { state.spatialAmount = v; engine.setSpatial(state.spatial, v / 100); saveSettingsSoon(); keepDeviceSound(); }
function setWaveform(on) { state.waveform = on; progress.setWaveformEnabled(on); saveSettingsSoon(); }
function setAmbient(on) { state.ambient = on; onCoverChanged(); saveSettingsSoon(); }
function setAnimations(on) { anim.enabled = on; document.body.classList.toggle('no-anim', !on); saveSettingsSoon(); }
function setCrossfade(v) { state.crossfade = v; saveSettingsSoon(); }
function setEq(gains) { state.eq = gains.slice(); engine.setEq(state.eq); updateQualityBadge(); saveSettingsSoon(); keepDeviceSound(); }

let sleepTimer = null;
function armSleepTimer(minutes) {
  clearInterval(sleepTimer); sleepTimer = null;
  if (minutes > 0 && state.sleepAtEnd) armSleepAtEnd(false); // (one or the other)
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
  $('sleep-indicator').textContent = state.sleepAtEnd ? t('SLEEP · END OF DISC')
    : s > 0 ? t('SLEEP {time}', { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }) : '';
}
// The sleep timer's END OF DISC: playback stops once the disc playing has ended — what follows isn't readied to run on
// into it (gapless, crossfade).
function armSleepAtEnd(on) {
  if (on && state.sleepRemaining > 0) armSleepTimer(0);
  state.sleepAtEnd = !!on;
  if (on) dropPrepared();
  updateSleepIndicator();
}
// Whether the song playing is the last before END OF DISC stops playback (sleep-end.js).
function sleepsAfterThis() {
  if (!state.sleepAtEnd || state.index < 0) return false;
  const next = upcomingIndex();
  const slot = (i) => { const h = state.changerMode && i >= 0 && changer.slotOf(ch(), i); return h ? h.slot : null; };
  return discEndsAfter({
    current: state.queue[state.index], next: next >= 0 ? state.queue[next] : null, currentIndex: state.index, nextIndex: next,
    currentSlot: slot(state.index), nextSlot: slot(next), repeatTrack: state.repeat === 'TRACK', shuffled: state.shuffle !== 'OFF',
  });
}

// ---- View modes --------------------------------------------------------------------------------------------------

function applyCdViewState() {
  document.body.classList.toggle('cd-view', state.cdView);
  $('cd-info').hidden = !state.cdView;
  // The deck's display comes along, under the album's name (and back under the seek bar after).
  if (state.cdView) $('cd-artist').after($('deck-display')); else $('progress-row').after($('deck-display'));
  disc.setMode(state.cdView ? 'enlarged' : 'normal');
  $('cd-view-button').textContent = state.cdView ? t('EXIT CD VIEW') : t('CD VIEW');
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
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
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
  const p = finish ? 1 : Math.min(1, (now - m.start) / CD_MORPH_MS), eased = easeOutCubic(p);
  const lerp = (key) => `${m.from[key] + (m.to[key] - m.from[key]) * eased}px`;
  const style = $('disc').style;
  Object.assign(style, { left: lerp('left'), top: lerp('top'), width: lerp('width'), height: lerp('height') });
  disc.morph.t = eased;
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
    if (anim.enabled) node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: EASE.out });
  } else if (anim.enabled) {
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: EASE.in }).onfinish = () => { if (!state.visualizerMode) node.hidden = true; };
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
// The cover playing now, its key moved on when it changes (the mini player's and the phone's).
function currentCover() {
  const cover = state.cover ? state.cover.src : null;
  if (cover !== lastMiniCover) { lastMiniCover = cover; miniCoverKey++; }
  return cover;
}
// The phone (remote-state.js) gets the same moments as the mini player, while it's listening: a full state on every
// pushMini(true) (gathered into one), else where the song is.
function pushMini(full = false) {
  if (state.remoteListening) {
    if (full) remoteSoon(); else cdp.sendRemoteState({ playing: engine.playing, position: engine.position, duration: engine.duration });
  }
  if (!state.miniMode) return;
  const msg = { playing: engine.playing, position: engine.position, duration: engine.duration };
  if (full) {
    const d = state.details;
    const cover = currentCover();
    Object.assign(msg, {
      colors, animations: anim.enabled, shine: state.discShine, visMode: visualizerModeFor(shownTheme),
      shuffle: state.shuffle, repeat: state.repeat,
      disc: (playingSlot() || { slot: -1 }).slot + 1, changerMode: state.changerMode,
      track: {
        title: state.titleText || t('Pick a track to get started.'), artist: state.artistText || null, album: d && d.album ? d.album : null,
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
    case 'next': userNext(); break;
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

// ---- Phone remote --------------------------------------------------------------------------------------------
// Main runs the server (main/remote.js); this page tells it what the phone shows and carries out what the phone
// presses — as the desktop's own buttons do, but never by the tray, never by a question asked here.

// Full states carry `rev`; the cover playing now goes to main (for /cover/now) only when its key moved on, in `cover`,
// which main keeps and takes off before the state goes to a phone. Between them, { playing, position, duration }.
const COVER_RUN = Date.now().toString(36); // keys from an earlier page (before a reload) can't name this page's covers
let sentRemoteCoverKey = null, remoteTickAt = 0, remoteSentAt = 0, musicShown = null;
// Changes close together go as one full state, and at most 4 a second (a long queue's titles arrive a few at a time).
const REMOTE_GATHER_MS = 30, REMOTE_FULL_MS = 250;
function remoteSoon() {
  if (!state.remoteListening || remoteTimer) return;
  const wait = Math.max(REMOTE_GATHER_MS, remoteSentAt + REMOTE_FULL_MS - performance.now());
  remoteTimer = setTimeout(() => {
    remoteTimer = null;
    if (!state.remoteListening) return;
    remoteSentAt = performance.now();
    cdp.sendRemoteState(remoteState());
  }, wait);
}
// The music the phone's indexes point into changed: a new rev (a command sent against the old one is refused).
function syncRev() {
  const key = musicKey({ queue: state.queue, changerMode: state.changerMode, slots: state.changer.slots });
  if (key !== musicShown) { musicShown = key; state.rev++; }
}
function remoteState() {
  syncRev();
  const cover = currentCover(), coverKey = cover ? `${COVER_RUN}.${miniCoverKey}` : null;
  const s = remoteSnapshot({
    state, player: { playing: engine.playing, position: engine.position, duration: engine.duration },
    track: { title: state.titleText || t('Pick a track to get started.'), artist: state.artistText || null, album: state.details && state.details.album ? state.details.album : null, coverKey },
    details: (p) => { const d = detailsCache.get(p); return { title: queueDisplay(p), duration: d ? d.duration : 0 }; },
    changerView: shownChanger, slotCover, statusWord: statusWords(), statusFallback: stateStatus(), rev: state.rev, canUndo: !!undoClear, colors,
  });
  if (coverKey !== sentRemoteCoverKey) { sentRemoteCoverKey = coverKey; s.cover = cover && cover.startsWith('data:') ? cover : null; }
  return s;
}
// The changer's covers for the phone: small (96 px), made once per disc from the cover the carousel shows.
const slotCovers = new Map(); // first song's path → data URL, or null while it's made (or when there's none)
const SLOT_COVER_PX = 96, SLOT_COVERS_KEPT = 20;
function slotCover(first) {
  if (!first) return null;
  if (slotCovers.has(first)) return slotCovers.get(first);
  slotCovers.set(first, null);
  if (slotCovers.size > SLOT_COVERS_KEPT) slotCovers.delete(slotCovers.keys().next().value);
  const big = isSpotifyUri(first) ? (((spotifyTracks.get(first) || {}).cover && cdp.spotifyCover(spotifyTracks.get(first).cover)) || Promise.resolve(null)) : coverForPath(first);
  Promise.resolve(big).then(smallCover).then((small) => { if (small && slotCovers.has(first)) { slotCovers.set(first, small); remoteSoon(); } }).catch(() => {});
  return null;
}
async function smallCover(src) {
  const img = await decodeCover(src);
  if (!img) return null;
  const scale = Math.min(1, SLOT_COVER_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}
function onRemoteListening(on) {
  state.remoteListening = !!on;
  clearTimeout(remoteTimer); remoteTimer = null;
  if (!on) return;
  sentRemoteCoverKey = undefined; // a fresh start for main (or the page reloaded): the cover goes again
  remoteSentAt = performance.now();
  cdp.sendRemoteState(remoteState()); // only what's there — a phone (re)connecting never starts the music
}
async function onRemoteCommand({ id, cmd }) {
  syncRev();
  const rev = state.rev;
  let result;
  try { result = await remoteCommand(cmd || {}); } catch { result = { error: 'failed' }; }
  // The music its indexes point into changed (a row moved, one removed, an album in): the phones get the new state
  // before the answer — so a row moved there doesn't jump back, and the next move goes with the new rev, not a 409.
  syncRev();
  if (state.remoteListening && state.rev !== rev) {
    clearTimeout(remoteTimer); remoteTimer = null;
    remoteSentAt = performance.now();
    cdp.sendRemoteState(remoteState());
  }
  cdp.remoteReply(id, result || { ok: true });
}
// main has checked the command's shape (remote-net.js validCommand); here, whether it's still for the music as it is.
async function remoteCommand(cmd) {
  syncRev();
  if (isStale(cmd, state.rev)) return { stale: true };
  const here = playingSlot();
  const error = commandError(cmd, { queueLength: state.queue.length, slots: state.changerMode ? state.changer.slots : null, changerMode: state.changerMode, playingSlot: here ? here.slot : -1 });
  if (error) return { error };
  const v = cmd.value;
  switch (cmd.action) {
    case 'toggle':
      if (!engine.deck && !state.queue.length) return { error: 'empty' }; // the desktop's PLAY would open the shelf here
      await toggle(); break;
    case 'prev': previousTrack(); break;
    case 'next': userNext(); break;
    case 'seek': seekTo(v); break;
    case 'volume': state.volumeBeforeMute = -1; setVolume(v); break; // where to, not by how much (the mini player's)
    case 'mute': toggleMute(); break;
    case 'shuffle': toggleShuffle(); break;
    case 'repeat': cycleRepeat(); break;
    case 'playIndex': goTo(v); break;
    case 'remove': removeFromQueue(v); break;
    case 'move': // as the drag does, all at once
      if (v.from === v.to) break;
      ({ queue: state.queue, index: state.index } = moveItem(state.queue, state.index, v.from, v.to));
      state.nextUp = null; upcomingCache = null;
      renderQueue(); saveQueueSoon(); spotifyResync();
      break;
    case 'clear': clearQueue(); break;
    case 'undo': if (undoClear) undoClearQueue(); else if (undoEject) undoEjectSlot(); break; // as ⌘Z
    case 'playSlot': playSlot(v); break;
    case 'discSkip': discSkip(); break;
    case 'album': return remoteAlbum(v);
    default: return { error: 'unknown' };
  }
  return { ok: true };
}
// An album from the phone's shelf (main has turned its key into the shelf album, paths and all), as the case's buttons
// do it on the desktop: PLAY puts it in and plays (from `track`), PLAY NEXT and ADD as theirs; then its shrink-wrap comes off.
async function remoteAlbum({ how, track = 0, slot, album }) {
  const item = { id: album.id, kind: 'album', title: album.title, artist: album.artist }; // the shelf's own disc (discOfAlbum)
  let r;
  if (how === 'play') r = await remoteInsert(album.paths, track, item, slot);
  else if (!state.changerMode && spotifyDiscIn()) r = await remoteInsert(album.paths, 0, item); // files replace a Spotify disc, like a new CD
  else r = await loadDisc(item, album.paths, { next: how === 'next', remote: true, slot });
  if (r && r.full) return { full: fullSlots(shownChanger, slotCover) };
  if (r && r.error) return r;
  if (r && r.cancelled) return { error: 'playing' };
  if (album.wrapped !== false) cdp.tearWrap(album.id).catch(() => {}); // (main keeps it torn once; the desktop shelf shows it next time it's read)
  return { ok: true };
}
// PLAY from the phone: what insertDisc does — the queue replaced, or the disc into a slot of the changer — but not by
// the tray (and in Mini Mode too). A tray already out (opened on the desktop) gets the disc and closes, as PLAY would.
async function remoteInsert(paths, start, item, slot) {
  if (state.trayBusy) return { error: 'busy' };
  const from = (n, length) => Math.max(0, Math.min(n || 0, length - 1));
  if (!state.changerMode) {
    state.nextUp = null; state.queue = paths.slice();
    state.index = from(start, paths.length);
    upcomingCache = null;
  } else {
    const r = await loadDisc(item, paths, { play: true, startPlayback: false, remote: true, slot });
    if (r.full || r.cancelled) return r;
    const run = state.changer.slots[r.slot];
    apply(changer.moveTo(ch(), run.start + from(start, run.end - run.start)));
  }
  renderQueue(); saveQueueSoon();
  if (!disc.trayOpen) { load(state.queue[state.index], { autoPlay: true }); return { slot: -1 }; }
  trayResume = { playing: false }; // the disc that was in doesn't play on: a new one went in
  await load(state.queue[state.index], { autoPlay: false });
  closeTray(); // reads, then plays
  return { slot: -1 };
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
// SAVE: the playing disc as a .m3u playlist.
async function savePlaylist() {
  const here = playingSlot();
  if (state.changerMode && !here) { setStatus(t('NO DISC PLAYING')); return; }
  if (!state.changerMode && !state.queue.length) { setStatus(t('QUEUE IS EMPTY')); return; }
  const songs = here ? changer.tracksOf(ch(), here.slot) : state.queue; // the playing disc, or the whole queue
  const r = await cdp.savePlaylistDialog(songs.map((p) => ({ path: p, display: queueDisplay(p) })));
  if (r.ok) setStatus(t('SAVED PLAYLIST · {name}', { name: r.name }));
  else if (!r.canceled) setStatus(t("COULDN'T SAVE PLAYLIST"));
}
async function loadPlaylist() {
  const r = await cdp.loadPlaylistDialog();
  if (r.canceled) return;
  if (r.error) { setStatus(t("COULDN'T READ PLAYLIST")); return; }
  if (!r.tracks.length) { setStatus(t('NO PLAYABLE TRACKS IN PLAYLIST')); return; }
  await addToQueue(r.tracks, { sorted: true, title: r.name || null }); // a CD-R, in the order saved
}
const appendAndPlay = (p) => addToQueue([p], { sorted: true, play: true });

// ---- Persistence ---------------------------------------------------------------------------------------------

let settingsTimer = null, queueTimer = null;
function settingsSnapshot() {
  return { volume: state.volume, crossfade: state.crossfade, transition: state.transition, mono: state.mono, animations: anim.enabled, theme: THEMES[state.themeIndex].name, eq: state.eq, waveform: state.waveform, ambient: state.ambient, discord: state.discord, discNoise: state.discNoise, discWear: state.discWear, discShine: state.discShine, taskbarDisc: state.taskbarDisc, output: state.output, saveFound: state.saveFound, lyricsOffset: state.lyricsOffset, shelfSort: state.shelfSort, language: state.language, quality: state.quality, spatial: state.spatial, spatialAmount: state.spatialAmount, soundCheck: state.soundCheck, changer: state.changerMode, streaming: state.streaming, playModes: { ...state.playModes, [modeKey()]: { shuffle: state.shuffle, repeat: state.repeat } }, display: state.display, look: state.look };
}
function saveSettingsSoon() { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => cdp.saveSettings(settingsSnapshot()), 300); }
function queueSnapshot() {
  const at = { paths: state.queue, index: state.index, positionMicros: Math.round(positionNow() * 1e6) };
  return state.changerMode ? { ...at, mode: 'CHANGER', changer: changer.serialize(ch()) } : { ...at, mode: 'QUEUE' };
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
  else if (document.body.classList.contains('queue-open')) showQueueDrawer(false);
  else if (state.fullscreen) toggleFullscreen();
  else if (disc.trayOpen) closeTray({ play: false });
}

// ---- Build the static UI ---------------------------------------------------------------------------------------

const playButton = roundButton('PLAY', 68, { primary: true, title: t('Play/Pause'), onClick: () => toggle() });
// SHUFFLE and REPEAT, by the mode: the queue's off / on and off / all / track; the changer's off / this disc / all
// discs and off / all discs / this disc / track.
const SHUFFLES = { QUEUE: ['OFF', 'ALL'], CHANGER: ['OFF', 'DISC', 'ALL'] }, REPEATS = { QUEUE: ['OFF', 'ALL', 'TRACK'], CHANGER: ['OFF', 'ALL', 'DISC', 'TRACK'] }; // REPEAT: all first, the one song last, as on most players
const modeKey = () => (state.changerMode ? 'CHANGER' : 'QUEUE');
function showModes() {
  showDeckFlags();
  shuffleButton.setOn(state.shuffle !== 'OFF');
  shuffleButton.setBadge(state.shuffle === 'DISC' ? '◉' : null); // one character fits the badge; the info line says it in words
  shuffleButton.title = state.changerMode ? { OFF: t('Shuffle'), DISC: t('Shuffle: this disc'), ALL: t('Shuffle: all discs') }[state.shuffle] : t('Shuffle');
  repeatButton.setOn(state.repeat !== 'OFF');
  repeatButton.setBadge(state.repeat === 'TRACK' ? '1' : state.repeat === 'DISC' ? '◉' : null);
  repeatButton.title = state.changerMode ? { OFF: t('Repeat'), TRACK: t('Repeat: this track'), DISC: t('Repeat: this disc'), ALL: t('Repeat: all discs') }[state.repeat]
    : { OFF: t('Repeat'), TRACK: t('Repeat: this track'), ALL: t('Repeat: whole queue') }[state.repeat];
}
function modesChanged() { showModes(); upcomingCache = null; dropPrepared(); renderQueue(); pushMini(true); spotifyResync(); saveSettingsSoon(); } // REPEAT TRACK plays this one again; ALL may wrap round
// The mode in use's SHUFFLE and REPEAT, as last left (OFF for anything it doesn't have).
function takePlayModes() {
  const m = (state.playModes && state.playModes[modeKey()]) || {};
  state.shuffle = SHUFFLES[modeKey()].includes(m.shuffle) ? m.shuffle : 'OFF';
  state.repeat = REPEATS[modeKey()].includes(m.repeat) ? m.repeat : 'OFF';
}
function toggleShuffle() {
  const list = SHUFFLES[modeKey()];
  state.shuffle = list[(list.indexOf(state.shuffle) + 1) % list.length];
  modesChanged();
}
function cycleRepeat() {
  const list = REPEATS[modeKey()];
  state.repeat = list[(list.indexOf(state.repeat) + 1) % list.length];
  modesChanged();
}
// Settings → CHANGER: the music of the mode in use is put aside (and saved), the other one's comes up at its position.
// The old song is stopped outright (not paused), so an end it was about to report can't move the new mode on; and the
// mode isn't switched while the tray is out or moving (a disc on its way would land in the wrong one).
let stores = { QUEUE: null, CHANGER: null }; // the mode not in use: its music, or (changer) what was saved, read when first needed
let switching = false, pendingStart = null; // pendingStart: where the song being brought up starts (s), till it's loaded
const positionNow = () => (pendingStart != null ? pendingStart : engine.deck ? engine.position : 0);
async function setChangerMode(on) {
  if (on === state.changerMode || switching) return;
  if (state.trayBusy || disc.trayOpen) { setStatus(t('CLOSE THE TRAY FIRST')); return; }
  switching = true;
  keepFull = null;
  try {
    clearTimeout(queueTimer); cdp.saveQueue(queueSnapshot());
    stores[modeKey()] = { ...takeStore(), positionMicros: Math.round(positionNow() * 1e6) };
    if (undoClear) { clearTimeout(undoClear.timer); undoClear = null; }
    state.loadToken++; stopStreamReading(); dropPrepared(); engine.stop(); setPlaying(false);
    state.playModes = { ...state.playModes, [modeKey()]: { shuffle: state.shuffle, repeat: state.repeat } };
    trail.length = 0; shownIndex = -1; // PREVIOUS goes back through this mode's songs only; its list goes to the song
    state.changerMode = on;
    document.body.classList.toggle('changer-mode', on);
    takePlayModes(); // each mode has its own SHUFFLE and REPEAT
    showModes();
    let coming = stores[modeKey()];
    if (coming && coming.saved) coming = stores[modeKey()] = { changer: await changerFromSaved(coming.saved), positionMicros: coming.saved.positionMicros };
    putStore(coming || (on ? { changer: changer.clear() } : null));
    saveSettingsSoon();
    renderQueue(); pushMini(true);
    const said = on ? t('CD CHANGER ON') : t('QUEUE ON');
    if (state.index >= 0) {
      pendingStart = ((coming && coming.positionMicros) || 0) / 1e6;
      load(state.queue[state.index], { autoPlay: false, startAt: pendingStart }).then(() => { pendingStart = null; if (state.changerMode === on) setStatus(said); });
    } else { resetToIdle(on ? t('CHANGER EMPTY') : t('QUEUE EMPTY')); setStatus(said); }
    saveQueueSoon();
  } finally { switching = false; }
}
const shuffleButton = modeButton('SHUFFLE', t('Shuffle'), toggleShuffle);
const repeatButton = modeButton('REPEAT', t('Repeat'), cycleRepeat);

let seeking = false;
const progress = new Slider({
  min: 0, max: 1000, waveform: true,
  onInput: (v) => { seeking = true; deckDisplay.setTime((engine.duration * v) / 1000, engine.duration); },
  onChange: (v) => { seeking = false; seekTo((engine.duration * v) / 1000); },
}).mount($('progress-row'));
const volumeSlider = new Slider({ min: 0, max: 100, value: 100, onInput: (v) => { state.volumeBeforeMute = -1; setVolume(v, { fromSlider: true }); } }).mount($('volume-slider'));

function buildStaticUi() {
  $('transport').append(
    shuffleButton, spacer(22),
    roundButton('SKIP_BACK', 36, { title: t('Back {n} seconds', { n: SKIP_SECONDS }), onClick: () => seek(-SKIP_SECONDS) }), spacer(10),
    roundButton('PREVIOUS_TRACK', 44, { title: t('Previous track'), onClick: () => previousTrack() }), spacer(16),
    playButton, spacer(16),
    roundButton('NEXT_TRACK', 44, { title: t('Next track'), onClick: () => userNext() }), spacer(10),
    roundButton('SKIP_FORWARD', 36, { title: t('Forward {n} seconds', { n: SKIP_SECONDS }), onClick: () => seek(SKIP_SECONDS) }), spacer(22),
    repeatButton);

  $('load-button').addEventListener('click', choose);
  $('vfd-time-button').addEventListener('click', toggleRemaining);
  $('length').addEventListener('click', toggleRemaining);
  $('save-playlist-button').addEventListener('click', savePlaylist);
  $('load-playlist-button').addEventListener('click', loadPlaylist);
  $('search-button').addEventListener('click', () => panels.showSearch(app));
  $('clear-queue-button').addEventListener('click', () => (undoClear ? undoClearQueue() : clearQueue()));
  $('lyrics-button').addEventListener('click', () => panels.showLyrics(app));
  $('karaoke-button').addEventListener('click', toggleKaraoke);
  $('tray-button').addEventListener('click', toggleTray);
  // STAGE: the queue and the changer slide in at the side, and away again with a click anywhere else
  $('queue-toggle').addEventListener('click', (e) => { e.stopPropagation(); showQueueDrawer(!document.body.classList.contains('queue-open')); });
  document.addEventListener('click', (e) => { if (document.body.classList.contains('queue-open') && !e.target.closest('#queue-card, #overlays')) showQueueDrawer(false); });
  $('cd-button').addEventListener('click', playAudioCd);
  $('rip-button').addEventListener('click', () => ripAudioCd());
  cdp.onRipProgress(({ done, total, percent, current, stage, size, folder }) => {
    if (!state.ripping) return;
    $('rip-button').textContent = t('RIPPING {done}/{total} · {percent}%', { done, total, percent });
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
  $('phone-tag').addEventListener('click', () => panels.showSettings(app));
  $('cd-view-button').addEventListener('click', toggleCdView);
  $('update-button').addEventListener('click', onUpdateClick);
  cdp.onUpdateProgress((fraction) => { if (updateState.phase === 'downloading') { updateState.progress = fraction; showUpdatePill(); } });
  $('sleep-indicator').addEventListener('click', () => { armSleepTimer(0); armSleepAtEnd(false); panels.refreshSettingsIfOpen(app); });
  $('vis-mode').addEventListener('mousedown', () => { if (state.visualizerMode) toggleVisualizerMode(); });
  $('karaoke-close').addEventListener('click', () => closeKaraoke());
  document.querySelector('#hint b').addEventListener('click', () => panels.showShortcuts()); // ? ALL KEYS, clicked
  showKeyHint();
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
  setupQueueDrag();
  changerView = createChangerView($('queue-card'), {
    tray: $('changer'), heading: $('disc-heading'), list: $('queue-list'),
    onPlaySlot: playSlot, onPlayTrack: goTo, animations: () => anim.enabled, coverFor: coverForPath,
  });
  $('disc-skip-button').addEventListener('click', discSkip);
  $('eject-disc-button').addEventListener('click', () => { const h = changer.slotOf(ch(), state.index); if (h) ejectSlot(h.slot); });
  disc.onTrackPick = (k) => { const i = discStart + k; if (i === state.index) return; goTo(i); };
  engine.onEnded = trackFinished;
  pointAtDrawn('#disc', () => disc.shownRect); // the guide points at the case, not the whole column
  engine.onAdvance = () => { // gapless: the prepared track has just taken over
    const mark = preparedNext;
    preparedNext = null;
    if (!mark) return;
    notePlayed(); // the song that just ended played to its end (the changer marks its disc)
    goTo(mark.index, { seamless: true });
  };
  engine.onCrossfadeDone = () => { if (engine.playing) setStatus(stateStatus()); };
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

function isTyping(e) { const target = e.target; return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable); }
function onKeyDown(e) {
  state.lastActivity = Date.now();
  if (e.key === 'Escape') { e.preventDefault(); escape(); return; }
  if ((undoClear || undoEject) && (e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey && !e.altKey && !isTyping(e)) {
    e.preventDefault(); if (undoClear) undoClearQueue(); else undoEjectSlot(); return;
  }
  if (state.changerMode && (e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey && !isTyping(e)) { e.preventDefault(); setStatus(t('NOTHING TO BRING BACK')); return; }
  // ⌘/Ctrl+O opens songs, ⌘/Ctrl+, the settings, ⌘/Ctrl+K the search (as /, the key other apps use for it): a
  // desktop app's own keys (no menu bar has them; Windows and Linux have no menu bar at all).
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK' && !anyOverlayOpen()) {
    e.preventDefault(); if (!e.repeat) panels.showSearch(app); return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.code === 'KeyO' || e.code === 'Comma') && !anyOverlayOpen()) {
    e.preventDefault(); if (!e.repeat) $(e.code === 'KeyO' ? 'load-button' : 'settings-button').click(); return;
  }
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = shortcutKey(e);
  if (key === 'm') { e.preventDefault(); setMiniMode(!state.miniMode); return; }
  if (key === 'p' && panels.closeCardPanel()) { e.preventDefault(); return; } // P again: the card goes
  if (anyOverlayOpen()) return;
  // The shelf open: the arrows are the shelf's (scrolling it), not the volume and the song's position.
  if (isShelfOpen() && key.startsWith('Arrow')) return;
  const actions = {
    ArrowLeft: () => seek(-SKIP_SECONDS), ArrowRight: () => seek(SKIP_SECONDS), ArrowUp: () => adjustVolume(5), ArrowDown: () => adjustVolume(-5),
    '/': () => panels.showSearch(app), u: toggleMute, p: shareCard, b: () => disc.flip(), '?': () => panels.showShortcuts(), ' ': toggle, k: toggle, j: previousTrack, l: userNext, f: toggleFullscreen, c: toggleCdView, v: toggleVisualizerMode, y: toggleKaraoke, e: toggleTray, s: toggleShelf,
    d: discSkip, 1: () => playSlot(0), 2: () => playSlot(1), 3: () => playSlot(2), 4: () => playSlot(3), 5: () => playSlot(4), // changer mode only
  };
  if (actions[key]) { e.preventDefault(); if (!e.repeat || key.startsWith('Arrow')) { actions[key](); if (!e.repeat) noteKeyUsed(); } }
}
// What "/" finds besides songs (search-commands.js): what the keys and the header's buttons do, by name — those that
// can be done now (a button that's hidden can't).
// FILL, from the search: the shelf's FILL menu, the shelf opened for it (once its albums are on it).
async function fillFromShelf() {
  if (!isShelfOpen()) toggleShelf();
  for (let i = 0; i < 60 && isShelfOpen() && !document.querySelector('#shelf-body .spine'); i++) await new Promise((r) => setTimeout(r, 50));
  if (isShelfOpen()) $('shelf-fill').click();
}
function commands() {
  const can = (id) => !$(id).hidden;
  const click = (id) => () => $(id).click();
  return [
    { label: t('PLAY / PAUSE'), also: 'play pause stop', key: 'Space', run: toggle },
    { label: t('NEXT TRACK'), also: 'next skip forward следующий', key: 'L', run: userNext },
    { label: t('PREVIOUS TRACK'), also: 'previous back предыдущий', key: 'J', run: previousTrack },
    state.changerMode ? { label: t('DISC SKIP'), also: 'next disc changer', key: 'D', run: discSkip } : null,
    { label: t('SHUFFLE|action'), also: 'shuffle random перемешать', run: toggleShuffle },
    { label: t('REPEAT|action'), also: 'repeat loop повтор', run: cycleRepeat },
    { label: t('MUTE / UNMUTE'), also: 'mute sound звук', key: 'U', run: toggleMute },
    { label: t('THE SHELF'), also: 'shelf albums divider dividers editions полка разделитель разделители издания', key: 'S', run: toggleShelf },
    state.changerMode ? { label: t('FILL'), also: 'fill changer keep full заполнить держать полным чейнджер', run: fillFromShelf } : null,
    state.index >= 0 ? { label: state.skipped.has(state.queue[state.index]) ? t('DON’T SKIP THIS SONG') : t('SKIP THIS SONG'), also: 'skip song mark пропуск пропускать', run: () => toggleSkip(state.queue[state.index]) } : null,
    { label: t('CD VIEW'), key: 'C', run: toggleCdView },
    { label: t('MINI MODE'), key: 'M', run: () => setMiniMode(!state.miniMode) },
    { label: t('VISUALIZER MODE'), also: 'visualizer визуализатор', key: 'V', run: toggleVisualizerMode },
    { label: t('KARAOKE'), also: 'karaoke', key: 'Y', run: toggleKaraoke },
    { label: t('FULLSCREEN'), also: 'fullscreen полный экран', key: 'F', run: toggleFullscreen },
    { label: t('OPEN / CLOSE THE TRAY'), also: 'tray eject лоток', key: 'E', run: toggleTray },
    { label: t('TURN THE DISC OVER'), also: 'flip disc data side', key: 'B', run: () => disc.flip() },
    { label: t('NOW PLAYING CARD'), also: 'share card image карточка', key: 'P', run: shareCard },
    { label: t('HISTORY'), also: 'history played история', run: click('history-button') },
    can('lyrics-button') ? { label: t('LYRICS'), also: 'lyrics words', run: click('lyrics-button') } : null,
    can('tags-button') ? { label: t('TAGS'), also: 'tags edit теги', run: click('tags-button') } : null,
    { label: t('SPOTIFY'), run: click('spotify-button') },
    { label: t('LOAD A TRACK'), also: 'open files load открыть', key: state.platform === 'darwin' ? '⌘O' : 'Ctrl+O', run: click('load-button') },
    { label: t('LIBRARY CHECK'), also: 'check problems проверка', run: () => panels.showLibraryCheck(app) },
    { label: t('KEYBOARD SHORTCUTS'), also: 'keys shortcuts клавиши', key: '?', run: () => panels.showShortcuts() },
    { label: t("WHAT'S NEW"), also: 'changelog whats new', run: () => panels.showWhatsNew(app) },
    { label: t('COPY REPORT'), also: 'bug report issue problem отчёт ошибка баг проблема', run: copyReport },
  ].filter(Boolean);
}

// The keys along the bottom: there until a few of them have been used — then only ? ALL KEYS, the rest are known.
// (Counted in this window's storage: it's only what the hint shows.)
const KEYS_LEARNT = 5;
let keysUsed = 0;
try { keysUsed = Number(localStorage.getItem('keysUsed')) || 0; } catch { /* no storage: shown */ }
function showKeyHint() { document.body.classList.toggle('keys-learnt', keysUsed >= KEYS_LEARNT); }
function noteKeyUsed() {
  if (keysUsed >= KEYS_LEARNT) return;
  keysUsed++;
  try { localStorage.setItem('keysUsed', String(keysUsed)); } catch { /* counted for this run */ }
  showKeyHint();
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
    if (songs.length) addToQueue(songs).catch(() => setStatus(t("COULDN'T LOAD THAT FILE")));
  });
}

// ---- Frame loop ------------------------------------------------------------------------------------------------

function updateProgressUi(force = false) {
  if (seeking && !force) return;
  const dur = engine.duration, pos = engine.position;
  const v = dur ? Math.round((pos * 1000) / dur) : 0;
  progress.setValue(v);
  deckDisplay.setTime(pos, dur);
}
function toggleRemaining() {
  showRemaining = !showRemaining;
  try { localStorage.setItem('timeRemaining', showRemaining ? '1' : '0'); } catch { /* kept for this run only */ }
  deckDisplay.setTime(jog ? jog.target : engine.position, engine.duration, showRemaining);
}
// The display's track number: its place on the disc in the changer, in the queue otherwise; and the lit words.
function showDeckTrack() {
  const here = state.changerMode && changer.slotOf(ch(), state.index);
  if (here) { const d = state.changer.slots[here.slot]; deckDisplay.setTrack(here.offset + 1, d.end - d.start); }
  else deckDisplay.setTrack(state.queue.length && state.index >= 0 ? state.index + 1 : 0, state.queue.length);
}
function setDisplay(kind, { save = true } = {}) {
  state.display = kind === 'CLASSIC' ? 'CLASSIC' : 'DECK';
  document.body.classList.toggle('classic-display', state.display === 'CLASSIC');
  if (save) saveSettingsSoon();
}
const LOOKS = ['CLASSIC', 'DOCK', 'STAGE', 'GLASS', 'PANEL', 'COVER'];
function setLook(kind, { save = true } = {}) {
  state.look = LOOKS.includes(kind) ? kind : 'CLASSIC';
  for (const k of LOOKS) document.body.classList.toggle(`look-${k.toLowerCase()}`, state.look === k);
  showQueueDrawer(false);
  if (save) saveSettingsSoon();
}
function showQueueDrawer(open) {
  document.body.classList.toggle('queue-open', open);
  $('queue-toggle').classList.toggle('on', open);
}
function showDeckFlags() {
  deckDisplay.setFlags({ playing: engine.playing, paused: !!engine.deck && !engine.playing, shuffle: state.shuffle !== 'OFF', repeat: state.repeat !== 'OFF', repeatOne: state.repeat === 'TRACK', net: isStream(state.loadedPath) }); // (NET: streamed, as a tuner's ST)
}
// Writing a label's text, even the same text, makes the page restyle and repaint it — every frame, for the clock.
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

// Playback logic that must keep running even while this window is hidden (Mini Mode) or minimized — where
// requestAnimationFrame stops — so it runs on a plain timer instead of the frame loop.
let sessionTick = 0, miniLevelsAt = 0;
// Scrobbling (main/scrobble.js): the song playing said once its name is known, and sent as heard once half of it — or
// 4 minutes — has played, once per time it's loaded. Not Spotify's songs: Spotify sends those itself.
const SCROBBLE_LONGEST = 240;
/** Scrobbling while any service is signed in (scrobble:status's answer). */
function noteScrobbling(status) { state.scrobbling = !!status && Object.values(status).some((s) => s && s.user && !s.dropped); }
let scrobbleFor = -1, heardMs = 0, heardAt = 0, toldPlaying = false, scrobbled = false;
function trackScrobble(now) {
  if (!state.scrobbling || !state.loadedPath || isSpotifyUri(state.loadedPath)) return;
  if (scrobbleFor !== state.loadToken) { scrobbleFor = state.loadToken; heardMs = 0; toldPlaying = scrobbled = false; heardAt = now; }
  heardMs += Math.min(now - heardAt, 200); heardAt = now; // (a pause between two ticks isn't heard)
  const d = state.details, length = engine.duration;
  if (scrobbled || !d || state.detailsPath !== state.loadedPath || !(length >= 30)) return;
  const song = { artist: d.artist, title: state.titleText || d.title, album: d.album || null, duration: length };
  if (!toldPlaying) { toldPlaying = true; cdp.scrobbleNowPlaying(song); }
  if (heardMs >= Math.min(length / 2, SCROBBLE_LONGEST) * 1000) { scrobbled = true; cdp.scrobbleHeard({ ...song, at: Date.now() - heardMs }); }
}
function playbackTick() {
  if (!engine.deck || !engine.playing || jog) return; // the snatches heard while the disc is turned by hand aren't playing
  trackScrobble(performance.now());
  engine.watchSegmentEnd();
  if (crossfadeSeconds() === 0 && !spotifyActive()) { // gapless: the next track waits on the standby deck for the seam (or the mix)
    if (automixOn()) { measureEdgesSoon(state.loadedPath); measureEdgesSoon(upcomingPath()); }
    const left = engine.duration - engine.position;
    const window = prepareWindow({ out: automixOn() ? edgesOf(state.loadedPath) : null, duration: engine.duration, lead: PREPARE_SECONDS });
    if (left > 0 && left <= window) prepareNext();
    else if (preparedNext && left > window + 1) { engine.cancelPrepared(); preparedNext = null; } // seeked back
    engine.watchSeam();
    automixSkipSilence();
  }
  if (spotifyActive()) { if (spotifySession) spotifySession.tick(); }
  // Crossfade into the next track once we're within the crossfade window of the end — except between cue sheet
  // tracks that run into each other in the same file, which play on through, as on the album.
  const dur = engine.duration, pos = engine.position;
  if (!state.crossfadeStarted && crossfadeSeconds() > 0 && !spotifyActive() && dur > 0 && dur - pos <= crossfadeSeconds() && !sleepsAfterThis()) {
    state.crossfadeStarted = true;
    if (state.repeat === 'TRACK' && state.loadedPath) load(state.loadedPath, { allowCrossfade: true });
    else {
      const next = upcomingIndex();
      if (next >= 0 && !continuesCurrent(state.queue[next], { atBoundary: false })) { notePlayed(); goTo(next, { allowCrossfade: true }); }
    }
  }
  const now = performance.now();
  if (now - sessionTick > 1000) { sessionTick = now; updateMediaSessionPosition(); followHiddenPhase(); }
  if (state.miniMode) {
    const msg = { playing: true, position: pos, duration: dur };
    if (now - miniLevelsAt > 30) { miniLevelsAt = now; const raw = engine.levels(5, 90); if (raw) msg.levels = raw; }
    cdp.sendMiniState(msg);
  }
  if (state.remoteListening && now - remoteTickAt >= 1000) { remoteTickAt = now; cdp.sendRemoteState({ playing: true, position: pos, duration: dur }); }
}

let last = performance.now(), idleCheck = 0;
// While you're in another app, the window only needs to look alive: drawing it at 30 frames a second instead of 60
// roughly halves what the spinning disc and visualizer cost. Watched — CDPlayer in front, or CD View, Visualizer Mode
// or Karaoke on screen — it stays at full rate.
// Drawn without the graphics card, it's 30 always (render-budget.js).
function frame(now) {
  const watched = document.hasFocus() || state.cdView || state.visualizerMode || isKaraokeOpen();
  const gap = frameGap({ watched, software: state.softwareRendering, playing: engine.playing || !!jog });
  if (gap && now - last < gap - 2) { requestAnimationFrame(frame); return; }
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
  deckDisplay.tick(); // (drawn again only when the theme's colour has moved)
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
  setStatus, setStreaming, queueDisplay, displayName, formatTime, ensureDetails, load, addToQueue, playNext, appendAndPlay, seekTo,
  detailsFor: (p) => detailsCache.get(p),
  playQueueIndex: (i) => { if (i >= 0 && i < state.queue.length) goTo(i); },
  // WHAT'S SPECIAL's SHOW ME: the shelf, the disc's other side, CD View or karaoke, opened for a look.
  showMe: (what) => {
    if (['dust', 'wrap', 'missing', 'discogs', 'shelf'].includes(what)) { if (state.miniMode) return; if (state.cdView) toggleCdView(); return what === 'shelf' ? (isShelfOpen() ? null : toggleShelf()) : shelfShowMe(app, what); }
    if (isShelfOpen()) closeShelf();
    if (what === 'flip') disc.flip(true);
    else if (what === 'cdview') { disc.flip(false); if (!state.cdView) toggleCdView(); } // the disc itself, face up
    else if (what === 'karaoke') { if (!isKaraokeOpen()) toggleKaraoke(); }
  },
  remoteInfo: () => remoteInfo, remoteHeard: onRemoteStatus, commands,
  changerState: ch, changerMode: () => state.changerMode, setChangerMode, discLabel, loadDisc, fillChanger, keepChangerFull, keepingFull, toggleSkip, reloadSkips, isSkippedPath: (p) => state.skipped.has(p), playSlot, ejectSlot, discSkip, coverForPath,
  changerSlotOf: (i) => (changer.slotOf(ch(), i) || { slot: -1 }).slot,
  onFullChanger: (c) => panels.pickDiscToTakeOut(app, c),
  coverSource: () => state.coverFrom || null,
  switchTheme, previewTheme, restoreTheme, shownTheme: () => shownTheme, saveTheme, importTheme, pasteThemeCode, exportTheme, copyThemeCode, deleteTheme,
  copyReport, noteScrobbling, setQuality, setSoundCheck, setMono, setSpatial, setSpatialAmount, setWaveform, setAmbient, setAnimations, setCrossfade, setTransition, setEq, armSleepTimer, armSleepAtEnd, setDisplay, setLook, setMiniMode, setDiscord, setDiscNoise, setDiscWear, setDiscShine, setTaskbarDisc, setOutput, listOutputs, currentOutputName,
  insertDisc, playSpotifyDisc, spotifyActive, stopSpotify, saveTags, setSaveFound, setLyricsOffset, lyricsPosition, seekToLyric,
  setShelfSort: (sort) => { state.shelfSort = sort; saveSettingsSoon(); },
  menu: (anchor, items, opts) => panels.menu(anchor, items, opts),
  choosePressingFor: (album, anchor, onChosen) => choosePressing(album, anchor, null, onChosen),
  shelfAlbumIds, discogsCurrencyChanged,
  setLanguage: (code) => { state.language = code; cdp.saveSettings(settingsSnapshot()); },
  relaunch: async () => { await cdp.saveSettings(settingsSnapshot()); cdp.relaunch(); },
  saveEq: () => cdp.saveEqPresets(state.customPresets),
  lyricsLines: () => (state.lyrics ? parseLrc(state.lyrics) : []),
  openKaraoke: () => toggleKaraoke(),
  currentLineIndex,
  anyOverlayOpen, rememberFocus: () => document.activeElement && document.activeElement.blur(),
  loadHistoryFromDisk: async () => { const s = await cdp.loadState(); state.history = s.history; },
};

// ---- Startup ---------------------------------------------------------------------------------------------------

// The phone remote's status from main (Settings → PHONE REMOTE): the PHONE tag shows while a phone is connected, the
// status line says PHONE CONNECTED when the first one comes, and an open Settings is drawn again.
let remoteInfo = null;
function onRemoteStatus(status) {
  const before = remoteInfo ? remoteInfo.phones.length : null, now = status.phones.length;
  remoteInfo = status;
  const tag = $('phone-tag');
  tag.hidden = now === 0;
  tag.title = phoneTagTitle(status.phones);
  if (phoneJoined(before, now)) setStatus(t('PHONE CONNECTED'));
  panels.refreshSettingsIfOpen(app);
}

// A newer release on GitHub shows a pill in the header. Clicking it downloads the release (the pill counts the
// percent), and clicking again restarts into the new version — or, where this copy can't be replaced in place, opens
// the download. A release with no file for this system, or a failed download clicked again, opens the download page.
// When GitHub can't be reached, the pill is left as it was; while a download is on, later checks leave it be.
const updateState = { version: null, canDownload: false, phase: 'idle', install: null, failed: false }; // phase: idle | downloading | ready | installing

function showUpdatePill() {
  const button = $('update-button');
  const u = updateState;
  button.hidden = !u.version;
  if (!u.version) return;
  if (u.phase === 'downloading') {
    button.textContent = t('DOWNLOADING {percent}%', { percent: Math.round((u.progress || 0) * 100) });
    button.title = t('Downloading CDPlayer {version}…', { version: u.version });
  } else if (u.phase === 'ready') {
    button.textContent = u.install === 'replace' ? t('RESTART TO UPDATE') : t('INSTALL {version}', { version: u.version });
    button.title = u.install === 'replace' ? t('Install CDPlayer {version} and restart — your queue and changer are kept', { version: u.version }) : t('Open the downloaded CDPlayer {version} to install it', { version: u.version });
  } else {
    button.textContent = t('{version} AVAILABLE', { version: u.version });
    button.title = u.canDownload && !u.failed ? t('A newer CDPlayer is out — click to download it') : t('A newer CDPlayer is out — opens the download page');
  }
}

async function checkForUpdate() {
  if (updateState.phase !== 'idle') return;
  const update = await cdp.checkForUpdate().catch(() => ({ offline: true }));
  if ((update && update.offline) || updateState.phase !== 'idle') return;
  if (!update || update.version !== updateState.version) updateState.failed = false;
  updateState.version = update ? update.version : null;
  updateState.canDownload = !!(update && update.canDownload);
  showUpdatePill();
}

async function onUpdateClick() {
  const u = updateState;
  if (u.phase === 'downloading' || u.phase === 'installing') return;
  if (u.phase === 'ready') {
    // One click: a second while the first is starting the installer would start another, racing it for the same files.
    u.phase = 'installing';
    if (u.install === 'replace') { setStatus(t('UPDATING — BACK IN A MOMENT')); saveEverythingNow(); }
    await cdp.installUpdate().catch(() => { setStatus(t('COULDN’T INSTALL THE UPDATE')); cdp.openReleasesPage(); });
    u.phase = 'ready'; // still here: the download was opened or shown (or installing failed), so it can be again
    return;
  }
  if (!u.canDownload || u.failed) { cdp.openReleasesPage(); return; }
  u.phase = 'downloading'; u.progress = 0;
  showUpdatePill();
  try {
    const done = await cdp.downloadUpdate();
    Object.assign(u, { phase: 'ready', install: done.install, version: done.version });
    setStatus(t('CDPLAYER {version} DOWNLOADED', { version: done.version }));
  } catch {
    Object.assign(u, { phase: 'idle', failed: true });
    setStatus(t('UPDATE DOWNLOAD FAILED'));
  }
  showUpdatePill();
}

// The changer as it was saved: changer.txt read against its list, files gone since taken out of their discs; rebuilt
// from the list (albums as discs, singles as a CD-R) when unreadable.
async function changerFromSaved(q) {
  let c = q.savedPaths ? changer.restore(q.changerText, q.savedPaths, q.savedIndex, new Set(q.missing)) : null;
  if (c && c.index < 0 && c.queue.length) c = changer.moveTo(c, 0); // the song it was on went: the first one left
  if (c) return c;
  const details = await Promise.all(q.paths.map((p) => cdp.details(p, { withCover: false }).catch(() => null)));
  const byPath = new Map(q.paths.map((p, i) => [p, details[i]]));
  const albumOf = (p) => {
    const d = byPath.get(p), artist = d && ((d.credits && d.credits.albumArtist) || d.artist);
    return d && d.album ? { key: `${artist || ''}\n${d.album}`.toLowerCase(), title: d.album, artist: artist || null, kind: isSpotifyUri(p) ? 'spotify' : 'album' } : null;
  };
  const r = changer.fromQueue(q.paths, q.index, albumOf, { cdrTitle: null });
  if (r.dropped) setStatus(t('5 DISCS IN THE CHANGER · {n} WENT BACK TO THE SHELF', { n: r.dropped }));
  return r.changer;
}

async function start() {
  translatePage(document);
  setStatus(t('READY TO PLAY'));
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
  // Drawn without the graphics card (a VM's screen): fewer frames, the glow stretched once (render-budget.js).
  const setSoftware = (on) => { if (state.softwareRendering !== !!on) { state.softwareRendering = !!on; paintCoverGlow(); } };
  cdp.gpuSoftware().then(setSoftware).catch(() => {});
  cdp.onGpuSoftware(setSoftware);
  window.addEventListener('resize', () => { if (state.softwareRendering) paintCoverGlowSoon(); });
  cdp.onOpenFiles((files) => addToQueue(files));
  cdp.onMiniCommand(onMiniCommand);
  cdp.onRemoteCommand(onRemoteCommand);
  cdp.onRemoteListening(onRemoteListening);
  cdp.onRemoteStatus(onRemoteStatus);
  onColorsChanged(() => { drawDivider(); pushMini(true); });
  window.addEventListener('resize', () => { drawDivider(); if (state.titleText) setTrackTitle(state.titleText, state.artistText); });

  const saved = await cdp.loadState();
  state.skipped = new Set(await cdp.skips.list().catch(() => []));
  state.version = saved.version; state.platform = saved.platform;
  document.body.dataset.platform = saved.platform;
  state.history = saved.history;
  state.customPresets = saved.eqPresets;
  const s = saved.settings;
  state.changerMode = !!s.changer;
  document.body.classList.toggle('changer-mode', state.changerMode);
  state.playModes = s.playModes || null;
  takePlayModes();
  showModes();
  setAnimations(s.animations);
  setVolume(s.volume);
  state.crossfade = s.crossfade || 5;
  state.transition = s.transition || 'OFF';
  setMono(s.mono);
  state.spatialAmount = Number.isFinite(s.spatialAmount) ? s.spatialAmount : 50;
  setSpatial(!!s.spatial);
  setWaveform(s.waveform);
  state.ambient = s.ambient;
  state.discord = s.discord !== false;
  setDiscNoise(!!s.discNoise);
  state.discWear = s.discWear !== false;
  state.discShine = s.discShine !== false; disc.setShine(state.discShine);
  setDisplay(s.display, { save: false });
  setLook(s.look, { save: false });
  state.taskbarDisc = !!s.taskbarDisc; // its default is the system's (main/store.js)
  state.output = s.output || null;
  state.deviceSounds = {};
  state.scrobbling = false;
  cdp.scrobbleStatus().then(noteScrobbling).catch(() => {});
  cdp.deviceSounds().catch(() => null).then((kept) => { if (kept && typeof kept === 'object') state.deviceSounds = kept; applyOutput(false); });
  navigator.mediaDevices.addEventListener('devicechange', () => applyOutput(true));
  state.saveFound = !!s.saveFound;
  state.streaming = !!s.streaming;
  state.lyricsOffset = s.lyricsOffset || 0;
  state.shelfSort = s.shelfSort || 'ARTIST';
  state.language = s.language || 'AUTO';
  state.quality = s.quality || 'HIGH';
  state.soundCheck = s.soundCheck || 'OFF';
  setEq(s.eq);
  setUserThemes(saved.themes || []);
  const themeIndex = Math.max(0, THEMES.findIndex((theme) => theme.name === s.theme));
  state.themeIndex = -1;
  switchTheme(themeIndex, { instant: true });
  setTrackTitle(t('Pick a track to get started.'), null);
  renderQueue();
  deckDisplay.powerOn();
  requestAnimationFrame(frame);
  setInterval(playbackTick, 40);
  cdp.remoteStatus().then(onRemoteStatus).catch(() => {});
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_RECHECK_MS);
  cdp.listAudioCds().then((list) => { if (list.length) { state.audioCd = list[0]; showAudioCd(); } }).catch(() => {});
  if (s.miniMode) setMiniMode(true);

  // Both modes' music: the one in use comes up ready at its position (not playing), the other waits in `stores`.
  stores.QUEUE = saved.queue ? { queue: saved.queue.paths, index: saved.queue.index, nextUp: null, positionMicros: saved.queue.positionMicros } : null;
  stores.CHANGER = saved.changerQueue ? { saved: saved.changerQueue } : null; // read when the changer is first turned on
  if (state.changerMode && stores.CHANGER) stores.CHANGER = { changer: await changerFromSaved(saved.changerQueue), positionMicros: saved.changerQueue.positionMicros };
  const mine = stores[state.changerMode ? 'CHANGER' : 'QUEUE'];
  if (mine) {
    putStore(mine);
    renderQueue();
    if (state.changerMode) saveQueueSoon(); // a changer rebuilt from its list is kept as rebuilt
    if (state.index >= 0) load(state.queue[state.index], { autoPlay: false, startAt: (mine.positionMicros || 0) / 1e6 });
  }
  const existingInstall = saved.onboarded;
  if (!saved.onboarded) await panels.showOnboarding(app);
  panels.showChangelogIfNeeded(app, saved.lastVersion, existingInstall);
}

start();
