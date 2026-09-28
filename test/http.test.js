'use strict';
// Why a web request got no answer, for "COULDN'T REACH …" messages.
const test = require('node:test');
const assert = require('node:assert');
const { networkErrorCode, httpFetch } = require('../src/main/http');

test('Chromium\'s net::ERR_ codes, Node\'s causes and timeouts are named', () => {
  assert.strictEqual(networkErrorCode(new Error('net::ERR_CERT_AUTHORITY_INVALID')), 'ERR_CERT_AUTHORITY_INVALID');
  assert.strictEqual(networkErrorCode(new Error('net::ERR_PROXY_CONNECTION_FAILED')), 'ERR_PROXY_CONNECTION_FAILED');
  const node = new TypeError('fetch failed'); node.cause = { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' };
  assert.strictEqual(networkErrorCode(node), 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
  const dns = new TypeError('fetch failed'); dns.cause = { code: 'ENOTFOUND' };
  assert.strictEqual(networkErrorCode(dns), 'ENOTFOUND');
  assert.strictEqual(networkErrorCode(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })), 'TIMED OUT');
});

test('anything that isn\'t a failed request says nothing more', () => {
  assert.strictEqual(networkErrorCode(Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:8080'), { code: 'EADDRINUSE' })), null);
  assert.strictEqual(networkErrorCode(new Error('unexpected response')), null);
  assert.strictEqual(networkErrorCode(null), null);
});

test('outside Electron, requests go through Node\'s fetch', async () => {
  const real = global.fetch;
  global.fetch = async (url) => ({ ok: true, url });
  try { assert.strictEqual((await httpFetch('https://example.com/x')).url, 'https://example.com/x'); } finally { global.fetch = real; }
});
