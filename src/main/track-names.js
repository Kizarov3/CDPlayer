'use strict';
/**
 * Making sense of badly named tracks: website tags stamped into names ("Got The Life (mp3.pm)"), video-site noise
 * ("(Official Video) [HD]"), junk artist tags ("Unknown Artist", "VA", a website), track numbers left in titles
 * ("01. Title"), "Artist - Title" in the title tag or the filename (sometimes the wrong way round), and the extras
 * stores leave out of a song's name ("(Remastered 2011)", " - Radio Edit", "feat. Someone"). tidyNames() is what the
 * player shows; nameVariants() is the list of guesses the cover and lyrics lookups try, best first.
 */
const path = require('path');

const TLDS = 'com|net|org|info|biz|ru|su|ua|by|kz|pm|me|fm|to|cc|io|ws|tv|club|xyz|top|site|online|music|mobi|pro|in|uk|de|pl|es';
// A bracketed domain ("(mp3.pm)", "[muzmo.ru]", "{www.site.com}"), a bare "www.site.com", or a bare "site.tld" as the
// last word ("… mp3.pm") — a domain has no spaces and ends in a known top-level domain, so "(feat. Dr. Dre)",
// "(Pt.2)" or "St.Louis" are left alone.
const SITE_TAG = new RegExp(String.raw`\s*(?:[([{]\s*(?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}/?\s*[)\]}]|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}\b|(?:^|[\s\-–—|])[a-z0-9]+\.(?:${TLDS})\s*$)`, 'gi');
// Video-site and download noise in brackets, or a bare bitrate — never part of the song's name either.
const NOISE = /\s*(?:[([]\s*(?:official\s+)?(?:music\s+|lyrics?\s+|hd\s+|hq\s+)?(?:video|audio|visuali[sz]er|lyrics?|clip)(?:\s+(?:hd|hq|4k))?\s*[)\]]|[([]\s*(?:hd|hq|4k|explicit|clean|free\s+download|premiere|\d{2,3}\s*kbps)\s*[)\]]|\b\d{2,3}\s*kbps\b)/gi;
// Artist tags that mean nobody filled it in.
const JUNK_ARTIST = /^(?:unknown(?:\s+artist)?|various(?:\s+artists)?|va|v\.a\.|artist|n\/?a|none|<unknown>|неизвестн[а-яё]*(?:\s+исполнитель)?|исполнитель|разные\s+исполнители)$/i;
// Title tags that say nothing about the song ("Track 01", "Unknown", "Audio Track").
const JUNK_TITLE = /^(?:track\s*\d*|unknown|untitled|audio\s*track(?:\s*\d+)?|\d+|трек\s*\d*|без\s+названия)$/i;
// A leading track number in a title: "01. Title", "1) Title", "3 - Title", "01 Title" (a leading zero) — but not
// "7 Rings", "99 Problems" or "1-800-273-8255".
const LEADING_NUMBER = /^\s*(?:track\s*)?(?:\d{1,3}\s*[.)]\s+|\d{1,3}\s+[-–—]\s+|0\d\s+)(?=\S)/i;
// What stores leave out after a dash: " - Remastered 2011", " - Radio Edit", " - Live at Wembley", " - Slowed + Reverb".
const VERSION_SUFFIX = /\s+[-–—]\s+(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?\b.*|(?:radio|single|album|extended|original|club|clean|explicit)\s+(?:edit|version|mix)\b.*|live\b.*|mono|stereo|acoustic\b.*|demo\b.*|instrumental\b.*|bonus\s+track\b.*|(?:slowed|sped\s*up|reverb|nightcore|8d|bass\s+boosted)\b.*|from\s+.*|[^-–—]*\b(?:remix|mix|version|edit)\b[^-–—]*)$/i;
const FEATURING = /\s+[([]?\s*(?:feat\.?|ft\.?|featuring|prod\.?(?:\s+by)?)\s.*$/i;
// "Artist - Title": a dash with spaces round it (or on one side: "Korn -Got The Life"), a tilde or a bar. A dash inside
// a word ("Jay-Z", "Anti-Hero") never splits.
const SEPARATOR = /\s+[-–—~|]\s+|\s+[-–—](?=\S)|(?<=\S)[-–—]\s+/;

/** The name with website tags and video/download noise removed (never cleaned down to nothing). */
function cleanTrackName(text) {
  if (!text) return text;
  const cleaned = String(text).replace(SITE_TAG, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').replace(/[\s\-–—|:]+$/, '').replace(/^[\s\-–—|:]+/, '').trim();
  return cleaned || String(text).trim();
}
/** The artist tag cleaned, or null when it's empty, junk ("Unknown Artist") or only a website. */
function cleanArtist(artist) {
  if (!artist) return null;
  const cleaned = String(artist).replace(SITE_TAG, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, '').trim();
  return cleaned && !JUNK_ARTIST.test(cleaned) ? cleaned : null;
}
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * "Artist - Title" → [artist, title], or null. Handles "Artist - 01 - Title" and "Artist - Album - 01 - Title" (the
 * part after the track number is the title), and leaves "Title - Remastered 2011" alone.
 */
function splitName(text) {
  const parts = String(text || '').split(SEPARATOR).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const number = parts.findIndex((p, i) => i > 0 && /^\d{1,3}$/.test(p));
  if (number > 0 && number < parts.length - 1) return [parts[0], parts.slice(number + 1).join(' - ')];
  const rest = parts.slice(1).join(' - ');
  const version = ` - ${rest}`.match(VERSION_SUFFIX);
  if (version && version.index === 0) return null; // "Title - Remastered 2011": all of it is a version ending
  return [parts[0], rest];
}

/** "01 - Korn - Got The Life (mp3.pm).mp3" → { artist: 'Korn', title: 'Got The Life' }; artist null if not named. */
function parseFilename(filePath) {
  let name = path.basename(filePath).replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  name = cleanTrackName(name).replace(/^\s*\d{1,3}(?:\s*[-.)]\s*|\s+)(?=\S)/, ''); // a leading track number
  const split = splitName(name);
  if (split) return { artist: split[0], title: split[1] };
  return { artist: null, title: name.replace(/-/g, ' ').replace(/\s+/g, ' ').trim() };
}

/**
 * The artist and title to show, from the tags and the filename: junk tags ignored in favour of the filename, a track
 * number taken off the title, "Artist - Title" in a title tag split when there's no artist, and "Korn - Got The Life"
 * by Korn shortened to "Got The Life". `guessed` = the artist came from splitting a name, so it may be the wrong way
 * round ("Title - Artist") — nameVariants() then tries it swapped too.
 */
function tidyNames({ artist, title }, filePath) {
  const fromName = filePath ? parseFilename(filePath) : { artist: null, title: null };
  const tagTitle = cleanTrackName(title && String(title).trim() ? String(title).trim() : '');
  let t = tagTitle && !JUNK_TITLE.test(tagTitle) ? tagTitle.replace(LEADING_NUMBER, '').trim() || tagTitle : fromName.title;
  let a = cleanArtist(artist);
  let guessed = false;
  if (!a && t === fromName.title && fromName.artist) { a = cleanArtist(fromName.artist); guessed = !!a; }
  const split = t && splitName(t);
  if (split && !a) { a = cleanArtist(split[0]); if (a) { t = split[1]; guessed = true; } }
  else if (split && words(split[0]) === words(a)) t = split[1];
  if (!a && fromName.artist) { a = cleanArtist(fromName.artist); guessed = !!a; }
  return { artist: a, title: t || fromName.title || null, guessed };
}

/** The title without anything in brackets, "feat."/"prod." credits or a " - Remastered"-style ending. */
function bareTitle(title) {
  const bare = String(title || '').replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(FEATURING, '').replace(VERSION_SUFFIX, '').replace(/\s+/g, ' ').trim();
  return bare || String(title || '').trim();
}
/** The first-named artist of "A feat. B", "A & B", "A, B", "A x B", "A vs B". */
function primaryArtist(artist) {
  const first = String(artist || '').split(/\s*(?:,|;|&|\+|\/|\s(?:x|vs\.?|feat\.?|ft\.?|featuring|and|и)\s)\s*/i)[0].trim();
  return first || artist;
}

/**
 * The { artist, title } guesses a lookup tries, best first and without repeats: as named; without brackets, credits
 * and version endings; with just the first artist; the other way round when the artist was guessed from
 * "A - B"; and, with no artist at all, an "Artist - Title" hiding in the title.
 */
function nameVariants({ artist, title, guessed }) {
  const a = artist ? String(artist).trim() : null, t = title ? String(title).trim() : '';
  if (!t) return [];
  const bare = bareTitle(t);
  const list = [{ artist: a, title: t }, { artist: a, title: bare }];
  if (a && primaryArtist(a) !== a) list.push({ artist: primaryArtist(a), title: bare });
  if (a && guessed) list.push({ artist: bareTitle(t), title: a });
  if (!a) {
    const split = splitName(t);
    if (split) list.push({ artist: split[0], title: bareTitle(split[1]) });
  }
  const seen = new Set();
  return list.filter((v) => {
    const key = `${words(v.artist)}|${words(v.title)}`;
    if (!v.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Search-box strings for a name: "artist title" per guess (a plain string is taken as the whole name). */
function searchVariants(query) {
  if (typeof query !== 'string') return nameVariants(query).map((v) => `${v.artist ? `${v.artist} ` : ''}${v.title}`);
  const clean = cleanTrackName(query);
  return [...new Set([clean, bareTitle(clean)].filter(Boolean))];
}

module.exports = { cleanTrackName, cleanArtist, parseFilename, splitName, tidyNames, bareTitle, primaryArtist, nameVariants, searchVariants };
