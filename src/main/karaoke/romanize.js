'use strict';
// Lyrics in Latin letters, line by line: Japanese (read by kuromoji's dictionary), Chinese (pinyin-pro), Korean and
// Cyrillic (by rule). What's already Latin stays as it is; a line with nothing to change comes back null.
const HAN_LETTERS = '\\u3005\\u3007\\u3400-\\u9FFF\\uF900-\\uFAFF';
const HAN_RUN = new RegExp(`[${HAN_LETTERS}]+`, 'g'), HANS = new RegExp(`[${HAN_LETTERS}]`, 'g');
const KANA_RUN = /[぀-ヿ]+/g, SOUNDING_KANA = /[぀-ヺヽ-ヿ]/g; // (not ・ or ー, which Chinese uses too)
const JAPANESE_RUN = new RegExp(`[\\u3040-\\u30FF${HAN_LETTERS}]+`, 'g');
const HANGUL_RUN = /[가-힣]+/g, CYRILLIC_RUN = /[Ѐ-ӿ]+/g, JAMO_RUN = /[ㄱ-ㆎ]+/g;
const NEEDS = /[々〇぀-ヿ㐀-鿿豈-﫿가-힣Ѐ-ӿㄱ-ㆎｦ-ﾟ]/;
const PUNCTUATION = { '、': ', ', '。': '. ', '，': ', ', '．': '. ', '！': '! ', '？': '? ', '：': ': ', '；': '; ', '（': '(', '）': ')', '「': ' ', '」': ' ', '『': ' ', '』': ' ', '《': ' ', '》': ' ', '〈': ' ', '〉': ' ', '～': '~', '〜': '~', '…': '…', '・': ' ', '　': ' ' };
const PUNCTUATION_RUN = /[、。，．！？：；（）「」『』《》〈〉～〜・　]/g;
const tidy = (s) => s.replace(PUNCTUATION_RUN, (c) => PUNCTUATION[c]).replace(/\s+/g, ' ').replace(/\s+([,.!?:;)])/g, '$1').replace(/\(\s+/g, '(').replace(/ッ/g, '').trim();

// — Cyrillic —
const CYRILLIC = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'w' };
const UKRAINIAN = { ...CYRILLIC, г: 'h', и: 'y' }, BULGARIAN = { ...CYRILLIC, ъ: 'a', щ: 'sht', х: 'h' };
function alphabetOf(all) {
  if (/[іїєґ]/i.test(all) && !/[ыэў]/i.test(all)) return UKRAINIAN;
  return /ъ/i.test(all) && !/[ыэё]/i.test(all) ? BULGARIAN : CYRILLIC;
}
function cyrillic(word, alphabet = CYRILLIC) {
  const shouting = word.length > 1 && word === word.toUpperCase();
  const out = Array.from(word, (c) => {
    const low = c.toLowerCase(), latin = alphabet[low] ?? c;
    return c === low ? latin : latin.charAt(0).toUpperCase() + latin.slice(1);
  }).join('');
  return shouting ? out.toUpperCase() : out;
}

// — Korean: Revised Romanization, with how the sounds join across syllables —
const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const CODA = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// A final before a syllable with no consonant of its own: what's left of it, and what moves over.
const MOVES = ['', 'g', 'kk', 'k|s', 'n', 'n|j', 'n', 'd', 'r', 'l|g', 'l|m', 'l|b', 'l|s', 'l|t', 'l|p', 'r', 'm', 'b', 'p|s', 's', 'ss', 'ng|', 'j', 'ch', 'k', 't', 'p', ''];
const LEFT_BY_HIEUT = { 27: '', 6: 'n', 15: 'l' }, ROUGHER = { g: 'k', d: 't', b: 'p', j: 'ch' }; // (ㅎ, ㄶ, ㅀ)
const JAMO = { ㅋ: 'k', ㅎ: 'h', ㅠ: 'yu', ㅜ: 'u', ㄷ: 'd', ㅇ: 'o', ㄱ: 'g', ㅅ: 's' };
function korean(run) {
  const syllables = Array.from(run, (c) => { const n = c.codePointAt(0) - 0xAC00; return { first: INITIAL[Math.floor(n / 588)], vowel: VOWEL[Math.floor((n % 588) / 28)], last: n % 28, end: CODA[n % 28] }; });
  syllables.forEach((s, i) => {
    const next = syllables[i + 1];
    if (!next || !s.last) return;
    if (next.first === '') {
      const [stays, moved] = MOVES[s.last].includes('|') ? MOVES[s.last].split('|') : ['', MOVES[s.last]];
      s.end = stays; next.first = next.vowel === 'i' && moved === 'd' ? 'j' : next.vowel === 'i' && moved === 't' ? 'ch' : moved; // (같이: gachi)
    } else if (s.last in LEFT_BY_HIEUT && (ROUGHER[next.first] || next.first === 's')) { s.end = LEFT_BY_HIEUT[s.last]; next.first = ROUGHER[next.first] || 's'; }
    else if (next.first === 'h' && ['k', 't', 'p'].includes(s.end)) { next.first = s.end === 't' && /^[iy]/.test(next.vowel) ? 'ch' : s.end; s.end = ''; } // (못해, 행복해, 닫혀)
    else if (next.first === 'n' || next.first === 'm') {
      if (s.end === 'k') s.end = 'ng'; else if (s.end === 't') s.end = 'n'; else if (s.end === 'p') s.end = 'm'; else if (s.end === 'l' && next.first === 'n') next.first = 'l';
    } else if (next.first === 'r') {
      if (s.end === 'n' || s.end === 'l') { s.end = 'l'; next.first = 'l'; } else {
        next.first = 'n';
        if (s.end === 'k') s.end = 'ng'; else if (s.end === 't') s.end = 'n'; else if (s.end === 'p') s.end = 'm';
      }
    }
  });
  return syllables.map((s) => s.first + s.vowel + s.end).join('');
}

// — Japanese —
const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const KANA_SOUNDS = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o', カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko', サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so', タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to', ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no', ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho', マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo', ヤ: 'ya', ユ: 'yu', ヨ: 'yo', ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヰ: 'i', ヱ: 'e', ヲ: 'o', ン: 'n',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo', ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do', バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo', パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po', ヴ: 'vu',
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o', ャ: 'ya', ュ: 'yu', ョ: 'yo', ヮ: 'wa',
};
const PAIRS = { キ: 'ky', ギ: 'gy', シ: 'sh', ジ: 'j', チ: 'ch', ヂ: 'j', ニ: 'ny', ヒ: 'hy', ビ: 'by', ピ: 'py', ミ: 'my', リ: 'ry' };
const SMALL_Y = { ャ: 'a', ュ: 'u', ョ: 'o' };
const FOREIGN = { ティ: 'ti', ディ: 'di', トゥ: 'tu', ドゥ: 'du', ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', ウィ: 'wi', ウェ: 'we', ウォ: 'wo', シェ: 'she', ジェ: 'je', チェ: 'che', ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo' };
const doubling = (sound) => (sound.startsWith('ch') ? 't' : /^[aiueon]/.test(sound) ? '' : sound[0]);
function kanaToLatin(text) {
  const s = toKatakana(text);
  let out = '', double = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], two = s.slice(i, i + 2);
    if (c === 'ッ') { double = true; continue; }
    if (c === 'ー') { const v = /[aiueo](?=[^aiueo]*$)/.exec(out); if (v) out += v[0]; continue; }
    let sound;
    if (FOREIGN[two]) { sound = FOREIGN[two]; i++; }
    else if (PAIRS[c] && SMALL_Y[s[i + 1]]) { sound = PAIRS[c] + SMALL_Y[s[i + 1]]; i++; }
    else sound = KANA_SOUNDS[c];
    if (sound === undefined) { out += c; double = false; continue; }
    if (double) { out += doubling(sound); double = false; }
    out += sound;
  }
  return double ? `${out}ッ` : out; // (a word that ends on its way into the next: 待っ|て)
}
// Words that belong to the one before them, as they're written in rōmaji: tabe-mashita, not tabe mashita.
const SAID_OTHERWISE = { こんにちは: 'konnichiwa', こんばんは: 'konbanwa' };
const joins = (t) => t.pos === '助動詞' || t.pos_detail_1 === '接尾' || (t.pos_detail_1 === '非自立' && t.pos !== '名詞') || t.surface_form === 'ん' || (t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && /^[てで]$/.test(t.surface_form));
function japaneseRun(run, tokenizer) {
  let out = '', said = '';
  for (const t of tokenizer.tokenize(run.replace(/一人/g, 'ひとり').replace(/二人/g, 'ふたり').replace(/([あこそ]の)娘/g, '$1こ'))) { // (as they're sung: the dictionary has ichinin, ano musume)
    const word = t.surface_form;
    if (word === '々') { out += said; continue; } // (a repeat the dictionary left on its own, as a symbol)
    if (t.pos === '記号') { out += word; continue; }
    let latin;
    if (SAID_OTHERWISE[word]) latin = SAID_OTHERWISE[word];
    else if (t.pos === '助詞' && word === 'は') latin = 'wa';
    else if (t.pos === '助詞' && word === 'へ') latin = 'e';
    else latin = kanaToLatin(t.reading && t.reading !== '*' ? t.reading : word);
    said = latin;
    if (out.endsWith('ッ')) out = out.slice(0, -1) + doubling(latin) + latin;
    else out += (out && !/\s$/.test(out) && !joins(t) ? ' ' : '') + latin;
  }
  return out;
}
// (only the Japanese is read: what's in other letters, "I don't know", stays exactly as it's written)
const japanese = (text, tokenizer) => text.replace(JAPANESE_RUN, (run) => ` ${japaneseRun(run, tokenizer)} `);

/** Whether a song with these lines is Japanese rather than Chinese: kana a real part of its writing, not a stray の. */
function isJapanese(all) {
  const kana = (all.match(SOUNDING_KANA) || []).length, han = (all.match(HANS) || []).length;
  return han ? kana >= 2 && kana / (kana + han) >= 0.15 : kana > 0;
}
let chinese = null;
function pinyinOf(run) {
  if (!chinese) { const { pinyin } = require('pinyin-pro'), simple = require('opencc-js/t2cn').Converter({ from: 'tw', to: 'cn' }); chinese = (text) => pinyin(simple(text)); } // (it reads simplified characters better: 還有, 時間)
  return chinese(run);
}
// Full-width letters and half-width kana as they ordinarily are; a stress mark off a Cyrillic vowel.
const plainForms = (text) => text.replace(/[０-９Ａ-Ｚａ-ｚｦ-ﾟ]+/g, (run) => run.normalize('NFKC')).replace(/([Ѐ-ӿ])́/g, '$1');
/** `texts`: the song's lines. `tokenizer()`: resolves to kuromoji's, asked for only if the song is Japanese. → per line, its Latin letters or null. */
async function romanizeLines(texts, { tokenizer }) {
  const plain = texts.map(plainForms), all = plain.join('\n'), jp = isJapanese(all), reader = jp ? await tokenizer() : null, alphabet = alphabetOf(all);
  return plain.map((text) => {
    if (!NEEDS.test(text)) return null;
    let s = text;
    if (jp) s = japanese(s, reader);
    else s = s.replace(HAN_RUN, (run) => ` ${pinyinOf(run)} `).replace(KANA_RUN, (run) => ` ${kanaToLatin(run)} `);
    s = s.replace(HANGUL_RUN, korean).replace(JAMO_RUN, (run) => Array.from(run, (c) => JAMO[c] ?? c).join('')).replace(CYRILLIC_RUN, (w) => cyrillic(w, alphabet));
    return tidy(s);
  });
}
module.exports = { romanizeLines, kanaToLatin, korean, cyrillic };
