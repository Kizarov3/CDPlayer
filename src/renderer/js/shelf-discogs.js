// Discogs on the shelf (main/discogs.js finds it): an album's pressing and its market in a line each, money in the
// chosen currency, the bands SORT: PRICE divides the shelf into, which albums are rare, and what the shelf is worth.
import { t, locale } from './i18n.js';

const numberLocale = () => (locale === 'en' ? 'en-US' : locale);
const count = (n) => new Intl.NumberFormat(numberLocale()).format(n);
/** An amount as the shelf shows it: whole from 10 up, with cents below — or always with cents, as a till prints it. */
export function money(value, currency, { cents = false } = {}) {
  const whole = currency === 'JPY' || (!cents && value >= 10);
  return new Intl.NumberFormat(numberLocale(), { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(value);
}
export const pressingLine = (info) => [info.label, info.catno, info.country, info.year, info.formats].filter(Boolean).join(' · ');
export function marketLine(entry) {
  const p = entry.price, i = entry.info || {};
  const sale = p && p.lowest !== null && p.lowest !== undefined ? t('from {price} · {n} for sale', { price: money(p.lowest, p.currency), n: p.forSale }) : t('not for sale');
  return [sale, t('{have} have · {want} want', { have: count(i.have || 0), want: count(i.want || 0) })].join(' · ');
}
const scale = (currency) => (currency === 'JPY' ? 150 : 1);
export function priceBand(value, currency) {
  if (value === null || value === undefined) return t('NO PRICE');
  const k = scale(currency), m = (v) => money(v * k, currency);
  if (value >= 50 * k) return `${m(50)}+`;
  if (value >= 20 * k) return `${m(20)}–${m(50)}`;
  if (value >= 10 * k) return `${m(10)}–${m(20)}`;
  return t('UNDER {price}', { price: m(10) });
}
export function isRare(entry) {
  if (!entry || !entry.releaseId) return false;
  const p = entry.price, i = entry.info || {};
  const dear = p && p.lowest !== null && p.lowest !== undefined && p.lowest >= (p.currency === 'JPY' ? 6000 : 40);
  return !!dear || ((i.have || 0) >= 10 && (i.want || 0) > (i.have || 0));
}
export function shelfTotal(entries, currency) {
  let value = 0, n = 0;
  for (const e of entries) if (e && e.price && e.price.currency === currency && typeof e.price.lowest === 'number') { value += e.price.lowest; n++; }
  return { value: Math.round(value * 100) / 100, count: n };
}
