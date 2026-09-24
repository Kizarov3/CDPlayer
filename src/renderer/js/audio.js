// Playback engine. Each track plays from its own "deck" (an <audio> element streaming from the cdp:// media
// protocol, so seeking is instant and memory stays flat), routed through one shared Web Audio graph:
//
//   deck gain (crossfade) ─┐
//   deck gain (crossfade) ─┴→ mono downmix → 10-band EQ → analyser (visualizer/beats) → volume → speakers
//
// That graph replaces the Java app's hand-written PCM pump: gain, mono, EQ and crossfade are all native nodes.

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export class AudioEngine {
  constructor() {
    const ctx = this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.input = ctx.createGain();
    this.eq = EQ_FREQUENCIES.map((f) => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.2; b.gain.value = 0; // same RBJ peaking curve, Q 1.2, as the Java EQ
      return b;
    });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0;
    this.master = ctx.createGain();
    let node = this.input;
    for (const b of this.eq) { node.connect(b); node = b; }
    node.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(ctx.destination);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.deck = null;          // the current track
    this.fadingOut = null;     // the previous track, while a crossfade is in progress
    this.fadeTimer = null;
    this.onEnded = null;
  }

  setVolume(v) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01); }
  setMono(on) {
    // A 1-channel "explicit" node makes Web Audio sum L+R (×0.5 each) — exactly the Java version's (L+R)/2 —
    // and the speakers then get that mono signal on both sides.
    this.input.channelCount = on ? 1 : 2;
    this.input.channelCountMode = on ? 'explicit' : 'max';
    this.input.channelInterpretation = 'speakers';
  }
  setEq(gains) { gains.forEach((g, i) => this.eq[i].gain.setTargetAtTime(g, this.ctx.currentTime, 0.02)); }

  createDeck(url) {
    const el = new Audio();
    el.preload = 'auto';
    el.src = url;
    const source = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    source.connect(gain);
    gain.connect(this.input);
    const deck = { el, source, gain, url };
    el.addEventListener('ended', () => { if (this.onEnded) this.onEnded(deck); });
    return deck;
  }
  disposeDeck(deck) {
    if (!deck) return;
    try { deck.el.pause(); } catch { /* ignore */ }
    deck.el.removeAttribute('src');
    deck.el.load();
    deck.source.disconnect();
    deck.gain.disconnect();
  }

  /**
   * Loads a track. With crossfadeSeconds > 0 and something currently playing, the old deck keeps playing and
   * fades out along an equal-power (cos/sin) curve while the new one fades in; otherwise the old deck stops now.
   * Resolves once the new track's duration is known; rejects if it can't be decoded.
   */
  async load(url, { autoPlay = true, crossfadeSeconds = 0 } = {}) {
    this.cancelCrossfade();
    const outgoing = this.deck;
    const doCrossfade = crossfadeSeconds > 0 && outgoing && !outgoing.el.paused;
    if (!doCrossfade) { this.disposeDeck(outgoing); this.deck = null; }
    const deck = this.createDeck(url);
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

  async play() {
    if (!this.deck) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    try { await this.deck.el.play(); } catch { /* interrupted by a newer load */ }
  }
  pause() { if (this.deck) this.deck.el.pause(); }
  stop() { this.cancelCrossfade(); this.disposeDeck(this.deck); this.deck = null; }
  get playing() { return !!this.deck && !this.deck.el.paused && !this.deck.el.ended; }
  get position() { return this.deck ? this.deck.el.currentTime || 0 : 0; }
  get duration() { const d = this.deck ? this.deck.el.duration : 0; return Number.isFinite(d) ? d : 0; }
  seek(seconds) { if (this.deck) this.deck.el.currentTime = Math.max(0, Math.min(this.duration || 0, seconds)); }

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
