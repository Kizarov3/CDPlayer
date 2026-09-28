// The "now playing" card (P, or right-click the disc): a picture of what's on, to paste into a chat or save — the album
// in its jewel case, the song, its artist and album, and a line of its lyrics (the one being sung, another picked, or
// none), in the theme's colours on a wash of the cover.
import { rgb, FONT } from './theme.js';
import { currentLineIndex, parseLrc } from './lyrics.js';

const W = 1200, H = 630;
const MARKER_FONT = '"Marker Felt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

/**
 * The lyrics' lines to pick one for the card from (blank lines, breaks and "[Chorus]" labels left out), and which is
 * picked to start with: the one being sung at `position`, or -1 (none) in a break or for untimed lyrics.
 */
export function lyricChoices(raw, position) {
  if (!raw) return { lines: [], picked: -1 };
  const timed = parseLrc(raw);
  if (timed.length) {
    const lines = [], at = currentLineIndex(timed, position);
    let picked = -1;
    timed.forEach((l, i) => {
      const text = String(l.text || '').trim();
      if (!text) return;
      if (i === at) picked = lines.length;
      lines.push(text);
    });
    return { lines, picked };
  }
  const lines = String(raw).split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  return { lines, picked: -1 };
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

  // The words, right of the case, centred beside it: laid out first, to know how tall they stand.
  const tx = cx + cs + 70, tw = W - tx - 80;
  const parts = []; // [font, colour, lines, line height, gap after]
  parts.push([`bold 20px ${FONT}`, rgb(colors.accent), ['NOW PLAYING'], 30, 20]);
  g.font = `bold 54px ${FONT}`;
  parts.push([g.font, rgb(colors.text), wrap(g, song.title, tw, 2), 62, 6]);
  if (song.artist) { g.font = `30px ${FONT}`; parts.push([g.font, rgb(colors.accent2), wrap(g, song.artist, tw, 1), 40, 0]); }
  if (song.subtitle) { g.font = `22px ${FONT}`; parts.push([g.font, rgb(colors.muted), wrap(g, song.subtitle, tw, 1), 32, 0]); }
  let quoted = null;
  if (song.lyric) { g.font = `italic 28px ${FONT}`; quoted = wrap(g, `“${song.lyric}”`, tw - 24, 3); }
  const textH = parts.reduce((h, [, , lines, lh, after]) => h + lines.length * lh + after, 0) + (quoted ? 34 + quoted.length * 38 : 0);
  let y = cy + Math.max(0, (cs - textH) / 2);
  g.textBaseline = 'top';
  for (const [font, color, lines, lh, after] of parts) {
    g.font = font; g.fillStyle = color;
    for (const l of lines) { g.fillText(l, tx, y + (lh - parseInt(font.match(/(\d+)px/)[1], 10)) / 2); y += lh; }
    y += after;
  }
  if (quoted) {
    y += 34;
    g.fillStyle = rgb(colors.accent); g.fillRect(tx, y + 2, 4, quoted.length * 38 - 6);
    g.font = `italic 28px ${FONT}`; g.fillStyle = rgb(colors.text);
    quoted.forEach((l, i) => g.fillText(l, tx + 24, y + 5 + i * 38));
  }
  g.textBaseline = 'alphabetic';
  // Where it's from, small in the corner.
  g.font = `bold 16px ${FONT}`; g.fillStyle = rgb(colors.muted); g.textAlign = 'right';
  g.fillText('CDPlayer', W - 40, H - 32);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
