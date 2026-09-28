'use strict';
// The page's Content-Security-Policy lets in Spotify's player script and frame, and nothing wider.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

test("the Web Playback SDK's script and frame are allowed", () => {
  assert.deepStrictEqual(directives['script-src'], ["'self'", 'https://sdk.scdn.co']);
  assert.deepStrictEqual(directives['frame-src'], ['https://sdk.scdn.co']);
});
test('nothing broader: no wildcards, no inline script, connections stay local', () => {
  assert.ok(!csp.includes('*'), csp);
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
  assert.deepStrictEqual(directives['connect-src'], ["'self'"]);
});
