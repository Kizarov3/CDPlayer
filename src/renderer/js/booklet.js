// The CD booklet. With the full-size album art open over the jewel case, clicking the art lifts the booklet out of the
// case and opens it into a two-page spread: the front cover, the album's tracklist, the song's lyrics, the credits and
// the back cover with its small print — printed in the album's own colours. ← / → or clicking a page turns it; Esc or
// clicking outside puts it back in the case. Pages are HTML (real text), laid over the canvas-drawn case.
// The shelf opens an album's booklet the same way (albumBooklet): its whole tracklist, every song's lyrics (found
// online while it's open, slotting in without moving the page being read), and the album's credits.
import { el, anim } from './widgets.js';
import { deriveAutoTheme, rgb } from './theme.js';
import { parseLrc, formatLyricsForDisplay, currentLineIndex } from './lyrics.js';
import { paginate, leavesFor, ean13 } from './booklet-layout.js';
import { albumCredits, albumSummary, albumSmallPrint, sameAlbum, ownerMarks } from './booklet-content.js';
import { t } from './i18n.js';

const LIFT_MS = 420, TURN_MS = 650;
const layer = () => document.getElementById('overlays');
let book = null; // the open booklet: { root, spread, leaves, turned, from, app, content, lyricsTimer, closing }

export const isBookletOpen = () => !!book;
const wait = (ms) => new Promise((r) => setTimeout(r, anim.enabled ? ms : 0));

// ---- Opening, turning, closing ------------------------------------------------------------------------------------

/**
 * Opens a booklet rising out of `from` (the art's rectangle on screen): the current track's, or `content` (what
 * albumBooklet() gives).
 */
export async function openBooklet(app, from, content = null) {
  if (book || (!content && !app.state.details)) return;
  content = content || await songContent(app);
  const size = pageSize();
  const root = el('div', { class: 'booklet-layer' });
  const spread = el('div', { class: 'booklet' });
  Object.assign(spread.style, {
    width: `${size * 2}px`, height: `${size}px`,
    left: `${Math.round((window.innerWidth - size * 2) / 2)}px`, top: `${Math.round((window.innerHeight - size) / 2)}px`,
  });
  spread.style.setProperty('--page', `${size}px`);
  applyColors(spread, content.cover);
  root.append(spread);
  layer().append(root);

  book = { root, spread, leaves: [], turned: 0, from, app, content };
  buildLeaves();
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
  if (content.start) content.start();

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
  b.content.onClose();
}

/** An album booklet whose content changed (more lyrics found): its pages again, open at the page being read. */
export function refreshBooklet(content) {
  if (!book || book.closing || book.content !== content) return;
  const key = readingKey();
  book.leaves.forEach((leaf) => leaf.remove());
  buildLeaves();
  const found = spreadWith(key);
  const turned = found >= 0 ? found : Math.min(book.turned, book.leaves.length);
  book.turned = turned;
  keepReading(turned, key);
  book.leaves.forEach((leaf, i) => {
    leaf.style.transition = 'none';
    leaf.classList.toggle('turned', i < turned);
    void leaf.offsetWidth;
    leaf.style.transition = '';
  });
  book.lastLine = -2; // the new pages get the line being sung highlighted again
  stack();
}

// The page being read: the one the reader last turned to (the left page of the spread, or the right one at the front
// cover). Remembered at each turn — not worked out again from what's showing after pages were put in before it, when
// the page beside it can be one the reader never turned to.
const pageOn = (leaf, side) => { const page = leaf && leaf.querySelector(`.face.${side} .page`); return page ? page.dataset.key : null; };
function readingKey() {
  if (book.reading === undefined || book.reading.turned !== book.turned) {
    book.reading = { turned: book.turned, key: pageOn(book.leaves[book.turned - 1], 'back') || pageOn(book.leaves[book.turned], 'front') };
  }
  return book.reading.key;
}
// The spread (how many leaves turned) that shows the page with this key, on whichever side it has landed. → -1 if none.
function spreadWith(key) {
  if (!key) return -1;
  for (let i = 0; i < book.leaves.length; i++) {
    if (pageOn(book.leaves[i], 'back') === key) return i + 1;
    if (pageOn(book.leaves[i], 'front') === key) return i;
  }
  return -1;
}
// After a rebuild the reader is still on the page they turned to, even though it may now be the right-hand page.
function keepReading(turned, key) { book.reading = { turned, key }; }

function buildLeaves() {
  const { spread, content } = book;
  const size = spread.offsetHeight;
  book.leaves = leavesFor(frontCover(content), insidePages(content, spread, size), backCover(content), blankPage)
    .map((pages, i) => {
      const leaf = el('div', { class: 'leaf' }, face(pages.front, 'front'), face(pages.back, 'back'));
      leaf.dataset.index = i;
      spread.append(leaf);
      return leaf;
    });
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

// ---- What's printed ------------------------------------------------------------------------------------------------
// A booklet's content: { cover (an <img>, or null), marker: { title, artist } for a CD-R without one, tracks: {
// title, sub, rows: [{ name, time, current, tip, play() }] }, lyrics: [{ key, title, raw, live }] (live: the song
// playing, whose line being sung is highlighted), credits: { sub, rows, none, summaryTitle, summary }, back: { title,
// artist, names, count, total, copyright, label, catalog, barcode }, liveLyrics(): the playing song's lyrics or null,
// start(), onClose() }.

// This album's tracks from the queue (same album tag), or the whole queue when the song has no album.
function albumTracks(app) {
  const { state } = app, d = state.details;
  const all = state.queue.map((p, i) => ({ p, i, d: app.detailsFor(p) }));
  const same = d.album ? all.filter((t) => t.d && sameAlbum(t.d.album, d.album)) : [];
  return same.length ? same : all;
}

/** The current track's booklet. */
async function songContent(app) {
  const { state } = app, d = state.details, c = d.credits || {};
  const tracks = albumTracks(app);
  const total = tracks.reduce((s, t) => s + ((t.d && t.d.duration) || 0), 0);
  const plays = await app.cdp.playCount(state.loadedPath).catch(() => 0);
  return {
    cover: state.cover, marker: { title: d.title, artist: d.artist },
    tracks: {
      title: d.album || t('IN THE QUEUE'), sub: d.artist,
      rows: tracks.map((t) => ({
        name: t.d ? t.d.title : app.displayName(t.p), time: t.d && t.d.duration ? app.formatTime(t.d.duration) : '',
        current: t.i === state.index, tip: `Play ${app.queueDisplay(t.p)}`, play: () => app.playQueueIndex(t.i),
      })),
    },
    lyrics: state.lyrics ? [{ key: 'lyrics', title: t('LYRICS'), sub: d.title, raw: state.lyrics, live: true }] : [],
    credits: {
      sub: d.title, none: t('No credits in this file’s tags.'), summaryTitle: t('THIS DISC'),
      rows: [
        [t('WRITTEN BY'), [c.composer, c.lyricist && c.lyricist !== c.composer ? c.lyricist : null].filter(Boolean).join(' · ')],
        [t('PRODUCED BY'), c.producer], [t('CONDUCTED BY'), c.conductor], [t('ALBUM ARTIST'), c.albumArtist !== d.artist ? c.albumArtist : null],
        [t('RELEASED'), c.released], [t('GENRE'), c.genre], [t('LABEL'), c.label], [t('CATALOG NO.'), c.catalog],
        ['TRACK', c.track ? `${c.track.no}${c.track.of ? ` of ${c.track.of}` : ''}` : null],
        ['DISC', c.disc ? `${c.disc.no}${c.disc.of ? ` of ${c.disc.of}` : ''}` : null], ['BPM', c.bpm],
      ].filter(([, v]) => v),
      summary: [
        ['FORMAT', d.quality || d.ext], ['LENGTH', app.formatTime(d.duration || app.engine.duration)],
        [t('COVER'), app.coverSource()], [t('LYRICS'), state.lyrics ? state.lyricsSource || (d.lyrics ? t('In the file') : t('Online')) : null],
        ['PLAYED', plays ? `${plays} ${plays === 1 ? 'time' : 'times'}` : null],
      ].filter(([, v]) => v),
    },
    back: {
      title: d.album || d.title, artist: d.artist ? c.albumArtist || d.artist : null,
      names: tracks.map((t) => (t.d ? t.d.title : app.displayName(t.p))), count: tracks.length, total,
      copyright: c.copyright, label: c.label, catalog: c.catalog, barcode: c.barcode,
    },
    liveLyrics: () => app.state.lyrics,
    onClose: () => { app.disc.artOpen = false; }, // the art shrinks back into the corner of the case
  };
}

/**
 * The booklet of a shelf album ({ title, artist, year, discs, tracks: [{ path, title, duration }] }), with its cover
 * (an <img>, or null). `play(i)` plays the album from track i. Lyrics inside the files are there at once; the rest
 * are looked up online once it's open, a few at a time, and slot in as they're found.
 */
export async function albumBooklet(app, album, cover, { play, onClose = () => {} }) {
  const details = await Promise.all(album.tracks.map((t) => app.cdp.details(t.path, { withCover: false }).catch(() => null)));
  const plays = await Promise.all(album.tracks.map((t) => app.cdp.playCount(t.path).catch(() => 0)));
  const pressing = ((await app.cdp.discogsKnown([album.id]).catch(() => ({})))[album.id] || {}).info || null;
  const times = await app.cdp.playTimes(album.tracks.map((t) => t.path)).catch(() => ({ first: [], last: [] }));
  const marks = ownerMarks({ plays, first: album.tracks.map((t, i) => times.first[i] || null), last: album.tracks.map((t, i) => times.last[i] || null) });
  const small = albumSmallPrint(details);
  const playing = () => album.tracks.findIndex((t) => t.path === app.state.loadedPath);
  const found = album.tracks.map((t, i) => (details[i] && details[i].lyrics) || null);
  const content = {
    cover, marker: { title: album.title, artist: album.artist },
    tracks: {
      title: album.title, sub: [album.artist, album.year].filter(Boolean).join(' · '),
      rows: album.tracks.map((t, i) => ({
        name: t.title, time: t.duration ? app.formatTime(t.duration) : '', current: i === playing(), tip: `Play ${t.title}`, play: () => play(i),
        tally: marks.tallies[i], favorite: i === marks.favorite,
      })),
    },
    lyrics: [],
    credits: { sub: album.title, none: t('No credits in these files’ tags.'), rows: albumCredits(details, pressing), summaryTitle: t('THIS ALBUM'), summary: albumSummary({ details, plays, discs: album.discs }) },
    back: {
      title: album.title, artist: album.artist, names: album.tracks.map((t) => t.title), count: album.tracks.length,
      total: album.tracks.reduce((s, t) => s + (t.duration || 0), 0), ...small, notes: marks.notes,
    },
    // The playing song's lines are highlighted as they're sung — with the lyrics the player has for it.
    liveLyrics: () => { const i = playing(); return i >= 0 ? app.state.lyrics || found[i] : null; },
    onClose,
  };
  const setLyrics = () => {
    const live = playing();
    content.lyrics = album.tracks.map((t, i) => {
      const raw = i === live && app.state.lyrics ? app.state.lyrics : found[i];
      return raw ? { key: `lyrics:${i}`, title: t.title.toUpperCase(), sub: t.artist && t.artist !== album.artist ? t.artist : null, raw, live: i === live } : null;
    }).filter(Boolean);
  };
  setLyrics();
  content.start = () => {
    const missing = album.tracks.map((t, i) => i).filter((i) => !found[i] && details[i]);
    let next = 0;
    const worker = async () => {
      while (next < missing.length && book && book.content === content) {
        const i = missing[next++], d = details[i];
        const got = await app.cdp.findLyrics({ artist: d.artist || album.artist, title: d.title || album.tracks[i].title, album: d.album || album.title, duration: d.duration }).catch(() => null);
        if (got && got.lyrics) { found[i] = got.lyrics; setLyrics(); refreshBooklet(content); }
      }
    };
    for (let k = 0; k < 3; k++) worker();
  };
  return content;
}

function frontCover(content) {
  const { cover, marker } = content;
  const page = cover ? el('div', { class: 'page cover' }, el('img', { src: cover.src, alt: '' }))
    // No art at all: a blank CD-R with the title written on in marker.
    : el('div', { class: 'page cover cdr' }, el('div', { class: 'marker' }, marker.title), marker.artist ? el('div', { class: 'marker small' }, marker.artist) : null);
  page.dataset.key = 'cover';
  return page;
}

function insidePages(content, spread, size) {
  const pages = [];
  const sizer = el('div', { class: 'page measuring' });
  Object.assign(sizer.style, { width: `${size}px`, height: `${size}px` });
  spread.append(sizer);
  // Fills pages with rows while they fit, measuring each in an invisible page of the same size. Each page is keyed
  // (section and page number), so a booklet built again can open at the same page.
  const layout = (key, head, rows) => paginate(rows, (onPage) => {
    sizer.replaceChildren(head(), el('div', { class: 'page-body' }, onPage.map((r) => r())));
    return sizer.scrollHeight <= sizer.clientHeight;
  }).map((onPage, n) => {
    const page = el('div', { class: 'page' }, head(n), el('div', { class: 'page-body' }, onPage.map((r) => r())));
    page.dataset.key = `${key}:${n}`;
    return page;
  });

  // Tracklist.
  const { tracks } = content;
  pages.push(...layout('tracks', (n) => heading(n ? t('{title} (cont.)', { title: tracks.title }) : tracks.title, n ? null : tracks.sub), tracks.rows.map((t, k) => () => {
    const row = el('div', { class: `track${t.current ? ' current' : ''}${t.favorite ? ' favorite' : ''}`, 'data-play': k, title: t.tip },
      el('span', { class: 'no' }, String(k + 1).padStart(2, '0')),
      el('span', { class: 'name' }, el('span', { class: 'title' }, t.name)),
      t.tally ? tallyMarks(t.tally, k) : null, // beside the name, never cut off with a long one
      el('span', { class: 'time' }, t.time));
    row.addEventListener('click', (e) => { e.stopPropagation(); t.play(); });
    return row;
  })));

  // Lyrics: each song's on its own pages.
  for (const song of content.lyrics) {
    const synced = parseLrc(song.raw);
    const lines = synced.length ? synced.map((l, i) => ({ text: l.text, i })) : formatLyricsForDisplay(song.raw).split('\n').map((text) => ({ text }));
    pages.push(...layout(song.key, (n) => heading(n ? t('{title} (cont.)', { title: song.title }) : song.title, n ? null : song.sub), lines.map((l) => () => {
      const line = el('div', { class: `lyric${l.text ? '' : ' gap'}` }, l.text || ' ');
      if (l.i != null && song.live) line.dataset.line = l.i;
      return line;
    })));
  }

  // Credits, and this disc or album.
  const { credits } = content;
  const dl = (list) => el('dl', { class: 'credits' }, list.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))]));
  const page = el('div', { class: 'page' }, heading('CREDITS', credits.sub), el('div', { class: 'page-body' },
    credits.rows.length ? dl(credits.rows) : el('div', { class: 'none' }, credits.none),
    el('div', { class: 'page-title small' }, credits.summaryTitle), dl(credits.summary)));
  page.dataset.key = 'credits:0';
  pages.push(page);

  sizer.remove();
  return pages;
}

// Tally marks in pen beside a song: bundles of four strokes crossed by a fifth, then the odd ones — or "×47".
function tallyMarks(tally, k) {
  const pen = el('span', { class: 'pen tally', style: `transform: rotate(${((k * 37) % 7) - 3}deg)` });
  if (tally.times) { pen.textContent = tally.times; return pen; }
  for (let i = 0; i < tally.fives; i++) pen.append(el('span', { class: 'five' }, '||||'));
  if (tally.ones) pen.append(el('span', {}, '|'.repeat(tally.ones)));
  return pen;
}
function backCover(content) {
  const b = content.back;
  const code = ean13(b.barcode);
  const page = el('div', { class: 'page back-cover' },
    el('div', { class: 'back-title' }, b.title),
    b.artist ? el('div', { class: 'back-artist' }, b.artist) : null,
    el('ol', { class: 'back-tracks' }, b.names.slice(0, 20).map((name) => el('li', {}, name))),
    el('div', { class: 'back-total' }, [b.count === 1 ? t('1 TRACK') : t('{n} TRACKS', { n: b.count }), b.total ? formatTotal(b.total) : null].filter(Boolean).join(' · ')),
    el('div', { class: 'small-print' },
      b.copyright ? el('div', {}, /[©℗]/.test(b.copyright) ? b.copyright : `℗ © ${b.copyright}`) : null,
      b.label || b.catalog ? el('div', {}, [b.label, b.catalog].filter(Boolean).join(' · ')) : null,
      code ? barcode(code) : null,
      el('div', { class: 'made-with' }, t('PLAYED ON CDPLAYER'))),
    b.notes && b.notes.length ? el('div', { class: 'pen-notes' }, b.notes.map((n) => el('div', {}, n))) : null);
  page.dataset.key = 'back';
  return page;
}
const formatTotal = (seconds) => { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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
  let raw = null, lines = [];
  book.lastLine = -2;
  book.lyricsTimer = setInterval(() => {
    if (!book) return;
    const now = book.content.liveLyrics();
    if (now !== raw) { raw = now; lines = raw ? parseLrc(raw) : []; book.lastLine = -2; }
    if (!lines.length) return;
    const i = currentLineIndex(lines, app.lyricsPosition());
    if (i === book.lastLine) return;
    book.lastLine = i;
    book.spread.querySelectorAll('.lyric.now').forEach((n) => n.classList.remove('now'));
    book.spread.querySelectorAll(`.lyric[data-line="${i}"]`).forEach((n) => n.classList.add('now'));
  }, 200);
}
