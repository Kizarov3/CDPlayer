// Karaoke Mode (Y): the whole window becomes the song's lyrics, the line being sung big in the middle and filling in
// word by word as it's sung — per word where the lyrics have word timings (enhanced LRC, e.g. from Unison), a
// smooth sweep across the line where they only time whole lines. Click a line to jump there.
import { el, anim } from './widgets.js';
import { parseLrc, currentLineIndex, wordProgress } from './lyrics.js';

const $ = (id) => document.getElementById(id);
let view = null; // { lines, nodes, words: [[span]], current, lyrics }

export const isKaraokeOpen = () => !!view;
/** Karaoke needs timed lyrics: true when these lyrics have them. */
export const canKaraoke = (lyrics) => !!lyrics && parseLrc(lyrics).length > 0;

export function openKaraoke(app) {
  if (view || !canKaraoke(app.state.lyrics)) return false;
  const root = $('karaoke');
  root.hidden = false;
  if (anim.enabled) root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
  view = { app };
  rebuild();
  return true;
}

export function closeKaraoke() {
  if (!view) return;
  view = null;
  const root = $('karaoke');
  if (anim.enabled) root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).onfinish = () => { if (!view) root.hidden = true; };
  else root.hidden = true;
}

// New song (or new lyrics for it): the lines are laid out again. Without timed lyrics, karaoke closes.
export function refreshKaraoke() {
  if (!view) return;
  if (!canKaraoke(view.app.state.lyrics)) { closeKaraoke(); return; }
  if (view.lyrics !== view.app.state.lyrics) rebuild();
}

function rebuild() {
  const { app } = view;
  const d = app.state.details;
  view.lyrics = app.state.lyrics;
  view.lines = parseLrc(view.lyrics);
  view.words = [];
  // (An empty timed line is an instrumental break: shown as a note.)
  view.nodes = view.lines.map((line) => {
    const words = (line.words && line.words.length ? line.words : [{ text: line.text }]).map((w) => el('span', { class: 'k-word' }, w.text));
    view.words.push(words);
    return el('div', { class: `k-line${line.text ? '' : ' gap'}`, onClick: () => app.seekTo(line.time) }, line.text ? words : '♪');
  });
  view.current = -2;
  $('karaoke-lines').replaceChildren(...view.nodes);
  $('karaoke-title').textContent = d ? [d.title, d.artist].filter(Boolean).join(' · ') : '';
  updateKaraoke(app.lyricsPosition(), true);
}

/** Every frame while open: the current line centered, and its words filled up to `position`. */
export function updateKaraoke(position, force = false) {
  if (!view) return;
  const { lines, nodes, words } = view;
  const index = currentLineIndex(lines, position);
  if (index !== view.current || force) {
    if (view.current >= 0 && nodes[view.current]) {
      nodes[view.current].classList.remove('current');
      nodes[view.current].classList.add('sung');
      for (const w of words[view.current]) w.style.setProperty('--p', 1);
    }
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('sung', i < index);
      nodes[i].classList.toggle('current', i === index);
      if (i !== index) for (const w of words[i]) w.style.setProperty('--p', i < index ? 1 : 0);
    }
    view.current = index;
    const box = $('karaoke-lines'), target = nodes[Math.max(0, index)];
    if (target) {
      // Keep the current line a little above the middle, with the next ones coming up beneath it.
      const offset = box.parentElement.clientHeight * 0.42 - (target.offsetTop + target.offsetHeight / 2);
      box.style.transition = force || !anim.enabled ? 'none' : '';
      box.style.transform = `translateY(${offset}px)`;
    }
  }
  if (index >= 0) {
    const end = index + 1 < lines.length ? lines[index + 1].time : lines[index].time + 6;
    wordProgress(lines[index], end, position).forEach((p, i) => { if (words[index][i]) words[index][i].style.setProperty('--p', p.toFixed(3)); });
  }
}
