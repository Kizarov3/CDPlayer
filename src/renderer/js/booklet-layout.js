// The booklet's pure layout helpers (no DOM, so they're unit-tested): splitting content into pages, ordering pages
// onto leaves, and the EAN-13 / UPC-A barcode printed on the back cover.

/**
 * Greedy pagination: items go onto the current page while `fits(itemsOnPage)` says they still fit, then a new page
 * starts. An item too big for an empty page gets a page of its own (it's clipped rather than lost).
 */
export function paginate(items, fits) {
  const pages = [];
  let page = [];
  for (const item of items) {
    if (page.length && !fits([...page, item])) { pages.push(page); page = []; }
    page.push(item);
  }
  if (page.length) pages.push(page);
  return pages;
}

/**
 * Pages → leaves ({ front, back }) for a booklet that opens like a real one: the front cover is the first leaf's
 * front and the back cover the last leaf's back, with a blank page slipped in when the inside has an odd count.
 */
export function leavesFor(front, inside, back, blank) {
  const pages = [front, ...inside];
  if (pages.length % 2 === 0) pages.push(blank());
  pages.push(back);
  const leaves = [];
  for (let i = 0; i < pages.length; i += 2) leaves.push({ front: pages[i], back: pages[i + 1] });
  return leaves;
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map((code) => [...code].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function checkDigit(twelve) {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * A barcode tag → { digits (13), bits (95 modules, '1' = bar) }, or null when it isn't a valid EAN-13 or UPC-A
 * (a UPC-A is an EAN-13 starting with 0). A 12-digit EAN without its check digit gets one.
 */
export function ean13(code) {
  let digits = String(code || '').replace(/[\s-]/g, '');
  if (!/^\d{12,13}$/.test(digits)) return null;
  if (digits.length === 12) {
    // Either a UPC-A (its last digit checks out as a UPC) or an EAN-13 missing its check digit.
    digits = checkDigit(`0${digits.slice(0, 11)}`) === Number(digits[11]) ? `0${digits}` : `${digits}${checkDigit(digits)}`;
  }
  if (checkDigit(digits.slice(0, 12)) !== Number(digits[12])) return null;
  const parity = PARITY[Number(digits[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[Number(digits[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[Number(digits[i])];
  bits += '101';
  return { digits, bits };
}
