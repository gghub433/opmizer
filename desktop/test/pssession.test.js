'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { PsSession, MARK } = require('../src/pssession');

// Stand-in for `powershell -Command -`: echoes each command line, then the marker; "hang" never answers.
const MIMIC = `
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const m = /^(.*); Write-Output '(.*)'$/.exec(line);
    if (!m) continue;
    if (m[1] === 'hang') continue;
    if (m[1] === 'die') process.exit(3);
    setTimeout(() => process.stdout.write('out:' + m[1] + '\\r\\n' + m[2] + '\\r\\n'), m[1] === 'slow' ? 50 : 0);
  }
});`;

const mk = () => new PsSession({ spawn: () => spawn(process.execPath, ['-e', MIMIC], { stdio: ['pipe', 'pipe', 'ignore'] }) });

test('PsSession runs commands strictly in order and splits answers on the marker', async (t) => {
  const s = mk();
  t.after(() => s.close());
  const [a, b, c] = await Promise.all([s.exec('slow'), s.exec('two'), s.exec('three')]);
  assert.equal(a, 'out:slow\r\n');
  assert.equal(b, 'out:two\r\n');
  assert.equal(c, 'out:three\r\n');
  assert.equal(MARK, '__GINN_DONE__');
});

test('PsSession: a hung command times out with null, the next one restarts the process', async (t) => {
  const s = mk();
  t.after(() => s.close());
  assert.equal(await s.exec('hang', 300), null);
  assert.equal(await s.exec('after'), 'out:after\r\n');
  assert.equal(await s.exec('die', 2000), null);
  assert.equal(await s.exec('again'), 'out:again\r\n');
  s.close();
  assert.equal(await s.exec('closed'), null);
});
