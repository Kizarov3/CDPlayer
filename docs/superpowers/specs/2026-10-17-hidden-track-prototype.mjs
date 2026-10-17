// Proposed HIDDEN TRACK detector + synthetic tests. Envelope: 100 ms blocks of mean power over channels (dBFS),
// smoothed over 1 s. Gap = run below a silence threshold derived from the file's own floor.
const BLOCK = 0.1, SMOOTH = 1;
const MIN_SONG = 30, MIN_HIDDEN = 20, MIN_GAP_DIGITAL = 10, MIN_GAP_HISS = 30, HISS_SPREAD = 6, RISE = 15;
const db = (p) => (p > 1e-12 ? 10 * Math.log10(p) : -120);

export function envelope(channels, rate) {
  const n = channels[0].length, step = Math.round(rate * BLOCK), blocks = Math.ceil(n / step), power = new Float64Array(blocks);
  for (const x of channels) for (let i = 0; i < n; i++) power[(i / step) | 0] += x[i] * x[i];
  for (let b = 0; b < blocks; b++) power[b] /= channels.length * Math.min(step, n - b * step);
  return power;
}
export function detectHidden(power) {
  const blocks = power.length, half = Math.round(SMOOTH / BLOCK / 2), S = new Float64Array(blocks);
  let sum = 0, lo = 0, hi = -1;
  for (let b = 0; b < blocks; b++) { while (hi < Math.min(blocks - 1, b + half)) sum += power[++hi]; while (lo < b - half) sum -= power[lo++]; S[b] = db(sum / (hi - lo + 1)); }
  const sorted = Array.from(S).sort((a, b) => a - b), floor = sorted[Math.floor(blocks * 0.05)];
  const T = Math.min(-48, Math.max(-70, floor + 12)); // digital zero/dither -> -70 dBFS; hiss at -58 -> -48
  const sec = (b) => +(b * BLOCK).toFixed(1);
  let best = null;
  for (let b = 0; b < blocks;) {
    if (S[b] >= T) { b++; continue; }
    let e = b; while (e < blocks && S[e] < T) e++;
    const len = (e - b) * BLOCK, run = Array.from(S.subarray(b, e)).sort((x, y) => x - y);
    const gapFloor = run[Math.floor(run.length / 2)], spread = run[Math.floor(run.length * 0.95)] - run[Math.floor(run.length * 0.05)];
    const digital = gapFloor < -70;
    const okGap = digital ? len >= MIN_GAP_DIGITAL : len >= MIN_GAP_HISS && spread <= HISS_SPREAD;
    if (okGap && b * BLOCK >= MIN_SONG) {
      const loud = Math.max(gapFloor + RISE, -60);
      let audible = 0, last = -1; for (let k = e; k < blocks; k++) if (S[k] > loud) { audible++; last = k; }
      let first = e; while (first < blocks && S[first] <= loud) first++;
      if (audible * BLOCK >= MIN_HIDDEN && (last - first + 1) * BLOCK >= MIN_HIDDEN) {
        if (!best || len > best.gap) best = { songEnd: sec(b), hiddenStart: sec(first), gap: +len.toFixed(1), threshold: T, gapFloor: +gapFloor.toFixed(1), spread: +spread.toFixed(1) };
      }
    }
    b = e;
  }
  return best;
}

// ---- synthetic signals at 8 kHz (computeWaveform's rate) ----
const RATE = 8000;
let seed = 1; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) * Math.SQRT2; };
const dbLin = (d) => 10 ** (d / 20);
function music(sec, rmsDb, { fadeOut = 0, pauses = false } = {}) {
  const n = Math.round(sec * RATE), out = new Float32Array(n), a = dbLin(rmsDb);
  for (let i = 0; i < n; i++) {
    const t = i / RATE, beat = 0.6 + 0.4 * Math.abs(Math.sin(Math.PI * t * 2));
    let g = a * beat * (gauss() * 0.7 + Math.sin(2 * Math.PI * 220 * t) * 0.7);
    if (fadeOut && t > sec - fadeOut) g *= ((sec - t) / fadeOut) ** 2;
    if (pauses && (t % 4) > 3) g = 0;
    out[i] = g;
  }
  return out;
}
const zeros = (sec) => new Float32Array(Math.round(sec * RATE));
const dither = (sec) => { const n = Math.round(sec * RATE), o = new Float32Array(n), lsb = 1 / 32768; for (let i = 0; i < n; i++) o[i] = (rnd() - rnd()) * lsb; return o; };
const hiss = (sec, d) => { const n = Math.round(sec * RATE), o = new Float32Array(n), a = dbLin(d); for (let i = 0; i < n; i++) o[i] = gauss() * a; return o; };
const cat = (...xs) => { const n = xs.reduce((s, x) => s + x.length, 0), o = new Float32Array(n); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
const add = (x, y) => { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] + y[i]; return o; };

const cases = [
  ['Nevermind-like: 232 s song (fade 8 s), 598 s zeros, 405 s hidden', () => cat(music(232, -14, { fadeOut: 8 }), zeros(598), music(405, -12)), [232, 830]],
  ['same, silence = 16-bit TPDF dither', () => cat(music(232, -14, { fadeOut: 8 }), dither(598), music(405, -12)), [232, 830]],
  ['vinyl-like: hiss -58 dBFS under everything', () => { const x = cat(music(232, -14, { fadeOut: 8 }), zeros(598), music(405, -12)); return add(x, hiss(x.length / RATE, -58)); }, [232, 830]],
  ['Dookie-like: 170 s song, 80 s zeros, 96 s hidden', () => cat(music(170, -10), zeros(80), music(96, -10)), [170, 250]],
  ['quiet a cappella hidden (-38 dBFS, 1 s pauses)', () => cat(music(300, -14), dither(240), music(90, -38, { pauses: true })), [300, 540]],
  ['NOT: long ambient outro at -46 dBFS, no silence', () => cat(music(240, -14), music(120, -46)), null],
  ['NOT: song + 600 s zeros + 4 s noise', () => cat(music(240, -14), zeros(600), music(4, -20)), null],
  ['NOT: song with a 3 s dead stop in the middle', () => cat(music(120, -14), zeros(3), music(120, -14)), null],
  ['NOT: song with a 20 s quiet interlude at -52 dBFS', () => cat(music(120, -14), music(20, -52), music(120, -14)), null],
  ['NOT: song then 10 min silence to the end', () => cat(music(240, -14, { fadeOut: 8 }), zeros(600)), null],
  ['NOT: 30 s HTOA-style leading silence then song', () => cat(zeros(30), music(240, -14)), null],
];
for (const [name, make, truth] of cases) {
  const x = make(), t0 = performance.now(), r = detectHidden(envelope([x, x], RATE)), ms = (performance.now() - t0).toFixed(0);
  const ok = truth ? !!r && Math.abs(r.songEnd - truth[0]) <= 2 && Math.abs(r.hiddenStart - truth[1]) <= 1 : !r;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (${(x.length / RATE).toFixed(0)} s, ${ms} ms) ->`, r ? JSON.stringify(r) : 'none');
}
