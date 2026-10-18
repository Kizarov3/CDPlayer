import test from 'node:test';
import assert from 'node:assert';
import { historyDays } from '../src/renderer/js/history-days.js';

test('HISTORY by day: today, yesterday, then each day; songs with no time last', () => {
  const now = new Date(2026, 9, 18, 9, 30).getTime();
  const times = {
    a: new Date(2026, 9, 18, 8, 0).getTime(), b: new Date(2026, 9, 18, 0, 5).getTime(),
    c: new Date(2026, 9, 17, 23, 50).getTime(), d: new Date(2026, 9, 12, 20, 0).getTime(),
  };
  const days = historyDays(['a', 'b', 'c', 'd', 'old'], times, now);
  assert.deepStrictEqual(days.map((g) => g.day), ['TODAY', 'YESTERDAY', new Date(2026, 9, 12).getTime(), null]);
  assert.deepStrictEqual(days.map((g) => g.items.map((i) => i.path)), [['a', 'b'], ['c'], ['d'], ['old']]);
  assert.strictEqual(days[0].items[0].at, times.a);
  assert.deepStrictEqual(historyDays([], {}, now), []);
});
