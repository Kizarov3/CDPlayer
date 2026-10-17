// The phone remote, as the player's page sees it: what the phone is told (the state, without a file path in it) and
// which of its commands are for something that has gone since it was sent. app.js does the playing.

const whole = (n, below) => Number.isInteger(n) && n >= 0 && n < below;

// Something in the words that names a place on disk: an absolute path (/x…, ~/…, C:\… or C:/…, \\server\…) starting a
// word, or a file:// address. "QUEUE 3 / 12", "3/12" and "AC/DC" aren't.
const PATH_IN_WORDS = /(^|[\s(“"'«‘[])(\/[^\s/]|~[\\/])|\b[A-Za-z]:[\\/]|\\\\[^\s\\]|file:\/\//i;
/** The status line for the phone: never one naming a path (RIPPED TO … · <folder>) — then `fallback`, if it doesn't. */
export function phoneStatus(words, fallback = '') {
  if (words && !PATH_IN_WORDS.test(words)) return words;
  return fallback && !PATH_IN_WORDS.test(fallback) ? fallback : '';
}

/**
 * The phone's full state. `state`: the app's (queue, index, nextUp, shuffle, repeat, changerMode, volume,
 * volumeBeforeMute); `player`: { playing, position, duration }; `track`: { title, artist, album, coverKey };
 * `details(path)` → { title, duration } as the desktop's queue shows the song; `changerView`: what the carousel was
 * last drawn from (changer mode); `slotCover(firstPath)` → a small data URL or null. Paths are read, never passed on:
 * a `statusWord` naming one gives way to `statusFallback` (what the player is doing), or to nothing.
 */
export function snapshot({ state, player, track, details, changerView, slotCover = () => null, statusWord, statusFallback = '', rev, canUndo = false }) {
  const s = {
    rev, playing: !!player.playing, position: player.position || 0, duration: player.duration || 0,
    volume: state.volume, muted: state.volumeBeforeMute >= 0,
    shuffle: state.shuffle, repeat: state.repeat, changerMode: !!state.changerMode,
    status: phoneStatus(statusWord, statusFallback), canUndo: !!canUndo,
    track: { title: track.title || '', artist: track.artist || null, album: track.album || null, coverKey: track.coverKey || null },
  };
  if (!state.changerMode) {
    const up = state.nextUp;
    s.queue = state.queue.map((p, i) => {
      const d = details(p) || {};
      return { title: d.title || '', duration: d.duration || 0, next: !!up && i > state.index && i >= up.start && i < up.end };
    });
    s.index = state.queue.length ? state.index : -1;
    return s;
  }
  const view = changerView || { slots: [], playingSlot: -1, tracks: [] };
  s.changer = {
    slots: Array.from({ length: 5 }, (_, k) => {
      const d = view.slots[k];
      return d ? { title: d.title || '', artist: d.artist || null, cover: slotCover(d.firstPath) || null, done: !!d.done, next: !!d.next } : null;
    }),
    playing: Number.isInteger(view.playingSlot) ? view.playingSlot : -1,
    tracks: (view.tracks || []).map((tr) => ({ index: tr.index, title: tr.title || '', duration: tr.duration || 0, current: !!tr.current })),
  };
  return s;
}

/** A full changer's answer to the phone: the discs in it, to pick the one that goes back (not the one playing). */
export function fullSlots(changerView, slotCover = () => null) {
  const out = [];
  (changerView ? changerView.slots : []).forEach((d, slot) => {
    if (d) out.push({ slot, title: d.title || '', artist: d.artist || null, cover: slotCover(d.firstPath) || null, playing: slot === changerView.playingSlot });
  });
  return out;
}

/** The phone's command carries the music as it saw it (`rev`); another rev means the music has changed since. */
export const isStale = (cmd, rev) => cmd.rev !== undefined && cmd.rev !== rev;

/**
 * → null, or why the command can't be carried out now: 'gone' (a queue row or slot that isn't there any more, an
 * album with no songs), 'mode' (a slot in queue mode, removing or moving in the changer), 'playing' (a disc to go
 * into the slot playing). `at`: { queueLength, slots, changerMode, playingSlot }.
 */
export function commandError(cmd, { queueLength, slots, changerMode, playingSlot = -1 }) {
  const v = cmd.value;
  switch (cmd.action) {
    case 'playIndex': return whole(v, queueLength) ? null : 'gone';
    case 'remove': return changerMode ? 'mode' : whole(v, queueLength) ? null : 'gone';
    case 'move': return changerMode ? 'mode' : v && whole(v.from, queueLength) && whole(v.to, queueLength) ? null : 'gone';
    case 'playSlot': return !changerMode ? 'mode' : slots && slots[v] ? null : 'gone';
    case 'album':
      if (!v || !v.album || !Array.isArray(v.album.paths) || !v.album.paths.length) return 'gone';
      return changerMode && v.slot !== undefined && v.slot === playingSlot ? 'playing' : null;
    default: return null;
  }
}

/** What the phone's indexes point into: the songs in order, the mode, and which discs are where. */
export function musicKey({ queue, changerMode, slots }) {
  const discs = changerMode ? (slots || []).map((d) => (d ? `${d.id}:${d.start}-${d.end}` : '-')).join('|') : '';
  return `${changerMode ? 'C' : 'Q'}\n${discs}\n${queue.join('\n')}`;
}
