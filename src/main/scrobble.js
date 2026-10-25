'use strict';
/**
 * Scrobbling to ListenBrainz: a song heard — half of it, or 4 minutes — is sent as a listen, and the one starting as
 * "playing now". Signed in with the user token from listenbrainz.org/settings (scrobble.json, not in the backup, like
 * the other sign-ins). Listens that couldn't be sent (offline, ListenBrainz down) wait in scrobble-queue.json and go
 * with the next one, up to 1000 at a time; past 5000 waiting, the oldest are let go.
 */
const API = process.env.CDPLAYER_LISTENBRAINZ_API || 'https://api.listenbrainz.org/1'; // (another, to test against)
const QUEUE_MAX = 5000, BATCH = 1000;

function createScrobbler({ store, fetch = globalThis.fetch, version = '' }) {
  let conf = null, queue = null, sending = null;
  const json = (name, empty) => { try { return JSON.parse(store.readText(name) || 'null') || empty; } catch { return empty; } };
  const settings = () => (conf = conf || json('scrobble.json', {}));
  const pending = () => (queue = queue || [].concat(json('scrobble-queue.json', [])));
  const save = () => store.writeText('scrobble.json', JSON.stringify(conf));
  const saveQueue = () => store.writeText('scrobble-queue.json', JSON.stringify(queue));
  const token = () => { const lb = settings().listenbrainz; return lb && !lb.dropped ? lb.token : null; };
  const call = (path, key, body) => fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Token ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const named = (s) => s && typeof s.artist === 'string' && s.artist.trim() && typeof s.title === 'string' && s.title.trim();
  const meta = (s) => ({
    artist_name: s.artist.trim(), track_name: s.title.trim(), ...(s.album ? { release_name: String(s.album) } : {}),
    additional_info: { media_player: 'CDPlayer', submission_client: 'CDPlayer', submission_client_version: version, ...(s.duration > 0 ? { duration_ms: Math.round(s.duration * 1000) } : {}) },
  });

  function status() {
    const lb = settings().listenbrainz;
    return { user: lb ? lb.user : null, dropped: !!(lb && lb.dropped), waiting: pending().length };
  }
  /** The token pasted → { ok, user } | { error: 'EMPTY' | 'BAD_TOKEN' | 'OFFLINE' }. */
  async function signIn(value) {
    const key = String(value || '').trim();
    if (!key) return { error: 'EMPTY' };
    try {
      const r = await call('/validate-token', key);
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.valid) return { error: r.status >= 500 ? 'OFFLINE' : 'BAD_TOKEN' };
      settings().listenbrainz = { token: key, user: body.user_name || null };
      save();
      await flush(); // what waited for the token goes now
      return { ok: true, user: body.user_name || null };
    } catch { return { error: 'OFFLINE' }; }
  }
  function signOut() {
    settings().listenbrainz = null; save();
    queue = []; saveQueue(); // someone else signing in doesn't get these
  }
  function nowPlaying(s) {
    const key = token();
    if (!key || !named(s)) return Promise.resolve(false);
    return call('/submit-listens', key, { listen_type: 'playing_now', payload: [{ track_metadata: meta(s) }] }).then((r) => r.ok, () => false);
  }
  /** A song heard: { artist, title, album, duration (s), at (ms, when it began) } → whether it (and those waiting) went. */
  function scrobble(s) {
    if (!token() || !named(s)) return Promise.resolve(false);
    const q = pending();
    q.push({ artist: s.artist, title: s.title, album: s.album || null, duration: s.duration || 0, at: Math.floor((Number(s.at) || Date.now()) / 1000) });
    if (q.length > QUEUE_MAX) q.splice(0, q.length - QUEUE_MAX);
    saveQueue();
    return flush();
  }
  /** Sends what's waiting; → true when nothing is left. */
  function flush() {
    if (sending) return sending;
    sending = (async () => {
      const q = pending();
      while (q.length) {
        const key = token();
        if (!key) return false;
        const batch = q.slice(0, BATCH);
        let r;
        try {
          r = await call('/submit-listens', key, { listen_type: batch.length === 1 ? 'single' : 'import', payload: batch.map((x) => ({ listened_at: x.at, track_metadata: meta(x) })) });
        } catch { return false; }
        if (r.status === 401) { settings().listenbrainz.dropped = true; save(); return false; } // the token was reset: asked for again
        if (!r.ok && r.status !== 400) return false; // (400: something in it ListenBrainz won't take — not sent again and again)
        q.splice(0, batch.length);
        saveQueue();
      }
      return true;
    })().finally(() => { sending = null; });
    return sending;
  }
  return { status, signIn, signOut, nowPlaying, scrobble, flush };
}

module.exports = { createScrobbler };
