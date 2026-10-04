// The Now Playing card as a video (the card's VIDEO 9:16 and VIDEO 1:1): the disc sliding out of its case and turning,
// the song's name, the lines of its lyrics as they're sung — and the song itself, for as long as the lines picked on
// the card are sung (eight seconds from where it's playing, with none). Recorded as it happens, from a canvas and the audio engine, as MP4 (or WebM where MP4 can't be made).
import { rgb, lerpColor, FONT, drawThemeImage } from './theme.js';
import { t } from './i18n.js';

export const VIDEO_SECONDS = 8, MIN_VIDEO_SECONDS = 2, MAX_VIDEO_SECONDS = 60;
const FPS = 30, SLIDE_S = 0.8, TURNS_PER_S = 0.35, LINE_S = 0.35;

/** Where everything stands in a '9:16' (Stories) or '1:1' video: { w, h, case, disc: { x0, x1, y, r }, names, lyrics }. */
export function videoLayout(format) {
  if (format === '9:16') {
    return { w: 1080, h: 1920, case: { x: 110, y: 230, w: 660, h: 660 }, disc: { x0: 440, x1: 700, y: 560, r: 310 },
      names: { x: 90, y: 1010, w: 900, h: 360 }, lyrics: { x: 90, y: 1420, w: 900, h: 400 } };
  }
  return { w: 1080, h: 1080, case: { x: 70, y: 80, w: 440, h: 440 }, disc: { x0: 290, x1: 470, y: 300, r: 205 },
    names: { x: 70, y: 590, w: 940, h: 190 }, lyrics: { x: 70, y: 800, w: 940, h: 220 } };
}

/**
 * The lines on screen `t` seconds into the song (timed lyrics, [{ time, text }]): the one being sung, and the next —
 * and, to glide from one to the other, the line sung before it (null: none, or a break) and how long ago it changed.
 */
export function lyricsAt(timed, t) {
  let at = -1;
  for (let i = 0; i < timed.length && timed[i].time <= t; i++) at = i;
  const said = (i) => (i >= 0 && String(timed[i].text || '').trim() ? timed[i].text : null);
  const after = timed.slice(at + 1).find((l) => String(l.text || '').trim());
  return { current: said(at), next: after ? after.text : null, previous: said(at - 1), since: at >= 0 ? t - timed[at].time : Infinity };
}

/**
 * The stretch of the song a video covers, in lyric time: from the first of the picked lines (indexes among the lines
 * with words, as the card lists them) to where the last one ends — when the next timed line starts, or the song does
 * (`songEnd`, s). 2 s at least, a minute at most. → { start, end } | null (no line picked).
 */
export function videoSpan(timed, picked, songEnd) {
  const said = timed.map((_, i) => i).filter((i) => String(timed[i].text || '').trim());
  const at = picked.filter((i) => i >= 0 && i < said.length).sort((a, b) => a - b);
  if (!at.length) return null;
  const start = timed[said[at[0]]].time, after = timed[said[at[at.length - 1]] + 1];
  const end = after ? after.time : songEnd > start ? songEnd : start + VIDEO_SECONDS;
  return { start, end: Math.min(start + MAX_VIDEO_SECONDS, Math.max(start + MIN_VIDEO_SECONDS, end)) };
}

const TYPES = [
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
];
/** The format to record in, as the recorder can: MP4 first. → { mime, ext } | null. */
export function pickVideoType(isTypeSupported = (t) => MediaRecorder.isTypeSupported(t)) {
  return TYPES.find((t) => isTypeSupported(t.mime)) || null;
}

// ---- Drawing ----------------------------------------------------------------------------------------------------

function wrap(g, text, width, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= width || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > max) { lines.length = max; lines[max - 1] = `${lines[max - 1].replace(/\s*\S*$/, '')}…`; }
  return lines;
}
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// What doesn't move — the background, washed with the cover — drawn once.
function backdrop(L, song, colors) {
  const c = new OffscreenCanvas(L.w, L.h), g = c.getContext('2d');
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, L.w, L.h);
  if (song.backdrop) drawThemeImage(g, L.w, L.h, song.backdrop.image, song.backdrop);
  else if (song.cover) { g.save(); g.filter = 'blur(80px) saturate(1.3)'; g.globalAlpha = 0.5; g.drawImage(song.cover, -150, -150, L.w + 300, L.h + 300); g.restore(); }
  const shade = g.createLinearGradient(0, 0, 0, L.h);
  shade.addColorStop(0, 'rgba(0,0,0,0.1)'); shade.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = shade; g.fillRect(0, 0, L.w, L.h);
  return c;
}

function drawFrame(g, L, back, s, at) {
  g.drawImage(back, 0, 0);
  // The disc, sliding out from behind its case, then turning.
  const d = L.disc, x = d.x0 + (d.x1 - d.x0) * ease(at / SLIDE_S);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 30;
  g.beginPath(); g.arc(x, d.y, d.r, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
  g.restore();
  g.save();
  g.beginPath(); g.arc(x, d.y, d.r, 0, Math.PI * 2); g.clip();
  g.translate(x, d.y); g.rotate(at * TURNS_PER_S * Math.PI * 2);
  g.drawImage(s.face, -d.r, -d.r, d.r * 2, d.r * 2);
  g.restore();
  // A glint across it, staying put while it turns.
  const glint = g.createLinearGradient(x - d.r, d.y - d.r, x + d.r, d.y + d.r);
  glint.addColorStop(0.35, 'rgba(255,255,255,0)'); glint.addColorStop(0.5, 'rgba(255,255,255,0.18)'); glint.addColorStop(0.65, 'rgba(255,255,255,0)');
  g.save(); g.beginPath(); g.arc(x, d.y, d.r, 0, Math.PI * 2); g.clip(); g.fillStyle = glint; g.fillRect(x - d.r, d.y - d.r, d.r * 2, d.r * 2); g.restore();
  // The case over it: the cover under the plastic, its hinge down the left.
  const c = L.case;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 40; g.shadowOffsetY = 14; g.fillStyle = '#16161a'; g.fillRect(c.x, c.y, c.w, c.h); g.restore();
  if (s.cover) {
    const iw = s.cover.naturalWidth || s.cover.width, ih = s.cover.naturalHeight || s.cover.height, m = Math.min(iw, ih);
    g.drawImage(s.cover, (iw - m) / 2, (ih - m) / 2, m, m, c.x, c.y, c.w, c.h);
  } else g.drawImage(s.face, c.x + c.w * 0.1, c.y + c.h * 0.1, c.w * 0.8, c.h * 0.8);
  const hinge = g.createLinearGradient(c.x, 0, c.x + 18, 0);
  hinge.addColorStop(0, 'rgba(0,0,0,0.4)'); hinge.addColorStop(1, 'rgba(255,255,255,0.16)');
  g.fillStyle = hinge; g.fillRect(c.x, c.y, 18, c.h);
  const gloss = g.createLinearGradient(c.x, c.y, c.x + c.w * 0.7, c.y + c.h * 0.9);
  gloss.addColorStop(0, 'rgba(255,255,255,0.16)'); gloss.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.fillStyle = gloss; g.fillRect(c.x, c.y, c.w, c.h);
  // The song's name.
  const n = L.names, big = L.w === L.h ? 58 : 84;
  g.textBaseline = 'top'; g.textAlign = 'left';
  let y = n.y;
  g.font = `bold ${L.w === L.h ? 24 : 30}px ${FONT}`; g.fillStyle = rgb(s.colors.accent); g.fillText(t('NOW PLAYING'), n.x, y); y += L.w === L.h ? 44 : 56;
  g.font = `bold ${big}px ${FONT}`; g.fillStyle = rgb(s.colors.text);
  for (const line of wrap(g, s.title, n.w, 2)) { g.fillText(line, n.x, y); y += big * 1.12; }
  g.font = `${Math.round(big * 0.6)}px ${FONT}`; g.fillStyle = rgb(s.colors.accent2);
  if (s.artist) { g.fillText(wrap(g, s.artist, n.w, 1)[0], n.x, y + 6); y += big * 0.75; }
  g.font = `${Math.round(big * 0.45)}px ${FONT}`; g.fillStyle = rgb(s.colors.muted);
  if (s.subtitle) g.fillText(wrap(g, s.subtitle, n.w, 1)[0], n.x, y + 10);
  drawLyrics(g, L.lyrics, s, lyricsAt(s.timed, s.position()), L.w === L.h ? 44 : 64);
  g.font = `bold 22px ${FONT}`; g.fillStyle = rgb(s.colors.muted); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillText('CDPlayer', L.w - 40, L.h - 40);
}

// The lines as they're sung: the one now, bright, and the next, faint. When the line changes, the one that was sung
// drifts up and fades, the next rises into its place as it grows and brightens, and the one after fades in below.
function drawLyrics(g, l, s, lyr, size) {
  const p = ease(lyr.since / LINE_S), lead = size * 1.25, width = l.w - 30;
  const font = (px, bold) => `italic ${bold ? 'bold ' : ''}${Math.round(px)}px ${FONT}`;
  const heightOf = (text) => { if (!text) return 0; g.font = font(size, true); return wrap(g, text, width, 2).length * lead; };
  const from = l.y + heightOf(lyr.previous) + 14; // where the line now sung was, as the next one
  g.save();
  g.beginPath(); g.rect(l.x, l.y - 20, l.w, l.h + 20); g.clip();
  g.textBaseline = 'top'; g.textAlign = 'left';
  if (lyr.previous && p < 0.5) {
    g.globalAlpha = 1 - p * 2; // gone before the next is halfway up, so the two don't run into each other g.font = font(size, true); g.fillStyle = rgb(s.colors.text);
    let y = l.y - size * 0.4 * p;
    for (const line of wrap(g, lyr.previous, width, 2)) { g.fillText(line, l.x + 30, y); y += lead; }
  }
  let y = l.y;
  if (lyr.current) {
    const px = size * (0.75 + 0.25 * p);
    y = from + (l.y - from) * p;
    g.globalAlpha = p; g.fillStyle = rgb(s.colors.accent); g.fillRect(l.x, l.y + 4, 5, size * 1.2 * p);
    g.globalAlpha = 1; g.font = font(px, true); g.fillStyle = rgb(lerpColor(s.colors.muted, s.colors.text, p));
    for (const line of wrap(g, lyr.current, width, 2)) { g.fillText(line, l.x + 30, y); y += px * 1.25; }
  } else y = (from - 14) * (1 - p) + l.y * p; // a break: the next line rises to the top
  if (lyr.next && y + size < l.y + l.h) {
    g.globalAlpha = lyr.current ? p : 1; g.font = font(size * 0.75, false); g.fillStyle = rgb(s.colors.muted);
    g.fillText(wrap(g, lyr.next, width, 1)[0], l.x + 30, y + 14 + (lyr.current ? 24 * (1 - p) : 0));
  }
  g.restore();
}

/**
 * Records the video: song { cover, face (the disc as drawn), title, artist, subtitle, colors, timed, position() (where
 * the song is now, s) }, audio a MediaStream of what plays (or null: no sound), seconds long, begin() awaited once the
 * frames are ready to go (to put the song where the video starts), onTick(seconds left).
 * → { bytes: Uint8Array, ext } | null (the recorder can't make video here, or it failed).
 */
export async function recordVideo({ format, song, audio, seconds = VIDEO_SECONDS, begin = async () => {}, onTick = () => {} }) {
  const type = pickVideoType();
  if (!type) return null;
  const L = videoLayout(format), back = backdrop(L, song, song.colors);
  const canvas = document.createElement('canvas');
  canvas.width = L.w; canvas.height = L.h;
  const g = canvas.getContext('2d');
  drawFrame(g, L, back, song, 0);
  const stream = canvas.captureStream(FPS);
  if (audio) for (const track of audio.getAudioTracks()) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 8e6, audioBitsPerSecond: 192e3 });
  const chunks = [];
  let failed = false;
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onerror = () => { failed = true; };
  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  await begin();
  const t0 = performance.now();
  recorder.start(500);
  // Drawn on a timer, not on animation frames: those slow right down when the window isn't in front.
  await new Promise((resolve) => {
    let left = Math.ceil(seconds);
    onTick(left);
    const timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      drawFrame(g, L, back, song, t);
      const now = Math.ceil(seconds - t);
      if (now !== left) { left = now; onTick(Math.max(0, now)); }
      if (t >= seconds) { clearInterval(timer); resolve(); }
    }, 1000 / FPS);
  });
  recorder.stop();
  await done;
  for (const track of stream.getVideoTracks()) track.stop();
  if (failed || !chunks.length) return null; // the encoder wouldn't start: nothing to save
  const blob = new Blob(chunks, { type: type.mime });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: type.ext };
}
