// Sleep timer → END OF DISC: whether the song playing is the disc's last before sleep, so playback stops after it
// instead of going on into the next. A disc is a slot of the changer — or, in the queue, the folder its songs are in
// (CD1 and CD2 of a set are two discs, as in a real player); a Spotify queue is one disc, and so is a shuffled queue
// (its songs come from anywhere). Nothing next, the same song again (REPEAT TRACK) or the queue wrapping round to its
// start (REPEAT ALL / DISC, not shuffled) end it too.

const folderOf = (p) => (/^spotify:/.test(p) ? 'spotify:' : String(p || '').replace(/#\d{1,3}$/, '').replace(/[\\/][^\\/]*$/, ''));

export function discEndsAfter({ current, next, currentIndex, nextIndex, currentSlot = null, nextSlot = null, repeatTrack = false, shuffled = false }) {
  if (repeatTrack || nextIndex < 0 || !next) return true;
  if (!shuffled && nextIndex <= currentIndex) return true;
  if (currentSlot !== null || nextSlot !== null) return currentSlot !== nextSlot;
  if (shuffled) return false;
  return folderOf(current) !== folderOf(next);
}
