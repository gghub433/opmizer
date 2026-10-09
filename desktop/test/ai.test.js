'use strict';
/**
 * GinN AI host side. No real API calls: a fake client factory, a fake safeStorage, the REAL SDK error
 * classes, and one block of end-to-end tests where the real @anthropic-ai/sdk talks to a local HTTP server.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Anthropic = require('@anthropic-ai/sdk');
const ai = require('../src/ai');
const { createStore } = require('../src/state');
const { createDispatcher } = require('../src/dispatcher');

const KEY = 'sk-ant-api03-TEST-0123456789abcdefghijklmnopqrstuvwxyz-AAAA';
const CYR = /[а-яё]/i;

/* ------------------------------------------------------------------ helpers */

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-ai-'));
  const file = path.join(dir, 'ginn-state.json');
  return { store: createStore(file), file, dir, reopen: () => createStore(file) };
}

/** Stand-in for Electron safeStorage: a reversible scramble, so the clear key never appears in the blob. */
function fakeSafeStorage(o) {
  const opt = o || {};
  const calls = { encrypt: 0, decrypt: 0 };
  const s = {
    calls,
    isEncryptionAvailable: () => opt.available !== false,
    encryptString(text) {
      calls.encrypt++;
      if (opt.encryptThrows) throw new Error('encrypt failed');
      assert.equal(typeof text, 'string');
      return Buffer.concat([Buffer.from('v10'), Buffer.from(text, 'utf8').map((b) => b ^ 0x5a)]);
    },
    decryptString(buf) {
      calls.decrypt++;
      if (opt.decryptThrows) throw new Error('decrypt failed');
      assert.ok(Buffer.isBuffer(buf), 'decryptString gets a Buffer');
      assert.equal(buf.subarray(0, 3).toString(), 'v10');
      return Buffer.from(buf.subarray(3).map((b) => b ^ 0x5a)).toString('utf8');
    }
  };
  if (opt.backend) s.getSelectedStorageBackend = () => opt.backend;
  return s;
}

function message(extra) {
  return Object.assign({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: '{"summary":"ok"}' }
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1200, output_tokens: 340 }
  }, extra || {});
}

/** A request exactly like GinN.ai builds it (docs/ARCHITECTURE.md → GinN AI). */
function planRequest(model) {
  const m = model || 'claude-opus-5-5';
  const p = {
    model: m,
    max_tokens: 16000,
    system: 'Ты — GinN, помощник по оптимизации игр.',
    messages: [{ role: 'user', content: 'Цель: больше FPS. Контекст: {"cpu":"Ryzen 5 5600"}' }],
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['summary', 'steps'],
          properties: {
            summary: { type: 'string' },
            steps: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false, required: ['tweakId', 'enable'],
                properties: { tweakId: { type: 'string', enum: ['game_mode', 'hags'] }, enable: { type: 'boolean' } }
              }
            }
          }
        }
      }
    }
  };
  if (m !== 'claude-haiku-5-5') {
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  return p;
}

/** Fake client factory: records options and params, answers with `answer` (value or thrown error). */
function fakeFactory(answer) {
  const seen = { options: [], params: [] };
  const createClient = (options) => {
    seen.options.push(options);
    return {
      beta: {
        messages: {
          create: async (params) => {
            seen.params.push(params);
            if (answer instanceof Error) throw answer;
            return typeof answer === 'function' ? answer(params) : answer;
          }
        }
      }
    };
  };
  return { createClient, seen };
}

function withEnv(vars, fn) {
  const old = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; process.env[k] = vars[k]; }
  const restore = () => {
    for (const k of Object.keys(vars)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
  };
  return Promise.resolve().then(fn).finally(restore);
}

/* --------------------------------------------------------- params validation */

test('validateParams accepts the GinN.ai request for every model (Haiku without fallbacks)', () => {
  for (const m of ai.MODELS) {
    const p = planRequest(m);
    assert.equal(ai.validateParams(p), p, m);
  }
  assert.deepEqual([...ai.MODELS], ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  assert.equal(ai.DEFAULT_MODEL, 'claude-opus-5-5');
  const p = planRequest();
  p.max_tokens = 32000;
  ai.validateParams(p);
  p.system = [{ type: 'text', text: 'system as blocks' }];
  ai.validateParams(p);
  const q = planRequest();
  q.fallbacks = [{ model: 'claude-opus-5' }];
  ai.validateParams(q); // array form is the API's business, not ours
});

test('validateParams rejects everything outside the contract with BAD_ARGS', () => {
  const bad = (mutate, why) => {
    const p = planRequest();
    const r = mutate(p);
    assert.throws(() => ai.validateParams(r === undefined ? p : r), (e) => e.code === 'BAD_ARGS' && CYR.test(e.message), why);
  };
  // not a plain object
  bad(() => null, 'null');
  bad(() => [], 'array');
  bad(() => 'model=claude-opus-5-5', 'string');
  bad(() => new Map([['model', 'claude-opus-5-5']]), 'Map');
  bad(() => Object.assign(Object.create({ evil: 1 }), planRequest()), 'custom prototype');
  // keys GinN never sends (thinking / sampling / streaming / tools)
  for (const k of ['thinking', 'temperature', 'top_p', 'top_k', 'stream', 'tools', 'tool_choice', 'metadata', 'speed',
    'container', 'mcp_servers', '__proto__x']) {
    bad((p) => { p[k] = k === 'thinking' ? { type: 'disabled' } : 1; }, 'key ' + k);
  }
  // model allowlist — exact ids only, no date suffixes, no other families
  for (const m of [undefined, '', 'claude-opus-5-5-20260401', 'claude-fable-5-1', 'claude-opus-5', 'CLAUDE-OPUS-5-5', 'gpt-4o', 7]) {
    bad((p) => { p.model = m; }, 'model ' + m);
  }
  // max_tokens: integer 1..32000
  for (const n of [undefined, 0, -1, 32001, 64000, 1.5, '16000', NaN, Infinity, null]) {
    bad((p) => { p.max_tokens = n; }, 'max_tokens ' + n);
  }
  bad((p) => { p.messages = []; }, 'empty messages');
  bad((p) => { p.messages = 'hi'; }, 'messages string');
  bad((p) => { p.messages = ['hi']; }, 'message not an object');
  bad((p) => { p.system = 42; }, 'system number');
  bad((p) => { p.output_config = 'json'; }, 'output_config string');
  bad((p) => { p.betas = 'server-side-fallback-2026-07-01'; }, 'betas string');
  bad((p) => { p.betas = [1]; }, 'betas not strings');
  bad((p) => { p.fallbacks = true; }, 'fallbacks boolean');
  // Haiku has no server-side fallback
  bad((p) => { p.model = 'claude-haiku-5-5'; }, 'fallbacks with haiku');
  // size cap
  bad((p) => { p.messages[0].content = 'x'.repeat(2 * 1024 * 1024 + 10); }, 'over 2 MB');
});

/* ------------------------------------------------------- status + key storage */

test('aiStatus defaults: not configured, Opus 5.5, native transport', async () => {
  const t = tmpStore();
  const a = ai.createAi({ store: t.store, safeStorage: fakeSafeStorage() });
  assert.deepEqual(await a.aiStatus(), { configured: false, model: 'claude-opus-5-5', transport: 'native', keyStorage: null });
  assert.ok(!fs.existsSync(t.file), 'reading the status writes nothing');
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('key round-trip with safeStorage: trimmed, encrypted on disk, used for requests, wiped by aiClear', async () => {
  const t = tmpStore();
  const safe = fakeSafeStorage();
  const f = fakeFactory(message());
  const a = ai.createAi({ store: t.store, safeStorage: safe, createClient: f.createClient });

  const st = await a.aiConfigure({ key: '  \n' + KEY + '\t ' });
  assert.deepEqual(st, { configured: true, model: 'claude-opus-5-5', transport: 'native', keyStorage: 'encrypted' });
  assert.equal(safe.calls.encrypt, 1);
  const disk = fs.readFileSync(t.file, 'utf8');
  assert.ok(!disk.includes(KEY) && !disk.includes('TEST-0123456789'), 'clear key never reaches the state file');
  const saved = JSON.parse(disk).ai;
  assert.equal(saved.key.encrypted, true);
  assert.equal(saved.model, 'claude-opus-5-5');
  assert.ok(Buffer.from(saved.key.data, 'base64').subarray(0, 3).equals(Buffer.from('v10')));

  // a fresh process (new store + new module instance) still reads it
  const b = ai.createAi({ store: t.reopen(), safeStorage: safe, createClient: f.createClient });
  assert.equal((await b.aiStatus()).configured, true);
  await b.aiMessage({ params: planRequest() });
  assert.equal(f.seen.options[0].apiKey, KEY, 'decrypted, trimmed key goes to the SDK');

  // the status never exposes the key
  assert.ok(!JSON.stringify(await b.aiStatus()).includes(KEY));

  const cleared = await b.aiClear();
  assert.deepEqual(cleared, { configured: false, model: 'claude-opus-5-5', transport: 'native', keyStorage: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(t.file, 'utf8')).ai, { model: 'claude-opus-5-5', key: null });
  await assert.rejects(b.aiMessage({ params: planRequest() }), { code: 'AI_NO_KEY' });
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('key fallback: no encryption available -> stored plain and flagged, still works', async () => {
  for (const [label, safe] of [
    ['isEncryptionAvailable false', fakeSafeStorage({ available: false })],
    ['Linux basic_text backend', fakeSafeStorage({ backend: 'basic_text' })],
    ['encryptString throws', fakeSafeStorage({ encryptThrows: true })],
    ['no safeStorage at all', undefined]
  ]) {
    const t = tmpStore();
    const f = fakeFactory(message());
    const a = ai.createAi({ store: t.store, safeStorage: safe, createClient: f.createClient });
    const st = await a.aiConfigure({ key: KEY });
    assert.equal(st.configured, true, label);
    assert.equal(st.keyStorage, 'plain', label);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file, 'utf8')).ai.key, { encrypted: false, data: KEY }, label);
    await a.aiMessage({ params: planRequest() });
    assert.equal(f.seen.options[0].apiKey, KEY, label);
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  // a working keyring backend on Linux counts as encrypted
  const t = tmpStore();
  const a = ai.createAi({ store: t.store, safeStorage: fakeSafeStorage({ backend: 'gnome_libsecret' }) });
  assert.equal((await a.aiConfigure({ key: KEY })).keyStorage, 'encrypted');
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('an encrypted key that cannot be decrypted (other Windows account) reads as not configured', async () => {
  const t = tmpStore();
  await ai.createAi({ store: t.store, safeStorage: fakeSafeStorage() }).aiConfigure({ key: KEY });
  const f = fakeFactory(message());
  const a = ai.createAi({ store: t.reopen(), safeStorage: fakeSafeStorage({ decryptThrows: true }), createClient: f.createClient });
  assert.equal((await a.aiStatus()).configured, false);
  await assert.rejects(a.aiMessage({ params: planRequest() }), (e) => e.code === 'AI_NO_KEY' && /прочитать/.test(e.message));
  assert.equal(f.seen.options.length, 0, 'no client is created without a usable key');
  // entering the key again fixes it
  const b = ai.createAi({ store: t.reopen(), safeStorage: fakeSafeStorage() });
  assert.equal((await b.aiConfigure({ key: KEY })).configured, true);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('aiConfigure validates key and model; a model change keeps the key', async () => {
  const t = tmpStore();
  const a = ai.createAi({ store: t.store, safeStorage: fakeSafeStorage() });
  for (const k of ['', '   ', '\n\t']) {
    await assert.rejects(a.aiConfigure({ key: k }), (e) => e.code === 'BAD_ARGS' && /пуст/.test(e.message));
  }
  for (const k of [42, null, {}, ['sk'], 'sk-ant-short', 'sk-ant-api03 with spaces inside the key value 123', 'sk-ant-api03-ключ-по-русски-1234567890']) {
    await assert.rejects(a.aiConfigure({ key: k }), (e) => e.code === 'BAD_ARGS' && CYR.test(e.message), String(k));
  }
  for (const m of ['claude-opus-5', 'claude-fable-5-1', 'claude-opus-5-5-20260401', '', null, 5]) {
    await assert.rejects(a.aiConfigure({ model: m }), (e) => e.code === 'BAD_ARGS' && CYR.test(e.message), String(m));
  }
  // a bad model in the same call must not store the key either
  await assert.rejects(a.aiConfigure({ key: KEY, model: 'gpt-4o' }), { code: 'BAD_ARGS' });
  assert.ok(!fs.existsSync(t.file), 'failed calls write nothing');

  assert.deepEqual(await a.aiConfigure({ model: 'claude-sonnet-5-5' }),
    { configured: false, model: 'claude-sonnet-5-5', transport: 'native', keyStorage: null });
  assert.deepEqual(await a.aiConfigure({ key: KEY, model: 'claude-haiku-5-5' }),
    { configured: true, model: 'claude-haiku-5-5', transport: 'native', keyStorage: 'encrypted' });
  assert.deepEqual(await a.aiConfigure({ model: 'claude-opus-5-5' }),
    { configured: true, model: 'claude-opus-5-5', transport: 'native', keyStorage: 'encrypted' });
  assert.equal((await a.aiConfigure({})).configured, true, 'empty call is a no-op');
  assert.equal((await a.aiClear()).model, 'claude-opus-5-5', 'aiClear keeps the model choice');
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('aiKey is UNSUPPORTED on desktop (the key never goes to the page)', async () => {
  const t = tmpStore();
  const a = ai.createAi({ store: t.store, safeStorage: fakeSafeStorage() });
  await a.aiConfigure({ key: KEY });
  await assert.rejects(a.aiKey(), (e) => e.code === 'UNSUPPORTED' && CYR.test(e.message) && !e.message.includes(KEY));
  fs.rmSync(t.dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------- aiMessage */

test('aiMessage: no key -> AI_NO_KEY before anything else (no client, even for bad params)', async () => {
  const t = tmpStore();
  const f = fakeFactory(message());
  const a = ai.createAi({ store: t.store, createClient: f.createClient });
  await assert.rejects(a.aiMessage({ params: planRequest() }), (e) => e.code === 'AI_NO_KEY' && CYR.test(e.message));
  await assert.rejects(a.aiMessage({ params: { stream: true } }), { code: 'AI_NO_KEY' });
  await assert.rejects(a.aiMessage({}), { code: 'AI_NO_KEY' });
  assert.equal(f.seen.options.length, 0);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('aiMessage: client options are fixed, params pass through untouched, result is the raw Message as plain JSON', async () => {
  const t = tmpStore();
  const msg = message({
    content: [
      { type: 'thinking', thinking: '', signature: 'abc' },
      { type: 'fallback', from_model: 'claude-opus-5-5', to_model: 'claude-opus-5' },
      { type: 'text', text: '{"summary":"Готово"}' }
    ]
  });
  Object.defineProperty(msg, '_request_id', { value: 'req_123', enumerable: false });
  const f = fakeFactory(msg);
  const a = ai.createAi({ store: t.store, safeStorage: fakeSafeStorage(), createClient: f.createClient });
  await a.aiConfigure({ key: KEY });
  const params = planRequest();
  const snapshot = JSON.parse(JSON.stringify(params));
  const out = await a.aiMessage({ params });

  assert.deepEqual(f.seen.options, [{
    apiKey: KEY, authToken: null, logLevel: 'off',
    baseURL: 'https://api.anthropic.com', maxRetries: 2, timeout: 120000
  }]);
  assert.deepEqual(f.seen.params, [snapshot], 'request body is not rewritten by the host');
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(out, JSON.parse(JSON.stringify(msg)));
  assert.ok(!('_request_id' in out));

  // refusal / max_tokens come back raw: the caller (GinN.ai) maps them to AI_REFUSAL / AI_TRUNCATED
  for (const stop of ['refusal', 'max_tokens']) {
    const g = fakeFactory(message({ stop_reason: stop, stop_details: stop === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: null } : null }));
    const b = ai.createAi({ store: t.reopen(), safeStorage: fakeSafeStorage(), createClient: g.createClient });
    assert.equal((await b.aiMessage({ params: planRequest('claude-haiku-5-5') })).stop_reason, stop);
  }
  // invalid params never reach the client
  await assert.rejects(a.aiMessage({ params: Object.assign(planRequest(), { thinking: { type: 'disabled' } }) }), { code: 'BAD_ARGS' });
  await assert.rejects(a.aiMessage({ params: Object.assign(planRequest(), { temperature: 0 }) }), { code: 'BAD_ARGS' });
  assert.equal(f.seen.params.length, 1);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('default client: real SDK constructor, baseURL pinned even when ANTHROPIC_BASE_URL / AUTH_TOKEN are set', async () => {
  const t = tmpStore();
  const made = [];
  class Spy extends Anthropic.default {
    constructor(o) {
      super(o);
      made.push(this);
      this.beta.messages.create = async () => message(); // no network
    }
  }
  const sdk = Object.assign({}, Anthropic, { default: Spy });
  await withEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/evil', ANTHROPIC_AUTH_TOKEN: 'env-token-should-not-be-used' }, async () => {
    const a = ai.createAi({ store: t.store, safeStorage: fakeSafeStorage(), sdk });
    await a.aiConfigure({ key: KEY });
    const out = await a.aiMessage({ params: planRequest() });
    assert.equal(out.id, 'msg_test');
  });
  assert.equal(made.length, 1);
  assert.equal(made[0].baseURL, 'https://api.anthropic.com');
  assert.equal(made[0].apiKey, KEY);
  assert.equal(made[0].authToken, null);
  assert.equal(made[0].maxRetries, 2);
  assert.equal(made[0].timeout, 120000);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------ error mapping */

const H = () => new Headers({ 'request-id': 'req_test_1', 'content-type': 'application/json' });
const body = (type, msg) => ({ type: 'error', error: { type, message: msg || type } });

const STATUS_CASES = [
  [400, 'invalid_request_error', Anthropic.BadRequestError, 'AI_BAD_REQUEST'],
  [401, 'authentication_error', Anthropic.AuthenticationError, 'AI_AUTH'],
  [402, 'billing_error', Anthropic.APIError, 'AI_BILLING'],
  [403, 'permission_error', Anthropic.PermissionDeniedError, 'AI_AUTH'],
  [404, 'not_found_error', Anthropic.NotFoundError, 'AI_BAD_REQUEST'],
  [409, 'conflict_error', Anthropic.ConflictError, 'AI_FAILED'],
  [413, 'request_too_large', Anthropic.APIError, 'AI_BAD_REQUEST'],
  [422, 'unprocessable_entity', Anthropic.UnprocessableEntityError, 'AI_FAILED'],
  [429, 'rate_limit_error', Anthropic.RateLimitError, 'AI_RATE'],
  [500, 'api_error', Anthropic.InternalServerError, 'AI_BUSY'],
  [503, 'api_error', Anthropic.InternalServerError, 'AI_BUSY'],
  [529, 'overloaded_error', Anthropic.InternalServerError, 'AI_BUSY']
];

test('mapSdkError: every status built by the real SDK (APIError.generate) maps to its AI_* code', () => {
  for (const [status, type, Cls, code] of STATUS_CASES) {
    const e = Anthropic.APIError.generate(status, body(type), undefined, H());
    assert.equal(e.constructor, Cls, status + ' is built as ' + Cls.name);
    const m = ai.mapSdkError(e, Anthropic);
    assert.equal(m.code, code, String(status));
    assert.ok(CYR.test(m.message), 'Russian message for ' + status);
  }
  // 401 and 403 share AI_AUTH but say different things (403 is also what an unsupported region gets)
  assert.equal(ai.mapSdkError(Anthropic.APIError.generate(401, body('authentication_error'), undefined, H()), Anthropic).message, ai.MSG.AI_AUTH);
  assert.equal(ai.mapSdkError(Anthropic.APIError.generate(403, body('permission_error'), undefined, H()), Anthropic).message, ai.MSG.AI_FORBIDDEN);
  // connection problems: APIConnectionError is a subclass of APIError and must not fall into AI_FAILED
  const conn = new Anthropic.APIConnectionError({ message: 'Connection error.', cause: new Error('ECONNREFUSED') });
  assert.ok(conn instanceof Anthropic.APIError);
  assert.deepEqual(ai.mapSdkError(conn, Anthropic), { code: 'AI_NETWORK', message: ai.MSG.AI_NETWORK });
  const tmo = new Anthropic.APIConnectionTimeoutError();
  assert.deepEqual(ai.mapSdkError(tmo, Anthropic), { code: 'AI_NETWORK', message: ai.MSG.AI_TIMEOUT });
  // what generate() makes when there is no response at all
  assert.equal(ai.mapSdkError(Anthropic.APIError.generate(undefined, new Error('socket hang up'), 'Connection error.', undefined), Anthropic).code, 'AI_NETWORK');
  assert.equal(ai.mapSdkError(new Anthropic.AnthropicError('bad config'), Anthropic).code, 'AI_FAILED');
  assert.equal(ai.mapSdkError(new Anthropic.APIUserAbortError(), Anthropic).code, 'AI_FAILED');
  assert.equal(ai.mapSdkError(new TypeError('not from the SDK'), Anthropic), null);
});

test('aiMessage turns thrown SDK errors into HostErrors with Russian text; the key never leaks', async () => {
  const t = tmpStore();
  const logged = [];
  const cases = STATUS_CASES.map(([s, type, , code]) => [Anthropic.APIError.generate(s, body(type, 'details for ' + s), undefined, H()), code])
    .concat([[new Anthropic.APIConnectionError({ message: 'Connection error.' }), 'AI_NETWORK'],
      [new Anthropic.APIConnectionTimeoutError(), 'AI_NETWORK']]);
  for (const [err, code] of cases) {
    const f = fakeFactory(err);
    const a = ai.createAi({ store: t.store, safeStorage: fakeSafeStorage(), createClient: f.createClient });
    await a.aiConfigure({ key: KEY });
    const d = createDispatcher(a, { log: (...x) => logged.push(x.join(' ')) });
    const r = await d('aiMessage', { params: planRequest() });
    assert.equal(r.ok, false);
    assert.equal(r.code, code, err.constructor.name + ' ' + err.status);
    assert.ok(CYR.test(r.error), 'Russian: ' + r.error);
    assert.ok(!/\d{3} |error|Error/.test(r.error), 'no English internals: ' + r.error);
    assert.ok(!r.error.includes(KEY));
  }
  assert.ok(logged.length >= cases.length, 'details are logged for diagnosis');
  assert.ok(logged.some((l) => /req_test_1/.test(l) && /status 402/.test(l)), 'log carries status and request id');
  assert.ok(logged.every((l) => !l.includes(KEY)), 'the key is never logged');

  // a non-SDK failure is not dressed up as an AI code: the dispatcher reports a generic FAILED
  const f = fakeFactory(new TypeError('boom'));
  const a = ai.createAi({ store: t.store, safeStorage: fakeSafeStorage(), createClient: f.createClient });
  const r = await createDispatcher(a, { log: () => {} })('aiMessage', { params: planRequest() });
  assert.equal(r.code, 'FAILED');
  fs.rmSync(t.dir, { recursive: true, force: true });
});

/* ------------------------------------- end to end: real SDK -> local HTTP server */

function startServer(handler) {
  return new Promise((resolve) => {
    const reqs = [];
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        const r = { method: req.method, url: req.url, headers: req.headers, body: data ? JSON.parse(data) : null };
        reqs.push(r);
        handler(r, res, reqs.length);
      });
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port,
        reqs,
        close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); })
      });
    });
  });
}

function json(res, status, obj, headers) {
  res.writeHead(status, Object.assign({ 'content-type': 'application/json', 'request-id': 'req_local_' + status }, headers || {}));
  res.end(JSON.stringify(obj));
}

/** createAi whose factory builds a REAL SDK client, only re-pointed at the local server. */
async function realSdkAi(serverUrl, overrides) {
  const t = tmpStore();
  const seen = [];
  const a = ai.createAi({
    store: t.store,
    safeStorage: fakeSafeStorage(),
    createClient: (o) => { seen.push(o); return new Anthropic.default(Object.assign({}, o, { baseURL: serverUrl }, overrides || {})); }
  });
  await a.aiConfigure({ key: KEY });
  return { a, t, seen };
}

test('real SDK against a local server: request shape, headers, body and the raw Message back', async () => {
  const srv = await startServer((r, res) => json(res, 200, message({
    content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '{"summary":"Всё хорошо"}' }]
  })));
  try {
    await withEnv({ ANTHROPIC_AUTH_TOKEN: 'env-token-should-not-be-used' }, async () => {
      const { a, t } = await realSdkAi(srv.url);
      const params = planRequest();
      const out = await a.aiMessage({ params });
      assert.equal(out.stop_reason, 'end_turn');
      assert.equal(out.content.find((b) => b.type === 'text').text, '{"summary":"Всё хорошо"}');
      assert.deepEqual(out.usage, { input_tokens: 1200, output_tokens: 340 });

      assert.equal(srv.reqs.length, 1);
      const r = srv.reqs[0];
      assert.equal(r.method, 'POST');
      assert.equal(r.url, '/v1/messages?beta=true');
      assert.equal(r.headers['x-api-key'], KEY);
      assert.equal(r.headers.authorization, undefined, 'no Bearer token from the environment');
      assert.ok(r.headers['anthropic-version'], 'SDK sends anthropic-version');
      assert.equal(r.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
      const expected = JSON.parse(JSON.stringify(params));
      delete expected.betas; // betas travel as the anthropic-beta header
      assert.deepEqual(r.body, expected);
      for (const k of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice', 'stream']) assert.ok(!(k in r.body), k);
      fs.rmSync(t.dir, { recursive: true, force: true });
    });
  } finally { await srv.close(); }
});

test('an injected fetch (Electron net.fetch in production) is handed to the SDK and carries the request', async () => {
  const srv = await startServer((r, res) => json(res, 200, message()));
  try {
    const t = tmpStore();
    const used = [];
    const netFetch = (url, init) => { used.push(String(url)); return fetch(url, init); };
    const seen = [];
    const a = ai.createAi({
      store: t.store, safeStorage: fakeSafeStorage(), fetch: netFetch,
      createClient: (o) => { seen.push(o); return new Anthropic.default(Object.assign({}, o, { baseURL: srv.url })); }
    });
    await a.aiConfigure({ key: KEY });
    const out = await a.aiMessage({ params: planRequest('claude-sonnet-5-5') });
    assert.equal(out.id, 'msg_test');
    assert.equal(seen[0].fetch, netFetch);
    assert.deepEqual(used, [srv.url + '/v1/messages?beta=true']);
    assert.equal(srv.reqs[0].body.model, 'claude-sonnet-5-5');
    fs.rmSync(t.dir, { recursive: true, force: true });
  } finally { await srv.close(); }
});

test('real SDK against a local server: HTTP errors map to AI_* codes (529 is retried twice first)', async () => {
  const plan = {
    '/401': [401, body('authentication_error', 'invalid x-api-key'), 'AI_AUTH'],
    '/402': [402, body('billing_error', 'credit balance too low'), 'AI_BILLING'],
    '/403': [403, body('permission_error'), 'AI_AUTH'],
    '/400': [400, body('invalid_request_error', 'output_config.format.schema: bad'), 'AI_BAD_REQUEST'],
    '/404': [404, body('not_found_error', 'model: claude-x'), 'AI_BAD_REQUEST'],
    '/413': [413, body('request_too_large'), 'AI_BAD_REQUEST'],
    '/429': [429, body('rate_limit_error'), 'AI_RATE'],
    '/529': [529, body('overloaded_error', 'Overloaded'), 'AI_BUSY']
  };
  const srv = await startServer((r, res) => {
    const p = plan[r.url.split('/v1/')[0]];
    // retry-after-ms keeps the SDK's retry back-off short in tests
    json(res, p[0], p[1], { 'retry-after-ms': '5' });
  });
  try {
    for (const [prefix, [status, , code]] of Object.entries(plan)) {
      const before = srv.reqs.length;
      const { a, t } = await realSdkAi(srv.url + prefix);
      await assert.rejects(a.aiMessage({ params: planRequest() }), (e) => e.code === code && CYR.test(e.message), prefix);
      const tries = srv.reqs.length - before;
      const retryable = status === 429 || status >= 500;
      assert.equal(tries, retryable ? 3 : 1, prefix + ' attempts (maxRetries 2)');
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  } finally { await srv.close(); }
});

test('real SDK: refused connection and a hung server map to AI_NETWORK', async () => {
  // a port with nobody listening
  const dead = await startServer(() => {});
  const deadUrl = dead.url;
  await dead.close();
  {
    const { a, t } = await realSdkAi(deadUrl, { maxRetries: 0 });
    await assert.rejects(a.aiMessage({ params: planRequest() }), (e) => e.code === 'AI_NETWORK' && e.message === ai.MSG.AI_NETWORK);
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  // a server that never answers
  const hung = await startServer(() => { /* never respond */ });
  try {
    const { a, t } = await realSdkAi(hung.url, { maxRetries: 0, timeout: 300 });
    await assert.rejects(a.aiMessage({ params: planRequest() }), (e) => e.code === 'AI_NETWORK' && e.message === ai.MSG.AI_TIMEOUT);
    fs.rmSync(t.dir, { recursive: true, force: true });
  } finally { await hung.close(); }
});
