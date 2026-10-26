// The mini player window: a remote control for the main window (which keeps doing the actual playback). It
// mirrors the state the main window sends, and sends back what the user presses. The disc keeps spinning.
import { colors } from './theme.js';
import { Disc } from './disc.js';
import { Visualizer } from './visualizer.js';
import { glyphSvg } from './glyphs.js';
import { shortcutKey } from './keys.js';
import { t, translatePage } from './i18n.js';
import { spring } from './widgets.js';

const cdp = window.cdp;
translatePage(document);
const $ = (id) => document.getElementById(id);
const send = (action, value) => cdp.sendMiniCommand({ action, value });
const formatTime = (sec) => { const s = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };


const disc = new Disc($('disc'));
disc.setMode('mini');
disc.onMiniClick = () => send('toggle');
const vis = new Visualizer($('vis'), { spectrum: false }); // five plain bars — a tiny live "now playing" indicator

$('prev').append(glyphSvg('REWIND', 30));
$('next').append(glyphSvg('FAST_FORWARD', 30));
$('shuffle').append(glyphSvg('SHUFFLE', 24));
$('repeat').prepend(glyphSvg('REPEAT', 24));
let playGlyph = null;
function setPlayGlyph(playing) {
  const name = playing ? 'SOLID_PAUSE' : 'SOLID_PLAY';
  if (playGlyph === name) return;
  const first = !playGlyph;
  playGlyph = name;
  const g = glyphSvg(name, 30);
  if (!first) g.classList.add('swap'); // (the new one pops in)
  $('play').replaceChildren(g);
}
// Coming up, as the full player's panels do: out of a touch smaller, on a spring.
const SPRING = spring(0.8);
function appear() {
  if (document.body.classList.contains('no-anim')) return;
  $('panel').animate([{ opacity: 0, transform: 'translateY(-6px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: SPRING });
}
// A new song's name and artist rise in.
function rise(node, text) {
  if (node.textContent === text) return;
  node.textContent = text;
  node.classList.remove('rise'); void node.offsetWidth; node.classList.add('rise');
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
  if (s.appear) { shown = true; appear(); }
  if (s.hidden) shown = false;
  if ('shine' in s) disc.setShine(s.shine);
  if (s.track) {
    const track = s.track;
    rise($('title'), track.title || t('Pick a track to get started.'));
    rise($('subtitle'), [s.disc > 0 ? t('DISC {n}', { n: s.disc }) : null, [track.artist, track.album].filter(Boolean).join(' — ')].filter(Boolean).join(' · '));
    document.title = track.artist ? `${track.artist} – ${track.title}` : (track.title || 'CDPlayer');
    disc.lookingUp = !!track.lookingUp;
    disc.setLabel(track.loaded ? track.title : null, track.artist);
    if (track.coverKey !== coverKey && track.cover !== undefined) {
      coverKey = track.coverKey;
      let img = null;
      if (track.cover) { img = new Image(); img.src = track.cover; try { await img.decode(); } catch { img = null; } }
      if (coverKey === track.coverKey) {
        disc.setCover(img);
        if (img) $('wash').style.backgroundImage = `url("${img.src}")`;
        $('wash').classList.toggle('on', !!img);
      }
    }
  }
  if ('playing' in s) { disc.spinning = s.playing; vis.setActive(s.playing); setPlayGlyph(s.playing); }
  // The changer's modes: SHUFFLE OFF / DISC / ALL, REPEAT OFF / TRACK / DISC / ALL.
  if ('shuffle' in s) {
    $('shuffle').classList.toggle('on', s.shuffle !== 'OFF');
    $('shuffle').title = s.changerMode ? { OFF: t('Shuffle'), DISC: t('Shuffle: this disc'), ALL: t('Shuffle: all discs') }[s.shuffle] || t('Shuffle') : t('Shuffle');
  }
  if ('repeat' in s) {
    $('repeat').classList.toggle('on', s.repeat !== 'OFF');
    $('badge').textContent = s.repeat === 'TRACK' ? '1' : s.repeat === 'DISC' ? '◉' : '';
    $('repeat').title = (s.changerMode ? { OFF: t('Repeat'), TRACK: t('Repeat: this track'), DISC: t('Repeat: this disc'), ALL: t('Repeat: all discs') }
      : { OFF: t('Repeat'), TRACK: t('Repeat: this track'), ALL: t('Repeat: whole queue') })[s.repeat] || t('Repeat');
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

// The mini player floats over whatever you're doing: 30 frames a second is plenty for its small disc (and costs about
// half what 60 does), in use or not.
const BACKGROUND_FRAME_MS = 1000 / 30;
let last = performance.now(), shown = true;
function frame(now) {
  if (!shown) { setTimeout(() => requestAnimationFrame(frame), 250); last = now; return; } // (put away: the full player is up)
  if (now - last < BACKGROUND_FRAME_MS - 2) { requestAnimationFrame(frame); return; }
  const dt = Math.min(100, now - last); last = now;
  disc.frame(now, dt);
  vis.draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
send('sync');
