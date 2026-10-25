// Each output keeps its own sound: the EQ, mono and spatial audio set while playing on headphones come back when they're
// plugged in again, and the speakers' when they're the output again. Kept by the device's name — the one the sound
// reaches, so with OUTPUT = SYSTEM DEFAULT it's whatever the system plays through now.

/** The sound settings an output keeps. */
export const soundOf = (state) => ({ eq: state.eq.slice(), mono: !!state.mono, spatial: !!state.spatial, spatialAmount: state.spatialAmount });
export const sameSound = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The output playing, as its sound is kept by: its name in full ("Headphones (USB)" and "Headphones (Realtek)" are two)
 * — from enumerateDevices()'s list and the engine's output id ('' for the default) — or null.
 */
export function deviceKey(devices, outputId) {
  const outs = devices.filter((d) => d.kind === 'audiooutput' && d.label);
  const device = (outputId && outs.find((d) => d.deviceId === outputId)) || outs.find((d) => d.deviceId === 'default');
  return device ? device.label.replace(/^Default - /, '') : null;
}
