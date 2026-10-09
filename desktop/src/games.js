'use strict';
/**
 * Installed game detection (Steam, Epic, Minecraft Java, Valorant, Roblox) and launching with optional
 * priority boost. Returns contract InstalledGame objects; the UI maps them to its catalog.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vdf = require('./vdf');
const { HostError, unsupported } = require('./errors');
const regDefault = require('./reg');
const runDefault = require('./run');

// Steam "apps" that are not games: redistributables, runtimes, Proton, SteamVR, tools.
const STEAM_SKIP = new Set([228980, 1070560, 1391110, 1628350, 1493710, 250820, 1007, 2180100, 1161040, 1580130,
  1887720, 1826330, 961940, 1054830, 1113280, 1245040, 1420170, 2348590, 2230260, 2805730, 3658110, 431960]);
const STEAM_SKIP_NAME = /^proton\b|steam linux runtime|steamworks common|steamvr|redistributable/i;
const MC_STORE_PKG = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe';

/* ---------------------------------------------------------------- parsers */

/** libraryfolders.vdf -> library root paths (new nested format and the old "1" "D:\\path" format). */
function parseLibraryFolders(text) {
  const root = vdf.parse(text);
  const top = vdf.get(root, 'libraryfolders') || vdf.get(root, 'LibraryFolders') || {};
  const out = [];
  for (const k of Object.keys(top)) {
    if (!/^\d+$/.test(k)) continue;
    const v = top[k];
    const p = typeof v === 'string' ? v : vdf.get(v, 'path');
    if (p) out.push(p);
  }
  return out;
}

/** appmanifest_<id>.acf -> {appid, name, installdir, stateFlags} | null */
function parseAppManifest(text) {
  const st = vdf.get(vdf.parse(text), 'AppState');
  if (!st || typeof st !== 'object') return null;
  const appid = parseInt(vdf.get(st, 'appid'), 10);
  if (!Number.isFinite(appid)) return null;
  const flags = parseInt(vdf.get(st, 'StateFlags'), 10);
  return {
    appid,
    name: String(vdf.get(st, 'name') || 'App ' + appid),
    installdir: String(vdf.get(st, 'installdir') || ''),
    stateFlags: Number.isFinite(flags) ? flags : null
  };
}

function isSteamGame(m) {
  if (!m || STEAM_SKIP.has(m.appid) || STEAM_SKIP_NAME.test(m.name)) return false;
  return m.stateFlags == null || (m.stateFlags & 4) === 4; // 4 = fully installed
}

/** Epic *.item manifest (JSON text or object) -> game info | null for engines, plugins, broken installs. */
function parseEpicManifest(input) {
  let j = input;
  if (typeof input === 'string') { try { j = JSON.parse(input.replace(/^\uFEFF/, '')); } catch (e) { return null; } }
  if (!j || typeof j !== 'object' || !j.AppName) return null;
  if (j.bIsIncompleteInstall) return null;
  if (/^UE_/i.test(j.AppName)) return null;
  const cats = Array.isArray(j.AppCategories) ? j.AppCategories.map((c) => String(c).toLowerCase()) : null;
  if (cats && cats.length && !cats.includes('games')) return null;
  if (j.MainGameAppName && j.MainGameAppName !== j.AppName) return null; // DLC
  return {
    appName: String(j.AppName),
    name: String(j.DisplayName || j.AppName),
    ns: String(j.CatalogNamespace || ''),
    itemId: String(j.CatalogItemId || ''),
    installLocation: String(j.InstallLocation || ''),
    launchExe: String(j.LaunchExecutable || '')
  };
}

function epicLaunchUrl(g) {
  return 'com.epicgames.launcher://apps/' + encodeURIComponent(g.ns) + '%3A' + encodeURIComponent(g.itemId) + '%3A' +
    encodeURIComponent(g.appName) + '?action=launch&silent=true';
}

/** PowerShell that waits up to `seconds` for the game process and raises it to High priority. */
function boostScript(o) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const dirs = (o.dirs || []).filter(Boolean).map((d) => q(d.replace(/[\\/]+$/, '') + '\\'));
  const names = (o.names || []).map(q);
  const title = o.title ? q(o.title) : '$null';
  const tries = Math.max(1, Math.round((o.seconds || 90) / 3));
  return '$dirs=@(' + dirs.join(',') + '); $names=@(' + names.join(',') + '); $title=' + title + '; ' +
    '$seen=@{}; $hit=-1; ' +
    'for ($i=0; $i -lt ' + tries + '; $i++) { ' +
    'foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) { ' +
    'if ($seen.ContainsKey($p.Id)) { continue }; $m=$false; ' +
    'if ($names -contains $p.ProcessName) { $m = (-not $title) -or ($p.MainWindowTitle -like $title) } ' +
    'elseif ($dirs.Count -gt 0) { $path=$null; try { $path=$p.Path } catch {}; ' +
    'if ($path) { foreach ($d in $dirs) { if ($path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase)) { $m=$true } } } } ' +
    'if ($m) { $seen[$p.Id]=1; if ($hit -lt 0) { $hit=$i }; ' +
    "try { $p.PriorityClass='High'; Write-Output ('OK ' + $p.ProcessName) } catch { Write-Output ('DENIED ' + $p.ProcessName) } } }; " +
    'if ($hit -ge 0 -and $i -ge $hit + 5) { break }; Start-Sleep -Seconds 3 }; ' +
    "if ($hit -lt 0) { Write-Output 'NOTFOUND' }";
}

function boostResult(out) {
  const ok = (String(out).match(/^OK .+$/gm) || []).length;
  const denied = (String(out).match(/^DENIED .+$/gm) || []).length;
  if (ok) return { ok: true, message: 'Приоритет игры поднят до «Высокого»' };
  if (denied) return { ok: false, message: 'Игра не дала поменять приоритет (защита античита) — это нормально' };
  return { ok: false, message: 'Не дождался запуска игры — приоритет не менял' };
}

/* ------------------------------------------------------------------ host */

/**
 * @param {object} deps {platform, reg, ps, env, fs, openUrl(url):Promise, spawnDetached(file,args), emit(evt)}
 */
function createGames(deps) {
  const platform = deps.platform || process.platform;
  const reg = deps.reg || regDefault;
  const ps = deps.ps || runDefault.ps;
  const env = deps.env || process.env;
  const xfs = deps.fs || fs;
  const emit = deps.emit || (() => {});
  const spawnDetached = deps.spawnDetached || ((file, args) => new Promise((resolve, reject) => {
    const c = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
    c.once('error', reject);
    c.once('spawn', () => { c.unref(); resolve(); });
  }));
  const known = new Map(); // id -> launch info

  const exists = (p) => { try { return !!p && xfs.existsSync(p); } catch (e) { return false; } };
  const read = (p) => { try { return xfs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
  const list = (p) => { try { return xfs.readdirSync(p); } catch (e) { return []; } };
  const winPath = (p) => path.normalize(String(p)); // forward slashes -> backslashes on Windows

  async function steamRoot() {
    const tries = [
      ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
      ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
      ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']
    ];
    for (const [k, n] of tries) {
      try {
        const v = await reg.query(k, n);
        if (v.exists && v.value && exists(winPath(v.value))) return winPath(v.value);
      } catch (e) { /* try next */ }
    }
    const def = path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam');
    return exists(def) ? def : null;
  }

  async function steamLibraries() {
    const root = await steamRoot();
    if (!root) return { root: null, libs: [] };
    const libs = [root];
    const text = read(path.join(root, 'steamapps', 'libraryfolders.vdf'));
    if (text) for (const p of parseLibraryFolders(text)) libs.push(winPath(p));
    const seen = new Set();
    return {
      root,
      libs: libs.filter((l) => {
        const k = l.toLowerCase().replace(/[\\/]+$/, '');
        if (seen.has(k) || !exists(l)) return false;
        seen.add(k);
        return true;
      })
    };
  }

  async function steamGames() {
    const { libs } = await steamLibraries();
    const out = [];
    for (const lib of libs) {
      const apps = path.join(lib, 'steamapps');
      for (const f of list(apps)) {
        if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
        const m = parseAppManifest(read(path.join(apps, f)) || '');
        if (!isSteamGame(m)) continue;
        const dir = m.installdir ? path.join(apps, 'common', m.installdir) : null;
        out.push({ id: 'steam:' + m.appid, name: m.name, source: 'steam', appid: m.appid, lib, dir });
      }
    }
    return out;
  }

  function epicGames() {
    const base = path.join(env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    const out = [];
    for (const f of list(base)) {
      if (!/\.item$/i.test(f)) continue;
      const g = parseEpicManifest(read(path.join(base, f)) || '');
      if (!g) continue;
      if (g.installLocation && !exists(g.installLocation)) continue;
      out.push({ id: 'epic:' + g.appName, name: g.name, source: 'epic', epic: g, dir: g.installLocation || null });
    }
    return out;
  }

  function minecraftJava() {
    const dir = path.join(env.APPDATA || '', '.minecraft');
    if (!env.APPDATA || !exists(dir)) return [];
    return [{ id: 'minecraft-java', name: 'Minecraft: Java Edition', source: 'minecraft', dir }];
  }

  function riotInstalls() {
    const p = path.join(env.ProgramData || 'C:\\ProgramData', 'Riot Games', 'RiotClientInstalls.json');
    const t = read(p);
    if (!t) return null;
    try { return JSON.parse(t.replace(/^\uFEFF/, '')); } catch (e) { return null; }
  }

  function valorant() {
    const sysDrive = (env.SystemDrive || 'C:') + '\\';
    let dir = path.join(sysDrive, 'Riot Games', 'VALORANT');
    let client = null;
    const ri = riotInstalls();
    if (ri) {
      client = ri.rc_default || ri.rc_live || null;
      const assoc = ri.associated_client || {};
      for (const k of Object.keys(assoc)) {
        if (/valorant/i.test(k)) { dir = winPath(k).replace(/[\\/]live[\\/]?$/i, ''); client = assoc[k] || client; }
      }
    }
    if (!exists(dir)) return [];
    if (!client) client = path.join(sysDrive, 'Riot Games', 'Riot Client', 'RiotClientServices.exe');
    return [{ id: 'riot:valorant', name: 'VALORANT', source: 'riot', dir, client: winPath(client) }];
  }

  function roblox() {
    const bases = [
      path.join(env.LOCALAPPDATA || '', 'Roblox', 'Versions'),
      path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Roblox', 'Versions')
    ];
    for (const b of bases) {
      if (!exists(b)) continue;
      for (const v of list(b)) {
        if (exists(path.join(b, v, 'RobloxPlayerBeta.exe'))) {
          return [{ id: 'roblox', name: 'Roblox', source: 'roblox', dir: b }];
        }
      }
    }
    return [];
  }

  async function detect() {
    if (platform !== 'win32') return [];
    const found = [];
    const add = (arr) => { for (const g of arr) found.push(g); };
    const step = async (fn) => { try { add(await fn()); } catch (e) { /* one source failing must not hide others */ } };
    await step(steamGames);
    await step(epicGames);
    await step(minecraftJava);
    await step(valorant);
    await step(roblox);
    known.clear();
    const out = [];
    for (const g of found) {
      if (known.has(g.id)) continue;
      known.set(g.id, g);
      out.push({ id: g.id, name: g.name, catalogId: null, icon: null, source: g.source });
    }
    return out;
  }

  async function launch(args) {
    if (platform !== 'win32') throw unsupported();
    const id = String((args && args.id) || '');
    if (!known.has(id)) await detect();
    const g = known.get(id);
    if (!g) throw new HostError('NOT_FOUND', 'Игра не найдена — обнови список игр');
    const fail = (e) => { throw new HostError('FAILED', 'Не удалось запустить ' + g.name, e && e.message); };
    const boost = { dirs: g.dir ? [g.dir] : [], names: [], title: null };

    if (g.source === 'steam') {
      await deps.openUrl('steam://rungameid/' + g.appid).catch(fail);
    } else if (g.source === 'epic') {
      await deps.openUrl(epicLaunchUrl(g.epic)).catch(fail);
    } else if (g.source === 'minecraft') {
      const pkg = path.join(env.LOCALAPPDATA || '', 'Packages', MC_STORE_PKG);
      const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const legacy = [path.join(pf86, 'Minecraft Launcher', 'MinecraftLauncher.exe'), path.join(pf86, 'Minecraft', 'MinecraftLauncher.exe')]
        .find((p) => exists(p));
      if (legacy && !exists(pkg)) await spawnDetached(legacy, []).catch(fail);
      else await spawnDetached('explorer.exe', ['shell:AppsFolder\\' + MC_STORE_PKG + '!Minecraft']).catch(fail);
      boost.dirs = [];
      boost.names = ['javaw', 'java'];
      boost.title = 'Minecraft*';
    } else if (g.source === 'riot') {
      if (!exists(g.client)) throw new HostError('NOT_FOUND', 'Не нашёл Riot Client — переустанови его');
      await spawnDetached(g.client, ['--launch-product=valorant', '--launch-patchline=live']).catch(fail);
      boost.names = ['VALORANT-Win64-Shipping'];
    } else if (g.source === 'roblox') {
      await deps.openUrl('roblox://').catch(fail);
      boost.names = ['RobloxPlayerBeta'];
    } else {
      throw new HostError('UNSUPPORTED', 'Эту игру GinN пока не умеет запускать');
    }

    if (args && args.boost && (boost.dirs.length || boost.names.length)) {
      ps(boostScript(Object.assign({ seconds: 90 }, boost)), { timeout: 130000 }).then((r) => {
        const res = boostResult(r.stdout || '');
        emit({ type: 'boost', id: g.id, ok: res.ok, message: res.message });
      }).catch(() => {});
      return { message: 'Запускаю ' + g.name + '. Когда игра откроется, подниму ей приоритет' };
    }
    return { message: 'Запускаю ' + g.name };
  }

  /** Steam library that has an app installed (for game config writers). */
  async function steamAppDir(appid) {
    const { root, libs } = await steamLibraries();
    for (const lib of libs) {
      const m = parseAppManifest(read(path.join(lib, 'steamapps', 'appmanifest_' + appid + '.acf')) || '');
      if (m && m.installdir) {
        const dir = path.join(lib, 'steamapps', 'common', m.installdir);
        if (exists(dir)) return { root, lib, dir };
      }
    }
    return { root, lib: null, dir: null };
  }

  return { detect, launch, steamRoot, steamAppDir };
}

module.exports = {
  createGames, parseLibraryFolders, parseAppManifest, parseEpicManifest, isSteamGame, epicLaunchUrl,
  boostScript, boostResult, STEAM_SKIP
};
