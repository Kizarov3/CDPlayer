// Settings → QUALITY, as in Apple Music: HIGH plays everything at the system's rate (as CDPlayer always did);
// LOSSLESS and HI-RES LOSSLESS play each song at its own sample rate, up to 48 and 192 kHz, with the output device
// switched to match (src/main/output-rate.js). These are the pure rules: which rate, and what the badge says.
import { t } from './i18n.js';

export const LEVELS = ['HIGH', 'LOSSLESS', 'HIRES'];
const CAP = { LOSSLESS: 48000, HIRES: 192000 };

/** '96 KHZ', '44.1 KHZ'. */
export function khz(hz) {
  const k = hz / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} KHZ`;
}

/** A level's name for the Settings button, or (long) for its menu. */
export function levelName(level, long = false) {
  if (level === 'LOSSLESS') return long ? t('LOSSLESS · UP TO 24-BIT / 48 KHZ') : t('LOSSLESS');
  if (level === 'HIRES') return long ? t('HI-RES LOSSLESS · UP TO 24-BIT / 192 KHZ') : t('HI-RES LOSSLESS');
  return t('HIGH');
}

/** `rate`, or — above `cap` — the highest rate of its family (44.1 kHz ×2ⁿ or 48 kHz ×2ⁿ) that fits: a whole ratio. */
export function capRate(rate, cap) {
  if (rate <= cap) return rate;
  let r = rate % 11025 === 0 ? 44100 : 48000;
  while (r * 2 <= cap) r *= 2;
  return r;
}

/** The rate a song should play at under `level`; null leaves the engine as it is (HIGH, or the rate isn't known). */
export function targetRate(level, fileRate) {
  if (!CAP[level] || !(fileRate > 0)) return null;
  return capRate(fileRate, CAP[level]);
}

/** '◈ LOSSLESS' / '◈ HI-RES LOSSLESS' for a lossless file under LOSSLESS or HI-RES, by the rate it's played at. */
export function badgeLabel(format, level) {
  if (!format || !format.lossless || !CAP[level]) return null;
  const aimed = targetRate(level, format.sampleRate);
  if (!aimed) return null;
  return aimed > 48000 && (format.bitsPerSample || 0) >= 24 ? `◈ ${t('HI-RES LOSSLESS')}` : `◈ ${t('LOSSLESS')}`;
}

/** True when the song reaches the output exactly as it is in the file. */
export function badgeExact({ fileRate, aimed, deviceRate, bluetooth }) {
  return !bluetooth && deviceRate === aimed && aimed === fileRate;
}

/** The badge's tooltip: what reaches the output, and why when it isn't the file's own rate. */
export function badgeText({ fileRate, aimed, deviceRate, switched, bluetooth, eq, mono }) {
  let line;
  if (bluetooth) line = t('BLUETOOTH: QUALITY IS LIMITED BY THE WIRELESS CODEC');
  else if (deviceRate === aimed) {
    line = aimed < fileRate
      ? t('OUTPUT: {rate} — LOWERED FROM {file} (HI-RES LOSSLESS PLAYS IT IN FULL)', { rate: khz(aimed), file: khz(fileRate) })
      : t('OUTPUT: {rate} — NOT RESAMPLED', { rate: khz(aimed) });
  } else if (switched) line = t("OUTPUT: {rate} — RESAMPLED (THE DEVICE CAN'T PLAY {file})", { rate: khz(deviceRate), file: khz(aimed) });
  else line = t('OUTPUT: {rate} — RESAMPLED (SET THE RATE IN YOUR SOUND SETTINGS)', { rate: khz(deviceRate) });
  return eq || mono ? `${line}\n${t('THE EQUALIZER OR MONO CHANGES THE SOUND')}` : line;
}
