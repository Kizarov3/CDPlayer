'use strict';
/**
 * The main process's web requests, through Chromium's network stack (Electron's net.fetch) instead of Node's own
 * fetch. Node's ignores the system's proxy settings and certificate store — so on a PC whose antivirus inspects HTTPS
 * (common on Windows: it re-signs every site with its own certificate, which only the system trusts), or behind a
 * proxy, every request failed as if there were no network. Chromium's is the one the browser uses. Before the app is
 * ready, and in tests (no Electron), Node's fetch.
 */
let electron = null;
try { electron = require('electron'); } catch { /* plain Node */ }

function httpFetch(url, init) {
  const { net, app } = (electron && typeof electron === 'object') ? electron : {};
  if (net && typeof net.fetch === 'function' && app && app.isReady()) return net.fetch(url, init);
  return fetch(url, init);
}

/**
 * Why a request got no answer, briefly, for a status line: Chromium's net::ERR_… code ("ERR_CERT_AUTHORITY_INVALID",
 * "ERR_PROXY_CONNECTION_FAILED"), a timeout, or Node's error code. null when there's nothing more to say.
 */
// A request that got no answer: fetch rejects with a TypeError ("fetch failed"), net.fetch with net::ERR_…, or it timed out.
const isNetworkFailure = (e) => !!e && (e.name === 'TypeError' || e.name === 'TimeoutError' || e.name === 'AbortError' || /net::ERR_/.test(e.message || ''));
function networkErrorCode(e) {
  if (!isNetworkFailure(e)) return null;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'TIMED OUT';
  const text = `${e.message || ''} ${(e.cause && (e.cause.code || e.cause.message)) || ''}`;
  const m = /\b(ERR_[A-Z_]+)\b/.exec(text) || /\b(E[A-Z]{3,}|CERT_[A-Z_]+|UNABLE_TO_[A-Z_]+|SELF_SIGNED_[A-Z_]+|DEPTH_ZERO_[A-Z_]+)\b/.exec(text);
  return m ? m[1] : null;
}

module.exports = { httpFetch, networkErrorCode, isNetworkFailure };
