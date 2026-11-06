'use strict';
// Times a song's words off the main thread: the models run here, in WebAssembly, so the app needs no native library for them.
const { parentPort, workerData } = require('worker_threads');
const path = require('path'), fs = require('fs');
const ort = require('onnxruntime-web');
const { fitWords, SPLEETER } = require('./fit-words');

const THREADS = Math.max(1, Math.min(4, (workerData && workerData.threads) || 4));
ort.env.wasm.numThreads = THREADS;
ort.env.logLevel = 'error';
const models = (workerData && workerData.modelsDir) || path.join(__dirname, 'models');
let sessions = null;
async function load() {
  if (sessions) return sessions;
  const open = (name) => ort.InferenceSession.create(fs.readFileSync(path.join(models, name)), { executionProviders: ['wasm'] });
  sessions = { vocals: await open('vocals.int8.onnx'), band: await open('accompaniment.int8.onnx'), aligner: await open('aligner.onnx') };
  return sessions;
}
const { bins, split } = SPLEETER;
async function voiceMask(mags) {
  const s = await load(), x = new Float32Array(2 * split * bins);
  x.set(mags[0], 0); x.set(mags[1], split * bins);
  const input = new ort.Tensor('float32', x, [2, 1, split, bins]);
  const v = (await s.vocals.run({ x: input })).y.data, a = (await s.band.run({ x: input })).y.data;
  const masks = [new Float32Array(split * bins), new Float32Array(split * bins)];
  for (let i = 0; i < x.length; i++) { const vv = v[i] * v[i], aa = a[i] * a[i]; masks[i < split * bins ? 0 : 1][i < split * bins ? i : i - split * bins] = (vv + 5e-11) / (vv + aa + 1e-10); }
  return masks;
}
async function phoneProbabilities(mel, T) {
  const s = await load(), out = (await s.aligner.run({ mel: new ort.Tensor('float32', mel, [1, 1, 128, T]) })).logits, [, frames, classes] = out.dims;
  // (log-probabilities, frame by frame)
  const data = new Float32Array(frames * classes);
  for (let t = 0; t < frames; t++) {
    let top = -Infinity, sum = 0;
    const row = t * classes;
    for (let c = 0; c < classes; c++) if (out.data[row + c] > top) top = out.data[row + c];
    for (let c = 0; c < classes; c++) sum += Math.exp(out.data[row + c] - top);
    const norm = top + Math.log(sum);
    for (let c = 0; c < classes; c++) data[row + c] = out.data[row + c] - norm;
  }
  return { data, frames, classes };
}
parentPort.on('message', async ({ id, left, right, lines }) => {
  try {
    const words = await fitWords({ left, right }, lines, { voiceMask, phoneProbabilities }, (progress) => parentPort.postMessage({ id, progress }));
    parentPort.postMessage({ id, words });
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.message) || e) });
  }
});
