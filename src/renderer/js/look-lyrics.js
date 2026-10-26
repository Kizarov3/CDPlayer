// The LYRICS look's words, down the right of the player, as Apple Music shows them: the line sung now big and bright,
// the rest dimmer, scrolled to keep it a third of the way down; a click on a line plays from it. Untimed words are
// all shown alike, to read along.
import { parseLrc, currentLineIndex, formatLyricsForDisplay } from './lyrics.js';
import { t } from './i18n.js';

let lines = [], now = -2;

/** Fills `node` with the song's words (raw: its lyrics, LRC or plain, or null); `seekToLyric(time)` on a click. */
export function setLookLyrics(node, raw, seekToLyric) {
  lines = raw ? parseLrc(raw) : [];
  now = -2;
  node.classList.toggle('timed', lines.length > 0);
  if (lines.length) {
    node.replaceChildren(...lines.map((l) => {
      const p = document.createElement('p');
      p.textContent = l.text || '♪';
      p.addEventListener('click', () => seekToLyric(l.time));
      return p;
    }));
  } else {
    const text = raw ? formatLyricsForDisplay(raw) : '';
    node.replaceChildren(...(text ? text.split('\n').map((l) => Object.assign(document.createElement('p'), { textContent: l || ' ' }))
      : [Object.assign(document.createElement('div'), { className: 'none', textContent: t('NO LYRICS FOR THIS SONG') })]));
  }
  node.scrollTop = 0;
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
  node.scrollTo({ top: Math.max(0, row.offsetTop - node.clientHeight / 3), behavior: jump ? 'instant' : 'smooth' });
}
