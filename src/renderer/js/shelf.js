// The CD shelf (S, or SHELF): every album in your music folder as a jewel case standing on a shelf, spine out — the
// spine in the colours of its cover, a double album twice as thick. Click one and the case slides out and turns to
// show its front: the cover, the tracklist, and PLAY, which puts it in the player (the tray comes out, the disc goes
// in, the tray closes and it plays). Click the case's cover and the album's booklet lifts out of it. Or pick a spine up
// and carry it out: the shelf fades so the player shows through, and it goes in on the disc or at the end of the queue
// (with ⇧ held, to play next). An album left unplayed gathers dust (shelf-dust.js): rub the mouse over its spine to
// wipe it. PULL ONE takes one off the shelf at random, the dustier the likelier. A case can have a sticky note on it
// (shelf-notes.js), whose corner shows above its spine.
import { el, pill, anim } from './widgets.js';
import { openBooklet, closeBooklet, albumBooklet, isBookletOpen } from './booklet.js';
import { stickersFor } from './shelf-stickers.js';
import { arrange, SORTS, matchesFilter } from './shelf-order.js';
import { stickyNote, noteLook } from './shelf-notes.js';
import { artistsWanting, missingFor, withMissing, boxLabel, typeLabel, isSlim, sameName } from './shelf-missing.js';
import { dustLevel, pickOne, Wiper } from './shelf-dust.js';

const $ = (id) => document.getElementById(id);
const shelf = { open: false, albums: [], loading: false, covers: new Map(), colors: new Map(), observer: null, caseOpen: null, app: null, generation: 0, inPlayer: null,
  discogs: new Map(), openBoxes: new Set(), hidden: new Set(), boxObserver: null, wantTimer: null, onScreen: new Set() };

export const isShelfOpen = () => shelf.open;

// The album whose disc is in the player (a track of it loaded, playing or paused) stands a little proud of the others,
// lit in the theme's colour.
const IN_PLAYER = 'IN THE PLAYER';
const SORT_LABELS = { ARTIST: 'ARTIST', NEW: 'NEW', PLAYED: 'MOST PLAYED', YEAR: 'YEAR' };
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
  $('shelf-filter').addEventListener('input', render);
  $('shelf-sort').addEventListener('click', () => {
    const { state } = shelf.app;
    shelf.app.setShelfSort(SORTS[(SORTS.indexOf(state.shelfSort) + 1) % SORTS.length]);
    render();
    $('shelf-body').scrollTop = 0;
  });
  app.cdp.onDiscography(({ key, state, groups }) => {
    shelf.discogs.set(key, { state, groups });
    if (shelf.open && shelf.app.state.shelfSort === 'ARTIST') render();
  });
  app.cdp.onShelfProgress(({ done, total }) => { if (shelf.loading) $('shelf-count').textContent = `READING YOUR MUSIC · ${done} / ${total}`; });
}

async function pickFolder() {
  const folder = await shelf.app.cdp.pickMusicFolder();
  if (folder) await load();
}

async function load() {
  const generation = ++shelf.generation;
  shelf.loading = true;
  $('shelf-count').textContent = 'READING YOUR MUSIC…';
  $('shelf-body').replaceChildren();
  let result;
  try { result = await shelf.app.cdp.shelfAlbums(); } catch { result = { folder: null, albums: [], error: true }; }
  if (generation !== shelf.generation) return;
  shelf.loading = false;
  shelf.albums = result.albums;
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
      el('div', {}, 'Which folder is your music in?'),
      pill('CHOOSE YOUR MUSIC FOLDER…', pickFolder)));
    return;
  }
  const query = $('shelf-filter').value, filtering = !!query.trim();
  const shown = shelf.albums.filter((a) => matchesFilter(a, query));
  const n = shelf.albums.length;
  $('shelf-count').textContent = `${shelf.folderName.toUpperCase()} · ${n} ${n === 1 ? 'ALBUM' : 'ALBUMS'}${filtering ? ` · ${shown.length} SHOWN` : ''}`;
  if (!n) { body.replaceChildren(el('div', { class: 'shelf-empty' }, el('div', {}, 'No music in this folder yet.'), pill('CHOOSE ANOTHER FOLDER…', pickFolder))); return; }
  shelf.observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { shelf.observer.unobserve(e.target); loadCover(e.target.album, e.target); }
  }, { root: body, rootMargin: '200px' });
  const now = Date.now(), sort = shelf.app.state.shelfSort;
  $('shelf-sort').textContent = `SORT: ${SORT_LABELS[sort] || sort}`;
  shelf.shown = shown;
  if (shelf.boxObserver) shelf.boxObserver.disconnect();
  shelf.onScreen.clear();
  const boxes = sort === 'ARTIST' ? missingBoxes(shown, query) : new Map();
  const items = withMissing(arrange(shown, sort), boxes).map((a) => {
    if (a.box) return boxCard(a.box);
    if (a.ghost) return ghostSpine(a.ghost, a.artist);
    if (a.divider) return el('div', { class: `shelf-divider${[...a.divider].length <= 2 ? ' short' : ''}`, 'aria-hidden': 'true' }, el('span', {}, a.divider));
    const st = a.stickers = stickersFor(a, now);
    const spine = el('button', { class: `spine${a.discs > 1 ? ' double' : ''}${st.obi ? ' obi' : ''}${st.isNew ? ' new' : ''}${holds(a, shelf.inPlayer) ? ' in-player' : ''}`, title: spineTitle(a), onClick: () => { if (!shelf.dragged) openCase(a, spine); } },
      el('span', { class: 'spine-text' }, a.artist ? el('b', {}, a.artist) : null, a.artist ? ' · ' : null, a.title),
      st.obi ? el('span', { class: 'obi-cat' }, st.obi.catalog) : null,
      st.isNew ? el('span', { class: 'sticker-new' }, 'NEW') : null);
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
  const c = shelf.colors.get(a.id) || hashColor(a.title + a.artist);
  const light = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150;
  spine.style.setProperty('--spine', `${c[0]}, ${c[1]}, ${c[2]}`);
  spine.style.setProperty('--ink', light ? '20, 20, 24' : '240, 240, 244');
}

// The cover's average colour (of its middle, where the art usually is), for the spine.
function averageColor(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d');
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  let r = 0, gr = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return [Math.round(r / n), Math.round(gr / n), Math.round(b / n)];
}

async function coverFor(a) {
  if (shelf.covers.has(a.id)) return shelf.covers.get(a.id);
  const url = await shelf.app.cdp.shelfCover(a.tracks[0].path).catch(() => null);
  shelf.covers.set(a.id, url);
  return url;
}
async function loadCover(a, spine) {
  const url = await coverFor(a);
  if (!url || shelf.colors.has(a.id)) { if (shelf.colors.has(a.id)) paintSpine(spine, a); return; }
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return; }
  shelf.colors.set(a.id, averageColor(img));
  paintSpine(spine, a);
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

// ---- Missing albums (shelf-missing.js) -------------------------------------------------------------------------

// The boxes for the artists shown: their discography when it's known, or waiting for it.
function missingBoxes(shown, query) {
  const boxes = new Map();
  const wanting = artistsWanting(shelf.albums);
  const showing = new Set(shown.map((a) => sameName(a.artist)));
  for (const [key, w] of wanting) {
    if (!showing.has(key)) continue;
    const d = shelf.discogs.get(key);
    if (d && d.state === 'unknown') continue;
    const missing = d ? missingFor(d.groups, w.owned, shelf.hidden).filter((g) => matchesFilter({ artist: w.artist, title: g.title, year: g.year }, query)) : [];
    boxes.set(key, { key, artist: w.artist, mbid: w.mbid, state: d ? 'found' : 'loading', missing, open: shelf.openBoxes.has(key) });
  }
  return boxes;
}
function boxCard(box) {
  const card = el('button', { class: `missing-box${box.state === 'found' && !box.missing.length ? ' complete' : ''}${box.open ? ' open' : ''}`,
    title: box.state !== 'found' ? `Looking up ${box.artist} on MusicBrainz…` : box.missing.length ? `${box.artist}: releases you don't have — click to ${box.open ? 'close' : 'show them'}` : `You have everything ${box.artist} has released`,
    onClick: () => {
      if (box.state !== 'found' || !box.missing.length) return;
      if (shelf.openBoxes.has(box.key)) shelf.openBoxes.delete(box.key); else shelf.openBoxes.add(box.key);
      render();
    } }, el('span', {}, boxLabel(box)));
  card.box = box;
  if (box.state === 'loading') watchBox(card);
  return card;
}
// A box that's waiting: once it's on screen, MusicBrainz is asked about its artist (a moment after scrolling stops).
function watchBox(card) {
  if (!shelf.boxObserver) {
    shelf.boxObserver = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) shelf.onScreen.add(e.target.box); else shelf.onScreen.delete(e.target.box); }
      clearTimeout(shelf.wantTimer);
      shelf.wantTimer = setTimeout(() => {
        shelf.app.cdp.wantDiscography([...shelf.onScreen].map((b) => ({ artist: b.artist, mbid: b.mbid }))).catch(() => {});
      }, 250);
    }, { root: $('shelf-body'), rootMargin: '200px' });
  }
  shelf.boxObserver.observe(card);
}
function ghostSpine(group, artist) {
  const type = typeLabel(group);
  const spine = el('button', { class: `spine ghost${isSlim(group) ? ' slim' : ''}`, title: [artist, group.title, group.year, type].filter(Boolean).join(' · '),
    onClick: () => openGhostCase(group, artist, spine) },
    el('span', { class: 'spine-text' }, group.title, group.year ? ` · ${group.year}` : ''),
    type ? el('span', { class: 'ghost-type' }, type) : null);
  spine.ghost = group;
  return spine;
}
function openGhostCase() {}

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
function pullOne() {
  if (shelf.caseOpen || !shelf.shown || !shelf.shown.length) return;
  const a = pickOne(shelf.shown);
  const spine = [...document.querySelectorAll('#shelf-body .spine')].find((s) => s.album === a);
  if (!spine) return;
  spine.scrollIntoView({ block: 'center', inline: 'nearest', behavior: anim.enabled ? 'smooth' : 'auto' });
  setTimeout(() => { if (shelf.open) openCase(a, spine); }, anim.enabled ? 450 : 0);
}

// ---- The case, pulled out and turned to its front ----------------------------------------------------------------

async function openCase(a, spine) {
  if (shelf.caseOpen) return;
  const { app } = shelf;
  const from = spine.getBoundingClientRect();
  const cover = await coverFor(a);
  const tracks = a.tracks.map((t, i) => el('div', { class: 'case-track', title: `Play from here`, onClick: () => play(a, i) },
    el('span', { class: 'no' }, String(t.track || i + 1).padStart(2, '0')),
    el('span', { class: 'name' }, t.title, a.artist === 'Various Artists' && t.artist ? el('span', { class: 'by' }, ` · ${t.artist}`) : null),
    el('span', { class: 'time' }, t.duration ? app.formatTime(t.duration) : '')));
  const front = cover ? el('img', { class: 'case-cover', src: cover, alt: '' })
    : el('div', { class: 'case-cover cdr' }, el('div', { class: 'marker' }, a.title), a.artist ? el('div', { class: 'marker small' }, a.artist) : null);
  front.title = 'Open the booklet';
  front.addEventListener('click', () => openAlbumBooklet(a, front));
  const st = a.stickers || stickersFor(a);
  // The sticky note: on the front when there is one; + NOTE sticks a blank one on to write.
  const saveNote = (text) => {
    a.note = text || null;
    app.cdp.setNote(a.id, text).catch(() => {});
    addNote.hidden = !!a.note;
    const spine = [...document.querySelectorAll('#shelf-body .spine')].find((s) => s.album === a);
    if (spine) { showNoteTab(spine); spine.title = spineTitle(a); }
  };
  const addNote = pill('+ NOTE', () => { addNote.hidden = true; caseFront.append(stickyNote({ id: a.id, text: '', onSave: saveNote })); }, 'Stick a note on the case');
  addNote.hidden = !!a.note;
  const caseFront = el('div', { class: 'case-front' }, front,
      st.obi ? el('div', { class: 'case-obi' },
        el('div', { class: 'obi-top' }, 'CD'),
        el('div', { class: 'obi-title' }, a.title),
        el('div', { class: 'obi-foot' }, el('div', {}, st.obi.catalog), el('div', {}, st.price))) : null,
      !st.obi && st.price ? el('div', { class: 'sticker-price' }, st.price) : null,
      st.isNew ? el('div', { class: 'sticker-new' }, 'NEW') : null,
      a.note ? stickyNote({ id: a.id, text: a.note, onSave: saveNote }) : null);
  const card = el('div', { class: 'case-card' },
    caseFront,
    el('div', { class: 'case-info' },
      el('div', { class: 'case-title' }, a.title),
      el('div', { class: 'case-artist' }, [a.artist, a.year].filter(Boolean).join(' · ')),
      el('div', { class: 'case-meta' }, `${a.tracks.length} ${a.tracks.length === 1 ? 'TRACK' : 'TRACKS'}${a.duration ? ` · ${app.formatTime(a.duration)}` : ''}${a.discs > 1 ? ` · ${a.discs} DISCS` : ''}${holds(a, shelf.inPlayer) ? ` · ${IN_PLAYER}` : ''}`),
      el('div', { class: 'case-tracks scroll' }, tracks),
      el('div', { class: 'case-actions' },
        pill('BACK ON THE SHELF', () => closeCase()),
        addNote,
        el('span', { class: 'grow' }),
        pill('PLAY NEXT', () => { app.playNext(a.tracks.map((t) => t.path), { sorted: true }); closeCase(); }, 'Play the album next, after the song playing'),
        pill('ADD TO QUEUE', () => { app.addToQueue(a.tracks.map((t) => t.path), { sorted: true }); closeCase(); }, 'Add every track to the end of the queue'),
        el('button', { class: 'pill on', onClick: () => play(a, 0) }, 'PLAY'))));
  const layer = el('div', { class: 'case-layer', onClick: (e) => { if (e.target === layer) closeCase(); } }, card);
  const c = shelf.colors.get(a.id) || hashColor(a.title + a.artist);
  card.style.setProperty('--spine', `${c[0]}, ${c[1]}, ${c[2]}`);
  $('shelf').append(layer);
  shelf.caseOpen = { layer, card, spine };
  spine.classList.add('out');
  if (!anim.enabled) return;
  // Slides up off the shelf, then turns towards you from its spine to its front, growing into place.
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
  shelf.app.insertDisc(paths, { start: from, status: `${a.title.toUpperCase()} ON THE TRAY` });
}
