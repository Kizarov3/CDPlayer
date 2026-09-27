// Karaoke Mode (Y): the whole window becomes the song's lyrics, the line being sung big in the middle and filling in
// word by word as it's sung, like Apple Music's — each word over its own time where the lyrics have word timings
// (from Unison), shared by syllables where they only time whole lines. A word lifts as it's sung and one held long
// glows; backing vocals fill under their line; a duet's singers sit left and right; and in a long break the line
// settles while three dots breathe until the next. Click a line to jump there.
import { el, anim } from './widgets.js';
import { parseLrc, lineState, lineWords, wordProgress } from './lyrics.js';

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

const HELD = 1; // seconds: a word sung longer than this glows
const REST = 3; // seconds: a break longer than this between lines shows the breathing dots

// Where line i stops: its own end, else when the next line starts (at most 6 s on).
const endOf = (lines, i) => (lines[i].end !== undefined ? lines[i].end : i + 1 < lines.length ? lines[i + 1].time : lines[i].time + 6);

function rebuild() {
  const { app } = view;
  const d = app.state.details;
  view.lyrics = app.state.lyrics;
  view.lines = parseLrc(view.lyrics);
  const duet = new Set(view.lines.map((l) => l.agent).filter(Boolean)).size > 1;
  view.words = []; view.bgWords = [];
  // (An empty timed line is an instrumental break: shown as a note.)
  view.nodes = view.lines.map((line, i) => {
    const words = lineWords(line, endOf(view.lines, i))
      .map((w) => el('span', { class: `k-word${w.end !== undefined && w.end - w.time > HELD ? ' held' : ''}` }, w.text));
    view.words.push(words);
    const bg = line.bg ? line.bg.map((w) => el('span', { class: 'k-word' }, w.text)) : [];
    view.bgWords.push(bg);
    const cls = ['k-line', line.text ? '' : 'gap', duet && line.agent ? `k-${line.agent}` : ''].filter(Boolean).join(' ');
    return el('div', { class: cls, onClick: () => app.seekToLyric(line.time) },
      line.text ? el('div', { class: 'k-main' }, words) : '♪',
      bg.length ? el('div', { class: 'k-bg' }, bg) : null,
      el('div', { class: 'k-dots' }, el('i'), el('i'), el('i')));
  });
  view.current = -2;
  $('karaoke-lines').replaceChildren(...view.nodes);
  $('karaoke').classList.toggle('calm', !anim.enabled);
  $('karaoke-title').textContent = d ? [d.title, d.artist].filter(Boolean).join(' · ') : '';
  updateKaraoke(app.lyricsPosition(), true);
}

const fill = (spans, progress) => progress.forEach((p, i) => {
  const s = spans[i];
  if (!s) return;
  s.style.setProperty('--p', p.toFixed(3));
  s.classList.toggle('singing', p > 0 && p < 1);
});

/** Every frame while open: the current line centered, its words (and backing vocals) filled up to `position`. */
export function updateKaraoke(position, force = false) {
  if (!view) return;
  const { lines, nodes, words, bgWords } = view;
  const { index, singing } = lineState(lines, position);
  if (index !== view.current || force) {
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('sung', i < index);
      nodes[i].classList.toggle('current', i === index);
      nodes[i].style.setProperty('--d', String(Math.min(4, Math.abs(i - Math.max(0, index)))));
      if (i !== index) { fill(words[i], words[i].map(() => (i < index ? 1 : 0))); fill(bgWords[i], bgWords[i].map(() => (i < index ? 1 : 0))); }
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
    const end = endOf(lines, index);
    fill(words[index], wordProgress(lines[index], end, position));
    if (lines[index].bg) fill(bgWords[index], wordProgress({ time: lines[index].bg[0].time, text: '', words: lines[index].bg }, end, position));
    // A long break after the line: it settles, and the dots breathe until the next one.
    const next = index + 1 < lines.length ? lines[index + 1].time : Infinity;
    nodes[index].classList.toggle('resting', !singing && next - position > 0.6 && next - (lines[index].end ?? next) > REST);
  }
}
