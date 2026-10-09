'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const run = require('../src/run');
const tw = require('../src/tweaks');
const { fakeWindows, memoryStore } = require('./fakes');

test.afterEach(() => run.setRunner(null));

const GCS = 'HKCU\\System\\GameConfigStore';
const DVR = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR';
const MM = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';
const GFX = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers';
const IFS = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces';

function setup(opts) {
  const w = fakeWindows(opts);
  run.setRunner(w.runner);
  const store = memoryStore();
  const opened = [];
  const t = tw.createTweaks({
    platform: 'win32', store, isAdmin: async () => !!(opts && opts.admin),
    openExternal: async (u) => { opened.push(u); }, env: {}
  });
  return { w, store, t, opened };
}

const stateOf = async (t, id) => (await t.list()).find((x) => x.id === id).state;

test('tweak list matches the shared ids and contract shape', async () => {
  const { t } = setup();
  const list = await t.list();
  const ids = list.map((x) => x.id);
  assert.deepEqual(ids, ['power_plan', 'power_throttling', 'game_mode', 'game_dvr_off', 'hags', 'fso_off', 'games_priority',
    'system_responsiveness', 'visual_effects', 'transparency_off', 'background_apps_off', 'mouse_accel_off',
    'sticky_keys_off', 'network_throttling', 'nagle_off', 'clean_temp', 'flush_dns', 'restore_point', 'startup_apps',
    'graphics_settings']);
  for (const x of list) {
    assert.deepEqual(Object.keys(x).sort(), ['category', 'desc', 'id', 'impact', 'kind', 'recommended', 'requiresAdmin',
      'requiresReboot', 'risk', 'state', 'title'].sort());
    assert.ok(['on', 'off', 'unknown'].includes(x.state));
    assert.ok(/[а-я]/i.test(x.title) && /[а-я]/i.test(x.desc));
  }
  const hags = list.find((x) => x.id === 'hags');
  assert.equal(hags.requiresAdmin, true);
  assert.equal(hags.requiresReboot, true);
  assert.equal(list.find((x) => x.id === 'fso_off').risk, 'moderate');
});

test('registry engine: apply -> backup -> revert restores exactly, deleting values that did not exist', async () => {
  const { w, store, t } = setup({ registry: { [GCS]: { GameDVR_Enabled: ['REG_DWORD', 1] } } });
  assert.equal(await stateOf(t, 'game_dvr_off'), 'off');

  const r = await t.apply({ id: 'game_dvr_off', enable: true });
  assert.equal(r.state, 'on');
  assert.equal(w.getValue(GCS, 'GameDVR_Enabled'), 0);
  assert.equal(w.getValue(DVR, 'AppCaptureEnabled'), 0);
  const b = store.data.tweaks.game_dvr_off.entries;
  assert.deepEqual(Object.values(b).map((e) => [e.name, e.exists, e.value]).sort(),
    [['AppCaptureEnabled', false, undefined], ['GameDVR_Enabled', true, 1]]);

  const off = await t.apply({ id: 'game_dvr_off', enable: false });
  assert.equal(off.state, 'off');
  assert.equal(w.getValue(GCS, 'GameDVR_Enabled'), 1);
  assert.equal(w.hasValue(DVR, 'AppCaptureEnabled'), false, 'value that did not exist is deleted again');
  assert.equal(store.data.tweaks.game_dvr_off, undefined, 'backup is consumed');
});

test('registry engine: an existing backup is never overwritten', async () => {
  const { w, store, t } = setup({ registry: { 'HKCU\\Control Panel\\Accessibility\\StickyKeys': { Flags: ['REG_SZ', '510'] } } });
  await t.apply({ id: 'sticky_keys_off', enable: true });
  w.setValue('HKCU\\Control Panel\\Accessibility\\StickyKeys', 'Flags', 'REG_SZ', '999'); // changed behind our back
  await t.apply({ id: 'sticky_keys_off', enable: true });
  const e = Object.values(store.data.tweaks.sticky_keys_off.entries)[0];
  assert.equal(e.value, '510');
  await t.apply({ id: 'sticky_keys_off', enable: false });
  assert.equal(w.getValue('HKCU\\Control Panel\\Accessibility\\StickyKeys', 'Flags'), '510');
});

test('registry engine: SZ values and live apply through PowerShell for mouse acceleration', async () => {
  const { w, t } = setup({ registry: { 'HKCU\\Control Panel\\Mouse': { MouseSpeed: ['REG_SZ', '1'], MouseThreshold1: ['REG_SZ', '6'], MouseThreshold2: ['REG_SZ', '10'] } } });
  const r = await t.apply({ id: 'mouse_accel_off', enable: true });
  assert.equal(r.state, 'on');
  assert.equal(w.getValue('HKCU\\Control Panel\\Mouse', 'MouseThreshold2'), '0');
  const psCall = w.calls.find((c) => /powershell/i.test(c[0]));
  assert.ok(psCall, 'SystemParametersInfo is called');
  assert.match(run.decodePsArgs(psCall[1]), /SystemParametersInfo\(4, 0, \[int\[\]\]@\(0,0,0\), 3\)/);
  await t.apply({ id: 'mouse_accel_off', enable: false });
  const last = w.calls.filter((c) => /powershell/i.test(c[0])).pop();
  assert.match(run.decodePsArgs(last[1]), /@\(6,10,1\)/);
});

test('HKLM tweaks without admin -> NEEDS_ADMIN and nothing is written', async () => {
  const { w, store, t } = setup({ registry: { [MM]: { SystemResponsiveness: ['REG_DWORD', 20] } } });
  await assert.rejects(t.apply({ id: 'system_responsiveness', enable: true }), { code: 'NEEDS_ADMIN' });
  await assert.rejects(t.apply({ id: 'power_throttling', enable: true }), { code: 'NEEDS_ADMIN' });
  assert.equal(w.getValue(MM, 'SystemResponsiveness'), 20);
  assert.equal(w.calls.filter((c) => c[1][0] === 'add').length, 0);
  assert.deepEqual(store.data.tweaks, {});
});

test('HKLM tweaks with admin; DWORD 0xffffffff round-trips', async () => {
  const { w, t } = setup({ admin: true, registry: { [MM]: { NetworkThrottlingIndex: ['REG_DWORD', 10] } } });
  assert.equal((await t.apply({ id: 'network_throttling', enable: true })).state, 'on');
  assert.equal(w.getValue(MM, 'NetworkThrottlingIndex'), 4294967295);
  assert.equal((await t.apply({ id: 'network_throttling', enable: false })).state, 'off');
  assert.equal(w.getValue(MM, 'NetworkThrottlingIndex'), 10);
});

test('disable without a backup falls back to documented defaults (HAGS off = 1, needs reboot)', async () => {
  const { w, t } = setup({ admin: true, registry: { [GFX]: { HwSchMode: ['REG_DWORD', 2] } } });
  assert.equal(await stateOf(t, 'hags'), 'on');
  const r = await t.apply({ id: 'hags', enable: false });
  assert.equal(r.state, 'off');
  assert.equal(r.needsReboot, true);
  assert.equal(w.getValue(GFX, 'HwSchMode'), 1);
});

test('turning off a setting that was on before GinN keeps it, so revertAll turns it back on', async () => {
  const { w, store, t } = setup({ admin: true, registry: { [GFX]: { HwSchMode: ['REG_DWORD', 2] } } });
  assert.equal((await t.apply({ id: 'hags', enable: false })).state, 'off');
  assert.equal(w.getValue(GFX, 'HwSchMode'), 1);
  assert.ok(store.data.tweaks.hags, 'the user value is backed up before writing the default');
  await t.revertAll();
  assert.equal(w.getValue(GFX, 'HwSchMode'), 2);
  assert.equal(await stateOf(t, 'hags'), 'on');
});

test('backup taken while already on -> disable still turns it off via defaults', async () => {
  const { w, t } = setup({ registry: { 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize': { EnableTransparency: ['REG_DWORD', 0] } } });
  await t.apply({ id: 'transparency_off', enable: true });
  const r = await t.apply({ id: 'transparency_off', enable: false });
  assert.equal(r.state, 'off');
  assert.equal(w.getValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency'), 1);
});

test('missingAs: Game Mode counts as on when Windows has no values (its default)', async () => {
  const { w, t } = setup();
  assert.equal(await stateOf(t, 'game_mode'), 'on');
  const r = await t.apply({ id: 'game_mode', enable: false });
  assert.equal(r.state, 'off');
  assert.equal(w.getValue('HKCU\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled'), 0);
});

test('nagle_off: only interfaces with an IP address, every entry backed up and reverted', async () => {
  const { w, store, t } = setup({
    admin: true,
    registry: {
      [IFS]: {},
      [IFS + '\\{AAA}']: { DhcpIPAddress: ['REG_SZ', '192.168.0.10'] },
      [IFS + '\\{BBB}']: { IPAddress: ['REG_MULTI_SZ', '10.0.0.5'], TcpAckFrequency: ['REG_DWORD', 2] },
      [IFS + '\\{CCC}']: { EnableDHCP: ['REG_DWORD', 1] }
    }
  });
  assert.equal(await stateOf(t, 'nagle_off'), 'off');
  assert.equal((await t.apply({ id: 'nagle_off', enable: true })).state, 'on');
  for (const k of ['{AAA}', '{BBB}']) {
    assert.equal(w.getValue(IFS + '\\' + k, 'TcpAckFrequency'), 1);
    assert.equal(w.getValue(IFS + '\\' + k, 'TCPNoDelay'), 1);
    assert.equal(w.getValue(IFS + '\\' + k, 'TcpDelAckTicks'), 0);
  }
  assert.equal(w.hasValue(IFS + '\\{CCC}', 'TCPNoDelay'), false);
  assert.equal(Object.keys(store.data.tweaks.nagle_off.entries).length, 6);
  const res = await t.revertAll();
  assert.deepEqual(res, { reverted: ['nagle_off'], failed: [] });
  assert.equal(w.getValue(IFS + '\\{BBB}', 'TcpAckFrequency'), 2);
  assert.equal(w.hasValue(IFS + '\\{AAA}', 'TcpAckFrequency'), false);
});

test('revertAll reports NEEDS_ADMIN for HKLM backups when not elevated', async () => {
  const { store, t } = setup();
  store.data.tweaks.games_priority = { entries: { x: { key: MM + '\\Tasks\\Games', name: 'Priority', exists: true, type: 'REG_DWORD', value: 2 } } };
  const res = await t.revertAll();
  assert.deepEqual(res.reverted, []);
  assert.equal(res.failed[0].id, 'games_priority');
  assert.ok(store.data.tweaks.games_priority, 'backup kept for a later elevated revert');
});

/* ------------------------------------------------------------- power plan */

const EN_ACTIVE = 'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)\r\n';
const RU_ACTIVE = 'GUID схемы питания: 381b4222-f694-41f0-9685-ff5bb260df2e  (Сбалансированная)\r\n';
const RU_LIST = '\r\nСуществующие схемы питания (* Активный)\r\n-----------------------------------\r\n' +
  'GUID схемы питания: 381b4222-f694-41f0-9685-ff5bb260df2e  (Сбалансированная)\r\n' +
  'GUID схемы питания: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (Высокая производительность) *\r\n' +
  'GUID схемы питания: a1841308-3541-4fab-bc81-f71556f20b4a  (Экономия энергии)\r\n';

test('powercfg parsing: English and Russian output', () => {
  assert.deepEqual(tw.parseActiveScheme(EN_ACTIVE), { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Balanced', active: false });
  assert.deepEqual(tw.parseActiveScheme(RU_ACTIVE), { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Сбалансированная', active: false });
  const list = tw.parseSchemeList(RU_LIST);
  assert.equal(list.length, 3);
  assert.deepEqual(list[1], { guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', name: 'Высокая производительность', active: true });
  assert.ok(tw.isPerfScheme({ guid: 'x', name: 'Максимальная производительность' }));
  assert.ok(tw.isPerfScheme({ guid: 'x', name: 'Ultimate Performance' }));
  assert.ok(tw.isPerfScheme(list[1]));
  assert.ok(!tw.isPerfScheme(list[0]));
  assert.equal(tw.parseDuplicated('GUID схемы питания: 11111111-2222-3333-4444-555555555555  (Максимальная производительность)', tw.SCHEME.ultimate),
    '11111111-2222-3333-4444-555555555555');
  // CP866 bytes from a Russian console decode to the same text
  const cp = run.decode(Buffer.from([0x82, 0xEB, 0xE1, 0xAE, 0xAA, 0xA0, 0xEF, 0x20, 0xAF, 0xE0, 0xAE, 0xA8, 0xA7, 0xA2, 0xAE, 0xA4,
    0xA8, 0xE2, 0xA5, 0xAB, 0xEC, 0xAD, 0xAE, 0xE1, 0xE2, 0xEC]));
  assert.equal(cp, 'Высокая производительность');
  assert.ok(tw.isPerfScheme({ guid: 'x', name: cp }));
});

for (const lang of ['en', 'ru']) {
  test('power_plan (' + lang + '): enable duplicates Ultimate, disable restores previous and deletes it', async () => {
    const { w, store, t } = setup({ lang });
    assert.equal(await stateOf(t, 'power_plan'), 'off');
    const on = await t.apply({ id: 'power_plan', enable: true });
    assert.equal(on.state, 'on');
    assert.equal(w.power.active, w.power.nextGuid);
    assert.deepEqual({ previous: store.data.power.previous, created: store.data.power.created, applied: store.data.power.applied },
      { previous: '381b4222-f694-41f0-9685-ff5bb260df2e', created: w.power.nextGuid, applied: w.power.nextGuid });
    assert.equal(await stateOf(t, 'power_plan'), 'on');

    const off = await t.apply({ id: 'power_plan', enable: false });
    assert.equal(off.state, 'off');
    assert.equal(w.power.active, '381b4222-f694-41f0-9685-ff5bb260df2e');
    assert.ok(!w.power.schemes.some((s) => s.guid === w.power.nextGuid), 'GinN scheme deleted');
    assert.equal(store.data.power, null);
  });
}

test('power_plan: falls back to High performance when Ultimate cannot be duplicated', async () => {
  const { w, store, t } = setup({ duplicateFails: true });
  const on = await t.apply({ id: 'power_plan', enable: true });
  assert.equal(on.state, 'on');
  assert.equal(w.power.active, tw.SCHEME.high);
  assert.equal(store.data.power.created, null);
  await t.revertAll();
  assert.equal(w.power.active, tw.SCHEME.balanced);
});

test('power_plan: user already on High performance -> state on; disable without backup -> Balanced', async () => {
  const { w, t } = setup({ active: tw.SCHEME.high });
  assert.equal(await stateOf(t, 'power_plan'), 'on');
  await t.apply({ id: 'power_plan', enable: false });
  assert.equal(w.power.active, tw.SCHEME.balanced);
});

/* ---------------------------------------------------------- actions, links */

test('links open ms-settings and report unknown state; flush_dns runs ipconfig', async () => {
  const { w, t, opened } = setup();
  assert.deepEqual(await t.apply({ id: 'startup_apps', enable: true }), { id: 'startup_apps', state: 'unknown', message: 'Открыты настройки' });
  assert.deepEqual(opened, ['ms-settings:startupapps']);
  const r = await t.apply({ id: 'flush_dns' });
  assert.equal(r.message, 'Кэш DNS сброшен');
  assert.ok(w.calls.some((c) => /ipconfig/.test(c[0]) && c[1][0] === '/flushdns'));
  await assert.rejects(t.apply({ id: 'restore_point' }), { code: 'NEEDS_ADMIN' });
  await assert.rejects(t.apply({ id: 'nope' }), { code: 'NOT_FOUND' });
});

test('clean_temp deletes only old files inside temp roots, never the root, never through symlinks', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-clean-'));
  const temp = path.join(base, 'Temp');
  const outside = path.join(base, 'precious');
  fs.mkdirSync(path.join(temp, 'old-dir', 'nested'), { recursive: true });
  fs.mkdirSync(outside);
  const old = Date.now() / 1000 - 3 * 3600;
  const mk = (p, size) => { fs.writeFileSync(p, Buffer.alloc(size, 1)); fs.utimesSync(p, old, old); };
  mk(path.join(temp, 'a.tmp'), 1024 * 1024);
  mk(path.join(temp, 'old-dir', 'nested', 'b.log'), 2 * 1024 * 1024);
  fs.writeFileSync(path.join(temp, 'fresh.tmp'), 'in use'); // modified just now -> kept
  mk(path.join(outside, 'keep.txt'), 10);
  fs.symlinkSync(outside, path.join(temp, 'link-to-precious'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const d of [path.join(temp, 'old-dir', 'nested'), path.join(temp, 'old-dir')]) fs.utimesSync(d, old, old);

  const w = fakeWindows();
  run.setRunner(w.runner);
  const t = tw.createTweaks({ platform: 'win32', store: memoryStore(), isAdmin: async () => false, tempRoots: () => [temp, base], env: {} });
  const r = await t.apply({ id: 'clean_temp' });
  assert.equal(r.state, 'off');
  assert.match(r.message, /^Освобождено 3 МБ/);
  assert.ok(fs.existsSync(temp), 'root survives');
  assert.ok(!fs.existsSync(path.join(temp, 'a.tmp')));
  assert.ok(!fs.existsSync(path.join(temp, 'old-dir')), 'emptied old folder removed');
  assert.ok(fs.existsSync(path.join(temp, 'fresh.tmp')));
  assert.ok(fs.existsSync(path.join(outside, 'keep.txt')), 'symlink target untouched');
  assert.ok(fs.lstatSync(path.join(temp, 'link-to-precious')).isSymbolicLink());
  // `base` is not called temp/tmp, so it is refused as a root even though it was offered.
  assert.ok(fs.existsSync(path.join(outside, 'keep.txt')));
  fs.rmSync(base, { recursive: true, force: true });
});

test('clean_temp accepts a Remote Desktop session folder (Temp\\2) but not other numbered folders', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-clean-rdp-'));
  const session = path.join(base, 'Temp', '2');
  const notTemp = path.join(base, 'Games', '3');
  fs.mkdirSync(session, { recursive: true });
  fs.mkdirSync(notTemp, { recursive: true });
  const old = Date.now() / 1000 - 3 * 3600;
  for (const d of [session, notTemp]) {
    fs.writeFileSync(path.join(d, 'x.tmp'), Buffer.alloc(1024, 1));
    fs.utimesSync(path.join(d, 'x.tmp'), old, old);
  }
  const w = fakeWindows();
  run.setRunner(w.runner);
  const t = tw.createTweaks({ platform: 'win32', store: memoryStore(), isAdmin: async () => false, tempRoots: () => [session, notTemp], env: {} });
  await t.apply({ id: 'clean_temp' });
  assert.ok(!fs.existsSync(path.join(session, 'x.tmp')), 'session temp cleaned');
  assert.ok(fs.existsSync(session), 'session root kept');
  assert.ok(fs.existsSync(path.join(notTemp, 'x.tmp')), 'a numbered folder outside Temp is never touched');
  const only = tw.createTweaks({ platform: 'win32', store: memoryStore(), isAdmin: async () => false, tempRoots: () => [notTemp], env: {} });
  await assert.rejects(only.apply({ id: 'clean_temp' }), { code: 'NOT_FOUND' });
  run.setRunner(null);
  fs.rmSync(base, { recursive: true, force: true });
});

test('clean_temp: a folder swapped for a link after its lstat is never walked or deleted through', async () => {
  const fsp = require('node:fs/promises');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-clean-race-'));
  const temp = path.join(base, 'Temp');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(temp, 'x'), { recursive: true });
  fs.mkdirSync(outside);
  const old = Date.now() / 1000 - 5 * 3600;
  for (const p of [path.join(temp, 'x', 'decoy.txt'), path.join(outside, 'precious.txt')]) {
    fs.writeFileSync(p, 'data');
    fs.utimesSync(p, old, old);
  }
  fs.utimesSync(path.join(temp, 'x'), old, old);
  const origLstat = fsp.lstat;
  let swapped = false;
  fsp.lstat = async (p, ...a) => {
    const r = await origLstat(p, ...a);
    if (!swapped && p === path.join(temp, 'x')) { // another user swaps the folder right after GinN looked at it
      swapped = true;
      fs.rmSync(path.join(temp, 'x'), { recursive: true });
      fs.symlinkSync(outside, path.join(temp, 'x'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    return r;
  };
  try {
    run.setRunner(fakeWindows().runner);
    const t = tw.createTweaks({ platform: 'win32', store: memoryStore(), isAdmin: async () => true, tempRoots: () => [temp], env: {} });
    const r = await t.apply({ id: 'clean_temp' });
    assert.ok(swapped);
    assert.deepEqual(fs.readdirSync(outside), ['precious.txt'], 'nothing outside temp is deleted');
    assert.match(r.message, /Пропущено/);
  } finally {
    fsp.lstat = origLstat;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('clean_temp: Windows\\Temp (any user may create folders there) is cleaned only at its top level', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-clean-sys-'));
  const sysTemp = path.join(base, 'Windows', 'Temp');
  const userTemp = path.join(base, 'User', 'Temp');
  const old = Date.now() / 1000 - 3 * 3600;
  const mk = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); fs.utimesSync(p, old, old); };
  mk(path.join(sysTemp, 'top.tmp'));
  mk(path.join(sysTemp, 'someones-dir', 'inner.tmp'));
  mk(path.join(userTemp, 'mine', 'inner.tmp'));
  fs.utimesSync(path.join(sysTemp, 'someones-dir'), old, old);
  fs.utimesSync(path.join(userTemp, 'mine'), old, old);
  run.setRunner(fakeWindows().runner);
  const t = tw.createTweaks({
    platform: 'win32', store: memoryStore(), isAdmin: async () => true,
    tempRoots: () => [userTemp, sysTemp], env: { SystemRoot: path.join(base, 'Windows') }
  });
  await t.apply({ id: 'clean_temp' });
  assert.ok(!fs.existsSync(path.join(sysTemp, 'top.tmp')), 'top-level file in Windows\\Temp removed');
  assert.ok(fs.existsSync(path.join(sysTemp, 'someones-dir', 'inner.tmp')), 'folders in Windows\\Temp are not walked');
  assert.ok(!fs.existsSync(path.join(userTemp, 'mine')), 'the user\'s own temp is still cleaned recursively');
  fs.rmSync(base, { recursive: true, force: true });
});

test('elevated as another account: HKCU tweaks are refused and read as unknown, HKLM tweaks and revertAll still work', async () => {
  const w = fakeWindows({ registry: { [GCS]: { GameDVR_Enabled: ['REG_DWORD', 1] } } });
  run.setRunner(w.runner);
  const store = memoryStore();
  store.data.tweaks.game_mode = { entries: { x: { key: 'HKCU\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', exists: true, type: 'REG_DWORD', value: 0 } } };
  const t = tw.createTweaks({ platform: 'win32', store, isAdmin: async () => true, isOtherUser: async () => true, env: {} });
  const list = await t.list();
  for (const id of ['game_mode', 'game_dvr_off', 'fso_off', 'mouse_accel_off', 'sticky_keys_off']) {
    assert.equal(list.find((x) => x.id === id).state, 'unknown', id);
  }
  const before = w.calls.length;
  await assert.rejects(t.apply({ id: 'game_dvr_off', enable: true }), { code: 'UNSUPPORTED', message: /другой учётной записи/ });
  await assert.rejects(t.apply({ id: 'mouse_accel_off', enable: false }), { code: 'UNSUPPORTED' });
  assert.ok(!w.calls.slice(before).some(([f, a]) => /reg/i.test(f) && a[0] !== 'query'), 'nothing written');
  assert.equal(w.getValue(GCS, 'GameDVR_Enabled'), 1);
  assert.equal(store.data.tweaks.game_dvr_off, undefined, 'no backup taken');
  // machine-wide tweaks are the same for every account
  assert.equal((await t.apply({ id: 'hags', enable: true })).state, 'on');
  // backups this account made earlier are still undone in this account's hive
  const res = await t.revertAll();
  assert.ok(res.reverted.includes('game_mode'));
  assert.equal(w.getValue('HKCU\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled'), 0);
});

test('non-Windows: list has unknown states, apply -> UNSUPPORTED', async () => {
  const t = tw.createTweaks({ platform: 'linux', store: memoryStore() });
  const list = await t.list();
  assert.ok(list.length > 10 && list.every((x) => x.state === 'unknown'));
  await assert.rejects(t.apply({ id: 'game_mode', enable: true }), { code: 'UNSUPPORTED', message: 'Доступно только в Windows' });
});
