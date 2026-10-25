// Karaoke Mode (Y): the whole window becomes the song's lyrics, the line being sung big in the middle and filling in
// word by word as it's sung, like Apple Music's — each word over its own time where the lyrics have word timings
// (from Unison or NetEase), shared by syllables at the song's own pace where they only time lines. A word lifts as
// it's sung and one held long glows; backing vocals fill under their line; a duet's singers sit left and right; and
// in a long break (and before the first line) three dots count in to the next, lit one by one. The next line comes up
// a moment before it's sung, to read ahead; behind it all, the album's cover, blurred, breathing with the music.
// Click a line to jump there.
import { el, anim, EASE } from './widgets.js';
import { parseLrc, lineState, lineWords, wordProgress, songPace } from './lyrics.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
let view = null; // { lines, nodes, words: [[span]], current, lyrics }

export const isKaraokeOpen = () => !!view;
/** Karaoke needs timed lyrics: true when these lyrics have them. */
export const canKaraoke = (lyrics) => !!lyrics && parseLrc(lyrics).length > 0;

export function openKaraoke(app) {
  if (view || !canKaraoke(app.state.lyrics)) return false;
  const root = $('karaoke');
  root.hidden = false;
  if (anim.enabled) root.animate([{ opacity: 0, transform: 'scale(1.015)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE.out });
  view = { app };
  rebuild();
  return true;
}

export function closeKaraoke() {
  if (!view) return;
  view = null;
  const root = $('karaoke');
  if (anim.enabled) root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: EASE.in }).onfinish = () => { if (!view) root.hidden = true; };
  else root.hidden = true;
}

// New song (or new lyrics for it): the lines are laid out again. A song without timed lyrics (or whose lyrics are
// still being looked for) says so, and karaoke stays — the next song, or the lyrics when they come, fill it again.
export function refreshKaraoke() {
  if (!view) return;
  if (view.lyrics === view.app.state.lyrics && view.nodes) return;
  if (canKaraoke(view.app.state.lyrics)) { rebuild(); return; }
  view.lyrics = view.app.state.lyrics;
  view.lines = []; view.nodes = []; view.words = []; view.bgWords = []; view.current = -2;
  const d = view.app.state.details;
  $('karaoke-title').textContent = d ? [d.title, d.artist].filter(Boolean).join(' · ') : '';
  $('karaoke-lines').style.transform = '';
  view.intro = null;
  showCover();
  $('karaoke-lines').replaceChildren(el('div', { class: 'k-line current k-none' }, view.lyrics ? t('THESE LYRICS AREN’T TIMED') : t('NO LYRICS FOR THIS SONG')));
}

const HELD = 1; // seconds: a word sung longer than this glows
const REST = 3; // seconds: a break longer than this between lines shows the dots counting in
const SOON = 0.8; // seconds: the next line comes up this long before it's sung

const dots = () => el('div', { class: 'k-dots' }, el('i'), el('i'), el('i'));
// The dots through a break: lit one by one as it passes (`frac` 0…1), the last moment all three going.
function countIn(line, frac, left) {
  const ds = line.querySelectorAll('.k-dots i');
  ds.forEach((d, i) => d.classList.toggle('lit', frac >= (i + 1) / (ds.length + 1)));
  line.classList.toggle('going', left < 0.35);
}
// The album's cover behind the lyrics, blurred (the player's, as it is now; app.js tells when it's found).
export function karaokeCover() { if (view) showCover(); }
function showCover() {
  const cover = $('karaoke-cover'), art = $('cover-art').style.backgroundImage;
  cover.style.backgroundImage = art || '';
  cover.classList.toggle('none', !art || art === 'none');
}

// Where line i stops: its own end, else when the next line starts (at most 6 s on).
const endOf = (lines, i) => (lines[i].end !== undefined ? lines[i].end : i + 1 < lines.length ? lines[i + 1].time : lines[i].time + 6);

function rebuild() {
  const { app } = view;
  const d = app.state.details;
  view.lyrics = app.state.lyrics;
  view.lines = parseLrc(view.lyrics);
  // A word timed in syllables ("be", "neath") is kept on one line: the syllables with no space between are held together.
  const wholeWords = (spans) => {
    const groups = [];
    spans.forEach((sp, i) => { if (!i || /\s$/.test(spans[i - 1].textContent) || /^\s/.test(sp.textContent)) groups.push([]); groups[groups.length - 1].push(sp); });
    return groups.map((g) => (g.length > 1 ? el('span', { class: 'k-whole' }, g) : g[0]));
  };
  view.pace = songPace(view.lines);
  const duet = new Set(view.lines.map((l) => l.agent).filter(Boolean)).size > 1;
  view.words = []; view.bgWords = [];
  // (An empty timed line is an instrumental break: shown as a note.)
  view.nodes = view.lines.map((line, i) => {
    const words = lineWords(line, endOf(view.lines, i), view.pace)
      .map((w) => el('span', { class: `k-word${w.end !== undefined && w.end - w.time > HELD ? ' held' : ''}` }, w.text));
    view.words.push(words);
    const bg = line.bg ? line.bg.map((w) => el('span', { class: 'k-word' }, w.text)) : [];
    view.bgWords.push(bg);
    const cls = ['k-line', line.text ? '' : 'gap', duet && line.agent ? `k-${line.agent}` : ''].filter(Boolean).join(' ');
    return el('div', { class: cls, onClick: () => app.seekToLyric(line.time) },
      line.text ? el('div', { class: 'k-main' }, wholeWords(words)) : '♪',
      bg.length ? el('div', { class: 'k-bg' }, wholeWords(bg)) : null,
      dots());
  });
  view.current = -2;
  // Before the first line, when the song takes a while to begin: the dots count in to it.
  view.intro = view.lines.length && view.lines[0].time > REST ? el('div', { class: 'k-line k-intro' }, dots()) : null;
  $('karaoke-lines').replaceChildren(...(view.intro ? [view.intro] : []), ...view.nodes);
  showCover();
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
  if (!view || !view.nodes || !view.nodes.length) return;
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
    if (view.intro) view.intro.classList.toggle('current', index < 0);
    const box = $('karaoke-lines'), target = index < 0 && view.intro ? view.intro : nodes[Math.max(0, index)];
    if (target) {
      // Keep the current line a little above the middle, with the next ones coming up beneath it.
      const offset = box.parentElement.clientHeight * 0.42 - (target.offsetTop + target.offsetHeight / 2);
      box.style.transition = force || !anim.enabled ? 'none' : '';
      box.style.transform = `translateY(${offset}px)`;
    }
  }
  if (index >= 0) {
    const end = endOf(lines, index);
    fill(words[index], wordProgress(lines[index], end, position, view.pace));
    if (lines[index].bg) fill(bgWords[index], wordProgress({ time: lines[index].bg[0].time, text: '', words: lines[index].bg }, end, position));
    // A long break after the line: it settles, and the dots breathe until the next one.
    const next = index + 1 < lines.length ? lines[index + 1].time : Infinity;
    // (a line with no words is an instrumental break itself: from its start)
    const gap = !lines[index].text, from = gap ? lines[index].time : lines[index].end ?? next;
    const resting = (gap || !singing) && next - from > REST && next > position;
    nodes[index].classList.toggle('resting', resting);
    if (resting) countIn(nodes[index], (position - from) / (next - from), next - position);
  } else if (view.intro) countIn(view.intro, position / lines[0].time, lines[0].time - position);
  // The next line, a moment before it's sung, comes up to be read ahead.
  const soon = index + 1 < lines.length && lines[index + 1].time - position < SOON ? index + 1 : -1;
  if (soon !== view.soon) {
    if (view.soon >= 0 && nodes[view.soon]) nodes[view.soon].classList.remove('soon');
    if (soon >= 0) nodes[soon].classList.add('soon');
    view.soon = soon;
  }
  // The cover breathes with the music (its loudness, before the volume: as loud at any volume).
  if (anim.enabled) {
    const level = (view.app.engine.levels(1) || [0])[0];
    view.level = (view.level || 0) * 0.8 + level * 0.2;
    $('karaoke-cover').style.transform = `scale(${(1.18 + view.level * 0.1).toFixed(4)})`;
    $('karaoke-cover').style.opacity = (0.3 + view.level * 0.25).toFixed(3);
  }
}
