// How much the player draws. With a graphics card, the window at full frame rate and the cover's glow a 48×48 crop the
// card stretches to the window for nothing. Without one (a virtual machine's screen: Chromium compositing on the
// processor, gpu-status.js), every frame of the spinning disc is put together pixel by pixel — so 30 frames a second, as
// in the background, and the glow stretched once to the window's size instead of again on every frame. Pure.

export const BACKGROUND_FRAME_MS = 1000 / 30;
// Behind other windows with the music paused, nothing is watched and nothing plays: 10 frames a second is enough for
// the disc to come to rest and the theme to keep drifting, at a third of the cost.
export const RESTING_FRAME_MS = 1000 / 10;
// Without a graphics card and the music paused, the disc only turns by hand and catches the light: 15 is enough.
export const SOFTWARE_PAUSED_FRAME_MS = 1000 / 15;
export const MAX_GLOW_SIDE = 2560; // the glow is a soft blur: more pixels than this show nothing more

/** The least time between drawn frames (ms): 0 for every frame the display gives. `playing`: music is playing. */
export function frameGap({ watched, software, playing = true }) {
  if (!watched && !playing) return RESTING_FRAME_MS;
  if (software && !playing) return SOFTWARE_PAUSED_FRAME_MS;
  return watched && !software ? 0 : BACKGROUND_FRAME_MS;
}

/** The cover glow's canvas, in pixels, for a window of width × height CSS px. */
export function glowSize({ software, width, height, dpr }) {
  if (!software || !(width > 0) || !(height > 0)) return { width: 48, height: 48 };
  const scale = Math.min(dpr || 1, MAX_GLOW_SIDE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
