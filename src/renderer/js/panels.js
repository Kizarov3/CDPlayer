// In-window panels (Settings, Equalizer, Lyrics, History, Search, the theme and EQ preset menus, the welcome and
// What's New dialogs). Each is a dimmed full-window layer that blocks clicks/drops/shortcuts to the player behind it,
// with a centered card that grows and fades in, and shrinks and fades out.
import { THEMES, draftFrom } from './theme.js';
import { buildThemeEditor, themeLabel } from './theme-editor.js';
import { t, locale } from './i18n.js';
import { historyDays } from './history-days.js';
import { EQ_FREQUENCIES } from './audio.js';
import { el, pill, toggle, setToggle, Slider, anim, EASE, growFrom } from './widgets.js';
import { FAQ, SHORTCUTS, FEATURES } from './help.js';
import { findCommands } from './search-commands.js';
import { startTour } from './tour-view.js';
import { outputName } from './output.js';
import { levelName, LEVELS } from './quality.js';
import { catSvg } from './glyphs.js';
import { qrSvg } from './qr.js';
import { phoneLine, addressWords, errorWords } from './remote-settings.js';
import { isBookletOpen, closeBooklet } from './booklet.js';
import { formatLyricsForDisplay } from './lyrics.js';

const layer = () => document.getElementById('overlays');
const panels = new Map(); // name -> { overlay, card, build }
// Escape closes the closest thing first, in this order.
const ESC_ORDER = ['changer-full', 'onboarding', 'guide', 'features', 'faq', 'shortcuts', 'changelog', 'tags', 'check', 'card', 'booklet', 'menu', 'theme', 'lyrics', 'eq', 'rip', 'history', 'spotify', 'search', 'settings'];

// A panel comes out of the button that opened it, and goes back into it: the one just pressed, or — opened by a key —
// the header's button for it. (Without one, it rises in as before.)
const ORIGINS = { settings: 'settings-button', history: 'history-button', spotify: 'spotify-button', lyrics: 'lyrics-button', tags: 'tags-button', search: 'search-button' };
let pressed = null;
document.addEventListener('pointerdown', (e) => { const b = e.target.closest && e.target.closest('button'); pressed = b ? { b, at: performance.now() } : null; }, true);
document.addEventListener('keydown', () => { pressed = null; }, true);
function originOf(name) {
  const b = pressed && performance.now() - pressed.at < 1500 && pressed.b.isConnected ? pressed.b : document.getElementById(ORIGINS[name] || '');
  return b && b.offsetParent && !b.closest('.overlay.closing') ? b : null;
}
const morph = (card, from, back) => growFrom(card, from, back);

function openPanel(name, build, { width } = {}) {
  let p = panels.get(name);
  const opening = !p;
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
  const from = opening && anim.enabled ? originOf(name) : null;
  pressed = null;
  if (from) { p.card.classList.add('morph'); p.origin = from; morph(p.card, from, false); }
  return p;
}
function closePanel(name) {
  const p = panels.get(name);
  if (!p) return;
  panels.delete(name);
  if (p.onClose) p.onClose();
  if (!anim.enabled) { p.overlay.remove(); return; }
  p.overlay.classList.add('closing');
  const back = p.origin && p.origin.isConnected && p.origin.offsetParent ? morph(p.card, p.origin, true) : null;
  if (back) back.onfinish = () => p.overlay.remove();
  else { p.card.classList.remove('morph'); p.card.addEventListener('animationend', () => p.overlay.remove(), { once: true }); }
  setTimeout(() => p.overlay.remove(), 320);
}
function refreshPanel(name) {
  const p = panels.get(name);
  if (!p) return;
  const scrollers = [...p.card.querySelectorAll('.scroll')].map((s) => s.scrollTop);
  p.card.replaceChildren(...[p.build()].flat(Infinity)); // (the card stays: its arriving or leaving goes on as it was)
  p.card.querySelectorAll('.scroll').forEach((s, i) => { s.scrollTop = scrollers[i] || 0; });
}
export const isOpen = (name) => panels.has(name);
export const closeNamed = (name) => closePanel(name);
export const anyOpen = () => panels.size > 0 || !!menuLayer || isBookletOpen();
/** The LYRICS panel goes when karaoke takes the window (it would stand over it otherwise). */
export function closeCardPanel() { if (!isOpen('card')) return false; closePanel('card'); return true; }
export function closeLyricsPanel() { if (isOpen('lyrics')) closePanel('lyrics'); }
export function closeTopmost() {
  for (const name of ESC_ORDER) {
    if (name === 'menu') { if (menuLayer) { closeMenu(); return true; } continue; }
    if (name === 'booklet') { if (isBookletOpen()) { closeBooklet(); return true; } continue; }
    if (panels.has(name)) { closePanel(name); return true; }
  }
  return false;
}

const title = (text) => el('h1', {}, text);
const closeRow = (onClick, caption = t('CLOSE')) => el('div', { class: 'close-row' }, pill(caption, onClick));
const gap = (h = 22) => { const d = el('div', { class: 'gap-22' }); d.style.height = `${h}px`; return d; };
const hint = (text) => el('div', { class: 'setting-hint' }, text);
// IMPORT PLAYS: the files picked read in the main process; what it added said in the status line.
async function importPlays(app) {
  const r = await app.cdp.importPlays().catch(() => ({ error: true }));
  if (!r) return;
  if (r.error) { app.setStatus(r.error === 'NOT RECOGNISED' ? t('NOT AN EXPORT CDPLAYER CAN READ') : t('UNKNOWN ERROR')); return; }
  if (r.added) await app.loadHistoryFromDisk();
  const where = r.sources.join(' + ');
  app.setStatus(r.added ? [t('+{n} PLAYS FROM {where}', { n: r.added, where }), r.missing ? t('NOT ON THE SHELF: {n}', { n: r.missing }) : null].filter(Boolean).join(' · ')
    : r.already ? t('NOTHING NEW: ALREADY IMPORTED') : t('NONE OF THOSE SONGS ARE ON THE SHELF'));
}
const quietHint = (text) => el('div', { class: 'setting-hint quiet' }, text); // the small print under a hint
function row(label, control) { return el('div', { class: 'setting-row' }, el('span', {}, label), control); }
function sliderRow(label, slider, valueLabel) {
  const wrap = el('div', { class: 'slider' });
  const r = el('div', { class: 'setting-row slider-row' }, el('span', { class: 'row-label' }, label), wrap, valueLabel);
  requestAnimationFrame(() => slider.mount(wrap));
  return r;
}

// ---- The Now Playing card ----------------------------------------------------------------------------------------
// P (or right-click the disc): the card as it will look, and which lines of the lyrics go on it — up to ten, the one
// being sung to start with — then COPY it to paste into a chat, or SAVE… it as a picture. Click a line to add or take
// it off, shift-click to take in every line from the last one clicked; ↑/↓ move to a single line; Enter copies.
// `render(lines)` → a URL of the card quoting those lines (indexes; none: no quote); `copy` / `save` → true once done.

export function showCard(app, { choices, maxLines, render, copy, save, video }) {
  let picked = choices.picked >= 0 ? [choices.picked] : [], anchor = choices.picked, shownUrl = null, drawing = 0, noteTimer = null;
  const preview = el('img', { class: 'card-preview', alt: '' });
  const note = el('div', { class: 'card-note' });
  const rows = [
    el('div', { class: 'list-row card-line none', onClick: () => set([], -1) }, el('span', { class: 'entry' }, t('— WITHOUT LYRICS —'))),
    ...choices.lines.map((text, i) => el('div', { class: 'list-row card-line', title: text, onClick: (e) => click(i, e.shiftKey) }, el('span', { class: 'entry' }, text))),
  ];
  const list = el('div', { class: 'scroll card-lines' }, rows);
  async function redraw() {
    const n = ++drawing, url = await render(picked);
    if (n !== drawing || !isOpen('card')) { URL.revokeObjectURL(url); return; }
    if (shownUrl) URL.revokeObjectURL(shownUrl);
    preview.src = shownUrl = url;
  }
  function tell(text) { note.textContent = text; clearTimeout(noteTimer); noteTimer = setTimeout(() => { note.textContent = ''; }, 1600); }
  function set(lines, from, scroll = false) {
    if (lines.length > maxLines) { tell(t('UP TO {n} LINES', { n: maxLines })); return; }
    picked = lines; anchor = from;
    rows[0].classList.toggle('on', !lines.length);
    rows.slice(1).forEach((r, i) => r.classList.toggle('on', lines.includes(i)));
    if (scroll) rows[from + 1].scrollIntoView({ block: 'nearest' });
    redraw();
  }
  function click(i, range) {
    if (range && anchor >= 0) {
      const span = []; for (let j = Math.min(anchor, i); j <= Math.max(anchor, i); j++) span.push(j);
      set([...new Set([...picked, ...span])], i);
    } else set(picked.includes(i) ? picked.filter((j) => j !== i) : [...picked, i], i);
  }
  let busy = false;
  const finish = (action) => async () => {
    if (busy) return;
    busy = true;
    try { if (await action(picked)) closePanel('card'); } finally { busy = false; }
  };
  // VIDEO 9:16 / 1:1: the picked lines (or eight seconds) recorded as the song plays, counting down on the button, then
  // saved.
  const videoButton = (format, tip) => {
    const b = pill(t('VIDEO {format}', { format }), async () => {
      if (busy || !video) return;
      busy = true;
      const buttons = [...b.parentNode.querySelectorAll('button')];
      buttons.forEach((x) => { x.disabled = true; });
      b.textContent = t('RECORDING…');
      try { if (await video(format, picked, (left) => { b.textContent = t('RECORDING · {left}', { left }); })) closePanel('card'); }
      finally { busy = false; buttons.forEach((x) => { x.disabled = false; }); b.textContent = t('VIDEO {format}', { format }); }
    }, t('{use} — the picked lines as they are sung, with the song, filmed as your PLAYER LOOK is', { use: tip }));
    return b;
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = Math.max(-1, Math.min(choices.lines.length - 1, anchor + (e.key === 'ArrowDown' ? 1 : -1)));
      set(at >= 0 ? [at] : [], at, true);
    } else if (e.key === 'Enter') { e.preventDefault(); finish(copy)(); }
  };
  const p = openPanel('card', () => [
    title(t('NOW PLAYING CARD')),
    el('div', { class: 'card-pick' }, preview, list),
    el('div', { class: 'close-row split' }, pill(t('CANCEL'), () => closePanel('card')), note,
      el('div', { class: 'card-actions' }, videoButton('9:16', t('For Stories, Reels and TikTok')), videoButton('1:1', t('Square, for chats')),
        pill(t('SAVE…'), finish(save), t('Save the card as a picture')), el('button', { class: 'pill go', onClick: finish(copy) }, t('COPY')))),
  ], { width: 940 });
  window.addEventListener('keydown', onKey);
  p.onClose = () => { window.removeEventListener('keydown', onKey); clearTimeout(noteTimer); drawing++; if (shownUrl) URL.revokeObjectURL(shownUrl); };
  requestAnimationFrame(() => set(picked, anchor, true));
}

// ---- Settings ----------------------------------------------------------------------------------------------------

let themeButton = null, presetButton = null;
export function updateThemeButton(app, name) { if (themeButton) themeButton.lastChild.textContent = themeLabel(THEMES.find((x) => x.name === name) || { name }); }

let discogsSettings = null, scrobbleSettings = null;
async function loadDiscogsSettings(app) {
  [discogsSettings, scrobbleSettings] = await Promise.all([app.cdp.discogsSettings().catch(() => null), app.cdp.scrobbleStatus().catch(() => null)]);
  app.noteScrobbling(scrobbleSettings);
}

export function showSettings(app) {
  const open = () => openPanel('settings', () => buildSettings(app), { width: 700 });
  // DISCOGS's token and currency, asked each time (a token Discogs dropped shows at once); the first time, before
  // the panel opens, so it never shows defaults for a moment.
  if (!discogsSettings) { loadDiscogsSettings(app).then(open); return; }
  open();
  loadDiscogsSettings(app).then(() => refreshSettingsIfOpen(app));
}
// Settings drawn again (a phone came, the Discogs token loaded…) — but not from under a menu open over it (the phone
// remote's address list): then once that menu closes.
let settingsStale = false;
export function refreshSettingsIfOpen(app) {
  if (!isOpen('settings')) return;
  if (menuLayer) { settingsStale = true; return; }
  refreshPanel('settings');
}

const section = (text) => el('div', { class: 'settings-section' }, text);
const subRow = (r) => { r.classList.add('setting-sub'); return r; }; // (a row going on from the one above: one setting)

// Settings a section at a time: the sections listed down the left, the one picked on the right — each setting there
// (its row, any rows going on from it, its hints) set apart from the next. Sections and settings are found in the flat
// list buildSettings makes: a section's name starts a section, a row a setting.
let settingsPage = 0, settingsGo = null;
function settingsPages(nodes) {
  const pages = [];
  let one = null;
  for (const node of nodes) {
    if (node.classList.contains('gap-22')) continue;
    if (node.classList.contains('settings-section')) { pages.push({ name: node.textContent, settings: [] }); one = null; continue; }
    if (!one || (node.classList.contains('setting-row') && !node.classList.contains('setting-sub'))) {
      one = el('div', { class: 'setting' });
      pages[pages.length - 1].settings.push(one);
    }
    one.append(node);
  }
  return pages;
}

// Settings → PHONE REMOTE: the switch and, while it's on, the code to scan with the phone, its address in words, the
// phones connected and NEW CODE. The status is main's (app.remoteInfo()); a change comes back through app.remoteHeard.
function phoneRemoteRows(app) {
  const info = app.remoteInfo();
  if (!info) app.cdp.remoteStatus().then(app.remoteHeard).catch(() => {}); // not heard yet: drawn again when it is
  const on = !!(info && info.on);
  const switcher = toggle(on, () => { app.cdp.remoteSet(!on).then(app.remoteHeard).catch(() => {}); });
  const rows = [row(t('CONTROL FROM A PHONE'), switcher)];
  if (on) {
    const shown = [];
    if (info.error) shown.push(el('div', { class: 'phone-error' }, errorWords(info.error)));
    else if (info.url) {
      const qr = el('div', { class: 'phone-qr' });
      qr.innerHTML = qrSvg(info.url); // (the SVG is the encoder's own markup)
      shown.push(qr, el('div', { class: 'phone-address' }, addressWords(info)));
    }
    if (info.addresses.length > 1) {
      const current = info.addresses.find((a) => a.address === info.address);
      const choose = pill(current ? `${current.name} · ${current.address}` : t('CHOOSE'), () => showMenu(choose, info.addresses.map((a) => ({
        label: `${a.name} · ${a.address}`, current: a.address === info.address,
        pick: () => app.cdp.remoteAddress(a.address).then(app.remoteHeard).catch(() => {}),
      }))), t('The network the phone is on — scan the code again after changing it'));
      shown.push(choose);
    }
    for (const phone of info.phones) shown.push(el('div', { class: 'phone-line' }, phoneLine(phone)));
    shown.push(pill(t('NEW CODE'), () => app.cdp.remoteNewCode().then(app.remoteHeard).catch(() => {}), t('Signs every phone out: each scans the new code again')));
    rows.push(el('div', { class: 'phone-remote' }, shown));
  }
  rows.push(hint(t('Same Wi-Fi, not a guest network. On Windows, allow CDPlayer through the firewall on a Private network — it asks again after each update.')));
  return rows;
}
// The preset the current EQ gains match (built-in or saved), or CUSTOM once a band has been moved off every preset.
function presetName(app) {
  const gains = app.state.eq, same = (p) => p.gains.every((g, i) => Math.round(g) === Math.round(gains[i]));
  const match = [...app.BUILTIN_EQ_PRESETS, ...app.state.customPresets].find(same);
  return match ? match.name.toUpperCase() : t('CUSTOM');
}

function buildSettings(app) {
  const s = app.state;
  // The swatch follows the live colors (CSS variables), so it stays right for AUTO and during a theme transition.
  themeButton = el('button', { class: 'pill theme-pill', title: t('Pick a theme'), onClick: () => showThemeMenu(app) },
    el('span', { class: 'swatch' }), el('span', {}, themeLabel(THEMES[s.themeIndex])));
  presetButton = pill(presetName(app), () => showPresetMenu(app), t('Switch to another equalizer preset'));
  const eqButton = pill(t('EQ'), () => showEq(app), t('Adjust the 10 bands, or save your own preset'));
  // Where the sound goes: the button names it; the menu lists what's plugged in now.
  // DISCOGS: a token (optional, it only speeds up appraising) and the currency prices are shown in.
  const discogs = discogsSettings;
  const discogsToken = el('div', { class: 'row-pills' }, ...(discogs && discogs.token
    ? [pill(t('REMOVE'), async () => { await app.cdp.discogsSetToken(null); await loadDiscogsSettings(app); refreshSettingsIfOpen(app); }, t('Forget the Discogs token'))]
    : [pill(t('GET A TOKEN'), () => app.cdp.openDiscogs('https://www.discogs.com/settings/developers'), t('Discogs → Settings → Developers → Generate new token')),
      pill(t('PASTE'), async () => {
        const r = await app.cdp.discogsSetToken(await app.cdp.clipboardText(), { paste: true });
        app.setStatus(r.ok ? t('DISCOGS TOKEN SAVED') : r.error === 'BAD_TOKEN' ? t("TOKEN DIDN'T WORK") : r.error === 'EMPTY' ? t('COPY THE TOKEN FIRST') : t('DISCOGS UNAVAILABLE'));
        await loadDiscogsSettings(app); refreshSettingsIfOpen(app);
      }, t('Paste the token you copied from Discogs'))]));
  // LISTENBRAINZ: scrobbling, signed in with the token from its settings page.
  const lb = scrobbleSettings && scrobbleSettings.listenbrainz, lf = scrobbleSettings && scrobbleSettings.lastfm;
  const on = (s) => !!(s && s.user && !s.dropped);
  const signOut = (service) => async () => { await app.cdp.scrobbleSignOut(service); await loadDiscogsSettings(app); refreshSettingsIfOpen(app); };
  const lastFm = el('div', { class: 'row-pills' }, on(lf)
    ? pill(t('SIGN OUT'), signOut('lastfm'), t('Stop scrobbling to Last.fm'))
    : pill(t('CONNECT'), async () => {
      app.setStatus(t('ALLOW CDPLAYER ON LAST.FM, IN THE BROWSER…'));
      const r = await app.cdp.scrobbleConnectLastfm().catch(() => ({ error: 'OFFLINE' }));
      if (r.error !== 'CANCELLED') app.setStatus(r.ok ? t('SCROBBLING TO LAST.FM AS {user}', { user: r.user || '?' }) : r.error === 'NOT_ALLOWED' ? t("LAST.FM WASN'T ALLOWED · TRY AGAIN") : t('LAST.FM UNAVAILABLE'));
      await loadDiscogsSettings(app); refreshSettingsIfOpen(app);
    }, t('Opens Last.fm in the browser, to allow CDPlayer to scrobble')));
  const listenBrainz = el('div', { class: 'row-pills' }, ...(on(lb)
    ? [pill(t('SIGN OUT'), signOut('listenbrainz'), t('Stop scrobbling to ListenBrainz'))]
    : [pill(t('GET A TOKEN'), () => app.cdp.openListenBrainz(), t('ListenBrainz → Settings → User token')),
      pill(t('PASTE'), async () => {
        const r = await app.cdp.scrobbleSignIn(await app.cdp.clipboardText());
        app.setStatus(r.ok ? t('SCROBBLING TO LISTENBRAINZ AS {user}', { user: r.user || '?' }) : r.error === 'BAD_TOKEN' ? t("TOKEN DIDN'T WORK") : r.error === 'EMPTY' ? t('COPY THE TOKEN FIRST') : t('LISTENBRAINZ UNAVAILABLE'));
        await loadDiscogsSettings(app); refreshSettingsIfOpen(app);
      }, t('Paste the token you copied from ListenBrainz'))]));
  const currencyButton = pill(discogs ? discogs.currency : 'USD', () => showMenu(currencyButton, ((discogs && discogs.currencies) || ['USD']).map((c) => ({
    label: c, current: discogs && c === discogs.currency, pick: async () => { await app.cdp.discogsSetCurrency(c); await loadDiscogsSettings(app); app.discogsCurrencyChanged(); refreshSettingsIfOpen(app); },
  }))), t('The currency Discogs prices are shown in'));
  if (!discogs) loadDiscogsSettings(app).then(() => refreshSettingsIfOpen(app));
  const outputButton = pill('…', async () => {
    const devices = await app.listOutputs(), now = app.engine.outputId || '';
    showMenu(outputButton, [{ label: t('SYSTEM DEFAULT'), current: !now, pick: () => app.setOutput(null).then(() => refreshSettingsIfOpen(app)) },
      ...devices.map((d) => ({ label: outputName(d), current: d.deviceId === now, pick: () => app.setOutput(d).then(() => refreshSettingsIfOpen(app)) }))]);
  }, t('Where the sound comes out: speakers, headphones, AirPods…'));
  app.currentOutputName().then((name) => { outputButton.textContent = name; });
  const qualityButton = pill(levelName(s.quality), () => showMenu(qualityButton, LEVELS.map((level) => ({
    label: levelName(level, true), current: level === s.quality,
    pick: () => app.setQuality(level).then(() => refreshSettingsIfOpen(app)),
  }))), t('How the sound leaves CDPlayer'));
  const SOUND_CHECK_NAMES = { OFF: t('OFF'), ALBUM: t('ALBUM'), TRACK: t('TRACK') };
  const LOOK_NAMES = { CLASSIC: t('CLASSIC|look'), VISUALIZER: t('VISUALIZER|look'), LYRICS: t('LYRICS|look'), HIFI: t('HI-FI|look'), ALBUM: t('ALBUM|look') };
  const lookButton = pill(LOOK_NAMES[s.look] || LOOK_NAMES.CLASSIC, () => showMenu(lookButton, Object.keys(LOOK_NAMES).map((kind) => ({
    label: LOOK_NAMES[kind], current: kind === (s.look || 'CLASSIC'), pick: () => { app.setLook(kind); refreshSettingsIfOpen(app); },
  }))));
  const DISPLAY_NAMES = { DECK: t('DECK|display'), CLASSIC: t('CLASSIC|display') };
  const displayButton = pill(DISPLAY_NAMES[s.display] || DISPLAY_NAMES.DECK, () => showMenu(displayButton, ['DECK', 'CLASSIC'].map((kind) => ({
    label: DISPLAY_NAMES[kind], current: kind === s.display, pick: () => { app.setDisplay(kind); refreshSettingsIfOpen(app); },
  }))), t('What’s under the seek bar'));
  const soundCheckButton = pill(SOUND_CHECK_NAMES[s.soundCheck] || t('OFF'), () => showMenu(soundCheckButton, ['OFF', 'ALBUM', 'TRACK'].map((mode) => ({
    label: SOUND_CHECK_NAMES[mode], current: mode === s.soundCheck,
    pick: () => app.setSoundCheck(mode).then(() => refreshSettingsIfOpen(app)),
  }))), t('Every song at the same loudness'));

  // TRANSITION: how one song goes into the next — OFF (back to back, gapless), AUTOMIX, or CROSSFADE over the seconds
  // set below it (only shown then; kept while another is picked).
  const TRANSITION_NAMES = { OFF: t('OFF'), AUTOMIX: t('AUTOMIX'), CROSSFADE: t('CROSSFADE') };
  const TRANSITION_HINTS = {
    OFF: t('Each song follows the last with no gap, as on a CD — the silence that’s in the files stays.'),
    AUTOMIX: t('Blends one song into the next where it winds down, so there’s no silence between them. An album played in order stays gapless.'),
    CROSSFADE: t('Every song fades into the next over the seconds set — albums too.'),
  };
  const transitionButton = pill(TRANSITION_NAMES[s.transition] || t('OFF'), () => showMenu(transitionButton, ['OFF', 'AUTOMIX', 'CROSSFADE'].map((mode) => ({
    label: TRANSITION_NAMES[mode], current: mode === s.transition,
    pick: () => { app.setTransition(mode); refreshSettingsIfOpen(app); },
  }))), t('How one song goes into the next'));
  const crossfadeValue = el('span', { class: 'row-value' }, t('{n}S', { n: s.crossfade }));
  const crossfade = new Slider({ min: 1, max: 15, value: s.crossfade, onInput: (v) => { crossfadeValue.textContent = t('{n}S', { n: v }); app.setCrossfade(v); } });
  crossfade.canvas.title = t('How long each song fades into the next (1–15 s)');

  // Arms a one-shot countdown from now, only once the drag settles — not on every intermediate value.
  const sleepValue = el('span', { class: 'row-value' }, s.sleepMinutes ? t('{n}M', { n: s.sleepMinutes }) : t('OFF'));
  const sleep = new Slider({
    min: 0, max: 120, value: s.sleepRemaining > 0 ? s.sleepMinutes : 0,
    onInput: (v) => { sleepValue.textContent = v ? t('{n}M', { n: v }) : t('OFF'); },
    onChange: (v) => app.armSleepTimer(v),
  });
  sleep.canvas.title = t('Pause playback after a set time (0 = off, up to 120 minutes)');
  const sleepAtEnd = toggle(s.sleepAtEnd, () => { app.armSleepAtEnd(!s.sleepAtEnd); refreshSettingsIfOpen(app); });

  const offsetText = (ms) => (ms ? t('{n} MS', { n: `${ms > 0 ? '+' : '−'}${Math.abs(ms)}` }) : t('0 MS'));
  const offsetValue = el('span', { class: 'row-value' }, offsetText(s.lyricsOffset));
  const lyricsOffset = new Slider({ min: -10, max: 10, value: Math.round(s.lyricsOffset / 50), onInput: (v) => { offsetValue.textContent = offsetText(v * 50); app.setLyricsOffset(v * 50); } });
  lyricsOffset.canvas.title = t('Move the lyrics later (+) or earlier (−) for a song timed a little off');

  const mono = toggle(s.mono, () => { app.setMono(!s.mono); setToggle(mono, s.mono); });
  const spatial = toggle(s.spatial, () => { app.setSpatial(!s.spatial); setToggle(spatial, s.spatial); spaceRow.classList.toggle('idle', !s.spatial); });
  const spatialValue = el('span', { class: 'row-value' }, `${s.spatialAmount}%`);
  // SPACE is dimmed while spatial audio is off: it's kept for when it's on (but can still be set).
  let spaceRow;
  const spatialAmount = new Slider({ min: 0, max: 100, value: s.spatialAmount, onInput: (v) => { spatialValue.textContent = `${v}%`; app.setSpatialAmount(v); } });
  spatialAmount.canvas.title = t('How much room and space');
  const waveform = toggle(s.waveform, () => { app.setWaveform(!s.waveform); setToggle(waveform, s.waveform); });
  const languageButton = pill('…', async () => {
    const { locales, auto } = await app.cdp.listLanguages(), nameOf = (c) => (c === 'en' ? 'ENGLISH' : (locales.find((l) => l.code === c) || {}).name || c);
    showMenu(languageButton, [
      { label: `${t('AUTO')} · ${nameOf(auto).toUpperCase()}`, current: s.language === 'AUTO', pick: () => pickLanguage('AUTO') },
      { label: 'ENGLISH', current: s.language === 'en', pick: () => pickLanguage('en') },
      ...locales.map((l) => ({ label: l.name.toUpperCase(), current: s.language === l.code, pick: () => pickLanguage(l.code) })),
    ]);
  }, t('The language of the interface'));
  const languageNote = el('div', { class: 'row-pills' });
  const pickLanguage = (code) => { app.setLanguage(code); languageNote.replaceChildren(hint(t('Takes effect after a restart.')), pill(t('RESTART'), () => app.relaunch())); refreshLanguageName(); };
  const refreshLanguageName = () => app.cdp.listLanguages().then(({ locales, auto }) => {
    const code = s.language === 'AUTO' ? auto : s.language, l = locales.find((x) => x.code === code);
    languageButton.textContent = s.language === 'AUTO' ? `${t('AUTO')} · ${(code === 'en' ? 'ENGLISH' : l ? l.name : code).toUpperCase()}` : (code === 'en' ? 'ENGLISH' : l ? l.name.toUpperCase() : code);
  });
  refreshLanguageName();
  const AMBIENT_NAMES = { OFF: t('OFF'), COVER: t('COVER|ambient'), GRADIENT: t('GRADIENT|ambient') };
  const ambientNow = () => (s.ambient ? s.ambientStyle || 'COVER' : 'OFF');
  const ambient = pill(AMBIENT_NAMES[ambientNow()], () => showMenu(ambient, Object.keys(AMBIENT_NAMES).map((kind) => ({
    label: AMBIENT_NAMES[kind], current: kind === ambientNow(), pick: () => { app.setAmbient(kind); refreshSettingsIfOpen(app); },
  }))), t('Behind the player: the cover blurred, or its colours flowing'));
  const animations = toggle(anim.enabled, () => { app.setAnimations(!anim.enabled); setToggle(animations, anim.enabled); });
  const mini = toggle(s.miniMode, () => app.setMiniMode(!s.miniMode));
  const discord = toggle(s.discord, () => { app.setDiscord(!s.discord); setToggle(discord, s.discord); });
  const discNoise = toggle(s.discNoise, () => { app.setDiscNoise(!s.discNoise); setToggle(discNoise, s.discNoise); });
  const discWear = toggle(s.discWear, () => { app.setDiscWear(!s.discWear); setToggle(discWear, s.discWear); });
  const changerMode = toggle(app.changerMode(), async () => { await app.setChangerMode(!app.changerMode()); setToggle(changerMode, app.changerMode()); });
  const discShine = toggle(s.discShine, () => { app.setDiscShine(!s.discShine); setToggle(discShine, s.discShine); });
  const taskbarDisc = toggle(s.taskbarDisc, () => { app.setTaskbarDisc(!s.taskbarDisc); setToggle(taskbarDisc, s.taskbarDisc); });
  const platform = document.body.dataset.platform;
  const saveFound = toggle(s.saveFound, () => { app.setSaveFound(!s.saveFound); setToggle(saveFound, s.saveFound); });
  // (turned on the first time, yt-dlp is downloaded: the button waits, and says how it went under it — the status line is under this panel)
  const streamingNote = hint('');
  streamingNote.hidden = true;
  const streaming = toggle(s.streaming, async () => {
    streaming.disabled = true; streaming.textContent = '…';
    await app.setStreaming(!s.streaming, (text) => { streamingNote.textContent = text; streamingNote.hidden = false; app.setStatus(text); });
    streaming.disabled = false; streaming.textContent = s.streaming ? t('ON') : t('OFF');
    setToggle(streaming, s.streaming);
  });
  // A Spotify disc plays outside Web Audio: the EQ, crossfade and mono can't shape it.
  const forSpotify = app.spotifyActive();
  const unavailable = (node) => (forSpotify ? el('div', { class: 'unavailable', title: t('Not available for Spotify') }, node) : node);

  const github = el('div', { class: 'github-link', title: t('Open GitHub profile'), onClick: () => app.cdp.openGitHub('Kizarov3') }, catSvg(), el('span', {}, 'Kizarov3'));
  spaceRow = sliderRow(t('SPACE'), spatialAmount, spatialValue);
  spaceRow.classList.toggle('idle', !s.spatial);
  const body = el('div', { class: 'scroll settings-body' },
    section(t('SOUND')),
    unavailable(row(t('EQUALIZER'), el('div', { class: 'row-pills' }, presetButton, eqButton))),
    unavailable(row(t('TRANSITION'), transitionButton)),
    ...(s.transition === 'CROSSFADE' ? [subRow(unavailable(sliderRow(t('LENGTH'), crossfade, crossfadeValue)))] : []),
    hint(TRANSITION_HINTS[s.transition] || TRANSITION_HINTS.OFF),
    unavailable(row(t('OUTPUT'), outputButton)),
    quietHint(t('Each output keeps its own EQ, mono and spatial audio: headphones and speakers each sound as you set them.')),
    unavailable(row(t('QUALITY'), qualityButton)),
    hint(document.body.dataset.platform === 'linux' // no output-rate helper there
      ? t('Lossless plays each song at its own sample rate. On Linux, set your output’s rate in your sound settings (PipeWire can follow it by itself).')
      : t('Lossless plays each song at its own sample rate; CDPlayer switches your output’s rate to match and puts it back when it closes. Over Bluetooth, the wireless codec limits it.')),
    unavailable(row(t('MONO AUDIO'), mono)),
    hint(t('Sums the left and right channels together — for a single speaker or one earbud.')),
    unavailable(row(t('SPATIAL AUDIO'), spatial)),
    subRow(unavailable(spaceRow)),
    hint(t('For headphones: the music comes from two speakers in front of you instead of from inside your head. Off with mono, and best off on speakers.')),
    unavailable(row(t('SOUND CHECK'), soundCheckButton)),
    hint(t('Plays every song at the same loudness, from its ReplayGain tags or measured once. ALBUM keeps an album’s quiet and loud songs as they were made.')),
    row(t('DISC NOISE'), discNoise),
    hint(t('A real player’s sounds: a faint hiss, the tray motor, the disc spinning up — and a skip when you shake the window.')), gap(18),
    section(t('LOOK')),
    row(t('THEME'), themeButton),
    row(t('LANGUAGE'), languageButton), languageNote,
    row(t('PLAYER LOOK'), lookButton),
    hint(t('CLASSIC: as it always was. VISUALIZER: the music drawn across the window, the keys in a bar along the bottom, the queue at the side. LYRICS: the song’s words down the side, lit as they’re sung. HI-FI: a CD player’s front, the keys and two level meters on one panel. ALBUM: the album’s cover instead of the disc, as in a streaming app.')),
    row(t('DISPLAY'), displayButton),
    hint(t('DECK: a glowing panel like a CD player’s — the track number and the time in segment digits. CLASSIC: just the times.')),
    row(t('WAVEFORM'), waveform),
    row(t('AMBIENT BACKGROUND'), ambient),
    hint(t('COVER: the album’s cover, blurred, behind the player. GRADIENT: as Apple Music has it — the cover in big blurred pieces, slowly turning round each other.')),
    app.shownTheme().image ? hint(t('The theme’s own image is the background while it’s on.')) : null,
    row(t('DISC WEAR'), discWear),
    hint(t('A disc played a lot looks it: scratches from ten plays of its album, fingerprints from fifty, chips from a hundred.')),
    row(t('DISC SHINE'), discShine),
    hint(t('The rainbow reflection on the disc that follows your mouse, like a CD tilted under a lamp.')),
    row(t('DISC ICON'), taskbarDisc),
    hint(platform === 'darwin' ? t('The Dock icon shows the disc that’s in. Off, it’s CDPlayer’s own icon.')
      : platform === 'win32' ? t('The taskbar button shows the disc that’s in. While it’s on, CDPlayer pinned to the taskbar opens as a button of its own beside the pin.')
      : t('The taskbar icon shows the disc that’s in. Off, it’s CDPlayer’s own icon.')),
    row(t('ANIMATIONS'), animations), gap(18),
    section(t('PLAYBACK')),
    row(t('CD CHANGER'), changerMode),
    hint(t('Five discs in a carousel instead of the queue: albums go in as discs, with DISC SKIP (D) and 1–5. The queue and the changer each keep their own music.')),
    sliderRow(t('SLEEP TIMER'), sleep, sleepValue),
    subRow(row(t('…OR AT THE END OF THE DISC'), sleepAtEnd)),
    hint(t('Stops once the album playing has ended (a changer disc, or the folder its songs are in) instead of going on into the next. A shuffled queue plays to its end.')),
    sliderRow(t('LYRICS OFFSET'), lyricsOffset, offsetValue),
    hint(t('Karaoke and the lyrics already follow what you hear, Bluetooth included. Move them if a song’s lyrics are timed a little off.')),
    row(t('MINI MODE'), mini), gap(18),
    section(t('PHONE REMOTE')),
    ...phoneRemoteRows(app), gap(18),
    section(t('LIBRARY')),
    row(t('SAVE FOUND ART & LYRICS'), saveFound),
    hint(t('Covers and lyrics found online are written into the song’s file (once it’s finished playing), so they’re there offline and in other players too.')),
    row(t('YOUTUBE MUSIC & SOUNDCLOUD'), streaming),
    hint(t('The search (/) also finds albums on YouTube Music and songs on SoundCloud — they play like your own discs.')),
    quietHint(t('Unofficial: through the free yt-dlp, downloaded when this is turned on. YouTube’s terms don’t allow it, and it may stop working for a while when YouTube changes. Songs a label has locked (DRM) don’t play.')),
    streamingNote,
    row(t('BACKUP'), el('div', { class: 'row-pills' },
      pill(t('SAVE…'), async () => { const r = await app.cdp.saveBackup().catch(() => ({ error: true })); if (r) app.setStatus(r.ok ? t('BACKUP SAVED') : t('UNKNOWN ERROR')); }, t('Save your queue, history, plays, notes, themes and settings to one file')),
      pill(t('RESTORE…'), async () => { const r = await app.cdp.restoreBackup().catch(() => ({ error: 'UNKNOWN ERROR' })); if (r && r.error) app.setStatus(r.error === 'NOT A BACKUP' ? t('NOT A CDPLAYER BACKUP') : t('UNKNOWN ERROR')); }, t('Put back what a backup kept: CDPlayer then starts again')))),
    hint(t('For a new computer, or after reinstalling: everything that’s yours in CDPlayer, but not your music, nor Spotify and Discogs sign-ins.')),
    quietHint(t('One is also made by itself each day, and the last 7 kept: RESTORE… opens where they are.')),
    row(t('IMPORT PLAYS'), el('div', { class: 'row-pills' }, pill(t('CHOOSE FILES…'), () => importPlays(app), t('The export from Last.fm, ListenBrainz, Spotify or Apple Music')))),
    hint(t('What you played on Last.fm, ListenBrainz, Spotify or Apple Music counts on the same songs here: their plays, dust and HISTORY. Imported again, nothing’s counted twice.')),
    quietHint(t('Spotify: Account → Privacy → Download your data (its .zip). Apple Music: File → Library → Export Library. Last.fm: a CSV from an exporter such as lastfm.ghan.nl. ListenBrainz: Settings → Export.')), gap(18),
    section(t('SHARING')),
    row(t('DISCORD STATUS'), discord),
    hint(t('Shows the song you’re playing on your Discord profile, while the Discord app is open.')),
    row(t('LAST.FM'), lastFm),
    lf && lf.dropped ? hint(t('LAST.FM SIGNED CDPLAYER OUT · CONNECT AGAIN')) : null,
    row(t('LISTENBRAINZ'), listenBrainz),
    lb && lb.dropped ? hint(t('TOKEN NO LONGER WORKS')) : null,
    hint(on(lf) || on(lb)
      ? t('Scrobbling as {who}: each song heard — half of it, or 4 minutes — goes to your profile, and waits while you’re offline.', { who: [on(lf) && `${lf.user} (Last.fm)`, on(lb) && `${lb.user} (ListenBrainz)`].filter(Boolean).join(', ') })
      : t('Scrobbles the songs you hear to Last.fm or ListenBrainz — your listening history and statistics, kept outside CDPlayer too.')), gap(18),
    section(t('DISCOGS')),
    row(t('TOKEN'), discogsToken), row(t('CURRENCY'), currencyButton),
    discogs && discogs.tokenDropped ? hint(t('TOKEN NO LONGER WORKS')) : null,
    hint(t('Prices are the lowest on Discogs’ marketplace, refreshed monthly. A token makes appraising the shelf faster.')),
    hint(t('Pressings and prices come from Discogs’ API. CDPlayer isn’t affiliated with, sponsored or endorsed by Discogs; “Discogs” is a trademark of Zink Media, LLC.')), gap(18),
    section(t('HELP')),
    el('div', { class: 'help-pills' },
      pill(t('SHOW THE GUIDE'), () => { closePanel('settings'); startTour({ onFeatures: () => showFeatures(app) }); }, t('A look round the window: where everything is and how it works')),
      pill(t("WHAT'S NEW"), () => showWhatsNew(app), t('What changed in each version, the newest first')),
      pill(t('WHAT’S SPECIAL'), () => showFeatures(app), t('Dust, Discogs prices, missing albums, disc wear — what other players don’t have')),
      pill(t('FAQ'), () => showFaq(), t('Answers to what people ask the first time')),
      pill(t('KEYBOARD SHORTCUTS'), () => showShortcuts(), t('Every key, also with ?')),
      pill(t('COPY REPORT'), () => app.copyReport(), t('For a bug report: the version, your system, the output and the sound settings, and what happened lately — no paths to your music’s files'))));
  const version = el('div', { class: 'settings-version' }, `CDPlayer ${app.state.version}`);
  const pages = settingsPages([...body.children]);
  settingsPage = Math.min(settingsPage, pages.length - 1);
  const page = el('div', { class: 'scroll settings-body settings-page' });
  const tabs = pages.map((p, i) => el('button', { class: 'settings-tab', onClick: () => show(i) }, p.name));
  const show = (i, { moved = true } = {}) => {
    settingsPage = i;
    tabs.forEach((b, k) => b.classList.toggle('on', k === i));
    page.replaceChildren(el('div', { class: 'settings-page-title' }, pages[i].name), ...pages[i].settings);
    page.scrollTop = 0;
    if (moved && anim.enabled) page.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE.out });
  };
  show(settingsPage, { moved: false });
  // (the search's "Settings at a row": to the section it's in)
  settingsGo = (label) => {
    const i = pages.findIndex((p) => p.settings.some((x) => [...x.querySelectorAll('.setting-row')].some((r) => r.firstElementChild && r.firstElementChild.textContent === label)));
    if (i >= 0 && i !== settingsPage) show(i, { moved: false });
  };
  return [title(t('SETTINGS')), gap(16), el('div', { class: 'settings-split' }, el('nav', { class: 'settings-tabs' }, tabs), page),
    el('div', { class: 'settings-foot' }, github, version, pill(t('CLOSE'), () => closePanel('settings')))];
}

// ---- Drop-down menus (theme picker, EQ presets) ------------------------------------------------------------------

let menuLayer = null;
/**
 * A small menu under `anchor` (an element, or where one was); items are { label, swatch (CSS background, optional),
 * current, pick, key (a key's hint, optional), more (optional: ✎ and right-click, given where the item is) } or { divider: true }.
 */
function showMenu(anchor, items, { alignEnd = false } = {}) {
  const box = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  closeMenu();
  const menu = el('div', { class: 'theme-menu' }, items.map((item) => {
    if (item.divider) return el('div', { class: 'menu-divider' });
    const swatch = item.swatch ? el('span', { class: 'swatch' }) : null;
    if (swatch) swatch.style.background = item.swatch;
    const openMore = (e) => { e.preventDefault(); e.stopPropagation(); item.more(node.getBoundingClientRect()); };
    const node = el('div', { class: `theme-item${item.current ? ' current' : ''}`, onClick: () => { closeMenu(); item.pick(); },
      onContextmenu: (e) => { if (item.more) openMore(e); } },
    swatch, el('span', { class: 'grow' }, item.label), item.key ? el('span', { class: 'menu-key' }, item.key) : null,
    item.more ? el('span', { class: 'menu-more', title: t('Edit, share or delete'), onClick: openMore }, '✎') : null);
    return node;
  }));
  const layerNode = el('div', { class: 'theme-menu-layer', onMousedown: (e) => { if (e.target === layerNode) closeMenu(); } }, menu);
  layer().append(layerNode);
  const m = { width: menu.offsetWidth, height: menu.offsetHeight }; // (its laid-out size: the opening animation scales it)
  menu.style.left = `${Math.max(4, Math.min(alignEnd ? box.right - m.width : box.left, window.innerWidth - m.width - 4))}px`;
  if (alignEnd) menu.style.transformOrigin = 'top right';
  menu.style.top = `${Math.max(4, Math.min(box.bottom + 6, window.innerHeight - m.height - 4))}px`;
  menuLayer = layerNode;
}
/** A list to pick from under `anchor`: the shelf's SORT, and its Discogs pressings (OTHER PRESSING… and CHOOSE PRESSING…). */
export function menu(anchor, items, opts) { showMenu(anchor, items, opts); }
export function closeMenu() {
  if (menuLayer) { menuLayer.remove(); menuLayer = null; }
  if (settingsStale) { settingsStale = false; if (isOpen('settings')) refreshPanel('settings'); }
}

const themeSwatch = (theme) => (theme.image ? `center / cover url("${theme.image}")` : `linear-gradient(135deg, rgb(${theme.accent}), rgb(${theme.accent2}))`);
function showThemeMenu(app) {
  const item = (theme) => {
    const i = THEMES.indexOf(theme);
    return { label: themeLabel(theme), swatch: themeSwatch(theme), current: i === app.state.themeIndex, pick: () => app.switchTheme(i), more: theme.user ? (box) => showThemeActions(app, theme, box) : null };
  };
  showMenu(themeButton, [
    ...THEMES.filter((theme) => !theme.user).map(item),
    { divider: true },
    ...THEMES.filter((theme) => theme.user).map(item),
    { label: t('+ NEW THEME'), pick: () => showThemeEditor(app) },
    { label: t('IMPORT…'), pick: () => app.importTheme() },
    { label: t('PASTE CODE'), pick: () => app.pasteThemeCode() },
  ]);
}
// ✎ or right-click on a theme of your own.
function showThemeActions(app, theme, box) {
  showMenu(box, [
    { label: t('EDIT'), pick: () => showThemeEditor(app, theme) },
    { label: t('EXPORT…'), pick: () => app.exportTheme(theme.name) },
    theme.image ? null : { label: t('COPY CODE'), pick: () => app.copyThemeCode(theme) },
    { label: t('DELETE…'), pick: () => showMenu(box, [
      { label: t('DELETE {theme}', { theme: theme.name }), pick: () => app.deleteTheme(theme.name) },
      { label: t('KEEP IT'), pick: () => {} },
    ]) },
  ].filter(Boolean));
}
// ---- Theme editor (theme-editor.js) -------------------------------------------------------------------------------

/** A new theme (starting from the one on), or `editing`, one of yours. Closed without SAVE, the theme that was on is back. */
export function showThemeEditor(app, editing = null) {
  const ctx = { draft: editing ? draftFrom(editing, editing.name) : draftFrom(app.shownTheme(), t('MY THEME')), editing, saved: false };
  const ui = { title, row, hint, gap, sliderRow, menu: showMenu, refresh: () => refreshPanel('theme'), close: () => closePanel('theme') };
  const p = openPanel('theme', () => buildThemeEditor(app, ctx, ui), { width: 460 });
  p.onClose = () => { if (!ctx.saved) app.restoreTheme(); };
  app.previewTheme(ctx.draft);
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
      onInput: (v) => { const gains = s.eq.slice(); gains[i] = v; value.textContent = formatDb(v); app.setEq(gains); markPreset(); },
    });
    const wrap = el('div', { class: 'slider' });
    requestAnimationFrame(() => slider.mount(wrap));
    return { slider, value, row: el('div', { class: 'eq-row' }, el('span', { class: 'freq' }, formatFreq(f)), wrap, value) };
  });
  const applyPreset = (gains) => {
    app.setEq(gains);
    sliders.forEach((sl, i) => { sl.slider.setValue(Math.round(gains[i])); sl.value.textContent = formatDb(gains[i]); });
    markPreset();
  };
  // The preset the sliders stand at is lit (none, once one's moved off it).
  const presetPills = [];
  const presetPill = (p) => { const b = pill(p.name, () => applyPreset(p.gains)); presetPills.push([b, p.gains]); return b; };
  function markPreset() { for (const [b, gains] of presetPills) b.classList.toggle('on', gains.every((g, i) => Math.round(g) === Math.round(s.eq[i]))); }
  const presetButtons = [
    ...app.BUILTIN_EQ_PRESETS.map((p) => presetPill(p)),
    ...s.customPresets.map((p) => el('span', { class: 'preset-item' },
      presetPill(p),
      el('button', { class: 'glyph-x', title: t('Delete preset “{name}”', { name: p.name }), onClick: () => {
        s.customPresets = s.customPresets.filter((c) => c.name !== p.name);
        app.saveEq(); refreshPanel('eq');
      } }, '×'))),
  ];
  const nameField = el('input', { class: 'text-input', type: 'text', maxlength: '40', placeholder: t('Preset name') });
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
  const inputRow = el('div', {}, nameField, ' ', pill(t('SAVE'), doSave), ' ', pill(t('CANCEL'), () => { inputRow.hidden = true; trigger.hidden = false; nameField.value = ''; }));
  Object.assign(inputRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
  inputRow.hidden = true;
  const trigger = pill(t('SAVE AS PRESET'), () => { trigger.hidden = true; inputRow.hidden = false; nameField.focus(); });
  const saveArea = el('div', {}, trigger, inputRow);
  const presets = el('div', { class: 'presets scroll' }, presetButtons);
  markPreset();
  return [title(t('EQUALIZER')), app.spotifyActive() ? hint(t('Not available for Spotify — the equalizer shapes your own files.')) : [], gap(18), sliders.map((x) => x.row), gap(10),
    el('div', { class: 'setting-row' }, t('PRESETS')), presets, gap(14), saveArea, closeRow(() => closePanel('eq'))];
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
  const karaoke = lines.length ? pill(t('KARAOKE'), () => { closePanel('lyrics'); app.openKaraoke(); }, t('The lyrics full-window, filling in word by word as they are sung (Y)')) : null;
  return [title(t('LYRICS')), body, el('div', { class: 'close-row split' }, karaoke || el('span'), pill(t('CLOSE'), () => closePanel('lyrics')))];
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
  [t('TITLE'), 'title'], [t('ARTIST'), 'artist'], [t('ALBUM'), 'album'], [t('ALBUM ARTIST'), 'albumArtist'], [t('YEAR'), 'year'],
  [t('TRACK'), 'track', 'trackCount'], [t('DISC'), 'disc', 'discCount'], [t('GENRE'), 'genre'], [t('LABEL'), 'label'],
];
const NUMBERS = new Set(['track', 'trackCount', 'disc', 'discCount']);
let tagsView = null; // { path, name, canWrite, current, found, foundCover, values, picked: Set, status, busy }

/** The TAGS panel for the song playing — or for any file (`path`, from LIBRARY CHECK); onClose after it's closed. */
export function showTags(app, path = app.state.loadedPath, onClose = null) {
  if (!path) return;
  tagsView = { path, name: app.displayName(path), canWrite: true, current: null, found: null, foundCover: null, values: {}, picked: new Set(), status: t('READING THE FILE…'), busy: true };
  const p = openPanel('tags', () => buildTags(app), { width: 660 });
  p.onClose = () => { tagsView = null; if (onClose) onClose(); };
  loadTags(app, tagsView);
}
const tagsCurrent = (view) => tagsView === view && isOpen('tags');

async function loadTags(app, view) {
  const r = await app.cdp.readTags(view.path).catch(() => ({ canWrite: false }));
  if (!tagsCurrent(view)) return;
  view.canWrite = r.canWrite;
  view.current = r.tags || {};
  // What the file had before CDPlayer first wrote over it, to put back.
  view.original = r.canWrite ? await app.cdp.originalTags(view.path).catch(() => null) : null;
  if (!tagsCurrent(view)) return;
  for (const [, ...keys] of TAG_ROWS) for (const k of keys) view.values[k] = view.current[k] ?? '';
  if (!r.canWrite) { view.status = t('TAGS CAN’T BE WRITTEN TO THIS FILE (A CUE SHEET TRACK, OR A FORMAT WITHOUT TAGS)'); view.busy = false; refreshPanel('tags'); return; }
  // Lyrics found online (not the file's own) are offered too.
  view.lyricsOffer = app.state.lyrics && !(app.state.details && app.state.details.lyrics) ? app.state.lyrics : null;
  if (view.lyricsOffer) view.picked.add('lyrics');
  view.status = t('LOOKING THE SONG UP ON MUSICBRAINZ…');
  refreshPanel('tags');
  await lookUpTags(app, view);
}

async function lookUpTags(app, view) {
  const d = app.state.details || {};
  // What's in the fields (the file's tags, or what was typed before LOOK UP AGAIN); the song's name when they're empty.
  const typed = (k) => String(view.values[k] ?? '').trim();
  const name = typed('artist') && typed('title')
    ? { artist: typed('artist'), title: typed('title'), album: typed('album') || null, guessed: false }
    : { artist: d.artist, title: d.title, album: d.album, guessed: !!d.nameGuessed };
  // The file's ISRC finds the recording itself — unless its artist or title has just been typed in differently.
  const asInFile = (k) => typed(k) === String((view.current || {})[k] ?? '').trim();
  const isrc = view.current && view.current.isrc && asInFile('artist') && asInFile('title') ? view.current.isrc : null;
  view.busy = true;
  const found = await app.cdp.lookupTags({ ...name, isrc, duration: d.duration || app.engine.duration }).catch(() => ({ networkError: true }));
  if (!tagsCurrent(view)) return;
  view.busy = false;
  if (!found || found.networkError) {
    view.status = found ? t('MUSICBRAINZ COULDN’T BE REACHED — YOU CAN STILL EDIT THE TAGS BY HAND') : t('MUSICBRAINZ DOESN’T KNOW THIS SONG — YOU CAN STILL EDIT THE TAGS BY HAND');
    refreshPanel('tags');
    return;
  }
  view.found = found;
  // What MusicBrainz knows and the file hasn't got is filled in and ticked. Where the file says something else, that's
  // offered — filled in, not ticked — so nothing the file has is replaced unless asked (a tick, typing, or TICK ALL).
  view.offered = new Set();
  for (const [, ...keys] of TAG_ROWS) for (const k of keys) {
    if (found[k] == null || found[k] === '' || String(found[k]) === String(view.current[k] ?? '')) continue;
    // A track or disc number the file already has stays: MusicBrainz's may be another edition's running order.
    if (NUMBERS.has(k) && String(view.current[k] ?? '').trim() !== '') continue;
    view.values[k] = found[k];
    if (String(view.current[k] ?? '').trim() === '') view.picked.add(k); else view.offered.add(k);
  }
  view.status = t('FOUND ON MUSICBRAINZ · {album}', { album: [found.album, found.year].filter(Boolean).join(' · ').toUpperCase() });
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
    const b = el('button', { class: `tag-pick${v.picked.has(key) ? ' on' : ''}`, title: t('Write this into the file'), disabled: !v.canWrite }, '✓');
    b.addEventListener('click', () => { v.picked.has(key) ? v.picked.delete(key) : v.picked.add(key); b.classList.toggle('on', v.picked.has(key)); save.disabled = !v.picked.size || v.busy; refreshPanel('tags'); });
    return b;
  };
  // Typing in a field ticks it (a track or disc number and its "of" share one tick).
  const input = (key, narrow, pair) => {
    const offered = v.offered && v.offered.has(key) && !v.picked.has(key);
    const i = el('input', { class: `text-input tag-input${narrow ? ' narrow' : ''}${offered ? ' offered' : ''}`, value: v.values[key] ?? '', spellcheck: 'false', disabled: !v.canWrite,
      title: offered ? t('What MusicBrainz says — tick it to write it over what’s in the file') : '' });
    i.addEventListener('input', () => {
      v.values[key] = i.value; i.classList.remove('offered');
      for (const k of [key, pair].filter(Boolean)) { v.picked.add(k); if (picks.get(k)) picks.get(k).classList.add('on'); }
      save.disabled = false;
    });
    return i;
  };
  const picks = new Map();
  const shown = (x) => (x == null || x === '' ? '—' : String(x));
  const rows = TAG_ROWS.map(([label, key, of]) => {
    const now = of ? `${shown(v.current && v.current[key])}${v.current && v.current[of] ? ` ${t('OF').toLowerCase()} ${v.current[of]}` : ''}` : shown(v.current && v.current[key]);
    const b = pick(key); picks.set(key, b);
    if (of) { const b2 = pick(of); b2.hidden = true; picks.set(of, b2); }
    const edit = of ? el('div', { class: 'tag-pair' }, input(key, true, of), el('span', {}, t('OF')), input(of, true, key)) : input(key);
    if (of) b.addEventListener('click', () => { if (v.picked.has(key)) v.picked.add(of); else v.picked.delete(of); });
    return el('div', { class: 'tag-row' }, el('span', { class: 'tag-label' }, label), el('span', { class: 'tag-now', title: now }, now), edit, b);
  });
  const thumb = (src) => (src ? el('img', { class: 'tag-thumb', src, alt: '' }) : el('span', { class: 'tag-now' }, '—'));
  const coverNow = v.current && v.current.hasCover ? el('span', { class: 'tag-now' }, t('In the file')) : el('span', { class: 'tag-now' }, t('None'));
  if (v.foundCover) rows.push(el('div', { class: 'tag-row' }, el('span', { class: 'tag-label' }, t('COVER')), coverNow, el('div', {}, thumb(v.foundCover), el('span', { class: 'tag-source' }, t('Cover Art Archive'))), pick('cover')));
  if (v.lyricsOffer) rows.push(el('div', { class: 'tag-row' }, el('span', { class: 'tag-label' }, t('LYRICS')), el('span', { class: 'tag-now' }, t('None')),
    el('span', { class: 'tag-source' }, (/^\[\d/m.test(v.lyricsOffer) ? t('Timed, from {source}', { source: app.state.lyricsSource || t('the internet') }) : t('Plain, from {source}', { source: app.state.lyricsSource || t('the internet') }))), pick('lyrics')));
  const save = el('button', { class: 'pill go', disabled: !v.picked.size || v.busy || !v.canWrite }, t('SAVE TO FILE'));
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
    v.busy = true; v.status = t('WRITING…'); refreshPanel('tags');
    const r = await app.saveTags(v.path, changes);
    if (!tagsCurrent(v)) return;
    if (r.ok) { closePanel('tags'); app.setStatus(t('TAGS SAVED INTO THE FILE')); return; }
    v.busy = false; v.status = t('COULDN’T SAVE · {why}', { why: r.error || t('UNKNOWN ERROR') }); refreshPanel('tags');
  });
  // Every offer at once: MusicBrainz's whole answer over the file's.
  const waiting = [...(v.offered || [])].filter((k) => !v.picked.has(k));
  // (Once used it stays where it was, greyed — so the buttons after it don't move under a finger reaching for CLOSE.)
  const all = v.offered && v.offered.size && v.canWrite ? pill(waiting.length ? t('TICK ALL {n}', { n: waiting.length }) : t('ALL TICKED'), () => { for (const k of waiting) v.picked.add(k); refreshPanel('tags'); }, t('Write everything MusicBrainz says, over what’s in the file')) : null;
  if (all) all.disabled = !waiting.length;
  const again = pill(t('LOOK UP AGAIN'), () => { if (!v.busy && v.canWrite) { v.status = t('LOOKING THE SONG UP ON MUSICBRAINZ…'); refreshPanel('tags'); lookUpTags(app, v); } }, t('Ask MusicBrainz again'));
  again.disabled = v.busy || !v.canWrite;
  const putBack = v.original ? pill(t('PUT BACK THE ORIGINAL'), async () => {
    if (v.busy) return;
    v.busy = true; v.status = t('WRITING…'); refreshPanel('tags');
    const r = await app.saveTags(v.path, v.original.changes).catch(() => ({ ok: false }));
    if (r.ok) await app.cdp.forgetOriginalTags(v.path).catch(() => {});
    if (!tagsCurrent(v)) return;
    if (r.ok) { closePanel('tags'); app.setStatus(t('ORIGINAL TAGS PUT BACK')); return; }
    v.busy = false; v.status = t('COULDN’T SAVE · {why}', { why: r.error || t('UNKNOWN ERROR') }); refreshPanel('tags');
  }, t('The tags this file had before CDPlayer first changed them ({when})', { when: new Date(v.original.at).toLocaleDateString() })) : null;
  if (putBack) putBack.disabled = v.busy;
  return [
    title(t('TAGS')), el('div', { class: 'subtitle' }, app.queueDisplay(v.path) || v.name),
    el('div', { class: `tag-status${v.busy ? ' busy' : ''}` }, v.status),
    el('div', { class: 'tag-head' }, el('span', {}, ''), el('span', {}, t('IN THE FILE')), el('span', {}, t('SAVE AS')), el('span', { class: 'tag-write', title: t('Ticked: written into the file') }, t('WRITE'))),
    el('div', { class: 'scroll tag-rows' }, rows),
    el('div', { class: 'close-row split' }, el('div', { class: 'row-pills' }, again, all, putBack), el('div', { class: 'row-pills' }, pill(t('CLOSE'), () => closePanel('tags')), save)),
  ];
}

// ---- History -----------------------------------------------------------------------------------------------------

// When each song in HISTORY was last played, for its day and time (asked for as the panel opens and as songs play;
// null until the answer: the plain list till then).
let historyTimes = null;
function askHistoryTimes(app) {
  const h = app.state.history.slice();
  app.cdp.playTimes(h).then(({ last }) => {
    historyTimes = Object.fromEntries(h.map((p, i) => [p, last[i]]));
    if (isOpen('history')) refreshPanel('history');
  }).catch(() => {});
}
export function showHistory(app) { historyTimes = null; openPanel('history', () => buildHistory(app), { width: 600 }); askHistoryTimes(app); }
export function refreshHistoryIfOpen(app) { if (isOpen('history')) { refreshPanel('history'); askHistoryTimes(app); } }
function trackRow(app, path, label, onPlay, when = null) {
  const now = pill(t('PLAY'), (e) => { e.stopPropagation(); onPlay(); }, t('Play it now'));
  // Done, said on the button itself: the status line is under this panel.
  const done = (b, label) => { b.textContent = t('✓ DONE'); b.disabled = true; setTimeout(() => { b.textContent = label; b.disabled = false; }, 1500); };
  const next = pill(t('NEXT'), (e) => { e.stopPropagation(); app.playNext([path], { sorted: true }); done(e.currentTarget, t('NEXT')); }, app.changerMode() ? t('Into the changer, to play after the disc playing') : t('Play it next, after the song playing'));
  const add = pill(t('ADD'), (e) => { e.stopPropagation(); app.addToQueue([path], { sorted: true }); done(e.currentTarget, t('ADD')); }, app.changerMode() ? t('Into the changer') : t('Add to queue'));
  for (const b of [now, next, add]) b.classList.add('small'); // the song's name gets the room
  return el('div', { class: 'list-row', title: t('Play {song}', { song: label }), onClick: onPlay }, when ? el('span', { class: 'when' }, when) : null, el('span', { class: 'entry' }, label), now, next, add);
}
const dayName = (day) => (day === 'TODAY' ? t('TODAY') : day === 'YESTERDAY' ? t('YESTERDAY') : day === null ? t('EARLIER')
  : new Date(day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase());
const clockOf = (at) => (at ? new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '');
function buildHistory(app) {
  const h = app.state.history;
  const row = (p, at) => {
    app.ensureDetails(p);
    return trackRow(app, p, app.queueDisplay(p), async () => {
      if (!(await app.cdp.exists(p))) { app.setStatus(t('FILE NO LONGER FOUND')); await app.loadHistoryFromDisk(); refreshPanel('history'); return; }
      app.appendAndPlay(p); closePanel('history');
    }, historyTimes ? clockOf(at) || '—' : null);
  };
  // By day once it's known when each was played: TODAY, YESTERDAY, then each day before.
  const rows = historyTimes
    ? historyDays(h, historyTimes).flatMap((g) => [el('div', { class: 'history-day' }, dayName(g.day)), ...g.items.map((i) => row(i.path, i.at))])
    : h.map((p) => row(p, null));
  const body = h.length ? el('div', { class: 'scroll' }, rows) : el('div', { class: 'empty-note' }, t('NOTHING PLAYED YET'));
  if (h.length) { body.style.height = '380px'; body.style.marginTop = '16px'; }
  else body.style.marginTop = '16px';
  return [title(t('HISTORY')), body, closeRow(() => closePanel('history'))];
}

// ---- The rip ----------------------------------------------------------------------------------------------------
// RIP clicked while it rips: the disc's tracks — done (with the file's size), the one being read or encoded, and the
// ones to come — with CANCEL RIP. Closing it leaves the rip going; when it's finished, SHOW IN FOLDER.

export function showRip(app) { openPanel('rip', () => buildRip(app), { width: 520 }); }
export function refreshRipIfOpen(app) { if (isOpen('rip')) refreshPanel('rip'); }
const STAGE = { reading: t('reading from the disc…'), encoding: t('encoding…') };
function buildRip(app) {
  const r = app.state.rip;
  if (!r) return [title(t('RIP')), el('div', { class: 'empty-note' }, t('NOTHING BEING RIPPED')), closeRow(() => closePanel('rip'))];
  const heading = r.finished ? (r.ok ? t('RIPPED') : t('RIP STOPPED')) : t('RIPPING');
  const head = el('div', { class: 'rip-head' },
    el('div', { class: 'rip-album' }, [r.artist, r.year].filter(Boolean).join(' · ') || t('Audio CD')),
    el('div', { class: 'rip-count' }, `${r.done} / ${r.tracks.length} · ${r.percent}%`),
    r.folder ? el('div', { class: 'rip-folder', title: r.folder }, `→ ${r.folder}`) : null);
  const rows = r.tracks.map((track, i) => {
    const stage = r.stages[i];
    const mark = stage === 'done' ? '✓' : stage ? '●' : '·';
    const note = stage === 'done' ? `${(r.sizes[i] / 1048576).toFixed(1)} MB` : STAGE[stage] || '';
    return el('div', { class: `list-row plain rip-row ${stage || 'waiting'}` },
      el('span', { class: 'rip-mark' }, mark),
      el('span', { class: 'entry' }, `${String(i + 1).padStart(2, '0')} ${track.title}`),
      el('span', { class: 'rip-time' }, track.duration ? app.formatTime(track.duration) : ''),
      el('span', { class: 'rip-note' }, note));
  });
  const list = el('div', { class: 'scroll rip-list' }, rows);
  list.style.height = '340px'; list.style.marginTop = '12px';
  const buttons = el('div', { class: 'close-row split' },
    r.finished
      ? (r.ok ? pill(t('SHOW IN FOLDER'), () => app.cdp.showRipFolder(), t('Open the album\'s folder')) : el('span', { class: 'rip-result' }, r.message || ''))
      : pill(t('CANCEL RIP'), () => app.cdp.cancelRip(), t('Stop ripping; the tracks already done are kept')),
    pill(t('CLOSE'), () => closePanel('rip')));
  return [title([heading, (r.album || t('AUDIO CD')).toUpperCase()].join(' · ')), head, list, buttons];
}

// ---- Search ------------------------------------------------------------------------------------------------------

const search = { index: [], labels: {}, tags: {}, folder: null, scanning: false, generation: 0, lastSpotifyUrl: null, field: null, results: null, status: null, online: 0, source: 'library' };
const SEARCH_LIMIT = 100;
const basename = (p) => p.split(/[\\/]/).pop();
// What a search shows: "Artist · Title" from the tags the shelf read, else the filename, or for a cue sheet track
// "<album> · 03 <title>". It matches all of those and the album too, every word of the query in any order.
const searchName = (p) => (search.tags[p] && search.tags[p].shown) || search.labels[p] || basename(p);
const searchText = (p) => `${search.tags[p] ? search.tags[p].words : ''} ${search.labels[p] || ''} ${basename(p)}`.toLowerCase();
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
  search.index = []; search.labels = {}; search.tags = {}; search.scanning = true;
  const result = await app.cdp.scanLibrary().catch(() => ({ folder: null, files: [] }));
  if (generation !== search.generation) return; // superseded by a newer scan
  search.index = result.files; search.labels = result.labels || {}; search.tags = result.tags || {}; search.folder = result.name || null; search.scanning = false;
  refreshSearchResults(app);
}

export function showSearch(app) {
  search.lastSpotifyUrl = null;
  startLibraryScan(app);
  search.source = 'library'; search.online++;
  openPanel('search', () => buildSearch(app), { width: 600 });
  paintSource(app);
  refreshSearchResults(app);
  setTimeout(() => search.field && search.field.focus(), 50);
}
function buildSearch(app) {
  search.status = el('div', { class: 'setting-row' });
  search.status.style.minHeight = '16px';
  search.field = el('input', { class: 'text-input', type: 'text', placeholder: t('A song, an album, an artist, something to do or a setting — or a Spotify link') });
  search.field.style.width = '100%';
  search.field.addEventListener('input', () => onSearchInput(app));
  search.field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closePanel('search');
    // Enter: the first song found plays (its PLAY button), the way a search box is used from the keyboard — or, with
    // no song found, the first thing to do or setting is (a song called "Stop" isn't PLAY / PAUSE).
    // (Nothing typed, or a word still being composed in an input method: Enter isn't a choice yet.)
    if (e.key === 'Enter' && !e.isComposing && search.results && search.field.value.trim()) {
      // (online: the words typed since the last look are looked for at once; then Enter plays the first found)
      if (search.source !== 'library' && search.onlineQuery !== search.field.value.trim().toLowerCase()) { e.preventDefault(); searchOnline(app); return; }
      const first = search.results.querySelector('.list-row:not(.plain):not(.command-row)') || search.results.querySelector('.command-row');
      if (first) { e.preventDefault(); first.click(); }
    }
  });
  search.results = el('div', { class: 'scroll' });
  search.results.style.height = '340px';
  const importButton = pill(t('IMPORT LIBRARY…'), () => importLibrary(app), t('Import an iTunes/Music "Library.xml", or a Spotify "Liked Songs" export (CSV or YourLibrary.json)'));
  const instructions = search.instructions = el('div', { class: 'tip' });
  Object.assign(instructions.style, { fontSize: '11px', fontWeight: 'bold', marginTop: '12px', lineHeight: '1.35' });
  const importRow = search.importRow = el('div', {}, importButton);
  importRow.style.margin = '10px 0';
  const fieldRow = el('div', {}, search.field);
  fieldRow.style.margin = '6px 0 10px';
  // Where to look, as an amplifier's input selector: your music, YouTube Music, SoundCloud (with streaming on)
  search.sourceButtons = new Map([['library', t('YOUR MUSIC')], ...ONLINE].map(([k, name]) => {
    const b = pill(name, () => setSource(app, k));
    b.classList.add('small', 'source-pill');
    return [k, b];
  }));
  search.sourceRow = el('div', { class: 'row-pills source-row' }, ...search.sourceButtons.values());
  search.title = title(t('SEARCH LIBRARY'));
  return [search.title, instructions, importRow, search.sourceRow, search.status, fieldRow, search.results, closeRow(() => closePanel('search'))];
}
function setSearchStatus(text) { if (search.status) search.status.textContent = text; }
function refreshSearchResults(app) {
  if (!search.results || !isOpen('search')) return;
  const query = (search.field ? search.field.value : '').trim().toLowerCase();
  const commands = findCommands(query, app.commands()).map((c) => commandRow(app, c));
  if (!search.folder && !search.scanning) {
    setSearchStatus(t('LOAD A TRACK FIRST TO SET A FOLDER TO SEARCH'));
    search.results.replaceChildren(...commands);
    return;
  }
  const matches = [], words = query.split(/\s+/).filter(Boolean);
  for (const p of search.index) {
    if (!words.length || (() => { const text = searchText(p); return words.every((w) => text.includes(w)); })()) { matches.push(p); if (matches.length >= SEARCH_LIMIT) break; }
  }
  setSearchStatus(search.scanning ? t('SCANNING YOUR MUSIC FOLDER…') : !words.length ? t('{n} SONGS IN {folder} · TYPE TO FIND ONE', { n: search.index.length, folder: search.folder })
    : matches.length >= SEARCH_LIMIT ? t('{n}+ MATCHES IN {folder}', { n: matches.length, folder: search.folder })
    : matches.length === 1 ? t('1 MATCH IN {folder}', { folder: search.folder })
    : !matches.length && app.state.streaming ? t('NOTHING LIKE THAT IN {folder} · LOOK ON YOUTUBE MUSIC OR SOUNDCLOUD ↑', { folder: search.folder })
    : !matches.length && commands.length ? t('NO SONGS LIKE THAT IN {folder}', { folder: search.folder }) : t('{n} MATCHES IN {folder}', { n: matches.length, folder: search.folder }));
  search.results.replaceChildren(...commands, ...(matches.length
    ? matches.map((p) => trackRow(app, p, searchName(p), async () => {
      if (!(await app.cdp.exists(p))) { app.setStatus(t('FILE NO LONGER FOUND')); startLibraryScan(app); return; }
      app.appendAndPlay(p); closePanel('search');
    }))
    : commands.length ? [] : [el('div', { class: 'list-row plain' }, search.scanning ? t('SCANNING…') : t('NO MATCHES'))]));
}

// ---- YouTube Music and SoundCloud (Settings → YOUTUBE MUSIC & SOUNDCLOUD; streaming.js) ----------------------------
// The search switched to YouTube Music (albums) or SoundCloud (songs): the words typed looked for there.
const ONLINE = [['youtube', 'YOUTUBE MUSIC'], ['soundcloud', 'SOUNDCLOUD']];
const onlineName = (k) => (ONLINE.find(([w]) => w === k) || [])[1] || null;
function setSource(app, source) {
  if (search.source === source) return;
  search.source = source; search.online++; search.onlineQuery = null;
  clearTimeout(search.onlineTimer);
  paintSource(app);
  if (source === 'library') refreshSearchResults(app); else searchOnline(app);
  search.field.focus();
}
// The selector lit at the source in use; the title, the words above and the field say where it looks.
function paintSource(app) {
  if (!search.sourceRow) return;
  if (!app.state.streaming && search.source !== 'library') search.source = 'library';
  search.sourceRow.hidden = !app.state.streaming;
  for (const [k, b] of search.sourceButtons) b.classList.toggle('on', k === search.source);
  const name = onlineName(search.source);
  search.title.textContent = name ? t('SEARCH · {where}', { where: name }) : t('SEARCH LIBRARY');
  search.importRow.hidden = !!name;
  search.instructions.textContent = search.source === 'youtube' ? t('Songs and albums on YouTube Music — an album played goes into the changer as a disc of your own')
    : search.source === 'soundcloud' ? t('Songs on SoundCloud — after each title, who put it there')
    : app.state.streaming ? t('Type to find a song in your library, something to do or a setting — or look on YouTube Music or SoundCloud')
    : t('Type to find a song in your library, something to do or a setting — or paste a Spotify track/playlist link to add the matching songs you already have');
}
// A song's (or an album's) small cover at the start of its row, or an empty square where it would be.
const rowCover = (src) => (src ? el('img', { class: 'row-cover', src, alt: '' }) : el('span', { class: 'row-cover' }));
const minutes = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
async function searchOnline(app) {
  const where = search.source, name = onlineName(where);
  const query = search.field.value.trim().toLowerCase();
  const asked = ++search.online; // (a newer search, the words changed, or back to your music: this one's answer is left)
  clearTimeout(search.onlineTimer);
  if (STREAM_LINK.test(search.field.value.trim())) { search.onlineQuery = query; openLink(app, search.field.value.trim(), asked); return; }
  if (query.length < 2) { search.onlineQuery = null; setSearchStatus(t('TYPE WHAT TO LOOK FOR ON {where}', { where: name })); search.results.replaceChildren(); return; }
  search.onlineQuery = query;
  setSearchStatus(t('LOOKING ON {where}…', { where: name }));
  // (rows waiting for what's found: a square for the cover, a bar for the name)
  const waiting = (n) => Array.from({ length: n }, () => el('div', { class: 'list-row plain waiting-row' }, el('span', { class: 'row-cover' }), el('span', { class: 'waiting-bar' })));
  search.results.replaceChildren(...waiting(5));
  // YouTube Music's songs come at once, its albums (each opened to name its songs) a few seconds later: shown as they come.
  const parts = where === 'youtube' ? ['youtube-songs', 'youtube-albums'] : [where];
  const got = parts.map(() => undefined), rows = new Map();
  const draw = () => {
    if (asked !== search.online || !isOpen('search')) return;
    const coming = got.includes(undefined), found = got.flatMap((x) => x || []);
    if (!coming && got.every((x) => x === null)) {
      setSearchStatus(t('{where} DIDN’T ANSWER', { where: name }));
      search.results.replaceChildren(el('div', { class: 'list-row plain' }, pill(t('TRY AGAIN'), () => searchOnline(app))));
      return;
    }
    if (coming && !found.length) return;
    setSearchStatus(coming ? t('LOOKING ON {where}…', { where: name }) : found.length ? t('{n} FOUND ON {where}', { n: found.length, where: name }) : t('NOTHING LIKE THAT ON {where}', { where: name }));
    search.results.replaceChildren(...found.map((f) => rows.get(f) || rows.set(f, onlineRow(app, f)).get(f)), ...(coming ? waiting(3) : []));
  };
  await Promise.all(parts.map((w, i) => app.cdp.stream.search(query, w).catch(() => null).then((r) => { got[i] = r; draw(); })));
}
// A link pasted in: a playlist or an album on YouTube (Music) or SoundCloud, opened to its songs — to play, add or save
// as a playlist — or a song, to play.
const STREAM_LINK = /^https:\/\/(music\.youtube\.com|(www\.)?youtube\.com|soundcloud\.com)\/\S+$/i;
const LIST_LINK = /[?&]list=|\/browse\/|\/playlist|\/sets\//i;
async function openLink(app, link, asked) {
  if (!LIST_LINK.test(link)) {
    setSearchStatus(t('A SONG’S LINK'));
    search.results.replaceChildren(onlineRow(app, { kind: 'song', page: link, title: link }));
    return;
  }
  setSearchStatus(t('OPENING THE PLAYLIST…'));
  search.results.replaceChildren(el('div', { class: 'list-row plain waiting-row' }, el('span', { class: 'row-cover' }), el('span', { class: 'waiting-bar' })));
  const a = await app.cdp.stream.album(link).catch(() => null);
  if (asked !== search.online || !isOpen('search')) return;
  if (!a || !a.tracks.length) {
    setSearchStatus(t('COULDN’T OPEN THAT PLAYLIST'));
    search.results.replaceChildren(el('div', { class: 'list-row plain' }, pill(t('TRY AGAIN'), () => searchOnline(app))));
    return;
  }
  setSearchStatus(a.tracks.length === 1 ? t('1 SONG|single') : t('{n} SONGS', { n: a.tracks.length }));
  search.results.replaceChildren(onlineRow(app, { ...a, kind: 'album', count: a.tracks.length }),
    ...a.tracks.slice(0, 200).map((s) => onlineRow(app, { kind: 'song', page: s.page, title: s.title || s.page, artist: s.artist, duration: s.duration })));
}
// One thing found: a song's row or an album's, its sound asked for when the mouse rests on it.
function onlineRow(app, f) {
  const row = f.kind === 'album' ? onlineAlbumRow(app, f) : onlineSongRow(app, f);
  // the mouse resting on it: its (first) song's sound asked for now — it may be clicked in a moment
  const first = f.kind === 'album' ? f.tracks[0] && f.tracks[0].page : f.page;
  let resting = null;
  row.addEventListener('mouseenter', () => { resting = setTimeout(() => {
    if (first && !row.classList.contains('locked')) app.cdp.stream.prepare(first).then((r) => { if (r && r.locked && f.kind === 'song') markLocked(row); }).catch(() => {});
  }, 400); });
  row.addEventListener('mouseleave', () => clearTimeout(resting));
  return row;
}
// A song on SoundCloud: its title first, then (quieter) who put it there, and its length — a 30 s preview, a
// "slowed" copy, told apart at a glance. NEXT and ADD show on the row the mouse is on.
function onlineSongRow(app, f) {
  const row = trackRow(app, f.page, f.title || '', () => { if (row.classList.contains('locked')) return; app.appendAndPlay(f.page); closePanel('search'); });
  const buttons = row.querySelectorAll('button');
  buttons.forEach((b, i) => { if (i) b.classList.add('on-hover'); });
  const by = [f.artist, f.album].filter(Boolean).join(' · '); // (YouTube Music's: its album too)
  row.querySelector('.entry').replaceChildren(f.title || '', by ? el('span', { class: 'by' }, ` · ${by}`) : '');
  row.prepend(rowCover(f.thumb));
  if (f.duration) row.insertBefore(el('span', { class: 'when count' }, minutes(f.duration)), buttons[0]);
  row.append(buttons[0]); // PLAY at the right edge, where it always is; NEXT and ADD come up beside it
  if (f.locked) markLocked(row);
  else if (f.preview) markLocked(row, t('PREVIEW'), t('Only a 30-second preview: the whole song is for SoundCloud’s subscribers'));
  return row;
}
// A label's song (DRM), known once it's been tried: no buttons, DRM where they were (or PREVIEW: only 30 s of it).
function markLocked(row, label = t('DRM'), why = t('Locked by its label (DRM): it doesn’t play')) {
  if (row.classList.contains('locked')) return;
  row.classList.add('locked');
  row.querySelectorAll('button').forEach((b) => b.remove());
  row.title = why;
  row.append(el('span', { class: 'when count' }, label));
}
// An album found: PLAY puts it in (a disc in the changer) and plays it, ADD only puts it in.
function onlineAlbumRow(app, a) {
  const pages = a.tracks.map((s) => s.page);
  const put = (play) => app.addToQueue(pages, { sorted: true, play, title: a.title });
  const now = pill(t('PLAY'), (e) => { e.stopPropagation(); put(true); closePanel('search'); }, t('Play it now'));
  const add = pill(t('ADD'), (e) => { e.stopPropagation(); put(false); e.currentTarget.textContent = t('✓ DONE'); e.currentTarget.disabled = true; },
    app.changerMode() ? t('Into the changer') : t('Add to queue'));
  // SAVE…: kept as a playlist (M3U) of the songs' pages, to LOAD again another day — streamed, as now.
  const save = pill(t('SAVE…'), async (e) => {
    e.stopPropagation();
    const b = e.currentTarget;
    const r = await app.cdp.savePlaylistDialog(a.tracks.map((s) => ({ path: s.page, display: [s.artist, s.title].filter(Boolean).join(' - ') || s.page })), [a.artist, a.title].filter(Boolean).join(' - '));
    if (r && r.ok) { b.textContent = t('✓ DONE'); b.disabled = true; } else if (r && !r.canceled) app.setStatus(t("COULDN'T SAVE PLAYLIST"));
  }, t('Save it as a playlist (M3U): LOAD in the queue opens it again'));
  for (const b of [now, add, save]) b.classList.add('small');
  add.classList.add('on-hover'); save.classList.add('on-hover');
  return el('div', { class: 'list-row', title: t('Play {song}', { song: a.title }), onClick: () => { put(true); closePanel('search'); } },
    rowCover(a.thumb),
    el('span', { class: 'entry' }, [a.artist, a.title].filter(Boolean).join(' · ')),
    el('span', { class: 'when count' }, a.count === 1 ? t('1 SONG|single') : t('{n} SONGS', { n: a.count })), save, add, now);
}
// An action or a setting the search found, above the songs: an action is done (the search closed first), a setting
// shown — Settings opened at its row.
function commandRow(app, c) {
  const go = () => { closePanel('search'); if (c.kind === 'action') c.run(); else showSettingAt(app, c.row); };
  return el('div', { class: 'list-row command-row', title: c.kind === 'action' ? t('Do it') : t('Open Settings at it'), onClick: go },
    el('span', { class: 'command-kind' }, c.kind === 'action' ? '▸' : '⚙'),
    el('span', { class: 'entry' }, c.label),
    c.kind === 'action' ? (c.key ? el('kbd', {}, c.key === 'Space' ? t('Space|key') : c.key) : null) : el('span', { class: 'command-where' }, t('SETTINGS · {section}', { section: c.section })));
}
/** Settings, scrolled to the row called `label` (in English), lit up for a moment. */
export function showSettingAt(app, label, tries = 20) {
  if (!isOpen('settings')) showSettings(app);
  const card = panels.get('settings') && panels.get('settings').card;
  if (card && settingsGo) settingsGo(t(label));
  const row = card && [...card.querySelectorAll('.setting-row')].find((r) => r.firstElementChild && r.firstElementChild.textContent === t(label));
  if (!row) { if (tries > 0) setTimeout(() => showSettingAt(app, label, tries - 1), 50); return; }
  row.scrollIntoView({ block: 'center', behavior: anim.enabled ? 'smooth' : 'auto' });
  row.classList.remove('found');
  void row.offsetWidth; // (again, if it was just lit)
  row.classList.add('found');
}
async function onSearchInput(app) {
  if (search.source !== 'library') {
    search.online++; // (what's shown is for other words now)
    clearTimeout(search.onlineTimer);
    search.onlineTimer = setTimeout(() => searchOnline(app), 700);
    return;
  }
  const text = search.field.value.trim();
  // A YouTube (Music) or SoundCloud link pasted while looking through your music: opened where it's from.
  if (app.state.streaming && STREAM_LINK.test(text)) { setSource(app, /soundcloud\.com/i.test(text) ? 'soundcloud' : 'youtube'); return; }
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
  setSearchStatus(isPlaylist ? t('RESOLVING SPOTIFY PLAYLIST…') : t('RESOLVING SPOTIFY TRACK…'));
  const result = await app.cdp.resolveSpotifyLink(url);
  if (result.needsSignIn) { promptSpotifySignIn(app, url); return; }
  if (result.error) { setSearchStatus(t('SPOTIFY IMPORT FAILED — {why}', { why: result.error })); return; }
  finishImport(app, result.tracks);
}
function promptSpotifySignIn(app, pendingUrl) {
  setSearchStatus(t('CONNECT SPOTIFY TO IMPORT PLAYLISTS'));
  const explain = el('div', { class: 'list-row plain' }, t("Reading a playlist's songs needs you signed in to Spotify — a single track link doesn't."));
  const connect = pill(t('CONNECT SPOTIFY ACCOUNT'), async () => {
    connect.disabled = true;
    setSearchStatus(t('OPENING SPOTIFY LOGIN IN YOUR BROWSER…'));
    const message = await app.cdp.spotifySignIn();
    setSearchStatus(message === 'SPOTIFY CONNECTED' ? t('SPOTIFY CONNECTED') : message);
    if (message === 'SPOTIFY CONNECTED') { search.lastSpotifyUrl = null; importSpotifyLink(app, pendingUrl, true); }
    else connect.disabled = false;
  });
  search.results.replaceChildren(explain, connect);
}
function finishImport(app, tracks) {
  if (!tracks) { setSearchStatus(t('SPOTIFY LOOKUP FAILED — CHECK THE LINK')); return; }
  if (!tracks.length) { setSearchStatus(t('NO TRACKS FOUND AT THAT LINK')); return; }
  if (!search.index.length) { setSearchStatus(t('LOAD A TRACK FIRST TO SET A LIBRARY FOLDER TO MATCH AGAINST')); return; }
  const matched = [], missing = [];
  for (const track of tracks) {
    const f = findLocalMatch(track.title, track.artist);
    if (f) matched.push(f); else missing.push(`${track.title}${track.artist ? ` – ${track.artist}` : ''}`);
  }
  if (matched.length) app.addToQueue(matched, { sorted: true });
  setSearchStatus(t('{found} OF {n} TRACKS FOUND IN YOUR LIBRARY AND ADDED', { found: matched.length, n: tracks.length }));
  search.results.replaceChildren(...missing.map((m) => el('div', { class: 'list-row plain' }, t('NOT IN YOUR LIBRARY · {song}', { song: m }))));
}
async function importLibrary(app) {
  const r = await app.cdp.importLibraryDialog();
  if (r.canceled) return;
  if (r.error) { setSearchStatus(t("COULDN'T READ THAT IMPORT FILE")); return; }
  if (r.kind === 'itunes') {
    if (!r.tracks.length) { setSearchStatus(t('NO PLAYABLE TRACKS FOUND IN THAT LIBRARY FILE')); return; }
    app.addToQueue(r.tracks, { sorted: true });
    setSearchStatus(t('{n} TRACKS IMPORTED FROM ITUNES/MUSIC', { n: r.tracks.length }));
    return;
  }
  if (!r.tracks.length) { setSearchStatus(t('NO TRACKS FOUND IN THAT EXPORT FILE')); return; }
  finishImport(app, r.tracks);
}

// ---- Spotify -----------------------------------------------------------------------------------------------------
// Three states: no developer app yet (the Client ID and Secret, with how to get them), not connected (or connected
// before playback existed), and connected — your saved albums, your playlists, and a search. A click puts it on the tray.

const SPOTIFY_MESSAGES = {
  SIGN_IN: t('CONNECT SPOTIFY AGAIN'), OFFLINE: t("COULDN'T REACH SPOTIFY"),
  NOT_SHARED: t('SPOTIFY ONLY SHARES THE SONGS OF PLAYLISTS YOU OWN OR COLLABORATE ON'), EMPTY: t('NOTHING TO PLAY ON THAT ONE'),
  NOT_REGISTERED: t('SPOTIFY DOESN’T LET THIS ACCOUNT INTO YOUR APP · ADD ITS EMAIL UNDER USER MANAGEMENT ON THE DASHBOARD'),
};
const sp = { account: null, editing: false, step: 0, trouble: null, drm: null, tab: 'ALBUMS', lists: { ALBUMS: null, PLAYLISTS: null }, next: { ALBUMS: 0, PLAYLISTS: 0 }, query: '', found: null, status: '', searchTimer: null };
// (No answer at all says why, when the network did: "COULDN'T REACH SPOTIFY · ERR_CERT_AUTHORITY_INVALID".)
const spotifyMessage = (code, detail) => (code === 'OFFLINE' && detail ? `${SPOTIFY_MESSAGES.OFFLINE} · ${detail}` : SPOTIFY_MESSAGES[code] || `SPOTIFY · ${code}`); // an unknown code: Spotify's own word

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
  sp.status = t('LOADING…'); refreshPanel('spotify');
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
  sp.status = t('READING {name}…', { name: item.name.toUpperCase() }); refreshPanel('spotify');
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
  const link = el('button', { class: 'copy-link', title: t('Copy') }, text);
  let timer = null;
  link.addEventListener('click', async () => {
    if (!(await app.cdp.copyText(text).catch(() => false))) return;
    link.classList.add('copied');
    clearTimeout(timer); timer = setTimeout(() => link.classList.remove('copied'), 1600);
  });
  return link;
}

const changeAppPill = () => pill(t('CHANGE APP'), () => { sp.editing = true; sp.status = ''; refreshPanel('spotify'); }, t('Enter another Client ID and Secret — to fix a mistyped one, or to use another Spotify developer app'));

// The setup wizard: 1 create the app, 2 its keys (checked with Spotify before they're kept), 3 let your account in,
// 4 connect — and when something's wrong, what, with the way back to the step that fixes it.
function spotifyWizard(app, a, status, foot) {
  const step = sp.step || (!a.configured || sp.editing ? 1 : 4);
  const go = (n) => { sp.step = n; sp.trouble = null; sp.status = ''; refreshPanel('spotify'); };
  const dots = el('div', { class: 'guide-dots' }, [1, 2, 3, 4].map((n) => el('button', { class: `guide-dot${n === step ? ' on' : ''}`, title: t('Step {n}', { n }), onClick: () => go(n) })));
  const heading = [title(t('SPOTIFY')), el('div', { class: 'subtitle' }, t('SET UP · {step} OF 4 — {what}', { step, what: [t('CREATE AN APP'), t('ITS KEYS'), t('LET YOURSELF IN'), t('CONNECT')][step - 1] })), gap(12)];
  const trouble = sp.trouble ? el('div', { class: 'spotify-trouble' }, el('div', {}, sp.trouble.text),
    sp.trouble.step !== step ? pill(t('GO TO STEP {step}', { step: sp.trouble.step }), () => go(sp.trouble.step)) : null) : null;
  const nav = (...right) => el('div', { class: 'close-row guide-actions' }, pill(t('CLOSE'), () => closePanel('spotify')), step > 1 ? pill(t('BACK'), () => go(step - 1)) : null, el('span', { class: 'grow' }), ...right.filter(Boolean));
  const page = (...parts) => parts.flat().filter(Boolean); // an empty part (no trouble) leaves nothing, not "null"
  const dashboard = pill(t('OPEN SPOTIFY DASHBOARD'), () => app.cdp.openSpotifyDashboard());
  const intro = hint(t('Spotify lets an app play for only five people, so CDPlayer plays through your own free Spotify developer app. It takes two minutes, once. You need Spotify Premium.'));
  if (step === 1) {
    return page(...heading, intro, gap(6),
      hint(t('Open the dashboard, click Create app, and fill it in — click each to copy it:')),
      el('div', { class: 'copy-list' },
        el('div', {}, t('App name: '), copyLink(app, 'CDPlayer')),
        el('div', {}, t('App description: '), copyLink(app, t('My CD player'))),
        el('div', {}, t('Redirect URI: '), copyLink(app, 'http://127.0.0.1:8080/callback'), t(' — then click Add'))),
      hint(t('Under “Which API/SDKs are you planning to use?” tick Web API and Web Playback SDK, agree to the terms, and Save.')),
      gap(10), el('div', { class: 'row-pills' }, dashboard), trouble, dots, nav(pill(t('NEXT|step'), () => go(2))));
  }
  if (step === 2) {
    const id = el('input', { class: 'text-input', type: 'text', placeholder: t('Client ID'), spellcheck: 'false', value: sp.keyId || '' });
    const secret = el('input', { class: 'text-input', type: 'password', placeholder: t('Client Secret'), spellcheck: 'false', value: sp.keySecret || '' });
    const mark = (input, note) => { const ok = /^[0-9a-f]{32}$/i.test(input.value.trim()); note.textContent = !input.value.trim() ? '' : ok ? '✓' : t('Looks mistyped — 32 letters and digits'); note.className = `key-note${ok ? ' ok' : ''}`; };
    const idNote = el('span', { class: 'key-note' }), secretNote = el('span', { class: 'key-note' });
    id.addEventListener('input', () => { sp.keyId = id.value; mark(id, idNote); });
    secret.addEventListener('input', () => { sp.keySecret = secret.value; mark(secret, secretNote); });
    const paste = (input, note, key) => pill(t('PASTE'), async () => { const text = await app.cdp.clipboardText().catch(() => ''); if (text) { input.value = text; sp[key] = text; mark(input, note); } }, t('Paste it from the clipboard'));
    requestAnimationFrame(() => { mark(id, idNote); mark(secret, secretNote); });
    const check = el('button', { class: 'pill go', onClick: async () => {
      if (!id.value.trim() || !secret.value.trim()) { sp.status = t('BOTH ARE NEEDED'); refreshPanel('spotify'); return; }
      check.disabled = true; status.textContent = t('ASKING SPOTIFY…');
      const r = await app.cdp.spotifyCheckKeys({ clientId: id.value, clientSecret: secret.value }).catch(() => ({ error: 'OFFLINE' }));
      if (!r.ok) { sp.trouble = r.error === 'OFFLINE' ? { step: 2, text: t('Couldn’t reach Spotify — check the connection and try again.') } : await app.cdp.spotifyDiagnose(r.error); refreshPanel('spotify'); return; }
      if (sp.editing) app.stopSpotify(); // another app's sign-in can't carry on playing
      sp.account = await app.cdp.saveSpotifyCredentials({ clientId: id.value, clientSecret: secret.value });
      Object.assign(sp, { editing: false, keyId: '', keySecret: '', lists: { ALBUMS: null, PLAYLISTS: null }, next: { ALBUMS: 0, PLAYLISTS: 0 }, found: null });
      go(3);
    } }, t('CHECK & SAVE'));
    return page(...heading, hint(t('On your app’s page on the dashboard, open Settings. Copy the Client ID, and the Client Secret (under View client secret), and paste them here.')), gap(10),
      el('div', { class: 'key-row' }, id, paste(id, idNote, 'keyId')), idNote, gap(8),
      el('div', { class: 'key-row' }, secret, paste(secret, secretNote, 'keySecret')), secretNote,
      status, trouble, dots, nav(sp.editing && a.configured ? pill(t('CANCEL'), () => { sp.editing = false; go(0); }) : null, check));
  }
  if (step === 3) {
    return page(...heading, hint(t('Spotify only lets people you’ve added use your app. In your app’s settings, open User Management and add the name and email of the Spotify account you listen with.')),
      gap(10), el('div', { class: 'row-pills' }, dashboard), trouble, dots, nav(pill(t('NEXT|step'), () => go(4))));
  }
  const connect = el('button', { class: 'pill go', onClick: async () => {
    connect.disabled = true; sp.trouble = null;
    status.textContent = t('SIGN IN TO SPOTIFY IN YOUR BROWSER…');
    const slow = setTimeout(async () => { if (!sp.account || sp.account.connected) return; sp.trouble = await app.cdp.spotifyDiagnose('NO_ANSWER'); sp.status = t('STILL WAITING FOR THE BROWSER…'); refreshPanel('spotify'); }, 20000);
    const result = await app.cdp.spotifySignIn();
    clearTimeout(slow);
    if (result !== 'SPOTIFY CONNECTED') { sp.status = result; refreshSpotifyAccount(app); return; }
    const v = await app.cdp.spotifyVerify().catch(() => ({ error: 'OFFLINE' }));
    if (!v.ok && v.error !== 'OFFLINE') { sp.trouble = await app.cdp.spotifyDiagnose(v.error); sp.status = ''; refreshSpotifyAccount(app); return; }
    Object.assign(sp, { status: '', step: 0, trouble: null, lists: { ALBUMS: null, PLAYLISTS: null }, next: { ALBUMS: 0, PLAYLISTS: 0 } });
    refreshSpotifyAccount(app);
  } }, a.reconnectNeeded ? t('RECONNECT SPOTIFY') : t('CONNECT SPOTIFY'));
  return page(...heading, hint(a.reconnectNeeded ? t('Playing Spotify needs a few more permissions than importing playlists did — connect once more.') : t('Sign in to Spotify in your browser, and allow CDPlayer. Then your albums and playlists are here.')),
    gap(10), el('div', { class: 'row-pills' }, connect, changeAppPill()), status, trouble, dots, nav());
}

function buildSpotify(app) {
  const a = sp.account;
  const status = el('div', { class: 'setting-hint' }, sp.status);
  const foot = el('div', { class: 'close-row' }, pill(t('CLOSE'), () => closePanel('spotify')));
  if (!a) return [title(t('SPOTIFY')), gap(18), hint(t('CHECKING…')), foot];

  // Not set up, or not connected: the setup wizard, a step at a time (and again from CHANGE APP).
  if (!a.configured || sp.editing || !a.connected || a.reconnectNeeded) return spotifyWizard(app, a, status, foot);

  const tabs = el('div', { class: 'row-pills' }, ...['ALBUMS', 'PLAYLISTS'].map((tab) => {
    const b = pill(tab === 'ALBUMS' ? t('ALBUMS') : t('PLAYLISTS'), () => { sp.tab = tab; sp.query = ''; sp.found = null; if (!sp.lists[tab]) loadSpotifyList(app, tab); refreshPanel('spotify'); });
    b.classList.toggle('on', !sp.found && sp.tab === tab);
    return b;
  }));
  const field = el('input', { class: 'text-input', type: 'text', placeholder: t('Search Spotify for an album or playlist'), value: sp.query, spellcheck: 'false' });
  field.addEventListener('input', () => searchSpotify(app, field.value));
  const items = sp.found || sp.lists[sp.tab] || [];
  const rows = items.map((item) => el('div', { class: 'list-row', title: t('Put {name} on the tray', { name: item.name }), onClick: () => putSpotifyOnTray(app, item) },
    el('span', { class: 'entry' }, `${item.name}${item.owner ? ` · ${item.owner}` : ''}`),
    el('span', { class: 'duration' }, `${sp.found ? `${({ album: t('ALBUM'), playlist: t('PLAYLIST') })[item.kind] || item.kind.toUpperCase()} · ` : ''}${t('{n} TRACKS', { n: item.total })}`)));
  if (!sp.found && sp.next[sp.tab] !== null && sp.lists[sp.tab]) rows.push(el('div', { class: 'row-pills' }, pill(t('MORE'), () => loadSpotifyList(app, sp.tab))));
  if (sp.found && !sp.found.length) rows.push(el('div', { class: 'list-row plain' }, t('NOTHING FOUND')));
  const drm = sp.drm === false ? hint(t("Spotify playback isn't supported on this system — Widevine isn't available.")) : [];
  requestAnimationFrame(() => { if (sp.query && document.activeElement !== field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); } });
  const disconnect = pill(t('DISCONNECT SPOTIFY'), async () => {
    app.stopSpotify();
    sp.account = await app.cdp.disconnectSpotify();
    Object.assign(sp, { lists: { ALBUMS: null, PLAYLISTS: null }, next: { ALBUMS: 0, PLAYLISTS: 0 }, query: '', found: null, status: t('SPOTIFY DISCONNECTED') });
    refreshPanel('spotify');
  }, t('Sign CDPlayer out of Spotify. Your Client ID and Secret stay, so connecting again is one click.'));
  const showLog = pill(t('SHOW LOG'), () => app.cdp.showSpotifyLog(), t('The Spotify log: each step of connecting and playing, to send along if Spotify won’t play'));
  const connectedFoot = el('div', { class: 'close-row split' }, el('div', { class: 'row-pills' }, disconnect, changeAppPill(), showLog), pill(t('CLOSE'), () => closePanel('spotify')));
  return [title(t('SPOTIFY')), gap(12), tabs, gap(10), field, drm, gap(10), el('div', { class: 'scroll' }, rows), status, connectedFoot];
}

// ---- Welcome & What's New ------------------------------------------------------------------------------------------

function tipsCard(heading, subtitle, bullets, onDone) {
  return [title(heading), el('div', { class: 'subtitle' }, subtitle), gap(20),
    bullets.map((b) => el('div', { class: 'tip-row' }, el('span', { class: 'dot' }, '●'), el('span', { class: 'tip', html: b }))),
    closeRow(onDone, t('GOT IT'))];
}

// The first time CDPlayer opens: the guide (help.js), five cards to step through — and remembered once it's closed.
/** The first launch: the guide round the window, then never again (it's in SETTINGS → SHOW THE GUIDE). */
export async function showOnboarding(app) {
  let toFeatures = false;
  await startTour({ first: true, onFeatures: () => { toFeatures = true; showFeatures(app); } });
  app.cdp.markOnboarded();
  // START LISTENING (or SKIP) with nothing in yet: the music is on the shelf, so the shelf opens.
  if (!toFeatures && !app.state.loadedPath) app.showMe('shelf');
}

// ---- LIBRARY CHECK (the shelf's CHECK): what's wrong in the music folder, and a way to fix each ------------------

let check = null; // { status, result, open: Set, covers: Map(folder → { cover } | 'LOOKING' | 'NONE' | 'SAVED') }
const baseName = (p) => String(p).split(/[\\/]/).pop();
export function showLibraryCheck(app) {
  check = { status: t('CHECKING…'), result: null, open: new Set(['untagged', 'noCover', 'duplicates', 'gaps', 'unreadable']), covers: new Map() };
  const p = openPanel('check', () => buildCheck(app), { width: 640 });
  p.onClose = () => { check = null; };
  runCheck(app);
}
let checkProgressHooked = false;
async function runCheck(app) {
  if (!checkProgressHooked) {
    checkProgressHooked = true;
    app.cdp.onLibraryCheck(({ done, total }) => { if (check && !check.result) { check.status = t('CHECKING · {done} / {total}', { done, total }); refreshPanel('check'); } });
  }
  check.result = null; check.status = t('CHECKING…'); refreshPanel('check');
  const result = await app.cdp.checkLibrary().catch(() => null);
  if (!check) return;
  check.result = result;
  if (result) result.notOnDiscogs = await app.cdp.discogsNotFound(app.shelfAlbumIds()).catch(() => []);
  const n = result ? ['untagged', 'noCover', 'duplicates', 'gaps', 'unreadable', 'notOnDiscogs'].reduce((s, k) => s + result[k].length, 0) : 0;
  check.status = !result ? t('CHOOSE YOUR MUSIC FOLDER ON THE SHELF FIRST') : n === 1 ? t('1 THING TO LOOK AT') : n ? t('{n} THINGS TO LOOK AT', { n }) : t('NOTHING TO FIX ★');
  refreshPanel('check');
}
function buildCheck(app) {
  const r = check.result;
  const show = (p) => pill(t('SHOW'), () => app.cdp.showFile(p), t('Show it in its folder'));
  const group = (key, name, hintText, rows) => {
    if (!rows.length) return null;
    const open = check.open.has(key);
    return el('div', { class: 'check-group' },
      el('button', { class: 'faq-q', onClick: () => { if (open) check.open.delete(key); else check.open.add(key); refreshPanel('check'); } }, el('span', {}, open ? '−' : '+'), `${name} · ${rows.length}`),
      ...(open ? [el('div', { class: 'setting-hint' }, hintText), ...rows] : []));
  };
  const row = (main, sub, ...buttons) => el('div', { class: 'check-row' }, el('div', { class: 'check-name' }, el('div', {}, main), sub ? el('div', { class: 'check-sub' }, sub) : null), el('div', { class: 'check-buttons' }, buttons));
  const coverRow = (a) => {
    const state = check.covers.get(a.folder);
    const find = async () => {
      check.covers.set(a.folder, 'LOOKING'); refreshPanel('check');
      const found = await app.cdp.findCover({ artist: a.artist, title: a.title, album: a.album }).catch(() => null);
      check.covers.set(a.folder, found && found.cover ? { cover: found.cover } : 'NONE'); refreshPanel('check');
    };
    const save = async (cover) => {
      check.covers.set(a.folder, 'SAVING'); refreshPanel('check');
      for (const p of a.paths) await app.saveTags(p, { cover }).catch(() => {});
      check.covers.set(a.folder, 'SAVED'); refreshPanel('check');
    };
    const buttons = state && state.cover ? [el('img', { class: 'check-cover', src: state.cover, alt: '' }), el('button', { class: 'pill go', onClick: () => save(state.cover) }, t('SAVE'))]
      : state === 'LOOKING' ? [el('span', { class: 'check-sub' }, t('LOOKING…'))] : state === 'SAVING' ? [el('span', { class: 'check-sub' }, t('SAVING…'))]
      : state === 'SAVED' ? [el('span', { class: 'check-sub' }, t('SAVED ★'))] : [pill(state === 'NONE' ? t('NOT FOUND · AGAIN') : t('FIND COVER'), find, t('Look for its cover online'))];
    return row(a.album, a.artist, ...buttons, show(a.paths[0]));
  };
  return [title(t('LIBRARY CHECK')), el('div', { class: 'subtitle' }, check.status), gap(12),
    r ? el('div', { class: 'scroll check-list' },
      group('untagged', t('NO TAGS'), t('No artist or album in the file — it’s on the shelf by its folder, and covers and lyrics can’t be found for it. FIX TAGS looks it up on MusicBrainz.'),
        r.untagged.map((p) => row(baseName(p), p.split(/[\\/]/).slice(-3, -1).join(' / '), pill(t('FIX TAGS'), () => showTags(app, p, () => { if (check) runCheck(app); }), t('Fill in its tags from MusicBrainz')), show(p)))),
      group('noCover', t('NO COVER'), t('No picture in its files or beside them. FIND COVER looks online; SAVE writes it into every song of the album.'), r.noCover.map(coverRow)),
      group('duplicates', t('DUPLICATES'), t('The same song in more than one file (the same artist and title, nearly the same length) — say, an MP3 and a FLAC. Nothing is deleted: have a look.'),
        r.duplicates.map((copies) => row(baseName(copies[0]).replace(/\.[^.]+$/, ''), t('{n} copies', { n: copies.length }), ...copies.map((p) => pill(t('SHOW {format}', { format: (p.split('.').pop() || '').toUpperCase() }), () => app.cdp.showFile(p)))))),
      group('gaps', t('GAPS'), t('Albums missing some of their track numbers — a song or two may not have come across.'),
        r.gaps.map((g) => row(g.album, g.disc > 1 ? t('{artist} · DISC {disc} · missing {numbers}', { artist: g.artist, disc: g.disc, numbers: g.missing.join(', ') }) : t('{artist} · missing {numbers}', { artist: g.artist, numbers: g.missing.join(', ') }), pill(t('SHOW'), () => app.cdp.showFile(g.folder))))),
      group('discogs', t('NOT ON DISCOGS'), t('Albums Discogs’ search didn’t find. CHOOSE PRESSING… lets you search and pick it.'),
        (r.notOnDiscogs || []).map((x) => row(x.title || '—', x.artist || null, pill(t('CHOOSE PRESSING…'), (e) => app.choosePressingFor(x, e.currentTarget, () => runCheck(app)))))),
      group('unreadable', t('UNREADABLE'), t('Files CDPlayer couldn’t read any sound from — damaged, or not really music.'), r.unreadable.map((p) => row(baseName(p), null, show(p)))))
      : null,
    el('div', { class: 'close-row guide-actions' }, pill(t('CHECK AGAIN'), () => runCheck(app)), el('span', { class: 'grow' }), pill(t('CLOSE'), () => closePanel('check')))];
}

// ---- Help: the guide, the FAQ and the keyboard shortcuts (help.js; also Settings → HELP) --------------------------

export function showFaq() {
  const open = new Set();
  const build = () => [title(t('QUESTIONS')), el('div', { class: 'subtitle' }, t('What people ask the first time')), gap(14),
    el('div', { class: 'scroll faq-list' }, FAQ.map(({ q, a }, i) => el('div', { class: `faq${open.has(i) ? ' open' : ''}` },
      el('button', { class: 'faq-q', onClick: () => { if (open.has(i)) open.delete(i); else open.add(i); refreshPanel('faq'); } }, el('span', {}, open.has(i) ? '−' : '+'), q),
      open.has(i) ? el('div', { class: 'faq-a' }, a) : null))),
    closeRow(() => closePanel('faq'))];
  openPanel('faq', build, { width: 520 });
}

/** WHAT'S SPECIAL: what CDPlayer does that other players don't, in groups, with SHOW ME where there's a thing to see. */
export function showFeatures(app) {
  const item = (f) => el('div', { class: 'feature' },
    el('div', { class: 'feature-head' }, el('span', { class: 'feature-title' }, f.title),
      f.show ? pill(t('SHOW ME'), () => { closePanel('features'); closePanel('settings'); setTimeout(() => app.showMe(f.show), 200); }) : null),
    el('div', { class: 'feature-text' }, f.text));
  openPanel('features', () => [title(t('WHAT’S SPECIAL')), el('div', { class: 'subtitle' }, t('What CDPlayer does that other players don’t')), gap(10),
    el('div', { class: 'scroll feature-list' }, FEATURES.flatMap((g) => [el('div', { class: 'settings-section' }, g.group), ...g.items.map(item), gap(10)])),
    closeRow(() => closePanel('features'))], { width: 560 });
}

export function showShortcuts() {
  const keys = (text) => text.split('`').map((part, i) => (i % 2 ? el('kbd', {}, part === 'Space' ? t('Space|key') : part === 'Esc' ? 'Esc' : part) : part ? el('span', {}, part.trim() === 'or' ? ` ${t('or')} ` : part) : null));
  openPanel('shortcuts', () => [title(t('KEYBOARD SHORTCUTS')), gap(12),
    el('div', { class: 'scroll shortcut-list' }, SHORTCUTS.filter(([, , only]) => !only || document.body.classList.contains('changer-mode')).map(([k, what]) => el('div', { class: 'shortcut' }, el('span', { class: 'keys' }, keys(k)), el('span', { class: 'what' }, what)))),
    closeRow(() => closePanel('shortcuts'))], { width: 520 });
}

// Newest first. Only the entry matching the running version is ever shown.
const CHANGELOG = [
  { version: '2.20.1', changes: [
    '<b>YouTube Music &amp; SoundCloud</b>: turned on in Settings &rarr; LIBRARY, the search finds their albums and songs, and they play like your own discs &mdash; in the best sound each gives without signing in; a playlist&rsquo;s link pasted in the search opens it',
    '<b>PLAYER LOOK</b> in Settings &rarr; LOOK: CLASSIC; VISUALIZER, the music drawn across the window; LYRICS, the song&rsquo;s words down the side as they&rsquo;re sung; HI-FI, a CD player&rsquo;s brushed-metal front, the song and two level meters lit in its display, metal keys under it; ALBUM, an album&rsquo;s page, its cover in the jewel case and the disc out of it &mdash; and each its own Now Playing video, a film moved by the music and the words; and gentler motion all round &mdash; the song&rsquo;s name rising in, the display&rsquo;s flicker, small lamps on what&rsquo;s on',
    '<b>IMPORT PLAYS</b> from Spotify, Last.fm, ListenBrainz or Apple Music, counted on the same songs; <b>scrobbling</b> sends what you play here to Last.fm and ListenBrainz',
    '<b>Each output its own sound</b>: the EQ, mono and spatial audio set on your headphones come back when they&rsquo;re plugged in, the speakers&rsquo; when they&rsquo;re the output again',
    '<b>A backup by itself each day</b>, the last 7 kept; <b>COPY REPORT</b> in Settings &rarr; HELP puts what a bug report needs in one paste',
    '<b>KARAOKE</b> counts you in: three dots lit one by one before the first line and through each break; the next line comes up a moment early, and the album&rsquo;s cover breathes with the music behind',
    '<b>Each theme its own Now Playing card</b> (P): a jewel case, a disc out of it, a polaroid, a planet, a sunset, a reflection in the sea, a terminal, a ticket, snow, a streaming app\'s; and each PLAYER LOOK but CLASSIC its own too, in the theme\'s colours &mdash; a bar of keys, a spotlight, a hi-fi deck\'s display, the cover edge to edge; and <b>Settings</b> a section at a time, opened with <kbd>,</kbd> (HISTORY with <kbd>H</kbd>), each panel coming out of its button',
    '<b>Each theme a touch of its own</b>: RED&rsquo;s display behind smoked red glass, BLUE&rsquo;s disc ringed in light, SUNSET&rsquo;s sun just gone down, FOREST&rsquo;s fireflies; <b>AMBIENT BACKGROUND &rarr; GRADIENT</b>, the cover&rsquo;s own colours flowing slowly behind the player',
    '<b>The mini player</b> redone around the cover, and bigger or smaller by dragging an edge; a song taken out of the queue comes back with <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd>; SHUFFLE and REPEAT on <kbd>X</kbd> and <kbd>R</kbd>',
  ], changesIn: { ru: [
    '<b>YouTube Music и SoundCloud</b>: включите в Настройках &rarr; БИБЛИОТЕКА &mdash; поиск находит их альбомы и песни, и они играют как ваши диски, в лучшем качестве, которое сайт даёт без входа; ссылка на плейлист, вставленная в поиск, открывает его',
    '<b>ВИД ПЛЕЕРА</b> в Настройках &rarr; ВИД: КЛАССИКА; ВИЗУАЛИЗАТОР &mdash; музыка нарисована на всё окно; ТЕКСТ &mdash; слова песни сбоку, по ходу пения; HI-FI &mdash; передняя панель CD-проигрывателя из шлифованного металла: песня и два индикатора уровня светятся в её дисплее, под ним металлические кнопки; АЛЬБОМ &mdash; страница альбома: обложка в коробке и выехавший из неё диск; и у каждого своё видео &laquo;Сейчас играет&raquo; &mdash; маленький фильм, который движется под музыку и слова; и мягкие анимации повсюду &mdash; название песни выплывает, дисплей мерцает, маленькие лампочки на включённом',
    '<b>ИМПОРТ ПРОСЛУШИВАНИЙ</b> из Spotify, Last.fm, ListenBrainz или Apple Music &mdash; засчитываются тем же песням; <b>скробблинг</b> отправляет то, что играет здесь, в Last.fm и ListenBrainz',
    '<b>У каждого выхода свой звук</b>: эквалайзер, моно и пространственный звук, настроенные для наушников, возвращаются, когда их подключают, а для колонок &mdash; когда звук снова идёт в них',
    '<b>Резервная копия каждый день сама</b>, хранятся последние 7; <b>СКОПИРОВАТЬ ОТЧЁТ</b> в Настройках &rarr; ПОМОЩЬ собирает всё нужное для сообщения об ошибке',
    '<b>КАРАОКЕ</b> отсчитывает вступление: три точки загораются по одной перед первой строкой и в каждом проигрыше; следующая строка появляется чуть заранее, а позади дышит в такт музыке обложка альбома',
    '<b>У каждой темы своя карточка &laquo;Сейчас играет&raquo;</b> (P): коробка диска, выехавший диск, полароид, планета, закат, отражение в море, терминал, билет, снег, как в стриминговом приложении; и у каждого вида плеера, кроме КЛАССИКИ, тоже своя, в цветах темы &mdash; панель кнопок, прожектор, дисплей hi-fi деки, обложка во всю высоту; а <b>Настройки</b> &mdash; по разделам, открываются клавишей <kbd>,</kbd> (ИСТОРИЯ &mdash; <kbd>H</kbd>), и каждое окно выходит из своей кнопки',
    '<b>У каждой темы своя деталь</b>: дисплей RED за дымчатым красным стеклом, диск BLUE в кольце света, только что севшее солнце SUNSET, светлячки FOREST; <b>ФОН ОТ ОБЛОЖКИ &rarr; ГРАДИЕНТ</b> &mdash; цвета самой обложки медленно перетекают за плеером',
    '<b>Мини-плеер</b> переделан вокруг обложки, и его можно увеличить или уменьшить, потянув за край; песню, убранную из очереди, возвращает <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd>; ПЕРЕМЕШАТЬ и ПОВТОР &mdash; на <kbd>X</kbd> и <kbd>R</kbd>',
  ] } },
  { version: '2.19.0', changes: [
    '<b>Dividers of your own</b>: + DIVIDER in an album&rsquo;s case files it behind one (&ldquo;For the car&rdquo;, &ldquo;Sunday&rdquo;); SORT &rarr; MY DIVIDERS stands the shelf by them, SHOW shows one',
    '<b>Editions stand together</b>: an album and its deluxe edition or remaster are one spine, the one you played last in front; its case switches between them',
    '<b>SKIP a song</b> in its case &mdash; an intro, a skit: passed over as the music moves on, still played when you pick it',
    '<b>FILL the changer</b> from the shelf with albums from the ones shown, or KEEP IT FULL: each finished disc makes room for another, so the music never runs out',
    '<b>The search finds what to do</b>: type SHUFFLE, KARAOKE or a setting&rsquo;s name (or crossfeed, replaygain) after / or &#8984;K / Ctrl+K',
  ], changesIn: { ru: [
    '<b>Свои разделители</b>: + РАЗДЕЛИТЕЛЬ в коробке альбома ставит его за разделитель (&laquo;Для машины&raquo;, &laquo;Воскресенье&raquo;); СОРТИРОВКА &rarr; МОИ РАЗДЕЛИТЕЛИ расставляет полку по ним, ПОКАЗ показывает один',
    '<b>Издания стоят вместе</b>: альбом и его делюкс или ремастер &mdash; один корешок, впереди тот, что слушали последним; в коробке переключатель между ними',
    '<b>ПРОПУСК песни</b> в коробке &mdash; интро, скит: пропускается, когда музыка идёт дальше, но играет, если выбрать её саму',
    '<b>ЗАПОЛНИТЬ чейнджер</b> с полки альбомами из показанных или ДЕРЖАТЬ ПОЛНЫМ: каждый доигранный диск уступает место новому, и музыка не кончается',
    '<b>Поиск находит действия</b>: наберите ПЕРЕМЕШАТЬ, КАРАОКЕ или название настройки (или кроссфид, replaygain) после / или &#8984;K / Ctrl+K',
  ] } },
  { version: '2.18.0', changes: [
    '<b>SHOW on the shelf</b>: all the albums, or only the dusty ones, still wrapped, left part-way, with a note, never played, one decade or one genre; PULL ONE pulls from what&rsquo;s shown',
    '<b>Albums heard as albums</b>: one played from its first song and left part-way has a ribbon bookmark on its spine and CONTINUE &middot; TRACK n in its case; played to the end, the booklet&rsquo;s back cover says &ldquo;start to end &times;n&rdquo;',
    '<b>Moved songs keep their history</b>: music moved to another folder or drive is found again, and BRING THEIR HISTORY brings its plays, dust and HISTORY along',
    '<b>BACKUP</b> in Settings &rarr; LIBRARY: your queue, history, plays, notes, themes and settings in one .cdbackup file, for a new computer or after reinstalling',
    '<b>PUT BACK THE ORIGINAL</b> in the Tags panel: the tags a file had before CDPlayer first wrote over them',
  ], changesIn: { ru: [
    '<b>ПОКАЗ на полке</b>: все альбомы или только пыльные, в плёнке, недослушанные, со стикером, ни разу не игранные, одно десятилетие или один жанр; НАУГАД выбирает из показанных',
    '<b>Альбомы слушаются альбомами</b>: начатый с первой песни и брошенный на середине получает закладку-ленточку на корешке и ПРОДОЛЖИТЬ &middot; ТРЕК n в коробке; дослушанный до конца &mdash; надпись &laquo;целиком &times;n&raquo; на задней обложке буклета',
    '<b>Перенесённые песни сохраняют историю</b>: музыка, переложенная в другую папку или на другой диск, находится снова, и ПЕРЕНЕСТИ ИСТОРИЮ переносит её прослушивания, пыль и ИСТОРИЮ',
    '<b>РЕЗЕРВНАЯ КОПИЯ</b> в Настройках &rarr; БИБЛИОТЕКА: очередь, история, прослушивания, заметки, темы и настройки в одном файле .cdbackup &mdash; для нового компьютера или после переустановки',
    '<b>ВЕРНУТЬ ИСХОДНЫЕ</b> в панели тегов: теги, которые были в файле до того, как CDPlayer впервые их переписал',
  ] } },
  { version: '2.17.3', changes: [
    '<b>The square video&rsquo;s lyrics</b> start below the song&rsquo;s name: a long title on two lines no longer runs the album line into them',
  ], changesIn: { ru: [
    '<b>Текст песни в квадратном видео</b> начинается ниже названия: длинное название в две строки больше не наезжает строкой альбома на текст',
  ] } },
  { version: '2.17.2', changes: [
    '<b>The phone remote pairs</b> when the code is opened from the camera (it showed THIS PHONE ISN&rsquo;T PAIRED)',
    '<b>AUTOMIX cuts the silence between an album&rsquo;s songs</b> played in order; songs that run into each other still do',
    '<b>The player shows the album&rsquo;s cover</b>, the one on the shelf, for a song with none in its file &mdash; not a single&rsquo;s found by its name',
    '<b>A remaster&rsquo;s songs take their places</b> in the album&rsquo;s whole tracklist, among the grey ones',
    '<b>Lyrics in time</b>: word-timed lyrics of another performance (a live one, another tempo) are no longer used',
  ], changesIn: { ru: [
    '<b>Пульт-телефон подключается</b>, когда код открыт из камеры (писал ЭТОТ ТЕЛЕФОН НЕ ПОДКЛЮЧЁН)',
    '<b>АВТОМИКС срезает тишину между песнями альбома</b>, играющего по порядку; песни, перетекающие друг в друга, перетекают по-прежнему',
    '<b>Плеер показывает обложку альбома</b>, как на полке, для песни без обложки в файле &mdash; а не сингла, найденного по названию',
    '<b>Песни ремастера встают на свои места</b> в полном треклисте альбома, среди серых',
    '<b>Текст в такт</b>: текст по словам от другого исполнения (концертного, в другом темпе) больше не берётся',
  ] } },
  { version: '2.17.1', changes: [
    '<b>A display like a CD deck&rsquo;s</b> under the seek bar: the track and time in glowing digits, PLAY / PAUSE / SHUFFLE / REPEAT lit; a click on the time counts down what&rsquo;s left (Settings &rarr; LOOK &rarr; DISPLAY: CLASSIC brings the old times back)',
    '<b>Several music folders</b>: FOLDER&hellip; &rarr; ADD ANOTHER FOLDER&hellip; puts an external drive on the shelf too; opening a song from Downloads no longer swaps the shelf',
    '<b>Shelf SORT &rarr; LAST PLAYED</b>, a list of every way to sort; <b>HISTORY by day</b>, 200 songs',
    '<b>Sleep at the end of the disc</b>: the sleep timer can stop once the album playing has ended',
    '<b>AUTOMIX</b>: Settings &rarr; TRANSITION &rarr; AUTOMIX (off unless you pick it) &mdash; when the queue moves on to a song that isn&rsquo;t its album&rsquo;s next (shuffle, another album, the changer&rsquo;s next disc), it comes in where this one winds down instead of after its silence; an album played in order stays gapless',
    '<b>TRANSITION</b>: OFF, AUTOMIX or CROSSFADE from one menu; CROSSFADE&rsquo;s length shows only with it',
    '<b>No clipping while two songs overlap</b> under AUTOMIX or CROSSFADE',
  ], changesIn: { ru: [
    '<b>Дисплей как у CD-деки</b> под полосой перемотки: трек и время светящимися цифрами, PLAY / PAUSE / SHUFFLE / REPEAT горят; нажатие на время показывает, сколько осталось (Настройки &rarr; ВИД &rarr; ДИСПЛЕЙ: ОБЫЧНЫЙ возвращает прежнее время)',
    '<b>Несколько папок с музыкой</b>: ПАПКА&hellip; &rarr; ДОБАВИТЬ ЕЩЁ ПАПКУ&hellip; ставит на полку и внешний диск; песня, открытая из Загрузок, больше не подменяет полку',
    '<b>Сортировка полки &rarr; НЕДАВНО ИГРАЛИ</b>, список всех способов сортировки; <b>ИСТОРИЯ по дням</b>, 200 песен',
    '<b>Сон в конце диска</b>: таймер сна может остановить музыку, когда альбом доиграл',
    '<b>АВТОМИКС</b>: Настройки &rarr; ПЕРЕХОД &rarr; АВТОМИКС (выключен, пока не выберешь) &mdash; когда очередь переходит к песне, которая не следующая в своём альбоме (перемешивание, другой альбом, следующий диск чейнджера), она вступает там, где эта затихает, а не после её тишины; альбом по порядку по-прежнему играет без пауз',
    '<b>ПЕРЕХОД</b>: ВЫКЛ, АВТОМИКС или КРОССФЕЙД в одном меню; длина КРОССФЕЙДА видна только с ним',
    '<b>Без перегрузки, пока две песни звучат вместе</b> в АВТОМИКСЕ и КРОССФЕЙДЕ',
  ] } },
  { version: '2.16.0', changes: [
    '<b>A phone remote</b>: Settings &rarr; PHONE REMOTE, scan the code with your phone&rsquo;s camera &mdash; play, pause, skip, volume, the shelf and the queue from the phone&rsquo;s browser, on the same Wi-Fi, nothing to install',
    '<b>Hidden tracks</b>: a song hidden after minutes of silence at the end of an album is found &mdash; the silence counts down, the song is named when it starts and written into the booklet',
    '<b>Lighter on a computer without graphics acceleration</b> (a virtual machine): about half the processor, and on Windows the CD helper runs only while there&rsquo;s a disc in a drive',
    '<b>AUTO&rsquo;s colour from the whole cover</b>: In Rainbows no longer turns the player blue',
    '<b>YOUTUBE MUSIC</b> on a missing album&rsquo;s case, and the player&rsquo;s window comes back by itself if its page crashes',
  ], changesIn: { ru: [
    '<b>Пульт с телефона</b>: Настройки &rarr; ПУЛЬТ-ТЕЛЕФОН, отсканируй код камерой телефона &mdash; пауза, переключение, громкость, полка и очередь из браузера телефона, в той же сети Wi-Fi, ничего не устанавливая',
    '<b>Скрытые треки</b>: песня, спрятанная после минут тишины в конце альбома, находится &mdash; тишина отсчитывается, песня называется, когда начинается, и вписывается в буклет',
    '<b>Легче на компьютере без ускорения графики</b> (в виртуальной машине): примерно вдвое меньше нагрузки, а в Windows помощник для CD работает, только пока в приводе есть диск',
    '<b>Цвет AUTO по всей обложке</b>: In Rainbows больше не красит плеер в синий',
    '<b>YOUTUBE MUSIC</b> на коробке недостающего альбома, а окно плеера само возвращается, если его страница упала',
  ] } },
  { version: '2.15.1', changes: [
    '<b>The guide&rsquo;s buttons work with the mouse</b>: NEXT, BACK, SKIP and SHOW THEM took no clicks &mdash; only the keys moved the guide on',
    '<b>No gap inside an album of mixed sample rates</b>: under HI-RES LOSSLESS, an album with 44.1 and 96 kHz songs plays through at 96 instead of stopping between them',
    '<b>A folder dropped in plays in album order</b>, by its songs&rsquo; track numbers &mdash; not alphabetically when the file names have no numbers',
  ], changesIn: { ru: [
    '<b>Кнопки гида нажимаются мышью</b>: ДАЛЕЕ, НАЗАД, ПРОПУСТИТЬ и ПОКАЗАТЬ ФИШКИ не реагировали на клики &mdash; гид листался только клавишами',
    '<b>Без пауз внутри альбома с разной частотой</b>: в HI-RES LOSSLESS альбом с песнями в 44,1 и 96 кГц играет целиком на 96, не останавливаясь между ними',
    '<b>Перетащенная папка играет в порядке альбома</b>, по номерам треков &mdash; а не по алфавиту, когда в именах файлов нет номеров',
  ] } },
  { version: '2.15.0', changes: [
    '<b>The CD changer</b>: Settings &rarr; PLAYBACK &rarr; CD CHANGER &mdash; five discs in a carousel instead of the queue; D skips a disc, 1&ndash;5 play a slot, songs added one at a time go on a home-made CD-R. The queue and the changer each keep their own music',
    '<b>Gapless playback</b>: an album whose songs run into each other plays on with no gap between its tracks',
    '<b>ABOUT THE ALBUM</b> in the booklet: the album&rsquo;s story from Wikipedia, in your language',
    '<b>A guide round the window</b> the first time, and <b>WHAT&rsquo;S SPECIAL</b> under Settings &rarr; HELP: dust, wear, the albums you&rsquo;re missing, what yours are worth, with SHOW ME',
    '<b>SEARCH by artist, album or song</b> (press /), smoother motion everywhere, and many fixes from people trying it for the first time',
  ], changesIn: { ru: [
    '<b>Чейнджер</b>: Настройки &rarr; ВОСПРОИЗВЕДЕНИЕ &rarr; ЧЕЙНДЖЕР &mdash; пять дисков в карусели вместо очереди; D &mdash; следующий диск, 1&ndash;5 &mdash; диск из гнезда, песни по одной ложатся на самодельный CD-R. У очереди и чейнджера своя музыка',
    '<b>Без пауз между треками</b>: альбом, где песни перетекают одна в другую, играет непрерывно',
    '<b>ОБ АЛЬБОМЕ</b> в буклете: история альбома из Википедии на твоём языке',
    '<b>Гид по окну</b> при первом запуске и <b>ФИШКИ ПЛЕЕРА</b> в Настройки &rarr; ПОМОЩЬ: пыль, износ, недостающие альбомы, цены &mdash; с кнопкой ПОКАЗАТЬ',
    '<b>ПОИСК по исполнителю, альбому и песне</b> (клавиша /), плавные анимации и много исправлений по отзывам новичков',
  ] } },
  { version: '2.14.0', changes: [
    '<b>Sound Check</b>: Settings &rarr; SOUND CHECK &mdash; every song at the same loudness, from its ReplayGain tags or measured once; ALBUM keeps an album&rsquo;s own quiet and loud songs. SC under the title shows the gain',
    '<b>The shelf keeps up with your music folder</b>: an album ripped, copied in or removed turns up on the open shelf, or goes, by itself &mdash; no need to close it and open it again',
  ] },
  { version: '2.13.3', changes: [
    '<b>The card&rsquo;s video runs as long as the lines you picked</b>: it starts where the first one is sung and ends with the last &mdash; the line being sung, if you didn&rsquo;t pick any',
    '<b>The video&rsquo;s lyrics glide</b> from line to line, and keep up with the song',
    '<b>Hi-res songs record with sound</b>: a video of a 96 or 192 kHz song came out empty, or a second long and silent',
  ] },
  { version: '2.13.2', changes: [
    '<b>The version you have</b> is at the bottom of Settings',
    '<b>Updating is sturdier</b>: a download that stalls is given up instead of hanging, RESTART TO UPDATE can&rsquo;t be set off twice, and a CDPlayer kept in a protected folder is offered the download instead of an update that couldn&rsquo;t succeed',
  ] },
  { version: '2.13.1', changes: [
    '<b>Updating from inside the app works on Windows</b>: RESTART TO UPDATE closed CDPlayer and nothing came back &mdash; now the new version is put in place and opens, as on Mac and Linux',
  ] },
  { version: '2.13.0', changes: [
    '<b>Updates from inside the app</b>: from now on, when a new version is out, click its button in the top-left corner to download it, then RESTART TO UPDATE &mdash; no more fetching it from GitHub by hand',
    '<b>Discogs prices on the case</b>: the receipt behind the cover, the obi and the price sticker show what the album goes for on Discogs, once it&rsquo;s known',
    '<b>Two new switches</b> in Settings &rarr; LOOK: DISC SHINE turns off the rainbow reflection that follows your mouse, and DISC ICON puts the disc that&rsquo;s in on the Dock or taskbar icon, or CDPlayer&rsquo;s own &mdash; on Windows too now',
  ] },
  { version: '2.12.0', changes: [
    '<b>Spatial audio</b>: Settings &rarr; SPATIAL AUDIO &mdash; on headphones, music comes from two speakers in front of you instead of from inside your head, on files and CDs alike; SPACE sets how much',
    '<b>Sound quality, as in Apple Music</b>: Settings &rarr; QUALITY &mdash; LOSSLESS and HI-RES LOSSLESS play each song at its own sample rate, up to 192 kHz, with your output switched to match on Mac and Windows and put back when CDPlayer closes',
    '<b>A LOSSLESS badge</b> under the title says, when you point at it, exactly what reaches your headphones',
  ] },
  { version: '2.11.0', changes: [
    '<b>Discogs for collectors</b>: a pulled-out case shows its exact pressing and its lowest price on Discogs; <b>APPRAISE</b> values the whole shelf, <b>SORT: PRICE</b> stands it dearest first, and rare albums get a gold sticker',
    '<b>Themes of your own</b>: Settings &rarr; THEME &rarr; + NEW THEME &mdash; six colors, a scene and a picture behind the player; share one as a file or a one-line code',
    '<b>CDPlayer in Russian</b>: Settings &rarr; LANGUAGE (AUTO follows your system) &mdash; and any other language can be added as one file',
    '<b>The Now Playing card as a video</b>: eight seconds of the disc turning, the lyrics as they&rsquo;re sung and the song itself, for Stories or chats',
    '<b>Spotify set up in four steps</b>, with the keys checked and what&rsquo;s wrong explained; <b>OUTPUT</b> picks your speakers or AirPods; <b>CHECK</b> on the shelf finds untagged songs, missing covers and duplicates',
  ] },
  { version: '2.10.0', changes: [
    '<b>The shelf comes alive</b>: albums you leave alone gather dust (rub a spine to wipe it), new ones come shrink-wrapped, cases carry a sticky note and the shop&rsquo;s receipt, and SORT now goes round the rainbow by colour',
    '<b>Missing albums</b>: sorted by artist, each artist&rsquo;s studio albums you don&rsquo;t have stand as see-through places &mdash; and a case lists the songs you don&rsquo;t have in grey',
    '<b>A disc that&rsquo;s yours</b>: turn it by hand like a jog wheel, turn it over (B) to its tracks and the laser, and watch it wear with play; the booklet gets marked in pen',
    '<b>Share what&rsquo;s playing</b> (P) as a card with lines of its lyrics, and <b>PLAY NEXT</b> for songs straight after this one',
    '<b>New here?</b> A short guide, a FAQ and every shortcut (?) are in Settings &rarr; HELP &mdash; and a shelf of thousands of albums scrolls smoothly',
  ] },
  { version: '2.9.2', changes: [
    '<b>Spotify on Windows plays</b>: pressing play on a Spotify disc no longer ends in &ldquo;couldn&rsquo;t reach Spotify&rdquo; &mdash; and if Spotify still won&rsquo;t play, SHOW LOG in SPOTIFY opens a log of what happened',
    '<b>Sign in with the right account</b>: CONNECT SPOTIFY now always asks which Spotify account, with &ldquo;Not you?&rdquo; to switch',
    '<b>Lighter on your computer</b>: paused, CDPlayer now uses about a fifth of the processor it did, and much less while you&rsquo;re in another app',
  ] },
  { version: '2.9.1', changes: [
    '<b>Spotify on Windows</b>: CDPlayer couldn&rsquo;t reach Spotify on PCs whose antivirus checks secure connections, or behind a proxy &mdash; it now connects the way your browser does. Covers, lyrics and update checks there are fixed too',
    'If Spotify still can&rsquo;t be reached, CDPlayer now says why',
    'In the Spotify setup, click the Redirect URI to copy it',
  ] },
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
/** Settings → WHAT'S NEW: every version's changes, the newest first, in the interface's language where they're written in it. */
export function showWhatsNew(app) {
  const changesOf = (c) => (c.changesIn && c.changesIn[locale]) || c.changes;
  openPanel('changelog', () => [title(t("WHAT'S NEW")), el('div', { class: 'subtitle' }, `CDPlayer ${app.state.version}`), gap(14),
    el('div', { class: 'scroll changelog-list' }, CHANGELOG.map((c) => el('div', { class: 'changelog-version' },
      el('div', { class: 'changelog-number' }, c.version),
      changesOf(c).map((b) => el('div', { class: 'tip-row' }, el('span', { class: 'dot' }, '●'), el('span', { class: 'tip', html: b })))))),
    closeRow(() => closePanel('changelog'), t('CLOSE'))]);
}
export function showChangelogIfNeeded(app, lastVersion, existingInstall) {
  const version = app.state.version;
  if (lastVersion === version) return;
  if (!lastVersion && !existingInstall) { app.cdp.writeLastVersion(version); return; } // fresh install: nothing is "new"
  // Just this release's new features — not everything since whichever version this user last ran, which could be a
  // wall of notes for someone coming from the Java app or skipping releases.
  const entry = CHANGELOG.find((c) => c.version === version);
  // (An entry can have its words in the interface's language too: changesIn.ru, …)
  const changes = entry ? (entry.changesIn && entry.changesIn[locale]) || entry.changes : [];
  if (!changes.length) { app.cdp.writeLastVersion(version); return; }
  const p = openPanel('changelog', () => tipsCard(t("WHAT'S NEW"), `CDPlayer ${version}`, changes, () => closePanel('changelog')));
  p.onClose = () => app.cdp.writeLastVersion(version);
}

// ---- The changer, full: which disc goes back to the shelf ----------------------------------------------------------

/** All five slots hold unfinished discs: which one goes back to the shelf? → its slot, or null (Esc / CLOSE). Not the playing one. */
export function pickDiscToTakeOut(app, c) {
  return new Promise((resolve) => {
    let chosen = null;
    const here = app.changerSlotOf(c.index);
    const p = openPanel('changer-full', () => [
      title(t('THE CHANGER IS FULL')), el('div', { class: 'subtitle' }, t('Which disc goes back to the shelf?')),
      el('div', { class: 'changer-pick' }, c.slots.map((d, s) => {
        const b = el('button', { class: 'changer-pick-disc', disabled: s === here, title: s === here ? t('Playing') : t('Take it out') }, el('div', { class: 'changer-pick-art' }), el('div', { class: 'name' }, `${s + 1}. ${app.discLabel(d)}`), d.artist ? el('div', { class: 'by' }, d.artist) : null);
        b.addEventListener('click', () => { chosen = s; closePanel('changer-full'); });
        app.coverForPath(c.queue[d.start]).then((src) => { if (src) b.firstChild.style.backgroundImage = `url("${src}")`; });
        return b;
      })),
      closeRow(() => closePanel('changer-full'), t('CANCEL')),
    ], { width: 560 });
    p.onClose = () => resolve(chosen);
  });
}
