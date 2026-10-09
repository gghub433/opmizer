'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const run = require('../src/run');
const admin = require('../src/admin');

test.afterEach(() => { run.setRunner(null); admin.resetCache(); });

const ME = 'S-1-5-21-1111111111-2222222222-3333333333-500';
const USER = 'S-1-5-21-1111111111-2222222222-3333333333-1001';

test('parseOtherUser: true only when both SIDs are known and differ', () => {
  assert.equal(admin.parseOtherUser('GINN_ME ' + ME + '\r\nGINN_SHELL ' + USER + '\r\n'), true);
  assert.equal(admin.parseOtherUser('GINN_ME ' + ME + '\r\nGINN_SHELL ' + ME.toLowerCase() + '\r\n'), false);
  assert.equal(admin.parseOtherUser('GINN_ME ' + ME + '\r\n'), false, 'no shell in the session -> assume the same user');
  assert.equal(admin.parseOtherUser(''), false);
});

function fakeRunner(o) {
  const scripts = [];
  return {
    scripts,
    runner(file, args) {
      if (/net\.exe$/i.test(file)) return { code: o.admin ? 0 : 2, stdout: '', stderr: '' };
      if (/powershell/i.test(file)) {
        const script = run.decodePsArgs(args);
        scripts.push(script);
        if (/IsInRole/.test(script)) return { code: 0, stdout: 'False\r\n', stderr: '' };
        if (/GINN_SHELL/.test(script)) return { code: 0, stdout: 'GINN_ME ' + ME + '\r\nGINN_SHELL ' + o.shell + '\r\n', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    }
  };
}

test('isOtherUser: elevated with another account\'s password -> true; same account or not elevated -> false', async () => {
  let f = fakeRunner({ admin: true, shell: USER });
  run.setRunner(f.runner);
  assert.equal(await admin.isOtherUser('win32'), true);
  assert.equal(await admin.isOtherUser('win32'), true);
  assert.equal(f.scripts.filter((x) => /GINN_SHELL/.test(x)).length, 1, 'cached');

  admin.resetCache();
  f = fakeRunner({ admin: true, shell: ME });
  run.setRunner(f.runner);
  assert.equal(await admin.isOtherUser('win32'), false);

  admin.resetCache();
  f = fakeRunner({ admin: false, shell: USER });
  run.setRunner(f.runner);
  assert.equal(await admin.isOtherUser('win32'), false, 'a non-elevated token is always the user\'s own');
  assert.ok(!f.scripts.some((x) => /GINN_SHELL/.test(x)), 'no session lookup without elevation');

  admin.resetCache();
  assert.equal(await admin.isOtherUser('linux'), false);
  assert.match(admin.OTHER_USER_SCRIPT, /explorer\.exe/);
  assert.match(admin.OTHER_USER_SCRIPT, /GetOwnerSid/);
});

test('psQuote doubles ASCII and typographic single quotes (PowerShell ends a literal at all of them)', () => {
  assert.equal(run.psQuote("O'Brien"), "'O''Brien'");
  assert.equal(run.psQuote('D:\\Ivan\u2019s Games'), "'D:\\Ivan\u2019\u2019s Games'");
  assert.equal(run.psQuote('\u2018a\u201Ab\u201Bc'), "'\u2018\u2018a\u201A\u201Ab\u201B\u201Bc'");
  assert.equal(run.psQuote(null), "''");
  // A path with ’ cannot end the -FilePath literal of the relaunch script any more
  const s = admin.relaunchScript('C:\\Users\\O\u2019Brien\\GinN.exe', []);
  assert.match(s, /-FilePath 'C:\\Users\\O\u2019\u2019Brien\\GinN\.exe' -Verb RunAs/);
  // every quote character inside the literal comes in pairs
  const lit = /-FilePath '((?:[^'\u2018\u2019\u201A\u201B]|['\u2018\u2019\u201A\u201B]{2})*)'/.exec(s);
  assert.ok(lit, 'the literal parses as one PowerShell single-quoted string');
});
