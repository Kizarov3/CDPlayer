// What the search ("/") finds besides songs: what CDPlayer can do (the keys' and the header's actions, by name) and
// where each setting is (Settings opened at its row). Found by the start of a word of its name — in English or in the
// language CDPlayer is in — or of another word it goes by ("crossfeed" finds SPATIAL AUDIO).
import { t } from './i18n.js';

/** Settings' rows: [section, row, other words it goes by] — the rows the Settings panel has, in its order. */
export const SETTING_ROWS = [
  ['SOUND', 'EQUALIZER', 'eq preset bass treble эквалайзер бас'],
  ['SOUND', 'TRANSITION', 'crossfade gapless automix fade переход кроссфейд'],
  ['SOUND', 'OUTPUT', 'device speakers headphones airpods bluetooth устройство наушники колонки'],
  ['SOUND', 'QUALITY', 'sample rate bit hi-res exclusive качество'],
  ['SOUND', 'MONO AUDIO', 'one earbud speaker моно'],
  ['SOUND', 'SPATIAL AUDIO', 'crossfeed headphones 3d кроссфид объёмный'],
  ['SOUND', 'SOUND CHECK', 'replaygain loudness normalize volume level громкость нормализация'],
  ['SOUND', 'DISC NOISE', 'hiss motor skip шум'],
  ['LOOK', 'THEME', 'colors colours dark light тема цвета'],
  ['LOOK', 'LANGUAGE', 'english russian язык'],
  ['LOOK', 'PLAYER LOOK', 'layout dock stage glass panel вид плеера оформление пульт сцена стекло панель cover обложка apple music'],
  ['LOOK', 'DISPLAY', 'deck vfd classic digits дисплей'],
  ['LOOK', 'WAVEFORM', 'seek bar волна'],
  ['LOOK', 'AMBIENT BACKGROUND', 'blur cover background фон'],
  ['LOOK', 'DISC WEAR', 'scratches fingerprints царапины'],
  ['LOOK', 'DISC SHINE', 'rainbow reflection блик'],
  ['LOOK', 'DISC ICON', 'dock taskbar icon иконка док'],
  ['LOOK', 'ANIMATIONS', 'motion reduce анимации'],
  ['PLAYBACK', 'CD CHANGER', 'five discs carousel changer чейнджер'],
  ['PLAYBACK', 'SLEEP TIMER', 'sleep stop timer сон таймер'],
  ['PLAYBACK', '…OR AT THE END OF THE DISC', 'sleep end album сон'],
  ['PLAYBACK', 'LYRICS OFFSET', 'karaoke timing lyrics текст сдвиг'],
  ['PLAYBACK', 'MINI MODE', 'small window мини'],
  ['PHONE REMOTE', 'CONTROL FROM A PHONE', 'remote phone qr пульт телефон'],
  ['LIBRARY', 'SAVE FOUND ART & LYRICS', 'covers lyrics write files обложки'],
  ['LIBRARY', 'YOUTUBE MUSIC & SOUNDCLOUD', 'stream streaming youtube soundcloud online стриминг ютуб онлайн'],
  ['LIBRARY', 'BACKUP', 'restore export cdbackup резервная копия восстановить'],
  ['LIBRARY', 'IMPORT PLAYS', 'last.fm lastfm listenbrainz spotify apple music itunes scrobbles history импорт истории скробблы'],
  ['SHARING', 'DISCORD STATUS', 'discord rich presence дискорд'],
  ['SHARING', 'LAST.FM', 'lastfm scrobble scrobbling audioscrobbler скробблинг скробблы ласт'],
  ['SHARING', 'LISTENBRAINZ', 'scrobble scrobbling скробблинг скробблы'],
  ['DISCOGS', 'TOKEN', 'discogs api key токен'],
  ['DISCOGS', 'CURRENCY', 'discogs price money валюта цена'],
];

const fold = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').normalize('NFD').replace(/\p{M}/gu, '');
const wordsOf = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Whether every word typed starts a word of `names` (each a name it goes by). */
export function matchesName(query, names) {
  const typed = wordsOf(query);
  if (!typed.length || typed.join('').length < 2) return false;
  const words = names.flatMap(wordsOf);
  return typed.every((w) => words.some((x) => x.startsWith(w)));
}

const MAX = 4;
/**
 * What `query` finds: [{ kind: 'action', label, key, run } | { kind: 'setting', label, section, row }] — the actions
 * (`actions`: { label, also (other words), key, run }, each that can be done now) first, at most four in all.
 */
export function findCommands(query, actions) {
  const found = actions.filter((a) => matchesName(query, [a.label, a.also || ''])).map((a) => ({ kind: 'action', label: a.label, key: a.key, run: a.run }));
  SETTING_ROWS.forEach(([section, row, also], i) => {
    // (a row that goes on from the one above, "…OR AT THE END OF THE DISC", is named with it)
    const label = row.startsWith('…') && i ? `${t(SETTING_ROWS[i - 1][1])} ${t(row)}` : t(row);
    if (matchesName(query, [row, t(row), also])) found.push({ kind: 'setting', label, section: t(section), row });
  });
  return found.slice(0, MAX);
}
