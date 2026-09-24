// SVG versions of the Java app's hand-drawn transport glyphs — same proportions, drawn in a w×h box with
// currentColor so CSS controls their color (TEXT on plain buttons, BG on gradient "on"/primary buttons).

const NS = 'http://www.w3.org/2000/svg';
const pts = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

function play(w, h) {
  const cx = w / 2, cy = h / 2, triW = w * 0.34, triH = h * 0.4, nudge = w * 0.04;
  const left = cx - triW / 2 + nudge, right = left + triW;
  return `<polygon points="${pts([[left, cy - triH / 2], [left, cy + triH / 2], [right, cy]])}"/>`;
}
function pause(w, h) {
  const cx = w / 2, cy = h / 2, barW = Math.max(2, w * 0.11), barH = h * 0.38, gap = w * 0.12;
  return `<rect x="${cx - gap / 2 - barW}" y="${cy - barH / 2}" width="${barW}" height="${barH}" rx="1"/>`
    + `<rect x="${cx + gap / 2}" y="${cy - barH / 2}" width="${barW}" height="${barH}" rx="1"/>`;
}
function trackSkip(w, h, forward) {
  const cx = w / 2, cy = h / 2, barW = Math.max(2, w * 0.09), barH = h * 0.42, triW = w * 0.26, triH = h * 0.42;
  const dir = forward ? 1 : -1;
  const barX = cx + dir * w * 0.2 - (forward ? 0 : barW);
  const near = cx - dir * w * 0.06, far = near + dir * triW;
  return `<rect x="${barX}" y="${cy - barH / 2}" width="${barW}" height="${barH}" rx="1"/>`
    + `<polygon points="${pts([[far, cy], [near, cy - triH / 2], [near, cy + triH / 2]])}"/>`;
}
function seek15(w, h, forward) {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.3, gapHalf = 35, ring = Math.max(1.4, w * 0.045);
  const at = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
  const startDeg = forward ? 90 - gapHalf : 90 + gapHalf, endDeg = forward ? 90 + gapHalf : 90 - gapHalf;
  const [sx, sy] = at(startDeg), [px, py] = at(endDeg);
  const rad = (endDeg * Math.PI) / 180;
  const dx = forward ? Math.sin(rad) : -Math.sin(rad), dy = forward ? Math.cos(rad) : -Math.cos(rad);
  const len = r * 0.45, half = r * 0.4, perpX = -dy, perpY = dx;
  const arrow = [[px + dx * len, py + dy * len], [px + perpX * half, py + perpY * half], [px - perpX * half, py - perpY * half]];
  const font = Math.max(8, Math.floor(w * 0.3));
  return `<path d="M${sx} ${sy} A${r} ${r} 0 1 ${forward ? 1 : 0} ${px} ${py}" fill="none" stroke="currentColor" stroke-width="${ring}" stroke-linecap="round"/>`
    + `<polygon points="${pts(arrow)}"/>`
    + `<text x="${cx}" y="${cy + 0.5}" text-anchor="middle" dominant-baseline="central" font-size="${font}" font-weight="bold" style="font-family: var(--font)">15</text>`;
}
function arrowSegment(x1, y1, x2, y2, len, half) {
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
  const bx = x2 - ux * len, by = y2 - uy * len, perpX = -uy, perpY = ux;
  return `<line x1="${x1}" y1="${y1}" x2="${x2 - ux * len * 0.6}" y2="${y2 - uy * len * 0.6}"/>`
    + `<polygon stroke="none" points="${pts([[x2, y2], [bx + perpX * half, by + perpY * half], [bx - perpX * half, by - perpY * half]])}"/>`;
}
function shuffle(w, h) {
  const x1 = w * 0.2, x2 = w * 0.76, top = h * 0.28, bottom = h * 0.72, len = w * 0.15, half = w * 0.11;
  return `<g stroke="currentColor" stroke-width="${Math.max(1.5, w * 0.075)}" stroke-linecap="round" stroke-linejoin="round">`
    + arrowSegment(x1, top, x2, bottom, len, half) + arrowSegment(x1, bottom, x2, top, len, half) + '</g>';
}
function repeat(w, h) {
  const left = w * 0.24, right = w * 0.76, top = h * 0.3, bottom = h * 0.7, mid = h * 0.5, len = w * 0.14, half = w * 0.11;
  return `<g stroke="currentColor" stroke-width="${Math.max(1.5, w * 0.075)}" stroke-linecap="round" stroke-linejoin="round">`
    + `<line x1="${left}" y1="${top}" x2="${right}" y2="${top}"/>` + arrowSegment(right, top, right, mid, len, half)
    + `<line x1="${right}" y1="${bottom}" x2="${left}" y2="${bottom}"/>` + arrowSegment(left, bottom, left, mid, len, half) + '</g>';
}

// The mini player's larger, borderless glyphs, in the style of Apple Music's mini player.
function solidPlay(w, h) {
  const triW = w * 0.62, triH = h * 0.72, left = (w - triW) / 2 + w * 0.05, top = (h - triH) / 2;
  return `<path d="M${left} ${top + 2} Q${left} ${top} ${left + 2} ${top + 1.2} L${left + triW - 1.5} ${h / 2 - 1} Q${left + triW} ${h / 2} ${left + triW - 1.5} ${h / 2 + 1} L${left + 2} ${top + triH - 1.2} Q${left} ${top + triH} ${left} ${top + triH - 2} Z"/>`;
}
function solidPause(w, h) {
  const barW = w * 0.24, barH = h * 0.74, gap = w * 0.16, top = (h - barH) / 2, left = (w - 2 * barW - gap) / 2;
  return `<rect x="${left}" y="${top}" width="${barW}" height="${barH}" rx="${barW * 0.28}"/>`
    + `<rect x="${left + barW + gap}" y="${top}" width="${barW}" height="${barH}" rx="${barW * 0.28}"/>`;
}
function doubleTriangle(w, h, forward) {
  const triW = w * 0.46, triH = h * 0.56, top = (h - triH) / 2, cy = h / 2, start = (w - 2 * triW) / 2;
  const tri = (x) => (forward
    ? `<polygon points="${pts([[x, top], [x + triW, cy], [x, top + triH]])}" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`
    : `<polygon points="${pts([[x + triW, top], [x, cy], [x + triW, top + triH]])}" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`);
  return tri(start) + tri(start + triW);
}

const DRAW = {
  PLAY: play, PAUSE: pause,
  SOLID_PLAY: solidPlay, SOLID_PAUSE: solidPause,
  REWIND: (w, h) => doubleTriangle(w, h, false), FAST_FORWARD: (w, h) => doubleTriangle(w, h, true),
  PREVIOUS_TRACK: (w, h) => trackSkip(w, h, false), NEXT_TRACK: (w, h) => trackSkip(w, h, true),
  SKIP_BACK_15: (w, h) => seek15(w, h, false), SKIP_FORWARD_15: (w, h) => seek15(w, h, true),
  SHUFFLE: shuffle, REPEAT: repeat,
};

export function glyphSvg(name, size) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('fill', 'currentColor');
  svg.innerHTML = DRAW[name](size, size);
  return svg;
}

/** The small cat-head glyph beside the GitHub username at the bottom of Settings. */
export function catSvg() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 15 15');
  svg.setAttribute('fill', 'currentColor');
  const w = 15, h = 15, cx = w / 2, cy = h * 0.58, r = w * 0.34, earH = h * 0.3, base = cy - r * 0.55;
  svg.innerHTML = `<polygon points="${pts([[cx - r * 0.9, base], [cx - r * 0.15, base], [cx - r * 1.05, base - earH]])}"/>`
    + `<polygon points="${pts([[cx + r * 0.9, base], [cx + r * 0.15, base], [cx + r * 1.05, base - earH]])}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  return svg;
}
