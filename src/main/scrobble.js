'use strict';
/**
 * Scrobbling to ListenBrainz and Last.fm: a song heard — half of it, or 4 minutes — is sent as a listen, and the one
 * starting as "playing now", to each one signed in. ListenBrainz: the user token pasted from listenbrainz.org/settings;
 * Last.fm: CDPlayer allowed on last.fm in the browser (its desktop sign-in). Both kept in scrobble.json, not in the
 * backup, like the other sign-ins. Listens that couldn't be sent (offline, the service down) wait in
 * scrobble-queue.json, a list for each, and go with the next one, as many at a time as each takes; past 5000 waiting,
 * the oldest are let go.
 */
const crypto = require('crypto');

// (others, to test against)
const LISTENBRAINZ = process.env.CDPLAYER_LISTENBRAINZ_API || 'https://api.listenbrainz.org/1';
const LASTFM = process.env.CDPLAYER_LASTFM_API || 'https://ws.audioscrobbler.com/2.0/';
// The "CDPlayer" application on last.fm/api — a desktop app's secret is in every copy of it, as Last.fm expects.
const LASTFM_KEY = '28a46ad4e3daba21fda9817c8ca1f3e6', LASTFM_SECRET = 'd4a3eb9772cf886a5f0294a4c0ba86a0';
const LASTFM_AUTH = 'https://www.last.fm/api/auth/';
const SERVICES = ['listenbrainz', 'lastfm'];
const QUEUE_MAX = 5000, BATCH = { listenbrainz: 1000, lastfm: 50 };
// its errors that pass: operation failed, offline, temporarily unavailable, too many at once — and CDPlayer's key
// refused (invalid, suspended, a bad signature): not the listens' fault, so they wait
const LASTFM_RETRY = [4, 8, 10, 11, 13, 16, 26, 29];
const NOT_YET = 14; // the token isn't allowed (yet)

function createScrobbler({ store, fetch = globalThis.fetch, version = '', wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let conf = null, queues = null, connecting = null;
  const sending = {};
  const json = (name, empty) => { try { return JSON.parse(store.readText(name) || 'null') || empty; } catch { return empty; } };
  const settings = () => (conf = conf || json('scrobble.json', {}));
  const pending = () => {
    if (queues) return queues;
    const kept = json('scrobble-queue.json', {});
    queues = Array.isArray(kept) ? { listenbrainz: kept } : kept; // (a list: ListenBrainz's, from before Last.fm)
    for (const s of SERVICES) if (!Array.isArray(queues[s])) queues[s] = [];
    return queues;
  };
  const save = () => store.writeText('scrobble.json', JSON.stringify(conf));
  const saveQueue = () => store.writeText('scrobble-queue.json', JSON.stringify(queues));
  const signedIn = (service) => { const c = settings()[service]; return c && !c.dropped ? c : null; };
  const named = (s) => s && typeof s.artist === 'string' && s.artist.trim() && typeof s.title === 'string' && s.title.trim();
  const timeout = () => AbortSignal.timeout(15000);

  // --- ListenBrainz ---
  const lbCall = (path, key, body) => fetch(`${LISTENBRAINZ}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Token ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: timeout(),
  });
  const lbMeta = (s) => ({
    artist_name: s.artist.trim(), track_name: s.title.trim(), ...(s.album ? { release_name: String(s.album) } : {}),
    additional_info: { media_player: 'CDPlayer', submission_client: 'CDPlayer', submission_client_version: version, ...(s.duration > 0 ? { duration_ms: Math.round(s.duration * 1000) } : {}) },
  });

  // --- Last.fm: each call signed with the md5 of its parameters, in order, and the secret ---
  async function lfCall(method, params = {}) {
    const p = { ...params, method, api_key: LASTFM_KEY };
    p.api_sig = crypto.createHash('md5').update(Object.keys(p).sort().map((k) => `${k}${p[k]}`).join('') + LASTFM_SECRET, 'utf8').digest('hex');
    const r = await fetch(LASTFM, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...p, format: 'json' }).toString(), signal: timeout() });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const lfSong = (s, i = null) => {
    const at = (k) => (i === null ? k : `${k}[${i}]`);
    return {
      [at('artist')]: s.artist.trim(), [at('track')]: s.title.trim(), ...(s.album ? { [at('album')]: String(s.album) } : {}),
      ...(s.duration > 0 ? { [at('duration')]: String(Math.round(s.duration)) } : {}), ...(i === null ? {} : { [at('timestamp')]: String(s.at) }),
    };
  };

  // A batch sent → 'sent' | 'later' (offline, busy) | 'dropped' (signed out there) | 'refused' (not sent again and again)
  const send = {
    async listenbrainz(batch, c) {
      const r = await lbCall('/submit-listens', c.token, { listen_type: batch.length === 1 ? 'single' : 'import', payload: batch.map((x) => ({ listened_at: x.at, track_metadata: lbMeta(x) })) });
      return r.status === 401 ? 'dropped' : r.ok ? 'sent' : r.status === 400 ? 'refused' : 'later';
    },
    async lastfm(batch, c) {
      const r = await lfCall('track.scrobble', { sk: c.key, ...Object.assign({}, ...batch.map((x, i) => lfSong(x, i))) });
      const e = r.body.error;
      return e === 9 ? 'dropped' : e && !LASTFM_RETRY.includes(e) && r.status < 500 ? 'refused' : r.body.scrobbles ? 'sent' : 'later'; // (no answer read: not taken as sent)
    },
  };
  const tellPlaying = {
    listenbrainz: (s, c) => lbCall('/submit-listens', c.token, { listen_type: 'playing_now', payload: [{ track_metadata: lbMeta(s) }] }).then((r) => r.ok),
    lastfm: (s, c) => lfCall('track.updateNowPlaying', { sk: c.key, ...lfSong(s) }).then((r) => !r.body.error),
  };

  function status() {
    const q = pending(), out = {};
    for (const s of SERVICES) { const c = settings()[s]; out[s] = { user: c ? c.user : null, dropped: !!(c && c.dropped), waiting: q[s].length }; }
    return out;
  }
  /** When CDPlayer began scrobbling to each service that keeps no note of who sent a listen: { lastfm: ms }. */
  const ownSince = () => {
    const c = settings();
    if (c.lastfm && !c.lastfmSince) { c.lastfmSince = Date.now(); save(); } // (signed in before this was noted)
    return c.lastfmSince ? { lastfm: c.lastfmSince } : {};
  };
  /** ListenBrainz's token pasted → { ok, user } | { error: 'EMPTY' | 'BAD_TOKEN' | 'OFFLINE' }. */
  async function signIn(value) {
    const key = String(value || '').trim();
    if (!key) return { error: 'EMPTY' };
    try {
      const r = await lbCall('/validate-token', key);
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.valid) return { error: r.status >= 500 ? 'OFFLINE' : 'BAD_TOKEN' };
      settings().listenbrainz = { token: key, user: body.user_name || null };
      save();
      await flush('listenbrainz'); // what waited for the token goes now
      return { ok: true, user: body.user_name || null };
    } catch { return { error: 'OFFLINE' }; }
  }
  /**
   * Last.fm: CDPlayer asks for a token, `open`s last.fm's page to allow it, and asks every few seconds whether it was —
   * for 3 minutes. → { ok, user } | { error: 'OFFLINE' | 'NOT_ALLOWED' | 'CANCELLED' }.
   */
  async function connectLastfm(open, { every = 3000, tries = 60 } = {}) {
    let token;
    try { token = (await lfCall('auth.getToken')).body.token; } catch { /* offline */ }
    if (!token) return { error: 'OFFLINE' };
    connecting = token;
    open(`${LASTFM_AUTH}?api_key=${LASTFM_KEY}&token=${token}`);
    for (let i = 0; i < tries; i++) {
      await wait(every);
      if (connecting !== token) return { error: 'CANCELLED' };
      let r;
      try { r = await lfCall('auth.getSession', { token }); } catch { continue; }
      const session = r.body.session;
      if (session && session.key) {
        connecting = null;
        settings().lastfm = { key: session.key, user: session.name || null };
        settings().lastfmSince = settings().lastfmSince || Date.now(); // its listens from then on are CDPlayer's own (IMPORT PLAYS)
        save();
        await flush('lastfm');
        return { ok: true, user: session.name || null };
      }
      if (r.body.error && r.body.error !== NOT_YET && !LASTFM_RETRY.includes(r.body.error)) break; // the token expired
    }
    if (connecting === token) connecting = null;
    return { error: 'NOT_ALLOWED' };
  }
  function signOut(service = 'listenbrainz') {
    if (!SERVICES.includes(service)) return;
    if (service === 'lastfm') connecting = null;
    settings()[service] = null; save();
    pending()[service] = []; saveQueue(); // someone else signing in doesn't get these
  }
  /** The song starting, told to each service signed in → whether any took it. */
  async function nowPlaying(s) {
    if (!named(s)) return false;
    const told = await Promise.all(SERVICES.map((service) => {
      const c = signedIn(service);
      return c ? tellPlaying[service](s, c).catch(() => false) : false;
    }));
    return told.some(Boolean);
  }
  /** A song heard: { artist, title, album, duration (s), at (ms, when it began) } → whether it (and those waiting) went. */
  async function scrobble(s) {
    const to = SERVICES.filter(signedIn);
    if (!to.length || !named(s)) return false;
    const q = pending(), listen = { artist: s.artist, title: s.title, album: s.album || null, duration: s.duration || 0, at: Math.floor((Number(s.at) || Date.now()) / 1000) };
    for (const service of to) {
      q[service].push(listen);
      if (q[service].length > QUEUE_MAX) q[service].splice(0, q[service].length - QUEUE_MAX);
    }
    saveQueue();
    return (await Promise.all(to.map(flush))).every(Boolean);
  }
  /** Sends what's waiting (for one service, or each); → true when nothing is left. */
  function flush(service) {
    if (!service) return Promise.all(SERVICES.map(flush)).then((all) => all.every(Boolean));
    if (sending[service]) return sending[service];
    sending[service] = (async () => {
      const q = pending()[service];
      let size = BATCH[service];
      while (q.length) {
        const c = signedIn(service);
        if (!c) return false;
        const batch = q.slice(0, size);
        let result;
        try { result = await send[service](batch, c); } catch { return false; }
        if (result === 'dropped') { c.dropped = true; save(); return false; } // signed out there: asked to sign in again
        if (result === 'later') return false;
        if (result === 'refused' && batch.length > 1) { size = 1; continue; } // one of them it won't take: the rest go one by one
        for (const x of batch) { const at = q.indexOf(x); if (at >= 0) q.splice(at, 1); } // (by which: the oldest may have been let go meanwhile)
        saveQueue();
      }
      return true;
    })().finally(() => { sending[service] = null; });
    return sending[service];
  }
  return { status, ownSince, signIn, connectLastfm, signOut, nowPlaying, scrobble, flush };
}

module.exports = { createScrobbler };
