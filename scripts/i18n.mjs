// npm run i18n -- <code>: brings src/locales/<code>.json in step with the code (new texts added empty, gone ones
// removed) and says how much is translated. A translator fills in the empty strings.
import fs from 'node:fs';
import { collectStrings, sourceFiles, syncLocale, coverage } from './i18n-collect.mjs';

const code = process.argv[2];
if (!code || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) { console.error('usage: npm run i18n -- <language code, e.g. es or pt-BR>'); process.exit(1); }
const file = `src/locales/${code}.json`;
const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const keys = collectStrings(sourceFiles('src'));
const out = syncLocale(existing, keys, code);
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
const { done, total } = coverage(out, keys);
console.log(`${code}: ${done}/${total} (${Math.round((done / total) * 100) || 0}%)`);
