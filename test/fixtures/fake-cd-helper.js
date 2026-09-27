'use strict';
// A stand-in for win-cd/helper.ps1 in tests: the same protocol, the user's CD in F:.
const readline = require('readline');
const { tocBytes, THREE_DOLLAR_BILL } = require('./cd-toc');
const toc = tocBytes(THREE_DOLLAR_BILL.lbas.map((lba, i) => ({ number: i + 1, lba })), THREE_DOLLAR_BILL.leadout);
const send = (header, payload = Buffer.alloc(0)) => {
  process.stdout.write(`${JSON.stringify({ ...header, bytes: payload.length })}\n`);
  if (payload.length) process.stdout.write(payload);
};
process.stdout.write('WARNING: a stray PowerShell line\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  if (req.op === 'die') process.exit(1);
  if (req.op === 'hang') return; // a drive that never answers
  if (req.op === 'drives') return send({ id: req.id, ok: true, drives: ['F:'] });
  if (req.op === 'toc') return req.drive === 'F:' ? send({ id: req.id, ok: true }, toc) : send({ id: req.id, ok: false, error: 'toc: error 21' });
  if (req.op === 'read') {
    const b = Buffer.alloc(req.count * 2352);
    for (let s = 0; s < req.count; s++) b.fill((req.lba + s) & 0xff, s * 2352, (s + 1) * 2352);
    return send({ id: req.id, ok: true }, b);
  }
  if (req.op === 'eject') return send({ id: req.id, ok: true });
  return send({ id: req.id, ok: false, error: 'unknown op' });
});
