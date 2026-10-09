'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mc = require('../src/gamecfg/minecraft');
const cs2 = require('../src/gamecfg/cs2');
const fn = require('../src/gamecfg/fortnite');
const { createProfiles } = require('../src/gamecfg');
const { memoryStore } = require('./fakes');

const OPTIONS = [
  'version:3955',
  'ao:true',
  'biomeBlendRadius:2',
  'enableVsync:true',
  'entityDistanceScaling:1.0',
  'entityShadows:true',
  'graphicsMode:1',
  'maxFps:120',
  'mipmapLevels:4',
  'particles:0',
  'renderClouds:"true"',
  'renderDistance:12',
  'simulationDistance:12',
  'resourcePacks:["vanilla","file/Faithful.zip"]',
  'incompatibleResourcePacks:[]',
  'lang:ru_ru',
  'key_key.jump:key.keyboard.space',
  ''
].join('\n');

const kv = (text) => Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]));

test('minecraft: potato edits existing keys in place, keeps every other line', () => {
  const out = mc.transformOptions(OPTIONS, { fps: 144, preset: 'potato', grayTextures: false });
  const o = kv(out);
  assert.equal(o.renderDistance, '4');
  assert.equal(o.simulationDistance, '5');
  assert.equal(o.graphicsMode, '0');
  assert.equal(o.ao, 'false');
  assert.equal(o.renderClouds, '"false"');
  assert.equal(o.particles, '2');
  assert.equal(o.entityShadows, 'false');
  assert.equal(o.entityDistanceScaling, '0.5');
  assert.equal(o.biomeBlendRadius, '0');
  assert.equal(o.mipmapLevels, '0');
  assert.equal(o.enableVsync, 'false');
  assert.equal(o.maxFps, '144');
  assert.equal(o.bobView, 'false', 'missing key appended');
  assert.equal(o.lang, 'ru_ru');
  assert.equal(o['key_key.jump'], 'key.keyboard.space');
  assert.equal(o.resourcePacks, '["vanilla","file/Faithful.zip"]', 'packs untouched without gray textures');
  const lines = out.split('\n');
  assert.equal(lines[0], 'version:3955');
  assert.equal(lines.indexOf('renderDistance:4'), OPTIONS.split('\n').indexOf('renderDistance:12'), 'same position');
});

test('minecraft: gray textures appended last, idempotent, removed again when switched off', () => {
  const once = mc.transformOptions(OPTIONS, { fps: 500, preset: 'potato', grayTextures: true });
  assert.equal(kv(once).resourcePacks, '["vanilla","file/Faithful.zip","file/GinN-Gray.zip"]');
  assert.equal(kv(once).maxFps, '260', '260 = unlimited slider max');
  const twice = mc.transformOptions(once, { fps: 500, preset: 'potato', grayTextures: true });
  assert.equal(twice, once);
  const off = mc.transformOptions(once, { fps: 60, preset: 'balanced', grayTextures: false });
  assert.equal(kv(off).resourcePacks, '["vanilla","file/Faithful.zip"]');
  assert.equal(kv(off).renderDistance, '8');
  assert.equal(kv(off).graphicsMode, '1');
  assert.equal(kv(off).maxFps, '60');
});

test('minecraft: missing keys, CRLF, old numeric ao, fancyGraphics, broken pack list', () => {
  const src = 'version:1976\r\nao:2\r\nfancyGraphics:true\r\nresourcePacks:not-json\r\n';
  const out = mc.transformOptions(src, { fps: 75, preset: 'potato', grayTextures: true });
  assert.ok(!/[^\r]\n/.test(out), 'CRLF kept');
  const o = kv(out);
  assert.equal(o.ao, '0');
  assert.equal(o.fancyGraphics, 'false');
  assert.equal(o.graphicsMode, undefined);
  assert.equal(o.resourcePacks, '["file/GinN-Gray.zip"]');
  assert.equal(o.renderDistance, '4');
  assert.equal(mc.transformOptions('', { fps: 60, preset: 'potato' }).split('\n')[0], 'renderDistance:4');
});

test('cs2: autoexec block inserted once, replaced on re-apply, user lines kept', () => {
  const user = 'bind "F" "+lookatweapon"\r\nsensitivity 1.2\r\n';
  const a = cs2.transformAutoexec(user, { fps: 240 });
  assert.ok(a.startsWith(user.trimEnd()));
  assert.match(a, /fps_max 240\r\n/);
  const b = cs2.transformAutoexec(a, { fps: 1000 });
  assert.equal((b.match(/>>> GinN/g) || []).length, 1);
  assert.match(b, /fps_max 0\r\n/);
  assert.ok(!/fps_max 240/.test(b));
  assert.equal(cs2.transformAutoexec(b, { fps: 1000 }), b, 'idempotent');
  assert.equal(cs2.transformAutoexec('', { fps: 144 }), cs2.BEGIN + '\nfps_max 144\nfps_max_ui 120\n' + cs2.END + '\n');
});

test('cs2: video config lowers only keys that exist, format intact', () => {
  const video = '"video.cfg"\r\n{\r\n\t"Version"\t\t"14"\r\n\t"setting.msaa_samples"\t\t"8"\r\n' +
    '\t"setting.videocfg_shadow_quality"\t\t"3"\r\n\t"setting.mat_vsync"\t\t"0"\r\n}\r\n';
  const out = cs2.transformVideo(video, 'potato');
  assert.equal(out, video.replace('"setting.msaa_samples"\t\t"8"', '"setting.msaa_samples"\t\t"0"')
    .replace('"setting.videocfg_shadow_quality"\t\t"3"', '"setting.videocfg_shadow_quality"\t\t"0"'));
  assert.ok(!/shaderquality/.test(out), 'absent keys are not invented');
  assert.match(cs2.transformVideo(video, 'balanced'), /"setting\.msaa_samples"\t\t"2"/);
});

test('fortnite: edits keys, preserves other lines, adds missing section and keys', () => {
  const ini = '[/Script/FortniteGame.FortGameUserSettings]\r\nFrameRateLimit=60.000000\r\nbShowFPS=True\r\n\r\n' +
    '[/Script/Engine.GameUserSettings]\r\nbUseVSync=False\r\n';
  const out = fn.transformIni(ini, { fps: 165, preset: 'potato' });
  const lines = out.split('\r\n');
  assert.ok(lines.includes('FrameRateLimit=165.000000'));
  assert.ok(lines.includes('bShowFPS=True'));
  assert.ok(lines.includes('bUseVSync=False'));
  const sg = lines.indexOf('[ScalabilityGroups]');
  assert.ok(sg > 0, 'section added');
  for (const k of ['sg.ViewDistanceQuality=0', 'sg.ShadowQuality=0', 'sg.PostProcessQuality=0', 'sg.TextureQuality=0',
    'sg.EffectsQuality=0', 'sg.FoliageQuality=0', 'sg.ShadingQuality=0', 'sg.ResolutionQuality=100']) {
    assert.ok(lines.indexOf(k) > sg, k);
  }
  assert.equal(fn.transformIni(out, { fps: 165, preset: 'potato' }), out, 'idempotent');
  const bal = fn.transformIni(out, { fps: 1000, preset: 'balanced' });
  assert.ok(bal.includes('FrameRateLimit=0.000000'));
  assert.ok(bal.includes('sg.ViewDistanceQuality=2'));
  assert.equal((bal.match(/\[ScalabilityGroups\]/g) || []).length, 1);
});

test('fortnite: existing ScalabilityGroups values are replaced in place, unknown keys kept', () => {
  const ini = '[ScalabilityGroups]\nsg.ResolutionQuality=75.000000\nsg.ShadowQuality=3\nsg.AntiAliasingQuality=3\n\n[Other]\nx=1\n';
  const out = fn.transformIni(ini, { fps: 120, preset: 'potato' });
  assert.match(out, /^\[ScalabilityGroups\]\nsg\.ResolutionQuality=100\nsg\.ShadowQuality=0\nsg\.AntiAliasingQuality=3\n/);
  assert.match(out, /\n\[Other\]\nx=1\n/);
  assert.match(out, /\[\/Script\/FortniteGame\.FortGameUserSettings\]\nFrameRateLimit=120\.000000\n$/);
});

test('fortnite: a UTF-8 BOM stays where it was, and none is added to files without one', () => {
  const ini = '﻿[/Script/FortniteGame.FortGameUserSettings]\r\nFrameRateLimit=60.000000\r\n';
  const out = fn.transformIni(ini, { fps: 144, preset: 'balanced' });
  assert.equal(out.charCodeAt(0), 0xFEFF);
  assert.equal((out.match(/﻿/g) || []).length, 1);
  assert.ok(out.includes('[/Script/FortniteGame.FortGameUserSettings]\r\nFrameRateLimit=144.000000\r\n'));
  assert.notEqual(fn.transformIni('[A]\nb=1\n', { fps: 60, preset: 'potato' }).charCodeAt(0), 0xFEFF);
});

test('profiles: minecraft apply backs up originals, revert restores and removes GinN files', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-prof-'));
  const appdata = path.join(base, 'Roaming');
  const mcDir = path.join(appdata, '.minecraft');
  fs.mkdirSync(mcDir, { recursive: true });
  fs.writeFileSync(path.join(mcDir, 'options.txt'), OPTIONS);
  const store = memoryStore();
  const p = createProfiles({
    platform: 'win32', store, backupRoot: path.join(base, 'backups'), env: { APPDATA: appdata },
    run: async () => ({ code: 0, stdout: '', stderr: '' })
  });
  const r = await p.apply({ gameId: 'minecraft', fps: 144, preset: 'potato', grayTextures: true });
  assert.deepEqual(r.written, [path.join(mcDir, 'options.txt'), path.join(mcDir, 'resourcepacks', 'GinN-Gray.zip')]);
  assert.match(r.message, /Minecraft/);
  assert.ok(fs.existsSync(path.join(mcDir, 'resourcepacks', 'GinN-Gray.zip')));
  assert.match(fs.readFileSync(path.join(mcDir, 'options.txt'), 'utf8'), /renderDistance:4/);
  // second apply must not replace the original backup
  await p.apply({ gameId: 'minecraft', fps: 60, preset: 'balanced', grayTextures: true });
  assert.equal(store.data.games.minecraft.files.length, 2);
  assert.equal(fs.readFileSync(path.join(base, 'backups', 'minecraft', '1-options.txt'), 'utf8'), OPTIONS);

  const rv = await p.revert({ gameId: 'minecraft' });
  assert.match(rv.message, /возвращены/);
  assert.equal(fs.readFileSync(path.join(mcDir, 'options.txt'), 'utf8'), OPTIONS);
  assert.ok(!fs.existsSync(path.join(mcDir, 'resourcepacks', 'GinN-Gray.zip')));
  assert.ok(!fs.existsSync(path.join(base, 'backups', 'minecraft')));
  assert.equal(store.data.games.minecraft, undefined);
  await assert.rejects(p.revert({ gameId: 'minecraft' }), { code: 'NOT_FOUND' });
  fs.rmSync(base, { recursive: true, force: true });
});

test('profiles: missing game files -> NOT_FOUND, unknown game -> UNSUPPORTED, running game -> FAILED', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-prof2-'));
  const local = path.join(base, 'Local');
  const store = memoryStore();
  let running = false;
  const p = createProfiles({
    platform: 'win32', store, backupRoot: path.join(base, 'b'), env: { APPDATA: path.join(base, 'none'), LOCALAPPDATA: local },
    games: { steamAppDir: async () => ({ root: null, lib: null, dir: null }) },
    run: async (file, args) => ({ code: 0, stdout: running && /Fortnite/.test(args[1]) ? '"FortniteClient-Win64-Shipping.exe","123"' : 'INFO: none', stderr: '' })
  });
  await assert.rejects(p.apply({ gameId: 'minecraft', fps: 60, preset: 'potato' }), { code: 'NOT_FOUND' });
  await assert.rejects(p.apply({ gameId: 'cs2', fps: 60, preset: 'potato' }), { code: 'NOT_FOUND' });
  await assert.rejects(p.apply({ gameId: 'fortnite', fps: 60, preset: 'potato' }), { code: 'NOT_FOUND' });
  await assert.rejects(p.apply({ gameId: 'valorant', fps: 60, preset: 'potato' }), { code: 'UNSUPPORTED' });
  await assert.rejects(p.apply({ gameId: 'minecraft', fps: 'lots', preset: 'potato' }), { code: 'BAD_ARGS' });
  const ini = path.join(local, 'FortniteGame', 'Saved', 'Config', 'WindowsClient', 'GameUserSettings.ini');
  fs.mkdirSync(path.dirname(ini), { recursive: true });
  fs.writeFileSync(ini, '[/Script/FortniteGame.FortGameUserSettings]\nFrameRateLimit=60.000000\n');
  running = true;
  await assert.rejects(p.apply({ gameId: 'fortnite', fps: 144, preset: 'potato' }), { code: 'FAILED', message: /закрой игру/ });
  running = false;
  const r = await p.apply({ gameId: 'fortnite', fps: 144, preset: 'potato' });
  assert.deepEqual(r.written, [ini]);
  assert.match(fs.readFileSync(ini, 'utf8'), /FrameRateLimit=144\.000000/);
  await p.revertAll();
  assert.equal(fs.readFileSync(ini, 'utf8'), '[/Script/FortniteGame.FortGameUserSettings]\nFrameRateLimit=60.000000\n');
  fs.rmSync(base, { recursive: true, force: true });
});

test('profiles: cs2 writes autoexec (created -> deleted on revert) and every cs2_video.txt', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-cs2-'));
  const steam = path.join(base, 'Steam');
  const game = path.join(steam, 'steamapps', 'common', 'Counter-Strike Global Offensive');
  fs.mkdirSync(path.join(game, 'game', 'csgo', 'cfg'), { recursive: true });
  const video = path.join(steam, 'userdata', '12345', '730', 'local', 'cfg', 'cs2_video.txt');
  fs.mkdirSync(path.dirname(video), { recursive: true });
  const videoText = '"video.cfg"\n{\n\t"setting.msaa_samples"\t\t"4"\n}\n';
  fs.writeFileSync(video, videoText);
  const p = createProfiles({
    platform: 'win32', store: memoryStore(), backupRoot: path.join(base, 'b'), env: {},
    games: { steamAppDir: async () => ({ root: steam, lib: steam, dir: game }) },
    run: async () => ({ code: 0, stdout: 'INFO: none', stderr: '' })
  });
  const r = await p.apply({ gameId: 'cs2', fps: 300, preset: 'potato' });
  const autoexec = path.join(game, 'game', 'csgo', 'cfg', 'autoexec.cfg');
  assert.deepEqual(r.written, [autoexec, video]);
  assert.match(fs.readFileSync(autoexec, 'utf8'), /fps_max 300/);
  assert.match(fs.readFileSync(video, 'utf8'), /"setting\.msaa_samples"\t\t"0"/);
  assert.match(r.message, /\+exec autoexec/);
  await p.revert({ gameId: 'cs2' });
  assert.ok(!fs.existsSync(autoexec), 'autoexec GinN created is removed');
  assert.equal(fs.readFileSync(video, 'utf8'), videoText);
  fs.rmSync(base, { recursive: true, force: true });
});

test('minecraft: gray pack is put in incompatibleResourcePacks before 1.20.2 (pack_format 34 is "too new" there), not after', () => {
  const at = (version, inc, extra) => mc.transformOptions('version:' + version + '\nresourcePacks:["vanilla"]\n' +
    (inc === null ? '' : 'incompatibleResourcePacks:' + inc + '\n') + (extra || ''), { fps: 60, preset: 'potato', grayTextures: true });
  // 1.20.1 (3465): Minecraft drops the pack on start unless the player's "load anyway" answer is there
  assert.equal(kv(at(3465, '[]')).incompatibleResourcePacks, '["file/GinN-Gray.zip"]');
  assert.equal(kv(at(3465, null)).incompatibleResourcePacks, '["file/GinN-Gray.zip"]', 'line added when missing');
  assert.equal(kv(at(3465, '["file/GinN-Gray.zip"]')).incompatibleResourcePacks, '["file/GinN-Gray.zip"]', 'existing answer kept');
  assert.equal(kv(at(1976, '["file/Old.zip"]')).incompatibleResourcePacks, '["file/Old.zip","file/GinN-Gray.zip"]');
  const twice = mc.transformOptions(at(3465, '[]'), { fps: 60, preset: 'potato', grayTextures: true });
  assert.equal(twice, at(3465, '[]'), 'idempotent');
  // 1.20.2+ (3578): the pack is compatible; a listed compatible pack is not loaded on that start, so it is un-listed
  assert.equal(kv(at(3578, '["file/GinN-Gray.zip","file/Old.zip"]')).incompatibleResourcePacks, '["file/Old.zip"]');
  assert.equal(kv(at(3955, '[]')).incompatibleResourcePacks, '[]');
  // unknown version: the player's list is left alone
  const unknown = mc.transformOptions('incompatibleResourcePacks:["file/GinN-Gray.zip"]\n', { fps: 60, preset: 'potato', grayTextures: true });
  assert.equal(kv(unknown).incompatibleResourcePacks, '["file/GinN-Gray.zip"]');
  // gray textures switched off: the pack leaves both lists
  const off = mc.transformOptions(at(3465, '["file/Old.zip"]'), { fps: 60, preset: 'potato', grayTextures: false });
  assert.equal(kv(off).resourcePacks, '["vanilla"]');
  assert.equal(kv(off).incompatibleResourcePacks, '["file/Old.zip"]');
});

test('minecraft: balanced after potato does not keep potato-only values (bobView)', () => {
  const potato = mc.transformOptions(OPTIONS, { fps: 60, preset: 'potato' });
  assert.equal(kv(potato).bobView, 'false');
  const balanced = mc.transformOptions(potato, { fps: 60, preset: 'balanced' });
  assert.equal(kv(balanced).bobView, 'true');
  assert.deepEqual(Object.keys(mc.PRESETS.balanced).sort(), Object.keys(mc.PRESETS.potato).sort(), 'both presets set the same keys');
});

test('cs2 / fortnite / minecraft revert hooks undo only what GinN wrote', () => {
  // autoexec: block (and GinN's blank line) removed, player lines before and after kept
  const user = 'bind "F" "+lookatweapon"\r\n';
  const applied = cs2.transformAutoexec(user, { fps: 240 }) + 'alias "jt" "+jump;-attack"\r\n';
  assert.equal(cs2.removeAutoexecBlock(applied), user + 'alias "jt" "+jump;-attack"\r\n');
  assert.equal(cs2.removeAutoexecBlock(cs2.transformAutoexec(user, { fps: 240 })), user);
  assert.equal(cs2.revertText('autoexec.cfg', cs2.transformAutoexec('', { fps: 60 }), null), null, 'GinN-only file -> delete');
  assert.equal(cs2.revertText('autoexec.cfg', cs2.transformAutoexec('', { fps: 60 }), ''), '', 'existed empty -> stays, empty');
  assert.equal(cs2.revertText('autoexec.cfg', 'echo hi\n', null), 'echo hi\n', 'no block -> unchanged');
  // cs2_video: GinN's keys go back to the copy; a key GinN never touches keeps the value the player set since
  const video = '"video.cfg"\n{\n\t"setting.msaa_samples"\t\t"8"\n\t"setting.mat_vsync"\t\t"0"\n}\n';
  const now = cs2.transformVideo(video, 'potato').replace('"setting.mat_vsync"\t\t"0"', '"setting.mat_vsync"\t\t"1"');
  assert.equal(cs2.revertText('cs2_video.txt', now, video), video.replace('"setting.mat_vsync"\t\t"0"', '"setting.mat_vsync"\t\t"1"'));
  // fortnite: keys back, keys GinN added removed, a section GinN added dropped, player's later edits kept
  const ini = '[/Script/FortniteGame.FortGameUserSettings]\r\nFrameRateLimit=60.000000\r\nbShowFPS=False\r\n';
  const out = fn.transformIni(ini, { fps: 144, preset: 'potato' }).replace('bShowFPS=False', 'bShowFPS=True');
  assert.equal(fn.revertText('GameUserSettings.ini', out, ini), ini.replace('bShowFPS=False', 'bShowFPS=True'));
  const sg = '[ScalabilityGroups]\nsg.ShadowQuality=3\nsg.AntiAliasingQuality=3\n';
  assert.equal(fn.revertIni(fn.transformIni(sg, { fps: 60, preset: 'potato' }), sg), sg);
  // minecraft: GinN keys back / appended ones removed, keybinds and other settings changed later kept
  const mcNow = mc.transformOptions(OPTIONS, { fps: 144, preset: 'potato', grayTextures: true })
    .replace('key_key.jump:key.keyboard.space', 'key_key.jump:key.keyboard.j').replace('lang:ru_ru', 'lang:en_us');
  assert.equal(mc.revertText('options.txt', mcNow, OPTIONS),
    OPTIONS.replace('key_key.jump:key.keyboard.space', 'key_key.jump:key.keyboard.j').replace('lang:ru_ru', 'lang:en_us'));
  assert.equal(mc.revertText('GinN-Gray.zip', 'x', null), undefined, 'the pack itself is restored / deleted whole');
});

test('profiles: revert keeps what the player changed after the apply (cs2 binds, Minecraft keybinds)', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-revert-'));
  const steam = path.join(base, 'Steam');
  const game = path.join(steam, 'steamapps', 'common', 'Counter-Strike Global Offensive');
  const cfg = path.join(game, 'game', 'csgo', 'cfg');
  fs.mkdirSync(cfg, { recursive: true });
  const appdata = path.join(base, 'Roaming');
  const mcDir = path.join(appdata, '.minecraft');
  fs.mkdirSync(mcDir, { recursive: true });
  fs.writeFileSync(path.join(mcDir, 'options.txt'), OPTIONS);
  const p = createProfiles({
    platform: 'win32', store: memoryStore(), backupRoot: path.join(base, 'b'), env: { APPDATA: appdata },
    games: { steamAppDir: async () => ({ root: null, lib: steam, dir: game }) },
    run: async () => ({ code: 0, stdout: 'INFO: none', stderr: '' })
  });
  // CS2: autoexec.cfg did not exist; the player adds binds to the file GinN created
  await p.apply({ gameId: 'cs2', fps: 240, preset: 'potato' });
  const autoexec = path.join(cfg, 'autoexec.cfg');
  fs.appendFileSync(autoexec, 'bind "mouse4" "+voicerecord"\n');
  await p.revert({ gameId: 'cs2' });
  assert.equal(fs.readFileSync(autoexec, 'utf8'), 'bind "mouse4" "+voicerecord"\n', 'binds kept, GinN block gone');
  // second round: autoexec exists now -> block removed again, later lines kept
  await p.apply({ gameId: 'cs2', fps: 144, preset: 'potato' });
  fs.appendFileSync(autoexec, 'sensitivity 1.1\n');
  await p.revert({ gameId: 'cs2' });
  assert.equal(fs.readFileSync(autoexec, 'utf8'), 'bind "mouse4" "+voicerecord"\nsensitivity 1.1\n');
  // Minecraft: the player rebinds a key in game after the apply
  const opt = path.join(mcDir, 'options.txt');
  await p.apply({ gameId: 'minecraft', fps: 144, preset: 'potato', grayTextures: true });
  fs.writeFileSync(opt, fs.readFileSync(opt, 'utf8').replace('key_key.jump:key.keyboard.space', 'key_key.jump:key.keyboard.j'));
  await p.revert({ gameId: 'minecraft' });
  assert.equal(fs.readFileSync(opt, 'utf8'), OPTIONS.replace('key_key.jump:key.keyboard.space', 'key_key.jump:key.keyboard.j'));
  assert.ok(!fs.existsSync(path.join(mcDir, 'resourcepacks', 'GinN-Gray.zip')));
  // a config the player deleted since comes back from the copy whole
  await p.apply({ gameId: 'minecraft', fps: 60, preset: 'balanced', grayTextures: false });
  fs.unlinkSync(opt);
  await p.revert({ gameId: 'minecraft' });
  assert.equal(fs.readFileSync(opt, 'utf8'), OPTIONS.replace('key_key.jump:key.keyboard.space', 'key_key.jump:key.keyboard.j'));
  fs.rmSync(base, { recursive: true, force: true });
});
