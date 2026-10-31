// The WANT LIST (main/want-list.js keeps it): albums you don't have yet, put on it with ★ WANT from a missing album's
// ghost case, shown as index cards with what they go for on Discogs. What the shelf and the cards need to say of it.
import { t } from './i18n.js';
import { sameName, albumKey } from './shelf-missing.js';
import { discogsPrice } from './shelf-discogs.js';

/** What a wanted album is known by — the same as main's wantKey: its artist and its title without its edition's words. */
export const wantKey = (artist, title) => `${sameName(artist)}\n${albumKey(title)}`;
/** Whether the album (`artist`, `title`) is on the list `items`. */
export const isWanted = (items, artist, title) => { const key = wantKey(artist, title); return (items || []).some((x) => x.key === key); };
/** How many are still wanted (not crossed off). */
export const stillWanted = (items) => (items || []).filter((x) => !x.found).length;
/** The cards in the order they're shown: still wanted first, oldest first; those crossed off at the end. */
export const cardOrder = (items) => [...(items || [])].sort((a, b) => (!!a.found - !!b.found) || (a.added || 0) - (b.added || 0));

/** A card's price line from its Discogs entry (main/discogs.js; undefined: still being asked). */
export function priceWords(entry) {
  if (entry === undefined) return t('LOOKING ON DISCOGS…');
  if (!entry || entry.error) return t('DISCOGS UNAVAILABLE');
  if (!entry.releaseId) return t('NOT ON DISCOGS');
  const price = discogsPrice(entry);
  return price ? t('from {price} on Discogs', { price }) : t('not for sale');
}

/** The status line's note when wanted albums turned up in the music folder ([{ artist, title }]). */
export function foundNote(found) {
  if (!found || !found.length) return '';
  if (found.length > 1) return t('{n} ALBUMS FROM YOUR WANT LIST TURNED UP ★', { n: found.length });
  return t('FOUND IT: {album} · CROSSED OFF YOUR WANT LIST', { album: `${found[0].artist} — ${found[0].title}`.toUpperCase() });
}
