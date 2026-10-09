'use strict';
/**
 * Wires every contract method to its implementation. Electron objects come in through `deps`,
 * so this module (and everything below it) loads without Electron in tests.
 */
const fs = require('node:fs');
const path = require('node:path');
const { HostError, unsupported } = require('./errors');
const { createStore } = require('./state');
const admin = require('./admin');
const { createTweaks } = require('./tweaks');
const { createHardware } = require('./hardware');
const { createGames } = require('./games');
const { createProfiles } = require('./gamecfg');
const { createAi } = require('./ai');
const { PsSession } = require('./pssession');

const SETTINGS = {
  graphics: 'ms-settings:display-advancedgraphics',
  gamemode: 'ms-settings:gaming-gamemode',
  power: 'ms-settings:powersleep',
  startup: 'ms-settings:startupapps',
  storage: 'ms-settings:storagesense'
};

const MAX_SAVE_BYTES = 64 * 1024 * 1024;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

function safeFileName(name) {
  let n = path.basename(String(name || '').replace(/\\/g, '/'));
  n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  if (!n || n === '.' || n === '..') n = 'GinN-file';
  const ext = path.extname(n);
  if (RESERVED.test(path.basename(n, ext))) n = 'GinN-' + n;
  return n.slice(0, 180);
}

function uniquePath(dir, name, exists) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 1; exists(p) && i < 1000; i++) p = path.join(dir, base + ' (' + i + ')' + ext);
  return p;
}

function isHttpUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch (e) { return false; }
}

/**
 * @param {object} deps {app, shell, clipboard, screen, safeStorage, netFetch, platform, userData, downloads, emit, si?,
 *                       createAiClient?, anthropicSdk?}
 */
function createHandlers(deps) {
  const platform = deps.platform || process.platform;
  const win = platform === 'win32';
  const store = createStore(path.join(deps.userData, 'ginn-state.json'));
  const isAdmin = () => admin.isAdmin(platform);
  const session = win ? new PsSession() : null;
  const openUrl = (url) => Promise.resolve(deps.shell.openExternal(url));

  const hardware = createHardware({
    si: deps.si,
    platform,
    session,
    getDisplay: () => {
      if (!deps.screen) return null;
      const d = deps.screen.getPrimaryDisplay();
      const sf = d.scaleFactor || 1;
      return {
        width: Math.round(d.size.width * sf),
        height: Math.round(d.size.height * sf),
        refreshHz: d.displayFrequency || null
      };
    }
  });
  const tweaks = createTweaks({ platform, store, isAdmin, openExternal: openUrl });
  const games = createGames({ platform, openUrl, emit: deps.emit });
  const profiles = createProfiles({ platform, store, games, backupRoot: path.join(deps.userData, 'backups') });
  const ai = createAi({
    store, safeStorage: deps.safeStorage, fetch: deps.netFetch, createClient: deps.createAiClient, sdk: deps.anthropicSdk
  });

  const handlers = {
    async info() {
      return {
        platform: 'windows',
        appVersion: deps.app.getVersion(),
        isAdmin: win ? await isAdmin() : false,
        os: platform,
        capabilities: win
          ? ['tweaks', 'games.detect', 'games.launch', 'games.profile', 'saveFile', 'admin', 'ai', 'ai.native']
          : ['tweaks', 'saveFile', 'ai', 'ai.native']
      };
    },
    hardware: () => hardware.hardware(),
    stats: () => hardware.stats(),
    tweaks: () => tweaks.list(),
    applyTweak: (a) => tweaks.apply(a),
    async revertAll() {
      const t = await tweaks.revertAll();
      const g = win ? await profiles.revertAll() : { reverted: [], failed: [] };
      return { reverted: t.reverted.concat(g.reverted), failed: t.failed.concat(g.failed) };
    },
    games: () => games.detect(),
    launchGame: (a) => games.launch(a),
    applyGameProfile: (a) => profiles.apply(a),
    revertGameProfile: (a) => profiles.revert(a),

    async saveFile(a) {
      if (typeof a.base64 !== 'string') throw new HostError('BAD_ARGS', 'Нет данных файла');
      const data = Buffer.from(a.base64, 'base64');
      if (!data.length) throw new HostError('BAD_ARGS', 'Файл пустой');
      if (data.length > MAX_SAVE_BYTES) throw new HostError('BAD_ARGS', 'Файл слишком большой');
      const dir = deps.downloads;
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* reported by the write below */ }
      const p = uniquePath(dir, safeFileName(a.name), (x) => fs.existsSync(x));
      try { fs.writeFileSync(p, data, { flag: 'wx' }); } catch (e) {
        throw new HostError('FAILED', 'Не удалось сохранить файл в «Загрузки»', e.message);
      }
      if (a.open) {
        const err = await deps.shell.openPath(p);
        if (err) return { path: p, message: 'Файл сохранён, но открыть его не получилось' };
      }
      return { path: p };
    },

    async copyText(a) {
      deps.clipboard.writeText(String(a.text == null ? '' : a.text));
      return {};
    },

    async openSettings(a) {
      if (!win) throw unsupported();
      const url = SETTINGS[String(a.target || '')];
      if (!url) throw new HostError('UNSUPPORTED', 'Такого раздела настроек в Windows нет');
      await openUrl(url);
      return {};
    },

    relaunchAsAdmin: () => admin.relaunchAsAdmin({ app: deps.app, platform }),

    async openExternal(a) {
      if (!isHttpUrl(a.url)) throw new HostError('BAD_ARGS', 'Можно открывать только ссылки http и https');
      await openUrl(String(a.url));
      return {};
    },

    // GinN AI: the key stays in the main process, requests go out through @anthropic-ai/sdk (transport 'native').
    aiStatus: () => ai.aiStatus(),
    aiConfigure: (a) => ai.aiConfigure(a),
    aiClear: () => ai.aiClear(),
    aiKey: () => ai.aiKey(),
    aiMessage: (a) => ai.aiMessage(a)
  };

  function dispose() { if (session) session.close(); }

  return { handlers, dispose, store };
}

module.exports = { createHandlers, safeFileName, uniquePath, isHttpUrl, SETTINGS };
