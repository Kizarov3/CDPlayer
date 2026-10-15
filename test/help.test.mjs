import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { TOUR, FAQ, SHORTCUTS } from '../src/renderer/js/help.js';

test('the guide points at what\'s really on the window, a short title and a sentence or two each', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  assert.ok(TOUR.length >= 7 && TOUR.length <= 10);
  for (const step of TOUR) {
    assert.ok(step.title && step.title === step.title.toUpperCase(), step.title);
    assert.ok(step.text.length > 20 && step.text.length < 260, step.title);
    for (const sel of step.targets) assert.ok(html.includes(`id="${sel.slice(1).split(' ')[0]}"`), `${step.title}: ${sel}`);
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
