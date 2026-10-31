import test from 'node:test';
import assert from 'node:assert';
import { yearsToday, todaySticker, todayLine, pullToday } from '../src/renderer/js/on-this-day.js';

const now = new Date(2026, 4, 21, 15).getTime(); // 21 May 2026, local time

test('an album out on this day some years ago: how many', () => {
  assert.strictEqual(yearsToday('1997-05-21', now), 29);
  assert.strictEqual(yearsToday('1997-05-21T00:00:00Z', now), 29);
  assert.strictEqual(yearsToday('1997-05-22', now), 0);
  assert.strictEqual(yearsToday('1997', now), 0, 'a year alone has no day');
  assert.strictEqual(yearsToday('2026-05-21', now), 0, 'out today: not a year yet');
  assert.strictEqual(yearsToday(null, now), 0);
});

test('the sticker: its birthday first, then a year ago today', () => {
  assert.deepStrictEqual(todaySticker({ released: '1997-05-21', playedYearsAgo: 1 }, now), { kind: 'released', years: 29, label: '29 YEARS TODAY' });
  assert.strictEqual(todaySticker({ released: '2025-05-21' }, now).label, '1 YEAR TODAY');
  assert.deepStrictEqual(todaySticker({ playedYearsAgo: 1 }, now), { kind: 'played', years: 1, label: 'A YEAR AGO TODAY' });
  assert.strictEqual(todaySticker({ playedYearsAgo: 3 }, now).label, '3 YEARS AGO TODAY');
  assert.strictEqual(todaySticker({ released: '1990-01-01' }, now), null);
});

test('the shelf says it as it opens, naming one that came out today first', () => {
  const albums = [{ title: 'Heard', playedYearsAgo: 2 }, { title: 'OK Computer', released: '1997-05-21' }, { title: 'Other' }];
  assert.strictEqual(todayLine(albums, now), 'ON THIS DAY: OK COMPUTER CAME OUT 29 YEARS AGO · +1 MORE');
  assert.strictEqual(todayLine([{ title: 'Heard', playedYearsAgo: 1 }], now), 'ON THIS DAY: YOU PLAYED HEARD A YEAR AGO');
  assert.strictEqual(todayLine([{ title: 'Other' }], now), null);
});

test('PULL ONE leans towards today’s, half the time', () => {
  const today = { title: 'T', released: '1997-05-21' }, albums = [{ title: 'A' }, today, { title: 'B' }];
  assert.strictEqual(pullToday(albums, now, () => 0.1), today);
  assert.strictEqual(pullToday(albums, now, () => 0.9), null);
  assert.strictEqual(pullToday([{ title: 'A' }], now, () => 0), null);
});
