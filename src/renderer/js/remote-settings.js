// The desktop's side of the phone remote, the words and counts worked out apart from the drawing: Settings → PHONE
// REMOTE's phones line, the PHONE tag's tooltip, and when PHONE CONNECTED is said.
import { t } from './i18n.js';

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// main names a phone iPhone, Android (names, the same in every language) or Browser (a word: translated here, so it
// follows the language).
const phoneName = (name) => (name === 'Browser' ? t('Browser') : name);

/** "iPhone · since 23:10" for a connected phone { name, since }. */
export const phoneLine = (phone) => t('{name} · since {time}', { name: phoneName(phone.name), time: clock(phone.since) });

/** The PHONE tag's tooltip: the phones' names, one repeated as "iPhone ×2". */
export function phoneTagTitle(phones) {
  const counts = new Map();
  for (const p of phones) counts.set(phoneName(p.name), (counts.get(phoneName(p.name)) || 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ');
}

/** PHONE CONNECTED is said once, when the count goes from none to some (`before` null: nothing heard yet). */
export const phoneJoined = (before, now) => before === 0 && now > 0;

/** The address as IP:port, to type by hand. */
export const addressWords = (status) => (status && status.address ? `${status.address}:${status.port}` : '');

/** What went wrong, in words ('network': no home-network address to offer; 'port': refused). */
export const errorWords = (error) => (error === 'network' ? t('NO HOME NETWORK FOUND · CONNECT THIS PC TO WI-FI OR ETHERNET')
  : error === 'port' ? t('THE PORT WAS REFUSED · TRY TURNING IT OFF AND ON')
  : '');
