'use strict';
/**
 * "A newer CDPlayer is out" check. Asks GitHub for the latest published release at most once a day (the answer is
 * cached in update-check.txt) and never downloads or installs anything — the renderer just shows a pill that opens
 * the Releases page. Offline or rate-limited simply means no pill.
 */
const store = require('./store');

const LATEST_RELEASE_API = 'https://api.github.com/repos/Kizarov3/CDPlayer/releases/latest';
const RELEASES_PAGE = 'https://github.com/Kizarov3/CDPlayer/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}
function isNewer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// update-check.txt — "checkedAtMillis" then the latest released version seen (empty line if there was none).
function readCache() {
  const [at, version] = (store.readText(store.FILES.updateCheck) || '').split(/\r?\n/);
  const checkedAt = parseInt(at, 10);
  return Number.isFinite(checkedAt) ? { checkedAt, version: parseVersion(version) ? version.trim() : null } : null;
}

async function fetchLatestVersion(currentVersion) {
  const res = await fetch(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `CDPlayer/${currentVersion}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null; // no releases published at all
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // A release whose downloads aren't attached yet (CI still building) isn't worth announcing.
  if (json.draft || json.prerelease || !Array.isArray(json.assets) || !json.assets.length) return null;
  return parseVersion(json.tag_name) ? json.tag_name.trim().replace(/^v/, '') : null;
}

// → { version } when a newer release than currentVersion is out, otherwise null.
async function checkForUpdate(currentVersion, { now = Date.now(), fetchLatest = fetchLatestVersion } = {}) {
  const cache = readCache();
  let latest;
  if (cache && now >= cache.checkedAt && now - cache.checkedAt < CHECK_INTERVAL_MS) {
    latest = cache.version;
  } else {
    try {
      latest = await fetchLatest(currentVersion);
      store.writeText(store.FILES.updateCheck, `${now}\n${latest || ''}\n`);
    } catch {
      latest = cache && cache.version; // offline: go by what we last knew, and try again next time
    }
  }
  return latest && isNewer(latest, currentVersion) ? { version: latest } : null;
}

module.exports = { checkForUpdate, isNewer, RELEASES_PAGE, CHECK_INTERVAL_MS };
