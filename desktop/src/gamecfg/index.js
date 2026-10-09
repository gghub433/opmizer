'use strict';
/**
 * Game profiles: applyGameProfile / revertGameProfile.
 * `gameId` is the UI CATALOG id ('minecraft' | 'cs2' | 'fortnite'), not an InstalledGame id.
 * Before the first write of each file the original is copied to <userData>/backups/<gameId>/
 * (an existing backup is never overwritten).
 * Revert undoes only GinN's part of a config the game module understands (module.revertText): the keys or
 * the block GinN writes go back to the copy, everything the player changed since stays. Other files (the
 * gray pack), and configs the player deleted since, come back from the copy whole; files that did not exist
 * before are deleted.
 */
const fs = require('node:fs');
const path = require('node:path');
const { HostError, unsupported } = require('../errors');
const runDefault = require('../run');

const MODULES = {
  minecraft: require('./minecraft'),
  cs2: require('./cs2'),
  fortnite: require('./fortnite')
};

/**
 * @param {object} deps {platform, store, backupRoot, env, games, run, fs}
 */
function createProfiles(deps) {
  const platform = deps.platform || process.platform;
  const store = deps.store;
  const xfs = deps.fs || fs;
  const env = deps.env || process.env;
  const run = deps.run || runDefault.run;

  const io = {
    env,
    games: deps.games,
    exists: (p) => { try { return xfs.existsSync(p); } catch (e) { return false; } },
    readText: (p) => { try { return xfs.readFileSync(p, 'utf8'); } catch (e) { return null; } },
    list: (p) => { try { return xfs.readdirSync(p); } catch (e) { return []; } }
  };

  async function running(images) {
    if (platform !== 'win32' || !images || !images.length) return null;
    for (const img of images) {
      const r = await run('tasklist.exe', ['/FI', 'IMAGENAME eq ' + img, '/NH', '/FO', 'CSV'], { timeout: 10000 });
      if (r.code === 0 && r.stdout.toLowerCase().includes('"' + img.toLowerCase() + '"')) return img;
    }
    return null;
  }

  function validate(args) {
    const a = args || {};
    const gameId = String(a.gameId || '');
    if (!MODULES[gameId]) throw new HostError('UNSUPPORTED', 'Для этой игры профиль пока не поддерживается');
    const fps = Math.round(Number(a.fps));
    if (!Number.isFinite(fps) || fps < 10 || fps > 1000) throw new HostError('BAD_ARGS', 'Неверный лимит FPS');
    const preset = a.preset === 'balanced' ? 'balanced' : 'potato';
    return { gameId, fps, preset, grayTextures: !!a.grayTextures };
  }

  async function apply(args) {
    if (platform !== 'win32') throw unsupported();
    const opts = validate(args);
    const mod = MODULES[opts.gameId];
    const p = await mod.plan(io, opts);
    const busy = await running(p.processes);
    if (busy) throw new HostError('FAILED', 'Сначала закрой игру (' + busy + ') — иначе при выходе она перезапишет настройки');

    const dir = path.join(deps.backupRoot, opts.gameId);
    // 1) back up every original before touching anything
    const saved = store.get('games')[opts.gameId] || { dir, files: [] };
    const have = new Set(saved.files.map((f) => f.path.toLowerCase()));
    const fresh = [];
    for (const f of p.files) {
      if (have.has(f.path.toLowerCase())) continue;
      if (io.exists(f.path)) {
        xfs.mkdirSync(dir, { recursive: true });
        const name = (saved.files.length + fresh.length + 1) + '-' + path.basename(f.path);
        xfs.copyFileSync(f.path, path.join(dir, name));
        fresh.push({ path: f.path, backup: name });
      } else {
        fresh.push({ path: f.path, backup: null });
      }
    }
    store.update((d) => {
      const g = d.games[opts.gameId] || (d.games[opts.gameId] = { dir, files: [] });
      for (const f of fresh) g.files.push(f);
    });
    // 2) write
    const written = [];
    for (const f of p.files) {
      try {
        xfs.mkdirSync(path.dirname(f.path), { recursive: true });
        const tmp = f.path + '.ginn-tmp';
        xfs.writeFileSync(tmp, f.data);
        xfs.renameSync(tmp, f.path);
        written.push(f.path);
      } catch (e) {
        throw new HostError('FAILED', 'Не удалось записать ' + path.basename(f.path) +
          (e.code === 'EPERM' || e.code === 'EACCES' ? ' — файл занят или только для чтения' : ''), e.message);
      }
    }
    return { written, message: p.message };
  }

  /** Undo one file. A file that exists but cannot be read throws, it is never replaced blindly. */
  function revertFile(mod, dir, f) {
    const backup = f.backup ? path.join(dir, f.backup) : null;
    const current = io.exists(f.path) ? xfs.readFileSync(f.path, 'utf8') : null;
    let out;
    if (current != null && mod.revertText) {
      out = mod.revertText(path.basename(f.path), current, backup ? xfs.readFileSync(backup, 'utf8') : null);
    }
    if (out === undefined) {
      if (backup) {
        xfs.mkdirSync(path.dirname(f.path), { recursive: true });
        xfs.copyFileSync(backup, f.path);
      } else {
        try { xfs.unlinkSync(f.path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    } else if (out === null) {
      try { xfs.unlinkSync(f.path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    } else if (out !== current) {
      const tmp = f.path + '.ginn-tmp';
      xfs.writeFileSync(tmp, out);
      xfs.renameSync(tmp, f.path);
    }
  }

  async function revert(args) {
    if (platform !== 'win32') throw unsupported();
    const gameId = String((args && args.gameId) || '');
    if (!MODULES[gameId]) throw new HostError('UNSUPPORTED', 'Для этой игры профиль пока не поддерживается');
    const saved = store.get('games')[gameId];
    if (!saved || !saved.files || !saved.files.length) {
      throw new HostError('NOT_FOUND', 'GinN ещё не менял настройки этой игры');
    }
    const dir = saved.dir || path.join(deps.backupRoot, gameId);
    for (const f of saved.files) revertFile(MODULES[gameId], dir, f);
    try { xfs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leftovers are harmless */ }
    store.update((d) => { delete d.games[gameId]; });
    return { message: 'Настройки игры возвращены как были' };
  }

  async function revertAll() {
    const reverted = [];
    const failed = [];
    for (const gameId of Object.keys(store.get('games') || {})) {
      try { await revert({ gameId }); reverted.push('game:' + gameId); } catch (e) {
        failed.push({ id: 'game:' + gameId, error: e.message || 'Ошибка' });
      }
    }
    return { reverted, failed };
  }

  return { apply, revert, revertAll };
}

module.exports = { createProfiles, MODULES };
