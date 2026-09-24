'use strict';
/**
 * Making sense of track names from download and video sites: website tags stamped into names ("Got The Life
 * (mp3.pm)"), video-site noise ("(Official Video) [HD]"), and untagged files whose only information is an
 * "Artist - Title" filename. Also the fallback searches the cover lookup tries when the full name finds nothing.
 */
const path = require('path');

const TLDS = 'com|net|org|info|biz|ru|su|ua|by|kz|pm|me|fm|to|cc|io|ws|tv|club|xyz|top|site|online|music|mobi|pro|in|uk|de|pl|es';
// A bracketed domain ("(mp3.pm)", "[muzmo.ru]", "{www.site.com}"), a bare "www.site.com", or a bare "site.tld" as the
// last word ("… mp3.pm") — a domain has no spaces and ends in a known top-level domain, so "(feat. Dr. Dre)",
// "(Pt.2)" or "St.Louis" are left alone.
const SITE_TAG = new RegExp(String.raw`\s*(?:[([{]\s*(?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}/?\s*[)\]}]|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}\b|(?:^|[\s\-–—|])[a-z0-9]+\.(?:${TLDS})\s*$)`, 'gi');
// Video-site and download noise in brackets, or a bare bitrate — never part of the song's name either.
const NOISE = /\s*(?:[([]\s*(?:official\s+)?(?:music\s+|lyrics?\s+|hd\s+|hq\s+)?(?:video|audio|visuali[sz]er|lyrics?|clip)(?:\s+(?:hd|hq|4k))?\s*[)\]]|[([]\s*(?:hd|hq|4k|explicit|clean|free\s+download|premiere|\d{2,3}\s*kbps)\s*[)\]]|\b\d{2,3}\s*kbps\b)/gi;

/** The name with website tags and video/download noise removed (never cleaned down to nothing). */
function cleanTrackName(text) {
  if (!text) return text;
  const cleaned = String(text).replace(SITE_TAG, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').replace(/[\s\-–—|:]+$/, '').replace(/^[\s\-–—|:]+/, '').trim();
  return cleaned || String(text).trim();
}

/** "01 - Korn - Got The Life (mp3.pm).mp3" → { artist: 'Korn', title: 'Got The Life' }; artist null if not named. */
function parseFilename(filePath) {
  let name = path.basename(filePath).replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  name = cleanTrackName(name).replace(/^\s*\d{1,3}(?:\s*[-.)]\s*|\s+)(?=\S)/, ''); // a leading track number
  const parts = name.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { artist: null, title: name.replace(/-/g, ' ').replace(/\s+/g, ' ').trim() };
}

/**
 * What the cover lookup searches for, best first: the cleaned name, then without anything in brackets or after
 * "feat." ("(Remastered 2011)", "(Live)", "feat. Someone") — which also tends to be how the stores title the song.
 */
function searchVariants(query) {
  const clean = cleanTrackName(query);
  const bare = clean.replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, '').replace(/\s+/g, ' ').trim();
  return [...new Set([clean, bare].filter(Boolean))];
}

module.exports = { cleanTrackName, parseFilename, searchVariants };
