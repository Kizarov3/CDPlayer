// Where the sound goes (Settings → OUTPUT): the system's default output, or one the user picked — speakers,
// headphones, AirPods. A picked one that isn't there (unplugged, AirPods in their case) falls back to the default,
// and is found again when it comes back: by its id, or by its name, since a Bluetooth device can come back with a new id.
import { t } from './i18n.js';

/** The output to play through: the saved one's device id, or '' for the system default. saved: { id, label } | null. */
export function pickOutput(devices, saved) {
  if (!saved) return '';
  const real = devices.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const found = real.find((d) => d.deviceId === saved.id) || real.find((d) => d.label && d.label === saved.label);
  return found ? found.deviceId : '';
}

/** An output's name for the button: 'MACBOOK AIR SPEAKERS', or 'SYSTEM DEFAULT' for none. */
export function outputName(device) {
  if (!device) return t('SYSTEM DEFAULT');
  return device.label.replace(/^Default - /, '').replace(/\s*\([^)]*\)\s*$/, '').toUpperCase();
}
