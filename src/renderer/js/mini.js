// The mini player window: a remote control for the main window (which keeps doing the actual playback). It
// mirrors the state the main window sends, and sends back what the user presses. The disc keeps spinning.
import { colors } from './theme.js';
import { Disc } from './disc.js';
import { Visualizer } from './visualizer.js';
import { glyphSvg } from './glyphs.js';
import { shortcutKey } from './keys.js';

const cdp = window.cdp;
const $ = (id) => document.getElementById(id);
const send = (action, value) => cdp.sendMiniCommand({ action, value });
const formatTime = (sec) => { const s = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

if (!/Mac/.test(navigator.userAgent)) document.body.classList.add('opaque'); // no frosted window material there

const disc = new Disc($('disc'));
disc.setMode('mini');
disc.onMiniClick = () => send('toggle');
const vis = new Visualizer($('vis')); // always the plain bars here — a tiny live "now playing" indicator

$('prev').append(glyphSvg('REWIND', 30));
$('next').append(glyphSvg('FAST_FORWARD', 30));
$('shuffle').append(glyphSvg('SHUFFLE', 24));
$('repeat').prepend(glyphSvg('REPEAT', 24));
let playGlyph = null;
function setPlayGlyph(playing) {
  const name = playing ? 'SOLID_PAUSE' : 'SOLID_PLAY';
  if (playGlyph === name) return;
  playGlyph = name;
  $('play').replaceChildren(glyphSvg(name, 30));
}
setPlayGlyph(false);

$('close').addEventListener('click', () => send('exit'));
$('prev').addEventListener('click', () => send('prev'));
$('next').addEventListener('click', () => send('next'));
$('play').addEventListener('click', () => send('toggle'));
$('shuffle').addEventListener('click', () => send('shuffle'));
$('repeat').addEventListener('click', () => send('repeat'));
// Buttons never keep keyboard focus, so Space always means play/pause.
document.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

// ---- Seek bar ----------------------------------------------------------------------------------------------

const view = { position: 0, duration: 0, dragging: false };
function renderProgress(position) {
  const f = view.duration > 0 ? Math.max(0, Math.min(1, position / view.duration)) : 0;
  $('fill').style.width = `${f * 100}%`;
  $('knob').style.left = `${f * 100}%`;
  $('elapsed').textContent = formatTime(position);
  $('remaining').textContent = `-${formatTime(Math.max(0, view.duration - position))}`;
}
const bar = $('bar');
const positionAt = (e) => {
  const r = bar.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * view.duration;
};
bar.addEventListener('pointerdown', (e) => {
  if (!view.duration) return;
  view.dragging = true; bar.classList.add('dragging'); bar.setPointerCapture(e.pointerId);
  renderProgress(positionAt(e));
});
bar.addEventListener('pointermove', (e) => { if (view.dragging) renderProgress(positionAt(e)); });
const endDrag = (e) => {
  if (!view.dragging) return;
  view.dragging = false; bar.classList.remove('dragging');
  const target = positionAt(e);
  view.position = target;
  renderProgress(target);
  send('seek', target);
};
bar.addEventListener('pointerup', endDrag);
bar.addEventListener('pointercancel', endDrag);

// ---- State from the main window ------------------------------------------------------------------------------

let coverKey = null;
cdp.onMiniState(async (s) => {
  if (s.colors) {
    for (const k of Object.keys(s.colors)) {
      colors[k] = s.colors[k];
      document.documentElement.style.setProperty(`--${k}`, s.colors[k].join(', '));
    }
  }
  if ('animations' in s) document.body.classList.toggle('no-anim', !s.animations);
  if (s.track) {
    const t = s.track;
    $('title').textContent = t.title || 'Pick a track to get started.';
    $('subtitle').textContent = [t.artist, t.album].filter(Boolean).join(' — ');
    document.title = t.artist ? `${t.artist} – ${t.title}` : (t.title || 'CDPlayer');
    disc.lookingUp = !!t.lookingUp;
    if (t.coverKey !== coverKey && t.cover !== undefined) {
      coverKey = t.coverKey;
      let img = null;
      if (t.cover) { img = new Image(); img.src = t.cover; try { await img.decode(); } catch { img = null; } }
      if (coverKey === t.coverKey) disc.setCover(img);
    }
  }
  if ('playing' in s) { disc.spinning = s.playing; vis.setActive(s.playing); setPlayGlyph(s.playing); }
  if ('shuffle' in s) $('shuffle').classList.toggle('on', s.shuffle);
  if ('repeat' in s) {
    $('repeat').classList.toggle('on', s.repeat !== 'OFF');
    $('badge').textContent = s.repeat === 'ONE' ? '1' : '';
    $('repeat').title = s.repeat === 'OFF' ? 'Repeat' : s.repeat === 'ONE' ? 'Repeat: one track' : 'Repeat: whole queue';
  }
  if ('duration' in s) view.duration = s.duration;
  if ('position' in s) { view.position = s.position; if (!view.dragging) renderProgress(s.position); }
  if (s.levels) vis.setLevels(s.levels);
});

// ---- Keyboard: the same shortcuts as the full player; M or Esc goes back to it -------------------------------

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') { send('exit'); return; }
  const actions = {
    ' ': 'toggle', k: 'toggle', j: 'prev', l: 'next', u: 'mute', m: 'exit',
    ArrowLeft: ['seekBy', -5], ArrowRight: ['seekBy', 5], ArrowUp: ['volume', 5], ArrowDown: ['volume', -5],
  };
  const key = shortcutKey(e);
  const action = actions[key];
  if (!action) return;
  e.preventDefault();
  if (e.repeat && !key.startsWith('Arrow')) return;
  Array.isArray(action) ? send(...action) : send(action);
});

// ---- Render loop -------------------------------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(100, now - last); last = now;
  disc.frame(now, dt);
  vis.draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
send('sync');
