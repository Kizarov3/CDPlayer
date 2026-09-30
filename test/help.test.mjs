import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { GUIDE, FAQ, SHORTCUTS } from '../src/renderer/js/help.js';

test('the first-run guide: five short steps', () => {
  assert.strictEqual(GUIDE.length, 5);
  for (const step of GUIDE) {
    assert.ok(step.title && step.title === step.title.toUpperCase(), step.title);
    assert.ok(step.lines.length >= 2 && step.lines.length <= 4, step.title);
  }
});

test('the FAQ: questions a first-time user asks, each answered', () => {
  assert.ok(FAQ.length >= 7);
  for (const { q, a } of FAQ) { assert.match(q, /\?$/); assert.ok(a.length > 20, q); }
  const all = FAQ.map((f) => f.q.toLowerCase()).join('\n');
  for (const topic of ['open', 'cover', 'data', 'spotify', 'folder', 'missing', 'internet']) assert.ok(all.includes(topic), topic);
});

test('the shortcuts panel lists the same keys as the README', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const table = readme.slice(readme.indexOf('## Keyboard shortcuts'), readme.indexOf('## Coming from'));
  const inReadme = [...table.matchAll(/^\| (.+?) \|/gm)].map((m) => m[1]).filter((k) => k !== 'Key' && !/^-+$/.test(k));
  assert.deepStrictEqual(SHORTCUTS.map(([keys]) => keys), inReadme);
});
