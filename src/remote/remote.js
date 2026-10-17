// The phone remote's page: what the PC is playing on a turning disc, the shelf as a list with its cases, and the queue
// or the changer. Everything it shows comes from the PC (GET /events, the state as it changes); everything pressed goes
// back as a command (POST /command) — and only while it's connected: a press while it's down is never sent later.
import { colors } from './js/theme.js';
import { Disc } from './js/disc.js';
import { glyphSvg } from './js/glyphs.js';
import { t, translatePage } from './js/i18n.js';
import { moveItem } from './js/queue-move.js';
import {
  PHONE_SORTS, nextSort, sortLabel, shelfRows, dropTarget, connectionAfter, canSend, connectionWords, retryDelay,
  outcome, errorWords, modeWords, badges, formatTime, livePosition, discHeading, pickableSlots,
} from './js/remote-view.js';

translatePage(document);
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
// A cover by its URL: lazily, and left blank when there's none.
function coverImg(src) {
  const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.remove());
  img.src = src;
  return img;
}

let real = null;    // the last state the PC sent
let shown = null;   // what's on screen: `real`, or a reorder made here and not yet answered
let heardAt = 0;
let conn = 'connecting';
let tab = 'playing';

// ---- Talking to the PC --------------------------------------------------------------------------------------

let source = null, retryTimer = null, hiddenAt = 0;
function connect() {
  clearTimeout(retryTimer); retryTimer = null;
  if (source) source.close();
  const es = new EventSource('/events');
  source = es;
  es.addEventListener('state', (e) => {
    if (source !== es) return;
    let s;
    try { s = JSON.parse(e.data); } catch { return; }
    setConnection({ type: 'state' });
    take(s);
  });
  es.addEventListener('closed', (e) => {
    if (source !== es) return;
    let reason = 'quit';
    try { reason = JSON.parse(e.data).reason; } catch { /* as quit */ }
    es.close(); source = null;
    setConnection({ type: 'closed', reason });
    tryLater();
  });
  // Not reachable, or refused (503 while the player's page reloads; 401 when the code changed): the page tries again
  // itself, so a refusal doesn't end it — and it asks once whether it's still paired.
  es.addEventListener('error', () => {
    if (source !== es) return;
    es.close(); source = null;
    setConnection({ type: 'error' });
    fetch('/cover/now', { cache: 'no-store' }).then((r) => { if (r.status === 401) setConnection({ type: 'unpaired' }); }).catch(() => {}).finally(tryLater);
  });
}
function tryLater() {
  clearTimeout(retryTimer); retryTimer = null;
  const wait = retryDelay(conn);
  if (wait === null || document.hidden || conn === 'live') return; // looked at again: connect() then
  retryTimer = setTimeout(connect, wait);
}
// A locked phone freezes the page (iOS) and its connection may be dead without saying so: opened again on return.
// Back after a long while, what's on screen may be minutes old: dimmed, and nothing pressed, until a fresh state.
// Hidden, nothing still on its way goes out later (iOS holds requests while the Wi-Fi comes back).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); for (const c of inFlight) c.abort(); return; }
  const long = hiddenAt && Date.now() - hiddenAt > 20000;
  hiddenAt = 0;
  if (long) setConnection({ type: 'resume' });
  if (long || !source || source.readyState === EventSource.CLOSED) connect();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) connect(); });

function setConnection(event) {
  conn = connectionAfter(conn, event);
  const words = connectionWords(conn);
  $('banner').textContent = words;
  $('banner').hidden = !words;
  document.body.classList.toggle('offline', !canSend(conn));
  if (!canSend(conn)) endDrag(false);
}

/** Sends a command, if connected (else nothing: never later). `rev`: the music as the press saw it. → its outcome. */
const COMMAND_MS = 4000; // an answer not back by then: not sent, as far as the page is concerned (never sent again)
const inFlight = new Set();
async function send(action, value, rev) {
  if (!canSend(conn) || !real) return { kind: 'dropped' };
  const body = { action };
  if (value !== undefined) body.value = value;
  if (rev !== undefined) body.rev = rev;
  let status = 0, data = null;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), COMMAND_MS); // (AbortSignal.timeout: iOS 16+ only)
  inFlight.add(ctl);
  try {
    // The server checks Origin. Under the page's own Referrer-Policy (no-referrer) the Fetch standard may send a POST's
    // Origin as "null", so this request's policy is same-origin: its origin goes, to this server only.
    const r = await fetch('/command', {
      method: 'POST', cache: 'no-store', referrerPolicy: 'same-origin', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'X-CDP': '1' }, body: JSON.stringify(body),
    });
    status = r.status;
    data = await r.json().catch(() => null);
  } catch { /* not reached, or given up on */ } finally { clearTimeout(timer); inFlight.delete(ctl); }
  const o = outcome(status, data);
  if (o.kind === 'error') {
    if (o.error === 'unpaired') setConnection({ type: 'unpaired' });
    flash(errorWords(o.error));
  }
  return o; // 'stale': the PC's music changed since — the next state shows it; nothing is sent again
}
const sendNow = (action, value) => send(action, value);
const sendAt = (action, value) => send(action, value, real.rev);

// ---- The state ------------------------------------------------------------------------------------------------

const drawnKeys = {};
function changed(name, value) {
  const key = JSON.stringify(value);
  if (drawnKeys[name] === key) return false;
  drawnKeys[name] = key;
  return true;
}
function take(s) {
  real = s; shown = s; heardAt = performance.now();
  document.body.classList.remove('waiting');
  if (s.colors && changed('colors', s.colors)) {
    for (const k of ['accent', 'accent2']) {
      colors[k] = s.colors[k];
      document.documentElement.style.setProperty(`--${k}`, s.colors[k].join(', '));
    }
  }
  drawPlaying();
  drawTabs();
  if (!drag) drawQueue();
  drawChanger();
  if (!$('case').hidden) $('case-add').textContent = s.changerMode ? t('INTO THE CHANGER') : t('ADD TO QUEUE');
}

// ---- Tabs -------------------------------------------------------------------------------------------------------

function drawTabs() {
  const changer = !!(real && real.changerMode);
  $('tab-third').textContent = changer ? t('CHANGER') : t('QUEUE');
  showViews(); // the third tab follows the mode
}
function showViews() {
  const third = real && real.changerMode ? 'changer' : 'queue';
  const view = tab === 'third' ? third : tab;
  for (const v of ['playing', 'shelf', 'queue', 'changer']) $(`view-${v}`).hidden = v !== view;
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
}
function showTab(name) {
  tab = name;
  showViews();
  if (name === 'shelf') openShelf(); else closeCase();
  $('toast').hidden = true;
}
for (const b of $('tabs').children) b.addEventListener('click', () => showTab(b.dataset.tab));

// The status line says what happened for a moment (an error), then the player's own words again.
let flashUntil = 0, flashTimer = null;
function flash(words) {
  if (!words) return;
  flashUntil = performance.now() + 3000;
  $('status').textContent = words;
  if (tab !== 'playing') { $('toast').textContent = words; $('toast').hidden = false; }
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashUntil = 0; $('toast').hidden = true; drawPlaying(); }, 3000);
}

// ---- PLAYING ----------------------------------------------------------------------------------------------------

$('prev').append(glyphSvg('REWIND', 34));
$('next').append(glyphSvg('FAST_FORWARD', 34));
$('shuffle').prepend(glyphSvg('SHUFFLE', 26));
$('repeat').prepend(glyphSvg('REPEAT', 26));
let playGlyph = null;
function setPlayGlyph(playing) {
  const name = playing ? 'SOLID_PAUSE' : 'SOLID_PLAY';
  if (playGlyph !== name) { playGlyph = name; $('play').replaceChildren(glyphSvg(name, 34)); }
}
setPlayGlyph(false);
$('play').addEventListener('click', () => sendNow('toggle'));
$('prev').addEventListener('click', () => sendNow('prev'));
$('next').addEventListener('click', () => sendNow('next'));
$('shuffle').addEventListener('click', () => sendNow('shuffle'));
$('repeat').addEventListener('click', () => sendNow('repeat'));
$('mute').addEventListener('click', () => sendNow('mute'));

// The cover printed on a disc that turns while it plays: the desktop's disc face (disc.js, as Mini Mode has it — no
// wear, no shine), turned here at the size the phone has room for.
const canvas = $('disc');
const disc = new Disc(canvas);
disc.setMode('mini');
disc.setShine(false);
disc.onMiniClick = () => sendNow('toggle');
let coverKey, angle = 0, speed = 0, lastFrame = performance.now(), lastLook = '';
function drawDisc(now) {
  const dt = Math.min(100, now - lastFrame); lastFrame = now;
  requestAnimationFrame(drawDisc);
  if (tab !== 'playing') return;
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (!r.width) return;
  const playing = !!(real && real.playing);
  speed += ((playing ? 1 : 0) - speed) * (1 - Math.exp(-dt / 260));
  if (speed < 0.002 && !playing) speed = 0;
  angle += 0.045 * speed * (dt / 16);
  const pw = Math.round(r.width * dpr);
  if (canvas.width !== pw) { canvas.width = pw; canvas.height = pw; }
  const side = Math.floor(r.width) - 8, c = r.width / 2;
  const look = [pw, angle, speed, disc.coverVersion, disc.label && disc.label.title].join('|');
  if (look === lastLook) return;
  lastLook = look;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.width);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  g.beginPath(); g.arc(c, c, side / 2 + 4, 0, Math.PI * 2); g.fill();
  g.save();
  g.translate(c, c); g.rotate(angle); g.translate(-c, -c);
  g.imageSmoothingQuality = 'high';
  try {
    g.drawImage(disc.renderFace(side, dpr).canvas, c - side / 2, c - side / 2, side, side);
  } catch { // no OffscreenCanvas (an old browser): the cover in a circle, or a plain disc
    g.beginPath(); g.arc(c, c, side / 2, 0, Math.PI * 2); g.arc(c, c, side * 0.18, 0, Math.PI * 2, true); g.clip('evenodd');
    if (disc.cover) g.drawImage(disc.cover, c - side / 2, c - side / 2, side, side);
    else { g.fillStyle = 'rgb(170,174,182)'; g.fill(); }
  }
  g.restore();
  if (speed < 0.99) { // stopped, it sits a little darker, as on the desktop
    g.fillStyle = `rgba(10,11,16,${(0.35 * (1 - speed)).toFixed(3)})`;
    g.beginPath(); g.arc(c, c, side / 2, 0, Math.PI * 2); g.fill();
  }
}
requestAnimationFrame(drawDisc);

function hasSong(s) { return s.changerMode ? !!s.changer && s.changer.playing >= 0 : s.index >= 0; }
function drawPlaying() {
  const s = real;
  if (!s) return;
  $('title').textContent = s.track.title || '';
  $('subtitle').textContent = [s.track.artist, s.track.album].filter(Boolean).join(' — ');
  if (performance.now() >= flashUntil) $('status').textContent = s.status || '';
  setPlayGlyph(s.playing);
  const b = badges(s);
  $('shuffle').classList.toggle('on', s.shuffle !== 'OFF');
  $('repeat').classList.toggle('on', s.repeat !== 'OFF');
  $('shuffle').querySelector('.badge').textContent = b.shuffle;
  $('repeat').querySelector('.badge').textContent = b.repeat;
  $('modes').textContent = modeWords(s);
  $('mute').classList.toggle('on', s.muted || s.volume === 0);
  if (!volume.held && performance.now() > volumeKeptUntil) showVolume(s.volume);
  disc.setLabel(hasSong(s) ? s.track.title : null, s.track.artist);
  if (s.track.coverKey !== coverKey) {
    const key = s.track.coverKey;
    coverKey = key;
    if (!key) disc.setCover(null);
    else {
      const img = new Image();
      img.src = `/cover/now?v=${encodeURIComponent(key)}`;
      img.decode().then(() => { if (coverKey === key) disc.setCover(img); }, () => { if (coverKey === key) disc.setCover(null); });
    }
  }
  drawTime();
}

// A bar to drag along (the seek bar, the volume): it follows the finger, and says where it was let go.
function slider(bar, { onMove, onRelease }) {
  const state = { held: false };
  const at = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  bar.addEventListener('pointerdown', (e) => {
    if (!canSend(conn) || !real) return;
    state.held = true; bar.classList.add('held');
    try { bar.setPointerCapture(e.pointerId); } catch { /* gone */ }
    onMove(at(e));
  });
  bar.addEventListener('pointermove', (e) => { if (state.held) onMove(at(e)); });
  const up = (e, done) => {
    if (!state.held) return;
    state.held = false; bar.classList.remove('held');
    if (done && canSend(conn)) onRelease(at(e)); else drawPlaying();
  };
  bar.addEventListener('pointerup', (e) => up(e, true));
  bar.addEventListener('pointercancel', (e) => up(e, false));
  return state;
}
const setBar = (bar, f) => {
  bar.querySelector('.fill').style.width = `${f * 100}%`;
  bar.querySelector('.knob').style.left = `${f * 100}%`;
};

// Seek: sent when the finger lifts.
function showTime(position, duration) {
  setBar($('seek'), duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0);
  $('elapsed').textContent = formatTime(position);
  $('remaining').textContent = `-${formatTime(Math.max(0, duration - position))}`;
}
const seek = slider($('seek'), {
  onMove: (f) => showTime(f * real.duration, real.duration),
  onRelease: (f) => {
    if (!(real.duration > 0)) return;
    const to = f * real.duration;
    real = { ...real, position: to }; heardAt = performance.now(); // shown there until the PC says where it is
    showTime(to, real.duration);
    sendNow('seek', to);
  },
});
function drawTime() {
  if (!real || seek.held) return;
  showTime(livePosition(real, heardAt, performance.now()), real.duration);
}
setInterval(drawTime, 250);

// Volume: the app's own, where to (not by how much), as the finger moves — a few times a second — and where it lifts.
let volumeSentAt = 0, volumeKeptUntil = 0;
function showVolume(v) { setBar($('volume'), v / 100); $('volume-value').textContent = String(v); }
const volume = slider($('volume'), {
  onMove: (f) => {
    const v = Math.round(f * 100);
    showVolume(v);
    if (performance.now() - volumeSentAt > 150) { volumeSentAt = performance.now(); sendNow('volume', v); }
  },
  onRelease: (f) => {
    const v = Math.round(f * 100);
    showVolume(v);
    volumeKeptUntil = performance.now() + 1200; // the PC's answer is on its way
    sendNow('volume', v);
  },
});

// ---- SHELF -----------------------------------------------------------------------------------------------------

const shelf = { albums: null, reading: null, readAt: 0, sort: 'ARTIST' };
try { shelf.sort = localStorage.getItem('cdp-remote-sort') || 'ARTIST'; } catch { /* none kept */ }
if (!PHONE_SORTS.includes(shelf.sort)) shelf.sort = 'ARTIST';
$('sort').textContent = `⇅ ${sortLabel(shelf.sort)}`;
$('sort').addEventListener('click', () => {
  shelf.sort = nextSort(shelf.sort);
  try { localStorage.setItem('cdp-remote-sort', shelf.sort); } catch { /* not kept */ }
  $('sort').textContent = `⇅ ${sortLabel(shelf.sort)}`;
  drawShelf();
  $('shelf-list').scrollTop = 0;
});
let filterTimer = null;
$('filter').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(drawShelf, 120); });
$('filter').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// Read the first time SHELF opens (the PC reads its music folder then, if it hasn't), and again a minute later.
function openShelf() {
  if (shelf.reading || (shelf.albums && Date.now() - shelf.readAt < 60000)) return;
  if (!shelf.albums) {
    $('shelf-count').textContent = '';
    $('shelf-list').replaceChildren(el('div', { class: 'empty' }, t('READING THE SHELF…')));
  }
  shelf.reading = fetch('/api/albums', { cache: 'no-store' })
    .then((r) => { if (r.status === 401) setConnection({ type: 'unpaired' }); if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((list) => { shelf.albums = Array.isArray(list) ? list : []; shelf.readAt = Date.now(); drawShelf(); })
    .catch(() => { if (!shelf.albums) $('shelf-list').replaceChildren(el('div', { class: 'empty' }, t('COULDN’T READ THE SHELF · OPEN SHELF AGAIN'))); })
    .finally(() => { shelf.reading = null; });
}
function drawShelf() {
  if (!shelf.albums) return;
  const query = $('filter').value, n = shelf.albums.length;
  const rows = shelfRows(shelf.albums, { query, sort: shelf.sort });
  const count = rows.filter((r) => r.album).length;
  $('shelf-count').textContent = [n === 1 ? t('1 ALBUM') : t('{n} ALBUMS', { n }), query.trim() ? t('{n} SHOWN', { n: count }) : null].filter(Boolean).join(' · ');
  const list = $('shelf-list');
  if (!n) { list.replaceChildren(el('div', { class: 'empty' }, t('No music in this folder yet.'))); return; }
  if (!count) { list.replaceChildren(el('div', { class: 'empty' }, t('Nothing on the shelf for “{query}”.', { query: query.trim() }))); return; }
  const out = document.createDocumentFragment();
  for (const r of rows) {
    if (r.divider) { out.append(el('div', { class: 'divider' }, r.divider)); continue; }
    const a = r.album;
    const item = el('div', { class: `album${r.dusty ? ' dusty' : ''}`, onClick: () => openCase(a) },
      el('div', { class: 'thumb' }, coverImg(`/cover/${a.id}`)),
      el('div', { class: 'texts' },
        el('div', { class: 'a-title line' }, a.title || ''),
        el('div', { class: 'a-sub line' }, [a.artist, a.year].filter(Boolean).join(' · '))),
      r.isNew ? el('span', { class: 'sticker-new' }, t('NEW')) : null);
    if (Array.isArray(a.color)) item.style.setProperty('--spine', `rgb(${a.color.join(',')})`);
    out.append(item);
  }
  list.replaceChildren(out);
}

// An album's case, full-screen: its cover, its songs (a tap plays from there), and the desktop case's buttons.
let caseAlbum = null;
function openCase(a) {
  caseAlbum = a;
  $('case-add').textContent = real && real.changerMode ? t('INTO THE CHANGER') : t('ADD TO QUEUE');
  const tracks = el('div', { class: 'list' }, el('div', { class: 'empty' }, '…'));
  $('case-body').replaceChildren(
    el('div', { class: 'case-cover' }, coverImg(`/cover/${a.id}`)),
    el('div', { class: 'case-title' }, a.title || ''),
    el('div', { class: 'case-artist' }, [a.artist, a.year].filter(Boolean).join(' · ')),
    el('div', { class: 'case-meta' }, a.n === 1 ? t('1 TRACK') : t('{n} TRACKS', { n: a.n })),
    tracks);
  $('case-body').scrollTop = 0;
  $('case').hidden = false;
  sheetsShown();
  fetch(`/api/album/${a.id}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((album) => {
      if (caseAlbum !== a) return;
      if (!album) { tracks.replaceChildren(el('div', { class: 'empty' }, t('NOT THERE ANY MORE'))); return; }
      const discs = new Set(album.tracks.map((x) => x.disc || 1)).size > 1;
      let lastDisc = null;
      const rows = [];
      album.tracks.forEach((x, k) => {
        if (discs && (x.disc || 1) !== lastDisc) { lastDisc = x.disc || 1; rows.push(el('div', { class: 'disc-header' }, t('DISC {n}', { n: lastDisc }))); }
        rows.push(el('div', { class: 'row', onClick: () => putIn('play', k) },
          el('span', { class: 'num' }, `${x.track || k + 1}.`),
          el('span', { class: 'entry line' }, x.title || ''),
          el('span', { class: 'duration' }, x.duration ? formatTime(x.duration) : '')));
      });
      tracks.replaceChildren(...rows);
    })
    .catch(() => { if (caseAlbum === a) tracks.replaceChildren(el('div', { class: 'empty' }, errorWords('failed'))); });
}
function closeCase() { caseAlbum = null; $('case').hidden = true; closePicker(); }
// The toast (an error's words) stands above an open sheet's buttons, not under them.
function sheetsShown() { document.body.classList.toggle('sheet-open', !$('case').hidden || !$('picker').hidden); }
$('case-back').addEventListener('click', closeCase);
$('case-next').addEventListener('click', () => putIn('next'));
$('case-add').addEventListener('click', () => putIn('add'));
$('case-play').addEventListener('click', () => putIn('play'));

// PLAY · PLAY NEXT · ADD as the desktop's case does them. A full changer asks here, not on the PC: which disc goes back.
async function putIn(how, track, slot, rev = real && real.rev) {
  if (!caseAlbum || !real) return;
  const a = caseAlbum;
  const value = { id: a.id, how };
  if (track !== undefined) value.track = track;
  if (slot !== undefined) value.slot = slot;
  const o = await send('album', value, rev);
  if (o.kind === 'full') { askSlot(pickableSlots(o.slots), (s) => putIn(how, track, s, rev)); return; }
  if (o.kind !== 'ok' || caseAlbum !== a) return;
  closeCase();
  if (how === 'play') showTab('playing');
}
function askSlot(slots, pick) {
  $('picker-list').replaceChildren(...slots.map((s) => el('div', { class: 'row', onClick: () => { closePicker(); pick(s.slot); } },
    el('div', { class: 'thumb' }, s.cover ? el('img', { alt: '', src: s.cover }) : null),
    el('div', { class: 'texts' },
      el('div', { class: 'a-title line' }, [t('DISC {n}', { n: s.slot + 1 }), s.title].filter(Boolean).join(' · ')),
      el('div', { class: 'a-sub line' }, s.artist || '')))));
  $('picker').hidden = false;
  sheetsShown();
}
function closePicker() { $('picker').hidden = true; sheetsShown(); }
$('picker-cancel').addEventListener('click', closePicker);

// ---- QUEUE -----------------------------------------------------------------------------------------------------

$('clear').addEventListener('click', () => sendNow(real && real.canUndo ? 'undo' : 'clear'));
function drawQueue(force = false) {
  const s = shown;
  if (!s || s.changerMode) return;
  const empty = !s.queue.length || s.index < 0;
  $('queue-info').textContent = empty ? t('QUEUE EMPTY') : t('QUEUE {at} / {of}', { at: s.index + 1, of: s.queue.length });
  $('clear').textContent = s.canUndo ? t('UNDO CLEAR') : t('CLEAR');
  $('clear').classList.toggle('on', !!s.canUndo);
  $('clear').disabled = !s.queue.length && !s.canUndo;
  if (!changed('queue', [s.queue, s.index]) && !force) return;
  const list = $('queue-list'), top = list.scrollTop;
  if (empty) { list.replaceChildren(el('div', { class: 'empty' }, t('QUEUE EMPTY'))); return; }
  list.replaceChildren(...s.queue.map((q, i) => {
    const grip = el('span', { class: 'grip', 'aria-hidden': 'true' }, '≡');
    const remove = el('button', { class: 'remove', title: t('Remove from queue'), onClick: (e) => { e.stopPropagation(); sendAt('remove', i); } }, '×');
    const item = el('div', { class: `row${i === s.index ? ' active' : ''}`, onClick: (e) => { if (e.target !== grip) sendAt('playIndex', i); } },
      grip,
      el('span', { class: 'num' }, `${i + 1}.`),
      el('span', { class: 'entry line' }, q.title || ''),
      q.next ? el('span', { class: 'next-tag', title: t('Plays next') }, t('NEXT')) : null,
      el('span', { class: 'duration' }, q.duration ? formatTime(q.duration) : ''),
      remove);
    grip.addEventListener('pointerdown', (e) => startDrag(e, i, item, grip));
    return item;
  }));
  list.scrollTop = top;
}

// Reordering by the ≡ grip only (a drag on the row would fight the scrolling): the row follows the finger, the others
// make room, and one move goes when it's let go — for the music as it was when the row was taken (`rev`).
let drag = null;
function startDrag(e, from, item, grip) {
  if (!canSend(conn) || !real || drag) return;
  e.preventDefault();
  try { grip.setPointerCapture(e.pointerId); } catch { /* gone */ }
  const list = $('queue-list');
  drag = { from, to: from, id: e.pointerId, y: e.clientY, startY: e.clientY, startScroll: list.scrollTop, item, grip,
    rows: [...list.children], h: item.offsetHeight || 52, rev: real.rev, base: shown, raf: 0 };
  item.classList.add('lifted');
  list.classList.add('dragging');
  const scroll = () => { // near the list's top or bottom edge, it scrolls on
    if (!drag) return;
    const r = list.getBoundingClientRect();
    if (drag.y < r.top + 48) list.scrollTop -= 8; else if (drag.y > r.bottom - 48) list.scrollTop += 8;
    place();
    drag.raf = requestAnimationFrame(scroll);
  };
  drag.raf = requestAnimationFrame(scroll);
}
function place() {
  const d = drag, list = $('queue-list');
  const dy = d.y - d.startY + (list.scrollTop - d.startScroll);
  d.to = dropTarget(d.from, dy, d.h, d.rows.length);
  d.item.style.transform = `translateY(${dy}px)`;
  d.rows.forEach((r, k) => {
    if (k === d.from) return;
    const shift = d.from < k && k <= d.to ? -d.h : d.to <= k && k < d.from ? d.h : 0;
    r.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}
document.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) { drag.y = e.clientY; place(); } });
document.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) endDrag(true); });
document.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) endDrag(false); });
async function endDrag(commit) {
  const d = drag;
  if (!d) return;
  drag = null;
  cancelAnimationFrame(d.raf);
  $('queue-list').classList.remove('dragging');
  d.item.classList.remove('lifted');
  for (const r of d.rows) r.style.transform = '';
  if (!commit || d.to === d.from || !canSend(conn)) { shown = real; drawQueue(true); return; }
  // Shown moved at once; the PC's next state confirms it — or, refused (the music changed since), the rows go back
  // to how the PC has them.
  const base = d.base;
  const moved = moveItem(base.queue, base.index, d.from, d.to);
  shown = { ...base, queue: moved.queue, index: moved.index };
  drawQueue(true);
  const o = await send('move', { from: d.from, to: d.to }, d.rev);
  if (o.kind !== 'ok' && !drag) { shown = real; drawQueue(true); }
}

// ---- CHANGER ---------------------------------------------------------------------------------------------------

$('disc-skip').addEventListener('click', () => sendNow('discSkip'));
function drawChanger() {
  const s = real;
  if (!s || !s.changerMode || !s.changer) return;
  const c = s.changer;
  if (changed('slots', c.slots.map((d) => d && [d.title, d.artist, d.cover, d.done, d.next]).concat(c.playing))) {
    $('slots').replaceChildren(...c.slots.map((d, k) => el('button', {
      class: `slot${d ? '' : ' empty'}${k === c.playing ? ' playing' : ''}${d && d.done ? ' done' : ''}`,
      title: d ? [d.title, d.artist].filter(Boolean).join(' · ') : null,
      disabled: !d, onClick: () => sendAt('playSlot', k),
    },
    el('span', { class: 'cover' }, d && d.cover ? el('img', { alt: '', src: d.cover }) : null),
    el('span', { class: 'no' }, String(k + 1)),
    d && d.next ? el('span', { class: 'next-tag' }, t('NEXT')) : null)));
  }
  $('changer-heading').textContent = discHeading(c) || (c.slots.some(Boolean) ? '' : t('CHANGER EMPTY'));
  $('disc-skip').disabled = c.playing < 0 || c.slots.filter(Boolean).length < 2;
  if (!changed('changer-tracks', c.tracks)) return;
  const list = $('changer-list');
  list.replaceChildren(...c.tracks.map((x, k) => el('div', { class: `row${x.current ? ' active' : ''}`, onClick: () => sendAt('playIndex', x.index) },
    el('span', { class: 'num' }, `${k + 1}.`),
    el('span', { class: 'entry line' }, x.title || ''),
    el('span', { class: 'duration' }, x.duration ? formatTime(x.duration) : ''))));
}

connect();
