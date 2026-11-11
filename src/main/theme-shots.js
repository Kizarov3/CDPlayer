'use strict';
// `--theme-shots=<outdir> [--themes=RED,WHITE] [--audio=<folder>]`: screenshots of every look and screen in each theme,
// and `--theme-compare=<before>,<after>` to diff two such runs, screen by screen — to put a theme's before and after side by side. The pure checks (darkCheck, diffShare) are here too; the capture run
// drives the real buttons of a hidden window, in a throwaway data folder (set up in main.js, like --smoke-test).
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOOKS = ['CLASSIC', 'VISUALIZER', 'LYRICS', 'HIFI', 'ALBUM', 'CASE', 'TERMINAL'];
const LOOK_LABELS = { HIFI: 'HI-FI', CASE: 'JEWEL CASE' };

/** The AppImage catalog's rule on a grey picture (<= 200 px wide after shrinking): dark when 60 % of it is below 35 % grey and the mean is below 0.35. */
function darkCheck(gray, w, h) {
  const step = Math.max(1, Math.ceil(w / 200));
  const ow = Math.ceil(w / step), oh = Math.ceil(h / step);
  let dark = 0, sum = 0;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let total = 0, n = 0;
      for (let yy = y * step; yy < Math.min(h, (y + 1) * step); yy++) {
        for (let xx = x * step; xx < Math.min(w, (x + 1) * step); xx++) { total += gray[yy * w + xx]; n++; }
      }
      const v = total / n;
      if (v < 0.35 * 255) dark++;
      sum += v / 255;
    }
  }
  const count = ow * oh;
  const darkShare = dark / count, mean = sum / count;
  return { dark: darkShare >= 0.60 && mean < 0.35, darkShare, mean };
}

/** The share of pixels whose RGBA differ by more than 8 in any channel. */
function diffShare(a, b) {
  const pixels = Math.floor(Math.min(a.length, b.length) / 4);
  if (!pixels) return 0;
  let differ = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    if (Math.abs(a[o] - b[o]) > 8 || Math.abs(a[o + 1] - b[o + 1]) > 8 || Math.abs(a[o + 2] - b[o + 2]) > 8 || Math.abs(a[o + 3] - b[o + 3]) > 8) differ++;
  }
  return differ / pixels;
}

// `--theme-compare=<before>,<after>`: each picture in <before> against the one of the same name in <after> — two
// --theme-shots folders (their theme folders matched by name) or two theme folders. One line a screen, its diffShare;
// `bad` lists the ones above `limit` (a missing or differently sized picture counts as all different).
function compare(beforeDir, afterDir, nativeImage, limit = 0.001) {
  const pngs = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort();
  const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
  const pairs = [];
  if (pngs(beforeDir).length) pairs.push(['', beforeDir, afterDir]);
  for (const sub of fs.readdirSync(beforeDir).sort()) {
    const b = path.join(beforeDir, sub);
    if (isDir(b) && pngs(b).length) pairs.push([sub + '/', b, path.join(afterDir, sub)]);
  }
  const lines = [], bad = [];
  for (const [prefix, b, a] of pairs) {
    for (const f of pngs(b)) {
      const name = prefix + f.slice(0, -4);
      let share = 1;
      const other = path.join(a, f);
      if (fs.existsSync(other)) {
        const x = nativeImage.createFromPath(path.join(b, f)), y = nativeImage.createFromPath(other);
        const sx = x.getSize(), sy = y.getSize();
        if (sx.width === sy.width && sx.height === sy.height) share = diffShare(x.toBitmap(), y.toBitmap());
      }
      if (share > limit) bad.push(name);
      lines.push(`${share > limit ? 'DIFF' : 'same'} ${share.toFixed(6)} ${name}${fs.existsSync(other) ? '' : ' (missing in after)'}`);
    }
  }
  return { lines, bad };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A test album outside the repo: copies of a fixture song with a painted cover.jpg beside them, so cover art, the disc's
// art and the cover glow show up.
async function makeAlbum(nativeImage, from) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-shots-album-'));
  const album = path.join(dir, 'Shots Artist', 'Shots Album');
  fs.mkdirSync(album, { recursive: true });
  for (let i = 1; i <= 3; i++) fs.copyFileSync(from, path.join(album, `0${i} Song ${i}.mp3`));
  const size = 600, bmp = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4, ring = Math.hypot(x - 300, y - 300);
      const inner = ring < 150;
      bmp[o] = inner ? 60 : 40 + (x * 150) / size;      // B
      bmp[o + 1] = inner ? 200 : 80 + (y * 120) / size; // G
      bmp[o + 2] = inner ? 240 : 200 - (x * 100) / size; // R
      bmp[o + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(album, 'cover.jpg'), nativeImage.createFromBitmap(bmp, { width: size, height: size }).toJPEG(92));
  // Lyrics in the first song's tags (synced, as an LRC), so LYRICS and KARAOKE open without the network.
  const lrc = ['[00:00.00]First line of the test song', '[00:01.00]Second line goes on a little longer', '[00:02.00]Third line of the words', '[00:03.00]And the last one to finish'].join('\n');
  const written = await require('./tag-writer').writeTags(path.join(album, '01 Song 1.mp3'), { lyrics: lrc });
  if (!written.ok) console.log(`theme-shots: no lyrics written into the test song (${written.error})`);
  return { root: dir, album };
}


// The page's clock and frames made ours, from before any of its scripts run (this mode only): performance.now() is a
// virtual time that moves 1/60 s per frame, and requestAnimationFrame callbacks run only when `__frames(n)` is called —
// so the disc's angle, the waveform and every easing depend on how many frames were stepped, not on how long anything
// took. CSS animations and transitions are stilled too. The song itself plays in real time, though: where the disc
// came to rest and where the seek bar's last tick left its knob differed from run to run. So every Disc and Slider
// made on the page puts itself in `__shots` (disc.js, widgets.js), for `still()` to pin before each shot.
const PIN = `(() => {
  let now = 1000, id = 0, queue = [];
  window.__shots = { discs: [], sliders: [] };
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { queue.push([++id, cb]); return id; };
  window.cancelAnimationFrame = (i) => { queue = queue.filter((q) => q[0] !== i); };
  window.__frames = (n) => { for (let k = 0; k < n; k++) { now += 1000 / 60; const run = queue; queue = []; for (const [, cb] of run) { try { cb(now); } catch (e) { console.error(e); } } } };
  document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }'; document.head.append(st); });
})();`;
async function pinTime(win) {
  const dbg = win.webContents.debugger;
  await win.loadURL('about:blank'); // (a page for the debugger to talk to)
  dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PIN });
}

async function run({ win, miniWindow, outDir, themes, audio, nativeImage, store, phoneRemote }) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const key = (keyCode) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); };
  // Time passes by stepping frames (3 per 30 ms of real waiting, so what needs real time — files, images — gets some).
  const pause = async (ms) => { for (let i = 0; i < Math.ceil(ms / 50); i++) { await js('window.__frames(3)'); await wait(30); } };
  const waitFor = async (cond, ms = 8000) => { for (let i = 0; i < Math.ceil(ms / 50); i++) { if (await js(`!!(${cond})`)) return true; await pause(50); } return false; };
  const written = [];
  let dir = outDir, screens = {};
  const save = (name, image) => { const file = path.join(dir, `${name}.png`); fs.writeFileSync(file, image.toPNG()); written.push(file); };
  // A resting disc turned to 0, and the seek bar's knob where the song is (played out: at its end), as its own
  // ticks would have left it had one come after the song ended.
  const still = () => js(`(() => { const s = window.__shots; if (!s) return;
    for (const d of s.discs) if (!d.speed && !d.spinning) d.angle = 0;
    for (const b of s.sliders) if (b.waveformCapable) b.setValue(b.max); })()`);
  const shot = async (name) => {
    await still();
    await pause(400);
    await wait(150); // (the frame drawn reaches the screen)
    const image = await win.webContents.capturePage();
    save(name, image);
    return image;
  };
  const failures = [];
  const note = (name, ok) => { screens[name] = ok ? 'ok' : 'failed'; if (!ok) { failures.push(name); console.log(`theme-shots: ${name}: the screen did not open, its picture is of something else`); } };
  const click = (selector, text) => js(`(() => {
    const want = ${JSON.stringify(text || null)};
    const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => !want || n.textContent.trim().toUpperCase() === want);
    if (!e) return false; e.click(); return true; })()`);
  // In the open Settings: go through its tabs to the one that has a row (or a pill) and click its button.
  const inSettings = (find) => js(`(async () => {
    const tabs = [...document.querySelectorAll('.settings-tab')];
    for (const tab of tabs) {
      tab.click(); await new Promise((r) => setTimeout(r, 120));
      const b = (${find})();
      if (b) { b.click(); return true; }
    }
    return false; })()`);
  const rowButton = (label) => `() => { const r = [...document.querySelectorAll('.setting-row')].find((r) => r.firstElementChild && r.firstElementChild.textContent.trim().toUpperCase() === ${JSON.stringify(label)}); return r ? r.querySelector('button') : null; }`;
  const pillText = (text) => `() => [...document.querySelectorAll('.settings-page button')].find((n) => n.textContent.trim().toUpperCase() === ${JSON.stringify(text)})`;
  const clickRowButton = (label) => inSettings(rowButton(label));
  const cardHas = (sel) => `[...document.querySelectorAll('.overlay:not(.closing) .card')].some((c) => c.querySelector(${JSON.stringify(sel)}))`;
  const nothingOpen = `!document.querySelector('.overlay, .theme-menu-layer, .booklet-layer') && document.getElementById('shelf').hidden && document.getElementById('karaoke').hidden`;
  const closeAll = async () => { for (let i = 0; i < 5; i++) { key('Escape'); await pause(200); } await waitFor(nothingOpen, 2000); await pause(300); };
  const openSettings = async () => { await click('#settings-button'); await waitFor(cardHas('.settings-tab'), 3000); await pause(200); };
  const pickMenu = async (rowLabel, item) => {
    await openSettings();
    await clickRowButton(rowLabel); await waitFor(`document.querySelector('.theme-menu .theme-item')`, 3000);
    const ok = await click('.theme-menu .theme-item', item.toUpperCase());
    await closeAll();
    return ok;
  };

  await pause(1500); // (the page finishes starting)
  // Load the first song of the test album, so there's art, a disc and a glow.
  const first = audio && fs.readdirSync(audio).filter((f) => /\.(mp3|flac|m4a|ogg|wav)$/i.test(f)).sort()[0];
  if (first) {
    win.webContents.send('open-files', [path.join(audio, first)]);
    if (!(await waitFor(`document.getElementById('track-title').textContent !== 'Pick a track to get started.'`, 15000))) console.log('theme-shots: the test song did not load');
    await pause(4000); // (the disc comes to rest)
    await waitFor(`!document.getElementById('lyrics-button').hidden`, 3000);
  }

  // The phone remote: its page in a hidden phone-sized window, paired as a phone would be, kept open through every theme
  // from before the first one's pictures — so the desktop is the same in all (a server on, a phone connected).
  let phone = null, pjs = null, pshot = null;
  if (phoneRemote) {
    const { BrowserWindow } = require('electron');
    phone = new BrowserWindow({ show: false, width: 390, height: 780, useContentSize: true, focusable: false, webPreferences: { backgroundThrottling: false } });
    pjs = (code) => phone.webContents.executeJavaScript(code);
    const ppause = async (ms) => { for (let i = 0; i < Math.ceil(ms / 50); i++) { await pjs('window.__frames(3)'); await wait(30); } };
    try {
      await pinTime(phone);
      await phone.loadURL(await phoneRemote());
      await pause(1500);
    } catch (e) { console.log(`theme-shots: the phone remote did not open: ${e.message}`); phone.destroy(); phone = null; }
    pshot = async (name, tab) => {
      let ok = false;
      for (let i = 0; i < 160 && !ok; i++) { ok = await pjs(`!document.body.classList.contains('waiting') && !!document.querySelector('#title').textContent`); if (!ok) await ppause(50); }
      ok = ok && await pjs(`(() => { const b = document.querySelector('#tabs [data-tab="${tab}"]'); if (!b) return false; b.click(); return true; })()`);
      await ppause(tab === 'shelf' ? 2500 : 1000);
      await pjs(`(() => { const s = window.__shots; if (!s) return; for (const d of s.discs) if (!d.speed && !d.spinning) d.angle = 0; })()`);
      await ppause(400); await wait(150);
      save(name, await phone.webContents.capturePage());
      note(name, ok);
    };
  }

  const results = [];
  for (const theme of themes) {
    dir = path.join(outDir, theme);
    screens = {}; failures.length = 0;
    // The theme: through the theme menu, as a person would. An unknown name has no item: skipped.
    await openSettings();
    await clickRowButton('THEME'); await waitFor(`document.querySelector('.theme-menu .theme-item')`, 3000);
    const known = await click('.theme-menu .theme-item', theme.toUpperCase());
    await closeAll();
    if (!known) { console.log(`theme-shots: no theme named ${theme}, skipped`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    await pause(800);
    if (!(await pickMenu('PLAYER LOOK', 'CLASSIC'))) console.log('theme-shots: could not pick CLASSIC');
    for (const look of LOOKS) {
      const name = `look-${look.toLowerCase()}`;
      const picked = await pickMenu('PLAYER LOOK', LOOK_LABELS[look] || look);
      const there = picked && await waitFor(`document.body.classList.contains('look-${look.toLowerCase()}')`, 4000);
      await pause(800);
      const image = await shot(name);
      note(name, there);
      if (look === 'CLASSIC' && there) {
        const { width, height } = image.getSize();
        const rgba = image.toBitmap();
        const grayPx = new Uint8Array(width * height);
        for (let i = 0; i < grayPx.length; i++) grayPx[i] = Math.round(0.299 * rgba[i * 4 + 2] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4]); // (BGRA)
        fs.writeFileSync(path.join(dir, 'darkcheck.json'), JSON.stringify(darkCheck(grayPx, width, height)) + '\n');
      }
      // Its NOW PLAYING card (P): the panel with the song's first line picked, and the card itself at full size.
      const cardName = `card-${look.toLowerCase()}`;
      let cardOk = false;
      try {
        key('p');
        const preview = `(() => { const i = document.querySelector('.overlay:not(.closing) .card-preview.tall'); return !!i && i.complete && i.naturalWidth > 0; })()`;
        cardOk = there && await waitFor(preview, 8000);
        if (cardOk) {
          // (the line being sung is picked as it opens, the first at the song's start; the second added for a quote of two)
          await js(`(() => { const r = document.querySelectorAll('.overlay:not(.closing) .card-line:not(.none)')[1]; if (r && !r.classList.contains('on')) r.click(); })()`);
          await pause(1500);
          cardOk = await waitFor(preview, 8000);
          await shot(cardName);
          const b64 = await js(`(async () => { const i = document.querySelector('.overlay:not(.closing) .card-preview.tall'); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/png').split(',')[1]; })()`); // (the page's CSP keeps fetch() off its blob: URLs)
          fs.writeFileSync(path.join(dir, `${cardName}-full.png`), Buffer.from(b64, 'base64'));
        }
      } catch (e) { console.log(`theme-shots: ${cardName} failed: ${e.message}`); cardOk = false; }
      note(cardName, cardOk);
      await closeAll();
    }
    await pickMenu('PLAYER LOOK', 'CLASSIC');
    await pause(800);

    // A screen: opened, waited for (`expect`, an expression true once it's there), pictured, put away.
    const screen = async (name, open, expect, { after = 500 } = {}) => {
      let ok = false;
      try { await open(); ok = await waitFor(expect, 8000); await pause(after); await shot(name); } catch (e) { console.log(`theme-shots: ${name} failed: ${e.message}`); }
      note(name, ok);
      await closeAll();
    };
    // SHELF, and a case pulled out of it
    await click('#shelf-button');
    const shelfOk = await waitFor(`!document.getElementById('shelf').hidden && document.querySelector('#shelf-body .spine')`, 8000);
    await pause(1500); await shot('shelf'); note('shelf', shelfOk);
    await click('#shelf-pull');
    const caseOk = await waitFor(`document.querySelector('#shelf .case-track')`, 8000);
    await pause(1500); await shot('shelf-case'); note('shelf-case', caseOk);
    await closeAll(); await click('#shelf-close'); await waitFor(nothingOpen, 3000); await pause(600); await closeAll();
    await screen('history', () => click('#history-button'), `[...document.querySelectorAll('.overlay:not(.closing) .card')].some((c) => /HISTORY/i.test(c.textContent) && /NOTHING PLAYED|\\d/i.test(c.textContent))`);
    await screen('settings', () => openSettings(), cardHas('.settings-tab'));
    await screen('cd-view', () => click('#cd-view-button'), `document.body.classList.contains('cd-view')`, { after: 1500 });
    await screen('eq', async () => { await openSettings(); await inSettings(pillText('EQ')); }, cardHas('.db'));
    await screen('lyrics', () => click('#lyrics-button'), `[...document.querySelectorAll('.overlay:not(.closing) .card')].some((c) => c.textContent.includes('First line'))`, { after: 1000 });
    await screen('karaoke', () => click('#karaoke-button'), `!document.getElementById('karaoke').hidden`, { after: 1500 });
    await screen('tags', () => click('#tags-button'), `[...document.querySelectorAll('.overlay:not(.closing) .card')].some((c) => c.querySelector('input'))`, { after: 1000 });
    await screen('theme-menu', async () => { await openSettings(); await clickRowButton('THEME'); }, `document.querySelector('.theme-menu .theme-item')`);
    await screen('all-keys', () => js(`document.querySelector('#hint b').click()`), cardHas('.shortcut-list'));
    await screen('whats-new', async () => { await openSettings(); await inSettings(pillText("WHAT'S NEW")); }, cardHas('.changelog-list'));
    // (the art in the disc's corner: a click for the full-size art, another for the booklet — as the disc is a canvas)
    await screen('booklet', async () => {
      const r = await js(`(() => { const b = document.getElementById('disc').getBoundingClientRect(); return { left: b.left, top: b.top, w: b.width, h: b.height }; })()`);
      const cs = Math.min(r.w, r.h), at = [{ x: r.left + (r.w - cs) / 2 + 42, y: r.top + (r.h - cs) / 2 + 42 }, { x: r.left + r.w / 2, y: r.top + r.h / 2 }]; // (the corner art, then the full-size one)
      for (const p of at) {
        await js(`document.getElementById('disc').dispatchEvent(new MouseEvent('click', { clientX: ${p.x}, clientY: ${p.y}, bubbles: true }))`);
        await pause(1800);
      }
    }, `document.querySelector('.booklet-layer') && document.querySelector('.booklet-layer').textContent.includes('First line')`, { after: 1000 });
    if (phone) {
      try {
        await pshot('remote-playing', 'playing');
        await pshot('remote-shelf', 'shelf');
        await pshot('remote-queue', 'third');
        await pjs(`document.querySelector('#tabs [data-tab="playing"]').click()`);
      } catch (e) { console.log(`theme-shots: the phone remote failed: ${e.message}`); note('remote-playing', false); }
    }
    // Mini mode: the mini window is its own window, pictured by itself.
    key('m');
    let mini = null;
    for (let i = 0; i < 60 && !(mini && !mini.isDestroyed() && mini.isVisible() && !mini.webContents.isLoading()); i++) { await pause(100); mini = miniWindow && miniWindow(); }
    if (mini && !mini.isDestroyed()) {
      await pause(1500); await wait(300);
      save('mini', await mini.webContents.capturePage());
      note('mini', true);
    } else note('mini', false);
    key('m'); await pause(1500);
    fs.writeFileSync(path.join(dir, 'screens.json'), JSON.stringify(screens, null, 1) + '\n');
    results.push({ theme, failed: failures.slice() });
  }
  if (phone && !phone.isDestroyed()) phone.destroy();
  return { written, results };
}

module.exports = { compare, darkCheck, diffShare, makeAlbum, pinTime, run, LOOKS };
