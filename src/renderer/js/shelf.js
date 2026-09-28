// The CD shelf (S, or SHELF): every album in your music folder as a jewel case standing on a shelf, spine out — the
// spine in the colours of its cover, a double album twice as thick. Click one and the case slides out and turns to
// show its front: the cover, the tracklist, and PLAY, which puts it in the player (the tray comes out, the disc goes
// in, the tray closes and it plays). Click the case's cover and the album's booklet lifts out of it.
import { el, pill, anim } from './widgets.js';
import { openBooklet, closeBooklet, albumBooklet, isBookletOpen } from './booklet.js';
import { stickersFor } from './shelf-stickers.js';

const $ = (id) => document.getElementById(id);
const shelf = { open: false, albums: [], loading: false, covers: new Map(), colors: new Map(), observer: null, caseOpen: null, app: null, generation: 0, inPlayer: null };

export const isShelfOpen = () => shelf.open;

// The album whose disc is in the player (a track of it loaded, playing or paused) stands a little proud of the others,
// lit in the theme's colour.
const IN_PLAYER = 'IN THE PLAYER';
const holds = (a, path) => !!path && a.tracks.some((t) => t.path === path);
const spineTitle = (a) => [a.artist, a.title, a.year, holds(a, shelf.inPlayer) ? IN_PLAYER : null].filter(Boolean).join(' · ');
/** The track now in the player (null: none), so its album's spine can show it. */
export function showInPlayer(path) {
  shelf.inPlayer = path || null;
  for (const spine of document.querySelectorAll('#shelf-body .spine')) {
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
  $('shelf-filter').addEventListener('input', render);
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
  const words = $('shelf-filter').value.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = shelf.albums.filter((a) => {
    const text = `${a.artist || ''} ${a.title} ${a.year || ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const n = shelf.albums.length;
  $('shelf-count').textContent = `${shelf.folderName.toUpperCase()} · ${n} ${n === 1 ? 'ALBUM' : 'ALBUMS'}${words.length ? ` · ${shown.length} SHOWN` : ''}`;
  if (!n) { body.replaceChildren(el('div', { class: 'shelf-empty' }, el('div', {}, 'No music in this folder yet.'), pill('CHOOSE ANOTHER FOLDER…', pickFolder))); return; }
  shelf.observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { shelf.observer.unobserve(e.target); loadCover(e.target.album, e.target); }
  }, { root: body, rootMargin: '200px' });
  const now = Date.now();
  const spines = shown.map((a) => {
    const st = a.stickers = stickersFor(a, now);
    const spine = el('button', { class: `spine${a.discs > 1 ? ' double' : ''}${st.obi ? ' obi' : ''}${st.isNew ? ' new' : ''}${holds(a, shelf.inPlayer) ? ' in-player' : ''}`, title: spineTitle(a), onClick: () => openCase(a, spine) },
      el('span', { class: 'spine-text' }, a.artist ? el('b', {}, a.artist) : null, a.artist ? ' · ' : null, a.title),
      st.obi ? el('span', { class: 'obi-cat' }, st.obi.catalog) : null,
      st.isNew ? el('span', { class: 'sticker-new' }, 'NEW') : null);
    spine.album = a;
    paintSpine(spine, a);
    shelf.observer.observe(spine);
    return spine;
  });
  body.replaceChildren(el('div', { class: 'shelf-rows' }, spines));
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
  const card = el('div', { class: 'case-card' },
    el('div', { class: 'case-front' }, front,
      st.obi ? el('div', { class: 'case-obi' },
        el('div', { class: 'obi-top' }, 'CD'),
        el('div', { class: 'obi-title' }, a.title),
        el('div', { class: 'obi-foot' }, el('div', {}, st.obi.catalog), el('div', {}, st.price))) : null,
      !st.obi && st.price ? el('div', { class: 'sticker-price' }, st.price) : null,
      st.isNew ? el('div', { class: 'sticker-new' }, 'NEW') : null),
    el('div', { class: 'case-info' },
      el('div', { class: 'case-title' }, a.title),
      el('div', { class: 'case-artist' }, [a.artist, a.year].filter(Boolean).join(' · ')),
      el('div', { class: 'case-meta' }, `${a.tracks.length} ${a.tracks.length === 1 ? 'TRACK' : 'TRACKS'}${a.duration ? ` · ${app.formatTime(a.duration)}` : ''}${a.discs > 1 ? ` · ${a.discs} DISCS` : ''}${holds(a, shelf.inPlayer) ? ` · ${IN_PLAYER}` : ''}`),
      el('div', { class: 'case-tracks scroll' }, tracks),
      el('div', { class: 'case-actions' },
        pill('BACK ON THE SHELF', () => closeCase()),
        el('span', { class: 'grow' }),
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
