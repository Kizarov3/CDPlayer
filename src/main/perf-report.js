'use strict';
// `--perf-report=<file.json> [--perf-seconds=<s>]`: how much the player costs and how quickly it answers, measured in
// the real window, in a throwaway data folder (set up in main.js, as --theme-shots). Each scenario — paused, playing,
// each PLAYER LOOK, CD VIEW, in the background, minimised, and the things people press (a panel opened and closed, the
// shelf, a key) — is given a few seconds, and for it come: the CPU each kind of process used (app.getAppMetrics), the
// frames the page drew and the ones that came late, the long frames (what script held them up), and for every click or
// key, how long until the window showed its answer (the Event Timing API). The window shows and is treated as looked
// at, but never takes the focus from what you're doing. The music is made here: a minute of a chord whose loudness
// swells, so the spectrum, the meters and the pet have something to move to.
const fs = require('fs');
const os = require('os');
const path = require('path');

/** A WAV of `seconds` of a chord, 44.1 kHz stereo 16-bit, its loudness swelling and falling (pure: a Buffer). */
function chordWav(seconds = 60, rate = 44100) {
  const n = Math.round(seconds * rate), data = Buffer.alloc(n * 4), freqs = [110, 220, 277.18, 329.63, 440, 880, 1760];
  let seed = 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate, swell = 0.35 + 0.3 * Math.sin(2 * Math.PI * 0.5 * t) + 0.15 * Math.sin(2 * Math.PI * 2 * t);
    let v = 0;
    for (let k = 0; k < freqs.length; k++) v += Math.sin(2 * Math.PI * freqs[k] * t) / (k + 2);
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    v = (v * 0.5 + ((seed / 0x7fffffff) - 0.5) * 0.08) * swell;
    const s = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
    data.writeInt16LE(s, i * 4); data.writeInt16LE(s, i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const pct = (list, p) => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * One scenario's numbers, from what was gathered (pure): `cpu` { type: % }, `frames` the gaps between frames (ms),
 * `loafs` the long frames, `events` the clicks and keys. `vsync`: the display's frame (ms).
 */
function summarize({ cpu = {}, frames = [], loafs = [], events = [], memory = {}, seconds = 1, vsync = 1000 / 60 }) {
  const late = frames.filter(([, d, gap]) => d > Math.max(gap || 0, vsync) * 1.5 + 2).length;
  const blocked = loafs.reduce((a, l) => a + (l.block || 0), 0);
  const culprits = new Map();
  for (const l of loafs) for (const s of l.scripts || []) culprits.set(s.src, (culprits.get(s.src) || 0) + s.d);
  return {
    cpu: Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, r1(v)])),
    cpuTotal: r1(Object.values(cpu).reduce((a, b) => a + b, 0)),
    fps: r1(frames.length / seconds), late, worstFrame: r1(Math.max(0, ...frames.map((f) => f[1]))),
    longFrames: loafs.length, blockedMs: Math.round(blocked),
    slowest: [...culprits].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([src, d]) => `${src} ${Math.round(d)}ms`),
    answers: events.length ? { n: events.length, p50: Math.round(pct(events.map((e) => e.d), 50)), worst: Math.round(Math.max(...events.map((e) => e.d))), worstWhat: events.reduce((a, e) => (e.d > a.d ? e : a)).name, ...(events.some((e) => e.work != null) ? { waitP50: Math.round(pct(events.map((e) => e.wait || 0), 50)), workP50: Math.round(pct(events.map((e) => e.work || 0), 50)), workWorst: Math.round(Math.max(...events.map((e) => e.work || 0))) } : {}) } : null,
    memoryMB: Object.fromEntries(Object.entries(memory).map(([k, v]) => [k, Math.round(v / 1024)])),
  };
}

// In the page from before its scripts run: every frame's time, the long frames with the scripts that held them, and
// every click or key slower than a frame, with how long until the window showed what it did.
const PROBE = `(() => {
  const P = window.__perf = { frames: [], loafs: [], events: [], mark: 0 };
  // (the frames: app.js's frame() puts each one it draws here, [when, ms since the last, the gap it allows] — the probe
  // asks for no frames of its own, which would keep the window awake)
  const where = (s) => ((s.sourceURL || '').split('/').pop() || '?') + ':' + (s.sourceFunctionName || s.invoker || '?');
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.loafs.push({ at: e.startTime, d: e.duration, block: e.blockingDuration, scripts: (e.scripts || []).map((s) => ({ src: where(s), d: s.duration })) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { /* (an older engine: none) */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.events.push({ at: e.startTime, name: e.name, d: e.duration, wait: e.processingStart - e.startTime, work: e.processingEnd - e.processingStart }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) { /* (likewise) */ }
  document.hasFocus = () => true; // (looked at, as by someone using it — without taking the focus from them)
})();`;

async function probe(win) {
  const dbg = win.webContents.debugger;
  await win.loadURL('about:blank');
  dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A CPU profile of the page while `during` runs: its functions by the time spent in them (their own, not in what they call).
async function profileOf(win, during) {
  const dbg = win.webContents.debugger;
  await dbg.sendCommand('Profiler.enable');
  await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 200 });
  await dbg.sendCommand('Profiler.start');
  await during();
  const { profile } = await dbg.sendCommand('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n])), self = new Map();
  const deltas = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, i) => {
    const f = byId.get(id).callFrame, name = `${f.functionName || '(anonymous)'} ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`;
    self.set(name, (self.get(name) || 0) + (deltas[i + 1] || deltas[i] || 0));
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, us]) => `${String(Math.round((us / total) * 1000) / 10).padStart(5)}%  ${Math.round(us / 1000)}ms  ${name}`);
}

async function run({ win, app, seconds = 5, bisect = null, profile = false }) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-perf-music-'));
  const album = path.join(dir, 'Perf Artist', 'Perf Album');
  fs.mkdirSync(album, { recursive: true });
  const wav = chordWav(60);
  for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(album, `0${i} Chord ${i}.wav`), wav);
  const key = (keyCode, shift = false) => {
    const modifiers = shift ? ['shift'] : [];
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const click = async (selector) => {
    const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    if (!r) return false;
    win.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    return true;
  };
  const waitFor = async (cond, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await js(`!!(${cond})`)) return true; await wait(100); } return false; };
  const results = {}, profiles = {};
  const measure = async (name, ms, during) => {
    if (profile && /^(playing CLASSIC|paused, a while later|playing HIFI|playing VISUALIZER|playing CD VIEW)$/.test(name)) {
      profiles[name] = await profileOf(win, () => wait(ms));
      console.log(`perf: profile of ${name}:\n  ${profiles[name].join('\n  ')}`);
    }
    app.getAppMetrics(); // (the CPU is reckoned from one call to the next)
    await js('window.__perf.mark = performance.now()');
    const t0 = Date.now();
    if (during) await during();
    const left = ms - (Date.now() - t0);
    if (left > 0) await wait(left);
    const metrics = app.getAppMetrics(), cpu = {}, memory = {};
    for (const m of metrics) { cpu[m.type] = (cpu[m.type] || 0) + m.cpu.percentCPUUsage; memory[m.type] = (memory[m.type] || 0) + m.memory.workingSetSize; }
    const got = await js(`(() => { const P = window.__perf, m = P.mark, a = P.app; return { state: a ? { playing: !!a.engine.playing, look: a.state.look, cdView: !!a.state.cdView, visualizer: !!a.state.visualizerMode } : null, frames: P.frames.filter((f) => f[0] >= m), loafs: P.loafs.filter((l) => l.at >= m), events: P.events.filter((e) => e.at >= m) }; })()`);
    results[name] = { ...summarize({ ...got, cpu, memory, seconds: (Date.now() - t0) / 1000 }), state: got.state };
    const s = results[name];
    console.log(`perf: ${name.padEnd(22)} cpu ${String(s.cpuTotal).padStart(5)}%  fps ${String(s.fps).padStart(5)}  late ${String(s.late).padStart(3)}  long ${s.longFrames}  [${Object.entries(s.cpu).map(([k, v]) => `${k} ${v}`).join(' ')}] ${s.state && s.state.playing ? '▶' : '‖'}${s.answers ? `  answer p50 ${s.answers.p50}ms worst ${s.answers.worst}ms (${s.answers.worstWhat}; waiting ${s.answers.waitP50}ms, our code ${s.answers.workP50}ms, at most ${s.answers.workWorst}ms)` : ''}${s.slowest.length ? `  ← ${s.slowest.join(', ')}` : ''}`);
  };
  const S = seconds * 1000;

  win.setAlwaysOnTop(true, 'floating'); // (over the other windows, so the system draws all of it all the time — still without the focus)
  win.showInactive();
  await waitFor(`document.getElementById('track-title')`, 15000);
  await wait(2500);
  await measure('nothing loaded', S);
  if (bisect) {
    // which part of a look costs the most to draw: each hidden in turn, the cost measured without it
    win.webContents.send('open-files', [path.join(album, '01 Chord 1.wav')]);
    await waitFor(`/Chord/.test(document.getElementById('track-title').textContent)`, 15000);
    await js(`window.__perf.app.setLook(${JSON.stringify(bisect)})`); await wait(3000);
    await measure(`${bisect} as it is`, S);
    for (const sel of ['#backdrop', '#backdrop-art', '#backdrop-flow', '#cover-art', '#album-disc', '#case-box', '#disc', '#queue-card', '#progress-row', '#controls', '#look-visualizer', '#header-block', '#player']) {
      const hid = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.getClientRects().length) return false; e.dataset.perfWas = e.style.visibility; e.style.visibility = 'hidden'; return true; })()`);
      if (!hid) continue;
      await wait(800); await measure(`  without ${sel}`, S);
      await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.style.visibility = e.dataset.perfWas || ''; })()`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return { results };
  }
  win.webContents.send('open-files', [path.join(album, '01 Chord 1.wav'), path.join(album, '02 Chord 2.wav'), path.join(album, '03 Chord 3.wav')]);
  await waitFor(`/Chord/.test(document.getElementById('track-title').textContent)`, 15000);
  await wait(3000);
  const playing = () => js(`!!document.querySelector('#play-button.playing, body.playing') || (document.getElementById('status').textContent || '').includes('PLAY')`);
  await measure('playing CLASSIC', S);
  key('Space'); await wait(1500);
  await measure('paused CLASSIC', S);
  await wait(8000); await measure('paused, a while later', S); // (the disc has wound down: nothing moves)
  key('Space'); await wait(1500);
  const look = (k) => js(`window.__perf.app.setLook(${JSON.stringify(k)})`);
  for (const k of ['VISUALIZER', 'LYRICS', 'HIFI', 'ALBUM', 'CASE', 'TERMINAL']) { await look(k); await wait(1500); await measure(`playing ${k}`, S); }
  await look('CLASSIC'); await wait(1500);
  key('C'); await wait(2000); await measure('playing CD VIEW', S); key('C'); await wait(2000);
  key('V'); await wait(2000); await measure('VISUALIZER MODE', S); key('Escape'); await wait(2000);
  await js('document.hasFocus = () => false; 0'); await measure('playing, behind others', S); await js('delete document.hasFocus; 0'); // (the page's own again: a minimised window must find out for itself)
  win.minimize(); await wait(1500); await measure('playing, minimised', S); win.restore(); win.showInactive(); win.setAlwaysOnTop(true, 'floating'); await js('document.hasFocus = () => true; 0'); await wait(2000); // (the rest as if looked at)
  // the things people press: how soon the window answers, and whether its moves stay smooth
  await measure('open+close panels', S * 2, async () => {
    for (const [open, sel] of [['#settings-button', '.settings-tab'], ['#history-button', '.overlay .card'], ['#lyrics-button', '.overlay .card']]) {
      await click(open); await waitFor(`document.querySelector('.overlay:not(.closing) ${sel === '.settings-tab' ? '.settings-tab' : '.card'}')`, 3000); await wait(700);
      key('Escape'); await wait(700);
    }
  });
  await measure('shelf open+close', S * 2, async () => { key('S'); await wait(2500); key('Escape'); await wait(2000); });
  await measure('keys (next, volume, seek)', S, async () => {
    for (const k of ['L', 'Up', 'Down', 'Right', 'Left', 'J']) { key(k); await wait(450); }
  });
  await measure('look switches', S * 2, async () => {
    for (const k of ['HIFI', 'TERMINAL', 'ALBUM', 'CLASSIC']) { await look(k); await wait(900); }
  });
  await js('window.__perf.app.setPet(true); 0'); await wait(2500);
  await measure('playing + DECK PET', S);
  await js('window.__perf.app.setPet(false); 0');
  // (on Windows the song still playing can't be deleted yet: tried a few times, and else left to the temp folder's own cleaning — the report matters more)
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left behind */ }
  return { results, profiles, playing: await playing() };
}

module.exports = { run, probe, summarize, chordWav, PROBE };
