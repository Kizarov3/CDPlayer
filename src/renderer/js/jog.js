// Turning the disc by hand, like a DJ's jog wheel: how far the song moves for how far — and how fast — the disc
// is turned, and how a disc let go with a spin coasts to a stop. Clockwise (the way it plays) is forward.

export const SLOW_SECONDS_PER_TURN = 2.2;  // turned gently, a turn moves about what a turn of the spinning disc plays
export const FAST_SECONDS_PER_TURN = 30;   // turned hard, up to half a minute a turn
const EASY_TURNS_PER_SECOND = 0.7;         // up to this, the slow rate
const FRICTION_MS = 320;                   // a flung disc loses ~63% of its spin in this long
const STOPPED = 0.0008;                    // rad/ms: slower than this, a coasting disc has stopped
const TAU = Math.PI * 2;

/** From one angle to the next, the short way round (radians, −π…π). */
export function angleDelta(from, to) {
  const d = to - from;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** The seconds to move the song for the disc turned by `dAngle` radians over `dtMs`. */
export function jogSeconds(dAngle, dtMs) {
  if (!dAngle) return 0;
  const turns = dAngle / TAU;
  const turnsPerSecond = (Math.abs(turns) / Math.max(1, dtMs)) * 1000;
  const perTurn = Math.min(FAST_SECONDS_PER_TURN, SLOW_SECONDS_PER_TURN * Math.max(1, (turnsPerSecond / EASY_TURNS_PER_SECOND) ** 1.6));
  return turns * perTurn;
}

/** A coasting disc's spin (rad/ms) after another `dtMs`; 0 once it has as good as stopped. */
export function coast(velocity, dtMs) {
  const v = velocity * Math.exp(-dtMs / FRICTION_MS);
  return Math.abs(v) < STOPPED ? 0 : v;
}

/**
 * The spin (rad/ms) a disc is let go with at `now`, from the hand's recent readings ([{ t, a }], `a` the angle turned
 * so far): over its last ~80 ms, or none if the hand had stopped before letting go.
 */
export function releaseVelocity(samples, now) {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > 60) return 0;
  const first = samples.find((s) => last.t - s.t <= 80);
  return last.t > first.t ? (last.a - first.a) / (last.t - first.t) : 0;
}
