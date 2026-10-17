'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('../src/main/remote-net');

const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal, netmask: '255.255.255.0' });

test('pickAddresses offers private LAN addresses, Wi-Fi first, and skips tunnels, loopback, link-local and Tailscale', () => {
  const ifs = {
    lo0: [v4('127.0.0.1', true)],
    bridge100: [v4('192.168.64.1')],
    utun3: [v4('10.8.0.2')],
    en1: [v4('169.254.3.4')],
    en2: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
    tailscale0: [v4('100.101.1.2')],
    en0: [v4('192.168.1.20')],
  };
  assert.deepStrictEqual(net.pickAddresses(ifs), [{ name: 'en0', address: '192.168.1.20' }, { name: 'bridge100', address: '192.168.64.1' }]);
});

test('pickAddresses on Windows names keeps Wi-Fi and drops the WSL switch', () => {
  const ifs = { 'vEthernet (WSL)': [v4('172.20.0.1')], 'Wi-Fi': [v4('10.0.0.5')] };
  assert.deepStrictEqual(net.pickAddresses(ifs), [{ name: 'Wi-Fi', address: '10.0.0.5' }]);
});

test('pickAddresses accepts numeric family 4 and the 172.16/12 range only', () => {
  const ifs = { eth0: [{ address: '172.16.0.9', family: 4, internal: false }], eth1: [v4('172.32.0.1')] };
  assert.deepStrictEqual(net.pickAddresses(ifs), [{ name: 'eth0', address: '172.16.0.9' }]);
  assert.deepStrictEqual(net.pickAddresses(undefined), []);
});

test('pickAddresses keeps a Windows wired adapter named Local Area Connection but drops loopback names', () => {
  const ifs = { 'Local Area Connection': [v4('192.168.1.30')], 'Loopback Pseudo-Interface 1': [v4('192.168.9.9')], lo: [v4('10.1.1.1')], tapvpn: [v4('10.2.2.2')] };
  assert.deepStrictEqual(net.pickAddresses(ifs), [{ name: 'Local Area Connection', address: '192.168.1.30' }]);
});

test('hostAllowed wants exactly IP:PORT', () => {
  assert.strictEqual(net.hostAllowed('192.168.1.20:47800', '192.168.1.20', 47800), true);
  assert.strictEqual(net.hostAllowed('evil.example:47800', '192.168.1.20', 47800), false);
  assert.strictEqual(net.hostAllowed('192.168.1.20', '192.168.1.20', 47800), false);
  assert.strictEqual(net.hostAllowed(undefined, '192.168.1.20', 47800), false);
});

test('originAllowed wants exactly http://IP:PORT and refuses a missing one', () => {
  assert.strictEqual(net.originAllowed('http://192.168.1.20:47800', '192.168.1.20', 47800), true);
  assert.strictEqual(net.originAllowed(undefined, '192.168.1.20', 47800), false);
  assert.strictEqual(net.originAllowed('http://evil.example', '192.168.1.20', 47800), false);
  assert.strictEqual(net.originAllowed('null', '192.168.1.20', 47800), false);
});

test('tokens: random, base64url, 16 bytes; tokenOk compares safely', () => {
  const a = net.newToken(), b = net.newToken();
  assert.notStrictEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.strictEqual(net.tokenOk(a, a), true);
  assert.strictEqual(net.tokenOk(b, a), false);
  assert.strictEqual(net.tokenOk(a.slice(1), a), false);
  assert.strictEqual(net.tokenOk('', a), false);
});

test('the cookie round-trips for its token only', () => {
  const t = net.newToken(), other = net.newToken();
  assert.strictEqual(net.cookieOk(`x=1; cdp=${net.cookieValue(t)}; y=2`, t), true);
  assert.strictEqual(net.cookieOk(`cdp=${net.cookieValue(other)}`, t), false);
  assert.strictEqual(net.cookieOk('cdp', t), false);
  assert.strictEqual(net.cookieOk(';;=;cdp=', t), false);
  assert.strictEqual(net.cookieOk(undefined, t), false);
  assert.strictEqual(net.cookieOk('cdp=short', t), false);
});

test('validCommand accepts each command\'s good shape', () => {
  for (const action of ['toggle', 'prev', 'next', 'mute', 'shuffle', 'repeat', 'clear', 'undo', 'discSkip'])
    assert.deepStrictEqual(net.validCommand({ action }), { action, value: undefined, rev: undefined });
  assert.deepStrictEqual(net.validCommand({ action: 'seek', value: 12.5 }), { action: 'seek', value: 12.5, rev: undefined });
  assert.deepStrictEqual(net.validCommand({ action: 'seek', value: 0 }), { action: 'seek', value: 0, rev: undefined });
  assert.deepStrictEqual(net.validCommand({ action: 'volume', value: 0 }), { action: 'volume', value: 0, rev: undefined });
  assert.deepStrictEqual(net.validCommand({ action: 'volume', value: 100 }), { action: 'volume', value: 100, rev: undefined });
  assert.deepStrictEqual(net.validCommand({ action: 'playIndex', value: 3, rev: 7 }), { action: 'playIndex', value: 3, rev: 7 });
  assert.deepStrictEqual(net.validCommand({ action: 'remove', value: 0, rev: 1 }), { action: 'remove', value: 0, rev: 1 });
  assert.deepStrictEqual(net.validCommand({ action: 'move', value: { from: 1, to: 4 }, rev: 2 }), { action: 'move', value: { from: 1, to: 4 }, rev: 2 });
  assert.deepStrictEqual(net.validCommand({ action: 'playSlot', value: 4, rev: 2 }), { action: 'playSlot', value: 4, rev: 2 });
  assert.deepStrictEqual(net.validCommand({ action: 'album', value: { id: 'ab12cd', how: 'add', track: 2, slot: 0 }, rev: 5 }),
    { action: 'album', value: { id: 'ab12cd', how: 'add', track: 2, slot: 0 }, rev: 5 });
  assert.deepStrictEqual(net.validCommand({ action: 'album', value: { id: 'ab12cd', how: 'play' }, rev: 5, junk: 1 }),
    { action: 'album', value: { id: 'ab12cd', how: 'play' }, rev: 5 });
});

test('validCommand refuses anything off the list', () => {
  const bad = [
    null, 'toggle', [], {}, { action: 'format' }, { action: 'constructor' },
    { action: 'volume', value: 101 }, { action: 'volume', value: 1.5 }, { action: 'volume' },
    { action: 'seek', value: -1 }, { action: 'seek', value: NaN }, { action: 'seek', value: '3' },
    { action: 'move', value: { from: 1 }, rev: 1 }, { action: 'move', value: { from: -1, to: 2 }, rev: 1 },
    { action: 'album', value: { id: 'ab12', how: 'burn' }, rev: 1 }, { action: 'album', value: { id: '../etc', how: 'play' }, rev: 1 },
    { action: 'album', value: { id: 'ab12', how: 'play', slot: 5 }, rev: 1 },
    { action: 'playIndex', value: 1 }, { action: 'playIndex', value: 1, rev: 1.5 }, { action: 'playIndex', value: -1, rev: 1 },
    { action: 'playSlot', value: 5, rev: 1 },
    { action: 'move', value: 0, rev: 1 }, { action: 'move', value: '', rev: 1 }, { action: 'move', value: NaN, rev: 1 },
    { action: 'album', value: 0, rev: 1 }, { action: 'album', value: '', rev: 1 },
  ];
  for (const b of bad) assert.strictEqual(net.validCommand(b), null, JSON.stringify(b));
});
