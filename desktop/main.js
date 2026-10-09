'use strict';
/**
 * GinN desktop host (Electron): one window with the shared UI from renderer/ and the `ginn` IPC channel.
 * GINN_SMOKE=1 runs a headless self-check: calls info/hardware/stats/tweaks/games through the real
 * preload bridge, prints "GINN_SMOKE_RESULT <json>" and exits (0 = every call answered ok).
 * It also round-trips the AI key methods (answered locally) and sends one real SDK request through Electron's
 * net.fetch to a local fake server (never to api.anthropic.com), then prints "GINN_SMOKE_AI <json>".
 * Smoke runs use a throwaway userData folder, so a real key or backup is never touched.
 */
const { app, BrowserWindow, ipcMain, shell, clipboard, screen, session, safeStorage, net } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHandlers } = require('./src/handlers');
const { createDispatcher } = require('./src/dispatcher');

const SMOKE = process.env.GINN_SMOKE === '1';
const IS_WIN = process.platform === 'win32';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const SMOKE_PAGE = path.join(__dirname, 'scripts', 'smoke-page.html');
const BG = '#07080D';

let mainWindow = null;
let host = null;
let dispatch = null;

let smokeUserData = null;
if (SMOKE) {
  app.disableHardwareAcceleration();
  // scripts/smoke.js hands in a folder it deletes after Electron exits (Chromium writes into it until the end).
  smokeUserData = process.env.GINN_SMOKE_USERDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-smoke-'));
  app.setPath('userData', smokeUserData);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (host) host.dispose(); });

/* ----------------------------------------------------------------- trust */

function insideDir(file, dir) {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Only our own pages (file:// inside renderer/, or the smoke page in smoke mode) may talk to the host. */
function isAppUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return false;
    const file = fileURLToPath(u);
    if (insideDir(file, RENDERER_DIR)) return true;
    return SMOKE && path.resolve(file) === SMOKE_PAGE;
  } catch (e) { return false; }
}

function isTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  const frame = event.senderFrame;
  return !!frame && isAppUrl(frame.url);
}

/* ---------------------------------------------------------------- events */

/** Push an event to the UI: window.__ginnEvent({type:...}) (same channel the Android host uses). */
function emit(evt) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const js = 'window.__ginnEvent && window.__ginnEvent(' + JSON.stringify(evt) + ')';
  mainWindow.webContents.executeJavaScript(js, true).catch(() => {});
}

/* ---------------------------------------------------------------- window */

function windowIcon() {
  const p = path.join(__dirname, 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined; // packaged builds use the exe icon
}

function createWindow() {
  const opts = {
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'GinN',
    backgroundColor: BG,
    autoHideMenuBar: true,
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  };
  if (IS_WIN) {
    opts.titleBarStyle = 'hidden';
    opts.titleBarOverlay = { color: BG, symbolColor: '#EEF1F8', height: 40 };
  }
  const win = new BrowserWindow(opts);
  if (!IS_WIN) win.removeMenu();
  // Show on first paint; the timer is a fallback for machines where ready-to-show comes late or never.
  let shown = false;
  const show = () => { if (!shown && !win.isDestroyed()) { shown = true; win.show(); } };
  win.once('ready-to-show', show);
  setTimeout(show, 4000);

  const wc = win.webContents;
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  });
  wc.on('will-redirect', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());

  // Coming back to GinN (e.g. from Windows Settings) -> the UI re-reads tweak states.
  let blurredAt = 0;
  win.on('blur', () => { blurredAt = Date.now(); });
  win.on('focus', () => {
    if (blurredAt && Date.now() - blurredAt > 1000) emit({ type: 'resume' });
    blurredAt = 0;
  });
  win.on('closed', () => { mainWindow = null; });
  return win;
}

function loadUi(win) {
  const index = path.join(RENDERER_DIR, 'index.html');
  if (fs.existsSync(index)) return win.loadFile(index);
  if (SMOKE) return win.loadFile(SMOKE_PAGE);
  return win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<body style="background:#07080D;color:#EEF1F8;font:16px Segoe UI,sans-serif;padding:40px">' +
    'Интерфейс не найден. Запусти <b>npm run sync-ui</b> и открой GinN снова.</body>'));
}

/* ----------------------------------------------------------------- smoke */

const SMOKE_PROBE = "Promise.all(['info','hardware','stats','tweaks','games'].map(m=>window.ginnDesktop.call(m,{})))";

// Every call here is answered by GinN itself: no key -> AI_NO_KEY, a request with a forbidden key -> BAD_ARGS.
const SMOKE_AI_PROBE = `(async () => {
  const c = (m, a) => window.ginnDesktop.call(m, a || {});
  const req = { model: 'claude-opus-5-5', max_tokens: 64, messages: [{ role: 'user', content: 'smoke' }] };
  const r = {};
  r.status = await c('aiStatus');
  r.noKey = await c('aiMessage', { params: req });
  r.configure = await c('aiConfigure', { key: '  sk-ant-smoke-test-0000000000000000000000  ', model: 'claude-haiku-5-5' });
  r.badParams = await c('aiMessage', { params: Object.assign({ stream: true }, req) });
  r.key = await c('aiKey');
  r.clear = await c('aiClear');
  return r;
})()`;

function checkSmokeAi(r) {
  const fails = [];
  const expect = (cond, what) => { if (!cond) fails.push(what); };
  expect(r && r.status && r.status.ok && r.status.data.transport === 'native' && r.status.data.configured === false, 'aiStatus');
  expect(r && r.noKey && r.noKey.code === 'AI_NO_KEY', 'aiMessage without key -> AI_NO_KEY');
  expect(r && r.configure && r.configure.ok && r.configure.data.configured === true &&
    r.configure.data.model === 'claude-haiku-5-5', 'aiConfigure');
  expect(r && r.badParams && r.badParams.code === 'BAD_ARGS', 'aiMessage with stream:true -> BAD_ARGS');
  expect(r && r.key && r.key.code === 'UNSUPPORTED', 'aiKey -> UNSUPPORTED');
  expect(r && r.clear && r.clear.ok && r.clear.data.configured === false, 'aiClear');
  let stored = '';
  try { stored = fs.readFileSync(path.join(app.getPath('userData'), 'ginn-state.json'), 'utf8'); } catch (e) { /* no file */ }
  expect(!stored.includes('sk-ant-smoke-test'), 'key is not left in ginn-state.json after aiClear');
  return fails;
}

/** One real @anthropic-ai/sdk request over net.fetch (the production transport) to a local fake API. */
async function smokeNativeTransport() {
  const http = require('node:http');
  const Anthropic = require('@anthropic-ai/sdk');
  const { createAi } = require('./src/ai');
  const { createStore } = require('./src/state');
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-api-key'], beta: req.headers['anthropic-beta'],
        auth: req.headers.authorization || null, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_smoke' });
      res.end(JSON.stringify({ id: 'msg_smoke', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: '{"summary":"ok"}' }],
        stop_reason: 'end_turn', stop_sequence: null, stop_details: null, usage: { input_tokens: 5, output_tokens: 7 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let netCalls = 0;
  const key = 'sk-ant-smoke-transport-0000000000000000';
  try {
    const a = createAi({
      store: createStore(path.join(app.getPath('userData'), 'smoke-ai.json')),
      safeStorage,
      fetch: (u, i) => { netCalls++; return net.fetch(u, i); },
      createClient: (o) => new Anthropic.default(Object.assign({}, o, { baseURL: base }))
    });
    await a.aiConfigure({ key });
    const msg = await a.aiMessage({ params: { model: 'claude-opus-5-5', max_tokens: 64,
      messages: [{ role: 'user', content: 'smoke' }], betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } });
    const r = seen[0] || {};
    let ok = netCalls === 1 && seen.length === 1 && msg.stop_reason === 'end_turn' && r.key === key && !r.auth &&
      r.beta === 'server-side-fallback-2026-07-01' && !!r.body && r.body.fallbacks === 'default' && !('betas' in r.body);

    // net.fetch failures must still come out as the SDK's typed errors -> AI_NETWORK
    const failing = (extra) => createAi({
      store: createStore(path.join(app.getPath('userData'), 'smoke-ai.json')),
      safeStorage,
      fetch: (u, i) => net.fetch(u, i),
      createClient: (o) => new Anthropic.default(Object.assign({}, o, extra))
    });
    const codeOf = (p) => p.then(() => 'no error', (e) => (e && e.code) || String(e));
    const req = { model: 'claude-haiku-5-5', max_tokens: 16, messages: [{ role: 'user', content: 'smoke' }] };
    const deadPort = await new Promise((resolve) => {
      const t = http.createServer();
      t.listen(0, '127.0.0.1', () => { const port = t.address().port; t.close(() => resolve(port)); });
    });
    const refused = await codeOf(failing({ baseURL: 'http://127.0.0.1:' + deadPort, maxRetries: 0 }).aiMessage({ params: req }));
    const hung = http.createServer(() => { /* never answers */ });
    await new Promise((resolve) => hung.listen(0, '127.0.0.1', resolve));
    let timedOut;
    try {
      timedOut = await codeOf(failing({ baseURL: 'http://127.0.0.1:' + hung.address().port, maxRetries: 0, timeout: 400 })
        .aiMessage({ params: req }));
    } finally { hung.closeAllConnections(); hung.close(); }
    ok = ok && refused === 'AI_NETWORK' && timedOut === 'AI_NETWORK';
    return { ok, netCalls, requests: seen.length, url: r.url || null, stop_reason: msg.stop_reason, refused, timedOut };
  } catch (e) {
    return { ok: false, error: (e && e.code ? e.code + ' ' : '') + String((e && e.message) || e), netCalls };
  } finally {
    server.close();
  }
}

function runSmoke(win) {
  const finish = (code, payload) => {
    process.stdout.write('GINN_SMOKE_RESULT ' + JSON.stringify(payload) + '\n', () => {
      if (smokeUserData && !process.env.GINN_SMOKE_USERDATA) {
        try { fs.rmSync(smokeUserData, { recursive: true, force: true }); } catch (e) { /* best effort */ }
      }
      app.exit(code);
    });
  };
  const timer = setTimeout(() => finish(1, { error: 'timeout after 30 s' }), 30000);
  win.webContents.once('did-fail-load', (e, code, desc) => { clearTimeout(timer); finish(1, { error: 'load failed: ' + desc }); });
  win.webContents.once('did-finish-load', async () => {
    try {
      const res = await win.webContents.executeJavaScript(SMOKE_PROBE, true);
      const ok = Array.isArray(res) && res.length === 5 && res.every((r) => r && r.ok === true);
      let aiFails;
      try {
        const ai = await win.webContents.executeJavaScript(SMOKE_AI_PROBE, true);
        aiFails = checkSmokeAi(ai);
        const transport = await smokeNativeTransport();
        if (!transport.ok) aiFails.push('SDK request over net.fetch to a local fake API');
        const keyStorage = ai && ai.configure && ai.configure.data ? ai.configure.data.keyStorage : null;
        process.stdout.write('GINN_SMOKE_AI ' + JSON.stringify({ ok: !aiFails.length, failed: aiFails, keyStorage, transport, calls: ai }) + '\n');
      } catch (e) {
        aiFails = ['ai probe threw: ' + String((e && e.message) || e)];
        process.stdout.write('GINN_SMOKE_AI ' + JSON.stringify({ ok: false, failed: aiFails }) + '\n');
      }
      clearTimeout(timer);
      finish(ok && !aiFails.length ? 0 : 1, res);
    } catch (e) {
      clearTimeout(timer);
      finish(1, { error: String((e && e.message) || e) });
    }
  });
}

/* ----------------------------------------------------------------- start */

function start() {
  if (IS_WIN) app.setAppUserModelId('app.ginn.desktop');

  // The UI needs no camera/mic/geolocation/notifications; only clipboard writes and fullscreen.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'clipboard-sanitized-write' || permission === 'fullscreen');
  });

  host = createHandlers({
    app, shell, clipboard, screen, safeStorage,
    // Claude requests go through Chromium's network stack: Windows proxy settings and certificate store apply.
    netFetch: (url, init) => net.fetch(url, init),
    platform: process.platform,
    userData: app.getPath('userData'),
    downloads: app.getPath('downloads'),
    emit
  });
  dispatch = createDispatcher(host.handlers);

  ipcMain.handle('ginn', async (event, method, args) => {
    if (!isTrustedSender(event)) return { ok: false, code: 'FORBIDDEN', error: 'Запрос отклонён' };
    return dispatch(method, args);
  });

  mainWindow = createWindow();
  if (SMOKE) runSmoke(mainWindow);
  loadUi(mainWindow).catch(() => { /* reported through did-fail-load */ });
}
