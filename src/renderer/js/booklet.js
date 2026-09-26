// The CD booklet. With the full-size album art open over the jewel case, clicking the art lifts the booklet out of the
// case and opens it into a two-page spread: the front cover, the album's tracklist, the song's lyrics, the credits and
// the back cover with its small print — printed in the album's own colours. ← / → or clicking a page turns it; Esc or
// clicking outside puts it back in the case. Pages are HTML (real text), laid over the canvas-drawn case.
import { el, anim } from './widgets.js';
import { deriveAutoTheme, rgb } from './theme.js';
import { parseLrc, formatLyricsForDisplay, currentLineIndex } from './lyrics.js';
import { paginate, leavesFor, ean13 } from './booklet-layout.js';

const LIFT_MS = 420, TURN_MS = 650;
const layer = () => document.getElementById('overlays');
let book = null; // the open booklet: { root, leaves, turned, from, lyricsTimer, closing }

export const isBookletOpen = () => !!book;
const wait = (ms) => new Promise((r) => setTimeout(r, anim.enabled ? ms : 0));

// ---- Opening, turning, closing ------------------------------------------------------------------------------------

/** Opens the booklet for the current track, rising out of `from` (the art's rectangle on screen). */
export async function openBooklet(app, from) {
  if (book || !app.state.details) return;
  const size = pageSize();
  const root = el('div', { class: 'booklet-layer' });
  const spread = el('div', { class: 'booklet' });
  Object.assign(spread.style, {
    width: `${size * 2}px`, height: `${size}px`,
    left: `${Math.round((window.innerWidth - size * 2) / 2)}px`, top: `${Math.round((window.innerHeight - size) / 2)}px`,
  });
  spread.style.setProperty('--page', `${size}px`);
  applyColors(spread, app.state.cover);
  root.append(spread);
  layer().append(root);

  const leaves = leavesFor(frontCover(app), await insidePages(app, spread, size), backCover(app), blankPage)
    .map((pages, i) => {
      const leaf = el('div', { class: 'leaf' }, face(pages.front, 'front'), face(pages.back, 'back'));
      leaf.dataset.index = i;
      spread.append(leaf);
      return leaf;
    });
  book = { root, spread, leaves, turned: 0, from, app };
  stack();

  // Clicks: the right page turns forward, the left page back, anything outside the booklet closes it.
  root.addEventListener('mousedown', (e) => { if (e.target === root) closeBooklet(); });
  spread.addEventListener('click', (e) => {
    if (e.target.closest('[data-play]')) return;
    const r = spread.getBoundingClientRect();
    if (e.clientX >= r.left + r.width / 2) turn(1); else turn(-1);
  });
  window.addEventListener('keydown', onKey, true);
  startLyricsHighlight(app);

  // Rise out of the case: start as the art (the cover sits in the right half), grow to the middle, then open.
  const target = spread.getBoundingClientRect();
  if (from && anim.enabled) {
    const k = from.width / size;
    spread.style.transformOrigin = `${size}px 0`;
    spread.style.transform = `translate(${from.left - (target.left + size)}px, ${from.top - target.top}px) scale(${k})`;
    root.classList.add('entering');
    void spread.offsetWidth;
    spread.style.transition = `transform ${LIFT_MS}ms cubic-bezier(.2,.7,.2,1)`;
    root.classList.remove('entering');
    spread.style.transform = 'none';
  }
  await wait(LIFT_MS);
  if (book && book.spread === spread && book.turned === 0) turn(1);
}

function onKey(e) {
  if (!book) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); turn(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); turn(-1); }
}

function turn(direction) {
  if (!book || book.closing) return;
  const { leaves } = book;
  if (direction > 0 && book.turned < leaves.length) {
    const leaf = leaves[book.turned++];
    leaf.style.zIndex = String(leaves.length * 3); // on top of both stacks while it swings over
    leaf.classList.add('turned');
    setTimeout(stack, anim.enabled ? TURN_MS : 0);
  } else if (direction < 0 && book.turned > 0) {
    const leaf = leaves[--book.turned];
    leaf.style.zIndex = String(leaves.length * 3);
    leaf.classList.remove('turned');
    setTimeout(stack, anim.enabled ? TURN_MS : 0);
  } else if (direction < 0) closeBooklet();
}

// Resting order: turned leaves on the left with the last one turned on top; the rest on the right, first on top.
function stack() {
  if (!book) return;
  book.leaves.forEach((leaf, i) => { leaf.style.zIndex = String(i < book.turned ? i + 1 : book.leaves.length * 2 - i); });
}

/** Closes the booklet back into the case (and the art back into the corner). */
export async function closeBooklet() {
  if (!book || book.closing) return;
  const b = book;
  b.closing = true;
  window.removeEventListener('keydown', onKey, true);
  clearInterval(b.lyricsTimer);
  if (b.turned > 0) {
    b.leaves.forEach((leaf) => leaf.classList.remove('turned'));
    b.turned = 0;
    await wait(TURN_MS * 0.6);
  }
  if (b.from && anim.enabled) {
    const size = b.spread.offsetHeight, target = b.spread.getBoundingClientRect();
    b.spread.style.transform = `translate(${b.from.left - (target.left + size)}px, ${b.from.top - target.top}px) scale(${b.from.width / size})`;
    b.root.classList.add('leaving');
  }
  await wait(LIFT_MS);
  b.root.remove();
  book = null;
  b.app.disc.artOpen = false; // the art shrinks back into the corner of the case
}

// ---- Pages ---------------------------------------------------------------------------------------------------------

function pageSize() {
  return Math.round(Math.max(240, Math.min(520, window.innerHeight - 150, (window.innerWidth - 100) / 2)));
}
function face(page, side) {
  const f = el('div', { class: `face ${side}` }, page);
  return f;
}
const blankPage = () => el('div', { class: 'page blank' });
const heading = (text, sub) => el('div', { class: 'page-head' }, el('div', { class: 'page-title' }, text), sub ? el('div', { class: 'page-sub' }, sub) : null);

// The album's colours: AUTO's palette from the cover art (so each booklet is printed differently).
function applyColors(node, cover) {
  const t = deriveAutoTheme(cover);
  const s = node.style;
  s.setProperty('--b-paper', rgb(t.card));
  s.setProperty('--b-ink', rgb(t.text));
  s.setProperty('--b-muted', rgb(t.muted));
  s.setProperty('--b-accent', rgb(t.accent));
  s.setProperty('--b-accent2', rgb(t.accent2));
}

function frontCover(app) {
  const d = app.state.details;
  if (app.state.cover) return el('div', { class: 'page cover' }, el('img', { src: app.state.cover.src, alt: '' }));
  // No art at all: a blank CD-R with the title written on in marker.
  return el('div', { class: 'page cover cdr' }, el('div', { class: 'marker' }, d.title), d.artist ? el('div', { class: 'marker small' }, d.artist) : null);
}

// This album's tracks from the queue (same album tag), or the whole queue when the song has no album.
function albumTracks(app) {
  const { state } = app, d = state.details;
  const all = state.queue.map((p, i) => ({ p, i, d: app.detailsFor(p) }));
  const same = d.album ? all.filter((t) => t.d && t.d.album === d.album) : [];
  return same.length ? same : all;
}

async function insidePages(app, spread, size) {
  const { state } = app, d = state.details;
  const pages = [];
  const sizer = el('div', { class: 'page measuring' });
  Object.assign(sizer.style, { width: `${size}px`, height: `${size}px` });
  spread.append(sizer);
  // Fills pages with rows while they fit, measuring each in an invisible page of the same size.
  const layout = (head, rows) => paginate(rows, (onPage) => {
    sizer.replaceChildren(head(), el('div', { class: 'page-body' }, onPage.map((r) => r())));
    return sizer.scrollHeight <= sizer.clientHeight;
  }).map((onPage, n) => el('div', { class: 'page' }, head(n), el('div', { class: 'page-body' }, onPage.map((r) => r()))));

  // Tracklist.
  const tracks = albumTracks(app);
  const title = d.album || 'IN THE QUEUE';
  pages.push(...layout((n) => heading(n ? `${title} (cont.)` : title, n ? null : d.artist), tracks.map((t, k) => () => {
    const current = t.i === state.index;
    const row = el('div', { class: `track${current ? ' current' : ''}`, 'data-play': t.i, title: `Play ${app.queueDisplay(t.p)}` },
      el('span', { class: 'no' }, String(k + 1).padStart(2, '0')),
      el('span', { class: 'name' }, t.d ? t.d.title : app.displayName(t.p)),
      el('span', { class: 'time' }, t.d && t.d.duration ? app.formatTime(t.d.duration) : ''));
    row.addEventListener('click', (e) => { e.stopPropagation(); app.playQueueIndex(t.i); });
    return row;
  })));

  // Lyrics.
  if (state.lyrics) {
    const synced = parseLrc(state.lyrics);
    const lines = synced.length ? synced.map((l, i) => ({ text: l.text, i })) : formatLyricsForDisplay(state.lyrics).split('\n').map((text) => ({ text }));
    pages.push(...layout((n) => heading(n ? 'LYRICS (cont.)' : 'LYRICS', n ? null : d.title), lines.map((l) => () => {
      const line = el('div', { class: `lyric${l.text ? '' : ' gap'}` }, l.text || ' ');
      if (l.i != null) line.dataset.line = l.i;
      return line;
    })));
  }

  // Credits and this disc.
  const c = d.credits || {};
  const plays = await app.cdp.playCount(state.loadedPath).catch(() => 0);
  const rows = [
    ['WRITTEN BY', [c.composer, c.lyricist && c.lyricist !== c.composer ? c.lyricist : null].filter(Boolean).join(' · ')],
    ['PRODUCED BY', c.producer], ['CONDUCTED BY', c.conductor], ['ALBUM ARTIST', c.albumArtist !== d.artist ? c.albumArtist : null],
    ['RELEASED', c.released], ['GENRE', c.genre], ['LABEL', c.label], ['CATALOG NO.', c.catalog],
    ['TRACK', c.track ? `${c.track.no}${c.track.of ? ` of ${c.track.of}` : ''}` : null],
    ['DISC', c.disc ? `${c.disc.no} of ${c.disc.of}` : null], ['BPM', c.bpm],
  ].filter(([, v]) => v);
  const disc = [
    ['FORMAT', d.quality || d.ext], ['LENGTH', app.formatTime(d.duration || app.engine.duration)],
    ['COVER', app.coverSource()], ['LYRICS', state.lyrics ? (d.lyrics ? 'In the file' : 'lrclib.net') : null],
    ['PLAYED', plays ? `${plays} ${plays === 1 ? 'time' : 'times'}` : null],
  ].filter(([, v]) => v);
  const dl = (list) => el('dl', { class: 'credits' }, list.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))]));
  pages.push(el('div', { class: 'page' }, heading('CREDITS', d.title), el('div', { class: 'page-body' },
    rows.length ? dl(rows) : el('div', { class: 'none' }, 'No credits in this file’s tags.'),
    el('div', { class: 'page-title small' }, 'THIS DISC'), dl(disc))));

  sizer.remove();
  return pages;
}

function backCover(app) {
  const { state } = app, d = state.details, c = d.credits || {};
  const tracks = albumTracks(app);
  const total = tracks.reduce((s, t) => s + ((t.d && t.d.duration) || 0), 0);
  const code = ean13(c.barcode);
  return el('div', { class: 'page back-cover' },
    el('div', { class: 'back-title' }, d.album || d.title),
    d.artist ? el('div', { class: 'back-artist' }, c.albumArtist || d.artist) : null,
    el('ol', { class: 'back-tracks' }, tracks.slice(0, 20).map((t) => el('li', {}, t.d ? t.d.title : app.displayName(t.p)))),
    el('div', { class: 'back-total' }, `${tracks.length} ${tracks.length === 1 ? 'TRACK' : 'TRACKS'}${total ? ` · ${app.formatTime(total)}` : ''}`),
    el('div', { class: 'small-print' },
      c.copyright ? el('div', {}, /[©℗]/.test(c.copyright) ? c.copyright : `℗ © ${c.copyright}`) : null,
      c.label || c.catalog ? el('div', {}, [c.label, c.catalog].filter(Boolean).join(' · ')) : null,
      code ? barcode(code) : null,
      el('div', { class: 'made-with' }, 'PLAYED ON CDPLAYER')));
}

function barcode({ digits, bits }) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${bits.length} 30`);
  svg.setAttribute('class', 'barcode');
  svg.setAttribute('preserveAspectRatio', 'none');
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    const bar = document.createElementNS(NS, 'rect');
    bar.setAttribute('x', i); bar.setAttribute('width', 1); bar.setAttribute('height', 30);
    svg.append(bar);
  }
  return el('div', { class: 'barcode-box' }, svg, el('div', { class: 'barcode-digits' }, digits));
}

// Synced lyrics: the line being sung is highlighted on the lyrics pages while the booklet is open.
function startLyricsHighlight(app) {
  const lines = app.state.lyrics ? parseLrc(app.state.lyrics) : [];
  if (!lines.length) return;
  let last = -2;
  book.lyricsTimer = setInterval(() => {
    if (!book) return;
    const i = currentLineIndex(lines, app.engine.position);
    if (i === last) return;
    last = i;
    book.spread.querySelectorAll('.lyric.now').forEach((n) => n.classList.remove('now'));
    book.spread.querySelectorAll(`.lyric[data-line="${i}"]`).forEach((n) => n.classList.add('now'));
  }, 200);
}
