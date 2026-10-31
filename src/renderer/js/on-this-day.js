// ON THIS DAY: an album that came out on this day some years ago gets a sticker on its spine — 29 YEARS TODAY — and so
// does one you played on this day a year (or more) ago: A YEAR AGO TODAY. Only from what's known already: the day it
// came out from its tags, or from its booklet's story looked up before (main: album-story.js), and the log of plays
// (main: listens.js). PULL ONE leans towards today's.
import { t } from './i18n.js';

/** How many years ago today `released` ("1997-05-21") came out, or 0 (not today, a year alone, or not out a year yet). */
export function yearsToday(released, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(released || ''));
  if (!m) return 0;
  const d = new Date(now), years = d.getFullYear() - Number(m[1]);
  return Number(m[2]) === d.getMonth() + 1 && Number(m[3]) === d.getDate() && years >= 1 ? years : 0;
}

/**
 * The sticker an album ({ released, playedYearsAgo }) has today: { kind: 'released' | 'played', years, label } — its
 * birthday first — or null.
 */
export function todaySticker(album, now = Date.now()) {
  const years = yearsToday(album.released, now);
  if (years) return { kind: 'released', years, label: years === 1 ? t('1 YEAR TODAY') : t('{n} YEARS TODAY', { n: years }) };
  const ago = album.playedYearsAgo || 0;
  if (ago >= 1) return { kind: 'played', years: ago, label: ago === 1 ? t('A YEAR AGO TODAY') : t('{n} YEARS AGO TODAY', { n: ago }) };
  return null;
}

/** The shelf's line as it opens on a day with some: "ON THIS DAY: OK COMPUTER CAME OUT 29 YEARS AGO" (+ how many more). */
export function todayLine(albums, now = Date.now()) {
  const today = albums.map((a) => ({ a, s: todaySticker(a, now) })).filter((x) => x.s);
  if (!today.length) return null;
  const first = today.find((x) => x.s.kind === 'released') || today[0];
  const what = first.s.kind === 'released'
    ? (first.s.years === 1 ? t('{title} CAME OUT A YEAR AGO', { title: first.a.title }) : t('{title} CAME OUT {n} YEARS AGO', { title: first.a.title, n: first.s.years }))
    : (first.s.years === 1 ? t('YOU PLAYED {title} A YEAR AGO', { title: first.a.title }) : t('YOU PLAYED {title} {n} YEARS AGO', { title: first.a.title, n: first.s.years }));
  return [`${t('ON THIS DAY')}: ${what.toLocaleUpperCase()}`, today.length > 1 ? t('+{n} MORE', { n: today.length - 1 }) : null].filter(Boolean).join(' · ');
}

/**
 * PULL ONE on a day some of the albums shown have a sticker for: one of them half the time (else `pick` from all, as
 * it was). → an album, or null to pick as usual.
 */
export function pullToday(albums, now = Date.now(), rnd = Math.random) {
  const today = albums.filter((a) => todaySticker(a, now));
  if (!today.length || rnd() >= 0.5) return null;
  return today[Math.floor(rnd() * today.length)] || today[0];
}
