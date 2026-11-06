'use strict';
// Lyrics put into Latin letters off the main thread: Japanese's dictionary takes a moment and a good deal of memory.
const { parentPort } = require('worker_threads');
const path = require('path');
const { romanizeLines } = require('./romanize');

let reader = null;
const tokenizer = () => reader || (reader = new Promise((resolve, reject) => {
  const kuromoji = require('kuromoji');
  kuromoji.builder({ dicPath: path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict') }).build((e, t) => (e ? reject(e) : resolve(t)));
}));
const pinyin = (run) => require('pinyin-pro').pinyin(run);
parentPort.on('message', async ({ id, texts }) => {
  try { parentPort.postMessage({ id, lines: await romanizeLines(texts, { tokenizer, pinyin }) }); }
  catch (e) { parentPort.postMessage({ id, error: String((e && e.message) || e) }); }
});
