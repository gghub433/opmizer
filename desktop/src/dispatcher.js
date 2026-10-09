'use strict';
/**
 * IPC dispatcher: an explicit allowlist of contract methods -> {ok:true,data} | {ok:false,code,error}.
 * Unknown errors never leak English internals to the UI; they are logged and reported in Russian.
 */
const METHODS = Object.freeze([
  'info', 'hardware', 'stats', 'tweaks', 'applyTweak', 'revertAll', 'games', 'launchGame',
  'applyGameProfile', 'revertGameProfile', 'saveFile', 'copyText', 'readText', 'openSettings', 'relaunchAsAdmin',
  'openExternal',
  'aiStatus', 'aiConfigure', 'aiClear', 'aiKey', 'aiMessage'
]);
const ALLOWED = new Set(METHODS);
const CODES = new Set(['NEEDS_PERMISSION', 'NEEDS_ADMIN', 'UNSUPPORTED', 'NOT_FOUND', 'FAILED', 'CANCELLED', 'BAD_ARGS',
  'UNKNOWN_METHOD', 'FORBIDDEN',
  'AI_NO_KEY', 'AI_AUTH', 'AI_BILLING', 'AI_RATE', 'AI_BUSY', 'AI_NETWORK', 'AI_BAD_REQUEST', 'AI_REFUSAL', 'AI_TRUNCATED',
  'AI_BAD_OUTPUT', 'AI_FAILED']);

function createDispatcher(handlers, opts) {
  const log = (opts && opts.log) || ((...a) => console.error('[ginn]', ...a));
  return async function dispatch(method, args) {
    if (typeof method !== 'string' || !ALLOWED.has(method) ||
        !Object.prototype.hasOwnProperty.call(handlers, method) || typeof handlers[method] !== 'function') {
      return { ok: false, code: 'UNKNOWN_METHOD', error: 'Неизвестная команда' };
    }
    if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
      return { ok: false, code: 'BAD_ARGS', error: 'Неверные параметры запроса' };
    }
    try {
      const data = await handlers[method](args || {});
      return { ok: true, data: data === undefined ? {} : data };
    } catch (e) {
      if (e && typeof e.code === 'string' && CODES.has(e.code) && e.message) {
        if (e.detail) log(method, e.code, e.detail);
        return { ok: false, code: e.code, error: e.message };
      }
      log(method, e && e.stack ? e.stack : e);
      return { ok: false, code: 'FAILED', error: 'Что-то пошло не так. Попробуй ещё раз' };
    }
  };
}

module.exports = { createDispatcher, METHODS };
