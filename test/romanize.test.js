'use strict';
const test = require('node:test'), assert = require('node:assert'), path = require('path');
const { romanizeLines, korean, kanaToLatin, cyrillic } = require('../src/main/karaoke/romanize');
const { createRomanize } = require('../src/main/romanize');
const { EventEmitter } = require('events');

let reader = null;
const tokenizer = () => reader || (reader = new Promise((resolve, reject) => {
  require('kuromoji').builder({ dicPath: path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict') }).build((e, t) => (e ? reject(e) : resolve(t)));
}));
const roman = (lines) => romanizeLines(lines, { tokenizer });

test('Japanese: read by its dictionary, particles as they sound, a little tsu across words', async () => {
  assert.deepStrictEqual(await roman(['君の名前は、なんですか', '世界は美しい', 'ずっと一緒にいたかった', 'コーヒーを飲みました', 'Hello 君へ', 'ちょっと待って']), [
    'kimi no namae wa, nandesu ka', 'sekai wa utsukushii', 'zutto issho ni itakatta', 'koohii o nomimashita', 'Hello kimi e', 'chotto matte',
  ]);
  assert.strictEqual(kanaToLatin('マッチャ'), 'matcha');
});
test('Chinese: pinyin, its own Latin kept; a Han song is not taken for Japanese', async () => {
  assert.deepStrictEqual(await roman(['我爱你，中国', 'I love 你']), ['wǒ ài nǐ, zhōng guó', 'I love nǐ']);
});
test('Korean: the sounds join across syllables', () => {
  assert.deepStrictEqual(['안녕하세요', '감사합니다', '사랑해', '좋아', '없어', '독립', '신라', '같이'].map(korean), ['annyeonghaseyo', 'gamsahamnida', 'saranghae', 'joa', 'eopseo', 'dongnip', 'silla', 'gachi']);
});
test('Cyrillic, with its capitals; lines already Latin come back null', async () => {
  assert.strictEqual(cyrillic('ЩУКА'), 'SHCHUKA');
  assert.strictEqual(cyrillic('Юля'), 'Yulya');
  assert.deepStrictEqual(await roman(['Привет, мир', 'Hello world', '']), ['Privet, mir', null, null]);
});
test("the dictionary is only opened for a Japanese song", async () => {
  let opened = 0;
  await romanizeLines(['Привет', '안녕', '我爱你'], { tokenizer: () => { opened++; return tokenizer(); } });
  assert.strictEqual(opened, 0);
});
test('the worker goes away when idle and comes back when asked', async () => {
  const made = [];
  const createWorker = () => { const w = new EventEmitter(); w.terminate = () => { w.gone = true; }; w.postMessage = ({ id, texts }) => setImmediate(() => w.emit('message', { id, lines: texts })); made.push(w); return w; };
  const r = createRomanize({ createWorker, idleMs: 1 });
  assert.deepStrictEqual(await r.lines(['a']), ['a']);
  await new Promise((ok) => setTimeout(ok, 15));
  assert.strictEqual(made[0].gone, true);
  assert.deepStrictEqual(await r.lines(['b']), ['b']);
  assert.strictEqual(made.length, 2);
});

test('Japanese: other letters left as they are, words not run into の, set phrases, half-width kana, 〇', async () => {
  assert.deepStrictEqual(await roman(["I don't know 君のこと", 'あなたのため', '夢の中', 'こんにちは世界', 'ﾊﾛｰ']), ["I don't know kimi no koto", 'anata no tame', 'yume no naka', 'konnichiwa sekai', 'haroo']);
  assert.doesNotMatch((await roman(['二〇二〇年です']))[0], /〇/);
});
test('Chinese: traditional reads as well as simplified; a stray の or ・ does not make it Japanese', async () => {
  assert.deepStrictEqual(await roman(['還有', '長大', '時間', '我們']), ['hái yǒu', 'zhǎng dà', 'shí jiān', 'wǒ men']);
  assert.deepStrictEqual(await roman(['今天天气很好', '约翰・列侬']), ['jīn tiān tiān qì hěn hǎo', 'yuē hàn liè nóng']);
  assert.match((await roman(['今天天气很好的の世界的の风景的の很好很好很好很好很好']))[0], /^jīn tiān/);
  assert.deepStrictEqual(await roman(['《东风破》']), ['dōng fēng pò']);
  // (and a Japanese lyric with little kana is still that)
  assert.deepStrictEqual(await roman(['一人で歩く', '東京']), ['hitori de aruku', 'toukyou']);
});
test('Korean: ㅎ and the stops, as they sound', () => {
  assert.deepStrictEqual(['많다', '않고', '잃다', '좋습니다', '못해', '행복해', '닫혀'].map(korean), ['manta', 'anko', 'ilta', 'joseumnida', 'motae', 'haengbokae', 'dachyeo']);
});
test('Cyrillic: Ukrainian and Bulgarian by their own letters, stress marks off', async () => {
  assert.deepStrictEqual(await roman(['Україна гарна']), ['Ukrayina harna']);
  assert.deepStrictEqual(await roman(['България']), ['Balgariya']);
  assert.deepStrictEqual(await roman(['за́мок']), ['zamok']);
});
