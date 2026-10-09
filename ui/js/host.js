/* GinN — host adapter (GinN.host). One Promise API over three transports:
 *   window.GinNAndroid  -> Android WebView bridge (async, results via window.__ginnResolve)
 *   window.ginnDesktop  -> Electron preload (ipcRenderer.invoke)
 *   GinN.mock           -> browser dev/test fake host (mock.js loads AFTER this file)
 * The transport is picked lazily on the first call.
 * Every method resolves with `data` or rejects with an Error that has .code and a Russian .message. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  /** Default Russian texts per error code (used when the host sends no message). */
  var ERRORS = {
    NEEDS_PERMISSION: 'Нужно разрешение. Открой настройки и разреши доступ.',
    NEEDS_ADMIN: 'Нужны права администратора. Перезапусти GinN от имени администратора.',
    UNSUPPORTED: 'На этом устройстве это недоступно.',
    NOT_FOUND: 'Не найдено.',
    FAILED: 'Не получилось. Попробуй ещё раз.',
    TIMEOUT: 'Приложение не ответило вовремя. Попробуй ещё раз.',
    NO_HOST: 'Нет связи с приложением.',
    BAD_RESPONSE: 'Приложение прислало непонятный ответ.'
  };

  /** makeError(code, message?) -> Error with .code (Russian message). */
  function makeError(code, message) {
    var c = code || 'FAILED';
    var err = new Error(message || ERRORS[c] || ERRORS.FAILED);
    err.code = c;
    return err;
  }

  /* ------------------------------------------------------------- transports */

  var pending = {};
  var seq = 0;

  var android = {
    name: 'android',
    call: function (method, args, opts) {
      var timeoutMs = opts && opts.timeoutMs > 0 ? opts.timeoutMs : host.timeoutMs;
      return new Promise(function (resolve) {
        var id = 'g' + (++seq) + '_' + Date.now().toString(36);
        var timer = setTimeout(function () {
          if (!pending[id]) return;
          delete pending[id];
          resolve({ ok: false, code: 'TIMEOUT', error: ERRORS.TIMEOUT });
        }, timeoutMs);
        pending[id] = { resolve: resolve, timer: timer, method: method };
        try {
          window.GinNAndroid.call(id, method, JSON.stringify(args || {}));
        } catch (e) {
          clearTimeout(timer);
          delete pending[id];
          resolve({ ok: false, code: 'FAILED', error: ERRORS.FAILED });
        }
      });
    }
  };

  /** Called by Java: window.__ginnResolve("<id>", "<JSON string of the wire object>"). */
  window.__ginnResolve = function (id, payload) {
    var key = String(id);
    var p = pending[key];
    if (!p) return;
    delete pending[key];
    clearTimeout(p.timer);
    var wire;
    try {
      wire = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (e) {
      wire = null;
    }
    if (!wire || typeof wire !== 'object' || typeof wire.ok !== 'boolean') {
      wire = { ok: false, code: 'BAD_RESPONSE', error: ERRORS.BAD_RESPONSE };
    }
    p.resolve(wire);
  };

  /** Native -> JS events. Re-emitted on GinN.bus as 'host:<type>' (e.g. 'host:resume'). */
  window.__ginnEvent = function (evt) {
    var e = evt;
    if (typeof e === 'string') { try { e = JSON.parse(e); } catch (x) { e = { type: e }; } }
    if (!e || !e.type || !G.bus) return;
    G.bus.emit('host:' + e.type, e);
  };

  /** Android back button: true = UI handled it (UI sets GinN.onBack), otherwise the Activity finishes. */
  window.__ginnBack = function () {
    try { return !!(G.onBack && G.onBack()); } catch (e) { return false; }
  };

  var desktop = {
    name: 'desktop',
    call: function (method, args) {
      var r;
      try { r = window.ginnDesktop.call(method, args || {}); } catch (e) {
        return Promise.resolve({ ok: false, code: 'FAILED', error: (e && e.message) || ERRORS.FAILED });
      }
      return Promise.resolve(r).then(function (wire) {
        if (wire && typeof wire === 'object' && typeof wire.ok === 'boolean') return wire;
        return { ok: true, data: wire === undefined ? {} : wire };
      }, function (e) {
        return { ok: false, code: (e && e.code) || 'FAILED', error: ERRORS.FAILED };
      });
    }
  };

  var mock = {
    name: 'mock',
    call: function (method, args) { return G.mock.call(method, args || {}); }
  };

  var backend = null;
  function pick() {
    if (backend) return backend;
    if (window.GinNAndroid && typeof window.GinNAndroid.call !== 'undefined') backend = android;
    else if (window.ginnDesktop && typeof window.ginnDesktop.call === 'function') backend = desktop;
    else if (G.mock && typeof G.mock.call === 'function') backend = mock;
    return backend;
  }

  /* ------------------------------------------------------------- public API */

  /**
   * Low-level call. GinN.host.call(method, args, opts?) -> Promise<data>.
   * opts.timeoutMs overrides the Android bridge timeout for slow methods (aiMessage).
   * Rejects with Error{code, message}.
   */
  function call(method, args, opts) {
    var b = pick();
    if (!b) return Promise.reject(makeError('NO_HOST'));
    return b.call(method, args, opts).then(function (wire) {
      if (wire && wire.ok) return wire.data === undefined ? {} : wire.data;
      throw makeError(wire && wire.code, wire && wire.error);
    });
  }

  var readyPromise = null;
  var lastInfo = null;

  function rememberInfo(info) {
    lastInfo = info || {};
    host.platform = lastInfo.platform || 'web';
    host.isAdmin = lastInfo.isAdmin === true;
    host.capabilities = Array.isArray(lastInfo.capabilities) ? lastInfo.capabilities.slice() : [];
    host.demo = lastInfo.demo === true;
    return info;
  }

  var host = {
    /** 'android' | 'windows' | 'web' — set once info() has resolved (null before). */
    platform: null,
    /** Windows: process is elevated (from the last info()). */
    isAdmin: false,
    /** Capability strings from the last info(). */
    capabilities: [],
    /** true when running on the browser mock (show a "Демо" badge). */
    demo: false,
    /** Android bridge timeout in ms (default 30 s). */
    timeoutMs: 30000,
    /** Bridge timeout for aiMessage (a Claude answer can take up to two minutes). */
    aiTimeoutMs: 150000,
    ERRORS: ERRORS,
    makeError: makeError,
    call: call,

    /** Which transport is in use: 'android' | 'desktop' | 'mock' | null. */
    transport: function () { var b = pick(); return b ? b.name : null; },

    /** Cached info(): first call fetches, later calls reuse. Retries after a failure. */
    ready: function () {
      if (!readyPromise) {
        readyPromise = host.info().catch(function (e) { readyPromise = null; throw e; });
      }
      return readyPromise;
    },

    /** has('games.profile') -> bool, based on the last info(). */
    has: function (cap) { return host.capabilities.indexOf(cap) >= 0; },

    /** {platform, appVersion, isAdmin?, capabilities[], demo?} — also updates platform/isAdmin/capabilities. */
    info: function () { return call('info').then(rememberInfo); },
    /** Hardware object (see ARCHITECTURE.md). Not cached here. */
    hardware: function () { return call('hardware'); },
    /** Stats object; cheap, poll every ~1.5 s while visible. */
    stats: function () { return call('stats'); },
    /** Tweak[] with current state. */
    tweaks: function () { return call('tweaks'); },
    /** {id, enable} -> {id, state, message?, needsReboot?} */
    applyTweak: function (args) { return call('applyTweak', args); },
    /** -> {reverted:string[], failed:[{id, error}]} */
    revertAll: function () { return call('revertAll'); },
    /**
     * {knownPackages?} -> InstalledGame[]. When knownPackages is omitted it is filled
     * with every Android package from GinN.games (harmless on desktop).
     */
    games: function (args) {
      var a = args ? Object.assign({}, args) : {};
      if (!a.knownPackages && G.games && typeof G.games.allPackages === 'function') {
        a.knownPackages = G.games.allPackages();
      }
      return call('games', a);
    },
    /** {id, boost} -> {message} */
    launchGame: function (args) { return call('launchGame', args); },
    /** {gameId, fps, preset:'potato'|'balanced', grayTextures} -> {written:string[], message} (PC only) */
    applyGameProfile: function (args) { return call('applyGameProfile', args); },
    /** {gameId} -> {message} */
    revertGameProfile: function (args) { return call('revertGameProfile', args); },
    /**
     * {name, base64, mime, open} -> {path}. Convenience: pass `bytes` (Uint8Array)
     * instead of base64 and it is encoded here.
     */
    saveFile: function (args) {
      var a = Object.assign({}, args || {});
      if (a.bytes && !a.base64) {
        a.base64 = toBase64(a.bytes);
      }
      delete a.bytes;
      return call('saveFile', a);
    },
    /** {text} -> {} */
    copyText: function (args) { return call('copyText', typeof args === 'string' ? { text: args } : args); },
    /** {target} -> {} (android: developer, battery_saver, display, dnd_access, storage, app_details:<pkg>;
     *  windows: graphics, gamemode, power, startup, storage) */
    openSettings: function (args) { return call('openSettings', typeof args === 'string' ? { target: args } : args); },
    /** Windows only: restarts the app elevated. -> {} */
    relaunchAsAdmin: function () { return call('relaunchAsAdmin'); },
    /** {url} -> {} */
    openExternal: function (args) { return call('openExternal', typeof args === 'string' ? { url: args } : args); },

    /* --- GinN AI (Claude). Error codes and texts: GinN.ai (ui/js/ai/advisor.js). --- */
    /** -> {configured:bool, model, transport:'native'|'page'|'mock'} */
    aiStatus: function () { return call('aiStatus'); },
    /** {key?, model?} -> same as aiStatus. The key stays on this device and is never returned here. */
    aiConfigure: function (args) { return call('aiConfigure', args || {}); },
    /** Forgets the key -> same as aiStatus. */
    aiClear: function () { return call('aiClear'); },
    /** -> {key}. Only hosts with transport 'page' (Android, browser); desktop rejects with UNSUPPORTED. */
    aiKey: function () { return call('aiKey'); },
    /** {params} -> raw Message object. Only transport 'native' (desktop) and 'mock'. Slow: 150 s bridge timeout. */
    aiMessage: function (args) { return call('aiMessage', args || {}, { timeoutMs: host.aiTimeoutMs }); },

    /**
     * Best GPU name for display: hw.gpu.name (cleaned) or, when the host sent null,
     * the WebGL renderer (GinN.devices.gpuFromWebGL()). Returns null when unknown.
     */
    gpuName: function (hw) {
      var d = G.devices;
      var raw = hw && hw.gpu && hw.gpu.name;
      if (raw) return d && d.cleanGpu ? (d.cleanGpu(raw) || raw) : raw;
      return d && d.gpuFromWebGL ? d.gpuFromWebGL() : null;
    }
  };

  /** Contract method names (handy for tests / feature checks). */
  host.methods = ['info', 'hardware', 'stats', 'tweaks', 'applyTweak', 'revertAll', 'games', 'launchGame',
    'applyGameProfile', 'revertGameProfile', 'saveFile', 'copyText', 'openSettings', 'relaunchAsAdmin', 'openExternal',
    'aiStatus', 'aiConfigure', 'aiClear', 'aiKey', 'aiMessage'];

  function toBase64(u8) {
    if (G.mcpack && G.mcpack.toBase64) return G.mcpack.toBase64(u8);
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return window.btoa(s);
  }

  /* Desktop / browser: coming back to the window = 'host:resume' (Android sends its own from onResume). */
  var lastResume = 0;
  if (window.addEventListener) {
    window.addEventListener('focus', function () {
      var b = pick();
      if (!b || b.name === 'android') return;
      var now = Date.now();
      if (now - lastResume < 1500) return;
      lastResume = now;
      if (G.bus) G.bus.emit('host:resume', { type: 'resume', source: 'focus' });
    });
  }

  G.host = host;
})(window.GinN);
