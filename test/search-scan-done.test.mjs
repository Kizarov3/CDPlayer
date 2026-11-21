import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

// The search said SCANNING YOUR MUSIC FOLDER… for ever: the line ending the scan had slid into a comment.
test('the search\'s library scan ends in code, not in a comment', () => {
  const src = fs.readFileSync('src/renderer/js/panels.js', 'utf8');
  const fn = src.slice(src.indexOf('async function startLibraryScan('), src.indexOf('export function showSearch('));
  const code = fn.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.match(code, /search\.scanning = false;/);
});
