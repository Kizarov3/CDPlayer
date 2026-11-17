// BLIP on the deck's display (Settings → DECK PET): main's pet.js says what it is; this draws it (pet-sprite.js) in
// the empty space between the lamps and the time, and keeps it alive — bobbing to the music, eating what's played,
// noticing you (its eyes follow the cursor, a click is a poke, it feels a skip, a seek, the volume, the tray) and now
// and then saying a word or two in place of the lamps, only in the quiet between songs. Driven by the window's own
// frame loop (app.js), at its own few frames a second; nothing at all while it's off.
import { frame, drawDots, termRows, FRAME_MS, SCENE_FRAMES, REACT_MS } from './pet-sprite.js';
import { colors, shown } from './theme.js';
import { LCD_INK } from './deck-display.js';
import { t } from './i18n.js';

const ASLEEP_AFTER = 3 * 86400e3; // no music for this long: it's asleep
const WORD_MS = 2300, WORD_WAIT_MS = 60e3, SNACK_WORD_EVERY = 5, PEAK_EVERY = 20e3, POKES_MS = 1300;
const TRICK_ODDS = { sleepy: 30, bouncy: 12, curious: 25, shy: 40 }; // one in this many snacks ends in a somersault
const moving = () => !document.body.classList.contains('no-anim') && !matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * `canvas`: its place in the display; `say`: the span that takes the lamps' place for a word; `display`: #deck-display;
 * `pet`: preload's cdp.pet; `openCard()`: its card (panels.js).
 */
export function createPetView({ canvas, say, display, pet, openCard }) {
  let on = false, view = null;
  let scene = null;          // a one-off pose: { pose, t, from }
  let react = null;          // a reaction: { kind, at }
  let step = 0, stepAt = 0, drawnKey = '', grid = null;
  let look = 0, movedAt = 0, pokes = [];
  let word = null, wordQueue = [], snacksSinceWord = SNACK_WORD_EVERY, lastPeak = 0, wasAsleep = false, favOn = false;

  function setOn(next) {
    on = !!next;
    document.body.classList.toggle('pet-on', on);
    if (!on) {
      view = null; scene = null; react = null; drawnKey = ''; hush();
      return pet.on(false).catch(() => null).then(() => null); // (main stops moving it on with each play)
    }
    return pet.on(true).then((r) => { if (r && on) { view = r.view; events(r.events || [], r.view); } return view; }).catch(() => null);
  }
  const setView = (v) => { if (v) view = v; drawnKey = ''; };

  function queueWord(text, { snack = false } = {}) {
    if (snack) { if (snacksSinceWord < SNACK_WORD_EVERY) return; snacksSinceWord = 0; }
    wordQueue.push({ text: String(text).toUpperCase(), until: performance.now() + WORD_WAIT_MS });
  }
  /** The lamps back, with no word waiting. */
  function hush() { word = null; wordQueue = []; display.classList.remove('saying'); }
  function showWord(now) {
    if (word && now > word.until) { word = null; display.classList.remove('saying'); }
    wordQueue = wordQueue.filter((w) => w.until > now);
    if (word || !wordQueue.length) return;
    word = { text: wordQueue.shift().text, until: now + WORD_MS };
    say.textContent = word.text;
    display.classList.add('saying');
    say.animate([{ opacity: 0.15 }, { opacity: 1, filter: 'brightness(1.6)', offset: 0.35 }, { opacity: 0.7, offset: 0.55 }, { opacity: 1, filter: 'none' }], { duration: 360, easing: 'ease-out' });
  }

  /** What main said came of a play (or of turning it on): the scene it sets off, and what it says. */
  function events(list, v) {
    if (v) setView(v);
    if (!on) return;
    const has = (k) => list.find((e) => e.kind === k);
    if (wasAsleep && has('snack')) { queueWord(t('YAAAWN… HI')); wasAsleep = false; }
    if (has('snack')) snacksSinceWord++;
    if (has('hatch')) { scene = { pose: 'hatch', t: 0 }; queueWord(t('HELLO!')); }
    else if (has('molt')) { scene = { pose: 'molt', t: 0, from: has('molt').from }; queueWord(t('TA-DA')); }
    else if (has('feast')) { scene = { pose: 'feast', t: 0 }; queueWord(t('WHOLE THING!')); }
    else if (has('sniff')) { scene = { pose: 'sniff', t: 0 }; queueWord(t('NEW? SNIFF SNIFF')); }
    else if (has('snack')) {
      scene = { pose: 'snack', t: 0 };
      queueWord(t('YUM'), { snack: true });
      if (Math.random() * (TRICK_ODDS[view && view.temper] || 25) < 1) scene.then = 'trick';
    }
    if (has('found')) queueWord(has('found').form === 'ghost' ? t('BOO!') : t('ME AGAIN?'));
    const echo = has('echo');
    if (echo) queueWord(t('A YEAR AGO TODAY: {song}', { song: echo.title || t('THIS SONG') }));
    if (has('grow') && !has('hatch')) reactTo('trick');
    drawnKey = '';
  }

  function reactTo(kind) {
    if (!on || !view || !moving()) return;
    react = { kind, at: performance.now() };
  }

  // its eyes on the cursor; a click is a poke (three quick ones, a somersault); a double-click, its card
  window.addEventListener('mousemove', (e) => {
    if (!on || !canvas.offsetParent) return;
    const r = canvas.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2);
    const next = dx > 60 ? 1 : dx < -60 ? -1 : 0;
    movedAt = performance.now();
    if (next !== look) { look = next; drawnKey = ''; }
  }, { passive: true });
  canvas.addEventListener('click', () => {
    const now = performance.now();
    pokes = pokes.filter((p) => now - p < POKES_MS); pokes.push(now);
    if (pokes.length >= 3) { pokes = []; reactTo('trick'); } else reactTo('poke');
  });
  canvas.addEventListener('dblclick', (e) => { e.preventDefault(); openCard(); });

  /** The pose it's in now, with no scene or reaction: the music playing, its favourite, paused, or asleep. */
  function restingPose(playing, track) {
    if (playing) {
      const fav = !!(view && view.favourite && view.favourite.paths.includes(track));
      if (fav && !favOn && view.favourite.title) queueWord(`${view.favourite.title}!!`);
      favOn = fav;
      return fav ? 'fav' : 'playing';
    }
    favOn = false;
    const asleep = view && view.lastPlay && Date.now() - view.lastPlay > ASLEEP_AFTER;
    if (asleep) wasAsleep = true;
    return asleep ? 'asleep' : 'paused';
  }

  /** A frame of the window (app.js): drawn again when its pose moves on, or what it shows has changed. */
  function tick(now, { playing = false, level = () => 0, track = null } = {}) {
    const terminal = document.body.classList.contains('look-terminal');
    if (!on || !view || !(canvas.offsetParent || terminal)) { if (word) hush(); return; } // (out of sight: no word over the lamps)
    const still = !moving();
    if (react && now - react.at > REACT_MS[react.kind]) react = null;
    const pose = scene ? scene.pose : restingPose(playing, track);
    const pace = react ? 120 : FRAME_MS[pose] || 500;
    if (!still && now - stepAt >= pace) {
      stepAt = now; step++;
      if (scene && ++scene.t >= SCENE_FRAMES[scene.pose]) scene = scene.then ? { pose: scene.then, t: 0 } : null;
    }
    if (!playing || level() < 0.02) showWord(now); // (words only in the quiet: paused, or between songs)
    else if (word && now > word.until) showWord(now);
    let lvl = 0;
    if (pose === 'playing' && !react && !still) {
      lvl = level();
      if (lvl > 0.85) { if (now - lastPeak < PEAK_EVERY) lvl = 0.8; else lastPeak = now; }
    }
    const eyes = now - movedAt < 3000 ? look : pose === 'paused' ? [0, 1, 0, -1][Math.floor(step / 3) % 4] : 0;
    const color = shown.light ? LCD_INK : colors.accent;
    const opts = {
      pose: still ? (pose === 'asleep' ? 'asleep' : 'paused') : pose, form: view.form, item: view.item, look: eyes, from: scene && scene.from,
      level: Math.round(lvl * 20) / 20, react: react && react.kind, reactMs: react ? Math.floor((now - react.at) / 120) * 120 : 0,
    };
    const key = `${still ? 0 : step}|${JSON.stringify(opts)}|${color}|${shown.light}|${devicePixelRatio}`;
    if (key === drawnKey) return;
    drawnKey = key;
    grid = frame(still ? 0 : (scene ? scene.t : step), opts);
    if (canvas.offsetParent) drawDots(canvas, grid, { lcd: shown.light, color, pitch: 2.6 });
  }

  /** A still picture of it, for its card. */
  function still(target, pitch = 4) {
    if (!view) return;
    drawDots(target, frame(0, { pose: 'paused', form: view.form, item: view.item }), { lcd: shown.light, color: shown.light ? LCD_INK : colors.accent, pitch });
  }

  return {
    setOn, setView, events, tick, still, react: reactTo,
    /** TERMINAL: it as 8 lines of half-blocks, or null while it's off. */
    rows: () => (on && view && grid ? termRows(grid) : null),
    get view() { return view; }, get on() { return on; },
    rename: (name) => pet.set({ name }).then(setView),
    choose: (form) => pet.set({ chosen: form }).then(setView),
    wear: (item) => pet.set({ worn: item }).then(setView),
    refresh: () => (on ? pet.get().then(setView) : Promise.resolve(null)),
  };
}
