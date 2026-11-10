'use strict';
// `--theme-shots=<outdir> [--themes=RED,WHITE] [--audio=<folder>]`: screenshots of every look and screen in each theme,
// to put a theme's before and after side by side. The pure checks (darkCheck, diffShare) are here too; the capture run
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A test album outside the repo: copies of a fixture song with a painted cover.jpg beside them, so cover art, the disc's
// art and the cover glow show up.
function makeAlbum(nativeImage, from) {
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
  return { root: dir, album };
}

async function run({ win, miniWindow, outDir, themes, audio, nativeImage, store }) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const key = (keyCode) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); };
  const settle = async () => { await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await wait(300); };
  const written = [];
  let dir = outDir;
  const shot = async (name) => {
    await settle();
    const image = await win.webContents.capturePage();
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    written.push(file);
    return image;
  };
  // Click the first element matching `selector` (whose text is `text`, when given); false if there's none.
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
  const closeAll = async () => { for (let i = 0; i < 4; i++) { key('Escape'); await wait(150); } await wait(300); };
  const openSettings = async () => { await click('#settings-button'); await wait(500); };
  const pickMenu = async (rowLabel, item) => {
    await openSettings();
    await clickRowButton(rowLabel); await wait(300);
    const ok = await click('.theme-menu .theme-item', item.toUpperCase());
    await closeAll();
    return ok;
  };

  // Load the first song of the test album, so there's art, a disc and a glow.
  const first = audio && fs.readdirSync(audio).filter((f) => /\.(mp3|flac|m4a|ogg|wav)$/i.test(f)).sort()[0];
  if (first) {
    win.webContents.send('open-files', [path.join(audio, first)]);
    await wait(2500);
  }
  await settle();

  const results = [];
  for (const theme of themes) {
    dir = path.join(outDir, theme);
    // The theme: through the theme menu, as a person would. An unknown name has no item: skipped.
    await openSettings();
    await clickRowButton('THEME'); await wait(300);
    const known = await click('.theme-menu .theme-item', theme.toUpperCase());
    await closeAll();
    if (!known) { console.log(`theme-shots: no theme named ${theme}, skipped`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    await wait(500);
    if (!(await pickMenu('PLAYER LOOK', 'CLASSIC'))) console.log('theme-shots: could not pick CLASSIC');
    for (const look of LOOKS) {
      if (!(await pickMenu('PLAYER LOOK', LOOK_LABELS[look] || look))) { console.log(`theme-shots: no look ${look}`); continue; }
      await wait(600);
      const image = await shot(`look-${look.toLowerCase()}`);
      if (look === 'CLASSIC') {
        const { width, height } = image.getSize();
        const rgba = image.toBitmap();
        const grayPx = new Uint8Array(width * height);
        for (let i = 0; i < grayPx.length; i++) grayPx[i] = Math.round(0.299 * rgba[i * 4 + 2] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4]); // (BGRA)
        fs.writeFileSync(path.join(dir, 'darkcheck.json'), JSON.stringify(darkCheck(grayPx, width, height)) + '\n');
      }
    }
    await pickMenu('PLAYER LOOK', 'CLASSIC');
    await wait(600);

    const screen = async (name, open, { after = 700 } = {}) => {
      try { await open(); await wait(after); await shot(name); } catch (e) { console.log(`theme-shots: ${name} failed: ${e.message}`); }
      await closeAll();
    };
    // SHELF, and a case pulled out of it
    await click('#shelf-button'); await wait(2500);
    await shot('shelf');
    await click('#shelf-pull'); await wait(2500);
    await shot('shelf-case');
    await closeAll(); await click('#shelf-close'); await wait(600); await closeAll();
    await screen('history', () => click('#history-button'));
    await screen('settings', () => openSettings());
    await screen('cd-view', () => click('#cd-view-button'));
    await screen('eq', async () => { await openSettings(); await inSettings(pillText('EQ')); });
    if (await js("!!document.querySelector('#lyrics-button') && !document.querySelector('#lyrics-button').hidden")) await screen('lyrics', () => click('#lyrics-button'), { after: 1500 });
    else console.log('theme-shots: lyrics skipped (none found for the test song; needs the network)');
    await screen('karaoke', () => click('#karaoke-button'), { after: 1500 });
    await screen('tags', () => click('#tags-button'), { after: 1200 });
    await screen('theme-menu', async () => { await openSettings(); await clickRowButton('THEME'); });
    await screen('all-keys', () => js(`document.querySelector('#hint b').click()`));
    await screen('whats-new', async () => { await openSettings(); await inSettings(pillText("WHAT'S NEW")); }, { after: 900 });
    // (the art in the disc's corner: a click for the full-size art, another for the booklet — real mouse clicks, as the disc is a canvas)
    await screen('booklet', async () => {
      const r = await js(`(() => { const b = document.getElementById('disc').getBoundingClientRect(); return { left: b.left, top: b.top, w: b.width, h: b.height }; })()`);
      const cs = Math.min(r.w, r.h), at = [{ x: r.left + (r.w - cs) / 2 + 42, y: r.top + (r.h - cs) / 2 + 42 }, { x: r.left + r.w / 2, y: r.top + r.h / 2 }]; // (the corner art, then the full-size one)
      for (const p of at) {
        await js(`document.getElementById('disc').dispatchEvent(new MouseEvent('click', { clientX: ${p.x}, clientY: ${p.y}, bubbles: true }))`);
        await wait(1800);
      }
    }, { after: 1500 });
    // Mini mode: the main window's capture still shows the player; the mini window is its own.
    key('m'); await wait(2000);
    const mini = miniWindow && miniWindow();
    if (mini && !mini.isDestroyed()) {
      await wait(500);
      const image = await mini.webContents.capturePage();
      const file = path.join(dir, 'mini.png');
      fs.writeFileSync(file, image.toPNG());
      written.push(file);
    } else console.log('theme-shots: mini mode did not open');
    key('m'); await wait(1500);
    results.push(theme);
  }
  return { written, results };
}

module.exports = { darkCheck, diffShare, makeAlbum, run, LOOKS };
