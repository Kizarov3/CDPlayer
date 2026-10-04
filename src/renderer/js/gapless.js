// Gapless playback: whether the queue's next track can be started on a second deck the moment this one ends. The
// rate rule is applyQuality's (app.js): a song that would rebuild the audio context at another rate can't follow
// seamlessly. Pure, for node --test.
import { targetRate } from './quality.js';

export const PREPARE_SECONDS = 10; // the next track is loaded this long before the current one ends

/** Whether the next song plays at the rate the engine is at now — so nothing has to be rebuilt between them. */
export function rateFits({ quality, fileRate, customRate, rateInfo, engineRate }) {
  if (quality === 'HIGH') return !customRate;
  const aimed = targetRate(quality, fileRate);
  if (!aimed) return true; // no rate known: applyQuality changes nothing
  return !!rateInfo && rateInfo.aimed === aimed && engineRate === (rateInfo.switched ? rateInfo.deviceRate : aimed);
}

/** The queue's next track as { url, segment } to prepare, or null when it can't follow without a gap. */
export function seamlessNext({ crossfade, repeat, spotify, nextPath, nextDetails, isCdTrack, sameFileCue, quality, customRate, rateInfo, engineRate, mediaUrl }) {
  if (crossfade > 0 || repeat === 'ONE' || spotify || isCdTrack || sameFileCue) return null;
  if (!nextPath || /^spotify:/.test(nextPath) || !nextDetails) return null;
  const fileRate = nextDetails.format && nextDetails.format.sampleRate;
  if (!rateFits({ quality, fileRate, customRate, rateInfo, engineRate })) return null;
  const cue = nextDetails.cue;
  return cue ? { url: mediaUrl(cue.file), segment: { start: cue.start, end: cue.end } } : { url: mediaUrl(nextPath), segment: null };
}
