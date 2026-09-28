// Spotify discs: the Web Playback SDK's one player for the app (SpotifySession), and a stand-in <audio> element per
// track (SpotifyTrackElement) that AudioEngine drives as a deck — so the transport, the disc, the seek bar, lyrics
// and karaoke don't need to know the sound comes from Spotify. The SDK plays through Widevine, outside Web Audio:
// no EQ, mono, crossfade or visualizer for it.

let sdk = null;
/** Loads Spotify's player script once, on first use (never at startup — the player must work offline). */
export function loadSpotifySdk(doc = document, win = window) {
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    if (win.Spotify && win.Spotify.Player) { resolve(win.Spotify.Player); return; }
    win.onSpotifyWebPlaybackSDKReady = () => resolve(win.Spotify.Player);
    const script = doc.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => { sdk = null; script.remove(); reject(new Error('sdk')); };
    doc.head.append(script);
  });
  return sdk;
}

export const isSpotifyUri = (p) => typeof p === 'string' && /^spotify:track:[A-Za-z0-9]+$/.test(p);

/**
 * What Spotify is handed after the current track: the rest of the disc, so an album plays on without a gap. Not when
 * shuffling (CDPlayer picks each next song itself, and there's no gap to keep between unrelated songs) or repeating
 * one track — then just the song, and CDPlayer says what comes next when it ends.
 */
export function spotifyUpcoming(queue, index, { shuffle, repeat }) {
  if (shuffle || repeat === 'ONE' || index < 0) return [];
  return queue.slice(index + 1).filter(isSpotifyUri);
}

const NEAR_END_MS = 2000;   // a track paused back at 0 this close to its end has finished
const OVERRUN_MS = 1500;    // no word from Spotify this long past the end: finished anyway
const STALE_MS = 3000;      // after a request, a report further in than this is still the old track's

export class SpotifySession {
  constructor({ loadPlayer, getToken, startPlayback, now = () => Date.now(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), volume = 1, name = 'CDPlayer' }) {
    Object.assign(this, { loadPlayer, getToken, startPlayback, now, wait, volume, name });
    this.listeners = new Set();
    this.player = null; this.deviceId = null; this.ready = null;
    this.currentUri = null; this.lost = false;
    this.sent = []; this.sentIndex = 0; this.awaiting = null; this.aliases = new Map(); this.pendingUpcoming = null;
    this.pos = { ms: 0, at: now(), paused: true }; this.durationMs = 0;
    this.everPlayed = false; this.playbackErrors = 0; this.saidUnsupported = false;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of [...this.listeners]) fn(e); }

  connect() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      let Player;
      try { Player = await this.loadPlayer(); } catch { Player = null; }
      if (!Player) { this.emit({ type: 'error', reason: 'offline' }); return { ok: false, reason: 'offline' }; }
      return new Promise((resolve) => {
        const fail = (reason) => { this.emit({ type: 'error', reason }); resolve({ ok: false, reason }); };
        const player = this.player = new Player({ name: this.name, volume: this.volume, getOAuthToken: (cb) => { this.getToken().then((t) => cb(t || ''), () => cb('')); } });
        player.addListener('ready', ({ device_id }) => { this.deviceId = device_id; resolve({ ok: true }); });
        player.addListener('not_ready', () => { this.deviceId = null; });
        player.addListener('initialization_error', () => fail('unsupported'));
        player.addListener('authentication_error', () => fail('auth'));
        player.addListener('account_error', () => fail('premium'));
        player.addListener('playback_error', () => this.onPlaybackError());
        player.addListener('player_state_changed', (s) => this.onState(s));
        player.connect().then((ok) => { if (!ok) fail('unsupported'); }, () => fail('unsupported'));
      });
    })();
    this.ready.then((r) => { if (!r.ok) this.ready = null; }); // a failed connection can be tried again
    return this.ready;
  }

  get paused() { return this.pos.paused; }
  position() {
    const p = this.pos.paused ? this.pos.ms : this.pos.ms + (this.now() - this.pos.at);
    return this.durationMs ? Math.min(p, this.durationMs + OVERRUN_MS * 2) : p;
  }

  /** Plays `uri` from `positionMs`, followed by `upcoming`. False when Spotify refused (the error is emitted). */
  async play(uri, positionMs = 0, upcoming = []) {
    const c = await this.connect();
    if (!c.ok) return false;
    this.sent = [uri, ...upcoming]; this.sentIndex = 0;
    this.currentUri = uri; this.awaiting = uri; this.aliases.clear(); this.pendingUpcoming = null; this.lost = false;
    this.pos = { ms: positionMs, at: this.now(), paused: false };
    const request = { deviceId: this.deviceId, uris: this.sent, positionMs: Math.round(positionMs) };
    let r = await this.startPlayback(request);
    if (!r.ok && r.status === 404) { await this.wait(1000); r = await this.startPlayback({ ...request, deviceId: this.deviceId }); }
    if (r.ok) return true;
    // Refused: nothing is on the device, so Spotify's empty report next isn't another device taking over.
    this.currentUri = null; this.awaiting = null;
    this.pos = { ms: positionMs, at: this.now(), paused: true };
    // A 403 is only a missing Premium when Spotify says so; "Restriction violated" is a track it won't play.
    const premium = r.status === 403 && r.reason === 'PREMIUM_REQUIRED';
    this.emit({ type: 'error', reason: r.status === 401 ? 'auth' : premium ? 'premium' : r.status === 0 ? 'offline' : 'playback' });
    return false;
  }
  async resume() {
    if (this.pendingUpcoming) return this.play(this.currentUri, this.position(), this.pendingUpcoming);
    this.pos = { ms: this.pos.ms, at: this.now(), paused: false };
    if (this.player) await this.player.resume();
    return true;
  }
  pause() {
    this.pos = { ms: this.position(), at: this.now(), paused: true };
    if (this.player) this.player.pause();
  }
  seek(ms) {
    this.pos = { ms, at: this.now(), paused: this.pos.paused };
    if (this.player) this.player.seek(ms);
  }
  setVolume(v) { this.volume = v; if (this.player) this.player.setVolume(v); }

  /** The order after the current track changed (shuffle, repeat, the queue): Spotify is re-told only if it differs. */
  resync(upcoming) {
    if (!this.currentUri || this.lost) return;
    const tail = this.sent.slice(this.sentIndex + 1);
    if (tail.length === upcoming.length && tail.every((u, i) => u === upcoming[i])) { this.pendingUpcoming = null; return; }
    if (this.pos.paused) { this.pendingUpcoming = upcoming; return; }
    this.play(this.currentUri, this.position(), upcoming);
  }
  /** Called on the playback timer: a track that ran out without a report from Spotify has finished. */
  tick() {
    if (!this.currentUri || this.pos.paused || !this.durationMs || this.lost) return;
    if (this.position() >= this.durationMs + OVERRUN_MS) this.finish(this.currentUri);
  }
  finish(uri) {
    // Nothing is on Spotify's device now: playing this track again (repeat one) is a fresh request, not a resume.
    this.currentUri = null;
    this.pos = { ms: 0, at: this.now(), paused: true };
    this.emit({ type: 'finished', uri });
  }

  onPlaybackError() {
    this.playbackErrors++;
    if (!this.everPlayed && this.playbackErrors >= 2) {
      if (!this.saidUnsupported) { this.saidUnsupported = true; this.emit({ type: 'error', reason: 'unsupported' }); }
      return;
    }
    this.emit({ type: 'error', reason: 'playback' });
  }

  onState(s) {
    if (!s) {
      if (this.currentUri && !this.lost) {
        this.lost = true;
        this.pos = { ms: this.position(), at: this.now(), paused: true };
        this.emit({ type: 'lost', uri: this.currentUri });
      }
      return;
    }
    const track = s.track_window && s.track_window.current_track;
    if (!track) return;
    const before = this.position();
    const raw = track.uri, linked = track.linked_from && track.linked_from.uri;
    let uri = this.aliases.get(raw) || (linked && this.sent.includes(linked) ? linked : raw);
    if (this.awaiting) {
      if (uri !== this.awaiting) {
        if (s.position > STALE_MS) return; // the previous track's last word
        this.aliases.set(raw, this.awaiting); uri = this.awaiting; // Spotify plays another copy of it (relinked)
      }
      this.awaiting = null;
    } else if (uri !== this.currentUri && !this.sent.includes(uri) && this.sent[this.sentIndex + 1]) {
      this.aliases.set(raw, this.sent[this.sentIndex + 1]); uri = this.sent[this.sentIndex + 1]; // the next one, relinked
    }
    this.lost = false;
    if (uri !== this.currentUri) {
      const from = this.currentUri, i = this.sent.indexOf(uri, this.sentIndex);
      if (i >= 0) this.sentIndex = i;
      this.currentUri = uri;
      this.durationMs = s.duration;
      this.pos = { ms: s.position, at: this.now(), paused: s.paused };
      this.emit({ type: 'trackchange', from, to: uri });
      return;
    }
    if (s.paused && s.position === 0 && this.durationMs > 0 && before >= this.durationMs - NEAR_END_MS) { this.finish(uri); return; }
    if (s.position > 0 && !s.paused) this.everPlayed = true;
    this.durationMs = s.duration;
    this.pos = { ms: s.position, at: this.now(), paused: s.paused };
  }
}

/** One track of a Spotify disc, looking enough like an <audio> element for AudioEngine to play it as a deck. */
export class SpotifyTrackElement {
  constructor(session, uri, durationMs, upcoming = () => []) {
    Object.assign(this, { session, uri, durationMs, upcoming });
    this.handlers = new Map();
    this.pending = 0; this.ended = false; this.disposed = false;
    this.off = session.on((e) => this.onSession(e));
    setTimeout(() => this.fire('loadedmetadata'), 0); // the length is known from the disc already
  }
  addEventListener(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); }
  removeEventListener(type, fn) { const set = this.handlers.get(type); if (set) set.delete(fn); }
  fire(type) { if (!this.disposed) for (const fn of [...(this.handlers.get(type) || [])]) fn(); }

  /** Spotify is on this track (not finished, not taken over by another device). */
  get own() { return !this.ended && !this.disposed && this.session.currentUri === this.uri && !this.session.lost; }
  get paused() { return !this.own || this.session.paused; }
  get duration() { return this.durationMs / 1000; }
  get currentTime() { return this.own ? Math.min(this.durationMs, this.session.position()) / 1000 : this.pending; }
  set currentTime(seconds) {
    if (this.own) this.session.seek(Math.round(seconds * 1000));
    else { this.pending = seconds; this.ended = false; }
  }
  async play() {
    if (this.own) { if (this.session.paused) await this.session.resume(); return; }
    this.ended = false;
    const ok = await this.session.play(this.uri, Math.round(this.pending * 1000), this.upcoming());
    if (!ok) throw new Error('spotify');
  }
  pause() { if (this.own && !this.session.paused) { this.session.pause(); this.pending = this.currentTime; } }
  onSession(e) {
    if ((e.type === 'trackchange' && e.from === this.uri) || (e.type === 'finished' && e.uri === this.uri)) {
      this.pending = 0; this.ended = true; this.fire('ended');
    } else if (e.type === 'lost' && e.uri === this.uri) this.pending = this.session.pos.ms / 1000;
  }
  removeAttribute() {}
  load() {
    if (this.disposed) return;
    if (this.own && !this.session.paused) this.session.pause();
    this.disposed = true;
    this.off();
  }
}
