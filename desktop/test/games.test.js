'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vdf = require('../src/vdf');
const games = require('../src/games');

const LIBRARY_NEW = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"contentid"		"123456789"
		"totalsize"		"0"
		"apps"
		{
			"228980"		"123"
			"730"		"35000000000"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
		"label"		"Игры"
		"apps"
		{
			"570"		"1"
		}
	}
}
`;

const LIBRARY_OLD = `"LibraryFolders"
{
	"TimeNextStatsReport"		"1580000000"
	"ContentStatsID"		"-123"
	"1"		"E:\\\\Games\\\\Steam"
}`;

const ACF = `"AppState"
{
	"appid"		"730"
	"universe"		"1"
	"LauncherPath"		"C:\\\\Program Files (x86)\\\\Steam\\\\steam.exe"
	"name"		"Counter-Strike 2"
	"StateFlags"		"4"
	"installdir"		"Counter-Strike Global Offensive"
	"UserConfig"
	{
		"language"		"russian"
	}
	"InstalledDepots" { "731" { "manifest" "123" "size" "1" } }
}`;

test('VDF parser: nesting, escapes, comments, case-insensitive get', () => {
  const v = vdf.parse('// comment\n"Root" { "a\\"b" "c\\\\d" "Sub" { "x" "1" } bare value [$WIN32] "n" "line\\nbreak" }');
  const root = vdf.get(v, 'root');
  assert.equal(root['a"b'], 'c\\d');
  assert.equal(vdf.get(vdf.get(root, 'SUB'), 'X'), '1');
  assert.equal(root.bare, 'value');
  assert.equal(root.n, 'line\nbreak');
});

test('libraryfolders.vdf: new and old formats', () => {
  assert.deepEqual(games.parseLibraryFolders(LIBRARY_NEW), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  assert.deepEqual(games.parseLibraryFolders(LIBRARY_OLD), ['E:\\Games\\Steam']);
  assert.deepEqual(games.parseLibraryFolders('garbage'), []);
});

test('appmanifest ACF parsing and the non-game skip list', () => {
  const m = games.parseAppManifest(ACF);
  assert.deepEqual(m, { appid: 730, name: 'Counter-Strike 2', installdir: 'Counter-Strike Global Offensive', stateFlags: 4 });
  assert.ok(games.isSteamGame(m));
  assert.ok(games.isSteamGame(Object.assign({}, m, { stateFlags: 6 })), 'update pending is still installed');
  assert.ok(!games.isSteamGame(Object.assign({}, m, { stateFlags: 1026 })), 'not fully installed');
  for (const id of [228980, 1070560, 1391110, 1628350, 1493710]) {
    assert.ok(!games.isSteamGame({ appid: id, name: 'X', installdir: 'x', stateFlags: 4 }), String(id));
  }
  assert.ok(!games.isSteamGame({ appid: 99999999, name: 'Proton 9.0', installdir: 'x', stateFlags: 4 }));
  assert.equal(games.parseAppManifest('"AppState" { "name" "no id" }'), null);
});

test('Epic manifest parsing: games kept; engines, DLC, broken installs skipped; launch URL', () => {
  const fortnite = {
    FormatVersion: 0, bIsIncompleteInstall: false, DisplayName: 'Fortnite', AppName: 'Fortnite',
    CatalogNamespace: 'fn', CatalogItemId: '4fe75bbc5a674f4f9b356b5c90567da5',
    InstallLocation: 'C:\\Program Files\\Epic Games\\Fortnite',
    LaunchExecutable: 'FortniteGame/Binaries/Win64/FortniteClient-Win64-Shipping.exe',
    AppCategories: ['public', 'games', 'applications'], MainGameAppName: 'Fortnite'
  };
  const g = games.parseEpicManifest(JSON.stringify(fortnite));
  assert.deepEqual(g, {
    appName: 'Fortnite', name: 'Fortnite', ns: 'fn', itemId: '4fe75bbc5a674f4f9b356b5c90567da5',
    installLocation: 'C:\\Program Files\\Epic Games\\Fortnite',
    launchExe: 'FortniteGame/Binaries/Win64/FortniteClient-Win64-Shipping.exe'
  });
  assert.equal(games.epicLaunchUrl(g),
    'com.epicgames.launcher://apps/fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite?action=launch&silent=true');
  assert.equal(games.parseEpicManifest(Object.assign({}, fortnite, { AppName: 'UE_5.3' })), null);
  assert.equal(games.parseEpicManifest(Object.assign({}, fortnite, { bIsIncompleteInstall: true })), null);
  assert.equal(games.parseEpicManifest(Object.assign({}, fortnite, { AppCategories: ['plugins', 'engines'] })), null);
  assert.equal(games.parseEpicManifest(Object.assign({}, fortnite, { AppName: 'DLC1', MainGameAppName: 'Fortnite' })), null);
  assert.equal(games.parseEpicManifest('{not json'), null);
});

test('boost script targets the install dir and reports results honestly', () => {
  const s = games.boostScript({ dirs: ["C:\\Games\\It's Here\\"], names: ['RobloxPlayerBeta'], seconds: 90 });
  assert.match(s, /\$dirs=@\('C:\\Games\\It''s Here\\'\)/);
  assert.match(s, /\$i -lt 30/);
  assert.match(s, /PriorityClass='High'/);
  assert.equal(games.boostResult('OK cs2\r\n').ok, true);
  assert.match(games.boostResult('DENIED VALORANT-Win64-Shipping').message, /античит/);
  assert.match(games.boostResult('NOTFOUND').message, /Не дождался/);
});

test('detect(): Steam libraries + Epic + Minecraft + Valorant + Roblox from a fake disk', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-games-'));
  const steam = path.join(base, 'Steam');
  const lib2 = path.join(base, 'Lib2');
  const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
  w(path.join(steam, 'steamapps', 'libraryfolders.vdf'),
    '"libraryfolders" { "0" { "path" "' + steam.replace(/\\/g, '\\\\') + '" } "1" { "path" "' + lib2.replace(/\\/g, '\\\\') + '" } }');
  w(path.join(steam, 'steamapps', 'appmanifest_730.acf'), ACF);
  fs.mkdirSync(path.join(steam, 'steamapps', 'common', 'Counter-Strike Global Offensive'), { recursive: true });
  w(path.join(steam, 'steamapps', 'appmanifest_228980.acf'), '"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "StateFlags" "4" }');
  w(path.join(lib2, 'steamapps', 'appmanifest_570.acf'), '"AppState" { "appid" "570" "name" "Dota 2" "StateFlags" "4" "installdir" "dota 2 beta" }');
  const pd = path.join(base, 'ProgramData');
  const fnDir = path.join(base, 'Fortnite');
  fs.mkdirSync(fnDir);
  w(path.join(pd, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests', 'A1.item'), JSON.stringify({
    AppName: 'Fortnite', DisplayName: 'Fortnite', CatalogNamespace: 'fn', CatalogItemId: 'x', InstallLocation: fnDir, AppCategories: ['games']
  }));
  w(path.join(pd, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests', 'B2.item'), JSON.stringify({ AppName: 'UE_5.4', DisplayName: 'Unreal Engine' }));
  const appdata = path.join(base, 'Roaming');
  fs.mkdirSync(path.join(appdata, '.minecraft'), { recursive: true });
  const local = path.join(base, 'Local');
  w(path.join(local, 'Roblox', 'Versions', 'version-abc', 'RobloxPlayerBeta.exe'), 'MZ');
  const valDir = path.join(base, 'Riot Games', 'VALORANT');
  fs.mkdirSync(path.join(valDir, 'live'), { recursive: true });
  w(path.join(pd, 'Riot Games', 'RiotClientInstalls.json'), JSON.stringify({
    associated_client: { [valDir.replace(/\\/g, '/') + '/live/']: path.join(base, 'Riot Games', 'Riot Client', 'RiotClientServices.exe') },
    rc_default: 'C:/Riot Games/Riot Client/RiotClientServices.exe'
  }));

  const fakeReg = {
    query: async (k, n) => (/HKCU\\Software\\Valve\\Steam/.test(k) && n === 'SteamPath' ? { exists: true, type: 'REG_SZ', value: steam } : { exists: false })
  };
  const opened = [];
  const g = games.createGames({
    platform: 'win32', reg: fakeReg,
    env: { ProgramData: pd, APPDATA: appdata, LOCALAPPDATA: local, 'ProgramFiles(x86)': path.join(base, 'pf86'), SystemDrive: path.join(base, 'nodrive') },
    openUrl: async (u) => { opened.push(u); },
    spawnDetached: async () => {}, ps: async () => ({ code: 0, stdout: '' })
  });
  const list = await g.detect();
  assert.deepEqual(list.map((x) => x.id).sort(), ['epic:Fortnite', 'minecraft-java', 'riot:valorant', 'roblox', 'steam:570', 'steam:730']);
  for (const x of list) {
    assert.deepEqual(Object.keys(x).sort(), ['catalogId', 'icon', 'id', 'name', 'source']);
    assert.equal(x.catalogId, null);
    assert.equal(x.icon, null);
  }
  assert.equal(list.find((x) => x.id === 'steam:730').source, 'steam');

  assert.match((await g.launch({ id: 'steam:730', boost: false })).message, /Запускаю Counter-Strike 2/);
  assert.equal(opened.pop(), 'steam://rungameid/730');
  await g.launch({ id: 'epic:Fortnite', boost: true });
  assert.equal(opened.pop(), 'com.epicgames.launcher://apps/fn%3Ax%3AFortnite?action=launch&silent=true');
  await g.launch({ id: 'roblox' });
  assert.equal(opened.pop(), 'roblox://');
  await assert.rejects(g.launch({ id: 'steam:1' }), { code: 'NOT_FOUND' });
  const dir = await g.steamAppDir(730);
  assert.equal(dir.dir, path.join(steam, 'steamapps', 'common', 'Counter-Strike Global Offensive'));
  fs.rmSync(base, { recursive: true, force: true });
});

test('non-Windows: detect() is empty, launch() is UNSUPPORTED', async () => {
  const g = games.createGames({ platform: 'linux', openUrl: async () => {} });
  assert.deepEqual(await g.detect(), []);
  await assert.rejects(g.launch({ id: 'steam:730' }), { code: 'UNSUPPORTED' });
});
