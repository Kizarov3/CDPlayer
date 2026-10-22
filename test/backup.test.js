'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backup = require('../src/main/backup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-backup-'));
const put = (dir, name, text) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };

test('what is yours goes into the backup; sign-ins and caches do not', () => {
  const dir = tmp();
  put(dir, 'plays.txt', '7\t/a.flac\n');
  put(dir, 'notes.txt', '"id"\t"lent to Sam"\n');
  put(dir, 'themes/0123456789abcdef.cdtheme', '{"name":"Mine"}');
  put(dir, 'spotify.txt', 'secret');
  put(dir, 'remote.json', '{}');
  put(dir, 'shelf-cache.json', '{}');
  const b = backup.read(backup.make(dir, { version: '2.18.0', now: 5 }));
  assert.deepStrictEqual(Object.keys(b.files).sort(), ['notes.txt', 'plays.txt', 'themes/0123456789abcdef.cdtheme']);
  assert.strictEqual(b.files['notes.txt'].toString(), '"id"\t"lent to Sam"\n');
  assert.strictEqual(b.made, 5);
  assert.strictEqual(b.app, '2.18.0');
});

test('restoring makes the folder what the backup kept, with what was there in before-restore/', () => {
  const from = tmp(), to = tmp();
  put(from, 'plays.txt', '7\t/a.flac\n');
  put(to, 'plays.txt', '1\t/b.flac\n');
  put(to, 'notes.txt', '"x"\t"y"\n');
  put(to, 'spotify.txt', 'signed in');
  backup.restore(to, backup.read(backup.make(from)));
  assert.strictEqual(fs.readFileSync(path.join(to, 'plays.txt'), 'utf8'), '7\t/a.flac\n');
  assert.strictEqual(fs.existsSync(path.join(to, 'notes.txt')), false, 'no notes then, none now');
  assert.strictEqual(fs.readFileSync(path.join(to, 'spotify.txt'), 'utf8'), 'signed in', 'sign-ins stay');
  assert.strictEqual(fs.readFileSync(path.join(to, 'before-restore', 'notes.txt'), 'utf8'), '"x"\t"y"\n');
});

test('a file that is not a backup, or names a path outside the data folder, is refused', () => {
  assert.strictEqual(backup.read('not json'), null);
  assert.strictEqual(backup.read(JSON.stringify({ format: 'other', version: 1, files: {} })), null);
  const evil = (name) => JSON.stringify({ format: 'cdplayer-backup', version: 1, files: { [name]: '' } });
  assert.strictEqual(backup.read(evil('../../.zshrc')), null);
  assert.strictEqual(backup.read(evil('themes/../../x.cdtheme')), null);
  assert.strictEqual(backup.read(evil('spotify.txt')), null);
});
