'use strict';
// The models karaoke times its words with, into src/main/karaoke/models (not kept in git: 71 MB). The app works without
// them, with cruder timing. Checked against their sums, so a build gets exactly these.
//   Spleeter 2 stems, int8 (Deezer's, MIT; as made into ONNX by sherpa-onnx, Apache-2.0)
//   LyricsAlignment-Multilingual's baseline model (Jiawen Huang et al., MIT), made into ONNX by us
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'src', 'main', 'karaoke', 'models');
const SPLEETER = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/sherpa-onnx-spleeter-2stems-int8.tar.bz2';
const ALIGNER = process.env.KARAOKE_ALIGNER_URL || 'https://github.com/Kizarov3/CDPlayer/releases/download/karaoke-models-1/aligner.onnx';
const SUMS = JSON.parse(fs.readFileSync(path.join(__dirname, 'karaoke-models.json'), 'utf8'));

const good = (name) => { const file = path.join(DIR, name); return fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === SUMS[name]; };
async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  if (!good('vocals.int8.onnx') || !good('accompaniment.int8.onnx')) {
    const archive = path.join(DIR, 'spleeter.tar.bz2');
    await download(SPLEETER, archive);
    execFileSync('tar', ['xjf', archive, '-C', DIR, '--strip-components=1', '--include=*.onnx']);
    fs.rmSync(archive);
  }
  if (!good('aligner.onnx')) await download(ALIGNER, path.join(DIR, 'aligner.onnx'));
  for (const name of Object.keys(SUMS)) if (!good(name)) throw new Error(`${name} is not the file expected`);
  console.log('karaoke models ready');
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
