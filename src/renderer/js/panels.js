// In-window panels (Settings, Equalizer, Lyrics, History, Search, the theme and EQ preset menus, the welcome and
// What's New dialogs). Each is a dimmed full-window layer that blocks clicks/drops/shortcuts to the player behind it,
// with a centered card that grows and fades in, and shrinks and fades out.
import { THEMES } from './theme.js';
import { EQ_FREQUENCIES } from './audio.js';
import { el, pill, toggle, setToggle, Slider, anim } from './widgets.js';
import { catSvg } from './glyphs.js';
import { isBookletOpen, closeBooklet } from './booklet.js';
import { formatLyricsForDisplay } from './lyrics.js';

const layer = () => document.getElementById('overlays');
const panels = new Map(); // name -> { overlay, card, build }
// Escape closes the closest thing first, in this order.
const ESC_ORDER = ['onboarding', 'changelog', 'booklet', 'menu', 'lyrics', 'tags', 'eq', 'rip', 'history', 'spotify', 'search', 'settings'];

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
export const anyOpen = () => panels.size > 0 || !!menuLayer || isBookletOpen();
export function closeTopmost() {
  for (const name of ESC_ORDER) {
    if (name === 'menu') { if (menuLayer) { closeMenu(); return true; } continue; }
    if (name === 'booklet') { if (isBookletOpen()) { closeBooklet(); return true; } continue; }
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

let themeButton = null, presetButton = null;
export function updateThemeButton(app, name) { if (themeButton) themeButton.lastChild.textContent = name; }

export function showSettings(app) {
  openPanel('settings', () => buildSettings(app), { width: 420 });
}
export function refreshSettingsIfOpen(app) { if (isOpen('settings')) refreshPanel('settings'); }

const section = (text) => el('div', { class: 'settings-section' }, text);
// The preset the current EQ gains match (built-in or saved), or CUSTOM once a band has been moved off every preset.
function presetName(app) {
  const gains = app.state.eq, same = (p) => p.gains.every((g, i) => Math.round(g) === Math.round(gains[i]));
  const match = [...app.BUILTIN_EQ_PRESETS, ...app.state.customPresets].find(same);
  return match ? match.name.toUpperCase() : 'CUSTOM';
}

function buildSettings(app) {
  const s = app.state;
  // The swatch follows the live colors (CSS variables), so it stays right for AUTO and during a theme transition.
  themeButton = el('button', { class: 'pill theme-pill', title: 'Pick a theme', onClick: () => showThemeMenu(app) },
    el('span', { class: 'swatch' }), el('span', {}, THEMES[s.themeIndex].name));
  presetButton = pill(presetName(app), () => showPresetMenu(app), 'Switch to another equalizer preset');
  const eqButton = pill('EQ', () => showEq(app), 'Adjust the 10 bands, or save your own preset');

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

  const offsetText = (ms) => (ms ? `${ms > 0 ? '+' : '−'}${Math.abs(ms)} MS` : '0 MS');
  const offsetValue = el('span', { class: 'row-value' }, offsetText(s.lyricsOffset));
  const lyricsOffset = new Slider({ min: -10, max: 10, value: Math.round(s.lyricsOffset / 50), onInput: (v) => { offsetValue.textContent = offsetText(v * 50); app.setLyricsOffset(v * 50); } });
  lyricsOffset.canvas.title = 'Move the lyrics later (+) or earlier (−) for a song timed a little off';

  const mono = toggle(s.mono, () => { app.setMono(!s.mono); setToggle(mono, s.mono); });
  const waveform = toggle(s.waveform, () => { app.setWaveform(!s.waveform); setToggle(waveform, s.waveform); });
  const ambient = toggle(s.ambient, () => { app.setAmbient(!s.ambient); setToggle(ambient, s.ambient); });
  const animations = toggle(anim.enabled, () => { app.setAnimations(!anim.enabled); setToggle(animations, anim.enabled); });
  const mini = toggle(s.miniMode, () => app.setMiniMode(!s.miniMode));
  const discord = toggle(s.discord, () => { app.setDiscord(!s.discord); setToggle(discord, s.discord); });
  const discNoise = toggle(s.discNoise, () => { app.setDiscNoise(!s.discNoise); setToggle(discNoise, s.discNoise); });
  const saveFound = toggle(s.saveFound, () => { app.setSaveFound(!s.saveFound); setToggle(saveFound, s.saveFound); });
  // A Spotify disc plays outside Web Audio: the EQ, crossfade and mono can't shape it.
  const forSpotify = app.spotifyActive();
  const unavailable = (node) => (forSpotify ? el('div', { class: 'unavailable', title: 'Not available for Spotify' }, node) : node);

  const github = el('div', { class: 'github-link', title: 'Open GitHub profile', onClick: () => app.cdp.openGitHub('Kizarov3') }, catSvg(), el('span', {}, 'Kizarov3'));
  const body = el('div', { class: 'scroll settings-body' },
    section('SOUND'),
    unavailable(row('EQUALIZER', el('div', { class: 'row-pills' }, presetButton, eqButton))),
    unavailable(sliderRow('CROSSFADE', crossfade, crossfadeValue)),
    unavailable(row('MONO AUDIO', mono)),
    hint('Sums the left and right channels together — for a single speaker or one earbud.'),
    row('DISC NOISE', discNoise),
    hint('A real player’s sounds: a faint hiss, the tray motor, the disc spinning up — and a skip when you shake the window.'), gap(18),
    section('LOOK'),
    row('THEME', themeButton),
    row('WAVEFORM', waveform),
    row('AMBIENT BACKGROUND', ambient),
    row('ANIMATIONS', animations), gap(18),
    section('PLAYBACK'),
    sliderRow('SLEEP TIMER', sleep, sleepValue),
    sliderRow('LYRICS OFFSET', lyricsOffset, offsetValue),
    hint('Karaoke and the lyrics already follow what you hear, Bluetooth included. Move them if a song’s lyrics are timed a little off.'),
    row('MINI MODE', mini), gap(18),
    section('LIBRARY'),
    row('SAVE FOUND ART & LYRICS', saveFound),
    hint('Covers and lyrics found online are written into the song’s file (once it’s finished playing), so they’re there offline and in other players too.'), gap(18),
    section('SHARING'),
    row('DISCORD STATUS', discord),
    hint('Shows the song you’re playing on your Discord profile, while the Discord app is open.'));
  return [title('SETTINGS'), gap(18), body, el('div', { class: 'settings-foot' }, github, pill('CLOSE', () => closePanel('settings')))];
}

// ---- Drop-down menus (theme picker, EQ presets) ------------------------------------------------------------------

let menuLayer = null;
/** A small menu under `anchor`; items are { label, swatch (CSS background, optional), current, pick }. */
function showMenu(anchor, items) {
  closeMenu();
  const box = anchor.getBoundingClientRect();
  const menu = el('div', { class: 'theme-menu' }, items.map((item) => {
    const swatch = item.swatch ? el('span', { class: 'swatch' }) : null;
    if (swatch) swatch.style.background = item.swatch;
    return el('div', { class: `theme-item${item.current ? ' current' : ''}`, onClick: () => { item.pick(); closeMenu(); } }, swatch, item.label);
  }));
  const layerNode = el('div', { class: 'theme-menu-layer', onMousedown: (e) => { if (e.target === layerNode) closeMenu(); } }, menu);
  layer().append(layerNode);
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - m.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(box.bottom + 6, window.innerHeight - m.height - 4))}px`;
  menuLayer = layerNode;
}
export function closeMenu() { if (menuLayer) { menuLayer.remove(); menuLayer = null; } }

function showThemeMenu(app) {
  showMenu(themeButton, THEMES.map((t, i) => ({
    label: t.name, swatch: `linear-gradient(135deg, rgb(${t.accent}), rgb(${t.accent2}))`,
    current: i === app.state.themeIndex, pick: () => app.switchTheme(i),
  })));
}
function showPresetMenu(app) {
  const current = presetName(app);
  showMenu(presetButton, [...app.BUILTIN_EQ_PRESETS, ...app.state.customPresets].map((p) => ({
    label: p.name.toUpperCase(), current: p.name.toUpperCase() === current,
    pick: () => { app.setEq(p.gains); presetButton.textContent = p.name.toUpperCase(); },
  })));
}

// ---- Equalizer -------------------------------------------------------------------------------------------------

const formatDb = (db) => `${Math.round(db) > 0 ? '+' : ''}${Math.round(db)}dB`;
const formatFreq = (f) => (f >= 1000 ? `${f / 1000}K` : String(f));

export function showEq(app) {
  const p = openPanel('eq', () => buildEq(app));
  p.onClose = () => refreshSettingsIfOpen(app); // the preset shown in Settings may have changed
}
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
  return [title('EQUALIZER'), app.spotifyActive() ? hint('Not available for Spotify — the equalizer shapes your own files.') : [], gap(18), sliders.map((x) => x.row), gap(10),
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
    body = el('div', { class: 'scroll' }, el('div', { class: 'lyrics-plain' }, formatLyricsForDisplay(app.state.lyrics)));
    lyricsView = null;
  } else {
    const nodes = lines.map((l) => el('div', { class: 'lyrics-line', onClick: () => app.seekToLyric(l.time) }, l.text || ' '));
    body = el('div', { class: 'scroll' }, nodes);
    lyricsView = { lines, nodes, scroller: body, highlight: -1 };
  }
  body.style.height = '380px';
  body.style.marginTop = '16px';
  const karaoke = lines.length ? pill('KARAOKE', () => { closePanel('lyrics'); app.openKaraoke(); }, 'The lyrics full-window, filling in word by word as they are sung (Y)') : null;
  return [title('LYRICS'), body, el('div', { class: 'close-row split' }, karaoke || el('span'), pill('CLOSE', () => closePanel('lyrics')))];
}
/** Karaoke-style: highlight the line at the current playback position and keep it centered. */
export function updateLyricsSync(app, force = false) {
  if (!lyricsView || !isOpen('lyrics')) return;
  const index = app.currentLineIndex(lyricsView.lines, app.lyricsPosition());
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

// ---- Tags: what the file says, what MusicBrainz says, and writing it in ---------------------------------------------

const TAG_ROWS = [
  ['TITLE', 'title'], ['ARTIST', 'artist'], ['ALBUM', 'album'], ['ALBUM ARTIST', 'albumArtist'], ['YEAR', 'year'],
  ['TRACK', 'track', 'trackCount'], ['DISC', 'disc', 'discCount'], ['GENRE', 'genre'], ['LABEL', 'label'],
];
let tagsView = null; // { path, name, canWrite, current, found, foundCover, values, picked: Set, status, busy }

export function showTags(app) {
  const path = app.state.loadedPath;
  if (!path) return;
  tagsView = { path, name: app.displayName(path), canWrite: true, current: null, found: null, foundCover: null, values: {}, picked: new Set(), status: 'READING THE FILE…', busy: true };
  const p = openPanel('tags', () => buildTags(app), { width: 660 });
  p.onClose = () => { tagsView = null; };
  loadTags(app, tagsView);
}
const tagsCurrent = (view) => tagsView === view && isOpen('tags');

async function loadTags(app, view) {
  const r = await app.cdp.readTags(view.path).catch(() => ({ canWrite: false }));
  if (!tagsCurrent(view)) return;
  view.canWrite = r.canWrite;
  view.current = r.tags || {};
  for (const [, ...keys] of TAG_ROWS) for (const k of keys) view.values[k] = view.current[k] ?? '';
  if (!r.canWrite) { view.status = 'TAGS CAN’T BE WRITTEN TO THIS FILE (A CUE SHEET TRACK, OR A FORMAT WITHOUT TAGS)'; view.busy = false; refreshPanel('tags'); return; }
  // Lyrics found online (not the file's own) are offered too.
  view.lyricsOffer = app.state.lyrics && !(app.state.details && app.state.details.lyrics) ? app.state.lyrics : null;
  if (view.lyricsOffer) view.picked.add('lyrics');
  view.status = 'LOOKING THE SONG UP ON MUSICBRAINZ…';
  refreshPanel('tags');
  await lookUpTags(app, view);
}

async function lookUpTags(app, view) {
  const d = app.state.details || {};
  view.busy = true;
  const found = await app.cdp.lookupTags({ artist: d.artist, title: d.title, album: d.album, duration: d.duration || app.engine.duration, guessed: !!d.nameGuessed }).catch(() => ({ networkError: true }));
  if (!tagsCurrent(view)) return;
  view.busy = false;
  if (!found || found.networkError) {
    view.status = found ? 'MUSICBRAINZ COULDN’T BE REACHED — YOU CAN STILL EDIT THE TAGS BY HAND' : 'MUSICBRAINZ DOESN’T KNOW THIS SONG — YOU CAN STILL EDIT THE TAGS BY HAND';
    refreshPanel('tags');
    return;
  }
  view.found = found;
  // Every field MusicBrainz knows and the file has differently is filled in and ticked; the rest stay as they are.
  for (const [, ...keys] of TAG_ROWS) for (const k of keys) {
    if (found[k] == null || found[k] === '') continue;
    view.values[k] = found[k];
    if (String(found[k]) !== String(view.current[k] ?? '')) view.picked.add(k);
  }
  view.status = `FOUND ON MUSICBRAINZ · ${[found.album, found.year].filter(Boolean).join(' · ')}`.toUpperCase();
  refreshPanel('tags');
  if (!view.current.hasCover && found.coverUrl) {
    const cover = await app.cdp.coverFromUrl(found.coverUrl).catch(() => null);
    if (!tagsCurrent(view) || !cover) return;
    view.foundCover = cover;
    view.picked.add('cover');
    refreshPanel('tags');
  }
}

function buildTags(app) {
  const v = tagsView;
  const pick = (key) => {
    const b = el('button', { class: `tag-pick${v.picked.has(key) ? ' on' : ''}`, title: 'Write this into the file', disabled: !v.canWrite }, '✓');
    b.addEventListener('click', () => { v.picked.has(key) ? v.picked.delete(key) : v.picked.add(key); b.classList.toggle('on', v.picked.has(key)); save.disabled = !v.picked.size || v.busy; });
    return b;
  };
  // Typing in a field ticks it (a track or disc number and its "of" share one tick).
  const input = (key, narrow, pair) => {
    const i = el('input', { class: `text-input tag-input${narrow ? ' narrow' : ''}`, value: v.values[key] ?? '', spellcheck: 'false', disabled: !v.canWrite });
    i.addEventListener('input', () => {
      v.values[key] = i.value;
      for (const k of [key, pair].filter(Boolean)) { v.picked.add(k); if (picks.get(k)) picks.get(k).classList.add('on'); }
      save.disabled = false;
    });
    return i;
  };
  const picks = new Map();
  const shown = (x) => (x == null || x === '' ? '—' : String(x));
  const rows = TAG_ROWS.map(([label, key, of]) => {
    const now = of ? `${shown(v.current && v.current[key])}${v.current && v.current[of] ? ` of ${v.current[of]}` : ''}` : shown(v.current && v.current[key]);
    const b = pick(key); picks.set(key, b);
    if (of) { const b2 = pick(of); b2.hidden = true; picks.set(of, b2); }
    const edit = of ? el('div', { class: 'tag-pair' }, input(key, true, of), el('span', {}, 'OF'), input(of, true, key)) : input(key);
    if (of) b.addEventListener('click', () => { if (v.picked.has(key)) v.picked.add(of); else v.picked.delete(of); });
    return el('div', { class: 'tag-row' }, el('span', { class: 'tag-label' }, label), el('span', { class: 'tag-now', title: now }, now), edit, b);
  });
  const thumb = (src) => (src ? el('img', { class: 'tag-thumb', src, alt: '' }) : el('span', { class: 'tag-now' }, '—'));
  const coverNow = v.current && v.current.hasCover ? el('span', { class: 'tag-now' }, 'In the file') : el('span', { class: 'tag-now' }, 'None');
  if (v.foundCover) rows.push(el('div', { class: 'tag-row' }, el('span', { class: 'tag-label' }, 'COVER'), coverNow, el('div', {}, thumb(v.foundCover), el('span', { class: 'tag-source' }, 'Cover Art Archive')), pick('cover')));
  if (v.lyricsOffer) rows.push(el('div', { class: 'tag-row' }, el('span', { class: 'tag-label' }, 'LYRICS'), el('span', { class: 'tag-now' }, 'None'),
    el('span', { class: 'tag-source' }, `${/^\[\d/m.test(v.lyricsOffer) ? 'Timed' : 'Plain'}, from ${app.state.lyricsSource || 'online'}`), pick('lyrics')));
  const save = el('button', { class: 'pill on', disabled: !v.picked.size || v.busy || !v.canWrite }, 'SAVE TO FILE');
  save.addEventListener('click', async () => {
    const changes = {};
    for (const k of v.picked) {
      if (k === 'cover') changes.cover = v.foundCover;
      else if (k === 'lyrics') changes.lyrics = v.lyricsOffer;
      else changes[k] = v.values[k] === '' ? null : v.values[k];
    }
    if (v.found && Object.keys(changes).some((k) => k !== 'lyrics' && k !== 'cover')) {
      changes.musicBrainzTrackId = v.found.musicBrainzTrackId; changes.musicBrainzReleaseId = v.found.musicBrainzReleaseId;
    }
    v.busy = true; v.status = 'WRITING…'; refreshPanel('tags');
    const r = await app.saveTags(v.path, changes);
    if (!tagsCurrent(v)) return;
    if (r.ok) { closePanel('tags'); app.setStatus('TAGS SAVED INTO THE FILE'); return; }
    v.busy = false; v.status = `COULDN’T SAVE · ${r.error || 'UNKNOWN ERROR'}`; refreshPanel('tags');
  });
  const again = pill('LOOK UP AGAIN', () => { if (!v.busy && v.canWrite) { v.status = 'LOOKING THE SONG UP ON MUSICBRAINZ…'; refreshPanel('tags'); lookUpTags(app, v); } }, 'Ask MusicBrainz again');
  again.disabled = v.busy || !v.canWrite;
  return [
    title('TAGS'), el('div', { class: 'subtitle' }, v.name),
    el('div', { class: `tag-status${v.busy ? ' busy' : ''}` }, v.status),
    el('div', { class: 'tag-head' }, el('span', {}, ''), el('span', {}, 'IN THE FILE'), el('span', {}, 'SAVE AS'), el('span', {}, '')),
    el('div', { class: 'scroll tag-rows' }, rows),
    el('div', { class: 'close-row split' }, again, el('div', { class: 'row-pills' }, pill('CLOSE', () => closePanel('tags')), save)),
  ];
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

// ---- The rip ----------------------------------------------------------------------------------------------------
// RIP clicked while it rips: the disc's tracks — done (with the file's size), the one being read or encoded, and the
// ones to come — with CANCEL RIP. Closing it leaves the rip going; when it's finished, SHOW IN FOLDER.

export function showRip(app) { openPanel('rip', () => buildRip(app), { width: 520 }); }
export function refreshRipIfOpen(app) { if (isOpen('rip')) refreshPanel('rip'); }
const STAGE = { reading: 'reading from the disc…', encoding: 'encoding…' };
function buildRip(app) {
  const r = app.state.rip;
  if (!r) return [title('RIP'), el('div', { class: 'empty-note' }, 'NOTHING BEING RIPPED'), closeRow(() => closePanel('rip'))];
  const heading = r.finished ? (r.ok ? 'RIPPED' : 'RIP STOPPED') : 'RIPPING';
  const head = el('div', { class: 'rip-head' },
    el('div', { class: 'rip-album' }, [r.artist, r.year].filter(Boolean).join(' · ') || 'Audio CD'),
    el('div', { class: 'rip-count' }, `${r.done} / ${r.tracks.length} · ${r.percent}%`),
    r.folder ? el('div', { class: 'rip-folder', title: r.folder }, `→ ${r.folder}`) : null);
  const rows = r.tracks.map((t, i) => {
    const stage = r.stages[i];
    const mark = stage === 'done' ? '✓' : stage ? '●' : '·';
    const note = stage === 'done' ? `${(r.sizes[i] / 1048576).toFixed(1)} MB` : STAGE[stage] || '';
    return el('div', { class: `list-row plain rip-row ${stage || 'waiting'}` },
      el('span', { class: 'rip-mark' }, mark),
      el('span', { class: 'entry' }, `${String(i + 1).padStart(2, '0')} ${t.title}`),
      el('span', { class: 'rip-time' }, t.duration ? app.formatTime(t.duration) : ''),
      el('span', { class: 'rip-note' }, note));
  });
  const list = el('div', { class: 'scroll rip-list' }, rows);
  list.style.height = '340px'; list.style.marginTop = '12px';
  const buttons = el('div', { class: 'close-row split' },
    r.finished
      ? (r.ok ? pill('SHOW IN FOLDER', () => app.cdp.showRipFolder(), 'Open the album\'s folder') : el('span', { class: 'rip-result' }, r.message || ''))
      : pill('CANCEL RIP', () => app.cdp.cancelRip(), 'Stop ripping; the tracks already done are kept'),
    pill('CLOSE', () => closePanel('rip')));
  return [title(`${heading} · ${(r.album || 'AUDIO CD').toUpperCase()}`), head, list, buttons];
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

// ---- Spotify -----------------------------------------------------------------------------------------------------
// Three states: no developer app yet (the Client ID and Secret, with how to get them), not connected (or connected
// before playback existed), and connected — your saved albums, your playlists, and a search. A click puts it on the tray.

const SPOTIFY_MESSAGES = {
  SIGN_IN: 'CONNECT SPOTIFY AGAIN', OFFLINE: "COULDN'T REACH SPOTIFY",
  NOT_SHARED: 'SPOTIFY ONLY SHARES THE SONGS OF PLAYLISTS YOU OWN OR COLLABORATE ON', EMPTY: 'NOTHING TO PLAY ON THAT ONE',
};
const sp = { account: null, editing: false, drm: null, tab: 'ALBUMS', lists: { ALBUMS: null, PLAYLISTS: null }, next: { ALBUMS: 0, PLAYLISTS: 0 }, query: '', found: null, status: '', searchTimer: null };
// (No answer at all says why, when the network did: "COULDN'T REACH SPOTIFY · ERR_CERT_AUTHORITY_INVALID".)
const spotifyMessage = (code, detail) => (code === 'OFFLINE' && detail ? `${SPOTIFY_MESSAGES.OFFLINE} · ${detail}` : SPOTIFY_MESSAGES[code] || `SPOTIFY · ${code}`);

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
    sp.status = spotifyMessage(r.error, r.detail);
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
    if (r.error) { sp.status = spotifyMessage(r.error, r.detail); if (r.error === 'SIGN_IN') sp.account = { ...sp.account, reconnectNeeded: true }; } else { sp.found = r.items; sp.status = ''; }
    refreshPanel('spotify');
  }, 400);
}
async function putSpotifyOnTray(app, item) {
  sp.status = `READING ${item.name.toUpperCase()}…`; refreshPanel('spotify');
  const r = await app.cdp.spotifyDiscTracks({ kind: item.kind, id: item.id }).catch(() => ({ error: 'OFFLINE' }));
  if (r.error) {
    sp.status = spotifyMessage(r.error, r.detail);
    if (r.error === 'SIGN_IN') sp.account = { ...sp.account, reconnectNeeded: true }; // the panel offers RECONNECT
    refreshPanel('spotify'); return;
  }
  sp.status = '';
  closePanel('spotify');
  app.playSpotifyDisc(r.tracks, item.name);
}

// Text to paste somewhere else (the Spotify dashboard's Redirect URI): clicking it copies it, and it says so.
function copyLink(app, text) {
  const link = el('button', { class: 'copy-link', title: 'Copy' }, text);
  let timer = null;
  link.addEventListener('click', async () => {
    if (!(await app.cdp.copyText(text).catch(() => false))) return;
    link.classList.add('copied');
    clearTimeout(timer); timer = setTimeout(() => link.classList.remove('copied'), 1600);
  });
  return link;
}

const changeAppPill = () => pill('CHANGE APP', () => { sp.editing = true; sp.status = ''; refreshPanel('spotify'); }, 'Enter another Client ID and Secret — to fix a mistyped one, or to use another Spotify developer app');

function buildSpotify(app) {
  const a = sp.account;
  const status = el('div', { class: 'setting-hint' }, sp.status);
  const foot = el('div', { class: 'close-row' }, pill('CLOSE', () => closePanel('spotify')));
  if (!a) return [title('SPOTIFY'), gap(18), hint('CHECKING…'), foot];

  // The developer app's Client ID and Secret: at first, and again from CHANGE APP (a mistyped Secret, another app).
  if (!a.configured || sp.editing) {
    const id = el('input', { class: 'text-input', type: 'text', placeholder: 'Client ID', spellcheck: 'false' });
    const secret = el('input', { class: 'text-input', type: 'password', placeholder: 'Client Secret', spellcheck: 'false' });
    const save = pill('SAVE', async () => {
      if (!id.value.trim() || !secret.value.trim()) { sp.status = 'BOTH ARE NEEDED'; refreshPanel('spotify'); return; }
      if (sp.editing) app.stopSpotify(); // another app's sign-in can't carry on playing
      sp.account = await app.cdp.saveSpotifyCredentials({ clientId: id.value, clientSecret: secret.value });
      Object.assign(sp, { editing: false, status: '', lists: { ALBUMS: null, PLAYLISTS: null }, next: { ALBUMS: 0, PLAYLISTS: 0 }, found: null });
      refreshSpotifyAccount(app);
    });
    const cancel = a.configured ? pill('CANCEL', () => { sp.editing = false; sp.status = ''; refreshPanel('spotify'); }) : null;
    return [title('SPOTIFY'), gap(12),
      hint('Spotify lets each app play for only five people, so CDPlayer plays through your own free Spotify developer app. You need Spotify Premium.'),
      hint('1. Open the Spotify dashboard and create an app. Tick Web API and Web Playback SDK.'),
      el('div', { class: 'setting-hint' }, '2. Redirect URI: ', copyLink(app, 'http://127.0.0.1:8080/callback'), ' (click it to copy)'),
      hint('3. Under User Management, add the email of your Spotify account.'),
      hint('4. Paste the app’s Client ID and Client Secret here.'), gap(12),
      el('div', { class: 'row-pills' }, pill('OPEN SPOTIFY DASHBOARD', () => app.cdp.openSpotifyDashboard())), gap(12),
      id, gap(8), secret, gap(12), el('div', { class: 'row-pills' }, save, cancel), status, foot];
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
      gap(12), el('div', { class: 'row-pills' }, connect, changeAppPill()), status, foot];
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
  const drm = sp.drm === false ? hint("Spotify playback isn't supported on this system — Widevine isn't available.") : [];
  requestAnimationFrame(() => { if (sp.query && document.activeElement !== field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); } });
  const disconnect = pill('DISCONNECT SPOTIFY', async () => {
    app.stopSpotify();
    sp.account = await app.cdp.disconnectSpotify();
    Object.assign(sp, { lists: { ALBUMS: null, PLAYLISTS: null }, next: { ALBUMS: 0, PLAYLISTS: 0 }, query: '', found: null, status: 'SPOTIFY DISCONNECTED' });
    refreshPanel('spotify');
  }, 'Sign CDPlayer out of Spotify. Your Client ID and Secret stay, so connecting again is one click.');
  const connectedFoot = el('div', { class: 'close-row split' }, el('div', { class: 'row-pills' }, disconnect, changeAppPill()), pill('CLOSE', () => closePanel('spotify')));
  return [title('SPOTIFY'), gap(12), tabs, gap(10), field, drm, gap(10), el('div', { class: 'scroll' }, rows), status, connectedFoot];
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
  { version: '2.9.0', changes: [
    '<b>Spotify</b> (Premium): SPOTIFY lists your saved albums and playlists, with a search &mdash; click one and it goes in as a disc and plays, with Up Next, shuffle and repeat, lyrics and karaoke, and an album plays through without gaps',
    'It plays through your own free Spotify developer app (Spotify lets an app play for only five people) &mdash; the SPOTIFY panel walks you through it',
    '<b>Word-by-word lyrics for more songs</b>, now also from Kugou, checked against the song&rsquo;s line timing',
    'Karaoke for lyrics timed only by the line fills at the song&rsquo;s own pace, instead of racing ahead on slow choruses',
  ] },
  { version: '2.8.0', changes: [
    '<b>Rip a CD</b>: RIP beside AUDIO CD saves the disc into your music folder as lossless FLAC, tagged with its names and cover &mdash; click RIPPING for the list of tracks',
    '<b>Audio CDs on Windows</b> too: put a CD in and play it, named from MusicBrainz, straight from the drive',
    '<b>Karaoke like Apple Music&rsquo;s</b> (Y): each word fills as it&rsquo;s sung and holds on long notes, with backing vocals, duets and a breathing pause &mdash; word-timed lyrics now also from NetEase Music, and a Lyrics Offset in Settings',
    '<b>The album booklet</b>: on the shelf, click a case&rsquo;s cover and its booklet lifts out &mdash; the tracklist, every song&rsquo;s lyrics, the credits and the back cover',
    '<b>Every album has its cover</b>: the shelf finds covers online for albums with none, and always the album&rsquo;s own',
  ] },
  { version: '2.7.0', changes: [
    '<b>The CD shelf</b> (S): every album in your music folder, spine out on a shelf. Click one and the case slides out; PLAY puts it in the player',
    '<b>The disc tray</b> (E, or &#9167;): the disc comes out on its tray &mdash; drop music on it for a new disc, close it and the drive reads it and plays',
    '<b>Audio CDs</b> (macOS and Linux): put a CD in your drive and play it, every track named from MusicBrainz, with its cover',
    '<b>Karaoke</b> (Y): the lyrics fill the window and fill in word by word as they&rsquo;re sung',
    '<b>Tags</b>: fix a song&rsquo;s tags from MusicBrainz (or by hand) and save its cover and lyrics into the file &mdash; and, in Settings, have found covers and lyrics saved automatically',
    '<b>Printed discs</b>: the cover printed around a clear hub, and a handwritten CD-R for songs without one. Plus <b>disc noise</b> in Settings, and more covers and lyrics found online',
  ] },
  { version: '2.6.0', changes: [
    '<b>The CD booklet</b>: open the album art (click the little cover in the case), then click it again &mdash; the booklet lifts out and opens, printed in the album&rsquo;s colours, with the tracklist, lyrics, credits and a back cover with the small print. &larr; / &rarr; turn the pages',
    '<b>The disc catches the light</b> like a real CD: rainbow reflections that follow your mouse, as if you were tilting it under a lamp',
  ] },
  { version: '2.5.1', changes: [
    '<b>Discord shows the album cover</b> for every song it can find online &mdash; also for songs whose cover is inside the file',
    '<b>Covers and lyrics for badly named songs</b>: names like &ldquo;Unknown Artist&rdquo;, &ldquo;01. Title&rdquo;, &ldquo;Title - Remastered 2011&rdquo; or &ldquo;feat.&rdquo; credits no longer get in the way',
    'Files named &ldquo;Title - Artist&rdquo; are recognised and shown the right way round',
  ] },
  { version: '2.5.0', changes: [
    '<b>Discord status</b>: while a song plays, your Discord profile shows &ldquo;Listening to&rdquo; the artist, with the song, a progress bar and the cover &mdash; turn it off any time in Settings &rsaquo; Sharing',
    'It clears when you pause, and works whenever the Discord app is open on this computer &mdash; no sign-in needed',
  ] },
  // 2.4.1 came out right after 2.4.0, so it repeats 2.4.0's changes for everyone updating straight from 2.3.
  { version: '2.4.1', changes: [
    '<b>Tidier player</b>: shuffle and repeat now sit beside the playback buttons, LOAD A TRACK is next to the volume, and SEARCH, SAVE, LOAD and CLEAR are in the queue&rsquo;s header',
    'The queue shows more than twice as many tracks, with the one playing highlighted',
    '<b>Settings</b> is grouped into Sound, Look and Playback, and shows the equalizer preset you&rsquo;re on &mdash; click it to switch presets without opening the EQ',
    'Small windows fit: the player no longer runs off the right edge when the window is at its narrowest',
    'The &ldquo;x.y.z AVAILABLE&rdquo; message always shows the newest version &mdash; CDPlayer now asks GitHub every time instead of remembering an older answer',
  ] },
  { version: '2.4.0', changes: [
    '<b>Tidier player</b>: shuffle and repeat now sit beside the playback buttons, LOAD A TRACK is next to the volume, and SEARCH, SAVE, LOAD and CLEAR are in the queue&rsquo;s header',
    'The queue shows more than twice as many tracks, with the one playing highlighted',
    '<b>Settings</b> is grouped into Sound, Look and Playback, and shows the equalizer preset you&rsquo;re on &mdash; click it to switch presets without opening the EQ',
    'Small windows fit: the player no longer runs off the right edge when the window is at its narrowest',
  ] },
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
