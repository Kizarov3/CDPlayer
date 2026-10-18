// HISTORY by day: the songs played (newest first, each once, at its last play) under TODAY, YESTERDAY or their day —
// the day as the start of it, in local time. Songs played before CDPlayer kept when (no time) go last, under EARLIER.

const dayOf = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** → [{ day: 'TODAY' | 'YESTERDAY' | <start of that day, ms> | null, items: [{ path, at }] }] */
export function historyDays(paths, times, now = Date.now()) {
  const today = dayOf(now), yesterday = dayOf(today - 12 * 3600e3);
  const groups = [], earlier = [];
  for (const path of paths) {
    const at = times[path] || null;
    if (!at) { earlier.push({ path, at }); continue; }
    const start = dayOf(at), day = start === today ? 'TODAY' : start === yesterday ? 'YESTERDAY' : start;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push({ path, at }); else groups.push({ day, items: [{ path, at }] });
  }
  if (earlier.length) groups.push({ day: null, items: earlier });
  return groups;
}
