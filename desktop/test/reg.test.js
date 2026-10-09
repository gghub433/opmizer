'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const run = require('../src/run');
const reg = require('../src/reg');
const { fakeWindows } = require('./fakes');

test.afterEach(() => run.setRunner(null));

test('parseQuery: REG_DWORD hex -> number, REG_SZ, CRLF', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\GameBar\r\n' +
    '    AutoGameModeEnabled    REG_DWORD    0x1\r\n' +
    '    NetworkThrottlingIndex    REG_DWORD    0xffffffff\r\n' +
    '    Scheduling Category    REG_SZ    High\r\n\r\n';
  const { values, subkeys } = reg.parseQuery(out);
  assert.deepEqual(values, [
    { name: 'AutoGameModeEnabled', type: 'REG_DWORD', value: 1 },
    { name: 'NetworkThrottlingIndex', type: 'REG_DWORD', value: 4294967295 },
    { name: 'Scheduling Category', type: 'REG_SZ', value: 'High' }
  ]);
  assert.deepEqual(subkeys, ['HKCU\\Software\\Microsoft\\GameBar']);
});

test('parseQuery: tabs / odd whitespace, empty REG_SZ, localized default name, value names with spaces', () => {
  const out = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\X\n' +
    '\tGPU Priority\tREG_DWORD\t0x8\n' +
    '        SFIO Priority      REG_SZ      High\n' +
    '    Empty    REG_SZ    \n' +
    '    (По умолчанию)    REG_SZ    \n' +
    '    Big    REG_DWORD_BIG_ENDIAN    0x2\n';
  const { values } = reg.parseQuery(out);
  assert.equal(values.length, 5);
  assert.deepEqual(values[0], { name: 'GPU Priority', type: 'REG_DWORD', value: 8 });
  assert.deepEqual(values[1], { name: 'SFIO Priority', type: 'REG_SZ', value: 'High' });
  assert.deepEqual(values[2], { name: 'Empty', type: 'REG_SZ', value: '' });
  assert.equal(values[3].name, '(По умолчанию)');
  assert.equal(values[4].type, 'REG_DWORD_BIG_ENDIAN');
});

test('parseTree groups values under each key (reg query /s)', () => {
  const out = '\r\nHKEY_LOCAL_MACHINE\\A\r\n    X    REG_DWORD    0x0\r\n\r\n' +
    'HKEY_LOCAL_MACHINE\\A\\{1}\r\n    DhcpIPAddress    REG_SZ    192.168.1.5\r\n\r\n' +
    'HKEY_LOCAL_MACHINE\\A\\{2}\r\n\r\nEnd of search: 2 match(es) found.\r\n';
  const t = reg.parseTree(out);
  assert.equal(t.size, 3);
  assert.equal(t.get('hklm\\a').values.x.value, 0);
  assert.equal(t.get('hklm\\a\\{1}').values.dhcpipaddress.value, '192.168.1.5');
  assert.deepEqual(t.get('hklm\\a\\{2}').values, {});
});

test('normKey / isMachineKey', () => {
  assert.equal(reg.normKey('HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\'), 'HKLM\\SOFTWARE\\X');
  assert.equal(reg.normKey('hkcu/Software/X'), 'HKCU\\Software\\X');
  assert.ok(reg.isMachineKey('HKEY_LOCAL_MACHINE\\SYSTEM'));
  assert.ok(!reg.isMachineKey('HKCU\\System'));
});

test('query: existing DWORD / SZ, missing value -> {exists:false}', async () => {
  const w = fakeWindows({ registry: { 'HKCU\\Control Panel\\Mouse': { MouseSpeed: ['REG_SZ', '1'] }, 'HKLM\\S\\M': { SystemResponsiveness: ['REG_DWORD', 20] } } });
  run.setRunner(w.runner);
  assert.deepEqual(await reg.query('HKCU\\Control Panel\\Mouse', 'MouseSpeed'), { exists: true, type: 'REG_SZ', value: '1' });
  assert.deepEqual(await reg.query('HKLM\\S\\M', 'SystemResponsiveness'), { exists: true, type: 'REG_DWORD', value: 20 });
  assert.deepEqual(await reg.query('HKLM\\S\\M', 'Nope'), { exists: false });
  assert.deepEqual(await reg.query('HKLM\\No\\Such\\Key', 'X'), { exists: false });
});

test('query: localized reg.exe output (Russian error text, tabs)', async () => {
  run.setRunner((file, args) => {
    if (args[3] === 'Missing') return { code: 1, stdout: '', stderr: 'ОШИБКА: Не удается найти указанный раздел или параметр в реестре.' };
    return { code: 0, stdout: 'HKEY_CURRENT_USER\\X\r\n\tFlags\tREG_SZ\t506\r\n', stderr: '' };
  });
  assert.deepEqual(await reg.query('HKCU\\X', 'Flags'), { exists: true, type: 'REG_SZ', value: '506' });
  assert.deepEqual(await reg.query('HKCU\\X', 'Missing'), { exists: false });
});

test('set: DWORD written as hex (0xffffffff safe), SZ verbatim; access denied -> NEEDS_ADMIN', async () => {
  const seen = [];
  run.setRunner((file, args) => { seen.push(args); return { code: 0, stdout: '', stderr: '' }; });
  await reg.set('HKLM\\A', 'NetworkThrottlingIndex', 'REG_DWORD', 0xffffffff);
  await reg.set('HKCU\\B', 'MouseSpeed', 'REG_SZ', '0');
  assert.deepEqual(seen[0], ['add', 'HKLM\\A', '/v', 'NetworkThrottlingIndex', '/t', 'REG_DWORD', '/d', '0xffffffff', '/f']);
  assert.deepEqual(seen[1], ['add', 'HKCU\\B', '/v', 'MouseSpeed', '/t', 'REG_SZ', '/d', '0', '/f']);
  run.setRunner(() => ({ code: 1, stdout: '', stderr: 'ERROR: Access is denied.' }));
  await assert.rejects(reg.set('HKLM\\A', 'X', 'REG_DWORD', 1), { code: 'NEEDS_ADMIN' });
});

test('del: missing value is success; listSubkeys returns direct children only', async () => {
  const w = fakeWindows({
    registry: {
      'HKLM\\T\\Interfaces': {},
      'HKLM\\T\\Interfaces\\{A}': { DhcpIPAddress: ['REG_SZ', '10.0.0.2'] },
      'HKLM\\T\\Interfaces\\{B}': {},
      'HKLM\\T\\Interfaces\\{B}\\Deep': {}
    }
  });
  run.setRunner(w.runner);
  assert.equal(await reg.del('HKLM\\T\\Interfaces\\{A}', 'NotThere'), true);
  assert.equal(await reg.del('HKLM\\T\\Interfaces\\{A}', 'DhcpIPAddress'), true);
  assert.equal(w.hasValue('HKLM\\T\\Interfaces\\{A}', 'DhcpIPAddress'), false);
  assert.deepEqual(await reg.listSubkeys('HKLM\\T\\Interfaces'), ['HKLM\\T\\Interfaces\\{A}', 'HKLM\\T\\Interfaces\\{B}']);
});

test('decode: UTF-8 passes through, CP866 (Russian console) is decoded', () => {
  assert.equal(run.decode(Buffer.from('Сбалансированная', 'utf8')), 'Сбалансированная');
  // "Высокая" in CP866: В=0x82 ы=0xEB с=0xE1 о=0xAE к=0xAA а=0xA0 я=0xEF
  assert.equal(run.decode(Buffer.from([0x82, 0xEB, 0xE1, 0xAE, 0xAA, 0xA0, 0xEF])), 'Высокая');
});

test('ps(): script is passed as -EncodedCommand with UTF-8 output forced', async () => {
  let got;
  run.setRunner((file, args) => { got = { file, args }; return { code: 0, stdout: 'ok', stderr: '' }; });
  await run.ps("Write-Output 'привет \"мир\"'");
  assert.equal(got.file, 'powershell.exe');
  assert.deepEqual(got.args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
  const script = run.decodePsArgs(got.args);
  assert.match(script, /OutputEncoding=\[System\.Text\.Encoding\]::UTF8/);
  assert.ok(script.endsWith("Write-Output 'привет \"мир\"'"));
});
