// The LYRICS look's right side, as Apple Music shows the words: the line sung now big and bright, the rest dimmer,
// scrolled to keep it a little above the middle; a click on a line plays from it. Untimed words are all shown alike,
// to read along. A song with no words (or while they're being looked for) doesn't leave the side empty: the songs
// of its disc are listed there instead, the one playing lit, a click playing another.
import { parseLrc, currentLineIndex, formatLyricsForDisplay } from './lyrics.js';
import { t } from './i18n.js';

let lines = [], now = -2, songsShown = false, shownCurrent = null;

/**
 * Fills `node` with the song's words (raw: its lyrics, LRC or plain, or null); `seekToLyric(time)` on a click.
 * `songs` is what to list without words: { looking, heading, tracks: [{ index, no, title, time, current, skipped }], empty, play(index) }.
 */
export function setLookLyrics(node, raw, seekToLyric, songs) {
  lines = raw ? parseLrc(raw) : [];
  now = -2;
  node.classList.toggle('timed', lines.length > 0);
  const text = lines.length || !raw ? '' : formatLyricsForDisplay(raw);
  songsShown = !lines.length && !text;
  node.classList.toggle('songs', songsShown);
  shownCurrent = null;
  if (lines.length) {
    node.replaceChildren(...lines.map((l) => {
      const p = document.createElement('p');
      p.textContent = l.text || '♪';
      p.addEventListener('click', () => seekToLyric(l.time));
      return p;
    }));
  } else if (text) {
    node.replaceChildren(...text.split('\n').map((l) => Object.assign(document.createElement('p'), { textContent: l || ' ' })));
  } else {
    node.replaceChildren();
    showLookSongs(node, songs);
    return;
  }
  node.scrollTop = 0;
}

/** The disc's songs listed again (the queue moved on, or the words were found or given up on) — only while there are no words. */
export function showLookSongs(node, songs) {
  if (!songsShown) return;
  const was = node.scrollTop;
  const make = (tag, className, textContent) => Object.assign(document.createElement(tag), { className, textContent });
  const rows = [songs.looking ? make('div', 'note looking', t('LOOKING FOR THE WORDS…')) : make('div', 'note', t('NO LYRICS FOR THIS SONG'))];
  if (!songs.tracks.length) rows.push(make('div', 'note empty', songs.empty));
  else {
    if (songs.heading) rows.push(make('div', 'heading', songs.heading));
    for (const track of songs.tracks) {
      const row = make('div', `song${track.current ? ' current' : ''}${track.skipped ? ' skipped' : ''}`);
      row.append(make('span', 'no', `${track.no}.`), make('span', 'name', track.title), make('span', 'time', track.time));
      row.addEventListener('click', () => songs.play(track.index));
      rows.push(row);
    }
  }
  node.replaceChildren(...rows);
  // The song playing is kept in the middle when it changes (or the list first appears); otherwise the list stays where it was scrolled.
  const current = songs.tracks.findIndex((track) => track.current);
  const row = current >= 0 ? node.querySelectorAll('.song')[current] : null;
  if (row && current !== shownCurrent) node.scrollTo({ top: Math.max(0, row.offsetTop - node.clientHeight / 2 + row.offsetHeight / 2), behavior: shownCurrent === null ? 'instant' : 'smooth' });
  else node.scrollTop = was;
  shownCurrent = current;
}

/** The line sung at `position` (s) lit, and scrolled to (smoothly, unless `jump`). */
export function followLookLyrics(node, position, jump = false) {
  if (!lines.length) return;
  const index = currentLineIndex(lines, position);
  if (index === now && !jump) return;
  const rows = node.children;
  if (rows[now]) rows[now].classList.remove('now');
  now = index;
  for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('sung', i < index);
  const row = rows[Math.max(0, index)];
  if (index >= 0) row.classList.add('now');
  node.scrollTo({ top: Math.max(0, row.offsetTop - node.clientHeight * 0.38), behavior: jump ? 'instant' : 'smooth' });
}
