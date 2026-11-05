// Which of an album's disc photos to show: its releases' scans differ a lot (350 px to 1200), so the biggest of them,
// not whichever answered first.

const GOOD_WIDTH = 1000; // (past this, a disc in the player looks no sharper: the release ranked first wins)

// A photo of several discs side by side shows each at a fraction of its size, so it counts for half.
const worth = (p) => Math.min(p.width, GOOD_WIDTH) * (p.multi ? 0.5 : 1);

/** The best of photos { art, width, multi, order (its rank among the releases) }. → one of them, or null. */
function pickDiscPhoto(found) {
  let best = null;
  for (const p of found) if (!best || worth(p) > worth(best) || (worth(p) === worth(best) && p.order < best.order)) best = p;
  return best;
}

/**
 * Asks all of `tasks` ({ ask: () => Promise<{ art, width } | null>, multi }, best-ranked first) at once. Ends as soon as
 * one disc is big enough, when all have answered, or `wait` ms after the first photo arrives. → the best | null.
 */
function bestDiscPhoto(tasks, { wait = 8000 } = {}) {
  return new Promise((resolve) => {
    const found = [];
    let left = tasks.length, timer = null;
    const finish = () => { clearTimeout(timer); resolve(pickDiscPhoto(found)); };
    if (!left) { finish(); return; }
    tasks.forEach((task, order) => {
      Promise.resolve().then(task.ask).then((photo) => {
        if (!photo) return;
        found.push({ ...photo, multi: !!task.multi, order });
        if (photo.width >= GOOD_WIDTH && !task.multi) finish();
        else if (!timer) timer = setTimeout(finish, wait);
      }).catch(() => {}).finally(() => { if (--left === 0) finish(); });
    });
  });
}

module.exports = { bestDiscPhoto, pickDiscPhoto, GOOD_WIDTH };
