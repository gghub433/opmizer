/* GinN — core: namespace, event bus, Russian formatters, small utilities.
 * Classic script (no modules). Loads first. UI helpers (h(), $, toast, modal) live in UI files. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  /** App version (keep in sync with the native hosts). */
  G.version = '1.0.0';

  /* ------------------------------------------------------------------ bus */

  /**
   * Tiny event emitter.
   * GinN.bus.on(type, cb) -> unsubscribe()
   * GinN.bus.once(type, cb) -> unsubscribe()
   * GinN.bus.off(type, cb)
   * GinN.bus.emit(type, data)
   * Host events arrive as 'host:<type>' (e.g. 'host:resume').
   */
  G.bus = (function () {
    var map = {};
    function off(type, cb) {
      var list = map[type];
      if (!list) return;
      var i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    }
    function on(type, cb) {
      if (typeof cb !== 'function') return function () {};
      (map[type] || (map[type] = [])).push(cb);
      return function () { off(type, cb); };
    }
    function once(type, cb) {
      var un = on(type, function (data) { un(); cb(data); });
      return un;
    }
    function emit(type, data) {
      var list = map[type];
      if (!list) return;
      list.slice().forEach(function (cb) {
        try { cb(data); } catch (e) { if (window.console) console.error('[GinN.bus] ' + type, e); }
      });
    }
    return { on: on, once: once, off: off, emit: emit };
  })();

  /* ------------------------------------------------------------------ fmt */

  var DASH = '—';
  function isNum(n) { return typeof n === 'number' && isFinite(n); }

  /**
   * Russian number: comma decimal, at most `digits` decimals, trailing zeros dropped,
   * thousands grouped with a no-break space from 10 000 up.
   * num(2.75) -> '2,75'   num(3.0, 1) -> '3'   num(12288) -> '12 288'
   */
  function num(n, digits) {
    if (!isNum(n)) return DASH;
    var d = digits == null ? 0 : digits;
    var s = n.toFixed(d);
    if (d > 0) s = s.replace(/\.?0+$/, '');
    if (s === '-0') s = '0';
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var parts = s.split('.');
    if (parts[0].length > 4) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '-' : '') + parts.join(',');
  }

  /** Russian plural form: plural(5,'игра','игры','игр') -> 'игр'. Returns the word only. */
  function plural(n, one, few, many) {
    var a = Math.abs(Number(n) || 0);
    if (a % 1 !== 0) return few;
    var m10 = a % 10, m100 = a % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  G.fmt = {
    num: num,
    plural: plural,
    /** count(5,'игра','игры','игр') -> '5 игр' */
    count: function (n, one, few, many) { return num(n, 1) + ' ' + plural(n, one, few, many); },
    /** Megabytes -> '512 МБ' | '3,4 ГБ' | '16 ГБ' */
    mb: function (n) {
      if (!isNum(n)) return DASH;
      if (Math.abs(n) < 1024) return num(Math.round(n)) + ' МБ';
      var g = n / 1024;
      return num(g, Math.abs(g) < 100 ? 1 : 0) + ' ГБ';
    },
    /** Gigabytes -> '238,4 ГБ' | '1,8 ТБ' | '512 МБ' */
    gb: function (n) {
      if (!isNum(n)) return DASH;
      if (Math.abs(n) < 1) return G.fmt.mb(n * 1024);
      if (Math.abs(n) >= 1024) return num(n / 1024, 1) + ' ТБ';
      return num(n, 1) + ' ГБ';
    },
    /** Percent -> '42%' (digits optional) */
    pct: function (n, digits) { return isNum(n) ? num(n, digits || 0) + '%' : DASH; },
    /** Megahertz -> '2,75 ГГц' | '900 МГц' */
    mhz: function (n) {
      if (!isNum(n)) return DASH;
      if (Math.abs(n) >= 1000) return num(n / 1000, 2) + ' ГГц';
      return num(Math.round(n)) + ' МГц';
    },
    /** Celsius -> '41 °C' */
    temp: function (c) { return isNum(c) ? num(Math.round(c)) + ' °C' : DASH; },
    /** Refresh rate -> '120 Гц' */
    hz: function (n) { return isNum(n) ? num(Math.round(n)) + ' Гц' : DASH; },
    /** Frame rate -> '144 FPS' */
    fps: function (n) { return isNum(n) ? num(Math.round(n)) + ' FPS' : DASH; }
  };

  /* --------------------------------------------------------------- misc */

  /** Promise that resolves after `ms` milliseconds. */
  G.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /** clamp(v, min, max) */
  G.clamp = function (v, min, max) { return v < min ? min : v > max ? max : v; };

  /**
   * Per-device preferences in localStorage (JSON, key prefix 'ginn.').
   * Never throws; returns `def` when storage is blocked/empty. Not for critical data.
   */
  G.store = {
    get: function (key, def) {
      try {
        var raw = window.localStorage.getItem('ginn.' + key);
        return raw == null ? def : JSON.parse(raw);
      } catch (e) { return def; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem('ginn.' + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (key) {
      try { window.localStorage.removeItem('ginn.' + key); } catch (e) { /* ignore */ }
    }
  };
})(window.GinN);
