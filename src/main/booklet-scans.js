// Which of an album's scans from the Cover Art Archive go into its booklet: the pages of the real booklet, in the order
// they were put up, then the back of the case (the tray card) and what's under the disc. The release whose scans show
// the most of it is the one taken. No network here (online.js asks), so it's unit-tested.

const MAX_PAGES = 24;
const SKIP = ['Front', 'Medium', 'Raw/Unedited', 'Watermark']; // (the cover and the disc are shown already)

// The 1200 px copy; an older scan without one, the original (shrunk once it's in: online.js) — its 500 px copy reads
// blurred on a page.
const urlOf = (image) => (image.thumbnails && image.thumbnails['1200']) || image.image || (image.thumbnails && (image.thumbnails['500'] || image.thumbnails.large));

/** A release's index of images → [{ url, kind: 'booklet' | 'back' | 'tray' }], the booklet's pages first. */
function scanPicks(images) {
  const usable = (images || []).filter((i) => i && urlOf(i) && !(i.types || []).some((type) => SKIP.includes(type)));
  const of = (type) => usable.filter((i) => (i.types || []).includes(type));
  const booklet = of('Booklet').slice(0, MAX_PAGES);
  const back = of('Back').filter((i) => !booklet.includes(i)).slice(0, 1);
  const tray = of('Tray').filter((i) => !booklet.includes(i) && !back.includes(i)).slice(0, 1);
  return [...booklet.map((i) => ({ url: urlOf(i), kind: 'booklet' })), ...back.map((i) => ({ url: urlOf(i), kind: 'back' })), ...tray.map((i) => ({ url: urlOf(i), kind: 'tray' }))];
}

/** How much of the album a release's picks show: each booklet page, and the back and tray. */
const scanWorth = (picks) => picks.reduce((s, p) => s + (p.kind === 'booklet' ? 2 : 1), 0);

/**
 * The releases worth asking for scans, best first: `releaseId` (the files' own), then the album's CDs with the most
 * images, then the rest. Only releases with more than a cover. → ids, at most `max`.
 */
function scanReleases(releases, releaseId = null, max = 6) {
  const isCd = (r) => (r.media || []).some((m) => /\bCD\b/.test(m.format || '') && m.format !== 'CD-R');
  const count = (r) => (r['cover-art-archive'] || {}).count || 0;
  const others = (releases || []).filter((r) => r.id !== releaseId && count(r) > 1)
    .sort((a, b) => (isCd(b) - isCd(a)) || (count(b) - count(a)));
  return [...(releaseId ? [releaseId] : []), ...others.map((r) => r.id)].slice(0, max);
}

/**
 * The best of the releases' picks ([{ id, picks }], in scanReleases' order): the files' own release when it has
 * booklet pages, else the one showing the most (the earlier on a tie). → its picks, or [] for none.
 */
function bestScans(found, releaseId = null) {
  const own = found.find((f) => f.id === releaseId);
  if (own && own.picks.some((p) => p.kind === 'booklet')) return own.picks;
  let best = null;
  for (const f of found) if (scanWorth(f.picks) > (best ? scanWorth(best.picks) : 0)) best = f;
  return best ? best.picks : [];
}

module.exports = { scanPicks, scanReleases, bestScans, scanWorth, MAX_PAGES };
