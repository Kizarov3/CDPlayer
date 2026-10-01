// The CD shelf (S, or SHELF): every album in your music folder as a jewel case standing on a shelf, spine out — the
// spine in the colours of its cover, a double album twice as thick. Click one and the case slides out and turns to
// show its front: the cover, the tracklist, and PLAY, which puts it in the player (the tray comes out, the disc goes
// in, the tray closes and it plays). Click the case's cover and the album's booklet lifts out of it. Or pick a spine up
// and carry it out: the shelf fades so the player shows through, and it goes in on the disc or at the end of the queue
// (with ⇧ held, to play next). An album left unplayed gathers dust (shelf-dust.js): rub the mouse over its spine to
// wipe it. PULL ONE takes one off the shelf at random, the dustier the likelier. A case can have a sticky note on it
// (shelf-notes.js), whose corner shows above its spine. A new album comes in shrink-wrap until it's played or
// unwrapped by hand, dragging the film off its case.
import { el, pill, anim } from './widgets.js';
import { openBooklet, closeBooklet, albumBooklet, isBookletOpen } from './booklet.js';
import { stickersFor } from './shelf-stickers.js';
import { arrange, SORTS, matchesFilter, dominantColor, jumpTargets } from './shelf-order.js';
import { pressingLine, marketLine, money, isRare, shelfTotal } from './shelf-discogs.js';
import { hash } from './disc-wear.js';
import { stickyNote, noteLook } from './shelf-notes.js';
import { receiptFor } from './shelf-receipt.js';
import { withMissing, boxLabel, sameName, boxesFor, renderGate, groupOf, pickEdition, fullTracklist } from './shelf-missing.js';
import { dustLevel, pickOne, Wiper } from './shelf-dust.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const shelf = { open: false, albums: [], loading: false, covers: new Map(), colors: new Map(), observer: null, caseOpen: null, app: null, generation: 0, inPlayer: null,
  discogs: new Map(), openBoxes: new Set(), pressings: new Map(), appraising: null, appraisalNote: null, countBase: '', settings: null, noCover: new Set(), colorCache: {}, hidden: new Set(), boxObserver: null, wantTimer: null, onScreen: new Set() };

export const isShelfOpen = () => shelf.open;
// Discographies arriving redraw the shelf — once for a burst, and not while a case is out, a spine is carried or one
// is about to be pulled out (a redraw would take the shelf out from under them).
const redraw = renderGate({ render: () => { if (shelf.open) render(); }, busy: () => !!shelf.caseOpen || shelf.pulling || $('shelf').classList.contains('carrying') });

// The album whose disc is in the player (a track of it loaded, playing or paused) stands a little proud of the others,
// lit in the theme's colour.
const IN_PLAYER = t('IN THE PLAYER');
const SORT_LABELS = { ARTIST: t('ARTIST'), NEW: t('NEW|sort'), PLAYED: t('MOST PLAYED'), YEAR: t('YEAR'), COLOR: t('COLOR'), PRICE: t('PRICE') };
const holds = (a, path) => !!path && a.tracks.some((t) => t.path === path);
const spineTitle = (a) => [a.artist, a.title, a.year, holds(a, shelf.inPlayer) ? IN_PLAYER : null].filter(Boolean).join(' · ') + (a.note ? `\n\n${a.note}` : '');
/** The track now in the player (null: none), so its album's spine can show it. */
export function showInPlayer(path) {
  shelf.inPlayer = path || null;
  for (const spine of document.querySelectorAll('#shelf-body .spine')) {
    if (!spine.album) continue; // a missing album's place
    spine.classList.toggle('in-player', holds(spine.album, shelf.inPlayer));
    spine.title = spineTitle(spine.album);
  }
  if (shelf.open) showHere();
}

export async function openShelf(app) {
  if (shelf.open) return;
  shelf.app = app;
  shelf.open = true;
  const root = $('shelf');
  root.hidden = false;
  if (anim.enabled) root.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
  $('shelf-filter').value = '';
  await load();
}

export function closeShelf() {
  if (!shelf.open) return;
  closeBooklet(); // an album's booklet, open over its case
  closeCase(true);
  shelf.open = false;
  shelf.openBoxes.clear();
  stopLookups();
  const root = $('shelf');
  if (anim.enabled) root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).onfinish = () => { if (!shelf.open) root.hidden = true; };
  else root.hidden = true;
}

/** Esc: the open case first, then the shelf. → true when something closed. */
export function escapeShelf() {
  if (shelf.caseOpen) { closeCase(); return true; }
  if (shelf.open) { closeShelf(); return true; }
  return false;
}

export function setupShelf(app) {
  shelf.app = app;
  $('shelf-close').addEventListener('click', closeShelf);
  $('shelf-folder').addEventListener('click', pickFolder);
  $('shelf-pull').addEventListener('click', pullOne);
  $('shelf-here').addEventListener('click', goToPlayer);
  $('shelf-check').addEventListener('click', () => shelf.app.libraryCheck());
  $('shelf-filter').addEventListener('input', render);
  $('shelf-sort').addEventListener('click', () => {
    const { state } = shelf.app;
    shelf.app.setShelfSort(SORTS[(SORTS.indexOf(state.shelfSort) + 1) % SORTS.length]);
    if (state.shelfSort === 'PRICE' && !shelf.appraised && !(shelf.appraising && !shelf.appraising.finished)) appraise();
    render();
    $('shelf-body').scrollTop = 0;
  });
  app.cdp.onDiscography(({ key, state, groups }) => {
    shelf.discogs.set(key, { state, groups });
    if (shelf.open && shelf.app.state.shelfSort === 'ARTIST') redraw.request();
  });
  $('shelf-appraise').addEventListener('click', () => { if (shelf.appraising && !shelf.appraising.finished) app.cdp.discogsStop(); else appraise(); });
  // Each album as the appraisal reaches it: its spine (and the shelf, sorted by price) brought up to date.
  app.cdp.onDiscogsProgress((p) => {
    shelf.pressings.set(p.albumId, p.entry);
    attachPressings();
    // (the last of these can arrive after the appraisal's own answer: it mustn't make a finished one look running)
    if (!shelf.appraising || !shelf.appraising.finished) { shelf.appraising = { done: p.done, total: p.total }; updateAppraiseCount(); }
    if (shelf.open && shelf.app.state.shelfSort === 'PRICE') redraw.request(); else markSpine(p.albumId);
  });
  app.cdp.onShelfProgress(({ done, total }) => { if (shelf.loading) $('shelf-count').textContent = t('READING YOUR MUSIC · {done} / {total}', { done, total }); });
}

async function pickFolder() {
  const folder = await shelf.app.cdp.pickMusicFolder();
  if (folder) await load();
}

async function load() {
  const generation = ++shelf.generation;
  shelf.loading = true;
  $('shelf-count').textContent = t('READING YOUR MUSIC…');
  $('shelf-body').replaceChildren();
  let result;
  try { result = await shelf.app.cdp.shelfAlbums(); } catch { result = { folder: null, albums: [], error: true }; }
  if (generation !== shelf.generation) return;
  shelf.loading = false;
  shelf.albums = result.albums;
  // Colours worked out before: spines in them at once, and a colour-sorted shelf ready.
  shelf.colorCache = await shelf.app.cdp.shelfColors().catch(() => ({})) || {};
  for (const a of shelf.albums) {
    const c = shelf.colorCache[a.id];
    if (c) { shelf.colors.set(a.id, c.spine); a.color = c.main; }
  }
  // What Discogs said before: pressings and prices at once, for SORT: PRICE and the spines' gold dots.
  const known = await shelf.app.cdp.discogsKnown(shelf.albums.map((a) => a.id)).catch(() => ({})) || {};
  shelf.pressings = new Map(Object.entries(known));
  attachPressings();
  shelf.settings = await shelf.app.cdp.discogsSettings().catch(() => null);
  shelf.appraisalNote = totalNote();
  shelf.hidden = new Set(result.hiddenMissing || []);
  shelf.folderName = result.name || null;
  render();
}

function render() {
  const body = $('shelf-body');
  if (shelf.observer) shelf.observer.disconnect();
  if (!shelf.folderName) {
    $('shelf-count').textContent = '';
    body.replaceChildren(el('div', { class: 'shelf-empty' },
      el('div', {}, t('Which folder is your music in?')),
      pill(t('CHOOSE YOUR MUSIC FOLDER…'), pickFolder)));
    return;
  }
  const query = $('shelf-filter').value, filtering = !!query.trim();
  const shown = shelf.albums.filter((a) => matchesFilter(a, query));
  const n = shelf.albums.length;
  shelf.countBase = [shelf.folderName.toUpperCase(), n === 1 ? t('1 ALBUM') : t('{n} ALBUMS', { n }), filtering ? t('{n} SHOWN', { n: shown.length }) : null].filter(Boolean).join(' · ');
  renderCount();
  if (!n) { body.replaceChildren(el('div', { class: 'shelf-empty' }, el('div', {}, t('No music in this folder yet.')), pill(t('CHOOSE ANOTHER FOLDER…'), pickFolder))); return; }
  shelf.observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { shelf.observer.unobserve(e.target); loadCover(e.target.album, e.target); }
  }, { root: body, rootMargin: '200px' });
  const now = Date.now(), sort = shelf.app.state.shelfSort;
  $('shelf-sort').textContent = t('SORT: {how}', { how: SORT_LABELS[sort] || sort });
  if (sort === 'COLOR') { if (shelf.fillCount) shelf.fillCount(); fillColors(shown); }
  shelf.shown = shown;
  if (shelf.boxObserver) shelf.boxObserver.disconnect();
  shelf.onScreen.clear();
  if (sort !== 'ARTIST') stopLookups();
  const boxes = sort === 'ARTIST' ? boxesFor({ albums: shelf.albums, shown, discogs: shelf.discogs, hidden: shelf.hidden, open: shelf.openBoxes, query }) : new Map();
  const arranged = arrange(shown, sort);
  showIndex(jumpTargets(arranged));
  showHere();
  const items = withMissing(arranged, boxes).map((a) => {
    if (a.box) return boxCard(a.box);
    if (a.ghost) return ghostSpine(a.ghost, a.artist);
    if (a.divider) return el('div', { class: `shelf-divider${[...a.divider].length <= 2 ? ' short' : ''}`, 'aria-hidden': 'true', 'data-section': a.divider }, el('span', {}, a.divider));
    const st = a.stickers = stickersFor(a, now);
    const spine = el('button', { class: `spine${a.discs > 1 ? ' double' : ''}${st.obi ? ' obi' : ''}${st.isNew ? ' new' : ''}${holds(a, shelf.inPlayer) ? ' in-player' : ''}${isRare(a.pressing) ? ' rare' : ''}`, title: spineTitle(a), onClick: () => { if (!shelf.dragged) openCase(a, spine); } },
      el('span', { class: 'spine-text' }, a.artist ? el('b', {}, a.artist) : null, a.artist ? ' · ' : null, a.title),
      st.obi ? el('span', { class: 'obi-cat' }, st.obi.catalog) : null,
      st.isNew ? el('span', { class: 'sticker-new' }, t('NEW')) : null,
      a.wrapped ? el('span', { class: 'spine-film' }) : null);
    spine.album = a;
    showNoteTab(spine);
    spine.addEventListener('pointerdown', (e) => pressSpine(e, spine));
    spine.addEventListener('pointermove', (e) => rubSpine(e, spine));
    spine.addEventListener('pointerleave', () => { spine.wiper = null; });
    setDust(spine, st.isNew ? 0 : dustLevel(a.touched, now)); // a new album is fresh from the shop
    paintSpine(spine, a);
    shelf.observer.observe(spine);
    return spine;
  });
  body.replaceChildren(el('div', { class: 'shelf-rows' }, items));
}

// A spine before its cover has loaded gets a colour of its own from its name, so the shelf never looks blank.
function hashColor(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return [40 + (h % 60), 40 + ((h >> 8) % 60), 50 + ((h >> 16) % 60)];
}
function paintSpine(spine, a) {
  // Sorted by colour, a spine wears its cover's main colour, so the shelf reads as a rainbow; otherwise its average.
  const byColor = shelf.app && shelf.app.state.shelfSort === 'COLOR' && a.color;
  const c = byColor ? a.color : shelf.colors.get(a.id) || hashColor(a.title + a.artist);
  const light = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150;
  spine.style.setProperty('--spine', `${c[0]}, ${c[1]}, ${c[2]}`);
  spine.style.setProperty('--ink', light ? '20, 20, 24' : '240, 240, 244');
}

// The cover's average colour, for the spine, from its pixels (RGBA).
function averageOf(d) {
  let r = 0, gr = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return [Math.round(r / n), Math.round(gr / n), Math.round(b / n)];
}

async function coverFor(a, { online = true } = {}) {
  if (shelf.covers.has(a.id)) return shelf.covers.get(a.id);
  const url = await shelf.app.cdp.shelfCover(a.tracks[0].path, { online }).catch(() => null);
  if (url || online) shelf.covers.set(a.id, url); // nothing on this computer: the web may still have one
  return url;
}
async function loadCover(a, spine) {
  const url = await coverFor(a);
  if (url) await colorsFor(a, url);
  if (shelf.colors.has(a.id)) paintSpine(spine, a);
}
// An album's colours from its cover — the spine's (its average) and the one it's filed under by colour (its most
// common vivid one) — worked out once per cover and kept (shelf-colors.json).
// One small canvas kept in the CPU's memory for all of them (reading pixels back off the GPU, per spine, made the
// shelf stutter as it scrolled).
let pixelCanvas = null;
async function colorsFor(a, url) {
  const key = hash(url), known = shelf.colorCache[a.id];
  if (known && known.key === key) return;
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { shelf.noCover.add(a.id); return; } // an unreadable cover: filed with B&W
  if (!pixelCanvas) pixelCanvas = new OffscreenCanvas(16, 16);
  const g = pixelCanvas.getContext('2d', { willReadFrequently: true });
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  g.clearRect(0, 0, 16, 16);
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 16, 16);
  const pixels = g.getImageData(0, 0, 16, 16).data;
  const main = dominantColor(pixels), spine = averageOf(pixels);
  shelf.colors.set(a.id, spine);
  a.color = main;
  shelf.colorCache[a.id] = { key, spine, main };
  clearTimeout(shelf.colorsTimer);
  shelf.colorsTimer = setTimeout(() => shelf.app.cdp.saveShelfColors(shelf.colorCache).catch(() => {}), 1000);
}
// SORT: COLOR needs every album's colour, not only those whose spines have been on screen: the rest are worked out
// now, with the count in the header, and the shelf stands in rainbow order once they're all in.
async function fillColors(shown) {
  if (shelf.filling) return;
  const todo = shown.filter((a) => !a.color && !shelf.noCover.has(a.id));
  if (!todo.length) return;
  shelf.filling = true;
  const generation = shelf.generation;
  let done = 0;
  const count = () => { $('shelf-count').textContent = t('SORTING BY COLOR · {done} / {total}', { done, total: todo.length }); };
  shelf.fillCount = count; // a redraw meanwhile shows it again
  count();
  // Four at a time, and only covers on this computer (not a web lookup for every album in the library).
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (generation !== shelf.generation || !shelf.open || shelf.app.state.shelfSort !== 'COLOR') return;
      const a = todo[next++];
      const url = await coverFor(a, { online: false });
      if (url) await colorsFor(a, url); else shelf.noCover.add(a.id);
      done++; count();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const a of todo) if (!a.color && generation === shelf.generation) shelf.noCover.add(a.id); // never asked about again: no loop
  shelf.filling = false;
  shelf.fillCount = null;
  if (generation === shelf.generation && shelf.open && shelf.app.state.shelfSort === 'COLOR') redraw.request();
}

// ---- A spine carried off the shelf, onto the disc or the queue ---------------------------------------------------

const DRAG_START_PX = 6;
function pressSpine(e, spine) {
  if (e.button !== 0 || shelf.caseOpen) return;
  const start = { x: e.clientX, y: e.clientY };
  let drag = null;
  shelf.dragged = false;
  const move = (ev) => {
    if (!drag && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > DRAG_START_PX) drag = pickUp(spine, start);
    if (drag) carry(drag, ev.clientX, ev.clientY);
  };
  // Followed on the window, wherever the pointer goes while the spine is carried.
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!drag) return;
    shelf.dragged = true; // the click that follows isn't "open the case"
    setTimeout(() => { shelf.dragged = false; }, 0);
    putDown(drag, ev.type === 'pointerup' ? targetAt(ev.clientX, ev.clientY) : null, ev.shiftKey);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
function pickUp(spine, start) {
  const r = spine.getBoundingClientRect();
  const ghost = spine.cloneNode(true);
  ghost.classList.add('spine-ghost');
  ghost.classList.remove('in-player');
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(ghost);
  spine.classList.add('lifted');
  $('shelf').classList.add('carrying');
  return { spine, ghost, from: r, grab: { x: start.x - r.left, y: start.y - r.top }, target: null };
}
// Where a spine let go at (x, y) would go: the disc (in its case) or the queue.
function targetAt(x, y) {
  const c = shelf.app.disc.center;
  if (c && !shelf.app.state.miniMode && Math.abs(x - c.x) <= c.r + 30 && Math.abs(y - c.y) <= c.r + 30) return 'disc';
  const q = $('queue-card').getBoundingClientRect();
  if (q.width && x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return 'queue';
  return null;
}
function carry(drag, x, y) {
  drag.ghost.style.transform = `translate(${x - drag.grab.x - drag.from.left}px, ${y - drag.grab.y - drag.from.top}px) rotate(-6deg)`;
  const target = targetAt(x, y);
  if (target === drag.target) return;
  drag.target = target;
  showDropTarget(target);
}
// A ring round the disc, or an outline round the queue, while a spine is over it.
function showDropTarget(target) {
  let ring = $('drop-ring');
  if (!ring) { ring = el('div', { id: 'drop-ring' }); document.body.append(ring); }
  ring.hidden = !target;
  if (!target) return;
  if (target === 'disc') {
    const c = shelf.app.disc.center;
    Object.assign(ring.style, { left: `${c.x - c.r - 6}px`, top: `${c.y - c.r - 6}px`, width: `${2 * c.r + 12}px`, height: `${2 * c.r + 12}px`, borderRadius: '50%' });
  } else {
    const q = $('queue-card').getBoundingClientRect();
    Object.assign(ring.style, { left: `${q.left - 6}px`, top: `${q.top - 6}px`, width: `${q.width + 12}px`, height: `${q.height + 12}px`, borderRadius: '10px' });
  }
}
function putDown(drag, target, next = false) {
  const { spine, ghost } = drag;
  const a = spine.album;
  showDropTarget(null);
  const back = () => { ghost.remove(); spine.classList.remove('lifted'); $('shelf').classList.remove('carrying'); };
  if (target === 'disc') { back(); play(a, 0); return; }
  if (target === 'queue') { back(); shelf.app[next ? 'playNext' : 'addToQueue'](a.tracks.map((t) => t.path), { sorted: true }); return; } // ⇧: to play next
  // Let go anywhere else: it goes back in its place on the shelf.
  if (!anim.enabled) { back(); return; }
  ghost.animate([{ transform: ghost.style.transform }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.3,.7,.3,1)' }).onfinish = back;
}

// ---- Getting about: the index down the side, and the album in the player -----------------------------------------

// A button for each section (letter, month, decade, colour…) down the shelf's right edge; click one to go to it.
function showIndex(targets) {
  const index = $('shelf-index');
  index.hidden = targets.length < 2;
  index.replaceChildren(...targets.map(({ label, short }) => el('button', { title: label, onClick: () => {
    const card = $('shelf-body').querySelector(`[data-section="${CSS.escape(label)}"]`);
    if (card) card.scrollIntoView({ block: 'start', behavior: anim.enabled ? 'smooth' : 'auto' });
  } }, short)));
}
// ⌖ IN THE PLAYER: shown while the album whose disc is in is on the shelf as it stands; goes to it, and it waves.
function showHere() {
  $('shelf-here').hidden = !(shelf.inPlayer && (shelf.shown || []).some((a) => holds(a, shelf.inPlayer)));
}
function goToPlayer() {
  const spine = [...document.querySelectorAll('#shelf-body .spine')].find((s) => s.album && holds(s.album, shelf.inPlayer));
  if (!spine) return;
  spine.scrollIntoView({ block: 'center', inline: 'nearest', behavior: anim.enabled ? 'smooth' : 'auto' });
  if (anim.enabled) setTimeout(() => spine.animate([{ transform: 'translateY(-12px)' }, { transform: 'translateY(-26px)' }, { transform: 'translateY(-12px)' }], { duration: 420, easing: 'ease-in-out' }), 350);
}

// ---- Missing albums (shelf-missing.js) -------------------------------------------------------------------------

function boxCard(box) {
  const card = el('button', { class: `missing-box${box.state === 'found' && !box.missing.length ? ' complete' : ''}${box.open ? ' open' : ''}`,
    title: box.state !== 'found' ? t('Looking up {artist} on MusicBrainz…', { artist: box.artist }) : box.missing.length ? (box.open ? t('{artist}: releases you don’t have — click to close', { artist: box.artist }) : t('{artist}: releases you don’t have — click to show them', { artist: box.artist })) : t('You have everything {artist} has released', { artist: box.artist }),
    onClick: () => {
      if (box.state !== 'found' || !box.missing.length) return;
      if (shelf.openBoxes.has(box.key)) shelf.openBoxes.delete(box.key); else shelf.openBoxes.add(box.key);
      render();
    } }, el('span', {}, boxLabel(box)));
  card.box = box;
  if (box.state === 'loading') watchBox(card);
  return card;
}
// No more looking up discographies (the shelf closed, or isn't by artist): whoever was waiting is dropped.
function stopLookups() {
  clearTimeout(shelf.wantTimer);
  if (!shelf.asking) return;
  shelf.asking = false;
  shelf.app.cdp.wantDiscography([]).catch(() => {});
}
// A box that's waiting: once it's on screen, MusicBrainz is asked about its artist (a moment after scrolling stops).
function watchBox(card) {
  if (!shelf.boxObserver) {
    shelf.boxObserver = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) shelf.onScreen.add(e.target.box); else shelf.onScreen.delete(e.target.box); }
      clearTimeout(shelf.wantTimer);
      shelf.wantTimer = setTimeout(() => {
        shelf.asking = shelf.onScreen.size > 0;
        shelf.app.cdp.wantDiscography([...shelf.onScreen].map((b) => ({ artist: b.artist, mbid: b.mbid }))).catch(() => {});
      }, 250);
    }, { root: $('shelf-body'), rootMargin: '200px' });
  }
  shelf.boxObserver.observe(card);
}
function ghostSpine(group, artist) {
  const spine = el('button', { class: 'spine ghost', title: [artist, group.title, group.year].filter(Boolean).join(' · '),
    onClick: () => openGhostCase(group, artist, spine) },
    el('span', { class: 'spine-text' }, group.title, group.year ? ` · ${group.year}` : ''));
  spine.ghost = group;
  return spine;
}
// A missing album's ghost case: see-through, its cover from the Cover Art Archive and its tracklist from MusicBrainz,
// to play on Spotify (when connected), look up on MusicBrainz, or never see again.
async function openGhostCase(group, artist, spine) {
  if (shelf.caseOpen) return;
  const { app } = shelf;
  const from = spine.getBoundingClientRect();
  const blank = el('div', { class: 'case-cover cdr ghost-cover' }, el('div', { class: 'marker' }, group.title), el('div', { class: 'marker small' }, artist));
  const front = el('div', { class: 'case-front' }, blank);
  // Fetched by main (the page may only show pictures it already has, as data).
  app.cdp.coverFromUrl(`https://coverartarchive.org/release-group/${group.id}/front-250`).then((src) => {
    if (!src || !blank.isConnected) return;
    blank.replaceWith(el('img', { class: 'case-cover', src, alt: '' }));
  }).catch(() => {});
  const tracks = el('div', { class: 'case-tracks scroll' }, el('div', { class: 'case-track' }, el('span', { class: 'name' }, '…')));
  app.cdp.missingTracklist(group.id).then((editions) => {
    tracks.replaceChildren(...(editions[0] || []).map((t, i) => el('div', { class: 'case-track' },
      el('span', { class: 'no' }, String(i + 1).padStart(2, '0')), el('span', { class: 'name' }, t.title),
      el('span', { class: 'time' }, t.length ? app.formatTime(t.length) : ''))));
  }).catch(() => tracks.replaceChildren(el('div', { class: 'case-track' }, el('span', { class: 'name' }, t("COULDN'T REACH MUSICBRAINZ")))));
  const spotifyButton = pill(t('PLAY ON SPOTIFY'), async () => {
    if (spotifyButton.disabled) return; // already looking: one disc, not two
    spotifyButton.disabled = true;
    try { await playMissingOnSpotify(group, artist); } finally { spotifyButton.disabled = false; }
  }, t('Find it on Spotify and play it as a disc'));
  spotifyButton.hidden = true;
  app.cdp.spotifyStatus().then((s) => { spotifyButton.hidden = !(s && s.connected); }).catch(() => {});
  const card = el('div', { class: 'case-card ghost' }, front,
    el('div', { class: 'case-info' },
      el('div', { class: 'case-title' }, group.title),
      el('div', { class: 'case-artist' }, [artist, group.year].filter(Boolean).join(' · ')),
      el('div', { class: 'case-meta' }, t('NOT IN YOUR COLLECTION')),
      tracks,
      el('div', { class: 'case-actions' },
        pill(t('BACK ON THE SHELF'), () => closeCase()),
        pill(t('NOT INTERESTED'), () => hideMissing(group), t('Never show this one on the shelf again')),
        el('span', { class: 'grow' }),
        pill(t('MUSICBRAINZ'), () => app.cdp.openMusicBrainz(group.id), t('Open its page on MusicBrainz')),
        spotifyButton)));
  showCase(card, spine, from, hashColor(group.title + artist));
}
function hideMissing(group) {
  shelf.hidden.add(group.id);
  shelf.app.cdp.hideMissing(group.id).catch(() => {});
  closeCase(true);
  render();
}
// Spotify's copy of a missing album: the first album found whose title is the same, put in as a disc.
async function playMissingOnSpotify(group, artist) {
  const { app } = shelf;
  const found = await app.cdp.spotifySearch(`album:${group.title} artist:${artist}`).catch(() => ({ error: 'OFFLINE' }));
  const hit = (found.items || []).find((i) => i.kind === 'album' && sameName(i.name) === sameName(group.title));
  if (!hit) { app.setStatus(t('NOT ON SPOTIFY')); return; }
  const disc = await app.cdp.spotifyDiscTracks({ kind: 'album', id: hit.id }).catch(() => ({ error: 'OFFLINE' }));
  if (!disc.tracks) { app.setStatus(t('NOT ON SPOTIFY')); return; }
  closeCase(true);
  app.playSpotifyDisc(disc.tracks, hit.name);
}

// The corner of an album's sticky note, showing above its spine.
function showNoteTab(spine) {
  const a = spine.album;
  let tab = spine.querySelector('.note-tab');
  if (!a.note) { if (tab) tab.remove(); return; }
  if (!tab) { tab = el('span', { class: 'note-tab' }); spine.append(tab); }
  const { color, tilt } = noteLook(a.id);
  tab.style.setProperty('--note', color);
  tab.style.transform = `rotate(${tilt * 1.5}deg)`;
}

// ---- The receipt ------------------------------------------------------------------------------------------------

// The receipt behind a case's cover (shelf-receipt.js): its edge peeks out under the cover; click it and it's pulled
// out and laid over the case, click again and it goes back.
function receiptSlip(a, stickers) {
  const r = receiptFor(a, stickers);
  if (!r) return null;
  const row = (left, right) => el('div', { class: 'rc-row' }, el('span', {}, left), el('span', {}, right));
  const bars = el('div', { class: 'rc-bars' }, ...[...r.barcode].map((d) => el('i', { style: `width:${1 + (Number(d) % 3)}px;margin-right:${1 + (Number(d) % 2)}px` })));
  const slip = el('div', { class: 'receipt', title: t('The receipt') },
    el('div', { class: 'rc-shop' }, r.shop), el('div', { class: 'rc-center' }, r.address),
    el('div', { class: 'rc-rule' }), row(r.date, r.time), el('div', { class: 'rc-rule' }),
    el('div', { class: 'rc-item' }, r.item), row(t('CD × 1'), r.price),
    el('div', { class: 'rc-rule' }), row(t('TOTAL'), r.total), row(r.paid, ''),
    el('div', { class: 'rc-rule' }), el('div', { class: 'rc-center' }, `NO. ${r.number}`), bars,
    el('div', { class: 'rc-center rc-small' }, t('THANK YOU · NO REFUNDS ON OPENED CDs')));
  slip.addEventListener('click', (e) => { e.stopPropagation(); slip.classList.toggle('out'); });
  return slip;
}

// ---- Shrink-wrap -----------------------------------------------------------------------------------------------

// The film over a new album's case: take hold of it and drag it across; past 40% of the way it tears off, short of
// that it springs back.
function caseFilm(a) {
  const film = el('div', { class: 'case-film', title: t('Drag across to unwrap it') }, el('span', { class: 'film-tab' }));
  film.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !a.wrapped) return;
    e.preventDefault(); e.stopPropagation();
    try { film.setPointerCapture(e.pointerId); } catch { /* gone */ }
    const x0 = e.clientX, w = film.getBoundingClientRect().width;
    film.classList.add('pulling');
    const move = (ev) => {
      const dx = ev.clientX - x0;
      film.style.transform = `translateX(${dx * 0.5}px) rotate(${(dx / w) * 5}deg)`;
    };
    const up = (ev) => {
      film.removeEventListener('pointermove', move);
      film.removeEventListener('pointerup', up);
      film.removeEventListener('pointercancel', up);
      film.classList.remove('pulling');
      if (ev.type === 'pointerup' && Math.abs(ev.clientX - x0) > w * 0.4) { tearFilm(film, a, false, Math.sign(ev.clientX - x0)); return; }
      // Just a click on it: the film rustles — it has to be pulled off first.
      if (ev.type === 'pointerup' && Math.abs(ev.clientX - x0) < 4 && anim.enabled) {
        film.style.transform = '';
        film.animate([{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 240 });
        return;
      }
      const from = film.style.transform;
      film.style.transform = '';
      if (anim.enabled && from) film.animate([{ transform: from }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    };
    film.addEventListener('pointermove', move);
    film.addEventListener('pointerup', up);
    film.addEventListener('pointercancel', up);
  });
  return film;
}
// Unwraps the album: remembered, its spine loses its film, and the film flies off the case. → when it's gone.
function tearFilm(film, a, quick = false, dir = 1) {
  if (!a.wrapped) return Promise.resolve();
  a.wrapped = false;
  shelf.app.cdp.tearWrap(a.id).catch(() => {});
  const spine = spineFor(a);
  if (spine) { const f = spine.querySelector('.spine-film'); if (f) f.remove(); }
  if (!anim.enabled) { film.remove(); return Promise.resolve(); }
  const from = film.style.transform || 'none';
  return new Promise((resolve) => {
    film.animate([
      { transform: from, opacity: 1 },
      { transform: `translate(${dir * 60}%, 20%) rotate(${dir * 24}deg) scale(.9)`, opacity: 0 },
    ], { duration: quick ? 220 : 380, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' }).onfinish = () => { film.remove(); resolve(); };
  });
}

// ---- Dust -------------------------------------------------------------------------------------------------------

function setDust(spine, level) {
  spine.dust = level;
  spine.classList.toggle('dusty', level > 0);
  spine.style.setProperty('--dust', level.toFixed(3));
}
// Rubbing the mouse back and forth over a dusty spine (no button held) wipes a little off with each stroke; wiped
// clean, it's remembered, and dust starts gathering again from now.
const WIPE_PER_STROKE = 0.3;
function rubSpine(e, spine) {
  if (e.buttons || !spine.dust) return;
  spine.wiper = spine.wiper || new Wiper();
  if (!spine.wiper.move(e.clientX, e.timeStamp)) return;
  puff(e.clientX, e.clientY, spine.dust);
  const left = spine.dust - WIPE_PER_STROKE;
  setDust(spine, left > 0.02 ? left : 0);
  if (spine.dust) return;
  const a = spine.album;
  shelf.app.cdp.wipeAlbum(a.id).then((t) => { a.touched = t; }).catch(() => {});
}
// A little cloud of dust falling off where the spine was wiped.
function puff(x, y, level) {
  if (!anim.enabled) return;
  for (let i = 0; i < 4 + Math.round(level * 6); i++) {
    const size = 2 + Math.random() * 3;
    const mote = el('div', { class: 'dust-mote' });
    Object.assign(mote.style, { left: `${x + (Math.random() - 0.5) * 14}px`, top: `${y + (Math.random() - 0.5) * 8}px`, width: `${size}px`, height: `${size}px` });
    document.body.append(mote);
    const dx = (Math.random() - 0.5) * 30, dy = 30 + Math.random() * 40;
    mote.animate([{ opacity: 0.8, transform: 'none' }, { opacity: 0, transform: `translate(${dx}px, ${dy}px)` }],
      { duration: 600 + Math.random() * 500, easing: 'cubic-bezier(.2,.6,.4,1)' }).onfinish = () => mote.remove();
  }
}

// PULL ONE: an album off the shelf at random — of those shown, the dustier the likelier — brought into view and
// pulled out.
// An album's spine on the shelf as it stands now (a redraw makes new ones), or null.
const spineFor = (a) => [...document.querySelectorAll('#shelf-body .spine')].find((s) => s.album === a) || null;

function pullOne() {
  if (shelf.caseOpen || shelf.opening || shelf.pulling || !shelf.shown || !shelf.shown.length) return;
  const a = pickOne(shelf.shown);
  const spine = spineFor(a);
  if (!spine) return;
  spine.scrollIntoView({ block: 'center', inline: 'nearest', behavior: anim.enabled ? 'smooth' : 'auto' });
  shelf.pulling = true; // no redraw till it's out: the spine must still be the one on the shelf
  setTimeout(async () => { try { if (shelf.open) await openCase(a, spine); } finally { shelf.pulling = false; } }, anim.enabled ? 450 : 0);
}

// ---- The case, pulled out and turned to its front ----------------------------------------------------------------

async function openCase(a, spine) {
  if (shelf.caseOpen || shelf.opening) return;
  const { app } = shelf;
  // One case at a time, even while the first one's cover is still being fetched.
  shelf.opening = true;
  let cover;
  try { cover = await coverFor(a); } finally { shelf.opening = false; }
  if (!shelf.open || shelf.caseOpen) return;
  if (!spine.isConnected) spine = spineFor(a) || spine; // the shelf was redrawn meanwhile
  const from = spine.getBoundingClientRect();
  const trackRow = (track, i, no = track.track || i + 1) => el('div', { class: 'case-track', title: t('Play from here'), onClick: () => unwrapped(() => play(a, i))() },
    el('span', { class: 'no' }, no ? String(no).padStart(2, '0') : ''),
    el('span', { class: 'name' }, track.title, a.artist === 'Various Artists' && track.artist ? el('span', { class: 'by' }, ` · ${track.artist}`) : null),
    el('span', { class: 'time' }, track.duration ? app.formatTime(track.duration) : ''));
  const tracks = a.tracks.map((t, i) => trackRow(t, i));
  const trackList = el('div', { class: 'case-tracks scroll' }, tracks);
  // The album's whole tracklist from MusicBrainz, once its artist's discography is known: the songs you don't have
  // stand in their place, in grey.
  const group = groupOf(a, shelf.discogs);
  if (group) {
    app.cdp.missingTracklist(group.id).then((editions) => {
      const edition = pickEdition(editions, a.tracks.map((t) => t.title));
      if (!edition || !trackList.isConnected) return;
      const rows = fullTracklist(edition, a.tracks);
      if (rows.every((r) => r.have)) return; // nothing missing: as it was
      trackList.replaceChildren(...rows.map((r) => (r.have ? trackRow(r.have, a.tracks.indexOf(r.have), r.no) : el('div', { class: 'case-track missing', title: t('Not in your collection') },
        el('span', { class: 'no' }, String(r.no).padStart(2, '0')), el('span', { class: 'name' }, r.title),
        el('span', { class: 'time' }, r.length ? app.formatTime(r.length) : '')))));
    }).catch(() => {});
  }
  const front = cover ? el('img', { class: 'case-cover', src: cover, alt: '' })
    : el('div', { class: 'case-cover cdr' }, el('div', { class: 'marker' }, a.title), a.artist ? el('div', { class: 'marker small' }, a.artist) : null);
  front.title = t('Open the booklet');
  front.addEventListener('click', () => {
    if (a.wrapped) { if (film && anim.enabled) film.animate([{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 240 }); return; } // unwrap it first
    openAlbumBooklet(a, front);
  });
  const st = a.stickers || stickersFor(a);
  // The sticky note: on the front when there is one; + NOTE sticks a blank one on to write.
  const saveNote = (text) => {
    a.note = text || null;
    app.cdp.setNote(a.id, text).catch(() => {});
    addNote.hidden = !!a.note;
    const spine = spineFor(a);
    if (spine) { showNoteTab(spine); spine.title = spineTitle(a); }
  };
  // Shrink-wrap: dragged off by hand, or torn off at once by PLAY, PLAY NEXT or ADD TO QUEUE (or a track clicked).
  const film = a.wrapped ? caseFilm(a) : null;
  let tearing = null; // PLAY and co. while the film is coming off: once, not again with a second click
  const unwrapped = (then) => () => {
    if (tearing) return;
    if (a.wrapped && film) { tearing = tearFilm(film, a, true).then(then); return; }
    then();
  };
  const addNote = pill(t('+ NOTE'), () => { addNote.hidden = true; caseFront.append(stickyNote({ id: a.id, text: '', onSave: saveNote })); }, t('Stick a note on the case'));
  addNote.hidden = !!a.note;
  const rare = el('div', { class: 'sticker-rare', hidden: !isRare(a.pressing) }, t('★ RARE'));
  const caseFront = el('div', { class: 'case-front' }, receiptSlip(a, st), front, rare,
      st.obi ? el('div', { class: 'case-obi' },
        el('div', { class: 'obi-top' }, 'CD'),
        el('div', { class: 'obi-title' }, a.title),
        el('div', { class: 'obi-foot' }, el('div', {}, st.obi.catalog), el('div', {}, st.price))) : null,
      !st.obi && st.price ? el('div', { class: 'sticker-price' }, st.price) : null,
      st.isNew ? el('div', { class: 'sticker-new' }, t('NEW')) : null,
      film,
      a.note ? stickyNote({ id: a.id, text: a.note, onSave: saveNote }) : null);
  const card = el('div', { class: 'case-card' },
    caseFront,
    el('div', { class: 'case-info' },
      el('div', { class: 'case-title' }, a.title),
      el('div', { class: 'case-artist' }, [a.artist, a.year].filter(Boolean).join(' · ')),
      el('div', { class: 'case-meta' }, [a.tracks.length === 1 ? t('1 TRACK') : t('{n} TRACKS', { n: a.tracks.length }), a.duration ? app.formatTime(a.duration) : null, a.discs > 1 ? t('{n} DISCS', { n: a.discs }) : null, holds(a, shelf.inPlayer) ? IN_PLAYER : null].filter(Boolean).join(' · ')),
      pressingBlock(a, rare),
      trackList,
      el('div', { class: 'case-actions' },
        pill(t('BACK ON THE SHELF'), () => closeCase()),
        addNote,
        el('span', { class: 'grow' }),
        pill(t('PLAY NEXT'), unwrapped(() => { app.playNext(a.tracks.map((t) => t.path), { sorted: true }); closeCase(); }), t('Play the album next, after the song playing')),
        pill(t('ADD TO QUEUE'), unwrapped(() => { app.addToQueue(a.tracks.map((t) => t.path), { sorted: true }); closeCase(); }), t('Add every track to the end of the queue')),
        el('button', { class: 'pill on', onClick: unwrapped(() => play(a, 0)) }, t('PLAY')))));
  showCase(card, spine, from, shelf.colors.get(a.id) || hashColor(a.title + a.artist));
}

// A case pulled out of the shelf: slides up off it, then turns towards you from its spine to its front.
function showCase(card, spine, from, color) {
  const layer = el('div', { class: 'case-layer', onClick: (e) => { if (e.target === layer) closeCase(); } }, card);
  card.style.setProperty('--spine', `${color[0]}, ${color[1]}, ${color[2]}`);
  $('shelf').append(layer);
  shelf.caseOpen = { layer, card, spine };
  spine.classList.add('out');
  if (!anim.enabled) return;
  const to = card.getBoundingClientRect();
  const sx = from.width / to.width, sy = from.height / to.height;
  card.animate([
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top - 30}px) scale(${sx}, ${sy}) rotateY(75deg)`, opacity: 0.2, transformOrigin: 'left top' },
    { transform: 'none', opacity: 1, transformOrigin: 'left top' },
  ], { duration: 420, easing: 'cubic-bezier(.2,.8,.25,1)' });
  layer.animate([{ background: 'rgba(0,0,0,0)' }, { background: 'rgba(0,0,0,.6)' }], { duration: 300 });
}

// The album's booklet, rising out of the case's cover (full size, not the spine's thumbnail).
async function openAlbumBooklet(a, front) {
  const { app } = shelf;
  if (isBookletOpen() || front.classList.contains('opening')) return;
  front.classList.add('opening');
  try {
    const src = (await app.cdp.shelfCoverFull(a.tracks[0].path).catch(() => null)) || (await coverFor(a));
    let img = null;
    if (src) { img = new Image(); img.src = src; try { await img.decode(); } catch { img = null; } }
    const content = await albumBooklet(app, a, img, {
      play: (i) => { closeBooklet(); play(a, i); },
      onClose: () => { front.style.visibility = ''; },
    });
    if (!shelf.caseOpen || shelf.caseOpen.card !== front.closest('.case-card')) return; // put back while it loaded
    const from = front.getBoundingClientRect();
    front.style.visibility = 'hidden'; // it's the booklet's front cover now
    await openBooklet(app, from, content);
  } finally { front.classList.remove('opening'); }
}

function closeCase(instant = false) {
  const c = shelf.caseOpen;
  if (!c) return;
  shelf.caseOpen = null;
  c.spine.classList.remove('out');
  if (instant || !anim.enabled) { c.layer.remove(); return; }
  c.card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.92) rotateY(-25deg)' }], { duration: 160, easing: 'ease-in' });
  c.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170 }).onfinish = () => c.layer.remove();
}

// PLAY: the album goes into the player as a disc (from track `from`, when a track in the list was clicked).
function play(a, from) {
  const paths = a.tracks.map((t) => t.path);
  closeShelf();
  shelf.app.insertDisc(paths, { start: from, status: t('{disc} ON THE TRAY', { disc: a.title.toUpperCase() }) });
}

// ---- Discogs (main/discogs.js): the pressing on the case, the shelf appraised -------------------------------------

const attachPressings = () => { for (const a of shelf.albums) a.pressing = shelf.pressings.get(a.id); };
const albumQuery = (a) => ({ id: a.id, artist: a.artist, title: a.title, year: a.year, barcode: a.barcode, catalog: a.catalog, label: a.label, mbReleaseId: a.mbReleaseId });
function markSpine(id) {
  const spine = [...document.querySelectorAll('#shelf-body .spine')].find((s) => s.album && s.album.id === id);
  if (spine) spine.classList.toggle('rare', isRare(spine.album.pressing));
}
function renderCount() {
  if (!shelf.loading) $('shelf-count').textContent = [shelf.countBase, shelf.appraisalNote].filter(Boolean).join(' · ');
}

// The case's PRESSING: what's known at once, then Discogs' answer as the case comes out.
function pressingBlock(a, rare) {
  const box = el('div', { class: 'case-pressing' });
  const show = (entry) => {
    rare.hidden = !isRare(entry);
    if (entry && entry.error) { box.replaceChildren(el('div', { class: 'pressing-line' }, t('DISCOGS UNAVAILABLE'))); return; }
    if (!entry || !entry.releaseId) {
      box.replaceChildren(el('div', { class: 'pressing-line' }, t('NOT ON DISCOGS')),
        el('div', { class: 'row-pills' }, pill(t('CHOOSE PRESSING…'), (e) => choosePressing(a, e.currentTarget, null, show), t('Pick it from a Discogs search'))));
      return;
    }
    const other = entry.info.masterId ? pill(t('OTHER PRESSING…'), (e) => choosePressing(a, e.currentTarget, entry.info.masterId, show), t('Another pressing of this album')) : null;
    box.replaceChildren(
      el('div', { class: 'pressing-head' }, t('PRESSING')),
      el('div', { class: 'pressing-line' }, pressingLine(entry.info)),
      el('div', { class: 'pressing-line market' }, marketLine(entry)),
      el('div', { class: 'row-pills' }, pill(t('DISCOGS'), () => shelf.app.cdp.openDiscogs(entry.info.uri), t('Open it on Discogs')), other));
  };
  const known = shelf.pressings.get(a.id);
  if (known) show(known); else box.replaceChildren(el('div', { class: 'pressing-line' }, t('LOOKING ON DISCOGS…')));
  shelf.app.cdp.discogsLookup(albumQuery(a)).then((entry) => {
    if (entry && !entry.error) { shelf.pressings.set(a.id, entry); a.pressing = entry; markSpine(a.id); }
    if (entry && (!entry.error || !known)) show(entry);
  });
  return box;
}

/** OTHER PRESSING… (the master's CD pressings) or CHOOSE PRESSING… (a Discogs search): a menu; the pick is kept. */
export async function choosePressing(a, anchor, masterId, onChosen = () => {}) {
  const box = anchor.getBoundingClientRect();
  const list = masterId ? await shelf.app.cdp.discogsVersions(masterId) : await shelf.app.cdp.discogsSearch(albumQuery(a));
  if (!Array.isArray(list) || !list.length) { shelf.app.setStatus(list && list.error ? t('DISCOGS UNAVAILABLE') : t('NOTHING FOUND')); return; }
  shelf.app.pressingMenu(box, list.map((v) => ({
    label: [masterId ? null : v.title, v.label, v.catno, v.country, v.year, v.format].filter(Boolean).join(' · '),
    pick: async () => {
      const entry = await shelf.app.cdp.discogsChoose(albumQuery(a), v.id);
      if (!entry || entry.error) { shelf.app.setStatus(t('DISCOGS UNAVAILABLE')); return; }
      shelf.pressings.set(a.id, entry);
      const onShelf = shelf.albums.find((x) => x.id === a.id);
      if (onShelf) onShelf.pressing = entry;
      markSpine(a.id);
      onChosen(entry);
    },
  })));
}

// APPRAISE: every album's price, one after another (main/discogs.js keeps to Discogs' pace); STOP stops it.
async function appraise() {
  shelf.appraising = { done: 0, total: shelf.albums.length };
  updateAppraiseCount();
  const result = await shelf.app.cdp.discogsAppraise(shelf.albums.map(albumQuery));
  shelf.appraising = { ...result, finished: true };
  if (!result.stopped && !result.error) shelf.appraised = true;
  if (result.error) shelf.app.setStatus(t('APPRAISAL STOPPED · NO CONNECTION'));
  updateAppraiseCount();
  if (shelf.open) render();
}
function updateAppraiseCount() {
  const p = shelf.appraising, running = p && !p.finished;
  $('shelf-appraise').textContent = running ? t('STOP') : t('APPRAISE');
  shelf.appraisalNote = running ? t('APPRAISING · {done} / {total}', { done: p.done, total: p.total }) : totalNote();
  renderCount();
}
function totalNote() {
  const currency = (shelf.settings && shelf.settings.currency) || 'USD';
  const { value, count } = shelfTotal(shelf.albums.map((a) => a.pressing), currency);
  return count ? t('THE SHELF ≈ {value}', { value: money(value, currency) }) : null;
}
