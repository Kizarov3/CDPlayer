// The "now playing" card (P, or right-click the disc): a picture of what's on, to paste into a chat — the album in its
// jewel case, the song, its artist and album, and the line being sung, in the theme's colours on a wash of the cover.
import { rgb, FONT } from './theme.js';
import { currentLineIndex } from './lyrics.js';

const W = 1200, H = 630;
const MARKER_FONT = '"Marker Felt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

/** The line being sung at `position` (s) of timed lyrics ([{ time, text }]), or null in a break or before the first. */
export function cardLyric(lines, position) {
  const i = currentLineIndex(lines, position);
  const text = i >= 0 ? String(lines[i].text || '').trim() : '';
  return text || null;
}

/** "Album · Year" for what's known of them. */
export function cardSubtitle(details) {
  if (!details) return '';
  const year = /\d{4}/.exec((details.credits && details.credits.released) || '');
  return [details.album, year && year[0]].filter(Boolean).join(' · ');
}

// Text cut to fit `max` px wide, with an ellipsis; up to `lines` lines, broken between words.
function wrap(g, text, max, lines) {
  const words = String(text).split(/\s+/).filter(Boolean), out = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= max || !line) { line = next; continue; }
    out.push(line); line = w;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  else if (line && out.length === lines) out[lines - 1] += '…';
  return out.map((l, i) => {
    let s = l;
    while (g.measureText(s).width > max && s.length > 1) s = `${s.slice(0, -2)}…`;
    return i === out.length - 1 && s !== l && !s.endsWith('…') ? `${s}…` : s;
  });
}

/**
 * The card as PNG bytes. `song`: { cover (image or null), title, artist, subtitle, lyric }; `colors`: the theme's.
 */
export async function drawCard(song, colors) {
  const canvas = new OffscreenCanvas(W, H), g = canvas.getContext('2d');
  // The background: the theme's, washed with a blur of the cover, like the Ambient Background.
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, W, H);
  if (song.cover) {
    g.save(); g.filter = 'blur(60px) saturate(1.3)'; g.globalAlpha = 0.45;
    g.drawImage(song.cover, -100, -100, W + 200, H + 200);
    g.restore();
  }
  const shade = g.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.15)'); shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = shade; g.fillRect(0, 0, W, H);

  // The jewel case: the cover under the plastic, its hinge down the left.
  const cs = 430, cx = 90, cy = (H - cs) / 2;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
  g.fillStyle = '#16161a'; g.fillRect(cx, cy, cs, cs);
  g.restore();
  if (song.cover) {
    const iw = song.cover.naturalWidth || song.cover.width, ih = song.cover.naturalHeight || song.cover.height, s = Math.min(iw, ih);
    g.drawImage(song.cover, (iw - s) / 2, (ih - s) / 2, s, s, cx, cy, cs, cs);
  } else { // a silver CD-R, written on in marker
    const silver = g.createRadialGradient(cx + cs / 2, cy + cs / 2, 0, cx + cs / 2, cy + cs / 2, cs * 0.7);
    silver.addColorStop(0, '#e9eaec'); silver.addColorStop(1, '#cfd2d6');
    g.fillStyle = silver; g.fillRect(cx, cy, cs, cs);
    g.save(); g.translate(cx + cs / 2, cy + cs / 2); g.rotate(-0.07);
    g.fillStyle = '#1a1a4e'; g.textAlign = 'center'; g.font = `38px ${MARKER_FONT}`;
    wrap(g, song.title, cs * 0.8, 2).forEach((l, i, all) => g.fillText(l, 0, (i - (all.length - 1) / 2) * 46));
    g.restore();
  }
  const hinge = g.createLinearGradient(cx, 0, cx + 16, 0);
  hinge.addColorStop(0, 'rgba(0,0,0,0.4)'); hinge.addColorStop(0.85, 'rgba(0,0,0,0.25)'); hinge.addColorStop(1, 'rgba(255,255,255,0.18)');
  g.fillStyle = hinge; g.fillRect(cx, cy, 16, cs);
  const gloss = g.createLinearGradient(cx, cy, cx + cs * 0.7, cy + cs * 0.9);
  gloss.addColorStop(0, 'rgba(255,255,255,0.16)'); gloss.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.fillStyle = gloss; g.fillRect(cx, cy, cs, cs);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; g.strokeRect(cx + 0.75, cy + 0.75, cs - 1.5, cs - 1.5);

  // The words, right of the case.
  const tx = cx + cs + 70, tw = W - tx - 80;
  let y = cy + 34;
  g.textBaseline = 'alphabetic';
  g.font = `bold 20px ${FONT}`; g.fillStyle = rgb(colors.accent);
  g.fillText('NOW PLAYING', tx, y);
  y += 66;
  g.font = `bold 54px ${FONT}`; g.fillStyle = rgb(colors.text);
  for (const l of wrap(g, song.title, tw, 2)) { g.fillText(l, tx, y); y += 62; }
  if (song.artist) { g.font = `30px ${FONT}`; g.fillStyle = rgb(colors.accent2); g.fillText(wrap(g, song.artist, tw, 1)[0], tx, y); y += 40; }
  if (song.subtitle) { g.font = `22px ${FONT}`; g.fillStyle = rgb(colors.muted); g.fillText(wrap(g, song.subtitle, tw, 1)[0], tx, y); y += 30; }
  if (song.lyric) {
    y += 34;
    g.font = `italic 28px ${FONT}`;
    const quoted = wrap(g, `“${song.lyric}”`, tw - 24, 3);
    g.fillStyle = rgb(colors.accent); g.fillRect(tx, y - 28, 4, quoted.length * 38 - 4);
    g.fillStyle = rgb(colors.text);
    quoted.forEach((l, i) => g.fillText(l, tx + 24, y + i * 38));
  }
  // Where it's from, small in the corner.
  g.font = `bold 16px ${FONT}`; g.fillStyle = rgb(colors.muted); g.textAlign = 'right';
  g.fillText('CDPlayer', W - 40, H - 32);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
