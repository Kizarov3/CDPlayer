'use strict';
// Spleeter's two models for karaoke's word timing, into src/main/karaoke/models (not kept in git: 52 MB). A build needs
// them; the app without them falls back on cruder timing. Checked against their sums, so a build gets exactly these.
//   Spleeter 2 stems, int8 (Deezer's, MIT; as made into ONNX by sherpa-onnx, Apache-2.0)
// aligner.onnx beside them is in git: LyricsAlignment-Multilingual's baseline model (Jiawen Huang et al., MIT), as ONNX.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'src', 'main', 'karaoke', 'models');
const SPLEETER = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/sherpa-onnx-spleeter-2stems-int8.tar.bz2';
const SPLEETER_SUM = 'c5dc8edfa08cc9a6d82670fcca15cfe671e446385e1a28c9da8c1816d238ea17';
const SUMS = JSON.parse(fs.readFileSync(path.join(__dirname, 'karaoke-models.json'), 'utf8'));

const sumOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const good = (name) => { const file = path.join(DIR, name); return fs.existsSync(file) && sumOf(file) === SUMS[name]; };
async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  if (!good('vocals.int8.onnx') || !good('accompaniment.int8.onnx')) {
    // (unpacked apart, only once the archive is known to be this one, and only the two models taken from it)
    const apart = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-models-'));
    try {
      const archive = path.join(apart, 'spleeter.tar.bz2');
      await download(SPLEETER, archive);
      if (sumOf(archive) !== SPLEETER_SUM) throw new Error('the Spleeter archive is not the file expected');
      // (from its own folder: a Windows path's colon isn't for every tar)
      execFileSync('tar', ['xjf', 'spleeter.tar.bz2', '--strip-components=1'], { cwd: apart });
      for (const name of ['vocals.int8.onnx', 'accompaniment.int8.onnx']) {
        if (!fs.lstatSync(path.join(apart, name)).isFile()) throw new Error(`${name} is not a file`);
        fs.copyFileSync(path.join(apart, name), path.join(DIR, name));
      }
    } finally { fs.rmSync(apart, { recursive: true, force: true }); }
  }
  for (const name of Object.keys(SUMS)) if (!good(name)) throw new Error(`${name} is not the file expected`);
  console.log('karaoke models ready');
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
