'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDispatcher, METHODS } = require('../src/dispatcher');
const { HostError } = require('../src/errors');
const h = require('../src/handlers');

const quiet = { log: () => {} };

test('allowlist equals the contract method table', () => {
  assert.deepEqual([...METHODS].sort(), ['applyGameProfile', 'applyTweak', 'copyText', 'games', 'hardware', 'info',
    'launchGame', 'openExternal', 'openSettings', 'relaunchAsAdmin', 'revertAll', 'revertGameProfile', 'saveFile',
    'stats', 'tweaks', 'aiStatus', 'aiConfigure', 'aiClear', 'aiKey', 'aiMessage'].sort());
});

test('dispatcher rejects unknown methods, prototype keys and handlers outside the allowlist', async () => {
  const handlers = { info: async () => ({ platform: 'windows' }), evil: async () => 'pwned' };
  const d = createDispatcher(handlers, quiet);
  for (const m of ['evil', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'INFO', 'aistatus', 'aiMessages',
    'ai', null, 42, undefined]) {
    assert.deepEqual(await d(m, {}), { ok: false, code: 'UNKNOWN_METHOD', error: 'Неизвестная команда' }, String(m));
  }
  // allowed name but no handler registered
  assert.equal((await d('stats', {})).code, 'UNKNOWN_METHOD');
  assert.deepEqual(await d('info', {}), { ok: true, data: { platform: 'windows' } });
});

test('dispatcher validates args and maps errors to the wire format', async () => {
  const d = createDispatcher({
    tweaks: async () => undefined,
    applyTweak: async () => { throw new HostError('NEEDS_ADMIN', 'Нужны права администратора'); },
    games: async () => { throw new Error('EPERM: something English'); },
    stats: async (a) => a
  }, quiet);
  assert.deepEqual(await d('tweaks'), { ok: true, data: {} });
  assert.deepEqual(await d('stats', null), { ok: true, data: {} });
  assert.deepEqual(await d('stats', 'x'), { ok: false, code: 'BAD_ARGS', error: 'Неверные параметры запроса' });
  assert.deepEqual(await d('stats', [1]), { ok: false, code: 'BAD_ARGS', error: 'Неверные параметры запроса' });
  assert.deepEqual(await d('applyTweak', { id: 'hags' }), { ok: false, code: 'NEEDS_ADMIN', error: 'Нужны права администратора' });
  const g = await d('games', {});
  assert.equal(g.ok, false);
  assert.equal(g.code, 'FAILED');
  assert.ok(/[а-я]/i.test(g.error) && !/EPERM/.test(g.error), 'no English internals leak');
});

test('handlers: file names, unique paths, http-only external links', () => {
  assert.equal(h.safeFileName('../../evil\\..\\x.mcpack'), 'x.mcpack');
  assert.equal(h.safeFileName('a<b>:c?.txt'), 'a_b__c_.txt');
  assert.equal(h.safeFileName('CON.txt'), 'GinN-CON.txt');
  assert.equal(h.safeFileName(''), 'GinN-file');
  assert.equal(h.safeFileName('name. . '), 'name');
  const taken = new Set([path.join('/d', 'a.zip'), path.join('/d', 'a (1).zip')]);
  assert.equal(h.uniquePath('/d', 'a.zip', (p) => taken.has(p)), path.join('/d', 'a (2).zip'));
  assert.ok(h.isHttpUrl('https://example.com/x'));
  assert.ok(!h.isHttpUrl('file:///C:/Windows/System32/cmd.exe'));
  assert.ok(!h.isHttpUrl('javascript:alert(1)'));
  assert.ok(!h.isHttpUrl('ms-settings:privacy'));
});

test('handlers wired end-to-end (non-Windows): info, saveFile, copyText, openExternal, openSettings', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-h-'));
  const opened = [];
  const clip = [];
  const fakeSi = new Proxy({}, { get: () => async () => { throw new Error('no probe'); } });
  const host = h.createHandlers({
    platform: 'linux', si: fakeSi,
    app: { getVersion: () => '1.0.0', isPackaged: false, getAppPath: () => base },
    shell: { openExternal: async (u) => { opened.push(u); }, openPath: async () => '' },
    clipboard: { writeText: (t) => clip.push(t) },
    screen: null, userData: path.join(base, 'ud'), downloads: path.join(base, 'dl'), emit: () => {}
  });
  const d = createDispatcher(host.handlers, quiet);
  const info = await d('info');
  assert.deepEqual(info, { ok: true, data: { platform: 'windows', appVersion: '1.0.0', isAdmin: false, os: 'linux',
    capabilities: ['tweaks', 'saveFile', 'ai', 'ai.native'] } });

  const s1 = await d('saveFile', { name: 'GinN-Gray.mcpack', base64: Buffer.from('hello').toString('base64'), mime: 'application/zip', open: false });
  const s2 = await d('saveFile', { name: 'GinN-Gray.mcpack', base64: Buffer.from('again').toString('base64'), mime: 'application/zip', open: true });
  assert.equal(s1.data.path, path.join(base, 'dl', 'GinN-Gray.mcpack'));
  assert.equal(s2.data.path, path.join(base, 'dl', 'GinN-Gray (1).mcpack'));
  assert.equal(fs.readFileSync(s1.data.path, 'utf8'), 'hello');
  assert.equal((await d('saveFile', { name: 'x', base64: '' })).code, 'BAD_ARGS');

  assert.deepEqual(await d('copyText', { text: 'привет' }), { ok: true, data: {} });
  assert.deepEqual(clip, ['привет']);
  assert.equal((await d('openExternal', { url: 'file:///etc/passwd' })).code, 'BAD_ARGS');
  assert.deepEqual(await d('openExternal', { url: 'https://github.com' }), { ok: true, data: {} });
  assert.deepEqual(opened, ['https://github.com']);
  assert.equal((await d('openSettings', { target: 'graphics' })).code, 'UNSUPPORTED');
  assert.equal((await d('applyTweak', { id: 'game_mode', enable: true })).code, 'UNSUPPORTED');
  assert.equal((await d('relaunchAsAdmin')).code, 'UNSUPPORTED');
  assert.deepEqual(await d('games'), { ok: true, data: [] });
  assert.deepEqual(await d('revertAll'), { ok: true, data: { reverted: [], failed: [] } });

  // AI methods are wired through the dispatcher (no safeStorage passed -> plain, flagged)
  assert.deepEqual(await d('aiStatus'), { ok: true, data: { configured: false, model: 'claude-opus-5-5', transport: 'native', keyStorage: null } });
  assert.equal((await d('aiMessage', { params: {} })).code, 'AI_NO_KEY');
  assert.deepEqual((await d('aiConfigure', { key: 'sk-ant-api03-dispatcher-test-key-000000' })).data,
    { configured: true, model: 'claude-opus-5-5', transport: 'native', keyStorage: 'plain' });
  assert.equal((await d('aiKey')).code, 'UNSUPPORTED');
  assert.equal((await d('aiMessage', { params: { model: 'gpt-4', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] } })).code, 'BAD_ARGS');
  assert.equal((await d('aiClear')).data.configured, false);

  // every probe throwing must still give the full Hardware/Stats shapes
  const hw = await d('hardware');
  assert.equal(hw.ok, true);
  assert.deepEqual(Object.keys(hw.data).sort(), ['battery', 'cpu', 'device', 'display', 'gpu', 'os', 'ram', 'storage']);
  const st = await d('stats');
  assert.equal(st.ok, true);
  assert.deepEqual(Object.keys(st.data).sort(), ['batteryLevel', 'cpuLoad', 'cpuMHz', 'gpuLoad', 'ramAvailMB', 'ramUsedPct',
    'tempC', 'tempSource', 'thermal'].sort());
  host.dispose();
  fs.rmSync(base, { recursive: true, force: true });
});
