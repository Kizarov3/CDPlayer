// How a disc tray moves, as a real one does: the latch lets go (it draws in a hair), the motor runs it out at one speed
// after a moment's taking up, and it hits its stop, going a little past and sprung back. Closing is the same backwards.
// `t`: 0 shut … 1 out, as the motor's run goes.
const LATCH = 0.1, STOP = 0.9, DRAWS_IN = 0.02, PAST = 0.018, TAKES_UP = 0.15;

export const TRAY_TRAVEL = 0.2, TRAY_GROW = 0.04; // how far out, of the disc's size; how much nearer it comes

/** Where the tray is: 0 shut … 1 out (a hair under 0 on the latch, a hair over 1 at the stop). */
export function traySlide(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < LATCH) return -DRAWS_IN * Math.sin((Math.PI * t) / LATCH);
  if (t < STOP) {
    const k = (t - LATCH) / (STOP - LATCH);
    const run = k < TAKES_UP ? (k * k) / (2 * TAKES_UP * (1 - TAKES_UP / 2)) : (k - TAKES_UP / 2) / (1 - TAKES_UP / 2);
    return (1 + PAST) * run;
  }
  return 1 + PAST * (1 - (t - STOP) / (1 - STOP));
}

/** How much the tray and the opening it leaves can be seen: there as soon as it's moving, not faded in along the way. */
export const trayReveal = (t) => Math.max(0, Math.min(1, t / LATCH));
