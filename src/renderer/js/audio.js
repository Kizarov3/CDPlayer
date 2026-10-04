// Playback engine. Each track plays from its own "deck" (an <audio> element streaming from the cdp:// media
// protocol, so seeking is instant and memory stays flat), routed through one shared Web Audio graph:
//
//   deck → trim (Sound Check) → deck gain (crossfade) ─┐
//   deck → trim (Sound Check) → deck gain (crossfade) ─┴→ mono downmix → 10-band EQ → spatial audio → analyser (visualizer/beats) → volume → speakers
//
// That graph replaces the Java app's hand-written PCM pump: gain, mono, EQ and crossfade are all native nodes.
//
// A deck can also play just a stretch of its file — a cue sheet track inside an album-length rip. position,
// duration and seek are then relative to that stretch, and reaching its end counts as the track ending.

import { Spatializer } from './spatial.js';

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export class AudioEngine {
  constructor() {
    this.volume = 1; this.mono = false; this.eqGains = new Array(EQ_FREQUENCIES.length).fill(0);
    this.outputId = '';
    this.customRate = null;    // Settings → QUALITY: the song's rate, or null for the system's
    this.spatialOn = false; this.spatialAmount = 0.5; // Settings → SPATIAL AUDIO (spatial.js)
    this.contextListeners = [];
    this.build(null);
    this.deck = null;          // the current track
    this.fadingOut = null;     // the previous track, while a crossfade is in progress
    this.fadeTimer = null;
    this.onEnded = null;
  }

  /** The graph, in a new context at `rate` (null: the system's), with the volume, mono, EQ and spatial audio it had. */
  build(rate) {
    const ctx = new AudioContext(rate ? { sampleRate: rate, latencyHint: 'playback' } : { latencyHint: 'playback' });
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.eq = EQ_FREQUENCIES.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.2; b.gain.value = this.eqGains[i]; // same RBJ peaking curve, Q 1.2, as the Java EQ
      return b;
    });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.spatial = new Spatializer(ctx);
    let node = this.input;
    for (const b of this.eq) { node.connect(b); node = b; }
    node.connect(this.spatial.input);
    this.spatial.output.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(ctx.destination);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.freq = null;
    this.recDest = null;
    this.closeRecordingContext();
    this.applyMono();
    this.applySpatial({ now: true });
  }

  get rate() { return this.ctx.sampleRate; }
  onContextChange(fn) { this.contextListeners.push(fn); }
  /**
   * Plays at `rate` from now on (null: the system's rate), by building the graph again in a new context — Web Audio
   * can't change a context's rate. Whatever was playing (and fading) is dropped: the caller loads the next song.
   * → false if the browser won't make a context at that rate; the engine then stays at the rate it had.
   */
  async setRate(rate) {
    if ((rate || null) === this.customRate && (!rate || rate === this.ctx.sampleRate)) return true;
    this.stop();
    const old = this.ctx, oldNodes = { input: this.input, eq: this.eq, spatial: this.spatial, analyser: this.analyser, master: this.master, samples: this.samples };
    try { this.build(rate); } catch {
      Object.assign(this, { ctx: old }, oldNodes);
      return false;
    }
    this.customRate = rate || null;
    if (this.outputId && this.ctx.setSinkId) await this.ctx.setSinkId(this.outputId).catch(() => {});
    for (const fn of this.contextListeners) fn(this.ctx);
    old.close().catch(() => {});
    return true;
  }

  setVolume(v) { this.volume = v; this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01); }
  /** Sound Check: the playing deck's own gain, before the crossfade's (1 = as it is). Ramped over `seconds`. */
  setTrim(linear, seconds = 0) {
    const t = this.deck && this.deck.trim;
    if (!t) return;
    t.gain.cancelScheduledValues(this.ctx.currentTime);
    if (seconds > 0) t.gain.setTargetAtTime(linear, this.ctx.currentTime, seconds / 3);
    else t.gain.value = linear;
  }
  setMono(on) { this.mono = on; this.applyMono(); this.applySpatial(); }
  applyMono() {
    // A 1-channel "explicit" node makes Web Audio sum L+R (×0.5 each) — exactly the Java version's (L+R)/2 —
    // and the speakers then get that mono signal on both sides.
    this.input.channelCount = this.mono ? 1 : 2;
    this.input.channelCountMode = this.mono ? 'explicit' : 'max';
    this.input.channelInterpretation = 'speakers';
  }
  /** Settings → SPATIAL AUDIO: on or off, and how much room (0–1). */
  setSpatial(on, amount = this.spatialAmount) { this.spatialOn = !!on; this.spatialAmount = amount; this.applySpatial(); }
  // Mono has one channel left, which would come from the left speaker alone: spatial audio waits while it's on.
  applySpatial(opts) { this.spatial.set(this.spatialOn && !this.mono, this.spatialAmount, opts); }
  setEq(gains) { this.eqGains = gains.slice(); gains.forEach((g, i) => this.eq[i].gain.setTargetAtTime(g, this.ctx.currentTime, 0.02)); }

  /** A deck for `url` — or, given `element` (a Spotify track), one that plays through it, outside Web Audio. */
  createDeck(url, element = null, trim = 1) {
    const el = element || new Audio();
    let source = null;
    const gain = this.ctx.createGain();
    let trimNode = null;
    if (!element) {
      el.preload = 'auto';
      el.src = url;
      source = this.ctx.createMediaElementSource(el);
      trimNode = this.ctx.createGain();
      trimNode.gain.value = trim;
      source.connect(trimNode);
      trimNode.connect(gain);
      gain.connect(this.input);
    }
    const deck = { el, source, trim: trimNode, gain, url, start: 0, end: null, endFired: false };
    el.addEventListener('ended', () => { if (this.onEnded) this.onEnded(deck); });
    return deck;
  }
  disposeDeck(deck) {
    if (!deck) return;
    try { deck.el.pause(); } catch { /* ignore */ }
    deck.el.removeAttribute('src');
    deck.el.load();
    if (deck.source) deck.source.disconnect();
    if (deck.trim) deck.trim.disconnect();
    deck.gain.disconnect();
  }

  /**
   * Loads a track. With crossfadeSeconds > 0 and something currently playing, the old deck keeps playing and
   * fades out along an equal-power (cos/sin) curve while the new one fades in; otherwise the old deck stops now.
   * Resolves once the new track's duration is known; rejects if it can't be decoded. `segment` ({ start, end } in
   * seconds, end null for "to the end of the file") plays only that part of the file.
   */
  async load(url, { autoPlay = true, crossfadeSeconds = 0, segment = null, element = null, trim = 1 } = {}) {
    this.cancelCrossfade();
    const outgoing = this.deck;
    // A Spotify track plays outside Web Audio, so there's nothing to fade — in or out.
    const doCrossfade = crossfadeSeconds > 0 && !element && outgoing && outgoing.source && !outgoing.el.paused;
    if (!doCrossfade) { this.disposeDeck(outgoing); this.deck = null; }
    const deck = this.createDeck(url, element, trim);
    this.deck = deck;
    await new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('decode')); };
      const cleanup = () => { deck.el.removeEventListener('loadedmetadata', ok); deck.el.removeEventListener('error', fail); };
      deck.el.addEventListener('loadedmetadata', ok);
      deck.el.addEventListener('error', fail);
    }).catch((e) => {
      if (this.deck === deck) { this.disposeDeck(deck); this.deck = null; }
      if (doCrossfade) this.disposeDeck(outgoing);
      throw e;
    });
    if (this.deck !== deck) return false; // superseded by a newer load while waiting
    if (segment) { this.setSegment(segment); deck.el.currentTime = segment.start; }
    if (doCrossfade) this.startCrossfade(outgoing, deck, crossfadeSeconds);
    else deck.gain.gain.value = 1;
    if (autoPlay) await this.play();
    return true;
  }

  startCrossfade(outgoing, incoming, seconds) {
    const n = 128, fadeOut = new Float32Array(n), fadeIn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const angle = (i / (n - 1)) * (Math.PI / 2);
      fadeOut[i] = Math.cos(angle); fadeIn[i] = Math.sin(angle);
    }
    const now = this.ctx.currentTime;
    outgoing.gain.gain.cancelScheduledValues(now);
    incoming.gain.gain.cancelScheduledValues(now);
    outgoing.gain.gain.setValueCurveAtTime(fadeOut, now, seconds);
    incoming.gain.gain.setValueCurveAtTime(fadeIn, now, seconds);
    this.fadingOut = outgoing;
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      if (this.fadingOut === outgoing) { this.disposeDeck(outgoing); this.fadingOut = null; }
      if (this.onCrossfadeDone) this.onCrossfadeDone();
    }, seconds * 1000 + 50);
  }
  /** Stops an in-flight crossfade immediately (a manual track change mid-fade must not leave the old track bleeding). */
  cancelCrossfade() {
    if (this.fadeTimer) { clearTimeout(this.fadeTimer); this.fadeTimer = null; }
    if (this.fadingOut) { this.disposeDeck(this.fadingOut); this.fadingOut = null; }
    if (this.deck) {
      const g = this.deck.gain.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.value = 1;
    }
  }
  get crossfading() { return !!this.fadingOut; }

  /** Switches the current deck to another stretch of the same file, without touching playback. */
  setSegment({ start, end }) {
    if (!this.deck) return;
    Object.assign(this.deck, { start, end: end === null || end === undefined ? null : end, endFired: false });
  }
  /** True when the track now playing ends exactly where `start` of the same file begins: the album's next cue track. */
  runsInto(url, start) {
    const d = this.deck;
    return !!d && !this.fadingOut && d.url === url && d.end !== null && Math.abs(d.end - start) < 0.01;
  }
  /** …and it's reached that point while playing, so the player can just carry on instead of reloading: gapless. */
  continuesInto(url, start) {
    return this.runsInto(url, start) && !this.deck.el.paused && this.deck.el.currentTime >= this.deck.end - 0.25;
  }
  /**
   * The end of a stretch isn't the end of the file, so no 'ended' event comes: this is called on the playback
   * timer and reports it — once, timed to the moment rather than the next tick when it's that close.
   */
  watchSegmentEnd() {
    const deck = this.deck;
    if (!deck || deck.end === null || deck.endFired || deck.el.paused) return;
    const left = deck.end - deck.el.currentTime;
    if (left > 0.06) return;
    deck.endFired = true;
    const fire = () => { if (this.deck === deck && this.onEnded) this.onEnded(deck); };
    if (left > 0) setTimeout(fire, left * 1000); else fire();
  }

  async play() {
    if (!this.deck) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    try { await this.deck.el.play(); } catch { /* interrupted by a newer load */ }
  }
  pause() { if (this.deck) this.deck.el.pause(); }

  /**
   * A snatch of the song from where it is now — the way a CD player sounds while it searches — faded in and out over
   * a few milliseconds so it doesn't click. Only for files: a Spotify track plays outside Web Audio.
   */
  async blip(ms = 70) {
    const d = this.deck;
    if (!d || !d.source) return;
    clearTimeout(this.blipTimer);
    const g = d.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + 0.008);
    this.blipTimer = setTimeout(() => {
      if (this.deck !== d) return;
      g.setTargetAtTime(0, this.ctx.currentTime, 0.005);
      this.blipTimer = setTimeout(() => { if (this.deck === d) d.el.pause(); }, 25);
    }, ms);
    if (d.el.paused) await this.play();
  }
  /** Done searching: quiet, and the track back at full level for when it plays on. */
  endBlips() {
    clearTimeout(this.blipTimer); this.blipTimer = null;
    const d = this.deck;
    if (!d) return;
    d.el.pause();
    d.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    d.gain.gain.value = 1;
  }
  stop() { this.cancelCrossfade(); this.disposeDeck(this.deck); this.deck = null; }
  get playing() { return !!this.deck && !this.deck.el.paused && !this.deck.el.ended; }
  /** How long sound takes from here to the speakers (seconds): the output's latency, re-read as the device changes. */
  get outputLatency() { return (this.ctx && (this.ctx.outputLatency || this.ctx.baseLatency)) || 0; }
  get position() {
    if (!this.deck) return 0;
    const p = (this.deck.el.currentTime || 0) - this.deck.start;
    return Math.max(0, this.deck.end === null ? p : Math.min(this.duration, p));
  }
  get duration() {
    if (!this.deck) return 0;
    const file = Number.isFinite(this.deck.el.duration) ? this.deck.el.duration : 0;
    const end = this.deck.end === null ? file : file ? Math.min(file, this.deck.end) : this.deck.end;
    return Math.max(0, end - this.deck.start);
  }
  seek(seconds) {
    const d = this.deck;
    if (!d) return;
    const target = Math.max(0, Math.min(this.duration || 0, seconds));
    d.el.currentTime = d.start + target;
    if (d.end === null || d.start + target < d.end - 0.06) d.endFired = false;
  }

  /**
   * Visualizer levels: the last ~90ms of output split into `bars` consecutive slices, each slice's RMS scaled by
   * 3.4 — the same broadband loudness measure the Java version computed from raw PCM.
   */
  levels(bars = 5, windowMs = 90) {
    if (!this.playing) return null;
    this.analyser.getFloatTimeDomainData(this.samples);
    const windowFrames = Math.min(this.samples.length, Math.max(bars, Math.round(this.ctx.sampleRate * windowMs / 1000)));
    const start = this.samples.length - windowFrames, per = Math.max(1, Math.floor(windowFrames / bars));
    const out = new Array(bars);
    for (let b = 0; b < bars; b++) {
      let sum = 0;
      for (let i = start + b * per, end = Math.min(this.samples.length, i + per); i < end; i++) sum += this.samples[i] * this.samples[i];
      out[b] = Math.min(1, Math.sqrt(sum / per) * 3.4);
    }
    return out;
  }

  /**
   * Visualizer Mode's spectrum: `count` bands spaced evenly in pitch (log-spaced) from 40 Hz to 16 kHz, each 0–1.
   * A band's loudness is its average power, tilted up 3 dB per octave above 1 kHz (music gets quieter towards the
   * treble, so without it the right half would barely move), mapped from −78…−18 dB.
   */
  /**
   * What's playing as a MediaStream, to record (the card's video); stopRecording() lets go of it. Hi-res (above
   * 48 kHz, played at the file's own rate) comes through a 48 kHz context: the recorder's AAC can't start at more.
   */
  recordingStream() {
    if (!this.recDest) this.recDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.recDest);
    if (this.ctx.sampleRate <= 48000) return this.recDest.stream;
    // A new one each time: one suspended and resumed for the next video records a second of it, without sound.
    this.closeRecordingContext();
    this.recCtx = new AudioContext({ sampleRate: 48000 });
    const out = this.recCtx.createMediaStreamDestination();
    this.recCtx.createMediaStreamSource(this.recDest.stream).connect(out);
    return out.stream;
  }
  stopRecording() {
    if (this.recDest) try { this.master.disconnect(this.recDest); } catch { /* not connected */ }
    this.closeRecordingContext();
  }
  closeRecordingContext() { if (this.recCtx) this.recCtx.close().catch(() => {}); this.recCtx = null; }
  /** Plays through the output device `id` ('' for the system default), without a pause. → false if it can't. */
  async setOutput(id) {
    if (!this.ctx.setSinkId) return false;
    try { await this.ctx.setSinkId(id || ''); this.outputId = id || ''; return true; } catch { return false; }
  }
  spectrum(count) {
    if (!this.playing) return null;
    const bins = this.analyser.frequencyBinCount;
    if (!this.freq || this.freq.length !== bins) this.freq = new Float32Array(bins);
    this.analyser.getFloatFrequencyData(this.freq);
    const nyquist = this.ctx.sampleRate / 2, lo = 40, hi = 16000, out = new Array(count);
    for (let b = 0; b < count; b++) {
      const f0 = lo * Math.pow(hi / lo, b / count), f1 = lo * Math.pow(hi / lo, (b + 1) / count);
      const i0 = Math.min(bins - 1, Math.floor((f0 / nyquist) * bins)), i1 = Math.min(bins, Math.max(i0 + 1, Math.ceil((f1 / nyquist) * bins)));
      let power = 0;
      for (let i = i0; i < i1; i++) power += Math.pow(10, this.freq[i] / 10);
      const db = 10 * Math.log10(power / (i1 - i0) + 1e-20) + Math.max(0, 3 * Math.log2(Math.sqrt(f0 * f1) / 1000));
      out[b] = Math.max(0, Math.min(1, (db + 78) / 60));
    }
    return out;
  }

  /** The seek bar's waveform: 220 buckets of RMS amplitude, normalized to the loudest bucket. */
  async computeWaveform(url, buckets = 220) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    // Decoded at a low sample rate — plenty for an amplitude outline, and a fraction of the memory.
    const decoded = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(buf);
    const data = decoded.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / buckets));
    const rms = new Float32Array(buckets);
    let peak = 0;
    for (let b = 0; b < buckets; b++) {
      let sum = 0, count = 0;
      for (let i = b * per, end = Math.min(data.length, i + per); i < end; i++) { sum += data[i] * data[i]; count++; }
      rms[b] = count ? Math.sqrt(sum / count) : 0;
      if (rms[b] > peak) peak = rms[b];
    }
    if (peak > 0) for (let b = 0; b < buckets; b++) rms[b] = Math.min(1, rms[b] / peak);
    return rms;
  }
}
