'use strict';
/**
 * GinN AI, desktop side (transport 'native'): the user's Claude API key lives only in the Electron main
 * process; the page sends a ready Messages API body (built by ui/js/ai/advisor.js) and gets the raw
 * Message object back. The key never travels to the renderer (aiKey -> UNSUPPORTED).
 *
 *   aiStatus()                -> {configured, model, transport:'native', keyStorage:'encrypted'|'plain'|null}
 *   aiConfigure({key?, model?}) -> status        key is trimmed and stored encrypted (safeStorage) when possible
 *   aiClear()                 -> status          forgets the key, keeps the model choice
 *   aiKey()                   -> UNSUPPORTED
 *   aiMessage({params})       -> Message (plain JSON) | AI_* error
 *
 * Storage (ginn-state.json): ai: { model, key: { encrypted:true, data:'<base64 safeStorage blob>' }
 *                                            | { encrypted:false, data:'<key>' } | null }
 * The raw Message is returned untouched: the caller checks stop_reason ('refusal' -> AI_REFUSAL,
 * 'max_tokens' -> AI_TRUNCATED) exactly like the in-page transport does on Android.
 */
const { HostError } = require('./errors');

const MODELS = Object.freeze(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
const DEFAULT_MODEL = 'claude-opus-5-5';
const NO_FALLBACK_MODELS = new Set(['claude-haiku-5-5']); // no server-side refusal fallback there
const BASE_URL = 'https://api.anthropic.com';
const CLIENT_OPTIONS = Object.freeze({ baseURL: BASE_URL, maxRetries: 2, timeout: 120000 });
const MAX_TOKENS_LIMIT = 32000;
const MAX_PARAMS_BYTES = 2 * 1024 * 1024;
const ALLOWED_KEYS = Object.freeze(['model', 'max_tokens', 'system', 'messages', 'output_config', 'betas', 'fallbacks']);
const ALLOWED = new Set(ALLOWED_KEYS);

const MSG = Object.freeze({
  AI_NO_KEY: 'Добавь ключ API Claude — без него ИИ не работает',
  AI_KEY_UNREADABLE: 'Сохранённый ключ не удалось прочитать. Введи его заново',
  AI_AUTH: 'Ключ API не подошёл. Проверь его в консоли Anthropic',
  AI_FORBIDDEN: 'Доступ запрещён: у ключа нет прав на эту модель или Claude недоступен в твоём регионе',
  AI_BILLING: 'На балансе Anthropic не хватает средств. Пополни его в консоли',
  AI_RATE: 'Слишком много запросов подряд. Подожди минуту и попробуй снова',
  AI_BUSY: 'Серверы Claude сейчас перегружены. Попробуй чуть позже',
  AI_NETWORK: 'Нет связи с Claude. Проверь интернет и попробуй снова',
  AI_TIMEOUT: 'Claude слишком долго не отвечает. Проверь интернет и попробуй снова',
  AI_BAD_REQUEST: 'Claude не принял запрос. Попробуй другую модель или обнови GinN',
  AI_FAILED: 'Claude не ответил. Попробуй ещё раз',
  KEY_EMPTY: 'Вставь ключ API — поле пустое',
  KEY_BAD: 'Ключ выглядит неправильно. Скопируй его целиком из консоли Anthropic',
  MODEL_BAD: 'Такой модели нет. Выбери Opus, Sonnet или Haiku',
  PARAMS_BAD: 'Неверный запрос к ИИ',
  KEY_PAGE: 'В версии для Windows ключ остаётся внутри GinN и в интерфейс не передаётся'
});

function isPlainObject(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function badParams(detail) { return new HostError('BAD_ARGS', MSG.PARAMS_BAD, detail); }

/**
 * Checks a Messages API body coming from the page. Returns it unchanged or throws BAD_ARGS.
 * Only the keys GinN.ai builds are allowed: nothing like stream, tools, thinking or sampling knobs.
 */
function validateParams(params) {
  if (!isPlainObject(params)) throw badParams('params must be a plain object');
  for (const k of Object.keys(params)) {
    if (!ALLOWED.has(k)) throw badParams('unexpected key: ' + k);
  }
  if (!MODELS.includes(params.model)) throw badParams('model not allowed: ' + String(params.model));
  const mt = params.max_tokens;
  if (!Number.isInteger(mt) || mt < 1 || mt > MAX_TOKENS_LIMIT) throw badParams('max_tokens must be an integer 1..' + MAX_TOKENS_LIMIT);
  if (!Array.isArray(params.messages) || !params.messages.length) throw badParams('messages must be a non-empty array');
  if (params.messages.some((m) => !isPlainObject(m))) throw badParams('every message must be an object');
  if (params.system !== undefined && typeof params.system !== 'string' && !Array.isArray(params.system)) {
    throw badParams('system must be a string or an array');
  }
  if (params.output_config !== undefined && !isPlainObject(params.output_config)) throw badParams('output_config must be an object');
  if (params.betas !== undefined && (!Array.isArray(params.betas) || params.betas.some((b) => typeof b !== 'string'))) {
    throw badParams('betas must be an array of strings');
  }
  if (params.fallbacks !== undefined) {
    if (params.fallbacks !== 'default' && !Array.isArray(params.fallbacks)) throw badParams('fallbacks must be "default" or an array');
    if (NO_FALLBACK_MODELS.has(params.model)) throw badParams('fallbacks are not available for ' + params.model);
  }
  let size;
  try { size = Buffer.byteLength(JSON.stringify(params), 'utf8'); } catch (e) { throw badParams('params are not JSON-serialisable'); }
  if (size > MAX_PARAMS_BYTES) throw new HostError('BAD_ARGS', 'Запрос к ИИ слишком большой', 'params ' + size + ' bytes');
  return params;
}

function keyLooksValid(key) {
  // API keys are long printable ASCII without spaces (sk-ant-…). Anything else is a copy/paste accident.
  return /^[\x21-\x7e]{20,512}$/.test(key);
}

/** SDK error -> {code, message} by the SDK's typed classes (most specific first), or null if not an SDK error. */
function mapSdkError(e, sdk) {
  if (!e || !sdk) return null;
  if (e instanceof sdk.AuthenticationError) return { code: 'AI_AUTH', message: MSG.AI_AUTH };
  if (e instanceof sdk.PermissionDeniedError) return { code: 'AI_AUTH', message: MSG.AI_FORBIDDEN };
  if (e instanceof sdk.RateLimitError) return { code: 'AI_RATE', message: MSG.AI_RATE };
  if (e instanceof sdk.InternalServerError) return { code: 'AI_BUSY', message: MSG.AI_BUSY }; // >= 500, incl. 529 overloaded
  // APIConnectionError extends APIError in the JS SDK — it must be checked before the generic APIError.
  if (e instanceof sdk.APIConnectionTimeoutError) return { code: 'AI_NETWORK', message: MSG.AI_TIMEOUT };
  if (e instanceof sdk.APIConnectionError) return { code: 'AI_NETWORK', message: MSG.AI_NETWORK };
  if (e instanceof sdk.BadRequestError || e instanceof sdk.NotFoundError) return { code: 'AI_BAD_REQUEST', message: MSG.AI_BAD_REQUEST };
  if (e instanceof sdk.APIError) {
    if (e.status === 402) return { code: 'AI_BILLING', message: MSG.AI_BILLING }; // billing_error has no own class
    if (e.status === 413) return { code: 'AI_BAD_REQUEST', message: MSG.AI_BAD_REQUEST }; // request_too_large
    return { code: 'AI_FAILED', message: MSG.AI_FAILED };
  }
  if (e instanceof sdk.AnthropicError) return { code: 'AI_FAILED', message: MSG.AI_FAILED };
  return null;
}

/** Log-safe one-liner about an SDK error (status, API error type, request id). Never contains the key. */
function errorDetail(e) {
  const parts = [];
  if (e && e.constructor && e.constructor.name) parts.push(e.constructor.name);
  if (e && e.status) parts.push('status ' + e.status);
  if (e && e.type) parts.push('type ' + e.type);
  if (e && e.requestID) parts.push('request ' + e.requestID);
  if (e && e.message) parts.push(String(e.message).slice(0, 500));
  return parts.join(' | ');
}

/**
 * @param {object} deps
 *   store         Store (state.js) — holds `ai`
 *   safeStorage   Electron safeStorage (optional: without it the key is stored plain, flagged)
 *   createClient  (options) -> client with beta.messages.create(params); default: new Anthropic(options)
 *   sdk           the @anthropic-ai/sdk module (for typed error classes); default: require('@anthropic-ai/sdk')
 *   fetch         optional fetch for the SDK. main.js passes Electron's net.fetch: it goes through Chromium's
 *                 network stack, so the Windows system proxy (VPN clients in "system proxy" mode) and the
 *                 Windows certificate store work — Node's built-in fetch ignores both.
 */
function createAi(deps) {
  const store = deps.store;
  const safeStorage = deps.safeStorage || null;
  const fetchImpl = typeof deps.fetch === 'function' ? deps.fetch : null;
  let sdkModule = deps.sdk || null;
  const sdk = () => {
    if (!sdkModule) sdkModule = require('@anthropic-ai/sdk');
    return sdkModule;
  };
  const createClient = deps.createClient || ((options) => {
    const Anthropic = sdk().default;
    return new Anthropic(options);
  });

  function state() {
    const a = store.get('ai');
    return a && typeof a === 'object' ? a : { model: DEFAULT_MODEL, key: null };
  }

  function canEncrypt() {
    if (!safeStorage) return false;
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      // Linux without a keyring falls back to a hard-coded password: that is not protection, call it plain.
      if (typeof safeStorage.getSelectedStorageBackend === 'function' &&
          safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
      return true;
    } catch (e) { return false; }
  }

  /** The stored key in clear text, or null (none stored / cannot be decrypted on this account). */
  function readKey() {
    const k = state().key;
    if (!k || typeof k.data !== 'string' || !k.data) return null;
    if (!k.encrypted) return k.data;
    if (!safeStorage) return null;
    try {
      const plain = safeStorage.decryptString(Buffer.from(k.data, 'base64'));
      return typeof plain === 'string' && plain ? plain : null;
    } catch (e) { return null; }
  }

  function status() {
    const s = state();
    const configured = !!readKey();
    return {
      configured,
      model: MODELS.includes(s.model) ? s.model : DEFAULT_MODEL,
      transport: 'native',
      keyStorage: configured ? (s.key.encrypted ? 'encrypted' : 'plain') : null
    };
  }

  function sealKey(key) {
    if (canEncrypt()) {
      try {
        const blob = safeStorage.encryptString(key);
        return { encrypted: true, data: Buffer.from(blob).toString('base64') };
      } catch (e) { /* fall through to the flagged plain copy */ }
    }
    return { encrypted: false, data: key };
  }

  async function aiStatus() { return status(); }

  async function aiConfigure(args) {
    const a = args || {};
    let model = null;
    let sealed = null;
    if (a.model !== undefined) {
      if (!MODELS.includes(a.model)) throw new HostError('BAD_ARGS', MSG.MODEL_BAD);
      model = a.model;
    }
    if (a.key !== undefined) {
      if (typeof a.key !== 'string') throw new HostError('BAD_ARGS', MSG.KEY_BAD);
      const key = a.key.trim();
      if (!key) throw new HostError('BAD_ARGS', MSG.KEY_EMPTY);
      if (!keyLooksValid(key)) throw new HostError('BAD_ARGS', MSG.KEY_BAD);
      sealed = sealKey(key);
    }
    if (model || sealed) {
      store.update((d) => {
        const cur = d.ai && typeof d.ai === 'object' ? d.ai : { model: DEFAULT_MODEL, key: null };
        d.ai = { model: model || (MODELS.includes(cur.model) ? cur.model : DEFAULT_MODEL), key: sealed || cur.key || null };
      });
    }
    return status();
  }

  async function aiClear() {
    store.update((d) => {
      const cur = d.ai && typeof d.ai === 'object' ? d.ai : {};
      d.ai = { model: MODELS.includes(cur.model) ? cur.model : DEFAULT_MODEL, key: null };
    });
    return status();
  }

  async function aiKey() {
    throw new HostError('UNSUPPORTED', MSG.KEY_PAGE);
  }

  async function aiMessage(args) {
    const stored = state().key;
    const apiKey = readKey();
    if (!apiKey) throw new HostError('AI_NO_KEY', stored ? MSG.AI_KEY_UNREADABLE : MSG.AI_NO_KEY);
    const params = validateParams(args && args.params);

    let client;
    try {
      // authToken:null keeps a stray ANTHROPIC_AUTH_TOKEN in the environment from riding along;
      // logLevel 'off' keeps request logging (ANTHROPIC_LOG) out of the console.
      const options = Object.assign({ apiKey, authToken: null, logLevel: 'off' }, CLIENT_OPTIONS);
      if (fetchImpl) options.fetch = fetchImpl;
      client = createClient(options);
    } catch (e) {
      const m = mapSdkError(e, sdk());
      if (m) throw new HostError(m.code, m.message, errorDetail(e));
      throw e;
    }
    let msg;
    try {
      msg = await client.beta.messages.create(params);
    } catch (e) {
      const m = mapSdkError(e, sdk());
      if (m) throw new HostError(m.code, m.message, errorDetail(e));
      throw e;
    }
    if (!msg || typeof msg !== 'object') throw new HostError('AI_FAILED', MSG.AI_FAILED, 'empty response from the SDK');
    // A plain JSON copy: the SDK object carries non-enumerable extras (_request_id) IPC would drop anyway.
    return JSON.parse(JSON.stringify(msg));
  }

  return { aiStatus, aiConfigure, aiClear, aiKey, aiMessage };
}

module.exports = {
  createAi, validateParams, mapSdkError, keyLooksValid,
  MODELS, DEFAULT_MODEL, BASE_URL, CLIENT_OPTIONS, ALLOWED_KEYS, MAX_TOKENS_LIMIT, MSG
};
