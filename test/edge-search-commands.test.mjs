// test/edge-search-commands.test.mjs — what the search finds, with punctuation, ё/е, accents and nothing typed
import test from 'node:test';
import assert from 'node:assert';
import { matchesName, findCommands } from '../src/renderer/js/search-commands.js';

const run = () => {};

test('punctuation typed or in the name is only a gap between words', () => {
  assert.ok(matchesName('...or', ['…OR AT THE END OF THE DISC']));
  assert.ok(matchesName('end, of the disc!', ['…OR AT THE END OF THE DISC']));
  assert.ok(matchesName('art & lyr', ['SAVE FOUND ART & LYRICS']));
  assert.ok(matchesName('pause', ['PLAY/PAUSE']));
  assert.strictEqual(findCommands('hi-res', [])[0].row, 'QUALITY');
  assert.ok(!matchesName('!!', ['SPATIAL AUDIO']), 'no word typed');
  assert.ok(!matchesName('a.', ['ANIMATIONS']), 'one letter');
  assert.ok(!matchesName('spatial nirvana', ['SPATIAL AUDIO']), 'every word typed');
});

test('ё is е, either way round, and in any case', () => {
  assert.ok(matchesName('ОБЪЁМ', ['объемный']));
  assert.ok(matchesName('объем', ['ОБЪЁМНЫЙ']));
  assert.ok(matchesName('объём', ['объёмный']), 'ё typed as е and its two dots');
  assert.strictEqual(findCommands('объём', [])[0].row, 'SPATIAL AUDIO');
  assert.strictEqual(findCommands('громкость', [])[0].row, 'SOUND CHECK');
});

test('accents or not, but never from inside a word', () => {
  assert.ok(matchesName('cafe', ['Café del Mar']));
  assert.ok(matchesName('CAFÉ', ['cafe']));
  assert.ok(matchesName('motley', ['Mötley Crüe']));
  assert.ok(!matchesName('fe', ['Café']));
  assert.strictEqual(findCommands('3d', [])[0].row, 'SPATIAL AUDIO', 'digits are a word too');
});

test('nothing typed finds nothing; actions first, four at most however many match', () => {
  const actions = ['DISC SKIP', 'DISC ONE', 'DISC TWO', 'DISC THREE', 'DISC FOUR'].map((label) => ({ label, run }));
  assert.deepStrictEqual(findCommands('', actions), []);
  assert.deepStrictEqual(findCommands('   ', actions), []);
  const found = findCommands('disc', actions);
  assert.strictEqual(found.length, 4);
  assert.ok(found.every((c) => c.kind === 'action'));
  const one = findCommands('wear', [{ label: 'EJECT', run }]);
  assert.deepStrictEqual(one.map((c) => [c.kind, c.row]), [['setting', 'DISC WEAR']], 'an action with no other words is fine');
});
