// BLIP in dots: the deck's pet (main's pet.js decides what it is; pet-view.js puts it on the display). A frame is a
// 25×16 grid of 0/1 — the creature's 16×14 box at column 5, row 2, with room beside it for what it eats, its notes and
// its Z's. Drawn as the display's dots (lit in the theme's colour and glowing, or the LCD's ink), or as TERMINAL's
// half-block characters. Nothing here keeps time: `t` is the frame count of the pose, `reactMs` how long a reaction
// has been going.
export const W = 25, H = 16;
const OFF = 5, ROW = 2;

const BODY = [
  '................', '.....######.....', '...##########...', '..############..', '.##############.',
  '.##############.', '.##############.', '.##############.', '.##############.', '.##############.',
  '..############..', '...##########...', '....##....##....', '...###....###...',
];
const KID = [
  '................', '................', '................', '.....######.....', '...##########...',
  '..############..', '..############..', '..############..', '..############..', '..############..',
  '...##########...', '....########....', '....##....##....', '...###....###...',
];
const BABY = [
  '................', '................', '................', '................', '.....######.....',
  '....########....', '...##########...', '...##########...', '...##########...', '...##########...',
  '....########....', '.....######.....', '.....##..##.....', '....###..###....',
];
const EGG = [
  '................', '......####......', '.....######.....', '....########....', '....########....',
  '...##########...', '...##########...', '...##########...', '...##########...', '...##########...',
  '....########....', '....########....', '.....######.....', '................',
];
const GHOST = [
  '................', '.....######.....', '...##########...', '..############..', '.##############.',
  '.##############.', '.##############.', '.##############.', '.##############.', '.##############.',
  '.##############.', '.##############.',
];
const HEMS = [['.##.###..###.##.', '.#...#....#...#.'], ['.###.##..##.###.', '..#...#..#...#..']];
const FACES = {
  body: { eyes: [5, 6], cols: [[4, 5], [10, 11]], mouth: 9, m: [6, 9] },
  kid: { eyes: [6, 7], cols: [[4, 5], [10, 11]], mouth: 9, m: [6, 9] },
  baby: { eyes: [7, 8], cols: [[5, 5], [10, 10]], mouth: 10, m: [7, 8] },
};
const Z = ['####', '..#.', '.#..', '####'];
const NOTE = ['..##', '..#.', '..#.', '###.', '###.'];
const QUESTION = ['.##.', '#..#', '..#.', '....', '..#.'];
const HEART = ['.#.#.', '#####', '.###.', '..#..'];
const DISC = ['.###.', '#####', '##.##', '#####', '.###.'];
const SNACK = [['.##.', '####', '####', '.##.'], ['.##.', '..##', '..##', '.##.'], ['...#', '....', '..#.', '....'], ['....', '....', '....', '....']];
const FEAST = [['.###.', '#####', '##.##', '#####', '.###.'], ['..##.', '..###', '...##', '..###', '..##.'], ['....#', '...##', '.....', '...#.', '.....'], ['.....', '.....', '.....', '.....', '.....']];

export const STAGES = ['egg', 'baby', 'kid', 'teen'];
export const FORMS = [...STAGES, 'collector', 'raver', 'owl', 'loyalist', 'bird', 'explorer', 'ghost', 'echo'];
export const POSES = ['playing', 'paused', 'snack', 'feast', 'fav', 'sniff', 'asleep', 'hatch', 'molt', 'trick'];
export const REACTIONS = ['poke', 'trick', 'skip', 'seek', 'loud', 'quiet', 'eject'];
// How long each one-off pose and reaction lasts: frames (at its own pace, FRAME_MS) or milliseconds.
export const SCENE_FRAMES = { snack: 10, feast: 24, sniff: 12, hatch: 66, molt: 36, trick: 16, fav: Infinity };
export const FRAME_MS = { playing: 220, paused: 500, asleep: 900, snack: 330, feast: 300, fav: 260, sniff: 400, hatch: 320, molt: 300, trick: 230 };
export const REACT_MS = { poke: 800, trick: 2100, skip: 1300, seek: 760, loud: 1600, quiet: 1600, eject: 4200 };

const blank = () => Array.from({ length: H }, () => new Array(W).fill(0));
const rect = (r0, r1, c0, c1) => { const o = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) o.push([r, c]); return o; };
// painting in the body's own coordinates (row 0: the top of its 16×14 box), moved by dy/dx
function pen(g, dy = 0, dx = 0) {
  const set = (r, c, v) => { const y = r + ROW + dy, x = c + OFF + dx; if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = v; };
  return {
    lit: (cells) => cells.forEach(([r, c]) => set(r, c, 1)),
    hole: (cells) => cells.forEach(([r, c]) => set(r, c, 0)),
    stamp: (art, r0, c0) => art.forEach((line, r) => [...line].forEach((ch, c) => { if (ch === '#') set(r0 + r, c0 + c, 1); })),
  };
}
// beside it, in the grid's own coordinates
function put(g, art, r0, c0) { art.forEach((line, r) => [...line].forEach((ch, c) => { const y = r0 + r, x = c0 + c; if (ch === '#' && y >= 0 && y < H && x >= 0 && x < W) g[y][x] = 1; })); }

function face(p, f, eyes, mouth, look = 0) {
  const [r0, r1] = f.eyes;
  for (const [a, b] of f.cols) {
    if (eyes === 'closed') p.hole(rect(r1, r1, a, b));
    else if (eyes === 'happy') { p.hole(rect(r0, r0, a, b)); p.hole([[r1, a - 1], [r1, b + 1]]); }
    else if (eyes === 'x') p.hole([[r0, a], [r1, b]]);
    else p.hole(rect(r0, r1, a + look, b + look));
  }
  const { mouth: m, m: [c0, c1] } = f, mid = Math.floor((c0 + c1) / 2);
  if (mouth === 'open') p.hole(rect(m - 1, m + 1, c0, c1));
  else if (mouth === 'smile') { p.hole(rect(m, m, c0, c1)); p.hole([[m - 1, c0 - 1], [m - 1, c1 + 1]]); }
  else if (mouth === 'small') p.hole(rect(m, m, mid, mid + (c1 > c0 ? 1 : 0)));
  else p.hole(rect(m, m, c0, c1));
}

function wear(p, it, idy = 0) {
  const up = (cells) => cells.map(([r, c]) => [r + idy, c]);
  if (it === 'crown') { p.lit(up([[-1, 5], [-1, 7], [-1, 8], [-1, 10], ...rect(0, 0, 5, 10)])); if (!idy) p.hole(rect(1, 1, 5, 10)); }
  if (it === 'party') { p.lit([[-2, 8], [-2, 9], [-1, 7], [-1, 8], ...rect(0, 0, 6, 9)]); p.hole(rect(1, 1, 5, 10)); }
  if (it === 'headphones') p.lit([...rect(-1, -1, 4, 11), [0, 3], [0, 12], [1, 2], [1, 13], ...rect(3, 7, 0, 0), ...rect(3, 7, 15, 15)]);
  if (it === 'record') { p.stamp(DISC, 7, -5); p.lit([[9, 0]]); }
  if (it === 'scarf') { p.hole(rect(10, 10, 2, 13)); p.lit([[11, 13], [12, 13], [12, 14], [13, 14]]); }
}

// The creature: its stage or form, its face, what it wears.
function creature(g, o) {
  const { f, eyes = 'open', mouth = 'neutral', look = 0, dy = 0, dx = 0, t = 0, dancing = false, it = null, idy = 0 } = o;
  const p = pen(g, dy, dx);
  if (f === 'egg') {
    p.stamp(EGG, 0, 0);
    p.hole([[7, 3], [6, 4], [7, 5], [6, 6], [7, 7], [6, 8], [7, 9], [6, 10], [7, 11], [6, 12]].slice(0, o.cracks || 0));
    return;
  }
  if (f === 'baby') { p.stamp(BABY, 0, 0); face(p, FACES.baby, eyes, mouth, look); wear(p, it === 'headphones' ? null : it, idy); return; }
  if (f === 'kid') { p.stamp(KID, 0, 0); face(p, FACES.kid, eyes, mouth, look); wear(p, it, idy); return; }
  if (f === 'ghost') {
    p.stamp(GHOST, 0, 0); p.stamp(HEMS[t % 2], 12, 0);
    face(p, FACES.body, eyes, mouth === 'neutral' ? 'small' : mouth, look);
    if (eyes === 'open') p.hole([...rect(4, 4, 4 + look, 5 + look), ...rect(4, 4, 10 + look, 11 + look)]);
    wear(p, it, idy);
    return;
  }
  p.stamp(BODY, 0, 0);
  if (dancing && t % 2) { p.hole([[12, 4], [12, 5]]); p.lit([[11, 3]]); } // a foot up on the beat
  if (f === 'teen') p.lit([[0, 8], [-1, 8], [-1, 9]]);
  if (f === 'owl') {
    p.lit([[0, 2], [0, 13], [1, 2], [1, 3], [1, 12], [1, 13], [-1, 2], [-1, 13]]);
    if (eyes === 'closed' || eyes === 'x') p.hole([...rect(6, 6, 3, 6), ...rect(6, 6, 9, 12)]);
    else if (eyes === 'happy') face(p, FACES.body, 'happy', 'neutral');
    else {
      p.hole([[4, 4], [4, 5], [5, 3], [6, 3], [7, 4], [7, 5], [5, 6], [6, 6], [4, 10], [4, 11], [5, 9], [6, 9], [7, 10], [7, 11], [5, 12], [6, 12]]);
      if (look > 0) p.hole([[5, 4], [6, 4], [5, 10], [6, 10]]); else if (look < 0) p.hole([[5, 5], [6, 5], [5, 11], [6, 11]]);
    }
    p.hole(mouth === 'open' ? rect(8, 10, 7, 8) : [[9, 7], [9, 8]]);
  } else if (f === 'raver') {
    if (eyes === 'closed' || eyes === 'x') p.hole([...rect(6, 6, 3, 6), ...rect(6, 6, 9, 12)]);
    else p.hole([...rect(5, 6, 3, 6), ...rect(5, 6, 9, 12), [5, 7], [5, 8]]); // shades
    face(p, { eyes: [99, 99], cols: [], mouth: 9, m: [6, 9] }, 'open', mouth);
  } else {
    face(p, FACES.body, eyes, mouth, look);
    if (f === 'collector') { p.stamp(DISC, 7, -5); p.lit([[9, 0]]); }
    if (f === 'loyalist' && !(dancing && t % 4 > 1)) p.stamp(HEART, 0, -5);
    if (f === 'bird') p.lit([[0, 6], [0, 8], [-1, 7], [0, 7], [7, 15], [8, 15], [7, 16]]);
    if (f === 'explorer') p.lit([[0, 8], [-1, 8], ...(t % 4 < 2 ? [[-2, 8], [-2, 9]] : [[-2, 8], [-2, 7]]), ...rect(6, 10, 0, 0), [7, -1], [8, -1], [9, -1]]);
    if (f === 'echo') { const k = t % 3; for (let r = 5; r <= 8; r++) { const y = r + ROW + dy; if (y >= 0 && y < H) { g[y][OFF - 2 - k] = 1; if (OFF + 17 + k < W) g[y][OFF + 17 + k] = 1; } } }
  }
  wear(p, f === 'collector' && it === 'record' ? null : it, idy);
}

// A flash: the creature's outline lit, its inside dark.
function outline(g) {
  const was = g.map((r) => r.slice()), on = (y, x) => y >= 0 && y < H && x >= 0 && x < W && was[y][x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y][x] = was[y][x] && !(on(y - 1, x) && on(y + 1, x) && on(y, x - 1) && on(y, x + 1)) ? 1 : 0;
}

const GROWN = (form) => !STAGES.includes(form);

function reaction(g, o) {
  const { react, reactMs: el = 0 } = o, k = Math.floor(el / 120), base = { f: o.form, it: o.item };
  switch (react) {
    case 'poke':
      if (k < 2) creature(g, { ...base, dy: 1, eyes: 'closed', mouth: 'small' }); else creature(g, { ...base, eyes: 'happy', mouth: 'smile' });
      break;
    case 'trick': {
      const s = [{ dy: 1 }, { dy: -2 }, { dy: -1, flip: 1 }, { dy: -2, flip: 1 }, { dy: 1 }][Math.floor(el / 230)];
      if (s) { creature(g, { ...base, dy: s.dy, eyes: 'closed', mouth: 'small' }); if (s.flip) g.reverse(); } else { creature(g, { ...base, eyes: 'happy', mouth: 'open' }); put(g, NOTE, 1, 21); }
      break;
    }
    case 'skip':
      creature(g, { ...base, eyes: 'x', mouth: 'small', dx: k % 2 ? 1 : -1 });
      put(g, [k % 2 ? '#.....#' : '...#...'], 0, OFF + 4); put(g, [k % 2 ? '...#...' : '#.....#'], 1, OFF + 4);
      break;
    case 'seek': creature(g, { ...base, dx: [1, 2, 2, 2, 2, 1, 0][Math.min(6, k)], look: 1, mouth: 'small' }); break;
    case 'loud': {
      const hand = Math.max(4, 9 - k);
      creature(g, { ...base, eyes: 'closed', mouth: 'small', dx: k % 4 === 1 ? 1 : 0 });
      pen(g).lit([[hand, -1], [hand + 1, -1], [hand, 16], [hand + 1, 16]]);
      break;
    }
    case 'quiet': creature(g, { ...base, dx: Math.min(2, k), look: 1, mouth: 'small' }); break;
    case 'eject': {
      const j = Math.floor(el / 150);
      if (j < 5) creature(g, { ...base, dy: [1, 1, -3, -8, -16][j], eyes: j < 2 ? 'open' : 'happy', mouth: 'small' });
      else if (j < 13) { /* out of the display */ } else if (j < 16) creature(g, { ...base, dy: [-8, -3, 1][j - 13], mouth: 'small' });
      else { creature(g, { ...base, look: 1, dx: j % 2, mouth: 'small' }); if (j % 4 < 3) put(g, QUESTION, 0, 21); }
      break;
    }
  }
  return g;
}

/**
 * One frame. `pose`: POSES; `form`: FORMS; `item`: what it wears (crown, record, headphones, scarf, party) or null;
 * `level`: the music's loudness now, 0–1 (playing); `look`: −1 / 0 / 1, where its eyes go; `from`: the form it molts
 * from; `react`, `reactMs`: a reaction going on (REACTIONS), and for how long.
 */
export function frame(t, { pose = 'paused', form = 'egg', item = null, level = 0, look = 0, from = null, react = null, reactMs = 0 } = {}) {
  const g = blank(), egg = form === 'egg', base = { f: form, it: item, t, look };
  if (react) return reaction(g, { form, item, react, reactMs });
  switch (pose) {
    case 'playing':
      if (egg) creature(g, { ...base, dx: t % 2 ? 1 : -1 });
      else if (level < 0.02) { creature(g, { ...base, eyes: 'closed', mouth: 'small' }); put(g, Z, t % 2 ? 1 : 3, 21); } // the silence between songs: a nap
      else if (level > 0.85) { creature(g, { ...base, eyes: 'happy', mouth: 'open', dy: -2, dancing: true }); put(g, NOTE, 0, 21); } // a loud peak: a jump
      else { creature(g, { ...base, mouth: 'smile', dy: t % 2 && level > 0.4 ? -1 : 0, dancing: true }); if (level > 0.5) put(g, NOTE, t % 2 ? 1 : 4, 21); }
      break;
    case 'paused':
      if (egg) creature(g, base); else creature(g, { ...base, eyes: t % 7 === 3 ? 'closed' : 'open' });
      break;
    case 'snack':
      if (egg) creature(g, { ...base, cracks: 1 + (Math.floor(t / 3) % 3) * 3, dx: t % 2 });
      else { creature(g, { ...base, mouth: t % 2 ? 'neutral' : 'open', look: 1 }); put(g, SNACK[Math.min(3, Math.floor(t / 2))], 9, 21); }
      break;
    case 'feast':
      if (t < 12) { creature(g, { ...base, mouth: t % 2 ? 'neutral' : 'open', look: 1 }); put(g, FEAST[Math.min(3, Math.floor(t / 3))], 8, 20); }
      else { creature(g, { ...base, eyes: 'happy', mouth: 'smile', dy: t % 2 ? -2 : 0, dancing: true }); put(g, NOTE, t % 2 ? 0 : 3, 21); }
      break;
    case 'fav':
      creature(g, { ...base, eyes: 'happy', mouth: 'open', dy: t % 2 ? -2 : 0, dx: t % 4 < 2 ? 0 : 1, dancing: true });
      put(g, t % 2 ? HEART : NOTE, 0, 20);
      break;
    case 'sniff':
      creature(g, { ...base, look: 1, dx: t % 2, mouth: 'small' });
      if (t % 4 < 3) put(g, QUESTION, 0, 21);
      put(g, SNACK[0], 11, 21);
      break;
    case 'asleep':
      if (egg) creature(g, base); else creature(g, { ...base, eyes: 'closed', mouth: 'small' });
      put(g, Z, t % 2 ? 1 : 5, 21);
      break;
    case 'hatch': hatch(g, t, form, item); break;
    case 'molt': {
      const before = from && from !== form ? from : form === 'owl' ? 'collector' : 'owl';
      if (t < 8) creature(g, { f: before, t, it: item, eyes: t % 5 === 2 ? 'closed' : 'open' });
      else if (t < 16) { creature(g, { f: before, it: item, dx: t % 2 ? 1 : -1, t, eyes: 'closed', mouth: 'small' }); if (t % 2) put(g, QUESTION, 0, 21); }
      else if (t < 22) { creature(g, { f: t % 2 ? form : before, it: item, t }); if (t % 2) outline(g); }
      else { creature(g, { ...base, eyes: 'happy', mouth: 'open', dy: t % 2 ? -1 : 0, dancing: true }); put(g, NOTE, t % 2 ? 0 : 3, 21); }
      break;
    }
    case 'trick': return reaction(g, { form, item, react: 'trick', reactMs: t * FRAME_MS.trick });
  }
  return g;
}

// Hatching: the egg wobbles, cracks, splits; out comes a baby, and with history behind it, it grows in a few flashes to
// the stage it's reached (`form`), with what it's earned dropping onto its head.
function hatch(g, t, form, item) {
  const c = Math.min(t, 63);
  if (c < 6) creature(g, { f: 'egg', dx: c % 2 ? 1 : -1 });
  else if (c < 18) { creature(g, { f: 'egg', dx: c % 2, cracks: c < 10 ? 3 : c < 14 ? 6 : 10 }); put(g, SNACK[2], 10, 21); }
  else if (c < 24) {
    const p = pen(g); creature(g, { f: 'baby', eyes: c % 2 ? 'happy' : 'open', mouth: 'small' });
    p.hole(rect(9, 13, 2, 13)); p.stamp(['...#.#..#.#.#...', '...##########...', '....########....', '.....######.....'], 9, 0); // the shell's bottom, its broken edge
    const fly = c - 18; p.stamp(['..####..', '.######.', '########'], -1 - fly, -5 + (fly > 2 ? -1 : 0)); // its top, flying off
  } else if (c < 30 || form === 'baby') creature(g, { f: 'baby', eyes: c % 3 ? 'open' : 'happy', mouth: 'smile', t: c });
  else if (c < 50) {
    const path = ['baby', 'kid', 'teen'].slice(0, Math.max(1, ['baby', 'kid', 'teen'].indexOf(GROWN(form) ? 'teen' : form) + 1));
    const step = Math.floor((c - 30) / 2), f = path[Math.min(path.length - 1, Math.floor(step / 3) + 1)] || path[path.length - 1];
    creature(g, { f, eyes: 'happy', mouth: 'smile', dy: c % 2 ? -1 : 0, t: c, dancing: true });
    if (step % 3 === 0 && c % 2 && path.length > 1) outline(g);
  } else creature(g, { f: form, eyes: c > 57 ? 'happy' : 'open', mouth: 'smile', it: item, idy: item ? Math.min(0, -6 + (c - 50)) : 0, t: c });
}

/** TERMINAL: two rows of dots to a character (▀ ▄ █), 8 lines of 25. */
export function termRows(g) {
  const rows = [];
  for (let y = 0; y < H; y += 2) {
    let s = '';
    for (let x = 0; x < W; x++) { const a = g[y][x], b = g[y + 1] && g[y + 1][x]; s += a && b ? '█' : a ? '▀' : b ? '▄' : ' '; }
    rows.push(s);
  }
  return rows;
}

/**
 * The deck display's way of drawing it on `canvas`: every dot faintly there (as the 88:88 behind the time), the lit
 * ones in `color` ([r,g,b]) with a glow — or, `lcd`, in the LCD's ink with none. `pitch`: px from one dot to the next.
 */
export function drawDots(canvas, g, { lcd = false, pitch = 2.6, color = [196, 20, 28] } = {}) {
  const dpr = (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1, pad = lcd ? 0 : Math.ceil(pitch * 1.5);
  const w = W * pitch + pad * 2, h = H * pitch + pad * 2;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, margin: `-${pad}px` });
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); c.translate(pad, pad);
  const s = pitch * 0.8, r = s * 0.3;
  const dot = (x, y) => { c.beginPath(); if (c.roundRect) c.roundRect(x * pitch, y * pitch, s, s, r); else c.rect(x * pitch, y * pitch, s, s); c.fill(); };
  c.shadowBlur = 0; c.fillStyle = `rgba(${color},${lcd ? 0.08 : 0.07})`;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!g[y][x]) dot(x, y);
  const pass = (blur) => { c.shadowBlur = blur; c.shadowColor = `rgba(${color},0.7)`; c.fillStyle = `rgba(${color},${lcd ? 0.92 : 0.9})`; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x]) dot(x, y); };
  if (!lcd) pass(pitch * 2.2);
  pass(0);
}

// ── TERMINAL: BLIP in a few thin characters, as the rest of that look is drawn (not the display's dots blown up) ──
// A box of 3 lines × 13 cells: what it holds on the left (cols 0–2), its body (3–9, 7 wide; an egg or a baby 5), what's
// beside it on the right (10–12): a note, its Z's, a ?, what it's eating. Its eyes say what it feels (o o, ^ ^, - -,
// @ @, > <) and follow the cursor; its form adds one thing of its own. Body in the muted tone, its face and what it
// wears in the accent: `tones` has an `a` or `m` for every cell.
export const TERM_W = 13;
const BIG_TOP = { teen: ' ,-v-. ', owl: ' ^---^ ', explorer: ' ,-+-. ' };
const ITEM_TOP = { crown: ' .WWW. ', party: ' ,-A-. ' };

function termBox() {
  const rows = Array.from({ length: 3 }, () => new Array(TERM_W).fill(' ')), tones = rows.map((r) => r.map(() => ' '));
  const put = (r, c, text, tone = 'm') => [...text].forEach((ch, i) => {
    const x = c + i;
    if (r >= 0 && r < 3 && x >= 0 && x < TERM_W && ch !== ' ') { rows[r][x] = ch; tones[r][x] = tone; }
  });
  const done = (flip = false) => {
    const out = { rows: rows.map((r) => r.join('')), tones: tones.map((r) => r.join('')) };
    if (flip) { out.rows.reverse(); out.tones.reverse(); }
    return out;
  };
  return { put, done };
}

const EYE = { open: ['o', 'o'], closed: ['-', '-'], happy: ['^', '^'], x: ['@', '@'], loud: ['>', '<'], small: ['.', '.'], big: ['O', 'O'] };
const MOUTH = { neutral: 'w', smile: 'w', open: 'o', small: '.' };

// The creature: its stage or form, its face, what it wears; `dx` sways it a cell.
function termCreature(b, { f, eyes = 'open', mouth = 'neutral', look = 0, dx = 0, it = null, cracks = 0, t = 0 }) {
  const [l, r] = EYE[eyes] || EYE.open, m = MOUTH[mouth] || mouth;
  if (f === 'egg') {
    const x = 4 + dx;
    b.put(0, x, ' .-. '); b.put(1, x, '(   )'); b.put(2, x, " `-' ");
    b.put(1, x + 1, ['', ' , ', ' / ', '/\\/'][Math.min(3, cracks)] || '', 'a');
    return;
  }
  if (f === 'baby') {
    const x = 4 + dx;
    b.put(1, x, '(   )'); b.put(2, x, " ' ' ");
    b.put(1, x + 1, `${l}${m === '-' ? '.' : m}${r}`, 'a');
    if (it === 'crown' || it === 'party') b.put(0, x, it === 'crown' ? ' www ' : '  A  ', 'a');
    return;
  }
  const x = 3 + dx, ghost = f === 'ghost';
  b.put(0, x, BIG_TOP[f] || ' ,---. ');
  b.put(1, x, '(     )');
  if (ghost) b.put(2, x + 1, t % 2 ? '~v~v~' : 'v~v~v');
  else { b.put(2, x, " `- -' "); b.put(2, x + 3, m, 'a'); }
  if (f === 'raver' && (eyes === 'open' || eyes === 'happy')) b.put(1, x + 2, '■-■', 'a'); // shades
  else {
    const s = look > 0 ? 2 : look < 0 ? 0 : 1, round = ghost && eyes === 'open';
    b.put(1, x + 1 + s, `${round ? '°' : l} ${round ? '°' : r}`, 'a');
  }
  if (f === 'owl') { b.put(0, x + 1, '^', 'a'); b.put(0, x + 5, '^', 'a'); }
  if (f === 'collector') b.put(1, 0, '(o)', 'a');
  if (f === 'loyalist' && t % 4 < 3) b.put(0, 1, '<3', 'a');
  if (f === 'bird') { b.put(0, 1, '*', 'a'); b.put(2, x + 3, 'v', 'a'); }
  if (f === 'explorer') b.put(0, x + 3, '+', 'a');
  if (f === 'echo') { const k = t % 2; b.put(1, k, '((', 'a'); b.put(1, 11 - k, '))', 'a'); }
  if (it === 'crown' || it === 'party') b.put(0, x, ITEM_TOP[it], 'a');
  if (it === 'headphones') { b.put(1, x, '[', 'a'); b.put(1, x + 6, ']', 'a'); }
  if (it === 'scarf') b.put(2, x + 6, "'~~", 'a');
  if (it === 'record' && f !== 'collector') b.put(1, 0, '(@)', 'a');
}

function termReaction(b, { form, item, react, reactMs: el = 0 }) {
  const k = Math.floor(el / 120), base = { f: form, it: item };
  switch (react) {
    case 'poke': termCreature(b, { ...base, ...(k < 2 ? { eyes: 'closed', mouth: 'small' } : { eyes: 'happy', mouth: 'smile' }) }); break;
    case 'trick': {
      const s = Math.floor(el / 230);
      if (s < 5) { termCreature(b, { ...base, eyes: 'closed', mouth: 'small', dx: s % 2 }); return b.done(s === 2 || s === 3); }
      termCreature(b, { ...base, eyes: 'happy', mouth: 'open' }); b.put(0, 11, '♪', 'a');
      break;
    }
    case 'skip': termCreature(b, { ...base, eyes: 'x', mouth: 'small', dx: k % 2 }); b.put(0, 10 + (k % 2), '*', 'a'); break;
    case 'seek': termCreature(b, { ...base, look: 1, mouth: 'small', dx: k < 6 ? 1 : 0 }); break;
    case 'loud': termCreature(b, { ...base, eyes: 'loud', mouth: 'small' }); b.put(1, 10, '!!', 'a'); break;
    case 'quiet': termCreature(b, { ...base, eyes: 'small', look: 1, mouth: 'small', dx: 1 }); b.put(0, 11, '?', 'a'); break;
    case 'eject': {
      const j = Math.floor(el / 150);
      if (j < 3) termCreature(b, { ...base, eyes: j ? 'happy' : 'big', mouth: 'small' });
      else if (j >= 13) { termCreature(b, { ...base, look: 1, mouth: 'small', dx: j % 2 }); if (j % 4 < 3) b.put(0, 11, '?', 'a'); }
      break;
    }
  }
  return b.done();
}

/** TERMINAL's BLIP: { rows: 3 strings of 13 cells, tones: the same with `a` (accent) or `m` (muted) per cell }. Same options as frame(). */
export function termPet(t, { pose = 'paused', form = 'egg', item = null, level = 0, look = 0, from = null, react = null, reactMs = 0 } = {}) {
  const b = termBox(), egg = form === 'egg', base = { f: form, it: item, t, look };
  if (react) return termReaction(b, { form, item, react, reactMs });
  const note = (r) => b.put(r, 11, '♪', 'a');
  switch (pose) {
    case 'playing':
      if (egg) termCreature(b, { ...base, dx: t % 2 });
      else if (level < 0.02) { termCreature(b, { ...base, eyes: 'closed', mouth: 'small' }); b.put(t % 2 ? 0 : 1, 11, t % 2 ? 'Z' : 'z', 'a'); }
      else if (level > 0.85) { termCreature(b, { ...base, eyes: 'happy', mouth: 'open', dx: t % 2 }); note(0); }
      else { termCreature(b, { ...base, mouth: 'smile', dx: t % 2 && level > 0.4 ? 1 : 0 }); if (level > 0.5) note(t % 2 ? 0 : 1); }
      break;
    case 'paused': termCreature(b, egg ? base : { ...base, eyes: t % 7 === 3 ? 'closed' : 'open' }); break;
    case 'snack':
      if (egg) termCreature(b, { ...base, cracks: 1 + (Math.floor(t / 3) % 3), dx: t % 2 });
      else {
        termCreature(b, { ...base, look: 1, eyes: t < 4 ? 'big' : 'open', mouth: t < 4 ? 'open' : t % 2 ? 'smile' : 'open' });
        if (t < 2) b.put(1, 12, 'o', 'a'); else if (t < 4) b.put(1, 11, 'o', 'a'); else if (t < 7) b.put(2, 10 + (t % 2), '·', 'a');
      }
      break;
    case 'feast':
      if (t < 12) { termCreature(b, { ...base, look: 1, eyes: 'big', mouth: t % 2 ? 'smile' : 'open' }); b.put(1, 10, ['(@)', '(@', '(', ''][Math.min(3, Math.floor(t / 3))], 'a'); }
      else { termCreature(b, { ...base, eyes: 'happy', mouth: 'smile', dx: t % 2 }); note(t % 2 ? 0 : 1); }
      break;
    case 'fav': termCreature(b, { ...base, eyes: 'happy', mouth: 'open', dx: t % 2 }); b.put(t % 2 ? 0 : 1, 11, t % 2 ? '<3' : '♪', 'a'); break;
    case 'sniff': termCreature(b, { ...base, look: 1, mouth: 'small', dx: t % 2 }); if (t % 4 < 3) b.put(0, 11, '?', 'a'); b.put(2, 11, '·', 'a'); break;
    case 'asleep': termCreature(b, egg ? base : { ...base, eyes: 'closed', mouth: 'small' }); b.put(t % 2 ? 0 : 1, 11, t % 2 ? 'Z' : 'z', 'a'); break;
    case 'hatch': {
      const c = Math.min(t, 63);
      if (c < 6) termCreature(b, { f: 'egg', dx: c % 2 });
      else if (c < 18) termCreature(b, { f: 'egg', dx: c % 2, cracks: c < 10 ? 1 : c < 14 ? 2 : 3 });
      else if (c < 24) { termCreature(b, { f: 'baby', eyes: c % 2 ? 'happy' : 'big', mouth: 'small' }); b.put(2, 4, '\\___/'); b.put(0, 9 + Math.min(3, c - 18), '^'); }
      else if (c < 40 || form === 'baby') termCreature(b, { f: 'baby', eyes: c % 3 ? 'open' : 'happy', mouth: 'smile' });
      else { termCreature(b, { f: form, it: item, eyes: c > 50 ? 'happy' : 'open', mouth: 'smile', t: c }); if (c < 46 && c % 2) note(0); }
      break;
    }
    case 'molt': {
      const before = from && from !== form ? from : form === 'owl' ? 'collector' : 'owl';
      if (t < 8) termCreature(b, { f: before, it: item, t, eyes: t % 5 === 2 ? 'closed' : 'open' });
      else if (t < 16) { termCreature(b, { f: before, it: item, t, dx: t % 2, eyes: 'closed', mouth: 'small' }); if (t % 2) b.put(0, 11, '?', 'a'); }
      else if (t < 22) termCreature(b, { f: t % 2 ? form : before, it: item, t, eyes: 'big' });
      else { termCreature(b, { ...base, eyes: 'happy', mouth: 'open', dx: t % 2 }); note(t % 2 ? 0 : 1); }
      break;
    }
    case 'trick': return termReaction(b, { form, item, react: 'trick', reactMs: t * FRAME_MS.trick });
  }
  return b.done();
}
