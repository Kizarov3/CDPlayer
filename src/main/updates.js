'use strict';
/**
 * The "x.y.z AVAILABLE" check. Every check asks GitHub for the latest published release and compares it with the
 * running version — nothing is remembered between checks, so the pill always names the newest release there is right
 * now (the renderer asks at launch and every 15 minutes). It never downloads or installs anything: the pill just
 * opens the Releases page. When GitHub can't be reached the result says so, and the pill stays as it was.
 */
const LATEST_RELEASE_API = 'https://api.github.com/repos/Kizarov3/CDPlayer/releases/latest';
const RELEASES_PAGE = 'https://github.com/Kizarov3/CDPlayer/releases/latest';
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

// → { version } when a newer release than currentVersion is out, null when currentVersion is the newest, and
//   { offline: true } when GitHub couldn't be reached (offline, rate-limited).
async function checkForUpdate(currentVersion, { fetchLatest = fetchLatestVersion } = {}) {
  let latest;
  try {
    latest = await fetchLatest(currentVersion);
  } catch {
    return { offline: true };
  }
  return latest && isNewer(latest, currentVersion) ? { version: latest } : null;
}

module.exports = { checkForUpdate, isNewer, RELEASES_PAGE };
